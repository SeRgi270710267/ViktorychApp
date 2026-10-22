import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { cleanHistoryList } from "../../shared/history-sync.js";

const OWNER = "S\u0435\u0420g\u0418";
const LOOKALIKE = "SePg\u0418";

let mf;
let bindings;

function workerOptions(extra) {
  return {
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("../..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }, extra || {})
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.origin) headers.set("Origin", opts.origin);
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

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("health, signup, login, session, and sync", async () => {
  const health = await call("/v1/health", { ip: "203.0.113.1" });
  assert.equal(health.status, 200);
  assert.equal(health.body.ready, true);
  assert.equal(health.body.data, true);

  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.20",
    body: { displayName: "Ada Lovelace", handle: "ada_l" }
  });
  assert.equal(created.status, 201);
  assert.match(created.body.accountNumber, /^\d{16}$/);
  assert.match(created.body.account.publicId, /^\d{12}$/);
  assert.equal(created.body.account.handle, "ada_l");
  assert.equal(created.body.account.owner, false);
  assert.equal(created.body.account.accountNumber, undefined);

  const rows = await bindings.DB.prepare("SELECT number_lookup, number_hash, salt, handle FROM accounts").all();
  for (const row of rows.results) {
    assert.notEqual(row.number_lookup, created.body.accountNumber);
    assert.equal(String(row.number_hash).includes(created.body.accountNumber), false);
    assert.equal(String(row.salt).includes(created.body.accountNumber), false);
  }

  const bad = await call("/v1/login", {
    method: "POST",
    ip: "203.0.113.21",
    body: { accountNumber: "0000000000000000" }
  });
  assert.equal(bad.status, 401);

  const good = await call("/v1/login", {
    method: "POST",
    ip: "203.0.113.22",
    body: { accountNumber: created.body.accountNumber }
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.account.publicId, created.body.account.publicId);

  const session = await call("/v1/session", { ip: "203.0.113.23", token: good.body.token });
  assert.equal(session.status, 200);
  assert.equal(session.body.account.handle, "ada_l");

  const saved = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.24",
    token: good.body.token,
    body: { payload: { follows: ["x:ada"], bookmarks: { a: 1 } }, baseUpdatedAt: 0 }
  });
  assert.equal(saved.status, 200);
  const loaded = await call("/v1/sync", { ip: "203.0.113.25", token: good.body.token });
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body.payload.follows, ["x:ada"]);

  const clash = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.26",
    token: good.body.token,
    body: { payload: { follows: ["x:other"] }, baseUpdatedAt: 1 }
  });
  assert.equal(clash.status, 409);

  const gone = await call("/v1/logout", { method: "POST", ip: "203.0.113.27", token: good.body.token });
  assert.equal(gone.status, 200);
  const after = await call("/v1/session", { ip: "203.0.113.28", token: good.body.token });
  assert.equal(after.status, 401);
});

test("skeletons, owner claim, and rate limit", async () => {
  const first = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.40",
    body: { displayName: "Hello", handle: "hello" }
  });
  assert.equal(first.status, 201);
  const twin = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.41",
    body: { displayName: "Hello", handle: "\u041Dello" }
  });
  assert.equal(twin.status, 409);
  assert.equal(twin.body.error, "handle_taken");

  const look = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.42",
    body: { displayName: "Owner", handle: LOOKALIKE, claimCode: "claim-test" }
  });
  assert.equal(look.status, 409);
  assert.equal(look.body.error, "handle_reserved");

  const missing = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.43",
    body: { displayName: "Owner", handle: OWNER }
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error, "claim_required");

  const claimed = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.44",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.account.owner, true);
  assert.equal(claimed.body.account.handle, OWNER);

  const again = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.45",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(again.status, 409);

  const evil = await call("/v1/health", { ip: "203.0.113.46", origin: "https://evil.example" });
  assert.equal(evil.status, 403);

  for (let i = 0; i < 4; i++) {
    const ok = await call("/v1/signup", {
      method: "POST",
      ip: "203.0.113.60",
      body: { displayName: "Rate " + i, handle: "rate" + i }
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  }
  const limited = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.60",
    body: { displayName: "Rate 4", handle: "rate4" }
  });
  assert.equal(limited.status, 429);
});

