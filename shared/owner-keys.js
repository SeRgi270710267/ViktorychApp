/* Owner "connected keys" helpers. No network and no secret logging.
   The saved value is encrypted elsewhere. These functions only parse,
   mask, and decide whether one attempt should fall back. */

const encoder = new TextEncoder();

const SLOTS = [
  { id: "tiktok", kind: "cookie", label: "TikTok cookies", hosts: ["tiktok.com"] },
  { id: "youtube", kind: "cookie", label: "YouTube cookies", hosts: ["youtube.com", "youtu.be", "googlevideo.com"] },
  { id: "instagram", kind: "cookie", label: "Instagram cookies", hosts: ["instagram.com", "cdninstagram.com"] },
  { id: "reddit", kind: "pair", label: "Reddit API", hosts: ["reddit.com"] },
  { id: "discord", kind: "token", label: "Discord token", hosts: ["discord.com"] },
  { id: "telegram", kind: "token", label: "Telegram bot token", hosts: ["telegram.org"] },
  { id: "threads", kind: "cookie", label: "Threads cookies", hosts: ["threads.net", "threads.com"] },
  { id: "vk", kind: "cookie", label: "VK cookies", hosts: ["vk.com", "vk.ru", "userapi.com"] },
  { id: "x", kind: "cookie", label: "X cookies", hosts: ["x.com", "twitter.com"] }
];

const SLOT_IDS = {};
SLOTS.forEach((slot) => { SLOT_IDS[slot.id] = slot; });

const ERRORS = {
  unauthorized: true,
  forbidden: true,
  captcha: true,
  challenge: true,
  expired: true,
  unreachable: true,
  unreadable: true,
  bad_paste: true,
  logged_out: true,
  session_invalid: true,
  auth_required: true,
  rate_limit: true
};

const ADVANCE = {
  unauthorized: true,
  expired: true,
  unreadable: true,
  logged_out: true,
  session_invalid: true,
  auth_required: true
};

const HOLD = {
  captcha: true,
  challenge: true,
  forbidden: true,
  rate_limit: true
};

function slotById(id) {
  return SLOT_IDS[String(id || "").toLowerCase()] || null;
}

function slotForUrl(url) {
  let host = "";
  try { host = new URL(String(url || "")).hostname.toLowerCase(); }
  catch (err) { host = ""; }
  if (!host) return null;
  for (let i = 0; i < SLOTS.length; i++) {
    const hosts = SLOTS[i].hosts || [];
    for (let j = 0; j < hosts.length; j++) {
      const name = hosts[j];
      if (host === name || host.endsWith("." + name)) return SLOTS[i];
    }
  }
  return null;
}

function maskSecret(value) {
  return String(value || "") ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "";
}

function sanitizeError(value) {
  const code = String(value || "").trim().toLowerCase();
  return ERRORS[code] ? code : "";
}

function bytesToB64(bytes) {
  let text = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    text += String.fromCharCode.apply(null, slice);
  }
  return btoa(text);
}

function b64ToBytes(text) {
  const raw = atob(String(text || ""));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function attentionReason(status, body) {
  const code = Number(status) || 0;
  const text = String(body || "").slice(0, 20000).toLowerCase();
  if (code === 429 || text.indexOf("too many requests") >= 0 || text.indexOf("rate limit") >= 0) return "rate_limit";
  if (text.indexOf("captcha") >= 0) return "captcha";
  if (text.indexOf("cf-challenge") >= 0 || text.indexOf("just a moment") >= 0 || text.indexOf("attention required") >= 0 || text.indexOf("verify you are human") >= 0 || text.indexOf("challenge-platform") >= 0 || text.indexOf("captcha-verify") >= 0) return "challenge";
  if (text.indexOf("logged out") >= 0 || text.indexOf("not logged in") >= 0 || text.indexOf("login required") >= 0 || text.indexOf("auth required") >= 0 || text.indexOf("authentication required") >= 0 || text.indexOf("session invalid") >= 0 || text.indexOf("invalid session") >= 0 || text.indexOf("session expired") >= 0) return "session_invalid";
  if (code === 401) return "unauthorized";
  if (code === 403) return "forbidden";
  return "";
}

function decideAttempt(status, body, usedKey) {
  const reason = attentionReason(status, body);
  if (!usedKey || !reason) return { action: "keep", reason: "" };
  if (ADVANCE[reason]) return { action: "advance", reason: reason };
  if (HOLD[reason]) return { action: "hold", reason: reason };
  return { action: "keep", reason: "" };
}

function expiryState(expiresAt, now) {
  const at = Number(expiresAt) || 0;
  const moment = Number(now) || Date.now();
  if (at > 0 && at <= moment) return "expired";
  return "";
}

function cookieNameOk(name) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function parseNetscape(raw, nowMs) {
  const cookies = [];
  const lines = String(raw || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === "#") continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const name = parts[5].trim();
    const value = parts.slice(6).join("\t");
    const exp = Number(parts[4]);
    if (!cookieNameOk(name) || !value) continue;
    cookies.push({ name: name, value: value, exp: Number.isFinite(exp) ? exp : 0 });
  }
  if (!cookies.length) return { ok: false, error: "bad_paste" };
  const dated = cookies.filter((row) => row.exp > 0);
  const future = dated.filter((row) => row.exp * 1000 > nowMs);
  const expired = dated.length > 0 && dated.length === cookies.length && future.length === 0;
  let expiresAt = 0;
  if (expired) {
    expiresAt = Math.max.apply(null, dated.map((row) => row.exp * 1000));
  } else if (future.length) {
    expiresAt = Math.min.apply(null, future.map((row) => row.exp * 1000));
  }
  return {
    ok: true,
    material: cookies.map((row) => row.name + "=" + row.value).join("; "),
    expiresAt: expiresAt,
    expired: expired,
    mask: maskSecret("saved")
  };
}

