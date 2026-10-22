#!/usr/bin/env python3
"""Download the last published snapshot so a failed source can keep it.

The git checkout only has the seed feeds.json. This copies the live Pages
feeds.json over that seed, then copies comment files for Instagram, Threads,
VK, and comment-RSS posts under 7 days old. X and YouTube comments are not
downloaded. It also merges archive/index.json and every shard that index
lists, and only when all of those downloads parse. Pages, the raw data
branch, and the anonymous Internet Archive copies named in the manifest
are merged in that order. A partial download leaves the local shards alone. A source that lists fewer months
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

from adapters.common import post_is_bridge_error  # noqa: E402
from adapters.x_replies import comments_kept  # noqa: E402
from archive import load_archive, merge_stubs, purge_bridge_errors, save_archive  # noqa: E402
from site_paths import pages_base, raw_data, user_agent  # noqa: E402

SITE = pages_base()
DATA_ARCHIVE = raw_data()
ARCHIVE_SOURCES = (
    ("pages", SITE),
    ("data", DATA_ARCHIVE),
)
_ANON_SHARD = re.compile(r"^https://archive\.org/download/x[0-9a-f]{32}/[^/?#]+$")
UA = user_agent()


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


def ia_shard_url(manifest: dict, rel: str) -> str:
    """Download URL for one archive file, from the anonymous manifest map."""
    name = str(rel or "").rsplit("/", 1)[-1]
    stem = name[:-5] if name.endswith(".json") else name
    shards = manifest.get("shards") if isinstance(manifest, dict) else None
    if not isinstance(shards, dict):
        return ""
    url = str(shards.get(name) or shards.get(stem) or "")
    if not _ANON_SHARD.match(url):
        return ""
    return url


def _remote_manifest() -> dict | None:
    """Manifest from disk, the data branch, or Pages. Misses stay None."""
    local = ROOT / "archive" / "ia-manifest.json"
    bodies = []
    if local.is_file():
        try:
            bodies.append(local.read_bytes())
        except OSError:
            pass
    for base in (DATA_ARCHIVE, SITE):
        if base:
            body = _get(base + "archive/ia-manifest.json")
            if body:
                bodies.append(body)
    for body in bodies:
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict) and isinstance(parsed.get("shards"), dict) and parsed["shards"]:
            return parsed
    return None


def pull_ia_archive(root: Path) -> str:
    """Merge shards from the anonymous items named in the manifest."""
    manifest = _remote_manifest()
    if not manifest:
        return "kept"

    def fetch(rel: str):
        url = ia_shard_url(manifest, rel)
        if not url:
            return None
        return _get(url)

    return pull_archive(root, fetch)


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
    removed = purge_bridge_errors(archive)
    added = merge_stubs(archive, rows)
    if not added and not removed:
        return "kept"
    save_archive(dest, archive)
    return "updated"


def pull_ia_sidecars(root: Path) -> None:
    """Copy the media manifest when a source has one. A miss leaves the files alone.

    The data branch is first. Pages would otherwise keep serving the previous
    manifest, and a newer backup published only on the data branch would never
    replace it.
    """
    dest = root / "archive"
    dest.mkdir(parents=True, exist_ok=True)
    sources = (("data", DATA_ARCHIVE), ("pages", SITE))
    for name in ("ia-manifest.json", "ia-state.json"):
        body = None
        for _label, base in sources:
            body = _get(base + "archive/" + name)
            if body:
                break
        parsed = None
        if body:
            try:
                parsed = json.loads(body.decode("utf-8"))
            except (UnicodeError, json.JSONDecodeError):
                parsed = None
        if not isinstance(parsed, dict):
            continue
        _write(dest / name, body)
        print(f"[snapshot] {name}")


def pull_stories() -> None:
    """Keep the last stories.json so a failed story fetch can leave unexpired items."""
    for url in (SITE + "stories.json", raw_data() + "stories.json"):
        body = _get(url)
        if not body:
            continue
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("accounts"), list):
            _write(ROOT / "stories.json", json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
            print(f"[snapshot] stories.json {len(data['accounts'])} accounts")
            return
    print("[snapshot] stories.json unavailable; keeping the seed")


def main() -> None:
    try:
        _pull_feeds()
        pull_stories()
    finally:
        for label, base in ARCHIVE_SOURCES:
            result = pull_archive(ROOT, lambda rel, base=base: _get(base + rel))
            print(f"[snapshot] archive {label} {result}")
        print(f"[snapshot] archive ia {pull_ia_archive(ROOT)}")
        try:
            pull_ia_sidecars(ROOT)
        except (OSError, urllib.error.URLError, TimeoutError):
            print("[snapshot] media manifest unavailable", file=sys.stderr)


def merge_seed_articles(published: dict, seed: dict) -> int:
    """Keep git-seed articles when the live snapshot does not have them yet.

    The profile articles list is often a preview. A seed post that already
    has the body should survive the snapshot overwrite, and its blocks should
    fill a preview that came back without them. Returns how many posts were
    added. Missing blocks are copied in place.
    """
    if not isinstance(published, dict) or not isinstance(seed, dict):
        return 0
    seed_posts = [
        post for post in (seed.get("posts") or [])
        if isinstance(post, dict) and isinstance(post.get("article"), dict) and post.get("id")
    ]
    posts = published.get("posts")
    if not seed_posts or not isinstance(posts, list):
        return 0
    by_id = {}
    for post in posts:
        if isinstance(post, dict) and post.get("id"):
            by_id[str(post.get("id"))] = post
    added = 0
    feed_ids = set()
    for post in seed_posts:
        pid = str(post.get("id"))
        article = post.get("article") or {}
        blocks = article.get("blocks") if isinstance(article.get("blocks"), list) else []
        current = by_id.get(pid)
        if current is None:
            posts.append(post)
            by_id[pid] = post
            added += 1
            if post.get("feedId"):
                feed_ids.add(post.get("feedId"))
            continue
        current_article = current.get("article") if isinstance(current.get("article"), dict) else None
        if blocks and (current_article is None or not current_article.get("blocks")):
            if current_article is None:
                current["article"] = dict(article)
            else:
                current_article["blocks"] = blocks
            if post.get("feedId"):
                feed_ids.add(post.get("feedId"))
    feeds = published.get("feeds")
    if feed_ids and isinstance(feeds, list):
        have = {item.get("id") for item in feeds if isinstance(item, dict)}
        for item in seed.get("feeds") or []:
            if isinstance(item, dict) and item.get("id") in feed_ids and item.get("id") not in have:
                feeds.append(item)
                have.add(item.get("id"))
    return added


def _pull_feeds() -> None:
    seed = {}
    try:
        seed = json.loads((ROOT / "feeds.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        seed = {}
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
    posts = [post for post in doc["posts"] if isinstance(post, dict) and not post_is_bridge_error(post)]
    removed = len(doc["posts"]) - len(posts)
    doc["posts"] = posts
    added = merge_seed_articles(doc, seed if isinstance(seed, dict) else {})
    _write(ROOT / "feeds.json", (json.dumps(doc, ensure_ascii=False) + "\n").encode("utf-8"))
    if removed:
        print(f"[snapshot] dropped {removed} bridge error posts")
    if added:
        print(f"[snapshot] kept {added} seed articles")
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
