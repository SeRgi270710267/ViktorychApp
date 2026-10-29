import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { tempExpiry, tempBlockedPointsRoute, TEMP_CHOICES } from "../src/temp-accounts.js";

const ORIGIN = "https://viktorychgroup.github.io";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let mf;
let bindings;
let ipSeq = 10;

function nextIp() {
  ipSeq += 1;
  return "198.51.100." + ipSeq;
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || nextIp());
  if (opts.origin) headers.set("Origin", opts.origin);
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}

async function signup(handle, name, claimCode) {
  const body = { displayName: name, handle };
  if (claimCode) body.claimCode = claimCode;
  const created = await call("/v1/signup", { method: "POST", body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

async function tempSignup(extra, ip) {
  return call("/v1/signup", { method: "POST", ip, body: Object.assign({ temporary: true, expiresIn: "1d" }, extra || {}) });
}

const sql = (s, ...a) => bindings.DB.prepare(s).bind(...a).run();
const one = (s, ...a) => bindings.DB.prepare(s).bind(...a).first();

async function cron(at) {
  const res = await mf.dispatchFetch("https://accounts.test/cdn-cgi/handler/scheduled?cron=" + encodeURIComponent("* * * * *") + "&time=" + (at || Date.now()));
  assert.equal(res.status, 200, await res.text());
}

async function objectKeys(prefix) {
  const listed = await bindings.DATA.list({ prefix });
  return ((listed && listed.objects) || []).map((item) => item.key);
}

test.before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    unsafeTriggerHandlers: true,
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  });
  bindings = await mf.getBindings();
});

test.after(async () => { if (mf) await mf.dispose(); });

test("delete time choices and custom dates are bounded", () => {
  const now = 1_000_000_000_000;
  assert.deepEqual(Object.keys(TEMP_CHOICES), ["1h", "1d", "7d", "30d"]);
  assert.equal(tempExpiry({ expiresIn: "1h" }, now), now + HOUR);
  assert.equal(tempExpiry({ expiresIn: "30d" }, now), now + 30 * DAY);
  assert.equal(tempExpiry({ expiresIn: "2y" }, now), 0);
  assert.equal(tempExpiry({ expiresAt: now + 2 * DAY }, now), now + 2 * DAY);
  assert.equal(tempExpiry({ expiresAt: new Date(now + 3 * DAY).toISOString() }, now), now + 3 * DAY);
  assert.equal(tempExpiry({ expiresAt: now + 60 * 1000 }, now), 0, "too soon");
  assert.equal(tempExpiry({ expiresAt: now + 91 * DAY }, now), 0, "too far");
  assert.equal(tempExpiry({}, now), 0);
  assert.equal(tempBlockedPointsRoute("POST", "/v1/gifts/send"), true);
  assert.equal(tempBlockedPointsRoute("GET", "/v1/gifts/send"), false);
  assert.equal(tempBlockedPointsRoute("POST", "/v1/points/touch"), false);
});

test("one tap makes a temporary account with no handle or password", async () => {
  const before = Date.now();
  const res = await tempSignup({ displayName: "" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.account.handle, /^tmp_\d{8}$/);
  assert.equal(res.body.account.displayName, "Guest");
  assert.match(res.body.accountNumber, /^\d{16}$/);
  assert.deepEqual(res.body.recoveryCodes, []);
  const until = res.body.account.temporary.expiresAt;
  assert.ok(until >= before + DAY - 5000 && until <= Date.now() + DAY + 5000);
  const status = await call("/v1/account/temporary", { token: res.body.token });
  assert.equal(status.body.temporary, true);
  assert.equal(status.body.expiresAt, until);
  const session = await call("/v1/session", { token: res.body.token });
  assert.equal(session.body.account.temporary.expiresAt, until);
  const bad = await tempSignup({ expiresIn: "forever" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "bad_expiry");
});

test("three temporary accounts a day per address and per device", async () => {
  const ip = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await tempSignup({}, ip)).status, 201);
  assert.equal((await tempSignup({}, ip)).status, 429);
  const device = "dev_" + "a".repeat(30);
  for (let i = 0; i < 3; i++) assert.equal((await tempSignup({ deviceKey: device })).status, 201);
  assert.equal((await tempSignup({ deviceKey: device })).status, 429, "a new address does not reset the device limit");
});

