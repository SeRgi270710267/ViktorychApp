import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { awardActivity, awardBirthdayBonuses, clawback, dailyFreeGift } from "../src/points.js";

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
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.80");
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
    body: { displayName: "Member " + handle.slice(-1).toUpperCase(), handle }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test("a daily gift and the board stay off", async () => {
  assert.deepEqual(await dailyFreeGift(), { enabled: false });
});

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("points ledger, caps, clawback, and gift privacy", async () => {
  const ada = await signup("user_a", "203.0.113.81");
  const bea = await signup("user_b", "203.0.113.82");
  const cam = await signup("user_c", "203.0.113.83");
  const dee = await signup("user_d", "203.0.113.84");

  const start = await call("/v1/points", { ip: "203.0.113.85", token: ada.token });
  assert.equal(start.body.balance, 25);
  assert.equal(JSON.stringify(start.body.history).includes(bea.account.handle), false);

  const bought = await call("/v1/points/touch", {
    method: "POST",
    ip: "203.0.113.86",
    token: ada.token,
    body: { action: "login", points: 99999 }
  });
  assert.equal(bought.body.awarded, 5);
  const again = await call("/v1/points/touch", {
    method: "POST",
    ip: "203.0.113.87",
    token: ada.token,
    body: { action: "login", points: 99999 }
  });
  assert.equal(again.body.awarded, 0);

  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await bindings.DB.prepare(
    "INSERT INTO point_streaks (public_id, kind, last_day, streak) VALUES (?, 'login', ?, 3) ON CONFLICT(public_id, kind) DO UPDATE SET last_day = excluded.last_day, streak = excluded.streak"
  ).bind(bea.account.publicId, day).run();
  const streak = await call("/v1/points/touch", { method: "POST", ip: "203.0.113.88", token: bea.token, body: { action: "login" } });
  assert.equal(streak.body.awarded, 8);

  let firstId = "";
  let lastId = "";
  for (let i = 0; i < 6; i++) {
    const posted = await call("/v1/posts", { method: "POST", ip: "203.0.113." + (110 + i), token: ada.token, body: { body: "note " + i } });
    assert.equal(posted.status, 201, JSON.stringify(posted.body));
    if (!firstId) firstId = posted.body.post.id;
    lastId = posted.body.post.id;
  }
  const capped = await call("/v1/points", { ip: "203.0.113.90", token: ada.token });
  assert.equal(capped.body.balance, 25 + 5 + 8 * 5);

  const reply = await call("/v1/posts", {
    method: "POST",
    ip: "203.0.113.91",
    token: ada.token,
    body: { body: "own reply", parentId: lastId }
  });
  assert.equal(reply.status, 201);
  const afterOwn = await call("/v1/points", { ip: "203.0.113.92", token: ada.token });
  assert.equal(afterOwn.body.balance, capped.body.balance + 3);

  const other = await call("/v1/posts", {
    method: "POST",
    ip: "203.0.113.93",
    token: bea.token,
    body: { body: "a reply", parentId: lastId }
  });
  assert.equal(other.status, 201);
  const received = await call("/v1/points", { ip: "203.0.113.94", token: ada.token });
  assert.equal(received.body.balance, afterOwn.body.balance + 2);

  await clawback(bindings, ada.account.publicId, "post", firstId);
  const clawed = await call("/v1/points", { ip: "203.0.113.95", token: ada.token });
  assert.equal(clawed.body.balance, received.body.balance - 8);

  const closed = await call("/v1/gifts/prefs", { method: "PUT", ip: "203.0.113.96", token: bea.token, body: { who: "followers", hideTab: false } });
  assert.equal(closed.status, 200);
  const denied = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.97",
    token: ada.token,
    body: { giftId: "heart", handle: "user_b", privacy: "public" }
  });
  assert.equal(denied.status, 403);

  await call("/v1/follows", { method: "PUT", ip: "203.0.113.98", token: ada.token, body: { id: "app:" + bea.account.publicId } });
  const sent = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.99",
    token: ada.token,
    body: { giftId: "heart", handle: "user_b", message: "hello", privacy: "public" }
  });
  assert.equal(sent.status, 201);

  const priv = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.100",
    token: ada.token,
    body: { giftId: "heart", handle: "user_b", message: "quiet", privacy: "private" }
  });
  assert.equal(priv.status, 201);
  const anon = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.101",
    token: ada.token,
    body: { giftId: "heart", handle: "user_b", message: "hidden sender", privacy: "anonymous" }
  });
  assert.equal(anon.status, 201);

  const ownerView = await call("/v1/gifts?handle=user_b", { ip: "203.0.113.102", token: bea.token });
  const ownerSenders = ownerView.body.gifts.map((item) => item.sender && item.sender.handle);
  assert.equal(ownerSenders.includes("user_a"), true);
  assert.equal(ownerSenders.includes(null) || ownerSenders.some((name) => !name), true);

  const stranger = await call("/v1/gifts?handle=user_b", { ip: "203.0.113.103", token: cam.token });
  const publicNames = stranger.body.gifts.filter((item) => item.message === "hello").map((item) => item.sender && item.sender.handle);
  const privateNames = stranger.body.gifts.filter((item) => item.message === "quiet").map((item) => item.sender);
  assert.deepEqual(publicNames, ["user_a"]);
  assert.deepEqual(privateNames, [null]);
  assert.equal(JSON.stringify(stranger.body).includes(ada.account.publicId), false);

  const poor = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.104",
    token: ada.token,
    body: { giftId: "crown", handle: "user_b", privacy: "public" }
  });
  assert.equal(poor.status, 402);

  await call("/v1/blocks", { method: "PUT", ip: "203.0.113.105", token: dee.token, body: { id: ada.account.publicId } });
  await call("/v1/gifts/prefs", { method: "PUT", ip: "203.0.113.106", token: dee.token, body: { who: "everyone" } });
  const blocked = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.107",
    token: ada.token,
    body: { giftId: "star", handle: "user_d", privacy: "public" }
  });
  assert.equal(blocked.status, 403);

  const missingParent = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.110",
    token: ada.token,
    body: { giftId: "heart", handle: "user_b", mode: "reply", privacy: "public" }
  });
  assert.equal(missingParent.status, 400);
  const replyGift = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.111",
    token: ada.token,
    body: { giftId: "heart", handle: "user_b", mode: "reply", parentId: lastId, message: "for the thread", privacy: "public" }
  });
  assert.equal(replyGift.status, 201);
  assert.equal(replyGift.body.context, "reply");
  assert.equal(!!(replyGift.body.post && replyGift.body.post.gift && replyGift.body.post.gift.svg), true);
  const listed = await call("/v1/posts", { ip: "203.0.113.112", token: bea.token });
  const attached = (listed.body.posts || []).find((item) => item.id === replyGift.body.postId);
  assert.equal(!!(attached && attached.gift && attached.gift.message === "for the thread"), true);
  const dm = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.113",
    token: ada.token,
    body: { giftId: "heart", handle: "user_c", mode: "dm", message: "in a message", privacy: "private" }
  });
  assert.equal(dm.status, 201);
  const inbox = await call("/v1/gifts/inbox", { ip: "203.0.113.114", token: cam.token });
  assert.equal(inbox.body.gifts.some((item) => item.message === "in a message" && item.sender && item.sender.handle === "user_a"), true);
  const otherInbox = await call("/v1/gifts/inbox", { ip: "203.0.113.115", token: bea.token });
  assert.equal(otherInbox.body.gifts.some((item) => item.message === "in a message"), false);

  await bindings.DB.prepare(
    "CREATE TABLE IF NOT EXISTS about_fields (id TEXT PRIMARY KEY, public_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL, tz TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)"
  ).run();
  const now = new Date();
  const stamp = "1990-" + String(now.getUTCMonth() + 1).padStart(2, "0") + "-" + String(now.getUTCDate()).padStart(2, "0");
  await bindings.DB.prepare(
    "INSERT INTO about_fields (id, public_id, kind, body, audience, tz, created_at) VALUES ('bday0000000000000000000000000001', ?, 'birthday', ?, 'followers', 'UTC', ?)"
  ).bind(bea.account.publicId, stamp, Date.now()).run();
  await bindings.DB.prepare("UPDATE point_balances SET balance = balance + 100 WHERE public_id = ?").bind(ada.account.publicId).run();
  const closedGift = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.116",
    token: cam.token,
    body: { giftId: "cake", handle: "user_b", privacy: "public" }
  });
  assert.equal(closedGift.status, 403);
  assert.equal(JSON.stringify(closedGift.body).includes("1990"), false);
  const before = await call("/v1/points", { ip: "203.0.113.117", token: bea.token });
  const cake = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.118",
    token: ada.token,
    body: { giftId: "cake", handle: "user_b", privacy: "public" }
  });
  assert.equal(cake.status, 201);
  assert.equal(JSON.stringify(cake.body).includes("1990"), false);
  const bonus = await awardBirthdayBonuses(bindings, Date.now());
  assert.equal(bonus.awarded, 25);
  const secondBonus = await awardBirthdayBonuses(bindings, Date.now());
  assert.equal(secondBonus.awarded, 0);
  const after = await call("/v1/points", { ip: "203.0.113.119", token: bea.token });
  assert.equal(after.body.balance, before.body.balance + 25);
  await bindings.DB.prepare("UPDATE about_fields SET audience = 'only' WHERE public_id = ?").bind(bea.account.publicId).run();
  const hiddenGift = await call("/v1/gifts/send", {
    method: "POST",
    ip: "203.0.113.120",
    token: ada.token,
    body: { giftId: "candle", handle: "user_b", privacy: "public" }
  });
  assert.equal(hiddenGift.status, 403);
  bindings.BIRTHDAY_POINTS = "off";
  const paused = await awardBirthdayBonuses(bindings, Date.now());
  assert.equal(paused.awarded, 0);
  delete bindings.BIRTHDAY_POINTS;
  const source = fs.readFileSync(fileURLToPath(new URL("../src/index.js", import.meta.url)), "utf8");
  assert.equal(source.includes("awardBirthdayBonuses(env, at)"), true);

  const board = await call("/v1/points/board", { ip: "203.0.113.108" });
  assert.equal(board.body.enabled, false);
  const free = await call("/v1/gifts/daily", { ip: "203.0.113.109" });
  assert.equal(free.body.enabled, false);
});
