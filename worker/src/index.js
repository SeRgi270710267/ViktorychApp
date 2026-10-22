import { OWNER_HANDLE, inspectHandle } from "../../shared/handle-skeleton.js";
import { parseRoomId, pickStreams } from "../../shared/tiktok-live.js";

const encoder = new TextEncoder();
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;
const SYNC_MAX = 350000;
const AVATAR_MAX = 150000;
const BANNER_MAX = 280000;
let schemaReady = null;

function iterationsOf(env) {
  const n = Number(env.PBKDF2_ITERATIONS || 8000);
  if (!Number.isFinite(n)) return 8000;
  return Math.max(1000, Math.min(200000, Math.floor(n)));
}

function allowedOrigins(env) {
  const raw = String(env.ALLOWED_ORIGINS || "https://viktorychgroup.github.io");
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function json(status, body, extra) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (extra) Object.keys(extra).forEach((key) => { headers[key] = extra[key]; });
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(request, env, response) {
  const origin = request.headers.get("Origin");
  if (!origin) return response;
  if (allowedOrigins(env).indexOf(origin) < 0) {
    return json(403, { error: "origin" });
  }
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-headers", "Content-Type, Authorization");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, PUT, OPTIONS");
  headers.set("access-control-max-age", "86400");
  return new Response(response.body, { status: response.status, headers });
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
}

function bytesToB64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function b64ToBytes(text) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function timingEqual(a, b) {
  const left = String(a);
  const right = String(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

function randomDigits(count) {
  const out = [];
  const buf = new Uint16Array(count);
  while (out.length < count) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < count; i++) {
      if (buf[i] >= 65530) continue;
      out.push(String(buf[i] % 10));
    }
  }
  return out.join("");
}

function grouped(digits) {
  return String(digits || "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(digest));
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return hex(new Uint8Array(sig));
}

async function slowHash(number, saltBytes, rounds) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(number), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: saltBytes,
    iterations: rounds,
    hash: "SHA-256"
  }, key, 256);
  return bytesToB64(new Uint8Array(bits));
}

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS accounts (public_id TEXT PRIMARY KEY, handle TEXT NOT NULL, skeleton TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', banner TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', owner INTEGER NOT NULL DEFAULT 0, number_lookup TEXT NOT NULL UNIQUE, number_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_owner ON accounts(owner) WHERE owner = 1"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS sessions_account ON sessions(public_id)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sync_state (public_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL)")
    ]).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function rateHit(env, bucket, limit, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket = ?").bind(bucket).first();
  if (!row || Number(row.reset_at) <= now) {
    await env.DB.prepare("INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = 1, reset_at = excluded.reset_at").bind(bucket, now + windowMs).run();
    return { ok: true, retry: 0 };
  }
  if (Number(row.hits) >= limit) {
    return { ok: false, retry: Math.max(1, Math.ceil((Number(row.reset_at) - now) / 1000)) };
  }
  await env.DB.prepare("UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?").bind(bucket).run();
  return { ok: true, retry: 0 };
}

function limited(result) {
  return json(429, { error: "rate_limited" }, { "retry-after": String(result.retry || 60) });
}

function cleanName(value) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > 50) return "";
  return text;
}

function cleanBio(value) {
  const text = String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (Array.from(text).length > 160) return null;
  return text;
}

function cleanImage(value, max) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length > max) return null;
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(text)) return null;
  return text.replace(/\s+/g, "");
}

function publicAccount(row) {
  return {
    publicId: row.public_id,
    handle: row.handle,
    displayName: row.display_name,
    avatar: row.avatar || "",
    banner: row.banner || "",
    bio: row.bio || "",
    owner: row.owner === 1,
    createdAt: row.created_at
  };
}

async function readJson(request, max) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) return { error: "too_large" };
  const text = await request.text();
  if (text.length > max) return { error: "too_large" };
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (err) { return { error: "bad_json" }; }
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function sessionAccount(env, request) {
  const token = bearer(request);
  if (!token || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT a.public_id, a.handle, a.display_name, a.avatar, a.banner, a.bio, a.owner, a.created_at FROM sessions s JOIN accounts a ON a.public_id = s.public_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(hash, now).first();
  return row || null;
}

async function mintSession(env, publicId) {
  const token = "va1." + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, public_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(hash, publicId, now, now + SESSION_MS).run();
  return token;
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", String(token));
  const ip = clientIp(request);
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!res.ok) return false;
  const data = await res.json();
  return !!data.success;
}

