/* TV detection and the TV low-spec defaults, read before the page paints.
   tv.js drives the remote; this file only decides whether TV mode is on and
   which light defaults apply, so app.js and the CSS can read them on boot.
   Everything lives in its own key so a settings save never drops it. */
(function (root) {
  "use strict";
  var KEY = "viktorychapp-tv-v1";
  var APP_PACKAGE = "app.viktorych.tv";
  // Every light default and its value while TV mode is on. The user can turn
  // each one off in Settings > Display > TV mode.
  var DEFAULTS = {
    calm: true,      // reduced motion, no heavy animations
    flat: true,      // no blur or backdrop effects
    lightImages: true,
    autoplay: "off", // "off" | "muted" | "on"
    fewerPosts: true,
    lazyStart: true  // skip idle preloads and optional start-up work
  };
  var TV_UA = /Tizen|Web0S|webOS|SMART-TV|SmartTV|Smart-TV|BRAVIA|Bravia|CrKey|Chromecast|AFT[A-Z0-9]|Android ?TV|GoogleTV|Google TV|HbbTV|Viera|NetCast|TV Bro|Fire TV|FireTV|AppleTV|Apple TV|Roku|VIDAA|Hisense|SmartHub|LivingRoom|Maple|MIBOX|MiTV|SHIELD Android TV|Puffin TV|ViktorychTV/i;
  var ANDROID_TV_UA = /Android ?TV|GoogleTV|Google TV|BRAVIA|Bravia|CrKey|Chromecast|AFT[A-Z0-9]|Fire TV|FireTV|MIBOX|MiTV|SHIELD Android TV|TV Bro|Puffin TV|ViktorychTV/i;

  function ua() { return String((root.navigator && root.navigator.userAgent) || ""); }

  function read() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) { /* private mode */ }
    return {};
  }

  function write(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { /* private mode */ }
  }

  function legacyMode() {
    // Older builds kept tvMode inside the main settings blob.
    try {
      var raw = root.localStorage.getItem("viktorychapp-settings-v1");
      var parsed = raw ? JSON.parse(raw) : null;
      var mode = parsed && parsed.tvMode;
      return mode === "on" || mode === "off" ? mode : "";
    } catch (err) { return ""; }
  }

  function blob() {
    var loc = root.location || {};
    return String(loc.search || "") + "&" + String(loc.hash || "");
  }

  function queryFlag() {
    var text = blob();
    if (/[?&]tv=0(?:&|#|$)/.test(text)) return "off";
    if (/[?&]tv=1(?:&|#|$)/.test(text)) return "on";
    return "";
  }

  function isTvUa(text) { return TV_UA.test(text == null ? ua() : String(text)); }
  function isAndroidTv(text) {
    var s = text == null ? ua() : String(text);
    if (/Tizen|Web0S|webOS|Roku|AppleTV|Apple TV|VIDAA/i.test(s)) return false;
    return ANDROID_TV_UA.test(s) || (/Android/i.test(s) && /\bTV\b/.test(s));
  }

  function coarseLarge() {
    var w = root.innerWidth || 0;
    var h = root.innerHeight || 0;
    if (w < 960 || h < 520) return false;
    var nav = root.navigator || {};
    var touch = (nav.maxTouchPoints || 0) > 0;
    var fine = false;
    try { fine = root.matchMedia("(pointer: fine)").matches; } catch (err) { fine = false; }
    return !touch && !fine;
  }

  // Inside the installed TV app. The app opens ?src=tvapp; a Trusted Web
  // Activity also sends an android-app:// referrer on the first page.
  function markApp() {
    var ref = "";
    try { ref = String((root.document && root.document.referrer) || ""); } catch (err) { ref = ""; }
    var inApp = /[?&]src=tvapp(?:&|#|$)/.test(blob()) || ref.indexOf("android-app://" + APP_PACKAGE) === 0 || /ViktorychTV/.test(ua());
    if (!inApp) return false;
    var state = read();
    var ver = /[?&]tvapp=(\d+)/.exec(blob());
    var n = ver ? Number(ver[1]) : 0;
    if (!state.app || (n && state.appVersion !== n)) {
      state.app = 1;
      if (n) state.appVersion = n;
      write(state);
    }
    try { root.sessionStorage.setItem(KEY + "-app", "1"); } catch (err) { /* private mode */ }
    return true;
  }

  function inApp() {
    try { if (root.sessionStorage.getItem(KEY + "-app") === "1") return true; } catch (err) { /* private mode */ }
    return !!read().app;
  }

  function mode() {
    var m = read().mode || legacyMode();
    return m === "on" || m === "off" ? m : "auto";
  }

  var forced = "";
  function wanted() {
    var flag = queryFlag();
    if (flag) forced = flag;
    if (forced) return forced === "on";
    var m = mode();
    if (m === "on") return true;
    if (m === "off") return false;
    return inApp() || isTvUa() || coarseLarge();
  }

  function prefs() {
    var saved = read().prefs || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = saved[k];
      if (k === "autoplay") out[k] = v === "on" || v === "muted" || v === "off" ? v : DEFAULTS[k];
      else out[k] = typeof v === "boolean" ? v : DEFAULTS[k];
    });
    return out;
  }

  var api = {
    KEY: KEY,
    APP_PACKAGE: APP_PACKAGE,
    DEFAULTS: DEFAULTS,
    on: false,
    isTvUa: isTvUa,
    isAndroidTv: isAndroidTv,
    coarseLarge: coarseLarge,
    queryFlag: queryFlag,
    inApp: inApp,
    appVersion: function () { return Number(read().appVersion || 0); },
    mode: mode,
    read: read,
    write: write,
    prefs: prefs,
    // A light default is in force only while TV mode is on.
    pref: function (name) { return api.on ? prefs()[name] : (name === "autoplay" ? "on" : false); },
    setMode: function (m) {
      var state = read();
      state.mode = m === "on" || m === "off" ? m : "auto";
      write(state);
      forced = state.mode === "auto" ? "" : state.mode;
    },
    setPref: function (name, value) {
      if (!(name in DEFAULTS)) return;
      var state = read();
      state.prefs = state.prefs || {};
      state.prefs[name] = value;
      write(state);
      api.paint();
    },
    resetPrefs: function () {
      var state = read();
      delete state.prefs;
      write(state);
      api.paint();
    },
    wanted: wanted,
    paint: function () {
      var doc = root.document;
      if (!doc || !doc.documentElement) return;
      var cls = doc.documentElement.classList;
      var p = prefs();
      cls.toggle("tv-calm", api.on && p.calm);
      cls.toggle("tv-flat", api.on && p.flat);
      cls.toggle("tv-app", inApp());
    },
    refresh: function () {
      api.on = wanted();
      api.paint();
      return api.on;
    }
  };

  // First TV start with no device level chosen: start on Light, which keeps
  // heavy on-device work (search index, AI, local media) on the server.
  function seedDeviceLevel() {
    try {
      var k = "viktorychapp-device-performance-v1";
      if (root.localStorage.getItem(k)) return;
      root.localStorage.setItem(k, JSON.stringify({ level: "light", profile: "lite", tvDefault: true }));
    } catch (err) { /* private mode */ }
  }

  markApp();
  api.refresh();
  if (api.on) seedDeviceLevel();
  if (api.on && root.document && root.document.documentElement) root.document.documentElement.classList.add("tv-on");
  root.ViktorychTVMode = api;
})(typeof window !== "undefined" ? window : globalThis);
