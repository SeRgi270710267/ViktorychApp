"""Read Discord channels the config lists.

The default is a bot. ``DISCORD_BOT_TOKEN`` is sent only as
``Authorization: Bot …`` to discord.com. A server with ``"auth": "user"``
may instead use ``DISCORD_USER_TOKEN``, the token from that person's own
Discord account. That token is sent as itself, with no ``Bot`` prefix. Neither
token is written to the site, the config, or the log.

User-token calls are read-only GETs: channel messages, channel pins, one
channel, one guild or its preview, and the public widget. They wait at least
1.5 seconds between
requests, ask for a short page, and continue from the stored snowflake. A
401, a captcha, or a verification challenge stops Discord for the run. A 403
on the guild read stops it too. A 403 on one channel means that channel is
not visible: it is skipped, and the other channels are still read. Channels
this guest cannot see are never an account failure. Rate-limit headers and
HTTP 429 Retry-After are waited out, not ignored.

Public ``widget.json`` and invite lookups fill the server header when the
server exposes them. ``GET /guilds/{id}?with_counts=true`` fills an icon or
member count the public endpoints left blank. Media stays on Discord's CDN.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parents[1]
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
from site_paths import github_web, pages_base, user_agent  # noqa: E402

from .common import clean_text, dedupe_posts, drop_empty, merge_profiles, post_shell, to_iso

API = "https://discord.com/api/v10"
SITE = pages_base()
USER_AGENT = "DiscordBot (" + github_web() + ", 1.0)"
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
SITE_AGENT = user_agent()
USER_INTERVAL = 1.5
USER_PAGE_SIZE = 25
# VIEW_CHANNEL (1 << 10) and READ_MESSAGE_HISTORY (1 << 16). Nothing else.
INVITE_PERMISSIONS = (1 << 10) | (1 << 16)
SNOWFLAKE = re.compile(r"^\d{1,22}$")
INVITE_CODE = re.compile(r"^[A-Za-z0-9-]{2,32}$")
PUBLISHED = re.compile(r"discord/(?:index|state|messages/\d{1,22}|pins/\d{1,22})\.json$")
USER_GET = re.compile(r"^/api/v10/(?:channels/\d{1,22}(?:/messages|/pins)?|guilds/\d{1,22}(?:/preview)?)$")
CHANNEL_IN_PATH = re.compile(r"/channels/(\d{1,22})(?:/|$)")
PINS_IN_PATH = re.compile(r"/channels/\d{1,22}/pins$")
GUILD_READ = re.compile(r"/guilds/\d{1,22}(?:/preview)?$")
# These channels 403 for this guest. That is not an account failure.
QUIET_CHANNELS = frozenset({
    "1218290760126828544",  # wfs-general
    "1540408515661926501",  # boosters-chat
    "1544030558017818644",  # boosters-apps
    "1544031346077339790",  # fun-apps
})
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v"}
USER_MESSAGE = {0, 19, 20, 23}
DISCORD_EPOCH = 1420070400000
MAX_ATTEMPTS = 4
PAGE_GUARD = 8
THREAD_CAP = 8
THREAD_LIMIT = 20

MENTION_USER = re.compile(r"<@!?(\d+)>")
MENTION_ROLE = re.compile(r"<@&(\d+)>")
MENTION_CHANNEL = re.compile(r"<#(\d+)>")
CUSTOM_EMOJI = re.compile(r"<(a?):([A-Za-z0-9_]{2,32}):(\d+)>")
TIMESTAMP = re.compile(r"<t:(-?\d{1,16})(?::([tTdDfFR]))?>")
MD_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
AUTO_LINK = re.compile(r"<(https?://[^>\s]+)>")
BARE_LINK = re.compile(r"https?://[^\s<>()]+")
SPOILER = re.compile(r"\|\|([\s\S]+?)\|\|")
CODE_BLOCK = re.compile(r"```(?:[A-Za-z0-9_+-]+\n)?([\s\S]*?)```")
INLINE_CODE = re.compile(r"`([^`\n]+)`")


class DiscordAuthError(Exception):
    """The bot token was rejected. The token itself is not part of this error."""


class DiscordStop(Exception):
    """Discord refused the account. This run must not try another request."""

    _TEXT = {
        "unauthorized": "Discord returned 401 for the user token. Discord sync stopped for this run and will not retry.",
        "forbidden": "Discord returned 403 for the user token. Discord sync stopped for this run and will not retry.",
        "captcha": "Discord asked for a captcha. Discord sync stopped for this run and will not retry.",
        "verification": "Discord asked for account verification. Discord sync stopped for this run and will not retry.",
        "rate-limit": "Discord kept rate limiting after Retry-After. Discord sync stopped for this run and will not retry.",
    }

    def __init__(self, reason: str):
        self.reason = reason
        self.text = self._TEXT.get(reason, "Discord refused the account. Discord sync stopped for this run and will not retry.")
        super().__init__(self.text)


class _NoRedirect(urllib.request.HTTPErrorProcessor):
    """Return 3xx responses instead of resending the bot token to Location."""

    def http_response(self, request, response):
        return response

    https_response = http_response


def invite_permissions() -> int:
    return INVITE_PERMISSIONS


def snowflake(value) -> str:
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, int):
        text = str(value)
    else:
        text = str(value).strip()
    return text if SNOWFLAKE.match(text) else ""


def invite_code(value) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.split("?", 1)[0].rstrip("/")
    for marker in ("discord.gg/", "discord.com/invite/"):
        at = text.find(marker)
        if at >= 0:
            text = text[at + len(marker) :]
            break
    text = text.strip("/")
    return text if INVITE_CODE.match(text) else ""


def known_secrets() -> list:
    found = []
    for name in ("DISCORD_BOT_TOKEN", "DISCORD_USER_TOKEN"):
        value = (os.environ.get(name) or "").strip()
        if value and value not in found:
            found.append(value)
    return found


def public_error(exc: BaseException) -> str:
    detail = str(exc)
    for token in known_secrets():
        if token in detail:
            detail = detail.replace(token, "[redacted]")
    text = type(exc).__name__
    if detail and detail != text:
        text = text + ": " + detail[:180]
    return "[discord] " + text


def _redact(value, token: str):
    if not token:
        return value
    if isinstance(value, str):
        return value.replace(token, "[redacted]")
    if isinstance(value, list):
        return [_redact(item, token) for item in value]
    if isinstance(value, dict):
        return {key: _redact(item, token) for key, item in value.items()}
    return value


def _header(headers, name: str):
    for key, value in (headers or {}).items():
        if str(key).lower() == name.lower():
            return value
    return None


def _retry_seconds(headers, body) -> float:
    raw = _header(headers, "Retry-After")
    if raw is not None and str(raw).strip() != "":
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    try:
        payload = json.loads(body or b"{}")
        return float(payload.get("retry_after"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return 1.0


def account_block(status: int, body) -> str:
    """Why this response stops a user-token run. Empty when the call can continue."""
    if isinstance(body, (bytes, bytearray)):
        text = body.decode("utf-8", "replace")
    else:
        text = str(body or "")
    payload = {}
    try:
        parsed = json.loads(text) if text else {}
        if isinstance(parsed, dict):
            payload = parsed
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {}
    lowered = text.lower()
    try:
        code = int(payload.get("code"))
    except (TypeError, ValueError):
        code = None
    if code == 40002 or "verify your account" in lowered:
        return "verification"
    if any(key in payload for key in ("captcha_key", "captcha_sitekey", "captcha_rqdata", "captcha_rqtoken", "captcha_service")):
        return "captcha"
    if "captcha-required" in lowered:
        return "captcha"
    if status == 401:
        return "unauthorized"
    if status == 403:
        return "forbidden"
    return ""


def channel_denied(status: int, body) -> bool:
    """A 403 that means this channel is hidden, not that the account was refused.

    Missing Access (50001) and Missing Permissions (50013) skip that channel.
    A 401, a captcha, or any other 403 still stops the run.
    """
    if status != 403:
        return False
    if isinstance(body, (bytes, bytearray)):
        text = body.decode("utf-8", "replace")
    else:
        text = str(body or "")
    payload = {}
    try:
        parsed = json.loads(text) if text else {}
        if isinstance(parsed, dict):
            payload = parsed
    except (TypeError, ValueError, json.JSONDecodeError):
        payload = {}
    try:
        code = int(payload.get("code"))
    except (TypeError, ValueError):
        code = None
    if code in (50001, 50013):
        return True
    lowered = text.lower()
    return "missing access" in lowered or "missing permissions" in lowered


def user_get_allowed(url: str) -> bool:
    path = urllib.parse.urlparse(url).path or ""
    return bool(USER_GET.match(path))


def channel_in_url(url: str) -> str:
    match = CHANNEL_IN_PATH.search(urllib.parse.urlparse(url).path or "")
    return match.group(1) if match else ""


def guild_read(url: str) -> bool:
    return bool(GUILD_READ.search(urllib.parse.urlparse(url).path or ""))


def quiet_channel(url: str) -> bool:
    return channel_in_url(url) in QUIET_CHANNELS


def pins_read(url: str) -> bool:
    return bool(PINS_IN_PATH.search(urllib.parse.urlparse(url).path or ""))


def _positive(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def message_time(message: dict) -> str:
    """The original timestamp. Edits and the sync clock are not publish times."""
    if not isinstance(message, dict):
        return ""
    if message.get("timestamp"):
        return to_iso(message.get("timestamp"))
    mid = snowflake(message.get("id"))
    if not mid:
        return ""
    return to_iso((int(mid) >> 22) + DISCORD_EPOCH)


def avatar_url(user: dict) -> str:
    if not isinstance(user, dict):
        return ""
    uid = snowflake(user.get("id"))
    avatar = user.get("avatar")
    if uid and avatar:
        ext = "gif" if str(avatar).startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{uid}/{avatar}.{ext}?size=128"
    disc = str(user.get("discriminator") or "0")
    try:
        index = (int(uid) >> 22) % 6 if disc == "0" and uid else int(disc) % 5
    except ValueError:
        index = 0
    return f"https://cdn.discordapp.com/embed/avatars/{index}.png"


def guild_icon(guild_id: str, icon: str) -> str:
    if not guild_id or not icon:
        return ""
    ext = "gif" if str(icon).startswith("a_") else "png"
    return f"https://cdn.discordapp.com/icons/{guild_id}/{icon}.{ext}?size=128"


def display_name(user: dict) -> str:
    if not isinstance(user, dict):
        return ""
    return str(user.get("global_name") or user.get("username") or "").strip()


def _ext(name: str) -> str:
    path = (name or "").split("?", 1)[0].lower()
    dot = path.rfind(".")
    return path[dot:] if dot >= 0 else ""


def _hold_code(blocks: list, text: str) -> str:
    blocks.append(text)
    return f"\x00{len(blocks) - 1}\x00"


def render_content(content: str, message: dict, channel_names: dict | None = None):
    """Plain text with mentions, markdown, and custom emoji resolved.

    Spoilers are stored visible. A relative Discord timestamp is stored as an
    absolute UTC time so a later sync does not rewrite it.
    """
    names = channel_names or {}
    users = {}
    for row in (message or {}).get("mentions") or []:
        if isinstance(row, dict) and row.get("id") is not None:
            users[str(row["id"])] = row
    mentioned_channels = dict(names)
    for row in (message or {}).get("mention_channels") or []:
        if isinstance(row, dict) and row.get("id") is not None and row.get("name"):
            mentioned_channels[str(row["id"])] = row["name"]
    blocks = []
    text = CODE_BLOCK.sub(lambda match: _hold_code(blocks, match.group(1)), content or "")
    text = INLINE_CODE.sub(lambda match: _hold_code(blocks, match.group(1)), text)
    # Keep escaped markdown as literal characters. Code was already pulled out.
    escaped = []

    def hold_escape(match: re.Match) -> str:
        escaped.append(match.group(1))
        return f"\x01{len(escaped) - 1}\x01"

    text = re.sub(r"\\([^\nA-Za-z0-9])", hold_escape, text)
    links = []
    emojis = []

    def emoji_sub(match: re.Match) -> str:
        animated = match.group(1) == "a"
        name = match.group(2)
        eid = match.group(3)
        ext = "gif" if animated else "png"
        emojis.append(
            {
                "id": eid,
                "name": name,
                "animated": animated,
                "url": f"https://cdn.discordapp.com/emojis/{eid}.{ext}",
            }
        )
        return f":{name}:"

    def user_sub(match: re.Match) -> str:
        user = users.get(match.group(1)) or {}
        return "@" + (display_name(user) or "user")

    def channel_sub(match: re.Match) -> str:
        return "#" + str(mentioned_channels.get(match.group(1)) or "channel")

    def time_sub(match: re.Match) -> str:
        try:
            moment = datetime.fromtimestamp(int(match.group(1)), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return ""
        style = match.group(2) or "f"
        if style in ("t", "T"):
            return moment.strftime("%H:%M UTC")
        if style == "d":
            return moment.strftime("%Y-%m-%d")
        if style == "D":
            return moment.strftime("%b %d, %Y")
        if style == "F":
            return moment.strftime("%A, %B %d, %Y %H:%M UTC")
        return moment.strftime("%b %d, %Y %H:%M UTC")

    def link_sub(match: re.Match) -> str:
        label, href = match.group(1).strip(), match.group(2)
        links.append({"expanded": href, "display": label or href, "anchorText": label or href})
        return label or href

    def auto_sub(match: re.Match) -> str:
        href = match.group(1)
        links.append({"expanded": href, "display": href, "anchorText": href})
        return href

    text = CUSTOM_EMOJI.sub(emoji_sub, text)
    text = MENTION_USER.sub(user_sub, text)
    text = MENTION_CHANNEL.sub(channel_sub, text)
    text = MENTION_ROLE.sub(lambda _match: "@role", text)
    text = TIMESTAMP.sub(time_sub, text)
    text = MD_LINK.sub(link_sub, text)
    text = AUTO_LINK.sub(auto_sub, text)
    text = SPOILER.sub(lambda match: match.group(1), text)
    text = re.sub(r"\*\*\*([\s\S]+?)\*\*\*", r"\1", text)
    text = re.sub(r"___([\s\S]+?)___", r"\1", text)
    text = re.sub(r"\*\*([\s\S]+?)\*\*", r"\1", text)
    text = re.sub(r"__([\s\S]+?)__", r"\1", text)
    text = re.sub(r"~~([\s\S]+?)~~", r"\1", text)
    text = re.sub(r"(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!\w)_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)", r"\1", text)
    text = re.sub(r"(?m)^#{1,3}\s+", "", text)
    text = re.sub(r"(?m)^>>>\s?", "", text)
    text = re.sub(r"(?m)^>\s?", "", text)
    text = re.sub(r"\x01(\d+)\x01", lambda match: escaped[int(match.group(1))], text)
    known = {link["expanded"] for link in links}
    for match in BARE_LINK.finditer(text):
        href = match.group(0).rstrip(".,)")
        if href and href not in known:
            known.add(href)
            links.append({"expanded": href, "display": href, "anchorText": href})

    def restore(match: re.Match) -> str:
        return blocks[int(match.group(1))]

    text = re.sub(r"\x00(\d+)\x00", restore, text)
    return clean_text(text), links, emojis


def _media_item(**kwargs) -> dict:
    item = {}
    for key, value in kwargs.items():
        if value is None or value == "":
            continue
        item[key] = value
    return item


def attachment_parts(message: dict):
    media = []
    links = []
    for row in (message or {}).get("attachments") or []:
        if not isinstance(row, dict):
            continue
        url = row.get("url") or ""
        if not url:
            continue
        ctype = str(row.get("content_type") or "").lower()
        ext = _ext(row.get("filename") or "") or _ext(urllib.parse.urlparse(url).path)
        alt = row.get("description") or row.get("filename") or ""
        width = row.get("width")
        height = row.get("height")
        if ctype.startswith("image/") or ext in IMAGE_EXT:
            kind = "animated_gif" if ext == ".gif" or "gif" in ctype else "photo"
            media.append(_media_item(type=kind, url=url, poster=url, width=width, height=height, alt=alt))
            continue
        if ctype.startswith("video/") or ext in VIDEO_EXT:
            media.append(_media_item(type="video", url=url, width=width, height=height, alt=alt))
            continue
        name = row.get("filename") or url
        links.append({"expanded": url, "display": name, "anchorText": name})
    for sticker in (message or {}).get("sticker_items") or []:
        if not isinstance(sticker, dict) or not sticker.get("id"):
            continue
        fmt = sticker.get("format_type")
        if fmt not in (1, 2, 4):
            continue
        ext = "gif" if fmt == 4 else "png"
        kind = "animated_gif" if fmt == 4 else "photo"
        url = f"https://cdn.discordapp.com/stickers/{sticker['id']}.{ext}"
        media.append(_media_item(type=kind, url=url, poster=url, alt=sticker.get("name") or ""))
    return media, links


def embed_cards(message: dict, channel_names: dict | None = None):
    cards = []
    extra_links = []
    extra_emoji = []
    for embed in (message or {}).get("embeds") or []:
        if not isinstance(embed, dict):
            continue
        description, links, emojis = render_content(embed.get("description") or "", message, channel_names)
        extra_links.extend(links)
        extra_emoji.extend(emojis)
        image = ""
        for key in ("image", "thumbnail"):
            block = embed.get(key)
            if isinstance(block, dict) and block.get("url"):
                image = block["url"]
                break
        provider = embed.get("provider") if isinstance(embed.get("provider"), dict) else {}
        author = embed.get("author") if isinstance(embed.get("author"), dict) else {}
        card = drop_empty(
            {
                "url": embed.get("url") or "",
                "title": clean_text(embed.get("title") or ""),
                "description": description,
                "image": image,
                "author": author.get("name") or "",
                "site": provider.get("name") or "",
            }
        )
        if card:
            cards.append(card)
            if card.get("url"):
                extra_links.append(
                    {"expanded": card["url"], "display": card.get("title") or card["url"], "anchorText": card.get("title") or card["url"]}
                )
    return cards, _dedupe_links(extra_links), extra_emoji


def _dedupe_links(links: list) -> list:
    seen = set()
    out = []
    for link in links:
        href = link.get("expanded") or ""
        if not href or href in seen:
            continue
        seen.add(href)
        out.append(link)
    return out


def _stats(message: dict) -> dict:
    likes = 0
    for reaction in (message or {}).get("reactions") or []:
        if not isinstance(reaction, dict):
            continue
        try:
            likes += int(reaction.get("count") or 0)
        except (TypeError, ValueError):
            continue
    stats = {}
    if likes:
        stats["likes"] = likes
    thread = message.get("thread") if isinstance(message.get("thread"), dict) else {}
    replies = _positive(thread.get("message_count"))
    if replies:
        stats["replies"] = replies
    return stats


def _user_message(message: dict) -> bool:
    if not isinstance(message, dict):
        return False
    kind = message.get("type")
    if kind is None:
        return True
    try:
        return int(kind) in USER_MESSAGE
    except (TypeError, ValueError):
        return False


def post_id(channel_id: str, message_id: str) -> str:
    return f"discord:{channel_id}:{message_id}"


def normalize_message(message: dict, feed: dict, channel: dict, channel_names: dict | None = None):
    """One Discord message as one post. The id and date come from Discord."""
    if not _user_message(message):
        return None
    channel_id = snowflake(message.get("channel_id") or (channel or {}).get("id"))
    message_id = snowflake(message.get("id"))
    if not channel_id or not message_id:
        return None
    names = dict(channel_names or {})
    if channel.get("name"):
        names.setdefault(channel_id, channel["name"])
    author = message.get("author") if isinstance(message.get("author"), dict) else {}
    text, links, emojis = render_content(message.get("content") or "", message, names)
    media, file_links = attachment_parts(message)
    cards, card_links, card_emoji = embed_cards(message, names)
    links = _dedupe_links(links + file_links + card_links)
    emojis = emojis + card_emoji
    poll = message.get("poll") if isinstance(message.get("poll"), dict) else {}
    question = ((poll.get("question") or {}) if isinstance(poll.get("question"), dict) else {}).get("text") or ""
    if question:
        text = clean_text((text + "\nPoll: " + question).strip())
    for item in media:
        url = item.get("url") or ""
        if url and url in text:
            text = text.replace(url, " ")
    text = clean_text(text)
    if not text and not media and not cards:
        return None
    reference = message.get("message_reference") if isinstance(message.get("message_reference"), dict) else {}
    parent_message = snowflake(reference.get("message_id"))
    parent_channel = snowflake(reference.get("channel_id") or channel_id)
    referenced = message.get("referenced_message") if isinstance(message.get("referenced_message"), dict) else {}
    ref_author = referenced.get("author") if isinstance(referenced.get("author"), dict) else {}
    kind = "post"
    replying = None
    if parent_message:
        kind = "reply"
        replying = drop_empty(
            {
                "id": post_id(parent_channel, parent_message),
                "name": display_name(ref_author),
                "handle": ref_author.get("username") or "",
                "avatar": avatar_url(ref_author) if ref_author else "",
            }
        )
    guild_id = snowflake((feed or {}).get("guildId") or (feed or {}).get("handle"))
    handle = author.get("username") or snowflake(author.get("id")) or ""
    thread = message.get("thread") if isinstance(message.get("thread"), dict) else {}
    post = post_shell(
        id=post_id(channel_id, message_id),
        statusId=post_id(channel_id, message_id),
        platform="discord",
        feedId=(feed or {}).get("id") or (f"discord:{guild_id}" if guild_id else ""),
        kind=kind,
        author=display_name(author) or handle,
        handle=handle,
        avatar=avatar_url(author),
        text=text,
        links=links,
        date=message_time(message),
        url=f"https://discord.com/channels/{guild_id}/{channel_id}/{message_id}" if guild_id else "",
        media=media,
        replyingTo=replying,
        stats=_stats(message),
    )
    post["guildId"] = guild_id
    post["channelId"] = channel.get("id") or channel_id
    if channel.get("name"):
        post["channelName"] = channel["name"]
    if author.get("bot"):
        post["bot"] = True
    if emojis:
        post["emojis"] = emojis
    if cards:
        post["cards"] = cards
    if thread.get("name"):
        post["threadName"] = thread["name"]
    if snowflake(thread.get("id")):
        post["threadId"] = snowflake(thread.get("id"))
    return post


def nest_replies(posts: list) -> list:
    """Replies and thread messages sit on their parent. Cycles stay readable."""
    by_id = {}
    for post in posts:
        if isinstance(post, dict) and post.get("id") and post["id"] not in by_id:
            by_id[post["id"]] = post
    buckets = {pid: [] for pid in by_id}
    roots = []
    for post in by_id.values():
        parent = ""
        target = post.get("replyingTo")
        if isinstance(target, dict):
            parent = str(target.get("id") or "")
        if parent and parent in by_id and parent != post["id"]:
            buckets[parent].append(post)
        else:
            roots.append(post)
    seen = set()

    def finish(post: dict, stack: set) -> None:
        pid = post["id"]
        if pid in stack or pid in seen:
            return
        seen.add(pid)
        stack.add(pid)
        kids = [kid for kid in buckets.get(pid) or [] if kid["id"] not in stack]
        kids.sort(key=lambda item: item.get("date") or "")
        for kid in kids:
            finish(kid, stack)
        if kids:
            post["replies"] = kids
        stack.remove(pid)

    ordered = list(roots)
    for post in ordered:
        finish(post, set())
    for post in by_id.values():
        if post["id"] not in seen:
            ordered.append(post)
            finish(post, set())
    ordered.sort(key=lambda item: item.get("date") or "", reverse=True)
    return ordered


def build_profile(guild_id: str, display_name: str, widget, invite, guild) -> dict:
    widget = widget if isinstance(widget, dict) else {}
    invite = invite if isinstance(invite, dict) else {}
    guild = guild if isinstance(guild, dict) else {}
    invited = invite.get("guild") if isinstance(invite.get("guild"), dict) else {}
    name = display_name or invited.get("name") or guild.get("name") or widget.get("name") or guild_id
    icon = guild_icon(guild_id, invited.get("icon") or guild.get("icon") or "")
    members = invite.get("approximate_member_count")
    if members is None:
        members = guild.get("approximate_member_count")
    online = widget.get("presence_count")
    if online is None:
        online = invite.get("approximate_presence_count")
    if online is None:
        online = guild.get("approximate_presence_count")
    description = invited.get("description") or guild.get("description") or ""
    invite_url = widget.get("instant_invite") or ""
    if not invite_url and invite.get("code"):
        invite_url = "https://discord.gg/" + str(invite["code"])
    profile = drop_empty(
        {
            "id": f"discord:{guild_id}",
            "platform": "discord",
            "handle": guild_id,
            "name": name,
            "title": name,
            "avatar": icon,
            "bio": str(description or "").strip(),
            "url": invite_url or f"https://discord.com/channels/{guild_id}",
            "followers": _positive(members),
            "online": _positive(online),
        }
    )
    profile["configured"] = True
    return profile


def _hex_color(value) -> str:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("#"):
            text = text[1:]
        if re.fullmatch(r"[0-9A-Fa-f]{6}", text):
            return "#" + text.lower()
        return ""
    if isinstance(value, bool) or not isinstance(value, int):
        return ""
    if 0 <= value <= 0xFFFFFF:
        return "#%06x" % value
    return ""


def _reactions(message: dict) -> list:
    out = []
    for reaction in (message or {}).get("reactions") or []:
        if not isinstance(reaction, dict):
            continue
        emoji = reaction.get("emoji") if isinstance(reaction.get("emoji"), dict) else {}
        name = str(emoji.get("name") or "")
        if not name or len(name) > 64:
            continue
        try:
            count = int(reaction.get("count") or 0)
        except (TypeError, ValueError):
            continue
        if count <= 0:
            continue
        row = {"emoji": name, "count": count}
        eid = snowflake(emoji.get("id"))
        if eid:
            row["id"] = eid
            row["url"] = "https://cdn.discordapp.com/emojis/%s.%s" % (eid, "gif" if emoji.get("animated") else "png")
        out.append(row)
        if len(out) >= 20:
            break
    return out


def stub_message(message: dict, channel: dict, channel_names: dict | None = None, thread_parent: str = ""):
    """One row for the Messages file. Author details live in the file's authors map."""
    if not _user_message(message):
        return None
    message_id = snowflake(message.get("id"))
    author = message.get("author") if isinstance(message.get("author"), dict) else {}
    author_id = snowflake(author.get("id"))
    if not message_id or not author_id:
        return None
    text, links, emojis = render_content(message.get("content") or "", message, channel_names)
    media, file_links = attachment_parts(message)
    cards, card_links, card_emoji = embed_cards(message, channel_names)
    links = _dedupe_links(links + file_links + card_links)
    for item in media:
        url = item.get("url") or ""
        if url and url in text:
            text = text.replace(url, " ")
    text = clean_text(text)
    if not text and not media and not cards:
        return None
    row = {
        "id": message_id,
        "author": author_id,
        "text": text,
        "date": message_time(message),
    }
    reference = message.get("message_reference") if isinstance(message.get("message_reference"), dict) else {}
    parent = snowflake(reference.get("message_id"))
    if parent:
        row["reply"] = parent
        referenced = message.get("referenced_message") if isinstance(message.get("referenced_message"), dict) else {}
        ref_author = referenced.get("author") if isinstance(referenced.get("author"), dict) else {}
        snippet, _, _ = render_content(referenced.get("content") or "", referenced, channel_names)
        snippet = clean_text(snippet)[:180]
        ref_name = display_name(ref_author) if ref_author else ""
        if ref_name:
            row["replyAuthor"] = ref_name
        if snippet:
            row["replyText"] = snippet
    if thread_parent:
        row["thread"] = thread_parent
    if links:
        row["links"] = links
    if emojis or card_emoji:
        row["emojis"] = emojis + card_emoji
    if media:
        row["attachments"] = media
    if cards:
        row["cards"] = cards
    reactions = _reactions(message)
    if reactions:
        row["reactions"] = reactions
    if author.get("bot"):
        row["bot"] = True
    author_row = {
        "name": display_name(author) or author.get("username") or author_id,
        "handle": author.get("username") or author_id,
        "avatar": avatar_url(author),
    }
    member = message.get("member") if isinstance(message.get("member"), dict) else {}
    color = _hex_color(member.get("color")) or _hex_color(author.get("color")) or _hex_color(author.get("accent_color"))
    if color:
        author_row["color"] = color
    return row, author_id, author_row


