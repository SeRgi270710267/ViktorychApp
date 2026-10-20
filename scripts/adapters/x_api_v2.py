"""Normalize an X API v2 user-timeline payload (data + includes)."""

from __future__ import annotations

import re

from .common import (
    best_mp4,
    blank_profile,
    post_shell,
    replace_entities,
    upgrade_avatar,
)

RT_TEXT = re.compile(r"^RT @[A-Za-z0-9_]+:\s*")


def _verified(user: dict | None):
    if not user:
        return None
    kind = user.get("verified_type")
    if kind and kind not in ("none", "None"):
        return kind
    if user.get("verified"):
        return "blue"
    return None


def _brief(user: dict | None) -> dict | None:
    if not user:
        return None
    return {
        "name": user.get("name") or "",
        "handle": user.get("username") or "",
        "avatar": upgrade_avatar(user.get("profile_image_url") or ""),
    }


def _profile(user: dict) -> dict:
    handle = user.get("username") or ""
    profile = blank_profile("x", handle, user.get("name") or handle, upgrade_avatar(user.get("profile_image_url") or ""))
    profile["verifiedType"] = _verified(user)
    profile["bio"] = user.get("description") or ""
    profile["location"] = user.get("location") or ""
    metrics = user.get("public_metrics") or {}
    if metrics.get("followers_count") is not None:
        profile["followers"] = metrics.get("followers_count")
    if metrics.get("following_count") is not None:
        profile["following"] = metrics.get("following_count")
    if metrics.get("tweet_count") is not None:
        profile["postsCount"] = metrics.get("tweet_count")
    banner = user.get("profile_banner_url") or ""
    if banner:
        profile["banner"] = banner
    return profile


def _stats(metrics: dict | None) -> dict:
    if not metrics:
        return {}
    mapping = {
        "replies": "reply_count",
        "reposts": "retweet_count",
        "quotes": "quote_count",
        "likes": "like_count",
        "views": "impression_count",
        "bookmarks": "bookmark_count",
    }
    out = {}
    for dest, src in mapping.items():
        if src in metrics and metrics[src] is not None:
            out[dest] = metrics[src]
    return out


def _media(tweet: dict, media_by_key: dict) -> list:
    keys = ((tweet.get("attachments") or {}).get("media_keys")) or []
    items = []
    for key in keys:
        media = media_by_key.get(key)
        if not media:
            continue
        kind = media.get("type") or "photo"
        variants = media.get("variants") or []
        mp4 = best_mp4(variants)
        url = media.get("url") or ""
        poster = media.get("preview_image_url") or ""
        if kind in ("video", "animated_gif"):
            url = mp4 or url or poster
            if not poster:
                poster = media.get("url") or ""
        else:
            url = url or poster
            poster = poster or url
        if not url:
            continue
        items.append(
            {
                "type": kind,
                "url": url,
                "poster": poster or "",
                "width": media.get("width"),
                "height": media.get("height"),
                "alt": media.get("alt_text") or "",
            }
        )
    return items


def _text(tweet: dict, quoted_id: str | None):
    note = tweet.get("note_tweet") or {}
    if note.get("text"):
        text = note.get("text") or ""
        entities = dict(note.get("entities") or {})
        urls = list(entities.get("urls") or [])
        seen = {u.get("url") for u in urls}
        for entry in (tweet.get("entities") or {}).get("urls") or []:
            raw = entry.get("url")
            if raw and raw in text and raw not in seen:
                urls.append(entry)
                seen.add(raw)
        entities["urls"] = urls
    else:
        text = tweet.get("text") or ""
        entities = tweet.get("entities") or {}
    return replace_entities(text, entities, quoted_id)


def _reply_target(tweet: dict, users: dict):
    refs = tweet.get("referenced_tweets") or []
    replied = any(ref.get("type") == "replied_to" for ref in refs)
    uid = tweet.get("in_reply_to_user_id")
    if not replied and not uid:
        return None
    if uid and uid in users:
        return _brief(users[uid])
    match = re.match(r"@([A-Za-z0-9_]{1,30})", tweet.get("text") or "")
    if match:
        return {"name": match.group(1), "handle": match.group(1), "avatar": ""}
    return None


