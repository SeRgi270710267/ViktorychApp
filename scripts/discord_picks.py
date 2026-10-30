#!/usr/bin/env python3
"""Extra Discord servers the owner picks in Messages (read-only, spare account).

The sync lists the servers the spare account is already a member of and their
text and announcement channels. That catalog goes to the private DATA bucket
(``discord/x/catalog.json``). The owner picks servers and channels in the app.
The Worker saves the list as ``discord/x/picks.json``. ``discord_live.py``
reads it, polls those channels on its usual pace and writes them back under
``discord/x/`` in the private bucket. Nothing here goes to Pages, ntfy, the
repo or the logs. The one write is ``join_invite``: a single join the owner
confirmed in the app for one invite. It never runs on its own or in bulk.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

PREFIX = "discord/x/"
PICKS_KEY = PREFIX + "picks.json"
CATALOG_KEY = PREFIX + "catalog.json"
REQUEST_KEY = PREFIX + "request.json"
INDEX_KEY = PREFIX + "index.json"
LOCAL_DIR = ".discord-x"
MAX_GUILDS = 100
MAX_SERVERS = 12
MAX_CHANNELS = 40
TEXT_TYPES = {0: "text", 5: "announcement"}
CATEGORY = 4


def snowflake(value) -> str:
    text = str(value if value is not None else "").strip()
    return text if text.isdigit() and 15 <= len(text) <= 22 else ""


def clip(value, size: int) -> str:
    text = "".join(ch for ch in str(value if value is not None else "") if ch >= " " and ch not in "<>\x7f")
    return text.strip()[:size]


def local_root(root: Path) -> Path:
    return root / LOCAL_DIR


def icon_url(guild_id: str, icon) -> str:
    icon = str(icon or "")
    if not icon or not all(ch.isalnum() or ch == "_" for ch in icon):
        return ""
    return f"https://cdn.discordapp.com/icons/{guild_id}/{icon}.png?size=96"


def guild_channels(raw) -> list:
    """Text and announcement channels in Discord's sidebar order."""
    if not isinstance(raw, list):
        return []
    cats = {}
    for item in raw:
        if isinstance(item, dict) and item.get("type") == CATEGORY and snowflake(item.get("id")):
            cats[str(item["id"])] = (int(item.get("position") or 0), clip(item.get("name"), 80))
    rows = []
    for item in raw:
        if not isinstance(item, dict) or item.get("type") not in TEXT_TYPES:
            continue
        cid = snowflake(item.get("id"))
        if not cid:
            continue
        parent = str(item.get("parent_id") or "")
        cat_pos, cat_name = cats.get(parent, (-1, ""))
        rows.append((cat_pos, int(item.get("position") or 0), int(cid), {
            "id": cid,
            "name": clip(item.get("name"), 80) or cid,
            "category": cat_name,
            "kind": TEXT_TYPES[item["type"]],
        }))
    rows.sort(key=lambda row: row[:3])
    return [row[3] for row in rows][:300]


def catalog_server(client, guild) -> dict | None:
    gid = snowflake((guild or {}).get("id") if isinstance(guild, dict) else None)
    if not gid:
        return None
    return {
        "id": gid,
        "name": clip(guild.get("name"), 80) or gid,
        "icon": icon_url(gid, guild.get("icon")),
        "channels": guild_channels(client.get_json(f"/guilds/{gid}/channels")),
    }


def build_catalog(client, now: str, stop=lambda: False, old=None, want: str = "") -> dict | None:
    """Servers the account is already in. GET only, on the client's pace.

    With ``old`` and ``want`` only the wanted server and servers missing from
    ``old`` are listed again (at most five), so a fresh join shows up after two
    or three requests. None when Discord refused the guild list."""
    guilds = client.get_json("/users/@me/guilds", {"limit": "200"})
    if not isinstance(guilds, list):
        return None
    known = {}
    if isinstance(old, dict):
        for server in old.get("servers") or []:
            if isinstance(server, dict) and snowflake(server.get("id")):
                known[str(server["id"])] = server
    servers = []
    fresh = 0
    for guild in guilds[:MAX_GUILDS]:
        if stop():
            break
        gid = snowflake((guild or {}).get("id") if isinstance(guild, dict) else None)
        if not gid:
            continue
        keep = known.get(gid) if isinstance(old, dict) else None
        if keep is not None and gid != want:
            keep = dict(keep)
            keep["name"] = clip(guild.get("name"), 80) or keep.get("name") or gid
            keep["icon"] = icon_url(gid, guild.get("icon")) or keep.get("icon") or ""
            servers.append(keep)
            continue
        if isinstance(old, dict) and gid != want and fresh >= 5:
            continue
        row = catalog_server(client, guild)
        if row:
            servers.append(row)
            fresh += 1
    return {"fetchedAt": now, "servers": servers}


