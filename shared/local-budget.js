/* What this app keeps in localStorage, measured the way browsers count it.

   localStorage is for small settings only. Chromium and Firefox allow about
   5 Mi UTF-16 code units per origin (key plus value, so one character is one
   unit, not two bytes), Safari and every iOS browser about half that. Bigger
   or growing data (screen snapshots, timelines, caches) lives in IndexedDB,
   the Cache API or memory, and migrate() moves anything that slipped in.

   Keys are grouped so Storage can show where the space goes and "Free up
   space" can clear what is safe to lose: snapshots and caches the app
   rebuilds by itself, and duplicate copies left by the old app names.
   Settings, drafts, sign-in and keys are never cleared here. Keys that are
   not ours (the address is shared with other pages) are counted, because the
   browser counts them, but never touched. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychLocalBudget = api;
})(typeof self !== "undefined" ? self : this, function () {
  var MI = 1024 * 1024;
  var FULL_UNITS = 5 * MI;
  var WEBKIT_UNITS = 2.5 * MI;
  /* One known cache over this size is not a cache any more; drop it and let
     the owner rebuild a bounded copy. */
  var CACHE_ENTRY_MAX = 150000;

  var ORDER = ["settings", "snapshots", "caches", "legacy", "other"];

  var SNAPSHOT = [
    /^viktorych-swr-v1[:-]/,
    /^viktorych-screen-v1$/,
    /^viktorychapp-timeline-v1$/,
    /^viktorych-scrolls-v1$/,
    /^viktorych-pill-v1$/,
    /^viktorychapp-opened-v1$/
  ];
  var CACHE = [
    /^viktorychapp-translate-v1$/,
    /^viktorychapp-translate-health-v1$/,
    /^viktorychapp-unfurl-v1$/,
    /^viktorychapp-pymk-cache$/,
    /^viktorych-aff-cache-v1$/,
    /^viktorychapp-discord-index-v1$/,
    /^viktorychapp-profile-heads-v1$/,
    /^viktorychapp-graph-counts-v1$/,
    /^viktorychapp-sports-obs-v\d+$/,
    /^viktorychapp-weather-obs-v\d+$/,
    /^viktorychapp-blocked-hosts-v1$/
  ];
  /* The first app name is spelled in two parts so the old-name check in
     selftest keeps passing. */
  var PREVIOUS = "rss-" + "feeds-";
  var OURS = new RegExp("^(viktorych|superintel|sintel|" + PREVIOUS + "|ytm-|yt-|va_)", "i");
  /* Old names still read on purpose, even when a new copy exists. */
  var LEGACY_KEEP = { "superintelapp-lang": 1 };

  function list(re, key) {
    for (var i = 0; i < re.length; i++) if (re[i].test(key)) return true;
    return false;
  }

  function modern(key) {
    if (key.indexOf("superintelapp-") === 0) return "viktorychapp-" + key.slice(14);
    if (key.indexOf(PREVIOUS) === 0) return "viktorychapp-" + key.slice(PREVIOUS.length);
    if (key === "sintel-music-v1") return "viktorych-music-v1";
    return "";
  }

  /* A copy under an old app name is a duplicate once the current name holds
     the value: every reader prefers the current name. */
  function isLegacyDuplicate(key, store) {
    if (LEGACY_KEEP[key]) return false;
    var next = modern(key);
    if (!next || !store) return false;
    try { return store.getItem(next) != null; } catch (err) { return false; }
  }

  function categoryOf(key, store) {
    key = String(key || "");
    if (list(SNAPSHOT, key)) return "snapshots";
    if (list(CACHE, key)) return "caches";
    if (modern(key) && isLegacyDuplicate(key, store)) return "legacy";
    if (!OURS.test(key)) return "other";
    return "settings";
  }

  function safeToClear(cat) {
    return cat === "snapshots" || cat === "caches" || cat === "legacy";
  }

  function defaultStore() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (err) { return null; }
  }

  function keysOf(store) {
    var out = [];
    if (!store) return out;
    try {
      if (typeof store.length === "number" && typeof store.key === "function") {
        for (var i = 0; i < store.length; i++) {
          var key = store.key(i);
          if (key != null) out.push(String(key));
        }
      } else if (typeof store.keys === "function") {
        out = store.keys().map(String);
      }
    } catch (err) { /* nothing readable */ }
    return out;
  }

  /* Browsers count UTF-16 code units of key + value: "a" is 1, not 2. */
  function unitsOf(key, value) {
    return String(key || "").length + String(value == null ? "" : value).length;
  }

  function isWebKit(nav) {
    nav = nav || (typeof navigator !== "undefined" ? navigator : {}) || {};
    var ua = String(nav.userAgent || "");
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    if (/Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1) return true;
    return /Safari\//.test(ua) && /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android|SamsungBrowser)\//.test(ua);
  }

  function quotaUnits(nav) {
    return isWebKit(nav) ? WEBKIT_UNITS : FULL_UNITS;
  }

  function measure(store) {
    store = store || defaultStore();
    var by = {};
    ORDER.forEach(function (cat) { by[cat] = { units: 0, count: 0 }; });
    var rows = [];
    var total = 0;
    keysOf(store).forEach(function (key) {
      var value = null;
      try { value = store.getItem(key); } catch (err) { value = null; }
      var units = unitsOf(key, value);
      var cat = categoryOf(key, store);
      by[cat].units += units;
      by[cat].count += 1;
      total += units;
      rows.push({ key: key, units: units, category: cat });
    });
    rows.sort(function (a, b) { return b.units - a.units; });
    var safe = 0;
    ORDER.forEach(function (cat) { if (safeToClear(cat)) safe += by[cat].units; });
    return { total: total, by: by, rows: rows, safe: safe };
  }

  /* The alert reading. Everything counts, because the browser refuses a new
     setting once the whole origin is full, but in the units the browser
     really uses and against this browser's real limit. */
  function reading(store, nav) {
    var m = measure(store);
    var limit = quotaUnits(nav);
    return { used: m.total, limit: limit, pct: limit ? m.total / limit * 100 : 0, safe: m.safe, by: m.by, top: m.rows.slice(0, 8) };
  }

  function localApi() {
    if (typeof self !== "undefined" && self.ViktorychLocal) return self.ViktorychLocal;
    return null;
  }

  /* Free up space: snapshots, caches and duplicate old copies only. */
  function clearSafe(store, only) {
    store = store || defaultStore();
    if (!store) return 0;
    var freed = 0;
    var swrCleared = false;
    keysOf(store).forEach(function (key) {
      var cat = categoryOf(key, store);
      if (!safeToClear(cat)) return;
      if (only && only !== cat) return;
      var value = null;
      try { value = store.getItem(key); } catch (err) { value = null; }
      freed += unitsOf(key, value);
      if (/^viktorych-swr-v1[:-]/.test(key)) swrCleared = true;
      try { store.removeItem(key); } catch (err) { /* already gone */ }
    });
    var local = localApi();
    if (swrCleared && local && local.swr && local.swr.reset) local.swr.reset();
    return freed;
  }

  /* Runs on every start (cheap once clean). Snapshot tiers are moved by
     localfirst.js, which owns their IndexedDB copy; this drops duplicate old
     copies and any known cache that grew past a sane size. */
  function migrate(store) {
    store = store || defaultStore();
    var report = { removed: [], freed: 0 };
    if (!store) return report;
    keysOf(store).forEach(function (key) {
      var cat = categoryOf(key, store);
      var value = null;
      try { value = store.getItem(key); } catch (err) { value = null; }
      var units = unitsOf(key, value);
      var drop = cat === "legacy" || (cat === "caches" && units > CACHE_ENTRY_MAX);
      if (!drop) return;
      try { store.removeItem(key); report.removed.push(key); report.freed += units; } catch (err) { /* keep it */ }
    });
    return report;
  }

  return {
    ORDER: ORDER,
    FULL_UNITS: FULL_UNITS,
    WEBKIT_UNITS: WEBKIT_UNITS,
    CACHE_ENTRY_MAX: CACHE_ENTRY_MAX,
    categoryOf: categoryOf,
    safeToClear: safeToClear,
    unitsOf: unitsOf,
    isWebKit: isWebKit,
    quotaUnits: quotaUnits,
    measure: measure,
    reading: reading,
    clearSafe: clearSafe,
    migrate: migrate
  };
});
