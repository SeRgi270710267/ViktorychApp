/* Local-first snapshots. Structured screens live in IndexedDB, the last
   painted shell lives in localStorage, and offline likes, reposts, bookmarks,
   follows, drafts, and replies wait in one idempotent queue. Notification
   read state always follows the server cursor. Auth responses are never stored. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychLocal = api;
  if (typeof document !== "undefined") api.start();
})(typeof self !== "undefined" ? self : this, function () {
  var SCREEN_KEY = "viktorych-screen-v1";
  var SCROLL_KEY = "viktorych-scrolls-v1";
  var PILL_KEY = "viktorych-pill-v1";
  var QUEUE_KEY = "viktorych-actions-v1";
  var OPENS_KEY = "viktorych-opens-v1";
  var SCREEN_LIMIT = 180000;
  var state = { queue: [], scrolls: {}, opens: {}, restored: false, screen: null };
  var scrollTimer = 0;

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

  function storageApi() {
    if (typeof self !== "undefined" && self.ViktorychStorage) return self.ViktorychStorage;
    if (typeof require === "function") {
      try { return require("./storage.js"); } catch (err) { return null; }
    }
    return null;
  }

  function readJson(storage, key) {
    try {
      if (!storage) return null;
      var raw = storage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) { return null; }
  }

  function writeJson(storage, key, value) {
    try {
      if (!storage) return;
      if (value == null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch (err) { /* private mode keeps the in-memory copy */ }
  }

  function local() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (err) { return null; }
  }

  function canCache(url) {
    var api = storageApi();
    if (!api) return false;
    if (api.categoryOf(url) === "") return false;
    return !!(api.shouldCacheFeed(url) || api.shouldCacheMedia(url));
  }

  function createStore() {
    var docs = {};
    return {
      put: function (category, id, body) { docs[category + ":" + id] = body; },
      get: function (category, id) { return Object.prototype.hasOwnProperty.call(docs, category + ":" + id) ? docs[category + ":" + id] : null; }
    };
  }

  function mergeNotes(cached, server) {
    var hasServer = !!(server && typeof server === "object");
    var readThrough = hasServer && server.readThrough != null
      ? Number(server.readThrough) || 0
      : Number(cached && cached.readThrough) || 0;
    var seen = {};
    var seenList = hasServer && Array.isArray(server.seen) ? server.seen : (!hasServer && cached && Array.isArray(cached.seen) ? cached.seen : []);
    seenList.forEach(function (id) { if (id != null) seen[String(id)] = true; });
    var fill = {};
    ((cached && cached.notes) || []).forEach(function (note) {
      if (note && note.id != null) fill[String(note.id)] = note;
    });
    var source = hasServer && Array.isArray(server.notes) ? server.notes : ((cached && cached.notes) || []);
    var notes = source.map(function (note) {
      var id = note && note.id != null ? String(note.id) : "";
      var extra = fill[id] || {};
      var at = Number(note && note.at != null ? note.at : extra.at) || 0;
      return {
        id: id,
        text: (note && note.text) || extra.text || "",
        at: at,
        unread: at > readThrough && !seen[id]
      };
    });
    return { notes: notes, readThrough: readThrough, seen: Object.keys(seen) };
  }

  function renderScreen(route, body, server) {
    var doc = body || {};
    if (route === "home") {
      var posts = Array.isArray(doc.posts) ? doc.posts : [];
      return '<h1>' + esc(tr("Home")) + '</h1><div data-screen="home">' + posts.map(function (post) {
        return '<article class="card">' + esc(post && post.text || "") + "</article>";
      }).join("") + "</div>";
    }
    if (route === "profile") {
      return '<h1>' + esc(doc.name || tr("Profiles")) + '</h1><div data-screen="profile"><p class="bio">' + esc(doc.bio || "") + "</p>" + (doc.pinned ? '<article class="pinned">' + esc(doc.pinned.text || "") + "</article>" : "") + "</div>";
    }
    if (route === "post") {
      var post = doc.post || {};
      var parent = doc.parent && doc.parent.text ? '<article class="parent">' + esc(doc.parent.text) + "</article>" : "";
      var quote = doc.quote && doc.quote.text ? '<article class="quote">' + esc(doc.quote.text) + "</article>" : "";
      var replies = (doc.replies || []).map(function (reply) {
        return '<article class="reply">' + esc(reply && reply.text || "") + "</article>";
      }).join("");
      return '<h1>' + esc(tr("Post threads")) + '</h1><div data-screen="post">' + parent + '<article class="card">' + esc(post.text || "") + "</article>" + quote + replies + "</div>";
    }
    if (route === "notifications") {
      var merged = mergeNotes(doc, server || null);
      return '<h1>' + esc(tr("Notifications")) + '</h1><div class="notes" data-screen="notifications">' + merged.notes.map(function (note) {
        return '<article class="note-row' + (note.unread ? "" : " is-read") + '" data-unread="' + (note.unread ? "1" : "0") + '">' + esc(note.text || "") + "</article>";
      }).join("") + "</div>";
    }
    return '<div data-screen="empty"></div>';
  }

  function bootOffline(opts) {
    var options = opts || {};
    var network = false;
    if (typeof options.fetch === "function") {
      try {
        options.fetch("https://app.local/feeds.json");
        network = true;
      } catch (err) { network = false; }
    }
    if (network) return { html: "", spinner: true, offline: false };
    var route = options.route || "home";
    var kind = route === "post" ? "threads" : route === "profile" ? "profiles" : route === "notifications" ? "notifications" : "feeds";
    var id = options.id || (route === "profile" ? "profile" : route === "post" ? "post" : route === "notifications" ? "all" : "home");
    var body = options.docs && options.docs.get ? options.docs.get(kind, id) : null;
    var html = renderScreen(route, body, options.server || null);
    return { html: html, spinner: html.indexOf("skel") >= 0, offline: true };
  }

  function actionKey(action) {
    return String(action && action.type || "") + ":" + String(action && action.id || "");
  }

  function enqueueList(queue, action) {
    if (!action || !action.type || action.id == null) return (queue || []).slice();
    var key = actionKey(action);
    var next = (queue || []).filter(function (item) { return item && actionKey(item) !== key; });
    next.push({
      type: action.type,
      id: String(action.id),
      on: !!action.on,
      body: action.body || "",
      postKey: action.postKey || "",
      snapshot: action.snapshot || null,
      at: action.at || Date.now(),
      pending: true
    });
    return next.slice(-200);
  }

  function flushList(queue, send) {
    var seen = {};
    (queue || []).forEach(function (action) {
      if (!action || action.pending === false) return;
      seen[actionKey(action)] = action;
    });
    var left = [];
    Object.keys(seen).forEach(function (key) {
      var action = seen[key];
      var ok = true;
      try { ok = send ? send(action) !== false : true; }
      catch (err) { ok = false; }
      if (!ok) left.push(action);
    });
    return left;
  }

  function connectionInfo(conn) {
    var raw = conn;
    if (!raw && typeof navigator !== "undefined") raw = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    raw = raw || {};
    return {
      saveData: !!raw.saveData,
      effectiveType: raw.effectiveType || "4g",
      type: raw.type || "",
      metered: !!raw.metered || raw.type === "cellular"
    };
  }

  function prefetchEnabled(policy) {
    if (policy && policy.prefetch === false) return false;
    if (policy && policy.prefetch === true) return true;
    var saved = readJson(local(), "viktorychapp-storage");
    return !(saved && saved.prefetch === false);
  }

  function prefetchLimit(conn, enabled) {
    if (!enabled) return 0;
    var info = connectionInfo(conn);
    if (info.saveData) return 0;
    if (info.effectiveType === "slow-2g" || info.effectiveType === "2g") return 0;
    if (info.metered && info.effectiveType !== "4g") return 0;
    if (info.metered) return 3;
    if (info.effectiveType === "3g") return 2;
    return 8;
  }

  function displayImage(url, cssPx) {
    var value = String(url || "");
    if (!value) return "";
    var width = Math.max(64, Math.round(Number(cssPx) || 480));
    var name = width < 400 ? "small" : width < 900 ? "medium" : "large";
    if (/pbs\.twimg\.com/i.test(value) && /[?&]name=/.test(value)) return value.replace(/name=(?:small|medium|large|orig)/i, "name=" + name);
    if (/pbs\.twimg\.com/i.test(value)) return value + (value.indexOf("?") >= 0 ? "&" : "?") + "name=" + name;
    return value;
  }

  function isFirstSegment(url) {
    return /\.(?:m4s|ts|cmfv|cmfa)(?:\?|$)/i.test(String(url || ""));
  }

  function mediaPlan(items, conn, enabled) {
    var limit = prefetchLimit(conn, enabled);
    var posters = [];
    var first = [];
    var ahead = [];
    (items || []).forEach(function (item, index) {
      if (!item) return;
      if (item.poster) posters.push(item.poster);
      if (item.first && isFirstSegment(item.first)) first.push(item.first);
      var image = item.image ? displayImage(item.image, item.width || 480) : "";
      if (image && index < limit) ahead.push(image);
    });
    return { posters: posters, first: first, ahead: ahead, limit: limit };
  }

  function rankOpens(counts, limit) {
    return Object.keys(counts || {}).sort(function (a, b) {
      return (counts[b] || 0) - (counts[a] || 0) || (a < b ? -1 : 1);
    }).slice(0, limit || 3);
  }

  function defaultRoute(hash) {
    var value = hash || "";
    return value === "" || value === "#" || value === "#/" || value === "#/home";
  }

  function capture(info) {
    var html = String(info && info.html || "");
    if (html.length > SCREEN_LIMIT) html = html.slice(0, SCREEN_LIMIT);
    var screen = {
      hash: info && info.hash || "#/",
      html: html,
      scrollKey: info && info.scrollKey || "",
      y: Number(info && info.y) || 0,
      at: Date.now()
    };
    state.screen = screen;
    writeJson(local(), SCREEN_KEY, screen);
    if (info && info.scrolls) {
      state.scrolls = info.scrolls;
      writeJson(local(), SCROLL_KEY, info.scrolls);
    }
    return screen;
  }

  function noteOpen(hash) {
    var key = String(hash || "#/");
    state.opens[key] = (state.opens[key] || 0) + 1;
    writeJson(local(), OPENS_KEY, state.opens);
    return rankOpens(state.opens, 3);
  }

  function noteScroll(key, y, map) {
    if (!key) return;
    state.scrolls[key] = y;
    if (map) state.scrolls = map;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () { writeJson(local(), SCROLL_KEY, state.scrolls); }, 300);
  }

  function readScrolls() {
    return state.scrolls && Object.keys(state.scrolls).length ? state.scrolls : (readJson(local(), SCROLL_KEY) || {});
  }

  function savePill(posts) {
    var list = (posts || []).filter(Boolean).slice(0, 40);
    writeJson(local(), PILL_KEY, list.length ? list : null);
    return list;
  }

  function readPill() {
    var saved = readJson(local(), PILL_KEY);
    return Array.isArray(saved) ? saved : [];
  }

  function enqueue(action) {
    state.queue = enqueueList(state.queue, action);
    writeJson(local(), QUEUE_KEY, state.queue);
    paintPending();
    return state.queue;
  }

  function flush(send) {
    state.queue = flushList(state.queue, send);
    writeJson(local(), QUEUE_KEY, state.queue.length ? state.queue : null);
    paintPending();
    return state.queue;
  }

  function pending() {
    return (state.queue || []).filter(function (action) { return action && action.pending !== false; });
  }

  function paintPending(root) {
    if (typeof document === "undefined") return;
    var scope = root || document;
    var ids = {};
    pending().forEach(function (action) { ids[action.type + ":" + action.id] = true; });
    var buttons = scope.querySelectorAll ? scope.querySelectorAll("[data-act='like'],[data-act='bookmark'],[data-act='follow'],[data-act='repost-do']") : [];
    Array.prototype.forEach.call(buttons, function (btn) {
      var on = !!ids[(btn.getAttribute("data-act") || "") + ":" + (btn.getAttribute("data-id") || btn.getAttribute("data-ids") || "")];
      btn.classList.toggle("is-pending", on);
      if (on) btn.setAttribute("title", tr("Pending"));
    });
  }

  function saveDoc(category, id, body, etag) {
    var api = storageApi();
    if (!api || typeof indexedDB === "undefined") return Promise.resolve(null);
    var text = "";
    try { text = JSON.stringify(body == null ? null : body); } catch (err) { text = ""; }
    return api.openDb().then(function (db) {
      return api.putDoc(db, { category: category, id: id, body: body, etag: etag || "", bytes: text.length });
    }).catch(function () { return null; });
  }

  function postCache(urls) {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    var list = (urls || []).filter(function (url) { return /^https:/.test(url || "") && canCache(url); });
    if (!list.length) return;
    var worker = navigator.serviceWorker.controller;
    if (!worker) return;
    try { worker.postMessage({ type: "cache-media", urls: list.slice(0, 24) }); } catch (err) { /* the worker may be restarting */ }
  }

  function warmMedia(root) {
    if (typeof document === "undefined" || !root || !root.querySelectorAll) return [];
    var limit = prefetchLimit(null, prefetchEnabled());
    if (!limit) return [];
    var nodes = root.querySelectorAll("article");
    var urls = [];
    for (var i = 1; i < nodes.length && urls.length < limit; i++) {
      var img = nodes[i].querySelector("img");
      if (img) {
        var src = img.currentSrc || img.src || "";
        if (src) urls.push(displayImage(src, img.clientWidth || 480));
      }
      var video = nodes[i].querySelector("video");
      if (video && video.poster) urls.push(video.poster);
      var source = video && (video.currentSrc || video.src || "");
      if (source && isFirstSegment(source)) urls.push(source);
    }
    postCache(urls);
    return urls;
  }

  function warmOpens() {
    var top = rankOpens(state.opens, 3);
    if (!prefetchLimit(null, prefetchEnabled())) return top;
    if (typeof fetch === "function") {
      fetch("feeds.json", { cache: "force-cache" }).catch(function () {});
    }
    if (typeof window !== "undefined" && window.dispatchEvent) {
      try { window.dispatchEvent(new CustomEvent("viktorych-warm", { detail: top })); } catch (err) { /* older webviews still warmed the feed */ }
    }
    return top;
  }

  function wasRestored() {
    return !!state.restored;
  }

  function restoreEarly() {
    var saved = readJson(local(), SCREEN_KEY);
    state.scrolls = readJson(local(), SCROLL_KEY) || {};
    state.queue = readJson(local(), QUEUE_KEY) || [];
    state.opens = readJson(local(), OPENS_KEY) || {};
    if (!Array.isArray(state.queue)) state.queue = [];
    var app = typeof document !== "undefined" ? document.getElementById("app") : null;
    if (saved && saved.html && app && !app.childElementCount) {
      app.innerHTML = saved.html;
      document.documentElement.classList.add("is-restored");
      state.restored = true;
      state.screen = saved;
    }
    if (saved && saved.hash && typeof location !== "undefined" && defaultRoute(location.hash)) {
      if (saved.hash !== location.hash) {
        try { location.replace(location.pathname + location.search + saved.hash); } catch (err) { /* the hash can stay */ }
      }
    }
    return state.restored;
  }

  function wipe() {
    state.queue = [];
    state.scrolls = {};
    state.opens = {};
    state.screen = null;
    state.restored = false;
    var store = local();
    [SCREEN_KEY, SCROLL_KEY, PILL_KEY, QUEUE_KEY, OPENS_KEY].forEach(function (key) { writeJson(store, key, null); });
    var api = storageApi();
    if (api && typeof indexedDB !== "undefined") {
      api.openDb().then(function (db) { return api.clearDocs(db, "all"); }).catch(function () {});
    }
  }

  function syncSender(action) {
    var app = typeof window !== "undefined" ? window.ViktorychAppSync : null;
    if (!app) return true;
    try { return app(action) !== false; }
    catch (err) { return false; }
  }

  function start() {
    restoreEarly();
    document.addEventListener("play", function (event) {
      var el = event.target;
      if (!el || (el.tagName !== "VIDEO" && el.tagName !== "AUDIO")) return;
      var url = el.currentSrc || el.src || "";
      if (/^https:/.test(url)) postCache([url]);
    }, true);
    window.addEventListener("online", function () { flush(syncSender); });
    window.addEventListener("viktorych-account-deleted", wipe);
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 800); };
    idle(function () { warmOpens(); });
  }

  return {
    canCache: canCache,
    createStore: createStore,
    mergeNotes: mergeNotes,
    renderScreen: renderScreen,
    bootOffline: bootOffline,
    enqueueList: enqueueList,
    flushList: flushList,
    connectionInfo: connectionInfo,
    prefetchEnabled: prefetchEnabled,
    prefetchLimit: prefetchLimit,
    displayImage: displayImage,
    isFirstSegment: isFirstSegment,
    mediaPlan: mediaPlan,
    rankOpens: rankOpens,
    capture: capture,
    noteOpen: noteOpen,
    noteScroll: noteScroll,
    readScrolls: readScrolls,
    savePill: savePill,
    readPill: readPill,
    enqueue: enqueue,
    flush: flush,
    pending: pending,
    paintPending: paintPending,
    saveDoc: saveDoc,
    warmMedia: warmMedia,
    warmOpens: warmOpens,
    wasRestored: wasRestored,
    restoreEarly: restoreEarly,
    wipe: wipe,
    start: start
  };
});
