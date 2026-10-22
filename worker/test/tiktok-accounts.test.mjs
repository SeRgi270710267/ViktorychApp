import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const dispatches = [];

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
      if (url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com") {
        if (url.pathname.indexOf("@blocked_name") >= 0) {
          return new Response("<html>captcha-verify</html>", { status: 200, headers: { "content-type": "text/html" } });
        }
        const html = '<html><meta property="og:title" content="Sample (@sample_name)"><meta property="og:image" content="https://cdn.example/a.jpg">' +
          '<script>"uniqueId":"sample_name","nickname":"Sample","avatarLarger":"https:\\/\\/cdn.example\\/a.jpg"</script></html>';
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
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
  return { status: res.status, body, text };
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("owner adds and removes a TikTok account in private storage", async () => {
  const stranger = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.70",
    body: { displayName: "Ada", handle: "ada_tt" }
  });
  assert.equal(stranger.status, 201);
  const denied = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.71", token: stranger.body.token });
  assert.equal(denied.status, 403);
  const deniedWrite = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.72",
    token: stranger.body.token,
    body: { handle: "sample_name" }
  });
  assert.equal(deniedWrite.status, 403);
  const open = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.73" });
  assert.equal(open.status, 401);

  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.74",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  assert.equal(owner.body.account.owner, true);

  const bad = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.75",
    token: owner.body.token,
    body: { handle: "not a handle" }
  });
  assert.equal(bad.status, 400);

  dispatches.length = 0;
  const added = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.76",
    token: owner.body.token,
    body: { handle: "https://www.tiktok.com/@sample_name?lang=en" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.account.handle, "sample_name");
  assert.equal(added.body.account.name, "Sample");
  assert.equal(added.body.preview, true);
  assert.equal(added.body.dispatched, true);
  assert.equal(added.body.removed, undefined);
  assert.ok(dispatches.some((path) => path.indexOf("tiktok-added.yml") >= 0));
  assert.ok(dispatches.some((path) => path.indexOf("media-extract.yml") >= 0));

  const listed = await call("/v1/owner/tiktok/accounts", { ip: "203.0.113.77", token: owner.body.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.added.length, 1);
  assert.equal(listed.body.removed, undefined);

  const leaked = await call("/v1/data/owner/tiktok-accounts.json", { ip: "203.0.113.78", token: owner.body.token });
  assert.equal(leaked.status, 404);

  const bindings = await mf.getBindings();
  const stored = await bindings.DATA.get("owner/tiktok-accounts.json");
  const doc = JSON.parse(await stored.text());
  assert.equal(doc.added[0].handle, "sample_name");
  assert.ok(Array.isArray(doc.removed));

  const blocked = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.79",
    token: owner.body.token,
    body: { handle: "@blocked_name" }
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.account.handle, "blocked_name");
  assert.equal(blocked.body.preview, false);

  const removed = await call("/v1/owner/tiktok/accounts/sample_name", {
    method: "DELETE",
    ip: "203.0.113.80",
    token: owner.body.token
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.added.some((row) => row.handle === "sample_name"), false);

  const again = await bindings.DATA.get("owner/tiktok-accounts.json");
  const after = JSON.parse(await again.text());
  assert.ok(after.removed.indexOf("sample_name") >= 0);
  assert.equal(after.added.some((row) => row.handle === "sample_name"), false);

  const back = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.81",
    token: owner.body.token,
    body: { url: "https://tiktok.com/@sample_name" }
  });
  assert.equal(back.status, 200);
  const restored = JSON.parse(await (await bindings.DATA.get("owner/tiktok-accounts.json")).text());
  assert.equal(restored.removed.indexOf("sample_name"), -1);
  assert.equal(restored.added.some((row) => row.handle === "sample_name"), true);
});
