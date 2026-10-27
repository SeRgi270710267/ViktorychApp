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

test("friend requests, mutual friendship, profile counts and mutual friends", async () => {
  // Unauthorized
  const closed = await call("/v1/friends", { ip: "203.0.113.80" });
  assert.equal(closed.status, 401);

  // Create Alice, Bob, Charlie
  const alice = await signup("203.0.113.81", "alice_fr", "Alice Friend");
  const bob = await signup("203.0.113.82", "bob_fr", "Bob Friend");
  const charlie = await signup("203.0.113.83", "charlie_fr", "Charlie Friend");

  // Initial status between Alice and Bob
  const initCheck = await call("/v1/friends?id=app:" + bob.account.publicId, {
    token: alice.token,
    ip: "203.0.113.84"
  });
  assert.equal(initCheck.status, 200);
  assert.equal(initCheck.body.status, "none");
  assert.equal(initCheck.body.friendsCount, 0);

  // Alice sends friend request to Bob
  const reqRes = await call("/v1/friends/request", {
    method: "POST",
    token: alice.token,
    ip: "203.0.113.85",
    body: { targetId: "app:" + bob.account.publicId }
  });
  assert.equal(reqRes.status, 200);
  assert.equal(reqRes.body.status, "sent");

  // Alice checks status with Bob -> "sent"
  const aliceCheck = await call("/v1/friends?id=app:" + bob.account.publicId, {
    token: alice.token,
    ip: "203.0.113.86"
  });
  assert.equal(aliceCheck.body.status, "sent");

  // Bob checks status with Alice -> "received"
  const bobCheck = await call("/v1/friends?id=app:" + alice.account.publicId, {
    token: bob.token,
    ip: "203.0.113.87"
  });
  assert.equal(bobCheck.body.status, "received");

  // Bob checks requests list -> incoming has Alice
  const bobRequests = await call("/v1/friends?tab=requests", {
    token: bob.token,
    ip: "203.0.113.88"
  });
  assert.equal(bobRequests.status, 200);
  assert.equal(bobRequests.body.requestsCount, 1);
  assert.equal(bobRequests.body.incoming[0].handle, "alice_fr");

  // Bob accepts Alice's request
  const acceptRes = await call("/v1/friends/accept", {
    method: "POST",
    token: bob.token,
    ip: "203.0.113.89",
    body: { targetId: alice.account.publicId }
  });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.status, "friends");

  // Both are now friends
  const bobFriends = await call("/v1/friends?id=app:" + bob.account.publicId + "&tab=friends", {
    token: alice.token,
    ip: "203.0.113.90"
  });
  assert.equal(bobFriends.status, 200);
  assert.equal(bobFriends.body.friendsCount, 1);
  assert.equal(bobFriends.body.status, "friends");
  assert.equal(bobFriends.body.friends[0].handle, "alice_fr");

  // Bob also friends Charlie
  const charlieReq = await call("/v1/friends/request", {
    method: "POST",
    token: charlie.token,
    ip: "203.0.113.91",
    body: { targetId: bob.account.publicId }
  });
  assert.equal(charlieReq.status, 200);

  const bobAcceptCharlie = await call("/v1/friends/accept", {
    method: "POST",
    token: bob.token,
    ip: "203.0.113.92",
    body: { targetId: charlie.account.publicId }
  });
  assert.equal(bobAcceptCharlie.status, 200);

  // Bob now has 2 friends (Alice and Charlie)
  const bobFriends2 = await call("/v1/friends?id=app:" + bob.account.publicId + "&tab=friends", {
    token: alice.token,
    ip: "203.0.113.93"
  });
  assert.equal(bobFriends2.body.friendsCount, 2);

  // Alice checks profile of Charlie -> mutualFriendsCount should be 1 (Bob!)
  const charlieProfile = await call("/v1/profile/charlie_fr", {
    token: alice.token,
    ip: "203.0.113.94"
  });
  assert.equal(charlieProfile.status, 200);
  assert.equal(charlieProfile.body.account.friendsCount, 1);
  assert.equal(charlieProfile.body.account.mutualFriendsCount, 1);
  assert.equal(charlieProfile.body.account.viewerFriendStatus, "none");

  // Bob unfriends Alice
  const removeRes = await call("/v1/friends/remove", {
    method: "POST",
    token: bob.token,
    ip: "203.0.113.95",
    body: { targetId: alice.account.publicId }
  });
  assert.equal(removeRes.status, 200);
  assert.equal(removeRes.body.status, "none");
  assert.equal(removeRes.body.friendsCount, 1); // Bob still friends with Charlie

  // Alice now has 0 friends
  const aliceFriends = await call("/v1/friends?id=app:" + alice.account.publicId, {
    token: alice.token,
    ip: "203.0.113.96"
  });
  assert.equal(aliceFriends.body.friendsCount, 0);
  assert.equal(aliceFriends.body.status, "self");
});
