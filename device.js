/* Device performance. Balanced is the default: public reads, search, thumbnails,
   translation, storage, and background refresh run on this device when it can
   do them. WebLLM stays off until Max and an explicit download warning.
   Every local path has a short timeout and a silent server fallback.
   Stats stay on this device and are not part of the account sync payload. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychDevice = api;
  if (typeof document !== "undefined") api.start();
})(typeof self !== "undefined" ? self : this, function () {
  var FEATURES = ["direct", "search", "translate", "ai", "media", "record", "storage", "sync"];
  var HEAVY = { direct: 1, search: 1, translate: 1, ai: 1, media: 1, record: 1, sync: 1 };
  var PRESETS = {
    light: { direct: false, search: false, translate: false, ai: false, media: false, record: false, storage: true, sync: false, wifiOnly: true, pauseBattery: true },
    balanced: { direct: true, search: true, translate: true, ai: true, media: true, record: true, storage: true, sync: true, wifiOnly: false, pauseBattery: true },
    max: { direct: true, search: true, translate: true, ai: true, media: true, record: true, storage: true, sync: true, wifiOnly: false, pauseBattery: false }
  };
  var TIMEOUT_MS = 1800;
  var FAIL_TTL = 10 * 60 * 1000;
  var OK_TTL = 30 * 60 * 1000;
  var LOW_BATTERY = 0.2;
  var MB = 1024 * 1024;
  var GB = 1024 * MB;
  var CAPS = { light: 256 * MB, balanced: 1 * GB, max: 5 * GB };
  var LAZY = {
    search: "device-search.js",
    ai: "device-ai.js",
    ondevice: "ondevice-ai.js",
    media: "device-media.js",
    record: "device-record.js"
  };
  var AI_KEYS = ["detect", "spam", "summarize", "compose", "semantic"];
  var AI_PRESETS = {
    light: { detect: false, spam: false, summarize: false, compose: false, semantic: false },
    balanced: { detect: true, spam: true, summarize: true, compose: true, semantic: false },
    max: { detect: true, spam: true, summarize: true, compose: true, semantic: false }
  };
  var AI_MB = 1024 * 1024;
  var AI_SIZES = {
    translateLocal: Math.round(52.9 * AI_MB) + Math.round(60.2 * AI_MB),
    semanticLocal: 23 * AI_MB,
    webllm: Math.round(1128.82 * AI_MB)
  };
  var STORE_KEY = "viktorychapp-device-performance-v1";
  var STATS_KEY = "viktorychapp-device-stats-v1";
  var MEMORY_KEY = "viktorychapp-device-memory-v1";
  var memory = { feature: {}, source: {} };
  var statsMem = null;
  var loads = {};
  var warn = false;
  var assistant = false;
  var batterySnap = null;

  function tr(key, vars) {
    var fn = null;
    if (typeof self !== "undefined" && self.t) fn = self.t;
    if (!fn && typeof window !== "undefined" && window.t) fn = window.t;
    if (!fn) {
      return String(key).replace(/\{(\w+)\}/g, function (_, name) {
        return vars && vars[name] != null ? String(vars[name]) : "";
      });
    }
    return fn(key, vars);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function emptyFeature() {
    return { local: 0, worker: 0, localBytes: 0, workerBytes: 0, savedBytes: 0, localMs: 0, workerMs: 0, savedMs: 0 };
  }

  function emptyStats() {
    var out = { features: {} };
    FEATURES.forEach(function (id) { out.features[id] = emptyFeature(); });
    return out;
  }

  function mergeStats(raw) {
    var out = emptyStats();
    var src = raw && raw.features;
    if (!src) return out;
    FEATURES.forEach(function (id) {
      var row = src[id] || {};
      var dest = out.features[id];
      Object.keys(dest).forEach(function (key) { dest[key] = Math.max(0, Number(row[key]) || 0); });
    });
    return out;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch (err) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { /* private mode keeps the memory copy */ }
  }

  function sessionGet(key) {
    try { return sessionStorage.getItem(key); }
    catch (err) { return null; }
  }

  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, value); }
    catch (err) { /* the memory copy still applies this session */ }
  }

  function loadStats() {
    if (statsMem) return statsMem;
    statsMem = emptyStats();
    try {
      var raw = storageGet(STATS_KEY);
      if (raw) statsMem = mergeStats(JSON.parse(raw));
    } catch (err) { statsMem = emptyStats(); }
    return statsMem;
  }

  function saveStats(all) {
    statsMem = all;
    storageSet(STATS_KEY, JSON.stringify(all));
  }

  function loadMemory() {
    try {
      var raw = sessionGet(MEMORY_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.feature) memory.feature = parsed.feature;
      if (parsed && parsed.source) memory.source = parsed.source;
    } catch (err) { /* start with an empty memory */ }
  }

  function persistMemory() {
    var keys = Object.keys(memory.source);
    if (keys.length > 200) {
      keys.sort(function (a, b) { return (memory.source[a].at || 0) - (memory.source[b].at || 0); });
      keys.slice(0, keys.length - 200).forEach(function (key) { delete memory.source[key]; });
    }
    sessionSet(MEMORY_KEY, JSON.stringify({ feature: memory.feature, source: memory.source }));
  }

  function preset(level) {
    return PRESETS[level] || PRESETS.balanced;
  }

  function levelFor(raw) {
    var src = raw && typeof raw === "object" ? raw : { level: raw };
    var text = String(src.level || src.profile || src.performance || src.mode || "balanced").toLowerCase();
    if (text === "max" || text === "high" || text === "full") return "max";
    if (text === "light" || text === "lite" || text === "low" || text === "saver" || text === "battery") return "light";
    return "balanced";
  }

  function profileFor(level) {
    return level === "light" ? "lite" : (level === "max" ? "max" : "balanced");
  }

  function peerFields(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var mode = raw.peerMedia === "on" || raw.peerMedia === true ? "on" : (raw.peerMedia === "off" || raw.peerMedia === false ? "off" : "auto");
    var cap = Number(raw.peerUploadCap) || 0;
    var caps = [32768, 65536, 131072, 262144];
    return {
      peerMedia: mode,
      peerUploadCap: caps.indexOf(cap) >= 0 ? cap : 65536,
      peerShareWhileWatching: raw.peerShareWhileWatching !== false
    };
  }

  function aiPreset(level) {
    return AI_PRESETS[level] || AI_PRESETS.balanced;
  }

  function aiFeaturesFor(raw, level) {
    var base = aiPreset(level);
    var src = raw && raw.aiFeatures && typeof raw.aiFeatures === "object" ? raw.aiFeatures : {};
    var out = {};
    AI_KEYS.forEach(function (id) {
      out[id] = typeof src[id] === "boolean" ? src[id] : !!base[id];
    });
    out.translateLocal = src.translateLocal === true;
    out.semanticLocal = src.semanticLocal === true;
    out.dmServer = src.dmServer === true;
    out.dmAuto = src.dmAuto === true;
    return out;
  }

  function normalize(raw) {
    raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var level = levelFor(raw);
    var base = preset(level);
    var toggles = {};
    var src = raw.toggles && typeof raw.toggles === "object" ? raw.toggles : null;
    var peer = peerFields(raw);
    FEATURES.forEach(function (id) {
      toggles[id] = src && typeof src[id] === "boolean" ? src[id] : !!base[id];
    });
    return {
      level: level,
      profile: profileFor(level),
      toggles: toggles,
      wifiOnly: typeof raw.wifiOnly === "boolean" ? raw.wifiOnly : !!base.wifiOnly,
      pauseBattery: typeof raw.pauseBattery === "boolean" ? raw.pauseBattery : !!base.pauseBattery,
      autoLight: raw.autoLight !== false,
      webllm: raw.webllm === true,
      webllmAccepted: raw.webllmAccepted === true,
      aiFeatures: aiFeaturesFor(raw, level),
      peerMedia: peer.peerMedia,
      peerUploadCap: peer.peerUploadCap,
      peerShareWhileWatching: peer.peerShareWhileWatching
    };
  }

  function mergedRaw(settings) {
    return Object.assign({}, read(), settings || {});
  }

  function applyLevel(level, previous) {
    var prev = normalize(mergedRaw(previous));
    var next = normalize({ level: levelFor({ level: level }) });
    next.webllm = false;
    next.webllmAccepted = false;
    next.aiFeatures.translateLocal = false;
    next.aiFeatures.semanticLocal = false;
    next.aiFeatures.dmServer = !!(prev.aiFeatures && prev.aiFeatures.dmServer);
    next.aiFeatures.dmAuto = !!(prev.aiFeatures && prev.aiFeatures.dmAuto);
    next.peerMedia = prev.peerMedia;
    next.peerUploadCap = prev.peerUploadCap;
    next.peerShareWhileWatching = prev.peerShareWhileWatching;
    next.profile = profileFor(next.level);
    return next;
  }

  function toggle(settings, key) {
    var next = normalize(mergedRaw(settings));
    if (key === "wifiOnly" || key === "pauseBattery" || key === "autoLight") {
      next[key] = !next[key];
      return next;
    }
    if (FEATURES.indexOf(key) >= 0) next.toggles[key] = !next.toggles[key];
    return next;
  }

  function toggleAi(settings, key) {
    var next = normalize(mergedRaw(settings));
    var known = AI_KEYS.concat(["translateLocal", "semanticLocal", "dmServer", "dmAuto"]);
    if (known.indexOf(key) >= 0) next.aiFeatures[key] = !next.aiFeatures[key];
    return next;
  }

  function aiFeatureOn(settings, id, signals) {
    if (AI_KEYS.indexOf(id) < 0) return false;
    var next = normalize(settings);
    if (next.autoLight && isWeak(signals) && !aiPreset("light")[id]) return false;
    if ((id === "summarize" || id === "compose" || id === "semantic") && heavyPaused(next, signals)) return false;
    if ((id === "summarize" || id === "compose" || id === "semantic") && !next.toggles.ai) return false;
    return !!next.aiFeatures[id];
  }

  function confirmWebllm(settings, accept) {
    var next = normalize(mergedRaw(settings));
    if (next.level !== "max" || !accept) {
      next.webllm = false;
      next.webllmAccepted = false;
      return next;
    }
    next.webllm = true;
    next.webllmAccepted = true;
    return next;
  }

  function syncShape(raw) {
    var next = normalize(mergedRaw(raw));
    return {
      level: next.level,
      profile: next.profile,
      toggles: next.toggles,
      wifiOnly: next.wifiOnly,
      pauseBattery: next.pauseBattery,
      autoLight: next.autoLight,
      webllm: next.webllm === true && next.webllmAccepted === true,
      webllmAccepted: next.webllmAccepted === true,
      aiFeatures: next.aiFeatures,
      peerMedia: next.peerMedia,
      peerUploadCap: next.peerUploadCap,
      peerShareWhileWatching: next.peerShareWhileWatching
    };
  }

  function patch(raw, update) {
    var base = normalize(raw);
    var next = update && typeof update === "object" ? update : {};
    if (next.level != null || next.profile != null || next.performance != null || next.mode != null) {
      base.level = levelFor({ level: next.level, profile: next.profile, performance: next.performance, mode: next.mode });
      base.profile = profileFor(base.level);
    }
    if (next.peerMedia != null || next.peerUploadCap != null || typeof next.peerShareWhileWatching === "boolean") {
      var peer = peerFields({
        peerMedia: next.peerMedia != null ? next.peerMedia : base.peerMedia,
        peerUploadCap: next.peerUploadCap != null ? next.peerUploadCap : base.peerUploadCap,
        peerShareWhileWatching: typeof next.peerShareWhileWatching === "boolean" ? next.peerShareWhileWatching : base.peerShareWhileWatching
      });
      base.peerMedia = peer.peerMedia;
      base.peerUploadCap = peer.peerUploadCap;
      base.peerShareWhileWatching = peer.peerShareWhileWatching;
    }
    if (next.toggles && typeof next.toggles === "object") {
      FEATURES.forEach(function (id) {
        if (typeof next.toggles[id] === "boolean") base.toggles[id] = next.toggles[id];
      });
    }
    ["wifiOnly", "pauseBattery", "autoLight", "webllm", "webllmAccepted"].forEach(function (key) {
      if (typeof next[key] === "boolean") base[key] = next[key];
    });
    if (next.aiFeatures && typeof next.aiFeatures === "object") {
      AI_KEYS.concat(["translateLocal", "semanticLocal", "dmServer", "dmAuto"]).forEach(function (id) {
        if (typeof next.aiFeatures[id] === "boolean") base.aiFeatures[id] = next.aiFeatures[id];
      });
    }
    base.profile = profileFor(base.level);
    return base;
  }

  function signalsFrom(nav) {
    nav = nav || {};
    var conn = nav.connection || {};
    var type = String(conn.type || "");
    var onWifi = null;
    if (type) onWifi = type === "wifi" || type === "ethernet" || type === "wimax";
    if (conn.saveData) onWifi = false;
    var battery = nav.battery == null || nav.battery === "" ? null : Number(nav.battery);
    if (battery != null && !isFinite(battery)) battery = null;
    return {
      deviceMemory: Number(nav.deviceMemory) || 0,
      hardwareConcurrency: Number(nav.hardwareConcurrency) || 0,
      saveData: !!conn.saveData,
      onWifi: onWifi,
      battery: battery,
      charging: nav.charging == null ? null : !!nav.charging
    };
  }

  function isWeak(signals) {
    var row = signals || {};
    if (row.saveData) return true;
    if (row.deviceMemory && row.deviceMemory < 4) return true;
    if (row.hardwareConcurrency && row.hardwareConcurrency < 4) return true;
    return false;
  }

  function effectiveLevel(settings, signals) {
    var next = normalize(settings);
    if (next.autoLight && isWeak(signals)) return "light";
    return next.level;
  }

  function heavyPaused(settings, signals) {
    var next = normalize(settings);
    var row = signals || {};
    if (next.wifiOnly && row.onWifi === false) return true;
    if (next.pauseBattery && row.battery != null && row.battery < LOW_BATTERY && row.charging !== true) return true;
    return false;
  }

  function featureOn(settings, id, signals) {
    if (FEATURES.indexOf(id) < 0) return false;
    var next = normalize(settings);
    if (next.autoLight && isWeak(signals) && !preset("light")[id]) return false;
    if (HEAVY[id] && heavyPaused(next, signals)) return false;
    return !!next.toggles[id];
  }

  function webllmAllowed(settings, signals) {
    var next = normalize(settings);
    if (next.level !== "max" || effectiveLevel(next, signals) !== "max") return false;
    if (!next.webllm || !next.webllmAccepted) return false;
    return featureOn(next, "ai", signals);
  }

  function read() {
    var fromKey = {};
    var fromSettings = {};
    try {
      var stored = storageGet(STORE_KEY);
      if (stored) fromKey = JSON.parse(stored);
    } catch (err) { fromKey = {}; }
    if (!fromKey || typeof fromKey !== "object" || Array.isArray(fromKey)) fromKey = {};
    try {
      if (typeof window !== "undefined" && window.STATE && window.STATE.settings && window.STATE.settings.devicePerf && typeof window.STATE.settings.devicePerf === "object") {
        fromSettings = window.STATE.settings.devicePerf;
      } else {
        var raw = storageGet("viktorychapp-settings-v1");
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.devicePerf && typeof parsed.devicePerf === "object") fromSettings = parsed.devicePerf;
        }
      }
    } catch (err) { fromSettings = {}; }
    if (!fromSettings || typeof fromSettings !== "object" || Array.isArray(fromSettings)) fromSettings = {};
    return normalize(Object.assign({}, fromSettings, fromKey));
  }

  function persist(settings) {
    var shape = syncShape(settings);
    storageSet(STORE_KEY, JSON.stringify(shape));
    return normalize(shape);
  }

  function batteryAllowed() {
    try {
      var raw = storageGet("viktorychapp-settings-v1");
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed.privacyAntiFingerprint === false;
    } catch (err) { return false; }
  }

  function signals() {
    var nav = typeof navigator !== "undefined" ? navigator : {};
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    return signalsFrom({
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      connection: conn,
      battery: batterySnap ? batterySnap.level : null,
      charging: batterySnap ? batterySnap.charging : null
    });
  }

  function rememberFail(feature, source, now, scope) {
    now = now || Date.now();
    scope = scope || "both";
    if ((scope === "feature" || scope === "both") && feature) memory.feature[feature] = now;
    if ((scope === "source" || scope === "both") && source) memory.source[source] = { at: now, ok: false };
    persistMemory();
  }

  function rememberOk(source, now) {
    if (!source) return;
    memory.source[source] = { at: now || Date.now(), ok: true };
    persistMemory();
  }

  function cooling(feature, now, ttl) {
    var at = memory.feature[feature];
    if (!at) return false;
    return (now || Date.now()) - at < (ttl || FAIL_TTL);
  }

  function sourceState(source, now) {
    var row = source ? memory.source[source] : null;
    if (!row) return "";
    var age = (now || Date.now()) - row.at;
    if (row.ok) return age < OK_TTL ? "ok" : "";
    return age < FAIL_TTL ? "fail" : "";
  }

  function scopeOf(err) {
    var msg = String((err && ((err.name || "") + " " + (err.message || ""))) || err || "").toLowerCase();
    if (/quota|unsupported|notsupported|referenceerror|securityerror/.test(msg)) return "feature";
    if (/timeout|cors|network|failed to fetch|status|empty|invalid|abort/.test(msg)) return "source";
    return "both";
  }

  function isBad(value, valid) {
    if (typeof valid === "function") return !valid(value);
    if (value == null || value === "") return true;
    if (typeof value === "number" && !isFinite(value)) return true;
    return false;
  }

  function measureBytes(value) {
    if (value == null) return 0;
    if (typeof value === "string") return value.length;
    if (typeof value.byteLength === "number") return value.byteLength;
    if (typeof value.size === "number" && typeof value !== "object") return value.size;
    try { return JSON.stringify(value).length; }
    catch (err) { return 0; }
  }

  function noteStat(kind, feature, bytes, ms) {
    if (FEATURES.indexOf(feature) < 0) return loadStats();
    var all = loadStats();
    var row = all.features[feature];
    bytes = Math.max(0, Number(bytes) || 0);
    ms = Math.max(0, Number(ms) || 0);
    if (kind === "local") {
      row.local += 1;
      row.localBytes += bytes;
      row.localMs += ms;
      row.savedBytes += bytes;
      if (row.worker > 0) {
        var avg = row.workerMs / row.worker;
        if (avg > ms) row.savedMs += avg - ms;
      }
    } else {
      row.worker += 1;
      row.workerBytes += bytes;
      row.workerMs += ms;
    }
    saveStats(all);
    return all;
  }

  function totals(all) {
    var sum = emptyFeature();
    var src = (all || loadStats()).features;
    FEATURES.forEach(function (id) {
      var row = src[id] || emptyFeature();
      Object.keys(sum).forEach(function (key) { sum[key] += row[key] || 0; });
    });
    return sum;
  }

  function withTimeout(promise, ms) {
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        var err = new Error("timeout");
        err.code = "timeout";
        reject(err);
      }, ms);
    });
    return Promise.race([
      Promise.resolve(promise).then(function (value) {
        clearTimeout(timer);
        return value;
      }, function (err) {
        clearTimeout(timer);
        throw err;
      }),
      timeout
    ]);
  }

  function runLocal(feature, source, localFn, serverFn, opts) {
    opts = opts || {};
    var settings = opts.settings || {};
    var signals = opts.signals || {};
    var now = opts.now || Date.now();
    var timeout = opts.timeout == null ? TIMEOUT_MS : opts.timeout;
    function useServer() {
      var started = Date.now();
      return Promise.resolve().then(serverFn).then(function (value) {
        if (isBad(value, opts.valid)) {
          var err = new Error("both");
          err.both = true;
          throw err;
        }
        var ms = opts.serverMs != null ? opts.serverMs : Math.max(0, Date.now() - started);
        noteStat("worker", feature, measureBytes(value), ms);
        return { via: "worker", value: value, error: false };
      }, function (err) {
        if (!err || typeof err !== "object") err = new Error("both");
        err.both = true;
        throw err;
      });
    }
    var enabled = opts.forceLocal ? true : featureOn(settings, feature, signals);
    var skip = !enabled || cooling(feature, now, opts.failTtl) || sourceState(source, now) === "fail";
    if (skip) return useServer();
    var started = Date.now();
    var localPromise;
    try { localPromise = Promise.resolve().then(localFn); }
    catch (err) { localPromise = Promise.reject(err); }
    return withTimeout(localPromise, timeout).then(function (value) {
      if (isBad(value, opts.valid)) throw new Error("invalid");
      rememberOk(source, now);
      var ms = opts.localMs != null ? opts.localMs : Math.max(0, Date.now() - started);
      noteStat("local", feature, measureBytes(value), ms);
      return { via: "device", value: value, error: false };
    }).catch(function (err) {
      if (opts.abort) { try { opts.abort(); } catch (ignore) { /* the request may already be done */ } }
      rememberFail(feature, source, now, opts.scope || scopeOf(err));
      return useServer();
    });
  }

  function planFetch(url, settings, signals, now) {
    var host = "";
    try { host = new URL(String(url || "")).hostname; }
    catch (err) { host = ""; }
    if (!featureOn(settings, "direct", signals)) return { where: "worker", why: "off", host: host };
    if (cooling("direct", now) || sourceState(host, now) === "fail") return { where: "worker", why: "cooldown", host: host };
    return { where: "device", why: "direct", host: host };
  }

  function playbackUrl(direct, relay, opts) {
    opts = opts || {};
    var settings = opts.settings;
    var signals = opts.signals;
    if (opts.preferRelay && relay) return relay;
    if (settings && !featureOn(settings, "media", signals)) return direct || relay || "";
    var state = sourceState(direct || "", opts.now);
    if (state === "fail" && relay) return relay;
    return direct || relay || "";
  }

  function capBytes(level) {
    return CAPS[level] || CAPS.balanced;
  }

  function capForPolicy() {
    var next = read();
    if (!featureOn(next, "storage", signals())) return 0;
    return capBytes(effectiveLevel(next, signals()));
  }

  function evictLru(rows, cap) {
    var pinned = [];
    var pool = [];
    (rows || []).forEach(function (row) {
      if (!row) return;
      var item = { id: row.id, bytes: Math.max(0, Number(row.bytes) || 0), at: Number(row.at) || 0, keep: !!row.keep, row: row };
      if (item.keep) pinned.push(item);
      else pool.push(item);
    });
    pool.sort(function (a, b) { return a.at - b.at; });
    var total = 0;
    pinned.concat(pool).forEach(function (item) { total += item.bytes; });
    var dropped = [];
    while (cap && total > cap && pool.length) {
      var old = pool.shift();
      total -= old.bytes;
      dropped.push(old.row);
    }
    return { keep: pinned.concat(pool).map(function (item) { return item.row; }), drop: dropped, total: total };
  }

  function formatBytes(n) {
    n = Math.max(0, Number(n) || 0);
    if (n < 1024) return Math.round(n) + " B";
    if (n < MB) return (n / 1024).toFixed(1) + " KB";
    if (n < GB) return (n / MB).toFixed(1) + " MB";
    return (n / GB).toFixed(2) + " GB";
  }

  function formatMs(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n < 1000) return n + " ms";
    return (n / 1000).toFixed(1) + " s";
  }

  function ensure(name) {
    var src = LAZY[name];
    if (!src || typeof document === "undefined") return Promise.resolve();
    if (loads[name]) return loads[name];
    loads[name] = new Promise(function (resolve) {
      var done = function () { resolve(); };
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        var host = typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : {});
        var ready = existing.getAttribute("data-loaded") === "1";
        if (!ready && name === "ondevice" && host.ViktorychOnDeviceAi) ready = true;
        if (!ready && name === "ai" && host.ViktorychDeviceAi) ready = true;
        if (ready) { done(); return; }
        existing.addEventListener("load", done);
        existing.addEventListener("error", done);
        return;
      }
      var tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.onload = function () { tag.setAttribute("data-loaded", "1"); done(); };
      tag.onerror = done;
      (document.body || document.documentElement).appendChild(tag);
    });
    return loads[name];
  }

  function labels() {
    return {
      direct: [tr("Fetch feeds on this device"), tr("Public feeds that allow it load here first. The server is the backup."), tr("Direct fetches")],
      search: [tr("Search on this device"), tr("Search uses posts already on this device. The server is used only for the rest."), tr("Local search")],
      translate: [tr("Translate on this device"), tr("Use the browser translator when it is available. The current translation path is the backup."), tr("Translation")],
      ai: [tr("On-device assistant"), tr("The browser model goes first. A cloud provider runs only when you add one. No paid API is built in."), tr("Assistant runs")],
      media: [tr("Local thumbnails"), tr("Previews are made here from the original. Playback tries the source before the relay."), tr("Thumbnails")],
      record: [tr("Record on this device"), tr("Recordings are split here. Video and audio keep their original quality. Only notes are compressed."), tr("Recordings")],
      storage: [tr("Keep storage on this device"), tr("Ask the browser to keep saved posts. The oldest saved files are removed at the limit."), tr("Saved storage")],
      sync: [tr("Refresh in the background"), tr("Feeds can refresh while the app is closed, when the browser allows it."), tr("Background refresh")]
    };
  }

  function switchRow(key, on) {
    var copy = labels()[key];
    return '<button class="tab-switch device-switch' + (on ? " on" : "") + '" type="button" role="switch" aria-checked="' + (on ? "true" : "false") + '" data-act="device-toggle" data-key="' + key + '"><span><b>' + esc(copy[0]) + '</b><span class="set-sub">' + esc(copy[1]) + "</span></span><i></i></button>";
  }

  function flagRow(key, on, title, sub, act) {
    return '<button class="tab-switch device-switch' + (on ? " on" : "") + '" type="button" role="switch" aria-checked="' + (on ? "true" : "false") + '" data-act="' + (act || "device-toggle") + '" data-key="' + key + '"><span><b>' + esc(title) + '</b><span class="set-sub">' + esc(sub) + "</span></span><i></i></button>";
  }

  function aiSection(settings) {
    var next = normalize(settings);
    var row = next.aiFeatures;
    return "<h2>" + esc(tr("On-device AI")) + "</h2>" +
      '<p class="phandle">' + esc(tr("Language detection and the spam filter are included. Larger downloads stay off until you turn them on. They wait for Wi-Fi, a battery that is not low, and data saver to be off.")) + "</p>" +
      flagRow("detect", row.detect, tr("Detect language on this device"), tr("Included. No download. The browser detector is used when it exists."), "device-ai-toggle") +
      flagRow("spam", row.spam, tr("Hide likely spam"), tr("Included. No download. Replies, messages, and notifications stay hidden behind Show."), "device-ai-toggle") +
      flagRow("summarize", row.summarize, tr("Summaries on this device"), tr("Included. No download. Long posts, threads, unread messages, and Catch me up use this device first."), "device-ai-toggle") +
      flagRow("compose", row.compose, tr("Compose help on this device"), tr("Included. No download. Suggestions, grammar, and tone stay here unless you allow a server."), "device-ai-toggle") +
      flagRow("semantic", row.semantic, tr("Search saved posts by meaning"), tr("Off until you turn it on. The included ranker needs no download."), "device-ai-toggle") +
      flagRow("semanticLocal", row.semanticLocal, tr("Download a search model"), tr("About {size}, plus a small runtime that is cached after the first download. Apache-2.0. Off until you turn it on.", { size: formatBytes(AI_SIZES.semanticLocal) }), "device-ai-toggle") +
      flagRow("translateLocal", row.translateLocal, tr("Download a translation model"), tr("About {size} for a language pair. Off until you turn it on. OPUS-MT is CC-BY-4.0.", { size: formatBytes(AI_SIZES.translateLocal) }), "device-ai-toggle") +
      flagRow("dmAuto", row.dmAuto, tr("Auto-translate direct messages"), tr("Off until you turn it on. Direct messages are translated on this device only."), "device-ai-toggle") +
      flagRow("dmServer", row.dmServer, tr("Allow server fallback for direct messages"), tr("Off. Message text stays on this device unless you turn this on."), "device-ai-toggle");
  }

  function settingsHtml(settings) {
    var next = normalize(settings);
    var live = effectiveLevel(next, signals());
    var levelCopy = {
      light: tr("Light does less and leaves feeds, search, and translation on the server."),
      balanced: tr("Balanced is the default. This device does the work it can, and the server covers the rest."),
      max: tr("Max does as much as it can. A large on-device model stays off until you turn it on.")
    };
    var levelNames = { light: tr("Light level"), balanced: tr("Balanced"), max: tr("Max") };
    var seg = ["light", "balanced", "max"].map(function (id) {
      var label = levelNames[id];
      return '<button type="button" class="' + (next.level === id ? "on" : "") + '" role="radio" aria-checked="' + (next.level === id ? "true" : "false") + '" data-act="device-level" data-level="' + id + '">' + esc(label) + "</button>";
    }).join("");
    var rows = FEATURES.map(function (id) { return switchRow(id, !!next.toggles[id]); }).join("");
    var banner = live === "light" && next.level !== "light"
      ? '<p class="device-banner">' + esc(tr("Using Light on this device")) + "</p>"
      : "";
    var cap = formatBytes(capBytes(live));
    var ai = aiSection(next);
    var webllm = "";
    if (next.level === "max") {
      webllm = '<h2>' + esc(tr("On-device model")) + "</h2>" +
        flagRow("webllm", next.webllmAccepted, tr("Download a model on this device"), tr("Available on Max. About {size}. It stays off until you accept the download. Built with Llama.", { size: formatBytes(AI_SIZES.webllm) }), "device-webllm") +
        (warn ? '<div class="device-warn"><p>' + esc(tr("This downloads a large model onto this device. It can take a lot of space and data. The assistant still works without it.")) + " " + esc(tr("Built with Llama. Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.")) + '</p><div class="device-actions"><button class="primary" type="button" data-act="device-webllm-yes">' + esc(tr("Download model")) + '</button><button class="outline" type="button" data-act="device-webllm-no">' + esc(tr("Not now")) + "</button></div></div>" : "");
    }
    var all = loadStats();
    var sum = totals(all);
    var lines = FEATURES.map(function (id) {
      var row = all.features[id];
      var name = labels()[id][2];
      var localMs = row.local ? Math.round(row.localMs / row.local) : 0;
      var workerMs = row.worker ? Math.round(row.workerMs / row.worker) : 0;
      var detail = (row.local || row.worker)
        ? tr("{name}: {local} on this device, {server} on the server", { name: name, local: String(row.local), server: String(row.worker) })
        : tr("Not enough measurements yet");
      var speed = row.local && row.worker
        ? tr("{name} averages {localMs} here and {serverMs} on the server", { name: name, localMs: formatMs(localMs), serverMs: formatMs(workerMs) })
        : "";
      return '<div class="device-stat"><div><b>' + esc(name) + '</b><div class="set-sub">' + esc(detail) + (speed ? " " + esc(speed) : "") + "</div></div></div>";
    }).join("");
    return '<div class="device-screen"><div class="set-block">' +
      banner +
      '<p class="phandle">' + esc(tr("Choosing a level sets the switches. You can change any of them after.")) + "</p>" +
      '<div class="device-seg" role="radiogroup" aria-label="' + esc(tr("Device performance")) + '">' + seg + "</div>" +
      '<p class="phandle device-note">' + esc(levelCopy[next.level] || levelCopy.balanced) + "</p>" +
      '<p class="phandle">' + esc(tr("Each setting is optional. If this device cannot do the work, the app uses the server.")) + "</p>" +
      "<h2>" + esc(tr("On this device")) + "</h2>" + rows +
      "<h2>" + esc(tr("Limits")) + "</h2>" +
      flagRow("wifiOnly", next.wifiOnly, tr("Wi-Fi only"), tr("Heavy work waits for Wi-Fi when the browser can tell.")) +
      flagRow("pauseBattery", next.pauseBattery, tr("Pause heavy work on low battery"), tr("Heavy work waits while the battery is low, when the browser can tell.")) +
      flagRow("autoLight", next.autoLight, tr("Use Light on a weak device"), tr("A device with little memory, few cores, or data saver drops to Light.")) +
      '<p class="phandle">' + esc(tr("Saved media stays under {size} at this level.", { size: cap })) + "</p>" +
      '<a class="set-row" href="#/settings/data"><span class="set-copy"><b>' + esc(tr("Peer-assisted media")) + '</b><span class="set-sub">' + esc(tr("Peer sharing follows the level on this device.")) + "</span></span></a>" +
      ai +
      webllm +
      '<h2>' + esc(tr("Saved by your device")) + "</h2>" +
      '<p class="phandle">' + esc(tr("These numbers are measured on this device only. They are not saved to your account.")) + "</p>" +
      '<div class="device-stat"><b>' + esc(tr("Kept off the server {size}", { size: formatBytes(sum.savedBytes) })) + "</b></div>" +
      '<div class="device-stat"><b>' + esc(tr("Faster by {time}", { time: formatMs(sum.savedMs) })) + "</b></div>" +
      lines +
      '<div class="device-actions"><button class="outline" type="button" data-act="device-ai">' + esc(tr("Open assistant")) + "</button></div>" +
      "</div></div>";
  }

  function paintAssistant() {
    if (typeof document === "undefined") return;
    var old = document.getElementById("device-ai");
    if (old) old.remove();
    if (!assistant) return;
    var back = document.createElement("div");
    back.id = "device-ai";
    back.className = "modal-back";
    back.setAttribute("data-act", "device-ai-close");
    back.innerHTML = '<div class="modal device-ai" role="dialog" aria-modal="true" aria-label="' + esc(tr("Assistant")) + '" data-act="stop"><div class="modal-head"><button class="icon-btn" type="button" data-act="device-ai-close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(tr("Assistant")) + '</h2></div><div class="modal-body"><p class="phandle">' + esc(tr("The browser model goes first. A cloud provider runs only when you add one. No paid API is built in.")) + '</p><label class="field"><span>' + esc(tr("Ask something")) + '</span><textarea id="device-ai-q" maxlength="2000"></textarea></label><div class="device-actions"><button class="primary" type="button" data-act="device-ai-ask">' + esc(tr("Ask")) + '</button></div><p id="device-ai-out" class="phandle"></p></div></div>';
    document.body.appendChild(back);
  }

  function openAssistant() {
    assistant = true;
    ensure("ai").then(function () { paintAssistant(); });
  }

  function closeAssistant() {
    assistant = false;
    if (typeof document === "undefined") return;
    var old = document.getElementById("device-ai");
    if (old) old.remove();
  }

  function askAssistant() {
    var box = typeof document !== "undefined" ? document.getElementById("device-ai-q") : null;
    var out = typeof document !== "undefined" ? document.getElementById("device-ai-out") : null;
    var text = box ? String(box.value || "").trim() : "";
    if (!text) return;
    ensure("ai").then(function () {
      var ai = root.ViktorychDeviceAi;
      if (!ai || !ai.ask) {
        if (out) out.textContent = tr("The assistant is not available on this device yet.");
        return;
      }
      ai.ask(text).then(function (res) {
        if (out) out.textContent = res && res.text ? res.text : tr("The assistant is not available on this device yet.");
      }).catch(function () {
        if (out) out.textContent = tr("The assistant is not available on this device yet.");
      });
    });
  }

  function watchBattery() {
    if (!batteryAllowed() || typeof navigator === "undefined" || !navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      batterySnap = { level: b.level, charging: b.charging };
      var pull = function () { batterySnap = { level: b.level, charging: b.charging }; };
      b.addEventListener("levelchange", pull);
      b.addEventListener("chargingchange", pull);
    }).catch(function () { batterySnap = null; });
  }

  function start() {
    loadStats();
    loadMemory();
    var run = function () {
      if (featureOn(read(), "storage", signals())) {
        try {
          if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(function () {});
          }
        } catch (err) { /* persistence is optional */ }
      }
      watchBattery();
      ensure("ondevice");
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 4000 });
    else if (typeof setTimeout === "function") setTimeout(run, 1500);
  }

  function reset() {
    memory = { feature: {}, source: {} };
    statsMem = emptyStats();
    warn = false;
    assistant = false;
    batterySnap = null;
    try { localStorage.removeItem(STATS_KEY); } catch (err) { /* ignore */ }
    try { sessionStorage.removeItem(MEMORY_KEY); } catch (err) { /* ignore */ }
  }

  return {
    FEATURES: FEATURES,
    PRESETS: PRESETS,
    LAZY: LAZY,
    TIMEOUT_MS: TIMEOUT_MS,
    FAIL_TTL: FAIL_TTL,
    OK_TTL: OK_TTL,
    CAPS: CAPS,
    normalize: normalize,
    applyLevel: applyLevel,
    toggle: toggle,
    confirmWebllm: confirmWebllm,
    syncShape: syncShape,
    signalsFrom: signalsFrom,
    isWeak: isWeak,
    effectiveLevel: effectiveLevel,
    heavyPaused: heavyPaused,
    featureOn: featureOn,
    webllmAllowed: webllmAllowed,
    AI_KEYS: AI_KEYS,
    AI_SIZES: AI_SIZES,
    toggleAi: toggleAi,
    aiFeatureOn: aiFeatureOn,
    read: read,
    patch: patch,
    persist: persist,
    signals: signals,
    rememberFail: rememberFail,
    rememberOk: rememberOk,
    cooling: cooling,
    sourceState: sourceState,
    scopeOf: scopeOf,
    measureBytes: measureBytes,
    noteStat: noteStat,
    totals: totals,
    loadStats: loadStats,
    withTimeout: withTimeout,
    runLocal: runLocal,
    planFetch: planFetch,
    playbackUrl: playbackUrl,
    capBytes: capBytes,
    capForPolicy: capForPolicy,
    evictLru: evictLru,
    formatBytes: formatBytes,
    formatMs: formatMs,
    ensure: ensure,
    settingsHtml: settingsHtml,
    setWarn: function (on) { warn = !!on; },
    warnOpen: function () { return warn; },
    openAssistant: openAssistant,
    closeAssistant: closeAssistant,
    askAssistant: askAssistant,
    start: start,
    reset: reset
  };
});
