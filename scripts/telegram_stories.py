#!/usr/bin/env python3
"""Read Telegram stories the owner can already see and store the original bytes.

Telegram has no free public stories API for bots. This uses the owner's own
MTProto login (Telethon). The session string stays in the GitHub Actions
secret TG_STORIES_SESSION. It is never printed, logged, or written to disk.

The job is read-only. It calls stories.getAllStories, waits out flood-wait,
and only keeps peers that response already includes (contacts and channels
the account follows). It does not post, mark stories read, or send reactions.
Leave the secrets unset and this does nothing.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, os.path.join(ROOT, "scripts"))

PACE_SECONDS = 1.25
FLOOD_CAP = 90
PEER_CAP = 15
ITEM_CAP = 4
BUDGET_SECONDS = 70
FILE_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}
WRITE_MARKERS = (
    "sendstory",
    "deletestories",
    "readstories",
    "incrementstoryviews",
    "sendreaction",
    "exportstorylink",
)


class FloodPause(Exception):
    def __init__(self, seconds: int):
        self.seconds = int(seconds)


def _secrets() -> tuple[str, str, str]:
    session = (os.environ.get("TG_STORIES_SESSION") or "").strip()
    api_id = (os.environ.get("TG_API_ID") or "").strip()
    api_hash = (os.environ.get("TG_API_HASH") or "").strip()
    return session, api_id, api_hash


def configured() -> bool:
    session, api_id, api_hash = _secrets()
    return bool(session and api_id and api_hash)


def redact(text: str) -> str:
    session, _api_id, api_hash = _secrets()
    cleaned = str(text or "")
    for secret in (session, api_hash):
        if secret and len(secret) > 4:
            cleaned = cleaned.replace(secret, "[redacted]")
    return cleaned


def label_for(name: str) -> str:
    text = " ".join(str(name or "").split())
    if not text or any(ch.isdigit() for ch in text):
        return "Telegram"
    return text[:40]


def token_for(value: str) -> str:
    digest = hashlib.sha256(str(value).encode("utf-8")).hexdigest()
    return "tg" + digest[:8]


def sniff(blob: bytes) -> str:
    if len(blob) >= 3 and blob[0:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(blob) >= 8 and blob[0:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(blob) >= 6 and blob[0:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if len(blob) >= 12 and blob[0:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    if len(blob) >= 4 and blob[0:4] == b"\x1aE\xdf\xa3":
        return "video/webm"
    if len(blob) >= 12 and blob[4:8] == b"ftyp":
        brand = blob[8:12]
        if brand == b"qt  ":
            return "video/quicktime"
        return "video/mp4"
    return ""


def file_name(blob: bytes, mime: str) -> str:
    ext = FILE_EXT.get(mime) or ""
    if not ext:
        return ""
    return hashlib.sha256(blob).hexdigest() + "." + ext


def assert_read_only(method: str) -> None:
    folded = str(method or "").lower()
    for mark in WRITE_MARKERS:
        if mark in folded:
            raise RuntimeError("telegram stories are read-only")


def paced_call(method: str, invoke, sleep, pace: float = PACE_SECONDS):
    assert_read_only(method)
    sleep(pace)
    while True:
        try:
            return invoke()
        except FloodPause as exc:
            seconds = int(exc.seconds)
            if seconds <= 0 or seconds > FLOOD_CAP:
                raise
            sleep(seconds)


def accounts_from(peers: list, now: datetime, upload, sleep) -> list:
    """Turn a normalized peer list into catalog rows. upload(bytes, mime, name) -> url path."""
    accounts = []
    started = time.monotonic()
    for peer in (peers or [])[:PEER_CAP]:
        if time.monotonic() - started > BUDGET_SECONDS:
            print("[telegram-stories] stopped at the time budget")
            break
        if not isinstance(peer, dict) or peer.get("self"):
            continue
        items = []
        for story in (peer.get("items") or [])[:ITEM_CAP]:
            if time.monotonic() - started > BUDGET_SECONDS:
                break
            blob = story.get("bytes") if isinstance(story, dict) else None
            if not isinstance(blob, (bytes, bytearray)) or not blob:
                continue
            raw = bytes(blob)
            mime = story.get("mime") or sniff(raw)
            if mime not in FILE_EXT:
                mime = sniff(raw)
            name = file_name(raw, mime)
            if not name:
                continue
            expires = story.get("expires")
            if isinstance(expires, datetime):
                end = expires if expires.tzinfo else expires.replace(tzinfo=timezone.utc)
            else:
                end = now + timedelta(hours=24)
            if end <= now:
                continue
            sleep(PACE_SECONDS)
            url = upload(raw, mime, name)
            if not url:
                continue
            taken = story.get("date")
            if not isinstance(taken, datetime):
                taken = now
            if taken.tzinfo is None:
                taken = taken.replace(tzinfo=timezone.utc)
            items.append({
                "id": token_for(str(peer.get("id")) + ":" + str(story.get("id"))),
                "type": "video" if mime.startswith("video/") else "photo",
                "url": url,
                "date": taken.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "expires": end.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "r2": "stories/telegram/" + name,
            })
        if not items:
            continue
        token = token_for(str(peer.get("id")))
        accounts.append({
            "id": "telegram:" + token,
            "platform": "telegram",
            "handle": token,
            "name": label_for(peer.get("name") or ""),
            "avatar": "",
            "items": items,
        })
    return accounts


def _r2_put(key: str, payload: bytes, content_type: str) -> bool:
    from tiktok_sync import cloudflare_env

    token, account = cloudflare_env()
    if not token or not account:
        return False
    quoted = urllib.request.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    req = urllib.request.Request(url, data=payload, method="PUT", headers={
        "Authorization": "Bearer " + token,
        "content-type": content_type or "application/octet-stream",
        "cache-control": "private, no-store",
    })
    try:
        with urllib.request.urlopen(req, timeout=60):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _r2_get(key: str):
    from tiktok_sync import r2_get

    return r2_get(key)


def _r2_delete(key: str) -> bool:
    from tiktok_sync import cloudflare_env

    token, account = cloudflare_env()
    if not token or not account or not key.startswith("stories/telegram/"):
        return False
    quoted = urllib.request.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    req = urllib.request.Request(url, method="DELETE", headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=60):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _write_manifest(items: list, put) -> bool:
    payload = json.dumps({"items": items}, separators=(",", ":")).encode("utf-8")
    return bool(put("stories/telegram/manifest.json", payload, "application/json"))


def _live_peers(sleep):
    """Connect with the owner session and return normalized peers. Read-only."""
    session, api_id, api_hash = _secrets()
    import asyncio

    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.tl.functions.stories import GetAllStoriesRequest

    async def run():
        client = TelegramClient(StringSession(session), int(api_id), api_hash)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                return {"needsSetup": True, "peers": []}
            me = await client.get_me()
            me_id = getattr(me, "id", None)
            peers = []
            state = ""
            nxt = False
            for _page in range(3):
                sleep(PACE_SECONDS)

                async def ask(flag=nxt, token=state):
                    try:
                        return await client(GetAllStoriesRequest(next=flag, hidden=False, state=token))
                    except Exception as exc:
                        if exc.__class__.__name__ == "FloodWaitError":
                            raise FloodPause(int(getattr(exc, "seconds", 0) or 0))
                        raise

                try:
                    result = await ask()
                except FloodPause as exc:
                    if exc.seconds <= 0 or exc.seconds > FLOOD_CAP:
                        raise
                    sleep(exc.seconds)
                    result = await ask()
                for block in getattr(result, "peer_stories", None) or []:
                    peer = getattr(block, "peer", None)
                    peer_id = getattr(peer, "user_id", None) or getattr(peer, "channel_id", None) or getattr(peer, "chat_id", None)
                    if peer_id is None or peer_id == me_id:
                        continue
                    sleep(PACE_SECONDS)
                    try:
                        entity = await client.get_entity(peer)
                    except Exception as exc:
                        if exc.__class__.__name__ == "FloodWaitError":
                            wait = int(getattr(exc, "seconds", 0) or 0)
                            if 0 < wait <= FLOOD_CAP:
                                sleep(wait)
                                entity = await client.get_entity(peer)
                            else:
                                continue
                        else:
                            continue
                    name = getattr(entity, "title", None) or getattr(entity, "first_name", None) or ""
                    items = []
                    for story in (getattr(block, "stories", None) or [])[:ITEM_CAP]:
                        media = getattr(story, "media", None)
                        if media is None:
                            continue
                        sleep(PACE_SECONDS)
                        try:
                            blob = await client.download_media(media, file=bytes)
                        except Exception as exc:
                            if exc.__class__.__name__ == "FloodWaitError":
                                wait = int(getattr(exc, "seconds", 0) or 0)
                                if 0 < wait <= FLOOD_CAP:
                                    sleep(wait)
                                    blob = await client.download_media(media, file=bytes)
                                else:
                                    break
                            else:
                                continue
                        if not isinstance(blob, (bytes, bytearray)):
                            continue
                        document = getattr(media, "document", None)
                        mime = getattr(document, "mime_type", None) or sniff(bytes(blob))
                        date = getattr(story, "date", None)
                        expire = getattr(story, "expire_date", None)
                        items.append({
                            "id": getattr(story, "id", ""),
                            "bytes": bytes(blob),
                            "mime": mime,
                            "date": date if isinstance(date, datetime) else None,
                            "expires": expire if isinstance(expire, datetime) else None,
                        })
                    if items:
                        peers.append({"id": peer_id, "name": name, "self": False, "items": items})
                    if len(peers) >= PEER_CAP:
                        break
                if len(peers) >= PEER_CAP or not getattr(result, "has_more", False):
                    break
                state = getattr(result, "state", "") or ""
                nxt = True
            return {"peers": peers}
        finally:
            await client.disconnect()

    return asyncio.run(run())


def pull(now: datetime | None = None, peers=None, upload=None, sleep=None, manifest_put=None, manifest_get=None) -> dict:
    moment = now or datetime.now(timezone.utc)
    pause = sleep or time.sleep
    if peers is None and not configured():
        print("[telegram-stories] off; TG_STORIES_SESSION is not set")
        return {"mode": "off", "accounts": []}
    try:
        if peers is None:
            loaded = _live_peers(pause)
            if loaded.get("needsSetup"):
                print("[telegram-stories] session is not authorized")
                return {"mode": "error", "needsSetup": True, "accounts": []}
            peers = loaded.get("peers") or []
        failed = {"n": 0}

        def default_upload(blob: bytes, mime: str, name: str) -> str:
            key = "stories/telegram/" + name
            if not _r2_put(key, blob, mime):
                failed["n"] += 1
                return ""
            return "/v1/stories/file/" + name

        sender = upload or default_upload
        accounts = accounts_from(peers, moment, sender, pause)
        if failed["n"]:
            print("[telegram-stories] media upload failed")
            return {"mode": "error", "accounts": []}
        manifest_items = []
        for account in accounts:
            for item in account.get("items") or []:
                key = item.get("r2") or ""
                if key:
                    expires = item.get("expires") or ""
                    try:
                        stamp = int(datetime.strptime(expires, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)
                    except ValueError:
                        stamp = int((moment + timedelta(hours=24)).timestamp() * 1000)
                    manifest_items.append({"key": key, "expires": stamp})
        if upload is None:
            previous = b""
            try:
                getter = manifest_get or _r2_get
                previous = getter("stories/telegram/manifest.json") or b""
            except Exception:
                previous = b""
            putter = manifest_put or _r2_put
            if not _write_manifest(manifest_items, putter):
                print("[telegram-stories] manifest upload failed")
                return {"mode": "error", "accounts": []}
            old_keys = set()
            try:
                old = json.loads(previous.decode("utf-8") if isinstance(previous, (bytes, bytearray)) else (previous or b"{}"))
                for row in old.get("items") or []:
                    if isinstance(row, dict) and row.get("key"):
                        old_keys.add(row["key"])
            except (UnicodeError, json.JSONDecodeError, AttributeError):
                old_keys = set()
            fresh = {row["key"] for row in manifest_items}
            for key in old_keys - fresh:
                _r2_delete(key)
        print(f"[telegram-stories] {len(accounts)} accounts")
        return {"mode": "ok", "accounts": accounts}
    except FloodPause:
        print("[telegram-stories] flood-wait was longer than the cap")
        return {"mode": "error", "accounts": []}
    except Exception as exc:
        print("[telegram-stories] " + redact(exc.__class__.__name__))
        return {"mode": "error", "accounts": []}


def selftest() -> int:
    now = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
    os.environ.pop("TG_STORIES_SESSION", None)
    os.environ.pop("TG_API_ID", None)
    os.environ.pop("TG_API_HASH", None)
    quiet = pull(now, sleep=lambda _seconds: None)
    if quiet.get("mode") != "off" or quiet.get("accounts"):
        print("an unset session still fetched stories")
        return 1
    slept = []
    calls = []

    def invoke_flood():
        calls.append("stories.getAllStories")
        if len(calls) == 1:
            raise FloodPause(2)
        return "ok"

    got = paced_call("GetAllStoriesRequest", invoke_flood, slept.append)
    if got != "ok" or 2 not in slept or PACE_SECONDS not in slept:
        print("flood-wait was not honored")
        return 1
    try:
        paced_call("stories.sendStory", lambda: None, slept.append)
    except RuntimeError:
        pass
    else:
        print("a write method was allowed")
        return 1
    stored = {}

    def upload(blob, mime, name):
        stored[name] = bytes(blob)
        return "/v1/stories/file/" + name

    photo = b"\xff\xd8\xff" + b"original-bytes"
    peers = [
        {"id": "self", "name": "Owner", "self": True, "items": [{"id": 1, "bytes": photo, "mime": "image/jpeg", "date": now, "expires": now + timedelta(hours=2)}]},
        {"id": "user_a", "name": "User A", "self": False, "items": [{"id": 2, "bytes": photo, "mime": "image/jpeg", "date": now, "expires": now + timedelta(hours=2)}]},
        {"id": "digits", "name": "12345", "self": False, "items": [{"id": 3, "bytes": photo, "mime": "image/jpeg", "date": now, "expires": now + timedelta(hours=2)}]},
        {"id": "gone", "name": "User A", "self": False, "items": [{"id": 4, "bytes": photo, "mime": "image/jpeg", "date": now - timedelta(days=2), "expires": now - timedelta(hours=1)}]},
    ]
    accounts = accounts_from(peers, now, upload, lambda _seconds: None)
    blob = json.dumps(accounts)
    if "12345" in blob or "username" in blob or "Owner" in blob:
        print("a private label leaked into the catalog")
        return 1
    if len(accounts) != 2:
        print("self and expired peers were not dropped")
        return 1
    if accounts[1]["name"] != "Telegram":
        print("a digit-only name was kept")
        return 1
    if accounts[0]["name"] != "User A" or not accounts[0]["items"][0]["url"].startswith("/v1/stories/file/"):
        print("a followed story was dropped")
        return 1
    saved = list(stored.values())
    if saved != [photo]:
        print("media was re-encoded")
        return 1
    if accounts[0]["items"][0]["url"] != accounts[1]["items"][0]["url"]:
        print("identical bytes were stored twice")
        return 1
    from stories import apply_telegram

    previous = [{"id": "telegram:tgold", "platform": "telegram", "handle": "tgold", "name": "Telegram", "items": [{"id": "1", "url": "https://cdn.example/a.jpg", "expires": "2026-10-29T12:00:00Z"}]}]
    stripped, connected, health = apply_telegram(list(previous), previous, now, {"mode": "off"})
    if stripped or connected or health:
        print("an unset secret left a telegram ring")
        return 1
    kept, connected, health = apply_telegram([], previous, now, {"mode": "error"})
    if not kept or not connected or not health:
        print("a failed fetch dropped the previous stories")
        return 1
    setup, connected, _health = apply_telegram([], previous, now, {"mode": "error", "needsSetup": True})
    if connected or not setup:
        print("a dead session still looked connected")
        return 1
    fresh, connected, health = apply_telegram(list(previous), previous, now, {"mode": "ok", "accounts": accounts})
    if not connected or health or any(row.get("id") == "telegram:tgold" for row in fresh):
        print("a fresh fetch did not replace telegram rows")
        return 1
    print("ok telegram stories")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    sys.exit(0)
