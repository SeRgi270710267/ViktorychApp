"""Normalize an RSSHub or RSS-Bridge Instagram feed (RSS or Atom)."""

from __future__ import annotations

import re

from .common import (
    blank_profile,
    bridge_error_text,
    child_text,
    clean_meta_text,
    feed_items,
    guard_posts,
    html_to_parts,
    item_creator,
    item_guid,
    item_html,
    item_permalink,
    item_published,
    local_name,
    meta_status_id,
    parse_xml,
    post_shell,
)

POWERED = re.compile(r"\s*-\s*Powered by RSSHub\s*$", re.I)


def _channel(root):
    if local_name(root.tag) in ("channel", "feed"):
        return root
    for child in list(root):
        if local_name(child.tag) in ("channel", "feed"):
            return child
    return root


def _image(channel) -> str:
    for child in list(channel):
        if local_name(child.tag) == "image":
            return child_text(child, "url")
        if local_name(child.tag) in ("icon", "logo") and (child.text or "").strip().startswith("http"):
            return child.text.strip()
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
    raw_bio = POWERED.sub("", child_text(channel, "description") or child_text(channel, "subtitle")).strip()
    bio = "" if bridge_error_text(raw_bio) else raw_bio
    profile = blank_profile("instagram", handle, name, avatar)
    profile["bio"] = bio
    posts = []
    for item in feed_items(channel):
        raw_html = item_html(item)
        parts = html_to_parts(raw_html)
        text = clean_meta_text(parts["text"] or child_text(item, "title"))
        creator = item_creator(item) or handle
        link = item_permalink(item)
        code = meta_status_id("instagram", item_guid(item), link)
        posts.append(
            post_shell(
                id=code,
                statusId=code,
                platform="instagram",
                feedId=feed.get("id") or "",
                kind="post",
                author=name if creator == handle else creator,
                handle=creator,
                avatar=avatar,
                text=text,
                links=parts["links"],
                date=item_published(item),
                url=link,
                media=parts["media"],
            )
        )
    posts = guard_posts(root, posts, channel_title=title, channel_description=raw_bio)
    return {"posts": posts, "profiles": [profile]}
