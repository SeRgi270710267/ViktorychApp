/* ViktorychMusic catalog: YouTube search and browse data for the music pages.
   GET /v1/ytm/config            which lanes are set up (no secrets returned)
   GET /v1/ytm/search?q=&type=   type: all | song | artist | album | playlist
   GET /v1/ytm/match?q=          one best song for "title artist" (imports)
   GET /v1/ytm/videos?ids=a,b    track details for up to 50 ids
   GET /v1/ytm/playlist?id=      a playlist or album with its tracks
   GET /v1/ytm/artist?id=        a channel: top songs, albums, related artists
   GET /v1/ytm/charts?region=    most popular music videos in a region
   GET /v1/ytm/new?region=       new music from the last two weeks
   GET /v1/ytm/mood?key=         playlists for one mood or genre
   GET /v1/ytm/radio?id=         a mix that starts from one song
   GET /v1/ytm/spotify?id=       public Spotify playlist titles (import)

   Playback never touches this Worker: the page plays every track in the
   official YouTube embed. Only metadata comes through here.

   Quota: the YouTube Data API v3 key (YT_API_KEY secret) has 10,000 units a
   day and one search costs 100. Every answer is cached at the edge and in R2
   (ytm/<sha>.json) for hours, so one search serves every user that day. When
   the key is missing, out of quota or failing, the same answers are read from
   YouTube's public pages, then from public Invidious instances. Metadata is
   never kept past 30 days, as the YouTube API policies require. */

const API = "https://www.googleapis.com/youtube/v3/";
const WEB = "https://www.youtube.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IV_BASES = ["https://inv.nadeko.net", "https://invidious.tiekoetter.com", "https://yt.chocolatemoo53.com"];
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const MAX_PAGE = 3_000_000;
const HOUR = 3600;
export const YTM_TTL = {
  search: 12 * HOUR, match: 7 * 24 * HOUR, videos: 3 * 24 * HOUR, playlist: 6 * HOUR, artist: 12 * HOUR,
  charts: 6 * HOUR, chartid: 7 * 24 * HOUR, new: 12 * HOUR, mood: 24 * HOUR, radio: 12 * HOUR, spotify: HOUR
};
export const MOODS = {
  chill: "chill music", focus: "focus music", workout: "workout music", party: "party hits", sleep: "sleep music",
  romance: "love songs", sad: "sad songs", feelgood: "feel good music", commute: "driving music", energy: "energy boost music",
  pop: "pop hits", hiphop: "hip hop hits", rock: "rock hits", electronic: "electronic dance music", latin: "latin hits",
  kpop: "k-pop hits", bollywood: "bollywood hits", russian: "русские хиты", jazz: "jazz classics", classical: "classical music",
  country: "country hits", indie: "indie hits", metal: "metal hits", rnb: "r&b hits"
};
const MAX_AGE_DAYS = 30;

/* Out of quota until the next reset (midnight Pacific, about 08:00 UTC). */
let quotaOutUntil = 0;
let spotifyToken = { value: "", until: 0 };

export function resetYtmState() { quotaOutUntil = 0; spotifyToken = { value: "", until: 0 }; }

function reply(status, body, maxAge) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? "public, max-age=" + Math.min(maxAge, 6 * HOUR) : "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

