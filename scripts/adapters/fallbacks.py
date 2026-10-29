"""Fallback extraction when a source's own adapter finds nothing.

Nothing here replaces an adapter. update_feeds.accept_feed calls universal()
only after the adapter crashed or returned no posts, so a bridge or platform
that quietly switched formats (RSS to Atom, Atom to JSON Feed) still yields
posts. meta_from_html() reads one page's JSON-LD, Open Graph, Twitter card,
itemprop and <title> values, strongest first, for callers that need a single
post or a link card from HTML.
"""

from __future__ import annotations

import html as html_lib
import json
import re
from urllib.parse import urljoin

from .common import blank_profile, html_to_parts, parse_json_loose, post_shell, to_iso

_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(\"([^\"]*)\"|'([^']*)'|([^\s\"'>]+))")
_LDJSON = re.compile(r"<script\b[^>]*type\s*=\s*[\"']application/ld\+json[\"'][^>]*>([\s\S]*?)</script>", re.I)
_TITLE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.I)
_CANON = re.compile(r"<link\b[^>]*rel\s*=\s*[\"']canonical[\"'][^>]*>", re.I)
_POST_TYPES = ("socialmediaposting", "blogposting", "newsarticle", "article", "videoobject", "discussionforumposting", "imageobject", "report")


def _attrs(tag: str) -> dict:
    out = {}
    for match in _ATTR.finditer(tag):
        value = match.group(3) if match.group(3) is not None else match.group(4) if match.group(4) is not None else match.group(5)
        out[match.group(1).lower()] = html_lib.unescape(value or "")
    return out


def _walk_ld(node, found: list) -> None:
    if isinstance(node, list):
        for item in node:
            _walk_ld(item, found)
    elif isinstance(node, dict):
        kinds = node.get("@type")
        kinds = kinds if isinstance(kinds, list) else [kinds]
        if any(str(kind or "").lower() in _POST_TYPES for kind in kinds):
            found.append(node)
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in node:
                _walk_ld(node[key], found)


def _first(*values) -> str:
    for value in values:
        if isinstance(value, list):
            value = value[0] if value else ""
        if isinstance(value, dict):
            value = value.get("url") or value.get("contentUrl") or value.get("name") or ""
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _count(stats, name: str):
    for row in stats if isinstance(stats, list) else [stats]:
        if not isinstance(row, dict):
            continue
        kind = _first(row.get("interactionType")).lower()
        if name in kind:
            try:
                return int(row.get("userInteractionCount"))
            except (TypeError, ValueError):
                return None
    return None


def meta_from_html(page: str, base: str = "") -> dict:
    """One page's post fields: JSON-LD first, then Open Graph and Twitter cards, then <title>."""
    page = page if isinstance(page, str) else ""
    head = page[:800000]
    meta = {}
    for tag in _META.findall(head):
        attrs = _attrs(tag)
        key = (attrs.get("property") or attrs.get("name") or attrs.get("itemprop") or "").lower()
        if key and "content" in attrs and key not in meta:
            meta[key] = attrs["content"]
    ld = []
    for block in _LDJSON.findall(head):
        data = parse_json_loose(block.strip())
        if data is not None:
            _walk_ld(data, ld)
    node = ld[0] if ld else {}
    author = node.get("author") or node.get("creator") or {}
    if isinstance(author, list):
        author = author[0] if author else {}
    canon = ""
    match = _CANON.search(head)
    if match:
        canon = _attrs(match.group(0)).get("href") or ""
    title_tag = _TITLE.search(head)
    url = _first(node.get("url"), meta.get("og:url"), canon, base)
    out = {
        "url": urljoin(base, url) if url else "",
        "title": _first(node.get("headline"), node.get("name"), meta.get("og:title"), meta.get("twitter:title"), html_lib.unescape(title_tag.group(1)) if title_tag else ""),
        "text": _first(node.get("articleBody"), node.get("text"), node.get("description"), meta.get("og:description"), meta.get("twitter:description"), meta.get("description")),
        "image": _first(node.get("image"), node.get("thumbnailUrl"), meta.get("og:image:secure_url"), meta.get("og:image"), meta.get("twitter:image"), meta.get("twitter:image:src")),
        "video": _first(node.get("contentUrl") if "video" in str(node.get("@type")).lower() else "", meta.get("og:video:secure_url"), meta.get("og:video:url"), meta.get("og:video")),
        "author": _first(author.get("name") if isinstance(author, dict) else author, meta.get("author"), meta.get("article:author"), meta.get("twitter:creator")),
        "published": _first(node.get("datePublished"), node.get("uploadDate"), node.get("dateCreated"), meta.get("article:published_time"), meta.get("og:updated_time"), meta.get("datepublished")),
        "site": _first(meta.get("og:site_name"), meta.get("application-name")),
        "likes": _count(node.get("interactionStatistic"), "like"),
        "replies": _count(node.get("interactionStatistic"), "comment"),
    }
    for key in ("image", "video"):
        if out[key]:
            out[key] = urljoin(out["url"] or base, out[key])
    return {key: value for key, value in out.items() if value not in (None, "")}


