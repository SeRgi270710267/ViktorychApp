"""Write comments/<postId>.json for posts in a feed document.

X replies come from api.fxtwitter.com/2/conversation/<id>, then Nitter.
Instagram tries the logged-out GraphQL post query, the captioned embed, public
viewers, and RSSHub before INSTAGRAM_COOKIE. Threads tries the logged-out post
page, then RSSHub, then THREADS_COOKIE. RSS uses wfw:commentRss. A failed
fetch keeps the previous comment file. Nothing here invents a reply.
"""

from __future__ import annotations

import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.ig_comments import parse_ig_comments, parse_ig_document  # noqa: E402
from adapters.rss_comments import parse_comment_rss  # noqa: E402
from adapters.threads_replies import parse_threads_document  # noqa: E402
from adapters.x_replies import parse_fxtwitter_conversation, parse_nitter_replies  # noqa: E402

UA = "rss-feeds-preview/1.0 (+https://github.com/owner-account/rss-feeds)"
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
NITTER_HOSTS = (
    "https://nitter.meowing.monster",
    "https://nitter.kareem.one",
    "https://nitter.jaydenha.uk",
)
IG_APP = "936619743392459"
ACTION_DOC = "8845758582119845"
ROOT_DOC = "29336004576007686"
VIEWERS = (
    "https://www.picuki.com/media/{code}",
    "https://imginn.com/p/{code}/",
    "https://dumpor.com/v/{code}",
    "https://dumpor.io/v/{code}",
    "https://anonyig.com/p/{code}",
    "https://anonyig.com/en/post/{code}",
)
FIXTURES = ROOT / "scripts" / "fixtures" / "replies"
_IG = {}