async function sha(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

export function parseDuration(iso) {
  const m = String(iso || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

export function parseClock(text) {
  const parts = String(text || "").trim().split(":").map((p) => Number(p));
  if (!parts.length || parts.some((n) => !isFinite(n))) return 0;
  return parts.reduce((sum, n) => sum * 60 + n, 0);
}

function clip(text, n) { return String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, n || 200); }

/* "Artist - Topic" channels carry the clean artist name. */
export function cleanArtist(name) { return clip(String(name || "").replace(/\s+-\s+Topic$/i, "").replace(/VEVO$/, ""), 120); }

export function cover(id) { return VIDEO_ID.test(id) ? "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg" : ""; }

function bestThumb(thumbs) {
  if (!thumbs) return "";
  const list = Array.isArray(thumbs) ? thumbs : Object.keys(thumbs).map((k) => thumbs[k]);
  let best = "";
  let width = 0;
  list.forEach((t) => {
    if (!t || !t.url) return;
    const w = Number(t.width) || 1;
    if (w > width && w <= 480) { width = w; best = t.url; }
    else if (!best) best = t.url;
  });
  if (best.indexOf("//") === 0) best = "https:" + best;
  return best.indexOf("https://") === 0 ? best : "";
}

export function track(id, title, artist, channelId, duration, extra) {
  if (!VIDEO_ID.test(String(id || ""))) return null;
  const out = { id: String(id), title: clip(title, 200), artist: cleanArtist(artist), cover: cover(id), duration: Math.max(0, Math.round(Number(duration) || 0)) };
  if (CHANNEL_ID.test(String(channelId || ""))) out.channelId = channelId;
  if (extra && extra.album) out.album = clip(extra.album, 200);
  return out;
}

export function collectionKind(id) { return /^OLAK5uy_/.test(String(id || "")) || /^MPREb/.test(String(id || "")) ? "album" : "playlist"; }

/* ---------- YouTube Data API lane ---------- */

async function api(deps, env, path, params) {
  if (!env.YT_API_KEY) throw Object.assign(new Error("no_key"), { lane: "key" });
  if (quotaOutUntil > deps.now()) throw Object.assign(new Error("quota"), { lane: "key" });
  const qs = new URLSearchParams(params);
  qs.set("key", env.YT_API_KEY);
  const res = await deps.fetch(API + path + "?" + qs.toString(), { headers: { accept: "application/json" } });
  if (res.status === 403 || res.status === 429) {
    let reason = "";
    try { const body = await res.json(); reason = JSON.stringify(body && body.error && body.error.errors || ""); } catch (_) {}
    if (/quota|rateLimit/i.test(reason) || res.status === 429) {
      const now = new Date(deps.now());
      const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0);
      quotaOutUntil = reset > deps.now() ? reset : reset + 86400000;
    }
    throw Object.assign(new Error("api_" + res.status), { lane: "key" });
  }
  if (!res.ok) throw Object.assign(new Error("api_" + res.status), { lane: "key" });
  return res.json();
}

async function apiDetails(deps, env, ids) {
  const clean = ids.filter((id) => VIDEO_ID.test(id)).slice(0, 50);
  if (!clean.length) return [];
  const data = await api(deps, env, "videos", { part: "snippet,contentDetails", id: clean.join(","), maxResults: "50" });
  const byId = {};
  (data.items || []).forEach((it) => {
    const sn = it.snippet || {};
    byId[it.id] = track(it.id, sn.title, sn.channelTitle, sn.channelId, parseDuration(it.contentDetails && it.contentDetails.duration));
  });
  return clean.map((id) => byId[id]).filter(Boolean);
}

async function apiSearch(deps, env, q, type, extra) {
  const params = Object.assign({ part: "snippet", q, maxResults: "20", safeSearch: "none" }, extra || {});
  if (type === "song") { params.type = "video"; params.videoCategoryId = "10"; }
  else if (type === "artist") params.type = "channel";
  else if (type === "album" || type === "playlist") params.type = "playlist";
  else params.type = "video,channel,playlist";
  if (type === "album") params.q = q + " album";
  const data = await api(deps, env, "search", params);
  const out = { songs: [], artists: [], collections: [] };
  const videoIds = [];
  (data.items || []).forEach((it) => {
    const id = it.id || {};
    const sn = it.snippet || {};
    if (id.videoId) videoIds.push(id.videoId);
    else if (id.channelId) out.artists.push({ id: id.channelId, name: cleanArtist(sn.title), cover: bestThumb(sn.thumbnails) });
    else if (id.playlistId) out.collections.push({ id: id.playlistId, kind: collectionKind(id.playlistId), title: clip(sn.title), owner: cleanArtist(sn.channelTitle), cover: bestThumb(sn.thumbnails) });
  });
  if (videoIds.length) out.songs = await apiDetails(deps, env, videoIds);
  return out;
}

async function apiPlaylist(deps, env, id) {
  const meta = await api(deps, env, "playlists", { part: "snippet,contentDetails", id });
  const head = (meta.items || [])[0];
  if (!head) return null;
  const ids = [];
  let token = "";
  for (let page = 0; page < 2; page++) {
    const params = { part: "contentDetails", playlistId: id, maxResults: "50" };
    if (token) params.pageToken = token;
    const items = await api(deps, env, "playlistItems", params);
    (items.items || []).forEach((it) => { if (it.contentDetails && it.contentDetails.videoId) ids.push(it.contentDetails.videoId); });
    token = items.nextPageToken || "";
    if (!token) break;
  }
  let tracks = [];
  for (let i = 0; i < ids.length; i += 50) tracks = tracks.concat(await apiDetails(deps, env, ids.slice(i, i + 50)));
  const sn = head.snippet || {};
  return { id, kind: collectionKind(id), title: clip(sn.title), owner: cleanArtist(sn.channelTitle), ownerId: sn.channelId || "", cover: bestThumb(sn.thumbnails), count: Number(head.contentDetails && head.contentDetails.itemCount) || tracks.length, tracks };
}

async function apiArtist(deps, env, id) {
  const ch = await api(deps, env, "channels", { part: "snippet,contentDetails,statistics", id });
  const head = (ch.items || [])[0];
  if (!head) return null;
  const sn = head.snippet || {};
  const out = { id, name: cleanArtist(sn.title), cover: bestThumb(sn.thumbnails), about: clip(sn.description, 400), subscribers: Number(head.statistics && head.statistics.subscriberCount) || 0, top: [], albums: [], related: [] };
  /* UULP is the channel's popular uploads; UU is every upload. */
  const tail = id.slice(2);
  for (const list of ["UULP" + tail, "UU" + tail]) {
    try {
      const items = await api(deps, env, "playlistItems", { part: "contentDetails", playlistId: list, maxResults: "20" });
      const ids = (items.items || []).map((it) => it.contentDetails && it.contentDetails.videoId).filter(Boolean);
      if (ids.length) { out.top = await apiDetails(deps, env, ids); break; }
    } catch (err) { /* try the next list */ }
  }
  try {
    const lists = await api(deps, env, "playlists", { part: "snippet,contentDetails", channelId: id, maxResults: "25" });
    out.albums = (lists.items || []).map((it) => ({ id: it.id, kind: collectionKind(it.id), title: clip(it.snippet && it.snippet.title), owner: out.name, cover: bestThumb(it.snippet && it.snippet.thumbnails), count: Number(it.contentDetails && it.contentDetails.itemCount) || 0 }));
  } catch (err) { /* albums stay empty */ }
  try {
    const sections = await api(deps, env, "channelSections", { part: "contentDetails", channelId: id });
    const ids = [];
    (sections.items || []).forEach((s) => ((s.contentDetails && s.contentDetails.channels) || []).forEach((c) => { if (CHANNEL_ID.test(c) && ids.indexOf(c) < 0 && c !== id) ids.push(c); }));
    if (ids.length) {
      const rel = await api(deps, env, "channels", { part: "snippet", id: ids.slice(0, 20).join(",") });
      out.related = (rel.items || []).map((it) => ({ id: it.id, name: cleanArtist(it.snippet && it.snippet.title), cover: bestThumb(it.snippet && it.snippet.thumbnails) }));
    }
  } catch (err) { /* related stays empty */ }
  return out;
}

async function apiCharts(deps, env, region) {
  const data = await api(deps, env, "videos", { part: "snippet,contentDetails", chart: "mostPopular", videoCategoryId: "10", regionCode: region, maxResults: "50" });
  return (data.items || []).map((it) => track(it.id, it.snippet && it.snippet.title, it.snippet && it.snippet.channelTitle, it.snippet && it.snippet.channelId, parseDuration(it.contentDetails && it.contentDetails.duration))).filter(Boolean);
}

/* ---------- Public page lane ---------- */

export function initialData(html) {
  const text = String(html || "");
  const marks = ["var ytInitialData = ", "window[\"ytInitialData\"] = ", "ytInitialData = "];
  let start = -1;
  for (const mark of marks) {
    const at = text.indexOf(mark);
    if (at >= 0) { start = at + mark.length; break; }
  }
  if (start < 0) return null;
  while (start < text.length && text[start] !== "{") start++;
  let depth = 0;
  let quote = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") quote = false;
      continue;
    }
    if (ch === "\"") quote = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (err) { return null; }
      }
    }
  }
  return null;
}

