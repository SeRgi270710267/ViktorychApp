/* Peer-assisted media decisions.
   A small mesh, not WebTorrent and not p2p-media-loader: no public
   trackers, no piece map, no background seeding, and no bundle step.
   Signaling is JSON only. Media bytes move on WebRTC data channels.
   Origin bytes stay the source of truth. */

export const STUN_URLS = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];
export const UPLOAD_DEFAULT = 65536;
export const UPLOAD_CAPS = [32768, 65536, 131072, 262144];
export const PEER_TIMEOUT_MS = 600;
export const LIVE_PEER_TIMEOUT_MS = 400;
export const SEED_MAX = 8 * 1024 * 1024;
export const STORE_MAX = 24 * 1024 * 1024;
export const MIN_FILE_BYTES = 256 * 1024;
const MEDIA_EXT = /\.(m4s|ts|cmfv|cmfa|mp4|webm|m4v)$/i;
const SEGMENT_EXT = /\.(m4s|ts|cmfv|cmfa)$/i;
const HEX64 = /^[a-f0-9]{64}$/;
const PEER_ID = /^[a-f0-9]{8,32}$/;

export function bytesOf(value) {
  if (!value) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(0);
}

export async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : bytesOf(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const raw = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < raw.length; i++) out += raw[i].toString(16).padStart(2, "0");
  return out;
}

export function mediaUrl(value) {
  try { return new URL(String(value || ""), "https://local.invalid"); }
  catch (err) { return null; }
}

export function canonicalSwarmKey(value) {
  const url = mediaUrl(value);
  if (!url || !url.hostname) return "";
  let path = url.pathname || "/";
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  if (/\.[a-z0-9]{1,8}$/i.test(name)) path = slash >= 0 ? path.slice(0, slash + 1) : "/";
  return url.hostname.toLowerCase() + path;
}

export function canonicalSegmentKey(value, range) {
  const url = mediaUrl(value);
  if (!url || !url.hostname) return "";
  return url.hostname.toLowerCase() + url.pathname + ">" + String(range || "");
}

export async function swarmIdFor(value) {
  const key = canonicalSwarmKey(value);
  if (!key) return "";
  const hex = await sha256Hex(key);
  return hex.slice(0, 32);
}

export async function segmentIdFor(value, range) {
  const key = canonicalSegmentKey(value, range);
  if (!key) return "";
  return sha256Hex(key);
}

export function rangeLabel(start, end) {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) return "";
  return "bytes=" + from + "-" + to;
}

export function eligibleMediaUrl(value) {
  const url = mediaUrl(value);
  if (!url) return false;
  const path = url.pathname || "";
  if (/\/loop\//i.test(path)) return false;
  if (/\.(m3u8|json)$/i.test(path)) return false;
  return MEDIA_EXT.test(path);
}

export function worthPeer(value, size) {
  if (!eligibleMediaUrl(value)) return false;
  const url = mediaUrl(value);
  const path = url ? url.pathname : "";
  if (SEGMENT_EXT.test(path)) return true;
  const known = Number(size) || 0;
  if (known > 0 && known < MIN_FILE_BYTES) return false;
  return true;
}

export function playlistAnchors(text, playlistUrl) {
  const lines = String(text || "").split(/\r?\n/);
  let pending = null;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trim = lines[i].trim();
    const range = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i.exec(trim);
    if (range) {
      pending = pending || {};
      pending.size = Number(range[1]);
      if (range[2] != null) pending.start = Number(range[2]);
      continue;
    }
    const sha = /^#EXT-X-VIKTORYCH-SHA256:([a-f0-9]{64})/i.exec(trim);
    if (sha) {
      pending = pending || {};
      pending.sha256 = sha[1].toLowerCase();
      continue;
    }
    if (!trim || trim.charAt(0) === "#") continue;
    if (pending && (pending.size || pending.sha256)) {
      let abs = trim;
      try { abs = new URL(trim, playlistUrl || "https://local.invalid/").href; }
      catch (err) { abs = trim; }
      out.push({
        url: abs,
        size: Number(pending.size) || 0,
        sha256: pending.sha256 || "",
        start: Number.isFinite(pending.start) ? pending.start : null
      });
    }
    pending = null;
  }
  return out;
}

