"""Probe third-party instances and our own fetchers. Writes status.json.

A down row is a host the browser should skip. The build still succeeds when
a probe fails. Local RSSHub is the only RSSHub host; public mirrors are not
contacted. Instagram's user route may be down without INSTAGRAM_COOKIE, and
that is reported as down rather than hidden.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from own_fetch import (  # noqa: E402
    fetch_instagram_oembed,
    fetch_threads_post,
    fetch_x_post,
    fetch_youtube_comments,
)
from site_paths import user_agent  # noqa: E402
from x_guard import assert_not_x_api, open_url  # noqa: E402

UA = user_agent()
FX = "https://api.fxtwitter.com"
IV_SEEDS = (
    "https://invidious.f5.si",
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://yt.artemislena.eu",
)
PIPED_SEEDS = (
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.private.coffee",
    "https://pipedapi.leptons.xyz",
)
NITTER_HOSTS = (
    "https://nitter.meowing.monster",
    "https://nitter.kareem.one",
    "https://nitter.jaydenha.uk",
)
SAMPLE_X = "2112600761762717997"
SAMPLE_YT = "xtrFOsncOeo"
SAMPLE_IG = {"url": "https://www.instagram.com/p/DeZgzTEggQe/", "handle": "redacted_handle", "statusId": "DeZgzTEggQe", "platform": "instagram"}
SAMPLE_THREADS = {"url": "https://www.threads.com/@redacted_handle/post/DeZtrvAEfEr", "handle": "redacted_handle", "statusId": "DeZtrvAEfEr", "platform": "threads"}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_status(rows: list, checked_at: str | None = None) -> dict:
    down = []
    sources = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        sources.append(
            {
                "id": row.get("id") or "",
                "group": row.get("group") or "",
                "up": bool(row.get("up")),
                "detail": row.get("detail") or "",
            }
        )
        token = row.get("down")
        if token and not row.get("up") and token not in down:
            down.append(token)
    return {"checkedAt": checked_at or now_iso(), "down": down, "sources": sources}


def _snip(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[:limit]


def _get(url: str, timeout: int = 8) -> tuple[int, str]:
    assert_not_x_api(url)
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with open_url(request, timeout=timeout) as response:
            status = getattr(response, "status", 200) or 200
            body = response.read(120000).decode("utf-8", "replace")
            return status, body
    except urllib.error.HTTPError as exc:
        body = exc.read(4000).decode("utf-8", "replace")
        return exc.code, body
    except Exception as exc:  # a dead host is a status row, not a failed build
        return 0, str(exc)


def _feed_ok(status: int, body: str) -> bool:
    if status < 200 or status >= 300:
        return False
    lowered = body.lower()
    return "<rss" in lowered or "<feed" in lowered or "<item" in lowered or "<entry" in lowered


def probe_fxtwitter() -> dict:
    status, body = _get(f"{FX}/status/{SAMPLE_X}", timeout=10)
    up = status == 200 and '"id"' in body and "tweet" in body.lower()
    detail = "public status API" if up else _snip(f"HTTP {status} {body[:80]}")
    return {"id": "fxtwitter", "group": "X", "up": up, "detail": detail, "down": "fxtwitter"}


def probe_nitter(base: str) -> dict:
    host = urllib.parse.urlparse(base).netloc
    status, body = _get(base + "/redacted_handle/rss", timeout=8)
    up = _feed_ok(status, body)
    return {"id": host, "group": "X", "up": up, "detail": "nitter RSS" if up else _snip(f"HTTP {status}")}


def probe_invidious(base: str) -> dict:
    host = urllib.parse.urlparse(base).netloc
    status, body = _get(base + "/api/v1/stats", timeout=8)
    up = status == 200 and body.lstrip().startswith("{")
    return {"id": host, "group": "YouTube", "up": up, "detail": "invidious API" if up else _snip(f"HTTP {status}"), "down": base}


def piped_payload_ok(status: int, body: str) -> bool:
    """Trending is a JSON list. A channel payload is a JSON object. Both are a live host."""
    text = (body or "").lstrip()
    return status == 200 and (text.startswith("{") or text.startswith("["))


def probe_piped(base: str) -> dict:
    host = urllib.parse.urlparse(base).netloc
    status, body = _get(base + "/trending?region=US", timeout=8)
    up = piped_payload_ok(status, body)
    if not up:
        status, body = _get(base + "/channel/UCXuqSBlHAE6Xw-yeJA0Tunw", timeout=8)
        up = piped_payload_ok(status, body) and '"name"' in body
    return {"id": host, "group": "YouTube", "up": up, "detail": "piped API" if up else _snip(f"HTTP {status}"), "down": base}


def probe_rsshub(base: str, path: str, label: str) -> dict:
    status, body = _get(base.rstrip("/") + path, timeout=12)
    up = _feed_ok(status, body)
    if up:
        detail = "local RSSHub"
    elif status in (401, 403) or "cookie" in body.lower() or "login" in body.lower():
        detail = "local route did not return a feed; a cookie may be required"
    else:
        detail = _snip(f"HTTP {status} {body[:80]}")
    return {"id": "rsshub " + label, "group": "RSSHub", "up": up, "detail": detail}


def probe_bridge(url: str, label: str) -> dict:
    status, body = _get(url, timeout=12)
    up = _feed_ok(status, body)
    return {"id": "rss-bridge " + label, "group": "RSS-Bridge", "up": up, "detail": "local bridge" if up else _snip(f"HTTP {status}")}


def probe_own_x() -> dict:
    try:
        pack = fetch_x_post(SAMPLE_X)
    except Exception as exc:
        pack = None
        detail = _snip(str(exc))
    else:
        detail = "post text and counts; public embed has no reply list" if pack and pack.get("text") else "syndication embed did not return the post"
    return {"id": "own:x", "group": "X", "up": bool(pack and pack.get("text")), "detail": detail}


def probe_own_youtube() -> dict:
    try:
        pack = fetch_youtube_comments(SAMPLE_YT, {"handle": "redacted_handle", "statusId": SAMPLE_YT, "platform": "youtube"})
    except Exception as exc:
        pack = None
        detail = _snip(str(exc))
    else:
        count = len((pack or {}).get("replies") or [])
        if count:
            detail = f"innertube comments ({count})"
        elif pack:
            detail = pack.get("note") or "innertube returned no comments"
        else:
            detail = "innertube comments did not load"
    return {"id": "own:youtube", "group": "YouTube", "up": bool(pack and (pack.get("replies") or pack.get("note"))), "detail": detail}


def probe_own_instagram() -> dict:
    try:
        pack = fetch_instagram_oembed(SAMPLE_IG)
    except Exception as exc:
        pack = None
        detail = _snip(str(exc))
    else:
        detail = "oembed caption, no public comment list" if pack and pack.get("text") else "oembed did not return the caption"
    return {"id": "own:instagram", "group": "Instagram", "up": bool(pack and pack.get("text")), "detail": detail}


def probe_own_vk() -> dict:
    try:
        from vk_remote import wall_document

        document = wall_document("vk", 1)
        items = ((document.get("response") or {}).get("items") or [])
        up = bool(items)
        detail = "public wall" if up else "wall.get returned no posts"
    except Exception as exc:
        up = False
        detail = _snip(str(exc))
    return {"id": "own:vk", "group": "VK", "up": up, "detail": detail}


def probe_own_threads() -> dict:
    try:
        pack = fetch_threads_post(SAMPLE_THREADS)
    except Exception as exc:
        pack = None
        detail = _snip(str(exc))
    else:
        count = len((pack or {}).get("replies") or [])
        if count:
            detail = f"public mobile post page ({count} replies)"
        elif pack:
            detail = "public page loaded; no reply text in this response"
        else:
            detail = "public post page did not load"
    return {"id": "own:threads", "group": "Threads", "up": bool(pack), "detail": detail}


def _rsshub_base() -> str:
    path = ROOT / "feeds.config.json"
    base = "http://localhost:1200"
    if path.exists():
        try:
            base = json.loads(path.read_text(encoding="utf-8")).get("rsshubBase") or base
        except json.JSONDecodeError:
            pass
    return str(base).rstrip("/")


def collect() -> list:
    jobs = [probe_fxtwitter, probe_own_x, probe_own_youtube, probe_own_instagram, probe_own_threads, probe_own_vk]
    for base in NITTER_HOSTS:
        jobs.append(lambda base=base: probe_nitter(base))
    for base in IV_SEEDS:
        jobs.append(lambda base=base: probe_invidious(base))
    for base in PIPED_SEEDS:
        jobs.append(lambda base=base: probe_piped(base))
    rsshub = _rsshub_base()
    routes = (
        ("/threads/redacted_handle", "threads/:user"),
        ("/threads/redacted_handle/post/DeZtrvAEfEr", "threads/:user/post/:id"),
        ("/instagram/user/redacted_handle", "instagram/user/:id"),
        ("/youtube/community/redacted_handle", "youtube/community/:id"),
    )
    for path, label in routes:
        jobs.append(lambda path=path, label=label, rsshub=rsshub: probe_rsshub(rsshub, path, label))
    bridge = "http://localhost:8080/?action=display&bridge={bridge}&context=Username&u=redacted_handle&format=Atom"
    for name in ("InstagramBridge", "ThreadsBridge"):
        jobs.append(lambda name=name: probe_bridge(bridge.format(bridge=name), name))
    rows = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        pending = [pool.submit(job) for job in jobs]
        for item in as_completed(pending):
            try:
                rows.append(item.result())
            except Exception as exc:
                rows.append({"id": "probe", "group": "Health", "up": False, "detail": _snip(str(exc))})
    rows.sort(key=lambda row: ((row or {}).get("group") or "", (row or {}).get("id") or ""))
    return rows


def write_status(dest: Path | None = None) -> Path:
    dest = dest or (ROOT / "status.json")
    document = build_status(collect())
    dest.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    up = sum(1 for row in document["sources"] if row["up"])
    print(f"[health] {up}/{len(document['sources'])} up, {len(document['down'])} skipped by the browser")
    return dest
