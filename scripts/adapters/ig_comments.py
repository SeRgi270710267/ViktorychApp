"""Instagram comments from public pages, then a session cookie as a last resort.

Public shapes:
- PolarisPostActionLoadPostQuery / PolarisPostRootQuery GraphQL
  (`xdt_shortcode_media`, `edge_media_to_parent_comment`, or
  `xdt_api__v1__media__shortcode__web_info`)
- The captioned embed page's comment list
- Viewer HTML (picuki, imginn, dumpor, anonyig) when it actually contains comments

The private endpoint https://www.instagram.com/api/v1/media/<id>/comments/
is only used when INSTAGRAM_COOKIE is set. The cookie is never written to disk.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

from .common import clean_text, parse_json_loose, post_shell

CAP = 50


def _iso(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(int(value), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value)


NEST_CAP = 20


def parse_ig_comments(payload, parent: dict | None = None, depth: int = 0) -> list:
    parent = parent or {}
    if isinstance(payload, str):
        payload = parse_json_loose(payload)
    if not isinstance(payload, dict):
        return []
    rows = payload.get("comments") or []
    out = []
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    parent_handle = parent.get("handle") or ""
    for comment in rows:
        if not isinstance(comment, dict):
            continue
        user = comment.get("user") or {}
        handle = user.get("username") or ""
        cid = str(comment.get("pk") or comment.get("id") or "")
        if not cid:
            continue
        likes = comment.get("comment_like_count")
        stats = {"likes": likes} if likes is not None else {}
        child_count = _count(comment.get("child_comment_count"))
        if child_count is not None:
            stats["replies"] = child_count
        item = post_shell(
            id=cid,
            statusId=cid,
            platform="instagram",
            kind="reply",
            author=user.get("full_name") or handle,
            handle=handle,
            avatar=user.get("profile_pic_url") or "",
            verifiedType="blue" if user.get("is_verified") else None,
            text=comment.get("text") or "",
            date=_iso(comment.get("created_at")),
            url=parent.get("url") or "",
            stats=stats,
            replyingTo={"name": parent.get("author") or parent_handle, "handle": parent_handle, "id": parent_id} if parent_handle or parent_id else None,
        )
        raw_kids = comment.get("preview_child_comments") if depth == 0 else None
        if isinstance(raw_kids, list) and raw_kids:
            kids = parse_ig_comments(
                {"comments": raw_kids},
                {"statusId": cid, "id": cid, "handle": handle, "author": user.get("full_name") or handle, "url": parent.get("url") or ""},
                depth=1,
            )
            if kids:
                item["_children"] = kids[:NEST_CAP]
        out.append(item)
    out.sort(key=lambda post: ((post.get("stats") or {}).get("likes") or 0), reverse=True)
    return out[:CAP]


def _count(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.replace(",", "").isdigit():
        return int(value.replace(",", ""))
    return None


def _edge_to_v1(node: dict) -> dict:
    owner = node.get("owner") or node.get("user") or {}
    likes = node.get("comment_like_count")
    liked = node.get("edge_liked_by") or {}
    if likes is None and isinstance(liked, dict):
        likes = liked.get("count")
    row = {
        "pk": node.get("pk") or node.get("id"),
        "text": node.get("text") or "",
        "created_at": node.get("created_at"),
        "comment_like_count": likes,
        "user": {
            "username": owner.get("username") or "",
            "full_name": owner.get("full_name") or owner.get("username") or "",
            "profile_pic_url": owner.get("profile_pic_url") or "",
            "is_verified": bool(owner.get("is_verified") or owner.get("is_verified_user")),
        },
    }
    threaded = node.get("edge_threaded_comments")
    if isinstance(threaded, dict):
        count = _count(threaded.get("count"))
        if count is not None:
            row["child_comment_count"] = count
        kids = [
            _edge_to_v1(item["node"])
            for item in (threaded.get("edges") or [])
            if isinstance(item, dict) and isinstance(item.get("node"), dict)
        ]
        if kids:
            row["preview_child_comments"] = kids
    preview = node.get("preview_child_comments")
    if isinstance(preview, list) and preview and "preview_child_comments" not in row:
        row["preview_child_comments"] = preview
    if "child_comment_count" not in row:
        count = _count(node.get("child_comment_count"))
        if count is not None:
            row["child_comment_count"] = count
    return row


def _media_comments(media: dict, parent: dict) -> tuple[list, int | None]:
    if not isinstance(media, dict):
        return [], None
    count = _count(media.get("comment_count"))
    rows: list = []
    for key in ("edge_media_to_parent_comment", "edge_media_preview_comment", "edge_media_to_comment"):
        edge = media.get(key)
        if not isinstance(edge, dict):
            continue
        edge_count = _count(edge.get("count"))
        if edge_count is not None and (count is None or key == "edge_media_to_parent_comment"):
            count = edge_count
        v1 = [
            _edge_to_v1(item["node"])
            for item in (edge.get("edges") or [])
            if isinstance(item, dict) and isinstance(item.get("node"), dict)
        ]
        if v1:
            rows = parse_ig_comments({"comments": v1}, parent)
    preview = media.get("preview_comments")
    if isinstance(preview, list) and preview and not rows:
        rows = parse_ig_comments({"comments": preview}, parent)
    comments = media.get("comments")
    if isinstance(comments, list) and comments and isinstance(comments[0], dict) and ("text" in comments[0] or "pk" in comments[0]):
        parsed = parse_ig_comments({"comments": comments}, parent)
        if parsed:
            rows = parsed
    return rows, count


def _json_values(text: str, key: str):
    token = f'"{key}"'
    start = 0
    while True:
        index = text.find(token, start)
        if index < 0:
            return
        colon = text.find(":", index + len(token))
        if colon < 0:
            return
        cursor = colon + 1
        while cursor < len(text) and text[cursor] in " \n\r\t":
            cursor += 1
        try:
            value, end = json.JSONDecoder().raw_decode(text, cursor)
        except json.JSONDecodeError:
            start = index + len(token)
            continue
        yield value
        start = end


def parse_ig_document(payload, parent: dict | None = None) -> tuple[list, int | None]:
    """Comments plus the real count from a GraphQL payload or a public HTML page."""
    parent = parent or {}
    if isinstance(payload, dict):
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        media = None
        if isinstance(data, dict):
            media = data.get("xdt_shortcode_media") or data.get("shortcode_media")
            web = data.get("xdt_api__v1__media__shortcode__web_info")
            if isinstance(web, dict) and web.get("items"):
                media = web["items"][0]
            if media is None and ("comment_count" in data or "edge_media_to_parent_comment" in data or "preview_comments" in data):
                media = data
        if isinstance(media, dict):
            return _media_comments(media, parent)
        return [], None
    text = payload if isinstance(payload, str) else ""
    if not text:
        return [], None
    stripped = text.lstrip()
    if stripped[:1] in "{[":
        try:
            return parse_ig_document(parse_json_loose(stripped), parent)
        except (ValueError, json.JSONDecodeError):
            pass
    replies: list = []
    count = None
    for key in ("xdt_shortcode_media", "shortcode_media"):
        for value in _json_values(text, key):
            got, got_count = _media_comments(value if isinstance(value, dict) else {}, parent)
            if got:
                replies = got
            if got_count is not None:
                count = got_count
    for value in _json_values(text, "xdt_api__v1__media__shortcode__web_info"):
        items = value.get("items") if isinstance(value, dict) else None
        if items:
            got, got_count = _media_comments(items[0], parent)
            if got:
                replies = got
            if got_count is not None:
                count = got_count
    if count is None:
        match = re.search(r'"comment_count"\s*:\s*(\d+)', text)
        if match:
            count = int(match.group(1))
    html_rows = _html_comments(text, parent)
    if html_rows and not replies:
        replies = html_rows
    if count is None:
        match = re.search(r"([0-9][0-9,]*)\s+comments\b", text, re.I)
        if match:
            count = int(match.group(1).replace(",", ""))
    return replies, count


def _html_comment(parent: dict, handle: str, text: str, likes=None) -> dict | None:
    body = clean_text(re.sub(r"<[^>]+>", "", text or ""))
    handle = (handle or "").strip().lstrip("@")
    if not body or not re.fullmatch(r"[A-Za-z0-9._]{1,30}", handle):
        return None
    cid = hashlib.sha1(f"{handle}:{body}".encode()).hexdigest()[:16]
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    parent_handle = parent.get("handle") or ""
    return post_shell(
        id=cid,
        statusId=cid,
        platform="instagram",
        kind="reply",
        author=handle,
        handle=handle,
        text=body,
        url=parent.get("url") or "",
        stats={"likes": likes} if likes is not None else {},
        replyingTo={"name": parent.get("author") or parent_handle, "handle": parent_handle, "id": parent_id} if parent_handle or parent_id else None,
    )


def _html_comments(html: str, parent: dict) -> list:
    found = []
    patterns = (
        r'class="CaptionCommentUsername"[^>]*href="/([A-Za-z0-9._]+)/?"[^>]*>.*?</a>\s*<span class="CaptionCommentContent"[^>]*>(.*?)</span>',
        r'class="comment-user".*?(?:@|/)([A-Za-z0-9._]{1,30}).*?class="comment-(?:text|body|content)"[^>]*>(.*?)</div>',
        r'class="comment-item".*?(?:@|/)([A-Za-z0-9._]{1,30}).*?class="comment-(?:text|body|content)"[^>]*>(.*?)</',
    )
    for pattern in patterns:
        for handle, text in re.findall(pattern, html, re.S):
            row = _html_comment(parent, handle, text)
            if row:
                found.append(row)
        if found:
            break
    found.sort(key=lambda post: ((post.get("stats") or {}).get("likes") or 0), reverse=True)
    return found[:CAP]
