import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { verifyManifest, sha256Hex, poolEnabled, poolFacts, admitUpload, acceptPoolMessage, cleanPoolSignal, headStart, manifestObjectName, UPLOAD_DAY_CAP } from "../../shared/peer-pool.js";

const ORIGIN = "https://viktorychgroup.github.io";
let mf;
let pub;

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  headers.set("Origin", ORIGIN);
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, text, headers: res.headers };
}
async function signup(handle, ip) {
  const created = await call("/v1/signup", { method: "POST", ip, body: { displayName: handle, handle } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(list, pred) {
  const start = Date.now();
  while (Date.now() - start < 3000) { const f = list.find(pred); if (f) return f; await sleep(20); }
  throw new Error("timeout " + JSON.stringify(list));
}
async function openRoom(ticket, ip) {
  const res = await mf.dispatchFetch("https://accounts.test/v1/pool/room?ticket=" + encodeURIComponent(ticket), { headers: { Upgrade: "websocket", Connection: "Upgrade", Origin: ORIGIN, "CF-Connecting-IP": ip } });
  assert.equal(res.status, 101);
  const ws = res.webSocket;
  ws.accept();
  const messages = [];
  ws.addEventListener("message", (ev) => { try { messages.push(JSON.parse(String(ev.data))); } catch (err) { messages.push({ raw: String(ev.data) }); } });
  return { ws, messages };
}

test.before(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA", "PULSE"],
    durableObjects: { ACCOUNT_CHANNEL: { className: "AccountChannel", useSQLite: true } },
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io",
      PBKDF2_ITERATIONS: "1000",
      POOL_SIGN_JWK: JSON.stringify(priv)
    }
  });
});
test.after(async () => { if (mf) await mf.dispose(); });

test("rules: defaults, caps and messages", () => {
  const wifi = poolFacts({ type: "wifi" }, { ua: "Mozilla/5.0 (Windows NT 10.0)", charging: null });
  assert.equal(poolEnabled("auto", wifi).on, true);
  const phoneWifi = poolFacts({ type: "wifi" }, { ua: "Mozilla/5.0 (Linux; Android 14) Mobile", charging: false });
  assert.equal(poolEnabled("auto", phoneWifi).on, false);
  assert.equal(poolEnabled("auto", poolFacts({ type: "wifi" }, { ua: "Android Mobile", charging: true })).on, true);
  assert.equal(poolEnabled("on", poolFacts({ type: "cellular" }, { ua: "Android Mobile", charging: true })).on, false);
  assert.equal(poolEnabled("on", poolFacts({ type: "wifi" }, { ua: "Windows", saveData: true })).on, false);
  assert.equal(poolEnabled("auto", poolFacts({ type: "wifi" }, { ua: "Windows", tv: true })).on, false);
  assert.equal(poolEnabled("on", poolFacts({ type: "wifi" }, { ua: "Windows", tv: true })).on, true);
  assert.equal(poolEnabled("off", wifi).on, false);
  let st = { day: "", used: 0 };
  const now = Date.UTC(2026, 9, 29, 12);
  const a = admitUpload(st, UPLOAD_DAY_CAP - 10, now); assert.equal(a.ok, true); st = a.state;
  assert.equal(admitUpload(st, 64 * 1024, now).ok, false);
  assert.equal(admitUpload(st, 64 * 1024, now + 86400000).ok, true);
  assert.ok(headStart(0) >= 60 && headStart(5000) <= 250);
  assert.equal(cleanPoolSignal({ type: "ice", candidate: "candidate:1 1 UDP 1 198.51.100.4 3478 typ relay raddr 0.0.0.0" }), null);
  assert.equal(acceptPoolMessage(JSON.stringify({ op: "data", bytes: "x" })), null);
});

test("a signed-in read signs a manifest into the pulse bucket", async () => {
  const data = await mf.getR2Bucket("DATA");
  const text = JSON.stringify({ feeds: [{ id: "news", title: "News" }], posts: Array.from({ length: 300 }, (_, i) => ({ id: "p" + i, feed: "news", text: "post " + i })) });
  await data.put("feeds.json", text);
  const reader = await signup("pool_reader", "203.0.113.70");
  const read = await call("/v1/data/feeds.json", { token: reader.token, ip: "203.0.113.70" });
  assert.equal(read.status, 200);
  const pulse = await mf.getR2Bucket("PULSE");
  let obj = null;
  for (let i = 0; i < 50 && !obj; i++) { obj = await pulse.get(manifestObjectName("feeds.json")); if (!obj) await sleep(50); }
  assert.ok(obj, "manifest written");
  const entry = JSON.parse(await obj.text());
  const head = await data.head("feeds.json");
  assert.equal(entry.mark, String(head.etag).replace(/"/g, ""));
  assert.equal(entry.h, await sha256Hex(read.text));
  assert.equal(await verifyManifest(entry, pub), true);
  assert.equal(await verifyManifest(Object.assign({}, entry, { h: "0".repeat(64) }), pub), false);
  assert.equal(await verifyManifest(entry), false, "a test key is not the production key");
});

test("pool room relays haves and signals, keeps counters for the owner panel", async () => {
  const one = await signup("pool_one", "203.0.113.71");
  const two = await signup("pool_two", "203.0.113.72");
  const tA = await call("/v1/media/swarm/ticket", { method: "POST", token: one.token, ip: "203.0.113.71" });
  const tB = await call("/v1/media/swarm/ticket", { method: "POST", token: two.token, ip: "203.0.113.72" });
  const bad = await mf.dispatchFetch("https://accounts.test/v1/pool/room?ticket=mt1.nope", { headers: { Upgrade: "websocket", Origin: ORIGIN } });
  assert.equal(bad.status, 401);
  const left = await openRoom(tA.body.ticket, "203.0.113.71");
  const readyA = await waitFor(left.messages, (m) => m.op === "ready");
  const right = await openRoom(tB.body.ticket, "203.0.113.72");
  const readyB = await waitFor(right.messages, (m) => m.op === "ready");
  assert.deepEqual(readyB.peers, [readyA.id]);
  await waitFor(left.messages, (m) => m.op === "peer" && m.id === readyB.id);
  const h = "ab".repeat(32);
  left.ws.send(JSON.stringify({ op: "have", items: [{ h, size: 1000 }], reset: true }));
  const have = await waitFor(right.messages, (m) => m.op === "have");
  assert.equal(have.from, readyA.id);
  assert.equal(have.items[0].h, h);
  right.ws.send(JSON.stringify({ op: "signal", to: readyA.id, signal: { type: "ice", candidate: "candidate:1 1 UDP 1 203.0.113.8 9 typ host", sdpMid: "0", sdpMLineIndex: 0 } }));
  const sig = await waitFor(left.messages, (m) => m.op === "signal");
  assert.equal(sig.from, readyB.id);
  right.ws.send(JSON.stringify({ op: "stats", peer: 4000, origin: 1000, up: 0, hits: 2, tries: 3, rejected: 1 }));
  left.ws.send(JSON.stringify({ op: "stats", peer: 0, origin: 5000, up: 4000, hits: 0, tries: 0, rejected: 0 }));
  await sleep(200);
  assert.equal(JSON.stringify(left.messages).indexOf(one.account.publicId), -1);
  right.ws.close();
  await waitFor(left.messages, (m) => m.op === "bye" && m.from === readyB.id);
  left.ws.close();
});
