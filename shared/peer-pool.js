/* Sharing pool: rules shared by the page, the Worker and the tests.
   Peers who opted in pass each other public feed documents and app files
   they already downloaded. Every item is content-addressed by its SHA-256.
   A feed document is only taken from a peer when a manifest signed by the
   Worker names that hash for the current version. App files are only taken
   when the deploy's shell-manifest.json (same origin) names that hash.
   Nothing private, no messages, no account data and no cross-origin media
   ever moves through the pool. */

export const POOL_ROOM = "main";
export const MAX_PEERS = 4;
export const CHUNK = 64 * 1024;
export const UPLOAD_DAY_CAP = 20 * 1024 * 1024;
export const STORE_MAX = 16 * 1024 * 1024;
export const ITEM_MAX = 6 * 1024 * 1024;
export const SHELL_MIN = 16 * 1024;
export const HEAD_START_MIN = 60;
export const HEAD_START_MAX = 250;
export const PEER_DEADLINE_MS = 2500;
export const SHELL_PREFILL_MS = 1500;
export const POOL_KEY = "viktorychapp-peer-pool-v1";
export const POOL_STATS_KEY = "viktorychapp-peer-pool-stats-v1";
/* The value the pool falls back to whenever data saving is on. */
export const POOL_DATA_SAVING_DEFAULT = "off";
/* Feed documents the Worker signs. Owner copies differ, so the owner only
   shares app files. */
export const POOL_DATA_KEYS = /^(?:feeds|stories|people|status|feeds\.config)\.json$|^data\/music\.json$|^archive\/(?:index|\d{4}-\d{2})\.json$/;
export const POOL_PUBLIC_JWK = { kty: "EC", crv: "P-256", x: "ZsSShgUc_CvKHYj9txhq2MDMY4tAMLSmylktqcrAMVM", y: "Ry4ska-YnyywAy9-Oc82uyOyxKKNyq5lvsHpLxDKny4" };

const HEX64 = /^[a-f0-9]{64}$/;
const PEER_ID = /^[a-f0-9]{8,32}$/;

export function normalizeMode(value) {
  if (value === true || value === "on") return "on";
  if (value === false || value === "off") return "off";
  return "auto";
}

/* Network and device facts the gate needs. connection is
   navigator.connection; extra carries ua, charging, tv and saveData. */
export function poolFacts(conn, extra) {
  const link = conn && typeof conn === "object" ? conn : {};
  const env = extra && typeof extra === "object" ? extra : {};
  const ua = String(env.ua || "");
  const type = String(link.type || "").toLowerCase();
  const effective = String(link.effectiveType || "").toLowerCase();
  const tv = !!env.tv || /\b(?:SmartTV|SMART-TV|GoogleTV|Android TV|AFT[A-Z0-9]|BRAVIA|Tizen|Web0S|webOS|HbbTV|CrKey)\b/i.test(ua);
  const phone = !tv && /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const desktop = typeof env.desktop === "boolean" ? env.desktop : (!phone && !tv && type !== "cellular");
  const saveData = !!(env.saveData || link.saveData);
  const cellular = type === "cellular" || type === "wimax" || type === "bluetooth";
  const metered = !!(cellular || link.metered || effective === "slow-2g" || effective === "2g");
  const wired = type === "wifi" || type === "ethernet";
  const unmetered = !metered && (wired || (desktop && !type));
  const charging = env.charging === true ? true : (env.charging === false ? false : null);
  return { tv: tv, phone: phone, desktop: desktop, saveData: saveData, cellular: cellular, metered: metered, unmetered: unmetered, charging: charging, type: type };
}

/* On or off for this device. Save data and cellular always win. Auto is on
   only on Wi-Fi or ethernet, unmetered, and on a charger or a desktop.
   TV mode is off unless the person turns it on. */
export function poolEnabled(mode, facts) {
  const m = normalizeMode(mode);
  const f = facts && typeof facts === "object" ? facts : {};
  if (f.saveData) return { on: false, reason: "saveData" };
  if (f.cellular || f.metered) return { on: false, reason: "cellular" };
  if (m === "off") return { on: false, reason: "off" };
  if (m === "on") return { on: true, reason: "on" };
  if (f.tv) return { on: false, reason: "tv" };
  if (!f.unmetered) return { on: false, reason: "network" };
  if (f.desktop || f.charging === true) return { on: true, reason: "auto" };
  return { on: false, reason: "battery" };
}

