/* One keyed attempt for the live detector, then the anonymous request.
   The player and the media proxy do not call primeLiveCookies, so they
   stay on the anonymous path. */

import { attentionReason } from "../../shared/owner-keys.js";
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

export async function primeLiveCookies(env) {
  primed = { env: env, cookie: "", dropped: false };
  try {
    const row = await readUsableKey(env, "tiktok");
    if (row && row.value) primed.cookie = row.value;
  } catch (err) {
    primed.cookie = "";
  }
}

export function releaseLiveCookies() {
  primed = null;
}

async function drop(reason) {
  if (!primed || primed.dropped) return;
  primed.dropped = true;
  primed.cookie = "";
  try { await markKeyAttention(primed.env, "tiktok", reason || "forbidden"); }
  catch (err) { /* the anonymous retry still runs */ }
}

export async function liveFetch(url, headers, redirectMode, keyed) {
  const base = Object.assign({}, headers || {});
  const host = String(url || "");
  const cookie = keyed && primed && !primed.dropped ? primed.cookie : "";
  if (!cookie || host.indexOf("tiktok.com") < 0) return fetchPlain(url, base, redirectMode);
  let res = null;
  try {
    res = await fetch(url, {
      headers: Object.assign({}, base, { cookie: cookie }),
      redirect: redirectMode || "follow"
    });
  } catch (err) {
    return fetchPlain(url, base, redirectMode);
  }
  const text = await res.text();
  const reason = attentionReason(res.status, text.slice(0, 20000));
  if (reason) {
    await drop(reason);
    return fetchPlain(url, base, redirectMode);
  }
  return { status: res.status, text: text, retryAfter: retryAfterSeconds(res) };
}
