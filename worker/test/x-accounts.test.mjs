import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const dispatches = [];
const hosts = [];

let mf;

function nasaUser() {
  return {
    id: "11348282",
    name: "NASA",
    screen_name: "NASA",
    description: "Making the seemingly impossible, possible.",
    avatar_url: "https://pbs.twimg.com/profile_images/1321163587679784960/0ZxKlEKB_normal.jpg",
    banner_url: "https://pbs.twimg.com/profile_banners/11348282/1788992290",
    followers: 92310709,
    following: 115,
    tweets: 74449,
    location: "Pale Blue Dot",
    joined: "Wed Dec 19 20:20:32 +0000 2007",
    website: { url: "http://www.nasa.gov/" },
    url: "https://x.com/NASA",
    verification: { verified: true, type: "government" }
  };
}

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
      if (url.hostname === "api.x.com" || url.hostname === "api.twitter.com") {
        return new Response("paid", { status: 500 });
      }
      if (url.hostname === "api.fxtwitter.com") {
        const handle = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
        if (handle.toLowerCase() === "missing") {
          return new Response(JSON.stringify({ code: 404 }), { status: 404, headers: { "content-type": "application/json" } });
        }
        if (handle.toLowerCase() === "blocked") {
          return new Response("forbidden", { status: 403 });
        }
        if (handle.toLowerCase() === "redirected") {
          return new Response(null, { status: 302, headers: { location: "https://api.x.com/2/users/by/username/redirected" } });
        }
        return new Response(JSON.stringify({ code: 200, user: nasaUser() }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        const auth = request.headers.get("authorization") || "";
        if (!auth.startsWith("Bearer ")) return new Response("no", { status: 401 });
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
  return { status: res.status, body };
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("owner adds and removes an X account in private storage", async () => {
  const stranger = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.90",
    body: { displayName: "Ada", handle: "ada_x" }
  });
  assert.equal(stranger.status, 201);
  const denied = await call("/v1/owner/accounts", { ip: "203.0.113.91", token: stranger.body.token });
  assert.equal(denied.status, 403);
  const open = await call("/v1/owner/accounts", { ip: "203.0.113.92" });
  assert.equal(open.status, 404);

  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.93",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  assert.equal(owner.body.account.owner, true);

  const bad = await call("/v1/owner/accounts", {
    method: "POST",
    ip: "203.0.113.94",
    token: owner.body.token,
    body: { handle: "not a handle" }
  });
  assert.equal(bad.status, 400);

  const missing = await call("/v1/owner/accounts", {
    method: "POST",
    ip: "203.0.113.95",
    token: owner.body.token,
    body: { handle: "@missing" }
  });
  assert.equal(missing.status, 404);

  const blocked = await call("/v1/owner/accounts", {
    method: "POST",
    ip: "203.0.113.96",
    token: owner.body.token,
    body: { handle: "blocked" }
  });
  assert.equal(blocked.status, 503);

  const redirected = await call("/v1/owner/accounts", {
    method: "POST",
    ip: "203.0.113.97",
    token: owner.body.token,
    body: { handle: "redirected" }
  });
  assert.equal(redirected.status, 503);
  assert.equal(hosts.indexOf("api.x.com"), -1);
  assert.equal(hosts.indexOf("api.twitter.com"), -1);

  dispatches.length = 0;
  const added = await call("/v1/owner/accounts?platform=x", {
    method: "POST",
    ip: "203.0.113.98",
    token: owner.body.token,
    body: { handle: "https://x.com/NASA/status/1234567890", platform: "x" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.account.handle, "NASA");
  assert.equal(added.body.account.permanentId, "11348282");
  assert.equal(added.body.account.name, "NASA");
  assert.equal(added.body.account.verifiedType, "government");
  assert.equal(added.body.account.followers, 92310709);
  assert.equal(added.body.account.following, 115);
  assert.equal(added.body.account.postsCount, 74449);
  assert.equal(added.body.account.joined, "2007-12-19");
  assert.equal(added.body.account.website, "https://www.nasa.gov/");
  assert.ok(added.body.account.avatar.indexOf("_400x400.") >= 0);
  assert.ok(added.body.account.banner.endsWith("/1500x500"));
  assert.equal(added.body.account.bio.indexOf("impossible") >= 0, true);
  assert.equal(added.body.dispatched, true);
  assert.equal(added.body.removed, undefined);
  assert.ok(dispatches.some((path) => path.indexOf("/sync.yml/dispatches") >= 0));
  assert.ok(dispatches.some((path) => path.indexOf("/media-extract.yml/dispatches") >= 0));
  assert.equal(dispatches.some((path) => path.indexOf("tiktok") >= 0), false);

  const twitter = await call("/v1/owner/accounts", {
    method: "POST",
    ip: "203.0.113.99",
    token: owner.body.token,
    body: { url: "https://twitter.com/NASA" }
  });
  assert.equal(twitter.status, 200);
  assert.equal(twitter.body.account.handle, "NASA");
  assert.equal(twitter.body.account.permanentId, "11348282");

  const listed = await call("/v1/owner/accounts", { ip: "203.0.113.100", token: owner.body.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.added.length, 1);
  assert.equal(listed.body.removed, undefined);

  const leaked = await call("/v1/data/owner/added-accounts.json", { ip: "203.0.113.101", token: owner.body.token });
  assert.equal(leaked.status, 404);

  const bindings = await mf.getBindings();
  const stored = JSON.parse(await (await bindings.DATA.get("owner/added-accounts.json")).text());
  assert.equal(stored.added[0].handle, "NASA");
  assert.equal(stored.added[0].permanentId, "11348282");
  assert.ok(Array.isArray(stored.removed));

  const removed = await call("/v1/owner/accounts/NASA", {
    method: "DELETE",
    ip: "203.0.113.102",
    token: owner.body.token
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.added.length, 0);
  const after = JSON.parse(await (await bindings.DATA.get("owner/added-accounts.json")).text());
  assert.ok(after.removed.some((item) => item.toLowerCase() === "nasa"));
  assert.ok(after.removedIds.indexOf("11348282") >= 0);

  const strangerDelete = await call("/v1/owner/accounts/NASA", {
    method: "DELETE",
    ip: "203.0.113.103",
    token: stranger.body.token
  });
  assert.equal(strangerDelete.status, 403);

  const back = await call("/v1/owner/accounts", {
    method: "POST",
    ip: "203.0.113.104",
    token: owner.body.token,
    body: { handle: "@NASA" }
  });
  assert.equal(back.status, 200);
  const restored = JSON.parse(await (await bindings.DATA.get("owner/added-accounts.json")).text());
  assert.equal(restored.removed.some((item) => item.toLowerCase() === "nasa"), false);
  assert.equal(restored.removedIds.indexOf("11348282"), -1);
  assert.equal(restored.added[0].handle, "NASA");
});
