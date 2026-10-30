/* follow-lists.js against mocked sources. Placeholder accounts only. */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const FL = require(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "follow-lists.js"));

function json(body, headers) {
  return { ok: true, status: 200, headers: { get: (k) => (headers || {})[k.toLowerCase()] || "" }, json: async () => body };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(platform, subject, tab, more) {
  let done;
  const finished = new Promise((r) => { done = r; });
  const row = FL.load(platform, subject, tab, done, more);
  if (row.loading) await finished;
  await tick();
  return FL.state(platform, subject.handle, tab);
}

test("support table: X, Bluesky, Mastodon, Nostr both ways; YouTube following only; others none", async () => {
  assert.ok(FL.supports("x", "following") && FL.supports("x", "followers"));
  assert.ok(FL.supports("bsky", "followers") && FL.supports("mastodon", "following") && FL.supports("nostr", "followers"));
  assert.ok(FL.supports("youtube", "following") && !FL.supports("youtube", "followers"));
  for (const p of ["threads", "instagram", "tiktok", "telegram", "discord", "vk", "rss", "reddit"]) assert.ok(!FL.supports(p, "following"), p);
  FL.reset();
  const row = await settle("instagram", { handle: "placeholder" }, "following");
  assert.equal(row.none, true);
});

test("Bluesky pages with the AppView cursor and de-duplicates", async () => {
  FL.reset();
  const seen = [];
  FL.setDeps({ fetch: async (url) => {
    seen.push(url);
    if (!/cursor=/.test(url)) return json({ subject: { followsCount: 3 }, follows: [{ handle: "one.example", displayName: "One" }, { handle: "two.example" }], cursor: "C2" });
    return json({ follows: [{ handle: "two.example" }, { handle: "three.example", description: "bio" }] });
  } });
  const subject = { handle: "subject.example" };
  let row = await settle("bsky", subject, "following");
  assert.equal(row.items.length, 2);
  assert.equal(row.count, 3);
  assert.equal(row.cursor, "C2");
  assert.ok(/app\.bsky\.graph\.getFollows\?actor=subject\.example&limit=50$/.test(seen[0]));
  row = await settle("bsky", subject, "following", true);
  assert.deepEqual(row.items.map((i) => i.handle), ["one.example", "two.example", "three.example"]);
  assert.equal(row.cursor, "");
});

test("Mastodon follows the Link header on the same server, and treats 401 or an empty list as hidden", async () => {
  FL.reset();
  const next = "https://social.example/api/v1/accounts/9/following?limit=40&max_id=5";
  FL.setDeps({ fetch: async (url) => {
    if (url === next) return json([{ acct: "far@else.example", username: "far" }]);
    return json([{ acct: "near", username: "near", display_name: "Near", note: "<p>Hi &amp; bye</p>" }], { link: `<${next}>; rel="next", <https://social.example/x>; rel="prev"` });
  } });
  const subject = { handle: "who@social.example", instance: "social.example", remoteId: "9", following: 2, followers: 4 };
  let row = await settle("mastodon", subject, "following");
  assert.equal(row.items[0].handle, "near@social.example");
  assert.equal(row.items[0].bio, "Hi & bye");
  assert.equal(row.cursor, next);
  row = await settle("mastodon", subject, "following", true);
  assert.equal(row.items[1].handle, "far@else.example");
  FL.setDeps({ fetch: async () => json([]) });
  row = await settle("mastodon", subject, "followers");
  assert.equal(row.hidden, true);
  FL.reset();
  FL.setDeps({ fetch: async () => ({ ok: false, status: 401, headers: { get: () => "" } }) });
  row = await settle("mastodon", subject, "following");
  assert.equal(row.hidden, true);
});

test("X and YouTube go through the Worker pool and keep its flags", async () => {
  FL.reset();
  const paths = [];
  FL.setDeps({ call: async (p) => {
    paths.push(p);
    if (p.startsWith("/v1/ext-graph/youtube")) return { status: 200, items: [], cursor: "", hidden: true };
    if (/followers/.test(p)) return { status: 200, items: [], cursor: "", unavailable: "sources_down" };
    return { status: 200, items: [{ handle: "fake_one", name: "Fake One" }], cursor: "N1", following: 12 };
  } });
  let row = await settle("x", { handle: "@fake_subject" }, "following");
  assert.equal(paths[0], "/v1/ext-graph/x?handle=fake_subject&tab=following");
  assert.equal(row.items[0].id, "x:fake_one");
  assert.equal(row.count, 12);
  row = await settle("x", { handle: "@fake_subject" }, "followers");
  assert.equal(row.unavailable, "sources_down");
  row = await settle("youtube", { handle: "UC" + "c".repeat(22) }, "following");
  assert.equal(row.hidden, true);
});

test("Nostr reads the contact list, pages it, and says when Nostr is off", async () => {
  FL.reset();
  FL.setDeps({ nostr: () => null });
  let row = await settle("nostr", { handle: "npub1placeholder" }, "following");
  assert.equal(row.unavailable, "nostr_off");
  FL.reset();
  const pk = "a".repeat(64);
  const follows = Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(64, "0"));
  const N = {
    decode: () => ({ type: "npub", data: pk }),
    npub: (k) => "npub_" + k.slice(-4),
    shortNpub: (k) => "npub…" + k.slice(-4),
    profileOf: (ev) => JSON.parse(ev.content),
    query: async (filters) => {
      const f = filters[0];
      if (f.kinds[0] === 3) return [{ pubkey: pk, created_at: 10, tags: follows.map((k) => ["p", k]) }];
      return f.authors.slice(0, 1).map((k) => ({ pubkey: k, content: JSON.stringify({ name: "Placeholder" }) }));
    }
  };
  FL.setDeps({ nostr: () => N });
  row = await settle("nostr", { handle: "npub1placeholder" }, "following");
  assert.equal(row.items.length, 40);
  assert.equal(row.count, 45);
  assert.equal(row.items[0].name, "Placeholder");
  row = await settle("nostr", { handle: "npub1placeholder" }, "following", true);
  assert.equal(row.items.length, 45);
  assert.equal(row.cursor, "");
});
