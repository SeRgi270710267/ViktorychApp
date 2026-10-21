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
JSON the Messages page already accepts. About every 10 minutes the newest
history per channel is written under discord/ and deployed with the site.

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
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from site_paths import pages_base  # noqa: E402
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
RUN_LIMIT = (5 * 60 + 40) * 60
NTFY_LIMIT = 3800
DEFAULT_TOPIC = "superintelmusic-discord-th-7f3a91c2"
UA = "superintel-preview/1.0"

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

    def load_dir(self, root: Path) -> None:
        folder = root / "discord" / "messages"
        if not folder.is_dir():
            return
        for path in folder.glob("*.json"):
            channel_id = snowflake(path.stem)
            if not channel_id:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, dict):
                continue
            self.authors[channel_id] = data.get("authors") if isinstance(data.get("authors"), dict) else {}
            for row in data.get("messages") or []:
                if isinstance(row, dict) and snowflake(row.get("id")):
                    self.messages.setdefault(channel_id, {})[row["id"]] = row
            rows = self.rows(channel_id)
            if rows:
                self.cursor[channel_id] = rows[0]["id"]

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


def write_tree(root: Path, server: dict, board: Board, icon: str, members, online: str, status: str, detail: str, token: str) -> None:
    fetched = iso_now()
    channels = []
    for channel in server["channels"]:
        entry = {"id": channel["id"], "name": channel["name"], "mode": "messages", "file": f"discord/messages/{channel['id']}.json"}
        if channel.get("category"):
            entry["category"] = channel["category"]
        if channel["id"] in board.inaccessible:
            entry["inaccessible"] = True
        channels.append(entry)
        payload = {
            "platform": "discord",
            "guildId": server["id"],
            "channelId": channel["id"],
            "name": channel["name"],
            "fetchedAt": fetched,
            "authors": board.authors.get(channel["id"]) or {},
            "messages": board.rows(channel["id"]),
        }
        if channel.get("category"):
            payload["category"] = channel["category"]
        _write_json(root / "discord" / "messages" / f"{channel['id']}.json", payload, token)
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


def run(root: Path, server: dict, token: str) -> int:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        _mirror_published(root, published_here, token)
    except Exception as exc:
        print(public_error(exc))
    board = Board()
    board.load_dir(root)
    client = Client(token, auth="user", min_interval=1.5)
    client.max_attempts = 4
    names = {channel["id"]: channel["name"] for channel in server["channels"] if channel.get("name")}
    icon, members, online = "", None, None
    try:
        icon, members, online = header(client, server)
    except DiscordStop:
        raise
    if client.last_status == 200:
        _account_issue(False, "")
    print(f"[discord-live] {server['name']} {len(server['channels'])} channels")
    started = time.monotonic()
    deadline = started + RUN_LIMIT
    topic = server.get("ntfy") or DEFAULT_TOPIC

    def guarded(call):
        try:
            return call()
        except DiscordStop as exc:
            if exc.reason == "rate-limit":
                print("[discord-live] rate limit; pausing 30s")
                time.sleep(30)
                return "rate"
            raise

    for channel in server["channels"]:
        if STOP["now"] or time.monotonic() >= deadline:
            break
        result = guarded(lambda channel=channel: backfill(client, channel["id"]))
        if result == "rate" or result is None:
            continue
        messages, gap = result
        if not isinstance(messages, list):
            if client.last_status == 403:
                board.inaccessible.add(channel["id"])
                print(f"[discord-live] #{channel['name'] or channel['id']} inaccessible")
            continue
        apply_messages(board, channel, messages, names, topic, token, False)
        print(f"[discord-live] #{channel['name']} history {len(board.rows(channel['id']))} gap {gap:.1f}s")
    write_tree(root, server, board, icon, members, online, "ok", "", token)
    deploy(root, token)
    last_deploy = time.monotonic()
    nxt = {}
    now = time.monotonic()
    for channel in server["channels"]:
        if channel["id"] in board.inaccessible:
            nxt[channel["id"]] = now + DEPLOY_EVERY
        elif channel["busy"]:
            nxt[channel["id"]] = now
        else:
            nxt[channel["id"]] = now + next_gap(False)
    cursor = 0
    polls = 0
    while not STOP["now"] and time.monotonic() < deadline:
        now = time.monotonic()
        if now - last_deploy >= DEPLOY_EVERY:
            before = set(board.inaccessible)
            refresh(client, server, board, names, topic, token, guarded)
            recovered = before - board.inaccessible
            write_tree(root, server, board, icon, members, online, "ok", "", token)
            deploy(root, token)
            last_deploy = time.monotonic()
            for channel in server["channels"]:
                if channel["id"] in board.inaccessible:
                    nxt[channel["id"]] = time.monotonic() + DEPLOY_EVERY
                elif channel["id"] in recovered:
                    nxt[channel["id"]] = time.monotonic()
        open_channels = [channel for channel in server["channels"] if channel["id"] not in board.inaccessible]
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
                print(f"[discord-live] #{channel['name']} inaccessible")
            nxt[channel["id"]] = time.monotonic() + (DEPLOY_EVERY if client.last_status == 403 else next_gap(channel["busy"]))
            continue
        count = apply_messages(board, channel, messages, names, topic, token, bool(cursor_id))
        polls += 1
        if count or polls <= 30 or polls % 40 == 0:
            print(f"[discord-live] #{channel['name']} +{count} gap {gap:.1f}s")
        if count:
            write_tree(root, server, board, icon, members, online, "ok", "", token)
        nxt[channel["id"]] = time.monotonic() + next_gap(channel["busy"])
    write_tree(root, server, board, icon, members, online, "ok", "", token)
    deploy(root, token)
    print("[discord-live] exited cleanly")
    return 0


def refresh(client, server, board, names, topic, token, guarded) -> None:
    for channel in server["channels"]:
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
        apply_messages(board, channel, messages, names, topic, token, True)


def deploy(root: Path, token: str) -> None:
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
    token = (os.environ.get("DISCORD_USER_TOKEN") or "").strip()
    if not token:
        print("[discord-live] waiting for token")
        write_status(ROOT, server, "waiting for token", "DISCORD_USER_TOKEN is not set", "")
        deploy(ROOT, "")
        return 0
    if server is None:
        print("[discord-live] no user-auth message channels")
        return 0
    try:
        return run(ROOT, server, token)
    except DiscordStop as exc:
        print("[discord-live] " + exc.text)
        write_status(ROOT, server, exc.reason, exc.text, token)
        deploy(ROOT, token)
        if exc.reason in ("unauthorized", "forbidden", "captcha", "verification"):
            _account_issue(True, exc.text)
        return 0


def _account_issue(paused: bool, reason: str) -> None:
    try:
        import discord_alert

        discord_alert.mark(paused, reason)
    except Exception:
        print("[discord] could not update the account issue")


if __name__ == "__main__":
    sys.exit(main())
