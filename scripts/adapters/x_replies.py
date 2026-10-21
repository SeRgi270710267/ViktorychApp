"""Replies for an X post.

Live source that works without a token: api.fxtwitter.com/2/conversation/<id>
(the `replies` array). A reply is kept only when its replying_to status or its
conversation id is the post. Missing text, handle, date, or target is filled
from api.fxtwitter.com/status/<id>, then a Nitter status page if that call
fails. Nitter status HTML is also the fallback when the conversation call
fails. Instances tried: nitter.meowing.monster, nitter.kareem.one,
nitter.jaydenha.uk.

Relevant order matches X: the author's own self-thread first, then everyone
else by likes + replies*2 + reposts, with a boost for a verified account.
Obvious spam is flagged and kept behind that list. The parent's status.replies
count is separate from the capped list.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from .common import clean_text, parse_json_loose, post_shell
from .fxtwitter import convert_status

CAP = 50
SPAM_CAP = 20
LOOKUP_CAP = 15
FRESH_SECONDS = 7 * 86400
DAILY_SECONDS = 30 * 86400
DAY_SECONDS = 86400

_GIVEAWAY = re.compile(
    r"(crypto\s*giveaway|airdrop|double your|seed phrase|claim (?:your )?reward|free\s+(?:btc|eth|usdt|bitcoin|ethereum))",
    re.I,
)
_URL = re.compile(r"https?://\S+|t\.co/\S+", re.I)
_BOT_HANDLE = re.compile(r"^[A-Za-z]+\d{5,}$")
_UNAVAILABLE = (
    "this post is unavailable",
    "this tweet is unavailable",
    "this post was deleted",
    "deleted by the post author",
    "account is suspended",
    "account has been suspended",
)


def _iso(value: str) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if len(text) >= 11 and text[4] == "-" and "T" in text[8:]:
        return text
    try:
        return parsedate_to_datetime(text).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, IndexError, OverflowError):
        return text


def _epoch(value: str):
    text = _iso(value)
    if len(text) < 19:
        return None
    try:
        parsed = datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc)


def _num(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _payload(payload):
    if isinstance(payload, str):
        payload = parse_json_loose(payload)
    return payload if isinstance(payload, dict) else {}


def comments_kept(post: dict, now=None) -> bool:
    """Instagram, Threads, VK, and comment RSS younger than 7 days are stored.

    X and YouTube are loaded in the browser. A post with no date is not stored.
    """
    if not isinstance(post, dict):
        return False
    platform = post.get("platform") or ""
    if platform in ("x", "youtube"):
        return False
    if platform not in ("instagram", "threads", "vk") and not post.get("commentRss"):
        return False
    posted = _epoch(post.get("date") or "")
    if posted is None:
        return False
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (moment - posted).total_seconds() < FRESH_SECONDS


def comments_due(post_date: str, fetched_at: str | None, now=None) -> bool:
    """Posts under 7 days refresh every run. Posts 7–30 days old refresh once a day."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    posted = _epoch(post_date or "")
    if posted is None:
        return True
    age = (moment - posted).total_seconds()
    if age < FRESH_SECONDS:
        return True
    if age > DAILY_SECONDS:
        return False
    fetched = _epoch(fetched_at or "")
    if fetched is None:
        return True
    return (moment - fetched).total_seconds() >= DAY_SECONDS


def conversation_reply_count(payload) -> int | None:
    """The source reply count. This is not the length of the capped list."""
    status = _payload(payload).get("status")
    if not isinstance(status, dict):
        return None
    value = status.get("replies")
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _parent_handle(payload, fallback: str = "") -> str:
    status = _payload(payload).get("status")
    if isinstance(status, dict):
        author = status.get("author") or {}
        handle = author.get("screen_name") or author.get("handle") or ""
        if handle:
            return handle
    return fallback or ""


