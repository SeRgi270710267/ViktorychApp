import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

let mf;
let ipN = 40;

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
      OWNER_HANDLE: "ownertest",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      SIGNUP_GUARD: "on"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || ("203.0.113." + (ipN++)));
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body && !opts.raw) headers.set("content-type", "application/json");
  if (opts.type) headers.set("content-type", opts.type);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.raw || (opts.body ? JSON.stringify(opts.body) : undefined)
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: true }; }
  return { status: res.status, body, bytes: new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0))) };
}

async function callBytes(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || ("203.0.113." + (ipN++)));
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.type) headers.set("content-type", opts.type);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.raw
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, bytes, type: res.headers.get("content-type") || "" };
}

function zeroBits(bytes) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0) { count += 8; continue; }
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte >> bit) & 1) return count;
      count += 1;
    }
  }
  return count;
}

async function solve(ch) {
  const enc = new TextEncoder();
  const bits = Number(ch.bits) || 12;
  for (let n = 0; n < 3000000; n++) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(ch.id + ":" + ch.nonce + ":" + n)));
    if (zeroBits(digest) >= bits) return { id: ch.id, counter: n };
  }
  throw new Error("pow");
}

async function challenge() {
  const res = await call("/v1/signup/challenge");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.id, "string");
  return res.body;
}

async function signup(handle, name, extra) {
  const ch = await challenge();
  const pow = await solve(ch);
  const started = Date.now();
  const wait = Math.max(0, 1100 - (Date.now() - started));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const res = await call("/v1/signup", {
    method: "POST",
    body: Object.assign({ displayName: name, handle: handle, pow: pow, fax: "" }, extra || {})
  });
  assert.equal(res.status, 201);
  return res.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("sign-up guard rejects a missing proof, a honeypot, and a fast answer", async () => {
  const open = await call("/v1/signup", { method: "POST", body: { displayName: "Reader", handle: "readeropen" } });
  assert.equal(open.status, 400);
  assert.equal(open.body.error, "guard_required");
  const passkey = await call("/v1/webauthn/signup/options", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:8080" },
    body: { displayName: "Reader", handle: "readerpass" }
  });
  assert.equal(passkey.status, 400);
  assert.equal(passkey.body.error, "guard_required");
  const bait = await challenge();
  const baitPow = await solve(bait);
  const rejected = await call("/v1/signup", { method: "POST", body: { displayName: "Reader", handle: "readerbait", pow: baitPow, fax: "filled" } });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "rejected");
  const fast = await challenge();
  const fastPow = await solve(fast);
  const db = await mf.getD1Database("DB");
  await db.prepare("UPDATE signup_challenges SET created_at = ? WHERE id = ?").bind(Date.now(), fast.id).run();
  const tooFast = await call("/v1/signup", { method: "POST", body: { displayName: "Reader", handle: "readerfast", pow: fastPow, fax: "" } });
  assert.equal(tooFast.status, 400);
  assert.equal(tooFast.body.error, "too_fast");
  await new Promise((resolve) => setTimeout(resolve, 900));
  const created = await call("/v1/signup", { method: "POST", body: { displayName: "Reader", handle: "readerfast", pow: fastPow, fax: "" } });
  assert.equal(created.status, 201);
  assert.equal(Array.isArray(created.body.recoveryCodes) && created.body.recoveryCodes.length === 10, true);
});

test("recovery codes are stored only as hashes and rotate the account number", async () => {
  const created = await signup("readerone", "Reader One");
  assert.equal(created.recoveryCodes.length, 10);
  const db = await mf.getD1Database("DB");
  const rows = await db.prepare("SELECT code_lookup, code_hash, salt FROM recovery_codes").all();
  const blob = JSON.stringify((rows && rows.results) || []);
  let leaked = false;
  created.recoveryCodes.forEach((code) => {
    const raw = String(code).replace(/-/g, "");
    if (blob.includes(code) || blob.includes(raw)) leaked = true;
  });
  assert.equal(leaked, false);
  const fresh = await call("/v1/recovery/codes", { method: "POST", token: created.token, body: {} });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.recoveryCodes.length, 10);
  const stale = await call("/v1/recovery/restore", { method: "POST", body: { code: created.recoveryCodes[0] } });
  assert.equal(stale.status, 401);
  const restored = await call("/v1/recovery/restore", { method: "POST", body: { code: fresh.body.recoveryCodes[0] } });
  assert.equal(restored.status, 200);
  assert.equal(String(restored.body.accountNumber || "").length, 16);
  assert.equal(restored.body.accountNumber === created.accountNumber, false);
  assert.equal((restored.body.recoveryCodes || []).length, 10);
  const again = await call("/v1/recovery/restore", { method: "POST", body: { code: fresh.body.recoveryCodes[0] } });
  assert.equal(again.status, 401);
  const login = await call("/v1/login", { method: "POST", body: { accountNumber: restored.body.accountNumber } });
  assert.equal(login.status, 200);
  const old = await call("/v1/login", { method: "POST", body: { accountNumber: created.accountNumber } });
  assert.equal(old.status, 401);
});

