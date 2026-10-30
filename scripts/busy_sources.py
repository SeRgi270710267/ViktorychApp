#!/usr/bin/env python3
"""Busy sources in the shared catalog.

Some sources post hundreds of times a day, mostly replies to other people.
The shared feeds.json holds a fixed number of posts (config "cap"), so one
such source used to fill a fifth of it with replies nobody sees on Home (the
app hides them there, as X does). Two cheap steps, no extra requests:

- trim(): a busy source keeps only its newest REPLY_KEEP replies to other
  people in feeds.json, and no source keeps more than FEED_SHARE of the cap.
  The archive still gets every post, and profiles still read the full stream.
- replies_due(): a busy source's replies page is read at most once every
  REPLY_EVERY seconds instead of every run; between reads its last replies
  are carried over.

The pace uses the same rule as busy.js on the device.
"""
from __future__ import annotations

from datetime import datetime, timezone

SPAN = 48 * 3600
MIN_SPAN = 12 * 3600
MIN_POSTS = 8
PER_DAY = 30
REPLY_PER_DAY = 12
REPLY_SHARE = 0.5
REPLY_KEEP = 6
FEED_SHARE = 0.15
REPLY_EVERY = 3600


def _ts(post: dict) -> float:
    text = str((post or {}).get("sortDate") or (post or {}).get("date") or "")
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _norm(value) -> str:
    return str(value or "").lstrip("@").strip().lower()


def reply_to_other(post: dict) -> bool:
    if (post or {}).get("kind") != "reply":
        return False
    to = post.get("replyingTo") or {}
    return not (_norm(to.get("handle")) and _norm(to.get("handle")) == _norm(post.get("handle")))


def pace(posts) -> dict:
    """feedId -> {"n", "perDay", "replyShare", "busy"} over the newest 48 hours."""
    rows = [p for p in posts or [] if isinstance(p, dict) and p.get("feedId")]
    ref = max((_ts(p) for p in rows), default=0.0)
    acc: dict = {}
    seen = set()
    for post in rows:
        t = _ts(post)
        if not t or t < ref - SPAN:
            continue
        key = str(post.get("feedId"))
        ident = (key, str(post.get("statusId") or post.get("id") or ""))
        if ident in seen:
            continue
        seen.add(ident)
        row = acc.setdefault(key, {"n": 0, "replies": 0, "oldest": t})
        row["n"] += 1
        if reply_to_other(post):
            row["replies"] += 1
        row["oldest"] = min(row["oldest"], t)
    out = {}
    for key, row in acc.items():
        days = max(ref - row["oldest"], MIN_SPAN) / 86400
        per_day = row["n"] / days
        share = row["replies"] / row["n"] if row["n"] else 0.0
        busy = row["n"] >= MIN_POSTS and (per_day >= PER_DAY or (per_day >= REPLY_PER_DAY and share >= REPLY_SHARE))
        out[key] = {"n": row["n"], "perDay": round(per_day, 1), "replyShare": round(share, 2), "busy": busy}
    return out


def trim(posts, cap: int = 300, rates: dict | None = None):
    """Return (kept posts, dropped count). Order is kept."""
    rows = list(posts or [])
    rates = rates if rates is not None else pace(rows)
    share_cap = max(20, int(cap * FEED_SHARE))
    ranked = sorted(range(len(rows)), key=lambda i: -_ts(rows[i]) if isinstance(rows[i], dict) else 0)
    replies: dict = {}
    total: dict = {}
    drop = set()
    for i in ranked:
        post = rows[i]
        if not isinstance(post, dict) or not post.get("feedId"):
            continue
        key = str(post.get("feedId"))
        if (rates.get(key) or {}).get("busy") and reply_to_other(post):
            replies[key] = replies.get(key, 0) + 1
            if replies[key] > REPLY_KEEP:
                drop.add(i)
                continue
        total[key] = total.get(key, 0) + 1
        if total[key] > share_cap:
            drop.add(i)
    return [p for i, p in enumerate(rows) if i not in drop], len(drop)