def _conversation_id(status: dict) -> str:
    conv = status.get("conversation_id") or status.get("conversation_id_str") or ""
    nested = status.get("conversation")
    if not conv and isinstance(nested, dict):
        conv = nested.get("id") or nested.get("status") or ""
    elif not conv and isinstance(nested, str):
        conv = nested
    return str(conv or "")


def _raw_unavailable(status: dict) -> bool:
    if not isinstance(status, dict):
        return True
    if status.get("deleted") or status.get("unavailable") or status.get("tombstone"):
        return True
    if str(status.get("type") or "").lower() in {"tombstone", "deleted", "unavailable"}:
        return True
    text = str(status.get("text") or status.get("full_text") or "").strip().lower()
    if any(phrase in text for phrase in _UNAVAILABLE):
        return True
    author = status.get("author")
    if author in (None, {}, "") and not text:
        return True
    return False


def belongs(post: dict, parent_id: str):
    """True when the reply targets this post, False on a mismatch, None if unknown."""
    parent = str(parent_id or "")
    if not parent:
        return None
    target = str(((post.get("replyingTo") or {}).get("id")) or "")
    conv = str(post.get("conversationId") or "")
    if target == parent or conv == parent:
        return True
    if target or conv:
        return False
    return None


def _attach(post: dict, status: dict) -> dict:
    author = status.get("author") or {}
    if author.get("joined"):
        post["authorJoined"] = _iso(str(author["joined"]))
    if isinstance(author.get("followers"), int):
        post["authorFollowers"] = author["followers"]
    target = status.get("replying_to")
    if isinstance(target, dict) and (target.get("status") or target.get("status_id")):
        post["replyingTo"] = post.get("replyingTo") or {
            "name": target.get("screen_name") or "",
            "handle": target.get("screen_name") or "",
            "avatar": "",
        }
        post["replyingTo"]["id"] = str(target.get("status") or target.get("status_id"))
        if target.get("screen_name") and not post["replyingTo"].get("handle"):
            post["replyingTo"]["handle"] = target["screen_name"]
    conv = _conversation_id(status)
    if conv:
        post["conversationId"] = conv
    return post


def _from_status(status: dict) -> dict | None:
    if not isinstance(status, dict):
        return None
    wrapped = status.get("tweet") if isinstance(status.get("tweet"), dict) else status
    if _raw_unavailable(wrapped):
        return None
    if not (wrapped.get("id") or wrapped.get("id_str") or wrapped.get("statusId")):
        return None
    if wrapped.get("kind") == "reply" and wrapped.get("handle") is not None and "author" not in wrapped:
        return dict(wrapped)
    post = convert_status(wrapped, {"id": "", "platform": "x", "handle": ""}, nested=False)
    post["kind"] = "reply"
    post["platform"] = "x"
    post["date"] = _iso(post.get("date") or "")
    return _attach(post, wrapped)


def status_object(payload):
    """Pull a tweet object out of an fxtwitter status response."""
    data = _payload(payload)
    if not data:
        return None
    code = data.get("code")
    if code not in (None, 200, "200"):
        return None
    if isinstance(data.get("tweet"), dict):
        return data["tweet"]
    status = data.get("status")
    if isinstance(status, dict) and (status.get("id") or status.get("id_str")):
        return status
    if data.get("id") and (data.get("text") is not None or data.get("author")):
        return data
    return None


def extract_fxtwitter_replies(payload, parent_id: str) -> list:
    data = _payload(payload)
    code = data.get("code")
    if code not in (None, 200, "200"):
        raise ValueError(f"fxtwitter conversation code {code}")
    parent = str(parent_id or "")
    out = []
    seen = set()
    for status in data.get("replies") or []:
        if not isinstance(status, dict) or _raw_unavailable(status):
            continue
        sid = str(status.get("id") or status.get("id_str") or "")
        if not sid or sid == parent or sid in seen:
            continue
        seen.add(sid)
        post = convert_status(status, {"id": "", "platform": "x", "handle": ""}, nested=False)
        post["kind"] = "reply"
        post["platform"] = "x"
        post["date"] = _iso(post.get("date") or "")
        _attach(post, status)
        if belongs(post, parent) is False:
            continue
        out.append(post)
    return out


