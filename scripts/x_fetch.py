"""Retry, backoff, and a small pool for the X mirror lanes.

The X timelines come from third-party mirrors that rate-limit, time out, and
fail for a few seconds at a time. One attempt per URL lost a feed for half an
hour, so every request gets a second try after a short, jittered wait, and a
429 waits as long as the mirror asks. The pool only overlaps the network step
of different accounts; identity, health, media, and publish stay serial in
update_feeds.build().
"""

from __future__ import annotations

import random
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

# 408 request timeout, 425 too early, 429 slow down, and the 5xx family that
# a mirror returns when its own upstream is unhappy.
RETRY_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524})
MAX_RETRY_AFTER = 30.0
BASE_DELAY = 1.0
MAX_ATTEMPTS = 2


def status_of(exc: BaseException) -> int:
    """The HTTP status behind a urllib error, or 0 when there is not one."""
    code = getattr(exc, "code", None)
    try:
        return int(code)
    except (TypeError, ValueError):
        return 0


def is_retryable(exc: BaseException) -> bool:
    """A rate limit, a server error, or a dropped connection is worth one more try."""
    if isinstance(exc, urllib.error.HTTPError):
        return status_of(exc) in RETRY_STATUSES
    if isinstance(exc, (urllib.error.URLError, TimeoutError, ConnectionError, OSError)):
        return True
    return False


def retry_after(headers) -> float | None:
    """The mirror's own Retry-After in seconds, capped so one host cannot stall a run."""
    if not headers:
        return None
    try:
        raw = headers.get("Retry-After") or headers.get("retry-after")
    except AttributeError:
        return None
    if not raw:
        return None
    text = str(raw).strip()
    if text.isdigit():
        return min(float(text), MAX_RETRY_AFTER)
    return None


def retry_delay(attempt: int, headers=None, rng=None) -> float:
    """Seconds to wait before retrying. attempt is zero based."""
    asked = retry_after(headers)
    if asked is not None:
        return asked
    rng = rng or random
    delay = BASE_DELAY * (2 ** max(0, int(attempt)))
    return round(min(delay + rng.uniform(0, 0.5), MAX_RETRY_AFTER), 2)


def host_of(url: str) -> str:
    return (urllib.parse.urlparse(url or "").hostname or "").lower()


def prefetch(jobs: dict, workers: int = 4) -> dict:
    """Run callables in a bounded pool. A raised job comes back as its exception."""
    if not jobs:
        return {}
    limit = max(1, min(int(workers or 4), len(jobs)))
    out: dict = {}
    with ThreadPoolExecutor(max_workers=limit) as pool:
        futures = {key: pool.submit(job) for key, job in jobs.items()}
        for key, future in futures.items():
            try:
                out[key] = future.result()
            except Exception as exc:  # the caller falls back to a serial fetch
                out[key] = exc
    return out
