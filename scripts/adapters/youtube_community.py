"""YouTube community posts: text, images, polls, and shared videos.

YouTube has no official community RSS. Sources are tried in order and the
first one that returns real posts wins:

1. Invidious ``/api/v1/channels/<id>/community`` (rotating instances).
2. RSSHub ``/youtube/community/<handle>`` on the sync container.
3. Piped, when a channel payload actually contains posts.
4. The public ``/@handle/posts`` page, parsed from ``ytInitialData``.

Images stay on yt3.ggpht.com / googleusercontent. Nothing is downloaded.
Counts and poll percents are copied only when the source gives them.
A relative label such as "7 months ago" is not turned into a timestamp.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse

from .common import blank_profile, child_text, clean_text, local_name, parse_xml, post_shell

UA = "rss-feeds-preview/1.0 (+https://github.com/owner-account/rss-feeds)"
POST_ID = re.compile(r"/post/([A-Za-z0-9_-]{10,80})")
EXACT_COUNT = re.compile(r"^([\d,]{1,12})\s+(likes?|comments?|replies)\b", re.I)


def _abs(url: str) -> str:
    url = (url or "").strip()
    if url.startswith("//"):
        return "https:" + url
    return url


def _hotlink(url: str) -> str:
    url = _abs(url)
    if not url.startswith("https://"):
        return ""
    host = urlparse(url).netloc.lower()
    if host.endswith(".ggpht.com") or host.endswith(".googleusercontent.com") or host.endswith(".ytimg.com"):
        return url
    return ""


def _count(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and value >= 0 and float(value).is_integer():
        return int(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if text.isdigit():
            return int(text)
    return None


def _iso(value) -> str:
    if isinstance(value, (int, float)) and value > 10**9:
        return datetime.fromtimestamp(int(value), timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return ""


def _best_thumb(thumbs) -> tuple[str, int, int]:
    best = ""
    width = -1
    height = 0
    for thumb in thumbs or []:
        if not isinstance(thumb, dict):
            continue
        url = _hotlink(thumb.get("url") or "")
        if not url:
            continue
        try:
            w = int(thumb.get("width") or 0)
        except (TypeError, ValueError):
            w = 0
        try:
            h = int(thumb.get("height") or 0)
        except (TypeError, ValueError):
            h = 0
        if w >= width:
            best = url
            width = w
            height = h
    return best, max(width, 0), height


def _photo(url: str, width: int, height: int, alt: str = "") -> dict:
    return {"type": "photo", "url": url, "poster": url, "width": width or None, "height": height or None, "alt": alt}


def _yt_text(node) -> str:
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("simpleText"), str):
        return node["simpleText"]
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join((item.get("text") or "") for item in runs if isinstance(item, dict))
    return ""


def _percent(choice: dict):
    if "votePercentage" in choice or "percent" in choice:
        raw = choice.get("votePercentage", choice.get("percent"))
        try:
            number = float(raw)
        except (TypeError, ValueError):
            return None
        if 0 <= number <= 100:
            return round(number, 1)
        return None
    if "voteRatio" in choice:
        try:
            ratio = float(choice.get("voteRatio"))
        except (TypeError, ValueError):
            return None
        if 0 <= ratio <= 1:
            return round(ratio * 100, 1)
        if 0 <= ratio <= 100:
            return round(ratio, 1)
    return None


def _poll(attachment: dict) -> dict | None:
    choices = []
    for choice in attachment.get("choices") or []:
        if isinstance(choice, str):
            text = choice.strip()
            row = {"text": text} if text else None
        elif isinstance(choice, dict):
            text = choice.get("text") if "text" in choice else choice
            if not isinstance(text, str):
                text = _yt_text(text)
            text = (text or "").strip()
            if not text:
                continue
            row = {"text": text}
            percent = _percent(choice)
            if percent is not None:
                row["percent"] = percent
            votes = _count(choice.get("voteCount"))
            if votes is None:
                votes = _count(choice.get("votes"))
            if votes is not None:
                row["votes"] = votes
        else:
            continue
        if row:
            choices.append(row)
    if not choices:
        return None
    poll = {"choices": choices}
    total = attachment.get("totalVotes")
    if isinstance(total, dict):
        total = _yt_text(total)
    total_n = _count(total)
    if total_n is not None:
        poll["totalVotes"] = total_n
    return poll


def _video_id(attachment: dict) -> str:
    video_id = str(attachment.get("videoId") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return ""
    return video_id


def _video_media(attachment: dict) -> dict | None:
    """A shared YouTube video plays through the same player as a channel video."""
    video_id = _video_id(attachment)
    if not video_id:
        return None
    title = (attachment.get("title") or "").strip()
    if isinstance(title, dict):
        title = _yt_text(title).strip()
    poster = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    return {
        "type": "video",
        "url": f"https://www.youtube-nocookie.com/embed/{video_id}",
        "poster": poster,
        "videoId": video_id,
        "width": 480,
        "height": 360,
        "alt": title,
    }


def _photos_from_groups(groups) -> list:
    photos = []
    for group in groups or []:
        thumbs = group
        if isinstance(group, dict):
            thumbs = group.get("imageThumbnails") or group.get("thumbnails") or []
            image = group.get("image")
            if isinstance(image, dict) and image.get("thumbnails"):
                thumbs = image["thumbnails"]
            renderer = group.get("backstageImageRenderer")
            if isinstance(renderer, dict):
                thumbs = ((renderer.get("image") or {}).get("thumbnails")) or thumbs
        url, width, height = _best_thumb(thumbs if isinstance(thumbs, list) else [])
        if not url:
            continue
        photos.append(_photo(url, width, height))
        if len(photos) >= 4:
            break
    return photos


def _shell(feed: dict, post_id: str, author: str, text: str, when: str, avatar: str, media, stats, poll=None, quoted=None) -> dict:
    handle = (feed.get("handle") or "").lstrip("@")
    post = post_shell(
        id=post_id,
        statusId=post_id,
        platform="youtube",
        feedId=feed.get("id") or "",
        kind="community",
        author=author or (feed.get("profile") or {}).get("name") or handle,
        handle=handle,
        avatar=avatar,
        text=clean_text(text),
        date=when,
        url=f"https://www.youtube.com/post/{post_id}",
        media=media or [],
        stats=stats or {},
        quoted=quoted,
    )
    if poll:
        post["poll"] = poll
    # Drop null width/height left by _photo when the source omitted them.
    for item in post.get("media") or []:
        if item.get("width") is None:
            item.pop("width", None)
        if item.get("height") is None:
            item.pop("height", None)
    return post


def _stats(likes, replies) -> dict:
    stats = {}
    if likes is not None:
        stats["likes"] = likes
    if replies is not None:
        stats["replies"] = replies
    return stats


def parse_invidious_posts(payload: dict, feed: dict) -> list:
    rows = payload.get("comments") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    posts = []
    seen = set()
    for item in rows:
        if not isinstance(item, dict):
            continue
        post_id = str(item.get("commentId") or item.get("postId") or "").strip()
        if not post_id or post_id in seen:
            continue
        attachment = item.get("attachment") if isinstance(item.get("attachment"), dict) else {}
        kind = attachment.get("type") or ""
        if kind in ("parse-error", "unknown", "error"):
            attachment = {}
            kind = ""
        media = []
        poll = None
        quoted = None
        if kind == "image":
            media = _photos_from_groups([attachment.get("imageThumbnails")])
        elif kind == "multiImage":
            media = _photos_from_groups(attachment.get("images") or [])
        elif kind == "poll":
            poll = _poll(attachment)
        elif kind == "video":
            clip = _video_media(attachment)
            if clip:
                media = [clip]
        elif kind == "playlist":
            quoted = None
        text = item.get("content") or ""
        if not text and not media and not poll and not quoted:
            continue
        avatar, _, _ = _best_thumb(item.get("authorThumbnails"))
        seen.add(post_id)
        posts.append(
            _shell(
                feed,
                post_id,
                item.get("author") or "",
                text,
                _iso(item.get("published")),
                avatar,
                media,
                _stats(_count(item.get("likeCount")), _count(item.get("replyCount"))),
                poll,
                quoted,
            )
        )
    return posts


class _HtmlBits(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.images = []

    def handle_starttag(self, tag, attrs):
        attr = {key.lower(): value for key, value in attrs}
        if tag == "img" and attr.get("src"):
            self.images.append(attr["src"])
        if tag == "br":
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def _html_bits(html: str) -> tuple[str, list]:
    parser = _HtmlBits()
    try:
        parser.feed(html or "")
    except Exception:
        return clean_text(re.sub(r"<[^>]+>", " ", html or "")), []
    return clean_text("".join(parser.parts)), parser.images


def parse_rss_posts(payload: str, feed: dict) -> list:
    try:
        root = parse_xml(payload)
    except Exception:
        return []
    posts = []
    seen = set()
    for el in root.iter():
        if local_name(el.tag) not in ("item", "entry"):
            continue
        link = child_text(el, "link")
        if not link:
            for child in list(el):
                if local_name(child.tag) == "link" and child.attrib.get("href"):
                    link = child.attrib["href"]
                    break
        guid = child_text(el, "guid") or child_text(el, "id")
        match = POST_ID.search(link or "") or POST_ID.search(guid or "")
        if not match:
            continue
        post_id = match.group(1)
        if post_id in seen:
            continue
        raw = child_text(el, "description") or child_text(el, "summary") or child_text(el, "content") or ""
        # content:encoded
        if not raw:
            for child in list(el):
                if local_name(child.tag) in ("encoded", "content") and (child.text or "").strip():
                    raw = child.text
                    break
        text, images = _html_bits(raw)
        title = clean_text(child_text(el, "title"))
        if title and title not in text:
            text = clean_text(title + ("\n" + text if text else ""))
        media = []
        for src in images:
            url = _hotlink(src)
            if not url:
                continue
            media.append(_photo(url, 0, 0))
            if len(media) >= 4:
                break
        when = ""
        for name in ("published", "updated", "pubDate", "date"):
            raw_date = child_text(el, name)
            if not raw_date:
                continue
            if "T" in raw_date and raw_date.endswith("Z"):
                when = raw_date
                break
            from .common import rfc822_to_iso

            when = rfc822_to_iso(raw_date)
            if when:
                break
        if not text and not media:
            continue
        seen.add(post_id)
        posts.append(_shell(feed, post_id, "", text, when, "", media, {}))
    return posts


def _like_count(post: dict):
    vote = post.get("voteCount")
    if isinstance(vote, dict):
        exact = _count(vote.get("simpleText"))
        if exact is not None:
            return exact
        label = ((vote.get("accessibility") or {}).get("accessibilityData") or {}).get("label") or ""
        match = EXACT_COUNT.match(label.strip())
        if match and match.group(2).lower().startswith("like"):
            return _count(match.group(1))
    return _count(vote)


def _walk_posts(node, found: list) -> None:
    if isinstance(node, dict):
        renderer = node.get("backstagePostRenderer")
        if isinstance(renderer, dict):
            found.append(renderer)
            return
        for value in node.values():
            _walk_posts(value, found)
    elif isinstance(node, list):
        for item in node:
            _walk_posts(item, found)


def _attachment_of(post: dict) -> dict:
    attachment = post.get("backstageAttachment")
    return attachment if isinstance(attachment, dict) else {}


def parse_initial_posts(data: dict, feed: dict) -> list:
    found = []
    _walk_posts(data, found)
    posts = []
    seen = set()
    for item in found:
        post_id = str(item.get("postId") or "").strip()
        if not post_id or post_id in seen:
            continue
        attachment = _attachment_of(item)
        media = []
        poll = None
        quoted = None
        image = attachment.get("backstageImageRenderer")
        if isinstance(image, dict):
            media = _photos_from_groups([image])
        multi = attachment.get("postMultiImageRenderer")
        if isinstance(multi, dict):
            media = _photos_from_groups(multi.get("images") or [])
        if isinstance(attachment.get("pollRenderer"), dict):
            poll = _poll(attachment["pollRenderer"])
        video = attachment.get("videoRenderer") or attachment.get("backstageVideoRenderer")
        if isinstance(video, dict):
            clip = _video_media(
                {
                    "videoId": video.get("videoId"),
                    "title": video.get("title"),
                    "author": video.get("ownerText") or video.get("author"),
                }
            )
            if clip:
                media = [clip]
        text = _yt_text(item.get("contentText"))
        if not text and not media and not poll and not quoted:
            continue
        avatar, _, _ = _best_thumb((item.get("authorThumbnail") or {}).get("thumbnails"))
        seen.add(post_id)
        posts.append(
            _shell(
                feed,
                post_id,
                _yt_text(item.get("authorText")),
                text,
                "",
                avatar,
                media,
                _stats(_like_count(item), None),
                poll,
                quoted,
            )
        )
    return posts


def _extract_initial(html: str) -> dict | None:
    marker = html.find("ytInitialData")
    if marker < 0:
        return None
    start = html.find("{", marker)
    if start < 0:
        return None
    depth = 0
    in_str = False
    escaped = False
    for index in range(start, len(html)):
        ch = html[index]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start : index + 1])
                except json.JSONDecodeError:
                    return None
    return None


def parse_html_posts(html: str, feed: dict) -> list:
    data = _extract_initial(html)
    if not isinstance(data, dict):
        return []
    return parse_initial_posts(data, feed)


def _profile(feed: dict) -> dict:
    handle = (feed.get("handle") or "").lstrip("@")
    name = (feed.get("profile") or {}).get("name") or handle
    profile = blank_profile("youtube", handle, name)
    channel_id = feed.get("channelId") or ""
    if channel_id:
        profile["channelId"] = channel_id
        profile["url"] = f"https://www.youtube.com/channel/{channel_id}"
    elif handle:
        profile["url"] = f"https://www.youtube.com/@{handle}"
    return profile


def parse(payload, feed: dict | None = None) -> dict:
    feed = feed or {}
    posts = []
    if isinstance(payload, dict):
        if payload.get("comments") or payload.get("authorId"):
            posts = parse_invidious_posts(payload, feed)
        else:
            posts = parse_initial_posts(payload, feed)
    elif isinstance(payload, str):
        stripped = payload.lstrip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                data = None
            if isinstance(data, dict):
                posts = parse(data, feed).get("posts") or []
        elif "ytInitialData" in payload:
            posts = parse_html_posts(payload, feed)
        elif "<" in stripped[:800]:
            posts = parse_rss_posts(payload, feed)
    return {"posts": posts, "profiles": [_profile(feed)] if posts else []}


def _read(url: str, timeout: int = 18) -> str:
    from x_guard import assert_not_x_api, open_url

    assert_not_x_api(url)
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with open_url(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def _invidious_posts(channel_id: str, feed: dict) -> list:
    from yt_remote import invidious_get

    quoted = urllib.parse.quote(channel_id)
    path = f"/api/v1/channels/{quoted}/community"
    posts = []
    seen = set()
    for _ in range(2):
        payload, _base = invidious_get(path)
        if not isinstance(payload, dict):
            break
        for post in parse_invidious_posts(payload, feed):
            if post["id"] in seen:
                continue
            seen.add(post["id"])
            posts.append(post)
        continuation = payload.get("continuation") or ""
        if not continuation:
            break
        path = f"/api/v1/channels/{quoted}/community?continuation={urllib.parse.quote(continuation)}"
    return posts


def _rsshub_posts(feed: dict, config: dict) -> list:
    handle = (feed.get("handle") or "").lstrip("@")
    channel_id = feed.get("channelId") or ""
    slugs = []
    for value in (handle, ("@" + handle) if handle else "", channel_id):
        if value and value not in slugs:
            slugs.append(value)
    bases = []
    local = (config.get("rsshubBase") or "").rstrip("/")
    if local:
        bases.append(local)
    errors = []
    for base in bases:
        for slug in slugs:
            url = base + "/youtube/community/" + urllib.parse.quote(slug)
            try:
                payload = _read(url, timeout=15)
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
                errors.append(f"{url}: {exc}")
                continue
            posts = parse_rss_posts(payload, feed)
            if posts:
                return posts
            errors.append(f"{url}: no community items")
    if errors:
        print(f"[youtube] rsshub community: {errors[-1]}", file=sys.stderr)
    return []


def _piped_posts(channel_id: str, feed: dict) -> list:
    from yt_remote import piped_get

    payload, _base = piped_get("/channel/" + urllib.parse.quote(channel_id))
    if not isinstance(payload, dict):
        return []
    for key in ("community", "posts", "communityPosts"):
        rows = payload.get(key)
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            continue
        # Piped's channel route is videos. Only a list already shaped like
        # Invidious community posts is accepted.
        if rows[0].get("commentId") or rows[0].get("postId"):
            return parse_invidious_posts({"comments": rows}, feed)
    return []


def _page_posts(feed: dict) -> list:
    handle = (feed.get("handle") or "").lstrip("@")
    channel_id = feed.get("channelId") or ""
    urls = []
    if handle:
        urls.append(f"https://www.youtube.com/@{urllib.parse.quote(handle)}/posts")
    if channel_id:
        urls.append(f"https://www.youtube.com/channel/{urllib.parse.quote(channel_id)}/posts")
    for url in urls:
        try:
            html = _read(url, timeout=25)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            print(f"[youtube] posts page: {exc}", file=sys.stderr)
            continue
        posts = parse_html_posts(html, feed)
        if posts:
            return posts
    return []


def fetch_community(feed: dict, config: dict | None = None) -> tuple[list, str]:
    """Return ``(posts, source)``. ``source`` is empty when every source failed."""
    config = config or {}
    channel_id = feed.get("channelId") or ""
    if channel_id:
        try:
            posts = _invidious_posts(channel_id, feed)
        except Exception as exc:
            print(f"[youtube] invidious community: {exc}", file=sys.stderr)
            posts = []
        if posts:
            return posts[:20], "invidious"
    try:
        posts = _rsshub_posts(feed, config)
    except Exception as exc:
        print(f"[youtube] rsshub community: {exc}", file=sys.stderr)
        posts = []
    if posts:
        return posts[:20], "rsshub"
    if channel_id:
        try:
            posts = _piped_posts(channel_id, feed)
        except Exception as exc:
            print(f"[youtube] piped community: {exc}", file=sys.stderr)
            posts = []
        if posts:
            return posts[:20], "piped"
    try:
        posts = _page_posts(feed)
    except Exception as exc:
        print(f"[youtube] posts page: {exc}", file=sys.stderr)
        posts = []
    if posts:
        return posts[:20], "youtube"
    return [], ""