class Client:
    """REST client. A bot sends ``Bot``. A user token is sent as itself.

    User calls stay on the read-only GET list and wait between requests.
    """

    def __init__(self, token: str, transport=None, sleep=None, page_size: int = 100, *, auth: str = "bot", min_interval: float | None = None, incremental: bool | None = None, clock=None):
        self.token = token
        self.transport = transport
        self.sleep = sleep or time.sleep
        self.clock = clock or time.monotonic
        self.auth_mode = "user" if auth == "user" else "bot"
        self._last_request = None
        self._skip_pace = False
        self.last_status = 0
        self._opener = urllib.request.build_opener(_NoRedirect)
        if self.auth_mode == "user":
            self.min_interval = USER_INTERVAL if min_interval is None else float(min_interval)
            self.incremental = True if incremental is None else bool(incremental)
            self.page_size = max(1, min(int(page_size or USER_PAGE_SIZE), USER_PAGE_SIZE))
            self.max_attempts = 2
        else:
            self.min_interval = 0.0 if min_interval is None else float(min_interval)
            self.incremental = False if incremental is None else bool(incremental)
            self.page_size = max(1, min(int(page_size or 100), 100))
            self.max_attempts = MAX_ATTEMPTS

    def channel_messages(self, channel_id: str, limit: int, after: str | None = None, before: str | None = None):
        params = {"limit": str(max(1, min(int(limit), 100)))}
        if after:
            params["after"] = str(after)
        elif before:
            params["before"] = str(before)
        data = self.get_json(f"/channels/{channel_id}/messages", params, auth=True)
        return data if isinstance(data, list) else None

    def get_json(self, path: str, params=None, auth: bool = True):
        url = path if path.startswith("http") else API + path
        if params:
            query = urllib.parse.urlencode([(key, value) for key, value in params.items() if value is not None and value != ""])
            if query:
                url += ("&" if "?" in url else "?") + query
        host = urllib.parse.urlparse(url).hostname or ""
        if host != "discord.com":
            print("[discord] refused a non-discord host")
            return None
        if self.auth_mode == "user" and auth and not user_get_allowed(url):
            print("[discord] refused a request outside the read-only user list")
            return None
        for attempt in range(self.max_attempts):
            try:
                status, headers, body = self._once(url, auth)
            except DiscordStop:
                raise
            except DiscordAuthError:
                raise
            except Exception as exc:
                print(f"[discord] {type(exc).__name__} talking to Discord")
                return None
            self.last_status = status
            block = account_block(status, body) if auth else ""
            if block in ("captcha", "verification"):
                raise DiscordStop(block)
            if self.auth_mode == "user" and status == 403 and quiet_channel(url):
                return None
            if self.auth_mode == "user" and status == 403 and pins_read(url):
                return None
            if self.auth_mode == "user" and status == 403 and channel_denied(status, body) and not guild_read(url):
                return None
            if self.auth_mode == "user" and block in ("unauthorized", "forbidden"):
                raise DiscordStop(block)
            if status == 401 and auth:
                raise DiscordAuthError("Discord rejected the bot token")
            if status == 429:
                delay = _retry_seconds(headers, body)
                if delay <= 0:
                    delay = 0.5
                if self.auth_mode == "user":
                    delay = max(delay, self.min_interval)
                print(f"[discord] rate limit; waiting {delay}s")
                self.sleep(delay)
                self._skip_pace = True
                if attempt + 1 >= self.max_attempts:
                    if self.auth_mode == "user":
                        raise DiscordStop("rate-limit")
                    return None
                continue
            if status == 200:
                self._pause_if_empty(headers)
                try:
                    return json.loads(body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body)
                except (UnicodeError, json.JSONDecodeError, AttributeError):
                    return None
            if status in (301, 302, 303, 307, 308):
                return None
            if status in (500, 502, 503, 504) and attempt + 1 < self.max_attempts:
                self.sleep(1)
                continue
            return None
        return None

    def _pause_if_empty(self, headers) -> None:
        remaining = _header(headers, "X-RateLimit-Remaining")
        reset = _header(headers, "X-RateLimit-Reset-After")
        if remaining is None or reset is None:
            return
        try:
            left = float(remaining)
            delay = float(reset)
        except (TypeError, ValueError):
            return
        if left <= 0 and delay > 0:
            if self.auth_mode == "user":
                delay = max(delay, self.min_interval)
            print(f"[discord] rate limit; waiting {delay}s")
            self.sleep(delay)
            self._skip_pace = True

    def _pace(self) -> None:
        if self._skip_pace:
            self._skip_pace = False
            self._last_request = self.clock()
            return
        if self.min_interval <= 0:
            return
        now = self.clock()
        if self._last_request is not None:
            wait = self.min_interval - (now - self._last_request)
            if wait > 0:
                self.sleep(wait)
                now = self.clock()
        self._last_request = now

    def _once(self, url: str, auth: bool):
        self._pace()
        headers = {"User-Agent": BROWSER_UA if self.auth_mode == "user" else USER_AGENT, "Accept": "application/json"}
        if auth:
            if not self.token:
                raise DiscordAuthError("Discord rejected the bot token")
            headers["Authorization"] = self.token if self.auth_mode == "user" else "Bot " + self.token
        if self.transport:
            status, resp_headers, body = self.transport(url, headers)
            if isinstance(body, str):
                body = body.encode("utf-8")
            return int(status), resp_headers or {}, body or b""
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with self._opener.open(request, timeout=30) as response:
                status = getattr(response, "status", 200)
                payload = response.read(2_000_000)
                return status, dict(response.headers), payload
        except urllib.error.HTTPError as exc:
            payload = exc.read(2_000_000) if exc.fp else b""
            return exc.code, dict(exc.headers or {}), payload


