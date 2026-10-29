#!/usr/bin/env python3
"""Unified profiles: one person, many platform accounts.

feeds.config.json holds the people the owner has linked. Sync fetches every
linked account that already has an adapter, writes people.json, and records
cross-post hints. Strong matches found in data the sync already has merge on
their own; weaker ones go to suggestions.json for a one-tap confirm.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PLATFORMS = ("x", "threads", "instagram", "youtube", "vk", "rss", "telegram")
HANDLE = {
    "x": re.compile(r"^[A-Za-z0-9_]{1,15}$"),
    "threads": re.compile(r"^[A-Za-z0-9._]{1,30}$"),
    "instagram": re.compile(r"^[A-Za-z0-9._]{1,30}$"),
    "youtube": re.compile(r"^(?:[A-Za-z0-9._-]{3,30}|UC[\w-]{22})$"),
    "vk": re.compile(r"^[A-Za-z0-9_.]{1,32}$"),
    "rss": re.compile(r"^[a-z0-9-]{1,48}$"),
    "telegram": re.compile(r"^[A-Za-z0-9_]{5,32}$"),
}
PERSON_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
URL_RE = re.compile(r"https?://[^\s<>\"']+")
YT_VIDEO = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)
CHANNEL_ID = re.compile(r"^UC[\w-]{22}$")


class SchemaError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_config(config: dict) -> None:
    if not isinstance(config, dict):
        raise SchemaError("config must be an object")
    people = config.get("people") or []
    if not isinstance(people, list):
        raise SchemaError("people must be a list")
    seen_accounts: set[tuple[str, str]] = set()
    seen_ids: set[str] = set()
    for person in people:
        validate_person(person)
        if person["id"] in seen_ids:
            raise SchemaError("duplicate person id " + person["id"])
        seen_ids.add(person["id"])
        for account in person["accounts"]:
            key = (account["platform"], account["handle"].casefold())
            if key in seen_accounts:
                raise SchemaError(account["platform"] + ":" + account["handle"] + " is on more than one person")
            seen_accounts.add(key)


def validate_person(person: dict) -> None:
    if not isinstance(person, dict):
        raise SchemaError("a person must be an object")
    pid = person.get("id")
    if not isinstance(pid, str) or not PERSON_ID.match(pid):
        raise SchemaError("a person id must be a lowercase slug")
    name = person.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        raise SchemaError("a person needs a name")
    for field in ("avatar", "banner"):
        value = person.get(field) or ""
        if value and not str(value).startswith("https://"):
            raise SchemaError(field + " must be an https URL")
    accounts = person.get("accounts")
    if not isinstance(accounts, list) or not accounts:
        raise SchemaError(pid + " needs at least one account")
    seen: set[tuple[str, str]] = set()
    for account in accounts:
        if not isinstance(account, dict):
            raise SchemaError("an account must be an object")
        platform = account.get("platform")
        handle = account.get("handle")
        if platform not in PLATFORMS:
            raise SchemaError("unknown platform " + str(platform))
        if not isinstance(handle, str) or not HANDLE[platform].match(handle):
            raise SchemaError("invalid " + str(platform) + " handle")
        key = (platform, handle.casefold())
        if key in seen:
            raise SchemaError("duplicate account on " + pid)
        seen.add(key)
        channel = account.get("channelId") or ""
        if channel and not CHANNEL_ID.match(channel):
            raise SchemaError("channelId must be a YouTube channel id")
        source = account.get("source") or ""
        if source and (not isinstance(source, str) or len(source) > 400):
            raise SchemaError("account source is too long")


def account_url(account: dict) -> str:
    platform = account.get("platform") or ""
    handle = account.get("handle") or ""
    if platform == "x":
        return "https://x.com/" + handle
    if platform == "threads":
        return "https://www.threads.com/@" + handle
    if platform == "instagram":
        return "https://www.instagram.com/" + handle + "/"
    if platform == "youtube":
        channel = account.get("channelId") or ""
        if channel and handle == channel:
            return "https://www.youtube.com/channel/" + channel
        return "https://www.youtube.com/@" + handle
    if platform == "vk":
        return "https://vk.com/" + handle
    if platform == "telegram":
        return "https://t.me/" + handle
    return account.get("url") or ""


def _slug(name: str, people: list) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")[:48] or "person"
    ids = {person.get("id") for person in people}
    if base not in ids:
        return base
    n = 2
    while f"{base}-{n}" in ids:
        n += 1
    return f"{base}-{n}"


def parse_account_line(line: str) -> dict:
    from follow_request import Reject, normalize

    text = (line or "").strip()
    if not text:
        raise Reject("an account line is empty")
    tele = re.match(r"^(?:telegram:|https?://(?:t\.me|telegram\.me)/)@?([A-Za-z0-9_]{5,32})/?$", text, re.I)
    if tele:
        handle = tele.group(1)
        return {"platform": "telegram", "handle": handle, "url": "https://t.me/" + handle, "channelId": ""}
    spec = normalize(text, "")
    spec.setdefault("channelId", "")
    return spec


def _confirm_telegram(spec: dict, fetch) -> dict:
    from follow_request import Reject

    status, body = fetch(spec["url"])
    if status != 200 or "tgme_page_title" not in (body or ""):
        raise Reject("Telegram did not confirm that account")
    return spec


def apply_link(config: dict, body: str, fetch, resolve=None) -> tuple[str, dict]:
    """Attach confirmed accounts to one person. Never merges two people."""
    from follow_request import Reject, _fields, confirm_source

    fields = _fields(body)
    person_field = (fields.get("person") or "").strip()
    raw_accounts = fields.get("accounts") or ""
    if not person_field:
        raise Reject("the person field is empty")
    lines = [line.strip() for line in raw_accounts.splitlines() if line.strip()]
    if not lines:
        raise Reject("the accounts field is empty")
    if len(lines) > 12:
        raise Reject("too many accounts")
    confirmed = []
    for line in lines:
        spec = parse_account_line(line)
        if spec["platform"] == "telegram":
            spec = _confirm_telegram(spec, fetch)
        else:
            spec = confirm_source(spec, fetch, resolve)
        confirmed.append(spec)
    people = [dict(person) for person in (config.get("people") or [])]
    for person in people:
        person["accounts"] = [dict(account) for account in person.get("accounts") or []]
    target = None
    for person in people:
        if person.get("id") == person_field or (person.get("name") or "").casefold() == person_field.casefold():
            target = person
            break
    created = False
    if target is None:
        target = {"id": _slug(person_field, people), "name": person_field.strip()[:80], "accounts": []}
        people.append(target)
        created = True
    linked = []
    already = []
    owned = {}
    for person in people:
        for account in person.get("accounts") or []:
            owned[(account["platform"], account["handle"].casefold())] = person["id"]
    for spec in confirmed:
        key = (spec["platform"], spec["handle"].casefold())
        owner = owned.get(key)
        if owner and owner != target["id"]:
            raise Reject(spec["platform"] + ":" + spec["handle"] + " is already linked to " + owner)
        if owner == target["id"]:
            already.append(spec["platform"] + ":" + spec["handle"])
            continue
        row = {"platform": spec["platform"], "handle": spec["handle"]}
        if spec.get("channelId"):
            row["channelId"] = spec["channelId"]
        target["accounts"].append(row)
        owned[key] = target["id"]
        linked.append(spec["platform"] + ":" + spec["handle"])
    if not target["accounts"]:
        raise Reject("nothing to link")
    try:
        validate_config({"people": people})
    except SchemaError as exc:
        raise Reject(str(exc)) from exc
    config["people"] = people
    if not linked:
        return target["id"] + " already has " + ", ".join(already) + ".", config
    verb = "Created " + target["id"] + " and linked " if created else "Linked "
    return verb + ", ".join(linked) + " to " + target["id"] + ".", config


def _handle_names(row: dict) -> list:
    names = [row.get("handle") or ""]
    names.extend(row.get("previousHandles") or [])
    return [str(name).lstrip("@") for name in names if str(name or "").strip()]


def _same_feed(feed: dict, account: dict) -> bool:
    if (feed.get("platform") or "") != account.get("platform"):
        return False
    feed_names = {name.casefold() for name in _handle_names(feed)}
    account_names = {name.casefold() for name in _handle_names(account)}
    if feed_names and account_names and feed_names & account_names:
        return True
    left = str(feed.get("permanentId") or "")
    right = str(account.get("permanentId") or "")
    if left and left == right:
        return True
    channel = account.get("channelId") or ""
    return bool(channel) and feed.get("channelId") == channel


def extra_feeds(config: dict) -> list:
    """Feed rows for linked accounts that are not already in the config."""
    from follow_request import entry_for

    try:
        from adapters import ADAPTERS
    except ImportError:
        ADAPTERS = {}
    rows = []
    have = list(config.get("feeds") or [])
    for person in config.get("people") or []:
        if not isinstance(person, dict):
            continue
        for account in person.get("accounts") or []:
            if not isinstance(account, dict):
                continue
            platform = account.get("platform") or ""
            if platform == "telegram" and "telegram" not in ADAPTERS:
                continue
            if platform not in ("x", "threads", "instagram", "youtube", "vk", "rss", "telegram"):
                continue
            if any(_same_feed(feed, account) for feed in have):
                continue
            spec = {
                "platform": platform,
                "handle": account.get("handle") or "",
                "url": account_url(account),
                "channelId": account.get("channelId") or "",
            }
            if platform == "rss" and not spec["url"].startswith("https://"):
                continue
            try:
                row = entry_for(spec)
            except Exception:
                continue
            if account.get("permanentId"):
                row["permanentId"] = account.get("permanentId")
            if account.get("secUid"):
                row["secUid"] = account.get("secUid")
            previous = [str(item).lstrip("@") for item in (account.get("previousHandles") or []) if str(item or "").strip()]
            if previous:
                row["previousHandles"] = previous
                row["id"] = platform + ":" + previous[0]
            profile = {"url": spec["url"]}
            if person.get("name"):
                profile["name"] = person["name"]
            row["profile"] = profile
            rows.append(row)
            have.append(row)
    return rows


def _profile_match(profile: dict, account: dict) -> bool:
    if (profile.get("platform") or "") != account.get("platform"):
        return False
    if _same_feed(profile, account):
        return True
    channel = account.get("channelId") or ""
    return bool(channel) and profile.get("channelId") == channel


def image_score(url: str) -> int:
    if not url or not str(url).startswith("https://"):
        return -1
    score = 1
    for width, height in re.findall(r"(\d{2,4})x(\d{2,4})", url):
        score = max(score, int(width) * int(height))
    for size in re.findall(r"(?:[/=][sw])(\d{3,4})", url):
        score = max(score, int(size) * int(size))
    return score


def _upgrade_avatar(url: str) -> str:
    from adapters.common import upgrade_avatar

    return upgrade_avatar(url or "")


def _upgrade_banner(url: str) -> str:
    if not url:
        return ""
    if "profile_banners/" in url and not re.search(r"/\d+x\d+$", url):
        return url + "/1500x500"
    return url


def _best(urls: list[str], upgrade) -> str:
    best = ""
    best_score = -1
    for url in urls:
        upgraded = upgrade(url)
        score = image_score(upgraded)
        if score > best_score:
            best = upgraded
            best_score = score
    return best


def _combine_bios(bios: list[str]) -> str:
    kept: list[str] = []
    folded: list[str] = []
    ordered = sorted((bio.strip() for bio in bios if bio and bio.strip()), key=len, reverse=True)
    for bio in ordered:
        key = re.sub(r"\s+", " ", bio).casefold()
        if any(key in prev or prev in key for prev in folded):
            continue
        folded.append(key)
        kept.append(bio)
    return "\n\n".join(kept)


def _number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return int(value)
    return None


def _account_row(person_account: dict, profile: dict | None) -> dict:
    profile = profile or {}
    row = {
        "platform": person_account["platform"],
        "handle": person_account["handle"],
        "url": profile.get("url") or account_url(person_account),
    }
    if person_account.get("channelId") or profile.get("channelId"):
        row["channelId"] = person_account.get("channelId") or profile.get("channelId")
    permanent = person_account.get("permanentId") or profile.get("permanentId") or ""
    if permanent:
        row["permanentId"] = permanent
    sec = person_account.get("secUid") or profile.get("secUid") or ""
    if sec:
        row["secUid"] = sec
    previous = person_account.get("previousHandles") or profile.get("previousHandles") or []
    if previous:
        row["previousHandles"] = list(previous)
    if profile.get("id"):
        row["feedId"] = profile["id"]
    else:
        row["feedId"] = person_account["platform"] + ":" + person_account["handle"]
    for field in ("name", "bio", "avatar", "banner"):
        if profile.get(field):
            row[field] = profile[field]
    if row.get("avatar"):
        row["avatar"] = _upgrade_avatar(row["avatar"])
    if row.get("banner"):
        row["banner"] = _upgrade_banner(row["banner"])
    followers = _number(profile.get("followers"))
    if followers is not None:
        row["followers"] = followers
    following = _number(profile.get("following"))
    if following is not None:
        row["following"] = following
    if person_account.get("source"):
        row["source"] = person_account["source"]
    return row


def _fetch_json(url: str, timeout: int = 15) -> dict:
    from site_paths import user_agent
    from x_guard import assert_not_x_api, open_url

    assert_not_x_api(url)
    request = urllib.request.Request(url, headers={"User-Agent": user_agent(), "Accept": "application/json"})
    with open_url(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def enrich_x(account: dict) -> dict:
    """Public fxtwitter profile. Empty when the source does not answer."""
    handle = account.get("handle") or ""
    if not handle:
        return {}
    try:
        data = _fetch_json("https://api.fxtwitter.com/" + urllib.parse.quote(handle))
    except Exception:
        return {}
    user = data.get("user") or {}
    if not user:
        return {}
    website = user.get("website") or {}
    return {
        "platform": "x",
        "handle": user.get("screen_name") or handle,
        "name": user.get("name") or "",
        "bio": user.get("description") or "",
        "avatar": user.get("avatar_url") or "",
        "banner": user.get("banner_url") or "",
        "followers": user.get("followers"),
        "following": user.get("following"),
        "url": user.get("url") or account_url(account),
        "permanentId": str(user.get("id") or "") if str(user.get("id") or "").isdigit() else "",
        "website": website.get("url") if isinstance(website, dict) else "",
    }


def build_people(config: dict, profiles: list, fetch: bool = False) -> dict:
    built = []
    for person in config.get("people") or []:
        rows = []
        for account in person.get("accounts") or []:
            profile = next((item for item in profiles if _profile_match(item, account)), None)
            if fetch and account.get("platform") == "x" and not (profile and profile.get("followers")):
                live = enrich_x(account)
                if live:
                    profile = dict(profile or {})
                    for key, value in live.items():
                        if value not in ("", None):
                            profile[key] = value
                    if live.get("permanentId"):
                        try:
                            from account_identity import apply_to_config

                            apply_to_config(config, account, {
                                "handle": live.get("handle") or account.get("handle"),
                                "permanentId": live.get("permanentId"),
                                "authoritative": True,
                                "platform": "x",
                            })
                        except Exception:
                            pass
            rows.append(_account_row(account, profile))
        avatars = [person.get("avatar") or ""] + [row.get("avatar") or "" for row in rows]
        banners = [person.get("banner") or ""] + [row.get("banner") or "" for row in rows]
        bios = [row.get("bio") or "" for row in rows]
        item = {
            "id": person["id"],
            "name": person.get("name") or person["id"],
            "avatar": _best(avatars, _upgrade_avatar),
            "banner": _best(banners, _upgrade_banner),
            "bio": _combine_bios(bios),
            "accounts": rows,
        }
        if not item["avatar"]:
            item.pop("avatar")
        if not item["banner"]:
            item.pop("banner")
        if not item["bio"]:
            item.pop("bio")
        built.append(item)
    return {"updated": now_iso(), "people": built}


def _clean_url(url: str) -> str:
    return (url or "").strip().rstrip(").,]>\"'")


def collect_urls(post: dict) -> list[str]:
    found = []
    for link in post.get("links") or []:
        if isinstance(link, dict):
            found.append(link.get("expanded") or link.get("url") or "")
        elif isinstance(link, str):
            found.append(link)
    found.extend(URL_RE.findall(post.get("text") or ""))
    out = []
    seen = set()
    for raw in found:
        url = _clean_url(raw)
        if not url.lower().startswith("http"):
            continue
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        if host == "t.co" or host.endswith(".t.co"):
            continue
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(url)
    return out


def youtube_video_id(url: str) -> str:
    match = YT_VIDEO.search(url or "")
    return match.group(1) if match else ""


def _youtube_accounts(person: dict) -> list:
    return [account for account in person.get("accounts") or [] if account.get("platform") == "youtube"]


def _x_accounts(person: dict) -> list:
    return [account for account in person.get("accounts") or [] if account.get("platform") == "x"]


def known_video_ids(posts: list, accounts: list) -> set[str]:
    handles = {(account.get("handle") or "").casefold() for account in accounts}
    channels = {account.get("channelId") or "" for account in accounts if account.get("channelId")}
    ids = set()
    for post in posts:
        if (post.get("platform") or "") != "youtube":
            continue
        handle = (post.get("handle") or "").casefold()
        feed = post.get("feedId") or ""
        url = post.get("url") or ""
        owned = handle in handles or any(channel and channel in url for channel in channels)
        owned = owned or any(feed.casefold() == "youtube:" + (account.get("handle") or "").casefold() for account in accounts)
        if not owned:
            continue
        for blob in (url, str(post.get("statusId") or ""), str(post.get("id") or "")):
            found = youtube_video_id(blob)
            if found:
                ids.add(found)
            elif re.fullmatch(r"[A-Za-z0-9_-]{11}", blob):
                ids.add(blob)
    return ids


def _owns_video(url: str, video_id: str, accounts: list, known: set[str], oembed: dict | None) -> bool:
    if video_id and video_id in known:
        return True
    low = (url or "").lower()
    author = ((oembed or {}).get("author_url") or "").lower()
    for account in accounts:
        handle = (account.get("handle") or "").casefold()
        channel = (account.get("channelId") or "").lower()
        if channel and (channel in low or channel in author):
            return True
        if handle and (f"/@{handle}" in low or f"/user/{handle}" in low or f"/@{handle}" in author or f"/user/{handle}" in author):
            return True
    return False


def _default_oembed(url: str) -> dict:
    endpoint = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(url, safe="")
    try:
        data = _fetch_json(endpoint, timeout=12)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def stamp_cross_posts(posts: list, config: dict, fetch: bool = False, oembed=None) -> int:
    """An X post whose only link is that person's own YouTube video gets alsoOn."""
    people = config.get("people") or []
    stamped = 0
    calls = 0
    for post in posts:
        if (post.get("platform") or "") != "x":
            continue
        person = None
        handle = (post.get("handle") or "").casefold()
        for candidate in people:
            if any((account.get("handle") or "").casefold() == handle for account in _x_accounts(candidate)):
                person = candidate
                break
        if person is None:
            continue
        urls = collect_urls(post)
        videos = []
        others = []
        for url in urls:
            video_id = youtube_video_id(url)
            if video_id:
                videos.append((url, video_id))
            else:
                others.append(url)
        if len(videos) != 1 or others:
            post.pop("alsoOn", None)
            continue
        url, video_id = videos[0]
        accounts = _youtube_accounts(person)
        known = known_video_ids(posts, accounts)
        info = None
        if video_id not in known and fetch and calls < 30:
            calls += 1
            info = (oembed or _default_oembed)(url)
        if not _owns_video(url, video_id, accounts, known, info):
            post.pop("alsoOn", None)
            continue
        chosen = accounts[0] if accounts else {}
        post["alsoOn"] = {
            "person": person.get("id") or "",
            "platform": "youtube",
            "handle": chosen.get("handle") or "",
            "videoId": video_id,
            "url": url,
        }
        stamped += 1
    return stamped