def _convert(tweet: dict, ctx: dict, feed: dict, timeline: bool) -> dict:
    users = ctx["users"]
    tweets = ctx["tweets"]
    refs = {ref.get("type"): ref.get("id") for ref in (tweet.get("referenced_tweets") or [])}
    timeline_id = str(tweet.get("id") or "")
    wrapper_date = tweet.get("created_at") or ""
    reposted_by = None
    kind = "post"
    reply_source = tweet
    if timeline and refs.get("retweeted"):
        kind = "repost"
        reposted_by = _brief(users.get(tweet.get("author_id")))
        original = tweets.get(refs["retweeted"])
        if original:
            tweet = original
        reply_source = tweet
    elif timeline and (refs.get("replied_to") or tweet.get("in_reply_to_user_id")):
        kind = "reply"
    elif timeline and refs.get("quoted"):
        kind = "quote"

    displayed_refs = {ref.get("type"): ref.get("id") for ref in (tweet.get("referenced_tweets") or [])}
    quoted_id = displayed_refs.get("quoted")
    quoted = None
    if quoted_id and quoted_id in tweets:
        quoted = _convert(tweets[quoted_id], ctx, feed, timeline=False)
        if kind == "post":
            kind = "quote"
    elif refs.get("quoted") and refs["quoted"] in tweets and kind != "repost":
        quoted = _convert(tweets[refs["quoted"]], ctx, feed, timeline=False)

    text, links = _text(tweet, quoted_id or (quoted or {}).get("statusId"))
    if kind == "repost" and text.startswith("RT @"):
        text = RT_TEXT.sub("", text)
    author = users.get(tweet.get("author_id")) or {}
    handle = author.get("username") or ""
    status_id = str(tweet.get("id") or timeline_id)
    replying = _reply_target(reply_source, users) if kind in ("reply", "repost", "quote", "post") else None
    if kind != "reply" and kind != "repost":
        # quote/post cards only show the reply line when this tweet itself is a reply
        if not (reply_source.get("in_reply_to_user_id") or any(
            ref.get("type") == "replied_to" for ref in (reply_source.get("referenced_tweets") or [])
        )):
            replying = None
    if kind == "quote":
        replying = _reply_target(tweet, users)

    return post_shell(
        id=timeline_id if timeline else status_id,
        statusId=status_id,
        platform="x",
        feedId=feed.get("id") or "",
        kind=kind if timeline else "post",
        author=author.get("name") or handle,
        handle=handle,
        avatar=upgrade_avatar(author.get("profile_image_url") or ""),
        verifiedType=_verified(author),
        text=text,
        links=links,
        date=tweet.get("created_at") or wrapper_date,
        sortDate=wrapper_date if kind == "repost" and wrapper_date != (tweet.get("created_at") or "") else "",
        url=f"https://x.com/{handle}/status/{status_id}" if handle else (tweet.get("url") or ""),
        media=_media(tweet, ctx["media"]),
        stats=_stats(tweet.get("public_metrics")),
        repostedBy=reposted_by,
        replyingTo=replying,
        quoted=quoted,
    )


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    if isinstance(payload, str):
        from .common import parse_json_loose

        payload = parse_json_loose(payload)
    includes = payload.get("includes") or {}
    users = {u.get("id"): u for u in includes.get("users") or [] if u.get("id")}
    tweets = {}
    for tweet in (includes.get("tweets") or []) + (payload.get("data") or []):
        if tweet.get("id"):
            tweets[tweet["id"]] = tweet
    media = {}
    for item in includes.get("media") or []:
        if item.get("media_key"):
            media[item["media_key"]] = item
    ctx = {"users": users, "tweets": tweets, "media": media}
    posts = [_convert(tweet, ctx, feed, True) for tweet in payload.get("data") or []]
    profiles = []
    seen = set()
    for user in users.values():
        if not user.get("username") or user["username"] in seen:
            continue
        seen.add(user["username"])
        profiles.append(_profile(user))
    return {"posts": posts, "profiles": profiles}
