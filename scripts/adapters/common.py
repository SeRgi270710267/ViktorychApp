"""Shared cleanup and feed-merge helpers. Python 3 stdlib only."""

from __future__ import annotations

import email.utils
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

TCO_TRAIL = re.compile(r"(?:\s*https://t\.co/\w+)+\s*$")
PREFIX_LINE = re.compile(r"^@[\w.]{1,30}(?:\s*↩️)?\s*:?\s*$")
AUTHOR_AT = re.compile(r"\(@([A-Za-z0-9_]{1,30})\)")
RT_BY = re.compile(r"^RT by @([A-Za-z0-9_]{1,30})\s*:\s*", re.I)
R_TO = re.compile(r"^R to @([A-Za-z0-9_]{1,30})\s*:", re.I)
RT_PREFIX = re.compile(r"^RT @([A-Za-z0-9_]{1,30})\s*:\s*")


def parse_json_loose(text: str):
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        start = text.find("[")
        end = text.rfind("]")
    if start < 0 or end < start:
        raise ValueError("no JSON payload found")
    return json.loads(text[start : end + 1])


def parse_xml(text: str):
    import xml.etree.ElementTree as ET

    for marker in ("<?xml", "<rss", "<feed"):
        i = text.find(marker)
        if i >= 0:
            text = text[i:]
            break
    return ET.fromstring(text)


def local_name(tag: str) -> str:
    if tag is None:
        return ""
    return tag.rsplit("}", 1)[-1]


def child_text(el, name: str) -> str:
    if el is None:
        return ""
    for child in list(el):
        if local_name(child.tag) == name and child.text:
            return child.text.strip()
    return ""


def children(el, name: str):
    if el is None:
        return []
    return [c for c in list(el) if local_name(c.tag) == name]


def clean_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = TCO_TRAIL.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def strip_author_prefix(text: str) -> str:
    lines = text.split("\n")
    while lines and (not lines[0].strip() or PREFIX_LINE.match(lines[0].strip())):
        # only strip a single leading author marker, keep intentional blank lines after
        if lines and PREFIX_LINE.match(lines[0].strip() or ""):
            lines = lines[1:]
            while lines and not lines[0].strip():
                lines = lines[1:]
            break
        if lines and not lines[0].strip():
            lines = lines[1:]
            continue
        break
    return clean_text("\n".join(lines))


def upgrade_avatar(url: str) -> str:
    if not url:
        return ""
    return (
        url.replace("_normal.", "_400x400.")
        .replace("_bigger.", "_400x400.")
        .replace("_mini.", "_400x400.")
    )


def best_mp4(variants) -> str:
    best = ""
    best_rate = -1
    for variant in variants or []:
        if not isinstance(variant, dict):
            continue
        url = variant.get("url") or ""
        ctype = (variant.get("content_type") or variant.get("type") or "").lower()
        if "mp4" not in ctype and ".mp4" not in url.split("?")[0].lower():
            continue
        rate = variant.get("bitrate") or variant.get("bit_rate") or 0
        try:
            rate = int(rate)
        except (TypeError, ValueError):
            rate = 0
        if rate >= best_rate:
            best_rate = rate
            best = url
    return best


def is_playable_video(url: str) -> bool:
    """A file a <video> element can try. Image redirects are not videos."""
    if not url:
        return False
    lowered = url.lower()
    if "instagram.com" in lowered and "/media" in lowered:
        return False
    path = urlparse(url).path.lower().split("?")[0]
    return path.endswith((".mp4", ".webm", ".mov", ".m3u8"))


def video_fields(variants) -> dict:
    """Keep every mp4 and an HLS playlist so the player can pick one."""
    files = []
    hls = ""
    for variant in variants or []:
        if not isinstance(variant, dict):
            continue
        url = variant.get("url") or ""
        if not url:
            continue
        path = url.split("?")[0].lower()
        if path.endswith(".m3u8"):
            hls = hls or url
            continue
        ctype = (variant.get("content_type") or variant.get("type") or "").lower()
        if "mp4" not in ctype and not path.endswith(".mp4"):
            continue
        rate = variant.get("bitrate") or variant.get("bit_rate") or 0
        try:
            rate = int(rate)
        except (TypeError, ValueError):
            rate = 0
        files.append({"url": url, "bitrate": rate})
    out = {}
    if files:
        out["variants"] = files
    if hls:
        out["hls"] = hls
    return out


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def shorten_url(url: str) -> str:
    raw = url or ""
    shown = re.sub(r"^https?://", "", raw)
    if len(shown) > 28:
        shown = shown[:27] + "…"
    return shown