def _tokens(profile: dict) -> list[str]:
    platform = profile.get("platform") or ""
    handle = (profile.get("handle") or "").casefold()
    tokens = []
    url = (profile.get("url") or "").rstrip("/").casefold()
    if url:
        tokens.append(url)
    website = (profile.get("website") or "").rstrip("/").casefold()
    if website.startswith("http"):
        tokens.append(website)
    if platform == "x" and handle:
        tokens.extend([f"x.com/{handle}", f"twitter.com/{handle}"])
    elif platform == "instagram" and handle:
        tokens.append(f"instagram.com/{handle}")
    elif platform == "threads" and handle:
        tokens.extend([f"threads.com/@{handle}", f"threads.net/@{handle}"])
    elif platform == "youtube" and handle:
        tokens.append(f"youtube.com/@{handle}")
        channel = profile.get("channelId") or ""
        if channel:
            tokens.append(f"youtube.com/channel/{channel.casefold()}")
    elif platform == "vk" and handle:
        tokens.append(f"vk.com/{handle}")
    elif platform == "telegram" and handle:
        tokens.extend([f"t.me/{handle}", f"telegram.me/{handle}"])
    return [token for token in tokens if len(token) >= 6]


def _blob(profile: dict) -> str:
    return " ".join([
        profile.get("bio") or "",
        profile.get("website") or "",
        profile.get("description") or "",
    ]).casefold()


