const assert = require("assert");
const localfirst = require("../localfirst.js");
const storage = require("../storage.js");

const docs = localfirst.createStore();
docs.put("feeds", "home", { title: "Home", posts: [{ id: "p1", text: "Cached home line" }] });
docs.put("profiles", "profile", { name: "Ada", bio: "Cached bio", pinned: { text: "Pinned line" } });
docs.put("threads", "post", { post: { text: "Cached post" }, parent: { text: "Parent line" }, quote: { text: "Quote line" }, replies: [{ text: "Cached reply" }] });
docs.put("notifications", "all", {
  notes: [{ id: "n1", text: "Cached note", at: 10, unread: true }],
  readThrough: 0,
  seen: []
});

function blocked() { throw new Error("blocked"); }

const home = localfirst.bootOffline({ route: "home", docs: docs, fetch: blocked });
const profile = localfirst.bootOffline({ route: "profile", docs: docs, fetch: blocked });
const post = localfirst.bootOffline({ route: "post", docs: docs, fetch: blocked });
const notes = localfirst.bootOffline({ route: "notifications", docs: docs, fetch: blocked });
assert.strictEqual(home.spinner, false);
assert.strictEqual(home.offline, true);
assert.ok(home.html.indexOf("Cached home line") >= 0 && home.html.indexOf('data-screen="home"') >= 0);
assert.ok(profile.html.indexOf("Ada") >= 0 && profile.html.indexOf("Cached bio") >= 0 && profile.html.indexOf("Pinned line") >= 0);
assert.ok(post.html.indexOf("Cached post") >= 0 && post.html.indexOf("Cached reply") >= 0 && post.html.indexOf("Parent line") >= 0 && post.html.indexOf("Quote line") >= 0);
assert.ok(notes.html.indexOf("Cached note") >= 0 && notes.html.indexOf('data-unread="1"') >= 0);

const server = { notes: [{ id: "n1", text: "Cached note", at: 10 }], readThrough: 50, seen: [] };
const merged = localfirst.mergeNotes(docs.get("notifications", "all"), server);
assert.strictEqual(merged.notes[0].unread, false);
const kept = localfirst.mergeNotes({ notes: [{ id: "n1", text: "Cached note", at: 10, unread: true }], readThrough: 40, seen: [] }, null);
assert.strictEqual(kept.notes[0].unread, false);
const offlineNotes = localfirst.bootOffline({
  route: "notifications",
  docs: docs,
  fetch: blocked,
  server: server
});
assert.ok(offlineNotes.html.indexOf('data-unread="0"') >= 0);

let queue = [];
queue = localfirst.enqueueList(queue, { type: "like", id: "p1", on: true });
queue = localfirst.enqueueList(queue, { type: "like", id: "p1", on: true });
assert.strictEqual(queue.length, 1);
queue = localfirst.enqueueList(queue, { type: "like", id: "p1", on: false });
assert.strictEqual(queue.length, 1);
assert.strictEqual(queue[0].on, false);
let sent = 0;
queue = localfirst.flushList(queue, function () { sent += 1; return true; });
assert.strictEqual(sent, 1);
assert.strictEqual(queue.length, 0);

