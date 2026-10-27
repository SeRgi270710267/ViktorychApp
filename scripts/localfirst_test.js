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
assert.strictEqual(storage.categoryOf("https://accounts.example/v1/notifications"), "notifications");
assert.strictEqual(storage.shouldCacheFeed("https://accounts.example/v1/notifications"), true);
assert.strictEqual(storage.shouldCacheFeed("https://accounts.example/v1/me"), false);
assert.strictEqual(storage.hitRate({ hits: 3, network: 1 }), 75);
assert.ok(storage.usageHtml().indexOf("Hit rate") >= 0);
assert.ok(storage.usageHtml().indexOf("Direct") >= 0);
assert.ok(storage.usageHtml().indexOf("Profiles") >= 0);

console.log("local first ok");
