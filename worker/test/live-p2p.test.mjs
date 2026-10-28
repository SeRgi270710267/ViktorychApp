import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const ORIGIN = "https://viktorychgroup.github.io";

let mf;

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
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.80");
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
  return { status: res.status, body, text };
}

async function signup(handle, name, ip) {
  const created = await call("/v1/signup", { method: "POST", ip, origin: ORIGIN, body: { displayName: name, handle } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openLive(id, ticket, ip) {
  const res = await mf.dispatchFetch("https://accounts.test/v1/live/" + id + "/signal?ticket=" + encodeURIComponent(ticket), {
    headers: {
      Upgrade: "websocket",
      Connection: "Upgrade",
      Origin: ORIGIN,
      "CF-Connecting-IP": ip
    }
  });
  assert.equal(res.status, 101, JSON.stringify({ status: res.status }));
  const ws = res.webSocket;
  assert.ok(ws);
  ws.accept();
  const messages = [];
  ws.addEventListener("message", (event) => {
    try { messages.push(JSON.parse(String(event.data))); }
    catch (err) { messages.push({ raw: String(event.data) }); }
  });
  return { ws, messages };
}

async function waitFor(messages, pred) {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const found = messages.find(pred);
    if (found) return found;
    await sleep(20);
  }
  throw new Error("timeout " + JSON.stringify(messages));
}

function idsOf(body) {
  return ((body && body.lives) || []).map((item) => item.id);
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("signaling is only for the audience and never carries media", async () => {
  const host = await signup("livehost", "Live Host", "203.0.113.80");
  const fan = await signup("livefan", "Live Fan", "203.0.113.81");
  const other = await signup("liveout", "Live Out", "203.0.113.82");
  const guest = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.83" });
  assert.equal(guest.status, 401);

  const created = await call("/v1/live", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.80",
    token: host.token,
    body: { title: "Desk", audience: "public", sources: "camera", fanout: 1 }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.live.id;
  assert.match(created.body.ticket, /^lt1\./);
  assert.equal(created.body.iceServers.some((item) => String(item.urls).startsWith("stun:")), true);
  assert.equal(created.body.iceServers.some((item) => String(item.urls).startsWith("turn")), false);
  assert.equal(JSON.stringify(created.body).includes("sdp"), false);

  const seen = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.82", token: other.token });
  assert.equal(seen.status, 200);
  assert.ok(idsOf(seen.body).includes(id));

  const left = await openLive(id, created.body.ticket, "203.0.113.80");
  const welcome = await waitFor(left.messages, (msg) => msg.op === "welcome");
  assert.equal(welcome.role, "host");
  const fanTicket = await call("/v1/live/" + id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.81", token: fan.token, body: {} });
  assert.equal(fanTicket.status, 200);
  const mid = await openLive(id, fanTicket.body.ticket, "203.0.113.81");
  const midWelcome = await waitFor(mid.messages, (msg) => msg.op === "welcome");
  assert.equal(midWelcome.parentId, host.account.publicId);
  const tree = await waitFor(left.messages, (msg) => msg.op === "tree" && (msg.children || []).includes(fan.account.publicId));
  assert.deepEqual(tree.roster, [fan.account.publicId]);
  assert.equal(JSON.stringify(tree).includes("candidate"), false);

  const otherTicket = await call("/v1/live/" + id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.82", token: other.token, body: {} });
  const right = await openLive(id, otherTicket.body.ticket, "203.0.113.82");
  const rightWelcome = await waitFor(right.messages, (msg) => msg.op === "welcome");
  assert.equal(rightWelcome.parentId, fan.account.publicId);
  assert.notEqual(rightWelcome.parentId, host.account.publicId);

  left.ws.send(JSON.stringify({ op: "signal", to: fan.account.publicId, data: { kind: "offer", sdp: "v=0" } }));
  const offer = await waitFor(mid.messages, (msg) => msg.op === "signal");
  assert.equal(offer.data.kind, "offer");
  right.ws.send(JSON.stringify({ op: "signal", to: host.account.publicId, data: { kind: "offer", sdp: "v=0" } }));
  await sleep(80);
  assert.equal(left.messages.some((msg) => msg.op === "signal" && msg.from === other.account.publicId), false);
  left.ws.send(JSON.stringify({ op: "data", bytes: "not-a-media-file" }));
  await sleep(80);
  assert.equal(mid.messages.some((msg) => msg.op === "data" || Object.prototype.hasOwnProperty.call(msg, "bytes")), false);

  const reused = await call("/v1/live/" + id + "/signal?ticket=" + encodeURIComponent(fanTicket.body.ticket), {
    method: "GET",
    origin: ORIGIN,
    ip: "203.0.113.81",
    headers: { Upgrade: "websocket" }
  });
  assert.equal(reused.status, 401);

  const ended = await call("/v1/live/" + id + "/end", { method: "POST", origin: ORIGIN, ip: "203.0.113.80", token: host.token, body: {} });
  assert.equal(ended.status, 200);
  const after = await call("/v1/live/" + id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.82", token: other.token, body: {} });
  assert.equal(after.status, 404);
  right.ws.close();
  mid.ws.close();
  left.ws.close();
});

test("followers, lists, invites, and blocks stay hidden from everyone else", async () => {
  const host = await signup("livehost2", "Live Host", "203.0.113.90");
  const fan = await signup("livefan2", "Live Fan", "203.0.113.91");
  const pal = await signup("livepal2", "Live Pal", "203.0.113.92");
  const followed = await call("/v1/follows", {
    method: "PUT",
    origin: ORIGIN,
    ip: "203.0.113.91",
    token: fan.token,
    body: { id: "app:" + host.account.publicId }
  });
  assert.equal(followed.status, 200);
  const back = await call("/v1/follows", {
    method: "PUT",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { id: "app:" + fan.account.publicId }
  });
  assert.equal(back.status, 200);

  const followers = await call("/v1/live", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { audience: "followers", sources: "camera" }
  });
  assert.equal(followers.status, 201);
  const id = followers.body.live.id;
  const hidden = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.92", token: pal.token });
  assert.equal(idsOf(hidden.body).includes(id), false);
  const shown = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.91", token: fan.token });
  assert.equal(idsOf(shown.body).includes(id), true);
  const denied = await call("/v1/live/" + id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.92", token: pal.token, body: {} });
  assert.equal(denied.status, 404);
  await sleep(50);
  let noted = false;
  for (let i = 0; i < 20 && !noted; i++) {
    const notes = await call("/v1/notifications", { origin: ORIGIN, ip: "203.0.113.91", token: fan.token });
    assert.equal(notes.status, 200);
    const items = notes.body.items || [];
    noted = JSON.stringify(items).includes("#/live/" + id);
    if (!noted) await sleep(100);
  }
  assert.equal(noted, true);

  const mutuals = await call("/v1/live", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { audience: "mutuals", sources: "screen" }
  });
  assert.equal(mutuals.status, 201);
  const mutualId = mutuals.body.live.id;
  const fanSees = await call("/v1/live/" + mutualId + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.91", token: fan.token, body: {} });
  assert.equal(fanSees.status, 200);
  const palMiss = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.92", token: pal.token });
  assert.equal(idsOf(palMiss.body).includes(mutualId), false);

  const alone = await call("/v1/live", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { audience: "self", sources: "camera" }
  });
  const aloneList = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.91", token: fan.token });
  assert.equal(idsOf(aloneList.body).includes(alone.body.live.id), false);

  const listed = await call("/v1/live", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { audience: "list", members: [pal.account.publicId], sources: "both" }
  });
  assert.equal(listed.status, 201);
  const palTicket = await call("/v1/live/" + listed.body.live.id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.92", token: pal.token, body: {} });
  assert.equal(palTicket.status, 200);
  const fanMiss = await call("/v1/live/" + listed.body.live.id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.91", token: fan.token, body: {} });
  assert.equal(fanMiss.status, 404);
  const blocked = await call("/v1/live/" + listed.body.live.id + "/block", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { accountId: pal.account.publicId }
  });
  assert.equal(blocked.status, 200);
  const kicked = await call("/v1/live/" + listed.body.live.id + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.92", token: pal.token, body: {} });
  assert.equal(kicked.status, 404);

  const invite = await call("/v1/live", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.90",
    token: host.token,
    body: { audience: "invite", password: "correct horse", sources: "tab" }
  });
  assert.equal(invite.status, 201);
  assert.ok(invite.body.invite);
  const linkId = invite.body.live.id;
  const noToken = await call("/v1/live/" + linkId + "/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.91", token: fan.token, body: {} });
  assert.equal(noToken.status, 404);
  const badPass = await call("/v1/live/" + linkId + "/ticket", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.91",
    token: fan.token,
    body: { invite: invite.body.invite, password: "nope" }
  });
  assert.equal(badPass.status, 404);
  const good = await call("/v1/live/" + linkId + "/ticket", {
    method: "POST",
    origin: ORIGIN,
    ip: "203.0.113.91",
    token: fan.token,
    body: { invite: invite.body.invite, password: "correct horse" }
  });
  assert.equal(good.status, 200);
  const quiet = await call("/v1/live", { origin: ORIGIN, ip: "203.0.113.92", token: pal.token });
  assert.equal(idsOf(quiet.body).includes(linkId), false);
});