export function dayKey(now) {
  return new Date(Number(now) || Date.now()).toISOString().slice(0, 10);
}

/* Daily upload budget. state is { day, used }. */
export function admitUpload(state, bytes, now, cap) {
  const today = dayKey(now);
  const limit = Number(cap) > 0 ? Number(cap) : UPLOAD_DAY_CAP;
  const size = Math.max(0, Number(bytes) || 0);
  let s = state && typeof state === "object" && state.day === today ? { day: today, used: Number(state.used) || 0 } : { day: today, used: 0 };
  if (s.used + size > limit) return { ok: false, state: s };
  return { ok: true, state: { day: today, used: s.used + size } };
}

export function chunkCount(size) {
  const n = Number(size) || 0;
  return n > 0 ? Math.ceil(n / CHUNK) : 0;
}

export function bytesOf(value) {
  if (!value) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return new TextEncoder().encode(value);
  return new Uint8Array(0);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", bytesOf(value));
  const raw = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < raw.length; i++) out += raw[i].toString(16).padStart(2, "0");
  return out;
}

export async function chunkHashes(value) {
  const bytes = bytesOf(value);
  const out = [];
  for (let at = 0; at < bytes.byteLength; at += CHUNK) out.push((await sha256Hex(bytes.subarray(at, Math.min(at + CHUNK, bytes.byteLength)))).slice(0, 32));
  return out;
}

/* The exact text a manifest signature covers. */
export function manifestText(entry) {
  const e = entry || {};
  return ["vk-pool-v1", String(e.key || ""), String(e.mark || ""), String(e.h || ""), String(Number(e.size) || 0), String(Number(e.at) || 0), (Array.isArray(e.c) ? e.c : []).join(",")].join("\n");
}

export function manifestShape(entry) {
  const e = entry && typeof entry === "object" ? entry : null;
  if (!e || e.v !== 1) return false;
  if (!POOL_DATA_KEYS.test(String(e.key || ""))) return false;
  if (!/^[A-Za-z0-9._:-]{4,80}$/.test(String(e.mark || ""))) return false;
  if (!HEX64.test(String(e.h || ""))) return false;
  const size = Number(e.size);
  if (!Number.isInteger(size) || size < 1 || size > ITEM_MAX) return false;
  if (!Array.isArray(e.c) || e.c.length !== chunkCount(size)) return false;
  for (let i = 0; i < e.c.length; i++) if (!/^[a-f0-9]{32}$/.test(String(e.c[i]))) return false;
  return typeof e.sig === "string" && /^[A-Za-z0-9_-]{60,120}$/.test(e.sig);
}

