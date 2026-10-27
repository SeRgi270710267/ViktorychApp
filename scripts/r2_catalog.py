#!/usr/bin/env python3
"""Copy the private catalog between the runner and R2.

The Pages deploy publishes the shell. Signed-in readers load feeds.json and
the other catalog files from R2, so a refresh can update them without
another deploy. Nothing here prints credentials or file bodies.
"""

from __future__ import annotations

import sys
import time
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
PUSH_BUDGET_SECONDS = 70


def ordered_keys(items: dict[str, Path]) -> list[tuple[str, Path]]:
    """Catalog files the reader needs first, then the newest of the rest.

    Archive and community JSON sort ahead of feeds.json alphabetically, so a
    short upload budget has to send the live catalog before those shards.
    """
    first = []
    seen = set()
    for key in PULL_KEYS:
        path = items.get(key)
        if path is None:
            continue
        first.append((key, path))
        seen.add(key)
    rest = []
    for key, path in items.items():
        if key in seen:
            continue
        try:
            stamp = path.stat().st_mtime
        except OSError:
            stamp = 0
        rest.append((stamp, key, path))
    rest.sort(key=lambda row: (-row[0], row[1]))
    return first + [(key, path) for _stamp, key, path in rest]


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
    started = time.monotonic()
    stored = 0
    deferred = 0
    priority_failed = False
    priority = set(PULL_KEYS)

    def send(key: str, payload: bytes) -> bool:
        try:
            payload = scrub_bytes(key, payload, hashes, deletion_salt)
        except (TypeError, ValueError):
            print(f"[r2] deletion scrub skipped for {key}")
        return bool(r2_put(key, payload))

    ordered = ordered_keys(collect(root))
    cache = root / ".feed-http-cache.json"
    extras = []
    for key, path in ordered:
        if key in priority:
            if send(key, path.read_bytes()):
                stored += 1
            else:
                priority_failed = True
                print(f"[r2] upload failed {key}")
        else:
            extras.append((key, path))
    if cache.is_file():
        if send(CACHE_KEY, cache.read_bytes()):
            stored += 1
        else:
            priority_failed = True
            print("[r2] source cache upload failed")
    for index, (key, path) in enumerate(extras):
        if time.monotonic() - started >= PUSH_BUDGET_SECONDS:
            deferred += len(extras) - index
            break
        if send(key, path.read_bytes()):
            stored += 1
        else:
            print(f"[r2] upload failed {key}")
    if deferred:
        print(f"[r2] deferred {deferred} catalog files")
    print(f"[r2] stored {stored} catalog files")
    if priority_failed or stored == 0:
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
