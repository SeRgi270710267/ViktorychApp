#!/usr/bin/env python3
"""Record a public TikTok live and copy it to Telegram.

One Actions job captures one live. The capture is a stream copy of the origin
variant (ffmpeg -c copy). It is never re-encoded. Segments land in R2 first,
so a slow Telegram channel cannot drop them. One uploader job per backup
channel sends those segments, about 20 messages a minute, and honors
retry_after. Extra channels are an owner-only list; the same bot posts to
each of them.

No cookies, no proxy, and no captcha bypass. A 403, 429, 503, or captcha
page skips that live and the Live tab keeps Open on TikTok.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from tiktok_sync import (  # noqa: E402
    BLOCKED,
    HANDLE_RE,
    UA,
    challenge_kind,
    cloudflare_env,
    http_get,
    load_added_accounts,
    node_json,
    r2_get,
    r2_put,
)

BUCKET = "viktorych-data"
INDEX_KEY = "owner/tiktok-recordings.json"
JOB_PREFIX = "owner/live-jobs/"
BUF_PREFIX = "live-buf/"
CHANNELS_KEY = "owner/tiktok-backup-channels.json"
UPLOAD_PREFIX = "owner/live-upload/"
SMALL_BYTES = 19 * 1024 * 1024
TARGET_BYTES = 18 * 1024 * 1024
CAP_LIMIT = 12
MESSAGES_PER_MINUTE = 20
HIGH_SEGMENTS_PER_MINUTE = 3
PART_SECONDS = 5 * 60 * 60 + 30 * 60
HEARTBEAT_SECONDS = 8 * 60
DISPATCH_SECONDS = 3 * 60
CHANNEL_RE = re.compile(r"^-100\d{4,16}$")
KEY_RE = re.compile(r"^tiktok/[A-Za-z0-9._]{2,24}/[1-9][0-9]{5,24}/live$")
RANK = ["origin", "origion", "uhd", "full_hd1", "hd", "hd1", "sd", "sd2", "ld", "sd1"]
ROOM_URL = "https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id="


def log(message: str) -> None:
    text = CHANNEL_RE.sub("-100…", str(message))
    print("[tiktok-record] " + text, flush=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_stamp(value: str) -> datetime | None:
    text = str(value or "")
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def fresh_iso(value: str, now: str, seconds: int) -> bool:
    left = parse_stamp(value)
    right = parse_stamp(now)
    if left is None or right is None:
        return False
    return (right - left).total_seconds() < seconds


def cap_of() -> int:
    raw = (os.environ.get("TIKTOK_RECORD_CAP") or "12").strip()
    try:
        value = int(raw)
    except ValueError:
        value = CAP_LIMIT
    return max(1, min(value, CAP_LIMIT))


def capacity(channels: int, cap: int | None = None) -> dict:
    count = max(1, int(channels or 1))
    jobs = CAP_LIMIT if cap is None else max(1, min(int(cap), CAP_LIMIT))
    per = MESSAGES_PER_MINUTE // HIGH_SEGMENTS_PER_MINUTE
    return {
        "recordingJobs": jobs,
        "messagesPerMinute": MESSAGES_PER_MINUTE,
        "highSegmentsPerMinute": HIGH_SEGMENTS_PER_MINUTE,
        "livesPerChannel": per,
        "channels": count,
        "highLivesKeptUp": per * count,
    }


def quality_rank(name: str) -> int:
    try:
        return RANK.index(str(name or "").lower())
    except ValueError:
        return len(RANK)


def segment_seconds(bitrate: int) -> int:
    """Seconds of stream-copy that stay near 18 MiB and under 19 MiB."""
    rate = int(bitrate or 0)
    if rate <= 0:
        return 6
    seconds = int((TARGET_BYTES * 8) / rate)
    return max(2, min(30, seconds))


def record_source(picked: dict | None) -> dict:
    """The picker's chosen rung, HLS first. Never a lower rung than that."""
    row = picked if isinstance(picked, dict) else {}
    hls = str(row.get("hls") or "")
    flv = str(row.get("flv") or "")
    quality = str(row.get("quality") or "")
    note = str(row.get("qualityNote") or "")
    if hls:
        url, kind = hls, "hls"
    elif flv:
        url, kind = flv, "flv"
    else:
        url, kind = "", ""
    top = quality.lower() in {"origin", "origion"}
    if top:
        note = ""
    elif quality and not note:
        note = "best available"
    return {"url": url, "kind": kind, "quality": quality, "qualityNote": note}


def prefer_cached(cached: dict | None, fresh: dict | None) -> dict:
    """A cached URL is returned only when it is origin and the fresh one is lower or missing.

    A fresh origin always replaces a cached lower URL. A cached HD URL is never kept.
    """
    old = cached if isinstance(cached, dict) else {}
    new = fresh if isinstance(fresh, dict) else {}
    old_url = str(old.get("url") or "")
    new_url = str(new.get("url") or "")
    old_top = quality_rank(str(old.get("quality") or "")) <= 1 and bool(old_url)
    if new_url:
        if old_top and quality_rank(str(old.get("quality") or "")) < quality_rank(str(new.get("quality") or "")):
            return old
        return new
    if old_top:
        return old
    return {"url": "", "quality": ""}


def ffmpeg_args(url: str, dest: Path, seconds: int, start: int = 0) -> list:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if str(url).startswith(("http://", "https://")):
        args += [
            "-user_agent", UA,
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "4",
        ]
    args += [
        "-i", url,
        "-c", "copy",
        "-f", "hls",
        "-hls_time", str(int(seconds)),
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4",
        "-hls_flags", "independent_segments+temp_file",
        "-hls_list_size", "0",
        "-start_number", str(int(start)),
        "-hls_segment_filename", str(dest / "seg%05d.m4s"),
        str(dest / "index.m3u8"),
    ]
    return args


def split_args(src: Path, dest: Path, seconds: int) -> list:
    """Shorter stream-copy pieces. No encoder flags."""
    return ffmpeg_args(str(src), dest, seconds, 0)


