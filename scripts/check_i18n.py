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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS = ("en", "ru", "es")
UI_FILES = (
    "app.js",
    "discord-ui.js",
    "spaces.js",
    "stories.js",
    "music.js",
    "tv.js",
    "people.js",
    "translate.js",
    "sw.js",
    "index.html",
    "404.html",
    "accounts.js",
    "shorts.js",
    "drive.js",
    "games.js",
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
    "Bot",
    "Radio",
    "Post",
    "Web",
    "Video",
    "Error",
    "No",
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
                if decoded in phrases or any(len(phrase) >= 16 and phrase in decoded for phrase in phrases):
                    if decoded in phrases or any(len(phrase) >= 16 and " " in phrase and phrase in decoded for phrase in phrases):
                        errors.append(f"{path.name}:{line_of(src, i)}: {decoded[:140]}")
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
            errors.append(f"{path.name}:{line_of(text, match.start())}: {raw}")
    for match in re.finditer(r'(?:aria-label|placeholder|title)="([^"]+)"', text):
        raw = match.group(1).strip()
        if raw in phrases and "data-i18n" not in text[max(0, match.start() - 80):match.start()]:
            errors.append(f"{path.name}:{line_of(text, match.start())}: {raw}")
    return errors


def main() -> int:
    packs = {code: load_pack(code) for code in PACKS}
    keys = [set(packs[code]) for code in PACKS]
    if keys[0] != keys[1] or keys[0] != keys[2]:
        missing = []
        for code in ("ru", "es"):
            gone = sorted(keys[0] - set(packs[code]))
            extra = sorted(set(packs[code]) - keys[0])
            if gone:
                missing.append(f"{code} missing {gone[:12]}")
            if extra:
                missing.append(f"{code} extra {extra[:12]}")
        print("\n".join(missing))
        return 1
    for key, en in packs["en"].items():
        if not str(en).strip():
            print(f"empty English value for {key}")
            return 1
        for code in ("ru", "es"):
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
        if packs["ru"][key] == en and packs["es"][key] == en:
            continue
        if len(en) >= 2:
            phrases.add(en)
    errors = []
    for name in UI_FILES:
        path = ROOT / name
        if name.endswith(".html"):
            errors.extend(scan_html(path, phrases))
        else:
            errors.extend(scan_js(path, phrases))
    if errors:
        print(f"{len(errors)} hard-coded UI phrases")
        print("\n".join(errors[:80]))
        return 1
    print(f"i18n ok ({len(packs['en'])} keys)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
