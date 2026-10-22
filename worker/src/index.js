import { OWNER_HANDLE, inspectHandle } from "../../shared/handle-skeleton.js";
import { parseRoomId, pickStreams } from "../../shared/tiktok-live.js";
import { describeTikTok, pickPlayUrl } from "../../shared/tiktok-play.js";
import { cleanHistoryCut, cleanHistoryList } from "../../shared/history-sync.js";

const encoder = new TextEncoder();
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;
const SYNC_MAX = 350000;
const AVATAR_BYTES = 60 * 1024;
const BANNER_BYTES = 150 * 1024;
const AVATAR_TEXT = 90000;
const BANNER_TEXT = 220000;
const MEDIA_KEY = /^media\/(avatars|banners)\/(\d{12})\/([a-f0-9]{64})\.(webp|jpg|png)$/;
const ACCOUNT_COLS = "public_id, handle, display_name, avatar, banner, bio, location, website, owner, created_at, hide_avatar, avatar_empty, banner_empty";
let schemaReady = null;
let mediaReady = null;

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
  headers.set("access-control-allow-headers", "Content-Type, Authorization, Range");
  headers.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
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
      env.DB.prepare("CREATE TABLE IF NOT EXISTS accounts (public_id TEXT PRIMARY KEY, handle TEXT NOT NULL, skeleton TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', banner TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', hide_avatar TEXT NOT NULL DEFAULT '', avatar_empty TEXT NOT NULL DEFAULT 'default', banner_empty TEXT NOT NULL DEFAULT 'default', owner INTEGER NOT NULL DEFAULT 0, number_lookup TEXT NOT NULL UNIQUE, number_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_owner ON accounts(owner) WHERE owner = 1"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS sessions_account ON sessions(public_id)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sync_state (public_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL)")
    ]).then(() => addProfileColumns(env)).then(() => migrateProfileMedia(env)).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function addProfileColumns(env) {
  const statements = [
    "ALTER TABLE accounts ADD COLUMN location TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN website TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN hide_avatar TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN avatar_empty TEXT NOT NULL DEFAULT 'default'",
    "ALTER TABLE accounts ADD COLUMN banner_empty TEXT NOT NULL DEFAULT 'default'"
  ];
  for (let i = 0; i < statements.length; i++) {
    try {
      await env.DB.prepare(statements[i]).run();
    } catch (err) {
      const message = String(err && err.message || err);
      if (!/duplicate column/i.test(message)) throw err;
    }
  }
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

function cleanLimited(value, max) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (Array.from(text).length > max) return null;
  return text;
}

function cleanWebsite(value) {
  const text = cleanLimited(value, 100);
  if (text == null) return null;
  if (!text) return "";
  if (/[\s<>]/.test(text) || /^(javascript|data|file):/i.test(text)) return null;
  return text;
}

function asciiAt(bytes, start, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[start + i] || 0);
  return out;
}

function imageMagic(subtype, bytes) {
  if (subtype === "webp") return asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP";
  if (subtype === "png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (subtype === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

function decodeDataImage(value, maxChars, maxBytes, allowed) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return { empty: true };
  if (text.length > maxChars) return null;
  const match = text.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || allowed.indexOf(match[1]) < 0) return null;
  let bytes = null;
  try { bytes = b64ToBytes(match[2]); }
  catch (err) { return null; }
  if (!bytes || bytes.length < 16 || bytes.length > maxBytes) return null;
  if (!imageMagic(match[1], bytes)) return null;
  return { bytes, ext: match[1] === "jpeg" ? "jpg" : match[1], type: "image/" + match[1] };
}

function mediaOwned(key, publicId, kind) {
  const match = MEDIA_KEY.exec(String(key || ""));
  return !!(match && match[1] === kind && match[2] === String(publicId || ""));
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest));
}

async function writeMedia(env, publicId, kind, decoded, previous) {
  if (!env.DATA) return "";
  const hash = await sha256Bytes(decoded.bytes);
  const key = "media/" + kind + "/" + publicId + "/" + hash + "." + decoded.ext;
  if (key !== previous) {
    await env.DATA.put(key, decoded.bytes, { httpMetadata: { contentType: decoded.type } });
    if (previous && previous !== key && mediaOwned(previous, publicId, kind)) await env.DATA.delete(previous);
  }
  return key;
}

async function clearMedia(env, publicId, kind, previous) {
  if (previous && mediaOwned(previous, publicId, kind) && env.DATA) await env.DATA.delete(previous);
  return "";
}

