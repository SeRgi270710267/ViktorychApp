#!/usr/bin/env python3
"""Validate, repair, or quarantine every post before feeds.json is written.

Every adapter already builds posts with adapters.common.post_shell. This is
the last gate in front of the site: each post is checked against
docs/post.schema.json, repaired where a safe repair exists, and skipped with a
logged reason when it cannot be shown. A broken item never breaks the feed.

It also counts, per platform and adapter, how many fresh items parsed cleanly
and keeps a short history in feeds.json under "parseHealth", so a platform
that changed its markup shows up as drift in the sync report (see
scripts/sync_health.py) before people notice empty or odd cards.

Usage:
  python3 scripts/normalize.py --check feeds.json   # validate a document, print reasons
  python3 scripts/normalize.py --selftest           # run scripts/normalize_test.py
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
SCHEMA_PATH = ROOT / "docs" / "post.schema.json"

KINDS = ("post", "reply", "repost", "quote", "community", "article", "short", "live", "story")
# Types the renderer (app.js mediaHtml) understands. A known type is never rewritten.
MEDIA_TYPES = ("photo", "image", "video", "animated_gif", "audio", "embed", "placeholder", "file")
# These still render without a direct URL (Meta embed, videoId, "Open original").
URLLESS_OK = ("video", "animated_gif", "embed", "placeholder")
MEDIA_ALIASES = {
    "image": "photo", "img": "photo", "picture": "photo", "photo": "photo", "thumbnail": "photo",
    "gif": "animated_gif", "animated_gif": "animated_gif", "animatedgif": "animated_gif",
    "video": "video", "movie": "video", "clip": "video", "reel": "video", "hls": "video",
    "audio": "audio", "voice": "audio", "sound": "audio", "music": "audio",
    "embed": "embed", "iframe": "embed",
}
STAT_KEYS = ("replies", "reposts", "quotes", "likes", "views", "bookmarks")
PROFILE_COUNTS = ("followers", "following", "postsCount")
VIDEO_EXT = (".mp4", ".m4v", ".mov", ".webm", ".m3u8", ".mpd", ".ts")
AUDIO_EXT = (".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac")
GIF_EXT = (".gif",)
LOCAL_MEDIA = re.compile(r"^(?:\./)?(?:media|data|icons|logo)/\S+$")
ENTITY = re.compile(r"&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")
MARKUP = re.compile(r"<\s*/?\s*(?:p|br|div|span|a|img|b|i|em|strong|blockquote|ul|ol|li|figure|video|source)\b[^>]*>", re.I)
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]")
BLANK_RUN = re.compile(r"\n{3,}")
FUTURE_SLACK = timedelta(hours=36)
DRIFT_MIN_ITEMS = 5
DRIFT_RATE = 0.8
DRIFT_DROP = 0.2
HISTORY = 6


# ---------------------------------------------------------------- schema check

_SCHEMA = None


def schema() -> dict:
    global _SCHEMA
    if _SCHEMA is None:
        _SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return _SCHEMA


def _type_ok(value, want) -> bool:
    kinds = want if isinstance(want, list) else [want]
    for kind in kinds:
        if kind == "string" and isinstance(value, str):
            return True
        if kind == "integer" and isinstance(value, int) and not isinstance(value, bool):
            return True
        if kind == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
            return True
        if kind == "object" and isinstance(value, dict):
            return True
        if kind == "array" and isinstance(value, list):
            return True
        if kind == "null" and value is None:
            return True
        if kind == "boolean" and isinstance(value, bool):
            return True
    return False


def _resolve(node: dict, root: dict) -> dict:
    while isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        target = root
        for part in ref.lstrip("#/").split("/"):
            target = target[part]
        node = target
    return node


def check(value, node: dict | None = None, path: str = "post", root: dict | None = None) -> list[str]:
    """Return schema errors for value. Covers the subset docs/post.schema.json uses."""
    root = root or schema()
    node = _resolve(root if node is None else node, root)
    errors: list[str] = []
    if "oneOf" in node:
        if not any(not check(value, option, path, root) for option in node["oneOf"]):
            errors.append(f"{path}: matches no allowed shape")
        return errors
    if "enum" in node and value not in node["enum"]:
        return [f"{path}: {str(value)[:40]!r} is not one of {', '.join(map(str, node['enum']))}"]
    if "type" in node and not _type_ok(value, node["type"]):
        return [f"{path}: expected {node['type']}, got {type(value).__name__}"]
    if isinstance(value, str):
        if "minLength" in node and len(value) < node["minLength"]:
            errors.append(f"{path}: empty")
        if "maxLength" in node and len(value) > node["maxLength"]:
            errors.append(f"{path}: longer than {node['maxLength']}")
        if "pattern" in node and not re.search(node["pattern"], value):
            errors.append(f"{path}: bad format")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in node and value < node["minimum"]:
            errors.append(f"{path}: below {node['minimum']}")
        if "maximum" in node and value > node["maximum"]:
            errors.append(f"{path}: above {node['maximum']}")
    if isinstance(value, dict):
        for key in node.get("required") or []:
            if key not in value:
                errors.append(f"{path}.{key}: missing")
        for key, sub in (node.get("properties") or {}).items():
            if key in value:
                errors.extend(check(value[key], sub, f"{path}.{key}", root))
    if isinstance(value, list):
        if "minItems" in node and len(value) < node["minItems"]:
            errors.append(f"{path}: fewer than {node['minItems']} items")
        if "items" in node:
            for index, item in enumerate(value):
                errors.extend(check(item, node["items"], f"{path}[{index}]", root))
    return errors


def check_profile(profile) -> list[str]:
    root = schema()
    return check(profile, root["$defs"]["profile"], "profile", root)


# ------------------------------------------------------------- field repairs


def as_text(value) -> str:
    """Any value to clean display text: entities decoded once, NFC, no control characters."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = " ".join(as_text(item) for item in value)
    elif isinstance(value, dict):
        value = value.get("text") or value.get("simpleText") or value.get("content") or ""
    text = str(value)
    if ENTITY.search(text):
        text = html.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    text = CONTROL.sub("", text)
    text = unicodedata.normalize("NFC", text)
    text = BLANK_RUN.sub("\n\n", text)
    return text.strip()


