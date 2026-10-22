#!/usr/bin/env python3
"""Fetch public TikTok posts and live status.

Owner mode writes gitignored owner/tiktok.json and does not touch feeds.json.
Audience "all" merges posts into feeds.json. One failed fetch exits 0.
No cookies, no impersonation package, no captcha bypass.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from adapters.common import post_shell, trusted_time

TRACKED = ["gabii_g5"]
HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{2,24}$")
ROOT = Path(__file__).resolve().parents[1]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BLOCKED = "TikTok blocked the runner"


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


def http_get(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, b""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, b""


def refresh_one(handle: str, previous: dict | None) -> dict:
    status, body = http_get("https://www.tiktok.com/@" + handle + "/live")
    if status in (403, 429, 503) or status == 0:
        return blank_live(handle, previous, BLOCKED, blocked=True)
    room = str(node_json("room", body).get("roomId") or "")
    if not room:
        status, body = http_get("https://www.tiktok.com/@" + handle)
        if status in (403, 429, 503) or status == 0:
            return blank_live(handle, previous, BLOCKED, blocked=True)
        room = str(node_json("room", body).get("roomId") or "")
    if not room:
        return blank_live(handle, previous, "TikTok did not include a room id")
    status, info = http_get("https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=" + urllib.parse.quote(room))
    if status in (403, 429, 503) or status == 0:
        row = blank_live(handle, previous, BLOCKED, blocked=True)
        row["roomId"] = room
        return row
    picked = node_json("pick", info)
    live = bool(picked.get("live"))
    previous = previous if isinstance(previous, dict) else {}
    return {
        "handle": handle,
        "live": live,
        "viewers": int(picked.get("viewers") or 0) if live else 0,
        "title": str(picked.get("title") or "") if live else "",
        "roomId": room,
        "lastLiveAt": now_iso() if live else str(previous.get("lastLiveAt") or ""),
        "checkedAt": now_iso(),
        "detail": "",
    }


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


def fetch_entries(handle: str) -> list[dict] | None:
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        print("[tiktok] yt-dlp is not installed")
        return None
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
        "playlistend": 8,
        "retries": 0,
        "extractor_retries": 0,
        "fragment_retries": 0,
        "socket_timeout": 20,
        "logger": Quiet(),
    }
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info("https://www.tiktok.com/@" + handle, download=False)
    except Exception:
        print("[tiktok] " + BLOCKED)
        return None
    if not isinstance(info, dict):
        print("[tiktok] " + BLOCKED)
        return None
    entries = info.get("entries") or []
    return [row for row in entries if isinstance(row, dict)]


def build_doc(handles: list[str], previous: dict | None, posts_ok: bool) -> dict:
    previous = previous if isinstance(previous, dict) else {}
    prev_live = previous.get("live") if isinstance(previous.get("live"), dict) else {}
    feeds = []
    posts = []
    if posts_ok:
        for handle in handles:
            entries = fetch_entries(handle)
            if entries is None:
                old_posts = [row for row in (previous.get("posts") or []) if row.get("handle") == handle]
                old_feeds = [row for row in (previous.get("feeds") or []) if row.get("handle") == handle]
                posts.extend(old_posts)
                feeds.extend(old_feeds)
                continue
            built = []
            avatar = ""
            name = handle
            for entry in entries:
                post = entry_to_post(entry, handle)
                if not post:
                    continue
                built.append(post)
                if not avatar and post.get("avatar"):
                    avatar = post["avatar"]
                if post.get("author"):
                    name = post["author"]
            if not built and not avatar:
                print("[tiktok] no public posts for " + handle)
            else:
                print("[tiktok] " + str(len(built)) + " posts for " + handle)
            feeds.append(feed_row(handle, name, avatar))
            posts.extend(built)
    else:
        feeds = list(previous.get("feeds") or [])
        posts = list(previous.get("posts") or [])
    live = {}
    for handle in handles:
        live[handle] = refresh_one(handle, prev_live.get(handle) if isinstance(prev_live.get(handle), dict) else {})
        flag = "live" if live[handle].get("live") else "offline"
        print("[tiktok] " + handle + " " + flag)
    return {
        "updated": now_iso(),
        "audience": read_audience(),
        "feeds": feeds,
        "posts": posts,
        "live": live,
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
    token = (__import__("os").environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (__import__("os").environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account or not path.is_file():
        return
    quoted = urllib.request.quote("owner/tiktok.json", safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    payload = path.read_bytes()
    req = urllib.request.Request(url, data=payload, method="PUT", headers={
        "Authorization": "Bearer " + token,
        "content-type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60):
            print("[tiktok] live status updated")
    except (urllib.error.URLError, TimeoutError, OSError):
        print("[tiktok] live status upload failed")


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    live_only = "--live-only" in args
    handles = [row for row in TRACKED if HANDLE_RE.match(row)]
    owner_path = ROOT / "owner" / "tiktok.json"
    try:
        previous = load_owner(owner_path)
        if live_only and not previous:
            print("[tiktok] owner data is not uploaded yet")
            return 0
        mode = read_audience()
        doc = build_doc(handles, previous, posts_ok=not live_only)
        doc["audience"] = mode
        if live_only:
            doc["feeds"] = previous.get("feeds") or []
            doc["posts"] = previous.get("posts") or []
            doc["audience"] = previous.get("audience") or mode
        place(doc, "owner" if live_only else mode, ROOT / "feeds.json", owner_path)
        if live_only:
            upload_owner(owner_path)
    except Exception:
        print("[tiktok] " + BLOCKED)
    return 0


if __name__ == "__main__":
    sys.exit(main())