def _points_at(profile: dict, other: dict) -> bool:
    blob = _blob(profile)
    if not blob.strip():
        return False
    for token in _tokens(other):
        if re.search(r"(?<![a-z0-9_])" + re.escape(token) + r"(?![a-z0-9_])", blob):
            return True
    return False


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).casefold()


def _norm_avatar(url: str) -> str:
    return _upgrade_avatar(url).split("?")[0]


def _linked_keys(people: list) -> set[tuple[str, str]]:
    keys = set()
    for person in people:
        for account in person.get("accounts") or []:
            keys.add((account.get("platform") or "", (account.get("handle") or "").casefold()))
    return keys


def suggest(profiles: list, people: list) -> list:
    """Likely links. Already-linked accounts are left out, and nothing is merged."""
    linked = _linked_keys(people)
    rows = []
    for profile in profiles:
        platform = profile.get("platform") or ""
        handle = profile.get("handle") or ""
        if not platform or not handle:
            continue
        if (platform, handle.casefold()) in linked:
            continue
        rows.append(profile)
    pairs = []
    for i, left in enumerate(rows):
        for right in rows[i + 1:]:
            if (left.get("platform") or "") == (right.get("platform") or ""):
                continue
            reasons = []
            if _points_at(left, right) and _points_at(right, left):
                reasons.append("bio links point at each other")
            left_name = _norm_name(left.get("name") or "")
            right_name = _norm_name(right.get("name") or "")
            left_avatar = _norm_avatar(left.get("avatar") or "")
            right_avatar = _norm_avatar(right.get("avatar") or "")
            if left_name and left_name == right_name and left_avatar and left_avatar == right_avatar:
                reasons.append("same name and avatar")
            if reasons:
                pairs.append((left, right, reasons))
    groups: list[dict] = []
    for left, right, reasons in pairs:
        ids = {_ref(left), _ref(right)}
        home = None
        for group in groups:
            if ids & set(group["ids"]):
                home = group
                break
        if home is None:
            home = {"ids": set(), "reasons": set(), "accounts": []}
            groups.append(home)
        home["ids"] |= ids
        home["reasons"] |= set(reasons)
        for profile in (left, right):
            ref = _account_ref(profile)
            if ref not in home["accounts"]:
                home["accounts"].append(ref)
    out = []
    for group in groups:
        out.append({
            "reasons": sorted(group["reasons"]),
            "accounts": group["accounts"],
        })
    return out


