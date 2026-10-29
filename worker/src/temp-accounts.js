/* Temporary accounts. Anyone can open one with a single tap: no handle,
   email, phone or password. The browser keeps the session token and the
   account number, so the account lives on that device until it is saved.
   Each one carries a delete time (1 hour, 1 day, 7 days, 30 days or a
   custom date). The minute cron deletes due accounts through the same job
   that self-service and inactivity deletion use, so posts, DMs, gifts,
   media in R2, sessions and settings all go. Only rows in account_temp are
   ever swept, and the owner account is refused at every step. */

import { deleteAccountById, ownerProtected } from "./account-delete.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const TEMP_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS account_temp (public_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS account_temp_due ON account_temp(expires_at)",
  "CREATE TABLE IF NOT EXISTS temp_config (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
];

export const TEMP_CHOICES = { "1h": HOUR_MS, "1d": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS };
export const TEMP_MIN_MS = 10 * 60 * 1000;
export const TEMP_MAX_MS = 90 * DAY_MS;
export const TEMP_SWEEP_BATCH = 10;
// New conversations a temporary account may start with people who do not
// follow it and never wrote to it, per day. Messages to strangers per day.
export const TEMP_STRANGER_THREADS = 3;
export const TEMP_STRANGER_MESSAGES = 20;

export function tempSignupsPerDay(env) {
  const n = Number(env && env.TEMP_SIGNUPS_PER_DAY);
  return Number.isFinite(n) && n >= 1 ? Math.min(50, Math.floor(n)) : 3;
}

/* The delete time from a request body: a named choice, or a custom date
   between ten minutes and ninety days from now. 0 means not allowed. */
export function tempExpiry(body, now) {
  const at = Number(now) || Date.now();
  const pick = String((body && (body.expiresIn || body.keepFor)) || "");
  if (pick && Object.prototype.hasOwnProperty.call(TEMP_CHOICES, pick)) return at + TEMP_CHOICES[pick];
  if (pick) return 0;
  const raw = body && body.expiresAt;
  if (raw == null || raw === "") return 0;
  const when = typeof raw === "number" ? raw : Date.parse(String(raw));
  if (!Number.isFinite(when)) return 0;
  if (when < at + TEMP_MIN_MS || when > at + TEMP_MAX_MS) return 0;
  return Math.floor(when);
}

export function cleanDeviceKey(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9_-]{16,128}$/.test(text) ? text : "";
}

export async function tempRow(env, publicId) {
  if (!publicId) return null;
  try {
    return await env.DB.prepare("SELECT public_id, expires_at, created_at FROM account_temp WHERE public_id = ?").bind(String(publicId)).first();
  } catch (err) {
    return null;
  }
}

export async function isTemporary(env, publicId) {
  return !!(await tempRow(env, publicId));
}

let labelCache = { at: 0, on: true };

export async function tempLabelOn(env, now) {
  const at = Number(now) || Date.now();
  if (at - labelCache.at < 60 * 1000) return labelCache.on;
  let on = true;
  try {
    const row = await env.DB.prepare("SELECT v FROM temp_config WHERE k = 'label'").first();
    if (row && String(row.v) === "off") on = false;
  } catch (err) { /* default on */ }
  labelCache = { at, on };
  return on;
}

export function resetTempCache() {
  labelCache = { at: 0, on: true };
}

/* Own account: the delete time. Everyone else: a small "Temporary" mark,
   only while the owner keeps the label switched on (the default). */
export async function decorateTemporary(env, publicId, account, own) {
  const row = await tempRow(env, publicId);
  if (!row) return account;
  if (own) account.temporary = { expiresAt: Number(row.expires_at) || 0 };
  else if (await tempLabelOn(env)) account.temporary = true;
  return account;
}

export async function markTemporary(env, publicId, expiresAt, now) {
  await env.DB.prepare("INSERT INTO account_temp (public_id, expires_at, created_at) VALUES (?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET expires_at = excluded.expires_at").bind(String(publicId), Number(expiresAt), Number(now) || Date.now()).run();
}

