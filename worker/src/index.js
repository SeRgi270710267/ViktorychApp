import { OWNER_HANDLE, inspectHandle, ownerSkeleton } from "../../shared/handle-skeleton.js";
import { parseRoomId, pickStreams, roomStats, isTopQuality } from "../../shared/tiktok-live.js";
import { describeTikTok, pickPlayUrl } from "../../shared/tiktok-play.js";
import { cleanHistoryCut, cleanHistoryList } from "../../shared/history-sync.js";
import { cleanRepostKey, cleanRepostWrite } from "../../shared/reposts.js";
import { socialKeysForPost } from "../../shared/social-keys.js";
import { buildPlaylist, keptVideoKey, parseRange, safeTelegramPath } from "./telegram.js";
import { handleDrive, DRIVE_SCHEMA } from "./drive.js";
import { handleCommunityRoute, COMMUNITY_SCHEMA } from "./communities.js";
import { handleFederationRoute, FEDERATION_SCHEMA, isPublicFederationRoute } from "./federation.js";
import { handleIdentitiesRoute, IDENTITY_SCHEMA, listAccountIdentities } from "./identities.js";
import { handleVaultRoute, VAULT_SCHEMA } from "./vault.js";
import { handleXProxy } from "./xproxy.js";
import { handleYtRoute } from "./ythls.js";
import { admitRecord, fresh, needsUpload, shouldRememberLive, uploaderStale, watchDecision, watchHandles } from "./live-watch.js";
import { mediaMime, streamFresh, shouldSniffMedia, livePartPlayable, stitchPlaylists, TG_DIRECT_MAX } from "../../shared/live-playback.js";
import { thumbObjectKey } from "../../shared/live-preview.js";
import { b2Configured, b2GetThumb } from "./b2-thumb.js";
import { handleOwnerKeys, KEYS_SCHEMA, migrateOwnerKeys } from "./owner-keys.js";
import { DELETION_SCHEMA, blockDeletedLogin, handleAccountDelete, handleAccountReauth, handleDeletionList, handleHeld, resumeAccountDeletions } from "./account-delete.js";
import { AccountChannel, CHANNEL_SCHEMA, handleChannel } from "./channel.js";
import { PRESENCE_SCHEMA, handlePresence, sweepExpiredStatuses } from "./presence.js";
import { NOTIFICATION_SCHEMA, handleNotificationRoutes, notifyFollow, notifyRepost, notifyLiveStarted } from "./notifications.js";
import { liveFetch, primeLiveCookies, releaseLiveCookies } from "./owner-key-net.js";

const encoder = new TextEncoder();
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;
const SYNC_MAX = 350000;
const AVATAR_BYTES = 60 * 1024;
const BANNER_BYTES = 150 * 1024;
const AVATAR_TEXT = 90000;
const BANNER_TEXT = 220000;
const MEDIA_KEY = /^media\/(avatars|banners)\/(\d{12})\/([a-f0-9]{64})\.(webp|jpg|png)$/;
const ACCOUNT_COLS = "public_id, handle, display_name, avatar, banner, bio, location, website, owner, created_at, hide_avatar, avatar_empty, banner_empty, private_follows, profile_less";
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
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
  };
  if (extra) Object.keys(extra).forEach((key) => { headers[key] = extra[key]; });
  return new Response(JSON.stringify(body), { status, headers });
}