test("feed data requires a session and hides owner-only posts", async () => {
  const doc = {
    posts: [
      { id: "1", platform: "x", text: "public-post" },
      { id: "2", platform: "tiktok", text: "secret-tiktok" },
      { id: "3", platform: "youtube", url: "https://www.youtube.com/shorts/abc", text: "secret-short" },
      { id: "4", platform: "youtube", ownerOnly: true, text: "secret-flag" }
    ],
    feeds: [{ id: "tiktok:hidden", platform: "tiktok", handle: "hidden" }]
  };
  await bindings.DATA.put("feeds.json", JSON.stringify(doc));
  const closed = await call("/v1/data/feeds.json", { ip: "203.0.113.70" });
  assert.equal(closed.status, 401);

  const user = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.71",
    body: { displayName: "Reader", handle: "reader1" }
  });
  assert.equal(user.status, 201);
  const seen = await call("/v1/data/feeds.json", { ip: "203.0.113.72", token: user.body.token });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.posts.map((post) => post.id), ["1"]);
  assert.equal(JSON.stringify(seen.body).includes("secret-tiktok"), false);
  assert.equal(JSON.stringify(seen.body).includes("secret-short"), false);
  assert.equal(seen.body.feeds.length, 0);

  const owner = await call("/v1/login", {
    method: "POST",
    ip: "203.0.113.73",
    body: { accountNumber: (await call("/v1/signup", { method: "POST", ip: "203.0.113.74", body: { displayName: "nope", handle: "nope" } })).body && "" }
  });
  assert.equal(owner.status, 401);

  const owners = await bindings.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").all();
  assert.equal(owners.results.length, 1);
  const tokenRow = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.75",
    body: { displayName: "Nobody", handle: "nobody2" }
  });
  assert.notEqual(tokenRow.body.account.owner, true);
});

test("the owner session receives owner-only posts", async () => {
  const listed = await bindings.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
  assert.ok(listed);
  const session = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.80",
    body: { displayName: "Temp", handle: "temp80" }
  });
  assert.equal(session.status, 201);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.body.token));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await bindings.DB.prepare("UPDATE sessions SET public_id = ? WHERE token_hash = ?").bind(listed.public_id, hex).run();
  const full = await call("/v1/data/feeds.json", { ip: "203.0.113.81", token: session.body.token });
  assert.equal(full.status, 200);
  assert.equal(full.body.posts.length, 4);
  assert.equal(full.body.posts.some((post) => post.platform === "tiktok"), true);
});

test("a worker without a pepper is not ready", async () => {
  const bare = new Miniflare(workerOptions({ ACCOUNT_PEPPER: "" }));
  try {
    const res = await bare.dispatchFetch("https://accounts.test/v1/health");
    const body = await res.json();
    assert.equal(body.ready, false);
    const signup = await bare.dispatchFetch("https://accounts.test/v1/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.90" },
      body: JSON.stringify({ displayName: "Ada", handle: "ada2" })
    });
    assert.equal(signup.status, 503);
  } finally {
    await bare.dispose();
  }
});

test("owner tiktok data requires the owner session", async () => {
  await bindings.DATA.put("owner/tiktok.json", JSON.stringify({ posts: [{ id: "tiktok:1", text: "secret-clip" }], live: {} }));
  const anon = await call("/v1/owner/tiktok", { ip: "203.0.113.91" });
  assert.equal(anon.status, 401);
  const reader = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.92",
    body: { displayName: "Bea", handle: "bea_t" }
  });
  assert.equal(reader.status, 201);
  const hidden = await call("/v1/owner/tiktok", { ip: "203.0.113.93", token: reader.body.token });
  assert.equal(hidden.status, 403);
  const liveHidden = await call("/v1/owner/live/gabii_g5", { ip: "203.0.113.94", token: reader.body.token });
  assert.equal(liveHidden.status, 403);
  const mediaAnon = await call("/v1/owner/media?url=https://v16.tiktokcdn.com/a.m3u8", { ip: "203.0.113.95" });
  assert.equal(mediaAnon.status, 401);

  const minted = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.96",
    body: { displayName: "Owner session", handle: "own96" }
  });
  assert.equal(minted.status, 201);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(minted.body.token));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const listed = await bindings.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
  await bindings.DB.prepare("UPDATE sessions SET public_id = ? WHERE token_hash = ?").bind(listed.public_id, hex).run();
  const seen = await call("/v1/owner/tiktok", { ip: "203.0.113.97", token: minted.body.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.posts[0].text, "secret-clip");
  const bad = await call("/v1/owner/media?url=https://example.com/a.m3u8", { ip: "203.0.113.98", token: minted.body.token });
  assert.equal(bad.status, 400);
  const userinfo = await call("/v1/owner/media?url=https://user:pass@v16.tiktokcdn.com/a.m3u8", { ip: "203.0.113.99", token: minted.body.token });
  assert.equal(userinfo.status, 400);
});