async function promoteMedia(env, publicId, kind, value) {
  const text = String(value || "");
  if (!text) return "";
  if (mediaOwned(text, publicId, kind)) return text;
  if (text.indexOf("data:") !== 0) return text;
  const decoded = decodeDataImage(text, 500000, 400000, ["jpeg", "png", "webp"]);
  if (!decoded || decoded.empty) return text;
  const key = await writeMedia(env, publicId, kind, decoded, "");
  return key || text;
}

async function ensureMediaKeys(env, row) {
  if (!row || !env.DATA) return row;
  const avatarIn = String(row.avatar || "");
  const bannerIn = String(row.banner || "");
  if (avatarIn.indexOf("data:") !== 0 && bannerIn.indexOf("data:") !== 0) return row;
  let avatar = avatarIn;
  let banner = bannerIn;
  try {
    if (avatarIn.indexOf("data:") === 0) avatar = await promoteMedia(env, row.public_id, "avatars", avatarIn);
    if (bannerIn.indexOf("data:") === 0) banner = await promoteMedia(env, row.public_id, "banners", bannerIn);
  } catch (err) {
    return row;
  }
  if (avatar === avatarIn && banner === bannerIn) return row;
  await env.DB.prepare("UPDATE accounts SET avatar = ?, banner = ? WHERE public_id = ?").bind(avatar, banner, row.public_id).run();
  row.avatar = avatar;
  row.banner = banner;
  return row;
}

function migrateProfileMedia(env) {
  if (!env.DATA) return Promise.resolve();
  if (!mediaReady) {
    mediaReady = env.DB.prepare("SELECT public_id, avatar, banner FROM accounts WHERE avatar LIKE 'data:%' OR banner LIKE 'data:%'").all().then(async (listed) => {
      const rows = (listed && listed.results) || [];
      for (let i = 0; i < rows.length; i++) await ensureMediaKeys(env, rows[i]);
    }).catch((err) => {
      mediaReady = null;
      throw err;
    });
  }
  return mediaReady;
}

async function acceptUpload(env, row, kind, value, maxBytes, maxChars) {
  const text = String(value == null ? "" : value);
  const previous = kind === "avatars" ? (row.avatar || "") : (row.banner || "");
  if (!text) return { key: await clearMedia(env, row.public_id, kind, previous) };
  const decoded = decodeDataImage(text, maxChars, maxBytes, ["webp"]);
  if (!decoded || decoded.empty) return { error: "too_large", status: 413 };
  if (!env.DATA) return { error: "not_configured", status: 503 };
  const key = await writeMedia(env, row.public_id, kind, decoded, previous);
  if (!key) return { error: "unavailable", status: 503 };
  return { key };
}

function mediaPublicUrl(request, key) {
  const text = String(key || "");
  if (!MEDIA_KEY.test(text)) return text.indexOf("data:image/") === 0 ? text : "";
  if (!request) return "";
  return new URL("/v1/" + text, request.url).toString();
}

function cleanGap(value, fallback) {
  if (value === "none" || value === "default") return value;
  return fallback === "none" ? "none" : "default";
}

function cleanHide(value, fallback) {
  if (value === "none" || value === "default" || value === "") return value;
  return fallback === "none" || fallback === "default" ? fallback : "";
}

function cleanFaceChoice(value, fallback) {
  if (value === "show" || value === "default" || value === "none") return value;
  return fallback === "default" || fallback === "none" ? fallback : "show";
}

function publicAccount(row, request, own) {
  const hidden = cleanHide(row.hide_avatar);
  const avatarUrl = mediaPublicUrl(request, row.avatar);
  const bannerUrl = mediaPublicUrl(request, row.banner);
  const avatarFace = hidden || (avatarUrl ? "photo" : cleanGap(row.avatar_empty));
  const bannerFace = bannerUrl ? "photo" : cleanGap(row.banner_empty);
  return {
    publicId: row.public_id,
    handle: row.handle,
    displayName: row.display_name,
    avatar: hidden && !own ? "" : avatarUrl,
    avatarFace,
    avatarEmpty: cleanGap(row.avatar_empty),
    banner: bannerUrl,
    bannerFace,
    bannerEmpty: cleanGap(row.banner_empty),
    hideAvatar: hidden,
    bio: row.bio || "",
    location: row.location || "",
    website: row.website || "",
    owner: row.owner === 1,
    createdAt: row.created_at
  };
}

