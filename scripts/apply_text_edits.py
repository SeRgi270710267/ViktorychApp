#!/usr/bin/env python3
"""Apply already-scrubbed issue and pull request text.

The edit file contains replacement titles and bodies only. This prints counts.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = os.environ.get("REPO") or os.environ.get("GITHUB_REPOSITORY") or ""
EDITS = Path(__file__).resolve().parent / "text-edits.json"


def fail(message: str) -> None:
    print("[text-scrub] " + message, flush=True)
    raise SystemExit(1)


def headers() -> dict[str, str]:
    token = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not token:
        fail("github token is unset")
    return {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "viktorych-text-scrub",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    }


def patch(number: int, fields: dict) -> int:
    url = f"https://api.github.com/repos/{REPO}/issues/{number}"
    data = json.dumps(fields).encode("utf-8")
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, headers=headers(), method="PATCH")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return getattr(res, "status", 200)
        except urllib.error.HTTPError as err:
            if err.code in {403, 429, 500, 502, 503, 504} and attempt < 5:
                try:
                    detail = (err.read() or b"").lower()
                except OSError:
                    detail = b""
                if b"not accessible" in detail or b"resource not accessible" in detail:
                    return err.code
                time.sleep(min(30, 2 ** attempt))
                continue
            return err.code
        except urllib.error.URLError:
            if attempt == 5:
                return 0
            time.sleep(min(30, 2 ** attempt))
    return 0


def main() -> None:
    if not REPO:
        fail("repository is unset")
    if not EDITS.is_file():
        fail("edit file is missing")
    rows = json.loads(EDITS.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        fail("edit file is invalid")
    updated = forbidden = failed = 0
    prs = issues = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        fields = {}
        if isinstance(row.get("title"), str):
            fields["title"] = row["title"]
        if isinstance(row.get("body"), str):
            fields["body"] = row["body"]
        if not fields:
            continue
        if row.get("is_pr"):
            prs += 1
        else:
            issues += 1
        status = patch(int(row.get("number") or 0), fields)
        if status in {200, 201}:
            updated += 1
        elif status == 403:
            forbidden += 1
        else:
            failed += 1
    print(
        f"[text-scrub] rows={len(rows)} prs={prs} issues={issues} "
        f"updated={updated} forbidden={forbidden} failed={failed}",
        flush=True,
    )
    if forbidden or failed or updated != len(rows):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
