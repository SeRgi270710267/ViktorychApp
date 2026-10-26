#!/usr/bin/env python3
"""Mirror public subreddits.

The official Data API (app-only client_credentials) is first. When it is
missing or fails, public feeds are tried in order: Reddit's own RSS, the
public RSSHub instance, the public RSS-Bridge instance, Redlib frontends,
then embed mirrors for media. Instances are the ones FMHY lists as
maintained. This file only speaks HTTP to those public URLs. It does not
copy their source, send a Cookie, post to Reddit, or read a listing page
from reddit.com.
"""

from __future__ import annotations

import base64
import email.utils
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "communities"
BUILTIN = ("teslamotors",)
UA = "web:viktorychapp:v1 (by /u/owner-account)"
NAME_RE = re.compile(r"^[A-Za-z0-9_]{2,21}$")
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
API = "https://oauth.reddit.com"
# Public instances named by FMHY (reddit frontends and RSS generators), not copied code.
# Redlib list: redlib-instances, refreshed 2026-10-23, https only, no onion, no Cloudflare challenge.
DEFAULT_COMMUNITIES = {
    "paceSeconds": 2,
    "cacheSeconds": 900,
    "rsshubBase": "https://rsshub.app",
    "redlib": [
        "https://redlib.fmhy.net",
        "https://safereddit.com",
        "https://redlib.catsarch.com",
        "https://redlib.ducks.party",
    ],
    "embeds": [
        "https://vxreddit.com",
        "https://rxddit.com",
    ],
    "fallbacks": [
        {
            "adapter": "reddit_rss",
            "source_urls": [
                "https://www.reddit.com/r/{name}/.rss",
                "https://www.reddit.com/r/{name}/new/.rss",
            ],
        },
        {
            "adapter": "rsshub_reddit",
            "source_urls": ["{rsshubBase}/reddit/subreddit/{name}?format=atom"],
        },
        {
            "adapter": "rss_bridge",
            "source_urls": [
                "https://rss-bridge.org/bridge01/?action=display&bridge=RedditBridge&context=single&r={name}&d=new&format=Atom"
            ],
        },
        {"adapter": "redlib", "source_urls": ["{redlib}/r/{name}/rss"]},
        {"adapter": "reddit_embed", "source_urls": ["{embed}/r/{name}"]},
    ],
    "items": [{"name": "teslamotors"}],
}
BLOCK_MARKERS = ("just a moment", "cf-challenge", "captcha", "attention required", "verify you are human")
MEDIA_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mpd")


def community_name(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^https?://(?:www\.|old\.)?reddit\.com/r/", "", text, flags=re.I)
    text = re.sub(r"^/?r/", "", text, flags=re.I)
    text = text.split("/")[0].split("?")[0].split("#")[0]
    if not NAME_RE.match(text):
        return ""
    return text.lower()


def sensitive_allowed() -> bool:
    return (os.environ.get("REDDIT_INCLUDE_SENSITIVE") or "").strip() == "1"


def credentials() -> tuple[str, str]:
    return (os.environ.get("REDDIT_CLIENT_ID") or "").strip(), (os.environ.get("REDDIT_CLIENT_SECRET") or "").strip()


def _request(url: str, data: bytes | None = None, headers: dict | None = None) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return res.status, dict(res.headers.items()), raw
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers.items()), exc.read()


def honor_limit(status: int, headers: dict) -> None:
    lowered = {str(key).lower(): value for key, value in (headers or {}).items()}
    if status == 429:
        try:
            delay = float(lowered.get("retry-after") or 5)
        except ValueError:
            delay = 5
        time.sleep(min(60.0, max(1.0, delay)))
        return
    try:
        remaining = float(lowered.get("x-ratelimit-remaining") or 99)
    except ValueError:
        remaining = 99
    if remaining < 2:
        try:
            reset = float(lowered.get("x-ratelimit-reset") or 2)
        except ValueError:
            reset = 2
        time.sleep(min(30.0, max(0.5, reset)))


def access_token(client_id: str, secret: str) -> str:
    basic = base64.b64encode(f"{client_id}:{secret}".encode("utf-8")).decode("ascii")
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    status, headers, raw = _request(TOKEN_URL, body, {
        "Authorization": "Basic " + basic,
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
    })
    honor_limit(status, headers)
    if status != 200:
        return ""
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return ""
    token = str((parsed or {}).get("access_token") or "")
    return token if (parsed or {}).get("token_type", "bearer").lower() == "bearer" else ""


def api_get(token: str, path: str) -> dict | None:
    status, headers, raw = _request(API + path, None, {
        "Authorization": "Bearer " + token,
        "User-Agent": UA,
    })
    honor_limit(status, headers)
    if status == 429:
        status, headers, raw = _request(API + path, None, {
            "Authorization": "Bearer " + token,
            "User-Agent": UA,
        })
        honor_limit(status, headers)
    if status != 200:
        return None
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, (dict, list)) else None


def reddit_host(host: str) -> bool:
    """True for reddit.com and redd.it, not for names that merely end with those letters."""
    name = (host or "").lower().rstrip(".")
    for suffix in ("reddit.com", "redd.it", "redditmedia.com"):
        if name == suffix or name.endswith("." + suffix):
            return True
    return False


