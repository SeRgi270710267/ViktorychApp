"""Fetch public post data without a third-party instance.

X uses the public syndication embed (one post: text, author, likes, reply
count). That payload has no reply bodies. YouTube comments come from the
public watch page's innertube continuation. Instagram uses oembed (caption
and author, no comment list). Threads uses the public mobile post page,
which includes visible replies. Nothing here sends a cookie, calls the paid
X API, or retries a rate limit.
"""

from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.common import post_shell  # noqa: E402
from adapters.threads_replies import parse_threads_document  # noqa: E402
from x_guard import assert_not_x_api, open_url  # noqa: E402

UA = "rss-feeds-preview/1.0 (+https://github.com/owner-account/rss-feeds)"
MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
REPLY_CAP = 20
TEXT_CAP = 500
RECENT_DAYS = 14
FILE_CAP = 8
YT_CAP = 2
FALLBACK_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
_REL = re.compile(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago", re.I)
_UNITS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
    "week": 7 * 86400,
    "month": 30 * 86400,
    "year": 365 * 86400,
}


def now_iso(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_iso(value, moment: datetime | None = None) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        stamp = int(value)
        if stamp > 10**12:
            stamp //= 1000
        if stamp > 10**9:
            return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) >= 20 and text[4] == "-" and "T" in text:
        return text.replace("+00:00", "Z")
    lowered = text.lower()
    if lowered in ("just now", "now"):
        return now_iso(moment)
    if lowered == "yesterday":
        return now_iso((moment or datetime.now(timezone.utc)) - timedelta(days=1))
    match = _REL.search(text)
    if match:
        base = moment or datetime.now(timezone.utc)
        seconds = int(match.group(1)) * _UNITS[match.group(2).lower()]
        return now_iso(base - timedelta(seconds=seconds))
    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError, OverflowError):
        parsed = None
    if parsed is not None:
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return ""


def _count(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and value >= 0 and float(value).is_integer():
        return int(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if text.isdigit():
            return int(text)
    return None


def _read(url: str, headers: dict | None = None, data: bytes | None = None, timeout: int = 20, limit: int = 2_000_000) -> tuple[int, str]:
    assert_not_x_api(url)
    req_headers = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        req_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=req_headers)
    try:
        with open_url(request, timeout=timeout) as response:
            status = getattr(response, "status", 200) or 200
            body = response.read(limit)
            return status, body.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        raw = exc.read(8000)
        return exc.code, raw.decode("utf-8", "replace")


def _clip(text: str) -> str:
    text = text or ""
    return text if len(text) <= TEXT_CAP else text[:TEXT_CAP]


def trim_pack(pack: dict) -> dict:
    replies = []
    for row in (pack.get("replies") or [])[:REPLY_CAP]:
        if not isinstance(row, dict):
            continue
        item = dict(row)
        item["text"] = _clip(item.get("text") or "")
        kids = []
        for child in (item.get("replies") or item.pop("_children", None) or [])[:REPLY_CAP]:
            if not isinstance(child, dict):
                continue
            kid = dict(child)
            kid.pop("_children", None)
            kid["text"] = _clip(kid.get("text") or "")
            kids.append(kid)
        if kids:
            item["replies"] = kids
        else:
            item.pop("replies", None)
        replies.append(item)
    pack["replies"] = replies
    if pack.get("text"):
        pack["text"] = _clip(pack["text"])
    return pack


def parse_syndication(payload: dict, post_id: str = "") -> dict:
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    likes = _count(payload.get("favorite_count"))
    replies = _count(payload.get("conversation_count"))
    stats = {}
    if likes is not None:
        stats["likes"] = likes
    if replies is not None:
        stats["replies"] = replies
    text = payload.get("text") or ""
    return {
        "postId": str(payload.get("id_str") or post_id or ""),
        "platform": "x",
        "source": "own:syndication",
        "replies": [],
        "stats": stats,
        "text": text,
        "author": user.get("name") or "",
        "handle": user.get("screen_name") or "",
        "date": to_iso(payload.get("created_at")),
        "avatar": user.get("profile_image_url_https") or "",
        "note": "public embed has no reply list",
    }


def _comment_token(html: str) -> str:
    """The comment continuation is a public token inside the watch page."""
    found = re.findall(
        r'"continuationCommand":\{"token":"(Eg[^"\\]+)","request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"',
        html or "",
    )
    panel = ""
    generic = ""
    for item in found:
        text = item.replace("%3D", "=").replace("%3d", "=")
        try:
            raw = base64.urlsafe_b64decode(text + "=" * ((4 - len(text) % 4) % 4))
        except (ValueError, TypeError):
            raw = b""
        if b"engagement-panel-comments-section" in raw and not panel:
            panel = item
        elif b"comments-section" in raw and not generic:
            generic = item
    if panel or generic:
        return panel or generic
    index = (html or "").find("engagement-panel-comments-section")
    if index < 0:
        return ""
    window = html[max(0, index - 2500):index + 5000]
    near = re.search(r'"token":"(Eg[^"\\]+)"', window)
    return near.group(1) if near else ""


def extract_watch(html: str) -> dict:
    key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html or "")
    version = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html or "")
    return {
        "key": key.group(1) if key else "",
        "version": version.group(1) if version else "2.20251021.00.00",
        "token": _comment_token(html),
    }