def _merge_suggestions(first: list, second: list) -> list:
    out = []
    seen = set()
    for row in list(first or []) + list(second or []):
        key = tuple(sorted(str(a.get("id") or "").casefold() for a in row.get("accounts") or []))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def _ref(profile: dict) -> str:
    return (profile.get("platform") or "") + ":" + (profile.get("handle") or "").casefold()


def _account_ref(profile: dict) -> dict:
    return {
        "platform": profile.get("platform") or "",
        "handle": profile.get("handle") or "",
        "id": profile.get("id") or _ref(profile),
        "name": profile.get("name") or "",
    }


# ---------------------------------------------------------------------------
# Automatic merges. Everything here reads the profiles and posts the sync has
# already fetched: no extra requests. Strong evidence merges, weaker evidence
# becomes a suggestion that the reader confirms with one tap.

AUTO_PLATFORMS = ("x", "threads", "instagram", "youtube", "vk", "telegram", "tiktok", "bsky", "mastodon", "rss", "reddit", "twitch")
CROSS_WINDOW = 10 * 60
VIDEO_WINDOW = 6 * 60 * 60
PLATFORM_RANK = {"youtube": 0, "x": 1, "instagram": 2, "threads": 3, "tiktok": 4, "bsky": 5, "vk": 6, "telegram": 7, "rss": 8}


