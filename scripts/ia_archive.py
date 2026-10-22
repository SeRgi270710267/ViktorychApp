#!/usr/bin/env python3
"""Upload archive shards to anonymous Internet Archive items.

Each item identifier is x plus 32 hex characters. The month for that
identifier is recorded in archive/ia-manifest.json, which is the address
the site and the snapshot pull use. File names are content hashes. Items
are mediatype data, noindex, with the title and description "files".
No creator, subject, or collection is sent.

IA_ACCESS_KEY and IA_SECRET_KEY come from the environment. When either is
empty this exits 0 and uploads nothing. The keys are never printed.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if not access or not secret:
        return None
    return access, secret


def upload_archive(config: dict, shards: dict, state: dict | None = None, sleep=None):
    """Upload shard JSON to the same anonymous items the media backup uses."""
    import time

    import ia_backup

    current = state if isinstance(state, dict) else ia_backup._blank_state()
    return ia_backup.run_backup(config, [], shards, current, sleep=sleep or time.sleep)


def _keep_manifest(before: dict | None, manifest: dict) -> dict:
    """Keep media rows already published when this run only refreshed shards."""
    import ia_backup

    if not isinstance(before, dict):
        return manifest
    merged = dict(manifest)
    if before.get("files") and not merged.get("files"):
        merged["files"] = before["files"]
        merged["posts"] = before.get("posts") or {}
    items = {}
    for key, value in (before.get("items") or {}).items():
        if ia_backup.valid_item_id(str(value or "")):
            items[key] = value
    for key, value in (merged.get("items") or {}).items():
        if ia_backup.valid_item_id(str(value or "")):
            items[key] = value
    shards = {}
    for key, value in list((before.get("shards") or {}).items()) + list((merged.get("shards") or {}).items()):
        if str(value or "").startswith("https://archive.org/download/x"):
            shards[key] = value
    merged["items"] = items
    merged["shards"] = shards
    return merged


def main() -> int:
    keys = _keys()
    if not keys:
        print("[archive] Internet Archive keys are not set; skipping the upload")
        return 0
    access, secret = keys
    import ia_backup

    archive_dir = ROOT / "archive"
    shards = ia_backup.load_shards(archive_dir)
    if not shards:
        print("[archive] no shards to upload")
        return 0
    before = None
    manifest_path = archive_dir / "ia-manifest.json"
    if manifest_path.is_file():
        before = ia_backup._load_json_bytes(manifest_path.read_bytes())
        if not isinstance(before, dict):
            before = None
    state = ia_backup.load_state(archive_dir)
    pace = float(os.environ.get("IA_PACE_SECONDS") or "1.5")
    config = {
        "access": access,
        "secret": secret,
        "endpoint": (os.environ.get("IA_S3_ENDPOINT") or ia_backup.S3_ENDPOINT).strip(),
        "download_base": ia_backup.DOWNLOAD_BASE,
        "metadata_base": ia_backup.METADATA_BASE,
        "pace": pace,
        "backoff": float(os.environ.get("IA_BACKOFF_SECONDS") or "2"),
        "max_uploads": int(os.environ.get("IA_MAX_UPLOADS") or "30"),
        "max_bytes": int(os.environ.get("IA_MAX_BYTES") or str(48 * 1024 * 1024)),
    }
    try:
        result = upload_archive(config, shards, state)
        stamped = ia_backup.stamp_uploaded(config, result["uploaded"])
    except Exception as err:
        print("[archive] Internet Archive upload failed", file=sys.stderr)
        print(ia_backup.scrub(str(err), [access, secret]), file=sys.stderr)
        return 1
    manifest = _keep_manifest(before, ia_backup.manifest_from_state(result["state"]))
    archive_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (archive_dir / "ia-state.json").write_text(
        json.dumps(result["state"], ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    hidden = re.compile(r"x[0-9a-f]{32}")
    for line in result["notes"] + stamped["notes"]:
        print(hidden.sub("x…", ia_backup.scrub(line, [access, secret])))
    if result["failures"]:
        print(f"[archive] Internet Archive upload failed ({result['failures']})", file=sys.stderr)
        return 1
    print(f"[archive] uploaded {len(result['uploaded'])} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
