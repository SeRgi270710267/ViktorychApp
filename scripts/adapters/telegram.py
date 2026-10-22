"""Normalize a public Telegram channel preview into the shared post shape.

The live page is https://t.me/s/<channel>. No login and no bot token. The
self-hosted RSSHub /telegram/channel/<name> feed is the same parser's backup:
when the payload is RSS, each item is read as a widget fragment.
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlparse

import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parents[1]
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
from site_paths import user_agent  # noqa: E402

from .common import clean_text, is_playable_video, parse_xml, post_shell, profile_url, to_iso

HANDLE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
UA = user_agent()
_COUNT = re.compile(r"^([\d]+(?:[.,]\d+)?)\s*([KMB])?$", re.I)
_CSS_URL = re.compile(r"""background-image:\s*url\(\s*(['"]?)(.*?)\1\s*\)""", re.I)
_BEFORE = re.compile(r'data-before="(\d+)"')
_POST_ID = re.compile(r'data-post="([A-Za-z0-9_]+)/(\d+)"')


def parse_count(value: str):
    raw = (value or "").replace("\xa0", " ").replace(",", "").strip()
    match = _COUNT.match(raw)
    if not match:
        return None
    number = float(match.group(1).replace(",", "."))
    suffix = (match.group(2) or "").upper()
    scale = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[suffix]
    return int(number * scale)


def _abs_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw or raw.startswith("data:"):
        return ""
    if raw.startswith("//"):
        raw = "https:" + raw
    if raw.startswith("http://"):
        host = (urlparse(raw).hostname or "").lower()
        if host.endswith("telesco.pe") or host.endswith("telegram.org") or "t.me" in host:
            raw = "https://" + raw[len("http://") :]
    if not raw.startswith("https://"):
        return ""
    return raw


def _css_url(style: str) -> str:
    match = _CSS_URL.search(style or "")
    return _abs_url(match.group(2)) if match else ""


def _attr(text: str, name: str) -> str:
    match = re.search(rf"""\b{name}\s*=\s*(['"])(.*?)\1""", text or "", re.I | re.S)
    return match.group(2) if match else ""


def _duration(label: str):
    parts = [int(part) for part in re.findall(r"\d+", label or "")[:3]]
    if not parts:
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + part
    return seconds or None


def _example_host(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "example.com" or host.endswith(".example") or host.endswith(".invalid")


def keep_playable(url: str, probe) -> str:
    """Keep a direct file only when it looks playable and the probe agrees."""
    if not url or not is_playable_video(url):
        return ""
    if probe is None:
        return url
    try:
        result = probe(url)
    except Exception:
        return ""
    ok = bool(result[0]) if isinstance(result, tuple) else bool(result)
    return url if ok else ""


def _probe_for(feed: dict, url: str):
    custom = feed.get("_probe") if isinstance(feed, dict) else None
    if callable(custom):
        return custom
    if not url or _example_host(url):
        return None
    from video_media import probe

    return probe


def banner_color(colors: str) -> str:
    stops = []
    for raw in (colors or "").split(","):
        piece = raw.strip()
        if re.fullmatch(r"[0-9a-fA-F]{6}", piece):
            stops.append("#" + piece.lower())
    if not stops:
        return ""
    if len(stops) == 1:
        return stops[0]
    picked = stops[:4]
    rendered = []
    last = len(picked) - 1
    for index, color in enumerate(picked):
        rendered.append(f"{color} {round(index * 100 / last)}%")
    return "linear-gradient(135deg, " + ", ".join(rendered) + ")"


def _http_get(url: str, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html, */*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def discussion_open(handle: str, message_id: str) -> bool | None:
    """True when the public comments widget has a discussion. None if it could not be checked."""
    url = f"https://t.me/{handle}/{message_id}?embed=1&discussion=1"
    try:
        html = _http_get(url, timeout=20)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if "Discussion is not available" in html:
        return False
    if "tgme_widget_message_text" in html or "tgme_widget_message_author" in html:
        return True
    if "No comments" in html or "no comments" in html.lower():
        return True
    return False


def fetch_channel(handle: str, limit: int = 8, backfill: bool = False, get=None) -> str:
    """Download the public preview. The first follow walks ?before= until the window is full."""
    name = (handle or "").lstrip("@")
    if not HANDLE.match(name):
        raise ValueError("that Telegram username is not public")
    getter = get or _http_get
    pages = []
    before = ""
    seen: set[str] = set()
    cap = max(1, int(limit or 8))
    for _ in range(8 if backfill else 1):
        url = f"https://t.me/s/{name}" + (f"?before={before}" if before else "")
        html = getter(url)
        pages.append(html)
        ids = [post_id for _channel, post_id in _POST_ID.findall(html)]
        seen.update(ids)
        if not backfill or len(seen) >= cap:
            break
        nxt = _BEFORE.search(html)
        if not nxt or nxt.group(1) == before or not ids:
            break
        before = nxt.group(1)
    html = "\n".join(pages)
    if get is None and seen:
        newest = max(seen, key=lambda item: int(item))
        flag = discussion_open(name, newest)
        if flag is True:
            html += '\n<div id="feeds-discussion" data-on="1"></div>'
        elif flag is False:
            html += '\n<div id="feeds-discussion" data-on="0"></div>'
    return html


def _strip(html: str) -> str:
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html or "", flags=re.I | re.S)
    html = re.sub(r"<svg\b[^>]*>.*?</svg>", "", html, flags=re.I | re.S)
    return html


def _inner(html: str, marker: str) -> str:
    match = re.search(rf'<div[^>]*class="[^"]*\b{re.escape(marker)}\b[^"]*"[^>]*>', html or "", re.I)
    if not match:
        return ""
    start = match.end()
    depth = 1
    index = start
    while index < len(html) and depth:
        nxt = html.find("<", index)
        if nxt < 0:
            break
        if html.startswith("</div", nxt):
            depth -= 1
            if depth == 0:
                return html[start:nxt]
            index = html.find(">", nxt) + 1
        elif re.match(r"<div\b", html[nxt:nxt + 5], re.I):
            depth += 1
            index = html.find(">", nxt) + 1
        else:
            index = nxt + 1
    return html[start:]


def _tagged_text(html: str, marker: str) -> str:
    """Text inside the first element that carries this class, whatever the tag."""
    match = re.search(
        rf'<(?:div|span|a|i|b)\b[^>]*class="[^"]*\b{re.escape(marker)}\b[^"]*"[^>]*>([\s\S]*?)</(?:div|span|a|i|b)>',
        html or "",
        re.I,
    )
    if match:
        return _textish(match.group(1))
    return _textish(_inner(html, marker))


def _textish(html: str) -> str:
    plain = re.sub(r"<br\s*/?>", "\n", html or "", flags=re.I)
    plain = re.sub(r"<[^>]+>", "", plain)
    return clean_text(plain.replace("\xa0", " "))


class _Rich(HTMLParser):
    """Whitelist the formatting Telegram puts in a message."""

    def __init__(self, channel: str):
        super().__init__(convert_charrefs=True)
        self.channel = channel
        self.parts: list[str] = []
        self.plain: list[str] = []
        self.links: list[dict] = []
        self._skip = 0
        self._emoji = 0
        self._link = None

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attr = {key.lower(): value or "" for key, value in attrs}
        classes = set((attr.get("class") or "").split())
        if tag in ("script", "style"):
            self._skip += 1
            return
        if self._skip:
            return
        if self._emoji and tag != "i":
            return
        if tag == "br":
            self.parts.append("<br>")
            self.plain.append("\n")
        elif tag in ("b", "strong"):
            self.parts.append("<b>")
        elif tag in ("i", "em") and "emoji" not in classes:
            self.parts.append("<i>")
        elif tag == "u":
            self.parts.append("<u>")
        elif tag in ("s", "strike", "del"):
            self.parts.append("<s>")
        elif tag == "code":
            self.parts.append("<code>")
        elif tag == "pre":
            self.parts.append("<pre>")
        elif tag == "blockquote":
            self.parts.append("<blockquote>")
        elif tag in ("tg-spoiler",) or "tg-spoiler" in classes:
            self.parts.append('<span class="tg-spoiler" data-act="spoiler" role="button" tabindex="0">')
        elif tag == "a":
            href = self._href(attr.get("href") or "")
            if href:
                self._link = href
                self.parts.append(
                    f'<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="{_esc(href)}">'
                )
        elif tag == "i" and "emoji" in classes:
            src = _css_url(attr.get("style") or "")
            if src:
                self.parts.append(f'<img class="tg-emoji" alt="" src="{_esc(src)}">')
            self._emoji += 1

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
            return
        if self._skip:
            return
        if self._emoji and tag != "i":
            return
        closing = {
            "b": "</b>",
            "strong": "</b>",
            "i": "</i>",
            "em": "</i>",
            "u": "</u>",
            "s": "</s>",
            "strike": "</s>",
            "del": "</s>",
            "code": "</code>",
            "pre": "</pre>",
            "blockquote": "</blockquote>",
            "tg-spoiler": "</span>",
        }
        if tag == "a" and self._link:
            self.parts.append("</a>")
            self._link = None
        elif tag == "span":
            # Spoilers are the only span we open.
            if self.parts and 'class="tg-spoiler"' in self.parts[-1]:
                return
            if any('class="tg-spoiler"' in part for part in self.parts):
                self.parts.append("</span>")
        elif tag in closing and tag != "i":
            self.parts.append(closing[tag])
        elif tag == "i":
            if self._emoji:
                self._emoji -= 1
                return
            self.parts.append("</i>")

    def handle_data(self, data):
        if self._skip or not data:
            return
        self.plain.append(data)
        if self._emoji:
            return
        self.parts.append(_esc(data))
        if self._link and data.strip():
            self.links.append({"expanded": self._link, "display": data.strip(), "anchorText": data.strip()})

    def _href(self, href: str) -> str:
        raw = (href or "").strip()
        if raw.startswith("tg://resolve"):
            domain = re.search(r"domain=([A-Za-z0-9_]+)", raw)
            return f"https://t.me/{domain.group(1)}" if domain else ""
        if raw.startswith("//"):
            raw = "https:" + raw
        if raw.startswith("http://"):
            raw = "https://" + raw[len("http://") :]
        if not raw.startswith("https://"):
            return ""
        return raw


def _esc(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def rich_html(fragment: str, channel: str) -> tuple[str, str, list]:
    parser = _Rich(channel)
    try:
        parser.feed(fragment or "")
        parser.close()
    except Exception:
        text = _textish(fragment)
        return text, "", []
    text = clean_text("".join(parser.plain).replace("\xa0", " "))
    html = _link_hashtags("".join(parser.parts).strip(), channel)
    if not re.search(r"<(?:b|i|u|s|code|pre|a|img|span|blockquote|br)\b", html):
        html = ""
    return text, html, parser.links


def _link_hashtags(html: str, channel: str) -> str:
    def repl(match: re.Match) -> str:
        tag = match.group(1)
        href = f"https://t.me/s/{channel}?q=%23{tag}" if channel else ""
        if not href:
            return match.group(0)
        return (
            f'<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="{_esc(href)}">'
            f"#{_esc(tag)}</a>"
        )

    return re.sub(r"(?<![\w#/])#([\w]{1,50})", repl, html or "")


def _channel_banner(head: str) -> str:
    for marker in ("tgme_channel_cover", "tgme_channel_banner", "tgme_page_banner"):
        block = _inner(head, marker) or ""
        found = _css_url(block) or _abs_url(_attr(block, "src"))
        if found:
            return found
        nearby = re.search(rf'{re.escape(marker)}[\s\S]{{0,500}}', head or "")
        if nearby:
            found = _css_url(nearby.group(0))
            if found:
                return found
    return ""


def _channel_info(html: str, feed: dict) -> dict:
    head = html.split("tgme_widget_message", 1)[0]
    title = _textish(_inner(head, "tgme_channel_info_header_title")) or feed.get("handle") or ""
    username = ""
    user = re.search(r"tgme_channel_info_header_username[\s\S]{0,200}@([A-Za-z0-9_]{4,32})", head)
    if user:
        username = user.group(1)
    handle = username or (feed.get("handle") or "")
    avatar = ""
    photo = re.search(r"tgme_page_photo_image[\s\S]{0,500}<img[^>]+src=\"([^\"]+)\"", head)
    if photo:
        avatar = _abs_url(photo.group(1))
    description = _textish(_inner(head, "tgme_channel_info_description"))
    followers = None
    subs = re.search(
        r'counter_value">([^<]+)</span>\s*<span class="counter_type">subscribers?',
        head,
        re.I,
    )
    if subs:
        followers = parse_count(subs.group(1))
    colors = ""
    painted = re.search(r'data-colors="([^"]+)"', head)
    if painted:
        colors = banner_color(painted.group(1))
    profile = {
        "id": f"telegram:{handle}",
        "platform": "telegram",
        "handle": handle,
        "name": title or handle,
        "title": title or handle,
        "avatar": avatar,
        "banner": _channel_banner(head),
        "bannerColor": colors,
        "bio": description,
        "url": profile_url("telegram", handle),
        "location": "",
        "website": "",
        "joined": "",
        "verifiedType": "blue" if "verified-icon" in head else None,
        "configured": False,
    }
    if followers is not None:
        profile["followers"] = followers
    from account_identity import telegram_channel_id

    channel_id = telegram_channel_id(html)
    stored = str(feed.get("permanentId") or "")
    if channel_id and (not stored or stored == channel_id):
        profile["permanentId"] = channel_id
        profile["account"] = True
    return profile


def _media(chunk: str, page: str, probe) -> tuple[list, dict | None, dict | None]:
    media = []
    link = None
    poll = None
    preview = re.search(r'<a[^>]*class="[^"]*tgme_widget_message_link_preview[^"]*"[^>]*>[\s\S]*?</a>', chunk)
    preview_html = preview.group(0) if preview else ""
    body = chunk.replace(preview_html, "") if preview_html else chunk
    for match in re.finditer(r"tgme_widget_message_photo_wrap[^>]*style=\"([^\"]*)\"", body):
        url = _css_url(match.group(1))
        if url:
            media.append({"type": "photo", "url": url, "poster": url, "alt": ""})
    for match in re.finditer(r"<video\b([^>]*)>", body, re.I):
        src = _abs_url(_attr(match.group(1), "src"))
        window = body[max(0, match.start() - 900) : match.end() + 400]
        poster = ""
        for image in _CSS_URL.finditer(window):
            poster = _abs_url(image.group(2)) or poster
        classes = window.lower()
        kind = "animated_gif" if re.search(r"\bgif\b", classes) else "video"
        playable = keep_playable(src, probe)
        item = {
            "type": kind,
            "url": playable,
            "poster": poster,
            "open": page,
        }
        if re.search(r"\broundvideo\b", classes):
            item["round"] = True
        duration = _duration(re.search(r"message_video_duration[^>]*>([^<]+)", window).group(1) if re.search(r"message_video_duration[^>]*>([^<]+)", window) else "")
        if duration:
            item["duration"] = duration
        if playable or poster:
            media.append(item)
    for match in re.finditer(r"<audio\b([^>]*)>", body, re.I):
        src = _abs_url(_attr(match.group(1), "src"))
        if src:
            media.append({"type": "audio", "url": src, "title": "Voice message", "open": page})
    for match in re.finditer(r'<a[^>]*class="[^"]*tgme_widget_message_document_wrap[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', body):
        href = _abs_url(match.group(1)) or page
        block = match.group(0)
        title = _textish(_inner(block, "tgme_widget_message_document_title")) or "File"
        extra = _textish(_inner(block, "tgme_widget_message_document_extra"))
        audio = " audio" in block or 'class="audio' in block or "voice" in block.lower()
        media.append({
            "type": "audio" if audio else "file",
            "url": href,
            "title": title,
            "extra": extra,
            "open": page,
        })
    if preview_html:
        href = _abs_url(_attr(preview_html, "href"))
        if href:
            image = ""
            for image_match in _CSS_URL.finditer(preview_html):
                image = _abs_url(image_match.group(2)) or image
            link = {
                "url": href,
                "site": _textish(_inner(preview_html, "link_preview_site_name")),
                "title": _textish(_inner(preview_html, "link_preview_title")),
                "description": _textish(_inner(preview_html, "link_preview_description")),
                "image": image,
            }
    question = _textish(_inner(body, "tgme_widget_message_poll_question"))
    if question:
        choices = []
        for option in re.finditer(r'tgme_widget_message_poll_option\b[\s\S]*?</div>\s*</div>', body):
            block = option.group(0)
            label = _textish(_inner(block, "tgme_widget_message_poll_option_text"))
            percent = _textish(_inner(block, "tgme_widget_message_poll_option_percent"))
            if not label:
                continue
            row = {"text": label}
            digits = re.search(r"(\d+(?:\.\d+)?)\s*%", percent)
            if digits:
                row["percent"] = float(digits.group(1))
            choices.append(row)
        if choices:
            poll = {"question": question, "choices": choices}
    return media, link, poll


def _forward(chunk: str) -> dict | None:
    match = re.search(
        r'<div[^>]*class="[^"]*tgme_widget_message_forwarded_from\b[^"]*"[^>]*>([\s\S]*?)</div>',
        chunk,
        re.I,
    )
    if not match:
        return None
    block = match.group(0)
    name = _tagged_text(block, "tgme_widget_message_forwarded_from_name")
    if not name:
        name = _textish(re.sub(r"^.*?Forwarded from(?:&nbsp;|\s)*", "", match.group(1), count=1, flags=re.I))
        name = re.sub(r"^from\s+", "", name, flags=re.I).strip()
    href = re.search(r'href="https://t\.me/([A-Za-z][A-Za-z0-9_]{4,31})', block)
    return {"name": name, "handle": href.group(1) if href else "", "platform": "telegram"}


def _reply(chunk: str) -> tuple[dict | None, dict | None]:
    match = re.search(r'<a[^>]*class="[^"]*tgme_widget_message_reply\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', chunk)
    if not match:
        return None, None
    href = match.group(1)
    block = match.group(2)
    parent = re.search(r"t\.me/([A-Za-z0-9_]+)/(\d+)", href)
    author = _tagged_text(block, "tgme_widget_message_author_name") or (parent.group(1) if parent else "")
    text = _tagged_text(block, "js-message_reply_text")
    replying = None
    parent_card = None
    if parent:
        replying = {"handle": parent.group(1), "id": parent.group(2)}
        parent_card = {"author": author or parent.group(1), "handle": parent.group(1), "text": text, "avatar": ""}
    return replying, parent_card


def _message(chunk: str, feed: dict, profile: dict, discussion: bool | None) -> dict | None:
    found = _POST_ID.search(chunk)
    if not found:
        return None
    channel, post_id = found.group(1), found.group(2)
    page = f"https://t.me/{channel}/{post_id}"
    when = ""
    dated = re.search(r'<time[^>]*datetime="([^"]+)"', chunk)
    if dated:
        when = to_iso(dated.group(1))
    views = None
    seen = re.search(r'tgme_widget_message_views">([^<]+)', chunk)
    if seen:
        views = parse_count(seen.group(1))
    edited = bool(re.search(r"tgme_widget_message_meta[^>]*>\s*edited\b", chunk, re.I))
    fragment = _inner(chunk, "js-message_text")
    text, html, links = rich_html(fragment, channel)
    probe = None
    sample = re.search(r"<video\b([^>]*)>", chunk, re.I)
    if sample:
        probe = _probe_for(feed, _abs_url(_attr(sample.group(1), "src")))
    media, link, poll = _media(chunk, page, probe)
    if not text and not media and not link and not poll:
        return None
    author = _textish(_inner(chunk, "tgme_widget_message_owner_name")) or profile.get("name") or channel
    avatar_match = re.search(r"tgme_widget_message_user_photo[\s\S]{0,600}<img[^>]+src=\"([^\"]+)\"", chunk)
    avatar = _abs_url(avatar_match.group(1)) if avatar_match else (profile.get("avatar") or "")
    forwarded = _forward(chunk)
    replying, parent = _reply(chunk)
    comments = "tgme_widget_message_comments" in chunk or "comment=" in chunk
    if discussion is True:
        comments = True
    elif discussion is False:
        comments = False
    post = post_shell(
        id=post_id,
        statusId=post_id,
        platform="telegram",
        feedId=feed.get("id") or f"telegram:{feed.get('handle') or channel}",
        kind="post",
        author=author,
        handle=feed.get("handle") or channel,
        avatar=avatar,
        verifiedType=profile.get("verifiedType"),
        text=text,
        links=links,
        date=when,
        url=page,
        media=media,
        replyingTo=replying,
        stats={"views": views} if views else {},
    )
    if html:
        post["html"] = html
    if poll:
        post["poll"] = poll
    if link and (link.get("title") or link.get("description") or link.get("image") or link.get("site")):
        post["link"] = link
    if forwarded is not None:
        post["forwardedFrom"] = forwarded
        source = (forwarded.get("handle") or "").lstrip("@").lower()
        mine = (feed.get("handle") or channel or "").lstrip("@").lower()
        if (forwarded.get("name") or forwarded.get("handle")) and source != mine:
            post["repostedBy"] = {
                "name": author,
                "handle": feed.get("handle") or channel,
                "avatar": avatar,
                "platform": "telegram",
                "feedId": post.get("feedId") or "",
            }
            post["author"] = forwarded.get("name") or forwarded.get("handle") or author
            post["handle"] = (forwarded.get("handle") or "").lstrip("@")
            post["avatar"] = forwarded.get("avatar") or ""
            post["verifiedType"] = None
            post["kind"] = "repost"
    if parent:
        post["replyParent"] = parent
    if edited:
        post["edited"] = True
    if comments:
        post["discussion"] = True
    return post


def _rss_to_html(payload: str) -> str:
    root = parse_xml(payload)
    pieces = []
    for node in root.iter():
        name = node.tag.rsplit("}", 1)[-1]
        if name not in ("item", "entry"):
            continue
        link = ""
        description = ""
        published = ""
        title = ""
        for child in list(node):
            cname = child.tag.rsplit("}", 1)[-1]
            text = "".join(child.itertext())
            if cname == "link":
                link = link or child.attrib.get("href") or text
            elif cname in ("description", "encoded", "summary", "content"):
                description = description or text
            elif cname in ("pubDate", "published", "updated", "date"):
                published = published or text
            elif cname == "title":
                title = title or text
        found = re.search(r"t\.me/(?:s/)?([A-Za-z0-9_]+)/(\d+)", link or "")
        if found and "data-post=" not in description:
            stamp = to_iso(published)
            time = f'<a class="tgme_widget_message_date" href="{_esc(link)}"><time datetime="{_esc(stamp)}"></time></a>' if stamp else ""
            description = (
                f'<div class="tgme_widget_message" data-post="{found.group(1)}/{found.group(2)}">'
                f'<div class="tgme_widget_message_owner_name"><span>{_esc(title)}</span></div>'
                f'<div class="tgme_widget_message_text js-message_text">{description}</div>{time}</div>'
            )
        if description:
            pieces.append(description)
    return "\n".join(pieces)


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    text = payload if isinstance(payload, str) else ""
    stripped = text.lstrip()
    if stripped.startswith("<") and re.search(r"<(rss|feed|rdf)\b", stripped[:400], re.I):
        text = _rss_to_html(text)
    html = _strip(text)
    profile = _channel_info(html, feed)
    forced = re.search(r'id="feeds-discussion" data-on="([01])"', html)
    discussion = None
    if forced:
        discussion = forced.group(1) == "1"
    posts = []
    for chunk in re.split(r'(?=<div class="tgme_widget_message\b)', html):
        post = _message(chunk, feed, profile, discussion)
        if post:
            posts.append(post)
    if discussion and posts:
        for post in posts:
            post["discussion"] = True
    return {"posts": posts, "profiles": [profile] if profile.get("handle") else []}
