#!/usr/bin/env python3
"""Fail when a private handle list or an owner id is present in the tree.

HANDLE_DENYLIST and OWNER_IDS are newline-separated secrets. Comparison uses
sha256, and a match is reported as a path and a count. The values are not
printed. An empty secret list skips that half so a fork can still run the
structural self-test.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN = re.compile(r"[A-Za-z0-9_\u0400-\u04FF.]{2,64}")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".wrangler", "_site"}
TEXT_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".py", ".json", ".yml", ".yaml", ".md", ".html",
    ".css", ".toml", ".txt", ".svg", ".webmanifest", ".xml",
}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hashes_for(secret: str) -> set[str]:
    found = set()
    for line in (secret or "").splitlines():
        item = line.strip()
        if not item or item.startswith("#"):
            continue
        found.add(digest(item))
        folded = item.casefold()
        if folded != item:
            found.add(digest(folded))
    return found


def scan_text(text: str, banned: set[str]) -> int:
    if not banned or not text:
        return 0
    hits = 0
    seen = set()
    for token in TOKEN.findall(text):
        if token in seen:
            continue
        seen.add(token)
        if digest(token) in banned or digest(token.casefold()) in banned:
            hits += 1
    return hits


def iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def scan_tree(root: Path, banned: set[str]) -> list[tuple[str, int]]:
    rows = []
    for path in iter_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        hits = scan_text(text, banned)
        if hits:
            rows.append((str(path.relative_to(root)), hits))
    return rows


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        return selftest()
    banned = hashes_for(os.environ.get("HANDLE_DENYLIST") or "")
    banned |= hashes_for(os.environ.get("OWNER_IDS") or "")
    if not banned:
        print("private handle list is not configured; hash comparison skipped")
        return 0
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for key in ("HANDLE_DENYLIST", "OWNER_IDS"):
            for line in (os.environ.get(key) or "").splitlines():
                item = line.strip()
                if item:
                    sys.__stdout__.write("::add-mask::" + item + "\n")
        sys.__stdout__.flush()
    rows = scan_tree(ROOT, banned)
    extra = (os.environ.get("PR_TITLE") or "") + "\n" + (os.environ.get("PR_BODY") or "")
    body_hits = scan_text(extra, banned)
    if body_hits:
        rows.append(("pull request text", body_hits))
    if not rows:
        print("handle guard: no matches")
        return 0
    total = sum(count for _path, count in rows)
    print(f"handle guard: {total} matches in {len(rows)} places")
    for path, count in rows:
        print(f"{count}\t{path}")
    return 1


def selftest() -> int:
    import tempfile

    banned = hashes_for("madeuphandlezzz\n")
    assert scan_text("hello madeuphandlezzz there", banned) == 1
    assert scan_text("orbitfox stays", banned) == 0
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "note.txt").write_text("see madeuphandlezzz\n", encoding="utf-8")
        rows = scan_tree(root, banned)
        assert rows == [("note.txt", 1)]
        (root / "note.txt").write_text("orbitfox\n", encoding="utf-8")
        assert scan_tree(root, banned) == []
    print("handle guard selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
