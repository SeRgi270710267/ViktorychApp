/* Owner-only connected keys. Plaintext exists only in memory while a
   request is handled. Responses list a mask and a status, never the value.
   Jobs read one slot with the existing dispatch token. */

import {
  SLOTS,
  slotById,
  maskSecret,
  sanitizeError,
  attentionReason,
  expiryState,
  parseMaterial,
  encryptMaterial,
  decryptMaterial
} from "../../shared/owner-keys.js";

export const KEYS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS owner_keys (
    owner_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    kind TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    mask TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    last_used INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    tested_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_id, slot)
  )`
];

const PROBES = {
  tiktok: "https://www.tiktok.com/",
  youtube: "https://www.youtube.com/",
  instagram: "https://www.instagram.com/",
  threads: "https://www.threads.net/",
  vk: "https://vk.com/",
  x: "https://x.com/",
  reddit: "https://www.reddit.com/api/v1/access_token",
  discord: "https://discord.com/api/v10/users/@me"
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1].trim() : "";
}

function jobOk(env, request, timingEqual) {
  const expected = String(env.GITHUB_DISPATCH_TOKEN || "").trim();
  const got = bearer(request);
  if (!expected || !got) return false;
  return timingEqual(expected, got);
}

function displayStatus(row, now) {
  if (!row) return "empty";
  if (expiryState(row.expires_at, now) === "expired") return "expired";
  const status = String(row.status || "unknown");
  if (status === "working" || status === "expired" || status === "needs_attention" || status === "unknown") return status;
  return "unknown";
}

function publicSlot(spec, row, now) {
  const status = row ? displayStatus(row, now) : "empty";
  return {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    configured: !!row,
    mask: row ? maskSecret("saved") : "",
    status: status,
    lastUsed: row ? Number(row.last_used) || 0 : 0,
    lastError: row ? sanitizeError(row.last_error) : "",
    expiresAt: row ? Number(row.expires_at) || 0 : 0,
    updatedAt: row ? Number(row.updated_at) || 0 : 0
  };
}

async function ownerRow(env, request, deps) {
  const row = await deps.sessionAccount(env, request);
  if (!row) return { error: deps.json(401, { error: "unauthorized" }) };
  if (row.owner !== 1) return { error: deps.json(403, { error: "forbidden" }) };
  return { row };
}

async function loadRows(env, ownerId) {
  const result = await env.DB.prepare(
    "SELECT slot, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at FROM owner_keys WHERE owner_id = ?"
  ).bind(ownerId).all();
  const map = {};
  const rows = result && result.results ? result.results : [];
  rows.forEach((row) => { map[row.slot] = row; });
  return map;
}

async function ownerIdOf(env) {
  const row = await env.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
  return row && row.public_id ? String(row.public_id) : "";
}

function alertsFor(slots) {
  return slots.filter((slot) => slot.configured && (slot.status === "expired" || slot.status === "needs_attention")).map((slot) => ({
    slot: slot.id,
    label: slot.label,
    status: slot.status,
    updatedAt: slot.updatedAt
  }));
}

async function refreshExpired(env, ownerId, row, now) {
  if (!row || displayStatus(row, now) !== "expired" || row.status === "expired") return row;
  await env.DB.prepare(
    "UPDATE owner_keys SET status = 'expired', last_error = 'expired', updated_at = ? WHERE owner_id = ? AND slot = ?"
  ).bind(now, ownerId, row.slot).run();
  row.status = "expired";
  row.last_error = "expired";
  row.updated_at = now;
  return row;
}

function pairOf(material) {
  try {
    const data = JSON.parse(String(material || ""));
    const id = String((data && data.clientId) || "").trim();
    const secret = String((data && data.clientSecret) || "").trim();
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret };
  } catch (err) {
    return null;
  }
}

async function probe(spec, material) {
  let response = null;
  try {
    if (spec.kind === "cookie") {
      response = await fetch(PROBES[spec.id], {
        method: "GET",
        redirect: "manual",
        headers: { cookie: material, "user-agent": UA, accept: "text/html" }
      });
    } else if (spec.id === "reddit") {
      const pair = pairOf(material);
      if (!pair) return { status: "needs_attention", error: "bad_paste" };
      const basic = btoa(pair.clientId + ":" + pair.clientSecret);
      response = await fetch(PROBES.reddit, {
        method: "POST",
        redirect: "manual",
        headers: {
          authorization: "Basic " + basic,
          "user-agent": "ViktorychApp/1.0",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      });
    } else if (spec.id === "discord") {
      const token = String(material || "");
      const header = token.indexOf("Bot ") === 0 || token.indexOf("Bearer ") === 0 ? token : token;
      response = await fetch(PROBES.discord, {
        method: "GET",
        redirect: "manual",
        headers: { authorization: header, "user-agent": UA, accept: "application/json" }
      });
    } else if (spec.id === "telegram") {
      const token = String(material || "");
      if (/[\s/?#]/.test(token)) return { status: "needs_attention", error: "bad_paste" };
      response = await fetch("https://api.telegram.org/bot" + token + "/getMe", {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/json" }
      });
    } else {
      return { status: "unknown", error: "" };
    }
  } catch (err) {
    return { status: "unknown", error: "unreachable" };
  }
  let text = "";
  try { text = (await response.text()).slice(0, 20000); }
  catch (err) { text = ""; }
  const location = String(response.headers.get("location") || "");
  let reason = attentionReason(response.status, text + "\n" + location);
  if (!reason && response.status >= 300 && response.status < 400 && /captcha|challenge|checkpoint/i.test(location)) reason = "challenge";
  if (reason) return { status: "needs_attention", error: reason };
  if (spec.id === "reddit") {
    if (response.status !== 200 || text.indexOf("access_token") < 0) return { status: "needs_attention", error: "unauthorized" };
    return { status: "working", error: "" };
  }
  if (spec.id === "telegram") {
    if (response.status !== 200 || text.indexOf("\"ok\":true") < 0 && text.indexOf("\"ok\": true") < 0) {
      return { status: "needs_attention", error: response.status === 401 ? "unauthorized" : "forbidden" };
    }
    return { status: "working", error: "" };
  }
  if (response.status >= 200 && response.status < 400) return { status: "working", error: "" };
  return { status: "unknown", error: "unreachable" };
}

async function writeStatus(env, ownerId, slot, status, error, now, touch) {
  const used = touch ? now : null;
  if (used) {
    await env.DB.prepare(
      "UPDATE owner_keys SET status = ?, last_error = ?, tested_at = ?, updated_at = ?, last_used = ? WHERE owner_id = ? AND slot = ?"
    ).bind(status, sanitizeError(error), now, now, used, ownerId, slot).run();
  } else {
    await env.DB.prepare(
      "UPDATE owner_keys SET status = ?, last_error = ?, updated_at = ? WHERE owner_id = ? AND slot = ?"
    ).bind(status, sanitizeError(error), now, ownerId, slot).run();
  }
}

export async function readUsableKey(env, slotId) {
  const spec = slotById(slotId);
  if (!spec || !env.DB || !String(env.KEYS_ENC_KEY || "").trim()) return null;
  const ownerId = await ownerIdOf(env);
  if (!ownerId) return null;
  const row = await env.DB.prepare(
    "SELECT slot, ciphertext, iv, status, expires_at FROM owner_keys WHERE owner_id = ? AND slot = ?"
  ).bind(ownerId, spec.id).first();
  if (!row) return null;
  const now = Date.now();
  if (displayStatus(row, now) === "expired" || row.status === "needs_attention") return null;
  const value = await decryptMaterial(env.KEYS_ENC_KEY, spec.id, row.iv, row.ciphertext);
  if (!value) {
    await writeStatus(env, ownerId, spec.id, "needs_attention", "unreadable", now, false);
    return null;
  }
  await env.DB.prepare("UPDATE owner_keys SET last_used = ? WHERE owner_id = ? AND slot = ?").bind(now, ownerId, spec.id).run();
  return { slot: spec.id, kind: spec.kind, value: value };
}

export async function markKeyAttention(env, slotId, reason) {
  const spec = slotById(slotId);
  const code = sanitizeError(reason) || "forbidden";
  if (!spec || !env.DB) return false;
  const ownerId = await ownerIdOf(env);
  if (!ownerId) return false;
  const now = Date.now();
  const result = await env.DB.prepare(
    "UPDATE owner_keys SET status = 'needs_attention', last_error = ?, updated_at = ? WHERE owner_id = ? AND slot = ?"
  ).bind(code, now, ownerId, spec.id).run();
  return !!(result && result.meta && result.meta.changes);
}

async function listKeys(env, ownerId) {
  const now = Date.now();
  const map = await loadRows(env, ownerId);
  const slots = [];
  for (let i = 0; i < SLOTS.length; i++) {
    const spec = SLOTS[i];
    let row = map[spec.id] || null;
    if (row) row = await refreshExpired(env, ownerId, row, now);
    slots.push(publicSlot(spec, row, now));
  }
  return { slots: slots, alerts: alertsFor(slots) };
}

function materialBody(spec, value) {
  if (spec.kind === "pair") {
    const pair = pairOf(value);
    if (!pair) return null;
    return { slot: spec.id, kind: spec.kind, clientId: pair.clientId, clientSecret: pair.clientSecret };
  }
  return { slot: spec.id, kind: spec.kind, value: value };
}

export async function handleOwnerKeys(request, env, path, deps) {
  const { json, readJson, rateHit, limited, timingEqual } = deps;
  const parts = path.split("/").filter(Boolean);
  // v1 / owner / keys / :slot / action
  if (parts[0] !== "v1" || parts[1] !== "owner" || parts[2] !== "keys") return json(404, { error: "not_found" });
  const slotId = parts[3] ? decodeURIComponent(parts[3]) : "";
  const action = parts[4] || "";
  const spec = slotId ? slotById(slotId) : null;

  if (action === "material" || action === "attention") {
    if (!spec || parts.length !== 5) return json(404, { error: "not_found" });
    if (!jobOk(env, request, timingEqual)) return json(401, { error: "unauthorized" });
    if (!env.DB) return json(503, { error: "not_configured" });
    const hit = await rateHit(env, "owner-keys-job:" + spec.id, 120, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    if (action === "attention") {
      if (request.method !== "POST") return json(405, { error: "method" });
      const body = await readJson(request, 2000);
      if (body && body.error === "bad_json") return json(400, { error: "bad_json" });
      const code = sanitizeError(body && body.error) || "forbidden";
      await markKeyAttention(env, spec.id, code);
      return json(200, { ok: true, status: "needs_attention" });
    }
    if (request.method !== "GET") return json(405, { error: "method" });
    if (!String(env.KEYS_ENC_KEY || "").trim()) return json(503, { error: "not_configured" });
    const ownerId = await ownerIdOf(env);
    if (!ownerId) return json(404, { error: "not_found" });
    const row = await env.DB.prepare(
      "SELECT ciphertext, iv, status, expires_at FROM owner_keys WHERE owner_id = ? AND slot = ?"
    ).bind(ownerId, spec.id).first();
    if (!row) return json(404, { error: "not_found" });
    const now = Date.now();
    const shown = displayStatus(row, now);
    if (shown === "expired") return json(410, { error: "expired" });
    if (row.status === "needs_attention" || shown === "needs_attention") return json(409, { error: "needs_attention" });
    const value = await decryptMaterial(env.KEYS_ENC_KEY, spec.id, row.iv, row.ciphertext);
    if (!value) {
      await writeStatus(env, ownerId, spec.id, "needs_attention", "unreadable", now, false);
      return json(409, { error: "needs_attention" });
    }
    await env.DB.prepare("UPDATE owner_keys SET last_used = ? WHERE owner_id = ? AND slot = ?").bind(now, ownerId, spec.id).run();
    const packed = materialBody(spec, value);
    if (!packed) return json(409, { error: "needs_attention" });
    return json(200, packed);
  }

  const gate = await ownerRow(env, request, deps);
  if (gate.error) return gate.error;
  if (!env.DB) return json(503, { error: "not_configured" });

  if (!slotId && request.method === "GET") {
    const hit = await rateHit(env, "owner-keys-list:" + gate.row.public_id, 60, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const ready = !!String(env.KEYS_ENC_KEY || "").trim();
    const listed = await listKeys(env, gate.row.public_id);
    listed.ready = ready;
    return json(200, listed);
  }
  if (!spec || parts.length > 5) return json(404, { error: "not_found" });

  if (request.method === "DELETE" && !action) {
    const hit = await rateHit(env, "owner-keys-delete:" + gate.row.public_id, 30, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    await env.DB.prepare("DELETE FROM owner_keys WHERE owner_id = ? AND slot = ?").bind(gate.row.public_id, spec.id).run();
    return json(200, { ok: true, slot: publicSlot(spec, null, Date.now()) });
  }

  if (request.method === "PUT" && !action) {
    const hit = await rateHit(env, "owner-keys-put:" + gate.row.public_id, 30, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    if (!String(env.KEYS_ENC_KEY || "").trim()) return json(503, { error: "not_configured" });
    const body = await readJson(request, 120000);
    if (!body || body.error) return json(400, { error: body && body.error === "too_large" ? "too_large" : "bad_json" });
    const parsed = parseMaterial(spec.kind, body.value, Date.now());
    if (!parsed.ok) return json(400, { error: "bad_paste" });
    const sealed = await encryptMaterial(env.KEYS_ENC_KEY, spec.id, parsed.material);
    if (!sealed) return json(503, { error: "not_configured" });
    const now = Date.now();
    const status = parsed.expired ? "expired" : "unknown";
    const error = parsed.expired ? "expired" : "";
    await env.DB.prepare(
      `INSERT INTO owner_keys (owner_id, slot, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)
       ON CONFLICT(owner_id, slot) DO UPDATE SET
         kind = excluded.kind,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         mask = excluded.mask,
         status = excluded.status,
         last_error = excluded.last_error,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at,
         tested_at = 0`
    ).bind(gate.row.public_id, spec.id, spec.kind, sealed.ciphertext, sealed.iv, maskSecret("saved"), status, error, parsed.expiresAt || 0, now).run();
    const row = {
      status: status,
      last_error: error,
      expires_at: parsed.expiresAt || 0,
      updated_at: now,
      last_used: 0
    };
    return json(200, { ok: true, slot: publicSlot(spec, row, now) });
  }

  if (request.method === "POST" && action === "test") {
    const hit = await rateHit(env, "owner-keys-test:" + gate.row.public_id, 20, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    if (!String(env.KEYS_ENC_KEY || "").trim()) return json(503, { error: "not_configured" });
    const row = await env.DB.prepare(
      "SELECT ciphertext, iv, status, expires_at, last_used, updated_at FROM owner_keys WHERE owner_id = ? AND slot = ?"
    ).bind(gate.row.public_id, spec.id).first();
    if (!row) return json(404, { error: "not_found" });
    const now = Date.now();
    if (displayStatus(row, now) === "expired") {
      await writeStatus(env, gate.row.public_id, spec.id, "expired", "expired", now, false);
      return json(200, { ok: true, slot: publicSlot(spec, Object.assign({}, row, { status: "expired", last_error: "expired", updated_at: now }), now) });
    }
    const value = await decryptMaterial(env.KEYS_ENC_KEY, spec.id, row.iv, row.ciphertext);
    if (!value) {
      await writeStatus(env, gate.row.public_id, spec.id, "needs_attention", "unreadable", now, false);
      return json(200, { ok: true, slot: publicSlot(spec, Object.assign({}, row, { status: "needs_attention", last_error: "unreadable", updated_at: now }), now) });
    }
    const result = await probe(spec, value);
    await writeStatus(env, gate.row.public_id, spec.id, result.status, result.error, now, true);
    return json(200, {
      ok: true,
      slot: publicSlot(spec, {
        status: result.status,
        last_error: result.error,
        expires_at: row.expires_at,
        updated_at: now,
        last_used: now
      }, now)
    });
  }

  return json(405, { error: "method" });
}
