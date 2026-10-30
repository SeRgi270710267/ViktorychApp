#!/usr/bin/env python3
"""Honor account deletions when a job publishes JSON.

The deletions list is only salted hashes of account ids. This strips
objects and app: links that hash to one of those values. A missing list
or a failed fetch leaves the file unchanged.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ID_FIELDS = (
    "publicId",
    "public_id",
    "userId",
    "user_id",
    "authorId",
    "author_id",
    "followerId",
    "follower_id",
    "accountId",
    "account_id",
    "senderId",
    "sender_id",
    "recipientId",
    "recipient_id",
    "ownerId",
    "owner_id",
)
APP_ID = re.compile(r"^app:(\d{12})$")
PUBLIC_ID = re.compile(r"^\d{12}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_CACHE: tuple[set[str], str] | None = None


def user_hash(public_id: str, salt: str) -> str:
    if not salt or not PUBLIC_ID.fullmatch(public_id or ""):
        return ""
    return hmac.new(
        salt.encode("utf-8"),
        ("account-delete:" + public_id).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _app_id(value) -> str:
    if not isinstance(value, str):
        return ""
    match = APP_ID.fullmatch(value)
    return match.group(1) if match else ""


def _public_id(value) -> str:
    if isinstance(value, str) and PUBLIC_ID.fullmatch(value):
        return value
    return ""


def references_deleted(value, hashes: set[str], salt: str) -> bool:
    if not isinstance(value, dict):
        return False
    marker = value.get("userHash")
    if isinstance(marker, str) and marker in hashes:
        return True
    for key in ("id", "followId", "targetId", "target_id"):
        found = _app_id(value.get(key))
        if found and user_hash(found, salt) in hashes:
            return True
    for key in ID_FIELDS:
        if key not in value:
            continue
        raw = value.get(key)
        found = _app_id(raw) or _public_id(raw)
        if found and user_hash(found, salt) in hashes:
            return True
    return False


def scrub_value(value, hashes: set[str], salt: str):
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, str):
                found = _app_id(item)
                if found and user_hash(found, salt) in hashes:
                    continue
                out.append(item)
                continue
            nxt = scrub_value(item, hashes, salt)
            if nxt is None:
                continue
            out.append(nxt)
        return out
    if not isinstance(value, dict):
        return value
    if references_deleted(value, hashes, salt):
        return None
    out = {}
    for key, item in value.items():
        nxt = scrub_value(item, hashes, salt)
        if nxt is None and isinstance(item, (dict, list)):
            continue
        out[key] = nxt
    return out


def scrub_bytes(key: str, payload: bytes, hashes: set[str], salt: str) -> bytes:
    if not hashes or not key.endswith(".json") or key == "deletions.json":
        return payload
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return payload
    cleaned = scrub_value(parsed, hashes, salt)
    if cleaned is None:
        cleaned = {}
    if cleaned == parsed:
        return payload
    return (json.dumps(cleaned, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _hashes_from(body: dict) -> set[str]:
    raw = body.get("hashes") if isinstance(body, dict) else None
    if not isinstance(raw, list):
        return set()
    return {str(item).strip().lower() for item in raw if HASH_RE.fullmatch(str(item).strip().lower())}


def fetch_deletion_hashes(api: str) -> set[str]:
    root = (api or "").strip().rstrip("/")
    if not root:
        return set()
    req = urllib.request.Request(
        root + "/v1/account/deletions",
        headers={"User-Agent": "viktorych-accounts-publish", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as res:
            if int(getattr(res, "status", 200)) != 200:
                return set()
            parsed = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        return set()
    return _hashes_from(parsed if isinstance(parsed, dict) else {})


def load_deletions(api: str = "") -> tuple[set[str], str]:
    """Return (hashes, salt). Salt may be empty; userHash fields still match."""
    global _CACHE
    salt = (os.environ.get("ACCOUNT_DELETION_SALT") or os.environ.get("ACCOUNT_PEPPER") or "").strip()
    if _CACHE is not None and _CACHE[1] == salt:
        return _CACHE
    hashes: set[str] = set()
    local = (os.environ.get("ACCOUNT_DELETIONS_FILE") or "").strip()
    if local:
        path = Path(local)
        if path.is_file():
            try:
                parsed = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                parsed = {}
            hashes.update(_hashes_from(parsed if isinstance(parsed, dict) else {}))
    root = (api or os.environ.get("ACCOUNTS_API") or "").strip()
    if root:
        hashes.update(fetch_deletion_hashes(root))
    _CACHE = (hashes, salt)
    return _CACHE


def reset_cache() -> None:
    global _CACHE
    _CACHE = None


def _selftest() -> int:
    salt = "pepper-test"
    user = "123456789012"
    other = "210987654321"
    digest = user_hash(user, salt)
    assert HASH_RE.fullmatch(digest)
    assert user not in digest
    doc = {
        "people": [
            {"id": "keep", "name": "Keep"},
            {"id": "app:" + user, "publicId": user, "name": "Gone", "handle": "secret-handle"},
        ],
        "follows": ["x:sampleagency", "app:" + user, {"id": "app:" + other, "handle": "bee"}],
        "note": None,
    }
    cleaned = scrub_value(doc, {digest}, salt)
    assert cleaned["people"] == [{"id": "keep", "name": "Keep"}]
    assert cleaned["follows"] == ["x:sampleagency", {"id": "app:" + other, "handle": "bee"}]
    assert cleaned["note"] is None
    listed = json.dumps({"hashes": [digest]})
    assert user not in listed and "secret-handle" not in listed
    raw = json.dumps(doc).encode("utf-8")
    out = scrub_bytes("people.json", raw, {digest}, salt)
    assert b"secret-handle" not in out and b"keep" in out
    assert scrub_bytes("deletions.json", listed.encode("utf-8"), {digest}, salt) == listed.encode("utf-8")
    assert scrub_bytes("people.json", raw, set(), salt) == raw
    print("account deletions selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    found, used = load_deletions()
    print(f"{len(found)} deletion hashes, salt={'yes' if used else 'no'}")
