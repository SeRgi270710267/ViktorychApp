"""Normalize an RSSHub Twitter user timeline, strictly.

RSSHub's /twitter/user route returns the same item shape a Nitter RSS feed
does, so the Nitter parser does the work. It is a last-resort lane, so a post
that does not carry a numeric status id is dropped instead of being published
with a link or a guid as its id. A lane that cannot prove the id contributes
nothing, and the feed keeps the posts it already has.
"""

from __future__ import annotations

from .nitter_rss import parse as parse_timeline


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    result = parse_timeline(payload, feed) or {}
    posts = []
    for post in result.get("posts") or []:
        if not isinstance(post, dict):
            continue
        if not str(post.get("statusId") or "").isdigit():
            continue
        if not str(post.get("url") or "").startswith("https://x.com/"):
            continue
        posts.append(post)
    profiles = []
    for profile in result.get("profiles") or []:
        if not isinstance(profile, dict):
            continue
        clean = dict(profile)
        if feed.get("handle"):
            clean["handle"] = feed.get("handle")
            clean["name"] = clean.get("name") or feed.get("handle")
            clean["platform"] = "x"
            clean["url"] = "https://x.com/" + feed.get("handle")
        profiles.append(clean)
    return {"posts": posts, "profiles": profiles}
