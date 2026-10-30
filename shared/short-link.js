/* The short public address. Every address a person reads, types or scans
   (TV sign-in, QR codes, share and invite links) uses SHORT_ORIGIN. The
   GitHub Pages address keeps working; this is only what people see.
   Short paths on the Cloudflare Pages mirror come from /_redirects:
     /tv  /go  /join  /p/CODE   (CODE = the 6-character TV code)
   This classic script runs before accounts.js and turns ?pair=CODE into
   #/link-tv?code=CODE. A pairing code is not a secret on its own: it only
   names a TV waiting on screen, and signing that TV in still needs a
   signed-in phone. No session token ever goes in a URL. */
(function (root) {
  "use strict";
  var SHORT_HOST = "viktorychapp.pages.dev";
  var SHORT_ORIGIN = "https://" + SHORT_HOST;
  var GITHUB_BASE = "https://viktorychgroup.github.io/ViktorychApp/";
  var PAIR_KEY = "viktorychapp-tvpair-intake-v1";
  var PAIR_TTL_MS = 10 * 60 * 1000;
  // Same alphabet as the Worker: no 0/O, 1/I/L.
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  function cleanCode(value) {
    var text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (text.length !== 6) return "";
    for (var i = 0; i < text.length; i++) if (ALPHABET.indexOf(text.charAt(i)) < 0) return "";
    return text;
  }
  function base() { return SHORT_ORIGIN + "/"; }
  function display(path) { return SHORT_HOST + (path || ""); }
  function pairUrl(code) { var c = cleanCode(code); return c ? SHORT_ORIGIN + "/p/" + c : SHORT_ORIGIN + "/tv"; }
  function tvUrl() { return SHORT_ORIGIN + "/tv"; }
  function joinUrl() { return SHORT_ORIGIN + "/join"; }
  function goUrl() { return SHORT_ORIGIN + "/go"; }

  function knownHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    if (host === SHORT_HOST || host === "viktorychgroup.github.io") return true;
    return host.length > SHORT_HOST.length + 1 && host.slice(-(SHORT_HOST.length + 1)) === "." + SHORT_HOST;
  }
  /* Where share links point: the short address on the live sites, the
     current page on a local or test server (so tests stay offline). */
  function shareBase(loc) {
    var l = loc || root.location || {};
    if (knownHost(l.hostname)) return base();
    var path = String(l.pathname || "/").replace(/[^/]*$/, "");
    return String(l.origin || "") + path;
  }
  /* The other public address, for "signed in there instead?". */
  function otherBase(loc) {
    var l = loc || root.location || {};
    return String(l.hostname || "").toLowerCase() === SHORT_HOST ? GITHUB_BASE : base();
  }

  function store() {
    try { return root.sessionStorage || null; } catch (err) { return null; }
  }
  function readPair() {
    var s = store();
    if (!s) return null;
    try {
      var doc = JSON.parse(s.getItem(PAIR_KEY) || "null");
      if (!doc || !cleanCode(doc.code) || !(Date.now() - Number(doc.at) < PAIR_TTL_MS)) return null;
      return doc;
    } catch (err) { return null; }
  }
  function writePair(doc) {
    var s = store();
    if (!s) return;
    try { if (doc) s.setItem(PAIR_KEY, JSON.stringify(doc)); else s.removeItem(PAIR_KEY); } catch (err) { /* private mode */ }
  }
  function pendingPair() { var doc = readPair(); return doc ? doc.code : ""; }
  // The phone had to sign in first; after it does, the pairing finishes by itself.
  function markPairAuth(code) {
    var doc = readPair();
    if (doc && (!code || doc.code === code)) { doc.auth = 1; writePair(doc); }
  }
  function takeAutoPair(code) {
    var doc = readPair();
    if (!doc || doc.code !== code || !doc.auth) return false;
    writePair(null);
    return true;
  }
  function clearPair() { writePair(null); }

  /* ?pair=CODE (from /p/CODE) becomes #/link-tv?code=CODE before the app
     reads the hash. ?join=1 (from /join) opens sign-up. */
  function intake(loc, hist) {
    var l = loc || root.location;
    var h = hist || root.history;
    if (!l) return "";
    var search = String(l.search || "");
    if (!/[?&](?:pair|join)=/.test(search)) return "";
    var params;
    try { params = new URLSearchParams(search); } catch (err) { return ""; }
    var code = cleanCode(params.get("pair"));
    var join = params.get("join") === "1";
    params.delete("pair");
    params.delete("join");
    var rest = params.toString();
    var hash = String(l.hash || "");
    var out = "";
    if (code) {
      writePair({ code: code, at: Date.now() });
      hash = "#/link-tv?code=" + code;
      out = "pair";
    } else if (join) {
      root.__VIKTORYCH_AUTH = "signup";
      out = "join";
    }
    try {
      if (h && h.replaceState) h.replaceState(null, "", String(l.pathname || "/") + (rest ? "?" + rest : "") + hash);
    } catch (err) { /* keep the URL as it is */ }
    return out;
  }

  var api = {
    SHORT_ORIGIN: SHORT_ORIGIN,
    SHORT_HOST: SHORT_HOST,
    GITHUB_BASE: GITHUB_BASE,
    PAIR_TTL_MS: PAIR_TTL_MS,
    cleanCode: cleanCode,
    base: base,
    display: display,
    pairUrl: pairUrl,
    tvUrl: tvUrl,
    joinUrl: joinUrl,
    goUrl: goUrl,
    knownHost: knownHost,
    shareBase: shareBase,
    otherBase: otherBase,
    pendingPair: pendingPair,
    markPairAuth: markPairAuth,
    takeAutoPair: takeAutoPair,
    clearPair: clearPair,
    intake: intake
  };
  root.ViktorychShort = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root.document && root.location) intake();
})(typeof window !== "undefined" ? window : globalThis);
