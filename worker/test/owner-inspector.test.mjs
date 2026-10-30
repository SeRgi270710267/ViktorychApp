import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { audienceSummary } from "../src/owner-inspector.js";

const OWNER = "ownerfern";
let mf;

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}

async function signup(handle, ip, extra) {
  const res = await call("/v1/signup", { method: "POST", ip, body: Object.assign({ displayName: handle, handle }, extra || {}) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

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
      OWNER_HANDLE: OWNER,
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io",
      PBKDF2_ITERATIONS: "1000"
    }
  });
});

test.after(async () => { if (mf) await mf.dispose(); });

test("audience summary words", () => {
  assert.equal(audienceSummary({ include: { public: true }, exclude: {} }).level, "public");
  assert.equal(audienceSummary({ include: { followers: true }, exclude: {} }).hidden, true);
  assert.equal(audienceSummary({ include: { lists: ["l1"] }, exclude: { people: ["p"] } }).level, "custom");
  assert.equal(audienceSummary({ include: {}, exclude: {} }).level, "only_me");
});

test("only the owner inspects accounts; hidden usernames show; each open is audited", async () => {
  const owner = await signup(OWNER, "203.0.113.30", { claimCode: "claim-test" });
  const member = await signup("memberwillow", "203.0.113.31");
  const other = await signup("otheraspen", "203.0.113.32");

  // A second username only friends can see.
  const added = await call("/v1/usernames", { method: "POST", ip: "203.0.113.33", token: member.token, body: { handle: "willow_quiet", audience: { include: { friends: true } } } });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  // Non-owners: 403. Anonymous: 401.
  assert.equal((await call("/v1/owner/inspector/accounts", { token: other.token })).status, 403);
  assert.equal((await call("/v1/owner/inspector/accounts/" + member.account.publicId, { token: other.token })).status, 403);
  assert.equal((await call("/v1/owner/inspector/audit", { token: member.token })).status, 403);
  assert.equal((await call("/v1/owner/inspector/accounts")).status, 401);

  const list = await call("/v1/owner/inspector/accounts?sort=handle", { token: owner.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.totals.accounts, 3);
  const row = list.body.accounts.find((a) => a.handle === "memberwillow");
  assert.ok(row);
  assert.equal(row.extraNames, 1);
  assert.equal(row.hiddenNames, 1);

  // Search finds an account by its hidden username too.
  const found = await call("/v1/owner/inspector/accounts?q=willow_qu", { token: owner.token });
  assert.deepEqual(found.body.accounts.map((a) => a.handle), ["memberwillow"]);
  const filtered = await call("/v1/owner/inspector/accounts?filter=hidden_names", { token: owner.token });
  assert.deepEqual(filtered.body.accounts.map((a) => a.handle), ["memberwillow"]);

  const detail = await call("/v1/owner/inspector/accounts/" + row.id, { token: owner.token });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.audited, true);
  const quiet = detail.body.names.find((n) => n.handle === "willow_quiet");
  assert.ok(quiet, "hidden username is visible to the owner");
  assert.equal(quiet.audience.level, "friends");
  assert.deepEqual(detail.body.signIn.slice(0, 1), ["account_number"]);
  assert.equal(detail.body.email.stored, false);

  // Nothing secret leaks.
  const text = detail.text;
  assert.ok(text.indexOf(member.token) < 0, "no session token");
  ["number_hash", "salt", "token_hash", "public_key", "code_hash", "password"].forEach((word) => assert.ok(text.indexOf(word) < 0, word));

  const audit = await call("/v1/owner/inspector/audit", { token: owner.token });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.rows.length, 1);
  assert.equal(audit.body.rows[0].id, row.id);

  // Unknown account: 404, and no audit row.
  assert.equal((await call("/v1/owner/inspector/accounts/999999999999", { token: owner.token })).status, 404);
  assert.equal((await call("/v1/owner/inspector/audit", { token: owner.token })).body.rows.length, 1);
});
