import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "mirathorn";
const ORIGIN = "https://viktorychgroup.github.io";

let mf;
let bindings;

function workerOptions() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    unsafeTriggerHandlers: true,
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    durableObjects: {
      ACCOUNT_CHANNEL: { className: "AccountChannel", useSQLite: true }
    },
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.origin) headers.set("Origin", opts.origin);
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, headers: res.headers };
}

async function signup(handle, name, ip, claimCode) {
  const body = { displayName: name, handle };
  if (claimCode) body.claimCode = claimCode;
  const created = await call("/v1/signup", { method: "POST", ip, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

async function beat(token, ip, activity) {
  return call("/v1/presence", { method: "POST", ip, token, body: { activity: activity || "active" } });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSocket(ticket, ip) {
  const res = await mf.dispatchFetch("https://accounts.test/v1/channel?ticket=" + encodeURIComponent(ticket), {
    headers: {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "CF-Connecting-IP": ip || "203.0.113.80"
    }
  });
  assert.equal(res.status, 101, "websocket upgrade");
  const ws = res.webSocket;
  assert.ok(ws);
  ws.accept();
  const messages = [];
  ws.addEventListener("message", (event) => {
    try { messages.push(JSON.parse(String(event.data))); }
    catch (err) { messages.push({ raw: String(event.data) }); }
  });
  return { ws, messages, closed: new Promise((resolve) => ws.addEventListener("close", (event) => resolve(event.code))) };
}

async function waitFor(messages, pred, ms) {
  const start = Date.now();
  while (Date.now() - start < (ms || 3000)) {
    const found = messages.find(pred);
    if (found) return found;
    await sleep(20);
  }
  throw new Error("timeout " + JSON.stringify(messages));
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("presence heartbeats, privacy, status, cache, owner, and deletion", async () => {
  const ada = await signup("ada_pr", "Ada Presence", "203.0.113.81");
  const bee = await signup("bee_pr", "Bee Presence", "203.0.113.82");
  const cay = await signup("cay_pr", "Cay Presence", "203.0.113.83");
  const a = ada.account.publicId;
  const b = bee.account.publicId;
  const c = cay.account.publicId;

  const emergency = await call("/v1/presence", { token: "emergency-offline-1", ip: "203.0.113.84" });
  assert.equal(emergency.status, 403);

  const first = await beat(bee.token, "203.0.113.85", "active");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.coalesced, false);
  assert.equal(first.body.state, "online");
  const row = await bindings.DB.prepare("SELECT last_beat, last_seen FROM account_presence WHERE public_id = ?").bind(b).first();
  const second = await beat(bee.token, "203.0.113.86", "active");
  assert.equal(second.status, 200);
  assert.equal(second.body.coalesced, true);
  const again = await bindings.DB.prepare("SELECT last_beat, last_seen FROM account_presence WHERE public_id = ?").bind(b).first();
  assert.equal(Number(again.last_beat), Number(row.last_beat));
  assert.equal(Number(again.last_seen), Number(row.last_seen));

  const follow = await call("/v1/follows", {
    method: "PUT",
    ip: "203.0.113.87",
    token: ada.token,
    body: { id: "app:" + b }
  });
  assert.equal(follow.status, 200, JSON.stringify(follow.body));
  const locked = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.88",
    token: bee.token,
    body: { seenPrivacy: "follows" }
  });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.seenPrivacy, "follows");

  const seen = await call("/v1/presence?ids=" + b, { token: ada.token, ip: "203.0.113.89" });
  assert.equal(seen.status, 200);
  assert.equal(seen.headers.get("cache-control"), "private, max-age=15");
  assert.equal(seen.headers.get("cdn-cache-control"), "no-store");
  assert.equal(seen.body.presence[0].exact, true);
  assert.equal(seen.body.presence[0].state, "online");
  assert.ok(seen.body.presence[0].lastSeen > 0);

  const stranger = await call("/v1/presence?ids=" + b, { token: cay.token, ip: "203.0.113.90" });
  assert.equal(stranger.body.presence[0].exact, false);
  assert.equal(stranger.body.presence[0].lastSeen, 0);
  assert.equal(stranger.body.presence[0].state, "offline");

  const hiddenSelf = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.91",
    token: ada.token,
    body: { seenPrivacy: "nobody" }
  });
  assert.equal(hiddenSelf.status, 200);
  const blocked = await call("/v1/presence?ids=" + b, { token: ada.token, ip: "203.0.113.92" });
  assert.equal(blocked.body.presence[0].exact, false);
  assert.equal(blocked.body.presence[0].lastSeen, 0);
  await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.93",
    token: ada.token,
    body: { seenPrivacy: "everyone" }
  });

  const quiet = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.94",
    token: bee.token,
    body: { preference: "dnd" }
  });
  assert.equal(quiet.body.state, "dnd");
  const dnd = await call("/v1/presence?ids=" + b, { token: ada.token, ip: "203.0.113.95" });
  assert.equal(dnd.body.presence[0].state, "dnd");
  assert.equal(dnd.body.presence[0].exact, true);

  const frozen = Number((await bindings.DB.prepare("SELECT last_seen FROM account_presence WHERE public_id = ?").bind(b).first()).last_seen);
  const ghost = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.96",
    token: bee.token,
    body: { preference: "invisible" }
  });
  assert.equal(ghost.body.state, "invisible");
  const ghostBeat = await beat(bee.token, "203.0.113.97", "active");
  assert.equal(ghostBeat.status, 200);
  const held = await bindings.DB.prepare("SELECT last_seen, preference FROM account_presence WHERE public_id = ?").bind(b).first();
  assert.equal(held.preference, "invisible");
  assert.equal(Number(held.last_seen), frozen);
  const looksOff = await call("/v1/presence?ids=" + b, { token: ada.token, ip: "203.0.113.98" });
  assert.equal(looksOff.body.presence[0].state, "offline");
  assert.equal(looksOff.body.presence[0].lastSeen, 0);

  await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.99",
    token: bee.token,
    body: { preference: "online", seenPrivacy: "everyone" }
  });
  await beat(bee.token, "203.0.113.100", "active");

  const tooLong = "x".repeat(120);
  const custom = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.101",
    token: bee.token,
    body: { status: { emoji: "123456789", text: tooLong, clear: "30m" } }
  });
  assert.equal(custom.status, 200, JSON.stringify(custom.body));
  assert.equal(Array.from(custom.body.emoji).length, 8);
  assert.equal(Array.from(custom.body.text).length, 80);
  assert.ok(custom.body.clearAt > Date.now() + 29 * 60 * 1000);
  assert.ok(custom.body.clearAt < Date.now() + 31 * 60 * 1000);

  const cached = await call("/v1/presence?ids=" + b, { token: ada.token, ip: "203.0.113.102" });
  assert.equal(cached.body.presence[0].text.length, 80);
  await bindings.DB.prepare("UPDATE account_presence SET last_seen = 1 WHERE public_id = ?").bind(b).run();
  const still = await call("/v1/presence?ids=" + b, { token: ada.token, ip: "203.0.113.103" });
  assert.equal(still.body.presence[0].lastSeen, cached.body.presence[0].lastSeen);
  assert.notEqual(still.body.presence[0].lastSeen, 1);

  await bindings.DB.prepare("UPDATE account_status SET clear_at = ? WHERE public_id = ?").bind(Date.now() - 1000, b).run();
  await bindings.DB.prepare("UPDATE account_presence SET last_seen = ? WHERE public_id = ?").bind(cached.body.presence[0].lastSeen, b).run();
  const cron = await mf.dispatchFetch("https://accounts.test/cdn-cgi/handler/scheduled?cron=" + encodeURIComponent("* * * * *") + "&time=" + Date.now());
  assert.equal(cron.status, 200);
  const cleared = await bindings.DB.prepare("SELECT emoji, text, clear_at FROM account_status WHERE public_id = ?").bind(b).first();
  assert.equal(cleared.emoji, "");
  assert.equal(cleared.text, "");
  assert.equal(Number(cleared.clear_at), 0);

  const owner = await signup(OWNER, "Owner", "203.0.113.104", "claim-test");
  assert.equal(owner.account.owner, true);
  const ownerSet = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.105",
    token: owner.token,
    body: { preference: "idle", status: { emoji: "✨", text: "here", clear: "never" } }
  });
  assert.equal(ownerSet.status, 200, JSON.stringify(ownerSet.body));
  const ownerGet = await call("/v1/presence", { token: owner.token, ip: "203.0.113.106" });
  assert.equal(ownerGet.body.preference, "idle");
  assert.equal(ownerGet.body.text, "here");
  assert.equal(ownerGet.body.id, owner.account.publicId);

  const doomed = await signup("del_pr", "Del Presence", "203.0.113.107");
  await beat(doomed.token, "203.0.113.108", "active");
  await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.109",
    token: doomed.token,
    body: { status: { emoji: "✨", text: "bye", clear: "never" } }
  });
  const ticket = await call("/v1/channel/ticket", { method: "POST", token: doomed.token, ip: "203.0.113.110" });
  assert.equal(ticket.status, 200);
  assert.match(ticket.body.ticket, /^ct1\./);
  const removed = await call("/v1/account/delete", {
    method: "POST",
    ip: "203.0.113.111",
    origin: ORIGIN,
    token: doomed.token,
    headers: { "X-Viktorych-Intent": "account-delete" },
    body: { handle: "del_pr", accountNumber: doomed.accountNumber }
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const goneP = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM account_presence WHERE public_id = ?").bind(doomed.account.publicId).first();
  const goneS = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM account_status WHERE public_id = ?").bind(doomed.account.publicId).first();
  const goneT = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM channel_tickets WHERE public_id = ?").bind(doomed.account.publicId).first();
  assert.equal(Number(goneP.n), 0);
  assert.equal(Number(goneS.n), 0);
  assert.equal(Number(goneT.n), 0);
  assert.ok(c);
});

