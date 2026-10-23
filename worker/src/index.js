import { OWNER_HANDLE, inspectHandle } from "../../shared/handle-skeleton.js";
import { parseRoomId, pickStreams, roomStats, isTopQuality } from "../../shared/tiktok-live.js";
import { describeTikTok, pickPlayUrl } from "../../shared/tiktok-play.js";
import { cleanHistoryCut, cleanHistoryList } from "../../shared/history-sync.js";
import { cleanRepostKey, cleanRepostWrite } from "../../shared/reposts.js";
import { socialKeysForPost } from "../../shared/social-keys.js";
import { buildPlaylist, keptVideoKey, parseRange, safeTelegramPath } from "./telegram.js";
import { handleDrive, DRIVE_SCHEMA } from "./drive.js";
import { handleCommunityRoute, COMMUNITY_SCHEMA } from "./communities.js";

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
  headers.set("access-control-allow-headers", "Content-Type, Authorization, Range, X-Feed-Refresh");
  headers.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
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
      env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS telegram_files (object_key TEXT NOT NULL, kind TEXT NOT NULL, part_index INTEGER NOT NULL, bucket TEXT NOT NULL DEFAULT '', file_id TEXT NOT NULL, message_id INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL DEFAULT 'application/octet-stream', duration REAL NOT NULL DEFAULT 0, serve INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, encrypted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (object_key, kind, part_index))"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS account_reposts (public_id TEXT NOT NULL, post_key TEXT NOT NULL, kind TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (public_id, post_key))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS account_reposts_recent ON account_reposts(public_id, created_at DESC)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS account_follows (follower_id TEXT NOT NULL, target_id TEXT NOT NULL, snapshot TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (follower_id, target_id))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS account_follows_target ON account_follows(target_id, created_at DESC)")
    ].concat(DRIVE_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(COMMUNITY_SCHEMA.map((sql) => env.DB.prepare(sql)))).then(() => addProfileColumns(env)).then(() => migrateProfileMedia(env)).catch((err) => {
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

async function slideSession(env, request) {
  const token = bearer(request);
  if (!token || token.length > 200 || !env.DB) return;
  const hash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ? AND expires_at > ?").bind(now + SESSION_MS, hash, now).run();
}

async function handleSession(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  return json(200, { account: await presentAccount(env, request, row, true) });
}

async function handleSessionRefresh(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const paced = await rateHit(env, "session-refresh:" + row.public_id, 30, TG_WINDOW_MS);
  if (!paced.ok) return limited(paced);
  await slideSession(env, request);
  const token = await mintSession(env, row.public_id);
  return json(200, { token, account: await presentAccount(env, request, row, true) });
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

async function listReposts(env, publicId) {
  const listed = await env.DB.prepare("SELECT post_key, kind, comment, snapshot, created_at FROM account_reposts WHERE public_id = ? ORDER BY created_at DESC LIMIT 80").bind(publicId).all();
  const rows = (listed && listed.results) || [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let post = null;
    try { post = JSON.parse(row.snapshot); }
    catch (err) { post = null; }
    if (!post || typeof post !== "object") continue;
    out.push({
      postKey: row.post_key,
      kind: row.kind === "quote" ? "quote" : "repost",
      comment: row.comment || "",
      createdAt: row.created_at,
      post: post
    });
  }
  return out;
}

async function trimReposts(env, publicId) {
  const extra = await env.DB.prepare("SELECT post_key FROM account_reposts WHERE public_id = ? ORDER BY created_at DESC LIMIT 200 OFFSET 80").bind(publicId).all();
  const rows = (extra && extra.results) || [];
  for (let i = 0; i < rows.length; i++) {
    await env.DB.prepare("DELETE FROM account_reposts WHERE public_id = ? AND post_key = ?").bind(publicId, rows[i].post_key).run();
  }
}

async function handleProfileGet(request, env, handle) {
  const checked = inspectHandle(handle);
  const skel = checked.skeleton || "";
  if (!skel) return json(404, { error: "not_found" });
  const row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE skeleton = ?").bind(skel).first();
  if (!row) return json(404, { error: "not_found" });
  const viewer = await sessionAccount(env, request);
  const own = !!(viewer && viewer.public_id === row.public_id);
  const account = await presentAccount(env, request, row, own);
  account.followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", row.public_id);
  account.followersCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ?", "app:" + row.public_id);
  account.viewerFollows = !!(viewer && viewer.public_id !== row.public_id && await followExists(env, viewer.public_id, "app:" + row.public_id));
  return json(200, { account, reposts: await listReposts(env, row.public_id) });
}

async function handleRepostPut(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const paced = await rateHit(env, "repost:" + row.public_id, 40, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const body = await readJson(request, 20000);
  if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
  const cleaned = cleanRepostWrite(body);
  if (cleaned.error) return json(400, { error: cleaned.error });
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT created_at FROM account_reposts WHERE public_id = ? AND post_key = ?").bind(row.public_id, cleaned.postKey).first();
  const created = existing ? Number(existing.created_at) : now;
  await env.DB.prepare("INSERT INTO account_reposts (public_id, post_key, kind, comment, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(public_id, post_key) DO UPDATE SET kind = excluded.kind, comment = excluded.comment, snapshot = excluded.snapshot").bind(row.public_id, cleaned.postKey, cleaned.kind, cleaned.comment, JSON.stringify(cleaned.post), created).run();
  await trimReposts(env, row.public_id);
  return json(200, { ok: true, repost: { postKey: cleaned.postKey, kind: cleaned.kind, comment: cleaned.comment, createdAt: created, post: cleaned.post } });
}

async function handleRepostDelete(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const body = await readJson(request, 4000);
  if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
  const postKey = cleanRepostKey(body.postKey);
  if (!postKey) return json(400, { error: "bad_repost" });
  await env.DB.prepare("DELETE FROM account_reposts WHERE public_id = ? AND post_key = ?").bind(row.public_id, postKey).run();
  return json(200, { ok: true });
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

const DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$|^data\/music\.json$|^(?:live|archive|comments|fallback)\/[A-Za-z0-9._-]{1,120}\.json$|^discord\/(?:index|state)\.json$|^discord\/(?:messages|pins)\/\d{1,22}\.json$|^data\/communities\/(?:index|[a-z0-9_]{2,21})\.json$/;

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
    headers: {
      "user-agent": PLAY_UA,
      accept: "text/html,application/json",
      "accept-language": "en-US,en;q=0.9"
    },
    redirect: "follow"
  });
  return { status: res.status, text: await res.text(), retryAfter: retryAfterSeconds(res) };
}

const BACKOFF_MINUTES = [5, 15, 60, 180, 360];

function retryAfterSeconds(response) {
  const raw = String((response && response.headers && response.headers.get("retry-after")) || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return 0;
}

function backoffSeconds(step, retryAfter) {
  const index = Math.max(0, Math.min(BACKOFF_MINUTES.length - 1, Number(step) || 0));
  const base = BACKOFF_MINUTES[index] * 60;
  const retry = Number(retryAfter) > 0 ? Number(retryAfter) : 0;
  return {
    seconds: Math.min(6 * 60 * 60, Math.max(base, retry)),
    nextStep: Math.min(BACKOFF_MINUTES.length - 1, index + 1)
  };
}

function backoffActive(row) {
  const until = Date.parse(row && row.backoffUntil || "");
  return Number.isFinite(until) && until > Date.now();
}

function challengeKind(status, text) {
  if (status === 403 || status === 429 || status === 503) return String(status);
  if (String(text || "").indexOf("captcha-verify") >= 0 && !parseRoomId(text)) return "captcha";
  return "";
}

async function cacheRead(url, ttlMs) {
  try {
    const hit = await caches.default.match(new Request(url));
    if (!hit) return null;
    const at = Number(hit.headers.get("x-fetched-at") || 0);
    if (!at || Date.now() - at >= ttlMs) return null;
    return await hit.json();
  } catch (err) {
    return null;
  }
}

async function cacheWrite(url, body, ttlSeconds) {
  try {
    await caches.default.put(new Request(url), new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=" + String(ttlSeconds || 10),
        "x-fetched-at": String(Date.now())
      }
    }));
  } catch (err) { /* the owner still gets this response */ }
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
      quality: info.live ? (info.quality || "") : "",
      qualityNote: info.live ? (info.qualityNote || "") : "",
      lastLiveAt: info.live ? when : (info.lastLiveAt || prev.lastLiveAt || ""),
      checkedAt: when,
      detail: info.detail || "",
      backoffUntil: "",
      backoffStep: 0
    };
    await env.DATA.put("owner/tiktok.json", JSON.stringify(doc));
  } catch (err) { /* the player still gets this response */ }
}

function serveMime(row) {
  const mime = String((row && row.mime) || "");
  const key = String((row && row.object_key) || "");
  if (mime && mime !== "application/octet-stream") return mime;
  if (/\/video$/.test(key) || /\.mp4$/i.test(key)) return "video/mp4";
  return mime || "application/octet-stream";
}

function blockedPayload(handle, prev, streams) {
  const body = {
    handle,
    live: !!(prev && prev.live),
    viewers: prev && prev.live ? (prev.viewers || 0) : 0,
    title: prev && prev.live ? (prev.title || "") : "",
    blocked: true
  };
  if (!streams) return body;
  body.roomId = (prev && prev.roomId) || "";
  body.quality = (prev && prev.quality) || "";
  body.qualityNote = (prev && prev.qualityNote) || "";
  body.lastLiveAt = (prev && prev.lastLiveAt) || "";
  body.detail = "TikTok blocked the runner";
  body.hls = "";
  body.flv = "";
  return body;
}

