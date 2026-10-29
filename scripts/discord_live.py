#!/usr/bin/env python3
"""Poll configured Discord message channels and publish them near-live.

Read-only. One process stays under 5 hours 50 minutes. It GETs
``/channels/<id>/messages`` and nothing else that would write, join, or type.
Busy channels are checked about every 10–15 seconds, quiet ones every 2–5
minutes, and requests are at least 1.5 seconds apart. A 403 on a channel this
account cannot see is recorded as inaccessible and does not stop the process.
A 401, a captcha, a verification challenge, or a 403 on the guild read stops
the process and opens one GitHub issue. A later guild read closes that issue.
New messages go to the server's ntfy topic as
JSON the Messages page already accepts. About every 10 minutes each channel
is written as a newest page of 50 plus older pages, uploaded to R2, and
deployed with the site. The Worker cron starts this job when none is running.
The GitHub schedule is only the backup.

The token is never printed. A missing DISCORD_USER_TOKEN exits 0 after
writing ``waiting for token``.
"""

from __future__ import annotations

import json
import os
import random
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from site_paths import pages_base  # noqa: E402
import discord_picks  # noqa: E402
from adapters.discord import (  # noqa: E402
    MENTION_CHANNEL,
    MENTION_ROLE,
    MENTION_USER,
    QUIET_CHANNELS,
    Client,
    DiscordStop,
    _mirror_published,
    _redact,
    _write_json,
    build_profile,
    display_name,
    invite_code,
    public_error,
    snowflake,
    stub_message,
)

HISTORY = 300
PAGE = 50
BUSY_GAP = (10.0, 15.0)
QUIET_GAP = (120.0, 300.0)
DEPLOY_EVERY = 600
ASK_EVERY = 60
RUN_LIMIT = (5 * 60 + 40) * 60
NTFY_LIMIT = 3800
DEFAULT_TOPIC = "superintelmusic-discord-th-7f3a91c2"
UA = "viktorych-preview/1.0"

STOP = {"now": False}


def _stop(_signum, _frame) -> None:
    STOP["now"] = True


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def live_servers(config: dict) -> list:
    """User-auth servers and their message channels, in config order."""
    found = []
    for row in (config or {}).get("discord") or []:
        if not isinstance(row, dict):
            continue
        guild = snowflake(row.get("id") if row.get("id") is not None else row.get("guild"))
        if not guild or str(row.get("auth") or "").strip().lower() != "user":
            continue
        channels = []
        for channel in row.get("channels") or []:
            if not isinstance(channel, dict):
                continue
            cid = snowflake(channel.get("id"))
            mode = str(channel.get("mode") or "").strip().lower()
            if not cid or mode != "messages":
                continue
            channels.append(
                {
                    "id": cid,
                    "name": str(channel.get("name") or "").strip(),
                    "category": str(channel.get("category") or "").strip(),
                    "busy": str(channel.get("pace") or "").strip().lower() == "busy",
                }
            )
        if not channels:
            continue
        topic = str(row.get("ntfy") or DEFAULT_TOPIC).strip()
        if not all(ch.isalnum() or ch in "-_" for ch in topic):
            topic = DEFAULT_TOPIC
        found.append(
            {
                "id": guild,
                "name": str(row.get("name") or "").strip() or guild,
                "ntfy": topic,
                "channels": channels,
            }
        )
    return found


def next_gap(busy: bool, rng=None) -> float:
    rng = rng or random
    low, high = BUSY_GAP if busy else QUIET_GAP
    return float(rng.uniform(low, high))


def pick_due(channels: list, nxt: dict, now: float, cursor: int):
    """The next due channel. Busy channels win. ``cursor`` rotates ties."""
    if not channels:
        return None, cursor
    busy = [channel for channel in channels if channel.get("busy") and float(nxt.get(channel["id"], now)) <= now]
    quiet = [channel for channel in channels if not channel.get("busy") and float(nxt.get(channel["id"], now)) <= now]
    pool = busy or quiet
    if not pool:
        return None, cursor
    ids = {channel["id"] for channel in pool}
    count = len(channels)
    for step in range(count):
        channel = channels[(cursor + step) % count]
        if channel["id"] in ids:
            return channel, (cursor + step + 1) % count
    return None, cursor


