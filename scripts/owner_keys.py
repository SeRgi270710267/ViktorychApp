#!/usr/bin/env python3
"""Fetch the active owner key at runtime. The value stays in memory or a temp file.

GitHub jobs call this with the existing WORKER_DISPATCH_TOKEN. The Worker
returns one key, the highest-priority healthy key for that service. This
process masks the value and deletes any temp file on the way out. A signed-out
or expired key is marked so the next read advances. A 429, rate limit,
captcha, or challenge keeps the same key.
"""

from __future__ import annotations

import atexit
import json
import os
import stat
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

_CACHE: dict[str, str] = {}
_ACTIVE: dict[str, str] = {}
_BLOCKED: set[str] = set()
_FILES: dict[str, str] = {}
_FETCHED: set[str] = set()

_ADVANCE = {"unauthorized", "expired", "unreadable", "logged_out", "session_invalid", "auth_required"}
_HOLD = {"captcha", "challenge", "forbidden", "rate_limit"}
_CODES = _ADVANCE | _HOLD | {"unreachable", "bad_paste"}

_HOSTS = {
    "tiktok": ("tiktok.com",),
    "youtube": ("youtube.com", "youtu.be", "googlevideo.com"),
    "instagram": ("instagram.com", "cdninstagram.com"),
    "reddit": ("reddit.com",),
    "discord": ("discord.com",),
    "telegram": ("telegram.org",),
    "threads": ("threads.net", "threads.com"),
    "vk": ("vk.com", "vk.ru", "userapi.com"),
    "x": ("x.com", "twitter.com"),
}


def attention_reason(status: int, body) -> str:
    code = int(status or 0)
    if isinstance(body, bytes):
        text = body[:20000].decode("utf-8", "replace")
    else:
        text = str(body or "")[:20000]
    lowered = text.lower()
    if code == 429 or "too many requests" in lowered or "rate limit" in lowered:
        return "rate_limit"
    if "captcha" in lowered:
        return "captcha"
    if any(mark in lowered for mark in ("cf-challenge", "just a moment", "attention required", "verify you are human", "challenge-platform", "captcha-verify")):
        return "challenge"
    if any(mark in lowered for mark in ("logged out", "not logged in", "login required", "auth required", "authentication required", "session invalid", "invalid session", "session expired")):
        return "session_invalid"
    if code == 401:
        return "unauthorized"
    if code == 403:
        return "forbidden"
    return ""


def decide_attempt(status: int, body, used_key: bool) -> tuple[str, str]:
    reason = attention_reason(status, body)
    if not used_key or not reason:
        return "keep", ""
    if reason in _ADVANCE:
        return "advance", reason
    if reason in _HOLD:
        return "hold", reason
    return "keep", ""


def mask_text(value: str) -> None:
    text = str(value or "")
    if len(text) < 4:
        return
    print("::add-mask::" + text.replace("\r", "").replace("\n", ""), flush=True)


def _wipe(path: str) -> None:
    file = Path(path)
    try:
        size = file.stat().st_size
        file.write_bytes(b"\0" * min(size, 1024 * 1024))
    except OSError:
        pass
    try:
        file.unlink()
    except OSError:
        pass


def _cleanup() -> None:
    for path in list(_FILES.values()):
        _wipe(path)
    _FILES.clear()
    _CACHE.clear()
    _ACTIVE.clear()


atexit.register(_cleanup)


def slot_for_url(url: str) -> str:
    try:
        host = urllib.request.urlparse(url).hostname or ""
    except ValueError:
        return ""
    host = host.lower()
    if not host:
        return ""
    for slot, names in _HOSTS.items():
        for name in names:
            if host == name or host.endswith("." + name):
                return slot
    return ""


def _api() -> str:
    return (os.environ.get("ACCOUNTS_API") or "").strip().rstrip("/")


def _token() -> str:
    return (os.environ.get("WORKER_DISPATCH_TOKEN") or "").strip()


def blocked(slot: str) -> bool:
    return slot in _BLOCKED


def using(slot: str) -> bool:
    return bool(_CACHE.get(slot)) and slot not in _BLOCKED


def _post_attention(slot: str, reason: str, key_id: str) -> None:
    root = _api()
    token = _token()
    code = reason if reason in _CODES else "forbidden"
    if not root or not token or not slot:
        return
    payload = {"error": code}
    if key_id:
        payload["keyId"] = key_id
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        root + "/v1/owner/keys/" + slot + "/attention",
        data=body,
        method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "viktorych-keys"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as res:
            res.read()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return


def mark_slow(slot: str, reason: str) -> bool:
    if not slot:
        return False
    _post_attention(slot, reason if reason in _HOLD else "rate_limit", _ACTIVE.get(slot, ""))
    return False


