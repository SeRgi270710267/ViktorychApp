import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const dispatches = [];
const hosts = [];

let mf;

function workerOptions() {
  return {
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("../..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    async outboundService(request) {
      const url = new URL(request.url);
      hosts.push(url.hostname);
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        return new Response(null, { status: 204 });
      }
      return new Response("no", { status: 404 });
    }
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
  return { status: res.status, body, text };
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("internal community posts stay off anonymous responses and attach to a Reddit comment", async () => {
  const anon = await call("/v1/communities/teslamotors", { ip: "203.0.113.20" });
  assert.equal(anon.status, 404);
  assert.equal(anon.body.error, "not_found");
  assert.equal(anon.body.posts, undefined);
  assert.equal(anon.text.indexOf("va_"), -1);

  const hidden = await call("/v1/owner/communities", { ip: "203.0.113.21" });
  assert.equal(hidden.status, 404);

  const ada = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.22",
    body: { displayName: "Ada Lovelace", handle: "ada_cm" }
  });
  assert.equal(ada.status, 201);

  const reply = await call("/v1/communities/teslamotors/posts", {
    method: "POST",
    ip: "203.0.113.23",
    token: ada.body.token,
    body: { text: "Written here, under the Reddit comment.", parentId: "t1_c0mm3nt01" }
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.post.parentId, "t1_c0mm3nt01");
  assert.match(reply.body.post.id, /^va_[a-f0-9]{16}$/);
  assert.equal(reply.body.post.author.displayName, "Ada Lovelace");

  const feed = await call("/v1/communities/teslamotors", { ip: "203.0.113.24", token: ada.body.token });
  assert.equal(feed.status, 200);
  assert.equal(feed.body.posts.length, 1);
  assert.equal(feed.body.posts[0].parentId, "t1_c0mm3nt01");
  assert.equal(feed.body.notes.length, 0);

  const grace = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.25",
    body: { displayName: "Grace", handle: "grace_cm" }
  });
  assert.equal(grace.status, 201);
  const nested = await call("/v1/communities/teslamotors/posts", {
    method: "POST",
    ip: "203.0.113.26",
    token: grace.body.token,
    body: { text: "A reply on ViktorychApp.", parentId: reply.body.post.id }
  });
  assert.equal(nested.status, 200);
  assert.equal(nested.body.post.parentId, reply.body.post.id);

  const noted = await call("/v1/communities/teslamotors", { ip: "203.0.113.27", token: ada.body.token });
  assert.equal(noted.body.notes.length, 1);
  assert.equal(noted.body.notes[0].id, "cm_" + nested.body.post.id);
  assert.equal(noted.body.notes[0].hash, "#/communities/teslamotors/" + encodeURIComponent(reply.body.post.id));

  const liked = await call("/v1/communities/teslamotors/likes", {
    method: "POST",
    ip: "203.0.113.28",
    token: ada.body.token,
    body: { itemId: "t3_post000001" }
  });
  assert.equal(liked.status, 200);
  assert.equal(liked.body.likes, 1);

  const joined = await call("/v1/communities/teslamotors/join", {
    method: "POST",
    ip: "203.0.113.29",
    token: ada.body.token
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.joined, true);
  assert.equal(joined.body.members, 1);

  const denied = await call("/v1/communities/teslamotors/posts/" + nested.body.post.id, {
    method: "DELETE",
    ip: "203.0.113.30",
    token: ada.body.token
  });
  assert.equal(denied.status, 403);

  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.31",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  const removed = await call("/v1/communities/teslamotors/posts/" + nested.body.post.id, {
    method: "DELETE",
    ip: "203.0.113.32",
    token: owner.body.token
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.deleted, true);

  const own = await call("/v1/communities/teslamotors/posts/" + reply.body.post.id, {
    method: "DELETE",
    ip: "203.0.113.33",
    token: ada.body.token
  });
  assert.equal(own.status, 200);

  dispatches.length = 0;
  const added = await call("/v1/owner/communities", {
    method: "POST",
    ip: "203.0.113.34",
    token: owner.body.token,
    body: { name: "https://www.reddit.com/r/teslamotors/hot" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.community.name, "teslamotors");
  assert.equal(added.body.dispatched, true);
  assert.ok(dispatches.some((path) => path.indexOf("/reddit.yml/dispatches") >= 0));
  assert.ok(dispatches.some((path) => path.indexOf("/sync.yml/dispatches") >= 0));
  assert.equal(hosts.indexOf("oauth.reddit.com"), -1);
  assert.equal(hosts.indexOf("www.reddit.com"), -1);
  assert.equal(hosts.indexOf("reddit.com"), -1);

  const stranger = await call("/v1/owner/communities", { ip: "203.0.113.35", token: ada.body.token });
  assert.equal(stranger.status, 403);

  const again = await call("/v1/communities/teslamotors", { ip: "203.0.113.36" });
  assert.equal(again.status, 404);
  assert.equal(again.text.indexOf("Written here"), -1);
});