def https_url(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("http://"):
        text = "https://" + text[7:]
    if not text.startswith("https://"):
        return ""
    host = urllib.parse.urlparse(text).hostname or ""
    if reddit_host(host):
        return text
    return ""


def pick_media(data: dict) -> list[dict]:
    found: list[dict] = []
    preview = data.get("preview") if isinstance(data.get("preview"), dict) else {}
    images = preview.get("images") if isinstance(preview.get("images"), list) else []
    for image in images:
        if not isinstance(image, dict):
            continue
        source = image.get("source") if isinstance(image.get("source"), dict) else {}
        url = https_url(str(source.get("url") or "").replace("&amp;", "&"))
        if url:
            found.append({"type": "photo", "url": url})
    meta = data.get("media_metadata") if isinstance(data.get("media_metadata"), dict) else {}
    gallery = data.get("gallery_data") if isinstance(data.get("gallery_data"), dict) else {}
    items = gallery.get("items") if isinstance(gallery.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = meta.get(str(item.get("media_id") or ""))
        if not isinstance(row, dict):
            continue
        source = row.get("s") if isinstance(row.get("s"), dict) else {}
        url = https_url(str(source.get("u") or source.get("gif") or "").replace("&amp;", "&"))
        if url:
            found.append({"type": "photo", "url": url})
    secure = data.get("secure_media") if isinstance(data.get("secure_media"), dict) else {}
    video = secure.get("reddit_video") if isinstance(secure.get("reddit_video"), dict) else {}
    if not video:
        media = data.get("media") if isinstance(data.get("media"), dict) else {}
        video = media.get("reddit_video") if isinstance(media.get("reddit_video"), dict) else {}
    dash = https_url(str(video.get("dash_url") or ""))
    fallback = https_url(str(video.get("fallback_url") or ""))
    if dash or fallback:
        found.append({"type": "video", "url": fallback or dash, "dash": dash})
    direct = https_url(str(data.get("url") or ""))
    if direct and "i.redd.it" in direct and not any(row.get("url") == direct for row in found):
        found.append({"type": "photo", "url": direct})
    uniq = []
    seen = set()
    for row in found:
        if row["url"] in seen:
            continue
        seen.add(row["url"])
        uniq.append(row)
    return uniq


def keep_post(data: dict) -> bool:
    if not isinstance(data, dict):
        return False
    if data.get("stickied"):
        return False
    if not sensitive_allowed() and (data.get("over_18") or data.get("spoiler")):
        return False
    return bool(data.get("name") or data.get("id"))


def post_from(data: dict) -> dict:
    created = int(float(data.get("created_utc") or 0))
    name = str(data.get("name") or "")
    if not name.startswith("t3_"):
        name = "t3_" + str(data.get("id") or "")
    return {
        "id": name,
        "title": str(data.get("title") or "")[:300],
        "text": str(data.get("selftext") or "")[:4000],
        "author": str(data.get("author") or "")[:32],
        "score": int(data.get("score") or 0),
        "comments": int(data.get("num_comments") or 0),
        "created": created,
        "flair": str(data.get("link_flair_text") or "")[:40],
        "url": "https://www.reddit.com" + str(data.get("permalink") or ""),
        "media": pick_media(data),
    }


def comments_from(node, depth: int, cap: int, out: list) -> None:
    if depth > 3 or len(out) >= cap or not isinstance(node, dict):
        return
    children = ((node.get("data") or {}).get("children") or []) if "data" in node else []
    if isinstance(node.get("children"), list):
        children = node.get("children") or []
    for child in children:
        if len(out) >= cap:
            return
        if not isinstance(child, dict) or child.get("kind") != "t1":
            continue
        data = child.get("data") if isinstance(child.get("data"), dict) else {}
        if not sensitive_allowed() and data.get("over_18"):
            continue
        parent = str(data.get("parent_id") or "")
        out.append({
            "id": str(data.get("name") or ("t1_" + str(data.get("id") or ""))),
            "parent": parent,
            "author": str(data.get("author") or "")[:32],
            "text": str(data.get("body") or "")[:4000],
            "score": int(data.get("score") or 0),
            "created": int(float(data.get("created_utc") or 0)),
        })
        replies = data.get("replies")
        if isinstance(replies, dict):
            comments_from(replies, depth + 1, cap, out)


def listing_posts(payload) -> list[dict]:
    children = (((payload or {}).get("data") or {}).get("children") or []) if isinstance(payload, dict) else []
    posts = []
    for child in children:
        if not isinstance(child, dict) or child.get("kind") != "t3":
            continue
        data = child.get("data") if isinstance(child.get("data"), dict) else {}
        if not keep_post(data):
            continue
        posts.append(post_from(data))
        if len(posts) >= 50:
            break
    return posts


def dash_mux_args(video: str, audio: str, dest: str) -> list[str]:
    return ["ffmpeg", "-y", "-i", video, "-i", audio, "-c", "copy", "-movflags", "+faststart", dest]


def dash_pairs(mpd: str, page: str) -> tuple[str, str]:
    """Highest-bandwidth video and audio BaseURL from a v.redd.it DASH manifest."""
    video = ("", -1)
    audio = ("", -1)
    base = page.rsplit("/", 1)[0] + "/"
    sets = re.findall(r"<AdaptationSet\b([^>]*)>(.*?)</AdaptationSet>", mpd or "", flags=re.I | re.S)
    for attrs, body in sets:
        kind = "audio" if "audio" in attrs.lower() else "video"
        for rep_attrs, rep_body in re.findall(r"<Representation\b([^>]*)>(.*?)</Representation>", body, flags=re.I | re.S):
            found = re.search(r'bandwidth="(\d+)"', rep_attrs, flags=re.I)
            bandwidth = int(found.group(1)) if found else 0
            loc = re.search(r"<BaseURL>([^<]+)</BaseURL>", rep_body, flags=re.I)
            if not loc:
                continue
            raw = loc.group(1).strip()
            url = raw if raw.startswith("https://") else urllib.parse.urljoin(base, raw)
            url = https_url(url)
            if not url:
                continue
            current = audio if kind == "audio" else video
            if bandwidth < current[1]:
                continue
            if kind == "audio":
                audio = (url, bandwidth)
            else:
                video = (url, bandwidth)
    return video[0], audio[0]


def download_https(url: str, dest: Path, limit: int = 200 * 1024 * 1024) -> int:
    url = https_url(url)
    if not url:
        return 0
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            status = getattr(res, "status", 200)
            if status != 200:
                return status
            total = 0
            with dest.open("wb") as out:
                while True:
                    chunk = res.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit:
                        dest.unlink(missing_ok=True)
                        return 413
                    out.write(chunk)
            return 200 if dest.is_file() and dest.stat().st_size else 0
    except urllib.error.HTTPError as exc:
        dest.unlink(missing_ok=True)
        return int(exc.code or 0)
    except (OSError, urllib.error.URLError):
        dest.unlink(missing_ok=True)
        return 0


def prepare_video(media: dict, dest: Path) -> bool:
    dash = https_url(str(media.get("dash") or ""))
    fallback = https_url(str(media.get("url") or ""))
    if dash:
        status, _headers, raw = _request(dash, None, {"User-Agent": UA, "Accept": "application/dash+xml,*/*"})
        if status == 200 and raw:
            video_url, audio_url = dash_pairs(raw.decode("utf-8", "replace"), dash)
            video = dest.with_suffix(".video.mp4")
            audio = dest.with_suffix(".audio.mp4")
            if video_url and audio_url and download_https(video_url, video) == 200 and download_https(audio_url, audio) == 200:
                if mux_dash(video, audio, dest):
                    video.unlink(missing_ok=True)
                    audio.unlink(missing_ok=True)
                    return True
            video.unlink(missing_ok=True)
            audio.unlink(missing_ok=True)
    if fallback and fallback != dash and download_https(fallback, dest) == 200:
        return True
    dest.unlink(missing_ok=True)
    return False


def media_key(name: str, post_id: str, role: str, index: int) -> str:
    if not community_name(name) or role not in ("photo", "video"):
        return ""
    if not re.fullmatch(r"t3_[A-Za-z0-9]{1,12}", str(post_id or "")):
        return ""
    if index < 0 or index > 20:
        return ""
    return f"social/reddit/{community_name(name)}/{post_id}/{role}/{index}"


def mux_dash(video: Path, audio: Path, dest: Path) -> bool:
    if not video.is_file() or not audio.is_file():
        return False
    try:
        proc = subprocess.run(dash_mux_args(str(video), str(audio), str(dest)), capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0 and dest.is_file()


def load_communities_config() -> dict:
    raw = {}
    try:
        doc = json.loads((ROOT / "feeds.config.json").read_text(encoding="utf-8"))
        if isinstance(doc.get("communities"), dict):
            raw = doc["communities"]
    except (OSError, json.JSONDecodeError):
        raw = {}
    cfg = json.loads(json.dumps(DEFAULT_COMMUNITIES))
    for key in ("paceSeconds", "cacheSeconds", "rsshubBase", "redlib", "embeds", "fallbacks", "items"):
        if key in raw:
            cfg[key] = raw[key]
    return cfg


def added_names(cfg: dict | None = None) -> list[str]:
    cfg = cfg or load_communities_config()
    names = []
    for item in cfg.get("items") or []:
        name = community_name(item.get("name") if isinstance(item, dict) else item)
        if name and name not in names:
            names.append(name)
    if not names:
        names = [community_name(item) for item in BUILTIN]
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        from tiktok_sync import r2_get
        raw = r2_get("owner/added-communities.json")
    except Exception:
        raw = None
    removed = set()
    if raw:
        try:
            doc = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            doc = {}
        for item in doc.get("removed") or []:
            name = community_name(item if isinstance(item, str) else "")
            if name:
                removed.add(name)
        for item in doc.get("added") or []:
            name = community_name((item or {}).get("name") if isinstance(item, dict) else "")
            if name and name not in names:
                names.append(name)
    return [name for name in names if name and name not in removed]


def discourse_forums() -> list[dict]:
    """Forums mirrored by discourse_sync.py; they are owned by that job, not by Reddit."""
    rows: list[dict] = []
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        from discourse_sync import DISCOURSE_FORUMS
        for cfg in DISCOURSE_FORUMS:
            if isinstance(cfg, dict) and community_name(cfg.get("name") or ""):
                rows.append(cfg)
    except Exception:
        pass
    return rows


def discourse_row(cfg: dict) -> dict:
    name = community_name(cfg.get("name") or "")
    return {
        "name": name,
        "title": cfg.get("title") or name,
        "type": "discourse",
        "subscribers": int(cfg.get("subscribers") or 35000),
        "icon": cfg.get("icon") or "",
        "banner": cfg.get("banner") or "",
        "about": cfg.get("about") or ""
    }


def write_index(names: list[str], docs: dict[str, dict]) -> None:
    existing = {}
    index_path = OUT / "index.json"
    if index_path.exists():
        try:
            curr = json.loads(index_path.read_text(encoding="utf-8"))
            for item in curr.get("communities", []):
                if isinstance(item, dict) and item.get("name"):
                    existing[item["name"]] = item
        except Exception:
            pass

    forums = discourse_forums()
    discourse = {community_name(cfg.get("name") or "") for cfg in forums}
    # A configured forum stays in the index even before its own sync has run.
    for cfg in forums:
        row = discourse_row(cfg)
        if row["name"]:
            existing.setdefault(row["name"], row)
    for p in OUT.glob("*.json"):
        if p.name == "index.json":
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict) and d.get("name"):
                d_name = d["name"]
                if d.get("type") == "discourse" or d_name in discourse:
                    existing[d_name] = {
                        "name": d_name,
                        "title": d.get("title") or d_name,
                        "type": "discourse",
                        "subscribers": int(d.get("subscribers") or 35000),
                        "icon": d.get("icon") or "",
                        "banner": d.get("banner") or "",
                        "about": d.get("about") or ""
                    }
        except Exception:
            pass

    rows = []
    for name in names:
        doc = docs.get(name) or {}
        prev = existing.pop(name, {})
        row = {
            "name": name,
            "title": doc.get("title") or prev.get("title") or name,
            "subscribers": int(doc.get("subscribers") or prev.get("subscribers") or 0),
            "icon": doc.get("icon") or prev.get("icon") or "",
        }
        if doc.get("type") or prev.get("type"):
            row["type"] = doc.get("type") or prev.get("type")
        if doc.get("banner") or prev.get("banner"):
            row["banner"] = doc.get("banner") or prev.get("banner")
        if doc.get("about") or prev.get("about"):
            row["about"] = doc.get("about") or prev.get("about")
        rows.append(row)

    for item in existing.values():
        rows.append(item)

    OUT.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps({"communities": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def community_doc(name: str, about: dict, rules_payload: dict, hot: list, new: list, threads: dict) -> dict:
    data = ((about or {}).get("data") or {}) if isinstance(about, dict) else {}
    rules = []
    for row in ((rules_payload or {}).get("rules") or []) if isinstance(rules_payload, dict) else []:
        if not isinstance(row, dict):
            continue
        rules.append({"title": str(row.get("short_name") or "")[:80], "text": str(row.get("description") or "")[:500]})
    by_id = {}
    for post in hot + new:
        by_id[post["id"]] = post
    posts = list(by_id.values())[:50]
    for post in posts:
        post["replies"] = threads.get(post["id"]) or []
    return {
        "name": name,
        "title": str(data.get("title") or name)[:80],
        "subscribers": int(data.get("subscribers") or 0),
        "icon": https_url(str(data.get("community_icon") or data.get("icon_img") or "").split("?")[0]),
        "banner": https_url(str(data.get("banner_background_image") or data.get("banner_img") or "").split("?")[0]),
        "about": str(data.get("public_description") or "")[:1000],
        "rules": rules[:20],
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "posts": posts,
    }


def sync_one(token: str, name: str) -> dict | None:
    about = api_get(token, f"/r/{name}/about")
    if not about:
        return None
    rules = api_get(token, f"/r/{name}/about/rules") or {}
    hot = listing_posts(api_get(token, f"/r/{name}/hot?limit=50&raw_json=1"))
    new = listing_posts(api_get(token, f"/r/{name}/new?limit=50&raw_json=1"))
    threads = {}
    for post in (hot + new)[:50]:
        bare = post["id"][3:] if post["id"].startswith("t3_") else post["id"]
        payload = api_get(token, f"/r/{name}/comments/{bare}?limit=50&depth=3&raw_json=1&sort=top")
        replies = []
        if isinstance(payload, list) and len(payload) > 1:
            comments_from(payload[1], 1, 50, replies)
        threads[post["id"]] = replies
    return community_doc(name, about, rules, hot, new, threads)


def backup_originals(directory: Path, publish) -> int:
    """Hand original images and remuxed v.redd.it files to the media pipeline.

    publish(path, info) stores one local file. A missing communities directory
    does nothing. 403, 429, and 503 downloads are skipped.
    """
    stored = 0
    if not OUT.is_dir():
        return 0
    directory.mkdir(parents=True, exist_ok=True)
    for path in sorted(OUT.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        name = community_name(str(doc.get("name") or path.stem))
        for post in doc.get("posts") or []:
            if not isinstance(post, dict):
                continue
            photo_i = 0
            video_i = 0
            for media in post.get("media") or []:
                if not isinstance(media, dict):
                    continue
                role = "video" if media.get("type") == "video" else "photo"
                index = video_i if role == "video" else photo_i
                key = media_key(name, str(post.get("id") or ""), role, index)
                if not key:
                    continue
                dest = directory / (key.replace("/", "_"))
                ready = False
                if role == "photo":
                    status = download_https(str(media.get("url") or ""), dest)
                    ready = status == 200
                    if status in (403, 429, 503):
                        ready = False
                else:
                    ready = prepare_video(media, dest)
                if role == "video":
                    video_i += 1
                else:
                    photo_i += 1
                if not ready:
                    continue
                result = publish(dest, {"key": key, "role": role, "id": post.get("id") or "", "community": name})
                if result == "stop":
                    return stored
                if result == "ok":
                    stored += 1
    return stored


def local_name(tag: str) -> str:
    return str(tag or "").rsplit("}", 1)[-1]


def host_of(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower()


def looks_like_feed(text: str) -> bool:
    head = (text or "").lstrip()[:300].lower()
    return head.startswith("<?xml") or "<rss" in head or "<feed" in head


def blocked_page(status: int, body: bytes) -> bool:
    if status in (403, 429):
        return True
    if status != 200 or not body:
        return False
    text = body.decode("utf-8", "replace")
    if looks_like_feed(text):
        return False
    sample = text[:4000].lower()
    return any(mark in sample for mark in BLOCK_MARKERS)


def retry_after(headers: dict) -> float:
    lowered = {str(key).lower(): value for key, value in (headers or {}).items()}
    try:
        return float(lowered.get("retry-after") or 600)
    except (TypeError, ValueError):
        return 600


def expand_template(template: str, cfg: dict, name: str) -> list[str]:
    rsshub = str(cfg.get("rsshubBase") or DEFAULT_COMMUNITIES["rsshubBase"]).rstrip("/")
    text = str(template or "").replace("{name}", name).replace("{rsshubBase}", rsshub)
    urls = []
    if "{redlib}" in text:
        for base in cfg.get("redlib") or []:
            urls.append(text.replace("{redlib}", str(base).rstrip("/")))
    elif "{embed}" in text:
        for base in cfg.get("embeds") or []:
            urls.append(text.replace("{embed}", str(base).rstrip("/")))
    else:
        urls.append(text)
    clean = []
    for url in urls:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme == "https" and parsed.hostname and not parsed.username:
            clean.append(url)
    return clean


def fallback_rows(cfg: dict, name: str) -> list[dict]:
    for item in cfg.get("items") or []:
        if isinstance(item, dict) and community_name(str(item.get("name") or "")) == name and item.get("fallbacks"):
            return item["fallbacks"]
    rows = cfg.get("fallbacks") or DEFAULT_COMMUNITIES["fallbacks"]
    return rows if isinstance(rows, list) else []


def fallback_plan(cfg: dict, name: str) -> list[tuple[str, list[str]]]:
    plan = []
    for row in fallback_rows(cfg, name):
        if not isinstance(row, dict):
            continue
        adapter = str(row.get("adapter") or "")
        urls = []
        for template in row.get("source_urls") or []:
            urls.extend(expand_template(str(template), cfg, name))
        if adapter and urls:
            plan.append((adapter, urls))
    return plan


def media_url(value: str) -> str:
    text = https_url(str(value or "").replace("&amp;", "&").rstrip(").,;"))
    if not text:
        return ""
    parsed = urllib.parse.urlparse(text)
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    if host.startswith("i.redd.it") or host.startswith("preview.redd.it") or host.startswith("v.redd.it"):
        return text
    if path.endswith(MEDIA_EXT) and reddit_host(host):
        return text
    return ""


def media_item(url: str) -> dict:
    path = urllib.parse.urlparse(url).path.lower()
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host.startswith("v.redd.it") or path.endswith(".mp4") or path.endswith(".mpd"):
        return {"type": "video", "url": "" if path.endswith(".mpd") else url, "dash": url if path.endswith(".mpd") else ""}
    return {"type": "photo", "url": url}


def collect_media(urls: list[str]) -> list[dict]:
    found = []
    seen = set()
    for raw in urls:
        url = media_url(raw)
        if not url or url in seen:
            continue
        seen.add(url)
        found.append(media_item(url))
    photos = [row["url"] for row in found if row["type"] == "photo"]
    if any("i.redd.it" in url for url in photos):
        found = [row for row in found if row["type"] != "photo" or "preview.redd.it" not in row["url"]]
    return found


def clean_author(value: str) -> str:
    text = re.sub(r"^/?u/", "", str(value or "").strip(), flags=re.I)
    return text[:32]


def plain_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def parse_time(value: str) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        if text.endswith("Z") or "T" in text:
            return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except ValueError:
        pass
    try:
        parsed = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError, OverflowError):
        return 0
    if parsed is None:
        return 0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def child_text(entry, tag: str) -> str:
    for child in list(entry):
        if local_name(child.tag) == tag:
            return "".join(child.itertext()).strip()
    return ""


def entry_link(entry) -> str:
    for child in list(entry):
        if local_name(child.tag) != "link":
            continue
        href = str(child.attrib.get("href") or "").strip()
        if href:
            return href
        text = (child.text or "").strip()
        if text.startswith("http"):
            return text
    return ""


def thing_id(entry, link: str, kind: str) -> str:
    raw = child_text(entry, "id") or child_text(entry, "guid")
    found = re.search(r"\b(t[13]_[A-Za-z0-9]{1,12})\b", raw)
    if found and found.group(1).startswith(kind):
        return found.group(1)
    if kind == "t3_":
        match = re.search(r"/comments/([A-Za-z0-9]{1,12})", link)
        if match:
            return "t3_" + match.group(1)
    return ""


def marked_sensitive(entry, title: str) -> bool:
    blob = title.lower()
    for child in entry.iter():
        if local_name(child.tag) != "category":
            continue
        blob += " " + str(child.attrib.get("term") or "") + " " + str(child.attrib.get("label") or "")
        blob += " " + "".join(child.itertext())
    return any(mark in blob.lower() for mark in ("nsfw", "spoiler", "over_18"))


def entry_media(entry) -> list[dict]:
    urls = []
    for el in entry.iter():
        for key, value in el.attrib.items():
            if key.lower() in ("url", "href", "src") or key.lower().endswith("url"):
                urls.append(str(value))
        if el.text and "http" in el.text:
            urls.extend(re.findall(r"https://[^\s\"'<>]+", el.text))
    return collect_media(urls)


def entry_flair(entry, name: str) -> str:
    for child in list(entry):
        if local_name(child.tag) != "category":
            continue
        term = str(child.attrib.get("term") or child.attrib.get("label") or "").strip()
        if term and term.lower() not in (name, "r/" + name, "nsfw", "spoiler"):
            return term[:40]
    return ""


def post_from_entry(entry, name: str) -> dict | None:
    link = entry_link(entry)
    ident = thing_id(entry, link, "t3_")
    if not ident or ident.startswith("t1_"):
        return None
    title = child_text(entry, "title")[:300]
    if not sensitive_allowed() and marked_sensitive(entry, title):
        return None
    author = clean_author(child_text(entry, "author") or child_text(entry, "creator"))
    created = parse_time(child_text(entry, "updated") or child_text(entry, "published") or child_text(entry, "pubDate"))
    bare = ident[3:]
    return {
        "id": ident,
        "title": title,
        "author": author,
        "score": 0,
        "comments": 0,
        "created": created,
        "flair": entry_flair(entry, name),
        "url": f"https://www.reddit.com/r/{name}/comments/{bare}/",
        "media": entry_media(entry),
        "text": plain_text(child_text(entry, "content") or child_text(entry, "description") or child_text(entry, "summary"))[:4000],
    }


def posts_from_feed(text: str, name: str) -> list[dict]:
    if not looks_like_feed(text):
        return []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    posts = []
    seen = set()
    for entry in root.iter():
        if local_name(entry.tag) not in ("entry", "item"):
            continue
        post = post_from_entry(entry, name)
        if not post or post["id"] in seen:
            continue
        seen.add(post["id"])
        posts.append(post)
        if len(posts) >= 50:
            break
    return posts


def posts_from_html(text: str, name: str) -> list[dict]:
    """Read post links from a public frontend page. reddit.com HTML is never passed here."""
    pattern = re.compile(
        r'href="(?:https?://[^"/]+)?(/r/' + re.escape(name) + r'/comments/([A-Za-z0-9]{1,12})[^"#]*)"[^>]*>([^<]*)',
        re.I,
    )
    posts = []
    seen = set()
    for _path, bare, title in pattern.findall(text or ""):
        ident = "t3_" + bare
        if ident in seen:
            continue
        label = re.sub(r"\s+", " ", title).strip()[:300]
        if not sensitive_allowed() and any(mark in label.lower() for mark in ("nsfw", "spoiler")):
            continue
        seen.add(ident)
        posts.append({
            "id": ident,
            "title": label,
            "text": "",
            "author": "",
            "score": 0,
            "comments": 0,
            "created": 0,
            "flair": "",
            "url": f"https://www.reddit.com/r/{name}/comments/{bare}/",
            "media": [],
        })
        if len(posts) >= 50:
            break
    return posts


def posts_from_body(text: str, name: str, adapter: str, url: str) -> list[dict]:
    found = posts_from_feed(text, name)
    if found:
        return found
    host = host_of(url)
    if reddit_host(host):
        return []
    if adapter in ("redlib", "reddit_embed"):
        return posts_from_html(text, name)
    return []


def comments_from_feed(text: str, post_id: str) -> list[dict]:
    if not looks_like_feed(text):
        return []
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    replies = []
    for entry in root.iter():
        if local_name(entry.tag) not in ("entry", "item"):
            continue
        ident = thing_id(entry, entry_link(entry), "t1_")
        if not ident.startswith("t1_"):
            raw = child_text(entry, "id") or child_text(entry, "guid")
            found = re.search(r"\b(t1_[A-Za-z0-9]{1,12})\b", raw)
            ident = found.group(1) if found else ""
        if not ident:
            continue
        parent = post_id
        for el in entry.iter():
            if local_name(el.tag) != "in-reply-to":
                continue
            ref = str(el.attrib.get("ref") or "")
            match = re.search(r"\b(t[13]_[A-Za-z0-9]{1,12})\b", ref)
            if match:
                parent = match.group(1)
        replies.append({
            "id": ident,
            "parent": parent,
            "author": clean_author(child_text(entry, "author") or child_text(entry, "creator")),
            "text": plain_text(child_text(entry, "content") or child_text(entry, "description") or child_text(entry, "summary"))[:4000],
            "score": 0,
            "created": parse_time(child_text(entry, "updated") or child_text(entry, "published") or child_text(entry, "pubDate")),
        })
        if len(replies) >= 10:
            break
    return replies


def og_media(text: str) -> list[dict]:
    urls = []
    for match in re.finditer(r"<meta\b[^>]*>", text or "", flags=re.I):
        tag = match.group(0)
        kind = re.search(r'(?:property|name)=["\']og:(image|video)["\']', tag, flags=re.I)
        content = re.search(r'content=["\']([^"\']+)["\']', tag, flags=re.I)
        if not kind or not content:
            continue
        urls.append(content.group(1))
    return collect_media(urls)[:1]


def merge_posts(current: list[dict], extra: list[dict]) -> list[dict]:
    seen = {post["id"] for post in current}
    merged = list(current)
    for post in extra:
        if post["id"] in seen:
            continue
        seen.add(post["id"])
        merged.append(post)
        if len(merged) >= 50:
            break
    return merged


def with_previous(doc: dict, previous: dict | None) -> dict:
    if not isinstance(previous, dict):
        return doc
    if doc.get("title") in ("", doc.get("name")) and previous.get("title"):
        doc["title"] = previous["title"]
    for key in ("subscribers", "icon", "banner", "about"):
        if not doc.get(key) and previous.get(key):
            doc[key] = previous[key]
    if not doc.get("rules") and previous.get("rules"):
        doc["rules"] = previous["rules"]
    return doc


def document_from_posts(name: str, posts: list[dict], threads: dict, source: str) -> dict:
    for post in posts:
        replies = threads.get(post["id"]) or []
        post["replies"] = replies
        if replies and not post.get("comments"):
            post["comments"] = len(replies)
    return {
        "name": name,
        "title": name,
        "subscribers": 0,
        "icon": "",
        "banner": "",
        "about": "",
        "rules": [],
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "posts": posts,
    }


def read_existing(name: str) -> dict | None:
    path = OUT / f"{name}.json"
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


class PublicClient:
    """Paced, cached, read-only fetch. A 403, 429, or block page backs off that host."""

    def __init__(self, config: dict, transport=None, sleep=None, now=None):
        self.config = config or {}
        self.transport = transport or default_transport
        self.sleep = sleep or time.sleep
        self.now = now or time.monotonic
        self.cache = {}
        self.backoff = {}
        self.fetched = False

    def headers(self) -> dict:
        return {
            "User-Agent": UA,
            "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.5, */*;q=0.2",
        }

    def get(self, url: str) -> tuple[int, dict, bytes]:
        host = host_of(url)
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or not host or parsed.username:
            return 0, {}, b""
        moment = self.now()
        if self.backoff.get(host, 0) > moment:
            return 0, {}, b""
        cached = self.cache.get(url)
        ttl = float(self.config.get("cacheSeconds") or 0)
        if cached and moment - cached[0] <= ttl:
            return cached[1], cached[2], cached[3]
        if self.fetched and float(self.config.get("paceSeconds") or 0) > 0:
            self.sleep(float(self.config["paceSeconds"]))
        try:
            status, hdrs, body = self.transport(url, self.headers())
        except (OSError, urllib.error.URLError, TimeoutError):
            self.fetched = True
            return 0, {}, b""
        status = int(status or 0)
        hdrs = dict(hdrs or {})
        body = body if isinstance(body, bytes) else bytes(body or b"")
        self.fetched = True
        if status in (403, 429) or blocked_page(status, body):
            delay = retry_after(hdrs) if status == 429 else 600
            self.backoff[host] = self.now() + min(600.0, max(30.0, delay))
        self.cache[url] = (self.now(), status, hdrs, body)
        return status, hdrs, body

    def comments(self, adapter: str, name: str, posts: list[dict], listing_url: str) -> dict:
        threads = {}
        if adapter not in ("reddit_rss", "redlib"):
            return threads
        origin = urllib.parse.urlparse(listing_url)
        for post in posts[:10]:
            bare = post["id"][3:]
            if adapter == "reddit_rss":
                url = f"https://www.reddit.com/r/{name}/comments/{bare}/.rss"
            else:
                url = f"{origin.scheme}://{origin.netloc}/r/{name}/comments/{bare}/rss"
            status, _headers, body = self.get(url)
            if status in (0, 403, 429) or blocked_page(status, body):
                break
            if status != 200 or not body:
                continue
            threads[post["id"]] = comments_from_feed(body.decode("utf-8", "replace"), post["id"])
        return threads

    def fill_media(self, posts: list[dict]) -> None:
        bases = [str(base).rstrip("/") for base in (self.config.get("embeds") or []) if str(base).startswith("https://")]
        filled = 0
        for post in posts:
            if filled >= 5 or post.get("media") or not bases:
                continue
            path = urllib.parse.urlparse(str(post.get("url") or "")).path
            if "/comments/" not in path:
                continue
            for base in bases:
                status, _headers, body = self.get(base + path)
                if status != 200 or not body or blocked_page(status, body):
                    continue
                media = og_media(body.decode("utf-8", "replace"))
                if media:
                    post["media"] = media
                    filled += 1
                    break

    def pull(self, name: str, previous: dict | None = None) -> dict | None:
        for adapter, urls in fallback_plan(self.config, name):
            posts = []
            listing_url = ""
            for url in urls:
                status, _headers, body = self.get(url)
                if status in (0, 403, 429) or (body and blocked_page(status, body)):
                    if adapter == "reddit_rss":
                        break
                    continue
                if status != 200 or not body:
                    continue
                text = body.decode("utf-8", "replace")
                found = posts_from_body(text, name, adapter, url)
                if not found:
                    continue
                posts = merge_posts(posts, found)
                listing_url = listing_url or url
                if adapter != "reddit_rss":
                    break
            if not posts:
                continue
            threads = self.comments(adapter, name, posts, listing_url)
            if adapter != "reddit_embed":
                self.fill_media(posts)
            return with_previous(document_from_posts(name, posts, threads, adapter), previous)
        return None


def default_transport(url: str, headers: dict) -> tuple[int, dict, bytes]:
    safe = {key: value for key, value in (headers or {}).items() if str(key).lower() != "cookie"}
    return _request(url, None, safe)


def mirror_one(name: str, token: str, client: PublicClient, previous: dict | None = None, api=None) -> dict | None:
    fetch = api or sync_one
    if token:
        doc = fetch(token, name)
        if doc and doc.get("posts"):
            doc["source"] = "reddit_api"
            return with_previous(doc, previous)
    return client.pull(name, previous)


def run() -> int:
    cfg = load_communities_config()
    client_id, secret = credentials()
    token = ""
    if not client_id or not secret:
        print("Reddit API credentials are not set; trying public feeds.")
    else:
        token = access_token(client_id, secret)
        if not token:
            print("Reddit token was not issued; trying public feeds.")
    names = added_names(cfg)
    client = PublicClient(cfg)
    docs = {}
    OUT.mkdir(parents=True, exist_ok=True)
    for name in names:
        previous = read_existing(name)
        doc = mirror_one(name, token, client, previous)
        if not doc or not doc.get("posts"):
            print(f"r/{name} unchanged")
            if previous:
                docs[name] = previous
            continue
        (OUT / f"{name}.json").write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
        docs[name] = doc
        print(f"r/{name} {len(doc.get('posts') or [])} posts via {doc.get('source') or 'public'}")
    write_index(names, docs)
    return 0


def selftest() -> int:
    def check(cond, message):
        if not cond:
            raise SystemExit("FAIL: " + message)
        print("ok", message)

    check(community_name("r/teslamotors") == "teslamotors", "a subreddit name is normalized")
    check(community_name("https://www.reddit.com/r/teslamotors/comments/abc") == "teslamotors", "a reddit link is a community name")
    check(community_name("../etc") == "", "a path is not a community name")
    listing = {"data": {"children": [
        {"kind": "t3", "data": {"id": "abc", "name": "t3_abc", "title": "Hello", "selftext": "Body", "author": "ada", "score": 10, "num_comments": 1, "created_utc": 100, "permalink": "/r/teslamotors/comments/abc/hello/", "url": "https://i.redd.it/a.jpg", "preview": {"images": [{"source": {"url": "https://i.redd.it/a.jpg"}}]}}},
        {"kind": "t3", "data": {"id": "nsfw", "name": "t3_nsfw", "title": "Hidden", "author": "x", "over_18": True, "score": 1, "created_utc": 50, "permalink": "/r/teslamotors/comments/nsfw/"}},
        {"kind": "t3", "data": {"id": "sp", "name": "t3_sp", "title": "Spoil", "author": "x", "spoiler": True, "score": 1, "created_utc": 40, "permalink": "/r/x"}},
    ]}}
    posts = listing_posts(listing)
    check(len(posts) == 1 and posts[0]["id"] == "t3_abc" and posts[0]["author"] == "ada", "NSFW and spoilers stay out of the mirror")
    check(posts[0]["media"][0]["url"] == "https://i.redd.it/a.jpg", "an i.redd.it original is kept")
    tree = {"kind": "Listing", "data": {"children": [
        {"kind": "t1", "data": {"name": "t1_root", "parent_id": "t3_abc", "author": "bob", "body": "Root", "score": 3, "created_utc": 101, "replies": {"kind": "Listing", "data": {"children": [
            {"kind": "t1", "data": {"name": "t1_child", "parent_id": "t1_root", "author": "cara", "body": "Child", "score": 1, "created_utc": 102, "replies": {"kind": "Listing", "data": {"children": [
                {"kind": "t1", "data": {"name": "t1_deep", "parent_id": "t1_child", "author": "dee", "body": "Deep", "score": 1, "created_utc": 103, "replies": {"kind": "Listing", "data": {"children": [
                    {"kind": "t1", "data": {"name": "t1_too", "parent_id": "t1_deep", "author": "ed", "body": "Too deep", "score": 1, "created_utc": 104, "replies": ""}}
                ]}}}}
            ]}}}}
        ]}}}}
    ]}}
    replies = []
    comments_from(tree, 1, 50, replies)
    ids = [row["id"] for row in replies]
    check(ids == ["t1_root", "t1_child", "t1_deep"] and replies[1]["parent"] == "t1_root", "comment trees stop at depth 3 and keep the parent")
    args = dash_mux_args("video.mp4", "audio.mp4", "out.mp4")
    check(args[args.index("-c") + 1] == "copy" and "libx264" not in args and "-c:v" not in args, "v.redd.it audio is muxed with ffmpeg copy and not re-encoded")
    mpd = (
        '<AdaptationSet mimeType="video/mp4"><Representation bandwidth="100"><BaseURL>DASH_360.mp4</BaseURL></Representation>'
        '<Representation bandwidth="800"><BaseURL>DASH_720.mp4</BaseURL></Representation></AdaptationSet>'
        '<AdaptationSet mimeType="audio/mp4"><Representation bandwidth="64"><BaseURL>DASH_AUDIO_64.mp4</BaseURL></Representation>'
        '<Representation bandwidth="128"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet>'
    )
    video_url, audio_url = dash_pairs(mpd, "https://v.redd.it/abc/DASHPlaylist.mpd")
    check(video_url.endswith("DASH_720.mp4") and audio_url.endswith("DASH_AUDIO_128.mp4"), "the DASH backup keeps the top video and audio")
    check(media_key("teslamotors", "t3_abc", "video", 0) == "social/reddit/teslamotors/t3_abc/video/0", "a backed-up community file has a stable key")
    banned = "reddit.com/" + ".json"
    check("oauth.reddit.com" in API and banned not in (ROOT / "scripts" / "reddit_sync.py").read_text(encoding="utf-8"), "the sync uses the official API")
    os.environ.pop("REDDIT_CLIENT_ID", None)
    os.environ.pop("REDDIT_CLIENT_SECRET", None)
    check(credentials() == ("", ""), "missing credentials are empty")

    def atom(sub: str, bare: str, title: str) -> bytes:
        return (
            '<?xml version="1.0"?>'
            '<feed xmlns="http://www.w3.org/2005/Atom"><entry>'
            f"<id>t3_{bare}</id><title>{title}</title><author><name>/u/ada</name></author>"
            f'<link href="https://www.reddit.com/r/{sub}/comments/{bare}/title/"/>'
            "<updated>2026-10-23T12:00:00Z</updated>"
            f'<content type="html">&lt;p&gt;{title}&lt;/p&gt;&lt;img src="https://i.redd.it/{bare}.jpg"/&gt;</content>'
            "</entry></feed>"
        ).encode("utf-8")

    comment_feed = (
        '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>'
        "<id>t1_root</id><author><name>/u/bob</name></author>"
        "<content type=\"html\">The paint was red.</content>"
        "<updated>2026-10-23T12:05:00Z</updated></entry></feed>"
    ).encode("utf-8")

    class Clock:
        def __init__(self):
            self.t = 1000.0
            self.slept = []

        def now(self):
            return self.t

        def sleep(self, seconds):
            self.slept.append(seconds)
            self.t += seconds

    def client_for(table, pace=0):
        calls = []
        clock = Clock()

        def transport(url, headers):
            calls.append((url, dict(headers)))
            for key, value in table:
                if key in url:
                    return value
            return 404, {}, b""

        cfg = json.loads(json.dumps(DEFAULT_COMMUNITIES))
        cfg["paceSeconds"] = pace
        cfg["cacheSeconds"] = 900
        return PublicClient(cfg, transport=transport, sleep=clock.sleep, now=clock.now), calls, clock

    hot = atom("teslamotors", "hot1", "Hot one")
    new = atom("teslamotors", "new1", "New one")
    client, calls, _clock = client_for([
        ("/new/.rss", (200, {}, new)),
        ("/comments/", (200, {}, comment_feed)),
        ("/.rss", (200, {}, hot)),
    ])
    doc = mirror_one("teslamotors", "", client)
    urls = [url for url, _headers in calls]
    check(doc["source"] == "reddit_rss" and [post["id"] for post in doc["posts"]] == ["t3_hot1", "t3_new1"], "a missing API uses Reddit RSS and keeps hot and new")
    check(doc["posts"][0]["author"] == "ada" and doc["posts"][0]["media"][0]["url"] == "https://i.redd.it/hot1.jpg", "RSS keeps the author and the i.redd.it image")
    check(doc["posts"][0]["replies"][0]["id"] == "t1_root" and doc["posts"][0]["replies"][0]["parent"] == "t3_hot1", "a comment feed attaches to the Reddit post")
    check(all(host_of(url) == "www.reddit.com" for url in urls), "later fallbacks stay quiet when Reddit RSS works")
    check(all("Cookie" not in headers and headers.get("User-Agent") == UA for _url, headers in calls), "public fetches send the app User-Agent and no Cookie")
    kept = client.pull("teslamotors", {"title": "Tesla Motors", "subscribers": 12, "about": "Cars", "rules": [{"title": "Be nice", "text": ""}]})
    check(kept["title"] == "Tesla Motors" and kept["subscribers"] == 12 and kept["about"] == "Cars", "a public feed keeps the earlier about text")

    client, calls, _clock = client_for([("/.rss", (200, {}, hot))])
    api_doc = mirror_one("teslamotors", "token", client, api=lambda _token, name: {"name": name, "posts": [{"id": "t3_api", "title": "API", "media": [{"type": "photo", "url": "https://i.redd.it/a.jpg"}]}]})
    check(api_doc["source"] == "reddit_api" and calls == [], "the official API is used first and fallbacks are not called")
    missed, calls, _clock = client_for([
        ("/new/.rss", (200, {}, new)),
        ("/comments/", (200, {}, comment_feed)),
        ("/.rss", (200, {}, hot)),
    ])
    missed_doc = mirror_one("teslamotors", "token", missed, api=lambda _token, _name: None)
    check(missed_doc["source"] == "reddit_rss", "an API miss falls through to Reddit RSS")

    client, calls, _clock = client_for([
        ("www.reddit.com", (429, {"Retry-After": "120"}, b"")),
        ("rsshub.app", (200, {}, atom("teslamotors", "hub1", "Hub"))),
    ])
    limited = mirror_one("teslamotors", "", client)
    check(limited["source"] == "rsshub_reddit" and sum("www.reddit.com" in url for url, _headers in calls) == 1, "a Reddit 429 moves on to RSSHub and backs off that host")
    client.pull("pics")
    reddit_hits = [url for url, _headers in calls if "www.reddit.com" in url]
    check(len(reddit_hits) == 1 and any("subreddit/pics" in url for url, _headers in calls), "the next community does not hit a backed-off host")

    client, calls, _clock = client_for([
        ("www.reddit.com", (403, {}, b"blocked")),
        ("rsshub.app", (200, {}, atom("teslamotors", "hub1", "Hub"))),
    ])
    blocked = mirror_one("teslamotors", "", client)
    blocked_urls = [url for url, _headers in calls]
    check(blocked["source"] == "rsshub_reddit" and not any("redlib" in url or "rss-bridge.org" in url or "vxreddit.com" in url for url in blocked_urls), "RSS 403 uses RSSHub and stops")

    client, calls, _clock = client_for([
        ("www.reddit.com", (403, {}, b"")),
        ("rsshub.app", (502, {}, b"")),
        ("rss-bridge.org", (500, {}, b"")),
        ("redlib.fmhy.net", (200, {}, atom("teslamotors", "red1", "Red"))),
    ])
    redlib_doc = mirror_one("teslamotors", "", client)
    redlib_urls = [url for url, _headers in calls]
    check(redlib_doc["source"] == "redlib" and any("redlib.fmhy.net/r/teslamotors/rss" in url for url in redlib_urls) and not any("safereddit.com" in url or "vxreddit.com" in url for url in redlib_urls), "RSSHub failure uses the first Redlib instance")

    embed_html = b'<html><a href="/r/teslamotors/comments/abc123/roadster/">Roadster sighting</a></html>'
    client, calls, _clock = client_for([("vxreddit.com", (200, {}, embed_html))])
    embed_doc = mirror_one("teslamotors", "", client)
    embed_urls = [url for url, _headers in calls]
    check(embed_doc["source"] == "reddit_embed" and embed_doc["posts"][0]["id"] == "t3_abc123" and embed_doc["posts"][0]["title"] == "Roadster sighting", "embed mirrors are the last listing fallback")
    check(any("vxreddit.com/r/teslamotors" in url for url in embed_urls) and not any("rxddit.com" in url for url in embed_urls), "the first embed mirror that answers stops the chain")

    wall = b"<html><title>Just a moment...</title><p>captcha</p></html>"
    client, calls, _clock = client_for([
        ("www.reddit.com", (200, {"Content-Type": "text/html"}, wall)),
        ("rsshub.app", (200, {}, atom("teslamotors", "hub1", "Hub"))),
    ])
    captcha = mirror_one("teslamotors", "", client)
    check(captcha["source"] == "rsshub_reddit" and "Just a moment" not in captcha["posts"][0]["title"], "a captcha page is a block and the next source is used")
    check(sum("www.reddit.com" in url for url, _headers in calls) == 1, "a captcha backs off Reddit instead of trying another listing there")

    cached, cache_calls, _clock = client_for([])
    cached.get("https://rsshub.app/reddit/subreddit/teslamotors?format=atom")
    cached.get("https://rsshub.app/reddit/subreddit/teslamotors?format=atom")
    check(len(cache_calls) == 1, "a public feed is cached for the run")
    paced, _calls, clock = client_for([], pace=2)
    paced.get("https://www.reddit.com/r/teslamotors/.rss")
    paced.get("https://www.reddit.com/r/teslamotors/new/.rss")
    check(clock.slept == [2.0], "public fetches wait between requests")
    quiet, _calls, _clock = client_for([])
    check(quiet.pull("teslamotors") is None, "when every source fails the mirror does not invent posts")

    cfg = load_communities_config()
    plan = fallback_plan(cfg, "teslamotors")
    check([name for name, _urls in plan] == ["reddit_rss", "rsshub_reddit", "rss_bridge", "redlib", "reddit_embed"], "fallback order is RSS, RSSHub, RSS-Bridge, Redlib, then embeds")
    by_adapter = dict(plan)
    check(by_adapter["rsshub_reddit"] == ["https://rsshub.app/reddit/subreddit/teslamotors?format=atom"], "RSSHub uses the documented subreddit route")
    check(by_adapter["redlib"][0] == "https://redlib.fmhy.net/r/teslamotors/rss", "Redlib starts at the FMHY instance")
    check("rss-bridge.org/bridge01" in by_adapter["rss_bridge"][0] and "RedditBridge" in by_adapter["rss_bridge"][0], "RSS-Bridge uses the public Reddit bridge")
    check(cfg["embeds"] == ["https://vxreddit.com", "https://rxddit.com"], "embed mirrors are vxreddit and rxddit")
    check(expand_template("http://example.com/r/{name}", cfg, "teslamotors") == [], "public fallbacks are https only")

    global OUT
    saved_out = OUT
    try:
        with tempfile.TemporaryDirectory() as temp:
            OUT = Path(temp)
            (OUT / "index.json").write_text(json.dumps({"communities": [{"name": "teslamotors", "title": "Tesla Motors"}]}), encoding="utf-8")
            write_index(["teslamotors"], {"teslamotors": {"name": "teslamotors", "title": "Tesla Motors", "posts": []}})
            names = [row["name"] for row in json.loads((OUT / "index.json").read_text(encoding="utf-8"))["communities"]]
            check("teslamotors" in names and "grapheneos" in names, "a Reddit-only run keeps a configured Discourse forum in the index")
            (OUT / "index.json").unlink()
            write_index(["teslamotors"], {})
            names = [row["name"] for row in json.loads((OUT / "index.json").read_text(encoding="utf-8"))["communities"]]
            check("grapheneos" in names, "a fresh index still lists a configured Discourse forum")
    finally:
        OUT = saved_out
    print("reddit sync selftest ok")
    return 0


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    return run()


if __name__ == "__main__":
    sys.exit(main())
