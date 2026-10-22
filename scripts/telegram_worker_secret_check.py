#!/usr/bin/env python3
"""Check that the accounts Worker Telegram secret is configured.

Prints status codes only. A session token from signup is not printed.
The probe upload (message 6) is not a D1 row, so a configured Worker
returns 404 for /tg/viktorych-telegram-probe.txt rather than the file.
"""

from __future__ import annotations

import json
import random
import sys
import urllib.error
import urllib.request

API = "https://viktorych-accounts.viktorych-accounts.workers.dev"
UA = "viktorych-telegram-worker-secret-check"


def request(method: str, path: str, payload: dict | None = None, token: str = "") -> tuple[int, dict]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            status = res.status
    except urllib.error.HTTPError as err:
        raw = err.read()
        status = err.code
    try:
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except json.JSONDecodeError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return status, body


def main() -> int:
    health_status, health = request("GET", "/v1/health")
    print("health_status=" + str(health_status))
    print("health_telegram=" + ("true" if health.get("telegram") is True else "false"))

    handle = "tgsec" + str(random.randint(100000, 999999))
    signup_status, signup = request("POST", "/v1/signup", {"displayName": "Telegram check", "handle": handle})
    print("signup_status=" + str(signup_status))
    if signup.get("error"):
        print("signup_error=" + str(signup.get("error")))
    session = str(signup.get("token") or "")
    if session:
        probe_status, probe = request("GET", "/tg/viktorych-telegram-probe.txt", token=session)
        print("probe_status=" + str(probe_status))
        if probe.get("error"):
            print("probe_error=" + str(probe.get("error")))
    else:
        print("probe_status=skipped")

    loop_status, loop = request("GET", "/tg/loop/v202610220909/index.m3u8")
    print("loop_status=" + str(loop_status))
    if loop.get("error"):
        print("loop_error=" + str(loop.get("error")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
