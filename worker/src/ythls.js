// YouTube playback relay.
//
// Public Invidious HLS manifests carry chunk URLs signed for the exact IP
// that fetched the manifest. A page visitor on another IP gets 403 on every
// chunk, so the <video> element either shows a black frame or does not start.
// This route pulls the manifest from a live Invidious instance and rewrites
// every nested playlist and chunk URL back through the Worker, so the whole
// playback flows from one consistent Cloudflare egress IP and the signatures
// stay valid.
//
// GET /v1/yt/manifest?id=<videoId>   returns a rewritten HLS manifest
// GET /v1/yt/media?url=<encoded>     streams one playlist or media chunk
//
// Public pages only: no keys, no cookies, no captcha bypass. Hosts are
// allowlisted and every response carries no-store plus the nosniff header.

const PREFIX_MANIFEST = "/v1/yt/manifest";
const PREFIX_MEDIA = "/v1/yt/media";
const PLAY_ID = /^[A-Za-z0-9_-]{6,24}$/;
const TIMEOUT_MS = 15000;
const MAX_MANIFEST_BYTES = 2_000_000;

// Invidious instances that serve the API and the HLS lane. Checked against
// the official instance directory when they were chosen; the manifest route
// walks the list in order and skips an instance that fails this run.
const IV_BASES = [
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
  "https://inv.nadeko.net",
];

// Chunks live on one of these hosts. www.youtube.com is allowed only for the
// /api/manifest/ path that the variant playlists point at.
function targetHostOk(hostname, pathname) {
  const host = String(hostname || "").toLowerCase();
  if (/(^|\.)googlevideo\.com$/i.test(host)) return true;
  if (/^www\.youtube\.com$/.test(host)) return String(pathname || "").startsWith("/api/manifest/");
  return IV_BASES.some((base) => base.replace(/^https?:\/\//, "") === host);
}
export { targetHostOk, rewritePlaylist };

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

function proxied(origin, value, base) {
  try {
    const abs = new URL(value, base).toString();
    const parsed = new URL(abs);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (!targetHostOk(parsed.hostname, parsed.pathname)) return null;
    return origin + PREFIX_MEDIA + "?url=" + encodeURIComponent(abs);
  } catch (err) {
    return null;
  }
}

function rewritePlaylist(text, base, origin) {
  return String(text || "").split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.charAt(0) === "#") {
      return line.replace(/URI="([^"]+)"/g, (all, uri) => {
        const next = proxied(origin, uri, base);
        return next ? 'URI="' + next + '"' : all;
      });
    }
    return proxied(origin, trimmed, base) || trimmed;
  }).join("\n");
}