async function createAccount(env, fields) {
  const rounds = iterationsOf(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const number = randomDigits(16);
  const lookup = await hmacHex(env.ACCOUNT_PEPPER, number);
  const hash = await slowHash(number, salt, rounds);
  let publicId = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    publicId = randomDigits(12);
    const taken = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(publicId).first();
    if (!taken) break;
    publicId = "";
  }
  if (!publicId) return { error: "unavailable" };
  const now = Date.now();
  try {
    await env.DB.prepare("INSERT INTO accounts (public_id, handle, skeleton, display_name, avatar, banner, bio, owner, number_lookup, number_hash, salt, created_at) VALUES (?, ?, ?, ?, '', '', '', ?, ?, ?, ?, ?)").bind(
      publicId,
      fields.handle,
      fields.skeleton,
      fields.displayName,
      fields.owner ? 1 : 0,
      lookup,
      hash,
      bytesToB64(salt),
      now
    ).run();
  } catch (err) {
    const message = String(err && err.message || err);
    if (/UNIQUE/i.test(message)) return { error: fields.owner ? "handle_taken" : "handle_taken" };
    throw err;
  }
  const row = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, owner, created_at FROM accounts WHERE public_id = ?").bind(publicId).first();
  const token = await mintSession(env, publicId);
  return { token, accountNumber: number, account: publicAccount(row) };
}

async function handleSignup(request, env) {
  if (!env.ACCOUNT_PEPPER) return json(503, { error: "not_configured" });
  const ip = clientIp(request);
  const attempts = await rateHit(env, "su-try:" + ip, 12, 60 * 60 * 1000);
  if (!attempts.ok) return limited(attempts);
  const body = await readJson(request, 8000);
  if (body.error) return json(400, { error: body.error });
  const displayName = cleanName(body.displayName);
  if (!displayName) return json(400, { error: "invalid_name" });
  const checked = inspectHandle(body.handle);
  if (!checked.ok) {
    if (checked.error === "length") return json(400, { error: "invalid_handle" });
    if (checked.error === "reserved") return json(409, { error: "handle_reserved" });
    return json(400, { error: "invalid_handle" });
  }
  if (!(await verifyTurnstile(request, env, body.turnstileToken))) return json(403, { error: "turnstile" });
  if (checked.owner) {
    const code = String(body.claimCode || "");
    const secret = String(env.OWNER_CLAIM_CODE || "");
    if (!code) return json(403, { error: "claim_required" });
    if (!secret || !timingEqual(code, secret)) return json(403, { error: "invalid_claim" });
    const existing = await env.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
    if (existing) return json(409, { error: "handle_taken" });
  }
  const clash = await env.DB.prepare("SELECT public_id FROM accounts WHERE skeleton = ?").bind(checked.skeleton).first();
  if (clash) return json(409, { error: "handle_taken" });
  const prior = await env.DB.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket = ?").bind("su-ok:" + ip).first();
  if (prior && Number(prior.reset_at) > Date.now() && Number(prior.hits) >= 4) {
    return limited({ retry: Math.max(1, Math.ceil((Number(prior.reset_at) - Date.now()) / 1000)) });
  }
  const created = await createAccount(env, {
    handle: checked.owner ? OWNER_HANDLE : checked.handle,
    skeleton: checked.skeleton,
    displayName,
    owner: !!checked.owner
  });
  if (created.error) return json(created.error === "handle_taken" ? 409 : 503, { error: created.error });
  await rateHit(env, "su-ok:" + ip, 100, 60 * 60 * 1000);
  return json(201, {
    token: created.token,
    accountNumber: created.accountNumber,
    account: created.account
  });
}