test("public posts, media, block, mute, and owner-only reports", async () => {
  const ada = await signup("readertwo", "Reader Two");
  const bee = await signup("readerthree", "Reader Three");
  const owner = await signup("ownertest", "Owner Reader", { claimCode: "claim-test" });
  assert.equal(owner.account.owner, true);
  const posted = await call("/v1/posts", { method: "POST", token: ada.token, body: { body: "A public note" } });
  assert.equal(posted.status, 201);
  const postId = posted.body.post.id;
  const reply = await call("/v1/posts", { method: "POST", token: ada.token, body: { body: "A public reply", parentId: postId } });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.post.parentId, postId);
  const quote = await call("/v1/posts", { method: "POST", token: bee.token, body: { body: "A public quote", quoteId: postId } });
  assert.equal(quote.status, 201);
  assert.equal(quote.body.post.quote && quote.body.post.quote.id === postId, true);
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
  const boundary = "----essentials";
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\nA public photo\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dot.png"\r\nContent-Type: image/png\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const raw = new Uint8Array(head.length + png.length + tail.length);
  raw.set(head, 0);
  raw.set(png, head.length);
  raw.set(tail, head.length + png.length);
  const uploaded = await call("/v1/posts", {
    method: "POST",
    token: ada.token,
    type: "multipart/form-data; boundary=" + boundary,
    raw: raw
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.post.media.length, 1);
  const mediaPath = uploaded.body.post.media[0].url;
  const media = await callBytes(mediaPath, { token: bee.token });
  assert.equal(media.status, 200);
  assert.equal(media.type.indexOf("image/png") === 0, true);
  let same = media.bytes.length === png.length;
  for (let i = 0; same && i < png.length; i++) if (media.bytes[i] !== png[i]) same = false;
  assert.equal(same, true);
  const closed = await callBytes(mediaPath);
  assert.equal(closed.status, 401);
  const listed = await call("/v1/posts", { token: bee.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.posts.length >= 4, true);
  const blocked = await call("/v1/blocks", { method: "POST", token: bee.token, body: { accountId: ada.account.publicId } });
  assert.equal(blocked.status, 200);
  const hidden = await call("/v1/posts", { token: bee.token });
  assert.equal(hidden.body.posts.some((item) => item.authorId === ada.account.publicId), false);
  await call("/v1/blocks", { method: "DELETE", token: bee.token, body: { accountId: ada.account.publicId } });
  const muted = await call("/v1/mutes", { method: "POST", token: bee.token, body: { accountId: ada.account.publicId } });
  assert.equal(muted.status, 200);
  const quiet = await call("/v1/posts", { token: bee.token });
  assert.equal(quiet.body.posts.some((item) => item.authorId === ada.account.publicId), false);
  const reported = await call("/v1/posts/report", { method: "POST", token: bee.token, body: { postId: postId, reason: "Not welcome here" } });
  assert.equal(reported.status, 200);
  const denied = await call("/v1/moderation/reports", { token: bee.token });
  assert.equal(denied.status, 403);
  const queue = await call("/v1/moderation/reports", { token: owner.token });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.reports.length >= 1, true);
  const reportId = queue.body.reports[0].id;
  const hide = await call("/v1/moderation/reports", { method: "POST", token: owner.token, body: { id: reportId, action: "hide" } });
  assert.equal(hide.status, 200);
  const after = await call("/v1/posts", { token: owner.token });
  assert.equal(after.body.posts.some((item) => item.id === postId), false);
  const later = Date.now() + 60 * 60 * 1000;
  const scheduled = await call("/v1/posts", {
    method: "POST",
    token: ada.token,
    body: {
      body: "A note for later",
      audience: "friends",
      replyControl: "mentioned",
      location: "Nearby",
      poll: { options: ["Yes", "No"], minutes: 1440 },
      scheduledAt: later
    }
  });
  assert.equal(scheduled.status, 201);
  assert.equal(scheduled.body.scheduled, true);
  assert.equal(scheduled.body.post.poll.options.length, 2);
  assert.equal(scheduled.body.post.audience, "friends");
  const hiddenSchedule = await call("/v1/posts", { token: bee.token });
  assert.equal(hiddenSchedule.body.posts.some((item) => item.id === scheduled.body.post.id), false);
  const limited = await call("/v1/posts", {
    method: "POST",
    token: bee.token,
    body: { body: "hello @" + ada.account.handle, replyControl: "mentioned" }
  });
  assert.equal(limited.status, 201);
  const blockedReply = await call("/v1/posts", { method: "POST", token: owner.token, body: { body: "Not mentioned", parentId: limited.body.post.id } });
  assert.equal(blockedReply.status, 403);
  const allowedReply = await call("/v1/posts", { method: "POST", token: ada.token, body: { body: "I was mentioned", parentId: limited.body.post.id } });
  assert.equal(allowedReply.status, 201);
  const circle = await call("/v1/posts", { method: "POST", token: ada.token, body: { body: "Circle only", audience: "friends" } });
  assert.equal(circle.status, 201);
  const outsider = await call("/v1/posts", { token: bee.token });
  assert.equal(outsider.body.posts.some((item) => item.id === circle.body.post.id), false);
  const mine = await call("/v1/posts", { token: ada.token });
  assert.equal(mine.body.posts.some((item) => item.id === circle.body.post.id), true);
});