async function noteBlock(env, handle, kind, retryAfter, prev) {
  if (!env.DATA) return;
  try {
    let doc = await readOwnerDoc(env);
    if (!doc || typeof doc !== "object") doc = {};
    if (!doc.live || typeof doc.live !== "object") doc.live = {};
    const current = doc.live[handle] && typeof doc.live[handle] === "object" ? doc.live[handle] : (prev || {});
    const paced = backoffSeconds(current.backoffStep, retryAfter);
    const until = new Date(Date.now() + paced.seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    doc.live[handle] = Object.assign({}, current, {
      handle,
      backoffUntil: until,
      backoffStep: paced.nextStep,
      checkedAt: stamp(),
      detail: "TikTok blocked the runner"
    });
    if (!doc.tiktokHealth || typeof doc.tiktokHealth !== "object") doc.tiktokHealth = {};
    const recent = Array.isArray(doc.tiktokHealth.recent) ? doc.tiktokHealth.recent : [];
    recent.push({ at: stamp(), handle, status: kind });
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    doc.tiktokHealth.recent = recent.filter((row) => row && Date.parse(row.at) >= cutoff).slice(-80);
    await env.DATA.put("owner/tiktok.json", JSON.stringify(doc));
  } catch (err) { /* the player still gets the blocked response */ }
}

function tiktokHealthView(doc) {
  const health = doc && doc.tiktokHealth && typeof doc.tiktokHealth === "object" ? doc.tiktokHealth : {};
  const recent = Array.isArray(health.recent) ? health.recent : [];
  const hour = Date.now() - 60 * 60 * 1000;
  const counts = { "403": 0, "429": 0, "503": 0, captcha: 0 };
  recent.forEach((row) => {
    if (!row || Date.parse(row.at) < hour) return;
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1;
  });
  const backoffs = [];
  const live = doc && doc.live && typeof doc.live === "object" ? doc.live : {};
  Object.keys(live).forEach((name) => {
    const row = live[name];
    if (!backoffActive(row)) return;
    backoffs.push({ handle: (row && row.handle) || name, until: row.backoffUntil });
  });
  return {
    blocked403: counts["403"],
    blocked429: counts["429"],
    blocked503: counts["503"],
    captcha: counts.captcha,
    backoffs
  };
}

async function handleTikTokHealth(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  if (row.owner !== 1) return json(403, { error: "forbidden" });
  const doc = await readOwnerDoc(env);
  return json(200, tiktokHealthView(doc || {}));
}

async function fetchRoom(roomId) {
  const upstream = await fetch("https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=" + encodeURIComponent(roomId), {
    headers: { "user-agent": PLAY_UA, accept: "application/json", "accept-language": "en-US,en;q=0.9" }
  });
  const text = await upstream.text();
  return { status: upstream.status, text, retryAfter: retryAfterSeconds(upstream) };
}

async function handleLiveStats(request, env, handle, gate, prev) {
  const url = new URL(request.url);
  let roomId = String(url.searchParams.get("room") || "");
  if (!/^[1-9][0-9]{5,24}$/.test(roomId)) roomId = String((prev && prev.roomId) || "");
  if (!/^[1-9][0-9]{5,24}$/.test(roomId)) return json(200, { handle, live: false, viewers: 0, title: "" });
  const cached = await cacheRead("https://live-stats.internal/" + roomId, 10000);
  if (cached) return json(200, { handle, live: !!cached.live, viewers: cached.viewers || 0, title: cached.title || "" });
  const paced = await rateHit(env, "live:" + gate.row.public_id, 240, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  let upstream = null;
  try {
    upstream = await fetchRoom(roomId);
  } catch (err) {
    return json(200, { handle, live: !!(prev && prev.live), viewers: (prev && prev.viewers) || 0, title: (prev && prev.title) || "" });
  }
  const kind = challengeKind(upstream.status, upstream.text);
  if (kind) {
    await noteBlock(env, handle, kind, upstream.retryAfter, prev);
    return json(200, blockedPayload(handle, prev, false));
  }
  let parsed = {};
  try { parsed = JSON.parse(upstream.text || "{}"); } catch (err) { parsed = {}; }
  const stats = roomStats(parsed);
  const body = { live: !!stats.live, viewers: stats.viewers || 0, title: stats.title || "" };
  await cacheWrite("https://live-stats.internal/" + roomId, body, 10);
  return json(200, { handle, live: body.live, viewers: body.viewers, title: body.title });
}

function liveInfo(handle, prev, roomId, picked) {
  return {
    handle,
    blocked: false,
    live: !!picked.live,
    viewers: picked.viewers || 0,
    title: picked.title || "",
    roomId,
    quality: picked.quality || "",
    qualityNote: picked.qualityNote || "",
    hls: picked.hls || "",
    flv: picked.flv || "",
    lastLiveAt: picked.live ? stamp() : ((prev && prev.lastLiveAt) || ""),
    detail: ""
  };
}

async function handleOwnerLive(request, env, rawHandle) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  let handle = rawHandle;
  try { handle = decodeURIComponent(rawHandle); } catch (err) { /* keep the raw segment */ }
  if (!TIKTOK_HANDLE.test(handle)) return json(400, { error: "bad_handle" });
  const stored = await readOwnerDoc(env);
  const prev = stored && stored.live && stored.live[handle] ? stored.live[handle] : {};
  const statsOnly = new URL(request.url).searchParams.get("stats") === "1";
  if (backoffActive(prev)) return json(200, blockedPayload(handle, prev, !statsOnly));
  if (statsOnly) return handleLiveStats(request, env, handle, gate, prev);
  const roomKey = "https://live-roomid.internal/" + handle.toLowerCase();
  let roomId = "";
  const roomCached = await cacheRead(roomKey, 5 * 60 * 1000);
  if (roomCached && /^[1-9][0-9]{5,24}$/.test(String(roomCached.roomId || ""))) roomId = String(roomCached.roomId);
  if (!roomId && /^[1-9][0-9]{5,24}$/.test(String(prev.roomId || ""))) {
    const checked = Date.parse(prev.checkedAt || "");
    if (Number.isFinite(checked) && Date.now() - checked < 5 * 60 * 1000) roomId = String(prev.roomId);
  }
  if (roomId) {
    const saved = await cacheRead("https://live-stream.internal/" + roomId, 10000);
    if (saved && isTopQuality(saved.quality) && saved.hls) return json(200, liveInfo(handle, prev, roomId, saved));
  }
  const paced = await rateHit(env, "live:" + gate.row.public_id, 240, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  if (!roomId) {
    const livePage = await fetchPublic("https://www.tiktok.com/@" + handle + "/live");
    const pageKind = challengeKind(livePage.status, livePage.text);
    if (pageKind) {
      await noteBlock(env, handle, pageKind, livePage.retryAfter, prev);
      return json(200, blockedPayload(handle, prev, true));
    }
    roomId = parseRoomId(livePage.text);
    if (!roomId) {
      const profile = await fetchPublic("https://www.tiktok.com/@" + handle);
      const profileKind = challengeKind(profile.status, profile.text);
      if (profileKind) {
        await noteBlock(env, handle, profileKind, profile.retryAfter, prev);
        return json(200, blockedPayload(handle, prev, true));
      }
      roomId = parseRoomId(profile.text);
    }
    if (roomId) await cacheWrite(roomKey, { roomId }, 300);
  }
  if (!roomId) {
    const info = { live: false, roomId: "", viewers: 0, title: "", detail: "TikTok did not include a room id", lastLiveAt: prev.lastLiveAt || "", hls: "", flv: "", quality: "", qualityNote: "" };
    await rememberLive(env, handle, info);
    return json(200, Object.assign({ handle, blocked: false }, info));
  }
  const saved = await cacheRead("https://live-stream.internal/" + roomId, 10000);
  if (saved && isTopQuality(saved.quality) && saved.hls) return json(200, liveInfo(handle, prev, roomId, saved));
  let room = null;
  try {
    room = await fetchRoom(roomId);
  } catch (err) {
    return json(200, {
      handle,
      live: !!prev.live,
      viewers: prev.live ? (prev.viewers || 0) : 0,
      title: prev.live ? (prev.title || "") : "",
      roomId,
      quality: prev.quality || "",
      qualityNote: prev.qualityNote || "",
      hls: "",
      flv: "",
      blocked: false,
      lastLiveAt: prev.lastLiveAt || "",
      detail: ""
    });
  }
  const roomKind = challengeKind(room.status, room.text);
  if (roomKind) {
    await noteBlock(env, handle, roomKind, room.retryAfter, prev);
    return json(200, blockedPayload(handle, prev, true));
  }
  let parsed = {};
  try { parsed = JSON.parse(room.text || "{}"); } catch (err) { parsed = {}; }
  const picked = pickStreams(parsed);
  if (isTopQuality(picked.quality) && picked.hls) {
    await cacheWrite("https://live-stream.internal/" + roomId, {
      live: !!picked.live,
      viewers: picked.viewers || 0,
      title: picked.title || "",
      quality: picked.quality || "",
      qualityNote: "",
      hls: picked.hls || "",
      flv: picked.flv || ""
    }, 10);
  }
  const info = liveInfo(handle, prev, roomId, picked);
  await rememberLive(env, handle, info);
  return json(200, info);
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

function dropBody(upstream) {
  if (!upstream || !upstream.body || !upstream.body.cancel) return;
  const dropped = upstream.body.cancel();
  if (dropped && dropped.catch) dropped.catch(function () {});
}

function streamMedia(upstream) {
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  const range = upstream.headers.get("content-range");
  if (range) headers.set("content-range", range);
  const ranges = upstream.headers.get("accept-ranges");
  if (ranges) headers.set("accept-ranges", ranges);
  headers.set("cache-control", "private, no-store");
  headers.set("cdn-cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
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
  const paced = await rateHit(env, "live-media:" + gate.row.public_id, 1200, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const headers = new Headers();
  headers.set("user-agent", PLAY_UA);
  headers.set("accept", "*/*");
  headers.set("referer", "https://www.tiktok.com/");
  headers.set("origin", "https://www.tiktok.com");
  const range = request.headers.get("range") || "";
  if (/^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
  let upstream = null;
  try {
    upstream = await fetch(parsed.toString(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
  } catch (err) {
    return json(502, { error: "upstream" });
  }
  let finalHost = "";
  try { finalHost = new URL(upstream.url).hostname; } catch (err) { finalHost = ""; }
  if (!mediaHostOk(finalHost)) {
    dropBody(upstream);
    return json(400, { error: "bad_url" });
  }
  const type = upstream.headers.get("content-type") || "";
  const playlist = parsed.pathname.endsWith(".m3u8") || /mpegurl|m3u8/i.test(type);
  if (!playlist) return streamMedia(upstream);
  const length = Number(upstream.headers.get("content-length") || 0);
  if (length > 2000000) {
    dropBody(upstream);
    return json(413, { error: "too_large" });
  }
  const text = await upstream.text();
  if (text.length > 2000000) return json(413, { error: "too_large" });
  if (text.indexOf("#EXTM3U") >= 0) {
    return new Response(rewritePlaylist(text, upstream.url || parsed.toString(), request), {
      status: upstream.status,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "private, no-store",
        "cdn-cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": type || "application/octet-stream",
      "cache-control": "private, no-store",
      "cdn-cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
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

const ARCHIVE_NAME = /^[a-f0-9]{64}\.(?:jpe?g|png|webp|gif|mp4|webm|json)$/;

function archiveType(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  return "application/json; charset=utf-8";
}

function archiveRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || size < 1) return null;
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    const tail = end;
    if (!Number.isFinite(tail) || tail <= 0) return null;
    start = Math.max(0, size - tail);
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1, end };
}

async function handleArchive(request, env, name) {
  if (!ARCHIVE_NAME.test(name)) return json(404, { error: "not_found" });
  if (!env.DATA) return json(503, { error: "not_configured" });
  const key = "archive/" + name;
  if (request.method === "HEAD") {
    const head = await env.DATA.head(key);
    if (!head) return json(404, { error: "not_found" });
    const headers = {
      "content-type": archiveType(name),
      "cache-control": "public, max-age=31536000, immutable",
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff"
    };
    if (head.size) headers["content-length"] = String(head.size);
    return new Response(null, { status: 200, headers });
  }
  const head = await env.DATA.head(key);
  if (!head) return json(404, { error: "not_found" });
  const size = Number(head.size || 0);
  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? archiveRange(rangeHeader, size) : null;
  if (rangeHeader && !range) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + size } });
  const object = range ? await env.DATA.get(key, { range: { offset: range.offset, length: range.length } }) : await env.DATA.get(key);
  if (!object) return json(404, { error: "not_found" });
  const headers = {
    "content-type": archiveType(name),
    "cache-control": "public, max-age=31536000, immutable",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff"
  };
  if (range) {
    headers["content-range"] = "bytes " + range.offset + "-" + range.end + "/" + size;
    headers["content-length"] = String(range.length);
    return new Response(object.body, { status: 206, headers });
  }
  if (object.size) headers["content-length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
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

const TG_PATH_TTL_MS = 50 * 60 * 1000;
const TG_USER_LIMIT = 1200;
const TG_VERIFY_LIMIT = 4000;
const TG_ANON_LIMIT = 60;
const TG_LOOP_LIMIT = 800;
const TG_WINDOW_MS = 60 * 60 * 1000;

function tgUserLimit(env) {
  const n = Number(env && env.TG_USER_LIMIT);
  if (!Number.isFinite(n) || n < 1 || n > 100000) return TG_USER_LIMIT;
  return Math.floor(n);
}

async function chargePlayback(env, request, verify) {
  if (verify) return rateHit(env, "tg-verify", TG_VERIFY_LIMIT, TG_WINDOW_MS);
  return rateHit(env, "tg:" + clientIp(request), tgUserLimit(env), TG_WINDOW_MS);
}

async function chargeFileOnce(env, request, verify, key) {
  if (verify || !key) return chargePlayback(env, request, verify);
  const now = Date.now();
  const bucket = "tg-file:" + clientIp(request) + ":" + key;
  const seen = await env.DB.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket = ?").bind(bucket).first();
  if (seen && Number(seen.reset_at) > now && Number(seen.hits) >= 1) return { ok: true, retry: 0 };
  const budget = await chargePlayback(env, request, false);
  if (!budget.ok) return budget;
  await env.DB.prepare("INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = 1, reset_at = excluded.reset_at").bind(bucket, now + TG_WINDOW_MS).run();
  return budget;
}

async function segmentCached(row) {
  if (!row || !row.sha256) return false;
  try {
    const hit = await caches.default.match(new Request("https://tg-cache.internal/body/" + row.sha256));
    return !!hit;
  } catch (err) {
    return false;
  }
}
const LOOP_PUBLIC = /^loop\/[A-Za-z0-9._-]{1,80}(?:\/aac)?(?:\/(?:index\.m3u8|init|\d+))?$/;

function loopGroupKey(key) {
  return /^loop\/[A-Za-z0-9._-]{1,80}(?:\/aac)?$/.test(String(key || ""));
}

function tiktokPlaybackKey(raw) {
  const text = String(raw || "").replace(/\/(?:index\.m3u8|init|\d+)$/, "");
  return /^tiktok\/[A-Za-z0-9._]{2,24}\/\d{8,22}\/(?:video|poster|photo\/\d{1,3})$/.test(text);
}

function tiktokLiveKey(raw) {
  const text = String(raw || "").replace(/\/(?:index\.m3u8|init|\d+)$/, "");
  return /^tiktok\/[A-Za-z0-9._]{2,24}\/[1-9][0-9]{5,24}\/live\/[1-9][0-9]{0,3}$/.test(text);
}

function publicLoopCache() {
  return {
    "cache-control": "public, max-age=31536000, immutable",
    "cdn-cache-control": "public, max-age=31536000, immutable"
  };
}

function telegramSecretKey(key) {
  const raw = String(key || "");
  const name = (raw.split("/").pop() || "").toLowerCase();
  if (!raw || raw.indexOf("..") >= 0) return true;
  if (raw.startsWith("owner/") || raw.startsWith("backup/") || raw === "loop/current.json") return true;
  if (name === "key.bin" || name === "key" || name.endsWith(".key")) return true;
  if (raw.startsWith("music/") && name.endsWith(".bin")) return true;
  if (name.indexOf("token") >= 0 || name.indexOf("secret") >= 0) return true;
  return false;
}

const AVATAR_MEDIA = /^media\/avatars\/(\d{12})\/([a-f0-9]{64})\.(webp|jpg|png)$/;
const ownerMediaCache = { at: 0, keys: null };

function addOwnerMediaKey(value, into) {
  const raw = String(value || "").trim();
  if (!raw || raw.indexOf("..") >= 0) return;
  let path = "";
  if (/^(?:archive|music|covers|radio|loop|media|stories)\//.test(raw)) path = raw.split("?")[0];
  else {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (host === "r2.dev" || host.endsWith(".r2.dev") || host.endsWith(".workers.dev")) {
        path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        if (path.startsWith("v1/archive/")) path = "archive/" + path.slice("v1/archive/".length);
        if (path.startsWith("tg/")) path = path.slice(3);
      }
    } catch (err) { path = ""; }
  }
  if (!path || path.indexOf("..") >= 0) return;
  path = path.split("?")[0];
  if (/^(?:archive|music|covers|radio|loop|media|stories)\//.test(path)) into.add(path);
}

function collectOwnerMedia(value, env, into) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item) && ownerOnlyItem(item, env)) {
        const walk = (node) => {
          if (typeof node === "string") addOwnerMediaKey(node, into);
          else if (Array.isArray(node)) node.forEach(walk);
          else if (node && typeof node === "object") Object.keys(node).forEach((name) => walk(node[name]));
        };
        walk(item);
        if (String(item.platform || "").toLowerCase() !== "tiktok") socialKeysForPost(item).forEach((key) => into.add(key));
      } else collectOwnerMedia(item, env, into);
    });
    return;
  }
  if (value && typeof value === "object") Object.keys(value).forEach((name) => collectOwnerMedia(value[name], env, into));
}

async function ownerOnlyMedia(env) {
  const now = Date.now();
  if (ownerMediaCache.keys && now - ownerMediaCache.at < 60000) return ownerMediaCache.keys;
  const keys = new Set();
  if (env.DATA) {
    for (const name of ["feeds.json", "stories.json"]) {
      const object = await env.DATA.get(name);
      if (!object) continue;
      try { collectOwnerMedia(JSON.parse(await object.text()), env, keys); }
      catch (err) { /* a bad catalog does not open owner-only media */ }
    }
  }
  ownerMediaCache.at = now;
  ownerMediaCache.keys = keys;
  return keys;
}

async function hiddenAvatar(env, viewer, key) {
  const match = AVATAR_MEDIA.exec(String(key || ""));
  if (!match || !env.DB) return false;
  const owner = await env.DB.prepare("SELECT public_id, hide_avatar FROM accounts WHERE public_id = ?").bind(match[1]).first();
  if (!owner || !cleanHide(owner.hide_avatar)) return false;
  return !viewer || viewer.public_id !== owner.public_id;
}

function bearerIsBot(env, request) {
  const token = bearer(request);
  const secret = String(env.TELEGRAM_BOT_TOKEN || "");
  if (!token || !secret || token.length > 200 || secret.length > 200) return false;
  return timingEqual(token, secret);
}

async function telegramRows(env, key) {
  const listed = await env.DB.prepare("SELECT object_key, kind, part_index, file_id, size, sha256, mime, duration, serve, encrypted FROM telegram_files WHERE object_key = ? AND serve = 1 AND encrypted = 0").bind(key).all();
  return (listed && listed.results) || [];
}

const tgInflight = new Map();

function shareInflight(key, run) {
  const existing = tgInflight.get(key);
  if (existing) return existing;
  const job = Promise.resolve().then(run).catch(() => null).finally(() => {
    if (tgInflight.get(key) === job) tgInflight.delete(key);
  });
  tgInflight.set(key, job);
  return job;
}

async function readCachedPath(cache, cacheKey) {
  const hit = await cache.match(cacheKey);
  if (!hit) return "";
  const fetched = Number(hit.headers.get("x-fetched-at") || 0);
  if (!fetched || Date.now() - fetched >= TG_PATH_TTL_MS) return "";
  try {
    const body = await hit.json();
    return safeTelegramPath(body && body.path);
  } catch (err) {
    return "";
  }
}

async function telegramFilePath(env, fileId) {
  const cache = caches.default;
  const cacheKey = new Request("https://tg-cache.internal/path/" + encodeURIComponent(fileId));
  const cached = await readCachedPath(cache, cacheKey);
  if (cached) return cached;
  const loaded = await shareInflight("path:" + fileId, async () => {
    const again = await readCachedPath(cache, cacheKey);
    if (again) return again;
    const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/getFile?file_id=" + encodeURIComponent(fileId));
    let data = null;
    try { data = await res.json(); }
    catch (err) { data = null; }
    const path = safeTelegramPath(data && data.ok && data.result && data.result.file_path);
    if (!path) return "";
    const stored = new Response(JSON.stringify({ path: path }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3000",
        "x-fetched-at": String(Date.now())
      }
    });
    try { await cache.put(cacheKey, stored); }
    catch (err) { /* the path can still be used for this request */ }
    return path;
  });
  return loaded || "";
}

async function telegramBody(env, row) {
  const id = String((row && (row.sha256 || row.file_id)) || "");
  if (!id) return null;
  const cache = caches.default;
  const cacheKey = new Request("https://tg-cache.internal/body/" + id);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const packed = await shareInflight("body:" + id, async () => {
    const again = await cache.match(cacheKey);
    if (again) {
      return { bytes: await again.arrayBuffer(), mime: again.headers.get("content-type") || row.mime || "application/octet-stream" };
    }
    const path = await telegramFilePath(env, row.file_id);
    if (!path) return null;
    const upstream = await fetch("https://api.telegram.org/file/bot" + env.TELEGRAM_BOT_TOKEN + "/" + path);
    if (!upstream.ok) return null;
    const bytes = await upstream.arrayBuffer();
    if (Number(row.size) > 0 && bytes.byteLength !== Number(row.size)) return null;
    const mime = row.mime || "application/octet-stream";
    const stored = new Response(bytes.slice(0), {
      headers: {
        "content-type": mime,
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff"
      }
    });
    try { await cache.put(cacheKey, stored.clone()); }
    catch (err) { /* this response is still returned */ }
    return { bytes: bytes, mime: mime };
  });
  if (!packed || !packed.bytes) return null;
  return new Response(packed.bytes.slice(0), {
    headers: {
      "content-type": packed.mime || "application/octet-stream",
      "content-length": String(packed.bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff"
    }
  });
}

function mediaResponse(bytes, mime, status, extra) {
  const headers = {
    "content-type": mime || "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000",
    "x-content-type-options": "nosniff"
  };
  if (extra) Object.keys(extra).forEach((name) => { headers[name] = extra[name]; });
  return new Response(bytes, { status: status, headers: headers });
}

async function rangedTelegram(request, env, row, immutable) {
  const full = await telegramBody(env, row);
  if (!full) return json(502, { error: "unavailable" });
  const bytes = await full.arrayBuffer();
  const mime = serveMime(row) || full.headers.get("content-type") || "application/octet-stream";
  const span = parseRange(request.headers.get("Range"), bytes.byteLength);
  const extra = immutable ? publicLoopCache() : { "cache-control": "private, max-age=31536000, immutable" };
  if (span === false) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": "bytes */" + bytes.byteLength, "cache-control": "no-store" }
    });
  }
  if (!span) return mediaResponse(bytes, mime, 200, extra);
  const slice = bytes.slice(span.start, span.end + 1);
  return mediaResponse(slice, mime, 206, Object.assign({
    "content-range": "bytes " + span.start + "-" + span.end + "/" + bytes.byteLength
  }, extra || {}));
}

