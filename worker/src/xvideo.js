/* GET /v1/xv?id=<status id>  The playable files of one public X post.
   Our own player plays these, so no X embed is needed. The answer is small
   JSON with only video.twimg.com variants and the poster; no video bytes pass
   through here and nothing is stored in R2. Sources, in order: X's public
   syndication endpoint (its CORS only allows platform.twitter.com, so the page
   cannot read it directly), then the public fxtwitter and vxtwitter APIs.
   Answers are cached at the edge for 15 minutes, misses for 5. */

import { assertNotPaidX } from "./x-guard.js";

const OK_TTL_S = 15 * 60;
const MISS_TTL_S = 5 * 60;
const TIMEOUT_MS = 6000;
const UA = "Mozilla/5.0 (compatible; ViktorychApp/1.0; +https://viktorychgroup.github.io/ViktorychApp)";

function reply(status, body, maxAge) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? "public, max-age=" + maxAge : "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive, nosnippet, noimageindex"
    }
  });
}

function twimgVideo(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" && /(^|\.)video\.twimg\.com$/i.test(u.hostname);
  } catch (err) {
    return false;
  }
}

function twimgImage(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" && /(^|\.)pbs\.twimg\.com$/i.test(u.hostname) ? u.toString() : "";
  } catch (err) {
    return "";
  }
}

function cleanVariants(rows) {
  const out = [];
  (rows || []).forEach((row) => {
    if (!row || !twimgVideo(row.url) || out.some((seen) => seen.url === row.url)) return;
    const hls = /\.m3u8(\?|$)/i.test(String(row.url)) || /mpegurl/i.test(String(row.content_type || row.type || ""));
    out.push({ url: String(row.url), bitrate: hls ? 0 : Number(row.bitrate || row.bit_rate) || 0, kind: hls ? "hls" : "mp4" });
  });
  return out;
}

/* The token X's own embed sends. Any value works today, but send the real one. */
export function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function fromSyndication(data) {
  const list = (data && (data.mediaDetails || (data.tweet && data.tweet.mediaDetails))) || [];
  return list.filter((m) => m && (m.type === "video" || m.type === "animated_gif") && m.video_info).map((m) => ({
    type: m.type === "animated_gif" ? "animated_gif" : "video",
    poster: twimgImage(m.media_url_https),
    variants: cleanVariants(m.video_info.variants),
    duration: Number(m.video_info.duration_millis) || 0
  })).filter((m) => m.variants.length);
}

export function fromFx(data) {
  const status = data && (data.status || data.tweet);
  const media = status && status.media;
  const list = (media && (media.videos || (media.all || []).filter((m) => m && (m.type === "video" || m.type === "gif")))) || [];
  return list.map((m) => ({
    type: m.type === "gif" ? "animated_gif" : "video",
    poster: twimgImage(m.thumbnail_url),
    variants: cleanVariants([].concat(m.variants || m.formats || [], m.url ? [{ url: m.url, bitrate: 1 }] : [])),
    duration: Math.round((Number(m.duration) || 0) * 1000)
  })).filter((m) => m.variants.length);
}

export function fromVx(data) {
  return ((data && data.media_extended) || []).filter((m) => m && (m.type === "video" || m.type === "gif")).map((m) => ({
    type: m.type === "gif" ? "animated_gif" : "video",
    poster: twimgImage(m.thumbnail_url),
    variants: cleanVariants([{ url: m.url, bitrate: 1 }]),
    duration: Number(m.duration_millis) || 0
  })).filter((m) => m.variants.length);
}

async function getJson(fetcher, url) {
  assertNotPaidX(url);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetcher(url, { headers: { accept: "application/json", "user-agent": UA }, signal: controller ? controller.signal : undefined });
    if (!res || !res.ok) return null;
    const text = await res.text();
    if (!text || text.length > 2_000_000) return null;
    return JSON.parse(text);
  } catch (err) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveXVideo(id, fetcher) {
  const steps = [
    ["syndication", "https://cdn.syndication.twimg.com/tweet-result?id=" + id + "&lang=en&token=" + syndicationToken(id), fromSyndication],
    ["fxtwitter", "https://api.fxtwitter.com/2/status/" + id, fromFx],
    ["vxtwitter", "https://api.vxtwitter.com/Twitter/status/" + id, fromVx]
  ];
  for (const [source, url, parse] of steps) {
    const data = await getJson(fetcher, url);
    const media = data ? parse(data) : [];
    if (media.length) return { id: id, source: source, media: media };
  }
  return null;
}

export async function handleXVideo(request, deps) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "");
  if (!/^\d{6,25}$/.test(id)) return reply(400, { error: "id" });
  const cache = deps && deps.cache;
  const key = new Request("https://xv.cache/v1/" + id);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch (err) { /* a cache miss is fine */ }
  }
  const found = await resolveXVideo(id, (deps && deps.fetch) || fetch);
  const res = found ? reply(200, found, OK_TTL_S) : reply(200, { id: id, none: true, media: [] }, MISS_TTL_S);
  if (cache) {
    const put = cache.put(key, res.clone()).catch(() => null);
    if (deps.waitUntil) deps.waitUntil(put);
  }
  return res;
}
