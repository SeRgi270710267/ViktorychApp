const assert = require("assert");
const storage = require("../storage.js");

const GB = storage.GB;
assert.strictEqual(storage.defaultMaxBytes(0), 5 * GB);
assert.strictEqual(storage.defaultMaxBytes(2 * GB), 1 * GB);
assert.strictEqual(storage.defaultMaxBytes(64 * GB), 10 * GB);
assert.strictEqual(storage.defaultMaxBytes(200 * GB), 20 * GB);

assert.strictEqual(storage.keepMs("3d"), 3 * 24 * 60 * 60 * 1000);
assert.strictEqual(storage.keepMs("week"), 7 * 24 * 60 * 60 * 1000);
assert.strictEqual(storage.keepMs("month"), 30 * 24 * 60 * 60 * 1000);
assert.strictEqual(storage.keepMs("forever"), Infinity);
assert.strictEqual(storage.keepMs("nope"), 7 * 24 * 60 * 60 * 1000);

const week = storage.normalizePolicy({ keep: "week", maxBytes: 5 * GB });
assert.strictEqual(week.unlimited, false);
assert.strictEqual(week.maxBytes, 5 * GB);
assert.strictEqual(storage.normalizePolicy({ keep: "forever", unlimited: true }).unlimited, true);
assert.strictEqual(storage.normalizePolicy({ keep: "nope", maxBytes: 3 }).maxBytes, 5 * GB);

assert.strictEqual(storage.categoryOf("https://pbs.twimg.com/media/a.jpg"), "photos");
assert.strictEqual(storage.categoryOf("https://video.twimg.com/ext_tw_video/a.mp4"), "videos");
assert.strictEqual(storage.categoryOf("https://accounts.example/tg/music/abc/song.m4s"), "music");
assert.strictEqual(storage.categoryOf("https://accounts.example/tg/recordings/live/part.m4s"), "live");
assert.strictEqual(storage.categoryOf("https://viktorych.example/feeds.json"), "feeds");
assert.strictEqual(storage.categoryOf("https://viktorych.example/discord/messages/1.json"), "messages");
assert.strictEqual(storage.categoryOf("https://accounts.example/v1/owner/keys"), "");
assert.strictEqual(storage.categoryOf("https://accounts.example/v1/session"), "");
assert.strictEqual(storage.categoryOf("https://accounts.example/v1/owner/play?id=1"), "");
assert.strictEqual(storage.categoryOf("https://viktorych.example/owner-keys.js"), "");

assert.strictEqual(storage.shouldCacheMedia("https://accounts.example/tg/clips/a.mp4"), true);
assert.strictEqual(storage.shouldCacheMedia("https://accounts.example/tg/loop/v1/a.mp4"), false);
assert.strictEqual(storage.shouldCacheMedia("https://v16.tiktokcdn.com/a.mp4"), false);
assert.strictEqual(storage.shouldCacheMedia("https://accounts.example/v1/login"), false);
assert.strictEqual(storage.shouldCacheMedia("https://viktorych.example/feeds.json"), false);
assert.strictEqual(storage.shouldCacheMedia("https://cdn.discordapp.com/attachments/a.png"), true);
assert.strictEqual(storage.shouldCacheMedia("https://viktorych.example/discord/state.json"), false);
assert.strictEqual(storage.shouldCacheFeed("https://viktorych.example/feeds.json"), true);
assert.strictEqual(storage.shouldCacheFeed("https://viktorych.example/discord/state.json"), true);
assert.strictEqual(storage.shouldCacheFeed("https://accounts.example/v1/me"), false);
assert.strictEqual(storage.shouldCacheFeed("https://accounts.example/version.json"), false);

assert.strictEqual(storage.revalidateAction(304), "keep");
assert.strictEqual(storage.revalidateAction(200), "store");
assert.strictEqual(storage.revalidateAction(401), "skip");
assert.strictEqual(storage.revalidateAction(206), "skip");

