"""Replies for an X post.

Live source that works without a token: api.fxtwitter.com/2/conversation/<id>
(the `replies` array). Nitter status HTML is the fallback when that call fails.
Instances tried: nitter.meowing.monster, nitter.kareem.one, nitter.jaydenha.uk.
"""

from __future__ import annotations

import re
from email.utils import parsedate_to_datetime

from .common import clean_text, parse_json_loose, post_shell
from .fxtwitter import convert_status

CAP = 50


def _iso(value: str) -> str:
    if not value:
        return ""
    text = str(value).strip()
    # "Tue …" contains a T, so only skip strings that are already ISO-8601.
    if len(text) >= 11 and text[4] == "-" and "T" in text[8:]:
        return text
    try:
        return parsedate_to_datetime(text).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, IndexError, OverflowError):
        return text


def _cap(replies: list) -> list:
    replies.sort(key=lambda post: ((post.get("stats") or {}).get("likes") or 0), reverse=True)
    return replies[:CAP]


def parse_fxtwitter_conversation(payload, parent_id: str) -> list:
    if isinstance(payload, str):
        payload = parse_json_loose(payload)
    if not isinstance(payload, dict):
        return []
    code = payload.get("code")
    if code not in (None, 200, "200"):
        raise ValueError(f"fxtwitter conversation code {code}")
    parent = str(parent_id or "")
    out = []
    seen = set()
    for status in payload.get("replies") or []:
        if not isinstance(status, dict):
            continue
        sid = str(status.get("id") or "")
        if not sid or sid == parent or sid in seen:
            continue
        seen.add(sid)
        post = convert_status(status, {"id": "", "platform": "x", "handle": ""}, nested=False)
        post["kind"] = "reply"
        post["platform"] = "x"
        post["date"] = _iso(post.get("date") or "")
        target = status.get("replying_to")
        if isinstance(target, dict) and target.get("status"):
            post["replyingTo"] = post.get("replyingTo") or {
                "name": target.get("screen_name") or "",
                "handle": target.get("screen_name") or "",
                "avatar": "",
            }
            post["replyingTo"]["id"] = str(target["status"])
            if target.get("screen_name") and not post["replyingTo"].get("handle"):
                post["replyingTo"]["handle"] = target["screen_name"]
        out.append(post)
    return _cap(out)


def _stat(part: str, icon: str):
    match = re.search(rf'class="icon-{icon}".*?</div>\s*([\d,]+)', part, re.S)
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def parse_nitter_replies(html: str, parent_id: str) -> list:
    """Pull reply tweets out of a Nitter status page."""
    parent = str(parent_id or "")
    chunks = re.split(r'<div class="timeline-item\b[^"]*"', html or "")
    out = []
    seen = set()
    for part in chunks[1:]:
        link = re.search(r'href="/([A-Za-z0-9_]+)/status/(\d+)', part)
        if not link:
            continue
        handle, sid = link.group(1), link.group(2)
        if sid == parent or sid in seen:
            continue
        # The status page repeats the focused post. Skip it by id above.
        seen.add(sid)
        name_match = re.search(r'class="fullname"[^>]*>\s*([^<]+)', part)
        content = re.search(r'class="tweet-content[^"]*"[^>]*>(.*?)</div>', part, re.S)
        text = clean_text(re.sub(r"<[^>]+>", "", content.group(1))) if content else ""
        date_match = re.search(r'class="tweet-date".*?title="([^"]+)"', part, re.S)
        img = re.search(r'<img[^>]+src="([^"]+)"', part)
        stats = {}
        for key, icon in (("replies", "comment"), ("reposts", "retweet"), ("quotes", "quote"), ("likes", "heart"), ("views", "views")):
            value = _stat(part, icon)
            if value is not None:
                stats[key] = value
        out.append(
            post_shell(
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
                replyingTo={"name": "", "handle": "", "id": parent} if parent else None,
            )
        )
    return _cap(out)
