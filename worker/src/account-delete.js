/* Self-service account deletion.
   One job row tracks the wipe until every step has finished. The cron
   resumes anything left behind. After the job is done, the only lasting
   public record is a salted hash of the account id.

   Tables audited against migrations 0001–0018 and the runtime schema:
   accounts, sessions, sync_state (notification tabs, feed settings, groups,
   drafts, likes, bookmarks, resume and history), rate_limits,
   account_reposts, account_follows (both directions), drive_vault,
   drive_items, drive_chunks, community_posts, community_likes,
   community_members, community_notes, account_friend_requests,
   account_friends, dm_conversations, dm_messages, account_federation,
   ap_followers, account_identities, identity_challenges, vault_configs,
   vault_items, vault_shares, owner_keys, owner_key_items, owner_key_pace,
   account_reauths. telegram_files is a shared media index with no account
   column, so it is left alone. There is no invites table. */

import { OWNER_HANDLE, inspectHandle, ownerSkeleton } from "../../shared/handle-skeleton.js";

const OWNER_GITHUB = "SeRgi270710267";
const encoder = new TextEncoder();
const DAY_MS = 24 * 60 * 60 * 1000;
const REAUTH_MS = 5 * 60 * 1000;
const JOB_KEEP_MS = DAY_MS;
const USER_COLUMNS = ["public_id", "follower_id", "target_id", "sender_id", "receiver_id", "user_id", "friend_id", "author_id", "owner_id", "recipient_id"];
const SKIP_TABLES = new Set(["account_deletion_jobs", "account_deletions", "handle_holds", "rate_limits", "telegram_files", "sqlite_sequence"]);
const ID_FIELDS = ["publicId", "public_id", "userId", "user_id", "authorId", "author_id", "followerId", "follower_id", "accountId", "account_id", "senderId", "sender_id", "recipientId", "recipient_id", "ownerId", "owner_id"];
const PUBLISH_KEYS = ["people.json", "feeds.json", "feeds.config.json", "suggestions.json", "follows.json", "data/follows.json"];
const OBJECT_PREFIXES = ["media/avatars/", "media/banners/", "uploads/", "exports/", "users/", "accounts/"];

export const DELETION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS account_deletion_jobs (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL DEFAULT '',
    user_hash TEXT NOT NULL,
    handle TEXT NOT NULL DEFAULT '',
    skeleton TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    steps TEXT NOT NULL,
    resume_hash TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_jobs_user ON account_deletion_jobs(public_id) WHERE public_id != ''",
  "CREATE INDEX IF NOT EXISTS account_deletion_jobs_status ON account_deletion_jobs(status, updated_at)",
  "CREATE TABLE IF NOT EXISTS account_deletions (user_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS handle_holds (skeleton TEXT PRIMARY KEY, held_until INTEGER NOT NULL, user_hash TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS account_reauths (token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS account_reauths_account ON account_reauths(public_id, expires_at)"
];

function bytesToB64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function b64url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
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

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
}

function rowsOf(result) {
  return (result && result.results) || [];
}

function safeName(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));
}

function blankSteps() {
  return { sessions: false, database: false, objects: false, publish: false };
}

function parseSteps(value) {
  const steps = blankSteps();
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object") return steps;
    steps.sessions = !!parsed.sessions;
    steps.database = !!parsed.database;
    steps.objects = !!parsed.objects;
    steps.publish = !!parsed.publish;
  } catch (err) { /* a broken row starts again */ }
  return steps;
}

function saltOf(env) {
  return String((env && (env.DELETION_SALT || env.ACCOUNT_PEPPER)) || "");
}

export function holdDays(env) {
  const raw = env && env.HANDLE_HOLD_DAYS;
  if (raw == null || raw === "") return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(3650, Math.floor(n));
}

export async function userHash(env, publicId) {
  const salt = saltOf(env);
  const id = String(publicId || "");
  if (!salt || !/^\d{12}$/.test(id)) return "";
  return hmacHex(salt, "account-delete:" + id);
}

export function ownerProtected(env, row) {
  if (!row) return true;
  if (Number(row.owner) === 1) return true;
  const id = String(row.public_id || row.publicId || "");
  const handle = String(row.handle || "");
  if (id === "emergency_owner") return true;
  if (handle === OWNER_HANDLE) return true;
  const checked = inspectHandle(handle);
  if (checked && checked.owner) return true;
  const skel = String(row.skeleton || "");
  if (skel && skel === ownerSkeleton()) return true;
  if (handle === OWNER_GITHUB || id === OWNER_GITHUB) return true;
  const configured = String((env && env.OWNER_PUBLIC_ID) || "").trim();
  if (configured && (id === configured || handle === configured)) return true;
  return false;
}