def mention_text(message: dict, names: dict) -> str:
    """Discord markdown with mentions resolved. Emoji tags stay for the page."""
    text = str((message or {}).get("content") or "")
    users = {}
    for row in (message or {}).get("mentions") or []:
        if isinstance(row, dict) and row.get("id") is not None:
            users[str(row["id"])] = row

    def user_sub(match):
        return "@" + (display_name(users.get(match.group(1)) or {}) or "user")

    def channel_sub(match):
        return "#" + str((names or {}).get(match.group(1)) or "channel")

    text = MENTION_USER.sub(user_sub, text)
    text = MENTION_CHANNEL.sub(channel_sub, text)
    return MENTION_ROLE.sub(lambda _match: "@role", text)


def fit_ntfy(payload: dict, limit: int = NTFY_LIMIT) -> dict:
    """Shrink message text until the JSON body fits ntfy."""

    def size(item: dict) -> int:
        return len(json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    current = json.loads(json.dumps(payload))
    if size(current) <= limit:
        return current
    message = current.get("m") if isinstance(current.get("m"), dict) else {}
    text = str(message.get("content") or "")
    best = json.loads(json.dumps(current))
    best_message = best.get("m") if isinstance(best.get("m"), dict) else {}
    best_message["content"] = ""
    best["m"] = best_message
    lo, hi = 0, len(text)
    while lo <= hi:
        mid = (lo + hi) // 2
        trial = json.loads(json.dumps(current))
        trial_message = trial.get("m") if isinstance(trial.get("m"), dict) else {}
        trial_message["content"] = text[:mid]
        trial["m"] = trial_message
        if size(trial) <= limit:
            best = trial
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def ntfy_body(message: dict, row: dict, channel_id: str, author_id: str, author: dict, names: dict) -> dict:
    content = mention_text(message, names) or row.get("text") or ""
    attachments = []
    for item in row.get("attachments") or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        if not url.startswith("https://cdn.discordapp.com/") and not url.startswith("https://media.discordapp.net/"):
            continue
        kind = "video" if item.get("type") == "video" else "photo"
        entry = {"url": url, "type": kind}
        if item.get("width"):
            entry["w"] = item.get("width")
        if item.get("height"):
            entry["h"] = item.get("height")
        attachments.append(entry)
        if len(attachments) >= 8:
            break
    embeds = []
    for card in row.get("cards") or []:
        if not isinstance(card, dict):
            continue
        embeds.append(
            {
                "url": card.get("url") or "",
                "title": card.get("title") or "",
                "description": card.get("description") or "",
                "image": card.get("image") or "",
                "site": card.get("site") or "",
            }
        )
        if len(embeds) >= 4:
            break
    reactions = []
    for item in row.get("reactions") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("emoji") or "")
        try:
            count = int(item.get("count") or 0)
        except (TypeError, ValueError):
            count = 0
        if name and count > 0:
            reactions.append({"e": name[:32], "n": count})
    author_row = {
        "id": author_id,
        "name": (author or {}).get("name") or "",
        "avatar": (author or {}).get("avatar") or "",
    }
    if (author or {}).get("color"):
        author_row["color"] = author["color"]
    body = {
        "id": row.get("id") or "",
        "ts": row.get("date") or "",
        "author": author_row,
        "content": content,
        "att": attachments,
        "emb": embeds,
        "rx": reactions,
    }
    if row.get("reply"):
        body["reply"] = {
            "id": row["reply"],
            "author": row.get("replyAuthor") or "",
            "content": row.get("replyText") or "",
        }
    return fit_ntfy({"v": 1, "ch": channel_id, "m": body})


