import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { sweepExpiredNotes } from "../src/notes.js";

let mf;
let bindings;

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
      OWNER_HANDLE: "user_owner",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.20");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.json ? JSON.stringify(opts.json) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body };
}

async function signup(handle, ip) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    json: { displayName: "User " + handle.slice(-1).toUpperCase(), handle }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("notes stay private, expire, and do not become stories", async () => {
  const ada = await signup("user_a", "203.0.113.21");
  const bea = await signup("user_b", "203.0.113.22");
  const cam = await signup("user_c", "203.0.113.23");
  const dee = await signup("user_d", "203.0.113.24");

  const saved = await call("/v1/notes", {
    method: "PUT",
    ip: "203.0.113.25",
    token: ada.token,
    json: { text: "hello from a note", audience: "followers", expire: true }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.stories, 0);
  const stories = await call("/v1/stories", { ip: "203.0.113.26", token: ada.token });
  assert.equal((stories.body.accounts || []).length, 0);

  const stranger = await call("/v1/notes", { ip: "203.0.113.27", token: bea.token });
  assert.equal(stranger.body.notes.length, 0);
  assert.equal(JSON.stringify(stranger.body).includes("hello from a note"), false);

  await call("/v1/follows", { method: "PUT", ip: "203.0.113.28", token: bea.token, json: { id: "app:" + ada.account.publicId } });
  const follower = await call("/v1/notes", { ip: "203.0.113.29", token: bea.token });
  assert.equal(follower.body.notes.length, 1);
  assert.equal(follower.body.notes[0].text, "hello from a note");
  assert.equal(follower.body.notes[0].handle, "user_a");
  assert.equal(follower.body.notes[0].audience, undefined);
  assert.equal(JSON.stringify(follower.body).includes(ada.account.publicId), false);

  const replaced = await call("/v1/notes", {
    method: "PUT",
    ip: "203.0.113.30",
    token: ada.token,
    json: { text: "edited note", audience: "only", expire: false }
  });
  assert.equal(replaced.status, 200);
  const hidden = await call("/v1/notes", { ip: "203.0.113.31", token: bea.token });
  assert.equal(hidden.body.notes.length, 0);
  const own = await call("/v1/notes", { ip: "203.0.113.32", token: ada.token });
  assert.equal(own.body.mine.text, "edited note");
  assert.equal(own.body.mine.audience, "only");
  assert.equal(own.body.mine.expiresAt, 0);

  const tooLong = await call("/v1/notes", {
    method: "PUT",
    ip: "203.0.113.33",
    token: ada.token,
    json: { text: "x".repeat(61), audience: "followers" }
  });
  assert.equal(tooLong.status, 400);
  const still = await call("/v1/notes", { ip: "203.0.113.34", token: ada.token });
  assert.equal(still.body.mine.text, "edited note");

  await call("/v1/notes", {
    method: "PUT",
    ip: "203.0.113.35",
    token: ada.token,
    json: { text: "friends only 🎉", audience: "friends", expire: true }
  });
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.36", token: cam.token, json: { id: "app:" + ada.account.publicId } });
  const notMutual = await call("/v1/notes", { ip: "203.0.113.37", token: cam.token });
  assert.equal(notMutual.body.notes.some((item) => item.handle === "user_a"), false);
  await bindings.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(cam.account.publicId, ada.account.publicId, Date.now()).run();
  const mutual = await call("/v1/notes", { ip: "203.0.113.38", token: cam.token });
  assert.equal(mutual.body.notes.some((item) => item.text === "friends only 🎉"), true);

  const deniedReact = await call("/v1/notes/react", {
    method: "POST",
    ip: "203.0.113.39",
    token: dee.token,
    json: { handle: "user_a", emoji: "❤" }
  });
  assert.equal(deniedReact.status, 404);
  const reacted = await call("/v1/notes/react", {
    method: "POST",
    ip: "203.0.113.40",
    token: cam.token,
    json: { handle: "user_a", emoji: "❤" }
  });
  assert.equal(reacted.status, 200);
  const reply = await call("/v1/notes/reply", {
    method: "POST",
    ip: "203.0.113.41",
    token: cam.token,
    json: { handle: "user_a", text: "nice note" }
  });
  assert.equal(reply.status, 201);
  const message = await bindings.DB.prepare("SELECT body FROM account_messages WHERE sender_id = ? AND recipient_id = ?").bind(cam.account.publicId, ada.account.publicId).first();
  assert.equal(message.body, "nice note");
  assert.equal(String(message.body).includes("friends only"), false);

  await call("/v1/blocks", { method: "PUT", ip: "203.0.113.42", token: dee.token, json: { id: ada.account.publicId } });
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.43", token: dee.token, json: { id: "app:" + ada.account.publicId } });
  const blocked = await call("/v1/notes", { ip: "203.0.113.44", token: dee.token });
  assert.equal(blocked.body.notes.some((item) => item.handle === "user_a"), false);

  await bindings.DB.prepare("UPDATE profile_notes SET expires_at = ? WHERE public_id = ?").bind(Date.now() - 1000, ada.account.publicId).run();
  const swept = await sweepExpiredNotes(bindings, Date.now());
  assert.equal(swept.removed, 1);
  const gone = await call("/v1/notes", { ip: "203.0.113.45", token: ada.token });
  assert.equal(gone.body.mine, null);
  const after = await call("/v1/notes", { ip: "203.0.113.46", token: cam.token });
  assert.equal(after.body.notes.some((item) => item.handle === "user_a"), false);
});
