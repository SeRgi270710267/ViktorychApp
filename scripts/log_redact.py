#!/usr/bin/env python3
"""Mask account handles before they can reach an Actions log."""

from __future__ import annotations

import os
import sys


def collect(value, found: set[str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("handle", "screen_name", "username") and isinstance(item, str):
                text = item.strip().lstrip("@")
                if len(text) >= 2:
                    found.add(text)
            else:
                collect(item, found)
    elif isinstance(value, list):
        for item in value:
            collect(item, found)


def install(handles) -> None:
    needles = sorted({str(item).strip() for item in handles if str(item or "").strip() and len(str(item).strip()) >= 2}, key=len, reverse=True)
    if not needles:
        return
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for needle in needles:
            sys.__stdout__.write("::add-mask::" + needle + "\n")
        sys.__stdout__.flush()

    class Stream:
        def __init__(self, underlying):
            self.underlying = underlying

        def write(self, data):
            text = str(data)
            for needle in needles:
                if needle in text:
                    text = text.replace(needle, "[account]")
            return self.underlying.write(text)

        def flush(self):
            return self.underlying.flush()

        def isatty(self):
            return False

    sys.stdout = Stream(sys.stdout)
    sys.stderr = Stream(sys.stderr)
