/* GET /v1/ext-graph/x?handle=&tab=following|followers&cursor=
   GET /v1/ext-graph/youtube?channel=&cursor=

   Who an external account follows (and, where the source allows it, who
   follows it), read live for the profile page's Following / Followers tabs.
   Bluesky, Mastodon and Nostr are read straight from the browser; this route
   only covers sources that send no CORS headers (Nitter-style X mirrors) or
   need a key that stays on the server (YouTube Data API).

   Nothing is stored: the edge cache keeps one page for a few minutes so a
   reload or a second viewer costs no upstream fetch, and a miss is cached
   briefly so a dead source is not hammered. No D1, no R2, no KV. Upstream
   fetches are capped per isolate per minute to stay gentle with the free
   mirrors and the shared YouTube quota. */

export const GRAPH_TTL_S = 10 * 60;
export const GRAPH_MISS_TTL_S = 2 * 60;
const YT_TTL_S = 30 * 60;
const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1024 * 1024;
const PER_MINUTE = 40;
const YT_PER_DAY = 400;

/* Public Nitter-style mirrors that still serve /<user>/following. Most of
   them come and go; an owner may put a comma list in NITTER_BASES (a plain
   variable, not a secret) and those are tried first. */
export const NITTER_BASES = [
  "https://nitter.jaydenha.uk",
  "https://nitter.meowing.monster",
  "https://nitter.kareem.one",
  "https://nitter.privacyredirect.com",
  "https://nitter.tiekoetter.com",
  "https://nitter.net"
];

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const CURSOR = /^[A-Za-z0-9_|%=.:-]{1,300}$/;

let windowStart = 0;
let windowCount = 0;
let ytDay = "";
let ytCount = 0;
let ytOutUntil = 0;
const deadUntil = {};

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

function budget(now) {
  if (now - windowStart > 60 * 1000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= PER_MINUTE) return false;
  windowCount += 1;
  return true;
}

export function resetGraphState() {
  windowStart = 0;
  windowCount = 0;
  ytDay = "";
  ytCount = 0;
  ytOutUntil = 0;
  Object.keys(deadUntil).forEach((key) => { delete deadUntil[key]; });
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

export function decodeEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, name) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] != null) return ENTITIES[key];
    if (key[0] === "#") {
      const code = key[1] === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch (_) { return ""; }
      }
    }
    return all;
  });
}

function plain(html) {
  return decodeEntities(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "")).replace(/[ \t]+\n/g, "\n").trim();
}

/* A mirror serves avatars through its own /pic/ path. Point back at X's
   image host so the app's media rules (and relay) apply as for any post. */
export function avatarFrom(src) {
  let raw = String(src || "");
  const pic = raw.match(/\/pic\/(.+)$/);
  if (pic) {
    raw = pic[1];
    try { raw = decodeURIComponent(raw); } catch (_) { /* keep */ }
    if (/^orig\//.test(raw)) raw = raw.slice(5);
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw.replace(/^\/+/, "");
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/(^|\.)twimg\.com$/i.test(url.hostname)) return "";
    return url.href.replace(/_(?:mini|normal)\.(jpe?g|png|webp)$/i, "_bigger.$1");
  } catch (_) {
    return "";
  }
}

