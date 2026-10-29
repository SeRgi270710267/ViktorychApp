/* Public comment pages, fetched once and kept at the edge for a short time.
   GET /v1/comments?src=x|bsky|yt|reddit&id=...&sort=top|new&cursor=...
   Only hosts the app already reads directly are used. Nothing is stored past
   the edge cache: no R2, no KV, no logs of who asked. */

export const COMMENTS_TTL_S = 90;
export const COMMENTS_FAIL_TTL_S = 30;
const FX = "https://api.fxtwitter.com";
const BSKY = "https://public.api.bsky.app";
const IV_SEEDS = ["https://yt.chocolatemoo53.com", "https://invidious.tiekoetter.com", "https://invidious.nerdvpn.de", "https://inv.nadeko.net"];
const REDDIT = "https://www.reddit.com";
const UPSTREAM_MS = 6000;

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

function cleanId(src, raw) {
  const id = String(raw || "");
  if (src === "x") return /^\d{1,25}$/.test(id) ? id : "";
  if (src === "yt") return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
  if (src === "reddit") {
    const bare = id.replace(/^t3_/, "");
    return /^[a-z0-9]{1,12}$/i.test(bare) ? bare.toLowerCase() : "";
  }
  if (src === "bsky") return /^at:\/\/did:[a-z0-9:._-]{1,200}\/app\.bsky\.feed\.post\/[a-z0-9]{1,40}$/i.test(id) ? id : "";
  return "";
}

/* Author bios, banners and raw facets are most of an fxtwitter page and the
   reply list never shows them. */
const FX_AUTHOR_DROP = ["description", "raw_description", "location", "banner_url", "website", "url", "following", "likes", "media_count", "statuses"];
function slimFx(node, depth) {
  if (!node || typeof node !== "object" || depth > 4) return node;
  if (Array.isArray(node)) return node.map((item) => slimFx(item, depth + 1));
  const out = {};
  Object.keys(node).forEach((key) => {
    if (key === "raw_text") return;
    const value = node[key];
    if (key === "author" && value && typeof value === "object" && !Array.isArray(value)) {
      const author = {};
      Object.keys(value).forEach((k) => { if (FX_AUTHOR_DROP.indexOf(k) < 0) author[k] = value[k]; });
      out[key] = author;
      return;
    }
    out[key] = slimFx(value, depth + 1);
  });
  return out;
}

function targets(src, id, sort, cursor) {
  const newest = sort === "new";
  if (src === "x") {
    const q = new URLSearchParams();
    if (newest) q.set("ranking_mode", "recency");
    if (cursor) q.set("cursor", cursor);
    const s = q.toString();
    return [FX + "/2/conversation/" + id + (s ? "?" + s : "")];
  }
  if (src === "bsky") {
    return [BSKY + "/xrpc/app.bsky.feed.getPostThread?uri=" + encodeURIComponent(id) + "&depth=2&parentHeight=0"];
  }
  if (src === "reddit") {
    return [REDDIT + "/comments/" + id + ".json?limit=20&depth=2&raw_json=1&sort=" + (newest ? "new" : "top")];
  }
  if (src === "yt") {
    let path = "/api/v1/comments/" + id + "?sort_by=" + (newest ? "new" : "top");
    if (cursor) path += "&continuation=" + encodeURIComponent(cursor);
    return IV_SEEDS.map((base) => base + path);
  }
  return [];
}

function usable(src, body) {
  if (!body || typeof body !== "object") return false;
  if (src === "x") return !!(body.status || (Array.isArray(body.replies) && body.replies.length)) && (body.code == null || Number(body.code) === 200);
  if (src === "bsky") return !!body.thread;
  if (src === "reddit") return Array.isArray(body) && body.length >= 2;
  if (src === "yt") return Array.isArray(body.comments);
  return false;
}

async function pull(url, deps) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), UPSTREAM_MS) : null;
  try {
    const res = await deps.fetch(url, {
      headers: { accept: "application/json", "user-agent": "ViktorychComments/1.0 (+public read)" },
      signal: ctrl ? ctrl.signal : undefined,
      cf: { cacheTtl: COMMENTS_TTL_S, cacheEverything: true }
    });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleComments(request, deps) {
  const url = new URL(request.url);
  const src = String(url.searchParams.get("src") || "");
  const id = cleanId(src, url.searchParams.get("id"));
  if (!id) return reply(400, { error: "bad_request" });
  const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
  const cursor = String(url.searchParams.get("cursor") || "").slice(0, 600);
  const cacheReq = new Request("https://comments.cache/v1/" + src + "/" + encodeURIComponent(id) + "/" + sort + "/" + encodeURIComponent(cursor));
  const cache = deps.cache;
  if (cache) {
    const hit = await cache.match(cacheReq);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("x-comments-cache", "hit");
      return res;
    }
  }
  let body = null;
  let from = "";
  for (const target of targets(src, id, sort, cursor)) {
    const got = await pull(target, deps);
    if (usable(src, got)) {
      body = got;
      from = new URL(target).hostname;
      break;
    }
  }
  const at = deps.now ? deps.now() : Date.now();
  const res = body
    ? reply(200, { src: src, id: id, sort: sort, from: from, at: at, data: src === "x" ? slimFx(body, 0) : body }, COMMENTS_TTL_S)
    : reply(502, { error: "upstream", src: src }, COMMENTS_FAIL_TTL_S);
  res.headers.set("x-comments-cache", "miss");
  if (cache) {
    const put = cache.put(cacheReq, res.clone()).catch(() => {});
    if (deps.waitUntil) deps.waitUntil(put); else await put;
  }
  return res;
}

export const _test = { cleanId, slimFx, targets, usable };
