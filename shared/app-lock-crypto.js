/* On-device app-lock crypto. The AES key is derived from a WebAuthn PRF
   result when the authenticator supports it, otherwise from a device PIN
   with PBKDF2. The key is not stored. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PIN_ITERATIONS = 210000;
export const VERIFIER_TEXT = "viktorych-lock-ok";

export function bytesToB64(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let text = "";
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
  return btoa(text);
}

export function b64ToBytes(value) {
  const raw = atob(String(value || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function backoffMs(fails) {
  const n = Number(fails) || 0;
  if (n < 4) return 0;
  const steps = [5000, 15000, 30000, 60000, 120000, 300000, 900000];
  return steps[Math.min(steps.length - 1, n - 4)];
}

export function sensitiveStorageKey(key) {
  const text = String(key || "");
  if (!text) return false;
  if (text.indexOf("viktorychapp-lock") === 0) return false;
  if (text.indexOf("viktorychapp-privacy") === 0) return false;
  if (text === "viktorychapp-lang-user-picked" || text === "superintelapp-lang") return false;
  const lower = text.toLowerCase();
  if (lower.indexOf("draft") >= 0) return true;
  if (lower.indexOf("message") >= 0) return true;
  if (lower.indexOf("direct") >= 0) return true;
  if (lower.indexOf("notif") >= 0) return true;
  if (lower.indexOf("account-v1") >= 0) return true;
  if (lower.indexOf("accounts-session") >= 0) return true;
  if (lower.indexOf("pending-v1") >= 0) return true;
  if (lower.indexOf("repost") >= 0) return true;
  return false;
}

export function sensitiveDoc(key, row) {
  const cat = row && row.category ? String(row.category) : "";
  if (cat === "drafts" || cat === "messages" || cat === "notifications") return true;
  return /draft|message|\bdm\b/i.test(String(key || ""));
}

export async function keyFromPrf(prf) {
  const raw = prf instanceof Uint8Array ? prf : new Uint8Array(prf || []);
  if (raw.length < 32) throw new Error("prf");
  const base = await crypto.subtle.importKey("raw", raw.slice(0, 32), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode("viktorych-app-lock-v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function keyFromPin(pin, salt, iterations) {
  const rounds = Math.max(1000, Math.floor(Number(iterations) || PIN_ITERATIONS));
  const base = await crypto.subtle.importKey("raw", encoder.encode(String(pin || "")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt || []), iterations: rounds, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* The per-device key the server keeps, sent as base64url. It is imported
   as a key the page cannot read back out. */
export async function keyFromServer(text) {
  const clean = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean + "===".slice((clean.length + 3) % 4);
  const raw = Uint8Array.from(atob(pad), function (ch) { return ch.charCodeAt(0); });
  if (raw.length !== 32) throw new Error("key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = plain instanceof Uint8Array ? plain : encoder.encode(String(plain || ""));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data));
  return { iv: bytesToB64(iv), ciphertext: bytesToB64(cipher) };
}

export async function decryptBytes(key, iv, ciphertext) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(iv) },
    key,
    b64ToBytes(ciphertext)
  );
  return new Uint8Array(plain);
}

export async function encryptJson(key, value) {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)));
}

export async function decryptJson(key, packed) {
  const plain = await decryptBytes(key, packed.iv, packed.ciphertext);
  return JSON.parse(decoder.decode(plain));
}

export async function makeVerifier(key) {
  return encryptBytes(key, VERIFIER_TEXT);
}

export async function checkVerifier(key, packed) {
  try {
    const plain = await decryptBytes(key, packed.iv, packed.ciphertext);
    return decoder.decode(plain) === VERIFIER_TEXT;
  } catch (err) {
    return false;
  }
}