def _extra_tokens(profile: dict) -> list[str]:
    platform = profile.get("platform") or ""
    handle = (profile.get("handle") or "").casefold()
    out = []
    if not handle:
        return out
    if platform == "tiktok":
        out.append(f"tiktok.com/@{handle}")
    elif platform == "bsky":
        out.extend([f"bsky.app/profile/{handle}"])
    elif platform == "instagram":
        out.append(f"instagr.am/{handle}")
    return [token for token in out if len(token) >= 6]


def links_to(profile: dict, other: dict) -> bool:
    """profile's bio, website or link fields point at other."""
    if _points_at(profile, other):
        return True
    blob = _blob(profile)
    if not blob.strip():
        return False
    for token in _extra_tokens(other):
        if re.search(r"(?<![a-z0-9_])" + re.escape(token) + r"(?![a-z0-9_])", blob):
            return True
    return False


def _same_name(left: dict, right: dict) -> bool:
    a = re.sub(r"[^\w]+", "", _norm_name(left.get("name") or ""))
    b = re.sub(r"[^\w]+", "", _norm_name(right.get("name") or ""))
    return len(a) >= 3 and a == b


def _same_avatar(left: dict, right: dict) -> bool:
    a = _norm_avatar(left.get("avatar") or "")
    b = _norm_avatar(right.get("avatar") or "")
    if a and a == b:
        return True
    ha = left.get("avatarHash") or ""
    hb = right.get("avatarHash") or ""
    if ha and hb and len(ha) == len(hb):
        try:
            return bin(int(ha, 16) ^ int(hb, 16)).count("1") <= 10
        except ValueError:
            return False
    return False


