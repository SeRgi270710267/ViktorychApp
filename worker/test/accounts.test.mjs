import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const LOOKALIKE = "SePg\u0418";

let mf;
let bindings;

function workerOptions(extra) {
  return {
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("../..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }, extra || {})
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.origin) headers.set("Origin", opts.origin);
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
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("health, signup, login, session, and sync", async () => {
  const health = await call("/v1/health", { ip: "203.0.113.1" });
  assert.equal(health.status, 200);
  assert.equal(health.body.ready, true);
  assert.equal(health.body.data, true);

  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.20",
    body: { displayName: "Ada Lovelace", handle: "ada_l" }
  });
  assert.equal(created.status, 201);
  assert.match(created.body.accountNumber, /^\d{16}$/);
  assert.match(created.body.account.publicId, /^\d{12}$/);
  assert.equal(created.body.account.handle, "ada_l");
  assert.equal(created.body.account.owner, false);
  assert.equal(created.body.account.accountNumber, undefined);

  const rows = await bindings.DB.prepare("SELECT number_lookup, number_hash, salt, handle FROM accounts").all();
  for (const row of rows.results) {
    assert.notEqual(row.number_lookup, created.body.accountNumber);
    assert.equal(String(row.number_hash).includes(created.body.accountNumber), false);
    assert.equal(String(row.salt).includes(created.body.accountNumber), false);
  }

  const bad = await call("/v1/login", {
    method: "POST",
    ip: "203.0.113.21",
    body: { accountNumber: "0000000000000000" }
  });
  assert.equal(bad.status, 401);

  const good = await call("/v1/login", {
    method: "POST",
    ip: "203.0.113.22",
    body: { accountNumber: created.body.accountNumber }
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.account.publicId, created.body.account.publicId);

  const session = await call("/v1/session", { ip: "203.0.113.23", token: good.body.token });
  assert.equal(session.status, 200);
  assert.equal(session.body.account.handle, "ada_l");

  const saved = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.24",
    token: good.body.token,
    body: { payload: { follows: ["x:ada"], bookmarks: { a: 1 } }, baseUpdatedAt: 0 }
  });
  assert.equal(saved.status, 200);
  const loaded = await call("/v1/sync", { ip: "203.0.113.25", token: good.body.token });
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body.payload.follows, ["x:ada"]);

  const clash = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.26",
    token: good.body.token,
    body: { payload: { follows: ["x:other"] }, baseUpdatedAt: 1 }
  });
  assert.equal(clash.status, 409);

  const gone = await call("/v1/logout", { method: "POST", ip: "203.0.113.27", token: good.body.token });
  assert.equal(gone.status, 200);
  const after = await call("/v1/session", { ip: "203.0.113.28", token: good.body.token });
  assert.equal(after.status, 401);
});

test("skeletons, owner claim, and rate limit", async () => {
  const first = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.40",
    body: { displayName: "Hello", handle: "hello" }
  });
  assert.equal(first.status, 201);
  const twin = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.41",
    body: { displayName: "Hello", handle: "\u041Dello" }
  });
  assert.equal(twin.status, 409);
  assert.equal(twin.body.error, "handle_taken");

  const look = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.42",
    body: { displayName: "Owner", handle: LOOKALIKE, claimCode: "claim-test" }
  });
  assert.equal(look.status, 409);
  assert.equal(look.body.error, "handle_reserved");

  const missing = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.43",
    body: { displayName: "Owner", handle: OWNER }
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error, "claim_required");

  const claimed = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.44",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.account.owner, true);
  assert.equal(claimed.body.account.handle, OWNER);

  const again = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.45",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(again.status, 409);

  const evil = await call("/v1/health", { ip: "203.0.113.46", origin: "https://evil.example" });
  assert.equal(evil.status, 403);

  for (let i = 0; i < 4; i++) {
    const ok = await call("/v1/signup", {
      method: "POST",
      ip: "203.0.113.60",
      body: { displayName: "Rate " + i, handle: "rate" + i }
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  }
  const limited = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.60",
    body: { displayName: "Rate 4", handle: "rate4" }
  });
  assert.equal(limited.status, 429);
});

test("feed data requires a session and hides owner-only posts", async () => {
  const doc = {
    posts: [
      { id: "1", platform: "x", text: "public-post" },
      { id: "2", platform: "tiktok", text: "secret-tiktok" },
      { id: "3", platform: "youtube", url: "https://www.youtube.com/shorts/abc", text: "secret-short" },
      { id: "4", platform: "youtube", ownerOnly: true, text: "secret-flag" }
    ],
    feeds: [{ id: "tiktok:hidden", platform: "tiktok", handle: "hidden" }]
  };
  await bindings.DATA.put("feeds.json", JSON.stringify(doc));
  const closed = await call("/v1/data/feeds.json", { ip: "203.0.113.70" });
  assert.equal(closed.status, 401);

  const user = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.71",
    body: { displayName: "Reader", handle: "reader1" }
  });
  assert.equal(user.status, 201);
  const seen = await call("/v1/data/feeds.json", { ip: "203.0.113.72", token: user.body.token });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.posts.map((post) => post.id), ["1"]);
  assert.equal(JSON.stringify(seen.body).includes("secret-tiktok"), false);
  assert.equal(JSON.stringify(seen.body).includes("secret-short"), false);
  assert.equal(seen.body.feeds.length, 0);

  const owner = await call("/v1/login", {
    method: "POST",
    ip: "203.0.113.73",
    body: { accountNumber: (await call("/v1/signup", { method: "POST", ip: "203.0.113.74", body: { displayName: "nope", handle: "nope" } })).body && "" }
  });
  assert.equal(owner.status, 401);

  const owners = await bindings.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").all();
  assert.equal(owners.results.length, 1);
  const tokenRow = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.75",
    body: { displayName: "Nobody", handle: "nobody2" }
  });
  assert.notEqual(tokenRow.body.account.owner, true);
});

test("the owner session receives owner-only posts", async () => {
  const listed = await bindings.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
  assert.ok(listed);
  const session = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.80",
    body: { displayName: "Temp", handle: "temp80" }
  });
  assert.equal(session.status, 201);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.body.token));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await bindings.DB.prepare("UPDATE sessions SET public_id = ? WHERE token_hash = ?").bind(listed.public_id, hex).run();
  const full = await call("/v1/data/feeds.json", { ip: "203.0.113.81", token: session.body.token });
  assert.equal(full.status, 200);
  assert.equal(full.body.posts.length, 4);
  assert.equal(full.body.posts.some((post) => post.platform === "tiktok"), true);
});

test("a worker without a pepper is not ready", async () => {
  const bare = new Miniflare(workerOptions({ ACCOUNT_PEPPER: "" }));
  try {
    const res = await bare.dispatchFetch("https://accounts.test/v1/health");
    const body = await res.json();
    assert.equal(body.ready, false);
    const signup = await bare.dispatchFetch("https://accounts.test/v1/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.90" },
      body: JSON.stringify({ displayName: "Ada", handle: "ada2" })
    });
    assert.equal(signup.status, 503);
  } finally {
    await bare.dispose();
  }
});