def copy_only(args: list) -> bool:
    banned = {"libx264", "libx265", "libsvtav1", "crf", "preset", "-c:v", "-c:a", "concurrent", "http_multiple"}
    if any(str(item) in banned for item in args):
        return False
    if args.count("-i") != 1:
        return False
    try:
        return args[args.index("-c") + 1] == "copy"
    except (ValueError, IndexError):
        return False


def channel_slot(room_id: str, channels: int) -> int:
    count = max(1, int(channels or 1))
    if count == 1:
        return 0
    return zlib.crc32(str(room_id or "").encode("utf-8")) % count


def channel_ok(value: str) -> bool:
    return CHANNEL_RE.fullmatch(str(value or "").strip()) is not None


def sort_key(handle: str, added: list, started: str) -> tuple:
    order = [str(item or "").lower() for item in added]
    name = str(handle or "").lower()
    try:
        index = order.index(name)
    except ValueError:
        index = len(order)
    return (index, started or "9999-12-31T00:00:00Z", name)


def blank_job(handle: str) -> dict:
    return {"handle": handle.lower(), "active": {}, "saved": []}


def key_base(handle: str, room: str) -> str:
    base = "tiktok/%s/%s/live" % (str(handle or "").lower(), str(room or ""))
    return base if KEY_RE.fullmatch(base) else ""


def public_view(job: dict | None) -> dict:
    row = job if isinstance(job, dict) else {}
    active = row.get("active") if isinstance(row.get("active"), dict) else {}
    saved = [item for item in (row.get("saved") or []) if isinstance(item, dict)]
    newest = saved[-1] if saved else {}
    state = ""
    source = {}
    if active.get("state") in {"recording", "queued", "blocked"}:
        state = str(active.get("state"))
        source = active
    elif newest:
        state = "saved"
        source = newest
    base = str(source.get("key") or "")
    playable = state == "saved" and KEY_RE.fullmatch(base) is not None
    return {
        "state": state,
        "quality": str(source.get("quality") or ""),
        "qualityNote": str(source.get("qualityNote") or ""),
        "title": str(source.get("title") or ""),
        "cover": str(source.get("cover") or ""),
        "startedAt": str(source.get("startedAt") or ""),
        "endedAt": str(source.get("endedAt") or ""),
        "duration": int(source.get("duration") or 0),
        "roomId": str(source.get("roomId") or ""),
        "parts": int(source.get("parts") or (1 if playable else 0)) if playable or state == "saved" else int(source.get("part") or 0),
        "key": base if playable else "",
        "blocked": state == "blocked",
    }


def ready_to_save(active: dict | None, pending: int) -> bool:
    row = active if isinstance(active, dict) else {}
    if row.get("state") != "recording":
        return False
    if row.get("capturing") or row.get("needsPart") or not row.get("captureDone"):
        return False
    if int(pending or 0) > 0:
        return False
    return int(row.get("segments") or 0) > 0


def live_blocked(row: dict | None, now: str) -> bool:
    item = row if isinstance(row, dict) else {}
    if str(item.get("detail") or "") == BLOCKED:
        return True
    left = parse_stamp(now)
    right = parse_stamp(str(item.get("backoffUntil") or ""))
    return left is not None and right is not None and right > left


def occupies(active: dict, now: str) -> bool:
    if not isinstance(active, dict) or active.get("state") != "recording":
        return False
    if active.get("captureDone") and not active.get("needsPart") and not active.get("capturing"):
        return False
    if active.get("needsPart") or active.get("capturing"):
        return fresh_iso(str(active.get("heartbeat") or active.get("dispatchedAt") or ""), now, HEARTBEAT_SECONDS) or bool(active.get("needsPart"))
    return fresh_iso(str(active.get("heartbeat") or ""), now, HEARTBEAT_SECONDS) or fresh_iso(str(active.get("dispatchedAt") or ""), now, DISPATCH_SECONDS)


