/* Sharing pool. People who turned it on and are online at the same time
   pass each other public feed documents and app files they already have,
   so the server sends each version once instead of once per person.

   - Signaling is a WebSocket room on the Worker (JSON only), with the same
     room on the Render backup for when the Worker cannot be reached. Bytes
     move on WebRTC data channels with free STUN, never TURN, to at most 4
     peers.
   - Feed documents are taken from a peer only when a manifest the Worker
     signed names that SHA-256 for the version the pulse says is current.
     App files are taken only when this deploy's shell-manifest.json names
     that SHA-256. Every chunk and the whole item are checked; anything else
     is thrown away and the normal request answers.
   - A peer gets a head start of a few round trips at most, then the normal
     request starts too and the first good answer wins.
   - When our servers fail or stall (blocks, throttling), the newest copy a
     peer holds can answer instead. It still has to match a manifest the
     Worker signed, so a peer can delay an update but never fake one. Peers
     pass those signed manifests to each other, so news travels even when
     the change signal cannot be reached.
   - Cross-origin media is never shared: an opaque response cannot be read,
     so there is nothing to hash or pass on. */

import * as R from "./shared/peer-pool.js";

// Three unrelated free STUN services; the last one answers on port 443,
// which networks that block odd UDP ports usually leave open.
const STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302", "stun:stun.nextcloud.com:443"];
const ACCOUNT_KEY = "viktorychapp-account-v1";
const HIDE_GRACE_MS = 60000;
const STATS_EVERY_MS = 10 * 60 * 1000;
const GET_TIMEOUT_MS = 2000;
const SHELL_CACHE_POOL = "shell-pool";
const READY_TIMEOUT_MS = 8000;
const RESCUE_SLOW_MS = 4000;
const RESCUE_DEADLINE_MS = 8000;
const TROUBLE_MS = 10 * 60 * 1000;
const NEWS_EVERY_MS = 60000;
const MF_RATE = 30;

const S = {
  mode: "auto",
  facts: null,
  on: false,
  rescue: false,
  reason: "",
  rooms: new Map(),
  rescueAt: 0,
  trouble: 0,
  latest: new Map(),
  lastAt: new Map(),
  lastH: new Map(),
  newsAt: new Map(),
  links: new Map(),
  haves: new Map(),
  store: new Map(),
  storeBytes: 0,
  shell: new Map(),
  manifests: new Map(),
  used: new Set(),
  upload: { day: "", used: 0 },
  stats: { saved: 0, shared: 0, origin: 0, hits: 0, tries: 0, rejected: 0, rescued: 0 },
  unsent: { peer: 0, origin: 0, up: 0, hits: 0, tries: 0, rejected: 0 },
  reqSeq: 1,
  charging: null,
  hideTimer: 0,
  statsTimer: 0,
  backoff: 0
};

const scope = typeof window !== "undefined" ? window : globalThis;
const store = () => { try { return scope.localStorage || null; } catch (err) { return null; } };

function readJson(key, fallback) {
  try { const v = JSON.parse((store() && store().getItem(key)) || "null"); return v && typeof v === "object" ? v : fallback; }
  catch (err) { return fallback; }
}
function writeJson(key, value) {
  try { if (store()) store().setItem(key, JSON.stringify(value)); } catch (err) { /* memory still has it */ }
}

function loadPrefs() {
  const saved = readJson(R.POOL_KEY, {});
  S.mode = R.normalizeMode(saved.mode);
  const st = readJson(R.POOL_STATS_KEY, {});
  ["saved", "shared", "origin", "hits", "tries", "rejected", "rescued"].forEach((k) => { S.stats[k] = Math.max(0, Number(st[k]) || 0); });
  if (st.upload && typeof st.upload === "object") S.upload = { day: String(st.upload.day || ""), used: Number(st.upload.used) || 0 };
}
function saveStats() {
  writeJson(R.POOL_STATS_KEY, Object.assign({}, S.stats, { upload: S.upload }));
}

function session() {
  const s = readJson(ACCOUNT_KEY, null);
  return s && s.token ? s : null;
}
function isOwner() {
  const s = session();
  return !!(s && s.account && s.account.owner);
}
function saveDataOn() {
  const doc = scope.document && scope.document.documentElement;
  if (doc && (doc.classList.contains("save-data") || doc.dataset.saveData === "on")) return true;
  const ds = scope.ViktorychDataSaver;
  if (ds && typeof ds.isOn === "function") { try { if (ds.isOn()) return true; } catch (err) { /* fall through */ } }
  try { if (scope.matchMedia && scope.matchMedia("(prefers-reduced-data: reduce)").matches) return true; } catch (err) { /* fall through */ }
  return false;
}
function tvOn() {
  const doc = scope.document && scope.document.documentElement;
  return !!(doc && (doc.classList.contains("tv-on") || doc.classList.contains("tv-mode")));
}
function facts() {
  const nav = scope.navigator || {};
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  return R.poolFacts(conn, { ua: nav.userAgent || "", saveData: saveDataOn() || !!conn.saveData, tv: tvOn(), charging: S.charging });
}
function visible() {
  return !scope.document || scope.document.visibilityState !== "hidden";
}

function troubled() {
  return !!S.trouble && Date.now() - S.trouble < TROUBLE_MS;
}