function originOk(request, env, deps) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return false;
  const allowed = deps && deps.allowedOrigins ? deps.allowedOrigins(env) : [];
  return allowed.indexOf(origin) >= 0;
}

function intentOk(request, expected) {
  return (request.headers.get("X-Viktorych-Intent") || "") === expected;
}

function jsonBody(deps, status, body, extra) {
  return deps.json(status, body, extra);
}

export async function handleHeld(env, skeleton) {
  const key = String(skeleton || "");
  if (!key) return false;
  const row = await env.DB.prepare("SELECT held_until FROM handle_holds WHERE skeleton = ?").bind(key).first();
  if (!row) return false;
  if (Number(row.held_until) <= Date.now()) {
    await env.DB.prepare("DELETE FROM handle_holds WHERE skeleton = ?").bind(key).run();
    return false;
  }
  return true;
}

function isPublicId(value) {
  return /^\d{12}$/.test(String(value || ""));
}

function appId(value) {
  const match = /^app:(\d{12})$/.exec(String(value || ""));
  return match ? match[1] : "";
}

function collectIds(value, into) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "string") {
        const id = appId(item);
        if (id) into.add(id);
      } else collectIds(item, into);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const direct = [value.id, value.followId, value.targetId, value.target_id];
  for (let i = 0; i < direct.length; i++) {
    const id = appId(direct[i]);
    if (id) into.add(id);
  }
  for (let i = 0; i < ID_FIELDS.length; i++) {
    const key = ID_FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const raw = value[key];
    const id = appId(raw) || (isPublicId(raw) ? String(raw) : "");
    if (id) into.add(id);
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) collectIds(value[keys[i]], into);
}

export function referencesDeleted(value, hashes, hashOf) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.userHash === "string" && hashes.has(value.userHash)) return true;
  const direct = [value.id, value.followId, value.targetId, value.target_id];
  for (let i = 0; i < direct.length; i++) {
    const id = appId(direct[i]);
    if (id && hashes.has(hashOf(id))) return true;
  }
  for (let i = 0; i < ID_FIELDS.length; i++) {
    const key = ID_FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const raw = value[key];
    const id = appId(raw) || (isPublicId(raw) ? String(raw) : "");
    if (id && hashes.has(hashOf(id))) return true;
  }
  return false;
}

export function scrubValue(value, hashes, hashOf) {
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "string") {
        const id = appId(item);
        if (id && hashes.has(hashOf(id))) continue;
        out.push(item);
        continue;
      }
      const next = scrubValue(item, hashes, hashOf);
      if (next == null) continue;
      out.push(next);
    }
    return out;
  }
  if (!value || typeof value !== "object") return value;
  if (referencesDeleted(value, hashes, hashOf)) return null;
  const out = {};
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const next = scrubValue(value[key], hashes, hashOf);
    if (next == null && value[key] && typeof value[key] === "object") continue;
    out[key] = next;
  }
  return out;
}

async function hashMap(env, ids) {
  const map = new Map();
  for (const id of ids) map.set(id, await userHash(env, id));
  return map;
}

async function deletionHashes(env) {
  const listed = await env.DB.prepare("SELECT user_hash FROM account_deletions ORDER BY user_hash").all();
  const hashes = [];
  for (const row of rowsOf(listed)) {
    const hash = String(row.user_hash || "");
    if (/^[0-9a-f]{64}$/.test(hash)) hashes.push(hash);
  }
  return hashes;
}

async function scrubDocument(env, value) {
  const ids = new Set();
  collectIds(value, ids);
  const known = new Set(await deletionHashes(env));
  const mapped = await hashMap(env, ids);
  return scrubValue(value, known, (id) => mapped.get(id) || "");
}

function columnsFromSql(sql) {
  const text = String(sql || "");
  const open = text.indexOf("(");
  if (open < 0) return [];
  const cols = [];
  let depth = 0;
  let current = "";
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "," && depth === 0) {
      cols.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) cols.push(current.trim());
  const names = [];
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(col)) continue;
    const match = /^["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/.exec(col);
    if (match) names.push(match[1]);
  }
  return names;
}