async function handleTelegram(request, env, path) {
  if (!env.DB) return json(503, { error: "not_configured" });
  const raw = path.replace(/^\/tg\/?/, "");
  let decoded = raw;
  try { decoded = raw.split("/").map((part) => decodeURIComponent(part)).join("/"); }
  catch (err) { return json(404, { error: "not_found" }); }
  if (!decoded || decoded.indexOf("..") >= 0 || decoded.charAt(0) === "/" || decoded.indexOf("\\") >= 0) return json(404, { error: "not_found" });
  const publicLoop = LOOP_PUBLIC.test(decoded);
  const verify = bearerIsBot(env, request);
  let viewer = null;
  if (publicLoop) {
    if (!env.TELEGRAM_BOT_TOKEN) return json(503, { error: "not_configured" });
    const budget = await rateHit(env, verify ? "tg-verify" : "tg-loop:" + clientIp(request), verify ? TG_VERIFY_LIMIT : TG_LOOP_LIMIT, TG_WINDOW_MS);
    if (!budget.ok) return limited(budget);
  } else {
    viewer = await sessionAccount(env, request);
    if (!viewer && !verify) {
      const anon = await rateHit(env, "tg-anon:" + clientIp(request), TG_ANON_LIMIT, TG_WINDOW_MS);
      if (!anon.ok) return limited(anon);
      return json(401, { error: "unauthorized" });
    }
    if (!env.TELEGRAM_BOT_TOKEN) return json(503, { error: "not_configured" });
  }
  if (telegramSecretKey(decoded)) return json(404, { error: "not_found" });
  let key = decoded;
  let mode = "file";
  let index = 0;
  const exact = await env.DB.prepare("SELECT kind FROM telegram_files WHERE object_key = ? AND kind = 'single' AND serve = 1 AND encrypted = 0").bind(decoded).first();
  if (exact) {
    key = decoded;
    mode = "file";
  } else if (decoded.endsWith("/index.m3u8")) {
    key = decoded.slice(0, -"/index.m3u8".length);
    mode = "playlist";
  } else if (decoded.endsWith("/init")) {
    key = decoded.slice(0, -"/init".length);
    mode = "init";
  } else {
    const nested = decoded.match(/^(.*)\/(\d+)$/);
    if (nested) {
      const parent = await env.DB.prepare("SELECT part_index FROM telegram_files WHERE object_key = ? AND kind = 'segment' AND part_index = ? AND serve = 1 AND encrypted = 0").bind(nested[1], Number(nested[2])).first();
      if (parent) {
        key = nested[1];
        index = Number(nested[2]);
        mode = "segment";
      }
    }
  }
  if (!key || telegramSecretKey(key)) return json(404, { error: "not_found" });
  if (!publicLoop && !verify) {
    if (await hiddenAvatar(env, viewer, decoded) || await hiddenAvatar(env, viewer, key)) return json(404, { error: "not_found" });
    if ((tiktokLiveKey(decoded) || tiktokLiveKey(key)) && (!viewer || viewer.owner !== 1)) {
      return json(403, { error: "forbidden" });
    }
    if ((tiktokPlaybackKey(decoded) || tiktokPlaybackKey(key)) && !tiktokPublic(env) && (!viewer || viewer.owner !== 1)) {
      return json(403, { error: "forbidden" });
    }
    const owned = await ownerOnlyMedia(env);
    if (owned.has(decoded) || owned.has(key)) {
      if (!viewer || viewer.owner !== 1) return json(403, { error: "forbidden" });
    }
  }
  if (mode === "playlist") {
    const rows = await telegramRows(env, key);
    const text = buildPlaylist(rows, key, new URL(request.url).origin);
    if (!text) {
      if (!publicLoop && !(viewer && viewer.owner === 1)) {
        const missed = await chargePlayback(env, request, verify);
        if (!missed.ok) return limited(missed);
      }
      return json(404, { error: "not_found" });
    }
    if (!publicLoop) {
      const budget = await chargePlayback(env, request, verify);
      if (!budget.ok) return limited(budget);
      if (viewer) await slideSession(env, request);
    }
    const immutable = loopGroupKey(key);
    const headers = {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "private, max-age=60",
      "x-content-type-options": "nosniff"
    };
    if (immutable) headers["cdn-cache-control"] = "public, max-age=31536000, immutable";
    return new Response(text, { status: 200, headers: headers });
  }
  const kind = mode === "init" ? "init" : mode === "segment" ? "segment" : "single";
  const partIndex = mode === "segment" ? index : mode === "init" ? -1 : 0;
  const row = await env.DB.prepare("SELECT object_key, kind, part_index, file_id, size, sha256, mime, duration, serve, encrypted FROM telegram_files WHERE object_key = ? AND kind = ? AND part_index = ? AND serve = 1 AND encrypted = 0").bind(key, kind, partIndex).first();
  if (!publicLoop) {
    const ownerPart = !!(viewer && viewer.owner === 1 && (mode === "segment" || mode === "init"));
    const cached = !ownerPart && (mode === "segment" || mode === "init") && await segmentCached(row);
    if (!ownerPart && !cached) {
      const budget = mode === "file"
        ? await chargeFileOnce(env, request, verify, key)
        : await chargePlayback(env, request, verify);
      if (!budget.ok) return limited(budget);
    }
    if (viewer && mode === "file" && row && row.file_id) await slideSession(env, request);
  }
  if (!row || !row.file_id) {
    if (mode === "file") {
      const original = await serveKeptOriginal(request, env, key);
      if (original) return original;
    }
    return json(404, { error: "not_found" });
  }
  return rangedTelegram(request, env, row, loopGroupKey(key));
}

