import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  decideAttempt,
  decryptMaterial,
  encryptMaterial,
  maskSecret,
  parseMaterial
} from "../../shared/owner-keys.js";
import { migrateOwnerKeys } from "../src/owner-keys.js";

const OWNER = "S\u0435\u0420g\u0418";
const SECRET = "sessionid=super-secret-cookie-value";
const BACKUP = "sessionid=backup-secret-cookie-value";
const LEGACY = "sessionid=legacy-kept-cookie-value";
const ENC = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const JOB = "dispatch-test-token";

function workerOptions(hits) {
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
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      KEYS_ENC_KEY: ENC,
      GITHUB_DISPATCH_TOKEN: JOB
    },
    async outboundService(request) {
      hits.push({ url: request.url, cookie: request.headers.get("cookie") || "" });
      return new Response("captcha-verify", { status: 403, headers: { "content-type": "text/html" } });
    }
  };
}

async function call(mf, path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.json ? JSON.stringify(opts.json) : undefined
  });
  const text = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
  let body = null;
  try { body = JSON.parse(text); }
  catch (err) { body = null; }
  return { status: res.status, body, text };
}

async function signup(mf, ip, handle, claim) {
  const body = { displayName: "Reader", handle };
  if (claim) body.claimCode = claim;
  return call(mf, "/v1/signup", { method: "POST", ip, json: body });
}

test("the worker runs without KEYS_ENC_KEY and connected keys ask for setup", async () => {
  const options = workerOptions([]);
  const bindings = Object.assign({}, options.bindings);
  delete bindings.KEYS_ENC_KEY;
  options.bindings = bindings;
  const mf = new Miniflare(options);
  try {
    const health = await call(mf, "/v1/health", { ip: "203.0.113.80" });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.ready, true);
    const owner = await signup(mf, "203.0.113.81", OWNER, "claim-test");
    assert.equal(owner.status, 201);
    const token = owner.body.token;
    const session = await call(mf, "/v1/session", { ip: "203.0.113.82", token });
    assert.equal(session.status, 200);
    const listed = await call(mf, "/v1/owner/keys", { ip: "203.0.113.83", token });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.ready, false);
    assert.equal(listed.text.includes(SECRET), false);
    const saved = await call(mf, "/v1/owner/keys/tiktok", {
      method: "PUT",
      ip: "203.0.113.84",
      token,
      json: { value: SECRET }
    });
    assert.equal(saved.status, 503);
    assert.equal(saved.body.error, "not_configured");
    assert.equal(saved.text.includes("super-secret-cookie-value"), false);
    const again = await call(mf, "/v1/health", { ip: "203.0.113.85" });
    assert.equal(again.status, 200);
    assert.equal(again.body.ok, true);
  } finally {
    await mf.dispose();
  }
});

test("encryption round-trips and the mask never contains the value", async () => {
  const sealed = await encryptMaterial(ENC, "tiktok", SECRET);
  assert.ok(sealed && sealed.iv && sealed.ciphertext);
  assert.equal(sealed.ciphertext.includes("super-secret-cookie-value"), false);
  assert.equal(sealed.iv.includes("super-secret-cookie-value"), false);
  const plain = await decryptMaterial(ENC, "tiktok", sealed.iv, sealed.ciphertext);
  assert.equal(plain, SECRET);
  const swapped = await decryptMaterial(ENC, "youtube", sealed.iv, sealed.ciphertext);
  assert.equal(swapped, null);
  assert.equal(maskSecret(SECRET), "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
  assert.equal(maskSecret(SECRET).includes("super-secret"), false);
  assert.equal(maskSecret(""), "");
  const parsed = parseMaterial("cookie", "# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t1000\tsessionid\tsuper-secret-cookie-value\n", Date.now());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.expired, true);
  assert.equal(parsed.material, "sessionid=super-secret-cookie-value");
  const header = parseMaterial("cookie", SECRET, Date.now());
  assert.equal(header.ok, true);
  assert.equal(header.expired, false);
  const pair = parseMaterial("pair", "client-id\nclient-secret", Date.now());
  assert.equal(pair.ok, true);
  assert.equal(JSON.parse(pair.material).clientSecret, "client-secret");
});

