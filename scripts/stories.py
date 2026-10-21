"""Collect 24-hour stories into stories.json, separate from feeds.json.

Instagram's current-story route needs a logged-in session. It runs only when
the IG_SESSION secret is set. The value stays in that request. It is not
printed, not written into stories.json, and not committed.

Checked live on 21 Oct 2026, and not called again from the sync, because they
do not return story media without a login this sync is not allowed to bypass:

- Telegram. t.me/telegram, t.me/durov, t.me/s/<channel>, and t.me/<user>/s/1
  are a channel preview or a profile card. The image is the avatar.
  stories.getPeerStories is limited to a logged-in user.
- VK stories.get for owner_id -22822305, through the same token path as
  wall.get, returns "User authorization failed". The method wants a user
  token whose stories right VK issues only by request, or a community
  token for one community this sync does not have.
- X has no stories. Fleets ended in 2021.
- YouTube Stories ended on 26 June 2023. Shorts are permanent videos and
  already belong in the feed.
- Threads, Discord, and RSS have no 24-hour story document.

Nothing is invented for a platform that did not return a story.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
IG_APP = "936619743392459"
STORY_DOC = "29184890191114309"
STORY_QUERY = "PolarisStoriesV3ReelPageStandaloneQuery"
AUTH_DETAIL = (
    "IG_SESSION was rejected by Instagram. Stories stay off until the secret is updated. "
    "A session used from GitHub Actions can be checkpointed or disabled. The cookie was not logged."
)
RATE_DETAIL = "Instagram rate limited story requests. They were not retried."
QUERY_DETAIL = "Instagram stories did not load. The story query failed and the local stories route did not return a feed."
_SECRET = re.compile(r"(?i)(sessionid|ds_user_id|csrftoken|fb_dtsg|lsd)=[^;\s&]+")


class StoryAuthError(Exception):
    """The session was rejected, checkpointed, or rate limited. Do not retry."""


class StoryQueryError(Exception):
    """The story query failed for a reason other than the session."""


def redact(text: str) -> str:
    cleaned = _SECRET.sub(r"\1=redacted", text or "")
    cleaned = re.sub(r"(?i)bearer\s+\S+", "bearer redacted", cleaned)
    return cleaned[:240]


def session_header(secret: str) -> str:
    raw = (secret or "").strip()
    if not raw:
        return ""
    if "sessionid=" not in raw.lower():
        raw = "sessionid=" + raw
    kept = []
    for piece in raw.split(";"):
        name, sep, value = piece.strip().partition("=")
        if not sep or not value:
            continue
        if name.lower() in ("sessionid", "ds_user_id", "csrftoken", "mid", "ig_did", "rur"):
            kept.append(name + "=" + value)
    return "; ".join(kept)


def _https(url: str) -> str:
    text = str(url or "").strip()
    if text.startswith("https://") and " " not in text and '"' not in text:
        return text
    return ""


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _from_unix(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), timezone.utc)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _best(rows: list) -> str:
    best = ""
    area = -1
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        url = _https(row.get("url") or "")
        if not url:
            continue
        try:
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
        except (TypeError, ValueError):
            width = height = 0
        if width * height >= area:
            best = url
            area = width * height
    return best


def _item(raw: dict, handle: str, now: datetime) -> dict | None:
    if not isinstance(raw, dict):
        return None
    pk = raw.get("pk")
    if pk is None or pk == "":
        pk = raw.get("id")
    if pk is None or pk == "":
        return None
    taken = _from_unix(raw.get("taken_at"))
    caption = raw.get("caption") if isinstance(raw.get("caption"), dict) else {}
    if taken is None:
        taken = _from_unix(caption.get("created_at_utc"))
    if taken is None:
        return None
    expires = _from_unix(raw.get("expiring_at")) or (taken + timedelta(hours=24))
    if expires <= now or taken < now - timedelta(hours=24):
        return None
    images = ((raw.get("image_versions2") or {}) if isinstance(raw.get("image_versions2"), dict) else {}).get("candidates") or []
    poster = _best(images)
    video = _best(raw.get("video_versions") or [])
    if video:
        kind, url = "video", video
    elif poster:
        kind, url = "photo", poster
    else:
        return None
    text = ""
    if caption:
        text = str(caption.get("text") or "").strip()
    elif isinstance(raw.get("caption"), str):
        text = raw.get("caption").strip()
    user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
    owner = user.get("username") or handle
    return {
        "id": str(pk).split("_", 1)[0],
        "type": kind,
        "url": url,
        "poster": poster if kind == "video" else "",
        "date": _iso(taken),
        "expires": _iso(expires),
        "caption": text[:500],
        "open": f"https://www.instagram.com/stories/{owner}/{str(pk).split('_', 1)[0]}/",
    }


def _reels(payload) -> list:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if not isinstance(payload, dict):
        return []
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    block = data.get("xdt_api__v1__feed__reels_media") if isinstance(data, dict) else None
    if isinstance(block, dict) and isinstance(block.get("reels_media"), list):
        return [row for row in block["reels_media"] if isinstance(row, dict)]
    if isinstance(data, dict) and isinstance(data.get("reels_media"), list):
        return [row for row in data["reels_media"] if isinstance(row, dict)]
    reels = data.get("reels") if isinstance(data, dict) else None
    if isinstance(reels, dict):
        rows = []
        for row in reels.values():
            if isinstance(row, dict):
                rows.append(row)
        return rows
    return []


def parse_story_document(payload, handle: str, now: datetime, feed: dict | None = None) -> dict:
    """One account from an Instagram story payload. Items are oldest first."""
    feed = feed or {}
    handle = (handle or feed.get("handle") or "").lstrip("@")
    items = []
    name = ((feed.get("profile") or {}).get("name") if isinstance(feed.get("profile"), dict) else "") or handle
    avatar = _https((feed.get("profile") or {}).get("avatar") if isinstance(feed.get("profile"), dict) else "")
    for reel in _reels(payload):
        user = reel.get("user") if isinstance(reel.get("user"), dict) else {}
        if user.get("username"):
            handle = user["username"]
        if user.get("full_name"):
            name = user["full_name"]
        picture = _https(user.get("profile_pic_url") or "")
        hd = user.get("hd_profile_pic_url_info")
        if isinstance(hd, dict):
            picture = _https(hd.get("url") or "") or picture
        avatar = picture or avatar
        for raw in reel.get("items") or []:
            item = _item(raw, handle, now)
            if item:
                items.append(item)
    items.sort(key=lambda item: item.get("date") or "")
    return {
        "id": feed.get("id") or f"instagram:{handle}",
        "platform": "instagram",
        "handle": handle,
        "name": name or handle,
        "avatar": avatar,
        "items": items,
    }


def _html_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_story_rss(xml: str, feed: dict, now: datetime) -> dict:
    """Read a local RSSHub /instagram/stories/<user> document. No cookie is added."""
    import xml.etree.ElementTree as ET

    handle = (feed.get("handle") or "").lstrip("@")
    try:
        root = ET.fromstring(xml or "")
    except ET.ParseError as exc:
        raise StoryQueryError(QUERY_DETAIL) from exc
    items = []
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] != "item":
            continue
        link = description = published = guid = ""
        for child in list(node):
            name = child.tag.rsplit("}", 1)[-1]
            text = "".join(child.itertext())
            if name == "link":
                link = link or text.strip()
            elif name in ("description", "encoded"):
                description = description or text
            elif name in ("pubDate", "published"):
                published = published or text.strip()
            elif name == "guid":
                guid = guid or text.strip()
        taken = _rss_date(published) or now
        if taken < now - timedelta(hours=24):
            continue
        video = ""
        poster = ""
        for match in re.finditer(r"""<(?:source|video)\b[^>]*\bsrc=["'](https://[^"']+)["']""", description or "", re.I):
            video = video or _https(match.group(1))
        for match in re.finditer(r"""<img\b[^>]*\bsrc=["'](https://[^"']+)["']""", description or "", re.I):
            poster = poster or _https(match.group(1))
        url = video or poster
        if not url:
            continue
        item_id = guid or link or url
        items.append({
            "id": item_id.rsplit("/", 2)[-2] if "/stories/" in item_id else item_id[-32:],
            "type": "video" if video else "photo",
            "url": url,
            "poster": poster if video else "",
            "date": _iso(taken),
            "expires": _iso(taken + timedelta(hours=24)),
            "caption": _html_text(description)[:500],
            "open": link if link.startswith("https://") else f"https://www.instagram.com/stories/{handle}/",
        })
    items.sort(key=lambda item: item.get("date") or "")
    profile = feed.get("profile") if isinstance(feed.get("profile"), dict) else {}
    return {
        "id": feed.get("id") or f"instagram:{handle}",
        "platform": "instagram",
        "handle": handle,
        "name": profile.get("name") or handle,
        "avatar": _https(profile.get("avatar") or ""),
        "items": items,
    }


def _rss_date(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        moment = None
    if moment is None:
        try:
            from email.utils import parsedate_to_datetime

            moment = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError, OverflowError):
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _auth_problem(status: int, body: str, final_url: str) -> StoryAuthError | None:
    lowered = (body or "").lower()
    url = (final_url or "").lower()
    if status == 429 or "please wait a few minutes" in lowered:
        return StoryAuthError(RATE_DETAIL)
    if (
        status in (401, 403)
        or "/accounts/login" in url
        or "/accounts/suspended" in url
        or "checkpoint" in url
        or "login_required" in lowered
        or "checkpoint_required" in lowered
    ):
        return StoryAuthError(AUTH_DETAIL)
    return None


def _merge_cookie(header: str, name: str, value: str) -> str:
    if not value or re.search(rf"(?i)(?:^|;\s*){re.escape(name)}=", header or ""):
        return header
    piece = name + "=" + value
    return (header + "; " + piece).strip("; ") if header else piece


def _cookie_from_lines(header: str, lines: list) -> str:
    for line in lines or []:
        match = re.match(r"\s*([^=;\s]+)=([^;]*)", str(line or ""))
        if not match:
            continue
        if match.group(1).lower() in ("csrftoken", "sessionid", "ds_user_id"):
            header = _merge_cookie(header, match.group(1), match.group(2))
    return header


def http_transport(method: str, url: str, headers: dict, body: bytes | None):
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            status = getattr(response, "status", 200) or 200
            payload = response.read(2_000_000).decode("utf-8", "replace")
            lines = response.headers.get_all("Set-Cookie") if hasattr(response.headers, "get_all") else []
            return status, response.geturl(), payload, list(lines or [])
    except urllib.error.HTTPError as exc:
        payload = exc.read(8000).decode("utf-8", "replace")
        lines = exc.headers.get_all("Set-Cookie") if exc.headers is not None and hasattr(exc.headers, "get_all") else []
        return exc.code, url, payload, list(lines or [])
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise StoryQueryError(QUERY_DETAIL) from exc


def _story_json(text: str, handle: str, now: datetime, feed: dict) -> tuple[dict | None, StoryQueryError | None]:
    raw = (text or "").lstrip()
    if raw.startswith("for (;;);"):
        raw = raw[len("for (;;);") :].lstrip()
    if not raw.startswith("{"):
        return None, StoryQueryError(QUERY_DETAIL)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, StoryQueryError(QUERY_DETAIL)
    if not isinstance(data, dict):
        return None, StoryQueryError(QUERY_DETAIL)
    message = str(data.get("message") or "")
    if data.get("require_login") or message in ("login_required", "checkpoint_required"):
        raise StoryAuthError(AUTH_DETAIL)
    if _reels(data) or _reel_answer(data):
        return parse_story_document(data, handle, now, feed), None
    return None, StoryQueryError(QUERY_DETAIL)


def _reel_answer(payload: dict) -> bool:
    """True when Instagram answered the story query, including an empty reel."""
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict):
        return False
    block = data.get("xdt_api__v1__feed__reels_media")
    if isinstance(block, dict) and "reels_media" in block:
        return True
    return isinstance(data.get("reels"), dict)


def fetch_instagram(feed: dict, secret: str, now: datetime, transport=None, rsshub: str = "") -> dict:
    """One profile's current stories. At most a page, a story query, and one local fallback."""
    transport = transport or http_transport
    handle = (feed.get("handle") or "").lstrip("@")
    if not handle or not re.fullmatch(r"[A-Za-z0-9._]{1,30}", handle):
        raise StoryQueryError(QUERY_DETAIL)
    cookie = session_header(secret)
    if "sessionid=" not in cookie.lower():
        raise StoryAuthError(AUTH_DETAIL)
    headers = {
        "User-Agent": BROWSER,
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": cookie,
    }
    status, final, html, cookies = transport("GET", f"https://www.instagram.com/{urllib.parse.quote(handle)}/", headers, None)
    cookie = _cookie_from_lines(cookie, cookies)
    auth = _auth_problem(status, html, final)
    if auth:
        raise auth
    profile_id = ""
    lsd = ""
    found = re.search(r'"profile_id":"(\d+)"', html or "")
    if found:
        profile_id = found.group(1)
    lsd_match = re.search(r'"LSD",\[\],\{"token":"([^"]+)"\}', html or "")
    if lsd_match:
        lsd = lsd_match.group(1)
    csrf_match = re.search(r'"csrf_token":"([A-Za-z0-9]+)"', html or "")
    if csrf_match:
        cookie = _merge_cookie(cookie, "csrftoken", csrf_match.group(1))
    csrf = ""
    csrf_header = re.search(r"(?i)(?:^|;\s*)csrftoken=([^;]+)", cookie)
    if csrf_header:
        csrf = csrf_header.group(1)
    account = None
    query_error = None if profile_id else StoryQueryError(QUERY_DETAIL)
    if profile_id:
        variables = {
            "reel_ids_arr": [profile_id],
            "is_highlight": False,
            "media_id": None,
            "__relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider": False,
        }
        form = {
            "fb_api_req_friendly_name": STORY_QUERY,
            "variables": json.dumps(variables, separators=(",", ":")),
            "doc_id": STORY_DOC,
        }
        if lsd:
            form["lsd"] = lsd
        post_headers = {
            "User-Agent": BROWSER,
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": cookie,
            "X-IG-App-ID": IG_APP,
            "X-ASBD-ID": "359341",
            "X-IG-WWW-Claim": "0",
            "Referer": f"https://www.instagram.com/{handle}/",
        }
        if csrf:
            post_headers["X-CSRFToken"] = csrf
        if lsd:
            post_headers["X-FB-LSD"] = lsd
        body = urllib.parse.urlencode(form).encode("utf-8")
        try:
            status, final, text, _cookies = transport("POST", "https://www.instagram.com/api/graphql", post_headers, body)
        except StoryQueryError as exc:
            query_error = exc
            text = ""
            status = 0
            final = ""
        else:
            auth = _auth_problem(status, text, final)
            if auth:
                raise auth
            account, query_error = _story_json(text, handle, now, feed)
    if account is not None:
        return account
    base = (rsshub or "").rstrip("/")
    if not base:
        raise query_error or StoryQueryError(QUERY_DETAIL)
    try:
        status, final, text, _cookies = transport(
            "GET",
            base + "/instagram/stories/" + urllib.parse.quote(handle),
            {"User-Agent": BROWSER, "Accept": "application/rss+xml, application/xml, text/xml"},
            None,
        )
    except StoryQueryError as exc:
        raise query_error or exc
    lowered = (text or "").lower()
    if "invalid cookie" in lowered or "lack of relevant config" in lowered or "/accounts/login" in (final or "").lower():
        raise StoryAuthError(AUTH_DETAIL)
    if status == 429:
        raise StoryAuthError(RATE_DETAIL)
    if status >= 400 or "<rss" not in lowered and "<feed" not in lowered:
        raise query_error or StoryQueryError(QUERY_DETAIL)
    return parse_story_rss(text, feed, now)


