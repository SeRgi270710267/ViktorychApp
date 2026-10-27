/* ViktorychApp service worker. Cache names are viktorych- plus the deploy SHA.
   Older superintel caches are dropped on activate. Offline music stays in sintel-music-offline. */
const VERSION = "viktorych-a20-__SW_VERSION__";
const MIRROR_GITHUB = "__MIRROR_GITHUB__";
const MIRROR_PAGES = "__MIRROR_PAGES__";
// cache-bust: 2026-10-27T15:30:00Z-presence
const ACCOUNTS_WALL = false;
let accountsAuthed = false;
let playToken = "";
let isRuVisitor = false;
importScripts("./shared/mirror.js?" + VERSION, "./storage.js?" + VERSION, "./i18n.js?" + VERSION, "./i18n/en.js?" + VERSION, "./i18n/ru.js?" + VERSION, "./i18n/es.js?" + VERSION);
function tr(key, vars) {
  var fn = (typeof self !== "undefined" && self.t) ? self.t : null;
  return fn ? fn(key, vars) : key;
}
function trn(key, n, vars) {
  var fn = (typeof self !== "undefined" && self.tn) ? self.tn : null;
  return fn ? fn(key, n, vars) : String(n);
}
async function ensureUiLang() {
  try {
    const db = await idb();
    const savedLang = await idbGet(db, "ui-lang");
    if ((savedLang === "en" || savedLang === "ru" || savedLang === "es") && self.SI18n) self.SI18n.setLang(savedLang);
  } catch (err) { /* English until the page sends a language */ }
}
async function brandManifestResponse(response) {
  await ensureUiLang();
  try {
    const data = await response.clone().json();
    const next = (self.SI18n && self.SI18n.brandManifest) ? self.SI18n.brandManifest(data) : data;
    return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/manifest+json" } });
  } catch (err) {
    return response;
  }
}
const SHELL = "shell-" + VERSION;
const DATA = "data-" + VERSION;
const MEDIA = "media-" + VERSION;
const LIVE = "live-" + VERSION;
const OFFLINE_MUSIC = "sintel-music-offline";
const MEDIA_LIMIT = 150 * 1024 * 1024;
const MEDIA_TTL = 7 * 24 * 60 * 60 * 1000;
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./dock.css",
  "./dock.js",
  "./i18n.js",
  "./i18n/en.js",
  "./i18n/ru.js",
  "./i18n/es.js",
  "./app.js",
  "./update.js",
  "./storage.js",
  "./storage.css",
  "./localfirst.js",
  "./direct.js",
  "./logo/v.svg",
  "./logo/v-music.svg",
  "./logo/viktorychapp.svg",
  "./logo/viktorychapp-short.svg",
  "./logo/viktorychmusic.svg",
  "./logo/viktorychmusic-short.svg",
  "./translate.js",
  "./translate.css",
  "./people.js",
  "./people.css",
  "./tv.js",
  "./tv.css",
  "./tv-page.js",
  "./tv-page.css",
  "./split.js",
  "./discord-ui.js",
  "./discord-ui.css",
  "./spaces.js",
  "./spaces.css",
  "./stories.js",
  "./stories.css",
  "./marks.js",
  "./music.js",
  "./music.css",
  "./presence.js",
  "./presence.css",
  "./shared/presence.js",
  "./accounts.js",
  "./owner-keys.js",
  "./accounts.css",
  "./accounts.config.js",
  "./shorts.js",
  "./shorts.css",
  "./drive.js",
  "./drive.css",
  "./games.js",
  "./games.css",
  "./communities.js",
  "./communities.css",
  "./yt-player.js",
  "./yt-player.css",
  "./hls-1.7.3.min.js",
  "./mpegts-1.8.0.min.js",
  "./scores.js",
  "./scores.css",
  "./weather.js",
  "./weather.css",
  "./shared/drive-crypto.js",
  "./shared/drive-photos.js",
  "./shared/mirror.js",
  "./video-embed.js",
  "./shared/handle-skeleton.js",
  "./shared/reposts.js",
  "./shared/feed-order.js",
  "./shared/pill-data.js",
  "./shared/lazy-modules.js",
  "./favicon.svg",
  "./favicon.ico",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-monochrome-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/music-192.png",
  "./icons/music-512.png",
  "./icons/music-maskable-512.png",
  "./peer-media.js",
  "./shared/peer-media.js",
  "./shared/device-performance.js"
];

let updateReporting = false;
let shellTask = null;
let peerOn = false;
const armedClients = new Set();

function versionSha(version) {
  const text = String(version || "");
  const prefix = "viktorych-a20-";
  if (text.indexOf(prefix) !== 0) return "";
  const sha = text.slice(prefix.length).trim().toLowerCase();
  return /^[0-9a-f]{7,64}$/.test(sha) ? sha : "";
}

function broadcast(msg) {
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      try { client.postMessage(msg); } catch (err) { /* the page may already be closing */ }
    });
  }).catch(() => {});
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // An open app already has a worker. Stay waiting so the page can show
    // the update and download the shell with a real progress count.
    // The first visit has no active worker, so the shell is cached quietly.
    if (self.registration.active) return;
    await precacheShell(false);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (updateReporting) broadcastProgress({ step: "activate" }, true);
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL && key !== DATA && key !== MEDIA && key !== LIVE && key !== OFFLINE_MUSIC).map((key) => caches.delete(key)));
    try { await forgetLoopCaches(); } catch (err) { /* a stuck loop playlist must not block the new shell */ }
    if (updateReporting) broadcastProgress({ step: "clean" }, true);
    await self.clients.claim();
    const sha = versionSha(VERSION);
    if (updateReporting) broadcast({ type: "update-ready", version: VERSION, sha: sha });
    else broadcast({ type: "sw-version", version: VERSION, sha: sha });
  })());
});

function isArchiveStore(url) {
  return /\/v1\/archive\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/i.test(url.pathname);
}

function isData(url) {
  if (isArchiveStore(url)) return false;
  if (/\/archive\/[^/]+\.json$/.test(url.pathname)) return true;
  // data/music.json is the ViktorychMusic catalog
  if (url.origin === self.location.origin && /\/data\/music\.json$/.test(url.pathname)) return true;
  if (url.origin === self.location.origin && /\/data\/communities\/(?:index|[a-z0-9_]{2,21})\.json$/.test(url.pathname)) return true;
  // one comment page per topic, fetched when a thread opens
  if (url.origin === self.location.origin && /\/data\/communities\/[a-z0-9_]{2,21}\/\d{1,20}\.json$/.test(url.pathname)) return true;
  if (url.origin === self.location.origin && /\/discord\/(?:index|state|messages\/\d{1,22}(?:\/p\/\d{1,4})?|pins\/\d{1,22})\.json$/.test(url.pathname)) return true;
  return url.origin === self.location.origin && /\/(?:feeds|people|suggestions|stories)\.json$/.test(url.pathname);
}

function isMedia(url) {
  const host = url.hostname;
  return /(^|\.)pbs\.twimg\.com$/.test(host) || /(^|\.)video\.twimg\.com$/.test(host) || host === "i.ytimg.com" || /(^|\.)ggpht\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)cdninstagram\.com$/.test(host) || /(^|\.)fbcdn\.net$/.test(host);
}

