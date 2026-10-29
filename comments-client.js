/* One comments client for every source.
   - Each source has an adapter that loads one page (about 20 top comments).
   - A request already in flight is shared, never sent twice.
   - Pages are kept for 10 minutes in memory and in IndexedDB (capped), so
     reopening a post is instant. Past 60 seconds the cached page is shown at
     once and refreshed in the background (stale-while-revalidate).
   - Every fetch carries an AbortSignal: leaving a post cancels its loads.
   - Prefetch runs only in idle time, never with Save data or on 2G/3G.
   Nothing here is sent anywhere or stored outside this device. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ViktorychComments = api;
})(typeof self !== "undefined" ? self : this, function () {
  var TTL_MS = 10 * 60 * 1000;
  var STALE_MS = 60 * 1000;
  var MEM_MAX = 80;
  var DB_MAX = 150;
  var DB_BYTES = 3 * 1024 * 1024;
  var PAGE = 20;

  function now() { return Date.now(); }

  function abortError() {
    var err = new Error("aborted");
    err.name = "AbortError";
    return err;
  }

  function isAbort(err) {
    return !!(err && (err.name === "AbortError" || err.aborted));
  }

  /* Network check shared by prefetch and image sizing. */
  function lowData(env) {
    var e = env || {};
    if (e.saveData) return true;
    var conn = e.connection;
    if (!conn && typeof navigator !== "undefined") conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.saveData) return true;
    var type = conn && conn.effectiveType;
    return type === "slow-2g" || type === "2g" || type === "3g";
  }

  function sizeOf(value) {
    try { return JSON.stringify(value).length; } catch (err) { return 0; }
  }

  function openDb(name) {
    return new Promise(function (resolve) {
      try {
        if (typeof indexedDB === "undefined" || !indexedDB) return resolve(null);
        var req = indexedDB.open(name, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("pages"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (err) { resolve(null); }
    });
  }

  function idbStore(name) {
    var dbp = null;
    function db() { return dbp || (dbp = openDb(name)); }
    function run(mode, fn) {
      return db().then(function (handle) {
        if (!handle) return null;
        return new Promise(function (resolve) {
          try {
            var tx = handle.transaction("pages", mode);
            var out = fn(tx.objectStore("pages"));
            tx.oncomplete = function () { resolve(out && "result" in out ? out.result : null); };
            tx.onerror = function () { resolve(null); };
            tx.onabort = function () { resolve(null); };
          } catch (err) { resolve(null); }
        });
      });
    }
    return {
      get: function (key) { return run("readonly", function (s) { return s.get(key); }); },
      put: function (key, row) { return run("readwrite", function (s) { s.put(row, key); }); },
      del: function (key) { return run("readwrite", function (s) { s.delete(key); }); },
      prune: function (max, bytes) {
        return db().then(function (handle) {
          if (!handle) return;
          return new Promise(function (resolve) {
            try {
              var tx = handle.transaction("pages", "readwrite");
              var store = tx.objectStore("pages");
              var rows = [];
              var cur = store.openCursor();
              cur.onsuccess = function () {
                var c = cur.result;
                if (c) { rows.push({ key: c.key, at: (c.value && c.value.at) || 0, bytes: (c.value && c.value.bytes) || 0 }); c.continue(); return; }
                var cutoff = now() - TTL_MS;
                rows.sort(function (a, b) { return b.at - a.at; });
                var total = 0;
                rows.forEach(function (row, i) {
                  total += row.bytes;
                  if (row.at < cutoff || i >= max || total > bytes) store.delete(row.key);
                });
              };
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { resolve(); };
            } catch (err) { resolve(); }
          });
        });
      }
    };
  }

  function create(opts) {
    var o = opts || {};
    var ttl = o.ttl || TTL_MS;
    var staleAfter = o.staleAfter || STALE_MS;
    var clock = o.now || now;
    var store = o.store === undefined ? idbStore(o.dbName || "viktorych-comments") : o.store;
    var mem = {};
    var order = [];
    var flight = {};
    var stats = {};
    var writes = 0;

    function stat(source) {
      return stats[source] || (stats[source] = { requests: 0, hits: 0, stale: 0, shared: 0, errors: 0, aborted: 0, bytes: 0, firstMs: [] });
    }

    function remember(key, row) {
      if (!mem[key]) order.push(key);
      mem[key] = row;
      while (order.length > MEM_MAX) delete mem[order.shift()];
    }

    function forget(key) {
      delete mem[key];
      var i = order.indexOf(key);
      if (i >= 0) order.splice(i, 1);
      if (store) store.del(key);
    }

    function persist(key, row) {
      if (!store) return;
      store.put(key, row);
      writes += 1;
      if (writes % 10 === 1) store.prune(DB_MAX, DB_BYTES);
    }

    /* Synchronous read of a page already in memory, for the first paint. */
    function peek(key) {
      var row = mem[key];
      if (!row || clock() - row.at > ttl) return null;
      return row;
    }

    function readCached(key) {
      var row = peek(key);
      if (row) return Promise.resolve(row);
      if (!store) return Promise.resolve(null);
      return store.get(key).then(function (hit) {
        if (!hit || !hit.at || clock() - hit.at > ttl) return null;
        remember(key, hit);
        return hit;
      }).catch(function () { return null; });
    }

    function fetchPage(key, loader, meta) {
      var source = meta.source || "other";
      var entry = flight[key];
      if (entry) {
        stat(source).shared += 1;
        entry.scopes[meta.scope || "view"] = true;
        return entry.promise;
      }
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var started = clock();
      entry = { ctrl: ctrl, scopes: {}, source: source };
      entry.scopes[meta.scope || "view"] = true;
      stat(source).requests += 1;
      entry.promise = Promise.resolve().then(function () {
        return loader({ signal: ctrl ? ctrl.signal : null, key: key });
      }).then(function (value) {
        if (ctrl && ctrl.signal.aborted) throw abortError();
        if (value == null) throw new Error("empty");
        var row = { at: clock(), value: value, bytes: sizeOf(value) };
        stat(source).bytes += row.bytes;
        stat(source).firstMs.push(clock() - started);
        remember(key, row);
        persist(key, row);
        return row;
      }).catch(function (err) {
        if (isAbort(err) || (ctrl && ctrl.signal.aborted)) { stat(source).aborted += 1; throw abortError(); }
        stat(source).errors += 1;
        throw err;
      }).finally(function () {
        if (flight[key] === entry) delete flight[key];
      });
      flight[key] = entry;
      return entry.promise;
    }

    /* get(key, loader, { source, scope, fresh, onUpdate }) resolves a row
       { at, value, stale }. A stale row resolves at once and onUpdate gets
       the fresh row when the background refresh lands. */
    function get(key, loader, meta) {
      var m = meta || {};
      if (m.fresh) return fetchPage(key, loader, m);
      return readCached(key).then(function (hit) {
        if (!hit) return fetchPage(key, loader, m);
        stat(m.source || "other").hits += 1;
        if (clock() - hit.at > staleAfter) {
          stat(m.source || "other").stale += 1;
          fetchPage(key, loader, m).then(function (row) {
            if (typeof m.onUpdate === "function") m.onUpdate(row);
          }).catch(function () {});
          return { at: hit.at, value: hit.value, stale: true };
        }
        return hit;
      });
    }

    /* Cancel every load that only this scope still wants. */
    function abortScope(scope) {
      Object.keys(flight).forEach(function (key) {
        var entry = flight[key];
        if (!entry || !entry.scopes[scope]) return;
        delete entry.scopes[scope];
        if (Object.keys(entry.scopes).length) return;
        if (entry.ctrl) entry.ctrl.abort();
        delete flight[key];
      });
    }

    function inFlight(key) { return !!flight[key]; }

    return {
      get: get,
      peek: peek,
      drop: forget,
      abortScope: abortScope,
      inFlight: inFlight,
      stats: function () { return JSON.parse(JSON.stringify(stats)); },
      page: PAGE
    };
  }

  /* Prefetch policy: idle time only, never on Save data or slow links. */
  function canPrefetch(env) {
    var e = env || {};
    if (lowData(e)) return false;
    if (e.hidden || (typeof document !== "undefined" && document.visibilityState === "hidden")) return false;
    return true;
  }

  function idle(fn, timeout) {
    if (typeof requestIdleCallback === "function") return requestIdleCallback(fn, { timeout: timeout || 2000 });
    return setTimeout(fn, 200);
  }

  /* Yield to the main thread between chunks of work. */
  function yieldNow() {
    if (typeof scheduler !== "undefined" && scheduler && typeof scheduler.yield === "function") return scheduler.yield();
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /* Merge one signal with a timeout; works where AbortSignal.any is missing. */
  function withTimeout(signal, ms) {
    if (typeof AbortController === "undefined") return signal || null;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 8000);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", function () { ctrl.abort(); }, { once: true });
    }
    ctrl.signal.addEventListener("abort", function () { clearTimeout(timer); }, { once: true });
    return ctrl.signal;
  }

  /* Smaller avatar URLs for data-saving mode. Unknown hosts are unchanged. */
  function smallAvatar(url, low) {
    var src = String(url || "");
    if (!src || !low) return src;
    if (/pbs\.twimg\.com\/profile_images\//.test(src)) return src.replace(/_(?:bigger|200x200|400x400|normal)(\.\w+)$/, "_mini$1");
    if (/(?:ggpht\.com|googleusercontent\.com)\//.test(src)) return src.replace(/=s\d+(-[^/?#]*)?$/, "=s32$1").replace(/\/s\d+-/, "/s32-");
    if (/cdn\.bsky\.app\/img\/avatar\//.test(src)) return src.replace("/img/avatar/", "/img/avatar_thumbnail/");
    return src;
  }

  return {
    create: create,
    canPrefetch: canPrefetch,
    lowData: lowData,
    idle: idle,
    yieldNow: yieldNow,
    withTimeout: withTimeout,
    smallAvatar: smallAvatar,
    isAbort: isAbort,
    TTL_MS: TTL_MS,
    STALE_MS: STALE_MS,
    PAGE: PAGE
  };
});
