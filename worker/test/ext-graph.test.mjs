import assert from "node:assert/strict";
import test from "node:test";
import { handleExtGraph, parseNitterList, avatarFrom, resetGraphState } from "../src/ext-graph.js";

/* Fixture data only: every name and handle below is a placeholder. */
function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(request) { const hit = store.get(request.url); return hit ? hit.clone() : undefined; },
    async put(request, response) { store.set(request.url, response.clone()); }
  };
}

function row(user, name, bio, extra) {
  return `<div class="timeline-item " data-username="${user}"><a class="tweet-link" href="/${user}"></a><div class="tweet-body"><div><div class="tweet-header"><a class="tweet-avatar" href="/${user}"><img class="avatar round" src="/pic/pbs.twimg.com%2Fprofile_images%2F1%2F${user}_normal.jpg" alt=""></a><div class="tweet-name-row"><div class="fullname-and-username"><a class="fullname" href="/${user}" title="${name}">${name}</a>${extra || ""}<a class="username" href="/${user}" title="@${user}">@${user}</a></div></div></div></div><div class="tweet-content media-body" dir="auto">${bio}</div></div></div>`;
}

function listPage(rows, cursor) {
  return `<html><head><title>People followed by @sample_one | nitter</title></head><body><div class="profile-card"><ul><li class="following"><span class="profile-stat-header">Following</span> <span class="profile-stat-num">1,234</span></li><li class="followers"><span class="profile-stat-header">Followers</span> <span class="profile-stat-num">56</span></li></ul></div><div class="timeline">${rows.join("")}${cursor ? `<div class="show-more"><a href="?cursor=${cursor}">Load more</a></div>` : ""}</div></body></html>`;
}

const PAGE1 = listPage([row("fake_alpha", "Fake &amp; Alpha", "Bio <a href=\"/x\">one</a>", '<div class="verified-icon blue"></div>'), row("fake_beta", "Fake Beta", "")], "CUR%7C123");
const PAGE2 = listPage([row("fake_gamma", "Fake Gamma", "last")], "");
const req = (path) => new Request("https://api.test" + path);

test("parseNitterList reads rows, counts, avatars and the next cursor", () => {
  const page = parseNitterList(PAGE1);
  assert.equal(page.isList, true);
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.items[0], { handle: "fake_alpha", name: "Fake & Alpha", avatar: "https://pbs.twimg.com/profile_images/1/fake_alpha_bigger.jpg", bio: "Bio one", verifiedType: "blue" });
  assert.equal(page.cursor, "CUR|123");
  assert.equal(page.following, 1234);
  assert.equal(page.followers, 56);
  assert.equal(avatarFrom("https://evil.example/a.jpg"), "");
  assert.equal(parseNitterList("<html><title>Making sure you're not a bot</title></html>").isList, false);
});

test("x route pages through Nitter, caches pages, and skips a challenged instance", async () => {
  resetGraphState();
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url: String(url), ua: init.headers["user-agent"] });
    if (String(url).startsWith("https://down.example")) return new Response("<html><title>Checking your browser</title></html>", { status: 200 });
    if (String(url).includes("cursor=")) return new Response(PAGE2, { status: 200 });
    return new Response(PAGE1, { status: 200 });
  };
  const deps = { fetch, cache: memoryCache(), now: () => 1000 };
  const env = { NITTER_BASES: "https://down.example,https://up.example" };
  const first = await (await handleExtGraph(req("/v1/ext-graph/x?handle=sample_one&tab=following"), env, deps)).json();
  assert.equal(first.items.length, 2);
  assert.equal(first.cursor, "CUR|123");
  assert.equal(first.following, 1234);
  assert.equal(seen[0].url, "https://down.example/sample_one/following");
  assert.equal(seen[1].url, "https://up.example/sample_one/following");
  assert.ok(!/Mozilla/.test(seen[1].ua));
  const again = await (await handleExtGraph(req("/v1/ext-graph/x?handle=sample_one&tab=following"), env, deps)).json();
  assert.equal(again.items.length, 2);
  assert.equal(seen.length, 2, "second read is served from the edge cache");
  const next = await (await handleExtGraph(req("/v1/ext-graph/x?handle=sample_one&tab=following&cursor=" + encodeURIComponent(first.cursor)), env, deps)).json();
  assert.equal(next.items[0].handle, "fake_gamma");
  assert.equal(next.cursor, "");
  assert.equal(seen[2].url, "https://up.example/sample_one/following?cursor=CUR%7C123", "dead instance is skipped for a while");
});

test("x route rejects bad input and reports when every source is down", async () => {
  resetGraphState();
  const deps = { fetch: async () => new Response("nope", { status: 503 }), cache: memoryCache(), now: () => 1000 };
  assert.equal((await handleExtGraph(req("/v1/ext-graph/x?handle=bad%20name"), {}, deps)).status, 400);
  const body = await (await handleExtGraph(req("/v1/ext-graph/x?handle=sample_two&tab=followers"), { NITTER_BASES: "https://only.example" }, deps)).json();
  assert.equal(body.unavailable, "sources_down");
  assert.deepEqual(body.items, []);
});

test("youtube route: no key, private subscriptions, and a public page", async () => {
  resetGraphState();
  const channel = "UC" + "a".repeat(22);
  const other = "UC" + "b".repeat(22);
  const noKey = await (await handleExtGraph(req("/v1/ext-graph/youtube?channel=" + channel), {}, { fetch: async () => { throw new Error("no fetch"); }, cache: memoryCache() })).json();
  assert.equal(noKey.unavailable, "no_key");
  const hiddenDeps = { fetch: async () => new Response(JSON.stringify({ error: { errors: [{ reason: "subscriptionForbidden" }] } }), { status: 403 }), cache: memoryCache(), now: () => 1000 };
  const hidden = await (await handleExtGraph(req("/v1/ext-graph/youtube?channel=" + channel), { YT_API_KEY: "test-key" }, hiddenDeps)).json();
  assert.equal(hidden.hidden, true);
  const seen = [];
  const okDeps = { fetch: async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ nextPageToken: "NEXT", pageInfo: { totalResults: 77 }, items: [{ snippet: { title: "Fake Channel", description: "d", resourceId: { channelId: other }, thumbnails: { default: { url: "https://yt3.example/p.jpg" } } } }] }), { status: 200 }); }, cache: memoryCache(), now: () => 1000 };
  const ok = await (await handleExtGraph(req("/v1/ext-graph/youtube?channel=" + channel), { YT_API_KEY: "test-key" }, okDeps)).json();
  assert.equal(ok.items[0].channelId, other);
  assert.equal(ok.cursor, "NEXT");
  assert.equal(ok.following, 77);
  assert.ok(/subscriptions\?/.test(seen[0]));
});