const SPACE_HOSTS = ["pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev", "r2.dev", "trycloudflare.com"];

function spaceHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
  if (!host) return false;
  for (let i = 0; i < SPACE_HOSTS.length; i++) {
    const rule = SPACE_HOSTS[i];
    if (!rule) continue;
    if (host === rule || host.endsWith("." + rule)) return true;
  }
  return false;
}

function isSpaceStatus(url) {
  return url.origin === self.location.origin && /\/live\/[^/]+\.json$/.test(url.pathname);
}

function isSpaceAsset(url) {
  return spaceHost(url.hostname);
}

// loop/current.json is the version pointer. Never cache it: a stored copy keeps
// a deleted loop version after the publisher swaps the bed.
function isLoopPointer(url) {
  return spaceHost(url.hostname) && /\/loop\/current\.json$/i.test(url.pathname);
}

// Versioned playlists and segments are immutable on R2 (a year of cache).
// Do not keep them in Cache Storage, or a deleted version 404s forever.
function isLoopVersionMedia(url) {
  return spaceHost(url.hostname) && /\/loop\/v[^/]+\//i.test(url.pathname);
}

async function forgetLoopCaches() {
  const names = await caches.keys();
  await Promise.all(names.map(async (name) => {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    await Promise.all(keys.map((req) => {
      let parsed;
      try { parsed = new URL(req.url); } catch (err) { return null; }
      if (isLoopPointer(parsed) || isLoopVersionMedia(parsed)) return cache.delete(req);
      return null;
    }));
  }));
}

async function fetchLoopPointer(request) {
  const url = new URL(request.url);
  url.searchParams.set("_", String(Date.now()));
  const mode = request.mode === "navigate" ? "cors" : request.mode;
  try {
    return await fetch(new Request(url.href, {
      method: "GET",
      headers: request.headers,
      mode: mode,
      credentials: "omit",
      cache: "no-store",
      redirect: "follow"
    }));
  } catch (err) {
    return fetch(url.href, { cache: "no-store", redirect: "follow" });
  }
}

// ViktorychMusic catalog audio (HLS playlist, key, init, segments, cover) is not
// handled here. The page streams it directly and, only after Download, stores
// an offline copy in sintel-music-offline. That cache is not this worker's.
function isCatalogMedia(url) {
  return spaceHost(url.hostname) && url.pathname.toLowerCase().indexOf("/music/") !== -1;
}

function isAppJson(url) {
  if (url.origin !== self.location.origin) return false;
  return /\/(?:feeds\.config|status)\.json$/.test(url.pathname) || /\/fallback\/[^/]+\.json$/.test(url.pathname);
}

function isOwnerTiktok(url) {
  return url.origin === self.location.origin && /\/owner\/tiktok\.json$/.test(url.pathname);
}

function isOwnerPlay(url) {
  return /\/v1\/owner\/play$/.test(url.pathname) && url.searchParams.has("id");
}

function isTikTokCdn(url) {
  const host = String(url.hostname || "").toLowerCase();
  return /(^|\.)tiktokcdn(?:-us|-eu)?\.com$/.test(host) || /(^|\.)bytefcdn(?:-oversea)?\.com$/.test(host) || /(^|\.)tiktokv\.com$/.test(host);
}

function isOwnedTelegram(url) {
  return /\/tg\//.test(url.pathname) && !/\/tg\/loop\//.test(url.pathname);
}

function isAccountMedia(url) {
  return /\/v1\/media\/(?:avatars|banners)\/\d{12}\/[a-f0-9]{64}\.(?:webp|jpg|png)$/.test(url.pathname);
}

function privateData(url) {
  return isData(url) || isAppJson(url) || isMedia(url) || isLive(url) || isCommentApi(url) || isSpaceStatus(url) || isSpaceAsset(url) || isCatalogMedia(url) || isOwnerTiktok(url);
}

function isLive(url) {
  const host = url.hostname;
  return host === "api.fxtwitter.com" || host === "api.invidious.io" || /(^|\.)invidious\./.test(host) || /piped/i.test(host) || host === "inv.nadeko.net" || host === "yt.artemislena.eu" || host === "invidious.nerdvpn.de" || host === "invidious.f5.si";
}

