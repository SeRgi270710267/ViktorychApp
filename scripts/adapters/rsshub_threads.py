"""Normalize an RSSHub or RSS-Bridge Threads feed (RSS or Atom)."""

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
    strip_author_prefix,
)

TITLE_PREFIX = re.compile(r"^@[\w.]+\s*:\s*")
REPLY_MARK = "↩️"


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
    handle = feed.get("handle") or "threads"
    # dc:creator lives on items; channel title looks like "birchlane (@birchlane) on Threads"
    title = child_text(channel, "title")
    match = re.search(r"@([\w.]+)", title)
    if not feed.get("handle") and match:
        handle = match.group(1)
    name = title.split("(@")[0].strip() or handle
    avatar = _image(channel)
    profile = blank_profile("threads", handle, name, avatar)
    raw_bio = re.sub(r"\s*-\s*Powered by RSSHub\s*$", "", child_text(channel, "description") or child_text(channel, "subtitle")).strip()
    profile["bio"] = "" if bridge_error_text(raw_bio) else raw_bio
    if profile["bio"].lower().startswith(name.lower()) or "on threads" in profile["bio"].lower():
        profile["bio"] = ""
    posts = []
    for item in feed_items(channel):
        raw_html = item_html(item)
        parts = html_to_parts(raw_html)
        text = clean_meta_text(strip_author_prefix(parts["text"]))
        item_title = TITLE_PREFIX.sub("", child_text(item, "title"))
        if not text:
            text = clean_meta_text(item_title)
        creator = item_creator(item)
        item_handle = creator or handle
        link = item_permalink(item)
        code = meta_status_id("threads", item_guid(item), link)
        kind = "reply" if (REPLY_MARK in raw_html or REPLY_MARK in child_text(item, "title")) else "post"
        posts.append(
            post_shell(
                id=code,
                statusId=code,
                platform="threads",
                feedId=feed.get("id") or "",
                kind=kind,
                author=name if item_handle == handle else item_handle,
                handle=item_handle,
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
