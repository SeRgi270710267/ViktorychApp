#!/usr/bin/env python3
"""Add the original author of a repost as a site feed, without following them.

A configured account's repost, share, or public forward can name another
public account. That account is appended to feeds.config.json with
origin "repost" and defaultFollow false, so the next sync fetches it and
the Feeds page shows it as Added. It is not a default follow.

Accounts discovered from an auto-added source are ignored (one hop).
An account the owner removed stays in config["removed"] and is not added
again. perRun, total, and paceSeconds live under config["autoAdd"].
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from follow_request import (
    HANDLE,
    Reject,
    _same,
    aliases,
    check_url,
    confirm_source,
    default_fetch,
    entry_for,
    is_removed,
)

PLATFORMS = ("x", "threads", "instagram", "youtube", "vk", "telegram")
YT_CHANNEL = re.compile(r"^UC[\w-]{22}$")
ISO_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
TELEGRAM_SKIP = {"share", "addstickers", "joinchat", "iv", "proxy", "s"}
DEFAULT_PER_RUN = 3
DEFAULT_TOTAL = 12
DEFAULT_PACE = 2.0
PRIVATE_TEXT = (
    "this account is private",
    "this profile is private",
    "profile is private",
    "account is private",
    "user is deactivated",
    "account suspended",
    "sorry, this page isn't available",
    "this channel is private",
    "channel is private",
    "страница удалена",
    "пользователь заблокирован",
    "доступ к странице ограничен",
    "доступ ограничен",
)


def limits(config: dict) -> tuple[int, int, float]:
    raw = config.get("autoAdd") if isinstance(config.get("autoAdd"), dict) else {}

    def num(key: str, default: int, hi: int) -> int:
        try:
            value = int(raw.get(key) if raw.get(key) is not None else default)
        except (TypeError, ValueError):
            value = default
        return max(0, min(value, hi))

    try:
        pace = float(raw.get("paceSeconds") if raw.get("paceSeconds") is not None else DEFAULT_PACE)
    except (TypeError, ValueError):
        pace = DEFAULT_PACE
    pace = min(30.0, max(1.0, pace))
    return num("perRun", DEFAULT_PER_RUN, 10), num("total", DEFAULT_TOTAL, 40), pace


def pace_seconds(config: dict) -> float:
    return limits(config)[2]


def _source_rows(config: dict) -> list[dict]:
    rows = [feed for feed in (config.get("feeds") or []) if isinstance(feed, dict)]
    try:
        from people import extra_feeds

        for row in extra_feeds(config):
            if isinstance(row, dict):
                rows.append(row)
    except Exception:
        pass
    return rows


def _index(rows: list[dict]) -> dict[str, dict]:
    found = {}
    for feed in rows:
        for token in aliases(feed):
            found.setdefault(token, feed)
        ident = str(feed.get("id") or "").strip().lower()
        if ident:
            found.setdefault(ident, feed)
    return found


def _carrier(post: dict, index: dict[str, dict]) -> dict | None:
    by = post.get("repostedBy") if isinstance(post.get("repostedBy"), dict) else {}
    keys = []
    for value in (post.get("feedId"), by.get("feedId")):
        text = str(value or "").strip().lower()
        if text:
            keys.append(text)
    platform = str(by.get("platform") or post.get("platform") or "").strip().lower()
    handle = str(by.get("handle") or "").lstrip("@").strip().lower()
    if platform and handle:
        keys.append(platform + ":" + handle)
    for key in keys:
        row = index.get(key)
        if row:
            return row
    return None


def _clean_name(value) -> str:
    return re.sub(r"[\x00-\x1f]", " ", str(value or "")).strip()[:80]


def _iso(value) -> str:
    text = str(value or "").strip()
    if ISO_TIME.match(text):
        return text[:40]
    return ""


def clean_added_from(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    handle = str(raw.get("handle") or "").lstrip("@").strip()
    name = _clean_name(raw.get("name"))
    platform = str(raw.get("platform") or "").strip().lower()
    feed_id = str(raw.get("feedId") or "").strip()
    at = _iso(raw.get("at"))
    if not handle and not name:
        return None
    out = {}
    if feed_id and len(feed_id) <= 80 and " " not in feed_id and "\n" not in feed_id:
        out["feedId"] = feed_id
    if handle and len(handle) <= 40 and " " not in handle:
        out["handle"] = handle
    if name:
        out["name"] = name
    if platform in PLATFORMS:
        out["platform"] = platform
    if at:
        out["at"] = at
    return out or None


def _youtube_ids(post: dict) -> tuple[str, str]:
    channel = str(post.get("channelId") or "").strip()
    if not YT_CHANNEL.match(channel):
        other = str(post.get("profileHandle") or "").strip()
        channel = other if YT_CHANNEL.match(other) else ""
    handle = str(post.get("handle") or "").lstrip("@").strip()
    if YT_CHANNEL.match(handle):
        channel = channel or handle
    elif not HANDLE["youtube"].match(handle):
        handle = channel
    return handle, channel


def _valid_handle(platform: str, handle: str) -> bool:
    if platform not in HANDLE or not handle:
        return False
    if platform == "telegram" and handle.lower() in TELEGRAM_SKIP:
        return False
    if platform == "vk" and re.fullmatch(r"\d+", handle):
        return False
    return bool(HANDLE[platform].match(handle))


def _original(post: dict, carrier: dict) -> dict | None:
    if not isinstance(post, dict):
        return None
    platform = str(post.get("platform") or "").strip().lower()
    if platform not in PLATFORMS:
        return None
    kind = post.get("kind")
    forwarded = post.get("forwardedFrom") if isinstance(post.get("forwardedFrom"), dict) else {}
    carried = kind == "repost" or bool(forwarded.get("handle") or forwarded.get("name"))
    if not carried:
        return None
    name = _clean_name(post.get("author"))
    if platform == "youtube":
        handle, channel = _youtube_ids(post)
    else:
        handle = str(post.get("handle") or "").lstrip("@").strip()
        channel = ""
        if platform == "telegram":
            fwd = str(forwarded.get("handle") or "").lstrip("@").strip()
            if fwd:
                handle = fwd
                name = _clean_name(forwarded.get("name")) or name
            elif not handle:
                return None
    if not _valid_handle(platform, handle):
        return None
    carrier_handle = str(carrier.get("handle") or "").lstrip("@").strip().casefold()
    if handle.casefold() == carrier_handle:
        return None
    if channel and channel == str(carrier.get("channelId") or ""):
        return None
    by = post.get("repostedBy") if isinstance(post.get("repostedBy"), dict) else {}
    profile = carrier.get("profile") if isinstance(carrier.get("profile"), dict) else {}
    at = _iso(post.get("sortDate")) or _iso(post.get("date"))
    avatar = str(post.get("avatar") or "")
    if not avatar.startswith("https://") or len(avatar) > 400 or " " in avatar:
        avatar = ""
    return {
        "platform": platform,
        "handle": handle,
        "channelId": channel,
        "name": name or handle,
        "avatar": avatar,
        "at": at,
        "addedFrom": {
            "feedId": carrier.get("id") or "",
            "handle": str(carrier.get("handle") or by.get("handle") or "").lstrip("@"),
            "name": profile.get("name") or by.get("name") or carrier.get("handle") or "",
            "platform": carrier.get("platform") or by.get("platform") or platform,
            "at": at,
        },
    }


def _spec(item: dict) -> dict:
    platform = item["platform"]
    handle = item["handle"]
    channel = item.get("channelId") or ""
    if platform == "youtube" and channel:
        url = "https://www.youtube.com/channel/" + channel
    elif platform == "youtube":
        url = "https://www.youtube.com/@" + handle
    else:
        from adapters.common import profile_url

        url = profile_url(platform, handle)
    return {"platform": platform, "handle": handle, "url": url, "channelId": channel}


def _known(rows: list[dict], spec: dict) -> bool:
    return any(_same(feed, spec) for feed in rows)


def _captcha_or_denied(status: int, lowered: str) -> bool:
    if status in (401, 403, 429):
        return True
    if "cf-challenge" in lowered or "g-recaptcha" in lowered or "just a moment" in lowered:
        return True
    return status == 200 and "captcha" in lowered and len(lowered) < 4000


def _private(lowered: str) -> bool:
    return any(phrase in lowered for phrase in PRIVATE_TEXT)


def _body_ok(spec: dict, body: str) -> bool:
    platform = spec["platform"]
    sample = body or ""
    lowered = sample[:20000].lower()
    handle = spec["handle"].lower()
    if _private(lowered):
        return False
    if platform == "x":
        try:
            data = json.loads(sample)
        except json.JSONDecodeError:
            return False
        if not isinstance(data, dict) or data.get("code") not in (None, 200):
            return False
        user = data.get("user") if isinstance(data.get("user"), dict) else data
        return bool(user.get("screen_name") or user.get("handle") or user.get("name"))
    if platform == "telegram":
        if handle not in lowered:
            return False
        if "channel is private" in lowered:
            return False
        return "tgme_widget_message_wrap" in lowered or "data-post=" in lowered
    if platform == "vk":
        return handle in lowered
    if platform == "youtube":
        return "<feed" in lowered or "<entry" in lowered or (spec.get("channelId") or "").lower() in lowered
    if platform in ("instagram", "threads"):
        if handle not in lowered:
            return False
        return "og:description" in lowered or "biography" in lowered
    return False


def _probe(spec: dict, fetch, resolve) -> tuple[dict | None, str]:
    target = check_url(spec)
    try:
        status, body = fetch(target)
    except Exception:
        return None, "skip"
    sample = body or ""
    lowered = sample[:20000].lower()
    if _captcha_or_denied(status, lowered):
        return None, "stop"
    if status != 200 or not sample.strip():
        return None, "skip"

    def sticky(url: str):
        if url == target:
            return status, sample
        return fetch(url)

    try:
        confirmed = confirm_source(dict(spec), sticky, resolve)
    except Reject:
        return None, "skip"
    if not _body_ok(confirmed, sample):
        return None, "skip"
    return confirmed, "ok"


def _decorate(row: dict, item: dict) -> dict:
    row = dict(row)
    row["origin"] = "repost"
    row["defaultFollow"] = False
    if row.get("platform") != "youtube":
        row["limit"] = 4
    note = clean_added_from(item.get("addedFrom"))
    if note:
        row["addedFrom"] = note
    profile = dict(row.get("profile") or {})
    if item.get("name"):
        profile["name"] = item["name"]
    avatar = item.get("avatar") or ""
    if avatar:
        profile["avatar"] = avatar
    row["profile"] = profile
    return row


def _matches_template(feed: dict) -> bool:
    """Reject a feed whose URLs were not produced by the normal entry builder."""
    if not isinstance(feed, dict) or feed.get("origin") != "repost" or feed.get("defaultFollow") is not False:
        return False
    platform = feed.get("platform") or ""
    handle = str(feed.get("handle") or "")
    if platform not in PLATFORMS or not _valid_handle(platform, handle):
        return False
    channel = str(feed.get("channelId") or "")
    if platform == "youtube" and channel and not YT_CHANNEL.match(channel):
        return False
    profile = feed.get("profile") if isinstance(feed.get("profile"), dict) else {}
    spec = {
        "platform": platform,
        "handle": handle,
        "url": profile.get("url") or "",
        "channelId": channel,
    }
    try:
        expected = entry_for(spec)
    except Exception:
        return False
    for key in ("id", "adapter", "platform", "handle", "source_urls", "fallbacks"):
        if feed.get(key) != expected.get(key):
            return False
    if channel and feed.get("channelId") != expected.get("channelId"):
        return False
    return True


def apply_auto_adds(config: dict, posts, fetch=None, sleep=None, resolve=None) -> list[str]:
    """Append newly discovered public accounts. Returns the ids added."""
    if not isinstance(config, dict):
        return []
    per_run, total, pace = limits(config)
    rows = _source_rows(config)
    existing = sum(1 for feed in (config.get("feeds") or []) if isinstance(feed, dict) and feed.get("origin") == "repost")
    budget = min(per_run, max(0, total - existing))
    if budget <= 0:
        return []
    index = _index(rows)
    grouped: dict[str, dict] = {}
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        carrier = _carrier(post, index)
        if not carrier or carrier.get("origin") == "repost":
            continue
        item = _original(post, carrier)
        if not item:
            continue
        spec = _spec(item)
        if _known(rows, spec) or is_removed(config, spec):
            continue
        key = (spec["platform"] + ":" + spec["handle"]).casefold()
        if spec.get("channelId"):
            key = spec["platform"] + ":" + spec["channelId"]
        slot = grouped.get(key)
        if slot is None:
            item["count"] = 1
            item["spec"] = spec
            grouped[key] = item
        else:
            slot["count"] += 1
            if item.get("at", "") >= slot.get("at", ""):
                item["count"] = slot["count"]
                item["spec"] = spec
                grouped[key] = item
    ordered = sorted(grouped.values(), key=lambda item: (item.get("count") or 0, item.get("at") or ""), reverse=True)
    getter = fetch or default_fetch
    pause = sleep or time.sleep
    halted: set[str] = set()
    added: list[str] = []
    for item in ordered:
        if len(added) >= budget:
            break
        platform = item["platform"]
        if platform in halted:
            continue
        pause(pace)
        confirmed, status = _probe(item["spec"], getter, resolve)
        if status == "stop":
            halted.add(platform)
            print(f"[auto-add] skip {platform}: public check returned 401, 403, or a challenge")
            continue
        if confirmed is None:
            print(f"[auto-add] skip {platform}:{item['handle']}: not a public account")
            continue
        try:
            row = _decorate(entry_for(confirmed), item)
        except Exception as exc:
            print(f"[auto-add] skip {platform}:{item['handle']}: {exc}")
            continue
        if not _matches_template(row):
            print(f"[auto-add] skip {row.get('id')}: source did not match the feed template")
            continue
        if _known(rows, confirmed) or is_removed(config, row):
            continue
        config.setdefault("feeds", []).append(row)
        rows.append(row)
        added.append(row["id"])
        by = (row.get("addedFrom") or {}).get("feedId") or ""
        print(f"[auto-add] {row['id']} from {by}")
    return added


def stamp_profiles(profiles: list, feeds: list) -> None:
    """Copy origin onto the published profile and keep auto-added accounts unfollowed."""
    rows = [feed for feed in feeds or [] if isinstance(feed, dict) and feed.get("id")]
    by_id = {feed["id"]: feed for feed in rows}
    seen = set()
    for profile in profiles or []:
        if not isinstance(profile, dict):
            continue
        row = by_id.get(profile.get("id"))
        if row and row.get("origin") == "repost":
            profile["origin"] = "repost"
            profile["configured"] = False
            note = clean_added_from(row.get("addedFrom"))
            if note:
                profile["addedFrom"] = note
            else:
                profile.pop("addedFrom", None)
        elif row:
            profile.pop("origin", None)
            profile.pop("addedFrom", None)
            profile["configured"] = row.get("defaultFollow", True) is not False
        else:
            profile.pop("origin", None)
            profile.pop("addedFrom", None)
        if profile.get("id"):
            seen.add(profile.get("id"))
    for feed in rows:
        if feed.get("origin") != "repost" or feed.get("id") in seen:
            continue
        from adapters.common import blank_profile

        profile_src = feed.get("profile") if isinstance(feed.get("profile"), dict) else {}
        avatar = str(profile_src.get("avatar") or "")
        if not avatar.startswith("https://"):
            avatar = ""
        profile = blank_profile(
            feed.get("platform") or "",
            feed.get("handle") or "",
            profile_src.get("name") or feed.get("handle") or "",
            avatar,
        )
        profile["id"] = feed.get("id") or profile["id"]
        if feed.get("channelId"):
            profile["channelId"] = feed["channelId"]
        if profile_src.get("url"):
            profile["url"] = profile_src["url"]
        profile["origin"] = "repost"
        profile["configured"] = False
        note = clean_added_from(feed.get("addedFrom"))
        if note:
            profile["addedFrom"] = note
        profiles.append(profile)


def _array_end(raw: str, key: str) -> int:
    token = '"' + key + '"'
    at = raw.find(token)
    if at < 0:
        raise ValueError("missing " + key)
    bracket = raw.find("[", at)
    if bracket < 0:
        raise ValueError("missing " + key + " list")
    depth = 0
    in_str = False
    escape = False
    for index in range(bracket, len(raw)):
        ch = raw[index]
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
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return index
    raise ValueError("unclosed " + key)


def splice_feeds(raw: str, feeds: list) -> str:
    """Insert feed objects into the feeds array without reformatting the rest."""
    if not feeds:
        return raw
    end = _array_end(raw, "feeds")
    start = raw.rfind("[", 0, end)
    body = raw[start + 1:end]
    chunks = []
    for feed in feeds:
        text = json.dumps(feed, ensure_ascii=False, indent=2)
        chunks.append("\n".join("    " + line for line in text.splitlines()))
    block = ",\n".join(chunks)
    nonempty = any(not ch.isspace() for ch in body)
    if nonempty:
        insert = ",\n" + block + "\n  "
    else:
        insert = "\n" + block + "\n  "
    return raw[:end] + insert + raw[end:]


def feeds_to_merge(base: dict, incoming: dict) -> list[dict]:
    per_run, total, _pace = limits(base if isinstance(base.get("autoAdd"), dict) else incoming)
    removed_config = base
    rows = [feed for feed in (base.get("feeds") or []) if isinstance(feed, dict)]
    existing = sum(1 for feed in rows if feed.get("origin") == "repost")
    room = min(per_run, max(0, total - existing))
    added = []
    for feed in incoming.get("feeds") or []:
        if room <= 0:
            break
        if not _matches_template(feed):
            continue
        spec = {
            "platform": feed.get("platform"),
            "handle": feed.get("handle"),
            "url": ((feed.get("profile") or {}) if isinstance(feed.get("profile"), dict) else {}).get("url") or "",
            "channelId": feed.get("channelId") or "",
        }
        if _known(rows, spec) or is_removed(removed_config, feed):
            continue
        rows.append(feed)
        added.append(feed)
        room -= 1
    return added


def merge_into_file(base_path: Path, incoming_path: Path) -> list[str]:
    raw = base_path.read_text(encoding="utf-8")
    base = json.loads(raw)
    incoming = json.loads(incoming_path.read_text(encoding="utf-8"))
    new_feeds = feeds_to_merge(base, incoming)
    if not new_feeds:
        return []
    base_path.write_text(splice_feeds(raw, new_feeds), encoding="utf-8")
    return [str(feed.get("id") or "") for feed in new_feeds]


def write_new_feeds(path: Path, feeds: list) -> None:
    if not feeds:
        return
    raw = path.read_text(encoding="utf-8")
    path.write_text(splice_feeds(raw, feeds), encoding="utf-8")
