#!/usr/bin/env python3
"""Download the last published snapshot so a failed source can keep it.

The git checkout only has the seed feeds.json. This copies the live Pages
feeds.json over that seed, then copies comment files for Instagram, Threads,
and comment-RSS posts under 7 days old. X and YouTube comments are not
downloaded. It also copies archive/index.json and every shard that index
lists, and only when all of those downloads parse. A network miss leaves the
seed in place and does not fail the run.
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

SITE = "https://owner-account.github.io/rss-feeds/"
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


def pull_archive(root: Path, fetch) -> str:
    """Replace archive/ only when the index and every listed shard parse.

    fetch(relative_path) returns bytes or None. A miss or a partial set leaves
    the directory untouched so a bad download cannot wipe the backup.
    """
    index_body = fetch("archive/index.json")
    if not index_body:
        return "kept"
    try:
        index = json.loads(index_body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return "kept"
    names = index.get("shards") if isinstance(index, dict) else None
    if not isinstance(names, list) or not names:
        return "kept"
    files = {}
    seen = []
    for name in names:
        if not isinstance(name, str) or not re.fullmatch(r"(?:\d{4}-\d{2}|undated)", name) or name in seen:
            return "kept"
        seen.append(name)
        body = fetch(f"archive/{name}.json")
        if not body:
            return "kept"
        try:
            rows = json.loads(body.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            return "kept"
        if not isinstance(rows, list):
            return "kept"
        files[name] = body
    dest = root / "archive"
    dest.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        _write(dest / f"{name}.json", body)
    _write(dest / "index.json", index_body if index_body.endswith(b"\n") else index_body + b"\n")
    for path in dest.glob("*.json"):
        if path.name == "index.json":
            continue
        if path.stem not in files:
            path.unlink()
    return "updated"


def main() -> None:
    try:
        _pull_feeds()
    finally:
        archive = pull_archive(ROOT, lambda rel: _get(SITE + rel))
        print(f"[snapshot] archive {archive}")


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