function evaluate() {
  S.facts = facts();
  const d = R.poolEnabled(S.mode, S.facts);
  S.reason = d.reason;
  const signedIn = !!session();
  S.on = d.on && signedIn;
  // Rescue only downloads: it never uploads, and it starts only while our
  // servers keep failing. On mobile data it needs the switch set to On.
  S.rescue = !S.on && signedIn && R.poolRescue(S.mode, S.facts, troubled());
  if (!signedIn) S.reason = "signedOut";
  syncRooms();
  return S.on;
}

/* ---------- signaling ---------- */

function apiBase() {
  const a = scope.ViktorychAccounts;
  const live = a && a.currentApi ? a.currentApi() : "";
  const saved = scope.VIKTORYCH_ACCOUNTS ? scope.VIKTORYCH_ACCOUNTS.api : "";
  return String(live || saved || "").replace(/\/$/, "");
}

/* The Worker first, then the Render backup. Both rooms run the same rules
   and accept tickets from the same database. */
function roots() {
  const a = scope.ViktorychAccounts;
  let list = [];
  try { list = a && a.apiEndpoints ? a.apiEndpoints() : []; } catch (err) { list = []; }
  const first = apiBase();
  if (first && list.indexOf(first) === -1) list.unshift(first);
  return list.map((u) => String(u || "").replace(/\/$/, "")).filter((u, i, all) => /^https?:\/\//.test(u) && all.indexOf(u) === i).slice(0, 2);
}

function wantedRoots() {
  const all = roots();
  if (!visible() || !all.length) return [];
  // Sharing devices sit in both rooms, so a reader who only reaches the
  // backup still finds someone with fresh copies.
  if (S.on) return all;
  if (!S.rescue) return [];
  const open = all.find((root) => { const r = S.rooms.get(root); return r && r.id; });
  return [open || all[S.rescueAt % all.length]];
}

function syncRooms() {
  const want = wantedRoots();
  S.rooms.forEach((room, root) => { if (want.indexOf(root) === -1) closeRoom(room); });
  want.forEach((root) => { if (!S.rooms.has(root)) openRoom(root); });
  if (!want.length) dropAll();
}

function join() { syncRooms(); }

function retryRoom(room, ms) {
  if (S.rooms.get(room.root) !== room) return;
  S.rooms.delete(room.root);
  if (!room.id) S.rescueAt += 1;
  room.backoff = Math.min(120000, (room.backoff || ms) * 2);
  roomBackoff.set(room.root, room.backoff);
  setTimeout(syncRooms, room.backoff);
}
const roomBackoff = new Map();

async function openRoom(root) {
  const s = session();
  if (!s) return;
  const room = { root: root, ws: null, id: "", backoff: roomBackoff.get(root) || 0 };
  S.rooms.set(root, room);
  try {
    const res = await fetch(root + "/v1/media/swarm/ticket", { method: "POST", headers: { Authorization: "Bearer " + s.token, "content-type": "application/json" }, body: "{}", credentials: "omit", signal: timeoutSignal(READY_TIMEOUT_MS) });
    if (!res.ok) throw new Error("ticket");
    const body = await res.json();
    if (!body || !body.ticket || S.rooms.get(root) !== room) throw new Error("ticket");
    const ws = new WebSocket(root.replace(/^http/i, "ws") + "/v1/pool/room?ticket=" + encodeURIComponent(body.ticket));
    room.ws = ws;
    const ready = setTimeout(() => { if (!room.id) { try { ws.close(); } catch (err) { /* closed */ } } }, READY_TIMEOUT_MS);
    ws.onmessage = (ev) => onRoom(room, ev.data);
    ws.onclose = () => {
      clearTimeout(ready);
      dropRoomLinks(room);
      if (S.rooms.get(root) === room) retryRoom(room, room.id ? 3000 : 5000);
    };
  } catch (err) {
    retryRoom(room, 5000);
  }
}

function timeoutSignal(ms) {
  try { return AbortSignal.timeout(ms); } catch (err) { return undefined; }
}

function closeRoom(room) {
  if (S.rooms.get(room.root) === room) S.rooms.delete(room.root);
  const ws = room.ws;
  room.ws = null;
  if (ws) { try { if (ws.readyState === 1) ws.send(JSON.stringify({ op: "bye" })); ws.close(); } catch (err) { /* closed */ } }
  dropRoomLinks(room);
}

function leave() {
  flushStats();
  Array.from(S.rooms.values()).forEach(closeRoom);
  dropAll();
}

function openRooms() {
  return Array.from(S.rooms.values()).filter((r) => r.id && r.ws && r.ws.readyState === 1);
}

function roomSend(body, only) {
  let sent = false;
  (only ? [only] : openRooms()).forEach((room) => {
    if (!room || !room.ws || room.ws.readyState !== 1) return;
    try { room.ws.send(JSON.stringify(body)); sent = true; } catch (err) { /* closing */ }
  });
  return sent;
}

function selfIds() {
  return new Set(Array.from(S.rooms.values()).map((r) => r.id).filter(Boolean));
}

function onRoom(room, raw) {
  let msg = null;
  try { msg = JSON.parse(raw); } catch (err) { return; }
  if (!msg || typeof msg !== "object") return;
  if (msg.op === "ready") {
    room.id = String(msg.id || "");
    room.backoff = 0;
    roomBackoff.delete(room.root);
    announceAll(room);
    const list = (Array.isArray(msg.peers) ? msg.peers : []).filter((id) => /^[a-f0-9]{8,32}$/.test(id));
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
    list.slice(0, R.MAX_PEERS).forEach((id) => openLink(id, true, room));
    return;
  }
  if (msg.op === "peer") {
    announceAll(room);
    // A reader in rescue does not announce anything, so reach out to new
    // peers instead of waiting to hear what they have.
    if (S.rescue && msg.id && S.links.size < R.MAX_PEERS) openLink(String(msg.id), true, room);
    return;
  }
  if (msg.op === "have" && msg.from) {
    const from = String(msg.from);
    let set = S.haves.get(from);
    if (!set || msg.reset) { set = new Map(); S.haves.set(from, set); }
    (msg.items || []).forEach((it) => { if (it && /^[a-f0-9]{64}$/.test(it.h)) set.set(it.h, Number(it.size) || 0); });
    if (!S.links.has(from) && S.links.size < R.MAX_PEERS && (wantsAny(set) || S.rescue)) openLink(from, true, room);
    return;
  }
  if (msg.op === "signal" && msg.from) { takeSignal(String(msg.from), msg.signal, room); return; }
  if (msg.op === "bye" && msg.from) { dropLink(String(msg.from)); S.haves.delete(String(msg.from)); }
}

function wantsAny(set) {
  for (const entry of S.manifests.values()) if (set.has(entry.h) && !S.store.has(entry.h)) return true;
  return false;
}

/* ---------- WebRTC links ---------- */

function rtc() { return scope._origRTCPeerConnection || scope.RTCPeerConnection || null; }

function openLink(id, offer, room) {
  if (!id || !room || selfIds().has(id) || S.links.has(id) || S.links.size >= R.MAX_PEERS) return null;
  const Ctor = rtc();
  if (!Ctor) return null;
  let pc;
  try { pc = new Ctor({ iceServers: [{ urls: STUN }], iceTransportPolicy: "all" }); } catch (err) { return null; }
  const link = { id: id, room: room, pc: pc, ch: null, rtt: 0, wait: new Map(), bad: 0, mf: { at: 0, n: 0 } };
  S.links.set(id, link);
  pc.onicecandidate = (ev) => {
    if (!ev || !ev.candidate || !ev.candidate.candidate || /typ relay/i.test(ev.candidate.candidate)) return;
    roomSend({ op: "signal", to: id, signal: { type: "ice", candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid || "", sdpMLineIndex: ev.candidate.sdpMLineIndex } }, room);
  };
  pc.ondatachannel = (ev) => bindChannel(link, ev.channel);
  pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") dropLink(id); };
  if (offer) {
    bindChannel(link, pc.createDataChannel("pool", { ordered: true }));
    pc.createOffer().then((d) => pc.setLocalDescription(d)).then(() => {
      roomSend({ op: "signal", to: id, signal: { type: "offer", sdp: pc.localDescription && pc.localDescription.sdp } }, room);
    }).catch(() => dropLink(id));
  }
  setTimeout(() => { const l = S.links.get(id); if (l === link && (!l.ch || l.ch.readyState !== "open")) dropLink(id); }, 15000);
  return link;
}

async function takeSignal(from, signal, room) {
  const clean = R.cleanPoolSignal(signal);
  if (!clean) return;
  let link = S.links.get(from);
  if (link && link.room !== room) return;
  if (!link) {
    if (clean.type !== "offer") return;
    link = openLink(from, false, room);
    if (!link) return;
  }
  try {
    if (clean.type === "offer") {
      await link.pc.setRemoteDescription({ type: "offer", sdp: clean.sdp });
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      roomSend({ op: "signal", to: from, signal: { type: "answer", sdp: link.pc.localDescription && link.pc.localDescription.sdp } }, room);
    } else if (clean.type === "answer") {
      await link.pc.setRemoteDescription({ type: "answer", sdp: clean.sdp });
    } else if (clean.type === "ice") {
      if (!link.pc.remoteDescription) { (link.early = link.early || []).push(clean); return; }
      await link.pc.addIceCandidate({ candidate: clean.candidate, sdpMid: clean.sdpMid || null, sdpMLineIndex: Number.isInteger(clean.sdpMLineIndex) ? clean.sdpMLineIndex : 0 });
    }
    if (link.early && link.pc.remoteDescription) {
      const early = link.early; link.early = null;
      for (const c of early) await link.pc.addIceCandidate({ candidate: c.candidate, sdpMid: c.sdpMid || null, sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : 0 }).catch(() => {});
    }
  } catch (err) {
    dropLink(from);
  }
}

function bindChannel(link, ch) {
  link.ch = ch;
  ch.binaryType = "arraybuffer";
  ch.onopen = () => { ping(link); pushManifests(link); };
  ch.onmessage = (ev) => onPeer(link, ev.data);
  ch.onclose = () => { if (link.ch === ch) dropLink(link.id); };
  if (ch.readyState === "open") { ping(link); pushManifests(link); }
}

function ping(link) {
  try { link.ch.send(JSON.stringify({ op: "ping", t: Date.now() })); } catch (err) { /* closed */ }
}

function dropLink(id) {
  const link = S.links.get(id);
  if (!link) return;
  S.links.delete(id);
  link.wait.forEach((w) => w.done(null));
  link.wait.clear();
  try { if (link.ch) link.ch.close(); } catch (err) { /* closed */ }
  try { link.pc.close(); } catch (err) { /* closed */ }
}

function dropRoomLinks(room) {
  S.links.forEach((link, id) => { if (link.room === room) { dropLink(id); S.haves.delete(id); } });
}

function dropAll() {
  Array.from(S.links.keys()).forEach(dropLink);
  S.haves.clear();
}

function openLinks() {
  return Array.from(S.links.values()).filter((l) => l.ch && l.ch.readyState === "open" && l.bad < 2);
}

/* ---------- serving ---------- */

async function bytesFor(h) {
  const held = S.store.get(h);
  if (held) return held.bytes;
  const shell = S.shell.get(h);
  if (!shell || typeof caches === "undefined") return null;
  try {
    const res = await (await caches.open(shell.cache)).match(shell.url);
    if (!res || res.type === "opaque") return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await R.sha256Hex(bytes)) !== h) { S.shell.delete(h); return null; }
    return bytes;
  } catch (err) { return null; }
}

