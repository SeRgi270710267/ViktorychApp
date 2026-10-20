"""Threads replies.

The public post page does not include reply text. When THREADS_COOKIE is set,
the same page is fetched with that cookie and any embedded reply_threads JSON
is normalized. Without the cookie the fetcher is skipped. The cookie is never
stored.
"""

from __future__ import annotations

import json
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


def parse_threads_replies(payload, parent: dict | None = None) -> list:
    parent = parent or {}
    rows = _reply_rows(payload)
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    parent_handle = parent.get("handle") or ""
    out = []
    for row in rows:
        post = row.get("post") if isinstance(row, dict) and "post" in row else row
        if not isinstance(post, dict):
            continue
        user = post.get("user") or {}
        handle = user.get("username") or ""
        caption = post.get("caption") or {}
        body = caption.get("text") if isinstance(caption, dict) else post.get("text") or ""
        sid = str(post.get("pk") or post.get("id") or post.get("code") or "")
        if not sid:
            continue
        likes = post.get("like_count")
        out.append(
            post_shell(
                id=sid,
                statusId=sid,
                platform="threads",
                kind="reply",
                author=user.get("full_name") or handle,
                handle=handle,
                avatar=user.get("profile_pic_url") or "",
                text=body or "",
                date=_iso(post.get("taken_at")),
                url=parent.get("url") or "",
                stats={"likes": likes} if likes is not None else {},
                replyingTo={"name": parent.get("author") or parent_handle, "handle": parent_handle, "id": parent_id} if parent_id or parent_handle else None,
            )
        )
    out.sort(key=lambda item: ((item.get("stats") or {}).get("likes") or 0), reverse=True)
    return out[:CAP]
