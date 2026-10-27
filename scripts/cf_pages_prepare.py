"""Copy a built site into a Cloudflare Pages upload.

Pages Free allows 20,000 files and 25 MiB each. Oversized objects and, if
the tree is still too large, generated data and media are left out. The
service worker loads a missing file from the other origin.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

MAX_FILES = 20000
MAX_BYTES = 25 * 1024 * 1024

PROTECTED = {
    "index.html",
    "404.html",
    "sw.js",
    "manifest.webmanifest",
    "app.js",
    "accounts.js",
    "accounts.config.js",
    "accounts.css",
    "robots.txt",
    ".nojekyll",
    "_headers",
}


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _drop_rank(rel: str) -> int:
    if rel.startswith("data/communities/") and rel.count("/") >= 3:
        return 0
    if rel.startswith("comments/"):
        return 1
    if rel.startswith("discord/"):
        return 2
    if rel.startswith("archive/") and not rel.endswith(".json"):
        return 3
    if rel.startswith("splash/"):
        return 4
    if rel.startswith("screenshots/"):
        return 5
    return 9


def _protected(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    if name in PROTECTED or rel in PROTECTED:
        return True
    if rel.startswith("icons/") or rel.startswith("i18n/") or rel.startswith("shared/"):
        return True
    return False


def collect(site: Path) -> list[tuple[str, int]]:
    found = []
    for path in site.rglob("*"):
        if not path.is_file():
            continue
        rel = _rel(path, site)
        if rel.startswith(".git/"):
            continue
        found.append((rel, path.stat().st_size))
    found.sort()
    return found


def choose(files: list[tuple[str, int]], max_files: int, max_bytes: int) -> tuple[list[str], list[str]]:
    dropped = []
    survivors = []
    for rel, size in files:
        if size >= max_bytes:
            dropped.append(rel)
        else:
            survivors.append((rel, size))

    def optional(item: tuple[str, int]) -> bool:
        return _drop_rank(item[0]) < 9 and not _protected(item[0])

    for item in sorted((row for row in survivors if optional(row)), key=lambda row: (_drop_rank(row[0]), -row[1], row[0])):
        if len(survivors) <= max_files:
            break
        survivors.remove(item)
        dropped.append(item[0])
    if len(survivors) > max_files:
        for item in sorted((row for row in survivors if not _protected(row[0])), key=lambda row: (-row[1], row[0])):
            if len(survivors) <= max_files:
                break
            survivors.remove(item)
            dropped.append(item[0])
    return [rel for rel, _size in survivors], dropped


def headers_text() -> str:
    return (
        "/*\n"
        "  Access-Control-Allow-Origin: *\n"
        "  Access-Control-Allow-Methods: GET, HEAD, OPTIONS\n"
        "  X-Content-Type-Options: nosniff\n"
        "\n"
        "/version.json\n"
        "  Cache-Control: no-store\n"
    )


def prepare(site: Path, out: Path, max_files: int = MAX_FILES, max_bytes: int = MAX_BYTES) -> list[str]:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    kept, dropped = choose(collect(site), max(1, max_files - 2), max_bytes)
    for rel in kept:
        src = site / rel
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    (out / "_headers").write_text(headers_text(), encoding="utf-8")
    note = out / "MIRROR_EXCLUDED.txt"
    lines = ["# Files left off the Cloudflare Pages upload.", "# The other origin still serves them."]
    lines.extend(sorted(dropped))
    note.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return dropped


def selftest() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        site = root / "site"
        (site / "data" / "communities" / "grapheneos").mkdir(parents=True)
        (site / "index.html").write_text("<html></html>", encoding="utf-8")
        (site / "sw.js").write_text("/* sw */", encoding="utf-8")
        (site / "icons").mkdir()
        (site / "icons" / "icon-192.png").write_bytes(b"png")
        for i in range(12):
            (site / "data" / "communities" / "grapheneos" / f"{i}.json").write_text("{}", encoding="utf-8")
        (site / "comments").mkdir()
        (site / "comments" / "a.json").write_text("{}", encoding="utf-8")
        big = site / "archive" / "clip.mp4"
        big.parent.mkdir(parents=True)
        big.write_bytes(b"x" * (MAX_BYTES + 10))
        dropped = prepare(site, root / "out", max_files=8, max_bytes=MAX_BYTES)
        out = root / "out"
        names = [path.relative_to(out).as_posix() for path in out.rglob("*") if path.is_file()]
        upload = [name for name in names if name not in {"_headers", "MIRROR_EXCLUDED.txt"}]
        if len(upload) > 8:
            print("too many files", len(upload))
            return 1
        if "index.html" not in upload or "sw.js" not in upload or "icons/icon-192.png" not in upload:
            print("shell missing", upload)
            return 1
        if any(name.endswith(".mp4") for name in upload):
            print("oversized file was copied")
            return 1
        if "archive/clip.mp4" not in dropped:
            print("oversized file was not listed", dropped)
            return 1
        headers = (out / "_headers").read_text(encoding="utf-8")
        if "Access-Control-Allow-Origin: *" not in headers:
            print("cors header missing")
            return 1
        if any("data/communities/grapheneos/" in name for name in upload) and len(upload) > 8:
            print("topic pages were kept past the cap")
            return 1
    print("pages mirror prepare selftest ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site")
    parser.add_argument("--out")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.site or not args.out:
        print("pass --site and --out, or --selftest")
        return 1
    dropped = prepare(Path(args.site), Path(args.out))
    copied = sum(1 for _path in Path(args.out).rglob("*") if _path.is_file())
    print(f"pages mirror files: {copied} (excluded {len(dropped)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
