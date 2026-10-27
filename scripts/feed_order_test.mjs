import assert from "node:assert/strict";
import { compare, followsPost, freshPosts, key, orderMs, pageSlice, parseInstant, preferDate } from "../shared/feed-order.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const T17 = Date.parse("2026-10-21T17:00:00Z");

function at(ms) {
  return new Date(ms).toISOString();
}

assert.equal(parseInstant("Wed Oct 21 17:00:00 +0000 2026"), T17);
assert.equal(parseInstant("2026-10-21T17:00:00Z"), T17);
assert.equal(parseInstant("2026-10-21T17:00:00.000Z"), T17);
assert.equal(parseInstant("2026-10-21T17:00:00+00:00"), T17);
assert.equal(parseInstant("2026-10-21T10:00:00-07:00"), T17);
assert.equal(parseInstant("2026-10-21T20:00:00+03:00"), T17);
assert.equal(parseInstant("2026-10-21T17:00:00"), T17);
assert.equal(parseInstant("2026-10-21 17:00:00"), T17);
assert.equal(parseInstant("2026-10-21"), Date.parse("2026-10-21T00:00:00Z"));
assert.equal(parseInstant(String(Math.floor(T17 / 1000))), T17);
assert.equal(parseInstant(String(T17)), T17);
assert.equal(parseInstant((T17 / 1000).toFixed(1)), T17 + 0);
assert.equal(parseInstant("Tue, 21 Oct 2026 17:00:00 GMT"), T17);
assert.equal(parseInstant("Tue, 21 Oct 2026 20:00:00 +0300"), T17);
assert.equal(parseInstant("1761066000.5"), Math.round(1761066000.5 * 1000));

const snowMs = Date.parse("2024-05-01T15:30:00.000Z");
const snowflake = ((BigInt(snowMs) - 1420070400000n) << 22n).toString();
assert.equal(parseInstant(snowflake), null);
assert.equal(parseInstant(snowflake, { snowflake: true }), snowMs);
assert.equal(parseInstant(""), null);
assert.equal(parseInstant("not a date"), null);

const x = { id: "x1", platform: "x", date: "Wed Oct 21 17:00:00 +0000 2026" };
const ig = { id: "ig1", platform: "instagram", date: String(Math.floor(T17 / 1000) - 60) };
const tt = { id: "tt1", platform: "tiktok", date: String(T17 + 60 * 1000) };
const rd = { id: "rd1", platform: "reddit", date: (T17 / 1000 - 120).toFixed(1) };
const vk = { id: "vk1", platform: "vk", date: "2026-10-21 16:30:00" };
const dc = { id: "dc1", platform: "discord", date: "2026-10-21T18:00:00+03:00" };
const yt = { id: "abcdefghijk", platform: "youtube", date: "2026-10-21T09:00:00-07:00" };
const rss = { id: "rss1", platform: "rss", date: "Tue, 21 Oct 2026 18:30:00 +0300" };
const repost = {
  id: "repost:someone:100",
  statusId: "100",
  platform: "x",
  kind: "repost",
  handle: "orig",
  date: "2026-10-21T12:00:00Z",
  sortDate: "2026-10-21T18:30:00Z",
  repostedBy: { handle: "someone", name: "Someone" }
};
const future = { id: "fut", platform: "x", date: "2099-01-01T00:00:00Z" };
const missing = { id: "miss", platform: "x", date: "" };
const tiedLow = { id: "10", platform: "x", date: at(T17) };
const tiedHigh = { id: "9", platform: "x", date: "2026-10-21T17:00:00+00:00" };

const rows = [x, ig, tt, rd, vk, dc, yt, rss, repost, future, missing, tiedLow, tiedHigh];
rows.sort((a, b) => compare(a, b, NOW));
assert.deepEqual(rows.map((post) => post.id), [
  "repost:someone:100",
  "tt1",
  "x1",
  "9",
  "10",
  "ig1",
  "rd1",
  "vk1",
  "abcdefghijk",
  "rss1",
  "dc1",
  "miss",
  "fut"
]);
assert.equal(repost.kind, "repost");
assert.equal(repost.repostedBy.handle, "someone");
assert.ok(orderMs(repost, NOW) > orderMs(x, NOW));
assert.equal(orderMs(future, NOW), 0);
assert.equal(orderMs(missing, NOW), 0);
assert.ok(compare(tiedHigh, tiedLow, NOW) < 0);