function runs(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.simpleText) return node.simpleText;
  if (node.content) return node.content;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
  return "";
}

function runChannel(node) {
  const list = node && Array.isArray(node.runs) ? node.runs : [];
  for (const r of list) {
    const id = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint && r.navigationEndpoint.browseEndpoint.browseId;
    if (id && CHANNEL_ID.test(id)) return id;
  }
  return "";
}

/* Walks the page data once and keeps the renderers the music pages use. */
export function pageItems(data, fallbackArtist, fallbackChannel) {
  const out = { songs: [], artists: [], collections: [] };
  const seen = {};
  const stack = [data];
  let steps = 0;
  while (stack.length && steps++ < 400000) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]); continue; }
    const v = node.videoRenderer || node.playlistVideoRenderer || node.playlistPanelVideoRenderer || node.compactVideoRenderer || node.gridVideoRenderer;
    if (v && v.videoId && !seen["v" + v.videoId]) {
      seen["v" + v.videoId] = 1;
      const by = v.ownerText || v.shortBylineText || v.longBylineText;
      const t = track(v.videoId, runs(v.title), runs(by).split(" • ")[0], runChannel(by), v.lengthSeconds ? Number(v.lengthSeconds) : parseClock(runs(v.lengthText)));
      if (t) out.songs.push(t);
      continue;
    }
    const c = node.channelRenderer;
    if (c && c.channelId && !seen["c" + c.channelId]) {
      seen["c" + c.channelId] = 1;
      out.artists.push({ id: c.channelId, name: cleanArtist(runs(c.title)), cover: bestThumb(c.thumbnail && c.thumbnail.thumbnails) });
      continue;
    }
    const p = node.playlistRenderer || node.gridPlaylistRenderer;
    if (p && p.playlistId && !seen["p" + p.playlistId]) {
      seen["p" + p.playlistId] = 1;
      const thumbs = (p.thumbnails && p.thumbnails[0] && p.thumbnails[0].thumbnails) || (p.thumbnail && p.thumbnail.thumbnails);
      out.collections.push({ id: p.playlistId, kind: collectionKind(p.playlistId), title: clip(runs(p.title)), owner: cleanArtist(runs(p.shortBylineText || p.longBylineText)), cover: bestThumb(thumbs), count: Number(String(p.videoCount || runs(p.videoCountText) || "0").replace(/\D/g, "")) || 0 });
      continue;
    }
    const l = node.lockupViewModel;
    if (l && l.contentId && /VIDEO/.test(String(l.contentType || "")) && !seen["v" + l.contentId]) {
      seen["v" + l.contentId] = 1;
      const meta = l.metadata && l.metadata.lockupMetadataViewModel;
      const rows = (meta && meta.metadata && meta.metadata.contentMetadataViewModel && meta.metadata.contentMetadataViewModel.metadataRows) || [];
      const first = rows[0] && rows[0].metadataParts && rows[0].metadataParts[0] && rows[0].metadataParts[0].text;
      const by = rows.length > 1 && first ? String(first.content || "") : (fallbackArtist || "");
      const ch = (JSON.stringify((meta && meta.metadata) || {}).match(/"browseId":"(UC[A-Za-z0-9_-]{22})"/) || [])[1] || fallbackChannel || "";
      const clock = (JSON.stringify(l.contentImage || {}).match(/"text":"(\d{1,2}(?::\d{2}){1,2})"/) || [])[1] || "";
      const t = track(l.contentId, meta && meta.title && meta.title.content, by, ch, parseClock(clock));
      if (t) out.songs.push(t);
      continue;
    }
    if (l && l.contentId && /PLAYLIST|ALBUM/.test(String(l.contentType || "")) && !seen["p" + l.contentId]) {
      seen["p" + l.contentId] = 1;
      const meta = l.metadata && l.metadata.lockupMetadataViewModel;
      const img = JSON.stringify(l.contentImage || {}).match(/"url":"(https:\/\/i\.ytimg\.com[^"]+)"/);
      out.collections.push({ id: l.contentId, kind: collectionKind(l.contentId), title: clip(meta && meta.title && meta.title.content), owner: "", cover: img ? img[1] : "", count: 0 });
      continue;
    }
    for (const key in node) {
      const child = node[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return out;
}

async function page(deps, url) {
  const res = await deps.fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "SOCS=CAI; CONSENT=YES+1" } });
  if (!res.ok) throw Object.assign(new Error("page_" + res.status), { lane: "page" });
  const text = await res.text();
  const data = initialData(text.slice(0, MAX_PAGE));
  if (!data) throw Object.assign(new Error("page_shape"), { lane: "page" });
  return { data, text };
}