async function serveKeptOriginal(request, env, key) {
  if (!keptVideoKey(key) || !env.DATA) return null;
  const head = await env.DATA.head(key);
  if (!head) return null;
  const size = Number(head.size || 0);
  const mime = (head.httpMetadata && head.httpMetadata.contentType) || "video/mp4";
  const headers = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff"
  };
  if (request.method === "HEAD") {
    if (size) headers["content-length"] = String(size);
    return new Response(null, { status: 200, headers });
  }
  const rangeHeader = request.headers.get("Range");
  const range = rangeHeader ? archiveRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    return new Response(null, { status: 416, headers: { "content-range": "bytes */" + size, "cache-control": "no-store" } });
  }
  const object = range
    ? await env.DATA.get(key, { range: { offset: range.offset, length: range.length } })
    : await env.DATA.get(key);
  if (!object) return null;
  if (range) {
    headers["content-range"] = "bytes " + range.offset + "-" + range.end + "/" + size;
    headers["content-length"] = String(range.length);
    return new Response(object.body, { status: 206, headers });
  }
  if (size) headers["content-length"] = String(size);
  else if (object.size) headers["content-length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
}

const TIKTOK_ACCOUNTS_KEY = "owner/tiktok-accounts.json";
const TIKTOK_ACCOUNT_CAP = 50;

