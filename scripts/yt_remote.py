"""Invidious and Piped helpers for YouTube durations, subscribers, and comments.

Instances come from https://api.invidious.io/instances.json. A failed host is
skipped and the next one is tried. Nothing here invents a count.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.x_replies import merge_replies  # noqa: E402
from site_paths import user_agent  # noqa: E402
from x_guard import assert_not_x_api, open_url  # noqa: E402

UA = user_agent()
INSTANCES = "https://api.invidious.io/instances.json"
PIPED_SEEDS = (
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.private.coffee",
    "https://pipedapi.reallyaweso.me",
    "https://pipedapi.leptons.xyz",
    "https://api.piped.projectsegfau.lt",
    "https://pipedapi.darkness.services",
    "https://pipedapi.syncpundit.io",
    "https://pa.mint.lgbt",
    "https://pipedapi.tokhmi.xyz",
    "https://api.piped.yt",
)
_IV = {"bases": None}
_PIPED = {"bases": None}
_CHANNELS = {}
_DEAD = set()
_VIDEO_API_DOWN = False


def _get_json(url: str, timeout: int = 18):
    assert_not_x_api(url)
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with open_url(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def invidious_bases() -> list[str]:
    if _IV["bases"] is not None:
        return _IV["bases"]
    bases = []
    try:
        rows = _get_json(INSTANCES, timeout=20)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[youtube] instances: {exc}", file=sys.stderr)
        rows = []
    for item in rows or []:
        if not isinstance(item, list) or len(item) < 2:
            continue
        meta = item[1] or {}
        if meta.get("type") != "https" or not meta.get("api"):
            continue
        uri = (meta.get("uri") or "").rstrip("/")
        if uri.startswith("https://"):
            bases.append(uri)
    _IV["bases"] = bases
    return bases


def piped_bases() -> list[str]:
    if _PIPED["bases"] is not None:
        return _PIPED["bases"]
    _PIPED["bases"] = list(PIPED_SEEDS)
    return _PIPED["bases"]


def _rotate(bases: list[str], path: str):
    global _VIDEO_API_DOWN
    if path.startswith("/api/v1/videos/") and _VIDEO_API_DOWN:
        return None, ""
    last = None
    alive = [base for base in bases if base not in _DEAD]
    for base in alive:
        url = base.rstrip("/") + path
        try:
            payload = _get_json(url, timeout=12)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            last = exc
            if "/api/v1/videos/" in path and "500" in str(exc):
                _VIDEO_API_DOWN = True
                print(f"[youtube] video API unavailable: {exc}", file=sys.stderr)
                return None, ""
            _DEAD.add(base)
            continue
        if base in bases:
            bases.remove(base)
            bases.insert(0, base)
        return payload, base
    if last and not path.startswith("/api/v1/videos/"):
        print(f"[youtube] {path}: {last}", file=sys.stderr)
    return None, ""


def invidious_get(path: str):
    return _rotate(invidious_bases(), path)


def piped_get(path: str):
    return _rotate(piped_bases(), path)


def resolve_channel_id(handle: str) -> str:
    handle = (handle or "").lstrip("@").strip()
    if not handle:
        return ""
    url = f"https://www.youtube.com/@{urllib.parse.quote(handle)}"
    assert_not_x_api(url)
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with open_url(request, timeout=25) as response:
            html = response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[youtube] resolve @{handle}: {exc}", file=sys.stderr)
        return ""
    import re

    found = re.search(r"youtube\.com/channel/(UC[\w-]{22})", html)
    return found.group(1) if found else ""


def _iso(value) -> str:
    if isinstance(value, (int, float)) and value > 10**9:
        return datetime.fromtimestamp(int(value), timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return ""


def _largest_thumb(thumbs) -> str:
    best = ""
    best_w = -1
    for thumb in thumbs or []:
        if isinstance(thumb, str) and not best:
            best = thumb
            continue
        if not isinstance(thumb, dict):
            continue
        url = thumb.get("url") or ""
        try:
            width = int(thumb.get("width") or 0)
        except (TypeError, ValueError):
            width = 0
        if url and width >= best_w:
            best = url
            best_w = width
    return best


def _positive(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def channel_payload(channel_id: str):
    if not channel_id:
        return None, ""
    if channel_id in _CHANNELS:
        return _CHANNELS[channel_id]
    payload, base = invidious_get(f"/api/v1/channels/{urllib.parse.quote(channel_id)}")
    _CHANNELS[channel_id] = (payload, base)
    return payload, base


def _lengths(payload: dict) -> dict:
    found = {}
    for video in (payload or {}).get("latestVideos") or []:
        vid = video.get("videoId") or ""
        length = video.get("lengthSeconds")
        if vid and isinstance(length, int) and length >= 0:
            found[vid] = length
    return found


def _apply_duration(post: dict, seconds) -> None:
    if seconds is None:
        return
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        return
    if seconds < 0:
        return
    media = (post.get("media") or [None])[0]
    if not isinstance(media, dict):
        return
    media["duration"] = seconds
    # One instance's itag=18 URL dies often. The player rotates instances itself.
    media.pop("stream", None)
    post["short"] = seconds <= 60


def enrich_youtube(posts: list, profiles: list, feed: dict) -> None:
    channel_id = feed.get("channelId") or ""
    payload, base = channel_payload(channel_id)
    lengths = _lengths(payload or {})
    if payload:
        for profile in profiles:
            if (profile.get("handle") or "").lower() != (feed.get("handle") or "").lower():
                continue
            subs = _positive(payload.get("subCount"))
            if subs is not None:
                profile["followers"] = subs
            avatar = _largest_thumb(payload.get("authorThumbnails"))
            if avatar:
                profile["avatar"] = avatar
            if payload.get("authorVerified"):
                profile["verifiedType"] = "blue"
            banners = payload.get("authorBanners") or []
            banner = _largest_thumb(banners)
            if banner:
                profile["banner"] = banner
            if payload.get("description"):
                profile["bio"] = payload.get("description")
    avatar = ""
    verified = None
    for profile in profiles:
        if (profile.get("handle") or "").lower() == (feed.get("handle") or "").lower():
            avatar = profile.get("avatar") or avatar
            verified = profile.get("verifiedType") or verified
    for post in posts:
        if avatar and not post.get("avatar"):
            post["avatar"] = avatar
        if verified and not post.get("verifiedType"):
            post["verifiedType"] = verified
        video_id = str(post.get("statusId") or post.get("id") or "")
        if video_id in lengths:
            _apply_duration(post, lengths[video_id])
            continue
        video, video_base = invidious_get(f"/api/v1/videos/{urllib.parse.quote(video_id)}")
        if video and video.get("lengthSeconds") is not None:
            _apply_duration(post, video.get("lengthSeconds"))
            likes = _positive(video.get("likeCount"))
            if likes is not None:
                post.setdefault("stats", {})["likes"] = likes
            views = _positive(video.get("viewCount"))
            if views is not None:
                post.setdefault("stats", {})["views"] = views
            continue
        piped, piped_base = piped_get(f"/streams/{urllib.parse.quote(video_id)}")
        if not piped:
            continue
        _apply_duration(post, piped.get("duration"))
        views = _positive(piped.get("views"))
        if views is not None:
            post.setdefault("stats", {})["views"] = views
        likes = _positive(piped.get("likes"))
        if likes is not None:
            post.setdefault("stats", {})["likes"] = likes


def carry_youtube_fields(posts: list, previous: list, saved_profile: dict | None) -> None:
    """Keep avatar, verification, and duration when a later channel fetch misses them."""
    old = {str(item.get("id") or ""): item for item in previous or []}
    saved = saved_profile or {}
    avatar = saved.get("avatar") or ""
    verified = saved.get("verifiedType")
    for post in posts:
        prev = old.get(str(post.get("id") or ""), {})
        if not post.get("avatar"):
            post["avatar"] = prev.get("avatar") or avatar or ""
        if not post.get("verifiedType"):
            kept = prev.get("verifiedType") or verified
            if kept:
                post["verifiedType"] = kept
        media = (post.get("media") or [None])[0]
        old_media = (prev.get("media") or [None])[0]
        if not isinstance(media, dict) or not isinstance(old_media, dict):
            continue
        if not media.get("duration") and old_media.get("duration"):
            media["duration"] = old_media["duration"]
            post["short"] = int(old_media["duration"]) <= 60
        media.pop("stream", None)


def normalize_invidious_comment(comment: dict, parent_id: str, handle: str) -> dict:
    info = comment.get("replies") or {}
    try:
        reply_count = int(info.get("replyCount") or 0)
    except (TypeError, ValueError):
        reply_count = 0
    try:
        likes = int(comment.get("likeCount") or 0)
    except (TypeError, ValueError):
        likes = 0
    author = (comment.get("author") or "").lstrip("@")
    row = {
        "id": comment.get("commentId") or "",
        "statusId": comment.get("commentId") or "",
        "platform": "youtube",
        "kind": "reply",
        "author": author,
        "handle": author,
        "avatar": comment.get("authorThumbnail") or "",
        "verifiedType": "blue" if comment.get("verified") else None,
        "text": comment.get("content") or "",
        "date": _iso(comment.get("published")),
        "stats": {"likes": likes, "replies": reply_count},
        "replies": [],
        "replyingTo": {"id": parent_id, "handle": handle},
    }
    if not row["date"] and comment.get("publishedText"):
        row["timeLabel"] = comment.get("publishedText")
    continuation = info.get("continuation") or ""
    if continuation:
        row["_continuation"] = continuation
    return row


def normalize_piped_comment(comment: dict, parent_id: str, handle: str, depth: int = 0) -> dict:
    author = (comment.get("author") or "").lstrip("@")
    try:
        likes = int(comment.get("likeCount") or 0)
    except (TypeError, ValueError):
        likes = 0
    try:
        reply_count = int(comment.get("replyCount") or 0)
    except (TypeError, ValueError):
        reply_count = 0
    row = {
        "id": comment.get("commentId") or "",
        "statusId": comment.get("commentId") or "",
        "platform": "youtube",
        "kind": "reply",
        "author": author,
        "handle": author,
        "avatar": comment.get("thumbnail") or "",
        "verifiedType": None,
        "text": comment.get("commentText") or comment.get("comment") or "",
        "date": "",
        "stats": {"likes": likes, "replies": reply_count},
        "replies": [],
        "replyingTo": {"id": parent_id, "handle": handle},
    }
    if comment.get("commentedTime"):
        row["timeLabel"] = comment.get("commentedTime")
    if comment.get("repliesPage"):
        row["_continuation"] = comment.get("repliesPage")
    inline = comment.get("replies") if depth == 0 else None
    if isinstance(inline, list) and inline:
        kids = []
        for child in inline[:20]:
            if not isinstance(child, dict):
                continue
            text = child.get("commentText") or child.get("comment") or ""
            if not str(text).strip():
                continue
            kids.append(normalize_piped_comment(child, row["id"], author, depth=1))
        if kids:
            row["replies"] = kids
    return row


def _strip(rows: list) -> list:
    clean = []
    for row in rows:
        item = dict(row)
        item.pop("_continuation", None)
        item["replies"] = _strip(item.get("replies") or [])
        clean.append(item)
    return clean


def _page_invidious(video_id: str, sort: str, continuation: str = ""):
    query = {"sort_by": sort}
    if continuation:
        query["continuation"] = continuation
    path = f"/api/v1/comments/{urllib.parse.quote(video_id)}?{urllib.parse.urlencode(query)}"
    payload, _base = invidious_get(path)
    return payload


def _reply_count(row: dict) -> int:
    try:
        return int((row.get("stats") or {}).get("replies") or 0)
    except (TypeError, ValueError):
        return 0


def _fill_replies(rows: list, video_id: str, handle: str, budget: int) -> int:
    """One continuation page for the most-replied comments. No third level."""
    ranked = [
        row for row in rows
        if _reply_count(row) > 0 and (row.get("_continuation") or "")
    ]
    ranked.sort(key=lambda row: (_reply_count(row), int((row.get("stats") or {}).get("likes") or 0)), reverse=True)
    for row in ranked[:10]:
        if budget <= 0:
            break
        token = row.get("_continuation") or ""
        payload = _page_invidious(video_id, "top", token)
        budget -= 1
        if not payload:
            continue
        children = []
        for child in (payload.get("comments") or [])[:20]:
            if not (child.get("content") or "").strip():
                continue
            children.append(normalize_invidious_comment(child, row.get("id") or "", row.get("handle") or handle))
        row["replies"] = children
    return budget


def fetch_comment_document(post: dict, limit: int = 100) -> dict | None:
    video_id = str(post.get("statusId") or post.get("id") or "")
    handle = post.get("handle") or ""
    if not video_id:
        return None
    top = []
    newest = []
    count = None
    source = ""
    continuation = ""
    for _ in range(6):
        if len(top) >= limit:
            break
        payload = _page_invidious(video_id, "top", continuation)
        if not payload:
            break
        source = "invidious"
        if payload.get("commentCount") is not None:
            try:
                count = int(payload.get("commentCount"))
            except (TypeError, ValueError):
                pass
        batch = payload.get("comments") or []
        for comment in batch:
            if (comment.get("content") or "").strip():
                top.append(normalize_invidious_comment(comment, video_id, handle))
        continuation = payload.get("continuation") or ""
        if not continuation or not batch:
            break
    if top:
        _fill_replies(top, video_id, handle, 10)
        fresh = _page_invidious(video_id, "new")
        if fresh:
            for comment in (fresh.get("comments") or [])[:limit]:
                if (comment.get("content") or "").strip():
                    newest.append(normalize_invidious_comment(comment, video_id, handle))
    if not top:
        piped, _base = piped_get(f"/comments/{urllib.parse.quote(video_id)}")
        if not piped:
            return None
        source = "piped"
        if piped.get("commentCount") is not None or piped.get("commentsCount") is not None:
            try:
                count = int(piped.get("commentCount") if piped.get("commentCount") is not None else piped.get("commentsCount"))
            except (TypeError, ValueError):
                count = None
        for comment in (piped.get("comments") or [])[:limit]:
            text = comment.get("commentText") or comment.get("comment") or ""
            if str(text).strip():
                top.append(normalize_piped_comment(comment, video_id, handle))
    if not top and count is None:
        return None
    doc = {
        "postId": "yt_" + video_id,
        "platform": "youtube",
        "source": source or "invidious",
        "replies": _strip(top[:limit]),
    }
    if newest:
        doc["newest"] = _strip(newest[:limit])
    if count is not None:
        doc["commentCount"] = count
    return doc


def _safe_comment_id(value) -> str:
    text = str(value or "")
    if not text or text in {".", ".."} or "/" in text or "\\" in text:
        return ""
    return text


def _write_thread_files(rows: list, source: str, fetched_at: str) -> None:
    dest = ROOT / "comments"
    dest.mkdir(parents=True, exist_ok=True)
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        kids = [kid for kid in (row.get("replies") or []) if isinstance(kid, dict)][:20]
        cid = _safe_comment_id(row.get("statusId") or row.get("id") or "")
        if not cid or not kids:
            continue
        path = dest / f"{cid}.json"
        stored = []
        if path.exists():
            try:
                stored = (json.loads(path.read_text(encoding="utf-8")).get("replies") or [])
            except (OSError, json.JSONDecodeError):
                stored = []
        thread = {
            "postId": cid,
            "platform": "youtube",
            "source": source,
            "fetchedAt": fetched_at,
            "replies": merge_replies(stored, kids),
        }
        path.write_text(json.dumps(thread, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_comment_document(post: dict, doc: dict) -> None:
    video_id = str(post.get("statusId") or post.get("id") or "")
    dest = ROOT / "comments"
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"yt_{video_id}.json"
    stored = {}
    if path.exists():
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            stored = {}
    written = dict(doc)
    written["replies"] = merge_replies(stored.get("replies") or [], doc.get("replies") or [])
    if doc.get("newest"):
        written["newest"] = merge_replies(stored.get("newest") or [], doc.get("newest") or [])
    written["fetchedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    path.write_text(json.dumps(written, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_thread_files(written.get("replies") or [], written.get("source") or "", written["fetchedAt"])
    print(f"[replies] youtube:{video_id} {len(written.get('replies') or [])} via {written.get('source')}")


def refresh_comments(post: dict, use_fixtures: bool) -> None:
    video_id = str(post.get("statusId") or post.get("id") or "")
    if use_fixtures:
        fixture = Path(__file__).resolve().parent / "fixtures" / "replies" / f"yt_{video_id}.json"
        if not fixture.exists():
            return
        doc = json.loads(fixture.read_text(encoding="utf-8"))
    else:
        try:
            doc = fetch_comment_document(post)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"[replies] youtube {video_id}: {exc}", file=sys.stderr)
            return
        if doc is None:
            print(f"[replies] youtube {video_id}: no comments from Invidious or Piped", file=sys.stderr)
            return
    if doc.get("commentCount") is not None:
        stats = post.setdefault("stats", {})
        stats["replies"] = doc["commentCount"]
    write_comment_document(post, doc)
