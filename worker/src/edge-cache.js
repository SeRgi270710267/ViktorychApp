/* KV in front of hot public D1 reads.
   The edge cache (Cache API) is the short TTL. KV is written only when the
   body hash changes, and at most 900 times in this isolate per UTC day, so
   the account stays under the free 1,000 KV writes. A miss or a KV error
   reads D1. Viewer-specific fields are not stored here. */

const FRESH_MS = 60 * 1000;
const KV_TTL_SECONDS = 24 * 60 * 60;
const EDGE_MAX_AGE = 30;
const WRITE_CAP = 900;

let writeDay = "";
let writeCount = 0;

function budgetOk() {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== writeDay) {
    writeDay = day;
    writeCount = 0;
  }
  return writeCount < WRITE_CAP;
}

function noteWrite() {
  writeCount += 1;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function edgeRequest(key) {
  return new Request("https://viktorych-edge.internal/" + encodeURIComponent(key));
}

async function edgeGet(key) {
  try {
    const hit = await caches.default.match(edgeRequest(key));
    if (!hit) return "";
    return await hit.text();
  } catch (err) {
    return "";
  }
}

async function edgePut(key, text) {
  try {
    await caches.default.put(edgeRequest(key), new Response(text, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=" + EDGE_MAX_AGE
      }
    }));
  } catch (err) { /* the caller still returns the body */ }
}

function kvBinding(env) {
  if (!env || !env.CACHE || typeof env.CACHE.get !== "function") return null;
  return env.CACHE;
}

export async function readThrough(env, key, load) {
  const edge = await edgeGet(key);
  if (edge) return edge;
  const kv = kvBinding(env);
  let cached = null;
  if (kv) {
    try { cached = await kv.get(key, "json"); }
    catch (err) { cached = null; }
  }
  const age = cached && cached.body ? Date.now() - Number(cached.at || 0) : Infinity;
  let text = "";
  if (cached && cached.body && age >= 0 && age < FRESH_MS) {
    text = String(cached.body);
  } else {
    try {
      text = String(await load());
    } catch (err) {
      if (cached && cached.body) text = String(cached.body);
      else throw err;
    }
    if (kv && text && budgetOk()) {
      try {
        const hash = await sha256Hex(text);
        if (!cached || cached.hash !== hash) {
          await kv.put(key, JSON.stringify({ hash: hash, body: text, at: Date.now() }), { expirationTtl: KV_TTL_SECONDS });
          noteWrite();
        }
      } catch (err) { /* D1 already produced text */ }
    }
  }
  if (text) await edgePut(key, text);
  return text;
}

export async function invalidate(env, key) {
  try { await caches.default.delete(edgeRequest(key)); }
  catch (err) { /* the short edge TTL still expires */ }
  const kv = kvBinding(env);
  if (!kv || typeof kv.delete !== "function" || !budgetOk()) return;
  try {
    await kv.delete(key);
    noteWrite();
  } catch (err) { /* the next read fills D1 */ }
}

export function cacheWriteCount() {
  return writeCount;
}