const SEARCH_FILTER = { song: "EgIQAQ%3D%3D", artist: "EgIQAg%3D%3D", playlist: "EgIQAw%3D%3D", album: "EgIQAw%3D%3D" };

async function pageSearch(deps, q, type) {
  const filter = SEARCH_FILTER[type] ? "&sp=" + SEARCH_FILTER[type] : "";
  const query = type === "album" ? q + " album" : type === "song" ? q : q;
  const got = await page(deps, WEB + "results?search_query=" + encodeURIComponent(query) + filter + "&hl=en");
  const items = pageItems(got.data);
  items.songs = items.songs.slice(0, 20);
  items.artists = items.artists.slice(0, 20);
  items.collections = items.collections.slice(0, 20);
  return items;
}

async function pagePlaylist(deps, id) {
  const got = await page(deps, WEB + "playlist?list=" + encodeURIComponent(id) + "&hl=en");
  const items = pageItems(got.data);
  const md = got.data.metadata && got.data.metadata.playlistMetadataRenderer;
  const ph = got.data.header && got.data.header.pageHeaderRenderer;
  const header = JSON.stringify(got.data.header || got.data.metadata || {});
  const title = (md && md.title) || (ph && ph.pageTitle) || (header.match(/"title":\{"simpleText":"([^"]{1,200})"/) || header.match(/"title":"([^"]{1,200})"/) || header.match(/"content":"([^"]{1,200})"/) || [])[1] || "";
  return { id, kind: collectionKind(id), title: clip(title.replace(/\\u0026/g, "&").replace(/\\"/g, "\"")), owner: "", cover: items.songs[0] ? items.songs[0].cover : "", count: items.songs.length, tracks: items.songs.slice(0, 100) };
}

async function pageRadio(deps, id) {
  const got = await page(deps, WEB + "watch?v=" + encodeURIComponent(id) + "&list=RD" + encodeURIComponent(id) + "&hl=en");
  const panel = got.data && got.data.contents && got.data.contents.twoColumnWatchNextResults && got.data.contents.twoColumnWatchNextResults.playlist;
  const items = pageItems(panel || got.data);
  return items.songs.slice(0, 50);
}

async function pageArtist(deps, id) {
  const got = await page(deps, WEB + "channel/" + encodeURIComponent(id) + "/videos?view=0&sort=p&hl=en");
  const meta = got.data.metadata && got.data.metadata.channelMetadataRenderer;
  const items = pageItems(got.data, meta && meta.title, id);
  return { id, name: cleanArtist(meta && meta.title), cover: bestThumb(meta && meta.avatar && meta.avatar.thumbnails), about: clip(meta && meta.description, 400), subscribers: 0, top: items.songs.slice(0, 20), albums: items.collections.slice(0, 25), related: items.artists.filter((a) => a.id !== id).slice(0, 20) };
}

/* Titles for saved tracks when there is no key: oEmbed is public and free. */
async function oembedDetails(deps, ids) {
  const out = await Promise.all(ids.map(async (id) => {
    try {
      const res = await deps.fetch(WEB + "oembed?format=json&url=" + encodeURIComponent(WEB + "watch?v=" + id), { headers: { "user-agent": UA } });
      if (!res.ok) return null;
      const data = await res.json();
      return track(id, data && data.title, data && data.author_name, "", 0);
    } catch (err) { return null; }
  }));
  return out.filter(Boolean);
}

/* ---------- Invidious lane (last) ---------- */

async function ivSearch(deps, q, type) {
  const kind = type === "artist" ? "channel" : (type === "album" || type === "playlist") ? "playlist" : "video";
  for (const base of IV_BASES) {
    try {
      const res = await deps.fetch(base + "/api/v1/search?type=" + kind + "&q=" + encodeURIComponent(q), { headers: { "user-agent": UA } });
      if (!res.ok) continue;
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      const out = { songs: [], artists: [], collections: [] };
      list.forEach((it) => {
        if (it.type === "video") { const t = track(it.videoId, it.title, it.author, it.authorId, it.lengthSeconds); if (t) out.songs.push(t); }
        else if (it.type === "channel" && CHANNEL_ID.test(it.authorId || "")) out.artists.push({ id: it.authorId, name: cleanArtist(it.author), cover: bestThumb(it.authorThumbnails) });
        else if (it.type === "playlist" && it.playlistId) out.collections.push({ id: it.playlistId, kind: collectionKind(it.playlistId), title: clip(it.title), owner: cleanArtist(it.author), cover: cover(it.playlistThumbnail ? "" : ""), count: Number(it.videoCount) || 0 });
      });
      return out;
    } catch (err) { /* next instance */ }
  }
  throw Object.assign(new Error("iv"), { lane: "iv" });
}

/* YouTube Music's own weekly charts are public playlists named
   "Top 100 Songs <Country>". Known ones are listed; others are looked up
   once by name (cached for a week) and checked against the chart prefix. */
export const CHARTS = { GLOBAL: "PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i", IN: "PL4fGSI1pDJn4pTWyM3t61lOyZ6_4jcNOw", RU: "PL4fGSI1pDJn5C8dBiYt0BTREyCHbZ47qc", DE: "PL4fGSI1pDJn6KpOXlp0MH8qA9tngXaUJ-", UA: "PL4fGSI1pDJn4E_HoW5HB-w5vFPkYfo3dB" };
const CHART_PREFIX = /^PL4fGSI1pDJn/;

function countryName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || ""; } catch (err) { return ""; }
}

