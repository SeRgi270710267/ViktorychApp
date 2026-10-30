import assert from "node:assert/strict";
import test from "node:test";
import { withBlocks } from "../src/index.js";
import blocks from "../../shared/blocklist.js";

// Neutral fake handles only.
const jsonRes = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
const get = (path, headers) => new Request("https://accounts.test" + path, { headers: headers || {} });
const header = (settings) => blocks.headerValue(blocks.rulesFromSettings(settings));

const doc = () => ({
  feeds: [{ id: "feed-alpha", handle: "alpha_one", platform: "x" }],
  posts: [
    { id: "1", statusId: "1", handle: "alpha_one", platform: "x", text: "hello" },
    { id: "2", statusId: "2", handle: "beta_two", platform: "x", text: "keep", quoted: { statusId: "9", handle: "alpha_one", text: "q" } },
    { id: "3", statusId: "3", handle: "gamma_three", platform: "bluesky", text: "one post" },
    { id: "4", handle: "delta", platform: "reddit", subreddit: "sample_sub", text: "sub post" },
    { id: "5", handle: "beta_two", platform: "x", kind: "reply", replyingTo: { id: "2" }, text: "reply" },
    { id: "6", handle: "beta_two", platform: "x", text: "keep too",
      replies: [{ id: "6a", handle: "alpha_one", platform: "x", text: "nested comment" }, { id: "6b", handle: "epsilon", platform: "x", text: "ok" }] }
  ]
});

test("hashed header drops blocked accounts, posts, sources, types and nested comments", async () => {
  const h = header({ blocks: { accounts: ["x:alpha_one"], posts: ["bluesky:3"], sources: ["reddit:sample_sub"], types: { "x:beta_two": ["replies"] } } });
  assert.match(h, /^1\.[0-9a-z.]+$/);
  assert.ok(!/alpha|beta|gamma|sample/.test(h), "no raw handle in the header");
  const res = await withBlocks(get("/v1/data/feeds.json", { "X-Block": h }), jsonRes(doc()));
  const out = await res.json();
  assert.deepEqual(out.posts.map((p) => p.id), ["2", "6"]);
  assert.equal(out.posts[0].quoted, null, "quote of a blocked account loses its body");
  assert.equal(out.posts[0].quoteBlocked, true);
  assert.deepEqual(out.posts[1].replies.map((p) => p.id), ["6b"]);
  assert.equal(out.feeds.length, 1, "feed rows are never filtered");
  assert.equal(res.headers.get("x-block-removed"), "6");
  assert.match(res.headers.get("vary") || "", /X-Block/i);
});

test("a bare muted handle matches every platform, as before", async () => {
  const h = header({ mutedAccounts: ["gamma_three"] });
  const out = await (await withBlocks(get("/v1/posts", { "X-Block": h }), jsonRes(doc()))).json();
  assert.ok(!out.posts.some((p) => p.handle === "gamma_three"));
});

test("no header, bad header, writes and other paths pass through untouched", async () => {
  const body = doc();
  const plain = await withBlocks(get("/v1/data/feeds.json"), jsonRes(body));
  assert.equal((await plain.json()).posts.length, 6);
  const bad = await withBlocks(get("/v1/data/feeds.json", { "X-Block": "alpha_one" }), jsonRes(body));
  assert.equal((await bad.json()).posts.length, 6);
  const h = header({ blocks: { accounts: ["x:alpha_one"] } });
  const other = await withBlocks(get("/v1/me", { "X-Block": h }), jsonRes(body));
  assert.equal((await other.json()).posts.length, 6);
  const post = new Request("https://accounts.test/v1/posts", { method: "POST", body: "{}", headers: { "X-Block": h } });
  assert.equal((await (await withBlocks(post, jsonRes(body))).json()).posts.length, 6);
});

test("header is compact and capped", () => {
  const accounts = Array.from({ length: 20 }, (_, i) => "x:fake_user_" + i);
  const h = header({ blocks: { accounts } });
  assert.ok(h.length < 200, "20 accounts fit in under 200 bytes, got " + h.length);
  const many = header({ blocks: { posts: Array.from({ length: 2000 }, (_, i) => "x:" + i) } });
  assert.equal(blocks.parseHeader(many).size, blocks.MAX_HASHES);
});
