#!/usr/bin/env python3
"""Quick checks for every adapter. Exits non-zero on failure."""

from __future__ import annotations

import base64
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
    moment = datetime(2026, 10, 21, 6, 40, tzinfo=timezone.utc)
    live = parse_fx(
        {
            "code": 200,
            "results": [
                {
                    "id": "100",
                    "text": "older original",
                    "created_at": "Wed Oct 21 02:41:37 +0000 2026",
                    "author": {"name": "Other", "screen_name": "other"},
                    "reposted_by": {"name": "Test User", "screen_name": "testuser"},
                },
                {
                    "id": "200",
                    "text": "newer post",
                    "created_at": "Wed Oct 21 05:44:16 +0000 2026",
                    "author": {"name": "Test User", "screen_name": "testuser"},
                },
                {
                    "id": "300",
                    "text": "not this account",
                    "created_at": "Wed Oct 21 06:00:00 +0000 2026",
                    "author": {"name": "Stranger", "screen_name": "stranger"},
                },
            ],
        },
        {"id": "x:testuser", "handle": "testuser"},
        moment,
    )
    check(len(live["posts"]) == 2, "results timeline keeps this account and drops other people")
    live_repost = live["posts"][0]
    check(live_repost["kind"] == "repost" and live_repost["id"] == "repost:testuser:100" and live_repost["statusId"] == "100", "repost id is the repost and status id is the original")
    check(live_repost["sortDate"] > "2026-10-21T05:44:16" and live_repost["sortDate"] <= "2026-10-21T06:40:00.000Z", "repost sorts above the newer original and not after the fetch")
    check(live["posts"][1]["id"] == "200" and live["posts"][1]["kind"] == "post", "an original post keeps its id")
    ranked = sorted(live["posts"], key=lambda post: post.get("sortDate") or post.get("date") or "", reverse=True)
    check(ranked[0]["id"] == "repost:testuser:100", "sorting by activity keeps the recent repost")
    kept = parse_nitter(
        """<?xml version="1.0"?><rss><channel><title>T / @testuser</title>
        <item><title>R to @someone: hello back</title><description>hello back</description>
        <link>https://nitter.example/testuser/status/77</link><pubDate>Wed, 21 Oct 2026 06:10:00 GMT</pubDate></item>
        <item><title>RT by @testuser: keep this</title><description>keep this</description>
        <link>https://nitter.example/orig/status/66</link><pubDate>Tue, 20 Oct 2026 01:00:00 GMT</pubDate></item>
        </channel></rss>""",
        {"id": "x:testuser", "handle": "testuser"},
    )
    check(kept["posts"][0]["kind"] == "reply" and kept["posts"][0]["replyingTo"]["handle"] == "someone", "nitter R to stays a reply")
    check(kept["posts"][1]["kind"] == "repost" and kept["posts"][1]["id"].startswith("repost:testuser:"), "nitter RT by stays a repost")
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
    check(image_post["url"] == "https://www.youtube.com/post/UgkxwgD1SpZbB0jjdvLVVQ1kDUAUojU3kyah" and image_post["date"] == "", "community post links to the post page and does not keep a relative time")
    multi = by_id["UgzdP2CVxI1IMXtXT9B4AaABCQ"]
    check(2 <= len(multi["media"]) <= 4 and all(item["type"] == "photo" and "yt3.ggpht.com" in item["url"] for item in multi["media"]), "community multi-image post keeps each photo")
    poll = next(post for post in community["posts"] if post.get("poll"))
    check(poll["poll"]["totalVotes"] > 0 and len(poll["poll"]["choices"]) >= 2 and all("percent" not in choice and "votes" not in choice for choice in poll["poll"]["choices"]), "community poll keeps choices and hides missing percents")
    shared = next(post for post in community["posts"] if any((item.get("type") == "video") for item in (post.get("media") or [])))
    check(shared["kind"] == "community" and shared["media"][0]["videoId"] == "ofnS1aDDF3Y" and shared["media"][0]["url"].startswith("https://www.youtube-nocookie.com/embed/") and shared["media"][0]["poster"].startswith("https://i.ytimg.com/vi/") and not shared.get("quoted"), "community video plays as media")
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
    check("192x192" in sizes and "512x512" in sizes and "maskable" in purposes and "monochrome" in purposes, "the manifest has 192, 512, maskable, and monochrome icons")
    shortcut_names = [item["name"] for item in manifest["shortcuts"]]
    check(shortcut_names == ["Search", "Bookmarks", "Subscriptions", "Notifications"], "the manifest shortcuts are Search, Bookmarks, Subscriptions, and Notifications")
    check(manifest["share_target"]["method"] == "GET" and manifest["share_target"]["enctype"] == "application/x-www-form-urlencoded" and "url" in manifest["share_target"]["params"], "sharing a link into the app is a GET share target")
    worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    check("__SW_VERSION__" in worker and "150 * 1024 * 1024" in worker and "staleWhileRevalidate" in worker, "the service worker versions its cache and caps media")
    check("api.fxtwitter.com" in worker and "networkFirst" in worker and "networkFirstTimeout" in worker and "6000" in worker, "comment APIs are network-first with a short timeout")
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    check('rel="manifest"' in page and "apple-mobile-web-app-capable" in page and "apple-touch-icon" in page and "apple-touch-startup-image" in page and "preconnect" in page, "the page links the manifest, splash images, and preconnect hints")
    check("New version available" in page and 'id="update-go"' in page and 'id="viewer"' in page, "the shell has an update prompt and a media viewer")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    check("beforeinstallprompt" in app and "Install app" in app and "pictureInPicture" in app and "mediaSession" in app, "install, picture in picture, and media session are in the page")
    check("parseSharedLink" in app and "startViewTransition" in app and "rss-feeds-timeline-v1" in app and "rss-feeds-bookmark-queue" in app and "setAppBadge" in app and 'decoding="async"' in app and "navigator.vibrate" in app, "share targets, view transitions, offline snapshots, badges, and haptics are wired")
    check("requestPermission" in app and app.index("requestPermission") > app.index("data-act=\"notify\""), "notification permission is requested from the settings control")
    workflow = (ROOT / ".github" / "workflows" / "sync.yml").read_text(encoding="utf-8")
    check("manifest.webmanifest" in workflow and "__SW_VERSION__" in workflow and "GITHUB_SHA" in workflow, "the deploy copies the app shell and stamps the service worker")
    check('ranking_mode: "recency"' in app, "fxtwitter conversations also request newest replies")
    check("COMMENT_TTL" in app and "reply-sort" in app and "Updated " in app and 'tab("relevant", "Relevant")' in app and 'tab("recent", "Recent")' in app and 'tab("liked", "Liked")' in app and "replySortMode" in app, "opening a post can sort replies and show when they were fetched")
    yt_loader = app[app.index("function ytStub("):app.index("function liveDuration(")]
    reply_bucket = app[app.index("function replyBucket("):app.index("function ivIso(")]
    check("ivThread(" in yt_loader and "ivCommunityThread(" in yt_loader and 'ownPack("yt_"' in yt_loader and 'snapshotDoc("yt_"' in yt_loader and 'ownPack("ytpost_"' in yt_loader and 'snapshotDoc("ytpost_"' in yt_loader and "pipedThread(" not in yt_loader and "loadYtComments(post)" in reply_bucket, "youtube comments share one loader on every surface")
    profile_view = app[app.index("function profileView("):app.index("function statusView(")]
    yt_channel = app[app.index("function ytProfileFromPiped("):app.index("function loadLimited(")]
    check("function catalogAccount(" in app and "function accountHash(" in app and "accountHash(feed.platform, feed.channelId || feed.handle)" in app and "function stopWatchPlayback(" in app and "leavingWatch" in app and "Subscribers" in profile_view and "profileLinkLabel(feed.platform)" in profile_view, "a followed channel opens its synced profile and the watch player stops")
    check('"/channel/"' in yt_channel and "ytProfileFromPiped" in yt_channel and "filter=videos" in yt_channel and "PIPED_SEEDS.slice()" in yt_channel and "function ytImage(" in app, "a live YouTube channel uses the public channel fallback when Invidious misses")
    community_loader = app[app.index("function ivCommunityThread("):app.index("function ytStub(")]
    check("ucid=" in community_loader and "commentCount" in community_loader, "community comments pass the channel id and keep the source count")
    check('cron: "15,45 * * * *"' in workflow and "/dispatches" in workflow and "chain" in workflow, "the sync has a staggered cron and a keepalive dispatch")
    check("status.json" in workflow and "fallback" in workflow, "the deploy publishes status and the own-fetcher files")
    check('name: "sources"' in app and "ownPack" in app and "fxDown" in app and "fallback/" in app and "settled" in app and "source-row" in (ROOT / "styles.css").read_text(encoding="utf-8"), "a hidden sources view fails over to our own files")
    check('name: "user"' in app and "#/u/" in app and "with_replies=1" in app and "Open on Instagram" in app and "feeds.config.json" in app and "pfollow-note" in (ROOT / "styles.css").read_text(encoding="utf-8"), "live profiles open from a handle and keep follows on the device")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    actions = css[css.index(".pactions .outline"):css.index(".pactions .outline") + 280]
    check("flex-shrink: 100" in css and "white-space: nowrap" in actions, "the display name keeps its room and the profile link stays one line")
    check("--fill:" in css and "--hover: rgba(231, 233, 234, 0.1)" in css and "--hover-soft: rgba(255, 255, 255, 0.03)" in css and ".add-account .search { flex: 1; min-width: 0; }" in css and "text-overflow: ellipsis; white-space: nowrap; }" in css[css.index(".who-copy .name"):css.index(".who-copy .name") + 220] and ".watch-main { padding: 0; min-width: 0; }" in css and "function deadMediaUrl(" in app and "function collapseSameUrl(" in app and "Skip to content" in app and 'class="vh">Home' in app and 'aria-current="page"' in app and 'role="tab" aria-selected="' in app, "themes, watch width, dead posters, and control names stay in place")
    check('data-act="autoplay"' in app and "On cellular and Wi-Fi" in app and "Wi-Fi only" in app and 'autoplay: "all"' in app, "settings can keep autoplay on, limit it to Wi-Fi, or turn it off")
    check('meta[name="theme-color"]' in app and 'meta[name="color-scheme"]' in app and "apple-mobile-web-app-status-bar-style" in app and "black-translucent" in page and ".wco { display: none; background: var(--bg); }" in css, "the status bar matches the theme")
    check("follow-request.yml" in app and "unfollow-request.yml" in app and 'class="add-account"' in app and "form.add-account" in app and "function parseAccountInput(" in app and 'data-act="follow-request"' in app, "follow and unfollow open a prefilled issue")
    check("Translate post" in app and "Show original" in app and "function foreignScript(" in app and "translate.google.com" in app and "LanguageDetector" in app and "function translateNow(" in app and "STATE.translated" in app and "FeedsTranslate" in app and "translated" not in app[app.index("function saveSettings("):app.index("function saveSettings(") + 800], "a foreign post translates in the browser or opens Google Translate, and the result is not saved")
    translate_js = (ROOT / "translate.js").read_text(encoding="utf-8")
    check("Translate post" in translate_js and "Translate reply" in translate_js and "Translate bio" in translate_js and "Show original" in translate_js and "Translated from " in translate_js and "LanguageDetector" in translate_js and "downloadable" in translate_js and "api.mymemory.translated.net" in translate_js and "lingva" in translate_js and "translate.google.com" in translate_js and "sessionStorage" in translate_js and "Open in Google Translate" in translate_js, "in-place translation keeps links and falls through free engines")
    check("corsproxy.io" not in translate_js and "allorigins" not in translate_js and "api.x.com" not in translate_js, "translation does not depend on an open proxy or the X API")
    check(page.index('src="translate.js"') < page.index('src="app.js"') and 'href="translate.css"' in page, "the page loads the translator before the app")
    check("translate.js" in workflow and "people.json" in workflow and "suggestions.json" in workflow and "feeds.config.json _site/" in workflow, "the deploy publishes translation and people files")
    check("Mute and block" in app and "mutedWords" in app and "mutedAccounts" in app and "repostOff" in app and "Turn off reposts" in app and "function hiddenPost(" in app and "Muted on this device." in app, "muted words, muted accounts, and reposts stay on this device")
    follows_workflow = (ROOT / ".github" / "workflows" / "follows.yml").read_text(encoding="utf-8")
    check("github.actor == github.repository_owner" in follows_workflow and "startsWith(github.event.issue.title, 'Follow request')" in follows_workflow and "startsWith(github.event.issue.title, 'Unfollow request')" in follows_workflow and "startsWith(github.event.issue.title, 'Subscription groups')" in follows_workflow and "startsWith(github.event.issue.title, 'Link accounts')" in follows_workflow, "follow, group, and link issues from anyone but the owner are ignored")
    check((ROOT / ".github" / "ISSUE_TEMPLATE" / "groups.yml").is_file(), "subscription group issue form exists")
    check("feeds.config.json _site/" in workflow, "the deploy publishes feeds.config.json")
    chips_css = css[css.index(".yt-chips"):css.index(".yt-chips") + 500]
    check("flex-wrap: nowrap" in chips_css and "overflow-x: auto" in chips_css, "subscription chips stay on one scrolling row")
    check("var(--fill)" in css[css.index(".yt-chip.on"):css.index(".yt-chip.on") + 160], "the selected subscription chip uses the inverted fill")
    check("yt-chips" in app and "New group" in app and "Add to group" in app and "subsGroup" in app and "groupsOwn" in app and "group=" in app and "function absorbSiteGroups(" in app and "Save groups to the site" in app, "subscription groups filter from the chip bar and can be published")
    tabs_css = css[css.index(".tabs {"):css.index(".tabs {") + 360]
    check("flex-wrap: nowrap" in tabs_css and "overflow-x: auto" in tabs_css and "white-space: nowrap" in tabs_css, "home tabs stay on one scrolling row")
    tab_menu_css = css[css.index(".menu.tab-menu"):css.index(".menu.tab-menu") + 1400]
    check("Manage tabs" in app and "Following options" in app and "Most recent" in app and "Popular" in app and "Scroll tabs left" in app and "followingSort" in app and "function syncTabArrows(" in app and "Unpin from Home" in app and "Edit list" in app and "list.sort" in app and "tabScrollRoute" in app and "top: auto !important" in tab_menu_css and "border-radius: 16px 16px 0 0" in tab_menu_css, "home tabs have a sort menu, a list menu, a manage button, and scroll arrows")
    check("pinned.slice" not in app and "lists.slice(0," not in app, "pinned home tabs are not capped")
    check((ROOT / ".github" / "ISSUE_TEMPLATE" / "follow-request.yml").is_file() and (ROOT / ".github" / "ISSUE_TEMPLATE" / "unfollow-request.yml").is_file(), "follow and unfollow issue forms exist")
    import follow_request as follow_req

    check(not follow_req.allowed("stranger", "owner-account") and follow_req.allowed("owner-account", "owner-account") and not follow_req.allowed("", "owner-account"), "only the repository owner can change follows")
    parsed_follow = follow_req.parse_issue("Follow request: x nasa", "### Account\n\nnasa\n\n### Platform\n\nx\n")
    check(parsed_follow == {"kind": "follow", "account": "nasa", "platform": "x"}, "a follow issue form is read")
    x_spec = follow_req.normalize("https://x.com/nasa", "x")
    check(x_spec["platform"] == "x" and x_spec["handle"] == "nasa" and x_spec["url"] == "https://x.com/nasa", "an x profile URL becomes a handle")
    bare_spec = follow_req.normalize("@nasa", "")
    check(bare_spec["platform"] == "x" and bare_spec["handle"] == "nasa", "a bare @handle is an X account")
    yt_spec = follow_req.normalize("https://www.youtube.com/@LinusTechTips", "youtube")
    check(yt_spec["handle"] == "LinusTechTips" and yt_spec["channelId"] == "", "a youtube @handle is kept")
    yt_channel_spec = follow_req.normalize("https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw", "youtube")
    check(yt_channel_spec["channelId"] == "UCXuqSBlHAE6Xw-yeJA0Tunw", "a youtube channel id is kept")
    check(follow_req.normalize("https://vk.com/vk", "vk")["handle"] == "vk", "a vk profile URL is a handle")
    check(follow_req.normalize("https://www.threads.net/@redacted_handle", "threads")["handle"] == "redacted_handle", "a threads URL is a handle")
    check(follow_req.normalize("https://www.instagram.com/redacted_handle/", "instagram")["handle"] == "redacted_handle", "an instagram URL is a handle")
    rss_spec = follow_req.normalize("https://example.com/feed.xml", "rss")
    check(rss_spec["platform"] == "rss" and rss_spec["url"] == "https://example.com/feed.xml", "an https feed is an rss follow")
    http_rejected = False
    try:
        follow_req.normalize("http://example.com/feed.xml", "rss")
    except follow_req.Reject:
        http_rejected = True
    check(http_rejected, "an http feed is rejected")
    public_ok = follow_req.host_is_public("one.one.one.one", lambda host: ["1.1.1.1"])
    loopback = follow_req.host_is_public("local.test", lambda host: ["127.0.0.1"])
    private_net = follow_req.host_is_public("lan.test", lambda host: ["10.1.2.3"])
    link_local = follow_req.host_is_public("meta.test", lambda host: ["169.254.169.254"])
    check(public_ok and not loopback and not private_net and not link_local, "only public addresses can be fetched")

    def fake_follow_fetch(url):
        if "fxtwitter.com/nasa" in url:
            return 200, '{"user":"nasa"}'
        if "youtube.com/@" in url:
            return 200, 'href="https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw"'
        if "videos.xml" in url:
            return 200, "<feed></feed>"
        if "example.com" in url:
            return 200, "<rss><channel></channel></rss>"
        return 404, ""

    public_resolve = lambda host: ["1.1.1.1"]
    confirmed_yt = follow_req.confirm_source(dict(yt_spec), fake_follow_fetch, public_resolve)
    check(confirmed_yt["channelId"] == "UCXuqSBlHAE6Xw-yeJA0Tunw", "a youtube page supplies the channel id")
    follow_config = {"feeds": []}
    added, follow_config = follow_req.run("owner-account", "owner-account", "Follow request: x nasa", "### Account\n\nnasa\n\n### Platform\n\nx\n", follow_config, fake_follow_fetch, public_resolve)
    added_row = follow_config["feeds"][0]
    check(added.startswith("Added x:nasa") and added_row["adapter"] == "fxtwitter" and added_row["fallbacks"][0]["adapter"] == "nitter_rss", "a follow adds the fxtwitter source and nitter fallbacks")
    duplicate_rejected = False
    try:
        follow_req.run("owner-account", "owner-account", "Follow request: x nasa", "### Account\n\nnasa\n\n### Platform\n\nx\n", follow_config, fake_follow_fetch, public_resolve)
    except follow_req.Reject:
        duplicate_rejected = True
    check(duplicate_rejected, "a duplicate follow is rejected")
    removed, follow_config = follow_req.run("owner-account", "owner-account", "Unfollow request: x nasa", "### Account\n\nx:nasa\n\n### Platform\n\nx\n", follow_config, fake_follow_fetch, public_resolve)
    check(removed.startswith("Removed x:nasa") and follow_config["feeds"] == [], "an unfollow removes the account")
    untouched = {"feeds": [{"id": "x:keep"}]}
    ignored, same_config = follow_req.run("someone", "owner-account", "Follow request: x nasa", "### Account\n\nnasa\n\n### Platform\n\nx\n", untouched, fake_follow_fetch, public_resolve)
    check(ignored == "" and same_config["feeds"] == [{"id": "x:keep"}], "an issue from anyone else is ignored")
    group_body = "### Groups\n\n" + json.dumps([{"id": "grp_news", "name": "News", "icon": "https://example.com/a.png", "members": ["youtube:Someone"]}])
    saved, grouped = follow_req.run("owner-account", "owner-account", "Subscription groups", group_body, {"feeds": [{"id": "x:keep"}]}, fake_follow_fetch, public_resolve)
    check(saved == "Saved 1 subscription groups." and grouped["feeds"] == [{"id": "x:keep"}] and grouped["groups"][0]["id"] == "grp_news" and grouped["groups"][0]["members"] == ["youtube:Someone"], "the owner can publish subscription groups without touching feeds")
    stranger_groups, stranger_config = follow_req.run("someone", "owner-account", "Subscription groups", group_body, {"feeds": [{"id": "x:keep"}]}, fake_follow_fetch, public_resolve)
    check(stranger_groups == "" and "groups" not in stranger_config, "a groups issue from anyone else is ignored")
    private_icon = False
    try:
        follow_req.clean_groups([{"id": "grp_a", "name": "A", "icon": "https://local.test/a.png", "members": []}], lambda host: ["127.0.0.1"])
    except follow_req.Reject:
        private_icon = True
    check(private_icon, "a private group icon is rejected")
    script_icon = False
    try:
        follow_req.clean_groups([{"id": "grp_a", "name": "A", "icon": "javascript:alert(1)", "members": []}], public_resolve)
    except follow_req.Reject:
        script_icon = True
    check(script_icon, "a javascript group icon is rejected")
    check(follow_req.clean_groups("[]", public_resolve) == [], "an empty group list clears site groups")
    import sync_health

    clock = {}
    sync_health.record_source(clock, "vk:vk", False, "2026-10-21T06:00:00Z", "no source")
    sync_health.record_source(clock, "vk:vk", False, "2026-10-21T07:00:00Z", "no source")
    check(clock["vk:vk"]["emptySince"] == "2026-10-21T06:00:00Z", "an empty source starts the clock once")
    sync_health.record_source(clock, "vk:vk", True, "2026-10-21T08:00:00Z")
    check(clock["vk:vk"].get("ok") == "2026-10-21T08:00:00Z" and "emptySince" not in clock["vk:vk"], "posts from a source clear the empty clock")
    quiet = {"feeds": [{"id": "x:redacted_handle", "emptySince": "", "ok": "2026-10-21T11:00:00Z"}, {"id": "vk:vk", "emptySince": "2026-10-21T06:00:00Z", "detail": "no source"}]}
    check(sync_health.problems(quiet, "2026-10-21T11:00:00Z") == [], "five hours of nothing does not alert, and a quiet account that still returns posts is healthy")
    stale = sync_health.problems(quiet, "2026-10-21T12:00:00Z")
    check(len(stale) == 1 and stale[0].startswith("vk:vk has returned nothing since 2026-10-21T06:00:00Z"), "six hours of nothing is a sync problem")
    check(sync_health.problems(None, "2026-10-21T12:00:00Z", "failure", "skipped") == ["The sync failed."], "a failed sync opens a problem without a report")
    check(sync_health.problems({"feeds": []}, "2026-10-21T12:00:00Z", "success", "failure") == ["The Pages deploy failed."], "a failed Pages deploy is a sync problem")
    same_body = sync_health.body_for(stale, "https://example.test/1")
    check(sync_health.plan([], [])["action"] == "none", "a healthy sync with no issue does nothing")
    check(sync_health.plan([], [{"number": 7, "title": "Sync problem", "body": same_body}])["action"] == "close", "a healthy sync closes the open problem")
    check(sync_health.plan(stale, [])["action"] == "open", "the first problem opens one issue")
    check(sync_health.plan(stale, [{"number": 7, "title": "Sync problem", "body": same_body}])["action"] == "none", "the same problem does not edit the issue")
    check(sync_health.plan(stale, [{"number": 7, "title": "Sync problem", "body": "The sync is not healthy.\n\n- something else\n"}])["action"] == "edit", "a changed problem edits the same issue")
    check(sync_health.plan(stale, [{"number": 3, "title": "Follow request: x nasa", "body": ""}])["action"] == "open", "a follow request is not the sync problem issue")
    workflow_text = (ROOT / ".github" / "workflows" / "sync.yml").read_text(encoding="utf-8")
    check("name: sync-report" in workflow_text and "TITLE = \"Sync problem\"" in (ROOT / "scripts" / "sync_health.py").read_text(encoding="utf-8") and "needs: [gate, build, deploy]" in workflow_text, "the sync uploads a report and keeps one problem issue")
    check("function autoplayAllowed(" in app and "prefers-reduced-motion" in app and "saveData" in app and "are not Never" in app and "threshold: [0, 0.6, 1]" in app and "playsinline" in app and "autoplay=1&mute=1&playsinline=1&controls=0" in app and 'preload = "none"' in app and "STATE.sound" in app and "strict-origin-when-cross-origin" in app and "function scheduleIdleReload(" in app and 'box.id = "autoplay-debug"' in app and "function xRefresh(" in app and "onReady" in app and "reload-armed" in app, "one in-view video previews muted, a miss is explained, and an update reloads when idle")
    check('cache: "reload"' in worker and "skipWaiting" in worker and "clients.claim" in worker and "function isShell(" in worker and "reload-when-idle" in worker, "a new service worker activates and loads the shell from the network")
    check("function posterList(" in app and "data-falls" in app and "onStateChange" in app and "enablejsapi=1" in app and "ratio >= 0.6" in app and "i.ytimg.com/vi/" in app, "a video keeps a real thumbnail until playback and starts muted at about 60 percent visible")
    check('data-preview="subs"' in app and 'index, "feed"' in app and ".vmute" in css and ".vleft" in css and "function vkRefresh(" in app, "feed cards show mute and remaining time, and a dead file is resolved again")
    check("function followedFeeds()" in app and "LIVE_REFRESH_MS = 2 * 60 * 1000" in app and "function livePostsForFeed(" in app and "/community" in app and "feeds.config.json" in app, "near-live refresh walks every followed feed")
    follow_fn = app[app.index("function followedFeeds()"):app.index("function followedFeeds()") + 500]
    check("redacted_handle" not in follow_fn and "redacted_handle" not in follow_fn and "redacted_handle" not in follow_fn, "live refresh has no per-account special case")
    check("return !isSelfReply(post);" in app and "replyParent" in app and "pill-faces" in css and "reply-context" in css, "home shows replies to other people and the new-posts pill can show avatars")
    config_text = (ROOT / "feeds.config.json").read_text(encoding="utf-8")
    community_src = (ROOT / "scripts" / "adapters" / "youtube_community.py").read_text(encoding="utf-8")
    check("rsshub.rssforever.com" not in config_text and "rsshub.pseudoyu.com" not in config_text and "hub.slarker.me" not in config_text, "public RSSHub mirrors are not feed sources")
    check('"id": "vk:vk"' in config_text and '"platform": "vk"' in config_text, "the official VK community is a configured follow")
    from adapters.vk import parse as parse_vk
    from adapters.vk import parse_comments as parse_vk_comments
    from vk_remote import parse_web_client

    vk_doc = parse_vk(json.loads((FIX / "vk_wall_vk.json").read_text(encoding="utf-8")), {"id": "vk:vk", "platform": "vk", "handle": "vk"})
    check(len(vk_doc["posts"]) == 3, "vk wall keeps the text post, the video, and the repost")
    vk_text_post = vk_doc["posts"][0]
    check("запись в блоге" in vk_text_post["text"] and "away.php" not in vk_text_post["text"] and vk_text_post["media"][0]["url"].endswith("vk-large.jpg"), "vk markup becomes the label and the largest photo")
    check(vk_text_post["url"] == "https://vk.com/wall-22822305_1730797" and vk_text_post["stats"]["replies"] == 12, "vk post links to the wall and keeps the comment count")
    vk_video = vk_doc["posts"][1]
    check(vk_video["media"][0]["type"] == "video" and vk_video["media"][0]["poster"].endswith("vk-video.jpg") and vk_video["media"][0]["open"].startswith("https://vk.com/video"), "vk video keeps a poster and the watch page")
    vk_repost = vk_doc["posts"][2]
    check(vk_repost["kind"] == "repost" and vk_repost["handle"] == "team" and vk_repost["repostedBy"]["handle"] == "vk" and "Исходная" in vk_repost["text"], "vk repost credits the community and shows the original")
    check(vk_doc["profiles"][0]["name"] == "ВКонтакте" and vk_doc["profiles"][0]["followers"] == 14000000 and vk_doc["profiles"][0]["url"] == "https://vk.com/vk" and vk_doc["profiles"][0]["verifiedType"] == "business", "vk profile comes from the community")
    vk_comments = parse_vk_comments(
        {"response": {"count": 1, "items": [{"id": 9, "from_id": 5, "owner_id": -22822305, "post_id": 1730797, "date": 1792307000, "text": "Привет", "likes": {"count": 3}, "thread": {"count": 0, "items": []}}], "profiles": [{"id": 5, "first_name": "Аня", "last_name": "Иванова", "screen_name": "anya"}]}},
        {"statusId": "-22822305_1730797", "handle": "vk"},
    )
    check(len(vk_comments) == 1 and vk_comments[0]["text"] == "Привет" and vk_comments[0]["handle"] == "anya" and vk_comments[0]["replyingTo"]["id"] == "-22822305_1730797", "vk comments keep the author and the parent")
    vk_client = parse_web_client('{clientSecret:L,clientId:R,authClientId:D}=(j=111,P="publicsecretvalue1",O=1);mG:"5.289"')
    check(vk_client == ("111", "publicsecretvalue1", "5.289"), "the public web bundle yields the anonymous client")
    check("6287487" not in (ROOT / "scripts" / "vk_remote.py").read_text(encoding="utf-8"), "vk client credentials are parsed from vk.com, not copied into the repo")
    check("loadVkSaved" in app and "Watch on VK" in app and "seenFeeds" in app and 'platform === "vk"' in app, "vk profiles use the synced wall and a new follow is picked up once")
    check("RSSHUB_MIRRORS" not in community_src and "rssforever" not in community_src, "community posts use the local RSSHub container")
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    check("fallback/" in ignore and "status.json" in ignore, "generated fallback files stay out of git")

    from datetime import datetime as dt
    from own_fetch import (
        extract_watch,
        next_page_token,
        parse_ig_oembed,
        parse_innertube_comments,
        parse_syndication,
        parse_thread_renderers,
        reply_continuations,
        select_community,
        select_recent,
        _community_token,
        _header_count,
        _safe_name,
    )
    from health import build_status, piped_payload_ok

    synd = parse_syndication(json.loads((FIX / "own" / "syndication.json").read_text(encoding="utf-8")))
    check(synd["handle"] == "redacted_handle" and synd["stats"]["likes"] == 48280 and synd["stats"]["replies"] == 5558 and synd["replies"] == [] and "Bach" in synd["text"], "x syndication keeps the post and does not invent replies")
    moment = dt(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
    comments = parse_innertube_comments(json.loads((FIX / "own" / "innertube_comments.json").read_text(encoding="utf-8")), {"statusId": "xtrFOsncOeo", "handle": "redacted_handle"}, moment)
    check(len(comments) == 1 and comments[0]["text"] == "This is a public comment." and comments[0]["stats"]["likes"] == 276 and comments[0]["date"] == "2026-10-20T21:00:00Z", "youtube innertube comments keep text, likes, and a real time")
    check(comments[0]["replies"][0]["text"] == "A reply under it." and comments[0]["replies"][0]["date"] == "2026-10-21T11:57:00Z", "a youtube reply stays under its parent")
    watch = extract_watch((FIX / "own" / "watch_snippet.html").read_text(encoding="utf-8"))
    check(watch["key"] == "AIzaSyTESTKEY" and watch["token"] == "Eg0S_TEST_TOKEN" and watch["version"] == "2.20251021.00.00", "the watch page yields the public innertube key and comment token")
    panel = base64.urlsafe_b64encode(b"\x12\x01engagement-panel-comments-section").decode().rstrip("=")
    section = base64.urlsafe_b64encode(b"\x12\x01comments-section").decode().rstrip("=")
    modern = (
        '<html><script>"panelIdentifier":"engagement-panel-comments-section"'
        + (" " * 8000)
        + '"continuationCommand":{"token":"' + section + '%3D"}'
        + '"continuationCommand":{"token":"' + panel + '"}</script></html>'
    )
    modern_watch = extract_watch(modern)
    check(modern_watch["token"] == panel, "a comments-panel token is used when the page omits the request field")
    classic = {
        "onResponseReceivedEndpoints": [
            {
                "reloadContinuationItemsCommand": {
                    "continuationItems": [
                        {
                            "commentThreadRenderer": {
                                "comment": {
                                    "commentRenderer": {
                                        "commentId": "Ugclassic",
                                        "contentText": {"runs": [{"text": "Classic thread text."}]},
                                        "authorText": {"simpleText": "@Cara"},
                                        "likeCount": 3,
                                        "replyCount": 2,
                                        "publishedTimeText": {"runs": [{"text": "1 hour ago"}]},
                                        "authorThumbnail": {"thumbnails": [{"url": "https://yt3.ggpht.com/a=s88"}]},
                                    }
                                },
                                "replies": {
                                    "commentRepliesRenderer": {
                                        "contents": [
                                            {
                                                "commentRenderer": {
                                                    "commentId": "Ugchild",
                                                    "contentText": {"simpleText": "Inline child."},
                                                    "authorText": {"simpleText": "Dan"},
                                                    "publishedTimeText": {"simpleText": "5 minutes ago"},
                                                }
                                            },
                                            {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "REPLYTOKEN"}}}},
                                        ]
                                    }
                                },
                            }
                        },
                        {"continuationItemRenderer": {"continuationEndpoint": {"continuationCommand": {"token": "PAGETOKEN", "request": "CONTINUATION_REQUEST_TYPE_WATCH_NEXT"}}}},
                    ]
                }
            }
        ]
    }
    classic_rows = parse_thread_renderers(classic, {"statusId": "videoid", "handle": "redacted_handle"}, moment)
    check(
        len(classic_rows) == 1
        and classic_rows[0]["text"] == "Classic thread text."
        and classic_rows[0]["handle"] == "Cara"
        and classic_rows[0]["stats"]["likes"] == 3
        and classic_rows[0]["date"] == "2026-10-21T11:00:00Z"
        and classic_rows[0]["replies"][0]["text"] == "Inline child."
        and classic_rows[0]["replies"][0]["replyingTo"]["id"] == "Ugclassic",
        "older innertube threads keep the comment and its inline reply",
    )
    check(reply_continuations(classic) == {"Ugclassic": "REPLYTOKEN"} and next_page_token(classic) == "PAGETOKEN", "reply and next-page tokens stay on the public continuation")
    siblings = parse_innertube_comments(
        {
            "frameworkUpdates": {
                "entityBatchUpdate": {
                    "mutations": [
                        {"payload": {"commentEntityPayload": {"properties": {"commentId": "a", "content": {"content": "one"}, "replyLevel": 1}, "author": {"displayName": "A"}, "toolbar": {}}}},
                        {"payload": {"commentEntityPayload": {"properties": {"commentId": "b", "content": {"content": "two"}, "replyLevel": 1}, "author": {"displayName": "B"}, "toolbar": {}}}},
                    ]
                }
            }
        },
        {"statusId": "parent"},
        as_siblings=True,
    )
    check(len(siblings) == 2 and siblings[0]["id"] == "a" and siblings[1]["id"] == "b" and "replies" not in siblings[0], "a reply page lists each reply on its own")
    from adapters.youtube_community import posts_tab

    home_params = base64.urlsafe_b64encode(b"\x12\x04home").decode().rstrip("=")
    posts_params = base64.urlsafe_b64encode(b"\x12\x05posts").decode().rstrip("=")
    tab_html = (
        '{"browseEndpoint":{"browseId":"UChomechannelidxxxxxx","params":"'
        + home_params
        + '"}}{"browseEndpoint":{"browseId":"UCpostchannelidxxxxxx","params":"'
        + posts_params
        + '"}}'
    )
    tab = posts_tab(tab_html)
    check(tab[0] == "UCpostchannelidxxxxxx" and tab[1] == posts_params, "the posts tab is the browse endpoint whose params name posts")
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
    community_picked = select_community(
        [
            {"id": "oldc", "platform": "youtube", "kind": "community", "date": "2026-03-01T00:00:00Z"},
            {"id": "newc", "platform": "youtube", "kind": "community", "date": "2026-10-20T00:00:00Z"},
            {"id": "video", "platform": "youtube", "date": "2026-10-20T00:00:00Z"},
        ],
        moment,
    )
    check([post["id"] for post in community_picked] == ["newc"], "a community post from the last 14 days is fetched on its own")
    stale_posts = [
        {"id": "c%d" % index, "platform": "youtube", "kind": "community", "date": "2026-01-%02dT00:00:00Z" % (index + 1)}
        for index in range(7)
    ]
    stale_ids = [post["id"] for post in select_community(stale_posts, moment)]
    check(stale_ids == ["c6", "c5", "c4", "c3", "c2", "c1"] and "c0" not in stale_ids, "when nothing is recent, the newest community posts still in the feed are fetched")
    check(_safe_name({"platform": "youtube", "kind": "community", "id": "Ugabc"}) == "ytpost_Ugabc.json" and _safe_name({"platform": "youtube", "id": "abcdefghijk"}) == "yt_abcdefghijk.json", "community comment files use the ytpost_ prefix")
    with_request = '"continuationCommand":{"token":"4qmFabc%3D","request":"CONTINUATION_REQUEST_TYPE_BROWSE"},"apiUrl":"/youtubei/v1/browse","targetId":"comments-section"'
    without_request = '"apiUrl":"/youtubei/v1/next","continuationCommand":{"token":"4qmFxyz"},"targetId":"comments-section"'
    named = base64.urlsafe_b64encode(b"FEcomment_post_detail").decode().rstrip("=")
    check(_community_token(with_request) == ("4qmFabc=", "browse"), "a community token with the browse request field is kept")
    check(_community_token(without_request) == ("4qmFxyz", "next"), "a community token without the request field follows the page endpoint")
    check(_community_token('"continuationCommand":{"token":"' + named + '"}')[0] == named, "a comment continuation is accepted when the section id is missing")
    check(_community_token('"continuationCommand":{"token":"Egwatch","request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"}') == ("", "browse"), "a watch-next token is not a community comment token")
    check(_header_count({"panel": {"commentsHeaderRenderer": {"commentsCount": {"runs": [{"text": "70"}]}}}}) == 70, "the community comment total comes from the header")
    check(_header_count({"commentsHeaderRenderer": {"countText": {"runs": [{"text": "1,204"}, {"text": " Comments"}]}}}) == 1204, "a comma count on the header is kept")
    status_doc = build_status(
        [
            {"id": "fxtwitter", "group": "X", "up": False, "detail": "down", "down": "fxtwitter"},
            {"id": "invidious.f5.si", "group": "YouTube", "up": True, "detail": "invidious API", "down": "https://invidious.f5.si"},
            {"id": "pipedapi.kavin.rocks", "group": "YouTube", "up": False, "detail": "down", "down": "https://pipedapi.kavin.rocks"},
        ],
        "2026-10-21T12:00:00Z",
    )
    check(status_doc["down"] == ["fxtwitter", "https://pipedapi.kavin.rocks"] and status_doc["sources"][1]["up"] is True, "status.json lists dead browser hosts and leaves live ones in rotation")
    check(piped_payload_ok(200, '[{"url":"/watch?v=abc"}]') and piped_payload_ok(200, '{"name":"Linus"}') and not piped_payload_ok(200, "<html>") and not piped_payload_ok(404, '{"name":"x"}'), "a piped host that returns a json list stays in rotation")

    def png_size(path: Path):
        data = path.read_bytes()
        check(data.startswith(b"\x89PNG\r\n\x1a\n"), path.name + " is a png")
        return struct.unpack(">II", data[16:24])

    check(png_size(ROOT / "icons" / "icon-192.png") == (192, 192), "the 192 icon is 192 pixels")
    check(png_size(ROOT / "icons" / "icon-512.png") == (512, 512), "the 512 icon is 512 pixels")
    check(png_size(ROOT / "icons" / "icon-maskable-512.png") == (512, 512), "the maskable icon is 512 pixels")
    check(png_size(ROOT / "icons" / "icon-monochrome-512.png") == (512, 512), "the monochrome icon is 512 pixels")
    check(png_size(ROOT / "icons" / "apple-touch-icon.png") == (180, 180), "the apple touch icon is 180 pixels")
    check(png_size(ROOT / "screenshots" / "narrow.png") == (1080, 1920), "the narrow screenshot is a phone frame")
    check(png_size(ROOT / "screenshots" / "wide.png") == (1920, 1080), "the wide screenshot is a desktop frame")
    check((ROOT / "scripts" / "pwa_assets.py").read_text(encoding="utf-8").find("M18.244") < 0, "the install mark is not the X logo")
    check("M18.244" not in (ROOT / "app.js").read_text(encoding="utf-8") and "M18.244" not in (ROOT / "favicon.svg").read_text(encoding="utf-8") and 'icon("logo")' not in (ROOT / "app.js").read_text(encoding="utf-8"), "the X logo is not in the app chrome or the favicon")
    check("M12 2.2l1.7 5.4" in (ROOT / "favicon.svg").read_text(encoding="utf-8") and "function sourceBadge(" in (ROOT / "app.js").read_text(encoding="utf-8"), "the favicon uses the Feeds icon and posts keep their source badges")

    from adapters.common import html_to_parts, is_playable_video
    from video_media import _one, extract_video, probe

    stand = html_to_parts('<video poster=""><source src="https://www.instagram.com/p/AbCdEf/media?size=l"></video>')
    check(stand["media"][0]["type"] == "video" and stand["media"][0]["url"] == "" and "media?size=l" in stand["media"][0]["poster"] and not is_playable_video(stand["media"][0]["poster"]), "an instagram image redirect is not stored as the video file")
    real = html_to_parts('<video poster="https://cdn.example/p.jpg"><source src="https://cdn.example/clip.mp4"></video>')
    check(real["media"][0]["url"] == "https://cdn.example/clip.mp4" and real["media"][0]["poster"].endswith("p.jpg"), "a real mp4 stays the video url")
    found = extract_video('{"video_url":"https://cdn.example/clip.mp4","display_url":"https://cdn.example/p.jpg","video_duration":"12"}')
    check(found["url"].endswith("clip.mp4") and found["poster"].endswith("p.jpg") and found["duration"] == 12, "extract_video reads the file, poster, and duration")
    blocked, why = probe("https://www.instagram.com/p/AbCdEf/media?size=l")
    check(blocked is False and why == "not a video file", "a range probe rejects an image stand-in")
    yt_item = {"type": "video", "url": "https://www.youtube-nocookie.com/embed/abcdefghijk", "stream": "https://invidious.example/latest_version?id=abcdefghijk&itag=18"}
    yt_ok, yt_row = _one({"platform": "youtube", "id": "abcdefghijk"}, yt_item)
    check(yt_ok and yt_row is None and "stream" not in yt_item, "youtube playback is resolved in the player, not one baked stream")
    ig_item = {"type": "video", "url": "https://www.instagram.com/p/AbCdEf/media?size=l"}
    ig_ok, ig_row = _one({"platform": "rss", "id": "ig-stand-in"}, ig_item)
    check(ig_ok is False and ig_item["url"] == "" and "media?size=l" in ig_item["poster"] and ig_row["detail"] == "image stand-in", "a stand-in url is cleared and reported")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    check("Watch on Instagram" in app and "function youtubeSources" in app and "function startPlayback" in app and 'toast("Video unavailable")' not in app and "hls.min.js" in app, "the player rotates sources and does not toast video unavailable")
    check("latest_version" not in (ROOT / "scripts" / "yt_remote.py").read_text(encoding="utf-8"), "sync does not bake an invidious itag url")
    from adapters.common import lock_publish_time, publish_date_from_html, relative_label

    check(relative_label("0 seconds ago") and relative_label("1 day ago") and relative_label("Streamed 1 week ago") and relative_label("Premiered 3 hours ago") and relative_label("2d ago") and not relative_label("2026-10-11T00:00:00Z"), "relative publish labels are recognized")
    restamped = {"id": "yt:video:Iuvm-HKIMg8", "platform": "youtube", "kind": "post", "date": "2026-10-21T13:35:36Z", "url": "https://www.youtube.com/watch?v=Iuvm-HKIMg8"}
    lock_publish_time({"id": "Iuvm-HKIMg8", "date": "2026-10-11T00:00:00Z"}, restamped)
    check(restamped["id"] == "Iuvm-HKIMg8" and restamped["statusId"] == "Iuvm-HKIMg8" and restamped["date"] == "2026-10-11T00:00:00Z", "a later sync cannot move a video's publish time forward")
    community_row = {"id": "UgkxwgD1SpZbB0jjdvLVVQ1kDUAUojU3kyah", "platform": "youtube", "kind": "community", "date": "2026-03-15T17:37:27-07:00"}
    lock_publish_time({"id": community_row["id"], "date": "2026-03-21T00:41:24Z"}, community_row)
    kept = datetime.fromisoformat(community_row["date"])
    if kept.tzinfo is None:
        kept = kept.replace(tzinfo=timezone.utc)
    check(kept < datetime.fromisoformat("2026-03-16T01:00:00+00:00"), "the earlier community publish time replaces a drifted sync stamp")
    kept_x = {"id": "123", "platform": "x", "kind": "post", "date": ""}
    lock_publish_time({"id": "123", "date": "2026-01-02T00:00:00Z"}, kept_x)
    check(kept_x["date"] == "2026-01-02T00:00:00Z" and kept_x["id"] == "123", "an empty new date keeps the stored time")
    exact = publish_date_from_html('{"publishDate":"2026-03-15T17:37:27.463301-07:00"}')
    day = publish_date_from_html('{"publishDate":{"simpleText":"Oct 11, 2026"}}')
    check(exact == "2026-03-16T00:37:27.000Z" and day == "2026-10-11T00:00:00.000Z", "watch and community pages yield the real publish date")
    check("function canonicalPostId(" in app and "function relativeLabel(" in app and "seenPostIds" in app and "seen-ids" in worker and "def lock_publish_time(" in (ROOT / "scripts" / "adapters" / "common.py").read_text(encoding="utf-8"), "publish times stay on the original post and new posts are unseen ids")

    import subprocess

    import people

    people_src = (ROOT / "scripts" / "people.py").read_text(encoding="utf-8")
    check("api.x.com" not in people_src and "api.twitter.com" not in people_src and "api.fxtwitter.com" in people_src, "people sync uses fxtwitter and never the X API")
    check((ROOT / ".github" / "ISSUE_TEMPLATE" / "link-accounts.yml").is_file(), "the link-accounts issue form exists")
    site_config = json.loads((ROOT / "feeds.config.json").read_text(encoding="utf-8"))
    people.validate_config(site_config)
    prepper = next(person for person in site_config["people"] if person["id"] == "canadian-prepper")
    prepper_accounts = {(account["platform"], account["handle"]) for account in prepper["accounts"]}
    check(("youtube", "redacted_handle") in prepper_accounts and ("x", "redacted_handle") in prepper_accounts and ("instagram", "redacted_handle") in prepper_accounts, "Canadian Prepper links the verified YouTube, X, and Instagram accounts")
    check(any(account.get("channelId") == "UCfgtuaUadGgOA-91geQ8Qog" for account in prepper["accounts"]), "the YouTube account keeps the channel id")
    x_source = next(account["source"] for account in prepper["accounts"] if account["platform"] == "x")
    ig_source = next(account["source"] for account in prepper["accounts"] if account["platform"] == "instagram")
    check("canadianpreparedness.com" in x_source and "twitter.com/redacted_handle" in x_source, "the X handle is sourced from the website")
    check("youtube.com/@redacted_handle/about" in ig_source and "canadianpreparedness.com" in ig_source, "Instagram is sourced from the About page and the website")
    check(not any(account["platform"] in ("threads", "telegram") for account in prepper["accounts"]), "Threads and Telegram are omitted when no source lists them")
    bad_id = empty_accounts = duplicate_account = False
    try:
        people.validate_person({"id": "Bad", "name": "Nope", "accounts": [{"platform": "x", "handle": "nasa"}]})
    except people.SchemaError:
        bad_id = True
    try:
        people.validate_person({"id": "ok-person", "name": "Ok", "accounts": []})
    except people.SchemaError:
        empty_accounts = True
    try:
        people.validate_config({"people": [
            {"id": "one", "name": "One", "accounts": [{"platform": "x", "handle": "nasa"}]},
            {"id": "two", "name": "Two", "accounts": [{"platform": "x", "handle": "NASA"}]},
        ]})
    except people.SchemaError:
        duplicate_account = True
    check(bad_id and empty_accounts and duplicate_account, "people schema rejects a bad id, an empty account list, and a shared account")
    extra = people.extra_feeds(site_config)
    extra_ids = {row["id"] for row in extra}
    check("x:redacted_handle" in extra_ids and "instagram:redacted_handle" in extra_ids and "youtube:redacted_handle" not in extra_ids, "sync follows linked accounts that are not already feeds")
    check(people.extra_feeds({"feeds": [], "people": [{"id": "t", "name": "T", "accounts": [{"platform": "telegram", "handle": "prepperchannel"}]}]}) == [], "telegram is not followed until an adapter exists")

    cross_posts = [
        {"platform": "youtube", "handle": "redacted_handle", "id": "abcdefghijk", "url": "https://www.youtube.com/watch?v=abcdefghijk", "feedId": "youtube:redacted_handle"},
        {"platform": "x", "handle": "redacted_handle", "id": "1", "text": "new video", "links": [{"expanded": "https://youtu.be/abcdefghijk"}]},
        {"platform": "x", "handle": "redacted_handle", "id": "2", "text": "also the shop", "links": [{"expanded": "https://youtu.be/abcdefghijk"}, {"expanded": "https://canadianpreparedness.com/shop"}]},
        {"platform": "x", "handle": "someoneelse", "id": "3", "text": "share", "links": [{"expanded": "https://youtu.be/abcdefghijk"}]},
    ]
    cross_config = {"people": [prepper]}
    stamped = people.stamp_cross_posts(cross_posts, cross_config, fetch=False)
    check(stamped == 1 and cross_posts[1]["alsoOn"] == {"person": "canadian-prepper", "platform": "youtube", "handle": "redacted_handle", "videoId": "abcdefghijk", "url": "https://youtu.be/abcdefghijk"}, "an X post that only links the person's own video gets alsoOn")
    check("alsoOn" not in cross_posts[2] and "alsoOn" not in cross_posts[3], "a second link or a different author does not count as a cross-post")
    unknown = [{"platform": "x", "handle": "redacted_handle", "id": "4", "text": "live", "links": [{"expanded": "https://www.youtube.com/watch?v=zzzzzzzzzzz"}]}]
    stamped_live = people.stamp_cross_posts(unknown, cross_config, fetch=True, oembed=lambda url: {"author_url": "https://www.youtube.com/@redacted_handle"})
    check(stamped_live == 1 and unknown[0]["alsoOn"]["videoId"] == "zzzzzzzzzzz", "oembed author_url can confirm the person's channel")
    foreign = [{"platform": "x", "handle": "redacted_handle", "id": "5", "text": "nope", "links": [{"expanded": "https://www.youtube.com/watch?v=yyyyyyyyyyy"}]}]
    stamped_foreign = people.stamp_cross_posts(foreign, cross_config, fetch=True, oembed=lambda url: {"author_url": "https://www.youtube.com/@SomeoneElse"})
    check(stamped_foreign == 0 and "alsoOn" not in foreign[0], "a different YouTube author is not alsoOn")

    suggest_profiles = [
        {"platform": "x", "handle": "lefty", "name": "Left", "bio": "see https://www.youtube.com/@righty", "avatar": "https://example.com/a.jpg"},
        {"platform": "youtube", "handle": "righty", "name": "Right", "bio": "https://x.com/lefty", "avatar": "https://example.com/b.jpg"},
        {"platform": "instagram", "handle": "oneway", "name": "One", "bio": "https://x.com/lefty", "avatar": "https://example.com/c.jpg"},
        {"platform": "threads", "handle": "samename", "name": "Same Person", "avatar": "https://cdn.example/face.jpg?s=1"},
        {"platform": "vk", "handle": "samename", "name": "Same Person", "avatar": "https://cdn.example/face.jpg"},
        {"platform": "x", "handle": "nameonly", "name": "Same Person", "avatar": "https://cdn.example/other.jpg"},
    ]

    def suggestion_pair(rows, left, right):
        for row in rows:
            handles = {(account["platform"], account["handle"]) for account in row["accounts"]}
            if left in handles and right in handles:
                return row
        return None

    suggestions = people.suggest(suggest_profiles, [])
    mutual = suggestion_pair(suggestions, ("x", "lefty"), ("youtube", "righty"))
    same_face = suggestion_pair(suggestions, ("threads", "samename"), ("vk", "samename"))
    check(mutual and "bio links point at each other" in mutual["reasons"], "bios that point at each other are suggested")
    check(suggestion_pair(suggestions, ("instagram", "oneway"), ("x", "lefty")) is None, "a one-way bio link is not a suggestion")
    check(same_face and "same name and avatar" in same_face["reasons"], "the same name and avatar on two platforms is a suggestion")
    check(suggestion_pair(suggestions, ("x", "nameonly"), ("vk", "samename")) is None, "the same name with a different avatar is not a suggestion")
    linked_people = [{"id": "p", "name": "P", "accounts": [{"platform": "x", "handle": "lefty"}]}]
    linked_before = json.dumps(linked_people)
    linked_suggestions = people.suggest(suggest_profiles, linked_people)
    check(suggestion_pair(linked_suggestions, ("x", "lefty"), ("youtube", "righty")) is None and json.dumps(linked_people) == linked_before, "suggestions never merge or rewrite people")

    link_body = "### Person\n\nCanadian Prepper\n\n### Accounts\n\nx:nasa\n"
    link_config = {"feeds": [{"id": "x:keep"}], "people": json.loads(json.dumps(site_config["people"]))}
    linked_msg, linked_config = follow_req.run("owner-account", "owner-account", "Link accounts: Canadian Prepper", link_body, link_config, fake_follow_fetch, public_resolve)
    linked_person = next(person for person in linked_config["people"] if person["id"] == "canadian-prepper")
    check(linked_msg.startswith("Linked x:nasa") and any(account["platform"] == "x" and account["handle"] == "nasa" for account in linked_person["accounts"]) and linked_config["feeds"] == [{"id": "x:keep"}], "the owner can link a confirmed account without adding a feed")
    stranger_link, stranger_people = follow_req.run("someone", "owner-account", "Link accounts: Canadian Prepper", link_body, {"feeds": [{"id": "x:keep"}], "people": []}, fake_follow_fetch, public_resolve)
    check(stranger_link == "" and stranger_people == {"feeds": [{"id": "x:keep"}], "people": []}, "a link issue from anyone else is ignored")
    owned_config = {"people": [
        {"id": "canadian-prepper", "name": "Canadian Prepper", "accounts": [{"platform": "youtube", "handle": "redacted_handle"}]},
        {"id": "other", "name": "Other", "accounts": [{"platform": "x", "handle": "nasa"}]},
    ]}
    owned_rejected = False
    try:
        follow_req.run("owner-account", "owner-account", "Link accounts: Canadian Prepper", link_body, owned_config, fake_follow_fetch, public_resolve)
    except follow_req.Reject:
        owned_rejected = True
    check(owned_rejected, "an account already linked to another person is rejected")

    def telegram_fetch(url):
        if "t.me/" in url:
            return 200, '<div class="tgme_page_title">Prepper</div>'
        return fake_follow_fetch(url)

    telegram_body = "### Person\n\nCanadian Prepper\n\n### Accounts\n\ntelegram:prepperchannel\n"
    telegram_config = {"people": [{"id": "canadian-prepper", "name": "Canadian Prepper", "accounts": [{"platform": "youtube", "handle": "redacted_handle"}]}]}
    telegram_msg, telegram_updated = follow_req.run("owner-account", "owner-account", "Link accounts: Canadian Prepper", telegram_body, telegram_config, telegram_fetch, public_resolve)
    check("telegram:prepperchannel" in telegram_msg and any(account["platform"] == "telegram" and account["handle"] == "prepperchannel" for account in telegram_updated["people"][0]["accounts"]), "a confirmed Telegram page can be linked")

    node_check = subprocess.run(
        ["node", "--input-type=module", "-e", r"""
import fs from "fs";
import vm from "vm";
const context = { console, Intl };
vm.createContext(context);
vm.runInContext(fs.readFileSync("translate.js", "utf8"), context);
const FT = context.FeedsTranslate;
const sample = "see https://vk.com/vk and @vk #вконтакте $BTC";
const shielded = FT._shield(sample);
if (!shielded.text.includes("[[0]]") || shielded.text.includes("https://")) throw new Error("shield " + shielded.text);
if (FT._restore(shielded.text, shielded.kept) !== sample) throw new Error("restore");
if (FT._offerText("This is a normal English sentence for the feed and you.", "en") !== false) throw new Error("english");
if (FT._offerText("Новая запись в блоге про ленту и рекомендации.", "en") !== true) throw new Error("russian");
if (FT._offerText("Новая запись в блоге про ленту и рекомендации.", "ru") !== false) throw new Error("same");
if (FT.normalize("EN-us") !== "en" || FT.normalize("nope") !== "en") throw new Error("normalize");
"""],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    check(node_check.returncode == 0, "translate.js shields tokens and skips text already in the target language: " + (node_check.stderr or node_check.stdout))
    discord_checks()
    print("all adapter checks passed")


def discord_checks() -> None:
    import io
    import contextlib
    import tempfile

    from adapters.discord import (
        attachment_parts,
        fetch_messages,
        invite_permissions,
        message_time,
        merge_discord,
        public_error,
        render_content,
        Client,
    )

    check(invite_permissions() == 66560, "the Discord invite is view channel plus read history")
    moment = datetime(2024, 5, 1, 15, 30, tzinfo=timezone.utc)
    ms = int(moment.timestamp() * 1000)
    snow = str((ms - 1420070400000) << 22)
    stamped = message_time({"id": snow, "edited_timestamp": "2030-01-01T00:00:00.000Z"})
    check(stamped == "2024-05-01T15:30:00.000Z", "a missing Discord timestamp comes from the snowflake, not the edit")
    edited = message_time({"id": snow, "timestamp": "2024-05-01T15:30:00.000000+00:00", "edited_timestamp": "2030-01-01T00:00:00.000Z"})
    check(edited == "2024-05-01T15:30:00.000Z", "an edit does not move the Discord publish time")

    bob = "100000000000000043"
    rendered, links, emojis = render_content(
        "Hello <@%s> **bold** <:wave:99> [site](https://example.com) ||secret|| \\*star\\* <t:1714577400:R> <#100000000000000010> <@&5>\n`**<@%s>**` hello_world _hi_"
        % (bob, bob),
        {
            "mentions": [{"id": bob, "username": "bob", "global_name": "Bob"}],
            "mention_channels": [{"id": "100000000000000010", "name": "announcements"}],
        },
    )
    check("Hello @Bob bold :wave: site secret *star*" in rendered, "discord markdown, mentions, emoji, and spoilers become plain text")
    check("May 01, 2024" in rendered and "ago" not in rendered, "a relative Discord timestamp is stored as a clock time")
    check("#announcements" in rendered and "@role" in rendered and "**<@%s>**" % bob in rendered and "hello_world hi" in rendered, "code, channel names, and snake_case stay put")
    check(emojis[0]["url"] == "https://cdn.discordapp.com/emojis/99.png" and links[0]["expanded"] == "https://example.com", "custom emoji and the labeled link are kept")
    animated, _, animated_emoji = render_content("<a:wave:99>", {})
    check(animated == ":wave:" and animated_emoji[0]["url"].endswith(".gif") and animated_emoji[0]["animated"] is True, "an animated custom emoji points at the gif")
    media, file_links = attachment_parts(
        {
            "attachments": [
                {"filename": "pic.png", "content_type": "image/png", "url": "https://cdn.discordapp.com/attachments/1/pic.png", "width": 8, "height": 4, "description": "A pic", "proxy_url": "https://media.discordapp.net/pic.png"},
                {"filename": "clip.mp4", "content_type": "video/mp4", "url": "https://cdn.discordapp.com/attachments/1/clip.mp4", "width": 640, "height": 360},
                {"filename": "notes.pdf", "content_type": "application/pdf", "url": "https://cdn.discordapp.com/attachments/1/notes.pdf"},
            ]
        }
    )
    check(media[0]["type"] == "photo" and media[0]["url"].endswith("pic.png") and "media.discordapp.net" not in media[0]["url"] and media[1]["type"] == "video" and file_links[0]["expanded"].endswith("notes.pdf"), "images and video stay on the CDN and other files are links")

    token = "super-secret-token"
    old_token = os.environ.get("DISCORD_BOT_TOKEN")
    os.environ["DISCORD_BOT_TOKEN"] = token
    try:
        check(token not in public_error(RuntimeError("bad " + token)) and "[redacted]" in public_error(RuntimeError("bad " + token)), "a Discord error does not repeat the bot token")
    finally:
        if old_token is None:
            os.environ.pop("DISCORD_BOT_TOKEN", None)
        else:
            os.environ["DISCORD_BOT_TOKEN"] = old_token

    guild = "100000000000000001"
    posts_channel = "100000000000000010"
    messages_channel = "100000000000000011"
    forbidden = "100000000000000013"
    scrape = "100000000000000014"
    parent = "100000000000000200"
    reply = "100000000000000201"
    thread_msg = "100000000000000300"
    chat_old = "100000000000000301"
    chat_new = "100000000000000302"
    cursor = "100000000000000100"
    ada = {"id": "100000000000000042", "username": "ada", "global_name": "Ada Lovelace", "avatar": "abc123"}
    bob_user = {"id": bob, "username": "bob", "global_name": "Bob", "avatar": "def456"}
    parent_message = {
        "id": parent,
        "channel_id": posts_channel,
        "type": 0,
        "content": "Hello <@%s> **bold** <:wave:99> [site](https://example.com) ||secret|| \\*star\\* <t:1714577400:R>" % bob,
        "timestamp": "2024-05-01T15:30:00.000000+00:00",
        "edited_timestamp": "2030-01-01T00:00:00.000000+00:00",
        "author": ada,
        "mentions": [bob_user],
        "attachments": [
            {"id": "1", "filename": "pic.png", "content_type": "image/png", "url": "https://cdn.discordapp.com/attachments/10/1/pic.png?ex=abcd", "width": 100, "height": 80, "description": "A pic", "proxy_url": "https://media.discordapp.net/attachments/10/1/pic.png"},
            {"id": "2", "filename": "clip.mp4", "content_type": "video/mp4", "url": "https://cdn.discordapp.com/attachments/10/2/clip.mp4", "width": 640, "height": 360},
        ],
        "embeds": [{"title": "Example", "description": "A **card**", "url": "https://example.com/post", "image": {"url": "https://cdn.discordapp.com/embed/image.png"}, "provider": {"name": "Example Site"}}],
        "reactions": [{"count": 3, "emoji": {"name": "👍"}}],
        "thread": {"id": parent, "name": "discussion", "message_count": 2},
    }
    reply_message = {
        "id": reply,
        "channel_id": posts_channel,
        "type": 19,
        "content": "a reply",
        "timestamp": "2024-05-01T16:00:00.000000+00:00",
        "author": bob_user,
        "message_reference": {"message_id": parent, "channel_id": posts_channel, "guild_id": guild},
        "referenced_message": {"id": parent, "channel_id": posts_channel, "author": ada},
    }
    join_message = {"id": "100000000000000190", "channel_id": posts_channel, "type": 7, "content": "Ada joined", "timestamp": "2024-05-01T15:00:00.000Z", "author": ada}
    thread_message = {
        "id": thread_msg,
        "channel_id": parent,
        "type": 0,
        "content": "in the thread",
        "timestamp": "2024-05-01T17:00:00.000000+00:00",
        "author": ada,
    }
    avatar = "https://cdn.discordapp.com/avatars/100000000000000042/abc123.png?size=128"
    chat = [
        {"id": chat_new, "channel_id": messages_channel, "type": 0, "content": "one " + token, "timestamp": "2024-06-01T00:00:00.000Z", "author": ada, "attachments": [{"filename": "pic.png", "content_type": "image/png", "url": "https://cdn.discordapp.com/attachments/11/9/pic.png?ex=ffff", "width": 10, "height": 12, "proxy_url": "https://media.discordapp.net/attachments/11/9/pic.png"}]},
        {"id": chat_old, "channel_id": messages_channel, "type": 0, "content": "earlier", "timestamp": "2024-05-02T00:00:00.000Z", "author": ada},
    ]

    def ok(payload, remaining="5"):
        return 200, {"X-RateLimit-Remaining": remaining}, json.dumps(payload).encode()

    calls = []

    def transport(url, headers):
        calls.append((url, dict(headers)))
        auth = headers.get("Authorization")
        if "widget.json" in url or "/invites/" in url:
            check(auth is None, "widget and invite lookups do not send the bot token")
        else:
            check(auth == "Bot " + token, "Discord requests use the bot token and not a configured one")
        check(token not in url, "the bot token is not put in the URL")
        if url.endswith("/users/@me"):
            return ok({"id": "100000000000000077", "username": "feedbot"})
        if "widget.json" in url:
            return ok({"id": guild, "name": "Widget Name", "instant_invite": "https://discord.gg/AbCdEf", "presence_count": 12})
        if "/invites/AbCdEf" in url:
            return ok({"code": "AbCdEf", "approximate_member_count": 500, "approximate_presence_count": 9, "guild": {"id": guild, "name": "Widget Name", "icon": "a1b2c3", "description": "A public server"}})
        if "/guilds/%s" % guild in url and "with_counts" in url:
            return ok({"id": guild, "name": "Guild Name", "icon": "a1b2c3", "description": "A public server", "approximate_member_count": 500, "approximate_presence_count": 12})
        if "/channels/%s/messages" % forbidden in url:
            return 403, {}, b'{"message":"Missing Access","code":50001}'
        if "/channels/%s/messages" % posts_channel in url and "after=" in url:
            check(("after=" + parent) in url, "after pages from the newest snowflake already stored")
            return ok([reply_message])
        if "/channels/%s/messages" % posts_channel in url:
            return ok([reply_message, parent_message, join_message])
        if "/channels/%s/messages" % parent in url:
            return ok([thread_message])
        if "/channels/%s/messages" % messages_channel in url:
            return ok(chat)
        return 404, {}, b"{}"

    config = {
        "cap": 300,
        "discord": [
            {
                "id": guild,
                "name": "Configured Server",
                "token": "config-secret",
                "channels": [
                    {"id": posts_channel, "name": "announcements", "mode": "posts", "limit": 20},
                    {"id": messages_channel, "name": "general", "mode": "messages", "limit": 20},
                    {"id": forbidden, "name": "secret", "mode": "posts"},
                    {"id": scrape, "name": "nope", "mode": "scrape"},
                ],
            }
        ],
    }
    previous = [{"id": "discord:%s:%s" % (posts_channel, parent), "platform": "discord", "feedId": "discord:" + guild, "date": "2030-01-01T00:00:00.000Z", "text": "stale"}]
    doc = {"posts": [{"id": "keep-x", "platform": "x", "feedId": "x:redacted_handle", "date": "2026-01-01T00:00:00.000Z", "text": "stay"}], "feeds": []}
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "discord").mkdir()
        (root / "discord" / "state.json").write_text(json.dumps({"channels": {posts_channel: cursor}}), encoding="utf-8")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            merge_discord(doc, config, root, previous, token=token, transport=transport, remote=False, now=datetime(2030, 1, 1, tzinfo=timezone.utc))
        log = buf.getvalue()
        check(token not in log and "config-secret" not in log and "bot feedbot" in log, "the sync log names the bot and not the token")
        check("not readable" in log, "a channel the bot cannot view is skipped")
        check(not any(scrape in url for url, _headers in calls), "an unknown Discord mode is not requested")
        post = next(item for item in doc["posts"] if item["id"] == "discord:%s:%s" % (posts_channel, parent))
        check(post["date"] == "2024-05-01T15:30:00.000Z" and "2030" not in post["date"], "the stored Discord date is the original timestamp")
        check(post["author"] == "Ada Lovelace" and post["handle"] == "ada" and post["avatar"] == avatar, "the post shows the Discord author")
        check("Hello @Bob bold :wave:" in post["text"] and "secret" in post["text"] and "*star*" in post["text"] and "May 01, 2024" in post["text"], "the post text is rendered")
        check(post["emojis"][0]["name"] == "wave" and post["media"][0]["type"] == "photo" and post["media"][1]["type"] == "video" and post["media"][1]["url"].endswith("clip.mp4"), "emoji, the photo, and the video are on the post")
        check(post["cards"][0]["title"] == "Example" and post["cards"][0]["description"] == "A card" and post["stats"]["likes"] == 3 and post["stats"]["replies"] == 2, "an embed is a link card and reactions are likes")
        check(post["url"] == "https://discord.com/channels/%s/%s/%s" % (guild, posts_channel, parent) and post["channelName"] == "announcements", "the permalink is the Discord message")
        nested = {item["id"]: item for item in post["replies"]}
        check("discord:%s:%s" % (posts_channel, reply) in nested and "discord:%s:%s" % (parent, thread_msg) in nested, "the reply and the thread are nested on the parent")
        check(nested["discord:%s:%s" % (posts_channel, reply)]["replyingTo"]["handle"] == "ada" and nested["discord:%s:%s" % (parent, thread_msg)]["text"] == "in the thread", "a thread message points at the starter")
        check(all(item["id"] != "discord:%s:100000000000000190" % posts_channel for item in doc["posts"]), "a join message is not a post")
        check(any(item["id"] == "keep-x" for item in doc["posts"]), "Discord merge leaves the other feeds in place")
        profile = next(item for item in doc["feeds"] if item["id"] == "discord:" + guild)
        check(profile["name"] == "Configured Server" and "a1b2c3" in profile["avatar"] and profile["followers"] == 500 and profile["online"] == 12 and profile["url"] == "https://discord.gg/AbCdEf" and profile["bio"] == "A public server" and profile["configured"] is True, "widget and invite fill the server header")
        transcript = json.loads((root / "discord" / "messages" / ("%s.json" % messages_channel)).read_text(encoding="utf-8"))
        body = json.dumps(transcript)
        check(transcript["messages"][0]["id"] == chat_new and transcript["messages"][0]["date"].startswith("2024-06-01") and transcript["fetchedAt"].startswith("2030-"), "message dates stay on the message and fetchedAt is the sync")
        check(body.count(avatar) == 1 and "proxy_url" not in body and "referenced_message" not in body and token not in body and "[redacted]" in body, "a transcript stores each author once and only CDN urls")
        check(transcript["messages"][0]["attachments"][0]["url"].startswith("https://cdn.discordapp.com/attachments/"), "transcript media stays on the Discord CDN")
        index = json.loads((root / "discord" / "index.json").read_text(encoding="utf-8"))
        modes = {item["id"]: item for item in index["servers"][0]["channels"]}
        check(modes[posts_channel]["mode"] == "posts" and modes[messages_channel]["file"] == "discord/messages/%s.json" % messages_channel and scrape not in modes, "the index lists posts and message files")
        state = json.loads((root / "discord" / "state.json").read_text(encoding="utf-8"))
        check(state["channels"][posts_channel] == reply and token not in json.dumps(state), "the next after cursor is the newest snowflake")

        skipped = {"posts": [], "feeds": []}
        earlier = [{"id": "discord:%s:%s" % (posts_channel, parent), "platform": "discord", "feedId": "discord:" + guild, "date": "2024-05-01T15:30:00.000Z", "text": "kept"}]

        def explode(_url, _headers):
            raise AssertionError("discord was called without a token")

        quiet = io.StringIO()
        with contextlib.redirect_stdout(quiet):
            merge_discord(skipped, config, root / "skip", earlier, token="", transport=explode, remote=False)
        check("DISCORD_BOT_TOKEN is not set" in quiet.getvalue() and skipped["posts"][0]["date"] == "2024-05-01T15:30:00.000Z", "a missing token skips Discord and keeps the old post")

        denied = {"posts": [], "feeds": []}

        def reject(url, headers):
            check(headers.get("Authorization") == "Bot " + token, "a rejected token was still sent as a bot token")
            return 401, {}, b'{"message":"401: Unauthorized"}'

        denied_log = io.StringIO()
        with contextlib.redirect_stdout(denied_log):
            merge_discord(denied, config, root / "denied", earlier, token=token, transport=reject, remote=False)
        check("rejected the bot token" in denied_log.getvalue() and token not in denied_log.getvalue() and denied["posts"][0]["id"].endswith(parent), "a rejected token skips Discord without printing it")

    slept = []

    def limited(url, headers):
        limited.n += 1
        check(headers["Authorization"] == "Bot " + token, "paged reads use the bot token")
        if limited.n == 1:
            return 429, {"Retry-After": "0.2"}, b'{"retry_after":0.2,"message":"You are being rate limited.","global":false}'
        if "after=" not in url:
            return 200, {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "1.25"}, b"[]"
        if "after=100" in url:
            return 200, {"X-RateLimit-Remaining": "1"}, json.dumps([
                {"id": "102", "channel_id": "10", "content": "n", "timestamp": "2024-05-01T00:00:02Z", "author": {"id": "1", "username": "a"}},
                {"id": "101", "channel_id": "10", "content": "o", "timestamp": "2024-05-01T00:00:01Z", "author": {"id": "1", "username": "a"}},
            ]).encode()
        if "after=102" in url:
            return 200, {"X-RateLimit-Remaining": "1"}, json.dumps([
                {"id": "104", "channel_id": "10", "content": "n", "timestamp": "2024-05-01T00:00:04Z", "author": {"id": "1", "username": "a"}},
                {"id": "103", "channel_id": "10", "content": "o", "timestamp": "2024-05-01T00:00:03Z", "author": {"id": "1", "username": "a"}},
            ]).encode()
        return 200, {"X-RateLimit-Remaining": "1"}, b"[]"

    limited.n = 0
    paged = Client(token, transport=limited, sleep=lambda seconds: slept.append(seconds), page_size=2)
    page_log = io.StringIO()
    with contextlib.redirect_stdout(page_log):
        found = fetch_messages(paged, "10", 4, "100")
    check([item["id"] for item in found] == ["104", "103", "102", "101"], "after pages walk forward from the cursor")
    check(slept == [0.2, 1.25], "429 and an empty rate-limit bucket are waited out")
    check(token not in page_log.getvalue(), "rate-limit logs do not include the token")

    seen_urls = []

    def paging(url, headers):
        seen_urls.append(url)
        if "after=" not in url:
            return 200, {"X-RateLimit-Remaining": "1"}, b"[]"
        if "after=100&" in url or url.endswith("after=100") or "after=100" in url and "after=102" not in url and "after=101" not in url:
            return 200, {"X-RateLimit-Remaining": "1"}, json.dumps([
                {"id": "102", "channel_id": "10"},
                {"id": "101", "channel_id": "10"},
            ]).encode()
        if "after=102" in url:
            return 200, {"X-RateLimit-Remaining": "1"}, json.dumps([
                {"id": "104", "channel_id": "10"},
                {"id": "103", "channel_id": "10"},
            ]).encode()
        return 200, {"X-RateLimit-Remaining": "1"}, b"[]"

    walker = Client(token, transport=paging, sleep=lambda _seconds: None, page_size=2)
    walked = fetch_messages(walker, "10", 4, "100")
    check([item["id"] for item in walked] == ["104", "103", "102", "101"], "the second after cursor is the newest id on the page")
    check(any("after=100" in url for url in seen_urls) and any("after=102" in url for url in seen_urls) and not any("after=101" in url for url in seen_urls), "paging follows Discord's newest-id after cursor")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "sync.yml").read_text(encoding="utf-8")
    check("DISCORD_BOT_TOKEN" in readme and "66560" in readme and "Message Content Intent" in readme and "widget.json" in readme and "Follow" in readme and "discord/messages/" in readme, "the readme documents the bot, the follow trick, and the files")
    check("DISCORD_BOT_TOKEN" in workflow and "discord/**/*.json" in readme, "the workflow receives the bot secret and the site publishes Discord json")
    check("merge_discord" in (ROOT / "scripts" / "update_feeds.py").read_text(encoding="utf-8"), "the feed sync calls Discord")
    check('"discord"' in (ROOT / "feeds.config.json").read_text(encoding="utf-8"), "feeds.config.json has a discord list")


if __name__ == "__main__":
    main()