/* One page of a Nitter people list: rows and the "Load more" cursor. */
export function parseNitterList(html) {
  const text = String(html || "");
  const items = [];
  const seen = {};
  const parts = text.split(/<div class="timeline-item(?=[\s"])[^"]*"/).slice(1);
  parts.forEach((part) => {
    const block = part.split(/<div class="(?:timeline-item|show-more|top-ref)[\s"]/)[0];
    const user = (block.match(/class="username"[^>]*title="@([A-Za-z0-9_]{1,15})"/) || block.match(/class="username"[^>]*>@([A-Za-z0-9_]{1,15})</) || block.match(/data-username="([A-Za-z0-9_]{1,15})"/) || [])[1] || "";
    if (!user || seen[user.toLowerCase()]) return;
    seen[user.toLowerCase()] = true;
    const name = plain((block.match(/class="fullname"[^>]*title="([^"]*)"/) || block.match(/class="fullname"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "") || user;
    const img = (block.match(/class="tweet-avatar"[\s\S]*?<img[^>]*src="([^"]+)"/) || [])[1] || "";
    const bio = plain((block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    const verified = /verified-icon\s+(blue|business|government)/.exec(block);
    const row = { handle: user, name: name, avatar: avatarFrom(decodeEntities(img)), bio: bio.slice(0, 400) };
    if (verified) row.verifiedType = verified[1];
    if (/icon-lock/.test(block)) row.protected = true;
    items.push(row);
  });
  let cursor = "";
  const more = text.match(/class="show-more"[^>]*>\s*<a href="[^"]*[?&]cursor=([^"&]+)"/);
  if (more) {
    try { cursor = decodeURIComponent(decodeEntities(more[1])); } catch (_) { cursor = decodeEntities(more[1]); }
  }
  const stat = (label) => {
    const m = text.match(new RegExp('profile-stat-header">' + label + '</span>\\s*<span class="profile-stat-num">([0-9,.]+)<'));
    return m ? Number(m[1].replace(/[^0-9]/g, "")) : null;
  };
  const isList = /class="timeline[" ]/.test(text) && /<title>\s*(?:People followed by|People following|Followers of|Following)\b/i.test(text);
  const protectedProfile = /This account's tweets are protected|is protected/i.test(text) && !items.length;
  return { items: items, cursor: cursor, following: stat("Following"), followers: stat("Followers"), isList: isList || items.length > 0, protected: protectedProfile };
}

async function readCapped(res) {
  const text = await res.text();
  return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
}

function timed(deps, url, init) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : 0;
  return Promise.resolve(deps.fetch(url, Object.assign({}, init || {}, ctrl ? { signal: ctrl.signal } : {}))).finally(() => { if (timer) clearTimeout(timer); });
}

function nitterBases(env) {
  const extra = String((env && env.NITTER_BASES) || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^https:\/\/[a-z0-9.-]+$/i.test(s));
  const out = [];
  extra.concat(NITTER_BASES).forEach((base) => { if (out.indexOf(base) < 0) out.push(base); });
  return out;
}

async function cached(deps, key) {
  if (!deps.cache) return null;
  try { return await deps.cache.match(new Request("https://ext-graph.cache/" + key)); } catch (_) { return null; }
}

async function keep(deps, key, res) {
  if (!deps.cache) return;
  try { await deps.cache.put(new Request("https://ext-graph.cache/" + key), res.clone()); } catch (_) { /* best effort */ }
}

async function handleX(url, env, deps) {
  const handle = String(url.searchParams.get("handle") || "").replace(/^@/, "");
  const tab = url.searchParams.get("tab") === "followers" ? "followers" : "following";
  const cursor = String(url.searchParams.get("cursor") || "");
  if (!HANDLE.test(handle)) return reply(400, { error: "bad_handle" });
  if (cursor && !CURSOR.test(cursor)) return reply(400, { error: "bad_cursor" });
  const key = "x/" + tab + "/" + handle.toLowerCase() + "/" + encodeURIComponent(cursor);
  const hit = await cached(deps, key);
  if (hit) return hit;
  const now = deps.now ? deps.now() : Date.now();
  const bases = nitterBases(env).filter((base) => !(deadUntil[base] > now));
  for (const base of bases) {
    if (!budget(now)) return reply(200, { items: [], cursor: "", unavailable: "busy" });
    const target = base + "/" + encodeURIComponent(handle) + "/" + tab + (cursor ? "?cursor=" + encodeURIComponent(cursor) : "");
    let page = null;
    try {
      const res = await timed(deps, target, { headers: { accept: "text/html", "user-agent": "ViktorychApp/1.0 (+https://viktorychgroup.github.io/ViktorychApp)" }, redirect: "follow" });
      if (res.ok) page = parseNitterList(await readCapped(res));
      else if (res.status === 404) {
        const out = reply(200, { items: [], cursor: "", missing: true, source: "nitter" }, GRAPH_MISS_TTL_S);
        await keep(deps, key, out);
        return out;
      }
    } catch (_) {
      page = null;
    }
    if (!page || !page.isList) {
      deadUntil[base] = now + 10 * 60 * 1000;
      continue;
    }
    const body = { items: page.items, cursor: page.cursor && page.cursor !== cursor ? page.cursor : "", source: "nitter" };
    if (page.following != null) body.following = page.following;
    if (page.followers != null) body.followers = page.followers;
    if (page.protected) body.hidden = true;
    const out = reply(200, body, GRAPH_TTL_S);
    await keep(deps, key, out);
    return out;
  }
  const out = reply(200, { items: [], cursor: "", unavailable: "sources_down" }, GRAPH_MISS_TTL_S);
  await keep(deps, key, out);
  return out;
}