def one_line(value) -> str:
    return re.sub(r"\s+", " ", as_text(value)).strip()


def as_count(value):
    """A count as a non-negative int, or None when unknown (shown as a soft blank)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if value >= 0 and value == value else None
    text = str(value).strip().replace(",", "").replace("\u00a0", "").replace(" ", "").lower()
    if not text:
        return None
    match = re.fullmatch(r"(\d+(?:[.,]\d+)?)([kmb]|тыс\.?|млн\.?)?\+?", text)
    if not match:
        return None
    number = float(match.group(1).replace(",", "."))
    scale = {"k": 1e3, "m": 1e6, "b": 1e9, "тыс": 1e3, "тыс.": 1e3, "млн": 1e6, "млн.": 1e6}.get(match.group(2) or "", 1)
    return int(round(number * scale))


def http_url(value) -> str:
    text = one_line(value)
    if text.startswith("//"):
        text = "https:" + text
    try:
        parts = urlsplit(text)
    except ValueError:
        return ""
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc or re.search(r"\s", text):
        return ""
    return text


def media_url(value) -> str:
    text = one_line(value)
    if LOCAL_MEDIA.match(text) or text.startswith("data:image/"):
        return text
    return http_url(text)


_AGO = re.compile(r"^(?:about\s+)?(\d+|an?|one)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|week|mo|month|y|yr|year)s?\s+ago$", re.I)
_AGO_SECONDS = {"s": 1, "sec": 1, "second": 1, "m": 60, "min": 60, "minute": 60, "h": 3600, "hr": 3600, "hour": 3600,
                "d": 86400, "day": 86400, "w": 604800, "week": 604800, "mo": 2592000, "month": 2592000, "y": 31536000, "yr": 31536000, "year": 31536000}


def relative_date(text: str, now: datetime | None = None) -> str:
    """'3 hours ago' as an approximate ISO time; '' when the text is not relative."""
    match = _AGO.match((text or "").strip())
    if not match:
        return ""
    count = 1 if match.group(1).lower() in ("a", "an", "one") else int(match.group(1))
    moment = (now or datetime.now(timezone.utc)) - timedelta(seconds=count * _AGO_SECONDS[match.group(2).lower()])
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def iso_date(value, now: datetime | None = None) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, str) and relative_date(value, now):
        return relative_date(value, now)
    from adapters.common import format_time, parse_time

    text = str(value).strip() if isinstance(value, str) else value
    if isinstance(text, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        text += "T00:00:00Z"
    try:
        parsed = parse_time(text)
    except Exception:
        parsed = None
    if parsed is None or parsed.year < 1990:
        return ""
    return format_time(parsed)


def guess_media_type(url: str, declared: str = "", mime: str = "") -> str:
    """Media type from the declared type, then the MIME type, then the file extension."""
    key = re.sub(r"[^a-z_]", "", (declared or "").lower())
    if key in MEDIA_TYPES:
        return key
    if key in MEDIA_ALIASES:
        return MEDIA_ALIASES[key]
    mime = (mime or "").lower()
    if mime.startswith("video/") or "mpegurl" in mime or "dash+xml" in mime:
        return "video"
    if mime == "image/gif":
        return "animated_gif"
    if mime.startswith("image/"):
        return "photo"
    if mime.startswith("audio/"):
        return "audio"
    path = urlsplit(url or "").path.lower()
    if path.endswith(VIDEO_EXT):
        return "video"
    if path.endswith(AUDIO_EXT):
        return "audio"
    if path.endswith(GIF_EXT):
        return "animated_gif"
    host = urlsplit(url or "").netloc.lower()
    if any(name in host for name in ("youtube.com", "youtu.be", "player.vimeo.com")):
        return "embed"
    return "photo"


def repair_media(items, reasons: list) -> list:
    out = []
    seen = set()
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            item = {"url": item}
        if not isinstance(item, dict):
            reasons.append("media: dropped a non-object entry")
            continue
        raw_url = item.get("url") or item.get("src") or item.get("href") or ""
        url = media_url(raw_url)
        declared = str(item.get("type") or item.get("kind") or "")
        kind = guess_media_type(url, declared, str(item.get("mime") or item.get("mimeType") or ""))
        has_other = bool(media_url(item.get("poster") or "") or item.get("videoId") or item.get("stream") or item.get("fallback"))
        if not url and not (kind in URLLESS_OK or has_other):
            reasons.append("media: dropped an entry without a usable URL")
            continue
        if url and url in seen:
            continue
        if url:
            seen.add(url)
        elif raw_url:
            reasons.append("media: unusable URL cleared")
        row = dict(item)
        row["url"] = url
        row["type"] = kind
        row["poster"] = media_url(item.get("poster") or item.get("thumbnail") or item.get("preview") or "")
        if row["type"] == "photo" and not row["poster"]:
            row["poster"] = url
        for key in ("width", "height"):
            n = as_count(item.get(key))
            row[key] = n if n else None
        duration = item.get("duration")
        if duration is not None:
            try:
                duration = float(duration)
                row["duration"] = int(duration) if duration.is_integer() else duration
                if duration < 0:
                    row.pop("duration")
            except (TypeError, ValueError):
                row.pop("duration", None)
        row["alt"] = as_text(item.get("alt") or item.get("description") or "")[:1500]
        out.append(row)
    return out


def repair_links(items) -> list:
    out = []
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            url = http_url(item)
            if url:
                from adapters.common import shorten_url

                out.append({"expanded": url, "display": shorten_url(url), "anchorText": ""})
            continue
        if isinstance(item, dict):
            row = dict(item)
            for key in ("expanded", "display", "anchorText"):
                if key in row and not isinstance(row[key], str):
                    row[key] = one_line(row[key])
            out.append(row)
    return out


def repair_stats(stats) -> dict:
    out = {}
    if not isinstance(stats, dict):
        return out
    for key, value in stats.items():
        n = as_count(value)
        if key in STAT_KEYS:
            if n is not None:
                out[key] = n
        elif value is not None:
            out[key] = value
    return out


def repair_poll(poll, reasons: list):
    if not isinstance(poll, dict):
        return None
    choices = []
    for choice in poll.get("choices") or poll.get("options") or []:
        if isinstance(choice, str):
            choice = {"text": choice}
        if not isinstance(choice, dict):
            continue
        label = one_line(choice.get("text") or choice.get("label") or choice.get("title") or "")
        if not label:
            continue
        row = {key: value for key, value in choice.items() if key not in ("label", "title")}
        row["text"] = label
        percent = choice.get("percent")
        try:
            percent = float(str(percent).rstrip("%")) if percent not in (None, "") else None
        except ValueError:
            percent = None
        if percent is None or not 0 <= percent <= 100:
            row.pop("percent", None)
        else:
            row["percent"] = percent
        votes = as_count(choice.get("votes"))
        if votes is None:
            row.pop("votes", None)
        else:
            row["votes"] = votes
        choices.append(row)
    if not choices:
        reasons.append("poll: no readable choices, dropped")
        return None
    out = dict(poll)
    out.pop("options", None)
    out["choices"] = choices
    if "question" in out:
        out["question"] = one_line(out["question"])
    total = as_count(poll.get("totalVotes"))
    if total is None:
        out.pop("totalVotes", None)
    else:
        out["totalVotes"] = total
    return out


def repair_link_card(card, reasons: list):
    if not isinstance(card, dict):
        return None
    url = http_url(card.get("url") or card.get("href") or "")
    if not url:
        reasons.append("link card: no usable URL, dropped")
        return None
    out = dict(card)
    out["url"] = url
    for key in ("site", "title", "description"):
        if key in out:
            out[key] = one_line(out[key])
    if "image" in out:
        out["image"] = media_url(out["image"])
    return out


def platform_from_url(url: str) -> str:
    host = urlsplit(url or "").netloc.lower()
    for needle, name in (
        ("x.com", "x"), ("twitter.com", "x"), ("threads.", "threads"), ("instagram.com", "instagram"),
        ("youtube.com", "youtube"), ("youtu.be", "youtube"), ("tiktok.com", "tiktok"), ("t.me", "telegram"),
        ("vk.com", "vk"), ("vk.ru", "vk"), ("discord", "discord"), ("reddit.com", "reddit"),
    ):
        if needle in host:
            return name
    return "rss" if host else ""


def _text_from_markup(post: dict, reasons: list) -> None:
    """A feed that started sending HTML in a plain-text field is converted, not shown raw."""
    text = post.get("text") or ""
    if not MARKUP.search(text):
        return
    from adapters.common import html_to_parts

    parts = html_to_parts(text)
    post["text"] = parts.get("text") or ""
    have = {m.get("url") for m in post.get("media") or [] if isinstance(m, dict)}
    for item in parts.get("media") or []:
        if item.get("url") and item["url"] not in have:
            post.setdefault("media", []).append(item)
    if parts.get("links") and not post.get("links"):
        post["links"] = parts["links"]
    reasons.append("text: converted markup to plain text")


def repair_post(raw, now: datetime | None = None, nested: bool = False):
    """Return (post or None, reasons). None means the item cannot be shown."""
    reasons: list[str] = []
    if not isinstance(raw, dict):
        return None, ["not an object"]
    now = now or datetime.now(timezone.utc)
    post = dict(raw)
    post["url"] = http_url(post.get("url") or post.get("link") if isinstance(post.get("link"), str) else post.get("url") or "")
    ident = one_line(post.get("id") or post.get("statusId") or post.get("guid") or "")
    if not ident and post["url"]:
        ident = "u" + hashlib.sha1(post["url"].encode("utf-8")).hexdigest()[:16]
        reasons.append("id: made from the URL")
    if not ident and nested:
        ident = "q" + hashlib.sha1(json.dumps(raw, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]
    if not ident:
        return None, ["no id and no URL"]
    post["id"] = ident[:400]
    post["statusId"] = one_line(post.get("statusId") or ident)[:400]
    platform = one_line(post.get("platform")).lower()
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", platform or ""):
        platform = platform_from_url(post["url"]) or "rss"
        if not nested:
            reasons.append("platform: guessed from the URL")
    post["platform"] = platform
    kind = one_line(post.get("kind")).lower() or "post"
    if kind not in KINDS:
        reasons.append(f"kind: unknown {kind[:20]!r}, shown as a post")
        kind = "post"
    post["kind"] = kind
    post["handle"] = one_line(post.get("handle")).lstrip("@").replace(" ", "")[:200]
    post["author"] = one_line(post.get("author") or post.get("name") or "")[:400] or post["handle"]
    post["avatar"] = media_url(post.get("avatar") or "")
    vt = post.get("verifiedType")
    post["verifiedType"] = vt if isinstance(vt, str) and vt else None
    post["text"] = as_text(post.get("text"))
    post["media"] = repair_media(post.get("media"), reasons)
    _text_from_markup(post, reasons)
    post["media"] = repair_media(post.get("media"), reasons)
    post["links"] = repair_links(post.get("links"))
    post["images"] = [m["url"] for m in post["media"] if m["type"] == "photo"]
    for key in ("date", "sortDate"):
        if key not in post:
            continue
        before = post.get(key)
        post[key] = iso_date(before, now)
        if before and not post[key]:
            reasons.append(f"{key}: unreadable time dropped")
    if post.get("date"):
        moment = datetime.fromisoformat(post["date"].replace("Z", "+00:00"))
        if moment - now > FUTURE_SLACK:
            reasons.append("date: in the future, dropped")
            post["date"] = ""
    if not post.get("date") and post.get("sortDate"):
        post["date"] = post["sortDate"]
    if "sortDate" in post and not post["sortDate"]:
        post.pop("sortDate")
    if "stats" in post:
        stats = repair_stats(post.get("stats"))
        if stats:
            post["stats"] = stats
        else:
            post.pop("stats")
    if "poll" in post:
        poll = repair_poll(post.get("poll"), reasons)
        if poll:
            post["poll"] = poll
        else:
            post.pop("poll")
    if isinstance(post.get("link"), dict):
        card = repair_link_card(post.get("link"), reasons)
        if card:
            post["link"] = card
        else:
            post.pop("link")
    elif "link" in post and not isinstance(post.get("link"), str):
        post.pop("link")
    for key in ("repostedBy", "replyingTo"):
        value = post.get(key)
        if value is not None and not isinstance(value, dict):
            post[key] = None
            reasons.append(f"{key}: not an object, dropped")
        elif isinstance(value, dict) and "handle" in value:
            value = dict(value)
            value["handle"] = one_line(value.get("handle")).lstrip("@")
            post[key] = value
    replying = post.get("replyingTo")
    if isinstance(replying, dict) and not nested:
        if replying.get("text") or replying.get("media"):
            fixed, _why = repair_post(dict(replying, platform=replying.get("platform") or post["platform"]), now, nested=True)
            replying = fixed if fixed is not None else {k: replying[k] for k in ("id", "statusId", "handle", "name", "avatar", "url") if k in replying}
        if not replying.get("statusId") and replying.get("id"):
            replying["statusId"] = str(replying["id"])
        post["replyingTo"] = stamp_reference(replying, post["platform"])
    quoted = post.get("quoted")
    if quoted is not None:
        if isinstance(quoted, dict) and not quoted.get("platform"):
            quoted = dict(quoted, platform=post["platform"])
        fixed, why = repair_post(quoted, now, nested=True) if isinstance(quoted, dict) else (None, ["not an object"])
        if fixed is None:
            reasons.append("quoted: unreadable, dropped (" + "; ".join(why)[:80] + ")")
            post["quoted"] = None
            if post["kind"] == "quote":
                post["kind"] = "post"
        else:
            post["quoted"] = stamp_reference(fixed, post["platform"]) if not nested else fixed
    else:
        post["quoted"] = None
    post.setdefault("repostedBy", None)
    post.setdefault("replyingTo", None)
    has_body = bool(post["text"] or post["media"] or post.get("quoted") or post.get("article") or post.get("poll") or post.get("link") or post.get("html") or post.get("title") or post.get("cards"))
    if not has_body and not nested:
        return None, reasons + ["nothing to show (no text, media, quote, poll or link)"]
    if not post["author"] and not post["handle"] and not nested:
        post["author"] = platform_label(post["platform"])
        reasons.append("author: missing, shown as the platform name")
    if nested:
        for key in [k for k in post if k not in raw and post[k] in ("", [], None)]:
            post.pop(key)
        if "images" in post and "images" not in raw:
            post.pop("images")
    if not nested:
        post.setdefault("date", "")
        post["ref"] = ref_key(post)
        post["cid"] = content_id(post)
    errors = check(post) if not nested else check(post, schema()["$defs"]["quoted"])
    if errors:
        return None, reasons + errors[:5]
    return post, reasons


def ref_key(item: dict, platform: str = "") -> str:
    """Stable identity of an item at its source: "platform:statusId"."""
    status = one_line(item.get("statusId") or item.get("id") or "")
    plat = one_line(item.get("platform") or platform).lower()
    return f"{plat}:{status}" if plat and status else ""


def content_id(item: dict) -> str:
    """Content address of an item, the same on every device, so a peer can verify a P2P copy.

    Built from what the card shows and never changes (no counts, no expiring CDN query strings).
    """
    media = sorted(str(m.get("url") or m.get("poster") or "").split("?")[0] for m in item.get("media") or [] if isinstance(m, dict))
    basis = {
        "ref": ref_key(item),
        "handle": (item.get("handle") or "").lower(),
        "text": item.get("text") or "",
        "media": media,
        "date": item.get("date") or "",
    }
    digest = hashlib.sha256(json.dumps(basis, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return "c1-" + digest[:32]


def stamp_reference(item: dict, parent_platform: str) -> dict:
    """Mark a quoted or replied-to item as a referenced item: embedded when it can render on its own."""
    item = dict(item)
    if not item.get("platform") and parent_platform:
        item["platform"] = parent_platform
    ref = ref_key(item, parent_platform)
    if ref:
        item["ref"] = ref
    item["embedded"] = bool(item.get("text") or item.get("media") or item.get("poll") or item.get("link"))
    if item["embedded"]:
        item["cid"] = content_id(item)
    else:
        item.pop("cid", None)
    return item


def platform_label(platform: str) -> str:
    return {
        "x": "X", "threads": "Threads", "instagram": "Instagram", "youtube": "YouTube", "tiktok": "TikTok",
        "telegram": "Telegram", "vk": "VK", "discord": "Discord", "reddit": "Reddit", "rss": "RSS",
    }.get(platform, platform.capitalize() or "Post")


def repair_profile(raw):
    if not isinstance(raw, dict):
        return None, ["not an object"]
    reasons = []
    profile = dict(raw)
    profile["handle"] = one_line(profile.get("handle")).lstrip("@")
    profile["platform"] = one_line(profile.get("platform")).lower()
    profile["id"] = one_line(profile.get("id")) or (f"{profile['platform']}:{profile['handle']}" if profile["handle"] else "")
    if not profile["id"]:
        return None, ["profile without id or handle"]
    profile["name"] = one_line(profile.get("name")) or profile["handle"] or platform_label(profile["platform"])
    if profile.get("title") is not None:
        profile["title"] = one_line(profile.get("title")) or profile["name"]
    profile["avatar"] = media_url(profile.get("avatar") or "")
    if "banner" in profile:
        profile["banner"] = media_url(profile.get("banner") or "")
    if "url" in profile:
        profile["url"] = http_url(profile.get("url") or "")
    if "bio" in profile:
        profile["bio"] = as_text(profile.get("bio"))
    for key in PROFILE_COUNTS:
        if key in profile:
            n = as_count(profile.get(key))
            if n is None:
                profile.pop(key)
                reasons.append(f"{key}: unknown, left blank")
            else:
                profile[key] = n
    errors = check_profile(profile)
    if errors:
        return None, reasons + errors[:5]
    return profile, reasons


# ------------------------------------------------------------ whole document


def source_key(post: dict) -> str:
    return f"{post.get('platform') or '?'}/{post.get('iaSource') or 'feed'}"


def enforce_document(doc: dict, fresh_ids=None, previous_health: dict | None = None, now: datetime | None = None, log=None) -> dict:
    """Repair or quarantine every post and profile in doc in place. Returns the parse summary."""
    now = now or datetime.now(timezone.utc)
    log = log or (lambda line: print(line, file=sys.stderr))
    # None counts every post as fresh (a one-off --check); a set counts only those.
    fresh_ids = None if fresh_ids is None else {str(x) for x in fresh_ids}
    kept = []
    seen = set()
    sources: dict[str, dict] = {}
    for raw in doc.get("posts") or []:
        key = source_key(raw) if isinstance(raw, dict) else "?/feed"
        is_fresh = fresh_ids is None or (isinstance(raw, dict) and str(raw.get("statusId") or raw.get("id") or "") in fresh_ids)
        row = sources.setdefault(key, {"items": 0, "clean": 0, "repaired": 0, "skipped": 0, "noDate": 0, "noAuthor": 0, "reasons": Counter()})
        post, reasons = repair_post(raw, now)
        if is_fresh:
            row["items"] += 1
        if post is None:
            if is_fresh:
                row["skipped"] += 1
                row["reasons"][_reason_key(reasons[-1] if reasons else "invalid")] += 1
            log(f"[normalize] skipped a {key} item: {'; '.join(reasons)[:200]}")
            continue
        dedupe = (post.get("feedId") or "", post["id"])
        if dedupe in seen:
            continue
        seen.add(dedupe)
        if is_fresh:
            if reasons:
                row["repaired"] += 1
                for reason in reasons:
                    row["reasons"][_reason_key(reason)] += 1
            else:
                row["clean"] += 1
            if not post.get("date"):
                row["noDate"] += 1
            if not post.get("avatar") and not post.get("author"):
                row["noAuthor"] += 1
        kept.append(post)
    dropped = len(doc.get("posts") or []) - len(kept)
    doc["posts"] = kept
    profiles = []
    for raw in doc.get("feeds") or []:
        profile, reasons = repair_profile(raw)
        if profile is None:
            log(f"[normalize] skipped a profile: {'; '.join(reasons)[:200]}")
            continue
        profiles.append(profile)
    if "feeds" in doc:
        doc["feeds"] = profiles
    summary = parse_health(sources, previous_health or {}, now)
    if dropped:
        log(f"[normalize] {dropped} item(s) skipped or merged")
    for key, row in summary.items():
        if row.get("drift"):
            log(f"[normalize] drift: {key} parsed {row['rate']:.0%} of {row['items']} items")
    return summary


def _reason_key(reason: str) -> str:
    return re.sub(r"\d+", "#", reason.split("(")[0].strip())[:80]


def parse_health(sources: dict, previous: dict, now: datetime) -> dict:
    out = {}
    stamp = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for key in sorted(set(sources) | set(previous)):
        row = sources.get(key)
        before = previous.get(key) if isinstance(previous.get(key), dict) else {}
        if not row or not row["items"]:
            if before:
                out[key] = dict(before)
            continue
        usable = row["clean"] + row["repaired"]
        rate = usable / row["items"]
        history = [float(x) for x in (before.get("history") or []) if isinstance(x, (int, float))][-(HISTORY - 1):]
        baseline = max(history) if history else None
        low = row["items"] >= DRIFT_MIN_ITEMS and (rate < DRIFT_RATE or (baseline is not None and baseline - rate >= DRIFT_DROP))
        streak = (int(before.get("lowStreak") or 0) + 1) if low else 0
        out[key] = {
            "checked": stamp,
            "items": row["items"],
            "clean": row["clean"],
            "repaired": row["repaired"],
            "skipped": row["skipped"],
            "noDate": row["noDate"],
            "rate": round(rate, 3),
            "history": history + [round(rate, 3)],
            "lowStreak": streak,
            "drift": streak >= 2,
            "top": [f"{reason} ({count})" for reason, count in row["reasons"].most_common(3)],
        }
    return out


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        import normalize_test

        return normalize_test.main()
    if "--check" in argv:
        path = Path(argv[argv.index("--check") + 1])
        doc = json.loads(path.read_text(encoding="utf-8"))
        lines = []
        summary = enforce_document(doc, log=lines.append)
        for line in lines:
            print(line)
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
