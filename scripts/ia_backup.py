#!/usr/bin/env python3
"""Back up public stubs and media to the Internet Archive.

Shards go to one item per month: superintelapp-YYYY-MM (mediatype data).
Photos and avatars go to superintelapp-img-YYYY-MM (mediatype image).
Videos go to superintelapp-mov-YYYY-MM (mediatype movies).
The browser manifest is superintelapp-manifest/ia-manifest.json.

IA_ACCESS_KEY and IA_SECRET_KEY are the S3 keys. When either is missing this
prints a notice and exits 0. The key values are never printed.

Uploads use the S3-like API (Authorization: LOW). A 503 or SlowDown waits
and retries. A collection the account cannot use is dropped and the file is
sent again without it. Discord posts and any URL that is not a public media
file are left out. Nothing is committed to git.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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
MANIFEST_ITEM = "superintelapp-manifest"
UA = "superintelapp-archive/1.0"
ITEM_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,90}$")
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
    repo = (os.environ.get("GITHUB_REPOSITORY") or "owner-account/SuperintelApp").strip()
    owner, _, name = repo.partition("/")
    if not owner or not name:
        owner, name = "owner-account", "SuperintelApp"
    return f"https://{owner.lower()}.github.io/{name}/"


def stub_item(month: str) -> str:
    return f"superintelapp-{month}"


def image_item(month: str) -> str:
    return f"superintelapp-img-{month}"


def movie_item(month: str) -> str:
    return f"superintelapp-mov-{month}"


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


def upload_bytes(endpoint, item, name, body, *, content_type, mediatype, collection, title, access, secret, opener, sleep, backoff, rejected, notes, secrets) -> bool:
    headers = {
        "Content-Type": content_type,
        "x-archive-meta-mediatype": mediatype,
        "x-archive-meta-creator": "owner-account",
        "x-archive-meta-title": title,
        "x-archive-meta-description": "Public backup for SuperintelApp. Discord and private sources are excluded.",
    }
    if collection and item not in rejected:
        headers["x-archive-meta-collection"] = collection
    delay = backoff
    for attempt in range(4):
        status, payload = _s3_once(endpoint, item, name, body, headers, access, secret, opener)
        lowered = payload.lower()
        if status in {200, 201, 204}:
            return True
        if status == 400 and b"collection" in lowered and "x-archive-meta-collection" in headers:
            rejected.add(item)
            headers.pop("x-archive-meta-collection", None)
            notes.append(f"[ia-backup] {item} does not accept a collection; retrying without one")
            continue
        if status == 503 or b"slowdown" in lowered:
            notes.append(f"[ia-backup] {item}/{name} asked to slow down; waiting")
            sleep(delay)
            delay = min(delay * 3, 120)
            continue
        detail = scrub(payload[:160].decode("utf-8", "replace"), secrets)
        notes.append(f"[ia-backup] {item}/{name} failed ({status}) {detail}".rstrip())
        if attempt + 1 < 4 and status >= 500:
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
    return {"v": 1, "files": files, "posts": posts}


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
    rejected = set(config.get("rejected") or [])
    uploaded = []
    failures = 0
    skipped = 0
    pace = float(config.get("pace") if config.get("pace") is not None else 1.5)
    backoff = float(config.get("backoff") if config.get("backoff") is not None else 2)
    limit = int(config.get("max_bytes") or 48 * 1024 * 1024)
    max_uploads = int(config.get("max_uploads") or 30)

    def put(item, name, body, content_type, mediatype, collection, counts=True):
        nonlocal failures
        ok = upload_bytes(
            endpoint,
            item,
            name,
            body,
            content_type=content_type,
            mediatype=mediatype,
            collection=collection,
            title=item,
            access=config["access"],
            secret=config["secret"],
            opener=opener,
            sleep=sleep,
            backoff=backoff,
            rejected=rejected,
            notes=notes,
            secrets=secrets,
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
        item = stub_item(month)
        name = month + ".json"
        if put(item, name, body, "application/json", "data", "opensource"):
            state["shards"][month] = digest
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
        item = movie_item(month) if media_kind == "video" else image_item(month)
        mediatype = "movies" if media_kind == "video" else "image"
        collection = "opensource_media"
        name = digest[:20] + ext
        if not put(item, name, body, content_type, mediatype, collection):
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

    manifest = manifest_from_state(state)
    manifest_body = (json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    manifest_sha = hashlib.sha256(manifest_body).hexdigest()
    if state.get("manifest") != manifest_sha and manifest["files"]:
        if put(MANIFEST_ITEM, "ia-manifest.json", manifest_body, "application/json", "data", "opensource"):
            state["manifest"] = manifest_sha
            notes.append(f"[ia-backup] manifest {MANIFEST_ITEM}/ia-manifest.json")
    index_body = (json.dumps({"shards": [name for name in state["shards"] if MONTH_RE.match(name)]}, separators=(",", ":")) + "\n").encode("utf-8")
    index_sha = hashlib.sha256(index_body).hexdigest()
    if state["shards"] and state.get("index") != index_sha:
        if put(MANIFEST_ITEM, "index.json", index_body, "application/json", "data", "opensource", counts=False):
            state["index"] = index_sha
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
    try:
        result = run_backup(
            {
                "access": access,
                "secret": secret,
                "endpoint": (os.environ.get("IA_S3_ENDPOINT") or S3_ENDPOINT).strip(),
                "download_base": DOWNLOAD_BASE,
                "pace": pace,
                "backoff": float(os.environ.get("IA_BACKOFF_SECONDS") or "2"),
                "max_uploads": int(os.environ.get("IA_MAX_UPLOADS") or "30"),
                "max_bytes": int(os.environ.get("IA_MAX_BYTES") or str(48 * 1024 * 1024)),
            },
            posts,
            shards,
            state,
        )
    except Exception as err:
        print("[ia-backup] backup failed", file=sys.stderr)
        print(scrub(str(err), [access, secret]), file=sys.stderr)
        return 1
    archive_dir.mkdir(parents=True, exist_ok=True)
    manifest = result["manifest"]
    (archive_dir / "ia-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (archive_dir / "ia-state.json").write_text(json.dumps(result["state"], ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for line in result["notes"]:
        print(line)
    print(
        f"[ia-backup] uploaded {len(result['uploaded'])} files, "
        f"skipped {result['skipped']}, failures {result['failures']}, "
        f"manifest posts {len(manifest.get('posts') or {})}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