function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function handleYouTube(url, env, deps) {
  const channel = String(url.searchParams.get("channel") || "");
  const cursor = String(url.searchParams.get("cursor") || "");
  if (!CHANNEL.test(channel)) return reply(400, { error: "bad_channel" });
  if (cursor && !/^[A-Za-z0-9_-]{1,100}$/.test(cursor)) return reply(400, { error: "bad_cursor" });
  const key = "yt/" + channel + "/" + cursor;
  const hit = await cached(deps, key);
  if (hit) return hit;
  if (!env || !env.YT_API_KEY) return reply(200, { items: [], cursor: "", unavailable: "no_key" });
  const now = deps.now ? deps.now() : Date.now();
  if (ytDay !== utcDay(now)) { ytDay = utcDay(now); ytCount = 0; }
  if (ytOutUntil > now || ytCount >= YT_PER_DAY || !budget(now)) return reply(200, { items: [], cursor: "", unavailable: "busy" });
  ytCount += 1;
  const qs = new URLSearchParams({ part: "snippet", channelId: channel, maxResults: "50", order: "alphabetical", key: env.YT_API_KEY });
  if (cursor) qs.set("pageToken", cursor);
  let res;
  try {
    res = await timed(deps, "https://www.googleapis.com/youtube/v3/subscriptions?" + qs.toString(), { headers: { accept: "application/json" } });
  } catch (_) {
    return reply(200, { items: [], cursor: "", unavailable: "network" });
  }
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  const reason = JSON.stringify((data && data.error && data.error.errors) || "");
  if (res.status === 403 && /subscriptionForbidden/i.test(reason)) {
    const out = reply(200, { items: [], cursor: "", hidden: true, source: "youtube" }, YT_TTL_S);
    await keep(deps, key, out);
    return out;
  }
  if (res.status === 403 || res.status === 429) {
    if (/quota|rateLimit/i.test(reason) || res.status === 429) ytOutUntil = now + 60 * 60 * 1000;
    return reply(200, { items: [], cursor: "", unavailable: "busy" });
  }
  if (res.status === 404) {
    const out = reply(200, { items: [], cursor: "", missing: true, source: "youtube" }, YT_TTL_S);
    await keep(deps, key, out);
    return out;
  }
  if (!res.ok || !data) return reply(200, { items: [], cursor: "", unavailable: "upstream" });
  const items = (data.items || []).map((it) => {
    const sn = (it && it.snippet) || {};
    const id = sn.resourceId && sn.resourceId.channelId;
    if (!CHANNEL.test(String(id || ""))) return null;
    const thumbs = sn.thumbnails || {};
    const pic = (thumbs.medium || thumbs.default || thumbs.high || {}).url || "";
    return { channelId: id, name: String(sn.title || "").slice(0, 200), avatar: /^https:\/\//.test(pic) ? pic : "", bio: String(sn.description || "").slice(0, 400) };
  }).filter(Boolean);
  const body = { items: items, cursor: data.nextPageToken || "", source: "youtube" };
  if (data.pageInfo && data.pageInfo.totalResults != null) body.following = Number(data.pageInfo.totalResults) || 0;
  const out = reply(200, body, YT_TTL_S);
  await keep(deps, key, out);
  return out;
}

export async function handleExtGraph(request, env, deps) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/v1/ext-graph/x") return handleX(url, env, deps);
  if (path === "/v1/ext-graph/youtube") return handleYouTube(url, env, deps);
  return reply(404, { error: "not_found" });
}
