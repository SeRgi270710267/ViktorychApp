import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const ORIGIN = "https://viktorychgroup.github.io";
const SWARM = "ab".repeat(16);

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

async function signup(handle, name, ip) {
  const created = await call("/v1/signup", { method: "POST", ip, origin: ORIGIN, body: { displayName: name, handle } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSwarm(ticket, ip) {
  const res = await mf.dispatchFetch("https://accounts.test/v1/media/swarm?ticket=" + encodeURIComponent(ticket) + "&id=" + SWARM, {
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

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("swarm signaling relays haves and drops media bytes", async () => {
  const one = await signup("mesh_one", "Mesh One", "203.0.113.40");
  const two = await signup("mesh_two", "Mesh Two", "203.0.113.41");
  const denied = await call("/v1/media/swarm/ticket", { method: "POST", origin: ORIGIN, ip: "203.0.113.42" });
  assert.equal(denied.status, 401);
  const ticketA = await call("/v1/media/swarm/ticket", { method: "POST", origin: ORIGIN, token: one.token, ip: "203.0.113.40" });
  const ticketB = await call("/v1/media/swarm/ticket", { method: "POST", origin: ORIGIN, token: two.token, ip: "203.0.113.41" });
  assert.equal(ticketA.status, 200);
  assert.equal(ticketB.status, 200);
  assert.match(ticketA.body.ticket, /^mt1\./);
  const left = await openSwarm(ticketA.body.ticket, "203.0.113.40");
  const right = await openSwarm(ticketB.body.ticket, "203.0.113.41");
  const readyA = await waitFor(left.messages, (msg) => msg.op === "ready");
  const readyB = await waitFor(right.messages, (msg) => msg.op === "ready");
  assert.notEqual(readyA.id, readyB.id);
  assert.equal(JSON.stringify(readyA).indexOf(one.account.publicId), -1);
  const sha = "cd".repeat(32);
  left.ws.send(JSON.stringify({ op: "have", items: [{ id: sha, sha256: sha, size: 2048 }] }));
  const heard = await waitFor(right.messages, (msg) => msg.op === "have");
  assert.equal(heard.from, readyA.id);
  assert.equal(heard.items[0].sha256, sha);
  left.ws.send(JSON.stringify({
    op: "signal",
    to: readyB.id,
    signal: { type: "ice", candidate: "candidate:1 1 UDP 1 203.0.113.8 9 typ host", sdpMid: "0", sdpMLineIndex: 0 }
  }));
  const signal = await waitFor(right.messages, (msg) => msg.op === "signal");
  assert.equal(signal.from, readyA.id);
  assert.equal(signal.signal.candidate.indexOf("typ host") > 0, true);
  left.ws.send(JSON.stringify({ op: "data", bytes: "not-media" }));
  const bye = await waitFor(right.messages, (msg) => msg.op === "bye");
  assert.equal(bye.from, readyA.id);
  assert.equal(right.messages.some((msg) => msg.op === "data" || Object.prototype.hasOwnProperty.call(msg, "bytes")), false);
  right.ws.close();
});
