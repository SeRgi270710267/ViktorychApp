"""Normalize an X Article from public fxtwitter / syndication payloads.

The profile articles list usually carries a title, cover, and preview. The
status route (api.fxtwitter.com/status/<id>) adds Draft.js blocks: paragraphs,
headings, lists, and embedded posts. This module never calls the paid X API.
"""

from __future__ import annotations

import re

ARTICLE_URL = re.compile(
    r"https?://(?:www\.)?(?:x|twitter)\.com/(?:i/article/|(?:[A-Za-z0-9_]{1,30})/article/)([A-Za-z0-9]+)",
    re.I,
)

_BLOCK_TYPES = {
    "unstyled": "paragraph",
    "header-one": "h1",
    "header-two": "h2",
    "header-three": "h3",
    "blockquote": "quote",
    "unordered-list-item": "ul",
    "ordered-list-item": "ol",
    "atomic": "atomic",
}


def article_id_from_url(url: str) -> str:
    match = ARTICLE_URL.search(str(url or ""))
    return match.group(1) if match else ""


def _cover(raw: dict) -> str:
    direct = raw.get("cover_url") or raw.get("image") or ""
    if isinstance(direct, str) and direct.startswith("http"):
        return direct
    media = raw.get("cover_media") or raw.get("cover") or {}
    if isinstance(media, str) and media.startswith("http"):
        return media
    if not isinstance(media, dict):
        return ""
    info = media.get("media_info") or media.get("mediaInfo") or {}
    if not isinstance(info, dict):
        info = {}
    url = info.get("original_img_url") or info.get("url") or media.get("url") or media.get("media_url_https") or ""
    return str(url or "")


def _entity_map(content: dict) -> dict:
    raw = content.get("entityMap")
    pairs = []
    if isinstance(raw, dict):
        pairs = list(raw.items())
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and "key" in item:
                pairs.append((item.get("key"), item.get("value")))
    out = {}
    for key, value in pairs:
        if not isinstance(value, dict):
            continue
        data = value.get("data") if isinstance(value.get("data"), dict) else {}
        kind = str(value.get("type") or "")
        entry = {"type": kind}
        tweet = data.get("tweetId") or data.get("tweet_id") or ""
        if tweet:
            entry["tweetId"] = str(tweet)
        media = data.get("media") if isinstance(data.get("media"), dict) else {}
        info = media.get("media_info") if isinstance(media.get("media_info"), dict) else data
        url = ""
        for src in (info, data, media):
            if not isinstance(src, dict):
                continue
            url = src.get("original_img_url") or src.get("media_url_https") or src.get("url") or url
        if url:
            entry["url"] = str(url)
        poster = ""
        if isinstance(info, dict):
            poster = info.get("preview_image_url") or info.get("thumbnail_url") or ""
        if poster:
            entry["poster"] = str(poster)
        title = data.get("title") or data.get("name") or ""
        if title:
            entry["title"] = str(title)
        out[str(key)] = entry
    return out


def _styles(block: dict) -> list:
    styles = []
    for style in (block.get("inlineStyleRanges") or [])[:40]:
        if not isinstance(style, dict):
            continue
        try:
            start = int(style.get("offset") or 0)
            length = int(style.get("length") or 0)
        except (TypeError, ValueError):
            continue
        name = str(style.get("style") or "")
        if length > 0 and name:
            styles.append({"start": start, "end": start + length, "style": name})
    return styles


def _ranges(block: dict) -> list:
    ranges = []
    for ent in (block.get("entityRanges") or [])[:20]:
        if not isinstance(ent, dict):
            continue
        try:
            start = int(ent.get("offset") or 0)
            length = int(ent.get("length") or 0)
        except (TypeError, ValueError):
            continue
        if length <= 0:
            continue
        ranges.append({"start": start, "end": start + length, "key": str(ent.get("key"))})
    return ranges


def _inline_links(data: dict) -> list:
    if not isinstance(data, dict):
        return []
    links = []
    buckets = (
        ("urls", ""),
        ("mentions", "https://x.com/"),
        ("hashtags", "https://x.com/hashtag/"),
    )
    for name, prefix in buckets:
        for span in (data.get(name) or [])[:20]:
            if not isinstance(span, dict):
                continue
            text = str(span.get("text") or "")
            try:
                start = int(span.get("fromIndex") or 0)
                end = int(span.get("toIndex") or 0)
            except (TypeError, ValueError):
                continue
            if not text or end <= start:
                continue
            href = text if name == "urls" else prefix + text.lstrip("#@")
            links.append({"start": start, "end": end, "url": href})
    return links


