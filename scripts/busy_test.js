/* Busy accounts on the device: detection, Home shaping, interleave, prefs. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const B = require("../busy.js");

const ROOT = path.resolve(__dirname, "..");
const base = Date.parse("2026-10-29T12:00:00Z");
const S = 1000;
const iso = (t) => new Date(t).toISOString();
const posts = [];
for (let i = 0; i < 60; i++) posts.push({ id: "b" + i, feedId: "loud", handle: "loud", platform: "x", kind: "reply", replyingTo: { handle: "u" + i }, date: iso(base - i * 1500 * S) });
for (let i = 0; i < 12; i++) posts.push({ id: "o" + i, feedId: "loud", handle: "loud", platform: "x", kind: "post", stats: { likes: i * 10 }, date: iso(base - i * 600 * S - 30 * S) });
posts.push({ id: "self", feedId: "loud", handle: "loud", platform: "x", kind: "reply", replyingTo: { handle: "loud" }, date: iso(base - 100 * S) });
for (let i = 0; i < 20; i++) posts.push({ id: "q" + i, feedId: "calm", handle: "calm", platform: "x", kind: "post", date: iso(base - i * 3 * 3600 * S) });
for (let i = 0; i < 20; i++) posts.push({ id: "p" + i, feedId: "pal", handle: "pal", platform: "x", kind: "post", date: iso(base - i * 3600 * S - 60 * S) });
const sorted = posts.slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

// Detection from the cache alone; the clock is the newest post.
const busy = B.stats(sorted);
assert.ok(busy.loud.busy, "a source posting dozens a day is busy");
assert.ok(!busy.calm.busy && !busy.pal.busy, "ordinary sources are not");
assert.ok(B.replyToOther(posts[0]) && !B.replyToOther(posts.find((p) => p.id === "self")), "threads are not replies to others");

// Auto: replies to others hidden, 3 per 2 hours, the rest folded.
const auto = B.shape(sorted, { busy, prefs: {}, now: base });
const loudShown = auto.filter((p) => !p.busyGroup && p.feedId === "loud");
assert.ok(!loudShown.some((p) => B.replyToOther(p)), "auto hides replies to other people");
assert.ok(loudShown.some((p) => p.id === "self"), "auto keeps self-thread replies");
assert.strictEqual(auto.counts.hidden, 60);
const buckets = {};
loudShown.forEach((p) => { const k = Math.floor(Date.parse(p.date) / B.RULES.window); buckets[k] = (buckets[k] || 0) + 1; });
assert.ok(Object.values(buckets).every((n) => n <= B.RULES.cap), "at most 3 per 2 hours");
const more = auto.filter((p) => p.busyGroup && p.kind === "more");
assert.ok(more.length >= 1 && auto.counts.folded >= 2, "overflow folds into a row");
assert.ok(auto.filter((p) => p.feedId === "calm").length === 20 && auto.filter((p) => p.feedId === "pal").length === 20, "quiet sources untouched");
// Opening a fold expands it in place.
const open = {}; open[more[0].id] = true;
const opened = B.shape(sorted, { busy, prefs: {}, now: base, open });
assert.ok(opened.filter((p) => !p.busyGroup).length > auto.filter((p) => !p.busyGroup).length, "an opened fold shows its posts");

// Per-account modes.
let prefs = B.setMode({}, "loud", "all");
assert.strictEqual(B.shape(sorted, { busy, prefs, now: base }).length, sorted.length, "show all keeps everything");
prefs = B.setMode({}, "loud", "originals");
assert.ok(!B.shape(sorted, { busy, prefs, now: base }).some((p) => p.feedId === "loud" && B.isReply(p)), "originals drops every reply");
prefs = B.setMode({}, "loud", "digest");
const digest = B.shape(sorted, { busy, prefs, now: base });
assert.ok(digest.some((p) => p.busyGroup && p.kind === "digest") && !digest.some((p) => !p.busyGroup && p.feedId === "loud"), "digest groups the day");
prefs = B.setMode({}, "loud", "top");
const top = B.shape(sorted, { busy, prefs, now: base });
assert.ok(top.some((p) => !p.busyGroup && p.id === "o11"), "top keeps the most engaged post");
const muteUntil = Date.now() + 3600e3;
prefs = B.mute({}, "loud", muteUntil);
assert.ok(!B.shape(sorted, { busy, prefs, now: muteUntil - 1 }).some((p) => p.feedId === "loud"), "mute hides the source");
assert.strictEqual(B.modeFor(prefs, "loud", true, muteUntil + 1), "auto", "a mute expires");
assert.deepStrictEqual(Object.keys(B.cleanPrefs({ modes: { a: "nope", b: "top" } }).modes), ["b"], "unknown modes are dropped");
assert.deepStrictEqual(B.serverRules(B.setMode({}, "x:Loud", "originals")), ["r|x:loud"], "originals can ask the server to drop replies");
assert.deepStrictEqual(B.serverRules(Object.assign(B.setMode({}, "x:Loud", "originals"), { server: false })), [], "the server rule is optional");

// Interleave: no source holds more than 20% of any ten rows when others can fill them.
const clumped = [];
for (let i = 0; i < 40; i++) clumped.push({ id: "c" + i, feedId: i < 30 ? "loud" : "f" + (i % 7), date: iso(base - i * 60 * S) });
for (let i = 0; i < 30; i++) clumped.push({ id: "d" + i, feedId: "g" + (i % 9), date: iso(base - 3600e3 - i * 60 * S) });
const mixed = B.interleave(clumped, {});
assert.strictEqual(mixed.length, clumped.length, "interleave keeps every row");
const loudOrder = mixed.filter((p) => p.feedId === "loud").map((p) => p.id);
assert.deepStrictEqual(loudOrder, clumped.filter((p) => p.feedId === "loud").map((p) => p.id), "per-source order is kept");
for (let i = 0; i + 10 <= 30; i++) assert.ok(mixed.slice(i, i + 10).filter((p) => p.feedId === "loud").length <= 2, "window " + i + " is mixed");

// Idle-time detection hands back the same result and can be cancelled.
let got = null;
B.statsLater(sorted, {}, (map) => { got = map; });
setTimeout(() => {
  assert.ok(got && got.loud && got.loud.busy, "statsLater finishes off the main path");
  // Wiring: loaded before app.js, cached by the service worker, synced across devices.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const sync = fs.readFileSync(path.join(ROOT, "settings-sync.js"), "utf8");
  const accounts = fs.readFileSync(path.join(ROOT, "accounts.js"), "utf8");
  assert.ok(html.indexOf('src="busy.js"') > 0 && html.indexOf('src="busy.js"') < html.indexOf('src="app.js"'), "busy.js loads before app.js");
  assert.ok(sw.includes('"./busy.js"'), "busy.js is precached");
  assert.ok(sync.includes('"busyPrefs"') && accounts.includes('"busyPrefs"'), "per-account choices sync");
  console.log("busy ok");
}, 200);