function emptyTikTokAccounts() {
  return { added: [], removed: [] };
}

function foldHandle(value) {
  return String(value || "").toLowerCase();
}

function sameTikTokHandle(left, right) {
  const a = foldHandle(left);
  const b = foldHandle(right);
  return !!a && a === b;
}

function normalizeTikTokInput(raw) {
  let text = String(raw || "").trim();
  if (!text || text.length > 300) return "";
  const fromUrl = text.match(/^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{2,24})(?:[/?#]|$)/i);
  if (fromUrl) return fromUrl[1];
  if (/^https?:\/\//i.test(text)) return "";
  text = text.replace(/^@+/, "");
  const bare = text.match(/^([A-Za-z0-9._]{2,24})$/);
  return bare ? bare[1] : "";
}

function publicTikTokAccount(row) {
  return {
    handle: row.handle,
    name: row.name || "",
    avatar: row.avatar || "",
    addedAt: row.addedAt || ""
  };
}

async function readTikTokAccounts(env) {
  if (!env.DATA) return emptyTikTokAccounts();
  const object = await env.DATA.get(TIKTOK_ACCOUNTS_KEY);
  if (!object) return emptyTikTokAccounts();
  try {
    const parsed = JSON.parse(await object.text());
    if (!parsed || typeof parsed !== "object") return emptyTikTokAccounts();
    const added = [];
    let dirty = false;
    const rows = Array.isArray(parsed.added) ? parsed.added : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== "object") { dirty = true; continue; }
      const handle = normalizeTikTokInput(row.handle);
      if (!handle) { dirty = true; continue; }
      if (row.handle !== handle) dirty = true;
      added.push(Object.assign({}, row, { handle }));
    }
    const removed = [];
    const gone = Array.isArray(parsed.removed) ? parsed.removed : [];
    for (let i = 0; i < gone.length; i++) {
      const handle = normalizeTikTokInput(gone[i]);
      if (!handle) { dirty = true; continue; }
      if (gone[i] !== handle) dirty = true;
      if (!removed.some((item) => sameTikTokHandle(item, handle))) removed.push(handle);
    }
    return { added, removed, dirty };
  } catch (err) {
    return emptyTikTokAccounts();
  }
}

async function writeTikTokAccounts(env, doc) {
  const body = JSON.stringify({
    added: (doc.added || []).slice(0, TIKTOK_ACCOUNT_CAP),
    removed: (doc.removed || []).slice(-200)
  });
  await env.DATA.put(TIKTOK_ACCOUNTS_KEY, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" }
  });
}

function unescapeJson(value) {
  try { return JSON.parse('"' + value + '"'); }
  catch (err) { return value; }
}

function previewFromHtml(html, handle) {
  const text = String(html || "");
  const low = text.toLowerCase();
  if (low.indexOf("captcha") >= 0 || low.indexOf("captcha-verify") >= 0) return null;
  let name = "";
  let avatar = "";
  let unique = "";
  const nick = text.match(/"nickname"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (nick) name = unescapeJson(nick[1]);
  if (!name) {
    const og = text.match(/property="og:title"\s+content="([^"]+)"/i) || text.match(/content="([^"]+)"\s+property="og:title"/i);
    if (og) name = og[1].replace(/\s*\(@[^)]*\)\s*$/, "").replace(/\s*\| TikTok\s*$/i, "").trim();
  }
  const uniqueMatch = text.match(/"uniqueId"\s*:\s*"([A-Za-z0-9._]{2,24})"/);
  if (uniqueMatch) unique = uniqueMatch[1];
  const avatarMatch = text.match(/"avatarLarger"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (avatarMatch) avatar = unescapeJson(avatarMatch[1]);
  if (!avatar) {
    const ogi = text.match(/property="og:image"\s+content="([^"]+)"/i);
    if (ogi) avatar = ogi[1];
  }
  if (avatar.indexOf("http://") === 0) avatar = "https://" + avatar.slice(7);
  if (avatar && !/^https:\/\//.test(avatar)) avatar = "";
  if (Array.from(name).length > 80) name = Array.from(name).slice(0, 80).join("");
  if (unique && !sameTikTokHandle(unique, handle)) return { name: "", avatar: "", handle };
  return { name, avatar, handle: unique && TIKTOK_HANDLE.test(unique) ? unique : handle };
}

async function previewTikTokProfile(handle) {
  try {
    const page = await fetchPublic("https://www.tiktok.com/@" + encodeURIComponent(handle));
    if (page.status === 403 || page.status === 429 || page.status === 503) {
      return { handle, name: "", avatar: "", preview: false };
    }
    const parsed = previewFromHtml(page.text, handle);
    if (!parsed) return { handle, name: "", avatar: "", preview: false };
    const next = parsed.handle && TIKTOK_HANDLE.test(parsed.handle) ? parsed.handle : handle;
    return { handle: next, name: parsed.name || "", avatar: parsed.avatar || "", preview: !!(parsed.name || parsed.avatar) };
  } catch (err) {
    return { handle, name: "", avatar: "", preview: false };
  }
}

function tiktokRowMatches(row, handle) {
  if (sameTikTokHandle(row.handle, handle)) return true;
  const previous = Array.isArray(row.previousHandles) ? row.previousHandles : [];
  return previous.some((item) => sameTikTokHandle(item, handle));
}

async function dispatchWorkflows(env, files) {
  const token = String(env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) return false;
  let ok = false;
  for (let i = 0; i < files.length; i++) {
    try {
      const res = await fetch("https://api.github.com/repos/ViktorychGroup/ViktorychApp/actions/workflows/" + files[i] + "/dispatches", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "viktorych-accounts",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ref: "main" })
      });
      if (res.status === 204 || res.ok) ok = true;
    } catch (err) { /* the next scheduled run still picks the account up */ }
  }
  return ok;
}

async function dispatchAddedAccounts(env) {
  return dispatchWorkflows(env, ["tiktok-added.yml", "media-extract.yml", "tiktok-live.yml"]);
}

async function requireOwner(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return { error: json(401, { error: "unauthorized" }) };
  if (row.owner !== 1) return { error: json(403, { error: "forbidden" }) };
  return { row };
}

