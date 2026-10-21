/* SuperintelApp service worker. Cache names are superintel6- plus the deploy SHA. */
const VERSION = "superintel6-__SW_VERSION__";
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
  "./translate.js",
  "./translate.css",
  "./people.js",
  "./people.css",
  "./tv.js",
  "./tv.css",
  "./split.js",
  "./discord-ui.js",
  "./discord-ui.css",
  "./spaces.js",
  "./spaces.css",
  "./favicon.svg",
  "./favicon.ico",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-monochrome-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(async (path) => {
      try {
        const res = await fetch(new Request(path, { cache: "reload" }));
        if (res && res.ok) await cache.put(path, res);
      } catch (err) { /* one missing icon must not leave the previous worker in control */ }
    }));
    await self.skipWaiting();
  })());
});

const armedClients = new Set();

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== SHELL && key !== DATA && key !== MEDIA && key !== LIVE).map((key) => caches.delete(key)));
    await self.clients.claim();
    await takeOverClients();
  })());
});

// The page that was open still has the previous app.js after claim. Reload
// every window once, including a visible installed PWA, so translate.js loads
// without a manual cache clear. reload-armed must not block that.
// client.navigate is not awaited: waiting for it inside activate deadlocks
// the navigation on this worker.
async function takeOverClients() {
  try {
    const db = await idb();
    const prev = await idbGet(db, "shell-reload-at");
    const at = typeof prev === "number" ? prev : Number(prev && prev.at) || 0;
    const version = prev && typeof prev === "object" ? prev.version : "";
    if (version === VERSION && at && Date.now() - at < 15000) return;
    await idbSet(db, "shell-reload-at", { version: VERSION, at: Date.now() });
  } catch (err) { /* a missed guard still reloads at most once per window */ }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    try { client.postMessage({ type: "reload-when-idle" }); } catch (err) { /* the page may already be closing */ }
    if (!client.navigate) continue;
    client.navigate(client.url).catch(() => {});
  }
}

function isData(url) {
  if (/\/archive\/[^/]+\.json$/.test(url.pathname)) return true;
  if (url.origin === self.location.origin && /\/discord\/(?:index|state|messages\/\d{1,22}|pins\/\d{1,22})\.json$/.test(url.pathname)) return true;
  return url.origin === self.location.origin && /\/(?:feeds|people|suggestions)\.json$/.test(url.pathname);
}

function isMedia(url) {
  const host = url.hostname;
  return /(^|\.)pbs\.twimg\.com$/.test(host) || /(^|\.)video\.twimg\.com$/.test(host) || host === "i.ytimg.com" || /(^|\.)ggpht\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)cdninstagram\.com$/.test(host) || /(^|\.)fbcdn\.net$/.test(host);
}

function isSpaceStatus(url) {
  return url.origin === self.location.origin && /\/live\/[^/]+\.json$/.test(url.pathname);
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
  if (data.type === "reload-armed" && event.source) armedClients.add(event.source.id);
  if (data.type === "cache-bookmark") event.waitUntil(cacheBookmark(data.urls));
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
    }));
  }
  if (data.type === "bell-deliver") {
    event.waitUntil(deliverBellNotes(data.notes || []).then((delivered) => {
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
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (request.headers.has("range")) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const home = shellDocument(url);
      try {
        const res = await fetch(request);
        if (home && res && res.ok) {
          const cache = await caches.open(SHELL);
          cache.put("./index.html", res.clone());
        }
        return res;
      } catch (err) {
        if (!home) return Response.error();
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
  if (request.cache === "reload") {
    event.respondWith(fetch(request));
    return;
  }
  if (isShell(url)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res && res.ok) {
          const cache = await caches.open(SHELL);
          cache.put(request, res.clone());
        }
        if (res) return res;
      } catch (err) { /* offline falls back to the shell copied at install */ }
      return (await caches.match(request)) || Response.error();
    })());
    return;
  }
  if (isSpaceStatus(url)) {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
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
  return /\/(?:index\.html|app\.js|styles\.css|translate\.js|translate\.css|people\.js|people\.css|tv\.js|tv\.css|split\.js|discord-ui\.js|discord-ui\.css|spaces\.js|spaces\.css|favicon\.svg|favicon\.ico|manifest\.webmanifest)$/.test(path) || /\/icons\//.test(path) || /\/splash\//.test(path);
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
  return {
    id: canonicalNotifyId(post) || String(post.id || ""),
    at: Date.now(),
    handle: (row && row.handle) || post.handle || "",
    name: post.author || (row && row.name) || post.handle || "",
    text: text,
    avatar: /^https:\/\//.test(post.avatar || "") ? post.avatar : "",
    image: postImageUrl(post),
    hash: statusHash(post)
  };
}

let bellChain = Promise.resolve();

function deliverBellNotes(notes) {
  const run = bellChain.then(() => deliverBellNotesNow(notes));
  bellChain = run.then(() => {}, () => {});
  return run;
}

async function deliverBellNotesNow(notes) {
  const list = (notes || []).filter((note) => note && note.id);
  if (!list.length) return [];
  const db = await idb();
  const seen = new Set((await idbGet(db, "bell-seen")) || []);
  const delivered = [];
  for (const note of list) {
    const id = String(note.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    delivered.push(note);
    if (Notification.permission !== "granted") continue;
    try {
      await self.registration.showNotification(note.name || ("@" + (note.handle || "post")), {
        body: note.text || "New post",
        icon: note.avatar || "icons/icon-192.png",
        image: note.image || undefined,
        tag: "bell-" + id,
        data: { hash: note.hash || "#/" }
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
  const feedUrl = new URL("feeds.json", self.registration.scope).href;
  const res = await fetch(feedUrl, { cache: "no-store" });
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
