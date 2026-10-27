import assert from "node:assert/strict";
import test from "node:test";
import {
  backoffMs,
  bulkPatch,
  detectInput,
  healthStatus,
  mergeOffline,
  organizeFeeds,
  reorderGroups,
  reorderWithin,
  sortRows,
  sourcePlan
} from "../shared/feed-sources.js";

const samples = [
  ["x", "@northwind", "northwind"],
  ["threads", "https://www.threads.net/@laneharbor", "laneharbor"],
  ["instagram", "https://www.instagram.com/samplefeed/", "samplefeed"],
  ["youtube", "https://www.youtube.com/@slowwind", "slowwind"],
  ["tiktok", "https://www.tiktok.com/@laneharbor", "laneharbor"],
  ["vk", "https://vk.com/laneharbor", "laneharbor"],
  ["telegram", "https://t.me/samplefeed", "samplefeed"],
  ["reddit", "https://www.reddit.com/r/samplefeed", "samplefeed"],
  ["bluesky", "https://bsky.app/profile/northwind.bsky.social", "northwind.bsky.social"],
  ["mastodon", "https://social.example/@laneharbor", "laneharbor"],
  ["rss", "https://feeds.example/sample.xml", "feeds-example-sample-xml"]
];

test("each supported source is detected and has a public plan", () => {
  samples.forEach((row) => {
    const spec = detectInput(row[1]);
    assert.equal(spec.ok, true, row[0]);
    assert.equal(spec.platform, row[0]);
    assert.equal(spec.handle, row[2]);
    const plan = sourcePlan(spec);
    assert.ok(plan.length > 0, row[0]);
    plan.forEach((step) => {
      assert.equal(step.url.startsWith("https://"), true);
      assert.equal(step.url.includes("api.x.com"), false);
      assert.equal(step.url.includes("api.twitter.com"), false);
    });
  });
  assert.equal(detectInput("https://facebook.com/samplefeed").error, "unsupported_facebook");
  assert.equal(detectInput("https://discord.gg/samplefeed").error, "unsupported_discord");
  assert.equal(detectInput("https://127.0.0.1/sample.xml").error, "private_host");
  assert.equal(detectInput("http://feeds.example/sample.xml").error, "bad_feed");
});

test("feeds can be filtered, sorted, reordered, and patched", () => {
  const groups = [{ id: "gaaaaaaaa", name: "Harbor", order: 1 }, { id: "gbbbbbbbb", name: "Wind", order: 0 }];
  const rows = [
    { id: "x:northwind", platform: "x", handle: "northwind", name: "North", groupId: "gbbbbbbbb", pinned: false, addedAt: "2026-01-01", lastPost: "2026-01-03", order: 1, health: { status: "ok" } },
    { id: "rss:sample", platform: "rss", handle: "sample", name: "Sample", groupId: "", pinned: true, addedAt: "2026-01-02", lastPost: "2026-01-01", order: 0, health: { status: "failing" } },
    { id: "tg:samplefeed", platform: "telegram", handle: "samplefeed", name: "Sample Feed", groupId: "gaaaaaaaa", pinned: false, paused: true, addedAt: "2026-01-04", lastPost: "", order: 0, health: { status: "ok" } }
  ];
  const named = sortRows(rows, "name").map((row) => row.id);
  assert.equal(named[0], "rss:sample");
  const organized = organizeFeeds(rows, groups, { sort: "name" });
  assert.equal(organized.sections[0].id, "gbbbbbbbb");
  assert.equal(organized.sections[0].rows[0].id, "x:northwind");
  const failing = organizeFeeds(rows, groups, { status: "failing" });
  assert.equal(failing.count, 1);
  assert.equal(failing.sections.at(-1).rows[0].id, "rss:sample");
  const paused = organizeFeeds(rows, groups, { status: "paused", group: "gaaaaaaaa" });
  assert.equal(paused.count, 1);
  assert.equal(healthStatus(rows[2]), "paused");
  const searched = organizeFeeds(rows, groups, { q: "north", platform: "x" });
  assert.equal(searched.count, 1);
  const moved = reorderWithin(rows, "gbbbbbbbb", "x:northwind", "x:northwind");
  assert.equal(moved.length, 3);
  const shifted = reorderGroups(groups, ["gaaaaaaaa", "gbbbbbbbb"]);
  assert.equal(shifted[0].id, "gaaaaaaaa");
  assert.equal(shifted[0].order, 0);
  const patched = bulkPatch(rows, ["x:northwind", "rss:sample"], { muted: true, groupId: "gaaaaaaaa" });
  assert.equal(patched[0].muted, true);
  assert.equal(patched[0].groupId, "gaaaaaaaa");
  assert.equal(patched[2].muted, undefined);
});

test("offline keeps the last saved catalog and backoff honors 429", () => {
  const cached = { accounts: [{ id: "x:northwind", posts: [{ id: "1", text: "kept" }] }], groups: [], places: [] };
  const offline = mergeOffline(cached, null);
  assert.equal(offline.offline, true);
  assert.equal(offline.doc.accounts[0].posts[0].text, "kept");
  const live = mergeOffline(cached, { accounts: [{ id: "x:laneharbor" }], groups: [], places: [] });
  assert.equal(live.offline, false);
  assert.equal(live.doc.accounts[0].id, "x:laneharbor");
  assert.equal(backoffMs(0, 429, 12), 5 * 60 * 1000);
  assert.equal(backoffMs(0, 429, 600), 600 * 1000);
  assert.equal(backoffMs(3, 503, 0), 60 * 60 * 1000);
  assert.equal(backoffMs(0, 503, 0), 30 * 1000);
});