def _pin_stub(message: dict) -> dict | None:
    """A short pin row. The message body is not stored."""
    if not isinstance(message, dict):
        return None
    mid = snowflake(message.get("id"))
    if not mid:
        return None
    author = message.get("author") if isinstance(message.get("author"), dict) else {}
    name = display_name(author) or str(author.get("username") or "Someone")
    text = clean_text(str(message.get("content") or ""))
    text = re.sub(r"\s+", " ", text).strip()[:180]
    return {"id": mid, "author": name[:80], "text": text, "date": message_time(message)}


def fetch_pins(client: Client, channel_id: str):
    """One read of the channel's pins. None when Discord did not return a list."""
    data = client.get_json(f"/channels/{channel_id}/pins")
    if not isinstance(data, list):
        return None
    stubs = []
    for message in data[:50]:
        stub = _pin_stub(message)
        if stub:
            stubs.append(stub)
    stubs.sort(key=lambda row: int(row["id"]), reverse=True)
    return stubs


def _store_pins(reader, root: Path, channel_id: str, secrets, entry: dict, previous=None) -> None:
    """Fetch pins once. A forbidden read hides the icon and does not stop the sync."""
    stubs = fetch_pins(reader, channel_id)
    dest = root / "discord" / "pins" / f"{channel_id}.json"
    if stubs is None:
        if getattr(reader, "last_status", 0) == 403:
            entry["pinsForbidden"] = True
            _write_json(dest, {"channelId": channel_id, "forbidden": True, "pins": []}, secrets)
            return
        if isinstance(previous, dict) and (previous.get("pins") or previous.get("forbidden")):
            _write_json(dest, previous, secrets)
        return
    entry.pop("pinsForbidden", None)
    _write_json(
        dest,
        {"channelId": channel_id, "forbidden": False, "pins": stubs},
        secrets,
    )