test("profile location and website round-trip and reject over-long values", async () => {
  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.120",
    body: { displayName: "Cara", handle: "cara_l" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.account.location, "");
  assert.equal(created.body.account.website, "");
  const saved = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.121",
    token: created.body.token,
    body: { location: "Madrid", website: "example.com" }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.account.location, "Madrid");
  assert.equal(saved.body.account.website, "example.com");
  const seen = await call("/v1/profile/" + encodeURIComponent("cara_l"), { ip: "203.0.113.122", token: created.body.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.account.location, "Madrid");
  const longPlace = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.123",
    token: created.body.token,
    body: { location: "x".repeat(31) }
  });
  assert.equal(longPlace.status, 400);
  assert.equal(longPlace.body.error, "invalid_location");
  const script = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.124",
    token: created.body.token,
    body: { website: "javascript:alert(1)" }
  });
  assert.equal(script.status, 400);
  assert.equal(script.body.error, "invalid_website");
});

test("tiktok play requires the owner and a real video id", async () => {
  const anon = await call("/v1/owner/play?id=7695476356548660503&handle=gabii_g5", { ip: "203.0.113.130" });
  assert.equal(anon.status, 401);
  const reader = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.131",
    body: { displayName: "Dee", handle: "dee_t" }
  });
  assert.equal(reader.status, 201);
  const hidden = await call("/v1/owner/play?id=7695476356548660503&handle=gabii_g5", { ip: "203.0.113.132", token: reader.body.token });
  assert.equal(hidden.status, 403);
  const minted = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.133",
    body: { displayName: "Owner play", handle: "ownplay" }
  });
  assert.equal(minted.status, 201);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(minted.body.token));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const listed = await bindings.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
  await bindings.DB.prepare("UPDATE sessions SET public_id = ? WHERE token_hash = ?").bind(listed.public_id, hex).run();
  const bad = await call("/v1/owner/play?id=nope&handle=gabii_g5", { ip: "203.0.113.134", token: minted.body.token });
  assert.equal(bad.status, 400);
});

test("audience all keeps tiktok posts and still hides youtube shorts", async () => {
  const open = new Miniflare(workerOptions({ TIKTOK_AUDIENCE: "all" }));
  try {
    const data = await open.getBindings();
    await data.DATA.put("feeds.json", JSON.stringify({
      posts: [
        { id: "1", platform: "x", text: "public" },
        { id: "2", platform: "tiktok", text: "clip" },
        { id: "3", platform: "youtube", url: "https://www.youtube.com/shorts/abc", text: "short" }
      ]
    }));
    const created = await open.dispatchFetch("https://accounts.test/v1/signup", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.110" },
      body: JSON.stringify({ displayName: "All", handle: "all_u" })
    });
    const body = await created.json();
    assert.equal(created.status, 201);
    const res = await open.dispatchFetch("https://accounts.test/v1/data/feeds.json", {
      headers: { Authorization: "Bearer " + body.token, "CF-Connecting-IP": "203.0.113.111" }
    });
    const seen = await res.json();
    assert.deepEqual(seen.posts.map((post) => post.id), ["1", "2"]);
  } finally {
    await open.dispose();
  }
});

function dataUrl(bytes, type) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "data:" + type + ";base64," + btoa(bin);
}

