"""Threads replies from the logged-out post page, then a session cookie.

The public page embeds the post and the first replies in script JSON
(`reply_threads`, `thread_items`, or `text_post_app_info.direct_replies`).
THREADS_COOKIE is only used when that page has no reply text. The cookie is
never stored.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from .common import post_shell

CAP = 50


def _iso(value) -> str:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(int(value), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value or "")


def _reply_rows(payload) -> list:
    if isinstance(payload, dict):
        rows = payload.get("reply_threads") or []
        return rows if isinstance(rows, list) else []
    text = payload if isinstance(payload, str) else ""
    key = '"reply_threads"'
    start = text.find(key)
    if start < 0:
        return []
    colon = text.find(":", start + len(key))
    if colon < 0:
        return []
    index = colon + 1
    while index < len(text) and text[index] in " \n\r\t":
        index += 1
    try:
        rows, _end = json.JSONDecoder().raw_decode(text, index)
    except json.JSONDecodeError:
        return []
    return rows if isinstance(rows, list) else []


def _one_reply(post: dict, parent: dict, depth: int = 0) -> dict | None:
    if not isinstance(post, dict):
        return None
    user = post.get("user") or {}
    handle = user.get("username") or ""
    caption = post.get("caption") or {}
    body = caption.get("text") if isinstance(caption, dict) else post.get("text") or ""
    sid = str(post.get("pk") or post.get("id") or post.get("code") or "")
    if not sid:
        return None
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    parent_handle = parent.get("handle") or ""
    likes = post.get("like_count")
    stats = {"likes": likes} if likes is not None else {}
    info = post.get("text_post_app_info") if isinstance(post.get("text_post_app_info"), dict) else {}
    for key in ("direct_reply_count", "reply_count"):
        value = info.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            stats["replies"] = value
            break
    code = str(post.get("code") or "")
    url = f"https://www.threads.net/t/{code}" if code else (parent.get("url") or "")
    item = post_shell(
        id=sid,
        statusId=sid,
        platform="threads",
        kind="reply",
        author=user.get("full_name") or handle,
        handle=handle,
        avatar=user.get("profile_pic_url") or "",
        text=body or "",
        date=_iso(post.get("taken_at")),
        url=url,
        stats=stats,
        replyingTo={"name": parent.get("author") or parent_handle, "handle": parent_handle, "id": parent_id} if parent_id or parent_handle else None,
    )
    if depth == 0:
        direct = info.get("direct_replies") or {}
        edges = direct.get("edges") if isinstance(direct, dict) else None
        kids = []
        if isinstance(edges, list):
            child_parent = {"statusId": sid, "id": sid, "handle": handle, "author": user.get("full_name") or handle, "url": url}
            for edge in edges:
                inner = edge.get("node") if isinstance(edge, dict) else None
                if not isinstance(inner, dict):
                    continue
                for child_post in _posts_under(inner):
                    kid = _one_reply(child_post, child_parent, depth=1)
                    if kid and kid["id"] != sid:
                        kids.append(kid)
        if kids:
            item["_children"] = kids[:20]
    return item


def _sort_cap(rows: list) -> list:
    rows.sort(key=lambda item: ((item.get("stats") or {}).get("likes") or 0), reverse=True)
    return rows[:CAP]


def parse_threads_replies(payload, parent: dict | None = None) -> list:
    parent = parent or {}
    rows = _reply_rows(payload)
    out = []
    for row in rows:
        post = row.get("post") if isinstance(row, dict) and "post" in row else row
        item = _one_reply(post, parent)
        if item:
            out.append(item)
    return _sort_cap(out)


def _script_json(text: str) -> list:
    blobs = []
    for match in re_script(text):
        blob = match.strip()
        if not blob or blob[0] not in "{[":
            continue
        try:
            blobs.append(json.loads(blob))
        except json.JSONDecodeError:
            continue
    return blobs


def re_script(text: str):
    return re.findall(r"<script[^>]*>(.*?)</script>", text, re.S)


def _count(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    return None


def _posts_under(node: dict) -> list:
    posts = []
    if isinstance(node.get("post"), dict):
        posts.append(node["post"])
    nested = node.get("posts")
    edges = nested.get("edges") if isinstance(nested, dict) else None
    if isinstance(edges, list):
        for edge in edges:
            inner = edge.get("node") if isinstance(edge, dict) else None
            if not isinstance(inner, dict):
                continue
            posts.append(inner.get("post") if isinstance(inner.get("post"), dict) else inner)
    if not posts and (node.get("caption") or node.get("user") or node.get("code")):
        posts.append(node)
    return posts


def _absorb(node: dict, info: dict, parent: dict, parent_id: str) -> tuple[list, int | None]:
    found = []
    count = None
    for key in ("direct_reply_count", "reply_count"):
        value = _count(info.get(key))
        if value is not None:
            count = value
    direct = info.get("direct_replies") or {}
    edges = direct.get("edges") if isinstance(direct, dict) else None
    if isinstance(edges, list):
        for edge in edges:
            inner = edge.get("node") if isinstance(edge, dict) else None
            if isinstance(inner, dict):
                for post in _posts_under(inner):
                    item = _one_reply(post, parent)
                    if item and item["id"] != parent_id:
                        found.append(item)
    if isinstance(node.get("reply_threads"), list):
        found.extend(parse_threads_replies({"reply_threads": node["reply_threads"]}, parent))
    return found, count


def _collect(obj, parent: dict, parent_id: str):
    found = []
    count = None
    matched = False
    first = None

    def visit(node, depth=0):
        nonlocal matched, first, count
        if depth > 40:
            return
        if isinstance(node, list):
            for item in node:
                visit(item, depth + 1)
            return
        if not isinstance(node, dict):
            return
        info = node.get("text_post_app_info")
        if isinstance(info, dict) and (info.get("direct_replies") or "direct_reply_count" in info or "reply_count" in info):
            code = str(node.get("code") or node.get("pk") or node.get("id") or "")
            if parent_id and code == parent_id:
                matched = True
                rows, got = _absorb(node, info, parent, parent_id)
                found.extend(rows)
                if got is not None:
                    count = got
            elif first is None:
                first = (node, info)
        items = node.get("thread_items")
        if isinstance(items, list) and len(items) > 1:
            root_code = ""
            root = items[0].get("post") if isinstance(items[0], dict) and "post" in items[0] else items[0]
            if isinstance(root, dict):
                root_code = str(root.get("code") or root.get("pk") or root.get("id") or "")
            if not parent_id or not root_code or root_code == parent_id:
                for item in items[1:]:
                    post = item.get("post") if isinstance(item, dict) and "post" in item else item
                    reply = _one_reply(post, parent)
                    if reply and reply["id"] != parent_id:
                        found.append(reply)
                        matched = True
        code = str(node.get("code") or node.get("pk") or "")
        if isinstance(node.get("reply_threads"), list) and (not code or not parent_id or code == parent_id):
            found.extend(parse_threads_replies({"reply_threads": node["reply_threads"]}, parent))
            matched = True
        for value in node.values():
            if isinstance(value, (dict, list)):
                visit(value, depth + 1)

    visit(obj)
    return found, count, matched, first


def parse_threads_document(payload, parent: dict | None = None) -> tuple[list, int | None]:
    """Replies plus the real reply count from a Threads page or JSON payload."""
    parent = parent or {}
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    blobs = []
    if isinstance(payload, dict):
        blobs = [payload]
    elif isinstance(payload, str):
        blobs = _script_json(payload)
        rows = _reply_rows(payload)
        if rows:
            blobs.append({"reply_threads": rows})
    seen = set()
    replies = []
    count = None
    matched = False
    fallback = None
    for blob in blobs:
        got, got_count, blob_matched, first = _collect(blob, parent, parent_id)
        if blob_matched:
            matched = True
            for item in got:
                if item["id"] in seen:
                    continue
                seen.add(item["id"])
                replies.append(item)
            if got_count is not None:
                count = got_count
        elif fallback is None and first is not None:
            fallback = first
    if not matched and fallback is not None:
        got, got_count = _absorb(fallback[0], fallback[1], parent, parent_id)
        for item in got:
            if item["id"] not in seen:
                replies.append(item)
        count = got_count
    return _sort_cap(replies), count