/* The cron. Accounts whose time passed are deleted in small batches every
   minute. A job that stops halfway is finished by resumeAccountDeletions. */
export async function sweepTemporary(env, now) {
  const at = Number(now) || Date.now();
  let listed;
  try {
    listed = await env.DB.prepare(
      `SELECT t.public_id, t.expires_at, a.public_id AS account_id, a.handle, a.skeleton, a.owner
         FROM account_temp t LEFT JOIN accounts a ON a.public_id = t.public_id
        WHERE t.expires_at <= ?
        ORDER BY t.expires_at ASC LIMIT ?`
    ).bind(at, TEMP_SWEEP_BATCH).all();
  } catch (err) {
    return { deleted: 0, skipped: 0 };
  }
  let deleted = 0;
  let skipped = 0;
  for (const row of (listed && listed.results) || []) {
    const id = String(row.public_id || "");
    if (!row.account_id) {
      await env.DB.prepare("DELETE FROM account_temp WHERE public_id = ?").bind(id).run();
      continue;
    }
    if (Number(row.owner) === 1 || await ownerProtected(env, { public_id: id, handle: row.handle, skeleton: row.skeleton, owner: row.owner })) {
      // The owner can never be temporary. Drop the mark instead of the account.
      await env.DB.prepare("DELETE FROM account_temp WHERE public_id = ?").bind(id).run();
      skipped += 1;
      continue;
    }
    const out = await deleteAccountById(env, id);
    if (out && (out.status === "complete" || out.status === "pending")) deleted += 1;
  }
  return { deleted, skipped };
}

function jsonOf(deps, status, body) {
  return deps.json(status, body);
}

function originOk(request, deps, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return false;
  const allowed = deps.allowedOrigins ? deps.allowedOrigins(env) : [];
  return allowed.indexOf(origin) >= 0;
}

/* /v1/account/temporary            GET status, PUT new delete time
   /v1/account/temporary/keep       POST make the account permanent
   /v1/account/temporary/delete     POST delete it now
   /v1/owner/temporary              GET or PUT { label } (owner only) */
