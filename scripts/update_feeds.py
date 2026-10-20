#!/usr/bin/env python3
"""Fetch configured sources and merge them into feeds.json.

Usage:
  python3 scripts/update_feeds.py [--config feeds.config.json]
  python3 scripts/update_feeds.py --fixtures

Network sources are tried in order. A failed source keeps the last good posts
for that feed. --fixtures reads each feed's local fixture instead (used to
rebuild the shipped preview). Placeholders {rsshubBase} and {fxtwitterBase}
in source URLs are filled from the config. api.x.com and api.twitter.com are
refused. x_api_v2 runs only against fixture files.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import ADAPTERS  # noqa: E402
from adapters.common import (  # noqa: E402
    dedupe_posts,
    load_document,
    media_basename,
    merge_profiles,
    save_document,
)
from meta_media import refresh_saved  # noqa: E402
from x_guard import assert_not_x_api, auth_cookie_header, open_url  # noqa: E402

UA = "rss-feeds-preview/1.0 (+https://github.com/owner-account/rss-feeds)"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def expand(url: str, config: dict, feed: dict | None = None) -> str:
    feed = feed or {}
    return (
        url.replace("{rsshubBase}", (config.get("rsshubBase") or "").rstrip("/"))
        .replace("{fxtwitterBase}", (config.get("fxtwitterBase") or "").rstrip("/"))
        .replace("{base}", (config.get("rsshubBase") or "").rstrip("/"))
        .replace("{handle}", feed.get("handle") or "")
        .replace("{channelId}", feed.get("channelId") or "")
    )


def read_source(url: str) -> str:
    if url.startswith("file://"):
        return Path(url[7:]).read_text(encoding="utf-8")
    path = Path(url)
    if not url.startswith("http://") and not url.startswith("https://") and path.exists():
        return path.read_text(encoding="utf-8")
    assert_not_x_api(url)
    headers = {"User-Agent": UA, "Accept": "*/*"}
    headers.update(auth_cookie_header(url))
    request = urllib.request.Request(url, headers=headers)
    with open_url(request, timeout=40) as response:
        return response.read().decode("utf-8", "replace")


def apply_override(profile: dict, feed: dict) -> dict:
    merged = dict(profile)
    override = feed.get("profile") or {}
    for key, value in override.items():
        if value is None or value == "":
            continue
        merged[key] = value
    merged["id"] = feed["id"]
    merged["platform"] = feed.get("platform") or merged.get("platform") or ""
    merged["handle"] = feed.get("handle") or merged.get("handle") or ""
    merged["name"] = merged.get("name") or feed.get("handle") or ""
    merged["title"] = merged.get("name")
    merged["configured"] = True
    if feed.get("channelId") and not merged.get("channelId"):
        merged["channelId"] = feed["channelId"]
    if not merged.get("url"):
        from adapters.common import profile_url

        merged["url"] = profile_url(merged["platform"], merged["handle"])
    return merged


def run_adapter(name: str, payload: str, feed: dict) -> dict:
    if name not in ADAPTERS:
        raise SystemExit(f"unknown adapter {name}")
    return ADAPTERS[name](payload, feed)


# pbs.twimg.com and video.twimg.com stay hotlinked. Only Meta CDNs expire.
META_HOSTS = ("cdninstagram.com", "fbcdn.net", "fbsbx.com", "cdnthreads.net", "threads.net")
VIDEO_EXT = (".mp4", ".m3u8", ".mov", ".webm")


def is_meta_cdn(url: str) -> bool:
    host = urllib.parse.urlparse(url).netloc.lower()
    return any(mark in host for mark in META_HOSTS)


def is_video_url(url: str) -> bool:
    path = urllib.parse.urlparse(url).path.lower().split("?")[0]
    return path.endswith(VIDEO_EXT)


def image_kind(data: bytes) -> str:
    if data.startswith(b"\xff\xd8"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    return ""


def _probe(path: Path) -> tuple[int, int]:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        w, h = (result.stdout.strip().split(",") + ["0", "0"])[:2]
        return int(w or 0), int(h or 0)
    except (OSError, subprocess.SubprocessError, ValueError):
        return 0, 0


def shrink_image(data: bytes, dest: Path, stem: str) -> Path | None:
    """Write a <=1080px JPEG or WebP at roughly quality 80. Videos are refused."""
    kind = image_kind(data)
    if not kind:
        return None
    suffix = {"jpeg": ".jpg", "png": ".png", "gif": ".gif", "webp": ".webp"}[kind]
    out_ext = ".webp" if kind == "webp" else ".jpg"
    final = dest / f"{stem}{out_ext}"
    # Already small enough: keep the file that is already on disk when it matches.
    if final.exists() and final.stat().st_size > 32:
        width, height = _probe(final)
        if width and height and max(width, height) <= 1080 and final.stat().st_size <= 220_000:
            return final
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        src = Path(tmp.name)
    try:
        scale = "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease"
        if out_ext == ".jpg":
            cmd = ["ffmpeg", "-y", "-i", str(src), "-vf", scale, "-frames:v", "1", "-update", "1", "-q:v", "5", str(final)]
        else:
            cmd = ["ffmpeg", "-y", "-i", str(src), "-vf", scale, "-frames:v", "1", "-c:v", "libwebp", "-quality", "80", str(final)]
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        if not final.exists():
            final.write_bytes(data)
    finally:
        src.unlink(missing_ok=True)
    if not final.exists() or final.stat().st_size < 32 or image_kind(final.read_bytes()) == "":
        return None
    return final


def download_media(posts, dest: Path, limit_bytes: int = 2_500_000) -> None:
    dest.mkdir(parents=True, exist_ok=True)

    def fetch_bytes(url: str) -> bytes | None:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(limit_bytes + 1)
        except (urllib.error.URLError, TimeoutError, OSError):
            return None
        if len(data) > limit_bytes or len(data) < 32 or not image_kind(data):
            return None
        return data

    def localize(url: str, hint: str) -> str:
        if not url or url.startswith("data:") or is_video_url(url):
            return url
        if url.startswith("media/"):
            path = dest.parent / url if not (dest / url.split("/", 1)[-1]).exists() else dest / url.split("/", 1)[-1]
            if path.is_file():
                shrunk = shrink_image(path.read_bytes(), dest, path.stem)
                if shrunk is not None:
                    if path.resolve() != shrunk.resolve() and path.exists():
                        path.unlink()
                    return f"media/{shrunk.name}"
            return url
        if not is_meta_cdn(url):
            return url
        name = media_basename(url, hint)
        target = dest / name
        data = target.read_bytes() if target.is_file() and target.stat().st_size > 32 else None
        if data is None or not image_kind(data):
            data = fetch_bytes(url)
        if not data:
            return f"media/{target.name}" if target.is_file() else url
        shrunk = shrink_image(data, dest, Path(name).stem)
        if shrunk is None:
            return url
        if target.exists() and target.resolve() != shrunk.resolve():
            target.unlink()
        return f"media/{shrunk.name}"

    for post in posts:
        hint = f"{post.get('platform') or 'post'}-{post.get('handle') or 'x'}"
        for field in ("avatar", "banner"):
            if post.get(field):
                post[field] = localize(post[field], hint + "-" + field)
        if post.get("repostedBy") and post["repostedBy"].get("avatar"):
            post["repostedBy"]["avatar"] = localize(post["repostedBy"]["avatar"], hint + "-avatar")
        for index, item in enumerate(post.get("media") or []):
            if index >= 4:
                break
            remote_url = item.get("url") or ""
            remote_poster = item.get("poster") or ""
            if item.get("type") in ("video", "animated_gif") or is_video_url(remote_url):
                if remote_poster:
                    item["poster"] = localize(remote_poster, hint + "-poster")
                continue
            if remote_url:
                item["url"] = localize(remote_url, hint)
            if remote_poster and remote_poster == remote_url:
                item["poster"] = item.get("url") or ""
            elif remote_poster:
                item["poster"] = localize(remote_poster, hint + "-poster")
        if post.get("quoted"):
            download_media([post["quoted"]], dest, limit_bytes)
        photos = [m.get("url") for m in post.get("media") or [] if m.get("type") == "photo" and m.get("url")]
        post["images"] = photos


def referenced_media(doc: dict) -> set[str]:
    found: set[str] = set()

    def walk(value) -> None:
        if isinstance(value, str):
            if value.startswith("media/") and ".." not in value:
                found.add(value.split("/", 1)[1])
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(doc)
    return found


def prune_media(dest: Path, doc: dict) -> int:
    if not dest.is_dir():
        return 0
    keep = referenced_media(doc)
    removed = 0
    for path in dest.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() in VIDEO_EXT or path.name not in keep:
            path.unlink()
            removed += 1
    return removed


def _reply_ids(data) -> set:
    found = set()

    def walk(items) -> None:
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            for key in (item.get("id"), item.get("statusId")):
                if key:
                    found.add(str(key))
            walk(item.get("replies"))

    if isinstance(data, dict):
        for key in ("comments", "replies", "newest"):
            walk(data.get(key))
    elif isinstance(data, list):
        walk(data)
    return found


def prune_comments(doc: dict, comments_dir: Path | None = None, now=None) -> int:
    """Drop comment files that are not a stored Instagram, Threads, or RSS reply."""
    from adapters.x_replies import comments_kept

    comments_dir = comments_dir or (ROOT / "comments")
    keep = set()
    for post in doc.get("posts") or []:
        if not comments_kept(post, now):
            continue
        for key in (post.get("id"), post.get("statusId")):
            if key:
                keep.add(str(key))
    if not comments_dir.is_dir():
        return 0
    changed = True
    while changed:
        changed = False
        for path in comments_dir.glob("*.json"):
            if path.name == "lookup.json" or path.stem not in keep:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for reply_id in _reply_ids(data):
                if reply_id not in keep:
                    keep.add(reply_id)
                    changed = True
    removed = 0
    for path in comments_dir.glob("*.json"):
        if path.name == "lookup.json":
            continue
        if path.stem not in keep:
            path.unlink()
            removed += 1
    if removed:
        print(f"[comments] pruned {removed} old file{'s' if removed != 1 else ''}")
    return removed


def _comment_rows(data) -> list:
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []
    rows = []
    for key in ("comments", "replies", "newest"):
        value = data.get(key)
        if isinstance(value, list):
            rows.extend(value)
    return rows


def write_comment_lookup(comments_dir: Path | None = None) -> int:
    """Map a reply id to the comment file that contains it, for fresh permalinks."""
    comments_dir = comments_dir or (ROOT / "comments")
    lookup: dict[str, str] = {}
    if comments_dir.is_dir():
        def walk(items: list, stem: str) -> None:
            for item in items:
                if not isinstance(item, dict):
                    continue
                key = str(item.get("statusId") or item.get("id") or "")
                if key:
                    lookup[key] = stem
                nested = item.get("replies")
                if isinstance(nested, list):
                    walk(nested, stem)

        for path in comments_dir.glob("*.json"):
            if path.name == "lookup.json":
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            walk(_comment_rows(data), path.stem)
    comments_dir.mkdir(parents=True, exist_ok=True)
    (comments_dir / "lookup.json").write_text(
        json.dumps(lookup, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return len(lookup)


def media_bytes(dest: Path) -> tuple[int, int]:
    if not dest.is_dir():
        return 0, 0
    files = [p for p in dest.iterdir() if p.is_file()]
    return len(files), sum(p.stat().st_size for p in files)


def build(config: dict, use_fixtures: bool, download: bool) -> dict:
    out_path = ROOT / config.get("output", "feeds.json")
    existing = load_document(out_path)
    old_by_feed = {}
    for post in existing.get("posts") or []:
        old_by_feed.setdefault(post.get("feedId"), []).append(post)
    profiles = [dict(f) for f in existing.get("feeds") or []]
    collected = []
    configured_ids = set()
    fresh_ids: set[tuple[str, str]] = set()

    for feed in config.get("feeds") or []:
        configured_ids.add(feed["id"])
        payload = None
        adapter = feed.get("adapter")
        errors = []
        if not use_fixtures and feed.get("platform") == "youtube" and not feed.get("channelId"):
            try:
                from yt_remote import resolve_channel_id

                channel_id = resolve_channel_id(feed.get("handle") or "")
                if channel_id:
                    feed["channelId"] = channel_id
                    config["_channelIdsUpdated"] = True
                    print(f"[youtube] {feed['id']}: channel {channel_id}")
            except Exception as exc:
                errors.append(f"channel id: {exc}")
        if use_fixtures and feed.get("fixture"):
            adapter = feed.get("fixtureAdapter") or adapter
            try:
                payload = (ROOT / feed["fixture"]).read_text(encoding="utf-8")
            except OSError as exc:
                errors.append(str(exc))
        else:
            if feed.get("adapter") == "x_api_v2":
                print(f"[keep] {feed['id']}: x_api_v2 parses fixtures only and does not call the X API", file=sys.stderr)
                collected.extend(old_by_feed.get(feed["id"], []))
                continue
            for source in feed.get("source_urls") or []:
                url = expand(source, config, feed)
                if not url:
                    continue
                try:
                    payload = read_source(url)
                    adapter = feed.get("adapter")
                    break
                except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
                    errors.append(f"{url}: {exc}")
            if payload is None:
                for fallback in feed.get("fallbacks") or []:
                    if fallback.get("adapter") == "x_api_v2":
                        print(f"[skip] {feed['id']}: x_api_v2 is not a live fallback", file=sys.stderr)
                        continue
                    for source in fallback.get("source_urls") or []:
                        url = expand(source, config, feed)
                        if not url:
                            continue
                        try:
                            payload = read_source(url)
                            adapter = fallback.get("adapter") or adapter
                            break
                        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
                            errors.append(f"{url}: {exc}")
                    if payload is not None:
                        break
        if payload is None:
            print(f"[keep] {feed['id']}: {errors[-1] if errors else 'no source'}", file=sys.stderr)
            collected.extend(old_by_feed.get(feed["id"], []))
            continue
        try:
            result = run_adapter(adapter, payload, feed)
        except Exception as exc:  # keep last good snapshot if a parser breaks
            print(f"[keep] {feed['id']}: parse failed: {exc}", file=sys.stderr)
            collected.extend(old_by_feed.get(feed["id"], []))
            continue
        posts = result.get("posts") or []
        if adapter == "youtube_rss" and not use_fixtures:
            from yt_remote import carry_youtube_fields

            saved = next((item for item in profiles if item.get("id") == feed.get("id")), {})
            carry_youtube_fields(posts, old_by_feed.get(feed["id"], []), saved)
        limit = feed.get("limit")
        if limit:
            posts = sorted(posts, key=lambda p: p.get("sortDate") or p.get("date") or "", reverse=True)[: int(limit)]
        for post in posts:
            post["feedId"] = feed["id"]
            post["platform"] = feed.get("platform") or post.get("platform")
            post["_fresh"] = True
            fresh_ids.add((feed["id"], str(post.get("id") or "")))
        new_ids = {str(post.get("id") or "") for post in posts}
        for old in old_by_feed.get(feed["id"], []):
            if str(old.get("id") or "") not in new_ids:
                collected.append(old)
        collected.extend(posts)
        incoming = result.get("profiles") or []
        primary = None
        for profile in incoming:
            if (profile.get("handle") or "").lower() == (feed.get("handle") or "").lower() and (
                not feed.get("platform") or profile.get("platform") == feed.get("platform")
            ):
                primary = profile
                break
        if primary is None:
            from adapters.common import blank_profile

            primary = blank_profile(feed.get("platform") or "", feed.get("handle") or "", feed.get("handle") or "")
        profiles = merge_profiles(profiles, [apply_override(primary, feed)] + [p for p in incoming if p is not primary])
        print(f"[ok] {feed['id']}: {len(posts)} posts via {adapter}")

    # discovered profiles stay, but only configured feeds are defaults to follow
    for profile in profiles:
        if profile.get("id") in configured_ids:
            profile["configured"] = True
    posts = dedupe_posts(collected, cap=int(config.get("cap") or 300))
    if download:
        print("[media] --download-media no longer copies Meta CDN files; URLs stay hotlinked", file=sys.stderr)
    refresh_saved(posts, profiles, fresh_ids)
    return {
        "updated": now_iso(),
        "preview": True,
        "feeds": profiles,
        "posts": posts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge source feeds into feeds.json")
    parser.add_argument("--config", default=str(ROOT / "feeds.config.json"))
    parser.add_argument("--fixtures", action="store_true", help="build the preview from scripts/fixtures")
    parser.add_argument("--download-media", action="store_true", help="ignored; Meta CDN URLs stay hotlinked")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    doc = build(config, args.fixtures, args.download_media)
    fresh_comment_ids = set()
    for post in doc.get("posts") or []:
        if post.pop("_fresh", False):
            fresh_comment_ids.add(str(post.get("statusId") or post.get("id") or ""))
    config.pop("_channelIdsUpdated", None)
    out = ROOT / config.get("output", "feeds.json")
    media_dir = ROOT / "media"
    removed = prune_media(media_dir, doc)
    save_document(out, doc)
    count, total = media_bytes(media_dir)
    print(f"wrote {out} ({len(doc['posts'])} posts, {len(doc['feeds'])} profiles)")
    print(f"media {count} files, {total / 1024 / 1024:.2f} MB" + (f", pruned {removed}" if removed else ""))
    try:
        from replies import refresh

        refresh(doc["posts"], args.fixtures, fresh_comment_ids)
        save_document(out, doc)
    except Exception as exc:  # a reply source failing must not wipe the feed
        print(f"[replies] {exc}", file=sys.stderr)
    prune_comments(doc)
    indexed = write_comment_lookup()
    print(f"[comments] lookup {indexed} replies")


if __name__ == "__main__":
    main()
