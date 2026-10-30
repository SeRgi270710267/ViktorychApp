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


const follow = (who, target, n) => call("/v1/follows", { method: "PUT", ip: "203.0.113." + n, token: who.token, body: { id: "app:" + target.account.publicId } });
const handlesOf = (body) => Object.keys(body.groups || {}).filter((g) => g !== "communities").reduce((acc, g) => acc.concat(body.groups[g].map((a) => a.h)), []);
const fresh = (who, n) => call("/v1/suggestions?fresh=1", { ip: "203.0.113." + n, token: who.token });

test("suggestions: friends of friends, follows you, communities, exclusions, opt-out, dismiss, types", async () => {
  const db = await mf.getD1Database("DB");
  const me = await signup(101, "Viewer Pym", "pym_viewer");
  const bridge = await signup(102, "Bridge Pym", "pym_bridge");
  const fof = await signup(103, "Friendly Pym", "pym_friendly");
  const fan = await signup(104, "Fan Pym", "pym_fan");
  const blocked = await signup(105, "Blocked Pym", "pym_blocked");
  const muted = await signup(106, "Muted Pym", "pym_muted");
  const hidden = await signup(107, "Hidden Pym", "pym_hidden");
  const locked = await signup(108, "Locked Pym", "pym_locked");
  const temp = await signup(109, "Temp Pym", "pym_temp");
  const shop = await signup(110, "Shop Pym", "pym_shop");
  const neighbor = await signup(111, "Neighbor Pym", "pym_neighbor");
  const secretBridge = await signup(112, "Secret Bridge", "pym_secret");
  const secretPick = await signup(113, "Secret Pick", "pym_secretpick");

  assert.equal((await call("/v1/suggestions", { ip: "203.0.113.120" })).status, 401);

  assert.equal((await follow(me, bridge, 121)).status, 200);
  for (const target of [fof, blocked, muted, hidden, locked, temp, shop]) assert.equal((await follow(bridge, target, 122)).status, 200);
  assert.equal((await follow(fan, me, 123)).status, 200);
  assert.equal((await follow(me, secretBridge, 124)).status, 200);
  assert.equal((await follow(secretBridge, secretPick, 125)).status, 200);
  await db.prepare("UPDATE accounts SET private_follows = 1 WHERE public_id = ?").bind(secretBridge.account.publicId).run();
  await db.prepare("UPDATE accounts SET protected_account = 1 WHERE public_id = ?").bind(locked.account.publicId).run();
  await db.prepare("INSERT INTO account_temp (public_id, expires_at, created_at) VALUES (?, ?, ?)").bind(temp.account.publicId, Date.now() + 86400000, Date.now()).run();
  const now = Date.now();
  await db.prepare("INSERT INTO community_members (community_id, public_id, created_at) VALUES ('pymspace', ?, ?), ('pymspace', ?, ?)").bind(me.account.publicId, now, neighbor.account.publicId, now).run();

  assert.equal((await call("/v1/blocks", { method: "PUT", ip: "203.0.113.126", token: me.token, body: { id: blocked.account.publicId } })).status, 200);
  assert.equal((await call("/v1/mutes", { method: "PUT", ip: "203.0.113.127", token: me.token, body: { id: muted.account.publicId } })).status, 200);
  const optOut = await call("/v1/suggestions/prefs", { method: "PUT", ip: "203.0.113.128", token: hidden.token, body: { discoverable: false } });
  assert.equal(optOut.status, 200);
  assert.equal(optOut.body.discoverable, false);
  const typed = await call("/v1/suggestions/prefs", { method: "PUT", ip: "203.0.113.129", token: shop.token, body: { kind: "business" } });
  assert.equal(typed.body.kind, "business");
  assert.equal((await call("/v1/suggestions/prefs", { method: "PUT", ip: "203.0.113.129", token: shop.token, body: { kind: "dragon" } })).status, 400);

  const res = await fresh(me, 130);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const shown = handlesOf(res.body);
  assert.ok(shown.indexOf("pym_friendly") >= 0, "friend of a friend");
  assert.ok(shown.indexOf("pym_fan") >= 0, "follows you");
  assert.ok(shown.indexOf("pym_neighbor") >= 0, "shared community");
  for (const gone of ["pym_viewer", "pym_bridge", "pym_blocked", "pym_muted", "pym_hidden", "pym_locked", "pym_temp", "pym_secretpick", "pym_secret"]) {
    assert.equal(shown.indexOf(gone), -1, gone + " must not be suggested");
  }
  assert.deepEqual(res.body.groups.companies.map((a) => a.h), ["pym_shop"]);
  const friendly = res.body.groups.people.find((a) => a.h === "pym_friendly");
  assert.equal(friendly.r.k, "fof");
  assert.equal(friendly.r.name, "Bridge Pym");
  assert.equal(friendly.id, "app:@pym_friendly");
  assert.equal(res.body.groups.people.find((a) => a.h === "pym_fan").r.k, "fy");
  assert.equal(res.body.groups.people.find((a) => a.h === "pym_neighbor").r.c, "pymspace");
  for (const acct of [me, bridge, fof, fan, shop, neighbor, secretBridge]) assert.equal(res.text.indexOf(acct.account.publicId), -1, "no account numbers in the payload");

  // A temporary account that opted in may appear.
  await call("/v1/suggestions/prefs", { method: "PUT", ip: "203.0.113.131", token: temp.token, body: { tempOptIn: true } });
  assert.ok(handlesOf((await fresh(me, 132)).body).indexOf("pym_temp") >= 0);

  // Dismiss by handle drops it, also from the cached answer.
  await call("/v1/suggestions", { ip: "203.0.113.133", token: me.token });
  const dismissed = await call("/v1/suggestions/dismiss", { method: "POST", ip: "203.0.113.134", token: me.token, body: { id: "app:@pym_friendly" } });
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
  assert.equal(handlesOf((await call("/v1/suggestions", { ip: "203.0.113.135", token: me.token })).body).indexOf("pym_friendly"), -1);

  // Following removes it on the next compute.
  await follow(me, fan, 136);
  assert.equal(handlesOf((await fresh(me, 137)).body).indexOf("pym_fan"), -1);

  // Owner override of the type, and only the owner may do it.
  assert.equal((await call("/v1/owner/account-kind", { method: "PUT", ip: "203.0.113.138", token: me.token, body: { id: "app:@pym_neighbor", kind: "media" } })).status, 403);
  await db.prepare("UPDATE accounts SET owner = 1 WHERE public_id = ?").bind(bridge.account.publicId).run();
  const over = await call("/v1/owner/account-kind", { method: "PUT", ip: "203.0.113.139", token: bridge.token, body: { id: "app:@pym_neighbor", kind: "media" } });
  assert.equal(over.status, 200, JSON.stringify(over.body));
  const after = await fresh(me, 140);
  assert.deepEqual((after.body.groups.media || []).map((a) => a.h), ["pym_neighbor"]);
});

test("suggestions: communities to join from people you follow", async () => {
  const db = await mf.getD1Database("DB");
  const me = await signup(150, "Comm Viewer", "pym_cviewer");
  const pal = await signup(151, "Comm Pal", "pym_cpal");
  await follow(me, pal, 152);
  const now = Date.now();
  await db.prepare("INSERT INTO community_members (community_id, public_id, created_at) VALUES ('pymjoin', ?, ?), ('pymsecret', ?, ?)").bind(pal.account.publicId, now, pal.account.publicId, now).run();
  await db.prepare("INSERT INTO community_meta (community_id, visibility, updated_at) VALUES ('pymsecret', 'private', ?)").bind(now).run();
  const res = await fresh(me, 153);
  assert.deepEqual((res.body.groups.communities || []).map((c) => c.id), ["pymjoin"]);
  await call("/v1/suggestions/dismiss", { method: "POST", ip: "203.0.113.154", token: me.token, body: { community: "pymjoin" } });
  assert.equal((await fresh(me, 155)).body.groups.communities, undefined);
});