def fetch_messages(client: Client, channel_id: str, cap: int, cursor: str | None = None):
    """The newest page, then ``after`` pages from the stored snowflake.

    With no cursor, ``before`` pages walk backward until ``cap`` messages are
    in hand. That is the first history for a channel. Returns None when
    Discord did not answer, so the previous file can stay.
    """
    cap = max(1, min(int(cap), 100))
    page_size = client.page_size
    found = {}
    readable = False

    def take(batch):
        nonlocal readable
        if not isinstance(batch, list):
            return None
        readable = True
        newest = None
        oldest = None
        for message in batch:
            if not isinstance(message, dict):
                continue
            mid = snowflake(message.get("id"))
            if not mid:
                continue
            found[mid] = message
            if newest is None or int(mid) > int(newest):
                newest = mid
            if oldest is None or int(mid) < int(oldest):
                oldest = mid
        return newest, oldest, len(batch)

    have_cursor = bool(cursor and snowflake(cursor))
    # A user-token sync does not re-read the newest page once a cursor exists.
    if not (client.incremental and have_cursor):
        first = min(cap, page_size)
        got = take(client.channel_messages(channel_id, first))
        if got and not have_cursor:
            _newest, oldest, size = got
            guard = 0
            while oldest and len(found) < cap and size >= first and guard < PAGE_GUARD:
                guard += 1
                want = min(page_size, cap - len(found))
                if want <= 0:
                    break
                before_id = oldest
                before_count = len(found)
                got = take(client.channel_messages(channel_id, want, before=oldest))
                if got is None:
                    break
                _newest, oldest, size = got
                if len(found) == before_count or not oldest or int(oldest) >= int(before_id):
                    break
                first = want
                if size < want:
                    break
    if have_cursor:
        after = str(cursor)
        gained = 0
        limit = min(page_size, 100)
        for _ in range(PAGE_GUARD):
            if gained >= cap:
                break
            batch = client.channel_messages(channel_id, limit, after=after)
            got = take(batch)
            if got is None:
                break
            newest, _oldest, size = got
            if newest is None or int(newest) <= int(after):
                break
            fresh = 0
            for message in batch or []:
                mid = snowflake((message or {}).get("id") if isinstance(message, dict) else None)
                if mid and int(mid) > int(after):
                    fresh += 1
            if fresh == 0:
                break
            gained += fresh
            after = newest
            if size < limit:
                break
    if not readable:
        return None
    return sorted(found.values(), key=lambda message: int(message["id"]), reverse=True)[:cap]


