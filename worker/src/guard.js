/* Request guard and change signal.

   takeToken() is a small token bucket kept in isolate memory. It stops one
   runaway client (a loop, many tabs, a script) before it spends the free
   daily Worker budget. It does no D1 or KV work, so it is free to check on
   every request. Each isolate keeps its own buckets, so the cap is per
   isolate and only approximate. That is fine for a guard.

   buildPulse() collects the version marks of the shared documents and the
   live list. The cron writes the result as one small public file. Clients
   read that file instead of polling each document through the Worker, and
   fetch a document again only when its mark moved. */

const BUCKETS = new Map();
const BUCKET_MAX_KEYS = 4000;

export const GUARD_LIMITS = {
  api: { burst: 120, perSecond: 2 },
  media: { burst: 400, perSecond: 6 }
};

export function guardClass(method, path) {
  if (method === "OPTIONS") return "";
  if (path === "/v1/channel" || path.startsWith("/ap/") || path.startsWith("/.well-known/")) return "";
  if (path === "/robots.txt" || path === "/v1/health") return "";
  if (path.startsWith("/tg/") || path.startsWith("/v1/media/")) return "media";
  return "api";
}

export function guardKey(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";
  if (token) return "t:" + token.slice(-24);
  return "ip:" + (request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown");
}

export function takeToken(key, kind, now) {
  const limit = GUARD_LIMITS[kind];
  if (!limit) return { ok: true };
  const id = kind + "|" + key;
  const at = Number(now) || Date.now();
  let bucket = BUCKETS.get(id);
  if (!bucket) {
    if (BUCKETS.size >= BUCKET_MAX_KEYS) pruneBuckets(at);
    bucket = { tokens: limit.burst, at: at };
    BUCKETS.set(id, bucket);
  }
  const refill = ((at - bucket.at) / 1000) * limit.perSecond;
  bucket.tokens = Math.min(limit.burst, bucket.tokens + Math.max(0, refill));
  bucket.at = at;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  const retry = Math.max(1, Math.ceil((1 - bucket.tokens) / limit.perSecond));
  return { ok: false, retry: retry };
}

function pruneBuckets(now) {
  for (const [id, bucket] of BUCKETS) {
    if (now - bucket.at > 10 * 60 * 1000) BUCKETS.delete(id);
  }
  if (BUCKETS.size >= BUCKET_MAX_KEYS) {
    const drop = BUCKETS.size - Math.floor(BUCKET_MAX_KEYS / 2);
    let n = 0;
    for (const id of BUCKETS.keys()) {
      if (n++ >= drop) break;
      BUCKETS.delete(id);
    }
  }
}

export function resetGuard() {
  BUCKETS.clear();
}

/* Shared documents the client reads through /v1/data. The pulse names them
   by the same key the client asks for. */
export const PULSE_KEYS = [
  "feeds.json",
  "feeds.config.json",
  "stories.json",
  "people.json",
  "status.json",
  "data/music.json",
  "archive/index.json",
  "discord/index.json",
  "discord/vk.json",
  "discord/x/index.json",
  "discord/x/catalog.json",
  "discord/x/join.json",
  "discord/x/health.json"
];

export const PULSE_OBJECT = "pulse/v1.json";

async function shortHash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < 8; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function buildPulse(env) {
  const docs = {};
  if (env && env.DATA) {
    await Promise.all(PULSE_KEYS.map(async (key) => {
      try {
        const head = await env.DATA.head(key);
        if (head) docs[key] = String(head.etag || head.httpEtag || head.uploaded && head.uploaded.getTime() || "").replace(/"/g, "");
      } catch (err) { /* a missing mark only means that document polls on its own timer */ }
    }));
  }
  let live = "";
  if (env && env.DB) {
    try {
      const rows = await env.DB.prepare("SELECT id, state, updated_at FROM live_sessions WHERE state != 'ended' ORDER BY updated_at DESC LIMIT 40").all();
      const list = (rows && rows.results) || [];
      live = list.length ? await shortHash(list.map((r) => r.id + ":" + r.state + ":" + r.updated_at).join(",")) : "none";
    } catch (err) { live = ""; }
  }
  return { v: 1, docs: docs, live: live };
}

let lastPulseText = "";

export async function publishPulse(env, now) {
  const doc = await buildPulse(env);
  const body = JSON.stringify(doc);
  if (body === lastPulseText) return false;
  const at = Number(now) || Date.now();
  const text = JSON.stringify({ v: 1, at: at, docs: doc.docs, live: doc.live });
  const target = env && env.PULSE;
  if (target) {
    if (!lastPulseText) {
      try {
        const old = await target.get(PULSE_OBJECT);
        const prior = old ? JSON.parse(await old.text()) : null;
        if (prior && JSON.stringify({ v: 1, docs: prior.docs, live: prior.live }) === body) {
          lastPulseText = body;
          pulseMemo = JSON.stringify(prior);
          return false;
        }
      } catch (err) { /* write a fresh copy */ }
    }
    await target.put(PULSE_OBJECT, text, {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-cache, max-age=0" }
    });
  }
  lastPulseText = body;
  pulseMemo = text;
  return true;
}

let pulseMemo = "";
let pulseMemoAt = 0;

/* GET /v1/pulse is the fallback when the public file cannot be read. */
export async function pulseResponse(env) {
  const now = Date.now();
  if (!pulseMemo || now - pulseMemoAt > 20000) {
    const doc = await buildPulse(env);
    pulseMemo = JSON.stringify({ v: 1, at: now, docs: doc.docs, live: doc.live });
    pulseMemoAt = now;
  }
  return new Response(pulseMemo, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