async function serve(link, msg) {
  const r = Number(msg.r) >>> 0;
  const h = String(msg.h || "");
  const o = Math.max(0, Number(msg.o) || 0);
  const n = Math.min(R.CHUNK, Math.max(1, Number(msg.n) || R.CHUNK));
  const miss = () => { try { link.ch.send(JSON.stringify({ op: "miss", r: r })); } catch (err) { /* closed */ } };
  if (!S.on || !/^[a-f0-9]{64}$/.test(h) || !link.ch || link.ch.readyState !== "open" || link.ch.bufferedAmount > 1024 * 1024) return miss();
  const bytes = await bytesFor(h);
  if (!bytes || o >= bytes.byteLength) return miss();
  const part = bytes.subarray(o, Math.min(o + n, bytes.byteLength));
  const ok = R.admitUpload(S.upload, part.byteLength, Date.now());
  if (!ok.ok) return miss();
  S.upload = ok.state;
  const out = new Uint8Array(4 + part.byteLength);
  new DataView(out.buffer).setUint32(0, r);
  out.set(part, 4);
  try { link.ch.send(out); } catch (err) { return; }
  S.stats.shared += part.byteLength;
  S.unsent.up += part.byteLength;
  saveStatsSoon();
}

function onPeer(link, data) {
  if (typeof data === "string") {
    let msg = null;
    try { msg = JSON.parse(data); } catch (err) { return; }
    if (!msg) return;
    if (msg.op === "ping") { try { link.ch.send(JSON.stringify({ op: "pong", t: msg.t })); } catch (err) { /* closed */ } return; }
    if (msg.op === "pong") { const rtt = Date.now() - Number(msg.t); if (rtt >= 0 && rtt < 10000) link.rtt = link.rtt ? Math.round(link.rtt * 0.7 + rtt * 0.3) : rtt; return; }
    if (msg.op === "get") { serve(link, msg); return; }
    if (msg.op === "mf") { takeManifest(link, msg.e); return; }
    if (msg.op === "want") { offerManifest(link, String(msg.k || "")); return; }
    if (msg.op === "miss") { const w = link.wait.get(Number(msg.r) >>> 0); if (w) w.done(null); }
    return;
  }
  const buf = data instanceof ArrayBuffer ? data : null;
  if (!buf || buf.byteLength < 4) return;
  const r = new DataView(buf).getUint32(0);
  const w = link.wait.get(r);
  if (w) w.done(new Uint8Array(buf, 4));
}

