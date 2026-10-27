/* Gzip for cached JSON. Browsers without Compression Streams keep the bytes plain. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychCodec = api;
})(typeof self !== "undefined" ? self : this, function () {
  function supported() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  }

  function through(bytes, Stream) {
    if (!supported() || !bytes) return Promise.resolve(null);
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new Stream("gzip"));
      return new Response(stream).arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      }).catch(function () { return null; });
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  function gzip(bytes) {
    return through(bytes, CompressionStream);
  }

  function gunzip(bytes) {
    return through(bytes, DecompressionStream);
  }

  return { supported: supported, gzip: gzip, gunzip: gunzip };
});