export function verifySegment(bytes, expect) {
  const size = bytesOf(bytes).byteLength;
  const want = expect && typeof expect === "object" ? expect : {};
  const sha = String(want.sha256 || "").toLowerCase();
  const wantSize = Number(want.size) || 0;
  const actual = String(want.actualSha || "").toLowerCase();
  if (!sha && !wantSize) return { ok: false, share: false, reason: "unanchored" };
  if (sha) {
    if (!HEX64.test(sha) || actual !== sha) return { ok: false, share: false, reason: "hash" };
    if (wantSize && size !== wantSize) return { ok: false, share: false, reason: "hash" };
    return { ok: true, share: true, reason: "hash" };
  }
  if (size === wantSize) return { ok: true, share: false, reason: "size" };
  return { ok: false, share: false, reason: "size" };
}

export function loaderDecision(input) {
  const src = input && typeof input === "object" ? input : {};
  if (!src.enabled) return { source: "origin", peerAttempted: false, use: false, rejected: false };
  if (!src.have) return { source: "origin", peerAttempted: false, use: false, rejected: false };
  const peer = src.peerResult;
  if (!peer || peer.timeout || peer.miss || peer.error || !peer.bytes) {
    return { source: "origin", peerAttempted: true, use: false, rejected: false };
  }
  const verdict = src.verdict || { ok: false };
  if (!verdict.ok) return { source: "origin", peerAttempted: true, use: false, rejected: true };
  return { source: "peer", peerAttempted: true, use: true, rejected: false };
}

export function peerEnabled(settings, facts) {
  const peer = settings && typeof settings.peerMedia === "string" ? settings : { peerMedia: "auto", profile: "balanced" };
  const mode = peer.peerMedia === "on" || peer.peerMedia === "off" ? peer.peerMedia : "auto";
  const profile = peer.profile === "max" || peer.profile === "lite" ? peer.profile : "balanced";
  const env = facts && typeof facts === "object" ? facts : {};
  if (mode === "off") return { on: false, reason: "off" };
  if (mode === "on") return { on: true, reason: "on" };
  if (env.saveData) return { on: false, reason: "saveData" };
  if (env.batteryLow) return { on: false, reason: "battery" };
  if (env.metered) return { on: false, reason: "metered" };
  if (profile === "lite") return { on: false, reason: "lite" };
  if (profile === "max") return { on: true, reason: "max" };
  if (env.desktop && env.unmetered) return { on: true, reason: "balanced" };
  return { on: false, reason: "balanced" };
}

export function factsFromConnection(conn, env) {
  const extra = env && typeof env === "object" ? env : {};
  const link = conn && typeof conn === "object" ? conn : {};
  const ua = String(extra.ua || "");
  const type = String(link.type || "").toLowerCase();
  const effective = String(link.effectiveType || link.effective || "").toLowerCase();
  const phone = /Mobi|Android|iPhone|iPod/i.test(ua);
  const desktop = typeof extra.desktop === "boolean" ? extra.desktop : (!phone && type !== "cellular");
  const saveData = !!(extra.saveData || link.saveData);
  const metered = !!(saveData || effective === "slow-2g" || effective === "2g" || type === "cellular" || link.metered);
  const unmetered = !metered && (type === "wifi" || type === "ethernet" || extra.unmetered === true || (desktop && !type));
  return {
    desktop: desktop,
    phone: phone,
    metered: metered,
    unmetered: unmetered,
    saveData: saveData,
    batteryLow: !!extra.batteryLow,
    type: type
  };
}

