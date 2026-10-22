#!/usr/bin/env python3
"""Copy anything still needed off named Internet Archive items, then delete them.

`copy` uploads remaining files onto anonymous items, checks the new bytes,
and writes archive/ia-manifest.json. `delete` runs only after that manifest
is on the data branch and every copied file still matches its hash. It then
removes every file on the named items. Catalog files that the file API leaves
in place are removed by asking Internet Archive to delete that named item.
Anonymous items are never deleted. The run also tries to blank creator, title,
description, subject, and collection. A refusal is recorded and does not stop
the rest. The access keys are never printed, and anonymous item ids are counted
rather than listed.

IA_ACCESS_KEY and IA_SECRET_KEY come from the environment.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ia_backup  # noqa: E402

BLANK_FIELDS = ("creator", "title", "description", "subject", "collection")


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if access and secret:
        return access, secret
    print("[ia-retire] IA_ACCESS_KEY or IA_SECRET_KEY is not set. Nothing was changed.")
    return None


def _config(access: str, secret: str) -> dict:
    return {
        "access": access,
        "secret": secret,
        "endpoint": (os.environ.get("IA_S3_ENDPOINT") or ia_backup.S3_ENDPOINT).strip(),
        "download_base": ia_backup.DOWNLOAD_BASE,
        "metadata_base": ia_backup.METADATA_BASE,
        "pages_origin": ia_backup.pages_origin(),
        "pace": float(os.environ.get("IA_PACE_SECONDS") or "1"),
        "backoff": float(os.environ.get("IA_BACKOFF_SECONDS") or "2"),
    }


def _write_outputs(archive_dir: Path, state: dict) -> dict:
    archive_dir.mkdir(parents=True, exist_ok=True)
    manifest = ia_backup.manifest_from_state(state)
    (archive_dir / "ia-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    (archive_dir / "ia-state.json").write_text(
        json.dumps(state, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return manifest


def manifest_covers(manifest: dict, state: dict) -> bool:
    """True when every copied download URL is in the manifest the site reads."""
    if not isinstance(manifest, dict):
        return False
    live = set()
    for row in manifest.get("files") or []:
        if isinstance(row, dict) and row.get("a"):
            live.add(row["a"])
    for url in (manifest.get("shards") or {}).values():
        live.add(url)
    copied = list((state.get("copied") or {}).values())
    if not copied:
        return True
    return all((row.get("url") or "") in live for row in copied)


def _body_ok(urlopen, url: str, digest: str, size, sleep, tries: int = 4) -> bool:
    delay = 1.0
    for attempt in range(tries):
        status, body = ia_backup._http_bytes(url, urlopen)
        hash_ok = status == 200 and bool(body) and hashlib.sha256(body).hexdigest() == digest
        size_ok = size is None or (bool(body) and len(body) == int(size))
        if hash_ok and size_ok:
            return True
        if attempt + 1 < tries:
            sleep(delay)
            delay = min(delay * 2, 10)
    return False


def verify_copies(config: dict, state: dict, sleep=time.sleep) -> dict:
    """Download each copied file and require the stored hash, and size when known."""
    urlopen = config.get("urlopen") or urllib.request.urlopen
    notes = []
    checked = 0
    failures = []
    secrets = [config.get("access") or "", config.get("secret") or ""]
    for key, row in (state.get("copied") or {}).items():
        url = str(row.get("url") or "")
        digest = str(row.get("digest") or "")
        if not _body_ok(urlopen, url, digest, row.get("size"), sleep):
            failures.append(key)
            notes.append(f"[ia-retire] copy check failed {key}")
            continue
        checked += 1
    return {"checked": checked, "failures": failures, "notes": [ia_backup.scrub(line, secrets) for line in notes]}


def data_branch_manifest() -> dict | None:
    """The manifest commit that was just pushed, read from origin/data."""
    subprocess.run(["git", "fetch", "-q", "origin", "data"], cwd=ROOT, capture_output=True)
    proc = subprocess.run(["git", "show", "origin/data:archive/ia-manifest.json"], cwd=ROOT, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        doc = json.loads(proc.stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def _old_items(config: dict) -> list:
    if "old_items" in config:
        return list(config["old_items"])
    urlopen = config.get("urlopen") or urllib.request.urlopen
    return ia_backup.discover_old_items(urlopen)


def _named_item(item: str) -> bool:
    return bool(ia_backup.old_slot(item)) and not ia_backup.valid_item_id(item)


def _file_names(doc: dict) -> list:
    names = []
    for row in (doc or {}).get("files") or []:
        name = str((row or {}).get("name") or "")
        if name:
            names.append(name)
    return names


def _read_item(metadata_base: str, item: str, urlopen) -> tuple[int, dict | None]:
    status, body = ia_backup._http_bytes(metadata_base.rstrip("/") + "/" + urllib.parse.quote(item), urlopen)
    if status != 200 or not body:
        return status, None
    try:
        doc = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return status, None
    return status, doc if isinstance(doc, dict) else None


DROP_HEADERS = {"x-archive-cascade-delete": "1", "x-archive-keep-old-version": "0"}


def _s3_remove(endpoint: str, item: str, name: str, access: str, secret: str, opener, notes: list) -> bool:
    code = ia_backup._delete_status(endpoint, item, name, access, secret, opener, DROP_HEADERS)
    if code in {200, 202, 204, 404}:
        notes.append(f"[ia-retire] removed {item}/{name}")
        return True
    notes.append(f"[ia-retire] could not remove {item}/{name} ({code})")
    return False


def _task_bytes(payload: bytes) -> bytes:
    if len(payload) >= 2 and payload[:2] == b"\x1f\x8b":
        try:
            return gzip.decompress(payload)
        except OSError:
            return payload
    return payload


def _task_accepted(status: int, payload: bytes) -> bool:
    if status not in {200, 201, 202} or not payload:
        return False
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return False
    if not isinstance(doc, dict) or doc.get("success") is False or doc.get("error"):
        return False
    value = doc.get("value") if isinstance(doc.get("value"), dict) else {}
    return bool(doc.get("success") is True or value.get("task_id") or doc.get("task_id"))


def _task_detail(status: int, payload: bytes, access: str, secret: str) -> str:
    text = ""
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        doc = None
    if isinstance(doc, dict) and isinstance(doc.get("error"), str):
        text = " ".join(doc["error"].split())
    text = ia_backup.scrub(text, [access, secret])
    if "@" in text or len(text) > 60:
        text = ""
    return f"{status or 0} {text}".strip()


def _archive_host(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return host == "archive.org" or host.endswith(".archive.org")


def _post_task(opener, url: str, body: bytes, access: str, secret: str, depth: int = 0) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"LOW {access}:{secret}",
            "Content-Type": "application/json",
            "User-Agent": ia_backup.UA,
            "X-Accept-Reduced-Priority": "1",
        },
    )
    try:
        with opener.open(request, timeout=60) as response:
            return getattr(response, "status", 200), _task_bytes(response.read() or b"")
    except urllib.error.HTTPError as err:
        try:
            payload = err.read() or b""
        except OSError:
            payload = b""
        location = ""
        if err.headers:
            location = err.headers.get("Location") or ""
        if depth == 0 and err.code in {301, 302, 303, 307, 308} and location and _archive_host(location):
            return _post_task(opener, urllib.parse.urljoin(url, location), body, access, secret, depth + 1)
        return err.code, _task_bytes(payload)
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, b""


def _submit_delete_task(item: str, access: str, secret: str, opener, tasks_url: str, sleep) -> tuple[str, str]:
    """Ask Internet Archive to delete one named item. Returns accepted or refused, plus a short status."""
    if not _named_item(item):
        return "refused", "0"
    # Match the Tasks API client: identifier and cmd, and no empty args object.
    body = json.dumps({"identifier": item, "cmd": "delete.php"}, separators=(",", ":")).encode()
    delay = 5.0
    status = 0
    payload = b""
    for attempt in range(4):
        status, payload = _post_task(opener, tasks_url, body, access, secret)
        if _task_accepted(status, payload):
            return "accepted", ""
        if attempt + 1 < 4 and status in {0, 429, 503}:
            sleep(delay)
            delay = min(delay * 2, 60)
            continue
        break
    return "refused", _task_detail(status, payload, access, secret)


def _wait_until_clear(metadata_base: str, item: str, urlopen, sleep, wait: float) -> list:
    started = time.monotonic()
    delay = 5.0
    last = ["unread"]
    while True:
        status, doc = _read_item(metadata_base, item, urlopen)
        if status == 404:
            return []
        if status == 200 and doc is not None:
            last = _file_names(doc)
            if not last:
                return []
        if time.monotonic() - started >= wait:
            return last
        sleep(delay)
        delay = min(delay * 2, 30)


def purge_files(config: dict, state: dict, sleep=time.sleep) -> dict:
    """Delete every file on the named items. Nothing here uploads."""
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or ia_backup._opener()
    metadata_base = (config.get("metadata_base") or ia_backup.METADATA_BASE).rstrip("/")
    tasks_url = (config.get("tasks_base") or "https://archive.org/services/tasks.php").rstrip("/")
    endpoint = config.get("endpoint") or ia_backup.S3_ENDPOINT
    access = config["access"]
    secret = config["secret"]
    pace = float(config.get("pace") if config.get("pace") is not None else 1)
    wait = float(config["delete_wait"]) if config.get("delete_wait") is not None else 600.0
    notes = []
    deleted = 0
    remaining = {}
    emptied = []
    tasks_accepted = 0
    tasks_refused = 0
    for item in _old_items(config):
        if not _named_item(item):
            continue
        status, doc = _read_item(metadata_base, item, urlopen)
        if status == 404 or (status == 200 and doc is not None and not _file_names(doc)):
            notes.append(f"[ia-retire] {item} is already empty")
            emptied.append(item)
            remaining[item] = []
            continue
        if status != 200 or doc is None:
            notes.append(f"[ia-retire] {item} metadata {status}")
            remaining[item] = ["unread"]
            continue
        for name in _file_names(doc):
            if _s3_remove(endpoint, item, name, access, secret, opener, notes):
                deleted += 1
            if pace:
                sleep(pace)
        status, doc = _read_item(metadata_base, item, urlopen)
        left = _file_names(doc) if status == 200 and doc is not None else ([] if status == 404 else ["unread"])
        if left and left != ["unread"]:
            for name in left:
                if _s3_remove(endpoint, item, name, access, secret, opener, notes):
                    deleted += 1
                if pace:
                    sleep(pace)
            status, doc = _read_item(metadata_base, item, urlopen)
            left = _file_names(doc) if status == 200 and doc is not None else ([] if status == 404 else ["unread"])
        if not left:
            emptied.append(item)
            remaining[item] = []
            notes.append(f"[ia-retire] emptied {item}")
            continue
        if left == ["unread"] or status != 200:
            remaining[item] = left
            notes.append(f"[ia-retire] {item} still has {len(left)} files")
            continue
        outcome, detail = _submit_delete_task(item, access, secret, opener, tasks_url, sleep)
        if outcome == "accepted":
            tasks_accepted += 1
            notes.append(f"[ia-retire] {item} delete task accepted")
            left = _wait_until_clear(metadata_base, item, urlopen, sleep, wait)
        else:
            tasks_refused += 1
            notes.append(f"[ia-retire] {item} delete task refused {detail}".rstrip())
        remaining[item] = left
        if not left:
            emptied.append(item)
            notes.append(f"[ia-retire] emptied {item}")
        else:
            notes.append(f"[ia-retire] {item} still has {len(left)} files")
    return {
        "deleted": deleted,
        "emptied": emptied,
        "remaining": remaining,
        "tasks_accepted": tasks_accepted,
        "tasks_refused": tasks_refused,
        "notes": [ia_backup.scrub(line, [access, secret]) for line in notes],
    }


def _field_status(before, after, key: str) -> str:
    current = after.get(key)
    if current in (None, "", [], {}):
        return "removed" if key in before else "absent"
    if key in ("title", "description") and str(current) == "files":
        return "overwritten"
    return "refused"


def blank_metadata(config: dict, sleep=time.sleep) -> dict:
    """Clear identifying metadata. Each field is its own write so one refusal stands alone."""
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or ia_backup._opener()
    metadata_base = (config.get("metadata_base") or ia_backup.METADATA_BASE).rstrip("/")
    access = config["access"]
    secret = config["secret"]
    notes = []
    report = {}
    for item in _old_items(config):
        if not ia_backup.old_slot(item):
            continue
        before = ia_backup._item_metadata(item, metadata_base, urlopen)
        if not before:
            continue
        fields = {}
        for key in BLANK_FIELDS:
            if key not in before or before.get(key) in (None, "", [], {}):
                if key in ("title", "description"):
                    ia_backup._patch_metadata(item, {key: "files"}, (), access, secret, urlopen, opener, metadata_base, sleep)
                    fields[key] = "pending"
                else:
                    fields[key] = "absent"
                continue
            ia_backup._patch_metadata(item, {}, (key,), access, secret, urlopen, opener, metadata_base, sleep)
            if key in ("title", "description"):
                mid = ia_backup._item_metadata(item, metadata_base, urlopen)
                if mid.get(key) not in (None, "", [], {}):
                    ia_backup._patch_metadata(item, {key: "files"}, (), access, secret, urlopen, opener, metadata_base, sleep)
        if not ia_backup._noindex_set(before):
            ia_backup._patch_metadata(item, {"noindex": "true"}, (), access, secret, urlopen, opener, metadata_base, sleep)
        if before.get("uploader"):
            ia_backup._patch_metadata(item, {}, ("uploader",), access, secret, urlopen, opener, metadata_base, sleep)
        after = ia_backup._item_metadata(item, metadata_base, urlopen)
        for key in BLANK_FIELDS:
            if fields.get(key) == "absent":
                continue
            fields[key] = _field_status(before, after, key)
        if ia_backup._noindex_set(after):
            fields["noindex"] = "set"
        elif "noindex" in before or "noindex" in after:
            fields["noindex"] = "refused"
        else:
            fields["noindex"] = "refused"
        if before.get("uploader"):
            fields["uploader"] = "removed" if not after.get("uploader") else "refused"
        report[item] = fields
        summary = " ".join(f"{key} {value}" for key, value in fields.items())
        notes.append(f"[ia-retire] metadata {item}: {summary}")
    anonymous = []
    seen = set()
    for ident in (config.get("state") or {}).get("items", {}).values():
        if ia_backup.valid_item_id(ident) and ident not in seen:
            seen.add(ident)
            anonymous.append(ident)
    uploader_left = 0
    for ident in anonymous:
        meta = ia_backup._item_metadata(ident, metadata_base, urlopen)
        if not meta:
            continue
        if meta.get("creator"):
            ia_backup._patch_metadata(ident, {}, ("creator",), access, secret, urlopen, opener, metadata_base, sleep)
        if not meta.get("uploader"):
            continue
        ia_backup._patch_metadata(ident, {}, ("uploader",), access, secret, urlopen, opener, metadata_base, sleep)
        after = ia_backup._item_metadata(ident, metadata_base, urlopen)
        if after.get("uploader"):
            uploader_left += 1
        if pace_left := config.get("pace"):
            sleep(pace_left)
    return {
        "items": report,
        "anonymous": len(anonymous),
        "uploader_left": uploader_left,
        "notes": [ia_backup.scrub(line, [access, secret]) for line in notes],
    }


def _print_notes(notes) -> None:
    for line in notes:
        if line:
            print(line, flush=True)


def copy_named(config: dict, state: dict, sleep=time.sleep) -> dict:
    moved = ia_backup.migrate_copies(config, state, sleep=sleep)
    verified = verify_copies(config, state, sleep=sleep)
    return {"moved": moved, "verified": verified, "failures": moved["failures"] + len(verified["failures"])}


def main(argv: list[str] | None = None) -> int:
    mode = (argv or sys.argv[1:2] or [""])[0]
    if mode not in {"copy", "delete"}:
        print("[ia-retire] use copy or delete", file=sys.stderr)
        return 2
    keys = _keys()
    if not keys:
        return 1
    access, secret = keys
    config = _config(access, secret)
    archive_dir = ROOT / "archive"
    state = ia_backup.load_state(archive_dir)
    config["state"] = state
    try:
        if mode == "copy":
            result = copy_named(config, state)
            _write_outputs(archive_dir, state)
            _print_notes(result["moved"]["notes"])
            _print_notes(result["verified"]["notes"])
            anonymous = sum(1 for value in (state.get("items") or {}).values() if ia_backup.valid_item_id(value))
            print(
                f"[ia-retire] copied checks {result['verified']['checked']}, "
                f"failures {result['failures']}, anonymous items {anonymous}"
            )
            return 1 if result["failures"] else 0
        verified = verify_copies(config, state, sleep=time.sleep)
        _print_notes(verified["notes"])
        published = data_branch_manifest()
        if verified["failures"] or not manifest_covers(published if published is not None else {}, state):
            print("[ia-retire] not deleting; a copy or the data-branch manifest failed the check")
            return 1
        purged = purge_files(config, state)
        blanked = blank_metadata(config)
        _write_outputs(archive_dir, state)
        _print_notes(purged["notes"])
        _print_notes(blanked["notes"])
        print(
            f"[ia-retire] emptied {len(purged['emptied'])}, "
            f"removed {purged['deleted']}, "
            f"delete tasks accepted {purged['tasks_accepted']}, "
            f"delete tasks refused {purged['tasks_refused']}, "
            f"anonymous items {blanked['anonymous']}, "
            f"uploader still set on {blanked['uploader_left']}"
        )
        leftovers = [name for names in purged["remaining"].values() for name in names]
        if leftovers:
            print(f"[ia-retire] files still listed {len(leftovers)}")
        return 1 if leftovers else 0
    except Exception as err:
        print("[ia-retire] failed", file=sys.stderr)
        print(ia_backup.scrub(str(err), [access, secret]), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
