#!/usr/bin/env python3
"""Copy the private catalog between the runner and R2.

The Pages deploy publishes the shell. Signed-in readers load feeds.json and
the other catalog files from R2, so a refresh can update them without
another deploy. A missing or empty object is replaced by the last good copy.
Nothing here prints credentials, names, or file bodies.
"""

from __future__ import annotations

import json
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
LASTGOOD_PREFIX = "lastgood/"
PUSH_BUDGET_SECONDS = 70


def lastgood_key(key: str) -> str:
    return LASTGOOD_PREFIX + key


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


def _loads(payload: bytes | None):
    if not payload or not payload.strip():
        return None
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None


def is_seed(payload: bytes) -> bool:
    doc = _loads(payload)
    return isinstance(doc, dict) and doc.get("catalogSeed") is True


def usable_catalog(payload: bytes | None, key: str) -> bool:
    """False for a blank, seed, or empty feed catalog.

    stories with no accounts, and any other non-empty JSON object, stay usable.
    """
    if not payload or not bytes(payload).strip():
        return False
    doc = _loads(payload)
    if isinstance(doc, list):
        return len(doc) > 0
    if not isinstance(doc, dict):
        return False
    if doc.get("catalogSeed") is True:
        return False
    name = str(key or "").rsplit("/", 1)[-1]
    if name == "feeds.json":
        feeds = doc.get("feeds") if isinstance(doc.get("feeds"), list) else []
        posts = doc.get("posts") if isinstance(doc.get("posts"), list) else []
        if not feeds and not posts:
            return False
    elif name == "feeds.config.json":
        feeds = doc.get("feeds") if isinstance(doc.get("feeds"), list) else []
        posts = doc.get("posts") if isinstance(doc.get("posts"), list) else []
        spaces = doc.get("spaces") if isinstance(doc.get("spaces"), list) else []
        people = doc.get("people") if isinstance(doc.get("people"), list) else []
        discord = doc.get("discord") if isinstance(doc.get("discord"), list) else []
        if not feeds and not posts and not spaces and not people and not discord:
            return False
    return True


def blocks_empty_catalog(doc, previous) -> bool:
    """True when writing doc would replace a real feed catalog with an empty one."""
    def filled(item) -> bool:
        if not isinstance(item, dict):
            return False
        return bool(item.get("feeds") or item.get("posts"))

    return not filled(doc) and filled(previous)


def _default_get():
    from tiktok_sync import r2_get

    return r2_get


def _default_put():
    from tiktok_sync import r2_put

    return r2_put


def read_catalog(key: str, get=None, put=None) -> bytes | None:
    """Primary when it is usable, otherwise the last good copy.

    A usable copy is written back to the primary key. Neither an empty
    catalog nor a seed is returned.
    """
    getter = get or _default_get()
    putter = put or _default_put()
    primary = getter(key)
    if usable_catalog(primary, key):
        return primary
    backup = getter(lastgood_key(key))
    if not usable_catalog(backup, key):
        return None
    try:
        putter(key, backup)
    except Exception:
        pass
    return backup


def store_usable(key: str, payload: bytes, put=None) -> str:
    """Store a usable catalog and its last good copy. Returns ok, skip, or fail."""
    if not usable_catalog(payload, key):
        return "skip"
    putter = put or _default_put()
    try:
        primary = bool(putter(key, payload))
        backup = bool(putter(lastgood_key(key), payload))
    except Exception:
        return "fail"
    if primary and backup:
        return "ok"
    return "fail"


def pull(root: Path, get=None, put=None) -> int:
    restored = 0
    for key in PULL_KEYS:
        blob = read_catalog(key, get=get, put=put)
        if not blob:
            continue
        dest = root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        restored += 1
    getter = get or _default_get()
    cached = getter(CACHE_KEY)
    if cached:
        (root / ".feed-http-cache.json").write_bytes(cached)
        print("[r2] restored source cache")
    print(f"[r2] pull {restored} catalog files")
    return 0


