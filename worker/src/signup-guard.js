/* Free sign-up check. A short proof of work, a honeypot, and a minimum
   wait. No secret, no fingerprint, and no third-party call. Turnstile stays
   a separate check and only runs when its secret is set. */

const encoder = new TextEncoder();
const POW_BITS = 12;
const MIN_MS = 800;
const MAX_MS = 10 * 60 * 1000;

export const GUARD_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS signup_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)"
];

function b64url(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function guardEnabled(env) {
  return String((env && env.SIGNUP_GUARD) || "") === "on";
}

function leadingZeroBits(bytes) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte >> bit) & 1) return count;
      count += 1;
    }
  }
  return count;
}

export async function issueChallenge(env) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM signup_challenges WHERE expires_at < ?").bind(now).run();
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT INTO signup_challenges (id, nonce, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)").bind(id, nonce, now, now + MAX_MS).run();
  return { id: id, nonce: nonce, bits: POW_BITS, waitMs: MIN_MS };
}

export async function verifySignupGuard(env, body) {
  if (!guardEnabled(env)) return { ok: true };
  if (body && String(body.fax || "").trim()) return { ok: false, status: 400, error: "rejected" };
  const pow = body && body.pow;
  if (!pow || typeof pow !== "object") return { ok: false, status: 400, error: "guard_required" };
  const id = String(pow.id || "").slice(0, 80);
  const counter = Number(pow.counter);
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(id) || !Number.isSafeInteger(counter) || counter < 0 || counter > 5000000) {
    return { ok: false, status: 400, error: "guard_required" };
  }
  const row = await env.DB.prepare("SELECT nonce, created_at, expires_at, used FROM signup_challenges WHERE id = ?").bind(id).first();
  const now = Date.now();
  if (!row || Number(row.used) === 1 || Number(row.expires_at) < now) return { ok: false, status: 400, error: "guard_required" };
  if (now - Number(row.created_at) < MIN_MS) return { ok: false, status: 400, error: "too_fast" };
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(id + ":" + row.nonce + ":" + counter));
  if (leadingZeroBits(new Uint8Array(digest)) < POW_BITS) return { ok: false, status: 400, error: "guard_required" };
  await env.DB.prepare("UPDATE signup_challenges SET used = 1 WHERE id = ? AND used = 0").bind(id).run();
  return { ok: true };
}