async function chartList(deps, where) {
  if (CHARTS[where]) return { id: CHARTS[where], title: "Top 100 Songs " + countryName(where) };
  const country = countryName(where);
  if (!country) return { id: CHARTS.GLOBAL, title: "Top 100 Songs Global" };
  try {
    const hit = await cached(deps, "chartid", where, async () => {
      const want = ("top 100 songs " + country).toLowerCase();
      let list = null;
      for (const q of ["Top 100 Songs " + country, "Top 100 Songs " + country + " youtube music charts"]) {
        const found = await pageSearch(deps, q, "playlist");
        list = found.collections.find((c) => CHART_PREFIX.test(c.id) && c.title.toLowerCase().trim() === want);
        if (list) break;
      }
      return { id: list ? list.id : "", empty: !list };
    });
    if (hit.body.id) return { id: hit.body.id, title: "Top 100 Songs " + country };
  } catch (err) { /* global chart */ }
  return { id: CHARTS.GLOBAL, title: "Top 100 Songs Global" };
}

/* ---------- lanes and cache ---------- */

async function lanes(list) {
  let last = null;
  for (const [name, run] of list) {
    if (!run) continue;
    try {
      const value = await run();
      if (value && !(Array.isArray(value) && !value.length) && !(value.songs && !value.songs.length && !(value.artists || []).length && !(value.collections || []).length) && !(value.tracks && !value.tracks.length) && !(value.top && !value.top.length && !(value.albums || []).length)) return { value, lane: name };
    } catch (err) { last = err; }
  }
  if (last) throw last;
  return { value: null, lane: "" };
}

