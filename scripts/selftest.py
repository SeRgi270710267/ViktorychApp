#!/usr/bin/env python3
"""Quick checks for every adapter. Exits non-zero on failure."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.common import parse_json_loose  # noqa: E402
from adapters.fxtwitter import parse as parse_fx  # noqa: E402
from adapters.generic_rss import parse as parse_generic  # noqa: E402
from adapters.nitter_rss import parse as parse_nitter  # noqa: E402
from adapters.rsshub_instagram import parse as parse_ig  # noqa: E402
from adapters.rsshub_threads import parse as parse_threads  # noqa: E402
from adapters.ig_comments import parse_ig_comments, parse_ig_document  # noqa: E402
from adapters.rss_comments import parse_comment_rss  # noqa: E402
from adapters.threads_replies import parse_threads_document, parse_threads_replies  # noqa: E402
from adapters.x_api_v2 import parse as parse_x  # noqa: E402
from adapters.x_api_v2 import parse_conversation_search  # noqa: E402
from adapters.youtube_rss import parse as parse_youtube  # noqa: E402
from yt_remote import carry_youtube_fields, normalize_invidious_comment  # noqa: E402
from adapters.x_replies import (  # noqa: E402
    _cap,
    belongs,
    comments_due,
    comments_kept,
    conversation_reply_count,
    engagement,
    fill_missing,
    merge_replies,
    parse_fxtwitter_conversation,
    parse_nitter_replies,
    parse_nitter_status,
    select_subthreads,
)
from meta_media import cdn_expiry, extract_cdn_urls, media_groups, needs_refresh  # noqa: E402
from x_guard import assert_not_x_api, auth_cookie_header, conversation_search  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "scripts" / "fixtures"


def check(cond, message):
    if not cond:
        raise SystemExit("FAIL: " + message)
    print("ok", message)


def main() -> None:
    elon = parse_x((FIX / "x_api_v2_elon.json").read_text(encoding="utf-8"), {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle"})
    posts = elon["posts"]
    check(len(posts) == 10, "elon parsed 10 tweets")
    check(any(p["kind"] == "repost" for p in posts), "elon has a repost")
    check(any(p["kind"] == "quote" for p in posts), "elon has a quote")
    repost = next(p for p in posts if p["kind"] == "repost")
    check(repost["repostedBy"]["handle"] == "redacted_handle", "repost credits elon")
    check(not repost["text"].startswith("RT @"), "repost text has no RT prefix")
    check("Sawyer" in repost["author"] or repost["handle"] == "redacted_handle", "repost shows original author")
    quote = next(p for p in posts if p["id"] == "2112603906723487744")
    check(quote["kind"] == "quote" and quote["quoted"], "electricity post is a quote")
    check("t.co" not in quote["text"], "quote t.co stripped from elon text")
    check("oversimplification" in quote["text"], "quote keeps elon's words")
    long_quote = quote["quoted"]
    check(len(long_quote["text"]) > 280, "quoted note_tweet is the long text")
    check(any(p["handle"] == "redacted_handle" and p["verifiedType"] == "blue" for p in posts), "elon verified blue")
    check(posts[0]["stats"].get("views", 0) > 1000, "stats mapped")

    redacted_handle = parse_x((FIX / "x_api_v2_finkd.json").read_text(encoding="utf-8"), {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle"})
    photo = next(p for p in redacted_handle["posts"] if p["id"] == "2110778025629347999")
    check(photo["media"] and photo["media"][0]["type"] == "photo", "redacted_handle photo media")
    check("t.co" not in photo["text"], "redacted_handle media t.co stripped")
    check(any(p["kind"] == "reply" and (p.get("replyingTo") or {}).get("handle") for p in redacted_handle["posts"]), "redacted_handle reply target")
    self_reply = next(p for p in redacted_handle["posts"] if p["id"] == "2109689311088287773")
    check((self_reply.get("replyingTo") or {}).get("handle") == "redacted_handle", "redacted_handle self reply handle")
    check((self_reply.get("replyingTo") or {}).get("id") == "2109689309825794187", "redacted_handle self reply parent id")

    fx = parse_fx((FIX / "fxtwitter_sample.json").read_text(encoding="utf-8"), {"id": "x:testuser", "platform": "x", "handle": "testuser"})
    check(fx["posts"][0]["kind"] == "quote", "fxtwitter quote")
    check(fx["posts"][0]["quoted"]["media"][0]["url"].endswith("high.mp4"), "fxtwitter picks highest mp4")
    check(fx["posts"][0]["stats"]["views"] == 6100000, "fxtwitter stats")
    check(fx["posts"][1]["kind"] == "repost" and fx["posts"][1]["handle"] == "orig", "fxtwitter repost author")
    check(fx["posts"][1]["verifiedType"] == "government", "government badge type")
    check(fx["posts"][2]["kind"] == "reply", "fxtwitter reply")
    check(any(p["followers"] == 10 for p in fx["profiles"]), "fxtwitter profile")

    nit = parse_nitter((FIX / "nitter_sample.xml").read_text(encoding="utf-8"), {"id": "x:redacted_handle", "platform": "x", "handle": "redacted_handle"})
    check(nit["posts"][0]["kind"] == "repost", "nitter RT by is a repost")
    check(nit["posts"][0]["media"], "nitter image extracted")
    check(nit["posts"][1]["kind"] == "quote" and nit["posts"][1]["quoted"]["handle"] == "someone", "nitter blockquote quote")
    check(nit["profiles"][0]["avatar"].endswith("elon.jpg"), "nitter channel image")

    th = parse_threads((FIX / "rsshub_threads_zuck.xml").read_text(encoding="utf-8"), {"id": "threads:redacted_handle", "platform": "threads", "handle": "redacted_handle"})
    check(len(th["posts"]) == 10, "threads item count")
    check(all(not p["text"].startswith("@redacted_handle") for p in th["posts"]), "threads title prefix stripped")
    check(any(m["type"] == "video" and m.get("poster") for p in th["posts"] for m in p["media"]), "threads video poster")
    check(any(p["kind"] == "reply" for p in th["posts"]), "threads reply marker")
    check("<" not in th["posts"][0]["text"], "threads html stripped")

    ig = parse_ig((FIX / "rsshub_instagram_zuck.xml").read_text(encoding="utf-8"), {"id": "instagram:redacted_handle", "platform": "instagram", "handle": "redacted_handle"})
    check(len(ig["posts"]) == 33, "instagram item count")
    check(ig["posts"][0]["media"] and ig["posts"][0]["media"][0]["width"] == 3072, "instagram image size")
    check("<img" not in ig["posts"][0]["text"] and "thoughtful" in ig["posts"][0]["text"], "instagram caption text")
    check(ig["profiles"][0]["bio"] == "I build stuff", "instagram bio without RSSHub suffix")

    gen = parse_generic((FIX / "generic_sample.xml").read_text(encoding="utf-8"), {"id": "rss:example", "platform": "rss", "handle": "example"})
    post = gen["posts"][0]
    check("Hello & welcome" in post["text"], "generic title unescaped")
    check("link" in post["text"] and "<" not in post["text"], "generic html stripped")
    check(any(l["expanded"] == "https://example.com/post" for l in post["links"]), "generic anchor kept")
    check(any(m["url"].endswith("i.jpg") for m in post["media"]), "generic img")
    check(any(m["url"].endswith("clip.mp4") for m in post["media"]), "generic enclosure")
    check(post["kind"] == "quote", "generic blockquote")
    check(post.get("commentRss") == "https://example.com/comments.xml", "generic commentRss")
    check((post.get("stats") or {}).get("replies") == 2, "generic slash comments")

    conv_raw = (FIX / "replies" / "2112600761762717997.json").read_text(encoding="utf-8")
    conv = parse_fxtwitter_conversation(conv_raw, "2112600761762717997")
    clean = [c for c in conv if not c.get("spam")]
    scores = [engagement(c) for c in clean]
    check(len(conv) >= 10, "conversation has replies")
    check(conversation_reply_count(conv_raw) == 3283 and len(conv) != 3283, "source reply count stays separate from the cap")
    check(scores == sorted(scores, reverse=True), "relevant order is engagement")
    check(conv[0]["handle"] == "yesknow", "highest engagement leads")
    check(conv[0]["kind"] == "reply" and conv[0]["replyingTo"]["handle"] == "redacted_handle", "conversation reply target")
    check(conv[0]["replyingTo"]["id"] == "2112600761762717997", "conversation reply parent id")
    check(conv[0]["date"].startswith("2026-10-20T"), "conversation date is ISO")
    check(conv[0]["verifiedType"] == "blue", "individual verification maps to blue")
    check(conv[0].get("authorFollowers") == 14170, "reply keeps follower count for spam checks")
    check(all(c["id"] != "2112600761762717997" for c in conv), "conversation skips the parent")
    capped = _cap([{"stats": {"likes": i}} for i in range(60)])
    check(len(capped) == 50 and capped[0]["stats"]["likes"] == 59, "reply cap keeps the top 50 by engagement")

    parent = "PARENT"
    sample = {
        "code": 200,
        "status": {"replies": 9, "author": {"screen_name": "redacted_handle"}},
        "replies": [
            {"id": "8", "text": "first", "author": {"screen_name": "redacted_handle", "followers": 100}, "replying_to": {"screen_name": "redacted_handle", "status": parent}, "likes": 1, "created_at": "Tue Oct 20 02:00:00 +0000 2026"},
            {"id": "9", "text": "second", "author": {"screen_name": "redacted_handle", "followers": 100}, "replying_to": {"screen_name": "redacted_handle", "status": "8"}, "conversation_id": parent, "likes": 1, "created_at": "Tue Oct 20 03:00:00 +0000 2026"},
            {"id": "1", "text": "plain reply", "author": {"screen_name": "ada", "followers": 40, "joined": "Tue Jun 02 20:12:29 +0000 2009", "verification": {"type": "individual"}}, "replying_to": {"screen_name": "redacted_handle", "status": parent}, "likes": 5, "replies": 0, "reposts": 0, "created_at": "Tue Oct 20 00:00:00 +0000 2026"},
            {"id": "1", "text": "duplicate id loses", "author": {"screen_name": "ada"}, "replying_to": {"status": parent}, "likes": 1, "created_at": "Tue Oct 20 00:00:00 +0000 2026"},
            {"id": "2", "text": "wrong thread", "author": {"screen_name": "bea"}, "replying_to": {"screen_name": "other", "status": "999"}, "likes": 100, "created_at": "Tue Oct 20 00:00:00 +0000 2026"},
            {"id": "3", "text": "This post is unavailable.", "author": {}, "replying_to": {"status": parent}},
            {"id": "4", "text": "Send a crypto giveaway airdrop now", "author": {"screen_name": "spammer", "followers": 1000, "joined": "Tue Jun 02 20:12:29 +0000 2009"}, "replying_to": {"status": parent}, "likes": 80, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
            {"id": "5", "text": "https://evil.example/free", "author": {"screen_name": "linky", "followers": 100}, "replying_to": {"status": parent}, "likes": 2, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
            {"id": "10", "text": "plain reply from another account here", "author": {"screen_name": "copy", "followers": 100}, "replying_to": {"status": parent}, "likes": 1, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
            {"id": "11", "text": "plain reply from another account here", "author": {"screen_name": "copy2", "followers": 100}, "replying_to": {"status": parent}, "likes": 4, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
            {"id": "12", "text": "hi", "author": {"screen_name": "BotUser12345", "followers": 500, "joined": "Tue Jun 02 20:12:29 +0000 2009"}, "replying_to": {"status": parent}, "likes": 3, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
            {"id": "13", "text": "airdrop now please", "author": {"screen_name": "redacted_handle", "followers": 100}, "replying_to": {"status": parent}, "likes": 1, "created_at": "Tue Oct 20 04:00:00 +0000 2026"},
            {"id": "6", "text": "", "author": {"screen_name": "gap"}, "replying_to": {"status": parent}},
            {"id": "7", "text": "maybe", "author": {"screen_name": "neo", "followers": 3, "joined": "Mon Oct 19 00:00:00 +0000 2026"}, "created_at": "Tue Oct 20 00:00:00 +0000 2026", "likes": 4},
            {"id": "14", "text": "low likes lots of replies", "author": {"screen_name": "talk", "followers": 100}, "replying_to": {"status": parent}, "likes": 10, "replies": 20, "reposts": 0, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
            {"id": "15", "text": "more likes fewer replies", "author": {"screen_name": "quiet", "followers": 100}, "replying_to": {"status": parent}, "likes": 30, "replies": 0, "reposts": 0, "created_at": "Tue Oct 20 01:00:00 +0000 2026"},
        ],
    }
    ranked = parse_fxtwitter_conversation(sample, parent)
    ids = [row["id"] for row in ranked]
    check(ids[:3] == ["8", "9", "13"], "self-thread stays first and is not spam")
    check("2" not in ids and "3" not in ids and "7" not in ids, "mismatch, deleted, and unconfirmed replies drop")
    check(ids.count("1") == 1 and next(row["text"] for row in ranked if row["id"] == "1") == "plain reply", "duplicate ids keep the first copy")
    spam_ids = {row["id"] for row in ranked if row.get("spam")}
    check(spam_ids >= {"4", "5", "10", "12"}, "giveaway, link-only, duplicate, and bot replies are spam")
    check("11" not in spam_ids, "the highest duplicate stays in the relevant list")
    talk_at = ids.index("14")
    quiet_at = ids.index("15")
    check(talk_at < quiet_at, "replies outweigh a higher like count")
    filled = fill_missing(
        [row for row in sample["replies"] if row["id"] in {"6", "7"}],
        parent,
        lambda reply: {
            "id": reply["id"],
            "text": "filled from status" if reply["id"] == "6" else "maybe",
            "author": {"screen_name": reply["author"]["screen_name"], "followers": 3 if reply["id"] == "7" else 50, "joined": "Mon Oct 19 00:00:00 +0000 2026" if reply["id"] == "7" else "Tue Jun 02 20:12:29 +0000 2009"},
            "replying_to": {"screen_name": "redacted_handle", "status": parent},
            "created_at": "Tue Oct 20 00:00:00 +0000 2026",
            "likes": 3,
        },
    )
    by_id = {row["id"]: row for row in filled}
    check(by_id["6"]["text"] == "filled from status" and by_id["6"]["replyingTo"]["id"] == parent, "fxtwitter status fills a missing reply")
    check(by_id["7"].get("authorFollowers") == 3, "status lookup keeps a reply once the conversation matches")
    nitter_html = """
    <div class="timeline-item">
      <a href="/gap/status/6"></a>
      <a class="fullname" href="/gap">Gap</a>
      <div class="replying-to">Replying to <a href="/redacted_handle/status/PARENT">@redacted_handle</a></div>
      <div class="tweet-content media-body">filled from nitter</div>
      <span class="tweet-date"><a title="Tue, 20 Oct 2026 18:00:00 +0000"></a></span>
      <div class="icon-heart"></div> 3
    </div>
    """
    nitter_status = parse_nitter_status(nitter_html, "6")
    check(nitter_status["text"] == "filled from nitter" and nitter_status["replyingTo"]["id"] == parent, "nitter status page fills the reply target")
    nitter_filled = fill_missing([{"id": "6", "text": "", "handle": "gap", "kind": "reply", "platform": "x"}], parent, lambda _reply: nitter_status)
    check(nitter_filled and nitter_filled[0]["text"] == "filled from nitter", "nitter lookup is used when the reply is incomplete")
    mismatched = fill_missing(
        [{"id": "7", "text": "maybe", "handle": "neo", "platform": "x", "kind": "reply"}],
        parent,
        lambda _reply: {"id": "7", "text": "maybe", "author": {"screen_name": "neo"}, "replying_to": {"status": "999"}, "created_at": "Tue Oct 20 00:00:00 +0000 2026"},
    )
    check(mismatched == [], "a status lookup that points elsewhere is dropped")
    merged = merge_replies(
        [{"id": "1", "text": "old", "avatar": "keep", "stats": {"likes": 1}}],
        [{"id": "1", "text": "new", "stats": {"likes": 9}}, {"id": "2", "text": "only"}],
    )
    check(merged[0]["stats"]["likes"] == 9 and merged[0]["text"] == "new" and merged[0]["avatar"] == "keep" and merged[1]["id"] == "2", "fresh likes win and missing fields stay")
    moment = datetime(2026, 10, 20, tzinfo=timezone.utc)
    check(comments_due("2026-10-19T00:00:00Z", "2026-10-19T23:00:00Z", moment), "posts under 7 days refresh every run")
    check(not comments_due("2026-10-13T00:00:00Z", "2026-10-19T23:00:00Z", moment), "a 7 day post waits a day")
    check(comments_due("2026-10-13T00:00:00Z", "2026-10-18T00:00:00Z", moment), "a 7 day post refreshes after a day")
    check(comments_due("2026-09-20T00:00:00Z", "", moment), "a 30 day post with no fetch time is due")
    check(not comments_due("2026-09-19T23:00:00Z", "", moment), "posts older than 30 days are left alone")
    check(comments_due("", "2026-10-19T00:00:00Z", moment), "an undated post refreshes every run")
    fresh_ig = {"platform": "instagram", "date": "2026-10-19T00:00:00Z"}
    check(comments_kept(fresh_ig, moment), "instagram under 7 days is stored")
    check(comments_kept({"platform": "threads", "date": "2026-10-18T00:00:00Z"}, moment), "threads under 7 days is stored")
    check(not comments_kept({"platform": "instagram", "date": "2026-10-13T00:00:00Z"}, moment), "a 7 day instagram post is not stored")
    check(not comments_kept({"platform": "x", "date": "2026-10-19T00:00:00Z"}, moment), "x replies are not stored")
    check(not comments_kept({"platform": "youtube", "date": "2026-10-19T00:00:00Z"}, moment), "youtube comments are not stored")
    check(not comments_kept({"platform": "instagram"}, moment), "an undated post is not stored")
    check(comments_kept({"platform": "rss", "commentRss": "https://example.com/comments", "date": "2026-10-19T00:00:00Z"}, moment), "comment rss under 7 days is stored")

    nit = parse_nitter_replies((FIX / "replies" / "nitter_sample.html").read_text(encoding="utf-8"), "2112600761762717997")
    check(len(nit) == 2, "nitter replies")
    check(nit[0]["handle"] == "yesknow" and "Bach" in nit[0]["text"], "nitter first reply")
    check(nit[0]["stats"]["likes"] == 40 and nit[0]["kind"] == "reply", "nitter reply stats")

    ig_replies = parse_ig_comments((FIX / "replies" / "ig_comments.json").read_text(encoding="utf-8"), {"handle": "redacted_handle", "author": "redacted_handle", "statusId": "1"})
    check(len(ig_replies) == 2 and ig_replies[0]["stats"]["likes"] == 5, "instagram comments sorted by likes")
    check(ig_replies[0]["verifiedType"] == "blue" and ig_replies[0]["kind"] == "reply", "instagram verified reply")
    check(ig_replies[0]["replyingTo"]["handle"] == "redacted_handle", "instagram reply target")

    th_replies = parse_threads_replies((FIX / "replies" / "threads_replies.html").read_text(encoding="utf-8"), {"handle": "redacted_handle", "author": "redacted_handle", "statusId": "DeZtp"})
    check(len(th_replies) == 2 and th_replies[0]["stats"]["likes"] == 9, "threads replies sorted by likes")
    check(th_replies[0]["text"] == "Wow" and th_replies[0]["kind"] == "reply", "threads reply text")

    parent = {"handle": "redacted_handle", "author": "Mark Zuckerberg", "statusId": "4006377606181159966", "url": "https://www.instagram.com/p/DeZgzTEggQe/"}
    gql_rows, gql_count = parse_ig_document((FIX / "replies" / "ig_graphql.json").read_text(encoding="utf-8"), parent)
    check(gql_count == 42 and len(gql_rows) == 2 and gql_rows[0]["text"] == "Nice melon", "graphql parent comments")
    check(gql_rows[0]["verifiedType"] == "blue" and gql_rows[0]["stats"]["likes"] == 5, "graphql comment likes")
    web_rows, web_count = parse_ig_document((FIX / "replies" / "ig_web_info.json").read_text(encoding="utf-8"), parent)
    check(web_count == 7 and web_rows[0]["handle"] == "cy" and web_rows[0]["text"] == "First", "web info preview comments")
    embed_rows, embed_count = parse_ig_document((FIX / "replies" / "ig_embed.html").read_text(encoding="utf-8"), parent)
    check(embed_count == 42 and embed_rows[0]["handle"] == "ada" and embed_rows[0]["text"] == "Nice melon", "embed caption comments")
    viewer_rows, _viewer_count = parse_ig_document((FIX / "replies" / "ig_viewer.html").read_text(encoding="utf-8"), parent)
    check(len(viewer_rows) == 1 and viewer_rows[0]["handle"] == "bea" and viewer_rows[0]["text"] == "Hello there", "viewer html comments")

    direct_rows, direct_count = parse_threads_document((FIX / "replies" / "threads_direct.html").read_text(encoding="utf-8"), {"handle": "redacted_handle", "author": "redacted_handle", "statusId": "DeZtp"})
    check(direct_count == 4 and len(direct_rows) == 1 and direct_rows[0]["text"] == "Wow", "threads direct replies skip other posts")
    check(direct_rows[0]["handle"] == "ada" and direct_rows[0]["replyingTo"]["id"] == "DeZtp", "threads direct reply target")

    nested_ig = {
        "comments": [{
            "pk": "p1",
            "text": "Parent",
            "comment_like_count": 3,
            "child_comment_count": 4,
            "user": {"username": "ada", "full_name": "Ada"},
            "preview_child_comments": [
                {"pk": "k1", "text": "Child", "comment_like_count": 1, "user": {"username": "bea"}},
                {
                    "pk": "k2",
                    "text": "Next",
                    "child_comment_count": 1,
                    "user": {"username": "cy"},
                    "preview_child_comments": [{"pk": "g1", "text": "Nope", "user": {"username": "dee"}}],
                },
            ],
        }]
    }
    ig_nested = parse_ig_comments(nested_ig, {"handle": "redacted_handle", "statusId": "post", "url": "https://www.instagram.com/p/abc/"})
    check(ig_nested[0]["stats"]["replies"] == 4 and len(ig_nested[0]["_children"]) == 2, "instagram stores one level of child comments")
    check(ig_nested[0]["_children"][0]["replyingTo"]["id"] == "p1" and "_children" not in ig_nested[0]["_children"][1], "instagram children reply to the comment")
    gql_nested, _gql_nested_count = parse_ig_document(
        {"data": {"xdt_shortcode_media": {"edge_media_to_parent_comment": {"count": 1, "edges": [{"node": {
            "id": "c1", "text": "Top", "owner": {"username": "ada"}, "edge_liked_by": {"count": 2},
            "edge_threaded_comments": {"count": 2, "edges": [{"node": {"id": "c1a", "text": "Under", "owner": {"username": "bea"}, "edge_liked_by": {"count": 1}}}]},
        }}]}}}},
        {"handle": "redacted_handle", "statusId": "post"},
    )
    check(gql_nested[0]["stats"]["replies"] == 2 and gql_nested[0]["_children"][0]["text"] == "Under", "graphql threaded comments become children")

    thread_nested = parse_threads_replies(
        {"reply_threads": [{"post": {
            "pk": "10", "code": "AbC", "like_count": 2, "caption": {"text": "Hi"}, "user": {"username": "ada"},
            "text_post_app_info": {
                "direct_reply_count": 3,
                "direct_replies": {"edges": [{"node": {"post": {
                    "pk": "11", "code": "XyZ", "caption": {"text": "Yo"}, "user": {"username": "bea"},
                    "text_post_app_info": {"direct_reply_count": 1, "direct_replies": {"edges": [{"node": {"post": {
                        "pk": "12", "caption": {"text": "Deep"}, "user": {"username": "cy"},
                    }}}]}},
                }}}]},
            },
        }}]},
        {"handle": "redacted_handle", "statusId": "root"},
    )
    check(thread_nested[0]["stats"]["replies"] == 3 and thread_nested[0]["url"].endswith("/t/AbC"), "threads reply count and permalink")
    check(len(thread_nested[0]["_children"]) == 1 and thread_nested[0]["_children"][0]["replyingTo"]["id"] == "10" and "_children" not in thread_nested[0]["_children"][0], "threads stores one level of replies")

    engaged = [
        {"id": str(i), "handle": "a", "text": "hello from " + str(i), "date": "2026-10-20T00:00:00Z", "stats": {"likes": i, "replies": 1 if i < 13 else 0}}
        for i in range(1, 16)
    ]
    engaged.append({"id": "spam", "handle": "x", "text": "free btc airdrop now", "spam": True, "stats": {"likes": 500, "replies": 9}})
    picked = select_subthreads(engaged, 10)
    check(len(picked) == 10 and picked[0]["id"] == "12" and all(int((row.get("stats") or {}).get("replies") or 0) > 0 and not row.get("spam") for row in picked), "subthreads are the ten most engaged replies")

    search_payload = {
        "data": [
            {"id": "parent", "text": "root", "author_id": "u1", "conversation_id": "parent", "created_at": "2026-10-20T00:00:00.000Z"},
            {"id": "c1", "text": "direct", "author_id": "u2", "in_reply_to_user_id": "u1", "conversation_id": "parent", "created_at": "2026-10-20T00:01:00.000Z", "referenced_tweets": [{"type": "replied_to", "id": "parent"}], "public_metrics": {"like_count": 2, "reply_count": 1}},
            {"id": "c2", "text": "elsewhere", "author_id": "u3", "conversation_id": "root", "created_at": "2026-10-20T00:02:00.000Z", "referenced_tweets": [{"type": "replied_to", "id": "elsewhere"}]},
        ],
        "includes": {"users": [
            {"id": "u1", "name": "A", "username": "a", "created_at": "2020-01-01T00:00:00.000Z", "public_metrics": {"followers_count": 10}},
            {"id": "u2", "name": "B", "username": "b", "public_metrics": {"followers_count": 3}},
            {"id": "u3", "name": "C", "username": "c"},
        ]},
    }
    searched = parse_conversation_search(search_payload, "parent")
    kept = [row for row in searched if belongs(row, "parent") is True]
    check("parent" not in {row["id"] for row in searched} and len(kept) == 1 and kept[0]["id"] == "c1", "conversation search keeps only a direct reply")
    check(kept[0]["replyingTo"]["id"] == "parent" and kept[0]["conversationId"] == "parent" and kept[0]["authorFollowers"] == 3, "conversation search fills the reply target")
    saved_bearer = os.environ.pop("X_BEARER_TOKEN", None)
    try:
        check(conversation_search("2112600761762717997") is None, "conversation search does nothing without a token")
    finally:
        if saved_bearer is not None:
            os.environ["X_BEARER_TOKEN"] = saved_bearer

    rss_replies = parse_comment_rss((FIX / "replies" / "comments.xml").read_text(encoding="utf-8"), {"handle": "example", "author": "Example", "id": "g1", "platform": "rss"})
    check(len(rss_replies) == 2 and all(r["kind"] == "reply" for r in rss_replies), "comment rss replies")
    check(rss_replies[0]["replyingTo"]["id"] == "g1" and rss_replies[0]["replyingTo"]["handle"] == "example", "comment rss target")

    # loose JSON header tolerance
    wrapped = "tool header\n" + (FIX / "x_api_v2_finkd.json").read_text(encoding="utf-8") + "\nX reads left: 1\n"
    check(parse_json_loose(wrapped)["data"], "loose json skips header and trailer")

    check(cdn_expiry("https://scontent.cdninstagram.com/v/a.jpg?oe=6ADDAAC5") == "2026-10-25T07:07:49Z", "oe hex is an expiry")
    check(needs_refresh("media/local.jpg"), "local media needs a CDN url")
    later = (datetime.now(timezone.utc) + timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ")
    check(not needs_refresh("https://scontent.cdninstagram.com/v/a.jpg?oe=6ADDAAC5", later), "fresh CDN url waits")
    html = '<img src="https://static.cdninstagram.com/rsrc.php/icon.png"><img src="https://scontent.cdninstagram.com/v/t51.1/pic.jpg?oe=6ADDAAC5&amp;_nc_cat=1">'
    pulled = extract_cdn_urls(html)
    check(len(pulled) == 1 and "pic.jpg" in pulled[0] and "&_nc_cat=1" in pulled[0], "embed html keeps the post image")
    groups = media_groups(
        [
            "https://scontent.cdninstagram.com/v/t51.82787-19/ava.jpg?stp=dst-jpg_s150x150",
            "https://scontent.cdninstagram.com/v/t51.1/pic.jpg?stp=dst-jpg_e35_p640x640",
            "https://scontent.cdninstagram.com/v/t51.1/pic.jpg?stp=dst-jpg_e35_p1080x1080",
        ]
    )
    check(len(groups) == 1 and "p1080" in groups[0][0] and "p640" in groups[0][1], "refresh prefers the larger rendition")
    try:
        assert_not_x_api("https://api.x.com/2/users/me")
        check(False, "paid X API is refused")
    except ValueError:
        check(True, "paid X API is refused")
    os.environ["TWITTER_AUTH_TOKEN"] = "abc123"
    try:
        check(auth_cookie_header("https://nitter.meowing.monster/redacted_handle/rss").get("Cookie") == "auth_token=abc123", "nitter gets the optional cookie")
        check(auth_cookie_header("https://api.fxtwitter.com/2/profile/redacted_handle/statuses") == {}, "fxtwitter does not get the X cookie")
        check(auth_cookie_header("https://www.instagram.com/p/abc/") == {}, "instagram does not get the X cookie")
    finally:
        os.environ.pop("TWITTER_AUTH_TOKEN", None)

    import json as jsonlib
    import tempfile
    from update_feeds import prune_comments, write_comment_lookup

    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        (folder / "keep.json").write_text(jsonlib.dumps({"replies": [{"id": "r1", "replies": [{"statusId": "r2"}]}]}), encoding="utf-8")
        (folder / "r1.json").write_text(jsonlib.dumps({"replies": [{"id": "r3"}]}), encoding="utf-8")
        (folder / "yt_keep.json").write_text("{}", encoding="utf-8")
        (folder / "xpost.json").write_text("{}", encoding="utf-8")
        (folder / "gone.json").write_text("{}", encoding="utf-8")
        (folder / "orphan.json").write_text("{}", encoding="utf-8")
        (folder / "lookup.json").write_text("{}", encoding="utf-8")
        removed = prune_comments(
            {
                "posts": [
                    {"id": "keep", "statusId": "keep", "platform": "instagram", "date": "2026-10-19T00:00:00Z"},
                    {"id": "xpost", "statusId": "xpost", "platform": "x", "date": "2026-10-19T00:00:00Z"},
                    {"id": "old", "statusId": "gone", "platform": "threads", "date": "2026-09-01T00:00:00Z"},
                ]
            },
            folder,
            now=datetime(2026, 10, 20, tzinfo=timezone.utc),
        )
        check(removed == 4 and (folder / "keep.json").exists() and (folder / "r1.json").exists() and (folder / "lookup.json").exists() and not (folder / "yt_keep.json").exists() and not (folder / "xpost.json").exists() and not (folder / "gone.json").exists() and not (folder / "orphan.json").exists(), "stale comment files are pruned and nested replies stay")
        count = write_comment_lookup(folder)
        lookup = jsonlib.loads((folder / "lookup.json").read_text(encoding="utf-8"))
        check(count == 3 and lookup.get("r1") == "keep" and lookup.get("r2") == "keep" and lookup.get("r3") == "r1", "reply lookup points at the comment file")

    yt = parse_youtube((FIX / "youtube_mkbhd.xml").read_text(encoding="utf-8"), {"id": "youtube:mkbhd", "platform": "youtube", "handle": "mkbhd", "channelId": "UCBJycsmduvYEL83R_U4JriQ"})
    first = yt["posts"][0]
    check(len(yt["posts"]) == 2 and first["id"] == "scwlR0QHGOk" and first["title"].startswith("The NEW Tesla Roadster"), "youtube rss title and id")
    check(yt["profiles"][0].get("channelId") == "UCBJycsmduvYEL83R_U4JriQ", "youtube profile keeps the channel id")
    check(first["stats"]["views"] == 11453176 and first["stats"]["likes"] == 181847, "youtube rss views and likes")
    check(first["media"][0]["poster"] == "https://i.ytimg.com/vi/scwlR0QHGOk/hqdefault.jpg", "youtube thumbnail is hotlinked")
    check("youtube-nocookie.com/embed/scwlR0QHGOk" in first["media"][0]["url"], "youtube embed url")
    from adapters.youtube_community import parse as parse_community
    from adapters.youtube_community import parse_rss_posts

    community_feed = {"id": "youtube:redacted_handle", "platform": "youtube", "handle": "redacted_handle", "channelId": "UCfgtuaUadGgOA-91geQ8Qog", "profile": {"name": "Canadian Prepper"}}
    community = parse_community((FIX / "youtube_community_invidious.json").read_text(encoding="utf-8"), community_feed)
    by_id = {post["id"]: post for post in community["posts"]}
    image_post = by_id["UgkxwgD1SpZbB0jjdvLVVQ1kDUAUojU3kyah"]
    check(image_post["kind"] == "community" and image_post["author"] == "Canadian Prepper" and image_post["stats"]["likes"] == 690 and image_post["stats"]["replies"] == 70, "community image post keeps likes and comments")
    check(image_post["media"][0]["url"].startswith("https://yt3.ggpht.com/") and "s2000" in image_post["media"][0]["url"] and image_post["avatar"].startswith("https://yt3.googleusercontent.com/"), "community images hotlink the largest thumbnail")
    check(image_post["url"] == "https://www.youtube.com/post/UgkxwgD1SpZbB0jjdvLVVQ1kDUAUojU3kyah" and image_post["date"].endswith("Z"), "community post links to the post page")
    multi = by_id["UgzdP2CVxI1IMXtXT9B4AaABCQ"]
    check(2 <= len(multi["media"]) <= 4 and all(item["type"] == "photo" and "yt3.ggpht.com" in item["url"] for item in multi["media"]), "community multi-image post keeps each photo")
    poll = next(post for post in community["posts"] if post.get("poll"))
    check(poll["poll"]["totalVotes"] > 0 and len(poll["poll"]["choices"]) >= 2 and all("percent" not in choice and "votes" not in choice for choice in poll["poll"]["choices"]), "community poll keeps choices and hides missing percents")
    shared = next(post for post in community["posts"] if post.get("quoted"))
    check(shared["kind"] == "community" and shared["quoted"]["url"].startswith("https://www.youtube.com/watch?v=") and shared["quoted"]["media"][0]["url"].startswith("https://i.ytimg.com/vi/") and not shared.get("media"), "community video share is a quote, not an upload")
    page = parse_community((FIX / "youtube_community_initial.json").read_text(encoding="utf-8"), community_feed)
    scraped = page["posts"][0]
    check(scraped["id"] == image_post["id"] and scraped["stats"]["likes"] == 690 and scraped["media"][0]["url"].startswith("https://yt3.ggpht.com/") and scraped["date"] == "", "posts page fallback keeps the image and does not invent a time")
    rss_image = image_post["media"][0]["url"]
    rss = (
        "<?xml version='1.0'?><rss version='2.0'><channel><item>"
        f"<title>{image_post['text'][:40]}</title>"
        f"<link>{image_post['url']}</link>"
        f"<guid>{image_post['url']}</guid>"
        "<pubDate>Fri, 20 Mar 2026 12:00:00 GMT</pubDate>"
        f"<description><![CDATA[<p>{image_post['text']}</p><img src=\"{rss_image}\">]]></description>"
        "</item></channel></rss>"
    )
    rss_posts = parse_rss_posts(rss, community_feed)
    check(len(rss_posts) == 1 and rss_posts[0]["id"] == image_post["id"] and rss_posts[0]["media"][0]["url"] == rss_image and rss_posts[0]["date"].startswith("2026-03-20"), "rsshub community item keeps the post id and image")
    tesla = parse_youtube((FIX / "youtube_tesla.xml").read_text(encoding="utf-8"), {"id": "youtube:tesla", "platform": "youtube", "handle": "Tesla", "channelId": "UC5WjFrtBdufl6CZojX3D8dQ"})
    check(tesla["posts"][0]["title"].startswith("Zero to sixty") and tesla["profiles"][0]["name"] == "Tesla", "tesla fixture parses offline")
    comment = normalize_invidious_comment(
        {"commentId": "abc", "author": "@ada", "content": "Nice", "likeCount": 5, "published": 1792272039, "verified": True, "replies": {"replyCount": 2, "continuation": "tok"}},
        "scwlR0QHGOk",
        "mkbhd",
    )
    check(comment["text"] == "Nice" and comment["stats"]["likes"] == 5 and comment["stats"]["replies"] == 2 and comment["date"].startswith("2026-"), "invidious comment shape")
    import yt_remote as yt_remote_mod
    calls = []

    def fake_page(video_id, sort, continuation=""):
        calls.append(continuation)
        kids = [{"commentId": "kid-" + str(index), "author": "@bea", "content": "yo " + str(index), "likeCount": 1, "replies": {"replyCount": 4, "continuation": "deeper"}} for index in range(25)]
        return {"comments": kids}

    previous_page = yt_remote_mod._page_invidious
    yt_remote_mod._page_invidious = fake_page
    try:
        quiet = normalize_invidious_comment({"commentId": "quiet", "author": "a", "content": "nope", "likeCount": 9, "replies": {"replyCount": 0}}, "video", "chan")
        loud = normalize_invidious_comment({"commentId": "loud", "author": "@ada", "content": "yes", "likeCount": 1, "replies": {"replyCount": 8, "continuation": "loud-token"}}, "video", "chan")
        mid = normalize_invidious_comment({"commentId": "mid", "author": "b", "content": "mid", "likeCount": 3, "replies": {"replyCount": 2, "continuation": "mid-token"}}, "video", "chan")
        yt_remote_mod._fill_replies([quiet, mid, loud], "video", "chan", 1)
        check(calls == ["loud-token"] and len(loud["replies"]) == 20 and loud["replies"][0]["replyingTo"]["id"] == "loud", "invidious fills the busiest thread and stops at 20")
        check(loud["replies"][0]["replies"] == [] and not mid.get("replies"), "invidious does not fetch a third level")
    finally:
        yt_remote_mod._page_invidious = previous_page
    fresh = {"id": "vid", "avatar": "", "verifiedType": None, "media": [{"type": "video", "url": "https://www.youtube-nocookie.com/embed/vid"}]}
    carry_youtube_fields(
        [fresh],
        [{"id": "vid", "avatar": "https://yt3.googleusercontent.com/a", "verifiedType": "blue", "media": [{"duration": 90, "stream": "https://example/stream"}]}],
        {"avatar": "https://yt3.googleusercontent.com/saved", "verifiedType": "blue"},
    )
    check(fresh["avatar"].endswith("/a") and fresh["verifiedType"] == "blue" and fresh["media"][0]["duration"] == 90 and fresh["short"] is False, "youtube enrichment survives a missed channel fetch")
    blank = {"id": "new", "avatar": "", "media": [{}]}
    carry_youtube_fields([blank], [], {"avatar": "https://yt3.googleusercontent.com/saved", "verifiedType": "blue"})
    check(blank["avatar"].endswith("/saved") and blank["verifiedType"] == "blue", "new youtube posts inherit the saved profile")

    import json
    import tempfile

    from archive import merge_archive, stub_from_post, summarize

    community_stub = stub_from_post(image_post)
    check(community_stub["p"] == "youtube" and community_stub["id"] == image_post["id"] and community_stub["k"] == "community" and community_stub["t"] == image_post["text"][:280], "community posts archive as stubs")
    from pull_snapshot import pull_archive

    long_text = "word " * 80
    post = {
        "platform": "instagram",
        "id": "4006377606181159966",
        "handle": "redacted_handle",
        "date": "2026-10-12T16:56:29Z",
        "kind": "post",
        "text": long_text,
        "url": "https://www.instagram.com/p/DeZgzTEggQe/",
        "media": [{"type": "photo", "url": "https://cdn.example/a.jpg"}],
        "stats": {"likes": 5},
        "avatar": "https://cdn.example/a.jpg",
    }
    stub = stub_from_post(post)
    check(stub["id"] == "DeZgzTEggQe" and stub["p"] == "instagram", "instagram stub uses the shortcode")
    check(len(stub["t"]) == 280 and "k" not in stub, "snippet is capped at 280 and plain posts omit kind")
    encoded = json.dumps(stub, ensure_ascii=False, separators=(",", ":"))
    check("cdn.example" not in encoded and "media" not in stub and "stats" not in stub, "stub stores no media or stats")
    reply = stub_from_post(dict(post, platform="threads", id="DeZtp7KER52", url="https://www.threads.com/t/DeZtp7KER52", kind="reply", text="short"))
    check(reply["id"] == "DeZtp7KER52" and reply["k"] == "reply" and len(reply["t"]) < 280, "threads stub keeps a reply kind")
    undated = stub_from_post({"platform": "rss", "id": "item-1", "handle": "news", "text": "hi"})
    check(undated and undated["id"] == "item-1" and "d" not in undated, "undated stub omits an empty date")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        added = merge_archive(root / "archive", [post, post])
        check(added == 1, "the same id is not archived twice")
        added = merge_archive(root / "archive", [dict(post, text="different text that must not replace the first snippet")])
        check(added == 0, "an existing stub is not overwritten")
        saved = json.loads((root / "archive" / "2026-10.json").read_text(encoding="utf-8"))
        check(saved[0]["t"] == stub["t"] and saved[0]["id"] == "DeZgzTEggQe", "the first snippet stays in the month shard")
        index = json.loads((root / "archive" / "index.json").read_text(encoding="utf-8"))
        check(index["shards"] == ["2026-10"], "the shard is named for its month")
        older = {"platform": "x", "id": "2112600761762717997", "handle": "redacted_handle", "date": "2026-08-02T00:00:00Z", "text": "old", "kind": "post"}
        merge_archive(root / "archive", [older])
        index = json.loads((root / "archive" / "index.json").read_text(encoding="utf-8"))
        check(index["shards"] == ["2026-10", "2026-08"], "older months follow the newest shard")
        before = (root / "archive" / "2026-10.json").read_bytes()

        def fetch_partial(rel):
            if rel.endswith("index.json"):
                return b'{"shards":["2026-10","2026-09"]}\n'
            if rel.endswith("2026-10.json"):
                return b'[{"p":"x","id":"1"}]\n'
            return None

        check(pull_archive(root, fetch_partial) == "kept", "a partial archive download keeps the local shards")
        check((root / "archive" / "2026-10.json").read_bytes() == before, "a partial download does not rewrite a shard")

        def fetch_ok(rel):
            if rel.endswith("index.json"):
                return b'{"shards":["2026-09"]}\n'
            if rel.endswith("2026-09.json"):
                return b'[{"p":"x","id":"only","d":"2026-09-01T00:00:00Z","t":"kept","media":"nope"}]\n'
            return None

        check(pull_archive(root, fetch_ok) == "updated", "a complete archive download merges the shards")
        september = json.loads((root / "archive" / "2026-09.json").read_text(encoding="utf-8"))
        check(september[0]["id"] == "only" and set(september[0]) <= {"p", "id", "h", "d", "k", "t"}, "the downloaded stub is stored without extra fields")
        check((root / "archive" / "2026-10.json").is_file() and (root / "archive" / "2026-08.json").is_file(), "months missing from the remote stay")
        kept_text = json.loads((root / "archive" / "2026-10.json").read_text(encoding="utf-8"))[0]["t"]

        def fetch_more(rel):
            if rel.endswith("index.json"):
                return b'{"shards":["2026-10"]}\n'
            if rel.endswith("2026-10.json"):
                return b'[{"p":"instagram","id":"DeZgzTEggQe","d":"2026-10-12T16:56:29Z","t":"replaced","media":"nope"},{"p":"x","id":"20","d":"2026-10-02T00:00:00Z","t":"new","stats":{"likes":1}}]\n'
            return None

        check(pull_archive(root, fetch_more) == "updated", "a later complete archive adds stubs")
        october = {row["id"]: row for row in json.loads((root / "archive" / "2026-10.json").read_text(encoding="utf-8"))}
        check(october["DeZgzTEggQe"]["t"] == kept_text and october["20"]["t"] == "new" and "stats" not in october["20"], "an existing stub keeps its first text")
        check(pull_archive(root, fetch_more) == "kept", "a complete archive with no new stubs leaves the files")
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp)
        doc = json.loads((ROOT / "feeds.json").read_text(encoding="utf-8"))
        added = merge_archive(dest, doc["posts"])
        stats = summarize(dest)
        check(added == stats["count"] and stats["count"] >= 20, "the seed archive has one stub per post id")
        check(stats["max"] < 700 and stats["avg"] < 400, "seed stubs stay within a few hundred bytes")
        bad_fields = 0
        long_text = 0
        for path in dest.glob("*.json"):
            if path.name == "index.json":
                continue
            for row in json.loads(path.read_text(encoding="utf-8")):
                if not set(row) <= {"p", "id", "h", "d", "k", "t"}:
                    bad_fields += 1
                if len(row.get("t") or "") > 280:
                    long_text += 1
        check(bad_fields == 0 and long_text == 0, "every stub is text only and at most 280 characters")
    import subprocess
    env = os.environ.copy()
    env.pop("IA_ACCESS_KEY", None)
    env["IA_SECRET_KEY"] = "sentinel-secret-value"
    skipped = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "ia_archive.py")],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    combined = skipped.stdout + skipped.stderr
    check(skipped.returncode == 0 and "skipping the upload" in skipped.stdout, "missing Internet Archive keys skip the upload")
    check("sentinel-secret-value" not in combined and "IA_SECRET_KEY" not in combined, "the skip path does not print a secret")

    import struct
    manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
    check(manifest["display"] == "standalone" and manifest["scope"] == "/rss-feeds/", "the manifest is a standalone app scoped to /rss-feeds/")
    check(str(manifest["start_url"]).endswith("#/home"), "the manifest opens the home timeline")
    check("window-controls-overlay" in manifest["display_override"], "desktop installs can use the window controls overlay")
    purposes = {icon.get("purpose") for icon in manifest["icons"]}
    sizes = {icon.get("sizes") for icon in manifest["icons"]}
    check("192x192" in sizes and "512x512" in sizes and "maskable" in purposes, "the manifest has 192, 512, and maskable icons")
    shortcut_names = [item["name"] for item in manifest["shortcuts"]]
    check(shortcut_names == ["Home", "Subscriptions", "Bookmarks", "Lists"], "the manifest shortcuts are Home, Subscriptions, Bookmarks, and Lists")
    check(manifest["share_target"]["method"] == "GET" and manifest["share_target"]["enctype"] == "application/x-www-form-urlencoded" and "url" in manifest["share_target"]["params"], "sharing a link into the app is a GET share target")
    worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    check("__SW_VERSION__" in worker and "150 * 1024 * 1024" in worker and "staleWhileRevalidate" in worker, "the service worker versions its cache and caps media")
    check("api.fxtwitter.com" in worker and "networkFirst" in worker and "networkFirstTimeout" in worker and "6000" in worker, "comment APIs are network-first with a short timeout")
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    check('rel="manifest"' in page and "apple-mobile-web-app-capable" in page and "apple-touch-icon" in page, "the page links the manifest and the iOS install tags")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    check("beforeinstallprompt" in app and "Install app" in app and "pictureInPicture" in app and "mediaSession" in app, "install, picture in picture, and media session are in the page")
    check("requestPermission" in app and app.index("requestPermission") > app.index("data-act=\"notify\""), "notification permission is requested from the settings control")
    workflow = (ROOT / ".github" / "workflows" / "sync.yml").read_text(encoding="utf-8")
    check("manifest.webmanifest" in workflow and "__SW_VERSION__" in workflow and "GITHUB_SHA" in workflow, "the deploy copies the app shell and stamps the service worker")
    check('ranking_mode: "recency"' in app, "fxtwitter conversations also request newest replies")
    check("COMMENT_TTL" in app and "reply-sort" in app and "Updated " in app and 'tab("relevant", "Relevant")' in app and 'tab("recent", "Recent")' in app and 'tab("liked", "Liked")' in app and "replySortMode" in app, "opening a post can sort replies and show when they were fetched")
    check('cron: "15,45 * * * *"' in workflow and "/dispatches" in workflow and "chain" in workflow, "the sync has a staggered cron and a keepalive dispatch")
    check("status.json" in workflow and "fallback" in workflow, "the deploy publishes status and the own-fetcher files")
    check('name: "sources"' in app and "ownPack" in app and "fxDown" in app and "fallback/" in app and "settled" in app and "source-row" in (ROOT / "styles.css").read_text(encoding="utf-8"), "a hidden sources view fails over to our own files")
    check('name: "user"' in app and "#/u/" in app and "with_replies=1" in app and "Open on Instagram" in app and "feeds.config.json" in app and "pfollow-note" in (ROOT / "styles.css").read_text(encoding="utf-8"), "live profiles open from a handle and keep follows on the device")
    config_text = (ROOT / "feeds.config.json").read_text(encoding="utf-8")
    community_src = (ROOT / "scripts" / "adapters" / "youtube_community.py").read_text(encoding="utf-8")
    check("rsshub.rssforever.com" not in config_text and "rsshub.pseudoyu.com" not in config_text and "hub.slarker.me" not in config_text, "public RSSHub mirrors are not feed sources")
    check("RSSHUB_MIRRORS" not in community_src and "rssforever" not in community_src, "community posts use the local RSSHub container")
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    check("fallback/" in ignore and "status.json" in ignore, "generated fallback files stay out of git")

    from datetime import datetime as dt
    from own_fetch import extract_watch, parse_ig_oembed, parse_innertube_comments, parse_syndication, select_recent
    from health import build_status

    synd = parse_syndication(json.loads((FIX / "own" / "syndication.json").read_text(encoding="utf-8")))
    check(synd["handle"] == "redacted_handle" and synd["stats"]["likes"] == 48280 and synd["stats"]["replies"] == 5558 and synd["replies"] == [] and "Bach" in synd["text"], "x syndication keeps the post and does not invent replies")
    moment = dt(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
    comments = parse_innertube_comments(json.loads((FIX / "own" / "innertube_comments.json").read_text(encoding="utf-8")), {"statusId": "xtrFOsncOeo", "handle": "redacted_handle"}, moment)
    check(len(comments) == 1 and comments[0]["text"] == "This is a public comment." and comments[0]["stats"]["likes"] == 276 and comments[0]["date"] == "2026-10-20T21:00:00Z", "youtube innertube comments keep text, likes, and a real time")
    check(comments[0]["replies"][0]["text"] == "A reply under it." and comments[0]["replies"][0]["date"] == "2026-10-21T11:57:00Z", "a youtube reply stays under its parent")
    watch = extract_watch((FIX / "own" / "watch_snippet.html").read_text(encoding="utf-8"))
    check(watch["key"] == "AIzaSyTESTKEY" and watch["token"] == "Eg0S_TEST_TOKEN" and watch["version"] == "2.20251021.00.00", "the watch page yields the public innertube key and comment token")
    oembed = parse_ig_oembed(json.loads((FIX / "own" / "ig_oembed.json").read_text(encoding="utf-8")), "DeZgzTEggQe")
    check("melon" in oembed["text"] and oembed["author"] == "redacted_handle" and oembed["replies"] == [] and oembed["media"][0]["url"].startswith("https://"), "instagram oembed keeps the caption and no comments")
    wrapped, wrapped_count = parse_threads_document(json.loads((FIX / "own" / "threads_wrapper.json").read_text(encoding="utf-8")), {"handle": "redacted_handle", "statusId": "DeZtp"})
    check(wrapped_count == 76 and len(wrapped) == 1 and wrapped[0]["text"] == "Visible reply" and wrapped[0]["stats"]["likes"] == 25 and wrapped[0]["handle"] == "ada", "threads mobile wrapper yields the visible reply")
    picked = select_recent(
        [
            {"id": "x1", "platform": "x", "date": "2026-10-20T00:00:00Z"},
            {"id": "x2", "platform": "x", "date": "2026-10-19T00:00:00Z"},
            {"id": "ig", "platform": "instagram", "date": "2026-10-12T00:00:00Z"},
            {"id": "th", "platform": "threads", "date": "2026-10-12T00:00:00Z"},
            {"id": "yt", "platform": "youtube", "date": "2026-10-20T00:00:00Z"},
            {"id": "old", "platform": "x", "date": "2026-09-01T00:00:00Z"},
            {"id": "post", "platform": "youtube", "kind": "community", "date": "2026-10-20T00:00:00Z"},
        ],
        moment,
    )
    picked_ids = [post["id"] for post in picked]
    check(picked_ids[0] == "x1" and "ig" in picked_ids and "th" in picked_ids and "yt" in picked_ids and "old" not in picked_ids and "post" not in picked_ids, "fallback files stay on recent posts and skip community comments")
    status_doc = build_status(
        [
            {"id": "fxtwitter", "group": "X", "up": False, "detail": "down", "down": "fxtwitter"},
            {"id": "invidious.f5.si", "group": "YouTube", "up": True, "detail": "invidious API", "down": "https://invidious.f5.si"},
            {"id": "pipedapi.kavin.rocks", "group": "YouTube", "up": False, "detail": "down", "down": "https://pipedapi.kavin.rocks"},
        ],
        "2026-10-21T12:00:00Z",
    )
    check(status_doc["down"] == ["fxtwitter", "https://pipedapi.kavin.rocks"] and status_doc["sources"][1]["up"] is True, "status.json lists dead browser hosts and leaves live ones in rotation")

    def png_size(path: Path):
        data = path.read_bytes()
        check(data.startswith(b"\x89PNG\r\n\x1a\n"), path.name + " is a png")
        return struct.unpack(">II", data[16:24])

    check(png_size(ROOT / "icons" / "icon-192.png") == (192, 192), "the 192 icon is 192 pixels")
    check(png_size(ROOT / "icons" / "icon-512.png") == (512, 512), "the 512 icon is 512 pixels")
    check(png_size(ROOT / "icons" / "icon-maskable-512.png") == (512, 512), "the maskable icon is 512 pixels")
    check(png_size(ROOT / "icons" / "apple-touch-icon.png") == (180, 180), "the apple touch icon is 180 pixels")
    check(png_size(ROOT / "screenshots" / "narrow.png") == (1080, 1920), "the narrow screenshot is a phone frame")
    check(png_size(ROOT / "screenshots" / "wide.png") == (1920, 1080), "the wide screenshot is a desktop frame")
    check((ROOT / "scripts" / "pwa_assets.py").read_text(encoding="utf-8").find("M18.244") < 0, "the install mark is not the X logo")
    print("all adapter checks passed")


if __name__ == "__main__":
    main()
