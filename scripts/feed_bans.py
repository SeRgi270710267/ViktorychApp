#!/usr/bin/env python3
"""Drop banned sources before anything is fetched.

The Worker keeps banned sources in private D1 and writes only sha256 prefixes
of their keys to owner/feed-bans.json in private R2. A feed row is dropped when
any spelling of its key (its id, platform:handle, the Bluesky short prefix)
hashes to a listed prefix. No handle or URL is read from or written to the
repo or the log: the log line carries a count only.
"""
from __future__ import annotations

import hashlib
import json
import sys

BANS_KEY = "owner/feed-bans.json"


def ban_hash(key: str) -> str:
    return hashlib.sha256(("feed-ban:" + str(key or "").lower()).encode("utf-8")).hexdigest()[:20]


def row_keys(row: dict) -> list[str]:
    keys = set()
    rid = str(row.get("id") or "").strip().lower()
    platform = str(row.get("platform") or "").strip().lower()
    handle = str(row.get("handle") or "").strip().lower()
    if rid:
        keys.add(rid)
    if platform and handle:
        keys.add(platform + ":" + handle)
        if platform == "reddit":
            keys.add("reddit:" + str(row.get("redditKind") or "u").lower() + ":" + handle)
        if platform == "mastodon" and row.get("host"):
            keys.add("mastodon:" + handle + "@" + str(row.get("host")).lower())
    for key in list(keys):
        if key.startswith("bluesky:"):
            keys.add("bsky:" + key[8:])
        elif key.startswith("bsky:"):
            keys.add("bluesky:" + key[5:])
    return sorted(keys)


def load_hashes(getter=None) -> set[str]:
    if getter is None:
        try:
            from tiktok_sync import r2_get as getter  # type: ignore
        except Exception:
            return set()
    try:
        raw = getter(BANS_KEY)
    except Exception:
        return set()
    if not raw:
        return set()
    try:
        doc = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
    except Exception:
        return set()
    hashes = doc.get("hashes") if isinstance(doc, dict) else None
    return {str(h) for h in (hashes or []) if isinstance(h, str) and len(h) == 20}


def is_banned(row: dict, hashes: set[str]) -> bool:
    if not hashes or not isinstance(row, dict):
        return False
    return any(ban_hash(key) in hashes for key in row_keys(row))


def drop_banned(rows: list, hashes: set[str] | None = None, label: str = "bans") -> list:
    """Returns rows without banned sources (in place order kept)."""
    if hashes is None:
        hashes = load_hashes()
    if not hashes:
        return rows
    kept = [row for row in rows if not is_banned(row, hashes)]
    dropped = len(rows) - len(kept)
    if dropped:
        print(f"[{label}] {dropped} banned sources skipped")
    return kept


def _selftest() -> int:
    banned = {ban_hash("x:bannedlane"), ban_hash("bsky:skylane.example.com")}
    rows = [
        {"id": "x:BannedLane", "platform": "x", "handle": "BannedLane"},
        {"id": "x:keptlane", "platform": "x", "handle": "keptlane"},
        {"id": "bluesky:skylane.example.com", "platform": "bluesky", "handle": "skylane.example.com"},
        {"id": "youtube:UCexample", "platform": "youtube", "handle": "bannedlane"},
    ]
    kept = drop_banned(rows, banned, "selftest")
    assert [row["id"] for row in kept] == ["x:keptlane", "youtube:UCexample"], kept
    assert drop_banned(rows, set()) is rows
    assert load_hashes(lambda key: json.dumps({"hashes": sorted(banned)}).encode()) == banned
    assert load_hashes(lambda key: None) == set()
    print("feed_bans selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
