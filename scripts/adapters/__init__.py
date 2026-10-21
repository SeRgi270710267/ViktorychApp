"""Per-source adapters that normalize posts into one X-shaped schema."""

from . import fxtwitter, generic_rss, nitter_rss, rsshub_instagram, rsshub_threads, vk, x_api_v2, youtube_community, youtube_rss

ADAPTERS = {
    "x_api_v2": x_api_v2.parse,
    "fxtwitter": fxtwitter.parse,
    "nitter_rss": nitter_rss.parse,
    "rsshub_threads": rsshub_threads.parse,
    "rsshub_instagram": rsshub_instagram.parse,
    "generic_rss": generic_rss.parse,
    "youtube_rss": youtube_rss.parse,
    "youtube_community": youtube_community.parse,
    "vk": vk.parse,
}

__all__ = ["ADAPTERS"]