def post_from_meta(meta: dict, feed: dict) -> dict | None:
    """A single post from meta_from_html, or None when the page says nothing."""
    if not meta or not (meta.get("text") or meta.get("title") or meta.get("image")):
        return None
    media = []
    if meta.get("video"):
        media.append({"type": "video", "url": meta["video"], "poster": meta.get("image") or "", "width": None, "height": None, "alt": ""})
    elif meta.get("image"):
        media.append({"type": "photo", "url": meta["image"], "poster": meta["image"], "width": None, "height": None, "alt": ""})
    text = meta.get("text") or ""
    title = meta.get("title") or ""
    if title and title not in text:
        text = (title + "\n\n" + text).strip()
    stats = {key: meta[key] for key in ("likes", "replies") if isinstance(meta.get(key), int)}
    return post_shell(
        id=meta.get("url") or title,
        platform=feed.get("platform") or "rss",
        feedId=feed.get("id") or "",
        author=meta.get("author") or meta.get("site") or feed.get("handle") or "",
        handle=feed.get("handle") or "",
        text=text,
        date=to_iso(meta.get("published")) if meta.get("published") else "",
        url=meta.get("url") or "",
        media=media,
        stats=stats or None,
    )


def parse_json_feed(payload, feed: dict | None = None) -> dict:
    """JSON Feed 1.0/1.1 (jsonfeed.org) into posts."""
    feed = feed or {}
    data = parse_json_loose(payload) if isinstance(payload, str) else payload
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return {"posts": [], "profiles": []}
    platform = feed.get("platform") or "rss"
    handle = feed.get("handle") or "feed"
    title = str(data.get("title") or handle)
    icon = str(data.get("icon") or data.get("favicon") or "")
    profile = blank_profile(platform, handle, title, icon)
    profile["url"] = str(data.get("home_page_url") or "") or profile["url"]
    profile["bio"] = str(data.get("description") or "")
    posts = []
    for item in data["items"]:
        if not isinstance(item, dict):
            continue
        parts = html_to_parts(str(item.get("content_html") or "")) if item.get("content_html") else {"text": "", "media": [], "links": []}
        text = str(item.get("content_text") or "") or parts["text"] or str(item.get("summary") or "")
        item_title = str(item.get("title") or "")
        if item_title and item_title not in text:
            text = (item_title + "\n\n" + text).strip()
        media = list(parts["media"])
        image = str(item.get("image") or item.get("banner_image") or "")
        if image and image not in {m.get("url") for m in media}:
            media.append({"type": "photo", "url": image, "poster": image, "width": None, "height": None, "alt": ""})
        for att in item.get("attachments") or []:
            if isinstance(att, dict) and att.get("url"):
                mime = str(att.get("mime_type") or "")
                kind = "video" if mime.startswith("video") else "audio" if mime.startswith("audio") else "photo"
                media.append({"type": kind, "url": str(att["url"]), "poster": "", "width": None, "height": None, "alt": str(att.get("title") or ""), "mime": mime})
        authors = item.get("authors") or ([item["author"]] if isinstance(item.get("author"), dict) else [])
        author = authors[0] if authors and isinstance(authors[0], dict) else {}
        link = str(item.get("url") or item.get("external_url") or "")
        posts.append(
            post_shell(
                id=str(item.get("id") or link),
                platform=platform,
                feedId=feed.get("id") or "",
                author=str(author.get("name") or title),
                handle=handle,
                avatar=str(author.get("avatar") or icon),
                text=text,
                links=parts.get("links") or [],
                date=to_iso(item.get("date_published") or item.get("date_modified") or ""),
                url=link,
                media=media,
            )
        )
    return {"posts": posts, "profiles": [profile]}


def sniff(payload) -> str:
    """'jsonfeed', 'rss', 'atom', 'html', 'json' or '' for a raw response body."""
    if not isinstance(payload, str):
        return ""
    head = payload.lstrip("\ufeff \t\r\n")[:2000].lower()
    if head.startswith("{") or head.startswith("["):
        return "jsonfeed" if "jsonfeed.org/version" in head else "json"
    if "<rss" in head or "<rdf:rdf" in head:
        return "rss"
    if "<feed" in head:
        return "atom"
    if "<html" in head or "<!doctype html" in head:
        return "html"
    return ""


def universal(payload, feed: dict | None = None) -> dict:
    """Parse any structured feed format. HTML pages are not guessed at: an error page is not a post."""
    feed = feed or {}
    kind = sniff(payload)
    if kind == "jsonfeed":
        return parse_json_feed(payload, feed)
    if kind in ("rss", "atom"):
        from . import generic_rss

        try:
            return generic_rss.parse(payload, feed)
        except Exception:
            return {"posts": [], "profiles": []}
    return {"posts": [], "profiles": []}