def _get(url: str, headers: dict | None = None, data: bytes | None = None, timeout: int = 30, opener=None) -> str:
    req_headers = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        req_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=req_headers)
    open_url = opener.open if opener else urllib.request.urlopen
    with open_url(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def _try(url: str, headers: dict | None = None, data: bytes | None = None, timeout: int = 20, opener=None) -> str | None:
    try:
        return _get(url, headers, data, timeout, opener)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def _shortcode(post: dict) -> str:
    match = re.search(r"/(?:p|reel|tv)/([A-Za-z0-9_-]+)", post.get("url") or "")
    return match.group(1) if match else ""


def _ig_session() -> dict:
    if _IG.get("ready"):
        return _IG
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    html = _try("https://www.instagram.com/", {"User-Agent": BROWSER, "Accept": "text/html"}, opener=opener, timeout=20)
    lsd = ""
    if html:
        found = re.search(r'"LSD",\[\],\{"token":"([^"]+)"\}', html)
        lsd = found.group(1) if found else ""
    csrf = next((cookie.value for cookie in jar if cookie.name == "csrftoken"), "")
    _IG.update(ready=True, opener=opener, lsd=lsd, csrf=csrf)
    return _IG


def _ig_graphql(shortcode: str, doc_id: str, friendly: str, variables: dict) -> str | None:
    session = _ig_session()
    if not session.get("csrf"):
        return None
    form = urllib.parse.urlencode(
        {
            "lsd": session.get("lsd") or "",
            "fb_api_caller_class": "RelayModern",
            "fb_api_req_friendly_name": friendly,
            "variables": json.dumps(variables, separators=(",", ":")),
            "doc_id": doc_id,
            "server_timestamps": "true",
        }
    ).encode()
    text = _try(
        "https://www.instagram.com/graphql/query",
        {
            "User-Agent": BROWSER,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRFToken": session["csrf"],
            "X-IG-App-ID": IG_APP,
            "X-FB-LSD": session.get("lsd") or "",
            "X-FB-Friendly-Name": friendly,
            "Accept": "*/*",
            "Origin": "https://www.instagram.com",
            "Referer": f"https://www.instagram.com/p/{shortcode}/",
        },
        form,
        timeout=25,
        opener=session["opener"],
    )
    if not text or not text.lstrip().startswith("{"):
        return None
    return text


def _keep(payload, post: dict):
    replies, count = parse_ig_document(payload, post)
    if not replies and count is None:
        return None
    if not replies and isinstance(payload, str):
        if not any(token in payload for token in ("comment_count", "edge_media_to_parent_comment", "CaptionComment", "comment-text")):
            return None
    return replies, count


def _rsshub_base() -> str:
    path = ROOT / "feeds.config.json"
    base = "http://localhost:1200"
    if path.exists():
        try:
            base = json.loads(path.read_text(encoding="utf-8")).get("rsshubBase") or base
        except json.JSONDecodeError:
            pass
    return str(base).rstrip("/")


def _rsshub_comments(post: dict, paths: tuple[str, ...]):
    base = _rsshub_base()
    parent_text = (post.get("text") or "").strip()
    for path in paths:
        body = _try(base + path, {"Accept": "application/rss+xml, application/xml, text/xml"}, timeout=4)
        if not body or "<item" not in body.lower():
            continue
        replies = [
            reply
            for reply in parse_comment_rss(body, post)
            if (reply.get("text") or "").strip() and (reply.get("text") or "").strip() != parent_text
        ]
        if replies:
            return replies, "rsshub:" + path
    return None


def fetch_x(post: dict):
    status_id = str(post.get("statusId") or post.get("id") or "")
    handle = post.get("handle") or "i"
    try:
        payload = _get(f"https://api.fxtwitter.com/2/conversation/{status_id}")
        return parse_fxtwitter_conversation(payload, status_id), "fxtwitter", None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[replies] fxtwitter {status_id}: {exc}", file=sys.stderr)
    for host in NITTER_HOSTS:
        html = _try(f"{host}/{handle}/status/{status_id}", {"User-Agent": "Mozilla/5.0"})
        if not html or "tweet-content" not in html:
            continue
        return parse_nitter_replies(html, status_id), host, None
    return None


def fetch_instagram(post: dict):
    code = _shortcode(post)
    count = None
    count_source = ""
    if code:
        action = _ig_graphql(
            code,
            ACTION_DOC,
            "PolarisPostActionLoadPostQueryQuery",
            {"shortcode": code, "fetch_tagged_user_count": None, "hoisted_comment_id": None, "hoisted_reply_id": None},
        )
        if action:
            kept = _keep(action, post)
            if kept:
                replies, got = kept
                if got is not None:
                    count, count_source = got, "graphql:PolarisPostActionLoadPostQuery"
                if replies:
                    return replies, "graphql:PolarisPostActionLoadPostQuery", got if got is not None else count
        root = _ig_graphql(
            code,
            ROOT_DOC,
            "PolarisPostRootQuery",
            {
                "shortcode": code,
                "__relay_internal__pv__PolarisShortDramaEnabledrelayprovider": False,
                "__relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider": False,
                "__relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider": False,
            },
        )
        if root:
            kept = _keep(root, post)
            if kept:
                replies, got = kept
                if got is not None:
                    count, count_source = got, "graphql:PolarisPostRootQuery"
                if replies:
                    return replies, "graphql:PolarisPostRootQuery", got if got is not None else count
        embed = _try(
            f"https://www.instagram.com/p/{code}/embed/captioned/",
            {"User-Agent": BROWSER, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9"},
            timeout=20,
        )
        if embed and '"pageID":"httpErrorPage"' not in embed:
            kept = _keep(embed, post)
            if kept:
                replies, got = kept
                if got is not None:
                    count, count_source = got, "embed"
                if replies:
                    return replies, "embed", got if got is not None else count
        for pattern in VIEWERS:
            page = _try(pattern.format(code=code), {"User-Agent": BROWSER, "Accept": "text/html"}, timeout=12)
            if not page:
                continue
            kept = _keep(page, post)
            if not kept:
                continue
            replies, got = kept
            host = urllib.parse.urlparse(pattern).netloc
            if got is not None:
                count, count_source = got, "viewer:" + host
            if replies:
                return replies, "viewer:" + host, got if got is not None else count
        rss = _rsshub_comments(post, (f"/instagram/comments/{code}", f"/instagram/post/{code}/comments"))
        if rss:
            replies, source = rss
            return replies, source, count
    cookie = os.environ.get("INSTAGRAM_COOKIE") or ""
    if cookie:
        status_id = str(post.get("statusId") or post.get("id") or "")
        header = cookie if "sessionid=" in cookie else f"sessionid={cookie}"
        payload = _try(
            f"https://www.instagram.com/api/v1/media/{status_id}/comments/?can_support_threading=true",
            {"Cookie": header, "X-IG-App-ID": IG_APP, "User-Agent": BROWSER},
            timeout=20,
        )
        if payload and payload.lstrip().startswith("{"):
            replies = parse_ig_comments(payload, post)
            if replies:
                return replies, "instagram-cookie", count
    if count is not None:
        return [], count_source or "instagram", count
    return None


def fetch_threads(post: dict):
    handle = post.get("handle") or ""
    code = str(post.get("statusId") or post.get("id") or "")
    count = None
    count_source = ""
    urls = [
        f"https://www.threads.net/@{handle}/post/{code}",
        f"https://www.threads.net/t/{code}",
        f"https://www.threads.com/@{handle}/post/{code}",
    ]
    seen = set()
    for url in urls:
        if not code or url in seen:
            continue
        seen.add(url)
        html = _try(url, {"User-Agent": BROWSER, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9"}, timeout=20)
        if not html or code not in html:
            continue
        replies, got = parse_threads_document(html, post)
        if got is not None:
            count, count_source = got, "threads.net"
        if replies:
            return replies, "threads.net", got if got is not None else count
    rss = _rsshub_comments(post, (f"/threads/post/{code}", f"/threads/{handle}/post/{code}"))
    if rss:
        replies, source = rss
        return replies, source, count
    cookie = os.environ.get("THREADS_COOKIE") or ""
    if cookie and code:
        header = cookie if "=" in cookie else f"sessionid={cookie}"
        url = post.get("url") or f"https://www.threads.com/@{handle}/post/{code}"
        html = _try(url, {"Cookie": header, "User-Agent": BROWSER, "Accept": "text/html"}, timeout=20)
        if html:
            replies, got = parse_threads_document(html, post)
            if got is not None:
                count, count_source = got, "threads-cookie"
            if replies:
                return replies, "threads-cookie", got if got is not None else count
    if count is not None:
        return [], count_source or "threads.net", count
    return None


def fetch_rss(post: dict):
    url = post.get("commentRss") or ""
    if not url:
        return None
    try:
        payload = _get(url)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"[replies] rss {post.get('id')}: {exc}", file=sys.stderr)
        return None
    return parse_comment_rss(payload, post), "commentRss", None


def from_fixture(post: dict):
    status_id = str(post.get("statusId") or post.get("id") or "")
    conversation = FIXTURES / f"{status_id}.json"
    if conversation.exists():
        return parse_fxtwitter_conversation(conversation.read_text(encoding="utf-8"), status_id), "fixture", None
    nitter = FIXTURES / f"{status_id}.html"
    if nitter.exists():
        return parse_nitter_replies(nitter.read_text(encoding="utf-8"), status_id), "fixture-nitter", None
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
    missed = {"instagram": 0, "threads": 0}
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
                found = fetch_instagram(post)
            elif platform == "threads":
                found = fetch_threads(post)
            elif post.get("commentRss"):
                found = fetch_rss(post)
        if found is None:
            if platform in missed:
                missed[platform] += 1
            continue
        replies, source, count = found
        if count is not None:
            stats = post.setdefault("stats", {})
            if stats.get("replies") != count:
                stats["replies"] = count
                print(f"[replies] {platform}:{status_id} count {count} via {source}")
        if replies or count == 0:
            write_comments(post, replies, source)
        elif count is not None:
            print(f"[replies] {platform}:{status_id} count only via {source}")
    if missed["instagram"]:
        extra = "" if os.environ.get("INSTAGRAM_COOKIE") else " INSTAGRAM_COOKIE is not set."
        print(f"[replies] instagram: {missed['instagram']} posts had no public comments.{extra}", file=sys.stderr)
    if missed["threads"]:
        extra = "" if os.environ.get("THREADS_COOKIE") else " THREADS_COOKIE is not set."
        print(f"[replies] threads: {missed['threads']} posts had no public replies.{extra}", file=sys.stderr)