async function handleTikTokAccounts(request, env) {
  const gate = await requireOwner(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const bucket = "tiktok-accounts:" + gate.row.public_id;
  if (request.method === "GET") {
    const hit = await rateHit(env, bucket + ":list", 60, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const doc = await readTikTokAccounts(env);
    if (doc.dirty) await writeTikTokAccounts(env, doc);
    return json(200, { added: doc.added.map(publicTikTokAccount) });
  }
  if (request.method === "POST") {
    const hit = await rateHit(env, bucket + ":add", 20, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const body = await readJson(request, 2000);
    if (body.error) return json(400, { error: body.error });
    const typed = normalizeTikTokInput(body.handle || body.url || "");
    if (!typed) return json(400, { error: "bad_handle" });
    const doc = await readTikTokAccounts(env);
    const existing = doc.added.find((item) => tiktokRowMatches(item, typed));
    if (!existing && doc.added.length >= TIKTOK_ACCOUNT_CAP) return json(400, { error: "full" });
    const preview = await previewTikTokProfile(typed);
    const handle = preview.handle && sameTikTokHandle(preview.handle, typed) && TIKTOK_HANDLE.test(preview.handle) ? preview.handle : typed;
    doc.removed = doc.removed.filter((item) => !sameTikTokHandle(item, handle) && !sameTikTokHandle(item, typed));
    let row = doc.added.find((item) => tiktokRowMatches(item, handle) || tiktokRowMatches(item, typed));
    if (!row) {
      if (doc.added.length >= TIKTOK_ACCOUNT_CAP) return json(400, { error: "full" });
      row = {
        handle,
        name: preview.name || "",
        avatar: preview.avatar || "",
        addedAt: stamp(),
        permanentId: "",
        secUid: "",
        previousHandles: []
      };
      doc.added.push(row);
    } else {
      if (preview.name) row.name = preview.name;
      if (preview.avatar) row.avatar = preview.avatar;
      if (handle && !sameTikTokHandle(row.handle, handle)) {
        const old = row.handle;
        row.handle = handle;
        row.previousHandles = Array.isArray(row.previousHandles) ? row.previousHandles : [];
        if (old && !row.previousHandles.some((item) => sameTikTokHandle(item, old))) row.previousHandles.push(old);
      }
    }
    await writeTikTokAccounts(env, doc);
    let dispatched = false;
    try { dispatched = await dispatchAddedAccounts(env); }
    catch (err) { dispatched = false; }
    return json(200, { account: publicTikTokAccount(row), preview: !!preview.preview, dispatched });
  }
  return json(405, { error: "method" });
}

async function handleTikTokAccountDelete(request, env, rawHandle) {
  const gate = await requireOwner(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const hit = await rateHit(env, "tiktok-accounts:" + gate.row.public_id + ":remove", 30, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  let handle = rawHandle;
  try { handle = decodeURIComponent(rawHandle); }
  catch (err) { /* keep the raw segment */ }
  handle = normalizeTikTokInput(handle);
  if (!handle) return json(400, { error: "bad_handle" });
  const doc = await readTikTokAccounts(env);
  const row = doc.added.find((item) => tiktokRowMatches(item, handle));
  const gone = [];
  if (row) {
    gone.push(row.handle);
    (row.previousHandles || []).forEach((item) => gone.push(item));
  } else {
    gone.push(handle);
  }
  doc.added = doc.added.filter((item) => !tiktokRowMatches(item, handle));
  gone.forEach((item) => {
    const text = normalizeTikTokInput(item);
    if (!text) return;
    if (!doc.removed.some((have) => sameTikTokHandle(have, text))) doc.removed.push(text);
  });
  await writeTikTokAccounts(env, doc);
  return json(200, { removed: true, added: doc.added.map(publicTikTokAccount) });
}

const RECORDINGS_KEY = "owner/tiktok-recordings.json";
const LIVE_JOB_PREFIX = "owner/live-jobs/";
const BACKUP_CHANNELS_KEY = "owner/tiktok-backup-channels.json";
const CHANNEL_ID = /^-100\d{4,16}$/;
const LIVE_PLAY_KEY = /^tiktok\/[A-Za-z0-9._]{2,24}\/[1-9][0-9]{5,24}\/live$/;

async function readJsonKey(env, key) {
  if (!env.DATA) return null;
  try {
    const object = await env.DATA.get(key);
    if (!object) return null;
    const parsed = JSON.parse(await object.text());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function scrubRecording(row) {
  if (!row || typeof row !== "object") return null;
  const state = ["recording", "queued", "saved", "blocked"].indexOf(row.state) >= 0 ? row.state : "";
  if (!state) return null;
  const key = state === "saved" && LIVE_PLAY_KEY.test(String(row.key || "")) ? String(row.key) : "";
  return {
    state,
    quality: String(row.quality || ""),
    qualityNote: String(row.qualityNote || ""),
    title: String(row.title || "").slice(0, 180),
    cover: String(row.cover || "").slice(0, 400),
    startedAt: String(row.startedAt || ""),
    endedAt: String(row.endedAt || ""),
    duration: Number(row.duration) || 0,
    roomId: String(row.roomId || ""),
    parts: Number(row.parts) || 0,
    key,
    blocked: state === "blocked"
  };
}

async function handleRecordings(request, env) {
  const gate = await requireOwner(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const index = await readJsonKey(env, RECORDINGS_KEY) || {};
  const listed = index.items && typeof index.items === "object" ? index.items : {};
  const items = {};
  let active = 0;
  const names = Object.keys(listed);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!TIKTOK_HANDLE.test(name)) continue;
    const job = await readJsonKey(env, LIVE_JOB_PREFIX + name + ".json");
    const row = scrubRecording((job && job.public) || listed[name]);
    if (!row) continue;
    items[name] = row;
    if (row.state === "recording") active += 1;
  }
  const cap = Math.max(1, Math.min(12, Number(index.cap) || 12));
  return json(200, { cap, active, items });
}

function maskChannel(id) {
  return "••••" + String(id || "").slice(-2);
}

async function readBackupChannels(env) {
  const doc = await readJsonKey(env, BACKUP_CHANNELS_KEY);
  const rows = doc && Array.isArray(doc.channels) ? doc.channels : [];
  const out = [];
  rows.forEach((item) => {
    const text = String(item || "").trim();
    if (CHANNEL_ID.test(text) && out.indexOf(text) < 0) out.push(text);
  });
  return out;
}

async function handleBackupChannels(request, env) {
  const gate = await requireOwner(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const rows = await readBackupChannels(env);
  if (request.method === "GET") return json(200, { extra: rows.length, masks: rows.map(maskChannel) });
  const hit = await rateHit(env, "tiktok-channels:" + gate.row.public_id, 20, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 400);
  if (body.error) return json(400, { error: body.error });
  if (body.remove != null && body.remove !== "") {
    const index = Number(body.remove);
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return json(400, { error: "bad_channel" });
    rows.splice(index, 1);
  } else {
    const channel = String(body.channel || "").trim();
    if (!CHANNEL_ID.test(channel)) return json(400, { error: "bad_channel" });
    if (rows.indexOf(channel) < 0) {
      if (rows.length >= 8) return json(400, { error: "bad_channel" });
      rows.push(channel);
    }
  }
  await env.DATA.put(BACKUP_CHANNELS_KEY, JSON.stringify({ channels: rows }));
  return json(200, { extra: rows.length, masks: rows.map(maskChannel) });
}

const ADDED_ACCOUNTS_KEY = "owner/added-accounts.json";
const ADDED_ACCOUNT_CAP = 50;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_RESERVED = {
  home: 1, explore: 1, search: 1, settings: 1, i: 1, intent: 1, share: 1, compose: 1,
  messages: 1, notifications: 1, login: 1, signup: 1, tos: 1, privacy: 1, hashtag: 1,
  status: 1, jobs: 1, download: 1, about: 1, help: 1, terms: 1
};

function emptyAddedAccounts() {
  return { added: [], removed: [], removedIds: [] };
}

function sameXHandle(left, right) {
  const a = String(left || "").replace(/^@+/, "").toLowerCase();
  const b = String(right || "").replace(/^@+/, "").toLowerCase();
  return !!a && a === b;
}

function xHandleOk(value) {
  const text = String(value || "");
  return X_HANDLE.test(text) && !X_RESERVED[text.toLowerCase()];
}

function normalizeXInput(raw) {
  let text = String(raw || "").trim();
  if (!text || text.length > 300) return "";
  let handle = "";
  const screen = text.match(/[?&]screen_name=([A-Za-z0-9_]{1,15})(?:&|$)/i);
  if (screen) handle = screen[1];
  if (!handle) {
    const fromUrl = text.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i);
    if (fromUrl) handle = fromUrl[1];
  }
  if (!handle && !/^https?:\/\//i.test(text)) {
    const bare = text.replace(/^@+/, "").match(/^([A-Za-z0-9_]{1,15})$/);
    if (bare) handle = bare[1];
  }
  return xHandleOk(handle) ? handle : "";
}

function httpsUrl(value, max) {
  let text = String(value || "").trim();
  if (text.indexOf("http://") === 0) text = "https://" + text.slice(7);
  if (!/^https:\/\//i.test(text) || text.length > (max || 400) || /[\s<>]/.test(text)) return "";
  return text;
}

function xAvatar(url) {
  const text = httpsUrl(url, 400);
  if (!text) return "";
  return text.replace("_normal.", "_400x400.").replace("_bigger.", "_400x400.").replace("_mini.", "_400x400.");
}

function xBanner(url) {
  const text = httpsUrl(url, 400);
  if (!text) return "";
  if (text.indexOf("profile_banners/") >= 0 && !/\/\d+x\d+$/.test(text)) return text + "/1500x500";
  return text;
}

function xCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
}

function xText(value, max) {
  const text = String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text) return "";
  return Array.from(text).slice(0, max).join("");
}

function xBadge(kind) {
  const text = String(kind || "");
  if (!text || text === "none") return "";
  if (text === "individual") return "blue";
  if (text === "blue" || text === "business" || text === "government") return text;
  return "";
}

function xVerified(user) {
  const verification = user && user.verification;
  if (typeof verification === "string") return xBadge(verification);
  if (verification && typeof verification === "object") {
    const kind = xBadge(verification.type || verification.verified_type);
    if (kind) return kind;
    if (verification.verified || verification.is_verified) return "blue";
  }
  if (user && user.verified) return "blue";
  return "";
}

function xJoined(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80) return "";
  const when = Date.parse(text);
  if (!Number.isFinite(when)) return "";
  return new Date(when).toISOString().slice(0, 10);
}

function xWebsite(user) {
  const website = user && user.website;
  if (typeof website === "string") return httpsUrl(website, 300);
  if (website && typeof website === "object") return httpsUrl(website.url, 300);
  return "";
}

function profileFromXUser(user, fallback) {
  const handle = xHandleOk(user && user.screen_name) ? String(user.screen_name) : fallback;
  const id = String((user && user.id) || "");
  if (!xHandleOk(handle) || !/^\d{2,25}$/.test(id)) return null;
  const followers = xCount(user.followers);
  const following = xCount(user.following);
  const posts = xCount(user.tweets != null ? user.tweets : user.posts);
  const row = {
    id: "x:" + handle,
    handle,
    permanentId: id,
    name: xText(user.name, 80),
    avatar: xAvatar(user.avatar_url),
    banner: xBanner(user.banner_url),
    bio: xText(user.description, 280),
    location: xText(user.location, 80),
    website: xWebsite(user),
    joined: xJoined(user.joined),
    url: httpsUrl(user.url, 300) || ("https://x.com/" + handle),
    verifiedType: xVerified(user),
    addedAt: stamp(),
    previousHandles: []
  };
  if (followers != null) row.followers = followers;
  if (following != null) row.following = following;
  if (posts != null) row.postsCount = posts;
  return row;
}

function publicXAccount(row) {
  const out = {
    id: row.id || ("x:" + row.handle),
    handle: row.handle,
    name: row.name || "",
    avatar: row.avatar || "",
    banner: row.banner || "",
    bio: row.bio || "",
    url: row.url || ("https://x.com/" + row.handle),
    permanentId: row.permanentId || "",
    addedAt: row.addedAt || "",
    verifiedType: row.verifiedType || ""
  };
  if (row.location) out.location = row.location;
  if (row.website) out.website = row.website;
  if (row.joined) out.joined = row.joined;
  if (row.followers != null) out.followers = row.followers;
  if (row.following != null) out.following = row.following;
  if (row.postsCount != null) out.postsCount = row.postsCount;
  if (Array.isArray(row.previousHandles) && row.previousHandles.length) out.previousHandles = row.previousHandles.slice(0, 8);
  return out;
}

async function readAddedAccounts(env) {
  if (!env.DATA) return emptyAddedAccounts();
  const object = await env.DATA.get(ADDED_ACCOUNTS_KEY);
  if (!object) return emptyAddedAccounts();
  try {
    const parsed = JSON.parse(await object.text());
    if (!parsed || typeof parsed !== "object") return emptyAddedAccounts();
    const added = [];
    const rows = Array.isArray(parsed.added) ? parsed.added : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== "object") continue;
      const handle = normalizeXInput(row.handle);
      if (!handle) continue;
      added.push(Object.assign({}, row, { handle }));
    }
    const removed = [];
    const gone = Array.isArray(parsed.removed) ? parsed.removed : [];
    for (let i = 0; i < gone.length; i++) {
      const handle = normalizeXInput(gone[i]);
      if (!handle) continue;
      if (!removed.some((item) => sameXHandle(item, handle))) removed.push(handle);
    }
    const removedIds = [];
    const ids = Array.isArray(parsed.removedIds) ? parsed.removedIds : [];
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i] || "");
      if (!/^\d{2,25}$/.test(id) || removedIds.indexOf(id) >= 0) continue;
      removedIds.push(id);
    }
    return { added, removed, removedIds };
  } catch (err) {
    return emptyAddedAccounts();
  }
}

