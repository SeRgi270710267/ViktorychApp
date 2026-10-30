/* Owner-only SMS codes from the owner's SMSPool account.
   GET /v1/owner/sms answers with the active one-time orders (/request/active),
   the active rentals (/rental/retrieve) and each rental's latest messages
   (/rental/retrieve_messages). ?history=1 adds recent finished orders
   (/request/history). Read-only: nothing is bought, cancelled or refunded.
   The API key is only the Worker secret SMSPOOL_API_KEY. It is sent to
   api.smspool.net as a bearer token and never logged, echoed or stored.
   Phone numbers and codes are never logged either. */

const API = "https://api.smspool.net";
const MAX_RENTALS = 4;
const MAX_MESSAGES = 10;
const MAX_ORDERS = 40;
const TIMEOUT_MS = 8000;
const MEMO_MS = 8000;
let memo = { at: 0, key: "", body: null };

const STATUS_WORDS = {
  pending: "waiting", "1": "waiting", activating: "waiting", "8": "waiting", processing: "waiting", "7": "waiting", resend: "waiting", "4": "waiting",
  completed: "received", "3": "received",
  expired: "expired", "2": "expired",
  refunded: "refunded", "6": "refunded",
  cancelled: "cancelled", canceled: "cancelled", "5": "cancelled"
};

export function statusOf(raw, code) {
  const key = String(raw == null ? "" : raw).trim().toLowerCase();
  const word = STATUS_WORDS[key] || "";
  if (word) return word;
  return realCode(code) ? "received" : "waiting";
}

function realCode(code) {
  const text = String(code == null ? "" : code).trim();
  return text && text !== "0" ? text : "";
}

/* The code inside an SMS text: the longest run of 4 to 8 digits (a dash or
   space inside it is allowed, as in 123-456), or an alphanumeric token such as G-123456. */
export function codeFromText(text) {
  const s = String(text || "");
  const prefixed = s.match(/\b([A-Z]{1,3}-\d{4,8})\b/);
  if (prefixed) return prefixed[1];
  const runs = s.match(/\b\d{3}[- ]\d{3}\b|\b\d{4,8}\b/g) || [];
  if (!runs.length) return "";
  runs.sort((a, b) => b.replace(/\D/g, "").length - a.replace(/\D/g, "").length);
  return runs[0];
}

function clip(v, n) {
  return String(v == null ? "" : v).slice(0, n);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function epochOf(stamp) {
  // SMSPool timestamps are "YYYY-MM-DD HH:MM:SS" in UTC.
  const text = String(stamp || "").trim();
  if (!text) return 0;
  const t = Date.parse(text.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? "" : "Z"));
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function cleanOrder(row, nowSec) {
  if (!row || typeof row !== "object") return null;
  const id = clip(row.order_code || row.orderid || row.order_id, 40);
  if (!id) return null;
  const code = realCode(row.code);
  const expiry = num(row.expiry || row.expiration);
  let status = statusOf(row.status, code);
  if (status === "waiting" && expiry && nowSec > expiry) status = "expired";
  return {
    kind: "order",
    id,
    service: clip(row.service, 80),
    number: clip(row.phonenumber || row.number, 24),
    country: clip(row.short_name || row.country, 8),
    code: clip(code, 32),
    full: clip(row.full_code || row.full_sms || "", 400),
    status,
    at: epochOf(row.timestamp),
    doneAt: epochOf(row.completed_on),
    expiry
  };
}

export function cleanRental(row, messages) {
  if (!row || typeof row !== "object") return null;
  const id = clip(row.rental_code || row.code, 40);
  if (!id) return null;
  const list = (Array.isArray(messages) ? messages : []).map((m) => {
    const text = clip(m && (m.message || m.text), 600);
    return {
      id: clip(m && (m.ID != null ? m.ID : m.id), 24),
      text,
      code: clip(codeFromText(text), 32),
      sender: clip(m && m.sender, 40),
      at: epochOf(m && m.timestamp)
    };
  }).filter((m) => m.text).sort((a, b) => b.at - a.at).slice(0, MAX_MESSAGES);
  return {
    kind: "rental",
    id,
    number: clip(row.phonenumber || row.number, 24),
    country: clip(row.country_name || row.country, 40),
    expiry: num(row.expiration_date || row.expiry),
    messages: list
  };
}

async function call(env, path, form, fetcher) {
  const body = new URLSearchParams(form || {});
  let res;
  try {
    res = await fetcher(API + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + env.SMSPOOL_API_KEY, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined
    });
  } catch (err) {
    return { error: "upstream" };
  }
  if (res.status === 401 || res.status === 403) return { error: "bad_key" };
  if (res.status === 429) return { error: "busy" };
  if (res.status === 404) return { data: null };
  if (!res.ok) return { error: "upstream" };
  try { return { data: await res.json() }; } catch (err) { return { error: "upstream" }; }
}