/* ---------- fetching from peers ---------- */

function askChunk(link, h, o, n) {
  return new Promise((resolve) => {
    const r = (S.reqSeq = (S.reqSeq + 1) >>> 0 || 1);
    const timer = setTimeout(() => done(null), GET_TIMEOUT_MS);
    const done = (bytes) => { clearTimeout(timer); link.wait.delete(r); resolve(bytes); };
    link.wait.set(r, { done: done });
    try { link.ch.send(JSON.stringify({ op: "get", r: r, h: h, o: o, n: n })); } catch (err) { done(null); }
  });
}

function holders(h) {
  return openLinks().filter((l) => { const set = S.haves.get(l.id); return set && set.has(h); }).sort((a, b) => (a.rtt || 999) - (b.rtt || 999));
}

/* Pulls one item from the peers that have it, chunk by chunk. Returns the
   verified bytes, or null on a miss, a timeout or a bad hash. */
async function pullItem(h, size, chunks, signal) {
  const from = holders(h);
  if (!from.length || !size || size > R.ITEM_MAX) return null;
  const count = R.chunkCount(size);
  const parts = new Array(count);
  let failed = false;
  const one = async (i, tries) => {
    if (failed || (signal && signal.stop)) return;
    const link = from[(i + tries) % from.length];
    const o = i * R.CHUNK;
    const n = Math.min(R.CHUNK, size - o);
    const bytes = await askChunk(link, h, o, n);
    let ok = !!bytes && bytes.byteLength === n;
    if (ok && chunks) ok = (await R.sha256Hex(bytes)).slice(0, 32) === chunks[i];
    if (!ok) {
      if (bytes) { link.bad += 1; S.stats.rejected += bytes ? 1 : 0; S.unsent.rejected += 1; }
      if (tries + 1 < Math.min(2, from.length)) return one(i, tries + 1);
      failed = true;
      return;
    }
    parts[i] = bytes;
  };
  const lanes = [];
  let next = 0;
  const lane = async () => { while (!failed && next < count) await one(next++, 0); };
  for (let k = 0; k < Math.min(count, from.length * 2); k++) lanes.push(lane());
  await Promise.all(lanes);
  if (failed || (signal && signal.stop)) return null;
  const all = new Uint8Array(size);
  let at = 0;
  parts.forEach((p) => { all.set(p, at); at += p.byteLength; });
  if ((await R.sha256Hex(all)) !== h) {
    from.forEach((l) => { l.bad += 1; });
    S.stats.rejected += 1;
    S.unsent.rejected += 1;
    return null;
  }
  return all;
}

