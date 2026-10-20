#!/usr/bin/env python3
"""Download the last published snapshot so a failed source can keep it.

The git checkout only has the seed feeds.json. This copies the live Pages
feeds.json over that seed, then copies comment files for Instagram, Threads,
and comment-RSS posts under 7 days old. X and YouTube comments are not
downloaded. It also merges archive/index.json and every shard that index
lists, and only when all of those downloads parse. Pages, the raw data
branch, and the Internet Archive are merged in that order. A partial
download leaves the local shards alone. A source that lists fewer months
does not delete the others. A network miss leaves the seed in place and
does not fail the run.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.x_replies import comments_kept  # noqa: E402
from archive import load_archive, merge_stubs, save_archive  # noqa: E402

SITE = "https://owner-account.github.io/rss-feeds/"
DATA_ARCHIVE = "https://raw.githubusercontent.com/owner-account/rss-feeds/data/"
IA_ARCHIVE = "https://archive.org/download/sergi-rss-feeds-archive/"
ARCHIVE_SOURCES = (
    ("pages", SITE),
    ("data", DATA_ARCHIVE),
    ("ia", IA_ARCHIVE),
)
UA = "rss-feeds-preview/1.0 (+https://github.com/owner-account/rss-feeds)"


def _get(url: str) -> bytes | None:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if getattr(response, "status", 200) != 200:
                return None
            return response.read()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def _safe(value) -> str:
    text = str(value or "")
    if not text or text in {".", ".."} or "/" in text or "\\" in text:
        return ""
    return text


def _write(path: Path, payload: bytes) -> None:
    if not payload.endswith(b"\n"):
        payload += b"\n"
    path.write_bytes(payload)


def _complete_rows(fetch):
    """Stub rows from a complete index, or None when any listed file is missing."""
    index_body = fetch("archive/index.json")
    if not index_body:
        return None
    try:
        index = json.loads(index_body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError, AttributeError):
        return None
    names = index.get("shards") if isinstance(index, dict) else None
    if not isinstance(names, list) or not names:
        return None
    rows = []
    seen = []
    for name in names:
        if not isinstance(name, str) or not re.fullmatch(r"(?:\d{4}-\d{2}|undated)", name) or name in seen:
            return None
        seen.append(name)
        body = fetch(f"archive/{name}.json")
        if not body:
            return None
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError, AttributeError):
            return None
        if not isinstance(parsed, list):
            return None
        rows.extend(row for row in parsed if isinstance(row, dict))
    return rows


def pull_archive(root: Path, fetch) -> str:
    """Merge a complete remote archive into root/archive.

    fetch(relative_path) returns bytes or None. A miss or a partial set leaves
    the directory untouched. Stubs already stored keep their first text, and
    months the remote does not list stay on disk.
    """
    rows = _complete_rows(fetch)
    if rows is None:
        return "kept"
    dest = root / "archive"
    archive = load_archive(dest)
    added = merge_stubs(archive, rows)
    if not added:
        return "kept"
    save_archive(dest, archive)
    return "updated"


def main() -> None:
    try:
        _pull_feeds()
    finally:
        for label, base in ARCHIVE_SOURCES:
            result = pull_archive(ROOT, lambda rel, base=base: _get(base + rel))
            print(f"[snapshot] archive {label} {result}")


def _pull_feeds() -> None:
    body = _get(SITE + "feeds.json")
    if not body:
        print("[snapshot] published feeds.json unavailable; keeping the seed", file=sys.stderr)
        return
    try:
        doc = json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        print("[snapshot] published feeds.json was not JSON; keeping the seed", file=sys.stderr)
        return
    if not isinstance(doc, dict) or not isinstance(doc.get("posts"), list):
        print("[snapshot] published feeds.json had no posts; keeping the seed", file=sys.stderr)
        return
    _write(ROOT / "feeds.json", body)
    print(f"[snapshot] feeds.json {len(doc['posts'])} posts")
    comments = ROOT / "comments"
    kept = 0
    seen = set()

    def save_comment(status_id: str) -> dict | None:
        nonlocal kept
        if status_id in seen:
            return None
        seen.add(status_id)
        payload = _get(SITE + "comments/" + urllib.parse.quote(status_id) + ".json")
        if not payload:
            return None
        comments.mkdir(parents=True, exist_ok=True)
        _write(comments / f"{status_id}.json", payload)
        kept += 1
        try:
            data = json.loads(payload.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None

    for post in doc["posts"]:
        if not comments_kept(post):
            continue
        status_id = _safe(post.get("statusId") or post.get("id") or "")
        if not status_id:
            continue
        data = save_comment(status_id)
        for row in (data or {}).get("replies") or []:
            if not isinstance(row, dict):
                continue
            child = _safe(row.get("statusId") or row.get("id") or "")
            if child:
                save_comment(child)
    print(f"[snapshot] comments {kept} files")


if __name__ == "__main__":
    main()