class _Extractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.media = []
        self.links = []
        self.quotes = []
        self._bq = 0
        self._bq_parts = []
        self._bq_media = []
        self._video = None
        self._anchor = None
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag in ("script", "style"):
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "br":
            self._nl()
        elif tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "blockquote"):
            self._nl()
        if tag == "blockquote":
            self._bq += 1
            if self._bq == 1:
                self._bq_parts = []
                self._bq_media = []
        elif tag == "img":
            src = a.get("src") or ""
            if src and not src.startswith("data:"):
                item = {
                    "type": "photo",
                    "url": src,
                    "poster": src,
                    "width": _int(a.get("width")),
                    "height": _int(a.get("height")),
                    "alt": a.get("alt") or "",
                }
                self._add_media(item)
        elif tag == "video":
            self._video = {"poster": a.get("poster") or "", "srcs": []}
            if a.get("src"):
                self._video["srcs"].append(a["src"])
        elif tag == "source" and self._video is not None and a.get("src"):
            self._video["srcs"].append(a["src"])
        elif tag == "a":
            self._anchor = {"href": a.get("href") or "", "buf": []}

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style") and self._skip:
            self._skip -= 1
            return
        if self._skip:
            return
        if tag in ("p", "div", "li", "h1", "h2", "h3", "blockquote"):
            self._nl()
        if tag == "blockquote":
            self._bq = max(0, self._bq - 1)
            if self._bq == 0:
                self.quotes.append(
                    {"text": clean_text("".join(self._bq_parts)), "media": list(self._bq_media)}
                )
        elif tag == "video" and self._video is not None:
            srcs = self._video["srcs"]
            mp4 = ""
            for src in srcs:
                if is_playable_video(src) and ".m3u8" not in src.split("?")[0].lower():
                    mp4 = src
                    break
            hls = next((src for src in srcs if ".m3u8" in src.split("?")[0].lower()), "")
            url = mp4 or hls
            poster = self._video["poster"] or ""
            # A /media?size=l redirect is a JPEG. Keep it as the poster only.
            if not url:
                for src in srcs:
                    if src and not poster:
                        poster = src
            item = {
                "type": "video",
                "url": url,
                "poster": poster,
                "width": None,
                "height": None,
                "alt": "",
            }
            if hls and hls != url:
                item["hls"] = hls
            elif hls and not mp4:
                item["hls"] = hls
            self._add_media(item)
            self._video = None
        elif tag == "a" and self._anchor is not None:
            href = self._anchor["href"]
            label = "".join(self._anchor["buf"]).strip()
            if href.startswith("http"):
                self.links.append(
                    {
                        "expanded": href,
                        "display": shorten_url(href) if not label or label == href else label,
                        "anchorText": label,
                    }
                )
            self._anchor = None

    def handle_data(self, data):
        if self._skip or not data:
            return
        if self._anchor is not None:
            self._anchor["buf"].append(data)
        if self._bq:
            self._bq_parts.append(data)
        else:
            self.parts.append(data)

    def _nl(self):
        target = self._bq_parts if self._bq else self.parts
        if target and not str(target[-1]).endswith("\n"):
            target.append("\n")

    def _add_media(self, item):
        if self._bq:
            self._bq_media.append(item)
        elif self._video is not None and item["type"] == "photo":
            if not self._video["poster"]:
                self._video["poster"] = item["url"]
        else:
            self.media.append(item)


def html_to_parts(html: str) -> dict:
    parser = _Extractor()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        text = re.sub(r"<[^>]+>", " ", html or "")
        return {"text": clean_text(text), "media": [], "links": [], "quotes": []}
    text = strip_media_urls(clean_text("".join(parser.parts)), parser.media)
    return {"text": text, "media": parser.media, "links": parser.links, "quotes": parser.quotes}


def strip_media_urls(text: str, media) -> str:
    for item in media or []:
        for url in (item.get("url"), item.get("poster")):
            if url and url in text:
                text = text.replace(url, " ")
    return clean_text(text)