function bestRtt(h) {
  const list = holders(h);
  return list.length ? list[0].rtt : 0;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* Keeps verified bytes so they can be passed on. */
function keep(h, bytes, key) {
  if (!bytes || bytes.byteLength > R.ITEM_MAX || S.store.has(h)) return;
  if (key) S.store.forEach((v, k) => { if (v.key === key && k !== h) { S.store.delete(k); S.storeBytes -= v.bytes.byteLength; } });
  while (S.storeBytes + bytes.byteLength > R.STORE_MAX && S.store.size) {
    const oldest = S.store.keys().next().value;
    S.storeBytes -= S.store.get(oldest).bytes.byteLength;
    S.store.delete(oldest);
  }
  S.store.set(h, { bytes: bytes, key: key || "" });
  S.storeBytes += bytes.byteLength;
  if (S.on) roomSend({ op: "have", items: [{ h: h, size: bytes.byteLength }] });
}

function announceAll(room) {
  if (!S.on) return;
  const items = [];
  S.store.forEach((v, h) => items.push({ h: h, size: v.bytes.byteLength }));
  S.shell.forEach((v, h) => items.push({ h: h, size: v.size }));
  for (let i = 0; i < items.length; i += 24) roomSend({ op: "have", items: items.slice(i, i + 24), reset: i === 0 }, room);
}

/* ---------- signed manifests between peers ---------- */

function newestEntry(key) {
  const a = S.manifests.get(key);
  const b = S.latest.get(key);
  if (!a) return b || null;
  if (!b) return a;
  return Number(b.at) > Number(a.at) ? b : a;
}

function sendManifest(link, entry) {
  if (!entry || !link.ch || link.ch.readyState !== "open") return;
  try { link.ch.send(JSON.stringify({ op: "mf", e: entry })); } catch (err) { /* closed */ }
}

/* A sharing device tells each new link which versions it can pass on. */
function pushManifests(link) {
  if (!S.on) return;
  const keys = new Set();
  S.store.forEach((v) => { if (v.key) keys.add(v.key); });
  keys.forEach((key) => {
    const entry = newestEntry(key);
    if (entry && S.store.has(entry.h)) sendManifest(link, entry);
  });
}

function pushManifest(key) {
  const entry = newestEntry(key);
  if (!S.on || !entry || !S.store.has(entry.h)) return;
  openLinks().forEach((link) => sendManifest(link, entry));
}

function offerManifest(link, key) {
  if (!S.on || !R.POOL_DATA_KEYS.test(key)) return;
  const entry = newestEntry(key);
  if (entry && S.store.has(entry.h)) sendManifest(link, entry);
}

async function takeManifest(link, entry) {
  const now = Date.now();
  if (now - link.mf.at > 60000) link.mf = { at: now, n: 0 };
  link.mf.n += 1;
  if (link.mf.n > MF_RATE) return;
  if (!entry || typeof entry !== "object" || !R.POOL_DATA_KEYS.test(String(entry.key || "")) || !/^[a-f0-9]{64}$/.test(String(entry.h || ""))) return;
  const known = newestEntry(entry.key);
  const same = known && known.h === entry.h;
  if (!same && !(await R.verifyManifest(entry, scope.__viktorychPoolTestJwk || undefined))) { link.bad += 1; return; }
  let set = S.haves.get(link.id);
  if (!set) { set = new Map(); S.haves.set(link.id, set); }
  set.set(entry.h, same ? Number(known.size) || 0 : Number(entry.size) || 0);
  if (same) return;
  const prev = S.latest.get(entry.key);
  if (!prev || Number(entry.at) > Number(prev.at)) S.latest.set(entry.key, entry);
  maybeNews(entry.key);
}

/* A newer signed version than the copy this tab has, while the change
   signal is out of reach: tell the app so it reads again. */
function newerThanMine(key) {
  const entry = newestEntry(key);
  if (!entry) return null;
  if (S.lastH.get(key) === entry.h) return null;
  if (Number(entry.at) <= (S.lastAt.get(key) || 0)) return null;
  return entry;
}

function maybeNews(key) {
  if (!S.used.has(key) || pulseMark(key)) return;
  if (!newerThanMine(key)) return;
  const at = S.newsAt.get(key) || 0;
  if (Date.now() - at < NEWS_EVERY_MS) return;
  S.newsAt.set(key, Date.now());
  emit("viktorych-pool-news", { key: key });
}

function emit(name, detail) {
  try { scope.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (err) { /* old browser */ }
}

function remember(key, h, at) {
  S.lastH.set(key, h);
  S.lastAt.set(key, Math.max(S.lastAt.get(key) || 0, Number(at) || 0));
}

/* ---------- feed documents ---------- */

function pulseMark(key) {
  const p = scope.ViktorychPulse;
  return p && p.ok && p.ok() ? String(p.version(key) || "") : "";
}

function manifestBase() {
  const p = scope.ViktorychPulse;
  const src = (p && p.url && p.url()) || "";
  return src ? src.replace(/pulse\/v1\.json(?:\?.*)?$/, "") : "";
}

const loading = new Map();
async function loadManifest(key) {
  const mark = pulseMark(key);
  const have = S.manifests.get(key);
  if (!mark || (have && have.mark === mark)) return have || null;
  if (loading.has(key)) return loading.get(key);
  const base = manifestBase();
  if (!base) return null;
  const task = (async () => {
    try {
      const res = await fetch(base + R.manifestObjectName(key), { cache: "no-cache", credentials: "omit", mode: "cors" });
      if (!res.ok) return null;
      const entry = await res.json();
      if (!entry || entry.key !== key || !(await R.verifyManifest(entry, scope.__viktorychPoolTestJwk || undefined))) return null;
      S.manifests.set(key, entry);
      return entry;
    } catch (err) { return null; }
    finally { loading.delete(key); }
  })();
  loading.set(key, task);
  return task;
}

function learnFrom(key, res) {
  if (!res || !res.ok || !res.clone) return res;
  const fetchedAt = Date.now();
  const copy = res.clone();
  copy.arrayBuffer().then(async (buf) => {
    const bytes = new Uint8Array(buf);
    if (!bytes.byteLength || bytes.byteLength > R.ITEM_MAX) return;
    // Not sharing: just note when this copy arrived, without extra reads.
    if (!S.on && !S.rescue) { remember(key, "", fetchedAt); return; }
    if (S.on) { S.stats.origin += bytes.byteLength; S.unsent.origin += bytes.byteLength; saveStatsSoon(); }
    const h = await R.sha256Hex(bytes);
    let entry = S.manifests.get(key);
    // The Worker signs a new version while answering the first reader, so
    // look again shortly when the manifest does not know these bytes yet.
    if (!entry || entry.h !== h) { await sleep(2500); entry = await loadManifest(key); }
    if (!entry || entry.h !== h) { const other = S.latest.get(key); if (other && other.h === h) entry = other; }
    remember(key, h, entry && entry.h === h ? entry.at : fetchedAt);
    if (entry && entry.h === h && S.on) { keep(h, bytes, key); pushManifest(key); }
  }).catch(() => {});
  return res;
}

/* True when this read can try the pool. */
function wants(key) {
  if (isOwner() || !R.POOL_DATA_KEYS.test(String(key || ""))) return false;
  // Signed in and not switched off: a failing read may start rescue.
  const f = S.facts || {};
  return S.on || S.rescue || (S.mode !== "off" && !!session() && !f.saveData && !f.tv);
}

function noteTrouble(on) {
  const was = S.trouble;
  S.trouble = on ? Date.now() : 0;
  if (!!was !== !!S.trouble) evaluate();
}

function failedRead(r) {
  return !r || !!r.err || !r.res || r.res.status === 0 || r.res.status === 429 || r.res.status >= 500;
}

function finish(key, r) {
  if (r.err) throw r.err;
  return learnFrom(key, r.res);
}

function peerResponse(key, entry, bytes, how) {
  remember(key, entry.h, entry.at);
  // A reader in rescue is here only because the server keeps failing.
  if (how !== "self" && !S.on && S.rescue) how = "peer-rescue";
  if (how !== "self") {
    S.stats.hits += 1; S.unsent.hits += 1;
    S.stats.saved += bytes.byteLength; S.unsent.peer += bytes.byteLength;
    if (S.on) { keep(entry.h, bytes, key); pushManifest(key); }
  }
  if (how === "peer-rescue") S.stats.rescued += 1;
  saveStatsSoon();
  emit("viktorych-pool-delivered", { key: key, how: how });
  return new Response(bytes.slice(), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-pool": how } });
}

/* The manifest without the change signal, for when the signal is blocked
   but the public bucket is not. */
async function loadManifestDirect(key) {
  const base = manifestBase();
  if (!base) return null;
  try {
    const res = await fetch(base + R.manifestObjectName(key) + "?r=" + Math.floor(Date.now() / 30000), { cache: "no-cache", credentials: "omit", mode: "cors", signal: timeoutSignal(3000) });
    if (!res.ok) return null;
    const entry = await res.json();
    if (!entry || entry.key !== key || !(await R.verifyManifest(entry, scope.__viktorychPoolTestJwk || undefined))) return null;
    const prev = S.latest.get(key);
    if (!prev || Number(entry.at) > Number(prev.at)) S.latest.set(key, entry);
    return entry;
  } catch (err) { return null; }
}

function askLatest(key) {
  openLinks().forEach((link) => { try { link.ch.send(JSON.stringify({ op: "want", k: key })); } catch (err) { /* closed */ } });
}

/* The server failed or stalls: the newest signed copy a peer holds. */
async function rescue(key) {
  // Joining takes a few seconds, so the first failed read only starts it;
  // the next reads can use it.
  S.trouble = Date.now();
  if (!S.rescue && !S.on) evaluate();
  let entry = newerThanMine(key);
  if (!entry || !holders(entry.h).length) {
    // Ask the links for their newest signed copy, and the public bucket
    // for the manifest, then give the answers a moment to arrive.
    askLatest(key);
    loadManifestDirect(key);
    for (let waited = 0; waited < 1500; waited += 100) {
      await sleep(100);
      entry = newerThanMine(key);
      if (entry && (S.store.has(entry.h) || holders(entry.h).length)) break;
    }
  }
  if (!entry) return null;
  if (S.store.has(entry.h)) return peerResponse(key, entry, S.store.get(entry.h).bytes, "self");
  if (!holders(entry.h).length) return null;
  S.stats.tries += 1;
  S.unsent.tries += 1;
  const signal = { stop: false };
  const bytes = await Promise.race([pullItem(entry.h, entry.size, entry.c, signal), sleep(RESCUE_DEADLINE_MS).then(() => { signal.stop = true; return null; })]);
  return bytes ? peerResponse(key, entry, bytes, "peer-rescue") : null;
}

/* The normal read, with peers as the last fallback when it fails (after
   the backup server and every retry) or is still waiting after a few
   seconds. The first good answer wins. */
async function guarded(key, origin) {
  const net = Promise.resolve().then(origin).then((res) => ({ res: res }), (err) => ({ err: err }));
  const first = await Promise.race([net, sleep(RESCUE_SLOW_MS).then(() => null)]);
  if (first && !failedRead(first)) { if (S.trouble && !S.rescue) S.trouble = 0; return finish(key, first); }
  const saved = rescue(key);
  if (first) { const got = await saved; return got || finish(key, first); }
  const winner = await Promise.race([
    net.then((r) => (failedRead(r) ? saved.then((g) => g || r) : r)),
    saved.then((g) => g || net)
  ]);
  if (winner instanceof Response) return winner;
  return finish(key, winner);
}

/* origin() is the normal request. Returns a Response. */
async function fetchData(key, origin) {
  if (!wants(key)) return origin();
  S.used.add(key);
  if (!S.on && !S.rescue) return guarded(key, origin);
  const mark = pulseMark(key);
  let entry = S.manifests.get(key);
  // A new version: when peers are connected, give the manifest a brief
  // moment (it is one small public read), else go straight to the server.
  if ((!entry || entry.mark !== mark) && mark && openLinks().length) {
    entry = await Promise.race([loadManifest(key), sleep(150).then(() => null)]);
  }
  let current = entry && mark && entry.mark === mark ? entry : null;
  // No change signal: a newer version a peer vouched for with a signed
  // manifest is the version to look for.
  if (!current && !mark) current = newerThanMine(key);
  if (!current) {
    if (mark) loadManifest(key);
    return guarded(key, origin);
  }
  entry = current;
  if (S.store.has(entry.h)) return peerResponse(key, entry, S.store.get(entry.h).bytes, "self");
  if (!holders(entry.h).length) return guarded(key, origin);
  S.stats.tries += 1;
  S.unsent.tries += 1;
  const signal = { stop: false };
  const peer = Promise.race([pullItem(entry.h, entry.size, entry.c, signal), sleep(R.PEER_DEADLINE_MS).then(() => { signal.stop = true; return null; })]);
  const first = await Promise.race([peer, sleep(R.headStart(bestRtt(entry.h))).then(() => "late")]);
  if (first && first !== "late") return peerResponse(key, entry, first, "peer");
  if (first === null) return guarded(key, origin);
  // The peer is slower than its head start: the normal request runs too.
  // A failed server read waits for the peer instead of answering.
  let netFailed = false;
  const net = Promise.resolve().then(origin).then((res) => ({ res: res }), (err) => ({ err: err }));
  const result = await Promise.race([
    peer.then((b) => (b ? { peer: b } : net)),
    net.then((r) => {
      if (!failedRead(r)) return r;
      netFailed = true;
      return peer.then((b) => (b ? { peer: b } : r));
    })
  ]);
  if (result.peer) return peerResponse(key, entry, result.peer, netFailed ? "peer-rescue" : "peer-race");
  signal.stop = true;
  if (failedRead(result)) {
    const got = await rescue(key);
    if (got) return got;
  }
  return finish(key, result);
}

/* ---------- app files ---------- */

async function indexShell() {
  if (typeof caches === "undefined") return;
  let names = [];
  try { names = await caches.keys(); } catch (err) { return; }
  const next = new Map();
  for (const name of names) {
    if (name.indexOf("shell-") !== 0) continue;
    try {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        const h = res && res.headers.get("x-shell-sha256");
        const size = Number(res && res.headers.get("content-length")) || 0;
        if (!h || !/^[a-f0-9]{64}$/.test(h) || next.has(h)) continue;
        const len = size || (await res.clone().arrayBuffer()).byteLength;
        if (len >= R.SHELL_MIN && len <= R.ITEM_MAX) next.set(h, { cache: name, url: req.url, size: len });
      }
    } catch (err) { /* skip a cache that cannot be read */ }
  }
  S.shell = next;
  if (S.on) announceAll();
}

/* Before the service worker downloads a new version, fetch files from
   peers into the shell-pool cache, where its reuse step finds them by
   hash. It waits only while a peer has a file, at most SHELL_PREFILL_MS. */
async function prefillShell() {
  if (!S.on || !openLinks().length || typeof caches === "undefined") return 0;
  let manifest = null;
  try {
    const res = await fetch(new URL("shell-manifest.json", scope.document ? scope.document.baseURI : location.href).href + "?pool=" + Date.now(), { cache: "no-store", credentials: "omit" });
    manifest = res.ok ? await res.json() : null;
  } catch (err) { manifest = null; }
  if (!manifest || !manifest.files) return 0;
  const have = new Set(S.shell.keys());
  const want = [];
  Object.keys(manifest.files).forEach((path) => {
    const row = manifest.files[path];
    const h = Array.isArray(row) ? String(row[0] || "") : "";
    const size = Array.isArray(row) ? Number(row[1]) || 0 : 0;
    if (/^[a-f0-9]{64}$/.test(h) && size >= R.SHELL_MIN && size <= R.ITEM_MAX && !have.has(h) && holders(h).length) want.push({ path: path, h: h, size: size });
  });
  if (!want.length) return 0;
  const cache = await caches.open(SHELL_CACHE_POOL);
  const base = scope.navigator && scope.navigator.serviceWorker && scope.navigator.serviceWorker.controller ? new URL("./", scope.navigator.serviceWorker.controller.scriptURL).href : new URL("./", location.href).href;
  let got = 0;
  const signal = { stop: false };
  const work = Promise.all(want.map(async (row) => {
    S.stats.tries += 1; S.unsent.tries += 1;
    const bytes = await pullItem(row.h, row.size, null, signal);
    if (!bytes || signal.stop) return;
    const type = /\.css$/.test(row.path) ? "text/css" : /\.js$/.test(row.path) ? "text/javascript" : /\.json$/.test(row.path) ? "application/json" : "text/html";
    await cache.put(new URL(row.path, base).href, new Response(bytes, { status: 200, headers: { "content-type": type + "; charset=utf-8", "x-shell-sha256": row.h, "content-length": String(bytes.byteLength) } }));
    got += 1;
    S.stats.hits += 1; S.unsent.hits += 1;
    S.stats.saved += bytes.byteLength; S.unsent.peer += bytes.byteLength;
  }));
  await Promise.race([work, sleep(R.SHELL_PREFILL_MS)]);
  signal.stop = true;
  saveStatsSoon();
  return got;
}

/* ---------- stats ---------- */

let saveTimer = 0;
function saveStatsSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = 0; saveStats(); }, 1500);
}