function tinyWebp() {
  const raw = atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

test("profile photos go to R2 and a data URL already in D1 is moved", async () => {
  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.150",
    body: { displayName: "Photo", handle: "photo_p" }
  });
  assert.equal(created.status, 201);
  const id = created.body.account.publicId;
  const token = created.body.token;
  const first = tinyWebp();
  assert.equal(String.fromCharCode(first[0], first[1], first[2], first[3]), "RIFF");
  const saved = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.151",
    token,
    body: { avatar: dataUrl(first, "image/webp") }
  });
  assert.equal(saved.status, 200);
  assert.match(saved.body.account.avatar, /\/v1\/media\/avatars\/\d{12}\/[a-f0-9]{64}\.webp$/);
  assert.equal(saved.body.account.avatar.includes("data:"), false);
  const row = await bindings.DB.prepare("SELECT avatar, banner FROM accounts WHERE public_id = ?").bind(id).first();
  assert.match(row.avatar, /^media\/avatars\//);
  assert.equal(row.avatar.includes("data:"), false);
  assert.ok(await bindings.DATA.get(row.avatar));
  const anon = await mf.dispatchFetch(saved.body.account.avatar);
  assert.equal(anon.status, 401);
  const image = await mf.dispatchFetch(saved.body.account.avatar, {
    headers: { Authorization: "Bearer " + token, "CF-Connecting-IP": "203.0.113.152" }
  });
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal(image.headers.get("cdn-cache-control"), "no-store");
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "RIFF");
  const second = first.slice();
  second[second.length - 1] = second[second.length - 1] ^ 1;
  const replaced = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.153",
    token,
    body: { avatar: dataUrl(second, "image/webp") }
  });
  assert.equal(replaced.status, 200);
  const next = await bindings.DB.prepare("SELECT avatar FROM accounts WHERE public_id = ?").bind(id).first();
  assert.notEqual(next.avatar, row.avatar);
  assert.equal(await bindings.DATA.get(row.avatar), null);
  const jpeg = new Uint8Array(32);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  jpeg[31] = 0xd9;
  const rejected = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.154",
    token,
    body: { avatar: dataUrl(jpeg, "image/jpeg") }
  });
  assert.equal(rejected.status, 413);
  const legacy = "data:image/jpeg;base64," + btoa(String.fromCharCode(...jpeg));
  await bindings.DB.prepare("UPDATE accounts SET banner = ? WHERE public_id = ?").bind(legacy, id).run();
  const seen = await call("/v1/session", { ip: "203.0.113.155", token });
  assert.equal(seen.status, 200);
  assert.match(seen.body.account.banner, /\/v1\/media\/banners\/\d{12}\/[a-f0-9]{64}\.jpg$/);
  const moved = await bindings.DB.prepare("SELECT banner FROM accounts WHERE public_id = ?").bind(id).first();
  assert.match(moved.banner, /^media\/banners\//);
  assert.equal(moved.banner.includes("data:"), false);
  assert.ok(await bindings.DATA.get(moved.banner));
  const cleared = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.156",
    token,
    body: { avatar: "" }
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.account.avatar, "");
  const empty = await bindings.DB.prepare("SELECT avatar FROM accounts WHERE public_id = ?").bind(id).first();
  assert.equal(empty.avatar, "");
  assert.equal(await bindings.DATA.get(next.avatar), null);
});

test("a hidden avatar is not returned and an empty banner can take no space", async () => {
  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.170",
    body: { displayName: "Face", handle: "face_f" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.account.avatar, "");
  assert.equal(created.body.account.avatarFace, "default");
  assert.equal(created.body.account.bannerFace, "default");
  const token = created.body.token;
  const saved = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.171",
    token,
    body: { avatar: dataUrl(tinyWebp(), "image/webp"), bannerEmpty: "none", avatarEmpty: "none" }
  });
  assert.equal(saved.status, 200);
  assert.match(saved.body.account.avatar, /\/v1\/media\/avatars\//);
  assert.equal(saved.body.account.bannerFace, "none");
  assert.equal(saved.body.account.avatarEmpty, "none");
  const hidden = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.172",
    token,
    body: { hideAvatar: "none" }
  });
  assert.equal(hidden.status, 200);
  assert.match(hidden.body.account.avatar, /\/v1\/media\/avatars\//);
  assert.equal(hidden.body.account.avatarFace, "none");
  const other = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.173",
    body: { displayName: "Other", handle: "other_o" }
  });
  const seen = await call("/v1/profile/face_f", { ip: "203.0.113.174", token: other.body.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.account.avatar, "");
  assert.equal(seen.body.account.avatarFace, "none");
  assert.equal(seen.body.account.bannerFace, "none");
  const key = new URL(hidden.body.account.avatar).pathname;
  const blocked = await call(key, { ip: "203.0.113.175", token: other.body.token });
  assert.equal(blocked.status, 404);
  const mine = await call(key, { ip: "203.0.113.176", token });
  assert.equal(mine.status, 200);
  const cleared = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.177",
    token,
    body: { avatar: "", hideAvatar: "" }
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.account.avatar, "");
  assert.equal(cleared.body.account.avatarFace, "none");
});

