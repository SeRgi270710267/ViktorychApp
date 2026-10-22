#!/usr/bin/env python3
"""Back up public stubs and media to the Internet Archive.

Each item identifier is x plus 32 hex characters from a CSPRNG. The month and
type for that identifier live only in archive/ia-manifest.json. File names are
content hashes. Items use mediatype data, noindex, and a generic title and
description. Direct download URLs stay on archive.org/download.

Older superintelapp-* items are copied onto those random ids. Their files are
deleted only after the new bytes download correctly and the published manifest
points at the new copies.

IA_ACCESS_KEY and IA_SECRET_KEY are the S3 keys. When either is missing this
prints a notice and exits 0. The key values are never printed.

Uploads use the S3-like API (Authorization: LOW). A 503 or SlowDown waits
and retries. Discord posts and any URL that is not a public media file are
left out. Nothing is committed to git.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.common import best_mp4  # noqa: E402
from archive import canonical_id, month_key  # noqa: E402

S3_ENDPOINT = "https://s3.us.archive.org"
DOWNLOAD_BASE = "https://archive.org/download"
METADATA_BASE = "https://archive.org/metadata"
UA = "archive-backup/1.0"
ITEM_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,90}$")
ITEM_ID_RE = re.compile(r"^x[0-9a-f]{32}$")
NEUTRAL_TITLE = "files"
NEUTRAL_DESCRIPTION = "files"
DERIVED_NAMES = ("_meta.xml", "_files.xml", "_meta.sqlite", "_archive.torrent")
KNOWN_OLD_ITEMS = (
    "superintelapp-2026-10",
    "superintelapp-2026-09",
    "superintelapp-2026-08",
    "superintelapp-2026-03",
    "superintelapp-2026-02",
    "superintelapp-img-2026-10",
    "superintelapp-mov-2026-10",
    "superintelapp-manifest",
)
MONTH_RE = re.compile(r"^(?:\d{4}-\d{2}|undated)$")
ALLOW_SUFFIXES = (
    "pbs.twimg.com",
    "video.twimg.com",
    "i.ytimg.com",
    "ytimg.com",
    "ggpht.com",
    "yt3.googleusercontent.com",
    "cdninstagram.com",
    "fbcdn.net",
    "cdnthreads.net",
    "fbsbx.com",
    "telesco.pe",
    "telegram-cdn.org",
    "userapi.com",
    "vkuser.net",
)
BLOCK_SUFFIXES = (
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "youtube.com",
    "youtube-nocookie.com",
    "instagram.com",
    "threads.net",
    "threads.com",
    "t.me",
    "googlevideo.com",
    "github.com",
    "githubusercontent.com",
    "jsdelivr.net",
    "archive.org",
)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def scrub(text: str, secrets) -> str:
    out = str(text or "")
    for secret in secrets or []:
        if secret:
            out = out.replace(str(secret), "[redacted]")
    return out


def pages_origin() -> str:
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    owner, _, name = repo.partition("/")
    if not owner or not name or "/" in name:
        return ""
    return f"https://{owner.lower()}.github.io/{name}/"


def new_item_id() -> str:
    return "x" + secrets.token_hex(16)


def valid_item_id(value: str) -> bool:
    return bool(ITEM_ID_RE.fullmatch(str(value or "")))


def slot_item(state: dict, slot: str) -> str:
    items = state.setdefault("items", {})
    current = str(items.get(slot) or "")
    if not valid_item_id(current):
        items[slot] = new_item_id()
    return items[slot]


def old_slot(item: str) -> str:
    if item == "superintelapp-manifest":
        return "manifest"
    image = re.fullmatch(r"superintelapp-img-(\d{4}-\d{2})", item)
    if image:
        return "image:" + image.group(1)
    movie = re.fullmatch(r"superintelapp-mov-(\d{4}-\d{2})", item)
    if movie:
        return "video:" + movie.group(1)
    stub = re.fullmatch(r"superintelapp-(\d{4}-\d{2})", item)
    if stub:
        return "stub:" + stub.group(1)
    return ""


def hash_name(body: bytes, ext: str) -> str:
    suffix = ext if str(ext or "").startswith(".") else ""
    return hashlib.sha256(body).hexdigest()[:20] + suffix


def archive_download_url(item: str, name: str, base: str = DOWNLOAD_BASE) -> str:
    return base.rstrip("/") + "/" + item + "/" + name


def archive_cors_url(item: str, name: str) -> str:
    return "https://cors.archive.org/cors/" + item + "/" + name


def _host(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower().rstrip(".")


def _suffix(host: str, suffixes) -> bool:
    return any(host == item or host.endswith("." + item) for item in suffixes)


def prefer_original(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = _host(url)
    if host.endswith("pbs.twimg.com") and "/media/" in parsed.path and "name=" in (parsed.query or ""):
        pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        pairs = [(key, "orig" if key == "name" else value) for key, value in pairs]
        return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(pairs)))
    return url


def public_media_url(url: str, *, allow_hosts=(), allow_http: bool = False) -> bool:
    raw = str(url or "").strip()
    if not raw or any(char in raw for char in ("\n", "\r", " ")):
        return False
    parsed = urllib.parse.urlparse(raw)
    if parsed.username or parsed.password:
        return False
    scheme = (parsed.scheme or "").lower()
    if scheme != "https" and not (allow_http and scheme == "http"):
        return False
    host = _host(raw)
    if not host or host in {"localhost"} or host.endswith(".local"):
        return False
    if _suffix(host, BLOCK_SUFFIXES):
        return False
    path = (parsed.path or "").lower()
    if path.endswith(".m3u8") or path.endswith(".html") or path.endswith(".php"):
        return False
    if host in {item.lower() for item in allow_hosts}:
        return True
    if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", host):
        return False
    return _suffix(host, ALLOW_SUFFIXES)


def _sniff(body: bytes, content_type: str) -> tuple[str, str, str] | None:
    sample = body[:64].lstrip().lower()
    if sample.startswith(b"<") or sample.startswith(b"{") or sample.startswith(b"<!doc"):
        return None
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg", "photo"
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png", "photo"
    if body.startswith(b"GIF87a") or body.startswith(b"GIF89a"):
        return "image/gif", ".gif", "photo"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp", ".webp", "photo"
    if len(body) > 12 and body[4:8] == b"ftyp":
        return "video/mp4", ".mp4", "video"
    if body.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm", ".webm", "video"
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    if kind in {"image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"}:
        return None
    return None


def _opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _read_limited(response, limit: int) -> bytes | None:
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
    return b"".join(chunks)


def download_public(url: str, *, limit: int, allow_hosts=(), allow_http: bool = False, opener=None) -> tuple[bytes, str, str, str] | None:
    if not public_media_url(url, allow_hosts=allow_hosts, allow_http=allow_http):
        return None
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,video/*;q=0.9,*/*;q=0.1"})
    client = opener or _opener()
    try:
        with client.open(request, timeout=45) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                return None
            final = response.geturl()
            if not public_media_url(final, allow_hosts=allow_hosts, allow_http=allow_http):
                return None
            length = response.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > limit:
                return None
            body = _read_limited(response, limit)
            content_type = response.headers.get("Content-Type") or ""
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if not body:
        return None
    sniffed = _sniff(body, content_type)
    if not sniffed:
        return None
    return (body, sniffed[0], sniffed[1], sniffed[2])


def _s3_once(endpoint: str, item: str, name: str, body: bytes, headers: dict, access: str, secret: str, opener) -> tuple[int, bytes]:
    if not ITEM_RE.match(item):
        raise ValueError("unsafe item identifier")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", name):
        raise ValueError("unsafe archive file name")
    url = endpoint.rstrip("/") + "/" + urllib.parse.quote(item) + "/" + urllib.parse.quote(name)
    sent = {
        "Authorization": f"LOW {access}:{secret}",
        "Content-Type": headers.get("Content-Type") or "application/octet-stream",
        "User-Agent": UA,
        "x-archive-auto-make-bucket": "1",
        "x-archive-queue-derive": "0",
    }
    sent.update(headers)
    request = urllib.request.Request(url, data=body, headers=sent, method="PUT")
    try:
        with opener.open(request, timeout=180) as response:
            return getattr(response, "status", 200), response.read()
    except urllib.error.HTTPError as err:
        payload = b""
        try:
            payload = err.read() or b""
        except OSError:
            payload = b""
        return err.code, payload


def upload_bytes(endpoint, item, name, body, *, content_type, access, secret, opener, sleep, backoff, notes, secrets_for_log) -> bool:
    headers = {
        "Content-Type": content_type,
        "x-archive-meta-mediatype": "data",
        "x-archive-meta-title": NEUTRAL_TITLE,
        "x-archive-meta-description": NEUTRAL_DESCRIPTION,
        "x-archive-meta-noindex": "true",
    }
    delay = max(backoff, 5)
    for attempt in range(8):
        status, payload = _s3_once(endpoint, item, name, body, headers, access, secret, opener)
        lowered = payload.lower()
        if status in {200, 201, 204}:
            return True
        if status == 503 or b"slowdown" in lowered:
            notes.append(f"[ia-backup] {item}/{name} asked to slow down; waiting")
            sleep(delay)
            delay = min(delay * 3, 120)
            continue
        detail = scrub(payload[:160].decode("utf-8", "replace"), secrets_for_log)
        notes.append(f"[ia-backup] {item}/{name} failed ({status}) {detail}".rstrip())
        if attempt + 1 < 8 and status >= 500:
            sleep(delay)
            delay = min(delay * 3, 120)
            continue
        return False
    return False


def _blank_state() -> dict:
    return {"v": 1, "shards": {}, "byHash": {}, "byUrl": {}, "posts": {}}


def _public_rows(rows) -> list:
    kept = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        platform = str(row.get("p") or "").strip().lower()
        ident = str(row.get("id") or "").strip()
        if platform == "discord" or not platform or not ident:
            continue
        stub = {"p": platform, "id": ident}
        for key in ("h", "d", "k", "t"):
            value = row.get(key)
            if value:
                stub[key] = value
        kept.append(stub)
    return kept


def _post_key(post: dict) -> str:
    platform = str(post.get("platform") or "").strip().lower()
    ident = canonical_id(post)
    if not platform or not ident or platform == "discord":
        return ""
    return platform + ":" + ident


def _remember(state: dict, key: str, entry: dict) -> None:
    rows = state["posts"].setdefault(key, [])
    mark = (entry.get("u"), entry.get("k"))
    if any((row.get("u"), row.get("k")) == mark for row in rows):
        return
    rows.append(entry)


def _jobs(posts) -> list:
    found = []

    def add(post, month):
        key = _post_key(post)
        if not key:
            return
        avatar = str(post.get("avatar") or "").strip()
        if avatar:
            found.append((month, key, "avatar", prefer_original(avatar), ""))
        for media in post.get("media") or []:
            if not isinstance(media, dict):
                continue
            kind = str(media.get("type") or "photo").lower()
            poster = str(media.get("poster") or "").strip()
            url = str(media.get("url") or "").strip()
            variant = best_mp4(media.get("variants"))
            if kind in {"video", "animated_gif"}:
                file_url = variant or url
                if file_url:
                    found.append((month, key, kind, prefer_original(file_url), prefer_original(poster) if poster else ""))
                if poster:
                    found.append((month, key, "photo", prefer_original(poster), ""))
                continue
            if url:
                found.append((month, key, "photo" if kind not in {"photo", "image"} else "photo", prefer_original(url), ""))
            elif poster:
                found.append((month, key, "photo", prefer_original(poster), ""))
        quoted = post.get("quoted")
        if isinstance(quoted, dict):
            add(quoted, month_key(str(quoted.get("date") or "")) or month)

    for post in posts or []:
        if not isinstance(post, dict):
            continue
        if str(post.get("platform") or "").lower() == "discord":
            continue
        if post.get("protected") or post.get("private"):
            continue
        add(post, month_key(str(post.get("date") or post.get("sortDate") or "")))
    found.sort(key=lambda row: row[0], reverse=True)
    return found


def manifest_from_state(state: dict) -> dict:
    files = []
    index = {}
    posts = {}
    for key, rows in (state.get("posts") or {}).items():
        picks = []
        for row in rows or []:
            url = row.get("u") or ""
            digest = (state.get("byUrl") or {}).get(url) or ""
            stored = (state.get("byHash") or {}).get(digest) or {}
            archive = stored.get("a") or ""
            if not url or not archive:
                continue
            mark = (url, row.get("k") or "photo", archive)
            if mark not in index:
                index[mark] = len(files)
                item = {"u": url, "a": archive, "k": row.get("k") or "photo"}
                if row.get("p"):
                    item["p"] = row["p"]
                files.append(item)
            picks.append(index[mark])
        if picks:
            posts[key] = picks
    shards = {}
    for key, url in (state.get("shardUrls") or {}).items():
        if str(url or "").startswith("https://archive.org/download/x"):
            shards[key] = url
    items = {key: value for key, value in (state.get("items") or {}).items() if valid_item_id(value)}
    return {"v": 1, "items": items, "shards": shards, "files": files, "posts": posts}


def run_backup(config: dict, posts, shards, state: dict | None = None, sleep=time.sleep) -> dict:
    """Upload shards and new public media. config carries endpoint, keys, and limits."""
    state = state or _blank_state()
    state.setdefault("v", 1)
    state.setdefault("shards", {})
    state.setdefault("byHash", {})
    state.setdefault("byUrl", {})
    state.setdefault("posts", {})
    notes = []
    secrets = [config.get("access") or "", config.get("secret") or ""]
    opener = config.get("opener") or _opener()
    endpoint = config.get("endpoint") or S3_ENDPOINT
    uploaded = []
    failures = 0
    skipped = 0
    pace = float(config.get("pace") if config.get("pace") is not None else 1.5)
    backoff = float(config.get("backoff") if config.get("backoff") is not None else 2)
    limit = int(config.get("max_bytes") or 48 * 1024 * 1024)
    max_uploads = int(config.get("max_uploads") or 30)

    def put(item, name, body, content_type, counts=True):
        nonlocal failures
        ok = upload_bytes(
            endpoint,
            item,
            name,
            body,
            content_type=content_type,
            access=config["access"],
            secret=config["secret"],
            opener=opener,
            sleep=sleep,
            backoff=backoff,
            notes=notes,
            secrets_for_log=secrets,
        )
        if ok:
            uploaded.append(item + "/" + name)
            if pace:
                sleep(pace)
        elif counts:
            failures += 1
        return ok

    for month in sorted((name for name in (shards or {}) if MONTH_RE.match(str(name))), reverse=True):
        rows = _public_rows(shards.get(month) or [])
        if not rows:
            continue
        body = (json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        digest = hashlib.sha256(body).hexdigest()
        if state["shards"].get(month) == digest:
            skipped += 1
            continue
        item = slot_item(state, "stub:" + month)
        name = hash_name(body, ".json")
        if put(item, name, body, "application/json"):
            state["shards"][month] = digest
            state.setdefault("shardNames", {})[month] = name
            state.setdefault("shardUrls", {})[month] = archive_download_url(item, name, config.get("download_base") or DOWNLOAD_BASE)
            notes.append(f"[ia-backup] shard {item}/{name}")

    seen_urls = set()
    new_uploads = 0
    for month, key, kind, url, poster in _jobs(posts):
        if not url or url in seen_urls:
            if url and key:
                digest = state["byUrl"].get(url)
                if digest:
                    _remember(state, key, {"k": kind, "u": url, "p": poster} if poster else {"k": kind, "u": url})
            continue
        seen_urls.add(url)
        if state["byUrl"].get(url):
            _remember(state, key, {"k": kind, "u": url, "p": poster} if poster else {"k": kind, "u": url})
            skipped += 1
            continue
        if new_uploads >= max_uploads:
            notes.append("[ia-backup] upload cap reached; remaining media waits for the next run")
            break
        fetched = download_public(
            url,
            limit=limit,
            allow_hosts=config.get("allow_hosts") or (),
            allow_http=bool(config.get("allow_http")),
            opener=opener,
        )
        if not fetched:
            skipped += 1
            continue
        body, content_type, ext, sniffed = fetched
        digest = hashlib.sha256(body).hexdigest()
        stored_kind = kind if kind in {"avatar", "video", "animated_gif"} else sniffed
        if stored_kind in {"video", "animated_gif"} and sniffed == "photo":
            stored_kind = "photo"
        if digest in state["byHash"]:
            state["byUrl"][url] = digest
            entry = {"k": stored_kind, "u": url}
            if poster:
                entry["p"] = poster
            _remember(state, key, entry)
            skipped += 1
            continue
        media_kind = "video" if stored_kind in {"video", "animated_gif"} else "image"
        item = slot_item(state, ("video:" if media_kind == "video" else "image:") + month)
        name = digest[:20] + ext
        if not put(item, name, body, content_type):
            continue
        new_uploads += 1
        archive = archive_download_url(item, name, config.get("download_base") or DOWNLOAD_BASE)
        state["byHash"][digest] = {"a": archive, "k": stored_kind}
        state["byUrl"][url] = digest
        entry = {"k": stored_kind, "u": url}
        if poster:
            entry["p"] = poster
        _remember(state, key, entry)
        notes.append(f"[ia-backup] media {item}/{name}")

    download_base = config.get("download_base") or DOWNLOAD_BASE
    manifest_item = slot_item(state, "manifest") if state.get("items") else ""
    index_body = (json.dumps({"shards": [name for name in state["shards"] if MONTH_RE.match(name)]}, separators=(",", ":")) + "\n").encode("utf-8")
    index_sha = hashlib.sha256(index_body).hexdigest()
    index_name = hash_name(index_body, ".json")
    index_url = archive_download_url(manifest_item, index_name, download_base) if manifest_item else ""
    if manifest_item and state["shards"] and (state.get("index") != index_sha or state.get("indexUrl") != index_url):
        if put(manifest_item, index_name, index_body, "application/json", counts=False):
            state["index"] = index_sha
            state["indexUrl"] = index_url
            state.setdefault("shardUrls", {})["index.json"] = index_url
            notes.append(f"[ia-backup] index {manifest_item}/{index_name}")
    manifest = manifest_from_state(state)
    manifest_body = (json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    manifest_sha = hashlib.sha256(manifest_body).hexdigest()
    manifest_name = hash_name(manifest_body, ".json")
    manifest_url = archive_download_url(manifest_item, manifest_name, download_base) if manifest_item else ""
    if manifest_item and manifest["files"] and (state.get("manifest") != manifest_sha or state.get("manifestUrl") != manifest_url):
        if put(manifest_item, manifest_name, manifest_body, "application/json"):
            state["manifest"] = manifest_sha
            state["manifestUrl"] = manifest_url
            notes.append(f"[ia-backup] manifest {manifest_item}/{manifest_name}")
    return {
        "state": state,
        "manifest": manifest,
        "uploaded": uploaded,
        "skipped": skipped,
        "failures": failures,
        "notes": [scrub(line, secrets) for line in notes],
    }


def _git_show(path: str) -> bytes | None:
    proc = subprocess.run(["git", "show", f"origin/data:{path}"], cwd=ROOT, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return None
    return proc.stdout


def _load_json_bytes(payload: bytes | None):
    if not payload:
        return None
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None


def load_shards(archive_dir: Path) -> dict:
    if not (archive_dir / "index.json").is_file():
        return {}
    index = _load_json_bytes((archive_dir / "index.json").read_bytes()) or {}
    names = [name for name in (index.get("shards") or []) if MONTH_RE.match(str(name))]
    shards = {}
    for name in names:
        path = archive_dir / f"{name}.json"
        rows = _load_json_bytes(path.read_bytes()) if path.is_file() else None
        if isinstance(rows, list):
            shards[name] = rows
    return shards


def load_shards_from_data() -> dict:
    subprocess.run(["git", "fetch", "-q", "origin", "data"], cwd=ROOT, capture_output=True)
    index = _load_json_bytes(_git_show("archive/index.json")) or {}
    shards = {}
    for name in index.get("shards") or []:
        if not MONTH_RE.match(str(name)):
            continue
        rows = _load_json_bytes(_git_show(f"archive/{name}.json"))
        if isinstance(rows, list):
            shards[str(name)] = rows
    return shards


def load_posts() -> list:
    origin = pages_origin()
    request = urllib.request.Request(origin + "feeds.json", headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with _opener().open(request, timeout=30) as response:
            if getattr(response, "status", 200) == 200:
                doc = json.loads(response.read().decode("utf-8"))
                if isinstance(doc, dict) and isinstance(doc.get("posts"), list):
                    return doc["posts"]
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        pass
    path = ROOT / "feeds.json"
    if not path.is_file():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return doc.get("posts") or [] if isinstance(doc, dict) else []


def load_state(archive_dir: Path) -> dict:
    path = archive_dir / "ia-state.json"
    if path.is_file():
        parsed = _load_json_bytes(path.read_bytes())
        if isinstance(parsed, dict):
            return parsed
    subprocess.run(["git", "fetch", "-q", "origin", "data"], cwd=ROOT, capture_output=True)
    parsed = _load_json_bytes(_git_show("archive/ia-state.json"))
    return parsed if isinstance(parsed, dict) else _blank_state()


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if access and secret:
        return access, secret
    missing = []
    if not access:
        missing.append("IA_ACCESS_KEY")
    if not secret:
        missing.append("IA_SECRET_KEY")
    print(
        "[ia-backup] "
        + " and ".join(missing)
        + " not set. Skipping the Internet Archive backup. Nothing was uploaded. "
        + "Create the keys at https://archive.org/account/s3.php and add them as repository Actions secrets."
    )
    return None


def _http_bytes(url: str, urlopen, method: str = "GET", data: bytes | None = None, headers: dict | None = None) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=data, headers=headers or {"User-Agent": UA, "Accept": "*/*"}, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            return getattr(response, "status", 200), response.read()
    except urllib.error.HTTPError as err:
        payload = b""
        try:
            payload = err.read() or b""
        except OSError:
            payload = b""
        return err.code, payload
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0, b""


def _http_json(url: str, urlopen):
    status, body = _http_bytes(url, urlopen)
    if status != 200 or not body:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None


def _matches(urlopen, url: str, digest: str) -> bool:
    if not url or not digest:
        return False
    status, body = _http_bytes(url, urlopen)
    return status == 200 and bool(body) and hashlib.sha256(body).hexdigest() == digest


def _matches_soon(urlopen, url: str, digest: str, sleep, tries: int = 8) -> bool:
    """A new upload can take a little while before archive.org serves the bytes."""
    delay = 2.0
    for attempt in range(tries):
        if _matches(urlopen, url, digest):
            return True
        if attempt + 1 < tries:
            sleep(delay)
            delay = min(delay * 2, 20)
    return False


def discover_old_items(urlopen) -> list:
    found = {item for item in KNOWN_OLD_ITEMS if old_slot(item)}
    url = "https://archive.org/advancedsearch.php?q=identifier%3Asuperintelapp*&fl[]=identifier&rows=100&output=json"
    doc = _http_json(url, urlopen) or {}
    for row in ((doc.get("response") or {}).get("docs") or []):
        ident = str((row or {}).get("identifier") or "")
        if old_slot(ident):
            found.add(ident)
    return sorted(found)


def _user_files(doc: dict) -> list:
    names = []
    for row in (doc or {}).get("files") or []:
        name = str((row or {}).get("name") or "")
        if not name or name == "__ia_thumb.jpg" or name.endswith(DERIVED_NAMES):
            continue
        names.append(name)
    return names


def _content_type_for(ext: str) -> str:
    return {
        ".json": "application/json",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
    }.get(ext, "application/octet-stream")


def _rewrite_pointer(state: dict, old_item: str, old_name: str, url: str, digest: str, slot: str) -> None:
    needle = "/" + old_item + "/" + old_name
    for stored in (state.get("byHash") or {}).values():
        if needle in str(stored.get("a") or ""):
            stored["a"] = url
    if slot.startswith("stub:"):
        month = slot.split(":", 1)[1]
        state.setdefault("shards", {})[month] = digest
        state.setdefault("shardNames", {})[month] = digest[:20] + ".json"
        state.setdefault("shardUrls", {})[month] = url


def migrate_copies(config: dict, state: dict, sleep=time.sleep) -> dict:
    """Copy files off guessable items. Nothing is deleted here."""
    notes = []
    failures = 0
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or _opener()
    download_base = (config.get("download_base") or DOWNLOAD_BASE).rstrip("/")
    metadata_base = (config.get("metadata_base") or METADATA_BASE).rstrip("/")
    endpoint = config.get("endpoint") or S3_ENDPOINT
    access = config["access"]
    secret = config["secret"]
    log_secrets = [access, secret]
    pace = float(config.get("pace") if config.get("pace") is not None else 1.5)
    backoff = float(config.get("backoff") if config.get("backoff") is not None else 2)
    old_items = list(config["old_items"]) if "old_items" in config else discover_old_items(urlopen)
    copied = state.setdefault("copied", {})
    for item in old_items:
        slot = old_slot(item)
        if not slot:
            continue
        doc = _http_json(metadata_base + "/" + urllib.parse.quote(item), urlopen)
        if not isinstance(doc, dict) or not doc.get("files"):
            notes.append(f"[ia-backup] no files listed for {item}")
            continue
        for name in _user_files(doc):
            if slot == "manifest" and name in {"ia-manifest.json", "index.json"}:
                pending = state.setdefault("oldManifestFiles", [])
                mark = {"item": item, "name": name}
                if mark not in pending:
                    pending.append(mark)
                continue
            key = item + "/" + name
            prev = copied.get(key) or {}
            if valid_item_id(prev.get("item")) and _matches(urlopen, prev.get("url") or "", prev.get("digest") or ""):
                _rewrite_pointer(state, item, name, prev["url"], prev["digest"], slot)
                continue
            status, body = _http_bytes(download_base + "/" + urllib.parse.quote(item) + "/" + urllib.parse.quote(name), urlopen)
            if status != 200 or not body:
                notes.append(f"[ia-backup] could not read {key}")
                failures += 1
                continue
            digest = hashlib.sha256(body).hexdigest()
            ext = os.path.splitext(name)[1].lower()
            if ext not in {".json", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm"}:
                ext = ""
            new_name = digest[:20] + ext
            new_item = slot_item(state, slot)
            url = archive_download_url(new_item, new_name, download_base)
            uploaded = _matches(urlopen, url, digest)
            if not uploaded:
                uploaded = upload_bytes(
                    endpoint,
                    new_item,
                    new_name,
                    body,
                    content_type=_content_type_for(ext),
                    access=access,
                    secret=secret,
                    opener=opener,
                    sleep=sleep,
                    backoff=backoff,
                    notes=notes,
                    secrets_for_log=log_secrets,
                )
                if pace:
                    sleep(pace)
            if uploaded:
                uploaded = _matches_soon(urlopen, url, digest, sleep)
            if not uploaded:
                notes.append(f"[ia-backup] copy check failed {key}")
                print(notes[-1], flush=True)
                failures += 1
                continue
            copied[key] = {"item": new_item, "name": new_name, "digest": digest, "url": url, "slot": slot, "size": len(body)}
            _rewrite_pointer(state, item, name, url, digest, slot)
            notes.append(f"[ia-backup] copied {key}")
            print(notes[-1], flush=True)
    return {"notes": [scrub(line, log_secrets) for line in notes], "failures": failures}


def live_manifest_ready(state: dict, urlopen, origin: str) -> bool:
    """True when the published manifest already points at every copied file."""
    doc = _http_json(origin.rstrip("/") + "/archive/ia-manifest.json", urlopen)
    if not isinstance(doc, dict):
        return False
    live_items = doc.get("items") or {}
    copied = list((state.get("copied") or {}).values())
    slots = {str(row.get("slot") or "") for row in copied if row.get("slot")}
    expected = {
        slot: (state.get("items") or {}).get(slot)
        for slot in slots
        if valid_item_id((state.get("items") or {}).get(slot))
    }
    if not copied or not expected or not all(live_items.get(slot) == ident for slot, ident in expected.items()):
        return False
    live_urls = set()
    for row in doc.get("files") or []:
        if isinstance(row, dict) and row.get("a"):
            live_urls.add(row["a"])
    for url in (doc.get("shards") or {}).values():
        live_urls.add(url)
    return all((row.get("url") or "") in live_urls for row in copied)


def _delete_status(endpoint: str, item: str, name: str, access: str, secret: str, opener, extra=None) -> int:
    if not ITEM_RE.match(item) or not re.fullmatch(r"[A-Za-z0-9._-]{1,180}", name):
        return 0
    url = endpoint.rstrip("/") + "/" + urllib.parse.quote(item) + "/" + urllib.parse.quote(name)
    headers = {"Authorization": f"LOW {access}:{secret}", "User-Agent": UA}
    if extra:
        headers.update(extra)
    request = urllib.request.Request(
        url,
        method="DELETE",
        headers=headers,
    )
    try:
        with opener.open(request, timeout=60) as response:
            return int(getattr(response, "status", 200) or 0)
    except urllib.error.HTTPError as err:
        return int(err.code or 0)
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0


def _delete_object(endpoint: str, item: str, name: str, access: str, secret: str, opener, extra=None) -> bool:
    return _delete_status(endpoint, item, name, access, secret, opener, extra) in {200, 202, 204, 404}


def _patch_metadata(item: str, want: dict, remove: tuple, access: str, secret: str, urlopen, opener, metadata_base: str, sleep=time.sleep) -> tuple[bool, str]:
    doc = _http_json(metadata_base.rstrip("/") + "/" + urllib.parse.quote(item), urlopen) or {}
    current = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    patch = []
    for key, value in want.items():
        if key in current and str(current.get(key)) == str(value):
            continue
        patch.append({"op": "replace" if key in current else "add", "path": "/" + key, "value": value})
    for key in remove:
        if key in current:
            patch.append({"op": "remove", "path": "/" + key})
    if not patch:
        return True, ""
    body = urllib.parse.urlencode({"-target": "metadata", "-patch": json.dumps(patch, separators=(",", ":"))}).encode()
    delay = 5.0
    status = 0
    payload = b""
    for attempt in range(4):
        request = urllib.request.Request(
            metadata_base.rstrip("/") + "/" + urllib.parse.quote(item),
            data=body,
            method="POST",
            headers={
                "Authorization": f"LOW {access}:{secret}",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": UA,
            },
        )
        try:
            with opener.open(request, timeout=60) as response:
                status = getattr(response, "status", 200)
                payload = response.read()
        except urllib.error.HTTPError as err:
            status = err.code
            try:
                payload = err.read() or b""
            except OSError:
                payload = b""
        except (urllib.error.URLError, TimeoutError, OSError):
            status = 0
            payload = b""
        if status in {200, 201, 204} and not (b'"error"' in payload.lower() and b"success" not in payload.lower()):
            return True, ""
        if attempt + 1 < 4 and (status in {0, 429, 503} or b"slowdown" in payload.lower()):
            sleep(delay)
            delay = min(delay * 2, 60)
            continue
        break
    detail = scrub(payload[:120].decode("utf-8", "replace"), [access, secret]).strip()
    return False, f"{status} {detail}".strip()


def _noindex_set(meta: dict) -> bool:
    return str((meta or {}).get("noindex") or "").strip().lower() in {"1", "true", "yes"}


def _item_metadata(item: str, metadata_base: str, urlopen) -> dict:
    doc = _http_json(metadata_base.rstrip("/") + "/" + urllib.parse.quote(item), urlopen) or {}
    current = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
    return current


def _probe_name(item: str) -> str:
    return hashlib.sha256((item + ":noindex").encode("utf-8")).hexdigest()[:20] + ".txt"


def _s3_noindex(endpoint, item, access, secret, opener, urlopen, metadata_base, sleep, secrets_for_log) -> tuple[bool, str, bool]:
    """Try the create-time noindex header on an existing item. The third value is True when IA left noindex unchanged after a successful PUT."""
    if _noindex_set(_item_metadata(item, metadata_base, urlopen)):
        return True, "", False
    name = _probe_name(item)
    headers = {"Content-Type": "text/plain", "x-archive-meta-noindex": "true"}
    status, payload = _s3_once(endpoint, item, name, b"\n", headers, access, secret, opener)
    if status not in {200, 201, 204}:
        detail = scrub(payload[:120].decode("utf-8", "replace"), secrets_for_log).strip()
        _delete_object(endpoint, item, name, access, secret, opener)
        return False, f"s3 {status} {detail}".strip(), False
    delay = 2.0
    seen = False
    for attempt in range(6):
        if _noindex_set(_item_metadata(item, metadata_base, urlopen)):
            seen = True
            break
        if attempt + 1 < 6:
            sleep(delay)
            delay = min(delay * 2, 20)
    if not seen:
        _delete_object(endpoint, item, name, access, secret, opener)
        return False, "noindex unchanged after s3 header", True
    _delete_object(endpoint, item, name, access, secret, opener)
    sleep(1)
    if _noindex_set(_item_metadata(item, metadata_base, urlopen)):
        return True, "", False
    status, payload = _s3_once(endpoint, item, name, b"\n", headers, access, secret, opener)
    if status not in {200, 201, 204}:
        detail = scrub(payload[:120].decode("utf-8", "replace"), secrets_for_log).strip()
        return False, f"s3 {status} {detail}".strip(), False
    sleep(2)
    if _noindex_set(_item_metadata(item, metadata_base, urlopen)):
        return True, "kept-file", False
    _delete_object(endpoint, item, name, access, secret, opener)
    return False, "noindex did not stay", True


def _write_hidden(item: str, title: str, description: str, access: str, secret: str, urlopen, opener, metadata_base: str) -> tuple[bool, str]:
    """noindex is its own write so a rejected blank title cannot drop it."""
    indexed, detail = _patch_metadata(item, {"noindex": "true"}, (), access, secret, urlopen, opener, metadata_base)
    blank, blank_detail = _patch_metadata(item, {"title": title, "description": description}, (), access, secret, urlopen, opener, metadata_base)
    if not blank and title == "":
        blank, blank_detail = _patch_metadata(item, {"title": " ", "description": " "}, (), access, secret, urlopen, opener, metadata_base)
    _patch_metadata(item, {}, ("subject", "creator", "collection"), access, secret, urlopen, opener, metadata_base)
    if indexed and blank:
        return True, ""
    return False, detail or blank_detail


def stamp_items(config: dict, state: dict) -> dict:
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or _opener()
    metadata_base = (config.get("metadata_base") or METADATA_BASE).rstrip("/")
    notes = []
    failures = 0
    seen = []
    for ident in (state.get("items") or {}).values():
        if valid_item_id(ident) and ident not in seen:
            seen.append(ident)
    for ident in seen:
        ok, detail = _write_hidden(
            ident,
            NEUTRAL_TITLE,
            NEUTRAL_DESCRIPTION,
            config["access"],
            config["secret"],
            urlopen,
            opener,
            metadata_base,
        )
        if ok:
            notes.append(f"[ia-backup] stamped {ident}")
        else:
            failures += 1
            notes.append(f"[ia-backup] could not stamp {ident} ({detail})")
    return {"notes": notes, "failures": failures}


def hide_old_items(config: dict, state: dict, sleep=time.sleep) -> dict:
    """Keep the old files, but drop them from search and clear identifying metadata."""
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or _opener()
    metadata_base = (config.get("metadata_base") or METADATA_BASE).rstrip("/")
    endpoint = config.get("endpoint") or S3_ENDPOINT
    access = config["access"]
    secret = config["secret"]
    old_items = list(config["old_items"]) if "old_items" in config else discover_old_items(urlopen)
    notes = []
    failures = 0
    blocked = state.get("noindexBlocked") or {}
    for item in old_items:
        if not old_slot(item):
            continue
        doc = _http_json(metadata_base + "/" + urllib.parse.quote(item), urlopen)
        if not isinstance(doc, dict) or not (doc.get("metadata") or doc.get("files")):
            continue
        if blocked.get(item) == "readonly":
            _write_hidden(item, "", "", access, secret, urlopen, opener, metadata_base)
            notes.append(f"[ia-backup] {item} stays listed; noindex is read-only on an existing item")
            continue
        ok, detail = _write_hidden(item, "", "", access, secret, urlopen, opener, metadata_base)
        s3_detail = ""
        if not ok:
            s3_ok, s3_detail, locked = _s3_noindex(
                endpoint, item, access, secret, opener, urlopen, metadata_base, sleep, [access, secret]
            )
            if s3_ok:
                ok = True
                if s3_detail == "kept-file":
                    notes.append(f"[ia-backup] noindex on {item} stayed only while the header file was present")
            elif locked:
                tries = state.setdefault("noindexTries", {})
                tries[item] = int(tries.get(item) or 0) + 1
                if tries[item] >= 2:
                    state.setdefault("noindexBlocked", {})[item] = "readonly"
        if ok:
            notes.append(f"[ia-backup] hid {item}")
        else:
            failures += 1
            notes.append(f"[ia-backup] could not hide {item} ({detail}; {s3_detail})".rstrip())
    return {"notes": [scrub(line, [access, secret]) for line in notes], "failures": failures}


def retire_old(config: dict, state: dict, sleep=time.sleep) -> dict:
    """Delete guessable files only after the site manifest and the new downloads check out."""
    notes = []
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or _opener()
    origin = config.get("pages_origin") or pages_origin()
    metadata_base = (config.get("metadata_base") or METADATA_BASE).rstrip("/")
    endpoint = config.get("endpoint") or S3_ENDPOINT
    access = config["access"]
    secret = config["secret"]
    pace = float(config.get("pace") if config.get("pace") is not None else 1.5)
    if not live_manifest_ready(state, urlopen, origin):
        notes.append("[ia-backup] old files kept until the site manifest uses the new copies")
        return {"notes": notes, "deleted": 0}
    for prev in (state.get("copied") or {}).values():
        if not _matches(urlopen, prev.get("url") or "", prev.get("digest") or ""):
            notes.append("[ia-backup] not deleting; a new copy failed the download check")
            return {"notes": notes, "deleted": 0}
    if state.get("manifestUrl") and not _matches_soon(urlopen, state.get("manifestUrl") or "", state.get("manifest") or "", sleep):
        notes.append("[ia-backup] not deleting; the manifest copy failed the download check")
        return {"notes": notes, "deleted": 0}
    deleted = 0
    targets = []
    old_items = list(config["old_items"]) if "old_items" in config else discover_old_items(urlopen)
    copied = state.get("copied") or {}
    pending = {(row.get("item"), row.get("name")) for row in (state.get("oldManifestFiles") or [])}
    ready_items = []
    for item in old_items:
        if not old_slot(item):
            continue
        doc = _http_json(metadata_base + "/" + urllib.parse.quote(item), urlopen) or {}
        user = _user_files(doc)
        if not user and not doc.get("files"):
            continue
        missing = [
            name for name in user
            if (item, name) not in pending and (item + "/" + name) not in copied
        ]
        if missing:
            notes.append(f"[ia-backup] keeping {item}; {len(missing)} files are not copied yet")
            continue
        ready_items.append(item)
        for name in user:
            targets.append((item, name))
        for row in doc.get("files") or []:
            name = str((row or {}).get("name") or "")
            if name and (name.endswith(DERIVED_NAMES) or name == "__ia_thumb.jpg"):
                targets.append((item, name))
    seen = set()
    for item, name in targets:
        if not item or not name or (item, name) in seen:
            continue
        seen.add((item, name))
        if _delete_object(endpoint, item, name, access, secret, opener):
            deleted += 1
            notes.append(f"[ia-backup] removed {item}/{name}")
        else:
            notes.append(f"[ia-backup] could not remove {item}/{name}")
        if pace:
            sleep(pace)
    for item in ready_items:
        if (state.get("noindexBlocked") or {}).get(item) == "readonly":
            _write_hidden(item, "", "", access, secret, urlopen, opener, metadata_base)
            notes.append(f"[ia-backup] retired metadata {item}; noindex stays read-only")
            continue
        ok, detail = _write_hidden(item, "", "", access, secret, urlopen, opener, metadata_base)
        notes.append(f"[ia-backup] retired metadata {item}" if ok else f"[ia-backup] could not retire metadata {item} ({detail})")
    return {"notes": [scrub(line, [access, secret]) for line in notes], "deleted": deleted}


def main() -> int:
    keys = _keys()
    if not keys:
        return 0
    access, secret = keys
    archive_dir = ROOT / "archive"
    shards = load_shards(archive_dir) or load_shards_from_data()
    posts = load_posts()
    state = load_state(archive_dir)
    pace = float(os.environ.get("IA_PACE_SECONDS") or "1.5")
    config = {
        "access": access,
        "secret": secret,
        "endpoint": (os.environ.get("IA_S3_ENDPOINT") or S3_ENDPOINT).strip(),
        "download_base": DOWNLOAD_BASE,
        "metadata_base": METADATA_BASE,
        "pages_origin": pages_origin(),
        "pace": pace,
        "backoff": float(os.environ.get("IA_BACKOFF_SECONDS") or "2"),
        "max_uploads": int(os.environ.get("IA_MAX_UPLOADS") or "30"),
        "max_bytes": int(os.environ.get("IA_MAX_BYTES") or str(48 * 1024 * 1024)),
    }
    try:
        moved = migrate_copies(config, state, sleep=time.sleep)
        hidden = hide_old_items(config, state)
        result = run_backup(config, posts, shards, state)
        stamped = stamp_items(config, result["state"])
        retired = retire_old(config, result["state"], sleep=time.sleep)
    except Exception as err:
        print("[ia-backup] backup failed", file=sys.stderr)
        print(scrub(str(err), [access, secret]), file=sys.stderr)
        return 1
    archive_dir.mkdir(parents=True, exist_ok=True)
    manifest = manifest_from_state(result["state"])
    (archive_dir / "ia-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (archive_dir / "ia-state.json").write_text(json.dumps(result["state"], ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for line in moved["notes"] + hidden["notes"] + result["notes"] + stamped["notes"] + retired["notes"]:
        print(line)
    failures = result["failures"] + moved["failures"] + hidden["failures"] + stamped["failures"]
    print(
        f"[ia-backup] uploaded {len(result['uploaded'])} files, "
        f"skipped {result['skipped']}, failures {failures}, "
        f"removed {retired['deleted']}, "
        f"manifest posts {len(manifest.get('posts') or {})}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
