#!/usr/bin/env python3
"""Every X source keeps a reply's context, and merges keep the copy that has it.

Fake handles and ids only. Covers the fxtwitter v2 object, the v1 string
plus parent id, a conversation id with no target, Nitter RSS "R to @",
RSSHub, the X API v2 shape without the user expansion, and the merges:
dedupe, a fresh copy over a stored one, and the replies page over the
timeline page.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import fxtwitter, nitter_rss, rsshub_x, x_api_v2  # noqa: E402
from adapters.common import carry_reply_info, dedupe_posts, reply_info  # noqa: E402
from normalize import repair_post  # noqa: E402

FEED = {"id": "x:fake_ruby", "platform": "x", "handle": "fake_ruby"}
FAILS = []


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        FAILS.append(what)


def status(sid: str, text: str, **extra) -> dict:
    row = {"id": sid, "text": text, "created_at": "Fri Oct 30 10:00:00 +0000 2026",
           "author": {"screen_name": "fake_ruby", "name": "Fake Ruby"}, "url": f"https://x.com/fake_ruby/status/{sid}"}
    row.update(extra)
    return row


def one(payload, adapter=fxtwitter):
    posts = adapter.parse(payload, dict(FEED)).get("posts") or []
    return posts[0] if posts else {}


# fxtwitter v2: replying_to is an object with screen_name and status.
post = one({"results": [status("700", "Sí, seguro (fake)", replying_to={"screen_name": "fake_minister", "status": "699"})]})
check(post.get("kind") == "reply" and post["replyingTo"].get("handle") == "fake_minister" and post["replyingTo"].get("id") == "699",
      "fxtwitter v2 object keeps the target handle and parent id")

# fxtwitter v1: replying_to is a string, the parent id rides beside it.
post = one({"results": [status("701", "Reply (fake)", replying_to="fake_mayor", replying_to_status="698")]})
check(post.get("kind") == "reply" and post["replyingTo"].get("handle") == "fake_mayor" and post["replyingTo"].get("id") == "698",
      "fxtwitter v1 string plus replying_to_status keeps handle and parent id")

# Only a conversation id says it is a reply.
post = one({"results": [status("702", "Este es el tipo (fake)", conversation_id="650")]})
check(post.get("kind") == "reply" and post.get("conversationId") == "650",
      "a post in another conversation is marked a reply for the live lookup")
post = one({"results": [status("703", "Own root (fake)", conversation_id="703")]})
check(post.get("kind") == "post" and not reply_info(post), "a conversation root stays a plain post")

RSS = """<?xml version="1.0"?><rss version="2.0"><channel><title>Fake Ruby / @fake_ruby</title>
<item><title>R to @fake_judge: Reply over rss (fake)</title><link>https://nitter.example/fake_ruby/status/704#m</link>
<description>&lt;p&gt;Reply over rss (fake)&lt;/p&gt;</description><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Plain over rss (fake)</title><link>https://nitter.example/fake_ruby/status/705#m</link>
<description>&lt;p&gt;Plain over rss (fake)&lt;/p&gt;</description><pubDate>Fri, 30 Oct 2026 09:00:00 GMT</pubDate></item>
</channel></rss>"""
rows = nitter_rss.parse(RSS, dict(FEED)).get("posts") or []
check(bool(rows) and rows[0].get("kind") == "reply" and rows[0]["replyingTo"].get("handle") == "fake_judge",
      "Nitter RSS \"R to @\" keeps the target handle")
check(len(rows) > 1 and rows[1].get("kind") == "post", "Nitter RSS plain item stays a post")
rows = rsshub_x.parse(RSS.replace("nitter.example", "x.com"), dict(FEED)).get("posts") or []
check(bool(rows) and rows[0].get("kind") == "reply" and rows[0]["replyingTo"].get("handle") == "fake_judge",
      "RSSHub lane keeps the target handle")

API = {"data": [{"id": "706", "text": "No leading mention (fake)", "author_id": "1", "created_at": "2026-10-30T10:00:00Z",
                 "in_reply_to_user_id": "2", "referenced_tweets": [{"type": "replied_to", "id": "640"}]}],
       "includes": {"users": [{"id": "1", "username": "fake_ruby", "name": "Fake Ruby"}]}}
post = one(API, x_api_v2)
check(post.get("kind") == "reply" and (post.get("replyingTo") or {}).get("id") == "640",
      "X API v2 without the user expansion keeps the parent id")

# Merges keep the copy that knows it is a reply.
bare = {"id": "707", "statusId": "707", "platform": "x", "kind": "post", "replyingTo": None, "date": "2026-10-30T10:00:00Z", "text": "fake"}
known = dict(bare, kind="reply", replyingTo={"handle": "fake_minister", "id": "600"}, date="2026-10-30T10:00:01Z")
merged = dedupe_posts([dict(bare), dict(known)])
check(len(merged) == 1 and merged[0].get("kind") == "reply" and merged[0]["replyingTo"].get("id") == "600",
      "dedupe keeps the reply info whichever copy wins")
fresh = dict(bare)
carry_reply_info(fresh, dict(known))
check(fresh.get("kind") == "reply" and fresh["replyingTo"].get("handle") == "fake_minister",
      "a fresh copy without reply info keeps what the stored copy had")
partial = dict(bare, kind="reply", replyingTo={"handle": "", "id": "600"})
carry_reply_info(partial, {"kind": "reply", "replyingTo": {"handle": "fake_minister", "name": "Fake Minister"}})
check(partial["replyingTo"].get("handle") == "fake_minister" and partial["replyingTo"].get("id") == "600",
      "partial copies combine handle and parent id")
repost = {"id": "repost:fake_ruby:708", "statusId": "708", "platform": "x", "kind": "repost", "replyingTo": None}
check(not carry_reply_info(repost, dict(known)) and repost["kind"] == "repost", "a repost wrapper is left alone")
quote = dict(bare, kind="quote")
carry_reply_info(quote, dict(known))
check(quote.get("kind") == "quote" and reply_info(quote), "a quote keeps its kind and gains the reply line")

# Normalize keeps the reply target and the conversation id.
fixed, _why = repair_post(dict(known, handle="fake_ruby", author="Fake Ruby", url="https://x.com/fake_ruby/status/707", conversationId="600", media=[], links=[]), None)
check(bool(fixed) and (fixed.get("replyingTo") or {}).get("id") == "600" and fixed.get("conversationId") == "600",
      "normalize keeps the reply target and conversation id")

# The update_feeds merge steps call carry_reply_info.
src = (Path(__file__).resolve().parent / "update_feeds.py").read_text(encoding="utf-8")
check(src.count("carry_reply_info(") >= 2, "update_feeds carries reply info on the replies page and over the stored copy")

print(json.dumps({"failures": len(FAILS)}))
sys.exit(1 if FAILS else 0)
