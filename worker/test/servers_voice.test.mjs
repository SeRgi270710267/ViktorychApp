import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { PERM } from "../../shared/server-perms.js";

const OWNER = "srv_owner";
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
    durableObjects: { ACCOUNT_CHANNEL: { className: "AccountChannel", useSQLite: true } },
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: OWNER,
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
  let payload;
  if (opts.raw) {
    payload = opts.raw;
    headers.set("content-type", opts.type || "application/octet-stream");
  } else if (opts.body) {
    payload = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text, buf, headers: res.headers };
}

async function signup(ip, handle, name, claimCode) {
  const b = { displayName: name, handle };
  if (claimCode) b.claimCode = claimCode;
  const created = await call("/v1/signup", { method: "POST", ip, body: b });
  assert.equal(created.status, 201, created.text);
  return created.body;
}


function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(list, pred, ms) {
  const start = Date.now();
  while (Date.now() - start < (ms || 3000)) {
    const hit = list.find(pred);
    if (hit) return hit;
    await sleep(15);
  }
  throw new Error("timeout " + JSON.stringify(list.slice(-5)));
}

async function openSocket(token, sid, ip, voice) {
  const t = await call("/v1/servers/" + sid + "/ticket", { method: "POST", token, ip });
  assert.equal(t.status, 200, t.text);
  const res = await mf.dispatchFetch("https://accounts.test/v1/servers/ws?s=" + sid + (voice ? "&k=v" : "") + "&ticket=" + encodeURIComponent(t.body.ticket), {
    headers: { Upgrade: "websocket", Connection: "Upgrade", "CF-Connecting-IP": ip || "203.0.113.10" }
  });
  assert.equal(res.status, 101);
  const ws = res.webSocket;
  ws.accept();
  const messages = [];
  ws.addEventListener("message", (e) => {
    try { messages.push(JSON.parse(String(e.data))); } catch (err) { messages.push({ raw: String(e.data) }); }
  });
  const send = (o) => ws.send(JSON.stringify(o));
  return { ws, messages, send };
}

test.before(async () => { mf = new Miniflare(workerOptions()); });
test.after(async () => { if (mf) await mf.dispose(); });

