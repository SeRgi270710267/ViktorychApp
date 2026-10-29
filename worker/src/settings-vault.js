/* Synced settings at rest. The sensitive keys of an account's sync payload
   are sealed with AES-GCM before they reach D1, and a daily encrypted copy of
   every account's settings goes to the private R2 bucket (14 days kept).
   The key is derived from SETTINGS_KEY, or ACCOUNT_PEPPER when that is unset.
   Without either secret nothing is sealed and no backup is written. */

export const SEALED_KEYS = [
  "mutedWords", "mutedAccounts", "repostOff", "bells", "translateNever", "history",
  "privacyEmbedShield", "privacyWebRTC", "privacyNoReferrer", "privacyStripTrackers", "privacyAntiFingerprint"
];
export const VAULT_PREFIX = "backups/settings/";
export const VAULT_KEEP_DAYS = 14;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keys = new Map();

function secretOf(env) {
  return String((env && (env.SETTINGS_KEY || env.ACCOUNT_PEPPER)) || "");
}

async function aesKey(env, purpose) {
  const secret = secretOf(env);
  if (!secret) return null;
  const id = purpose + ":" + secret.length + ":" + secret.slice(0, 2);
  if (keys.has(id) && keys.get(id).secret === secret) return keys.get(id).key;
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("viktorych-settings-v1"), info: encoder.encode(purpose) },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  keys.set(id, { secret, key });
  return key;
}

function toB64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromB64(text) {
  const raw = atob(String(text || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function encryptBytes(env, purpose, bytes) {
  const key = await aesKey(env, purpose);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + cipher.length);
  out.set(iv, 0);
  out.set(cipher, 12);
  return out;
}

export async function decryptBytes(env, purpose, bytes) {
  const key = await aesKey(env, purpose);
  if (!key || !bytes || bytes.length < 13) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return new Uint8Array(plain);
}

/* Moves the sensitive keys into one sealed string. The input is not changed. */
export async function sealPayload(env, payload) {
  if (!payload || typeof payload !== "object") return payload;
  const secret = {};
  let any = false;
  SEALED_KEYS.forEach((key) => {
    if (payload[key] !== undefined) {
      secret[key] = payload[key];
      any = true;
    }
  });
  if (!any || !secretOf(env)) return payload;
  const sealed = await encryptBytes(env, "sync", encoder.encode(JSON.stringify(secret)));
  if (!sealed) return payload;
  const out = {};
  Object.keys(payload).forEach((key) => { if (secret[key] === undefined && key !== "sealed") out[key] = payload[key]; });
  out.sealed = "v1:" + toB64(sealed);
  return out;
}

/* Opens a stored payload. A copy that cannot be opened loses only its
   sealed part; the rest of the settings still load. */
export async function openPayload(env, payload) {
  if (!payload || typeof payload !== "object" || typeof payload.sealed !== "string") return payload;
  const text = payload.sealed;
  delete payload.sealed;
  if (text.indexOf("v1:") !== 0) return payload;
  try {
    const plain = await decryptBytes(env, "sync", fromB64(text.slice(3)));
    if (!plain) return payload;
    const secret = JSON.parse(decoder.decode(plain));
    if (secret && typeof secret === "object") {
      SEALED_KEYS.forEach((key) => { if (secret[key] !== undefined) payload[key] = secret[key]; });
    }
  } catch (err) { /* a rotated key drops only the sealed keys */ }
  return payload;
}

export function vaultSlot(at) {
  const when = new Date(Number(at) || 0);
  if (Number.isNaN(when.getTime())) return false;
  return when.getUTCMinutes() === 47 && when.getUTCHours() >= 4;
}

export function vaultKey(at) {
  return VAULT_PREFIX + new Date(Number(at) || Date.now()).toISOString().slice(0, 10) + ".json.gz.enc";
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function prune(env, at) {
  const cutoff = new Date(Number(at) - (VAULT_KEEP_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const listed = await env.DATA.list({ prefix: VAULT_PREFIX });
  const old = ((listed && listed.objects) || []).map((obj) => obj.key).filter((key) => {
    const day = key.slice(VAULT_PREFIX.length, VAULT_PREFIX.length + 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff;
  });
  for (let i = 0; i < old.length; i++) await env.DATA.delete(old[i]);
  return old;
}

/* Once a day: every account's stored settings, gzip, then AES-GCM. */
export async function maybeBackupSettings(env, at, force) {
  if (!env || !env.DB || !env.DATA || !secretOf(env)) return false;
  if (!force && !vaultSlot(at)) return false;
  const key = vaultKey(at);
  if (await env.DATA.head(key)) {
    await prune(env, at);
    return false;
  }
  const rows = [];
  for (let offset = 0; offset < 200000; offset += 200) {
    const page = await env.DB.prepare("SELECT public_id, payload, updated_at FROM sync_state ORDER BY public_id LIMIT 200 OFFSET ?").bind(offset).all();
    const list = (page && page.results) || [];
    list.forEach((row) => rows.push({ id: row.public_id, at: Number(row.updated_at) || 0, payload: row.payload }));
    if (list.length < 200) break;
  }
  const body = await gzip(encoder.encode(JSON.stringify({ version: 1, at: Number(at) || Date.now(), rows })));
  const sealed = await encryptBytes(env, "backup", body);
  if (!sealed) return false;
  await env.DATA.put(key, sealed, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { rows: String(rows.length), cipher: "aes-256-gcm", kdf: "hkdf-sha256" } });
  await prune(env, at);
  return true;
}

export async function readSettingsBackup(env, key) {
  const obj = await env.DATA.get(key);
  if (!obj) return null;
  const plain = await decryptBytes(env, "backup", new Uint8Array(await obj.arrayBuffer()));
  if (!plain) return null;
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