def _unexpired(account: dict, now: datetime) -> dict | None:
    if not isinstance(account, dict):
        return None
    items = []
    for item in account.get("items") or []:
        if not isinstance(item, dict) or not _https(item.get("url") or ""):
            continue
        expires = _rss_date(str(item.get("expires") or ""))
        if expires is not None and expires <= now:
            continue
        items.append(item)
    if not items:
        return None
    kept = dict(account)
    kept["items"] = items
    return kept


def assemble(previous: list, fetched: dict, failed: set, now: datetime) -> list:
    """Successful fetches replace an account. A failed fetch keeps its unexpired items."""
    out = []
    seen = set()
    for feed_id, account in fetched.items():
        seen.add(feed_id)
        if account and account.get("items"):
            out.append(account)
    for account in previous or []:
        if not isinstance(account, dict):
            continue
        feed_id = str(account.get("id") or "")
        if feed_id in seen or feed_id not in failed:
            continue
        kept = _unexpired(account, now)
        if kept:
            out.append(kept)
    return out


def load_document(path: Path) -> list:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    accounts = data.get("accounts") if isinstance(data, dict) else None
    return [row for row in accounts or [] if isinstance(row, dict)]


def save_document(path: Path, accounts: list, now: datetime) -> None:
    path.write_text(
        json.dumps({"updated": _iso(now), "accounts": accounts}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def collect(feeds: list, secret: str, now: datetime, previous: list, transport=None, rsshub: str = "") -> tuple[list, list]:
    """Return (accounts, health rows). Health is empty when nothing failed."""
    secret = (secret or "").strip()
    if not secret:
        print("[stories] Instagram off; IG_SESSION is not set")
        return [], []
    fetched = {}
    failed = set()
    health = []
    stopped = False
    instagram = [feed for feed in feeds or [] if isinstance(feed, dict) and feed.get("platform") == "instagram" and feed.get("id")]
    for feed in instagram:
        feed_id = str(feed.get("id"))
        if stopped:
            failed.add(feed_id)
            continue
        try:
            account = fetch_instagram(feed, secret, now, transport=transport, rsshub=rsshub)
        except StoryAuthError as exc:
            stopped = True
            failed.add(feed_id)
            health = [{"platform": "instagram", "ok": False, "detail": str(exc)}]
            print(f"[stories] {feed_id}: {exc}", flush=True)
            continue
        except StoryQueryError as exc:
            failed.add(feed_id)
            health = [{"platform": "instagram", "ok": False, "detail": str(exc)}]
            print(f"[stories] {feed_id}: {exc}", flush=True)
            continue
        fetched[feed_id] = account
        print(f"[stories] {feed_id}: {len(account.get('items') or [])} items")
    if stopped:
        for feed in instagram:
            failed.add(str(feed.get("id")))
    accounts = assemble(previous, fetched, failed, now)
    return accounts, health


def publish(config: dict, dest: Path, now: datetime | None = None, secret: str | None = None, transport=None) -> list:
    import os

    moment = now or datetime.now(timezone.utc)
    if secret is None:
        secret = os.environ.get("IG_SESSION") or ""
    rsshub = ""
    if isinstance(config, dict):
        rsshub = str(config.get("rsshubBase") or "")
    accounts, health = collect(
        (config or {}).get("feeds") or [],
        secret,
        moment,
        load_document(dest),
        transport=transport,
        rsshub=rsshub,
    )
    save_document(dest, accounts, moment)
    count = sum(len(row.get("items") or []) for row in accounts)
    print(f"[stories] wrote {dest.name} ({len(accounts)} accounts, {count} items)")
    return health