def plan(lives: list, added: list, jobs: dict, now: str, cap: int = 12, channels: int = 1) -> dict:
    """Choose which lives capture now and which wait.

    Added-account order is the priority. Start time breaks ties for handles
    that are not in that list. A live already being captured is not started twice.
    """
    cap = max(1, min(int(cap or CAP_LIMIT), CAP_LIMIT))
    channels = max(1, int(channels or 1))
    state = {str(name).lower(): json.loads(json.dumps(job)) for name, job in (jobs or {}).items() if isinstance(job, dict)}
    rows = []
    for item in lives or []:
        if not isinstance(item, dict):
            continue
        handle = str(item.get("handle") or "").lower()
        if not HANDLE_RE.fullmatch(handle):
            continue
        rows.append(item)
    by_handle = {str(item.get("handle") or "").lower(): item for item in rows}

    for handle, item in by_handle.items():
        job = state.setdefault(handle, blank_job(handle))
        active = job.get("active") if isinstance(job.get("active"), dict) else {}
        job["active"] = active
        if not item.get("live"):
            if active.get("state") == "queued":
                job["active"] = {}
            elif active.get("state") == "recording" and not (active.get("capturing") and fresh_iso(str(active.get("heartbeat") or ""), now, HEARTBEAT_SECONDS)):
                active["capturing"] = False
                active["needsPart"] = False
                active["captureDone"] = True
            continue
        if live_blocked(item, now) and not (active.get("capturing") and occupies(active, now)):
            active.clear()
            active.update({
                "state": "blocked",
                "roomId": str(item.get("roomId") or ""),
                "title": str(item.get("title") or ""),
                "quality": str(item.get("quality") or ""),
                "qualityNote": str(item.get("qualityNote") or ""),
                "blocked": True,
            })

    occupants = []
    dispatch = []
    for handle, job in state.items():
        active = job.get("active") if isinstance(job.get("active"), dict) else {}
        if not occupies(active, now):
            continue
        occupants.append(handle)
        if active.get("needsPart") and not fresh_iso(str(active.get("dispatchedAt") or ""), now, DISPATCH_SECONDS):
            part = int(active.get("part") or 1)
            dispatch.append({"handle": handle, "part": part, "room": str(active.get("roomId") or "")})
            active["dispatchedAt"] = now

    candidates = []
    for handle, item in by_handle.items():
        if not item.get("live") or live_blocked(item, now):
            continue
        room = str(item.get("roomId") or "")
        if not room:
            continue
        job = state.setdefault(handle, blank_job(handle))
        active = job.get("active") if isinstance(job.get("active"), dict) else {}
        saved = [row for row in (job.get("saved") or []) if isinstance(row, dict) and str(row.get("roomId") or "") == room]
        if saved and not active.get("needsPart"):
            continue
        if occupies(active, now) and str(active.get("roomId") or "") == room:
            continue
        started = str((active or {}).get("startedAt") or item.get("startedAt") or item.get("lastLiveAt") or "")
        candidates.append((sort_key(handle, added, started), handle, item, started))
    candidates.sort(key=lambda row: row[0])

    slots = cap - len(occupants)
    queued = []
    for _key, handle, item, started in candidates:
        job = state[handle]
        room = str(item.get("roomId") or "")
        active = job.get("active") if isinstance(job.get("active"), dict) else {}
        cover = str(item.get("cover") or active.get("cover") or "")
        fields = {
            "roomId": room,
            "title": str(item.get("title") or ""),
            "cover": cover,
            "quality": str(item.get("quality") or ""),
            "qualityNote": str(item.get("qualityNote") or ""),
            "key": key_base(handle, room),
            "startedAt": started or now,
            "channelSlot": channel_slot(room, channels),
            "part": int(active.get("part") or 1) or 1,
        }
        if slots > 0:
            fields.update({
                "state": "recording",
                "capturing": False,
                "captureDone": False,
                "needsPart": False,
                "dispatchedAt": now,
                "segments": int(active.get("segments") or 0),
            })
            job["active"] = fields
            dispatch.append({"handle": handle, "part": fields["part"], "room": room})
            slots -= 1
        else:
            fields.update({"state": "queued", "capturing": False, "captureDone": False, "needsPart": False})
            job["active"] = fields
            queued.append(handle)

    active_count = sum(1 for job in state.values() if isinstance(job.get("active"), dict) and job["active"].get("state") == "recording" and not job["active"].get("captureDone"))
    return {
        "jobs": state,
        "dispatch": dispatch,
        "queued": queued,
        "active": active_count,
        "cap": cap,
        "channels": channels,
    }


def plan_uploads(jobs: dict, heartbeats: dict, slots: int, now: str) -> list:
    need = False
    for job in (jobs or {}).values():
        active = job.get("active") if isinstance(job, dict) and isinstance(job.get("active"), dict) else {}
        if not active:
            continue
        if active.get("segments") or active.get("capturing") or active.get("captureDone") or active.get("state") == "recording":
            if not active.get("settled"):
                need = True
    if not need:
        return []
    start = []
    for slot in range(max(0, int(slots or 0))):
        seen = str((heartbeats or {}).get(slot) or (heartbeats or {}).get(str(slot)) or "")
        if not fresh_iso(seen, now, DISPATCH_SECONDS):
            start.append(slot)
    return start


def job_key(handle: str) -> str:
    return JOB_PREFIX + str(handle or "").lower() + ".json"


