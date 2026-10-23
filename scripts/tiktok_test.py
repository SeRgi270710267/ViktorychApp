#!/usr/bin/env python3
"""Offline checks for TikTok normalize and the owner/public split."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from datetime import datetime, timedelta, timezone

from tiktok_sync import (  # noqa: E402
    apply_fetch_identity,
    audience_of,
    backoff_seconds,
    checked_recent,
    choose_format,
    entry_to_post,
    place,
    publish_iso,
    sync_handles,
)


def main() -> int:
    assert audience_of('tiktokAudience: "owner"') == "owner"
    assert audience_of('tiktokAudience: "all"') == "all"
    assert audience_of("") == "owner"
    assert publish_iso(None) == ""
    assert publish_iso(0) == ""
    iso = publish_iso(1791742719)
    assert iso == "2026-10-11T18:18:39Z"
    assert publish_iso(1791742719000) == iso
    h264 = {"vcodec": "h264", "url": "https://cdn.example/h264.mp4", "height": 1080, "width": 1920, "tbr": 2500}
    low = {"vcodec": "h265", "url": "https://cdn.example/hevc.mp4", "height": 720, "width": 1280, "tbr": 800}
    top = {"vcodec": "bytevc1", "url": "https://cdn.example/bytevc1.mp4", "height": 720, "width": 1280, "tbr": 1600}
    picked = choose_format([h264, low, top])
    assert picked["url"].endswith("bytevc1.mp4")
    assert choose_format([h264])["url"].endswith("h264.mp4")
    missing = entry_to_post({"id": "123456", "description": "no time"}, "gabii_g5")
    assert missing is None
    post = entry_to_post({
        "id": "7695476356548660503",
        "timestamp": 1791742719,
        "description": "caption",
        "uploader": "gabii_g5",
        "nickname": "gabii",
        "avatar": "https://cdn.example/face.jpg",
        "like_count": 43,
        "comment_count": 7,
        "view_count": 517,
        "duration": 19,
        "formats": [low, top, h264],
        "thumbnails": [{"url": "https://cdn.example/poster.jpg"}],
    }, "gabii_g5")
    assert post["date"] == iso
    assert post["ownerOnly"] is True
    assert post["short"] is True
    assert post["platform"] == "tiktok"
    assert post["media"][0]["url"].endswith("bytevc1.mp4")
    assert post["media"][0]["codec"] == "bytevc1"
    assert post["media"][0]["height"] == 720
    slides = entry_to_post({
        "id": "7695476356548660503",
        "timestamp": 1791742719,
        "description": "slides",
        "formats": [
            {"ext": "jpeg", "vcodec": "none", "url": "https://p16.tiktokcdn.com/1.jpg"},
            {"ext": "jpeg", "vcodec": "none", "url": "https://p16.tiktokcdn.com/2.jpg"},
        ],
        "images": [{"url": "https://p16.tiktokcdn.com/3.jpg"}],
    }, "gabii_g5")
    urls = [item["url"] for item in slides["media"]]
    assert urls == [
        "https://p16.tiktokcdn.com/1.jpg",
        "https://p16.tiktokcdn.com/2.jpg",
        "https://p16.tiktokcdn.com/3.jpg",
    ]
    assert all(item["type"] == "photo" for item in slides["media"])
    assert "T" in post["date"] and post["date"] != ""
    root = Path(__file__).resolve().parents[1]
    tmp = root / "owner" / "tiktok-test-tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    feeds = tmp / "feeds.json"
    owner = tmp / "owner.json"
    feeds.write_text(json.dumps({"feeds": [{"id": "x:a", "platform": "x"}], "posts": [{"id": "1", "platform": "x"}]}), encoding="utf-8")
    doc = {"feeds": [post and {"id": "tiktok:gabii_g5", "platform": "tiktok"}], "posts": [post], "live": {}}
    before = feeds.read_text(encoding="utf-8")
    place(doc, "owner", feeds, owner)
    assert feeds.read_text(encoding="utf-8") == before
    assert '"platform": "tiktok"' not in feeds.read_text(encoding="utf-8")
    saved = json.loads(owner.read_text(encoding="utf-8"))
    assert saved["posts"][0]["id"].startswith("tiktok:")
    place(doc, "all", feeds, owner)
    merged = json.loads(feeds.read_text(encoding="utf-8"))
    assert any(row.get("platform") == "tiktok" for row in merged["posts"])
    feeds.unlink()
    owner.unlink()
    tmp.rmdir()
    config = {}
    accounts = {"added": [{"handle": "old_name", "permanentId": "991122", "platform": "tiktok"}], "removed": ["gabii_g5"]}
    renamed = apply_fetch_identity(config, accounts, "old_name", {
        "uploader_id": "991122",
        "channel_id": "MS4wLjABAAAA12345678",
        "uploader": "new_name",
    })
    assert renamed == "old_name"
    assert "tiktok" not in config
    assert accounts["added"][0]["handle"] == "new_name"
    assert "old_name" in accounts["added"][0]["previousHandles"]
    assert accounts["added"][0]["secUid"] == "MS4wLjABAAAA12345678"
    handles = sync_handles({"tiktok": [{"handle": "config_one"}]}, accounts)
    assert handles[0] == "new_name"
    assert "config_one" in handles
    assert "gabii_g5" not in handles
    assert backoff_seconds(0, 0) == (300, 1)
    assert backoff_seconds(1, 0) == (900, 2)
    assert backoff_seconds(2, 0) == (3600, 3)
    assert backoff_seconds(4, 0) == (6 * 60 * 60, 4)
    assert backoff_seconds(0, 7200) == (7200, 1)
    assert backoff_seconds(0, 999999) == (6 * 60 * 60, 1)
    moment = datetime(2026, 10, 23, 0, 0, tzinfo=timezone.utc)
    fresh = {"checkedAt": (moment - timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    stale = {"checkedAt": (moment - timedelta(seconds=300)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    assert checked_recent(fresh, 240, moment) is True
    assert checked_recent(stale, 240, moment) is False
    print("tiktok normalize ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