def configured_servers(config: dict) -> list:
    rows = config.get("discord") if isinstance(config, dict) else None
    if not isinstance(rows, list):
        return []
    servers = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        guild = snowflake(row.get("id") if row.get("id") is not None else row.get("guild"))
        if not guild:
            continue
        channels = []
        for channel in row.get("channels") or []:
            if not isinstance(channel, dict):
                continue
            cid = snowflake(channel.get("id"))
            mode = str(channel.get("mode") or "").strip().lower()
            if not cid or mode not in ("posts", "messages"):
                continue
            try:
                limit = int(channel.get("limit") or (30 if mode == "posts" else 40))
            except (TypeError, ValueError):
                limit = 30
            limit = max(1, min(limit, 100))
            raw_window = channel.get("window")
            if raw_window is None or raw_window == "":
                window = limit
            else:
                try:
                    window = int(raw_window)
                except (TypeError, ValueError):
                    window = limit
                window = max(limit, min(window, 500))
            channels.append(
                {
                    "id": cid,
                    "name": str(channel.get("name") or "").strip(),
                    "category": str(channel.get("category") or "").strip(),
                    "mode": mode,
                    "limit": limit,
                    "window": window,
                }
            )
        if not channels:
            continue
        auth = str(row.get("auth") or "bot").strip().lower()
        if auth != "user":
            auth = "bot"
        servers.append(
            {
                "id": guild,
                "name": str(row.get("name") or "").strip(),
                "invite": invite_code(row.get("invite") or ""),
                "auth": auth,
                "channels": channels,
            }
        )
    return servers


