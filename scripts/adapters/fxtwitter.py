"""Normalize api.fxtwitter.com/2/profile/<user>/statuses JSON."""

from __future__ import annotations

from .common import best_mp4, blank_profile, clean_text, post_shell, upgrade_avatar


def _badge(kind):
    if not kind or kind == "none":
        return None
    if kind == "individual":
        return "blue"
    return kind


def _verified(author: dict | None):
    if not author:
        return None
    verification = author.get("verification")
    if isinstance(verification, str):
        return _badge(verification)
    if isinstance(verification, dict):
        kind = _badge(verification.get("type") or verification.get("verified_type"))
        if kind:
            return kind
        if verification.get("verified") or verification.get("is_verified"):
            return "blue"
    if author.get("verified"):
        return "blue"
    return None


def _statuses(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("statuses", "data", "tweets", "timeline"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for inner in ("statuses", "data", "tweets"):
                if isinstance(value.get(inner), list):
                    return value[inner]
    return []


def _media(media) -> list:
    if not media:
        return []
    if isinstance(media, list):
        items = media
    elif isinstance(media, dict):
        items = media.get("all") or []
        if not items:
            items = list(media.get("photos") or []) + list(media.get("videos") or []) + list(media.get("gifs") or [])
    else:
        return []
    out = []
    for item in items:
        if isinstance(item, str):
            out.append({"type": "photo", "url": item, "poster": item, "width": None, "height": None, "alt": ""})
            continue
        if not isinstance(item, dict):
            continue
        kind = (item.get("type") or "photo").lower()
        if kind in ("gif", "animated_gif"):
            kind = "animated_gif"
        elif kind not in ("photo", "video", "animated_gif"):
            kind = "video" if item.get("variants") else "photo"
        mp4 = best_mp4(item.get("variants") or item.get("video_files") or [])
        poster = item.get("thumbnail_url") or item.get("poster") or item.get("preview_image_url") or ""
        url = item.get("url") or ""
        if kind in ("video", "animated_gif"):
            url = mp4 or url or poster
        else:
            url = url or poster
            poster = poster or url
        if not url:
            continue
        out.append(
            {
                "type": kind,
                "url": url,
                "poster": poster or "",
                "width": item.get("width"),
                "height": item.get("height"),
                "alt": item.get("alt") or item.get("alt_text") or "",
            }
        )
    return out


def _stats(status: dict) -> dict:
    mapping = {
        "replies": ("replies", "reply_count"),
        "reposts": ("reposts", "retweets", "retweet_count"),
        "quotes": ("quotes", "quote_count"),
        "likes": ("likes", "like_count", "favourites"),
        "views": ("views", "view_count", "impression_count"),
        "bookmarks": ("bookmarks", "bookmark_count"),
    }
    out = {}
    for dest, keys in mapping.items():
        for key in keys:
            if key in status and status[key] is not None:
                out[dest] = status[key]
                break
    return out


def _author_profile(author: dict) -> dict:
    handle = author.get("screen_name") or author.get("handle") or ""
    profile = blank_profile("x", handle, author.get("name") or handle, author.get("avatar_url") or "")
    profile["avatar"] = upgrade_avatar(profile["avatar"])
    profile["banner"] = author.get("banner_url") or ""
    profile["bio"] = author.get("description") or author.get("bio") or ""
    profile["location"] = author.get("location") or ""
    profile["website"] = author.get("website") or author.get("url") or ""
    if isinstance(profile["website"], dict):
        profile["website"] = profile["website"].get("url") or ""
    profile["verifiedType"] = _verified(author)
    if author.get("followers") is not None:
        profile["followers"] = author.get("followers")
    if author.get("following") is not None:
        profile["following"] = author.get("following")
    if author.get("tweets") is not None or author.get("posts") is not None:
        profile["postsCount"] = author.get("tweets") if author.get("tweets") is not None else author.get("posts")
    if author.get("joined"):
        profile["joined"] = author.get("joined")
    return profile


def _clean_text(text: str, quoted: dict | None):
    text = clean_text(text or "")
    links = []
    if quoted and quoted.get("url") and quoted["url"] in text:
        text = clean_text(text.replace(quoted["url"], ""))
    return text, links


def _person(obj) -> dict | None:
    if not obj or not isinstance(obj, dict):
        return None
    handle = obj.get("screen_name") or obj.get("handle") or ""
    if isinstance(obj.get("author"), dict) and not handle:
        return _person(obj["author"])
    if not handle and not obj.get("name"):
        return None
    person = {
        "name": obj.get("name") or handle,
        "handle": handle,
        "avatar": upgrade_avatar(obj.get("avatar_url") or obj.get("avatar") or ""),
    }
    status_id = obj.get("status") or obj.get("status_id")
    if status_id:
        person["id"] = str(status_id)
    return person


def convert_status(status: dict, feed: dict, nested: bool = False) -> dict:
    author = status.get("author") or {}
    handle = author.get("screen_name") or author.get("handle") or (feed.get("handle") if not nested else "") or ""
    name = author.get("name") or handle
    quoted = None
    if isinstance(status.get("quote"), dict):
        quoted = convert_status(status["quote"], feed, nested=True)
    reposted = _person(status.get("reposted_by") or status.get("retweeted_by"))
    replying = _person(status.get("replying_to") or status.get("replying_to_user") or status.get("in_reply_to"))
    if isinstance(status.get("replying_to"), str):
        replying = {"name": status["replying_to"], "handle": status["replying_to"].lstrip("@"), "avatar": ""}
    kind = "post"
    if reposted and not nested:
        kind = "repost"
    elif replying and not nested:
        kind = "reply"
    elif quoted and not nested:
        kind = "quote"
    text, links = _clean_text(status.get("text") or status.get("full_text") or "", quoted)
    status_id = str(status.get("id") or status.get("id_str") or "")
    url = status.get("url") or (f"https://x.com/{handle}/status/{status_id}" if handle and status_id else "")
    created = status.get("created_at") or status.get("date") or ""
    return post_shell(
        id=status_id,
        statusId=status_id,
        platform="x",
        feedId="" if nested else (feed.get("id") or ""),
        kind="post" if nested else kind,
        author=name,
        handle=handle,
        avatar=upgrade_avatar(author.get("avatar_url") or ""),
        verifiedType=_verified(author),
        text=text,
        links=links,
        date=created,
        url=url,
        media=_media(status.get("media")),
        stats={} if nested else _stats(status),
        repostedBy=None if nested else reposted,
        replyingTo=None if nested else replying,
        quoted=None if nested else quoted,
    )


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    if isinstance(payload, str):
        from .common import parse_json_loose

        payload = parse_json_loose(payload)
    posts = []
    profiles = {}
    for status in _statuses(payload):
        if not isinstance(status, dict):
            continue
        posts.append(convert_status(status, feed, nested=False))
        author = status.get("author") or {}
        handle = (author.get("screen_name") or author.get("handle") or "").lower()
        if handle and handle not in profiles:
            profiles[handle] = _author_profile(author)
        quote = status.get("quote") or {}
        qh = ((quote.get("author") or {}).get("screen_name") or "").lower()
        if qh and qh not in profiles:
            profiles[qh] = _author_profile(quote.get("author") or {})
    return {"posts": posts, "profiles": list(profiles.values())}
