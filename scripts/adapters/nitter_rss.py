"""Normalize a Nitter (or Nitter-like) RSS feed."""

from __future__ import annotations

import re

from .common import (
    AUTHOR_AT,
    RT_BY,
    blank_profile,
    child_text,
    children,
    clean_text,
    html_to_parts,
    local_name,
    parse_xml,
    post_shell,
    rfc822_to_iso,
    strip_author_prefix,
)

STATUS_RE = re.compile(r"/([A-Za-z0-9_]{1,30})/status/(\d+)")


def _channel(root):
    if local_name(root.tag) == "channel":
        return root
    for child in list(root):
        if local_name(child.tag) == "channel":
            return child
    return root


def _quote_from(parts: dict, url: str):
    if not parts.get("quotes"):
        return None
    raw = parts["quotes"][0]
    text = raw.get("text") or ""
    handle = ""
    match = re.search(r"@([A-Za-z0-9_]{1,30})", text)
    if match:
        handle = match.group(1)
        text = re.sub(r"^@%s\s*:?\s*" % re.escape(handle), "", text).strip()
    status = STATUS_RE.search(url or "")
    quoted_url = ""
    if status and handle:
        quoted_url = f"https://x.com/{handle}/status/{status.group(2)}"
    elif handle:
        quoted_url = f"https://x.com/{handle}"
    return post_shell(
        id=(status.group(2) if status else ""),
        platform="x",
        kind="post",
        author=handle,
        handle=handle,
        text=text,
        url=quoted_url,
        media=raw.get("media") or [],
        date="",
    )


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    root = parse_xml(payload) if isinstance(payload, str) else payload
    channel = _channel(root)
    image = ""
    for child in list(channel):
        if local_name(child.tag) == "image":
            image = child_text(child, "url")
            break
    title = child_text(channel, "title")
    handle = feed.get("handle") or ""
    name = title.split("/")[0].strip() if title else handle
    if not handle:
        match = re.search(r"@([A-Za-z0-9_]{1,30})", title)
        handle = match.group(1) if match else "rss"
    owner = blank_profile("x", handle, name or handle, image)
    posts = []
    for item in children(channel, "item"):
        item_title = child_text(item, "title")
        link = child_text(item, "link")
        guid = child_text(item, "guid") or link
        html = child_text(item, "description")
        parts = html_to_parts(html)
        text = strip_author_prefix(parts["text"] or item_title)
        kind = "post"
        reposted_by = None
        rt = RT_BY.match(item_title.strip())
        if rt:
            kind = "repost"
            reposted_by = {"name": rt.group(1), "handle": rt.group(1), "avatar": image}
            text = clean_text(RT_BY.sub("", item_title)) if not parts["text"] else text
        author_handle = handle
        author_name = name or handle
        found = AUTHOR_AT.search(html or "")
        if found and kind == "repost":
            author_handle = found.group(1)
            author_name = author_handle
        status = STATUS_RE.search(link or guid or "")
        status_id = status.group(2) if status else (guid or link)
        if status and kind == "repost":
            author_handle = status.group(1)
            author_name = author_handle
        quoted = _quote_from(parts, link)
        if quoted and kind == "post":
            kind = "quote"
        posts.append(
            post_shell(
                id=str(status_id),
                statusId=str(status_id),
                platform="x",
                feedId=feed.get("id") or "",
                kind=kind,
                author=author_name,
                handle=author_handle,
                avatar="" if kind == "repost" else image,
                text=text,
                links=parts["links"],
                date=rfc822_to_iso(child_text(item, "pubDate")),
                url=f"https://x.com/{author_handle}/status/{status_id}" if str(status_id).isdigit() else (link or ""),
                media=parts["media"],
                repostedBy=reposted_by,
                quoted=quoted,
            )
        )
    return {"posts": posts, "profiles": [owner]}
