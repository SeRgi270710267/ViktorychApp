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

function multipart(file) {
  const boundary = "hlbound";
  const chunks = [
    Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + file.name + "\"\r\nContent-Type: " + file.type + "\r\n\r\n"),
    Buffer.from(file.bytes),
    Buffer.from("\r\n--" + boundary + "--\r\n")
  ];
  return { body: Buffer.concat(chunks), type: "multipart/form-data; boundary=" + boundary };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.80");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  if (opts.multipart) headers.set("content-type", opts.multipart.type);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.multipart ? opts.multipart.body : (opts.json ? JSON.stringify(opts.json) : undefined)
  });
  if (opts.raw) return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, headers: res.headers, body };
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

function photoBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("highlights keep original bytes, a custom title, and the audience", async () => {
  const ada = await signup("user_a", "203.0.113.81");
  const bea = await signup("user_b", "203.0.113.82");
  const cam = await signup("user_c", "203.0.113.83");
  const photo = photoBytes();
  const uploaded = await call("/v1/highlights/upload", {
    method: "POST",
    ip: "203.0.113.84",
    token: ada.token,
    multipart: multipart({ name: "photo.jpg", type: "image/jpeg", bytes: photo })
  });
  assert.equal(uploaded.status, 201);
  const title = "✨ " + "n".repeat(800);
  const created = await call("/v1/highlights", {
    method: "POST",
    ip: "203.0.113.85",
    token: ada.token,
    json: {
      title: title,
      audience: "public",
      cover: 0,
      crop: { x: 1000, y: 500, w: 4000, h: 4000 },
      items: [{ source: "upload", id: uploaded.body.id }]
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, title);

  const open = await call("/v1/highlights/" + created.body.id, { ip: "203.0.113.86", token: cam.token });
  assert.equal(open.status, 200);
  assert.equal(open.body.title, title);
  assert.equal(open.body.audience, undefined);
  assert.equal(JSON.stringify(open.body).includes(ada.account.publicId), false);
  const mediaPath = new URL(open.body.items[0].url).pathname;
  const media = await call(mediaPath, { raw: true });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("cache-control"), "private, no-store");
  assert.equal(media.headers.get("cdn-cache-control"), "no-store");
  assert.deepEqual(media.bytes, photo);

  const row = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.87" });
  assert.equal(row.body.highlights.length, 1);
  assert.equal(row.body.highlights[0].title, title);

  await call("/v1/highlights/" + created.body.id, {
    method: "PUT",
    ip: "203.0.113.88",
    token: ada.token,
    json: { audience: "followers" }
  });
  const hidden = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.89", token: cam.token });
  assert.equal(hidden.body.highlights.length, 0);
  assert.equal(JSON.stringify(hidden.body).includes(title), false);
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.90", token: bea.token, json: { id: "app:" + ada.account.publicId } });
  const follower = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.91", token: bea.token });
  assert.equal(follower.body.highlights[0].title, title);

  await call("/v1/highlights/" + created.body.id, {
    method: "PUT",
    ip: "203.0.113.92",
    token: ada.token,
    json: { audience: "friends" }
  });
  const notMutual = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.93", token: bea.token });
  assert.equal(notMutual.body.highlights.length, 0);
  await bindings.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)").bind(bea.account.publicId, ada.account.publicId, Date.now()).run();
  const mutual = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.94", token: bea.token });
  assert.equal(mutual.body.highlights.length, 1);

  await call("/v1/highlights/" + created.body.id, {
    method: "PUT",
    ip: "203.0.113.95",
    token: ada.token,
    json: { audience: "only" }
  });
  const alone = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.96", token: bea.token });
  assert.equal(alone.body.highlights.length, 0);
  const denied = await call("/v1/highlights/" + created.body.id, { method: "DELETE", ip: "203.0.113.97", token: bea.token });
  assert.equal(denied.status, 404);

  const second = await call("/v1/highlights", {
    method: "POST",
    ip: "203.0.113.98",
    token: ada.token,
    json: { title: "second", audience: "public", items: [{ source: "upload", id: uploaded.body.id }] }
  });
  assert.equal(second.status, 201);
  const order = await call("/v1/highlights/order", {
    method: "PUT",
    ip: "203.0.113.99",
    token: ada.token,
    json: { ids: [second.body.id, created.body.id] }
  });
  assert.equal(order.status, 200);
  const mine = await call("/v1/highlights?handle=user_a", { ip: "203.0.113.100", token: ada.token });
  assert.equal(mine.body.highlights[0].id, second.body.id);
  assert.equal(mine.body.mine, true);

  const story = await call("/v1/stories", {
    method: "POST",
    ip: "203.0.113.101",
    token: ada.token,
    multipart: multipart({ name: "story.jpg", type: "image/jpeg", bytes: photo })
  });
  assert.equal(story.status, 201);
  await bindings.DB.prepare("UPDATE app_stories SET expires_at = ?").bind(1).run();
  await sweepExpiredStories(bindings, Date.now());
  const sources = await call("/v1/highlights/sources", { ip: "203.0.113.102", token: ada.token });
  assert.equal(sources.body.items.some((item) => item.source === "library" && item.expired), true, JSON.stringify(sources.body));
  const library = sources.body.items.find((item) => item.source === "library");
  const fromOld = await call("/v1/highlights", {
    method: "POST",
    ip: "203.0.113.103",
    token: ada.token,
    json: { title: "kept", audience: "public", items: [{ source: "library", id: library.id }] }
  });
  assert.equal(fromOld.status, 201);
  const kept = await call("/v1/highlights/" + fromOld.body.id, { ip: "203.0.113.104" });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  const keptMedia = await call(new URL(kept.body.items[0].url).pathname, { raw: true });
  assert.deepEqual(keptMedia.bytes, photo);
});
