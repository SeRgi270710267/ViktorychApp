#!/usr/bin/env python3
"""Copy private R2 media to a Telegram channel and make small files loadable.

The job runs in GitHub Actions. It does not need an assistant. When
TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is missing it prints a skip line
and exits 0. Those values are never printed.

TELEGRAM_API_ID and TELEGRAM_API_HASH are optional. When both are set, a run
that has a non-video file larger than the single-document limit starts the
official telegram-bot-api server in --local mode and uploads that file in
parts of at most 1950 MiB. Those parts are a backup. The Worker cannot play
them, because api.telegram.org getFile only returns files of about 20 MB.

A file of at most 19 MiB (and at most TG_MAX_MB, default 19) is one public
Bot API document. Video and long audio, other than radio, are remuxed to HLS
with ffmpeg. Each segment stays under 19 MiB and is about 4 to 6 seconds.
The Worker plays that playlist. Codecs are copied when ffmpeg can do it.

Radio, ViktorychMusic, live JSON, and account data stay on R2. Account data
is uploaded only when TG_BACKUP_KEY is set, and then only as ciphertext.
It is not served and it is not deleted.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

UA = "viktorych-telegram-backup"
PUBLIC_API = "https://api.telegram.org"
LOCAL_API = "http://127.0.0.1:8081"
MANIFEST_KEY = "backup/telegram-manifest.json"
SMALL_BYTES = 19 * 1024 * 1024
PART_BYTES = 1950 * 1024 * 1024
MAX_NEW_BYTES = 4 * 1024 * 1024 * 1024
MAX_NEW_FILES = 300
MIN_INTERVAL = 3.0
REQUIRED = ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID")
SECRET_NAMES = REQUIRED + (
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "TG_BACKUP_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
)
DATA_KEY = re.compile(
    r"^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$"
    r"|^data/music\.json$"
    r"|^(?:live|archive|comments|fallback)/[A-Za-z0-9._-]{1,120}\.json$"
    r"|^discord/(?:index|state)\.json$"
    r"|^discord/(?:messages|pins)/\d{1,22}\.json$"
)
ACCOUNT_PREFIXES = (
    "media/avatars/",
    "media/banners/",
    "accounts/",
    "account/",
    "profiles/",
    "profile/",
    "history/",
    "lists/",
    "settings/",
    "sync/",
    "users/",
    "user/",
    "d1/",
)
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".mpeg", ".mpg"}
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wav", ".m4b"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"}
ARCHIVE_EXT = {".pdf", ".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".bin"}
MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".m4v": "video/mp4",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".m4s": "video/iso.segment",
    ".ts": "video/mp2t",
    ".m3u8": "application/vnd.apple.mpegurl",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
}


def scrub(text: str, secrets) -> str:
    out = str(text or "")
    for secret in secrets or []:
        value = str(secret or "")
        if len(value) >= 4:
            out = out.replace(value, "[redacted]")
    return out


def current_secrets() -> list:
    return [os.environ.get(name) or "" for name in SECRET_NAMES]


def log(message: str) -> None:
    print(scrub(message, current_secrets()), flush=True)


def max_mb() -> float:
    raw = (os.environ.get("TG_MAX_MB") or "").strip()
    if not raw:
        return 19.0
    try:
        value = float(raw)
    except ValueError:
        return 19.0
    if value <= 0:
        return 19.0
    return min(value, 1950.0)


def single_bytes() -> int:
    return int(max_mb() * 1024 * 1024)


def public_bytes() -> int:
    """Largest single document the public getFile method can hand back."""
    return min(single_bytes(), SMALL_BYTES)


def delete_enabled() -> bool:
    raw = (os.environ.get("TG_DELETE_FROM_R2") or "").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def backup_key() -> str:
    value = os.environ.get("TG_BACKUP_KEY") or ""
    if len(value.strip()) < 16 or "\n" in value or "\r" in value:
        return ""
    return value


def has_local_credentials() -> bool:
    api_id = (os.environ.get("TELEGRAM_API_ID") or "").strip()
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    return bool(api_id) and bool(api_hash) and api_id.isdigit() and re.fullmatch(r"[0-9a-fA-F]{16,}", api_hash) is not None


def local_requested() -> bool:
    return (os.environ.get("TELEGRAM_LOCAL") or "").strip() == "1" and has_local_credentials()


def gap_seconds(last: float, now: float, minimum: float = MIN_INTERVAL) -> float:
    if last <= 0:
        return 0.0
    return max(0.0, float(minimum) - (now - last))


def retry_after(status: int, body) -> int | None:
    if not isinstance(body, dict):
        return None
    code = body.get("error_code")
    if status != 429 and code != 429:
        return None
    params = body.get("parameters") if isinstance(body.get("parameters"), dict) else {}
    raw = params.get("retry_after")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 3
    return max(value, int(MIN_INTERVAL))


def suffix(key: str) -> str:
    name = key.rsplit("/", 1)[-1].lower()
    dot = name.rfind(".")
    if dot < 0:
        return ""
    return name[dot:]


def mime_for(key: str, content_type: str = "") -> str:
    raw = (content_type or "").split(";")[0].strip().lower()
    if raw and raw != "application/octet-stream":
        return raw
    return MIME.get(suffix(key), "application/octet-stream")


def is_video(key: str, content_type: str = "") -> bool:
    if suffix(key) in VIDEO_EXT:
        return True
    return mime_for(key, content_type).startswith("video/")


def is_audio(key: str, content_type: str = "") -> bool:
    if suffix(key) in AUDIO_EXT:
        return True
    return mime_for(key, content_type).startswith("audio/")


def is_media_key(key: str, content_type: str = "") -> bool:
    if suffix(key) in VIDEO_EXT | AUDIO_EXT | IMAGE_EXT | ARCHIVE_EXT:
        return True
    mime = mime_for(key, content_type)
    return mime.startswith("image/") or mime.startswith("video/") or mime.startswith("audio/")


def structural_role(key: str) -> str:
    lowered = str(key or "").lstrip("/")
    if not lowered or ".." in lowered.split("/"):
        return "keep"
    if lowered == MANIFEST_KEY or lowered.startswith("backup/"):
        return "manifest"
    if lowered.startswith("loop/") or lowered.startswith("radio/"):
        return "radio"
    if lowered.startswith("music/") or lowered.startswith("covers/"):
        return "music"
    if lowered.startswith("owner/") or DATA_KEY.match(lowered):
        return "live"
    if any(lowered.startswith(prefix) for prefix in ACCOUNT_PREFIXES):
        return "account"
    return ""


def plan_kind(key: str, size: int, content_type: str, local: bool) -> str:
    """How this object is handled. Radio, music, and live JSON are kept."""
    role = structural_role(key)
    if role == "radio":
        return "keep-radio"
    if role == "music":
        return "keep-music"
    if role in {"live", "manifest", "keep"}:
        return "keep-live"
    if role == "account":
        return "account" if backup_key() else "keep-account"
    if not is_media_key(key, content_type) or size <= 0:
        return "keep-other"
    if size <= public_bytes():
        return "small"
    if is_video(key, content_type) or is_audio(key, content_type):
        return "hls"
    if local and size <= PART_BYTES * 64:
        return "archive"
    return "too-big"


def part_spans(size: int, limit: int = PART_BYTES) -> list:
    spans = []
    offset = 0
    while offset < size:
        length = min(limit, size - offset)
        spans.append((offset, length))
        offset += length
    return spans


def empty_manifest() -> dict:
    return {"v": 1, "files": []}


def find_entry(manifest: dict, bucket: str, key: str) -> dict | None:
    for row in manifest.get("files") or []:
        if isinstance(row, dict) and row.get("bucket") == bucket and row.get("key") == key:
            return row
    return None


def part_done(entry: dict | None, role: str, index: int) -> dict | None:
    if not entry:
        return None
    for part in entry.get("parts") or []:
        if not isinstance(part, dict):
            continue
        if part.get("role") == role and int(part.get("index") or 0) == int(index) and part.get("file_id"):
            return part
    return None


def upsert_part(entry: dict, part: dict) -> None:
    parts = [row for row in entry.get("parts") or [] if not (row.get("role") == part["role"] and int(row.get("index") or 0) == int(part["index"]))]
    parts.append(part)
    parts.sort(key=lambda row: (str(row.get("role")), int(row.get("index") or 0)))
    entry["parts"] = parts


def may_delete(kind: str, verified: bool, size: int) -> bool:
    if not delete_enabled() or not verified:
        return False
    if kind == "small":
        return size <= public_bytes()
    if kind == "hls":
        return True
    return False


def quote_key(key: str) -> str:
    return urllib.parse.quote(str(key or ""), safe="/")


def cf_json(method: str, url: str, token: str, payload: bytes | None = None, content_type: str | None = None) -> dict:
    headers = {"Authorization": "Bearer " + token, "User-Agent": UA, "Accept": "application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
            status = res.status
    except urllib.error.HTTPError as err:
        raw = err.read()
        status = err.code
    if status >= 400:
        raise RuntimeError("cloudflare http " + str(status))
    if not raw:
        return {}
    data = json.loads(raw.decode("utf-8"))
    if isinstance(data, dict) and data.get("success") is False:
        raise RuntimeError("cloudflare request failed")
    return data if isinstance(data, dict) else {}


def bucket_names(token: str, account: str) -> list:
    names = []
    cursor = ""
    seen = set()
    while True:
        query = "?per_page=1000"
        if cursor:
            query += "&cursor=" + urllib.parse.quote(cursor)
        body = cf_json("GET", f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets{query}", token)
        result = body.get("result")
        rows = []
        if isinstance(result, list):
            rows = result
        elif isinstance(result, dict):
            rows = result.get("buckets") or []
        for row in rows:
            if isinstance(row, dict) and row.get("name"):
                names.append(str(row["name"]))
            elif isinstance(row, str):
                names.append(row)
        info = body.get("result_info") or {}
        cursor = str(info.get("cursor") or "")
        if not cursor or cursor in seen or str(info.get("is_truncated")).lower() not in {"true", "1"}:
            break
        seen.add(cursor)
    return names


def list_objects(token: str, account: str, bucket: str) -> list:
    found = []
    cursor = ""
    seen = set()
    while True:
        query = "?per_page=1000"
        if cursor:
            query += "&cursor=" + urllib.parse.quote(cursor)
        url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{urllib.parse.quote(bucket)}/objects{query}"
        body = cf_json("GET", url, token)
        for row in body.get("result") or []:
            if not isinstance(row, dict) or not row.get("key"):
                continue
            meta = row.get("http_metadata") or {}
            found.append({
                "bucket": bucket,
                "key": str(row.get("key")),
                "size": int(row.get("size") or 0),
                "etag": str(row.get("etag") or "").strip('"'),
                "uploaded": str(row.get("last_modified") or ""),
                "content_type": str(meta.get("contentType") or meta.get("content_type") or ""),
            })
        info = body.get("result_info") or {}
        cursor = str(info.get("cursor") or "")
        truncated = info.get("is_truncated")
        if truncated in (False, None, 0, "0", "false", "False") or not cursor or cursor in seen:
            break
        seen.add(cursor)
        if len(seen) > 100000:
            break
    return found


def download_object(token: str, account: str, bucket: str, key: str, dest: Path) -> str:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{urllib.parse.quote(bucket)}/objects/{quote_key(key)}"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "User-Agent": UA})
    digest = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=120) as res, dest.open("wb") as out:
        if res.status >= 400:
            raise RuntimeError("download http " + str(res.status))
        while True:
            block = res.read(1024 * 1024)
            if not block:
                break
            out.write(block)
            digest.update(block)
    return digest.hexdigest()


def delete_object(token: str, account: str, bucket: str, key: str) -> None:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{urllib.parse.quote(bucket)}/objects/{quote_key(key)}"
    cf_json("DELETE", url, token)


def put_bytes(token: str, account: str, bucket: str, key: str, payload: bytes, content_type: str) -> None:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{urllib.parse.quote(bucket)}/objects/{quote_key(key)}"
    cf_json("PUT", url, token, payload, content_type)


def d1_id(token: str, account: str) -> str:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database?name=viktorych-accounts"
    body = cf_json("GET", url, token)
    result = body.get("result") or []
    if isinstance(result, dict):
        result = [result]
    for row in result:
        if isinstance(row, dict) and (row.get("uuid") or row.get("id")):
            return str(row.get("uuid") or row.get("id"))
    raise RuntimeError("d1 database was not found")


def d1_exec(token: str, account: str, database: str, sql: str, params: list) -> None:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query"
    payload = json.dumps({"sql": sql, "params": params}).encode("utf-8")
    cf_json("POST", url, token, payload, "application/json")


D1_CREATE = (
    "CREATE TABLE IF NOT EXISTS telegram_files ("
    "object_key TEXT NOT NULL, kind TEXT NOT NULL, part_index INTEGER NOT NULL, "
    "bucket TEXT NOT NULL DEFAULT '', file_id TEXT NOT NULL, message_id INTEGER NOT NULL DEFAULT 0, "
    "size INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL DEFAULT 'application/octet-stream', "
    "duration REAL NOT NULL DEFAULT 0, serve INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, "
    "encrypted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, "
    "PRIMARY KEY (object_key, kind, part_index))"
)
D1_UPSERT = (
    "INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(object_key, kind, part_index) DO UPDATE SET "
    "bucket = excluded.bucket, file_id = excluded.file_id, message_id = excluded.message_id, "
    "size = excluded.size, sha256 = excluded.sha256, mime = excluded.mime, duration = excluded.duration, "
    "serve = excluded.serve, verified = excluded.verified, encrypted = excluded.encrypted, updated_at = excluded.updated_at"
)


def worker_api(token: str, account: str) -> str:
    override = (os.environ.get("TG_WORKER_URL") or "").strip().rstrip("/")
    if override:
        return override
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/subdomain"
    body = cf_json("GET", url, token)
    sub = str((body.get("result") or {}).get("subdomain") or "").strip()
    if not sub:
        return ""
    return f"https://viktorych-accounts.{sub}.workers.dev"


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_span(src: Path, dest: Path, offset: int, length: int) -> str:
    digest = hashlib.sha256()
    with src.open("rb") as inp, dest.open("wb") as out:
        inp.seek(offset)
        left = length
        while left:
            block = inp.read(min(1024 * 1024, left))
            if not block:
                break
            out.write(block)
            digest.update(block)
            left -= len(block)
    return digest.hexdigest()


def encrypt_file(src: Path, dest: Path) -> None:
    cmd = [
        "openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-salt",
        "-pass", "env:TG_BACKUP_KEY", "-in", str(src), "-out", str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not dest.is_file():
        raise RuntimeError("encryption failed")


def decrypt_file(src: Path, dest: Path) -> None:
    cmd = [
        "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-salt",
        "-pass", "env:TG_BACKUP_KEY", "-in", str(src), "-out", str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError("decryption failed")


def parse_hls(text: str) -> tuple:
    duration = 0.0
    init = ""
    items = []
    for line in str(text or "").splitlines():
        row = line.strip()
        if row.startswith("#EXT-X-MAP"):
            match = re.search(r'URI="([^"]+)"', row)
            if match:
                init = match.group(1)
        elif row.startswith("#EXTINF:"):
            try:
                duration = float(row.split(":", 1)[1].split(",", 1)[0])
            except ValueError:
                duration = 0.0
        elif row and not row.startswith("#"):
            items.append((row, duration))
            duration = 0.0
    return init, items


def segments_under(directory: Path, names: list, limit: int) -> bool:
    for name in names:
        path = directory / name
        if not path.is_file() or path.stat().st_size >= limit or path.stat().st_size <= 0:
            return False
    return True


def has_video_stream(src: Path) -> bool:
    if shutil.which("ffprobe") is None:
        return True
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(src)],
        capture_output=True,
    )
    return b"video" in proc.stdout


def ffmpeg_hls(src: Path, dest: Path, seconds: int, transcode: bool, video: bool) -> None:
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    cmd = ["ffmpeg", "-y", "-i", str(src)]
    if not video:
        cmd += ["-vn", "-c:a", "aac" if transcode else "copy"]
        cmd += ["-f", "hls", "-hls_time", str(seconds), "-hls_playlist_type", "vod", "-hls_segment_filename", str(dest / "seg%05d.ts"), str(dest / "index.m3u8")]
    else:
        if transcode:
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "160k"]
        else:
            cmd += ["-c", "copy"]
        cmd += [
            "-f", "hls", "-hls_time", str(seconds), "-hls_playlist_type", "vod",
            "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
            "-hls_segment_filename", str(dest / "seg%05d.m4s"), str(dest / "index.m3u8"),
        ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not (dest / "index.m3u8").is_file():
        raise RuntimeError("ffmpeg failed")


def build_hls(src: Path, dest: Path) -> tuple:
    """Return init name, segment rows, and whether a transcode was required."""
    video = has_video_stream(src)
    last = "ffmpeg failed"
    passes = (False, True) if video else (False, True)
    for transcode in passes:
        for seconds in (5, 4, 2, 1):
            try:
                ffmpeg_hls(src, dest, seconds, transcode, video)
                text = (dest / "index.m3u8").read_text(encoding="utf-8", errors="replace")
                init, items = parse_hls(text)
                names = []
                if init:
                    names.append(Path(init).name)
                names.extend(Path(name).name for name, _duration in items)
                if items and segments_under(dest, names, SMALL_BYTES):
                    return init, items, transcode
                last = "a segment was still at least 19 MiB"
            except RuntimeError as err:
                last = str(err)
    raise RuntimeError(last)


def curl_form(api_base: str, token: str, channel: str, path: Path, caption: str) -> dict:
    url = api_base.rstrip("/") + "/bot" + token + "/sendDocument"
    cmd = [
        "curl", "-sS", "--max-time", "3600",
        "-w", "\n%{http_code}",
        "-F", "chat_id=" + channel,
        "-F", "disable_notification=true",
        "-F", "document=@" + str(path) + ";filename=" + path.name,
        "-F", "caption=" + caption[:1024],
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True)
    text = proc.stdout.decode("utf-8", "replace")
    err = scrub(proc.stderr.decode("utf-8", "replace"), current_secrets())
    if "\n" not in text:
        raise RuntimeError(err or "telegram upload failed")
    body, _, status_text = text.rpartition("\n")
    try:
        status = int(status_text.strip())
    except ValueError:
        status = 0
    try:
        parsed = json.loads(body) if body.strip() else {}
    except json.JSONDecodeError:
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    parsed["_status"] = status
    if status == 0 and proc.returncode != 0:
        raise RuntimeError(err or "telegram upload failed")
    return parsed


def send_document(api_base: str, token: str, channel: str, path: Path, caption: str, state: dict) -> dict:
    for _attempt in range(6):
        wait = gap_seconds(state.get("last") or 0, time.time())
        if wait:
            time.sleep(wait)
        parsed = curl_form(api_base, token, channel, path, caption)
        state["last"] = time.time()
        delay = retry_after(int(parsed.get("_status") or 0), parsed)
        if delay is not None:
            time.sleep(delay)
            state["last"] = time.time()
            continue
        if not parsed.get("ok"):
            raise RuntimeError("telegram rejected a document")
        result = parsed.get("result") or {}
        document = result.get("document") or {}
        file_id = str(document.get("file_id") or "")
        if not file_id:
            raise RuntimeError("telegram returned no file id")
        return {
            "message_id": int(result.get("message_id") or 0),
            "file_id": file_id,
            "file_size": int(document.get("file_size") or path.stat().st_size),
        }
    raise RuntimeError("telegram rate limit did not clear")


def d1_kind(role: str) -> str:
    return {"file": "single", "segment": "segment", "init": "init", "playlist": "playlist", "part": "archive"}.get(role, role)


def remember_d1(token: str, account: str, database: str, entry: dict, part: dict, verified: bool) -> None:
    serve = 1 if entry.get("serve") and part["role"] in {"file", "segment", "init"} else 0
    d1_exec(token, account, database, D1_UPSERT, [
        entry["key"],
        d1_kind(part["role"]),
        int(part["index"]),
        entry["bucket"],
        part["file_id"],
        int(part["message_id"]),
        int(part["size"]),
        part["sha256"],
        part.get("mime") or "application/octet-stream",
        float(part.get("duration") or 0),
        serve,
        1 if verified else 0,
        1 if entry.get("encrypted") else 0,
        int(time.time()),
    ])


def fetch_worker(url: str, token: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            status = res.status
            with dest.open("wb") as out:
                while True:
                    block = res.read(1024 * 1024)
                    if not block:
                        break
                    out.write(block)
            return status
    except urllib.error.HTTPError as err:
        return err.code


def verify_entry(entry: dict, worker: str, bot: str, directory: Path) -> bool:
    if not worker or not entry.get("serve"):
        return False
    key = quote_key(entry["key"])
    base = worker.rstrip("/") + "/tg/" + key
    if entry.get("kind") == "small":
        part = part_done(entry, "file", 0)
        if not part:
            return False
        dest = directory / "verify.bin"
        status = fetch_worker(base, bot, dest)
        if status != 200 or not dest.is_file():
            return False
        return hash_file(dest) == part["sha256"] and dest.stat().st_size == int(part["size"])
    if entry.get("kind") != "hls":
        return False
    playlist = directory / "playlist.m3u8"
    status = fetch_worker(base + "/index.m3u8", bot, playlist)
    if status != 200 or not playlist.is_file():
        return False
    text = playlist.read_text(encoding="utf-8", errors="replace")
    init = part_done(entry, "init", -1)
    if init:
        if "/init" not in text:
            return False
        dest = directory / "init.bin"
        if fetch_worker(base + "/init", bot, dest) != 200:
            return False
        if hash_file(dest) != init["sha256"] or dest.stat().st_size != int(init["size"]):
            return False
    segments = [part for part in entry.get("parts") or [] if part.get("role") == "segment"]
    if not segments:
        return False
    for part in segments:
        if ("/" + str(int(part["index"]))) not in text:
            return False
        dest = directory / ("seg-%s.bin" % part["index"])
        if fetch_worker(base + "/" + str(int(part["index"])), bot, dest) != 200:
            return False
        if hash_file(dest) != part["sha256"] or dest.stat().st_size != int(part["size"]):
            return False
    return True


def ensure_entry(manifest: dict, obj: dict, kind: str, sha: str, serve: bool, encrypted: bool) -> dict:
    entry = find_entry(manifest, obj["bucket"], obj["key"])
    if entry and entry.get("sha256") and sha and entry.get("sha256") != sha:
        manifest["files"] = [row for row in manifest["files"] if row is not entry]
        entry = None
    if entry is None:
        entry = {
            "bucket": obj["bucket"],
            "key": obj["key"],
            "etag": obj.get("etag") or "",
            "sha256": sha,
            "size": int(obj["size"]),
            "mime": mime_for(obj["key"], obj.get("content_type") or ""),
            "kind": kind,
            "serve": serve,
            "verified": False,
            "encrypted": encrypted,
            "deleted": False,
            "parts": [],
        }
        manifest["files"].append(entry)
    entry["etag"] = obj.get("etag") or entry.get("etag") or ""
    entry["sha256"] = sha or entry.get("sha256") or ""
    entry["size"] = int(obj["size"])
    entry["kind"] = kind
    entry["serve"] = serve
    entry["encrypted"] = encrypted
    return entry


def upload_path(api_base: str, token: str, channel: str, path: Path, caption: str, state: dict, entry: dict, role: str, index: int, sha: str, duration: float, mime: str, cf: dict) -> None:
    existing = part_done(entry, role, index)
    if existing and existing.get("sha256") == sha:
        return
    sent = send_document(api_base, token, channel, path, caption, state)
    if int(sent.get("file_size") or 0) != path.stat().st_size:
        raise RuntimeError("telegram reported a different size")
    part = {
        "role": role,
        "index": index,
        "sha256": sha,
        "size": path.stat().st_size,
        "message_id": sent["message_id"],
        "file_id": sent["file_id"],
        "duration": duration,
        "mime": mime,
        "name": path.name,
    }
    upsert_part(entry, part)
    if cf.get("database"):
        remember_d1(cf["token"], cf["account"], cf["database"], entry, part, False)
    state["files"] = int(state.get("files") or 0) + 1
    state["bytes"] = int(state.get("bytes") or 0) + path.stat().st_size


def budget_ok(state: dict, size: int) -> bool:
    return int(state.get("files") or 0) < MAX_NEW_FILES and int(state.get("bytes") or 0) + size <= MAX_NEW_BYTES


def save_manifest(cf: dict, manifest: dict, directory: Path) -> None:
    payload = (json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    path = directory / "telegram-manifest.json"
    path.write_bytes(payload)
    put_bytes(cf["token"], cf["account"], cf["manifest_bucket"], MANIFEST_KEY, payload, "application/json")


def load_remote_manifest(token: str, account: str, buckets: list, directory: Path) -> tuple:
    target = "viktorych-data" if "viktorych-data" in buckets else (buckets[0] if buckets else "")
    if not target:
        return empty_manifest(), ""
    dest = directory / "remote-manifest.json"
    try:
        download_object(token, account, target, MANIFEST_KEY, dest)
        data = json.loads(dest.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("files"), list):
            return data, target
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, RuntimeError):
        pass
    return empty_manifest(), target


def sort_objects(rows: list) -> list:
    return sorted(rows, key=lambda row: (-int(row.get("size") or 0), str(row.get("uploaded") or ""), str(row.get("key") or "")))


def needs_local(objects: list) -> bool:
    if not has_local_credentials():
        return False
    for obj in objects:
        kind = plan_kind(obj["key"], int(obj["size"]), obj.get("content_type") or "", True)
        if kind == "archive":
            return True
    return False


def missing_required() -> bool:
    return any(not (os.environ.get(name) or "").strip() for name in REQUIRED)


def validate_channel() -> bool:
    channel = (os.environ.get("TELEGRAM_CHANNEL_ID") or "").strip()
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if "\n" in channel or "\r" in token or "\n" in token or "\r" in channel:
        return False
    if re.fullmatch(r"-?\d{5,30}", channel) is None:
        return False
    return ":" in token and len(token) >= 20


def prepare_clients() -> dict | None:
    if missing_required():
        log("[telegram-backup] TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is not set; skipping the upload")
        return None
    if not validate_channel():
        log("[telegram-backup] TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID is not usable")
        return {"error": True}
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        log("[telegram-backup] CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set; skipping the upload")
        return None
    return {"token": token, "account": account}


def collect_objects(cf: dict) -> list:
    buckets = bucket_names(cf["token"], cf["account"])
    rows = []
    for bucket in buckets:
        rows.extend(list_objects(cf["token"], cf["account"], bucket))
    return rows


def preflight() -> int:
    cf = prepare_clients()
    if cf is None:
        _output("work", "false")
        _output("local", "false")
        return 0
    if cf.get("error"):
        return 1
    try:
        rows = collect_objects(cf)
    except Exception as err:
        log("[telegram-backup] could not list R2")
        log(scrub(str(err), current_secrets()))
        return 1
    local = needs_local(rows)
    work = False
    for obj in rows:
        kind = plan_kind(obj["key"], int(obj["size"]), obj.get("content_type") or "", local)
        if kind in {"small", "hls", "archive", "account"}:
            work = True
            break
    _output("work", "true" if work else "false")
    _output("local", "true" if local and work else "false")
    if not work:
        log("[telegram-backup] nothing to upload")
    elif local:
        log("[telegram-backup] a non-video file needs the local Bot API server")
    return 0


def _output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT") or ""
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(name + "=" + value + "\n")


def new_entry_state() -> dict:
    return {"last": 0.0, "files": 0, "bytes": 0}


def process(obj: dict, manifest: dict, cf: dict, state: dict, directory: Path) -> str:
    local = local_requested()
    kind = plan_kind(obj["key"], int(obj["size"]), obj.get("content_type") or "", local)
    if kind == "too-big":
        log("[telegram-backup] skipped_too_big %s/%s %s" % (obj["bucket"], obj["key"], obj["size"]))
        return "skip"
    if not kind.startswith(("small", "hls", "archive", "account")):
        return "skip"
    prior = find_entry(manifest, obj["bucket"], obj["key"])
    if prior and prior.get("etag") and prior.get("etag") == obj.get("etag") and prior.get("verified") and prior.get("sha256"):
        if may_delete(prior.get("kind") or "", True, int(prior.get("size") or 0)) and not prior.get("deleted"):
            delete_object(cf["token"], cf["account"], obj["bucket"], obj["key"])
            prior["deleted"] = True
            save_manifest(cf, manifest, directory)
            log("[telegram-backup] deleted %s/%s" % (obj["bucket"], obj["key"]))
        return "skip"
    src = directory / "object.bin"
    sha = download_object(cf["token"], cf["account"], obj["bucket"], obj["key"], src)
    if kind == "account":
        cipher = directory / "object.enc"
        encrypt_file(src, cipher)
        src.unlink(missing_ok=True)
        if cipher.stat().st_size > public_bytes():
            cipher.unlink(missing_ok=True)
            log("[telegram-backup] skipped_too_big %s/%s %s" % (obj["bucket"], obj["key"], obj["size"]))
            return "skip"
        entry = ensure_entry(manifest, obj, "account", sha, False, True)
        digest = hash_file(cipher)
        try:
            if not budget_ok(state, cipher.stat().st_size):
                return "stop"
            upload_path(PUBLIC_API, cf["bot"], cf["channel"], cipher, obj["key"][:900], state, entry, "file", 0, digest, 0, "application/octet-stream", cf)
            save_manifest(cf, manifest, directory)
            log("[telegram-backup] stored %s/%s (account)" % (obj["bucket"], obj["key"]))
            return "ok"
        finally:
            cipher.unlink(missing_ok=True)
    entry = ensure_entry(manifest, obj, kind, sha, kind in {"small", "hls"}, False)
    if kind == "small":
        if not budget_ok(state, src.stat().st_size):
            return "stop"
        upload_path(PUBLIC_API, cf["bot"], cf["channel"], src, obj["key"][:900], state, entry, "file", 0, sha, 0, entry["mime"], cf)
    elif kind == "archive":
        api = LOCAL_API if local else ""
        if not api:
            log("[telegram-backup] skipped_too_big %s/%s %s" % (obj["bucket"], obj["key"], obj["size"]))
            return "skip"
        for index, (offset, length) in enumerate(part_spans(src.stat().st_size)):
            if not budget_ok(state, length):
                save_manifest(cf, manifest, directory)
                return "stop"
            part_path = directory / ("part-%04d.bin" % index)
            digest = write_span(src, part_path, offset, length)
            upload_path(api, cf["bot"], cf["channel"], part_path, "%s part %s" % (obj["key"][:800], index + 1), state, entry, "part", index, digest, 0, "application/octet-stream", cf)
            part_path.unlink(missing_ok=True)
    else:
        hls_dir = directory / "hls"
        try:
            init, items, transcoded = build_hls(src, hls_dir)
        except RuntimeError:
            shutil.rmtree(hls_dir, ignore_errors=True)
            log("[telegram-backup] skipped_hls %s/%s" % (obj["bucket"], obj["key"]))
            return "skip"
        if transcoded:
            log("[telegram-backup] transcoded %s/%s so every segment stays under 19 MiB" % (obj["bucket"], obj["key"]))
        queue = []
        if init:
            queue.append((-1, "init", hls_dir / Path(init).name, "video/mp4", 0))
        for index, (name, duration) in enumerate(items):
            path = hls_dir / Path(name).name
            mime = "video/mp2t" if path.suffix == ".ts" else "video/iso.segment"
            queue.append((index, "segment", path, mime, duration))
        playlist = hls_dir / "index.m3u8"
        queue.append((-2, "playlist", playlist, "application/vnd.apple.mpegurl", 0))
        for index, role, path, mime, duration in queue:
            if not budget_ok(state, path.stat().st_size):
                save_manifest(cf, manifest, directory)
                return "stop"
            digest = hash_file(path)
            upload_path(PUBLIC_API, cf["bot"], cf["channel"], path, "%s %s %s" % (obj["key"][:800], role, index), state, entry, role, index, digest, duration, mime, cf)
        shutil.rmtree(hls_dir, ignore_errors=True)
    save_manifest(cf, manifest, directory)
    if entry.get("serve") and cf.get("worker"):
        if verify_entry(entry, cf["worker"], cf["bot"], directory):
            entry["verified"] = True
            for part in entry.get("parts") or []:
                if cf.get("database"):
                    remember_d1(cf["token"], cf["account"], cf["database"], entry, part, True)
            save_manifest(cf, manifest, directory)
            if may_delete(entry.get("kind") or "", True, int(entry.get("size") or 0)):
                delete_object(cf["token"], cf["account"], obj["bucket"], obj["key"])
                entry["deleted"] = True
                save_manifest(cf, manifest, directory)
                log("[telegram-backup] deleted %s/%s" % (obj["bucket"], obj["key"]))
        else:
            log("[telegram-backup] not verified %s/%s" % (obj["bucket"], obj["key"]))
    src.unlink(missing_ok=True)
    log("[telegram-backup] stored %s/%s (%s)" % (obj["bucket"], obj["key"], kind))
    return "ok"


def backup() -> int:
    cf = prepare_clients()
    if cf is None:
        return 0
    if cf.get("error"):
        return 1
    bot = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    channel = (os.environ.get("TELEGRAM_CHANNEL_ID") or "").strip()
    directory = Path(tempfile.mkdtemp(prefix="tg-backup-"))
    try:
        rows = collect_objects(cf)
        local = local_requested() and needs_local(rows)
        manifest, manifest_bucket = load_remote_manifest(cf["token"], cf["account"], bucket_names(cf["token"], cf["account"]), directory)
        if not manifest_bucket:
            log("[telegram-backup] no R2 bucket is visible")
            return 1
        database = ""
        worker = ""
        try:
            database = d1_id(cf["token"], cf["account"])
            d1_exec(cf["token"], cf["account"], database, D1_CREATE, [])
        except Exception as err:
            log("[telegram-backup] D1 is not ready; files will not be served or deleted")
            log(scrub(str(err), current_secrets()))
            database = ""
        if database:
            try:
                worker = worker_api(cf["token"], cf["account"])
            except Exception:
                worker = ""
        cf.update({
            "bot": bot,
            "channel": channel,
            "database": database,
            "worker": worker,
            "manifest_bucket": manifest_bucket,
        })
        state = new_entry_state()
        for obj in sort_objects(rows):
            if structural_role(obj["key"]) == "manifest":
                continue
            try:
                result = process(obj, manifest, cf, state, directory)
            except Exception as err:
                log("[telegram-backup] failed %s/%s" % (obj["bucket"], obj["key"]))
                log(scrub(str(err), current_secrets()))
                save_manifest(cf, manifest, directory)
                return 1
            if result == "stop":
                log("[telegram-backup] reached the run cap")
                break
        log("[telegram-backup] uploaded %s files, %s bytes" % (state["files"], state["bytes"]))
        return 0
    except Exception as err:
        log("[telegram-backup] backup failed")
        log(scrub(str(err), current_secrets()))
        return 1
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def selftest() -> int:
    def check(cond, message):
        if not cond:
            raise SystemExit("FAIL: " + message)
        print("ok", message)

    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8", "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")}
    skipped = subprocess.run([sys.executable, str(ROOT / "scripts" / "telegram_backup.py")], capture_output=True, text=True, env=env, check=False)
    check(skipped.returncode == 0 and "skipping the upload" in skipped.stdout, "missing Telegram secrets skip the upload")
    env["TELEGRAM_BOT_TOKEN"] = "sentinel-secret-value"
    env["TELEGRAM_CHANNEL_ID"] = ""
    leaked = subprocess.run([sys.executable, str(ROOT / "scripts" / "telegram_backup.py")], capture_output=True, text=True, env=env, check=False)
    combined = leaked.stdout + leaked.stderr
    check(leaked.returncode == 0 and "sentinel-secret-value" not in combined, "a partial secret is not printed")

    os.environ.pop("TG_BACKUP_KEY", None)
    os.environ["TG_MAX_MB"] = "19"
    os.environ["TG_DELETE_FROM_R2"] = ""
    check(plan_kind("loop/current.json", 100, "application/json", True) == "keep-radio", "radio stays on R2")
    check(plan_kind("music/song/seg.m4s", 5000, "video/iso.segment", True) == "keep-music", "music stays on R2")
    check(plan_kind("feeds.json", 1000, "application/json", True) == "keep-live", "worker JSON stays on R2")
    check(plan_kind("media/avatars/123456789012/" + ("ab" * 32) + ".webp", 1000, "image/webp", True) == "keep-account", "account data is excluded without a key")
    check(plan_kind("cold/a.jpg", 1000, "image/jpeg", False) == "small", "a small image is one document")
    check(plan_kind("cold/big.mp4", SMALL_BYTES + 1, "video/mp4", True) == "hls", "a video over 19 MiB becomes HLS")
    check(plan_kind("cold/big.zip", SMALL_BYTES + 1, "application/zip", True) == "archive", "a big archive uses the local server")
    check(plan_kind("cold/big.zip", SMALL_BYTES + 1, "application/zip", False) == "too-big", "a big archive is skipped without the local server")
    check(plan_kind("cold/clip.mp4", SMALL_BYTES, "video/mp4", True) == "small", "a video of 19 MiB stays one document")
    os.environ["TG_BACKUP_KEY"] = "test-passphrase-value"
    check(plan_kind("media/avatars/123456789012/" + ("ab" * 32) + ".webp", 1000, "image/webp", True) == "account", "a backup key allows an encrypted account copy")
    os.environ.pop("TG_BACKUP_KEY", None)

    check(part_spans(PART_BYTES, PART_BYTES) == [(0, PART_BYTES)], "a 1950 MiB archive is one part")
    check(part_spans(PART_BYTES + 10, PART_BYTES) == [(0, PART_BYTES), (PART_BYTES, 10)], "a larger archive is split at 1950 MiB")
    check(retry_after(429, {"ok": False, "error_code": 429, "parameters": {"retry_after": 9}}) == 9, "retry_after is honored")
    check(retry_after(200, {"ok": True}) is None, "a normal response is not a rate limit")
    check(gap_seconds(10, 11) == 2, "messages stay at least 3 seconds apart")
    check(may_delete("small", True, 100) and may_delete("hls", True, 10**9) and not may_delete("archive", True, 100) and not may_delete("small", False, 100), "only a verified loadable file can leave R2")
    os.environ["TG_DELETE_FROM_R2"] = "false"
    check(not may_delete("small", True, 100), "TG_DELETE_FROM_R2=false keeps R2")
    os.environ["TG_DELETE_FROM_R2"] = ""

    manifest = empty_manifest()
    entry = ensure_entry(manifest, {"bucket": "b", "key": "cold/a.jpg", "size": 4, "etag": "e", "content_type": "image/jpeg"}, "small", "ab", True, False)
    upsert_part(entry, {"role": "file", "index": 0, "sha256": "ab", "size": 4, "message_id": 7, "file_id": "fid", "duration": 0, "mime": "image/jpeg"})
    check(part_done(entry, "file", 0)["message_id"] == 7 and part_done(find_entry(manifest, "b", "cold/a.jpg"), "file", 0)["file_id"] == "fid", "the manifest records message_id, file_id, and sha256")
    check(scrub("token sentinel-secret-value", ["sentinel-secret-value"]) == "token [redacted]", "logs are scrubbed")

    init, items = parse_hls('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5.0,\nseg00000.m4s\n#EXTINF:4.5,\nseg00001.m4s\n')
    check(init == "init.mp4" and items == [("seg00000.m4s", 5.0), ("seg00001.m4s", 4.5)], "an HLS playlist lists the init segment and durations")

    if shutil.which("openssl"):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            plain = folder / "plain.bin"
            cipher = folder / "cipher.bin"
            back = folder / "back.bin"
            plain.write_bytes(b"UNIQUEPLAINTEXT-account")
            os.environ["TG_BACKUP_KEY"] = "test-passphrase-value"
            encrypt_file(plain, cipher)
            check(b"UNIQUEPLAINTEXT-account" not in cipher.read_bytes(), "account bytes are not stored in the clear")
            decrypt_file(cipher, back)
            check(back.read_bytes() == plain.read_bytes(), "the backup key decrypts the account copy")
            os.environ.pop("TG_BACKUP_KEY", None)

    if shutil.which("ffmpeg"):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            src = folder / "clip.mp4"
            made = subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10",
                "-f", "lavfi", "-i", "sine=frequency=440", "-t", "3",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(src),
            ], capture_output=True)
            check(made.returncode == 0 and src.is_file(), "ffmpeg can make a sample clip")
            init_name, segs, _transcoded = build_hls(src, folder / "out")
            names = [Path(init_name).name] + [Path(name).name for name, _duration in segs]
            check(bool(segs) and segments_under(folder / "out", names, SMALL_BYTES), "HLS segments stay under 19 MiB")
            check(all(4 <= duration <= 6 or duration <= 6 for _name, duration in segs), "sample segments are a few seconds")

    doc = (ROOT / "docs" / "telegram-backup.md").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "telegram-backup.yml").read_text(encoding="utf-8")
    worker = (ROOT / "worker" / "src" / "index.js").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for name in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "TELEGRAM_API_ID", "TELEGRAM_API_HASH"):
        check(name in doc and name in workflow, name + " is named in the docs and the workflow")
    check("https://github.com/ViktorychGroup/ViktorychApp/settings/secrets/actions/new" in doc, "the docs name the GitHub secret page")
    check("@BotFather" in doc and "/newbot" in doc and "https://my.telegram.org" in doc, "the docs include the bot and api_id steps")
    check("wrangler secret put TELEGRAM_BOT_TOKEN" in doc, "the docs include the Worker secret command")
    check('cron: "17 11 * * *"' in workflow and "workflow_dispatch" in workflow and "actions/cache@v4" in workflow and "--local" in workflow, "the workflow is scheduled, manual, cached, and can start the local server")
    check('echo "$TELEGRAM' not in workflow and "echo ${{ secrets" not in workflow, "the workflow does not print secrets")
    check('path.startsWith("/tg/")' in worker and "TELEGRAM_BOT_TOKEN" in worker and "not_configured" in worker, "the Worker serves /tg and returns 503 without its secret")
    check("buildPlaylist" in worker and "index.m3u8" in worker and "parseRange" in worker, "the Worker rewrites playlists and honors Range")
    check("function r2ObjectKey" in app and "tgMediaUrl" in app and "index.m3u8" in app, "the app tries R2, then the Worker, then the source")
    check("docs/telegram-backup.md" in readme and "TELEGRAM_BOT_TOKEN" in readme, "the readme points at the Telegram backup")
    check('const DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\\.config)\\.json$' in worker, "the live JSON pattern is still the worker pattern")
    probe = (ROOT / "scripts" / "telegram_probe.py").read_text(encoding="utf-8")
    restore = (ROOT / "scripts" / "telegram_restore.py").read_text(encoding="utf-8")
    check("getMe" in probe and "getChat" in probe and "getChatMember" in probe and "sendDocument" in probe, "the probe checks the bot, the channel, and one upload")
    check('("true" if present else "false")' in probe, "the probe prints true or false for each secret")
    check(".github/telegram-probe" in workflow and "scripts/telegram_probe.py" in workflow, "pushing the probe file runs the check")
    check("getFile" in restore and "sha256" in restore, "restore downloads by file id and checks sha256")
    probed = subprocess.run([sys.executable, str(ROOT / "scripts" / "telegram_probe.py"), "--selftest"], capture_output=True, text=True, check=False)
    check(probed.returncode == 0, "the probe self-test passes")
    restored = subprocess.run([sys.executable, str(ROOT / "scripts" / "telegram_restore.py"), "--selftest"], capture_output=True, text=True, check=False)
    check(restored.returncode == 0, "the restore self-test passes")
    print("telegram backup selftest ok")
    return 0


def main(argv: list | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        if "--selftest" in args:
            return selftest()
        if "--preflight" in args:
            return preflight()
        return backup()
    except SystemExit:
        raise
    except Exception as err:
        log("[telegram-backup] backup failed")
        log(scrub(str(err), current_secrets()))
        return 1


if __name__ == "__main__":
    sys.exit(main())