def replace_entities(text: str, entities: dict, quoted_id: str | None = None):
    """Replace t.co links with expanded urls and drop media/quote links."""
    links = []
    urls = list((entities or {}).get("urls") or [])
    for entry in urls:
        raw = entry.get("url") or ""
        expanded = entry.get("expanded_url") or raw
        display = entry.get("display_url") or shorten_url(expanded)
        if not raw or raw not in text:
            continue
        drop = False
        if entry.get("media_key"):
            drop = True
        low = (expanded or "") + " " + (display or "")
        if "pic.x.com" in low or "/photo/" in expanded or "/video/" in expanded:
            drop = True
        if quoted_id and quoted_id in (expanded or ""):
            drop = True
        if drop:
            text = text.replace(raw, "")
        else:
            text = text.replace(raw, expanded)
            links.append({"expanded": expanded, "display": display})
    text = clean_text(text)
    return text, links


def parse_time(value):
    """Parse an ISO, RFC822, or unix timestamp into an aware UTC datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        n = float(value)
        if n < 10**12:
            n *= 1000
        return datetime.fromtimestamp(n / 1000, tz=timezone.utc)
    text = str(value).strip()
    if text.isdigit():
        return parse_time(int(text))
    if len(text) >= 20 and text[4:5] == "-" and "T" in text:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            return None
    try:
        parsed = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_time(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def to_iso(value) -> str:
    parsed = parse_time(value)
    return format_time(parsed) if parsed else ("" if value is None else str(value))


_RELATIVE = re.compile(
    r"(?:(?:streamed|premiered)\s+)?(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?|\d+\s*[smhdwy])\s+ago\b",
    re.I,
)
_YOUTUBE_ID = re.compile(r"(?:[?&]v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})")
_PUBLISH_EXACT = re.compile(r'"(?:uploadDate|datePublished|publishDate)":"([^"]+)"')
_PUBLISH_DAY = re.compile(r'"(?:uploadDate|datePublished|publishDate|dateText)":\{"simpleText":"([^"]+)"\}')
_PUBLISH_CONTENT = re.compile(
    r'itemprop="(?:uploadDate|datePublished)"[^>]*\bcontent="([^"]+)"|content="([^"]+)"[^>]*itemprop="(?:uploadDate|datePublished)"',
    re.I,
)


def relative_label(text: str) -> bool:
    """True when a source only knows '2 days ago' or 'Streamed 1 week ago'."""
    label = (text or "").strip().lower()
    if not label:
        return False
    if label in ("just now", "now", "yesterday"):
        return True
    return _RELATIVE.search(label) is not None


def trusted_time(value):
    """An absolute timestamp. Epoch and empty values are not publish times."""
    parsed = parse_time(value)
    if parsed is None or parsed.year < 2005:
        return None
    return parsed


def earlier_iso(left, right) -> str:
    """The earlier real publish time. A missing side does not erase the other."""
    a = trusted_time(left)
    b = trusted_time(right)
    if a and b:
        return left if a <= b else right
    if a:
        return left or ""
    if b:
        return right or ""
    return ""


def _person_named(row) -> bool:
    return isinstance(row, dict) and bool(str(row.get("name") or row.get("handle") or "").strip())


def _vk_wall_owner(value) -> str:
    text = str(value or "")
    if "_" not in text:
        return ""
    return text.rsplit("_", 1)[0]


def credit_carried(posts, feeds) -> int:
    """Name the account that carried a post when the source already names the original.

    Telegram forwards store that original on forwardedFrom. A VK wall item whose
    id belongs to another community was placed on the followed wall. The card
    author stays the original. repostedBy is the account that carried it.
    """
    by_id = {}
    for feed in feeds or []:
        if isinstance(feed, dict) and feed.get("id"):
            by_id[feed["id"]] = feed
    owners = {}
    for post in posts or []:
        if not isinstance(post, dict) or (post.get("platform") or "") != "vk":
            continue
        feed = by_id.get(post.get("feedId") or "")
        if not feed:
            continue
        if str(post.get("handle") or "").lstrip("@").lower() != str(feed.get("handle") or "").lstrip("@").lower():
            continue
        owner = _vk_wall_owner(post.get("statusId") or post.get("id"))
        if owner:
            owners.setdefault(feed["id"], set()).add(owner)
    changed = 0
    for post in posts or []:
        if not isinstance(post, dict) or _person_named(post.get("repostedBy")):
            continue
        feed = by_id.get(post.get("feedId") or "")
        if _credit_forward(post, feed) or _credit_vk_wall(post, feed, owners):
            changed += 1
    return changed


def _credit_forward(post: dict, feed) -> bool:
    forwarded = post.get("forwardedFrom")
    if not _person_named(forwarded):
        return False
    feed = feed or {}
    post["repostedBy"] = {
        "name": feed.get("name") or post.get("author") or "",
        "handle": str(feed.get("handle") or post.get("handle") or "").lstrip("@"),
        "avatar": feed.get("avatar") or post.get("avatar") or "",
        "platform": feed.get("platform") or post.get("platform") or "",
        "feedId": post.get("feedId") or feed.get("id") or "",
    }
    post["author"] = forwarded.get("name") or forwarded.get("handle") or ""
    post["handle"] = str(forwarded.get("handle") or "").lstrip("@")
    post["avatar"] = forwarded.get("avatar") or ""
    post["verifiedType"] = None
    post["kind"] = "repost"
    return True


def _credit_vk_wall(post: dict, feed, owners: dict) -> bool:
    if not feed or (post.get("platform") or "") != "vk" or post.get("kind") in ("reply", "quote", "repost"):
        return False
    handle = str(post.get("handle") or "").lstrip("@").lower()
    wall = str(feed.get("handle") or "").lstrip("@").lower()
    if not handle or handle == wall:
        return False
    owner = _vk_wall_owner(post.get("statusId") or post.get("id"))
    known = owners.get(feed.get("id") or "") or set()
    if not owner or not known or owner in known:
        return False
    post["repostedBy"] = {
        "name": feed.get("name") or wall,
        "handle": str(feed.get("handle") or "").lstrip("@"),
        "avatar": feed.get("avatar") or "",
        "platform": "vk",
        "feedId": feed.get("id") or post.get("feedId") or "",
    }
    post["kind"] = "repost"
    return True


def canonical_status_id(post: dict) -> str:
    """One id per video or post, whichever source spelled it."""
    if not isinstance(post, dict):
        return ""
    raw = str(post.get("statusId") or post.get("id") or "")
    if str(post.get("id") or "").startswith("repost:"):
        return str(post.get("id"))
    platform = post.get("platform") or ""
    if platform != "youtube" and not raw.startswith("yt:video:"):
        return raw
    if raw.startswith("yt:video:"):
        raw = raw.split(":", 2)[-1]
    found = _YOUTUBE_ID.search(raw) or _YOUTUBE_ID.search(str(post.get("url") or ""))
    if found:
        return found.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
        return raw
    return raw


def calendar_date(text: str) -> str:
    """A YouTube 'Oct 11, 2026' label as the start of that UTC day."""
    label = (text or "").strip()
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            parsed = datetime.strptime(label, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        return format_time(parsed)
    return ""


def publish_date_from_html(html: str) -> str:
    """The absolute uploadDate, datePublished, or publishDate on a watch page.

    A calendar day is used only when the page has no clock time. A relative
    label is not a publish time.
    """
    text = html or ""
    found = []
    for match in _PUBLISH_EXACT.finditer(text):
        parsed = trusted_time(match.group(1))
        if parsed:
            found.append(format_time(parsed))
    for match in _PUBLISH_CONTENT.finditer(text):
        parsed = trusted_time(match.group(1) or match.group(2) or "")
        if parsed:
            found.append(format_time(parsed))
    if found:
        return min(found, key=lambda value: trusted_time(value) or datetime.max.replace(tzinfo=timezone.utc))
    for match in _PUBLISH_DAY.finditer(text):
        label = match.group(1)
        if relative_label(label):
            continue
        day = calendar_date(label)
        if day:
            return day
    return ""


def dates_moved_later(before, after) -> list:
    """Ids whose stored publish time became later. An empty previous date is not a move."""
    previous = {}
    for post in before or []:
        if not isinstance(post, dict):
            continue
        ident = canonical_status_id(post) or str(post.get("id") or "")
        if not ident:
            continue
        key = (str(post.get("platform") or ""), ident)
        moment = trusted_time(post.get("date"))
        if moment is None:
            continue
        have = previous.get(key)
        if have is None or moment < have[0]:
            previous[key] = (moment, ident)
    moved = []
    for post in after or []:
        if not isinstance(post, dict):
            continue
        ident = canonical_status_id(post) or str(post.get("id") or "")
        key = (str(post.get("platform") or ""), ident)
        have = previous.get(key)
        moment = trusted_time(post.get("date"))
        if not have or moment is None or moment <= have[0]:
            continue
        moved.append(ident)
    return moved


def lock_publish_time(previous: dict | None, post: dict, now: datetime | None = None) -> None:
    """Keep the earliest trusted publish time and one canonical id.

    A later sync, a relative label turned into 'now', or a second source
    must not move that time forward. A post with no real date records the
    first time it was seen and never replaces that with a later clock time.
    """
    if not isinstance(post, dict):
        return
    old = previous or {}
    if (post.get("platform") or "") == "youtube" and not str(post.get("id") or "").startswith("repost:"):
        cid = canonical_status_id(post)
        if cid:
            post["id"] = cid
            post["statusId"] = cid
    incoming = post.get("date") or ""
    if relative_label(str(incoming)):
        incoming = ""
    stored = old.get("date") or ""
    if relative_label(str(stored)):
        stored = ""
    chosen = earlier_iso(stored, incoming)
    seen = old.get("seenAt") or ""
    if not chosen:
        if trusted_time(seen):
            chosen = seen if isinstance(seen, str) else format_time(trusted_time(seen))
            post["seenAt"] = chosen
        elif not old:
            moment = now or datetime.now(timezone.utc)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            chosen = format_time(moment)
            post["seenAt"] = chosen
        else:
            chosen = ""
    elif old.get("seenAt"):
        post["seenAt"] = old["seenAt"]
    post["date"] = chosen
    if old.get("sortDate") and post.get("kind") == "repost":
        post["sortDate"] = old["sortDate"]


def stamp_activity(posts: list, now: datetime | None = None) -> None:
    """Order reposts by their place in a newest-first timeline.

    Public sources keep the original post's created_at on a repost and do not
    include the repost's own id. When that original time is older than a post
    listed below the repost, the repost happened later than that post. Place
    the run between that later post and the item above the run. The ceiling
    for a run at the top of the page is this fetch. A stored sortDate is left
    alone so the next sync does not move the same repost.
    """
    if not posts:
        return
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    fetched = now.astimezone(timezone.utc)
    index = 0
    while index < len(posts):
        post = posts[index]
        if post.get("kind") != "repost" or post.get("sortDate"):
            index += 1
            continue
        start = index
        while index < len(posts) and posts[index].get("kind") == "repost" and not posts[index].get("sortDate"):
            index += 1
        run = posts[start:index]
        anchor = parse_time(posts[index].get("sortDate") or posts[index].get("date")) if index < len(posts) else None
        ceiling = fetched
        if start > 0:
            ceiling = parse_time(posts[start - 1].get("sortDate") or posts[start - 1].get("date")) or fetched
        if not anchor or ceiling <= anchor:
            continue
        if all((parse_time(item.get("date")) or anchor) >= anchor for item in run):
            continue
        span = (ceiling - anchor).total_seconds()
        step = span / (len(run) + 1)
        for offset, item in enumerate(run):
            stamp = ceiling - timedelta(seconds=step * (offset + 1))
            if stamp <= anchor:
                stamp = anchor + timedelta(seconds=max(1, len(run) - offset))
            if stamp >= ceiling:
                stamp = ceiling - timedelta(seconds=offset + 1)
            item["sortDate"] = format_time(stamp)


def rfc822_to_iso(value: str) -> str:
    if not value:
        return ""
    try:
        dt = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return value
    if dt is None:
        return value
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat().replace("+00:00", "Z")


def profile_url(platform: str, handle: str) -> str:
    handle = handle or ""
    if platform == "x":
        return f"https://x.com/{handle}"
    if platform == "threads":
        return f"https://www.threads.com/@{handle}"
    if platform == "instagram":
        return f"https://www.instagram.com/{handle}/"
    if platform == "vk":
        return f"https://vk.com/{handle}"
    if platform == "telegram":
        return f"https://t.me/{handle}"
    return ""


def blank_profile(platform: str, handle: str, name: str = "", avatar: str = "") -> dict:
    name = name or handle
    return {
        "id": f"{platform}:{handle}",
        "platform": platform,
        "handle": handle,
        "name": name,
        "title": name,
        "avatar": avatar or "",
        "banner": "",
        "bio": "",
        "url": profile_url(platform, handle),
        "location": "",
        "website": "",
        "joined": "",
        "verifiedType": None,
        "configured": False,
    }


def drop_empty(obj: dict) -> dict:
    out = {}
    for key, value in obj.items():
        if value is None or value == "":
            continue
        out[key] = value
    return out


def post_shell(**kwargs) -> dict:
    post = {
        "id": str(kwargs.get("id") or ""),
        "statusId": str(kwargs.get("statusId") or kwargs.get("id") or ""),
        "platform": kwargs.get("platform") or "",
        "feedId": kwargs.get("feedId") or "",
        "kind": kwargs.get("kind") or "post",
        "author": kwargs.get("author") or "",
        "handle": kwargs.get("handle") or "",
        "avatar": kwargs.get("avatar") or "",
        "verifiedType": kwargs.get("verifiedType"),
        "text": kwargs.get("text") or "",
        "links": kwargs.get("links") or [],
        "date": kwargs.get("date") or "",
        "url": kwargs.get("url") or "",
        "media": kwargs.get("media") or [],
        "images": [
            m.get("url")
            for m in (kwargs.get("media") or [])
            if m.get("type") == "photo" and m.get("url")
        ],
        "repostedBy": kwargs.get("repostedBy"),
        "replyingTo": kwargs.get("replyingTo"),
        "quoted": kwargs.get("quoted"),
    }
    article = kwargs.get("article")
    if isinstance(article, dict) and (article.get("title") or article.get("cover") or article.get("preview") or article.get("blocks")):
        post["article"] = article
    if kwargs.get("sortDate"):
        post["sortDate"] = kwargs["sortDate"]
    stats = kwargs.get("stats") or {}
    if stats:
        post["stats"] = stats
    return post


class BridgeError(Exception):
    """RSS-Bridge or RSSHub returned an error page instead of posts."""


# Phrases these generators put in the error item. A real caption does not use them.
_BRIDGE_MARKERS = (
    "bridge returned error",
    "httpexception",
    "lib/http.php",
    "looks like something went wrong",
)
# RSS-Bridge's Atom fallback when an item has no permalink: urn:sha1 of the error text.
_SHA_GUID = re.compile(r"(?i)^urn:sha1:[0-9a-f]{40}$")
_MOZILLA_STATUS = re.compile(r"(?i)https?://developer\.mozilla\.org/\S*status/\d+")
_RSSHUB_DOCS = re.compile(r"(?i)^https?://docs\.rsshub\.app/?$")
_BRIDGE_ACTION = re.compile(r"(?i)[?&]action=display\b")
_BRIDGE_NAME = re.compile(r"(?i)[?&]bridge=")


def bridge_error_text(*parts) -> bool:
    folded = "\n".join(str(part or "") for part in parts).casefold()
    return any(marker in folded for marker in _BRIDGE_MARKERS)


def _error_locator(value: str) -> bool:
    """A guid or link that points at the error page rather than a post."""
    text = str(value or "").strip()
    if not text:
        return False
    if bridge_error_text(text):
        return True
    if _MOZILLA_STATUS.search(text):
        return True
    if _RSSHUB_DOCS.match(text):
        return True
    return bool(_BRIDGE_ACTION.search(text) and _BRIDGE_NAME.search(text))


def bridge_error_guid(guid: str, link: str = "") -> bool:
    """Error-like ids: bridge URLs, MDN status pages, RSSHub's docs guid, or a hash with no permalink."""
    if _error_locator(guid) or _error_locator(link):
        return True
    return not str(link or "").strip() and _SHA_GUID.match(str(guid or "").strip()) is not None


