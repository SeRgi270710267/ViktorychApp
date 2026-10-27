/* Recording stays on the device. Segments use the recorder timeslice, which
   does not transcode an existing file. JSON notes may be gzipped. Video and
   audio bytes are returned unchanged. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychDeviceRecord = api;
})(typeof self !== "undefined" ? self : this, function () {
  function deviceApi() {
    if (typeof self !== "undefined" && self.ViktorychDevice) return self.ViktorychDevice;
    if (typeof window !== "undefined" && window.ViktorychDevice) return window.ViktorychDevice;
    if (typeof require === "function") {
      try { return require("./device.js"); } catch (err) { return null; }
    }
    return null;
  }

  function segmentPlan(level) {
    if (level === "light") return { local: false, timeslice: 0 };
    if (level === "max") return { local: true, timeslice: 2000 };
    return { local: true, timeslice: 4000 };
  }

  function originalFile(file) {
    return file || null;
  }

  function gzip(text) {
    if (typeof CompressionStream === "undefined" || typeof Blob === "undefined" || typeof Response === "undefined") {
      return Promise.reject(new Error("unsupported"));
    }
    var stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (!bytes.length) throw new Error("empty");
      return { encoding: "gzip", bytes: bytes };
    });
  }

  function gunzip(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("unsupported"));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new TextDecoder().decode(buf);
    });
  }

  function compressMeta(obj, opts) {
    opts = opts || {};
    var dev = opts.device || deviceApi();
    var text = JSON.stringify(obj == null ? {} : obj);
    function identity() { return { encoding: "identity", text: text, original: obj }; }
    var pack = opts.gzip || gzip;
    if (!dev || !dev.runLocal) {
      return Promise.resolve().then(function () { return pack(text); }).then(function (packed) {
        packed.original = obj;
        return packed;
      }).catch(function () { return identity(); });
    }
    return dev.runLocal("record", "meta", function () { return pack(text); }, identity, {
      settings: opts.settings || dev.read(),
      signals: opts.signals || {},
      timeout: opts.timeout == null ? 800 : opts.timeout,
      now: opts.now,
      valid: function (value) { return value && (value.encoding === "gzip" || value.encoding === "identity"); }
    }).then(function (out) {
      var value = out.value;
      value.original = obj;
      return value;
    }).catch(function () { return identity(); });
  }

  function noteUpload(file, meta, opts) {
    var kept = originalFile(file);
    if (kept !== file) return Promise.reject(new Error("reencoded"));
    return compressMeta(meta, opts).then(function (packed) {
      return { file: kept, meta: packed };
    });
  }

  function startSegments(stream, timeslice) {
    if (typeof MediaRecorder === "undefined") return Promise.reject(new Error("unsupported"));
    var rec = new MediaRecorder(stream);
    var chunks = [];
    rec.addEventListener("dataavailable", function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    });
    var done = new Promise(function (resolve, reject) {
      rec.addEventListener("stop", function () { resolve(chunks.slice()); });
      rec.addEventListener("error", function () { reject(new Error("status")); });
    });
    rec.start(timeslice || 4000);
    return { stop: function () { if (rec.state !== "inactive") rec.stop(); return done; }, recorder: rec };
  }

  return {
    segmentPlan: segmentPlan,
    originalFile: originalFile,
    compressMeta: compressMeta,
    gunzip: gunzip,
    noteUpload: noteUpload,
    startSegments: startSegments
  };
});