test("the cron deletes a due temporary account everywhere and never the owner or a normal account", async () => {
  const owner = await signup("mirathorn", "Owner", "claim-test");
  const normal = await signup("plain_user", "Plain");
  const temp = (await tempSignup({ expiresIn: "1h" })).body;
  const later = (await tempSignup({ expiresIn: "7d" })).body;
  const o = owner.account.publicId;
  const n = normal.account.publicId;
  const t = temp.account.publicId;
  const now = Date.now();
  // Posts with media, DMs both ways, gifts, settings and stored files.
  await sql("INSERT INTO public_posts (id, author_id, body, created_at) VALUES ('tp1', ?, 'temp post', ?)", t, now);
  await sql("INSERT INTO public_post_media (id, post_id, object_key, mime, size) VALUES ('tm1', 'tp1', 'post-media/tm1.webp', 'image/webp', 4)");
  await bindings.DATA.put("post-media/tm1.webp", "img!");
  await sql("INSERT INTO public_posts (id, author_id, body, created_at) VALUES ('np1', ?, 'normal post', ?)", n, now);
  await sql("INSERT INTO public_post_media (id, post_id, object_key, mime, size) VALUES ('nm1', 'np1', 'post-media/nm1.webp', 'image/webp', 4)");
  await bindings.DATA.put("post-media/nm1.webp", "img!");
  await sql("INSERT INTO account_messages (id, sender_id, recipient_id, body, created_at, deleted_at) VALUES ('dm1', ?, ?, 'hi', ?, 0)", t, n, now);
  await sql("INSERT INTO account_messages (id, sender_id, recipient_id, body, created_at, deleted_at) VALUES ('dm2', ?, ?, 'yo', ?, 0)", n, t, now);
  await sql("INSERT INTO account_messages (id, sender_id, recipient_id, body, created_at, deleted_at) VALUES ('dm3', ?, ?, 'keep', ?, 0)", n, o, now);
  await sql("INSERT INTO gift_sends (id, gift_id, sender_id, recipient_id, cost, created_at) VALUES ('g1', 'x', ?, ?, 0, ?)", n, t, now);
  await sql("INSERT INTO sync_state (public_id, payload, updated_at) VALUES (?, '{}', ?)", t, now);
  await bindings.DATA.put("media/avatars/" + t + "/a.webp", "x");
  await bindings.DATA.put("media/avatars/" + n + "/a.webp", "x");
  // Force everything due, including rows that must never be swept.
  await sql("UPDATE account_temp SET expires_at = ? WHERE public_id = ?", now - 1000, t);
  await sql("INSERT INTO account_temp (public_id, expires_at, created_at) VALUES (?, ?, ?)", o, now - 1000, now);

  await cron(now + 1000);

  assert.equal(await one("SELECT public_id FROM accounts WHERE public_id = ?", t), null);
  assert.equal(await one("SELECT id FROM public_posts WHERE author_id = ?", t), null);
  assert.equal(await one("SELECT id FROM public_post_media WHERE id = 'tm1'"), null);
  assert.equal(await one("SELECT id FROM account_messages WHERE sender_id = ? OR recipient_id = ?", t, t), null);
  assert.equal(await one("SELECT id FROM gift_sends WHERE recipient_id = ?", t), null);
  assert.equal(await one("SELECT public_id FROM sync_state WHERE public_id = ?", t), null);
  assert.equal(await one("SELECT public_id FROM sessions WHERE public_id = ?", t), null);
  assert.equal(await one("SELECT public_id FROM account_temp WHERE public_id = ?", t), null);
  assert.deepEqual(await objectKeys("post-media/tm1"), []);
  assert.deepEqual(await objectKeys("media/avatars/" + t + "/"), []);
  assert.equal((await call("/v1/session", { token: temp.token })).status, 401);

  // The owner and the normal account are untouched.
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", o));
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", n));
  assert.ok(await one("SELECT id FROM public_posts WHERE id = 'np1'"));
  assert.ok(await one("SELECT id FROM public_post_media WHERE id = 'nm1'"));
  assert.deepEqual(await objectKeys("post-media/nm1"), ["post-media/nm1.webp"]);
  assert.deepEqual(await objectKeys("media/avatars/" + n + "/"), ["media/avatars/" + n + "/a.webp"]);
  assert.ok(await one("SELECT id FROM account_messages WHERE id = 'dm3'"));
  assert.equal((await call("/v1/session", { token: owner.token })).status, 200);
  assert.equal((await call("/v1/session", { token: normal.token })).status, 200);
  assert.equal(await one("SELECT public_id FROM account_temp WHERE public_id = ?", o), null, "a stray owner mark is dropped, not acted on");
  // A temporary account that is not due yet stays.
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", later.account.publicId));
});

test("the cron only ever deletes accounts with a temporary mark", async () => {
  const plain = await signup("never_temp", "Never");
  await cron(Date.now() + 400 * DAY);
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", plain.account.publicId));
});

