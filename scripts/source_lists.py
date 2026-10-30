#!/usr/bin/env python3
"""Owner source lists: extra sources that only the assigned accounts see.

The Worker writes owner/lists/wanted.json to private R2. It names only the
sources that sit in a list with at least one active member, and it carries
no account ids. Each source is fetched once per run, even when it sits in
several lists. Every list then gets one small shard, stored content
addressed in private R2 (lists/shards/<sha256>.json). The Worker hands a
shard only to the list's members. feeds.json and the public site never see
these sources, and nothing here prints a handle (they are masked first).
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

WANTED_KEY = "owner/lists/wanted.json"
INDEX_KEY = "owner/lists/index.json"
SHARD_PREFIX = "lists/shards/"
POSTS_PER_SOURCE = 8
SOURCE_CAP = 60
LIST_POST_CAP = 240
RUN_SECONDS = 90
_LIST_ID = re.compile(r"^s[a-f0-9]{8}$")


def _r2():
    from tiktok_sync import r2_get, r2_put

    return r2_get, r2_put


def _read_json(blob) -> dict:
    if not blob:
        return {}
    try:
        data = json.loads(blob.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def feed_row(source: dict) -> dict | None:
    """The runtime feed row for one wanted source (same rules as the owner catalog)."""
    from owner_catalog import _feed, _row_id

    ident = _row_id(source)
    platform = str(source.get("platform") or "")
    handle = str(source.get("handle") or "").lstrip("@")
    if not ident or not platform or not handle or platform == "tiktok":
        return None
    row = _feed(source, ident, platform, handle)
    if row:
        row["limit"] = POSTS_PER_SOURCE
        row["_sourceList"] = True
    return row


def fetch_row(row: dict, config: dict) -> list | None:
    """Posts for one source through the shared adapters and fallback lanes, or None."""
    import update_feeds as uf

    uf.ensure_x_lanes(row, config)
    errors: list = []
    result = None
    if row.get("adapter") == "telegram":
        try:
            from adapters.telegram import fetch_channel

            payload = fetch_channel(row.get("handle") or "", POSTS_PER_SOURCE, backfill=False)
            result = uf.accept_feed("telegram", payload, row)
        except Exception:
            result = None
    if result is None and row.get("adapter") == "vk":
        try:
            from vk_remote import wall_payload

            result = uf.accept_feed("vk", wall_payload(row.get("handle") or "", POSTS_PER_SOURCE), row)
        except Exception:
            result = None
    if result is None and row.get("adapter") not in ("telegram", "vk"):
        _payload, _url, _adapter, result = uf._fetch_sources(uf.x_source_urls(row, config), row.get("adapter"), row, config, errors)
    if result is None:
        for lane in row.get("fallbacks") or []:
            _payload, _url, _adapter, result = uf._fetch_sources(lane.get("source_urls") or [], lane.get("adapter") or row.get("adapter"), row, config, errors)
            if result is not None:
                break
    if not isinstance(result, dict) or result.get("_not_modified"):
        return None
    posts = [post for post in (result.get("posts") or []) if isinstance(post, dict)]
    for post in posts:
        post["feedId"] = row["id"]
    try:
        posts.sort(key=uf.feed_sort_key)
    except Exception:
        pass
    return posts[:POSTS_PER_SOURCE]


def profile_of(row: dict, source: dict, posts: list) -> dict:
    """A feeds.json-style profile row. Quoted and reposted authors stay inside their posts."""
    first = posts[0] if posts else {}
    return {
        "id": row["id"],
        "platform": row["platform"],
        "handle": row["handle"],
        "name": source.get("name") or first.get("author") or row["handle"],
        "avatar": source.get("avatar") or first.get("avatar") or "",
        "url": source.get("url") or "",
        "channelId": source.get("channelId") or "",
        "configured": True,
        "sourceList": True,
    }


def shard_bytes(feeds: list, posts: list) -> bytes:
    body = {"v": 1, "feeds": feeds, "posts": posts}
    return (json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def normalized(posts: list) -> list:
    """The same schema gate feeds.json uses; posts it cannot repair are dropped."""
    try:
        from normalize import repair_post
    except Exception:
        return posts
    out = []
    for post in posts or []:
        try:
            fixed, _reasons = repair_post(post)
        except Exception:
            fixed = None
        if fixed:
            out.append(fixed)
    return out


def build_shards(wanted: dict, fetched: dict, previous: dict) -> tuple[dict, dict]:
    """Shard bytes per list (by hash) and the next index. A failed source keeps its last posts."""
    old_sources = (previous or {}).get("sourcePosts") or {}
    index = {"v": 1, "at": int(time.time() * 1000), "lists": {}, "sources": {}}
    blobs: dict[str, bytes] = {}
    keep_posts: dict[str, list] = {}
    profiles: dict[str, dict] = {}
    for source in wanted.get("sources") or []:
        if not isinstance(source, dict):
            continue
        sid = str(source.get("id") or "")
        got = fetched.get(sid)
        if got is not None:
            row, posts = got
            posts = normalized(posts)
            keep_posts[sid] = posts
            profiles[sid] = profile_of(row, source, posts)
            index["sources"][sid] = {"ok": True, "count": len(posts), "at": index["at"]}
        else:
            stale = old_sources.get(sid)
            if isinstance(stale, dict):
                keep_posts[sid] = stale.get("posts") or []
                profiles[sid] = stale.get("profile") or {}
            index["sources"][sid] = {"ok": False, "count": len(keep_posts.get(sid) or []), "at": index["at"]}
    for item in wanted.get("lists") or []:
        lid = str((item or {}).get("id") or "")
        if not _LIST_ID.fullmatch(lid):
            continue
        feeds, posts = [], []
        for sid in item.get("sources") or []:
            if sid in profiles and profiles[sid]:
                feeds.append(profiles[sid])
                posts.extend(keep_posts.get(sid) or [])
        posts = posts[:LIST_POST_CAP]
        blob = shard_bytes(feeds, posts)
        digest = hashlib.sha256(blob).hexdigest()
        blobs[digest] = blob
        index["lists"][lid] = {"hash": digest, "size": len(blob), "count": len(posts), "at": index["at"]}
    # Kept privately so a source that fails next run still has posts.
    index["sourcePosts"] = {sid: {"profile": profiles.get(sid) or {}, "posts": keep_posts.get(sid) or []} for sid in keep_posts}
    return blobs, index


def run_lists(config: dict, getter=None, putter=None, fetcher=None) -> dict:
    """One pass. Returns counts only (no names), for the log."""
    if getter is None or putter is None:
        getter, putter = _r2()
    wanted = _read_json(getter(WANTED_KEY))
    sources = [row for row in (wanted.get("sources") or []) if isinstance(row, dict)][:SOURCE_CAP]
    if not sources:
        return {"sources": 0, "lists": 0}
    try:
        from owner_catalog import mask

        mask(wanted)
    except Exception:
        pass
    previous = _read_json(getter(INDEX_KEY))
    fetch = fetcher or fetch_row
    started = time.monotonic()
    fetched: dict = {}

    def one(source):
        if time.monotonic() - started > RUN_SECONDS:
            return None
        row = feed_row(source)
        if not row:
            return None
        try:
            posts = fetch(row, config)
        except Exception:
            posts = None
        return (source.get("id"), row, posts) if posts is not None else None

    with ThreadPoolExecutor(max_workers=4) as pool:
        for item in pool.map(one, sources):
            if item:
                fetched[str(item[0])] = (item[1], item[2])
    blobs, index = build_shards({"sources": sources, "lists": wanted.get("lists") or []}, fetched, previous)
    old_hashes = {str((row or {}).get("hash") or "") for row in ((previous.get("lists") or {}).values())}
    for digest, blob in blobs.items():
        if digest not in old_hashes:
            putter(SHARD_PREFIX + digest + ".json", blob)
    putter(INDEX_KEY, (json.dumps(index, ensure_ascii=False) + "\n").encode("utf-8"))
    return {"sources": len(sources), "ok": len(fetched), "lists": len(index["lists"])}


def _selftest() -> None:
    store: dict[str, bytes] = {
        WANTED_KEY: json.dumps({
            "v": 1,
            "sources": [
                {"id": "x:samplelane", "platform": "x", "handle": "samplelane"},
                {"id": "telegram:northwind", "platform": "telegram", "handle": "northwind"},
            ],
            "lists": [
                {"id": "s0000000a", "sources": ["x:samplelane", "telegram:northwind"]},
                {"id": "s0000000b", "sources": ["x:samplelane"]},
            ],
        }).encode(),
    }
    calls: list[str] = []

    def fake(row, _config):
        calls.append(row["id"])
        if row["platform"] == "telegram":
            return None
        return [{"id": "1", "text": "Hello", "date": "2026-01-02T00:00:00Z", "quoted": {"author": "Far Away", "handle": "farlane", "text": "inner"}}]

    out = run_lists({}, store.get, lambda k, v: store.__setitem__(k, v) or True, fake)
    assert out == {"sources": 2, "ok": 1, "lists": 2}, out
    assert sorted(calls) == ["telegram:northwind", "x:samplelane"], calls  # each source once
    index = json.loads(store[INDEX_KEY])
    a = index["lists"]["s0000000a"]
    blob = store[SHARD_PREFIX + a["hash"] + ".json"]
    assert hashlib.sha256(blob).hexdigest() == a["hash"]
    shard = json.loads(blob)
    assert [f["id"] for f in shard["feeds"]] == ["x:samplelane"]
    assert shard["posts"][0]["quoted"]["handle"] == "farlane"  # quotes travel inside the post
    assert all(f["id"] != "x:farlane" for f in shard["feeds"])  # and never become a source
    # A later failure keeps the last posts.
    out = run_lists({}, store.get, lambda k, v: store.__setitem__(k, v) or True, lambda r, c: None)
    again = json.loads(store[INDEX_KEY])
    assert again["lists"]["s0000000a"]["hash"] == a["hash"]
    # Nothing to fetch means no writes.
    empty: dict[str, bytes] = {}
    assert run_lists({}, empty.get, lambda k, v: empty.__setitem__(k, v), fake) == {"sources": 0, "lists": 0}
    assert not empty
    print("source_lists selftest ok")


if __name__ == "__main__":
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
    if "--selftest" in sys.argv:
        _selftest()
    else:
        print("[lists]", json.dumps(run_lists(json.load(open(sys.argv[1] if len(sys.argv) > 1 else "feeds.config.json")))))