test("a signed-out key advances and a 429 or challenge never does", () => {
  assert.deepEqual(decideAttempt(401, "", true), { action: "advance", reason: "unauthorized" });
  assert.deepEqual(decideAttempt(200, "login required", true), { action: "advance", reason: "session_invalid" });
  assert.deepEqual(decideAttempt(403, "", true), { action: "hold", reason: "forbidden" });
  assert.deepEqual(decideAttempt(200, "please captcha-verify", true), { action: "hold", reason: "captcha" });
  assert.deepEqual(decideAttempt(200, "cf-challenge", true), { action: "hold", reason: "challenge" });
  assert.deepEqual(decideAttempt(429, "", true), { action: "hold", reason: "rate_limit" });
  assert.deepEqual(decideAttempt(429, "cf-challenge", true), { action: "hold", reason: "rate_limit" });
  assert.notEqual(decideAttempt(429, "", true).action, "advance");
  assert.notEqual(decideAttempt(200, "cf-challenge", true).action, "advance");
  assert.notEqual(decideAttempt(429, "captcha", true).action, "advance");
  assert.deepEqual(decideAttempt(200, "ok", true), { action: "keep", reason: "" });
  assert.deepEqual(decideAttempt(403, "", false), { action: "keep", reason: "" });
});

test("connected keys are owner-only and the saved value stays masked", async () => {
  const hits = [];
  const mf = new Miniflare(workerOptions(hits));
  try {
    const anon = await call(mf, "/v1/owner/keys", { ip: "203.0.113.30" });
    assert.equal(anon.status, 401);
    assert.equal(anon.text.includes(SECRET), false);

    const other = await signup(mf, "203.0.113.31", "ada_keys");
    assert.equal(other.status, 201);
    const denied = await call(mf, "/v1/owner/keys", { ip: "203.0.113.32", token: other.body.token });
    assert.equal(denied.status, 403);
    const deniedWrite = await call(mf, "/v1/owner/keys/tiktok", {
      method: "PUT",
      ip: "203.0.113.33",
      token: other.body.token,
      json: { value: SECRET }
    });
    assert.equal(deniedWrite.status, 403);
    assert.equal(deniedWrite.text.includes("super-secret-cookie-value"), false);

    const owner = await signup(mf, "203.0.113.40", OWNER, "claim-test");
    assert.equal(owner.status, 201);
    assert.equal(owner.body.account.owner, true);
    const token = owner.body.token;
    const saved = await call(mf, "/v1/owner/keys/tiktok", {
      method: "PUT",
      ip: "203.0.113.41",
      token,
      json: { value: SECRET }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.slot.mask, "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
    assert.equal(saved.body.slot.status, "unknown");
    assert.equal(saved.text.includes("super-secret-cookie-value"), false);

    const listed = await call(mf, "/v1/owner/keys", { ip: "203.0.113.42", token });
    assert.equal(listed.status, 200);
    assert.equal(listed.text.includes("super-secret-cookie-value"), false);
    const tiktok = listed.body.slots.find((slot) => slot.id === "tiktok");
    assert.equal(tiktok.configured, true);
    assert.equal(tiktok.mask.includes("super-secret"), false);

    const ownerMaterial = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.43", token });
    assert.equal(ownerMaterial.status, 401);
    assert.equal(ownerMaterial.text.includes("super-secret-cookie-value"), false);
    const wrongJob = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.44", token: "nope" });
    assert.equal(wrongJob.status, 401);

    const keyA = saved.body.slot.keys[0].id;
    assert.equal(typeof keyA, "string");
    const job = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.45", token: JOB });
    assert.equal(job.status, 200);
    assert.equal(job.body.value, SECRET);
    assert.equal(job.body.keyId, keyA);

    const tested = await call(mf, "/v1/owner/keys/tiktok/test", { method: "POST", ip: "203.0.113.46", token });
    assert.equal(tested.status, 200);
    assert.equal(tested.body.slot.status, "unknown");
    assert.equal(tested.body.slot.lastError, "captcha");
    assert.equal(tested.body.slot.keys[0].status, "unknown");
    assert.equal(tested.body.slot.pace.reason, "captcha");
    assert.equal(tested.text.includes("super-secret-cookie-value"), false);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].cookie, SECRET);

    const still = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.47", token: JOB });
    assert.equal(still.status, 200);
    assert.equal(still.body.keyId, keyA);
    assert.equal(still.body.value, SECRET);

    const savedBackup = await call(mf, "/v1/owner/keys/tiktok", {
      method: "PUT",
      ip: "203.0.113.53",
      token,
      json: { value: BACKUP, label: "spare" }
    });
    assert.equal(savedBackup.status, 200);
    assert.equal(savedBackup.body.slot.keys.length, 2);
    assert.equal(savedBackup.text.includes(BACKUP), false);
    const keyB = savedBackup.body.slot.keys[1].id;
    assert.equal(savedBackup.body.slot.keys[1].name, "spare");
    const ordered = await call(mf, "/v1/owner/keys/tiktok/order", {
      method: "POST",
      ip: "203.0.113.54",
      token,
      json: { ids: [keyB, keyA] }
    });
    assert.equal(ordered.status, 200);
    assert.equal(ordered.body.slot.keys[0].id, keyB);
    const flipped = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.55", token: JOB });
    assert.equal(flipped.body.value, BACKUP);
    assert.equal(flipped.body.keyId, keyB);
    const restored = await call(mf, "/v1/owner/keys/tiktok/order", {
      method: "POST",
      ip: "203.0.113.56",
      token,
      json: { ids: [keyA, keyB] }
    });
    assert.equal(restored.status, 200);
    const back = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.57", token: JOB });
    assert.equal(back.body.keyId, keyA);
    assert.equal(back.body.value, SECRET);

    const limited = await call(mf, "/v1/owner/keys/tiktok/attention", {
      method: "POST",
      ip: "203.0.113.58",
      token: JOB,
      json: { error: "rate_limit" }
    });
    assert.equal(limited.status, 200);
    assert.equal(limited.body.switched, false);
    const afterLimit = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.59", token: JOB });
    assert.equal(afterLimit.body.keyId, keyA);

    const challenged = await call(mf, "/v1/owner/keys/tiktok/attention", {
      method: "POST",
      ip: "203.0.113.60",
      token: JOB,
      json: { error: "challenge" }
    });
    assert.equal(challenged.body.switched, false);
    const afterChallenge = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.61", token: JOB });
    assert.equal(afterChallenge.body.keyId, keyA);
    assert.equal(afterChallenge.body.value, SECRET);

    const advanced = await call(mf, "/v1/owner/keys/tiktok/attention", {
      method: "POST",
      ip: "203.0.113.62",
      token: JOB,
      json: { error: "unauthorized", keyId: keyA }
    });
    assert.equal(advanced.body.switched, true);
    const next = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.63", token: JOB });
    assert.equal(next.status, 200);
    assert.equal(next.body.keyId, keyB);
    assert.equal(next.body.value, BACKUP);
    const heldBackup = await call(mf, "/v1/owner/keys/tiktok/attention", {
      method: "POST",
      ip: "203.0.113.64",
      token: JOB,
      json: { error: "challenge", keyId: keyB }
    });
    assert.equal(heldBackup.body.switched, false);
    const stay = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.65", token: JOB });
    assert.equal(stay.body.keyId, keyB);
    assert.equal(stay.text.includes(SECRET), false);
    assert.equal(stay.text.includes("backup-secret"), true);

    const expiredPaste = "# Netscape HTTP Cookie File\n.tiktok.com\tTRUE\t/\tTRUE\t1000\tsessionid\tsuper-secret-cookie-value\n";
    const expired = await call(mf, "/v1/owner/keys/youtube", {
      method: "PUT",
      ip: "203.0.113.48",
      token,
      json: { value: expiredPaste }
    });
    assert.equal(expired.status, 200);
    assert.equal(expired.body.slot.status, "expired");
    assert.equal(expired.text.includes("super-secret-cookie-value"), false);
    const before = hits.length;
    const expiredTest = await call(mf, "/v1/owner/keys/youtube/test", { method: "POST", ip: "203.0.113.49", token });
    assert.equal(expiredTest.body.slot.status, "expired");
    assert.equal(hits.length, before);
    const expiredJob = await call(mf, "/v1/owner/keys/youtube/material", { ip: "203.0.113.50", token: JOB });
    assert.equal(expiredJob.status, 410);
    assert.equal(expiredJob.text.includes("super-secret-cookie-value"), false);

    const removed = await call(mf, "/v1/owner/keys/tiktok", { method: "DELETE", ip: "203.0.113.51", token });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.slot.configured, false);
    const gone = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.52", token: JOB });
    assert.equal(gone.status, 404);
  } finally {
    await mf.dispose();
  }
});

