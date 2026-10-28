/* For You ranking. Placeholders only. */
import assert from "node:assert/strict";
import { rank, chronological, note, commitServed, emptyMemory } from "../shared/for-you.js";
import { WEIGHTS } from "../shared/for-you-weights.js";

const NOW = Date.parse("2026-10-28T12:00:00Z");

function post(id, handle, hoursAgo, stats, text, extra) {
  return Object.assign({
    id: id,
    handle: handle,
    platform: "x",
    feedId: "x:" + handle,
    date: new Date(NOW - hoursAgo * 3600000).toISOString(),
    text: text || "",
    stats: stats || { likes: 0, reposts: 0, replies: 0 }
  }, extra || {});
}

function ctx(followed, extra) {
  return Object.assign({
    now: NOW,
    weights: WEIGHTS,
    memory: emptyMemory(),
    followed: (item) => followed.indexOf(item.handle) >= 0,
    liked: () => false,
    read: () => false,
    skip: () => false
  }, extra || {});
}

function handles(list) {
  return list.map((item) => item.handle);
}

const heavy = Object.assign({}, WEIGHTS);
assert.equal(heavy.like, 0.5);
assert.equal(heavy.repost, 1);
assert.equal(heavy.reply, 13.5);
assert.equal(heavy.authorReply, 75);
assert.equal(heavy.profileClick, 12);
assert.equal(heavy.conversationClick, 11);
assert.equal(heavy.longDwell, 10);
assert.equal(heavy.negative, -74);
assert.equal(heavy.report, -369);
assert.ok(heavy.videoWatch > 0 && heavy.videoWatch < 1);

const flood = [];
for (let i = 0; i < 12; i++) {
  flood.push(post("a" + i, "user_a", 0.2 + i * 0.05, { likes: 80, reposts: 4, replies: 2 }, "status " + i));
}
const others = [
  post("b1", "user_b", 3, { likes: 70, reposts: 3, replies: 1 }, "notes from the day"),
  post("c1", "user_c", 4, { likes: 40, reposts: 2, replies: 1 }, "a quieter update"),
  post("d1", "user_d", 5, { likes: 25, reposts: 1, replies: 0 }, "field report"),
  post("e1", "user_e", 2, { likes: 55, reposts: 2, replies: 1 }, "evening note")
];
const followed = ["user_a", "user_b", "user_c", "user_d", "user_e"];
const ranked = rank(flood.concat(others), ctx(followed));
const top = handles(ranked.slice(0, 10));
const floodCount = top.filter((name) => name === "user_a").length;
assert.ok(floodCount <= 2, "one author does not fill For You: " + top.join(","));
assert.ok(top.indexOf("user_b") >= 0, "other followed accounts stay in the slate");
assert.ok(new Set(top).size >= 4, "the slate mixes authors");

const chrono = chronological(flood.concat(others), NOW);
assert.equal(chrono[0].handle, "user_a");
assert.notEqual(ranked.map((item) => item.id).join(","), chrono.map((item) => item.id).join(","));
assert.equal(chrono.filter((item) => item.handle === "user_a").length, 12);

const liked = post("b-like", "user_b", 6, { likes: 10, reposts: 0, replies: 0 }, "rockets launch window");
const oonHit = post("c-oon", "user_c", 1, { likes: 4, reposts: 0, replies: 0 }, "rockets launch tonight");
const oonMiss = post("d-oon", "user_d", 1, { likes: 4, reposts: 0, replies: 0 }, "gardening tips for soil");
const oonRanked = rank(
  [liked, oonHit, oonMiss, post("b2", "user_b", 2, { likes: 3, reposts: 0, replies: 0 }, "rockets launch photos")],
  ctx(["user_b"], { liked: (item) => item.id === "b-like" })
);
const oonHandles = handles(oonRanked);
assert.ok(oonHandles.indexOf("user_c") >= 0, "a similar out-of-network post can appear");
assert.equal(oonHandles.indexOf("user_d"), -1, "an unrelated out-of-network post stays out");

const muted = rank(flood.concat(others), ctx(followed, { skip: (item) => item.handle === "user_a" }));
assert.equal(handles(muted).indexOf("user_a"), -1);

const seenMemory = emptyMemory();
seenMemory.served = ["b1"];
const unseen = rank(flood.concat(others), ctx(followed, { memory: seenMemory }));
assert.equal(unseen.some((item) => item.id === "b1"), false);
const wiped = emptyMemory();
wiped.served = flood.concat(others).map((item) => item.id);
const backfill = rank(flood.concat(others), ctx(followed, { memory: wiped }));
assert.ok(backfill.length >= 5, "seen posts come back when nothing newer is left");
commitServed(seenMemory);

const neg = emptyMemory();
note(neg, post("a0", "user_a", 0.1, { likes: 100, reposts: 10, replies: 5 }, "status"), "hide");
const afterHide = rank(flood.concat(others), ctx(followed, { memory: neg }));
assert.equal(afterHide.some((item) => item.id === "a0"), false);
assert.ok(afterHide.findIndex((item) => item.handle === "user_b") < afterHide.findIndex((item) => item.handle === "user_a") || afterHide.every((item) => item.handle !== "user_a"));

const dup = rank([
  post("same", "user_b", 1, { likes: 5, reposts: 0, replies: 0 }, "hello there"),
  post("same", "user_b", 1, { likes: 5, reposts: 0, replies: 0 }, "hello there"),
  post("other", "user_b", 2, { likes: 5, reposts: 0, replies: 0 }, "hello there")
], ctx(["user_b"]));
assert.equal(dup.length, 1);

const reported = rank([
  post("bad", "user_b", 0.1, { likes: 100, reposts: 20, replies: 10 }, "do not boost this"),
  post("ok", "user_c", 1, { likes: 2, reposts: 0, replies: 0 }, "ordinary note")
], ctx(["user_b", "user_c"], { reported: (item) => item.id === "bad" }));
assert.equal(reported[0].id, "ok");

const stableA = rank(flood.concat(others), ctx(followed)).map((item) => item.id).join(",");
const stableB = rank(flood.concat(others), ctx(followed)).map((item) => item.id).join(",");
assert.equal(stableA, stableB);

console.log("for you rank ok");
