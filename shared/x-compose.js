/* Posting to X without a paid API.
   As of 27 Oct 2026, docs.x.com prices POST /2/tweets and mention reads.
   This module never calls api.x.com. The live path is https://x.com/intent/post.
   Weighted length follows twitter-text v3 (scale 100, default weight 200,
   URLs count as 23, emoji and CJK count as 2). */

const MAX = 280;
const SCALE = 100;
const DEFAULT_WEIGHT = 200;
const URL_WEIGHT = 23;
const RANGES = [
  { start: 0, end: 4351, weight: 100 },
  { start: 8192, end: 8205, weight: 100 },
  { start: 8208, end: 8223, weight: 100 },
  { start: 8242, end: 8247, weight: 100 }
];

export const X_API_POSTING_FREE = false;
export const X_MENTIONS_API_FREE = false;
export const OAUTH_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];
export const POLL_BASE_MS = 15 * 60 * 1000;
export const POLL_CAP_MS = 6 * 60 * 60 * 1000;

const EMOJI_SOURCE = "(?:\\p{Regional_Indicator}{2})|(?:\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)";
let emojiPattern = null;
try { emojiPattern = new RegExp(EMOJI_SOURCE, "gu"); } catch (err) { emojiPattern = null; }

function weightOf(code) {
  for (let i = 0; i < RANGES.length; i++) {
    if (code >= RANGES[i].start && code <= RANGES[i].end) return RANGES[i].weight;
  }
  return DEFAULT_WEIGHT;
}