async function writeAddedAccounts(env, doc) {
  const body = JSON.stringify({
    added: (doc.added || []).slice(0, ADDED_ACCOUNT_CAP),
    removed: (doc.removed || []).slice(-200),
    removedIds: (doc.removedIds || []).slice(-200)
  });
  await env.DATA.put(ADDED_ACCOUNTS_KEY, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" }
  });
}

function xRowMatches(row, handle, permanentId) {
  if (handle && (sameXHandle(row.handle, handle) || (Array.isArray(row.previousHandles) && row.previousHandles.some((item) => sameXHandle(item, handle))))) return true;
  return !!(permanentId && String(row.permanentId || "") === permanentId);
}

async function lookupXProfile(handle) {
  let res;
  try {
    res = await fetch("https://api.fxtwitter.com/" + encodeURIComponent(handle), {
      headers: {
        "user-agent": PLAY_UA,
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9"
      },
      redirect: "manual"
    });
  } catch (err) {
    return { error: "unavailable" };
  }
  if (res.status >= 300 && res.status < 400) return { error: "unavailable" };
  if (res.status === 404) return { error: "not_found" };
  if (res.status === 403 || res.status === 429 || res.status === 503) return { error: "unavailable" };
  if (!res.ok) return { error: "unavailable" };
  let data = null;
  try { data = await res.json(); }
  catch (err) { return { error: "unavailable" }; }
  const user = data && data.user;
  if (!user || typeof user !== "object") return { error: "not_found" };
  if (user.protected === true) return { error: "not_found" };
  const profile = profileFromXUser(user, handle);
  if (!profile) return { error: "not_found" };
  return { profile };
}

async function requireOwnerHidden(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return { error: json(404, { error: "not_found" }) };
  if (row.owner !== 1) return { error: json(403, { error: "forbidden" }) };
  return { row };
}

function addedPlatform(request, url, body) {
  const query = url && url.searchParams ? String(url.searchParams.get("platform") || "") : "";
  const posted = body && body.platform != null ? String(body.platform || "") : "";
  const asked = (posted || query || "x").toLowerCase();
  return asked === "x" ? "x" : "";
}