function isCommentApi(url) {
  const path = url.pathname || "";
  if (url.hostname === "api.fxtwitter.com" && /\/(conversation|status)\//.test(path)) return true;
  if (/\/comments(?:\/|$)/.test(path) || /\/api\/v1\/post\/[^/]+\/comments/.test(path)) return true;
  return url.origin === self.location.origin && /\/comments\/[^/]+\.json$/.test(path);
}

function idb() {
  return self.ViktorychStorage.openDb();
}

function idbGet(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

function idbSet(db, key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function rememberMedia(url, bytes, category, cacheName) {
  const db = await idb();
  const prev = await self.ViktorychStorage.getFile(db, url);
  const now = Date.now();
  const cat = category || (prev && prev.category) || self.ViktorychStorage.categoryOf(url) || "other";
  if (!cat) return;
  await self.ViktorychStorage.putFile(db, {
    url: url,
    bytes: bytes || (prev && prev.bytes) || 0,
    category: cat,
    at: now,
    saved: (prev && prev.saved) || now,
    cacheName: cacheName || (prev && prev.cacheName) || MEDIA
  });
}

async function trimMedia() {
  const db = await idb();
  const saved = await self.ViktorychStorage.readPolicy(db);
  const max = saved.unlimited ? Infinity : (saved.maxBytes || MEDIA_LIMIT);
  let rows = await self.ViktorychStorage.listFiles(db);
  if (!rows.length) {
    const old = (await idbGet(db, "media-index")) || [];
    rows = old.filter((row) => row && row.url).map((row) => ({
      url: row.url,
      bytes: row.bytes || 0,
      category: self.ViktorychStorage.categoryOf(row.url) || "other",
      at: row.at || Date.now(),
      saved: row.at || Date.now(),
      cacheName: MEDIA
    }));
  }
  const plan = self.ViktorychStorage.planEviction(rows, max, Date.now(), self.ViktorychStorage.keepMs(saved.keep));
  await Promise.all(plan.drop.map(async (row) => {
    try {
      if ((row.cacheName || "") === "idb-docs") {
        await self.ViktorychStorage.deleteDoc(db, row.url);
        return;
      }
      const cache = await caches.open(row.cacheName || MEDIA);
      await cache.delete(row.url);
    } catch (err) { /* a missing cache is already gone */ }
  }));
  await self.ViktorychStorage.replaceFiles(db, plan.keep);
  await idbSet(db, "media-index", []);
}

function mirrorApi() {
  return (typeof self !== "undefined" && self.ViktorychMirror) ? self.ViktorychMirror : null;
}

function mirrorRelative(url) {
  const api = mirrorApi();
  if (!api || !api.mirrorHost(self.location.hostname)) return "";
  if (!url || url.origin !== self.location.origin) return "";
  const rel = api.relativeTo(self.registration.scope, url.href);
  if (!rel || /^(?:v1\/|tg\/|ap\/|\.well-known\/)/.test(rel)) return "";
  return rel;
}

function mirrorBases() {
  const api = mirrorApi();
  if (!api) return [];
  const here = api.normalizeBase(self.registration.scope);
  return api.bases(here, MIRROR_GITHUB, MIRROR_PAGES).filter((base) => base !== here);
}

async function mirrorAlternate(url) {
  const api = mirrorApi();
  const rel = mirrorRelative(url);
  if (!api || !rel) return null;
  const bases = mirrorBases();
  for (let i = 0; i < bases.length; i++) {
    const next = api.rewrite(bases[i], rel);
    if (!next) continue;
    try {
      const res = await fetch(next, { method: "GET", mode: "cors", credentials: "omit", cache: "no-store", redirect: "follow" });
      if (res && res.ok && res.type !== "opaque") return res;
    } catch (err) { /* the next origin can still have the file */ }
  }
  return null;
}

async function mirrorFetch(request, init) {
  let res = null;
  let failed = false;
  try {
    res = init ? await fetch(request, init) : await fetch(request);
  } catch (err) {
    failed = true;
  }
  const api = mirrorApi();
  const status = failed || !res ? 0 : res.status;
  if (api && request && request.method === "GET" && api.failoverStatus(status)) {
    let url = null;
    try { url = new URL(request.url); } catch (err) { url = null; }
    const alt = url ? await mirrorAlternate(url) : null;
    if (alt) return alt;
  }
  if (failed) throw new Error("mirror");
  return res;
}

async function wipeUserCaches(full) {
  await caches.delete(DATA);
  await caches.delete(MEDIA);
  await caches.delete(LIVE);
  if (full) {
    try { await caches.delete(OFFLINE_MUSIC); } catch (err) { /* music downloads are already gone */ }
  }
  try {
    const db = await idb();
    await self.ViktorychStorage.replaceFiles(db, []);
    await self.ViktorychStorage.clearDocs(db, "all");
    await idbSet(db, "media-index", []);
  } catch (err) { /* the page clears the same stores */ }
}

async function staleWhileRevalidate(request, extraHeaders) {
  if (self.ViktorychStorage.categoryOf(request.url) === "") return fetch(request);
  const cache = await caches.open(DATA);
  const cacheReq = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheReq);
  const headers = new Headers(extraHeaders || undefined);
  if (cached) {
    const etag = cached.headers.get("etag");
    const lastMod = cached.headers.get("last-modified");
    if (etag) headers.set("If-None-Match", etag);
    else if (lastMod) headers.set("If-Modified-Since", lastMod);
  }
  const update = (async () => {
    const db = await idb();
    try {
      const res = await mirrorFetch(new Request(request.url, { method: "GET", headers: headers, cache: "no-store", redirect: "follow" }));
      const action = self.ViktorychStorage.revalidateAction(res && res.status);
      if (action === "keep" && cached) {
        await self.ViktorychStorage.touch(db, request.url);
        broadcast({ type: "storage-online" });
        return cached;
      }
      if (action === "store") await self.ViktorychStorage.bump(db, "network");
      if (action === "store" && self.ViktorychStorage.shouldCacheFeed(request.url)) {
        await cache.put(cacheReq, res.clone());
        await rememberMedia(request.url, self.ViktorychStorage.byteLengthOf(res), self.ViktorychStorage.categoryOf(request.url), DATA);
        await trimMedia();
        broadcast({ type: "storage-online" });
      }
      return res;
    } catch (err) {
      if (cached) broadcast({ type: "storage-offline" });
      return null;
    }
  })();
  if (cached) {
    const db = await idb();
    await self.ViktorychStorage.bump(db, "hits");
    await self.ViktorychStorage.bump(db, "savedRequests");
    await self.ViktorychStorage.bump(db, "savedBytes", self.ViktorychStorage.byteLengthOf(cached));
    await self.ViktorychStorage.touch(db, request.url);
    update.then((res) => {
      if (!res || res === cached) return;
      self.clients.matchAll({ type: "window" }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "data", url: request.url }));
      });
    });
    return cached;
  }
  const res = await update;
  return res || new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function peerMediaUrl(value) {
  let path = "";
  try { path = new URL(value).pathname; }
  catch (err) { return false; }
  if (/\/loop\//i.test(path)) return false;
  return /\.(m4s|ts|cmfv|cmfa|mp4|webm|m4v)$/i.test(path);
}

async function askPeer(request) {
  if (!peerOn || !peerMediaUrl(request.url)) return null;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = clients && clients[0];
  if (!client) return null;
  const channel = new MessageChannel();
  let settled = false;
  const answer = new Promise((resolve) => {
    channel.port1.onmessage = (event) => {
      if (settled) return;
      settled = true;
      resolve(event.data || null);
    };
  });
  const timer = new Promise((resolve) => setTimeout(() => {
    if (settled) return;
    settled = true;
    resolve(null);
  }, 700));
  try {
    client.postMessage({ type: "peer-fetch", url: request.url, range: request.headers.get("Range") || "" }, [channel.port2]);
  } catch (err) {
    return null;
  }
  return Promise.race([answer, timer]);
}

function peerBody(asked) {
  const bytes = asked && asked.bytes;
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return null;
}

function peerResponseFrom(asked, request) {
  const body = peerBody(asked);
  if (!body) return null;
  const size = body.byteLength || 0;
  if (!size) return null;
  const range = request.headers.get("Range") || "";
  const headers = {
    "Content-Type": asked.type || contentTypeFor(request.url),
    "Content-Length": String(size),
    "Cache-Control": "private",
    "Accept-Ranges": "bytes",
    "X-Viktorych-Peer": "1"
  };
  if (range && asked.status === 206) {
    const match = /^bytes=(\d+)-(\d+)$/i.exec(range.trim());
    if (match) headers["Content-Range"] = "bytes " + match[1] + "-" + match[2] + "/" + String(asked.total || size);
    return new Response(body, { status: 206, headers: headers });
  }
  return new Response(body, { status: 200, headers: headers });
}

function contentTypeFor(url) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".m4s") || path.endsWith(".mp4") || path.endsWith(".m4v")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
}

async function rememberPeer(request, response) {
  try {
    const cache = await caches.open(MEDIA);
    const range = request.headers.get("Range") || "";
    if (!range) {
      await cache.put(new Request(request.url, { method: "GET" }), response.clone());
      await rememberMedia(request.url, self.ViktorychStorage.byteLengthOf(response), self.ViktorychStorage.categoryOf(request.url), MEDIA);
      return;
    }
    const key = self.ViktorychStorage.rangeCacheUrl(request.url, range);
    if (!key || !self.ViktorychStorage.cacheableRange(range, response.headers.get("content-length"))) return;
    await cache.put(new Request(key, { method: "GET" }), response.clone());
    await rememberMedia(key, self.ViktorychStorage.byteLengthOf(response), self.ViktorychStorage.categoryOf(request.url), MEDIA);
  } catch (err) { /* a peer hit still plays */ }
}

