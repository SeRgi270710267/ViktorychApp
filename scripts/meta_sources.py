"""Where a public Instagram or Threads timeline is read from.

The sync tries the local RSSHub and RSS-Bridge containers first, then public
mirrors. Nothing here is an account handle.
"""

from __future__ import annotations


def rsshub_bases() -> tuple:
    return (
        "{rsshubBase}",
        "https://rsshub.app",
        "https://rsshub.pseudoyu.com",
        "https://rsshub.rss.tips",
    )


def instagram_rss_urls() -> list:
    return [base.rstrip("/") + "/instagram/user/{handle}" for base in rsshub_bases()]


def threads_rss_urls() -> list:
    return [base.rstrip("/") + "/threads/{handle}" for base in rsshub_bases()]


def instagram_bridge_urls() -> list:
    return [
        "http://localhost:8080/?action=display&bridge=InstagramBridge&context=Username&u={handle}&format=Atom",
        "https://rss-bridge.org/bridge01/?action=display&bridge=InstagramBridge&context=Username&u={handle}&format=Atom",
    ]


def threads_bridge_urls() -> list:
    return [
        "http://localhost:8080/?action=display&bridge=ThreadsBridge&context=Username&u={handle}&format=Atom",
        "https://rss-bridge.org/bridge01/?action=display&bridge=ThreadsBridge&context=Username&u={handle}&format=Atom",
    ]


def feed_urls(platform: str) -> list:
    if platform == "instagram":
        return instagram_rss_urls() + instagram_bridge_urls()
    if platform == "threads":
        return threads_rss_urls() + threads_bridge_urls()
    return []
