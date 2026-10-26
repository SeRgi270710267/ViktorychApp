#!/usr/bin/env python3
"""Fetch public TikTok posts and live status.

Owner mode writes gitignored owner/tiktok.json and does not touch feeds.json.
Audience "all" merges posts into feeds.json. One failed fetch exits 0.
No cookies, no impersonation package, no captcha bypass.
"""

from __future__ import annotations

import json
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from adapters.common import post_shell, trusted_time

TRACKED = ["gabii_g5", "pepsi"]
HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{2,24}$")
ROOT = Path(__file__).resolve().parents[1]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BLOCKED = "TikTok blocked the runner"
BACKOFF_MINUTES = (5, 15, 60, 180, 360)
FRESH_SECONDS = 4 * 60
ROOM_INFO_URL = "https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id="
ROOM_ENTER_URL = "https://webcast.tiktok.com/webcast/room/enter/?aid=1988&room_id="
API_LIVE_URL = "https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId="


def audience_of(config_text: str) -> str:
    found = re.search(r'tiktokAudience:\s*"([^"]*)"', config_text or "")
    if found and found.group(1) in ("owner", "all"):
        return found.group(1)
    return "owner"


def read_audience(root: Path | None = None) -> str:
    path = (root or ROOT) / "accounts.config.js"
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    return audience_of(text)


def publish_iso(timestamp) -> str:
    try:
        n = int(timestamp)
    except (TypeError, ValueError):
        return ""
    if n > 10_000_000_000:
        n = n // 1000
    if n <= 0:
        return ""
    dt = datetime.fromtimestamp(n, timezone.utc)
    iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    if trusted_time(iso) is None:
        return ""
    return iso


def codec_name(fmt: dict) -> str:
    return str((fmt or {}).get("vcodec") or "").lower()


def hevc_codec(fmt: dict) -> bool:
    name = codec_name(fmt)
    return any(marker in name for marker in ("h265", "hevc", "bytevc1", "hvc1", "hev1"))


def codec_label(fmt: dict) -> str:
    """Short name for the chosen original. Empty when the row has no video codec."""
    if not isinstance(fmt, dict):
        return ""
    name = codec_name(fmt)
    if hevc_codec(fmt):
        return "bytevc1" if "bytevc1" in name else "HEVC"
    if "avc" in name or "h264" in name:
        return "H.264"
    return ""


def format_rank(fmt: dict) -> tuple:
    rate = 0.0
    for key in ("tbr", "vbr", "bitrate"):
        try:
            value = float(fmt.get(key) or 0)
        except (TypeError, ValueError):
            value = 0.0
        if value > 0:
            rate = value
            break
    return (rate, int(fmt.get("height") or 0), int(fmt.get("width") or 0))


def choose_format(formats) -> dict | None:
    """Top h265 or bytevc1 bitrate. A lower h264 variant is only the fallback."""
    rows = []
    for fmt in formats or []:
        if not isinstance(fmt, dict):
            continue
        vcodec = str(fmt.get("vcodec") or "")
        url = str(fmt.get("url") or "")
        if not vcodec or vcodec == "none" or not url.startswith("https://"):
            continue
        rows.append(fmt)
    hevc = [fmt for fmt in rows if hevc_codec(fmt)]
    if hevc:
        pool = hevc
    else:
        pool = [fmt for fmt in rows if "bytevc2" not in codec_name(fmt)] or rows
    if not pool:
        return None
    return max(pool, key=format_rank)


def image_format(fmt: dict) -> bool:
    if not isinstance(fmt, dict):
        return False
    url = str(fmt.get("url") or "")
    if not url.startswith("https://"):
        return False
    ext = str(fmt.get("ext") or "").lower()
    if ext in {"jpg", "jpeg", "png", "webp", "gif"}:
        return True
    vcodec = str(fmt.get("vcodec") or "").lower()
    path = urllib.parse.urlparse(url).path.lower()
    return vcodec in {"", "none"} and path.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))


def carousel_urls(entry: dict) -> list[str]:
    """Image URLs the existing extractor already returned. No extra parser."""
    found = []
    for fmt in (entry or {}).get("formats") or []:
        if image_format(fmt):
            url = str(fmt.get("url") or "")
            if url not in found:
                found.append(url)
    images = (entry or {}).get("images") or []
    if isinstance(images, list):
        for item in images:
            url = item if isinstance(item, str) else (item.get("url") if isinstance(item, dict) else "")
            if isinstance(url, str) and url.startswith("https://") and url not in found:
                found.append(url)
    return found


def poster_of(entry: dict) -> str:
    thumbs = entry.get("thumbnails") or []
    if isinstance(thumbs, list):
        for thumb in reversed(thumbs):
            if isinstance(thumb, dict) and str(thumb.get("url") or "").startswith("https://"):
                return str(thumb["url"])
    thumb = str(entry.get("thumbnail") or "")
    return thumb if thumb.startswith("https://") else ""


