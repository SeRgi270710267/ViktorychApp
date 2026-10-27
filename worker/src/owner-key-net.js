/* One keyed attempt for the live detector. A signed-out key is replaced
   once. A rate limit, captcha, or challenge keeps that same key. The player
   and the media proxy do not call primeLiveCookies, so they stay anonymous. */

import { decideAttempt } from "../../shared/owner-keys.js";
import { readUsableKey, markKeyAttention } from "./owner-keys.js";

let primed = null;

function retryAfterSeconds(response) {
  const raw = String((response && response.headers && response.headers.get("retry-after")) || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return 0;
}

async function fetchPlain(url, headers, redirectMode) {
  const res = await fetch(url, { headers: headers, redirect: redirectMode || "follow" });
  return { status: res.status, text: await res.text(), retryAfter: retryAfterSeconds(res) };
}

async function fetchKeyed(url, headers, redirectMode, cookie) {
  const res = await fetch(url, {
    headers: Object.assign({}, headers, { cookie: cookie }),
    redirect: redirectMode || "follow"
  });
  return { status: res.status, text: await res.text(), retryAfter: retryAfterSeconds(res) };
}

export async function primeLiveCookies(env) {
  primed = { env: env, cookie: "", keyId: "", dropped: false };
  try {
    const row = await readUsableKey(env, "tiktok");
    if (row && row.value) {
      primed.cookie = row.value;
      primed.keyId = row.keyId || "";
    }
  } catch (err) {
    primed.cookie = "";
  }
}

export function releaseLiveCookies() {
  primed = null;
}

async function note(reason) {
  if (!primed) return;
  try { await markKeyAttention(primed.env, "tiktok", reason || "forbidden", primed.keyId || ""); }
  catch (err) { /* the detector still applies its own backoff */ }
}

export async function liveFetch(url, headers, redirectMode, keyed) {
  const base = Object.assign({}, headers || {});
  const host = String(url || "");
  const cookie = keyed && primed && !primed.dropped ? primed.cookie : "";
  if (!cookie || host.indexOf("tiktok.com") < 0) return fetchPlain(url, base, redirectMode);
  let res = null;
  try {
    res = await fetchKeyed(url, base, redirectMode, cookie);
  } catch (err) {
    return fetchPlain(url, base, redirectMode);
  }
  const decision = decideAttempt(res.status, res.text, true);
  if (decision.action === "hold") {
    await note(decision.reason);
    return res;
  }
  if (decision.action !== "advance") return res;
  const used = primed.keyId || "";
  primed.dropped = true;
  primed.cookie = "";
  await note(decision.reason);
  let next = null;
  try { next = await readUsableKey(primed.env, "tiktok"); }
  catch (err) { next = null; }
  if (!next || !next.value || !next.keyId || next.keyId === used) return fetchPlain(url, base, redirectMode);
  primed.cookie = next.value;
  primed.keyId = next.keyId;
  primed.dropped = false;
  let second = null;
  try {
    second = await fetchKeyed(url, base, redirectMode, next.value);
  } catch (err) {
    return fetchPlain(url, base, redirectMode);
  }
  const again = decideAttempt(second.status, second.text, true);
  if (again.action === "hold") {
    await note(again.reason);
    return second;
  }
  if (again.action === "advance") {
    primed.dropped = true;
    primed.cookie = "";
    await note(again.reason);
    return fetchPlain(url, base, redirectMode);
  }
  return second;
}