test("live presence reaches watchers and skips coalesced beats", async () => {
  const ada = await signup("ada_ws", "Ada Socket", "203.0.113.120");
  const bee = await signup("bee_ws", "Bee Socket", "203.0.113.121");
  const cay = await signup("cay_ws", "Cay Socket", "203.0.113.122");
  await call("/v1/follows", { method: "PUT", ip: "203.0.113.123", token: ada.token, body: { id: "app:" + bee.account.publicId } });
  await beat(bee.token, "203.0.113.124", "active");

  const missing = await call("/v1/channel", { token: ada.token, ip: "203.0.113.125" });
  assert.equal(missing.status, 426);
  const bad = await call("/v1/channel?ticket=ct1.nope", {
    ip: "203.0.113.126",
    headers: { Upgrade: "websocket" }
  });
  assert.equal(bad.status, 401);

  const adaTicket = await call("/v1/channel/ticket", { method: "POST", token: ada.token, ip: "203.0.113.127" });
  const cayTicket = await call("/v1/channel/ticket", { method: "POST", token: cay.token, ip: "203.0.113.128" });
  const once = await openSocket(adaTicket.body.ticket, "203.0.113.129");
  once.ws.close();
  const reused = await mf.dispatchFetch("https://accounts.test/v1/channel?ticket=" + encodeURIComponent(adaTicket.body.ticket), {
    headers: { Upgrade: "websocket", Connection: "Upgrade", "CF-Connecting-IP": "203.0.113.135" }
  });
  assert.equal(reused.status, 401);
  const again = await call("/v1/channel/ticket", { method: "POST", token: ada.token, ip: "203.0.113.130" });
  const watcher = await openSocket(again.body.ticket, "203.0.113.131");
  const stranger = await openSocket(cayTicket.body.ticket, "203.0.113.132");
  await waitFor(watcher.messages, (msg) => msg.op === "ready");
  watcher.ws.send(JSON.stringify({ op: "subscribe", topics: ["presence", "notifications"] }));
  watcher.ws.send(JSON.stringify({ op: "watch", topic: "presence", ids: [bee.account.publicId] }));
  await waitFor(watcher.messages, (msg) => msg.op === "ok" && msg.for === "watch");
  stranger.ws.send(JSON.stringify({ op: "subscribe", topics: ["presence"] }));
  await waitFor(stranger.messages, (msg) => msg.op === "ok" && msg.for === "subscribe");

  const changed = await call("/v1/presence", {
    method: "PATCH",
    ip: "203.0.113.133",
    token: bee.token,
    body: { preference: "dnd" }
  });
  assert.equal(changed.status, 200);
  const event = await waitFor(watcher.messages, (msg) => msg.op === "event" && msg.topic === "presence");
  assert.equal(event.id, bee.account.publicId);
  assert.equal(event.data.state, "dnd");
  await sleep(250);
  assert.equal(stranger.messages.some((msg) => msg.op === "event"), false);

  const before = watcher.messages.filter((msg) => msg.op === "event").length;
  const quiet = await beat(bee.token, "203.0.113.134", "active");
  assert.equal(quiet.body.coalesced, true);
  await sleep(200);
  assert.equal(watcher.messages.filter((msg) => msg.op === "event").length, before);
  watcher.ws.close();
  stranger.ws.close();
});