const now = 1_000_000_000_000;
const day = 24 * 60 * 60 * 1000;
const rows = [
  { url: "old", bytes: 10, category: "videos", at: now - 10 * day, saved: now - 10 * day, cacheName: "media" },
  { url: "new", bytes: 10, category: "photos", at: now - day, saved: now - day, cacheName: "media" },
  { url: "feed", bytes: 5, category: "feeds", at: now - 40 * day, saved: now - 40 * day, cacheName: "data" },
  { url: "song", bytes: 80, category: "music", at: now - 90 * day, saved: now - 90 * day, cacheName: "sintel-music-offline" }
];
const expired = storage.planEviction(rows, 1000, now, storage.keepMs("week"));
assert.deepStrictEqual(expired.drop.map((row) => row.url), ["old"]);
assert.ok(expired.keep.some((row) => row.url === "song"));
assert.ok(expired.keep.some((row) => row.url === "feed"));

const capped = storage.planEviction([
  { url: "a", bytes: 30, category: "feeds", at: 1, saved: now, cacheName: "data" },
  { url: "b", bytes: 30, category: "photos", at: 2, saved: now, cacheName: "media" },
  { url: "c", bytes: 30, category: "videos", at: 3, saved: now, cacheName: "media" }
], 50, now, Infinity);
assert.deepStrictEqual(capped.drop.map((row) => row.url), ["a", "b"]);
assert.deepStrictEqual(capped.keep.map((row) => row.url), ["c"]);
assert.strictEqual(storage.mediaFresh(rows[0], { keep: "week" }, now), false);
assert.strictEqual(storage.mediaFresh(rows[1], { keep: "week" }, now), true);
assert.strictEqual(storage.mediaFresh(rows[3], { keep: "3d" }, now), true);

assert.deepStrictEqual(storage.parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
assert.deepStrictEqual(storage.parseByteRange("bytes=8-", 10), { start: 8, end: 9 });
assert.deepStrictEqual(storage.parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
assert.strictEqual(storage.parseByteRange("bytes=20-30", 10), null);
assert.strictEqual(storage.parseByteRange("bytes=", 10), null);

const usage = storage.usageHtml();
assert.ok(usage.includes("stor-donut"));
assert.ok(usage.includes("Keep media"));
assert.ok(usage.includes("Maximum cache size"));
assert.ok(usage.includes("Clear cache"));
assert.ok(usage.includes("Cache hits"));
assert.ok(usage.includes("Videos") && usage.includes("Live recordings") && usage.includes("Feeds and posts"));
const dataHtml = storage.dataHtml();
assert.ok(dataHtml.includes("#/settings/storage/usage"));
assert.ok(dataHtml.includes("1 week"));

const buf = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer;
const partial = storage.rangeResponse(buf, storage.parseByteRange("bytes=2-5", 10), "video/mp4");
assert.strictEqual(partial.status, 206);
assert.strictEqual(partial.headers.get("Content-Range"), "bytes 2-5/10");
assert.strictEqual(partial.headers.get("Content-Length"), "4");
partial.arrayBuffer().then((body) => {
  assert.deepStrictEqual(Array.from(new Uint8Array(body)), [2, 3, 4, 5]);
  const full = new Response(buf, { headers: { "Content-Type": "video/mp4", "Content-Length": "10" } });
  return storage.sliceCached(full, "bytes=0-1");
}).then((sliced) => {
  assert.strictEqual(sliced.status, 206);
  assert.strictEqual(sliced.headers.get("Content-Range"), "bytes 0-1/10");
  const huge = new Response(new Uint8Array(8), { headers: { "Content-Length": String(49 * 1024 * 1024) } });
  return storage.sliceCached(huge, "bytes=0-1");
}).then((skipped) => {
  assert.strictEqual(skipped, null);
  console.log("storage cache ok");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
