"""Write comments/<postId>.json for posts in a feed document.

X replies come from api.fxtwitter.com/2/conversation/<id>, then from Nitter
status HTML. Threads needs THREADS_COOKIE. Instagram needs INSTAGRAM_COOKIE.
RSS uses wfw:commentRss when the item has one. A missing cookie skips that
platform. A failed fetch keeps the previous comment file. Nothing here invents
a reply.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.ig_comments import parse_ig_comments  # noqa: E402
from adapters.rss_comments import parse_comment_rss  # noqa: E402
from adapters.threads_replies import parse_threads_replies  # noqa: E402
from adapters.x_replies import parse_fxtwitter_conversation, parse_nitter_replies  # noqa: E402
from x_guard import auth_cookie_header, open_url  # noqa: E402

UA = "rss-feeds-preview/1.0 (+https://github.com/owner-account/rss-feeds)"
NITTER_HOSTS = (
    "https://nitter.meowing.monster",
    "https://nitter.kareem.one",
    "https://nitter.jaydenha.uk",
)
FIXTURES = ROOT / "scripts" / "fixtures" / "replies"


def _get(url: str, headers: dict | None = None) -> str:
    req_headers = {"User-Agent": UA, "Accept": "*/*"}
    req_headers.update(auth_cookie_header(url))
    if headers:
        req_headers.update(headers)
    request = urllib.request.Request(url, headers=req_headers)
    with open_url(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def fetch_x(post: dict) -> tuple[list, str] | None:
    status_id = str(post.get("statusId") or post.get("id") or "")
    handle = post.get("handle") or "i"
    try:
        payload = _get(f"https://api.fxtwitter.com/2/conversation/{status_id}")
        return parse_fxtwitter_conversation(payload, status_id), "fxtwitter"
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[replies] fxtwitter {status_id}: {exc}", file=sys.stderr)
    for host in NITTER_HOSTS:
        try:
            html = _get(f"{host}/{handle}/status/{status_id}", {"User-Agent": "Mozilla/5.0"})
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            continue
        if "tweet-content" not in html:
            continue
        return parse_nitter_replies(html, status_id), host
    return None


def fetch_instagram(post: dict) -> tuple[list, str] | None:
    cookie = os.environ.get("INSTAGRAM_COOKIE") or ""
    if not cookie:
        return None
    status_id = str(post.get("statusId") or post.get("id") or "")
    header = cookie if "sessionid=" in cookie else f"sessionid={cookie}"
    try:
        payload = _get(
            f"https://www.instagram.com/api/v1/media/{status_id}/comments/?can_support_threading=true",
            {"Cookie": header, "X-IG-App-ID": "936619743392459"},
        )
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[replies] instagram {status_id}: {exc}", file=sys.stderr)
        return None
    return parse_ig_comments(payload, post), "instagram"


def fetch_threads(post: dict) -> tuple[list, str] | None:
    cookie = os.environ.get("THREADS_COOKIE") or ""
    if not cookie:
        return None
    handle = post.get("handle") or ""
    status_id = str(post.get("statusId") or post.get("id") or "")
    url = post.get("url") or f"https://www.threads.com/@{handle}/post/{status_id}"
    header = cookie if "=" in cookie else f"sessionid={cookie}"
    try:
        html = _get(url, {"Cookie": header, "User-Agent": "Mozilla/5.0"})
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[replies] threads {status_id}: {exc}", file=sys.stderr)
        return None
    replies = parse_threads_replies(html, post)
    if not replies:
        print(f"[replies] threads {status_id}: page had no reply_threads", file=sys.stderr)
        return None
    return replies, "threads"


def fetch_rss(post: dict) -> tuple[list, str] | None:
    url = post.get("commentRss") or ""
    if not url:
        return None
    try:
        payload = _get(url)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[replies] rss {post.get('id')}: {exc}", file=sys.stderr)
        return None
    return parse_comment_rss(payload, post), "commentRss"


def from_fixture(post: dict) -> tuple[list, str] | None:
    status_id = str(post.get("statusId") or post.get("id") or "")
    conversation = FIXTURES / f"{status_id}.json"
    if conversation.exists():
        return parse_fxtwitter_conversation(conversation.read_text(encoding="utf-8"), status_id), "fixture"
    nitter = FIXTURES / f"{status_id}.html"
    if nitter.exists():
        return parse_nitter_replies(nitter.read_text(encoding="utf-8"), status_id), "fixture-nitter"
    return None


def write_comments(post: dict, replies: list, source: str) -> None:
    status_id = str(post.get("statusId") or post.get("id") or "")
    dest = ROOT / "comments"
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{status_id}.json"
    doc = {
        "postId": status_id,
        "platform": post.get("platform") or "",
        "source": source,
        "replies": replies,
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[replies] {post.get('platform')}:{status_id} {len(replies)} via {source}")


def refresh(posts: list, use_fixtures: bool) -> None:
    seen = set()
    noted = set()
    for post in posts:
        status_id = str(post.get("statusId") or post.get("id") or "")
        platform = post.get("platform") or ""
        if not status_id or status_id in seen:
            continue
        seen.add(status_id)
        found = from_fixture(post) if use_fixtures else None
        if found is None and not use_fixtures:
            if platform == "x":
                found = fetch_x(post)
                time.sleep(0.3)
            elif platform == "instagram":
                if "instagram" not in noted and not os.environ.get("INSTAGRAM_COOKIE"):
                    print("[skip] instagram replies: set INSTAGRAM_COOKIE (sessionid) to fetch comments", file=sys.stderr)
                    noted.add("instagram")
                found = fetch_instagram(post)
            elif platform == "threads":
                if "threads" not in noted and not os.environ.get("THREADS_COOKIE"):
                    print("[skip] threads replies: public pages omit reply text; set THREADS_COOKIE to try", file=sys.stderr)
                    noted.add("threads")
                found = fetch_threads(post)
            elif post.get("commentRss"):
                found = fetch_rss(post)
        if found is None:
            continue
        replies, source = found
        write_comments(post, replies, source)
