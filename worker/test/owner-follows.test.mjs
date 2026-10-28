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
      OWNER_HANDLE: "mirathorn",
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

test("a new account follows only the owner's own accounts", async () => {
  const early = await signup(51, "Early Bird", "early_bird");
  const owner = await call("/v1/signup", { method: "POST", ip: "203.0.113.52", body: { displayName: "Owner", handle: "mirathorn", claimCode: "claim-test" } });
  assert.equal(owner.status, 201, JSON.stringify(owner.body));
  await signup(53, "Someone Else", "someone_else");
  const db = await mf.getD1Database("DB");
  const now = Date.now();
  await db.prepare("INSERT INTO account_identities (public_id, platform, handle, created_at) VALUES (?, 'x', 'owner_x_test', ?)").bind(owner.body.account.publicId, now).run();
  await db.prepare("INSERT INTO account_identities (public_id, platform, handle, verified, created_at) VALUES (?, 'x', 'owner_unverified', 0, ?)").bind(owner.body.account.publicId, now).run();

  const fresh = await signup(54, "Fresh User", "fresh_user");
  const listed = await db.prepare("SELECT target_id FROM account_follows WHERE follower_id = ? ORDER BY target_id").bind(fresh.account.publicId).all();
  assert.deepEqual(listed.results.map((r) => r.target_id).sort(), ["app:" + owner.body.account.publicId, "x:owner_x_test"].sort());

  const before = await db.prepare("SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?").bind(early.account.publicId).first();
  assert.equal(before.n, 0, "existing accounts are not changed");
  const mine = await db.prepare("SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?").bind(owner.body.account.publicId).first();
  assert.equal(mine.n, 0, "the owner does not follow itself");
});
