import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { crossedTiers, tierFor } from "../../shared/badges.js";

assert.equal(tierFor({ steps: [7, 30, 365], points: [0, 0, 0] }, 40), "silver");
assert.equal(tierFor({ steps: [1, 1, 1], points: [0, 0, 5], flat: "gold" }, 1), "gold");
assert.deepEqual(crossedTiers("", "silver"), ["bronze", "silver"]);
assert.deepEqual(crossedTiers("silver", "silver"), []);

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
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");
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

function find(body, id) {
  return (body.badges || []).find((card) => card.id === id);
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("badges are awarded on the server and stay private", async () => {
  const nyx = await signup("nyx_bd", "Nyx Badge", "203.0.113.180");
  const bee = await signup("bee_bd", "Bee Badge", "203.0.113.181");
  const cay = await signup("cay_bd", "Cay Badge", "203.0.113.182");
  const id = nyx.account.publicId;
  const past = Date.parse("2026-08-01T00:00:00Z");
  await bindings.DB.prepare("UPDATE accounts SET created_at = ? WHERE public_id = ?").bind(past, id).run();
  await bindings.DB.prepare(
    "INSERT INTO public_posts (id, author_id, body, parent_id, quote_id, created_at, hidden) VALUES (?, ?, 'hello', '', '', ?, 0)"
  ).bind("b".repeat(32), id, past).run();
  await bindings.DB.prepare(
    "INSERT INTO public_posts (id, author_id, body, parent_id, quote_id, created_at, hidden) VALUES (?, ?, 'reply', ?, '', ?, 0)"
  ).bind("c".repeat(32), id, "b".repeat(32), past).run();
  await bindings.DB.prepare(
    "INSERT INTO account_reposts (public_id, post_key, kind, comment, snapshot, created_at) VALUES (?, 'post:1', 'repost', '', '{}', ?)"
  ).bind(id, past).run();
  await bindings.DB.prepare(
    "INSERT INTO post_reports (id, post_id, reporter_id, reason, created_at, status) VALUES (?, ?, ?, 'spam', ?, 'hidden')"
  ).bind("d".repeat(32), "b".repeat(32), id, past).run();

  const first = await call("/v1/badges", { token: nyx.token, ip: "203.0.113.183" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(find(first.body, "early").tier, "gold");
  assert.equal(find(first.body, "member").tier, "silver");
  assert.equal(find(first.body, "author").tier, "bronze");
  assert.equal(find(first.body, "voice").tier, "bronze");
  assert.equal(find(first.body, "signal").tier, "bronze");
  assert.equal(find(first.body, "helpful").tier, "bronze");
  assert.ok(first.body.notices.some((note) => note.id === "early" && note.tier === "gold"));
  const balance = await bindings.DB.prepare("SELECT balance FROM point_balances WHERE public_id = ?").bind(id).first();
  assert.ok(Number(balance.balance) >= 6);

  const again = await call("/v1/badges", { token: nyx.token, ip: "203.0.113.184" });
  const balanceAgain = await bindings.DB.prepare("SELECT balance FROM point_balances WHERE public_id = ?").bind(id).first();
  assert.equal(Number(balanceAgain.balance), Number(balance.balance));
  assert.equal(again.body.notices.length, first.body.notices.length);

  const claim = await call("/v1/badges/live", {
    method: "PATCH",
    token: nyx.token,
    ip: "203.0.113.185",
    body: { tier: "gold", pinned: true }
  });
  assert.equal(claim.status, 404);

  const pinEarly = await call("/v1/badges/early", { method: "PATCH", token: nyx.token, ip: "203.0.113.186", body: { pinned: true } });
  const pinMember = await call("/v1/badges/member", { method: "PATCH", token: nyx.token, ip: "203.0.113.187", body: { pinned: true } });
  const pinAuthor = await call("/v1/badges/author", { method: "PATCH", token: nyx.token, ip: "203.0.113.188", body: { pinned: true } });
  assert.equal(pinEarly.status, 200);
  assert.equal(pinMember.status, 200);
  assert.equal(pinAuthor.status, 200);
  const pinFourth = await call("/v1/badges/voice", { method: "PATCH", token: nyx.token, ip: "203.0.113.189", body: { pinned: true } });
  assert.equal(pinFourth.status, 400);
  assert.equal(pinFourth.body.error, "pins");

  const hidden = await call("/v1/badges/early", {
    method: "PATCH",
    token: nyx.token,
    ip: "203.0.113.190",
    body: { audience: "only" }
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.audience, "only");
  const stranger = await call("/v1/badges?handle=nyx_bd", { token: bee.token, ip: "203.0.113.191" });
  assert.equal(stranger.status, 200, JSON.stringify(stranger.body));
  assert.equal(find(stranger.body, "early"), undefined);
  assert.equal(find(stranger.body, "author").tier, "bronze");

  const followers = await call("/v1/badges/author", {
    method: "PATCH",
    token: nyx.token,
    ip: "203.0.113.192",
    body: { audience: "followers" }
  });
  assert.equal(followers.status, 200);
  const blocked = await call("/v1/badges?handle=nyx_bd", { token: bee.token, ip: "203.0.113.193" });
  assert.equal(find(blocked.body, "author"), undefined);
  const follow = await call("/v1/follows", { method: "PUT", token: cay.token, ip: "203.0.113.194", body: { id: "app:" + id } });
  assert.equal(follow.status, 200, JSON.stringify(follow.body));
  const seen = await call("/v1/badges?handle=nyx_bd", { token: cay.token, ip: "203.0.113.195" });
  assert.equal(find(seen.body, "author").tier, "bronze");
  assert.equal(find(seen.body, "early"), undefined);

  const seenAck = await call("/v1/badges/seen", {
    method: "POST",
    token: nyx.token,
    ip: "203.0.113.196",
    body: { id: "early", tier: "gold" }
  });
  assert.equal(seenAck.status, 200);
  const quiet = await call("/v1/badges", { token: nyx.token, ip: "203.0.113.197" });
  assert.equal(quiet.body.notices.some((note) => note.id === "early" && note.tier === "gold"), false);
});
