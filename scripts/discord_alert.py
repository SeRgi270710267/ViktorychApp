#!/usr/bin/env python3
"""Open one Discord account issue, and close it when a guild read works again.

The title is fixed. The body is one of four fixed sentences. A token, a
response body, or any other detail is never written to the issue or the log.
"""

from __future__ import annotations

import json
import os
import subprocess

TITLE = "Discord account needs attention"
SENTENCES = {
    "unauthorized": "Discord returned 401 for the user token. Discord sync stopped for this run and will not retry.",
    "forbidden": "Discord returned 403 for the user token. Discord sync stopped for this run and will not retry.",
    "captcha": "Discord asked for a captcha. Discord sync stopped for this run and will not retry.",
    "verification": "Discord asked for account verification. Discord sync stopped for this run and will not retry.",
}


def safe_reason(detail: str) -> str:
    """A fixed sentence. The argument is never copied into the result."""
    text = (detail or "").strip()
    for sentence in SENTENCES.values():
        if text == sentence:
            return sentence
    lowered = text.lower()
    if "captcha" in lowered:
        return SENTENCES["captcha"]
    if "verification" in lowered or "verify your account" in lowered:
        return SENTENCES["verification"]
    if "401" in lowered or "unauthorized" in lowered:
        return SENTENCES["unauthorized"]
    return SENTENCES["forbidden"]


def is_account_stop(detail: str) -> bool:
    return (detail or "").strip() in SENTENCES.values()


def attention(report) -> tuple:
    """``paused``, ``ok``, or ``unknown`` for the discord health row."""
    if not isinstance(report, dict):
        return "unknown", ""
    for feed in report.get("feeds") or []:
        if not isinstance(feed, dict) or (feed.get("id") or "") != "discord":
            continue
        detail = (feed.get("detail") or "").strip()
        if is_account_stop(detail):
            return "paused", detail
        if feed.get("ok") and not detail:
            return "ok", ""
        return "unknown", ""
    return "unknown", ""


def body_for(reason: str, run_url: str) -> str:
    sentence = safe_reason(reason)
    return (
        "Discord account needs attention.\n\n"
        + sentence
        + "\n\nReads stay paused until a guild read succeeds. "
        + "Channels this account cannot see are not this alert.\n\n"
        + "Run: "
        + (run_url or "")
        + "\n"
    )


def plan(paused: bool, reason: str, open_issues: list) -> dict:
    matches = [item for item in open_issues or [] if (item.get("title") or "") == TITLE]
    extra = [item.get("number") for item in matches[1:]]
    if paused:
        sentence = safe_reason(reason)
        if not matches:
            return {"action": "open", "extra": extra}
        current = matches[0]
        if sentence in (current.get("body") or ""):
            return {"action": "none", "number": current.get("number"), "extra": extra}
        return {"action": "edit", "number": current.get("number"), "extra": extra}
    if matches:
        return {"action": "close", "number": matches[0].get("number"), "extra": extra}
    return {"action": "none", "extra": extra}


def _gh(args: list) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *args], check=True, text=True, capture_output=True)


def _list_open(repo: str) -> list:
    result = _gh(["issue", "list", "--repo", repo, "--state", "open", "--limit", "50", "--json", "number,title,body"])
    data = json.loads(result.stdout or "[]")
    return data if isinstance(data, list) else []


def apply(decision: dict, reason: str, run_url: str, repo: str) -> None:
    action = decision.get("action")
    if action == "open":
        _gh(["issue", "create", "--repo", repo, "--title", TITLE, "--body", body_for(reason, run_url)])
    elif action == "edit":
        _gh(["issue", "edit", str(decision["number"]), "--repo", repo, "--body", body_for(reason, run_url)])
    elif action == "close":
        number = str(decision["number"])
        _gh(["issue", "comment", number, "--repo", repo, "--body", "Discord reads succeeded again."])
        _gh(["issue", "close", number, "--repo", repo, "--reason", "completed"])
    for number in decision.get("extra") or []:
        subprocess.run(["gh", "issue", "close", str(number), "--repo", repo, "--reason", "not planned"], check=False)


def mark(paused: bool, reason: str = "") -> None:
    """Open, update, or close the single account issue. No-op without a repo."""
    repo = (os.environ.get("REPO") or os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not repo:
        return
    run_url = os.environ.get("RUN_URL") or ""
    try:
        decision = plan(bool(paused), reason if paused else "", _list_open(repo))
        apply(decision, reason if paused else "", run_url, repo)
    except Exception:
        print("[discord] could not update the account issue")