test("sync history keeps the newest 300 and a clear", async () => {
  const created = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.160",
    body: { displayName: "Hist", handle: "hist_h" }
  });
  assert.equal(created.status, 201);
  const items = [];
  for (let i = 0; i < 301; i++) items.push({ id: "v" + i, kind: "video", platform: "youtube", at: 1000 + i, progress: 0.25, post: { text: "x".repeat(40) } });
  items.push({ id: "v0", kind: "video", platform: "youtube", at: 9000, progress: 0.8, post: { text: "stale" } });
  items.push({ id: "essay", kind: "article", platform: "rss", at: 8000, progress: 0.4 });
  const saved = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.161",
    token: created.body.token,
    body: { payload: { follows: ["x:hist"], history: items, historyCut: { video: 0, article: 0 } }, baseUpdatedAt: 0 }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.payload.history.length, 300);
  assert.equal(saved.body.payload.history[0].id, "v0");
  assert.equal(saved.body.payload.history[0].progress, 0.8);
  assert.equal(saved.body.payload.history[0].post, undefined);
  assert.equal(saved.body.payload.history.some((row) => row.id === "essay"), true);
  assert.equal(saved.body.payload.history.some((row) => row.id === "v1"), false);
  const kept = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.162",
    token: created.body.token,
    body: { payload: { follows: ["x:hist"] }, baseUpdatedAt: 0 }
  });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.payload.history.length, 300);
  const cleared = await call("/v1/sync", {
    method: "PUT",
    ip: "203.0.113.163",
    token: created.body.token,
    body: { payload: { follows: ["x:hist"], history: items, historyCut: { video: 9000, article: 0 } }, baseUpdatedAt: 0 }
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.payload.history.some((row) => row.kind === "video"), false);
  assert.equal(cleared.body.payload.history.some((row) => row.id === "essay"), true);
  assert.equal(cleared.body.payload.historyCut.video, 9000);
  const merged = cleanHistoryList([
    { id: "a", kind: "video", platform: "youtube", at: 10, progress: 0.2 },
    { id: "a", kind: "video", platform: "youtube", at: 30, progress: 0.6 }
  ], { video: 0, article: 0 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].at, 30);
  assert.equal(merged[0].progress, 0.6);
});

