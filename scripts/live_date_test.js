/* Live YouTube dates must be the original upload, never the fetch time. */
const assert = require("assert");
const fs = require("fs");

const src = fs.readFileSync("app.js", "utf8");

function grab(name) {
  const marker = "function " + name + "(";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("missing " + name);
  let depth = 0;
  let started = false;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error("unclosed " + name);
}

const stamp = src.match(/const LIVE_STAMP_MS = [^;]+;/);
if (!stamp) throw new Error("missing LIVE_STAMP_MS");
const names = [
  "relativeLabel",
  "timeMs",
  "earlierIso",
  "calendarDate",
  "ivIso",
  "liveStamp",
  "staleLiveVideoDate",
  "ivPublish",
  "livePublishDate"
];
const code = stamp[0] + "\n" + names.map(grab).join("\n");
const api = new Function(code + "\nreturn { relativeLabel, ivPublish, livePublishDate, staleLiveVideoDate, earlierIso, calendarDate };")();

const now = Date.parse("2026-10-22T07:36:25Z");
const embassy = "2026-10-22T04:26:33+00:00";
const embassyMs = Date.parse(embassy);
const fetched = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
const october3 = "2026-10-03T00:00:00.000Z";

["0 seconds ago", "10 min ago", "1 hr ago", "2 hrs ago", "5 mins ago", "1 day ago", "3 weeks ago", "1 year ago", "Streamed 1 week ago", "Premiered 3 hours ago", "2d ago", "a minute ago", "an hour ago"].forEach((label) => {
  assert.strictEqual(api.relativeLabel(label), true, label);
});
assert.strictEqual(api.relativeLabel("Oct 3, 2026"), false);
assert.strictEqual(api.relativeLabel("2026-10-03T00:00:00.000Z"), false);
assert.strictEqual(api.calendarDate("Oct 3, 2026"), october3);

assert.strictEqual(api.ivPublish({ published: Math.floor(now / 1000), publishedText: "0 seconds ago" }, now), "");
assert.strictEqual(api.ivPublish({ published: Math.floor(now / 1000) - 600, publishedText: "10 min ago" }, now), "");
assert.strictEqual(api.ivPublish({ published: Math.floor(now / 1000) - 600, publishedText: "" }, now), "");
assert.strictEqual(api.ivPublish({ published: Math.floor(now / 1000), publishedText: "Oct 3, 2026" }, now), october3);
assert.strictEqual(api.ivPublish({ published: Math.floor(Date.parse(october3) / 1000), publishedText: "" }, now), "2026-10-03T00:00:00Z");

const grocery = { watch: true, date: fetched, dateFrom: "" };
assert.strictEqual(api.livePublishDate(grocery, "", embassyMs, now), "", "an old video dated at fetch time is not new");
assert.strictEqual(api.livePublishDate({ watch: true, date: "", dateFrom: "relative" }, "", embassyMs, now), "");
assert.strictEqual(api.livePublishDate({ watch: true, date: fetched, dateFrom: "relative" }, "", embassyMs, now), "");
assert.strictEqual(api.livePublishDate({ watch: true, date: fetched }, embassy, embassyMs, now), embassy, "the RSS published time wins");
assert.strictEqual(api.livePublishDate({ watch: true, date: october3 }, "", embassyMs, now), october3, "a real older upload stays on that day");
assert.ok(Date.parse(october3) < embassyMs);

assert.strictEqual(api.staleLiveVideoDate(fetched, false, embassyMs), true);
assert.strictEqual(api.staleLiveVideoDate(embassy, true, embassyMs), false);
assert.strictEqual(api.staleLiveVideoDate(embassy, false, 0), false, "a stored upload is kept when the RSS did not load");
assert.strictEqual(api.staleLiveVideoDate(october3, false, embassyMs), false);

const mergeStart = src.indexOf("function mergeLiveYoutube");
const mergeEnd = src.indexOf("function liveYoutube", mergeStart + 1);
const merge = src.slice(mergeStart, mergeEnd);
assert.ok(!merge.includes("rememberSeen("), "merge does not stamp the fetch time");
assert.ok(!merge.includes("seenDates("), "merge does not read a fetch time back onto a post");
assert.ok(merge.includes("livePublishDate("));
assert.ok(merge.includes("staleLiveVideoDate("));

console.log("ok live youtube dates");
