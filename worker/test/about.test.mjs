import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { canSeeField, publicBirthday } from "../src/about.js";

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
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.60");
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

async function signup(handle, ip) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    body: { displayName: "User " + handle.slice(-1).toUpperCase(), handle }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

function texts(pack) {
  const out = [];
  ((pack && pack.sections) || []).forEach((section) => {
    (section.fields || []).forEach((field) => out.push(field.text));
  });
  return out;
}

test("audience matrix hides fields the viewer cannot see", () => {
  const stranger = { owner: false, follows: false, followsYou: false, friends: false, blocked: false, viewerId: "000000000002" };
  const follower = { owner: false, follows: true, followsYou: false, friends: false, blocked: false, viewerId: "000000000002" };
  const mutual = { owner: false, follows: true, followsYou: true, friends: false, blocked: false, viewerId: "000000000002" };
  const blocked = { owner: false, follows: true, followsYou: true, friends: true, blocked: true, viewerId: "000000000002" };
  assert.equal(canSeeField("public", stranger, {}), true);
  assert.equal(canSeeField("followers", stranger, {}), false);
  assert.equal(canSeeField("followers", follower, {}), true);
  assert.equal(canSeeField("friends", follower, {}), false);
  assert.equal(canSeeField("friends", mutual, {}), true);
  assert.equal(canSeeField("only", mutual, {}), false);
  assert.equal(canSeeField("public", blocked, {}), false);
  assert.equal(canSeeField("list", stranger, { "000000000002": 1 }), true);
  assert.equal(canSeeField("list", stranger, {}), false);
  assert.equal(publicBirthday("sample 1900", false), "sample");
  assert.equal(publicBirthday("sample 1900", true), "sample 1900");
});

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("the about API enforces each field for the owner, a follower, a stranger, and a blocked account", async () => {
  const ada = await signup("user_a", "203.0.113.61");
  const bea = await signup("user_b", "203.0.113.62");
  const cam = await signup("user_c", "203.0.113.63");
  const dee = await signup("user_d", "203.0.113.64");

  const city = await call("/v1/about", {
    method: "POST",
    ip: "203.0.113.65",
    token: ada.token,
    body: { section: "personal", kind: "city", text: "sample city", audience: "public" }
  });
  assert.equal(city.status, 201);

  const day = await call("/v1/about", {
    method: "POST",
    ip: "203.0.113.66",
    token: ada.token,
    body: { section: "personal", kind: "birthday", text: "sample 1900", audience: "public", showYear: false }
  });
  assert.equal(day.status, 201);

  const secret = await call("/v1/about", {
    method: "POST",
    ip: "203.0.113.67",
    token: ada.token,
    body: { section: "personal", kind: "relationship", text: "sample status", audience: "only" }
  });
  assert.equal(secret.status, 201);

  const note = await call("/v1/about", {
    method: "POST",
    ip: "203.0.113.68",
    token: ada.token,
    body: { section: "personal", kind: "language", text: "sample tongue", audience: "followers" }
  });
  assert.equal(note.status, 201);

  const kin = await call("/v1/about", {
    method: "POST",
    ip: "203.0.113.69",
    token: ada.token,
    body: { section: "personal", kind: "family", text: "kin", audience: "friends", personHandle: "user_b" }
  });
  assert.equal(kin.status, 201);

  const listed = await call("/v1/about", {
    method: "POST",
    ip: "203.0.113.70",
    token: ada.token,
    body: { section: "interests", kind: "interest", text: "sample interest", audience: "list", listId: "list_a", members: [bea.account.publicId] }
  });
  assert.equal(listed.status, 201);

  const own = await call("/v1/about?handle=user_a", { ip: "203.0.113.71", token: ada.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.owner, true);
  assert.ok(texts(own.body).includes("sample 1900"));
  assert.ok(texts(own.body).includes("sample status"));

  const stranger = await call("/v1/about?handle=user_a", { ip: "203.0.113.72", token: cam.token });
  const strangerText = texts(stranger.body).join("\n");
  assert.equal(strangerText.includes("sample city"), true);
  assert.equal(strangerText.includes("sample status"), false);
  assert.equal(strangerText.includes("sample tongue"), false);
  assert.equal(strangerText.includes("sample interest"), false);
  assert.equal(strangerText.includes("1900"), false);
  assert.equal(strangerText.includes("sample"), true);
  assert.equal(JSON.stringify(stranger.body).includes("audience"), false);

  const followed = await call("/v1/follows", {
    method: "PUT",
    ip: "203.0.113.73",
    token: bea.token,
    body: { id: "app:" + ada.account.publicId }
  });
  assert.equal(followed.status, 200);
  const follower = await call("/v1/about?handle=user_a", { ip: "203.0.113.74", token: bea.token });
  const followerText = texts(follower.body).join("\n");
  assert.equal(followerText.includes("sample tongue"), true);
  assert.equal(followerText.includes("sample status"), false);
  assert.equal(followerText.includes("kin"), false);
  assert.equal(followerText.includes("sample interest"), true);

  await bindings.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(bea.account.publicId, ada.account.publicId, Date.now()).run();
  const friend = await call("/v1/about?handle=user_a", { ip: "203.0.113.75", token: bea.token });
  assert.equal(texts(friend.body).includes("kin"), true);
  assert.equal(texts(friend.body).includes("sample status"), false);

  const preview = await call("/v1/about?handle=user_a&as=public", { ip: "203.0.113.76", token: ada.token });
  assert.equal(preview.body.owner, false);
  assert.equal(texts(preview.body).includes("sample status"), false);
  assert.equal(texts(preview.body).includes("sample city"), true);
  assert.equal(texts(preview.body).join("\n").includes("1900"), false);

  const sneak = await call("/v1/about?handle=user_a&as=follower", { ip: "203.0.113.77", token: cam.token });
  assert.equal(texts(sneak.body).includes("sample tongue"), false);

  const blocked = await call("/v1/blocks", {
    method: "PUT",
    ip: "203.0.113.78",
    token: dee.token,
    body: { id: ada.account.publicId }
  });
  assert.equal(blocked.status, 200);
  const hidden = await call("/v1/about?handle=user_a", { ip: "203.0.113.79", token: dee.token });
  assert.equal(hidden.body.visible, false);
  assert.equal(texts(hidden.body).length, 0);
  assert.equal(JSON.stringify(hidden.body).includes("sample city"), false);
});