def avatar_of(author) -> str:
    if not isinstance(author, dict):
        return ""
    for key in ("avatarLarger", "avatarMedium", "avatarThumb"):
        value = author.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return "https:" + value[5:] if value.startswith("http://") else value
        if isinstance(value, dict):
            urls = value.get("url_list") or value.get("urlList") or []
            if urls and str(urls[0]).startswith("http"):
                raw = str(urls[0])
                return "https:" + raw[5:] if raw.startswith("http://") else raw
    return ""


def entry_to_post(entry: dict, handle: str) -> dict | None:
    if not isinstance(entry, dict):
        return None
    video_id = str(entry.get("id") or "")
    if not video_id.isdigit():
        return None
    when = publish_iso(entry.get("timestamp"))
    if not when:
        return None
    best = choose_format(entry.get("formats") or [])
    poster = poster_of(entry)
    width = int((best or {}).get("width") or 0)
    height = int((best or {}).get("height") or 0)
    video = {"type": "video", "poster": poster, "width": width, "height": height}
    label = codec_label(best or {})
    if label:
        video["codec"] = label
    play = str((best or {}).get("url") or "")
    if play.startswith("https://"):
        video["url"] = play
    duration = entry.get("duration")
    try:
        if duration is not None and float(duration) > 0:
            video["duration"] = int(float(duration))
    except (TypeError, ValueError):
        pass
    photos = []
    for url in carousel_urls(entry):
        if url == poster or url == play:
            continue
        photos.append({"type": "photo", "url": url, "poster": url})
    if video.get("url"):
        media = [video] + photos
    elif photos:
        media = photos
    elif poster:
        media = [{"type": "photo", "url": poster, "poster": poster}]
    else:
        media = []
    name = str(entry.get("nickname") or entry.get("channel") or entry.get("uploader") or handle)
    avatar = str(entry.get("avatar") or "")
    post = post_shell(
        id="tiktok:" + video_id,
        statusId=video_id,
        platform="tiktok",
        feedId="tiktok:" + handle,
        kind="post",
        author=name,
        handle=handle,
        avatar=avatar,
        text=str(entry.get("description") or entry.get("title") or ""),
        date=when,
        url="https://www.tiktok.com/@" + handle + "/video/" + video_id,
        media=media,
        stats={
            "likes": int(entry.get("like_count") or 0),
            "replies": int(entry.get("comment_count") or 0),
            "reposts": int(entry.get("repost_count") or 0),
            "views": int(entry.get("view_count") or 0),
        },
    )
    post["ownerOnly"] = True
    post["short"] = True
    return post


def feed_row(handle: str, name: str, avatar: str) -> dict:
    return {
        "id": "tiktok:" + handle,
        "platform": "tiktok",
        "handle": handle,
        "name": name or handle,
        "avatar": avatar or "",
        "url": "https://www.tiktok.com/@" + handle + "/",
        "ownerOnly": True,
        "configured": False,
    }


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def blank_live(handle: str, previous: dict | None, detail: str, blocked: bool = False) -> dict:
    previous = previous if isinstance(previous, dict) else {}
    if blocked:
        row = {
            "handle": handle,
            "live": bool(previous.get("live")),
            "viewers": int(previous.get("viewers") or 0) if previous.get("live") else 0,
            "title": str(previous.get("title") or "") if previous.get("live") else "",
            "roomId": str(previous.get("roomId") or ""),
            "lastLiveAt": str(previous.get("lastLiveAt") or ""),
            "checkedAt": now_iso(),
            "detail": BLOCKED,
        }
        return row
    return {
        "handle": handle,
        "live": False,
        "viewers": 0,
        "title": "",
        "roomId": "",
        "lastLiveAt": str(previous.get("lastLiveAt") or ""),
        "checkedAt": now_iso(),
        "detail": detail,
    }