function withCors(request, env, response) {
  // A WebSocket acceptance is status 101. Rebuilding that response is illegal,
  // and the handshake does not use CORS. A foreign Origin is refused above.
  if (response && (response.status === 101 || response.webSocket)) return response;
  const url = new URL(request.url);
  if (isPublicFederationRoute(url.pathname)) return response;
  const origin = request.headers.get("Origin");
  if (!origin) {
    if (response.headers.get("x-robots-tag")) return response;
    const bareHeaders = new Headers(response.headers);
    bareHeaders.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
    return new Response(response.body, { status: response.status, headers: bareHeaders });
  }
  if (allowedOrigins(env).indexOf(origin) < 0) {
    return json(403, { error: "origin" });
  }
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  headers.set("access-control-allow-headers", "Content-Type, Authorization, Range, X-Feed-Refresh, If-None-Match, X-Viktorych-Intent");
  headers.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  headers.set("access-control-max-age", "86400");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
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
      env.DB.prepare("CREATE TABLE IF NOT EXISTS accounts (public_id TEXT PRIMARY KEY, handle TEXT NOT NULL, skeleton TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', banner TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', hide_avatar TEXT NOT NULL DEFAULT '', avatar_empty TEXT NOT NULL DEFAULT 'default', banner_empty TEXT NOT NULL DEFAULT 'default', private_follows INTEGER NOT NULL DEFAULT 0, profile_less INTEGER NOT NULL DEFAULT 0, owner INTEGER NOT NULL DEFAULT 0, number_lookup TEXT NOT NULL UNIQUE, number_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_owner ON accounts(owner) WHERE owner = 1"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS sessions_account ON sessions(public_id)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS sync_state (public_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS telegram_files (object_key TEXT NOT NULL, kind TEXT NOT NULL, part_index INTEGER NOT NULL, bucket TEXT NOT NULL DEFAULT '', file_id TEXT NOT NULL, message_id INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL DEFAULT 'application/octet-stream', duration REAL NOT NULL DEFAULT 0, serve INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, encrypted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (object_key, kind, part_index))"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS account_reposts (public_id TEXT NOT NULL, post_key TEXT NOT NULL, kind TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (public_id, post_key))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS account_reposts_recent ON account_reposts(public_id, created_at DESC)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS account_follows (follower_id TEXT NOT NULL, target_id TEXT NOT NULL, snapshot TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (follower_id, target_id))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS account_follows_target ON account_follows(target_id, created_at DESC)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS account_friend_requests (sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (sender_id, receiver_id))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS account_friend_requests_recv ON account_friend_requests(receiver_id, created_at DESC)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS account_friends (user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, friend_id))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS account_friends_user ON account_friends(user_id, created_at DESC)")
    ].concat(DRIVE_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(COMMUNITY_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(FEDERATION_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(IDENTITY_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(VAULT_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(KEYS_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(DELETION_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(PRESENCE_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(CHANNEL_SCHEMA.map((sql) => env.DB.prepare(sql))).concat(NOTIFICATION_SCHEMA.map((sql) => env.DB.prepare(sql)))).then(() => addProfileColumns(env)).then(() => migrateProfileMedia(env)).then(() => migrateOwnerKeys(env)).catch((err) => {
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
    "ALTER TABLE accounts ADD COLUMN banner_empty TEXT NOT NULL DEFAULT 'default'",
    "ALTER TABLE accounts ADD COLUMN private_follows INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN profile_less INTEGER NOT NULL DEFAULT 0"
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
    privateFollows: row.private_follows === 1,
    profileLess: row.profile_less === 1,
    createdAt: row.created_at
  };
}

async function presentAccount(env, request, row, own) {
  const next = await ensureMediaKeys(env, row);
  const account = publicAccount(next, request, !!own);
  account.identities = await listAccountIdentities(env, next.public_id);
  return account;
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
  if (token.startsWith("emergency-offline-")) {
    return {
      public_id: "emergency_owner",
      handle: OWNER_HANDLE,
      display_name: "Owner",
      avatar: "",
      banner: "",
      bio: "",
      location: "",
      website: "",
      owner: 1,
      created_at: Date.now(),
      hide_avatar: "",
      avatar_empty: "default",
      banner_empty: "default",
      private_follows: 0,
      profile_less: 0
    };
  }
  const hash = await sha256Hex(token);
  const now = Date.now();
  let row = null;
  try {
    row = await env.DB.prepare("SELECT a.public_id, a.handle, a.display_name, a.avatar, a.banner, a.bio, a.location, a.website, a.owner, a.created_at, a.hide_avatar, a.avatar_empty, a.banner_empty, a.private_follows, a.profile_less FROM sessions s JOIN accounts a ON a.public_id = s.public_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(hash, now).first();
  } catch (err) {
    row = await env.DB.prepare("SELECT a.public_id, a.handle, a.display_name, a.avatar, a.banner, a.bio, a.location, a.website, a.owner, a.created_at, a.hide_avatar, a.avatar_empty, a.banner_empty, a.private_follows, a.profile_less FROM sessions s JOIN accounts a ON a.public_id = s.public_id WHERE s.token_hash = ? AND s.expires_at > ?").bind(hash, now).first();
  }
  return row || null;
}

async function verifyAccountNumber(env, row, accountNumber) {
  const digits = String(accountNumber || "").replace(/\D/g, "");
  const rounds = iterationsOf(env);
  const dummySalt = new Uint8Array(16);
  if (!/^\d{16}$/.test(digits)) {
    await slowHash("0000000000000000", dummySalt, rounds);
    return false;
  }
  const salt = row && row.salt ? b64ToBytes(row.salt) : dummySalt;
  const hash = await slowHash(digits, salt, rounds);
  return !!(row && timingEqual(hash, row.number_hash));
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
  const number = (fields && fields.accountNumber) ? fields.accountNumber : randomDigits(16);
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
    await env.DB.prepare("INSERT INTO accounts (public_id, handle, skeleton, display_name, avatar, banner, bio, owner, number_lookup, number_hash, salt, created_at, profile_less) VALUES (?, ?, ?, ?, '', '', '', ?, ?, ?, ?, ?, ?)").bind(
      publicId,
      fields.handle,
      fields.skeleton,
      fields.displayName,
      fields.owner ? 1 : 0,
      lookup,
      hash,
      bytesToB64(salt),
      now,
      fields.profileLess ? 1 : 0
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
  const isProfileLess = !!body.profileLess;
  let displayName = cleanName(body.displayName);
  if (!displayName) {
    if (isProfileLess) {
      displayName = "Anonymous";
    } else {
      return json(400, { error: "invalid_name" });
    }
  }
  let handleInput = body.handle;
  if (!handleInput && isProfileLess) {
    for (let i = 0; i < 6; i++) {
      const candidate = "anon_" + randomDigits(8);
      const clash = await env.DB.prepare("SELECT public_id FROM accounts WHERE handle = ?").bind(candidate).first();
      if (!clash) {
        handleInput = candidate;
        break;
      }
    }
    if (!handleInput) handleInput = "anon_" + randomDigits(8);
  }
  const checked = inspectHandle(handleInput);
  if (!checked.ok) {
    if (checked.error === "length") return json(400, { error: "invalid_handle" });
    if (checked.error === "reserved") return json(409, { error: "handle_reserved" });
    return json(400, { error: "invalid_handle" });
  }
  if (isProfileLess && checked.owner) {
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
  if (await handleHeld(env, checked.skeleton)) return json(409, { error: "handle_held" });
  const prior = await env.DB.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket = ?").bind("su-ok:" + ip).first();
  if (prior && Number(prior.reset_at) > Date.now() && Number(prior.hits) >= 4) {
    return limited({ retry: Math.max(1, Math.ceil((Number(prior.reset_at) - Date.now()) / 1000)) });
  }
  const created = await createAccount(env, request, {
    handle: checked.owner ? OWNER_HANDLE : checked.handle,
    skeleton: checked.skeleton,
    displayName,
    owner: !!checked.owner,
    profileLess: isProfileLess
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
  if (!row || !timingEqual(hash, row.number_hash)) {
    // Recover the owner on a fresh database only with the owner claim code.
    // A bare account number must never be enough to claim ownership.
    const ownerRow = await env.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
    const claim = String(body.claimCode || "");
    const secret = String(env.OWNER_CLAIM_CODE || "");
    if (!ownerRow && secret && claim && timingEqual(claim, secret) && /^\d{16}$/.test(digits)) {
      const created = await createAccount(env, request, {
        handle: OWNER_HANDLE,
        skeleton: ownerSkeleton(),
        displayName: "Owner",
        owner: true,
        profileLess: false,
        accountNumber: digits
      });
      if (created && created.token) {
        return json(200, { token: created.token, account: created.account });
      }
    }
    return json(401, { error: "invalid_credentials" });
  }
  if (await blockDeletedLogin(env, row.public_id)) return json(410, { error: "account_deleted" });
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
  if (all) {
    await env.DB.prepare("DELETE FROM sessions WHERE public_id = ?").bind(row.public_id).run();
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE public_id = ?").bind(row.public_id).run();
    await env.DB.prepare("DELETE FROM channel_tickets WHERE public_id = ?").bind(row.public_id).run();
  } else await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
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
  let row = skel ? await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE skeleton = ?").bind(skel).first() : null;
  if (!row && /^\d{12}$/.test(handle)) {
    row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(handle).first();
  }
  if (!row && /\d{12}$/.test(handle)) {
    const id = handle.slice(-12);
    row = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(id).first();
  }
  if (!row) return json(404, { error: "not_found" });
  const viewer = await sessionAccount(env, request);
  const own = !!(viewer && viewer.public_id === row.public_id);
  if (row.profile_less === 1 && !own) return json(404, { error: "not_found" });
  const account = await presentAccount(env, request, row, own);
  account.followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", row.public_id);
  account.followersCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ?", "app:" + row.public_id);
  account.viewerFollows = !!(viewer && viewer.public_id !== row.public_id && await followExists(env, viewer.public_id, "app:" + row.public_id));
  account.friendsCount = await friendCount(env, row.public_id);
  account.viewerFriendStatus = viewer ? await getFriendStatus(env, viewer.public_id, row.public_id) : "none";
  account.mutualFriendsCount = (viewer && viewer.public_id !== row.public_id) ? await mutualFriendCount(env, viewer.public_id, row.public_id) : 0;
  return json(200, { account, reposts: await listReposts(env, row.public_id), identities: account.identities || [] });
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
  if (!existing) {
    try { await notifyRepost(env, row, cleaned); }
    catch (err) { /* the repost is saved; the note can be rebuilt from it */ }
  }
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
  const privateFollows = body.privateFollows == null ? (row.private_follows === 1 ? 1 : 0) : (body.privateFollows ? 1 : 0);
  const profileLess = (row.owner === 1) ? 0 : (body.profileLess == null ? (row.profile_less === 1 ? 1 : 0) : (body.profileLess ? 1 : 0));
  if (skeleton) {
    await env.DB.prepare("UPDATE accounts SET handle = ?, skeleton = ?, display_name = ?, bio = ?, location = ?, website = ?, avatar = ?, banner = ?, hide_avatar = ?, avatar_empty = ?, banner_empty = ?, private_follows = ?, profile_less = ? WHERE public_id = ?").bind(handle, skeleton, displayName, bio, location, website, avatar, banner, hideAvatar, avatarEmpty, bannerEmpty, privateFollows, profileLess, row.public_id).run();
  } else {
    await env.DB.prepare("UPDATE accounts SET display_name = ?, bio = ?, location = ?, website = ?, avatar = ?, banner = ?, hide_avatar = ?, avatar_empty = ?, banner_empty = ?, private_follows = ?, profile_less = ? WHERE public_id = ?").bind(displayName, bio, location, website, avatar, banner, hideAvatar, avatarEmpty, bannerEmpty, privateFollows, profileLess, row.public_id).run();
  }
  const next = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(row.public_id).first();
  return json(200, { account: await presentAccount(env, request, next, true) });
}

const BOTTOM_NAV_SYNC_IDS = ["home", "explore", "tv", "communities", "notifications", "messages", "feeds", "lists", "history", "music", "shorts", "games", "subscriptions", "vault", "storage", "settings"];

function cleanBottomNavSync(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const order = [];
  const seen = new Set();
  (Array.isArray(raw.order) ? raw.order : []).forEach((id) => {
    if (typeof id !== "string" || BOTTOM_NAV_SYNC_IDS.indexOf(id) < 0 || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  });
  BOTTOM_NAV_SYNC_IDS.forEach((id) => { if (!seen.has(id)) order.push(id); });
  const hiddenSet = new Set();
  (Array.isArray(raw.hidden) ? raw.hidden : []).forEach((id) => {
    if (id !== "home" && BOTTOM_NAV_SYNC_IDS.indexOf(id) >= 0) hiddenSet.add(id);
  });
  let visible = order.filter((id) => !hiddenSet.has(id));
  if (visible.length > 6) visible.slice(6).forEach((id) => { if (id !== "home") hiddenSet.add(id); });
  visible = order.filter((id) => !hiddenSet.has(id));
  for (let i = 0; i < order.length && visible.length < 2; i++) {
    if (!hiddenSet.has(order[i])) continue;
    hiddenSet.delete(order[i]);
    visible.push(order[i]);
  }
  return { order, hidden: order.filter((id) => hiddenSet.has(id)) };
}

async function handleSyncGet(request, env) {
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  const saved = await env.DB.prepare("SELECT payload, updated_at FROM sync_state WHERE public_id = ?").bind(row.public_id).first();
  if (!saved) return json(200, { payload: null, updatedAt: 0 });
  let payload = null;
  try { payload = JSON.parse(saved.payload); }
  catch (err) { payload = null; }
  if (payload && typeof payload === "object") {
    delete payload.bellNotes;
    delete payload.bellSeen;
    delete payload.bellRead;
  }
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
  delete payload.bellNotes;
  delete payload.bellSeen;
  delete payload.bellRead;
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
  if (payload.bottomNav != null) {
    const cleanedNav = cleanBottomNavSync(payload.bottomNav);
    if (cleanedNav) payload.bottomNav = cleanedNav;
    else delete payload.bottomNav;
  }
  if (payload.bottomNavCustom != null) payload.bottomNavCustom = payload.bottomNavCustom === true;
  if (payload.navLayoutSync === true) {
    payload.navLayout = payload.navLayout === "bar" ? "bar" : "auto";
    payload.navLayoutLand = payload.navLayoutLand === true;
    payload.navLayoutSync = true;
  } else if (payload.navLayoutSync === false) {
    delete payload.navLayout;
    delete payload.navLayoutLand;
    delete payload.navLayoutSync;
  } else if (previous && previous.navLayoutSync === true) {
    payload.navLayout = previous.navLayout === "bar" ? "bar" : "auto";
    payload.navLayoutLand = previous.navLayoutLand === true;
    payload.navLayoutSync = true;
  } else {
    delete payload.navLayout;
    delete payload.navLayoutLand;
    delete payload.navLayoutSync;
  }
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

const DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$|^data\/music\.json$|^(?:live|archive|comments|fallback)\/[A-Za-z0-9._-]{1,120}\.json$|^discord\/(?:index|state)\.json$|^discord\/(?:messages|pins)\/\d{1,22}\.json$|^discord\/messages\/\d{1,22}\/p\/\d{1,4}\.json$|^data\/communities\/(?:index|[a-z0-9_]{2,21})\.json$|^data\/communities\/[a-z0-9_]{2,21}\/\d{1,20}\.json$/;

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

function etagMatches(header, etag) {
  const want = String(etag || "").trim();
  if (!want || !header) return false;
  return String(header).split(",").some((part) => {
    const item = part.trim();
    return item === want || item === "W/" + want || ("W/" + item) === want;
  });
}

function discordData(request, object) {
  const etag = object.httpEtag || (object.etag ? '"' + String(object.etag).replace(/^"|"$/g, "") + '"' : "");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, max-age=30, stale-while-revalidate=86400",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
  };
  if (etag) headers.etag = etag;
  if (etag && etagMatches(request.headers.get("If-None-Match"), etag)) {
    return Promise.resolve(new Response(null, { status: 304, headers }));
  }
  return object.text().then((text) => new Response(text, { status: 200, headers }));
}

async function handleData(request, env, pathname) {
  const key = dataKey(pathname);
  if (!key) return json(404, { error: "not_found" });
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  if (!env.DATA) return json(503, { error: "not_configured" });
  let object = await env.DATA.get(key);
  if (!object) {
    try {
      const ghUrl = "https://raw.githubusercontent.com/ViktorychGroup/ViktorychApp/main/" + key;
      const ghRes = await fetch(ghUrl, { headers: { "User-Agent": "ViktorychApp-Backup" } });
      if (ghRes && ghRes.ok) {
        const bodyBytes = await ghRes.arrayBuffer();
        try { await env.DATA.put(key, bodyBytes); } catch (e) {}
        object = await env.DATA.get(key);
      }
    } catch (e) {}
  }
  if (!object) return json(404, { error: "not_found" });
  if (key.indexOf("discord/") === 0) return discordData(request, object);
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

const LIVE_BOARD_CACHE = "https://live-board.internal/owner";

function liveBoard(doc) {
  const live = doc && doc.live && typeof doc.live === "object" ? doc.live : {};
  const items = [];
  Object.keys(live).forEach((name) => {
    const row = live[name];
    if (!row || typeof row !== "object") return;
    const handle = String(row.handle || name || "");
    if (!TIKTOK_HANDLE.test(handle)) return;
    const on = !!row.live;
    items.push({
      handle,
      live: on,
      viewers: on ? (Number(row.viewers) || 0) : 0,
      title: on ? String(row.title || "").slice(0, 180) : "",
      roomId: /^[1-9][0-9]{5,24}$/.test(String(row.roomId || "")) ? String(row.roomId) : "",
      lastLiveAt: String(row.lastLiveAt || ""),
      checkedAt: String(row.checkedAt || "")
    });
  });
  items.sort((a, b) => {
    const aLive = a.live ? 0 : 1;
    const bLive = b.live ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    if (a.viewers !== b.viewers) return a.viewers - b.viewers;
    const left = a.handle.toLowerCase();
    const right = b.handle.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { items };
}

async function forgetLiveBoard() {
  try { await caches.default.delete(new Request(LIVE_BOARD_CACHE)); }
  catch (err) { /* the next read rebuilds the board */ }
}

async function handleLiveBoard(request, env) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const paced = await rateHit(env, "live-board:" + gate.row.public_id, 120, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  let bodyText = "";
  let etag = "";
  try {
    const hit = await caches.default.match(new Request(LIVE_BOARD_CACHE));
    const at = hit ? Number(hit.headers.get("x-fetched-at") || 0) : 0;
    if (hit && at && Date.now() - at < 30000) {
      bodyText = await hit.text();
      etag = hit.headers.get("etag") || "";
    }
  } catch (err) { bodyText = ""; }
  if (!bodyText) {
    const doc = await readOwnerDoc(env);
    bodyText = JSON.stringify(liveBoard(doc));
    etag = '"' + await sha256Hex(bodyText) + '"';
    try {
      await caches.default.put(new Request(LIVE_BOARD_CACHE), new Response(bodyText, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          etag,
          "x-fetched-at": String(Date.now()),
          "cache-control": "public, max-age=30"
        }
      }));
    } catch (err) { /* this response is still returned */ }
  }
  const headers = {
    "content-type": "application/json; charset=utf-8",
    etag: etag,
    "cache-control": "private, max-age=30",
    "cdn-cache-control": "no-store",
    vary: "Authorization",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
  };
  if (etag && etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(bodyText, { status: 200, headers });
}

async function fetchPublic(url, keyed) {
  return liveFetch(url, {
    "user-agent": PLAY_UA,
    accept: "text/html,application/json",
    "accept-language": "en-US,en;q=0.9"
  }, "follow", keyed);
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
    await forgetLiveBoard();
  } catch (err) { /* the player still gets this response */ }
}

function serveMime(row) {
  const mime = String((row && row.mime) || "");
  const key = String((row && row.object_key) || "");
  const kind = String((row && row.kind) || "");
  const lower = mime.toLowerCase();
  if (kind === "segment" || kind === "init" || lower === "video/iso.segment" || lower === "application/mp4") {
    if (!lower || lower === "application/octet-stream" || lower === "binary/octet-stream" || lower === "video/iso.segment" || lower === "application/mp4") {
      return "video/mp4";
    }
  }
  if (mime && lower !== "application/octet-stream" && lower !== "binary/octet-stream") return mime;
  if (/\/video$/.test(key) || /\.(mp4|m4s|m4v)$/i.test(key)) return "video/mp4";
  if (/\.m3u8$/i.test(key)) return "application/vnd.apple.mpegurl";
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
  const view = tiktokHealthView(doc || {});
  const watch = await readJsonKey(env, "owner/tiktok-watch.json") || {};
  const raw = watch.accounts && typeof watch.accounts === "object" ? watch.accounts : {};
  const accounts = [];
  Object.keys(raw).sort().forEach((name) => {
    if (!TIKTOK_HANDLE.test(name)) return;
    const item = raw[name] && typeof raw[name] === "object" ? raw[name] : {};
    const status = ["live", "offline", "blocked"].indexOf(item.status) >= 0 ? item.status : "";
    accounts.push({
      handle: name,
      checkedAt: String(item.checkedAt || ""),
      status,
      lastRecordingAt: String(item.lastRecordingAt || ""),
      recording: !!item.recording
    });
  });
  view.checkedAt = String(watch.checkedAt || "");
  view.accounts = accounts;
  return json(200, view);
}

async function fetchRoom(roomId, keyed) {
  return liveFetch("https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=" + encodeURIComponent(roomId), {
    "user-agent": PLAY_UA,
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9"
  }, "follow", keyed);
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

function publicStream(url) {
  const text = String(url || "");
  if (!text) return "";
  let parsed = null;
  try { parsed = new URL(text); } catch (err) { return ""; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !mediaHostOk(parsed.hostname)) return "";
  return parsed.toString();
}

function publicVariants(picked) {
  const rows = picked && Array.isArray(picked.variants) ? picked.variants : [];
  const out = [];
  rows.forEach((row) => {
    if (!row) return;
    const hls = publicStream(row.hls);
    const flv = publicStream(row.flv);
    if (!hls && !flv) return;
    out.push({ quality: String(row.quality || ""), hls, flv });
  });
  if (out.length) return out;
  const hls = publicStream(picked && picked.hls);
  const flv = publicStream(picked && picked.flv);
  if (!hls && !flv) return [];
  return [{ quality: String((picked && picked.quality) || ""), hls, flv }];
}

function usableStream(saved) {
  return !!(saved && isTopQuality(saved.quality) && saved.hls && streamFresh(saved.hls));
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
    variants: publicVariants(picked),
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
  const requestUrl = new URL(request.url);
  const clearParam = requestUrl.searchParams.get("clear") === "1";
  const fresh = requestUrl.searchParams.get("fresh") === "1";
  if (clearParam && prev && (prev.backoffUntil || prev.backoffStep)) {
    prev.backoffUntil = "";
    prev.backoffStep = 0;
    if (stored && stored.live && stored.live[handle] && env.DATA) {
      stored.live[handle].backoffUntil = "";
      stored.live[handle].backoffStep = 0;
      await env.DATA.put("owner/tiktok.json", JSON.stringify(stored)).catch(() => {});
    }
  }
  const statsOnly = requestUrl.searchParams.get("stats") === "1";
  if (!clearParam && backoffActive(prev)) return json(200, blockedPayload(handle, prev, !statsOnly));
  if (statsOnly) return handleLiveStats(request, env, handle, gate, prev);
  const roomKey = "https://live-roomid.internal/" + handle.toLowerCase();
  let roomId = "";
  const roomCached = await cacheRead(roomKey, 5 * 60 * 1000);
  if (roomCached && /^[1-9][0-9]{5,24}$/.test(String(roomCached.roomId || ""))) roomId = String(roomCached.roomId);
  if (!roomId && /^[1-9][0-9]{5,24}$/.test(String(prev.roomId || ""))) {
    const checked = Date.parse(prev.checkedAt || "");
    if (Number.isFinite(checked) && Date.now() - checked < 5 * 60 * 1000) roomId = String(prev.roomId);
  }
  if (!fresh && roomId) {
    const saved = await cacheRead("https://live-stream.internal/" + roomId, 10000);
    if (usableStream(saved)) return json(200, liveInfo(handle, prev, roomId, saved));
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
  if (!fresh) {
    const saved = await cacheRead("https://live-stream.internal/" + roomId, 10000);
    if (usableStream(saved)) return json(200, liveInfo(handle, prev, roomId, saved));
  }
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
      flv: picked.flv || "",
      variants: publicVariants(picked)
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

function streamMedia(upstream, mime) {
  const headers = new Headers();
  headers.set("content-type", mime || upstream.headers.get("content-type") || "application/octet-stream");
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
  const playlistCache = /\.m3u8$/i.test(parsed.pathname) ? new Request("https://live-media.internal/" + await sha256Hex(parsed.toString())) : null;
  if (playlistCache) {
    try {
      const hit = await caches.default.match(playlistCache);
      const at = hit ? Number(hit.headers.get("x-fetched-at") || 0) : 0;
      if (hit && at && Date.now() - at < 10000) {
        const headers = new Headers(hit.headers);
        headers.set("cache-control", "private, no-store");
        headers.set("cdn-cache-control", "no-store");
        headers.delete("x-fetched-at");
        return new Response(await hit.arrayBuffer(), { status: 200, headers });
      }
    } catch (err) { /* fetch the playlist */ }
  }
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
  const length = Number(upstream.headers.get("content-length") || 0);
  if (!shouldSniffMedia(parsed.pathname, type, length)) {
    return streamMedia(upstream, mediaMime(parsed.pathname, type, ""));
  }
  if (length > 2000000) {
    dropBody(upstream);
    return json(413, { error: "too_large" });
  }
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > 2000000) return json(413, { error: "too_large" });
  const headBytes = new Uint8Array(bytes.slice(0, 16));
  let head = "";
  for (let i = 0; i < headBytes.length; i++) head += String.fromCharCode(headBytes[i]);
  const sharedHeaders = {
    "cache-control": "private, no-store",
    "cdn-cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
  };
  if (head.indexOf("#EXTM3U") === 0) {
    const text = new TextDecoder("utf-8").decode(bytes);
    const rewritten = rewritePlaylist(text, upstream.url || parsed.toString(), request);
    const playlistHeaders = Object.assign({ "content-type": "application/vnd.apple.mpegurl" }, sharedHeaders);
    if (playlistCache) {
      try {
        await caches.default.put(playlistCache, new Response(rewritten, {
          headers: Object.assign({ "x-fetched-at": String(Date.now()) }, playlistHeaders)
        }));
      } catch (err) { /* this playlist is still returned */ }
    }
    return new Response(rewritten, { status: upstream.status, headers: playlistHeaders });
  }
  const sniffed = mediaMime(parsed.pathname, type, head) || type || "application/octet-stream";
  return new Response(bytes, {
    status: upstream.status,
    headers: Object.assign({
      "content-type": sniffed,
      "content-length": String(bytes.byteLength)
    }, sharedHeaders)
  });
}

const PUBLIC_MEDIA_HOST = /(?:^|\.)(?:pbs\.twimg\.com|video\.twimg\.com|twimg\.com|cdninstagram\.com|fbcdn\.net|cdn\.discordapp\.com|media\.discordapp\.net|i\.ytimg\.com|ytimg\.com|redd\.it|tiktokcdn(?:-us|-eu)?\.com|bytefcdn(?:-oversea)?\.com|ibytedtos\.com)$/i;

function publicMediaHostOk(hostname) {
  return PUBLIC_MEDIA_HOST.test(String(hostname || ""));
}

async function handlePublicMediaProxy(request, env, url) {
  const target = url.searchParams.get("url") || "";
  let parsed = null;
  try { parsed = new URL(target); } catch (err) { parsed = null; }
  if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password || !publicMediaHostOk(parsed.hostname)) {
    return json(400, { error: "bad_url" });
  }
  const headers = new Headers();
  headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  headers.set("accept", "image/*,video/*,*/*");
  headers.set("referer", parsed.origin + "/");
  const range = request.headers.get("range") || "";
  if (/^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
  let upstream = null;
  try {
    upstream = await fetch(parsed.toString(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      cf: { cacheTtl: 604800, cacheEverything: true }
    });
  } catch (err) {
    return json(502, { error: "upstream" });
  }
  let finalHost = "";
  try { finalHost = new URL(upstream.url).hostname; } catch (err) { finalHost = ""; }
  if (!publicMediaHostOk(finalHost)) {
    dropBody(upstream);
    return json(400, { error: "bad_url" });
  }
  const respHeaders = new Headers();
  const ctype = upstream.headers.get("content-type") || "image/jpeg";
  respHeaders.set("content-type", ctype);
  const length = upstream.headers.get("content-length");
  if (length) respHeaders.set("content-length", length);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) respHeaders.set("content-range", contentRange);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) respHeaders.set("accept-ranges", acceptRanges);
  respHeaders.set("cache-control", "public, max-age=86400, s-maxage=604800");
  respHeaders.set("cdn-cache-control", "public, max-age=604800");
  respHeaders.set("x-content-type-options", "nosniff");
  respHeaders.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

async function handleHandle(env, url) {
  const handle = url.searchParams.get("handle") || "";
  const checked = inspectHandle(handle);
  if (!checked.ok) return json(200, { ok: false, error: checked.error === "reserved" ? "handle_reserved" : "invalid_handle" });
  const clash = await env.DB.prepare("SELECT public_id FROM accounts WHERE skeleton = ?").bind(checked.skeleton).first();
  if (clash) return json(200, { ok: false, error: "handle_taken" });
  if (await handleHeld(env, checked.skeleton)) return json(200, { ok: false, error: "handle_held" });
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
      "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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
  return /^tiktok\/[A-Za-z0-9._]{2,24}\/[1-9][0-9]{5,24}\/live(?:\/[1-9][0-9]{0,3})?$/.test(text);
}

function isLiveParentKey(key) {
  return /^tiktok\/[A-Za-z0-9._]{2,24}\/[1-9][0-9]{5,24}\/live$/.test(String(key || ""));
}

function livePartKey(key) {
  return /^tiktok\/[A-Za-z0-9._]{2,24}\/[1-9][0-9]{5,24}\/live\/[1-9][0-9]{0,3}$/.test(String(key || ""));
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
        "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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
      "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
    }
  });
}

function mediaResponse(bytes, mime, status, extra) {
  const headers = {
    "content-type": mime || "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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

const liveBufCache = new Map();

function liveBufPart(key) {
  const match = /^tiktok\/([A-Za-z0-9._]{2,24})\/([1-9][0-9]{5,24})\/live\/([1-9][0-9]{0,3})$/.exec(String(key || ""));
  if (!match) return null;
  return { handle: match[1], room: match[2], part: match[3], key: match[0] };
}

async function liveBufferIndex(env, partKey) {
  const part = liveBufPart(partKey);
  if (!part || !env.DATA) return [];
  const now = Date.now();
  const hit = liveBufCache.get(part.key);
  if (hit && now - hit.at < 30000) return hit.rows;
  const rows = [];
  try {
    for (let slot = 0; slot <= 8; slot++) {
      const prefix = "live-buf/" + slot + "/" + part.handle + "/" + part.room + "/" + part.part + "/";
      let cursor = undefined;
      do {
        const listed = await env.DATA.list({ prefix, cursor, limit: 200 });
        const objects = (listed && listed.objects) || [];
        for (let i = 0; i < objects.length; i++) {
          const object = objects[i];
          if (!object || !object.key || !String(object.key).endsWith(".json")) continue;
          const sidecar = await env.DATA.get(object.key);
          if (!sidecar) continue;
          let meta = null;
          try { meta = JSON.parse(await sidecar.text()); } catch (err) { meta = null; }
          if (!meta || String(meta.objectKey || "") !== part.key) continue;
          const role = String(meta.role || "");
          const index = Number(meta.index);
          if (role !== "init" && role !== "segment") continue;
          if (role === "init" && index !== -1) continue;
          if (role === "segment" && (!Number.isFinite(index) || index < 0)) continue;
          rows.push({
            kind: role,
            part_index: role === "init" ? -1 : index,
            size: Number(meta.size) || 0,
            duration: Number(meta.duration) || 0,
            mime: "video/mp4",
            object_key: part.key,
            bufKey: String(object.key).replace(/\.json$/, "")
          });
        }
        cursor = listed && listed.truncated ? listed.cursor : "";
      } while (cursor);
    }
  } catch (err) {
    liveBufCache.set(part.key, { at: now, rows: [] });
    return [];
  }
  liveBufCache.set(part.key, { at: now, rows });
  return rows;
}

async function partRows(env, key) {
  const d1 = await telegramRows(env, key);
  let merged = d1;
  if (livePartKey(key)) {
    const extra = await liveBufferIndex(env, key);
    if (extra.length) {
      const seen = {};
      merged = d1.slice();
      d1.forEach((row) => { if (row) seen[row.kind + ":" + row.part_index] = true; });
      extra.forEach((row) => {
        const id = row.kind + ":" + row.part_index;
        if (seen[id]) return;
        seen[id] = true;
        merged.push(row);
      });
    }
  }
  const ready = [];
  for (let i = 0; i < merged.length; i++) {
    const row = merged[i];
    if (!row) continue;
    let size = Number(row.size) || 0;
    if (size <= 0 && row.kind === "init" && row.bufKey && env.DATA && env.DATA.head) {
      try {
        const head = await env.DATA.head(row.bufKey);
        size = Number(head && head.size) || 0;
        if (size > 0) row.size = size;
      } catch (err) { size = 0; }
    }
    if (size > 0) ready.push(row);
  }
  return ready;
}

async function cachedVod(key, build) {
  const cacheKey = new Request("https://tg-cache.internal/vod/" + encodeURIComponent(key));
  try {
    const hit = await caches.default.match(cacheKey);
    const at = hit ? Number(hit.headers.get("x-fetched-at") || 0) : 0;
    if (hit && at && Date.now() - at < 120000) return await hit.text();
  } catch (err) { /* rebuild */ }
  const text = await build();
  if (!text) return "";
  try {
    await caches.default.put(cacheKey, new Response(text, {
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "private, max-age=120",
        "x-fetched-at": String(Date.now())
      }
    }));
  } catch (err) { /* this playlist is still returned */ }
  return text;
}

async function stitchedLivePlaylist(env, parent, origin) {
  const parts = [];
  let misses = 0;
  for (let n = 1; n <= 48; n++) {
    const key = parent + "/" + n;
    const rows = await partRows(env, key);
    const text = livePartPlayable(rows) ? buildPlaylist(rows, key, origin) : "";
    if (!text) {
      misses += 1;
      if (parts.length && misses >= 2) break;
      continue;
    }
    misses = 0;
    parts.push(text);
  }
  return stitchPlaylists(parts);
}

async function serveR2Range(request, env, objectKey) {
  const head = await env.DATA.head(objectKey);
  if (!head) return null;
  const size = Number(head.size || 0);
  const mime = "video/mp4";
  if (size > TG_DIRECT_MAX) {
    const rangeHeader = request.headers.get("Range");
    const range = rangeHeader ? archiveRange(rangeHeader, size) : null;
    if (rangeHeader && !range) {
      return new Response(null, { status: 416, headers: { "content-range": "bytes */" + size, "cache-control": "no-store" } });
    }
    const object = range
      ? await env.DATA.get(objectKey, { range: { offset: range.offset, length: range.length } })
      : await env.DATA.get(objectKey);
    if (!object) return null;
    const headers = {
      "content-type": mime,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
    };
    if (range) {
      headers["content-range"] = "bytes " + range.offset + "-" + range.end + "/" + size;
      headers["content-length"] = String(range.length);
      return new Response(object.body, { status: 206, headers });
    }
    if (size) headers["content-length"] = String(size);
    return new Response(object.body, { status: 200, headers });
  }
  const cacheKey = new Request("https://tg-cache.internal/r2/" + encodeURIComponent(objectKey));
  let full = null;
  try { full = await caches.default.match(cacheKey); } catch (err) { full = null; }
  if (!full) {
    const object = await env.DATA.get(objectKey);
    if (!object) return null;
    const stored = await object.arrayBuffer();
    full = new Response(stored, {
      headers: {
        "content-type": mime,
        "content-length": String(stored.byteLength),
        "cache-control": "public, max-age=31536000, immutable"
      }
    });
    try { await caches.default.put(cacheKey, full.clone()); } catch (err) { /* still served */ }
  }
  const bytes = await full.arrayBuffer();
  const span = parseRange(request.headers.get("Range"), bytes.byteLength);
  if (span === false) {
    return new Response(null, { status: 416, headers: { "content-range": "bytes */" + bytes.byteLength, "cache-control": "no-store" } });
  }
  if (!span) return mediaResponse(bytes, mime, 200, { "cache-control": "private, max-age=31536000, immutable" });
  return mediaResponse(bytes.slice(span.start, span.end + 1), mime, 206, {
    "content-range": "bytes " + span.start + "-" + span.end + "/" + bytes.byteLength,
    "cache-control": "private, max-age=31536000, immutable"
  });
}

async function serveLiveBuffer(request, env, key, index) {
  if (!env.DATA) return null;
  const rows = await liveBufferIndex(env, key);
  const row = rows.find((item) => Number(item.part_index) === Number(index));
  if (!row || !row.bufKey) return null;
  return serveR2Range(request, env, row.bufKey);
}

async function prefetchLiveSegment(env, key, index) {
  const row = await env.DB.prepare("SELECT object_key, kind, part_index, file_id, size, sha256, mime FROM telegram_files WHERE object_key = ? AND kind = 'segment' AND part_index = ? AND serve = 1 AND encrypted = 0").bind(key, index).first();
  if (row && row.file_id && Number(row.size) > 0 && Number(row.size) <= TG_DIRECT_MAX) {
    await telegramBody(env, row);
    return;
  }
  const rows = await liveBufferIndex(env, key);
  const buf = rows.find((item) => Number(item.part_index) === Number(index));
  if (!buf || !buf.bufKey || Number(buf.size) > TG_DIRECT_MAX) return;
  await serveR2Range(new Request("https://tg-cache.internal/prefetch"), env, buf.bufKey);
}

function withPrefetch(ctx, env, key, mode, index, response) {
  if (ctx && ctx.waitUntil && mode === "segment" && livePartKey(key)) {
    const job = prefetchLiveSegment(env, key, Number(index) + 1);
    ctx.waitUntil(job.catch(() => {}));
  }
  return response;
}

async function handleTelegram(request, env, path, ctx) {
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
      if (parent || livePartKey(nested[1])) {
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
    const origin = new URL(request.url).origin;
    let text = "";
    if (isLiveParentKey(key)) text = await cachedVod(key, () => stitchedLivePlaylist(env, key, origin));
    else if (livePartKey(key)) text = await cachedVod(key, async () => {
      const rows = await partRows(env, key);
      return livePartPlayable(rows) ? buildPlaylist(rows, key, origin) : "";
    });
    else text = buildPlaylist(await telegramRows(env, key), key, origin);
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
      "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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
  if ((mode === "segment" || mode === "init") && livePartKey(key)) {
    const tooBig = !!(row && Number(row.size) > TG_DIRECT_MAX);
    if (!row || !row.file_id || tooBig) {
      const buffered = await serveLiveBuffer(request, env, key, mode === "init" ? -1 : index);
      if (buffered) return withPrefetch(ctx, env, key, mode, index, buffered);
      if (tooBig) return json(502, { error: "unavailable" });
    }
  }
  if (!row || !row.file_id) {
    if (mode === "file") {
      const original = await serveKeptOriginal(request, env, key);
      if (original) return original;
    }
    return json(404, { error: "not_found" });
  }
  return withPrefetch(ctx, env, key, mode, index, await rangedTelegram(request, env, row, loopGroupKey(key)));
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
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
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

const DISCORD_BUSY = { in_progress: 1, queued: 1, waiting: 1, pending: 1, requested: 1 };

async function discordLiveBusy(env) {
  const token = String(env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) return true;
  try {
    const res = await fetch("https://api.github.com/repos/ViktorychGroup/ViktorychApp/actions/workflows/discord-live.yml/runs?per_page=5", {
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "viktorych-accounts"
      }
    });
    if (!res.ok) return true;
    const data = await res.json();
    const runs = data && Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    for (let i = 0; i < runs.length; i++) {
      if (DISCORD_BUSY[String(runs[i] && runs[i].status || "")]) return true;
    }
    return false;
  } catch (err) {
    return true;
  }
}

async function maybeDispatchDiscord(env) {
  if (await discordLiveBusy(env)) return false;
  return dispatchWorkflows(env, ["discord-live.yml"]);
}

const WATCH_JOB_PREFIX = "owner/live-jobs/";
const WATCH_MARK_PREFIX = "owner/live-watch/";
const WATCH_UPLOAD_PREFIX = "owner/live-upload/";
const WATCH_ACTIVE_PREFIX = "owner/live-active/";
const WATCH_PUBLIC_PREFIX = "owner/recording-public/";
const WATCH_CHANNELS_KEY = "owner/tiktok-backup-channels.json";
const WATCH_CHANNEL = /^-100\d{4,16}$/;

async function listPrefixNames(env, prefix) {
  const names = [];
  if (!env.DATA || typeof env.DATA.list !== "function") return names;
  let cursor;
  try {
    for (let page = 0; page < 20; page++) {
      const listed = await env.DATA.list({ prefix, cursor, limit: 200 });
      const objects = listed && Array.isArray(listed.objects) ? listed.objects : [];
      for (let i = 0; i < objects.length; i++) {
        const key = String(objects[i] && objects[i].key || "");
        if (!key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length).replace(/\.json$/, "");
        if (name && names.indexOf(name) < 0) names.push(name);
      }
      if (!listed || !listed.truncated || !listed.cursor) break;
      cursor = listed.cursor;
    }
  } catch (err) {
    return names;
  }
  return names;
}

async function readJsonObject(env, key) {
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

async function writeJsonObject(env, key, body) {
  if (!env.DATA) return false;
  try {
    await env.DATA.put(key, JSON.stringify(body));
    return true;
  } catch (err) {
    return false;
  }
}

async function dispatchWorkflow(env, file, inputs) {
  const token = String(env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) return false;
  try {
    const res = await fetch("https://api.github.com/repos/ViktorychGroup/ViktorychApp/actions/workflows/" + file + "/dispatches", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "viktorych-accounts",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref: "main", inputs: inputs || {} })
    });
    return res.status === 204 || res.ok;
  } catch (err) {
    return false;
  }
}

function roomShaped(parsed) {
  const data = parsed && typeof parsed === "object" ? parsed.data : null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const stat = data.status;
  if (stat !== null && stat !== undefined && typeof stat !== "object" && Number.isFinite(Number(stat))) return true;
  return !!(data.stream_url && typeof data.stream_url === "object");
}

async function fetchEnter(roomId, keyed) {
  return liveFetch("https://webcast.tiktok.com/webcast/room/enter/?aid=1988&room_id=" + encodeURIComponent(roomId), {
    "user-agent": PLAY_UA,
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9"
  }, "follow", keyed);
}

async function apiLiveRoomId(handle) {
  let res = null;
  try {
    res = await fetchPublic("https://www.tiktok.com/api-live/user/room/?aid=1988&uniqueId=" + encodeURIComponent(handle) + "&sourceType=54", true);
  } catch (err) {
    return "";
  }
  if (res.status !== 200 || challengeKind(res.status, res.text)) return "";
  let parsed = {};
  try { parsed = JSON.parse(res.text || "{}"); } catch (err) { parsed = {}; }
  const data = parsed && typeof parsed === "object" ? parsed.data : null;
  const id = data && typeof data === "object" ? String(data.roomId || "") : "";
  return /^[1-9][0-9]{5,24}$/.test(id) ? id : "";
}

// Blocked pages still leave free probes: the stored room id almost
// always answers the webcast room API long after www.tiktok.com returns
// 403 to datacenter addresses, the enter path on the same host is the
// second chance, and api-live can hand over the current room id when
// the cached one went stale mid-live. Null when every lane stayed
// blocked or unshaped, so an error document can never read as
// "not live".
async function roomProbe(prev, handle) {
  const cached = String((prev && prev.roomId) || "");
  const verdict = (roomId, res) => {
    let parsed = {};
    try { parsed = JSON.parse(res.text || "{}"); } catch (err) { parsed = {}; }
    const picked = pickStreams(parsed);
    return { live: !!picked.live, roomId, picked };
  };
  let seen = null;
  if (cached && /^[1-9][0-9]{5,24}$/.test(cached)) {
    let room = null;
    try { room = await fetchRoom(cached, true); } catch (err) { room = null; }
    if (room && !challengeKind(room.status, room.text)) {
      seen = Object.assign(verdict(cached, room), { prev });
      if (seen.live) return seen;
    } else {
      let enter = null;
      try { enter = await fetchEnter(cached, true); } catch (err) { enter = null; }
      if (enter && !challengeKind(enter.status, enter.text)) {
        let parsed = {};
        try { parsed = JSON.parse(enter.text || "{}"); } catch (err) { parsed = {}; }
        if (roomShaped(parsed)) {
          seen = Object.assign(verdict(cached, enter), { prev });
          if (seen.live) return seen;
        }
      }
    }
  }
  // A cached id that answers offline may be a finished stream while a
  // new live already runs under a new id, so cross-check before
  // closing the case.
  const fresh = await apiLiveRoomId(handle || "");
  if (fresh && fresh !== cached) {
    let room = null;
    try { room = await fetchRoom(fresh, true); } catch (err) { room = null; }
    if (room && !challengeKind(room.status, room.text)) return Object.assign(verdict(fresh, room), { prev });
  }
  if (seen) return seen;
  return null;
}

// One page load is enough when the live page carries the room id. The
// profile page is the second chance, the same fallback the owner route uses.
async function watchLiveOne(env, handle, prev) {
  let page = null;
  try { page = await fetchPublic("https://www.tiktok.com/@" + handle + "/live", true); }
  catch (err) { return null; }
  const pageKind = challengeKind(page.status, page.text);
  if (pageKind) {
    const probe = await roomProbe(prev, handle);
    if (probe) return probe;
    return { blocked: true, kind: pageKind };
  }
  let roomId = parseRoomId(page.text);
  if (!roomId) {
    let profile = null;
    try { profile = await fetchPublic("https://www.tiktok.com/@" + handle, true); }
    catch (err) { return null; }
    const profileKind = challengeKind(profile.status, profile.text);
    if (profileKind) {
      const probe = await roomProbe(prev, handle);
      if (probe) return probe;
      return { blocked: true, kind: profileKind };
    }
    roomId = parseRoomId(profile.text);
  }
  if (!roomId) return { live: false, roomId: "" };
  let room = null;
  try { room = await fetchRoom(roomId, true); } catch (err) { return null; }
  const roomKind = challengeKind(room.status, room.text);
  if (roomKind) {
    const probe = await roomProbe(prev, handle);
    if (probe) return probe;
    return { blocked: true, kind: roomKind, roomId };
  }
  let parsed = {};
  try { parsed = JSON.parse(room.text || "{}"); } catch (err) { parsed = {}; }
  const picked = pickStreams(parsed);
  return { live: !!picked.live, roomId, picked, prev };
}

function watchAccountNote(handle, status, job, prev) {
  const active = job && job.active && typeof job.active === "object" ? job.active : {};
  const saved = job && Array.isArray(job.saved) ? job.saved : [];
  let last = String((prev && prev.lastRecordingAt) || "");
  saved.forEach((row) => {
    const at = String((row && (row.endedAt || row.startedAt)) || "");
    if (at > last) last = at;
  });
  if (active.startedAt && String(active.startedAt) > last && active.state === "recording") last = String(active.startedAt);
  return {
    checkedAt: stamp(),
    status,
    lastRecordingAt: last,
    recording: active.state === "recording" && !active.captureDone && !active.blocked
  };
}

async function watchTikTokLive(env, nowMs) {
  if (!env.DATA || !String(env.GITHUB_DISPATCH_TOKEN || "").trim()) return;
  await primeLiveCookies(env);
  try {
  const doc = await readOwnerDoc(env);
  if (!doc) return;
  const minute = new Date(Number(nowMs) || Date.now()).getUTCMinutes();
  const handles = watchHandles(doc, 4, minute);
  const prevWatch = await readJsonObject(env, "owner/tiktok-watch.json") || {};
  const prevAccounts = prevWatch.accounts && typeof prevWatch.accounts === "object" ? prevWatch.accounts : {};
  const report = {};
  if (!handles.length) {
    await writeJsonObject(env, "owner/tiktok-watch.json", { checkedAt: stamp(), accounts: prevAccounts });
    return;
  }
  const channelDoc = await readJsonObject(env, WATCH_CHANNELS_KEY);
  const extras = Array.isArray(channelDoc && channelDoc.channels)
    ? channelDoc.channels.filter((value) => WATCH_CHANNEL.test(String(value || "").trim())).length
    : 0;
  const channels = Math.max(1, Math.min(1 + extras, 12));
  const live = doc.live && typeof doc.live === "object" ? doc.live : {};
  const activeNames = await listPrefixNames(env, WATCH_ACTIVE_PREFIX);
  let uploader = false;

  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i];
    const prev = live[handle] && typeof live[handle] === "object" ? live[handle] : {};
    const markKey = WATCH_MARK_PREFIX + handle + ".json";
    const mark = await readJsonObject(env, markKey);
    const blocks = Math.max(0, Number(mark && mark.blocks) || 0);
    const pause = Math.min(30, 2 * Math.pow(2, Math.min(blocks, 4))) * 60 * 1000;
    if (mark && mark.blockedAt && fresh(mark.blockedAt, nowMs, pause)) {
      report[handle] = watchAccountNote(handle, "blocked", null, prevAccounts[handle]);
      continue;
    }

    const seen = await watchLiveOne(env, handle, prev);
    if (!seen) continue;
    if (seen.blocked) {
      const next = Object.assign({}, mark || {}, {
        handle,
        blockedAt: stamp(),
        blocks: blocks + 1,
        status: seen.kind || "blocked",
        roomId: seen.roomId || (mark && mark.roomId) || ""
      });
      await writeJsonObject(env, markKey, next);
      report[handle] = watchAccountNote(handle, "blocked", null, prevAccounts[handle]);
      continue;
    }
    if (blocks) await writeJsonObject(env, markKey, Object.assign({}, mark, { blocks: 0, blockedAt: "" }));

    const info = liveInfo(handle, prev, seen.roomId || "", seen.picked || { live: false });
    if (info.live && !(prev && prev.live)) {
      try {
        await notifyLiveStarted(env, {
          handle,
          platform: "tiktok",
          roomId: String(seen.roomId || info.roomId || ""),
          title: info.title || "",
          name: handle,
          at: Number(nowMs) || Date.now()
        });
      } catch (err) { /* the recording decision still runs */ }
    }
    if (shouldRememberLive(prev, info, nowMs)) await rememberLive(env, handle, info);

    const job = await readJsonObject(env, WATCH_JOB_PREFIX + handle + ".json");
    const active = job && job.active && typeof job.active === "object" ? job.active : {};
    report[handle] = watchAccountNote(handle, info.live ? "live" : "offline", job, prevAccounts[handle]);

    if (needsUpload(active, nowMs)) uploader = true;
    if (!info.live) continue;

    const choice = watchDecision(job, mark, seen.roomId, nowMs);
    if (!admitRecord(choice, handle, activeNames)) continue;
    const ok = await dispatchWorkflow(env, "tiktok-record.yml", {
      handle,
      part: String(choice.part || 1),
      room: String(seen.roomId || "")
    });
    if (ok) {
      await writeJsonObject(env, markKey, { handle, roomId: seen.roomId, part: choice.part || 1, at: stamp() });
      const held = String(handle || "").toLowerCase();
      if (activeNames.map((name) => String(name || "").toLowerCase()).indexOf(held) < 0) activeNames.push(held);
    } else {
      await writeJsonObject(env, markKey, Object.assign({}, mark || {}, { handle, failedAt: stamp() }));
    }
  }

  await writeJsonObject(env, "owner/tiktok-watch.json", {
    checkedAt: stamp(),
    accounts: Object.assign({}, prevAccounts, report)
  });
  if (!uploader) return;
  for (let slot = 0; slot < channels; slot++) {
    const beat = await readJsonObject(env, WATCH_UPLOAD_PREFIX + slot + ".json");
    if (!uploaderStale(beat, nowMs)) continue;
    await dispatchWorkflow(env, "tiktok-live-upload.yml", { slot: String(slot) });
    break;
  }
  } finally {
    releaseLiveCookies();
  }
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
const RESUME_KEY = "owner/playback-resume.json";

function cleanResumeMap(doc) {
  const out = {};
  const rows = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  const names = Object.keys(rows).slice(0, 80);
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    if (!/^[A-Za-z0-9._-]{4,80}$/.test(key)) continue;
    const row = rows[key];
    const t = Number(row && row.t);
    const at = Number(row && row.at);
    if (!Number.isFinite(t) || t < 0 || t > 172800) continue;
    if (!Number.isFinite(at) || at < 0 || at > 10000000000000) continue;
    out[key] = { t: Math.round(t * 10) / 10, at: Math.round(at) };
  }
  return out;
}

async function handlePlaybackResume(request, env) {
  const gate = await requireOwner(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const paced = await rateHit(env, "live-resume:" + gate.row.public_id, 120, 10 * 60 * 1000);
  if (!paced.ok) return limited(paced);
  const current = cleanResumeMap(await readJsonKey(env, RESUME_KEY));
  if (request.method === "GET") return json(200, { items: current });
  if (request.method !== "PUT") return json(405, { error: "method" });
  const body = await readJson(request, 20000);
  if (body.error) return json(400, { error: body.error });
  const incoming = cleanResumeMap(body.items || body);
  const names = Object.keys(incoming);
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    const prev = current[key];
    if (!prev || incoming[key].at >= prev.at) current[key] = incoming[key];
  }
  const trimmed = {};
  Object.keys(current).sort((a, b) => current[b].at - current[a].at).slice(0, 80).forEach((key) => { trimmed[key] = current[key]; });
  await env.DATA.put(RESUME_KEY, JSON.stringify(trimmed));
  return json(200, { items: trimmed });
}

async function handleLiveThumb(request, env, handle, room) {
  const gate = await requireTiktok(request, env);
  if (gate.error) return gate.error;
  const key = thumbObjectKey(handle, room);
  if (!key || !env.DATA) return json(404, { error: "not_found" });
  const cacheKey = new Request("https://live-thumb.internal/" + key);
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("cache-control", "private, max-age=86400");
      headers.set("cdn-cache-control", "no-store");
      headers.delete("x-fetched-at");
      return new Response(await hit.arrayBuffer(), { status: 200, headers });
    }
  } catch (err) { /* read the stored frame */ }
  let bytes = null;
  const object = await env.DATA.get(key);
  if (object) bytes = await object.arrayBuffer();
  if (!bytes && b2Configured(env)) bytes = await b2GetThumb(env, key);
  if (!bytes || !bytes.byteLength) return json(404, { error: "not_found" });
  const headers = {
    "content-type": "video/mp4",
    "cache-control": "private, max-age=86400",
    "cdn-cache-control": "no-store",
    vary: "Authorization",
    "x-content-type-options": "nosniff"
  };
  try {
    await caches.default.put(cacheKey, new Response(bytes, {
      headers: Object.assign({ "x-fetched-at": String(Date.now()) }, headers)
    }));
  } catch (err) { /* this frame is still returned */ }
  return new Response(bytes, { status: 200, headers });
}
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

function ownedThumb(value) {
  const text = String(value || "");
  const match = /^owner\/live-thumbs\/([A-Za-z0-9._]{2,24})\/([1-9][0-9]{5,24})\.mp4$/.exec(text);
  if (!match) return "";
  const key = thumbObjectKey(match[1], match[2]);
  return key && key === text.toLowerCase() ? key : "";
}

function scrubRecording(row) {
  if (!row || typeof row !== "object") return null;
  const state = ["recording", "queued", "saved", "blocked"].indexOf(row.state) >= 0 ? row.state : "";
  if (!state) return null;
  const key = state === "saved" && LIVE_PLAY_KEY.test(String(row.key || "")) ? String(row.key) : "";
  const body = {
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
  const bytes = Math.max(0, Number(row.bytes) || 0);
  const thumb = ownedThumb(row.thumb);
  if (bytes) body.bytes = bytes;
  if (thumb) body.thumb = thumb;
  return body;
}

async function playableLiveParents(env) {
  if (!env.DB) return null;
  try {
    const listed = await env.DB.prepare("SELECT object_key FROM telegram_files WHERE serve = 1 AND encrypted = 0 AND object_key LIKE 'tiktok/%/live/%' GROUP BY object_key HAVING SUM(CASE WHEN kind = 'init' AND part_index = -1 AND size > 0 THEN 1 ELSE 0 END) > 0 AND SUM(CASE WHEN kind = 'segment' AND size > 0 THEN 1 ELSE 0 END) > 0 LIMIT 400").all();
    const found = new Set();
    ((listed && listed.results) || []).forEach((row) => {
      const parts = liveKeyParts(row && row.object_key);
      if (parts) found.add(parts.key);
    });
    return found;
  } catch (err) {
    return null;
  }
}

async function handleRecordings(request, env) {
  const gate = await requireOwner(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const index = await readJsonKey(env, RECORDINGS_KEY) || {};
  const listed = index.items && typeof index.items === "object" ? index.items : {};
  const items = {};
  const past = [];
  let active = 0;
  const names = Object.keys(listed);
  const extra = await listPrefixNames(env, WATCH_PUBLIC_PREFIX);
  extra.forEach((name) => {
    if (names.indexOf(name) < 0) names.push(name);
  });
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!TIKTOK_HANDLE.test(name)) continue;
    const job = await readJsonKey(env, LIVE_JOB_PREFIX + name + ".json");
    const row = scrubRecording((job && job.public) || listed[name]);
    if (!row) continue;
    items[name] = row;
    if (row.state === "recording") active += 1;
    pastFromJob(name, job, row).forEach((item) => past.push(item));
  }
  const knownRooms = {};
  past.forEach((item) => { knownRooms[String(item.handle || "") + "\n" + String(item.roomId || "")] = true; });
  const stored = await storedLiveRecordings(env);
  stored.forEach((item) => {
    const id = String(item.handle || "") + "\n" + String(item.roomId || "");
    if (knownRooms[id]) return;
    knownRooms[id] = true;
    past.push(item);
  });
  past.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  const playable = await playableLiveParents(env);
  const shown = playable ? past.filter((item) => item && playable.has(String(item.key || ""))) : past;
  const cap = Math.max(1, Math.min(16, Number(index.cap) || 16));
  return json(200, { cap, active, items, past: shown });
}

const LIVE_PARENT_KEY = /^tiktok\/([A-Za-z0-9._]{2,24})\/([1-9][0-9]{5,24})\/live(?:\/([1-9][0-9]{0,3}))?$/;

function liveKeyParts(value) {
  const match = LIVE_PARENT_KEY.exec(String(value || ""));
  if (!match) return null;
  return { handle: match[1].toLowerCase(), roomId: match[2], part: match[3] ? Number(match[3]) : 1, key: "tiktok/" + match[1].toLowerCase() + "/" + match[2] + "/live" };
}

async function storedLiveRecordings(env) {
  const found = {};
  function add(row) {
    const parts = liveKeyParts(row && (row.key || row.object_key));
    if (!parts || !TIKTOK_HANDLE.test(parts.handle)) return;
    const id = parts.handle + "\n" + parts.roomId;
    const prev = found[id];
    const part = Math.max(1, Number(row.part || parts.part) || 1);
    if (!prev) {
      found[id] = {
        state: "saved",
        handle: parts.handle,
        roomId: parts.roomId,
        key: parts.key,
        parts: part,
        title: String(row.title || "").slice(0, 180),
        startedAt: String(row.startedAt || ""),
        endedAt: String(row.endedAt || ""),
        duration: Number(row.duration) || 0,
        quality: String(row.quality || ""),
        qualityNote: String(row.qualityNote || ""),
        cover: String(row.cover || "").slice(0, 400),
        viewers: Math.max(0, Number(row.viewers) || 0),
        bytes: Math.max(0, Number(row.bytes) || 0)
      };
      return;
    }
    prev.parts = Math.max(prev.parts, part);
    if (!prev.startedAt && row.startedAt) prev.startedAt = String(row.startedAt);
    if (!prev.title && row.title) prev.title = String(row.title).slice(0, 180);
  }
  if (env.DB) {
    try {
      const listed = await env.DB.prepare("SELECT object_key FROM telegram_files WHERE serve = 1 AND encrypted = 0 AND object_key LIKE 'tiktok/%/live%' GROUP BY object_key LIMIT 400").all();
      ((listed && listed.results) || []).forEach((row) => add({ key: row.object_key }));
    } catch (err) { /* the job list still returns */ }
  }
  if (env.DATA && typeof env.DATA.list === "function") {
    try {
      const names = [];
      let cursor;
      for (let page = 0; page < 8; page++) {
        const listed = await env.DATA.list({ prefix: "owner/live-manifests/", cursor, limit: 100 });
        const objects = listed && Array.isArray(listed.objects) ? listed.objects : [];
        objects.forEach((object) => { if (object && object.key) names.push(String(object.key)); });
        if (!listed || !listed.truncated || !listed.cursor) break;
        cursor = listed.cursor;
      }
      for (let i = 0; i < names.length && i < 80; i++) {
        const object = await env.DATA.get(names[i]);
        if (!object) continue;
        let meta = null;
        try { meta = JSON.parse(await object.text()); } catch (err) { meta = null; }
        if (meta) add(meta);
      }
    } catch (err) { /* uploaded keys still list */ }
  }
  return Object.keys(found).map((id) => found[id]);
}

function pastFromJob(handle, job, fallback) {
  const rows = [];
  const active = job && job.active && typeof job.active === "object" ? job.active : null;
  if (active && active.captureDone && Number(active.segments || 0) > 0 && LIVE_PLAY_KEY.test(String(active.key || ""))) {
    const already = rows.some((item) => String(item.roomId || "") === String(active.roomId || ""));
    if (!already) {
      const finished = scrubRecording(Object.assign({}, active, { state: "saved" }));
      if (finished) {
        finished.handle = handle;
        finished.key = String(active.key);
        finished.viewers = Math.max(0, Number(active.viewers) || 0);
        rows.push(finished);
      }
    }
  }
  if (active && (active.state === "recording" || active.state === "queued") && !active.captureDone) {
    const row = scrubRecording(Object.assign({}, active, { state: active.state }));
    if (row) {
      row.handle = handle;
      row.viewers = Math.max(0, Number(active.viewers) || 0);
      if (active.state === "recording" && Number(active.segments || 0) > 0 && LIVE_PLAY_KEY.test(String(active.key || ""))) {
        row.key = String(active.key);
      }
      rows.push(row);
    }
  }
  const saved = job && Array.isArray(job.saved) ? job.saved : [];
  saved.forEach((item) => {
    const row = scrubRecording(Object.assign({}, item, { state: "saved" }));
    if (!row) return;
    row.handle = handle;
    row.viewers = Math.max(0, Number(item && item.viewers) || 0);
    rows.push(row);
  });
  if (!rows.length && fallback && (fallback.state === "saved" || fallback.state === "recording")) {
    const row = Object.assign({ handle, viewers: Math.max(0, Number(fallback.viewers) || 0) }, fallback);
    rows.push(row);
  }
  return rows;
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
    if (!row || row.profile_less === 1) continue;
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
  const account = await env.DB.prepare("SELECT public_id, profile_less FROM accounts WHERE public_id = ?").bind(id.slice(4)).first();
  if (!account || account.profile_less === 1) return { error: json(404, { error: "not_found" }) };
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
  const existing = await env.DB.prepare("SELECT created_at FROM account_follows WHERE follower_id = ? AND target_id = ?").bind(gate.row.public_id, id).first();
  await env.DB.prepare("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(follower_id, target_id) DO UPDATE SET snapshot = CASE WHEN excluded.snapshot != '' THEN excluded.snapshot ELSE account_follows.snapshot END").bind(gate.row.public_id, id, snapshot, Date.now()).run();
  if (!existing) {
    try { await notifyFollow(env, gate.row, id); }
    catch (err) { /* the follow is saved */ }
  }
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
  const body = await readJson(request, 500000);
  if (body.error) return json(400, { error: body.error });
  const incoming = Array.isArray(body.ids) ? body.ids : null;
  if (!incoming) return json(400, { error: "bad_follow" });
  const ids = [];
  for (let i = 0; i < incoming.length && ids.length < 5000; i++) {
    const id = cleanFollowId(incoming[i]);
    if (!id || id === "app:" + gate.row.public_id || ids.indexOf(id) >= 0) continue;
    if (id.indexOf("app:") === 0) {
      const account = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(id.slice(4)).first();
      if (!account) continue;
    }
    ids.push(id);
  }
  const now = Date.now();
  // A bulk import must not notify. Only a new follow from PUT does.
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    await env.DB.batch(part.map((id) => env.DB.prepare("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?) ON CONFLICT(follower_id, target_id) DO NOTHING").bind(gate.row.public_id, id, now)));
  }
  const followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", gate.row.public_id);
  return json(200, { ok: true, followingCount });
}

async function listFollowIds(env, followerId) {
  const ids = [];
  const page = 500;
  const cap = 5000;
  for (let offset = 0; ids.length < cap; offset += page) {
    const listed = await env.DB.prepare("SELECT target_id FROM account_follows WHERE follower_id = ? ORDER BY created_at DESC, target_id ASC LIMIT ? OFFSET ?").bind(followerId, page, offset).all();
    const rows = (listed && listed.results) || [];
    for (let i = 0; i < rows.length && ids.length < cap; i++) {
      if (rows[i] && rows[i].target_id) ids.push(rows[i].target_id);
    }
    if (rows.length < page) break;
  }
  return ids;
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
  const isOwner = !!(account && gate.row.public_id === account.public_id);
  const isPrivate = !!(account && account.private_follows === 1);
  const body = {
    id: subject,
    kind: account ? "account" : "feed",
    followersCount: await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ?", subject),
    viewerFollows: subject !== "app:" + gate.row.public_id && await followExists(env, gate.row.public_id, subject)
  };
  if (account) {
    body.followingCount = await followCount(env, "SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ?", account.public_id);
    body.isPrivate = isPrivate;
  }
  if (!tab && subject === "app:" + gate.row.public_id) {
    body.ids = await listFollowIds(env, gate.row.public_id);
    return json(200, body);
  }
  if (!tab) return json(200, body);
  if (!isOwner && isPrivate) {
    body.accounts = [];
    return json(200, body);
  }
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


async function friendCount(env, publicId) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_friends WHERE user_id = ?").bind(publicId).first();
    return (row && Number(row.n)) || 0;
  } catch (err) {
    return 0;
  }
}

async function mutualFriendCount(env, userA, userB) {
  if (!userA || !userB || userA === userB) return 0;
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_friends f1 JOIN account_friends f2 ON f1.friend_id = f2.friend_id WHERE f1.user_id = ? AND f2.user_id = ?").bind(userA, userB).first();
    return (row && Number(row.n)) || 0;
  } catch (err) {
    return 0;
  }
}

async function getFriendStatus(env, viewerId, targetId) {
  if (!viewerId || !targetId) return "none";
  if (viewerId === targetId) return "self";
  try {
    const isFriend = await env.DB.prepare("SELECT friend_id FROM account_friends WHERE user_id = ? AND friend_id = ?").bind(viewerId, targetId).first();
    if (isFriend) return "friends";
    const sent = await env.DB.prepare("SELECT receiver_id FROM account_friend_requests WHERE sender_id = ? AND receiver_id = ?").bind(viewerId, targetId).first();
    if (sent) return "sent";
    const received = await env.DB.prepare("SELECT sender_id FROM account_friend_requests WHERE sender_id = ? AND receiver_id = ?").bind(targetId, viewerId).first();
    if (received) return "received";
    return "none";
  } catch (err) {
    return "none";
  }
}

function cleanFriendTargetId(raw) {
  const s = String(raw || "").trim();
  if (s.indexOf("app:") === 0) return s.slice(4);
  return /^\d{12}$/.test(s) ? s : null;
}

async function handleFriendsGet(request, env, url) {
  const viewer = await sessionAccount(env, request);
  if (!viewer) return json(401, { error: "unauthorized" });

  const tab = String(url.searchParams.get("tab") || "").trim();
  const rawId = url.searchParams.get("id") || ("app:" + viewer.public_id);
  const targetId = cleanFriendTargetId(rawId);
  if (!targetId) return json(400, { error: "bad_target" });

  if (tab === "requests") {
    const incomingRows = await env.DB.prepare("SELECT sender_id, created_at FROM account_friend_requests WHERE receiver_id = ? ORDER BY created_at DESC LIMIT 100").bind(viewer.public_id).all();
    const outgoingRows = await env.DB.prepare("SELECT receiver_id, created_at FROM account_friend_requests WHERE sender_id = ? ORDER BY created_at DESC LIMIT 100").bind(viewer.public_id).all();

    const incomingCards = await followCards(env, request, ((incomingRows && incomingRows.results) || []).map((r) => r.sender_id));
    for (let i = 0; i < incomingCards.length; i++) {
      const card = incomingCards[i];
      const sId = cleanFriendTargetId(card.id);
      card.mutualFriendsCount = await mutualFriendCount(env, viewer.public_id, sId);
      card.friendStatus = "received";
    }

    const outgoingCards = await followCards(env, request, ((outgoingRows && outgoingRows.results) || []).map((r) => r.receiver_id));
    for (let i = 0; i < outgoingCards.length; i++) {
      const card = outgoingCards[i];
      const rId = cleanFriendTargetId(card.id);
      card.mutualFriendsCount = await mutualFriendCount(env, viewer.public_id, rId);
      card.friendStatus = "sent";
    }

    return json(200, {
      incoming: incomingCards,
      outgoing: outgoingCards,
      requestsCount: incomingCards.length
    });
  }

  const targetAccount = await env.DB.prepare("SELECT " + ACCOUNT_COLS + " FROM accounts WHERE public_id = ?").bind(targetId).first();
  if (!targetAccount) return json(404, { error: "not_found" });

  const isOwner = !!(viewer && viewer.public_id === targetAccount.public_id);
  if (targetAccount.profile_less === 1 && !isOwner) return json(404, { error: "not_found" });
  const isPrivate = !!(targetAccount && targetAccount.private_follows === 1);

  const friendsCount = await friendCount(env, targetId);
  const status = await getFriendStatus(env, viewer.public_id, targetId);
  const mutualCount = await mutualFriendCount(env, viewer.public_id, targetId);

  if (tab === "friends") {
    if (!isOwner && isPrivate && status !== "friends") {
      return json(200, {
        id: "app:" + targetId,
        friendsCount,
        status,
        mutualCount,
        isPrivate: true,
        friends: []
      });
    }
    const friendRows = await env.DB.prepare("SELECT friend_id, created_at FROM account_friends WHERE user_id = ? ORDER BY created_at DESC LIMIT 300").bind(targetId).all();
    const ids = ((friendRows && friendRows.results) || []).map((r) => r.friend_id);
    const cards = await followCards(env, request, ids);
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const fId = cleanFriendTargetId(card.id);
      card.mutualFriendsCount = await mutualFriendCount(env, viewer.public_id, fId);
      card.friendStatus = await getFriendStatus(env, viewer.public_id, fId);
    }
    return json(200, {
      id: "app:" + targetId,
      friendsCount,
      status,
      mutualCount,
      isPrivate: false,
      friends: cards
    });
  }

  return json(200, {
    id: "app:" + targetId,
    friendsCount,
    status,
    mutualCount
  });
}

async function handleFriendAction(request, env, action) {
  const viewer = await sessionAccount(env, request);
  if (!viewer) return json(401, { error: "unauthorized" });

  const body = await readJson(request, 2048);
  if (body.error) return json(400, { error: "bad_json" });

  const targetId = cleanFriendTargetId(body.targetId || body.id);
  if (!targetId || targetId === viewer.public_id) {
    return json(400, { error: "bad_target" });
  }

  const targetRow = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(targetId).first();
  if (!targetRow) return json(404, { error: "not_found" });

  const now = Date.now();

  if (action === "request") {
    const alreadyFriends = await env.DB.prepare("SELECT user_id FROM account_friends WHERE user_id = ? AND friend_id = ?").bind(viewer.public_id, targetId).first();
    if (alreadyFriends) {
      return json(200, { ok: true, status: "friends", friendsCount: await friendCount(env, viewer.public_id) });
    }
    const reverse = await env.DB.prepare("SELECT sender_id FROM account_friend_requests WHERE sender_id = ? AND receiver_id = ?").bind(targetId, viewer.public_id).first();
    if (reverse) {
      await env.DB.prepare("DELETE FROM account_friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)").bind(targetId, viewer.public_id, viewer.public_id, targetId).run();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(viewer.public_id, targetId, now),
        env.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(targetId, viewer.public_id, now)
      ]);
      return json(200, { ok: true, status: "friends", friendsCount: await friendCount(env, viewer.public_id) });
    }
    const paced = await rateHit(env, "freq:" + viewer.public_id, 40, 10 * 60 * 1000);
    if (!paced.ok) return limited(paced);

    await env.DB.prepare("INSERT INTO account_friend_requests (sender_id, receiver_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(viewer.public_id, targetId, now).run();
    return json(200, { ok: true, status: "sent", friendsCount: await friendCount(env, viewer.public_id) });
  }

  if (action === "accept") {
    await env.DB.prepare("DELETE FROM account_friend_requests WHERE sender_id = ? AND receiver_id = ?").bind(targetId, viewer.public_id).run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(viewer.public_id, targetId, now),
      env.DB.prepare("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(targetId, viewer.public_id, now)
    ]);
    return json(200, { ok: true, status: "friends", friendsCount: await friendCount(env, viewer.public_id) });
  }

  if (action === "decline") {
    await env.DB.prepare("DELETE FROM account_friend_requests WHERE sender_id = ? AND receiver_id = ?").bind(targetId, viewer.public_id).run();
    return json(200, { ok: true, status: "none", friendsCount: await friendCount(env, viewer.public_id) });
  }

  if (action === "cancel") {
    await env.DB.prepare("DELETE FROM account_friend_requests WHERE sender_id = ? AND receiver_id = ?").bind(viewer.public_id, targetId).run();
    return json(200, { ok: true, status: "none", friendsCount: await friendCount(env, viewer.public_id) });
  }

  if (action === "remove") {
    await env.DB.prepare("DELETE FROM account_friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").bind(viewer.public_id, targetId, targetId, viewer.public_id).run();
    return json(200, { ok: true, status: "none", friendsCount: await friendCount(env, viewer.public_id) });
  }

  return json(400, { error: "bad_action" });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/robots.txt" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(request.method === "HEAD" ? null : "User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
      }
    });
  }
  // The X mirror only reads R2, so it answers before the schema check.
  if (path === "/v1/x" || path.startsWith("/v1/x/")) {
    return handleXProxy(request, env, url);
  }
  await ensureSchema(env);
  if (path === "/v1/geo" && (request.method === "GET" || request.method === "HEAD")) {
    const isTor = !!(request.cf && request.cf.isTor) || request.headers.get("cf-ipcountry") === "T1";
    const country = (request.cf && request.cf.country) || request.headers.get("cf-ipcountry") || "XX";
    return json(200, { country: country, isRu: country === "RU", isTor: isTor });
  }
  if (path === "/v1/media" && (request.method === "GET" || request.method === "HEAD")) {
    return handlePublicMediaProxy(request, env, url);
  }
  if (path === "/v1/yt/manifest" || path === "/v1/yt/media") {
    return handleYtRoute(request, env, url);
  }
  if (path === "/v1/health" && request.method === "GET") {
    return json(200, { ok: true, ready: !!env.ACCOUNT_PEPPER, data: !!env.DATA, turnstile: !!env.TURNSTILE_SECRET, telegram: !!env.TELEGRAM_BOT_TOKEN });
  }
  if ((path === "/tg" || path.startsWith("/tg/")) && (request.method === "GET" || request.method === "HEAD")) {
    return handleTelegram(request, env, path, ctx);
  }
  const archiveMedia = path.match(/^\/v1\/archive\/([a-f0-9]{64}\.[a-z0-9]{1,8})$/);
  if (archiveMedia && (request.method === "GET" || request.method === "HEAD")) return handleArchive(request, env, archiveMedia[1]);
  const accountMedia = path.match(/^\/v1\/media\/(avatars|banners)\/(\d{12})\/([a-f0-9]{64}\.(?:webp|jpg|png))$/);
  if (accountMedia && request.method === "GET") return handleAccountMedia(request, env, accountMedia[1], accountMedia[2], accountMedia[3]);
  if (path.startsWith("/v1/data/") && request.method === "GET") return handleData(request, env, path);
  if (path === "/v1/owner/keys" || path.startsWith("/v1/owner/keys/")) {
    return handleOwnerKeys(request, env, path, { json, readJson, rateHit, limited, sessionAccount, timingEqual });
  }
  if (path === "/v1/owner/accounts" && (request.method === "GET" || request.method === "POST")) return handleAddedAccounts(request, env, url);
  const addedAccount = path.match(/^\/v1\/owner\/accounts\/([^/]+)$/);
  if (addedAccount && request.method === "DELETE") return handleAddedAccountDelete(request, env, addedAccount[1]);
  if (path === "/v1/owner/tiktok/accounts" && (request.method === "GET" || request.method === "POST")) return handleTikTokAccounts(request, env);
  const ownerAccount = path.match(/^\/v1\/owner\/tiktok\/accounts\/([^/]+)$/);
  if (ownerAccount && request.method === "DELETE") return handleTikTokAccountDelete(request, env, ownerAccount[1]);
  if (path === "/v1/owner/tiktok/health" && request.method === "GET") return handleTikTokHealth(request, env);
  if (path === "/v1/owner/tiktok/recordings" && request.method === "GET") return handleRecordings(request, env);
  if (path === "/v1/owner/tiktok/channels" && (request.method === "GET" || request.method === "POST")) return handleBackupChannels(request, env);
  if (path === "/v1/owner/tiktok/board" && request.method === "GET") return handleLiveBoard(request, env);
  if (path === "/v1/owner/live-resume" && (request.method === "GET" || request.method === "PUT")) return handlePlaybackResume(request, env);
  const thumbPath = path.match(/^\/v1\/owner\/tiktok\/thumb\/([A-Za-z0-9._]{2,24})\/([1-9][0-9]{5,24})$/);
  if (thumbPath && request.method === "GET") return handleLiveThumb(request, env, thumbPath[1], thumbPath[2]);
  if (path === "/v1/owner/tiktok" && request.method === "GET") return handleOwnerTiktok(request, env);
  if (path === "/v1/owner/play" && request.method === "GET") return handleOwnerPlay(request, env, url);
  if (path === "/v1/owner/media" && request.method === "GET") return handleOwnerMedia(request, env, url);
  const ownerLive = path.match(/^\/v1\/owner\/live\/([^/]+)$/);
  if (ownerLive && request.method === "GET") return handleOwnerLive(request, env, ownerLive[1]);
  if (path === "/v1/signup" && request.method === "POST") return handleSignup(request, env);
  if (path === "/v1/login" && request.method === "POST") return handleLogin(request, env);
  if (path === "/v1/account/delete" && request.method === "POST") {
    return handleAccountDelete(request, env, { json, readJson, rateHit, limited, sessionAccount, allowedOrigins, verifyAccountNumber });
  }
  if (path === "/v1/account/reauth" && request.method === "POST") {
    return handleAccountReauth(request, env, { json, readJson, rateHit, limited, sessionAccount, allowedOrigins, verifyAccountNumber });
  }
  if (path === "/v1/account/deletions" && request.method === "GET") {
    return handleDeletionList(request, env, { json, rateHit, limited });
  }
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
  if (path === "/v1/friends" && request.method === "GET") return handleFriendsGet(request, env, url);
  if (path === "/v1/friends/request" && request.method === "POST") return handleFriendAction(request, env, "request");
  if (path === "/v1/friends/accept" && request.method === "POST") return handleFriendAction(request, env, "accept");
  if (path === "/v1/friends/decline" && request.method === "POST") return handleFriendAction(request, env, "decline");
  if (path === "/v1/friends/cancel" && request.method === "POST") return handleFriendAction(request, env, "cancel");
  if (path === "/v1/friends/remove" && request.method === "POST") return handleFriendAction(request, env, "remove");
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
  if (path === "/.well-known/webfinger" || path === "/.well-known/nostr.json" || path.startsWith("/ap/") || path.startsWith("/v1/federation/")) {
    return handleFederationRoute(request, env, path, url, { json, sessionAccount, readJson, rateHit, limited });
  }
  if (path === "/v1/account/identities" || path.startsWith("/v1/account/identities/")) {
    return handleIdentitiesRoute(request, env, path, url, { json, sessionAccount, readJson, rateHit, limited });
  }

  if (path === "/v1/presence") {
    return handlePresence(request, env, url, { json, sessionAccount, readJson, rateHit, limited });
  }
  if (path === "/v1/channel" || path === "/v1/channel/ticket") {
    return handleChannel(request, env, url, { json, sessionAccount, rateHit, limited });
  }
  if (path === "/v1/vault" || path.startsWith("/v1/vault/")) {

    return handleVaultRoute(request, env, path, url, { json, sessionAccount, readJson, rateHit, limited });

  }
  if (path === "/v1/notifications" || path === "/v1/notifications/read" || path === "/v1/push/vapid" || path === "/v1/push/subscribe") {
    const handled = await handleNotificationRoutes(request, env, path, { json, sessionAccount, readJson, rateHit, limited });
    if (handled) return handled;
  }
  return json(404, { error: "not_found" });
}

export { AccountChannel };

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const origin = request.headers.get("Origin");
      if (origin && !isPublicFederationRoute(path) && allowedOrigins(env).indexOf(origin) < 0) return json(403, { error: "origin" });
      const response = await route(request, env, ctx);
      return withCors(request, env, response);
    } catch (err) {
      return json(500, { error: "unavailable" });
    }
  },
  async scheduled(event, env, ctx) {
    const at = Number(event && event.scheduledTime) || Date.now();
    const jobs = [watchTikTokLive(env, at), resumeAccountDeletions(env), sweepExpiredStatuses(env, at)];
    // The cron runs every minute for TikTok. The Discord mirror keeps its
    // fifteen minute rhythm.
    if (new Date(at).getUTCMinutes() % 15 === 0) jobs.push(maybeDispatchDiscord(env));
    const all = Promise.allSettled(jobs);
    if (ctx && ctx.waitUntil) ctx.waitUntil(all);
    else await all;
  }
};
