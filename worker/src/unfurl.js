/* GET /v1/unfurl?url=  Link preview metadata for one public page.
   Reads Open Graph / Twitter card tags only and returns small JSON, never the
   page. Each URL is fetched at most once per TTL: the edge cache answers
   first, then R2 (unfurl/<sha>.json, 30 days), then the site. Failures are
   cached for a day so a dead link costs one fetch a day. No KV writes. */

import { parseMeta, safeTarget } from "../../shared/unfurl-meta.js";

export const UNFURL_TTL_S = 30 * 24 * 3600;
export const UNFURL_FAIL_TTL_S = 24 * 3600;
const MAX_BYTES = 512 * 1024;
const BOT_UA = "Mozilla/5.0 (compatible; Twitterbot/1.0; +https://viktorychgroup.github.io/ViktorychApp)";

function reply(status, body, maxAge) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? "public, max-age=" + maxAge : "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

async function sha(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

async function readCapped(response) {
  if (!response.body || !response.body.getReader) return (await response.text()).slice(0, MAX_BYTES);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    size += part.value.byteLength;
    const text = new TextDecoder().decode(part.value);
    if (size >= MAX_BYTES || /<\/head>/i.test(text)) break;
  }
  try { reader.cancel(); } catch (_) {}
  const all = new Uint8Array(size);
  let at = 0;
  chunks.forEach((chunk) => { all.set(chunk, at); at += chunk.byteLength; });
  return new TextDecoder().decode(all);
}

const YT_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export function youtubeVideoId(url) {
  const host = url.hostname.toLowerCase();
  if (!YT_HOST.test(host)) return "";
  if (/youtu\.be$/i.test(host)) return (url.pathname.split("/")[1] || "").slice(0, 20);
  const v = url.searchParams.get("v");
  if (v) return v.slice(0, 20);
  const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,20})/);
  return m ? m[1] : "";
}

async function youtubeMeta(url, fetcher) {
  const id = youtubeVideoId(url);
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const watch = "https://www.youtube.com/watch?v=" + id;
  const response = await fetcher("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch), { headers: { "user-agent": BOT_UA } });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    url: url.href,
    title: String(data.title || "").slice(0, 300),
    description: String(data.author_name || "").slice(0, 120),
    image: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
    site: "YouTube",
    domain: "youtube.com",
    large: true,
    video: watch,
    youtube: id
  };
}

export async function fetchMeta(target, fetcher) {
  if (youtubeVideoId(target)) return youtubeMeta(target, fetcher);
  let url = target;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetcher(url.href, {
      redirect: "manual",
      headers: { "user-agent": BOT_UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en" }
    });
    if (response.status >= 300 && response.status < 400) {
      const next = safeTarget(new URL(response.headers.get("location") || "", url).href);
      if (!next) return null;
      url = next;
      continue;
    }
    if (!response.ok) return null;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (/^image\//.test(type)) return { url: url.href, title: "", description: "", image: url.href, site: "", domain: url.hostname.replace(/^www\./, ""), large: true };
    if (type && type.indexOf("html") < 0) return null;
    const html = await readCapped(response);
    return parseMeta(html, url.href);
  }
  return null;
}

export async function handleUnfurl(request, deps) {
  const url = new URL(request.url);
  const target = safeTarget(url.searchParams.get("url"));
  if (!target) return reply(400, { error: "bad_url" });
  const key = await sha(target.href);
  const cacheReq = new Request("https://unfurl.cache/v1/" + key);
  const cache = deps.cache;
  if (cache) {
    const hit = await cache.match(cacheReq);
    if (hit) return hit;
  }
  const store = deps.r2;
  const now = deps.now ? deps.now() : Date.now();
  if (store) {
    try {
      const obj = await store.get("unfurl/" + key + ".json");
      if (obj) {
        const row = JSON.parse(await obj.text());
        if (row && row.at && now - row.at < UNFURL_TTL_S * 1000 && row.meta) {
          const res = reply(200, row.meta, UNFURL_TTL_S);
          if (cache) await cache.put(cacheReq, res.clone());
          return res;
        }
      }
    } catch (_) {}
  }
  let meta = null;
  try { meta = await fetchMeta(target, deps.fetch); } catch (_) { meta = null; }
  if (!meta) {
    const res = reply(200, { url: target.href, none: true }, UNFURL_FAIL_TTL_S);
    if (cache) await cache.put(cacheReq, res.clone());
    return res;
  }
  meta.url = meta.url || target.href;
  const res = reply(200, meta, UNFURL_TTL_S);
  if (cache) await cache.put(cacheReq, res.clone());
  if (store) {
    const write = store.put("unfurl/" + key + ".json", JSON.stringify({ at: now, meta: meta }), { httpMetadata: { contentType: "application/json" } }).catch(() => null);
    if (deps.waitUntil) deps.waitUntil(write); else await write;
  }
  return res;
}
