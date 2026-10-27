import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

let mf;
const twitterMockUsers = {};
const twitterMockTweets = {};

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
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    },
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname === "api.fxtwitter.com") {
        if (url.pathname.startsWith("/status/")) {
          const statusId = url.pathname.replace("/status/", "");
          const tweet = twitterMockTweets[statusId];
          if (tweet) {
            return new Response(JSON.stringify({ code: 200, tweet }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
          return new Response(JSON.stringify({ code: 404 }), { status: 404 });
        }
        const handle = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
        const user = twitterMockUsers[handle];
        if (user) {
          return new Response(JSON.stringify({ code: 200, user }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ code: 404 }), { status: 404 });
      }
      if (url.hostname === "t.me") {
        const handle = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
        const bio = twitterMockUsers[handle] ? twitterMockUsers[handle].description : "";
        const html = `<html><div class="tgme_page_title"><span>${handle} channel</span></div><div class="tgme_page_description">${bio}</div></html>`;
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname.includes("youtube.com")) {
        const handle = decodeURIComponent(url.pathname.replace(/^\/@?/, "")).toLowerCase();
        const bio = twitterMockUsers[handle] ? twitterMockUsers[handle].description : "";
        return new Response(`<html><body><h1>YouTube</h1><p>${bio}</p></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname.includes("instagram.com")) {
        const handle = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
        const bio = twitterMockUsers[handle] ? twitterMockUsers[handle].description : "";
        return new Response(`<html><body><h1>Instagram</h1><p>${bio}</p></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
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

async function signup(ip, handle, name) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    body: { displayName: name, handle }
  });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("social profile challenge generation, bio verification, and post verification", async () => {
  const user = await signup("203.0.113.50", "alice_id", "Alice");

  // 1. Challenge generation for X profile
  const chalRes = await call("/v1/account/identities/challenge", {
    method: "POST",
    token: user.token,
    ip: "203.0.113.51",
    body: { platform: "x", handle: "@alice_x" }
  });
  assert.equal(chalRes.status, 200);
  assert.ok(chalRes.body.challengeId);
  assert.ok(chalRes.body.code.startsWith("va-id-"));
  assert.equal(chalRes.body.handle, "alice_x");
  const code = chalRes.body.code;
  const challengeId = chalRes.body.challengeId;

  // 2. Verification fails when bio doesn't contain code
  twitterMockUsers["alice_x"] = {
    screen_name: "alice_x",
    name: "Alice on X",
    description: "Just a regular bio without code",
    avatar_url: "https://pbs.twimg.com/alice.jpg"
  };
  const failRes = await call("/v1/account/identities/verify", {
    method: "POST",
    token: user.token,
    ip: "203.0.113.52",
    body: { challengeId }
  });
  assert.equal(failRes.status, 400);
  assert.equal(failRes.body.error, "verification_code_not_found");

  // 3. Verification succeeds when bio contains the challenge code!
  twitterMockUsers["alice_x"].description = `Verifying identity on ViktorychApp: ${code}`;
  const okRes = await call("/v1/account/identities/verify", {
    method: "POST",
    token: user.token,
    ip: "203.0.113.53",
    body: { challengeId }
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.ok, true);
  assert.equal(okRes.body.identity.platform, "x");
  assert.equal(okRes.body.identity.handle, "alice_x");
  assert.equal(okRes.body.identity.verified, true);
  assert.equal(okRes.body.identity.verificationType, "bio");

  // 4. Verify that identity shows up in user's list
  const listRes = await call("/v1/account/identities", {
    token: user.token,
    ip: "203.0.113.54"
  });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.identities.length, 1);
  assert.equal(listRes.body.identities[0].handle, "alice_x");

  // 5. Verify that public profile includes identities
  const profRes = await call(`/v1/profile/alice_id`, {
    token: user.token,
    ip: "203.0.113.55"
  });
  assert.equal(profRes.status, 200);
  assert.ok(Array.isArray(profRes.body.account.identities));
  assert.equal(profRes.body.account.identities.length, 1);
  assert.equal(profRes.body.account.identities[0].platform, "x");
  assert.equal(profRes.body.account.identities[0].handle, "alice_x");

  // 6. Test post-based verification for Telegram channel
  const tgChal = await call("/v1/account/identities/challenge", {
    method: "POST",
    token: user.token,
    ip: "203.0.113.56",
    body: { platform: "telegram", handle: "alice_channel" }
  });
  assert.equal(tgChal.status, 200);
  const tgCode = tgChal.body.code;
  twitterMockUsers["alice_channel"] = {
    description: `Official Telegram channel. Code: ${tgCode}`
  };
  const tgOk = await call("/v1/account/identities/verify", {
    method: "POST",
    token: user.token,
    ip: "203.0.113.57",
    body: { challengeId: tgChal.body.challengeId }
  });
  assert.equal(tgOk.status, 200);
  assert.equal(tgOk.body.identity.platform, "telegram");
  assert.equal(tgOk.body.identity.handle, "alice_channel");

  // 7. Verify both identities now returned
  const list2 = await call("/v1/account/identities", {
    token: user.token,
    ip: "203.0.113.58"
  });
  assert.equal(list2.body.identities.length, 2);

  // 8. Unlink an identity
  const delRes = await call("/v1/account/identities", {
    method: "DELETE",
    token: user.token,
    ip: "203.0.113.59",
    body: { platform: "telegram", handle: "alice_channel" }
  });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.ok, true);

  const list3 = await call("/v1/account/identities", {
    token: user.token,
    ip: "203.0.113.60"
  });
  assert.equal(list3.body.identities.length, 1);
  assert.equal(list3.body.identities[0].handle, "alice_x");
});
