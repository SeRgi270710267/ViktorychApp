#!/usr/bin/env python3
"""Upload archive shards to anonymous Internet Archive items.

Item identifiers are x plus 32 hex characters, the same scheme as the media
backup, and they are reused from archive/ia-state.json. The month for each
identifier is recorded only in archive/ia-manifest.json. Items use mediatype
data, noindex, and the title and description "files". The upload does not
send an owner, a subject, or a collection.

IA_ACCESS_KEY and IA_SECRET_KEY come from the environment. When either is
empty this exits 0 and uploads nothing. The keys are never printed.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ia_backup  # noqa: E402


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if not access or not secret:
        return None
    return access, secret


def _same(path: Path, doc) -> bool:
    if not path.is_file():
        return False
    try:
        return json.loads(path.read_text(encoding="utf-8")) == doc
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False


def main() -> int:
    keys = _keys()
    if not keys:
        print("[archive] Internet Archive keys are not set; skipping the upload")
        return 0
    access, secret = keys
    archive_dir = ROOT / "archive"
    shards = ia_backup.load_shards(archive_dir)
    if not shards:
        print("[archive] no shards to upload")
        return 0
    state = ia_backup.load_state(archive_dir)
    config = {
        "access": access,
        "secret": secret,
        "endpoint": (os.environ.get("IA_S3_ENDPOINT") or ia_backup.S3_ENDPOINT).strip(),
        "download_base": ia_backup.DOWNLOAD_BASE,
        "metadata_base": ia_backup.METADATA_BASE,
        "pace": float(os.environ.get("IA_PACE_SECONDS") or "1.5"),
        "backoff": float(os.environ.get("IA_BACKOFF_SECONDS") or "2"),
        "max_uploads": int(os.environ.get("IA_MAX_UPLOADS") or "30"),
        "max_bytes": int(os.environ.get("IA_MAX_BYTES") or str(48 * 1024 * 1024)),
    }
    try:
        result = ia_backup.run_backup(config, [], shards, state)
    except Exception as err:
        print("[archive] Internet Archive upload failed", file=sys.stderr)
        print(ia_backup.scrub(str(err), [access, secret]), file=sys.stderr)
        return 1
    archive_dir.mkdir(parents=True, exist_ok=True)
    saved = result["state"]
    manifest = ia_backup.manifest_from_state(saved)
    manifest_path = archive_dir / "ia-manifest.json"
    state_path = archive_dir / "ia-state.json"
    if not _same(manifest_path, manifest):
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if not _same(state_path, saved):
        state_path.write_text(json.dumps(saved, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    anonymous = sum(1 for value in (saved.get("items") or {}).values() if ia_backup.valid_item_id(value))
    print(f"[archive] uploaded {len(result['uploaded'])} files, failures {result['failures']}, anonymous items {anonymous}")
    return 1 if result["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