def replies_due(health_row: dict | None, busy: bool, now: float) -> bool:
    """Read the replies page this run? Quiet sources: always. Busy: hourly."""
    if not busy:
        return True
    last = str((health_row or {}).get("repliesAt") or "")
    if not last:
        # No memory (private source health is kept elsewhere): read on the
        # first run of each hour only.
        return datetime.fromtimestamp(now, timezone.utc).minute < 15
    try:
        at = datetime.fromisoformat(last.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return True
    return now - at >= REPLY_EVERY - 120


STICKY = 24 * 3600


def _iso_ts(text) -> float:
    try:
        return datetime.fromisoformat(str(text or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def still_busy(health_row: dict | None, now: float) -> bool:
    """A source stays busy for a day after it was last seen busy, so the
    trimmed feeds.json does not make it look quiet on the next run."""
    return _iso_ts((health_row or {}).get("busyUntil")) > now


def settle(collected, health: dict, stamp: str, cap: int = 300):
    """Mark busy sources in source health and trim the shared list."""
    now = _iso_ts(stamp) or datetime.now(timezone.utc).timestamp()
    rates = pace(collected)
    until = datetime.fromtimestamp(now + STICKY, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for key, row in rates.items():
        target = health.get(key)
        if not isinstance(target, dict):
            continue
        if row["busy"]:
            target["busyUntil"] = until
        elif not still_busy(target, now):
            target.pop("busyUntil", None)
    for key, target in health.items():
        if isinstance(target, dict) and still_busy(target, now) and key in rates:
            rates[key]["busy"] = True
    return trim(collected, cap, rates)


def _selftest() -> None:
    base = datetime(2026, 10, 29, 12, tzinfo=timezone.utc).timestamp()

    def iso(t):
        return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    posts = []
    for i in range(60):
        posts.append({"id": f"b{i}", "feedId": "busy", "handle": "loud", "kind": "reply", "replyingTo": {"handle": f"u{i}"}, "date": iso(base - i * 1500)})
    for i in range(3):
        posts.append({"id": f"s{i}", "feedId": "busy", "handle": "loud", "kind": "reply", "replyingTo": {"handle": "loud"}, "date": iso(base - i * 900)})
    for i in range(10):
        posts.append({"id": f"q{i}", "feedId": "quiet", "handle": "calm", "kind": "post", "date": iso(base - i * 7200)})
    rates = pace(posts)
    assert rates["busy"]["busy"] and not rates["quiet"]["busy"], rates
    kept, dropped = trim(posts, 300, rates)
    assert dropped == 60 - REPLY_KEEP, dropped
    assert sum(1 for p in kept if p["feedId"] == "busy" and p["replyingTo"]["handle"] == "loud") == 3, "threads stay"
    assert sum(1 for p in kept if p["feedId"] == "quiet") == 10
    many = [{"id": f"m{i}", "feedId": "many", "kind": "post", "date": iso(base - i * 60)} for i in range(100)]
    kept, dropped = trim(many, 300)
    assert len(kept) == 45 and kept[0]["id"] == "m0", (len(kept), kept[0])
    assert replies_due({}, False, base)
    assert replies_due({"repliesAt": iso(base - 4000)}, True, base)
    assert not replies_due({"repliesAt": iso(base - 900)}, True, base)
    health = {"busy": {"ok": iso(base)}, "quiet": {"ok": iso(base)}}
    kept, dropped = settle(posts, health, iso(base))
    assert dropped == 60 - REPLY_KEEP and "busyUntil" in health["busy"] and "busyUntil" not in health["quiet"]
    assert still_busy(health["busy"], base + 3600) and not still_busy(health["busy"], base + STICKY + 60)
    again, dropped = settle(kept + posts[:REPLY_KEEP], health, iso(base + 900))
    assert "busyUntil" in health["busy"]
    print("busy sources ok")


if __name__ == "__main__":
    _selftest()