async function fetchMediaOrigin(request, headers, authed) {
  const mirror = self.ViktorychMirror;
  const once = async () => {
    if (isRuVisitor && !authed) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 2000);
      try { return await fetch(request, { signal: ctrl.signal }); }
      finally { clearTimeout(tid); }
    }
    if (authed) return fetch(request.url, { method: "GET", headers: headers, cache: "no-store", redirect: "follow" });
    return fetch(request);
  };
  let attempt = 0;
  while (true) {
    try {
      const res = await once();
      if (isRuVisitor || !mirror || !mirror.retryableStatus || !mirror.retryableStatus(res && res.status)) return res;
      try { if (res.body && res.body.cancel) res.body.cancel(); } catch (err) { /* the next try replaces it */ }
      const delayMs = mirror.retryDelay(attempt, Math.random());
      if (delayMs < 0) return res;
      attempt += 1;
      await wait(delayMs);
    } catch (err) {
      if (isRuVisitor || !mirror || !mirror.retryDelay) throw err;
      const delayMs = mirror.retryDelay(attempt, Math.random());
      if (delayMs < 0) throw err;
      attempt += 1;
      await wait(delayMs);
    }
  }
}

function teachOrigin(request, response) {
  const len = Number(response.headers.get("content-length")) || 0;
  if (!len || len > 8 * 1024 * 1024) return;
  response.clone().arrayBuffer().then((buf) => {
    if (!buf || buf.byteLength > 8 * 1024 * 1024) return;
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (!clients || !clients.length) return;
      const payload = { type: "peer-learned", url: request.url, range: request.headers.get("Range") || "", bytes: buf };
      try { clients[0].postMessage(payload); }
      catch (err) { /* origin playback already has the bytes */ }
    });
  }).catch(() => {});
}

async function serveMedia(request, extraHeaders) {
  const parsed = new URL(request.url);
  const headers = new Headers(extraHeaders || undefined);
  const rangeHeader = request.headers.get("Range");
  if (!self.ViktorychStorage.shouldCacheMedia(parsed)) {
    if (rangeHeader) headers.set("Range", rangeHeader);
    if ([...headers.keys()].length) return fetch(request.url, { method: "GET", headers: headers, cache: "no-store", redirect: "follow" });
    return fetch(request);
  }
  const asked = await askPeer(request);
  if (asked && asked.bytes && !asked.skip) {
    const peerHit = peerResponseFrom(asked, request);
    if (peerHit) {
      const dbPeer = await idb();
      if (!asked.counted) await self.ViktorychStorage.bump(dbPeer, "peerBytes", peerHit.headers.get("content-length"));
      await rememberPeer(request, peerHit.clone());
      return peerHit;
    }
  }
  const countOrigin = !!(asked && asked.miss && !asked.skip);
  const cache = await caches.open(MEDIA);
  const fullReq = new Request(request.url, { method: "GET" });
  const db = await idb();
  if (rangeHeader && self.ViktorychStorage.rangeCacheUrl) {
    const rangeKey = self.ViktorychStorage.rangeCacheUrl(request.url, rangeHeader);
    if (rangeKey) {
      const ranged = await cache.match(new Request(rangeKey, { method: "GET" }));
      if (ranged) {
        await self.ViktorychStorage.bump(db, "hits");
        await self.ViktorychStorage.bump(db, "savedRequests");
        await self.ViktorychStorage.bump(db, "savedBytes", self.ViktorychStorage.byteLengthOf(ranged));
        return ranged;
      }
    }
  }
  let cached = await cache.match(fullReq);
  const saved = await self.ViktorychStorage.readPolicy(db);
  if (cached) {
    const row = await self.ViktorychStorage.getFile(db, request.url);
    if (row && !self.ViktorychStorage.mediaFresh(row, saved, Date.now())) {
      await cache.delete(fullReq);
      cached = null;
    }
  }
  if (cached && !rangeHeader) {
    await self.ViktorychStorage.bump(db, "hits");
    await self.ViktorychStorage.bump(db, "savedRequests");
    await self.ViktorychStorage.bump(db, "savedBytes", self.ViktorychStorage.byteLengthOf(cached));
    await self.ViktorychStorage.touch(db, request.url);
    return cached;
  }
  if (cached && rangeHeader) {
    const partial = await self.ViktorychStorage.sliceCached(cached, rangeHeader);
    if (partial) {
      await self.ViktorychStorage.bump(db, "hits");
      await self.ViktorychStorage.bump(db, "savedRequests");
      await self.ViktorychStorage.bump(db, "savedBytes", self.ViktorychStorage.byteLengthOf(cached));
      await self.ViktorychStorage.touch(db, request.url);
      return partial;
    }
  }
  await self.ViktorychStorage.bump(db, "network");
  try {
    const authed = headers.has("Authorization");
    if (authed && rangeHeader) headers.set("Range", rangeHeader);
    const res = await fetchMediaOrigin(request, headers, authed);
    const store = res && (res.type === "opaque" || self.ViktorychStorage.revalidateAction(res.status) === "store");
    if (store && !rangeHeader) {
      await cache.put(fullReq, res.clone());
      const length = self.ViktorychStorage.byteLengthOf(res);
      await rememberMedia(request.url, length, self.ViktorychStorage.categoryOf(request.url), MEDIA);
      await trimMedia();
    }
    if (res && res.status === 206 && rangeHeader && self.ViktorychStorage.cacheableRange(rangeHeader, res.headers.get("content-length"))) {
      const rangeKey = self.ViktorychStorage.rangeCacheUrl(request.url, rangeHeader);
      if (rangeKey) {
        await cache.put(new Request(rangeKey, { method: "GET" }), res.clone());
        await rememberMedia(rangeKey, self.ViktorychStorage.byteLengthOf(res), self.ViktorychStorage.categoryOf(request.url), MEDIA);
      }
    }
    if (countOrigin && res && (res.ok || res.status === 206)) {
      await self.ViktorychStorage.bump(db, "originBytes", self.ViktorychStorage.byteLengthOf(res));
      if (peerOn) teachOrigin(request, res);
    }
    if (res) broadcast({ type: "storage-online" });
    return res;
  } catch (err) {
    if (cached) {
      broadcast({ type: "storage-offline" });
      if (rangeHeader) {
        const partial = await self.ViktorychStorage.sliceCached(cached, rangeHeader);
        if (partial) return partial;
      }
      return cached;
    }
    return isRuVisitor ? new Response("", { status: 504 }) : Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await mirrorFetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone());
      if (cacheName === DATA) {
        try { await rememberMedia(request.url, self.ViktorychStorage.byteLengthOf(res), self.ViktorychStorage.categoryOf(request.url), DATA); } catch (err) { /* the response still returns */ }
      }
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function networkFirstTimeout(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 6000);
  try {
    const res = await fetch(new Request(request, { cache: "no-store", signal: controller.signal }));
    clearTimeout(timer);
    if (res && res.ok) {
      await cache.put(request, res.clone());
      return res;
    }
    const alt = await mirrorAlternate(new URL(request.url));
    if (alt && alt.ok) {
      await cache.put(request, alt.clone());
      return alt;
    }
    const cached = await cache.match(request);
    return cached || res;
  } catch (err) {
    clearTimeout(timer);
    const alt = await mirrorAlternate(new URL(request.url));
    if (alt && alt.ok) {
      try { await cache.put(request, alt.clone()); } catch (putErr) { /* the response is still usable */ }
      return alt;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("", { status: 504 });
  }
}

async function cacheBookmark(urls) {
  const cache = await caches.open(MEDIA);
  for (const url of urls || []) {
    if (!url || !/^https:/.test(url)) continue;
    try {
      const res = await fetch(url, { mode: "no-cors" });
      if (res && (res.ok || res.type === "opaque")) {
        await cache.put(url, res.clone());
        await rememberMedia(url, Number(res.headers.get("content-length")) || 200 * 1024);
      }
    } catch (err) { /* a missed image still leaves the saved post text */ }
  }
  await trimMedia(cache);
}

let lastReportAt = 0;
let progressState = { files: 0, totalFiles: SHELL_FILES.length, bytes: 0, totalBytes: 0 };

function shellOptional(path) {
  return /\.(?:png|ico|svg)$/i.test(String(path || ""));
}

function broadcastProgress(extra, force) {
  const now = Date.now();
  if (!force && now - lastReportAt < 80) return;
  lastReportAt = now;
  const msg = {
    type: "update-progress",
    step: (extra && extra.step) || "download",
    files: extra && typeof extra.files === "number" ? extra.files : progressState.files,
    totalFiles: extra && typeof extra.totalFiles === "number" ? extra.totalFiles : progressState.totalFiles,
    bytes: extra && typeof extra.bytes === "number" ? extra.bytes : progressState.bytes,
    totalBytes: extra && typeof extra.totalBytes === "number" ? extra.totalBytes : progressState.totalBytes
  };
  progressState = { files: msg.files, totalFiles: msg.totalFiles, bytes: msg.bytes, totalBytes: msg.totalBytes };
  broadcast(msg);
}

async function readCounted(res, onChunk) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  const chunks = [];
  let size = 0;
  if (!reader) {
    const buf = await res.arrayBuffer();
    size = buf.byteLength;
    chunks.push(new Uint8Array(buf));
    if (onChunk) onChunk(size);
    return { chunks: chunks, size: size };
  }
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (!step.value) continue;
    chunks.push(step.value);
    size += step.value.byteLength;
    if (onChunk) onChunk(step.value.byteLength);
  }
  return { chunks: chunks, size: size };
}

