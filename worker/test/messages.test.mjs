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

async function befriend(from, to, ip) {
  const requested = await call("/v1/friends/request", {
    method: "POST",
    token: from.token,
    ip,
    body: { targetId: to.account.publicId }
  });
  assert.equal(requested.status, 200, requested.text);
  const accepted = await call("/v1/friends/accept", {
    method: "POST",
    token: to.token,
    ip,
    body: { targetId: from.account.publicId }
  });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.body.status, "friends");
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("friends can exchange messages and strangers cannot", async () => {
  const closed = await call("/v1/messages", { ip: "203.0.113.110" });
  assert.equal(closed.status, 401);

  const alice = await signup("203.0.113.111", "alice_dm", "Alice");
  const bob = await signup("203.0.113.112", "bob_dm", "Bob");
  const cara = await signup("203.0.113.113", "cara_dm", "Cara");
  await befriend(alice, bob, "203.0.113.114");

  const denied = await call("/v1/messages", {
    method: "POST",
    token: alice.token,
    ip: "203.0.113.115",
    body: { targetId: cara.account.publicId, text: "nope" }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "not_friends");

  const empty = await call("/v1/messages", {
    method: "POST",
    token: alice.token,
    ip: "203.0.113.116",
    body: { targetId: bob.account.publicId, text: "   " }
  });
  assert.equal(empty.status, 400);

  const huge = await call("/v1/messages", {
    method: "POST",
    token: alice.token,
    ip: "203.0.113.117",
    body: { targetId: bob.account.publicId, text: "a".repeat(10001) }
  });
  assert.equal(huge.status, 400);
  assert.equal(huge.body.error, "too_long");

  const sent = await call("/v1/messages", {
    method: "POST",
    token: alice.token,
    ip: "203.0.113.118",
    body: { targetId: "app:" + bob.account.publicId, text: "hello <b>" }
  });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.body.message.body, "hello <b>");
  assert.equal(sent.body.message.senderId, alice.account.publicId);
  assert.equal(sent.body.conversation.peer.publicId, bob.account.publicId);
  const id = sent.body.conversation.id;

  const list = await call("/v1/messages", { token: bob.token, ip: "203.0.113.119" });
  assert.equal(list.status, 200);
  assert.equal(list.body.conversations.length, 1);
  assert.equal(list.body.conversations[0].id, id);
  assert.equal(list.body.conversations[0].last.body, "hello <b>");
  assert.equal(list.body.conversations[0].peer.publicId, alice.account.publicId);

  const hidden = await call("/v1/messages/" + id, { token: cara.token, ip: "203.0.113.120" });
  assert.equal(hidden.status, 404);

  const reply = await call("/v1/messages/" + id, {
    method: "POST",
    token: bob.token,
    ip: "203.0.113.121",
    body: { text: "hey" }
  });
  assert.equal(reply.status, 200, reply.text);

  const thread = await call("/v1/messages/" + id, { token: alice.token, ip: "203.0.113.122" });
  assert.equal(thread.status, 200);
  assert.equal(thread.body.messages.length, 2);
  assert.equal(thread.body.messages[1].body, "hey");
  assert.equal(thread.body.messages[1].senderId, bob.account.publicId);

  const again = await call("/v1/messages", { token: alice.token, ip: "203.0.113.123" });
  assert.equal(again.body.conversations[0].last.body, "hey");
});
