#!/usr/bin/env python3
"""Quick checks for every adapter. Exits non-zero on failure."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters.common import parse_json_loose  # noqa: E402
from adapters.fxtwitter import parse as parse_fx  # noqa: E402
from adapters.generic_rss import parse as parse_generic  # noqa: E402
from adapters.nitter_rss import parse as parse_nitter  # noqa: E402
from adapters.rsshub_instagram import parse as parse_ig  # noqa: E402
from adapters.rsshub_threads import parse as parse_threads  # noqa: E402
from adapters.ig_comments import parse_ig_comments  # noqa: E402
from adapters.rss_comments import parse_comment_rss  # noqa: E402
from adapters.threads_replies import parse_threads_replies  # noqa: E402
from adapters.x_api_v2 import parse as parse_x  # noqa: E402
from adapters.x_replies import _cap, parse_fxtwitter_conversation, parse_nitter_replies  # noqa: E402

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

    rss_replies = parse_comment_rss((FIX / "replies" / "comments.xml").read_text(encoding="utf-8"), {"handle": "example", "author": "Example", "id": "g1", "platform": "rss"})
    check(len(rss_replies) == 2 and all(r["kind"] == "reply" for r in rss_replies), "comment rss replies")
    check(rss_replies[0]["replyingTo"]["id"] == "g1" and rss_replies[0]["replyingTo"]["handle"] == "example", "comment rss target")

    # loose JSON header tolerance
    wrapped = "tool header\n" + (FIX / "x_api_v2_finkd.json").read_text(encoding="utf-8") + "\nX reads left: 1\n"
    check(parse_json_loose(wrapped)["data"], "loose json skips header and trailer")
    print("all adapter checks passed")


if __name__ == "__main__":
    main()