def _norm_text(text: str) -> str:
    cleaned = _URL.sub(" ", text or "")
    cleaned = re.sub(r"@\w+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


def _young_account(post: dict) -> bool:
    followers = post.get("authorFollowers")
    if followers is None or _num(followers) >= 20:
        return False
    joined = _epoch(post.get("authorJoined") or "")
    posted = _epoch(post.get("date") or "")
    if not joined or not posted:
        return False
    gap = (posted - joined).total_seconds()
    return 0 <= gap <= 21 * DAY_SECONDS


def spam_reason(post: dict, author_handle: str = "") -> str:
    author = (author_handle or "").lower()
    if author and (post.get("handle") or "").lower() == author:
        return ""
    text = post.get("text") or ""
    if _GIVEAWAY.search(text):
        return "giveaway"
    leftover = _URL.sub(" ", text)
    leftover = re.sub(r"@\w+", " ", leftover)
    leftover = re.sub(r"\s+", "", leftover)
    if _URL.search(text) and len(leftover) < 8:
        return "link"
    if _young_account(post):
        return "new"
    handle = post.get("handle") or ""
    if _BOT_HANDLE.match(handle):
        compact = re.sub(r"\s+", "", _URL.sub(" ", re.sub(r"@\w+", " ", text)))
        if len(compact) < 40 or _URL.search(text):
            return "bot"
    return ""


def engagement(post: dict) -> int:
    stats = post.get("stats") or {}
    score = _num(stats.get("likes")) + _num(stats.get("replies")) * 2 + _num(stats.get("reposts"))
    verified = post.get("verifiedType")
    if verified and verified != "none":
        score = int(score * 1.5) + 1
    return score


def _chain(posts: list) -> list:
    ids = {str(post.get("id") or "") for post in posts}
    by_parent = {}
    for post in posts:
        target = str(((post.get("replyingTo") or {}).get("id")) or "")
        by_parent.setdefault(target, []).append(post)
    for group in by_parent.values():
        group.sort(key=lambda post: post.get("date") or "")
    roots = [post for post in posts if str(((post.get("replyingTo") or {}).get("id")) or "") not in ids]
    roots.sort(key=lambda post: post.get("date") or "")
    out = []
    seen = set()

    def walk(node):
        sid = str(node.get("id") or "")
        if sid in seen:
            return
        seen.add(sid)
        out.append(node)
        for child in by_parent.get(sid, []):
            walk(child)

    for root in roots:
        walk(root)
    for post in posts:
        if str(post.get("id") or "") not in seen:
            out.append(post)
    return out


def rank_replies(replies: list, author_handle: str = "", cap: int = CAP) -> list:
    author = (author_handle or "").lower()
    posts = []
    seen = set()
    for index, post in enumerate(replies or []):
        if not isinstance(post, dict):
            continue
        item = dict(post)
        item.pop("spam", None)
        sid = str(item.get("id") or "")
        if sid:
            if sid in seen:
                continue
            seen.add(sid)
        else:
            item["_rankId"] = str(index)
        posts.append(item)
    groups = {}
    for post in posts:
        if author and (post.get("handle") or "").lower() == author:
            continue
        key = _norm_text(post.get("text") or "")
        if len(key) < 20:
            continue
        groups.setdefault(key, []).append(post)
    for group in groups.values():
        if len(group) < 2:
            continue
        group.sort(key=engagement, reverse=True)
        for loser in group[1:]:
            loser["spam"] = True
    for post in posts:
        if spam_reason(post, author):
            post["spam"] = True
    clean = [post for post in posts if not post.get("spam")]
    flagged = [post for post in posts if post.get("spam")]
    self_posts = [post for post in clean if author and (post.get("handle") or "").lower() == author]
    others = [post for post in clean if post not in self_posts]
    others.sort(key=lambda post: (engagement(post), _num((post.get("stats") or {}).get("likes")), post.get("date") or ""), reverse=True)
    flagged.sort(key=engagement, reverse=True)
    ordered = (_chain(self_posts) + others)[:cap]
    result = ordered + flagged[:SPAM_CAP]
    for post in result:
        post.pop("_rankId", None)
    return result


def _cap(replies: list) -> list:
    return rank_replies(replies, "")


def select_subthreads(replies: list, limit: int = 10) -> list:
    """Replies that have their own replies, most engaged first."""
    rows = []
    for post in replies or []:
        if not isinstance(post, dict) or post.get("spam"):
            continue
        if _num((post.get("stats") or {}).get("replies")) <= 0:
            continue
        if not (post.get("id") or post.get("statusId")):
            continue
        rows.append(post)
    rows.sort(key=engagement, reverse=True)
    return rows[:limit]


def _fill_rank(post: dict, parent_id: str) -> int:
    if belongs(post, parent_id) is None:
        return 0
    if not (post.get("text") or "").strip() and not post.get("media"):
        return 1
    if not post.get("handle") or not post.get("date"):
        return 2
    target = (post.get("replyingTo") or {}).get("id")
    if not target and not post.get("conversationId"):
        return 2
    return 9


def _normalized(extra) -> bool:
    return isinstance(extra, dict) and extra.get("platform") == "x" and "statusId" in extra and not isinstance(extra.get("author"), dict)


def _merge_lookup(post: dict, extra, parent_id: str):
    incoming = dict(extra) if _normalized(extra) else _from_status(extra)
    if incoming is None:
        return None
    if belongs(incoming, parent_id) is False:
        return None
    filled = dict(post)
    for key in ("text", "handle", "author", "date", "avatar", "url", "verifiedType", "authorJoined", "authorFollowers", "conversationId"):
        if not filled.get(key) and incoming.get(key):
            filled[key] = incoming[key]
    if not filled.get("media") and incoming.get("media"):
        filled["media"] = incoming["media"]
    if not ((filled.get("replyingTo") or {}).get("id")) and ((incoming.get("replyingTo") or {}).get("id")):
        filled["replyingTo"] = incoming["replyingTo"]
    if not filled.get("stats") and incoming.get("stats"):
        filled["stats"] = incoming["stats"]
    if belongs(filled, parent_id) is True:
        return filled
    if belongs(incoming, parent_id) is True:
        if incoming.get("conversationId"):
            filled["conversationId"] = incoming["conversationId"]
        if (incoming.get("replyingTo") or {}).get("id"):
            filled["replyingTo"] = incoming["replyingTo"]
    if belongs(filled, parent_id) is not True:
        return None
    return filled


def fill_missing(replies: list, parent_id: str, lookup, limit: int = LOOKUP_CAP) -> list:
    """Fill gaps from status lookups. Drop anything that still does not match the post."""
    ranked = sorted((post for post in replies if _fill_rank(post, parent_id) < 9), key=lambda post: _fill_rank(post, parent_id))
    fetched = {}
    for post in ranked[:limit]:
        sid = str(post.get("id") or "")
        if not sid or sid in fetched:
            continue
        fetched[sid] = lookup(post) if lookup else None
    out = []
    seen = set()
    for post in replies:
        sid = str(post.get("id") or "")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        if sid in fetched and fetched[sid]:
            post = _merge_lookup(post, fetched[sid], parent_id)
            if post is None:
                continue
        if belongs(post, parent_id) is not True:
            continue
        out.append(post)
    return out


def merge_replies(previous: list, fresh: list) -> list:
    """Replace the stored list with the fresh set. The same id keeps newer counts."""
    old = {}
    for post in previous or []:
        if isinstance(post, dict) and post.get("id"):
            old[str(post["id"])] = post
    out = []
    seen = set()
    for item in fresh or []:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id") or "")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        prior = old.get(sid)
        if not prior:
            out.append(dict(item))
            continue
        merged = dict(prior)
        for key, value in item.items():
            if value not in (None, "", [], {}):
                merged[key] = value
        if item.get("stats"):
            merged["stats"] = dict(item["stats"])
        out.append(merged)
    return out


def parse_fxtwitter_conversation(payload, parent_id: str, author_handle: str = "", cap: int = CAP) -> list:
    data = _payload(payload)
    author = author_handle or _parent_handle(data)
    rows = [row for row in extract_fxtwitter_replies(data, parent_id) if belongs(row, parent_id) is True]
    return rank_replies(rows, author, cap)


def _stat(part: str, icon: str):
    match = re.search(rf'class="icon-{icon}".*?</div>\s*([\d,]+)', part, re.S)
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def _nitter_post(part: str) -> dict | None:
    link = re.search(r'href="/([A-Za-z0-9_]+)/status/([A-Za-z0-9_]+)', part)
    if not link:
        return None
    handle, sid = link.group(1), link.group(2)
    name_match = re.search(r'class="fullname"[^>]*>\s*([^<]+)', part)
    content = re.search(r'class="tweet-content[^"]*"[^>]*>(.*?)</div>', part, re.S)
    text = clean_text(re.sub(r"<[^>]+>", "", content.group(1))) if content else ""
    date_match = re.search(r'class="tweet-date".*?title="([^"]+)"', part, re.S)
    img = re.search(r'<img[^>]+src="([^"]+)"', part)
    reply_link = re.search(r'class="replying-to".*?href="/[A-Za-z0-9_]+/status/([A-Za-z0-9_]+)', part, re.S)
    stats = {}
    for key, icon in (("replies", "comment"), ("reposts", "retweet"), ("quotes", "quote"), ("likes", "heart"), ("views", "views")):
        value = _stat(part, icon)
        if value is not None:
            stats[key] = value
    replying = None
    if reply_link:
        replying = {"name": "", "handle": "", "avatar": "", "id": reply_link.group(1)}
    return post_shell(
        id=sid,
        statusId=sid,
        platform="x",
        kind="reply",
        author=(name_match.group(1).strip() if name_match else handle),
        handle=handle,
        avatar=img.group(1) if img else "",
        text=text,
        date=_iso(date_match.group(1) if date_match else ""),
        url=f"https://x.com/{handle}/status/{sid}",
        stats=stats,
        replyingTo=replying,
    )


def _nitter_parts(html: str) -> list:
    chunks = re.split(r'<div class="timeline-item\b[^"]*"', html or "")
    return [_nitter_post(part) for part in chunks[1:]]


def parse_nitter_status(html: str, status_id: str) -> dict | None:
    """The focused tweet on a Nitter status page, used when fxtwitter has no status."""
    wanted = str(status_id or "")
    for post in _nitter_parts(html):
        if post and post.get("id") == wanted:
            return post
    return None


def parse_nitter_replies(html: str, parent_id: str, cap: int = CAP) -> list:
    """Pull reply tweets out of a Nitter status page.

    The page is already the parent status, so a reply that does not name another
    status is treated as a reply to that parent.
    """
    parent = str(parent_id or "")
    author = ""
    out = []
    seen = set()
    for post in _nitter_parts(html):
        if not post:
            continue
        sid = post["id"]
        if sid == parent:
            author = post.get("handle") or author
            continue
        if sid in seen:
            continue
        seen.add(sid)
        if parent:
            post["conversationId"] = parent
            if not (post.get("replyingTo") or {}).get("id"):
                post["replyingTo"] = {"name": "", "handle": "", "avatar": "", "id": parent}
        out.append(post)
    return rank_replies(out, author, cap)