export async function handleTemporary(request, env, path, deps) {
  if (path === "/v1/owner/temporary") {
    const viewer = await deps.sessionAccount(env, request);
    if (!viewer) return jsonOf(deps, 401, { error: "unauthorized" });
    if (Number(viewer.owner) !== 1) return jsonOf(deps, 403, { error: "forbidden" });
    if (request.method === "PUT") {
      const body = await deps.readJson(request, 500);
      if (body.error) return jsonOf(deps, 400, { error: body.error });
      if (typeof body.label !== "boolean") return jsonOf(deps, 400, { error: "label" });
      await env.DB.prepare("INSERT INTO temp_config (k, v) VALUES ('label', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(body.label ? "on" : "off").run();
      resetTempCache();
    } else if (request.method !== "GET") return jsonOf(deps, 405, { error: "method" });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_temp").first().catch(() => null);
    return jsonOf(deps, 200, { label: await tempLabelOn(env), accounts: Number(count && count.n) || 0, perDay: tempSignupsPerDay(env) });
  }
  const session = await deps.sessionAccount(env, request);
  if (!session) return jsonOf(deps, 401, { error: "unauthorized" });
  const row = await tempRow(env, session.public_id);
  const choices = Object.keys(TEMP_CHOICES);
  if (path === "/v1/account/temporary") {
    if (request.method === "PUT") {
      if (!row) return jsonOf(deps, 409, { error: "not_temporary" });
      const paced = await deps.rateHit(env, "tmp-set:" + session.public_id, 30, HOUR_MS);
      if (!paced.ok) return deps.limited(paced);
      const body = await deps.readJson(request, 1000);
      if (body.error) return jsonOf(deps, 400, { error: body.error });
      const until = tempExpiry(body, Date.now());
      if (!until) return jsonOf(deps, 400, { error: "bad_expiry" });
      await env.DB.prepare("UPDATE account_temp SET expires_at = ? WHERE public_id = ?").bind(until, session.public_id).run();
      return jsonOf(deps, 200, { temporary: true, expiresAt: until, choices, maxCustomDays: TEMP_MAX_MS / DAY_MS });
    }
    if (request.method !== "GET") return jsonOf(deps, 405, { error: "method" });
    return jsonOf(deps, 200, { temporary: !!row, expiresAt: row ? Number(row.expires_at) : 0, choices, maxCustomDays: TEMP_MAX_MS / DAY_MS });
  }
  if (request.method !== "POST") return jsonOf(deps, 405, { error: "method" });
  if (!originOk(request, deps, env)) return jsonOf(deps, 403, { error: "origin" });
  if (path === "/v1/account/temporary/keep") {
    if ((request.headers.get("X-Viktorych-Intent") || "") !== "account-keep") return jsonOf(deps, 403, { error: "origin" });
    if (!row) return jsonOf(deps, 200, { ok: true, temporary: false, already: true });
    await env.DB.prepare("DELETE FROM account_temp WHERE public_id = ?").bind(session.public_id).run();
    const codes = deps.issueRecoveryCodes ? await deps.issueRecoveryCodes(env, session.public_id) : [];
    return jsonOf(deps, 200, { ok: true, temporary: false, recoveryCodes: codes || [] });
  }
  if (path === "/v1/account/temporary/delete") {
    if ((request.headers.get("X-Viktorych-Intent") || "") !== "account-delete") return jsonOf(deps, 403, { error: "origin" });
    if (!row) return jsonOf(deps, 409, { error: "not_temporary" });
    if (await ownerProtected(env, session)) return jsonOf(deps, 403, { error: "owner_protected" });
    const out = await deleteAccountById(env, session.public_id);
    if (!out || out.status === "owner_protected") return jsonOf(deps, 403, { error: "owner_protected" });
    return jsonOf(deps, 200, { ok: true, deletion: out.status === "complete" ? "complete" : "pending", steps: out.steps || {} });
  }
  return null;
}

/* Gifts and Viktorych spending are off for temporary accounts. */
export function tempBlockedPointsRoute(method, path) {
  if (method === "GET") return false;
  return path === "/v1/gifts/send" || path === "/v1/points/invites" || path === "/v1/points/invites/redeem";
}

/* Outgoing DMs to strangers. A stranger neither follows this account nor
   ever wrote to it. Returns null when allowed, or an error body. */
export async function tempDmGate(env, viewer, otherId, rateHit) {
  if (!viewer || !(await isTemporary(env, viewer.public_id))) return null;
  const me = String(viewer.public_id);
  const follows = await env.DB.prepare("SELECT 1 AS ok FROM account_follows WHERE follower_id = ? AND (target_id = ? OR target_id = ?) LIMIT 1").bind(otherId, "app:" + me, me).first().catch(() => null);
  if (follows) return null;
  const wrote = await env.DB.prepare("SELECT 1 AS ok FROM account_messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1").bind(otherId, me).first().catch(() => null);
  if (wrote) return null;
  const started = await env.DB.prepare("SELECT 1 AS ok FROM account_messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1").bind(me, otherId).first().catch(() => null);
  if (!started) {
    const fresh = await rateHit(env, "tmp-dm-new:" + me, TEMP_STRANGER_THREADS, DAY_MS);
    if (!fresh.ok) return { status: 429, error: "temporary_dm_limit", retry: fresh.retry };
  }
  const sent = await rateHit(env, "tmp-dm:" + me, TEMP_STRANGER_MESSAGES, DAY_MS);
  if (!sent.ok) return { status: 429, error: "temporary_dm_limit", retry: sent.retry };
  return null;
}
