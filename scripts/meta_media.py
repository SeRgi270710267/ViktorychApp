"""Hotlink Instagram and Threads media. Do not copy it into the repo.

Each CDN URL's oe= query value is a hex unix timestamp, about five days out.
Posts still in the latest feed keep that feed's URLs. Older posts are refreshed
from the public embed page, then from Instagram's oembed and /media redirect
when the embed page has no image. Threads uses the public post page.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from x_guard import open_url

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
META_HOSTS = ("cdninstagram.com", "fbcdn.net", "fbsbx.com", "cdnthreads.net")
VIDEO_EXT = (".mp4", ".m3u8", ".mov", ".webm")
NEAR = timedelta(hours=36)
_URL = re.compile(r"https://[^\s\"'<>\\]+")


def is_meta_cdn(url: str) -> bool:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    return any(mark in host for mark in META_HOSTS)


def is_video_url(url: str) -> bool:
    path = urllib.parse.urlparse(url).path.lower().split("?")[0]
    return path.endswith(VIDEO_EXT)


def is_local(url: str) -> bool:
    return url.startswith("media/") and ".." not in url


def is_profile_image(url: str) -> bool:
    path = urllib.parse.urlparse(url).path.lower()
    query = urllib.parse.urlparse(url).query.lower()
    if "-19/" in path or "profile_pic" in path or "profile_pic" in query:
        return True
    return "s150x150" in query or "s100x100" in query or "s320x320" in query


def cdn_expiry(url: str) -> str | None:
    """ISO time from a Meta oe= hex timestamp, or None when the URL has none."""
    if not url or is_local(url):
        return None
    raw = (urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("oe") or [""])[0]
    if not re.fullmatch(r"[0-9A-Fa-f]{6,}", raw or ""):
        return None
    try:
        moment = datetime.fromtimestamp(int(raw, 16), timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_expiry(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def needs_refresh(url: str, expires: str | None = None, now: datetime | None = None) -> bool:
    if not url or is_local(url):
        return True
    if not is_meta_cdn(url):
        return False
    moment = _parse_expiry(expires or cdn_expiry(url))
    if moment is None:
        return False
    return moment - (now or datetime.now(timezone.utc)) <= NEAR


def stamp_media(item: dict) -> None:
    if not isinstance(item, dict):
        return
    url = item.get("url") or ""
    expires = cdn_expiry(url)
    if expires:
        item["expires"] = expires
    elif not is_meta_cdn(url):
        item.pop("expires", None)
    poster = item.get("poster") or ""
    if poster and poster != url:
        poster_expires = cdn_expiry(poster)
        if poster_expires:
            item["posterExpires"] = poster_expires
        else:
            item.pop("posterExpires", None)
    else:
        item.pop("posterExpires", None)
    if not item.get("fallback"):
        item.pop("fallback", None)


def stamp_post(post: dict) -> None:
    if not isinstance(post, dict):
        return
    for item in post.get("media") or []:
        stamp_media(item)
    photos = [item.get("url") for item in post.get("media") or [] if item.get("type") == "photo" and item.get("url")]
    if photos or "images" in post:
        post["images"] = photos
    avatar = post.get("avatar") or ""
    avatar_expires = cdn_expiry(avatar)
    if avatar_expires:
        post["avatarExpires"] = avatar_expires
    elif not is_meta_cdn(avatar):
        post.pop("avatarExpires", None)
    quoted = post.get("quoted")
    if isinstance(quoted, dict):
        stamp_post(quoted)
    repost = post.get("repostedBy")
    if isinstance(repost, dict):
        expires = cdn_expiry(repost.get("avatar") or "")
        if expires:
            repost["avatarExpires"] = expires


def extract_cdn_urls(html: str) -> list[str]:
    text = (html or "").replace("\\/", "/").replace("\\u0026", "&").replace("&amp;", "&")
    found = []
    for match in _URL.finditer(text):
        url = match.group(0).rstrip(").,;]")
        if not is_meta_cdn(url):
            continue
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        if host.startswith("static.") or "/rsrc.php" in url:
            continue
        if url not in found:
            found.append(url)
    return found


def _fetch(url: str, timeout: int = 20, sniff_redirect: bool = False) -> tuple[str, str]:
    headers = {"User-Agent": UA, "Accept": "text/html,application/json,*/*"}
    if sniff_redirect:
        # The media URL redirects to a JPEG. A one-byte range avoids saving the file.
        headers["Range"] = "bytes=0-0"
    request = urllib.request.Request(url, headers=headers)
    try:
        with open_url(request, timeout=timeout) as response:
            final = response.geturl()
            if is_meta_cdn(final) and (response.headers.get("content-type") or "").startswith("image/"):
                return "", final
            return response.read().decode("utf-8", "replace"), final
    except Exception:
        return "", ""


def _unique(urls: list[str]) -> list[str]:
    out = []
    for url in urls:
        if url and url not in out:
            out.append(url)
    return out


def _shortcode(post: dict) -> str:
    match = re.search(r"/(?:p|reel|tv)/([A-Za-z0-9_-]+)", post.get("url") or "")
    return match.group(1) if match else ""


def instagram_media_urls(shortcode: str) -> list[str]:
    if not shortcode:
        return []
    found = []
    for page in (
        f"https://www.instagram.com/p/{shortcode}/embed/captioned/",
        f"https://www.instagram.com/p/{shortcode}/embed/",
    ):
        body, _final = _fetch(page)
        if not body or '"pageID":"httpErrorPage"' in body:
            continue
        found.extend(extract_cdn_urls(body))
    if found:
        return _unique(found)
    body, _final = _fetch(f"https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/{shortcode}/")
    if body.lstrip().startswith("{"):
        try:
            thumb = json.loads(body).get("thumbnail_url") or ""
        except json.JSONDecodeError:
            thumb = ""
        if thumb:
            found.append(thumb)
    _body, final = _fetch(f"https://www.instagram.com/p/{shortcode}/media/?size=l", sniff_redirect=True)
    if is_meta_cdn(final):
        found.insert(0, final)
    return _unique(found)


def threads_media_urls(post: dict) -> list[str]:
    handle = post.get("handle") or ""
    code = str(post.get("statusId") or post.get("id") or "")
    if not code:
        return []
    pages = [
        f"https://www.threads.net/@{handle}/post/{code}" if handle else "",
        f"https://www.threads.net/t/{code}",
        f"https://www.threads.com/@{handle}/post/{code}" if handle else "",
        f"https://www.threads.com/t/{code}",
    ]
    for page in pages:
        if not page:
            continue
        body, final = _fetch(page)
        found = extract_cdn_urls(body)
        if is_meta_cdn(final):
            found.insert(0, final)
        if found:
            return _unique(found)
    return []


def _file_key(url: str) -> str:
    return urllib.parse.urlparse(url).path.rsplit("/", 1)[-1].lower()


def _rank(url: str) -> int:
    query = urllib.parse.urlparse(url).query.lower()
    if "p1080" in query or "dst-jpg_e35" in query and "p640" not in query and "s640" not in query:
        return 0
    if "p640" in query or "s640" in query:
        return 1
    return 2


def media_groups(urls: list[str]) -> list[tuple[str, str]]:
    """(best url, alternate url) for each distinct file, skipping profile pictures."""
    order = []
    buckets: dict[str, list[str]] = {}
    for url in urls:
        if not url or is_profile_image(url):
            continue
        key = _file_key(url)
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        if url not in buckets[key]:
            buckets[key].append(url)
    groups = []
    for key in order:
        options = sorted(buckets[key], key=_rank)
        best = options[0]
        alternate = next((item for item in options[1:] if item != best), "")
        groups.append((best, alternate))
    return groups


def _item_needs(item: dict, now: datetime | None) -> bool:
    url = item.get("url") or ""
    poster = item.get("poster") or ""
    if needs_refresh(url, item.get("expires"), now):
        return True
    return bool(poster) and poster != url and needs_refresh(poster, item.get("posterExpires"), now)


def _assign(item: dict, best: str, alternate: str, now: datetime | None) -> None:
    old = item.get("url") or ""
    video = item.get("type") in ("video", "animated_gif") or is_video_url(old)
    if video and not is_video_url(best):
        if needs_refresh(item.get("poster") or "", item.get("posterExpires"), now) or not item.get("poster"):
            item["poster"] = best
        if alternate and not is_video_url(alternate) and alternate != item.get("poster"):
            item["fallback"] = alternate
    else:
        item["url"] = best
        if not video or not item.get("poster") or is_local(item.get("poster") or ""):
            if not is_video_url(best):
                item["poster"] = best
        if alternate and alternate != best:
            item["fallback"] = alternate
        elif old.startswith("http") and old != best and not needs_refresh(old, cdn_expiry(old), now):
            item["fallback"] = old
        else:
            item.pop("fallback", None)
    stamp_media(item)


def refresh_post(post: dict, urls: list[str], now: datetime | None = None) -> None:
    groups = media_groups(urls)
    index = 0
    for item in post.get("media") or []:
        if not _item_needs(item, now):
            continue
        if index >= len(groups):
            break
        best, alternate = groups[index]
        index += 1
        _assign(item, best, alternate, now)
    avatar = post.get("avatar") or ""
    if needs_refresh(avatar, post.get("avatarExpires"), now):
        picture = next((url for url in urls if is_profile_image(url)), "")
        if picture:
            post["avatar"] = picture
    stamp_post(post)


def refresh_saved(posts: list, profiles: list, fresh_ids: set[tuple[str, str]], now: datetime | None = None) -> None:
    """Stamp every Meta URL. Refresh posts that were not in this fetch and are near expiry."""
    by_feed: dict[str, dict] = {}
    for post in posts:
        stamp_post(post)
        feed_id = post.get("feedId") or ""
        by_feed.setdefault(feed_id, post)
        key = (feed_id, str(post.get("id") or ""))
        if post.get("platform") not in ("instagram", "threads"):
            continue
        if key in fresh_ids and not _has_local(post):
            continue
        if not _item_needs_any(post, now) and not needs_refresh(post.get("avatar") or "", post.get("avatarExpires"), now):
            continue
        urls = instagram_media_urls(_shortcode(post)) if post.get("platform") == "instagram" else threads_media_urls(post)
        if not urls:
            print(f"[media] {post.get('platform')}:{post.get('id')} no fresh CDN url")
            continue
        refresh_post(post, urls, now)
        print(f"[media] {post.get('platform')}:{post.get('id')} refreshed")
    for profile in profiles:
        avatar = profile.get("avatar") or ""
        expires = cdn_expiry(avatar)
        if expires:
            profile["avatarExpires"] = expires
        elif not is_meta_cdn(avatar):
            profile.pop("avatarExpires", None)
        if not needs_refresh(avatar, profile.get("avatarExpires"), now):
            continue
        sample = by_feed.get(profile.get("id") or "")
        if not sample:
            continue
        urls = instagram_media_urls(_shortcode(sample)) if profile.get("platform") == "instagram" else threads_media_urls(sample)
        picture = next((url for url in urls if is_profile_image(url)), "")
        if picture:
            profile["avatar"] = picture
            profile["avatarExpires"] = cdn_expiry(picture) or ""


def _has_local(post: dict) -> bool:
    if is_local(post.get("avatar") or ""):
        return True
    for item in post.get("media") or []:
        if is_local(item.get("url") or "") or is_local(item.get("poster") or ""):
            return True
    quoted = post.get("quoted")
    return isinstance(quoted, dict) and _has_local(quoted)


def _item_needs_any(post: dict, now: datetime | None) -> bool:
    for item in post.get("media") or []:
        if _item_needs(item, now):
            return True
    quoted = post.get("quoted")
    if isinstance(quoted, dict) and _item_needs_any(quoted, now):
        return True
    return False
