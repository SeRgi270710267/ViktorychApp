import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const dispatches = [];
const hosts = [];

let mf;

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
      OWNER_HANDLE: "owner_test",
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

async function signup(n, displayName, handle) {
  const res = await call("/v1/signup", { method: "POST", ip: "203.0.113." + n, body: { displayName, handle } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}


test("a device that keeps its own look leaves the account's look in place", async () => {
  const me = await signup(71, "Sync User", "sync_user");
  let put = await call("/v1/sync", { method: "PUT", token: me.token, body: { payload: { appearance: "dim", homePills: false, prefsAt: { homePills: 5 }, follows: [] }, baseUpdatedAt: 0, device: "phone1" } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  put = await call("/v1/sync", { method: "PUT", token: me.token, body: { payload: { uiLocal: true, follows: ["x:a"], syncUi: true, syncUiAt: 7 }, baseUpdatedAt: put.body.updatedAt, device: "laptop1" } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const got = await call("/v1/sync", { token: me.token });
  assert.equal(got.status, 200);
  assert.equal(got.body.payload.appearance, "dim", "the shared look stays");
  assert.equal(got.body.payload.homePills, false);
  assert.deepEqual(got.body.payload.follows, ["x:a"], "everything else still syncs");
  assert.equal(got.body.payload.uiLocal, undefined, "the device flag is not stored");
  assert.equal(got.body.payload.syncUiAt, 7);
  const bad = await call("/v1/sync", { method: "PUT", token: me.token, body: { payload: { homePills: "nope", prefsAt: [1] }, baseUpdatedAt: got.body.updatedAt } });
  assert.equal(bad.status, 200);
  const after = await call("/v1/sync", { token: me.token });
  assert.equal(after.body.payload.homePills, undefined);
  assert.equal(after.body.payload.prefsAt, undefined);
});

test("sensitive settings are sealed in D1 and device-only keys keep the account copy", async () => {
  const me = await signup(72, "Device User", "device_user");
  let put = await call("/v1/sync", { method: "PUT", token: me.token, body: { payload: { mutedWords: ["spoilerword"], privacyWebRTC: true, livePreview: false, prefsAt: { livePreview: 9 } }, baseUpdatedAt: 0, device: "phone1" } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const db = await mf.getD1Database("DB");
  const raw = await db.prepare("SELECT payload FROM sync_state WHERE public_id = ?").bind(me.account.publicId).first();
  assert.ok(raw.payload.indexOf("spoilerword") < 0, "muted words are not stored in the clear");
  assert.ok(raw.payload.indexOf("\"sealed\":\"v1:") >= 0);
  assert.ok(raw.payload.indexOf("livePreview") >= 0, "plain preferences stay readable");
  put = await call("/v1/sync", { method: "PUT", token: me.token, body: { payload: { livePreview: true, localKeys: ["mutedWords", "privacyWebRTC"], prefsAt: { livePreview: 11 } }, baseUpdatedAt: put.body.updatedAt, device: "laptop1" } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const got = await call("/v1/sync", { token: me.token });
  assert.deepEqual(got.body.payload.mutedWords, ["spoilerword"], "the device-only key keeps the account's value");
  assert.equal(got.body.payload.privacyWebRTC, true);
  assert.equal(got.body.payload.livePreview, true);
  assert.equal(got.body.payload.localKeys, undefined);
  assert.equal(got.body.payload.sealed, undefined, "the client never sees the sealed blob");
  const stale = await call("/v1/sync", { method: "PUT", token: me.token, body: { payload: { livePreview: false }, baseUpdatedAt: 1, device: "phone1" } });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.payload.mutedWords, ["spoilerword"], "a conflict reply is opened too");
});
