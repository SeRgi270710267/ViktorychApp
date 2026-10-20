"""Normalize YouTube's official channel RSS feed.

https://www.youtube.com/feeds/videos.xml?channel_id=<UC…> needs no API key.
Thumbnails are rewritten to i.ytimg.com and are not downloaded.
"""

from __future__ import annotations

from .common import (
    blank_profile,
    child_text,
    children,
    clean_text,
    local_name,
    parse_xml,
    post_shell,
    profile_url,
    rfc822_to_iso,
)


def _child(el, name: str):
    for child in list(el or []):
        if local_name(child.tag) == name:
            return child
    return None


def _video_id(entry) -> str:
    found = child_text(entry, "videoId")
    if found:
        return found
    raw = child_text(entry, "id")
    if raw.startswith("yt:video:"):
        return raw.split(":", 2)[-1]
    return raw


def _published(entry) -> str:
    raw = child_text(entry, "published") or child_text(entry, "updated")
    if not raw:
        return ""
    if "T" in raw and raw.endswith("Z"):
        return raw
    iso = rfc822_to_iso(raw)
    if iso:
        return iso
    return raw.replace("+00:00", "Z")


def _thumbnail(video_id: str, group) -> str:
    if video_id:
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    thumb = _child(group, "thumbnail")
    url = (thumb.attrib.get("url") if thumb is not None else "") or ""
    if "ytimg.com/vi/" in url:
        code = url.split("/vi/", 1)[1].split("/", 1)[0]
        return f"https://i.ytimg.com/vi/{code}/hqdefault.jpg"
    return url


def _stats(group) -> dict:
    stats = {}
    community = _child(group, "community")
    if community is None:
        return stats
    rating = _child(community, "starRating")
    if rating is not None and rating.attrib.get("count"):
        try:
            stats["likes"] = int(rating.attrib["count"])
        except ValueError:
            pass
    viewed = _child(community, "statistics")
    if viewed is not None and viewed.attrib.get("views"):
        try:
            stats["views"] = int(viewed.attrib["views"])
        except ValueError:
            pass
    return stats


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    root = parse_xml(payload) if isinstance(payload, str) else payload
    handle = (feed.get("handle") or "").lstrip("@")
    channel_id = feed.get("channelId") or child_text(root, "channelId")
    if channel_id and not channel_id.startswith("UC"):
        channel_id = "UC" + channel_id
    name = child_text(root, "title") or (feed.get("profile") or {}).get("name") or handle
    author = _child(root, "author")
    if author is not None and child_text(author, "name"):
        name = child_text(author, "name")
    profile = blank_profile("youtube", handle or channel_id, name)
    profile["url"] = f"https://www.youtube.com/channel/{channel_id}" if channel_id else profile_url("youtube", handle)
    if channel_id:
        profile["channelId"] = channel_id
    posts = []
    for entry in children(root, "entry"):
        video_id = _video_id(entry)
        if not video_id:
            continue
        group = _child(entry, "group")
        title = clean_text(child_text(entry, "title") or (child_text(group, "title") if group is not None else ""))
        description = clean_text(child_text(group, "description") if group is not None else "")
        when = _published(entry)
        poster = _thumbnail(video_id, group)
        media = {
            "type": "video",
            "url": f"https://www.youtube-nocookie.com/embed/{video_id}",
            "poster": poster,
            "width": 480,
            "height": 360,
            "alt": "",
        }
        post = post_shell(
            id=video_id,
            statusId=video_id,
            platform="youtube",
            feedId=feed.get("id") or "",
            author=name,
            handle=handle or channel_id,
            text=title,
            date=when,
            url=f"https://www.youtube.com/watch?v={video_id}",
            media=[media],
            stats=_stats(group),
        )
        post["title"] = title
        if description and description != title:
            post["description"] = description
        posts.append(post)
    return {"posts": posts, "profiles": [profile]}
