#!/usr/bin/env python3
"""Append-only monthly stubs for posts that age out of feeds.json.

A stub is platform, id, handle, date, kind, and at most 280 characters of
text, plus the original creator's name, avatar, and channel when known.
Post media and stats are not stored. Shards are named archive/YYYY-MM.json
and listed newest-first in archive/index.json.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from adapters.common import post_is_bridge_error, stub_is_bridge_error, trusted_time  # noqa: E402

SNIPPET = 280
MONTH = re.compile(r"^(\d{4})-(\d{2})")
SHARD_NAME = re.compile(r"^(?:\d{4}-\d{2}|undated)$")
IG_CODE = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)")
TH_CODE = re.compile(r"threads\.(?:com|net)/(?:@[^/]+/)?(?:post|t)/([A-Za-z0-9_-]+)")
PLATFORM_NAME = re.compile(r"^[a-z0-9]{1,16}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def snippet(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:SNIPPET]


def canonical_id(post: dict) -> str:
    platform = str(post.get("platform") or "").lower()
    raw = str(post.get("statusId") or post.get("id") or "").strip()
    url = str(post.get("url") or "")
    if platform == "instagram":
        match = IG_CODE.search(url) or IG_CODE.search(raw)
        if match:
            return match.group(1)
    if platform == "threads":
        match = TH_CODE.search(url) or TH_CODE.search(raw)
        if match:
            return match.group(1)
    if raw.startswith("http"):
        return ""
    return raw


def month_key(date: str) -> str:
    match = MONTH.match(date or "")
    if not match:
        return "undated"
    month = int(match.group(2))
    if month < 1 or month > 12:
        return "undated"
    return f"{match.group(1)}-{match.group(2)}"


def _https(url, limit: int = 300) -> str:
    text = str(url or "").strip()
    if text.startswith("https://") and len(text) <= limit and " " not in text:
        return text
    return ""


def _author_fields(source: dict) -> dict:
    """Minimal original-creator fields. Media and stats stay out of the stub."""
    if not isinstance(source, dict):
        return {}
    extra = {}
    author = str(source.get("a") or source.get("author") or "").strip()
    if author:
        extra["a"] = author[:80]
    avatar = _https(source.get("av") or source.get("avatar"))
    if avatar:
        extra["av"] = avatar
    channel = str(source.get("c") or source.get("channelId") or "").strip()
    if channel.startswith("UC") and len(channel) <= 40:
        extra["c"] = channel
    by = source.get("repostedBy") if isinstance(source.get("repostedBy"), dict) else None
    reposter = str(source.get("rb") or (by or {}).get("handle") or "").lstrip("@").strip()
    reposter_name = str(source.get("rn") or (by or {}).get("name") or "").strip()
    if reposter:
        extra["rb"] = reposter[:40]
    if reposter_name:
        extra["rn"] = reposter_name[:80]
    comment = snippet(str(source.get("rc") if "rc" in source else source.get("repostComment") or ""))
    if comment:
        extra["rc"] = comment
    return extra


def stub_from_post(post: dict) -> dict | None:
    if not isinstance(post, dict) or post_is_bridge_error(post):
        return None
    platform = str(post.get("platform") or "").strip().lower()
    ident = canonical_id(post)
    if not PLATFORM_NAME.match(platform) or not SAFE_ID.match(ident):
        return None
    handle = str(post.get("handle") or "").lstrip("@").strip()
    date = str(post.get("date") or post.get("sortDate") or "").strip()
    kind = str(post.get("kind") or "").strip().lower()
    text = snippet(str(post.get("text") or ""))
    stub = {"p": platform, "id": ident}
    if handle:
        stub["h"] = handle[:40]
    if date:
        stub["d"] = date[:40]
    if kind and kind != "post":
        stub["k"] = kind[:16]
    if text:
        stub["t"] = text
    stub.update(_author_fields(post))
    return stub


def _valid_name(name: str) -> bool:
    return bool(SHARD_NAME.match(name or ""))


def _read_rows(path: Path) -> list:
    if not path.is_file():
        return []
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [row for row in parsed if isinstance(row, dict) and row.get("p") and row.get("id")]


def load_archive(dest: Path) -> dict:
    order: list[str] = []
    index_path = dest / "index.json"
    if index_path.is_file():
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
            for name in data.get("shards") or []:
                if _valid_name(str(name)) and str(name) not in order:
                    order.append(str(name))
        except (OSError, json.JSONDecodeError, AttributeError):
            order = []
    if dest.is_dir():
        for path in sorted(dest.glob("*.json")):
            if path.name == "index.json" or not _valid_name(path.stem):
                continue
            if path.stem not in order:
                order.append(path.stem)
    shards = {name: _read_rows(dest / f"{name}.json") for name in order}
    return {"shards": shards}


def _order(names) -> list[str]:
    months = sorted((name for name in names if name != "undated"), reverse=True)
    if "undated" in names:
        months.append("undated")
    return months


def _remember(archive: dict) -> dict:
    seen = {}
    for name, rows in archive["shards"].items():
        for row in rows:
            seen[(row.get("p"), str(row.get("id")))] = name
    return seen


def _sort_shards(archive: dict) -> None:
    for rows in archive["shards"].values():
        rows.sort(key=lambda row: (row.get("d") or "", row.get("id") or ""), reverse=True)


def _stub_row(row: dict) -> dict | None:
    if not isinstance(row, dict) or stub_is_bridge_error(row):
        return None
    platform = str(row.get("p") or "").strip().lower()
    ident = str(row.get("id") or "").strip()
    if not PLATFORM_NAME.match(platform) or not SAFE_ID.match(ident):
        return None
    handle = str(row.get("h") or "").lstrip("@").strip()
    date = str(row.get("d") or "").strip()
    kind = str(row.get("k") or "").strip().lower()
    text = snippet(str(row.get("t") or ""))
    stub = {"p": platform, "id": ident}
    if handle:
        stub["h"] = handle[:40]
    if date:
        stub["d"] = date[:40]
    if kind and kind != "post":
        stub["k"] = kind[:16]
    if text:
        stub["t"] = text
    stub.update(_author_fields(row))
    return stub


def _enrich_stub(archive: dict, seen: dict, stub: dict) -> None:
    """Fill original-author fields on a stub that was stored before they existed.

    The first text stays. Only empty author, avatar, channel, and reposter
    fields are copied from a later copy of the same post.
    """
    name = seen.get((stub.get("p"), stub.get("id")))
    rows = archive["shards"].get(name) or []
    for row in rows:
        if row.get("p") != stub.get("p") or str(row.get("id")) != str(stub.get("id")):
            continue
        for field in ("a", "av", "c", "rb", "rn", "rc"):
            if stub.get(field) and not row.get(field):
                row[field] = stub[field]
        return


def _earlier_date(left, right) -> str:
    a = trusted_time(left)
    b = trusted_time(right)
    if a and b:
        return str(left if a <= b else right)
    if a:
        return str(left or "")
    if b:
        return str(right or "")
    return ""


def _pull_date_earlier(archive: dict, seen: dict, stub: dict) -> None:
    """A later copy can only move a stub's date backward, then into that month."""
    key = (stub.get("p"), str(stub.get("id")))
    name = seen.get(key)
    rows = archive["shards"].get(name) or []
    incoming = str(stub.get("d") or "")
    for row in rows:
        if row.get("p") != stub.get("p") or str(row.get("id")) != str(stub.get("id")):
            continue
        chosen = _earlier_date(row.get("d") or "", incoming)
        if not chosen or chosen == str(row.get("d") or ""):
            return
        row["d"] = chosen[:40]
        dest = month_key(chosen)
        if dest == name:
            return
        rows.remove(row)
        if not rows:
            archive["shards"].pop(name, None)
        archive["shards"].setdefault(dest, []).append(row)
        seen[key] = dest
        return