test("a 429 response never switches to the backup key", async () => {
  const hits = [];
  const options = workerOptions(hits);
  options.outboundService = async (request) => {
    hits.push({ url: request.url, cookie: request.headers.get("cookie") || "" });
    return new Response("cf-challenge", { status: 429, headers: { "content-type": "text/html", "retry-after": "30" } });
  };
  const mf = new Miniflare(options);
  try {
    const owner = await signup(mf, "203.0.113.70", OWNER, "claim-test");
    const token = owner.body.token;
    const saved = await call(mf, "/v1/owner/keys/tiktok", {
      method: "PUT",
      ip: "203.0.113.71",
      token,
      json: { value: SECRET }
    });
    const keyA = saved.body.slot.keys[0].id;
    await call(mf, "/v1/owner/keys/tiktok", {
      method: "PUT",
      ip: "203.0.113.72",
      token,
      json: { value: BACKUP }
    });
    const first = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.73", token: JOB });
    assert.equal(first.body.keyId, keyA);
    const tested = await call(mf, "/v1/owner/keys/tiktok/" + keyA + "/test", {
      method: "POST",
      ip: "203.0.113.74",
      token
    });
    assert.equal(tested.status, 200);
    const testedKey = tested.body.slot.keys.find((key) => key.id === keyA);
    assert.equal(testedKey.status, "unknown");
    assert.equal(testedKey.lastError, "rate_limit");
    assert.notEqual(testedKey.status, "needs_attention");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].cookie, SECRET);
    assert.equal(hits[0].cookie.includes("backup-secret"), false);
    const again = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.75", token: JOB });
    assert.equal(again.status, 200);
    assert.equal(again.body.keyId, keyA);
    assert.equal(again.body.value, SECRET);
    const challenged = await call(mf, "/v1/owner/keys/tiktok/attention", {
      method: "POST",
      ip: "203.0.113.76",
      token: JOB,
      json: { error: "challenge", keyId: keyA }
    });
    assert.equal(challenged.body.switched, false);
    const stayed = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.77", token: JOB });
    assert.equal(stayed.body.keyId, keyA);
    assert.equal(hits.length, 1);
  } finally {
    await mf.dispose();
  }
});

