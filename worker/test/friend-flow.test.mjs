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

async function notes(token, ip) {
  const res = await call("/v1/notifications", { token, ip });
  assert.equal(res.status, 200, res.text);
  return res.body;
}

function friendNotes(view, kind) {
  return (view.items || []).filter((item) => item.kind === kind);
}

test("the whole friend flow notifies, lists and clears on both sides", async () => {
  const sam = await signup("203.0.113.121", "flow_sam", "Sam Flow");
  const kit = await signup("203.0.113.122", "flow_kit", "Kit Flow");
  const kitId = "app:" + kit.account.publicId;
  const samId = "app:" + sam.account.publicId;

  // Send: the receiver gets one in-app note (badge count) that opens their Requests tab.
  const sent = await call("/v1/friends/request", { method: "POST", token: sam.token, ip: "203.0.113.123", body: { targetId: kitId } });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.body.status, "sent");
  const again = await call("/v1/friends/request", { method: "POST", token: sam.token, ip: "203.0.113.123", body: { targetId: kitId } });
  assert.equal(again.body.status, "sent");
  let kitNotes = await notes(kit.token, "203.0.113.124");
  const req = friendNotes(kitNotes, "friend_request");
  assert.equal(req.length, 1, "a repeated request does not notify twice");
  assert.equal(req[0].handle, "flow_sam");
  assert.match(req[0].hash, /^#\/@flow_kit\/requests\?kind=friends$/);
  assert.ok(Number(kitNotes.unread) >= 1, "the bell badge counts it");

  // The sender's view of the receiver keeps "sent" from the server: profile and friends tab.
  const theirProfile = await call("/v1/profile/flow_kit", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(theirProfile.status, 200, theirProfile.text);
  assert.equal(theirProfile.body.account.viewerFriendStatus, "sent");
  const theirFriends = await call("/v1/friends?id=" + encodeURIComponent(kitId) + "&tab=friends", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(theirFriends.status, 200, theirFriends.text);
  assert.equal(theirFriends.body.status, "sent");

  // Requests tab on both sides.
  let kitReq = await call("/v1/friends?tab=requests", { token: kit.token, ip: "203.0.113.124" });
  assert.equal(kitReq.body.incoming.length, 1);
  assert.equal(kitReq.body.incoming[0].handle, "flow_sam");
  let samReq = await call("/v1/friends?tab=requests", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(samReq.body.outgoing.length, 1);

  // Cancel clears both sides.
  const cancelled = await call("/v1/friends/cancel", { method: "POST", token: sam.token, ip: "203.0.113.123", body: { targetId: kitId } });
  assert.equal(cancelled.body.status, "none");
  kitReq = await call("/v1/friends?tab=requests", { token: kit.token, ip: "203.0.113.124" });
  assert.equal(kitReq.body.incoming.length, 0);

  // Decline clears both sides and sends no note to the sender.
  await call("/v1/friends/request", { method: "POST", token: sam.token, ip: "203.0.113.123", body: { targetId: kitId } });
  const declined = await call("/v1/friends/decline", { method: "POST", token: kit.token, ip: "203.0.113.124", body: { targetId: samId } });
  assert.equal(declined.body.status, "none");
  samReq = await call("/v1/friends?tab=requests", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(samReq.body.outgoing.length, 0);

  // Accept: the sender hears about it, both friends lists and presence include each other.
  await call("/v1/friends/request", { method: "POST", token: sam.token, ip: "203.0.113.123", body: { targetId: kitId } });
  const accepted = await call("/v1/friends/accept", { method: "POST", token: kit.token, ip: "203.0.113.124", body: { targetId: samId } });
  assert.equal(accepted.body.status, "friends");
  const samNotes = await notes(sam.token, "203.0.113.123");
  const ok = friendNotes(samNotes, "friend_accept");
  assert.equal(ok.length, 1);
  assert.equal(ok[0].handle, "flow_kit");
  const samFriends = await call("/v1/friends?id=" + samId + "&tab=friends", { token: sam.token, ip: "203.0.113.123" });
  assert.deepEqual(samFriends.body.friends.map((f) => f.handle), ["flow_kit"]);
  const kitFriends = await call("/v1/friends?id=" + kitId + "&tab=friends", { token: kit.token, ip: "203.0.113.124" });
  assert.deepEqual(kitFriends.body.friends.map((f) => f.handle), ["flow_sam"]);
  const presence = await call("/v1/friends/presence", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(presence.status, 200, presence.text);
  assert.equal(presence.body.friends.length, 1);

  // Unfriend clears both lists.
  const removed = await call("/v1/friends/remove", { method: "POST", token: kit.token, ip: "203.0.113.124", body: { targetId: samId } });
  assert.equal(removed.body.status, "none");
  const after = await call("/v1/friends?id=" + samId + "&tab=friends", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(after.body.friends.length, 0);
  const presenceAfter = await call("/v1/friends/presence", { token: sam.token, ip: "203.0.113.123" });
  assert.equal(presenceAfter.body.friends.length, 0);

  // The two test accounts live only in this in-memory Miniflare database.
});