assert.strictEqual(localfirst.prefetchLimit({ saveData: true, effectiveType: "4g" }, true), 0);
assert.strictEqual(localfirst.prefetchLimit({ effectiveType: "2g" }, true), 0);
assert.strictEqual(localfirst.prefetchLimit({ effectiveType: "4g", type: "wifi" }, false), 0);
assert.strictEqual(localfirst.prefetchLimit({ effectiveType: "4g", type: "wifi" }, true), 8);
assert.ok(localfirst.displayImage("https://pbs.twimg.com/media/a.jpg", 200).indexOf("name=small") >= 0);
const plan = localfirst.mediaPlan([
  { image: "https://pbs.twimg.com/media/a.jpg", poster: "https://example/poster.jpg", first: "https://example/seg0.m4s", width: 320 },
  { image: "https://pbs.twimg.com/media/b.jpg?name=orig", width: 1200 }
], { effectiveType: "4g" }, true);
assert.deepStrictEqual(plan.posters, ["https://example/poster.jpg"]);
assert.deepStrictEqual(plan.first, ["https://example/seg0.m4s"]);
assert.ok(plan.ahead.length >= 1);
assert.deepStrictEqual(localfirst.rankOpens({ "#/home": 2, "#/@ada": 9, "#/explore": 4 }, 2), ["#/@ada", "#/explore"]);
assert.strictEqual(storage.categoryOf("https://accounts.example/notifications/list"), "notifications");
assert.strictEqual(storage.shouldCacheFeed("https://accounts.example/v1/notifications"), false);
assert.strictEqual(storage.shouldCacheFeed("https://accounts.example/v1/me"), false);
assert.strictEqual(storage.hitRate({ hits: 3, network: 1 }), 75);
assert.ok(storage.usageHtml().indexOf("Hit rate") >= 0);
assert.ok(storage.usageHtml().indexOf("Direct") >= 0);
assert.ok(storage.usageHtml().indexOf("Profiles") >= 0);

const order = require("../shared/feed-order.js");
const repost = { id: "a", platform: "x", kind: "repost", date: "2024-01-01T00:00:00Z", sortDate: "2024-08-01T00:00:00Z", repostedBy: { handle: "ada" }, text: "later" };
const july = { id: "b", platform: "x", date: "2024-07-01T00:00:00Z", text: "july" };
const copy = { id: "b", platform: "x", date: "2024-07-01T00:00:00Z", text: "copy" };
const future = { id: "z", platform: "x", date: "2099-01-01T00:00:00Z", text: "future" };
const ranked = localfirst.orderPosts([july, copy, future, repost], order.compare, order.key);
assert.deepStrictEqual(ranked.map((post) => post.id), ["a", "b", "z"]);
assert.strictEqual(ranked[1].text, "july");

const media = localfirst.playlistFirst("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2.0,\nseg0.m4s\n#EXTINF:2.0,\nseg1.m4s\n", "https://cdn.example/v/index.m3u8");
assert.strictEqual(media.segment, "https://cdn.example/v/seg0.m4s");
assert.strictEqual(media.map, "https://cdn.example/v/init.mp4");
const master = localfirst.playlistFirst("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n", "https://cdn.example/master.m3u8");
assert.strictEqual(master.variant, "https://cdn.example/low.m3u8");
assert.strictEqual(master.segment, "");

localfirst.noteScroll("home:foryou", 10, { "home:foryou": 10, "home:following": 80, "notifications:all": 4 });
const scrolls = localfirst.readScrolls();
assert.strictEqual(scrolls["home:following"], 80);
assert.strictEqual(scrolls["notifications:all"], 4);

const quiet = { saveData: true, effectiveType: "4g", type: "wifi" };
localfirst.cacheFirstSegment("https://cdn.example/master.m3u8", function () {
  throw new Error("save-data still fetched a playlist");
}, quiet).then(function (skipped) {
  assert.deepStrictEqual(skipped, []);
  return localfirst.cacheFirstSegment("https://cdn.example/master.m3u8", function (url) {
    if (String(url).indexOf("master") >= 0) {
      return Promise.resolve({ ok: true, text: function () { return Promise.resolve("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cdn.example/low.m3u8\n"); } });
    }
    return Promise.resolve({ ok: true, text: function () { return Promise.resolve("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\nhttps://cdn.example/seg0.m4s\n#EXTINF:1,\nhttps://cdn.example/seg1.m4s\n"); } });
  }, { saveData: false, effectiveType: "4g", type: "wifi" });
}).then(function (urls) {
  assert.deepStrictEqual(urls, ["https://cdn.example/init.mp4", "https://cdn.example/seg0.m4s"]);
  console.log("local first ok");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
