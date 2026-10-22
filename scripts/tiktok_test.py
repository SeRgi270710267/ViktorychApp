#!/usr/bin/env python3
"""Offline checks for TikTok normalize and the owner/public split."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tiktok_sync import audience_of, choose_format, entry_to_post, place, publish_iso  # noqa: E402


def main() -> int:
    assert audience_of('tiktokAudience: "owner"') == "owner"
    assert audience_of('tiktokAudience: "all"') == "all"
    assert audience_of("") == "owner"
    assert publish_iso(None) == ""
    assert publish_iso(0) == ""
    iso = publish_iso(1791742719)
    assert iso == "2026-10-11T18:18:39Z"
    assert publish_iso(1791742719000) == iso
    h264 = {"vcodec": "h264", "url": "https://cdn.example/h264.mp4", "height": 576, "width": 1024}
    hevc = {"vcodec": "h265", "url": "https://cdn.example/hevc.mp4", "height": 720, "width": 1280}
    picked = choose_format([hevc, h264])
    assert picked["url"].endswith("h264.mp4")
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
        "formats": [hevc, h264],
        "thumbnails": [{"url": "https://cdn.example/poster.jpg"}],
    }, "gabii_g5")
    assert post["date"] == iso
    assert post["ownerOnly"] is True
    assert post["short"] is True
    assert post["platform"] == "tiktok"
    assert post["media"][0]["url"].endswith("h264.mp4")
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
    print("tiktok normalize ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