def pair_evidence(left: dict, right: dict) -> tuple[str, list[str]]:
    """("strong" | "weak" | "", reasons) for two profiles on different platforms."""
    lp = left.get("platform") or ""
    rp = right.get("platform") or ""
    if not lp or not rp or lp == rp:
        return "", []
    lh = (left.get("handle") or "").casefold()
    rh = (right.get("handle") or "").casefold()
    if {lp, rp} == {"threads", "instagram"} and lh and lh == rh:
        return "strong", ["threads-instagram"]
    there = links_to(left, right)
    back = links_to(right, left)
    name = _same_name(left, right)
    face = _same_avatar(left, right)
    if there and back:
        return "strong", ["mutual-links"]
    if (there or back) and (name or face):
        return "strong", ["link+" + ("name" if name else "avatar")]
    if there or back:
        return "weak", ["one-way-link"]
    if lh and lh == rh and len(lh) >= 4 and (name or face):
        return "weak", ["same-handle+" + ("name" if name else "avatar")]
    if name and face:
        return "weak", ["same-name+avatar"]
    return "", []


LINK_RE = re.compile(r"(?:https?://)?(?:www\.|m\.)?((?:x|twitter|instagram|instagr|threads|youtube|tiktok|vk|t|telegram|bsky)\.(?:com|net|me|am|app)/[@\w./-]+)", re.I)


def candidate_pairs(rows: list) -> list:
    """Pairs worth comparing, found through indexes instead of every pair."""
    by_token: dict[str, list] = {}
    by_name: dict[str, list] = {}
    by_handle: dict[str, list] = {}
    for at, profile in enumerate(rows):
        for token in _tokens(profile) + _extra_tokens(profile):
            key = re.sub(r"^https?://(?:www\.|m\.)?", "", token.casefold()).rstrip("/")
            by_token.setdefault(key, []).append(at)
        name = re.sub(r"[^\w]+", "", _norm_name(profile.get("name") or ""))
        if len(name) >= 3:
            by_name.setdefault(name, []).append(at)
        handle = (profile.get("handle") or "").casefold()
        if handle:
            by_handle.setdefault(handle, []).append(at)
    pairs: set[tuple[int, int]] = set()

    def add(a: int, b: int) -> None:
        if a != b:
            pairs.add((min(a, b), max(a, b)))

    for at, profile in enumerate(rows):
        for match in LINK_RE.finditer(_blob(profile)):
            key = match.group(1).casefold().rstrip("/.")
            key = key.replace("twitter.com/", "x.com/").replace("threads.net/", "threads.com/").replace("telegram.me/", "t.me/")
            for size in (key, key.split("?")[0], "/".join(key.split("/")[:2]), "/".join(key.split("/")[:3])):
                for other in by_token.get(size, []):
                    add(at, other)
    for bucket in list(by_name.values()) + list(by_handle.values()):
        if len(bucket) > 40:
            continue
        for i, a in enumerate(bucket):
            for b in bucket[i + 1:]:
                add(a, b)
    return [(rows[a], rows[b]) for a, b in sorted(pairs)]


def _profile_ref(profile: dict) -> str:
    return (profile.get("id") or _ref(profile)).casefold()


