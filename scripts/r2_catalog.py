#!/usr/bin/env python3
"""Copy the private catalog between the runner and R2.

The Pages deploy publishes the shell. Signed-in readers load feeds.json and
the other catalog files from R2, so a refresh can update them without
another deploy. Nothing here prints credentials or file bodies.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

PULL_KEYS = (
    "feeds.json",
    "stories.json",
    "people.json",
    "suggestions.json",
    "status.json",
    "feeds.config.json",
)
CACHE_KEY = "sync/source-cache.json"


def pull(root: Path) -> int:
    from tiktok_sync import r2_get

    restored = 0
    for key in PULL_KEYS:
        blob = r2_get(key)
        if not blob:
            continue
        dest = root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        restored += 1
        print(f"[r2] restored {key}")
    cached = r2_get(CACHE_KEY)
    if cached:
        (root / ".feed-http-cache.json").write_bytes(cached)
        print("[r2] restored source cache")
    print(f"[r2] pull {restored} catalog files")
    return 0


def push(root: Path) -> int:
    from account_deletions import load_deletions, scrub_bytes
    from accounts_publish import collect
    from tiktok_sync import r2_put

    hashes, deletion_salt = load_deletions()
    failed = 0
    stored = 0
    for key, path in sorted(collect(root).items()):
        payload = path.read_bytes()
        try:
            payload = scrub_bytes(key, payload, hashes, deletion_salt)
        except (TypeError, ValueError):
            print(f"[r2] deletion scrub skipped for {key}")
        if r2_put(key, payload):
            stored += 1
        else:
            failed += 1
            print(f"[r2] upload failed {key}")
    cache = root / ".feed-http-cache.json"
    cache_failed = False
    if cache.is_file() and not r2_put(CACHE_KEY, cache.read_bytes()):
        cache_failed = True
        print("[r2] source cache upload failed")
    print(f"[r2] stored {stored} catalog files" + (f", {failed} failed" if failed else ""))
    if failed or cache_failed or stored == 0:
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] not in ("pull", "push"):
        print("usage: r2_catalog.py pull|push", file=sys.stderr)
        return 2
    root = ROOT
    if args[0] == "pull":
        return pull(root)
    return push(root)


if __name__ == "__main__":
    sys.exit(main())
