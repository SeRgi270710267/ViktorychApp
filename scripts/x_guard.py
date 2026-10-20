"""Keep the sync off the paid X API.

Live X posts come from fxtwitter and Nitter. TWITTER_AUTH_TOKEN, when set, is
sent only as a cookie to Nitter and to RSSHub X/Twitter routes. It is never
sent to api.x.com or api.twitter.com, and no bearer token is read.
"""

from __future__ import annotations

import os
import urllib.parse
import urllib.request

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
