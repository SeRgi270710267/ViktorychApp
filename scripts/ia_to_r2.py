#!/usr/bin/env python3
"""Copy referenced Internet Archive files into the private R2 bucket.

The site keeps using source URLs first. These copies replace the archive.org
fallback. Catalog files that Internet Archive adds itself are not copied.
Nothing here deletes an Internet Archive object or prints a credential.

The account free tier is 10 GB. This stops before the account would pass 9 GB.
Videos are shrunk before older videos are left behind. Photos, avatars, and
shard JSON are kept ahead of those videos.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import r2_usage  # noqa: E402

BUCKET = "viktorych-data"
STORE_BASE = "https://viktorych-accounts.viktorych-accounts.workers.dev/v1/archive/"
LIMIT_BYTES = 9 * 1000 ** 3
SHRUNK_VIDEO_BYTES = 12 * 1024 * 1024
CATALOG_SUFFIXES = ("_files.xml", "_meta.xml", "_meta.sqlite", "_archive.torrent")
UA = "Mozilla/5.0 (compatible; viktorych-archive/1.0)"
ITEM_FILE = re.compile(r"https://archive\.org/download/([^/?#]+)/([^?#]+)")


def public_url(name: str) -> str:
    return STORE_BASE + name


def object_name(digest: str, ext: str) -> str:
    suffix = ext if ext.startswith(".") else "." + ext
    return digest + suffix.lower()


def is_catalog(name: str) -> bool:
    base = str(name or "")
    return base == "__ia_thumb.jpg" or base.endswith(CATALOG_SUFFIXES)


def referenced(manifest: dict) -> list[dict]:
    """Files the published manifest actually points at."""
    found = []
    seen = set()
    files = list((manifest or {}).get("files") or [])
    items = (manifest or {}).get("items") or {}
    slot_for = {}
    for slot, ident in items.items():
        slot_for.setdefault(str(ident), str(slot))
    for row in files:
        if not isinstance(row, dict):
            continue
        old = str(row.get("a") or "")
        match = ITEM_FILE.search(old)
        if not match:
            continue
        item, name = match.group(1), urllib.parse.unquote(match.group(2))
        if is_catalog(name) or (item, name) in seen:
            continue
        seen.add((item, name))
        slot = slot_for.get(item, "")
        month = slot.split(":", 1)[-1] if ":" in slot else ""
        found.append({
            "item": item,
            "name": name,
            "old": old,
            "kind": str(row.get("k") or ""),
            "recent": month,
        })
    for key, url in ((manifest or {}).get("shards") or {}).items():
        old = str(url or "")
        match = ITEM_FILE.search(old)
        if not match:
            continue
        item, name = match.group(1), urllib.parse.unquote(match.group(2))
        if is_catalog(name) or (item, name) in seen:
            continue
        seen.add((item, name))
        found.append({
            "item": item,
            "name": name,
            "old": old,
            "kind": "json",
            "recent": str(key),
        })
    return found


def plan_copies(files: list[dict], used: int, limit: int = LIMIT_BYTES, shrunk: int = SHRUNK_VIDEO_BYTES) -> list[dict]:
    """Decide copy, shrink, or drop without downloading. Newest media stays."""
    rows = []
    for row in files:
        size = int(row.get("size") or 0)
        kind = str(row.get("kind") or "")
        video = kind in {"video", "animated_gif"} or str(row.get("name") or "").lower().endswith(".mp4")
        rows.append({
            "item": row.get("item"),
            "name": row.get("name"),
            "old": row.get("old"),
            "kind": kind,
            "recent": str(row.get("recent") or ""),
            "size": size,
            "video": video,
            "action": "copy",
            "planned": size,
        })
    def total():
        return used + sum(row["planned"] for row in rows if row["action"] != "drop")
    videos = [row for row in rows if row["video"] and row["size"] > shrunk]
    videos.sort(key=lambda row: row["size"], reverse=True)
    for row in videos:
        if total() <= limit:
            break
        row["action"] = "shrink"
        row["planned"] = shrunk
    dropping = [row for row in rows if row["video"] and row["action"] != "drop"]
    dropping.sort(key=lambda row: (row["recent"], -row["planned"]))
    for row in dropping:
        if total() <= limit:
            break
        row["action"] = "drop"
        row["planned"] = 0
    others = [row for row in rows if not row["video"]]
    others.sort(key=lambda row: (row["recent"], -row["size"]))
    for row in others:
        if total() <= limit:
            break
        row["action"] = "drop"
        row["planned"] = 0
    return rows


def _replace(value, mapping: dict):
    if isinstance(value, str) and value in mapping:
        return mapping[value]
    return value


def rewrite(manifest: dict, state: dict, mapping: dict) -> tuple[dict, dict]:
    """Point manifest and state URLs at the R2 copies. The old URL is kept as ia."""
    doc = json.loads(json.dumps(manifest))
    saved = json.loads(json.dumps(state or {}))
    for row in doc.get("files") or []:
        if not isinstance(row, dict):
            continue
        old = str(row.get("a") or "")
        if old in mapping:
            row["ia"] = old
            row["a"] = mapping[old]
    shards = doc.get("shards") or {}
    for key, url in list(shards.items()):
        shards[key] = mapping.get(str(url), url)
    for bucket in ("shardUrls",):
        urls = saved.get(bucket) or {}
        for key, url in list(urls.items()):
            urls[key] = mapping.get(str(url), url)
    for key in ("indexUrl", "manifestUrl"):
        if saved.get(key):
            saved[key] = mapping.get(str(saved[key]), saved[key])
    for row in (saved.get("byHash") or {}).values():
        if isinstance(row, dict) and row.get("a") in mapping:
            row["ia"] = row["a"]
            row["a"] = mapping[row["ia"]]
    for row in (saved.get("copied") or {}).values():
        if isinstance(row, dict) and row.get("url") in mapping:
            row["url"] = mapping[row["url"]]
    return doc, saved


def _secrets() -> list[str]:
    return [os.environ.get("CLOUDFLARE_API_TOKEN") or "", os.environ.get("CLOUDFLARE_ACCOUNT_ID") or ""]


def _api(token: str, account: str, key: str, method: str, body: bytes | None = None, content_type: str = "") -> tuple[int, bytes]:
    quoted = urllib.parse.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}/objects/{quoted}"
    headers = {"Authorization": "Bearer " + token, "User-Agent": UA}
    if body is not None:
        headers["Content-Type"] = content_type or "application/octet-stream"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return getattr(response, "status", 200), response.read()
    except urllib.error.HTTPError as err:
        try:
            payload = err.read() or b""
        except OSError:
            payload = b""
        return err.code, payload


def object_exists(token: str, account: str, key: str) -> bool:
    status, _payload = _api(token, account, key, "HEAD")
    return status == 200


def put_object(token: str, account: str, key: str, body: bytes, content_type: str) -> None:
    status, payload = _api(token, account, key, "PUT", body, content_type)
    if status not in {200, 201, 204}:
        detail = r2_usage.scrub(payload[:160].decode("utf-8", "replace"), _secrets())
        raise RuntimeError(f"r2 put failed ({status}) {detail}".rstrip())


def download(url: str, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=180) as response:
        chunks = []
        total = 0
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > limit:
                raise RuntimeError("download exceeded the size cap")
            chunks.append(block)
    return b"".join(chunks)


def content_type(name: str) -> str:
    ext = name.rsplit(".", 1)[-1].lower()
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "json": "application/json",
    }.get(ext, "application/octet-stream")


def shrink_video(body: bytes, work: Path) -> bytes | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    source = work / "in.mp4"
    dest = work / "out.mp4"
    source.write_bytes(body)
    proc = subprocess.run(
        [
            ffmpeg, "-y", "-i", str(source),
            "-vf", "scale=-2:720",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            str(dest),
        ],
        capture_output=True,
        timeout=600,
    )
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size <= 0:
        return None
    return dest.read_bytes()


def _git_json(spec: str):
    proc = subprocess.run(["git", "show", spec], cwd=ROOT, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return {}
    try:
        data = json.loads(proc.stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _load() -> tuple[dict, dict]:
    subprocess.run(["git", "fetch", "-q", "origin", "data"], cwd=ROOT, capture_output=True)
    manifest = _git_json("origin/data:archive/ia-manifest.json")
    state = _git_json("origin/data:archive/ia-state.json")
    return manifest, state


def _sizes(files: list[dict]) -> None:
    """Fill size from a HEAD of the public download. Missing files are marked later."""
    for row in files:
        if row.get("size"):
            continue
        request = urllib.request.Request(row["old"], method="HEAD", headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                length = response.headers.get("Content-Length")
                row["size"] = int(length) if length and str(length).isdigit() else 0
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            row["size"] = 0


def main() -> int:
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        print("[r2] CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set. Nothing was copied.")
        return 1
    try:
        usage = r2_usage.measure(token, account)
        used = int(usage["payload"]) + int(usage["metadata"])
        print(f"[r2] current usage {r2_usage.format_gb(used)} before the archive copy")
    except Exception as err:
        print("[r2] usage was not measured:", r2_usage.scrub(str(err), _secrets()))
        print("[r2] refusing to copy because the 9 GB cap cannot be checked")
        return 1
    manifest, state = _load()
    if not manifest.get("files") and not manifest.get("shards"):
        print("[r2] no archive manifest to copy")
        return 1
    files = referenced(manifest)
    _sizes(files)
    decisions = plan_copies(files, used)
    planned = sum(row["planned"] for row in decisions if row["action"] != "drop")
    if used + planned > LIMIT_BYTES:
        print(f"[r2] planned copy still passes 9 GB ({r2_usage.format_gb(used + planned)}). Nothing was copied.")
        return 1
    mapping = {}
    copied = skipped = shrunk = dropped = 0
    copied_bytes = 0
    work = ROOT / ".r2-shrink"
    for row in decisions:
        if row["action"] == "drop":
            dropped += 1
            print(f"[r2] not kept {row['name']} ({row['size']} bytes)")
            continue
        try:
            cap = row["size"] + 4096 if row["size"] else 80 * 1024 * 1024
            body = download(row["old"], cap)
        except Exception as err:
            print("[r2] download failed", row["name"], r2_usage.scrub(str(err), _secrets()))
            return 1
        ext = "." + row["name"].rsplit(".", 1)[-1].lower() if "." in row["name"] else ".bin"
        if row["action"] == "shrink":
            work.mkdir(parents=True, exist_ok=True)
            smaller = shrink_video(body, work)
            if smaller and len(smaller) < len(body):
                body = smaller
                ext = ".mp4"
                shrunk += 1
            elif used + copied_bytes + len(body) > LIMIT_BYTES:
                dropped += 1
                print(f"[r2] not kept {row['name']} (shrink failed and the original does not fit)")
                continue
        if used + copied_bytes + len(body) > LIMIT_BYTES:
            dropped += 1
            print(f"[r2] not kept {row['name']} (copy would pass 9 GB)")
            continue
        digest = hashlib.sha256(body).hexdigest()
        name = object_name(digest, ext)
        key = "archive/" + name
        if object_exists(token, account, key):
            skipped += 1
        else:
            put_object(token, account, key, body, content_type(name))
            copied += 1
            copied_bytes += len(body)
        mapping[row["old"]] = public_url(name)
    if work.is_dir():
        shutil.rmtree(work, ignore_errors=True)
    new_manifest, new_state = rewrite(manifest, state, mapping)
    archive = ROOT / "archive"
    archive.mkdir(parents=True, exist_ok=True)
    (archive / "ia-manifest.json").write_text(json.dumps(new_manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (archive / "ia-state.json").write_text(json.dumps(new_state, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    try:
        after = r2_usage.measure(token, account)
        total = int(after["payload"]) + int(after["metadata"])
        print(f"[r2] usage now {r2_usage.format_gb(total)}")
    except Exception as err:
        total = used + copied_bytes
        print("[r2] usage after the copy was not measured:", r2_usage.scrub(str(err), _secrets()))
    print(
        f"[r2] copied {copied} files ({r2_usage.format_gb(copied_bytes)}), "
        f"already stored {skipped}, shrunk {shrunk}, not kept {dropped}, "
        f"referenced {len(files)}"
    )
    summary = {
        "copied": copied,
        "copiedBytes": copied_bytes,
        "skipped": skipped,
        "shrunk": shrunk,
        "dropped": dropped,
        "referenced": len(files),
        "usageBytes": total,
    }
    (archive / "ia-r2-summary.json").write_text(json.dumps(summary) + "\n", encoding="utf-8")
    warning = r2_usage.warn_line(total)
    if warning:
        print(warning)
    return 0


if __name__ == "__main__":
    sys.exit(main())
