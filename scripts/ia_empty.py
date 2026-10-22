#!/usr/bin/env python3
"""Delete every file this account put on Internet Archive.

Exits before any request unless IA_UPLOADS_ENABLED is the literal true.
Internet Archive's own _files.xml, _meta.xml, and _meta.sqlite may remain.
Nothing is emailed. The keys are never printed.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ia_backup  # noqa: E402
import ia_retire  # noqa: E402

CATALOG = ("_files.xml", "_meta.xml", "_meta.sqlite")
DOWNLOAD_ITEM = re.compile(r"https://archive\.org/download/([^/?#]+)/")


def allowed_catalog(name: str) -> bool:
    return str(name or "").endswith(CATALOG)


def files_to_remove(doc: dict) -> list[str]:
    original, extra = split_files(doc)
    return original + extra


def split_files(doc: dict) -> tuple[list[str], list[str]]:
    """Original uploads, then other non-catalog files such as a torrent."""
    original = []
    extra = []
    for row in (doc or {}).get("files") or []:
        name = str((row or {}).get("name") or "")
        if not name or allowed_catalog(name):
            continue
        if str((row or {}).get("source") or "original") == "original":
            original.append(name)
        else:
            extra.append(name)
    return original, extra


def _item_from_url(url: str) -> str:
    match = DOWNLOAD_ITEM.search(str(url or ""))
    if not match:
        return ""
    return urllib.parse.unquote(match.group(1))


def collect_ids(manifest: dict, state: dict) -> list[str]:
    """Anonymous items from the data branch, plus the named items already in the repo."""
    found = []
    seen = set()

    def add(value) -> None:
        item = str(value or "").strip()
        if not item or item in seen:
            return
        if ia_backup.valid_item_id(item) or ia_backup.old_slot(item):
            seen.add(item)
            found.append(item)

    for source in (manifest or {}, state or {}):
        for ident in (source.get("items") or {}).values():
            add(ident)
        for ident in source.get("noindexBlocked") or {}:
            add(ident)
    for row in (manifest or {}).get("files") or []:
        if isinstance(row, dict):
            add(_item_from_url(row.get("ia")))
            add(_item_from_url(row.get("a")))
    for url in ((manifest or {}).get("shards") or {}).values():
        add(_item_from_url(url))
    for item in ia_backup.KNOWN_OLD_ITEMS:
        add(item)
    return found


def _read(metadata_base: str, item: str, urlopen) -> tuple[int, dict | None]:
    return ia_retire._read_item(metadata_base, item, urlopen)


def _remove_one(endpoint, item, name, access, secret, opener) -> int:
    return ia_backup._delete_status(endpoint, item, name, access, secret, opener, ia_retire.DROP_HEADERS)


def empty_items(items: list[str], *, urlopen, opener, access: str, secret: str, endpoint: str, metadata_base: str, sleep=time.sleep, pace: float = 0.5) -> dict:
    """Delete non-catalog files, then re-read the public metadata."""
    notes = []
    deleted = refused = 0
    empty = []
    holding = {}
    for item in items:
        status, doc = _read(metadata_base, item, urlopen)
        if status == 404:
            empty.append(item)
            notes.append(f"[ia-empty] {item} is already gone")
            continue
        if status != 200 or doc is None:
            holding[item] = ["unread"]
            notes.append(f"[ia-empty] {item} metadata {status}")
            continue
        names = files_to_remove(doc)
        if not names:
            empty.append(item)
            notes.append(f"[ia-empty] {item} has no original files")
            continue
        for name in names:
            code = 0
            delay = 2.0
            for attempt in range(4):
                code = _remove_one(endpoint, item, name, access, secret, opener)
                if code in {200, 202, 204, 404}:
                    break
                if attempt + 1 < 4 and code in {0, 429, 503}:
                    sleep(delay)
                    delay = min(delay * 2, 30)
                    continue
                break
            if code in {200, 202, 204, 404}:
                deleted += 1
                notes.append(f"[ia-empty] removed {item}/{name}")
            else:
                refused += 1
                notes.append(f"[ia-empty] could not remove {item}/{name} ({code})")
            if pace:
                sleep(pace)
        original, extra = split_files(doc)
        delay = 5.0
        for _ in range(4):
            status, doc = _read(metadata_base, item, urlopen)
            if status == 404:
                original, extra = [], []
                break
            if status == 200 and doc is not None:
                original, extra = split_files(doc)
                if not original and not extra:
                    break
            sleep(delay)
            delay = min(delay * 2, 15)
        if original:
            holding[item] = original
            notes.append(f"[ia-empty] {item} still lists {len(original)} original files")
        else:
            empty.append(item)
            notes.append(f"[ia-empty] {item} has no original files")
        if extra:
            notes.append(f"[ia-empty] {item} still lists metadata files: {' '.join(extra)}")
    return {
        "deleted": deleted,
        "refused": refused,
        "empty": empty,
        "holding": holding,
        "notes": [ia_backup.scrub(line, [access, secret]) for line in notes],
    }


def _git_json(spec: str) -> dict:
    proc = subprocess.run(["git", "show", spec], cwd=ROOT, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        return {}
    try:
        data = json.loads(proc.stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _load() -> tuple[dict, dict]:
    subprocess.run(["git", "fetch", "-q", "origin", "data"], cwd=ROOT, check=False)
    return _git_json("origin/data:archive/ia-manifest.json"), _git_json("origin/data:archive/ia-state.json")


def main() -> int:
    if not ia_backup.uploads_enabled():
        print("[ia-empty] IA_UPLOADS_ENABLED is not true. Nothing was deleted.")
        return 0
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if not access or not secret:
        print("[ia-empty] IA_ACCESS_KEY or IA_SECRET_KEY is not set. Nothing was deleted.")
        return 1
    manifest, state = _load()
    items = collect_ids(manifest, state)
    if not items:
        print("[ia-empty] no items to empty")
        return 1
    endpoint = (os.environ.get("IA_S3_ENDPOINT") or ia_backup.S3_ENDPOINT).strip()
    pace = float(os.environ.get("IA_PACE_SECONDS") or "0.5")
    result = empty_items(
        items,
        urlopen=urllib_request_urlopen(),
        opener=ia_backup._opener(),
        access=access,
        secret=secret,
        endpoint=endpoint,
        metadata_base=ia_backup.METADATA_BASE,
        sleep=time.sleep,
        pace=pace,
    )
    for line in result["notes"]:
        if line:
            print(line, flush=True)
    print(
        f"[ia-empty] items {len(items)}, deleted {result['deleted']}, "
        f"refused {result['refused']}, empty {len(result['empty'])}, "
        f"still holding {len(result['holding'])}"
    )
    if result["empty"]:
        print("[ia-empty] empty items: " + " ".join(result["empty"]))
    for item, names in result["holding"].items():
        shown = " ".join(names[:8])
        print(f"[ia-empty] still holding {item}: {shown}")
    return 1 if result["holding"] else 0


def urllib_request_urlopen():
    import urllib.request
    return urllib.request.urlopen


if __name__ == "__main__":
    sys.exit(main())