def mark_expired(slot: str, reason: str = "expired") -> bool:
    if not slot or not _CACHE.get(slot):
        return False
    key_id = _ACTIVE.pop(slot, "")
    _CACHE.pop(slot, None)
    _FETCHED.discard(slot)
    path = _FILES.pop(slot, "")
    if path:
        _wipe(path)
    code = reason if reason in _ADVANCE else "expired"
    _post_attention(slot, code, key_id)
    return True


def mark_attention(slot: str, reason: str) -> None:
    if not slot:
        return
    code = reason if reason in _CODES else "forbidden"
    if code in _HOLD:
        mark_slow(slot, code)
        return
    mark_expired(slot, code if code in _ADVANCE else "unauthorized")


def _fetch(slot: str) -> str:
    root = _api()
    token = _token()
    if not root or not token or not slot:
        return ""
    request = urllib.request.Request(
        root + "/v1/owner/keys/" + slot + "/material",
        headers={"Authorization": "Bearer " + token, "User-Agent": "viktorych-keys", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as res:
            status = res.status
            raw = res.read()
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = b""
        try:
            raw = exc.read() or b""
        except OSError:
            raw = b""
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return ""
    if status in (409, 410):
        _BLOCKED.add(slot)
        return ""
    if status != 200:
        return ""
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ""
    if not isinstance(data, dict):
        return ""
    _ACTIVE[slot] = str(data.get("keyId") or "")
    if data.get("kind") == "pair":
        client = str(data.get("clientId") or "")
        secret = str(data.get("clientSecret") or "")
        if not client or not secret:
            return ""
        mask_text(client)
        mask_text(secret)
        return json.dumps({"clientId": client, "clientSecret": secret}, separators=(",", ":"))
    value = str(data.get("value") or "")
    if not value:
        return ""
    mask_text(value)
    for piece in value.split(";"):
        _name, _sep, item = piece.strip().partition("=")
        if _sep and item:
            mask_text(item)
    return value


def material(slot: str) -> str:
    if slot in _BLOCKED:
        return ""
    if slot in _FETCHED:
        return _CACHE.get(slot) or ""
    _FETCHED.add(slot)
    value = _fetch(slot)
    _CACHE[slot] = value
    return value


def credential(slot: str, env_name: str) -> str:
    if blocked(slot):
        return ""
    owned = material(slot)
    if owned:
        return owned
    if blocked(slot):
        return ""
    if not env_name:
        return ""
    return (os.environ.get(env_name) or "").strip()


def drop_for_attention(slot: str, reason: str) -> bool:
    code = reason if reason in _CODES else "forbidden"
    if code in _HOLD:
        mark_slow(slot, code)
        return False
    if code not in _ADVANCE:
        return False
    if slot in _BLOCKED or not _CACHE.get(slot):
        return False
    return mark_expired(slot, code)


def cookie_header(slot: str) -> str:
    value = material(slot)
    if not value or value[:1] in "{[":
        return ""
    return value.replace("\r", "").replace("\n", "")


def stream_cookie(slot: str) -> str:
    return cookie_header(slot)


def _netscape(value: str, domain: str) -> str:
    lines = ["# Netscape HTTP Cookie File"]
    for piece in value.split(";"):
        name, sep, item = piece.strip().partition("=")
        if not sep or not name or not item:
            continue
        lines.append("\t".join([domain, "TRUE", "/", "TRUE", "0", name.strip(), item.strip()]))
    return "\n".join(lines) + "\n"


def cookie_file(slot: str) -> str:
    if slot in _FILES and Path(_FILES[slot]).is_file():
        return _FILES[slot]
    value = cookie_header(slot)
    if not value:
        return ""
    domain = "." + (_HOSTS.get(slot) or ("example.com",))[0]
    handle = tempfile.NamedTemporaryFile(prefix="owner-key-", suffix=".txt", delete=False)
    path = handle.name
    handle.close()
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    Path(path).write_text(_netscape(value, domain), encoding="utf-8")
    _FILES[slot] = path
    return path


def prepare_argv(argv: list, page: str) -> list:
    slot = slot_for_url(page)
    path = cookie_file(slot) if slot else ""
    if not path:
        return list(argv)
    out = [item for item in argv if item != "--no-cookies"]
    at = out.index("--ignore-config") + 1 if "--ignore-config" in out else 1
    out[at:at] = ["--cookies", path]
    return out


def _without_cookies(argv: list) -> list:
    out = []
    skip = False
    for item in argv:
        if skip:
            skip = False
            continue
        if item == "--cookies":
            skip = True
            continue
        out.append(item)
    return out


def fallback_argv(argv: list, page: str, status: int, text: str):
    slot = slot_for_url(page)
    if not slot or "--cookies" not in argv:
        return None
    action, reason = decide_attempt(status, text, True)
    if action == "hold":
        mark_slow(slot, reason)
        return None
    if action != "advance":
        return None
    if not drop_for_attention(slot, reason):
        return None
    path = cookie_file(slot)
    if path:
        out = _without_cookies(argv)
        at = out.index("--ignore-config") + 1 if "--ignore-config" in out else 1
        out[at:at] = ["--cookies", path]
        return out
    out = _without_cookies(argv)
    if "--no-cookies" not in out:
        at = out.index("--ignore-config") + 1 if "--ignore-config" in out else 1
        out[at:at] = ["--no-cookies"]
    return out


def _selftest() -> int:
    secret = "sessionid=super-secret-cookie-value"
    assert mask_text is not None
    action, reason = decide_attempt(403, "", True)
    assert action == "hold" and reason == "forbidden", action
    action, reason = decide_attempt(401, "", True)
    assert action == "advance" and reason == "unauthorized", action
    action, reason = decide_attempt(200, "captcha-verify page", True)
    assert action == "hold" and reason == "captcha", reason
    action, reason = decide_attempt(200, "cf-challenge", True)
    assert action == "hold" and reason == "challenge", reason
    action, reason = decide_attempt(429, "too many requests", True)
    assert action == "hold" and reason == "rate_limit", reason
    action, reason = decide_attempt(429, "captcha", True)
    assert action == "hold", action
    action, reason = decide_attempt(200, "login required", True)
    assert action == "advance" and reason == "session_invalid", reason
    action, reason = decide_attempt(200, "ok", True)
    assert action == "keep" and reason == "", action
    action, reason = decide_attempt(403, "", False)
    assert action == "keep", action
    assert decide_attempt(429, "", True)[0] != "advance"
    assert decide_attempt(200, "cf-challenge", True)[0] != "advance"
    assert slot_for_url("https://www.tiktok.com/@example/live") == "tiktok"
    assert slot_for_url("https://www.youtube.com/watch?v=abcdefghijk") == "youtube"
    assert slot_for_url("https://example.com/") == ""
    os.environ.pop("ACCOUNTS_API", None)
    os.environ.pop("WORKER_DISPATCH_TOKEN", None)
    _FETCHED.discard("tiktok")
    _CACHE.pop("tiktok", None)
    assert material("tiktok") == ""
    assert credential("tiktok", "TIKTOK_COOKIE_TEST") == ""
    os.environ["TIKTOK_COOKIE_TEST"] = "anon-path"
    _FETCHED.discard("youtube")
    assert credential("youtube", "TIKTOK_COOKIE_TEST") == "anon-path"
    _CACHE["vk"] = secret
    _FETCHED.add("vk")
    _ACTIVE["vk"] = "k-active"
    assert drop_for_attention("vk", "rate_limit") is False
    assert drop_for_attention("vk", "challenge") is False
    assert drop_for_attention("vk", "captcha") is False
    assert _CACHE.get("vk") == secret
    assert "vk" not in _BLOCKED
    assert material("vk") == secret
    assert mark_expired("vk", "unauthorized") is True
    assert "vk" not in _FETCHED
    assert _CACHE.get("vk", "") == ""
    assert mark_expired("vk", "expired") is False
    _CACHE["instagram"] = secret
    _FETCHED.add("instagram")
    assert drop_for_attention("instagram", "forbidden") is False
    assert material("instagram") == secret
    assert drop_for_attention("instagram", "unauthorized") is True
    assert drop_for_attention("instagram", "unauthorized") is False
    assert secret not in "\u2022" * 8
    path = ""
    _BLOCKED.discard("threads")
    _CACHE["threads"] = "sessionid=temp-value"
    _FETCHED.add("threads")
    _ACTIVE["threads"] = "k-threads"
    path = cookie_file("threads")
    assert path and Path(path).is_file()
    assert "temp-value" in Path(path).read_text(encoding="utf-8")
    argv = prepare_argv(["yt-dlp", "--ignore-config", "--no-cookies", "https://www.threads.net/"], "https://www.threads.net/t/abc")
    assert "--cookies" in argv and "--no-cookies" not in argv
    held = fallback_argv(argv, "https://www.threads.net/t/abc", 429, "cf-challenge")
    assert held is None
    assert Path(path).is_file()
    assert material("threads") == "sessionid=temp-value"
    again = fallback_argv(argv, "https://www.threads.net/t/abc", 401, "")
    assert again is not None and "--no-cookies" in again and "--cookies" not in again
    assert not Path(path).exists()
    print("owner keys selftest ok")
    return 0


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    raise SystemExit("owner_keys is a library")
