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
                if ".mp4" in src.split("?")[0].lower():
                    mp4 = src
                    break
            url = mp4 or (srcs[0] if srcs else "")
            poster = self._video["poster"] or ""
            self._add_media(
                {
                    "type": "video",
                    "url": url or poster,
                    "poster": poster,
                    "width": None,
                    "height": None,
                    "alt": "",
                }
            )
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
    if kwargs.get("sortDate"):
        post["sortDate"] = kwargs["sortDate"]
    stats = kwargs.get("stats") or {}
    if stats:
        post["stats"] = stats
    return post


def dedupe_posts(posts, cap: int = 300):
    posts = sorted(posts, key=lambda p: p.get("sortDate") or p.get("date") or "", reverse=True)
    seen = set()
    out = []
    for post in posts:
        key = ((post.get("platform") or ""), str(post.get("id") or ""))
        if not key[1] or key in seen:
            continue
        seen.add(key)
        out.append(post)
        if len(out) >= cap:
            break
    return out


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
