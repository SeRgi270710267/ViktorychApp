#!/usr/bin/env python3
"""Merge one X API v2 timeline response into feeds.json.

  python3 scripts/x_to_feed.py response.json --feed x:redacted_handle --handle redacted_handle
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.common import dedupe_posts, load_document, merge_profiles, save_document  # noqa: E402
from adapters.x_api_v2 import parse  # noqa: E402
from update_feeds import now_iso  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge an X API v2 payload into feeds.json")
    parser.add_argument("payload", help="path to an X API v2 JSON response")
    parser.add_argument("--feeds", default="feeds.json")
    parser.add_argument("--feed", default="x:redacted_handle", help="feed id to assign")
    parser.add_argument("--handle", default="redacted_handle")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    text = Path(args.payload).read_text(encoding="utf-8")
    feed = {"id": args.feed, "platform": "x", "handle": args.handle}
    result = parse(text, feed)
    posts = result["posts"]
    if args.limit:
        posts = sorted(posts, key=lambda p: p.get("date") or "", reverse=True)[: args.limit]
    for post in posts:
        post["feedId"] = args.feed
    path = Path(args.feeds)
    doc = load_document(path)
    others = [p for p in doc.get("posts") or [] if p.get("feedId") != args.feed]
    doc["posts"] = dedupe_posts(others + posts, cap=300)
    doc["feeds"] = merge_profiles(doc.get("feeds") or [], result.get("profiles") or [])
    doc["updated"] = now_iso()
    save_document(path, doc)
    print(f"merged {len(posts)} posts into {path}")


if __name__ == "__main__":
    main()
