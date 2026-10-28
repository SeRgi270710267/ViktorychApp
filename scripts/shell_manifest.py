#!/usr/bin/env python3
"""Write shell-manifest.json into a built site: the commit, the build time and
a SHA-256 and size for every file the service worker precaches. The worker
uses it to download only changed files and to never mix two deploys. Run it
after every step that edits files in the site."""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path


def shell_files(sw_text: str) -> list:
    match = re.search(r"const SHELL_FILES = \[(.*?)\];", sw_text, re.S)
    if not match:
        return []
    return re.findall(r'"(\./[^"]*)"', match.group(1))


def build(site: Path, sha: str = "", built: str = "") -> dict:
    sw = site / "sw.js"
    files = {}
    for rel in shell_files(sw.read_text(encoding="utf-8") if sw.is_file() else ""):
        path = site / (rel[2:] or "index.html")
        if path.is_file():
            data = path.read_bytes()
            files[rel] = [hashlib.sha256(data).hexdigest(), len(data)]
    return {
        "sha": (sha or os.environ.get("GITHUB_SHA") or "").lower(),
        "built": built or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": files,
    }


def write(site: Path) -> int:
    doc = build(site)
    (site / "shell-manifest.json").write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"[shell-manifest] {len(doc['files'])} files")
    return 0


def selftest() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp)
        (site / "sw.js").write_text('const SHELL_FILES = [\n  "./",\n  "./a.js",\n  "./i18n/en.js",\n  "./gone.css"\n];', encoding="utf-8")
        (site / "a.js").write_text("a", encoding="utf-8")
        (site / "i18n").mkdir()
        (site / "i18n" / "en.js").write_text("en", encoding="utf-8")
        doc = build(site, "ABC", "2026-01-01T00:00:00Z")
        (site / "index.html").write_text("<html></html>", encoding="utf-8")
        doc = build(site, "ABC", "2026-01-01T00:00:00Z")
        if doc["sha"] != "abc" or sorted(doc["files"]) != ["./", "./a.js", "./i18n/en.js"]:
            return 1
        if doc["files"]["./a.js"] != [hashlib.sha256(b"a").hexdigest(), 1]:
            return 1
    print("shell manifest selftest ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.site:
        print("pass --site or --selftest")
        return 1
    return write(Path(args.site))


if __name__ == "__main__":
    sys.exit(main())