async function handleLogin(request, env) {
  if (!env.ACCOUNT_PEPPER) return json(503, { error: "not_configured" });
  const ip = clientIp(request);
  const gate = await rateHit(env, "li:" + ip, 15, 15 * 60 * 1000);
  if (!gate.ok) return limited(gate);
  const body = await readJson(request, 2000);
  if (body.error) return json(400, { error: body.error });
  const digits = String(body.accountNumber || "").replace(/\D/g, "");
  const rounds = iterationsOf(env);
  const dummySalt = new Uint8Array(16);
  if (!/^\d{16}$/.test(digits)) {
    await slowHash("0000000000000000", dummySalt, rounds);
    return json(401, { error: "invalid_credentials" });
  }
  const lookup = await hmacHex(env.ACCOUNT_PEPPER, digits);
  const row = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, owner, created_at, number_hash, salt FROM accounts WHERE number_lookup = ?").bind(lookup).first();
  const salt = row ? b64ToBytes(row.salt) : dummySalt;
  const hash = await slowHash(digits, salt, rounds);
  if (!row || !timingEqual(hash, row.number_hash)) return json(401, { error: "invalid_credentials" });
  const token = await mintSession(env, row.public_id);
  return json(200, { token, account: publicAccount(row) });
}

async function handleSession(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  return json(200, { account: publicAccount(row) });
}

async function handleLogout(request, env, all) {
  const token = bearer(request);
  if (!token) return json(401, { error: "unauthorized" });
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT public_id FROM sessions WHERE token_hash = ?").bind(hash).first();
  if (!row) return json(401, { error: "unauthorized" });
  if (all) await env.DB.prepare("DELETE FROM sessions WHERE public_id = ?").bind(row.public_id).run();
  else await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
  return json(200, { ok: true });
}

async function handleProfileGet(env, handle) {
  const checked = inspectHandle(handle);
  const skel = checked.skeleton || "";
  if (!skel) return json(404, { error: "not_found" });
  const row = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, owner, created_at FROM accounts WHERE skeleton = ?").bind(skel).first();
  if (!row) return json(404, { error: "not_found" });
  return json(200, { account: publicAccount(row) });
}

async function handleProfilePatch(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const body = await readJson(request, AVATAR_MAX + BANNER_MAX + 4000);
  if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
  let handle = row.handle;
  let skeleton = "";
  if (body.handle != null && String(body.handle) !== row.handle) {
    if (row.owner === 1) return json(403, { error: "handle_locked" });
    const checked = inspectHandle(body.handle);
    if (!checked.ok || checked.owner) return json(checked.error === "reserved" || checked.owner ? 409 : 400, { error: checked.error === "reserved" || checked.owner ? "handle_reserved" : "invalid_handle" });
    const clash = await env.DB.prepare("SELECT public_id FROM accounts WHERE skeleton = ? AND public_id != ?").bind(checked.skeleton, row.public_id).first();
    if (clash) return json(409, { error: "handle_taken" });
    handle = checked.handle;
    skeleton = checked.skeleton;
  }
  const displayName = body.displayName == null ? row.display_name : cleanName(body.displayName);
  if (!displayName) return json(400, { error: "invalid_name" });
  const bio = body.bio == null ? (row.bio || "") : cleanBio(body.bio);
  if (bio == null) return json(400, { error: "invalid_bio" });
  const avatar = body.avatar == null ? (row.avatar || "") : cleanImage(body.avatar, AVATAR_MAX);
  const banner = body.banner == null ? (row.banner || "") : cleanImage(body.banner, BANNER_MAX);
  if (avatar == null || banner == null) return json(413, { error: "too_large" });
  if (skeleton) {
    await env.DB.prepare("UPDATE accounts SET handle = ?, skeleton = ?, display_name = ?, bio = ?, avatar = ?, banner = ? WHERE public_id = ?").bind(handle, skeleton, displayName, bio, avatar, banner, row.public_id).run();
  } else {
    await env.DB.prepare("UPDATE accounts SET display_name = ?, bio = ?, avatar = ?, banner = ? WHERE public_id = ?").bind(displayName, bio, avatar, banner, row.public_id).run();
  }
  const next = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, owner, created_at FROM accounts WHERE public_id = ?").bind(row.public_id).first();
  return json(200, { account: publicAccount(next) });
}

async function handleSyncGet(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const saved = await env.DB.prepare("SELECT payload, updated_at FROM sync_state WHERE public_id = ?").bind(row.public_id).first();
  if (!saved) return json(200, { payload: null, updatedAt: 0 });
  let payload = null;
  try { payload = JSON.parse(saved.payload); }
  catch (err) { payload = null; }
  return json(200, { payload, updatedAt: saved.updated_at });
}