def merge_posts(archive: dict, posts) -> int:
    seen = _remember(archive)
    added = 0
    for post in posts or []:
        stub = stub_from_post(post)
        if not stub:
            continue
        key = (stub["p"], stub["id"])
        if key in seen:
            _pull_date_earlier(archive, seen, stub)
            _enrich_stub(archive, seen, stub)
            continue
        name = month_key(stub.get("d") or "")
        archive["shards"].setdefault(name, []).append(stub)
        seen[key] = name
        added += 1
    _sort_shards(archive)
    return added


def merge_stubs(archive: dict, stubs) -> int:
    """Insert stub rows that are not already stored. The first text stays."""
    seen = _remember(archive)
    added = 0
    for row in stubs or []:
        stub = _stub_row(row)
        if not stub:
            continue
        key = (stub["p"], stub["id"])
        if key in seen:
            _pull_date_earlier(archive, seen, stub)
            continue
        name = month_key(stub.get("d") or "")
        archive["shards"].setdefault(name, []).append(stub)
        seen[key] = name
        added += 1
    _sort_shards(archive)
    return added


def save_archive(dest: Path, archive: dict) -> list[str]:
    dest.mkdir(parents=True, exist_ok=True)
    written = []
    for name in _order(archive["shards"]):
        rows = archive["shards"].get(name) or []
        if not rows:
            continue
        payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n"
        (dest / f"{name}.json").write_text(payload, encoding="utf-8")
        written.append(name)
    for path in dest.glob("*.json"):
        if path.name == "index.json" or not _valid_name(path.stem):
            continue
        if path.stem not in written:
            path.unlink()
    index = json.dumps({"shards": written}, separators=(",", ":")) + "\n"
    (dest / "index.json").write_text(index, encoding="utf-8")
    return written


def purge_bridge_errors(archive: dict) -> int:
    """Remove error stubs already stored. A later sync must not keep them."""
    removed = 0
    shards = archive.get("shards") or {}
    for name, rows in list(shards.items()):
        kept = []
        for row in rows:
            if stub_is_bridge_error(row):
                removed += 1
                continue
            kept.append(row)
        archive["shards"][name] = kept
    return removed


def merge_archive(dest: Path, posts) -> int:
    archive = load_archive(dest)
    purge_bridge_errors(archive)
    added = merge_posts(archive, posts)
    save_archive(dest, archive)
    return added


def summarize(dest: Path) -> dict:
    sizes = []
    for path in sorted(dest.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict):
                sizes.append(len(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")))
    count = len(sizes)
    return {
        "count": count,
        "total": sum(sizes),
        "min": min(sizes) if sizes else 0,
        "max": max(sizes) if sizes else 0,
        "avg": (sum(sizes) / count) if count else 0,
    }


def main() -> None:
    doc_path = ROOT / "feeds.json"
    doc = json.loads(doc_path.read_text(encoding="utf-8"))
    added = merge_archive(ROOT / "archive", doc.get("posts") or [])
    stats = summarize(ROOT / "archive")
    print(
        f"[archive] +{added} stubs, {stats['count']} total, "
        f"avg {stats['avg']:.0f} bytes, min {stats['min']}, max {stats['max']}, "
        f"body {stats['total']} bytes"
    )


if __name__ == "__main__":
    sys.exit(main())
