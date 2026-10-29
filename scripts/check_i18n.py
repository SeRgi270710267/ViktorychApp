#!/usr/bin/env python3
"""Fail when a language pack is missing a key or UI copy is still hard-coded.

English phrases are the dictionary keys. A phrase is translated when it is the
argument of tr(), trn(), t(), or a data-i18n attribute. Brand names that are
identical in every language are allowed to stay as written.
"""
from __future__ import annotations

import json
import re
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS = ("en", "ru", "es", "hi")
OTHER = tuple(code for code in PACKS if code != "en")
# Every page script and HTML file the app ships. Vendored players are skipped.
SKIP_FILES = {"hls-1.7.3.min.js", "mpegts-1.8.0.min.js", "accounts.config.js"}
UI_FILES = tuple(
    path.relative_to(ROOT).as_posix()
    for path in sorted(ROOT.glob("*.js")) + sorted(ROOT.glob("shared/*.js")) + sorted(ROOT.glob("*.html"))
    if path.name not in SKIP_FILES
)
# Short words that also appear as data, and phrases that are allowed to stay
# in English because they are product names or technical tokens.
ALLOW_IDENTICAL = {
    "SuperintelApp",
    "SIntelApp",
    "SIntelMusic",
    "GitHub",
    "GIF",
    "RSS",
    "ALT",
    "https://",
    "Wi-Fi",
    "X",
    "YouTube",
    "Instagram",
    "Telegram",
    "Discord",
    "Threads",
    "VK",
    "Nostr",
    "Bot",
    "Radio",
    "Post",
    "Web",
    "Video",
    "Error",
    "No",
    "Built with Llama. Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.",
}


def load_pack(code: str) -> dict:
    text = (ROOT / "i18n" / f"{code}.js").read_text(encoding="utf-8")
    start = text.index("{")
    end = text.rindex("}") + 1
    data = json.loads(text[start:end])
    if not isinstance(data, dict) or not data:
        raise SystemExit(f"{code} pack is empty")
    return data


def read_string(src: str, i: int):
    quote = src[i]
    j = i + 1
    chars = []
    n = len(src)
    while j < n:
        char = src[j]
        if char == "\\":
            if j + 1 >= n:
                return None
            nxt = src[j + 1]
            mapping = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", "'": "'", '"': '"', "`": "`"}
            chars.append(mapping.get(nxt, nxt))
            j += 2
            continue
        if char == quote:
            return j + 1, "".join(chars)
        if char == "\n":
            return None
        chars.append(char)
        j += 1
    return None


def call_name(src: str, start: int) -> str:
    j = start - 1
    while j >= 0 and src[j] in " \t\n\r":
        j -= 1
    if j < 0 or src[j] != "(":
        return ""
    j -= 1
    while j >= 0 and src[j] in " \t\n\r":
        j -= 1
    end = j + 1
    while j >= 0 and (src[j].isalnum() or src[j] in "_.$"):
        j -= 1
    return src[j + 1:end]


def object_key(src: str, start: int, end: int) -> bool:
    j = end
    while j < len(src) and src[j] in " \t\n\r":
        j += 1
    if j >= len(src) or src[j] != ":":
        return False
    k = start - 1
    while k >= 0 and src[k] in " \t\n\r":
        k -= 1
    return k >= 0 and src[k] in "{,"


def preceded_by_cmp(src: str, start: int) -> bool:
    j = start - 1
    while j >= 0 and src[j] in " \t\n\r":
        j -= 1
    chunk = src[max(0, j - 2):j + 1]
    return chunk.endswith("===") or chunk.endswith("!==") or chunk.endswith("==") or chunk.endswith("!=")


def line_of(src: str, index: int) -> int:
    return src.count("\n", 0, index) + 1


_LONG: dict[int, list[str]] = {}


def long_phrases(phrases: set[str]) -> list[str]:
    key = id(phrases)
    if key not in _LONG:
        _LONG[key] = [phrase for phrase in phrases if len(phrase) >= 16 and " " in phrase]
    return _LONG[key]