def _load_json(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return data


def _secret_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        found = []
        for item in value:
            for secret in _secret_list(item):
                if secret not in found:
                    found.append(secret)
        return found
    text = str(value).strip()
    return [text] if text else []


def _write_json(path: Path, payload, token) -> None:
    secrets = []
    for secret in _secret_list(token) + known_secrets():
        if secret not in secrets:
            secrets.append(secret)
    safe = payload
    for secret in secrets:
        safe = _redact(safe, secret)
    text = json.dumps(safe, ensure_ascii=False, indent=2) + "\n"
    if any(secret in text for secret in secrets):
        raise RuntimeError("refusing to write Discord output that contains a Discord token")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def published_json(path: str):
    """A Discord file from the live site. No bot token is sent."""
    if not PUBLISHED.match(path or ""):
        return None
    request = urllib.request.Request(SITE + path, headers={"User-Agent": SITE_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if getattr(response, "status", 200) != 200:
                return None
            data = json.loads(response.read(1_000_000).decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _mirror_published(root: Path, fetch, token: str) -> None:
    if fetch is None:
        return
    index = fetch("discord/index.json")
    if not isinstance(index, dict):
        return
    dest = root / "discord"
    if not (dest / "index.json").exists():
        _write_json(dest / "index.json", index, token)
    state = fetch("discord/state.json")
    if isinstance(state, dict) and not (dest / "state.json").exists():
        _write_json(dest / "state.json", state, token)
    for server in index.get("servers") or []:
        if not isinstance(server, dict):
            continue
        for channel in server.get("channels") or []:
            if not isinstance(channel, dict):
                continue
            rel = str(channel.get("file") or "")
            name = rel.rsplit("/", 1)[-1]
            if not name.endswith(".json"):
                continue
            cid = name[: -len(".json")]
            if not snowflake(cid):
                continue
            target = dest / "messages" / name
            if target.exists():
                continue
            body = fetch(f"discord/messages/{name}")
            if isinstance(body, dict):
                _write_json(target, body, token)


def _load_state(root: Path) -> dict:
    data = _load_json(root / "discord" / "state.json")
    channels = data.get("channels") if isinstance(data, dict) else None
    if not isinstance(channels, dict):
        channels = {}
    clean = {}
    for key, value in channels.items():
        if snowflake(key) and snowflake(value):
            clean[str(key)] = str(value)
    return {"channels": clean}


def _flatten(posts) -> list:
    rows = []
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        rows.append(post)
        rows.extend(_flatten(post.get("replies") or []))
    return rows


def _cursor(state: dict, channel_id: str, previous_messages: list, previous_posts: list) -> str:
    ids = []
    stored = (state.get("channels") or {}).get(channel_id)
    if snowflake(stored):
        ids.append(int(stored))
    for message in previous_messages or []:
        if isinstance(message, dict) and snowflake(message.get("id")):
            ids.append(int(message["id"]))
    prefix = f"discord:{channel_id}:"
    for post in previous_posts or []:
        raw = str((post or {}).get("id") or "")
        if raw.startswith(prefix) and snowflake(raw[len(prefix) :]):
            ids.append(int(raw[len(prefix) :]))
    return str(max(ids)) if ids else ""


def _lock_tree(posts: list, previous: dict) -> None:
    for post in posts or []:
        if not isinstance(post, dict):
            continue
        from .common import lock_publish_time

        lock_publish_time(previous.get(str(post.get("id") or "")), post)
        _lock_tree(post.get("replies") or [], previous)


def _channel_names(server: dict) -> dict:
    return {channel["id"]: channel["name"] for channel in server["channels"] if channel.get("name")}


def _thread_messages(client: Client, messages: list) -> list:
    fetched = 0
    extras = []
    seen = set()
    for message in messages:
        if fetched >= THREAD_CAP or not isinstance(message, dict):
            continue
        thread = message.get("thread") if isinstance(message.get("thread"), dict) else {}
        thread_id = snowflake(thread.get("id"))
        starter = snowflake(message.get("id"))
        if not thread_id or thread_id in seen:
            continue
        seen.add(thread_id)
        batch = client.channel_messages(thread_id, THREAD_LIMIT)
        fetched += 1
        if not isinstance(batch, list):
            continue
        for child in batch:
            if isinstance(child, dict) and snowflake(child.get("id")) and snowflake(child.get("id")) != starter:
                child = dict(child)
                child["_threadParent"] = starter
                extras.append(child)
    return extras


def _sync_posts(client, server, channel, names, messages, feed):
    posts = []
    for message in messages:
        post = normalize_message(message, feed, channel, names)
        if post:
            posts.append(post)
    extras = []
    for message in _thread_messages(client, messages):
        post = normalize_message(message, feed, channel, names)
        if not post:
            continue
        post["_threadParent"] = snowflake(message.get("_threadParent"))
        extras.append(post)
    known = {post["id"] for post in posts + extras}
    for post in extras:
        parent = post.pop("_threadParent", "")
        target = post.get("replyingTo") if isinstance(post.get("replyingTo"), dict) else {}
        if parent and str(target.get("id") or "") not in known:
            post["kind"] = "reply"
            post["replyingTo"] = {"id": post_id(channel["id"], parent)}
        posts.append(post)
    return nest_replies(posts)


def _sync_transcript(client, server, channel, names, messages, previous: dict):
    rows = {}
    authors = dict(previous.get("authors") or {}) if isinstance(previous.get("authors"), dict) else {}
    for message in list(previous.get("messages") or []):
        if isinstance(message, dict) and snowflake(message.get("id")):
            rows[str(message["id"])] = message
    incoming = list(messages) + _thread_messages(client, messages)
    for message in incoming:
        parsed = stub_message(message, channel, names, thread_parent=snowflake(message.get("_threadParent")))
        if not parsed:
            continue
        row, author_id, author = parsed
        old = rows.get(row["id"]) or {}
        if old.get("date") and not row.get("date"):
            row["date"] = old["date"]
        rows[row["id"]] = row
        if author_id:
            authors[author_id] = author
    keep = int(channel.get("window") or channel["limit"])
    kept = sorted(rows.values(), key=lambda row: int(row["id"]), reverse=True)[:keep]
    used = {row.get("author") for row in kept}
    authors = {key: value for key, value in authors.items() if key in used and isinstance(value, dict)}
    return kept, authors


def _apply_posts(doc: dict, posts: list, previous_posts: list, feed_ids: set, cap: int) -> None:
    fresh_ids = {str(post.get("id") or "") for post in _flatten(posts)}
    previous = {str(post.get("id") or ""): post for post in _flatten(previous_posts or []) if isinstance(post, dict) and post.get("platform") == "discord"}
    _lock_tree(posts, previous)
    remaining = []
    have = set(fresh_ids)
    for post in doc.get("posts") or []:
        pid = str(post.get("id") or "")
        if pid in fresh_ids:
            continue
        remaining.append(post)
        have.add(pid)
    for post in previous_posts or []:
        if not isinstance(post, dict) or post.get("platform") != "discord":
            continue
        if feed_ids and post.get("feedId") not in feed_ids:
            continue
        pid = str(post.get("id") or "")
        if not pid or pid in have:
            continue
        remaining.append(post)
        have.add(pid)
    doc["posts"] = dedupe_posts(list(posts) + remaining, cap=cap)


def _restore(doc: dict, previous_posts: list, feed_ids: set, cap: int) -> int:
    have = {str(post.get("id") or "") for post in doc.get("posts") or []}
    extra = []
    for post in previous_posts or []:
        if not isinstance(post, dict) or post.get("platform") != "discord":
            continue
        if feed_ids and post.get("feedId") not in feed_ids:
            continue
        if str(post.get("id") or "") in have:
            continue
        extra.append(post)
        have.add(str(post.get("id") or ""))
    if not extra:
        return 0
    doc["posts"] = dedupe_posts(list(doc.get("posts") or []) + extra, cap=cap)
    return len(extra)


def _iso_now(now) -> str:
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


ACCOUNT_REASONS = ("unauthorized", "forbidden", "captcha", "verification")


def _mark_quiet(servers) -> list:
    marked = []
    for server in servers or []:
        if not isinstance(server, dict):
            continue
        channels = []
        for channel in server.get("channels") or []:
            if not isinstance(channel, dict):
                continue
            row = dict(channel)
            if str(row.get("id") or "") in QUIET_CHANNELS:
                row["inaccessible"] = True
            channels.append(row)
        copy = dict(server)
        copy["channels"] = channels
        marked.append(copy)
    return marked


def _configured_index(servers) -> list:
    rows = []
    for server in servers or []:
        channels = []
        for channel in server.get("channels") or []:
            entry = {"id": channel["id"], "mode": channel["mode"]}
            if channel.get("name"):
                entry["name"] = channel["name"]
            if channel.get("category"):
                entry["category"] = channel["category"]
            if channel["mode"] == "messages":
                entry["file"] = f"discord/messages/{channel['id']}.json"
            channels.append(entry)
        rows.append(
            {
                "id": server["id"],
                "name": server.get("name") or server["id"],
                "handle": server["id"],
                "auth": server.get("auth") or "",
                "channels": channels,
            }
        )
    return rows


def _write_paused_index(root: Path, stopped: DiscordStop, index_servers, configured, secrets, now) -> None:
    """Publish a paused index. The detail is a fixed sentence, never a response body."""
    servers = index_servers
    if not servers:
        previous = _load_json(root / "discord" / "index.json")
        if isinstance(previous, dict) and isinstance(previous.get("servers"), list) and previous["servers"]:
            servers = previous["servers"]
        else:
            servers = _configured_index(configured)
    reason = stopped.reason if stopped.reason in ACCOUNT_REASONS or stopped.reason == "rate-limit" else "forbidden"
    payload = {
        "fetchedAt": _iso_now(now),
        "status": reason,
        "detail": DiscordStop(stopped.reason).text,
        "servers": _mark_quiet(servers),
    }
    _write_json(root / "discord" / "index.json", payload, secrets)


def _note_health(doc: dict, ok: bool, detail: str, now) -> None:
    health = doc.get("sourceHealth")
    if not isinstance(health, dict):
        health = {}
        doc["sourceHealth"] = health
    from sync_health import record_source

    record_source(health, "discord", ok, _iso_now(now), detail)


def _clear_health(doc: dict) -> None:
    health = doc.get("sourceHealth")
    if isinstance(health, dict):
        health.pop("discord", None)


def merge_discord(doc: dict, config: dict, root: Path, previous_posts=None, *, token: str | None = None, user_token: str | None = None, transport=None, sleep=None, page_size: int = 100, remote: bool = True, fetch_published=None, now=None, clock=None) -> dict:
    """Merge Discord posts into ``doc`` and write message files under ``root``.

    An empty ``discord`` list does nothing. A missing token keeps the previous
    posts. A user-token 401, captcha, or verification challenge stops the run
    and records that on the sync health row. A 403 on one channel skips that
    channel only.
    """
    doc.setdefault("posts", [])
    doc.setdefault("feeds", [])
    servers = configured_servers(config)
    if not servers:
        _clear_health(doc)
        return {"skipped": True, "reason": "unconfigured", "posts": [], "profiles": []}
    if token is None:
        token = os.environ.get("DISCORD_BOT_TOKEN") or ""
    token = token.strip()
    if user_token is None:
        user_token = os.environ.get("DISCORD_USER_TOKEN") or ""
    user_token = user_token.strip()
    secrets = [item for item in (token, user_token) if item]
    needs_user = any(server["auth"] == "user" for server in servers)
    if fetch_published is None and remote:
        fetch_published = published_json
    if not remote:
        fetch_published = None
    cap = int(config.get("cap") or 300)
    feed_ids = {f"discord:{server['id']}" for server in servers}

    def give_up(reason: str, line: str, note: str = "") -> dict:
        print(line)
        try:
            _mirror_published(root, fetch_published, secrets)
        except Exception as exc:
            print(public_error(exc))
        kept = _restore(doc, previous_posts, feed_ids, cap)
        if kept:
            print(f"[discord] kept {kept} posts")
        if note:
            _note_health(doc, False, note, now)
        return {"skipped": True, "reason": reason, "posts": [], "profiles": []}

    if not token and (not user_token or not needs_user):
        if needs_user and not user_token:
            print("[discord] DISCORD_USER_TOKEN is not set; skipping Discord")
        return give_up("no-token", "[discord] DISCORD_BOT_TOKEN is not set; skipping Discord")

    bot = None
    if token:
        bot = Client(token, transport=transport, sleep=sleep, page_size=page_size, clock=clock)
        try:
            me = bot.get_json("/users/@me")
        except DiscordAuthError:
            bot = None
            if not user_token or not needs_user:
                return give_up(
                    "rejected",
                    "[discord] Discord rejected the bot token; skipping Discord",
                    "Discord rejected the bot token. Discord sync stopped for this run and will not retry.",
                )
            print("[discord] Discord rejected the bot token; the bot will not be used")
        else:
            if not isinstance(me, dict) or not me.get("username"):
                bot = None
                if not user_token or not needs_user:
                    return give_up("unreachable", "[discord] could not read the bot user; skipping Discord")
                print("[discord] could not read the bot user; the bot will not be used")
            else:
                print("[discord] bot " + str(me.get("username")))
    user = None
    if user_token and needs_user:
        user = Client(user_token, transport=transport, sleep=sleep, page_size=USER_PAGE_SIZE, auth="user", clock=clock)
    elif needs_user:
        print("[discord] DISCORD_USER_TOKEN is not set; user-auth servers will be skipped")

    state = _load_state(root)
    if not state["channels"] and fetch_published:
        remote_state = fetch_published("discord/state.json")
        if isinstance(remote_state, dict):
            remote_channels = remote_state.get("channels") if isinstance(remote_state.get("channels"), dict) else {}
            for key, value in remote_channels.items():
                if snowflake(key) and snowflake(value):
                    state["channels"][str(key)] = str(value)

    flat_previous = _flatten(previous_posts or [])
    all_posts = []
    profiles = []
    index_servers = []
    try:
        for server in servers:
            names = _channel_names(server)
            public = bot or user
            if public is None:
                print(f"[discord] server {server['id']}: no token for this server")
                continue
            widget = public.get_json(f"https://discord.com/api/guilds/{server['id']}/widget.json", auth=False)
            code = server["invite"] or invite_code((widget or {}).get("instant_invite") if isinstance(widget, dict) else "")
            invite = public.get_json(f"/invites/{code}", {"with_counts": "true"}, auth=False) if code else None
            guild = _server_guild(server, bot, user)
            profile = build_profile(server["id"], server["name"], widget, invite, guild)
            feed = {"id": profile["id"], "guildId": server["id"], "handle": server["id"]}
            server_posts = []
            index_channels = []
            for channel in server["channels"]:
                previous_file = {}
                previous_pins = None
                if channel["mode"] == "messages":
                    previous_file = _load_json(root / "discord" / "messages" / f"{channel['id']}.json") or {}
                    if not previous_file and fetch_published:
                        remote_file = fetch_published(f"discord/messages/{channel['id']}.json")
                        if isinstance(remote_file, dict):
                            previous_file = remote_file
                    previous_pins = _load_json(root / "discord" / "pins" / f"{channel['id']}.json")
                    if not isinstance(previous_pins, dict) and fetch_published:
                        remote_pins = fetch_published(f"discord/pins/{channel['id']}.json")
                        if isinstance(remote_pins, dict):
                            previous_pins = remote_pins
                reader, probed = _channel_reader(server, channel, bot, user)
                if probed and not channel["name"] and probed.get("name"):
                    channel["name"] = str(probed["name"])
                    names[channel["id"]] = channel["name"]
                elif reader is not None and not channel["name"]:
                    info = reader.get_json(f"/channels/{channel['id']}")
                    if isinstance(info, dict) and info.get("name"):
                        channel["name"] = str(info["name"])
                        names[channel["id"]] = channel["name"]
                entry = {"id": channel["id"], "mode": channel["mode"]}
                if channel["name"]:
                    entry["name"] = channel["name"]
                if channel.get("category"):
                    entry["category"] = channel["category"]
                if channel["mode"] == "messages":
                    entry["file"] = f"discord/messages/{channel['id']}.json"
                if reader is None:
                    if previous_file:
                        _write_json(root / "discord" / "messages" / f"{channel['id']}.json", previous_file, secrets)
                    if server["auth"] == "user" and user is None:
                        print(f"[discord] channel {channel['id']}: DISCORD_USER_TOKEN is not set")
                    else:
                        print(f"[discord] channel {channel['id']}: not readable")
                    entry["inaccessible"] = True
                    index_channels.append(entry)
                    continue
                cursor = _cursor(
                    state,
                    channel["id"],
                    previous_file.get("messages") if isinstance(previous_file, dict) else [],
                    [post for post in flat_previous if post.get("feedId") == feed["id"]],
                )
                try:
                    messages = fetch_messages(reader, channel["id"], channel["limit"], cursor or None)
                except DiscordAuthError:
                    print("[discord] Discord rejected the bot token; skipping Discord")
                    _restore(doc, previous_posts, feed_ids, cap)
                    _note_health(doc, False, "Discord rejected the bot token. Discord sync stopped for this run and will not retry.", now)
                    return {"skipped": True, "reason": "rejected", "posts": [], "profiles": []}
                except DiscordStop:
                    raise
                except Exception as exc:
                    print(public_error(exc))
                    messages = None
                if messages is None:
                    entry["inaccessible"] = True
                if channel["mode"] == "messages":
                    if messages is None:
                        if previous_file:
                            _write_json(root / "discord" / "messages" / f"{channel['id']}.json", previous_file, secrets)
                        print(f"[discord] channel {channel['id']}: not readable")
                    else:
                        kept, authors = _sync_transcript(reader, server, channel, names, messages, previous_file if isinstance(previous_file, dict) else {})
                        payload = {
                            "platform": "discord",
                            "guildId": server["id"],
                            "channelId": channel["id"],
                            "name": channel["name"],
                            "fetchedAt": _iso_now(now),
                            "authors": authors,
                            "messages": kept,
                        }
                        _write_json(root / "discord" / "messages" / f"{channel['id']}.json", payload, secrets)
                        print(f"[discord] {server['name'] or server['id']} #{channel['name'] or channel['id']}: {len(kept)} messages")
                        if messages:
                            state["channels"][channel["id"]] = str(messages[0]["id"])
                        _store_pins(reader, root, channel["id"], secrets, entry, previous_pins)
                else:
                    if messages is None:
                        print(f"[discord] channel {channel['id']}: not readable")
                    else:
                        built = _sync_posts(reader, server, channel, names, messages, feed)
                        server_posts.extend(built)
                        print(f"[discord] {server['name'] or server['id']} #{channel['name'] or channel['id']}: {len(built)} posts")
                        if messages:
                            state["channels"][channel["id"]] = str(max(int(message["id"]) for message in messages))
                index_channels.append(entry)
            if server_posts:
                profile["postsCount"] = len(server_posts)
            for secret in secrets:
                server_posts = _redact(server_posts, secret)
                profile = _redact(profile, secret)
            profiles.append(profile)
            all_posts.extend(server_posts)
            index_servers.append(
                drop_empty(
                    {
                        "id": server["id"],
                        "name": profile.get("name") or server["name"] or server["id"],
                        "handle": server["id"],
                        "auth": server["auth"],
                        "icon": profile.get("avatar") or "",
                        "members": profile.get("followers"),
                        "online": profile.get("online"),
                        "invite": profile.get("url") if "discord.gg/" in (profile.get("url") or "") else "",
                        "url": profile.get("url") or "",
                        "channels": index_channels,
                    }
                )
            )
    except DiscordStop as stopped:
        print("[discord] " + stopped.text)
        _note_health(doc, False, stopped.text, now)
        _write_paused_index(root, stopped, index_servers, servers, secrets, now)
        _apply_posts(doc, all_posts, previous_posts or [], feed_ids, cap)
        if profiles:
            doc["feeds"] = merge_profiles(doc.get("feeds") or [], profiles)
        try:
            _mirror_published(root, fetch_published, secrets)
        except Exception as exc:
            print(public_error(exc))
        return {"skipped": True, "reason": stopped.reason, "stopped": True, "posts": all_posts, "profiles": profiles}
    _apply_posts(doc, all_posts, previous_posts or [], feed_ids, cap)
    doc["feeds"] = merge_profiles(doc.get("feeds") or [], profiles)
    fetched = _iso_now(now)
    _write_json(root / "discord" / "index.json", {"fetchedAt": fetched, "servers": index_servers}, secrets)
    _write_json(root / "discord" / "state.json", state, secrets)
    _note_health(doc, True, "", now)
    return {"skipped": False, "reason": "", "posts": all_posts, "profiles": profiles}


def _server_guild(server: dict, bot, user):
    """Guild header. The bot result wins when the bot can see the server."""
    params = {"with_counts": "true"}
    path = f"/guilds/{server['id']}"
    if server["auth"] != "user":
        return bot.get_json(path, params, auth=True) if bot is not None else None
    if bot is not None:
        try:
            guild = bot.get_json(path, params, auth=True)
        except DiscordAuthError:
            guild = None
        if isinstance(guild, dict) and snowflake(guild.get("id")):
            return guild
    if user is None:
        return None
    return user.get_json(path, params, auth=True)


def _channel_reader(server: dict, channel: dict, bot, user):
    """The bot reads a user-auth channel when that bot can already see it."""
    if server["auth"] != "user":
        return bot, None
    if bot is not None:
        try:
            probed = bot.get_json(f"/channels/{channel['id']}")
        except DiscordAuthError:
            probed = None
        else:
            if isinstance(probed, dict) and snowflake(probed.get("id")) == channel["id"]:
                return bot, probed
    return user, None
