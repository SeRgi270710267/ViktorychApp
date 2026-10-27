/* Large media in the origin private file system. Cache Storage remains the fallback. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychOpfs = api;
})(typeof self !== "undefined" ? self : this, function () {
  var LARGE = 1024 * 1024;
  var dirPromise = null;

  function supported() {
    return typeof navigator !== "undefined" && !!(navigator.storage && typeof navigator.storage.getDirectory === "function");
  }

  function directory() {
    if (!supported()) return Promise.resolve(null);
    if (!dirPromise) {
      dirPromise = navigator.storage.getDirectory().then(function (root) {
        return root.getDirectoryHandle("vapp-media", { create: true });
      }).catch(function () {
        dirPromise = null;
        return null;
      });
    }
    return dirPromise;
  }

  function nameOf(url) {
    var text = String(url || "");
    if (!crypto || !crypto.subtle) {
      return "u" + text.replace(/[^a-z0-9]+/gi, "").slice(-80);
    }
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    }).catch(function () {
      return "u" + text.replace(/[^a-z0-9]+/gi, "").slice(-80);
    });
  }

  function put(url, blob) {
    if (!blob || blob.size < LARGE) return Promise.resolve(false);
    return directory().then(function (dir) {
      if (!dir) return false;
      return Promise.resolve(nameOf(url)).then(function (name) {
        return dir.getFileHandle(name, { create: true }).then(function (handle) {
          return handle.createWritable().then(function (writable) {
            return writable.write(blob).then(function () { return writable.close(); }).then(function () { return true; });
          });
        });
      });
    }).catch(function () { return false; });
  }

  function fileHandle(url) {
    return directory().then(function (dir) {
      if (!dir) return null;
      return Promise.resolve(nameOf(url)).then(function (name) {
        return dir.getFileHandle(name).catch(function () { return null; });
      });
    });
  }

  function open(url, rangeHeader) {
    return fileHandle(url).then(function (handle) {
      if (!handle) return null;
      return handle.getFile().then(function (file) {
        var type = file.type || "application/octet-stream";
        if (!rangeHeader) {
          return new Response(file, {
            status: 200,
            headers: {
              "Content-Type": type,
              "Content-Length": String(file.size),
              "Accept-Ranges": "bytes"
            }
          });
        }
        var match = /^bytes=(\d+)-(\d*)$/i.exec(String(rangeHeader).trim());
        if (!match) return null;
        var start = Number(match[1]);
        var end = match[2] === "" ? file.size - 1 : Number(match[2]);
        if (!isFinite(start) || !isFinite(end) || start > end || start >= file.size) return null;
        if (end >= file.size) end = file.size - 1;
        var slice = file.slice(start, end + 1, type);
        return new Response(slice, {
          status: 206,
          headers: {
            "Content-Type": type,
            "Content-Length": String(slice.size),
            "Content-Range": "bytes " + start + "-" + end + "/" + file.size,
            "Accept-Ranges": "bytes"
          }
        });
      });
    }).catch(function () { return null; });
  }

  function remove(url) {
    return directory().then(function (dir) {
      if (!dir) return false;
      return Promise.resolve(nameOf(url)).then(function (name) {
        return dir.removeEntry(name).then(function () { return true; }).catch(function () { return false; });
      });
    }).catch(function () { return false; });
  }

  function clear() {
    return directory().then(function (dir) {
      if (!dir || !dir.entries) return false;
      var names = [];
      var iter = dir.entries();
      var walk = function () {
        return iter.next().then(function (step) {
          if (step.done) return null;
          names.push(step.value[0]);
          return walk();
        });
      };
      return walk().then(function () {
        var chain = Promise.resolve();
        names.forEach(function (name) {
          chain = chain.then(function () { return dir.removeEntry(name).catch(function () {}); });
        });
        return chain.then(function () { return true; });
      });
    }).catch(function () { return false; });
  }

  return {
    LARGE: LARGE,
    supported: supported,
    put: put,
    open: open,
    remove: remove,
    clear: clear
  };
});
