#!/usr/bin/env python3
"""Quick checks for every adapter. Exits non-zero on failure."""

from __future__ import annotations

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
from adapters.youtube_rss import parse as parse_youtube  # noqa: E402
from yt_remote import normalize_invidious_comment  # noqa: E402
from adapters.x_replies import _cap, parse_fxtwitter_conversation, parse_nitter_replies  # noqa: E402
from meta_media import cdn_expiry, extract_cdn_urls, media_groups, needs_refresh  # noqa: E402
from x_guard import assert_not_x_api, auth_cookie_header  # noqa: E402

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

    conv = parse_fxtwitter_conversation((FIX / "replies" / "2112600761762717997.json").read_text(encoding="utf-8"), "2112600761762717997")
    likes = [((c.get("stats") or {}).get("likes") or 0) for c in conv]
    check(len(conv) >= 10, "conversation has replies")
    check(likes == sorted(likes, reverse=True), "conversation sorted by likes")
    check(conv[0]["kind"] == "reply" and conv[0]["replyingTo"]["handle"] == "redacted_handle", "conversation reply target")
    check(conv[0]["replyingTo"]["id"] == "2112600761762717997", "conversation reply parent id")
    check(conv[0]["date"].startswith("2026-10-20T"), "conversation date is ISO")
    check(conv[0]["verifiedType"] == "blue", "individual verification maps to blue")
    check(all(c["id"] != "2112600761762717997" for c in conv), "conversation skips the parent")
    capped = _cap([{"stats": {"likes": i}} for i in range(60)])
    check(len(capped) == 50 and capped[0]["stats"]["likes"] == 59, "reply cap keeps the top 50 likes")

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

    import tempfile
    from update_feeds import prune_comments

    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        (folder / "keep.json").write_text("{}", encoding="utf-8")
        (folder / "yt_keep.json").write_text("{}", encoding="utf-8")
        (folder / "gone.json").write_text("{}", encoding="utf-8")
        removed = prune_comments({"posts": [{"id": "keep", "statusId": "keep"}]}, folder)
        check(removed == 1 and (folder / "keep.json").exists() and (folder / "yt_keep.json").exists() and not (folder / "gone.json").exists(), "stale comment files are pruned")

    yt = parse_youtube((FIX / "youtube_mkbhd.xml").read_text(encoding="utf-8"), {"id": "youtube:mkbhd", "platform": "youtube", "handle": "mkbhd", "channelId": "UCBJycsmduvYEL83R_U4JriQ"})
    first = yt["posts"][0]
    check(len(yt["posts"]) == 2 and first["id"] == "scwlR0QHGOk" and first["title"].startswith("The NEW Tesla Roadster"), "youtube rss title and id")
    check(first["stats"]["views"] == 11453176 and first["stats"]["likes"] == 181847, "youtube rss views and likes")
    check(first["media"][0]["poster"] == "https://i.ytimg.com/vi/scwlR0QHGOk/hqdefault.jpg", "youtube thumbnail is hotlinked")
    check("youtube-nocookie.com/embed/scwlR0QHGOk" in first["media"][0]["url"], "youtube embed url")
    tesla = parse_youtube((FIX / "youtube_tesla.xml").read_text(encoding="utf-8"), {"id": "youtube:tesla", "platform": "youtube", "handle": "Tesla", "channelId": "UC5WjFrtBdufl6CZojX3D8dQ"})
    check(tesla["posts"][0]["title"].startswith("Zero to sixty") and tesla["profiles"][0]["name"] == "Tesla", "tesla fixture parses offline")
    comment = normalize_invidious_comment(
        {"commentId": "abc", "author": "@ada", "content": "Nice", "likeCount": 5, "published": 1792272039, "verified": True, "replies": {"replyCount": 2, "continuation": "tok"}},
        "scwlR0QHGOk",
        "mkbhd",
    )
    check(comment["text"] == "Nice" and comment["stats"]["likes"] == 5 and comment["stats"]["replies"] == 2 and comment["date"].startswith("2026-"), "invidious comment shape")
    print("all adapter checks passed")


if __name__ == "__main__":
    main()