def post_is_bridge_error(post: dict) -> bool:
    """A normalized post whose title, body, or id is an upstream error page."""
    if not isinstance(post, dict):
        return False
    quoted = post.get("quoted") if isinstance(post.get("quoted"), dict) else {}
    if bridge_error_text(post.get("text"), post.get("title"), post.get("description"), quoted.get("text")):
        return True
    guid = str(post.get("statusId") or post.get("id") or "")
    link = str(post.get("url") or "")
    return bridge_error_guid(guid, link)


def stub_is_bridge_error(row: dict) -> bool:
    if not isinstance(row, dict):
        return False
    text = row.get("t") if row.get("t") is not None else row.get("text")
    return post_is_bridge_error({"text": text or "", "id": row.get("id") or "", "url": row.get("url") or ""})


def _item_links(item) -> list:
    found = []
    text = child_text(item, "link")
    if text:
        found.append(text)
    for child in list(item):
        if local_name(child.tag) != "link":
            continue
        href = (child.attrib.get("href") or child.text or "").strip()
        if href and href not in found:
            found.append(href)
    return found


def _item_body(item) -> str:
    parts = []
    for child in list(item):
        if local_name(child.tag) not in ("title", "description", "summary", "content", "encoded"):
            continue
        text = "".join(child.itertext()).strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


