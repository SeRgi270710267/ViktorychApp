// Cached mirror for the fxtwitter profile API.
//
// The feed sync runs from GitHub Actions, whose egress IPs are shared and
// often already rate limited by api.fxtwitter.com. This route fetches the same
// JSON from the Cloudflare edge, keeps one copy in R2, and serves it again to
// a second run inside the same window. When fxtwitter fails it answers with
// the last good copy instead of an error, so a short outage does not empty a
// feed.
//
// GET /v1/x/2/profile/<handle>/statuses?with_replies=1
// GET /v1/x/2/profile/<handle>/articles?count=10
//
// X_PROXY_TOKEN, when set as a Worker secret, is required in the
// X-Viktorych-Token header. The sync sends it only to this route.

const UPSTREAM = "https://api.fxtwitter.com";
const PREFIX = "/v1/x";
const PROFILE = /^2\/profile\/([A-Za-z0-9_]{1,15})\/(statuses|media|articles)$/;
const PARAMS = new Set(["with_replies", "count", "cursor"]);
const FRESH_MS = 60 * 1000;
const STALE_MS = 30 * 60 * 60 * 1000;
const TIMEOUT_MS = 9000;
const MAX_BYTES = 3_000_000;

function reply(status, body, headers) {
  const out = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
  };
  if (headers) Object.keys(headers).forEach((key) => { out[key] = headers[key]; });
  return new Response(body == null ? null : body, { status, headers: out });
}

async function digestHex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function wantedQuery(searchParams) {
  const out = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (PARAMS.has(key)) out.set(key, String(value).slice(0, 24));
  });
  const text = out.toString();
  return text ? "?" + text : "";
}

async function readCache(env, key) {
  if (!env || !env.DATA) return null;
  const object = await env.DATA.get(key);
  if (!object) return null;
  const body = await object.text();
  const at = Number((object.customMetadata && object.customMetadata.fetchedAt) || 0);
  if (!body) return null;
  return { body: body, at: at, size: Number(object.size || body.length) };
}

async function writeCache(env, key, body, now) {
  if (!env || !env.DATA) return;
  try {
    await env.DATA.put(key, body, {
      customMetadata: { fetchedAt: String(now) },
      httpMetadata: { contentType: "application/json" }
    });
  } catch (_) {
    // A cache write must never fail the request.
  }
}

export async function handleXProxy(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return reply(405, JSON.stringify({ error: "method" }));
  const token = String((env && env.X_PROXY_TOKEN) || "").trim();
  if (token && request.headers.get("X-Viktorych-Token") !== token) {
    return reply(401, JSON.stringify({ error: "token" }));
  }
  const rest = url.pathname.slice(PREFIX.length).replace(/^\/+/, "");
  const match = PROFILE.exec(rest);
  if (!match) return reply(404, JSON.stringify({ error: "not found" }));
  const handle = match[1];
  const variant = match[2];
  const query = wantedQuery(url.searchParams);
  const target = new URL(`${UPSTREAM}/2/profile/${handle}/${variant}`);
  if (query) target.search = query;
  const key = `x-cache/${handle.toLowerCase()}/${variant}-${(await digestHex(query)).slice(0, 16)}.json`;

  const now = Date.now();
  const cached = await readCache(env, key);
  if (cached && now - cached.at >= 0 && now - cached.at < FRESH_MS) {
    return reply(200, request.method === "HEAD" ? null : cached.body, {
      "x-cache": "fresh",
      "x-cache-age": String(Math.max(0, Math.round((now - cached.at) / 1000)))
    });
  }

  let upstream = null;
  let upstreamError = "";
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    upstream = await fetch(target.toString(), {
      headers: { accept: "application/json", "user-agent": "ViktorychAppXMirror/1" },
      signal: controller ? controller.signal : undefined
    });
  } catch (err) {
    upstreamError = String((err && err.message) || err || "fetch failed").slice(0, 120);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (upstream && upstream.ok) {
    let body = "";
    try {
      body = await upstream.text();
    } catch (_) {
      body = "";
    }
    if (body && body.length <= MAX_BYTES) {
      await writeCache(env, key, body, now);
      return reply(200, request.method === "HEAD" ? null : body, {
        "x-cache": "miss",
        "x-upstream-status": String(upstream.status)
      });
    }
    upstreamError = "upstream body rejected";
  } else if (upstream) {
    upstreamError = "upstream " + String(upstream.status);
  }

  if (cached && now - cached.at < STALE_MS) {
    return reply(200, request.method === "HEAD" ? null : cached.body, {
      "x-cache": "stale",
      "x-cache-age": String(Math.max(0, Math.round((now - cached.at) / 1000))),
      "x-upstream-status": upstreamError || "unavailable"
    });
  }
  return reply(502, JSON.stringify({ error: "upstream", detail: upstreamError || "unavailable" }), {
    "x-cache": "none",
    "x-upstream-status": upstreamError || "unavailable"
  });
}