test("a one-per-slot key is copied without re-encrypting it", async () => {
  const mf = new Miniflare(workerOptions([]));
  try {
    const owner = await signup(mf, "203.0.113.90", OWNER, "claim-test");
    assert.equal(owner.status, 201);
    const sealed = await encryptMaterial(ENC, "tiktok", LEGACY);
    const db = await mf.getBindings();
    await db.DB.prepare(
      `INSERT INTO owner_keys (owner_id, slot, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at)
       VALUES (?, 'tiktok', 'cookie', ?, ?, ?, 'unknown', 0, '', 0, ?, 0)`
    ).bind(owner.body.account.publicId, sealed.ciphertext, sealed.iv, "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", Date.now()).run();
    await migrateOwnerKeys(db);
    await migrateOwnerKeys(db);
    const copied = await db.DB.prepare(
      "SELECT key_id, ciphertext FROM owner_key_items WHERE owner_id = ? AND slot = 'tiktok'"
    ).bind(owner.body.account.publicId).all();
    assert.equal(copied.results.length, 1);
    assert.equal(copied.results[0].key_id, "legacy-tiktok");
    assert.equal(copied.results[0].ciphertext, sealed.ciphertext);
    const original = await db.DB.prepare(
      "SELECT ciphertext FROM owner_keys WHERE owner_id = ? AND slot = 'tiktok'"
    ).bind(owner.body.account.publicId).first();
    assert.equal(original.ciphertext, sealed.ciphertext);
    const listed = await call(mf, "/v1/owner/keys", { ip: "203.0.113.91", token: owner.body.token });
    assert.equal(listed.text.includes("legacy-kept"), false);
    assert.equal(listed.text.includes(sealed.ciphertext), false);
    const job = await call(mf, "/v1/owner/keys/tiktok/material", { ip: "203.0.113.92", token: JOB });
    assert.equal(job.status, 200);
    assert.equal(job.body.value, LEGACY);
    assert.equal(job.body.keyId, "legacy-tiktok");
  } finally {
    await mf.dispose();
  }
});
