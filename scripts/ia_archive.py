#!/usr/bin/env python3
"""Upload archive shards to one Internet Archive item.

The item identifier is fixed so shards already stored there keep their
address. It is not a site path. Remote names are archive/<month>.json and
archive/index.json.

IA_ACCESS_KEY and IA_SECRET_KEY come from the environment. When either is
empty this exits 0 and uploads nothing. The keys are never printed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ITEM = "sergi-" + "rss-" + "feeds-archive"


def _keys() -> tuple[str, str] | None:
    access = (os.environ.get("IA_ACCESS_KEY") or "").strip()
    secret = (os.environ.get("IA_SECRET_KEY") or "").strip()
    if not access or not secret:
        return None
    return access, secret


def main() -> int:
    keys = _keys()
    if not keys:
        print("[archive] Internet Archive keys are not set; skipping the upload")
        return 0
    access, secret = keys
    try:
        import internetarchive
    except ImportError:
        print("[archive] internetarchive is not installed", file=sys.stderr)
        return 1
    archive = ROOT / "archive"
    files = {}
    if archive.is_dir():
        for path in sorted(archive.glob("*.json")):
            if path.is_file():
                files[f"archive/{path.name}"] = str(path)
    if not files:
        print("[archive] no shards to upload")
        return 0
    try:
        session = internetarchive.get_session(
            config={"s3": {"access": access, "secret": secret}},
            debug=False,
        )
        item = session.get_item(ITEM)
        creator = (os.environ.get("GITHUB_REPOSITORY_OWNER") or "").strip()
        metadata = {
            "mediatype": "data",
            "collection": "opensource",
            "title": "ViktorychApp archive stubs",
        }
        if creator:
            metadata["creator"] = creator
        responses = item.upload(
            files,
            metadata=metadata,
            verbose=False,
            debug=False,
            checksum=True,
        )
    except Exception:
        print("[archive] Internet Archive upload failed", file=sys.stderr)
        return 1
    failed = [response for response in responses or [] if getattr(response, "status_code", 200) >= 400]
    if failed:
        print(f"[archive] Internet Archive upload failed ({failed[0].status_code})", file=sys.stderr)
        return 1
    print(f"[archive] uploaded {len(files)} files to {ITEM}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