def auto_people(profiles: list, people: list, split: set | None = None) -> tuple[list, list, dict]:
    """Owner-linked people, extended with strong automatic merges.

    Returns (people, weak suggestions, counts). Hand-linked people keep their
    ids and accounts; an automatic match only adds accounts to them.
    split holds feed ids the owner pulled out; they never merge again.
    """
    split = {str(item).casefold() for item in (split or set())}
    rows = []
    seen = set()
    for profile in profiles or []:
        if not isinstance(profile, dict):
            continue
        platform = profile.get("platform") or ""
        if platform not in AUTO_PLATFORMS or not profile.get("handle"):
            continue
        ref = _profile_ref(profile)
        if ref in seen or ref in split:
            continue
        seen.add(ref)
        rows.append(profile)
    owner_of: dict[str, int] = {}
    for index, person in enumerate(people or []):
        for account in person.get("accounts") or []:
            for profile in rows:
                if _profile_match(profile, account):
                    owner_of[_profile_ref(profile)] = index
    parent = {_profile_ref(p): _profile_ref(p) for p in rows}

    def find(key):
        while parent[key] != key:
            parent[key] = parent[parent[key]]
            key = parent[key]
        return key

    members: dict[str, list] = {key: [p] for key, p in ((_profile_ref(p), p) for p in rows)}
    reasons: dict[str, set] = {key: set() for key in parent}
    weak = []
    for left, right in candidate_pairs(rows):
        if True:
            level, why = pair_evidence(left, right)
            if not level:
                continue
            a, b = find(_profile_ref(left)), find(_profile_ref(right))
            if a == b:
                continue
            if level == "weak":
                weak.append((left, right, why))
                continue
            owners = {owner_of.get(_profile_ref(p)) for p in members[a] + members[b]} - {None}
            platforms_a = {p.get("platform") for p in members[a]}
            platforms_b = {p.get("platform") for p in members[b]}
            if len(owners) > 1 or platforms_a & platforms_b:
                weak.append((left, right, why))
                continue
            parent[b] = a
            members[a].extend(members.pop(b))
            reasons[a] |= reasons.pop(b) | set(why)
    out = [dict(person, accounts=list(person.get("accounts") or [])) for person in people or []]
    added = 0
    created = 0
    for root, group in members.items():
        if len(group) < 2:
            continue
        owner = next((owner_of[_profile_ref(p)] for p in group if _profile_ref(p) in owner_of), None)
        accounts = []
        for profile in group:
            if owner is not None and _profile_ref(profile) in owner_of:
                continue
            row = {"platform": profile.get("platform"), "handle": profile.get("handle"), "auto": True}
            for field in ("permanentId", "channelId", "secUid"):
                if profile.get(field):
                    row[field] = profile[field]
            accounts.append(row)
        if owner is not None:
            out[owner]["accounts"].extend(accounts)
            added += len(accounts)
            continue
        group.sort(key=lambda p: (PLATFORM_RANK.get(p.get("platform") or "", 9), _profile_ref(p)))
        anchor = _profile_ref(group[0])
        import hashlib

        pid = "m-" + hashlib.sha1(anchor.encode("utf-8")).hexdigest()[:12]
        name = next((p.get("name") for p in group if p.get("name")), "") or group[0].get("handle") or pid
        out.append({"id": pid, "name": name, "auto": True, "reasons": sorted(reasons.get(root) or []), "accounts": accounts})
        created += 1
    merged_refs = set()
    for root, group in members.items():
        if len(group) >= 2:
            merged_refs |= {_profile_ref(p) for p in group}
    suggestions = []
    for left, right, why in weak:
        if find(_profile_ref(left)) == find(_profile_ref(right)):
            continue
        suggestions.append({"reasons": why, "accounts": [_account_ref(left), _account_ref(right)]})
    counts = {"auto_people": created, "auto_accounts_added": added, "merged_profiles": len(merged_refs), "suggestions": len(suggestions)}
    return out, suggestions, counts


def _norm_text(text: str) -> str:
    text = URL_RE.sub(" ", text or "")
    text = re.sub(r"[@#]\w+", " ", text)
    text = re.sub(r"[^\w]+", " ", text.casefold()).strip()
    return text


def _epoch(value: str) -> float:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def _post_videos(post: dict) -> set[str]:
    found = set()
    if (post.get("platform") or "") == "youtube":
        vid = str(post.get("statusId") or post.get("id") or "").split(":")[-1]
        if re.match(r"^[A-Za-z0-9_-]{11}$", vid):
            found.add(vid)
    also = post.get("alsoOn")
    if isinstance(also, dict) and also.get("videoId"):
        found.add(also["videoId"])
    for url in collect_urls(post):
        vid = youtube_video_id(url)
        if vid:
            found.add(vid)
    return found


def _post_score(post: dict) -> tuple:
    media = [m for m in post.get("media") or [] if isinstance(m, dict)]
    video = any(m.get("type") in ("video", "animated_gif") for m in media) or (post.get("platform") == "youtube")
    pixels = 0
    for m in media:
        try:
            pixels = max(pixels, int(m.get("width") or 0) * int(m.get("height") or 0))
        except (TypeError, ValueError):
            pass
    return (1 if video else 0, len(media), pixels, -PLATFORM_RANK.get(post.get("platform") or "", 9))


def _person_index(people: list) -> dict:
    index = {}
    for person in people or []:
        pid = person.get("id")
        for account in person.get("accounts") or []:
            platform = account.get("platform") or ""
            for name in _handle_names(account):
                index[(platform, name.casefold())] = pid
            if account.get("feedId"):
                index[("feed", str(account["feedId"]).casefold())] = pid
            if account.get("channelId"):
                index[(platform, str(account["channelId"]).casefold())] = pid
    return index


def _owner(post: dict, index: dict) -> str:
    if post.get("feedId") and ("feed", str(post["feedId"]).casefold()) in index:
        return index[("feed", str(post["feedId"]).casefold())]
    return index.get((post.get("platform") or "", (post.get("handle") or "").lstrip("@").casefold()), "")


def _cross_ref(post: dict) -> dict:
    row = {"platform": post.get("platform") or "", "id": post.get("id") or ""}
    for field in ("feedId", "statusId", "url"):
        if post.get(field):
            row[field] = post[field]
    return row