function parseCookieHeader(raw) {
  const pairs = [];
  String(raw || "").split(";").forEach((piece) => {
    const trimmed = piece.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    const eq = trimmed.indexOf("=");
    if (eq < 1) return;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!cookieNameOk(name) || !value) return;
    pairs.push(name + "=" + value);
  });
  if (!pairs.length) return { ok: false, error: "bad_paste" };
  return { ok: true, material: pairs.join("; "), expiresAt: 0, expired: false, mask: maskSecret("saved") };
}

function parseCookies(text, now) {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!raw || raw.length > 100000) return { ok: false, error: "bad_paste" };
  if (raw.charAt(0) === "{" || raw.charAt(0) === "[") return { ok: false, error: "bad_paste" };
  const nowMs = Number(now) || Date.now();
  if (raw.indexOf("\t") >= 0 || raw.indexOf("# Netscape") === 0 || raw.indexOf("# HTTP Cookie File") === 0) {
    return parseNetscape(raw, nowMs);
  }
  return parseCookieHeader(raw);
}

function parsePair(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 8000) return { ok: false, error: "bad_paste" };
  let id = "";
  let secret = "";
  if (raw.charAt(0) === "{") {
    try {
      const data = JSON.parse(raw);
      id = String((data && (data.clientId || data.client_id)) || "").trim();
      secret = String((data && (data.clientSecret || data.client_secret)) || "").trim();
    } catch (err) {
      return { ok: false, error: "bad_paste" };
    }
  } else if (raw.indexOf("\n") >= 0) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    id = lines[0] || "";
    secret = lines[1] || "";
  } else {
    const cut = raw.indexOf(":");
    if (cut > 0) {
      id = raw.slice(0, cut).trim();
      secret = raw.slice(cut + 1).trim();
    }
  }
  if (!id || !secret || id.length > 200 || secret.length > 400 || /[\r\n]/.test(id) || /[\r\n]/.test(secret)) {
    return { ok: false, error: "bad_paste" };
  }
  return {
    ok: true,
    material: JSON.stringify({ clientId: id, clientSecret: secret }),
    expiresAt: 0,
    expired: false,
    mask: maskSecret("saved")
  };
}

function parseToken(text) {
  const value = String(text || "").trim();
  if (!value || value.length < 8 || value.length > 4000) return { ok: false, error: "bad_paste" };
  if (/[\r\n\t]/.test(value)) return { ok: false, error: "bad_paste" };
  return { ok: true, material: value, expiresAt: 0, expired: false, mask: maskSecret("saved") };
}

function parseMaterial(kind, text, now) {
  if (kind === "cookie") return parseCookies(text, now);
  if (kind === "pair") return parsePair(text);
  if (kind === "token") return parseToken(text);
  return { ok: false, error: "bad_paste" };
}

async function importEncKey(secret) {
  const text = String(secret || "").trim();
  if (!text) return null;
  let raw = null;
  try {
    const decoded = b64ToBytes(text);
    if (decoded.length === 32) raw = decoded;
  } catch (err) { raw = null; }
  if (!raw) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
    raw = new Uint8Array(digest);
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptMaterial(secret, slot, plaintext) {
  const key = await importEncKey(secret);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: iv,
    additionalData: encoder.encode("owner-key:" + slot)
  }, key, encoder.encode(String(plaintext || "")));
  return { iv: bytesToB64(iv), ciphertext: bytesToB64(new Uint8Array(cipher)) };
}

async function decryptMaterial(secret, slot, ivText, cipherText) {
  const key = await importEncKey(secret);
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: b64ToBytes(ivText),
      additionalData: encoder.encode("owner-key:" + slot)
    }, key, b64ToBytes(cipherText));
    return new TextDecoder().decode(plain);
  } catch (err) {
    return null;
  }
}

const api = {
  SLOTS: SLOTS,
  slotById: slotById,
  slotForUrl: slotForUrl,
  maskSecret: maskSecret,
  sanitizeError: sanitizeError,
  attentionReason: attentionReason,
  decideAttempt: decideAttempt,
  ADVANCE: ADVANCE,
  HOLD: HOLD,
  expiryState: expiryState,
  parseMaterial: parseMaterial,
  encryptMaterial: encryptMaterial,
  decryptMaterial: decryptMaterial
};

export {
  SLOTS,
  slotById,
  slotForUrl,
  maskSecret,
  sanitizeError,
  attentionReason,
  decideAttempt,
  ADVANCE,
  HOLD,
  expiryState,
  parseMaterial,
  encryptMaterial,
  decryptMaterial
};
export default api;
