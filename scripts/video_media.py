"""Find a real video file and drop image stand-ins.

Instagram's /media?size=l URL redirects to a JPEG. A <video> pointed at it
fails. YouTube playback is chosen in the browser from healthy instances, so
the sync does not store one itag=18 URL.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from adapters.common import is_playable_video
from meta_media import cdn_expiry, stamp_media
from x_guard import open_url

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
_MP4 = re.compile(r"https://[^\s\"'<>\\]+?\.mp4[^\s\"'<>\\]*", re.I)
_M3U8 = re.compile(r"https://[^\s\"'<>\\]+?\.m3u8[^\s\"'<>\\]*", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _unescape(html: str) -> str:
    text = html or ""
    return (
        text.replace("\\/", "/")
        .replace("\\u0026", "&")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
    )


def extract_video(html: str) -> dict:
    """Pull a video file, poster, and size out of a public page. No invented URLs."""
    text = _unescape(html)
    if "httpErrorPage" in text and ".mp4" not in text.lower():
        return {}
    url = ""
    for pattern in (
        r'"video_url"\s*:\s*"(https:[^"]+)"',
        r'<meta[^>]+property="og:video(?::url)?"[^>]+content="(https:[^"]+)"',
        r'<meta[^>]+content="(https:[^"]+)"[^>]+property="og:video(?::url)?"',
        r'<source[^>]+src="(https:[^"]+)"',
        r'<video[^>]+src="(https:[^"]+)"',
    ):
        match = re.search(pattern, text, re.I)
        if match and is_playable_video(match.group(1)):
            url = match.group(1)
            break
    if not url:
        match = _MP4.search(text) or _M3U8.search(text)
        if match and is_playable_video(match.group(0)):
            url = match.group(0).rstrip(").,;]")
    poster = ""
    for pattern in (
        r'"display_url"\s*:\s*"(https:[^"]+)"',
        r'<meta[^>]+property="og:image"[^>]+content="(https:[^"]+)"',
        r'<video[^>]+poster="(https:[^"]+)"',
    ):
        match = re.search(pattern, text, re.I)
        if match:
            poster = match.group(1)
            break
    out = {}
    if url:
        out["url"] = url
    if poster and not is_playable_video(poster):
        out["poster"] = poster
    for key, pattern in (("width", r'og:video:width"[^>]+content="(\d+)"'), ("height", r'og:video:height"[^>]+content="(\d+)"')):
        match = re.search(pattern, text, re.I)
        if match:
            out[key] = int(match.group(1))
    match = re.search(r'"video_duration"\s*:\s*"?(\d+(?:\.\d+)?)"?', text)
    if match:
        seconds = float(match.group(1))
        if 0 < seconds < 86400:
            out["duration"] = int(seconds)
    return out


def _get(url: str, timeout: int = 12) -> tuple[int, str, str]:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json,*/*"})
    try:
        with open_url(request, timeout=timeout) as response:
            status = getattr(response, "status", 200) or 200
            ctype = (response.headers.get("content-type") or "").lower()
            if ctype.startswith("image/") or ctype.startswith("video/"):
                return status, "", response.geturl()
            body = response.read(800000).decode("utf-8", "replace")
            return status, body, response.geturl()
    except Exception:
        return 0, "", ""


def probe(url: str, timeout: int = 8) -> tuple[bool, str]:
    """Range request. An image response is a failed video."""
    if not is_playable_video(url):
        return False, "not a video file"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Range": "bytes=0-2047", "Accept": "*/*"},
    )
    try:
        with open_url(request, timeout=timeout) as response:
            status = getattr(response, "status", 200) or 200
            ctype = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            chunk = response.read(16)
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except Exception as exc:
        return False, str(exc)[:80]
    if status not in (200, 206):
        return False, f"HTTP {status}"
    if ctype.startswith("image/") or ctype.startswith("text/html"):
        return False, ctype or "not video"
    if ctype.startswith("video/") or "mpegurl" in ctype or chunk[4:8] == b"ftyp" or chunk.startswith(b"#EXT"):
        return True, ctype or "video"
    if ctype.startswith("application/octet-stream") or not ctype:
        return True, ctype or "bytes"
    return False, ctype or "unknown"


def _shortcode(post: dict) -> str:
    blob = " ".join(str(post.get(key) or "") for key in ("url", "statusId", "id"))
    match = re.search(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)", blob)
    if match:
        return match.group(1)
    code = str(post.get("statusId") or "")
    if post.get("platform") == "instagram" and re.fullmatch(r"[A-Za-z0-9_-]{5,}", code) and not code.isdigit():
        return code
    return ""


def _threads_code(post: dict) -> str:
    code = str(post.get("statusId") or post.get("id") or "")
    if re.fullmatch(r"[A-Za-z0-9_-]{5,}", code):
        return code
    match = re.search(r"threads\.(?:com|net)/(?:@[^/]+/)?(?:post|t)/([A-Za-z0-9_-]+)", post.get("url") or "")
    return match.group(1) if match else ""


def _oembed_poster(shortcode: str) -> str:
    if not shortcode:
        return ""
    status, body, _final = _get(f"https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/{shortcode}/")
    if status != 200 or not body.lstrip().startswith("{"):
        return ""
    try:
        thumb = json.loads(body).get("thumbnail_url") or ""
    except json.JSONDecodeError:
        return ""
    return thumb if thumb.startswith("https://") else ""


def resolve_meta(post: dict) -> dict:
    platform = post.get("platform") or ""
    pages = []
    if platform == "instagram":
        code = _shortcode(post)
        if code:
            pages = [
                f"https://www.instagram.com/reel/{code}/embed/captioned/",
                f"https://www.instagram.com/p/{code}/embed/captioned/",
                f"https://www.instagram.com/p/{code}/embed/",
            ]
    elif platform == "threads":
        code = _threads_code(post)
        handle = post.get("handle") or ""
        if code:
            pages = [
                f"https://www.threads.net/t/{code}/embed",
                f"https://www.threads.net/@{handle}/post/{code}" if handle else "",
                f"https://www.threads.com/t/{code}",
            ]
    found = {}
    for page in pages:
        if not page:
            continue
        status, body, _final = _get(page)
        if status != 200 or not body:
            continue
        found = extract_video(body)
        if found.get("url"):
            break
    if platform == "instagram" and not found.get("poster"):
        thumb = _oembed_poster(_shortcode(post))
        if thumb:
            found["poster"] = thumb
    return found


def _fx_media(status_id: str) -> list:
    if not status_id or not str(status_id).isdigit():
        return []
    status, body, _final = _get(f"https://api.fxtwitter.com/2/status/{status_id}")
    if status != 200 or not body.lstrip().startswith("{"):
        return []
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return []
    from adapters.fxtwitter import _media

    status_obj = payload.get("status") or payload.get("tweet") or payload
    if not isinstance(status_obj, dict):
        return []
    return _media(status_obj.get("media"))


def _expired(url: str) -> bool:
    stamp = cdn_expiry(url or "")
    if not stamp:
        return False
    try:
        moment = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return moment <= datetime.now(timezone.utc)


def _apply(item: dict, found: dict) -> bool:
    url = found.get("url") or ""
    if url and is_playable_video(url):
        ok, _detail = probe(url)
        if ok:
            item["url"] = url
            if found.get("poster"):
                item["poster"] = found["poster"]
            for key in ("width", "height", "duration"):
                if found.get(key):
                    item[key] = found[key]
            stamp_media(item)
            return True
    if found.get("poster") and not item.get("poster"):
        item["poster"] = found["poster"]
        stamp_media(item)
    return False


def _one(post: dict, item: dict) -> tuple[bool, dict | None]:
    if not isinstance(item, dict) or item.get("type") not in ("video", "animated_gif"):
        return True, None
    url = item.get("url") or ""
    stand_in = bool(url) and not is_playable_video(url) and "youtube" not in url and "youtu.be" not in url
    if stand_in:
        if not item.get("poster"):
            item["poster"] = url
        item["url"] = ""
        url = ""
    stream = item.get("stream") or ""
    if "latest_version" in stream:
        item.pop("stream", None)
    platform = post.get("platform") or ""
    if platform == "youtube" or "youtube" in url:
        return True, None
    playable = is_playable_video(url) and not _expired(url)
    if playable:
        ok, detail = probe(url)
        if ok:
            stamp_media(item)
            return True, None
        reason = detail
    elif stand_in:
        reason = "image stand-in"
    elif url and _expired(url):
        reason = "expired"
    else:
        reason = "no video file"
    if platform == "telegram" and item.get("poster"):
        item["url"] = ""
        return True, None
    found = {}
    if platform in ("instagram", "threads"):
        found = resolve_meta(post)
    elif platform == "x":
        rows = _fx_media(str(post.get("statusId") or ""))
        video = next((row for row in rows if row.get("type") in ("video", "animated_gif") and is_playable_video(row.get("url") or "")), None)
        if video:
            found = video
    if _apply(item, found):
        return True, None
    label = str(post.get("statusId") or post.get("id") or "")[:80]
    return False, {"platform": platform, "id": label, "detail": reason}


def repair_videos(posts: list) -> tuple[int, list]:
    pairs = []
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        for item in post.get("media") or []:
            if isinstance(item, dict) and item.get("type") in ("video", "animated_gif"):
                pairs.append((post, item))
    ok = 0
    failed = []
    if not pairs:
        return 0, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda pair: _one(pair[0], pair[1]), pairs))
    for good, row in results:
        if good:
            ok += 1
        elif row:
            failed.append(row)
            print(f"[video] {row.get('platform')}:{row.get('id')} {row.get('detail')}")
        else:
            ok += 1
    print(f"[video] {ok} playable, {len(failed)} unresolved")
    return ok, failed


def write_video_status(ok: int, failed: list, dest=None) -> None:
    from pathlib import Path

    path = Path(dest) if dest else Path(__file__).resolve().parents[1] / "status.json"
    document = {}
    if path.exists():
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            document = {}
    if not isinstance(document, dict):
        document = {}
    document["videos"] = {
        "checkedAt": now_iso(),
        "ok": ok,
        "failed": failed[:40],
    }
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
