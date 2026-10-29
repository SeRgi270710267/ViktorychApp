#!/usr/bin/env python3
"""Golden-fixture tests for every source's conversion into the canonical post.

Runs every adapter over its fixture in scripts/fixtures, passes the result
through scripts/normalize.py, and checks that:
  - every item is valid against docs/post.schema.json (nothing is skipped),
  - a compact digest of the output matches scripts/fixtures/normalize/golden.json,
  - weird and broken inputs are repaired or skipped, never crash.
Fixtures use made-up names only.

  python3 scripts/normalize_test.py           # run
  python3 scripts/normalize_test.py --update  # rewrite golden.json after an intended change
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
FIX = HERE / "fixtures"
NFIX = FIX / "normalize"
GOLDEN = NFIX / "golden.json"
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)

FAILS: list[str] = []
QUIET = {"on": False}
PASSED = {"n": 0}


def ok(cond, label: str) -> None:
    if cond:
        PASSED["n"] += 1
        if not QUIET["on"]:
            print("ok " + label)
    else:
        print("FAIL: " + label)
        FAILS.append(label)


def _probe(url):
    return ("bad" not in url, "ok")


# adapter, fixture, feed row, payload kind
SOURCES = [
    ("x_api_v2", "x_api_v2_samplea.json", {"id": "x:copperlane", "platform": "x", "handle": "copperlane"}),
    ("x_api_v2", "x_api_v2_mosspoint.json", {"id": "x:mosspoint", "platform": "x", "handle": "mosspoint"}),
    ("fxtwitter", "fxtwitter_sample.json", {"id": "x:testuser", "platform": "x", "handle": "testuser"}),
    ("nitter_rss", "nitter_sample.xml", {"id": "x:copperlane", "platform": "x", "handle": "copperlane"}),
    ("rsshub_threads", "rsshub_threads_birchlane.xml", {"id": "threads:birchlane", "platform": "threads", "handle": "birchlane"}),
    ("rsshub_threads", "threads_atom_bridge.xml", {"id": "threads:birchlane", "platform": "threads", "handle": "birchlane"}),
    ("rsshub_instagram", "rsshub_instagram_birchlane.xml", {"id": "instagram:birchlane", "platform": "instagram", "handle": "birchlane"}),
    ("rsshub_instagram", "ig_atom_bridge.xml", {"id": "instagram:birchlane", "platform": "instagram", "handle": "birchlane"}),
    ("generic_rss", "generic_sample.xml", {"id": "rss:example", "platform": "rss", "handle": "example"}),
    ("generic_rss", "normalize/weird_atom.xml", {"id": "rss:quillmere", "platform": "rss", "handle": "quillmere"}),
    ("youtube_rss", "youtube_amberquill.xml", {"id": "youtube:amberquill", "platform": "youtube", "handle": "amberquill", "channelId": "UCsyntheticmaple00002000"}),
    ("youtube_rss", "youtube_goldthistle.xml", {"id": "youtube:goldthistle", "platform": "youtube", "handle": "Goldthistle", "channelId": "UCsyntheticmaple00004000"}),
    ("youtube_community", "youtube_community_invidious.json", {"id": "youtube:northlamp", "platform": "youtube", "handle": "northlamp", "channelId": "UCsyntheticmaple00001000"}),
    ("youtube_community", "youtube_community_initial.json", {"id": "youtube:northlamp", "platform": "youtube", "handle": "northlamp", "channelId": "UCsyntheticmaple00001000"}),
    ("vk", "vk_wall_vk.json", {"id": "vk:vk", "platform": "vk", "handle": "vk"}),
    ("telegram", "telegram_channel.html", {"id": "telegram:laneharbor", "platform": "telegram", "handle": "laneharbor", "_probe": _probe}),
    ("json_feed", "normalize/weird_feed.json", {"id": "rss:harborlight", "platform": "rss", "handle": "harborlight"}),
]


def run_source(adapter: str, fixture: str, feed: dict) -> dict:
    from adapters import ADAPTERS
    from adapters.fallbacks import parse_json_feed

    text = (FIX / fixture).read_text(encoding="utf-8")
    if adapter == "json_feed":
        return parse_json_feed(text, dict(feed))
    payload = json.loads(text) if adapter == "vk" else text
    return ADAPTERS[adapter](payload, dict(feed))


def digest(post: dict) -> dict:
    return {
        "kind": post["kind"],
        "date": post.get("date") or "",
        "media": [m["type"] for m in post.get("media") or []],
        "quoted": (post.get("quoted") or {}).get("embedded") if post.get("quoted") else None,
        "stats": sorted((post.get("stats") or {}).keys()),
        "text": hashlib.sha1((post.get("text") or "").encode("utf-8")).hexdigest()[:12],
        "cid": post["cid"],
    }


def golden_suite(update: bool) -> None:
    from normalize import check, enforce_document

    golden = json.loads(GOLDEN.read_text(encoding="utf-8")) if GOLDEN.is_file() and not update else {}
    out = {}
    for adapter, fixture, feed in SOURCES:
        label = f"{adapter} <- {fixture}"
        try:
            result = run_source(adapter, fixture, feed)
        except Exception as exc:  # an adapter crash is a failure, never a skipped test
            ok(False, f"{label}: adapter raised {type(exc).__name__}: {exc}")
            continue
        posts = [dict(p, iaSource=adapter, feedId=feed["id"]) for p in result.get("posts") or []]
        doc = {"posts": posts, "feeds": result.get("profiles") or []}
        log: list[str] = []
        summary = enforce_document(doc, None, {}, NOW, log.append)
        skipped = sum(row.get("skipped", 0) for row in summary.values())
        allowed_skips = {"normalize/weird_atom.xml": 1, "normalize/weird_feed.json": 1}.get(fixture, 0)
        ok(doc["posts"], f"{label}: produces posts")
        ok(skipped == allowed_skips, f"{label}: {skipped} skipped (expected {allowed_skips}) {log[:2]}")
        ok(all(not check(p) for p in doc["posts"]), f"{label}: every post matches the schema")
        ok(all(p.get("author") or p.get("handle") for p in doc["posts"]), f"{label}: every post has an author or handle")
        ok(all(p["platform"] == feed["platform"] for p in doc["posts"]), f"{label}: platform kept")
        key = f"{adapter}:{fixture}"
        out[key] = [digest(p) for p in doc["posts"]]
        if not update:
            ok(golden.get(key) == out[key], f"{label}: matches golden.json")
    if update:
        GOLDEN.write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        print(f"wrote {GOLDEN}")


def weird_posts_suite() -> None:
    from normalize import repair_post, repair_profile

    def fix(raw):
        return repair_post(raw, NOW)

    base = {"id": "w1", "platform": "x", "author": "Ana Example", "handle": "@ana_example", "text": "hi", "date": "2026-10-28T10:00:00Z", "url": "https://example.com/1"}
    post, why = fix(base)
    ok(post and post["handle"] == "ana_example" and post["avatar"] == "", "handle loses @, a missing avatar stays blank so the card shows initials")
    ok(post["ref"] == "x:w1" and post["cid"].startswith("c1-") and len(post["cid"]) == 35, "every post gets a ref and a content id")
    again, _ = fix(dict(base, stats={"likes": 999}))
    ok(again["cid"] == post["cid"], "content id ignores counts")
    edited, _ = fix(dict(base, text="hi!"))
    ok(edited["cid"] != post["cid"], "content id changes when the text changes")

    post, _ = fix(dict(base, stats={"likes": "1.2K", "views": "3,400", "replies": None, "reposts": -5, "quotes": "n/a", "bookmarks": True}))
    ok(post["stats"] == {"likes": 1200, "views": 3400}, "counts parse 1.2K and 3,400; unknown counts are left out (soft blank), never 0")
    post, _ = fix(dict(base, stats={"likes": None}))
    ok("stats" not in post, "all-unknown counts drop the stats object")

    post, why = fix(dict(base, text="Tom &amp;amp; Jerry &#127881; &lt;3\x00\x07 \u202bRTL\u202c"))
    ok(post["text"] == "Tom &amp; Jerry 🎉 <3 \u202bRTL\u202c", "entities decode once, emoji kept, control characters removed, RTL marks kept")
    post, why = fix(dict(base, text="<p>Hello <a href='https://example.org'>link</a><br>next</p><img src='https://cdn.example.org/a.jpg'>"))
    ok("<" not in post["text"] and post["media"] and post["media"][0]["type"] == "photo", "HTML in a plain-text field becomes text plus media")
    post, _ = fix(dict(base, text="#tag @someone https://example.org/x?a=1&b=2 مرحبا"))
    ok(post["text"] == "#tag @someone https://example.org/x?a=1&b=2 مرحبا", "mentions, hashtags, URLs and Arabic text pass through untouched")

    post, why = fix(dict(base, date="2026-10-20T13:34:32+05:30"))
    ok(post["date"] == "2026-10-20T08:04:32.000Z", "offset times convert to UTC")
    post, why = fix(dict(base, date="1761000000"))
    ok(post["date"].startswith("2025-10-20T"), "unix seconds convert")
    post, why = fix(dict(base, date="3 hours ago"))
    ok(post["date"] == "2026-10-29T09:00:00.000Z", "relative times become approximate UTC times")
    post, why = fix(dict(base, date="2027-06-01T00:00:00Z"))
    ok(post["date"] == "" and any("future" in r for r in why), "far-future dates are dropped with a reason")
    post, why = fix(dict(base, date="yesterday-ish"))
    ok(post and post["date"] == "", "unreadable dates are dropped, the post stays")

    post, why = fix(dict(base, kind="carousel"))
    ok(post["kind"] == "post", "unknown kinds show as posts")
    post, why = fix(dict(base, media=["https://cdn.example.org/v.mp4", {"url": "https://cdn.example.org/s.m3u8?x=1"}, {"url": "https://cdn.example.org/a.gif"},
                                     {"url": "https://cdn.example.org/a.mp3"}, {"type": "image", "url": "https://cdn.example.org/i"}, {"url": "javascript:alert(1)"}, 7,
                                     {"type": "video", "url": "", "poster": ""}, {"url": "//cdn.example.org/p.png"}, {"url": "https://cdn.example.org/v.mp4"}]))
    types = [m["type"] for m in post["media"]]
    ok(types == ["video", "video", "animated_gif", "audio", "image", "video", "photo"], f"media types detected by extension, known types kept, bad entries dropped, duplicates merged ({types})")
    ok(post["media"][0]["url"] == "https://cdn.example.org/v.mp4" and post["media"][1]["url"] == "https://cdn.example.org/s.m3u8?x=1", "media URLs are kept exactly (hotlinked, never rewritten)")
    ok(post["images"] == ["https://cdn.example.org/p.png"], "images mirrors the photo URLs")

    post, why = fix(dict(base, avatar="javascript:alert(1)", url="ftp://example.com/x"))
    ok(post["avatar"] == "" and post["url"] == "", "non-http avatar and URL are cleared")
    post, why = fix(dict(base, avatar="media/abc.jpg"))
    ok(post["avatar"] == "media/abc.jpg", "a stored local avatar is kept")

    post, why = fix(dict(base, poll={"options": ["Yes", {"label": "No", "votes": "12"}, {"text": ""}], "totalVotes": "1K"}))
    ok(post["poll"] == {"choices": [{"text": "Yes"}, {"text": "No", "votes": 12}], "totalVotes": 1000}, "poll options become choices")
    post, why = fix(dict(base, poll={"choices": []}))
    ok("poll" not in post, "an empty poll is dropped")
    post, why = fix(dict(base, link={"url": "notaurl", "title": "x"}))
    ok("link" not in post, "a link card without a URL is dropped")
    post, why = fix(dict(base, link={"url": "https://example.org/a", "title": "  Title\n", "image": "javascript:x"}))
    ok(post["link"] == {"url": "https://example.org/a", "title": "Title", "image": ""}, "a link card is cleaned")

    quoted = {"id": "q1", "author": "Bo Sample", "handle": "bo_sample", "text": "quoted &amp; text", "media": [{"url": "https://cdn.example.org/q.jpg"}], "stats": {"likes": "5"}}
    post, why = fix(dict(base, kind="quote", quoted=quoted))
    q = post["quoted"]
    ok(q["embedded"] is True and q["ref"] == "x:q1" and q["cid"].startswith("c1-") and q["text"] == "quoted & text" and q["stats"] == {"likes": 5}, "a quoted item is embedded fully normalized with ref and content id")
    post, why = fix(dict(base, kind="quote", quoted={"id": "q2", "url": "https://x.com/i/status/2"}))
    ok(post["quoted"]["embedded"] is False and post["quoted"]["ref"] == "x:q2" and "cid" not in post["quoted"], "a bare quoted ref is marked embedded=false so the client fetches it live")
    post, why = fix(dict(base, kind="quote", quoted="garbage"))
    ok(post["quoted"] is None and post["kind"] == "post", "an unreadable quote is dropped and the post still shows")
    post, why = fix(dict(base, kind="reply", replyingTo={"id": "77", "handle": "@bo_sample", "name": "Bo"}))
    ok(post["replyingTo"]["ref"] == "x:77" and post["replyingTo"]["embedded"] is False and post["replyingTo"]["handle"] == "bo_sample", "a replied-to stub carries its ref")
    post, why = fix(dict(base, kind="reply", replyingTo={"id": "78", "handle": "bo_sample", "author": "Bo", "text": "parent text"}))
    ok(post["replyingTo"]["embedded"] is True and post["replyingTo"]["cid"].startswith("c1-"), "an embedded parent is a referenced item too")
    post, why = fix(dict(base, repostedBy="someone"))
    ok(post["repostedBy"] is None, "a malformed repostedBy is dropped")

    post, why = fix({"url": "https://example.com/no-id", "text": "no id", "platform": "rss"})
    ok(post and post["id"].startswith("u"), "a missing id is made from the URL")
    post, why = fix({"text": "no id, no url"})
    ok(post is None, "no id and no URL is skipped")
    post, why = fix(dict(base, text="", media=[]))
    ok(post is None and "nothing to show" in why[-1], "an empty post is skipped with a reason")
    post, why = fix(dict(base, platform="Not A Platform!", url="https://www.threads.com/@x/post/1"))
    ok(post["platform"] == "threads", "a bad platform is guessed from the URL")
    post, why = fix(dict(base, author="", handle=""))
    ok(post["author"] == "X", "no author and no handle shows the platform name")
    post, why = fix(None)
    ok(post is None, "a non-object is skipped")

    profile, why = repair_profile({"platform": "x", "handle": "@ana_example", "followers": "12.5K", "following": None, "avatar": "javascript:x"})
    ok(profile["id"] == "x:ana_example" and profile["followers"] == 12500 and "following" not in profile and profile["avatar"] == "", "profiles: counts parse, unknown counts left blank (never 0), bad avatar cleared")


def fallback_suite() -> None:
    from adapters.fallbacks import meta_from_html, post_from_meta, sniff, universal
    from update_feeds import accept_feed

    meta = meta_from_html((NFIX / "og_page.html").read_text(encoding="utf-8"), "https://page.example.com/posts/77")
    ok(meta["title"] == "LD headline" and meta["text"] == "LD body text" and meta["author"] == "Ana Example", "JSON-LD wins over Open Graph and <title>")
    ok(meta["image"] == "https://page.example.com/img/ld.jpg" and meta["likes"] == 42 and meta["replies"] == 7, "JSON-LD image and interaction counts")
    only = meta_from_html((NFIX / "og_only.html").read_text(encoding="utf-8"), "https://page.example.com/")
    ok(only["title"] == "Card title" and only["image"] == "https://page.example.com/card.png" and only["url"] == "https://page.example.com/x", "Twitter card and og:url fallback")
    post = post_from_meta(meta, {"id": "rss:page", "platform": "rss", "handle": "page"})
    ok(post and post["date"] == "2026-10-23T10:00:00.000Z" and post["stats"] == {"likes": 42, "replies": 7}, "a page becomes one post")
    ok(post_from_meta({}, {}) is None and meta_from_html("") == {}, "an empty page gives nothing, no crash")

    ok(sniff((NFIX / "weird_feed.json").read_text(encoding="utf-8")) == "jsonfeed" and sniff("<html><body>Login</body></html>") == "html", "format sniffing")
    ok(universal("<html><body>Please log in</body></html>")["posts"] == [], "an HTML error page is never turned into a post")

    atom = (NFIX / "weird_atom.xml").read_text(encoding="utf-8")
    result = universal(atom, {"id": "rss:quillmere", "platform": "rss", "handle": "quillmere"})
    links = [p["url"] for p in result["posts"]]
    ok(links[:2] == ["https://news.example.org/issues/1", "https://news.example.org/issues/2"], "Atom picks rel=alternate over rel=self/replies")
    ok(result["posts"][2]["id"].startswith("h"), "an entry with no id and no link gets a stable hashed id")

    # A source that switched formats: the X bridge adapter now gets a JSON Feed.
    switched = accept_feed("rsshub_x", (NFIX / "weird_feed.json").read_text(encoding="utf-8"), {"id": "x:harborlight", "platform": "x", "handle": "harborlight"})
    ok(len(switched["posts"]) >= 2, "a feed that switched to JSON Feed is rescued by the fallback")
    try:
        accept_feed("generic_rss", (NFIX / "broken.xml").read_text(encoding="utf-8"), {"id": "rss:broken", "platform": "rss", "handle": "broken"})
        broke = False
    except Exception:
        broke = True
    ok(broke, "truncated XML still fails the fetch (the last good posts stay), it never yields junk")


def drift_suite() -> None:
    from collections import Counter

    from normalize import enforce_document, parse_health
    from sync_health import problems

    def run(clean, skipped, previous):
        row = {"items": clean + skipped, "clean": clean, "repaired": 0, "skipped": skipped, "noDate": 0, "noAuthor": 0, "reasons": Counter({"no id and no URL": skipped})}
        return parse_health({"x/fxtwitter": row}, previous, NOW)

    first = run(10, 0, {})
    ok(first["x/fxtwitter"]["rate"] == 1.0 and not first["x/fxtwitter"]["drift"], "a clean run is healthy")
    low1 = run(3, 7, first)
    ok(not low1["x/fxtwitter"]["drift"] and low1["x/fxtwitter"]["lowStreak"] == 1, "one bad run is not drift yet")
    low2 = run(3, 7, low1)
    ok(low2["x/fxtwitter"]["drift"], "two bad runs in a row are drift")
    back = run(10, 0, low2)
    ok(not back["x/fxtwitter"]["drift"], "a good run clears drift")
    tiny = run(1, 2, run(1, 2, {}))
    ok(not tiny["x/fxtwitter"]["drift"], "tiny samples never raise drift")
    kept = parse_health({}, low2, NOW)
    ok(kept == low2, "a source with no fresh items keeps its last health")
    report = {"feeds": [], "stories": [], "parse": [{"source": "x/fxtwitter", "items": 10, "rate": 0.3, "drift": True, "top": ["no id and no URL (7)"]}]}
    lines = problems(report, "2026-10-29T12:00:00Z")
    ok(any("x/fxtwitter parsed only 30%" in line for line in lines), "the sync report surfaces drift")
    doc = {"posts": [{"id": "a", "text": "x", "platform": "x", "iaSource": "fxtwitter"}, {"platform": "x", "iaSource": "fxtwitter"}]}
    summary = enforce_document(doc, {"a"}, {}, NOW, lambda line: None)
    ok(summary["x/fxtwitter"]["items"] == 1 and len(doc["posts"]) == 1, "only fresh items count toward the parse rate; invalid ones are quarantined")


def shipped_document_suite() -> None:
    from normalize import enforce_document

    root = HERE.parent
    doc = json.loads((root / "feeds.json").read_text(encoding="utf-8"))
    before = len(doc.get("posts") or [])
    log: list[str] = []
    enforce_document(doc, None, {}, NOW, log.append)
    ok(len(doc["posts"]) == before, f"the shipped feeds.json passes the schema with nothing skipped {log[:2]}")


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    QUIET["on"] = "--quiet" in argv
    FAILS.clear()
    golden_suite("--update" in argv)
    weird_posts_suite()
    fallback_suite()
    drift_suite()
    shipped_document_suite()
    if FAILS:
        print(f"normalize tests: {len(FAILS)} failed")
        return 1
    print(f"normalize tests ok ({PASSED['n']} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
