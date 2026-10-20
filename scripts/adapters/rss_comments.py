"""Replies from an RSS wfw:commentRss feed. slash:comments is only a count."""

from __future__ import annotations

from .generic_rss import parse as parse_feed


def parse_comment_rss(payload, parent: dict | None = None) -> list:
    parent = parent or {}
    parsed = parse_feed(payload, {"platform": parent.get("platform") or "rss", "handle": parent.get("handle") or "rss", "id": parent.get("feedId") or ""})
    parent_id = str(parent.get("statusId") or parent.get("id") or "")
    out = []
    for post in parsed.get("posts") or []:
        post["kind"] = "reply"
        post["replyingTo"] = {
            "name": parent.get("author") or parent.get("handle") or "",
            "handle": parent.get("handle") or "",
            "id": parent_id,
        }
        out.append(post)
    out.sort(key=lambda item: ((item.get("stats") or {}).get("likes") or 0), reverse=True)
    return out[:50]