function b64urlBytes(text) {
  const pad = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "===".slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64url(bytes) {
  const raw = bytesOf(bytes);
  let text = "";
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const SIGN = { name: "ECDSA", hash: "SHA-256" };
const CURVE = { name: "ECDSA", namedCurve: "P-256" };
let publicKey = null;

export async function verifyManifest(entry, jwk) {
  if (!manifestShape(entry)) return false;
  try {
    const key = jwk ? await crypto.subtle.importKey("jwk", jwk, CURVE, false, ["verify"])
      : (publicKey || (publicKey = await crypto.subtle.importKey("jwk", POOL_PUBLIC_JWK, CURVE, false, ["verify"])));
    return await crypto.subtle.verify(SIGN, key, b64urlBytes(entry.sig), new TextEncoder().encode(manifestText(entry)));
  } catch (err) {
    return false;
  }
}

export async function signManifest(entry, privateJwk) {
  const key = await crypto.subtle.importKey("jwk", privateJwk, CURVE, false, ["sign"]);
  const sig = await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(manifestText(entry)));
  return Object.assign({}, entry, { sig: b64url(new Uint8Array(sig)) });
}

/* Builds the signed manifest entry for one document's public bytes. */
export async function buildManifest(key, mark, text, at, privateJwk) {
  const bytes = bytesOf(text);
  const entry = { v: 1, key: key, mark: String(mark || ""), h: await sha256Hex(bytes), size: bytes.byteLength, at: Number(at) || Date.now(), c: await chunkHashes(bytes) };
  return signManifest(entry, privateJwk);
}

export function manifestObjectName(key) {
  return "pool/v1/" + String(key || "").replace(/[^A-Za-z0-9._-]/g, "_");
}

/* How long the peer gets before the normal request also starts. It follows
   the measured round trip to the fastest peer that has the item and is
   never more than HEAD_START_MAX. */
export function headStart(rttMs) {
  const rtt = Number(rttMs);
  if (!Number.isFinite(rtt) || rtt <= 0) return HEAD_START_MIN;
  return Math.max(HEAD_START_MIN, Math.min(HEAD_START_MAX, Math.round(rtt * 3)));
}

/* Messages a pool room accepts from a socket. Bytes never pass the Worker. */
export function acceptPoolMessage(raw) {
  let msg = raw;
  if (typeof msg === "string") {
    try { msg = JSON.parse(msg); } catch (err) { return null; }
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const op = String(msg.op || "");
  if (op === "hello" || op === "bye") return { op: op };
  if (op === "have") {
    const items = Array.isArray(msg.items) ? msg.items : [];
    const clean = [];
    for (let i = 0; i < items.length && clean.length < 24; i++) {
      const it = items[i] || {};
      const h = String(it.h || "").toLowerCase();
      const size = Number(it.size);
      if (!HEX64.test(h) || !Number.isInteger(size) || size < 1 || size > ITEM_MAX) continue;
      clean.push({ h: h, size: size });
    }
    return clean.length ? { op: "have", items: clean, reset: msg.reset === true } : null;
  }
  if (op === "signal") {
    const to = String(msg.to || "").toLowerCase();
    if (!PEER_ID.test(to)) return null;
    const signal = cleanPoolSignal(msg.signal);
    return signal ? { op: "signal", to: to, signal: signal } : null;
  }
  if (op === "stats") {
    const n = (v, max) => { const x = Math.floor(Number(v) || 0); return x > 0 ? Math.min(x, max) : 0; };
    const out = { op: "stats", peer: n(msg.peer, 2e9), origin: n(msg.origin, 2e9), up: n(msg.up, 2e9), hits: n(msg.hits, 1e5), tries: n(msg.tries, 1e5), rejected: n(msg.rejected, 1e5) };
    return out.peer || out.origin || out.up || out.hits || out.tries || out.rejected ? out : null;
  }
  return null;
}

/* Only a handshake's own fields, and never a relay candidate. */
export function cleanPoolSignal(signal) {
  if (!signal || typeof signal !== "object") return null;
  const type = String(signal.type || "");
  if (type === "offer" || type === "answer") {
    const sdp = String(signal.sdp || "").split(/\r?\n/).filter((line) => line && !/typ relay/i.test(line)).join("\r\n");
    if (!/^v=0/.test(sdp) || sdp.length > 6000) return null;
    return { type: type, sdp: sdp + "\r\n" };
  }
  if (type === "ice") {
    const candidate = String(signal.candidate || "");
    if (!candidate || candidate.length > 600 || /typ relay/i.test(candidate)) return null;
    const out = { type: "ice", candidate: candidate };
    if (typeof signal.sdpMid === "string" && signal.sdpMid.length <= 16) out.sdpMid = signal.sdpMid;
    if (Number.isInteger(signal.sdpMLineIndex) && signal.sdpMLineIndex >= 0 && signal.sdpMLineIndex < 8) out.sdpMLineIndex = signal.sdpMLineIndex;
    return out;
  }
  return null;
}

/* Owner panel numbers from the per-day totals the room keeps. */
export function poolSummary(days) {
  const list = Array.isArray(days) ? days : [];
  let peer = 0, origin = 0, hits = 0, tries = 0, up = 0, rejected = 0;
  list.forEach((d) => {
    peer += Number(d.peer) || 0; origin += Number(d.origin) || 0; hits += Number(d.hits) || 0;
    tries += Number(d.tries) || 0; up += Number(d.up) || 0; rejected += Number(d.rejected) || 0;
  });
  const total = peer + origin;
  return { days: list.length, peerBytes: peer, originBytes: origin, uploaded: up, hits: hits, tries: tries, rejected: rejected, hitRate: tries ? hits / tries : 0, byteShare: total ? peer / total : 0 };
}

const api = { POOL_ROOM, MAX_PEERS, CHUNK, UPLOAD_DAY_CAP, POOL_DATA_SAVING_DEFAULT, POOL_DATA_KEYS, normalizeMode, poolFacts, poolEnabled, admitUpload, headStart, verifyManifest, manifestShape, poolSummary, acceptPoolMessage };
if (typeof window !== "undefined" && !window.ViktorychPoolRules) window.ViktorychPoolRules = api;