function flushStats() {
  const u = S.unsent;
  if (!(u.peer || u.origin || u.up || u.hits || u.tries || u.rejected)) return;
  // Counters go to one room only, the Worker's when it is open; the owner
  // panel reads that one.
  const room = openRooms().sort((a, b) => roots().indexOf(a.root) - roots().indexOf(b.root))[0];
  if (room && roomSend(Object.assign({ op: "stats" }, u), room)) S.unsent = { peer: 0, origin: 0, up: 0, hits: 0, tries: 0, rejected: 0 };
  saveStats();
}

function stats() {
  return Object.assign({}, S.stats, { on: S.on, rescue: S.rescue, rooms: openRooms().length, mode: S.mode, reason: S.reason, peers: openLinks().length, uploadToday: S.upload.day === R.dayKey(Date.now()) ? S.upload.used : 0, uploadCap: R.UPLOAD_DAY_CAP });
}

function setMode(mode) {
  S.mode = R.normalizeMode(mode);
  writeJson(R.POOL_KEY, { mode: S.mode });
  return evaluate();
}

/* ---------- start ---------- */

function readBattery() {
  const nav = scope.navigator;
  if (!nav || !nav.getBattery) return;
  nav.getBattery().then((b) => {
    const set = () => { S.charging = !!b.charging; evaluate(); };
    set();
    b.addEventListener && b.addEventListener("chargingchange", set);
  }).catch(() => {});
}

