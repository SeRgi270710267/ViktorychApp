/* Client-side Drive encryption. The passphrase and the master key stay in
   the browser. Only wrapped keys and ciphertext are sent to the Worker. */

export const DRIVE_KDF = "pbkdf2-sha256";
export const DRIVE_ITERATIONS = 600000;
export const DRIVE_CHUNK = 18 * 1024 * 1024;
export const DRIVE_MAX_FILE = 2 * 1024 * 1024 * 1024;
export const DRIVE_VERIFIER = "viktorych-drive-v1";
export const DRIVE_PACE_MS = 1100;
export const DRIVE_TRASH_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToB64(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
  return btoa(text);
}

export function b64ToBytes(value) {
  const text = atob(String(value || ""));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

export function chunkPlain(bytes, size) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const step = Math.max(1, Number(size) || DRIVE_CHUNK);
  const out = [];
  if (!raw.length) return [new Uint8Array(0)];
  for (let i = 0; i < raw.length; i += step) out.push(raw.subarray(i, Math.min(raw.length, i + step)));
  return out;
}

export async function deriveMaster(passphrase, salt, iterations) {
  const rounds = Math.floor(Number(iterations) || DRIVE_ITERATIONS);
  const base = await crypto.subtle.importKey("raw", encoder.encode(String(passphrase || "")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt), iterations: rounds, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = plain instanceof Uint8Array ? plain : new Uint8Array(plain || []);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data);
  return { iv: iv, ciphertext: new Uint8Array(cipher) };
}

export async function decryptBytes(key, iv, ciphertext) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv instanceof Uint8Array ? iv : new Uint8Array(iv) },
    key,
    ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext)
  );
  return new Uint8Array(plain);
}

export async function encryptJson(key, value) {
  const packed = await encryptBytes(key, encoder.encode(JSON.stringify(value)));
  return { iv: bytesToB64(packed.iv), ciphertext: bytesToB64(packed.ciphertext) };
}

export async function decryptJson(key, iv, ciphertext) {
  const plain = await decryptBytes(key, b64ToBytes(iv), b64ToBytes(ciphertext));
  return JSON.parse(decoder.decode(plain));
}

async function importRaw(raw) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function newItemKey(master) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await importRaw(raw);
  const wrapped = await encryptBytes(master, raw);
  raw.fill(0);
  return { key: key, wrappedKey: bytesToB64(wrapped.ciphertext), wrapIv: bytesToB64(wrapped.iv) };
}

export async function openItemKey(master, wrappedKey, wrapIv) {
  const raw = await decryptBytes(master, b64ToBytes(wrapIv), b64ToBytes(wrappedKey));
  try {
    return await importRaw(raw);
  } finally {
    raw.fill(0);
  }
}

export async function setupVault(passphrase, iterations) {
  const rounds = Math.floor(Number(iterations) || DRIVE_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveMaster(passphrase, salt, rounds);
  const packed = await encryptBytes(key, encoder.encode(DRIVE_VERIFIER));
  return {
    key: key,
    kdf: DRIVE_KDF,
    salt: bytesToB64(salt),
    iterations: rounds,
    verifier: bytesToB64(packed.ciphertext),
    verifierIv: bytesToB64(packed.iv)
  };
}

export async function verifyMaster(key, verifier, verifierIv) {
  try {
    const plain = await decryptBytes(key, b64ToBytes(verifierIv), b64ToBytes(verifier));
    return decoder.decode(plain) === DRIVE_VERIFIER;
  } catch (err) {
    return false;
  }
}

export async function unlockVault(passphrase, salt, iterations, verifier, verifierIv) {
  const key = await deriveMaster(passphrase, b64ToBytes(salt), iterations);
  if (!(await verifyMaster(key, verifier, verifierIv))) return null;
  return key;
}

export async function encryptFile(itemKey, bytes, chunkSize) {
  const parts = chunkPlain(bytes, chunkSize || DRIVE_CHUNK);
  const chunks = [];
  for (let i = 0; i < parts.length; i++) {
    const packed = await encryptBytes(itemKey, parts[i]);
    chunks.push({ index: i, iv: bytesToB64(packed.iv), ciphertext: packed.ciphertext });
  }
  return chunks;
}

export async function decryptFile(itemKey, chunks) {
  const ordered = (chunks || []).slice().sort((a, b) => Number(a.index) - Number(b.index));
  const parts = [];
  let total = 0;
  for (let i = 0; i < ordered.length; i++) {
    const plain = await decryptBytes(itemKey, b64ToBytes(ordered[i].iv), ordered[i].ciphertext);
    parts.push(plain);
    total += plain.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((part) => {
    out.set(part, at);
    at += part.length;
  });
  return out;
}

export function fileTooBig(size) {
  return Number(size) > DRIVE_MAX_FILE;
}
