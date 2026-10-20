"""Normalize an RSSHub /threads/<user> RSS feed."""

from __future__ import annotations

import re

from .common import (
    blank_profile,
    child_text,
    children,
    html_to_parts,
    local_name,
    parse_xml,
    post_shell,
    rfc822_to_iso,
    strip_author_prefix,
)

TITLE_PREFIX = re.compile(r"^@[\w.]+\s*:\s*")
REPLY_MARK = "↩️"


def _channel(root):
    if local_name(root.tag) == "channel":
        return root
    for child in list(root):
        if local_name(child.tag) == "channel":
            return child
    return root


def _image(channel) -> str:
    for child in list(channel):
        if local_name(child.tag) == "image":
            return child_text(child, "url")
    return ""


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    root = parse_xml(payload) if isinstance(payload, str) else payload
    channel = _channel(root)
    handle = feed.get("handle") or child_text(channel, "dc:creator") or "threads"
    # dc:creator lives on items; channel title looks like "redacted_handle (@redacted_handle) on Threads"
    title = child_text(channel, "title")
    match = re.search(r"@([\w.]+)", title)
    if not feed.get("handle") and match:
        handle = match.group(1)
    name = title.split("(@")[0].strip() or handle
    avatar = _image(channel)
    profile = blank_profile("threads", handle, name, avatar)
    profile["bio"] = re.sub(r"\s*-\s*Powered by RSSHub\s*$", "", child_text(channel, "description")).strip()
    if profile["bio"].lower().startswith(name.lower()) or "on threads" in profile["bio"].lower():
        profile["bio"] = ""
    posts = []
    for item in children(channel, "item"):
        raw_html = child_text(item, "description")
        parts = html_to_parts(raw_html)
        text = strip_author_prefix(parts["text"])
        item_title = TITLE_PREFIX.sub("", child_text(item, "title"))
        if not text:
            text = item_title
        creator = ""
        for child in list(item):
            if local_name(child.tag) == "creator" and child.text:
                creator = child.text.strip()
        item_handle = creator or handle
        link = child_text(item, "link")
        guid = child_text(item, "guid") or link
        if guid.startswith("http"):
            guid = guid.rstrip("/").rsplit("/", 1)[-1] or guid
        kind = "reply" if (REPLY_MARK in raw_html or REPLY_MARK in child_text(item, "title")) else "post"
        posts.append(
            post_shell(
                id=guid,
                statusId=guid,
                platform="threads",
                feedId=feed.get("id") or "",
                kind=kind,
                author=name if item_handle == handle else item_handle,
                handle=item_handle,
                avatar=avatar,
                text=text,
                links=parts["links"],
                date=rfc822_to_iso(child_text(item, "pubDate")),
                url=link,
                media=parts["media"],
            )
        )
    return {"posts": posts, "profiles": [profile]}