async function precacheShell(report) {
  if (shellTask) return shellTask;
  shellTask = doPrecache(report).catch((err) => {
    shellTask = null;
    throw err;
  });
  return shellTask;
}

async function doPrecache(report) {
  // Download the whole shell into a staging cache. The live cache is
  // replaced only after every required file succeeds, so a client never
  // runs one version's HTML with another version's scripts.
  const stagingName = SHELL + "-staging";
  await caches.delete(stagingName);
  const cache = await caches.open(stagingName);
  const files = SHELL_FILES.slice();
  const state = { files: 0, totalFiles: files.length, bytes: 0, totalBytes: 0 };
  let failed = null;
  const pull = async () => {
    while (files.length && !failed) {
      const path = files.shift();
      try {
        const res = await mirrorFetch(new Request(path, { cache: "reload" }));
        if (!res || !res.ok) throw new Error(path);
        const declared = Number(res.headers.get("content-length")) || 0;
        if (declared) state.totalBytes += declared;
        const counted = await readCounted(res, (n) => {
          state.bytes += n;
          if (report) broadcastProgress({ step: "download", files: state.files, totalFiles: state.totalFiles, bytes: state.bytes, totalBytes: state.totalBytes }, false);
        });
        if (!declared) state.totalBytes += counted.size;
        const headers = new Headers(res.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        await cache.put(path, new Response(new Blob(counted.chunks), { status: 200, headers: headers }));
        state.files += 1;
        if (report) broadcastProgress({ step: "download", files: state.files, totalFiles: state.totalFiles, bytes: state.bytes, totalBytes: state.totalBytes }, true);
      } catch (err) {
        if (shellOptional(path)) {
          state.files += 1;
          if (report) broadcastProgress({ step: "download", files: state.files, totalFiles: state.totalFiles, bytes: state.bytes, totalBytes: state.totalBytes }, true);
          continue;
        }
        failed = err || new Error(path);
      }
    }
  };
  const workers = [];
  const width = Math.min(4, SHELL_FILES.length);
  for (let i = 0; i < width; i++) workers.push(pull());
  await Promise.all(workers);
  if (failed) {
    await caches.delete(stagingName);
    throw failed;
  }
  const live = await caches.open(SHELL);
  const ready = await cache.keys();
  await Promise.all(ready.map(async (req) => {
    const res = await cache.match(req);
    if (res) await live.put(req, res);
  }));
  await caches.delete(stagingName);
  progressState = state;
  return state;
}

async function runApply() {
  if (updateReporting && shellTask) return;
  updateReporting = true;
  try {
    broadcastProgress({ step: "download", files: 0, totalFiles: SHELL_FILES.length, bytes: 0, totalBytes: 0 }, true);
    const state = await precacheShell(true);
    broadcastProgress({ step: "install", files: state.files, totalFiles: state.totalFiles, bytes: state.bytes, totalBytes: state.totalBytes }, true);
    await self.skipWaiting();
  } catch (err) {
    updateReporting = false;
    shellTask = null;
    broadcast({ type: "update-progress", step: "error" });
  }
}

idb().then((db) => idbGet(db, "auth-state")).then((saved) => { if (saved && typeof saved === "object") { if (!accountsAuthed && saved.on) accountsAuthed = true; if (!playToken && saved.token) playToken = String(saved.token); } }).catch(() => {});
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "peer-flag") {
    peerOn = !!data.on;
    return;
  }
  if (data.type === "media-stats") {
    const field = data.field === "peerBytes" || data.field === "originBytes" ? data.field : "";
    const bytes = Number(data.bytes) || 0;
    if (!field || bytes <= 0) return;
    event.waitUntil(idb().then((db) => self.ViktorychStorage.bump(db, field, bytes)).catch(() => {}));
    return;
  }
  if (data.type === "sw-version") {
    const sha = versionSha(VERSION);
    if (event.source) {
      try { event.source.postMessage({ type: "sw-version", version: VERSION, sha: sha }); } catch (err) { /* the page already continued */ }
    }
    return;
  }
  if (data.type === "prime") {
    event.waitUntil((async () => {
      if (self.registration.active) return;
      await precacheShell(false);
      await self.skipWaiting();
    })().catch(() => {}));
    return;
  }
  if (data.type === "apply-update") {
    event.waitUntil(runApply());
    return;
  }
  if (data.type === "ru_mode") {
    isRuVisitor = !!data.on;
    return;
  }
  if (data.type === "account-deleted") {
    accountsAuthed = false;
    playToken = "";
    event.waitUntil((async () => {
      await wipeUserCaches(true);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.indexOf("shell-") !== 0).map((name) => caches.delete(name)));
      try {
        const db = await idb();
        await idbSet(db, "auth-state", { on: false, token: "" });
        await idbSet(db, "follows", []);
        await idbSet(db, "seen-at", 0);
        await idbSet(db, "seen-ids", []);
        await idbSet(db, "bells", {});
        await idbSet(db, "bell-seen", []);
        await idbSet(db, "bell-queue", []);
        await idbSet(db, "muted-words", []);
        await idbSet(db, "muted-accounts", []);
        await idbSet(db, "repost-off", []);
        await idbSet(db, "notify-all", false);
        await idbSet(db, "media-index", []);
        if (self.ViktorychStorage) await self.ViktorychStorage.replaceFiles(db, []);
      } catch (err) { /* the page also deletes the database */ }
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch (err) { /* a deleted account has no server subscription left */ }
    })());
    return;
  }
  if (data.type === "auth") {
    accountsAuthed = !!data.on;
    playToken = data.on && typeof data.token === "string" ? data.token : "";
    event.waitUntil((async () => {
      try {
        const db = await idb();
        await idbSet(db, "auth-state", { on: accountsAuthed, token: playToken });
      } catch (err) { /* the page still signs out */ }
      if (!data.on) {
        await wipeUserCaches(data.wipe === "signout");
        try {
          const db = await idb();
          await idbSet(db, "bells", {});
          await idbSet(db, "bell-seen", []);
          await idbSet(db, "bell-queue", []);
          await idbSet(db, "notify-all", false);
        } catch (err) { /* the page cleared the same keys */ }
        try {
          const sub = await self.registration.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
        } catch (err) { /* push is already gone */ }
      }
    })());
    if (event.ports && event.ports[0]) {
      try { event.ports[0].postMessage({ ok: !!playToken }); } catch (err) { /* the page already continued */ }
    }
  }
  if (data.type === "storage-policy") {
    event.waitUntil(idb().then(async (db) => {
      await self.ViktorychStorage.writePolicy(db, data.policy || {});
      await trimMedia();
    }).catch(() => {}));
  }
  if (data.type === "storage-wipe") {
    event.waitUntil(wipeUserCaches(true));
  }
  if (data.type === "reload-armed" && event.source) armedClients.add(event.source.id);
  if (data.type === "cache-bookmark" || data.type === "cache-media") event.waitUntil(cacheBookmark(data.urls));
  if (data.type === "seen" || data.type === "state") {
    event.waitUntil(idb().then(async (db) => {
      await idbSet(db, "seen-at", data.type === "seen" ? Date.now() : Number(data.seen || 0));
      if (Array.isArray(data.follows)) await idbSet(db, "follows", data.follows);
      if (Array.isArray(data.ids)) await idbSet(db, "seen-ids", data.ids.slice(0, 400));
      if (data.bells && typeof data.bells === "object") await idbSet(db, "bells", data.bells);
      if (Array.isArray(data.bellSeen)) await idbSet(db, "bell-seen", data.bellSeen.slice(-500));
      if (Array.isArray(data.mutedWords)) await idbSet(db, "muted-words", data.mutedWords);
      if (Array.isArray(data.mutedAccounts)) await idbSet(db, "muted-accounts", data.mutedAccounts);
      if (Array.isArray(data.repostOff)) await idbSet(db, "repost-off", data.repostOff);
      if (typeof data.notifyAll === "boolean") await idbSet(db, "notify-all", data.notifyAll);
      if (data.uiLang === "en" || data.uiLang === "ru" || data.uiLang === "es") {
        await idbSet(db, "ui-lang", data.uiLang);
        if (self.SI18n) self.SI18n.setLang(data.uiLang);
      }
    }));
  }
  if (data.type === "bell-deliver") {
    event.waitUntil(deliverBellNotes(data.notes || [], !!data.dnd).then((delivered) => {
      if (event.source) event.source.postMessage({ type: "bell-delivered", notes: delivered });
    }));
  }
  if (data.type === "bell-pull") {
    event.waitUntil(idb().then(async (db) => {
      const notes = (await idbGet(db, "bell-queue")) || [];
      await idbSet(db, "bell-queue", []);
      if (event.source) event.source.postMessage({ type: "bell-queue", notes: notes });
    }));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if ((request.method === "DELETE" && /\/v1\/account\/?$/i.test(url.pathname)) || (request.method === "POST" && /\/v1\/account\/delete\/?$/i.test(url.pathname))) {
    event.respondWith((async () => {
      const res = await fetch(request);
      if (res && res.ok) await wipeUserCaches(true);
      return res;
    })());
    return;
  }
  if (request.method !== "GET") return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.origin === self.location.origin && url.pathname.toLowerCase().endsWith("/version.json")) {
    event.respondWith(mirrorFetch(new Request(request.url, { method: "GET", cache: "no-store" })).catch(() => new Response("", { status: 504, headers: { "cache-control": "no-store" } })));
    return;
  }
  if (isGameHost(url)) return;
  if (isTikTokCdn(url)) return;
  if (isArchiveStore(url)) return;
  const bearer = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (bearer && (/\/v1\//.test(url.pathname) || /\/tg\//.test(url.pathname))) { accountsAuthed = true; playToken = bearer[1]; }
  if (isOwnerPlay(url) || isAccountMedia(url) || isOwnedTelegram(url)) {
    event.respondWith((async () => {
      const headers = new Headers();
      const incoming = request.headers.get("Authorization") || "";
      const match = incoming.match(/^Bearer\s+(\S+)$/i);
      if (!match && !playToken) { try { const saved = await idbGet(await idb(), "auth-state"); if (saved && saved.token) { accountsAuthed = !!saved.on; playToken = String(saved.token); } } catch (err) { /* ignore */ } }
      if (match) { accountsAuthed = true; playToken = match[1]; headers.set("Authorization", "Bearer " + playToken); }
      else if (playToken) headers.set("Authorization", "Bearer " + playToken);
      else if (/^Bearer\s+\S+/i.test(incoming)) headers.set("Authorization", incoming);
      const origin = request.headers.get("origin");
      if (origin) headers.set("origin", origin);
      if (isOwnerPlay(url) || self.ViktorychStorage.categoryOf(url.href) === "") {
        const range = request.headers.get("Range");
        if (range) headers.set("Range", range);
        return fetch(request.url, { method: "GET", headers, cache: "no-store", redirect: "follow" });
      }
      if (self.ViktorychStorage.shouldCacheMedia(url)) return serveMedia(request, headers);
      if (self.ViktorychStorage.shouldCacheFeed(url)) return staleWhileRevalidate(request, headers);
      const range = request.headers.get("Range");
      if (range) headers.set("Range", range);
      return fetch(request.url, { method: "GET", headers, cache: "no-store", redirect: "follow" });
    })());
    return;
  }
  if (ACCOUNTS_WALL && !accountsAuthed && privateData(url)) {
    event.respondWith(new Response("", { status: 401, headers: { "cache-control": "no-store" } }));
    return;
  }
  if (isCatalogMedia(url)) return;
  if (isLoopPointer(url)) {
    event.respondWith(fetchLoopPointer(request));
    return;
  }
  if (isSpaceStatus(url) || isSpaceAsset(url)) {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
    return;
  }
  if (url.origin === self.location.origin && /\/accounts\.config\.js$/.test(url.pathname) && url.search) {
    // A cache-busted read asks for the latest gate. It must not be written
    // into the versioned shell, or one new file would sit next to old assets.
    event.respondWith(mirrorFetch(new Request(request, { cache: "no-store" })).catch(async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match("./accounts.config.js")) || Response.error();
    }));
    return;
  }
  if (request.headers.has("range")) {
    if (self.ViktorychStorage.shouldCacheMedia(url)) {
      event.respondWith(serveMedia(request));
      return;
    }
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const home = shellDocument(url);
      if (home) {
        const cache = await caches.open(SHELL);
        const cached = (await cache.match("./index.html")) || (await cache.match("./"));
        if (cached) return cached;
      }
      try {
        return await mirrorFetch(request);
      } catch (err) {
        if (!home) return Response.error();
        const cache = await caches.open(SHELL);
        return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }
  if (isData(url)) {
    event.respondWith(request.headers.get("X-Feed-Refresh") === "1" ? networkFirst(request, DATA) : staleWhileRevalidate(request));
    return;
  }
  if (isMedia(url) || self.ViktorychStorage.shouldCacheMedia(url)) {
    event.respondWith(serveMedia(request));
    return;
  }
  if (isCommentApi(url)) {
    event.respondWith(networkFirstTimeout(request, LIVE, 6000));
    return;
  }
  if (isLive(url)) {
    event.respondWith(networkFirst(request, LIVE).catch(() => new Response("", { status: 504 })));
    return;
  }
  if (request.cache === "reload") {
    event.respondWith(mirrorFetch(request));
    return;
  }
  if (isShell(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(request);
      if (cached) return url.pathname.endsWith("manifest.webmanifest") ? brandManifestResponse(cached) : cached;
      try {
        const res = await mirrorFetch(request);
        if (res && url.pathname.endsWith("manifest.webmanifest")) return brandManifestResponse(res);
        return res;
      } catch (err) {
        return Response.error();
      }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(request);
      if (cached) return cached;
      return mirrorFetch(request);
    })());
  }
});

