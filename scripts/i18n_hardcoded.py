#!/usr/bin/env python3
"""Find English UI text that is not routed through the language packs.

check_i18n.py already fails on dictionary phrases that are not wrapped. This
pass looks for new prose: visible HTML text and attributes, text between tags
inside JS strings and template literals, and sentence-like JS strings. Proper
nouns, brands, demo content and technical tokens live in i18n_allow.txt, one
per line. Run with --list to print every hit without the allow list.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"hls-1.7.3.min.js", "mpegts-1.8.0.min.js", "accounts.config.js"}
WRAPPERS = ("tr", "trn", "t", "tn", "window.t", "window.tn", "self.t", "self.tn", "SI18n.t", "SI18n.tn", "window.SI18n.t", "window.SI18n.tn")
NOT_UI_CALL = re.compile(
    r"(?:^|\.)(?:log|warn|error|info|debug|Error|TypeError|RangeError|SyntaxError|querySelector|querySelectorAll|getElementById|"
    r"closest|matches|setAttribute|getAttribute|removeAttribute|hasAttribute|toggleAttribute|addEventListener|removeEventListener|"
    r"dispatchEvent|Event|CustomEvent|postMessage|fetch|importScripts|getItem|setItem|removeItem|createElement|createElementNS|test|"
    r"match|matchAll|replace|replaceAll|split|indexOf|lastIndexOf|includes|startsWith|endsWith|matchMedia|set|get|has|append|delete|"
    r"open|define|require|RegExp|encode|decode|digest|importKey|deriveKey|sign|verify|track|sendBeacon|mark|measure|CacheStorage)$"
)
SVG_PATH = re.compile(r"^[MmLlHhVvCcZzAaQqSsTt]\s*-?\.?\d")
HEADER = re.compile(r"^[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)+$")
TECH = re.compile(r"https?:|www\.|\.(?:js|mjs|css|png|svg|json|html|webp|jpg|mp4|m4a|pdf|txt)\b|[;=<>\\]|\$\{|^[#./(\[{'\"]|^\W*$")


def prose(text: str) -> bool:
    s = text.strip()
    if len(s) < 3 or not re.search(r"[A-Za-z]{2,}", s):
        return False
    if SVG_PATH.match(s) or HEADER.match(s) or TECH.search(s):
        return False
    if s in ("Bearer", "Authorization", "Range") or " + " in s:
        return False
    if re.fullmatch(r"[a-z0-9_.:-]+", s) or re.fullmatch(r"[a-z]+(?:[A-Z][a-z0-9]*)+", s):
        return False
    if not re.match(r"[A-Z0-9“\"(¿¡@]", s):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z'’]*", s)
    if len(words) < 2 and not re.fullmatch(r"[A-Z][a-z]{2,}[.!?…:]?", s):
        return False
    if ":" in s and re.search(r"\b(?:px|rem|rgba?|solid|flex|none|auto|inherit)\b", s):
        return False
    return True


def line_of(src: str, index: int) -> int:
    return src.count("\n", 0, index) + 1


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


def skipped_context(src: str, start: int, end: int) -> bool:
    j = start - 1
    while j >= 0 and src[j] in " \t\n\r":
        j -= 1
    before = src[max(0, j - 2):j + 1]
    if before.endswith(("==", "!=", "case")) or src[max(0, j - 3):j + 1] == "case":
        return True
    if j >= 0 and src[j] == "[":
        k = end
        while k < len(src) and src[k] in " \t\n\r":
            k += 1
        if k < len(src) and src[k] == "]":
            return True
    k = end
    while k < len(src) and src[k] in " \t\n\r":
        k += 1
    if k < len(src) and src[k] == ":" and j >= 0 and src[j] in "{,":
        return True
    return False


def read_quoted(src: str, i: int):
    quote = src[i]
    j = i + 1
    out = []
    while j < len(src):
        c = src[j]
        if c == "\\":
            out.append(src[j + 1:j + 2])
            j += 2
            continue
        if c == quote:
            return j + 1, "".join(out)
        if c == "\n":
            return None
        out.append(c)
        j += 1
    return None


def regex_start(src: str, i: int) -> bool:
    j = i - 1
    while j >= 0 and src[j] in " \t":
        j -= 1
    if j < 0:
        return True
    if src[j] in "(,=:[!&|?{};+-*%<>~^\n":
        return True
    word = re.search(r"(?:return|typeof|case|in|of|void|delete)$", src[max(0, j - 8):j + 1])
    return bool(word)


def skip_regex(src: str, i: int) -> int:
    j = i + 1
    in_class = False
    while j < len(src):
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == "\n":
            return i + 1
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            return j + 1
        j += 1
    return i + 1


def markup_hits(text: str):
    for m in re.finditer(r">([^<>]+)<", text):
        # Text beside a ${...} slot is still text on screen.
        for part in re.split(r"\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", m.group(1)):
            yield part
    for m in re.finditer(r'(?:aria-label|placeholder|title|alt)="([^"]+)"', text):
        yield m.group(1)


ATTR_CALL = re.compile(r"""setAttribute\(\s*["'](?:aria-label|aria-description|title|placeholder|alt)["']\s*,\s*(["'])((?:\\.|(?!\1).)*)\1""")


def scan_js(path: Path, rel: str):
    src = path.read_text(encoding="utf-8", errors="replace")
    for m in ATTR_CALL.finditer(src):
        if prose(m.group(2)):
            yield line_of(src, m.start()), m.group(2).strip()
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and src[i + 1:i + 2] == "/":
            k = src.find("\n", i)
            i = n if k < 0 else k + 1
            continue
        if c == "/" and src[i + 1:i + 2] == "*":
            k = src.find("*/", i + 2)
            i = n if k < 0 else k + 2
            continue
        if c == "/" and regex_start(src, i):
            i = skip_regex(src, i)
            continue
        if c in "\"'":
            got = read_quoted(src, i)
            if not got:
                i += 1
                continue
            end, text = got
            name = call_name(src, i)
            if name.split(".")[-1] not in ("t", "tn", "tr", "trn") and not NOT_UI_CALL.search(name or "-") and not skipped_context(src, i, end):
                pieces = list(markup_hits(text)) if "<" in text else [text]
                if "<" in text:
                    pieces += [p for p in re.split(r"<[^>]*>", text) if p.strip()]
                for piece in dict.fromkeys(p.strip() for p in pieces):
                    if prose(piece):
                        yield line_of(src, i), piece
            i = end
            continue
        if c == "`":
            j = i + 1
            segs, buf = [], []
            while j < n:
                ch = src[j]
                if ch == "\\":
                    buf.append(src[j + 1:j + 2])
                    j += 2
                    continue
                if ch == "`":
                    break
                if ch == "$" and src[j + 1:j + 2] == "{":
                    segs.append("".join(buf))
                    buf = []
                    depth, j = 1, j + 2
                    while j < n and depth:
                        if src[j] in "\"'":
                            got = read_quoted(src, j)
                            if got:
                                j = got[0]
                                continue
                        if src[j] == "`":
                            k = src.find("`", j + 1)
                            j = n if k < 0 else k + 1
                            continue
                        depth += {"{": 1, "}": -1}.get(src[j], 0)
                        j += 1
                    continue
                buf.append(ch)
                j += 1
            segs.append("".join(buf))
            name = call_name(src, i)
            if not NOT_UI_CALL.search(name or "-"):
                # Slots split the text, so look at the markup with the slots
                # marked and cut the text at each one.
                joined = "\x00".join(segs)
                for hit in markup_hits(">" + joined + "<" if "<" not in joined else joined):
                    for piece in hit.split("\x00"):
                        if prose(piece):
                            yield line_of(src, i), piece.strip()
            i = j + 1
            continue
        i += 1


def scan_html(path: Path):
    text = path.read_text(encoding="utf-8")
    body = re.sub(r"<(script|style)\b.*?</\1>", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    for m in re.finditer(r">([^<>]{2,240})<", body):
        if "data-i18n" not in body[max(0, m.start() - 200):m.start()]:
            if prose(m.group(1)):
                yield line_of(body, m.start()), m.group(1).strip()
    for m in re.finditer(r'(?:aria-label|placeholder|title|alt|content)="([^"]+)"', body):
        tag_start = body.rfind("<", 0, m.start())
        if "data-i18n" not in body[tag_start:m.start()] and "name=\"description\"" not in body[tag_start:m.start()]:
            if prose(m.group(1)) and 'property="og:' not in body[tag_start:m.start()] and 'name="twitter:' not in body[tag_start:m.start()]:
                yield line_of(body, m.start()), m.group(1).strip()
    # Inline scripts are JS too.
    for m in re.finditer(r"<script\b[^>]*>(.*?)</script>", text, flags=re.S):
        tmp = ROOT / ".i18n-inline.js"
        try:
            tmp.write_text(m.group(1), encoding="utf-8")
            base = line_of(text, m.start(1)) - 1
            for line, piece in scan_js(tmp, path.name):
                yield base + line, piece
        finally:
            tmp.unlink(missing_ok=True)


def ui_files():
    files = sorted(ROOT.glob("*.js")) + sorted(ROOT.glob("shared/*.js")) + sorted(ROOT.glob("*.html"))
    return [p for p in files if p.name not in SKIP]


def allowed() -> set[str]:
    path = ROOT / "scripts" / "i18n_allow.txt"
    if not path.exists():
        return set()
    return {line for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith(("# ", "keys: "))}


def find(keys: set[str], use_allow: bool = True):
    allow = allowed() if use_allow else set()
    hits = []
    for path in ui_files():
        rel = path.relative_to(ROOT).as_posix()
        found = scan_html(path) if path.suffix == ".html" else scan_js(path, rel)
        for line, piece in found:
            if piece in keys or f"*|{piece}" in allow or f"{rel}|{piece}" in allow:
                continue
            hits.append((rel, line, piece))
    return hits


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "scripts"))
    import check_i18n

    en = check_i18n.load_pack("en")
    keys = set(en) | set(en.values())
    hits = find(keys, use_allow="--list" not in sys.argv)
    for rel, line, piece in hits:
        print(f"{rel}:{line}: {piece[:140]}")
    print(f"{len(hits)} unrouted UI strings", file=sys.stderr)
    sys.exit(1 if hits else 0)