async function handleAddedAccounts(request, env, url) {
  const gate = await requireOwnerHidden(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const bucket = "x-accounts:" + gate.row.public_id;
  if (request.method === "GET") {
    if (!addedPlatform(request, url, null)) return json(400, { error: "unsupported" });
    const hit = await rateHit(env, bucket + ":list", 60, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const doc = await readAddedAccounts(env);
    return json(200, { added: doc.added.map(publicXAccount) });
  }
  if (request.method === "POST") {
    const hit = await rateHit(env, bucket + ":add", 20, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const body = await readJson(request, 2000);
    if (body.error) return json(400, { error: body.error });
    if (!addedPlatform(request, url, body)) return json(400, { error: "unsupported" });
    const typed = normalizeXInput(body.handle || body.url || "");
    if (!typed) return json(400, { error: "bad_handle" });
    const doc = await readAddedAccounts(env);
    const looked = await lookupXProfile(typed);
    if (looked.error) return json(looked.error === "not_found" ? 404 : 503, { error: looked.error });
    const profile = looked.profile;
    const handle = profile.handle;
    const permanentId = profile.permanentId;
    doc.removed = doc.removed.filter((item) => !sameXHandle(item, handle) && !sameXHandle(item, typed));
    doc.removedIds = (doc.removedIds || []).filter((item) => item !== permanentId);
    let row = doc.added.find((item) => xRowMatches(item, handle, permanentId) || xRowMatches(item, typed, ""));
    if (!row && doc.added.length >= ADDED_ACCOUNT_CAP) return json(400, { error: "full" });
    if (!row) {
      row = profile;
      doc.added.push(row);
    } else {
      const old = row.handle;
      const keptId = row.id && /^x:[A-Za-z0-9_]{1,15}$/.test(row.id) ? row.id : profile.id;
      row.id = keptId;
      row.permanentId = permanentId;
      row.name = profile.name || row.name || "";
      row.avatar = profile.avatar || row.avatar || "";
      row.banner = profile.banner || row.banner || "";
      row.bio = profile.bio || row.bio || "";
      row.url = profile.url || row.url || ("https://x.com/" + handle);
      row.verifiedType = profile.verifiedType || row.verifiedType || "";
      if (profile.location) row.location = profile.location;
      if (profile.website) row.website = profile.website;
      if (profile.joined) row.joined = profile.joined;
      if (profile.followers != null) row.followers = profile.followers;
      if (profile.following != null) row.following = profile.following;
      if (profile.postsCount != null) row.postsCount = profile.postsCount;
      if (handle && !sameXHandle(old, handle)) {
        row.handle = handle;
        row.previousHandles = Array.isArray(row.previousHandles) ? row.previousHandles : [];
        if (old && !row.previousHandles.some((item) => sameXHandle(item, old))) row.previousHandles.push(old);
      } else {
        row.handle = handle;
      }
    }
    await writeAddedAccounts(env, doc);
    let dispatched = false;
    try { dispatched = await dispatchWorkflows(env, ["sync.yml", "media-extract.yml"]); }
    catch (err) { dispatched = false; }
    return json(200, { account: publicXAccount(row), dispatched });
  }
  return json(405, { error: "method" });
}

async function handleAddedAccountDelete(request, env, rawHandle) {
  const gate = await requireOwnerHidden(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const hit = await rateHit(env, "x-accounts:" + gate.row.public_id + ":remove", 30, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  let handle = rawHandle;
  try { handle = decodeURIComponent(rawHandle); }
  catch (err) { /* keep the raw segment */ }
  handle = normalizeXInput(handle);
  if (!handle) return json(400, { error: "bad_handle" });
  const doc = await readAddedAccounts(env);
  const row = doc.added.find((item) => xRowMatches(item, handle, ""));
  const gone = [];
  if (row) {
    gone.push(row.handle);
    (row.previousHandles || []).forEach((item) => gone.push(item));
    if (row.permanentId && /^\d{2,25}$/.test(String(row.permanentId)) && doc.removedIds.indexOf(String(row.permanentId)) < 0) {
      doc.removedIds.push(String(row.permanentId));
    }
  } else {
    gone.push(handle);
  }
  doc.added = doc.added.filter((item) => !xRowMatches(item, handle, row ? row.permanentId : ""));
  gone.forEach((item) => {
    const text = normalizeXInput(item);
    if (!text) return;
    if (!doc.removed.some((have) => sameXHandle(have, text))) doc.removed.push(text);
  });
  await writeAddedAccounts(env, doc);
  let dispatched = false;
  try { dispatched = await dispatchWorkflows(env, ["sync.yml"]); }
  catch (err) { dispatched = false; }
  return json(200, { removed: true, added: doc.added.map(publicXAccount), dispatched });
}

function cleanFollowId(raw) {
  const id = String(raw || "").trim();
  if (id.indexOf("app:") === 0) return /^app:\d{12}$/.test(id) ? id : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,79}$/.test(id)) return "";
  if (id.indexOf("..") >= 0) return "";
  return id;
}

function cleanFollowSnapshot(id, src) {
  if (!src || typeof src !== "object" || /^app:\d{12}$/.test(id)) return "";
  const name = String(src.name || src.displayName || "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  const handle = String(src.handle || "").replace(/^@/, "").replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, 40);
  const platform = String(src.platform || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 16);
  const bio = String(src.bio || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 280);
  let avatar = String(src.avatar || "").trim();
  if (!/^https:\/\//i.test(avatar) || avatar.length > 400 || /[\s<>]/.test(avatar)) avatar = "";
  const out = {};
  if (name) out.name = name;
  if (handle) out.handle = handle;
  if (platform) out.platform = platform;
  if (bio) out.bio = bio;
  if (avatar) out.avatar = avatar;
  const text = JSON.stringify(out);
  return text === "{}" ? "" : text;
}

async function followCount(env, sql, arg) {
  const row = await env.DB.prepare(sql).bind(arg).first();
  return Number(row && row.n) || 0;
}

async function followExists(env, followerId, targetId) {
  const row = await env.DB.prepare("SELECT target_id FROM account_follows WHERE follower_id = ? AND target_id = ?").bind(followerId, targetId).first();
  return !!row;
}

function followAccountCard(account) {
  return {
    id: "app:" + account.publicId,
    kind: "account",
    handle: account.handle || "",
    name: account.displayName || "",
    avatar: account.avatar || "",
    avatarFace: account.avatarFace || "",
    bio: account.bio || "",
    owner: account.owner === true
  };
}

function followFeedCard(targetId, snapshot) {
  let snap = {};
  try { snap = snapshot ? JSON.parse(snapshot) : {}; }
  catch (err) { snap = {}; }
  if (!snap || typeof snap !== "object") snap = {};
  return {
    id: targetId,
    kind: "feed",
    handle: typeof snap.handle === "string" ? snap.handle : "",
    name: typeof snap.name === "string" ? snap.name : "",
    avatar: typeof snap.avatar === "string" ? snap.avatar : "",
    bio: typeof snap.bio === "string" ? snap.bio : "",
    platform: typeof snap.platform === "string" ? snap.platform : ""
  };
}

async function followCards(env, request, publicIds) {
  const out = [];
  for (let i = 0; i < publicIds.length; i++) {
    const row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(publicIds[i]).first();
    if (!row) continue;
    out.push(followAccountCard(await presentAccount(env, request, row, false)));
  }
  return out;
}

async function followWriteResult(env, viewerId, targetId, on) {
  const followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", viewerId);
  const followersCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ?", targetId);
  return json(200, { ok: true, id: targetId, viewerFollows: on, followingCount, followersCount });
}

async function requireFollowSession(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return { error: json(401, { error: "unauthorized" }) };
  return { row };
}

async function resolveFollowTarget(env, id) {
  if (id.indexOf("app:") !== 0) return { id, account: null };
  const account = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(id.slice(4)).first();
  if (!account) return { error: json(404, { error: "not_found" }) };
  return { id, account };
}

async function handleFollowPut(request, env) {
  const gate = await requireFollowSession(request, env);
  if (gate.error) return gate.error;
  const paced = await rateHit(env, "follow:" + gate.row.public_id, 80, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const body = await readJson(request, 8000);
  if (body.error) return json(400, { error: body.error });
  const id = cleanFollowId(body.id);
  if (!id) return json(400, { error: "bad_follow" });
  if (id === "app:" + gate.row.public_id) return json(400, { error: "bad_follow" });
  const target = await resolveFollowTarget(env, id);
  if (target.error) return target.error;
  const snapshot = cleanFollowSnapshot(id, body.profile);
  await env.DB.prepare("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(follower_id, target_id) DO UPDATE SET snapshot = CASE WHEN excluded.snapshot != '' THEN excluded.snapshot ELSE account_follows.snapshot END").bind(gate.row.public_id, id, snapshot, Date.now()).run();
  return followWriteResult(env, gate.row.public_id, id, true);
}

async function handleFollowDelete(request, env) {
  const gate = await requireFollowSession(request, env);
  if (gate.error) return gate.error;
  const paced = await rateHit(env, "follow:" + gate.row.public_id, 80, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const body = await readJson(request, 2000);
  if (body.error) return json(400, { error: body.error });
  const id = cleanFollowId(body.id);
  if (!id) return json(400, { error: "bad_follow" });
  await env.DB.prepare("DELETE FROM account_follows WHERE follower_id = ? AND target_id = ?").bind(gate.row.public_id, id).run();
  return followWriteResult(env, gate.row.public_id, id, false);
}

async function handleFollowImport(request, env) {
  const gate = await requireFollowSession(request, env);
  if (gate.error) return gate.error;
  const paced = await rateHit(env, "follow-import:" + gate.row.public_id, 8, 60 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const body = await readJson(request, 40000);
  if (body.error) return json(400, { error: body.error });
  const incoming = Array.isArray(body.ids) ? body.ids : null;
  if (!incoming) return json(400, { error: "bad_follow" });
  const ids = [];
  for (let i = 0; i < incoming.length && ids.length < 400; i++) {
    const id = cleanFollowId(incoming[i]);
    if (!id || id === "app:" + gate.row.public_id || ids.indexOf(id) >= 0) continue;
    if (id.indexOf("app:") === 0) {
      const account = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(id.slice(4)).first();
      if (!account) continue;
    }
    ids.push(id);
  }
  const now = Date.now();
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    await env.DB.batch(part.map((id) => env.DB.prepare("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?) ON CONFLICT(follower_id, target_id) DO NOTHING").bind(gate.row.public_id, id, now)));
  }
  const followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", gate.row.public_id);
  return json(200, { ok: true, followingCount });
}

async function handleFollowGet(request, env, url) {
  const gate = await requireFollowSession(request, env);
  if (gate.error) return gate.error;
  const paced = await rateHit(env, "follow-read:" + gate.row.public_id, 120, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const tabRaw = String(url.searchParams.get("tab") || "");
  const tab = tabRaw === "followers" || tabRaw === "following" ? tabRaw : "";
  let subject = String(url.searchParams.get("id") || "").trim();
  if (!subject) subject = "app:" + gate.row.public_id;
  else subject = cleanFollowId(subject);
  if (!subject) return json(400, { error: "bad_follow" });
  let account = null;
  if (subject.indexOf("app:") === 0) {
    account = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(subject.slice(4)).first();
    if (!account) return json(404, { error: "not_found" });
  }
  const body = {
    id: subject,
    kind: account ? "account" : "feed",
    followersCount: await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ?", subject),
    viewerFollows: subject !== "app:" + gate.row.public_id && await followExists(env, gate.row.public_id, subject)
  };
  if (account) body.followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", account.public_id);
  if (!tab && subject === "app:" + gate.row.public_id) {
    const listed = await env.DB.prepare("SELECT target_id FROM account_follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT 500").bind(gate.row.public_id).all();
    body.ids = ((listed && listed.results) || []).map((row) => row.target_id);
    return json(200, body);
  }
  if (!tab) return json(200, body);
  if (tab === "followers") {
    const listed = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE target_id = ? ORDER BY created_at DESC LIMIT 200").bind(subject).all();
    body.accounts = await followCards(env, request, ((listed && listed.results) || []).map((row) => row.follower_id));
    return json(200, body);
  }
  if (!account) {
    body.accounts = [];
    return json(200, body);
  }
  const listed = await env.DB.prepare("SELECT target_id, snapshot FROM account_follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT 200").bind(account.public_id).all();
  const rows = (listed && listed.results) || [];
  const accounts = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row.target_id || "").indexOf("app:") === 0) {
      const cards = await followCards(env, request, [row.target_id.slice(4)]);
      if (cards[0]) accounts.push(cards[0]);
    } else accounts.push(followFeedCard(row.target_id, row.snapshot));
  }
  body.accounts = accounts;
  return json(200, body);
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  await ensureSchema(env);
  if (path === "/v1/health" && request.method === "GET") {
    return json(200, { ok: true, ready: !!env.ACCOUNT_PEPPER, data: !!env.DATA, turnstile: !!env.TURNSTILE_SECRET, telegram: !!env.TELEGRAM_BOT_TOKEN });
  }
  if ((path === "/tg" || path.startsWith("/tg/")) && (request.method === "GET" || request.method === "HEAD")) {
    return handleTelegram(request, env, path);
  }
  const archiveMedia = path.match(/^\/v1\/archive\/([a-f0-9]{64}\.[a-z0-9]{1,8})$/);
  if (archiveMedia && (request.method === "GET" || request.method === "HEAD")) return handleArchive(request, env, archiveMedia[1]);
  const accountMedia = path.match(/^\/v1\/media\/(avatars|banners)\/(\d{12})\/([a-f0-9]{64}\.(?:webp|jpg|png))$/);
  if (accountMedia && request.method === "GET") return handleAccountMedia(request, env, accountMedia[1], accountMedia[2], accountMedia[3]);
  if (path.startsWith("/v1/data/") && request.method === "GET") return handleData(request, env, path);
  if (path === "/v1/owner/accounts" && (request.method === "GET" || request.method === "POST")) return handleAddedAccounts(request, env, url);
  const addedAccount = path.match(/^\/v1\/owner\/accounts\/([^/]+)$/);
  if (addedAccount && request.method === "DELETE") return handleAddedAccountDelete(request, env, addedAccount[1]);
  if (path === "/v1/owner/tiktok/accounts" && (request.method === "GET" || request.method === "POST")) return handleTikTokAccounts(request, env);
  const ownerAccount = path.match(/^\/v1\/owner\/tiktok\/accounts\/([^/]+)$/);
  if (ownerAccount && request.method === "DELETE") return handleTikTokAccountDelete(request, env, ownerAccount[1]);
  if (path === "/v1/owner/tiktok/health" && request.method === "GET") return handleTikTokHealth(request, env);
  if (path === "/v1/owner/tiktok/recordings" && request.method === "GET") return handleRecordings(request, env);
  if (path === "/v1/owner/tiktok/channels" && (request.method === "GET" || request.method === "POST")) return handleBackupChannels(request, env);
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
  if (path === "/v1/session/refresh" && request.method === "POST") return handleSessionRefresh(request, env);
  if (path === "/v1/profile" && request.method === "PATCH") return handleProfilePatch(request, env);
  if (path === "/v1/sync" && request.method === "GET") return handleSyncGet(request, env);
  if (path === "/v1/sync" && request.method === "PUT") return handleSyncPut(request, env);
  if (path === "/v1/reposts" && request.method === "PUT") return handleRepostPut(request, env);
  if (path === "/v1/reposts" && (request.method === "POST" || request.method === "DELETE")) return handleRepostDelete(request, env);
  if (path === "/v1/follows" && request.method === "GET") return handleFollowGet(request, env, url);
  if (path === "/v1/follows" && request.method === "PUT") return handleFollowPut(request, env);
  if (path === "/v1/follows" && request.method === "DELETE") return handleFollowDelete(request, env);
  if (path === "/v1/follows/import" && request.method === "POST") return handleFollowImport(request, env);
  if (path === "/v1/handle" && request.method === "GET") return handleHandle(env, url);
  const profile = path.match(/^\/v1\/profile\/([^/]+)$/);
  if (profile && request.method === "GET") {
    const viewer = await sessionAccount(env, request);
    if (!viewer) return json(401, { error: "unauthorized" });
    let handle = profile[1];
    try { handle = decodeURIComponent(handle); } catch (err) { /* keep the raw segment */ }
    return handleProfileGet(request, env, handle);
  }
  if (path === "/v1/drive" || path.startsWith("/v1/drive/")) {
    return handleDrive(request, env, path, url, { json, sessionAccount, readJson, rateHit, limited });
  }
  if (path === "/v1/communities" || path.startsWith("/v1/communities/") || path === "/v1/owner/communities" || path.startsWith("/v1/owner/communities/")) {
    return handleCommunityRoute(request, env, path, url, { json, sessionAccount, rateHit, limited, readJson, requireOwnerHidden, dispatchWorkflows, presentAccount });
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