def push(root: Path, put=None) -> int:
    from account_deletions import load_deletions, scrub_bytes
    from accounts_publish import collect

    hashes, deletion_salt = load_deletions()
    started = time.monotonic()
    stored = 0
    deferred = 0
    skipped_seed = 0
    skipped_empty = 0
    priority_failed = False
    priority = set(PULL_KEYS)

    def send(key: str, payload: bytes) -> str:
        try:
            payload = scrub_bytes(key, payload, hashes, deletion_salt)
        except (TypeError, ValueError):
            print("[r2] deletion scrub skipped")
        return store_usable(key, payload, put=put)

    ordered = ordered_keys(collect(root))
    cache = root / ".feed-http-cache.json"
    extras = []
    for key, path in ordered:
        payload = path.read_bytes()
        if key in priority and is_seed(payload):
            skipped_seed += 1
            continue
        if key in priority:
            state = send(key, payload)
            if state == "ok":
                stored += 1
            elif state == "skip":
                skipped_empty += 1
            else:
                priority_failed = True
                print("[r2] upload failed")
        else:
            extras.append((key, path))
    if cache.is_file():
        putter = put or _default_put()
        try:
            cached_ok = bool(putter(CACHE_KEY, cache.read_bytes()))
        except Exception:
            cached_ok = False
        if cached_ok:
            stored += 1
        else:
            priority_failed = True
            print("[r2] source cache upload failed")
    for index, (key, path) in enumerate(extras):
        if time.monotonic() - started >= PUSH_BUDGET_SECONDS:
            deferred += len(extras) - index
            break
        state = send(key, path.read_bytes())
        if state == "ok":
            stored += 1
        elif state == "fail":
            print("[r2] upload failed")
    if deferred:
        print(f"[r2] deferred {deferred} catalog files")
    if skipped_empty:
        print(f"[r2] empty catalog skipped {skipped_empty}")
    print(f"[r2] stored {stored} catalog files")
    if priority_failed:
        return 1
    if stored == 0 and (skipped_seed or skipped_empty):
        print("[r2] private catalog unchanged")
        return 0
    if stored == 0:
        return 1
    return 0


def selftest() -> int:
    good = b'{"feeds":[{"id":"x:sample"}],"posts":[{"id":"p"}]}\n'
    empty = b'{"feeds":[],"posts":[]}\n'
    seed = b'{"catalogSeed":true,"feeds":[{"id":"x:sample"}],"posts":[{"id":"p"}]}\n'
    stories = b'{"accounts":[]}\n'
    if usable_catalog(b"", "feeds.json") or usable_catalog(empty, "feeds.json") or usable_catalog(seed, "feeds.json"):
        print("empty or seed catalog was treated as usable")
        return 1
    if not usable_catalog(good, "feeds.json") or not usable_catalog(stories, "stories.json"):
        print("a real catalog or an empty story list was rejected")
        return 1
    if not blocks_empty_catalog({"feeds": [], "posts": []}, {"feeds": [{"id": "x:sample"}], "posts": []}):
        print("an empty write would replace the last good catalog")
        return 1
    if blocks_empty_catalog({"feeds": [{"id": "x:sample"}], "posts": []}, {"feeds": [], "posts": []}):
        print("a real catalog was blocked")
        return 1
    store: dict[str, bytes] = {}

    def getter(key: str):
        return store.get(key)

    def putter(key: str, payload: bytes) -> bool:
        store[key] = payload
        return True

    if store_usable("feeds.json", empty, put=putter) != "skip" or "feeds.json" in store:
        print("an empty catalog was stored")
        return 1
    if store_usable("feeds.json", good, put=putter) != "ok":
        print("a real catalog was not stored")
        return 1
    if store.get("feeds.json") != good or store.get("lastgood/feeds.json") != good:
        print("the last good copy was not stored with the catalog")
        return 1
    store["feeds.json"] = empty
    restored = read_catalog("feeds.json", get=getter, put=putter)
    if restored != good or store.get("feeds.json") != good:
        print("a missing catalog did not come back from the last good copy")
        return 1
    del store["feeds.json"]
    del store["lastgood/feeds.json"]
    if read_catalog("feeds.json", get=getter, put=putter) is not None:
        print("a missing catalog invented an empty document")
        return 1
    print("r2 catalog last good copy ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == "--selftest":
        return selftest()
    if not args or args[0] not in ("pull", "push"):
        print("usage: r2_catalog.py pull|push", file=sys.stderr)
        return 2
    root = ROOT
    if args[0] == "pull":
        return pull(root)
    return push(root)


if __name__ == "__main__":
    sys.exit(main())
