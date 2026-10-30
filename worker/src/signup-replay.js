/* Sign-up retries.

   A sign-up whose answer never reached the phone (the connection stalled
   and the app gave up waiting) is sent again with the same random sign-up
   key. The account the first try made was never handed to anyone, so the
   retry takes it over with a fresh account number and session instead of
   making a second account or finding its own handle "taken".

   The key is a random secret only that device knows. The record is one
   row in rate_limits ("su-key:<hash>:<account id>") that lasts fifteen
   minutes, so no migration is needed, and deleting the account removes it
   with the account's other buckets. */

const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const REPLAY_MS = 15 * 60 * 1000;

export function cleanSignupKey(value) {
  const text = String(value == null ? "" : value);
  return KEY_RE.test(text) ? text : "";
}

export async function replayPrefix(sha256Hex, key) {
  const clean = cleanSignupKey(key);
  if (!clean) return "";
  return "su-key:" + (await sha256Hex("signup-key:" + clean)).slice(0, 40) + ":";
}

/* The account an earlier try with this key made, if it is still fresh. */
export async function findUndelivered(env, prefix, now) {
  if (!prefix) return "";
  const row = await env.DB.prepare("SELECT bucket, reset_at FROM rate_limits WHERE bucket >= ? AND bucket < ? ORDER BY reset_at DESC LIMIT 1").bind(prefix, prefix + "~").first();
  if (!row || Number(row.reset_at) <= (Number(now) || Date.now())) return "";
  const id = String(row.bucket || "").slice(prefix.length);
  return /^\d{12}$/.test(id) ? id : "";
}

export async function rememberSignup(env, prefix, publicId, now) {
  if (!prefix || !/^\d{12}$/.test(String(publicId || ""))) return;
  const at = Number(now) || Date.now();
  await env.DB.prepare("INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET reset_at = excluded.reset_at").bind(prefix + publicId, at + REPLAY_MS).run();
}
