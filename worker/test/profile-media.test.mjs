import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { defaultVisibility, pickVisible, redactPublicIds, viewerCanSee } from "../../shared/profile-privacy.js";

const owner = { owner: true, viewerId: "000000000001", follows: true, followedBy: true };
const none = { owner: false, viewerId: "", follows: false, followedBy: false };
const stranger = { owner: false, viewerId: "000000000002", follows: false, followedBy: false };
const follower = { owner: false, viewerId: "000000000003", follows: true, followedBy: false };
const mutual = { owner: false, viewerId: "000000000004", follows: true, followedBy: true };

test("visibility matrix matches the photo rules", () => {
  assert.equal(defaultVisibility(false), "everyone");
  assert.equal(defaultVisibility(true), "followers");
  const levels = ["everyone", "followers", "friends", "nobody"];
  const viewers = [
    ["stranger", stranger, { everyone: true, followers: false, friends: false, nobody: false }],
    ["follower", follower, { everyone: true, followers: true, friends: false, nobody: false }],
    ["mutual", mutual, { everyone: true, followers: true, friends: true, nobody: false }],
    ["owner", owner, { everyone: true, followers: true, friends: true, nobody: true }]
  ];
  levels.forEach((level) => {
    viewers.forEach((entry) => {
      assert.equal(viewerCanSee({ visibility: level, allow: [], deny: [] }, entry[1]), entry[2][level], level + " " + entry[0]);
    });
  });
  assert.equal(viewerCanSee({ visibility: "everyone", allow: [], deny: [] }, none), true);
  assert.equal(viewerCanSee({ visibility: "followers", allow: [], deny: [] }, none), false);
  assert.equal(viewerCanSee({ visibility: "nobody", allow: [stranger.viewerId], deny: [] }, stranger), true);
  assert.equal(viewerCanSee({ visibility: "everyone", allow: [stranger.viewerId], deny: [stranger.viewerId] }, stranger), false);
  const items = [
    { id: "a", order: 0, visibility: "nobody", allow: [], deny: [], fallback: false },
    { id: "b", order: 1, visibility: "everyone", allow: [], deny: [], fallback: true }
  ];
  const picked = pickVisible(items, stranger);
  assert.equal(picked.primary.id, "b");
  assert.deepEqual(picked.gallery.map((item) => item.id), ["b"]);
  const redacted = redactPublicIds({ publicId: "123456789012", avatar: "https://example.test/v1/media/avatars/123456789012/ab.webp", handle: "vis_one", note: "123456789012" });
  assert.equal(redacted.publicId, "");
  assert.equal(redacted.avatar, "");
  assert.equal(redacted.handle, "vis_one");
  assert.equal(redacted.note, "123456789012");
});

let mf;
let seq = 0;

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
      OWNER_HANDLE: "vis_owner",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

function tinyWebp(mark) {
  const raw = atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] + mark) & 255;
  return bytes;
}

function dataUrl(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:image/webp;base64," + btoa(bin);
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
  return { status: res.status, body, text, headers: res.headers };
}

async function signup(handle) {
  seq += 1;
  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113." + (40 + (seq % 200)),
    body: { displayName: "Visitor " + seq, handle }
  });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

