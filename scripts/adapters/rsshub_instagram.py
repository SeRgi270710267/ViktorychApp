"""Normalize an RSSHub /instagram/user/<user> RSS feed."""

from __future__ import annotations

import re

from .common import (
    blank_profile,
    bridge_error_text,
    child_text,
    children,
    guard_posts,
    html_to_parts,
    local_name,
    parse_xml,
    post_shell,
    rfc822_to_iso,
)

POWERED = re.compile(r"\s*-\s*Powered by RSSHub\s*$", re.I)


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
    title = child_text(channel, "title")
    # "Mark Zuckerberg (@birchlane) - Instagram"
    match = re.search(r"@([\w.]+)", title)
    handle = feed.get("handle") or (match.group(1) if match else "instagram")
    name = re.sub(r"\s*\(@.*$", "", title).replace(" - Instagram", "").strip() or handle
    avatar = _image(channel)
    raw_bio = POWERED.sub("", child_text(channel, "description")).strip()
    bio = "" if bridge_error_text(raw_bio) else raw_bio
    profile = blank_profile("instagram", handle, name, avatar)
    profile["bio"] = bio
    posts = []
    for item in children(channel, "item"):
        parts = html_to_parts(child_text(item, "description"))
        text = parts["text"] or child_text(item, "title")
        creator = handle
        for child in list(item):
            if local_name(child.tag) == "creator" and child.text:
                creator = child.text.strip()
        guid = child_text(item, "guid") or child_text(item, "link")
        link = child_text(item, "link")
        posts.append(
            post_shell(
                id=guid,
                statusId=guid,
                platform="instagram",
                feedId=feed.get("id") or "",
                kind="post",
                author=name if creator == handle else creator,
                handle=creator,
                avatar=avatar,
                text=text,
                links=parts["links"],
                date=rfc822_to_iso(child_text(item, "pubDate")),
                url=link,
                media=parts["media"],
            )
        )
    posts = guard_posts(root, posts, channel_title=title, channel_description=raw_bio)
    return {"posts": posts, "profiles": [profile]}