function bucketHasId(bucket, publicId) {
  const parts = String(bucket || "").split(":");
  return parts.indexOf(publicId) >= 0 || parts.indexOf("app:" + publicId) >= 0;
}

async function saveJob(env, job, steps, status, error) {
  job.steps = JSON.stringify(steps);
  job.status = status;
  job.error = error || "";
  job.updated_at = Date.now();
  await env.DB.prepare("UPDATE account_deletion_jobs SET status = ?, steps = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, job.steps, job.error, job.updated_at, job.id).run();
}

async function ensureResume(env, job) {
  const token = "dr1." + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256Hex(token);
  job.resume_hash = hash;
  await env.DB.prepare("UPDATE account_deletion_jobs SET resume_hash = ? WHERE id = ?").bind(hash, job.id).run();
  return token;
}

async function deletePrefix(bucket, prefix) {
  if (!bucket || !bucket.list) return;
  let cursor = undefined;
  do {
    const listed = await bucket.list({ prefix, cursor, limit: 200 });
    const objects = (listed && listed.objects) || [];
    for (let i = 0; i < objects.length; i++) {
      if (objects[i] && objects[i].key) await bucket.delete(objects[i].key);
    }
    cursor = listed && listed.truncated ? listed.cursor : "";
  } while (cursor);
}

async function wipeObjects(env, publicId) {
  if (!env.DATA || !/^\d{12}$/.test(publicId)) return;
  for (let i = 0; i < OBJECT_PREFIXES.length; i++) {
    await deletePrefix(env.DATA, OBJECT_PREFIXES[i] + publicId + "/");
  }
}

async function wipeDatabase(env, job) {
  const publicId = String(job.public_id || "");
  const handle = String(job.handle || "");
  if (!/^\d{12}$/.test(publicId)) return;
  const still = await env.DB.prepare("SELECT public_id, handle, skeleton, owner FROM accounts WHERE public_id = ?").bind(publicId).first();
  if (still && ownerProtected(env, still)) {
    const err = new Error("owner_protected");
    err.code = "owner_protected";
    throw err;
  }
  const statements = [];
  const push = (sql, ...args) => {
    statements.push(env.DB.prepare(sql).bind(...args));
  };
  push("DELETE FROM drive_chunks WHERE item_id IN (SELECT id FROM drive_items WHERE public_id = ?)", publicId);
  push("DELETE FROM vault_shares WHERE item_id IN (SELECT id FROM vault_items WHERE owner_id = ?)", publicId);
  push("DELETE FROM community_likes WHERE item_id IN (SELECT id FROM community_posts WHERE author_id = ?)", publicId);
  const tables = rowsOf(await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all());
  for (let i = 0; i < tables.length; i++) {
    const name = String(tables[i].name || "");
    if (!safeName(name) || SKIP_TABLES.has(name)) continue;
    const cols = columnsFromSql(tables[i].sql);
    if (name === "accounts") {
      push("DELETE FROM accounts WHERE public_id = ? AND owner != 1", publicId);
      continue;
    }
    if (name === "ap_followers" && cols.indexOf("actor_handle") >= 0 && handle) {
      push("DELETE FROM ap_followers WHERE actor_handle = ?", handle);
    }
    for (let c = 0; c < USER_COLUMNS.length; c++) {
      const col = USER_COLUMNS[c];
      if (!safeName(col) || cols.indexOf(col) < 0) continue;
      if (col === "target_id") push("DELETE FROM " + name + " WHERE target_id = ? OR target_id = ?", publicId, "app:" + publicId);
      else push("DELETE FROM " + name + " WHERE " + col + " = ?", publicId);
    }
  }
  const limits = rowsOf(await env.DB.prepare("SELECT bucket FROM rate_limits WHERE instr(bucket, ?) > 0").bind(publicId).all());
  for (let i = 0; i < limits.length; i++) {
    if (bucketHasId(limits[i].bucket, publicId)) push("DELETE FROM rate_limits WHERE bucket = ?", limits[i].bucket);
  }
  const days = holdDays(env);
  if (days > 0 && job.skeleton && job.user_hash) {
    push(
      "INSERT INTO handle_holds (skeleton, held_until, user_hash) VALUES (?, ?, ?) ON CONFLICT(skeleton) DO UPDATE SET held_until = excluded.held_until, user_hash = excluded.user_hash",
      job.skeleton,
      Date.now() + days * DAY_MS,
      job.user_hash
    );
  }
  if (job.user_hash) {
    push(
      "INSERT INTO account_deletions (user_hash, created_at) VALUES (?, ?) ON CONFLICT(user_hash) DO NOTHING",
      job.user_hash,
      Date.now()
    );
  }
  if (statements.length) await env.DB.batch(statements);
  const left = await env.DB.prepare("SELECT owner FROM accounts WHERE public_id = ?").bind(publicId).first();
  if (left && Number(left.owner) === 1) {
    const err = new Error("owner_protected");
    err.code = "owner_protected";
    throw err;
  }
}

async function writeDeletionList(env) {
  if (!env.DATA) return;
  const hashes = await deletionHashes(env);
  await env.DATA.put("deletions.json", JSON.stringify({ hashes }));
}

async function scrubKey(env, key) {
  if (!env.DATA || key === "deletions.json") return;
  const object = await env.DATA.get(key);
  if (!object) return;
  let parsed = null;
  try { parsed = JSON.parse(await object.text()); }
  catch (err) { return; }
  const next = await scrubDocument(env, parsed);
  await env.DATA.put(key, JSON.stringify(next));
}

async function publishDeletion(env) {
  await writeDeletionList(env);
  if (!env.DATA) return;
  const seen = new Set();
  for (let i = 0; i < PUBLISH_KEYS.length; i++) seen.add(PUBLISH_KEYS[i]);
  let cursor = undefined;
  do {
    const listed = await env.DATA.list({ prefix: "follows/", cursor, limit: 100 });
    const objects = (listed && listed.objects) || [];
    for (let i = 0; i < objects.length; i++) {
      if (objects[i] && /\.json$/.test(objects[i].key || "")) seen.add(objects[i].key);
    }
    cursor = listed && listed.truncated ? listed.cursor : "";
  } while (cursor);
  for (const key of seen) await scrubKey(env, key);
  await writeDeletionList(env);
}

async function runJob(env, job, opts) {
  const steps = parseSteps(job.steps);
  const publicId = String(job.public_id || "");
  // Sessions and rows are swept again on every resume. A step that already
  // finished can still have picked up a write that landed before the token died.
  if (publicId) {
    await env.DB.prepare("DELETE FROM sessions WHERE public_id = ?").bind(publicId).run();
    steps.sessions = true;
    await wipeDatabase(env, job);
    steps.database = true;
    await saveJob(env, job, steps, "running", "");
  }
  const failStep = opts && opts.failStep;
  if (failStep === "objects" && !steps.objects) {
    await saveJob(env, job, steps, "pending", "retry");
    const resumeToken = await ensureResume(env, job);
    return { status: "pending", steps, resumeToken };
  }
  if (!steps.objects) {
    if (publicId) await wipeObjects(env, publicId);
    steps.objects = true;
    await saveJob(env, job, steps, "running", "");
  }
  if (!steps.publish) {
    await publishDeletion(env);
    steps.publish = true;
    await saveJob(env, job, steps, "running", "");
  }
  const now = Date.now();
  await env.DB.prepare("UPDATE account_deletion_jobs SET public_id = '', handle = '', skeleton = '', status = 'done', steps = ?, error = '', updated_at = ? WHERE id = ?").bind(JSON.stringify(steps), now, job.id).run();
  job.public_id = "";
  job.handle = "";
  job.skeleton = "";
  job.status = "done";
  return { status: "complete", steps };
}

function publicResult(result) {
  const body = {
    ok: true,
    status: result.status,
    deletion: result.status,
    steps: result.steps
  };
  if (result.already) body.already = true;
  if (result.status === "pending" && result.resumeToken) body.resumeToken = result.resumeToken;
  return body;
}

async function loadJob(env, id) {
  return env.DB.prepare("SELECT id, public_id, user_hash, handle, skeleton, status, steps, resume_hash, error, created_at, updated_at FROM account_deletion_jobs WHERE id = ?").bind(id).first();
}

async function startJob(env, row, hash) {
  const existing = await env.DB.prepare("SELECT id FROM account_deletion_jobs WHERE public_id = ? AND status != 'done'").bind(row.public_id).first();
  if (existing) return loadJob(env, existing.id);
  const id = "del_" + hex(crypto.getRandomValues(new Uint8Array(16)));
  const now = Date.now();
  const steps = JSON.stringify(blankSteps());
  try {
    await env.DB.prepare("INSERT INTO account_deletion_jobs (id, public_id, user_hash, handle, skeleton, status, steps, resume_hash, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'running', ?, '', '', ?, ?)").bind(
      id,
      row.public_id,
      hash,
      row.handle || "",
      row.skeleton || "",
      steps,
      now,
      now
    ).run();
  } catch (err) {
    const message = String(err && err.message || err);
    if (!/UNIQUE/i.test(message)) throw err;
    const raced = await env.DB.prepare("SELECT id FROM account_deletion_jobs WHERE public_id = ? AND status != 'done'").bind(row.public_id).first();
    if (raced) return loadJob(env, raced.id);
    throw err;
  }
  return loadJob(env, id);
}

function failStepOf(request, env) {
  if (String(env && env.DELETION_TEST_HOOK || "") !== "1") return "";
  const step = request.headers.get("x-deletion-fail") || "";
  return step === "objects" ? step : "";
}

async function resumeWithToken(request, env, deps, token) {
  const hash = await sha256Hex(String(token || ""));
  const job = await env.DB.prepare("SELECT id, public_id, user_hash, handle, skeleton, status, steps, resume_hash, error, created_at, updated_at FROM account_deletion_jobs WHERE resume_hash = ?").bind(hash).first();
  if (!job) return jsonBody(deps, 404, { error: "not_found" });
  if (job.status === "done") {
    return jsonBody(deps, 200, { ok: true, status: "complete", deletion: "complete", already: true, steps: parseSteps(job.steps) });
  }
  try {
    const result = await runJob(env, job, { failStep: failStepOf(request, env) });
    return jsonBody(deps, 200, publicResult(result));
  } catch (err) {
    if (err && err.code === "owner_protected") return jsonBody(deps, 403, { error: "owner_protected" });
    return jsonBody(deps, 503, { error: "unavailable" });
  }
}

export async function handleAccountReauth(request, env, deps) {
  if (request.method !== "POST") return jsonBody(deps, 405, { error: "method" });
  if (!originOk(request, env, deps) || !intentOk(request, "account-reauth")) return jsonBody(deps, 403, { error: "origin" });
  const type = String(request.headers.get("content-type") || "");
  if (type.indexOf("application/json") !== 0) return jsonBody(deps, 415, { error: "content_type" });
  const ip = clientIp(request);
  const gate = await deps.rateHit(env, "reauth-ip:" + ip, 12, 60 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const session = await deps.sessionAccount(env, request);
  if (!session) return jsonBody(deps, 401, { error: "unauthorized" });
  if (ownerProtected(env, session)) return jsonBody(deps, 403, { error: "owner_protected" });
  const paced = await deps.rateHit(env, "reauth:" + session.public_id, 8, 60 * 60 * 1000);
  if (!paced.ok) return deps.limited(paced);
  const body = await deps.readJson(request, 2000);
  if (body.error) return jsonBody(deps, 400, { error: body.error });
  const row = await env.DB.prepare("SELECT public_id, handle, skeleton, owner, number_hash, salt FROM accounts WHERE public_id = ?").bind(session.public_id).first();
  if (!row) return jsonBody(deps, 401, { error: "unauthorized" });
  if (ownerProtected(env, row)) return jsonBody(deps, 403, { error: "owner_protected" });
  const ok = await deps.verifyAccountNumber(env, row, body.accountNumber);
  if (!ok) return jsonBody(deps, 401, { error: "invalid_credentials" });
  const token = "ra1." + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const expires = Date.now() + REAUTH_MS;
  await env.DB.prepare("INSERT INTO account_reauths (token_hash, public_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, row.public_id, expires).run();
  return jsonBody(deps, 200, { ok: true, reauthToken: token, expiresAt: expires });
}

async function consumeReauth(env, publicId, token) {
  const text = String(token || "");
  if (!text || text.length > 200) return false;
  const hash = await sha256Hex(text);
  const row = await env.DB.prepare("SELECT public_id, expires_at FROM account_reauths WHERE token_hash = ?").bind(hash).first();
  await env.DB.prepare("DELETE FROM account_reauths WHERE token_hash = ?").bind(hash).run();
  if (!row) return false;
  if (String(row.public_id) !== String(publicId)) return false;
  return Number(row.expires_at) > Date.now();
}

export async function handleAccountDelete(request, env, deps) {
  if (request.method !== "POST") return jsonBody(deps, 405, { error: "method" });
  if (!originOk(request, env, deps) || !intentOk(request, "account-delete")) return jsonBody(deps, 403, { error: "origin" });
  const type = String(request.headers.get("content-type") || "");
  if (type.indexOf("application/json") !== 0) return jsonBody(deps, 415, { error: "content_type" });
  if (!saltOf(env)) return jsonBody(deps, 503, { error: "not_configured" });
  const ip = clientIp(request);
  const ipGate = await deps.rateHit(env, "acct-del-ip:" + ip, 20, 60 * 60 * 1000);
  if (!ipGate.ok) return deps.limited(ipGate);
  const body = await deps.readJson(request, 4000);
  if (body.error) return jsonBody(deps, 400, { error: body.error });
  if (body.resumeToken && !body.handle && !body.accountNumber) {
    return resumeWithToken(request, env, deps, body.resumeToken);
  }
  const session = await deps.sessionAccount(env, request);
  if (!session) return jsonBody(deps, 401, { error: "unauthorized" });
  if (ownerProtected(env, session)) return jsonBody(deps, 403, { error: "owner_protected" });
  const paced = await deps.rateHit(env, "acct-del:" + session.public_id, 8, 60 * 60 * 1000);
  if (!paced.ok) return deps.limited(paced);
  const row = await env.DB.prepare("SELECT public_id, handle, skeleton, owner, number_hash, salt FROM accounts WHERE public_id = ?").bind(session.public_id).first();
  if (!row) return jsonBody(deps, 401, { error: "unauthorized" });
  if (ownerProtected(env, row)) return jsonBody(deps, 403, { error: "owner_protected" });
  const typed = String(body.handle || "").trim().replace(/^@/, "");
  if (!typed || typed !== row.handle) return jsonBody(deps, 400, { error: "handle_mismatch" });
  let proven = false;
  if (body.accountNumber) proven = await deps.verifyAccountNumber(env, row, body.accountNumber);
  else if (body.reauthToken) proven = await consumeReauth(env, row.public_id, body.reauthToken);
  if (!proven) return jsonBody(deps, 401, { error: "invalid_credentials" });
  const hash = await userHash(env, row.public_id);
  if (!hash) return jsonBody(deps, 503, { error: "not_configured" });
  const job = await startJob(env, row, hash);
  if (!job) return jsonBody(deps, 503, { error: "unavailable" });
  try {
    const result = await runJob(env, job, { failStep: failStepOf(request, env) });
    return jsonBody(deps, 200, publicResult(result));
  } catch (err) {
    if (err && err.code === "owner_protected") return jsonBody(deps, 403, { error: "owner_protected" });
    await saveJob(env, job, parseSteps(job.steps), "pending", "retry");
    const resumeToken = await ensureResume(env, job);
    return jsonBody(deps, 200, publicResult({ status: "pending", steps: parseSteps(job.steps), resumeToken }));
  }
}

export async function handleDeletionList(request, env, deps) {
  if (request.method !== "GET") return jsonBody(deps, 405, { error: "method" });
  const gate = await deps.rateHit(env, "acct-del-list:" + clientIp(request), 120, 10 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const hashes = await deletionHashes(env);
  return jsonBody(deps, 200, { hashes });
}

export async function blockDeletedLogin(env, publicId) {
  const existing = await env.DB.prepare("SELECT id FROM account_deletion_jobs WHERE public_id = ? AND status != 'done'").bind(publicId).first();
  if (!existing) return false;
  const job = await loadJob(env, existing.id);
  if (!job) return false;
  try { await runJob(env, job, {}); }
  catch (err) { /* the cron finishes a leftover */ }
  return true;
}

export async function resumeAccountDeletions(env) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM handle_holds WHERE held_until <= ?").bind(now).run();
  await env.DB.prepare("DELETE FROM account_reauths WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("DELETE FROM account_deletion_jobs WHERE status = 'done' AND updated_at <= ?").bind(now - JOB_KEEP_MS).run();
  const listed = await env.DB.prepare("SELECT id FROM account_deletion_jobs WHERE status != 'done' ORDER BY updated_at ASC LIMIT 20").all();
  for (const row of rowsOf(listed)) {
    const job = await loadJob(env, row.id);
    if (!job) continue;
    try { await runJob(env, job, {}); }
    catch (err) {
      await saveJob(env, job, parseSteps(job.steps), "pending", "retry");
    }
  }
}
