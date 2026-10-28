/* iPhone and iPad support. Polyfills cover iOS 15 WebKit. Detection is by
   feature and the Apple UA, which stays frozen on some versions. Nothing here
   re-encodes HEIC or picks a WebM recorder on iOS. */
(function (root) {
  var ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  var touchMac = typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  var ios = /iPhone|iPad|iPod/i.test(ua) || touchMac;

  function standalone() {
    try {
      if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
      if (typeof matchMedia === "function") {
        if (matchMedia("(display-mode: standalone)").matches) return true;
        if (matchMedia("(display-mode: fullscreen)").matches && ios) return true;
      }
    } catch (err) { /* a browser tab is not installed */ }
    return false;
  }

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
    AbortSignal.timeout = function (ms) {
      var ctrl = new AbortController();
      setTimeout(function () {
        try { ctrl.abort(); } catch (err) { /* already aborted */ }
      }, Number(ms) || 0);
      return ctrl.signal;
    };
  }

  if (typeof root.requestIdleCallback !== "function") {
    root.requestIdleCallback = function (cb) {
      var start = Date.now();
      return setTimeout(function () {
        cb({
          didTimeout: false,
          timeRemaining: function () { return Math.max(0, 50 - (Date.now() - start)); }
        });
      }, 1);
    };
    root.cancelIdleCallback = function (id) { clearTimeout(id); };
  }

  if (!Object.hasOwn) {
    Object.hasOwn = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
  }

  if (typeof Array.prototype.at !== "function") {
    Object.defineProperty(Array.prototype, "at", {
      configurable: true,
      writable: true,
      value: function (index) {
        var n = Math.trunc(Number(index) || 0);
        if (n < 0) n += this.length;
        if (n < 0 || n >= this.length) return undefined;
        return this[n];
      }
    });
  }

  if (typeof String.prototype.replaceAll !== "function") {
    String.prototype.replaceAll = function (search, replacement) {
      var text = String(this);
      var next = String(search);
      if (!next) return text;
      return text.split(next).join(String(replacement));
    };
  }

  if (typeof root.structuredClone !== "function") {
    root.structuredClone = function (value) {
      if (value == null || typeof value !== "object") return value;
      if (value instanceof Date) return new Date(value.getTime());
      if (Array.isArray(value)) return value.map(root.structuredClone);
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = root.structuredClone(value[key]); });
      return out;
    };
  }

  var cryptoObj = typeof root.crypto !== "undefined" ? root.crypto : null;
  if (cryptoObj && typeof cryptoObj.randomUUID !== "function" && cryptoObj.getRandomValues) {
    cryptoObj.randomUUID = function () {
      var bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = [];
      var i;
      for (i = 0; i < 16; i++) hex.push((bytes[i] + 256).toString(16).slice(1));
      return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" + hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10).join("");
    };
  }

  function isHeic(file) {
    var type = String((file && file.type) || "").toLowerCase();
    var name = String((file && file.name) || "").toLowerCase();
    return type === "image/heic" || type === "image/heif" || /\.hei[cf]$/.test(name);
  }

  function recorderMime(kind) {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
    var list = kind === "audio"
      ? ["audio/mp4", "audio/aac", "audio/webm"]
      : ["video/mp4", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp8,opus", "video/webm"];
    var i;
    for (i = 0; i < list.length; i++) {
      try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (err) { /* try the next type */ }
    }
    return "";
  }

  function readOriginal(file) {
    return new Promise(function (resolve) {
      if (!file || typeof FileReader === "undefined") { resolve(""); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { resolve(""); };
      reader.readAsDataURL(file);
    });
  }

  function tr(key) {
    var fn = root.t;
    return typeof fn === "function" ? fn(key) : key;
  }

  function mark() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return;
    if (ios) doc.documentElement.classList.add("ios");
    if (ios) doc.documentElement.classList.add("ios-lite");
    if (standalone()) doc.documentElement.classList.add("ios-standalone");
  }

  function keyboard() {
    var vv = root.visualViewport;
    var doc = root.document;
    if (!vv || !doc || !doc.documentElement) return;
    function apply() {
      var inset = Math.max(0, Math.round(root.innerHeight - vv.height - vv.offsetTop));
      if (inset < 80) inset = 0;
      doc.documentElement.style.setProperty("--keyboard", inset + "px");
      doc.documentElement.classList.toggle("keyboard-open", inset > 0);
    }
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
  }

  function widenFileInputs() {
    var doc = root.document;
    if (!doc) return;
    var nodes = doc.querySelectorAll('input[type="file"]');
    var i;
    for (i = 0; i < nodes.length; i++) {
      var accept = nodes[i].getAttribute("accept") || "";
      if (accept.indexOf("image") < 0) continue;
      if (accept.indexOf("heic") >= 0) continue;
      nodes[i].setAttribute("accept", accept + ",image/heic,image/heif,.heic,.heif");
    }
  }

  function storageNote() {
    var doc = root.document;
    if (!doc || !doc.body || !ios || standalone()) return;
    var key = "viktorychapp-ios-storage-note";
    try { if (root.localStorage && root.localStorage.getItem(key) === "1") return; } catch (err) { return; }
    var bar = doc.createElement("div");
    bar.className = "ios-storage";
    bar.setAttribute("role", "status");
    bar.setAttribute("data-ios", "storage");
    var text = doc.createElement("p");
    text.textContent = tr("Add to Home Screen to keep data on this device. Safari can clear site data after 7 days away.");
    var button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("data-ios", "dismiss");
    button.textContent = tr("Not now");
    button.addEventListener("click", function () {
      try { root.localStorage.setItem(key, "1"); } catch (err) { /* the note can still close */ }
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    bar.appendChild(text);
    bar.appendChild(button);
    doc.body.appendChild(bar);
  }

  function pullToRefresh() {
    if (!ios) return;
    var doc = root.document;
    if (!doc) return;
    var startY = 0;
    doc.addEventListener("touchstart", function (event) {
      startY = event.touches && event.touches[0] ? event.touches[0].clientY : 0;
    }, { passive: true });
    doc.addEventListener("touchmove", function (event) {
      if ((root.scrollY || 0) > 2) return;
      var y = event.touches && event.touches[0] ? event.touches[0].clientY : 0;
      if (y <= startY + 10) return;
      var node = event.target;
      while (node && node !== doc.body) {
        if (node.scrollHeight > node.clientHeight + 12) return;
        node = node.parentNode;
      }
      if (event.cancelable) event.preventDefault();
    }, { passive: false });
  }

  function persistInstalled() {
    if (!standalone() || !navigator.storage || typeof navigator.storage.persist !== "function") return;
    navigator.storage.persist().catch(function () { /* the installed app already keeps its own store */ });
  }

  function boot() {
    mark();
    keyboard();
    widenFileInputs();
    storageNote();
    pullToRefresh();
    persistInstalled();
  }

  var api = {
    ios: ios,
    lite: ios,
    standalone: standalone,
    isHeic: isHeic,
    readOriginal: readOriginal,
    recorderMime: recorderMime,
    pushNeedsInstall: function () { return ios && !standalone(); }
  };
  root.ViktorychIos = api;

  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
