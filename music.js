/* Music mode. The visible name is productName("music") from the language packs.
   The normal app stays in place until the Music sidebar entry (or a direct
   #/music URL) opens this mode. Leaving pauses playback.
   Pure helpers stay usable under node (no document).
   Offline files stay in the sintel-music database and the sintel-music-offline
   cache so a rebrand does not drop downloads already saved on this device. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }
  function trn(key, n, vars) {
    var fn = (typeof window !== "undefined" && window.tn) ? window.tn : ((typeof self !== "undefined" && self.tn) ? self.tn : null);
    return fn ? fn(key, n, vars) : String(n);
  }
  function productName(kind) {
    var api = (typeof SI18n !== "undefined") ? SI18n : ((typeof window !== "undefined" && window.SI18n) ? window.SI18n : ((typeof self !== "undefined" && self.SI18n) ? self.SI18n : null));
    return (api && api.productName) ? api.productName(kind) : "";
  }

  var STORE = "viktorych-music-v1";
  var STORE_PREV = "sintel-music-v1";
  var EXTRA = {"muLibrary": "M8.80 3.05H19.00A1.65 1.65 0 0 1 20.65 4.70V4.75A1.65 1.65 0 0 1 19.00 6.40H8.80A1.65 1.65 0 0 1 7.15 4.75V4.70A1.65 1.65 0 0 1 8.80 3.05ZM5.80 5.85H15.60A2.70 2.70 0 0 1 18.30 8.55V18.20A2.70 2.70 0 0 1 15.60 20.90H5.80A2.70 2.70 0 0 1 3.10 18.20V8.55A2.70 2.70 0 0 1 5.80 5.85ZM5.80 7.60A0.95 0.95 0 0 0 4.85 8.55V18.20A0.95 0.95 0 0 0 5.80 19.15H15.60A0.95 0.95 0 0 0 16.55 18.20V8.55A0.95 0.95 0 0 0 15.60 7.60Z", "muLibraryOn": "M9.25 3.05H18.30A2.55 2.55 0 0 1 20.85 5.60V13.40A2.55 2.55 0 0 1 18.30 15.95H9.25A2.55 2.55 0 0 1 6.70 13.40V5.60A2.55 2.55 0 0 1 9.25 3.05ZM5.80 6.15H15.10A2.70 2.70 0 0 1 17.80 8.85V18.15A2.70 2.70 0 0 1 15.10 20.85H5.80A2.70 2.70 0 0 1 3.10 18.15V8.85A2.70 2.70 0 0 1 5.80 6.15Z", "muList": "M4.07 4.55H12.53A1.02 1.02 0 0 1 13.55 5.57V5.57A1.02 1.02 0 0 1 12.53 6.60H4.07A1.02 1.02 0 0 1 3.05 5.57V5.57A1.02 1.02 0 0 1 4.07 4.55ZM4.07 10.95H12.53A1.02 1.02 0 0 1 13.55 11.97V11.97A1.02 1.02 0 0 1 12.53 13.00H4.07A1.02 1.02 0 0 1 3.05 11.97V11.97A1.02 1.02 0 0 1 4.07 10.95ZM4.07 17.35H8.32A1.02 1.02 0 0 1 9.35 18.38V18.38A1.02 1.02 0 0 1 8.32 19.40H4.07A1.02 1.02 0 0 1 3.05 18.38V18.38A1.02 1.02 0 0 1 4.07 17.35ZM13.20 17.25a3.00 3.00 0 1 1 6.00 0a3.00 3.00 0 1 1 -6.00 0zM14.65 17.25a1.55 1.55 0 1 0 3.10 0a1.55 1.55 0 1 0 -3.10 0zM19.20 4.90H19.20A0.85 0.85 0 0 1 20.05 5.75V14.45A0.85 0.85 0 0 1 19.20 15.30H19.20A0.85 0.85 0 0 1 18.35 14.45V5.75A0.85 0.85 0 0 1 19.20 4.90ZM20.05 4.9C22.2 6.15 23.4 7.7 23.4 9.4H21.65C21.65 8.3 20.95 7.4 19.5 6.5L20.05 4.9Z", "muListOn": "M4.07 4.55H12.53A1.02 1.02 0 0 1 13.55 5.57V5.57A1.02 1.02 0 0 1 12.53 6.60H4.07A1.02 1.02 0 0 1 3.05 5.57V5.57A1.02 1.02 0 0 1 4.07 4.55ZM4.07 10.95H12.53A1.02 1.02 0 0 1 13.55 11.97V11.97A1.02 1.02 0 0 1 12.53 13.00H4.07A1.02 1.02 0 0 1 3.05 11.97V11.97A1.02 1.02 0 0 1 4.07 10.95ZM4.07 17.35H8.32A1.02 1.02 0 0 1 9.35 18.38V18.38A1.02 1.02 0 0 1 8.32 19.40H4.07A1.02 1.02 0 0 1 3.05 18.38V18.38A1.02 1.02 0 0 1 4.07 17.35ZM13.15 17.25a3.05 3.05 0 1 1 6.10 0a3.05 3.05 0 1 1 -6.10 0zM19.27 4.85H19.27A0.88 0.88 0 0 1 20.15 5.72V16.48A0.88 0.88 0 0 1 19.27 17.35H19.27A0.88 0.88 0 0 1 18.40 16.48V5.72A0.88 0.88 0 0 1 19.27 4.85ZM20.15 4.85C22.55 6.25 23.7 8 23.7 10H21.8C21.8 8.65 21.05 7.55 19.45 6.5L20.15 4.85Z", "muRadio": "M4.15 16.90a1.75 1.75 0 1 1 3.50 0a1.75 1.75 0 1 1 -3.50 0zM9.28 11.88A6.05 6.05 0 0 1 9.28 21.92L8.33 20.51A4.35 4.35 0 0 0 8.33 13.29ZM11.27 8.94A9.60 9.60 0 0 1 11.27 24.86L10.32 23.45A7.90 7.90 0 0 0 10.32 10.35Z", "muRadioOn": "M3.75 16.90a2.15 2.15 0 1 1 4.30 0a2.15 2.15 0 1 1 -4.30 0zM9.48 11.59A6.40 6.40 0 0 1 9.48 22.21L8.14 20.22A4.00 4.00 0 0 0 8.14 13.58ZM11.49 8.61A10.00 10.00 0 0 1 11.49 25.19L10.15 23.20A7.60 7.60 0 0 0 10.15 10.60Z", "muAdd": "M2.80 12.00a9.20 9.20 0 1 1 18.40 0a9.20 9.20 0 1 1 -18.40 0zM4.55 12.00a7.45 7.45 0 1 0 14.90 0a7.45 7.45 0 1 0 -14.90 0zM11.15 7.95L12.85 7.95L12.85 11.15L16.05 11.15L16.05 12.85L12.85 12.85L12.85 16.05L11.15 16.05L11.15 12.85L7.95 12.85L7.95 11.15L11.15 11.15Z", "muAddOn": "M2.80 12.00a9.20 9.20 0 1 1 18.40 0a9.20 9.20 0 1 1 -18.40 0zM11.07 11.07L7.90 11.07L7.90 12.93L11.07 12.93L11.07 16.10L12.93 16.10L12.93 12.93L16.10 12.93L16.10 11.07L12.93 11.07L12.93 7.90L11.07 7.90Z", "muBack": "M14.6 4.65 7.25 12l7.35 7.35 1.75-1.75L10.75 12l5.6-5.6-1.75-1.75zM11.05 11.1H20.5v1.8H11.05z", "muBackOn": "M20.3 10.1H8.65l4.2-4.2-1.95-1.95L4.25 12l6.65 7.05 1.95-1.95-4.2-4.2H20.3z", "muNote": "M6.75 16.70a3.40 3.40 0 1 1 6.80 0a3.40 3.40 0 1 1 -6.80 0zM8.35 16.70a1.80 1.80 0 1 0 3.60 0a1.80 1.80 0 1 0 -3.60 0zM13.62 3.70H13.62A0.93 0.93 0 0 1 14.55 4.62V13.47A0.93 0.93 0 0 1 13.62 14.40H13.62A0.93 0.93 0 0 1 12.70 13.47V4.62A0.93 0.93 0 0 1 13.62 3.70ZM14.55 3.7C17.2 5.2 18.75 7.05 18.75 9.2H16.8C16.8 7.75 15.9 6.6 14.05 5.5L14.55 3.7Z", "muNoteOn": "M6.70 16.70a3.45 3.45 0 1 1 6.90 0a3.45 3.45 0 1 1 -6.90 0zM13.70 3.65H13.70A0.95 0.95 0 0 1 14.65 4.60V15.85A0.95 0.95 0 0 1 13.70 16.80H13.70A0.95 0.95 0 0 1 12.75 15.85V4.60A0.95 0.95 0 0 1 13.70 3.65ZM14.65 3.65C17.5 5.3 19.15 7.4 19.15 9.8H16.95C16.95 8.1 15.9 6.75 13.9 5.45L14.65 3.65Z", "muSearchOn": "M10.25 2.15a8.1 8.1 0 1 0 5.02 14.45l4.48 4.48 1.6-1.6-4.48-4.48A8.1 8.1 0 0 0 10.25 2.15z"};
  var HEART = "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z";
  var HEART_ON = "M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z";
  var CTRL = {
    play: "M8 5v14l11-7z",
    pause: "M6 4h4v16H6zM14 4h4v16h-4z",
    prev: "M6 5h2.2v14H6zM19.5 5.5 10 12l9.5 6.5z",
    next: "M15.8 5H18v14h-2.2zM4.5 5.5 14 12 4.5 18.5z",
    save: "M12 3.2v9.1l-3.2-3.2-1.3 1.3L12 15.9l4.5-4.5-1.3-1.3-3.2 3.2V3.2H12zM5 18.2h14v1.8H5z",
    shuffle: "M4 7h2.8l2.4 2.6L11.6 7H15l-2.6 3.2L15 13.4h-3.4l-2.4-2.6L6.8 13.4H4l2.6-3.2L4 7zm11.2 0H20v2.1h-3.1L16.2 7h-1zm1.1 6.3H20V15.4h-2.4l-.6-1.2h-.7z",
    repeat: "M7 7h8.2L13.6 5.4 15 4l4 4-4 4-1.4-1.4L15.2 9H7v3.2H5V9c0-1.1.9-2 2-2zm10 10H8.8l1.6 1.6L9 20l-4-4 4-4 1.4 1.4L8.8 15H17v-3.2h2V17c0 1.1-.9 2-2 2z",
    vol: "M4 9.2v5.6h3.4L12 19.5V4.5L7.4 9.2H4zm9.2 2.8a3.6 3.6 0 0 0-2-3.2v6.4a3.6 3.6 0 0 0 2-3.2z",
    up: "M7 14.2 12 9.2l5 5-1.4 1.4L12 12l-3.6 3.6z",
    down: "M7 9.8 12 14.8l5-5-1.4-1.4L12 12 8.4 8.4z"
  };

  function install(PATH) {
    if (!PATH) return;
    Object.keys(EXTRA).forEach(function (key) { PATH[key] = EXTRA[key]; });
    PATH.muHome = PATH.home;
    PATH.muHomeOn = PATH.homeOn;
    PATH.muSearch = PATH.search;
    PATH.muSearchOn = EXTRA.muSearchOn;
    PATH.muHeart = PATH.heart;
    PATH.muHeartOn = PATH.heartOn;
    EXTRA.muHome = PATH.home;
    EXTRA.muHomeOn = PATH.homeOn;
    EXTRA.muSearch = PATH.search;
    EXTRA.muHeart = PATH.heart;
    EXTRA.muHeartOn = PATH.heartOn;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  function ytHost(hostname) {
    var host = String(hostname || "").toLowerCase();
    return host === "youtu.be" || host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com";
  }

  function youtubeId(input) {
    var raw = String(input || "").trim();
    if (/^[A-Za-z0-9_-]{6,20}$/.test(raw)) return raw;
    var url;
    try { url = new URL(raw); } catch (err) { return ""; }
    if (!ytHost(url.hostname)) return "";
    var host = url.hostname.toLowerCase();
    var part = "";
    if (host === "youtu.be") part = (url.pathname.split("/").filter(Boolean)[0] || "");
    else if (url.pathname.indexOf("/embed/") === 0 || url.pathname.indexOf("/shorts/") === 0 || url.pathname.indexOf("/live/") === 0) part = url.pathname.split("/")[2] || "";
    else part = url.searchParams.get("v") || "";
    return /^[A-Za-z0-9_-]{6,20}$/.test(part) ? part : "";
  }

  function localHost(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]" || host.slice(-10) === ".localhost";
  }

  function classifySource(input) {
    var raw = String(input || "").trim();
    if (!raw) return { ok: false, reason: "empty" };
    if (raw.indexOf("idb:") === 0) {
      if (!/^idb:[A-Za-z0-9_:-]{1,120}$/.test(raw)) return { ok: false, reason: "file" };
      return { ok: true, kind: "idb", url: raw, publish: false };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && raw.indexOf("https:") !== 0) return { ok: false, reason: "https" };
    var relative = false;
    if (/^(?:\.\/)?(?:media|sounds)\//.test(raw)) {
      if (raw.indexOf("..") >= 0) return { ok: false, reason: "path" };
      relative = true;
    }
    var url;
    try { url = new URL(raw, (typeof location !== "undefined" && location.href) || "https://example.invalid/"); }
    catch (err) { return { ok: false, reason: "url" }; }
    if (url.protocol !== "https:") return { ok: false, reason: "https" };
    if (url.username || url.password) return { ok: false, reason: "auth" };
    if (localHost(url.hostname)) return { ok: false, reason: "local" };
    var host = url.hostname.toLowerCase();
    var id = youtubeId(url.href);
    if (id && ytHost(host)) return { ok: true, kind: "youtube", url: "https://www.youtube.com/watch?v=" + id, id: id, publish: !relative };
    if ((host === "archive.org" || host.slice(-12) === ".archive.org") && url.pathname.indexOf("/details/") === 0) {
      var ident = decodeURIComponent((url.pathname.split("/")[2] || ""));
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(ident)) return { ok: false, reason: "archive" };
      return { ok: true, kind: "archive", url: url.href, id: ident, publish: false };
    }
    var path = url.pathname.toLowerCase();
    var archiveFile = (host === "archive.org" || host.slice(-12) === ".archive.org") && path.indexOf("/download/") >= 0;
    var audio = /\.(mp3|m4a|ogg|opus|aac|wav)$/.test(path) || archiveFile;
    if (!audio) return { ok: false, reason: "type" };
    return { ok: true, kind: "audio", url: relative ? raw.replace(/^\.\//, "") : url.href, publish: !relative };
  }

  function classifyStream(input) {
    var raw = String(input || "").trim();
    if (!raw) return { ok: false, reason: "empty" };
    var url;
    try { url = new URL(raw); } catch (err) { return { ok: false, reason: "url" }; }
    if (url.protocol !== "https:") return { ok: false, reason: "https" };
    if (url.username || url.password) return { ok: false, reason: "auth" };
    if (localHost(url.hostname)) return { ok: false, reason: "local" };
    if (!/\.m3u8$/i.test(url.pathname)) return { ok: false, reason: "type" };
    return { ok: true, url: url.href };
  }

  function streamReady(song) {
    return classifyStream(song && song.stream).ok;
  }

  function absoluteHttps(ref, base) {
    var target;
    var rootUrl;
    try {
      target = new URL(String(ref || "").trim(), base);
      rootUrl = new URL(base);
    } catch (err) { return ""; }
    if (target.protocol !== "https:" || target.username || target.password) return "";
    if (localHost(target.hostname) || target.host !== rootUrl.host) return "";
    return target.href;
  }

  function tagUri(line) {
    var quoted = String(line || "").match(/URI="([^"]+)"/i);
    if (quoted) return quoted[1];
    var raw = String(line || "").match(/URI=([^,\s]+)/i);
    return raw ? raw[1] : "";
  }

  function hlsAssets(text, base) {
    var lines = String(text || "").split(/\r?\n/);
    var playlists = [];
    var files = [];
    var expectPlaylist = false;
    function push(list, ref) {
      var abs = absoluteHttps(ref, base);
      if (abs && list.indexOf(abs) < 0) list.push(abs);
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf("#EXT-X-STREAM-INF") === 0) { expectPlaylist = true; continue; }
      if (line.indexOf("#EXT-X-I-FRAME-STREAM-INF") === 0) { expectPlaylist = false; continue; }
      if (line.indexOf("#EXT-X-MEDIA") === 0) {
        var media = tagUri(line);
        if (/\.m3u8(\?|#|$)/i.test(media)) push(playlists, media);
        continue;
      }
      if (line.indexOf("#EXT-X-KEY") === 0) {
        if (/METHOD=NONE/i.test(line)) continue;
        push(files, tagUri(line));
        continue;
      }
      if (line.indexOf("#EXT-X-MAP") === 0) {
        push(files, tagUri(line));
        continue;
      }
      if (line.charAt(0) === "#") continue;
      if (expectPlaylist || /\.m3u8(\?|#|$)/i.test(line)) push(playlists, line);
      else push(files, line);
      expectPlaylist = false;
    }
    return { playlists: playlists, files: files };
  }

  function formatReleased(value) {
    var parts = String(value || "").split("-");
    if (parts.length !== 3) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var month = months[Number(parts[1]) - 1];
    if (!month || !parts[0] || !parts[2]) return "";
    return month + " " + Number(parts[2]) + ", " + parts[0];
  }

  function formatTime(sec) {
    var total = Math.max(0, Math.floor(Number(sec) || 0));
    var hours = Math.floor(total / 3600);
    var mins = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    var tail = (secs < 10 ? "0" : "") + secs;
    if (hours) return hours + ":" + (mins < 10 ? "0" : "") + mins + ":" + tail;
    return mins + ":" + tail;
  }

  function reorder(list, fromId, toId) {
    var next = (list || []).slice();
    var from = next.indexOf(fromId);
    var to = next.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return next;
    var item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return next;
  }

  function copySong(song) {
    var copy = {
      id: String(song.id || ""),
      title: String(song.title || ""),
      artist: String(song.artist || ""),
      album: String(song.album || ""),
      cover: String(song.cover || ""),
      source: String(song.source || ""),
      kind: String(song.kind || ""),
      duration: Number(song.duration) || 0,
      license: String(song.license || "")
    };
    if (song.stream) copy.stream = String(song.stream);
    if (song.released) copy.released = String(song.released);
    if (song.genre) copy.genre = String(song.genre);
    if (song.style) copy.style = String(song.style);
    if (song.mood) copy.mood = String(song.mood);
    if (song.bpm) copy.bpm = Number(song.bpm) || 0;
    if (song.language) copy.language = String(song.language);
    if (song.lossless) copy.lossless = true;
    return copy;
  }

  function mergeLibrary(remote, local) {
    remote = remote || {};
    local = local || {};
    var hidden = {};
    (local.hidden || []).forEach(function (id) { hidden[String(id)] = true; });
    var edits = local.edits || {};
    var seen = {};
    var songs = [];
    (remote.songs || []).forEach(function (song) {
      if (!song || !song.id || hidden[song.id] || seen[song.id]) return;
      var patch = edits[song.id] || {};
      var copy = copySong(song);
      Object.keys(patch).forEach(function (key) {
        if (key !== "id" && patch[key] != null) copy[key] = patch[key];
      });
      copy.id = song.id;
      seen[copy.id] = true;
      songs.push(copy);
    });
    (local.songs || []).forEach(function (song) {
      if (!song || !song.id || hidden[song.id] || seen[song.id]) return;
      seen[song.id] = true;
      songs.push(copySong(song));
    });
    var order = local.order || [];
    if (order.length) {
      var rank = {};
      order.forEach(function (id, index) { rank[id] = index; });
      songs.sort(function (a, b) {
        var left = rank[a.id];
        var right = rank[b.id];
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left - right;
      });
    }
    var playlists = [];
    var used = {};
    if (!local.playlistTouched) {
      (remote.playlists || []).forEach(function (list) {
        if (!list || !list.id || used[list.id]) return;
        used[list.id] = true;
        playlists.push({ id: list.id, name: String(list.name || tr("Playlist")), songIds: (list.songIds || []).slice() });
      });
    } else {
      (local.playlists || []).forEach(function (list) {
        if (!list || !list.id || used[list.id]) return;
        used[list.id] = true;
        playlists.push({ id: list.id, name: String(list.name || tr("Playlist")), songIds: (list.songIds || []).slice() });
      });
      (remote.playlists || []).forEach(function (list) {
        if (!list || !list.id || used[list.id]) return;
        used[list.id] = true;
        playlists.push({ id: list.id, name: String(list.name || tr("Playlist")), songIds: (list.songIds || []).slice() });
      });
    }
    return { songs: songs, playlists: playlists };
  }

  function publishable(songs) {
    return (songs || []).filter(function (song) {
      if (song && song.kind === "hls" && streamReady(song)) return true;
      var kind = classifySource(song && song.source);
      return kind.ok && kind.publish && (kind.kind === "audio" || kind.kind === "youtube");
    }).map(copySong);
  }

  function parseHash(hash) {
    var raw = String(hash || "");
    var cut = raw.indexOf("?");
    var path = (cut >= 0 ? raw.slice(0, cut) : raw).replace(/^#/, "");
    var parts = path.split("/").filter(Boolean);
    if (parts[0] !== "music") return { section: "", id: "" };
    return { section: parts[1] || "home", id: parts.slice(2).join("/") };
  }

  function sectionKey(section, id) {
    if (section === "playlist" || section === "edit") return section + ":" + (id || "");
    return section || "";
  }

  function sameSection(route, href) {
    if (!route || route.name !== "music") return false;
    var parsed = parseHash(href);
    return sectionKey(route.section || "home", route.id || "") === sectionKey(parsed.section, parsed.id);
  }

  var logic = {
    parseHash: parseHash,
    youtubeId: youtubeId,
    classifySource: classifySource,
    classifyStream: classifyStream,
    streamReady: streamReady,
    hlsAssets: hlsAssets,
    mergeLibrary: mergeLibrary,
    publishable: publishable,
    formatTime: formatTime,
    formatReleased: formatReleased,
    reorder: reorder,
    sameKey: sectionKey,
    sameSection: sameSection
  };

  var hooks = {
    render: function () {},
    toast: function () {},
    go: function () {},
    repo: function () { return ""; }
  };
  var remote = { songs: [], playlists: [] };
  var local = { songs: [], edits: {}, hidden: [], order: [], playlists: [], playlistTouched: false, likes: [], offline: {}, volume: 1, shuffle: false, repeat: "off", view: "grid" };
  var ui = { q: "", draft: {}, now: false, confirm: "", plName: "", offline: null };
  var play = { queue: [], index: -1, playing: false, lastVolume: 1 };
  var audio = null;
  var yt = null;
  var ytReady = false;
  var ytPending = "";
  var hls = null;
  var musicHls = null;
  var playToken = 0;
  var paintedOffline = "\0";
  var HLS_SRC = "hls-1.7.3.min.js";
  var OFFLINE_CACHE = "sintel-music-offline";
  var active = false;
  var poll = 0;
  var blobUrls = {};
  var dragId = "";
  var dragList = "";
  var paintedId = "\0";
  var paintedPlaying = null;

  function library() { return mergeLibrary(remote, local); }
  function songs() { return library().songs; }
  function playlists() { return library().playlists; }
  function songById(id) {
    var list = songs();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function currentSong() {
    if (play.index < 0) return null;
    return songById(play.queue[play.index] || "");
  }
  function liked(id) { return (local.likes || []).indexOf(id) >= 0; }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(local)); } catch (err) { /* private mode */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) {
        raw = localStorage.getItem(STORE_PREV);
        if (raw) {
          try { localStorage.setItem(STORE, raw); } catch (err) { /* private mode */ }
        }
      }
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      local.songs = Array.isArray(data.songs) ? data.songs : [];
      local.edits = data.edits && typeof data.edits === "object" ? data.edits : {};
      local.hidden = Array.isArray(data.hidden) ? data.hidden : [];
      local.order = Array.isArray(data.order) ? data.order : [];
      local.playlists = Array.isArray(data.playlists) ? data.playlists : [];
      local.playlistTouched = !!data.playlistTouched;
      local.likes = Array.isArray(data.likes) ? data.likes : [];
      local.offline = data.offline && typeof data.offline === "object" && !Array.isArray(data.offline) ? data.offline : {};
      local.volume = typeof data.volume === "number" ? data.volume : 1;
      local.shuffle = !!data.shuffle;
      local.repeat = data.repeat === "one" || data.repeat === "all" ? data.repeat : "off";
      local.view = data.view === "list" ? "list" : "grid";
      play.lastVolume = local.volume || 1;
    } catch (err) { /* keep the empty library */ }
  }

  function loadRemote() {
    if (typeof fetch !== "function") return;
    fetch("data/music.json", { cache: "no-cache" }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data) return;
      remote = { songs: Array.isArray(data.songs) ? data.songs : [], playlists: Array.isArray(data.playlists) ? data.playlists : [] };
      if (active) hooks.render();
    }).catch(function () {});
  }

  function markOf(name) {
    var marks = root.ViktorychMarks || {};
    return marks[name] || { box: "0 0 1 1", body: "" };
  }

  function wordmark(cls, name) {
    var mark = markOf(name || "music");
    var klass = cls ? ' class="' + cls + '"' : "";
    return '<svg' + klass + ' viewBox="' + mark.box + '" fill="currentColor" aria-hidden="true">' + mark.body + '</svg>';
  }

  function brand() {
    return '<a class="logo" href="#/" aria-label="' + productName("music") + '">' + wordmark("logo-full", "music") +
      wordmark("logo-short", "musicShort") + wordmark("logo-si", "musicMark") + '</a>';
  }

  function links(route, navItem) {
    var section = (route && route.section) || "home";
    var id = (route && route.id) || "";
    return navItem("#/music", "muHome", tr("Home"), section === "home") +
      navItem("#/music/search", "muSearch", tr("Search"), section === "search") +
      navItem("#/music/library", "muLibrary", tr("Your Library"), section === "library") +
      navItem("#/music/playlists", "muList", tr("Playlists"), section === "playlists" || section === "playlist") +
      navItem("#/music/liked", "muHeart", tr("Liked songs"), section === "liked") +
      navItem("#/music/add", "muAdd", tr("Add song"), section === "add" || section === "edit") +
      navItem("#/music/radio", "muRadio", tr("Radio"), section === "radio") +
      navItem("#/", "muBack", tr("Back to {app}", { app: productName("pwa") }), false, tr("Back to {app}", { app: productName("pwa") }));
  }

  function drawerLinks(icon) {
    return '<a href="#/music">' + icon("muHome") + " " + tr("Home") + "</a>" +
      '<a href="#/music/search">' + icon("muSearch") + " " + tr("Search") + "</a>" +
      '<a href="#/music/library">' + icon("muLibrary") + " " + tr("Your Library") + "</a>" +
      '<a href="#/music/playlists">' + icon("muList") + " " + tr("Playlists") + "</a>" +
      '<a href="#/music/liked">' + icon("muHeart") + " " + tr("Liked songs") + "</a>" +
      '<a href="#/music/add">' + icon("muAdd") + " " + tr("Add song") + "</a>" +
      '<a href="#/music/radio">' + icon("muRadio") + " " + tr("Radio") + "</a>" +
      '<a href="#/">' + icon("muBack") + " " + tr("Back to {app}", { app: productName("pwa") }) + "</a>";
  }

  function bottomHtml(route, icon) {
    var section = (route && route.section) || "home";
    var item = function (href, name, label, on) {
      return '<a href="' + href + '" class="' + (on ? "on" : "") + '" aria-label="' + esc(label) + '"' + (on ? ' aria-current="page"' : "") + '><span class="nav-ico">' + icon(name) + "</span></a>";
    };
    return '<nav class="bottom-nav" aria-label="' + productName("musicShort") + '">' +
      item("#/music", section === "home" ? "muHomeOn" : "muHome", tr("Home"), section === "home") +
      item("#/music/search", section === "search" ? "muSearchOn" : "muSearch", tr("Search"), section === "search") +
      item("#/music/library", section === "library" ? "muLibraryOn" : "muLibrary", tr("Your Library"), section === "library") +
      item("#/music/playlists", section === "playlists" || section === "playlist" ? "muListOn" : "muList", tr("Playlists"), section === "playlists" || section === "playlist") +
      item("#/music/liked", section === "liked" ? "muHeartOn" : "muHeart", tr("Liked songs"), section === "liked") +
      ("</nav><button class=\"fab\" data-act=\"music-add\" " + "aria-label=\"" + tr("Add song") + "\"" + ">") + icon("plus") + "</button>";
  }

  function titleFor(route) {
    var section = (route && route.section) || "home";
    var names = { home: tr("Home"), search: tr("Search"), library: tr("Your Library"), playlists: tr("Playlists"), playlist: tr("Playlist"), liked: tr("Liked songs"), add: tr("Add song"), edit: tr("Edit song"), radio: tr("Radio") };
    var label = names[section] || tr("Home");
    if (section === "playlist") {
      var list = playlistById(route.id || "");
      if (list) label = list.name;
    }
    return label + " / " + productName("music");
  }

  function playlistById(id) {
    var lists = playlists();
    for (var i = 0; i < lists.length; i++) if (lists[i].id === id) return lists[i];
    return null;
  }

  function head(title, tools) {
    var logo = '<div class="mhead"><button class="m-ava" data-act="drawer" aria-label="' + tr("Menu") + '"><span class="ava initials">Y</span></button><a class="m-logo" href="#/" aria-label="' + productName("musicShort") + '">' + wordmark("logo-full", "music") + wordmark("logo-short", "musicShort") + "</a></div>";
    // Home already shows the music logo. A second heading would repeat it.
    if (title === productName("music")) return '<div class="topbar"><h1 class="vh">' + esc(title) + "</h1>" + logo + "</div>";
    return '<div class="topbar tall">' + logo + '<div class="page-head"><div class="head-text grow"><h1>' + esc(title) + "</h1></div>" + (tools || "") + "</div></div>";
  }

  function letter(song) {
    var text = (song && (song.title || song.artist)) || productName("music");
    return esc(String(text).trim().charAt(0).toUpperCase() || "V");
  }

  function art(song, cls) {
    var cover = song && song.cover && song.cover.indexOf("https://") === 0 ? song.cover : "";
    var blob = song && blobUrls[song.id + ":cover"];
    var img = cover || blob ? '<img src="' + esc(cover || blob) + '" alt="" referrerpolicy="no-referrer">' : "";
    return '<span class="' + cls + '">' + img + '<span class="mu-letter">' + letter(song) + "</span></span>";
  }

  function coverBox(node) {
    var box = node && node.parentNode;
    if (!box || !box.classList) return null;
    if (box.classList.contains("mu-cover") || box.classList.contains("mu-art") || box.classList.contains("mu-release-cover") || box.classList.contains("mu-now-art")) return box;
    return null;
  }

  function markCover(img) {
    var box = coverBox(img);
    if (!box) return;
    if (img.complete && img.naturalWidth) box.classList.add("has-img");
    else box.classList.remove("has-img");
  }

  function onCoverEvent(event) {
    var img = event.target;
    if (!img || img.tagName !== "IMG" || !coverBox(img)) return;
    if (event.type === "error") {
      var box = coverBox(img);
      if (box) box.classList.remove("has-img");
      return;
    }
    markCover(img);
  }

  function settleCovers(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll(".mu-cover img, .mu-art img, .mu-release-cover img, .mu-now-art img").forEach(markCover);
  }

  function offlineState(id) {
    if (ui.offline && ui.offline.id === id) return "busy";
    var saved = local.offline && local.offline[id];
    if (Array.isArray(saved) && saved.length) return "ready";
    return "idle";
  }

  function offlineText(id) {
    var state = offlineState(id);
    if (state === "busy" && ui.offline && ui.offline.total) return tr("Downloading {done}/{total}", { done: ui.offline.done, total: ui.offline.total });
    if (state === "busy") return tr("Downloading");
    if (state === "ready") return tr("Downloaded");
    return tr("Download");
  }

  function offlineAria(id) {
    var state = offlineState(id);
    if (state === "busy") return offlineText(id);
    if (state === "ready") return tr("Remove download");
    return tr("Download for offline");
  }

  function offlineButton(song, withLabel) {
    if (!song || song.kind !== "hls" || !song.id) return "";
    var state = offlineState(song.id);
    var cls = "mu-save" + (state === "ready" ? " is-saved" : "") + (state === "busy" ? " is-busy" : "");
    return '<button type="button" class="' + cls + '" data-act="music-offline" data-id="' + esc(song.id) + '" aria-label="' + esc(offlineAria(song.id)) + '"' + (state === "busy" ? ' aria-busy="true"' : "") + ">" + svg(CTRL.save) + (withLabel ? "<span>" + esc(offlineText(song.id)) + "</span>" : "") + "</button>";
  }

  function releases() {
    return songs().filter(function (song) { return song && song.released; }).sort(function (a, b) {
      return String(b.released).localeCompare(String(a.released));
    });
  }

  function releaseHtml(song) {
    var when = formatReleased(song && song.released);
    var meta = [];
    if (song && song.duration) meta.push(formatTime(song.duration));
    if (song && song.genre) meta.push(song.genre);
    if (when) meta.push(when);
    return '<article class="mu-release" data-mu-id="' + esc(song.id) + '">' +
      '<button class="mu-release-play" type="button" data-act="music-play" data-id="' + esc(song.id) + '" aria-label="' + esc(tr("Play {title}", { title: song.title || tr("song") })) + '">' + art(song, "mu-release-cover") + "</button>" +
      '<div class="mu-release-copy"><p class="mu-kicker">' + tr("New release") + "</p><h2>" + esc(song.title || tr("Untitled")) + "</h2>" +
      '<p class="mu-by">' + esc(song.artist || tr("Unknown artist")) + "</p>" +
      (song && song.style ? '<p class="mu-style">' + esc(song.style) + "</p>" : "") +
      '<p class="mu-meta">' + esc(meta.join(" · ")) + "</p>" +
      '<div class="mu-pills">' + (song && song.lossless ? '<span class="mu-badge">' + tr("Lossless") + "</span>" : "") + "</div>" +
      '<div class="mu-release-actions"><button class="mu-play-pill" type="button" data-act="music-play" data-id="' + esc(song.id) + '">' + tr("Play") + "</button>" + offlineButton(song, true) + "</div></div></article>";
  }

  function tile(song) {
    var on = currentSong() && currentSong().id === song.id;
    return '<button class="mu-tile' + (on ? " is-current" : "") + '" type="button" data-act="music-play" data-id="' + esc(song.id) + '" data-mu-id="' + esc(song.id) + '">' +
      art(song, "mu-cover") + "<b>" + esc(song.title || tr("Untitled")) + "</b><span>" + esc(song.artist || tr("Unknown artist")) + "</span>" +
      '<span class="mu-sub">' + esc(song.duration ? formatTime(song.duration) : "") + "</span>" +
      (song.lossless ? '<span class="mu-badge">' + tr("Lossless") + "</span>" : "") + "</button>";
  }

  function row(song, listName) {
    var on = currentSong() && currentSong().id === song.id;
    var eq = on && play.playing ? '<span class="mu-eq" aria-hidden="true"><i></i><i></i><i></i></span>' : "";
    return '<div class="mu-row' + (on ? " is-current" : "") + '" draggable="true" data-mu-drag="' + esc(listName || "library") + '" data-id="' + esc(song.id) + '" data-mu-id="' + esc(song.id) + '">' +
      '<button class="mu-open" type="button" data-act="music-play" data-id="' + esc(song.id) + '">' + art(song, "mu-art") +
      '<span class="mu-copy"><b>' + esc(song.title || tr("Untitled")) + "</b><span>" + esc(song.artist || tr("Unknown artist")) + "</span></span></button>" +
      eq + '<span class="mu-dur">' + esc(song.duration ? formatTime(song.duration) : "") + "</span>" +
      (song.lossless ? '<span class="mu-badge">' + tr("Lossless") + "</span>" : "") +
      '<span class="mu-actions">' + offlineButton(song, false) + '<button class="icon-btn mu-like' + (liked(song.id) ? " on" : "") + '" type="button" data-act="music-like" data-id="' + esc(song.id) + '" aria-label="' + tr("Liked songs") + '">' + svg(liked(song.id) ? HEART_ON : HEART) + "</button>" +
      '<button class="icon-btn" type="button" data-act="music-up" data-id="' + esc(song.id) + '" data-list="' + esc(listName || "library") + '" aria-label="' + tr("Move up") + '">' + svg(CTRL.up) + "</button>" +
      '<button class="icon-btn" type="button" data-act="music-down" data-id="' + esc(song.id) + '" data-list="' + esc(listName || "library") + '" aria-label="' + tr("Move down") + '">' + svg(CTRL.down) + "</button>" +
      '<a class="icon-btn" href="#/music/edit/' + encodeURIComponent(song.id) + '" aria-label="' + tr("Edit song") + '">' + tr("Edit") + "</a>" +
      '<button class="icon-btn" type="button" data-act="music-ask-delete" data-id="' + esc(song.id) + '" aria-label="' + tr("Delete") + '">' + tr("Delete") + "</button></span></div>";
  }

  function shelf(title, body) {
    return '<section><div class="mu-shelf-head"><h2>' + esc(title) + "</h2></div>" + body + "</section>";
  }

  function empty(title, body) {
    return '<div class="empty"><h2>' + esc(title) + "</h2><p>" + esc(body) + ("</p><p><a href=\"#/music/add\"" + ">" + tr("Add song") + "<" + "/a></p></div>");
  }

  function viewTools() {
    var grid = local.view !== "list";
    return '<div class="mu-tools"><div class="mu-view"><button type="button" class="' + (grid ? "on" : "") + ("\" data-act=\"music-view\" data-view=\"grid\" " + "aria-label=\"" + tr("Grid") + "\"" + ">") + svg("M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z") + '</button><button type="button" class="' + (grid ? "" : "on") + ("\" data-act=\"music-view\" data-view=\"list\" " + "aria-label=\"" + tr("List") + "\"" + ">") + svg("M4 5h16v3H4V5zm0 5.5h16v3H4v-3zM4 16h16v3H4v-3z") + "</button></div></div>";
  }

  function songList(list, name) {
    if (!list.length) return empty(tr("No songs yet"), tr("Add a song with a direct audio link, a YouTube link, or a file on this device."));
    if (local.view === "list" || name !== "library") return '<div class="mu-list">' + list.map(function (song) { return row(song, name); }).join("") + "</div>";
    return '<div class="mu-grid">' + list.map(tile).join("") + "</div>";
  }

  function filtered(query) {
    var q = String(query || "").trim().toLowerCase();
    return songs().filter(function (song) {
      if (!q) return true;
      return (song.title + " " + song.artist + " " + song.album).toLowerCase().indexOf(q) >= 0;
    });
  }

  function form(song) {
    var draft = ui.draft || {};
    var value = function (key, fallback) {
      if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
      return fallback || "";
    };
    return '<form class="mu-form" data-act="music-save-form">' +
      '<label class="field"><span>' + tr("Title") + '</span><input id="mu-title" value="' + esc(value("mu-title", song && song.title)) + '" maxlength="200" required></label>' +
      '<label class="field"><span>' + tr("Artist") + '</span><input id="mu-artist" value="' + esc(value("mu-artist", song && song.artist)) + '" maxlength="200"></label>' +
      '<label class="field"><span>' + tr("Album") + '</span><input id="mu-album" value="' + esc(value("mu-album", song && song.album)) + '" maxlength="200"></label>' +
      '<label class="field"><span>' + tr("Cover URL") + '</span><input id="mu-cover-url" type="url" inputmode="url" placeholder="https://" value="' + esc(value("mu-cover-url", song && song.cover && song.cover.indexOf("https://") === 0 ? song.cover : "")) + '"></label>' +
      '<label class="mu-file">' + tr("Cover file") + '<input id="mu-cover-file" type="file" accept="image/*"></label>' +
      '<label class="field"><span>' + tr("Audio URL") + '</span><input id="mu-audio-url" type="url" inputmode="url" placeholder="' + tr("https:// or a YouTube link") + '" value="' + esc(value("mu-audio-url", song && song.kind !== "hls" && song.source && song.source.indexOf("idb:") !== 0 ? song.source : "")) + '"></label>' +
      '<label class="mu-file">' + tr("Audio file") + '<input id="mu-audio-file" type="file" accept="audio/*,.mp3,.m4a,.ogg,.opus,.aac,.wav"></label>' +
      (song ? '<input type="hidden" id="mu-edit-id" value="' + esc(song.id) + '">' : "") +
      ("<p class=\"mu-note\"" + ">" + tr("A file stays on this device. A direct https link can be published to the site by the owner. Radio shuffles this library. No paid catalog is used.") + "<" + "/p>") +
      '<div class="row-actions"><button class="save" type="button" data-act="music-save">' + (song ? tr("Save") : tr("Add song")) + ("</button><button class=\"save\" type=\"button\" data-act=\"music-publish\"" + ">" + tr("Publish library to the site") + "<" + "/button></div></form>");
  }

  function page(route) {
    var section = (route && route.section) || "home";
    var id = (route && route.id) || "";
    var all = songs();
    if (section === "search") {
      return head(tr("Search")) + ("<div class=\"mu-search\"><label class=\"search\"><input id=\"mu-q\" type=\"search\" " + "placeholder=\"" + tr("Search songs") + "\"" + " " + "aria-label=\"" + tr("Search songs") + "\"" + " value=\"") + esc(ui.q) + '"></label></div><div class="mu-results">' + (ui.q ? songList(filtered(ui.q), "library") : empty(tr("Search {music}", { music: productName("music") }), tr("Find a song by title, artist, or album."))) + "</div>";
    }
    if (section === "library") {
      return head(tr("Your Library"), viewTools()) + songList(all, "library") + confirmHtml() + ("<div class=\"mu-form\"><button class=\"save\" type=\"button\" data-act=\"music-publish\"" + ">" + tr("Publish library to the site") + "<" + "/button></div>");
    }
    if (section === "playlists") {
      var cards = playlists().map(function (list) {
        return '<a class="mu-tile" href="#/music/playlist/' + encodeURIComponent(list.id) + '">' + art({ title: list.name }, "mu-cover") + "<b>" + esc(list.name) + "</b><span>" + esc(trn("songs", (list.songIds || []).length)) + "</span></a>";
      }).join("");
      return head(tr("Playlists")) + (cards ? '<div class="mu-grid">' + cards + "</div>" : empty(tr("No playlists yet"), tr("Name one below."))) +
        ("<form class=\"mu-form\" data-act=\"music-pl-form\"><label class=\"field\"><span" + ">" + tr("New playlist") + "<" + "/span><input id=\"mu-pl-name\" value=\"") + esc(ui.plName) + ("\" maxlength=\"80\"></label><button class=\"save\" type=\"button\" data-act=\"music-pl-create\"" + ">" + tr("Create playlist") + "<" + "/button></form>");
    }
    if (section === "playlist") {
      var list = playlistById(id);
      if (!list) return head(tr("Playlist")) + empty(tr("Playlist not found"), tr("It may have been removed on this device."));
      var rows = (list.songIds || []).map(songById).filter(Boolean);
      var rest = all.filter(function (song) { return (list.songIds || []).indexOf(song.id) < 0; });
      var add = rest.length ? ("<div class=\"mu-shelf-head\"><h2" + ">" + tr("Add songs") + "<" + "/h2></div><div class=\"mu-list\">") + rest.map(function (song) {
        return '<div class="mu-row"><button class="mu-open" type="button" data-act="music-pl-add" data-id="' + esc(song.id) + '" data-list="' + esc(list.id) + '">' + art(song, "mu-art") + '<span class="mu-copy"><b>' + esc(song.title) + "</b><span>" + esc(song.artist) + "</span></span></button></div>";
      }).join("") + "</div>" : "";
      return head(list.name) + songList(rows, "playlist:" + list.id) + add;
    }
    if (section === "liked") {
      var loved = all.filter(function (song) { return liked(song.id); });
      return head(tr("Liked songs")) + (loved.length ? songList(loved, "liked") : empty(tr("No liked songs"), tr("Hearts you tap stay on this device.")));
    }
    if (section === "add") return head(tr("Add song")) + form(null);
    if (section === "edit") {
      var editing = songById(id);
      if (!editing) return head(tr("Edit song")) + empty(tr("Song not found"), tr("It is not in this library."));
      return head(tr("Edit song")) + form(editing) + confirmHtml();
    }
    if (section === "radio") {
      return head(tr("Radio")) + '<div class="mu-form"><p class="mu-note">' + tr("Radio shuffles every song in this library. Nothing is recommended by a paid service.") + '</p><button class="save" type="button" data-act="music-radio"' + (all.length ? "" : " disabled") + (">" + tr("Start radio") + "<" + "/button></div>") + (all.length ? songList(all, "library") : empty(tr("No songs yet"), tr("Add a song before starting radio.")));
    }
    var fresh = releases();
    var recent = all.slice(0, 12);
    var pl = playlists().slice(0, 8).map(function (list) {
      return '<a class="mu-card" href="#/music/playlist/' + encodeURIComponent(list.id) + '">' + art({ title: list.name }, "mu-cover") + "<b>" + esc(list.name) + "</b><span>" + esc(trn("songs", (list.songIds || []).length)) + "</span></a>";
    }).join("");
    return head(productName("music")) +
      (fresh.length ? shelf(tr("New release"), fresh.map(function (song) { return releaseHtml(song); }).join("")) : "") +
      (recent.length ? shelf(tr("Songs"), '<div class="mu-hscroll">' + recent.map(tile).join("") + "</div>") : empty(tr("No songs yet"), tr("Add a song with a direct audio link, a YouTube link, or a file on this device."))) +
      (pl ? shelf(tr("Playlists"), '<div class="mu-hscroll">' + pl + "</div>") : "") +
      shelf(tr("Library"), '<div class="mu-grid"><a class="mu-tile" href="#/music/library">' + art({ title: tr("Library") }, "mu-cover") + "<b>" + tr("Your Library") + "</b><span>" + esc(trn("songs", all.length)) + '</span></a><a class="mu-tile" href="#/music/liked">' + art({ title: tr("Liked") }, "mu-cover") + "<b>" + tr("Liked songs") + "</b><span>" + esc(String((local.likes || []).length)) + "</span></a></div>");
  }

  function confirmHtml() {
    if (!ui.confirm) return "";
    var song = songById(ui.confirm);
    return '<div class="mu-confirm">' + tr("Delete {title}?", { title: esc(song ? song.title : tr("this song")) }) + ' <button class="save" type="button" data-act="music-delete" data-id="' + esc(ui.confirm) + ("\"" + ">" + tr("Delete") + "<" + "/button><button class=\"save\" type=\"button\" data-act=\"music-cancel-delete\"" + ">" + tr("Cancel") + "<" + "/button></div>");
  }

  function field(id) {
    var el = document.getElementById(id);
    if (el && typeof el.value === "string") return el.value.trim();
    return String((ui.draft && ui.draft[id]) || "").trim();
  }

  function newId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function idb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("storage")); return; }
      var req = root.indexedDB.open("sintel-music", 1); /* kept so saved audio files stay */
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(key, blob) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put(blob, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("files", "readonly");
        var req = tx.objectStore("files").get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function rememberFile(id, kind, file) {
    var key = id + ":" + kind;
    return idbPut(key, file).then(function () {
      if (blobUrls[key]) URL.revokeObjectURL(blobUrls[key]);
      blobUrls[key] = URL.createObjectURL(file);
      return "idb:" + key;
    });
  }

  function fileOf(input) {
    var el = document.getElementById(input);
    if (!el || !el.files || !el.files[0]) return null;
    return el.files[0];
  }

  function resolveArchive(ident) {
    return fetch("https://archive.org/metadata/" + encodeURIComponent(ident)).then(function (res) {
      if (!res.ok) throw new Error("archive");
      return res.json();
    }).then(function (meta) {
      var files = (meta && meta.files) || [];
      var order = ["mp3", "m4a", "ogg", "opus", "aac", "wav"];
      var name = "";
      for (var i = 0; i < order.length && !name; i++) {
        for (var j = 0; j < files.length; j++) {
          var candidate = String(files[j].name || "");
          if (candidate.toLowerCase().slice(-(order[i].length + 1)) === "." + order[i]) { name = candidate; break; }
        }
      }
      if (!name) throw new Error("archive");
      return "https://archive.org/download/" + encodeURIComponent(ident) + "/" + name.split("/").map(encodeURIComponent).join("/");
    });
  }

  function isLocalSong(id) {
    return (local.songs || []).some(function (song) { return song.id === id; });
  }

  function writeSong(song) {
    if (isLocalSong(song.id)) {
      local.songs = local.songs.map(function (item) { return item.id === song.id ? song : item; });
    } else if ((remote.songs || []).some(function (item) { return item.id === song.id; })) {
      local.edits[song.id] = copySong(song);
    } else {
      local.songs.push(song);
    }
    if (local.order.indexOf(song.id) < 0) local.order.push(song.id);
    save();
  }

  function removeSong(id) {
    if (isLocalSong(id)) local.songs = local.songs.filter(function (song) { return song.id !== id; });
    else if (local.hidden.indexOf(id) < 0) local.hidden.push(id);
    delete local.edits[id];
    local.order = local.order.filter(function (item) { return item !== id; });
    local.likes = local.likes.filter(function (item) { return item !== id; });
    local.playlists = (local.playlists || []).map(function (list) {
      return { id: list.id, name: list.name, songIds: (list.songIds || []).filter(function (item) { return item !== id; }) };
    });
    if (local.playlistTouched) local.playlists = local.playlists;
    play.queue = play.queue.filter(function (item) { return item !== id; });
    save();
  }

  function moveSong(listName, id, dir) {
    if (String(listName).indexOf("playlist:") === 0) {
      var listId = listName.slice(9);
      touchPlaylists();
      var lists = local.playlists.map(function (list) {
        if (list.id !== listId) return list;
        var ids = (list.songIds || []).slice();
        var index = ids.indexOf(id);
        var next = index + dir;
        if (index < 0 || next < 0 || next >= ids.length) return list;
        var swapped = ids.slice();
        var hold = swapped[index];
        swapped[index] = swapped[next];
        swapped[next] = hold;
        return { id: list.id, name: list.name, songIds: swapped };
      });
      local.playlists = lists;
      save();
      hooks.render();
      return;
    }
    var ids = songs().map(function (song) { return song.id; });
    var index = ids.indexOf(id);
    var next = index + dir;
    if (index < 0 || next < 0 || next >= ids.length) return;
    var hold = ids[index];
    ids[index] = ids[next];
    ids[next] = hold;
    local.order = ids;
    save();
    hooks.render();
  }

  function touchPlaylists() {
    if (!local.playlistTouched) {
      local.playlists = playlists().map(function (list) {
        return { id: list.id, name: list.name, songIds: (list.songIds || []).slice() };
      });
      local.playlistTouched = true;
    }
  }

  function saveForm() {
    var title = field("mu-title");
    if (!title) { hooks.toast(tr("Add a title")); return; }
    var audioFile = fileOf("mu-audio-file");
    var coverFile = fileOf("mu-cover-file");
    if (audioFile && audioFile.size > 40 * 1024 * 1024) { hooks.toast(tr("Audio files stay under 40 MB")); return; }
    if (coverFile && coverFile.size > 3 * 1024 * 1024) { hooks.toast(tr("Cover images stay under 3 MB")); return; }
    var existing = songById(field("mu-edit-id"));
    var sourceText = field("mu-audio-url");
    var coverText = field("mu-cover-url");
    var ready = Promise.resolve({ source: existing ? existing.source : "", kind: existing ? existing.kind : "", cover: existing ? existing.cover : "" });
    if (coverText) {
      if (coverText.indexOf("https://") !== 0 || localHost((function () { try { return new URL(coverText).hostname; } catch (err) { return "bad"; } })())) {
        hooks.toast(tr("Cover links use https"));
        return;
      }
    }
    if (!audioFile && sourceText) {
      var streamKind = classifyStream(sourceText);
      var kind = streamKind.ok ? { ok: true, kind: "hls", url: streamKind.url } : classifySource(sourceText);
      if (!kind.ok) { hooks.toast(tr("Use an https audio, YouTube, or Archive link")); return; }
      if (kind.kind === "archive") {
        ready = resolveArchive(kind.id).then(function (url) {
          return { source: url, kind: "audio", cover: coverText };
        });
      } else if (kind.kind === "hls") {
        ready = Promise.resolve({ source: "", kind: "hls", stream: kind.url, cover: coverText });
      } else {
        ready = Promise.resolve({ source: kind.url, kind: kind.kind === "youtube" ? "youtube" : "audio", cover: coverText });
      }
    } else if (!audioFile && !existing) {
      hooks.toast(tr("Add an audio link or a file"));
      return;
    } else if (coverText) {
      ready = Promise.resolve({ source: existing ? existing.source : "", kind: existing ? existing.kind : "audio", cover: coverText });
    }
    var id = existing ? existing.id : newId();
    ready.then(function (next) {
      var store = Promise.resolve(next);
      if (audioFile) {
        store = rememberFile(id, "audio", audioFile).then(function (key) {
          next.source = key;
          next.kind = "audio";
          return next;
        });
      }
      if (coverFile) {
        store = store.then(function (value) {
          return rememberFile(id, "cover", coverFile).then(function (key) {
            value.cover = key;
            return value;
          });
        });
      }
      return store;
    }).then(function (next) {
      var stored = {
        id: id,
        title: title,
        artist: field("mu-artist"),
        album: field("mu-album"),
        cover: next.cover || "",
        source: next.source,
        kind: next.kind || "audio",
        duration: existing ? existing.duration : 0,
        license: existing ? existing.license : ""
      };
      var keptStream = next.stream || (existing && !sourceText && !audioFile ? existing.stream : "");
      if (keptStream) stored.stream = keptStream;
      if (existing && existing.released) stored.released = existing.released;
      if (existing && existing.genre) stored.genre = existing.genre;
      if (existing && existing.style) stored.style = existing.style;
      if (existing && existing.mood) stored.mood = existing.mood;
      if (existing && existing.bpm) stored.bpm = existing.bpm;
      if (existing && existing.language) stored.language = existing.language;
      if ((existing && existing.lossless) || stored.kind === "hls") stored.lossless = true;
      writeSong(stored);
      ui.draft = {};
      hooks.toast(tr("Saved on this device"));
      hooks.go("#/music/library");
    }).catch(function () { hooks.toast(tr("That audio link didn’t resolve")); });
  }

  function publishBody() {
    var kept = {};
    var list = publishable(songs()).map(function (song) {
      kept[song.id] = true;
      var cover = song.cover.indexOf("https://") === 0 ? song.cover : "";
      var row = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        cover: cover,
        source: song.kind === "hls" ? "" : song.source,
        kind: song.kind === "youtube" ? "youtube" : song.kind === "hls" ? "hls" : "audio",
        duration: song.duration || 0
      };
      if (song.stream) row.stream = song.stream;
      if (song.released) row.released = song.released;
      if (song.genre) row.genre = song.genre;
      if (song.style) row.style = song.style;
      if (song.mood) row.mood = song.mood;
      if (song.bpm) row.bpm = song.bpm;
      if (song.language) row.language = song.language;
      if (song.lossless) row.lossless = true;
      return row;
    });
    var lists = playlists().map(function (item) {
      return { id: item.id, name: item.name, songIds: (item.songIds || []).filter(function (id) { return kept[id]; }) };
    }).filter(function (item) { return item.songIds.length || item.name; });
    return JSON.stringify({ updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), songs: list, playlists: lists }, null, 2);
  }

  function publish() {
    var body = publishBody();
    var repo = hooks.repo() || "";
    var note = tr("Only an issue opened by the owner is applied. Uploaded files stay on this device.");
    if (!repo) {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(body).catch(function () {});
      hooks.toast(tr("Catalog copied. Paste it into the issue.") + " " + note);
      return;
    }
    var base = "https://github.com/" + repo + "/issues/new?template=music-catalog.yml&title=" + encodeURIComponent(tr("Music catalog"));
    var url = base + "&catalog=" + encodeURIComponent(body);
    if (url.length > 6000) {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(body).catch(function () {});
      hooks.toast(tr("Catalog copied. Paste it into the issue.") + " " + note);
      window.open(base, "_blank", "noopener");
      return;
    }
    hooks.toast(note);
    window.open(url, "_blank", "noopener");
  }

  function queueFrom(id, ids) {
    var list = (ids || songs().map(function (song) { return song.id; })).slice();
    if (local.shuffle) {
      var rest = list.filter(function (item) { return item !== id; });
      for (var i = rest.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var hold = rest[i];
        rest[i] = rest[j];
        rest[j] = hold;
      }
      list = [id].concat(rest);
    }
    play.queue = list;
    play.index = Math.max(0, list.indexOf(id));
  }

  function playSong(id, ids) {
    var song = songById(id);
    if (!song) return;
    queueFrom(id, ids);
    startCurrent(true);
  }

  function startCurrent(fromUser) {
    var song = currentSong();
    playToken += 1;
    if (!song) { pauseAll(); paint(); return; }
    if (song.kind === "hls" || streamReady(song)) startHls(song, fromUser, playToken);
    else if (song.kind === "youtube" || classifySource(song.source).kind === "youtube") startYouTube(song, fromUser);
    else startAudio(song, fromUser);
  }

  function sourceUrl(song) {
    if (song.source && song.source.indexOf("idb:") === 0) {
      var key = song.source.slice(4);
      if (blobUrls[key]) return Promise.resolve(blobUrls[key]);
      return idbGet(key).then(function (blob) {
        if (!blob) throw new Error("file");
        blobUrls[key] = URL.createObjectURL(blob);
        return blobUrls[key];
      });
    }
    var kind = classifySource(song.source);
    if (kind.kind === "archive") return resolveArchive(kind.id);
    return Promise.resolve(song.source);
  }

  function loadMusicHls() {
    if (musicHls) return Promise.resolve(musicHls);
    if (loadMusicHls.promise) return loadMusicHls.promise;
    loadMusicHls.promise = new Promise(function (resolve) {
      var previous = root.Hls;
      var script = document.createElement("script");
      script.src = HLS_SRC;
      script.onload = function () {
        musicHls = root.Hls || null;
        if (previous) root.Hls = previous;
        else {
          try { delete root.Hls; } catch (err) { root.Hls = undefined; }
        }
        resolve(musicHls);
      };
      script.onerror = function () { resolve(null); };
      document.head.appendChild(script);
    });
    return loadMusicHls.promise;
  }

  function destroyHls() {
    if (hls && hls.destroy) {
      try { hls.destroy(); } catch (err) { /* already gone */ }
    }
    hls = null;
  }

  function cacheLoader(HlsCtor) {
    var Xhr = HlsCtor.DefaultConfig.loader;
    function OfflineLoader(config) {
      this.xhr = new Xhr(config);
      this.stats = this.xhr.stats;
      this.context = null;
    }
    OfflineLoader.prototype.load = function (context, config, callbacks) {
      var self = this;
      this.context = context;
      this.stats = this.xhr.stats;
      readCached(context).then(function (hit) {
        if (hit == null) {
          self.xhr.load(context, config, callbacks);
          return;
        }
        var now = root.performance && root.performance.now ? root.performance.now() : Date.now();
        var bytes = hit && hit.byteLength ? hit.byteLength : (hit && hit.length) || 0;
        self.stats = {
          aborted: false,
          loaded: bytes,
          retry: 0,
          total: bytes,
          chunkCount: 1,
          bwEstimate: 0,
          loading: { start: now, first: now, end: now },
          parsing: { start: 0, end: 0 },
          buffering: { start: now, first: now, end: now }
        };
        callbacks.onSuccess({ url: context.url, data: hit, code: 200 }, self.stats, context, null);
      }).catch(function () {
        self.xhr.load(context, config, callbacks);
      });
    };
    OfflineLoader.prototype.abort = function () { if (this.xhr && this.xhr.abort) this.xhr.abort(); };
    OfflineLoader.prototype.destroy = function () { if (this.xhr && this.xhr.destroy) this.xhr.destroy(); };
    return OfflineLoader;
  }

  function readCached(context) {
    if (!root.caches || !context || !context.url) return Promise.resolve(null);
    return caches.open(OFFLINE_CACHE).then(function (cache) {
      return cache.match(context.url);
    }).then(function (res) {
      if (!res) return null;
      if (context.responseType === "arraybuffer") return res.arrayBuffer();
      if (context.responseType === "json") return res.json();
      return res.text();
    });
  }

  function clearMedia() {
    destroyHls();
    if (!audio) return;
    try { audio.pause(); } catch (err) { /* already paused */ }
    audio.removeAttribute("src");
    try { audio.load(); } catch (err) { /* detached */ }
  }

  function startHls(song, fromUser, token) {
    stopYouTube();
    var url = classifyStream(song && song.stream).url || "";
    if (!url) {
      play.playing = false;
      hooks.toast(tr("That song isn’t available"));
      paint();
      return;
    }
    clearMedia();
    loadMusicHls().then(function (HlsCtor) {
      if (token !== playToken) return;
      if (!currentSong() || currentSong().id !== song.id) return;
      if (!audio) return;
      if (HlsCtor && HlsCtor.isSupported()) {
        var player = new HlsCtor({ enableWorker: false, lowLatencyMode: false, loader: cacheLoader(HlsCtor) });
        hls = player;
        player.on(HlsCtor.Events.ERROR, function (_evt, data) {
          if (!data || !data.fatal || token !== playToken) return;
          play.playing = false;
          hooks.toast(tr("Couldn’t play that song"));
          paint();
        });
        player.on(HlsCtor.Events.MANIFEST_PARSED, function () {
          if (token !== playToken) return;
          var attempt = audio.play();
          if (attempt && attempt.catch) attempt.catch(function () { play.playing = false; paint(); });
        });
        player.attachMedia(audio);
        player.loadSource(url);
        play.playing = true;
        paint();
        session(song);
        return;
      }
      if (audio.canPlayType("application/vnd.apple.mpegurl") || audio.canPlayType("application/x-mpegURL")) {
        audio.src = url;
        audio.volume = local.volume;
        var attempt = audio.play();
        if (attempt && attempt.catch) attempt.catch(function () { play.playing = false; paint(); });
        play.playing = true;
        paint();
        session(song);
        return;
      }
      play.playing = false;
      hooks.toast(tr("Couldn’t play that song"));
      paint();
    });
    if (!fromUser) paint();
  }

  function startAudio(song, fromUser) {
    stopYouTube();
    destroyHls();
    sourceUrl(song).then(function (url) {
      if (!audio) return;
      if (audio.getAttribute("data-src") !== url) {
        audio.setAttribute("data-src", url);
        audio.src = url;
      }
      audio.volume = local.volume;
      var attempt = audio.play();
      if (attempt && attempt.catch) attempt.catch(function () { play.playing = false; paint(); });
      play.playing = true;
      paint();
      session(song);
    }).catch(function () {
      play.playing = false;
      hooks.toast(tr("Couldn’t play that song"));
      paint();
    });
    if (!fromUser) paint();
  }

  function ensureYouTube(done) {
    if (root.YT && root.YT.Player) { done(); return; }
    var previous = root.onYouTubeIframeAPIReady;
    root.onYouTubeIframeAPIReady = function () {
      if (typeof previous === "function") previous();
      ytReady = true;
      done();
    };
    if (!document.getElementById("mu-yt-api")) {
      var script = document.createElement("script");
      script.id = "mu-yt-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  }

  function startYouTube(song, fromUser) {
    destroyHls();
    if (audio) { audio.pause(); }
    var id = youtubeId(song.source);
    if (!id) { hooks.toast(tr("That YouTube link has no video id")); return; }
    ytPending = id;
    ensureYouTube(function () {
      if (!document.getElementById("mu-yt")) return;
      if (!yt) {
        yt = new root.YT.Player("mu-yt", {
          host: "https://www.youtube-nocookie.com",
          width: 200,
          height: 200,
          videoId: id,
          playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
          events: {
            onReady: function (event) {
              ytReady = true;
              event.target.setVolume(Math.round(local.volume * 100));
              if (ytPending) event.target.loadVideoById(ytPending);
            },
            onStateChange: function (event) {
              var state = event.data;
              if (state === 1) { play.playing = true; paint(); }
              else if (state === 2) { play.playing = false; paint(); }
              else if (state === 0) next(true);
            }
          }
        });
      } else if (yt.loadVideoById) {
        yt.loadVideoById(id);
      }
      play.playing = true;
      paint();
      session(song);
    });
    if (!fromUser) paint();
  }

  function stopYouTube() {
    ytPending = "";
    if (yt && yt.stopVideo) { try { yt.stopVideo(); } catch (err) { /* already gone */ } }
  }

  function pauseAll() {
    play.playing = false;
    if (audio) { try { audio.pause(); } catch (err) { /* already paused */ } }
    if (yt && yt.pauseVideo) { try { yt.pauseVideo(); } catch (err) { /* already paused */ } }
  }

  function toggle() {
    var song = currentSong();
    if (!song) {
      var first = songs()[0];
      if (first) playSong(first.id);
      return;
    }
    if (play.playing) { pauseAll(); clearSessionIfIdle(); paint(); return; }
    if (song.kind === "hls" && hls && audio) {
      var hlsAttempt = audio.play();
      if (hlsAttempt && hlsAttempt.catch) hlsAttempt.catch(function () {});
      play.playing = true;
    } else if ((song.kind === "youtube" || classifySource(song.source).kind === "youtube") && yt && yt.playVideo) {
      yt.playVideo();
      play.playing = true;
    } else if (audio && audio.src) {
      var attempt = audio.play();
      if (attempt && attempt.catch) attempt.catch(function () {});
      play.playing = true;
    } else startCurrent(true);
    session(song);
    paint();
  }

  function next(fromEnd) {
    if (!play.queue.length) return;
    if (local.repeat === "one" && fromEnd) { startCurrent(true); return; }
    if (play.index + 1 >= play.queue.length) {
      if (local.repeat === "all") play.index = 0;
      else { pauseAll(); paint(); return; }
    } else play.index += 1;
    startCurrent(true);
  }

  function prev() {
    var time = audio && audio.src ? audio.currentTime : (yt && yt.getCurrentTime ? yt.getCurrentTime() : 0);
    if (time > 3) { seekTo(0); return; }
    if (play.index > 0) play.index -= 1;
    startCurrent(true);
  }

  function seekTo(sec) {
    if (audio && audio.src) audio.currentTime = sec;
    if (yt && yt.seekTo) yt.seekTo(sec, true);
  }

  function position() {
    var song = currentSong();
    var cur = 0;
    var dur = song && song.duration ? song.duration : 0;
    if (audio && audio.src && classifySource(song && song.source).kind !== "youtube") {
      cur = audio.currentTime || 0;
      if (audio.duration && isFinite(audio.duration)) dur = audio.duration;
    } else if (yt && yt.getCurrentTime) {
      cur = yt.getCurrentTime() || 0;
      if (yt.getDuration && yt.getDuration()) dur = yt.getDuration();
    }
    return { cur: cur, dur: dur };
  }

  function session(song) {
    if (!navigator.mediaSession || !song || !active) return;
    try {
      var artworks = [];
      if (song.cover && song.cover.indexOf("https://") === 0) {
        var artType = "image/jpeg";
        if (/\.png(\?|$)/i.test(song.cover)) artType = "image/png";
        else if (/\.webp(\?|$)/i.test(song.cover)) artType = "image/webp";
        artworks.push({ src: song.cover, sizes: "512x512", type: artType });
      }
      navigator.mediaSession.metadata = new MediaMetadata({ title: song.title || productName("musicShort"), artist: song.artist || productName("musicShort"), album: song.album || "", artwork: artworks });
      var set = function (name, fn) { try { navigator.mediaSession.setActionHandler(name, fn); } catch (err) { /* unsupported */ } };
      set("play", function () { if (!play.playing) toggle(); });
      set("pause", function () { if (play.playing) toggle(); });
      set("previoustrack", prev);
      set("nexttrack", function () { next(false); });
      set("seekto", function (details) { if (details && typeof details.seekTime === "number") seekTo(details.seekTime); });
      set("seekbackward", function () { var pos = position(); seekTo(Math.max(0, pos.cur - 10)); });
      set("seekforward", function () { var pos = position(); seekTo(pos.cur + 10); });
    } catch (err) { /* metadata is optional */ }
  }

  function clearSession() {
    if (!navigator.mediaSession) return;
    try {
      navigator.mediaSession.metadata = null;
      ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"].forEach(function (name) {
        try { navigator.mediaSession.setActionHandler(name, null); } catch (err) { /* unsupported */ }
      });
    } catch (err) { /* already clear */ }
  }

  function clearSessionIfIdle() {}

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function paint() {
    if (!active || typeof document === "undefined") return;
    var song = currentSong();
    var dock = document.getElementById("mu-dock");
    if (dock) dock.hidden = false;
    text("mu-dock-title", song ? (song.title || tr("Untitled")) : tr("Not playing"));
    text("mu-dock-artist", song ? (song.artist || "") : productName("musicShort"));
    text("mu-now-title", song ? (song.title || tr("Untitled")) : tr("Not playing"));
    text("mu-now-artist", song ? (song.artist || "") : "");
    var pos = position();
    var seek = document.getElementById("mu-seek");
    var nowSeek = document.getElementById("mu-now-seek");
    if (seek && document.activeElement !== seek) {
      seek.max = String(pos.dur || 0);
      seek.value = String(pos.cur || 0);
    }
    if (nowSeek && document.activeElement !== nowSeek) {
      nowSeek.max = String(pos.dur || 0);
      nowSeek.value = String(pos.cur || 0);
    }
    text("mu-time", formatTime(pos.cur));
    text("mu-end", formatTime(pos.dur));
    text("mu-now-time", formatTime(pos.cur));
    text("mu-now-end", formatTime(pos.dur));
    if (paintedPlaying !== play.playing) {
      paintedPlaying = play.playing;
      ["mu-play", "mu-now-play"].forEach(function (key) {
        var button = document.getElementById(key);
        if (!button) return;
        button.innerHTML = svg(play.playing ? CTRL.pause : CTRL.play);
        button.setAttribute("aria-label", play.playing ? tr("Pause") : tr("Play"));
      });
    }
    var shuffle = document.querySelector("[data-act='music-shuffle']");
    if (shuffle) shuffle.setAttribute("aria-pressed", local.shuffle ? "true" : "false");
    var repeat = document.querySelector("[data-act='music-repeat']");
    if (repeat) {
      repeat.setAttribute("aria-pressed", local.repeat === "off" ? "false" : "true");
      repeat.setAttribute("aria-label", local.repeat === "one" ? tr("Repeat one") : local.repeat === "all" ? tr("Repeat all") : tr("Repeat"));
      var badge = repeat.querySelector("i");
      if (badge) badge.textContent = local.repeat === "one" ? "1" : "";
    }
    var box = document.getElementById("mu-now");
    if (box) box.hidden = !ui.now;
    document.querySelectorAll("[data-mu-id]").forEach(function (el) {
      var rowId = el.getAttribute("data-mu-id");
      el.classList.toggle("is-current", !!(song && song.id === rowId));
    });
    var artId = song ? song.id : "";
    if (artId !== paintedId) {
      paintedId = artId;
      paintArt("mu-dock-art", song);
      paintArt("mu-now-art", song);
      var pills = document.getElementById("mu-now-pills");
      if (pills) pills.innerHTML = song && song.lossless ? '<span class="mu-badge">' + tr("Lossless") + "</span>" : "";
    }
    var offlineBtn = document.getElementById("mu-now-offline");
    if (offlineBtn) {
      var showOffline = !!(song && song.kind === "hls");
      offlineBtn.hidden = !showOffline;
      if (showOffline) offlineBtn.setAttribute("data-id", song.id);
    }
    paintOfflineButtons();
    if (navigator.mediaSession && navigator.mediaSession.setPositionState && pos.dur) {
      try { navigator.mediaSession.setPositionState({ duration: pos.dur, playbackRate: 1, position: Math.min(pos.cur, pos.dur) }); } catch (err) { /* optional */ }
    }
    if (play.playing && !poll) {
      poll = root.setInterval(function () {
        if (!active || !play.playing) {
          root.clearInterval(poll);
          poll = 0;
          return;
        }
        paint();
      }, 500);
    }
    if (!play.playing && poll) {
      root.clearInterval(poll);
      poll = 0;
    }
  }

  function paintArt(id, song) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = art(song || { title: productName("music") }, "mu-art");
    settleCovers(el);
  }

  function mount() {
    if (document.getElementById("mu-dock")) return;
    var dock = document.createElement("div");
    dock.id = "mu-dock";
    dock.className = "mu-dock";
    dock.hidden = true;
    dock.innerHTML = ("<div class=\"mu-bar\"><button class=\"mu-id\" type=\"button\" data-act=\"music-now\" " + "aria-label=\"" + tr("Now playing") + "\"" + "><span id=\"mu-dock-art\"></span><span class=\"mu-copy\"><b id=\"mu-dock-title\"" + ">" + tr("Not playing") + "<" + "/b><span id=\"mu-dock-artist\">") + productName("musicShort") + '</span></span></button>' +
      ("<div class=\"mu-transport\"><button type=\"button\" class=\"mu-shuffle\" data-act=\"music-shuffle\" " + "aria-label=\"" + tr("Shuffle") + "\"" + " aria-pressed=\"false\">") + svg(CTRL.shuffle) + ("</button><button type=\"button\" data-act=\"music-prev\" " + "aria-label=\"" + tr("Previous") + "\"" + ">") + svg(CTRL.prev) + ("</button><button id=\"mu-play\" class=\"mu-play\" type=\"button\" data-act=\"music-toggle\" " + "aria-label=\"" + tr("Play") + "\"" + ">") + svg(CTRL.play) + ("</button><button type=\"button\" data-act=\"music-next\" " + "aria-label=\"" + tr("Next") + "\"" + ">") + svg(CTRL.next) + ("</button><button type=\"button\" class=\"mu-rep\" data-act=\"music-repeat\" " + "aria-label=\"" + tr("Repeat") + "\"" + " aria-pressed=\"false\">") + svg(CTRL.repeat) + '<i></i></button></div>' +
      ("<div class=\"mu-seek\"><span class=\"mu-time\" id=\"mu-time\">0:00</span><input id=\"mu-seek\" class=\"mu-range\" type=\"range\" min=\"0\" max=\"0\" value=\"0\" step=\"0.1\" " + "aria-label=\"" + tr("Seek") + "\"" + "><span class=\"mu-time\" id=\"mu-end\">0:00</span></div>") +
      ("<div class=\"mu-vol\"><button type=\"button\" " + "aria-label=\"" + tr("Volume") + "\"" + ">") + svg(CTRL.vol) + '</button><input id="mu-volume" class="mu-volume" type="range" min="0" max="1" step="0.01" value="' + String(local.volume) + ("\" " + "aria-label=\"" + tr("Volume") + "\"" + "></div></div>");
    var now = document.createElement("div");
    now.id = "mu-now";
    now.className = "mu-now";
    now.hidden = true;
    now.innerHTML = '<div class="mu-now-top"><button class="mu-ctl" type="button" data-act="music-now-close" aria-label="' + tr("Close") + '">' + svg(CTRL.down) + '</button><div class="mu-now-kicker">' + productName("musicShort") + '</div><button id="mu-now-offline" class="mu-save" type="button" data-act="music-offline" hidden aria-label="' + tr("Download for offline") + '">' + svg(CTRL.save) + '</button></div><div id="mu-now-art" class="mu-now-art"></div><h2 id="mu-now-title">' + tr("Not playing") + '</h2><div class="mu-by" id="mu-now-artist"></div><div class="mu-pills" id="mu-now-pills"></div><div class="mu-seek"><span class="mu-time" id="mu-now-time">0:00</span><input id="mu-now-seek" class="mu-range" type="range" min="0" max="0" value="0" step="0.1" aria-label="' + tr("Seek") + '"><span class="mu-time" id="mu-now-end">0:00</span></div><div class="mu-transport"><button type="button" data-act="music-prev" aria-label="' + tr("Previous") + '">' + svg(CTRL.prev) + '</button><button id="mu-now-play" class="mu-play" type="button" data-act="music-toggle" aria-label="' + tr("Play") + '">' + svg(CTRL.play) + '</button><button type="button" data-act="music-next" aria-label="' + tr("Next") + '">' + svg(CTRL.next) + '</button></div><div class="mu-vol"><button type="button" aria-label="' + tr("Volume") + '">' + svg(CTRL.vol) + '</button><input id="mu-now-volume" class="mu-volume" type="range" min="0" max="1" step="0.01" value="' + String(local.volume) + '" aria-label="' + tr("Volume") + '"></div>';
    var host = document.createElement("div");
    host.id = "mu-yt-host";
    host.innerHTML = '<div id="mu-yt"></div>';
    audio = document.createElement("audio");
    audio.id = "mu-audio";
    audio.preload = "metadata";
    audio.controls = false;
    audio.setAttribute("controlsList", "nodownload");
    audio.setAttribute("playsinline", "");
    audio.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    document.body.appendChild(dock);
    document.body.appendChild(now);
    document.body.appendChild(host);
    document.body.appendChild(audio);
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("ended", function () { next(true); });
    audio.addEventListener("loadedmetadata", function () {
      var song = currentSong();
      if (!song || !audio.duration || !isFinite(audio.duration)) return;
      if (song.duration && Math.abs(song.duration - audio.duration) < 0.75) return;
      song.duration = Math.round(audio.duration);
      writeSong(song);
    });
    audio.addEventListener("play", function () { play.playing = true; paint(); });
    audio.addEventListener("pause", function () { if (active && !ytPending) { play.playing = false; paint(); } });
    document.addEventListener("contextmenu", function (event) {
      var node = event.target;
      if (node && node.closest && node.closest("#mu-dock, #mu-now, #mu-audio, .mu-release")) event.preventDefault();
    });
  }

  function enter() {
    active = true;
    document.documentElement.classList.add("music-on");
    loadMusicHls();
    var dock = document.getElementById("mu-dock");
    if (dock) dock.hidden = false;
    paint();
    var song = currentSong();
    if (song) session(song);
  }

  function leave(route) {
    var was = active;
    active = false;
    ui.now = false;
    if (poll) { root.clearInterval(poll); poll = 0; }
    if (typeof document !== "undefined") document.documentElement.classList.remove("music-on");
    pauseAll();
    if (hls && hls.stopLoad) { try { hls.stopLoad(); } catch (err) { /* already stopped */ } }
    var dock = typeof document !== "undefined" ? document.getElementById("mu-dock") : null;
    var now = typeof document !== "undefined" ? document.getElementById("mu-now") : null;
    if (dock) dock.hidden = true;
    if (now) now.hidden = true;
    if (was && (!route || route.name !== "watch")) clearSession();
  }

  function afterRender(route) {
    if (route && route.name === "music") enter();
    else leave(route);
    if (typeof document !== "undefined") settleCovers(document);
  }

  function onInput(event) {
    var target = event.target;
    if (!target || !target.id) return;
    if (target.id === "mu-q") {
      ui.q = target.value;
      var box = document.querySelector(".mu-results");
      if (box) {
        box.innerHTML = ui.q ? songList(filtered(ui.q), "library") : empty(tr("Search {music}", { music: productName("music") }), tr("Find a song by title, artist, or album."));
        settleCovers(box);
      }
      return;
    }
    if (target.id === "mu-title" || target.id === "mu-artist" || target.id === "mu-album" || target.id === "mu-cover-url" || target.id === "mu-audio-url" || target.id === "mu-pl-name") {
      ui.draft[target.id] = target.value;
      if (target.id === "mu-pl-name") ui.plName = target.value;
    }
    if (target.id === "mu-seek" || target.id === "mu-now-seek") seekTo(Number(target.value) || 0);
    if (target.id === "mu-volume" || target.id === "mu-now-volume") {
      local.volume = Number(target.value);
      if (local.volume > 0) play.lastVolume = local.volume;
      if (audio) audio.volume = local.volume;
      if (yt && yt.setVolume) yt.setVolume(Math.round(local.volume * 100));
      var other = document.getElementById(target.id === "mu-volume" ? "mu-now-volume" : "mu-volume");
      if (other && other !== target) other.value = target.value;
      save();
    }
  }

  function onDragStart(event) {
    var rowEl = event.target.closest && event.target.closest("[data-mu-drag]");
    if (!rowEl) return;
    dragId = rowEl.getAttribute("data-id") || "";
    dragList = rowEl.getAttribute("data-mu-drag") || "";
    if (event.dataTransfer) event.dataTransfer.setData("text/plain", dragId);
  }

  function onDragOver(event) {
    if (!dragId) return;
    var rowEl = event.target.closest && event.target.closest("[data-mu-drag]");
    if (!rowEl || rowEl.getAttribute("data-mu-drag") !== dragList) return;
    event.preventDefault();
  }

  function onDrop(event) {
    var rowEl = event.target.closest && event.target.closest("[data-mu-drag]");
    if (!rowEl || !dragId) return;
    event.preventDefault();
    var to = rowEl.getAttribute("data-id") || "";
    var listName = rowEl.getAttribute("data-mu-drag") || "";
    if (listName.indexOf("playlist:") === 0) {
      var listId = listName.slice(9);
      touchPlaylists();
      local.playlists = local.playlists.map(function (list) {
        if (list.id !== listId) return list;
        return { id: list.id, name: list.name, songIds: reorder(list.songIds || [], dragId, to) };
      });
    } else {
      local.order = reorder(songs().map(function (song) { return song.id; }), dragId, to);
    }
    dragId = "";
    save();
    hooks.render();
  }

  function onAct(act, el) {
    if (String(act || "").indexOf("music-") !== 0) return false;
    var id = (el && el.dataset && el.dataset.id) || "";
    if (act === "music-add") { hooks.go("#/music/add"); return true; }
    if (act === "music-play") {
      var ids = songs().map(function (song) { return song.id; });
      var listName = el && el.closest ? (el.closest("[data-mu-drag]") || {}).getAttribute && el.closest("[data-mu-drag]").getAttribute("data-mu-drag") : "";
      if (listName && listName.indexOf("playlist:") === 0) {
        var found = playlistById(listName.slice(9));
        if (found) ids = (found.songIds || []).slice();
      }
      playSong(id, ids);
      return true;
    }
    if (act === "music-toggle") { toggle(); return true; }
    if (act === "music-prev") { prev(); return true; }
    if (act === "music-next") { next(false); return true; }
    if (act === "music-shuffle") { local.shuffle = !local.shuffle; save(); paint(); return true; }
    if (act === "music-repeat") {
      local.repeat = local.repeat === "off" ? "all" : local.repeat === "all" ? "one" : "off";
      save();
      paint();
      return true;
    }
    if (act === "music-like") {
      if (liked(id)) local.likes = local.likes.filter(function (item) { return item !== id; });
      else local.likes.push(id);
      save();
      hooks.render();
      return true;
    }
    if (act === "music-up" || act === "music-down") {
      moveSong((el.dataset && el.dataset.list) || "library", id, act === "music-up" ? -1 : 1);
      return true;
    }
    if (act === "music-ask-delete") { ui.confirm = id; hooks.render(); return true; }
    if (act === "music-cancel-delete") { ui.confirm = ""; hooks.render(); return true; }
    if (act === "music-delete") {
      removeSong(id);
      ui.confirm = "";
      if (currentSong() && currentSong().id === id) pauseAll();
      hooks.toast(tr("Removed on this device"));
      hooks.render();
      return true;
    }
    if (act === "music-save") { saveForm(); return true; }
    if (act === "music-publish") { publish(); return true; }
    if (act === "music-view") { local.view = el.dataset.view === "list" ? "list" : "grid"; save(); hooks.render(); return true; }
    if (act === "music-pl-create") {
      var name = field("mu-pl-name");
      if (!name) { hooks.toast(tr("Name the playlist")); return true; }
      touchPlaylists();
      local.playlists.push({ id: newId(), name: name, songIds: [] });
      ui.plName = "";
      ui.draft["mu-pl-name"] = "";
      save();
      hooks.render();
      return true;
    }
    if (act === "music-pl-add") {
      var listId = (el.dataset && el.dataset.list) || "";
      touchPlaylists();
      local.playlists = local.playlists.map(function (list) {
        if (list.id !== listId) return list;
        var ids = (list.songIds || []).slice();
        if (ids.indexOf(id) < 0) ids.push(id);
        return { id: list.id, name: list.name, songIds: ids };
      });
      save();
      hooks.render();
      return true;
    }
    if (act === "music-radio") {
      var all = songs();
      if (!all.length) { hooks.toast(tr("Add a song first")); return true; }
      local.shuffle = true;
      save();
      playSong(all[Math.floor(Math.random() * all.length)].id, all.map(function (song) { return song.id; }));
      return true;
    }
    if (act === "music-now") { ui.now = true; paint(); return true; }
    if (act === "music-now-close") { ui.now = false; paint(); return true; }
    if (act === "music-offline") {
      var target = songById(id) || currentSong();
      if (!target) return true;
      if (offlineState(target.id) === "busy") return true;
      if (offlineState(target.id) === "ready") removeOffline(target);
      else saveOffline(target);
      return true;
    }
    return true;
  }

  function paintOfflineButtons() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("[data-act='music-offline']").forEach(function (btn) {
      var id = btn.getAttribute("data-id") || "";
      if (!id) return;
      var state = offlineState(id);
      btn.classList.toggle("is-saved", state === "ready");
      btn.classList.toggle("is-busy", state === "busy");
      btn.setAttribute("aria-label", offlineAria(id));
      if (state === "busy") btn.setAttribute("aria-busy", "true");
      else btn.removeAttribute("aria-busy");
      var label = btn.querySelector("span");
      if (label) label.textContent = offlineText(id);
    });
  }

  function fetchText(url) {
    return fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("offline");
      return res.text().then(function (text) {
        var type = res.headers.get("Content-Type") || "application/vnd.apple.mpegurl";
        return caches.open(OFFLINE_CACHE).then(function (cache) {
          return cache.put(url, new Response(text, { status: 200, headers: { "Content-Type": type } })).then(function () { return text; });
        });
      });
    });
  }

  function cacheFile(url) {
    return fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("offline");
      return caches.open(OFFLINE_CACHE).then(function (cache) {
        return cache.put(url, res);
      });
    });
  }

  function mapPool(items, limit, worker) {
    var cursor = 0;
    var active = 0;
    var failed = false;
    return new Promise(function (resolve, reject) {
      if (!items.length) { resolve(); return; }
      function kick() {
        if (failed) return;
        if (cursor >= items.length && active === 0) { resolve(); return; }
        while (!failed && active < limit && cursor < items.length) {
          var item = items[cursor];
          cursor += 1;
          active += 1;
          Promise.resolve(worker(item)).then(function () {
            active -= 1;
            kick();
          }, function (err) {
            if (failed) return;
            failed = true;
            reject(err);
          });
        }
      }
      kick();
    });
  }

  function gatherStream(url, seen, lists, files) {
    if (seen[url]) return Promise.resolve();
    seen[url] = true;
    lists.push(url);
    return fetchText(url).then(function (text) {
      var parsed = hlsAssets(text, url);
      parsed.files.forEach(function (file) {
        if (!seen[file]) { seen[file] = true; files.push(file); }
      });
      return parsed.playlists.reduce(function (chain, item) {
        return chain.then(function () { return gatherStream(item, seen, lists, files); });
      }, Promise.resolve());
    });
  }

  function saveOffline(song) {
    var url = classifyStream(song && song.stream).url || "";
    if (!url || !root.caches) { hooks.toast(tr("Offline save isn’t available for this song")); return; }
    ui.offline = { id: song.id, done: 0, total: 0 };
    paintOfflineButtons();
    var lists = [];
    var files = [];
    gatherStream(url, {}, lists, files).then(function () {
      ui.offline = { id: song.id, done: lists.length, total: lists.length + files.length };
      paintOfflineButtons();
      return mapPool(files, 4, function (file) {
        return cacheFile(file).then(function () {
          if (!ui.offline || ui.offline.id !== song.id) return;
          ui.offline.done += 1;
          paintOfflineButtons();
        });
      }).then(function () { return lists.concat(files); });
    }).then(function (urls) {
      if (!local.offline || typeof local.offline !== "object") local.offline = {};
      local.offline[song.id] = urls;
      ui.offline = null;
      save();
      hooks.toast(tr("Saved for offline"));
      hooks.render();
    }).catch(function () {
      ui.offline = null;
      paintOfflineButtons();
      hooks.toast(tr("Couldn’t save that song for offline"));
    });
  }

  function removeOffline(song) {
    var urls = (local.offline && local.offline[song.id]) || [];
    if (local.offline) delete local.offline[song.id];
    save();
    var done = root.caches ? caches.open(OFFLINE_CACHE).then(function (cache) {
      return Promise.all(urls.map(function (url) { return cache.delete(url); }));
    }) : Promise.resolve();
    done.then(function () {
      hooks.toast(tr("Removed from this device"));
      hooks.render();
    }).catch(function () { hooks.render(); });
  }

  function bind(next) {
    next = next || {};
    if (next.render) hooks.render = next.render;
    if (next.toast) hooks.toast = next.toast;
    if (next.go) hooks.go = next.go;
    if (next.repo) hooks.repo = next.repo;
    if (typeof document === "undefined") return;
    restore();
    mount();
    loadRemote();
    document.addEventListener("load", onCoverEvent, true);
    document.addEventListener("error", onCoverEvent, true);
    document.addEventListener("input", onInput);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("submit", function (event) {
      var formEl = event.target;
      if (formEl && formEl.getAttribute && String(formEl.getAttribute("data-act") || "").indexOf("music-") === 0) event.preventDefault();
    });
  }

  logic.releaseHtml = releaseHtml;
  root.MusicLogic = logic;
  root.SIntelMusic = {
    install: install,
    bind: bind,
    onAct: onAct,
    page: page,
    afterRender: afterRender,
    playing: function () { return !!(active && play.playing); },
    ownsSession: function () { return active; },
    sameSection: sameSection,
    titleFor: titleFor,
    bottomHtml: bottomHtml,
    links: links,
    brand: brand,
    drawerLinks: drawerLinks
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