async function handleSyncPut(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const body = await readJson(request, SYNC_MAX + 2000);
  if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return json(400, { error: "bad_json" });
  const text = JSON.stringify(body.payload);
  if (text.length > SYNC_MAX) return json(413, { error: "too_large" });
  const current = await env.DB.prepare("SELECT payload, updated_at FROM sync_state WHERE public_id = ?").bind(row.public_id).first();
  const base = Number(body.baseUpdatedAt || 0);
  if (current && base && Number(current.updated_at) !== base) {
    let payload = null;
    try { payload = JSON.parse(current.payload); } catch (err) { payload = null; }
    return json(409, { error: "conflict", payload, updatedAt: current.updated_at });
  }
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sync_state (public_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").bind(row.public_id, text, now).run();
  return json(200, { payload: body.payload, updatedAt: now });
}

const DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$|^data\/music\.json$|^(?:live|archive|comments|fallback)\/[A-Za-z0-9._-]{1,120}\.json$|^discord\/(?:index|state)\.json$|^discord\/(?:messages|pins)\/\d{1,22}\.json$/;

function dataKey(pathname) {
  const raw = String(pathname || "").replace(/^\/v1\/data\/?/, "");
  if (!raw || raw.indexOf("..") >= 0 || raw.charAt(0) === "/" || raw.indexOf("\\") >= 0) return "";
  let key = raw;
  try { key = decodeURIComponent(raw); }
  catch (err) { return ""; }
  if (!key || key.indexOf("..") >= 0 || key.charAt(0) === "/" || key.indexOf("\\") >= 0) return "";
  if (key === "archive/ia-state.json" || key === "archive/ia-manifest.json") return "";
  return DATA_KEY.test(key) ? key : "";
}

function tiktokPublic(env) {
  return String((env && env.TIKTOK_AUDIENCE) || "owner") === "all";
}

function ownerOnlyItem(item, env) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (item.ownerOnly === true) return true;
  const platform = String(item.platform || "").toLowerCase();
  if (platform === "tiktok" && !tiktokPublic(env)) return true;
  const kind = String(item.kind || item.type || "").toLowerCase();
  if (kind === "short" || kind === "shorts") return true;
  if (item.short === true || item.isShort === true) return true;
  const blob = [item.url, item.link, item.watch, item.external, item.canonical].filter(Boolean).join(" ");
  return /\/shorts\//i.test(blob);
}

function stripOwnerOnly(value, env) {
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item && typeof item === "object" && !Array.isArray(item) && ownerOnlyItem(item, env)) continue;
      out.push(stripOwnerOnly(item, env));
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => { out[key] = stripOwnerOnly(value[key], env); });
    return out;
  }
  return value;
}

async function handleData(request, env, pathname) {
  const key = dataKey(pathname);
  if (!key) return json(404, { error: "not_found" });
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  if (!env.DATA) return json(503, { error: "not_configured" });
  const object = await env.DATA.get(key);
  if (!object) return json(404, { error: "not_found" });
  const text = await object.text();
  if (row.owner === 1) {
    return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }
  let parsed = null;
  try { parsed = JSON.parse(text); }
  catch (err) { return json(502, { error: "bad_json" }); }
  return json(200, stripOwnerOnly(parsed, env));
}

const TIKTOK_HANDLE = /^[A-Za-z0-9._]{2,24}$/;
const MEDIA_HOST = /(?:^|\.)(?:tiktokcdn(?:-us|-eu)?\.com|tiktokv\.com|bytefcdn(?:-oversea)?\.com|muscdn\.com|tiktok\.com|ibytedtos\.com|ibyteimg\.com)$/i;

function mediaHostOk(hostname) {
  return MEDIA_HOST.test(String(hostname || ""));
}

async function requireTiktok(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return { error: json(401, { error: "unauthorized" }) };
  if (!tiktokPublic(env) && row.owner !== 1) return { error: json(403, { error: "forbidden" }) };
  return { row };
}

async function readOwnerDoc(env) {
  if (!env.DATA) return null;
  const object = await env.DATA.get("owner/tiktok.json");
  if (!object) return null;
  try { return JSON.parse(await object.text()); }
  catch (err) { return null; }
}

async function handleOwnerTiktok(request, env) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const object = await env.DATA.get("owner/tiktok.json");
  if (!object) return json(404, { error: "not_found" });
  return new Response(await object.text(), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" }
  });
}

