/* Data and storage. Media bytes live in Cache Storage. Size, category, and
   last access live in IndexedDB so the service worker can evict by LRU and
   by the Keep media window. Auth, session, and owner-key responses are never
   stored. Sign-out and account deletion clear the saved copies. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychStorage = api;
  if (typeof document !== "undefined") api.start();
})(typeof self !== "undefined" ? self : this, function () {
  var GB = 1024 * 1024 * 1024;
  var MAX_STEPS = [1 * GB, 5 * GB, 10 * GB, 20 * GB];
  var POLICY_KEY = "viktorychapp-storage";
  var DB_NAME = "superintelapp-sw";
  var DB_VERSION = 2;
  var PINNED_CACHE = "sintel-music-offline";
  var MEDIA_CATS = { videos: 1, photos: 1, live: 1, music: 1 };
  var COLORS = {
    videos: "#3390ec",
    photos: "#53b35b",
    live: "#e85d4c",
    music: "#a46cff",
    feeds: "#e8a33d",
    messages: "#5ac8fa",
    other: "#8e8e93"
  };
  var ORDER = ["videos", "photos", "live", "music", "feeds", "messages", "other"];
  var RANGE_LIMIT = 48 * 1024 * 1024;
  var policy = null;
  var snap = null;
  var measuring = false;

  function tr(key, vars) {
    var fn = (typeof self !== "undefined" && self.t) ? self.t : null;
    if (!fn && typeof window !== "undefined" && window.t) fn = window.t;
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function toUrl(value) {
    if (!value) return null;
    if (typeof value !== "string") {
      try { return new URL(value.href || value.url); } catch (err) { return null; }
    }
    try { return new URL(value, "https://app.local"); } catch (err) { return null; }
  }

  function tiktokHost(host) {
    var name = String(host || "").toLowerCase();
    return /(^|\.)tiktokcdn(?:-us|-eu)?\.com$/.test(name) || /(^|\.)bytefcdn(?:-oversea)?\.com$/.test(name) || /(^|\.)tiktokv\.com$/.test(name);
  }

  function blockedPath(url) {
    var path = url.pathname || "";
    if (/\/version\.json$/i.test(path)) return true;
    if (/owner-keys/i.test(path)) return true;
    if (/\/v1\/owner\/play$/i.test(path)) return true;
    if (/\/v1\/(?:session|login|logout|logout-all|auth|account|me)(?:\/|$)/i.test(path)) return true;
    if (/\/v1\/(?:notifications|push|channel|presence)(?:\/|$)/i.test(path)) return true;
    if (/\/v1\/owner\/keys(?:\/|$)/i.test(path)) return true;
    if (/\/tg\/loop\//i.test(path)) return true;
    if (/\/loop\/current\.json$/i.test(path)) return true;
    if (/\/loop\/v[^/]+\//i.test(path)) return true;
    return false;
  }

  function categoryOf(value) {
    var url = toUrl(value);
    if (!url || blockedPath(url) || tiktokHost(url.hostname)) return "";
    var path = url.pathname || "";
    var host = String(url.hostname || "").toLowerCase();
    if (/discord/i.test(host) || /\/discord\//i.test(path) || /\/tg\/social\//i.test(path)) return "messages";
    if (/record|\/live\//i.test(path)) return "live";
    if (/\/music\//i.test(path) || /\.(mp3|m4a|aac|flac|ogg|opus)$/i.test(path)) return "music";
    if (/\.(mp4|webm|mov|m4s|ts)$/i.test(path) || host.indexOf("video.twimg.com") >= 0) return "videos";
    if (/\.(png|jpe?g|gif|webp|avif)$/i.test(path) || /(^|\.)pbs\.twimg\.com$/.test(host) || host === "i.ytimg.com" || /(^|\.)ggpht\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)cdninstagram\.com$/.test(host) || /(^|\.)fbcdn\.net$/.test(host) || /\/v1\/media\/(?:avatars|banners)\//i.test(path)) return "photos";
    if (/\.json$/i.test(path) || /\/(?:feeds|people|suggestions|stories)\.json$/i.test(path)) return "feeds";
    if (/\/tg\//i.test(path)) return "videos";
    return "other";
  }

  function shouldCacheMedia(value) {
    var url = toUrl(value);
    if (!url || tiktokHost(url.hostname) || blockedPath(url)) return false;
    var path = url.pathname || "";
    if (/\.(m3u8|json)$/i.test(path)) return false;
    var cat = categoryOf(url);
    if (cat === "videos" || cat === "photos" || cat === "live" || cat === "music") return true;
    return cat === "messages" && /\.(png|jpe?g|gif|webp|avif|mp4|webm|mov|m4s|ts)$/i.test(path);
  }

  function shouldCacheFeed(value) {
    var url = toUrl(value);
    if (!url || blockedPath(url) || tiktokHost(url.hostname)) return false;
    if (shouldCacheMedia(url)) return false;
    if (/\/v1\/presence(?:\/|$|\?)/i.test(url.pathname) || /\/v1\/channel(?:\/|$|\?)/i.test(url.pathname)) return false;
    if (/\/v1\//i.test(url.pathname) && !/\/v1\/owner\/tiktok\/recordings$/i.test(url.pathname)) return false;
    var cat = categoryOf(url);
    return cat === "feeds" || cat === "messages" || (cat === "live" && /\.json$/i.test(url.pathname));
  }

  function revalidateAction(status) {
    if (status === 304) return "keep";
    if (status === 206) return "skip";
    if (status >= 200 && status < 300) return "store";
    return "skip";
  }

  function keepMs(keep) {
    if (keep === "3d") return 3 * 24 * 60 * 60 * 1000;
    if (keep === "month") return 30 * 24 * 60 * 60 * 1000;
    if (keep === "forever") return Infinity;
    return 7 * 24 * 60 * 60 * 1000;
  }

  function defaultMaxBytes(quota) {
    var budget = Number(quota) > 0 ? Math.floor(Number(quota) * 0.2) : 0;
    if (!budget) return 5 * GB;
    var pick = MAX_STEPS[0];
    if (budget < pick) return pick;
    for (var i = 0; i < MAX_STEPS.length; i++) {
      if (MAX_STEPS[i] <= budget) pick = MAX_STEPS[i];
    }
    return pick;
  }

  function normalizePolicy(raw, quota) {
    var fallback = defaultMaxBytes(quota);
    var keep = raw && (raw.keep === "3d" || raw.keep === "week" || raw.keep === "month" || raw.keep === "forever") ? raw.keep : "week";
    if (raw && raw.unlimited) return { keep: keep, maxBytes: 0, unlimited: true };
    var maxBytes = raw ? Number(raw.maxBytes) : 0;
    if (MAX_STEPS.indexOf(maxBytes) < 0) maxBytes = fallback;
    return { keep: keep, maxBytes: maxBytes, unlimited: false };
  }

  function planEviction(rows, maxBytes, now, keepFor) {
    var dropped = [];
    var pinned = [];
    var pool = [];
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || !row.url) continue;
      if (row.cacheName === PINNED_CACHE) {
        pinned.push(row);
        continue;
      }
      var born = row.saved || row.at || now;
      if (MEDIA_CATS[row.category] && keepFor !== Infinity && now - born >= keepFor) dropped.push(row);
      else pool.push(row);
    }
    pool.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    var total = 0;
    for (var j = 0; j < pool.length; j++) total += pool[j].bytes || 0;
    if (maxBytes && maxBytes < Infinity) {
      while (total > maxBytes && pool.length) {
        var old = pool.shift();
        total -= old.bytes || 0;
        dropped.push(old);
      }
    }
    var kept = pinned.concat(pool);
    var shown = 0;
    for (var n = 0; n < kept.length; n++) shown += kept[n].bytes || 0;
    return { keep: kept, drop: dropped, total: shown };
  }

  function mediaFresh(row, savedPolicy, now) {
    if (!row) return true;
    if (row.cacheName === PINNED_CACHE) return true;
    if (!MEDIA_CATS[row.category]) return true;
    var windowMs = keepMs(savedPolicy && savedPolicy.keep);
    if (windowMs === Infinity) return true;
    var born = row.saved || row.at || now;
    return now - born < windowMs;
  }

  function parseByteRange(header, size) {
    var match = /^bytes=(\d*)-(\d*)$/i.exec(String(header || "").trim());
    if (!match || size < 1) return null;
    var start = match[1] === "" ? null : Number(match[1]);
    var end = match[2] === "" ? null : Number(match[2]);
    if (start === null && end === null) return null;
    if (start !== null && (!isFinite(start) || start < 0)) return null;
    if (end !== null && (!isFinite(end) || end < 0)) return null;
    if (start === null) {
      var tail = end;
      if (!tail) return null;
      start = Math.max(0, size - tail);
      end = size - 1;
    } else if (end === null || end >= size) {
      end = size - 1;
    }
    if (start >= size || end < start) return null;
    return { start: start, end: end };
  }

  function rangeResponse(buffer, range, type) {
    var slice = buffer.slice(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        "Content-Type": type || "application/octet-stream",
        "Content-Length": String(slice.byteLength),
        "Content-Range": "bytes " + range.start + "-" + range.end + "/" + buffer.byteLength,
        "Accept-Ranges": "bytes"
      }
    });
  }

  function sliceCached(response, rangeHeader) {
    if (!response || !rangeHeader) return Promise.resolve(response || null);
    var declared = Number(response.headers.get("content-length")) || 0;
    if (declared > RANGE_LIMIT) return Promise.resolve(null);
    return response.clone().arrayBuffer().then(function (buffer) {
      if (!buffer || buffer.byteLength > RANGE_LIMIT) return null;
      var range = parseByteRange(rangeHeader, buffer.byteLength);
      if (!range) return new Response(buffer, { status: 200, headers: { "Content-Type": response.headers.get("content-type") || "application/octet-stream", "Content-Length": String(buffer.byteLength), "Accept-Ranges": "bytes" } });
      return rangeResponse(buffer, range, response.headers.get("content-type"));
    }).catch(function () { return null; });
  }

  function byteLengthOf(res) {
    if (!res) return 0;
    if (res.type === "opaque") return 200 * 1024;
    var n = Number(res.headers && res.headers.get && res.headers.get("content-length"));
    if (n > 0) return n;
    return 80 * 1024;
  }

  function formatBytes(n) {
    var value = Number(n) || 0;
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + " KB";
    if (value < GB) return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0) + " MB";
    var gb = value / GB;
    return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)) + " GB";
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function metaGet(db, key) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction("meta", "readonly");
        var req = tx.objectStore("meta").get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(undefined); };
      } catch (err) { resolve(undefined); }
    });
  }

  function metaSet(db, key, value) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (err) { resolve(); }
    });
  }

  function readPolicy(db) {
    return metaGet(db, "storage-policy").then(function (raw) { return normalizePolicy(raw); });
  }

  function writePolicy(db, next) {
    var clean = normalizePolicy(next);
    return metaSet(db, "storage-policy", clean).then(function () { return clean; });
  }

  function getFile(db, url) {
    return new Promise(function (resolve) {
      try {
        var req = db.transaction("files", "readonly").objectStore("files").get(url);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (err) { resolve(null); }
    });
  }

  function putFile(db, row) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(row, row.url);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (err) { resolve(); }
    });
  }

  function listFiles(db) {
    return new Promise(function (resolve) {
      try {
        var req = db.transaction("files", "readonly").objectStore("files").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      } catch (err) { resolve([]); }
    });
  }

  function replaceFiles(db, rows) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction("files", "readwrite");
        var store = tx.objectStore("files");
        store.clear();
        (rows || []).forEach(function (row) { if (row && row.url) store.put(row, row.url); });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (err) { resolve(); }
    });
  }

  function touch(db, url) {
    return getFile(db, url).then(function (row) {
      if (!row) return null;
      row.at = Date.now();
      return putFile(db, row).then(function () { return row; });
    });
  }

  function bump(db, field) {
    return metaGet(db, "storage-stats").then(function (stats) {
      var next = stats && typeof stats === "object" ? { hits: Number(stats.hits) || 0, network: Number(stats.network) || 0 } : { hits: 0, network: 0 };
      next[field] = (Number(next[field]) || 0) + 1;
      return metaSet(db, "storage-stats", next).then(function () { return next; });
    });
  }

  function readStats(db) {
    return metaGet(db, "storage-stats").then(function (stats) {
      if (!stats || typeof stats !== "object") return { hits: 0, network: 0 };
      return { hits: Number(stats.hits) || 0, network: Number(stats.network) || 0 };
    });
  }

  function currentPolicy() {
    return policy || normalizePolicy(null);
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(POLICY_KEY);
      if (!raw) return null;
      return normalizePolicy(JSON.parse(raw));
    } catch (err) { return null; }
  }

  function saveLocal(next) {
    policy = normalizePolicy(next);
    try { localStorage.setItem(POLICY_KEY, JSON.stringify(policy)); } catch (err) { /* private mode */ }
    openDb().then(function (db) { return writePolicy(db, policy); }).catch(function () {});
    post({ type: "storage-policy", policy: policy });
    return policy;
  }

  function post(msg) {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    var send = function (worker) { try { if (worker) worker.postMessage(msg); } catch (err) { /* the worker may be restarting */ } };
    try { if (navigator.serviceWorker.controller) send(navigator.serviceWorker.controller); } catch (err) { /* ignore */ }
    navigator.serviceWorker.ready.then(function (reg) { if (reg && reg.active) send(reg.active); }).catch(function () {});
  }

  function askPersist() {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persist().then(function (ok) { return !!ok; }).catch(function () { return false; });
  }

  function stepIndex(saved) {
    if (saved && saved.unlimited) return MAX_STEPS.length;
    var found = MAX_STEPS.indexOf(saved && saved.maxBytes);
    return found < 0 ? 1 : found;
  }

  function stepLabel(index) {
    if (index >= MAX_STEPS.length) return tr("Unlimited");
    return tr((MAX_STEPS[index] / GB) + " GB");
  }

  function keepLabel(keep) {
    if (keep === "3d") return tr("3 days");
    if (keep === "month") return tr("1 month");
    if (keep === "forever") return tr("Forever");
    return tr("1 week");
  }

  function catLabel(cat) {
    if (cat === "videos") return tr("Videos");
    if (cat === "photos") return tr("Photos");
    if (cat === "live") return tr("Live recordings");
    if (cat === "music") return tr("Music");
    if (cat === "feeds") return tr("Feeds and posts");
    if (cat === "messages") return tr("Messages");
    return tr("Other");
  }

  function requestRender() {
    var accounts = typeof window !== "undefined" && window.ViktorychAccounts;
    if (accounts && accounts.requestRender) accounts.requestRender();
  }

  function responseBytes(res) {
    if (!res) return Promise.resolve(0);
    var n = Number(res.headers.get("content-length"));
    if (n > 0) return Promise.resolve(n);
    if (res.type === "opaque") return Promise.resolve(200 * 1024);
    return res.clone().blob().then(function (blob) { return blob.size || 0; }).catch(function () { return byteLengthOf(res); });
  }

  function measureNow() {
    var dbPromise = openDb();
    return dbPromise.then(function (db) {
      return listFiles(db).then(function (prev) {
        var known = {};
        prev.forEach(function (row) { if (row && row.url) known[row.url] = row; });
        if (typeof caches === "undefined") return { db: db, rows: prev };
        return caches.keys().then(function (names) {
          var rows = [];
          var chain = Promise.resolve();
          names.forEach(function (name) {
            if (/^shell-/.test(name)) return;
            chain = chain.then(function () {
              return caches.open(name).then(function (cache) { return cache.keys().then(function (reqs) { return { cache: cache, reqs: reqs, name: name }; }); });
            }).then(function (opened) {
              var inner = Promise.resolve();
              opened.reqs.forEach(function (req) {
                inner = inner.then(function () {
                  var cat = categoryOf(req.url);
                  if (!cat) return opened.cache.delete(req);
                  return opened.cache.match(req).then(function (res) { return responseBytes(res); }).then(function (bytes) {
                    var old = known[req.url];
                    var now = Date.now();
                    rows.push({
                      url: req.url,
                      bytes: bytes,
                      category: cat,
                      cacheName: opened.name,
                      at: old && old.at ? old.at : now,
                      saved: old && old.saved ? old.saved : now
                    });
                  });
                });
              });
              return inner;
            });
          });
          return chain.then(function () { return { db: db, rows: rows }; });
        });
      }).then(function (measured) {
        return replaceFiles(measured.db, measured.rows).then(function () {
          return readStats(measured.db).then(function (stats) {
            var estimate = Promise.resolve(null);
            if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) estimate = navigator.storage.estimate().catch(function () { return null; });
            var persisted = Promise.resolve(false);
            if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persisted) persisted = navigator.storage.persisted().catch(function () { return false; });
            return Promise.all([estimate, persisted]).then(function (pair) {
              var est = pair[0] || {};
              return {
                rows: measured.rows,
                stats: stats,
                quota: Number(est.quota) || 0,
                usage: Number(est.usage) || 0,
                persisted: !!pair[1]
              };
            });
          });
        });
      });
    });
  }

  function kickMeasure() {
    if (measuring || typeof indexedDB === "undefined") return;
    measuring = true;
    measureNow().then(function (next) {
      snap = next;
      measuring = false;
      requestRender();
    }).catch(function () { measuring = false; });
  }

  function totals(rows) {
    var by = {};
    ORDER.forEach(function (cat) { by[cat] = 0; });
    var total = 0;
    (rows || []).forEach(function (row) {
      var cat = by.hasOwnProperty(row.category) ? row.category : "other";
      var bytes = row.bytes || 0;
      by[cat] += bytes;
      total += bytes;
    });
    return { by: by, total: total };
  }

  function donutStyle(by, total) {
    if (!total) return "background:var(--line)";
    var acc = 0;
    var stops = [];
    ORDER.forEach(function (cat) {
      if (!by[cat]) return;
      var start = acc;
      acc += by[cat] / total * 100;
      stops.push(COLORS[cat] + " " + start.toFixed(3) + "% " + acc.toFixed(3) + "%");
    });
    return "background:conic-gradient(" + stops.join(",") + ")";
  }

  function controlsHtml() {
    var saved = currentPolicy();
    var keep = saved.keep || "week";
    var index = stepIndex(saved);
    var button = function (id, label) {
      return '<button class="outline' + (keep === id ? " on" : "") + '" type="button" data-stor="keep" data-keep="' + id + '">' + esc(label) + "</button>";
    };
    return '<div class="set-block stor-controls"><h2>' + esc(tr("Keep media")) + "</h2>" +
      '<p class="phandle">' + esc(tr("Media you have not opened in this time is removed.")) + "</p>" +
      '<div class="theme-row" role="group" aria-label="' + esc(tr("Keep media")) + '">' +
      button("3d", tr("3 days")) + button("week", tr("1 week")) + button("month", tr("1 month")) + button("forever", tr("Forever")) +
      "</div><h2>" + esc(tr("Maximum cache size")) + "</h2>" +
      '<p class="phandle" id="stor-max-label">' + esc(stepLabel(index)) + "</p>" +
      '<input class="stor-slider" id="stor-max" type="range" min="0" max="' + MAX_STEPS.length + '" step="1" value="' + index + '" aria-label="' + esc(tr("Maximum cache size")) + '" aria-valuetext="' + esc(stepLabel(index)) + '">' +
      '<button class="outline danger" type="button" data-stor="clear-all">' + esc(tr("Clear cache")) + "</button></div>";
  }

  function dataHtml() {
    var saved = currentPolicy();
    var sub = keepLabel(saved.keep) + " · " + (saved.unlimited ? tr("Unlimited") : stepLabel(stepIndex(saved)));
    return '<div class="set-list"><a class="set-row" href="#/settings/storage/usage"><span class="set-copy"><b>' + esc(tr("Storage usage")) + "</b><span class=\"set-sub\">" + esc(sub) + '</span></span><span class="set-chev" aria-hidden="true">›</span></a></div>' + controlsHtml();
  }

  function usageHtml() {
    if (!snap) kickMeasure();
    var rows = snap && snap.rows || [];
    var summed = totals(rows);
    var free = snap && snap.quota > snap.usage ? snap.quota - snap.usage : 0;
    var freeLine = snap && snap.quota ? tr("{size} free", { size: formatBytes(free) }) : (measuring ? tr("Measuring storage…") : tr("Free on this device"));
    var persistLine = snap && snap.persisted ? tr("Kept on this device") : tr("This browser can clear saved media when space is low.");
    var stats = snap && snap.stats || { hits: 0, network: 0 };
    var list = ORDER.map(function (cat) {
      var bytes = summed.by[cat] || 0;
      var width = summed.total ? Math.max(2, Math.round(bytes / summed.total * 100)) : 0;
      if (!bytes) width = 0;
      return '<div class="stor-row"><i class="stor-swatch" style="background:' + COLORS[cat] + '"></i><div class="stor-meta"><b>' + esc(catLabel(cat)) + '</b><div class="stor-bar"><i style="width:' + width + "%;background:" + COLORS[cat] + '"></i></div></div><span class="stor-size">' + esc(formatBytes(bytes)) + '</span><button class="outline stor-clear" type="button" data-stor="clear" data-cat="' + cat + '">' + esc(tr("Clear")) + "</button></div>";
    }).join("");
    return '<div class="stor-hero"><div class="stor-donut" style="' + donutStyle(summed.by, summed.total) + '" role="img" aria-label="' + esc(tr("{size} used", { size: formatBytes(summed.total) })) + '"><div class="stor-hole"><b>' + esc(formatBytes(summed.total)) + "</b><span>" + esc(tr("Storage usage")) + "</span></div></div>" +
      '<p class="stor-free">' + esc(freeLine) + "</p><p class=\"phandle\">" + esc(persistLine) + "</p></div>" +
      '<div class="stor-list">' + list + "</div>" + controlsHtml() +
      '<p class="stor-debug">' + esc(tr("Cache hits {count}", { count: String(stats.hits) })) + " · " + esc(tr("Network requests {count}", { count: String(stats.network) })) + "</p>";
  }

  function clearStored(category) {
    var run = function () {
      if (typeof caches === "undefined") return Promise.resolve();
      return caches.keys().then(function (names) {
        var chain = Promise.resolve();
        names.forEach(function (name) {
          if (/^shell-/.test(name)) return;
          chain = chain.then(function () {
            return caches.open(name).then(function (cache) {
              return cache.keys().then(function (reqs) {
                var inner = Promise.resolve();
                reqs.forEach(function (req) {
                  var cat = categoryOf(req.url);
                  if (category === "all" || cat === category) inner = inner.then(function () { return cache.delete(req); });
                });
                return inner;
              });
            });
          });
        });
        return chain;
      }).then(function () {
        return openDb().then(function (db) {
          if (category === "all") return replaceFiles(db, []);
          return listFiles(db).then(function (rows) {
            return replaceFiles(db, rows.filter(function (row) { return row.category !== category; }));
          });
        });
      }).then(function () {
        snap = null;
        kickMeasure();
      });
    };
    return run();
  }

  function onClick(event) {
    var link = event.target && event.target.closest && event.target.closest('a[href="#/settings/storage"], a[href="#/settings/storage/usage"]');
    if (link) askPersist();
    var el = event.target && event.target.closest && event.target.closest("[data-stor]");
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    var kind = el.getAttribute("data-stor");
    if (kind === "keep") {
      var next = currentPolicy();
      next.keep = el.getAttribute("data-keep") || "week";
      saveLocal(next);
      askPersist();
      requestRender();
      return;
    }
    if (kind === "clear" || kind === "clear-all") {
      var cat = kind === "clear-all" ? "all" : (el.getAttribute("data-cat") || "");
      var question = cat === "all"
        ? tr("Clear all cached media from this device?")
        : tr("Clear {category} from this device?", { category: catLabel(cat) });
      if (typeof confirm === "function" && !confirm(question)) return;
      askPersist();
      clearStored(cat);
    }
  }

  function onInput(event) {
    var el = event.target;
    if (!el || el.id !== "stor-max") return;
    var label = document.getElementById("stor-max-label");
    var text = stepLabel(Number(el.value));
    if (label) label.textContent = text;
    el.setAttribute("aria-valuetext", text);
  }

  function onChange(event) {
    var el = event.target;
    if (!el || el.id !== "stor-max") return;
    var saved = currentPolicy();
    var index = Number(el.value);
    var next = index >= MAX_STEPS.length
      ? { keep: saved.keep, maxBytes: 0, unlimited: true }
      : { keep: saved.keep, maxBytes: MAX_STEPS[index], unlimited: false };
    saveLocal(next);
    askPersist();
  }

  function start() {
    policy = loadLocal() || normalizePolicy(null);
    if (!loadLocal() && typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        if (loadLocal()) return;
        policy = normalizePolicy(null, est && est.quota);
        saveLocal(policy);
      }).catch(function () { post({ type: "storage-policy", policy: policy }); });
    } else {
      post({ type: "storage-policy", policy: policy });
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onChange, true);
    askPersist();
    window.addEventListener("viktorych-account-deleted", function () {
      post({ type: "storage-wipe" });
      clearStored("all");
    });
  }

  return {
    GB: GB,
    MAX_STEPS: MAX_STEPS,
    categoryOf: categoryOf,
    shouldCacheMedia: shouldCacheMedia,
    shouldCacheFeed: shouldCacheFeed,
    revalidateAction: revalidateAction,
    keepMs: keepMs,
    defaultMaxBytes: defaultMaxBytes,
    normalizePolicy: normalizePolicy,
    planEviction: planEviction,
    mediaFresh: mediaFresh,
    parseByteRange: parseByteRange,
    rangeResponse: rangeResponse,
    sliceCached: sliceCached,
    byteLengthOf: byteLengthOf,
    formatBytes: formatBytes,
    openDb: openDb,
    readPolicy: readPolicy,
    writePolicy: writePolicy,
    getFile: getFile,
    putFile: putFile,
    listFiles: listFiles,
    replaceFiles: replaceFiles,
    touch: touch,
    bump: bump,
    readStats: readStats,
    dataHtml: dataHtml,
    usageHtml: usageHtml,
    start: start
  };
});