def xml_item_is_bridge_error(item) -> bool:
    if item is None:
        return False
    guid = child_text(item, "guid") or child_text(item, "id")
    if bridge_error_text(child_text(item, "title"), _item_body(item)):
        return True
    links = _item_links(item)
    if _error_locator(guid):
        return True
    if links and all(_error_locator(link) for link in links):
        return True
    return not links and _SHA_GUID.match(guid or "") is not None


def iter_feed_items(root):
    if root is None:
        return []
    return [el for el in root.iter() if local_name(el.tag) in ("item", "entry")]


def items_are_only_bridge_errors(payload: str) -> bool:
    """True when every RSS/Atom entry is an upstream error page."""
    if not isinstance(payload, str):
        return False
    try:
        root = parse_xml(payload)
    except Exception:
        return False
    items = iter_feed_items(root)
    return bool(items) and all(xml_item_is_bridge_error(item) for item in items)


def document_is_bridge_error(payload: str) -> bool:
    """An HTML error page, not a feed. RSS that merely quotes the phrase is left to the item filter."""
    if not isinstance(payload, str):
        return False
    sample = payload[:12000]
    head = sample.lstrip()[:400].casefold()
    html = (
        head.startswith("<!doctype html")
        or head.startswith("<html")
        or "<h1>looks like something went wrong" in sample.casefold()
    )
    return bool(html and bridge_error_text(sample))


