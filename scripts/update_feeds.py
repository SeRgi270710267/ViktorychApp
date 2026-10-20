#!/usr/bin/env python3
"""Fetch configured sources and merge them into feeds.json.

Usage:
  python3 scripts/update_feeds.py [--config feeds.config.json]
  python3 scripts/update_feeds.py --fixtures

Network sources are tried in order. A failed source keeps the last good posts
for that feed. --fixtures reads each feed's local fixture instead (used to
rebuild the shipped preview). Placeholders {rsshubBase} and {fxtwitterBase}
in source URLs are filled from the config.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
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
    )


def read_source(url: str) -> str:
    if url.startswith("file://"):
        return Path(url[7:]).read_text(encoding="utf-8")
    path = Path(url)
    if not url.startswith("http://") and not url.startswith("https://") and path.exists():
        return path.read_text(encoding="utf-8")
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=40) as response:
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
    if not merged.get("url"):
        from adapters.common import profile_url

        merged["url"] = profile_url(merged["platform"], merged["handle"])
    return merged


def run_adapter(name: str, payload: str, feed: dict) -> dict:
    if name not in ADAPTERS:
        raise SystemExit(f"unknown adapter {name}")
    return ADAPTERS[name](payload, feed)


def download_media(posts, dest: Path, limit_bytes: int = 2_500_000) -> None:
    dest.mkdir(parents=True, exist_ok=True)

    def fetch(url: str, hint: str) -> str:
        if not url or url.startswith("media/") or url.startswith("data:"):
            return url
        # Meta CDN links and other hotlinked media expire; keep a local copy.
        expiring = "oe=" in url or "cdninstagram.com" in url or "fbcdn.net" in url or "twimg.com" in url
        if not expiring:
            return url
        name = media_basename(url, hint)
        target = dest / name
        if target.exists() and target.stat().st_size > 0:
            return f"media/{name}"
        if target.suffix == ".mp4":
            return url
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*,*/*"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(limit_bytes + 1)
            if len(data) > limit_bytes or len(data) < 32:
                return url
            target.write_bytes(data)
            return f"media/{name}"
        except (urllib.error.URLError, TimeoutError, OSError):
            return url

    for post in posts:
        hint = f"{post.get('platform') or 'post'}-{post.get('handle') or 'x'}"
        if post.get("avatar"):
            post["avatar"] = fetch(post["avatar"], hint + "-avatar")
        for index, item in enumerate(post.get("media") or []):
            if index >= 4:
                break
            if item.get("poster"):
                item["poster"] = fetch(item["poster"], hint)
            if item.get("type") == "photo" and item.get("url"):
                item["url"] = fetch(item["url"], hint)
            elif item.get("poster") and item.get("type") != "photo":
                # keep remote mp4; poster is enough if the video URL expires
                pass
        if post.get("quoted"):
            download_media([post["quoted"]], dest, limit_bytes)
        photos = [m.get("url") for m in post.get("media") or [] if m.get("type") == "photo" and m.get("url")]
        post["images"] = photos


def build(config: dict, use_fixtures: bool, download: bool) -> dict:
    out_path = ROOT / config.get("output", "feeds.json")
    existing = load_document(out_path)
    old_by_feed = {}
    for post in existing.get("posts") or []:
        old_by_feed.setdefault(post.get("feedId"), []).append(post)
    profiles = [dict(f) for f in existing.get("feeds") or []]
    collected = []
    configured_ids = set()

    for feed in config.get("feeds") or []:
        configured_ids.add(feed["id"])
        payload = None
        adapter = feed.get("adapter")
        errors = []
        if use_fixtures and feed.get("fixture"):
            adapter = feed.get("fixtureAdapter") or adapter
            try:
                payload = (ROOT / feed["fixture"]).read_text(encoding="utf-8")
            except OSError as exc:
                errors.append(str(exc))
        else:
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
        limit = feed.get("limit")
        if limit:
            posts = sorted(posts, key=lambda p: p.get("sortDate") or p.get("date") or "", reverse=True)[: int(limit)]
        for post in posts:
            post["feedId"] = feed["id"]
            post["platform"] = feed.get("platform") or post.get("platform")
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
        download_media(posts, ROOT / "media")
        for profile in profiles:
            if profile.get("avatar"):
                fake = {"platform": profile.get("platform"), "handle": profile.get("handle"), "avatar": profile["avatar"], "media": []}
                download_media([fake], ROOT / "media")
                profile["avatar"] = fake["avatar"]
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
    parser.add_argument("--download-media", action="store_true", help="copy expiring media into media/")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    doc = build(config, args.fixtures, args.download_media)
    out = ROOT / config.get("output", "feeds.json")
    save_document(out, doc)
    print(f"wrote {out} ({len(doc['posts'])} posts, {len(doc['feeds'])} profiles)")


if __name__ == "__main__":
    main()
