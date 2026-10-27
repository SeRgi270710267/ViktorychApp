"""Copy a built site into a Cloudflare Pages upload.

Pages Free allows 20,000 files and 25 MiB each. Oversized objects and, if
the tree is still too large, generated data and media are left out. The
service worker loads a missing file from the other origin.
"""

from __future__ import annotations

import argparse
import re
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


def local_ref(value: str) -> str:
    text = str(value or "").strip()
    if not text or text in {".", "./", "/"}:
        return ""
    lower = text.lower()
    if lower.startswith(("http://", "https://", "data:", "mailto:", "javascript:", "//", "#")):
        return ""
    text = text.split("#", 1)[0].split("?", 1)[0].strip()
    if text.startswith("/"):
        text = text[1:]
    while text.startswith("./"):
        text = text[2:]
    if not text or text.endswith("/") or ".." in text.split("/"):
        return ""
    return text


def html_refs(text: str) -> list[str]:
    found = []
    for match in re.finditer(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", text, re.I):
        rel = local_ref(match.group(1))
        if rel:
            found.append(rel)
    return found


def shell_refs(text: str) -> list[str]:
    found = []
    start = text.find("SHELL_FILES")
    end = text.find("];", start) if start >= 0 else -1
    block = text[start:end] if start >= 0 and end > start else ""
    for match in re.finditer(r"""["']([^"']+)["']""", block):
        rel = local_ref(match.group(1))
        if rel:
            found.append(rel)
    for call in re.finditer(r"importScripts\(([^)]*)\)", text):
        for match in re.finditer(r"""["']([^"']+)["']""", call.group(1)):
            rel = local_ref(match.group(1))
            if rel:
                found.append(rel)
    return found


def referenced_paths(index_html: str, service_worker: str) -> list[str]:
    found = []
    seen = set()
    for rel in html_refs(index_html) + shell_refs(service_worker):
        if rel in seen:
            continue
        seen.add(rel)
        found.append(rel)
    return found


def workflow_ships(assemble: str, rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    if re.search(r"(?:^|[\s/])" + re.escape(name) + r"(?:$|[\s])", assemble):
        return True
    parent = rel.split("/", 1)[0]
    if parent != rel and (f"cp {parent}/" in assemble or f"cp {parent}/*" in assemble or f"{parent}/*.js" in assemble):
        return True
    return False


def missing_referenced(upload: Path) -> list[str]:
    index_path = upload / "index.html"
    sw_path = upload / "sw.js"
    index_html = index_path.read_text(encoding="utf-8") if index_path.is_file() else ""
    service_worker = sw_path.read_text(encoding="utf-8") if sw_path.is_file() else ""
    missing = []
    if not index_path.is_file():
        missing.append("index.html")
    if not sw_path.is_file():
        missing.append("sw.js")
    for rel in referenced_paths(index_html, service_worker):
        if not (upload / rel).is_file():
            missing.append(rel)
    return missing


def choose(files: list[tuple[str, int]], max_files: int, max_bytes: int, required: set[str] | None = None) -> tuple[list[str], list[str]]:
    needed = required or set()
    dropped = []
    survivors = []
    for rel, size in files:
        if size >= max_bytes and rel not in needed:
            dropped.append(rel)
        else:
            survivors.append((rel, size))

    def optional(item: tuple[str, int]) -> bool:
        return item[0] not in needed and _drop_rank(item[0]) < 9 and not _protected(item[0])

    for item in sorted((row for row in survivors if optional(row)), key=lambda row: (_drop_rank(row[0]), -row[1], row[0])):
        if len(survivors) <= max_files:
            break
        survivors.remove(item)
        dropped.append(item[0])
    if len(survivors) > max_files:
        optional_left = [row for row in survivors if row[0] not in needed and not _protected(row[0])]
        for item in sorted(optional_left, key=lambda row: (-row[1], row[0])):
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
    index_html = (site / "index.html").read_text(encoding="utf-8") if (site / "index.html").is_file() else ""
    service_worker = (site / "sw.js").read_text(encoding="utf-8") if (site / "sw.js").is_file() else ""
    required = set(referenced_paths(index_html, service_worker))
    kept, dropped = choose(collect(site), max(1, max_files - 2), max_bytes, required)
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
        shell = root / "shell"
        shell.mkdir()
        (shell / "index.html").write_text(
            '<link rel="stylesheet" href="presence.css"><script src="presence.js" type="module"></script>'
            '<link rel="apple-touch-startup-image" href="splash/iphone-se.png">',
            encoding="utf-8",
        )
        (shell / "sw.js").write_text(
            'importScripts("./shared/mirror.js?" + VERSION, "./storage.js?" + VERSION);\n'
            'const SHELL_FILES = ["./", "./presence.js", "./presence.css", "./shared/presence.js"];\n',
            encoding="utf-8",
        )
        (shell / "presence.js").write_text("/* presence */", encoding="utf-8")
        (shell / "presence.css").write_text("/* presence */", encoding="utf-8")
        (shell / "storage.js").write_text("/* storage */", encoding="utf-8")
        (shell / "shared").mkdir()
        (shell / "shared" / "presence.js").write_text("/* shared */", encoding="utf-8")
        (shell / "shared" / "mirror.js").write_text("/* mirror */", encoding="utf-8")
        (shell / "splash").mkdir()
        (shell / "splash" / "iphone-se.png").write_bytes(b"png")
        (shell / "data").mkdir()
        (shell / "data" / "extra.json").write_text("{}", encoding="utf-8")
        prepare(shell, root / "shell-out", max_files=3, max_bytes=MAX_BYTES)
        shipped = root / "shell-out"
        if missing_referenced(shipped):
            print("referenced shell was dropped", missing_referenced(shipped))
            return 1
        for name in ("presence.js", "presence.css", "shared/presence.js", "shared/mirror.js", "storage.js", "splash/iphone-se.png"):
            if not (shipped / name).is_file():
                print("pages upload missed", name)
                return 1
        if (shipped / "data" / "extra.json").is_file():
            print("unreferenced file was kept past the cap")
            return 1
        (shipped / "presence.css").unlink()
        gone = missing_referenced(shipped)
        if "presence.css" not in gone:
            print("missing presence.css was not reported", gone)
            return 1
        repo = Path(__file__).resolve().parents[1]
        live_index = (repo / "index.html").read_text(encoding="utf-8")
        live_sw = (repo / "sw.js").read_text(encoding="utf-8")
        live_refs = referenced_paths(live_index, live_sw)
        for name in ("presence.js", "presence.css", "shared/presence.js"):
            if name not in live_refs:
                print("live shell does not reference", name)
                return 1
        absent = [rel for rel in live_refs if not (repo / rel).is_file()]
        if absent:
            print("referenced source missing", absent)
            return 1
        sync = (repo / ".github" / "workflows" / "sync.yml").read_text(encoding="utf-8")
        assemble = sync.split("Assemble the site", 1)[-1].split("pages-mirror:", 1)[0]
        uncovered = [rel for rel in live_refs if not workflow_ships(assemble, rel)]
        if uncovered:
            print("site assemble does not ship", uncovered)
            return 1
        live = root / "live"
        live.mkdir()
        (live / "index.html").write_text(live_index, encoding="utf-8")
        (live / "sw.js").write_text(live_sw, encoding="utf-8")
        for rel in live_refs:
            dest = live / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(repo / rel, dest)
        prepare(live, root / "live-out", max_files=3, max_bytes=MAX_BYTES)
        live_missing = missing_referenced(root / "live-out")
        if live_missing:
            print("live pages upload missed", live_missing)
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
    out = Path(args.out)
    dropped = prepare(Path(args.site), out)
    copied = sum(1 for _path in out.rglob("*") if _path.is_file())
    print(f"pages mirror files: {copied} (excluded {len(dropped)})")
    missing = missing_referenced(out)
    if missing:
        print("[pages] The Pages upload is missing assets referenced by index.html or sw.js.", file=sys.stderr)
        for rel in missing:
            print("[pages] missing " + rel, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