class Board:
    """The newest history kept for each channel."""

    def __init__(self):
        self.messages = {}
        self.authors = {}
        self.cursor = {}
        self.inaccessible = set()

    def add(self, channel_id: str, row: dict, author_id: str, author: dict) -> bool:
        bucket = self.messages.setdefault(channel_id, {})
        fresh = row["id"] not in bucket
        bucket[row["id"]] = row
        people = self.authors.setdefault(channel_id, {})
        if author_id and isinstance(author, dict):
            people[author_id] = author
        kept = sorted(bucket, key=lambda item: int(item), reverse=True)[:HISTORY]
        self.messages[channel_id] = {item: bucket[item] for item in kept}
        if kept:
            self.cursor[channel_id] = kept[0]
        return fresh

    def _absorb(self, channel_id: str, data: dict) -> None:
        people = self.authors.setdefault(channel_id, {})
        authors = data.get("authors") if isinstance(data.get("authors"), dict) else {}
        for key, value in authors.items():
            if key and isinstance(value, dict):
                people[str(key)] = value
        bucket = self.messages.setdefault(channel_id, {})
        for row in data.get("messages") or []:
            if isinstance(row, dict) and snowflake(row.get("id")):
                bucket[str(row["id"])] = row

    def load_dir(self, root: Path, base: Path | None = None) -> None:
        folder = (base or (root / "discord")) / "messages"
        if not folder.is_dir():
            return
        paths = list(folder.glob("*.json"))
        paths.extend(folder.glob("*/p/*.json"))
        seen = set()
        for path in paths:
            channel_id = snowflake(path.stem if path.parent.name != "p" else path.parent.parent.name)
            if not channel_id or path in seen:
                continue
            seen.add(path)
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                self._absorb(channel_id, data)
        for channel_id in list(self.messages):
            kept = self.rows(channel_id)
            self.messages[channel_id] = {row["id"]: row for row in kept}
            if kept:
                self.cursor[channel_id] = kept[0]["id"]

    def rows(self, channel_id: str) -> list:
        bucket = self.messages.get(channel_id) or {}
        return sorted(bucket.values(), key=lambda row: int(row["id"]), reverse=True)[:HISTORY]


def apply_messages(board: Board, channel: dict, raw, names: dict, topic: str, token: str, announce: bool) -> int:
    if not isinstance(raw, list):
        return 0
    ordered = [item for item in raw if isinstance(item, dict) and snowflake(item.get("id"))]
    ordered.sort(key=lambda item: int(item["id"]))
    published = 0
    for message in ordered:
        parsed = stub_message(message, channel, names)
        if not parsed:
            continue
        row, author_id, author = parsed
        row = _redact(row, token)
        author = _redact(author, token)
        fresh = board.add(channel["id"], row, author_id, author)
        if fresh and announce and topic:
            payload = _redact(ntfy_body(message, row, channel["id"], author_id, author, names), token)
            if send_ntfy(topic, payload, token):
                published += 1
    return published


def send_ntfy(topic: str, payload: dict, token: str) -> bool:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if token and token.encode("utf-8") in body:
        print("[discord-live] skipped an ntfy publish that contained the token")
        return False
    request = urllib.request.Request(
        "https://ntfy.sh/" + topic,
        data=body,
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read(2000)
            return 200 <= getattr(response, "status", 200) < 300
    except urllib.error.HTTPError as exc:
        print(f"[discord-live] ntfy HTTP {exc.code}")
        return False
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print("[discord-live] ntfy " + type(exc).__name__)
        return False


def page(client: Client, channel_id: str, *, after: str = "", before: str = ""):
    params = {"limit": str(PAGE)}
    if after:
        params["after"] = after
    if before:
        params["before"] = before
    started = time.monotonic()
    data = client.get_json(f"/channels/{channel_id}/messages", params)
    return data, time.monotonic() - started


def backfill(client: Client, channel_id: str):
    """Newest page, then older pages, up to HISTORY. None when Discord refused."""
    first, gap = page(client, channel_id)
    if not isinstance(first, list):
        return None, gap
    found = {}
    for message in first:
        mid = snowflake((message or {}).get("id") if isinstance(message, dict) else None)
        if mid:
            found[mid] = message
    while len(found) < HISTORY:
        if not found:
            break
        oldest = min(int(item) for item in found)
        older, _gap = page(client, channel_id, before=str(oldest))
        if not isinstance(older, list) or not older:
            break
        added = 0
        for message in older:
            mid = snowflake((message or {}).get("id") if isinstance(message, dict) else None)
            if mid and mid not in found:
                found[mid] = message
                added += 1
        if added == 0:
            break
    return list(found.values()), gap


def forward(client: Client, channel_id: str, cursor: str):
    """Messages strictly after the cursor. None when this channel is inaccessible."""
    after = cursor
    found = []
    gap = 0.0
    for _ in range(8):
        batch, gap = page(client, channel_id, after=after)
        if not isinstance(batch, list):
            return None, gap
        fresh = []
        for message in batch:
            mid = snowflake((message or {}).get("id") if isinstance(message, dict) else None)
            if mid and int(mid) > int(after):
                fresh.append(message)
        if not fresh:
            break
        found.extend(fresh)
        after = str(max(int(message["id"]) for message in fresh))
        if len(batch) < PAGE:
            break
    return found, gap


def _kept_pin_blocks(root: Path) -> dict:
    """Channel ids whose pin list the sync already marked forbidden. Local only."""
    flags = {}
    path = root / "discord" / "index.json"
    if not path.is_file():
        return flags
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return flags
    if not isinstance(data, dict):
        return flags
    for server in data.get("servers") or []:
        if not isinstance(server, dict):
            continue
        for channel in server.get("channels") or []:
            if isinstance(channel, dict) and channel.get("pinsForbidden") and snowflake(channel.get("id")):
                flags[str(channel["id"])] = True
    return flags


def _authors_for(rows: list, authors: dict) -> dict:
    used = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("author") or "")
        if key and key in authors and key not in used:
            used[key] = authors[key]
    return used