def parse_innertube_comments(payload: dict, parent: dict | None = None, moment: datetime | None = None) -> list:
    parent = parent or {}
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    parent_handle = parent.get("handle") or ""
    mutations = (((payload or {}).get("frameworkUpdates") or {}).get("entityBatchUpdate") or {}).get("mutations") or []
    top = []
    last = None
    for mutation in mutations:
        if not isinstance(mutation, dict):
            continue
        entity = (mutation.get("payload") or {}).get("commentEntityPayload")
        if not isinstance(entity, dict):
            continue
        props = entity.get("properties") if isinstance(entity.get("properties"), dict) else {}
        content = props.get("content") if isinstance(props.get("content"), dict) else {}
        text = str(content.get("content") or "").strip()
        if not text:
            continue
        author = entity.get("author") if isinstance(entity.get("author"), dict) else {}
        toolbar = entity.get("toolbar") if isinstance(entity.get("toolbar"), dict) else {}
        likes = _count(toolbar.get("likeCountNotliked"))
        if likes is None:
            likes = _count(toolbar.get("likeCountLiked"))
        if likes is None:
            likes = _count(toolbar.get("likeCount"))
        reply_count = _count(toolbar.get("replyCount"))
        handle = author.get("displayName") or ""
        comment_id = str(props.get("commentId") or "")
        level = props.get("replyLevel") if isinstance(props.get("replyLevel"), int) else 0
        stats = {}
        if likes is not None:
            stats["likes"] = likes
        if reply_count is not None:
            stats["replies"] = reply_count
        when = to_iso(props.get("publishedTime"), moment)
        row = post_shell(
            id=comment_id,
            statusId=comment_id,
            platform="youtube",
            kind="reply",
            author=handle,
            handle=handle,
            avatar=author.get("avatarThumbnailUrl") or "",
            text=text,
            date=when,
            url="https://www.youtube.com/watch?v=" + parent_id if parent_id else "",
            stats=stats,
            replyingTo={"handle": parent_handle, "id": parent_id} if parent_id or parent_handle else None,
        )
        if not when and props.get("publishedTime"):
            row["timeLabel"] = str(props.get("publishedTime"))
        if level > 0 and last is not None:
            last.setdefault("replies", []).append(row)
        else:
            top.append(row)
            last = row
    return top


def parse_ig_oembed(payload: dict, code: str = "") -> dict:
    title = payload.get("title") or ""
    author = payload.get("author_name") or ""
    thumb = payload.get("thumbnail_url") or ""
    media = []
    if isinstance(thumb, str) and thumb.startswith("https://"):
        media.append({"type": "photo", "url": thumb, "poster": thumb, "alt": ""})
    return {
        "postId": str(code or payload.get("media_id") or ""),
        "platform": "instagram",
        "source": "own:oembed",
        "replies": [],
        "text": title,
        "author": author,
        "handle": author,
        "media": media,
        "mediaId": str(payload.get("media_id") or ""),
        "note": "oembed has the caption and thumbnail, not the comment list",
    }


