"""Normalize a generic RSS or Atom feed into the shared post schema."""

from __future__ import annotations

from .common import (
    blank_profile,
    child_text,
    children,
    html_to_parts,
    local_name,
    parse_xml,
    post_shell,
    rfc822_to_iso,
)


def _channel(root):
    name = local_name(root.tag)
    if name in ("channel", "feed"):
        return root
    for child in list(root):
        if local_name(child.tag) in ("channel", "feed"):
            return child
    return root


def _enclosures(item) -> list:
    media = []
    for child in list(item):
        name = local_name(child.tag)
        if name == "enclosure":
            url = child.attrib.get("url") or ""
            ctype = (child.attrib.get("type") or "").lower()
            if not url:
                continue
            kind = "video" if ctype.startswith("video") else "photo" if ctype.startswith("image") else "photo"
            if ctype.startswith("audio"):
                continue
            media.append({"type": kind, "url": url, "poster": url if kind == "photo" else "", "width": None, "height": None, "alt": ""})
        elif name == "content":
            url = child.attrib.get("url") or ""
            medium = (child.attrib.get("medium") or child.attrib.get("type") or "").lower()
            if not url:
                continue
            kind = "video" if "video" in medium else "photo"
            media.append(
                {
                    "type": kind,
                    "url": url,
                    "poster": child.attrib.get("poster") or (url if kind == "photo" else ""),
                    "width": None,
                    "height": None,
                    "alt": "",
                }
            )
        elif name == "group":
            media.extend(_enclosures(child))
    return media


def _content_html(item) -> str:
    encoded = ""
    description = ""
    for child in list(item):
        name = local_name(child.tag)
        text = "".join(child.itertext()).strip() if name in ("encoded", "content") else (child.text or "")
        if name == "encoded" and text:
            encoded = text
        elif name in ("description", "summary", "content") and text and not description:
            description = text if name != "content" or not encoded else description
            if name == "content" and not encoded:
                encoded = "".join(child.itertext())
    return encoded or description


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    root = parse_xml(payload) if isinstance(payload, str) else payload
    channel = _channel(root)
    title = child_text(channel, "title") or feed.get("handle") or "RSS"
    handle = feed.get("handle") or "rss"
    site = child_text(channel, "link")
    image = ""
    for child in list(channel):
        if local_name(child.tag) == "image":
            image = child_text(child, "url")
        elif local_name(child.tag) == "icon" and child.text:
            image = child.text.strip()
    platform = feed.get("platform") or "rss"
    profile = blank_profile(platform, handle, title, image)
    profile["url"] = site or profile["url"]
    profile["bio"] = child_text(channel, "subtitle") or child_text(channel, "description")
    posts = []
    items = children(channel, "item") or children(channel, "entry")
    for item in items:
        html = _content_html(item)
        parts = html_to_parts(html)
        item_title = child_text(item, "title")
        text = parts["text"] or item_title
        if item_title and item_title not in text:
            text = (item_title + "\n\n" + text).strip() if text else item_title
        link = child_text(item, "link")
        if not link:
            for child in list(item):
                if local_name(child.tag) == "link":
                    link = child.attrib.get("href") or (child.text or "")
                    if link:
                        break
        guid = child_text(item, "guid") or child_text(item, "id") or link
        published = child_text(item, "pubDate") or child_text(item, "published") or child_text(item, "updated")
        date = rfc822_to_iso(published) if "GMT" in published or "," in published else published
        media = list(parts["media"])
        seen = {m.get("url") for m in media}
        for extra in _enclosures(item):
            if extra["url"] not in seen:
                media.append(extra)
                seen.add(extra["url"])
        quoted = None
        kind = "post"
        if parts["quotes"]:
            kind = "quote"
            quoted = post_shell(
                id=guid + "#q",
                platform=platform,
                kind="post",
                author="",
                handle="",
                text=parts["quotes"][0].get("text") or "",
                media=parts["quotes"][0].get("media") or [],
                url=link,
            )
        posts.append(
            post_shell(
                id=guid,
                statusId=guid,
                platform=platform,
                feedId=feed.get("id") or "",
                kind=kind,
                author=title,
                handle=handle,
                avatar=image,
                text=text,
                links=parts["links"],
                date=date,
                url=link,
                media=media,
                quoted=quoted,
            )
        )
    return {"posts": posts, "profiles": [profile]}
