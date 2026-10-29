#!/usr/bin/env python3
"""Turn a dead source host off for a while instead of letting it eat the sync.

A third-party instance (an RSS bridge, a Nitter or RSSHub mirror) can die
for good while nobody is watching. Each run the sync tries it, waits for the
timeouts and retries, and spends its time budget. This breaker counts runs in
which every request to a host failed. After three such runs in a row the host
is skipped for two hours, then four, eight, and at most a day. After the pause
one run tries it again ("half open"); a single success resets it. The feed
keeps its last good posts, the other mirrors and the built-in fetchers are
still tried, and the sync never fails because one host is gone.

State lives in R2 at sync/source-breaker.json next to the ETag cache.
Only host names are stored.
"""

from __future__ import annotations

import json
import sys
import threading
import time
import urllib.parse

KEY = "sync/source-breaker.json"
TRIP_RUNS = 3
BASE_PAUSE = 2 * 3600
MAX_PAUSE = 24 * 3600
# Our own services are never switched off by the breaker.
NEVER = ("workers.dev", "github.io", "pages.dev", "onrender.com", "localhost", "127.0.0.1")

_LOCK = threading.Lock()
_STATE: dict = {}
_RUN: dict = {}


def host_of(url: str) -> str:
    return (urllib.parse.urlparse(url or "").hostname or "").lower()


def _exempt(host: str) -> bool:
    return not host or any(host == item or host.endswith("." + item) for item in NEVER)


def load(blob: bytes | None) -> None:
    global _STATE
    _STATE = {}
    _RUN.clear()
    if not blob:
        return
    try:
        parsed = json.loads(blob.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return
    if isinstance(parsed, dict):
        _STATE = {str(k): v for k, v in parsed.items() if isinstance(v, dict)}


def allowed(url: str, now: float | None = None) -> bool:
    host = host_of(url)
    if _exempt(host):
        return True
    at = time.time() if now is None else now
    with _LOCK:
        row = _STATE.get(host) or {}
        return float(row.get("until") or 0) <= at


def record(url: str, ok: bool) -> None:
    host = host_of(url)
    if _exempt(host):
        return
    with _LOCK:
        seen = _RUN.setdefault(host, {"ok": 0, "fail": 0})
        seen["ok" if ok else "fail"] += 1


def finish(now: float | None = None) -> list:
    """Fold this run into the state. Returns hosts that were just switched off."""
    at = time.time() if now is None else now
    tripped = []
    with _LOCK:
        for host, seen in _RUN.items():
            row = dict(_STATE.get(host) or {})
            if seen["ok"]:
                _STATE.pop(host, None)
                continue
            runs = int(row.get("runs") or 0) + 1
            row["runs"] = runs
            row["last"] = int(at)
            if runs >= TRIP_RUNS:
                trips = int(row.get("trips") or 0)
                pause = min(MAX_PAUSE, BASE_PAUSE * (2 ** trips))
                row["until"] = int(at + pause)
                row["trips"] = trips + 1
                # The half-open try after the pause trips it again at once.
                row["runs"] = TRIP_RUNS - 1
                tripped.append(host)
            _STATE[host] = row
        _RUN.clear()
    return tripped


def dump() -> bytes:
    with _LOCK:
        return json.dumps(_STATE, sort_keys=True).encode("utf-8")


def paused_hosts(now: float | None = None) -> list:
    at = time.time() if now is None else now
    with _LOCK:
        return sorted(h for h, row in _STATE.items() if float(row.get("until") or 0) > at)


def selftest() -> int:
    load(None)
    url = "https://dead.example.org/feed"
    t = 1_000_000.0
    for i in range(TRIP_RUNS - 1):
        record(url, False)
        assert finish(t + i) == [], "a host is not switched off before three bad runs"
        assert allowed(url, t + i)
    record(url, False)
    assert finish(t + 10) == ["dead.example.org"]
    assert not allowed(url, t + 11)
    assert allowed(url, t + 10 + BASE_PAUSE + 1), "the host is tried again after the pause"
    record(url, False)
    assert finish(t + 10 + BASE_PAUSE + 2) == ["dead.example.org"], "a failed retry trips again"
    assert not allowed(url, t + 10 + BASE_PAUSE + 3 + BASE_PAUSE), "the second pause is longer"
    record(url, True)
    record(url, False)
    finish(t + 99_999)
    assert allowed(url, t + 99_999), "one success resets the host"
    record("https://viktorych-accounts.example.workers.dev/x", False)
    for _ in range(5):
        finish(t)
    assert allowed("https://viktorych-accounts.example.workers.dev/x", t), "our own hosts are never paused"
    load(dump())
    print("source breaker ok")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
