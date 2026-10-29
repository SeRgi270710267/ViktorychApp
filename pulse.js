/* Change signal. One small public file says which shared documents and the
   live list changed. One visible tab per device reads it every 20 seconds
   and shares the answer with the other tabs. Other code asks
   ViktorychPulse.version(name) and fetches a document again only when its
   mark moved, so quiet minutes cost no Worker requests.

   When the file cannot be read, ok() turns false and every caller falls
   back to its own timer. Nothing depends on the pulse being up. */
(function (root) {
  "use strict";
  if (root.ViktorychPulse) return;
  var DEFAULT_URL = "https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/pulse/v1.json";
  var LEASE = "viktorychapp-pulse-lease";
  var SAVED = "viktorychapp-pulse-doc";
  var EVERY_MS = 20000;
  var FRESH_MS = 90000;
  var ALIAS = { feeds: "feeds.json", config: "feeds.config.json", stories: "stories.json", people: "people.json", status: "status.json", music: "data/music.json", archive: "archive/index.json", discord: "discord/index.json", vk: "discord/vk.json" };
  var tab = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var doc = null;
  var seenAt = 0;
  var listeners = [];
  var timer = null;
  var failures = 0;
  var channel = null;
  try { channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("viktorych-pulse") : null; } catch (err) { channel = null; }

  function config() { return root.VIKTORYCH_ACCOUNTS || {}; }
  function hidden() { return typeof document !== "undefined" && document.visibilityState === "hidden"; }
  function signedIn() {
    try {
      var saved = JSON.parse(localStorage.getItem("viktorychapp-account-v1") || "null");
      return !!(saved && saved.token);
    } catch (err) { return false; }
  }
  function sourceUrl() {
    var c = config();
    if (c.pulse === false) return "";
    return String(c.pulse || DEFAULT_URL);
  }
  function workerUrl() {
    var api = String(config().api || "").replace(/\/$/, "");
    return api ? api + "/v1/pulse" : "";
  }
  function valid(next) {
    return !!(next && next.v === 1 && next.docs && typeof next.docs === "object");
  }
  function changedKeys(prev, next) {
    var out = [];
    if (!prev) return Object.keys(next.docs).concat(["live"]);
    Object.keys(next.docs).forEach(function (key) {
      if (prev.docs[key] !== next.docs[key]) out.push(key);
    });
    if (prev.live !== next.live) out.push("live");
    return out;
  }
  function apply(next, at, share) {
    if (!valid(next)) return;
    var keys = changedKeys(doc, next);
    var first = !doc;
    doc = next;
    seenAt = Math.max(seenAt, Number(at) || Date.now());
    if (share) {
      try { localStorage.setItem(SAVED, JSON.stringify({ at: seenAt, doc: next })); } catch (err) { /* other tabs read on their own */ }
      if (channel) { try { channel.postMessage({ at: seenAt, doc: next }); } catch (err) { /* ignore */ } }
    }
    if (first || !keys.length) return;
    listeners.slice().forEach(function (fn) {
      try { fn(keys); } catch (err) { /* one listener cannot stop the rest */ }
    });
  }
  function readSaved() {
    try {
      var saved = JSON.parse(localStorage.getItem(SAVED) || "null");
      if (saved && valid(saved.doc) && Date.now() - Number(saved.at || 0) < FRESH_MS) apply(saved.doc, saved.at, false);
    } catch (err) { /* nothing saved yet */ }
  }
  function lead(now) {
    try {
      var held = JSON.parse(localStorage.getItem(LEASE) || "null");
      if (held && held.id !== tab && Number(held.until) > now) return false;
      localStorage.setItem(LEASE, JSON.stringify({ id: tab, until: now + EVERY_MS * 2 }));
      return true;
    } catch (err) { return true; }
  }
  function drop() {
    try {
      var held = JSON.parse(localStorage.getItem(LEASE) || "null");
      if (held && held.id === tab) localStorage.removeItem(LEASE);
    } catch (err) { /* the lease runs out on its own */ }
  }
  function load() {
    var url = failures >= 3 && failures % 3 === 0 ? workerUrl() : sourceUrl();
    if (!url) url = sourceUrl();
    if (!url) return Promise.resolve(false);
    var full = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Math.floor(Date.now() / 10000);
    var fetcher = root.fetch;
    return fetcher(full, { cache: "no-store", credentials: "omit", mode: "cors" }).then(function (res) {
      if (!res || !res.ok) throw new Error("pulse " + (res && res.status));
      return res.json();
    }).then(function (next) {
      if (!valid(next)) throw new Error("pulse shape");
      failures = 0;
      apply(next, Date.now(), true);
      return true;
    }).catch(function () {
      failures += 1;
      return false;
    });
  }
  /* Save data checks three times less often. */
  function every() {
    var saver = typeof window !== "undefined" ? window.ViktorychDataSaver : null;
    return saver && saver.every ? saver.every(EVERY_MS) : EVERY_MS;
  }
  function wait() {
    if (!failures) return every() + Math.floor(Math.random() * 3000);
    var cap = Math.min(5 * 60 * 1000, EVERY_MS * Math.pow(2, Math.min(failures, 6)));
    return EVERY_MS + Math.floor(Math.random() * cap);
  }
  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }
  function tick() {
    timer = null;
    if (hidden()) { drop(); return; }
    if (!signedIn() || !sourceUrl()) { schedule(EVERY_MS * 3); return; }
    if (lead(Date.now())) load().then(function () { schedule(wait()); });
    else { readSaved(); schedule(every()); }
  }

  if (channel) {
    channel.onmessage = function (event) {
      var data = event && event.data;
      if (data && valid(data.doc)) apply(data.doc, data.at, false);
    };
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () {
      if (hidden()) { drop(); return; }
      readSaved();
      schedule(300);
    });
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", drop);
  }

  root.ViktorychPulse = {
    /* True while a pulse arrived in the last 90 seconds. */
    ok: function () { return !!doc && Date.now() - seenAt < FRESH_MS; },
    /* The mark for a document key (or a short alias), or "" when unknown. */
    version: function (name) {
      if (!doc || Date.now() - seenAt >= FRESH_MS) return "";
      if (name === "live") return String(doc.live || "");
      var key = ALIAS[name] || name;
      return String(doc.docs[key] || "");
    },
    /* fn(keys) runs when marks change; keys use the document names. */
    on: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    _apply: apply,
    _tick: tick
  };
  readSaved();
  if (!hidden()) schedule(1500);
})(typeof window !== "undefined" ? window : globalThis);