function shellDocument(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  if (/\/(?:s|u)\//.test(path)) return false;
  return /\/(?:index\.html)?$/.test(path);
}

function isShell(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return /\/(?:index\.html|app\.js|update\.js|storage\.js|storage\.css|localfirst\.js|direct\.js|styles\.css|translate\.js|translate\.css|people\.js|people\.css|tv\.js|tv\.css|tv-page\.js|tv-page\.css|split\.js|discord-ui\.js|discord-ui\.css|spaces\.js|spaces\.css|music\.js|music\.css|games\.js|games\.css|yt-player\.js|yt-player\.css|scores\.js|scores\.css|weather\.js|weather\.css|stories\.js|stories\.css|shorts\.js|shorts\.css|drive\.js|drive\.css|communities\.js|communities\.css|marks\.js|accounts\.js|owner-keys\.js|accounts\.css|accounts\.config\.js|presence\.js|presence\.css|peer-media\.js|hls-1\.7\.3\.min\.js|mpegts-1\.8\.0\.min\.js|favicon\.svg|favicon\.ico|manifest\.webmanifest|i18n\.js)$/.test(path) || /\/i18n\//.test(path) || /\/icons\//.test(path) || /\/logo\//.test(path) || /\/splash\//.test(path) || /\/shared\//.test(path);
}

function isGameHost(url) {
  return url.hostname === "nzlay.com";
}

function canonicalNotifyId(post) {
  if (!post) return "";
  const rawId = String(post.id || "");
  if (rawId.indexOf("repost:") === 0) return rawId;
  let raw = String(post.statusId || post.id || "");
  if ((post.platform || "") !== "youtube" && raw.indexOf("yt:video:") !== 0) return raw;
  if (raw.indexOf("yt:video:") === 0) raw = raw.split(":").pop();
  const match = (raw + " " + (post.url || "")).match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  return raw;
}

function postIsLiveVideo(post) {
  if (!post) return false;
  if (post.live || post.isLive || post.premiere) return true;
  if (post.kind === "live" || post.kind === "premiere") return true;
  const media = post.media || [];
  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (item && (item.live || item.premiere)) return true;
  }
  const blob = [post.url, post.title, post.text].join("\n");
  if ((post.platform || "") !== "youtube") return false;
  if (/\/live(\/|$|\?)/i.test(blob)) return true;
  return /\bpremieres?\b|\blive stream\b|\blive now\b|\bis live\b/i.test(blob);
}