function arrayOf(data, keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of keys) if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

export async function readSms(env, opts) {
  const fetcher = (opts && opts.fetch) || fetch;
  const nowSec = Math.floor(((opts && opts.now) || Date.now()) / 1000);
  const wantHistory = !!(opts && opts.history);
  const [active, rentals, history] = await Promise.all([
    call(env, "/request/active", {}, fetcher),
    call(env, "/rental/retrieve", {}, fetcher),
    wantHistory ? call(env, "/request/history", { start: 0, length: 30 }, fetcher) : Promise.resolve({ data: [] })
  ]);
  if (active.error === "bad_key" || rentals.error === "bad_key") return { connected: true, error: "bad_key", orders: [], rentals: [] };
  if (active.error && rentals.error) return { connected: true, error: active.error, orders: [], rentals: [] };
  const seen = new Set();
  const orders = [];
  for (const row of arrayOf(active.data, ["orders", "data"]).concat(arrayOf(history.data, ["orders", "data"]))) {
    const o = cleanOrder(row, nowSec);
    if (!o || seen.has(o.id)) continue;
    seen.add(o.id);
    orders.push(o);
  }
  orders.sort((a, b) => (b.at || 0) - (a.at || 0));
  const rentalRows = arrayOf(rentals.data, ["rentals", "data"]).slice(0, MAX_RENTALS);
  const rentalOut = [];
  for (const row of rentalRows) {
    const code = row && (row.rental_code || row.code);
    if (!code) continue;
    const msgs = await call(env, "/rental/retrieve_messages", { rental_code: String(code) }, fetcher);
    const list = msgs.data && Array.isArray(msgs.data.messages) ? msgs.data.messages : [];
    const r = cleanRental(row, list);
    if (r) rentalOut.push(r);
  }
  const partial = !!(active.error || rentals.error || history.error);
  return { connected: true, orders: orders.slice(0, MAX_ORDERS), rentals: rentalOut, partial, at: nowSec };
}

export async function handleOwnerSms(request, env, deps) {
  if (request.method !== "GET") return deps.json(405, { error: "method_not_allowed" });
  const gate = await deps.requireOwnerHidden(request, env);
  if (gate.error) return gate.error;
  const headers = { "cache-control": "no-store" };
  if (!env.SMSPOOL_API_KEY) return withHeaders(deps.json(200, { connected: false, orders: [], rentals: [] }), headers);
  if (deps.rateHit) {
    const hit = await deps.rateHit(env, "owner-sms:" + gate.row.public_id, 90, 10 * 60 * 1000);
    if (!hit.ok) return deps.limited(hit);
  }
  const url = new URL(request.url);
  const history = url.searchParams.get("history") === "1";
  const now = Date.now();
  const key = history ? "h" : "a";
  if (memo.body && memo.key === key && now - memo.at < MEMO_MS) return withHeaders(deps.json(200, memo.body), headers);
  const body = await readSms(env, { history, fetch: deps.fetch, now });
  if (!body.error) memo = { at: now, key, body };
  return withHeaders(deps.json(200, body), headers);
}

export function resetSmsMemo() {
  memo = { at: 0, key: "", body: null };
}

function withHeaders(res, extra) {
  try {
    Object.keys(extra).forEach((k) => res.headers.set(k, extra[k]));
    return res;
  } catch (err) {
    return res;
  }
}

/* POST /v1/inbox/sms: any signed-in member reads their own SMSPool account.
   The member's API key comes from their device (stored there encrypted) with
   each request, is used for this one read and is never stored or logged.
   No memo: one member's answer can never reach another. Off unless the Worker
   var INBOX_RELAY is "on". */
export async function handleMemberSms(request, env, deps) {
  const headers = { "cache-control": "no-store" };
  if (String(env && env.INBOX_RELAY || "") !== "on") return withHeaders(deps.json(404, { error: "off" }), headers);
  if (request.method !== "POST") return withHeaders(deps.json(405, { error: "method_not_allowed" }), headers);
  const account = await deps.sessionAccount(env, request);
  if (!account) return withHeaders(deps.json(401, { error: "sign_in" }), headers);
  const hit = await deps.rateHit(env, "member-sms:" + account.public_id, 90, 10 * 60 * 1000);
  if (!hit.ok) return deps.limited(hit);
  let body;
  try { body = await deps.readJson(request, 2048); } catch (err) { body = null; }
  const key = body && typeof body.key === "string" ? body.key.trim() : "";
  if (!key || key.length > 200 || /[\s\0]/.test(key)) return withHeaders(deps.json(400, { error: "bad_input" }), headers);
  const out = await readSms({ SMSPOOL_API_KEY: key }, { history: body.history === true, fetch: deps.fetch, now: Date.now() });
  return withHeaders(deps.json(200, out), headers);
}
