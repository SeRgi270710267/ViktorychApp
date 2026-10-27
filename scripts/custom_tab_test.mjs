import assert from "node:assert/strict";
import { compare, followsPost, prepareActivity, refreshTab } from "../shared/feed-order.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const HANDLE = "tabfixture";
const FEED = "x:" + HANDLE;

function post(id, date, extra) {
  return Object.assign({
    id: id,
    statusId: id,
    platform: "x",
    handle: HANDLE,
    feedId: FEED,
    kind: "post",
    date: date
  }, extra || {});
}

function ids(rows) {
  return rows.map((row) => row.id);
}

const shapes = [
  post("a", "Wed Oct 21 17:00:00 +0000 2026"),
  post("b", "Tue, 21 Oct 2026 18:00:00 GMT"),
  post("c", "2026-10-21 16:00:00"),
  post("d", String(Math.floor(Date.parse("2026-10-21T15:00:00Z") / 1000))),
  post("e", "2026-10-21T17:00:00Z"),
  post("rss-hour", "Tue, 21 Oct 2026 14:30:00 +0000")
];
const repost = post("repost:" + HANDLE + ":r", "2026-10-20T00:00:00Z", {
  kind: "repost",
  sortDate: "2026-10-21T19:00:00Z",
  repostedBy: { handle: HANDLE, platform: "x", feedId: FEED }
});
const ordered = shapes.concat([repost]).sort((a, b) => compare(a, b, NOW));
assert.deepEqual(ids(ordered), [
  "repost:" + HANDLE + ":r",
  "b",
  "e",
  "a",
  "c",
  "d",
  "rss-hour"
]);

let known = [
  post("p2", "2026-10-27T10:00:00Z"),
  post("p1", "2026-10-27T09:00:00Z")
];
let merged = refreshTab(known, [
  post("p3", "2026-10-27T11:00:00Z"),
  post("p2", "2026-10-27T10:00:00Z"),
  post("p1", "2026-10-27T09:00:00Z")
], NOW);
assert.equal(merged.posts[0].id, "p3");
assert.deepEqual(ids(merged.posts), ["p3", "p2", "p1"]);
assert.equal(new Set(ids(merged.posts)).size, merged.posts.length);

merged = refreshTab(merged.posts, [
  post("p5", "2026-10-27T11:50:00Z"),
  post("p4", "2026-10-27T11:30:00Z"),
  post("p3", "2026-10-27T11:00:00Z")
], NOW);
assert.equal(merged.posts[0].id, "p5");
assert.deepEqual(ids(merged.posts), ["p5", "p4", "p3", "p2", "p1"]);

const pinnedOld = post("pinned-old", "2024-01-01T00:00:00Z", {
  pinned: true,
  pinAt: "2026-10-27T12:00:00Z"
});
merged = refreshTab(merged.posts, [
  post("p6", "2026-10-27T11:55:00Z"),
  post("p5", "2026-10-27T11:50:00Z"),
  pinnedOld,
  post("p4", "2026-10-27T11:30:00Z")
], NOW);
assert.equal(merged.posts[0].id, "p6");
assert.notEqual(merged.posts[0].id, "pinned-old");
assert.equal(new Set(ids(merged.posts)).size, merged.posts.length);
assert.equal(pinnedOld.date, "2024-01-01T00:00:00Z");

const stuck = post("stuck-pin", "2026-10-27T12:00:00Z", {
  pinned: true,
  pinAt: "2026-10-27T12:00:00Z"
});
const held = refreshTab(
  [stuck, post("held", "2026-10-27T10:00:00Z")],
  [post("arrived", "2026-10-27T11:40:00Z"), stuck],
  NOW
);
assert.equal(held.posts[0].id, "arrived");
assert.equal(stuck.date, "");
assert.ok(ids(held.posts).indexOf("stuck-pin") > 0);

const snapshot = [
  post("s2", "2026-10-27T08:00:00Z"),
  post("s1", "2026-10-27T07:00:00Z")
];
const withNetwork = refreshTab(snapshot, [
  post("n2", "2026-10-27T11:40:00Z"),
  post("n1", "2026-10-27T11:20:00Z"),
  post("s2", "2026-10-27T08:00:00Z")
], NOW);
assert.equal(withNetwork.posts[0].id, "n2");
assert.deepEqual(ids(withNetwork.added), ["n2", "n1"]);
assert.ok(withNetwork.posts.some((row) => row.id === "s1"));
assert.ok(withNetwork.posts.some((row) => row.id === "s2"));

const poisoned = post("poison", "2026-10-27T12:00:00Z", {
  pinned: true,
  pinAt: "2026-10-27T12:00:00Z"
});
const real = post("real", "2026-10-27T11:00:00Z");
const cleaned = refreshTab([], [poisoned, real], NOW);
assert.equal(cleaned.posts[0].id, "real");
assert.equal(poisoned.date, "");
assert.ok(!poisoned.sortDate);
const keptPin = refreshTab([], [
  post("pin-keep", "2024-01-01T00:00:00Z", { pinned: true, pinAt: "2026-10-27T12:00:00Z" }),
  post("lead", "2026-10-27T11:00:00Z")
], NOW);
assert.deepEqual(ids(keptPin.posts), ["lead", "pin-keep"]);

const page = prepareActivity([
  post("pin-row", "2024-06-01T00:00:00Z", { pinned: true, pinAt: "2026-10-27T12:00:00Z" }),
  post("open-row", "2026-10-27T11:10:00Z")
], NOW);
assert.deepEqual(ids(page), ["open-row", "pin-row"]);

const head = refreshTab([], [
  post("c3", "2026-10-27T11:00:00Z"),
  post("c2", "2026-10-27T10:00:00Z"),
  post("c1", "2026-10-27T09:00:00Z")
], NOW);
const cursor = refreshTab(head.posts, [
  post("c1", "2026-10-27T09:00:00Z"),
  post("c0", "2026-10-27T08:00:00Z"),
  post("older", "2026-10-27T07:00:00Z")
], NOW);
assert.equal(cursor.posts[0].id, "c3");
assert.deepEqual(ids(cursor.added), []);
assert.ok(cursor.posts.some((row) => row.id === "c3"));

const members = [FEED];
assert.equal(followsPost(post("own", "2026-10-27T11:00:00Z"), members), true);
assert.equal(followsPost(post("orig", "2026-10-20T00:00:00Z", {
  kind: "repost",
  handle: "otheracct",
  feedId: "x:otheracct",
  repostedBy: { handle: HANDLE, platform: "x", feedId: FEED }
}), members), true);
assert.equal(followsPost(post("nope", "2026-10-27T11:00:00Z", {
  handle: "otheracct",
  feedId: "x:otheracct"
}), members), false);

console.log("custom tab freshness ok");
