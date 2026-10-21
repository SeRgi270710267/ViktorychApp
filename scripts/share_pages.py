#!/usr/bin/env python3
"""Static share pages for crawlers that never run the app.

Writes /s/<platform>-<id>.html, /s/watch-<youtubeId>.html, and
/u/<platform>-<handle>.html into the Pages artifact. The directories are
replaced on every run, so pages for posts that left the snapshot disappear.
Nothing here is committed.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import struct
import urllib.request
import zlib
from pathlib import Path
from urllib.parse import quote, unquote, urlparse, urlunparse

from adapters.common import credit_carried
from archive import canonical_id
from site_paths import pages_base

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE = pages_base()
SITE_NAME = "SuperintelApp"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
SAFE_HANDLE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
PLATFORM = {
    "x": "X",
    "threads": "Threads",
    "instagram": "Instagram",
    "youtube": "YouTube",
    "vk": "VK",
    "rss": "RSS",
    "discord": "Discord",
    "telegram": "Telegram",
}
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
THUMB_LADDER = (
    ("maxresdefault.jpg", 1280, 720),
    ("sddefault.jpg", 640, 480),
    ("hqdefault.jpg", 480, 360),
)
FONT = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "E": ("11111", "10000", "11110", "10000", "10000", "10000", "11111"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
}


def esc(value) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def trim(text: str, limit: int = 200) -> str:
    flat = re.sub(r"\s+", " ", text or "").strip()
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "…"


def rewrite_media_url(url: str) -> str:
    """Turn a Nitter /pic proxy or an http Twitter CDN URL into absolute https."""
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if parsed.scheme == "http" and host in ("pbs.twimg.com", "video.twimg.com"):
        parsed = parsed._replace(scheme="https")
        url = urlunparse(parsed)
        parsed = urlparse(url)
    if "/pic/" not in parsed.path:
        return url
    raw = unquote(parsed.path.split("/pic/", 1)[1]).split("?")[0]
    if raw.startswith("http://"):
        raw = "https://" + raw[len("http://"):]
    if raw.startswith("https://"):
        return raw
    prefixes = ("media/", "amplify_video_thumb/", "ext_tw_video_thumb/", "tweet_video_thumb/", "tweet_video/")
    if raw.startswith(prefixes):
        suffix = "?name=large" if raw.startswith("media/") else ""
        return "https://pbs.twimg.com/" + raw + suffix
    return url


def https(url) -> str:
    """Absolute https media. jsDelivr and the data branch are not preview images."""
    text = rewrite_media_url(str(url or "").strip())
    if text.startswith("//"):
        text = "https:" + text
    if not text.startswith("https://"):
        return ""
    parsed = urlparse(text)
    host = (parsed.netloc or "").lower()
    if host == "cdn.jsdelivr.net":
        return ""
    if host == "raw.githubusercontent.com" and "/data/" in parsed.path:
        return ""
    return text


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", value or "").strip("-")[:120]
    return slug if SAFE_ID.match(slug) else ""


def file_token(post: dict) -> str:
    raw = str(post.get("statusId") or post.get("id") or "").strip()
    if SAFE_ID.match(raw):
        return raw
    ident = canonical_id(post)
    if SAFE_ID.match(ident):
        return ident
    return safe_slug(ident or raw)


def route_id(post: dict) -> str:
    return str(post.get("statusId") or post.get("id") or "").strip()


def platform_name(platform: str) -> str:
    return PLATFORM.get(platform or "", (platform or "web").upper())


def status_hash(platform: str, handle: str, ident: str) -> str:
    handle_part = quote(handle or "", safe="")
    id_part = quote(ident or "", safe="")
    if platform == "x":
        return f"#/@{handle_part}/status/{id_part}"
    return f"#/{quote(platform or 'x', safe='')}/{handle_part}/status/{id_part}"


def profile_hash(platform: str, handle: str) -> str:
    handle_part = quote(handle or "", safe="")
    if platform == "x":
        return f"#/@{handle_part}"
    return f"#/{quote(platform or 'x', safe='')}/{handle_part}"


def watch_hash(ident: str) -> str:
    return "#/watch/youtube:" + ident


def join_url(base: str, name: str) -> str:
    return base.rstrip("/") + "/" + name.lstrip("/")


def parse_size(url: str) -> tuple[int, int]:
    pair = re.search(r"_(\d{2,4})x(\d{2,4})", url or "")
    if pair:
        return int(pair.group(1)), int(pair.group(2))
    square = re.search(r"(?:=s|-)(\d{2,4})-c", url or "")
    if square:
        side = int(square.group(1))
        return side, side
    return 0, 0


def youtube_id(post: dict, token: str) -> str:
    if (post.get("platform") or "") != "youtube":
        return ""
    if YT_ID.match(token):
        return token
    found = re.search(r"(?:vi/|embed/|watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})", str(post.get("url") or ""))
    return found.group(1) if found else ""


def youtube_thumb_url(video_id: str, name: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/{name}"


def image_ok(url: str) -> bool:
    """True when a crawler would receive an image. A missing maxres thumb is a 404 JPEG."""
    try:
        req = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": "facebookexternalhit/1.1"},
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            kind = (res.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            return res.status == 200 and kind.startswith("image/")
    except Exception:
        return False


def choose_youtube_thumb(video_id: str, probe=None) -> dict:
    """Prefer the 1280px poster. Fall down the ladder when that file does not exist."""
    check = probe or image_ok
    chosen = THUMB_LADDER[-1]
    for name, width, height in THUMB_LADDER:
        url = youtube_thumb_url(video_id, name)
        try:
            ok = bool(check(url))
        except Exception:
            ok = False
        if ok:
            chosen = (name, width, height)
            break
    name, width, height = chosen
    return {
        "url": youtube_thumb_url(video_id, name),
        "width": width,
        "height": height,
        "kind": "video",
    }


def picture(post: dict, feed: dict | None, thumb_probe=None) -> dict:
    """First https image or video poster, then the avatar, then the site card."""
    for item in post.get("media") or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "")
        poster = https(item.get("poster"))
        url = https(item.get("url"))
        width = int(item.get("width") or 0)
        height = int(item.get("height") or 0)
        if kind in ("photo", "image") and (url or poster):
            chosen = url or poster
            return sized(chosen, width, height, "image")
        if kind in ("video", "animated_gif"):
            video = youtube_id(post, file_token(post))
            if video:
                return choose_youtube_thumb(video, thumb_probe)
            if poster:
                return sized(poster, width, height, "video")
    avatar = https((feed or {}).get("avatar") or post.get("avatar"))
    if avatar:
        width, height = parse_size(avatar)
        return {"url": avatar, "width": width or 400, "height": height or 400, "kind": "avatar"}
    return {"url": "", "width": 1200, "height": 630, "kind": "brand"}


def sized(url: str, width: int, height: int, kind: str) -> dict:
    if "pbs.twimg.com" in url:
        # name=large is up to 2048px on the long side, which is the wide file crawlers can fetch.
        small = re.search(r"name=(?:small|medium|thumb|tiny)", url)
        promote = False
        if small:
            url = re.sub(r"name=(?:small|medium|thumb|tiny)", "name=large", url)
            promote = True
        elif "name=" not in url:
            url += ("&" if "?" in url else "?") + "name=large"
            promote = True
        if promote and width and height:
            long_side = max(width, height)
            if long_side > 2048 or small:
                scale = 2048 / long_side
                width = int(round(width * scale))
                height = int(round(height * scale))
    if not width or not height:
        parsed_w, parsed_h = parse_size(url)
        width = width or parsed_w
        height = height or parsed_h
    return {"url": url, "width": width, "height": height, "kind": kind}


def video_targets(post: dict, token: str) -> tuple[str, str]:
    """Return (twitter player url or '', mp4 url or '')."""
    video = youtube_id(post, token)
    if video and any(isinstance(item, dict) and item.get("type") in ("video", "animated_gif") for item in (post.get("media") or [])):
        return f"https://www.youtube.com/embed/{video}", ""
    for item in post.get("media") or []:
        if not isinstance(item, dict) or item.get("type") not in ("video", "animated_gif"):
            continue
        url = https(item.get("url"))
        path = url.split("?", 1)[0].lower()
        if path.endswith(".mp4") or "video.twimg.com" in url:
            return "", url
    return "", ""


def title_for(author: str, handle: str, platform: str) -> str:
    name = author or handle or "Post"
    where = platform_name(platform)
    if handle:
        return f"{name} (@{handle}) on {where}"
    return f"{name} on {where}"


def repost_html(post: dict) -> str:
    """The same '<name> reposted' line the app shows above a carried post."""
    by = post.get("repostedBy") if isinstance(post.get("repostedBy"), dict) else None
    if not by:
        return ""
    name = str(by.get("name") or by.get("handle") or "").strip()
    if not name:
        return ""
    label = esc(name) + " reposted"
    handle = str(by.get("handle") or "").lstrip("@")
    platform = str(by.get("platform") or post.get("platform") or "")
    if handle and SAFE_HANDLE.match(handle):
        return f'<p class="repost"><a href="../u/{esc(platform)}-{esc(handle)}.html">{label}</a></p>'
    return f'<p class="repost">{label}</p>'


def rank(post: dict, token: str) -> tuple:
    own = str(post.get("id") or "") == token
    repost = str(post.get("kind") or "") == "repost"
    return (1 if own else 0, 0 if repost else 1)


def feed_for(feeds: list, platform: str, handle: str) -> dict | None:
    handle = (handle or "").lower()
    if not handle:
        return None
    for feed in feeds:
        if (feed.get("platform") or "x") == platform and str(feed.get("handle") or "").lower() == handle:
            return feed
    return None


def png_card() -> bytes:
    width, height = 1200, 630
    word = SITE_NAME.upper()
    mark = 150
    gap = 48
    max_text = width - 128 - mark - gap
    scale = max(4, min(16, max_text // (len(word) * 6 - 1)))
    text_w = len(word) * (5 * scale + scale) - scale
    block = mark + gap + text_w
    origin_x = (width - block) // 2
    origin_y = (height - 7 * scale) // 2
    cx = origin_x + mark // 2
    cy = height // 2
    radius = mark // 2

    def pixel(x: int, y: int) -> tuple[int, int, int]:
        dx = x - cx
        dy = y - cy
        if dx * dx + dy * dy <= radius * radius:
            return (29, 155, 240)
        col = x - (origin_x + mark + gap)
        row = y - origin_y
        if col < 0 or row < 0:
            return (0, 0, 0)
        cell = scale + scale
        index = col // (5 * scale + scale)
        if index < 0 or index >= len(word):
            return (0, 0, 0)
        local_x = col % (5 * scale + scale)
        local_y = row
        if local_x >= 5 * scale or local_y >= 7 * scale:
            return (0, 0, 0)
        glyph = FONT[word[index]]
        if glyph[local_y // scale][local_x // scale] == "1":
            return (255, 255, 255)
        return (0, 0, 0)

    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def meta_tags(page: dict) -> str:
    image = page["image"]
    lines = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="theme-color" content="#000000">',
        '<meta name="referrer" content="no-referrer">',
        f'<title>{esc(page["title"])}</title>',
        f'<link rel="canonical" href="{esc(page["url"])}">',
        '<meta property="og:site_name" content="' + SITE_NAME + '">',
        f'<meta property="og:type" content="{esc(page["og_type"])}">',
        f'<meta property="og:title" content="{esc(page["title"])}">',
        f'<meta property="og:description" content="{esc(page["description"])}">',
        f'<meta property="og:url" content="{esc(page["url"])}">',
        f'<meta property="og:image" content="{esc(image["url"])}">',
        f'<meta property="og:image:alt" content="{esc(page["title"])}">',
    ]
    if image.get("width") and image.get("height"):
        lines.append(f'<meta property="og:image:width" content="{int(image["width"])}">')
        lines.append(f'<meta property="og:image:height" content="{int(image["height"])}">')
    card = "summary_large_image"
    if page.get("player"):
        card = "player"
        lines.append(f'<meta property="og:video" content="{esc(page["player"])}">')
        lines.append(f'<meta property="og:video:secure_url" content="{esc(page["player"])}">')
        lines.append('<meta property="og:video:type" content="text/html">')
        lines.append('<meta property="og:video:width" content="1280">')
        lines.append('<meta property="og:video:height" content="720">')
        lines.append(f'<meta name="twitter:player" content="{esc(page["player"])}">')
        lines.append('<meta name="twitter:player:width" content="1280">')
        lines.append('<meta name="twitter:player:height" content="720">')
    elif page.get("mp4"):
        lines.append(f'<meta property="og:video" content="{esc(page["mp4"])}">')
        lines.append(f'<meta property="og:video:secure_url" content="{esc(page["mp4"])}">')
        lines.append('<meta property="og:video:type" content="video/mp4">')
    lines.append(f'<meta name="twitter:card" content="{card}">')
    lines.append(f'<meta name="twitter:title" content="{esc(page["title"])}">')
    lines.append(f'<meta name="twitter:description" content="{esc(page["description"])}">')
    lines.append(f'<meta name="twitter:image" content="{esc(image["url"])}">')
    return "\n".join(lines)


def page_html(page: dict) -> str:
    image = page["image"]
    media = ""
    if image["kind"] in ("image", "video") and image["url"]:
        media = f'<img class="media" src="{esc(image["url"])}" alt="">'
    banner = ""
    if page.get("banner"):
        banner = f'<img class="banner" src="{esc(page["banner"])}" alt="">'
    avatar = ""
    if page.get("avatar"):
        avatar = f'<img class="avatar" src="{esc(page["avatar"])}" alt="">'
    route = json.dumps(page["hash"]).replace("<", "\\u003c")
    text = page.get("body") or ""
    if page.get("layout") == "article":
        cover = f'<img class="cover" src="{esc(page["cover"])}" alt="">' if page.get("cover") else ""
        full = ""
        if page.get("full_url") and not page.get("has_body"):
            full = f'<a class="open" href="{esc(page["full_url"])}">Read full article on X</a>'
        minutes = f'<p class="mins">{esc(page["minutes"])}</p>' if page.get("minutes") else ""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
{meta_tags(page)}
<style>
  body {{ margin: 0; background: #000; color: #e7e9ea; font: 20px/28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
  article {{ max-width: 600px; margin: 0 auto; padding: 0 0 48px; }}
  .cover {{ width: 100%; aspect-ratio: 2 / 1; object-fit: cover; background: #16181c; display: block; }}
  h1 {{ font-size: 34px; line-height: 40px; font-weight: 800; margin: 20px 16px 8px; }}
  .who {{ display: flex; gap: 12px; align-items: center; margin: 8px 16px 4px; }}
  .avatar {{ width: 40px; height: 40px; border-radius: 999px; object-fit: cover; background: #2f3336; }}
  .name {{ font-size: 15px; font-weight: 700; margin: 0; }}
  .handle {{ color: #71767b; margin: 2px 0 0; font-size: 15px; }}
  .mins {{ color: #71767b; font-size: 15px; margin: 0 16px 12px; }}
  .text {{ white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 16px 16px; }}
  .open {{ display: inline-block; margin: 8px 16px; background: #eff3f4; color: #0f1419; text-decoration: none; font-weight: 700; border-radius: 999px; padding: 10px 18px; font-size: 15px; }}
</style>
</head>
<body>
<article>
  {cover}
  <h1>{esc(page.get("article_title") or page.get("title") or "Article")}</h1>
  <div class="who">{avatar}<div><p class="name">{esc(page.get("author") or "")}</p><p class="handle">{esc(page.get("byline") or "")}</p></div></div>
  {minutes}
  {f'<p class="text">{esc(text)}</p>' if text else ''}
  {full}
  <a class="open" href="{esc(page["open_href"])}">Open in {SITE_NAME}</a>
</article>
<script>
(function () {{
  var ua = navigator.userAgent || "";
  if (/bot|crawl|spider|facebookexternalhit|WhatsApp|Telegram|Slack|Discord|Twitter|vkShare/i.test(ua)) return;
  var path = location.pathname.replace(/\\/(?:s|u)\\/[^/]+$/, "/");
  location.replace(path + {route});
}})();
</script>
</body>
</html>
"""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
{meta_tags(page)}
<style>
  body {{ margin: 0; background: #000; color: #e7e9ea; font: 16px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
  article {{ max-width: 600px; margin: 0 auto; padding: 24px 16px 48px; }}
  .banner {{ width: 100%; height: 160px; object-fit: cover; border-radius: 16px; background: #16181c; }}
  .repost {{ margin: 16px 0 0; color: #71767b; font-size: 13px; font-weight: 700; }}
  .repost a {{ color: inherit; text-decoration: none; }}
  .who {{ display: flex; gap: 12px; align-items: center; margin: 16px 0; }}
  .avatar {{ width: 48px; height: 48px; border-radius: 999px; object-fit: cover; background: #2f3336; }}
  h1 {{ font-size: 18px; line-height: 22px; margin: 0; }}
  .handle {{ color: #71767b; margin: 2px 0 0; }}
  .text {{ white-space: pre-wrap; overflow-wrap: anywhere; }}
  .media {{ width: 100%; border-radius: 16px; margin-top: 12px; background: #16181c; }}
  .open {{ display: inline-block; margin-top: 20px; background: #eff3f4; color: #0f1419; text-decoration: none; font-weight: 700; border-radius: 999px; padding: 10px 18px; }}
</style>
</head>
<body>
<article>
  {banner}
  {page.get("repost_html") or ""}
  <div class="who">{avatar}<div><h1>{esc(page.get("author") or page["title"])}</h1><p class="handle">{esc(page.get("byline") or "")}</p></div></div>
  {f'<p class="text">{esc(text)}</p>' if text else ''}
  {media}
  <a class="open" href="{esc(page["open_href"])}">Open in {SITE_NAME}</a>
</article>
<script>
(function () {{
  var ua = navigator.userAgent || "";
  if (/bot|crawl|spider|facebookexternalhit|WhatsApp|Telegram|Slack|Discord|Twitter|vkShare/i.test(ua)) return;
  var path = location.pathname.replace(/\\/(?:s|u)\\/[^/]+$/, "/");
  location.replace(path + {route});
}})();
</script>
</body>
</html>
"""


def write_page(directory: Path, name: str, page: dict) -> None:
    (directory / name).write_text(page_html(page), encoding="utf-8")


def load_json(path: Path):
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def collect_posts(doc: dict) -> list[dict]:
    chosen = {}
    for post in doc.get("posts") or []:
        if not isinstance(post, dict):
            continue
        token = file_token(post)
        if not token:
            continue
        platform = str(post.get("platform") or "x")
        key = platform + ":" + token
        current = chosen.get(key)
        if current is None or rank(post, token) > rank(current, token):
            chosen[key] = post
    return list(chosen.values())


def build(site: Path, base: str = DEFAULT_BASE, thumb_probe=None) -> dict:
    site.mkdir(parents=True, exist_ok=True)
    for name in ("s", "u"):
        folder = site / name
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
    icons = site / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    card_name = "icons/og-card.png"
    (site / card_name).write_bytes(png_card())
    brand = join_url(base, card_name)

    doc = load_json(site / "feeds.json")
    if not isinstance(doc, dict):
        doc = load_json(ROOT / "feeds.json") or {}
    feeds = [feed for feed in (doc.get("feeds") or []) if isinstance(feed, dict)]
    credit_carried(doc.get("posts") or [], feeds)
    posts = collect_posts(doc)
    counts = {"posts": 0, "watch": 0, "profiles": 0, "stubs": 0}

    seen = set()
    for post in posts:
        platform = str(post.get("platform") or "x")
        token = file_token(post)
        handle = str(post.get("handle") or "").lstrip("@")
        feed = feed_for(feeds, platform, handle)
        image = picture(post, feed, thumb_probe)
        if not image["url"]:
            image = {"url": brand, "width": 1200, "height": 630, "kind": "brand"}
        player, mp4 = video_targets(post, token)
        description = trim(str(post.get("text") or post.get("title") or "")) or ("Post on " + SITE_NAME)
        route = status_hash(platform, handle, route_id(post))
        author = str(post.get("author") or handle or "Post")
        page = {
            "title": title_for(author, handle, platform),
            "description": description,
            "url": join_url(base, f"s/{platform}-{token}.html"),
            "image": image,
            "og_type": "video.other" if player or mp4 else "article",
            "player": player,
            "mp4": mp4,
            "hash": route,
            "open_href": "../" + route,
            "author": author,
            "byline": (f"@{handle} · {platform_name(platform)}") if handle else platform_name(platform),
            "avatar": https((feed or {}).get("avatar") or post.get("avatar")),
            "body": re.sub(r"\s+\n", "\n", str(post.get("text") or post.get("title") or "")).strip()[:2000],
            "repost_html": repost_html(post),
        }
        write_page(site / "s", f"{platform}-{token}.html", page)
        seen.add(platform + ":" + token)
        counts["posts"] += 1
        article = post.get("article") if isinstance(post.get("article"), dict) else None
        if article and (article.get("title") or article.get("cover")):
            article_id = safe_slug(str(article.get("id") or token))
            if article_id:
                blocks = article.get("blocks") if isinstance(article.get("blocks"), list) else []
                words = []
                for block in blocks:
                    if isinstance(block, dict) and block.get("text"):
                        words.append(str(block.get("text")))
                body = "\n\n".join(words).strip()
                if not body:
                    body = str(article.get("preview") or "").strip()
                count = len(body.split())
                minutes = (str(max(1, round(count / 220))) + " min read") if count else ""
                route = "#/article/" + quote(str(article.get("id") or route_id(post)), safe="")
                article_page = dict(page)
                article_page.update({
                    "layout": "article",
                    "title": str(article.get("title") or page["title"]),
                    "article_title": str(article.get("title") or "Article"),
                    "description": trim(str(article.get("preview") or body)) or page["description"],
                    "url": join_url(base, f"s/article-{article_id}.html"),
                    "hash": route,
                    "open_href": "../" + route,
                    "cover": https(article.get("cover")),
                    "body": body[:8000],
                    "has_body": any(isinstance(block, dict) and block.get("type") not in ("embed",) and block.get("text") for block in blocks),
                    "full_url": str(article.get("url") or post.get("url") or ""),
                    "minutes": minutes,
                })
                cover = article_page["cover"]
                if cover:
                    article_page["image"] = {"url": cover, "width": 1600, "height": 800, "kind": "image"}
                write_page(site / "s", f"article-{article_id}.html", article_page)
                counts["articles"] = counts.get("articles", 0) + 1
        video = youtube_id(post, token)
        if player and video:
            watch = dict(page)
            watch_route = watch_hash(video)
            watch["hash"] = watch_route
            watch["open_href"] = "../" + watch_route
            watch["url"] = join_url(base, f"s/watch-{video}.html")
            write_page(site / "s", f"watch-{video}.html", watch)
            counts["watch"] += 1

    for feed in feeds:
        platform = str(feed.get("platform") or "x")
        handle = str(feed.get("handle") or "").lstrip("@")
        if not SAFE_HANDLE.match(handle):
            continue
        banner = https(feed.get("banner"))
        avatar = https(feed.get("avatar"))
        if banner:
            image = {"url": banner, "width": 1280, "height": 720, "kind": "image"}
        elif avatar:
            width, height = parse_size(avatar)
            image = {"url": avatar, "width": width or 400, "height": height or 400, "kind": "avatar"}
        else:
            image = {"url": brand, "width": 1200, "height": 630, "kind": "brand"}
        route = profile_hash(platform, handle)
        name = str(feed.get("name") or handle)
        bio = trim(str(feed.get("bio") or "")) or f"{name} on {platform_name(platform)}"
        write_page(site / "u", f"{platform}-{handle}.html", {
            "title": title_for(name, handle, platform),
            "description": bio,
            "url": join_url(base, f"u/{platform}-{handle}.html"),
            "image": image,
            "og_type": "profile",
            "player": "",
            "mp4": "",
            "hash": route,
            "open_href": "../" + route,
            "author": name,
            "byline": f"@{handle} · {platform_name(platform)}",
            "avatar": avatar,
            "banner": banner,
            "body": str(feed.get("bio") or "").strip()[:2000],
        })
        counts["profiles"] += 1

    archive = site / "archive"
    if not archive.is_dir():
        archive = ROOT / "archive"
    if archive.is_dir():
        for path in sorted(archive.glob("*.json")):
            if path.name == "index.json":
                continue
            rows = load_json(path)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                platform = str(row.get("p") or "")
                raw_id = str(row.get("id") or "")
                token = raw_id if SAFE_ID.match(raw_id) else safe_slug(raw_id)
                if not SAFE_ID.match(platform) or not token:
                    continue
                key = platform + ":" + token
                if key in seen:
                    continue
                handle = str(row.get("h") or "").lstrip("@")
                feed = feed_for(feeds, platform, handle)
                avatar = https((feed or {}).get("avatar"))
                if avatar:
                    width, height = parse_size(avatar)
                    image = {"url": avatar, "width": width or 400, "height": height or 400, "kind": "avatar"}
                else:
                    image = {"url": brand, "width": 1200, "height": 630, "kind": "brand"}
                text = str(row.get("t") or "")
                author = handle or "Post"
                route = status_hash(platform, handle, raw_id)
                write_page(site / "s", f"{platform}-{token}.html", {
                    "title": title_for(author, handle, platform),
                    "description": trim(text) or ("Post on " + SITE_NAME),
                    "url": join_url(base, f"s/{platform}-{token}.html"),
                    "image": image,
                    "og_type": "article",
                    "player": "",
                    "mp4": "",
                    "hash": route,
                    "open_href": "../" + route,
                    "author": author,
                    "byline": (f"@{handle} · {platform_name(platform)}") if handle else platform_name(platform),
                    "avatar": avatar,
                    "body": text[:2000],
                })
                seen.add(key)
                counts["stubs"] += 1
    counts["spaces"] = write_space_pages(site, base, brand)
    return counts


def write_space_pages(site: Path, base: str, brand: str) -> int:
    """Crawler pages for Spaces. Title and cover only — never a track name."""
    config = load_json(site / "feeds.config.json")
    if not isinstance(config, dict):
        config = load_json(ROOT / "feeds.config.json") or {}
    count = 0
    for space in config.get("spaces") or []:
        if not isinstance(space, dict):
            continue
        ident = str(space.get("id") or "")
        if not SAFE_ID.match(ident):
            continue
        title = str(space.get("title") or "Space").strip() or "Space"
        cover = str(space.get("cover") or "").strip()
        image_url = https(cover)
        if not image_url and cover and not cover.startswith(("http://", "https://", "//")):
            image_url = "../" + cover.lstrip("/")
        route = "#/spaces/" + quote(ident, safe="")
        write_page(site / "s", f"space-{ident}.html", {
            "title": title,
            "description": "Live Space",
            "url": f"space-{ident}.html",
            "image": {"url": image_url, "width": 320, "height": 320, "kind": "image"},
            "og_type": "website",
            "player": "",
            "mp4": "",
            "hash": route,
            "open_href": "../" + route,
            "author": title,
            "byline": "Live Space",
            "avatar": image_url,
            "body": "",
        })
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Write crawler-readable share pages into the site artifact.")
    parser.add_argument("--site", default=str(ROOT / "_site"))
    parser.add_argument("--base", default=DEFAULT_BASE)
    args = parser.parse_args()
    counts = build(Path(args.site), args.base)
    print(
        "share pages: {posts} posts, {watch} watch pages, {profiles} profiles, {stubs} stubs, {spaces} spaces".format(**counts)
    )


if __name__ == "__main__":
    main()