function leaksId(text, id) {
  return text.indexOf(id) >= 0 || text.indexOf("/v1/media/avatars/" + id + "/") >= 0 || text.indexOf("/v1/media/banners/" + id + "/") >= 0;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("profile photos and banners stay hidden from the wrong viewer", async () => {
  const one = await signup("vis_one");
  const two = await signup("vis_two");
  const three = await signup("vis_three");
  const four = await signup("vis_four");
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.51", token: two.token, body: { id: "app:@" + one.account.handle } });
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.52", token: three.token, body: { id: "app:@" + one.account.handle } });
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.53", token: one.token, body: { id: "app:@" + three.account.handle } });

  const first = await call("/v1/profile/media", {
    method: "POST",
    ip: "203.0.113.54",
    token: one.token,
    body: { kind: "photo", image: dataUrl(tinyWebp(1)) }
  });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.account.photos[0].visibility, "everyone");
  assert.match(first.body.account.avatar, /\/v1\/media\/avatars\/\d{12}\//);
  const photoId = first.body.account.photos[0].id;
  const second = await call("/v1/profile/media", {
    method: "POST",
    ip: "203.0.113.55",
    token: one.token,
    body: { kind: "photo", image: dataUrl(tinyWebp(2)), visibility: "everyone" }
  });
  assert.equal(second.status, 200, second.text);
  const fallbackId = second.body.account.photos[1].id;

  async function seenBy(token, ip) {
    const res = await call("/v1/profile/" + one.account.handle, { ip, token });
    assert.equal(res.status, 200);
    assert.equal(leaksId(res.text, one.account.publicId), false);
    assert.equal(res.body.account.publicId || "", "");
    return res.body.account;
  }

  const open = await seenBy(four.token, "203.0.113.56");
  assert.match(open.avatar, /\/v1\/media\/view\/[a-f0-9]{32}$/);
  assert.equal(open.avatar.includes(one.account.publicId), false);
  const openBytes = await call(new URL(open.avatar).pathname, { ip: "203.0.113.57", token: four.token });
  assert.equal(openBytes.status, 200);
  assert.equal(openBytes.headers.get("cdn-cache-control"), "no-store");
  assert.equal(openBytes.headers.get("cache-control").includes("no-store"), true);

  const levels = {
    everyone: { two: true, three: true, four: true },
    followers: { two: true, three: true, four: false },
    friends: { two: false, three: true, four: false },
    nobody: { two: false, three: false, four: false }
  };
  const viewers = [
    ["two", two, "203.0.113.61"],
    ["three", three, "203.0.113.62"],
    ["four", four, "203.0.113.63"]
  ];
  for (const level of Object.keys(levels)) {
    const updated = await call("/v1/profile/media", {
      method: "PATCH",
      ip: "203.0.113.58",
      token: one.token,
      body: { id: photoId, visibility: level, main: true }
    });
    assert.equal(updated.status, 200, updated.text);
    const hiddenFallback = await call("/v1/profile/media", {
      method: "PATCH",
      ip: "203.0.113.59",
      token: one.token,
      body: { id: fallbackId, visibility: "nobody", fallback: false }
    });
    assert.equal(hiddenFallback.status, 200, hiddenFallback.text);
    for (let i = 0; i < viewers.length; i++) {
      const account = await seenBy(viewers[i][1].token, viewers[i][2]);
      const allowed = levels[level][viewers[i][0]];
      if (allowed) assert.match(account.avatar, /\/v1\/media\/view\//);
      else assert.equal(account.avatar, "");
    }
  }

  await call("/v1/profile/media", {
    method: "PATCH",
    ip: "203.0.113.64",
    token: one.token,
    body: { id: photoId, visibility: "nobody", allow: [four.account.handle], deny: [] }
  });
  const allowed = await seenBy(four.token, "203.0.113.65");
  assert.match(allowed.avatar, /\/v1\/media\/view\//);
  await call("/v1/profile/media", {
    method: "PATCH",
    ip: "203.0.113.66",
    token: one.token,
    body: { id: photoId, visibility: "everyone", allow: [], deny: [two.account.handle] }
  });
  const denied = await seenBy(two.token, "203.0.113.67");
  assert.equal(denied.avatar, "");
  const still = await seenBy(four.token, "203.0.113.68");
  assert.match(still.avatar, /\/v1\/media\/view\//);

  await call("/v1/profile/media", {
    method: "PATCH",
    ip: "203.0.113.69",
    token: one.token,
    body: { id: photoId, visibility: "nobody", allow: [], deny: [] }
  });
  await call("/v1/profile/media", {
    method: "PATCH",
    ip: "203.0.113.70",
    token: one.token,
    body: { id: fallbackId, visibility: "everyone", fallback: true }
  });
  const fallback = await seenBy(four.token, "203.0.113.71");
  assert.equal(fallback.photos.length, 1);
  assert.equal(fallback.photos[0].fallback, true);
  const fallbackBytes = await call(new URL(fallback.avatar).pathname, { ip: "203.0.113.72", token: four.token });
  assert.equal(fallbackBytes.status, 200);
  const hiddenMain = first.body.account.photos[0].url;
  const blockedMain = await call(new URL(hiddenMain).pathname, { ip: "203.0.113.73", token: four.token });
  assert.equal(blockedMain.status, 404);

  const banner = await call("/v1/profile/media", {
    method: "POST",
    ip: "203.0.113.74",
    token: one.token,
    body: { kind: "banner", image: dataUrl(tinyWebp(3)), visibility: "friends" }
  });
  assert.equal(banner.status, 200, banner.text);
  const friendBanner = await seenBy(three.token, "203.0.113.75");
  assert.match(friendBanner.banner, /\/v1\/media\/view\//);
  const strangerBanner = await seenBy(four.token, "203.0.113.76");
  assert.equal(strangerBanner.banner, "");

  const lost = await call("/v1/follows", { method: "DELETE", ip: "203.0.113.77", token: two.token, body: { id: "app:@" + one.account.handle } });
  assert.equal(lost.status, 200);
  await call("/v1/profile/media", {
    method: "PATCH",
    ip: "203.0.113.78",
    token: one.token,
    body: { id: photoId, visibility: "followers", fallback: false }
  });
  await call("/v1/profile/media", {
    method: "PATCH",
    ip: "203.0.113.79",
    token: one.token,
    body: { id: fallbackId, visibility: "nobody", fallback: false }
  });
  const after = await seenBy(two.token, "203.0.113.80");
  assert.equal(after.avatar, "");

  const closed = await signup("vis_closed");
  await call("/v1/profile", { method: "PATCH", ip: "203.0.113.81", token: closed.token, body: { privateFollows: true } });
  const closedPhoto = await call("/v1/profile/media", {
    method: "POST",
    ip: "203.0.113.82",
    token: closed.token,
    body: { kind: "photo", image: dataUrl(tinyWebp(4)) }
  });
  assert.equal(closedPhoto.body.account.photos[0].visibility, "followers");
  const session = await call("/v1/session", { ip: "203.0.113.83", token: one.token });
  assert.match(session.body.account.publicId, /^\d{12}$/);
  const anon = await mf.dispatchFetch("https://accounts.test/v1/profile/" + one.account.handle);
  assert.equal(anon.status, 401);
});
