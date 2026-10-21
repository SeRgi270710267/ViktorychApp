"""Fetch public post data without a third-party instance.

X uses the public syndication embed (one post: text, author, likes, reply
count). That payload has no reply bodies. YouTube video comments come from
the public watch page's innertube continuation: the token whose payload names
the comments panel, then `youtubei/v1/next` on www.youtube.com and, if that
returns no comments, on m.youtube.com. Community post comments come from the
public post page (`youtube.com/post/<id>`, or the channel posts page when
that page has no token). The continuation is the one next to the comments
section, with or without `CONTINUATION_REQUEST_TYPE_BROWSE`, then
`youtubei/v1/browse` (or `next` when the page names that). One extra comment
page is loaded when the first page is short, and one reply page is loaded
for a few threads. Instagram uses oembed (caption and author, no comment
list). Threads uses the public mobile post page, which includes visible
replies. Nothing here sends a cookie, calls the paid X API, solves a bot
check, or retries a rate limit.
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
from site_paths import user_agent  # noqa: E402
from x_guard import assert_not_x_api, open_url  # noqa: E402

UA = user_agent()
MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
REPLY_CAP = 20
TEXT_CAP = 500
RECENT_DAYS = 14
FILE_CAP = 8
YT_CAP = 2
REPLY_PAGES = 4
COMMUNITY_CAP = 8
COMMUNITY_FEED_CAP = 6
YT_NEXT_HOSTS = ("https://www.youtube.com", "https://m.youtube.com")
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


def _token_text(token: str) -> str:
    text = token or ""
    text = text.replace("\\u003d", "=").replace("\\u003D", "=")
    return urllib.parse.unquote(text)


def _token_bytes(token: str) -> bytes:
    text = _token_text(token)
    try:
        return base64.urlsafe_b64decode(text + "=" * ((4 - len(text) % 4) % 4))
    except (ValueError, TypeError):
        return b""


def _comment_token(html: str) -> str:
    """The comment continuation is a public token inside the watch page.

    Current pages put the token on ``continuationCommand`` without a
    ``request`` field. The comments-panel token is preferred over the
    shorter comments-section token. Older pages still name
    ``CONTINUATION_REQUEST_TYPE_WATCH_NEXT`` on the same object.
    """
    html = html or ""
    found = re.findall(r'"continuationCommand":\{"token":"(Eg[^"\\]+)"', html)
    panel = ""
    generic = ""
    for item in found:
        raw = _token_bytes(item)
        if b"engagement-panel-comments-section" in raw and not panel:
            panel = _token_text(item)
        elif b"comments-section" in raw and not generic:
            generic = _token_text(item)
    if panel or generic:
        return panel or generic
    legacy = re.findall(
        r'"continuationCommand":\{"token":"(Eg[^"\\]+)","request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"',
        html,
    )
    if legacy:
        return _token_text(legacy[0])
    index = html.find("engagement-panel-comments-section")
    if index < 0:
        return ""
    window = html[max(0, index - 2500):index + 5000]
    near = re.search(r'"token":"(Eg[^"\\]+)"', window)
    return _token_text(near.group(1)) if near else ""


def _community_token(html: str) -> tuple[str, str]:
    """The comment continuation published on a community post page.

    The token sits on the comments section. Current pages name
    ``CONTINUATION_REQUEST_TYPE_BROWSE`` and ``/youtubei/v1/browse``.
    Older pages omit the request field. A token whose payload names the
    comment section is accepted either way. The endpoint is ``browse``
    unless that same window names ``/youtubei/v1/next``.
    """
    html = html or ""
    index = html.find('"targetId":"comments-section"')
    if index < 0:
        index = html.find("comment-item-section")
    if index >= 0:
        window = html[max(0, index - 2500):index]
        tokens = re.findall(r'"token":"([^"\\]+)"', window)
        if tokens:
            endpoint = "next" if "/youtubei/v1/next" in window and "/youtubei/v1/browse" not in window else "browse"
            return _token_text(tokens[-1]), endpoint
    paired = re.findall(
        r'"continuationCommand":\{"token":"([^"\\]+)","request":"([^"]+)"',
        html,
    )
    for token, request in paired:
        if request != "CONTINUATION_REQUEST_TYPE_BROWSE":
            continue
        if b"comment" not in _token_bytes(token):
            continue
        return _token_text(token), "browse"
    for token in re.findall(r'"continuationCommand":\{"token":"([^"\\]+)"\}', html):
        if b"comment" not in _token_bytes(token):
            continue
        return _token_text(token), "browse"
    return "", "browse"


def _header_count(payload: dict | None) -> int | None:
    """The comment total on the section header, not the length of this page."""
    found: list[int] = []

    def walk(node) -> None:
        if found:
            return
        if isinstance(node, dict):
            header = node.get("commentsHeaderRenderer")
            if isinstance(header, dict):
                count = _count(_yt_runs(header.get("commentsCount")))
                if count is None:
                    match = re.search(r"\d[\d,]*", _yt_runs(header.get("countText")))
                    if match:
                        count = _count(match.group(0).replace(",", ""))
                if count is not None:
                    found.append(count)
                    return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(payload or {})
    return found[0] if found else None


def extract_watch(html: str) -> dict:
    key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html or "")
    version = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html or "")
    return {
        "key": key.group(1) if key else "",
        "version": version.group(1) if version else "2.20251021.00.00",
        "token": _comment_token(html),
    }


def _yt_runs(node) -> str:
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("simpleText"), str):
        return node["simpleText"]
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join((item.get("text") or "") for item in runs if isinstance(item, dict))
    return ""


def _comment_url(parent: dict) -> str:
    explicit = str((parent or {}).get("url") or "")
    if explicit:
        return explicit
    parent_id = str((parent or {}).get("statusId") or (parent or {}).get("id") or "")
    if not parent_id:
        return ""
    if (parent or {}).get("kind") == "community":
        return "https://www.youtube.com/post/" + parent_id
    return "https://www.youtube.com/watch?v=" + parent_id


def _comment_row(comment_id: str, text: str, handle: str, avatar: str, published, likes, reply_count, parent: dict, moment: datetime | None) -> dict:
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    parent_handle = parent.get("handle") or ""
    stats = {}
    if likes is not None:
        stats["likes"] = likes
    if reply_count is not None:
        stats["replies"] = reply_count
    when = to_iso(published, moment)
    row = post_shell(
        id=comment_id,
        statusId=comment_id,
        platform="youtube",
        kind="reply",
        author=handle,
        handle=handle,
        avatar=avatar or "",
        text=text,
        date=when,
        url=_comment_url(parent),
        stats=stats,
        replyingTo={"handle": parent_handle, "id": parent_id} if parent_id or parent_handle else None,
    )
    if not when and published:
        row["timeLabel"] = str(published)
    return row


def parse_innertube_comments(payload: dict, parent: dict | None = None, moment: datetime | None = None, as_siblings: bool = False) -> list:
    parent = parent or {}
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
        row = _comment_row(
            comment_id,
            text,
            handle,
            author.get("avatarThumbnailUrl") or "",
            props.get("publishedTime"),
            likes,
            reply_count,
            parent,
            moment,
        )
        if not as_siblings and level > 0 and last is not None:
            last.setdefault("replies", []).append(row)
        else:
            top.append(row)
            last = row
    return top


def _each_thread(node, visit) -> None:
    if isinstance(node, dict):
        thread = node.get("commentThreadRenderer")
        if isinstance(thread, dict):
            visit(thread)
            return
        for value in node.values():
            _each_thread(value, visit)
    elif isinstance(node, list):
        for value in node:
            _each_thread(value, visit)


def _renderer_likes(renderer: dict):
    likes = _count(renderer.get("likeCount"))
    if likes is not None:
        return likes
    vote = renderer.get("voteCount")
    if isinstance(vote, dict):
        return _count(vote.get("simpleText"))
    return _count(vote)


def _renderer_avatar(renderer: dict) -> str:
    thumbs = (renderer.get("authorThumbnail") or {}).get("thumbnails") or []
    for thumb in reversed(thumbs):
        if isinstance(thumb, dict) and str(thumb.get("url") or "").startswith("https://"):
            return thumb["url"]
    return ""


def _thread_id(thread: dict) -> str:
    view = thread.get("commentViewModel")
    if isinstance(view, dict):
        inner = view.get("commentViewModel") if isinstance(view.get("commentViewModel"), dict) else view
        if inner.get("commentId"):
            return str(inner["commentId"])
    comment = (thread.get("comment") or {}).get("commentRenderer")
    if isinstance(comment, dict) and comment.get("commentId"):
        return str(comment["commentId"])
    return ""


def _reply_token(thread: dict) -> str:
    replies = (thread.get("replies") or {}).get("commentRepliesRenderer") or {}
    contents = replies.get("contents") or []
    for item in contents:
        if not isinstance(item, dict):
            continue
        command = ((item.get("continuationItemRenderer") or {}).get("continuationEndpoint") or {}).get("continuationCommand") or {}
        token = command.get("token") or ""
        if token:
            return token
    return ""


def reply_continuations(payload: dict) -> dict:
    """Map a top-level comment id to the public token for its first reply page."""
    found = {}

    def visit(thread: dict) -> None:
        comment_id = _thread_id(thread)
        token = _reply_token(thread)
        if comment_id and token and comment_id not in found:
            found[comment_id] = token

    _each_thread(payload or {}, visit)
    return found


def next_page_token(payload: dict) -> str:
    """The continuation that loads the next page of top-level comments."""
    for endpoint in (payload or {}).get("onResponseReceivedEndpoints") or []:
        if not isinstance(endpoint, dict):
            continue
        for key in ("reloadContinuationItemsCommand", "appendContinuationItemsAction"):
            command = endpoint.get(key) or {}
            items = command.get("continuationItems") or []
            if not any(isinstance(item, dict) and "commentThreadRenderer" in item for item in items):
                continue
            for item in items:
                if not isinstance(item, dict) or "continuationItemRenderer" not in item:
                    continue
                token = (((item.get("continuationItemRenderer") or {}).get("continuationEndpoint") or {}).get("continuationCommand") or {}).get("token") or ""
                if token:
                    return token
    return ""


def parse_thread_renderers(payload: dict, parent: dict | None = None, moment: datetime | None = None) -> list:
    """Older innertube responses nest the text on ``commentRenderer``."""
    parent = parent or {}
    rows = []

    def visit(thread: dict) -> None:
        renderer = (thread.get("comment") or {}).get("commentRenderer")
        if not isinstance(renderer, dict):
            return
        text = _yt_runs(renderer.get("contentText")).strip()
        if not text:
            return
        row = _comment_row(
            str(renderer.get("commentId") or ""),
            text,
            _yt_runs(renderer.get("authorText")).lstrip("@"),
            _renderer_avatar(renderer),
            _yt_runs(renderer.get("publishedTimeText")),
            _renderer_likes(renderer),
            _count(renderer.get("replyCount")),
            parent,
            moment,
        )
        replies = (thread.get("replies") or {}).get("commentRepliesRenderer") or {}
        kids = []
        for item in replies.get("contents") or []:
            child = item.get("commentRenderer") if isinstance(item, dict) else None
            if not isinstance(child, dict):
                continue
            child_text = _yt_runs(child.get("contentText")).strip()
            if not child_text:
                continue
            kids.append(
                _comment_row(
                    str(child.get("commentId") or ""),
                    child_text,
                    _yt_runs(child.get("authorText")).lstrip("@"),
                    _renderer_avatar(child),
                    _yt_runs(child.get("publishedTimeText")),
                    _renderer_likes(child),
                    _count(child.get("replyCount")),
                    {"statusId": row["id"], "id": row["id"], "handle": row.get("handle") or ""},
                    moment,
                )
            )
        if kids:
            row["replies"] = kids
        rows.append(row)

    _each_thread(payload or {}, visit)
    return rows


def _comments_from(payload: dict | None, parent: dict) -> list:
    if not isinstance(payload, dict):
        return []
    rows = parse_innertube_comments(payload, parent)
    if rows:
        return rows
    return parse_thread_renderers(payload, parent)


def _reply_stat(row: dict) -> int:
    try:
        return int((row.get("stats") or {}).get("replies") or 0)
    except (TypeError, ValueError):
        return 0


def _innertube_next(host: str, key: str, version: str, token: str, endpoint: str = "next") -> dict | None:
    if not token:
        return None
    if endpoint not in ("next", "browse"):
        endpoint = "next"
    agent = MOBILE if "m.youtube.com" in host else BROWSER
    body = json.dumps(
        {
            "context": {"client": {"clientName": "WEB", "clientVersion": version, "hl": "en", "gl": "US"}},
            "continuation": token,
        }
    ).encode("utf-8")
    url = host.rstrip("/") + "/youtubei/v1/" + endpoint + "?key=" + urllib.parse.quote(key) + "&prettyPrint=false"
    try:
        status, raw = _read(
            url,
            {"User-Agent": agent, "Content-Type": "application/json", "Accept": "application/json"},
            data=body,
            timeout=20,
        )
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if status == 429 or status != 200 or not raw.lstrip().startswith("{"):
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _merge_rows(rows: list, extra: list) -> None:
    seen = {str(row.get("id") or "") for row in rows}
    for row in extra:
        comment_id = str(row.get("id") or "")
        if not comment_id or comment_id in seen:
            continue
        seen.add(comment_id)
        rows.append(row)


def _attach_reply_page(row: dict, payload: dict) -> None:
    parent = {"statusId": row.get("id") or "", "id": row.get("id") or "", "handle": row.get("handle") or ""}
    if "/post/" in str(row.get("url") or ""):
        parent["url"] = row["url"]
    kids = parse_innertube_comments(payload, parent, as_siblings=True)
    if not kids:
        kids = parse_thread_renderers(payload, parent)
    kept = []
    for child in kids:
        if str(child.get("id") or "") == str(row.get("id") or ""):
            continue
        child.pop("replies", None)
        kept.append(child)
        if len(kept) >= REPLY_CAP:
            break
    if kept:
        row["replies"] = kept


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
    if post.get("platform") == "youtube" and post.get("kind") == "community":
        status = "ytpost_" + status
    elif post.get("platform") == "youtube":
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


def select_community(posts: list, moment: datetime | None = None, limit: int = COMMUNITY_CAP) -> list:
    """Community posts from the last 14 days.

    When the feed has none that new, the newest few still in the feed are
    used so the posts on the site have a comment file. The list stays small.
    """
    moment = moment or datetime.now(timezone.utc)
    ranked = []
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        if post.get("platform") != "youtube" or post.get("kind") != "community":
            continue
        age = _age_days(post, moment)
        if age is None or age < 0:
            continue
        ranked.append((age, post))
    ranked.sort(key=lambda item: item[0])
    recent = [post for age, post in ranked if age <= RECENT_DAYS]
    if recent:
        return recent[:limit]
    feed_cap = min(limit, COMMUNITY_FEED_CAP)
    return [post for _age, post in ranked[:feed_cap]]


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
    parent = dict(parent or {})
    parent.setdefault("statusId", video_id)
    parent.setdefault("id", video_id)
    payload = None
    host_used = ""
    replies = []
    for host in YT_NEXT_HOSTS:
        payload = _innertube_next(host, key, watch["version"], watch["token"])
        replies = _comments_from(payload, parent)
        if replies:
            host_used = host
            break
    if not replies:
        if payload is None:
            return None
        return trim_pack(
            {
                "postId": "yt_" + video_id,
                "platform": "youtube",
                "source": "own:innertube",
                "fetchedAt": now_iso(),
                "replies": [],
                "note": "innertube returned no comments",
            }
        )
    tokens = reply_continuations(payload)
    if len(replies) < REPLY_CAP:
        page = next_page_token(payload)
        more = _innertube_next(host_used, key, watch["version"], page) if page else None
        if more:
            _merge_rows(replies, _comments_from(more, parent))
            tokens.update(reply_continuations(more))
    ranked = [row for row in replies if _reply_stat(row) > 0 and not row.get("replies") and tokens.get(str(row.get("id") or ""))]
    ranked.sort(key=lambda row: (_reply_stat(row), int((row.get("stats") or {}).get("likes") or 0)), reverse=True)
    for row in ranked[:REPLY_PAGES]:
        child = _innertube_next(host_used, key, watch["version"], tokens[str(row.get("id") or "")])
        if child:
            _attach_reply_page(row, child)
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


def _read_html(url: str) -> str:
    if not url:
        return ""
    try:
        status, html = _read(
            url,
            {"User-Agent": BROWSER, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html"},
            timeout=25,
            limit=2_500_000,
        )
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return ""
    if status != 200 or "INNERTUBE_API_KEY" not in html:
        return ""
    return html


def _comment_section(key: str, version: str, token: str, endpoint: str, parent: dict) -> tuple[dict | None, list, str, str]:
    """Load the comment section. www, then m. Then the other endpoint the same way."""
    first = endpoint if endpoint in ("browse", "next") else "browse"
    endpoints = [first, "next" if first == "browse" else "browse"]
    last = None
    for ep in endpoints:
        for host in YT_NEXT_HOSTS:
            payload = _innertube_next(host, key, version, token, ep)
            if payload is None:
                continue
            last = payload
            replies = _comments_from(payload, parent)
            if replies:
                return payload, replies, host, ep
    return last, [], "", first


def _with_reply_pages(replies: list, payload: dict, parent: dict, host: str, key: str, version: str, endpoint: str) -> None:
    tokens = reply_continuations(payload or {})
    if len(replies) < REPLY_CAP:
        page = next_page_token(payload or {})
        more = _innertube_next(host, key, version, page, endpoint) if page else None
        if more:
            _merge_rows(replies, _comments_from(more, parent))
            tokens.update(reply_continuations(more))
    ranked = [row for row in replies if _reply_stat(row) > 0 and not row.get("replies") and tokens.get(str(row.get("id") or ""))]
    ranked.sort(key=lambda row: (_reply_stat(row), int((row.get("stats") or {}).get("likes") or 0)), reverse=True)
    for row in ranked[:REPLY_PAGES]:
        child = _innertube_next(host, key, version, tokens[str(row.get("id") or "")], endpoint)
        if child:
            _attach_reply_page(row, child)


def fetch_community_comments(post_id: str, parent: dict | None = None) -> dict | None:
    post_id = str(post_id or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,}", post_id):
        return None
    parent = dict(parent or {})
    parent.setdefault("statusId", post_id)
    parent.setdefault("id", post_id)
    parent["kind"] = "community"
    parent.setdefault("url", "https://www.youtube.com/post/" + post_id)
    html = _read_html("https://www.youtube.com/post/" + urllib.parse.quote(post_id) + "?hl=en")
    if not html or not _community_token(html)[0]:
        handle = str(parent.get("handle") or "").lstrip("@")
        channel = str(parent.get("channelId") or "")
        alt = ""
        if handle:
            alt = "https://www.youtube.com/@" + urllib.parse.quote(handle) + "/posts?hl=en"
        elif channel:
            alt = "https://www.youtube.com/channel/" + urllib.parse.quote(channel) + "/posts?hl=en"
        alt_html = _read_html(alt) if alt and post_id else ""
        if alt_html and post_id in alt_html and _community_token(alt_html)[0]:
            html = alt_html
    if not html:
        return None
    watch = extract_watch(html)
    key = watch["key"] or FALLBACK_KEY
    token, endpoint = _community_token(html)
    empty = {
        "postId": "ytpost_" + post_id,
        "platform": "youtube",
        "source": "own:innertube",
        "fetchedAt": now_iso(),
        "replies": [],
        "note": "post page had no public comment continuation" if not token else "innertube returned no community comments",
    }
    if not token:
        return empty
    payload, replies, host, used = _comment_section(key, watch["version"], token, endpoint, parent)
    if not replies:
        if payload is None:
            return None
        return trim_pack(empty)
    _with_reply_pages(replies, payload, parent, host, key, watch["version"], used)
    count = _header_count(payload)
    pack = {
        "postId": "ytpost_" + post_id,
        "platform": "youtube",
        "source": "own:innertube",
        "fetchedAt": now_iso(),
        "replies": replies,
        "note": "innertube community comments",
    }
    if count is not None:
        pack["commentCount"] = count
        pack["stats"] = {"replies": count}
    return trim_pack(pack)


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
    if platform == "youtube" and post.get("kind") == "community":
        return fetch_community_comments(str(post.get("statusId") or post.get("id") or ""), post)
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
    chosen = select_recent(posts, moment) + select_community(posts, moment)
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