def dedupe_cross_posts(posts: list, people: list) -> tuple[list, dict]:
    """One card for the same post on several platforms of one person.

    Same normalized text within 10 minutes, or the same YouTube video within
    6 hours. The richest copy stays (video first, then more and larger media)
    and lists the others in crossPosts, so a reader who follows only one of
    the platforms still gets the post and can open each original.
    """
    index = _person_index(people)
    by_person: dict[str, list] = {}
    for at, post in enumerate(posts):
        if not isinstance(post, dict) or post.get("kind") in ("reply", "repost") or post.get("repostedBy"):
            continue
        pid = _owner(post, index)
        if pid:
            by_person.setdefault(pid, []).append(at)
    drop = set()
    per_feed_dropped: dict[str, int] = {}
    groups = 0
    for pid, ats in by_person.items():
        ats.sort(key=lambda i: _epoch(posts[i].get("date")))
        for x, i in enumerate(ats):
            if i in drop:
                continue
            left = posts[i]
            lt = _epoch(left.get("date"))
            ltext = _norm_text(left.get("text") or "")
            lvid = _post_videos(left)
            group = [i]
            for j in ats[x + 1:]:
                if j in drop:
                    continue
                right = posts[j]
                rt = _epoch(right.get("date"))
                if rt - lt > VIDEO_WINDOW:
                    break
                if any((posts[g].get("platform") or "") == (right.get("platform") or "") for g in group):
                    continue
                same_video = bool(lvid & _post_videos(right))
                same_text = len(ltext) >= 16 and ltext == _norm_text(right.get("text") or "") and rt - lt <= CROSS_WINDOW
                if same_video or same_text:
                    group.append(j)
            if len(group) < 2:
                continue
            groups += 1
            keep = max(group, key=lambda g: _post_score(posts[g]))
            primary = posts[keep]
            refs = [r for r in (primary.get("crossPosts") or []) if isinstance(r, dict)]
            for g in group:
                if g == keep:
                    continue
                refs.append(_cross_ref(posts[g]))
                drop.add(g)
                fid = str(posts[g].get("feedId") or "")
                if fid:
                    per_feed_dropped[fid] = per_feed_dropped.get(fid, 0) + 1
            primary["crossPosts"] = refs
            primary.pop("alsoOn", None) if (primary.get("platform") == "youtube") else None
    kept = [post for at, post in enumerate(posts) if at not in drop]
    per_feed_total: dict[str, int] = {}
    for post in posts:
        if isinstance(post, dict) and post.get("feedId"):
            per_feed_total[str(post["feedId"])] = per_feed_total.get(str(post["feedId"]), 0) + 1
    mirrors = {}
    for fid, n in per_feed_dropped.items():
        total = per_feed_total.get(fid, 0)
        if total >= 3 and n / total >= 0.8:
            mirrors[fid] = round(n / total, 2)
    return kept, {"groups": groups, "dropped": len(drop), "before": len(posts), "after": len(kept), "mirrors": mirrors}


MIRROR_KEY = "sync/mirrors.json"
MIRROR_EVERY = 3 * 60 * 60


def mirror_due(mirrors: dict, feed_id: str, now: float) -> bool:
    """A source that only repeats another merged source is read every 3 hours."""
    row = (mirrors or {}).get(feed_id)
    if not isinstance(row, dict):
        return True
    return now - float(row.get("read") or 0) >= MIRROR_EVERY


def update_mirrors(mirrors: dict, found: dict, read_ids: set, now: float) -> dict:
    out = {}
    for fid, share in (found or {}).items():
        prev = (mirrors or {}).get(fid) or {}
        out[fid] = {"share": share, "read": now if fid in read_ids else float(prev.get("read") or now)}
    for fid, prev in (mirrors or {}).items():
        if fid in out or not isinstance(prev, dict):
            continue
        if fid not in read_ids:
            out[fid] = prev
    return out


def publish(config: dict, doc: dict, fetch: bool = False, root: Path | None = None) -> dict:
    validate_config(config)
    profiles = list(doc.get("feeds") or [])
    posts = list(doc.get("posts") or [])
    linked, weak, counts = auto_people(profiles, config.get("people") or [], set(config.get("peopleSplit") or []))
    people_doc = build_people(dict(config, people=linked), profiles, fetch=fetch)
    try:
        from account_deletions import load_deletions, scrub_value

        hashes, deletion_salt = load_deletions()
        if hashes:
            scrubbed = scrub_value(people_doc, hashes, deletion_salt)
            if isinstance(scrubbed, dict):
                people_doc = scrubbed
    except (ImportError, TypeError, ValueError):
        pass
    suggestions = {
        "updated": people_doc["updated"],
        "suggestions": _merge_suggestions(suggest(profiles, linked), weak),
    }
    dest = root or ROOT
    (dest / "people.json").write_text(json.dumps(people_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (dest / "suggestions.json").write_text(json.dumps(suggestions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[people] {len(people_doc['people'])} people, {len(suggestions['suggestions'])} suggestions, {counts['auto_people']} automatic, {counts['merged_profiles']} merged profiles")
    return people_doc


def main() -> None:
    config = json.loads((ROOT / "feeds.config.json").read_text(encoding="utf-8"))
    feeds_path = ROOT / config.get("output", "feeds.json")
    doc = {"feeds": [], "posts": []}
    if feeds_path.exists():
        doc = json.loads(feeds_path.read_text(encoding="utf-8"))
    stamp_cross_posts(doc.get("posts") or [], config, fetch=False)
    publish(config, doc, fetch=True)


if __name__ == "__main__":
    main()