def rel_of(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_allow() -> tuple[set[str], set[str]]:
    """i18n_allow.txt: "own: <file>" marks a module with its own
    string table for every pack; "keys: <file>" marks a file whose literals are pack keys
    translated where they render; "<file>|<text>" or "*|<text>" allows one
    literal (a proper noun, brand, demo content, or technical token)."""
    keys_files, exact = set(), set()
    path = ROOT / "scripts" / "i18n_allow.txt"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("# "):
                continue
            if line.startswith("keys: "):
                keys_files.add(line[6:].strip())
            elif line.startswith("own: "):
                # A module that carries its own string table for every pack.
                own = line[5:].strip()
                src = (ROOT / own).read_text(encoding="utf-8")
                missing = [code for code in PACKS if not re.search(r"\b" + code + r"\s*:\s*\{", src)]
                if missing:
                    raise SystemExit(f"{own} is listed as carrying its own strings but has no table for {', '.join(missing)}")
                keys_files.add(own)
            else:
                exact.add(line)
    return keys_files, exact


def scan_js(path: Path, phrases: set[str]) -> list[str]:
    src = path.read_text(encoding="utf-8")
    errors = []
    i = 0
    n = len(src)
    while i < n:
        char = src[i]
        if char == "/" and i + 1 < n and src[i + 1] == "/":
            k = src.find("\n", i)
            i = n if k < 0 else k + 1
            continue
        if char == "/" and i + 1 < n and src[i + 1] == "*":
            k = src.find("*/", i + 2)
            i = n if k < 0 else k + 2
            continue
        if char in "\"'":
            parsed = read_string(src, i)
            if not parsed:
                i += 1
                continue
            end, decoded = parsed
            name = call_name(src, i)
            wrapped = name in ("tr", "trn", "t", "window.t", "window.tn", "self.t", "self.tn")
            if not wrapped and not preceded_by_cmp(src, i) and not object_key(src, i, end):
                if decoded in phrases or (len(decoded) >= 16 and any(phrase in decoded for phrase in long_phrases(phrases))):
                    errors.append(f"{rel_of(path)}:{line_of(src, i)}: {decoded[:140]}")
            i = end
            continue
        i += 1
    return errors


def scan_html(path: Path, phrases: set[str]) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors = []
    # Visible text and attributes that are dictionary phrases and not marked.
    for match in re.finditer(r">([^<]{2,180})<", text):
        raw = match.group(1).strip()
        if raw in phrases and "data-i18n" not in text[max(0, match.start() - 160):match.start()]:
            errors.append(f"{rel_of(path)}:{line_of(text, match.start())}: {raw}")
    for match in re.finditer(r'(?:aria-label|placeholder|title)="([^"]+)"', text):
        raw = match.group(1).strip()
        if raw in phrases and "data-i18n" not in text[max(0, match.start() - 80):match.start()]:
            errors.append(f"{rel_of(path)}:{line_of(text, match.start())}: {raw}")
    return errors


def main() -> int:
    packs = {code: load_pack(code) for code in PACKS}
    base = set(packs["en"])
    if any(set(packs[code]) != base for code in OTHER):
        missing = []
        for code in OTHER:
            gone = sorted(base - set(packs[code]))
            extra = sorted(set(packs[code]) - base)
            if gone:
                missing.append(f"{code} missing {gone[:12]}")
            if extra:
                missing.append(f"{code} extra {extra[:12]}")
        print("\n".join(missing))
        return 1
    plural_bases = {key.rsplit(".", 1)[0] for key in base if " " not in key and key.endswith((".one", ".few", ".many", ".other"))}
    for stem in sorted(plural_bases):
        missing = [form for form in ("one", "few", "many", "other") if f"{stem}.{form}" not in base]
        if missing:
            print(f"plural group {stem} lacks {', '.join(missing)}; Russian needs one, few, many and other")
            return 1
    for key, en in packs["en"].items():
        if not str(en).strip():
            print(f"empty English value for {key}")
            return 1
        for code in OTHER:
            value = packs[code][key]
            if not str(value).strip():
                print(f"empty {code} value for {key}")
                return 1
            if value == en and len(en) > 8 and " " in en and key not in ALLOW_IDENTICAL and en not in ALLOW_IDENTICAL:
                print(f"{code} still English for {key!r}: {en}")
                return 1
    phrases = set()
    for key, en in packs["en"].items():
        if key.startswith(("num.", "time.", "manifest.")) or key.endswith((".one", ".few", ".many", ".other")):
            continue
        if en in ALLOW_IDENTICAL or key in ALLOW_IDENTICAL:
            continue
        if all(packs[code][key] == en for code in OTHER):
            continue
        if len(en) >= 2:
            phrases.add(en)
    keys_files, exact = read_allow()
    errors = []
    for name in UI_FILES:
        if name in keys_files:
            continue
        path = ROOT / name
        found = scan_html(path, phrases) if name.endswith(".html") else scan_js(path, phrases)
        for err in found:
            text = err.split(": ", 1)[1]
            if f"{name}|{text}" in exact or f"*|{text}" in exact:
                continue
            errors.append(err)
    if errors:
        print(f"{len(errors)} hard-coded UI phrases")
        print("\n".join(errors[:120]))
        return 1
    # New English prose that is not a pack key at all.
    import i18n_hardcoded
    hits = i18n_hardcoded.find(set(packs["en"]) | set(packs["en"].values()))
    if hits:
        print(f"{len(hits)} UI strings are not in the language packs. Wrap them in tr() and add the key to every pack, or list a proper noun in scripts/i18n_allow.txt.")
        print("\n".join(f"{rel}:{line}: {text[:140]}" for rel, line, text in hits[:120]))
        return 1
    print(f"i18n ok ({len(packs['en'])} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