function cacheRequest(key) { return new Request("https://viktorych-ytm.internal/" + key); }

async function cached(deps, kind, keyText, build) {
  const ttl = YTM_TTL[kind] || HOUR;
  const key = kind + "/" + await sha(keyText);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(cacheRequest(key));
      if (hit) return { body: await hit.json(), from: "edge" };
    } catch (err) { /* read on */ }
  }
  if (deps.r2) {
    try {
      const obj = await deps.r2.get("ytm/" + key + ".json");
      if (obj) {
        const body = JSON.parse(await obj.text());
        const age = (deps.now() - Number(body.at || 0)) / 1000;
        if (age >= 0 && age < ttl && age < MAX_AGE_DAYS * 86400) {
          await putEdge(deps, key, body, Math.max(60, Math.floor(ttl - age)));
          return { body, from: "r2" };
        }
      }
    } catch (err) { /* build it */ }
  }
  const built = await build();
  const body = Object.assign({ at: deps.now() }, built);
  const keep = body.empty ? Math.min(ttl, HOUR) : ttl;
  const work = Promise.all([
    putEdge(deps, key, body, keep),
    deps.r2 && !body.empty ? deps.r2.put("ytm/" + key + ".json", JSON.stringify(body)).catch(() => null) : null
  ]);
  if (deps.waitUntil) deps.waitUntil(work); else await work;
  return { body, from: "origin" };
}

async function putEdge(deps, key, body, ttl) {
  if (!deps.cache) return;
  try {
    await deps.cache.put(cacheRequest(key), new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + Math.max(60, Math.floor(ttl)) } }));
  } catch (err) { /* the answer still goes out */ }
}

function region(value, request) {
  const raw = String(value || (request.cf && request.cf.country) || request.headers.get("cf-ipcountry") || "US").toUpperCase();
  return /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : "US";
}

async function spotifyAuth(deps, env) {
  if (spotifyToken.value && spotifyToken.until > deps.now() + 60000) return spotifyToken.value;
  const basic = btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET);
  const res = await deps.fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { authorization: "Basic " + basic, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!res.ok) throw new Error("spotify_auth");
  const data = await res.json();
  spotifyToken = { value: data.access_token, until: deps.now() + (Number(data.expires_in) || 3600) * 1000 };
  return spotifyToken.value;
}

export function spotifyId(raw) {
  const text = String(raw || "").trim();
  const m = text.match(/playlist[/:]([A-Za-z0-9]{16,32})/) || text.match(/^([A-Za-z0-9]{16,32})$/);
  return m ? m[1] : "";
}