def _shortcode(post: dict) -> str:
    match = re.search(r"/(?:p|reel|tv)/([A-Za-z0-9_-]+)", post.get("url") or "")
    if match:
        return match.group(1)
    status = str(post.get("statusId") or post.get("id") or "")
    if re.fullmatch(r"[A-Za-z0-9_-]{5,}", status) and not status.isdigit():
        return status
    return ""


def _safe_name(post: dict) -> str:
    status = str(post.get("statusId") or post.get("id") or "")
    if post.get("platform") == "youtube" and post.get("kind") != "community":
        status = "yt_" + status
    if not status or status in (".", "..") or "/" in status or "\\" in status:
        return ""
    return status + ".json"


def _age_days(post: dict, moment: datetime) -> float | None:
    raw = str(post.get("date") or "")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (moment - parsed).total_seconds() / 86400


def select_recent(posts: list, moment: datetime | None = None, limit: int = FILE_CAP) -> list:
    """Newest post of each platform within 14 days, then posts under 7 days."""
    moment = moment or datetime.now(timezone.utc)
    ranked = []
    for post in posts or []:
        if not isinstance(post, dict) or post.get("kind") == "community":
            continue
        age = _age_days(post, moment)
        if age is None or age < 0 or age > RECENT_DAYS:
            continue
        ranked.append((age, post))
    ranked.sort(key=lambda item: item[0])
    chosen = []
    seen_platform = set()
    for _age, post in ranked:
        platform = post.get("platform") or ""
        if platform in seen_platform:
            continue
        seen_platform.add(platform)
        chosen.append(post)
    chosen_ids = {str(post.get("id") or "") for post in chosen}
    for age, post in ranked:
        if len(chosen) >= limit:
            break
        if age >= 7 or str(post.get("id") or "") in chosen_ids:
            continue
        if post.get("platform") == "youtube" and sum(1 for item in chosen if item.get("platform") == "youtube") >= YT_CAP:
            continue
        chosen_ids.add(str(post.get("id") or ""))
        chosen.append(post)
    return chosen[:limit]


def fetch_x_post(post_id: str) -> dict | None:
    post_id = str(post_id or "")
    if not post_id.isdigit():
        return None
    url = "https://cdn.syndication.twimg.com/tweet-result?" + urllib.parse.urlencode({"id": post_id, "lang": "en", "token": "0"})
    status, body = _read(url, timeout=12)
    if status == 429 or status != 200 or not body.lstrip().startswith("{"):
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or not (payload.get("text") or payload.get("id_str")):
        return None
    pack = parse_syndication(payload, post_id)
    pack["fetchedAt"] = now_iso()
    return trim_pack(pack)


