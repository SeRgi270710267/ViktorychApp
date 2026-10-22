#!/usr/bin/env python3
"""Permanent ids for added accounts, and handle changes when that id matches.

An added account keeps its feed id, so posts stay attached to the same
account. The current handle, previousHandles, and permanentId sit next to
that id. A handle changes only when the permanent id matches. Public
payloads the sync already fetched supply the id. A failed handle lookup
may use one extra public request, up to a small budget per sync.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

HANDLE_RE = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
CHANNEL_RE = re.compile(r"^UC[\w-]{22}$")
NUMERIC_RE = re.compile(r"^-?\d{2,25}$")
SEC_RE = re.compile(r"^[A-Za-z0-9_-]{8,160}$")
BUDGET = {"left": 4}


def begin_run(limit: int = 4) -> None:
    BUDGET["left"] = max(0, int(limit))


def _take_budget() -> bool:
    if BUDGET["left"] <= 0:
        return False
    BUDGET["left"] -= 1
    return True


def clean_id(value) -> str:
    text = str(value or "").strip()
    if NUMERIC_RE.fullmatch(text) and text not in {"0", "-0"}:
        return text
    if CHANNEL_RE.fullmatch(text):
        return text
    return ""


def clean_sec(value) -> str:
    text = str(value or "").strip()
    if SEC_RE.fullmatch(text) and not text.isdigit():
        return text
    return ""


def norm_handle(value) -> str:
    return str(value or "").strip().lstrip("@")


def handles_equal(left, right) -> bool:
    a = norm_handle(left)
    b = norm_handle(right)
    return bool(a) and a.casefold() == b.casefold()


def handle_ok(value) -> bool:
    return HANDLE_RE.fullmatch(norm_handle(value)) is not None


def stored_permanent(row: dict | None) -> str:
    row = row or {}
    found = clean_id(row.get("permanentId"))
    if found:
        return found
    if (row.get("platform") or "") == "youtube":
        channel = str(row.get("channelId") or "")
        if CHANNEL_RE.fullmatch(channel):
            return channel
    return ""


def previous_of(row: dict | None) -> list:
    row = row or {}
    out = []
    for item in row.get("previousHandles") or []:
        text = norm_handle(item)
        if not handle_ok(text) or handles_equal(text, row.get("handle")):
            continue
        if any(handles_equal(text, have) for have in out):
            continue
        out.append(text)
    return out


def remember_handle(previous, old, new) -> list:
    out = []
    for item in list(previous or []) + [old]:
        text = norm_handle(item)
        if not handle_ok(text) or handles_equal(text, new):
            continue
        if any(handles_equal(text, have) for have in out):
            continue
        out.append(text)
    return out


def same_account(left: dict, right: dict) -> bool:
    if (left.get("platform") or "") != (right.get("platform") or ""):
        return False
    if handles_equal(left.get("handle"), right.get("handle")):
        return True
    left_id = stored_permanent(left)
    right_id = stored_permanent(right)
    if left_id and left_id == right_id:
        return True
    channel = str(left.get("channelId") or "")
    if channel and channel == str(right.get("channelId") or ""):
        return True
    left_sec = clean_sec(left.get("secUid"))
    right_sec = clean_sec(right.get("secUid"))
    return bool(left_sec) and left_sec == right_sec


def _ids_match(row: dict, observed: dict) -> bool:
    stored = stored_permanent(row)
    seen = clean_id(observed.get("permanentId"))
    stored_sec = clean_sec(row.get("secUid"))
    seen_sec = clean_sec(observed.get("secUid"))
    if stored and seen and stored != seen:
        return False
    if stored_sec and seen_sec and stored_sec != seen_sec:
        return False
    if stored and seen and stored == seen:
        return True
    if stored_sec and seen_sec and stored_sec == seen_sec:
        return not (stored and seen and stored != seen)
    return False


def _taken(others, platform: str, new_handle: str, observed: dict) -> bool:
    seen = clean_id(observed.get("permanentId"))
    seen_sec = clean_sec(observed.get("secUid"))
    for other in others or []:
        if not isinstance(other, dict) or (other.get("platform") or "") != platform:
            continue
        names = [other.get("handle") or ""] + list(other.get("previousHandles") or [])
        if not any(handles_equal(name, new_handle) for name in names):
            continue
        other_id = stored_permanent(other)
        other_sec = clean_sec(other.get("secUid"))
        if seen and other_id and seen == other_id:
            continue
        if seen_sec and other_sec and seen_sec == other_sec and not (seen and other_id and seen != other_id):
            continue
        return True
    return False


def replace_handle_token(text: str, old: str, new: str) -> str:
    """Replace a handle that is a path segment or an @mention."""
    old = norm_handle(old)
    new = norm_handle(new)
    if not text or not old or handles_equal(old, new):
        return text
    pattern = re.compile(r"(?<=[/@])" + re.escape(old) + r"(?=[/\"'#?#\s)]|$)", re.I)
    return pattern.sub(new, text)


def _rewrite_urls(value, old: str, new: str):
    if isinstance(value, str):
        if re.search(r"https?://|\{(?:fxtwitterBase|rsshubBase|base|handle)\}", value):
            return replace_handle_token(value, old, new)
        return value
    if isinstance(value, list):
        return [_rewrite_urls(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite_urls(item, old, new) for key, item in value.items()}
    return value


def rewrite_feed_urls(feed: dict, old: str, new: str) -> None:
    if isinstance(feed.get("source_urls"), list):
        feed["source_urls"] = _rewrite_urls(feed["source_urls"], old, new)
    if isinstance(feed.get("fallbacks"), list):
        feed["fallbacks"] = _rewrite_urls(feed["fallbacks"], old, new)
    profile = feed.get("profile")
    if isinstance(profile, dict) and profile.get("url"):
        profile["url"] = replace_handle_token(str(profile.get("url") or ""), old, new)


def apply_observation(row: dict, observed: dict, others=None) -> dict:
    """Record an id, or rename, only when the permanent id matches.

    The row is updated in place. ``action`` is rename, backfill, same,
    reject, or skip. A rename keeps the feed id and appends the old handle.
    """
    observed = observed or {}
    platform = row.get("platform") or observed.get("platform") or ""
    current = norm_handle(row.get("handle"))
    seen_handle = norm_handle(observed.get("handle"))
    seen_id = clean_id(observed.get("permanentId"))
    seen_sec = clean_sec(observed.get("secUid"))
    authoritative = bool(observed.get("authoritative"))
    stored = stored_permanent(row)
    stored_sec = clean_sec(row.get("secUid"))
    logs = []

    if not seen_id and not seen_sec:
        return {"action": "skip", "logs": logs}
    if stored and seen_id and stored != seen_id:
        return {"action": "reject", "logs": logs}
    if stored_sec and seen_sec and stored_sec != seen_sec:
        return {"action": "reject", "logs": logs}
    if platform == "youtube" and seen_id.startswith("UC"):
        channel = str(row.get("channelId") or "")
        if channel and channel != seen_id:
            return {"action": "reject", "logs": logs}

    if not _ids_match(row, observed):
        if stored or stored_sec:
            return {"action": "skip", "logs": logs}
        if not authoritative:
            return {"action": "skip", "logs": logs}
        if seen_handle and current and not handles_equal(seen_handle, current):
            # No stored id yet, so a different handle is not this account.
            return {"action": "skip", "logs": logs}
        wrote = _fill_ids(row, seen_id, seen_sec)
        if wrote:
            logs.append(f"[id] {platform} {current or seen_handle} {stored_permanent(row) or seen_sec}")
            return {"action": "backfill", "logs": logs}
        return {"action": "same", "logs": logs}

    if seen_handle and not handle_ok(seen_handle):
        seen_handle = ""
    if seen_handle and not handles_equal(seen_handle, current):
        if _taken(others, platform, seen_handle, observed):
            return {"action": "reject", "logs": logs}
        old = current
        rewrite_feed_urls(row, old, seen_handle)
        row["previousHandles"] = remember_handle(row.get("previousHandles"), old, seen_handle)
        row["handle"] = seen_handle
        _fill_ids(row, seen_id, seen_sec)
        logs.append(f"[rename] {platform} {old} -> {seen_handle}")
        if seen_id and not stored:
            logs.append(f"[id] {platform} {seen_handle} {seen_id}")
        return {"action": "rename", "logs": logs, "old": old, "new": seen_handle}

    wrote = _fill_ids(row, seen_id, seen_sec)
    if wrote:
        logs.append(f"[id] {platform} {current} {stored_permanent(row) or seen_sec}")
        return {"action": "backfill", "logs": logs}
    return {"action": "same", "logs": logs}


def _fill_ids(row: dict, seen_id: str, seen_sec: str) -> bool:
    wrote = False
    if seen_id and not clean_id(row.get("permanentId")):
        row["permanentId"] = seen_id
        wrote = True
    if (row.get("platform") or "") == "youtube" and str(seen_id).startswith("UC"):
        if not row.get("channelId"):
            row["channelId"] = seen_id
            wrote = True
    if seen_sec and not clean_sec(row.get("secUid")):
        row["secUid"] = seen_sec
        wrote = True
    return wrote


def _statuses(payload):
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("results", "statuses", "data", "tweets", "timeline"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for inner in ("statuses", "data", "tweets"):
                if isinstance(value.get(inner), list):
                    return value[inner]
    return []


def _person_id(person: dict) -> str:
    raw = person.get("id") or person.get("rest_id") or person.get("id_str") or ""
    text = str(raw).strip()
    return text if text.isdigit() else ""


def x_observation(payload, feed: dict) -> dict | None:
    """The account in a public X timeline, never a quote or a mention."""
    stored = stored_permanent(feed)
    requested = norm_handle(feed.get("handle"))
    previous = {norm_handle(item).casefold() for item in (feed.get("previousHandles") or [])}
    found = {}
    for status in _statuses(payload):
        if not isinstance(status, dict):
            continue
        for key in ("author", "reposted_by", "retweeted_by"):
            person = status.get(key)
            if not isinstance(person, dict):
                continue
            screen = norm_handle(person.get("screen_name") or person.get("handle") or "")
            uid = _person_id(person)
            if not screen or not uid:
                continue
            if stored and uid == stored:
                found[uid] = screen
            elif not stored and (handles_equal(screen, requested) or screen.casefold() in previous):
                found.setdefault(uid, screen)
    user = payload.get("user") if isinstance(payload, dict) else None
    if isinstance(user, dict):
        screen = norm_handle(user.get("screen_name") or user.get("handle") or "")
        uid = _person_id(user)
        if screen and uid and (not stored or uid == stored) and (stored or handles_equal(screen, requested) or screen.casefold() in previous):
            found[uid] = screen
    if stored:
        if stored not in found:
            return None
        return {"handle": found[stored], "permanentId": stored, "authoritative": True, "platform": "x"}
    if len(found) != 1:
        return None
    uid, screen = next(iter(found.items()))
    return {"handle": screen, "permanentId": uid, "authoritative": True, "platform": "x"}


def rss_observation(payload, feed: dict) -> dict | None:
    """A user id already present on the channel, not a guess from a title."""
    if not isinstance(payload, str) or not payload:
        return None
    head = payload.split("<item", 1)[0]
    ids = re.findall(
        r"(?:data-user-id|data-profile-id|profile_id|user_id|owner_id)\"?\s*[:=]\s*\"?(\d{4,20})",
        head,
        re.I,
    )
    uniq = []
    for item in ids:
        if item not in uniq:
            uniq.append(item)
    if len(uniq) != 1:
        return None
    return {
        "handle": norm_handle(feed.get("handle")),
        "permanentId": uniq[0],
        "authoritative": True,
        "platform": feed.get("platform") or "",
    }


def youtube_handle_from_html(html: str, channel_id: str) -> str:
    """@handle from a channel page the sync already downloaded."""
    if not html or not channel_id or channel_id not in html:
        return ""
    found = []
    patterns = (
        r'canonicalBaseUrl"\s*:\s*"/@([^"\\/?#]+)',
        r'rel="canonical"\s+href="https://www\.youtube\.com/@([^"\\/?#]+)"',
        r'<link[^>]+rel="canonical"[^>]+href="https://www\.youtube\.com/@([^"\\/?#]+)"',
        r'href="https://www\.youtube\.com/@([^"\\/?#]+)"[^>]+rel="canonical"',
    )
    for pattern in patterns:
        found.extend(re.findall(pattern, html))
    handles = []
    for item in found:
        name = urllib.parse.unquote(item).strip().strip("/")
        if handle_ok(name) and not any(handles_equal(name, have) for have in handles):
            handles.append(name)
    if len(handles) == 1:
        return handles[0]
    if handles and all(handles_equal(name, handles[0]) for name in handles):
        return handles[0]
    return ""


def telegram_channel_id(html: str) -> str:
    """A channel id only when the public preview page actually includes one."""
    if not html:
        return ""
    head = html.split("tgme_widget_message", 1)[0]
    patterns = (
        r'data-peer="(-?\d{5,})"',
        r"tg://privatepost\?channel=(\d{5,})",
        r"t\.me/c/(\d{5,})",
        r'"channel_id"\s*:\s*"?(\d{5,})',
    )
    found = []
    for pattern in patterns:
        for item in re.findall(pattern, head, re.I):
            if item not in found:
                found.append(item)
    if len(found) == 1:
        return found[0]
    return ""


def observation_from_profiles(result: dict | None) -> dict | None:
    profiles = (result or {}).get("profiles") or []
    owners = [
        profile
        for profile in profiles
        if isinstance(profile, dict) and profile.get("account") and (clean_id(profile.get("permanentId")) or clean_sec(profile.get("secUid")))
    ]
    if len(owners) != 1:
        return None
    owner = owners[0]
    return {
        "handle": norm_handle(owner.get("handle")),
        "permanentId": clean_id(owner.get("permanentId")),
        "secUid": clean_sec(owner.get("secUid")),
        "authoritative": True,
        "platform": owner.get("platform") or "",
    }


def observation_for(adapter: str, payload, feed: dict, result: dict | None) -> dict | None:
    platform = feed.get("platform") or ""
    if adapter == "fxtwitter" or platform == "x":
        observed = x_observation(payload, feed)
        if observed:
            return observed
    if feed.get("_observedHandle"):
        channel = str(feed.get("_observedPermanentId") or feed.get("channelId") or "")
        return {
            "handle": norm_handle(feed.get("_observedHandle")),
            "permanentId": channel,
            "authoritative": True,
            "platform": platform or "youtube",
        }
    observed = observation_from_profiles(result)
    if observed:
        return observed
    if platform in {"instagram", "threads"}:
        return rss_observation(payload, feed)
    return None


def _others(config: dict, feed: dict, linked: list) -> list:
    rows = []
    for row in config.get("feeds") or []:
        if isinstance(row, dict) and row is not feed and row.get("id") != feed.get("id"):
            rows.append(row)
    linked_ids = {id(item) for item in linked}
    for person in config.get("people") or []:
        if not isinstance(person, dict):
            continue
        for account in person.get("accounts") or []:
            if isinstance(account, dict) and id(account) not in linked_ids and not same_account(feed, account):
                rows.append(account)
    for row in config.get("tiktok") or []:
        if isinstance(row, dict) and row is not feed and not same_account(feed, row):
            row = dict(row)
            row["platform"] = "tiktok"
            rows.append(row)
    return rows


def _linked_accounts(config: dict, feed: dict) -> list:
    found = []
    for person in config.get("people") or []:
        if not isinstance(person, dict):
            continue
        for account in person.get("accounts") or []:
            if isinstance(account, dict) and same_account(feed, account):
                found.append(account)
    return found


def apply_to_config(config: dict, feed: dict, observed: dict) -> dict:
    linked = _linked_accounts(config, feed)
    others = _others(config, feed, linked)
    decision = apply_observation(feed, observed, others)
    for account in linked:
        apply_observation(account, observed, _others(config, account, linked))
    for line in decision.get("logs") or []:
        print(line)
    return decision


def note_success(config: dict, feed: dict, adapter: str, payload, result: dict | None) -> str:
    """Apply one public observation. Returns the old handle when it changed."""
    observed = observation_for(adapter, payload, feed, result)
    feed.pop("_observedHandle", None)
    feed.pop("_observedPermanentId", None)
    if not observed:
        return ""
    before = norm_handle(feed.get("handle"))
    decision = apply_to_config(config, feed, observed)
    if decision.get("action") == "rename":
        return decision.get("old") or before
    return ""


def retarget_posts(posts, old: str, new: str) -> None:
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        if handles_equal(post.get("handle"), old):
            post["handle"] = new
        url = post.get("url") or ""
        if url:
            post["url"] = replace_handle_token(str(url), old, new)


def _paint_profile(profiles, feed: dict) -> None:
    for profile in profiles or []:
        if not isinstance(profile, dict) or profile.get("id") != feed.get("id"):
            continue
        if feed.get("handle"):
            profile["handle"] = feed.get("handle")
        if feed.get("permanentId"):
            profile["permanentId"] = feed.get("permanentId")
        if feed.get("secUid"):
            profile["secUid"] = feed.get("secUid")
        if feed.get("previousHandles"):
            profile["previousHandles"] = list(feed.get("previousHandles") or [])
        profile_url = ((feed.get("profile") or {}) if isinstance(feed.get("profile"), dict) else {}).get("url")
        if profile_url:
            profile["url"] = profile_url


def _read_public(url: str, timeout: int = 20) -> tuple[int, str, str]:
    from x_guard import assert_not_x_api

    assert_not_x_api(url)
    request = urllib.request.Request(url, headers={"User-Agent": "ViktorychApp/1.0", "Accept": "*/*"})

    class _Stop(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            assert_not_x_api(newurl)
            return None

    opener = urllib.request.build_opener(_Stop)
    try:
        with opener.open(request, timeout=timeout) as response:
            final = response.geturl()
            body = response.read(200000).decode("utf-8", "replace")
            return response.status, final, body
    except urllib.error.HTTPError as exc:
        location = ""
        if exc.headers:
            location = exc.headers.get("Location") or ""
        if location:
            assert_not_x_api(urllib.parse.urljoin(url, location))
        return exc.code, location, ""


def resolve_x(user_id: str) -> dict | None:
    """Public redirect from a numeric user id to the current handle. No cookies."""
    user_id = clean_id(user_id)
    if not user_id or not user_id.isdigit():
        return None
    status, location, _body = _read_public("https://x.com/i/user/" + user_id)
    target = urllib.parse.urljoin("https://x.com", location or "")
    parsed = urllib.parse.urlparse(target)
    host = (parsed.hostname or "").lower()
    if host not in {"x.com", "twitter.com", "www.x.com", "www.twitter.com"}:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 1 or not re.fullmatch(r"[A-Za-z0-9_]{1,15}", parts[0]):
        return None
    if status not in {200, 301, 302, 303, 307, 308}:
        return None
    return {"handle": parts[0], "permanentId": user_id, "authoritative": True, "platform": "x"}


def resolve_youtube(channel_id: str) -> dict | None:
    channel_id = str(channel_id or "")
    if not CHANNEL_RE.fullmatch(channel_id):
        return None
    _status, _final, body = _read_public("https://www.youtube.com/channel/" + channel_id)
    handle = youtube_handle_from_html(body, channel_id)
    if not handle:
        return None
    return {"handle": handle, "permanentId": channel_id, "authoritative": True, "platform": "youtube"}


def resolve_vk(owner_id: str) -> dict | None:
    owner_id = clean_id(owner_id)
    if not owner_id:
        return None
    from vk_remote import wall_document_by_owner

    document = wall_document_by_owner(owner_id, 1)
    from adapters.vk import parse as parse_vk

    parsed = parse_vk(document, {"platform": "vk", "handle": "", "permanentId": owner_id})
    return observation_from_profiles(parsed)


def resolve_telegram(channel_id: str) -> dict | None:
    channel_id = clean_id(channel_id)
    if not channel_id:
        return None
    digits = channel_id[1:] if channel_id.startswith("-") else channel_id
    if digits.startswith("100") and len(digits) > 10:
        digits = digits[3:]
    _status, location, body = _read_public("https://t.me/c/" + digits)
    handle = ""
    match = re.search(r"t\.me/(?:s/)?([A-Za-z][A-Za-z0-9_]{3,31})", location or "")
    if match:
        handle = match.group(1)
    if not handle and body:
        user = re.search(r"tgme_channel_info_header_username[\s\S]{0,200}@([A-Za-z0-9_]{4,32})", body)
        if user:
            handle = user.group(1)
    if not handle_ok(handle):
        return None
    return {"handle": handle, "permanentId": channel_id, "authoritative": True, "platform": "telegram"}


def resolve_tiktok(user_id: str) -> dict | None:
    user_id = clean_id(user_id)
    if not user_id or not user_id.isdigit():
        return None
    _status, location, _body = _read_public("https://www.tiktok.com/share/user/" + user_id)
    match = re.search(r"/@([A-Za-z0-9._]{2,24})", location or "")
    if not match:
        return None
    return {"handle": match.group(1), "permanentId": user_id, "authoritative": True, "platform": "tiktok"}


def resolve_facebook(page_id: str) -> dict | None:
    page_id = clean_id(page_id)
    if not page_id or not page_id.isdigit():
        return None
    _status, location, body = _read_public("https://www.facebook.com/" + page_id)
    target = (location or "") + " " + (body or "")[:4000]
    if re.search(r"login|checkpoint", target, re.I):
        return None
    match = re.search(r"facebook\.com/([A-Za-z0-9.\-]{3,50})(?:[/?\s]|$)", location or "")
    if not match or match.group(1).isdigit():
        return None
    return {"handle": match.group(1), "permanentId": page_id, "authoritative": True, "platform": "facebook"}


def lookup_failed(feed: dict) -> dict | None:
    platform = feed.get("platform") or ""
    permanent = stored_permanent(feed)
    if not permanent:
        return None
    try:
        if platform == "x":
            return resolve_x(permanent)
        if platform == "youtube":
            return resolve_youtube(permanent)
        if platform == "vk":
            return resolve_vk(permanent)
        if platform == "telegram":
            return resolve_telegram(permanent)
        if platform == "tiktok":
            return resolve_tiktok(permanent)
        if platform == "facebook":
            return resolve_facebook(permanent)
    except Exception:
        print(f"[keep] {feed.get('id') or platform}: id lookup failed")
        return None
    return None


def resolve_failed(config: dict, feed: dict, profiles=None, lookup=None) -> str:
    """When the handle no longer resolves, look the stored id up once."""
    if not stored_permanent(feed):
        return ""
    if (feed.get("platform") or "") in {"instagram", "threads", "rss"}:
        return ""
    if not _take_budget():
        return ""
    finder = lookup or lookup_failed
    try:
        observed = finder(feed)
    except Exception:
        print(f"[keep] {feed.get('id') or feed.get('platform')}: id lookup failed")
        return ""
    if not observed:
        return ""
    before = norm_handle(feed.get("handle"))
    decision = apply_to_config(config, feed, observed)
    if decision.get("action") == "rename":
        _paint_profile(profiles, feed)
        return decision.get("old") or before
    return ""


def tiktok_identity(info: dict, requested: str) -> dict | None:
    """user id and secUid from a TikTok playlist the sync already fetched."""
    if not isinstance(info, dict):
        return None
    user_id = clean_id(info.get("uploader_id"))
    if user_id and not user_id.isdigit():
        user_id = ""
    sec = clean_sec(info.get("channel_id"))
    raw = norm_handle(info.get("uploader") or info.get("channel") or "")
    handle = raw if handle_ok(raw) and not raw.isdigit() else norm_handle(requested)
    if not user_id and not sec:
        return None
    return {"handle": handle, "permanentId": user_id, "secUid": sec, "authoritative": True, "platform": "tiktok"}


def ensure_tiktok(config: dict, handle: str) -> dict:
    handle = norm_handle(handle)
    rows = config.get("tiktok")
    if not isinstance(rows, list):
        rows = []
        config["tiktok"] = rows
    for row in rows:
        if not isinstance(row, dict):
            continue
        if handles_equal(row.get("handle"), handle) or any(handles_equal(item, handle) for item in row.get("previousHandles") or []):
            row["platform"] = "tiktok"
            return row
    row = {"platform": "tiktok", "handle": handle}
    rows.append(row)
    return row


def note_tiktok(config: dict, requested: str, info: dict) -> str:
    observed = tiktok_identity(info, requested)
    if not observed:
        return ""
    row = ensure_tiktok(config, requested)
    before = norm_handle(row.get("handle"))
    decision = apply_to_config(config, row, observed)
    if decision.get("action") == "rename":
        return decision.get("old") or before
    return ""


def tiktok_accounts(config: dict, tracked: list, extra: dict | None = None) -> list:
    """Private added rows, then config rows, then the fallback handles.

    Handles in the removed list stay out, including a fallback handle.
    """
    rows = []
    seen = set()
    extra = extra if isinstance(extra, dict) else {}
    blocked = set()
    for item in extra.get("removed") or []:
        name = norm_handle(item)
        if name:
            blocked.add(name.casefold())

    def add(handle: str, source: dict | None) -> None:
        handle = norm_handle(handle)
        if not handle_ok(handle) or handle.casefold() in seen or handle.casefold() in blocked:
            return
        source = source or {}
        seen.add(handle.casefold())
        for item in source.get("previousHandles") or []:
            if norm_handle(item):
                seen.add(norm_handle(item).casefold())
        row = {
            "platform": "tiktok",
            "handle": handle,
            "url": "https://www.tiktok.com/@" + handle,
        }
        if clean_id(source.get("permanentId")):
            row["permanentId"] = clean_id(source.get("permanentId"))
        if clean_sec(source.get("secUid")):
            row["secUid"] = clean_sec(source.get("secUid"))
        previous = previous_of(source)
        if previous:
            row["previousHandles"] = previous
        rows.append(row)

    for source in extra.get("added") or []:
        if isinstance(source, dict):
            add(str(source.get("handle") or ""), source)
    for source in (config or {}).get("tiktok") or []:
        if isinstance(source, dict):
            add(str(source.get("handle") or ""), source)
    for handle in tracked or []:
        add(str(handle or ""), {})
    return rows


def _json_span(raw: str, index: int) -> tuple[int, int] | None:
    depth = 0
    in_str = False
    escape = False
    stack = []
    for at, ch in enumerate(raw):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            stack.append(at)
        elif ch == "}":
            if not stack:
                continue
            start = stack.pop()
            if start < index <= at:
                return start, at + 1
    return None


def _feed_span(raw: str, feed_id: str) -> tuple[int, int] | None:
    for needle in (f'"id": "{feed_id}"', f'"id":"{feed_id}"'):
        at = raw.find(needle)
        if at >= 0:
            return _json_span(raw, at)
    return None


def _account_span(raw: str, platform: str, handle: str) -> tuple[int, int] | None:
    needle = f'"handle": "{handle}"'
    start = 0
    while True:
        at = raw.find(needle, start)
        if at < 0:
            return None
        span = _json_span(raw, at)
        if span:
            obj = raw[span[0] : span[1]]
            # A feed or an addedFrom note also has a handle. People links do not.
            if '"adapter"' in obj or '"source_urls"' in obj or '"feedId"' in obj:
                start = at + len(needle)
                continue
            if f'"platform": "{platform}"' in obj and obj.count('"handle"') == 1:
                return span
        start = at + len(needle)


def _upsert_field(span: str, key: str, literal: str) -> str:
    pattern = re.compile(
        r'("' + re.escape(key) + r'"\s*:\s*)(\[[\s\S]*?\]|"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?)'
    )
    if pattern.search(span):
        return pattern.sub(lambda match: match.group(1) + literal, span, count=1)
    found = re.search(r'^([ \t]*)"handle"\s*:\s*"(?:\\.|[^"\\])*"', span, re.M)
    if not found:
        return span
    line_end = span.find("\n", found.end())
    if line_end < 0:
        line_end = len(span)
    if "," not in span[found.end() : line_end]:
        span = span[: found.end()] + "," + span[found.end() :]
        line_end += 1
    addition = "\n" + found.group(1) + '"' + key + '": ' + literal + ","
    return span[:line_end] + addition + span[line_end:]


def _replace_handle_field(span: str, handle: str) -> str:
    return re.sub(
        r'("handle"\s*:\s*")(?:\\.|[^"\\])*(")',
        lambda match: match.group(1) + norm_handle(handle) + match.group(2),
        span,
        count=1,
    )


def _rewrite_span_urls(span: str, old: str, new: str) -> str:
    lines = span.splitlines(keepends=True)
    out = []
    for line in lines:
        if re.search(r"https?://|\{(?:fxtwitterBase|rsshubBase|base)\}", line):
            line = replace_handle_token(line, old, new)
        out.append(line)
    return "".join(out)


def _patch_span(span: str, before: dict, after: dict) -> str:
    old = norm_handle(before.get("handle"))
    new = norm_handle(after.get("handle"))
    if new and old and not handles_equal(old, new):
        span = _replace_handle_field(span, new)
        span = _rewrite_span_urls(span, old, new)
    if clean_id(after.get("permanentId")) and clean_id(after.get("permanentId")) != clean_id(before.get("permanentId")):
        span = _upsert_field(span, "permanentId", json.dumps(clean_id(after.get("permanentId"))))
    if clean_sec(after.get("secUid")) and clean_sec(after.get("secUid")) != clean_sec(before.get("secUid")):
        span = _upsert_field(span, "secUid", json.dumps(clean_sec(after.get("secUid"))))
    previous = previous_of(after)
    if previous and previous != previous_of(before):
        span = _upsert_field(span, "previousHandles", json.dumps(previous, ensure_ascii=False))
    channel = str(after.get("channelId") or "")
    if CHANNEL_RE.fullmatch(channel) and channel != str(before.get("channelId") or ""):
        span = _upsert_field(span, "channelId", json.dumps(channel))
    return span


def _identity_notes(before: dict, after: dict) -> list:
    notes = []
    platform = after.get("platform") or before.get("platform") or ""
    old = norm_handle(before.get("handle"))
    new = norm_handle(after.get("handle"))
    if old and new and not handles_equal(old, new):
        notes.append(f"[rename] {platform} {old} -> {new}")
    if clean_id(after.get("permanentId")) and clean_id(after.get("permanentId")) != clean_id(before.get("permanentId")):
        notes.append(f"[id] {platform} {new or old} {clean_id(after.get('permanentId'))}")
    return notes


def _match_account(disk_row: dict, desired: list) -> dict | None:
    for row in desired:
        if not isinstance(row, dict) or (row.get("platform") or "") != (disk_row.get("platform") or ""):
            continue
        if handles_equal(row.get("handle"), disk_row.get("handle")):
            return row
        if stored_permanent(row) and stored_permanent(row) == stored_permanent(disk_row):
            return row
        if any(handles_equal(item, disk_row.get("handle")) for item in row.get("previousHandles") or []):
            return row
    return None


def patch_identity_text(raw: str, disk: dict, config: dict) -> tuple[str, list]:
    notes = []
    by_id = {row.get("id"): row for row in (disk.get("feeds") or []) if isinstance(row, dict) and row.get("id")}
    for feed in config.get("feeds") or []:
        if not isinstance(feed, dict) or not feed.get("id"):
            continue
        before = by_id.get(feed.get("id"))
        if not before:
            continue
        if stored_permanent(before) and stored_permanent(feed) and stored_permanent(before) != stored_permanent(feed):
            continue
        span = _feed_span(raw, str(feed.get("id")))
        if not span:
            continue
        updated = _patch_span(raw[span[0] : span[1]], before, feed)
        if updated != raw[span[0] : span[1]]:
            raw = raw[: span[0]] + updated + raw[span[1] :]
            notes.extend(_identity_notes(before, feed))
    desired_accounts = []
    for person in config.get("people") or []:
        if isinstance(person, dict):
            desired_accounts.extend([row for row in person.get("accounts") or [] if isinstance(row, dict)])
    for person in disk.get("people") or []:
        if not isinstance(person, dict):
            continue
        for account in person.get("accounts") or []:
            if not isinstance(account, dict):
                continue
            match = _match_account(account, desired_accounts)
            if not match:
                continue
            if stored_permanent(account) and stored_permanent(match) and stored_permanent(account) != stored_permanent(match):
                continue
            span = _account_span(raw, str(account.get("platform") or ""), norm_handle(account.get("handle")))
            if not span:
                continue
            updated = _patch_span(raw[span[0] : span[1]], account, match)
            if updated != raw[span[0] : span[1]]:
                raw = raw[: span[0]] + updated + raw[span[1] :]
                notes.extend(_identity_notes(account, match))
    desired_tiktok = []
    for row in config.get("tiktok") or []:
        if not isinstance(row, dict) or not handle_ok(row.get("handle")):
            continue
        item = {"handle": norm_handle(row.get("handle"))}
        if clean_id(row.get("permanentId")):
            item["permanentId"] = clean_id(row.get("permanentId"))
        if clean_sec(row.get("secUid")):
            item["secUid"] = clean_sec(row.get("secUid"))
        previous = previous_of({"handle": item["handle"], "previousHandles": row.get("previousHandles")})
        if previous:
            item["previousHandles"] = previous
        desired_tiktok.append(item)
    if desired_tiktok:
        literal = json.dumps(desired_tiktok, ensure_ascii=False, indent=2)
        literal = "\n".join(("  " + line) if line else line for line in literal.splitlines())
        pattern = re.compile(r'"tiktok"\s*:\s*\[[\s\S]*?\]')
        if pattern.search(raw):
            replaced = pattern.sub('"tiktok": ' + literal.strip(), raw, count=1)
            if replaced != raw:
                notes.append("[id] tiktok " + desired_tiktok[0]["handle"] + " list")
                raw = replaced
        else:
            stripped = raw.rstrip()
            if stripped.endswith("}"):
                body = stripped[:-1].rstrip()
                if body.endswith(","):
                    body = body[:-1].rstrip()
                raw = body + ',\n  "tiktok": ' + literal.strip() + "\n}\n"
                notes.append("[id] tiktok " + desired_tiktok[0]["handle"] + " list")
    return raw, notes


def commit_file(path: Path, config: dict) -> list:
    raw = path.read_text(encoding="utf-8")
    disk = json.loads(raw)
    updated, notes = patch_identity_text(raw, disk, config)
    if updated != raw:
        if not updated.endswith("\n"):
            updated += "\n"
        path.write_text(updated, encoding="utf-8")
    return notes


def merge_identity_into_file(base_path: Path, incoming_path: Path) -> list:
    """Copy permanent ids and handle changes onto the checkout, not whole URLs."""
    incoming = json.loads(incoming_path.read_text(encoding="utf-8"))
    if not isinstance(incoming, dict):
        return []
    raw = base_path.read_text(encoding="utf-8")
    base = json.loads(raw)
    merged = json.loads(raw)
    feeds = []
    by_incoming = {row.get("id"): row for row in (incoming.get("feeds") or []) if isinstance(row, dict)}
    for feed in merged.get("feeds") or []:
        if not isinstance(feed, dict):
            feeds.append(feed)
            continue
        inc = by_incoming.get(feed.get("id"))
        if isinstance(inc, dict):
            _adopt(feed, inc)
        feeds.append(feed)
    merged["feeds"] = feeds
    people = []
    incoming_accounts = []
    for person in incoming.get("people") or []:
        if isinstance(person, dict):
            incoming_accounts.extend([row for row in person.get("accounts") or [] if isinstance(row, dict)])
    for person in merged.get("people") or []:
        if not isinstance(person, dict):
            people.append(person)
            continue
        accounts = []
        for account in person.get("accounts") or []:
            if isinstance(account, dict):
                match = _match_account(account, incoming_accounts)
                if match:
                    _adopt(account, match)
            accounts.append(account)
        person = dict(person)
        person["accounts"] = accounts
        people.append(person)
    merged["people"] = people
    if isinstance(incoming.get("tiktok"), list):
        merged["tiktok"] = incoming.get("tiktok")
    updated, notes = patch_identity_text(raw, base, merged)
    if updated != raw:
        if not updated.endswith("\n"):
            updated += "\n"
        base_path.write_text(updated, encoding="utf-8")
    return notes


def _adopt(base: dict, incoming: dict) -> None:
    """Overlay identity fields when the permanent id agrees."""
    if stored_permanent(base) and stored_permanent(incoming) and stored_permanent(base) != stored_permanent(incoming):
        return
    if clean_sec(base.get("secUid")) and clean_sec(incoming.get("secUid")) and clean_sec(base.get("secUid")) != clean_sec(incoming.get("secUid")):
        return
    old = norm_handle(base.get("handle"))
    new = norm_handle(incoming.get("handle"))
    if clean_id(incoming.get("permanentId")):
        base["permanentId"] = clean_id(incoming.get("permanentId"))
    if clean_sec(incoming.get("secUid")):
        base["secUid"] = clean_sec(incoming.get("secUid"))
    channel = str(incoming.get("channelId") or "")
    if CHANNEL_RE.fullmatch(channel) and not (base.get("channelId") and base.get("channelId") != channel):
        base["channelId"] = channel
    previous = previous_of(incoming)
    if new and old and not handles_equal(old, new):
        proved = any(handles_equal(item, old) for item in previous) or (
            stored_permanent(base) and stored_permanent(incoming) and stored_permanent(base) == stored_permanent(incoming)
        )
        if proved and handle_ok(new):
            rewrite_feed_urls(base, old, new)
            base["handle"] = new
            base["previousHandles"] = remember_handle(previous, old, new)
            return
    if previous:
        base["previousHandles"] = previous


def selftest() -> int:
    def check(cond, message):
        if not cond:
            raise SystemExit("FAIL: " + message)
        print("ok", message)

    feed = {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle", "permanentId": "44196397", "source_urls": ["{fxtwitterBase}/2/profile/redacted_handle/statuses"], "profile": {"url": "https://x.com/redacted_handle"}}
    other = {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle", "permanentId": "20749410"}
    renamed = apply_observation(feed, {"handle": "elonmusknew", "permanentId": "44196397", "authoritative": True}, [other])
    check(renamed["action"] == "rename" and feed["handle"] == "elonmusknew" and feed["id"] == "x:redacted_handle" and feed["previousHandles"] == ["redacted_handle"] and feed["permanentId"] == "44196397", "the same X id renames the handle and keeps the feed id")
    check(renamed["logs"] == ["[rename] x redacted_handle -> elonmusknew"], "a rename is logged with the platform and both handles")
    check(feed["source_urls"] == ["{fxtwitterBase}/2/profile/elonmusknew/statuses"] and feed["profile"]["url"] == "https://x.com/elonmusknew", "source URLs follow the new handle")
    blocked = apply_observation(dict(other), {"handle": "elonmusknew", "permanentId": "999", "authoritative": True}, [feed])
    check(blocked["action"] == "reject" and other["handle"] == "redacted_handle", "a different permanent id does not rename the account")
    fresh = {"id": "x:new", "platform": "x", "handle": "newname"}
    skipped = apply_observation(fresh, {"handle": "othername", "permanentId": "12345", "authoritative": True}, [])
    check(skipped["action"] == "skip" and fresh["handle"] == "newname" and "permanentId" not in fresh, "a different handle is not stored before the permanent id matches")
    filled = apply_observation(fresh, {"handle": "newname", "permanentId": "12345", "authoritative": True}, [])
    check(filled["action"] == "backfill" and fresh["permanentId"] == "12345" and fresh["handle"] == "newname", "the first matching handle stores the permanent id")
    clash = {"id": "x:elonmusknew", "platform": "x", "handle": "taken", "permanentId": "1"}
    victim = {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle", "permanentId": "44196397"}
    refused = apply_observation(victim, {"handle": "taken", "permanentId": "44196397", "authoritative": True}, [clash])
    check(refused["action"] == "reject" and victim["handle"] == "redacted_handle", "a handle that already belongs to another added account is left alone")
    token = replace_handle_token("https://vk.com/vk", "vk", "team")
    check(token == "https://vk.com/team", "a short handle changes the path and not the host")

    from adapters.fxtwitter import parse as parse_fx
    from adapters.vk import parse as parse_vk

    fx_payload = json.loads((ROOT / "scripts" / "fixtures" / "rename" / "x_new_handle.json").read_text(encoding="utf-8"))
    parsed = parse_fx(fx_payload, {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle", "permanentId": "44196397"})
    check(parsed["posts"] and parsed["posts"][0]["handle"] == "elonmusknew", "posts stay on the account when the X handle in the payload changes")
    observed = x_observation(fx_payload, {"platform": "x", "handle": "redacted_handle", "permanentId": "44196397"})
    check(observed and observed["handle"] == "elonmusknew" and observed["permanentId"] == "44196397", "the X timeline observation uses the stored id")
    stranger = json.loads((ROOT / "scripts" / "fixtures" / "rename" / "x_other_id.json").read_text(encoding="utf-8"))
    check(x_observation(stranger, {"platform": "x", "handle": "redacted_handle", "permanentId": "44196397"}) is None, "a quote or another id is not this account")
    check(parse_fx(stranger, {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle", "permanentId": "44196397"})["posts"] == [], "another account's posts are not kept")

    vk_payload = json.loads((ROOT / "scripts" / "fixtures" / "rename" / "vk_new_screen.json").read_text(encoding="utf-8"))
    vk_parsed = parse_vk(vk_payload, {"id": "vk:vk", "platform": "vk", "handle": "vk", "permanentId": "-22822305"})
    vk_obs = observation_from_profiles(vk_parsed)
    check(vk_obs and vk_obs["permanentId"] == "-22822305" and vk_obs["handle"] == "vkteam", "the VK owner id stays with the new screen name")

    html = (ROOT / "scripts" / "fixtures" / "rename" / "youtube_canonical.html").read_text(encoding="utf-8")
    check(youtube_handle_from_html(html, "UCfgtuaUadGgOA-91geQ8Qog") == "NewPrepper", "a YouTube channel page shows the current handle")
    check(youtube_handle_from_html(html, "UCxxxxxxxxxxxxxxxxxxxxxx") == "", "a different channel id does not supply the handle")
    channel = {"id": "youtube:redacted_handle", "platform": "youtube", "handle": "redacted_handle", "channelId": "UCfgtuaUadGgOA-91geQ8Qog"}
    moved = apply_observation(channel, {"handle": "NewPrepper", "permanentId": "UCfgtuaUadGgOA-91geQ8Qog", "authoritative": True}, [])
    check(moved["action"] == "rename" and channel["channelId"] == "UCfgtuaUadGgOA-91geQ8Qog" and channel["permanentId"] == "UCfgtuaUadGgOA-91geQ8Qog" and channel["id"] == "youtube:redacted_handle", "YouTube renames the handle and keeps the channel id")

    with_id = (ROOT / "scripts" / "fixtures" / "rename" / "telegram_with_id.html").read_text(encoding="utf-8")
    without = (ROOT / "scripts" / "fixtures" / "rename" / "telegram_without_id.html").read_text(encoding="utf-8")
    check(telegram_channel_id(with_id) == "-1001234567890", "a public Telegram channel id is stored")
    check(telegram_channel_id(without) == "", "a Telegram preview without a channel id does not invent one")
    tele = {"id": "telegram:telegram", "platform": "telegram", "handle": "telegram", "permanentId": "-1001234567890"}
    tele_move = apply_observation(tele, {"handle": "newstelegram", "permanentId": "-1001234567890", "authoritative": True}, [])
    check(tele_move["action"] == "rename" and tele["previousHandles"] == ["telegram"], "the same Telegram channel id renames the handle")
    plain = {"id": "telegram:telegram", "platform": "telegram", "handle": "telegram"}
    check(apply_observation(plain, {"handle": "newstelegram", "authoritative": True}, [])["action"] == "skip", "Telegram does not rename without a channel id")

    sample = '{\n  "cap": 300,\n  "feeds": [\n    {\n      "id": "x:redacted_handle",\n      "platform": "x",\n      "handle": "redacted_handle",\n      "source_urls": ["{fxtwitterBase}/2/profile/redacted_handle/statuses"],\n      "profile": {"url": "https://x.com/redacted_handle"}\n    }\n  ]\n}\n'
    desired = json.loads(sample)
    desired["feeds"][0]["handle"] = "elonmusknew"
    desired["feeds"][0]["permanentId"] = "44196397"
    desired["feeds"][0]["previousHandles"] = ["redacted_handle"]
    desired["feeds"][0]["source_urls"] = ["{fxtwitterBase}/2/profile/elonmusknew/statuses"]
    desired["feeds"][0]["profile"]["url"] = "https://x.com/elonmusknew"
    patched, notes = patch_identity_text(sample, json.loads(sample), desired)
    again = json.loads(patched)
    check(again["cap"] == 300 and again["feeds"][0]["handle"] == "elonmusknew" and again["feeds"][0]["permanentId"] == "44196397" and again["feeds"][0]["previousHandles"] == ["redacted_handle"], "the config gains the id and the new handle without a new feed id")
    check('["{fxtwitterBase}/2/profile/elonmusknew/statuses"]' in patched and "https://x.com/elonmusknew" in patched, "the saved source line keeps its shape")
    check(any(line.startswith("[rename] x ") for line in notes), "the config patch reports the rename")

    accounts = tiktok_accounts({"tiktok": [{"handle": "gabii_g5", "permanentId": "99", "previousHandles": ["old_gabii"]}]}, ["gabii_g5", "old_gabii"])
    check(len(accounts) == 1 and accounts[0]["permanentId"] == "99" and accounts[0]["previousHandles"] == ["old_gabii"], "a renamed TikTok account is not added twice")
    print("account identity selftest ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(selftest())
