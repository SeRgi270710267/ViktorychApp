import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

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
      PBKDF2_ITERATIONS: "1000"
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

async function signup(ip, handle, name) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    body: { displayName: name, handle }
  });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

async function req(from, to, ip) {
  return call("/v1/friends/request", { method: "POST", token: from.token, ip, body: { targetId: "app:" + to.account.publicId } });
}

test("Friends off: requests rejected, pending paused, friends hidden, restored on", async () => {
  const ana = await signup("198.51.100.11", "ana_fo", "Ana Off");
  const ben = await signup("198.51.100.12", "ben_fo", "Ben Off");
  const cy = await signup("198.51.100.13", "cy_fo", "Cy Off");
  const dee = await signup("198.51.100.14", "dee_fo", "Dee Off");

  // Defaults
  const start = await call("/v1/friends/settings", { token: ana.token, ip: "198.51.100.20" });
  assert.equal(start.status, 200, start.text);
  assert.equal(start.body.enabled, true);
  assert.equal(start.body.whoCanRequest, "everyone");

  // Ana and Ben become friends; Cy has a pending request to Ana.
  assert.equal((await req(ana, ben, "198.51.100.21")).status, 200);
  assert.equal((await call("/v1/friends/accept", { method: "POST", token: ben.token, ip: "198.51.100.22", body: { targetId: ana.account.publicId } })).body.status, "friends");
  assert.equal((await req(cy, ana, "198.51.100.23")).body.status, "sent");

  // Ana turns Friends off (keep friends, pause requests).
  const off = await call("/v1/friends/settings", { method: "PUT", token: ana.token, ip: "198.51.100.24", body: { enabled: false } });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.body.enabled, false);
  assert.equal(off.body.held.incoming, 1);
  assert.equal(off.body.held.friends, 1);

  // Nobody can send her a request.
  const rejected = await req(dee, ana, "198.51.100.25");
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "friends_off");
  // She can't send or accept either.
  assert.equal((await req(ana, dee, "198.51.100.26")).body.error, "friends_off_self");
  assert.equal((await call("/v1/friends/accept", { method: "POST", token: ana.token, ip: "198.51.100.27", body: { targetId: cy.account.publicId } })).status, 403);

  // Her pending requests are paused (hidden), not deleted.
  const paused = await call("/v1/friends?tab=requests", { token: ana.token, ip: "198.51.100.28" });
  assert.equal(paused.body.requestsCount, 0);
  assert.equal(paused.body.friendsOff, true);
  const cyOut = await call("/v1/friends?tab=requests", { token: cy.token, ip: "198.51.100.29" });
  assert.equal(cyOut.body.outgoing.length, 0);

  // Her profile shows no friends, no count, no button.
  const view = await call("/v1/friends?id=app:" + ana.account.publicId + "&tab=friends", { token: dee.token, ip: "198.51.100.30" });
  assert.equal(view.body.friendsOff, true);
  assert.equal(view.body.friendsCount, 0);
  assert.equal(view.body.canRequest, false);
  assert.deepEqual(view.body.friends, []);
  // Ben's friends list and count no longer show her.
  const benView = await call("/v1/friends?id=app:" + ben.account.publicId + "&tab=friends", { token: dee.token, ip: "198.51.100.31" });
  assert.equal(benView.body.friendsCount, 0);
  assert.equal(benView.body.friends.length, 0);
  // Presence: Ben's friends panel leaves her out, hers is empty.
  const benPresence = await call("/v1/friends/presence", { token: ben.token, ip: "198.51.100.32" });
  assert.equal(benPresence.status, 200);
  assert.equal(benPresence.body.friends.length, 0);
  const anaPresence = await call("/v1/friends/presence", { token: ana.token, ip: "198.51.100.33" });
  assert.equal(anaPresence.body.friendsOff, true);

  // Back on: everything returns.
  const on = await call("/v1/friends/settings", { method: "PUT", token: ana.token, ip: "198.51.100.34", body: { enabled: true } });
  assert.equal(on.body.enabled, true);
  const back = await call("/v1/friends?tab=requests", { token: ana.token, ip: "198.51.100.35" });
  assert.equal(back.body.requestsCount, 1);
  const benBack = await call("/v1/friends?id=app:" + ben.account.publicId + "&tab=friends", { token: dee.token, ip: "198.51.100.36" });
  assert.equal(benBack.body.friendsCount, 1);
  assert.equal((await req(dee, ana, "198.51.100.37")).status, 200);
});

