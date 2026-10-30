// A sign-up whose answer never arrived is sent again with the same signup
// key: the retry takes over the account the first try made (new number, new
// session) instead of making a second account or calling its handle taken.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { cleanSignupKey } from "../src/signup-replay.js";

let mf;
let bindings;
let ipSeq = 40;
const ip = () => "198.51.100." + (++ipSeq);

async function call(path, body, token) {
  const headers = new Headers({ "CF-Connecting-IP": ip(), "content-type": "application/json" });
  if (token) headers.set("Authorization", "Bearer " + token);
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { json = { raw: text }; }
  return { status: res.status, body: json };
}
const count = async (sql, ...args) => Number((await bindings.DB.prepare(sql).bind(...args).first()).n);

test.before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: { ACCOUNT_PEPPER: "pepper-test", OWNER_CLAIM_CODE: "claim-test", OWNER_HANDLE: "mirathorn", ALLOWED_ORIGINS: "https://viktorychgroup.github.io", PBKDF2_ITERATIONS: "1000" }
  });
  bindings = await mf.getBindings();
});
test.after(async () => { if (mf) await mf.dispose(); });

test("signup keys are checked", () => {
  assert.equal(cleanSignupKey("short"), "");
  assert.equal(cleanSignupKey("a".repeat(65)), "");
  assert.equal(cleanSignupKey("bad key with spaces!!"), "");
  assert.equal(cleanSignupKey("Abc_def-0123456789xyz"), "Abc_def-0123456789xyz");
});

test("a retried temporary sign-up takes over the first account", async () => {
  const key = "tmpKey_" + "a1".repeat(10);
  const first = await call("/v1/signup", { temporary: true, expiresIn: "1d", displayName: "Retry Temp", signupKey: key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await call("/v1/signup", { temporary: true, expiresIn: "7d", displayName: "Retry Temp", signupKey: key });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.resumed, true);
  assert.equal(again.body.account.publicId, first.body.account.publicId, "the same account comes back");
  assert.notEqual(again.body.accountNumber, first.body.accountNumber, "a fresh number is issued");
  assert.ok(again.body.temporary.expiresAt > first.body.temporary.expiresAt, "the new expiry is kept");
  // The lost session no longer works; the new one does.
  assert.equal((await call("/v1/session", null, first.body.token)).status, 401);
  assert.equal((await call("/v1/session", null, again.body.token)).status, 200);
  // The old number no longer signs in; the new one does.
  assert.notEqual((await call("/v1/login", { accountNumber: first.body.accountNumber })).status, 200);
  assert.equal((await call("/v1/login", { accountNumber: again.body.accountNumber })).status, 200);
  assert.equal(await count("SELECT COUNT(*) AS n FROM accounts WHERE display_name = ?", "Retry Temp"), 1);
});

test("a retried full sign-up keeps its handle instead of 'taken'", async () => {
  const key = "fullKey_" + "b2".repeat(10);
  const first = await call("/v1/signup", { displayName: "Retry Full", handle: "retryfull", signupKey: key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await call("/v1/signup", { displayName: "Retry Full", handle: "retryfull", signupKey: key });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.account.publicId, first.body.account.publicId);
  assert.equal(again.body.recoveryCodes.length, 10);
  // Without the key (or with another one) the handle is taken as before.
  const other = await call("/v1/signup", { displayName: "Someone", handle: "retryfull", signupKey: "otherKey_" + "c3".repeat(10) });
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "handle_taken");
  const none = await call("/v1/signup", { displayName: "Someone", handle: "retryfull" });
  assert.equal(none.status, 409);
});

test("a key never crosses temporary and full accounts or other handles", async () => {
  const key = "mixKey_" + "d4".repeat(10);
  const temp = await call("/v1/signup", { temporary: true, expiresIn: "1h", displayName: "Mix", signupKey: key });
  assert.equal(temp.status, 201);
  const full = await call("/v1/signup", { displayName: "Mix", handle: "mixreader", signupKey: key });
  assert.equal(full.status, 201);
  assert.notEqual(full.body.account.publicId, temp.body.account.publicId);
  assert.notEqual(full.body.resumed, true);
});
