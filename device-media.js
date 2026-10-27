/* Local previews. Thumbnails are small JPEG copies for the screen only.
   The original file is never replaced or re-encoded. Playback prefers the
   source URL until that exact URL has failed. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychDeviceMedia = api;
})(typeof self !== "undefined" ? self : this, function () {
  var cache = [];

  function deviceApi() {
    if (typeof self !== "undefined" && self.ViktorychDevice) return self.ViktorychDevice;
    if (typeof window !== "undefined" && window.ViktorychDevice) return window.ViktorychDevice;
    if (typeof require === "function") {
      try { return require("./device.js"); } catch (err) { return null; }
    }
    return null;
  }

  function keyOf(file) {
    if (!file) return "";
    return [file.name || "", file.size || 0, file.lastModified || 0, file.type || ""].join(":");
  }

  function remember(key, bytes) {
    var dev = deviceApi();
    var row = { id: key, bytes: bytes.byteLength || bytes.length || 0, at: Date.now(), data: bytes };
    cache.push(row);
    var cap = dev && dev.capBytes ? Math.min(32 * 1024 * 1024, dev.capBytes("light")) : 8 * 1024 * 1024;
    if (dev && dev.evictLru) {
      var plan = dev.evictLru(cache, cap);
      var keep = {};
      plan.keep.forEach(function (item) { keep[item.id] = item; });
      cache = cache.filter(function (item) { return keep[item.id]; });
    }
  }

  function cached(key) {
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].id === key) {
        cache[i].at = Date.now();
        return cache[i].data;
      }
    }
    return null;
  }

  function drawFile(file) {
    if (!file || typeof createImageBitmap !== "function" || typeof document === "undefined") {
      return Promise.reject(new Error("unsupported"));
    }
    if (file.type && file.type.indexOf("image/") !== 0 && file.type.indexOf("video/") !== 0) {
      return Promise.reject(new Error("unsupported"));
    }
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, 320 / Math.max(bmp.width || 1, bmp.height || 1));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((bmp.width || 1) * scale));
      canvas.height = Math.max(1, Math.round((bmp.height || 1) * scale));
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.72);
      });
    }).then(function (blob) {
      if (!blob) throw new Error("empty");
      return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    });
  }

  function thumbOf(file, opts) {
    opts = opts || {};
    var dev = opts.device || deviceApi();
    var key = keyOf(file);
    var hit = cached(key);
    if (hit) {
      if (dev && dev.noteStat) dev.noteStat("local", "media", hit.byteLength || hit.length || 0, 1);
      return Promise.resolve(hit);
    }
    var draw = opts.draw || drawFile;
    if (!dev || !dev.runLocal) {
      return Promise.resolve().then(function () { return draw(file); }).catch(function () { return null; });
    }
    return dev.runLocal("media", key || "thumb", function () { return draw(file); }, function () { return null; }, {
      settings: opts.settings || dev.read(),
      signals: opts.signals || dev.signals(),
      timeout: opts.timeout == null ? dev.TIMEOUT_MS : opts.timeout,
      now: opts.now,
      valid: function (value) { return value && (value.byteLength || value.length); }
    }).then(function (out) {
      if (!out || out.via !== "device" || !out.value) return null;
      remember(key || "thumb", out.value);
      return out.value;
    }).catch(function () { return null; });
  }

  function reset() { cache = []; }

  return { thumbOf: thumbOf, keyOf: keyOf, reset: reset };
});