async function fetchPublic(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", "accept": "text/html,application/json" },
    redirect: "follow"
  });
  return { status: res.status, text: await res.text() };
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function rememberLive(env, handle, info) {
  if (!env.DATA || !info) return;
  try {
    const doc = await readOwnerDoc(env);
    if (!doc || typeof doc !== "object") return;
    if (!doc.live || typeof doc.live !== "object") doc.live = {};
    const prev = doc.live[handle] && typeof doc.live[handle] === "object" ? doc.live[handle] : {};
    const when = stamp();
    doc.live[handle] = {
      handle,
      live: !!info.live,
      viewers: info.live ? (info.viewers || 0) : 0,
      title: info.live ? (info.title || "") : "",
      roomId: info.roomId || prev.roomId || "",
      lastLiveAt: info.live ? when : (info.lastLiveAt || prev.lastLiveAt || ""),
      checkedAt: when,
      detail: info.detail || ""
    };
    await env.DATA.put("owner/tiktok.json", JSON.stringify(doc));
  } catch (err) { /* the player still gets this response */ }
}

async function handleOwnerLive(request, env, rawHandle) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  let handle = rawHandle;
  try { handle = decodeURIComponent(rawHandle); } catch (err) { /* keep the raw segment */ }
  if (!TIKTOK_HANDLE.test(handle)) return json(400, { error: "bad_handle" });
  const stored = await readOwnerDoc(env);
  const prev = stored && stored.live && stored.live[handle] ? stored.live[handle] : {};
  const livePage = await fetchPublic("https://www.tiktok.com/@" + handle + "/live");
  if (livePage.status === 403 || livePage.status === 429 || livePage.status === 503) {
    return json(200, { handle, live: !!prev.live, blocked: true, detail: "TikTok blocked the runner", lastLiveAt: prev.lastLiveAt || "", hls: "", flv: "" });
  }
  let roomId = parseRoomId(livePage.text);
  if (!roomId) {
    const profile = await fetchPublic("https://www.tiktok.com/@" + handle);
    if (profile.status === 403 || profile.status === 429 || profile.status === 503) {
      return json(200, { handle, live: !!prev.live, blocked: true, detail: "TikTok blocked the runner", lastLiveAt: prev.lastLiveAt || "", hls: "", flv: "" });
    }
    roomId = parseRoomId(profile.text);
  }
  if (!roomId) {
    const info = { live: false, roomId: "", viewers: 0, title: "", detail: "TikTok did not include a room id", lastLiveAt: prev.lastLiveAt || "", hls: "", flv: "" };
    await rememberLive(env, handle, info);
    return json(200, Object.assign({ handle, blocked: false }, info));
  }
  const room = await fetchPublic("https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=" + encodeURIComponent(roomId));
  if (room.status === 403 || room.status === 429 || room.status === 503) {
    return json(200, { handle, live: !!prev.live, blocked: true, roomId, detail: "TikTok blocked the runner", lastLiveAt: prev.lastLiveAt || "", hls: "", flv: "" });
  }
  let parsed = {};
  try { parsed = JSON.parse(room.text); } catch (err) { parsed = {}; }
  const picked = pickStreams(parsed);
  const info = {
    live: !!picked.live,
    viewers: picked.viewers || 0,
    title: picked.title || "",
    roomId,
    quality: picked.quality || "",
    hls: picked.hls || "",
    flv: picked.flv || "",
    lastLiveAt: picked.live ? stamp() : (prev.lastLiveAt || ""),
    detail: ""
  };
  await rememberLive(env, handle, info);
  return json(200, Object.assign({ handle, blocked: false }, info));
}

function rewritePlaylist(text, base, request) {
  const origin = new URL(request.url).origin;
  const proxied = (value) => {
    try {
      const abs = new URL(value, base).toString();
      return origin + "/v1/owner/media?url=" + encodeURIComponent(abs);
    } catch (err) { return value; }
  };
  return String(text || "").split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.charAt(0) === "#") return line.replace(/URI="([^"]+)"/g, (all, uri) => 'URI="' + proxied(uri) + '"');
    return proxied(trimmed);
  }).join("\n");
}

