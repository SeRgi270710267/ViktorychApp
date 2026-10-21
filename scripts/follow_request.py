#!/usr/bin/env python3
"""Turn a repo-owner follow, unfollow, or subscription-groups issue into a feeds.config.json edit.

Anyone else is ignored. The workflow only starts this for the owner, and
this script checks the actor again before it reads the issue or writes.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_paths import user_agent  # noqa: E402

CONFIG = ROOT / "feeds.config.json"
UA = user_agent()
PLATFORMS = ("x", "threads", "instagram", "youtube", "vk", "telegram", "rss")
HANDLE = {
    "x": re.compile(r"^[A-Za-z0-9_]{1,15}$"),
    "threads": re.compile(r"^[A-Za-z0-9._]{1,30}$"),
    "instagram": re.compile(r"^[A-Za-z0-9._]{1,30}$"),
    "youtube": re.compile(r"^(?:[A-Za-z0-9._-]{3,30}|UC[\w-]{22})$"),
    "vk": re.compile(r"^[A-Za-z0-9_.]{1,32}$"),
    "telegram": re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$"),
}
NITTER = [
    "https://nitter.meowing.monster/{handle}/rss",
    "https://nitter.kareem.one/{handle}/rss",
    "https://nitter.jaydenha.uk/{handle}/rss",
]


class Reject(Exception):
    pass


def allowed(actor: str, owner: str) -> bool:
    return bool(actor) and actor == owner


def _fields(body: str) -> dict:
    fields = {}
    current = ""
    buf = []
    for line in (body or "").splitlines():
        if line.startswith("### "):
            if current:
                fields[current] = "\n".join(buf).strip()
            current = line[4:].strip().lower()
            buf = []
        elif current:
            buf.append(line)
    if current:
        fields[current] = "\n".join(buf).strip()
    return fields


def clean_groups(data, resolve=None) -> list:
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise Reject("the groups field is not JSON") from exc
    if not isinstance(data, list):
        raise Reject("groups must be a list")
    if len(data) > 40:
        raise Reject("too many groups")
    out = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            raise Reject("each group must be an object")
        gid = str(item.get("id") or "").strip()
        name = re.sub(r"\s+", " ", str(item.get("name") or "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", gid):
            raise Reject("a group id is missing")
        if gid in seen:
            raise Reject("duplicate group id")
        seen.add(gid)
        if not name or len(name) > 40:
            raise Reject("a group needs a name")
        icon = str(item.get("icon") or "").strip()
        if icon:
            if not icon.startswith("https://") or len(icon) > 300:
                raise Reject("group icons must be public https images")
            if not host_is_public(_host(icon), resolve):
                raise Reject("group icons must be public https images")
        members = item.get("members") or []
        if not isinstance(members, list) or len(members) > 200:
            raise Reject("a group has too many channels")
        cleaned = []
        for member in members:
            text = str(member or "").strip()
            if not text or len(text) > 80 or any(ch in text for ch in " \n\t<>"):
                raise Reject("a group channel id is not usable")
            if text not in cleaned:
                cleaned.append(text)
        out.append({"id": gid, "name": name, "icon": icon, "members": cleaned})
    return out


def parse_issue(title: str, body: str) -> dict:
    heading = (title or "").strip().lower()
    if heading.startswith("unfollow request"):
        kind = "unfollow"
    elif heading.startswith("follow request"):
        kind = "follow"
    else:
        raise Reject("this issue is not a follow request")
    fields = _fields(body)
    account = fields.get("account") or ""
    platform = (fields.get("platform") or "").strip().lower()
    if not account:
        raise Reject("the account field is empty")
    if platform and platform not in PLATFORMS:
        raise Reject("pick x, threads, instagram, youtube, vk, telegram, or rss")
    return {"kind": kind, "account": account.strip(), "platform": platform}


def _host(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("https", "http") or parsed.username or not parsed.hostname:
        raise Reject("use a public http(s) address with no password in it")
    return parsed.hostname.lower()


def host_is_public(host: str, resolve=None) -> bool:
    if not host or host == "localhost" or host.endswith(".local") or host.endswith(".localhost"):
        return False
    if resolve is None:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return False
        ips = [item[4][0] for item in infos]
    else:
        ips = list(resolve(host) or [])
    if not ips:
        return False
    for raw in ips:
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            return False
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def _url_handle(pattern: str, url: str) -> str:
    match = re.search(pattern, url, re.I)
    if not match:
        raise Reject("that URL does not match the platform")
    return match.group(1)


def normalize(account: str, platform: str) -> dict:
    text = (account or "").strip()
    forced = (platform or "").strip().lower()
    prefixed = re.match(r"^(x|threads|instagram|youtube|vk|telegram|rss):(\S+)$", text, re.I)
    if prefixed:
        forced = forced or prefixed.group(1).lower()
        text = prefixed.group(2)
        if prefixed.group(1).lower() != forced:
            raise Reject("the platform does not match the account")
    if forced and forced not in PLATFORMS:
        raise Reject("pick x, threads, instagram, youtube, vk, telegram, or rss")
    lower = text.lower()
    detected = forced
    handle = ""
    url = ""
    channel_id = ""
    if re.match(r"https?://", text, re.I):
        host = _host(text)
        path = urllib.parse.urlparse(text).path or ""
        if host in ("x.com", "twitter.com", "mobile.twitter.com") or host.endswith(".x.com"):
            detected = "x"
            handle = _url_handle(r"/([A-Za-z0-9_]{1,15})/?$", path)
            url = "https://x.com/" + handle
        elif "threads." in host:
            detected = "threads"
            handle = _url_handle(r"/@([A-Za-z0-9._]{1,30})/?$", path)
            url = "https://www.threads.com/@" + handle
        elif "instagram.com" in host:
            detected = "instagram"
            handle = _url_handle(r"/([A-Za-z0-9._]{1,30})/?$", path)
            url = "https://www.instagram.com/" + handle + "/"
        elif "youtube.com" in host or host == "youtu.be":
            detected = "youtube"
            channel = re.search(r"/channel/(UC[\w-]{22})/?$", path)
            custom = re.search(r"/@([A-Za-z0-9._-]{3,30})/?$", path)
            if channel:
                channel_id = channel.group(1)
                handle = channel_id
            elif custom:
                handle = custom.group(1)
            else:
                raise Reject("use a youtube.com/@handle or /channel/UC address")
            url = "https://www.youtube.com/channel/" + channel_id if channel_id else "https://www.youtube.com/@" + handle
        elif host == "vk.com" or host.endswith(".vk.com"):
            detected = "vk"
            handle = _url_handle(r"/([A-Za-z0-9_.]{1,32})/?$", path)
            url = "https://vk.com/" + handle
        elif host in ("t.me", "telegram.me") or host.endswith(".t.me"):
            detected = "telegram"
            found = re.search(r"/(?:s/)?([A-Za-z][A-Za-z0-9_]{4,31})(?:/\d+)?/?$", path)
            if not found or found.group(1).lower() in ("share", "addstickers", "joinchat", "iv", "proxy"):
                raise Reject("that URL does not match the platform")
            handle = found.group(1)
            url = "https://t.me/" + handle
        else:
            detected = "rss"
            url = text.split("#")[0]
            handle = rss_handle(url)
    else:
        handle = text[1:] if text.startswith("@") else text
        detected = forced or "x"
        if detected == "rss":
            raise Reject("an RSS follow needs the feed URL")
        if detected == "youtube" and re.fullmatch(r"UC[\w-]{22}", handle):
            channel_id = handle
            url = "https://www.youtube.com/channel/" + handle
        elif detected == "threads":
            url = "https://www.threads.com/@" + handle
        elif detected == "instagram":
            url = "https://www.instagram.com/" + handle + "/"
        elif detected == "vk":
            url = "https://vk.com/" + handle
        elif detected == "telegram":
            url = "https://t.me/" + handle
        elif detected == "youtube":
            url = "https://www.youtube.com/@" + handle
        else:
            detected = "x"
            url = "https://x.com/" + handle
    if forced and detected != forced:
        raise Reject("the platform does not match the account")
    if detected != "rss" and not HANDLE[detected].match(handle):
        raise Reject("that handle is not valid for " + detected)
    if detected == "rss" and not url.lower().startswith("https://"):
        raise Reject("RSS feeds have to use https")
    return {"platform": detected, "handle": handle, "url": url, "channelId": channel_id}


def rss_handle(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    raw = (parsed.netloc + parsed.path).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")[:48]
    if not slug:
        raise Reject("that RSS address has no name")
    return slug


def check_url(spec: dict) -> str:
    platform = spec["platform"]
    handle = spec["handle"]
    if platform == "x":
        return "https://api.fxtwitter.com/" + urllib.parse.quote(handle)
    if platform == "threads":
        return "https://www.threads.net/@" + urllib.parse.quote(handle)
    if platform == "instagram":
        return "https://www.instagram.com/" + urllib.parse.quote(handle) + "/"
    if platform == "vk":
        return "https://vk.com/" + urllib.parse.quote(handle)
    if platform == "telegram":
        return "https://t.me/s/" + urllib.parse.quote(handle)
    if platform == "youtube":
        channel = spec.get("channelId") or ""
        if channel:
            return "https://www.youtube.com/feeds/videos.xml?channel_id=" + urllib.parse.quote(channel)
        return "https://www.youtube.com/@" + urllib.parse.quote(handle)
    return spec["url"]


def confirm_source(spec: dict, fetch, resolve=None) -> dict:
    target = check_url(spec)
    host = _host(target)
    if not host_is_public(host, resolve):
        raise Reject("that address is not a public source")
    status, body = fetch(target)
    if status != 200:
        raise Reject("the source did not respond")
    if spec["platform"] == "rss" and not re.search(r"<(rss|feed|rdf)\b", body or "", re.I):
        raise Reject("that URL is not an RSS or Atom feed")
    if spec["platform"] == "youtube" and not spec.get("channelId"):
        found = re.search(r"youtube\.com/channel/(UC[\w-]{22})", body or "")
        if not found:
            raise Reject("YouTube did not confirm that channel")
        spec = dict(spec)
        spec["channelId"] = found.group(1)
        spec["url"] = "https://www.youtube.com/channel/" + spec["channelId"]
    if spec["platform"] == "x" and not (body or "").lstrip().startswith("{"):
        raise Reject("X did not confirm that account")
    if spec["platform"] == "telegram" and spec["handle"].lower() not in (body or "").lower():
        raise Reject("Telegram did not confirm that channel")
    return spec


def entry_for(spec: dict) -> dict:
    platform = spec["platform"]
    handle = spec["handle"]
    feed_id = platform + ":" + handle
    profile = {"name": handle, "url": spec["url"]}
    if platform == "x":
        return {
            "id": feed_id,
            "platform": "x",
            "handle": handle,
            "adapter": "fxtwitter",
            "source_urls": ["{fxtwitterBase}/2/profile/{handle}/statuses"],
            "fallbacks": [{"adapter": "nitter_rss", "source_urls": list(NITTER)}],
            "limit": 6,
            "profile": profile,
        }
    if platform == "threads":
        return {
            "id": feed_id,
            "platform": "threads",
            "handle": handle,
            "adapter": "rsshub_threads",
            "source_urls": ["{rsshubBase}/threads/{handle}"],
            "fallbacks": [{
                "adapter": "generic_rss",
                "source_urls": ["http://localhost:8080/?action=display&bridge=ThreadsBridge&context=Username&u={handle}&format=Atom"],
            }],
            "limit": 8,
            "profile": profile,
        }
    if platform == "instagram":
        return {
            "id": feed_id,
            "platform": "instagram",
            "handle": handle,
            "adapter": "rsshub_instagram",
            "source_urls": ["{rsshubBase}/instagram/user/{handle}"],
            "fallbacks": [{
                "adapter": "generic_rss",
                "source_urls": ["http://localhost:8080/?action=display&bridge=InstagramBridge&context=Username&u={handle}&format=Atom"],
            }],
            "limit": 8,
            "profile": profile,
        }
    if platform == "youtube":
        channel_id = spec.get("channelId") or ""
        human = handle if not re.fullmatch(r"UC[\w-]{22}", handle) else (channel_id or handle)
        row = {
            "id": "youtube:" + human,
            "platform": "youtube",
            "handle": handle,
            "adapter": "youtube_rss",
            "source_urls": ["https://www.youtube.com/feeds/videos.xml?channel_id={channelId}"],
            "limit": 8,
            "profile": {"name": handle, "url": spec["url"]},
        }
        if channel_id:
            row["channelId"] = channel_id
        return row
    if platform == "vk":
        return {
            "id": feed_id,
            "platform": "vk",
            "handle": handle,
            "adapter": "vk",
            "limit": 8,
            "profile": profile,
        }
    if platform == "telegram":
        return {
            "id": feed_id,
            "platform": "telegram",
            "handle": handle,
            "adapter": "telegram",
            "source_urls": ["https://t.me/s/{handle}"],
            "fallbacks": [{"adapter": "telegram", "source_urls": ["{rsshubBase}/telegram/channel/{handle}"]}],
            "limit": 8,
            "profile": profile,
        }
    return {
        "id": feed_id,
        "platform": "rss",
        "handle": handle,
        "adapter": "generic_rss",
        "source_urls": [spec["url"]],
        "limit": 8,
        "profile": profile,
    }


def _same(feed: dict, spec: dict) -> bool:
    if (feed.get("platform") or "") != spec["platform"]:
        return False
    handle = (feed.get("handle") or "").lower()
    wanted = spec["handle"].lower()
    if handle == wanted:
        return True
    if spec.get("channelId") and feed.get("channelId") == spec["channelId"]:
        return True
    url = ((feed.get("profile") or {}).get("url") or "").rstrip("/").lower()
    return bool(url) and url == spec["url"].rstrip("/").lower()


def apply_to_config(config: dict, kind: str, spec: dict) -> str:
    feeds = config.setdefault("feeds", [])
    found = [feed for feed in feeds if _same(feed, spec)]
    if kind == "follow":
        if found:
            raise Reject(found[0].get("id") + " is already followed")
        row = entry_for(spec)
        feeds.append(row)
        return "Added " + row["id"] + "."
    if not found:
        raise Reject(spec["platform"] + ":" + spec["handle"] + " is not in the feeds")
    removed = found[0].get("id") or spec["platform"] + ":" + spec["handle"]
    config["feeds"] = [feed for feed in feeds if feed not in found]
    return "Removed " + removed + "."


class _PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = (urllib.parse.urlparse(newurl).hostname or "").lower()
        if not host_is_public(host):
            raise Reject("that address is not a public source")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_fetch(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    opener = urllib.request.build_opener(_PublicRedirect)
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, response.read(200000).decode("utf-8", "replace")
    except Reject:
        raise
    except urllib.error.HTTPError as exc:
        return exc.code, ""
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0, ""


def run(actor: str, owner: str, title: str, body: str, config: dict, fetch=None, resolve=None) -> tuple[str, dict]:
    if not allowed(actor, owner):
        return "", config
    if (title or "").strip().lower().startswith("subscription groups"):
        raw = _fields(body).get("groups") or (body or "").strip()
        groups = clean_groups(raw, resolve)
        config["groups"] = groups
        return "Saved " + str(len(groups)) + " subscription groups.", config
    if (title or "").strip().lower().startswith("link accounts"):
        from people import apply_link

        return apply_link(config, body, fetch or default_fetch, resolve)
    parsed = parse_issue(title, body)
    spec = normalize(parsed["account"], parsed["platform"])
    if parsed["kind"] == "follow":
        spec = confirm_source(spec, fetch or default_fetch, resolve)
    message = apply_to_config(config, parsed["kind"], spec)
    return message, config


def _comment_and_close(number: str, message: str, repo: str) -> None:
    env = dict(os.environ)
    subprocess.run(["gh", "issue", "comment", number, "--repo", repo, "--body", message], check=True, env=env)
    subprocess.run(["gh", "issue", "close", number, "--repo", repo, "--reason", "completed"], check=True, env=env)


def _dispatch(repo: str) -> None:
    subprocess.run(["gh", "workflow", "run", "sync.yml", "--repo", repo], check=False, env=os.environ)


def main() -> int:
    actor = os.environ.get("ACTOR") or ""
    owner = os.environ.get("OWNER") or ""
    if not allowed(actor, owner):
        print("ignoring issue from", actor or "unknown")
        return 0
    title = os.environ.get("ISSUE_TITLE") or ""
    body = os.environ.get("ISSUE_BODY") or ""
    number = os.environ.get("ISSUE_NUMBER") or ""
    repo = os.environ.get("REPO") or ""
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    try:
        message, updated = run(actor, owner, title, body, config)
    except Reject as exc:
        if number and repo:
            _comment_and_close(number, "Not applied: " + str(exc), repo)
        print("rejected:", exc, file=sys.stderr)
        return 0
    CONFIG.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
    subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True)
    subprocess.run(["git", "add", "feeds.config.json"], check=True)
    commit = subprocess.run(["git", "diff", "--cached", "--quiet"])
    if commit.returncode == 0:
        message = message + " No file change."
    else:
        subject = message.rstrip(".")
        subprocess.run(["git", "commit", "-m", subject], check=True)
        subprocess.run(["git", "push", "origin", "HEAD:main"], check=True)
        _dispatch(repo)
    if number and repo:
        _comment_and_close(number, message + " A sync is queued.", repo)
    print(message)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Reject as exc:
        print("rejected:", exc, file=sys.stderr)
        sys.exit(1)