def _blocks(raw: dict) -> list:
    content = raw.get("content") or raw.get("content_state") or {}
    if not isinstance(content, dict):
        return []
    entities = _entity_map(content)
    resolved = []
    for block in (content.get("blocks") or [])[:400]:
        if not isinstance(block, dict):
            continue
        kind = _BLOCK_TYPES.get(str(block.get("type") or "unstyled"), "paragraph")
        text = str(block.get("text") or "")
        if kind == "atomic":
            ent = None
            for ref in _ranges(block):
                ent = entities.get(str(ref.get("key")))
                if ent:
                    break
            if not ent:
                continue
            etype = str(ent.get("type") or "").upper()
            if etype == "TWEET" and ent.get("tweetId"):
                resolved.append({"type": "embed", "tweetId": ent["tweetId"]})
            elif ent.get("url") and ("VIDEO" in etype or etype == "ANIMATED_GIF"):
                row = {"type": "video", "url": ent["url"]}
                if ent.get("poster"):
                    row["poster"] = ent["poster"]
                resolved.append(row)
            elif ent.get("url") and etype in ("IMAGE", "MEDIA", "PHOTO", "ANIMATED_GIF"):
                resolved.append({"type": "image", "url": ent["url"], "alt": ent.get("title") or ""})
            elif ent.get("url"):
                resolved.append({"type": "link", "url": ent["url"], "title": ent.get("title") or ent["url"]})
            continue
        row = {"type": kind, "text": text}
        styles = _styles(block)
        if styles:
            row["styles"] = styles
        links = _inline_links(block.get("data") if isinstance(block.get("data"), dict) else {})
        if links:
            row["links"] = links
        if not text.strip() and not links:
            continue
        resolved.append(row)
    return resolved


def normalize_article(raw, fallback_url: str = "") -> dict | None:
    if not isinstance(raw, dict):
        return None
    # Already normalized by this module.
    if raw.get("preview") is not None and "preview_text" not in raw and "content" not in raw and "cover_media" not in raw:
        title = str(raw.get("title") or "").strip()
        preview = str(raw.get("preview") or "").strip()
        cover = str(raw.get("cover") or "").strip()
        blocks = raw.get("blocks") if isinstance(raw.get("blocks"), list) else []
        if not title and not preview and not cover and not blocks:
            return None
        out = {
            "id": str(raw.get("id") or ""),
            "title": title,
            "preview": preview,
            "cover": cover,
            "url": str(raw.get("url") or fallback_url or ""),
        }
        if blocks:
            out["blocks"] = blocks
        return out
    title = str(raw.get("title") or "").strip()
    preview = str(raw.get("preview_text") or raw.get("preview") or raw.get("description") or "").strip()
    article_id = str(raw.get("id") or raw.get("rest_id") or raw.get("article_id") or "").strip()
    cover = _cover(raw)
    url = str(raw.get("url") or "") or (f"https://x.com/i/article/{article_id}" if article_id else "") or fallback_url
    blocks = _blocks(raw)
    if not title and not preview and not cover and not blocks:
        return None
    out = {"id": article_id, "title": title, "preview": preview, "cover": cover, "url": url}
    if blocks:
        out["blocks"] = blocks
    return out


def article_from_urls(entities) -> dict | None:
    urls = []
    if isinstance(entities, dict):
        urls = entities.get("urls") or []
    elif isinstance(entities, list):
        urls = entities
    for entry in urls:
        if not isinstance(entry, dict):
            continue
        expanded = entry.get("expanded_url") or entry.get("unwound_url") or entry.get("url") or ""
        article_id = article_id_from_url(expanded)
        if not article_id:
            continue
        images = entry.get("images") or entry.get("image") or []
        cover = ""
        if isinstance(images, list) and images:
            first = images[0]
            cover = first.get("url") if isinstance(first, dict) else str(first or "")
        elif isinstance(images, str):
            cover = images
        return normalize_article(
            {
                "id": article_id,
                "title": entry.get("title") or "",
                "preview_text": entry.get("description") or "",
                "url": expanded,
                "cover_url": cover,
            }
        )
    return None


def article_from_status(status: dict | None) -> dict | None:
    if not isinstance(status, dict):
        return None
    raw = status.get("article")
    if isinstance(raw, dict):
        found = normalize_article(raw)
        if found:
            return found
    return article_from_urls(status.get("entities"))
