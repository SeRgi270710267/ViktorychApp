import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { sweepExpiredStories } from "../src/app-stories.js";

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

function multipart(fields, file) {
  const boundary = "storybound";
  const chunks = [];
  Object.keys(fields).forEach((name) => {
    chunks.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + fields[name] + "\r\n"));
  });
  chunks.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + file.name + "\"\r\nContent-Type: " + file.type + "\r\n\r\n"));
  chunks.push(Buffer.from(file.bytes));
  chunks.push(Buffer.from("\r\n--" + boundary + "--\r\n"));
  return { body: Buffer.concat(chunks), type: "multipart/form-data; boundary=" + boundary };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.40");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  if (opts.multipart) headers.set("content-type", opts.multipart.type);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.multipart ? opts.multipart.body : (opts.json ? JSON.stringify(opts.json) : undefined)
  });
  const type = res.headers.get("content-type") || "";
  if (opts.raw) {
    return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text, type: type }; }
  return { status: res.status, headers: res.headers, body };
}

function photoBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
}

function videoBytes() {
  const bytes = new Uint8Array(16);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x01]);
  return bytes;
}

async function signup(handle, name, ip) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    json: { displayName: name, handle: handle }
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

test("app stories keep original bytes, hide from strangers, and expire", async () => {
  const closed = await call("/v1/stories", { ip: "203.0.113.40" });
  assert.equal(closed.status, 401);

  const ada = await signup("user_a", "User A", "203.0.113.41");
  const bea = await signup("user_b", "User B", "203.0.113.42");
  const cam = await signup("user_c", "User C", "203.0.113.43");

  const photo = photoBytes();
  const posted = await call("/v1/stories", {
    method: "POST",
    ip: "203.0.113.44",
    token: ada.token,
    multipart: multipart({ caption: "hello", vine: "0" }, { name: "photo.jpg", type: "image/jpeg", bytes: photo })
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.type, "photo");
  assert.match(posted.body.url, /\/v1\/stories\/media\/[a-f0-9]{32}$/);

  const video = videoBytes();
  const vine = await call("/v1/stories", {
    method: "POST",
    ip: "203.0.113.45",
    token: ada.token,
    multipart: multipart({ vine: "1" }, { name: "clip.mp4", type: "video/mp4", bytes: video })
  });
  assert.equal(vine.status, 201);
  assert.equal(vine.body.vine, true);
  assert.equal(vine.body.type, "video");

  const mediaPath = new URL(vine.body.url).pathname;
  const media = await call(mediaPath, { raw: true });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("cache-control"), "private, no-store");
  assert.equal(media.headers.get("cdn-cache-control"), "no-store");
  assert.equal(media.headers.get("content-type"), "video/mp4");
  assert.deepEqual(media.bytes, video);

  const own = await call("/v1/stories", { ip: "203.0.113.46", token: ada.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.accounts.length, 1);
  assert.equal(own.body.accounts[0].self, true);
  assert.equal(own.body.accounts[0].items.length, 2);
  assert.equal(own.body.accounts[0].items.some((item) => item.vine), true);

  const stranger = await call("/v1/stories", { ip: "203.0.113.47", token: cam.token });
  assert.equal(stranger.body.accounts.length, 0);

  const followed = await call("/v1/follows", {
    method: "PUT",
    ip: "203.0.113.48",
    token: bea.token,
    json: { id: "app:" + ada.account.publicId }
  });
  assert.equal(followed.status, 200);
  const visible = await call("/v1/stories", { ip: "203.0.113.49", token: bea.token });
  assert.equal(visible.body.accounts.length, 1);
  assert.equal(visible.body.accounts[0].self, false);
  const storyId = visible.body.accounts[0].items[0].id;

  const seen = await call("/v1/stories/" + storyId + "/seen", { method: "POST", ip: "203.0.113.50", token: bea.token, json: {} });
  assert.equal(seen.status, 200);
  const reacted = await call("/v1/stories/" + storyId + "/react", { method: "POST", ip: "203.0.113.51", token: bea.token, json: { emoji: "🔥" } });
  assert.equal(reacted.status, 200);
  const replied = await call("/v1/stories/" + storyId + "/reply", { method: "POST", ip: "203.0.113.52", token: bea.token, json: { text: "nice" } });
  assert.equal(replied.status, 201);

  const forbidden = await call("/v1/stories/" + storyId + "/views", { ip: "203.0.113.53", token: bea.token });
  assert.equal(forbidden.status, 403);
  const views = await call("/v1/stories/" + storyId + "/views", { ip: "203.0.113.54", token: ada.token });
  assert.equal(views.status, 200);
  assert.equal(views.body.views[0].name, "User B");
  assert.equal(views.body.replies[0].text, "nice");
  assert.equal(JSON.stringify(views.body).includes(ada.account.publicId), false);

  const denied = await call("/v1/stories/" + storyId, { method: "DELETE", ip: "203.0.113.55", token: bea.token });
  assert.equal(denied.status, 403);

  await bindings.DATA.put("stories/telegram/manifest.json", JSON.stringify({
    items: [{ key: "stories/telegram/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", expires: 1 }]
  }));
  await bindings.DATA.put("stories/telegram/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", photo);
  await sweepExpiredStories(bindings, Date.now());
  const gone = await bindings.DATA.get("stories/telegram/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg");
  assert.equal(gone, null);

  const removed = await call("/v1/stories/" + vine.body.id, { method: "DELETE", ip: "203.0.113.56", token: ada.token });
  assert.equal(removed.status, 200);
  const after = await call(mediaPath, { raw: true });
  assert.equal(after.status, 404);

  await bindings.DB.prepare("UPDATE app_stories SET expires_at = ?").bind(1).run();
  await sweepExpiredStories(bindings, Date.now());
  const left = await call("/v1/stories", { ip: "203.0.113.57", token: ada.token });
  assert.equal(left.body.accounts.length, 0);
});