def guard_posts(root, posts, channel_title: str = "", channel_description: str = "") -> list:
    """Drop error items. Raise when the document is only an error so the caller can try the next mirror."""
    items = iter_feed_items(root)
    if items and all(xml_item_is_bridge_error(item) for item in items):
        raise BridgeError("bridge error feed")
    kept = [post for post in posts or [] if not post_is_bridge_error(post)]
    if (posts or []) and not kept:
        raise BridgeError("bridge error items")
    if not kept and bridge_error_text(channel_title, channel_description):
        raise BridgeError("bridge error feed")
    return kept


def dedupe_posts(posts, cap: int = 300):
    """One row per canonical id. The earliest trusted publish time stays."""
    ranked = sorted(posts, key=lambda p: p.get("sortDate") or p.get("date") or "", reverse=True)
    seen = {}
    order = []
    for post in ranked:
        key_id = canonical_status_id(post) or str(post.get("id") or "")
        key = ((post.get("platform") or ""), key_id)
        if not key[1]:
            continue
        kept = seen.get(key)
        if kept is None:
            seen[key] = post
            order.append(post)
            continue
        merged = earlier_iso(kept.get("date") or "", post.get("date") or "")
        if merged:
            kept["date"] = merged
    return order[:cap]


def load_document(path: Path) -> dict:
    if not path.exists():
        return {"updated": None, "feeds": [], "posts": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("feeds", [])
    data.setdefault("posts", [])
    return data


def save_document(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def merge_profiles(existing, incoming):
    by_id = {f.get("id"): f for f in existing if f.get("id")}
    for profile in incoming:
        pid = profile.get("id")
        if not pid:
            continue
        prev = by_id.get(pid, {})
        merged = dict(prev)
        for key, value in profile.items():
            if value is None or value == "":
                continue
            if key in prev and prev.get("configured") and key not in ("configured",):
                # configured snapshot fields win unless incoming is also configured
                if not profile.get("configured") and key in (
                    "followers",
                    "following",
                    "postsCount",
                    "bio",
                    "banner",
                    "joined",
                    "website",
                    "location",
                    "avatar",
                    "name",
                    "verifiedType",
                ):
                    continue
            merged[key] = value
        if prev.get("configured"):
            merged["configured"] = True
        by_id[pid] = merged
    return list(by_id.values())


def media_basename(url: str, hint: str) -> str:
    path = urlparse(url).path.lower()
    ext = ".jpg"
    for candidate in (".jpeg", ".jpg", ".png", ".webp", ".gif", ".mp4"):
        if path.endswith(candidate):
            ext = ".jpg" if candidate == ".jpeg" else candidate
            break
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    safe = re.sub(r"[^a-z0-9_-]+", "", hint.lower())[:24] or "media"
    return f"{safe}-{digest}{ext}"
