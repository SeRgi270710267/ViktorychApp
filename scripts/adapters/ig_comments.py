"""Instagram comments. Only runs when INSTAGRAM_COOKIE (sessionid) is set.

Endpoint: https://www.instagram.com/api/v1/media/<id>/comments/
Header: Cookie: sessionid=... and X-IG-App-ID. The cookie is never written to disk.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .common import parse_json_loose, post_shell

CAP = 50


def _iso(value) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(int(value), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(value)


def parse_ig_comments(payload, parent: dict | None = None) -> list:
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
        out.append(
            post_shell(
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
        )
    out.sort(key=lambda post: ((post.get("stats") or {}).get("likes") or 0), reverse=True)
    return out[:CAP]