async function spotifyPlaylist(deps, env, id) {
  const token = await spotifyAuth(deps, env);
  const head = { authorization: "Bearer " + token };
  const meta = await deps.fetch("https://api.spotify.com/v1/playlists/" + id + "?fields=name,owner(display_name)", { headers: head });
  if (meta.status === 404) return { empty: true, error: "not_found" };
  if (!meta.ok) throw new Error("spotify_" + meta.status);
  const info = await meta.json();
  const tracks = [];
  let next = "https://api.spotify.com/v1/playlists/" + id + "/tracks?limit=100&fields=next,items(track(name,duration_ms,artists(name),album(name)))";
  for (let i = 0; i < 3 && next; i++) {
    const res = await deps.fetch(next, { headers: head });
    if (!res.ok) break;
    const page = await res.json();
    (page.items || []).forEach((it) => {
      const t = it && it.track;
      if (t && t.name) tracks.push({ title: clip(t.name), artist: clip(((t.artists || [])[0] || {}).name, 120), album: clip(t.album && t.album.name), duration: Math.round((Number(t.duration_ms) || 0) / 1000) });
    });
    next = page.next || "";
  }
  return { name: clip(info.name, 120), tracks: tracks.slice(0, 300) };
}

/* Best song for "title artist": prefer the official audio upload (Topic
   channels) and a length close to the original. */
export function bestMatch(songs, wanted) {
  if (!songs || !songs.length) return null;
  const want = String(wanted && wanted.title || "").toLowerCase();
  const artist = String(wanted && wanted.artist || "").toLowerCase();
  let best = null;
  let score = -1e9;
  songs.slice(0, 10).forEach((s, i) => {
    const t = s.title.toLowerCase();
    let n = -i;
    if (want && t.indexOf(want) >= 0) n += 6;
    if (artist && (s.artist.toLowerCase().indexOf(artist) >= 0 || t.indexOf(artist) >= 0)) n += 5;
    if (/live|cover|karaoke|instrumental|8d|slowed|sped up|remix/i.test(t) && !/live|cover|karaoke|instrumental|remix/i.test(want)) n -= 4;
    if (wanted && wanted.duration && s.duration) n -= Math.min(6, Math.abs(wanted.duration - s.duration) / 15);
    if (n > score) { score = n; best = s; }
  });
  return best;
}