test("Friends choices: who can request, list audience, decline all and remove all", async () => {
  const eve = await signup("198.51.100.41", "eve_fo", "Eve Off");
  const fin = await signup("198.51.100.42", "fin_fo", "Fin Off");
  const gus = await signup("198.51.100.43", "gus_fo", "Gus Off");

  assert.equal((await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.44", body: { whoCanRequest: "bogus" } })).status, 400);
  assert.equal((await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.45", body: { whoCanRequest: "nobody" } })).body.whoCanRequest, "nobody");
  const nobody = await req(fin, eve, "198.51.100.46");
  assert.equal(nobody.status, 403);
  assert.equal(nobody.body.error, "not_accepting");

  // Friends of friends: Gus has no friend in common with Eve yet.
  await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.47", body: { whoCanRequest: "fof" } });
  assert.equal((await req(gus, eve, "198.51.100.48")).status, 403);
  // Eve and Fin become friends (Eve asks), Gus and Fin become friends.
  assert.equal((await req(eve, fin, "198.51.100.49")).status, 200);
  await call("/v1/friends/accept", { method: "POST", token: fin.token, ip: "198.51.100.50", body: { targetId: eve.account.publicId } });
  assert.equal((await req(gus, fin, "198.51.100.51")).status, 200);
  await call("/v1/friends/accept", { method: "POST", token: fin.token, ip: "198.51.100.52", body: { targetId: gus.account.publicId } });
  assert.equal((await req(gus, eve, "198.51.100.53")).body.status, "sent");

  // Only me: others get a private list.
  await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.54", body: { listAudience: "me" } });
  const hidden = await call("/v1/friends?id=app:" + eve.account.publicId + "&tab=friends", { token: fin.token, ip: "198.51.100.55" });
  assert.equal(hidden.body.isPrivate, true);
  assert.deepEqual(hidden.body.friends, []);
  // Friends: Fin (a friend) sees it, Gus doesn't.
  await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.56", body: { listAudience: "friends" } });
  assert.equal((await call("/v1/friends?id=app:" + eve.account.publicId + "&tab=friends", { token: fin.token, ip: "198.51.100.57" })).body.friends.length, 1);
  assert.equal((await call("/v1/friends?id=app:" + eve.account.publicId + "&tab=friends", { token: gus.token, ip: "198.51.100.58" })).body.isPrivate, true);

  // Off with decline all + remove all (remove needs the confirm word).
  assert.equal((await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.59", body: { enabled: false, removeAll: true } })).status, 400);
  const wiped = await call("/v1/friends/settings", { method: "PUT", token: eve.token, ip: "198.51.100.60", body: { enabled: false, declineAll: true, removeAll: true, confirm: "remove" } });
  assert.equal(wiped.status, 200, wiped.text);
  assert.equal(wiped.body.held.incoming, 0);
  assert.equal(wiped.body.held.friends, 0);
  const finNow = await call("/v1/friends?id=app:" + fin.account.publicId + "&tab=friends", { token: gus.token, ip: "198.51.100.61" });
  assert.equal(finNow.body.friendsCount, 1);
});

test("friends settings needs sign-in", async () => {
  const ok = await call("/v1/friends/settings", { ip: "198.51.100.70" });
  assert.equal(ok.status, 401);
});