function accountMuted(post, list) {
  const handle = String((post && post.handle) || "").replace(/^@/, "").toLowerCase();
  const id = String((post && post.feedId) || "").toLowerCase();
  const prefixed = ((post && post.platform) || "x") + ":" + handle;
  return (list || []).some((item) => {
    const key = String(item || "").replace(/^@/, "").trim().toLowerCase();
    return !!key && (key === handle || key === id || key === prefixed);
  });
}

function textMuted(text, words) {
  const sample = String(text || "").toLowerCase();
  return (words || []).some((word) => {
    const raw = String(word || "").trim().toLowerCase();
    return !!raw && sample.indexOf(raw) >= 0;
  });
}

function postMuted(post, words, accounts, repostOff) {
  if (!post) return true;
  if (accountMuted(post, accounts) || textMuted(post.text, words)) return true;
  const by = post.repostedBy;
  if (by && accountMuted({ handle: by.handle, platform: by.platform || post.platform, feedId: by.feedId || post.feedId }, repostOff)) return true;
  return false;
}

function bellCovers(post, row) {
  if (!post || !row || (row.mode !== "all" && row.mode !== "live")) return false;
  const when = Date.parse(post.date || "") || 0;
  if (!when || when < Number(row.since || 0)) return false;
  if (row.mode === "live" && !postIsLiveVideo(post)) return false;
  const feedId = String(post.feedId || "");
  if (feedId && (row.ids || []).indexOf(feedId) >= 0) return true;
  const handle = ((post.platform || "x") + ":" + (post.handle || "")).toLowerCase();
  return (row.handles || []).indexOf(handle) >= 0;
}

function statusHash(post) {
  const platform = post.platform || "x";
  const handle = post.handle || "";
  const id = post.statusId || post.id || "";
  if (platform === "x") return "#/@" + encodeURIComponent(handle) + "/status/" + encodeURIComponent(id);
  return "#/" + encodeURIComponent(platform) + "/" + encodeURIComponent(handle) + "/status/" + encodeURIComponent(id);
}

function postImageUrl(post) {
  const media = (post && post.media) || [];
  let poster = "";
  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item) continue;
    if (item.type === "photo" && /^https:\/\//.test(item.url || "")) return item.url;
    if (!poster && /^https:\/\//.test(item.poster || "")) poster = item.poster;
  }
  return poster;
}