def catalog_task(catalog, request) -> tuple[str, str]:
    """("full", "") for a missing catalog, ("guild", id) or ("full", "") when
    the owner asked after the last listing, else ("", "")."""
    if not isinstance(catalog, dict) or not isinstance(catalog.get("servers"), list):
        return "full", ""
    asked = str((request or {}).get("requestedAt") or "") if isinstance(request, dict) else ""
    if not asked or asked <= str(catalog.get("fetchedAt") or ""):
        return "", ""
    want = snowflake(request.get("guild"))
    return ("guild", want) if want else ("full", "")


def catalog_due(catalog, request) -> bool:
    return bool(catalog_task(catalog, request)[0])


def picked_servers(doc, skip=()) -> list:
    """The owner's picks as sync servers. Servers in ``skip`` (already in the
    public config) are left out. No ntfy topic: ntfy topics are public."""
    found = []
    seen = set(skip)
    total = 0
    for row in (doc or {}).get("servers") or [] if isinstance(doc, dict) else []:
        if not isinstance(row, dict) or len(found) >= MAX_SERVERS:
            continue
        gid = snowflake(row.get("id"))
        if not gid or gid in seen:
            continue
        seen.add(gid)
        channels = []
        for ch in row.get("channels") or []:
            if not isinstance(ch, dict) or total >= MAX_CHANNELS:
                continue
            cid = snowflake(ch.get("id"))
            if not cid:
                continue
            channels.append({
                "id": cid,
                "name": clip(ch.get("name"), 80) or cid,
                "category": clip(ch.get("category"), 80),
                "busy": False,
                "server": gid,
                "private": True,
            })
            total += 1
        if channels:
            found.append({
                "id": gid,
                "name": clip(row.get("name"), 80) or gid,
                "icon": str(row.get("icon") or "") if str(row.get("icon") or "").startswith("https://cdn.discordapp.com/") else "",
                "ntfy": "",
                "private": True,
                "channels": channels,
            })
    return found


def private_index(servers: list, inaccessible, fetched: str, status: str = "ok", newest=None) -> dict:
    out = []
    for server in servers:
        channels = []
        for ch in server["channels"]:
            entry = {
                "id": ch["id"],
                "name": ch["name"],
                "mode": "messages",
                "file": f"{PREFIX}messages/{ch['id']}.json",
            }
            if ch.get("category"):
                entry["category"] = ch["category"]
            if ch["id"] in inaccessible:
                entry["inaccessible"] = True
            last = snowflake((newest or {}).get(ch["id"]))
            if last:
                # The app re-reads only channels whose newest message moved.
                entry["last"] = last
            channels.append(entry)
        out.append({
            "id": server["id"],
            "name": server["name"],
            "icon": server.get("icon") or "",
            "auth": "user",
            "private": True,
            "url": f"https://discord.com/channels/{server['id']}",
            "channels": channels,
        })
    return {"fetchedAt": fetched, "status": status, "servers": out}


class Uploader:
    """Puts changed files from .discord-x/ into the private bucket once."""

    def __init__(self, put):
        self.put = put
        self.sent = {}

    def push(self, root: Path, keys: list, secret: str = "") -> int:
        base = local_root(root)
        count = 0
        for key in keys:
            if not key.startswith(PREFIX) or ".." in key:
                continue
            path = base / key[len(PREFIX):]
            try:
                payload = path.read_bytes()
            except OSError:
                continue
            if secret and secret.encode("utf-8") in payload:
                continue
            digest = hashlib.sha256(payload).hexdigest()
            if self.sent.get(key) == digest:
                continue
            if self.put(key, payload):
                self.sent[key] = digest
                count += 1
        return count


def private_keys(root: Path, servers: list) -> list:
    """index.json first, then each picked channel's hot file and pages."""
    base = local_root(root)
    keys = []
    for server in servers:
        for ch in server["channels"]:
            keys.append(f"{PREFIX}messages/{ch['id']}.json")
            folder = base / "messages" / ch["id"] / "p"
            if folder.is_dir():
                for path in sorted(folder.glob("*.json")):
                    keys.append(f"{PREFIX}messages/{ch['id']}/p/{path.name}")
    # The index goes last so a client that sees it change finds the files.
    keys.append(INDEX_KEY)
    return keys


INVITE_CODE = re.compile(r"^[A-Za-z0-9-]{2,32}$")
JOIN_KEY = PREFIX + "join.json"
HEALTH_KEY = PREFIX + "health.json"


def join_request(request) -> dict | None:
    """The owner's one confirmed join, as the Worker wrote it."""
    join = (request or {}).get("join") if isinstance(request, dict) else None
    if not isinstance(join, dict):
        return None
    code = str(join.get("code") or "")
    jid = str(join.get("id") or "")
    if not INVITE_CODE.match(code) or not re.match(r"^[a-z0-9]{8,32}$", jid):
        return None
    out = {"code": code, "id": jid, "guild": snowflake(join.get("guild")), "by": str(join.get("by") or "")}
    cap = join.get("captcha")
    if isinstance(cap, dict) and re.match(r"^[a-z0-9]{8,32}$", str(cap.get("sid") or "")) and _cfield(cap.get("key")):
        out["captcha"] = {"sid": str(cap["sid"]), "key": cap["key"], "rqtoken": _cfield(cap.get("rqtoken")), "session": _cfield(cap.get("session"))}
    return out


