#!/usr/bin/env python3
"""Copy named Internet Archive items onto anonymous ones, then delete the old files.

This is the one-off for the superintelapp-* items. It checks each copy by
size and hash before deleting anything. Metadata writes are best-effort:
a refused creator, title, description, subject, collection, or uploader
is recorded and does not stop the file delete. The access keys are never
printed, and anonymous item identifiers are not printed.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

_ITEM_ID = re.compile(r"x[0-9a-f]{32}")


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if not access or not secret:
        print("[ia-empty] Internet Archive keys are not set; skipping the empty")
        return None
    return access, secret


def _public(line: str) -> str:
    return _ITEM_ID.sub("x…", line)


def _remote_state():
    """Load archive/ia-state.json from the data branch.

    A failed fetch must not be treated as an empty manifest, or the publish
    step would replace the live media map.
    """
    fetch = subprocess.run(["git", "fetch", "-q", "origin", "data"], cwd=ROOT, capture_output=True)
    show = subprocess.run(
        ["git", "show", "origin/data:archive/ia-state.json"],
        cwd=ROOT,
        capture_output=True,
    )
    if show.returncode == 0 and show.stdout:
        try:
            parsed = json.loads(show.stdout.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            return None, False
        if not isinstance(parsed, dict):
            return None, False
        return parsed, True
    if fetch.returncode != 0:
        return None, False
    return {}, True


def main() -> int:
    keys = _keys()
    if not keys:
        return 0
    access, secret = keys
    import ia_backup

    remote, publish = _remote_state()
    if remote is None:
        print("[ia-empty] could not read the data branch manifest; not deleting")
        return 1
    state = remote or ia_backup._blank_state()
    archive_dir = ROOT / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    pace = float(os.environ.get("IA_PACE_SECONDS") or "1.5")
    config = {
        "access": access,
        "secret": secret,
        "endpoint": (os.environ.get("IA_S3_ENDPOINT") or ia_backup.S3_ENDPOINT).strip(),
        "download_base": ia_backup.DOWNLOAD_BASE,
        "metadata_base": ia_backup.METADATA_BASE,
        "pace": pace,
        "backoff": float(os.environ.get("IA_BACKOFF_SECONDS") or "2"),
    }
    try:
        result = ia_backup.empty_named_items(config, state)
    except Exception as err:
        print("[ia-empty] failed", file=sys.stderr)
        print(_public(ia_backup.scrub(str(err), [access, secret])), file=sys.stderr)
        return 1
    manifest = ia_backup.manifest_from_state(state)
    previous = subprocess.run(
        ["git", "show", "origin/data:archive/ia-manifest.json"],
        cwd=ROOT,
        capture_output=True,
    )
    if previous.returncode == 0 and previous.stdout:
        try:
            previous_doc = json.loads(previous.stdout.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            previous_doc = None
        previous_files = previous_doc.get("files") if isinstance(previous_doc, dict) else None
        if isinstance(previous_files, list) and len(manifest.get("files") or []) < len(previous_files):
            print("[ia-empty] not publishing a manifest that drops media")
            publish = False
    if publish:
        (archive_dir / "ia-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        (archive_dir / "ia-state.json").write_text(
            json.dumps(state, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    else:
        print("[ia-empty] leaving the published manifest unchanged")
    for line in result["notes"]:
        print(_public(line))
    print(
        f"[ia-empty] removed {result['deleted']}, "
        f"failures {result['failures']}, "
        f"created {result['new_items']}"
    )
    return 0 if result["failures"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