def _page_body(server: dict, channel: dict, rows: list, authors: dict, fetched: str, older: bool) -> dict:
    payload = {
        "platform": "discord",
        "guildId": server["id"],
        "channelId": channel["id"],
        "name": channel["name"],
        "fetchedAt": fetched,
        "older": bool(older),
        "authors": _authors_for(rows, authors),
        "messages": rows,
    }
    if channel.get("category"):
        payload["category"] = channel["category"]
    return payload


def _write_channel(root: Path, server: dict, channel: dict, board: Board, fetched: str, token: str, base: Path | None = None) -> None:
    base = base or (root / "discord")
    cid = channel["id"]
    rows = board.rows(cid)
    authors = board.authors.get(cid) or {}
    hot = rows[:PAGE]
    rest = rows[PAGE:]
    chunks = [rest[index:index + PAGE] for index in range(0, len(rest), PAGE)]
    _write_json(
        base / "messages" / f"{cid}.json",
        _page_body(server, channel, hot, authors, fetched, bool(chunks)),
        token,
    )
    folder = base / "messages" / cid / "p"
    keep = set()
    for number, chunk in enumerate(chunks, start=1):
        name = f"{number}.json"
        keep.add(name)
        _write_json(folder / name, _page_body(server, channel, chunk, authors, fetched, number < len(chunks)), token)
    if folder.is_dir():
        for path in folder.glob("*.json"):
            if path.name not in keep:
                path.unlink()


def write_tree(root: Path, server: dict, board: Board, icon: str, members, online: str, status: str, detail: str, token: str) -> None:
    fetched = iso_now()
    blocked = _kept_pin_blocks(root)
    channels = []
    for channel in server["channels"]:
        entry = {"id": channel["id"], "name": channel["name"], "mode": "messages", "file": f"discord/messages/{channel['id']}.json"}
        if channel.get("category"):
            entry["category"] = channel["category"]
        if channel["id"] in board.inaccessible:
            entry["inaccessible"] = True
        if blocked.get(channel["id"]):
            entry["pinsForbidden"] = True
        channels.append(entry)
        _write_channel(root, server, channel, board, fetched, token)
    index = {
        "fetchedAt": fetched,
        "status": status,
        "detail": detail,
        "servers": [
            {
                "id": server["id"],
                "name": server["name"],
                "handle": server["id"],
                "auth": "user",
                "icon": icon,
                "members": members,
                "online": online,
                "url": f"https://discord.com/channels/{server['id']}",
                "channels": channels,
            }
        ],
    }
    state = {"channels": {key: value for key, value in board.cursor.items() if snowflake(key) and snowflake(value)}}
    _write_json(root / "discord" / "index.json", index, token)
    _write_json(root / "discord" / "state.json", state, token)


def header(client: Client, server: dict):
    widget = client.get_json(f"https://discord.com/api/guilds/{server['id']}/widget.json", auth=False)
    code = invite_code((widget or {}).get("instant_invite") if isinstance(widget, dict) else "")
    invite = client.get_json(f"/invites/{code}", {"with_counts": "true"}, auth=False) if code else None
    try:
        guild = client.get_json(f"/guilds/{server['id']}", {"with_counts": "true"})
    except DiscordStop:
        raise
    profile = build_profile(server["id"], server["name"], widget if isinstance(widget, dict) else None, invite if isinstance(invite, dict) else None, guild if isinstance(guild, dict) else None)
    return profile.get("avatar") or "", profile.get("followers"), profile.get("online")


def _cf_env() -> tuple[str, str]:
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    return token, account


