/* Feeds service worker. The shell cache name changes on each deploy. */
const VERSION = "fresh-__SW_VERSION__";
const SHELL = "shell-" + VERSION;
const DATA = "data-" + VERSION;
const MEDIA = "media-" + VERSION;
const LIVE = "live-" + VERSION;
const MEDIA_LIMIT = 150 * 1024 * 1024;
const MEDIA_TTL = 7 * 24 * 60 * 60 * 1000;
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-monochrome-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL && key !== DATA && key !== MEDIA && key !== LIVE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isData(url) {
  if (/\/archive\/[^/]+\.json$/.test(url.pathname)) return true;
  return url.origin === self.location.origin && /\/feeds\.json$/.test(url.pathname);
}

function isMedia(url) {
  const host = url.hostname;
  return /(^|\.)pbs\.twimg\.com$/.test(host) || /(^|\.)video\.twimg\.com$/.test(host) || host === "i.ytimg.com" || /(^|\.)ggpht\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)cdninstagram\.com$/.test(host) || /(^|\.)fbcdn\.net$/.test(host);
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
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("rss-feeds-sw", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

async function trimMedia(cache) {
  const db = await idb();
  const rows = (await idbGet(db, "media-index")) || [];
  const now = Date.now();
  const fresh = rows.filter((row) => row && now - row.at < MEDIA_TTL);
  let total = fresh.reduce((sum, row) => sum + (row.bytes || 0), 0);
  fresh.sort((a, b) => a.at - b.at);
  const dropped = [];
  while (total > MEDIA_LIMIT && fresh.length) {
    const row = fresh.shift();
    total -= row.bytes || 0;
    dropped.push(row.url);
  }
  await Promise.all(dropped.map((url) => cache.delete(url)));
  const expired = rows.filter((row) => row && now - row.at >= MEDIA_TTL).map((row) => row.url);
  await Promise.all(expired.map((url) => cache.delete(url)));
  await idbSet(db, "media-index", fresh);
}

async function rememberMedia(url, bytes) {
  const db = await idb();
  const rows = ((await idbGet(db, "media-index")) || []).filter((row) => row && row.url !== url);
  rows.push({ url: url, bytes: bytes || 200 * 1024, at: Date.now() });
  await idbSet(db, "media-index", rows);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(request);
  const update = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    update.then((res) => {
      if (!res) return;
      self.clients.matchAll({ type: "window" }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: "data", url: request.url }));
      });
    });
    return cached;
  }
  const res = await update;
  return res || new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
}

async function cacheFirstMedia(request) {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request);
  if (cached) {
    const db = await idb();
    const rows = (await idbGet(db, "media-index")) || [];
    const row = rows.find((item) => item && item.url === request.url);
    if (!row || Date.now() - row.at < MEDIA_TTL) return cached;
    cache.delete(request);
  }
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === "opaque")) {
      await cache.put(request, res.clone());
      const length = Number(res.headers.get("content-length")) || (res.type === "opaque" ? 200 * 1024 : 80 * 1024);
      await rememberMedia(request.url, length);
      await trimMedia(cache);
    }
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
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
    const cached = await cache.match(request);
    return cached || res;
  } catch (err) {
    clearTimeout(timer);
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

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "cache-bookmark") event.waitUntil(cacheBookmark(data.urls));
  if (data.type === "seen" || data.type === "state") {
    event.waitUntil(idb().then(async (db) => {
      await idbSet(db, "seen-at", data.type === "seen" ? Date.now() : Number(data.seen || 0));
      if (Array.isArray(data.follows)) await idbSet(db, "follows", data.follows);
    }));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (request.headers.has("range")) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put("./index.html", res.clone());
        return res;
      } catch (err) {
        return (await caches.match("./index.html")) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }
  if (isData(url)) {
    event.respondWith(request.headers.get("X-Feed-Refresh") === "1" ? networkFirst(request, DATA) : staleWhileRevalidate(request));
    return;
  }
  if (isMedia(url)) {
    event.respondWith(cacheFirstMedia(request));
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
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});

async function refreshAndNotify() {
  const feedUrl = new URL("feeds.json", self.registration.scope).href;
  const res = await fetch(feedUrl, { cache: "no-store" });
  if (!res.ok) return;
  const doc = await res.json();
  const cache = await caches.open(DATA);
  await cache.put(feedUrl, new Response(JSON.stringify(doc), { headers: { "Content-Type": "application/json" } }));
  const db = await idb();
  const seen = Number(await idbGet(db, "seen-at") || 0);
  const follows = new Set(await idbGet(db, "follows") || []);
  const fresh = (doc.posts || []).filter((post) => {
    if (!seen || (Date.parse(post.date || "") || 0) <= seen) return false;
    return follows.has(post.feedId) || follows.has((post.platform || "x") + ":" + (post.handle || ""));
  });
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.postMessage({ type: "feeds-updated" }));
  if (!fresh.length) return;
  if (navigator.setAppBadge) {
    try { await navigator.setAppBadge(fresh.length); } catch (err) { /* badges are optional */ }
  }
  if (Notification.permission === "granted") {
    await self.registration.showNotification("New posts", {
      body: fresh.length + " new posts from accounts you follow",
      icon: "icons/icon-192.png",
      tag: "feeds",
      data: { hash: "#/" }
    });
  }
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "feeds") event.waitUntil(refreshAndNotify());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const hash = (event.notification.data && event.notification.data.hash) || "#/";
    if (clients[0]) {
      await clients[0].focus();
      if (clients[0].navigate) await clients[0].navigate("./" + hash);
      return;
    }
    await self.clients.openWindow("./" + hash);
  })());
});