def fetch_youtube_comments(video_id: str, parent: dict | None = None) -> dict | None:
    video_id = str(video_id or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,}", video_id):
        return None
    page_url = "https://www.youtube.com/watch?" + urllib.parse.urlencode({"v": video_id, "hl": "en"})
    status, html = _read(page_url, {"User-Agent": BROWSER, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html"}, timeout=25, limit=2_500_000)
    if status != 200 or "INNERTUBE_API_KEY" not in html:
        return None
    watch = extract_watch(html)
    key = watch["key"] or FALLBACK_KEY
    if not watch["token"]:
        return {
            "postId": "yt_" + video_id,
            "platform": "youtube",
            "source": "own:innertube",
            "fetchedAt": now_iso(),
            "replies": [],
            "note": "watch page had no public comment continuation",
        }
    body = json.dumps(
        {
            "context": {"client": {"clientName": "WEB", "clientVersion": watch["version"], "hl": "en", "gl": "US"}},
            "continuation": watch["token"],
        }
    ).encode("utf-8")
    url = "https://www.youtube.com/youtubei/v1/next?key=" + urllib.parse.quote(key) + "&prettyPrint=false"
    post_status, raw = _read(
        url,
        {"User-Agent": BROWSER, "Content-Type": "application/json", "Accept": "application/json"},
        data=body,
        timeout=20,
    )
    if post_status == 429 or post_status != 200 or not raw.lstrip().startswith("{"):
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    parent = dict(parent or {})
    parent.setdefault("statusId", video_id)
    parent.setdefault("id", video_id)
    replies = parse_innertube_comments(payload, parent)
    return trim_pack(
        {
            "postId": "yt_" + video_id,
            "platform": "youtube",
            "source": "own:innertube",
            "fetchedAt": now_iso(),
            "replies": replies,
            "note": "innertube comments",
        }
    )


def fetch_instagram_oembed(post: dict) -> dict | None:
    code = _shortcode(post)
    if not code:
        return None
    target = "https://www.instagram.com/p/" + code + "/"
    url = "https://www.instagram.com/api/v1/oembed/?url=" + urllib.parse.quote(target, safe="")
    status, body = _read(url, {"User-Agent": BROWSER, "Accept": "application/json"}, timeout=12)
    if status == 429 or status != 200 or not body.lstrip().startswith("{"):
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or not (payload.get("title") or payload.get("author_name")):
        return None
    pack = parse_ig_oembed(payload, code)
    pack["postId"] = str(post.get("statusId") or post.get("id") or code)
    pack["fetchedAt"] = now_iso()
    return trim_pack(pack)


def fetch_threads_post(post: dict) -> dict | None:
    handle = (post.get("handle") or "").lstrip("@")
    code = ""
    match = re.search(r"/(?:post|t)/([^/?#]+)", post.get("url") or "")
    if match:
        code = match.group(1)
    if not code:
        code = str(post.get("statusId") or post.get("id") or "")
    if not code or not handle:
        return None
    url = f"https://www.threads.com/@{urllib.parse.quote(handle)}/post/{urllib.parse.quote(code)}"
    status, html = _read(url, {"User-Agent": MOBILE, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9"}, timeout=20)
    if status == 429 or status != 200 or code not in html:
        return None
    replies, count = parse_threads_document(html, post)
    stats = {}
    if isinstance(count, int) and not isinstance(count, bool):
        stats["replies"] = count
    return trim_pack(
        {
            "postId": str(post.get("statusId") or post.get("id") or code),
            "platform": "threads",
            "source": "own:threads",
            "fetchedAt": now_iso(),
            "replies": replies,
            "stats": stats,
            "note": "visible replies on the public mobile post page" if replies else "public page had no reply text",
        }
    )


def fetch_for_post(post: dict) -> dict | None:
    platform = post.get("platform") or ""
    if platform == "x":
        return fetch_x_post(str(post.get("statusId") or post.get("id") or ""))
    if platform == "youtube":
        return fetch_youtube_comments(str(post.get("statusId") or post.get("id") or ""), post)
    if platform == "instagram":
        return fetch_instagram_oembed(post)
    if platform == "threads":
        return fetch_threads_post(post)
    return None


def apply_pack(post: dict, pack: dict) -> None:
    """Refresh text and counts the public payload actually contains."""
    if not pack:
        return
    text = (pack.get("text") or "").strip()
    if text and post.get("platform") in ("x", "instagram"):
        post["text"] = text
    stats = pack.get("stats") or {}
    if not stats:
        return
    current = post.setdefault("stats", {})
    for key in ("likes", "replies", "reposts"):
        value = stats.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            current[key] = value


def write_fallbacks(posts: list, dest: Path | None = None, moment: datetime | None = None) -> int:
    dest = dest or (ROOT / "fallback")
    chosen = select_recent(posts, moment)
    if dest.exists():
        for old in dest.glob("*.json"):
            old.unlink()
    written = 0
    for post in chosen:
        try:
            pack = fetch_for_post(post)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            print(f"[fallback] {post.get('platform')}:{post.get('id')}: {exc}", file=sys.stderr)
            continue
        if not pack:
            print(f"[fallback] {post.get('platform')}:{post.get('id')}: no public payload", file=sys.stderr)
            continue
        apply_pack(post, pack)
        name = _safe_name(post)
        if not name:
            continue
        dest.mkdir(parents=True, exist_ok=True)
        (dest / name).write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written += 1
        print(f"[fallback] {name} {len(pack.get('replies') or [])} via {pack.get('source')}")
    return written