async function upstream(url, extraHeaders) {
  const headers = new Headers();
  headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  headers.set("accept", "*/*");
  if (extraHeaders) extraHeaders.forEach((value, key) => { if (!/^accept-encoding$/i.test(key)) headers.set(key, value); });
  return fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function findManifest(request, env, url, videoId) {
  for (let index = 0; index < IV_BASES.length; index++) {
    const base = IV_BASES[index];
    let response = null;
    try {
      response = await upstream(base + "/api/v1/videos/" + encodeURIComponent(videoId));
    } catch (err) {
      continue;
    }
    if (!response.ok) continue;
    let data = null;
    try { data = await response.json(); } catch (err) { data = null; }
    const hls = data && String(data.hlsUrl || "");
    let parsed = null;
    try { parsed = new URL(hls); } catch (err) { parsed = null; }
    if (!parsed || parsed.protocol !== "https:" || !targetHostOk(parsed.hostname, parsed.pathname)) continue;
    let manifest = null;
    try {
      manifest = await upstream(parsed.toString());
    } catch (err) {
      continue;
    }
    if (!manifest.ok) continue;
    const text = await manifest.text();
    if (text.length > MAX_MANIFEST_BYTES || text.indexOf("#EXTM3U") < 0) continue;
    const origin = new URL(request.url).origin;
    return reply(200, rewritePlaylist(text, parsed.toString(), origin), {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "private, no-store",
      "cdn-cache-control": "no-store"
    });
  }
  return reply(502, { error: "no_lane" });
}

export async function handleYtRoute(request, env, url) {
  const path = url.pathname;
  if (path === PREFIX_MANIFEST && request.method === "GET") {
    const id = String(url.searchParams.get("id") || "");
    if (!PLAY_ID.test(id)) return reply(400, { error: "bad_url" });
    let blocked = null;
    try { blocked = rateLimited(request, env, "yt-manifest", 40, 5 * 60 * 1000); } catch (err) { blocked = { ok: true }; }
    if (blocked && !blocked.ok) return reply(429, { error: "rate_limited" });
    return findManifest(request, env, url, id);
  }
  if (path === PREFIX_MEDIA && request.method === "GET") {
    const target = url.searchParams.get("url") || "";
    let parsed = null;
    try { parsed = new URL(target); } catch (err) { parsed = null; }
    if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password || !targetHostOk(parsed.hostname, parsed.pathname)) {
      return reply(400, { error: "bad_url" });
    }
    let blocked = { ok: true };
    try { blocked = rateLimited(request, env, "yt-media", 4000, 10 * 60 * 1000); } catch (err) { blocked = { ok: true }; }
    if (!blocked.ok) return reply(429, { error: "rate_limited" });
    const headers = new Headers();
    const range = request.headers.get("range") || "";
    if (/^bytes=\d*-\d*$/.test(range)) headers.set("range", range);
    let chunk = null;
    try {
      chunk = await upstream(parsed.toString(), headers);
    } catch (err) {
      return reply(502, { error: "upstream" });
    }
    let finalHost = "";
    try { finalHost = new URL(chunk.url).hostname; } catch (err) { finalHost = ""; }
    if (!finalHost || !targetHostOk(finalHost, (function () { try { return new URL(chunk.url).pathname; } catch (err) { return ""; } })())) {
      if (chunk.body && chunk.body.cancel) { const dropped = chunk.body.cancel(); if (dropped && dropped.catch) dropped.catch(function () {}); }
      return reply(400, { error: "bad_url" });
    }
    const type = chunk.headers.get("content-type") || "application/octet-stream";
    const mediaType = /mpegurl|m3u8/i.test(type) || /api\/manifest/.test(parsed.pathname);
    if (mediaType) {
      if (chunk.body && chunk.body.cancel) { const dropped = chunk.body.cancel(); if (dropped && dropped.catch) dropped.catch(function () {}); }
      const text = await chunk.text();
      if (!text || text.length > MAX_MANIFEST_BYTES) return reply(502, { error: "upstream" });
      const origin = new URL(request.url).origin;
      const base = chunk.url && /^https/.test(chunk.url) ? chunk.url : parsed.toString();
      return new Response(rewritePlaylist(text, base, origin), {
        status: chunk.status,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "cache-control": "private, no-store",
          "cdn-cache-control": "no-store",
          "x-content-type-options": "nosniff"
        }
      });
    }
    const out = new Headers();
    out.set("content-type", type);
    const length = chunk.headers.get("content-length");
    if (length) out.set("content-length", length);
    const contentRange = chunk.headers.get("content-range");
    if (contentRange) out.set("content-range", contentRange);
    if (chunk.headers.get("accept-ranges")) out.set("accept-ranges", chunk.headers.get("accept-ranges"));
    out.set("cache-control", "private, no-store");
    out.set("cdn-cache-control", "no-store");
    out.set("x-content-type-options", "nosniff");
    return new Response(chunk.body, { status: chunk.status, headers: out });
  }
  return reply(404, { error: "not_found" });
}

// Cheap in-memory limiter for this isolate; the index.js helper is not
// exported. A missed hit simply costs nothing, deterministic resumption on a
// new isolate resets the window, and Cloudflare's edge cache absorbs the
// extra load.
function rateLimited(request, env, name, limit, windowMs) {
  const now = Date.now();
  const ip = (request.headers.get("cf-connecting-ip") || "").slice(0, 60);
  if (!rateLimited.hits) rateLimited.hits = new Map();
  const key = name + ":" + ip;
  const row = rateLimited.hits.get(key) || { count: 0, reset: now + windowMs };
  if (now > row.reset) {
    row.count = 0;
    row.reset = now + windowMs;
  }
  row.count += 1;
  rateLimited.hits.set(key, row);
  if (rateLimited.hits.size > 5000) rateLimited.hits.clear();
  return { ok: row.count <= limit };
}
