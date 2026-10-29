import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { cleanP2pSignal } from "../src/p2p.js";

let mf;

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
  return { status: res.status, body, text };
}

async function signup(ip, handle, name) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    body: { displayName: name, handle }
  });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n";

test("signals keep only handshake fields", () => {
  assert.equal(cleanP2pSignal(null), null);
  assert.equal(cleanP2pSignal({ kind: "hack", sid: "abcdef12" }), null);
  assert.equal(cleanP2pSignal({ kind: "offer", sid: "x" , sdp: SDP }), null);
  assert.equal(cleanP2pSignal({ kind: "offer", sid: "abcdef12", sdp: "nope" }), null);
  assert.equal(cleanP2pSignal({ kind: "offer", sid: "abcdef12", sdp: "v=0\r\n" + "a".repeat(9000) }), null);
  assert.deepEqual(cleanP2pSignal({ kind: "offer", sid: "abcdef12", sdp: SDP, extra: "drop" }), { kind: "offer", sid: "abcdef12", sdp: SDP });
  assert.deepEqual(cleanP2pSignal({ kind: "ice", sid: "abcdef12", cand: { candidate: "candidate:1 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0, x: 1 } }),
    { kind: "ice", sid: "abcdef12", cand: { candidate: "candidate:1 1 udp 1 127.0.0.1 9 typ host", sdpMid: "0", sdpMLineIndex: 0 } });
  assert.deepEqual(cleanP2pSignal({ kind: "bye", sid: "abcdef12" }), { kind: "bye", sid: "abcdef12" });
});

test("only friends can signal each other", async () => {
  const ana = await signup("203.0.113.151", "p2p_ana", "Ana Peer");
  const bo = await signup("203.0.113.152", "p2p_bo", "Bo Peer");
  const cy = await signup("203.0.113.153", "p2p_cy", "Cy Peer");
  const offer = { kind: "offer", sid: "sid_123456", sdp: SDP };
  const anon = await call("/v1/p2p/signal", { method: "POST", body: { to: bo.account.publicId, signal: offer } });
  assert.equal(anon.status, 401);
  const early = await call("/v1/p2p/signal", { method: "POST", token: ana.token, ip: "203.0.113.151", body: { to: bo.account.publicId, signal: offer } });
  assert.equal(early.status, 403, "strangers can't signal");
  await call("/v1/friends/request", { method: "POST", token: ana.token, ip: "203.0.113.151", body: { targetId: "app:" + bo.account.publicId } });
  const ok = await call("/v1/friends/accept", { method: "POST", token: bo.token, ip: "203.0.113.152", body: { targetId: "app:" + ana.account.publicId } });
  assert.equal(ok.body.status, "friends");
  const sent = await call("/v1/p2p/signal", { method: "POST", token: ana.token, ip: "203.0.113.151", body: { to: bo.account.publicId, signal: offer } });
  assert.equal(sent.status, 200, sent.text);
  const back = await call("/v1/p2p/signal", { method: "POST", token: bo.token, ip: "203.0.113.152", body: { to: ana.account.publicId, signal: { kind: "answer", sid: "sid_123456", sdp: SDP } } });
  assert.equal(back.status, 200, back.text);
  const bad = await call("/v1/p2p/signal", { method: "POST", token: ana.token, ip: "203.0.113.151", body: { to: bo.account.publicId, signal: { kind: "offer", sid: "sid_123456", sdp: "x" } } });
  assert.equal(bad.status, 400);
  const self = await call("/v1/p2p/signal", { method: "POST", token: ana.token, ip: "203.0.113.151", body: { to: ana.account.publicId, signal: offer } });
  assert.equal(self.status, 400);
  const stranger = await call("/v1/p2p/signal", { method: "POST", token: cy.token, ip: "203.0.113.153", body: { to: ana.account.publicId, signal: offer } });
  assert.equal(stranger.status, 403);
  const get = await call("/v1/p2p/signal", { token: ana.token, ip: "203.0.113.151" });
  assert.equal(get.status, 405);
});
