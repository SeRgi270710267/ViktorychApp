/* WebAuthn helpers shared by the account Worker and the browser.
   Public keys only. The private key never leaves the authenticator.

   rpId cannot be shared by https://viktorychgroup.github.io and
   https://viktorychapp.pages.dev. github.io and pages.dev are public
   suffixes, so the relying party id is the full host. A passkey created
   on one host is not offered on the other. Preview hosts
   (*.viktorychapp.pages.dev) are their own relying parties too. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const RP_NAME = "ViktorychApp";
export const CHALLENGE_MS = 5 * 60 * 1000;

export function bytesToB64url(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let text = "";
  for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i]);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlToBytes(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text || text.length > 20000 || /[^A-Za-z0-9+/=]/.test(text)) throw new Error("bad_encoding");
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const raw = atob(text + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bytesEqual(a, b) {
  const left = a instanceof Uint8Array ? a : new Uint8Array(a || []);
  const right = b instanceof Uint8Array ? b : new Uint8Array(b || []);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

export function hexOf(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = "";
  for (let i = 0; i < raw.length; i++) out += raw[i].toString(16).padStart(2, "0");
  return out;
}

export async function sha256(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : encoder.encode(String(bytes || ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
}

export function rpIdForOrigin(origin) {
  let url;
  try { url = new URL(String(origin || "")); }
  catch (err) { return ""; }
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const local = host === "localhost" || host === "127.0.0.1";
  if (url.protocol !== "https:" && !local) return "";
  if (local) return host;
  if (host === "viktorychgroup.github.io" || host === "viktorychapp.pages.dev") return host;
  if (host.endsWith(".viktorychapp.pages.dev") || host.endsWith(".viktorychgroup.github.io")) return host;
  return "";
}

function cborHead(type, length) {
  const major = type << 5;
  if (length < 24) return Uint8Array.of(major | length);
  if (length < 256) return Uint8Array.of(major | 24, length);
  if (length < 65536) return Uint8Array.of(major | 25, length >> 8, length & 255);
  if (length < 4294967296) {
    const out = new Uint8Array(5);
    out[0] = major | 26;
    new DataView(out.buffer).setUint32(1, length);
    return out;
  }
  throw new Error("cbor");
}

function concat(parts) {
  let size = 0;
  for (let i = 0; i < parts.length; i++) size += parts[i].length;
  const out = new Uint8Array(size);
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], pos);
    pos += parts[i].length;
  }
  return out;
}

export function encodeCbor(value) {
  const parts = [];
  writeCbor(value, parts);
  return concat(parts);
}

function writeCbor(value, parts) {
  if (value instanceof Uint8Array) {
    parts.push(cborHead(2, value.length));
    parts.push(value);
    return;
  }
  if (typeof value === "string") {
    const bytes = encoder.encode(value);
    parts.push(cborHead(3, bytes.length));
    parts.push(bytes);
    return;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 0) parts.push(cborHead(0, value));
    else parts.push(cborHead(1, -1 - value));
    return;
  }
  if (value instanceof Map) {
    parts.push(cborHead(5, value.size));
    value.forEach(function (item, key) {
      writeCbor(key, parts);
      writeCbor(item, parts);
    });
    return;
  }
  if (Array.isArray(value)) {
    parts.push(cborHead(4, value.length));
    for (let i = 0; i < value.length; i++) writeCbor(value[i], parts);
    return;
  }
  throw new Error("cbor");
}

function readLen(view, offset, info) {
  if (info < 24) return { length: info, offset: offset };
  if (info === 24) return { length: view.getUint8(offset), offset: offset + 1 };
  if (info === 25) return { length: view.getUint16(offset), offset: offset + 2 };
  if (info === 26) return { length: view.getUint32(offset), offset: offset + 4 };
  throw new Error("cbor");
}

export function decodeCbor(bytes, offset) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let pos = offset || 0;
  if (pos >= raw.length) throw new Error("cbor");
  const initial = raw[pos++];
  const type = initial >> 5;
  const info = initial & 31;
  if (info === 31) throw new Error("cbor");
  const size = readLen(view, pos, info);
  pos = size.offset;
  if (type === 0) return { value: size.length, offset: pos };
  if (type === 1) return { value: -1 - size.length, offset: pos };
  if (type === 2 || type === 3) {
    if (pos + size.length > raw.length) throw new Error("cbor");
    const slice = raw.slice(pos, pos + size.length);
    return { value: type === 2 ? slice : decoder.decode(slice), offset: pos + size.length };
  }
  if (type === 4) {
    const list = [];
    for (let i = 0; i < size.length; i++) {
      const item = decodeCbor(raw, pos);
      list.push(item.value);
      pos = item.offset;
    }
    return { value: list, offset: pos };
  }
  if (type === 5) {
    const map = new Map();
    for (let i = 0; i < size.length; i++) {
      const key = decodeCbor(raw, pos);
      const item = decodeCbor(raw, key.offset);
      map.set(key.value, item.value);
      pos = item.offset;
    }
    return { value: map, offset: pos };
  }
  if (type === 6) {
    const inner = decodeCbor(raw, pos);
    return { value: inner.value, offset: inner.offset };
  }
  if (type === 7 && info === 20) return { value: false, offset: pos };
  if (type === 7 && info === 21) return { value: true, offset: pos };
  if (type === 7 && (info === 22 || info === 23)) return { value: null, offset: pos };
  throw new Error("cbor");
}

export function creationOptions(fields) {
  const options = {
    challenge: bytesToB64url(fields.challenge),
    rp: { name: RP_NAME, id: fields.rpId },
    user: {
      id: bytesToB64url(fields.userId),
      name: String(fields.userName || "account").slice(0, 64),
      displayName: String(fields.userDisplayName || "Account").slice(0, 64)
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 }
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: fields.userVerification || "preferred"
    },
    hints: ["client-device", "hybrid", "security-key"]
  };
  if (fields.excludeCredentials && fields.excludeCredentials.length) options.excludeCredentials = fields.excludeCredentials;
  return options;
}

export function requestOptions(fields) {
  const options = {
    challenge: bytesToB64url(fields.challenge),
    timeout: 60000,
    rpId: fields.rpId,
    userVerification: fields.userVerification || "preferred",
    hints: ["client-device", "hybrid", "security-key"]
  };
  if (fields.allowCredentials && fields.allowCredentials.length) options.allowCredentials = fields.allowCredentials;
  return options;
}

function descriptor(entry) {
  return {
    type: "public-key",
    id: b64urlToBytes(entry.id),
    transports: entry.transports || undefined
  };
}

export function hydrateCreation(options) {
  const next = Object.assign({}, options);
  next.challenge = b64urlToBytes(options.challenge);
  next.user = Object.assign({}, options.user, { id: b64urlToBytes(options.user.id) });
  if (options.excludeCredentials) next.excludeCredentials = options.excludeCredentials.map(descriptor);
  return next;
}

export function hydrateRequest(options) {
  const next = Object.assign({}, options);
  next.challenge = b64urlToBytes(options.challenge);
  if (options.allowCredentials) next.allowCredentials = options.allowCredentials.map(descriptor);
  return next;
}

export function parseClientData(bytes) {
  let parsed;
  try { parsed = JSON.parse(decoder.decode(bytes)); }
  catch (err) { throw new Error("client_data"); }
  if (!parsed || typeof parsed !== "object") throw new Error("client_data");
  if (parsed.crossOrigin === true) throw new Error("origin");
  return parsed;
}

export function parseAuthData(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (raw.length < 37) throw new Error("auth_data");
  const rpIdHash = raw.slice(0, 32);
  const flags = raw[32];
  const signCount = new DataView(raw.buffer, raw.byteOffset + 33, 4).getUint32(0);
  const out = {
    rpIdHash: rpIdHash,
    flags: flags,
    signCount: signCount,
    up: !!(flags & 1),
    uv: !!(flags & 4),
    backupEligible: !!(flags & 8),
    backupState: !!(flags & 16),
    credentialId: null,
    publicKey: null,
    aaguid: ""
  };
  if (!(flags & 64)) return out;
  if (raw.length < 55) throw new Error("auth_data");
  out.aaguid = hexOf(raw.slice(37, 53));
  const credLen = (raw[53] << 8) | raw[54];
  if (raw.length < 55 + credLen) throw new Error("auth_data");
  out.credentialId = raw.slice(55, 55 + credLen);
  const decoded = decodeCbor(raw, 55 + credLen);
  out.publicKey = raw.slice(55 + credLen, decoded.offset);
  return out;
}

function coseMap(bytes) {
  const decoded = decodeCbor(bytes, 0);
  if (!(decoded.value instanceof Map)) throw new Error("public_key");
  return decoded.value;
}

export async function importCoseKey(bytes) {
  const map = coseMap(bytes);
  const kty = map.get(1);
  const alg = map.get(3);
  if (kty === 2) {
    if (alg != null && alg !== -7) throw new Error("unsupported_key");
    if (map.get(-1) !== 1) throw new Error("unsupported_key");
    const x = map.get(-2);
    const y = map.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error("public_key");
    if (map.get(-4)) throw new Error("public_key");
    const point = new Uint8Array(65);
    point[0] = 4;
    point.set(x, 1);
    point.set(y, 33);
    const key = await crypto.subtle.importKey("raw", point, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { key: key, algorithm: -7 };
  }
  if (kty === 3) {
    if (alg != null && alg !== -257) throw new Error("unsupported_key");
    const n = map.get(-1);
    const e = map.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) throw new Error("public_key");
    const key = await crypto.subtle.importKey("jwk", {
      kty: "RSA",
      n: bytesToB64url(n),
      e: bytesToB64url(e),
      alg: "RS256",
      ext: false
    }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return { key: key, algorithm: -257 };
  }
  throw new Error("unsupported_key");
}

function derToRaw(der, size) {
  if (!(der instanceof Uint8Array) || der.length < 8 || der[0] !== 0x30) return null;
  let pos = 2;
  if (der[1] & 128) return null;
  if (der[pos] !== 0x02) return null;
  const rLen = der[pos + 1];
  let r = der.slice(pos + 2, pos + 2 + rLen);
  pos = pos + 2 + rLen;
  if (pos >= der.length || der[pos] !== 0x02) return null;
  const sLen = der[pos + 1];
  let s = der.slice(pos + 2, pos + 2 + sLen);
  function trim(part) {
    let i = 0;
    while (i < part.length - 1 && part[i] === 0) i++;
    part = part.slice(i);
    if (part.length > size) return null;
    const out = new Uint8Array(size);
    out.set(part, size - part.length);
    return out;
  }
  r = trim(r);
  s = trim(s);
  if (!r || !s) return null;
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

async function verifySignature(algorithm, key, signature, data) {
  const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature || []);
  if (algorithm === -7) {
    const raw = sig.length === 64 ? sig : derToRaw(sig, 32);
    if (!raw) return false;
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, data);
  }
  if (algorithm === -257) {
    return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, sig, data);
  }
  return false;
}

async function checkCeremony(clientData, auth, expected) {
  if (clientData.type !== expected.type) throw new Error("type");
  if (clientData.origin !== expected.origin) throw new Error("origin");
  const got = b64urlToBytes(clientData.challenge);
  if (!bytesEqual(got, expected.challenge)) throw new Error("challenge");
  const rpHash = await sha256(encoder.encode(expected.rpId));
  if (!bytesEqual(auth.rpIdHash, rpHash)) throw new Error("rp_id");
  if (!auth.up) throw new Error("user_presence");
  if (expected.requireUV && !auth.uv) throw new Error("user_verification");
}

export async function verifyRegistration(fields) {
  const clientBytes = fields.clientDataJSON instanceof Uint8Array ? fields.clientDataJSON : b64urlToBytes(fields.clientDataJSON);
  const attestation = fields.attestationObject instanceof Uint8Array ? fields.attestationObject : b64urlToBytes(fields.attestationObject);
  const client = parseClientData(clientBytes);
  const decoded = decodeCbor(attestation, 0);
  if (!(decoded.value instanceof Map)) throw new Error("attestation");
  const fmt = decoded.value.get("fmt");
  if (fmt !== "none" && fmt !== "packed") throw new Error("attestation");
  const authData = decoded.value.get("authData");
  if (!(authData instanceof Uint8Array)) throw new Error("attestation");
  const auth = parseAuthData(authData);
  await checkCeremony(client, auth, {
    type: "webauthn.create",
    origin: fields.origin,
    challenge: fields.challenge,
    rpId: fields.rpId,
    requireUV: !!fields.requireUV
  });
  if (!auth.credentialId || !auth.publicKey) throw new Error("credential");
  const imported = await importCoseKey(auth.publicKey);
  return {
    credentialId: auth.credentialId,
    publicKey: auth.publicKey,
    algorithm: imported.algorithm,
    signCount: auth.signCount,
    aaguid: auth.aaguid,
    backupEligible: auth.backupEligible,
    backupState: auth.backupState,
    uv: auth.uv
  };
}

export async function verifyAssertion(fields) {
  const clientBytes = fields.clientDataJSON instanceof Uint8Array ? fields.clientDataJSON : b64urlToBytes(fields.clientDataJSON);
  const authData = fields.authenticatorData instanceof Uint8Array ? fields.authenticatorData : b64urlToBytes(fields.authenticatorData);
  const signature = fields.signature instanceof Uint8Array ? fields.signature : b64urlToBytes(fields.signature);
  const client = parseClientData(clientBytes);
  const auth = parseAuthData(authData);
  await checkCeremony(client, auth, {
    type: "webauthn.get",
    origin: fields.origin,
    challenge: fields.challenge,
    rpId: fields.rpId,
    requireUV: !!fields.requireUV
  });
  const imported = await importCoseKey(fields.publicKey);
  const clientHash = await sha256(clientBytes);
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  const ok = await verifySignature(imported.algorithm, imported.key, signature, signed);
  if (!ok) throw new Error("signature");
  const previous = Number(fields.signCount || 0);
  if (auth.signCount > 0 && previous > 0 && auth.signCount <= previous) throw new Error("cloned");
  return { signCount: auth.signCount, uv: auth.uv, backupState: auth.backupState };
}

export function prfBytes(extensions) {
  const first = extensions && extensions.prf && extensions.prf.results && extensions.prf.results.first;
  if (!first) return null;
  let bytes = null;
  if (first instanceof ArrayBuffer) bytes = new Uint8Array(first);
  else if (ArrayBuffer.isView(first)) bytes = new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  else if (typeof first === "string") {
    try { bytes = b64urlToBytes(first); }
    catch (err) { bytes = null; }
  }
  if (!bytes || bytes.length < 32) return null;
  return bytes.slice(0, 32);
}

export async function credentialToJSON(credential) {
  if (!credential) return null;
  if (typeof credential.toJSON === "function") {
    try {
      const json = credential.toJSON();
      json.clientExtensionResults = extensionJSON(credential);
      return json;
    } catch (err) { /* fall through to the manual shape */ }
  }
  const response = credential.response || {};
  const json = {
    id: credential.id,
    rawId: bytesToB64url(new Uint8Array(credential.rawId)),
    type: credential.type,
    clientExtensionResults: extensionJSON(credential),
    response: {}
  };
  if (response.attestationObject) {
    json.response.clientDataJSON = bytesToB64url(new Uint8Array(response.clientDataJSON));
    json.response.attestationObject = bytesToB64url(new Uint8Array(response.attestationObject));
    json.response.transports = typeof response.getTransports === "function" ? response.getTransports() : [];
  } else {
    json.response.clientDataJSON = bytesToB64url(new Uint8Array(response.clientDataJSON));
    json.response.authenticatorData = bytesToB64url(new Uint8Array(response.authenticatorData));
    json.response.signature = bytesToB64url(new Uint8Array(response.signature));
    json.response.userHandle = response.userHandle ? bytesToB64url(new Uint8Array(response.userHandle)) : null;
  }
  return json;
}

function extensionJSON(credential) {
  let ext = {};
  try { ext = credential.getClientExtensionResults ? credential.getClientExtensionResults() : {}; }
  catch (err) { ext = {}; }
  const first = prfBytes(ext);
  if (!first) return ext && ext.prf ? { prf: { enabled: !!ext.prf.enabled } } : {};
  return { prf: { enabled: true, results: { first: bytesToB64url(first) } } };
}

export function randomBytes(count) {
  const out = new Uint8Array(count);
  crypto.getRandomValues(out);
  return out;
}
