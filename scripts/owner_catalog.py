#!/usr/bin/env python3
"""Turn the private owner feed catalog into runtime feed rows.

The catalog lives in R2. Handles are masked before anything is printed.
They are removed from the public sync report.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse

KEY = "owner/feeds-catalog.json"
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,90}$")


def _load_blob() -> dict | None:
    try:
        from tiktok_sync import r2_get
    except Exception:
        return None
    blob = r2_get(KEY)
    if not blob:
        return None
    try:
        data = json.loads(blob.decode("utf-8", "replace"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def mask(doc: dict) -> None:
    try:
        from log_redact import collect, install
    except Exception:
        return
    found: set[str] = set()
    collect(doc, found)
    install(found)


def _row_id(account: dict) -> str:
    ident = str(account.get("id") or "")
    return ident if _ID.fullmatch(ident) and ".." not in ident else ""


def feed_rows(doc: dict | None) -> tuple[list, list]:
    """Runtime rows and the ids that must stay out of the public report."""
    if not isinstance(doc, dict):
        return [], []
    rows = []
    ids = []
    seen = set()
    for account in doc.get("accounts") or []:
        if not isinstance(account, dict) or account.get("paused") is True:
            continue
        ident = _row_id(account)
        platform = str(account.get("platform") or "")
        handle = str(account.get("handle") or "").lstrip("@")
        if not ident or not platform or not handle or ident in seen:
            continue
        if platform == "tiktok":
            ids.append(ident)
            seen.add(ident)
            continue
        row = _feed(account, ident, platform, handle)
        if not row:
            continue
        rows.append(row)
        ids.append(ident)
        seen.add(ident)
    return rows, ids


def _feed(account: dict, ident: str, platform: str, handle: str) -> dict | None:
    profile = {
        "name": account.get("label") or account.get("name") or handle,
        "url": account.get("url") or "",
        "avatar": account.get("avatar") or "",
    }
    base = {
        "id": ident,
        "platform": platform,
        "handle": handle,
        "limit": 8,
        "profile": profile,
        "_privateAdded": True,
        "_catalogPrivate": True,
    }
    if platform == "x":
        base.update({
            "adapter": "fxtwitter",
            "source_urls": ["{fxtwitterBase}/2/profile/{handle}/statuses"],
        })
        if account.get("permanentId"):
            base["permanentId"] = str(account["permanentId"])
        return base
    if platform == "threads":
        from meta_sources import feed_urls

        base.update({
            "adapter": "rsshub_threads",
            "source_urls": feed_urls("threads"),
        })
        return base
    if platform == "instagram":
        from meta_sources import feed_urls

        base.update({
            "adapter": "rsshub_instagram",
            "source_urls": feed_urls("instagram"),
        })
        return base
    if platform == "youtube":
        channel = str(account.get("channelId") or "")
        base.update({
            "adapter": "youtube_rss",
            "source_urls": ["https://www.youtube.com/feeds/videos.xml?channel_id={channelId}"],
        })
        if re.fullmatch(r"UC[\w-]{22}", channel):
            base["channelId"] = channel
        return base
    if platform == "vk":
        base["adapter"] = "vk"
        return base
    if platform == "telegram":
        base.update({
            "adapter": "telegram",
            "source_urls": ["https://t.me/s/{handle}"],
            "fallbacks": [{"adapter": "generic_rss", "source_urls": ["https://rsshub.app/telegram/channel/{handle}"]}],
        })
        return base
    if platform == "reddit":
        kind = "r" if str(account.get("redditKind") or "") == "r" or ident.startswith("reddit:r:") else "user"
        path = "/r/{handle}" if kind == "r" else "/user/{handle}"
        base.update({
            "adapter": "generic_rss",
            "source_urls": ["https://www.reddit.com" + path + "/.rss"],
            "fallbacks": [
                {"adapter": "generic_rss", "source_urls": ["https://safereddit.com" + path + "/rss"]},
                {"adapter": "generic_rss", "source_urls": ["https://redlib.fmhy.net" + path + "/rss"]},
            ],
        })
        return base
    if platform == "bluesky":
        base.update({
            "adapter": "generic_rss",
            "source_urls": ["https://rsshub.app/bsky/profile/{handle}"],
        })
        return base
    if platform == "mastodon":
        # Any fediverse profile, followed by its public feed. Nothing is posted back.
        url = str(account.get("url") or "")
        if not url.startswith("https://"):
            return None
        host = str(account.get("host") or urllib.parse.urlsplit(url).hostname or "").lower()
        user = str(account.get("handle") or "")
        if not host or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}", user):
            return None
        quoted = urllib.parse.quote(user)
        feeds = [
            f"https://{host}/@{quoted}.rss",
            f"https://{host}/users/{quoted}.atom",
            f"https://{host}/users/{quoted}/feed.atom",
            f"https://{host}/feeds/videos.xml?accountName={quoted}",
        ]
        base.update({
            "adapter": "generic_rss",
            "source_urls": feeds[:1],
            "fallbacks": [{"adapter": "generic_rss", "source_urls": [feed]} for feed in feeds[1:]],
        })
        return base
    if platform == "rss":
        url = str(account.get("url") or "")
        if not url.startswith("https://"):
            return None
        base.update({"adapter": "generic_rss", "source_urls": [url]})
        return base
    return None


def _plain(detail: str, ok: bool) -> tuple[str, str]:
    if ok:
        return "ok", ""
    low = (detail or "").lower()
    if "429" in low or "rate" in low or "slow down" in low:
        return "failing", "The source asked us to slow down. We’ll try again later."
    if "404" in low or "not found" in low:
        return "failing", "That account wasn’t found."
    return "failing", "The source didn’t answer."


def drop_private_health(doc: dict, ids: list) -> dict:
    """Remove private feed ids from a report. The returned rows stay off GitHub."""
    health = doc.get("sourceHealth")
    if not isinstance(health, dict):
        health = {}
        doc["sourceHealth"] = health
    private = {}
    for ident in ids or []:
        row = health.pop(ident, None)
        if isinstance(row, dict):
            private[ident] = row
    return private


def sink_private_health(doc: dict, ids: list) -> None:
    """Move private source health off the public report and back onto the catalog."""
    private = drop_private_health(doc, ids)
    if not private:
        return
    catalog = _load_blob()
    if not catalog:
        return
    changed = False
    for account in catalog.get("accounts") or []:
        if not isinstance(account, dict):
            continue
        ident = _row_id(account)
        row = private.get(ident)
        if not row:
            continue
        ok = bool(row.get("ok")) and not row.get("emptySince")
        status, text = _plain(str(row.get("detail") or ""), ok)
        previous = account.get("health") if isinstance(account.get("health"), dict) else {}
        account["health"] = {
            "status": status,
            "code": "" if ok else ("rate" if "slow down" in text else "down"),
            "text": text,
            "lastOk": row.get("ok") or previous.get("lastOk") or "",
            "updatedAt": row.get("checked") or row.get("ok") or previous.get("updatedAt") or "",
        }
        changed = True
    if not changed:
        return
    try:
        from tiktok_sync import r2_put
    except Exception:
        return
    payload = json.dumps(catalog, ensure_ascii=False).encode("utf-8")
    r2_put(KEY, payload)


def load_masked() -> tuple[dict | None, list, list]:
    doc = _load_blob()
    if not doc:
        return None, [], []
    mask(doc)
    rows, ids = feed_rows(doc)
    return doc, rows, ids


def _selftest() -> None:
    doc = {
        "accounts": [
            {"id": "x:northwind", "platform": "x", "handle": "northwind", "name": "North"},
            {"id": "instagram:orbitfox", "platform": "instagram", "handle": "orbitfox", "name": "Orbit"},
            {"id": "threads:orbitfox", "platform": "threads", "handle": "orbitfox", "name": "Orbit"},
            {"id": "tiktok:laneharbor", "platform": "tiktok", "handle": "laneharbor"},
            {"id": "rss:samplefeed", "platform": "rss", "handle": "samplefeed", "url": "https://feeds.example/sample.xml"},
            {"id": "x:slowwind", "platform": "x", "handle": "slowwind", "paused": True},
            {"id": "mastodon:bad", "platform": "mastodon", "handle": "bad", "url": "http://social.example/@bad"},
            {"id": "mastodon:pinewren@pix.example", "platform": "mastodon", "handle": "pinewren", "host": "pix.example", "url": "https://pix.example/users/pinewren"},
        ]
    }
    rows, ids = feed_rows(doc)
    assert any(row["id"] == "x:northwind" and row["adapter"] == "fxtwitter" and row["_catalogPrivate"] for row in rows)
    ig = next(row for row in rows if row["id"] == "instagram:orbitfox")
    th = next(row for row in rows if row["id"] == "threads:orbitfox")
    assert ig["adapter"] == "rsshub_instagram" and ig["source_urls"][0].startswith("{rsshubBase}/instagram/user/")
    assert any("rss-bridge.org" in url and "InstagramBridge" in url for url in ig["source_urls"])
    assert any("localhost:8080" in url for url in ig["source_urls"])
    assert th["adapter"] == "rsshub_threads" and any("ThreadsBridge" in url for url in th["source_urls"])
    assert "generic_rss" not in str(ig.get("fallbacks") or "")
    assert "tiktok:laneharbor" in ids and all(row["platform"] != "tiktok" for row in rows)
    assert "x:slowwind" not in ids
    assert any(row["id"] == "rss:samplefeed" and row["source_urls"] == ["https://feeds.example/sample.xml"] for row in rows)
    assert all(row["id"] != "mastodon:bad" for row in rows)
    fedi = next(row for row in rows if row["id"] == "mastodon:pinewren@pix.example")
    assert fedi["source_urls"] == ["https://pix.example/@pinewren.rss"]
    assert [f["source_urls"][0] for f in fedi["fallbacks"]][:1] == ["https://pix.example/users/pinewren.atom"]
    report = {"sourceHealth": {"x:northwind": {"ok": False, "detail": "429 slow down"}, "rss:public": {"ok": True, "detail": ""}}}
    private = drop_private_health(report, ["x:northwind"])
    assert "x:northwind" not in report["sourceHealth"]
    assert private["x:northwind"]["detail"]
    assert "rss:public" in report["sourceHealth"]
    print("owner catalog ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
