import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = { self: {} };
vm.createContext(context);
vm.runInContext(readFileSync(new URL("../shared/home-fresh.js", import.meta.url), "utf8"), context);
const Home = context.self.HomeFresh;

const NOW = Date.parse("2026-10-27T12:00:00Z");

function post(id, date) {
  return { id: id, statusId: id, platform: "rss", feedId: "src-a", kind: "post", date: date, text: id };
}

const snapshot = {
  savedAt: NOW - 10 * 60 * 1000,
  posts: [
    post("old-b", "2026-10-27T10:00:00Z"),
    post("old-a", "2026-10-27T09:00:00Z")
  ]
};
const network = [
  post("new-b", "2026-10-27T11:40:00Z"),
  post("new-a", "2026-10-27T11:50:00Z"),
  post("old-b", "2026-10-27T10:00:00Z")
];

assert.equal(Home.stale(snapshot, NOW), true);
assert.equal(Home.showBar(snapshot, NOW, false), true);
assert.equal(Home.showBar(snapshot, NOW, true), false);
assert.equal(Home.stale({ savedAt: NOW - 30 * 1000 }, NOW), false);

const first = Home.place(snapshot.posts, network, { scrollY: 0, read: false, now: NOW });
assert.equal(first.mode, "insert");
assert.equal(first.pill, false);
assert.equal(first.pending.length, 0);
assert.equal(first.posts[0].id, "new-a");
assert.equal(first.posts.map((row) => row.id).join(","), "new-a,new-b,old-b,old-a");

const scrolled = Home.place(snapshot.posts, network, { scrollY: 240, read: false, now: NOW });
assert.equal(scrolled.mode, "pill");
assert.equal(scrolled.pill, true);
assert.equal(scrolled.posts.map((row) => row.id).join(","), "old-b,old-a");
assert.equal(scrolled.pending.map((row) => row.id).join(","), "new-a,new-b");

const read = Home.place(snapshot.posts, network, { scrollY: 0, read: true, now: NOW });
assert.equal(read.mode, "pill");
assert.equal(read.posts[0].id, "old-b");
assert.equal(read.pending[0].id, "new-a");

const freshSnap = { savedAt: NOW - 20 * 1000, posts: snapshot.posts };
assert.equal(Home.newer(freshSnap, snapshot), true);
assert.equal(Home.activeTab("#/cat/alpha"), "cat:alpha");
assert.equal(Home.activeTab("#/following?sort=recent"), "following");
assert.equal(Home.tabsToRefresh("cat:alpha", ["foryou", "following", "cat:alpha"]).join(","), "cat:alpha,foryou,following");

const saved = Home.slimDoc({ posts: network.concat(snapshot.posts), feeds: [{ id: "src-a" }] }, NOW);
assert.equal(saved.posts[0].id, "new-a");
assert.equal(saved.savedAt, NOW);
assert.equal(Home.cacheMode("boot"), "revalidate");
assert.equal(Home.cacheMode("refresh"), "revalidate");
assert.equal(Home.videoUrl("https://video.twimg.com/amplify_video/1/vid/avc1/a.mp4"), true);
assert.equal(Home.videoUrl("https://cdn.example/photo.jpg", "image/jpeg"), false);
assert.equal(Home.videoUrl("https://cdn.example/clip", "video/mp4"), true);

const support = Home.periodicSupport();
assert.equal(support.minIntervalMs, 15 * 60 * 1000);
assert.equal(support.chromeInstalled, "runs");
assert.equal(support.edgeInstalled, "runs");
assert.equal(support.braveAndroid, "absent");
assert.equal(support.safari, "absent");
assert.equal(support.firefox, "absent");
assert.equal(support.chromeTab, "absent");
assert.equal(Home.VISIBLE_MS, 60 * 1000);

console.log("home fresh fixtures passed");