async function presentAccount(env, request, row, own) {
  const next = await ensureMediaKeys(env, row);
  return publicAccount(next, request, !!own);
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
  const row = await env.DB.prepare("SELECT a.public_id, a.handle, a.display_name, a.avatar, a.banner, a.bio, a.location, a.website, a.owner, a.created_at, a.hide_avatar, a.avatar_empty, a.banner_empty FROM sessions s JOIN accounts a ON a.public_id = s.public_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(hash, now).first();
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

async function createAccount(env, request, fields) {
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
  const row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(publicId).first();
  const token = await mintSession(env, publicId);
  return { token, accountNumber: number, account: await presentAccount(env, request, row, true) };
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
  const created = await createAccount(env, request, {
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
  const row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + ", number_hash, salt FROM accounts WHERE number_lookup = ?").bind(lookup).first();
  const salt = row ? b64ToBytes(row.salt) : dummySalt;
  const hash = await slowHash(digits, salt, rounds);
  if (!row || !timingEqual(hash, row.number_hash)) return json(401, { error: "invalid_credentials" });
  const token = await mintSession(env, row.public_id);
  return json(200, { token, account: await presentAccount(env, request, row, true) });
}

async function handleSession(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  return json(200, { account: await presentAccount(env, request, row, true) });
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

async function handleProfileGet(request, env, handle) {
  const checked = inspectHandle(handle);
  const skel = checked.skeleton || "";
  if (!skel) return json(404, { error: "not_found" });
  const row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE skeleton = ?").bind(skel).first();
  if (!row) return json(404, { error: "not_found" });
  const viewer = await sessionAccount(env, request);
  const own = !!(viewer && viewer.public_id === row.public_id);
  return json(200, { account: await presentAccount(env, request, row, own) });
}

async function handleProfilePatch(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const body = await readJson(request, AVATAR_TEXT + BANNER_TEXT + 8000);
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
  const location = body.location == null ? (row.location || "") : cleanLimited(body.location, 30);
  if (location == null) return json(400, { error: "invalid_location" });
  const website = body.website == null ? (row.website || "") : cleanWebsite(body.website);
  if (website == null) return json(400, { error: "invalid_website" });
  let avatar = row.avatar || "";
  let banner = row.banner || "";
  if (body.avatar != null) {
    const saved = await acceptUpload(env, row, "avatars", body.avatar, AVATAR_BYTES, AVATAR_TEXT);
    if (saved.error) return json(saved.status, { error: saved.error });
    avatar = saved.key;
    row.avatar = avatar;
  }
  if (body.banner != null) {
    const saved = await acceptUpload(env, row, "banners", body.banner, BANNER_BYTES, BANNER_TEXT);
    if (saved.error) return json(saved.status, { error: saved.error });
    banner = saved.key;
    row.banner = banner;
  }
  const hideAvatar = body.hideAvatar == null ? cleanHide(row.hide_avatar) : cleanHide(body.hideAvatar, row.hide_avatar);
  const avatarEmpty = body.avatarEmpty == null ? cleanGap(row.avatar_empty) : cleanGap(body.avatarEmpty, row.avatar_empty);
  const bannerEmpty = body.bannerEmpty == null ? cleanGap(row.banner_empty) : cleanGap(body.bannerEmpty, row.banner_empty);
  if (skeleton) {
    await env.DB.prepare("UPDATE accounts SET handle = ?, skeleton = ?, display_name = ?, bio = ?, location = ?, website = ?, avatar = ?, banner = ?, hide_avatar = ?, avatar_empty = ?, banner_empty = ? WHERE public_id = ?").bind(handle, skeleton, displayName, bio, location, website, avatar, banner, hideAvatar, avatarEmpty, bannerEmpty, row.public_id).run();
  } else {
    await env.DB.prepare("UPDATE accounts SET display_name = ?, bio = ?, location = ?, website = ?, avatar = ?, banner = ?, hide_avatar = ?, avatar_empty = ?, banner_empty = ? WHERE public_id = ?").bind(displayName, bio, location, website, avatar, banner, hideAvatar, avatarEmpty, bannerEmpty, row.public_id).run();
  }
  const next = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(row.public_id).first();
  return json(200, { account: await presentAccount(env, request, next, true) });
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
  const current = await env.DB.prepare("SELECT payload, updated_at FROM sync_state WHERE public_id = ?").bind(row.public_id).first();
  let previous = null;
  if (current) {
    try { previous = JSON.parse(current.payload); } catch (err) { previous = null; }
  }
  const payload = body.payload;
  const sentCut = cleanHistoryCut(payload.historyCut);
  const prevCut = cleanHistoryCut(previous && previous.historyCut);
  payload.historyCut = {
    video: Math.max(sentCut.video, prevCut.video),
    article: Math.max(sentCut.article, prevCut.article)
  };
  const rows = Array.isArray(payload.history) ? payload.history : (previous && previous.history);
  payload.history = cleanHistoryList(rows, payload.historyCut);
  payload.showPictures = cleanFaceChoice(payload.showPictures, previous && previous.showPictures);
  payload.showBanners = cleanFaceChoice(payload.showBanners, previous && previous.showBanners);
  const text = JSON.stringify(payload);
  if (text.length > SYNC_MAX) return json(413, { error: "too_large" });
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

const PLAY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PLAY_ID = /^\d{8,22}$/;
const playMemory = new Map();

function cookiePairs(response) {
  const raw = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const pairs = [];
  for (let i = 0; i < raw.length; i++) {
    const pair = String(raw[i] || "").split(";")[0].trim();
    if (!pair || pair.indexOf("=") < 1) continue;
    const name = pair.slice(0, pair.indexOf("="));
    const index = pairs.findIndex((item) => item.slice(0, item.indexOf("=")) === name);
    if (index >= 0) pairs[index] = pair;
    else pairs.push(pair);
  }
  return pairs;
}

async function fetchPublicPage(url) {
  const jar = [];
  let current = url;
  let res = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": PLAY_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        cookie: jar.join("; ")
      },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    cookiePairs(res).forEach((pair) => {
      const name = pair.slice(0, pair.indexOf("="));
      const index = jar.findIndex((item) => item.slice(0, item.indexOf("=")) === name);
      if (index >= 0) jar[index] = pair;
      else jar.push(pair);
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  const text = await res.text();
  return {
    status: res.status,
    type: res.headers.get("content-type") || "",
    text,
    cookie: jar.join("; "),
    url: current
  };
}

function rememberedPlay(key) {
  const row = playMemory.get(key);
  if (!row) return null;
  if (Date.now() - row.at > 45000) {
    playMemory.delete(key);
    return null;
  }
  return row;
}

async function resolvePlay(handle, id, fresh) {
  const key = handle + ":" + id;
  if (!fresh) {
    const hit = rememberedPlay(key);
    if (hit) return hit;
  }
  const page = "https://www.tiktok.com/@" + handle + "/video/" + id;
  const doc = await fetchPublicPage(page);
  const info = describeTikTok(doc.status, doc.type, doc.text);
  if (doc.status === 403 || doc.status === 429 || doc.status === 503 || info.captcha) {
    return { ok: false, key, tiktokStatus: info.tiktokStatus, tiktokType: info.tiktokType, detail: info.detail };
  }
  const play = pickPlayUrl(doc.text);
  if (!play) {
    return { ok: false, key, tiktokStatus: info.tiktokStatus, tiktokType: info.tiktokType, detail: info.detail + " and no play URL" };
  }
  let host = "";
  try { host = new URL(play).hostname; } catch (err) { host = ""; }
  if (!mediaHostOk(host)) {
    return { ok: false, key, tiktokStatus: info.tiktokStatus, tiktokType: info.tiktokType, detail: info.detail + " and a play host that is not allowed" };
  }
  const row = { ok: true, key, url: play, cookie: doc.cookie, referer: page, at: Date.now(), tiktokStatus: info.tiktokStatus, tiktokType: info.tiktokType, detail: "" };
  if (playMemory.size > 8) playMemory.clear();
  playMemory.set(key, row);
  return row;
}

function playJson(status, row) {
  return json(status, {
    ok: !!row.ok,
    error: row.ok ? "" : "tiktok_blocked",
    tiktokStatus: row.tiktokStatus || 0,
    tiktokType: row.tiktokType || "",
    detail: row.detail || ""
  });
}

function streamVideo(upstream) {
  const headers = new Headers();
  const type = upstream.headers.get("content-type") || "video/mp4";
  headers.set("content-type", type);
  headers.set("accept-ranges", upstream.headers.get("accept-ranges") || "bytes");
  const range = upstream.headers.get("content-range");
  if (range) headers.set("content-range", range);
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  headers.set("cache-control", "private, no-store");
  headers.set("cdn-cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function fetchPlay(row, request) {
  const headers = new Headers();
  headers.set("user-agent", PLAY_UA);
  headers.set("referer", row.referer);
  headers.set("origin", "https://www.tiktok.com");
  headers.set("accept", "*/*");
  if (row.cookie) headers.set("cookie", row.cookie);
  const range = request.headers.get("range") || "";
  if (/^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
  return fetch(row.url, {
    headers,
    redirect: "follow",
    cf: { cacheTtl: 0, cacheEverything: false }
  });
}

async function handleOwnerPlay(request, env, url) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  const id = String(url.searchParams.get("id") || "");
  let handle = String(url.searchParams.get("handle") || "");
  try { handle = decodeURIComponent(handle); } catch (err) { /* keep the raw value */ }
  if (!PLAY_ID.test(id) || !TIKTOK_HANDLE.test(handle)) return json(400, { error: "bad_url" });
  const meta = url.searchParams.get("meta") === "1";
  let resolved = rememberedPlay(handle + ":" + id);
  if (!resolved) {
    const paced = await rateHit(env, "play:" + gate.row.public_id, 40, 10 * 60 * 1000);
    if (!paced.ok) return json(429, { ok: false, error: "rate_limited", tiktokStatus: 0, tiktokType: "", detail: "Too many play requests" });
    resolved = await resolvePlay(handle, id, false);
  }
  if (!resolved.ok) return playJson(502, resolved);
  if (meta) return playJson(200, resolved);
  let upstream = await fetchPlay(resolved, request);
  let finalHost = "";
  try { finalHost = new URL(upstream.url).hostname; } catch (err) { finalHost = ""; }
  if (!mediaHostOk(finalHost)) return json(400, { error: "bad_url" });
  const type = (upstream.headers.get("content-type") || "").toLowerCase();
  const videoLike = type.indexOf("video/") === 0 || type.indexOf("application/octet-stream") === 0;
  if ((upstream.status === 403 || upstream.status === 429 || upstream.status === 503) || ((upstream.status === 200 || upstream.status === 206) && !videoLike)) {
    const dropped = upstream.body && upstream.body.cancel && upstream.body.cancel();
    if (dropped && dropped.catch) dropped.catch(function () {});
    playMemory.delete(resolved.key);
    const again = await resolvePlay(handle, id, true);
    if (!again.ok) return playJson(502, again);
    upstream = await fetchPlay(again, request);
    try { finalHost = new URL(upstream.url).hostname; } catch (err) { finalHost = ""; }
    if (!mediaHostOk(finalHost)) return json(400, { error: "bad_url" });
  }
  const nextType = (upstream.headers.get("content-type") || "").toLowerCase();
  const nextVideo = nextType.indexOf("video/") === 0 || nextType.indexOf("application/octet-stream") === 0;
  if ((upstream.status === 200 || upstream.status === 206) && nextVideo) return streamVideo(upstream);
  const text = await upstream.text();
  const info = describeTikTok(upstream.status, nextType, text);
  return playJson(502, { ok: false, tiktokStatus: info.tiktokStatus, tiktokType: info.tiktokType, detail: info.detail + (info.captcha ? "" : " and no video") });
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

async function handleAccountMedia(request, env, kind, publicId, file) {
  const viewer = await sessionAccount(env, request);
  if (!viewer) return json(401, { error: "unauthorized" });
  const key = "media/" + kind + "/" + publicId + "/" + file;
  if (!mediaOwned(key, publicId, kind)) return json(404, { error: "not_found" });
  const owner = await env.DB.prepare("SELECT avatar, banner, hide_avatar FROM accounts WHERE public_id = ?").bind(publicId).first();
  if (!owner || (owner.avatar !== key && owner.banner !== key)) return json(404, { error: "not_found" });
  if (kind === "avatars" && cleanHide(owner.hide_avatar) && viewer.public_id !== publicId) return json(404, { error: "not_found" });
  if (!env.DATA) return json(503, { error: "not_configured" });
  const object = await env.DATA.get(key);
  if (!object) return json(404, { error: "not_found" });
  const type = (object.httpMetadata && object.httpMetadata.contentType) || (key.endsWith(".png") ? "image/png" : key.endsWith(".jpg") ? "image/jpeg" : "image/webp");
  const headers = {
    "content-type": type,
    "cache-control": "private, max-age=86400",
    "cdn-cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (object.size) headers["content-length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  await ensureSchema(env);
  if (path === "/v1/health" && request.method === "GET") {
    return json(200, { ok: true, ready: !!env.ACCOUNT_PEPPER, data: !!env.DATA, turnstile: !!env.TURNSTILE_SECRET });
  }
  const accountMedia = path.match(/^\/v1\/media\/(avatars|banners)\/(\d{12})\/([a-f0-9]{64}\.(?:webp|jpg|png))$/);
  if (accountMedia && request.method === "GET") return handleAccountMedia(request, env, accountMedia[1], accountMedia[2], accountMedia[3]);
  if (path.startsWith("/v1/data/") && request.method === "GET") return handleData(request, env, path);
  if (path === "/v1/owner/tiktok" && request.method === "GET") return handleOwnerTiktok(request, env);
  if (path === "/v1/owner/play" && request.method === "GET") return handleOwnerPlay(request, env, url);
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
    return handleProfileGet(request, env, handle);
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
