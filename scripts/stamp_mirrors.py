"""Stamp the deployed service worker with this repository's Pages origins.

The source file keeps placeholders. GitHub Pages and the Cloudflare Pages
mirror both receive the same stamped copy.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_paths import pages_base  # noqa: E402

PAGES = "https://viktorychapp.pages.dev/"


def stamp(site: Path, github: str) -> None:
    base = github if github.endswith("/") else github + "/"
    sw = site / "sw.js"
    if sw.is_file():
        text = sw.read_text(encoding="utf-8")
        text = text.replace("__MIRROR_GITHUB__", base[:-1])
        text = text.replace("__MIRROR_PAGES__", PAGES[:-1])
        sw.write_text(text, encoding="utf-8")
    mirror = site / "shared" / "mirror.js"
    if mirror.is_file():
        raw = mirror.read_text(encoding="utf-8")
        raw = raw.replace("https://viktorychgroup.github.io/ViktorychApp/", base)
        mirror.write_text(raw, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    args = parser.parse_args()
    github = pages_base() or "https://viktorychgroup.github.io/ViktorychApp/"
    stamp(Path(args.site), github)
    print("mirror origins stamped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