def join_outcome(status: int, body) -> tuple[str, str]:
    """("joined", guild id) or a reason the app can show."""
    from adapters.discord import account_block

    payload = {}
    try:
        parsed = json.loads(body.decode("utf-8", "replace") if isinstance(body, (bytes, bytearray)) else str(body or ""))
        payload = parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        payload = {}
    if status == 200:
        guild = payload.get("guild") if isinstance(payload.get("guild"), dict) else {}
        return "joined", snowflake(guild.get("id") or payload.get("guild_id"))
    block = account_block(status, body)
    if block in ("captcha", "verification"):
        return block, ""
    if status == 429:
        return "rate-limit", ""
    if status == 404:
        return "invalid", ""
    if status in (401, 403):
        return block or "forbidden", ""
    return "error", ""


CAPTCHA_KEY = PREFIX + "captcha.json"
_CAPTCHA_FIELD = re.compile(r"^[A-Za-z0-9_.:+/=-]{1,4096}$")


def _cfield(value) -> str:
    text = "" if value is None else str(value)
    return text if _CAPTCHA_FIELD.match(text) else ""


def captcha_challenge(body) -> dict | None:
    """The hCaptcha fields of a Discord join answer, for the owner to solve
    by hand in the app. Never solved here."""
    try:
        parsed = json.loads(body.decode("utf-8", "replace") if isinstance(body, (bytes, bytearray)) else str(body or ""))
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict) or not _cfield(parsed.get("captcha_sitekey")):
        return None
    return {
        "sitekey": _cfield(parsed.get("captcha_sitekey")),
        "service": _cfield(parsed.get("captcha_service")) or "hcaptcha",
        "rqdata": _cfield(parsed.get("captcha_rqdata")),
        "rqtoken": _cfield(parsed.get("captcha_rqtoken")),
        "sessionId": _cfield(parsed.get("captcha_session_id")),
    }


def join_attempt(token: str, code: str, transport=None, captcha: dict | None = None) -> tuple[str, str, dict | None]:
    """One POST to /invites/<code> for the owner's confirmed tap. Nothing else.

    With ``captcha`` (the owner's own hCaptcha answer) Discord's captcha
    headers ride along, once. The token is never logged. A captcha answer is
    returned with its challenge, never solved."""
    if not token or not INVITE_CODE.match(code or ""):
        return "invalid", "", None
    from adapters.discord import API, BROWSER_UA

    url = f"{API}/invites/{code}"
    headers = {
        "Authorization": token,
        "User-Agent": BROWSER_UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if captcha and _cfield(captcha.get("key")):
        headers["X-Captcha-Key"] = captcha["key"]
        if _cfield(captcha.get("rqtoken")):
            headers["X-Captcha-Rqtoken"] = captcha["rqtoken"]
        if _cfield(captcha.get("session")):
            headers["X-Captcha-Session-Id"] = captcha["session"]

    def done(status, body):
        outcome, guild = join_outcome(int(status), body)
        return outcome, guild, captcha_challenge(body) if outcome == "captcha" else None

    if transport:
        status, body = transport(url, headers)
        return done(status, body)
    request = urllib.request.Request(url, data=b"{}", headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return done(getattr(response, "status", 200), response.read(200_000))
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(200_000)
        except Exception:
            body = b""
        return done(exc.code, body)
    except (urllib.error.URLError, TimeoutError, OSError):
        return "error", "", None


def join_invite(token: str, code: str, transport=None) -> tuple[str, str]:
    status, guild, _ = join_attempt(token, code, transport)
    return status, guild


def captcha_doc(jid: str, code: str, guild: str, challenge: dict, at: str) -> dict:
    doc = {"id": jid, "code": code, "guild": guild, "at": at, "used": False}
    doc.update({k: challenge.get(k, "") for k in ("sitekey", "service", "rqdata", "rqtoken", "sessionId")})
    return doc


def key_hash(token: str) -> str:
    """Short fingerprint of the token. Never reversible; safe to store."""
    text = (token or "").strip()
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def health_doc(status: str, reason: str, token: str, at: str, checked: str = "") -> dict:
    doc = {
        "status": status if status in ("ok", "invalid") else "ok",
        "reason": reason if reason in ("unauthorized", "forbidden") else "",
        "keyHash": key_hash(token) if status == "invalid" else "",
        "at": at,
    }
    if checked:
        doc["checkedAt"] = str(checked)[:40]
    return doc


def key_check_due(health, today: str) -> bool:
    """The once-a-day GET /users/@me is due when today's is not on file."""
    checked = str((health or {}).get("checkedAt") or "") if isinstance(health, dict) else ""
    return checked[:10] != str(today)[:10]


def key_blocked(health, token: str) -> bool:
    """True when this exact key already failed with 401/403."""
    if not isinstance(health, dict) or health.get("status") != "invalid":
        return False
    if health.get("reason") not in ("unauthorized", "forbidden"):
        return False
    held = str(health.get("keyHash") or "")
    return bool(held) and held == key_hash(token)
