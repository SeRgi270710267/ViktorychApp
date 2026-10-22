#!/usr/bin/env python3
"""Ask the deployed worker for one public TikTok video as a temporary owner session.

The session row is deleted before this script exits. The accounts row is not changed.
Nothing secret is printed. A TikTok refusal is printed and is not a failed deploy.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "worker"
API = "https://viktorych-accounts.viktorych-accounts.workers.dev"
VIDEO = "7695476356548660503"
HANDLE = "gabii_g5"


def d1(sql: str) -> list:
    proc = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "viktorych-accounts", "--remote", "--json", "--command", sql],
        cwd=WORKER,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write((proc.stderr or proc.stdout or "d1 execute failed")[-800:] + "\n")
        raise SystemExit(proc.returncode)
    raw = proc.stdout or ""
    start = raw.find("[")
    if start < 0:
        start = raw.find("{")
    if start < 0:
        raise SystemExit("d1 execute returned no json")
    data = json.loads(raw[start:])
    if isinstance(data, list):
        return (data[0] or {}).get("results") or []
    return data.get("results") or []


def main() -> int:
    if not os.environ.get("CLOUDFLARE_API_TOKEN") or not os.environ.get("CLOUDFLARE_ACCOUNT_ID"):
        print("Cloudflare credentials are not set; skipping the TikTok play check.")
        return 0
    rows = d1("SELECT public_id FROM accounts WHERE owner = 1 LIMIT 1")
    if not rows:
        print("no owner account; skipping the TikTok play check")
        return 0
    public_id = str(rows[0].get("public_id") or "")
    if not public_id.isdigit():
        print("owner id was not usable; skipping the TikTok play check")
        return 0
    token = "va1." + secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    now = int(time.time() * 1000)
    try:
        d1(
            "INSERT INTO sessions (token_hash, public_id, created_at, expires_at) VALUES ('%s', '%s', %d, %d)"
            % (digest, public_id, now, now + 15 * 60 * 1000)
        )
        url = API + "/v1/owner/play?id=" + VIDEO + "&handle=" + HANDLE
        last = None
        for attempt in range(4):
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": "Bearer " + token,
                    "Range": "bytes=0-1023",
                    "User-Agent": "viktorych-accounts-publish",
                    "Accept": "*/*",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=40) as res:
                    body = res.read(1200)
                    last = (res.status, res.headers, body)
            except urllib.error.HTTPError as err:
                body = err.read(1200)
                last = (err.code, err.headers, body)
            status = last[0]
            if status not in (404, 502, 503) or attempt == 3:
                break
            time.sleep(8)
        status, headers, body = last
        ctype = headers.get("content-type") or ""
        crange = headers.get("content-range") or ""
        print("tiktok play status", status)
        print("tiktok play content-type", ctype)
        print("tiktok play content-range", crange or "-")
        if b"ftyp" in body[:32]:
            print("tiktok play ftyp yes")
        elif ctype.startswith("application/json") or body[:1] in (b"{", b"["):
            text = body.decode("utf-8", "replace")
            print("tiktok play body", text[:400])
        else:
            print("tiktok play ftyp no")
        if status == 401:
            return 1
        return 0
    finally:
        d1("DELETE FROM sessions WHERE token_hash = '%s'" % digest)
        print("temporary owner session removed")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as err:
        print("tiktok play check failed:", type(err).__name__)
        raise SystemExit(1)
