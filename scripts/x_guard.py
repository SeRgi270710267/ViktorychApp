"""Keep the sync off the paid X API except one replies fallback.

Live X posts come from fxtwitter and Nitter. TWITTER_AUTH_TOKEN, when set, is
sent only as a cookie to Nitter and to RSSHub X/Twitter routes. It is never
sent to api.x.com or api.twitter.com. X_BEARER_TOKEN is read only by
conversation_search, which calls the recent-search endpoint for one
conversation id and nowhere else.
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
from site_paths import user_agent  # noqa: E402

X_API_HOSTS = frozenset(
    {
        "api.x.com",
        "api.twitter.com",
        "ads-api.x.com",
        "ads-api.twitter.com",
    }
)


class _RefuseXApi(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        assert_not_x_api(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def assert_not_x_api(url: str) -> None:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host in X_API_HOSTS or host.endswith(".api.twitter.com"):
        raise ValueError(f"refusing {host}: the paid X API is not used")


def _x_cookie_target(url: str) -> bool:
    parts = urllib.parse.urlparse(url)
    host = (parts.hostname or "").lower()
    path = parts.path.lower()
    if "nitter" in host:
        return True
    return path.startswith("/twitter") or path.startswith("/x/") or "/twitter/" in path


def auth_cookie_header(url: str) -> dict:
    """Optional user cookie for Nitter and RSSHub X routes. Empty for everything else."""
    token = (os.environ.get("TWITTER_AUTH_TOKEN") or "").strip()
    if not token or not _x_cookie_target(url):
        return {}
    cookie = token if "auth_token=" in token else f"auth_token={token}"
    return {"Cookie": cookie}


def open_url(request: urllib.request.Request, timeout: int = 30):
    assert_not_x_api(request.full_url)
    opener = urllib.request.build_opener(_RefuseXApi)
    return opener.open(request, timeout=timeout)


def conversation_search(status_id: str, timeout: int = 20) -> str | None:
    """Last-resort recent search for one conversation, only when a bearer token is set.

    Every other call still refuses api.x.com and api.twitter.com. The token is
    not printed and is not sent anywhere else.
    """
    token = (os.environ.get("X_BEARER_TOKEN") or "").strip()
    status_id = str(status_id or "")
    if not token or not status_id.isdigit():
        return None
    query = urllib.parse.urlencode(
        {
            "query": f"conversation_id:{status_id}",
            "max_results": "20",
            "tweet.fields": "created_at,public_metrics,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,note_tweet,entities,attachments",
            "expansions": "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id",
            "user.fields": "name,username,profile_image_url,verified,verified_type,public_metrics,created_at",
            "media.fields": "url,preview_image_url,type,width,height,alt_text,variants",
        }
    )
    url = "https://api.twitter.com/2/tweets/search/recent?" + query
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    path = urllib.parse.urlparse(url).path
    if host != "api.twitter.com" or path != "/2/tweets/search/recent":
        raise ValueError(f"refusing {host}{path}")
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "User-Agent": user_agent()},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