function start() {
  if (!scope.document || scope.__viktorychPoolStarted) return;
  scope.__viktorychPoolStarted = true;
  loadPrefs();
  readBattery();
  evaluate();
  const nav = scope.navigator || {};
  const conn = nav.connection;
  if (conn && conn.addEventListener) conn.addEventListener("change", evaluate);
  scope.document.addEventListener("visibilitychange", () => {
    clearTimeout(S.hideTimer);
    if (!visible()) { flushStats(); S.hideTimer = setTimeout(leave, HIDE_GRACE_MS); }
    else if (evaluate()) join();
  });
  scope.addEventListener && scope.addEventListener("storage", (ev) => { if (ev.key === R.POOL_KEY || ev.key === ACCOUNT_KEY) { loadPrefs(); evaluate(); } });
  S.statsTimer = setInterval(flushStats, STATS_EVERY_MS);
  // Save data, TV mode and the charger can change without an event.
  setInterval(evaluate, 60000);
  const p = scope.ViktorychPulse;
  scope.addEventListener && scope.addEventListener("viktorych-api-trouble", (ev) => noteTrouble(!!(ev && ev.detail && ev.detail.on)));
  if (p && p.on) p.on((keys) => { (keys || []).forEach((k) => { if (S.on && S.used.has(k)) loadManifest(k); }); });
  setTimeout(indexShell, 4000);
}

const api = { wants, fetchData, prefillShell, stats, setMode, mode: () => S.mode, evaluate, indexShell, _state: S };
if (typeof window !== "undefined") {
  window.ViktorychPool = api;
  start();
}
export default api;