export function admitUpload(state, bytes, now, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const cap = Number(options.cap) > 0 ? Number(options.cap) : UPLOAD_DEFAULT;
  const at = Number(now) || 0;
  const size = Math.max(0, Number(bytes) || 0);
  let bucket = state && typeof state === "object" ? { at: Number(state.at) || 0, used: Number(state.used) || 0 } : { at: at, used: 0 };
  if (!bucket.at || at - bucket.at >= 1000) bucket = { at: at, used: 0 };
  if (options.shareWhileWatching !== false && !options.watching) return { ok: false, reason: "idle", bucket: bucket };
  if (options.visible === false) return { ok: false, reason: "hidden", bucket: bucket };
  if (bucket.used + size > cap) return { ok: false, reason: "cap", bucket: bucket };
  return { ok: true, reason: "ok", bucket: { at: bucket.at, used: bucket.used + size } };
}

function stripRelay(text) {
  return String(text || "").split(/\r?\n/).filter((line) => line && !/typ relay/i.test(line)).join("\r\n");
}

export function cleanSignal(signal) {
  if (!signal || typeof signal !== "object") return null;
  const type = String(signal.type || "");
  if (type === "offer" || type === "answer") {
    const sdp = stripRelay(signal.sdp);
    if (!sdp || sdp.length > 3000) return null;
    return { type: type, sdp: sdp };
  }
  if (type === "ice") {
    const candidate = String(signal.candidate || "");
    if (!candidate || candidate.length > 1200 || /typ relay/i.test(candidate)) return null;
    const out = { type: "ice", candidate: candidate };
    if (typeof signal.sdpMid === "string" && signal.sdpMid.length <= 32) out.sdpMid = signal.sdpMid;
    if (Number.isInteger(signal.sdpMLineIndex) && signal.sdpMLineIndex >= 0 && signal.sdpMLineIndex < 16) out.sdpMLineIndex = signal.sdpMLineIndex;
    return out;
  }
  return null;
}

const BANNED_OPS = { data: 1, get: 1, seg: 1, chunk: 1 };
const BANNED_KEYS = ["bytes", "binary", "payload", "segment", "body", "data"];

export function acceptSwarmMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const op = String(msg.op || "");
  if (BANNED_OPS[op]) return null;
  for (let i = 0; i < BANNED_KEYS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(msg, BANNED_KEYS[i])) return null;
  }
  if (op === "hello" || op === "bye") return { op: op };
  if (op === "have") {
    const items = Array.isArray(msg.items) ? msg.items : [];
    const clean = [];
    for (let i = 0; i < items.length && clean.length < 20; i++) {
      const item = items[i] || {};
      const id = String(item.id || "").toLowerCase();
      const sha = String(item.sha256 || "").toLowerCase();
      const size = Number(item.size);
      if (!HEX64.test(id) || !HEX64.test(sha)) continue;
      if (!Number.isFinite(size) || size < 1 || size > 40000000) continue;
      clean.push({ id: id, sha256: sha, size: size });
    }
    if (!clean.length) return null;
    return { op: "have", items: clean };
  }
  if (op === "signal") {
    const to = String(msg.to || "").toLowerCase();
    if (!PEER_ID.test(to)) return null;
    const signal = cleanSignal(msg.signal);
    if (!signal) return null;
    return { op: "signal", to: to, signal: signal };
  }
  return null;
}

export function swarmVerdict(msg) {
  let body = msg;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch (err) { return { action: "ignore" }; }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { action: "ignore" };
  const op = String(body.op || "");
  if (BANNED_OPS[op]) return { action: "close", code: 1003 };
  for (let i = 0; i < BANNED_KEYS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(body, BANNED_KEYS[i])) return { action: "close", code: 1003 };
  }
  const clean = acceptSwarmMessage(body);
  if (!clean) return { action: "ignore" };
  return { action: "ok", msg: clean };
}