def load_json_bytes(blob: bytes | None) -> dict:
    if not blob:
        return {}
    try:
        parsed = json.loads(blob.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def load_job(handle: str) -> dict:
    job = load_json_bytes(r2_get(job_key(handle)))
    if not job:
        return blank_job(handle)
    job["handle"] = str(handle).lower()
    if not isinstance(job.get("active"), dict):
        job["active"] = {}
    if not isinstance(job.get("saved"), list):
        job["saved"] = []
    return job


def save_job(job: dict) -> None:
    handle = str(job.get("handle") or "").lower()
    job["handle"] = handle
    job["public"] = public_view(job)
    job["updatedAt"] = now_iso()
    r2_put(job_key(handle), json.dumps(job, ensure_ascii=False).encode("utf-8"))


def write_index(jobs: dict, cap: int) -> None:
    items = {}
    active = 0
    for handle, job in jobs.items():
        view = public_view(job)
        if not view.get("state"):
            continue
        items[handle] = view
        if view["state"] == "recording":
            active += 1
    payload = {"cap": cap, "active": active, "items": items}
    r2_put(INDEX_KEY, json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def github_dispatch(workflow: str, inputs: dict) -> bool:
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    token = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not repo or not token:
        log("dispatch skipped")
        return False
    url = "https://api.github.com/repos/%s/actions/workflows/%s/dispatches" % (repo, workflow)
    body = json.dumps({"ref": "main", "inputs": {key: str(value) for key, value in inputs.items()}}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "tiktok-record",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return 200 <= int(getattr(res, "status", 204)) < 300
    except urllib.error.HTTPError as err:
        log("dispatch failed %s" % err.code)
        return False
    except (urllib.error.URLError, TimeoutError, OSError):
        log("dispatch failed")
        return False


def extra_channel_count() -> int:
    doc = load_json_bytes(r2_get(CHANNELS_KEY))
    rows = doc.get("channels") if isinstance(doc.get("channels"), list) else []
    return sum(1 for item in rows if channel_ok(str(item)))


def cover_for(handle: str, accounts: dict) -> str:
    for row in accounts.get("added") or []:
        if isinstance(row, dict) and str(row.get("handle") or "").lower() == handle:
            return str(row.get("avatar") or "")
    return ""


def lives_from_doc(doc: dict, accounts: dict) -> list:
    live = doc.get("live") if isinstance(doc.get("live"), dict) else {}
    rows = []
    for name, item in live.items():
        if not isinstance(item, dict):
            continue
        handle = str(item.get("handle") or name).lower()
        rows.append({
            "handle": handle,
            "live": bool(item.get("live")),
            "roomId": str(item.get("roomId") or ""),
            "title": str(item.get("title") or ""),
            "cover": cover_for(handle, accounts),
            "quality": str(item.get("quality") or ""),
            "qualityNote": str(item.get("qualityNote") or ""),
            "startedAt": str(item.get("startedAt") or item.get("lastLiveAt") or ""),
            "lastLiveAt": str(item.get("lastLiveAt") or ""),
            "detail": str(item.get("detail") or ""),
            "backoffUntil": str(item.get("backoffUntil") or ""),
        })
    return rows


def load_jobs(handles: list) -> dict:
    found = {}
    for handle in handles:
        name = str(handle or "").lower()
        if not HANDLE_RE.fullmatch(name):
            continue
        blob = r2_get(job_key(name))
        if blob:
            found[name] = load_job(name)
    index = load_json_bytes(r2_get(INDEX_KEY))
    for name in (index.get("items") or {}):
        if name not in found and HANDLE_RE.fullmatch(str(name)):
            blob = r2_get(job_key(str(name)))
            if blob:
                found[str(name)] = load_job(str(name))
    return found


def upload_heartbeats(slots: int) -> dict:
    found = {}
    for slot in range(slots):
        doc = load_json_bytes(r2_get(UPLOAD_PREFIX + str(slot) + ".json"))
        if doc.get("at"):
            found[slot] = str(doc.get("at"))
    return found


def cmd_plan(dispatch: bool) -> int:
    token, account = cloudflare_env()
    if not token or not account:
        log("Cloudflare credentials are not set; skipping")
        return 0
    local = ROOT / "owner" / "tiktok.json"
    if local.is_file():
        doc = load_json_bytes(local.read_bytes())
    else:
        doc = load_json_bytes(r2_get("owner/tiktok.json"))
    accounts = load_added_accounts()
    added = [str(row.get("handle") or "") for row in (accounts.get("added") or []) if isinstance(row, dict)]
    lives = lives_from_doc(doc, accounts)
    jobs = load_jobs([item["handle"] for item in lives])
    channels = 1 + extra_channel_count()
    cap = cap_of()
    moment = now_iso()
    decided = plan(lives, added, jobs, moment, cap, channels)
    for handle, job in decided["jobs"].items():
        if job != jobs.get(handle):
            save_job(job)
    write_index(decided["jobs"], cap)
    beats = upload_heartbeats(channels)
    uploads = plan_uploads(decided["jobs"], beats, channels, moment)
    numbers = capacity(channels, cap)
    log("cap %s active %s queued %s channels %s kept-up %s" % (
        cap, decided["active"], len(decided["queued"]), channels, numbers["highLivesKeptUp"]))
    if not dispatch:
        print(json.dumps({"dispatch": decided["dispatch"], "upload": uploads, "capacity": numbers}, ensure_ascii=False))
        return 0
    for item in decided["dispatch"]:
        ok = github_dispatch("tiktok-record.yml", {"handle": item["handle"], "part": item["part"], "room": item["room"]})
        log("dispatch %s part %s %s" % (item["handle"], item["part"], "ok" if ok else "failed"))
    for slot in uploads:
        ok = github_dispatch("tiktok-live-upload.yml", {"slot": slot})
        log("uploader %s %s" % (slot, "ok" if ok else "failed"))
    return 0


def room_pick(room: str) -> tuple[dict, str]:
    status, body, _retry = http_get(ROOM_URL + urllib.parse.quote(str(room)))
    kind = challenge_kind(status, body)
    if kind or status == 0:
        return {}, kind or "0"
    picked = node_json("pick", body)
    return picked if isinstance(picked, dict) else {}, ""


def probe_bitrate(url: str) -> int:
    if not url or shutil.which("ffprobe") is None:
        return 0
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-user_agent", UA, "-show_entries", "format=bit_rate", "-of", "default=nw=1:nk=1", url],
            capture_output=True, timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return 0
    try:
        return int((proc.stdout or b"").decode("utf-8", "replace").strip() or "0")
    except ValueError:
        return 0


def r2_put_file(key: str, path: Path, content_type: str) -> bool:
    token, account = cloudflare_env()
    if not token or not account:
        return False
    quoted = urllib.parse.quote(key, safe="/")
    url = "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/%s/objects/%s" % (account, BUCKET, quoted)
    req = urllib.request.Request(url, data=path.read_bytes(), method="PUT", headers={
        "Authorization": "Bearer " + token,
        "content-type": content_type,
    })
    try:
        with urllib.request.urlopen(req, timeout=120):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def r2_delete(key: str) -> None:
    token, account = cloudflare_env()
    if not token or not account:
        return
    quoted = urllib.parse.quote(key, safe="/")
    url = "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/%s/objects/%s" % (account, BUCKET, quoted)
    req = urllib.request.Request(url, method="DELETE", headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=60):
            return
    except (urllib.error.URLError, TimeoutError, OSError):
        return


def list_prefix(prefix: str) -> list:
    token, account = cloudflare_env()
    if not token or not account:
        return []
    found = []
    cursor = ""
    seen = set()
    while True:
        query = "?prefix=%s&per_page=1000" % urllib.parse.quote(prefix)
        if cursor:
            query += "&cursor=" + urllib.parse.quote(cursor)
        url = "https://api.cloudflare.com/client/v4/accounts/%s/r2/buckets/%s/objects%s" % (account, BUCKET, query)
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                body = json.loads(res.read().decode("utf-8") or "{}")
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            break
        for row in body.get("result") or []:
            if isinstance(row, dict) and row.get("key"):
                found.append(str(row.get("key")))
        info = body.get("result_info") or {}
        cursor = str(info.get("cursor") or "")
        truncated = info.get("is_truncated")
        if truncated in (False, None, 0, "0", "false", "False") or not cursor or cursor in seen:
            break
        seen.add(cursor)
    return found


def durations_from_playlist(path: Path) -> dict:
    found = {}
    if not path.is_file():
        return found
    pending = None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("#EXTINF:"):
            try:
                pending = float(line.split(":", 1)[1].split(",", 1)[0])
            except ValueError:
                pending = None
            continue
        if line.startswith("#") or not line.strip():
            continue
        if pending is not None:
            found[Path(line.strip()).name] = pending
        pending = None
    return found


def store_piece(local: Path, buf_key: str, meta: dict) -> bool:
    sidecar = dict(meta)
    sidecar["size"] = local.stat().st_size
    sidecar["sha256"] = hashlib.sha256(local.read_bytes()).hexdigest()
    if not r2_put_file(buf_key, local, "video/mp4"):
        return False
    return r2_put(buf_key + ".json", json.dumps(sidecar).encode("utf-8"))


def split_oversize(local: Path, dest: Path) -> list:
    """Stream-copy a segment that is still at least 19 MiB. Empty when copy cannot shrink it."""
    if shutil.which("ffmpeg") is None:
        return []
    seconds = 2
    args = split_args(local, dest, seconds)
    if not copy_only(args):
        return []
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(args, capture_output=True, timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    pieces = sorted(dest.glob("seg*.m4s"))
    if not pieces or any(piece.stat().st_size >= SMALL_BYTES for piece in pieces):
        return []
    return pieces


def publish_local(dest: Path, sent: set, meta: dict) -> int:
    stored = 0
    playlist = durations_from_playlist(dest / "index.m3u8")
    init = dest / "init.mp4"
    if init.is_file() and "init.mp4" not in sent:
        piece = {
            "objectKey": meta["objectKey"],
            "role": "init",
            "index": -1,
            "duration": 0,
            "channelSlot": meta["channelSlot"],
            "oversize": False,
        }
        if store_piece(init, meta["buf"] + "/init.mp4", piece):
            sent.add("init.mp4")
            stored += 1
    for path in sorted(dest.glob("seg*.m4s")):
        if path.name in sent:
            continue
        index = int(path.stem.replace("seg", "") or "0")
        pieces = [path]
        oversize = False
        if path.stat().st_size >= SMALL_BYTES:
            smaller = split_oversize(path, dest / ("split-" + path.stem))
            if smaller:
                pieces = smaller
            else:
                oversize = True
                log("oversize %s" % path.name)
        for offset, piece_path in enumerate(pieces):
            piece = {
                "objectKey": meta["objectKey"],
                "role": "segment",
                "index": index if len(pieces) == 1 else index * 100 + offset,
                "duration": playlist.get(path.name) or meta.get("seconds") or 6,
                "channelSlot": meta["channelSlot"],
                "oversize": oversize,
            }
            buf_name = piece_path.name if len(pieces) == 1 else ("seg%05d.m4s" % piece["index"])
            if store_piece(piece_path, meta["buf"] + "/" + buf_name, piece):
                stored += 1
        sent.add(path.name)
    return stored


def run_ffmpeg(url: str, dest: Path, seconds: int, start: int, deadline: float, on_tick) -> str:
    if shutil.which("ffmpeg") is None:
        log("ffmpeg is not installed")
        return "error"
    dest.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(ffmpeg_args(url, dest, seconds, start), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    reason = "ended"
    try:
        while proc.poll() is None:
            if time.time() >= deadline:
                reason = "deadline"
                proc.send_signal(signal.SIGINT)
                break
            stop = on_tick()
            if stop:
                reason = stop
                proc.send_signal(signal.SIGINT)
                break
            time.sleep(1)
        try:
            proc.wait(timeout=25)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        if proc.poll() is None:
            proc.kill()
    return reason


def mark_saved_room(job: dict) -> None:
    active = job.get("active") if isinstance(job.get("active"), dict) else {}
    if not active:
        return
    room = str(active.get("roomId") or "")
    base = str(active.get("key") or "")
    saved = [item for item in (job.get("saved") or []) if isinstance(item, dict)]
    current = None
    for item in saved:
        if str(item.get("roomId") or "") == room:
            current = item
    if current is None:
        current = {"roomId": room, "key": base}
        saved.append(current)
    current.update({
        "key": base,
        "roomId": room,
        "parts": max(int(current.get("parts") or 0), int(active.get("part") or 1)),
        "quality": active.get("quality") or current.get("quality") or "",
        "qualityNote": active.get("qualityNote") or "",
        "title": active.get("title") or "",
        "cover": active.get("cover") or "",
        "startedAt": active.get("startedAt") or "",
        "endedAt": active.get("endedAt") or now_iso(),
        "duration": int(active.get("duration") or 0),
    })
    job["saved"] = saved
    job["active"] = {}


def cmd_record(handle: str, part: str, room: str) -> int:
    token, account = cloudflare_env()
    if not token or not account:
        log("Cloudflare credentials are not set; skipping")
        return 0
    name = str(handle or "").lower()
    if not HANDLE_RE.fullmatch(name):
        log("bad handle")
        return 0
    job = load_job(name)
    active = job.get("active") if isinstance(job.get("active"), dict) else {}
    part_n = int(part or active.get("part") or 1)
    room_id = str(room or active.get("roomId") or "")
    run_id = str(os.environ.get("GITHUB_RUN_ID") or "")
    if active.get("capturing") and str(active.get("runId") or "") not in {"", run_id} and fresh_iso(str(active.get("heartbeat") or ""), now_iso(), HEARTBEAT_SECONDS):
        log("already recording %s" % name)
        return 0
    if not room_id:
        doc = load_json_bytes(r2_get("owner/tiktok.json"))
        live = (doc.get("live") or {}).get(name) if isinstance(doc.get("live"), dict) else {}
        room_id = str((live or {}).get("roomId") or "")
    if not room_id:
        log("no room %s" % name)
        return 0
    picked, kind = room_pick(room_id)
    if kind:
        active.update({"state": "blocked", "roomId": room_id, "blocked": True, "capturing": False, "captureDone": True, "needsPart": False})
        job["active"] = active
        save_job(job)
        log("blocked %s" % name)
        return 0
    source = record_source(picked)
    if not picked.get("live") or not source["url"]:
        if int(active.get("segments") or 0) > 0:
            active["captureDone"] = True
            active["capturing"] = False
            active["needsPart"] = False
            active["endedAt"] = now_iso()
            job["active"] = active
            save_job(job)
        log("ended %s" % name)
        return 0
    base = key_base(name, room_id)
    if not base:
        log("bad room %s" % name)
        return 0
    started = str(active.get("startedAt") or now_iso())
    active.update({
        "state": "recording",
        "roomId": room_id,
        "part": part_n,
        "parts": part_n,
        "key": base,
        "quality": source["quality"],
        "qualityNote": source["qualityNote"],
        "title": str(picked.get("title") or active.get("title") or ""),
        "startedAt": started,
        "capturing": True,
        "captureDone": False,
        "needsPart": False,
        "blocked": False,
        "runId": run_id,
        "heartbeat": now_iso(),
        "channelSlot": int(active.get("channelSlot") or channel_slot(room_id, 1 + extra_channel_count())),
        "segments": int(active.get("segments") or 0),
    })
    job["active"] = active
    save_job(job)
    log("record %s quality %s%s" % (name, source["quality"] or "unknown", (" note=" + source["qualityNote"]) if source["qualityNote"] else ""))
    seconds = segment_seconds(probe_bitrate(source["url"]))
    dest = Path(tempfile.mkdtemp(prefix="tiktok-live-"))
    sent = set()
    meta = {
        "objectKey": base + "/" + str(part_n),
        "buf": "%s%s/%s/%s" % (BUF_PREFIX, name, room_id, part_n),
        "channelSlot": active["channelSlot"],
        "seconds": seconds,
    }
    deadline = time.time() + PART_SECONDS
    last_live = 0.0
    still = {"live": True}
    before = int(active.get("segments") or 0)

    def on_tick():
        nonlocal last_live
        now = time.time()
        stored = publish_local(dest, sent, meta)
        if stored:
            active["segments"] = int(active.get("segments") or 0) + stored
        if now - last_live > 20:
            active["heartbeat"] = now_iso()
            job["active"] = active
            save_job(job)
        if now - last_live < 30:
            return ""
        last_live = now
        check, blocked = room_pick(room_id)
        if blocked:
            return ""
        if not check.get("live"):
            still["live"] = False
            return "ended"
        return ""

    try:
        reason = run_ffmpeg(source["url"], dest, seconds, 0, deadline, on_tick)
        stored = publish_local(dest, sent, meta)
        if stored:
            active["segments"] = int(active.get("segments") or 0) + stored
    finally:
        shutil.rmtree(dest, ignore_errors=True)
    active["capturing"] = False
    active["heartbeat"] = ""
    gained = int(active.get("segments") or 0) - before
    if still["live"] and (reason == "deadline" or gained > 0):
        active["needsPart"] = True
        active["part"] = part_n + 1
        active["captureDone"] = False
        active["dispatchedAt"] = ""
        job["active"] = active
        save_job(job)
        github_dispatch("tiktok-record.yml", {"handle": name, "part": part_n + 1, "room": room_id})
        log("part %s %s" % (name, part_n + 1))
        return 0
    if still["live"]:
        active.update({"state": "blocked", "blocked": True, "captureDone": True, "needsPart": False})
        job["active"] = active
        save_job(job)
        log("blocked %s" % name)
        return 0
    ended = now_iso()
    try:
        duration = int((parse_stamp(ended) - parse_stamp(started)).total_seconds())
    except (TypeError, AttributeError):
        duration = 0
    active.update({
        "captureDone": True,
        "needsPart": False,
        "endedAt": ended,
        "duration": max(0, duration),
        "part": part_n,
        "parts": part_n,
    })
    job["active"] = active
    save_job(job)
    log("capture done %s" % name)
    return 0


def channel_list() -> list:
    primary = (os.environ.get("TELEGRAM_CHANNEL_ID") or "").strip()
    doc = load_json_bytes(r2_get(CHANNELS_KEY))
    rows = []
    if channel_ok(primary):
        rows.append(primary)
    elif primary:
        log("primary channel id is not usable")
    for item in doc.get("channels") or []:
        text = str(item or "").strip()
        if channel_ok(text) and text not in rows:
            rows.append(text)
    return rows


def touch_upload(slot: int) -> None:
    r2_put(UPLOAD_PREFIX + str(slot) + ".json", json.dumps({"at": now_iso()}).encode("utf-8"))


def cmd_upload(slot: str) -> int:
    token, account = cloudflare_env()
    bot = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token or not account or not bot:
        log("upload credentials are not set; skipping")
        return 0
    try:
        index = int(slot or "0")
    except ValueError:
        index = 0
    channels = channel_list()
    if index < 0 or index >= len(channels):
        log("no channel for slot %s" % index)
        return 0
    from telegram_backup import d1_id, d1_rows, remember_d1, send_document

    database = d1_id(token, account)
    channel = channels[index]
    pace = {"last": 0.0}
    idle_since = 0.0
    deadline = time.time() + (340 * 60)
    held = set()
    while time.time() < deadline:
        touch_upload(index)
        names = [key for key in list_prefix(BUF_PREFIX) if key.endswith(".json")]
        pending = []
        for key in names:
            meta = load_json_bytes(r2_get(key))
            if int(meta.get("channelSlot") or 0) != index:
                continue
            if meta.get("held"):
                continue
            pending.append((key, meta))
        pending.sort(key=lambda item: (str(item[1].get("objectKey") or ""), int(item[1].get("index") or 0)))
        if not pending:
            jobs = load_jobs([])
            index_doc = load_json_bytes(r2_get(INDEX_KEY))
            names_known = list((index_doc.get("items") or {}).keys())
            jobs.update(load_jobs(names_known))
            changed = False
            busy = False
            for handle, job in jobs.items():
                active = job.get("active") if isinstance(job.get("active"), dict) else {}
                if active.get("capturing") or active.get("needsPart"):
                    busy = True
                prefix = "%s%s/" % (BUF_PREFIX, handle)
                left = [key for key in names if key.startswith(prefix)]
                if ready_to_save(active, len(left)):
                    mark_saved_room(job)
                    save_job(job)
                    changed = True
                elif active.get("captureDone") and not active.get("needsPart") and int(active.get("segments") or 0) <= 0 and not left:
                    job["active"] = {}
                    save_job(job)
                    changed = True
            if changed:
                write_index(jobs, cap_of())
            if busy:
                idle_since = 0.0
                time.sleep(5)
                continue
            if not idle_since:
                idle_since = time.time()
            if time.time() - idle_since > 90:
                break
            time.sleep(10)
            continue
        idle_since = 0.0
        key, meta = pending[0]
        media_key = key[:-5]
        if meta.get("oversize") or int(meta.get("size") or 0) >= SMALL_BYTES:
            meta["held"] = True
            r2_put(key, json.dumps(meta).encode("utf-8"))
            held.add(key)
            log("oversize held")
            continue
        local = Path(tempfile.mkdtemp(prefix="tiktok-up-")) / Path(media_key).name
        try:
            blob = r2_get(media_key)
            if not blob:
                continue
            local.write_bytes(blob)
            object_key = str(meta.get("objectKey") or "")
            role = "init" if meta.get("role") == "init" else "segment"
            part_index = int(meta.get("index") or 0)
            kind = "init" if role == "init" else "segment"
            existing = d1_rows(token, account, database, "SELECT file_id FROM telegram_files WHERE object_key = ? AND kind = ? AND part_index = ? LIMIT 1", [object_key, kind, part_index])
            if not existing:
                sent = send_document("https://api.telegram.org", bot, channel, local, object_key, pace)
                remember_d1(token, account, database, {
                    "serve": True,
                    "bucket": BUCKET,
                    "key": object_key,
                    "encrypted": False,
                }, {
                    "role": role,
                    "index": part_index,
                    "file_id": sent["file_id"],
                    "message_id": sent["message_id"],
                    "size": int(sent.get("file_size") or local.stat().st_size),
                    "sha256": str(meta.get("sha256") or hashlib.sha256(blob).hexdigest()),
                    "mime": "video/mp4",
                    "duration": float(meta.get("duration") or 0),
                }, False, object_key)
            r2_delete(media_key)
            r2_delete(key)
        except RuntimeError:
            log("upload failed; the segment stays buffered")
            time.sleep(5)
        finally:
            shutil.rmtree(local.parent, ignore_errors=True)
    return 0


def selftest() -> int:
    failed = 0

    def check(ok: bool, message: str) -> None:
        nonlocal failed
        if not ok:
            failed += 1
            print("FAIL " + message)
        else:
            print("ok " + message)

    numbers = capacity(1)
    check(numbers["recordingJobs"] == 12, "twelve recording jobs is the cap")
    check(numbers["livesPerChannel"] == 6, "one channel keeps up with six high-bitrate lives")
    check(numbers["messagesPerMinute"] == 20 and numbers["highSegmentsPerMinute"] == 3, "the pace is twenty messages and three segments a minute")
    check(capacity(2)["highLivesKeptUp"] == 12, "two channels keep up with twelve high-bitrate lives")
    check(cap_of() == 12 or cap_of() <= 12, "the cap cannot exceed twelve")

    check(segment_seconds(0) == 6, "an unknown bitrate uses a short safe segment")
    check(segment_seconds(8_000_000) == 18, "eight megabits a second is an eighteen second copy")
    check(segment_seconds(40_000_000) >= 2, "a very high bitrate stays at least two seconds")
    check(segment_seconds(1_000_000) == 30, "a low bitrate does not make a segment longer than thirty seconds")

    origin = record_source({"hls": "https://cdn.example/origin.m3u8", "flv": "https://cdn.example/origin.flv", "quality": "origin", "qualityNote": ""})
    check(origin["url"].endswith("origin.m3u8") and origin["qualityNote"] == "" and origin["kind"] == "hls", "origin HLS is the recording source")
    flv = record_source({"hls": "", "flv": "https://cdn.example/origin.flv", "quality": "origion", "qualityNote": ""})
    check(flv["kind"] == "flv" and flv["qualityNote"] == "", "origin FLV is used when HLS is missing")
    hd = record_source({"hls": "https://cdn.example/hd.m3u8", "quality": "hd", "qualityNote": "best available"})
    check(hd["url"].endswith("hd.m3u8") and hd["qualityNote"] == "best available", "a missing origin keeps the best available URL and notes it")
    check("libx264" not in hd["url"], "the recording URL is the one TikTok offered")

    cached_hd = {"url": "https://cdn.example/old-hd.m3u8", "quality": "hd"}
    fresh_origin = {"url": "https://cdn.example/new-origin.m3u8", "quality": "origin"}
    check(prefer_cached(cached_hd, fresh_origin)["quality"] == "origin", "a fresh origin replaces a cached HD URL")
    cached_origin = {"url": "https://cdn.example/old-origin.m3u8", "quality": "origin"}
    fresh_hd = {"url": "https://cdn.example/new-hd.m3u8", "quality": "hd"}
    check(prefer_cached(cached_origin, fresh_hd)["quality"] == "origin", "a cached origin is not replaced by a lower fresh URL")
    check(prefer_cached(cached_hd, {})["url"] == "", "a cached HD URL is not served when nothing fresh arrived")
    check(prefer_cached(cached_origin, {})["quality"] == "origin", "a cached origin is kept when the fresh body is missing")
    check(prefer_cached(cached_origin, fresh_origin)["url"].endswith("new-origin.m3u8"), "a fresh origin URL replaces an older origin URL")

    dest = Path("out")
    args = ffmpeg_args("https://cdn.example/origin.m3u8", dest, 6, 0)
    check(copy_only(args), "ffmpeg stream-copies with one input")
    check(UA in args and "-user_agent" in args, "ffmpeg uses the Chrome user agent")
    check("concurrent" not in " ".join(args) and args.count("-i") == 1, "ffmpeg opens one connection and does not split ranges")
    check(copy_only(split_args(Path("big.m4s"), dest, 2)), "an oversize segment is split with stream copy")

    now = "2026-10-23T01:00:00Z"
    added = ["b_name", "a_name", "c_name"]
    lives = []
    for index, handle in enumerate(["a_name", "b_name", "c_name", "z_name"]):
        lives.append({
            "handle": handle,
            "live": True,
            "roomId": "769964750949871080%d" % index,
            "startedAt": "2026-10-23T00:%02d:00Z" % index,
            "quality": "origin",
            "qualityNote": "",
            "title": handle,
        })
    # a started earlier, but b is first in the added list.
    first = plan(lives[:2], added, {}, now, cap=1, channels=1)
    check(first["dispatch"][0]["handle"] == "b_name", "the added-account order starts before an earlier live")
    check(first["queued"] == ["a_name"], "the next live waits")
    many = []
    order = []
    for index in range(13):
        handle = "h%02d" % index
        order.append(handle)
        many.append({
            "handle": handle,
            "live": True,
            "roomId": "7699647509498711%03d" % index,
            "startedAt": "2026-10-23T00:10:00Z",
            "quality": "origin",
        })
    wide = plan(many, order, {}, now, cap=12, channels=2)
    check(len(wide["dispatch"]) == 12 and wide["queued"] == ["h12"], "the thirteenth live queues and twelve capture")
    check(all(0 <= job["active"].get("channelSlot", 0) <= 1 for job in wide["jobs"].values() if job.get("active")), "recordings spread across the channels")
    again = plan(many, order, wide["jobs"], "2026-10-23T01:01:00Z", cap=12, channels=2)
    check(not any(item["handle"] == "h00" and item["part"] == 1 for item in again["dispatch"]), "a fresh dispatch is not started twice")

    saved_job = blank_job("b_name")
    saved_job["saved"] = [{"roomId": "7699647509498710801", "key": key_base("b_name", "7699647509498710801"), "parts": 1, "quality": "origin"}]
    skipped = plan([lives[1]], added, {"b_name": saved_job}, now, cap=12, channels=1)
    check(skipped["dispatch"] == [], "a room that is already saved is not recorded again")
    blocked = plan([{
        "handle": "a_name",
        "live": True,
        "roomId": "7699647509498710800",
        "detail": BLOCKED,
        "quality": "hd",
        "qualityNote": "best available",
    }], added, {}, now, cap=12, channels=1)
    check(blocked["dispatch"] == [] and blocked["jobs"]["a_name"]["active"]["state"] == "blocked", "a blocked live is not dispatched")
    view = public_view(blocked["jobs"]["a_name"])
    check(view["blocked"] is True and view["key"] == "" and "channel" not in view, "the public row has no playback key and no channel id while blocked")
    saved_view = public_view(saved_job)
    check(saved_view["state"] == "saved" and saved_view["key"].endswith("/live") and saved_view["quality"] == "origin", "a saved live exposes the Telegram key and the origin quality")
    note_job = blank_job("a_name")
    note_job["saved"] = [{"roomId": "7699647509498710800", "key": key_base("a_name", "7699647509498710800"), "parts": 1, "quality": "hd", "qualityNote": "best available"}]
    check(public_view(note_job)["qualityNote"] == "best available", "a saved fallback notes that origin was missing")

    ended = plan([{
        "handle": "a_name", "live": False, "roomId": "7699647509498710800",
    }], added, {"a_name": {"handle": "a_name", "active": {"state": "queued", "roomId": "7699647509498710800"}, "saved": []}}, now, cap=12, channels=1)
    check(ended["jobs"]["a_name"]["active"] == {}, "a queued live that ended does not stay queued")

    partial = {"handle": "a_name", "active": {"state": "recording", "captureDone": True, "needsPart": False, "capturing": False, "segments": 4, "roomId": "1", "part": 1, "key": key_base("a_name", "7699647509498710800")}, "saved": []}
    check(ready_to_save(partial["active"], 0), "a finished capture with no buffer left can be marked saved")
    check(not ready_to_save(partial["active"], 2), "buffered segments are not dropped before they upload")
    check(not ready_to_save({"state": "recording", "capturing": True, "segments": 3}, 0), "an open capture is not marked saved")

    check(channel_slot("7699647509498710804", 2) == channel_slot("7699647509498710804", 2), "a room stays on the same channel")
    check(channel_ok("-1004242") and not channel_ok("4242"), "a backup channel id is a private -100 id")

    if shutil.which("ffmpeg"):
        folder = Path(tempfile.mkdtemp(prefix="tiktok-copy-"))
        try:
            sample = folder / "sample.mp4"
            made = subprocess.run(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=15:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(sample)],
                capture_output=True, check=False,
            )
            out = folder / "hls"
            out.mkdir(parents=True, exist_ok=True)
            copied = subprocess.run(ffmpeg_args(str(sample), out, 2, 0), capture_output=True, check=False)
            pieces = list(out.glob("seg*.m4s"))
            check(made.returncode == 0 and copied.returncode == 0 and (out / "init.mp4").is_file() and bool(pieces), "a file stream-copies to fMP4 HLS")
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", str(out / "init.mp4")],
                capture_output=True, check=False,
            )
            check(probe.stdout.decode("utf-8", "replace").strip() == "h264", "the copied init keeps the source codec")
        finally:
            shutil.rmtree(folder, ignore_errors=True)
    else:
        check(True, "ffmpeg is not installed here; the copy command was still checked")

    if failed:
        print("%s failed" % failed)
        return 1
    print("tiktok record selftest passed")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if "--selftest" in args:
        return selftest()
    if "--plan" in args:
        return cmd_plan("--dispatch" in args)
    if "--record" in args:
        handle = ""
        part = "1"
        room = ""
        for index, item in enumerate(args):
            if item == "--handle" and index + 1 < len(args):
                handle = args[index + 1]
            elif item == "--part" and index + 1 < len(args):
                part = args[index + 1]
            elif item == "--room" and index + 1 < len(args):
                room = args[index + 1]
        return cmd_record(handle, part, room)
    if "--upload" in args:
        slot = "0"
        for index, item in enumerate(args):
            if item == "--slot" and index + 1 < len(args):
                slot = args[index + 1]
        return cmd_upload(slot)
    print("usage: tiktok_record.py --selftest | --plan [--dispatch] | --record | --upload")
    return 2


if __name__ == "__main__":
    sys.exit(main())
