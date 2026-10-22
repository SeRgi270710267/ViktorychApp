#!/usr/bin/env python3
"""Download new public posts from added accounts and store the original files on Telegram.

Added accounts are the profiles in feeds.config.json (cuentas añadidas,
добавленные аккаунты). The GitHub Actions workflow runs this on a schedule.
It does not use cookies, a captcha solver, a WAF bypass, or anything that
would add views. A 403 or a captcha skips that added account and the run
continues. TikTok lives are not recorded.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import telegram_backup as tb  # noqa: E402
from tiktok_sync import TRACKED  # noqa: E402

EXTRACT = ("tiktok", "instagram", "x", "youtube", "vk", "facebook", "threads")
ARCHIVE_KEY = "backup/media-archive.txt"
GALLERY_KEY = "backup/gallery-archive.sqlite"
CATALOG_KEY = "backup/tiktok-catalog.json"
CURSOR_KEY = "backup/media-cursor.txt"
LINKS_KEY = "backup/media-links.json"
HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{1,40}$")
CHANNEL_RE = re.compile(r"^UC[A-Za-z0-9_-]{20,}$")
SEC_RE = re.compile(r"^[A-Za-z0-9_-]{8,160}$")
USER_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def log(message: str) -> None:
    tb.log(message)


def cap_of() -> int:
    try:
        value = int(os.environ.get("MEDIA_EXTRACT_CAP") or "8")
    except ValueError:
        value = 8
    return max(1, min(value, 30))


def per_account() -> int:
    try:
        value = int(os.environ.get("MEDIA_EXTRACT_PER") or "2")
    except ValueError:
        value = 2
    return max(1, min(value, 8))


def pace_seconds() -> float:
    try:
        value = float(os.environ.get("MEDIA_EXTRACT_PACE") or "8")
    except ValueError:
        value = 8.0
    return min(max(value, 3.0), 60.0)


def account_url(platform: str, handle: str, channel_id: str = "") -> str:
    if platform == "tiktok":
        return "https://www.tiktok.com/@" + handle
    if platform == "instagram":
        return "https://www.instagram.com/" + handle + "/"
    if platform == "x":
        return "https://x.com/" + handle
    if platform == "youtube" and CHANNEL_RE.fullmatch(channel_id or ""):
        return "https://www.youtube.com/channel/" + channel_id + "/videos"
    if platform == "youtube":
        return "https://www.youtube.com/@" + handle + "/videos"
    if platform == "vk":
        return "https://vk.com/" + handle
    if platform == "facebook":
        return "https://www.facebook.com/" + handle
    if platform == "threads":
        return "https://www.threads.net/@" + handle
    return ""


def accounts_from(config: dict, tiktok_handles: list, accounts_doc: dict | None = None) -> list:
    """Private added TikTok rows, config rows, then the fallback handles."""
    from account_identity import tiktok_accounts

    rows = []
    seen = set()
    for source in tiktok_accounts(config, tiktok_handles, accounts_doc):
        key = ("tiktok", source["handle"].lower())
        if key in seen:
            continue
        seen.add(key)
        for item in source.get("previousHandles") or []:
            seen.add(("tiktok", str(item).lower()))
        rows.append(source)
    for feed in (config or {}).get("feeds") or []:
        if not isinstance(feed, dict):
            continue
        platform = str(feed.get("platform") or "").lower()
        handle = str(feed.get("handle") or "").lstrip("@")
        if platform not in EXTRACT or not HANDLE_RE.fullmatch(handle):
            continue
        key = (platform, handle.lower())
        if key in seen:
            continue
        url = account_url(platform, handle, str(feed.get("channelId") or feed.get("permanentId") or ""))
        if not tb.page_host_ok(url):
            continue
        seen.add(key)
        row = {"platform": platform, "handle": handle, "url": url}
        if feed.get("permanentId"):
            row["permanentId"] = str(feed.get("permanentId"))
        if feed.get("secUid"):
            row["secUid"] = str(feed.get("secUid"))
        if feed.get("previousHandles"):
            row["previousHandles"] = list(feed.get("previousHandles") or [])
        rows.append(row)
    return rows


def rotate(accounts: list, start: int) -> list:
    if not accounts:
        return []
    index = start % len(accounts)
    return accounts[index:] + accounts[:index]


def video_args(page: str, dest: Path, archive: Path, selector: str, limit: int) -> list:
    return [
        "--ignore-config",
        "--no-cookies",
        "--no-cookies-from-browser",
        "--no-warnings",
        "--no-progress",
        "--retries", "1",
        "--fragment-retries", "1",
        "--socket-timeout", "30",
        "--sleep-requests", "2",
        "--sleep-interval", "5",
        "--max-sleep-interval", "8",
        "--match-filters", "!is_live",
        "--download-archive", str(archive),
        "--max-downloads", str(limit),
        "--playlist-end", "8",
        "-f", selector,
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
        "--write-info-json",
        "--write-thumbnail",
        "-o", str(dest / "%(id)s.%(ext)s"),
        page,
    ]


def photo_args(page: str, dest: Path, archive: Path, limit: int) -> list:
    return [
        "--config-ignore",
        "--no-input",
        "--sleep", "5",
        "--sleep-request", "2",
        "--download-archive", str(archive),
        "--range", "1-%s" % max(1, limit),
        "-D", str(dest),
        "--write-metadata",
        "--filename", "{num}.{extension}",
        page,
    ]


def remember_tiktok(catalog: dict, info: dict) -> dict:
    """Index a TikTok author by user_id and by sec_uid."""
    catalog = catalog if isinstance(catalog, dict) else {}
    user_id = str((info or {}).get("uploader_id") or "")
    sec_uid = str((info or {}).get("channel_id") or "")
    unique = str((info or {}).get("uploader") or (info or {}).get("channel") or "")
    if not USER_RE.fullmatch(user_id):
        user_id = ""
    if not SEC_RE.fullmatch(sec_uid):
        sec_uid = ""
    if not user_id and not sec_uid:
        return catalog
    row = {"user_id": user_id, "sec_uid": sec_uid, "unique_id": unique[:80]}
    if user_id:
        catalog.setdefault("by_user_id", {})[user_id] = row
    if sec_uid:
        catalog.setdefault("by_sec_uid", {})[sec_uid] = row
    return catalog


def ident_of(platform: str, info: dict) -> str:
    page = str((info or {}).get("webpage_url") or "").split("?", 1)[0]
    raw = str((info or {}).get("id") or "")
    if platform == "instagram":
        match = re.search(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]{1,80})", page)
        if match:
            return match.group(1)
    if platform == "youtube" and re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        return raw
    if platform == "threads":
        match = re.search(r"threads\.(?:com|net)/(?:@[^/]+/)?(?:post|t)/([A-Za-z0-9_-]{1,80})", page)
        if match:
            return match.group(1)
    return raw if tb.IDENT_RE.fullmatch(raw) else ""


def read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}
    return data if isinstance(data, dict) else {}


def r2_text(cf: dict, bucket: str, key: str, dest: Path) -> str:
    try:
        tb.download_object(cf["token"], cf["account"], bucket, key, dest)
        return dest.read_text(encoding="utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError, RuntimeError, UnicodeError):
        return ""


def r2_json(cf: dict, bucket: str, key: str, dest: Path) -> dict:
    text = r2_text(cf, bucket, key, dest)
    try:
        data = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def put_text(cf: dict, bucket: str, key: str, text: str) -> None:
    tb.put_bytes(cf["token"], cf["account"], bucket, key, text.encode("utf-8"), "text/plain; charset=utf-8")


def put_file(cf: dict, bucket: str, key: str, path: Path) -> None:
    if path.is_file() and path.stat().st_size > 0:
        tb.put_bytes(cf["token"], cf["account"], bucket, key, path.read_bytes(), "application/octet-stream")


def text_file(path: Path) -> str:
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def fetch_bytes(cf: dict, bucket: str, key: str, dest: Path) -> None:
    try:
        tb.download_object(cf["token"], cf["account"], bucket, key, dest)
    except (urllib.error.URLError, TimeoutError, OSError, RuntimeError):
        if dest.exists():
            dest.unlink()


def put_json(cf: dict, bucket: str, key: str, data: dict) -> None:
    payload = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    tb.put_bytes(cf["token"], cf["account"], bucket, key, payload, "application/json")


def open_destination(directory: Path):
    cf = tb.prepare_clients()
    if cf is None or cf.get("error"):
        return None
    bot = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    channel = (os.environ.get("TELEGRAM_CHANNEL_ID") or "").strip()
    buckets = tb.bucket_names(cf["token"], cf["account"])
    manifest, manifest_bucket = tb.load_remote_manifest(cf["token"], cf["account"], buckets, directory)
    if not manifest_bucket:
        log("[media-extract] no R2 bucket is visible")
        return None
    database = ""
    worker = ""
    try:
        database = tb.d1_id(cf["token"], cf["account"])
        tb.d1_exec(cf["token"], cf["account"], database, tb.D1_CREATE, [])
    except Exception as err:
        log("[media-extract] D1 is not ready; files will not be served until it is")
        log(tb.scrub(str(err), tb.current_secrets()))
        database = ""
    if database:
        try:
            worker = tb.worker_api(cf["token"], cf["account"])
        except Exception:
            worker = ""
    cf.update({
        "bot": bot,
        "channel": channel,
        "database": database,
        "worker": worker,
        "manifest_bucket": manifest_bucket,
        "loop_version": "",
        "blocked_keys": set(),
    })
    return cf, manifest


def selector_for(platform: str) -> str:
    if platform == "tiktok":
        return tb.TIKTOK_FALLBACK
    return tb.YTDLP_FORMAT


def tiktok_download_selector(formats) -> str:
    """Top HEVC or bytevc1 format id. The h264 string is only the fallback."""
    return tb.tiktok_selector(formats or []) or tb.TIKTOK_FALLBACK


def list_tiktok_entries(ytdlp: list, page: str, limit: int) -> tuple:
    cmd = ytdlp + [
        "--ignore-config",
        "--no-cookies",
        "--no-cookies-from-browser",
        "--no-warnings",
        "--no-progress",
        "--no-flat-playlist",
        "-J",
        "--skip-download",
        "--playlist-end", str(max(1, limit)),
        "--socket-timeout", "30",
        page,
    ]
    return run_tool(cmd, 180)


def download_tiktok(ytdlp: list, account: dict, work: Path, archive: Path, limit: int) -> tuple:
    """One public video at a time, using the top original format id."""
    _code, out, err = list_tiktok_entries(ytdlp, account["url"], limit)
    text = out + "\n" + err
    if tb.runner_blocked(text):
        return "blocked", text
    info = {}
    try:
        parsed = json.loads(out) if out.strip() else {}
    except json.JSONDecodeError:
        parsed = {}
    if isinstance(parsed, dict):
        info = parsed
    entries = info.get("entries") if isinstance(info.get("entries"), list) else None
    if not entries and info.get("id"):
        entries = [info]
    if not entries:
        _code, out, err = run_tool(ytdlp + video_args(account["url"], work, archive, selector_for("tiktok"), limit), 600)
        text = out + "\n" + err
        return ("blocked" if tb.runner_blocked(text) else "ok"), text
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        page = str(entry.get("webpage_url") or "")
        if "tiktok.com" not in page:
            page = str(entry.get("url") or "")
        if "tiktok.com" not in page:
            continue
        selector = tiktok_download_selector(entry.get("formats") or [])
        args = video_args(page, work, archive, selector, 1)
        args.insert(1, "--no-playlist")
        _code, out, err = run_tool(ytdlp + args, 600)
        text = out + "\n" + err
        if tb.runner_blocked(text):
            return "blocked", text
    return "ok", ""


def publish_file(path: Path, key: str, role: str, info: dict, cf: dict, manifest: dict, state: dict, directory: Path) -> str:
    if not key or not path.is_file() or path.stat().st_size <= 0:
        return "skip"
    probe = tb.probe_saved(path)
    tb.log_probe(key, probe)
    size = path.stat().st_size
    if role != "video" and size > tb.public_bytes():
        log("[media-extract] skipped_too_big %s %s" % (key, size))
        return "skip"
    content = "video/mp4" if role == "video" else tb.sniff_type(path, "")
    kind = "hls" if role == "video" and size > tb.public_bytes() else "small"
    obj = {
        "bucket": "cdn",
        "key": key,
        "size": size,
        "etag": tb.hash_file(path),
        "content_type": content,
        "role": role,
        "info": info,
        "probe": probe,
    }
    return tb.store_loaded(path, obj, kind, manifest, cf, state, directory, obj["etag"], copy_only=role == "video")


def video_posts(work: Path, account: dict, catalog: dict) -> list:
    found = []
    for path in sorted(work.glob("*.mp4")):
        info = read_json(path.with_name(path.stem + ".info.json"))
        if info.get("is_live") or str(info.get("live_status") or "") in {"is_live", "is_upcoming"}:
            log("[media-extract] skipped_live %s/%s" % (account["platform"], account["handle"]))
            continue
        if account["platform"] == "tiktok":
            remember_tiktok(catalog, info)
        ident = ident_of(account["platform"], info)
        post = {
            "platform": account["platform"],
            "handle": account["handle"],
            "statusId": ident,
            "id": account["platform"] + ":" + ident,
            "url": account["url"],
        }
        if account.get("permanentId"):
            post["permanentId"] = account.get("permanentId")
        if account.get("previousHandles"):
            post["previousHandles"] = list(account.get("previousHandles") or [])
        key = tb.social_object_key(post, "video", 0)
        stats = tb.info_fields(info)
        thumbs = [item for item in work.glob(path.stem + ".*") if item.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        found.append({"video": path, "key": key, "post": post, "stats": stats, "thumb": thumbs[0] if thumbs else None})
    return found


def photo_groups(work: Path, account: dict) -> list:
    images = [
        path for path in work.rglob("*")
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    ]
    groups = {}
    order = []
    for path in sorted(images, key=lambda item: str(item)):
        meta = read_json(path.with_name(path.name + ".json"))
        if not meta:
            meta = read_json(path.with_suffix(".json"))
        ident = ident_of(account["platform"], meta) or str(meta.get("post_id") or meta.get("shortcode") or meta.get("tweet_id") or "")
        if not tb.IDENT_RE.fullmatch(ident):
            log("[media-extract] skipped_photo %s/%s" % (account["platform"], account["handle"]))
            continue
        if ident not in groups:
            groups[ident] = []
            order.append(ident)
        groups[ident].append((path, tb.info_fields(meta)))
    rows = []
    for ident in order:
        post = {
            "platform": account["platform"],
            "handle": account["handle"],
            "statusId": ident,
            "id": account["platform"] + ":" + ident,
            "url": account["url"],
        }
        if account.get("permanentId"):
            post["permanentId"] = account.get("permanentId")
        if account.get("previousHandles"):
            post["previousHandles"] = list(account.get("previousHandles") or [])
        for index, (path, stats) in enumerate(groups[ident]):
            rows.append({"path": path, "key": tb.social_object_key(post, "photo", index), "stats": stats, "post": post, "index": index})
    return rows


def run_tool(cmd: list, timeout: int) -> tuple:
    code, out, err = tb.run_captured(cmd, timeout)
    return code, out, err


def photos_allowed(video_status: str) -> bool:
    """A blocked video does not skip photos. The next run retries the video."""
    del video_status
    return True


def catalog_queue(items: list) -> list:
    """Newest synced posts first. A Telegram channel is not extracted."""
    rows = [item for item in items if str((item or {}).get("platform") or "") not in {"telegram", "rss"}]
    rows.sort(key=lambda item: str((item or {}).get("posted") or ""), reverse=True)
    return rows


def store_catalog(cf, manifest, state, directory, links, limit, stored, pause) -> int:
    """Upload public originals for posts the sync already stored. Blocked items are retried later."""
    present = set()
    for row in (manifest.get("files") or []):
        if isinstance(row, dict) and row.get("key"):
            present.add(row["key"])
    for row in links or []:
        if isinstance(row, dict) and row.get("key"):
            present.add(row["key"])
    docs = tb.social_catalogs(cf, directory, tb.bucket_names(cf["token"], cf["account"]))
    items = catalog_queue(tb.plan_social(docs, present))
    log("[media-extract] catalog %s pending" % len(items))
    attempted = False
    for item in items:
        if stored >= limit:
            log("[media-extract] reached the run cap")
            return stored
        prior = tb.find_entry(manifest, item.get("bucket") or "cdn", item.get("key") or "")
        if prior and prior.get("verified") and (prior.get("parts") or []):
            continue
        if attempted and pause:
            time.sleep(pause)
        attempted = True
        before = int(state.get("files") or 0)
        result = tb.process_cdn(item, manifest, cf, state, directory)
        if result == "stop":
            log("[media-extract] reached the run cap")
            return limit
        if result == "ok" and int(state.get("files") or 0) > before:
            stored += 1
            links.append({
                "key": item.get("key") or "",
                "platform": item.get("platform") or "",
                "handle": "",
                "id": "",
                "stats": item.get("info") or {},
            })
            log("[media-extract] linked %s" % item.get("key"))
    return stored


def extract() -> int:
    config_path = ROOT / "feeds.config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.is_file() else {}
    except json.JSONDecodeError:
        config = {}
    from tiktok_sync import load_added_accounts

    try:
        accounts_doc = load_added_accounts()
    except Exception:
        accounts_doc = {"added": [], "removed": []}
    accounts = accounts_from(config if isinstance(config, dict) else {}, list(TRACKED), accounts_doc)
    if not accounts:
        log("[media-extract] no added accounts")
        return 0
    ytdlp = tb.tool_cmd("yt_dlp", "yt-dlp")
    gallery = tb.tool_cmd("gallery_dl", "gallery-dl")
    if not ytdlp or not gallery:
        log("[media-extract] yt-dlp or gallery-dl is not installed")
        return 1
    directory = Path(tempfile.mkdtemp(prefix="media-extract-"))
    try:
        opened = open_destination(directory)
        if opened is None:
            return 0
        cf, manifest = opened
        bucket = cf["manifest_bucket"]
        archive = directory / "archive.txt"
        photos = directory / "gallery-archive.sqlite"
        archive.write_text(r2_text(cf, bucket, ARCHIVE_KEY, directory / "remote-archive.txt"), encoding="utf-8")
        fetch_bytes(cf, bucket, GALLERY_KEY, photos)
        catalog = r2_json(cf, bucket, CATALOG_KEY, directory / "remote-catalog.json")
        links_doc = r2_json(cf, bucket, LINKS_KEY, directory / "remote-links.json")
        links = [row for row in (links_doc.get("items") or []) if isinstance(row, dict) and row.get("key")]
        try:
            start = int((r2_text(cf, bucket, CURSOR_KEY, directory / "remote-cursor.txt") or "0").strip() or "0")
        except ValueError:
            start = 0
        state = tb.new_entry_state()
        limit = cap_of()
        each = per_account()
        pause = pace_seconds()
        visited = 0
        stored = store_catalog(cf, manifest, state, directory, links, limit, 0, pause)
        for offset, account in enumerate(rotate(accounts, start)):
            if stored >= limit:
                break
            visited += 1
            if offset:
                time.sleep(pause)
            room = min(each, limit - stored)
            work = directory / ("a-%s" % offset)
            if work.exists():
                shutil.rmtree(work, ignore_errors=True)
            work.mkdir(parents=True)
            log("[media-extract] added account %s %s" % (account["platform"], account["handle"]))
            if account["platform"] == "tiktok":
                status, text = download_tiktok(ytdlp, account, work, archive, room)
            else:
                _code, out, err = run_tool(ytdlp + video_args(account["url"], work, archive, selector_for(account["platform"]), room), 600)
                text = out + "\n" + err
                status = "blocked" if tb.runner_blocked(text) else "ok"
            videos_blocked = status == "blocked"
            if videos_blocked:
                log("[media-extract] skipped_blocked %s/%s" % (account["platform"], account["handle"]))
            present = set()
            for row in (manifest.get("files") or []):
                if isinstance(row, dict) and row.get("key"):
                    present.add(row["key"])
            for row in links:
                if row.get("key"):
                    present.add(row["key"])
            gained = stored
            if not videos_blocked:
                for item in video_posts(work, account, catalog):
                    if stored >= limit:
                        break
                    candidates = tb.social_key_candidates(item["post"], "video", 0)
                    if any(key in present for key in candidates):
                        log("[media-extract] already stored %s/%s" % (account["platform"], account["handle"]))
                        continue
                    item["key"] = candidates[0] if candidates else item["key"]
                    result = publish_file(item["video"], item["key"], "video", item["stats"], cf, manifest, state, directory)
                    if result == "stop":
                        log("[media-extract] reached the run cap")
                        stored = limit
                        break
                    if result == "ok":
                        stored += 1
                        links.append({"key": item["key"], "platform": account["platform"], "handle": account["handle"], "id": item["post"].get("statusId") or "", "probe": tb.probe_saved(item["video"]), "stats": item["stats"]})
                        log("[media-extract] linked %s" % item["key"])
                    if item["thumb"] and result == "ok":
                        role = "poster" if account["platform"] == "tiktok" else "thumb"
                        thumb_keys = tb.social_key_candidates(item["post"], role, 0)
                        if not any(key in present for key in thumb_keys):
                            thumb_key = thumb_keys[0] if thumb_keys else tb.social_object_key(item["post"], role, 0)
                            publish_file(item["thumb"], thumb_key, role, item["stats"], cf, manifest, state, directory)
            photo_dir = work / "photos"
            photo_dir.mkdir(parents=True)
            if photos_allowed(status) and account["platform"] != "youtube" and stored < limit:
                _code, out, err = run_tool(gallery + photo_args(account["url"], photo_dir, photos, min(each, limit - stored)), 300)
                if tb.runner_blocked(out + "\n" + err):
                    log("[media-extract] skipped_blocked %s/%s" % (account["platform"], account["handle"]))
                else:
                    for item in photo_groups(photo_dir, account):
                        if stored >= limit:
                            break
                        photo_keys = tb.social_key_candidates(item["post"], "photo", int(item.get("index") or 0))
                        if any(key in present for key in photo_keys):
                            log("[media-extract] already stored %s/%s" % (account["platform"], account["handle"]))
                            continue
                        item["key"] = photo_keys[0] if photo_keys else item["key"]
                        result = publish_file(item["path"], item["key"], "photo", item["stats"], cf, manifest, state, directory)
                        if result == "stop":
                            stored = limit
                            break
                        if result == "ok":
                            stored += 1
                            links.append({"key": item["key"], "platform": account["platform"], "handle": account["handle"], "id": item["post"].get("statusId") or "", "stats": item["stats"]})
                            log("[media-extract] linked %s" % item["key"])
            if stored == gained and not videos_blocked:
                log("[media-extract] no file %s/%s" % (account["platform"], account["handle"]))
            shutil.rmtree(work, ignore_errors=True)
            put_text(cf, bucket, ARCHIVE_KEY, text_file(archive))
            put_file(cf, bucket, GALLERY_KEY, photos)
            put_json(cf, bucket, CATALOG_KEY, catalog)
        by_key = {}
        for row in links:
            if row.get("key"):
                by_key[row["key"]] = row
        put_json(cf, bucket, LINKS_KEY, {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "items": list(by_key.values())})
        put_text(cf, bucket, CURSOR_KEY, str((start + visited) % max(len(accounts), 1)))
        log("[media-extract] stored %s files, visited %s added accounts" % (stored, visited))
        log(tb.upload_summary(state))
        tb.log_d1_newest(cf)
        return 0
    except Exception as err:
        log("[media-extract] extract failed")
        log(tb.scrub(str(err), tb.current_secrets()))
        return 1
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def selftest() -> int:
    def check(cond, message):
        if not cond:
            raise SystemExit("FAIL: " + message)
        print("ok", message)

    rows = accounts_from({
        "feeds": [
            {"platform": "youtube", "handle": "redacted_handle", "channelId": "UCfgtuaUadGgOA-91geQ8Qog"},
            {"platform": "telegram", "handle": "telegram"},
            {"platform": "x", "handle": "redacted_handle"},
            {"platform": "instagram", "handle": "redacted_handle"},
        ]
    }, ["gabii_g5"])
    urls = {row["url"] for row in rows}
    check("https://www.tiktok.com/@gabii_g5" in urls, "TikTok is included with the added accounts")
    check("https://www.youtube.com/channel/UCfgtuaUadGgOA-91geQ8Qog/videos" in urls, "YouTube uses the public channel videos page")
    check("https://x.com/redacted_handle" in urls and "https://www.instagram.com/redacted_handle/" in urls, "X and Instagram use the public profile")
    check(all("t.me" not in row["url"] for row in rows), "a Telegram channel is not extracted")
    turned = rotate([{"handle": "a"}, {"handle": "b"}, {"handle": "c"}], 1)
    check([row["handle"] for row in turned] == ["b", "c", "a"], "added accounts rotate so a later run reaches the rest")
    args = video_args("https://www.youtube.com/watch?v=xtrFOsncOeo", Path("out"), Path("archive.txt"), tb.YTDLP_FORMAT, 2)
    check(args[args.index("-f") + 1] == "bv*+ba/b" and args[args.index("--merge-output-format") + 1] == "mp4" and args[args.index("--remux-video") + 1] == "mp4", "videos are remuxed with bv*+ba/b")
    check("--write-info-json" in args and "--write-thumbnail" in args and "--download-archive" in args and str(Path("archive.txt")) in args, "the video command writes info, a thumbnail, and archive.txt")
    check("--no-cookies" in args and "--cookies" not in args and "--cookies-from-browser" not in args, "the video command sends no cookies")
    check(selector_for("tiktok").endswith("/bv*+ba/b") and "bytevc1" in selector_for("tiktok"), "TikTok prefers bytevc1 or h265, then bv*+ba/b")
    formats = [
        {"format_id": "h264-1080", "vcodec": "h264", "acodec": "none", "height": 1080, "tbr": 2500},
        {"format_id": "bytevc1-720", "vcodec": "bytevc1", "acodec": "none", "height": 720, "tbr": 4000},
        {"format_id": "audio", "vcodec": "none", "acodec": "aac", "tbr": 128},
    ]
    picked = tiktok_download_selector(formats)
    check(picked.startswith("bytevc1-720+") and "h264" not in picked.split("/")[0], "TikTok takes the top original bytevc1, not the h264 fallback")
    check("--recode-video" not in video_args("https://www.tiktok.com/@gabii_g5/video/1", Path("out"), Path("archive.txt"), picked, 1), "TikTok is remuxed and not re-encoded")
    private = accounts_from({}, ["gabii_g5"], {"added": [{"handle": "new_name", "permanentId": "123456"}], "removed": ["gabii_g5"]})
    private_urls = {row["url"] for row in private}
    check("https://www.tiktok.com/@new_name" in private_urls and "https://www.tiktok.com/@gabii_g5" not in private_urls, "a removed account stays out and a private added account is included")
    photos = photo_args("https://www.instagram.com/redacted_handle/", Path("photos"), Path("gallery.txt"), 2)
    check("--write-metadata" in photos and "--download-archive" in photos and "--cookies" not in photos and "--config-ignore" in photos, "gallery-dl writes metadata and records the archive")
    catalog = remember_tiktok({}, {"uploader_id": "99", "channel_id": "MS4wLjABAAAA12345678", "uploader": "gabii_g5"})
    check(catalog["by_user_id"]["99"]["sec_uid"] == "MS4wLjABAAAA12345678" and catalog["by_sec_uid"]["MS4wLjABAAAA12345678"]["user_id"] == "99", "the TikTok catalog is keyed by user_id and sec_uid")
    check(ident_of("instagram", {"id": "123", "webpage_url": "https://www.instagram.com/reel/DeZgzTEggQe/"}) == "DeZgzTEggQe", "an Instagram shortcode is the object id")
    check(cap_of() >= 1 and per_account() >= 1 and pace_seconds() >= 3, "the run has a cap and a pause")
    check(tb.runner_blocked("HTTP Error 403: Forbidden") and tb.runner_blocked("captcha") and not tb.runner_blocked("private account"), "a 403 or captcha is a skip")
    workflow = (ROOT / ".github" / "workflows" / "media-extract.yml").read_text(encoding="utf-8")
    check('cron: "17 */3 * * *"' in workflow and 'cron: "*/30 * * * *"' in workflow and "workflow_dispatch" in workflow and "yt-dlp==2026.10.21" in workflow and "gallery-dl==1.32.17" in workflow, "the workflow is scheduled every 3 hours and pins the tools")
    check("cancel-in-progress: false" in workflow, "an upload that is already running is not cancelled")
    check(photos_allowed("blocked") is True, "a blocked video does not skip photos")
    queued = catalog_queue([
        {"platform": "x", "posted": "2026-10-22T16:00:00Z", "key": "old"},
        {"platform": "telegram", "posted": "2026-10-22T23:00:00Z", "key": "tg"},
        {"platform": "x", "posted": "2026-10-22T22:54:26.000Z", "key": "new"},
        {"platform": "tiktok", "posted": "2026-10-22T18:00:00Z", "key": "tt"},
    ])
    check([row["key"] for row in queued] == ["new", "tt", "old"], "newest synced posts are first and a Telegram channel is not extracted")
    check('echo "$TELEGRAM' not in workflow and "IG_SESSION" not in workflow and "--cookies" not in workflow and "COOKIES" not in workflow, "the workflow does not print secrets or pass cookies")
    doc = (ROOT / "docs" / "telegram-backup.md").read_text(encoding="utf-8")
    check("archive.txt" in doc and "user_id" in doc and "sec_uid" in doc and "17 */3 * * *" in doc, "the docs describe the archive, the catalog, and the schedule")
    check("added account" in doc and "tracked account" not in doc and "name: Extract added accounts" in workflow, "added accounts is the name for profiles in feeds.config.json")
    source = Path(__file__).read_text(encoding="utf-8")
    check(("photos" + ".read_text(") not in source and "gallery-archive.sqlite" in source and "load_added_accounts" in source, "the gallery-dl archive is a sqlite file, and TikTok reads the owner list")
    sample = Path("gallery-sample.sqlite")
    try:
        blob = b"SQLite format 3\x00" + bytes(range(83)) + b"\x89"
        sample.write_bytes(blob)
        check(sample.read_bytes()[99:100] == b"\x89" and text_file(sample).startswith("SQLite"), "a sqlite archive survives a binary byte")
    finally:
        sample.unlink(missing_ok=True)
    print("media extract selftest ok")
    return 0


def main(argv: list | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        return selftest()
    return extract()


if __name__ == "__main__":
    sys.exit(main())