function extractUrls(text) {
  const re = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const out = [];
  let match;
  while ((match = re.exec(text))) {
    const start = match.index;
    if (start > 0 && /[A-Za-z0-9_]/.test(text.charAt(start - 1))) continue;
    let url = match[0].replace(/[.,;:!?]+$/g, "");
    while (url.endsWith(")") && (url.split("(").length <= url.split(")").length)) url = url.slice(0, -1);
    if (!/^https?:\/\/|^www\./i.test(url)) continue;
    if (!/\.[A-Za-z]{2,}(?::\d{2,5})?(?:[/?#]|$)/.test(url)) continue;
    out.push({ url: url, index: start });
  }
  return out;
}

function extractEmoji(text) {
  if (!emojiPattern) return [];
  emojiPattern.lastIndex = 0;
  const out = [];
  let match;
  while ((match = emojiPattern.exec(text))) {
    if (!match[0]) break;
    out.push({ text: match[0], index: match.index });
  }
  return out;
}

export function parseTweet(value) {
  const raw = String(value == null ? "" : value);
  const text = typeof raw.normalize === "function" ? raw.normalize("NFC") : raw;
  const urls = extractUrls(text);
  const urlAt = {};
  urls.forEach((item) => { urlAt[item.index] = item; });
  const emojiAt = {};
  extractEmoji(text).forEach((item) => {
    const inside = urls.some((url) => item.index >= url.index && item.index < url.index + url.url.length);
    if (!inside) emojiAt[item.index] = item;
  });
  let weighted = 0;
  let validChars = true;
  for (let i = 0; i < text.length; i++) {
    if (urlAt[i]) {
      weighted += URL_WEIGHT * SCALE;
      i += urlAt[i].url.length - 1;
      continue;
    }
    if (emojiAt[i]) {
      weighted += DEFAULT_WEIGHT;
      i += emojiAt[i].text.length - 1;
      continue;
    }
    const code = text.charCodeAt(i);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (code >= 0xD800 && code <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      i += 1;
      weighted += weightOf(text.charCodeAt(i));
    } else {
      if (code === 0xFFFE || code === 0xFFFF) validChars = false;
      weighted += weightOf(code);
    }
  }
  const weightedLength = weighted / SCALE;
  const valid = validChars && weightedLength > 0 && weightedLength <= MAX;
  return {
    weightedLength: weightedLength,
    valid: valid,
    remaining: MAX - weightedLength,
    permillage: Math.floor((weightedLength / MAX) * 1000),
    urls: urls.map((item) => item.url)
  };
}

function cleanTag(value) {
  const text = String(value || "").replace(/^#/, "").trim();
  return /^[A-Za-z0-9_]{1,50}$/.test(text) ? text : "";
}

export function composeWeight(input) {
  const src = input || {};
  const text = String(src.text || "");
  let total = parseTweet(text).weightedLength;
  const tags = Array.isArray(src.hashtags) ? src.hashtags : [];
  tags.forEach((tag) => {
    const clean = cleanTag(tag);
    if (clean) total += clean.length + 2;
  });
  const url = String(src.url || "");
  if (!src.quote && /^https?:\/\//i.test(url) && text.indexOf(url) === -1) total += URL_WEIGHT;
  return total;
}

export function buildIntentUrl(input) {
  const src = input || {};
  const params = new URLSearchParams();
  const text = String(src.text || "");
  if (text) params.set("text", text);
  const reply = String(src.inReplyTo || "");
  if (/^\d{5,22}$/.test(reply)) params.set("in_reply_to", reply);
  const url = String(src.url || "");
  if (/^https?:\/\//i.test(url) && text.indexOf(url) < 0) params.set("url", url);
  const tags = [];
  (Array.isArray(src.hashtags) ? src.hashtags : []).forEach((tag) => {
    const clean = cleanTag(tag);
    if (clean && tags.indexOf(clean) < 0 && tags.length < 10) tags.push(clean);
  });
  if (tags.length) params.set("hashtags", tags.join(","));
  const query = params.toString();
  return "https://x.com/intent/post" + (query ? "?" + query : "");
}

export function isIntentUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && (url.hostname === "x.com" || url.hostname === "twitter.com") && url.pathname === "/intent/post";
  } catch (err) {
    return false;
  }
}

export function choosePostPath(input) {
  const src = input || {};
  if (src.apiFree !== true) return { mode: "intent", reason: "no-free-api" };
  const left = Number(src.quotaRemaining);
  if (!Number.isFinite(left) || left <= 0) return { mode: "intent", reason: "quota" };
  return { mode: "api", reason: "ok" };
}

export function planPost(input) {
  const src = input || {};
  const asked = choosePostPath(src);
  let reason = asked.reason;
  if (X_API_POSTING_FREE !== true) reason = asked.reason === "quota" ? "quota" : "no-free-api";
  return {
    mode: "intent",
    reason: reason,
    url: buildIntentUrl(src),
    fetched: false
  };
}

export async function dispatchPost(input) {
  const src = input || {};
  const asked = choosePostPath(src);
  return {
    mode: "intent",
    reason: asked.reason === "quota" ? "quota" : "no-free-api",
    url: buildIntentUrl(src),
    fetched: false
  };
}

export function pollsSupported() {
  return false;
}

export function scheduleSupported() {
  return false;
}

export function classifyMedia(files) {
  const list = Array.isArray(files) ? files : [];
  const kinds = list.map((file) => {
    const type = String((file && file.type) || "").toLowerCase();
    if (type === "image/gif") return "gif";
    if (type.indexOf("image/") === 0) return "image";
    if (type.indexOf("video/") === 0) return "video";
    if (type.indexOf("audio/") === 0) return "audio";
    return "other";
  });
  if (!kinds.length) return { ok: true, kind: "none", count: 0 };
  if (kinds.some((kind) => kind === "other")) return { ok: false, error: "type" };
  const gif = kinds.filter((kind) => kind === "gif").length;
  const video = kinds.filter((kind) => kind === "video").length;
  const image = kinds.filter((kind) => kind === "image").length;
  const audio = kinds.filter((kind) => kind === "audio").length;
  const used = [gif > 0, video > 0, image > 0, audio > 0].filter(Boolean).length;
  if (used > 1 || gif > 1 || video > 1 || audio > 1 || image > 4) {
    return { ok: false, error: "mix" };
  }
  return { ok: true, kind: gif ? "gif" : video ? "video" : audio ? "audio" : "image", count: list.length };
}

export function sharePlan(count) {
  const n = Number(count) || 0;
  return { intentAttachesFiles: false, needsShareSheet: n > 0, copyText: true };
}

function base64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function pkceVerifier(bytes) {
  const raw = bytes instanceof Uint8Array && bytes.length >= 32 ? bytes : crypto.getRandomValues(new Uint8Array(32));
  return base64url(raw);
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(verifier || "")));
  return base64url(new Uint8Array(digest));
}

export function oauthAuthorize(input) {
  const src = input || {};
  if (src.apiFree !== true || X_API_POSTING_FREE !== true) return { enabled: false, reason: "no-free-api", url: "" };
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", String(src.clientId || ""));
  url.searchParams.set("redirect_uri", String(src.redirectUri || ""));
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", String(src.state || ""));
  url.searchParams.set("code_challenge", String(src.challenge || ""));
  url.searchParams.set("code_challenge_method", "S256");
  return { enabled: true, reason: "ok", url: url.toString() };
}

export async function oauthExchange(input) {
  const src = input || {};
  if (src.apiFree !== true || X_API_POSTING_FREE !== true) return { enabled: false, reason: "no-free-api", fetched: false };
  if (typeof src.fetchImpl !== "function") return { enabled: false, reason: "no-fetch", fetched: false };
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", String(src.code || ""));
  body.set("redirect_uri", String(src.redirectUri || ""));
  body.set("client_id", String(src.clientId || ""));
  body.set("code_verifier", String(src.verifier || ""));
  const res = await src.fetchImpl(String(src.tokenUrl || "https://example.invalid/token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const json = res && res.json ? await res.json() : {};
  return {
    enabled: true,
    fetched: true,
    reason: "ok",
    hasAccess: !!(json && json.access_token),
    hasRefresh: !!(json && json.refresh_token)
  };
}

export function partialNotesFromReplies(replies, handle, parentId) {
  const me = String(handle || "").replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(me)) return [];
  const parent = String(parentId || "");
  const out = [];
  (Array.isArray(replies) ? replies : []).forEach((reply) => {
    if (!reply || out.length >= 20) return;
    const author = String(reply.handle || "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(author) || author.toLowerCase() === me) return;
    const id = String(reply.id || reply.statusId || "");
    if (!/^\d{5,22}$/.test(id)) return;
    const text = String(reply.text || "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 280);
    const toHandle = String((reply.replyingTo && reply.replyingTo.handle) || "").replace(/^@/, "").toLowerCase();
    const toId = String((reply.replyingTo && reply.replyingTo.id) || "");
    const mentioned = new RegExp("(^|[^A-Za-z0-9_])@" + me + "(?![A-Za-z0-9_])", "i").test(text);
    const direct = toHandle === me || (!!parent && toId === parent);
    if (!mentioned && !direct) return;
    const parsed = Date.parse(reply.date || "");
    const avatar = String(reply.avatar || "");
    out.push({
      id: "xpartial:" + id,
      kind: mentioned ? "mention" : "reply",
      mention: true,
      partial: true,
      platform: "x",
      handle: author,
      name: String(reply.author || author).replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80),
      text: text,
      avatar: /^https:\/\//i.test(avatar) ? avatar.slice(0, 300) : "",
      hash: "#/@" + encodeURIComponent(author) + "/status/" + id,
      at: Number.isFinite(parsed) ? parsed : 0,
      feedId: ""
    });
  });
  return out;
}

export function nextPollDelay(prev, status) {
  if (status === 429 || status === "backoff") {
    const current = Number(prev) || POLL_BASE_MS;
    return Math.min(POLL_CAP_MS, Math.max(POLL_BASE_MS * 2, current * 2));
  }
  return POLL_BASE_MS;
}

export function suggestTokens(kind, query, rows) {
  const q = String(query || "").replace(/^[@#]/, "").toLowerCase();
  const out = [];
  const seen = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const text = String(row || "").replace(/^[@#]/, "");
    const key = text.toLowerCase();
    if (!text || seen[key] || out.length >= 6) return;
    if (q && key.indexOf(q) !== 0) return;
    if (kind === "mention" && !/^[A-Za-z0-9_]{1,15}$/.test(text)) return;
    if (kind === "tag" && !/^[A-Za-z0-9_]{1,50}$/.test(text)) return;
    seen[key] = true;
    out.push(text);
  });
  return out;
}

export function tokenAt(text, caret) {
  const upto = String(text || "").slice(0, Math.max(0, Number(caret) || 0));
  const match = upto.match(/(^|\s)([@#])([A-Za-z0-9_]{0,50})$/);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "mention" : "tag",
    query: match[3],
    start: upto.length - match[3].length - 1
  };
}

export function parseStatusId(value) {
  const text = String(value || "").trim();
  if (/^\d{5,22}$/.test(text)) return text;
  const match = text.match(/(?:x\.com|twitter\.com)\/(?:i\/status\/|[^/\s]+\/status\/)(\d{5,22})/i);
  return match ? match[1] : "";
}

const api = {
  X_API_POSTING_FREE: X_API_POSTING_FREE,
  X_MENTIONS_API_FREE: X_MENTIONS_API_FREE,
  OAUTH_SCOPES: OAUTH_SCOPES,
  parseTweet: parseTweet,
  composeWeight: composeWeight,
  buildIntentUrl: buildIntentUrl,
  isIntentUrl: isIntentUrl,
  choosePostPath: choosePostPath,
  planPost: planPost,
  dispatchPost: dispatchPost,
  pollsSupported: pollsSupported,
  scheduleSupported: scheduleSupported,
  classifyMedia: classifyMedia,
  sharePlan: sharePlan,
  pkceVerifier: pkceVerifier,
  pkceChallenge: pkceChallenge,
  oauthAuthorize: oauthAuthorize,
  oauthExchange: oauthExchange,
  partialNotesFromReplies: partialNotesFromReplies,
  nextPollDelay: nextPollDelay,
  suggestTokens: suggestTokens,
  tokenAt: tokenAt,
  parseStatusId: parseStatusId
};

globalThis.XComposeCore = api;
