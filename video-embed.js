/* Official embeds for viktorychapp.
   The page itself sends no referrer. YouTube will not start an embed
   without a Referer, so each player frame sets its own referrer policy
   before src. The official player is the primary path. A direct file is
   optional and must be able to fall back here.

   Ideas, not code, from FUTO Grayjay. The Grayjay app is FUTO Source First
   and was not copied. The YouTube, Odysee, PeerTube, Rumble, and Twitch
   plugins are GNU AGPL-3.0 and were not copied. What was reimplemented:
   try the reliable client first (here that client is the official iframe,
   which has no CORS problem), pick a combined audio+video file and skip
   video-only or audio-only rows, leave live playback on the official
   player, and leave chapters, captions, and picture-in-picture to that
   player. This file does not call SponsorBlock, does not re-encode, does
   not strip X-Frame-Options, and does not send video bytes through this
   site's CDN. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.ViktorychEmbed = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null), function () {
  var ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

  function pageOrigin(opts) {
    var given = opts && opts.origin;
    if (given && String(given).indexOf("http") === 0) return String(given).replace(/\/$/, "");
    if (typeof location !== "undefined" && location.origin && String(location.origin).indexOf("http") === 0) return location.origin;
    return "https://viktorychapp.com";
  }

  function namedMode(value) {
    var raw = String(value || "").toLowerCase();
    if (raw === "device" || raw === "direct") return "device";
    if (raw === "server") return "server";
    return "";
  }

  function playbackSource(settings, stored) {
    var bag = settings || {};
    var perf = bag.devicePerformance || bag.performance || {};
    var candidates = [bag.playbackSource, perf.playback, perf.playbackSource, stored];
    var i;
    for (i = 0; i < candidates.length; i++) {
      var mode = namedMode(candidates[i]);
      if (mode) return mode;
    }
    return "embed";
  }

  function youtubeEmbed(id, opts) {
    opts = opts || {};
    var clean = String(id || "").replace(/[^A-Za-z0-9_-]/g, "");
    var base = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(clean);
    var origin = pageOrigin(opts);
    var api = "&enablejsapi=1&origin=" + encodeURIComponent(origin) + "&widget_referrer=" + encodeURIComponent(origin + "/");
    if (opts.preview) return base + "?autoplay=1&mute=1&playsinline=1&controls=0&rel=0" + api;
    var controls = opts.controls === 0 ? "0" : "1";
    var fs = controls === "0" ? "0" : "1";
    var muted = opts.muted ? "&mute=1" : "";
    return base + "?autoplay=1&playsinline=1&controls=" + controls + "&rel=0&modestbranding=1&fs=" + fs + muted + api;
  }

  function parentHost(origin) {
    var host = "";
    try { host = new URL(origin || pageOrigin()).hostname; } catch (err) { host = ""; }
    if (!host || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]" || host === "localhost") return "localhost";
    return host;
  }

  function needsReferrer(url) {
    var raw = String(url || "");
    if (/youtube\.com|youtube-nocookie\.com|player\.vimeo\.com|player\.twitch\.tv|odysee\.com|\/videos\/embed\/|platform\.twitter\.com\/embed/i.test(raw)) return true;
    return false;
  }

  function referrerFor(url) {
    var raw = String(url || "");
    if (/twimg\.com|cdninstagram\.com|fbcdn\.net|tiktokcdn|tiktokv\.com|muscdn/i.test(raw)) return "no-referrer";
    return "strict-origin-when-cross-origin";
  }

  function prepareFrame(frame, opts) {
    opts = opts || {};
    if (!frame) return frame;
    var url = String(opts.url || "");
    if (needsReferrer(url)) {
      var policy = referrerFor(url);
      if (frame.setAttribute) frame.setAttribute("referrerpolicy", policy);
      frame.referrerPolicy = policy;
    }
    if (frame.removeAttribute) frame.removeAttribute("sandbox");
    frame.allow = opts.allow || ALLOW;
    if (opts.allowFullscreen !== false) frame.allowFullscreen = true;
    if (frame.setAttribute) frame.setAttribute("playsinline", "");
    if (opts.title) frame.title = opts.title;
    return frame;
  }

  function bindFrame(frame, opts) {
    opts = opts || {};
    var sought = false;
    function send(func, args) {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({
          event: "command",
          func: func,
          args: args || [],
          id: frame.id || 1,
          channel: "widget"
        }), "*");
      } catch (err) { /* the widget answers once it has loaded */ }
    }
    function nudge() {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({
          event: "listening",
          id: frame.id || 1,
          channel: "widget"
        }), "*");
      } catch (err) { /* cross-origin until the widget loads */ }
      send("addEventListener", ["onReady"]);
      send("addEventListener", ["onStateChange"]);
      send("addEventListener", ["onError"]);
      if (opts.preview || opts.muted) {
        send("mute", []);
        send("playVideo", []);
      }
      if (!opts.preview && Number(opts.resume) > 3 && !sought) {
        sought = true;
        send("seekTo", [Number(opts.resume), true]);
      }
    }
    return { nudge: nudge, send: send };
  }

  function nextAfterDirect(result, id, opts) {
    var code = "";
    var reason = "";
    if (result && typeof result === "object") {
      if (result.code != null) code = result.code;
      else if (result.errorCode != null) code = result.errorCode;
      reason = String(result.reason || result.error || "");
    } else if (result != null) code = result;
    var num = Number(code);
    var blocked = num === 100 || num === 101 || num === 150 || reason === "blocked" || reason === "missing" || String(code) === "blocked";
    if (blocked) return { kind: "link", url: "https://www.youtube.com/watch?v=" + encodeURIComponent(String(id || "")) };
    return { kind: "iframe", url: youtubeEmbed(id, opts || {}) };
  }

  function heightOf(row) {
    var direct = Number(row && (row.height || row.size) || 0);
    if (direct > 0) return direct;
    var text = String((row && (row.qualityLabel || row.quality || row.size)) || "");
    var match = text.match(/(\d{3,4})/);
    if (match) return Number(match[1]);
    var itag = String((row && row.itag) || "");
    if (itag === "22") return 720;
    if (itag === "18") return 360;
    return 0;
  }

  function pickCombined(rows, opts) {
    opts = opts || {};
    var narrow = !!(opts.narrow || opts.saveData);
    var out = [];
    (rows || []).forEach(function (row) {
      if (!row || !row.url) return;
      if (row.videoOnly || row.audioOnly) return;
      var url = String(row.url);
      if (url.indexOf("/v1/yt/") >= 0) return;
      if (/\.m3u8(\?|$)/i.test(url)) return;
      var mime = String(row.mimeType || row.mime || row.format || "");
      if (/mpegurl/i.test(mime)) return;
      if (mime && !/mp4|webm/i.test(mime)) return;
      if (!mime && !/mp4|webm/i.test(url) && String(row.itag || "") !== "18" && String(row.itag || "") !== "22") return;
      if (opts.canPlay && mime) {
        var support = opts.canPlay(mime);
        if (support === "") return;
      }
      out.push(row);
    });
    out.sort(function (a, b) {
      var ha = heightOf(a) || (narrow ? 100000 : -1);
      var hb = heightOf(b) || (narrow ? 100000 : -1);
      return narrow ? ha - hb : hb - ha;
    });
    return out;
  }

  function twitchParent(opts) {
    return parentHost(pageOrigin(opts || {}));
  }

  function match(text, opts) {
    opts = opts || {};
    var raw = String(text || "");
    if (/twitch\.tv/i.test(raw)) {
      var video = raw.match(/twitch\.tv\/videos\/(\d+)/i) || raw.match(/[?&]video=(\d+)/i);
      var channel = raw.match(/[?&]channel=([A-Za-z0-9_]{3,25})/i) || raw.match(/twitch\.tv\/([A-Za-z0-9_]{3,25})(?:[/?#\s]|$)/i);
      var parent = twitchParent(opts);
      var muted = (opts.preview || opts.muted) ? "true" : "false";
      if (video) {
        return {
          kind: "iframe",
          site: "twitch",
          url: "https://player.twitch.tv/?video=" + video[1] + "&parent=" + encodeURIComponent(parent) + "&autoplay=true&muted=" + muted
        };
      }
      if (channel && channel[1].toLowerCase() !== "videos" && channel[1].toLowerCase() !== "directory" && channel[1].toLowerCase() !== "www") {
        return {
          kind: "iframe",
          site: "twitch",
          url: "https://player.twitch.tv/?channel=" + encodeURIComponent(channel[1]) + "&parent=" + encodeURIComponent(parent) + "&autoplay=true&muted=true"
        };
      }
    }
    var vimeo = raw.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/i);
    if (vimeo) {
      var vimeoMuted = (opts.preview || opts.muted) ? "&muted=1" : "";
      return { kind: "iframe", site: "vimeo", url: "https://player.vimeo.com/video/" + vimeo[1] + "?playsinline=1&autoplay=1" + vimeoMuted };
    }
    if (/odysee\.com\//i.test(raw)) {
      var embedded = raw.match(/odysee\.com\/(\$\/embed\/[^\s?#]+)/i);
      var claim = raw.match(/odysee\.com\/(\$\/embed\/)?(@[^/\s?#]+\/[^/\s?#]+)/i);
      var path = "";
      if (embedded) path = embedded[1];
      else if (claim) path = "$/embed/" + claim[2];
      if (path) return { kind: "iframe", site: "odysee", url: "https://odysee.com/" + path };
    }
    var peer = raw.match(/https?:\/\/([^/\s]+)\/videos\/(?:watch|embed)\/([A-Za-z0-9-]{8,})/i) || raw.match(/https?:\/\/([^/\s]+)\/w\/([A-Za-z0-9-]{8,})/i);
    if (peer && !/youtube|youtu\.be|twitch|vimeo|odysee/i.test(peer[1])) {
      return { kind: "iframe", site: "peertube", url: "https://" + peer[1] + "/videos/embed/" + peer[2] + "?autoplay=1&playsinline=1" };
    }
    var hasFile = /\.mp4(\?|$)/i.test(raw) || /video\.twimg\.com/i.test(raw);
    if (!hasFile) {
      var tweet = raw.match(/platform\.twitter\.com\/embed\/Tweet\.html\?id=(\d+)/i) || raw.match(/twitter\.com\/i\/videos\/tweet\/(\d+)/i);
      if (tweet) return { kind: "iframe", site: "x", url: "https://platform.twitter.com/embed/Tweet.html?id=" + tweet[1] };
    }
    return null;
  }

  function youtubePlayer(host, opts) {
    opts = opts || {};
    if (!host || typeof document === "undefined") return null;
    var frame = null;
    var ready = false;
    var current = 0;
    var duration = 0;
    var volume = opts.volume != null ? Number(opts.volume) : 100;
    var poll = 0;
    function send(func, args) {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({
          event: "command",
          func: func,
          args: args || [],
          id: frame.id,
          channel: "widget"
        }), "*");
      } catch (err) { /* the widget answers once it has loaded */ }
    }
    function listen() {
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: frame.id, channel: "widget" }), "*");
      } catch (err) { /* cross-origin until the widget loads */ }
      send("addEventListener", ["onReady"]);
      send("addEventListener", ["onStateChange"]);
      send("addEventListener", ["onError"]);
    }
    function onMessage(event) {
      var origin = String(event.origin || "");
      if (origin.indexOf("youtube.com") < 0 && origin.indexOf("youtube-nocookie.com") < 0) return;
      if (!frame || event.source !== frame.contentWindow) return;
      var data = event.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch (err) { return; }
      }
      if (!data || typeof data !== "object") return;
      var info = data.info;
      if (data.event === "onReady") {
        ready = true;
        send("setVolume", [volume]);
        if (typeof opts.onReady === "function") opts.onReady(api);
      }
      if (info && typeof info === "object") {
        if (typeof info.currentTime === "number") current = info.currentTime;
        if (typeof info.duration === "number" && info.duration > 0) duration = info.duration;
      }
      var state = null;
      if (data.event === "onStateChange") state = info;
      else if (info && typeof info === "object" && info.playerState != null) state = info.playerState;
      if (state == null || state === "") return;
      var stateNum = Number(state);
      if (!isFinite(stateNum)) return;
      if (stateNum === 1 && !poll) {
        poll = setInterval(function () {
          send("getCurrentTime", []);
          send("getDuration", []);
        }, 500);
      }
      if (stateNum !== 1 && poll) {
        clearInterval(poll);
        poll = 0;
      }
      if (typeof opts.onState === "function") opts.onState(stateNum);
    }
    function mount(id) {
      var url = youtubeEmbed(id, { origin: pageOrigin(opts), controls: 0, preview: false });
      if (!frame) {
        frame = document.createElement("iframe");
        frame.id = "mu-yt-frame";
        frame.title = "";
        host.textContent = "";
        host.appendChild(frame);
        frame.addEventListener("load", function () {
          listen();
          setTimeout(listen, 300);
          setTimeout(listen, 1000);
        });
        window.addEventListener("message", onMessage);
      }
      prepareFrame(frame, { url: url, title: "", allowFullscreen: false });
      frame.src = url;
    }
    var api = {
      loadVideoById: function (id) {
        if (ready && frame && frame.contentWindow) {
          send("loadVideoById", [String(id || "")]);
          return;
        }
        mount(id);
      },
      playVideo: function () { send("playVideo", []); },
      pauseVideo: function () { send("pauseVideo", []); },
      stopVideo: function () { send("stopVideo", []); },
      seekTo: function (sec) { current = Number(sec) || 0; send("seekTo", [current, true]); },
      getCurrentTime: function () { return current; },
      getDuration: function () { return duration; },
      setVolume: function (n) { volume = Number(n) || 0; send("setVolume", [volume]); },
      destroy: function () {
        if (poll) clearInterval(poll);
        window.removeEventListener("message", onMessage);
        if (frame) {
          try { frame.src = "about:blank"; } catch (err) { /* already gone */ }
        }
      }
    };
    if (opts.videoId) mount(opts.videoId);
    return api;
  }

  return {
    pageOrigin: pageOrigin,
    playbackSource: playbackSource,
    youtubeEmbed: youtubeEmbed,
    prepareFrame: prepareFrame,
    bindFrame: bindFrame,
    nextAfterDirect: nextAfterDirect,
    pickCombined: pickCombined,
    match: match,
    needsReferrer: needsReferrer,
    referrerFor: referrerFor,
    youtubePlayer: youtubePlayer
  };
});
