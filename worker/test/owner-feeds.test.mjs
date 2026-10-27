import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { sweepOwnerFeeds } from "../src/owner-feeds.js";

const OWNER = "ownerlane";
const dispatchBodies = [];
const hosts = [];
const gate = { failAll: false, note: "Hello from the sample" };

let mf;

function rss(title, note) {
  const line = note || "Hello from the sample";
  return `<rss><channel><title>${title}</title><item><title>${line}</title><description>${line}</description><guid>p1</guid><pubDate>2026-01-02T00:00:00Z</pubDate><link>https://feeds.example/p1</link></item><item><title>Second</title><description>Second note</description><guid>p2</guid><link>https://feeds.example/p2</link></item><item><title>Third</title><description>Third note</description><guid>p3</guid><link>https://feeds.example/p3</link></item></channel></rss>`;
}

async function outbound(request) {
      const url = new URL(request.url);
      hosts.push(url.hostname);
      if (url.hostname === "api.x.com" || url.hostname === "api.twitter.com") {
        return new Response("paid", { status: 500 });
      }
      if (url.hostname === "api.github.com") {
        dispatchBodies.push(await request.text());
        return new Response(null, { status: 204 });
      }
      if (gate.failAll) return new Response("down", { status: 503 });
      const path = decodeURIComponent(url.pathname + url.search);
      if (path.toLowerCase().includes("ratewind")) {
        return new Response("slow", { status: 429, headers: { "retry-after": "12" } });
      }
      if (url.hostname === "rsshub.app" && path.includes("/instagram/")) {
        return new Response("slow", { status: 429, headers: { "retry-after": "9" } });
      }
      if (url.hostname === "www.reddit.com") return new Response("down", { status: 503 });
      if (url.hostname === "api.fxtwitter.com") {
        return new Response("slow", { status: 429, headers: { "retry-after": "8" } });
      }
      if (path.includes("videos.xml") || url.hostname.includes("nitter") || url.hostname === "rsshub.app" || url.hostname === "rss-bridge.org" || url.hostname === "safereddit.com" || url.hostname === "redlib.fmhy.net" || url.hostname === "feeds.example" || path.endsWith(".rss")) {
        return new Response(rss("Sample Feed", gate.note), { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      if (url.hostname === "www.youtube.com") {
        return new Response('<html><link rel="canonical" href="https://www.youtube.com/channel/UCsamplechannel000000001"><meta property="og:title" content="Slow Wind"><meta property="og:image" content="https://cdn.example/yt.jpg"></html>', { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "www.tiktok.com") {
        return new Response('<html><meta property="og:title" content="Lane Harbor"><meta property="og:image" content="https://cdn.example/tt.jpg">"uniqueId":"laneharbor"</html>', { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "vk.com") {
        return new Response('<html>laneharbor<meta property="og:title" content="Lane Harbor"><meta property="og:image" content="https://cdn.example/vk.jpg"></html>', { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "t.me") {
        return new Response('<html><div class="tgme_channel_info">samplefeed</div><meta property="og:title" content="Sample Feed"><div class="tgme_widget_message_wrap"><div data-post="samplefeed/3"></div><div class="tgme_widget_message_text">Hello sample</div><time datetime="2026-01-02T00:00:00Z"></time></div></html>', { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "public.api.bsky.app" && path.includes("getProfile")) {
        return new Response(JSON.stringify({ handle: "northwind.bsky.social", displayName: "North Wind", avatar: "https://cdn.example/bsky.jpg" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "public.api.bsky.app") {
        return new Response(JSON.stringify({ feed: [{ post: { uri: "at://did:example/app.bsky.feed.post/one", author: { handle: "northwind.bsky.social" }, record: { text: "Hello from the sample", createdAt: "2026-01-02T00:00:00Z" } } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "social.example" && path.includes("lookup")) {
        return new Response(JSON.stringify({ username: "laneharbor", display_name: "Lane Harbor", avatar: "https://cdn.example/m.jpg", url: "https://social.example/@laneharbor" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("missing", { status: 404 });
}

function workerOptions() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: OWNER,
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    outboundService: outbound
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, retryAfter: res.headers.get("retry-after") };
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("owner feed catalog previews, confirms, and removes each source", async () => {
  const stranger = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.40",
    body: { displayName: "Guest", handle: "guestlane" }
  });
  assert.equal(stranger.status, 201);
  const hidden = await call("/v1/owner/feeds", { ip: "203.0.113.41" });
  assert.equal(hidden.status, 404);
  const denied = await call("/v1/owner/feeds", { ip: "203.0.113.42", token: stranger.body.token });
  assert.equal(denied.status, 403);

  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.43",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  const bindings = await mf.getBindings();
  const ownerBefore = await bindings.DB.prepare("SELECT handle, owner, display_name FROM accounts WHERE owner = 1").all();

  const facebook = await call("/v1/owner/feeds/preview", {
    method: "POST",
    ip: "203.0.113.44",
    token: owner.body.token,
    body: { input: "https://facebook.com/samplefeed" }
  });
  assert.equal(facebook.status, 400);
  assert.equal(facebook.body.error, "unsupported_facebook");
  const discord = await call("/v1/owner/feeds/preview", {
    method: "POST",
    ip: "203.0.113.45",
    token: owner.body.token,
    body: { input: "https://discord.gg/samplefeed" }
  });
  assert.equal(discord.status, 400);
  assert.equal(discord.body.error, "unsupported_discord");
  const local = await call("/v1/owner/feeds/preview", {
    method: "POST",
    ip: "203.0.113.46",
    token: owner.body.token,
    body: { input: "https://127.0.0.1/sample.xml" }
  });
  assert.equal(local.status, 400);

  const inputs = [
    "https://x.com/northwind",
    "https://www.threads.net/@laneharbor",
    "https://www.instagram.com/samplefeed/",
    "https://www.youtube.com/@slowwind",
    "https://www.tiktok.com/@laneharbor",
    "https://vk.com/laneharbor",
    "https://t.me/samplefeed",
    "https://www.reddit.com/r/samplefeed",
    "https://bsky.app/profile/northwind.bsky.social",
    "https://social.example/@laneharbor",
    "https://feeds.example/sample.xml"
  ];
  const ids = [];
  for (let i = 0; i < inputs.length; i++) {
    const beforeText = await bindings.DATA.get("owner/feeds-catalog.json");
    const beforeIds = beforeText ? JSON.parse(await beforeText.text()).accounts.map((row) => row.id) : [];
    const preview = await call("/v1/owner/feeds/preview", {
      method: "POST",
      ip: "203.0.113." + (50 + i),
      token: owner.body.token,
      body: { input: inputs[i] }
    });
    assert.equal(preview.status, 200, inputs[i] + " " + JSON.stringify(preview.body));
    assert.ok(preview.body.preview.name || preview.body.preview.handle);
    assert.ok(Array.isArray(preview.body.preview.posts));
    assert.ok(preview.body.preview.posts.length <= 3);
    const midText = await bindings.DATA.get("owner/feeds-catalog.json");
    const midIds = midText ? JSON.parse(await midText.text()).accounts.map((row) => row.id) : [];
    assert.deepEqual(midIds, beforeIds);
    if (i === 0) {
      const unconfirmed = await call("/v1/owner/feeds", {
        method: "POST",
        ip: "203.0.113.70",
        token: owner.body.token,
        body: { input: inputs[i] }
      });
      assert.equal(unconfirmed.status, 400);
      assert.equal(unconfirmed.body.error, "confirm");
    }
    dispatchBodies.length = 0;
    const added = await call("/v1/owner/feeds", {
      method: "POST",
      ip: "203.0.113." + (90 + i),
      token: owner.body.token,
      body: { input: inputs[i], confirm: true }
    });
    assert.equal(added.status, 200, inputs[i] + " " + JSON.stringify(added.body));
    assert.equal(added.body.dispatched, true);
    assert.ok(added.body.account.posts.length >= 1 || added.body.account.platform === "tiktok" || added.body.account.platform === "vk");
    ids.push(added.body.account.id);
    assert.equal(dispatchBodies.length, 1);
    assert.equal(dispatchBodies[0].includes("northwind"), false);
    assert.equal(dispatchBodies[0].includes("laneharbor"), false);
    assert.equal(JSON.parse(dispatchBodies[0]).ref, "main");
  }
  assert.equal(hosts.includes("api.x.com"), false);
  assert.equal(hosts.includes("api.twitter.com"), false);

  const leaked = await call("/v1/data/owner/feeds-catalog.json", { ip: "203.0.113.120", token: owner.body.token });
  assert.equal(leaked.status, 404);
  const listed = await call("/v1/owner/feeds", { ip: "203.0.113.121", token: owner.body.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.accounts.length, inputs.length);
  assert.equal(listed.body.removed, undefined);

  const paused = await call("/v1/owner/feeds/" + encodeURIComponent(ids[0]), {
    method: "PATCH",
    ip: "203.0.113.122",
    token: owner.body.token,
    body: { paused: true, label: "North" }
  });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.account.paused, true);
  assert.equal(paused.body.account.label, "North");
  assert.equal(paused.body.account.health.status, "paused");

  const resumed = await call("/v1/owner/feeds/" + encodeURIComponent(ids[0]), {
    method: "PATCH",
    ip: "203.0.113.123",
    token: owner.body.token,
    body: { paused: false }
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.account.paused, false);

  const group = await call("/v1/owner/feeds/groups", {
    method: "POST",
    ip: "203.0.113.124",
    token: owner.body.token,
    body: { name: "Harbor" }
  });
  assert.equal(group.status, 200);
  const gid = group.body.group.id;
  assert.match(gid, /^g[a-f0-9]{8}$/);
  const renamed = await call("/v1/owner/feeds/groups/" + gid, {
    method: "PATCH",
    ip: "203.0.113.125",
    token: owner.body.token,
    body: { name: "Wind" }
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.group.name, "Wind");
  const moved = await call("/v1/owner/feeds/reorder", {
    method: "POST",
    ip: "203.0.113.126",
    token: owner.body.token,
    body: { ids: [ids[1], ids[0]], groupId: gid }
  });
  assert.equal(moved.status, 200);
  const inGroup = moved.body.accounts.filter((row) => row.groupId === gid).sort((a, b) => a.order - b.order).map((row) => row.id);
  assert.deepEqual(inGroup, [ids[1], ids[0]]);
  const bulk = await call("/v1/owner/feeds/bulk", {
    method: "POST",
    ip: "203.0.113.127",
    token: owner.body.token,
    body: { ids: [ids[2]], pinned: true, muted: true }
  });
  assert.equal(bulk.status, 200);
  const pinned = bulk.body.accounts.find((row) => row.id === ids[2]);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.muted, true);

  const limited = await call("/v1/owner/feeds/preview", {
    method: "POST",
    ip: "203.0.113.128",
    token: owner.body.token,
    body: { input: "@ratewind" }
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate");
  assert.equal(limited.retryAfter, "12");

  const beforeFail = listed.body.accounts.find((row) => row.id === ids[10]);
  gate.failAll = true;
  const failed = await call("/v1/owner/feeds/" + encodeURIComponent(ids[10]) + "/retry", {
    method: "POST",
    ip: "203.0.113.129",
    token: owner.body.token,
    body: {}
  });
  gate.failAll = false;
  assert.equal(failed.body.account.health.status, "failing");
  assert.equal(failed.body.account.posts.length, beforeFail.posts.length);
  assert.equal(failed.body.account.posts[0].text, beforeFail.posts[0].text);

  const raw = JSON.parse(await (await bindings.DATA.get("owner/feeds-catalog.json")).text());
  raw.accounts.forEach((row) => { row.health = Object.assign({}, row.health, { nextAt: 1 }); });
  await bindings.DATA.put("owner/feeds-catalog.json", JSON.stringify(raw));
  gate.note = "Refreshed note";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => outbound(new Request(url, init));
  try {
    const ran = await sweepOwnerFeeds(bindings, Date.parse("2026-01-03T00:00:00Z"));
    assert.equal(ran, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  const swept = JSON.parse(await (await bindings.DATA.get("owner/feeds-catalog.json")).text());
  const refreshed = swept.accounts.filter((row) => (row.posts || []).some((post) => post.text === "Refreshed note"));
  assert.equal(refreshed.length, 1);
  const waiting = swept.accounts.filter((row) => Number(row.health && row.health.nextAt) === 1);
  assert.ok(waiting.length >= 1);

  const removed = await call("/v1/owner/feeds/" + encodeURIComponent(ids[0]), {
    method: "DELETE",
    ip: "203.0.113.130",
    token: owner.body.token
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.accounts.some((row) => row.id === ids[0]), false);
  const mirror = JSON.parse(await (await bindings.DATA.get("owner/added-accounts.json")).text());
  assert.ok(mirror.removed.some((item) => String(item).toLowerCase() === "northwind"));
  const ownerAfter = await bindings.DB.prepare("SELECT handle, owner, display_name FROM accounts WHERE owner = 1").all();
  assert.deepEqual(ownerAfter.results, ownerBefore.results);
});