test("native servers voice: signaling relay, roster, mute, moves and limits", async () => {
  const owner = await signup("198.51.100.60", OWNER, "Owner", "claim-test");
  const ana = await signup("198.51.100.61", "srv_vana", "Ana Voice");
  const bo = await signup("198.51.100.62", "srv_vbo", "Bo Voice");
  const made = await call("/v1/servers", { method: "POST", token: owner.token, body: { name: "Voice Test", voiceCategoryName: "Voice channels", voiceName: "General" } });
  assert.equal(made.status, 200, made.text);
  const sid = made.body.server.id;
  const base = "/v1/servers/" + sid;
  const inv = await call(base + "/invites", { method: "POST", token: owner.token, body: {} });
  for (const who of [ana, bo]) {
    const j = await call("/v1/servers/invite/" + inv.body.invite.code + "/join", { method: "POST", token: who.token });
    assert.equal(j.status, 200, j.text);
  }
  const O = owner.token, A = ana.token, B = bo.token;
  const st = await call(base, { token: A });
  assert.equal(st.status, 200, st.text);
  const vc = st.body.channels.find((c) => c.kind === "voice");
  assert.ok(vc, "a voice channel is created with the server");
  assert.equal(vc.name, "General");
  assert.ok(st.body.me.perms & PERM.CONNECT);
  assert.ok(st.body.me.perms & PERM.SPEAK);
  assert.ok(!(st.body.me.perms & PERM.MUTE_MEMBERS));
  const anaMid = st.body.me.mid;
  const boMid = (await call(base, { token: B })).body.me.mid;
  const ownerMid = (await call(base, { token: O })).body.me.mid;

  /* No text chat in voice channels yet. */
  assert.equal((await call(base + "/channels/" + vc.id + "/messages", { method: "POST", token: A, body: { body: "hi" } })).status, 400);
  assert.equal((await call(base + "/channels/" + vc.id + "/messages", { token: A })).status, 400);

  /* A normal (chat) socket sees the roster but never gets signaling. */
  const ui = await openSocket(O, sid, "198.51.100.60");
  const ready = await waitFor(ui.messages, (m) => m.op === "ready");
  assert.deepEqual(ready.voice, {});

  const va = await openSocket(A, sid, "198.51.100.61", true);
  await waitFor(va.messages, (m) => m.op === "ready");
  va.send({ op: "vjoin", c: vc.id, st: { mu: false } });
  const r1 = await waitFor(va.messages, (m) => m.op === "vready");
  assert.equal(r1.c, vc.id);
  assert.deepEqual(r1.peers, []);
  assert.equal(r1.cap, 8);
  const seen = await waitFor(ui.messages, (m) => m.op === "voice" && m.a === anaMid && m.c === vc.id);
  assert.equal(seen.st.mu, false);

  const vb = await openSocket(B, sid, "198.51.100.62", true);
  const readyB = await waitFor(vb.messages, (m) => m.op === "ready");
  assert.equal(readyB.voice[anaMid].c, vc.id);
  vb.send({ op: "vjoin", c: vc.id, st: {} });
  const r2 = await waitFor(vb.messages, (m) => m.op === "vready");
  assert.equal(r2.peers.length, 1);
  assert.equal(r2.peers[0].a, anaMid);
  await waitFor(va.messages, (m) => m.op === "voice" && m.a === boMid && m.c === vc.id);

  /* Offers, answers and ICE are relayed only to the named peer in the same call. */
  vb.send({ op: "rtc", to: anaMid, d: { t: "offer", sdp: "v=0 test" } });
  const got = await waitFor(va.messages, (m) => m.op === "rtc");
  assert.equal(got.from, boMid);
  assert.equal(got.d.sdp, "v=0 test");
  await sleep(60);
  assert.ok(!ui.messages.some((m) => m.op === "rtc"));
  assert.ok(!vb.messages.some((m) => m.op === "rtc"));

  /* State changes reach everyone; voice sockets skip chat events. */
  va.send({ op: "vstate", st: { mu: true, cam: true } });
  const muted = await waitFor(vb.messages, (m) => m.op === "voice" && m.a === anaMid && m.st.mu === true);
  assert.equal(muted.st.cam, true);
  const sent = await call(base + "/channels/" + made.body.channelId + "/messages", { method: "POST", token: O, body: { body: "chat only" } });
  assert.equal(sent.status, 200, sent.text);
  await waitFor(ui.messages, (m) => m.op === "event" && m.e.t === "msg");
  await sleep(60);
  assert.ok(!va.messages.some((m) => m.op === "event"));

  /* Members without Mute Members can't server-mute. */
  vb.send({ op: "vmod", a: anaMid, mu: true });
  await sleep(80);
  assert.ok(!va.messages.some((m) => m.op === "voice" && m.a === anaMid && m.st.sm));

  /* The owner joins and moderates. */
  const vo = await openSocket(O, sid, "198.51.100.60", true);
  await waitFor(vo.messages, (m) => m.op === "ready");
  vo.send({ op: "vjoin", c: vc.id, st: {} });
  const r3 = await waitFor(vo.messages, (m) => m.op === "vready");
  assert.equal(r3.peers.length, 2);
  vo.send({ op: "vmod", a: boMid, mu: true });
  const sm = await waitFor(vb.messages, (m) => m.op === "voice" && m.a === boMid && m.st.sm === true);
  assert.equal(sm.st.mu, true);
  /* A server mute sticks even if the client tries to clear it. */
  vb.send({ op: "vstate", st: { mu: false } });
  await sleep(80);
  const lastB = vb.messages.filter((m) => m.op === "voice" && m.a === boMid).pop();
  assert.equal(lastB.st.sm, true);
  vo.send({ op: "vmod", a: boMid, kick: true });
  const kicked = await waitFor(vb.messages, (m) => m.op === "verr");
  assert.equal(kicked.why, "kicked");
  await waitFor(ui.messages, (m) => m.op === "voice" && m.a === boMid && m.c === "");

  /* One voice connection per person: a second tab moves the first out. */
  const va2 = await openSocket(A, sid, "198.51.100.61", true);
  await waitFor(va2.messages, (m) => m.op === "ready");
  va2.send({ op: "vjoin", c: vc.id, st: {} });
  await waitFor(va2.messages, (m) => m.op === "vready");
  const moved = await waitFor(va.messages, (m) => m.op === "verr");
  assert.equal(moved.why, "moved");

  /* Join needs Connect; a channel overwrite can take it away. */
  const ow = await call(base + "/channels/" + vc.id + "/overrides/role/" + sid, { method: "PUT", token: O, body: { allow: 0, deny: PERM.CONNECT } });
  assert.equal(ow.status, 200, ow.text);
  {
    await sleep(80);
    const vb2 = await openSocket(B, sid, "198.51.100.62", true);
    await waitFor(vb2.messages, (m) => m.op === "ready");
    vb2.send({ op: "vjoin", c: vc.id, st: {} });
    const denied = await waitFor(vb2.messages, (m) => m.op === "verr");
    assert.equal(denied.why, "perm");
    vb2.ws.close();
  }

  /* Leaving and closing clear the roster. */
  va2.send({ op: "vleave" });
  await waitFor(ui.messages, (m) => m.op === "voice" && m.a === anaMid && m.c === "" && ui.messages.indexOf(m) > ui.messages.indexOf(moved));
  vo.ws.close();
  await waitFor(ui.messages, (m) => m.op === "voice" && m.a === ownerMid && m.c === "");
  for (const s of [va, vb, va2, ui]) { try { s.ws.close(); } catch (err) { /* closed */ } }
});
