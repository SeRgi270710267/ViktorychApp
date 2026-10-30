import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

let mf;
let bindings;

test.before(async () => {
  mf = new Miniflare({
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
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io",
      PBKDF2_ITERATIONS: "2000",
      PBKDF2_LEGACY_ITERATIONS: "1000"
    }
  });
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

let ipCounter = 0;
async function call(path, body) {
  ipCounter += 1;
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100." + ipCounter },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function pbkdf2(number, saltB64, rounds) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(number), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function stored(publicId) {
  return bindings.DB.prepare("SELECT number_hash, salt FROM accounts WHERE public_id = ?").bind(publicId).first();
}

test("account number hashes record their rounds and older hashes upgrade on sign-in", async () => {
  const created = await call("/v1/signup", { displayName: "Sample Person", handle: "sample_rounds" });
  assert.equal(created.status, 201);
  const id = created.body.account.publicId;
  const number = created.body.accountNumber;
  let row = await stored(id);
  assert.match(row.number_hash, /^p2:2000:/);
  assert.equal(row.number_hash, "p2:2000:" + await pbkdf2(number, row.salt, 2000));

  // A bare hash from before the rounds were recorded uses the legacy rounds.
  const legacy = await pbkdf2(number, row.salt, 1000);
  await bindings.DB.prepare("UPDATE accounts SET number_hash = ? WHERE public_id = ?").bind(legacy, id).run();
  const wrong = await call("/v1/login", { accountNumber: "1111222233334444" });
  assert.equal(wrong.status, 401);
  assert.equal((await stored(id)).number_hash, legacy);
  const first = await call("/v1/login", { accountNumber: number });
  assert.equal(first.status, 200);
  row = await stored(id);
  assert.match(row.number_hash, /^p2:2000:/);
  const again = await call("/v1/login", { accountNumber: number });
  assert.equal(again.status, 200);

  // A recorded hash with fewer rounds than the current setting is rewritten.
  const weak = "p2:1000:" + await pbkdf2(number, row.salt, 1000);
  await bindings.DB.prepare("UPDATE accounts SET number_hash = ? WHERE public_id = ?").bind(weak, id).run();
  const upgraded = await call("/v1/login", { accountNumber: number });
  assert.equal(upgraded.status, 200);
  assert.match((await stored(id)).number_hash, /^p2:2000:/);
});

test("recovery codes still restore an account and the new number signs in", async () => {
  const created = await call("/v1/signup", { displayName: "Sample Two", handle: "sample_codes" });
  assert.equal(created.status, 201);
  const codes = created.body.recoveryCodes || [];
  assert.ok(codes.length > 0);
  const restored = await call("/v1/recovery/restore", { code: codes[0] });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.match((await stored(created.body.account.publicId)).number_hash, /^p2:2000:/);
  const login = await call("/v1/login", { accountNumber: restored.body.accountNumber });
  assert.equal(login.status, 200);
});
