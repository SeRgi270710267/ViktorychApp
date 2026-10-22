#!/usr/bin/env python3
"""Copy anything still needed off named Internet Archive items, then delete them.

`copy` uploads remaining files onto anonymous items, checks the new bytes,
and writes archive/ia-manifest.json. `delete` runs only after that manifest
is on the data branch and every copied file still matches its hash. It then
removes every file on the named items and tries to blank creator, title,
description, subject, and collection. A refusal is recorded and does not stop
the rest. The access keys are never printed, and anonymous item ids are counted
rather than listed.

IA_ACCESS_KEY and IA_SECRET_KEY come from the environment.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
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


def purge_files(config: dict, state: dict, sleep=time.sleep) -> dict:
    """Delete every file on the named items. Nothing here uploads."""
    urlopen = config.get("urlopen") or urllib.request.urlopen
    opener = config.get("opener") or ia_backup._opener()
    metadata_base = (config.get("metadata_base") or ia_backup.METADATA_BASE).rstrip("/")
    endpoint = config.get("endpoint") or ia_backup.S3_ENDPOINT
    access = config["access"]
    secret = config["secret"]
    pace = float(config.get("pace") if config.get("pace") is not None else 1)
    notes = []
    deleted = 0
    remaining = {}
    emptied = []
    for item in _old_items(config):
        if not ia_backup.old_slot(item):
            continue
        doc = ia_backup._http_json(metadata_base + "/" + urllib.parse.quote(item), urlopen) or {}
        names = []
        for row in doc.get("files") or []:
            name = str((row or {}).get("name") or "")
            if name:
                names.append(name)
        if not names and not doc.get("metadata") and not doc.get("files"):
            notes.append(f"[ia-retire] {item} is already empty")
            emptied.append(item)
            remaining[item] = []
            continue
        for name in names:
            if ia_backup._delete_object(endpoint, item, name, access, secret, opener):
                deleted += 1
                notes.append(f"[ia-retire] removed {item}/{name}")
            else:
                notes.append(f"[ia-retire] could not remove {item}/{name}")
            if pace:
                sleep(pace)
        after = ia_backup._http_json(metadata_base + "/" + urllib.parse.quote(item), urlopen) or {}
        left = [str((row or {}).get("name") or "") for row in (after.get("files") or []) if (row or {}).get("name")]
        if left:
            for name in left:
                if ia_backup._delete_object(endpoint, item, name, access, secret, opener):
                    deleted += 1
                    notes.append(f"[ia-retire] removed {item}/{name}")
                if pace:
                    sleep(pace)
            after = ia_backup._http_json(metadata_base + "/" + urllib.parse.quote(item), urlopen) or {}
            left = [str((row or {}).get("name") or "") for row in (after.get("files") or []) if (row or {}).get("name")]
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
            f"anonymous items {blanked['anonymous']}, "
            f"uploader still set on {blanked['uploader_left']}"
        )
        leftovers = sum(len(names) for names in purged["remaining"].values())
        return 1 if leftovers else 0
    except Exception as err:
        print("[ia-retire] failed", file=sys.stderr)
        print(ia_backup.scrub(str(err), [access, secret]), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
