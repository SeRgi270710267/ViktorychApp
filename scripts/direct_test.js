const assert = require("assert");
const direct = require("../direct.js");

direct.reset();
assert.strictEqual(direct.allows("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app"), true);
assert.strictEqual(direct.allows("https://mastodon.social/api/v1/accounts/lookup?acct=test"), true);
assert.strictEqual(direct.allows("https://fosstodon.org/api/v1/accounts/lookup?acct=test"), true);
assert.strictEqual(direct.allows("https://api.fxtwitter.com/x"), true);
assert.strictEqual(direct.allows("https://archive.org/metadata/sintel"), true);
assert.strictEqual(direct.allows("https://raw.githubusercontent.com/ViktorychGroup/ViktorychApp/main/feeds.json"), true);
assert.strictEqual(direct.allows("https://api.invidious.io/instances.json"), true);
assert.strictEqual(direct.allows("https://accounts.example.workers.dev/v1/data/feeds.json"), false);
assert.strictEqual(direct.allows("https://accounts.example/v1/owner/keys"), false);
assert.strictEqual(direct.allows("https://accounts.example/v1/session"), false);
assert.strictEqual(direct.allows("https://api.example.onrender.com/v1/geo"), false);
assert.strictEqual(direct.allows("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=a"), true);

const headers = direct.safeHeaders({ headers: { Authorization: "Bearer secret", Cookie: "sid=1", Accept: "application/json", "X-Owner-Key": "nope" } });
assert.strictEqual(headers.authorization, undefined);
assert.strictEqual(headers.cookie, undefined);
assert.strictEqual(headers["x-owner-key"], undefined);
assert.strictEqual(headers.accept, "application/json");

assert.strictEqual(direct.shouldFallback(500, null), true);
assert.strictEqual(direct.shouldFallback(503, null), true);
assert.strictEqual(direct.shouldFallback(0, null), true);
assert.strictEqual(direct.shouldFallback(200, null), false);
assert.strictEqual(direct.shouldFallback(404, null), false);
assert.strictEqual(direct.shouldFallback(401, new Error("cors")), true);

assert.strictEqual(direct.paceWait("mastodon.social", 1000), 0);
direct.markPace("mastodon.social", 1000);
assert.strictEqual(direct.paceWait("mastodon.social", 1500), 600);

const mirror = direct.githubMirror("https://raw.githubusercontent.com/ViktorychGroup/ViktorychApp/main/feeds.json");
assert.strictEqual(mirror, "https://cdn.jsdelivr.net/gh/ViktorychGroup/ViktorychApp@main/feeds.json");
assert.strictEqual(direct.bskyProfileUrl("bsky.app"), "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app");
assert.ok(direct.bskyFeedUrl("@bsky.app").indexOf("limit=30") > 0);
assert.strictEqual(direct.mastodonLookup("mastodon.social", "Gargron"), "https://mastodon.social/api/v1/accounts/lookup?acct=Gargron");
assert.deepStrictEqual(direct.splitMastodon("https://fosstodon.org/@alice"), { instance: "fosstodon.org", acct: "alice" });
assert.strictEqual(direct.splitBsky("https://bsky.app/profile/bsky.app"), "bsky.app");

const calls = [];
direct.setFetch(function (url) {
  calls.push(url);
  if (String(url).indexOf("raw.githubusercontent.com") >= 0) return Promise.reject(new Error("cors"));
  if (String(url).indexOf("workers.dev") >= 0) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ via: "server" }); } });
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ via: "device", url: url }); } });
});

direct.reset();
direct.setFetch(function (url) {
  calls.push(url);
  if (String(url).indexOf("raw.githubusercontent.com") >= 0) return Promise.reject(new Error("cors"));
  if (String(url).indexOf("workers.dev") >= 0) return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ via: "server" }); } });
  if (String(url).indexOf("status=500") >= 0) return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ via: "device", url: url }); } });
});

direct.json("https://raw.githubusercontent.com/ViktorychGroup/ViktorychApp/main/feeds.json").then(function (body) {
  assert.strictEqual(body.via, "device");
  assert.ok(calls.some((url) => String(url).indexOf("cdn.jsdelivr.net") >= 0));
  assert.ok(direct.counts().direct >= 1);
  return direct.json("https://api.fxtwitter.com/x");
}).then(function (body) {
  assert.strictEqual(body.via, "device");
  const before = calls.length;
  return direct.json("https://api.fxtwitter.com/x").then(function (cached) {
    assert.strictEqual(cached.via, "device");
    assert.strictEqual(calls.length, before);
    return direct.fetch("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=bsky.app&status=500", "https://edge.example.workers.dev/v1/data/bsky.json");
  });
}).then(function (res) {
  assert.strictEqual(res.ok, true);
  assert.ok(direct.counts().server >= 1);
  const rows = direct.audit();
  const moved = rows.filter((row) => row.where === "device").map((row) => row.id);
  const stay = rows.filter((row) => row.where === "server").map((row) => row.id);
  assert.ok(moved.indexOf("bluesky") >= 0 && moved.indexOf("mastodon") >= 0 && moved.indexOf("fxtwitter") >= 0 && moved.indexOf("github-raw") >= 0 && moved.indexOf("open-meteo") >= 0);
  assert.ok(stay.indexOf("geo") >= 0 && stay.indexOf("owner-and-session") >= 0 && stay.indexOf("telegram") >= 0 && stay.indexOf("youtube-media") >= 0);
  assert.ok(rows.some((row) => row.id === "sports" && row.where === "unchanged"));
  console.log("direct fetch ok");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
