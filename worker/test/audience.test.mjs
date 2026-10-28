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
      OWNER_HANDLE: "user_owner",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.110");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  if (opts.multipart) headers.set("content-type", opts.multipart.type);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.multipart ? opts.multipart.body : (opts.json ? JSON.stringify(opts.json) : undefined)
  });
  if (opts.raw) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
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
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("a custom audience list stays private and gates a note", async () => {
  const ada = await signup("user_a", "203.0.113.111");
  const bea = await signup("user_b", "203.0.113.112");
  const cam = await signup("user_c", "203.0.113.113");
  const dee = await signup("user_d", "203.0.113.114");
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.115", token: bea.token, json: { id: "app:" + ada.account.publicId } });
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.116", token: cam.token, json: { id: "app:" + ada.account.publicId } });

  const name = "🌙 " + "list".repeat(400);
  const created = await call("/v1/audience-lists", {
    method: "POST",
    ip: "203.0.113.117",
    token: ada.token,
    json: { name: name, icon: "🌙" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, name);
  const added = await call("/v1/audience-lists/" + created.body.id + "/members", {
    method: "POST",
    ip: "203.0.113.118",
    token: ada.token,
    json: { handle: "user_b" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.members.some((item) => item.handle === "user_b"), true);
  const stranger = await call("/v1/audience-lists/" + created.body.id + "/members", {
    method: "POST",
    ip: "203.0.113.119",
    token: ada.token,
    json: { handle: "user_d" }
  });
  assert.equal(stranger.status, 400);

  const owner = await call("/v1/audience-lists", { ip: "203.0.113.120", token: ada.token });
  assert.equal(owner.body.lists[0].name, name);
  const memberView = await call("/v1/audience-lists", { ip: "203.0.113.121", token: bea.token });
  assert.equal(JSON.stringify(memberView.body).includes(name), false);
  const other = await call("/v1/audience-lists/" + created.body.id, { ip: "203.0.113.122", token: cam.token });
  assert.equal(other.status, 404);

  const note = await call("/v1/notes", {
    method: "PUT",
    ip: "203.0.113.123",
    token: ada.token,
    json: { text: "list only note", audience: "list", listIds: [created.body.id], expire: false }
  });
  assert.equal(note.status, 200);
  const seen = await call("/v1/notes", { ip: "203.0.113.124", token: bea.token });
  assert.equal(seen.body.notes.some((item) => item.text === "list only note"), true);
  const missed = await call("/v1/notes", { ip: "203.0.113.125", token: cam.token });
  assert.equal(missed.body.notes.some((item) => item.text === "list only note"), false);
  assert.equal(JSON.stringify(missed.body).includes("list only note"), false);

  await call("/v1/audience-lists/" + created.body.id + "/members", {
    method: "DELETE",
    ip: "203.0.113.126",
    token: ada.token,
    json: { handle: "user_b" }
  });
  const removed = await call("/v1/notes", { ip: "203.0.113.127", token: bea.token });
  assert.equal(removed.body.notes.some((item) => item.text === "list only note"), false);
  const still = await call("/v1/notes", { ip: "203.0.113.128", token: ada.token });
  assert.equal(still.body.mine.text, "list only note");
  assert.equal(dee.account.publicId.length, 12);
});