export async function handleYtm(request, env, deps) {
  const url = new URL(request.url);
  const name = url.pathname.slice("/v1/ytm/".length);
  const p = url.searchParams;
  const hasKey = !!env.YT_API_KEY;
  const keyOn = () => hasKey && quotaOutUntil <= deps.now();
  if (name === "config") {
    return reply(200, { catalog: keyOn() ? "api" : "public", oauthClientId: String(env.YT_OAUTH_CLIENT_ID || ""), spotify: !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET), moods: Object.keys(MOODS) }, 300);
  }
  try {
    if (name === "search" || name === "match") {
      const q = clip(p.get("q"), 150);
      if (q.length < 1) return reply(400, { error: "query" });
      const type = name === "match" ? "song" : (["all", "song", "artist", "album", "playlist"].indexOf(p.get("type") || "all") >= 0 ? (p.get("type") || "all") : "all");
      const hit = await cached(deps, name, type + "|" + q.toLowerCase(), async () => {
        /* Public pages first for imports: they cost no quota. */
        const order = name === "match"
          ? [["page", () => pageSearch(deps, q, type)], ["key", keyOn() ? () => apiSearch(deps, env, q, type) : null], ["iv", () => ivSearch(deps, q, type)]]
          : [["key", keyOn() ? () => apiSearch(deps, env, q, type) : null], ["page", () => pageSearch(deps, q, type)], ["iv", () => ivSearch(deps, q, type)]];
        const got = await lanes(order);
        const value = got.value || { songs: [], artists: [], collections: [] };
        if (name === "match") {
          const best = bestMatch(value.songs, { title: p.get("title") || q, artist: p.get("artist") || "", duration: Number(p.get("duration")) || 0 });
          return { lane: got.lane, song: best, empty: !best };
        }
        return Object.assign({ lane: got.lane, empty: !value.songs.length && !value.artists.length && !value.collections.length }, value);
      });
      return reply(200, hit.body, YTM_TTL[name]);
    }
    if (name === "videos") {
      const ids = String(p.get("ids") || "").split(",").filter((id) => VIDEO_ID.test(id)).slice(0, 50);
      if (!ids.length) return reply(400, { error: "ids" });
      const hit = await cached(deps, "videos", ids.join(","), async () => {
        const got = await lanes([["key", keyOn() ? () => apiDetails(deps, env, ids) : null], ["oembed", () => oembedDetails(deps, ids.slice(0, 20))]]).catch(() => ({ value: null, lane: "" }));
        return { lane: got.lane, songs: got.value || [], empty: !got.value };
      });
      return reply(200, hit.body, YTM_TTL.videos);
    }
    if (name === "playlist") {
      const id = String(p.get("id") || "");
      if (!ID.test(id)) return reply(400, { error: "id" });
      const hit = await cached(deps, "playlist", id, async () => {
        const got = await lanes([["key", keyOn() ? () => apiPlaylist(deps, env, id) : null], ["page", () => pagePlaylist(deps, id)]]);
        return Object.assign({ lane: got.lane, empty: !got.value }, got.value || {});
      });
      return reply(200, hit.body, YTM_TTL.playlist);
    }
    if (name === "artist") {
      const id = String(p.get("id") || "");
      if (!CHANNEL_ID.test(id)) return reply(400, { error: "id" });
      const hit = await cached(deps, "artist", id, async () => {
        const got = await lanes([["key", keyOn() ? () => apiArtist(deps, env, id) : null], ["page", () => pageArtist(deps, id)]]);
        return Object.assign({ lane: got.lane, empty: !got.value }, got.value || {});
      });
      return reply(200, hit.body, YTM_TTL.artist);
    }
    if (name === "charts" || name === "new") {
      const where = region(p.get("region"), request);
      const hit = await cached(deps, name, where, async () => {
        if (name === "charts") {
          const list = await chartList(deps, where);
          const got = await lanes([
            ["page", list.id ? async () => (await pagePlaylist(deps, list.id)).tracks : null],
            ["key", keyOn() ? () => apiCharts(deps, env, where) : null],
            ["global", list.id !== CHARTS.GLOBAL ? async () => (await pagePlaylist(deps, CHARTS.GLOBAL)).tracks : null]
          ]);
          return { lane: got.lane, region: where, chart: list.id || CHARTS.GLOBAL, title: list.title, songs: got.value || [], empty: !got.value };
        }
        const after = new Date(deps.now() - 14 * 86400000).toISOString();
        const got = await lanes([
          ["key", keyOn() ? async () => (await apiSearch(deps, env, "new music", "song", { order: "date", publishedAfter: after, regionCode: where })).songs : null],
          ["page", async () => (await pageSearch(deps, "new music this week", "song")).songs]
        ]);
        return { lane: got.lane, region: where, songs: got.value || [], empty: !got.value };
      });
      return reply(200, hit.body, YTM_TTL[name]);
    }
    if (name === "mood") {
      const key = String(p.get("key") || "");
      if (!MOODS[key]) return reply(400, { error: "key" });
      const hit = await cached(deps, "mood", key, async () => {
        const got = await lanes([["key", keyOn() ? () => apiSearch(deps, env, MOODS[key] + " playlist", "playlist") : null], ["page", () => pageSearch(deps, MOODS[key] + " playlist", "playlist")]]);
        const value = got.value || { collections: [] };
        return { lane: got.lane, key, collections: value.collections || [], empty: !(value.collections || []).length };
      });
      return reply(200, hit.body, YTM_TTL.mood);
    }
    if (name === "radio") {
      const id = String(p.get("id") || "");
      if (!VIDEO_ID.test(id)) return reply(400, { error: "id" });
      const hit = await cached(deps, "radio", id, async () => {
        const got = await lanes([
          ["page", () => pageRadio(deps, id)],
          ["key", keyOn() ? async () => {
            const seed = (await apiDetails(deps, env, [id]))[0];
            return seed ? (await apiSearch(deps, env, seed.artist + " songs", "song")).songs : [];
          } : null]
        ]);
        return { lane: got.lane, songs: (got.value || []).filter((s) => s.id !== id), empty: !got.value };
      });
      return reply(200, hit.body, YTM_TTL.radio);
    }
    if (name === "spotify") {
      if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return reply(503, { error: "spotify_off" });
      const id = spotifyId(p.get("id"));
      if (!id) return reply(400, { error: "id" });
      const hit = await cached(deps, "spotify", id, () => spotifyPlaylist(deps, env, id));
      return reply(200, hit.body, 60);
    }
  } catch (err) {
    return reply(502, { error: "unavailable" });
  }
  return reply(404, { error: "not_found" });
}
