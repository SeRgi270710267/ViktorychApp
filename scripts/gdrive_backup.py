#!/usr/bin/env python3
"""Copy private backups to the owner's Google Drive.

The job is scheduled in GitHub Actions. It does not need an assistant.
GDRIVE_RCLONE_TOKEN is a user OAuth token for rclone with scope drive.file.
A service account is not used. When the secret is missing this prints a
notice and exits 0. The token is never printed.

Drive folder: ViktorychApp-backup/
  music/   ViktorychMusic song audio
  covers/  song covers
  radio/   radio loop audio
  tiktok/  TikTok videos that are not on ia_tiktok_allow
  media/   video files whose source is not allowed on Internet Archive

ViktorychApp account data is not uploaded. Files already stored are skipped
by SHA-256. Each run stops after a byte cap and a file cap.
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
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ia_backup  # noqa: E402

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
FOLDER = "ViktorychApp-backup"
SECRET_ENV = "GDRIVE_RCLONE_TOKEN"
REMOTE = "gdrive:" + FOLDER
MAX_NEW_BYTES = 400 * 1024 * 1024
MAX_NEW_FILES = 500
MAX_FILE_BYTES = 80 * 1024 * 1024
KINDS = ("music", "covers", "radio", "tiktok", "media")
HASH_NAME = re.compile(r"^[0-9a-f]{64}$")
ACCOUNT_PATHS = ("/media/avatars/", "/media/banners/", "/v1/", "/accounts/", "/d1/", "/owner/")
BLOCK_HOSTS = ("workers.dev", "cloudflarestorage.com", "trycloudflare.com", "discord.com", "discordapp.net", "discord.gg")
TIKTOK_HOSTS = ia_backup.SOURCE_HOSTS["tiktok"] + ("tiktok.com",)


def scrub(text: str, secrets) -> str:
    out = str(text or "")
    for secret in secrets or []:
        value = str(secret or "")
        if len(value) >= 8:
            out = out.replace(value, "[redacted]")
    return re.sub(r"(https?://[^\s\"']+)\?[^\s\"']+", r"\1", out)


def account_data_url(url: str) -> bool:
    raw = str(url or "").strip()
    parsed = urllib.parse.urlparse(raw)
    if parsed.username or parsed.password:
        return True
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return True
    if any(host == item or host.endswith("." + item) for item in BLOCK_HOSTS):
        return True
    path = (parsed.path or "").lower()
    return any(mark in path for mark in ACCOUNT_PATHS)


def _host(url: str) -> str:
    return (urllib.parse.urlparse(str(url or "")).hostname or "").lower().rstrip(".")


def _allowed(url: str, hosts) -> bool:
    if account_data_url(url):
        return False
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password:
        return False
    host = _host(url)
    if not host or host == "localhost" or host.endswith(".local"):
        return False
    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", host):
        return False
    return any(host == item or host.endswith("." + item) for item in hosts or ())


def parse_secret(raw: str) -> dict:
    """Return client_id, client_secret, and the token object. Raises ValueError."""
    data = json.loads(str(raw or "").strip())
    if not isinstance(data, dict):
        raise ValueError("shape")
    if str(data.get("scope") or "") != "drive.file":
        raise ValueError("scope")
    client_id = str(data.get("client_id") or "").strip()
    client_secret = str(data.get("client_secret") or "").strip()
    token = data.get("token")
    if isinstance(token, str):
        token = json.loads(token)
    if not client_id or not client_secret or not isinstance(token, dict):
        raise ValueError("fields")
    refresh = str(token.get("refresh_token") or "").strip()
    access = str(token.get("access_token") or "").strip()
    if not refresh or not access:
        raise ValueError("token")
    if any("\n" in value or "\r" in value for value in (client_id, client_secret, refresh, access)):
        raise ValueError("newline")
    clean = {
        "access_token": access,
        "token_type": str(token.get("token_type") or "Bearer"),
        "refresh_token": refresh,
        "expiry": str(token.get("expiry") or ""),
    }
    return {"client_id": client_id, "client_secret": client_secret, "scope": "drive.file", "token": clean}


def secret_values(parsed: dict, raw: str = "") -> list:
    token = parsed.get("token") or {}
    return [raw, parsed.get("client_id"), parsed.get("client_secret"), token.get("access_token"), token.get("refresh_token")]


def rclone_config_text(parsed: dict) -> str:
    token = json.dumps(parsed["token"], separators=(",", ":"))
    lines = [
        "[gdrive]",
        "type = drive",
        "scope = drive.file",
        "client_id = " + parsed["client_id"],
        "client_secret = " + parsed["client_secret"],
        "token = " + token,
        "",
    ]
    return "\n".join(lines)


def hls_media(text: str, base_url: str) -> tuple[str, list[str], list[str]]:
    """Return the best variant, the segment URLs, and key or init URLs."""
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    variants = []
    segments = []
    extras = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("#EXT-X-STREAM-INF"):
            match = re.search(r"BANDWIDTH=(\d+)", line)
            bandwidth = int(match.group(1)) if match else 0
            nxt = lines[index + 1] if index + 1 < len(lines) else ""
            if nxt and not nxt.startswith("#"):
                variants.append((bandwidth, urllib.parse.urljoin(base_url, nxt)))
                index += 2
                continue
        elif line.startswith("#EXT-X-MAP") or line.startswith("#EXT-X-KEY"):
            match = re.search(r'URI="([^"]+)"', line)
            if match:
                extras.append(urllib.parse.urljoin(base_url, match.group(1)))
        elif not line.startswith("#"):
            segments.append(urllib.parse.urljoin(base_url, line))
        index += 1
    if variants:
        variants.sort(key=lambda row: row[0])
        return variants[-1][1], [], []
    return "", segments, extras


def remote_path_for(kind: str, url: str) -> str:
    """Keep the published relative names so a playlist still points at its files."""
    parts = []
    for part in urllib.parse.urlparse(url).path.split("/"):
        if part in {"", ".", ".."}:
            continue
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", part):
            part = hashlib.sha256(part.encode()).hexdigest()[:20]
        parts.append(part)
    if parts and parts[0] == kind:
        parts = parts[1:]
    if not parts:
        parts = [hashlib.sha256(url.encode()).hexdigest()[:20]]
    return kind + "/" + "/".join(parts)


def _item(kind: str, logical: str, url: str, hosts, label: str, playlist: bool = False) -> dict | None:
    if kind not in KINDS or not logical or not _allowed(url, hosts):
        return None
    return {
        "kind": kind,
        "logical": logical,
        "url": url,
        "hosts": tuple(hosts),
        "label": label,
        "playlist": playlist,
    }


def _hosts_of(url: str, extra=()) -> tuple:
    host = _host(url)
    return tuple(item for item in (host, *extra) if item)


def music_plan(doc: dict) -> list:
    items = []
    for song in (doc or {}).get("songs") or []:
        if not isinstance(song, dict):
            continue
        label = str(song.get("id") or "").strip()
        if not label:
            continue
        cover = str(song.get("cover") or "").strip()
        row = _item("covers", "covers:" + label, cover, _hosts_of(cover, ("r2.dev",)), label)
        if row:
            items.append(row)
        stream = str(song.get("stream") or "").strip()
        row = _item("music", "music:" + label + ":playlist", stream, _hosts_of(stream, ("r2.dev",)), label, playlist=True)
        if row:
            items.append(row)
    return items


def radio_plan(loop_urls) -> list:
    items = []
    for url in loop_urls or []:
        raw = str(url or "").strip()
        row = _item("radio", "radio:playlist", raw, _hosts_of(raw, ("r2.dev",)), "loop", playlist=True)
        if row:
            items.append(row)
    return items


def loop_urls_from_config(doc: dict) -> list:
    found = []
    for space in (doc or {}).get("spaces") or []:
        if not isinstance(space, dict):
            continue
        source = space.get("source") if isinstance(space.get("source"), dict) else {}
        url = str(source.get("loopUrl") or "").strip()
        if url.startswith("https://") and url not in found:
            found.append(url)
    return found


def tiktok_plan(posts, policy: dict) -> list:
    items = []
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        if str(post.get("platform") or "").lower() != "tiktok":
            continue
        if ia_backup.ia_source_for_post(post, policy):
            continue
        handle = str(post.get("handle") or "").strip().lstrip("@").lower()
        ident = str(post.get("statusId") or post.get("id") or "").strip()
        if not handle or not ident:
            continue
        label = handle + "/" + ident
        for media in post.get("media") or []:
            if not isinstance(media, dict):
                continue
            video = str(media.get("url") or "").strip()
            row = _item("tiktok", "tiktok:" + handle + ":" + ident + ":video", video, _hosts_of(video, TIKTOK_HOSTS), label)
            if row:
                items.append(row)
            poster = str(media.get("poster") or "").strip()
            row = _item("tiktok", "tiktok:" + handle + ":" + ident + ":poster", poster, _hosts_of(poster, TIKTOK_HOSTS), label)
            if row:
                items.append(row)
    return items


def _manifest_post(key: str, feeds: dict) -> dict:
    platform, _, ident = str(key or "").partition(":")
    found = feeds.get(key) or feeds.get(platform + ":" + ident) or {}
    post = dict(found) if isinstance(found, dict) else {}
    post.setdefault("platform", platform)
    post.setdefault("id", ident)
    return post


def media_plan(posts, manifest: dict, policy: dict) -> list:
    """Video files the Internet Archive rule rejects. Largest are uploaded first."""
    feeds = {}
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        platform = str(post.get("platform") or "").lower()
        ident = str(post.get("statusId") or post.get("id") or "")
        if platform and ident:
            feeds[platform + ":" + ident] = post
    items = []
    seen = set()
    files = list((manifest or {}).get("files") or [])
    for key, indexes in ((manifest or {}).get("posts") or {}).items():
        post = _manifest_post(key, feeds)
        if ia_backup.ia_source_for_post(post, policy):
            continue
        if str(post.get("platform") or "").lower() == "tiktok":
            continue
        for index in indexes or []:
            if not isinstance(index, int) or index < 0 or index >= len(files):
                continue
            row = files[index] if isinstance(files[index], dict) else {}
            if str(row.get("k") or "") not in {"video", "animated_gif"}:
                continue
            url = str(row.get("a") or row.get("u") or "").strip()
            logical = "media:" + url.split("?", 1)[0]
            if not url or logical in seen:
                continue
            item = _item("media", logical, url, _hosts_of(url, ("archive.org",)), str(key))
            if item:
                seen.add(logical)
                items.append(item)
    for post in posts or []:
        if not isinstance(post, dict) or ia_backup.ia_source_for_post(post, policy):
            continue
        if str(post.get("platform") or "").lower() in {"tiktok", ""}:
            continue
        platform = str(post.get("platform") or "").lower()
        ident = str(post.get("statusId") or post.get("id") or "")
        for media in post.get("media") or []:
            if not isinstance(media, dict):
                continue
            if str(media.get("type") or "").lower() not in {"video", "animated_gif"}:
                continue
            url = str(media.get("url") or "").strip()
            logical = "media:" + url.split("?", 1)[0]
            if not url or logical in seen:
                continue
            item = _item("media", logical, url, _hosts_of(url), platform + ":" + ident)
            if item:
                seen.add(logical)
                items.append(item)
    return items


def sort_media(items, sizes: dict | None = None) -> list:
    sizes = sizes or {}
    ranked = [item for item in items if item.get("kind") == "media"]
    rest = [item for item in items if item.get("kind") != "media"]
    ranked.sort(key=lambda item: (-int(sizes.get(item["logical"]) or 0), item["logical"]))
    return rest + ranked


def known_ids(index: dict) -> set:
    return {str(row.get("logical") or "") for row in (index or {}).get("files") or [] if row.get("logical")}


def known_hashes(index: dict) -> set:
    found = {str(row.get("sha256") or "") for row in (index or {}).get("files") or [] if row.get("sha256")}
    for row in (index or {}).get("files") or []:
        stem = Path(str(row.get("path") or "")).name.split(".", 1)[0]
        if HASH_NAME.fullmatch(stem):
            found.add(stem)
    return {item for item in found if item}


def file_item(parent: dict, url: str, body: bytes | None = None) -> dict | None:
    logical = parent["kind"] + ":" + str(url or "").split("?", 1)[0]
    row = _item(parent["kind"], logical, url, parent["hosts"], parent.get("label") or "")
    if not row:
        return None
    row["path"] = remote_path_for(parent["kind"], url)
    if body is not None:
        row["body"] = body
    return row


def segment_items(parent: dict, urls, playlist: bytes | None = None, playlist_url: str = "") -> list:
    items = []
    seen = set()
    if playlist is not None and playlist_url:
        row = file_item(parent, playlist_url, playlist)
        if row and row["logical"] not in seen:
            seen.add(row["logical"])
            items.append(row)
    for url in urls or []:
        row = file_item(parent, url)
        if row and row["logical"] not in seen:
            seen.add(row["logical"])
            items.append(row)
    return items


def ext_for(body: bytes, url: str, playlist: bool = False) -> str:
    if playlist or str(url or "").lower().split("?", 1)[0].endswith(".m3u8"):
        return ".m3u8"
    if body.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if body.startswith(b"GIF87a") or body.startswith(b"GIF89a"):
        return ".gif"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return ".webp"
    if len(body) > 12 and body[4:8] == b"ftyp":
        return ".mp4"
    if body.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".m4s", ".ts", ".aac", ".mp3", ".m4a", ".m3u8"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".bin"


def playlist_source(body: bytes | None, url: str, hosts, opener=None) -> tuple[bytes | None, str]:
    """Accept an HLS playlist, or a radio current.json that points at one."""
    if not body:
        return None, url
    text = body.decode("utf-8", "replace").lstrip()
    if text.startswith("#EXTM3U"):
        return body, url
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None, url
    target = str(data.get("url") or "").strip() if isinstance(data, dict) else ""
    if not target:
        return None, url
    target = urllib.parse.urljoin(url, target)
    if not _allowed(target, hosts):
        return None, url
    nested = fetch_bytes(target, hosts, 2 * 1024 * 1024, opener)
    if nested and nested.decode("utf-8", "replace").lstrip().startswith("#EXTM3U"):
        return nested, target
    return None, url


def _load_json(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _git_json(spec: str):
    proc = subprocess.run(["git", "show", spec], cwd=ROOT, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return {}
    try:
        data = json.loads(proc.stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def load_sources() -> tuple:
    music = _load_json(ROOT / "data" / "music.json")
    config = _load_json(ROOT / "feeds.config.json")
    feeds = _load_json(ROOT / "feeds.json")
    posts = list(feeds.get("posts") or [])
    extra = _git_json("origin/data:feeds.json")
    for post in extra.get("posts") or []:
        if isinstance(post, dict):
            posts.append(post)
    manifest = _git_json("origin/data:archive/ia-manifest.json")
    if not manifest:
        manifest = _load_json(ROOT / "archive" / "ia-manifest.json")
    owner = _load_json(ROOT / "owner" / "tiktok.json")
    tiktok_posts = [row for row in (owner.get("posts") or []) if isinstance(row, dict)]
    if not tiktok_posts and os.environ.get("GDRIVE_FETCH_TIKTOK") == "1":
        tiktok_posts = fetch_tiktok_posts()
    return music, loop_urls_from_config(config), posts, manifest, tiktok_posts


def fetch_tiktok_posts() -> list:
    try:
        from tiktok_sync import TRACKED, entry_to_post, fetch_entries
    except Exception:
        print("[gdrive] TikTok list was not available")
        return []
    policy = ia_backup.load_ia_policy()
    posts = []
    for handle in TRACKED:
        if handle.lower() in (policy.get("tiktok") or set()):
            continue
        try:
            entries = fetch_entries(handle) or []
        except Exception:
            print("[gdrive] TikTok list was not available")
            continue
        for entry in entries:
            post = entry_to_post(entry, handle)
            if post:
                posts.append(post)
    if not posts:
        print("[gdrive] TikTok list was not available")
    return posts


def fetch_bytes(url: str, hosts, limit: int, opener=None) -> bytes | None:
    if not _allowed(url, hosts):
        return None
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    client = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with client.open(request, timeout=45) as response:
            status = getattr(response, "status", 200)
            final = response.geturl()
            if status != 200 or not _allowed(final, hosts):
                return None
            length = response.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > limit:
                return None
            chunks = []
            total = 0
            while True:
                part = response.read(64 * 1024)
                if not part:
                    break
                total += len(part)
                if total > limit:
                    return None
                chunks.append(part)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    body = b"".join(chunks)
    return body or None


def content_length(url: str, hosts, opener=None) -> int:
    if not _allowed(url, hosts):
        return 0
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA, "Accept": "*/*"})
    client = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with client.open(request, timeout=15) as response:
            if not _allowed(response.geturl(), hosts):
                return 0
            length = response.headers.get("Content-Length") or "0"
            return int(length) if str(length).isdigit() else 0
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0


def run_rclone(args, config_path: Path, secrets) -> tuple[int, str, bytes]:
    env = os.environ.copy()
    env.pop(SECRET_ENV, None)
    env["RCLONE_CONFIG"] = str(config_path)
    proc = subprocess.run(
        ["rclone", *args, "--tpslimit", "8", "--retries", "2", "--low-level-retries", "3", "--timeout", "120s"],
        capture_output=True,
        env=env,
        check=False,
    )
    text = scrub((proc.stdout + proc.stderr).decode("utf-8", "replace"), secrets)
    return proc.returncode, text, proc.stdout


def _blank_index() -> dict:
    return {"v": 1, "files": []}


def _remember(index: dict, row: dict) -> None:
    logical = row["logical"]
    files = [item for item in index["files"] if item.get("logical") != logical]
    files.append(row)
    index["files"] = files


def upload_index(index: dict, config_path: Path, secrets, directory: Path) -> bool:
    path = directory / "index.json"
    path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    code, output, _body = run_rclone(["copyto", str(path), REMOTE + "/index.json"], config_path, secrets)
    path.unlink(missing_ok=True)
    if code != 0:
        print("[gdrive] index update failed")
        if output.strip():
            print(output.strip()[:400])
        return False
    return True


def _upload_file(local: Path, remote_path: str, config_path: Path, secrets) -> bool:
    code, output, _body = run_rclone(
        ["copyto", str(local), REMOTE + "/" + remote_path, "--ignore-existing"],
        config_path,
        secrets,
    )
    if code != 0:
        print("[gdrive] upload failed " + remote_path)
        if output.strip():
            print(output.strip()[:400])
        return False
    return True


def _store(index, logical, kind, label, body, remote_path) -> None:
    _remember(index, {
        "sha256": hashlib.sha256(body).hexdigest(),
        "logical": logical,
        "kind": kind,
        "path": remote_path,
        "bytes": len(body),
        "label": label,
    })


def backup(parsed: dict, config_path: Path, sources, opener=None) -> int:
    secrets = secret_values(parsed)
    music, loops, posts, manifest, tiktok_posts = sources
    code, output, _body = run_rclone(["mkdir", REMOTE], config_path, secrets)
    if code != 0:
        print("[gdrive] could not create the backup folder")
        if output.strip():
            print(output.strip()[:400])
        return 1
    for kind in KINDS:
        code, output, _body = run_rclone(["mkdir", REMOTE + "/" + kind], config_path, secrets)
        if code != 0:
            print("[gdrive] could not create " + kind)
            if output.strip():
                print(output.strip()[:400])
            return 1
    code, _output, raw = run_rclone(["cat", REMOTE + "/index.json"], config_path, secrets)
    index = _blank_index()
    if code == 0 and raw:
        try:
            loaded = json.loads(raw.decode("utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("files"), list):
                index = loaded
        except (UnicodeError, json.JSONDecodeError):
            index = _blank_index()
    policy = ia_backup.load_ia_policy()
    planned = []
    planned.extend(music_plan(music))
    planned.extend(radio_plan(loops))
    planned.extend(tiktok_plan(tiktok_posts, policy))
    media = [item for item in media_plan(posts, manifest, policy) if item["logical"] not in known_ids(index)]
    sizes = {}
    for item in media[:30]:
        sizes[item["logical"]] = content_length(item["url"], item["hosts"], opener)
    planned.extend(sort_media(media, sizes))
    directory = Path(tempfile.mkdtemp(prefix="gdrive-"))
    uploaded = 0
    skipped = 0
    failures = 0
    used = 0
    have = known_ids(index)
    hashes = known_hashes(index)
    try:
        queue = list(planned)
        position = 0
        while position < len(queue):
            item = queue[position]
            position += 1
            if item["logical"] in have:
                skipped += 1
                continue
            if item.get("playlist"):
                fetched = fetch_bytes(item["url"], item["hosts"], 2 * 1024 * 1024, opener)
                body, base = playlist_source(fetched, item["url"], item["hosts"], opener)
                if not body:
                    print("[gdrive] skipped playlist " + item["label"])
                    continue
                variant, segments, extras = hls_media(body.decode("utf-8", "replace"), base)
                if variant:
                    if not _allowed(variant, item["hosts"]):
                        print("[gdrive] skipped playlist " + item["label"])
                        continue
                    nested = fetch_bytes(variant, item["hosts"], 2 * 1024 * 1024, opener)
                    if not nested:
                        print("[gdrive] skipped playlist " + item["label"])
                        continue
                    _variant, segments, extras = hls_media(nested.decode("utf-8", "replace"), variant)
                    body, base = nested, variant
                children = segment_items(item, list(extras) + list(segments), body, base)
                queue[position:position] = children
                continue
            if uploaded >= MAX_NEW_FILES or used >= MAX_NEW_BYTES:
                print("[gdrive] cap reached; the rest waits for the next run")
                break
            body = item.get("body")
            if body is None:
                body = fetch_bytes(item["url"], item["hosts"], min(MAX_FILE_BYTES, MAX_NEW_BYTES - used), opener)
            if not body:
                print("[gdrive] skipped " + item["kind"] + " " + (item.get("label") or "file"))
                continue
            digest = hashlib.sha256(body).hexdigest()
            ext = ext_for(body, item["url"])
            remote_path = item.get("path") or (item["kind"] + "/" + digest + ext)
            if any(row.get("sha256") == digest and row.get("path") == remote_path for row in index["files"]):
                _store(index, item["logical"], item["kind"], item.get("label") or "", body, remote_path)
                have.add(item["logical"])
                hashes.add(digest)
                skipped += 1
                continue
            local = directory / (digest + ext)
            local.write_bytes(body)
            if not _upload_file(local, remote_path, config_path, secrets):
                failures += 1
                local.unlink(missing_ok=True)
                continue
            local.unlink(missing_ok=True)
            _store(index, item["logical"], item["kind"], item.get("label") or "", body, remote_path)
            have.add(item["logical"])
            hashes.add(digest)
            uploaded += 1
            used += len(body)
            if not upload_index(index, config_path, secrets, directory):
                failures += 1
        if not upload_index(index, config_path, secrets, directory):
            failures += 1
    finally:
        shutil.rmtree(directory, ignore_errors=True)
    print(f"[gdrive] uploaded {uploaded} files, skipped {skipped}, failures {failures}")
    return 1 if failures else 0


def main() -> int:
    raw = os.environ.get(SECRET_ENV) or ""
    if not raw.strip():
        print("[gdrive] GDRIVE_RCLONE_TOKEN is not set; skipping the upload")
        return 0
    try:
        parsed = parse_secret(raw)
    except (json.JSONDecodeError, ValueError, TypeError):
        print("[gdrive] GDRIVE_RCLONE_TOKEN is not a drive.file user token")
        return 1
    if shutil.which("rclone") is None:
        print("[gdrive] rclone is not installed")
        return 1
    secrets = secret_values(parsed, raw)
    handle = tempfile.NamedTemporaryFile(prefix="rclone-", suffix=".conf", delete=False)
    config_path = Path(handle.name)
    handle.close()
    try:
        config_path.write_text(rclone_config_text(parsed), encoding="utf-8")
        os.chmod(config_path, 0o600)
        try:
            sources = load_sources()
        except Exception as err:
            print("[gdrive] could not read the backup sources")
            print(scrub(str(err), secrets))
            return 1
        try:
            return backup(parsed, config_path, sources)
        except Exception as err:
            print("[gdrive] backup failed")
            print(scrub(str(err), secrets))
            return 1
    finally:
        config_path.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
