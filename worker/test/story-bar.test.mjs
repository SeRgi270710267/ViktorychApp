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
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.70");
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
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("story bar pins, hides, and folders stay on the signed-in account", async () => {
  const ada = await signup("user_a", "203.0.113.71");
  const bea = await signup("user_b", "203.0.113.72");
  const longName = "folder " + "x".repeat(4000);
  const saved = await call("/v1/story-bar", {
    method: "PUT",
    ip: "203.0.113.73",
    token: ada.token,
    json: {
      pins: ["telegram:laneharbor", "vk:vk"],
      hidden: [{ id: "instagram:birchlane", name: "Mark", platform: "instagram", handle: "birchlane", also: ["note:birchlane"] }],
      folders: [{ id: "fld_a", name: longName, icon: "⭐📚", members: ["telegram:laneharbor"] }],
      active: "fld_a",
      updatedAt: 50
    }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.doc.folders[0].name, longName);
  assert.equal(saved.body.doc.folders[0].icon, "⭐📚");
  assert.deepEqual(saved.body.doc.pins, ["telegram:laneharbor", "vk:vk"]);
  assert.equal(saved.body.doc.hidden[0].id, "instagram:birchlane");

  const own = await call("/v1/story-bar", { ip: "203.0.113.74", token: ada.token });
  assert.equal(own.body.doc.folders[0].name, longName);
  const other = await call("/v1/story-bar", { ip: "203.0.113.75", token: bea.token });
  assert.equal(other.body.updatedAt, 0);
  assert.equal(JSON.stringify(other.body).includes(longName), false);
  assert.equal(JSON.stringify(other.body).includes("laneharbor"), false);

  const stale = await call("/v1/story-bar", {
    method: "PUT",
    ip: "203.0.113.76",
    token: ada.token,
    json: { pins: ["vk:vk"], hidden: [], folders: [], active: "", updatedAt: 10 }
  });
  assert.equal(stale.body.kept, true);
  assert.equal(stale.body.doc.folders[0].name, longName);

  const anon = await call("/v1/story-bar", { ip: "203.0.113.77" });
  assert.equal(anon.status, 401);
});