function noteFromPost(post, row) {
  const text = String(post.text || post.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const platform = post.platform || "x";
  const handle = String((row && row.handle) || post.handle || "").replace(/^@/, "");
  const raw = canonicalNotifyId(post) || String(post.id || "");
  const live = !!(row && row.mode === "live");
  const id = !raw ? "" : (live ? ("live:" + platform + ":" + handle.toLowerCase() + ":" + raw) : ("post:" + raw));
  return {
    id: id,
    at: Date.parse(post.date || "") || 0,
    kind: live ? "live" : "post",
    read: false,
    handle: handle,
    name: post.author || (row && row.name) || post.handle || "",
    text: text,
    avatar: /^https:\/\//.test(post.avatar || "") ? post.avatar : "",
    image: postImageUrl(post),
    hash: statusHash(post),
    feedId: String(post.feedId || ""),
    platform: platform,
    ids: (row && row.ids) || [],
    handles: (row && row.handles) || []
  };
}

let bellChain = Promise.resolve();

async function pushIsDnd(flag) {
  if (flag) return true;
  try {
    const db = await idb();
    const presence = await idbGet(db, "presence");
    if (!presence || typeof presence !== "object") return false;
    if (presence.state === "dnd" || presence.dnd === true || presence.presence === "dnd") return true;
    const until = Number(presence.until || presence.dndUntil || 0);
    if (until > Date.now()) return true;
  } catch (err) { /* a missing store still buzzes */ }
  return false;
}

function deliverBellNotes(notes, dnd) {
  const run = bellChain.then(() => deliverBellNotesNow(notes, dnd));
  bellChain = run.then(() => {}, () => {});
  return run;
}

async function deliverBellNotesNow(notes, dnd) {
  await ensureUiLang();
  const list = (notes || []).filter((note) => note && note.id);
  if (!list.length) return [];
  const db = await idb();
  const quiet = await pushIsDnd(dnd);
  const seen = new Set((await idbGet(db, "bell-seen")) || []);
  const delivered = [];
  for (const note of list) {
    const id = String(note.id);
    if (!id || !note.at || seen.has(id)) continue;
    seen.add(id);
    delivered.push(note);
    if (quiet || Notification.permission !== "granted") continue;
    try {
      await self.registration.showNotification(note.name || ("@" + (note.handle || "post")), {
        body: note.text || tr("New post"),
        icon: note.avatar || "icons/icon-192.png",
        image: note.image || undefined,
        tag: "bell-" + id,
        data: { hash: note.hash || "#/", id: id }
      });
    } catch (err) { /* the page still keeps the in-app row */ }
  }
  await idbSet(db, "bell-seen", Array.from(seen).slice(-500));
  if (!delivered.length) return [];
  const clients = await self.clients.matchAll({ type: "window" });
  const visible = clients.some((client) => client.visibilityState === "visible");
  if (!visible) {
    const queued = ((await idbGet(db, "bell-queue")) || []).concat(delivered).slice(-80);
    await idbSet(db, "bell-queue", queued);
    if (navigator.setAppBadge) {
      try { await navigator.setAppBadge(queued.length); } catch (err) { /* badges are optional */ }
    }
  }
  return delivered;
}

async function bellNotesFor(doc) {
  const db = await idb();
  const bells = (await idbGet(db, "bells")) || {};
  const words = (await idbGet(db, "muted-words")) || [];
  const accounts = (await idbGet(db, "muted-accounts")) || [];
  const repostOff = (await idbGet(db, "repost-off")) || [];
  const follows = new Set((await idbGet(db, "follows")) || []);
  const keys = Object.keys(bells);
  const notes = [];
  (doc.posts || []).forEach((post) => {
    if (!post || postMuted(post, words, accounts, repostOff)) return;
    const followed = follows.has(post.feedId) || follows.has((post.platform || "x") + ":" + (post.handle || ""));
    for (let i = 0; i < keys.length; i++) {
      const row = bells[keys[i]];
      if (!bellCovers(post, row)) continue;
      const ids = row.ids || [];
      if (!followed && !ids.some((item) => follows.has(item))) continue;
      const note = noteFromPost(post, row);
      if (note.id) notes.push(note);
      break;
    }
  });
  return notes;
}

async function refreshAndNotify() {
  await ensureUiLang();
  const feedUrl = new URL("feeds.json", self.registration.scope).href;
  const res = await mirrorFetch(new Request(feedUrl, { method: "GET", cache: "no-store" }));
  if (!res.ok) return;
  const doc = await res.json();
  const cache = await caches.open(DATA);
  await cache.put(feedUrl, new Response(JSON.stringify(doc), { headers: { "Content-Type": "application/json" } }));
  const db = await idb();
  const seen = Number(await idbGet(db, "seen-at") || 0);
  const follows = new Set(await idbGet(db, "follows") || []);
  const seenIds = new Set(await idbGet(db, "seen-ids") || []);
  const bells = (await idbGet(db, "bells")) || {};
  const bellKeys = Object.keys(bells);
  const covered = (post) => bellKeys.some((key) => bellCovers(post, bells[key]));
  const fresh = (doc.posts || []).filter((post) => {
    if (!seen || (Date.parse(post.date || "") || 0) <= seen) return false;
    const id = canonicalNotifyId(post);
    if ((id && seenIds.has(id)) || (post.id && seenIds.has(String(post.id)))) return false;
    if (covered(post)) return false;
    return follows.has(post.feedId) || follows.has((post.platform || "x") + ":" + (post.handle || ""));
  });
  const clients = await self.clients.matchAll({ type: "window" });
  const visible = clients.some((client) => client.visibilityState === "visible");
  clients.forEach((client) => client.postMessage({ type: "feeds-updated" }));
  if (!visible) {
    const notes = await bellNotesFor(doc);
    if (notes.length) await deliverBellNotes(notes);
  }
  const notifyAll = await idbGet(db, "notify-all");
  if (!fresh.length || notifyAll !== true) return;
  if (navigator.setAppBadge) {
    try { await navigator.setAppBadge(fresh.length); } catch (err) { /* badges are optional */ }
  }
  if (Notification.permission === "granted") {
    await self.registration.showNotification(tr("New posts"), {
      body: trn("newPosts", fresh.length),
      icon: "icons/icon-192.png",
      tag: "feeds",
      data: { hash: "#/" }
    });
  }
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "feeds") event.waitUntil(refreshAndNotify());
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (err) { data = {}; }
    if (await pushIsDnd(!!(data && data.dnd))) return;
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visible = open.some((client) => client.visibilityState === "visible");
    if (visible) {
      open.forEach((client) => {
        try { client.postMessage({ type: "push-note", note: data }); }
        catch (err) { /* the page polls when it is next visible */ }
      });
      return;
    }
    await ensureUiLang();
    const vars = data && data.titleVars && typeof data.titleVars === "object" ? data.titleVars : {};
    const title = data && data.titleKey ? tr(data.titleKey, vars) : tr("New post");
    await self.registration.showNotification(title, {
      body: (data && data.body) || "",
      icon: (data && data.icon) || "icons/icon-192.png",
      tag: (data && data.tag) || ("note-" + ((data && data.id) || "")),
      data: { hash: (data && data.hash) || "#/", id: (data && data.id) || "" }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const payload = event.notification.data || {};
    const hash = payload.hash || "#/";
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients[0]) {
      try { clients[0].postMessage({ type: "note-open", id: payload.id || "", hash: hash }); }
      catch (err) { /* navigation still opens the post */ }
      await clients[0].focus();
      if (clients[0].navigate) await clients[0].navigate("./" + hash);
      return;
    }
    await self.clients.openWindow("./" + hash);
  })());
});