def r2_get(key: str) -> bytes | None:
    token, account = _cf_env()
    if not token or not account or not key or ".." in key:
        return None
    quoted = urllib.parse.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if getattr(response, "status", 200) != 200:
                return None
            return response.read()
    except urllib.error.HTTPError:
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def r2_put(key: str, payload: bytes) -> bool:
    token, account = _cf_env()
    if not token or not account or not key or ".." in key:
        return False
    quoted = urllib.parse.quote(key, safe="/")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/viktorych-data/objects/{quoted}"
    request = urllib.request.Request(url, data=payload, method="PUT", headers={
        "Authorization": "Bearer " + token,
        "content-type": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=60):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def r2_json(key: str):
    blob = r2_get(key)
    if not blob:
        return None
    try:
        data = json.loads(blob.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def restore_from(root: Path, token: str, fetch, dest: Path | None = None, prefix: str = "discord/") -> None:
    """Copy missing Discord files from fetch(key). Existing files stay."""
    if fetch is None:
        return
    dest = dest or (root / "discord")
    index_path = dest / "index.json"
    index = None
    if index_path.is_file():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            index = None
    if not isinstance(index, dict):
        index = fetch(prefix + "index.json")
        if isinstance(index, dict):
            _write_json(index_path, index, token)
    if not isinstance(index, dict):
        return
    state_path = dest / "state.json"
    if not state_path.is_file():
        state = fetch(prefix + "state.json")
        if isinstance(state, dict):
            _write_json(state_path, state, token)
    for server in index.get("servers") or []:
        if not isinstance(server, dict):
            continue
        for channel in server.get("channels") or []:
            if not isinstance(channel, dict):
                continue
            cid = snowflake(channel.get("id"))
            if not cid:
                continue
            hot_path = dest / "messages" / f"{cid}.json"
            if not hot_path.is_file():
                hot = fetch(f"{prefix}messages/{cid}.json")
                if isinstance(hot, dict):
                    _write_json(hot_path, hot, token)
            if not hot_path.is_file():
                continue
            try:
                hot = json.loads(hot_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                continue
            if not isinstance(hot, dict) or not hot.get("older"):
                continue
            for number in range(1, (HISTORY // PAGE) + 1):
                page_path = dest / "messages" / cid / "p" / f"{number}.json"
                if page_path.is_file():
                    try:
                        current = json.loads(page_path.read_text(encoding="utf-8"))
                    except (OSError, UnicodeError, json.JSONDecodeError):
                        current = None
                    if isinstance(current, dict) and not current.get("older"):
                        break
                    continue
                fetched = fetch(f"{prefix}messages/{cid}/p/{number}.json")
                if not isinstance(fetched, dict):
                    break
                _write_json(page_path, fetched, token)
                if not fetched.get("older"):
                    break


def upload_discord(root: Path, token: str) -> None:
    folder = root / "discord"
    if not folder.is_dir():
        return
    secret = (token or "").strip().encode("utf-8")
    sent = 0
    for path in sorted(folder.rglob("*.json")):
        rel = path.relative_to(root).as_posix()
        if not rel.startswith("discord/") or ".." in rel:
            continue
        try:
            payload = path.read_bytes()
        except OSError:
            continue
        if secret and secret in payload:
            print("[discord-live] skipped an R2 upload that contained the token")
            continue
        if r2_put(rel, payload):
            sent += 1
    if sent:
        print(f"[discord-live] r2 {sent}")


def published_here(path: str):
    if not path or ".." in path or path.startswith("/"):
        return None
    request = urllib.request.Request(pages_base() + path, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if getattr(response, "status", 200) != 200:
                return None
            data = json.loads(response.read(1_000_000).decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None



def write_health(status: str, reason: str, token: str) -> None:
    """Private key health. No ids, no token. Cached messages stay as they are."""
    doc = discord_picks.health_doc(status, reason, token, iso_now())
    payload = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    if token and token.encode("utf-8") in payload:
        return
    r2_put(discord_picks.HEALTH_KEY, payload)


def read_health():
    return r2_json(discord_picks.HEALTH_KEY)


class Picks:
    """The owner's extra servers (scripts/discord_picks.py). Private bucket only."""

    def __init__(self, root: Path, token: str, skip=(), get=None, put=None):
        self.root = root
        self.token = token
        self.skip = set(skip)
        self.get = get or r2_json
        self.put = put or r2_put
        self.joined = set()
        self.join_transport = None
        self.servers = []
        self.uploader = discord_picks.Uploader(self.put)

    def channels(self) -> list:
        return [channel for server in self.servers for channel in server["channels"]]

    def restore(self) -> None:
        try:
            restore_from(self.root, self.token, self.get, discord_picks.local_root(self.root), discord_picks.PREFIX)
        except Exception as exc:
            print(public_error(exc))

    def reload(self) -> set:
        """Re-read the pick list. Returns the channel ids that are new."""
        before = {channel["id"] for channel in self.channels()}
        doc = self.get(discord_picks.PICKS_KEY)
        if isinstance(doc, dict):
            self.servers = discord_picks.picked_servers(doc, self.skip)
        now = {channel["id"] for channel in self.channels()}
        if now != before:
            print(f"[discord-live] picked {len(self.servers)} servers {len(now)} channels")
        return now - before

    def join(self, request) -> None:
        """The owner's one confirmed join. Done once per request id."""
        ask = discord_picks.join_request(request)
        if not ask or ask["id"] in self.joined:
            return
        done = self.get(discord_picks.JOIN_KEY)
        if isinstance(done, dict) and str(done.get("id") or "") == ask["id"]:
            self.joined.add(ask["id"])
            return
        self.joined.add(ask["id"])
        status, guild = discord_picks.join_invite(self.token, ask["code"], self.join_transport)
        print(f"[discord-live] join {status}")
        result = {"id": ask["id"], "status": status, "guild": guild or ask["guild"], "at": iso_now()}
        self.put(discord_picks.JOIN_KEY, json.dumps(result, separators=(",", ":")).encode("utf-8"))

    def catalog(self, client, stop) -> None:
        request = self.get(discord_picks.REQUEST_KEY)
        self.join(request)
        current = self.get(discord_picks.CATALOG_KEY)
        task, want = discord_picks.catalog_task(current, request)
        if not task:
            return
        doc = discord_picks.build_catalog(client, iso_now(), stop, current if task == "guild" else None, want)
        if not isinstance(doc, dict):
            return
        payload = json.dumps(_redact(doc, self.token), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if self.token and self.token.encode("utf-8") in payload:
            return
        if self.put(discord_picks.CATALOG_KEY, payload):
            print(f"[discord-live] listed {len(doc['servers'])} servers")
            write_health("ok", "", self.token)

    def write(self, board: Board) -> None:
        if not self.servers:
            return
        fetched = iso_now()
        base = discord_picks.local_root(self.root)
        for server in self.servers:
            for channel in server["channels"]:
                _write_channel(self.root, server, channel, board, fetched, self.token, base)
        index = discord_picks.private_index(self.servers, board.inaccessible, fetched, "ok", board.cursor)
        _write_json(base / "index.json", index, self.token)

    def upload(self) -> None:
        if not self.servers:
            return
        try:
            self.uploader.push(self.root, discord_picks.private_keys(self.root, self.servers), self.token)
        except Exception as exc:
            print(public_error(exc))


def run(root: Path, server: dict | None, token: str, picks: Picks | None = None) -> int:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    # Same bad key: keep cached messages, do not call Discord again.
    if discord_picks.key_blocked(read_health(), token):
        print("[discord-live] key invalid; waiting for a new key")
        write_status(root, server, "unauthorized", "Discord key stopped working", token)
        if server:
            try:
                deploy(root, token)
            except Exception as exc:
                print(public_error(exc))
        return 0
    if server:
        try:
            _mirror_published(root, published_here, token)
            restore_from(root, token, r2_json)
        except Exception as exc:
            print(public_error(exc))
    picks = picks or Picks(root, token, [server["id"]] if server else [])
    picks.restore()
    board = Board()
    board.load_dir(root)
    board.load_dir(root, discord_picks.local_root(root))
    client = Client(token, auth="user", min_interval=1.5)
    client.max_attempts = 4
    public = server["channels"] if server else []

    def every() -> list:
        return public + picks.channels()

    def names_now() -> dict:
        return {channel["id"]: channel["name"] for channel in every() if channel.get("name")}

    names = names_now()
    icon, members, online = "", None, None
    if server:
        try:
            icon, members, online = header(client, server)
        except DiscordStop:
            raise
        if client.last_status == 200:
            write_health("ok", "", token)
            _account_issue(False, "")
        print(f"[discord-live] {server['name']} {len(server['channels'])} channels")
    started = time.monotonic()
    deadline = started + RUN_LIMIT
    topic = (server.get("ntfy") if server else "") or DEFAULT_TOPIC

    def topic_for(channel: dict) -> str:
        # ntfy topics are public, so picked servers never push there.
        return "" if channel.get("private") else topic

    def guarded(call):
        try:
            return call()
        except DiscordStop as exc:
            if exc.reason == "rate-limit":
                print("[discord-live] rate limit; pausing 30s")
                time.sleep(30)
                return "rate"
            raise

    def label(channel: dict) -> str:
        # Picked channels stay unnamed in the log.
        return "a picked channel" if channel.get("private") else "#" + (channel["name"] or channel["id"])

    def write_all() -> None:
        if server:
            write_tree(root, server, board, icon, members, online, "ok", "", token)
        picks.write(board)

    def ship() -> None:
        if server:
            deploy(root, token)
        picks.upload()

    picks.reload()
    guarded(lambda: picks.catalog(client, lambda: STOP["now"]))
    names = names_now()
    for channel in every():
        if STOP["now"] or time.monotonic() >= deadline:
            break
        result = guarded(lambda channel=channel: backfill(client, channel["id"]))
        if result == "rate" or result is None:
            continue
        messages, gap = result
        if not isinstance(messages, list):
            if client.last_status == 403:
                board.inaccessible.add(channel["id"])
                print(f"[discord-live] {label(channel)} inaccessible")
            continue
        apply_messages(board, channel, messages, names, topic_for(channel), token, False)
        write_health("ok", "", token)
        print(f"[discord-live] {label(channel)} history {len(board.rows(channel['id']))} gap {gap:.1f}s")
    write_all()
    ship()
    last_deploy = time.monotonic()
    nxt = {}
    now = time.monotonic()
    for channel in every():
        if channel["id"] in board.inaccessible:
            nxt[channel["id"]] = now + DEPLOY_EVERY
        elif channel["busy"]:
            nxt[channel["id"]] = now
        else:
            nxt[channel["id"]] = now + next_gap(False)
    cursor = 0
    polls = 0
    last_ask = time.monotonic()
    while not STOP["now"] and time.monotonic() < deadline:
        now = time.monotonic()
        if now - last_deploy >= DEPLOY_EVERY:
            # The owner may have picked or dropped channels in the app.
            added = picks.reload()
            guarded(lambda: picks.catalog(client, lambda: STOP["now"]))
            names = names_now()
            live_ids = {channel["id"] for channel in every()}
            for key in list(nxt):
                if key not in live_ids:
                    nxt.pop(key, None)
            for key in added:
                nxt[key] = time.monotonic()
            before = set(board.inaccessible)
            refresh(client, every(), board, names, topic_for, token, guarded)
            recovered = before - board.inaccessible
            write_all()
            ship()
            last_deploy = time.monotonic()
            for channel in every():
                if channel["id"] in board.inaccessible:
                    nxt[channel["id"]] = time.monotonic() + DEPLOY_EVERY
                elif channel["id"] in recovered:
                    nxt[channel["id"]] = time.monotonic()
        if time.monotonic() - last_ask >= ASK_EVERY:
            # A new pick or a "list my servers again" from the app shows up within a minute.
            last_ask = time.monotonic()
            for key in picks.reload():
                nxt[key] = time.monotonic()
            guarded(lambda: picks.catalog(client, lambda: STOP["now"]))
            names = names_now()
            live_ids = {channel["id"] for channel in every()}
            for key in list(nxt):
                if key not in live_ids:
                    nxt.pop(key, None)
        open_channels = [channel for channel in every() if channel["id"] not in board.inaccessible]
        channel, cursor = pick_due(open_channels, nxt, time.monotonic(), cursor)
        if channel is None:
            wait = min(nxt.values()) - time.monotonic() if nxt else 5
            wait = min(30.0, max(0.4, wait), max(0.4, last_deploy + DEPLOY_EVERY - time.monotonic()))
            time.sleep(wait)
            continue
        cursor_id = board.cursor.get(channel["id"]) or ""
        if not cursor_id:
            result = guarded(lambda channel=channel: backfill(client, channel["id"]))
        else:
            result = guarded(lambda channel=channel, cursor_id=cursor_id: forward(client, channel["id"], cursor_id))
        if result == "rate":
            nxt[channel["id"]] = time.monotonic() + 30
            continue
        if result is None:
            continue
        messages, gap = result
        if not isinstance(messages, list):
            if client.last_status == 403:
                board.inaccessible.add(channel["id"])
                print(f"[discord-live] {label(channel)} inaccessible")
            nxt[channel["id"]] = time.monotonic() + (DEPLOY_EVERY if client.last_status == 403 else next_gap(channel["busy"]))
            continue
        newest = board.cursor.get(channel["id"])
        count = apply_messages(board, channel, messages, names, topic_for(channel), token, bool(cursor_id))
        polls += 1
        if count or polls <= 30 or polls % 40 == 0:
            print(f"[discord-live] {label(channel)} +{count} gap {gap:.1f}s")
        if channel.get("private") and board.cursor.get(channel["id"]) != newest:
            # Picked servers have no ntfy push, so their file goes up now.
            picks.write(board)
            picks.upload()
        elif count:
            write_all()
        nxt[channel["id"]] = time.monotonic() + next_gap(channel["busy"])
    write_all()
    ship()
    print("[discord-live] exited cleanly")
    return 0


def refresh(client, channels, board, names, topic_for, token, guarded) -> None:
    for channel in channels:
        if STOP["now"]:
            return
        result = guarded(lambda channel=channel: page(client, channel["id"]))
        if result == "rate" or result is None:
            continue
        messages, _gap = result
        if not isinstance(messages, list):
            if client.last_status == 403:
                board.inaccessible.add(channel["id"])
            continue
        board.inaccessible.discard(channel["id"])
        apply_messages(board, channel, messages, names, topic_for(channel), token, True)


def deploy(root: Path, token: str) -> None:
    try:
        upload_discord(root, token)
    except Exception as exc:
        print(public_error(exc))
    try:
        from discord_publish import publish_site

        publish_site(root, token)
    except Exception as exc:
        print(public_error(exc))


def write_status(root: Path, server: dict | None, status: str, detail: str, token: str) -> None:
    channels = []
    if server:
        for channel in server["channels"]:
            entry = {"id": channel["id"], "name": channel["name"], "mode": "messages", "file": f"discord/messages/{channel['id']}.json"}
            if channel.get("category"):
                entry["category"] = channel["category"]
            if channel["id"] in QUIET_CHANNELS:
                entry["inaccessible"] = True
            channels.append(entry)
    payload = {
        "fetchedAt": iso_now(),
        "status": status,
        "detail": detail,
        "servers": [],
    }
    if server:
        payload["servers"].append(
            {
                "id": server["id"],
                "name": server["name"],
                "handle": server["id"],
                "auth": "user",
                "url": f"https://discord.com/channels/{server['id']}",
                "channels": channels,
            }
        )
    _write_json(root / "discord" / "index.json", payload, token)


def main() -> int:
    config_path = ROOT / "feeds.config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    servers = live_servers(config)
    server = servers[0] if servers else None
    env_token = (os.environ.get("DISCORD_USER_TOKEN") or "").strip()
    owned = ""
    try:
        from owner_keys import material
        owned = material("discord")
    except Exception:
        owned = ""
    if owned.startswith("Bot "):
        owned = ""
    token = owned or env_token
    if not token:
        print("[discord-live] waiting for token")
        write_status(ROOT, server, "waiting for token", "DISCORD_USER_TOKEN is not set", "")
        deploy(ROOT, "")
        return 0
    if server is None and not _has_picks():
        print("[discord-live] no user-auth message channels")
        return 0
    try:
        return run(ROOT, server, token)
    except DiscordStop as exc:
        print("[discord-live] " + exc.text)
        write_status(ROOT, server, exc.reason, exc.text, token)
        deploy(ROOT, token)
        if exc.reason in ("unauthorized", "forbidden"):
            write_health("invalid", exc.reason, token)
        if exc.reason in ("unauthorized", "forbidden", "captcha", "verification"):
            if owned:
                try:
                    from owner_keys import mark_attention
                    reason = "captcha" if exc.reason in ("captcha", "verification") else ("forbidden" if exc.reason == "forbidden" else "unauthorized")
                    mark_attention("discord", reason)
                except Exception:
                    pass
            _account_issue(True, exc.text)
        return 0


def _has_picks() -> bool:
    """Picked servers, or the owner asked for the server list."""
    doc = r2_json(discord_picks.PICKS_KEY)
    if isinstance(doc, dict) and discord_picks.picked_servers(doc):
        return True
    return discord_picks.catalog_due(r2_json(discord_picks.CATALOG_KEY), r2_json(discord_picks.REQUEST_KEY))


def _account_issue(paused: bool, reason: str) -> None:
    try:
        import discord_alert

        discord_alert.mark(paused, reason)
    except Exception:
        print("[discord] could not update the account issue")


if __name__ == "__main__":
    sys.exit(main())
