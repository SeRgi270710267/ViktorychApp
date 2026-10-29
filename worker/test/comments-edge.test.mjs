import test from "node:test";
import assert from "node:assert/strict";
import { handleComments, _test } from "../src/comments-edge.js";

function memCache() {
  const rows = new Map();
  return {
    rows,
    async match(req) { const hit = rows.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { rows.set(req.url, res.clone()); }
  };
}

function fakeFetch(table) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [prefix, body] of table) {
      if (url.indexOf(prefix) === 0) {
        if (body === 500) return new Response("down", { status: 500 });
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("nope", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const fxPage = {
  code: 200,
  status: { id: "1", text: "root", author: { screen_name: "a", description: "long bio", banner_url: "b", avatar_url: "c", followers: 3, joined: "x" } },
  replies: [{ id: "2", text: "hi", raw_text: { text: "hi", facets: [] }, author: { screen_name: "b", description: "bio", website: "w", avatar_url: "d" } }]
};

test("rejects bad ids and sources", async () => {
  const deps = { fetch: fakeFetch([]), cache: memCache() };
  for (const q of ["src=x&id=abc", "src=yt&id=short", "src=zz&id=1", "src=bsky&id=https://evil", "src=reddit&id=../x"]) {
    const res = await handleComments(new Request("https://w/v1/comments?" + q), deps);
    assert.equal(res.status, 400, q);
  }
  assert.equal(deps.fetch.calls.length, 0);
});

test("x pages are slimmed and cached at the edge", async () => {
  const fetch = fakeFetch([["https://api.fxtwitter.com/2/conversation/123", fxPage]]);
  const deps = { fetch, cache: memCache(), now: () => 5 };
  const req = () => new Request("https://w/v1/comments?src=x&id=123");
  const first = await handleComments(req(), deps);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-comments-cache"), "miss");
  assert.match(first.headers.get("cache-control"), /max-age=90/);
  const body = await first.json();
  assert.equal(body.data.replies[0].text, "hi");
  assert.equal(body.data.replies[0].raw_text, undefined);
  assert.equal(body.data.replies[0].author.description, undefined);
  assert.equal(body.data.replies[0].author.avatar_url, "d");
  assert.equal(body.data.status.author.followers, 3);
  assert.equal(body.data.status.author.banner_url, undefined);
  const second = await handleComments(req(), deps);
  assert.equal(second.headers.get("x-comments-cache"), "hit");
  assert.equal(fetch.calls.length, 1);
});

test("newest sort and cursor reach the upstream", () => {
  assert.deepEqual(_test.targets("x", "9", "new", "abc"), ["https://api.fxtwitter.com/2/conversation/9?ranking_mode=recency&cursor=abc"]);
  assert.match(_test.targets("reddit", "abc", "top", "")[0], /\/comments\/abc\.json\?limit=20&depth=2&raw_json=1&sort=top$/);
  assert.match(_test.targets("bsky", "at://did:plc:x/app.bsky.feed.post/y", "top", "")[0], /depth=2&parentHeight=0$/);
});

test("youtube fails over across instances and failures are cached briefly", async () => {
  const fetch = fakeFetch([
    ["https://yt.chocolatemoo53.com/", 500],
    ["https://invidious.tiekoetter.com/api/v1/comments/AbCdEfGh123?sort_by=top", { comments: [{ commentId: "c", content: "x" }], commentCount: 1 }]
  ]);
  const deps = { fetch, cache: memCache() };
  const res = await handleComments(new Request("https://w/v1/comments?src=yt&id=AbCdEfGh123"), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).from, "invidious.tiekoetter.com");
  const down = { fetch: fakeFetch([]), cache: memCache() };
  const bad = await handleComments(new Request("https://w/v1/comments?src=reddit&id=t3_abc"), down);
  assert.equal(bad.status, 502);
  assert.match(bad.headers.get("cache-control"), /max-age=30/);
  await handleComments(new Request("https://w/v1/comments?src=reddit&id=t3_abc"), down);
  assert.equal(down.fetch.calls.length, 1);
});
