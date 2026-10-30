/* Sealed catalogs on GitHub Pages.

   The build step encrypts the reader copy of a few read-mostly catalogs
   (feeds, stories, people, ...) and ships them with the site, so the app
   can read them from Pages instead of asking the Worker on every load.
   The key changes every UTC day and is derived from ACCOUNT_PEPPER, so no
   new secret is needed. Signed-in sessions get today's and yesterday's key
   from GET /v1/seal, once per day per device. Without a session the files
   are just noise, so the login wall still holds. */

export const SEAL_KEYS = [
  "feeds.json",
  "feeds.config.json",
  "stories.json",
  "people.json",
  "suggestions.json",
  "status.json",
  "data/music.json"
];

const LABEL = "viktorych-data-seal:v1:";

export function sealDay(ms) {
  return new Date(Number(ms) || Date.now()).toISOString().slice(0, 10);
}

export function sealFile(key) {
  return "sealed/" + String(key || "").replace(/\//g, "__");
}

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("webcrypto");
  return c.subtle;
}

export function toB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < arr.length; i += 0x8000) out += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(out);
}

export function fromB64(text) {
  const raw = atob(String(text || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function sealKeyBytes(secret, day) {
  const s = subtle();
  const enc = new TextEncoder();
  const hmac = await s.importKey("raw", enc.encode(String(secret || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await s.sign("HMAC", hmac, enc.encode(LABEL + day)));
}

async function aesKey(keyBytes, use) {
  return subtle().importKey("raw", keyBytes, { name: "AES-GCM" }, false, [use]);
}

/* { v, day, at, iv, ct }. The key name is bound as extra data, so a file
   cannot be swapped for another catalog. */
export async function sealText(secret, day, key, text, at) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const k = await aesKey(await sealKeyBytes(secret, day), "encrypt");
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(key) }, k, new TextEncoder().encode(String(text)));
  return { v: 1, day, at: at || new Date().toISOString(), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function openSealed(keyBytes, key, doc) {
  const k = await aesKey(keyBytes, "decrypt");
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(doc.iv), additionalData: new TextEncoder().encode(key) }, k, fromB64(doc.ct));
  return new TextDecoder().decode(plain);
}

export async function handleSeal(request, env, deps) {
  if (request.method !== "GET") return deps.json(405, { error: "method" });
  const secret = String((env && env.ACCOUNT_PEPPER) || "");
  if (!secret) return deps.json(404, { error: "not_configured" });
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return deps.json(401, { error: "unauthorized" });
  const now = Date.now();
  const keys = {};
  for (const day of [sealDay(now), sealDay(now - 86400000)]) keys[day] = toB64(await sealKeyBytes(secret, day));
  // The owner sees unstripped catalogs, so the owner keeps reading the API.
  const body = JSON.stringify({ v: 1, keys, use: viewer.owner !== 1, files: SEAL_KEYS });
  return new Response(body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
}