const mirrorA = { id: "yt:video:abcdefghijk", platform: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk", date: at(T17) };
const mirrorB = { id: "abcdefghijk", platform: "youtube", url: "https://youtu.be/abcdefghijk", date: at(T17) };
assert.equal(key(mirrorA), key(mirrorB));
const igMirror = { id: "999", platform: "instagram", url: "https://www.instagram.com/p/AbC123/", date: at(T17) };
const igShort = { id: "AbC123", platform: "instagram", date: at(T17) };
assert.equal(key(igMirror), key(igShort));
const again = { id: "other", platform: "x", kind: "repost", statusId: "100", repostedBy: { handle: "Other" }, date: at(T17), sortDate: at(T17) };
assert.notEqual(key(repost), key(again));

const known = [
  { id: "new", platform: "x", date: at(T17 + 5000) },
  { id: "old", platform: "x", date: at(T17) }
];
const incoming = [
  { id: "new", platform: "x", date: at(T17 + 5000) },
  { id: "gap", platform: "x", date: at(T17 + 2000) },
  { id: "brand", platform: "x", date: at(T17 + 9000) },
  { id: "ancient", platform: "x", date: at(T17 - 5000) },
  { id: "blank", platform: "x", date: "" },
  { id: "ahead", platform: "x", date: "2099-05-01T00:00:00Z" },
  { id: "yt:video:abcdefghijk", platform: "youtube", date: at(T17 + 1000) },
  { id: "abcdefghijk", platform: "youtube", url: "https://youtu.be/abcdefghijk", date: at(T17 + 1000) }
];
const fresh = freshPosts(known, incoming, 40);
assert.deepEqual(fresh.map((post) => post.id), ["brand", "gap", "yt:video:abcdefghijk"]);
assert.deepEqual(known.map((post) => post.id), ["new", "old"]);

const onlyFuture = [{ id: "bad", platform: "x", date: "2099-01-01T00:00:00Z" }];
const recovered = freshPosts(onlyFuture, [{ id: "real", platform: "x", date: at(T17) }], 40);
assert.deepEqual(recovered.map((post) => post.id), ["real"]);

assert.equal(preferDate("2099-01-01T00:00:00Z", "2026-10-21T17:00:00Z", NOW), "2026-10-21T17:00:00Z");
assert.equal(preferDate("2026-10-21T17:00:00+00:00", "2026-10-21T18:00:00Z", NOW), "2026-10-21T17:00:00+00:00");
assert.equal(preferDate("", "2026-10-21T17:00:00Z", NOW), "2026-10-21T17:00:00Z");
assert.equal(preferDate("not-a-date", "", NOW), "");

const sorted = [0, 1, 2, 3, 4].map((n) => ({ id: "p" + n, date: at(T17 + n * 1000) })).sort((a, b) => compare(a, b, NOW));
const page1 = pageSlice(sorted, "", 2);
const page2 = pageSlice(sorted, page1.cursor, 2);
const page3 = pageSlice(sorted, page2.cursor, 2);
assert.deepEqual(page1.items.map((post) => post.id), ["p4", "p3"]);
assert.deepEqual(page2.items.map((post) => post.id), ["p2", "p1"]);
assert.deepEqual(page3.items.map((post) => post.id), ["p0"]);
assert.deepEqual(pageSlice(sorted, page1.cursor, 2).items.map((post) => post.id), ["p2", "p1"]);
assert.deepEqual(pageSlice(sorted, "missing", 2).items, []);
assert.equal(pageSlice(sorted, page3.cursor, 2).cursor, "");
const seen = new Set();
[page1, page2, page3].forEach((page) => {
  page.items.forEach((post) => {
    assert.equal(seen.has(post.id), false);
    seen.add(post.id);
  });
});
assert.equal(seen.size, 5);

const original = { id: "100", platform: "x", handle: "orig", feedId: "x:orig", date: at(T17) };
assert.equal(followsPost(original, ["x:Orig"]), true);
assert.equal(followsPost(original, ["x:someone"]), false);
assert.equal(followsPost(repost, ["x:orig"]), false);
assert.equal(followsPost(repost, ["x:Someone"]), true);
assert.equal(followsPost(repost, ["X:someone"]), true);
assert.equal(followsPost({ id: "v", platform: "youtube", channelId: "UCabc", date: at(T17) }, ["youtube:UCabc"]), true);

console.log("ok feed order fixtures");