test("archive copies are public and account objects stay hidden", async () => {
  const name = "ab".repeat(32) + ".jpg";
  await bindings.DATA.put("archive/" + name, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    httpMetadata: { contentType: "image/jpeg" }
  });
  await bindings.DATA.put("owner/tiktok.json", "{}");
  const ok = await mf.dispatchFetch("https://accounts.test/v1/archive/" + name, {
    headers: { Origin: "https://viktorychgroup.github.io" }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://viktorychgroup.github.io");
  assert.equal(new Uint8Array(await ok.arrayBuffer())[0], 0xff);
  const missing = await mf.dispatchFetch("https://accounts.test/v1/archive/" + "cd".repeat(32) + ".jpg");
  assert.equal(missing.status, 404);
  const hidden = await mf.dispatchFetch("https://accounts.test/v1/archive/owner/tiktok.json");
  assert.equal(hidden.status, 404);
});

test("reposts and quotes stay on the account and show on that profile", async () => {
  const ada = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.180",
    body: { displayName: "Ada Lovelace", handle: "ada_rp" }
  });
  assert.equal(ada.status, 201);
  const bea = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.181",
    body: { displayName: "Bea", handle: "bea_rp" }
  });
  assert.equal(bea.status, 201);
  const feed = {
    id: "yt1",
    statusId: "yt1",
    platform: "youtube",
    handle: "addedchannel",
    author: "Added Channel",
    text: "a video from an added account",
    url: "https://www.youtube.com/watch?v=yt1",
    date: "2026-10-22T12:00:00.000Z",
    stats: { reposts: 4 }
  };
  const denied = await call("/v1/reposts", { method: "PUT", ip: "203.0.113.182", body: { kind: "repost", post: feed } });
  assert.equal(denied.status, 401);

  const saved = await call("/v1/reposts", {
    method: "PUT",
    ip: "203.0.113.183",
    token: ada.body.token,
    body: { kind: "repost", post: feed }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.repost.postKey, "r:youtube:yt1");
  assert.equal(saved.body.repost.kind, "repost");

  const quoteKey = "q:x:99:" + Date.now();
  const quoted = await call("/v1/reposts", {
    method: "PUT",
    ip: "203.0.113.184",
    token: ada.body.token,
    body: {
      kind: "quote",
      postKey: quoteKey,
      comment: "a take on an added account",
      post: { id: "99", statusId: "99", platform: "x", handle: "addedx", author: "Added X", text: "original post", url: "https://x.com/addedx/status/99" }
    }
  });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));

  const seen = await call("/v1/profile/" + encodeURIComponent("ada_rp"), { ip: "203.0.113.185", token: bea.body.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.account.displayName, "Ada Lovelace");
  const keys = seen.body.reposts.map((row) => row.postKey);
  assert.ok(keys.includes("r:youtube:yt1"));
  assert.ok(keys.includes(quoteKey));
  assert.equal(seen.body.reposts[0].createdAt >= seen.body.reposts[1].createdAt, true);

  const quoteRow = seen.body.reposts.find((row) => row.kind === "quote");
  const repostOfQuote = await call("/v1/reposts", {
    method: "PUT",
    ip: "203.0.113.186",
    token: bea.body.token,
    body: {
      kind: "repost",
      post: {
        id: quoteRow.postKey,
        statusId: quoteRow.postKey,
        platform: "app",
        handle: "ada_rp",
        author: "Ada Lovelace",
        text: quoteRow.comment,
        kind: "quote",
        quoted: quoteRow.post
      }
    }
  });
  assert.equal(repostOfQuote.status, 200, JSON.stringify(repostOfQuote.body));
  const beaProfile = await call("/v1/profile/bea_rp", { ip: "203.0.113.187", token: ada.body.token });
  assert.equal(beaProfile.body.reposts.length, 1);
  assert.equal(beaProfile.body.reposts[0].kind, "repost");
  assert.equal(beaProfile.body.reposts[0].post.platform, "app");
  assert.equal(beaProfile.body.reposts[0].post.text, "a take on an added account");
  assert.equal(beaProfile.body.reposts[0].post.quoted.text, "original post");

  const undone = await call("/v1/reposts", {
    method: "DELETE",
    ip: "203.0.113.188",
    token: ada.body.token,
    body: { postKey: "r:youtube:yt1" }
  });
  assert.equal(undone.status, 200);
  const after = await call("/v1/profile/ada_rp", { ip: "203.0.113.189", token: bea.body.token });
  assert.equal(after.body.reposts.some((row) => row.postKey === "r:youtube:yt1"), false);
  assert.equal(after.body.reposts.some((row) => row.kind === "quote"), true);

  const platforms = ["x", "threads", "instagram", "rss", "vk", "discord", "telegram", "tiktok"];
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const put = await call("/v1/reposts", {
      method: "PUT",
      ip: "203.0.113.190",
      token: bea.body.token,
      body: { kind: "repost", post: { id: "p" + i, statusId: "p" + i, platform: platform, handle: "added", author: "Added", text: platform } }
    });
    assert.equal(put.status, 200, platform + " " + JSON.stringify(put.body));
  }
  const all = await call("/v1/profile/bea_rp", { ip: "203.0.113.191", token: ada.body.token });
  platforms.forEach((platform) => {
    assert.equal(all.body.reposts.some((row) => row.post && row.post.platform === platform), true, platform);
  });
});