def node_json(cmd: str, payload: bytes) -> dict:
    try:
        proc = subprocess.run(
            ["node", str(ROOT / "scripts" / "tiktok_live_cli.mjs"), cmd],
            input=payload,
            capture_output=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if proc.returncode != 0:
        return {}
    try:
        parsed = json.loads(proc.stdout.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def http_get(url: str) -> tuple[int, bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            retry = res.headers.get("Retry-After") or ""
            return res.status, res.read(), retry
    except urllib.error.HTTPError as err:
        retry = err.headers.get("Retry-After") if err.headers else ""
        body = b""
        try:
            body = err.read() or b""
        except Exception:
            body = b""
        return err.code, body, retry or ""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, b"", ""


def backoff_seconds(step: int, retry_after: int) -> tuple[int, int]:
    index = max(0, min(int(step or 0), len(BACKOFF_MINUTES) - 1))
    base = BACKOFF_MINUTES[index] * 60
    retry = int(retry_after or 0)
    if retry < 0:
        retry = 0
    seconds = min(6 * 60 * 60, max(base, retry))
    return seconds, min(len(BACKOFF_MINUTES) - 1, index + 1)


def retry_after_seconds(raw: str) -> int:
    text = str(raw or "").strip()
    if not text:
        return 0
    try:
        return max(0, int(float(text)))
    except ValueError:
        pass
    try:
        when = datetime.strptime(text, "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
    except ValueError:
        return 0
    return max(0, int((when - datetime.now(timezone.utc)).total_seconds()))


def parse_stamp(raw: str) -> datetime | None:
    text = str(raw or "")
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def checked_recent(previous: dict | None, seconds: int = FRESH_SECONDS, now: datetime | None = None) -> bool:
    when = parse_stamp((previous or {}).get("checkedAt") or "")
    if when is None:
        return False
    moment = now or datetime.now(timezone.utc)
    return (moment - when).total_seconds() < seconds


def backoff_active(previous: dict | None, now: datetime | None = None) -> bool:
    when = parse_stamp((previous or {}).get("backoffUntil") or "")
    if when is None:
        return False
    moment = now or datetime.now(timezone.utc)
    return when > moment


def challenge_kind(status: int, body: bytes) -> str:
    if status in (403, 429, 503):
        return str(status)
    if b"captcha-verify" in body and not str(node_json("room", body).get("roomId") or ""):
        return "captcha"
    return ""


def apply_backoff(row: dict, previous: dict | None, retry_after: int, kind: str) -> dict:
    previous = previous if isinstance(previous, dict) else {}
    seconds, step = backoff_seconds(int(previous.get("backoffStep") or 0), retry_after)
    until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    row["backoffUntil"] = until.strftime("%Y-%m-%dT%H:%M:%SZ")
    row["backoffStep"] = step
    row["blockStatus"] = kind
    return row


def record_block(health: dict, handle: str, kind: str) -> None:
    recent = [row for row in (health.get("recent") or []) if isinstance(row, dict)]
    recent.append({"at": now_iso(), "handle": handle, "status": kind})
    cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
    kept = []
    for row in recent:
        when = parse_stamp(row.get("at") or "")
        if when is not None and when >= cutoff:
            kept.append(row)
    health["recent"] = kept[-80:]


def row_from_pick(handle: str, previous: dict, room: str, picked: dict) -> dict:
    previous = previous if isinstance(previous, dict) else {}
    live = bool(picked.get("live"))
    return {
        "handle": handle,
        "live": live,
        "viewers": int(picked.get("viewers") or 0) if live else 0,
        "title": str(picked.get("title") or "") if live else "",
        "roomId": room,
        "quality": str(picked.get("quality") or "") if live else "",
        "qualityNote": str(picked.get("qualityNote") or "") if live else "",
        "lastLiveAt": now_iso() if live else str(previous.get("lastLiveAt") or ""),
        "checkedAt": now_iso(),
        "detail": "",
        "backoffUntil": "",
        "backoffStep": 0,
    }


def room_shaped(info: bytes) -> bool:
    """True only for a webcast answer whose status or stream URL is present.

    A fallback lane is never trusted on an error document: an unrecognized
    shape must read as "no answer", never as "not live".
    """
    try:
        parsed = json.loads(info.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return False
    room = parsed.get("data") if isinstance(parsed, dict) else None
    if not isinstance(room, dict):
        return False
    stat = room.get("status")
    if isinstance(stat, (int, float)) and not isinstance(stat, bool):
        return True
    return isinstance(room.get("stream_url"), dict)


def fresh_room_id(handle: str) -> str:
    """Current room id from the public api-live endpoint, or "" when it
    does not answer. The verdict is never taken from this call; the id is
    always re-checked through the trusted room lane."""
    status, body, _retry = http_get(API_LIVE_URL + urllib.parse.quote(handle) + "&sourceType=54")
    if status != 200 or challenge_kind(status, body):
        return ""
    try:
        parsed = json.loads(body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return ""
    data = parsed.get("data") if isinstance(parsed, dict) else None
    room = str(data.get("roomId") or "") if isinstance(data, dict) else ""
    return room if room.isdigit() else ""


def room_info_row(handle: str, previous: dict, room: str) -> tuple[dict | None, str, str, int]:
    """The trusted winner lane, the shape the pipeline has always parsed."""
    status, info, retry = http_get(ROOM_INFO_URL + urllib.parse.quote(room))
    kind = challenge_kind(status, info)
    if kind or status == 0:
        return None, kind, retry, status
    picked = node_json("pick", info)
    return row_from_pick(handle, previous, room, picked if isinstance(picked, dict) else {}), "", retry, status


def room_enter_row(handle: str, previous: dict, room: str) -> tuple[dict | None, str, str, int]:
    """Same webcast host, second path. Only shaped answers count."""
    status, info, retry = http_get(ROOM_ENTER_URL + urllib.parse.quote(room))
    kind = challenge_kind(status, info)
    if kind or status == 0:
        return None, kind, retry, status
    if not room_shaped(info):
        return None, "", retry, status
    picked = node_json("pick", info)
    return row_from_pick(handle, previous, room, picked if isinstance(picked, dict) else {}), "", retry, status


def room_lanes(handle: str, previous: dict, room: str, page_fresh: bool = False) -> tuple[dict | None, str, str]:
    """Every public room lane once, most trusted first.

    Returns the first row a lane could answer from its own shape, plus the
    kind and Retry-After of the last blocked answer for the caller's
    backoff. page_fresh says the room id came from a source fetched in
    this same call (a scraped page or the api-live lane), which makes an
    offline answer authoritative. None means every lane stayed blocked,
    throttled, or unshaped, and the caller still decides blocked only
    after that.
    """
    previous = previous if isinstance(previous, dict) else {}
    offline = None
    kind, retry = "", ""
    if room:
        verdict, kind, retry, status = room_info_row(handle, previous, room)
        if verdict is not None and verdict.get("live"):
            return verdict, "", ""
        if verdict is None and status == 0:
            return None, "", ""
        if verdict is None and kind:
            verdict, b_kind, b_retry, _status = room_enter_row(handle, previous, room)
            if verdict is not None:
                return verdict, "", ""
            if b_kind:
                kind, retry = b_kind, b_retry
        offline = verdict
    # A cached id that answers offline may be a finished stream while a new
    # live already runs under a new id. The only anonymous source for the
    # current id is the api-live lane, so cross-check unless the page
    # itself just handed us this id.
    fresh = "" if page_fresh else fresh_room_id(handle)
    fresh = "" if fresh == str(room or "") else fresh
    if fresh:
        note, f_kind, f_retry, _status = room_info_row(handle, previous, fresh)
        if note is not None:
            return note, "", ""
        if f_kind and offline is None:
            kind, retry = f_kind, f_retry
    if offline is not None:
        return offline, kind, retry
    return None, kind, retry


def room_probe(handle: str, previous: dict) -> dict | None:
    """Room lanes with the stored room id while pages are blocked.

    The webcast room API answers long after www.tiktok.com starts
    returning 403 to datacenter addresses, so a clean answer is a real row
    the lane can act on. None means every lane stayed blocked or there
    was nothing new to check.
    """
    previous = previous if isinstance(previous, dict) else {}
    row, _kind, _retry = room_lanes(handle, previous, str(previous.get("roomId") or ""))
    return row


def refresh_one(handle: str, previous: dict | None) -> dict:
    previous = previous if isinstance(previous, dict) else {}
    if backoff_active(previous) or checked_recent(previous):
        return dict(previous)
    room = str(previous.get("roomId") or "")
    page_fresh = False
    if not checked_recent(previous, 5 * 60):
        room = ""
    if not room:
        page_fresh = True
        status, body, retry = http_get("https://www.tiktok.com/@" + handle + "/live")
        kind = challenge_kind(status, body)
        if kind:
            # Blocked pages do not have to end detection. The stored room id
            # may still answer the room API, which is rarely blocked.
            probe = room_probe(handle, previous)
            if probe is not None:
                return probe
            return apply_backoff(blank_live(handle, previous, BLOCKED, blocked=True), previous, retry_after_seconds(retry), kind)
        if status == 0:
            return blank_live(handle, previous, BLOCKED, blocked=True)
        room = str(node_json("room", body).get("roomId") or "")
        if not room:
            status, body, retry = http_get("https://www.tiktok.com/@" + handle)
            kind = challenge_kind(status, body)
            if kind:
                probe = room_probe(handle, previous)
                if probe is not None:
                    return probe
                return apply_backoff(blank_live(handle, previous, BLOCKED, blocked=True), previous, retry_after_seconds(retry), kind)
            if status == 0:
                return blank_live(handle, previous, BLOCKED, blocked=True)
            room = str(node_json("room", body).get("roomId") or "")
    if not room:
        # The pages answered but carried no room id. api-live publishes the
        # id while a live is running, so this is the last free look.
        room = fresh_room_id(handle)
        page_fresh = bool(room)
    if not room:
        return blank_live(handle, previous, "TikTok did not include a room id")
    row, kind, retry = room_lanes(handle, previous, room, page_fresh=page_fresh)
    if row is not None:
        return row
    row = blank_live(handle, previous, BLOCKED, blocked=True)
    row["roomId"] = room
    if kind:
        return apply_backoff(row, previous, retry_after_seconds(retry), kind)
    return row


def patch_extractor():
    from yt_dlp.extractor.tiktok import TikTokBaseIE

    original = TikTokBaseIE._parse_aweme_video_web

    def patched(self, aweme, webpage_url, video_id, extract_flat=False):
        info = original(self, aweme, webpage_url, video_id, True)
        kept = [fmt for fmt in (info.get("formats") or []) if image_format(fmt)]
        images = info.get("images")
        try:
            web = self._extract_web_formats(aweme) or []
        except Exception:
            web = []
        info["formats"] = kept + list(web)
        if images:
            info["images"] = images
        author = {}
        if isinstance(aweme, dict):
            raw = aweme.get("author") or aweme.get("authorInfo") or {}
            if isinstance(raw, dict):
                author = raw
        info["avatar"] = avatar_of(author)
        info["nickname"] = str(author.get("nickname") or info.get("channel") or info.get("uploader") or "")
        return info

    TikTokBaseIE._parse_aweme_video_web = patched


def fetch_playlist(handle: str, playlistend: int | None = None) -> tuple[list[dict] | None, dict | None]:
    """Public posts, plus the playlist info the sync already downloads.

    The list is None when TikTok blocks the runner. The playlist info can
    carry the numeric user id and secUid. Callers that only need posts use
    fetch_entries.
    """
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        print("[tiktok] yt-dlp is not installed")
        return None, None
    patch_extractor()

    class Quiet:
        def debug(self, msg):
            return None

        def info(self, msg):
            return None

        def warning(self, msg):
            return None

        def error(self, msg):
            return None

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": True,
        "retries": 0,
        "extractor_retries": 0,
        "fragment_retries": 0,
        "socket_timeout": 20,
        "logger": Quiet(),
    }
    # playlistend=None walks every page of the public profile playlist (full
    # backfill). Routine syncs only pull the newest posts.
    if playlistend is not None:
        opts["playlistend"] = int(playlistend)
    info: dict | None = None
    pauses = (120.0, 300.0)
    for attempt in range(len(pauses) + 1):
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info("https://www.tiktok.com/@" + handle, download=False)
        except Exception:
            info = None
        if isinstance(info, dict):
            break
        if attempt < len(pauses):
            pause = pauses[attempt] + random.uniform(0.0, 45.0)
            print("[tiktok] " + BLOCKED + ", retrying " + handle + " in " + str(int(pause)) + "s")
            time.sleep(pause)
    if not isinstance(info, dict):
        print("[tiktok] " + BLOCKED)
        return None, None
    entries = info.get("entries") or []
    return [row for row in entries if isinstance(row, dict)], info


def lane_entries(handle: str) -> list[dict] | None:
    """RSSHub mirror lane when TikTok still blocks the direct walk.

    Uses the rsshubBase the feeds already rotate through. Public pages only:
    no cookies, no token, no captcha bypass. Returns the newest posts this
    instance serves (usually a small page), enough to keep a profile alive
    until the ladder resumes the backfill.
    """
    try:
        config = json.loads((ROOT / "feeds.config.json").read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    base = str(config.get("rsshubBase") or "").strip().rstrip("/")
    if not base:
        return None
    from adapters.common import child_text, clean_text, iter_feed_items, parse_xml, rfc822_to_iso

    request = urllib.request.Request(
        base + "/tiktok/user/@" + handle,
        headers={"User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as res:
            text = res.read().decode("utf-8", "replace")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return None
    try:
        root = parse_xml(text)
    except Exception:
        return None
    entries = []
    for item in iter_feed_items(root):
        link = child_text(item, "link") or child_text(item, "guid") or ""
        found = re.search(r"/video/(\d+)", link)
        if not found:
            continue
        when = rfc822_to_iso(child_text(item, "pubDate") or child_text(item, "updated"))
        try:
            stamp = int(datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp())
        except ValueError:
            stamp = 0
        body = clean_text(
            re.sub(r"<[^>]+>", " ", child_text(item, "description") or child_text(item, "title") or "")
        )
        media = ""
        for cover in re.findall(r"https://[^\s\"'<>]+", child_text(item, "description")):
            if cover.startswith("https://") and re.search(r"\.(jpg|jpeg|webp)(\?|$)", cover.lower()):
                media = cover
                break
        entries.append({
            "id": found.group(1),
            "timestamp": stamp,
            "description": body,
            "uploader": handle,
            "thumbnail": media,
            "url": link,
        })
    return entries or None


def fetch_entries(handle: str) -> list[dict] | None:
    entries, _info = fetch_playlist(handle)
    return entries


def parse_accounts(raw: str) -> dict:
    try:
        data = json.loads(raw) if raw and raw.strip() else {}
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    added = [row for row in (data.get("added") or []) if isinstance(row, dict)]
    removed = []
    for item in data.get("removed") or []:
        if isinstance(item, str) and item.strip():
            removed.append(item.strip())
    return {"added": added, "removed": removed}


def accounts_path() -> Path:
    return ROOT / "owner" / "tiktok-accounts.json"


def cloudflare_env() -> tuple[str, str]:
    import os

    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    return token, account


def r2_get(key: str) -> bytes | None:
    token, account = cloudflare_env()
    if not token or not account:
        return None
    quoted = urllib.request.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            if getattr(res, "status", 200) != 200:
                return None
            return res.read()
    except urllib.error.HTTPError:
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def r2_put(key: str, payload: bytes) -> bool:
    token, account = cloudflare_env()
    if not token or not account:
        return False
    quoted = urllib.request.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    req = urllib.request.Request(url, data=payload, method="PUT", headers={
        "Authorization": "Bearer " + token,
        "content-type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def load_added_accounts(path: Path | None = None) -> dict:
    """Owner list from R2 when the Actions token is set, else a local file."""
    path = path or accounts_path()
    blob = r2_get("owner/tiktok-accounts.json")
    if blob is not None:
        return parse_accounts(blob.decode("utf-8", "replace"))
    if path.is_file():
        return parse_accounts(path.read_text(encoding="utf-8"))
    return {"added": [], "removed": []}


def save_added_accounts(doc: dict, path: Path | None = None) -> None:
    path = path or accounts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps({
        "added": doc.get("added") or [],
        "removed": doc.get("removed") or [],
    }, ensure_ascii=False) + "\n").encode("utf-8")
    path.write_bytes(payload)
    r2_put("owner/tiktok-accounts.json", payload)


def removed_handles(doc: dict | None) -> set[str]:
    from account_identity import norm_handle

    found = set()
    for item in (doc or {}).get("removed") or []:
        name = norm_handle(item)
        if name:
            found.add(name.casefold())
    return found


def sync_handles(config: dict | None, accounts: dict | None = None) -> list[str]:
    """Private added handles, then config rows, then the fallback list.

    A handle in the removed list stays out, including a fallback handle.
    """
    from account_identity import norm_handle

    config = config if isinstance(config, dict) else {}
    accounts = accounts if isinstance(accounts, dict) else {}
    handles = []
    seen = set()
    blocked = removed_handles(accounts)

    def add(name: str) -> None:
        name = norm_handle(name)
        if not HANDLE_RE.fullmatch(name) or name.casefold() in seen or name.casefold() in blocked:
            return
        seen.add(name.casefold())
        handles.append(name)

    def alias(row: dict) -> None:
        for item in row.get("previousHandles") or []:
            name = norm_handle(item)
            if name:
                seen.add(name.casefold())

    for row in accounts.get("added") or []:
        if not isinstance(row, dict):
            continue
        add(str(row.get("handle") or ""))
        alias(row)
    for row in config.get("tiktok") or []:
        if not isinstance(row, dict):
            continue
        add(str(row.get("handle") or ""))
        alias(row)
    for row in TRACKED:
        add(row)
    return handles


def _private_row(accounts: dict | None, handle: str) -> dict | None:
    from account_identity import handles_equal

    for row in (accounts or {}).get("added") or []:
        if not isinstance(row, dict):
            continue
        if handles_equal(row.get("handle"), handle) or any(handles_equal(item, handle) for item in row.get("previousHandles") or []):
            row["platform"] = "tiktok"
            return row
    return None


def note_private(accounts: dict, requested: str, info: dict) -> str:
    from account_identity import apply_observation, tiktok_identity

    row = _private_row(accounts, requested)
    if not row:
        return ""
    observed = tiktok_identity(info, requested)
    if not observed:
        return ""
    before = str(row.get("handle") or "")
    decision = apply_observation(row, observed, [])
    for line in decision.get("logs") or []:
        print(line)
    if decision.get("action") == "rename":
        return decision.get("old") or before
    return ""


def apply_fetch_identity(config: dict | None, accounts: dict | None, handle: str, info: dict | None) -> str:
    """Keep owner-added identity on the private row so it is not committed."""
    accounts = accounts if isinstance(accounts, dict) else {"added": [], "removed": []}
    if _private_row(accounts, handle):
        return note_private(accounts, handle, info or {})
    if isinstance(config, dict):
        from account_identity import note_tiktok

        return note_tiktok(config, handle, info or {})
    return ""


def apply_failed_identity(config: dict | None, accounts: dict | None, handle: str) -> str:
    row = _private_row(accounts or {}, handle)
    if row:
        from account_identity import resolve_failed

        return resolve_failed({"people": [], "tiktok": [row]}, row)
    if isinstance(config, dict):
        found = _tiktok_row(config, handle)
        if found:
            from account_identity import resolve_failed

            return resolve_failed(config, found)
    return ""


def active_handle(config: dict | None, accounts: dict | None, handle: str) -> str:
    row = _private_row(accounts or {}, handle)
    if not row and isinstance(config, dict):
        row = _tiktok_row(config, handle)
    if row and row.get("handle"):
        return str(row.get("handle"))
    return handle


def _tiktok_row(config: dict, handle: str) -> dict | None:
    from account_identity import handles_equal

    for row in config.get("tiktok") or []:
        if not isinstance(row, dict):
            continue
        if handles_equal(row.get("handle"), handle) or any(handles_equal(item, handle) for item in row.get("previousHandles") or []):
            row["platform"] = "tiktok"
            return row
    return None


RECENT_PLAYLIST = 8
POST_CAP = 4000

# A fresh handle is backed up in growing passes: each successful stage banks
# its posts through merge_handle_posts, so a blocked walk loses nothing and
# resumes from the saved stage on the next sync instead of starting over.
BACKFILL_LADDER = [150, 600, 2000, None]


def merge_handle_posts(old: list[dict], built: list[dict]) -> list[dict]:
    """Keep every post of a handle across syncs instead of dropping old ones.

    A fresh fetch replaces a stored row with the same id; rows are returned
    newest first and capped so one long backfill cannot grow forever.
    """
    by_id: dict[str, dict] = {}
    for row in old or []:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("statusId") or "")
        if ident:
            by_id.setdefault(ident, row)
    for row in built or []:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("statusId") or "")
        if not ident:
            continue
        by_id[ident] = row
    rows = list(by_id.values())
    rows.sort(key=lambda row: str(row.get("date") or ""), reverse=True)
    return rows[:POST_CAP]


def build_doc(handles: list[str], previous: dict | None, posts_ok: bool, config: dict | None = None, accounts: dict | None = None, force_full: set[str] | None = None) -> dict:
    previous = previous if isinstance(previous, dict) else {}
    prev_live = previous.get("live") if isinstance(previous.get("live"), dict) else {}
    feeds = []
    posts = []
    if posts_ok:
        force_full = force_full or set()
        prev_posts: dict[str, list[dict]] = {}
        for row in previous.get("posts") or []:
            if isinstance(row, dict) and row.get("handle"):
                prev_posts.setdefault(str(row["handle"]), []).append(row)
        backfills = previous.get("backfills") if isinstance(previous.get("backfills"), dict) else {}
        for handle in handles:
            state = backfills.get(handle) if isinstance(backfills.get(handle), dict) else {}
            never = not prev_posts.get(handle)
            forced = handle in force_full
            stage = state.get("stage")
            if not isinstance(stage, int) or not 0 <= stage < len(BACKFILL_LADDER):
                stage = 0 if (never or forced or not state.get("done")) else -1
            final_stage = stage == len(BACKFILL_LADDER) - 1
            entries, info = fetch_playlist(handle, None if final_stage else (RECENT_PLAYLIST if stage < 0 else BACKFILL_LADDER[stage]))
            lane_used = False
            if entries is None:
                lane = lane_entries(handle)
                if lane:
                    entries, lane_used = lane, True
                    print("[tiktok] mirror lane for " + handle)
            if entries is None:
                old_posts = [row for row in (previous.get("posts") or []) if row.get("handle") == handle]
                old_feeds = [row for row in (previous.get("feeds") or []) if row.get("handle") == handle]
                posts.extend(old_posts)
                feeds.extend(old_feeds)
                apply_failed_identity(config, accounts, handle)
                continue
            if isinstance(info, dict):
                apply_fetch_identity(config, accounts, handle, info)
            active = active_handle(config, accounts, handle)
            seen_rows: dict[str, dict] = {}
            for row in (prev_posts.get(handle) or []) + (prev_posts.get(active) or []):
                ident = str(row.get("statusId") or "") if isinstance(row, dict) else ""
                if ident and ident not in seen_rows:
                    seen_rows[ident] = row
            old = list(seen_rows.values())
            built = []
            avatar = ""
            name = active
            for entry in entries:
                post = entry_to_post(entry, active)
                if not post:
                    continue
                built.append(post)
                if not avatar and post.get("avatar"):
                    avatar = post["avatar"]
                if post.get("author"):
                    name = post["author"]
            if not built and not avatar:
                print("[tiktok] no public posts for " + handle)
            merged = merge_handle_posts(old, built)
            walked = stage >= 0 and entries is not None and not lane_used
            if walked:
                if final_stage:
                    backfills[active] = {"done": True, "at": now_iso(), "posts": len(merged)}
                    if len(merged) >= POST_CAP:
                        print("[tiktok] " + handle + " hit the " + str(POST_CAP) + " post cap")
                else:
                    backfills[active] = {"done": False, "stage": stage + 1, "at": now_iso(), "posts": len(merged)}
            if built or avatar:
                label = (
                    "the mirror lane" if lane_used
                    else "the newest posts" if stage < 0
                    else "backfill stage " + str(stage + 1) + "/" + str(len(BACKFILL_LADDER))
                    if not final_stage else "a full backfill"
                )
                print("[tiktok] " + handle + ": " + str(len(merged)) + " posts stored from " + label)
            feeds.append(feed_row(active, name, avatar))
            posts.extend(merged)
            if walked:
                # Pace consecutive walks; TikTok rate limits the next
                # profile right after a long crawl.
                time.sleep(45.0 + random.uniform(0.0, 30.0))
        handles = sync_handles(config, accounts)
    else:
        feeds = list(previous.get("feeds") or [])
        posts = list(previous.get("posts") or [])
        backfills = previous.get("backfills") if isinstance(previous.get("backfills"), dict) else {}
    health = previous.get("tiktokHealth") if isinstance(previous.get("tiktokHealth"), dict) else {"recent": []}
    if not isinstance(health.get("recent"), list):
        health["recent"] = []
    live = {}
    fetched = False
    for handle in handles:
        prev = prev_live.get(handle) if isinstance(prev_live.get(handle), dict) else {}
        if backoff_active(prev) or checked_recent(prev):
            live[handle] = dict(prev) if prev else blank_live(handle, {}, "")
            print("[tiktok] " + handle + " skipped")
            continue
        if fetched:
            time.sleep(random.uniform(1.5, 4.0))
        row = refresh_one(handle, prev)
        kind = str(row.pop("blockStatus", "") or "")
        if kind:
            record_block(health, handle, kind)
        fetched = True
        live[handle] = row
        flag = "live" if row.get("live") else "offline"
        print("[tiktok] " + handle + " " + flag)
    return {
        "updated": now_iso(),
        "audience": read_audience(),
        "feeds": feeds,
        "posts": posts,
        "live": live,
        "tiktokHealth": health,
        "backfills": backfills,
        "health": {"ok": True, "detail": ""},
    }


def place(doc: dict, mode: str, feeds_path: Path, owner_path: Path) -> None:
    """Owner mode never writes feeds.json. All mode merges posts into it."""
    owner_path.parent.mkdir(parents=True, exist_ok=True)
    owner_path.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
    if mode != "all":
        return
    if not feeds_path.is_file():
        return
    data = json.loads(feeds_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return
    feeds = [row for row in (data.get("feeds") or []) if not (isinstance(row, dict) and row.get("platform") == "tiktok")]
    posts = [row for row in (data.get("posts") or []) if not (isinstance(row, dict) and row.get("platform") == "tiktok")]
    feeds.extend(doc.get("feeds") or [])
    posts.extend(doc.get("posts") or [])
    # feeds.json is the public artifact: keep only the newest short posts so a
    # full backfill cannot bloat it. owner/tiktok.json keeps the whole archive.
    posts.sort(key=lambda row: str(row.get("date") or "") if isinstance(row, dict) else "", reverse=True)
    tiktok_posts = [row for row in posts if isinstance(row, dict) and row.get("platform") == "tiktok"]
    if len(tiktok_posts) > 300:
        keep_dates = {row.get("date") for row in tiktok_posts[:300]}
        posts = [row for row in posts if not (isinstance(row, dict) and row.get("platform") == "tiktok" and row.get("date") not in keep_dates)]
    data["feeds"] = feeds
    data["posts"] = posts
    feeds_path.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")


def load_owner(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def upload_owner(path: Path) -> None:
    if not path.is_file():
        return
    if r2_put("owner/tiktok.json", path.read_bytes()):
        print("[tiktok] live status updated")
    elif cloudflare_env()[0] and cloudflare_env()[1]:
        print("[tiktok] live status upload failed")


def publish_live_catalogs(feeds: Path, owner: Path) -> None:
    """Put the synced feeds where media extract reads them. Values are not printed."""
    token, account = cloudflare_env()
    if not token or not account:
        return
    ok = True
    if feeds.is_file():
        ok = r2_put("feeds.json", feeds.read_bytes()) and ok
    if owner.is_file():
        ok = r2_put("owner/tiktok.json", owner.read_bytes()) and ok
    print("[tiktok] catalogs stored" if ok else "[tiktok] catalog upload failed")


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    live_only = "--live-only" in args
    force_full: set[str] = set()
    index = 0
    while index < len(args):
        token = args[index]
        if token.startswith("--full="):
            from account_identity import norm_handle

            name = norm_handle(token.split("=", 1)[1])
            if name:
                force_full.add(name)
        elif token == "--full" and index + 1 < len(args) and not args[index + 1].startswith("--"):
            from account_identity import norm_handle

            name = norm_handle(args[index + 1])
            if name:
                force_full.add(name)
            index += 1
        index += 1
    from account_identity import begin_run, commit_file

    begin_run()
    config_path = ROOT / "feeds.config.json"
    config = {}
    if config_path.is_file():
        try:
            parsed = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            parsed = {}
        if isinstance(parsed, dict):
            config = parsed
    accounts = load_added_accounts()
    before_accounts = json.dumps(accounts, sort_keys=True, ensure_ascii=False)
    handles = sync_handles(config, accounts)
    owner_path = ROOT / "owner" / "tiktok.json"
    downloaded = r2_get("owner/tiktok.json")
    if downloaded is not None:
        owner_path.parent.mkdir(parents=True, exist_ok=True)
        owner_path.write_bytes(downloaded)
    try:
        previous = load_owner(owner_path)
        if live_only and not previous:
            print("[tiktok] owner data is not uploaded yet")
            return 0
        mode = read_audience()
        doc = build_doc(handles, previous, posts_ok=not live_only, config=config, accounts=accounts, force_full=force_full)
        doc["audience"] = mode
        if live_only:
            doc["feeds"] = previous.get("feeds") or []
            doc["posts"] = previous.get("posts") or []
            doc["audience"] = previous.get("audience") or mode
        place(doc, "owner" if live_only else mode, ROOT / "feeds.json", owner_path)
        if not live_only and config_path.is_file():
            commit_file(config_path, config)
        if json.dumps(accounts, sort_keys=True, ensure_ascii=False) != before_accounts:
            save_added_accounts(accounts)
        upload_owner(owner_path)
    except Exception:
        print("[tiktok] " + BLOCKED)
    finally:
        if not live_only:
            publish_live_catalogs(ROOT / "feeds.json", owner_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
