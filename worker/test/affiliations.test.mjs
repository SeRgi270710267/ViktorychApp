import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

let mf;
let bindings;

function workerOptions() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    unsafeTriggerHandlers: true,
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    durableObjects: {
      ACCOUNT_CHANNEL: { className: "AccountChannel", useSQLite: true }
    },
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "owner_test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
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

async function signup(handle, name, ip) {
  const created = await call("/v1/signup", { method: "POST", ip, body: { displayName: name, handle } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("only an owner can grant an affiliation", async () => {
  const admin = await signup("nyx_af", "Nyx Aff", "203.0.113.210");
  const bee = await signup("bee_af", "Bee Aff", "203.0.113.211");
  const cay = await signup("cay_af", "Cay Aff", "203.0.113.212");
  await bindings.DB.prepare("UPDATE accounts SET owner = 1 WHERE public_id = ?").bind(admin.account.publicId).run();

  const denied = await call("/v1/affiliations/grant", {
    method: "POST",
    token: bee.token,
    ip: "203.0.113.213",
    body: { affiliationId: "viktorych", handle: "cay_af", grant: true }
  });
  assert.equal(denied.status, 403);

  const granted = await call("/v1/affiliations/grant", {
    method: "POST",
    token: admin.token,
    ip: "203.0.113.214",
    body: { affiliationId: "viktorych", handle: "bee_af", grant: true }
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  assert.equal(granted.body.granted, true);

  const seen = await call("/v1/affiliations?ids=" + bee.account.publicId, { token: cay.token, ip: "203.0.113.215" });
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.equal(seen.body.accounts[bee.account.publicId][0].name, "Viktorych");
  assert.equal(seen.body.accounts[bee.account.publicId][0].logo, "logo/affiliation-viktorych.svg");

  const hidden = await call("/v1/affiliations/me/viktorych", {
    method: "PATCH",
    token: bee.token,
    ip: "203.0.113.216",
    body: { hidden: true }
  });
  assert.equal(hidden.status, 200);
  const gone = await call("/v1/affiliations?ids=" + bee.account.publicId, { token: cay.token, ip: "203.0.113.217" });
  assert.equal(gone.body.accounts[bee.account.publicId], undefined);
  const self = await call("/v1/affiliations?ids=" + bee.account.publicId, { token: bee.token, ip: "203.0.113.218" });
  assert.equal(self.body.accounts[bee.account.publicId][0].hidden, true);

  await call("/v1/affiliations/me/viktorych", {
    method: "PATCH",
    token: bee.token,
    ip: "203.0.113.219",
    body: { hidden: false, audience: "followers" }
  });
  const locked = await call("/v1/affiliations?ids=" + bee.account.publicId, { token: cay.token, ip: "203.0.113.220" });
  assert.equal(locked.body.accounts[bee.account.publicId], undefined);
  const follow = await call("/v1/follows", {
    method: "PUT",
    token: cay.token,
    ip: "203.0.113.221",
    body: { id: "app:" + bee.account.publicId }
  });
  assert.equal(follow.status, 200, JSON.stringify(follow.body));
  const allowed = await call("/v1/affiliations?ids=" + bee.account.publicId, { token: cay.token, ip: "203.0.113.222" });
  assert.equal(allowed.body.accounts[bee.account.publicId][0].id, "viktorych");

  const revoked = await call("/v1/affiliations/grant", {
    method: "POST",
    token: admin.token,
    ip: "203.0.113.223",
    body: { affiliationId: "viktorych", handle: "bee_af", grant: false }
  });
  assert.equal(revoked.status, 200);
  const after = await call("/v1/affiliations?ids=" + bee.account.publicId, { token: bee.token, ip: "203.0.113.224" });
  assert.equal(after.body.accounts[bee.account.publicId], undefined);
});
