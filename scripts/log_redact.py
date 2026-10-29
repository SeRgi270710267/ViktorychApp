#!/usr/bin/env python3
"""Keep account handles, names and ids out of public Actions logs.

Actions logs on a public repository are public. Every script that runs in a
workflow calls ``auto()`` once at start; scripts that load the private
catalog in memory also call ``install()`` with what they loaded.

``install`` is cumulative and does three things:

* registers each value with the Actions log masker (``::add-mask::``),
* replaces values in anything Python prints (case-insensitive, whole token),
* in Actions, routes file descriptors 1 and 2 through the same filter, so
  output from child processes (yt-dlp, gallery-dl, ffmpeg, git) is covered.

Matches become ``[account]``. Nothing here prints the values themselves.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARK = "[account]"
HANDLE_KEYS = {"handle", "screen_name", "screenName", "username", "userName", "login"}
ID_KEYS = {
    "permanentId", "channelId", "userId", "user_id", "accountId", "account_id",
    "authorId", "author_id", "followId", "feedId", "rest_id", "id_str",
}
NAME_KEYS = {"name", "displayName", "display_name"}
ENV_LISTS = ("TIKTOK_TRACKED", "TIKTOK_PLAY_HANDLE", "HANDLE_DENYLIST", "OWNER_IDS")
CATALOG_FILES = ("feeds.config.json", "people.json", "stories.json", "suggestions.json", "feeds.json", "status.json")
# Words that are never account values on their own; masking them would
# blank ordinary log text without hiding anything.
SKIP = {
    "x", "twitter", "tiktok", "youtube", "instagram", "threads", "telegram", "vk", "discord",
    "facebook", "reddit", "rss", "twitch", "github", "bluesky", "mastodon", "account", "accounts",
    "true", "false", "null", "none", "user", "users", "name", "test", "http", "https", "www", "com",
}
MIN_HANDLE = 2
MIN_NAME = 4
MIN_DIGITS = 5

_needles: set[str] = set()
_pattern: re.Pattern | None = None
_lock = threading.Lock()
_streams_wrapped = False
_fd_threads: list = []
_fd_saved: dict = {}


def _clean(value) -> str:
    return str(value or "").strip().lstrip("@").strip()


def _usable(text: str, minimum: int) -> bool:
    if len(text) < minimum or text.casefold() in SKIP:
        return False
    if text.isdigit():
        return len(text) >= MIN_DIGITS
    return "\n" not in text and len(text) <= 120


def collect(value, found: set[str]) -> None:
    """Add handles, account ids and display names found in a catalog doc."""
    if isinstance(value, dict):
        accountish = any(key in value for key in HANDLE_KEYS) or "permanentId" in value
        for key, item in value.items():
            if isinstance(item, (str, int)) and not isinstance(item, bool):
                text = _clean(item)
                if key in HANDLE_KEYS and _usable(text, MIN_HANDLE):
                    found.add(text)
                elif key in ID_KEYS:
                    tail = text.split(":", 1)[1] if ":" in text and not text.startswith("http") else text
                    if _usable(tail, MIN_HANDLE):
                        found.add(tail)
                elif accountish and key in NAME_KEYS and _usable(text, MIN_NAME):
                    found.add(text)
                elif accountish and key == "id" and ":" in text and not text.startswith("http"):
                    tail = text.split(":", 1)[1]
                    if _usable(tail, MIN_HANDLE):
                        found.add(tail)
            else:
                collect(item, found)
    elif isinstance(value, list):
        for item in value:
            collect(item, found)


def _compile() -> None:
    global _pattern
    parts = sorted(_needles, key=len, reverse=True)
    if not parts:
        _pattern = None
        return
    body = "|".join(re.escape(part) for part in parts)
    # Whole tokens only, so "ann" does not blank "announce"; underscores and
    # dots count as separators, so "name_backup.mp4" is still covered.
    _pattern = re.compile(r"(?<![A-Za-z0-9])(?:" + body + r")(?![A-Za-z0-9])", re.IGNORECASE)


def redact(text) -> str:
    out = str(text if text is not None else "")
    pattern = _pattern
    return pattern.sub(MARK, out) if pattern is not None and out else out


def _redact_bytes(data: bytes) -> bytes:
    if _pattern is None or not data:
        return data
    return redact(data.decode("utf-8", "replace")).encode("utf-8")


class _Stream:
    def __init__(self, underlying):
        self.underlying = underlying

    def write(self, data):
        return self.underlying.write(redact(data))

    def writelines(self, lines):
        for line in lines:
            self.write(line)

    def flush(self):
        return self.underlying.flush()

    def isatty(self):
        return False

    def __getattr__(self, name):
        return getattr(self.underlying, name)


def _pump(read_fd: int, out_fd: int) -> None:
    pending = b""
    while True:
        try:
            chunk = os.read(read_fd, 65536)
        except OSError:
            chunk = b""
        if not chunk:
            break
        pending += chunk
        cut = max(pending.rfind(b"\n"), pending.rfind(b"\r"))
        if cut < 0 and len(pending) < 65536:
            continue
        ready, pending = (pending, b"") if cut < 0 else (pending[: cut + 1], pending[cut + 1 :])
        try:
            os.write(out_fd, _redact_bytes(ready))
        except OSError:
            pass
    if pending:
        try:
            os.write(out_fd, _redact_bytes(pending))
        except OSError:
            pass
    try:
        os.close(read_fd)
    except OSError:
        pass


def _restore_fds() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass
    for fd, saved in list(_fd_saved.items()):
        try:
            os.dup2(saved, fd)
        except OSError:
            pass
    for thread in _fd_threads:
        thread.join(timeout=5)
    for saved in _fd_saved.values():
        try:
            os.close(saved)
        except OSError:
            pass
    _fd_saved.clear()
    _fd_threads.clear()


def _filter_fds() -> None:
    if _fd_saved or not hasattr(os, "pipe"):
        return
    try:
        for stream in (sys.stdout, sys.stderr):
            stream.flush()
        for fd in (1, 2):
            saved = os.dup(fd)
            read_fd, write_fd = os.pipe()
            thread = threading.Thread(target=_pump, args=(read_fd, saved), daemon=True)
            thread.start()
            os.dup2(write_fd, fd)
            os.close(write_fd)
            _fd_saved[fd] = saved
            _fd_threads.append(thread)
        atexit.register(_restore_fds)
    except Exception:
        _restore_fds()


def install(values) -> None:
    """Hide these values from everything this process and its children print."""
    global _streams_wrapped
    fresh = set()
    for item in values or ():
        text = _clean(item)
        if _usable(text, MIN_HANDLE) and text not in _needles:
            fresh.add(text)
    if not fresh:
        return
    actions = os.environ.get("GITHUB_ACTIONS") == "true"
    with _lock:
        if actions:
            out = sys.__stdout__
            for needle in sorted(fresh):
                for variant in {needle, needle.lower(), needle.upper(), needle.casefold()}:
                    out.write("::add-mask::" + variant + "\n")
            out.flush()
        _needles.update(fresh)
        _compile()
        if not _streams_wrapped:
            sys.stdout = _Stream(sys.stdout)
            sys.stderr = _Stream(sys.stderr)
            _streams_wrapped = True
        if actions:
            _filter_fds()


def _env_values() -> set[str]:
    found = set()
    for key in ENV_LISTS:
        for part in re.split(r"[\s,;]+", os.environ.get(key) or ""):
            text = _clean(part)
            if ":" in text and not text.startswith("http"):
                text = text.split(":", 1)[1]
            if text:
                found.add(text)
    return found


def catalog_values(root: Path | None = None) -> set[str]:
    """Values from restored catalog files. Seeds hold only placeholders."""
    base = Path(root or ROOT)
    found: set[str] = set()
    for name in CATALOG_FILES:
        path = base / name
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(doc, dict) and doc.get("catalogSeed") is True:
            continue
        collect(doc, found)
    return found


def auto(root: Path | None = None) -> None:
    """Call once at the start of a script that runs in Actions."""
    try:
        install(_env_values() | catalog_values(root))
    except Exception:
        pass


def _selftest() -> int:
    import subprocess
    import tempfile

    failures = []

    def check(cond, label):
        if not cond:
            failures.append(label)

    doc = {"accounts": [
        {"platform": "x", "handle": "@CopperLane", "name": "Copper Lane", "permanentId": "x:10000001",
         "channelId": "UCsample0000000000000001", "id": "x:copperlane"},
        {"platform": "tiktok", "handle": "ab", "name": "Al", "title": "Weekly news"},
        {"platform": "rss", "url": "https://example.com/feed", "handle": "x"},
    ]}
    found: set[str] = set()
    collect(doc, found)
    check({"CopperLane", "Copper Lane", "10000001", "UCsample0000000000000001", "copperlane", "ab"} <= found, "collects handles, names and ids")
    check("Al" not in found and "Weekly news" not in found and "x" not in found, "skips short names, titles and platform words")
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "feeds.config.json").write_text(json.dumps(dict(doc, catalogSeed=True)), encoding="utf-8")
        check(not catalog_values(Path(tmp)), "seed catalogs add nothing")
        Path(tmp, "people.json").write_text(json.dumps(doc), encoding="utf-8")
        check("CopperLane" in catalog_values(Path(tmp)), "restored catalogs are read")
    code = (
        "import sys, subprocess; sys.path.insert(0, %r); import log_redact as r; "
        "r.install(['CopperLane', 'Copper Lane', '10000001', 'ab']); "
        "print('added @copperlane (Copper Lane) id 10000001 file copperlane_backup.mp4 tab about'); "
        "sys.stdout.flush(); "
        "subprocess.run(['sh', '-c', 'echo child COPPERLANE 10000001; echo err copperlane >&2']); "
        "print('done', r.redact('https://x.com/CopperLane/status/1'))"
    ) % str(Path(__file__).resolve().parent)
    env = dict(os.environ, GITHUB_ACTIONS="true")
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=30)
    body = "\n".join(line for line in (proc.stdout + proc.stderr).splitlines() if not line.startswith("::add-mask::"))
    check(proc.returncode == 0, "child script runs")
    check(not re.search(r"(?i)copperlane|copper lane|10000001", body), "handles, names and ids are hidden in-process and in child output")
    check("child [account] [account]" in body and "err [account]" in body, "child process output is filtered")
    check("tab about" in body and "[account]_backup.mp4" in body, "whole tokens only")
    check("done https://x.com/[account]/status/1" in body, "late lines are flushed at exit")
    check(proc.stdout.count("::add-mask::") >= 4, "values are registered with the Actions masker")
    env.pop("GITHUB_ACTIONS")
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=30)
    check("::add-mask::" not in proc.stdout, "no mask commands outside Actions")
    for label in failures:
        print("FAIL: " + label)
    print("log_redact selftest: " + ("ok" if not failures else f"{len(failures)} failed"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