test("extend, save for good, or delete now", async () => {
  const a = (await tempSignup({ expiresIn: "1h" })).body;
  const ext = await call("/v1/account/temporary", { method: "PUT", token: a.token, body: { expiresIn: "30d" } });
  assert.equal(ext.status, 200);
  assert.ok(ext.body.expiresAt > Date.now() + 29 * DAY);
  const custom = await call("/v1/account/temporary", { method: "PUT", token: a.token, body: { expiresAt: Date.now() + 5 * DAY } });
  assert.equal(custom.status, 200);
  const noIntent = await call("/v1/account/temporary/keep", { method: "POST", origin: ORIGIN, token: a.token, body: {} });
  assert.equal(noIntent.status, 403);
  const keep = await call("/v1/account/temporary/keep", { method: "POST", origin: ORIGIN, token: a.token, headers: { "X-Viktorych-Intent": "account-keep" }, body: {} });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  assert.equal(keep.body.temporary, false);
  assert.ok(keep.body.recoveryCodes.length > 0);
  await cron(Date.now() + 100 * DAY);
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", a.account.publicId), "a saved account is never swept");
  assert.equal((await call("/v1/account/temporary/delete", { method: "POST", origin: ORIGIN, token: a.token, headers: { "X-Viktorych-Intent": "account-delete" }, body: {} })).status, 409, "delete now is only for temporary accounts");

  const b = (await tempSignup({})).body;
  const gone = await call("/v1/account/temporary/delete", { method: "POST", origin: ORIGIN, token: b.token, headers: { "X-Viktorych-Intent": "account-delete" }, body: {} });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.deletion, "complete");
  assert.equal(await one("SELECT public_id FROM accounts WHERE public_id = ?", b.account.publicId), null);
});

test("no gifts or invites, and few DMs to strangers", async () => {
  const t = (await tempSignup({})).body;
  const gift = await call("/v1/gifts/send", { method: "POST", token: t.token, body: { giftId: "rose", handle: "plain_user" } });
  assert.equal(gift.status, 403);
  assert.equal(gift.body.error, "temporary_account");
  const invite = await call("/v1/points/invites", { method: "POST", token: t.token, body: {} });
  assert.equal(invite.status, 403);
  const people = [];
  for (let i = 0; i < 4; i++) people.push(await signup("stranger_" + i, "S" + i));
  for (let i = 0; i < 3; i++) {
    const sent = await call("/v1/messages", { method: "POST", token: t.token, body: { id: people[i].account.publicId, text: "hello" } });
    assert.ok(sent.status === 200 || sent.status === 201, JSON.stringify(sent.body));
  }
  const fourth = await call("/v1/messages", { method: "POST", token: t.token, body: { id: people[3].account.publicId, text: "hello" } });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.error, "temporary_dm_limit");
  // Someone who wrote first is not a stranger.
  await sql("INSERT INTO account_messages (id, sender_id, recipient_id, body, created_at, deleted_at) VALUES ('dmx', ?, ?, 'hey', ?, 0)", people[3].account.publicId, t.account.publicId, Date.now());
  const reply = await call("/v1/messages", { method: "POST", token: t.token, body: { id: people[3].account.publicId, text: "hi back" } });
  assert.ok(reply.status === 200 || reply.status === 201, JSON.stringify(reply.body));
});

test("others see a small Temporary label that the owner can turn off", async () => {
  const t = (await tempSignup({ displayName: "Visitor" })).body;
  const viewer = await signup("label_viewer", "Viewer");
  const seen = await call("/v1/profile/" + t.account.handle, { token: viewer.token });
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.equal(seen.body.account.temporary, true);
  const ownerRow = await one("SELECT public_id FROM accounts WHERE owner = 1");
  const ownerToken = "owner-label-token";
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerToken)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  await sql("INSERT INTO sessions (token_hash, public_id, created_at, expires_at) VALUES (?, ?, ?, ?)", hash, ownerRow.public_id, Date.now(), Date.now() + DAY);
  assert.equal((await call("/v1/owner/temporary", { method: "PUT", token: viewer.token, body: { label: false } })).status, 403);
  const off = await call("/v1/owner/temporary", { method: "PUT", token: ownerToken, body: { label: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.label, false);
  const fresh = (await tempSignup({ displayName: "Visitor 2" })).body;
  const hidden = await call("/v1/profile/" + fresh.account.handle, { token: viewer.token });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.account.temporary, undefined);
  await call("/v1/owner/temporary", { method: "PUT", token: ownerToken, body: { label: true } });
});
