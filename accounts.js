/* Sign-up, sign-in, and the logged-out landing. The reader stays as it is
   until accounts.config.js has gate:true, which the deploy sets only after
   the account API is healthy. */
(function () {
  var RETURN_KEY = "viktorychapp-return-v1";
  var PENDING_KEY = "viktorychapp-pending-v1";
  var DELETED_KEY = "viktorychapp-deleted-v1";
  var deleteState = { phase: "", error: "", step: -1, accountNumber: "", handle: "", busy: false };
  var DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$|^data\/music\.json$|^(?:live|archive|comments|fallback)\/[A-Za-z0-9._-]{1,120}\.json$|^discord\/(?:index|state)\.json$|^discord\/(?:messages|pins)\/\d{1,22}\.json$|^data\/communities\/(?:index|[a-z0-9_]{2,21})\.json$|^data\/communities\/[a-z0-9_]{2,21}\/\d{1,20}\.json$/;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var profiles = {};
  var profileLoads = {};
  var profileMiss = {};
  var profileEpoch = {};
  var entered = false;
  var view = "";
  var gallery = { open: false, kind: "photo", index: 0 };
  var profileTabEdit = false;
  var profileTabDrag = null;
  var mediaManagerLoaded = false;
  var idCopied = false;
  var step = 0;
  var form = {};
  var errorText = "";
  var legalTitle = "";
  var legalKey = "";
  var authBusy = false;
  var painted = "";
  var pushTimer = 0;
  var pushing = false;
  var friendsCache = {};
  var friendsLoads = {};
  var friendRequestsCache = { incoming: [], outgoing: [] };
  /* Pending friend requests survive a reload: the last server list is kept
     per account in localStorage, so the profile button shows Request Sent
     (or Confirm) at first paint instead of Add friend. */
  var FRIEND_REQ_KEY = "friend-req-v1";
  function friendReqHandles(list) {
    return (list || []).map(function (r) { return String((r && r.handle) || "").replace(/^@/, "").toLowerCase(); }).filter(Boolean).slice(0, 200);
  }
  function friendReqOwner() {
    var session = readSession();
    return session && session.account ? String(session.account.publicId || session.account.handle || "") : "";
  }
  function saveFriendReqs() {
    var owner = friendReqOwner();
    if (!owner) return;
    writeStored(FRIEND_REQ_KEY, JSON.stringify({ owner: owner, out: friendReqHandles(friendRequestsCache.outgoing), inc: friendReqHandles(friendRequestsCache.incoming) }));
  }
  function storedFriendReqs() {
    try {
      var raw = JSON.parse(readStored(FRIEND_REQ_KEY) || "null");
      if (!raw || raw.owner !== friendReqOwner()) return { out: [], inc: [] };
      return { out: Array.isArray(raw.out) ? raw.out : [], inc: Array.isArray(raw.inc) ? raw.inc : [] };
    } catch (err) { return { out: [], inc: [] }; }
  }
  function pendingFriendStatus(handle) {
    var h = String(handle || "").replace(/^@/, "").toLowerCase();
    if (!h) return "";
    var live = friendRequestsLoaded ? { out: friendReqHandles(friendRequestsCache.outgoing), inc: friendReqHandles(friendRequestsCache.incoming) } : storedFriendReqs();
    if (live.out.indexOf(h) >= 0) return "sent";
    if (live.inc.indexOf(h) >= 0) return "received";
    return "";
  }
  var friendRequestsLoaded = false;
  var friendReqTriedAt = 0;
  var friendRequestsLoading = false;
  var friendReqFetchedAt = 0;
  var friendsFailedAt = {};
  var friendsSearchQuery = "";
  var friendsSubTab = "all";
  var unfriendTarget = null;
  var reportState = { items: [], loading: false };

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function appName() {
    return window.SI18n && window.SI18n.productName ? window.SI18n.productName("app") : "";
  }
  function config() {
    return window.VIKTORYCH_ACCOUNTS || { api: "", gate: false, turnstileSiteKey: "" };
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function names(suffix) {
    return ["viktorychapp-" + suffix, "superintelapp-" + suffix, "rss-" + "feeds-" + suffix];
  }
  function readStored(suffix) {
    try {
      var list = names(suffix);
      var current = localStorage.getItem(list[0]);
      if (current != null) return current;
      for (var i = 1; i < list.length; i++) {
        var found = localStorage.getItem(list[i]);
        if (found != null) {
          try { localStorage.setItem(list[0], found); } catch (err) { /* keep the older copy */ }
          return found;
        }
      }
    } catch (err) { /* private mode */ }
    return null;
  }
  function writeStored(suffix, value) {
    try { localStorage.setItem("viktorychapp-" + suffix, value); } catch (err) { /* full quota */ }
  }
  function removeStored(suffix) {
    names(suffix).forEach(function (name) {
      try { localStorage.removeItem(name); } catch (err) { /* already gone */ }
    });
  }
  function readSession() {
    try {
      var raw = readStored("account-v1");
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.token || !parsed.account) return null;
      return parsed;
    } catch (err) {
      removeStored("account-v1");
      return null;
    }
  }
  function writeSession(session) {
    writeStored("account-v1", JSON.stringify(session));
  }
  function readPending() {
    try {
      var raw = sessionStorage.getItem(PENDING_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.token || !parsed.accountNumber) return null;
      return parsed;
    } catch (err) { return null; }
  }
  function writePending(pending) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (err) { /* the number step stays in memory */ }
  }
  function clearPending() {
    try { sessionStorage.removeItem(PENDING_KEY); } catch (err) { /* already gone */ }
  }
  function grouped(digits) {
    return String(digits || "").replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  function skel(handle) {
    var api = window.HandleSkeleton;
    if (api && api.skeleton) return api.skeleton(handle);
    return String(handle || "").toLowerCase();
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    var text = parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : (parts[0] || "?").slice(0, 1);
    return text.toUpperCase();
  }
  function mark(cls) {
    var marks = window.ViktorychMarks || {};
    var icon = marks.mark || { box: "0 0 1 1", body: "" };
    return '<svg class="' + cls + '" viewBox="' + icon.box + '" fill="currentColor" aria-hidden="true">' + icon.body + "</svg>";
  }
  function badge() {
    return '<span class="vbadge exclusive" aria-label="' + esc(tr("Official")) + '"><svg viewBox="0 0 22 22"><path d="M20.4 11.2l-1.6-2.2.2-2.6-2.5-.8-1.4-2.2-2.5.4L10.5 2 8.4 3.8 5.9 3.4 4.5 5.6 2 6.4l.2 2.6L.6 11.2l1.6 2.2-.2 2.6 2.5.8 1.4 2.2 2.5-.4 2.1 1.8 2.1-1.8 2.5.4 1.4-2.2 2.5-.8-.2-2.6 1.6-2.2zM9.4 14.6l-2.5-2.5 1.2-1.2 1.3 1.3 3.5-3.5 1.2 1.2-4.7 4.7z"/></svg></span>';
  }
  function blocking() {
    return !!(config().gate && !readSession());
  }
  function installedApp() {
    try {
      if (navigator.standalone === true) return true;
      if (window.matchMedia) {
        if (window.matchMedia("(display-mode: standalone)").matches) return true;
        if (window.matchMedia("(display-mode: window-controls-overlay)").matches) return true;
      }
    } catch (err) { /* a normal browser tab still gets the landing page */ }
    return false;
  }
  function showLanding() {
    return blocking() && !installedApp();
  }
  function tellSW(on, wipe) {
    if (wipe === "signout" && window.ViktorychLocal) window.ViktorychLocal.wipe();
    if (!navigator.serviceWorker) return;
    var session = on ? readSession() : null;
    var msg = { type: "auth", on: !!on, token: session && session.token ? session.token : "", wipe: wipe || "" };
    try {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    } catch (err) { /* the worker may still be installing */ }
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.active) reg.active.postMessage(msg);
    }).catch(function () {});
  }
  function pageBase() {
    var path = location.pathname || "/";
    if (/\/index\.html$/i.test(path)) path = path.slice(0, -"index.html".length);
    if (path.slice(-1) !== "/") path = path.replace(/[^/]*$/, "");
    return path || "/";
  }
  function dataKey(url) {
    if (url.origin === location.origin) {
      var path = url.pathname || "";
      var base = pageBase();
      if (base !== "/" && path.indexOf(base) === 0) path = path.slice(base.length);
      path = path.replace(/^\/+/, "");
      if (path === "archive/ia-state.json" || path === "archive/ia-manifest.json") return "BLOCK";
      return DATA_KEY.test(path) ? path : "";
    }
    var raw = (url.pathname || "").match(/\/data\/((?:archive|live|comments|fallback)\/[^/?#]+\.json|stories\.json|feeds\.json)$/);
    if (raw && (url.hostname === "raw.githubusercontent.com" || url.hostname === "cdn.jsdelivr.net")) return raw[1];
    var cdn = (url.pathname || "").match(/@data\/((?:archive|live|comments|fallback)\/[^/?#]+\.json|stories\.json)$/);
    if (cdn && url.hostname === "cdn.jsdelivr.net") return cdn[1];
    if (config().gate && /(^|\.)archive\.org$/.test(url.hostname)) return "BLOCK";
    if (config().gate && !readSession() && /(^|\.)r2\.dev$/.test(url.hostname)) return "BLOCK";
    if (config().gate && (url.hostname === "raw.githubusercontent.com" || url.hostname === "cdn.jsdelivr.net") && /\/data\//.test(url.pathname || "")) return "BLOCK";
    return "";
  }
  function installFetch() {
    if (!nativeFetch || window.fetch === patchedFetch) return;
    window.fetch = patchedFetch;
  }
  var activeApiRoot = "";
  /* Circuit breaker per API root, shared by every tab through localStorage.
     A 429, a 5xx gateway answer, or a network error opens the root for a
     backoff with full jitter (Retry-After is the floor). While it is open,
     calls go to the next root. The first root that is not open wins, so the
     primary comes back on its own once its wait ends. */
  var BREAKER_KEY = "viktorychapp-breaker-v1";
  var breakerMemo = null;
  var breakerMemoAt = 0;
  function breakerRead() {
    var now = Date.now();
    if (breakerMemo && now - breakerMemoAt < 1000) return breakerMemo;
    var all = null;
    try { all = JSON.parse(localStorage.getItem(BREAKER_KEY) || "{}"); }
    catch (err) { all = null; }
    breakerMemo = all && typeof all === "object" ? all : {};
    breakerMemoAt = now;
    return breakerMemo;
  }
  function breakerWrite(all) {
    breakerMemo = all;
    breakerMemoAt = Date.now();
    try {
      if (Object.keys(all).length) localStorage.setItem(BREAKER_KEY, JSON.stringify(all));
      else localStorage.removeItem(BREAKER_KEY);
    } catch (err) { /* this tab still keeps it in memory */ }
  }
  function breakerOpenUntil(root) {
    var row = breakerRead()[root];
    return row && Number(row.until) > Date.now() ? Number(row.until) : 0;
  }
  function breakerFail(root, retryAfter) {
    if (!root) return;
    var all = breakerRead();
    var row = all[root] || { n: 0 };
    row.n = Math.min(Number(row.n || 0) + 1, 8);
    var cap = Math.min(5 * 60 * 1000, 2000 * Math.pow(2, row.n - 1));
    var floor = Math.max(1000, Number(retryAfter) || 0);
    row.until = Date.now() + Math.max(floor, Math.floor(Math.random() * cap));
    all[root] = row;
    breakerWrite(all);
  }
  function breakerOk(root) {
    var all = breakerRead();
    if (!all[root]) return;
    delete all[root];
    breakerWrite(all);
  }
  function retryAfterMs(res) {
    var raw = res && res.headers && res.headers.get ? res.headers.get("Retry-After") : "";
    var secs = Number(raw);
    if (raw && isFinite(secs)) return Math.min(10 * 60 * 1000, Math.max(0, secs * 1000));
    var when = raw ? Date.parse(raw) : NaN;
    return isFinite(when) ? Math.min(10 * 60 * 1000, Math.max(0, when - Date.now())) : 0;
  }
  function failoverStatus(code) {
    return code === 429 || code === 502 || code === 503 || code === 504;
  }
  /* Roots in the order to try: closed ones first, in config order, then the
     open one whose wait ends soonest so the app is never fully stuck. */
  function apiOrder() {
    var list = apiEndpoints();
    var closed = list.filter(function (root) { return !breakerOpenUntil(root); });
    if (closed.length) return closed;
    var soonest = list.slice().sort(function (a, b) { return breakerOpenUntil(a) - breakerOpenUntil(b); });
    return soonest.slice(0, 1);
  }
  function apiEndpoints() {
    var c = config();
    var list = [];
    if (Array.isArray(c.apis)) list = list.concat(c.apis);
    if (c.api && list.indexOf(c.api) === -1) list.unshift(c.api);
    if (c.backupApi && list.indexOf(c.backupApi) === -1) list.push(c.backupApi);
    return list.map(function (u) { return String(u || "").replace(/\/$/, ""); }).filter(Boolean);
  }
  function currentApi() {
    var order = bySpeed(apiOrder());
    activeApiRoot = order[0] || String(config().api || "").replace(/\/$/, "");
    return activeApiRoot;
  }
  function rotateApi(failedRoot, retryAfter) {
    breakerFail(failedRoot || activeApiRoot, retryAfter);
    activeApiRoot = "";
    wakeBackup(failedRoot);
  }
  /* The free Render backup sleeps when idle and takes up to a minute to
     wake. The moment the main API stumbles, one tiny no-cors ping starts
     that wake in the background, so by the time a retry or the next read
     goes to the backup it answers at once. At most once per four minutes. */
  var wakeAt = 0;
  function wakeBackup(failedRoot) {
    var backup = String(config().backupApi || "").replace(/\/$/, "");
    if (!backup || backup === String(failedRoot || "").replace(/\/$/, "") || !nativeFetch) return;
    var now = Date.now();
    if (now - wakeAt < 4 * 60 * 1000) return;
    wakeAt = now;
    try {
      nativeFetch(backup + "/backup/health", { mode: "no-cors", cache: "no-store", credentials: "omit", keepalive: true }).catch(function () {});
    } catch (err) { /* best effort */ }
  }
  function hasApi() {
    return !!(currentApi() || (config().api || config().backupApi));
  }
  function mirrorPageFetch(input, init, url) {
    var api = window.ViktorychMirror;
    if (!api || !api.mirrorHost(location.hostname)) return nativeFetch(input, init);
    var method = (init && init.method) || (typeof input !== "string" && input && input.method) || "GET";
    if (String(method).toUpperCase() !== "GET" || url.origin !== location.origin) return nativeFetch(input, init);
    var root = api.appRoot(location.origin, location.pathname, location.hostname);
    var rel = api.relativeTo(root, url.href);
    if (!rel || /^(?:v1\/|tg\/|ap\/|\.well-known\/)/.test(rel)) return nativeFetch(input, init);
    return nativeFetch(input, init).then(function (res) {
      if (!api.failoverStatus(res.status)) return res;
      return mirrorPageRetry(rel, res);
    }).catch(function () {
      return mirrorPageRetry(rel, null);
    });
  }
  function mirrorPageRetry(rel, fallback) {
    var api = window.ViktorychMirror;
    var root = api.appRoot(location.origin, location.pathname, location.hostname);
    var bases = api.bases(root, "", "").filter(function (base) { return base !== api.normalizeBase(root); });
    var next = bases.length ? api.rewrite(bases[0], rel) : "";
    if (!next) return fallback || Promise.reject(new Error("fetch"));
    return nativeFetch(next, { method: "GET", mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
      if (res && res.ok && res.type !== "opaque") return res;
      return fallback || res;
    }).catch(function () {
      if (fallback) return fallback;
      return Promise.reject(new Error("fetch"));
    });
  }
  function patchedFetch(input, init) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    var url;
    try { url = new URL(raw, location.href); }
    catch (err) { return nativeFetch(input, init); }
    if (url.origin === location.origin && /(^|\/)v1\//.test(url.pathname)) return nativeFetch(input, init);
    var key = dataKey(url);
    if (!key || !config().gate) return mirrorPageFetch(input, init, url);
    var session = readSession();
    if (key === "BLOCK" || !session) return Promise.resolve(new Response("", { status: 401 }));
    var order = apiOrder();
    if (!order.length) return Promise.resolve(new Response("", { status: 401 }));
    var headers = new Headers(init && init.headers || (typeof input !== "string" && input && input.headers) || {});
    headers.set("Authorization", "Bearer " + session.token);
    var blockList = /^(?:feeds\.json|(?:comments|live)\/)/.test(key) ? blockHeader() : "";
    if (blockList) headers.set("X-Block", blockList);
    var held = blockList ? null : pulseHeld(key);
    if (held) return Promise.resolve(new Response(held.text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-pulse": "reuse" } }));
    var mark = blockList ? "" : pulseMark(key);
    var path = "/v1/data/" + key.split("/").map(encodeURIComponent).join("/");
    function attempt(i) {
      var apiRoot = order[i];
      return nativeFetch(apiRoot + path, {
        method: "GET",
        headers: headers,
        credentials: "omit",
        cache: "no-store"
      }).then(function (res) {
        if (failoverStatus(res.status)) {
          rotateApi(apiRoot, retryAfterMs(res));
          if (i + 1 < order.length) return attempt(i + 1);
          return res;
        }
        breakerOk(apiRoot);
        if (res.status === 200 && mark) pulseKeep(key, mark, res.clone());
        return res;
      }, function (err) {
        rotateApi(apiRoot, 0);
        if (i + 1 < order.length) return attempt(i + 1);
        throw err;
      });
    }
    return attempt(0);
  }
  /* Shared documents the pulse tracks. While the pulse is up and a
     document's mark has not moved, the last copy answers without a request.
     Every copy is read again after fifteen minutes regardless. */
  var pulseBodies = {};
  var PULSE_REUSE_MS = 15 * 60 * 1000;
  function pulseMark(key) {
    var p = window.ViktorychPulse;
    return p && p.ok && p.ok() ? String(p.version(key) || "") : "";
  }
  function pulseHeld(key) {
    var row = pulseBodies[key];
    if (!row) return null;
    var mark = pulseMark(key);
    if (!mark || mark !== row.mark || Date.now() - row.at > PULSE_REUSE_MS || row.token !== sessionTail()) return null;
    return row;
  }
  function pulseKeep(key, mark, res) {
    res.text().then(function (text) {
      if (typeof text !== "string" || text.length > 4 * 1024 * 1024) return;
      pulseBodies[key] = { mark: mark, text: text, at: Date.now(), token: sessionTail() };
    }).catch(function () {});
  }
  function sessionTail() {
    var session = readSession();
    return session && session.token ? String(session.token).slice(-12) : "";
  }
  /* Last ETag and body per GET, in memory, so repeat reads can answer 304. */
  var etagHeld = {};
  var etagOrder = [];
  function etagKey(url, token) {
    return url + "#" + (token ? String(token).slice(-12) : "");
  }
  function keepEtag(key, tag, text) {
    if (!key || !tag || typeof text !== "string" || text.length > 262144) return;
    if (!etagHeld[key]) etagOrder.push(key);
    etagHeld[key] = { tag: tag, text: text };
    while (etagOrder.length > 60) delete etagHeld[etagOrder.shift()];
  }
  /* The device's blocklist as hashed keys only (see shared/blocklist.js), so
     the server drops blocked posts and comments before they are sent. */
  var BLOCK_PATH = /^\/v1\/(?:posts|communities|x\/thread|thread)(?:[/?]|$)/;
  function blockHeader() {
    try { return String(localStorage.getItem("viktorychapp-block-h") || ""); }
    catch (err) { return ""; }
  }
  /* How fast each API root answered lately, kept per device. A root that
     stalls (DPI throttling looks like a hang, not an error) drops behind a
     faster one until it is quick again. */
  var SPEED_KEY = "viktorychapp-api-speed-v1";
  var speedMemo = null;
  function speedRead() {
    if (speedMemo) return speedMemo;
    try { speedMemo = JSON.parse(localStorage.getItem(SPEED_KEY) || "{}") || {}; }
    catch (err) { speedMemo = {}; }
    return speedMemo;
  }
  function speedNote(root, ms) {
    if (!root || !(ms >= 0)) return;
    var all = speedRead();
    var row = all[root] || {};
    row.ms = row.ms ? Math.round(row.ms * 0.7 + ms * 0.3) : Math.round(ms);
    row.at = Date.now();
    all[root] = row;
    try { localStorage.setItem(SPEED_KEY, JSON.stringify(all)); } catch (err) { /* memory still has it */ }
  }
  function speedOf(root) {
    var row = speedRead()[root];
    if (!row || !row.ms || Date.now() - Number(row.at || 0) > 6 * 3600 * 1000) return 0;
    return Number(row.ms) || 0;
  }
  /* Keep config order, except that a root averaging over 2.5 s goes behind
     one that is at least 3x faster. */
  function bySpeed(list) {
    if (list.length < 2) return list;
    var first = list[0];
    var slow = speedOf(first);
    if (slow < 2500) return list;
    for (var i = 1; i < list.length; i++) {
      var fast = speedOf(list[i]);
      if (fast && fast * 3 < slow) {
        var out = list.slice();
        out.splice(i, 1);
        out.unshift(list[i]);
        return out;
      }
    }
    return list;
  }
  function later(fn, ms) { return typeof setTimeout === "function" ? setTimeout(fn, ms) : 0; }
  function stopLater(id) { if (id && typeof clearTimeout === "function") clearTimeout(id); }
  var READ_TIMEOUT = 15000;
  var HEDGE_MS = 3000;
  var trouble = { all: 0, at: 0 };
  function troubleNote(ok) {
    var was = trouble.all >= 2;
    if (ok) trouble.all = 0;
    else { trouble.all += 1; trouble.at = Date.now(); }
    var now = trouble.all >= 2;
    if (was !== now) {
      try { window.dispatchEvent(new CustomEvent("viktorych-api-trouble", { detail: { on: now } })); } catch (err) { /* old browser */ }
    }
  }
  function api(path, opts) {
    var list = bySpeed(apiOrder());
    if (!list.length) list = [String(config().api || "").replace(/\/$/, "")];
    opts = opts || {};
    var headers = {};
    if (opts.body && !opts.form) headers["content-type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (key) { headers[key] = opts.headers[key]; });
    }

    var reading = !opts.method || opts.method === "GET";
    if (reading && BLOCK_PATH.test(String(path || ""))) {
      var blockList = blockHeader();
      if (blockList) headers["X-Block"] = blockList;
    }

    function send(root, signal) {
      var tagKey = reading ? etagKey(root + path, opts.token) : "";
      var held = tagKey ? etagHeld[tagKey] : null;
      var sendHeaders = headers;
      if (held) {
        sendHeaders = {};
        Object.keys(headers).forEach(function (key) { sendHeaders[key] = headers[key]; });
        sendHeaders["If-None-Match"] = held.tag;
      }
      var init = {
        method: opts.method || "GET",
        headers: sendHeaders,
        body: opts.form || (opts.body ? JSON.stringify(opts.body) : undefined),
        credentials: "omit"
      };
      if (signal) init.signal = signal;
      return { tagKey: tagKey, held: held, promise: nativeFetch(root + path, init) };
    }

    function finish(root, res, tagKey, held) {
      breakerOk(root);
      activeApiRoot = root;
      // A 304 means nothing changed since the last read: reuse that body.
      var reused = res.status === 304 && !!held;
      var code = reused ? 200 : res.status;
      var tag = tagKey && res.status === 200 && res.headers && res.headers.get ? res.headers.get("ETag") : "";
      var read = reused ? Promise.resolve(held.text)
        : typeof res.text === "function" ? res.text()
        : Promise.resolve(res.json()).then(function (b) { return JSON.stringify(b || {}); });
      return read.then(function (text) {
        if (tag) keepEtag(tagKey, tag, text);
        try { return text ? JSON.parse(text) : {}; } catch (err) { return {}; }
      }, function () { return {}; }).then(function (body) {
        body = body || {};
        // The friends API answers with a word in "status"; keep it before the HTTP code takes the field.
        if (typeof body.status === "string") body.bodyStatus = body.status;
        body.status = code;
        return body;
      });
    }

    /* Writes: one root at a time, as before, so nothing is sent twice. */
    function attempt(endpointIndex) {
      if (endpointIndex >= list.length) {
        troubleNote(false);
        return Promise.resolve({ status: 503, error: "all_endpoints_failed" });
      }
      var root = list[endpointIndex];
      var sent = send(root, null);
      return sent.promise.then(function (res) {
        if (failoverStatus(res.status)) {
          rotateApi(root, retryAfterMs(res));
          if (endpointIndex + 1 < list.length) return attempt(endpointIndex + 1);
        }
        troubleNote(true);
        return finish(root, res, sent.tagKey, sent.held);
      }).catch(function (err) {
        rotateApi(root, 0);
        if (endpointIndex + 1 < list.length) return attempt(endpointIndex + 1);
        troubleNote(false);
        throw err;
      });
    }

    /* Reads: each try has a timeout, and when a root is silent for a few
       seconds the next root starts too. The first usable answer wins and
       the slower tries are cancelled. */
    function hedgedRead() {
      return new Promise(function (resolve, reject) {
        var next = 0;
        var running = [];
        var settled = false;
        var lastRes = null;
        var lastErr = null;
        var hedgeTimer = 0;
        function maybeEnd() {
          if (settled || running.length || next < list.length) return;
          settled = true;
          stopLater(hedgeTimer);
          troubleNote(false);
          if (lastRes) {
            var held = lastRes;
            finish(held.root, held.res, held.tagKey, held.held).then(resolve, reject);
          } else if (lastErr) reject(lastErr);
          else resolve({ status: 503, error: "all_endpoints_failed" });
        }
        function launch() {
          if (settled || next >= list.length) return false;
          var root = list[next++];
          var ctrl = typeof AbortController === "function" ? new AbortController() : null;
          var started = Date.now();
          var run = { root: root, ctrl: ctrl, timer: 0 };
          var sent = send(root, ctrl ? ctrl.signal : null);
          if (ctrl) run.timer = later(function () { try { ctrl.abort(); } catch (err) { /* over */ } }, (Number(config().readTimeoutMs) || READ_TIMEOUT));
          running.push(run);
          function drop() {
            stopLater(run.timer);
            running = running.filter(function (item) { return item !== run; });
          }
          sent.promise.then(function (res) {
            drop();
            if (settled) return;
            speedNote(root, Date.now() - started);
            if (failoverStatus(res.status)) {
              rotateApi(root, retryAfterMs(res));
              lastRes = { root: root, res: res, tagKey: sent.tagKey, held: sent.held };
              if (!launch()) maybeEnd();
              return;
            }
            var winner = run;
            running.forEach(function (other) { if (other !== winner) { stopLater(other.timer); try { other.ctrl && other.ctrl.abort(); } catch (err) { /* over */ } } });
            running = [];
            settled = true;
            stopLater(hedgeTimer);
            troubleNote(true);
            finish(root, res, sent.tagKey, sent.held).then(resolve, reject);
          }).catch(function (err) {
            drop();
            if (settled) return;
            speedNote(root, Date.now() - started + 5000);
            rotateApi(root, 0);
            lastErr = err;
            if (!launch()) maybeEnd();
          });
          return true;
        }
        function hedge() {
          if (settled) return;
          if (launch()) hedgeTimer = later(hedge, Number(config().hedgeMs) || HEDGE_MS);
        }
        launch();
        if (list.length > 1) hedgeTimer = later(hedge, Number(config().hedgeMs) || HEDGE_MS);
      });
    }

    if (reading && nativeFetch) return hedgedRead();
    return attempt(0);
  }
  function errorMessage(code) {
    if (code === "handle_reserved") return tr("That handle is reserved.");
    if (code === "handle_taken") return tr("That handle is taken.");
    if (code === "invalid_handle") return tr("That handle is not allowed.");
    if (code === "claim_required") return tr("Enter the claim code for this handle.");
    if (code === "invalid_claim") return tr("That claim code is not valid.");
    if (code === "rate_limited") return tr("Too many attempts. Try again later.");
    if (code === "invalid_credentials") return tr("Could not sign in.");
    if (code === "handle_mismatch") return tr("The handle does not match.");
    if (code === "owner_protected") return tr("This account cannot be deleted.");
    if (code === "handle_held") return tr("That handle is not available yet.");
    if (code === "all_endpoints_failed" || code === "not_configured" || code === "unavailable") return tr("Sign-in is temporarily unavailable. Try again in a few minutes.");
    if (code === "invalid_name") return tr("What should we call you?");
    if (code === "passkey_failed" || code === "passkey_exists" || code === "passkey_limit" || code === "challenge") return tr("Could not verify that passkey.");
    if (code === "invalid_location") return tr("That location is too long.");
    if (code === "invalid_website") return tr("That website is too long.");
    if (code === "too_large") return tr("Could not save that photo.");
    if (code === "too_fast") return tr("Wait a moment and try again.");
    if (code === "guard_required" || code === "rejected") return tr("Sign-up could not be checked. Try again.");
    if (code === "recovery_invalid") return tr("That recovery code did not work.");
    return tr("Something went wrong. Try again.");
  }
  function layer() {
    return document.getElementById("account-layer");
  }
  function fieldCount(name, value, max) {
    var raw = name === "accountNumber" ? String(value || "").replace(/\D/g, "") : String(value || "");
    return Array.from(raw).length + " / " + max;
  }
  function field(name, label, type, max) {
    var value = form[name] == null ? "" : String(form[name]);
    if (name === "accountNumber") value = grouped(value.replace(/\D/g, ""));
    var id = "acct-" + name;
    var limit = name === "accountNumber" ? 16 : max;
    var maxAttr = "";
    if (name === "accountNumber") maxAttr = ' data-max="16" inputmode="numeric"';
    else if (limit) maxAttr = ' maxlength="' + limit + '" data-max="' + limit + '"';
    var count = limit ? '<span class="acct-count">' + fieldCount(name, value, limit) + "</span>" : "";
    var autocomplete = name === "accountNumber" ? (type === "password" ? "current-password" : "new-password") : name === "claimCode" ? "off" : name === "website" ? "url" : name === "location" ? "address-level2" : name === "displayName" ? "name" : name === "handle" ? "username" : "nickname";
    var quiet = name === "accountNumber" || name === "handle" || name === "claimCode" ? ' spellcheck="false" autocapitalize="none" autocorrect="off"' : "";
    var invalid = errorText ? ' aria-invalid="true" aria-describedby="acct-error"' : "";
    return '<div class="acct-field"><input id="' + id + '" name="' + esc(name) + '" type="' + (type || "text") + '"' + maxAttr + quiet + invalid + ' placeholder=" " autocomplete="' + autocomplete + '" value="' + esc(value) + '"><label for="' + id + '">' + esc(label) + "</label>" + count + "</div>";
  }
  function errorHtml() {
    return '<p class="acct-error" id="acct-error"' + (errorText ? ' role="alert"' : "") + ">" + esc(errorText) + "</p>";
  }
  function nextButton(act, label, extraDisabled) {
    var disabled = authBusy || extraDisabled;
    return '<button class="acct-next" type="button" data-acct="' + act + '"' + (disabled ? " disabled" : "") + (authBusy ? ' aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : label) + "</button>";
  }
  function textArea(name, label, max) {
    var value = form[name] == null ? "" : String(form[name]);
    var id = "acct-" + name;
    return '<div class="acct-field tall"><textarea id="' + id + '" name="' + esc(name) + '" maxlength="' + max + '" data-max="' + max + '" placeholder=" ">' + esc(value) + '</textarea><label for="' + id + '">' + esc(label) + '</label><span class="acct-count">' + fieldCount(name, value, max) + "</span></div>";
  }
  function closeIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10.6 12 4.8 6.2l1.4-1.4L12 10.6l5.8-5.8 1.4 1.4L13.4 12l5.8 5.8-1.4 1.4L12 13.4l-5.8 5.8-1.4-1.4L10.6 12z"/></svg>';
  }
  function cameraIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9.4 6.4 8.1 8H5.5A1.5 1.5 0 0 0 4 9.5v8A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8h-2.6l-1.3-1.6H9.4zm2.6 10.1a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5z"/></svg>';
  }
  function lockIcon(size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true"><path fill="currentColor" d="M17 9V7A5 5 0 0 0 7 7v2H5v12h14V9h-2zm-8-2a3 3 0 0 1 6 0v2H9V7zm8 12H7v-8h10v8z"/></svg>';
  }
  function siteHref(value) {
    var text = String(value || "").trim();
    if (!text || /^(javascript|data|file):/i.test(text)) return "";
    if (/^https?:\/\//i.test(text)) return text;
    return "https://" + text.replace(/^\/+/, "");
  }
  function modal(title, body, extra) {
    return '<div class="acct-back"><div class="acct-modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="acct-head"><button class="icon-btn" type="button" data-acct="close" aria-label="' + esc(tr("Close")) + '">' + closeIcon() + '</button><div class="acct-logo">' + mark("") + '</div><span></span></div><div class="acct-body"><h1>' + esc(title) + "</h1>" + body + (extra || "") + "</div></div></div>";
  }
  function turnstileHtml() {
    var key = config().turnstileSiteKey || "";
    if (!key) return "";
    return '<div class="cf-turnstile" data-sitekey="' + esc(key) + '"></div>';
  }
  function paintLandingMeta() {
    var title = appName();
    var desc = tr("A home for posts, stories, and the people you choose.");
    if (title) document.title = title;
    function setMeta(selector, value) {
      var node = document.head && document.head.querySelector(selector);
      if (node) node.setAttribute("content", value);
    }
    setMeta('meta[name="description"]', desc);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', desc);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', desc);
  }
  function landing() {
    var year = String(new Date().getFullYear());
    var pages = [["about", tr("About")], ["help", tr("Help Center")], ["terms", tr("Terms of Service")], ["privacy", tr("Privacy Policy")], ["cookie", tr("Cookie Policy")], ["accessibility", tr("Accessibility")], ["blog", tr("Blog")], ["developers", tr("Developers")]];
    var foot = pages.map(function (page) {
      return '<button type="button" data-acct="legal" data-legal="' + page[0] + '" data-title="' + esc(page[1]) + '">' + esc(page[1]) + "</button>";
    }).join("");
    var langs = [["en", "English"], ["es", "Español"], ["ru", "Русский"]].map(function (pair) {
      var on = readLang() === pair[0] ? " on" : "";
      return '<button class="land-lang' + on + '" type="button" data-acct="lang" data-lang="' + pair[0] + '">' + esc(pair[1]) + "</button>";
    }).join("");
    var shots = [
      ["landing/timeline.webp", tr("A familiar timeline"), tr("For you and Following, in a dark layout built for scrolling."), tr("Picture of the timeline")],
      ["landing/stories.webp", tr("Stories with rings"), tr("Rings, folders, and a full-screen viewer, close to a chat app."), tr("Picture of stories")],
      ["landing/notes.webp", tr("Notes above stories"), tr("A short thought sits on your story. Choose who can see it."), tr("Picture of notes")],
      ["landing/highlights.webp", tr("Highlights on your profile"), tr("Pin the stories you want to keep after the day ends."), tr("Picture of highlights")],
      ["landing/lists.webp", tr("Lists you control"), tr("Custom lists for the timeline, private audience lists, and a switch that hides followers and following."), tr("Picture of lists and privacy")],
      ["landing/live.webp", tr("Live from this device"), tr("Go live with the camera or the screen. The media stays on the call."), tr("Picture of live video")],
      ["landing/store.webp", tr("Gifts from the store"), tr("ViktorychStore lists gifts you can send. Points come from using the app. Nothing is for sale."), tr("Picture of the gift store")],
      ["landing/birthdays.webp", tr("Birthdays on the profile"), tr("When it is someone's day, the profile says so, and you can send a gift."), tr("Picture of a birthday")],
      ["landing/details.webp", tr("Personal details you choose"), tr("City, home, and the rest of About. Each line can be public, for followers, or only you."), tr("Picture of personal details")],
      ["landing/sidebar.webp", tr("A sidebar you arrange"), tr("Reorder the menu, hide what you skip, and group the rest into folders."), tr("Picture of the sidebar")],
      ["landing/status.webp", tr("An emoji for your status"), tr("Set an emoji and a short line, and choose who can see when you were last here."), tr("Picture of an emoji status")],
      ["landing/badges.webp", tr("Badges you earn"), tr("Tiers for showing up, posting, and going live. Pin a few, and choose who sees each one."), tr("Picture of badges")],
      ["landing/pwa.webp", tr("Install it on your phone"), tr("Add it to your home screen. It opens full screen and keeps a copy for offline."), tr("Picture of installing the app")],
      ["landing/safari.webp", tr("Ready for iPhone and older Safari"), tr("The same layout on iPhone 11, and pages that still open in Safari from iOS 13."), tr("Picture of Safari install steps")]
    ];
    var blocks = shots.map(function (row, index) {
      var flip = index % 2 ? " land-flip" : "";
      return '<section class="land-block' + flip + '"><div class="land-copy"><h2>' + esc(row[1]) + "</h2><p>" + esc(row[2]) + '</p></div><div class="land-frame"><div class="land-device"><img alt="' + esc(row[3]) + '" src="' + row[0] + '" width="414" height="896" loading="lazy" decoding="async"></div></div></section>';
    }).join("");
    var actions = '<button class="land-btn land-btn-line" type="button" data-acct="login">' + esc(tr("Log in")) + '</button><button class="land-btn land-btn-fill" type="button" data-acct="signup">' + esc(tr("Sign up")) + "</button>";
    return '<div class="x-shell land-page"><header class="land-bar"><a class="land-brand" href="./">' + mark("land-mark") + "<span>" + esc(appName()) + '</span></a><div class="land-bar-actions"><div class="land-langs" role="group" aria-label="' + esc(tr("Display language")) + '">' + langs + "</div>" + actions + '</div></header><main><section class="land-hero x-land-copy"><p class="land-kicker">' + esc(appName()) + "</p><h1>" + esc(appName()) + '</h1><p class="land-tag">' + esc(tr("A home for posts, stories, and the people you choose.")) + '</p><p class="land-lead">' + esc(tr("The timeline, stories, notes, live video, and gifts. It runs in the browser and as an installed app.")) + '</p><div class="land-hero-actions">' + actions + "</div></section>" + blocks + '</main><footer class="x-foot land-foot">' + foot + '<button type="button" data-acct="prefs">' + esc(tr("Settings")) + "</button><span>" + esc(tr("© {year} {app}", { year: year, app: appName() })) + "</span></footer></div>";
  }
  function honeypotHtml() {
    return '<div class="acct-hp" aria-hidden="true"><label>Fax<input name="fax" tabindex="-1" autocomplete="off" value=""></label></div>';
  }
  function recoveryBlock(codes) {
    if (!codes || !codes.length) return "";
    var items = codes.map(function (code) { return "<li data-recovery-code>" + esc(code) + "</li>"; }).join("");
    return '<h2>' + esc(tr("Recovery codes")) + '</h2><p class="acct-sub">' + esc(tr("These recovery codes are shown once. Each code works one time.")) + '</p><ul class="acct-codes">' + items + '</ul><div class="acct-row"><button type="button" data-acct="copy-codes">' + esc(tr("Copy recovery codes")) + '</button><button type="button" data-acct="download-codes">' + esc(tr("Download recovery codes")) + "</button></div>";
  }
  function lostBody() {
    return '<form id="acct-recover-form" method="post" action="" autocomplete="off"><p class="acct-sub">' + esc(tr("Enter one recovery code. It works once, then new codes replace it.")) + '</p><div class="acct-field"><input id="acct-recovery" name="recovery" type="text" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder=" " value="' + esc(form.recovery || "") + '"><label for="acct-recovery">' + esc(tr("Recovery code")) + "</label></div>" + errorHtml() + '<button class="acct-next" type="submit" data-acct="do-recover"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Continue")) + "</button></form>";
  }
  function recoveryShownBody() {
    return recoveryBlock(form.recoveryCodes || []) + errorHtml() + '<button class="acct-next" type="button" data-acct="close">' + esc(tr("Done")) + "</button>";
  }
  function leadingZeroBits(bytes) {
    var count = 0;
    for (var i = 0; i < bytes.length; i++) {
      var byte = bytes[i];
      if (byte === 0) { count += 8; continue; }
      for (var bit = 7; bit >= 0; bit--) {
        if ((byte >> bit) & 1) return count;
        count += 1;
      }
    }
    return count;
  }
  function solvePow(ch) {
    var enc = new TextEncoder();
    var bits = Number(ch.bits) || 12;
    var i = 0;
    function next() {
      if (i > 3000000) return Promise.reject(new Error("pow"));
      var n = i++;
      return crypto.subtle.digest("SHA-256", enc.encode(ch.id + ":" + ch.nonce + ":" + n)).then(function (buf) {
        if (leadingZeroBits(new Uint8Array(buf)) >= bits) return n;
        return next();
      });
    }
    return next();
  }
  function ensureGuard() {
    return api("/v1/signup/challenge").then(function (ch) {
      if (!ch || !ch.id) return null;
      var started = Date.now();
      return solvePow(ch).then(function (counter) {
        var left = (Number(ch.waitMs) || 800) + 200 - (Date.now() - started);
        var done = function () { return { id: ch.id, counter: counter }; };
        if (left <= 0) return done();
        return new Promise(function (resolve) { setTimeout(function () { resolve(done()); }, left); });
      });
    });
  }
  function faxValue() {
    var el = document.querySelector('#account-layer input[name="fax"]');
    return el ? String(el.value || "") : "";
  }
  function storeCredential(formEl) {
    try {
      if (!formEl || typeof window.PasswordCredential !== "function" || !navigator.credentials || !navigator.credentials.store) return;
      var pass = formEl.querySelector('input[autocomplete="current-password"], input[autocomplete="new-password"]');
      var user = formEl.querySelector('input[name="username"]');
      if (pass) {
        var digits = String(pass.value || "").replace(/\D/g, "");
        if (digits) pass.value = digits;
        if (user && !String(user.value || "").trim()) user.value = digits;
      }
      navigator.credentials.store(new window.PasswordCredential(formEl)).catch(function () {});
    } catch (err) { /* the browser may not offer a password manager */ }
  }
  function signupBody() {
    if (step === 2) {
      var pending = readPending();
      var number = pending ? grouped(pending.accountNumber) : "";
var numberNote = form.passkey
        ? tr("Save this account number. You can sign in with a passkey later. The number is an optional backup.")
        : tr("This number is shown once. Save it now. It is the only way back into this account.");
      var digits = pending ? String(pending.accountNumber || "").replace(/\D/g, "") : "";
      var userName = pending && pending.account && pending.account.handle ? pending.account.handle : digits;
      return '<form id="acct-save-form" method="post" action="" autocomplete="on"><p class="acct-sub">' + esc(numberNote) + '</p><div class="acct-field"><input id="acct-username" name="username" type="text" autocomplete="username" spellcheck="false" autocapitalize="none" value="' + esc(userName) + '" readonly><label for="acct-username">' + esc(tr("Username")) + '</label></div><div class="acct-number" role="status">' + esc(number) + '</div><div class="acct-field"><input id="acct-new-password" name="password" type="password" autocomplete="new-password" inputmode="numeric" spellcheck="false" value="' + esc(digits) + '"><label for="acct-new-password">' + esc(tr("Account number")) + '</label></div><div class="acct-row"><button type="button" data-acct="copy">' + esc(tr("Copy")) + '</button><button type="button" data-acct="download">' + esc(tr("Download")) + '</button><button type="button" data-acct="show-number">' + esc(tr("Show")) + '</button></div>' + recoveryBlock(pending && pending.recoveryCodes) + '<label class="acct-check"><input name="saved" type="checkbox"' + (form.saved ? " checked" : "") + "><span>" + esc(tr("I saved my account number")) + "</span></label>" + errorHtml() + '<button class="acct-next" type="submit" data-acct="saved"' + (!form.saved || authBusy ? " disabled" : "") + (authBusy ? ' aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Next")) + "</button>" + (window.ViktorychPasskeys && window.ViktorychPasskeys.supported() ? '<button class="acct-line" type="button" data-acct="save-passkey" style="width:100%;margin-top:12px">' + esc(tr("Save a passkey on this device")) + "</button>" : "") + "</form>";
    }
    if (step === 1) {
      var claim = form.claimOpen ? field("claimCode", tr("Claim code"), "password") : '<button class="acct-quiet" type="button" data-acct="claim">' + esc(tr("Have a claim code?")) + "</button>";
      var handleSub = form.profileLess
        ? esc(tr("Choose a handle or leave blank to assign an anonymous identifier."))
        : esc(tr("Latin and Cyrillic letters, digits, and underscore. Up to 15 characters."));
      var passkeyStep = window.ViktorychPasskeys && window.ViktorychPasskeys.supported()
        ? '<button class="acct-next" type="button" data-acct="passkey-signup"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Create a passkey")) + '</button><p class="acct-sub">' + esc(tr("A passkey uses this device's fingerprint, face, or screen lock. No password is required. The account number still works as an optional backup.")) + '</p><button class="acct-quiet" type="button" data-acct="next"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(tr("Continue without a passkey")) + "</button>"
        : nextButton("next", tr("Next"));
      return '<p class="acct-sub">' + handleSub + "</p>" +
        field("handle", form.profileLess ? tr("Handle (optional)") : tr("Choose a handle"), "text", 15) +
        claim + turnstileHtml() + honeypotHtml() + errorHtml() + passkeyStep;
    }
    var subText = form.profileLess
      ? esc(tr("Your account will have no public profile. Interactions will be anonymous."))
      : esc(tr("Your name is shown on your profile."));
    var profRow = '<div class="acct-pref-row" style="margin:16px 0 8px"><div class="acct-pref-text"><b>' + esc(tr("Profile-less account")) + '</b><p>' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p></div><button class="tab-switch' + (form.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.profileLess ? "true" : "false") + '" data-acct="toggle-form-profileless"><i></i></button></div>';
    return '<p class="acct-sub">' + subText + "</p>" +
      field("displayName", form.profileLess ? tr("Name (optional)") : tr("Name"), "text", 50) +
      profRow +
      errorHtml() + nextButton("next", tr("Next"));
  }
  function loginBody() {
    var digits = String(form.accountNumber || "").replace(/\D/g, "");
    var userField = '<div class="acct-field"><input id="acct-login-user" name="username" type="text" autocomplete="username" spellcheck="false" autocapitalize="none" autocorrect="off" placeholder=" " value="' + esc(digits) + '"><label for="acct-login-user">' + esc(tr("Username")) + "</label></div>";
    var passkey = window.ViktorychPasskeys && window.ViktorychPasskeys.supported()
      ? '<div class="acct-field"><input id="acct-passkey-user" name="passkeyUser" type="text" placeholder=" " autocomplete="username webauthn" value=""><label for="acct-passkey-user">' + esc(tr("Sign in with a passkey")) + '</label></div><button class="acct-next" type="button" data-acct="passkey-login"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Sign in with a passkey")) + '</button><p class="acct-sub">' + esc(tr("A passkey uses this device's fingerprint, face, or screen lock. No password is required. The account number still works as an optional backup.")) + "</p>"
      : "";
    var numberHint = passkey
      ? tr("There is no password to reset. A passkey can sign in, and the account number from sign-up still works.")
      : tr("There is no password to reset. The account number from sign-up is the only way back in.");
    return '<form id="acct-login-form" method="post" action="" autocomplete="on">' + userField + passkey + field("accountNumber", tr("Account number"), "password") + '<p class="acct-sub">' + esc(numberHint) + "</p>" + turnstileHtml() + errorHtml() + '<button class="acct-next" type="submit" data-acct="do-login"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Log in")) + "</button></form>" + '<p class="acct-switch">' + esc(tr("Don't have an account?")) + ' <button type="button" data-acct="signup">' + esc(tr("Sign up")) + '</button></p><p class="acct-switch"><button type="button" data-acct="lost">' + esc(tr("Lost your account number?")) + '</button></p><p class="acct-switch"><button type="button" data-acct="open-emergency" style="font-weight:600">' + esc(tr("Have a claim code?")) + ' (' + esc(tr("Emergency Offline Access")) + ')</button></p>' +
      '<p class="acct-switch"><button type="button" data-acct="open-restore">' + esc(tr("Restore session from another device")) + '</button></p>';
  }
  function emergencyBody() {
    return '<p class="acct-sub">' + esc(tr("Unlock offline access with your claim code if servers are down.")) + '</p>' +
      field("emergencyClaim", tr("Claim code"), "password") +
      '<p class="acct-error">' + esc(errorText) + '</p>' +
      '<button class="acct-next" type="button" data-acct="do-emergency">' + esc(tr("Unlock Offline")) + '</button>' +
      '<p class="acct-switch"><button type="button" data-acct="login">' + esc(tr("Back to sign in")) + '</button></p>';
  }
  function restoreBody() {
    return '<p class="acct-sub">' + esc(tr("Paste your session code from another device to sign in.")) + '</p>' +
      textArea("sessionCode", tr("Session code"), 2000) +
      '<p class="acct-error">' + esc(errorText) + '</p>' +
      '<button class="acct-next" type="button" data-acct="do-restore">' + esc(tr("Restore session")) + '</button>' +
      '<p class="acct-switch"><button type="button" data-acct="login">' + esc(tr("Back to sign in")) + '</button></p>';
  }
  function photoHtml(url, cls, initials) {
    if (!url) return "";
    var remote = url.indexOf("/v1/media/") >= 0;
    var classAttr = cls ? ' class="' + cls + '"' : "";
    var fallback = initials ? ' data-fallback="avatar" data-initials="' + esc(initials) + '"' : "";
    return "<img" + classAttr + ' alt="" src="' + esc(url) + '"' + fallback + (remote ? ' data-photo="' + esc(url) + '"' : "") + ">";
  }
  function currentPhoto(kind) {
    var session = readSession();
    var account = session && session.account || {};
    if (kind === "banner") return form.bannerTouched ? (form.banner || "") : (account.banner || "");
    return form.avatarTouched ? (form.avatar || "") : (account.avatar || "");
  }
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/></svg>';
  function emptyMode(kind) {
    return (kind === "banner" ? form.bannerEmpty : form.avatarEmpty) === "none" ? "none" : "default";
  }
  function faceOf(kind, src, accountFace) {
    var faces = window.ViktorychFaces;
    var pick = faces && (kind === "banner" ? faces.banner : faces.picture);
    if (pick) return pick(src, accountFace);
    if (accountFace === "none" || accountFace === "default") return accountFace;
    return src ? "photo" : "default";
  }
  function presenceWrap(id, html, opener) {
    var api = window.ViktorychPresence;
    if (!api || typeof api.wrap !== "function" || !/^\d{12}$/.test(String(id || ""))) return html;
    return api.wrap(id, html, opener ? ' data-acct="presence-open"' : "");
  }
  function publicAvatar(src, accountFace, cls, initials) {
    var mode = faceOf("picture", src, accountFace);
    if (mode === "none") return '<span class="ava-none"></span>';
    var classes = "ava" + (cls ? " " + cls : "") + (mode === "default" ? " silhouette" : "");
    var letter = String(initials || "?").trim().charAt(0).toUpperCase() || "?";
    if (mode === "photo") return photoHtml(src, classes, letter);
    return '<span class="' + classes + '" aria-hidden="true">' + PERSON + "</span>";
  }
  function publicBanner(src, accountFace) {
    var mode = faceOf("banner", src, accountFace);
    if (mode === "none") return "";
    if (mode === "photo") return photoHtml(src, "pbanner");
    return "";
  }
  function mediaMenu(kind) {
    if (form.mediaMenu !== kind) return "";
    var mode = emptyMode(kind);
    var photo = currentPhoto(kind);
    function item(label, attrs, on) {
      return '<button type="button" role="menuitemradio" aria-checked="' + (on ? "true" : "false") + '" ' + attrs + ">" + esc(label) + "</button>";
    }
    return '<div class="acct-pop for-' + kind + '" role="menu">' +
      item(tr("Add photo"), 'data-acct="pick-' + kind + '"', false) +
      item(tr("Default"), 'data-acct="face" data-kind="' + kind + '" data-mode="default"', !photo && mode === "default") +
      item(tr("None"), 'data-acct="face" data-kind="' + kind + '" data-mode="none"', !photo && mode === "none") +
      "</div>";
  }
  function editMedia() {
    var banner = currentPhoto("banner");
    var avatar = currentPhoto("avatar");
    var bannerNone = !banner && emptyMode("banner") === "none";
    var avatarNone = !avatar && emptyMode("avatar") === "none";
    var hero = "acct-hero" + (bannerNone ? " banner-none" : "") + (avatarNone ? " avatar-none" : "");
    var removeBanner = banner ? '<button class="acct-cam acct-banner-x" type="button" data-acct="banner-clear" aria-label="' + esc(tr("Remove banner")) + '">' + closeIcon() + "</button>" : "";
    var removeAvatar = avatar ? '<button class="acct-cam acct-ava-x" type="button" data-acct="avatar-clear" aria-label="' + esc(tr("Remove photo")) + '">' + closeIcon() + "</button>" : "";
    var face = avatar ? photoHtml(avatar, "") : (avatarNone ? "" : '<span class="acct-silhouette">' + PERSON + "</span>");
    return '<div class="' + hero + '"><div class="acct-banner">' + (banner ? photoHtml(banner, "") : "") +
      '<button class="acct-cam" type="button" data-acct="media-menu" data-kind="banner" aria-label="' + esc(tr("Add photo")) + '" aria-expanded="' + (form.mediaMenu === "banner" ? "true" : "false") + '">' + cameraIcon() + "</button>" + removeBanner +
      '</div><div class="acct-ava' + (avatarNone ? " is-none" : "") + '">' + face +
      '<button class="acct-cam" type="button" data-acct="media-menu" data-kind="avatar" aria-label="' + esc(tr("Add photo")) + '" aria-expanded="' + (form.mediaMenu === "avatar" ? "true" : "false") + '">' + cameraIcon() + "</button>" + removeAvatar +
      "</div>" + mediaMenu("banner") + mediaMenu("avatar") + "</div>" +
      '<input class="acct-hidden" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" tabindex="-1">' +
      '<input class="acct-hidden" name="banner" type="file" accept="image/jpeg,image/png,image/webp" tabindex="-1">';
  }
  function editBody() {
    var privRow = '<div class="acct-pref-row"><div class="acct-pref-text"><b>' + esc(tr("Keep followers and following private")) + '</b><p>' + esc(tr("Only you can see your followers and following lists.")) + '</p></div><button class="tab-switch' + (form.privateFollows ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.privateFollows ? "true" : "false") + '" data-acct="toggle-form-private"><i></i></button></div>';
    var profLessRow = '<div class="acct-pref-row"><div class="acct-pref-text"><b>' + esc(tr("Profile-less account")) + '</b><p>' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p></div><button class="tab-switch' + (form.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.profileLess ? "true" : "false") + '" data-acct="toggle-form-profileless"><i></i></button></div>';
    var linkRow = '<div class="acct-pref-row"><div class="acct-pref-text"><b>' + esc(tr("Linked social accounts")) + '</b><p>' + esc(tr("Link your X, Telegram, Instagram, and YouTube accounts so their posts appear on your profile. Requires identity verification.")) + '</p></div><button class="outline" type="button" data-acct="open-link-identity">' + esc(tr("Link social account")) + '</button></div>';
    return editMedia() + field("displayName", tr("Name"), "text", 50) + textArea("bio", tr("Bio"), 160) + field("location", tr("Location"), "text", 30) + field("website", tr("Website"), "text", 100) + privRow + profLessRow + linkRow + '<p class="acct-error">' + esc(errorText) + "</p>";
  }
  function editModal(body) {
    return '<div class="acct-back"><div class="acct-modal acct-edit" role="dialog" aria-modal="true" aria-label="' + esc(tr("Edit profile")) + '"><div class="acct-head acct-edit-head"><button class="icon-btn" type="button" data-acct="close" aria-label="' + esc(tr("Close")) + '">' + closeIcon() + '</button><h1>' + esc(tr("Edit profile")) + '</h1><button class="acct-save" type="button" data-acct="save-profile">' + esc(tr("Save")) + '</button></div><div class="acct-body acct-edit-body">' + body + "</div></div></div>";
  }
  function cropModal() {
    var title = form.cropKind === "banner" ? tr("Edit banner") : tr("Edit photo");
    return '<div class="acct-back"><div class="acct-modal acct-edit" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="acct-head acct-edit-head"><button class="icon-btn" type="button" data-acct="close" aria-label="' + esc(tr("Close")) + '">' + closeIcon() + '</button><h1>' + esc(title) + '</h1><button class="acct-save" type="button" data-acct="crop-apply">' + esc(tr("Apply")) + '</button></div><div class="acct-body acct-edit-body"><div class="acct-crop-stage" data-kind="' + (form.cropKind === "banner" ? "banner" : "avatar") + '"><img alt="" src="' + esc(form.cropUrl || "") + '"></div><input class="acct-zoom" name="cropZoom" type="range" min="1" max="3" step="0.01" value="' + esc(String(form.cropZoom || 1)) + '" aria-label="' + esc(title) + '"><p class="acct-error">' + esc(errorText) + "</p></div></div></div>";
  }
  function legalBody() {
    var copy = {
      about: tr("This app is a reader for posts from feeds you follow. Not affiliated with X."),
      help: tr("Sign in with the 16-digit account number from sign-up. It is shown once. There is no password to reset."),
      terms: tr("The account number is your login. The timeline shows posts from feeds. Not affiliated with X."),
      privacy: tr("The account number is stored as a hash. There is no email on the account. Settings stay on this device."),
      cookie: tr("This app does not use tracking cookies. The session and settings stay in this browser."),
      accessibility: tr("Fields have labels. Tab moves between them, Enter continues, and Escape closes a dialog."),
      blog: tr("There is no separate blog. What you see here is the app."),
      developers: tr("After you sign in, Settings can export and import the data on this device.")
    };
    return '<p class="acct-sub">' + esc(copy[legalKey] || tr("Not affiliated with X.")) + "</p>";
  }
  function wallTheme() {
    var mode = document.documentElement.getAttribute("data-theme") || "lightsout";
    if (mode !== "default" && mode !== "dim") mode = "lightsout";
    return mode;
  }
  function applyWallTheme(mode) {
    if (mode !== "default" && mode !== "dim") mode = "lightsout";
    document.documentElement.setAttribute("data-theme", mode);
    var colors = { default: "#FFFFFF", dim: "#15202B", lightsout: "#000000" };
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", colors[mode]);
    try {
      var key = "viktorychapp-settings-v1";
      var raw = localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object") parsed = {};
      parsed.appearance = mode;
      localStorage.setItem(key, JSON.stringify(parsed));
    } catch (err) { /* the theme still shows on this page */ }
  }
  function prefsBody() {
    var lang = readLang();
    var theme = wallTheme();
    function langBtn(code, label) {
      return '<button class="outline' + (lang === code ? " on" : "") + '" type="button" data-acct="lang" data-lang="' + code + '">' + esc(label) + "</button>";
    }
    function themeBtn(mode, label) {
      return '<button class="outline' + (theme === mode ? " on" : "") + '" type="button" data-acct="appearance" data-mode="' + mode + '">' + esc(label) + "</button>";
    }
    return '<p class="acct-sub">' + esc(tr("Language and appearance stay on this device.")) + "</p>" +
      '<div class="theme-row" role="group" aria-label="' + esc(tr("Display language")) + '">' + langBtn("en", "English") + langBtn("es", "Español") + langBtn("ru", "Русский") + "</div>" +
      '<div class="theme-row" role="group" aria-label="' + esc(tr("Appearance")) + '">' + themeBtn("default", tr("Default")) + themeBtn("dim", tr("Dim")) + themeBtn("lightsout", tr("Lights out")) + "</div>" +
      '<p class="acct-sub">' + esc(tr("Account settings are available after you sign in.")) + "</p>";
  }
  function deletedFlag() {
    try { return sessionStorage.getItem(DELETED_KEY) === "1"; } catch (err) { return false; }
  }
  function showDeleted() {
    var root = layer();
    if (!root) return false;
    document.documentElement.setAttribute("data-wall", "1");
    try {
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    } catch (err) { /* the wall still covers the app */ }
    root.innerHTML = '<div class="x-shell"><div class="x-land"><div class="x-land-copy"><h1>' + esc(tr("Your account was deleted")) + '</h1><p class="acct-sub">' + esc(tr("This account and the data tied to it are gone from this device.")) + '</p><button class="acct-fill" type="button" data-acct="deleted-done">' + esc(tr("Done")) + "</button></div></div></div>";
    return true;
  }
  function showDeletedIfNeeded() {
    if (!deletedFlag() || readSession()) return false;
    return showDeleted();
  }
  function paint() {
    var root = layer();
    if (!root) return;
    if (deletedFlag() && !readSession()) {
      showDeleted();
      return;
    }
    var html = "";
    if (showLanding()) {
      paintLandingMeta();
      html += landing();
    }
    if (view === "signup") html += modal(tr("Create your account"), signupBody());
    else if (view === "login") html += modal(tr("Sign in to {app}", { app: appName() }), loginBody());
    else if (view === "prefs") html += modal(tr("Settings"), prefsBody());
    else if (view === "emergency") html += modal(tr("Emergency Offline Access"), emergencyBody());
    else if (view === "restore") html += modal(tr("Restore session"), restoreBody());
    else if (view === "lost") html += modal(tr("Lost your account number?"), lostBody());
    else if (view === "recovery") html += modal(tr("Recovery codes"), recoveryShownBody());
    else if (view === "reports") html += modal(tr("Review reports"), reportsBody());
    else if (view === "edit") html += editModal(editBody());
    else if (view === "crop") html += cropModal();
    else if (view === "legal") html += modal(legalTitle || tr("About"), legalBody());
    else if (view === "unfriend") html += modal(tr("Unfriend @{handle}?", { handle: unfriendTarget ? unfriendTarget.handle : "" }), '<p class="acct-sub">' + esc(tr("This removes @{handle} from your friends.", { handle: unfriendTarget ? unfriendTarget.handle : "" })) + '</p><button class="acct-next acct-danger" type="button" data-friend-act="unfriend-confirm" style="background:#f4212e;border-color:#f4212e;color:#fff">' + esc(tr("Remove Friend")) + '</button><button class="acct-line" type="button" data-acct="close" style="width:100%;margin-top:12px">' + esc(tr("Cancel")) + '</button>');
    else if (view === "link-identity") html += modal(tr("Link social profile"), linkIdentityBody());
    else if (view === "leave") html += modal(tr("Save your account number"), '<p class="acct-sub">' + esc(tr("Leave without saving the account number?")) + '</p><button class="acct-next" type="button" data-acct="abandon">' + esc(tr("Close")) + '</button><button class="acct-line" type="button" data-acct="stay" style="width:100%;margin-top:12px">' + esc(tr("Back")) + "</button>");
    var previous = document.activeElement;
    var focusName = "";
    var focusAct = "";
    var caret = null;
    if (previous && previous.closest && previous.closest("#account-layer")) {
      focusName = previous.name || "";
      focusAct = previous.getAttribute("data-acct") || "";
      if (typeof previous.selectionStart === "number") caret = previous.selectionStart;
    }
    root.innerHTML = html;
    var mark = (view || "") + ":" + step + ":" + (form.claimOpen ? "1" : "0") + ":" + legalKey;
    var focusEl = null;
    if (focusName) focusEl = root.querySelector('[name="' + focusName.replace(/[^A-Za-z]/g, "") + '"]');
    if (!focusEl && focusAct) focusEl = root.querySelector('[data-acct="' + focusAct.replace(/[^a-z-]/g, "") + '"]');
    if (!focusEl && mark !== painted && view !== "edit" && view !== "crop") {
      focusEl = form.claimOpen ? root.querySelector('input[name="claimCode"]') : root.querySelector(".acct-field input, .acct-field textarea");
    }
    painted = mark;
    if (focusEl && view !== "edit" && view !== "crop") {
      focusEl.focus();
      if (caret != null && focusName && focusEl.setSelectionRange) {
        try { focusEl.setSelectionRange(caret, caret); } catch (err) { /* a button has no caret */ }
      }
    }
    if (view === "signup" && step === 2 && window.ViktorychPasskeys && window.ViktorychPasskeys.armConditionalCreate) {
      var pendingPass = readPending();
      if (pendingPass && pendingPass.token) window.ViktorychPasskeys.armConditionalCreate(pendingPass.token);
    }
    if (view === "crop" && !layoutCrop()) requestAnimationFrame(layoutCrop);
    if (view === "login" && window.ViktorychPasskeys) {
      window.ViktorychPasskeys.stopConditional();
      window.ViktorychPasskeys.armConditional(function (json, id) { doPasskeyLogin(json, id); });
    } else if (window.ViktorychPasskeys && view !== "login") {
      window.ViktorychPasskeys.stopConditional();
    }
    if (config().turnstileSiteKey && !document.getElementById("turnstile-js")) {
      var script = document.createElement("script");
      script.id = "turnstile-js";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }
  function openAuth(next) {
    view = next;
    step = next === "signup" && readPending() ? 2 : 0;
    errorText = "";
    form = { profileLess: false };
    if (next === "edit") {
      var account = (readSession() || {}).account || {};
      form.displayName = account.displayName || "";
      form.bio = account.bio || "";
      form.location = account.location || "";
      form.website = account.website || "";
      form.avatar = account.avatar || "";
      form.banner = account.banner || "";
      form.avatarEmpty = account.avatarEmpty === "none" ? "none" : "default";
      form.bannerEmpty = account.bannerEmpty === "none" ? "none" : "default";
      form.privateFollows = !!account.privateFollows;
      form.profileLess = !!account.profileLess;
      form.avatarTouched = false;
      form.bannerTouched = false;
      form.mediaMenu = "";
    }
    paint();
  }
  function closeAuth() {
    if (view === "crop") {
      if (form.cropUrl) URL.revokeObjectURL(form.cropUrl);
      form.cropUrl = "";
      form.cropReady = false;
      view = "edit";
      paint();
      return;
    }
    if (view === "signup" && step === 2 && readPending()) {
      view = "leave";
      paint();
      return;
    }
    view = "";
    errorText = "";
    paint();
  }
  function enter() {
    if (!blocking()) return;
    if (!entered) {
      var hash = location.hash || "";
      if (hash && hash !== "#" && hash !== "#/") {
        try { sessionStorage.setItem(RETURN_KEY, hash); } catch (err) { /* the next page is home */ }
        history.replaceState(null, "", location.pathname + location.search);
      }
      entered = true;
    }
    try {
      if (window.Audio && window.SIntelMusic && window.SIntelMusic.pause) window.SIntelMusic.pause();
      document.querySelectorAll("audio, video").forEach(function (el) { el.pause(); });
    } catch (e) {}
    var queued = window.__VIKTORYCH_AUTH;
    window.__VIKTORYCH_AUTH = "";
    if (readPending()) {
      view = "signup";
      step = 2;
    } else if (queued === "signup" || queued === "login" || queued === "prefs") {
      view = queued;
      step = 0;
    } else if (installedApp()) {
      view = "login";
      step = 0;
    }
    if (showLanding()) document.documentElement.setAttribute("data-wall", "1");
    else document.documentElement.removeAttribute("data-wall");
    tellSW(false);
    paint();
  }
  function finishAuth() {
    var back = "";
    try {
      back = sessionStorage.getItem(RETURN_KEY) || "";
      sessionStorage.removeItem(RETURN_KEY);
    } catch (err) { back = ""; }
    if (!back || back.charAt(0) !== "#") back = "#/";
    document.documentElement.removeAttribute("data-wall");
    try { history.pushState({ signed: 1 }, "", location.pathname + location.search); } catch (err) { /* the reload still navigates */ }
    location.replace(location.pathname + location.search + back);
    location.reload();
  }
  function readLang() {
    try {
      var lang = localStorage.getItem("superintelapp-lang");
      if (lang === "ru" || lang === "es" || lang === "en") return lang;
    } catch (err) { /* English */ }
    return "en";
  }
  /* "Sync across my devices": menu, sidebar and display choices follow the
     account unless the account switch is off or this device keeps its own.
     The account switch syncs itself (last write wins by syncUiAt); the
     device override never leaves this device. */
  var UI_KEYS = ["appearance", "drawerMenu", "navCustom", "navCustomAt", "bottomNav", "bottomNavCustom", "profileTabs", "homePills", "stories", "prefsAt", "showPictures", "showBanners"];
  var DEVICE_OWN_KEY = "viktorychapp-device-own-ui";
  function deviceOwnUi() {
    try { return localStorage.getItem(DEVICE_OWN_KEY) === "1"; } catch (err) { return false; }
  }
  function setDeviceOwnUi(on) {
    try {
      if (on) localStorage.setItem(DEVICE_OWN_KEY, "1");
      else localStorage.removeItem(DEVICE_OWN_KEY);
    } catch (err) { /* private mode keeps syncing */ }
  }
  function uiSyncOn(settings) {
    if (deviceOwnUi()) return false;
    if (!settings) {
      var raw = readStored("settings-v1");
      try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    }
    return settings.syncUi !== false;
  }
  function registry() { return window.ViktorychSettingsSync || null; }
  function ownKeys(settings) {
    var reg = registry();
    if (!reg) return [];
    return reg.localKeys({ allOff: !!settings && settings.syncUi === false, lookOwn: deviceOwnUi() });
  }
  var EXTRA_PREFS = ["privacyEmbedShield", "privacyWebRTC", "privacyNoReferrer", "privacyStripTrackers", "privacyAntiFingerprint", "translateAuto", "translateNever", "bells", "livePreview", "peopleLinks", "friendsRail", "brandLogo"];
  function pickPrefs(local, remote) {
    // Home pills and Stories: each key keeps the newer choice.
    var out = {};
    var at = {};
    var lAt = (local && local.prefsAt) || {};
    var rAt = (remote && remote.prefsAt) || {};
    ["homePills", "stories"].forEach(function (key) {
      var lt = Number(lAt[key]) || 0;
      var rt = Number(rAt[key]) || 0;
      var lv = local && typeof local[key] === "boolean" ? local[key] : undefined;
      var rv = remote && typeof remote[key] === "boolean" ? remote[key] : undefined;
      var pick = rt > lt ? (rv !== undefined ? rv : lv) : (lv !== undefined ? lv : rv);
      if (pick !== undefined) out[key] = pick;
      if (lt || rt) at[key] = Math.max(lt, rt);
    });
    out.prefsAt = at;
    return out;
  }

  /* Blocks merge as one unit by their own stamp, so an unblock on one device
     is not undone by a union with another. */
  function pickBlocks(local, remote) {
    var l = local && typeof local === "object" ? local : null;
    var r = remote && typeof remote === "object" ? remote : null;
    if (!l) return r || { at: 0 };
    if (!r) return l;
    return (Number(r.at) || 0) > (Number(l.at) || 0) ? r : l;
  }

  function snapshotFrom(settings) {
    settings = settings || {};
    var snap = {
      follows: settings.follows || [],
      seenFeeds: settings.seenFeeds || [],
      seenDefaults: settings.seenDefaults || [],
      lists: settings.lists || [],
      likes: settings.likes || {},
      bookmarks: settings.bookmarks || {},
      reposts: settings.reposts || {},
      savedPosts: settings.savedPosts || {},
      feedTabs: settings.feedTabs || [],
      communityTabs: cleanCommunityTabs(settings.communityTabs),
      noteTabs: settings.noteTabs || [],
      lastNoteTab: settings.lastNoteTab || "all",
      mutedWords: settings.mutedWords || [],
      mutedAccounts: settings.mutedAccounts || [],
      repostOff: settings.repostOff || [],
      blocks: settings.blocks && typeof settings.blocks === "object" ? settings.blocks : { at: 0 },
      groups: settings.groups || [],
      groupsOwn: !!settings.groupsOwn,
      subsGroup: settings.subsGroup || "",
      appearance: settings.appearance || "lightsout",
      autoplay: settings.autoplay || "all",
      notify: !!settings.notify,
      translateTo: settings.translateTo || "en",
      tabViews: settings.tabViews || {},
      followingSort: settings.followingSort === "popular" ? "popular" : "recent",
      showPictures: settings.showPictures === "default" || settings.showPictures === "none" ? settings.showPictures : "show",
      showBanners: settings.showBanners === "default" || settings.showBanners === "none" ? settings.showBanners : "show",
      forYouReposts: settings.forYouReposts !== false,
      forYouReplies: settings.forYouReplies !== false,
      historyPause: settings.historyPause || { videos: false, articles: false },
      historyCut: settings.historyCut || { video: 0, article: 0 },
      lang: readLang(),
      bottomNavCustom: settings.bottomNavCustom === true,
      drawerMenu: settings.drawerMenu && typeof settings.drawerMenu === "object" ? settings.drawerMenu : null,
      navCustom: settings.navCustom && typeof settings.navCustom === "object" ? settings.navCustom : null,
      navCustomAt: Number(settings.navCustomAt) || 0,
      profileTabs: cleanProfileTabs(settings.profileTabs)
    };
    if (settings.storyNotes === true || settings.storyNotes === false) snap.storyNotes = settings.storyNotes;
    if (settings.bottomNav && typeof settings.bottomNav === "object") snap.bottomNav = settings.bottomNav;
    if (settings.navLayoutSync === true) {
      navLayoutUnsync = false;
      snap.navLayoutSync = true;
      snap.navLayout = settings.navLayout === "bar" ? "bar" : "auto";
      snap.navLayoutLand = settings.navLayoutLand === true;
    } else if (navLayoutUnsync) {
      navLayoutUnsync = false;
      snap.navLayoutSync = false;
    }
    if (settings.noteTabsSame === true || settings.noteTabsSame === false) snap.noteTabsSame = settings.noteTabsSame !== false;
    if (settings.devicePerf && typeof settings.devicePerf === "object") {
      snap.devicePerf = window.ViktorychDevice && window.ViktorychDevice.syncShape
        ? window.ViktorychDevice.syncShape(settings.devicePerf)
        : settings.devicePerf;
    }
    var live = window.ViktorychAccounts && window.ViktorychAccounts.readHistory && window.ViktorychAccounts.readHistory();
    if (live) {
      snap.history = live.history || [];
      snap.historyCut = live.historyCut || snap.historyCut;
    }
    if (typeof settings.homePills === "boolean") snap.homePills = settings.homePills;
    if (typeof settings.stories === "boolean") snap.stories = settings.stories;
    if (settings.prefsAt && typeof settings.prefsAt === "object") snap.prefsAt = Object.assign({}, settings.prefsAt);
    if (settings.syncUi === false || settings.syncUi === true) snap.syncUi = settings.syncUi;
    snap.syncUiAt = Number(settings.syncUiAt) || 0;
    if (!uiSyncOn(settings)) {
      // This device keeps its own look: the server keeps the account's copy.
      UI_KEYS.forEach(function (key) { delete snap[key]; });
      snap.uiLocal = true;
    }
    var reg = registry();
    if (reg) {
      EXTRA_PREFS.forEach(function (key) { if (settings[key] !== undefined) snap[key] = settings[key]; });
      var music = reg.readMusic();
      if (music) snap.musicPrefs = music;
      reg.stamp(snap);
      // "Keep on this device only": left out here, the server keeps the
      // account's copy for the other devices.
      var own = ownKeys(settings);
      if (own.length) {
        own.forEach(function (key) { delete snap[key]; if (snap.prefsAt) delete snap.prefsAt[key]; });
        snap.localKeys = own;
      }
    }
    return snap;
  }
  function localSnapshot() {
    var raw = readStored("settings-v1");
    var settings = {};
    try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    return snapshotFrom(settings);
  }
  function uniq(list) {
    var out = [];
    (list || []).forEach(function (item) {
      if (item == null || out.indexOf(item) >= 0) return;
      out.push(item);
    });
    return out;
  }
  function unionObjects(local, remote) {
    var out = {};
    Object.keys(remote || {}).forEach(function (key) { out[key] = remote[key]; });
    Object.keys(local || {}).forEach(function (key) { out[key] = local[key]; });
    return out;
  }
  /* Communities custom tabs travel as one block with its own stamp: the
     newer block wins whole, so a rename, a new order or a deleted tab is
     not undone by an older device. */
  function cleanCommunityTabs(bag) {
    var list = bag && Array.isArray(bag.tabs) ? bag.tabs : [];
    var tabs = [];
    var seen = {};
    list.forEach(function (tab) {
      if (!tab || typeof tab !== "object" || tabs.length >= 12) return;
      var id = String(tab.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
      var name = String(tab.name || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 40);
      if (!id || !name || seen[id]) return;
      seen[id] = true;
      var sources = (Array.isArray(tab.sources) ? tab.sources : []).map(function (src) { return String(src || "").slice(0, 120); }).filter(function (src) {
        return /^[cp]:./.test(src);
      }).slice(0, 50);
      tabs.push({ id: id, name: name, sources: sources, home: tab.home === true });
    });
    return { at: Number(bag && bag.at) || 0, tabs: tabs };
  }
  function pickCommunityTabs(local, remote) {
    var l = cleanCommunityTabs(local);
    var r = cleanCommunityTabs(remote);
    return l.at >= r.at ? l : r;
  }
  function unionById(local, remote) {
    var map = {};
    (remote || []).forEach(function (item) { if (item && item.id) map[item.id] = item; });
    (local || []).forEach(function (item) { if (item && item.id) map[item.id] = item; });
    return Object.keys(map).map(function (key) { return map[key]; });
  }
  function historyCutOf(local, remote) {
    function n(src, key) {
      var value = src && src.historyCut ? Number(src.historyCut[key]) : 0;
      return isFinite(value) && value > 0 ? value : 0;
    }
    return {
      video: Math.max(n(local, "video"), n(remote, "video")),
      article: Math.max(n(local, "article"), n(remote, "article"))
    };
  }
  function mergeHistory(local, remote, cut) {
    var map = {};
    function take(row) {
      if (!row || (row.kind !== "video" && row.kind !== "article")) return;
      var id = String(row.id || "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80);
      var at = Number(row.at);
      if (!id || !isFinite(at) || at <= 0) return;
      if (cut && at <= (Number(cut[row.kind]) || 0)) return;
      var progress = Number(row.progress);
      var item = {
        id: id,
        kind: row.kind,
        platform: String(row.platform || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24),
        at: Math.floor(at)
      };
      if (isFinite(progress) && progress > 0 && progress <= 1) item.progress = Math.round(progress * 1000) / 1000;
      var key = item.kind + ":" + item.id;
      var prev = map[key];
      if (!prev || item.at >= prev.at) map[key] = item;
    }
    (Array.isArray(remote) ? remote : []).forEach(take);
    (Array.isArray(local) ? local : []).forEach(take);
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 300);
  }
  function facePick(local, remote) {
    if (local === "show" || local === "default" || local === "none") return local;
    if (remote === "show" || remote === "default" || remote === "none") return remote;
    return "show";
  }
  function mergeNoteTabs(local, remote) {
    var map = {};
    function take(tab) {
      if (!tab || !tab.id) return;
      var prev = map[tab.id];
      if (!prev) { map[tab.id] = tab; return; }
      var newer = (Number(tab.updatedAt) || 0) >= (Number(prev.updatedAt) || 0);
      var next = newer ? Object.assign({}, prev, tab) : Object.assign({}, tab, prev);
      next.readAt = Math.max(Number(tab.readAt) || 0, Number(prev.readAt) || 0);
      next.deletedAt = Math.max(Number(tab.deletedAt) || 0, Number(prev.deletedAt) || 0);
      next.updatedAt = Math.max(Number(tab.updatedAt) || 0, Number(prev.updatedAt) || 0);
      map[tab.id] = next;
    }
    (remote || []).forEach(take);
    (local || []).forEach(take);
    return Object.keys(map).map(function (key) { return map[key]; });
  }
  function pickBottomNav(local, remote) {
    local = local || {};
    remote = remote || {};
    if (local.bottomNavCustom && local.bottomNav && typeof local.bottomNav === "object") {
      return { bottomNav: local.bottomNav, bottomNavCustom: true };
    }
    if (remote.bottomNav && typeof remote.bottomNav === "object") {
      return { bottomNav: remote.bottomNav, bottomNavCustom: !!remote.bottomNavCustom };
    }
    if (local.bottomNav && typeof local.bottomNav === "object") {
      return { bottomNav: local.bottomNav, bottomNavCustom: false };
    }
    return { bottomNavCustom: false };
  }
  var navLayoutUnsync = false;
  function releaseNavLayout() {
    navLayoutUnsync = true;
  }
  function pickNavLayout(local, remote) {
    if (local && local.navLayoutSync === false) return { clear: true };
    function choice(src) {
      if (!src || src.navLayoutSync !== true) return null;
      return {
        navLayoutSync: true,
        navLayout: src.navLayout === "bar" ? "bar" : "auto",
        navLayoutLand: src.navLayoutLand === true
      };
    }
    return choice(local) || choice(remote);
  }
  function mergePayload(local, remote) {
    remote = remote || {};
    var follows = uniq([].concat(local.follows || [], remote.follows || []));
    var cut = historyCutOf(local, remote);
    var pause = local.historyPause || remote.historyPause || { videos: false, articles: false };
    var localHistory = local.history;
    if (Array.isArray(localHistory) && ((local.historyPause && local.historyPause.videos) || (local.historyPause && local.historyPause.articles))) {
      localHistory = localHistory.filter(function (row) {
        if (local.historyPause.videos && row && row.kind === "video") return false;
        if (local.historyPause.articles && row && row.kind === "article") return false;
        return true;
      });
    }
    var history = mergeHistory(localHistory, remote.history, cut);
    var pickedNav = pickBottomNav(local, remote);
    var pickedLayout = pickNavLayout(local, remote);
    var merged = {
      follows: follows,
      seenFeeds: uniq([].concat(local.seenFeeds || [], remote.seenFeeds || [], follows)),
      seenDefaults: uniq([].concat(local.seenDefaults || [], remote.seenDefaults || [], follows)),
      lists: unionById(local.lists, remote.lists),
      likes: unionObjects(local.likes, remote.likes),
      bookmarks: unionObjects(local.bookmarks, remote.bookmarks),
      reposts: unionObjects(local.reposts, remote.reposts),
      savedPosts: unionObjects(local.savedPosts, remote.savedPosts),
      feedTabs: unionById(local.feedTabs, remote.feedTabs),
      communityTabs: pickCommunityTabs(local.communityTabs, remote.communityTabs),
      noteTabs: mergeNoteTabs(local.noteTabs, remote.noteTabs),
      noteTabsSame: local.noteTabsSame === true || local.noteTabsSame === false ? local.noteTabsSame !== false : remote.noteTabsSame !== false,
      lastNoteTab: local.lastNoteTab || remote.lastNoteTab || "all",
      mutedWords: uniq([].concat(local.mutedWords || [], remote.mutedWords || [])),
      mutedAccounts: uniq([].concat(local.mutedAccounts || [], remote.mutedAccounts || [])),
      repostOff: uniq([].concat(local.repostOff || [], remote.repostOff || [])),
      blocks: pickBlocks(local.blocks, remote.blocks),
      groups: unionById(local.groups, remote.groups),
      tabViews: unionObjects(local.tabViews, remote.tabViews),
      groupsOwn: !!local.groupsOwn,
      subsGroup: local.subsGroup || "",
      appearance: local.appearance || remote.appearance || "lightsout",
      autoplay: local.autoplay || remote.autoplay || "all",
      notify: local.notify != null ? !!local.notify : !!remote.notify,
      translateTo: local.translateTo || remote.translateTo || "en",
      followingSort: local.followingSort === "popular" || remote.followingSort === "popular" ? (local.followingSort || remote.followingSort) : "recent",
      showPictures: facePick(local.showPictures, remote.showPictures),
      showBanners: facePick(local.showBanners, remote.showBanners),
      forYouReposts: local.forYouReposts !== false,
      forYouReplies: local.forYouReplies !== false,
      historyPause: pause,
      historyCut: cut,
      history: history,
      lang: local.lang || remote.lang || "en",
      bottomNavCustom: pickedNav.bottomNavCustom,
      drawerMenu: (Number(local.drawerMenu && local.drawerMenu.at) || 0) >= (Number(remote.drawerMenu && remote.drawerMenu.at) || 0) ? (local.drawerMenu || remote.drawerMenu || null) : (remote.drawerMenu || local.drawerMenu || null),
      navCustom: (Number(local.navCustomAt) || 0) >= (Number(remote.navCustomAt) || 0) ? (local.navCustom || remote.navCustom || null) : (remote.navCustom || local.navCustom || null),
      navCustomAt: Math.max(Number(local.navCustomAt) || 0, Number(remote.navCustomAt) || 0),
      profileTabs: (Number(local.profileTabs && local.profileTabs.at) || 0) >= (Number(remote.profileTabs && remote.profileTabs.at) || 0) ? cleanProfileTabs(local.profileTabs || remote.profileTabs) : cleanProfileTabs(remote.profileTabs || local.profileTabs)
    };
    if (local.storyNotes === true || local.storyNotes === false) merged.storyNotes = local.storyNotes;
    else if (remote.storyNotes === true || remote.storyNotes === false) merged.storyNotes = remote.storyNotes;
    if ((local.devicePerf && typeof local.devicePerf === "object") || (remote.devicePerf && typeof remote.devicePerf === "object")) {
      merged.devicePerf = (local.devicePerf && typeof local.devicePerf === "object") ? local.devicePerf : remote.devicePerf;
    }
    if (pickedNav.bottomNav) merged.bottomNav = pickedNav.bottomNav;
    var prefs = pickPrefs(local, remote);
    if (typeof prefs.homePills === "boolean") merged.homePills = prefs.homePills;
    if (typeof prefs.stories === "boolean") merged.stories = prefs.stories;
    merged.prefsAt = prefs.prefsAt;
    var reg = registry();
    if (reg) {
      var lww = reg.pick(local, remote, reg.neverSynced());
      Object.keys(lww.values).forEach(function (key) { merged[key] = lww.values[key]; });
      Object.keys(lww.at).forEach(function (key) { merged.prefsAt[key] = lww.at[key]; });
    }
    if (Array.isArray(local.localKeys)) {
      local.localKeys.forEach(function (key) {
        if (remote[key] !== undefined) merged[key] = remote[key];
        else delete merged[key];
        var rAt = remote.prefsAt && Number(remote.prefsAt[key]);
        if (rAt) merged.prefsAt[key] = rAt;
        else delete merged.prefsAt[key];
      });
      merged.localKeys = local.localKeys.slice();
    }
    var lSync = Number(local.syncUiAt) || 0;
    var rSync = Number(remote.syncUiAt) || 0;
    var syncPick = rSync > lSync ? remote.syncUi : local.syncUi;
    if (syncPick === true || syncPick === false) merged.syncUi = syncPick;
    merged.syncUiAt = Math.max(lSync, rSync);
    if (local.uiLocal) {
      // Keep the account's look for the other devices, not this device's.
      UI_KEYS.forEach(function (key) {
        if (remote[key] !== undefined) merged[key] = remote[key];
        else delete merged[key];
      });
      merged.uiLocal = true;
    }
    if (pickedLayout && pickedLayout.clear) merged.navLayoutSync = false;
    else if (pickedLayout) {
      merged.navLayoutSync = true;
      merged.navLayout = pickedLayout.navLayout;
      merged.navLayoutLand = pickedLayout.navLayoutLand;
    }
    return merged;
  }
  function applySnapshot(payload) {
    var raw = readStored("settings-v1");
    var settings = {};
    try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    var syncAt = Number(payload && payload.syncUiAt) || 0;
    if (syncAt > (Number(settings.syncUiAt) || 0) && (payload.syncUi === true || payload.syncUi === false)) {
      settings.syncUi = payload.syncUi;
      settings.syncUiAt = syncAt;
    }
    var keepOwn = !uiSyncOn(settings);
    var own = ownKeys(settings);
    var reg = registry();
    var taken = {};
    Object.keys(payload || {}).forEach(function (key) {
      if (key === "lang" || key === "history" || key === "uiLocal" || key === "syncUi" || key === "syncUiAt" || key === "localKeys" || key === "sealed") return;
      if (keepOwn && UI_KEYS.indexOf(key) >= 0) return;
      if (own.indexOf(key) >= 0) return;
      taken[key] = payload[key];
      if (key === "musicPrefs") {
        if (reg) reg.writeMusic(payload.musicPrefs);
        return;
      }
      if (key === "prefsAt" && payload.prefsAt && typeof payload.prefsAt === "object") {
        // Stamps of device-only settings stay this device's own.
        var keep = Object.assign({}, payload.prefsAt);
        own.forEach(function (k) {
          if (settings.prefsAt && settings.prefsAt[k]) keep[k] = settings.prefsAt[k];
          else delete keep[k];
        });
        settings.prefsAt = keep;
        return;
      }
      if ((key === "navLayout" || key === "navLayoutLand" || key === "navLayoutSync") && settings.navLayoutSync !== true) return;
      settings[key] = payload[key];
    });
    writeStored("settings-v1", JSON.stringify(settings));
    if (reg) reg.remember(taken);
    if (window.ViktorychAccounts && window.ViktorychAccounts.writeHistory) window.ViktorychAccounts.writeHistory(payload);
    if (payload && own.indexOf("lang") < 0 && (payload.lang === "en" || payload.lang === "ru" || payload.lang === "es")) {
      try { localStorage.setItem("superintelapp-lang", payload.lang); } catch (err) { /* the page language stays */ }
      try { localStorage.setItem("viktorychapp-lang-user-picked", "1"); } catch (err) {}
      if (window.SI18n && typeof window.SI18n.setLang === "function" && window.SI18n.getLang() !== payload.lang) {
        window.SI18n.setLang(payload.lang);
      }
    }
    try { window.dispatchEvent(new CustomEvent("viktorych-settings-applied")); } catch (err) { /* the open page keeps its copy */ }
  }
  function rememberSync(updatedAt) {
    var session = readSession();
    if (!session) return;
    session.syncAt = Number(updatedAt) || 0;
    writeSession(session);
  }
  function pushPayload(payload, base) {
    var session = readSession();
    if (!session || !hasApi()) return Promise.resolve();
    pushing = true;
    return api("/v1/sync", { method: "PUT", token: session.token, body: { payload: payload, baseUpdatedAt: base || 0, device: syncDeviceId() } }).then(function (body) {
      pushing = false;
      if (body.status === 409 && body.payload) {
        var merged = mergePayload(payload, body.payload);
        applySnapshot(merged);
        return pushPayload(merged, body.updatedAt);
      }
      if (body.status === 200) {
        rememberSync(body.updatedAt);
        applySnapshot(body.payload || payload);
      }
    }).catch(function () { pushing = false; });
  }
  function mergeSync(pullOnly) {
    var session = readSession();
    if (!session || !hasApi()) return Promise.resolve();
    lastPull = Date.now();
    return api("/v1/sync", { token: session.token }).then(function (body) {
      var local = localSnapshot();
      if (!body || body.status !== 200) return;
      if (pullOnly) {
        // Another device changed something: take it in without pushing back,
        // so two open devices never bounce writes at each other.
        if (!body.payload) return;
        applySnapshot(mergeRemoteFirst(local, body.payload));
        rememberSync(body.updatedAt || 0);
        return;
      }
      if (!body.payload) return pushPayload(local, 0);
      var merged = mergePayload(local, body.payload);
      applySnapshot(merged);
      return pushPayload(merged, body.updatedAt || 0);
    }).catch(function () {});
  }
  /* The remote copy is newer here, so plain single-value choices follow it;
     sets (follows, likes, lists) still union as in mergePayload. */
  function mergeRemoteFirst(local, remote) {
    var merged = mergePayload(local, remote);
    var lAt = local.prefsAt || {};
    var rAt = remote.prefsAt || {};
    ["appearance", "autoplay", "translateTo", "followingSort", "notify", "showPictures", "showBanners", "forYouReposts", "forYouReplies"].forEach(function (key) {
      // A newer local change that has not been pushed yet stays.
      if ((Number(lAt[key]) || 0) > (Number(rAt[key]) || 0)) return;
      if (local.localKeys && local.localKeys.indexOf(key) >= 0) return;
      if (remote[key] !== undefined) merged[key] = remote[key];
    });
    return merged;
  }
  var DEVICE_ID_KEY = "viktorychapp-sync-device";
  function syncDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2, 12);
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (err) { return ""; }
  }
  var lastPull = 0;
  var pullTimer = 0;
  var liveBound = false;
  function pullSoon() {
    if (!readSession() || !hasApi() || pushing) return;
    clearTimeout(pullTimer);
    pullTimer = setTimeout(function () { mergeSync(true); }, 400);
  }
  function bindLiveSync() {
    var presence = window.ViktorychPresence;
    if (liveBound || !presence || !presence.onChannel) return;
    liveBound = true;
    presence.onChannel(function (msg) {
      if (!msg || msg.op !== "event" || msg.topic !== "sync" || !msg.data) return;
      var session = readSession();
      if (!session || msg.data.device === syncDeviceId()) return;
      if (Number(msg.data.updatedAt) === Number(session.syncAt)) return;
      pullSoon();
    });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !historyBooted) return;
      bindLiveSync();
      // Without a socket, a tab coming back checks at most once a minute.
      if (Date.now() - lastPull > 60000) pullSoon();
    });
  }
  var historyBooted = false;
  function onHistoryReady() {
    if (historyBooted) return;
    historyBooted = true;
    setTimeout(bindLiveSync, 3000);
    if (readSession()) mergeSync().then(function () { return syncFollows(); }, function () { return syncFollows(); });
  }
  function onLocalChange() {
    if (!readSession() || !hasApi() || pushing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      var session = readSession();
      if (!session) return;
      pushPayload(localSnapshot(), session.syncAt || 0);
    }, 700);
  }
  function commitSession(token, account) {
    clearPending();
    writeSession({ token: token, account: account, syncAt: 0 });
    tellSW(true);
    installFetch();
    return mergeSync().then(finishAuth, finishAuth);
  }
  function turnstileToken() {
    try {
      if (window.turnstile && window.turnstile.getResponse) return window.turnstile.getResponse() || "";
    } catch (err) { /* the widget is optional */ }
    return "";
  }
function signupPayload() {
    errorText = "";
    var handle = String(form.handle || "").trim().replace(/^@/, "");
    if (!handle && form.profileLess) {
      handle = "anon_" + Math.random().toString(36).slice(2, 10);
    }
    form.handle = handle;
    var checked = window.HandleSkeleton ? window.HandleSkeleton.inspectHandle(handle) : { ok: true, owner: false };
    if (!checked.ok) {
      if (!handle) errorText = tr("Choose a handle.");
      else errorText = errorMessage(checked.error === "reserved" ? "handle_reserved" : "invalid_handle");
      paint();
      return null;
    }
    if (checked.owner && !String(form.claimCode || "").trim()) {
      form.claimOpen = true;
      errorText = tr("Enter the claim code for this handle.");
      paint();
      return null;
    }
    return {
      displayName: String(form.displayName || "").trim() || tr("Anonymous"),
      handle: handle,
      claimCode: String(form.claimCode || "").trim(),
      profileLess: !!form.profileLess,
      turnstileToken: turnstileToken()
    };
  }
  function offlineMessage() {
    return tr("Can't reach the server. Check your connection and try again.");
  }
  function finishPending() {
    if (authBusy || !form.saved) return;
    var pending = readPending();
    if (!pending) return;
    storeCredential(document.getElementById("acct-save-form"));
    authBusy = true;
    paint();
    commitSession(pending.token, pending.account);
  }
  function nextSignup() {
    if (authBusy) return;
    errorText = "";
    if (step === 0) {
      var name = String(form.displayName || "").trim();
      if (!name && !form.profileLess) {
        errorText = tr("What should we call you?");
        paint();
        return;
      }
      if (!name && form.profileLess) {
        form.displayName = tr("Anonymous");
      }
      step = 1;
      paint();
      return;
    }
    var body = signupPayload();
    if (!body) return;
    authBusy = true;
    paint();
    ensureGuard().then(function (pow) {
      body.pow = pow;
      body.fax = faxValue();
      return api("/v1/signup", { method: "POST", body: body });
    }).then(function (res) {
      authBusy = false;
      if (res.status === 201 && res.token && res.accountNumber) {
        /* The server already follows the owner's accounts for a new account.
           Guest follows stay on this device and are not imported. */
        if (res.account && res.account.publicId) writeStored("follows-imported-v2-" + res.account.publicId, "1");
        if (typeof window.ViktorychAccounts.onSignup === "function") {
          try { window.ViktorychAccounts.onSignup(res.account || {}); } catch (err) { /* the session still opens */ }
        }
        writePending({ token: res.token, accountNumber: res.accountNumber, recoveryCodes: res.recoveryCodes || [], account: res.account });
        view = "signup";
        step = 2;
        form.saved = false;
        errorText = "";
        paint();
        return;
      }
      if (view !== "signup") return;
      if (res.error === "claim_required") form.claimOpen = true;
      if (res.status === 429) errorText = tr("Too many attempts. Try again later.");
      else errorText = errorMessage(res.error);
      paint();
    }).catch(function () {
      authBusy = false;
      if (view !== "signup") return;
      errorText = offlineMessage();
      paint();
    });
  }
  function doLogin() {
    if (authBusy) return;
    var digits = String(form.accountNumber || "").replace(/\D/g, "");
    errorText = "";
    if (digits.length !== 16) {
      errorText = tr("Account numbers are 16 digits.");
      paint();
      return;
    }
    authBusy = true;
    paint();
    api("/v1/login", { method: "POST", body: { accountNumber: digits, turnstileToken: turnstileToken() } }).then(function (res) {
      authBusy = false;
      if (view !== "login") return;
      if (res.status !== 200 || !res.token) {
        if (res.status === 429) {
          errorText = tr("Too many attempts. Try again later.");
        } else {
          errorText = errorMessage(res.error) || tr("Could not sign in.");
        }
        paint();
        return;
      }
      storeCredential(document.getElementById("acct-login-form"));
      commitSession(res.token, res.account);
    }).catch(function () {
      authBusy = false;
      if (view !== "login") return;
      errorText = offlineMessage();
      paint();
    });
  }
  function doRecover() {
    if (authBusy) return;
    var code = String(form.recovery || "").trim();
    errorText = "";
    if (!code) {
      errorText = tr("Enter one recovery code. It works once, then new codes replace it.");
      paint();
      return;
    }
    authBusy = true;
    paint();
    api("/v1/recovery/restore", { method: "POST", body: { code: code } }).then(function (res) {
      authBusy = false;
      if (!res || res.status !== 200 || !res.token || !res.accountNumber) {
        errorText = errorMessage((res && res.error) || "recovery_invalid");
        paint();
        return;
      }
      writePending({ token: res.token, accountNumber: res.accountNumber, recoveryCodes: res.recoveryCodes || [], account: res.account });
      view = "signup";
      step = 2;
      form.saved = false;
      form.passkey = false;
      errorText = "";
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = offlineMessage();
      paint();
    });
  }
  function savePasskeyNow() {
    var pending = readPending();
    if (!pending || !pending.token || !window.ViktorychPasskeys) return;
    authBusy = true;
    paint();
    api("/v1/webauthn/register/options", { method: "POST", token: pending.token, body: {} }).then(function (res) {
      if (!res || res.status !== 200 || !res.publicKey) throw new Error("passkey");
      return window.ViktorychPasskeys.create(res.publicKey).then(function (credential) {
        return api("/v1/webauthn/register/verify", { method: "POST", token: pending.token, body: { challengeId: res.challengeId, credential: credential, label: tr("This device") } });
      });
    }).then(function (res) {
      authBusy = false;
      errorText = res && res.status === 200 ? tr("Passkey saved") : tr("Could not create a passkey.");
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = tr("Could not create a passkey.");
      paint();
    });
  }
  function finishPasskeyLogin(credential, challengeId) {
    return api("/v1/webauthn/login/verify", { method: "POST", body: { challengeId: challengeId, credential: credential } }).then(function (res) {
      if (!res || res.status !== 200 || !res.token) {
        errorText = errorMessage((res && res.error) || "passkey_failed");
        paint();
        return;
      }
      commitSession(res.token, res.account);
    }).catch(function () {
      errorText = tr("Could not verify that passkey.");
      paint();
    });
  }
  function doPasskeyLogin(credential, challengeId) {
    errorText = "";
    if (!window.ViktorychPasskeys) return;
    if (credential && challengeId) return finishPasskeyLogin(credential, challengeId);
    window.ViktorychPasskeys.stopConditional();
    api("/v1/webauthn/login/options", { method: "POST", body: {} }).then(function (res) {
      if (!res || res.status !== 200 || !res.publicKey) {
        errorText = errorMessage((res && res.error) || "passkey_failed");
        paint();
        return;
      }
      return window.ViktorychPasskeys.get(res.publicKey).then(function (json) {
        return finishPasskeyLogin(json, res.challengeId);
      });
    }).catch(function () {
      errorText = tr("Could not verify that passkey.");
      paint();
    });
  }
  function doPasskeySignup() {
    if (authBusy) return;
    if (!window.ViktorychPasskeys || !window.ViktorychPasskeys.supported()) {
      nextSignup();
      return;
    }
    var body = signupPayload();
    if (!body) return;
    authBusy = true;
    paint();
    ensureGuard().then(function (pow) {
      body.pow = pow;
      body.fax = faxValue();
      return api("/v1/webauthn/signup/options", { method: "POST", body: body });
    }).then(function (res) {
      if (!res || res.status !== 200 || !res.publicKey) {
        authBusy = false;
        if (res && res.error === "claim_required") form.claimOpen = true;
        errorText = errorMessage((res && res.error) || "passkey_failed");
        paint();
        return null;
      }
      return window.ViktorychPasskeys.create(res.publicKey).then(function (credential) {
        return api("/v1/webauthn/signup/verify", {
          method: "POST",
          body: { challengeId: res.challengeId, credential: credential, turnstileToken: turnstileToken(), label: tr("This device") }
        });
      });
    }).then(function (res) {
      if (!res) return;
      authBusy = false;
      if (res.status !== 201 || !res.token || !res.accountNumber) {
        errorText = errorMessage(res.error || "passkey_failed");
        paint();
        return;
      }
      form.passkey = true;
      writePending({ token: res.token, accountNumber: res.accountNumber, recoveryCodes: res.recoveryCodes || [], account: res.account });
      step = 2;
      form.saved = false;
      errorText = "";
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = tr("Could not create a passkey.");
      paint();
    });
  }
  function doEmergency() {
    var raw = String(form.emergencyClaim || "").trim();
    errorText = "";
    if (!raw) {
      errorText = tr("Enter the claim code for this handle.");
      paint();
      return;
    }
    var targetHash = String(config().emergencyHash || "").trim();
    var proceed = function (ok) {
      if (!ok) {
        errorText = tr("Invalid claim code.");
        paint();
        return;
      }
      var session = {
        token: "emergency-offline-" + Date.now(),
        emergency: true,
        account: {
          publicId: "emergency_owner",
          handle: "",
          displayName: "Owner",
          owner: true
        }
      };
      commitSession(session.token, session.account);
    };
    if (targetHash) {
      try {
        var enc = new TextEncoder();
        crypto.subtle.digest("SHA-256", enc.encode("viktorych-emergency:" + raw)).then(function (digest) {
          var bytes = new Uint8Array(digest);
          var hex = "";
          for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
          proceed(hex.toLowerCase() === targetHash.toLowerCase());
        }).catch(function () { proceed(false); });
      } catch (err) { proceed(false); }
    } else if (raw.length >= 6) {
      proceed(true);
    } else {
      proceed(false);
    }
  }
  function doRestoreSession() {
    var raw = String(form.sessionCode || "").trim();
    errorText = "";
    if (!raw) {
      errorText = tr("Enter your session code.");
      paint();
      return;
    }
    var parsed = null;
    try {
      var decoded = decodeURIComponent(escape(atob(raw.replace(/\s+/g, ""))));
      parsed = JSON.parse(decoded);
    } catch (e) {
      try {
        parsed = JSON.parse(raw);
      } catch (e2) {
        if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) {
          parsed = { token: raw };
        }
      }
    }
    if (!parsed || !parsed.token) {
      errorText = tr("Invalid session code.");
      paint();
      return;
    }
    if (parsed.account && parsed.account.handle) {
      commitSession(parsed.token, parsed.account);
      return;
    }
    api("/v1/session", { token: parsed.token }).then(function (res) {
      if (res.status === 200 && res.account) {
        commitSession(parsed.token, res.account);
      } else {
        errorText = tr("Invalid session code.");
        paint();
      }
    }).catch(function () {
      errorText = tr("Something went wrong. Try again.");
      paint();
    });
  }
  function copySession() {
    var session = readSession();
    if (!session || !session.token) return;
    var payload = btoa(unescape(encodeURIComponent(JSON.stringify({ token: session.token, account: session.account }))));
    var done = function () {
      errorText = tr("Session code copied");
      paint();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(done, function () {
        prompt(tr("Copy session code:"), payload);
      });
    } else {
      prompt(tr("Copy session code:"), payload);
    }
  }
  function copyNumber() {
    var pending = readPending();
    var text = pending ? grouped(pending.accountNumber) : "";
    var done = function () {
      errorText = tr("Copied");
      paint();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, downloadNumber);
      return;
    }
    downloadNumber();
  }
  function listedCodes() {
    var nodes = document.querySelectorAll("#account-layer [data-recovery-code]");
    var codes = [];
    for (var i = 0; i < nodes.length; i++) {
      var text = String(nodes[i].textContent || "").trim();
      if (text) codes.push(text);
    }
    return codes;
  }
  function saveTextFile(name, text) {
    var blob = new Blob([text], { type: "text/plain" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  function copyCodes() {
    var text = listedCodes().join("\n");
    if (!text) return;
    var done = function () {
      errorText = tr("Copied");
      paint();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { saveTextFile("recovery-codes.txt", text + "\n"); });
      return;
    }
    saveTextFile("recovery-codes.txt", text + "\n");
  }
  function downloadCodes() {
    var text = listedCodes().join("\n");
    if (!text) return;
    saveTextFile("recovery-codes.txt", text + "\n");
  }
  function regenerateCodes() {
    var session = readSession();
    if (!session || authBusy) return;
    authBusy = true;
    errorText = "";
    api("/v1/recovery/codes", { method: "POST", token: session.token, body: {} }).then(function (res) {
      authBusy = false;
      if (!res || res.status !== 200 || !res.recoveryCodes || !res.recoveryCodes.length) {
        errorText = errorMessage((res && res.error) || "");
        paint();
        return;
      }
      form.recoveryCodes = res.recoveryCodes;
      view = "recovery";
      errorText = "";
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = offlineMessage();
      paint();
    });
  }
  function reportsBody() {
    if (reportState.loading && !reportState.items.length) return '<p class="acct-sub">' + esc(tr("Loading…")) + "</p>";
    if (!reportState.items.length) return '<p class="acct-sub">' + esc(tr("No open reports")) + "</p>" + errorHtml();
    return reportState.items.map(function (item) {
      return '<article class="acct-codes"><p>' + esc(item.body || "") + '</p><p class="acct-sub">' + esc(item.reason || "") + '</p><div class="acct-row"><button type="button" data-acct="report-hide" data-id="' + esc(item.id) + '">' + esc(tr("Hide")) + '</button><button type="button" data-acct="report-dismiss" data-id="' + esc(item.id) + '">' + esc(tr("Dismiss report")) + "</button></div></article>";
    }).join("") + errorHtml();
  }
  function loadReports() {
    var session = readSession();
    if (!session) return;
    reportState.loading = true;
    api("/v1/moderation/reports", { token: session.token }).then(function (res) {
      reportState.loading = false;
      reportState.items = res && Array.isArray(res.reports) ? res.reports : [];
      if (view === "reports") paint();
    }).catch(function () {
      reportState.loading = false;
      errorText = tr("Something went wrong. Try again.");
      if (view === "reports") paint();
    });
  }
  function resolveReport(id, action) {
    var session = readSession();
    if (!session || !id) return;
    api("/v1/moderation/reports", { method: "POST", token: session.token, body: { id: id, action: action } }).then(function () {
      loadReports();
    }).catch(function () {});
  }
  function downloadNumber() {
    var pending = readPending();
    if (!pending) return;
    var text = tr("Account number") + "\n" + grouped(pending.accountNumber) + "\n\n" + tr("Keep this file private. This number is the only way back into the account.") + "\n";
    var blob = new Blob([text], { type: "text/plain" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "account-number.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  function abandon() {
    var pending = readPending();
    var token = pending && pending.token;
    clearPending();
    view = "";
    if (token && hasApi()) api("/v1/logout", { method: "POST", token: token }).catch(function () {});
    paint();
  }
  function logout(all) {
    var session = readSession();
    var token = session && session.token;
    var prep = window.ViktorychNotes && window.ViktorychNotes.beforeSignOut ? window.ViktorychNotes.beforeSignOut(!!all, token) : null;
    Promise.resolve(prep).then(function () {
      removeStored("account-v1");
      tellSW(false, "signout");
      // Signing out erases what this device saved for the account (app-lock.js).
      var lock = window.ViktorychAppLock;
      var wiping = lock && lock.wipeData ? lock.wipeData(true).catch(function () {}) : null;
      var done = function () { Promise.resolve(wiping).then(function () { location.replace(location.pathname + location.search); location.reload(); }); };
      if (!token || !hasApi()) { done(); return; }
      api(all ? "/v1/logout-all" : "/v1/logout", { method: "POST", token: token }).then(done, done);
    }, function () {
      removeStored("account-v1");
      tellSW(false, "signout");
      location.replace(location.pathname + location.search);
      location.reload();
    });
  }
  function fitImage(file, edge, maxChars) {
    return new Promise(function (resolve) {
      if (!file) { resolve(""); return; }
      var ios = window.ViktorychIos;
      if (ios && ios.isHeic && ios.isHeic(file) && ios.readOriginal) {
        ios.readOriginal(file).then(resolve);
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, edge / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        var quality = 0.86;
        var data = canvas.toDataURL("image/jpeg", quality);
        while (data.length > maxChars && quality > 0.4) {
          quality -= 0.08;
          data = canvas.toDataURL("image/jpeg", quality);
        }
        URL.revokeObjectURL(url);
        resolve(data.length > maxChars ? "" : data);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(""); };
      img.src = url;
    });
  }
  function layoutCrop() {
    var stage = document.querySelector("#account-layer .acct-crop-stage");
    if (!stage || !form.cropW || !form.cropH) return null;
    var frameW = stage.clientWidth;
    var frameH = stage.clientHeight;
    if (!frameW || !frameH) return null;
    var zoom = Math.min(3, Math.max(1, Number(form.cropZoom) || 1));
    form.cropZoom = zoom;
    var base = Math.max(frameW / form.cropW, frameH / form.cropH);
    var dispW = form.cropW * base * zoom;
    var dispH = form.cropH * base * zoom;
    if (!form.cropReady) {
      form.cropX = (frameW - dispW) / 2;
      form.cropY = (frameH - dispH) / 2;
      form.cropReady = true;
    }
    form.cropX = Math.min(0, Math.max(Math.min(0, frameW - dispW), form.cropX || 0));
    form.cropY = Math.min(0, Math.max(Math.min(0, frameH - dispH), form.cropY || 0));
    var img = stage.querySelector("img");
    if (!img) return null;
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = "0";
    img.style.maxWidth = "none";
    img.style.width = dispW + "px";
    img.style.height = dispH + "px";
    img.style.transform = "translate(" + form.cropX + "px," + form.cropY + "px)";
    return { frameW: frameW, frameH: frameH, dispW: dispW, dispH: dispH };
  }
  function startCrop(file, kind) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      if (form.cropUrl) URL.revokeObjectURL(form.cropUrl);
      form.cropUrl = url;
      form.cropKind = kind;
      form.cropW = img.naturalWidth || img.width;
      form.cropH = img.naturalHeight || img.height;
      form.cropZoom = 1;
      form.cropX = 0;
      form.cropY = 0;
      form.cropReady = false;
      view = "crop";
      errorText = "";
      paint();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      errorText = tr("Could not save that photo.");
      view = "edit";
      paint();
    };
    img.src = url;
  }
  function applyCrop() {
    var frame = layoutCrop();
    var image = document.querySelector("#account-layer .acct-crop-stage img");
    if (!frame || !image) return;
    var avatar = form.cropKind !== "banner";
    var outW = avatar ? 400 : 1500;
    var outH = avatar ? 400 : 500;
    var scale = form.cropW / frame.dispW;
    var sx = Math.max(0, -form.cropX * scale);
    var sy = Math.max(0, -form.cropY * scale);
    var sw = Math.min(form.cropW - sx, frame.frameW * scale);
    var sh = Math.min(form.cropH - sy, frame.frameH * scale);
    var canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
    var maxBytes = avatar ? 60 * 1024 : 150 * 1024;
    encodeWebp(canvas, maxBytes).then(function (blob) {
      if (form.cropUrl) URL.revokeObjectURL(form.cropUrl);
      form.cropUrl = "";
      form.cropReady = false;
      view = "edit";
      if (!blob) {
        errorText = tr("Could not save that photo.");
        paint();
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var data = String(reader.result || "");
        if (avatar) {
          form.avatar = data;
          form.avatarTouched = true;
        } else {
          form.banner = data;
          form.bannerTouched = true;
        }
        errorText = "";
        paint();
      };
      reader.onerror = function () {
        errorText = tr("Could not save that photo.");
        paint();
      };
      reader.readAsDataURL(blob);
    }).catch(function () {
      errorText = tr("Could not save that photo.");
      view = "edit";
      paint();
    });
  }
  function encodeWebp(canvas, maxBytes) {
    var quality = 0.82;
    return new Promise(function (resolve) {
      function step() {
        if (!canvas.toBlob) { resolve(null); return; }
        canvas.toBlob(function (blob) {
          if (!blob || blob.type !== "image/webp") { resolve(null); return; }
          if (blob.size <= maxBytes || quality <= 0.42) resolve(blob.size <= maxBytes ? blob : null);
          else { quality = Math.round((quality - 0.08) * 100) / 100; step(); }
        }, "image/webp", quality);
      }
      step();
    });
  }
  function saveProfile() {
    var session = readSession();
    if (!session) return;
    var body = {
      displayName: String(form.displayName || "").trim(),
      bio: String(form.bio || ""),
      location: String(form.location || "").trim(),
      website: String(form.website || "").trim(),
      privateFollows: !!form.privateFollows,
      profileLess: !!form.profileLess
    };
    body.avatarEmpty = form.avatarEmpty === "none" ? "none" : "default";
    body.bannerEmpty = form.bannerEmpty === "none" ? "none" : "default";
    if (form.avatarTouched) body.avatar = form.avatar || "";
    if (form.bannerTouched) body.banner = form.banner || "";
    api("/v1/profile", { method: "PATCH", token: session.token, body: body }).then(function (res) {
        if (res.status !== 200 || !res.account) {
          errorText = errorMessage(res.error);
          paint();
          return;
        }
        session.account = res.account;
        writeSession(session);
        remember(res.account);
        dirtyLists();
        view = "";
        paint();
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      errorText = tr("Something went wrong. Try again.");
      paint();
    });
  }
  function remember(account) {
    if (!account || !account.handle) return;
    profiles[skel(account.handle)] = account;
    if (account.publicId) {
      profiles[skel(account.handle + account.publicId)] = account;
      profiles[skel(account.publicId)] = account;
    }
  }
  function loadProfile(handle) {
    var key = skel(handle);
    var session = readSession();
    if (!session || profileLoads[key] || profileMiss[key] || !hasApi()) return;
    if (profiles[key] && profiles[key].repostsLoaded) return;
    profileLoads[key] = true;
    var epoch = profileEpoch[key] || 0;
    api("/v1/profile/" + encodeURIComponent(handle), { token: session.token }).then(function (body) {
      profileLoads[key] = false;
      if (!body || body.status === 404 || !body.account) {
        if ((profileEpoch[key] || 0) === epoch) profileMiss[key] = true;
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return;
      }
      if ((profileEpoch[key] || 0) !== epoch && profiles[key]) {
        body.account.reposts = profiles[key].reposts || [];
        body.account.repostsLoaded = true;
      } else {
        body.account.reposts = Array.isArray(body.reposts) ? body.reposts : [];
        body.account.repostsLoaded = true;
      }
      remember(body.account);
      // The server answers with the one username this viewer sees, which can
      // differ from the name in the link; keep it under the link's key too.
      if (profiles[key] !== body.account) profiles[key] = body.account;
      noteProfile(body.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { profileLoads[key] = false; });
  }
  function setReposts(handle, rows) {
    var key = skel(handle);
    profileEpoch[key] = (profileEpoch[key] || 0) + 1;
    profileMiss[key] = false;
    if (!profiles[key]) {
      var session = readSession();
      if (session && session.account && skel(session.account.handle) === key) profiles[key] = Object.assign({}, session.account);
    }
    if (!profiles[key]) return;
    profiles[key].reposts = Array.isArray(rows) ? rows : [];
    profiles[key].repostsLoaded = true;
  }
  var graphCounts = {};
  var followEpoch = 0;
  var listCache = {};
  var countLoads = {};
  var syncingFollows = false;
  var syncAgain = false;
  function myAccountId() {
    var session = readSession();
    return session && session.account && session.account.publicId ? "app:" + session.account.publicId : "";
  }
  function formatNum(n) {
    var value = Math.max(0, Math.trunc(Number(n) || 0));
    if (window.SI18n && window.SI18n.formatCount) return window.SI18n.formatCount(value);
    return String(value);
  }
  function readSettings() {
    try { return JSON.parse(readStored("settings-v1") || "{}") || {}; }
    catch (err) { return {}; }
  }
  function localFeedFollows() {
    return (readSettings().follows || []).filter(function (id) { return id && String(id).indexOf("app:") !== 0; });
  }
  function localAppFollows() {
    return (readSettings().accountFollows || []).filter(function (id) {
      var text = String(id || "");
      return /^app:\d{12}$/.test(text) || /^app:@[A-Za-z0-9_\u0400-\u04FF]{1,32}$/.test(text);
    });
  }
  function accountRef(account) {
    if (!account) return "";
    if (account.publicId && /^\d{12}$/.test(String(account.publicId))) return "app:" + account.publicId;
    if (account.handle) return "app:@" + account.handle;
    return "";
  }
  function profileMine(account) {
    var session = readSession();
    if (!session || !session.account || !account) return false;
    if (account.publicId && session.account.publicId === account.publicId) return true;
    return !!(account.handle && skel(session.account.handle) === skel(account.handle));
  }
  function accountStat(account, field) {
    var id = accountRef(account);
    var known = graphCounts[id];
    if (field === "following" && myAccountId() === id && (!known || known.following == null)) {
      return localFeedFollows().length + localAppFollows().length;
    }
    if (known && known[field] != null) return known[field];
    if (field === "following" && account && account.followingCount != null) return account.followingCount;
    if (field === "followers" && account && account.followersCount != null) return account.followersCount;
    if (field === "friends" && account && account.friendsCount != null) return account.friendsCount;
    return 0;
  }
  function noteProfile(account) {
    var id = accountRef(account);
    if (!account || !id) return;
    graphCounts[id] = graphCounts[id] || {};
    if (account.followingCount != null && !graphCounts[id].fresh) graphCounts[id].following = account.followingCount;
    if (account.followersCount != null && !graphCounts[id].fresh) graphCounts[id].followers = account.followersCount;
    if (account.friendsCount != null && !graphCounts[id].fresh) graphCounts[id].friends = account.friendsCount;
    if (account.viewerFriendStatus != null && !(graphCounts[id].friendAt && Date.now() - graphCounts[id].friendAt < 60000)) graphCounts[id].friendStatus = account.viewerFriendStatus;
    if (account.mutualFriendsCount != null) graphCounts[id].mutualFriendsCount = account.mutualFriendsCount;
    graphCounts[id].pending = !!account.viewerPending;
    graphCounts[id].viewerBlocks = !!account.viewerBlocks;
    graphCounts[id].blockedBy = !!account.blockedBy;
    graphCounts[id].muted = !!account.viewerMutes;
    graphCounts[id].locked = !!account.locked;
  }
  function countLink(account, tab, n, label) {
    var href = tab === "friends" ? ("#/@" + encodeURIComponent(account.handle || "") + "?tab=friends") : ("#/@" + encodeURIComponent(account.handle || "") + "/" + tab);
    return '<a href="' + esc(href) + '"><b>' + esc(formatNum(n)) + "</b> <span>" + esc(label) + "</span></a>";
  }
  function accountCountsHtml(account) {
    return '<div class="counts">' + countLink(account, "following", accountStat(account, "following"), tr("Following count")) + countLink(account, "followers", accountStat(account, "followers"), tr("Followers")) + countLink(account, "friends", accountStat(account, "friends"), tr("Friends")) + "</div>";
  }
  function followersOf(id) {
    var known = graphCounts[id];
    return known && known.followers != null ? known.followers : 0;
  }
  function ensureCounts(id) {
    var session = readSession();
    if (!id || !session || !hasApi()) return;
    if (countLoads[id] || (graphCounts[id] && graphCounts[id].fresh)) return;
    var epoch = followEpoch;
    countLoads[id] = true;
    api("/v1/follows?id=" + encodeURIComponent(id), { token: session.token }).then(function (res) {
      countLoads[id] = false;
      if (!res || res.status !== 200 || epoch !== followEpoch) return;
      graphCounts[id] = graphCounts[id] || {};
      if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
      if (res.followingCount != null) graphCounts[id].following = res.followingCount;
      graphCounts[id].fresh = true;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { countLoads[id] = false; });
  }
  function listPack(id, tab) {
    return listCache[id + "|" + tab] || { loading: false, accounts: null, error: false, isPrivate: false, cursor: "", query: graphQuery[id + "|" + tab] || "" };
  }
  var graphQuery = {};
  var graphTimer = {};
  function ensureList(id, tab, more) {
    var session = readSession();
    var key = id + "|" + tab;
    if (!id || !session || !hasApi()) return;
    var pack = listCache[key];
    if (pack && pack.loading) return;
    if (pack && pack.accounts && !pack.dirty && !more) return;
    var epoch = followEpoch;
    var q = graphQuery[key] || "";
    var cursor = more && pack && pack.cursor ? pack.cursor : "";
    listCache[key] = { loading: true, accounts: pack && pack.accounts, error: false, dirty: false, cursor: pack && pack.cursor, query: q, isPrivate: pack && pack.isPrivate, locked: pack && pack.locked, blocked: pack && pack.blocked };
    var path = "/v1/follows?id=" + encodeURIComponent(id) + "&tab=" + encodeURIComponent(tab) + "&limit=20";
    if (q) path += "&q=" + encodeURIComponent(q);
    if (cursor) path += "&cursor=" + encodeURIComponent(cursor);
    api(path, { token: session.token }).then(function (res) {
      if (epoch !== followEpoch) {
        if (listCache[key]) {
          listCache[key].loading = false;
          listCache[key].dirty = true;
        }
        return;
      }
      if (!res || res.status !== 200) listCache[key] = { loading: false, accounts: [], error: true, isPrivate: false, cursor: "", query: q };
      else {
        var next = Array.isArray(res.accounts) ? res.accounts : [];
        var prev = more && pack && Array.isArray(pack.accounts) ? pack.accounts : [];
        listCache[key] = {
          loading: false,
          accounts: prev.concat(next),
          error: false,
          isPrivate: !!res.isPrivate,
          locked: !!res.locked,
          blocked: !!res.blocked,
          cursor: res.cursor || "",
          query: q
        };
        graphCounts[id] = graphCounts[id] || {};
        if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
        if (res.followingCount != null) graphCounts[id].following = res.followingCount;
        if (res.requestsCount != null) graphCounts[id].requests = res.requestsCount;
        graphCounts[id].fresh = true;
      }
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      listCache[key] = { loading: false, accounts: (pack && pack.accounts) || [], error: true, cursor: "", query: q };
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function setGraphQuery(id, tab, value) {
    var key = id + "|" + tab;
    graphQuery[key] = String(value || "");
    if (listCache[key]) listCache[key].dirty = true;
    clearTimeout(graphTimer[key]);
    graphTimer[key] = setTimeout(function () { ensureList(id, tab, false); }, 200);
  }
  function dirtyLists() {
    Object.keys(listCache).forEach(function (key) {
      if (listCache[key]) listCache[key].dirty = true;
    });
  }
  var followInflight = {};
  function pressFollow(id) {
    if (!id || followInflight[id]) return false;
    followInflight[id] = true;
    return true;
  }
  function releaseFollow(id) {
    if (id) followInflight[id] = false;
  }
  function previewFollow(id, follow) {
    if (!id) return;
    graphCounts[id] = graphCounts[id] || {};
    var me = myAccountId();
    if (graphCounts[id].followers != null) graphCounts[id].followers = Math.max(0, graphCounts[id].followers + (follow ? 1 : -1));
    if (me && graphCounts[me] && graphCounts[me].following != null) graphCounts[me].following = Math.max(0, graphCounts[me].following + (follow ? 1 : -1));
  }
  function followErrorText(res) {
    if (!res) return tr("Couldn’t update that follow. Try again.");
    if (res.status === 429 || res.error === "rate_limited") return tr("Too many follows. Wait a few minutes and try again.");
    if (res.status === 403 || res.error === "blocked") return tr("You can’t follow this account.");
    if (res.status === 404) return tr("That account isn’t here.");
    return tr("Couldn’t update that follow. Try again.");
  }
  function rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine) {
    if (hadTarget) graphCounts[id].followers = prevTarget;
    else if (graphCounts[id]) {
      delete graphCounts[id].followers;
      graphCounts[id].fresh = false;
    }
    if (hadMine && graphCounts[me]) graphCounts[me].following = prevMine;
  }
  function changeFollow(id, follow, profile, opts) {
    var session = readSession();
    opts = opts || {};
    var held = !!opts.held;
    if (!id) return Promise.resolve(false);
    if (!held && followInflight[id]) return Promise.resolve({ ok: true, ignored: true });
    if (!held) followInflight[id] = true;
    if (!session || !hasApi()) {
      releaseFollow(id);
      return Promise.resolve(true);
    }
    if (id === myAccountId()) {
      releaseFollow(id);
      return Promise.resolve(false);
    }
    followEpoch += 1;
    var epoch = followEpoch;
    var me = myAccountId();
    graphCounts[id] = graphCounts[id] || {};
    var wasPending = !!graphCounts[id].pending;
    var skipCounts = !!opts.replay || (follow && wasPending) || (!follow && wasPending);
    var hadTarget = !!(graphCounts[id] && graphCounts[id].followers != null);
    var prevTarget = hadTarget ? graphCounts[id].followers : 0;
    var hadMine = !!(me && graphCounts[me] && graphCounts[me].following != null);
    var prevMine = hadMine ? graphCounts[me].following : 0;
    if (!skipCounts) {
      graphCounts[id].followers = Math.max(0, prevTarget + (follow ? 1 : -1));
      if (hadMine) graphCounts[me].following = Math.max(0, prevMine + (follow ? 1 : -1));
    }
    if (follow) graphCounts[id].pending = false;
    dirtyLists();
    var body = { id: id };
    if (profile && typeof profile === "object") body.profile = profile;
    return api("/v1/follows", { method: follow ? "PUT" : "DELETE", token: session.token, body: body }).then(function (res) {
      releaseFollow(id);
      if (epoch !== followEpoch) return res && res.status === 200 ? true : false;
      if (!res || res.status !== 200) {
        if (!skipCounts) rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine);
        else if (opts.replay) previewFollow(id, !follow);
        if (window.ViktorychAccounts && window.ViktorychAccounts.toast) window.ViktorychAccounts.toast(followErrorText(res));
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return false;
      }
      graphCounts[id] = graphCounts[id] || {};
      if (res.pending) {
        if (!skipCounts) rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine);
        graphCounts[id].pending = true;
        graphCounts[id].fresh = true;
        if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
        if (me && res.followingCount != null) {
          graphCounts[me] = graphCounts[me] || {};
          graphCounts[me].following = res.followingCount;
        }
        dirtyLists();
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return { pending: true };
      }
      graphCounts[id].pending = false;
      if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
      graphCounts[id].fresh = true;
      if (me && res.followingCount != null) {
        graphCounts[me] = graphCounts[me] || {};
        graphCounts[me].following = res.followingCount;
        graphCounts[me].fresh = true;
      }
      dirtyLists();
      refreshProfileMedia();
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return true;
    }).catch(function () {
      releaseFollow(id);
      if (epoch !== followEpoch) return false;
      if (!skipCounts) rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine);
      else if (opts.replay) previewFollow(id, !follow);
      if (window.ViktorychAccounts && window.ViktorychAccounts.toast) window.ViktorychAccounts.toast(tr("Couldn’t update that follow. Try again."));
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return false;
    });
  }
  function followControlHtml(id, large) {
    var row = graphCounts[id] || {};
    var busy = !!followInflight[id];
    var size = large ? " lg" : "";
    var attr = ' type="button" data-act="follow" data-id="' + esc(id) + '" aria-busy="' + (busy ? "true" : "false") + '"';
    if (row.blockedBy) return "";
    if (row.viewerBlocks) {
      return '<button class="follow following' + size + '"' + attr.replace('data-act="follow"', 'data-act="graph-unblock"') + ' aria-pressed="false">' + esc(tr("Unblock")) + '</button>';
    }
    if (row.pending) {
      return '<button class="follow pending' + size + '"' + attr + ' aria-pressed="false" aria-label="' + esc(tr("Pending")) + '"><span class="f">' + esc(tr("Pending")) + '</span><span class="u">' + esc(tr("Cancel request")) + '</span></button>';
    }
    return "";
  }
  function syncFollows() {
    var session = readSession();
    if (!session || !hasApi() || !session.account) return Promise.resolve();
    if (syncingFollows) {
      syncAgain = true;
      return Promise.resolve();
    }
    syncingFollows = true;
    var epoch = followEpoch;
    var key = "follows-imported-v2-" + session.account.publicId;
    var imported = readStored(key) === "1";
    var local = localFeedFollows().concat(localAppFollows()).filter(function (id, index, all) {
      return id && all.indexOf(id) === index;
    });
    var start = imported || !local.length
      ? Promise.resolve({ status: 200 })
      : api("/v1/follows/import", { method: "POST", token: session.token, body: { ids: local.slice(0, 5000) } });
    return start.then(function (res) {
      if (!imported && local.length && res && res.status === 200) writeStored(key, "1");
      return api("/v1/follows", { token: session.token });
    }).then(function (res) {
      syncingFollows = false;
      if (epoch !== followEpoch) syncAgain = true;
      else if (res && res.status === 200) {
        var me = "app:" + session.account.publicId;
        graphCounts[me] = graphCounts[me] || {};
        if (res.followingCount != null) graphCounts[me].following = res.followingCount;
        if (res.followersCount != null) graphCounts[me].followers = res.followersCount;
        if (res.requestsCount != null) graphCounts[me].requests = res.requestsCount;
        graphCounts[me].fresh = true;
        var outgoing = Array.isArray(res.outgoingRequests) ? res.outgoingRequests : [];
        Object.keys(graphCounts).forEach(function (key) {
          if (graphCounts[key] && key !== me) graphCounts[key].pending = outgoing.indexOf(key) >= 0;
        });
        outgoing.forEach(function (oid) {
          graphCounts[oid] = graphCounts[oid] || {};
          graphCounts[oid].pending = true;
        });
        if (window.ViktorychAccounts.onServerFollows) window.ViktorychAccounts.onServerFollows(Array.isArray(res.ids) ? res.ids : []);
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
      if (syncAgain) {
        syncAgain = false;
        return syncFollows();
      }
    }).catch(function () {
      syncingFollows = false;
      if (syncAgain) {
        syncAgain = false;
        return syncFollows();
      }
    });
  }
  function viewerOwnsSubject(subjectId, handle) {
    var session = readSession();
    var me = session && session.account;
    if (!me) return false;
    var id = String(subjectId || "");
    var mine = String(me.publicId || "");
    if (mine && (id === mine || id === "app:" + mine)) return true;
    if (id.indexOf("app:") !== 0) return false;
    if (/^app:\d{12}$/.test(id)) return false;
    var fromId = id.slice(4).replace(/^@/, "");
    var candidate = fromId || String(handle || "");
    if (!candidate || !me.handle) return false;
    return skel(candidate) === skel(me.handle);
  }
  function subjectForHandle(handle, platform) {
    var key = skel(handle);
    var session = readSession();
    var me = session && session.account;
    var account = profiles[key];
    if (!account && me && skel(me.handle) === key) account = me;
    if (account && account.handle) {
      var publicId = /^\d{12}$/.test(String(account.publicId || "")) ? String(account.publicId) : "";
      if (!publicId && me && skel(me.handle) === skel(account.handle) && /^\d{12}$/.test(String(me.publicId || ""))) publicId = String(me.publicId);
      var id = publicId ? "app:" + publicId : "app:@" + account.handle;
      return { id: id, kind: "account", name: account.displayName || account.handle, handle: account.handle, platform: "x" };
    }
    if ((platform || "x") === "x" && readSession() && hasApi() && !profileMiss[key]) {
      loadProfile(handle);
      return { pending: true };
    }
    return null;
  }
  function friendWord(res) {
    var word = res && (res.friendStatus || res.bodyStatus);
    return word === "none" || word === "sent" || word === "received" || word === "friends" ? word : "";
  }
  function friendButtonHtml(account) {
    var session = readSession();
    var ref = accountRef(account);
    if (!session || !account || !ref || profileMine(account)) return "";
    if (!friendRequestsLoaded && Date.now() - friendReqTriedAt > 60000) { friendReqTriedAt = Date.now(); ensureFriendRequests(); }
    var status = (graphCounts[ref] && graphCounts[ref].friendStatus) || account.viewerFriendStatus || "none";
    var recent = graphCounts[ref] && graphCounts[ref].friendAt && Date.now() - graphCounts[ref].friendAt < 60000;
    if (status === "none" && !recent) status = pendingFriendStatus(account.handle) || "none";
    var pid = ref;
    var handle = account.handle || "";

    if (status === "friends") {
      return '<button class="friend-btn friend-mutual" type="button" data-friend-act="unfriend" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '" aria-label="' + esc(tr("Friends")) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span class="f">' + esc(tr("Friends")) + '</span><span class="u">' + esc(tr("Unfriend")) + '</span></button>';
    }
    if (status === "sent") {
      return '<button class="friend-btn friend-pending" type="button" data-friend-act="cancel" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '" aria-label="' + esc(tr("Request Sent")) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg><span class="f">' + esc(tr("Request Sent")) + '</span><span class="u">' + esc(tr("Cancel Request")) + '</span></button>';
    }
    if (status === "received") {
      return '<div class="friend-btn-group"><button class="friend-btn friend-accept" type="button" data-friend-act="accept" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '">' + esc(tr("Confirm")) + '</button><button class="friend-btn friend-decline" type="button" data-friend-act="decline" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '">' + esc(tr("Delete")) + '</button></div>';
    }
    return '<button class="friend-btn friend-add" type="button" data-friend-act="request" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg><span>' + esc(tr("Add Friend")) + '</span></button>';
  }

  function ensureFriends(targetId) {
    var session = readSession();
    var key = String(targetId || "");
    if (!key) return;
    if (key.indexOf("app:") !== 0 && key.indexOf("@") !== 0) key = "app:" + key;
    if (key.charAt(0) === "@") key = "app:" + key;
    if (!session || !hasApi()) return;
    if (friendsLoads[key] || friendsCache[key]) return;
    if (friendsFailedAt[key] && Date.now() - friendsFailedAt[key] < 30000) return;
    friendsLoads[key] = true;
    api("/v1/friends?id=" + encodeURIComponent(key) + "&tab=friends", { token: session.token }).then(function (res) {
      friendsLoads[key] = false;
      if (!res || res.status !== 200) { friendsFailedAt[key] = Date.now(); return; }
      friendsCache[key] = Array.isArray(res.friends) ? res.friends : [];
      var id = key;
      graphCounts[id] = graphCounts[id] || {};
      if (res.friendsCount != null) graphCounts[id].friends = res.friendsCount;
      if (friendWord(res)) graphCounts[id].friendStatus = friendWord(res);
      if (res.mutualCount != null) graphCounts[id].mutualFriendsCount = res.mutualCount;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { friendsLoads[key] = false; friendsFailedAt[key] = Date.now(); });
  }

  function ensureFriendRequests(force) {
    var session = readSession();
    if (!session || !hasApi() || friendRequestsLoading) return;
    // Renders call this; a fresh copy (or a recent failure) is reused so a
    // render after the answer does not start the next request.
    if (!force && Date.now() - friendReqFetchedAt < (friendRequestsLoaded ? 60000 : 30000)) return;
    friendRequestsLoading = true;
    friendReqFetchedAt = Date.now();
    api("/v1/friends?tab=requests", { token: session.token }).then(function (res) {
      friendRequestsLoading = false;
      if (!res || res.status !== 200) return;
      friendRequestsCache = {
        incoming: Array.isArray(res.incoming) ? res.incoming : [],
        outgoing: Array.isArray(res.outgoing) ? res.outgoing : []
      };
      friendRequestsLoaded = true;
      saveFriendReqs();
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { friendRequestsLoading = false; });
  }

  /* After any friend change, here or on the other side (the server sends a
     "friends" signal on the notifications channel), reload the requests,
     the cached friends lists and the presence list. */
  function refreshFriends() {
    friendRequestsLoading = false;
    friendsCache = {};
    friendsLoads = {};
    friendsFailedAt = {};
    ensureFriendRequests(true);
    var session = readSession();
    if (session && session.account) ensureFriends(accountRef(session.account));
    if (window.ViktorychPresence && window.ViktorychPresence.reloadFriends) window.ViktorychPresence.reloadFriends();
  }

  function syncFriends() {
    var session = readSession();
    if (!session || !hasApi()) return Promise.resolve();
    ensureFriendRequests();
    if (session.account) ensureFriends(accountRef(session.account));
    return Promise.resolve();
  }

  function doFriendAction(action, targetId, handle) {
    var session = readSession();
    if (!session || !hasApi() || !targetId) return;
    var me = session.account && session.account.publicId;
    var rawTarget = String(targetId || "");
    var tId = rawTarget.indexOf("app:") === 0 ? rawTarget : ("app:" + rawTarget.replace(/^@/, "@"));
    var idKey = tId;
    var meKey = me ? "app:" + me : "";

    graphCounts[idKey] = graphCounts[idKey] || {};
    var prevStatus = graphCounts[idKey].friendStatus || "none";
    var prevCount = graphCounts[idKey].friends || 0;
    var prevMyCount = (graphCounts[meKey] && graphCounts[meKey].friends) || 0;

    graphCounts[idKey].friendAt = Date.now();
    var reqHandle = String(handle || "").replace(/^@/, "");
    if (action === "request") {
      graphCounts[idKey].friendStatus = "sent";
      if (reqHandle && !friendRequestsCache.outgoing.some(function (r) { return String(r.handle || "").toLowerCase() === reqHandle.toLowerCase(); })) friendRequestsCache.outgoing.unshift({ handle: reqHandle, id: "app:@" + reqHandle, friendStatus: "sent" });
    } else if (action === "accept") {
      graphCounts[idKey].friendStatus = "friends";
      graphCounts[idKey].friends = prevCount + 1;
      graphCounts[meKey] = graphCounts[meKey] || {};
      graphCounts[meKey].friends = prevMyCount + 1;
      friendRequestsCache.incoming = friendRequestsCache.incoming.filter(function (r) {
        return r.id !== tId && r.publicId !== tId && !(reqHandle && String(r.handle || "").toLowerCase() === reqHandle.toLowerCase());
      });
      friendsCache = {};
    } else if (action === "decline") {
      graphCounts[idKey].friendStatus = "none";
      friendRequestsCache.incoming = friendRequestsCache.incoming.filter(function (r) {
        return r.id !== tId && r.publicId !== tId && !(reqHandle && String(r.handle || "").toLowerCase() === reqHandle.toLowerCase());
      });
    } else if (action === "cancel") {
      graphCounts[idKey].friendStatus = "none";
      friendRequestsCache.outgoing = friendRequestsCache.outgoing.filter(function (r) {
        return r.id !== tId && r.publicId !== tId && !(reqHandle && String(r.handle || "").toLowerCase() === reqHandle.toLowerCase());
      });
    } else if (action === "remove") {
      graphCounts[idKey].friendStatus = "none";
      graphCounts[idKey].friends = Math.max(0, prevCount - 1);
      graphCounts[meKey] = graphCounts[meKey] || {};
      graphCounts[meKey].friends = Math.max(0, prevMyCount - 1);
      friendsCache = {};
    }

    saveFriendReqs();
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();

    var ep = "/v1/friends/" + action;
    api(ep, { method: "POST", token: session.token, body: { targetId: tId } }).then(function (res) {
      if (!res || res.status !== 200) {
        graphCounts[idKey].friendStatus = prevStatus;
        graphCounts[idKey].friendAt = 0;
        friendRequestsLoading = false;
        ensureFriendRequests(true);
        graphCounts[idKey].friends = prevCount;
        if (graphCounts[meKey]) graphCounts[meKey].friends = prevMyCount;
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return;
      }
      if (friendWord(res)) graphCounts[idKey].friendStatus = friendWord(res);
      if (res.friendsCount != null && graphCounts[meKey]) graphCounts[meKey].friends = res.friendsCount;
      refreshFriends();
      refreshProfileMedia();
      if (window.ViktorychAccounts && window.ViktorychAccounts.toast) {
        if (action === "request") window.ViktorychAccounts.toast(tr("Friend request sent"));
        else if (action === "accept") window.ViktorychAccounts.toast(tr("Friend request accepted"));
        else if (action === "decline") window.ViktorychAccounts.toast(tr("Friend request declined"));
        else if (action === "cancel") window.ViktorychAccounts.toast(tr("Friend request cancelled"));
        else if (action === "remove") window.ViktorychAccounts.toast(tr("Friend removed"));
      }
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      graphCounts[idKey].friendStatus = prevStatus;
      graphCounts[idKey].friendAt = 0;
      friendRequestsLoading = false;
      ensureFriendRequests(true);
      graphCounts[idKey].friends = prevCount;
      if (graphCounts[meKey]) graphCounts[meKey].friends = prevMyCount;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }

  function friendsSectionHtml(account) {
    var session = readSession();
    var mine = profileMine(account);
    if (!session) {
      return '<div class="empty"><h2>' + esc(tr("Friends")) + '</h2><p>' + esc(tr("Sign in to see this list.")) + '</p></div>';
    }

    var pid = accountRef(account);
    ensureFriends(pid);
    if (mine) ensureFriendRequests();

    if (friendsLoads[pid] && !friendsCache[pid]) {
      return '<div class="reply-empty">' + esc(tr("Loading…")) + '</div>';
    }

    var friendsList = friendsCache[pid] || [];
    var incoming = (mine && friendRequestsCache.incoming) || [];
    var requestsCount = incoming.length;

    var headerRight = '<div class="friends-search-box">' +
      '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.25 3.75a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm-8.5 6.5a8.5 8.5 0 1114.86 5.66l4.47 4.46-1.42 1.42-4.46-4.47A8.5 8.5 0 011.75 10.25z"/></svg>' +
      '<input type="text" class="friends-search-input" placeholder="' + esc(tr("Search Friends")) + '" value="' + esc(friendsSearchQuery) + '" data-friends-search="1">' +
    '</div>';

    var pills = "";
    if (mine) {
      pills = '<div class="friends-pills">' +
        '<button class="friends-pill' + (friendsSubTab === "all" ? " active" : "") + '" type="button" data-friend-sub="all">' + esc(tr("All Friends")) + ' <span class="pill-count">(' + friendsList.length + ')</span></button>' +
        '<a class="friends-pill" href="#/online">' + esc(tr("Online")) + '</a>' +
        '<button class="friends-pill' + (friendsSubTab === "requests" ? " active" : "") + '" type="button" data-friend-sub="requests">' + esc(tr("Friend Requests")) + (requestsCount > 0 ? ' <span class="pill-badge">' + requestsCount + '</span>' : '') + '</button>' +
      '</div>';
    }

    var cardsHtml = "";
    if (mine && friendsSubTab === "requests") {
      if (!incoming.length) {
        cardsHtml = '<div class="empty"><h2>' + esc(tr("No friend requests")) + '</h2><p>' + esc(tr("You don’t have any pending friend requests.")) + '</p></div>';
      } else {
        cardsHtml = '<div class="friends-grid">' + incoming.map(function (req) {
          var rpid = req.id ? req.id.replace(/^app:/, "") : "";
          var photo = presenceWrap(rpid, publicAvatar(req.avatar, req.avatarFace, "friend-avatar"), false);
          var mutual = req.mutualFriendsCount ? '<div class="friend-card-mutual">' + esc(tr("{count} mutual friends", { count: req.mutualFriendsCount })) + '</div>' : '';
          return '<div class="friend-card" data-friend-card="app:' + esc(rpid) + '">' +
            '<a class="friend-card-media" href="#/@' + encodeURIComponent(req.handle) + '">' + photo + '</a>' +
            '<div class="friend-card-info">' +
              '<a class="friend-card-name" href="#/@' + encodeURIComponent(req.handle) + '">' + esc(req.name || req.handle) + (req.owner ? badge() : "") + '</a>' +
              '<div class="friend-card-handle">@' + esc(req.handle) + '</div>' +
              mutual +
            '</div>' +
            '<div class="friend-card-actions">' +
              '<button class="friend-btn friend-accept" type="button" data-friend-act="accept" data-friend-id="' + esc(rpid) + '" data-handle="' + esc(req.handle) + '">' + esc(tr("Confirm")) + '</button>' +
              '<button class="friend-btn friend-decline" type="button" data-friend-act="decline" data-friend-id="' + esc(rpid) + '" data-handle="' + esc(req.handle) + '">' + esc(tr("Delete")) + '</button>' +
            '</div>' +
          '</div>';
        }).join("") + '</div>';
      }
    } else {
      var query = friendsSearchQuery.trim().toLowerCase();
      var filtered = friendsList;
      if (query) {
        filtered = friendsList.filter(function (f) {
          var name = String(f.name || f.displayName || "").toLowerCase();
          var handle = String(f.handle || "").toLowerCase();
          return name.indexOf(query) >= 0 || handle.indexOf(query) >= 0;
        });
      }

      if (!friendsList.length) {
        cardsHtml = '<div class="empty"><h2>' + esc(tr("No friends yet")) + '</h2><p>' + esc(tr("When you become friends with people, they’ll show up here.")) + '</p></div>';
      } else if (!filtered.length) {
        cardsHtml = '<div class="empty"><h2>' + esc(tr("No friends found")) + '</h2><p>' + esc(tr("Couldn’t find any friends matching your search.")) + '</p></div>';
      } else {
        cardsHtml = '<div class="friends-grid">' + filtered.map(function (fr) {
          var fpid = fr.id ? fr.id.replace(/^app:/, "") : fr.publicId;
          var photo = presenceWrap(fpid, publicAvatar(fr.avatar, fr.avatarFace, "friend-avatar"), false);
          var mutual = fr.mutualFriendsCount ? '<div class="friend-card-mutual">' + esc(tr("{count} mutual friends", { count: fr.mutualFriendsCount })) + '</div>' : '';
          var btn = "";
          if (mine) {
            btn = '<button class="friend-btn friend-mutual" type="button" data-friend-act="unfriend" data-friend-id="' + esc(fpid) + '" data-handle="' + esc(fr.handle) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span class="f">' + esc(tr("Friends")) + '</span><span class="u">' + esc(tr("Unfriend")) + '</span></button>';
          } else {
            btn = friendButtonHtml({ publicId: fpid, handle: fr.handle, viewerFriendStatus: fr.friendStatus });
          }
          return '<div class="friend-card" data-friend-card="app:' + esc(fpid) + '">' +
            '<a class="friend-card-media" href="#/@' + encodeURIComponent(fr.handle) + '">' + photo + '</a>' +
            '<div class="friend-card-info">' +
              '<a class="friend-card-name" href="#/@' + encodeURIComponent(fr.handle) + '">' + esc(fr.name || fr.displayName || fr.handle) + (fr.owner ? badge() : "") + '</a>' +
              '<div class="friend-card-handle">@' + esc(fr.handle) + '</div>' +
              mutual +
            '</div>' +
            '<div class="friend-card-actions">' + btn + '</div>' +
          '</div>';
        }).join("") + '</div>';
      }
    }

    var totalFriends = friendsList.length;
    var headingHtml = '<div class="friends-header">' +
      '<div class="friends-header-left">' +
        '<h2 class="friends-heading">' + esc(tr("Friends")) + '</h2>' +
        '<span class="friends-sub">' + esc(tr("{count} friends", { count: totalFriends })) + '</span>' +
      '</div>' +
      '<div class="friends-header-right">' + headerRight + '</div>' +
    '</div>';

    return '<div class="friends-section">' + headingHtml + pills + cardsHtml + '</div>';
  }

    var linkIdentityForm = {
    platform: "x",
    handle: "",
    proofUrl: "",
    step: 0,
    challenge: null,
    loading: false
  };
  var copiedIdentityCode = false;

  function platformIcon(platform) {
    var p = String(platform || "x").toLowerCase();
    if (p === "x") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
    }
    if (p === "telegram") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>';
    }
    if (p === "youtube") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M21.58 7.19a2.76 2.76 0 0 0-1.94-1.95C17.92 4.7 12 4.7 12 4.7s-5.92 0-7.64.54A2.76 2.76 0 0 0 2.42 7.19 28.9 28.9 0 0 0 1.88 12a28.9 28.9 0 0 0 .54 4.81 2.76 2.76 0 0 0 1.94 1.95c1.72.54 7.64.54 7.64.54s5.92 0 7.64-.54a2.76 2.76 0 0 0 1.94-1.95 28.9 28.9 0 0 0 .54-4.81 28.9 28.9 0 0 0-.54-4.81zM10 15V9l5.2 3L10 15z"/></svg>';
    }
    if (p === "instagram") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>';
  }

  function verifiedSvg() {
    return '<svg class="ident-verified" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.8 14.5l-4.2-4.2 1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2z"/></svg>';
  }

  function linkedIdentitiesHtml(account) {
    var list = (account && account.identities) || [];
    var session = readSession();
    var mine = !!(session && session.account && (session.account.publicId === account.publicId || skel(session.account.handle) === skel(account.handle)));
    if (!list.length && !mine) return "";
    var addBtn = mine ? '<button class="acct-ident-chip acct-ident-add" type="button" data-acct="open-link-identity"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> <span>' + esc(tr("Link social profile")) + '</span></button>' : '';
    var chips = list.map(function (item) {
      var platform = item.platform || "x";
      var handle = item.handle || "";
      var href = "#/u/" + encodeURIComponent(platform) + "/" + encodeURIComponent(handle);
      var iconHtml = platformIcon(platform);
      return '<a class="acct-ident-chip' + (item.hidden ? " is-hidden" : "") + '" href="' + esc(href) + '" title="' + esc(tr("Verified Identity")) + '">' +
        iconHtml +
        '<span class="acct-ident-handle">@' + esc(handle) + '</span>' +
        verifiedSvg() +
      '</a>';
    }).join("") + addBtn;
    return '<div class="acct-ident-row"><span class="acct-ident-label">' + esc(tr("Linked profiles")) + ':</span><div class="acct-ident-chips">' + chips + '</div></div>';
  }

  function identitiesSettingsHtml(account) {
    var session = readSession();
    var list = (session && session.account && session.account.identities) || (account && account.identities) || [];
    var itemsHtml = "";
    if (!list.length) {
      itemsHtml = '<p class="set-sub" style="margin-bottom:12px;">' + esc(tr("No linked accounts yet.")) + '</p>';
    } else {
      itemsHtml = '<div class="acct-ident-settings-list">' + list.map(function (item) {
        var plat = (item.platform || "x").toUpperCase();
        var audience = item.audience || "public";
        var options = [
          ["public", tr("Everyone")],
          ["followers", tr("Followers")],
          ["friends", tr("Mutuals")],
          ["only", tr("Only me")],
          ["list", tr("Custom list")]
        ];
        var choices = options.map(function (pair) {
          return '<option value="' + esc(pair[0]) + '"' + (audience === pair[0] ? " selected" : "") + ">" + esc(pair[1]) + "</option>";
        }).join("");
        var checks = audience === "list" && window.AudienceLists && window.AudienceLists.checksHtml ? window.AudienceLists.checksHtml(item.listIds || []) : "";
        var shown = item.hidden !== true;
        return '<div class="acct-ident-item" data-ident-id="' + esc(String(item.id || "")) + '">' +
          '<div class="acct-ident-item-left">' +
            platformIcon(item.platform) +
            '<span class="acct-ident-item-name"><b>' + esc(plat) + '</b> @' + esc(item.handle) + '</span>' +
            verifiedSvg() +
          '</div>' +
          '<label class="acct-ident-aud"><span>' + esc(tr("Who can see this")) + '</span><select data-acct="identity-audience" data-id="' + esc(String(item.id || "")) + '" aria-label="' + esc(tr("Who can see this")) + '">' + choices + "</select></label>" +
          checks +
          '<button class="tab-switch' + (shown ? " on" : "") + '" type="button" role="switch" aria-checked="' + (shown ? "true" : "false") + '" data-acct="identity-show" data-id="' + esc(String(item.id || "")) + '"><span>' + esc(tr("Show on profile")) + "</span><i></i></button>" +
          '<button class="outline acct-ident-unlink" type="button" data-acct="unlink-identity" data-platform="' + esc(item.platform) + '" data-handle="' + esc(item.handle) + '" data-id="' + esc(String(item.id || "")) + '">' + esc(tr("Unlink")) + '</button>' +
        '</div>';
      }).join("") + '</div>';
    }
    return itemsHtml + '<button class="outline" type="button" data-acct="open-link-identity" style="margin-bottom:20px;">' + esc(tr("Link social account")) + '</button>';
  }

  function linkIdentityBody() {
    if (linkIdentityForm.step === 1 && linkIdentityForm.challenge) {
      var platName = (linkIdentityForm.platform || "x").toUpperCase();
      var code = linkIdentityForm.challenge.code || "";
      return '<p class="acct-sub">' + esc(tr("Add this code to your bio or description on {platform}, or publish a public post containing this code.", { platform: platName })) + '</p>' +
        '<div class="acct-code-box"><code>' + esc(code) + '</code><button class="outline" type="button" data-acct="copy-code">' + esc(copiedIdentityCode ? tr("Copied") : tr("Copy code")) + '</button></div>' +
        '<div class="acct-field"><label>' + esc(tr("Post URL (optional)")) + '</label><input name="identityProofUrl" type="text" placeholder="https://..." value="' + esc(linkIdentityForm.proofUrl || "") + '"></div>' +
        '<p class="acct-error">' + esc(errorText) + '</p>' +
        '<button class="acct-next" type="button" data-acct="verify-identity">' + esc(linkIdentityForm.loading ? tr("Loading…") : tr("Confirm Identity")) + '</button>' +
        '<button class="acct-line" type="button" data-acct="back-identity" style="width:100%;margin-top:12px">' + esc(tr("Back")) + '</button>';
    }
    if (linkIdentityForm.step === 2) {
      return '<div class="acct-success"><p style="font-size:16px;font-weight:600;color:var(--accent,#1d9bf0);text-align:center;margin:24px 0;">' + esc(tr("Identity confirmed and linked!")) + '</p></div>' +
        '<button class="acct-next" type="button" data-acct="close">' + esc(tr("Close")) + '</button>';
    }
    var selectHtml = '<div class="acct-field"><label>' + esc(tr("Platform")) + '</label>' +
      '<select class="acct-select" name="identityPlatform">' +
        '<option value="x"' + (linkIdentityForm.platform === "x" ? " selected" : "") + '>X</option>' +
        '<option value="telegram"' + (linkIdentityForm.platform === "telegram" ? " selected" : "") + '>Telegram</option>' +
        '<option value="instagram"' + (linkIdentityForm.platform === "instagram" ? " selected" : "") + '>Instagram</option>' +
        '<option value="youtube"' + (linkIdentityForm.platform === "youtube" ? " selected" : "") + '>YouTube</option>' +
        '<option value="threads"' + (linkIdentityForm.platform === "threads" ? " selected" : "") + '>Threads</option>' +
        '<option value="vk"' + (linkIdentityForm.platform === "vk" ? " selected" : "") + '>VK</option>' +
      '</select></div>';
    var handleHtml = '<div class="acct-field"><label>' + esc(tr("Username or channel")) + '</label><input name="identityHandle" type="text" placeholder="@handle" value="' + esc(linkIdentityForm.handle || "") + '"></div>';
    return selectHtml + handleHtml + '<p class="acct-error">' + esc(errorText) + '</p>' +
      '<button class="acct-next" type="button" data-acct="gen-challenge">' + esc(linkIdentityForm.loading ? tr("Loading…") : tr("Generate verification code")) + '</button>';
  }

  function followLookup(id) {
    var api = window.ViktorychFollows;
    if (!api || typeof api.lookup !== "function" || !id) return null;
    try { return api.lookup(id) || null; } catch (err) { return null; }
  }
  function handleFromFollowId(id) {
    var text = String(id || "");
    if (text.indexOf("app:@") === 0) return text.slice(5);
    var cut = text.indexOf(":");
    if (cut <= 0) return "";
    var rest = text.slice(cut + 1).replace(/^@/, "");
    if (!rest || rest.length > 40 || /[\s<>]/.test(rest) || /^\d{8,}$/.test(rest)) return "";
    return rest;
  }
  function graphPerson(item) {
    var row = item || {};
    var known = followLookup(row.id);
    var handle = row.handle || (known && known.handle) || handleFromFollowId(row.id) || "";
    var avatar = row.avatar || (known && known.avatar) || "";
    var face = row.avatarFace || (known && known.avatarFace) || "";
    if (!face) face = avatar ? "photo" : "default";
    var name = row.name || row.displayName || (known && (known.name || known.displayName)) || handle || "";
    return { id: row.id || "", name: name, handle: handle, avatar: avatar, avatarFace: face };
  }
  function requestHashKind() {
    var hash = (typeof location !== "undefined" && location.hash) || "";
    var cut = hash.indexOf("?");
    if (cut < 0) return { kind: "follow", box: "in" };
    var kind = "follow";
    var box = "in";
    hash.slice(cut + 1).split("&").forEach(function (part) {
      var bits = part.split("=");
      var key = bits[0];
      var value = "";
      try { value = decodeURIComponent(bits.slice(1).join("=") || ""); } catch (err) { value = bits.slice(1).join("=") || ""; }
      if (key === "kind" && value === "friends") kind = "friends";
      if (key === "box" && value === "out") box = "out";
    });
    return { kind: kind, box: box };
  }

  function requestPill(attrs, label, count, on) {
    var badge = count > 0 ? '<span class="pill-badge">' + count + "</span>" : "";
    var text = esc(label);
    return '<button type="button" class="req-pill' + (on ? " on" : "") + '" ' + attrs + ' aria-pressed="' + (on ? "true" : "false") + '"><span class="req-pill-clip"><span class="req-pill-track"><span class="req-pill-text">' + text + '</span><span class="req-pill-text" aria-hidden="true">' + text + "</span></span></span>" + badge + "</button>";
  }

  function requestPersonRow(person, actions) {
    var href = person.handle ? "#/@" + encodeURIComponent(person.handle) : "#/";
    var letter = String(person.name || person.handle || "?").trim().charAt(0).toUpperCase() || "?";
    var face = publicAvatar(person.avatar, person.avatarFace, "", letter);
    return '<div class="connect-row"><a class="who-main" href="' + esc(href) + '">' + face + '<span class="who-copy"><span class="name">' + esc(person.name || person.handle || "") + '</span><span class="handle">' + (person.handle ? "@" + esc(person.handle) : "") + '</span></span></a><span class="row-actions">' + actions + "</span></div>";
  }

  function requestsHubHtml(subjectId) {
    ensureList(subjectId, "requests", false);
    ensureFriendRequests();
    var view = requestHashKind();
    var pack = listPack(subjectId, "requests");
    var follows = pack.accounts || [];
    var incoming = friendRequestsCache.incoming || [];
    var outgoing = friendRequestsCache.outgoing || [];
    var followN = follows.length;
    var friendN = incoming.length;
    var pills = '<div class="req-pills" role="tablist">' +
      requestPill('data-req-kind="follow"', tr("Follow requests"), followN, view.kind !== "friends") +
      requestPill('data-req-kind="friends"', tr("Friend Requests"), friendN + outgoing.length, view.kind === "friends") +
      "</div>";
    if (view.kind === "friends" && incoming.length && outgoing.length) {
      pills += '<div class="req-pills req-pills-sub" role="tablist">' +
        requestPill('data-req-box="in"', tr("Received"), incoming.length, view.box !== "out") +
        requestPill('data-req-box="out"', tr("Sent"), outgoing.length, view.box === "out") +
        "</div>";
    }
    var body = "";
    if (view.kind !== "friends") {
      if (pack.loading && !pack.accounts) body = '<div class="reply-empty">' + esc(tr("Loading…")) + "</div>";
      else if (!follows.length) body = '<div class="empty"><h2>' + esc(tr("No follow requests")) + "</h2><p>" + esc(tr("When someone asks to follow you, they’ll show up here.")) + "</p></div>";
      else body = follows.map(function (item) {
        var person = graphPerson(item);
        var actions = '<button class="friend-btn friend-accept" type="button" data-act="accept-follow" data-id="' + esc(person.id) + '">' + esc(tr("Accept")) + '</button><button class="friend-btn friend-decline" type="button" data-act="decline-follow" data-id="' + esc(person.id) + '">' + esc(tr("Decline")) + "</button>";
        return requestPersonRow(person, actions);
      }).join("");
    } else {
      var showOut = outgoing.length && (view.box === "out" || !incoming.length);
      if (!incoming.length && !outgoing.length) {
        body = '<div class="empty"><h2>' + esc(tr("No friend requests")) + "</h2><p>" + esc(tr("You don’t have any pending friend requests.")) + "</p></div>";
      } else if (showOut) {
        body = outgoing.map(function (req) {
          var person = graphPerson(req);
          var pid = String(req.id || "").replace(/^app:/, "");
          var actions = '<button class="friend-btn friend-decline" type="button" data-friend-act="cancel" data-friend-id="' + esc(pid) + '" data-handle="' + esc(person.handle) + '">' + esc(tr("Cancel Request")) + "</button>";
          return requestPersonRow(person, actions);
        }).join("");
      } else {
        body = incoming.map(function (req) {
          var person = graphPerson(req);
          var pid = String(req.id || "").replace(/^app:/, "");
          var actions = '<button class="friend-btn friend-accept" type="button" data-friend-act="accept" data-friend-id="' + esc(pid) + '" data-handle="' + esc(person.handle) + '">' + esc(tr("Accept")) + '</button><button class="friend-btn friend-decline" type="button" data-friend-act="decline" data-friend-id="' + esc(pid) + '" data-handle="' + esc(person.handle) + '">' + esc(tr("Decline")) + "</button>";
          return requestPersonRow(person, actions);
        }).join("");
      }
    }
    return '<div class="requests-hub">' + pills + body + "</div>";
  }

  function fitRequestPills() {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll(".req-pill-clip").forEach(function (clip) {
      var text = clip.querySelector(".req-pill-text");
      if (!text) return;
      var over = !reduced && text.scrollWidth > clip.clientWidth + 1;
      clip.classList.toggle("is-over", !!over);
    });
  }

  function pendingFriendRequests() {
    return (friendRequestsCache.incoming || []).length;
  }

  function graphListHtml(subjectId, tab, handle) {
    if (tab === "requests" && viewerOwnsSubject(subjectId, handle)) return requestsHubHtml(subjectId);
    ensureList(subjectId, tab, false);
    var pack = listPack(subjectId, tab);
    var q = graphQuery[subjectId + "|" + tab] || "";
    var searchLabel = tab === "followers" ? tr("Search followers") : tab === "following" ? tr("Search following") : tab === "mutuals" ? tr("Search mutuals") : tr("Search followers");
    var search = '<div class="friends-search-box"><input type="search" class="friends-search-input" data-graph-search="1" data-graph-id="' + esc(subjectId) + '" data-graph-tab="' + esc(tab) + '" placeholder="' + esc(searchLabel) + '" aria-label="' + esc(searchLabel) + '" value="' + esc(q) + '"></div>';
    if (pack.loading && !pack.accounts) return search + '<div class="reply-empty">' + esc(tr("Loading…")) + '</div>';
    if (pack.error) return search + '<div class="empty"><h2>' + esc(tr("Followers")) + '</h2><p>' + esc(tr("Couldn’t load this list.")) + '</p></div>';
    if (pack.blocked) return '<div class="empty"><h2>' + esc(tr("You're blocked")) + '</h2><p>' + esc(tr("This account has blocked you. You can’t see their posts or profile.")) + '</p></div>';
    if (pack.locked) return '<div class="empty"><h2>' + esc(tr("These posts are protected")) + '</h2><p>' + esc(tr("Follow this account and wait for approval to see their posts.")) + '</p></div>';
    if (pack.isPrivate && !viewerOwnsSubject(subjectId, handle)) return '<div class="empty"><h2>' + esc(tr("These lists are private")) + '</h2><p>' + esc(tr("Only @{handle} can see who they follow and who follows them.", { handle: handle || "" })) + '</p></div>';
    var rows = pack.accounts || [];
    if (!rows.length) {
      var title = tab === "followers" ? tr("No followers yet") : tab === "mutuals" ? tr("No mutuals yet") : tab === "requests" ? tr("No follow requests") : tr("Not following anyone yet");
      var copy = tab === "requests" ? tr("When someone asks to follow you, they’ll show up here.") : tab === "mutuals" ? tr("People you follow who follow you back show up here.") : tab === "followers" ? tr("When someone follows this account, they’ll show up here.") : tr("When this account follows someone, they’ll show up here.");
      return search + '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(copy) + '</p></div>';
    }
    var mine = viewerOwnsSubject(subjectId, handle);
    var html = rows.map(function (item) {
      var person = graphPerson(item);
      var button = window.ViktorychAccounts.followButton ? (window.ViktorychAccounts.followButton(person.id, false) || "") : "";
      var badge = item.followsYou ? '<span class="pill-badge">' + esc(tr("Follows you")) + '</span>' : "";
      var remove = mine && tab === "followers" && item.removable ? '<button class="outline" type="button" data-act="remove-follower" data-id="' + esc(person.id) + '">' + esc(tr("Remove follower")) + '</button>' : "";
      var accept = mine && tab === "requests" ? '<button class="friend-btn friend-accept" type="button" data-act="accept-follow" data-id="' + esc(person.id) + '">' + esc(tr("Accept")) + '</button><button class="friend-btn friend-decline" type="button" data-act="decline-follow" data-id="' + esc(person.id) + '">' + esc(tr("Decline")) + '</button>' : "";
      var href = person.handle ? "#/@" + encodeURIComponent(person.handle) : (person.id ? "#/p/" + encodeURIComponent(String(person.id).replace(/^app:/, "")) : "#/");
      var letter = String(person.name || person.handle || "?").trim().charAt(0).toUpperCase() || "?";
      var face = publicAvatar(person.avatar, person.avatarFace, "", letter);
      return '<div class="connect-row"><a class="who-main" href="' + esc(href) + '">' + face + '<span class="who-copy"><span class="name">' + esc(person.name) + badge + '</span><span class="handle">' + (person.handle ? "@" + esc(person.handle) : "") + '</span></span></a><span class="row-actions">' + accept + remove + button + '</span></div>';
    }).join("");
    var more = pack.cursor ? '<button class="outline" type="button" data-act="graph-more" data-id="' + esc(subjectId) + '" data-tab="' + esc(tab) + '">' + esc(tr("Load more")) + '</button>' : "";
    return search + html + more;
  }
  function galleryList(account, kind) {
    var list = kind === "banner" ? ((account && account.banners) || []) : ((account && account.photos) || []);
    var items = list.filter(function (item) { return item && item.url; });
    if (!items.length) {
      var url = kind === "banner" ? (account && account.banner) : (account && account.avatar);
      if (url) items = [{ url: url, main: true }];
    }
    return items;
  }
  function galleryHtml(account) {
    if (!gallery.open || !account) return "";
    var items = galleryList(account, gallery.kind);
    if (!items.length) return "";
    if (gallery.index < 0) gallery.index = items.length - 1;
    if (gallery.index >= items.length) gallery.index = 0;
    var item = items[gallery.index];
    return '<div class="photo-gallery" data-acct="gallery-root">' +
      '<button class="photo-gallery-x" type="button" data-acct="gallery-close" aria-label="' + esc(tr("Close")) + '">×</button>' +
      (items.length > 1 ? '<button class="photo-gallery-nav prev" type="button" data-acct="gallery-prev" aria-label="' + esc(tr("Back")) + '">‹</button>' : "") +
      photoHtml(item.url, "photo-gallery-img") +
      (items.length > 1 ? '<button class="photo-gallery-nav next" type="button" data-acct="gallery-next" aria-label="' + esc(tr("Next")) + '">›</button>' : "") +
      "</div>";
  }
  var PROFILE_TAB_IDS = ["posts", "replies", "media", "highlights", "friends", "about", "gifts"];
  function profileTabLabel(id) {
    if (id === "posts") return tr("Posts");
    if (id === "replies") return tr("Replies");
    if (id === "media") return tr("Media");
    if (id === "highlights") return tr("Highlights");
    if (id === "friends") return tr("Friends");
    if (id === "about") return tr("About");
    if (id === "gifts") return tr("Gifts");
    return id;
  }
  function cleanProfileTabs(raw) {
    var order = [];
    var seen = {};
    var src = raw && Array.isArray(raw.order) ? raw.order : PROFILE_TAB_IDS;
    src.forEach(function (id) {
      if (PROFILE_TAB_IDS.indexOf(id) < 0 || seen[id]) return;
      seen[id] = true;
      order.push(id);
    });
    PROFILE_TAB_IDS.forEach(function (id) { if (!seen[id]) order.push(id); });
    var hidden = [];
    (raw && Array.isArray(raw.hidden) ? raw.hidden : []).forEach(function (id) {
      if (PROFILE_TAB_IDS.indexOf(id) < 0 || id === "posts" || hidden.indexOf(id) >= 0) return;
      hidden.push(id);
    });
    return { order: order, hidden: hidden, share: !!(raw && raw.share), at: Number(raw && raw.at) || 0 };
  }
  function readProfileTabs() {
    var settings = {};
    try { settings = JSON.parse(readStored("settings-v1") || "{}"); } catch (err) { settings = {}; }
    return cleanProfileTabs(settings.profileTabs);
  }
  function publishProfileTabs(cleaned) {
    var session = readSession();
    if (!session || !session.token || !hasApi()) return;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { profileTabs: cleaned } }).catch(function () {});
  }
  function saveProfileTabs(next) {
    var cleaned = cleanProfileTabs(next);
    cleaned.at = Date.now();
    var settings = {};
    try { settings = JSON.parse(readStored("settings-v1") || "{}"); } catch (err) { settings = {}; }
    settings.profileTabs = cleaned;
    writeStored("settings-v1", JSON.stringify(settings));
    onLocalChange();
    publishProfileTabs(cleaned);
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function profileTabPlan(account, mine) {
    var local = readProfileTabs();
    var remote = account && account.profileTabs ? cleanProfileTabs(account.profileTabs) : null;
    var layout = local;
    if (mine && remote && Number(remote.at) > Number(local.at)) layout = remote;
    if (!mine) layout = remote && remote.share ? remote : cleanProfileTabs(null);
    return layout;
  }
  function tabMarquee(text) {
    var safe = esc(text);
    return '<span class="ptab-marquee" data-ptab-marquee><span class="ptab-marquee-clip"><span class="ptab-marquee-track"><span class="ptab-marquee-copy"><span class="ptab-marquee-text">' + safe + '</span></span><span class="ptab-marquee-copy" aria-hidden="true"><span class="ptab-marquee-text">' + safe + '</span></span></span></span></span>';
  }
  function profileTabBar(account, mine, requested, profileHref) {
    if (!mine) profileTabEdit = false;
    var showAbout = window.ProfileAbout && window.ProfileAbout.showTab(account);
    var showGifts = window.ProfileGifts && window.ProfileGifts.showTab(account);
    var highlightHtml = window.Highlights && window.Highlights.row ? window.Highlights.row(account, mine) : "";
    var layout = profileTabPlan(account, mine);
    var hidden = {};
    layout.hidden.forEach(function (id) { hidden[id] = true; });
    function available(id) {
      if (id === "about") return !!showAbout;
      if (id === "gifts") return !!showGifts;
      if (id === "highlights") return !!(mine || highlightHtml);
      return true;
    }
    var editing = !!(mine && profileTabEdit);
    var ids = layout.order.filter(function (id) {
      if (!available(id)) return false;
      if (!editing && hidden[id]) return false;
      return true;
    });
    if (!ids.length) ids = ["posts"];
    var visible = ids.filter(function (id) { return !hidden[id]; });
    if (!visible.length) visible = ["posts"];
    var active = visible.indexOf(requested) >= 0 ? requested : visible[0];
    var html = ids.map(function (id) {
      var label = profileTabLabel(id);
      if (id === "friends" && accountStat(account, "friends") > 0) label += " (" + formatNum(accountStat(account, "friends")) + ")";
      if (editing) {
        var eye = id === "posts"
          ? '<span class="ptab-lock" title="' + esc(tr("This item always stays available")) + '" aria-label="' + esc(tr("This item always stays available")) + '">' + lockIcon(16) + "</span>"
          : '<button type="button" class="ptab-eye" data-ptab="vis" data-id="' + esc(id) + '" aria-pressed="' + (hidden[id] ? "false" : "true") + '" aria-label="' + esc(hidden[id] ? tr("Hidden") : tr("Visible")) + '">' + esc(hidden[id] ? tr("Hidden") : tr("Visible")) + "</button>";
        return '<div class="ptab-edit' + (hidden[id] ? " is-hidden" : "") + (active === id ? " on" : "") + '" data-ptab-id="' + esc(id) + '" data-ptab-drag="' + esc(id) + '"><button type="button" class="ptab-grip" data-ptab-drag="' + esc(id) + '" aria-label="' + esc(tr("Drag to reorder")) + '">⋮⋮</button>' + tabMarquee(label) + eye + "</div>";
      }
      var href = id === "posts" ? profileHref : profileHref + "?tab=" + encodeURIComponent(id);
      return '<a class="tab' + (active === id ? " on" : "") + '" role="tab" aria-selected="' + (active === id ? "true" : "false") + '" href="' + esc(href) + '" data-ptab-id="' + esc(id) + '">' + tabMarquee(label) + "</a>";
    }).join("");
    var tools = "";
    if (mine) {
      tools = editing
        ? '<div class="ptabs-tools"><button type="button" class="outline" data-ptab="reset">' + esc(tr("Reset to default")) + '</button><button type="button" class="outline ptabs-share' + (layout.share ? " on" : "") + '" data-ptab="share" aria-pressed="' + (layout.share ? "true" : "false") + '">' + esc(tr("Show this order to visitors")) + '</button><button type="button" class="outline" data-ptab="done">' + esc(tr("Done")) + "</button></div>"
        : '<div class="ptabs-tools"><button type="button" class="outline ptabs-edit" data-ptab="edit">' + esc(tr("Edit tabs")) + "</button></div>";
    }
    return {
      active: active,
      highlightHtml: highlightHtml,
      html: '<div class="ptabs-wrap' + (editing ? " is-editing" : "") + '"><div class="tabs ptabs" role="tablist" aria-label="' + esc(tr("Profile")) + '">' + html + "</div>" + tools + "</div>"
    };
  }
  function onProfileTabAct(node) {
    var act = node.getAttribute("data-ptab") || "";
    var current = readProfileTabs();
    if (act === "edit") { profileTabEdit = true; if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender(); return; }
    if (act === "done") { profileTabEdit = false; if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender(); return; }
    if (act === "reset") {
      profileTabEdit = true;
      saveProfileTabs({ order: PROFILE_TAB_IDS.slice(), hidden: [], share: current.share });
      return;
    }
    if (act === "share") {
      saveProfileTabs({ order: current.order, hidden: current.hidden, share: !current.share });
      return;
    }
    if (act === "vis") {
      var id = node.getAttribute("data-id") || "";
      if (!id || id === "posts") return;
      var hidden = current.hidden.slice();
      var at = hidden.indexOf(id);
      if (at >= 0) hidden.splice(at, 1);
      else hidden.push(id);
      saveProfileTabs({ order: current.order, hidden: hidden, share: current.share });
    }
  }
  function bindProfileTabDrag() {
    document.addEventListener("pointerdown", function (event) {
      if (!profileTabEdit) return;
      var handle = event.target.closest && event.target.closest("[data-ptab-drag]");
      if (!handle || (event.target.closest && event.target.closest("[data-ptab='vis']"))) return;
      var row = handle.closest("[data-ptab-id]");
      var list = row && row.parentElement;
      if (!row || !list || !list.classList.contains("ptabs")) return;
      event.preventDefault();
      profileTabDrag = { pointer: event.pointerId, id: row.getAttribute("data-ptab-id"), list: list, moved: false };
      row.classList.add("is-dragging");
    }, true);
    document.addEventListener("pointermove", function (event) {
      if (!profileTabDrag || event.pointerId !== profileTabDrag.pointer) return;
      var rows = Array.prototype.slice.call(profileTabDrag.list.querySelectorAll("[data-ptab-id]"));
      var node = null;
      rows.forEach(function (row) { if (row.getAttribute("data-ptab-id") === profileTabDrag.id) node = row; });
      if (!node) return;
      var target = null;
      rows.forEach(function (row) {
        if (row === node) return;
        var box = row.getBoundingClientRect();
        if (event.clientX >= box.left && event.clientX <= box.right) target = row;
      });
      if (!target) return;
      var box = target.getBoundingClientRect();
      if (event.clientX < box.left + box.width / 2) profileTabDrag.list.insertBefore(node, target);
      else profileTabDrag.list.insertBefore(node, target.nextSibling);
      profileTabDrag.moved = true;
    }, true);
    document.addEventListener("pointerup", function (event) {
      if (!profileTabDrag || event.pointerId !== profileTabDrag.pointer) return;
      var list = profileTabDrag.list;
      var moved = profileTabDrag.moved;
      list.querySelectorAll(".is-dragging").forEach(function (row) { row.classList.remove("is-dragging"); });
      var order = Array.prototype.slice.call(list.querySelectorAll("[data-ptab-id]")).map(function (row) { return row.getAttribute("data-ptab-id"); });
      profileTabDrag = null;
      if (!moved) return;
      var current = readProfileTabs();
      current.order.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
      saveProfileTabs({ order: order, hidden: current.hidden, share: current.share });
    }, true);
    document.addEventListener("pointercancel", function () { profileTabDrag = null; }, true);
  }
  function bindProfileTabs() {
    var reduced = false;
    try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (err) { reduced = false; }
    document.querySelectorAll("[data-ptab-marquee]").forEach(function (el) {
      var clip = el.querySelector(".ptab-marquee-clip");
      var text = el.querySelector(".ptab-marquee-text");
      var overflow = !!(clip && text && text.scrollWidth > clip.clientWidth + 2);
      el.classList.toggle("is-on", overflow && !reduced);
      if (el.dataset.ptabHold) return;
      el.dataset.ptabHold = "1";
      var hold = function (on) { el.classList.toggle("is-held", on); };
      el.addEventListener("pointerdown", function () { hold(true); });
      el.addEventListener("pointerup", function () { hold(false); });
      el.addEventListener("pointercancel", function () { hold(false); });
      el.addEventListener("pointerleave", function () { hold(false); });
    });
  }
  bindProfileTabDrag();
  function accountPage(account, route) {
    var mine = profileMine(account);
    var ref = accountRef(account);
    if (account.blockedBy && !mine) {
      var blockedTop = window.ViktorychProfile && window.ViktorychProfile.top ? window.ViktorychProfile.top({
        name: account.displayName || account.handle || "",
        platform: "app",
        handle: account.handle || "",
        feedId: account.publicId ? "app:" + account.publicId : "",
        url: "",
        own: false
      }, "") : "";
      return blockedTop + '<div class="empty"><h2>' + esc(tr("You're blocked")) + '</h2><p>' + esc(tr("This account has blocked you. You can’t see their posts or profile.")) + '</p></div>';
    }
    var photo = presenceWrap(mine ? account.publicId : "", publicAvatar(account.avatar, account.avatarFace, "pava"), mine);
    if ((account.photos && account.photos.length) || (account.banners && account.banners.length) || account.avatar || account.banner) {
      photo = photo.replace("<img", '<img data-acct="open-gallery" data-kind="photo"');
    }
    var banner = publicBanner(account.banner, account.bannerFace);
    if (banner.indexOf("<img") >= 0) banner = banner.replace("<img", '<img data-acct="open-gallery" data-kind="banner"');
    var edit = mine ? '<button class="follow" type="button" data-acct="edit">' + esc(tr("Edit profile")) + "</button>" : "";
    var giftBtn = !mine ? '<button class="outline" type="button" data-gift="open" data-handle="' + esc(account.handle || "") + '">' + esc(tr("Send a gift")) + "</button>" : "";
    var birthdayBanner = window.ProfileGifts && window.ProfileGifts.banner ? window.ProfileGifts.banner(account) : "";
    var followBtn = !mine && ref && window.ViktorychAccounts.followButton ? (window.ViktorychAccounts.followButton(ref, true) || "") : "";
    var friendBtn = !mine && ref ? friendButtonHtml(account) : "";
    var requested = (route && route.query && route.query.get("tab")) || (route && route.tab) || "posts";
    if (window.ProfileAbout) window.ProfileAbout.ensure(account, account.aboutPreview || "");
    if (window.ProfileGifts) window.ProfileGifts.ensure(account);
    if (window.ProfileBadges) window.ProfileBadges.ensure(account);
    var profileHref = "#/@" + encodeURIComponent(account.handle || "");
    var bar = profileTabBar(account, mine, requested, profileHref);
    var activeTab = bar.active;

    var pack = { html: "", count: 0 };
    if (window.ViktorychAccounts && window.ViktorychAccounts.profilePostsHtml) pack = window.ViktorychAccounts.profilePostsHtml(account, activeTab) || pack;
    var count = String(pack.count || 0);

    var postsEmpty = activeTab === "replies"
      ? '<div class="empty"><h2>' + esc(tr("No replies yet")) + "</h2><p>" + esc(tr("Replies from this account will show up here.")) + "</p></div>"
      : activeTab === "media"
        ? '<div class="empty"><h2>' + esc(tr("No media yet")) + "</h2><p>" + esc(tr("Photos and videos from this account will show up here.")) + "</p></div>"
        : '<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2><p>" + esc(mine ? tr("Add a photo and bio from Edit profile. Posts here come from feeds you follow.") : tr("Posts from this account will show up here.")) + "</p></div>";
    var postsBody = pack.html || postsEmpty;
    if (!mine && account.viewerBlocks) postsBody = '<div class="empty"><h2>' + esc(tr("You blocked this account")) + '</h2><p>' + esc(tr("Posts from this account stay hidden.")) + '</p></div>';
    else if (!mine && account.locked) postsBody = '<div class="empty"><h2>' + esc(tr("These posts are protected")) + '</h2><p>' + esc(tr("Follow this account and wait for approval to see their posts.")) + '</p></div>';
    var friendsBody = friendsSectionHtml(account);
    var aboutBody = activeTab === "about" && window.ProfileAbout ? window.ProfileAbout.html(account) : "";
    var giftsBody = activeTab === "gifts" && window.ProfileGifts ? window.ProfileGifts.giftsHtml(account.gifts, mine) : "";
    var highlightsBody = bar.highlightHtml || '<div class="empty"><h2>' + esc(tr("Highlights")) + "</h2></div>";
    var body = activeTab === "about" ? aboutBody : activeTab === "gifts" ? giftsBody : activeTab === "friends" ? friendsBody : activeTab === "highlights" ? highlightsBody : postsBody;

    var mutualCount = (graphCounts[ref] && graphCounts[ref].mutualFriendsCount) || account.mutualFriendsCount;
    var mutualLine = (!mine && mutualCount) ? '<div class="pmutual">' + esc(tr("{count} mutual friends", { count: mutualCount })) + '</div>' : '';

    var tabs = bar.html;

    var seenLine = mine && account.publicId && window.ViktorychPresence ? window.ViktorychPresence.linesHtml(account.publicId) : "";
    var top = window.ViktorychProfile && window.ViktorychProfile.top ? window.ViktorychProfile.top({
      name: account.displayName || account.handle || "",
      platform: "app",
      handle: account.handle || "",
      feedId: account.publicId ? "app:" + account.publicId : "",
      url: "",
      own: !!mine,
      count: tr("{count} posts", { count: count })
    }, banner) : banner;
    top = birthdayBanner + top;
    return top + '<div class="pinfo"><div class="pava-row">' + photo + '<div class="pactions">' + edit + giftBtn + followBtn + friendBtn + seenLine + '</div></div><h1 class="pname">' + nameRowHtml(account) + '</h1><div class="phandle">@' + esc(account.handle) + '</div>' + mutualLine + (account.bio ? '<div class="pbio">' + esc(account.bio) + "</div>" : "") + (account.location ? '<div class="acct-loc">' + esc(account.location) + "</div>" : "") + (siteHref(account.website) ? '<div class="acct-loc"><a href="' + esc(siteHref(account.website)) + '" target="_blank" rel="noopener noreferrer">' + esc(account.website) + "</a></div>" : "") + linkedIdentitiesHtml(account) + (account.profileLess ? '<div class="private-badge" style="margin:4px 0 8px">' + esc(tr("Profile-less (not visible to others)")) + '</div>' : "") + accountCountsHtml(account) + "</div>" + tabs + body + galleryHtml(account);
  }
  function profileHtml(route) {
    if (!route || route.name !== "profile" || !route.handle || route.handle === "_") return "";
    var key = skel(route.handle);
    if (profileMiss[key]) return "";
    var account = profiles[key];
    var session = readSession();
    if (!account && session && session.account && (skel(session.account.handle) === key || skel(session.account.handle + (session.account.publicId || "")) === key || session.account.publicId === route.handle)) account = session.account;
    if (!account && /\d{12}$/.test(route.handle)) {
      account = profiles[skel(route.handle.slice(-12))];
    }
    if (!account) {
      loadProfile(route.handle);
      return "";
    }
    if (!account.repostsLoaded) loadProfile(route.handle);
    if (account.handle && skel(account.handle) !== key) {
      var nextHash = "#/@" + encodeURIComponent(account.handle);
      var tab = route.query && route.query.get && route.query.get("tab");
      if (tab) nextHash += "?tab=" + encodeURIComponent(tab);
      if ((location.hash || "") !== nextHash) location.replace(nextHash);
    }
    return accountPage(account, route);
  }
  function profilePending(handle) {
    var key = skel(handle);
    return !!(profileLoads[key] && !profiles[key] && !profileMiss[key]);
  }
  function profileReady(handle) {
    var key = skel(handle);
    if (profileMiss[key]) return true;
    return !!(profiles[key] && profiles[key].repostsLoaded);
  }
  function storedAccount(handle) {
    return profiles[skel(handle)] || null;
  }
  function pillInner() {
    var session = readSession();
    if (!session || !session.account) {
      return '<span class="ava initials" data-acct="login">?</span><span class="account-meta" data-acct="login"><b>' + esc(tr("Sign in")) + '</b><span>' + esc(tr("Not signed in")) + '</span></span>';
    }
    var account = session.account;
    var photo = presenceWrap(account.publicId, publicAvatar(account.avatar, account.avatarFace, ""), true);
    var isAnon = !!account.profileLess;
    var name = isAnon ? (account.displayName || tr("Anonymous")) : (account.displayName || "");
    var sub = isAnon ? tr("Profile-less") : "@" + (account.handle || "");
    return photo + '<span class="account-meta"><b>' + esc(name) + "</b><span>" + esc(sub) + "</span></span>";
  }
  function drawerTools() {
    return '<div class="drawer-id-tools">' +
      '<button class="icon-btn" type="button" data-act="drawer-accounts" aria-label="' + esc(tr("Accounts")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h9v-2.5c0-.9.3-1.7.8-2.4A12 12 0 0 0 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg></button>' +
      '<button class="icon-btn" type="button" data-act="drawer-more" aria-label="' + esc(tr("Account menu")) + '" aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg></button>' +
      '</div>';
  }
  /* One name row for the profile header and the drawer, so the protected
     lock and the badges stay identical in size and order. */
  function nameRowHtml(account) {
    var name = account.displayName || account.handle || "";
    var lock = (account.privateFollows || account.locked) ? '<span class="protected-badge" title="' + esc(tr("Private account")) + '" aria-label="' + esc(tr("Private account")) + '">' + lockIcon(18) + "</span>" : "";
    return '<span class="name-row-text">' + esc(name) + "</span>" + lock + (account.owner ? badge() : "") + (window.ViktorychAffiliations ? window.ViktorychAffiliations.slot(account.publicId) : "");
  }
  function drawerHead() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="drawer-id">' +
        '<div class="drawer-id-top"><button class="drawer-ava" type="button" data-acct="login" aria-label="' + esc(tr("Sign in")) + '"><span class="ava initials">?</span></button>' + drawerTools() + '</div>' +
        '<button class="drawer-name" type="button" data-acct="login"><b>' + esc(tr("Sign in")) + '</b></button>' +
        '<div class="drawer-handle">' + esc(tr("Not signed in")) + '</div>' +
        '</div>';
    }
    var account = session.account;
    var photo = presenceWrap(account.publicId, publicAvatar(account.avatar, account.avatarFace, ""), false);
    var isAnon = !!account.profileLess;
    var name = isAnon ? (account.displayName || tr("Anonymous")) : (account.displayName || "");
    var sub = isAnon ? tr("Profile-less account") : "@" + (account.handle || "");
    var href = account.handle ? "#/@" + encodeURIComponent(account.handle) : "#/settings";
    var following = accountStat(account, "following");
    var followers = accountStat(account, "followers");
    var followerLabel = followers === 1 ? tr("Follower") : tr("Followers");
    if (accountRef(account)) ensureCounts(accountRef(account));
    return '<div class="drawer-id">' +
      '<div class="drawer-id-top"><a class="drawer-ava" href="' + esc(href) + '">' + photo + '</a>' + drawerTools() + '</div>' +
      '<a class="drawer-name pname" href="' + esc(href) + '">' + (isAnon ? '<span class="name-row-text">' + esc(name) + "</span>" : nameRowHtml(account)) + '</a>' +
      '<a class="drawer-handle" href="' + esc(href) + '">' + esc(sub) + '</a>' +
      '<div class="drawer-counts"><a href="' + esc(href + "/following") + '"><b>' + esc(formatNum(following)) + '</b> ' + esc(tr("Following count")) + '</a><a href="' + esc(href + "/followers") + '"><b>' + esc(formatNum(followers)) + '</b> ' + esc(followerLabel) + '</a></div>' +
      '</div>';
  }
  var tiktokHealth = null;
  var tiktokHealthAt = 0;
  var backupChannels = null;
  var backupChannelNote = "";
  var backupChannelsAt = 0;
  function loadTikTokHealth() {
    var session = readSession();
    if (!session || !session.token || !session.account || !session.account.owner) return;
    if (Date.now() - tiktokHealthAt < 20000) return;
    tiktokHealthAt = Date.now();
    api("/v1/owner/tiktok/health", { token: session.token }).then(function (body) {
      if (!body || body.status !== 200) return;
      tiktokHealth = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  /* Owner panel: usage against the free limits, read at most every five
     minutes while settings are open. */
  var usageDoc = null;
  var usageAt = 0;
  function loadUsage() {
    var session = readSession();
    if (!session || !session.token || !session.account || !session.account.owner) return;
    if (Date.now() - usageAt < 5 * 60 * 1000) return;
    usageAt = Date.now();
    api("/v1/owner/usage", { token: session.token }).then(function (body) {
      if (!body || body.status !== 200) return;
      usageDoc = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function usageRow(label, used, limit) {
    var pct = limit ? Math.min(100, Math.round((Number(used) || 0) * 100 / limit)) : 0;
    var level = pct >= 90 ? " hot" : pct >= 70 ? " warm" : "";
    return '<div class="usage-row' + level + '"><div class="usage-top"><span>' + esc(label) + '</span><b>' + esc(tr("{used} of {limit}", { used: formatNum(Number(used) || 0), limit: formatNum(limit) })) + '</b></div>' +
      '<div class="usage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' + esc(label) + '"><i style="width:' + pct + '%"></i></div></div>';
  }
  function usageHtml() {
    var u = usageDoc;
    var head = '<div class="set-block usage-panel"><h2>' + esc(tr("Free tier usage")) + "</h2>";
    if (!u) return head + '<p class="phandle">' + esc(tr("Loading…")) + "</p></div>";
    var L = u.limits || {};
    var rows = "";
    if (!u.configured) {
      rows += '<p class="set-sub">' + esc(tr("Usage needs a read-only analytics token. Add CF_ANALYTICS_TOKEN and CF_ACCOUNT_ID as Worker secrets.")) + "</p>";
    } else if (u.error) {
      rows += '<p class="set-sub">' + esc(tr("Analytics did not answer. Try again later.")) + "</p>";
    } else {
      rows += usageRow(tr("Worker requests today"), u.workerRequestsToday, L.workerRequestsDay);
      rows += usageRow(tr("D1 rows read today"), u.d1RowsReadToday, L.d1RowsReadDay);
      rows += usageRow(tr("D1 rows written today"), u.d1RowsWrittenToday, L.d1RowsWrittenDay);
      rows += usageRow(tr("Live channel requests today"), u.durableRequestsToday, L.durableRequestsDay);
      rows += usageRow(tr("Storage writes this month"), u.r2ClassAMonth, L.r2ClassAMonth);
      rows += usageRow(tr("Storage reads this month"), u.r2ClassBMonth, L.r2ClassBMonth);
      var week = (u.week || []).map(function (row) {
        return '<span class="usage-day' + (row.requests > L.workerRequestsDay ? " hot" : "") + '">' + esc(String(row.date).slice(5)) + " " + esc(formatNum(row.requests)) + "</span>";
      }).join("");
      if (week) rows += '<p class="set-sub">' + esc(tr("Worker requests, last 7 days")) + '</p><div class="usage-week">' + week + "</div>";
    }
    rows += usageRow(tr("Backup server hours this month (at most)"), u.renderHoursCeiling, L.renderHoursMonth);
    return head + rows + "</div>";
  }
  function healthWhen(value) {
    if (!value) return "";
    try { return new Date(value).toLocaleString(); } catch (err) { return String(value); }
  }
  function healthHtml() {
    var body = tiktokHealth;
    var locked = false;
    try { locked = typeof localStorage !== "undefined" && localStorage.getItem("viktorych_shorts_locked") === "1"; } catch (e) {}
    var rows = body && body.backoffs || [];
    var accounts = body && body.accounts || [];
    if (locked) {
      var allow = window.ViktorychShorts && window.ViktorychShorts.isUnlocked;
      rows = rows.filter(function (r) {
        return allow ? allow(r && r.handle) : false;
      });
      accounts = accounts.filter(function (r) {
        return allow ? allow(r && r.handle) : false;
      });
    }
    var checked = body && body.checkedAt ? healthWhen(body.checkedAt) : "";
    var checkLine = '<p class="phandle">' + esc(checked ? tr("Last check {time}", { time: checked }) : tr("No check yet.")) + "</p>";
    var accountLines = accounts.map(function (row) {
      var status = row.status === "live" ? tr("LIVE") : row.status === "blocked" ? tr("Blocked") : row.status === "offline" ? tr("Offline") : "";
      var rec = row.recording ? tr("Recording") : (row.lastRecordingAt ? tr("Last recording {time}", { time: healthWhen(row.lastRecordingAt) }) : "");
      var bits = ["@" + String(row.handle || ""), status, rec].filter(Boolean);
      return '<p class="phandle">' + esc(bits.join(" · ")) + "</p>";
    }).join("");
    var blocked = body ? (body.blocked403 || 0) + (body.blocked429 || 0) + (body.captcha || 0) : 0;
    var lines = '<p class="phandle">' + esc(tr("No recent blocks.")) + "</p>";
    if (body && (blocked || rows.length)) {
      lines = '<p class="phandle">' + esc("403 " + (body.blocked403 || 0) + " · 429 " + (body.blocked429 || 0) + " · captcha " + (body.captcha || 0)) + "</p>";
      lines += rows.map(function (row) {
        var when = "";
        try { when = row.until ? new Date(row.until).toLocaleString() : ""; } catch (err) { when = row.until || ""; }
        return '<p class="phandle">@' + esc(row.handle || "") + " " + esc(tr("Backing off until {time}", { time: when })) + "</p>";
      }).join("");
    }
    return '<div class="set-block"><h2>' + esc(tr("TikTok health")) + "</h2>" + checkLine + accountLines + lines + "</div>";
  }
  function addBackupChannel() {
    var session = readSession();
    var input = document.querySelector('input[name="backup-channel"]');
    var channel = input ? String(input.value || "").trim() : "";
    if (!session || !session.token || !channel) return;
    api("/v1/owner/tiktok/channels", { method: "POST", token: session.token, body: { channel: channel } }).then(function (body) {
      if (!body || body.status !== 200) {
        backupChannelNote = tr("That channel id was not saved.");
      } else {
        backupChannels = body;
        backupChannelNote = "";
        if (input) input.value = "";
      }
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      backupChannelNote = tr("That channel id was not saved.");
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function removeBackupChannel(index) {
    var session = readSession();
    if (!session || !session.token || index == null || index === "") return;
    api("/v1/owner/tiktok/channels", { method: "POST", token: session.token, body: { remove: Number(index) } }).then(function (body) {
      if (body && body.status === 200) backupChannels = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function loadBackupChannels() {
    var session = readSession();
    if (!session || !session.token || !session.account || !session.account.owner) return;
    if (Date.now() - backupChannelsAt < 20000) return;
    backupChannelsAt = Date.now();
    api("/v1/owner/tiktok/channels", { token: session.token }).then(function (body) {
      if (!body || body.status !== 200) return;
      backupChannels = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function channelsHtml() {
    var body = backupChannels;
    var extra = body && body.extra ? body.extra : 0;
    var masks = body && body.masks || [];
    var list = masks.map(function (mask, index) {
      return '<button class="outline" type="button" data-acct="remove-channel" data-index="' + index + '">' + esc(tr("Remove {channel}", { channel: mask })) + "</button>";
    }).join("");
    return '<div class="set-block"><h2>' + esc(tr("Backup channels")) + "</h2>" +
      '<p class="set-sub">' + esc(tr("The same bot posts there. Lives are spread across these channels.")) + "</p>" +
      '<p class="phandle">' + esc(tr("{count} extra channels", { count: String(extra) })) + "</p>" +
      list +
      '<input name="backup-channel" autocomplete="off" spellcheck="false" placeholder="-100…" aria-label="' + esc(tr("Add a backup channel")) + '">' +
      '<button class="outline" type="button" data-acct="add-channel">' + esc(tr("Add a backup channel")) + "</button>" +
      (backupChannelNote ? '<p class="phandle">' + esc(backupChannelNote) + "</p>" : "") +
      "</div>";
  }
  function isOwnerAccount(account) {
    if (!account) return false;
    if (account.owner) return true;
    var id = String(account.publicId || "");
    if (id === "emergency_owner") return true;
    var handle = String(account.handle || "");
    var checked = window.HandleSkeleton && window.HandleSkeleton.inspectHandle ? window.HandleSkeleton.inspectHandle(handle) : null;
    return !!(checked && checked.owner);
  }
  var inactivityState = { loaded: false, loading: false, months: 1, saving: false };
  function loadInactivity() {
    var session = readSession();
    if (!session || !session.token || inactivityState.loading) return;
    inactivityState.loading = true;
    api("/v1/account/inactivity", { token: session.token }).then(function (res) {
      inactivityState.loading = false;
      inactivityState.loaded = true;
      if (res && res.status === 200 && res.months) inactivityState.months = Number(res.months) || 1;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { inactivityState.loading = false; inactivityState.loaded = true; });
  }
  function saveInactivity(months) {
    var session = readSession();
    var n = Number(months);
    if (!session || !session.token || [1, 3, 6, 12].indexOf(n) < 0) return;
    var before = inactivityState.months;
    inactivityState.months = n;
    api("/v1/account/inactivity", { token: session.token, method: "PUT", body: { months: n } }).then(function (res) {
      if (!res || res.status !== 200) {
        inactivityState.months = before;
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () { inactivityState.months = before; });
  }
  /* Like Telegram: delete the account automatically after a period away. */
  function inactivityHtml(account) {
    if (isOwnerAccount(account)) return "";
    if (!inactivityState.loaded && !inactivityState.loading) loadInactivity();
    var opts = [[1, tr("1 month")], [3, tr("3 months")], [6, tr("6 months")], [12, tr("12 months")]].map(function (row) {
      return '<option value="' + row[0] + '"' + (inactivityState.months === row[0] ? " selected" : "") + ">" + esc(row[1]) + "</option>";
    }).join("");
    return '<h2>' + esc(tr("If you’re away for")) + '</h2><p class="set-sub">' + esc(tr("If you don’t use your account for this long, it and its data are deleted.")) + '</p><label class="acct-field acct-select"><select data-acct="inactivity-months" aria-label="' + esc(tr("If you’re away for")) + '">' + opts + "</select></label>";
  }
  document.addEventListener("change", function (event) {
    var node = event.target;
    if (!node || !node.getAttribute || node.getAttribute("data-acct") !== "inactivity-months") return;
    saveInactivity(node.value);
  }, true);
  function deleteEntryHtml(account) {
    if (isOwnerAccount(account)) return "";
    return '<h2>' + esc(tr("Delete account")) + '</h2><p class="set-sub">' + esc(tr("Permanently delete this account and the data tied to it.")) + '</p><button class="outline acct-danger" type="button" data-acct="open-delete">' + esc(tr("Delete account")) + "</button>";
  }
  function deleteReady() {
    var session = readSession();
    var account = session && session.account;
    if (!account || isOwnerAccount(account)) return false;
    var typed = String(deleteState.handle || "").trim().replace(/^@/, "");
    var digits = String(deleteState.accountNumber || "").replace(/\D/g, "");
    return typed === String(account.handle || "") && /^\d{16}$/.test(digits);
  }
  function deleteAccountHtml() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="set-block acct-settings"><p class="phandle">' + esc(tr("Not signed in")) + "</p></div>";
    }
    if (isOwnerAccount(session.account)) {
      return '<div class="set-block acct-settings"><p class="phandle">' + esc(tr("This account cannot be deleted.")) + "</p></div>";
    }
    if (deleteState.phase === "progress") {
      var labels = [tr("Checking your account"), tr("Removing the account"), tr("Removing saved files"), tr("Updating the public copy"), tr("Clearing this device")];
      var items = labels.map(function (label, index) {
        return '<li class="' + (index <= deleteState.step ? "on" : "") + '">' + esc(label) + "</li>";
      }).join("");
      return '<div class="set-block acct-settings"><h2>' + esc(tr("Deleting your account")) + '</h2><ul class="acct-progress" aria-live="polite">' + items + "</ul></div>";
    }
    var ready = deleteReady();
    return '<div class="set-block acct-settings" data-delete-form><p class="set-sub">' + esc(tr("This permanently deletes this account. Your profile, photos, sessions, follows, followers, friends, notification tabs, feed settings, groups, drafts, likes, bookmarks, watch history, community posts, vault, drive files, linked accounts, and uploads are removed. The handle can stay reserved so nobody else can take it. This cannot be undone.")) + '</p><div class="acct-field"><input id="acct-delete-number" name="accountNumber" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder=" " data-max="16" value="' + esc(grouped(deleteState.accountNumber || "")) + '"><label for="acct-delete-number">' + esc(tr("Enter your account number again.")) + '</label></div><div class="acct-field"><input id="acct-delete-handle" name="confirmHandle" type="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder=" " value="' + esc(deleteState.handle || "") + '"><label for="acct-delete-handle">' + esc(tr("Confirm your handle")) + '</label></div><p class="acct-error">' + esc(deleteState.error || "") + '</p><button class="acct-next acct-danger" type="button" data-acct="delete-go"' + (ready && !deleteState.busy ? "" : " disabled") + ">" + esc(tr("Delete account")) + "</button></div>";
  }
  function wipeDevice() {
    var prefixes = ["viktorychapp-", "superintelapp-", "rss-" + "feeds-", "va_cm_"];
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (key) {
        if (!key) return;
        for (var p = 0; p < prefixes.length; p++) {
          if (key.indexOf(prefixes[p]) === 0) {
            localStorage.removeItem(key);
            return;
          }
        }
      });
      localStorage.removeItem("yt-ambient-mode");
      localStorage.removeItem("viktorych_shorts_locked");
    } catch (err) { /* private mode */ }
    try {
      sessionStorage.clear();
      sessionStorage.setItem(DELETED_KEY, "1");
    } catch (err) { /* the screen still replaces the page */ }
    var databases = ["superintel-history", "viktorych-drive", "viktorychapp-live", "superintelapp-live", "sintel-music", "superintelapp-sw", "viktorych-discord"];
    if (window.indexedDB && indexedDB.deleteDatabase) {
      databases.forEach(function (name) {
        try { indexedDB.deleteDatabase(name); } catch (err) { /* already gone */ }
      });
    }
    try { window.dispatchEvent(new Event("viktorych-account-deleted")); } catch (err) { /* storage.js clears the same caches */ }
    var msg = { type: "account-deleted" };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    } catch (err) { /* the worker may still be installing */ }
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.active) reg.active.postMessage(msg);
      }).catch(function () {});
    }
    tellSW(false, "signout");
  }
  function deletePause(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function deleteError(code) {
    if (code === "invalid_credentials") return tr("The account number does not match.");
    if (code === "handle_mismatch") return tr("The handle does not match.");
    if (code === "owner_protected") return tr("This account cannot be deleted.");
    if (code === "rate_limited") return tr("Too many attempts. Try again later.");
    return tr("Deletion did not finish. Try again.");
  }
  function deletionAccepted(res) {
    if (!res || res.status !== 200 || !res.ok) return false;
    if (res.deletion === "complete") return true;
    var steps = res.steps || {};
    return res.deletion === "pending" && !!steps.database && !!steps.sessions;
  }
  function showDeleteStep(step) {
    deleteState.phase = "progress";
    deleteState.step = step;
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function finishDelete(res) {
    var failed = !res || res.status === 400 || res.status === 401 || res.status === 403 || res.status === 415 || res.status === 429 || res.status === 503 || !res.ok;
    if (failed) {
      deleteState.busy = false;
      deleteState.phase = "";
      deleteState.error = deleteError(res && res.error);
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return Promise.resolve();
    }
    var next = Promise.resolve(res);
    if (res.deletion === "pending" && res.resumeToken && !(res.steps && res.steps.database)) {
      next = api("/v1/account/delete", {
        method: "POST",
        headers: { "X-Viktorych-Intent": "account-delete" },
        body: { resumeToken: res.resumeToken }
      });
    }
    return next.then(function (done) {
      if (!deletionAccepted(done)) {
        deleteState.busy = false;
        deleteState.phase = "";
        deleteState.error = tr("Deletion did not finish. Try again.");
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return;
      }
      return deletePause(40).then(function () { showDeleteStep(1); return deletePause(40); })
        .then(function () { showDeleteStep(2); return deletePause(40); })
        .then(function () { showDeleteStep(3); return deletePause(40); })
        .then(function () { showDeleteStep(4); return deletePause(40); })
        .then(function () {
          wipeDevice();
          showDeleted();
        });
    });
  }
  function doDelete() {
    if (deleteState.busy) return;
    var session = readSession();
    if (!session || !session.account || !session.token || isOwnerAccount(session.account)) return;
    if (!deleteReady()) {
      deleteState.error = tr("The handle does not match.");
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return;
    }
    deleteState.busy = true;
    deleteState.error = "";
    showDeleteStep(0);
    api("/v1/account/delete", {
      method: "POST",
      token: session.token,
      headers: { "X-Viktorych-Intent": "account-delete" },
      body: {
        handle: session.account.handle,
        accountNumber: String(deleteState.accountNumber || "").replace(/\D/g, "")
      }
    }).then(finishDelete, function () {
      deleteState.busy = false;
      deleteState.phase = "";
      deleteState.error = tr("Deletion did not finish. Try again.");
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function ensureMediaManager() {
    var session = readSession();
    if (!session || mediaManagerLoaded || !hasApi()) return;
    if (session.account && Array.isArray(session.account.photos)) {
      mediaManagerLoaded = true;
      return;
    }
    mediaManagerLoaded = true;
    api("/v1/session", { token: session.token }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function applyOwnAccount(res) {
    var session = readSession();
    if (!session || !res || res.status !== 200 || !res.account) return false;
    session.account = res.account;
    writeSession(session);
    remember(res.account);
    if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    return true;
  }
  function saveMedia(body, method) {
    var session = readSession();
    if (!session) return;
    api("/v1/profile/media", { method: method || "PATCH", token: session.token, body: body }).then(applyOwnAccount).catch(function () {});
  }
  function readOriginalFile(file, maxBytes) {
    return new Promise(function (resolve) {
      if (!file || file.size > maxBytes) { resolve(""); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { resolve(""); };
      reader.readAsDataURL(file);
    });
  }
  function mediaCard(item, kind) {
    var vis = item.visibility || "everyone";
    function opt(value, label) {
      return '<option value="' + value + '"' + (vis === value ? " selected" : "") + ">" + esc(label) + "</option>";
    }
    return '<div class="media-privacy-card">' +
      photoHtml(item.url, kind === "banner" ? "media-privacy-banner" : "media-privacy-photo") +
      '<label>' + esc(kind === "banner" ? tr("Who can see this banner") : tr("Who can see this photo")) +
      '<select data-acct="media-vis" data-id="' + esc(item.id) + '">' +
      opt("everyone", tr("Everyone")) + opt("followers", tr("Followers")) + opt("friends", tr("Mutual follows")) + opt("nobody", tr("Only you")) +
      "</select></label>" +
      '<p class="set-sub">' + esc(tr("People you allow can always see it. People you block never can.")) + "</p>" +
      '<label>' + esc(tr("Always allow")) + '<input data-media-allow="' + esc(item.id) + '" value="' + esc((item.allow || []).join(", ")) + '" placeholder="@handle"></label>' +
      '<label>' + esc(tr("Never allow")) + '<input data-media-deny="' + esc(item.id) + '" value="' + esc((item.deny || []).join(", ")) + '" placeholder="@handle"></label>' +
      '<div class="media-privacy-actions">' +
      '<button class="outline" type="button" data-acct="media-save-except" data-id="' + esc(item.id) + '">' + esc(tr("Save")) + "</button>" +
      (item.main ? '<span class="media-main">' + esc(kind === "banner" ? tr("Main banner") : tr("Main photo")) + "</span>" : '<button class="outline" type="button" data-acct="media-main" data-id="' + esc(item.id) + '">' + esc(tr("Set as main")) + "</button>") +
      '<button class="outline" type="button" data-acct="media-fallback" data-id="' + esc(item.id) + '" data-on="' + (item.fallback ? "0" : "1") + '">' + esc(item.fallback ? (kind === "banner" ? tr("Public banner") : tr("Public photo")) : (kind === "banner" ? tr("Set public banner") : tr("Set public photo"))) + "</button>" +
      '<button class="outline" type="button" data-acct="media-up" data-id="' + esc(item.id) + '" data-kind="' + esc(kind) + '">' + esc(tr("Move up")) + "</button>" +
      '<button class="outline" type="button" data-acct="media-down" data-id="' + esc(item.id) + '" data-kind="' + esc(kind) + '">' + esc(tr("Move down")) + "</button>" +
      '<button class="outline" type="button" data-acct="media-delete" data-id="' + esc(item.id) + '">' + esc(kind === "banner" ? tr("Delete banner") : tr("Delete photo")) + "</button>" +
      "</div></div>";
  }
  function redraw() {
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function copyAccountId() {
    var session = readSession();
    var id = session && session.account && session.account.publicId;
    if (!id || !navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(String(id)).then(function () {
      idCopied = true;
      redraw();
      setTimeout(function () { idCopied = false; redraw(); }, 1600);
    }).catch(function () {});
  }
  function openGallery(kind) {
    gallery.open = true;
    gallery.kind = kind === "banner" ? "banner" : "photo";
    gallery.index = 0;
    redraw();
  }
  function stepGallery(delta) {
    gallery.index += delta;
    redraw();
  }
  function moveMedia(kind, id, delta) {
    var session = readSession();
    var account = session && session.account;
    if (!account || !id) return;
    var list = (kind === "banner" ? account.banners : account.photos) || [];
    var ids = list.map(function (item) { return item.id; });
    var at = ids.indexOf(id);
    var nextAt = at + delta;
    if (at < 0 || nextAt < 0 || nextAt >= ids.length) return;
    var swap = ids[at];
    ids[at] = ids[nextAt];
    ids[nextAt] = swap;
    saveMedia({ kind: kind === "banner" ? "banner" : "photo", order: ids });
  }
  function saveExceptions(id) {
    function handles(el) {
      return String(el && el.value || "").split(/[,\s]+/).map(function (item) { return item.replace(/^@/, ""); }).filter(Boolean);
    }
    var allowEl = document.querySelector('[data-media-allow="' + id + '"]');
    var denyEl = document.querySelector('[data-media-deny="' + id + '"]');
    saveMedia({ id: id, allow: handles(allowEl), deny: handles(denyEl) });
  }
  function pickExtra(kind) {
    var input = document.getElementById(kind === "banner" ? "extra-banner" : "extra-photo");
    if (!input) return;
    input.onchange = function () {
      var file = input.files && input.files[0];
      input.value = "";
      readOriginalFile(file, kind === "banner" ? 150 * 1024 : 60 * 1024).then(function (data) {
        if (!data) return;
        saveMedia({ kind: kind === "banner" ? "banner" : "photo", image: data }, "POST");
      });
    };
    input.click();
  }
  function privacyHtml() {
    ensureMediaManager();
    var session = readSession();
    var account = session && session.account;
    if (!account) return "";
    var photos = Array.isArray(account.photos) ? account.photos : [];
    var banners = Array.isArray(account.banners) ? account.banners : [];
    var note = account.privateFollows
      ? tr("A private account starts photos and banners at followers.")
      : tr("Photos and banners are visible to everyone until you change one.");
    return '<div class="media-privacy">' +
      '<h2>' + esc(tr("Profile photo privacy")) + "</h2>" +
      '<p class="set-sub">' + esc(note) + " " + esc(tr("Shown when someone cannot see your main photo")) + ".</p>" +
      photos.map(function (item) { return mediaCard(item, "photo"); }).join("") +
      '<button class="outline" type="button" data-acct="pick-extra" data-kind="photo">' + esc(tr("Add a profile photo")) + "</button>" +
      '<h2>' + esc(tr("Banner privacy")) + "</h2>" +
      banners.map(function (item) { return mediaCard(item, "banner"); }).join("") +
      '<button class="outline" type="button" data-acct="pick-extra" data-kind="banner">' + esc(tr("Add a banner")) + "</button>" +
      '<input class="acct-hidden" id="extra-photo" type="file" accept="image/jpeg,image/png,image/webp">' +
      '<input class="acct-hidden" id="extra-banner" type="file" accept="image/jpeg,image/png,image/webp">' +
      "</div>";
  }
  function settingsHtml() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + '</h2>' +
        '<p class="phandle">' + esc(tr("Not signed in")) + '</p>' +
        '<button class="outline" type="button" data-acct="login" style="margin-top:8px">' + esc(tr("Sign in to {app}", { app: appName() })) + '</button>' +
        '<button class="outline" type="button" data-acct="signup">' + esc(tr("Create account")) + '</button>' +
        '<button class="outline" type="button" data-acct="open-emergency">' + esc(tr("Emergency Offline Access")) + '</button>' +
        '<button class="outline" type="button" data-acct="open-restore">' + esc(tr("Restore session")) + '</button>' +
        '</div>';
    }
    var account = session.account;
    var hidden = account.hideAvatar === "none" || account.hideAvatar === "default" ? account.hideAvatar : "";
    function hideBtn(mode, label) {
      return '<button class="outline' + (hidden === mode ? " on" : "") + '" type="button" data-acct="hide-avatar" data-mode="' + mode + '">' + esc(label) + "</button>";
    }
    var health = "";
    if (account.owner) {
      loadTikTokHealth();
      loadBackupChannels();
      loadUsage();
      health = usageHtml() + healthHtml() + channelsHtml();
    }
    if (window.ProfileAbout) window.ProfileAbout.ensure(account, "");
    var aboutPrivacy = window.ProfileAbout && window.ProfileAbout.privacyOpen() ? window.ProfileAbout.privacyHtml(account.about || { sections: [] }) : "";
    return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + "</h2><p class=\"phandle\">@" + esc(account.handle) + "</p><p class=\"phandle acct-id-row\"><span>" + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + '</span> <button class="outline" type="button" data-acct="copy-id">' + esc(idCopied ? tr("Account ID copied") : tr("Copy account ID")) + "</button></p><button class=\"outline\" type=\"button\" data-acct=\"edit\">" + esc(tr("Edit profile")) + '</button><button class="outline" type="button" data-about="privacy">' + esc(tr("About privacy")) + "</button>" + aboutPrivacy + '<h2>' + esc(tr("Hide my profile picture")) + '</h2><p class="set-sub">' + esc(tr("Other people see this instead of your photo.")) + '</p><div class="theme-row" role="group" aria-label="' + esc(tr("Hide my profile picture")) + '">' + hideBtn("", tr("Show my picture")) + hideBtn("default", tr("Default")) + hideBtn("none", tr("None")) + '</div><h2>' + esc(tr("Private followers and following")) + '</h2><p class="set-sub">' + esc(tr("Keep your followers and following list private. Only you will be able to see who you follow and who follows you.")) + '</p><button class="tab-switch' + (account.privateFollows ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.privateFollows ? "true" : "false") + '" data-acct="toggle-private-follows"><span>' + esc(tr("Keep lists private")) + '</span><i></i></button>' +
      '<h2>' + esc(tr("Protect your posts")) + '</h2><p class="set-sub">' + esc(tr("Only approved followers and friends can see your posts and lists.")) + '</p><button class="tab-switch' + (account.protected ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.protected ? "true" : "false") + '" data-acct="toggle-protected"><span>' + esc(tr("Protect your posts")) + '</span><i></i></button>' + relationSettingsHtml() +
      '<h2>' + esc(tr("Profile-less account")) + '</h2><p class="set-sub">' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p><button class="tab-switch' + (account.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.profileLess ? "true" : "false") + '" data-acct="toggle-profileless"><span>' + esc(tr("Profile-less")) + '</span><i></i></button>' + (function () { if (!federationState.loaded && !federationState.loading) loadFederationSettings(); if (window.ViktorychNostr && !window.ViktorychNostr.allowed()) return ""; return '<h2>' + esc(tr("Nostr (NIP-05)")) + '</h2><p class="set-sub">' + esc(tr("Let Nostr apps find your account by its NIP-05 name. Default is off.")) + '</p><button class="tab-switch' + (federationState.enabled_nostr ? " on" : "") + '" type="button" role="switch" aria-checked="' + (federationState.enabled_nostr ? "true" : "false") + '" data-acct="toggle-fed-nostr"><span>' + esc(tr("Nostr (NIP-05)")) + (federationState.enabled_nostr && federationState.nostr_nip05 ? " (" + esc(federationState.nostr_nip05) + ")" : "") + '</span><i></i></button>'; })() + '<h2>' + esc(tr("Linked social accounts")) + '</h2><p class="set-sub">' + esc(tr("Link your X, Telegram, Instagram, and YouTube accounts so their posts appear on your profile. Requires identity verification.")) + '</p>' + identitiesSettingsHtml(account) + '<h2>' + esc(tr("Recovery codes")) + '</h2><p class="set-sub">' + esc(tr("These codes are shown once. Old codes stop working when you create new ones.")) + '</p><button class="outline" type="button" data-acct="recovery-new">' + esc(tr("Create new recovery codes")) + "</button>" + (account.owner ? '<h2>' + esc(tr("Review reports")) + '</h2><button class="outline" type="button" data-acct="open-reports">' + esc(tr("Review reports")) + "</button>" + (window.ViktorychAffiliations ? window.ViktorychAffiliations.adminHtml() : "") : "") + '<h2>' + esc(tr("Device sync")) + '</h2><p class="set-sub">' + esc(tr("Transfer your session to another browser or device.")) + '</p><button class="outline" type="button" data-acct="copy-session">' + esc(tr("Copy session code")) + "</button>" + inactivityHtml(account) + deleteEntryHtml(account) + '<button class="outline" type="button" data-acct="logout">' + esc(tr("Log out")) + '</button><button class="outline" type="button" data-acct="logout-all">' + esc(tr("Log out of all devices")) + "</button></div>" + health;  }
  function onClick(event) {
    var reqKind = event.target && event.target.closest ? event.target.closest("[data-req-kind]") : null;
    if (reqKind) {
      event.preventDefault();
      var hash = location.hash || "";
      var path = hash.split("?")[0];
      location.hash = path + (reqKind.getAttribute("data-req-kind") === "friends" ? "?kind=friends" : "");
      return;
    }
    var reqBox = event.target && event.target.closest ? event.target.closest("[data-req-box]") : null;
    if (reqBox) {
      event.preventDefault();
      var base = (location.hash || "").split("?")[0];
      location.hash = base + "?kind=friends" + (reqBox.getAttribute("data-req-box") === "out" ? "&box=out" : "");
      return;
    }
    var friendSub = event.target && event.target.closest ? event.target.closest("[data-friend-sub]") : null;
    if (friendSub) {
      event.preventDefault();
      event.stopPropagation();
      friendsSubTab = friendSub.dataset.friendSub || "all";
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return;
    }
    var friendAct = event.target && event.target.closest ? event.target.closest("[data-friend-act]") : null;
    if (friendAct) {
      event.preventDefault();
      event.stopPropagation();
      var fact = friendAct.dataset.friendAct;
      var fid = friendAct.dataset.friendId;
      var fhandle = friendAct.dataset.handle;
      if (fact === "unfriend") {
        unfriendTarget = { id: fid, handle: fhandle };
        view = "unfriend";
        paint();
        return;
      }
      if (fact === "unfriend-confirm") {
        if (unfriendTarget) {
          doFriendAction("remove", unfriendTarget.id, unfriendTarget.handle);
          unfriendTarget = null;
        }
        closeAuth();
        return;
      }
      if (fact === "request" || fact === "accept" || fact === "decline" || fact === "cancel") {
        doFriendAction(fact, fid, fhandle);
        return;
      }
    }
    var ptab = event.target && event.target.closest ? event.target.closest("[data-ptab]") : null;
    if (ptab) {
      event.preventDefault();
      event.stopPropagation();
      onProfileTabAct(ptab);
      return;
    }
    var acct = event.target && event.target.closest ? event.target.closest("[data-acct]") : null;
    if (!acct) return;
    var act = acct.dataset.acct;
    if (act === "saved" || act === "do-login" || act === "do-recover") return;
    event.preventDefault();
    event.stopPropagation();
    if (act === "presence-open") {
      if (window.ViktorychPresence) window.ViktorychPresence.open(acct);
      return;
    }
    if (act === "signup") openAuth("signup");
    else if (act === "login") openAuth("login");
    else if (act === "open-restore") openAuth("restore");
    else if (act === "open-emergency") openAuth("emergency");
    else if (act === "close") closeAuth();
    else if (act === "open-link-identity") {
      linkIdentityForm = { platform: "x", handle: "", proofUrl: "", step: 0, challenge: null, loading: false };
      errorText = "";
      view = "link-identity";
      paint();
    }
    else if (act === "gen-challenge") {
      if (!linkIdentityForm.handle) {
        errorText = tr("Username or channel");
        paint();
        return;
      }
      var session = readSession();
      if (!session) return;
      linkIdentityForm.loading = true;
      errorText = "";
      paint();
      api("/v1/account/identities/challenge", {
        method: "POST",
        token: session.token,
        body: { platform: linkIdentityForm.platform, handle: linkIdentityForm.handle }
      }).then(function (res) {
        linkIdentityForm.loading = false;
        if (!res || !res.ok) {
          errorText = (res && res.error === "identity_already_linked") ? tr("Identity confirmed and linked!") : tr("Verification failed. Make sure the code is in your bio or post.");
          paint();
          return;
        }
        linkIdentityForm.challenge = res;
        linkIdentityForm.step = 1;
        paint();
      }).catch(function () {
        linkIdentityForm.loading = false;
        errorText = tr("Verification failed. Make sure the code is in your bio or post.");
        paint();
      });
    }
    else if (act === "copy-code") {
      if (linkIdentityForm.challenge && linkIdentityForm.challenge.code) {
        try { navigator.clipboard.writeText(linkIdentityForm.challenge.code); } catch (e) {}
        copiedIdentityCode = true;
        paint();
        setTimeout(function () { copiedIdentityCode = false; paint(); }, 2000);
      }
    }
    else if (act === "verify-identity") {
      var session = readSession();
      if (!session || !linkIdentityForm.challenge) return;
      linkIdentityForm.loading = true;
      errorText = "";
      paint();
      api("/v1/account/identities/verify", {
        method: "POST",
        token: session.token,
        body: { challengeId: linkIdentityForm.challenge.challengeId, proofUrl: linkIdentityForm.proofUrl }
      }).then(function (res) {
        linkIdentityForm.loading = false;
        if (!res || !res.ok) {
          errorText = tr("Verification failed. Make sure the code is in your bio or post.");
          paint();
          return;
        }
        linkIdentityForm.step = 2;
        var ident = res.identity;
        if (session.account) {
          var idList = session.account.identities || [];
          idList = idList.filter(function (it) { return !(it.platform === ident.platform && String(it.handle).toLowerCase() === String(ident.handle).toLowerCase()); });
          idList.push(ident);
          session.account.identities = idList;
          writeSession(session);
          if (profiles[skel(session.account.handle)]) {
            profiles[skel(session.account.handle)].identities = idList;
          }
        }
        paint();
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }).catch(function () {
        linkIdentityForm.loading = false;
        errorText = tr("Verification failed. Make sure the code is in your bio or post.");
        paint();
      });
    }
    else if (act === "back-identity") {
      linkIdentityForm.step = 0;
      errorText = "";
      paint();
    }
    else if (act === "identity-show") {
      var showId = acct.dataset.id || "";
      var nextShown = acct.getAttribute("aria-checked") !== "true";
      acct.setAttribute("aria-checked", nextShown ? "true" : "false");
      acct.classList.toggle("on", nextShown);
      saveIdentityPrivacy(showId);
      return;
    }
    else if (act === "unlink-identity") {
      var session = readSession();
      if (!session) return;
      var unlinkPlat = acct.dataset.platform;
      var unlinkHandle = acct.dataset.handle;
      api("/v1/account/identities", {
        method: "DELETE",
        token: session.token,
        body: { platform: unlinkPlat, handle: unlinkHandle }
      }).then(function (res) {
        if (res && res.ok && session.account) {
          session.account.identities = (session.account.identities || []).filter(function (it) {
            return !(it.platform === unlinkPlat && String(it.handle).toLowerCase() === String(unlinkHandle).toLowerCase());
          });
          writeSession(session);
          if (profiles[skel(session.account.handle)]) {
            profiles[skel(session.account.handle)].identities = session.account.identities;
          }
          paint();
          if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        }
      }).catch(function () {});
    }
    else if (act === "stay") { view = "signup"; step = 2; paint(); }
    else if (act === "next") nextSignup();
    else if (act === "passkey-signup") doPasskeySignup();
    else if (act === "passkey-login") doPasskeyLogin();
    else if (act === "do-login") doLogin();
    else if (act === "lost") { view = "lost"; errorText = ""; form.recovery = ""; paint(); }
    else if (act === "do-recover") doRecover();
    else if (act === "save-passkey") savePasskeyNow();
    else if (act === "show-number") {
      var secret = document.getElementById("acct-new-password");
      if (secret) secret.type = secret.type === "password" ? "text" : "password";
    }
    else if (act === "copy-codes") copyCodes();
    else if (act === "download-codes") downloadCodes();
    else if (act === "recovery-new") regenerateCodes();
    else if (act === "open-reports") { view = "reports"; errorText = ""; reportState.items = []; paint(); loadReports(); }
    else if (act === "report-hide") resolveReport(acct.dataset.id, "hide");
    else if (act === "report-dismiss") resolveReport(acct.dataset.id, "dismiss");
    else if (act === "do-emergency") doEmergency();
    else if (act === "do-restore") doRestoreSession();
    else if (act === "copy-session") copySession();
    else if (act === "claim") { form.claimOpen = true; paint(); }
    else if (act === "copy") copyNumber();
    else if (act === "download") downloadNumber();
    else if (act === "saved") finishPending();
    else if (act === "prefs") { view = "prefs"; errorText = ""; paint(); }
    else if (act === "lang") {
      try { localStorage.setItem("viktorychapp-lang-user-picked", "1"); } catch (err) { /* the choice still applies for this page */ }
      if (window.SI18n && window.SI18n.setLang) window.SI18n.setLang(acct.dataset.lang || "en");
      else paint();
    }
    else if (act === "appearance") { applyWallTheme(acct.dataset.mode || "lightsout"); paint(); }
    else if (act === "abandon") abandon();
    else if (act === "edit") openAuth("edit");
    else if (act === "save-profile") saveProfile();
    else if (act === "media-menu") {
      var kind = acct.dataset.kind === "banner" ? "banner" : "avatar";
      form.mediaMenu = form.mediaMenu === kind ? "" : kind;
      paint();
    }
    else if (act === "pick-avatar" || act === "pick-banner") {
      form.mediaMenu = "";
      var input = document.querySelector('#account-layer input[name="' + (act === "pick-avatar" ? "avatar" : "banner") + '"]');
      if (input) input.click();
      else paint();
    }
    else if (act === "face") {
      var faceKind = acct.dataset.kind === "banner" ? "banner" : "avatar";
      var faceMode = acct.dataset.mode === "none" ? "none" : "default";
      if (faceKind === "banner") {
        form.banner = "";
        form.bannerTouched = true;
        form.bannerEmpty = faceMode;
      } else {
        form.avatar = "";
        form.avatarTouched = true;
        form.avatarEmpty = faceMode;
      }
      form.mediaMenu = "";
      paint();
    }
    else if (act === "banner-clear") { form.banner = ""; form.bannerTouched = true; form.bannerEmpty = "default"; form.mediaMenu = ""; paint(); }
    else if (act === "avatar-clear") { form.avatar = ""; form.avatarTouched = true; form.avatarEmpty = "default"; form.mediaMenu = ""; paint(); }
    else if (act === "toggle-form-private") { form.privateFollows = !form.privateFollows; paint(); }
    else if (act === "toggle-form-profileless") { form.profileLess = !form.profileLess; paint(); }
    else if (act === "toggle-private-follows") { var s = readSession(); if (s && s.account) setPrivateFollows(!s.account.privateFollows); }
    else if (act === "toggle-protected") { var sp = readSession(); if (sp && sp.account) setProtected(!sp.account.protected); }
    else if (act === "unblock-account" || act === "unmute-account-server") {
      var rid = acct.dataset.id;
      relationWrite(act === "unblock-account" ? "blocks" : "mutes", rid, true);
    }
    else if (act === "toggle-profileless") { var s = readSession(); if (s && s.account) setProfileLess(!s.account.profileLess); }
    else if (act === "toggle-fed-nostr") toggleFederationNostr();
    else if (act === "hide-avatar") hideAvatar(acct.dataset.mode || "");
    else if (act === "crop-apply") applyCrop();
    else if (act === "logout") logout(false);
    else if (act === "open-delete") {
      deleteState = { phase: "", error: "", step: -1, accountNumber: "", handle: "", busy: false };
      location.hash = "#/settings/delete-account";
    }
    else if (act === "delete-go") doDelete();
    else if (act === "deleted-done") {
      try { sessionStorage.removeItem(DELETED_KEY); } catch (err) { /* the next load shows sign-in */ }
      document.documentElement.removeAttribute("data-wall");
      location.replace(location.pathname + location.search);
      location.reload();
    }
    else if (act === "add-channel") addBackupChannel();
    else if (act === "remove-channel") removeBackupChannel(acct.dataset.index);
    else if (act === "logout-all") logout(true);
else if (act === "copy-id") copyAccountId();
    else if (act === "open-gallery") openGallery(acct.dataset.kind || "photo");
    else if (act === "gallery-close") { gallery.open = false; redraw(); }
    else if (act === "gallery-prev" || act === "gallery-next") stepGallery(act === "gallery-next" ? 1 : -1);
    else if (act === "media-main") saveMedia({ id: acct.dataset.id, main: true });
    else if (act === "media-fallback") saveMedia({ id: acct.dataset.id, fallback: acct.dataset.on === "1" });
    else if (act === "media-delete") saveMedia({ id: acct.dataset.id }, "DELETE");
    else if (act === "media-up" || act === "media-down") moveMedia(acct.dataset.kind, acct.dataset.id, act === "media-down" ? 1 : -1);
    else if (act === "media-save-except") saveExceptions(acct.dataset.id);
    else if (act === "pick-extra") pickExtra(acct.dataset.kind || "photo");
    else if (act === "legal") { legalKey = acct.dataset.legal || "about"; legalTitle = acct.dataset.title || tr("About"); view = "legal"; paint(); }
  }
  var federationState = { loaded: false, loading: false, enabled_nostr: false, nostr_pubkey: "", nostr_nip05: "" };
  function loadFederationSettings() {
    var session = readSession();
    if (!session || !session.token || federationState.loading) return;
    federationState.loading = true;
    api("/v1/federation/settings", { token: session.token }).then(function (res) {
      federationState.loading = false;
      if (res && res.status === 200) {
        federationState.loaded = true;
        federationState.enabled_nostr = !!res.enabled_nostr;
        federationState.nostr_pubkey = res.nostr_pubkey || "";
        federationState.nostr_nip05 = res.nostr_nip05 || "";
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () {
      federationState.loading = false;
    });
  }
  function toggleFederationNostr() {
    var session = readSession();
    if (!session || !session.token) return;
    var next = !federationState.enabled_nostr;
    var deviceKey = window.ViktorychNostr && window.ViktorychNostr.keyInfo();
    var pubkey = (next && deviceKey && deviceKey.pubkey) || federationState.nostr_pubkey;
    if (next && !pubkey) {
      var entered = window.prompt("Enter your Nostr public key (npub or hex):", "");
      if (!entered) return;
      pubkey = entered.trim();
    }
    api("/v1/federation/settings", { method: "POST", token: session.token, body: { enabled_nostr: next, nostr_pubkey: pubkey } }).then(function (res) {
      if (res && res.status === 200) {
        federationState.loaded = true;
        federationState.enabled_nostr = !!res.enabled_nostr;
        federationState.nostr_pubkey = res.nostr_pubkey || "";
        federationState.nostr_nip05 = res.nostr_nip05 || "";
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () {});
  }
  var cropDrag = null;
  var galleryDrag = null;
  function setProfileLess(val) {
    var session = readSession();
    if (!session) return;
    var next = !!val;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { profileLess: next } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      dirtyLists();
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  var relationCache = { blocks: null, mutes: null, loading: false };
  function ensureRelations() {
    var session = readSession();
    if (!session || !hasApi() || relationCache.loading || relationCache.blocks) return;
    relationCache.loading = true;
    Promise.all([
      api("/v1/blocks", { token: session.token }),
      api("/v1/mutes", { token: session.token })
    ]).then(function (pair) {
      relationCache.loading = false;
      relationCache.blocks = pair[0] && pair[0].status === 200 && Array.isArray(pair[0].accounts) ? pair[0].accounts : [];
      relationCache.mutes = pair[1] && pair[1].status === 200 && Array.isArray(pair[1].accounts) ? pair[1].accounts : [];
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { relationCache.loading = false; });
  }
  function relationRows(list, act, label) {
    if (!list || !list.length) return '<p class="set-sub">' + esc(label) + '</p>';
    return list.map(function (item) {
      var id = String(item.id || "").replace(/^app:/, "");
      return '<div class="mute-row"><span>@' + esc(item.handle || item.name || "") + '</span><button type="button" data-acct="' + act + '" data-id="' + esc(id) + '">' + esc(act === "unblock-account" ? tr("Unblock") : tr("Unmute")) + '</button></div>';
    }).join("");
  }
  function relationSettingsHtml() {
    ensureRelations();
    return '<h2>' + esc(tr("Blocked accounts")) + '</h2>' + relationRows(relationCache.blocks, "unblock-account", tr("No blocked accounts")) +
      '<h2>' + esc(tr("Muted accounts")) + '</h2>' + relationRows(relationCache.mutes, "unmute-account-server", tr("No muted accounts"));
  }
  function relationWrite(kind, id, remove) {
    var session = readSession();
    if (!session || !id) return;
    api("/v1/" + kind, { method: remove ? "DELETE" : "PUT", token: session.token, body: { id: id } }).then(function (res) {
      relationCache.blocks = null;
      relationCache.mutes = null;
      if (res && res.status === 200 && window.ViktorychAccounts && window.ViktorychAccounts.toast) {
        var note = tr("Account muted");
        if (kind === "blocks" && remove) note = tr("Account unblocked");
        else if (kind === "blocks") note = tr("Account blocked");
        else if (remove) note = tr("Account unmuted");
        window.ViktorychAccounts.toast(note);
      }
      if (!res || res.status !== 200) {
        if (window.ViktorychAccounts && window.ViktorychAccounts.toast) window.ViktorychAccounts.toast(tr("You can’t do that with this account."));
      }
      ensureRelations();
    }).catch(function () {});
  }
  function setProtected(val) {
    var session = readSession();
    if (!session) return;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { protected: !!val } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function setPrivateFollows(val) {
    var session = readSession();
    if (!session) return;
    var next = !!val;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { privateFollows: next } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      dirtyLists();
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function hideAvatar(mode) {
    var session = readSession();
    if (!session) return;
    var next = mode === "none" || mode === "default" ? mode : "";
    var current = session.account && (session.account.hideAvatar === "none" || session.account.hideAvatar === "default") ? session.account.hideAvatar : "";
    if (next === current) return;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { hideAvatar: next } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  document.addEventListener("pointerdown", function (event) {
    if (view === "edit" && form.mediaMenu) {
      var inside = event.target && event.target.closest && event.target.closest(".acct-pop, [data-acct='media-menu']");
      if (!inside) {
        form.mediaMenu = "";
        paint();
      }
    }
    var stage = event.target && event.target.closest ? event.target.closest(".acct-crop-stage") : null;
    if (stage && view === "crop") {
      cropDrag = { x: event.clientX, y: event.clientY, ox: form.cropX || 0, oy: form.cropY || 0, id: event.pointerId };
      if (stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
      return;
    }
    var frame = event.target && event.target.closest ? event.target.closest(".photo-gallery") : null;
    if (!frame || !gallery.open) return;
    if (event.target.closest && event.target.closest("button")) return;
    galleryDrag = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }, true);
  document.addEventListener("pointermove", function (event) {
    if (!cropDrag || event.pointerId !== cropDrag.id) return;
    form.cropX = cropDrag.ox + (event.clientX - cropDrag.x);
    form.cropY = cropDrag.oy + (event.clientY - cropDrag.y);
    layoutCrop();
  }, true);
  document.addEventListener("pointerup", function (event) {
    if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
    if (galleryDrag && event.pointerId === galleryDrag.id) {
      var dx = event.clientX - galleryDrag.x;
      galleryDrag = null;
      if (Math.abs(dx) >= 40) stepGallery(dx < 0 ? 1 : -1);
    }
  }, true);
  document.addEventListener("pointercancel", function (event) {
    if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
    if (galleryDrag && event.pointerId === galleryDrag.id) galleryDrag = null;
  }, true);
  var photoBlobs = {};
  function refreshProfileMedia() {
    Object.keys(photoBlobs).forEach(function (key) {
      if (key.indexOf("/v1/media/") >= 0) {
        try { URL.revokeObjectURL(photoBlobs[key]); } catch (err) { /* the blob is already gone */ }
        delete photoBlobs[key];
      }
    });
    var imgs = document.querySelectorAll("img[data-photo]");
    for (var i = 0; i < imgs.length; i++) imgs[i].removeAttribute("data-photo-tried");
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "drop-profile-media" });
    }
    var seen = {};
    Object.keys(profiles).forEach(function (key) {
      var account = profiles[key];
      if (!account || !account.handle || seen[account.handle]) return;
      seen[account.handle] = true;
      account.repostsLoaded = false;
      profileLoads[skel(account.handle)] = false;
      profileMiss[skel(account.handle)] = false;
      loadProfile(account.handle);
    });
  }
  function loadPhoto(url) {
    if (photoBlobs[url]) return Promise.resolve(photoBlobs[url]);
    var session = readSession();
    if (!session || !session.token) return Promise.resolve("");
    return fetch(url, { headers: { Authorization: "Bearer " + session.token }, cache: "no-store", credentials: "omit" }).then(function (res) {
      if (!res.ok) return null;
      return res.blob();
    }).then(function (blob) {
      if (!blob) return "";
      var objectUrl = URL.createObjectURL(blob);
      photoBlobs[url] = objectUrl;
      return objectUrl;
    }).catch(function () { return ""; });
  }
  document.addEventListener("error", function (event) {
    var img = event.target;
    if (!img || img.tagName !== "IMG") return;
    var url = img.getAttribute("data-photo");
    if (!url || img.getAttribute("data-photo-tried")) return;
    img.setAttribute("data-photo-tried", "1");
    loadPhoto(url).then(function (objectUrl) { if (objectUrl) img.src = objectUrl; });
  }, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", function (event) {
    var node = event.target;
    if (!node || !node.getAttribute || node.getAttribute("data-acct") !== "identity-audience") return;
    saveIdentityPrivacy(node.getAttribute("data-id") || "");
  }, true);

  function saveIdentityPrivacy(id) {
    var session = readSession();
    if (!session || !session.token || !id) return;
    var row = document.querySelector('.acct-ident-item[data-ident-id="' + id + '"]');
    if (!row) return;
    var select = row.querySelector("[data-acct='identity-audience']");
    var shown = row.querySelector("[data-acct='identity-show']");
    var value = select ? select.value : "public";
    var audience = value.indexOf("list:") === 0 ? "list" : value;
    var listIds = [];
    if (audience === "list") {
      if (value.indexOf("list:") === 0) listIds.push(value.slice(5));
      row.querySelectorAll("[data-aud-list]").forEach(function (box) {
        if (box.checked && listIds.indexOf(box.getAttribute("data-aud-list")) < 0) listIds.push(box.getAttribute("data-aud-list"));
      });
    }
    var hidden = !(shown && shown.getAttribute("aria-checked") === "true");
    api("/v1/account/identities/" + encodeURIComponent(id), {
      method: "PATCH",
      token: session.token,
      body: { audience: audience, hidden: hidden, listIds: listIds }
    }).then(function (res) {
      if (!res || !res.ok || !res.identity || !session.account) return;
      session.account.identities = (session.account.identities || []).map(function (item) {
        return String(item.id) === String(id) ? res.identity : item;
      });
      writeSession(session);
      if (profiles[skel(session.account.handle)]) profiles[skel(session.account.handle)].identities = session.account.identities;
    });
  }
  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || el.getAttribute("data-acct") !== "media-vis") return;
    saveMedia({ id: el.getAttribute("data-id"), visibility: el.value });
  }, true);
  document.addEventListener("submit", function (event) {
    var formEl = event.target;
    if (!formEl || !formEl.closest || !formEl.closest("#account-layer")) return;
    event.preventDefault();
    if (formEl.id === "acct-login-form") doLogin();
    else if (formEl.id === "acct-save-form") finishPending();
    else if (formEl.id === "acct-recover-form") doRecover();
  }, true);
  document.addEventListener("input", function (event) {
    var el = event.target;
    if (el && el.closest && el.closest("[data-delete-form]")) {
      if (el.name === "accountNumber") {
        var digits = String(el.value || "").replace(/\D/g, "").slice(0, 16);
        el.value = grouped(digits);
        deleteState.accountNumber = digits;
      } else if (el.name === "confirmHandle") {
        deleteState.handle = el.value;
      }
      deleteState.error = "";
      var go = document.querySelector('[data-delete-form] [data-acct="delete-go"]');
      if (go) go.disabled = !deleteReady() || deleteState.busy;
      var err = el.closest("[data-delete-form]").querySelector(".acct-error");
      if (err) err.textContent = "";
      return;
    }
    if (el && (el.dataset.friendsSearch || el.classList.contains("friends-search-input"))) {
      friendsSearchQuery = el.value;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return;
    }
    if (!el || !el.closest || !el.closest("#account-layer") || !el.name) return;
    if (el.id === "acct-login-user") {
      var typed = String(el.value || "").replace(/\D/g, "").slice(0, 16);
      form.accountNumber = typed;
      var passEl = document.getElementById("acct-accountNumber");
      if (passEl) passEl.value = grouped(typed);
      return;
    }
    if (el.name === "accountNumber") {
      var digits = String(el.value || "").replace(/\D/g, "").slice(0, 16);
      el.value = grouped(digits);
      form.accountNumber = digits;
      var loginUser = document.getElementById("acct-login-user");
      if (loginUser) loginUser.value = digits;
      var numberCount = el.parentNode && el.parentNode.querySelector(".acct-count");
      if (numberCount) numberCount.textContent = fieldCount("accountNumber", digits, 16);
      return;
    }
    if (el.name === "cropZoom") {
      form.cropZoom = el.value;
      layoutCrop();
      return;
    }
    form[el.name] = el.value;
    if (el.name === "identityHandle") linkIdentityForm.handle = el.value;
    if (el.name === "identityProofUrl") linkIdentityForm.proofUrl = el.value;
    var count = el.parentNode && el.parentNode.querySelector(".acct-count");
    var max = Number(el.getAttribute("data-max") || 0);
    if (count && max) count.textContent = fieldCount(el.name, el.value, max);
  }, true);
  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.closest || !el.closest("#account-layer")) return;
    if (el.type === "file" && (el.name === "avatar" || el.name === "banner")) {
      var file = el.files && el.files[0];
      el.value = "";
      if (file) startCrop(file, el.name);
      return;
    }
    if (el.name === "identityPlatform") linkIdentityForm.platform = el.value;
    if (el.name === "saved") {
      form.saved = !!el.checked;
      var button = document.querySelector('#account-layer [data-acct="saved"]');
      if (button) button.disabled = !form.saved;
    }
  }, true);
  function checkUrlSession() {
    var hash = location.hash || "";
    var m = hash.match(/^#\/(?:session|restore)=([A-Za-z0-9+/=_-]+)/);
    if (!m) return false;
    try {
      var raw = decodeURIComponent(escape(atob(m[1])));
      var parsed = JSON.parse(raw);
      if (parsed && parsed.token && parsed.account) {
        history.replaceState(null, "", location.pathname + location.search + "#/");
        commitSession(parsed.token, parsed.account);
        return true;
      }
    } catch (e) {}
    return false;
  }
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    var el = event.target;
    if (!el || !el.closest || !el.closest("#account-layer")) return;
    if (el.tagName === "TEXTAREA") return;
    if (el.form && (el.form.id === "acct-login-form" || el.form.id === "acct-save-form" || el.form.id === "acct-recover-form")) return;
    event.preventDefault();
    if (view === "login") {
      doLogin();
    } else if (view === "emergency") {
      doEmergency();
    } else if (view === "restore") {
      doRestoreSession();
    } else if (view === "signup") {
      if (step === 2) finishPending();
      else nextSignup();
    }
  }, true);
  document.addEventListener("keydown", function (event) {
    var modal = document.querySelector("#account-layer .acct-modal");
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeAuth();
      return;
    }
    if (event.key !== "Tab") return;
    var items = Array.prototype.filter.call(modal.querySelectorAll("button, a[href], input, select, textarea"), function (el) {
      return !el.disabled && el.tabIndex !== -1 && el.getAttribute("aria-hidden") !== "true";
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !modal.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !modal.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }, true);
  window.addEventListener("hashchange", function () {
    if (deletedFlag() && !readSession()) {
      showDeleted();
      return;
    }
    if (checkUrlSession()) return;
    if (!blocking()) return;
    var hash = location.hash || "";
    if (hash && hash !== "#" && hash !== "#/") {
      try { sessionStorage.setItem(RETURN_KEY, hash); } catch (err) { /* home after sign-in */ }
      history.replaceState(null, "", location.pathname + location.search);
    }
    paint();
  });

  var mine = readSession();
  if (mine && mine.account) remember(mine.account);
  if (config().gate) {
    installFetch();
    tellSW(!!mine);
  } else {
    try {
      if (typeof fetch === "function") {
        nativeFetch("./accounts.config.js?_cb=" + Date.now(), { cache: "no-store" })
          .then(function (res) { return res.ok ? res.text() : ""; })
          .then(function (code) {
            if (/gate:\s*true/.test(code)) {
              try { (new Function(code))(); } catch (e) {}
              if (config().gate && !readSession()) {
                installFetch();
                enter();
                paint();
              }
            }
          }).catch(function () {});
      }
    } catch (e) {}
  }
  if (window.SI18n && window.SI18n.onChange) window.SI18n.onChange(function () { if (blocking() || view) paint(); });
  checkUrlSession();
  if (blocking()) enter();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      syncFollows();
      syncFriends();
    }
  });
  document.addEventListener("input", function (event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-graph-search]") : null;
    if (!el) return;
    setGraphQuery(el.dataset.graphId, el.dataset.graphTab, el.value);
  });

  window.ViktorychAccounts = {
    signOut: function () { logout(false); },
    uiSyncOn: function () { return uiSyncOn(); },
    deviceOwnUi: deviceOwnUi,
    setDeviceOwnUi: function (on) { setDeviceOwnUi(on); if (!on) pullSoon(); },
    mergePayload: mergePayload,
    snapshotFrom: snapshotFrom,
    blocking: blocking,
    enter: enter,
    currentApi: currentApi,
    apiEndpoints: apiEndpoints,
    rotateApi: rotateApi,
    hasApi: hasApi,
    profileHtml: profileHtml,
    pillInner: pillInner,
    drawerHead: drawerHead,
    settingsHtml: settingsHtml,
    privacyHtml: privacyHtml,
    deleteAccountHtml: deleteAccountHtml,
    showDeletedIfNeeded: showDeletedIfNeeded,
    onLocalChange: onLocalChange,
    bindProfileTabs: bindProfileTabs,
    tabMarquee: tabMarquee,
    nameRowHtml: nameRowHtml,
    profileTabPlan: profileTabPlan,
    onHistoryReady: onHistoryReady,
    requestRender: null,
    profilePostsHtml: null,
    call: api,
    setReposts: setReposts,
    ensureProfile: loadProfile,
    profilePending: profilePending,
    profileReady: profileReady,
    storedAccount: storedAccount,
    followButton: null,
    onServerFollows: null,
    onSignup: null,
    changeFollow: changeFollow,
    pressFollow: pressFollow,
    releaseFollow: releaseFollow,
    previewFollow: previewFollow,
    followControlHtml: followControlHtml,
    graphListHtml: graphListHtml,
    ensureFriendRequests: ensureFriendRequests,
    pendingFriendRequests: pendingFriendRequests,
    fitRequestPills: fitRequestPills,
    setGraphQuery: setGraphQuery,
    relationWrite: relationWrite,
    blockSet: function () {
      var ids = {};
      (relationCache.blocks || []).forEach(function (item) {
        var id = String(item.id || "");
        if (id) ids[id] = true;
      });
      return ids;
    },
    syncFollows: syncFollows,
    syncFriends: syncFriends,
    refreshFriends: refreshFriends,
    friendButton: friendButtonHtml,
    friendsSectionHtml: friendsSectionHtml,
    doFriendAction: doFriendAction,
    ensureFriends: ensureFriends,
    ensureCounts: ensureCounts,
    ensureList: ensureList,
    listPack: listPack,
    followersOf: followersOf,
    subjectForHandle: subjectForHandle,
    ownsSubject: viewerOwnsSubject,
    setPrivateFollows: setPrivateFollows,
    account: function () {
      var session = readSession();
      return session && session.account ? session.account : null;
    },
    token: function () {
      var session = readSession();
      return session && session.token ? session.token : "";
    },
    syncPlaybackAuth: function () {
      tellSW(!!readSession());
      return new Promise(function (resolve) {
        if (!navigator.serviceWorker) { resolve(false); return; }
        var timer = setTimeout(function () { resolve(false); }, 400);
        navigator.serviceWorker.ready.then(function (reg) {
          if (!reg.active) { clearTimeout(timer); resolve(false); return; }
          var channel = new MessageChannel();
          var session = readSession();
          channel.port1.onmessage = function () { clearTimeout(timer); resolve(true); };
          try {
            reg.active.postMessage({
              type: "auth",
              on: !!session,
              token: session && session.token ? session.token : ""
            }, [channel.port2]);
          } catch (err) {
            clearTimeout(timer);
            resolve(false);
          }
        }).catch(function () { clearTimeout(timer); resolve(false); });
      });
    },
    snapshotFrom: snapshotFrom,
    mergePayload: mergePayload,
    releaseNavLayout: releaseNavLayout,
    applySnapshot: applySnapshot,
    refreshToken: function () {
      var session = readSession();
      if (!session || !session.token || !hasApi()) return Promise.resolve("");
      return api("/v1/session/refresh", { method: "POST", token: session.token }).then(function (body) {
        if (!body || body.status !== 200 || !body.token) return "";
        session.token = body.token;
        if (body.account) session.account = body.account;
        writeSession(session);
        tellSW(true);
        return body.token;
      }).catch(function () { return ""; });
    }
  };
})();