async function handleOwnerMedia(request, env, url) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  const target = url.searchParams.get("url") || "";
  let parsed = null;
  try { parsed = new URL(target); } catch (err) { parsed = null; }
  if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password || !mediaHostOk(parsed.hostname)) {
    return json(400, { error: "bad_url" });
  }
  const upstream = await fetch(parsed.toString(), {
    headers: { "user-agent": "Mozilla/5.0", "accept": "*/*" },
    redirect: "follow"
  });
  let finalHost = "";
  try { finalHost = new URL(upstream.url).hostname; } catch (err) { finalHost = ""; }
  if (!mediaHostOk(finalHost)) return json(400, { error: "bad_url" });
  const length = Number(upstream.headers.get("content-length") || 0);
  if (length > 8000000) return json(413, { error: "too_large" });
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > 8000000) return json(413, { error: "too_large" });
  const type = upstream.headers.get("content-type") || "application/octet-stream";
  const asText = parsed.pathname.endsWith(".m3u8") || /mpegurl|m3u8/i.test(type);
  if (asText) {
    const text = new TextDecoder().decode(bytes);
    if (text.indexOf("#EXTM3U") >= 0) {
      return new Response(rewritePlaylist(text, upstream.url || parsed.toString(), request), {
        status: upstream.status,
        headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" }
      });
    }
  }
  return new Response(bytes, {
    status: upstream.status,
    headers: { "content-type": type, "cache-control": "no-store" }
  });
}

async function handleHandle(env, url) {
  const handle = url.searchParams.get("handle") || "";
  const checked = inspectHandle(handle);
  if (!checked.ok) return json(200, { ok: false, error: checked.error === "reserved" ? "handle_reserved" : "invalid_handle" });
  const clash = await env.DB.prepare("SELECT public_id FROM accounts WHERE skeleton = ?").bind(checked.skeleton).first();
  if (clash) return json(200, { ok: false, error: "handle_taken" });
  return json(200, { ok: true, owner: !!checked.owner });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  await ensureSchema(env);
  if (path === "/v1/health" && request.method === "GET") {
    return json(200, { ok: true, ready: !!env.ACCOUNT_PEPPER, data: !!env.DATA, turnstile: !!env.TURNSTILE_SECRET });
  }
  if (path.startsWith("/v1/data/") && request.method === "GET") return handleData(request, env, path);
  if (path === "/v1/owner/tiktok" && request.method === "GET") return handleOwnerTiktok(request, env);
  if (path === "/v1/owner/media" && request.method === "GET") return handleOwnerMedia(request, env, url);
  const ownerLive = path.match(/^\/v1\/owner\/live\/([^/]+)$/);
  if (ownerLive && request.method === "GET") return handleOwnerLive(request, env, ownerLive[1]);
  if (path === "/v1/signup" && request.method === "POST") return handleSignup(request, env);
  if (path === "/v1/login" && request.method === "POST") return handleLogin(request, env);
  if (path === "/v1/logout" && request.method === "POST") return handleLogout(request, env, false);
  if (path === "/v1/logout-all" && request.method === "POST") return handleLogout(request, env, true);
  if (path === "/v1/session" && request.method === "GET") return handleSession(request, env);
  if (path === "/v1/profile" && request.method === "PATCH") return handleProfilePatch(request, env);
  if (path === "/v1/sync" && request.method === "GET") return handleSyncGet(request, env);
  if (path === "/v1/sync" && request.method === "PUT") return handleSyncPut(request, env);
  if (path === "/v1/handle" && request.method === "GET") return handleHandle(env, url);
  const profile = path.match(/^\/v1\/profile\/([^/]+)$/);
  if (profile && request.method === "GET") {
    const viewer = await sessionAccount(env, request);
    if (!viewer) return json(401, { error: "unauthorized" });
    let handle = profile[1];
    try { handle = decodeURIComponent(handle); } catch (err) { /* keep the raw segment */ }
    return handleProfileGet(env, handle);
  }
  return json(404, { error: "not_found" });
}

export default {
  async fetch(request, env) {
    try {
      const origin = request.headers.get("Origin");
      if (origin && allowedOrigins(env).indexOf(origin) < 0) return json(403, { error: "origin" });
      const response = await route(request, env);
      return withCors(request, env, response);
    } catch (err) {
      return json(500, { error: "unavailable" });
    }
  }
};
