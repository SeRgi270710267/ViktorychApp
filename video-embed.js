/* Official embeds for viktorychapp.
   The page itself sends no referrer. YouTube will not start an embed
   without a Referer, so each player frame sets its own referrer policy
   before src. For YouTube the official player is the primary path. A direct
   file is optional and must be able to fall back here.
   X is the other way around: the original mp4 or HLS on video.twimg.com
   plays first, and any failure swaps to the official tweet embed. That
   embed is the real platform.twitter.com frame. This file does not load it
   through the site relay and does not strip X-Frame-Options.

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

  function tr(key) {
    return (typeof window !== "undefined" && typeof window.t === "function") ? window.t(key) : key;
  }
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

  var X_STALL_MS = 3000;

  function digitsId(value) {
    var raw = String(value || "");
    return /^\d{6,25}$/.test(raw) ? raw : "";
  }

  function xStatusId(value) {
    var raw = "";
    if (value && typeof value === "object") {
      raw = [value.statusId, value.id, value.url, value.open, value.href].filter(Boolean).join(" ");
      var direct = digitsId(value.statusId);
      if (direct) return direct;
      var tail = String(value.id || "");
      var cut = tail.lastIndexOf(":");
      if (cut >= 0) tail = tail.slice(cut + 1);
      if (digitsId(tail)) return tail;
    } else raw = String(value || "");
    var query = raw.match(/[?&]id=(\d{6,25})\b/);
    if (query) return query[1];
    var path = raw.match(/(?:^|\/)(?:status|statuses)\/(\d{6,25})\b/i);
    if (path) return path[1];
    var videos = raw.match(/\/i\/videos\/tweet\/(\d{6,25})\b/i);
    if (videos) return videos[1];
    if (digitsId(String(raw).trim())) return String(raw).trim();
    return "";
  }

  function hostPathId(value, leaf) {
    var raw = "";
    if (value && typeof value === "object") raw = [value.url, value.open, value.href, value.text].filter(Boolean).join(" ");
    else raw = String(value || "");
    var re = new RegExp("(?:x\\.com|twitter\\.com|mobile\\.x\\.com|mobile\\.twitter\\.com)/i/" + leaf + "/([A-Za-z0-9]{4,40})", "i");
    var found = raw.match(re);
    return found ? found[1] : "";
  }

  function xSpaceId(value) {
    return hostPathId(value, "spaces");
  }

  function xBroadcastId(value) {
    return hostPathId(value, "broadcasts");
  }

  function xOpenUrl(id, kind) {
    var clean = String(id || "");
    if (!clean || /[@/]/.test(clean)) return "";
    if (kind === "space") return "https://x.com/i/spaces/" + encodeURIComponent(clean);
    if (kind === "broadcast") return "https://x.com/i/broadcasts/" + encodeURIComponent(clean);
    if (!digitsId(clean)) return "";
    return "https://x.com/i/status/" + encodeURIComponent(clean);
  }

  function xEmbedUrl(id) {
    var clean = digitsId(String(id || ""));
    if (!clean) clean = digitsId(String(id || "").replace(/\D/g, ""));
    if (!clean) return "";
    return "https://platform.twitter.com/embed/Tweet.html?id=" + encodeURIComponent(clean) + "&theme=dark&dnt=true";
  }

  function isTwimgVideo(url) {
    try { return /(^|\.)video\.twimg\.com$/i.test(new URL(String(url || "")).hostname); }
    catch (err) { return false; }
  }

  function heightFromUrl(url) {
    var found = String(url || "").match(/\/(\d{3,4})x(\d{3,4})\//);
    if (!found) return 0;
    return Number(found[2]) || Number(found[1]) || 0;
  }

  function xPrimary(media, opts) {
    opts = opts || {};
    var expired = opts.expired || function () { return false; };
    var rows = [];
    function push(url, bitrate, kind) {
      if (!url || !isTwimgVideo(url) || expired(url)) return;
      if (rows.some(function (row) { return row.url === url; })) return;
      rows.push({ url: String(url), bitrate: Number(bitrate) || 0, kind: kind, height: heightFromUrl(url) });
    }
    ((media && media.variants) || []).forEach(function (row) {
      if (!row || !row.url) return;
      var path = String(row.url).split("?")[0].toLowerCase();
      if (path.indexOf(".m3u8") >= 0) push(row.url, 0, "hls");
      else push(row.url, row.bitrate || row.bit_rate || 0, "mp4");
    });
    [media && media.url, media && media.fallback].forEach(function (url) {
      if (!url) return;
      var path = String(url).split("?")[0].toLowerCase();
      push(url, 0, path.indexOf(".m3u8") >= 0 ? "hls" : "mp4");
    });
    if (media && media.hls) push(media.hls, 0, "hls");
    var mp4 = rows.filter(function (row) { return row.kind === "mp4"; });
    mp4.sort(function (a, b) { return (b.bitrate - a.bitrate) || (b.height - a.height); });
    if (mp4.length) return { kind: "mp4", url: mp4[0].url };
    var hls = rows.filter(function (row) { return row.kind === "hls"; });
    if (hls.length) return { kind: "hls", url: hls[0].url };
    return null;
  }

  function xRoute(direct, opts) {
    opts = opts || {};
    var mode = String(opts.networkMode || "auto").toLowerCase();
    if (mode !== "max" && mode !== "direct") mode = "auto";
    var relay = String(opts.relay || "");
    if (!direct) return { url: "", relay: "" };
    if (mode === "direct" || !relay) return { url: direct, relay: "" };
    if (mode === "max" || opts.preferRelay) return { url: relay, relay: "" };
    if (typeof opts.playbackUrl === "function") {
      var chosen = "";
      try { chosen = opts.playbackUrl(direct, relay, opts.playbackOpts || {}) || ""; }
      catch (err) { chosen = ""; }
      if (chosen && chosen !== direct) return { url: chosen, relay: "" };
    }
    if (opts.sourceFailed) return { url: relay, relay: "" };
    return { url: direct, relay: relay };
  }

  function xPlan(input) {
    input = input || {};
    var post = input.post || {};
    var media = input.media || {};
    var text = String(input.text || "");
    var file = xPrimary(media, input);
    var id = xStatusId(post) || xStatusId(media) || xStatusId(text);
    var space = xSpaceId(text) || xSpaceId(media) || xSpaceId(post);
    var broadcast = xBroadcastId(text) || xBroadcastId(media) || xBroadcastId(post);
    if (!file && space) return { primary: null, relay: null, embedUrl: "", openUrl: xOpenUrl(space, "space"), external: "space" };
    if (!file && broadcast) return { primary: null, relay: null, embedUrl: "", openUrl: xOpenUrl(broadcast, "broadcast"), external: "broadcast" };
    var embedUrl = id ? xEmbedUrl(id) : "";
    var openUrl = id ? xOpenUrl(id, "status") : "";
    if (!file) return { primary: null, relay: null, embedUrl: embedUrl, openUrl: openUrl, external: "" };
    var routed = typeof input.route === "function" ? input.route(file.url) : { url: file.url, relay: "" };
    if (!routed || typeof routed !== "object") routed = { url: file.url, relay: "" };
    var primaryUrl = routed.url || file.url;
    var primary = { kind: file.kind, url: primaryUrl, origin: file.url };
    var relayUrl = routed.relay && routed.relay !== primaryUrl ? routed.relay : "";
    var relay = relayUrl ? { kind: file.kind, url: relayUrl, origin: file.url } : null;
    var seen = [primaryUrl, relayUrl];
    var backups = (Array.isArray(routed.backups) ? routed.backups : []).filter(function (url) {
      if (!url || seen.indexOf(url) >= 0) return false;
      seen.push(url);
      return true;
    }).map(function (url) { return { kind: file.kind, url: url, origin: file.url }; });
    return { primary: primary, relay: relay, backups: backups, embedUrl: embedUrl, openUrl: openUrl, external: "" };
  }

  /* TikTok's official players, used only after every direct file failed. */
  function tiktokVideoId(value) {
    var raw = typeof value === "object" && value ? [value.statusId, value.url, value.open, value.id].join(" ") : String(value || "");
    var m = raw.match(/tiktok\.com\/(?:@[A-Za-z0-9._]{1,30}\/(?:video|photo)|embed(?:\/v2)?|player\/v1|v)\/(\d{8,22})/i);
    if (m) return m[1];
    if (typeof value === "object" && value && value.platform === "tiktok") {
      var id = String(value.statusId || "").match(/^\d{8,22}$/) ? String(value.statusId) : (String(value.id || "").match(/(\d{8,22})/) || [])[1];
      return id || "";
    }
    return "";
  }
  function tiktokEmbedUrl(id) {
    var clean = String(id || "").replace(/\D/g, "");
    return clean ? "https://www.tiktok.com/embed/v2/" + clean : "";
  }
  /* The platform's own embed for a post, with the size it draws at so it can
     be scaled to cover our video frame. Empty when the platform has none. */
  function officialEmbed(post, media) {
    post = post || {};
    var platform = String(post.platform || "");
    var tt = platform === "tiktok" || /tiktok\.com/i.test([post.url, media && media.open].join(" ")) ? (tiktokVideoId(post) || tiktokVideoId(media && media.open)) : "";
    if (tt) return { site: "tiktok", url: tiktokEmbedUrl(tt), width: 325, height: 578, origin: "https://www.tiktok.com" };
    var x = platform === "x" || /(?:x|twitter)\.com\//i.test(String(post.url || "")) ? (xStatusId(post) || xStatusId(media)) : "";
    if (x) return { site: "x", url: xEmbedUrl(x), width: 550, height: 560, origin: "https://platform.twitter.com" };
    return null;
  }
  /* Scale a fixed-size embed like object-fit: cover inside the host frame and
     crop what spills over. */
  function fitEmbed(box, frame, size) {
    var w = Number(size && size.width) || 550;
    var h = Number(size && size.height) || 560;
    box.style.position = "absolute";
    box.style.inset = "0";
    box.style.overflow = "hidden";
    frame.style.position = "absolute";
    frame.style.left = "50%";
    frame.style.top = "50%";
    frame.style.border = "0";
    frame.style.transformOrigin = "50% 50%";
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    function fit() {
      var bw = box.clientWidth || w;
      var bh = box.clientHeight || h;
      var scale = Math.max(bw / w, bh / h);
      frame.style.transform = "translate(-50%, -50%) scale(" + scale.toFixed(4) + ")";
    }
    fit();
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(fit);
      ro.observe(box);
      box._fitStop = function () { ro.disconnect(); };
    }
    return fit;
  }
  /* Last resort: a placeholder that costs no data. The official embed loads
     only when it is tapped. */
  function mountTapEmbed(host, embed, opts) {
    opts = opts || {};
    if (!host || !embed || !embed.url || typeof document === "undefined") return null;
    host.querySelectorAll(":scope > .vembed-tap, :scope > .vembed-fit").forEach(function (node) {
      if (node._fitStop) node._fitStop();
      node.remove();
    });
    var tap = document.createElement("button");
    tap.type = "button";
    tap.className = "vembed-tap";
    tap.setAttribute("data-site", embed.site || "");
    tap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span></span>';
    tap.querySelector("span").textContent = opts.label || tr("Play");
    function load(event) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      if (!tap.isConnected) return;
      var box = document.createElement("div");
      box.className = "vembed-fit";
      box.setAttribute("data-site", embed.site || "");
      var frame = document.createElement("iframe");
      frame.className = embed.site === "x" ? "x-embed-frame" : "vembed-frame";
      frame.setAttribute("loading", "lazy");
      frame.setAttribute("scrolling", "no");
      prepareFrame(frame, { url: embed.url, title: opts.title || "Video", allowFullscreen: true });
      box.appendChild(frame);
      tap.replaceWith(box);
      host.classList.add("is-playing", "is-official");
      host.classList.remove("is-failed");
      fitEmbed(box, frame, embed);
      frame.src = embed.url;
      if (opts.onLoad) { try { opts.onLoad(frame); } catch (err) { /* stats are optional */ } }
    }
    tap.addEventListener("click", load);
    host.appendChild(tap);
    if (opts.onShow) { try { opts.onShow(tap); } catch (err) { /* stats are optional */ } }
    return { load: load, node: tap };
  }

  function xExternal(value) {
    var space = xSpaceId(value);
    if (space) return { kind: "link", site: "x", openUrl: xOpenUrl(space, "space") };
    var cast = xBroadcastId(value);
    if (cast) return { kind: "link", site: "x", openUrl: xOpenUrl(cast, "broadcast") };
    return null;
  }

  function prepareXVideo(video, url, opts) {
    opts = opts || {};
    if (!video) return video;
    video.playsInline = true;
    video.disablePictureInPicture = false;
    var policy = referrerFor(url);
    if (video.setAttribute) {
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("referrerpolicy", policy);
    }
    video.referrerPolicy = policy;
    if (opts.gif || opts.loop) video.loop = true;
    if (opts.gif || opts.muted) {
      video.muted = true;
      video.defaultMuted = true;
      if (video.setAttribute) video.setAttribute("muted", "");
    }
    return video;
  }

  function runXPlayback(host, opts) {
    opts = opts || {};
    if (!host || typeof document === "undefined") return;
    if (host._gen == null) host._gen = 1;
    var gen = host._gen;
    var plan = opts.plan || {};
    var stallMs = opts.stallMs == null ? X_STALL_MS : Number(opts.stallMs);
    var phase = "";
    function alive() {
      return host._gen === gen && (!opts.active || opts.active());
    }
    function stopEmbedWatch() {
      if (!host._xEmbedStop) return;
      try { host._xEmbedStop(); } catch (err) { /* the watch can already be cleared */ }
      host._xEmbedStop = null;
    }
    function wipeMedia() {
      stopEmbedWatch();
      if (opts.onStop) { try { opts.onStop(); } catch (err) { /* the previous player can already be gone */ } }
      host.querySelectorAll("video, iframe.x-embed-frame, a.x-open, .vembed-tap, .vembed-fit").forEach(function (node) {
        if (node._fitStop) node._fitStop();
        node.remove();
      });
      host.querySelectorAll(".vshield, .ytp-video-click-target").forEach(function (node) { node.remove(); });
    }
    // A blocked embed does not fire error, and the frame looks the same as a
    // loaded one. The official player posts a message once it is up. Silence
    // for the stall window means it never started, so the last step is the link.
    function watchEmbed(frame) {
      var timer = 0;
      function stop() {
        if (timer) clearTimeout(timer);
        timer = 0;
        window.removeEventListener("message", onMessage);
      }
      function onMessage(event) {
        if (!alive() || phase !== "embed" || !frame.isConnected) return;
        if (event.origin !== "https://platform.twitter.com") return;
        stop();
        if (host._xEmbedStop === stop) host._xEmbedStop = null;
      }
      window.addEventListener("message", onMessage);
      timer = setTimeout(function () {
        stop();
        if (host._xEmbedStop === stop) host._xEmbedStop = null;
        if (!alive() || phase !== "embed" || !frame.isConnected) return;
        showLink();
      }, stallMs > 0 ? stallMs : X_STALL_MS);
      host._xEmbedStop = stop;
    }
    function showLink() {
      if (!alive() || phase === "link") return;
      phase = "link";
      wipeMedia();
      host.classList.remove("is-playing", "is-shown", "is-x-embed");
      host.classList.add("is-failed");
      var href = plan.openUrl || "";
      var label = opts.linkLabel || tr("Open on X");
      var link = host.querySelector(".vfallback");
      if (link) {
        link.hidden = false;
        if (href) link.href = href;
        var span = link.querySelector("span");
        if (span) span.textContent = label;
        else link.textContent = label;
      } else if (href) {
        var created = document.createElement("a");
        created.className = "x-open";
        created.href = href;
        created.target = "_blank";
        created.rel = "noopener noreferrer";
        created.textContent = label;
        host.appendChild(created);
      }
      var play = host.querySelector(":scope > .play");
      if (play) play.hidden = true;
      var retry = host.querySelector(".vretry");
      if (retry) retry.hidden = false;
    }
    function showEmbed() {
      if (!alive() || phase === "embed" || phase === "link") return;
      var url = plan.embedUrl || "";
      if (!url) { showLink(); return; }
      phase = "embed";
      wipeMedia();
      if (opts.tapToLoad) {
        host.classList.remove("is-playing", "is-shown");
        host.classList.add("is-failed", "is-official-wait");
        var hold = host.querySelector(".vfallback");
        if (hold) hold.hidden = true;
        var hidePlay = host.querySelector(":scope > .play");
        if (hidePlay) hidePlay.hidden = true;
        mountTapEmbed(host, { site: "x", url: url, width: 550, height: 560 }, {
          label: opts.tapLabel || tr("Play"),
          title: opts.title || "Post",
          onLoad: function () { host.classList.remove("is-official-wait"); host.classList.add("is-x-embed"); }
        });
        return;
      }
      host.classList.remove("is-failed");
      host.classList.add("is-playing", "is-x-embed");
      var held = host.querySelector(".vfallback");
      if (held) held.hidden = true;
      var frame = document.createElement("iframe");
      frame.className = "x-embed-frame";
      prepareFrame(frame, { url: url, title: opts.title || "Post", allowFullscreen: !opts.preview });
      frame.addEventListener("error", function () { showLink(); });
      host.appendChild(frame);
      frame.src = url;
      watchEmbed(frame);
      var play = host.querySelector(":scope > .play");
      if (play) play.hidden = true;
    }
    function playFile(source, next) {
      if (!alive() || !source || !source.url) { next(); return; }
      wipeMedia();
      phase = "file";
      host.classList.remove("is-failed", "is-x-embed");
      host.classList.add("is-playing");
      var held = host.querySelector(".vfallback");
      if (held) held.hidden = true;
      var video = document.createElement("video");
      prepareXVideo(video, source.url, { gif: !!opts.gif, muted: !!(opts.muted || opts.gif), loop: !!(opts.loop || opts.gif) });
      video.preload = "auto";
      video.controls = !opts.preview && !opts.gif;
      if (Number(opts.resume) > 0.3) {
        video.addEventListener("loadedmetadata", function () {
          try { video.currentTime = Number(opts.resume) || 0; } catch (err) { /* not seekable yet */ }
        });
      }
      var timer = 0;
      var moved = false;
      function step() {
        if (moved || !alive()) return;
        moved = true;
        if (timer) clearTimeout(timer);
        if (opts.onFail) { try { opts.onFail(source); } catch (err) { /* stats are optional */ } }
        next();
      }
      video.addEventListener("error", step);
      function framed() {
        if (!(video.videoWidth > 0)) return;
        if (timer) { clearTimeout(timer); timer = 0; }
        if (opts.onFrame) opts.onFrame(video);
      }
      video.addEventListener("loadeddata", framed);
      video.addEventListener("playing", framed);
      video.addEventListener("timeupdate", function () {
        framed();
        if (opts.onTime) opts.onTime(video);
      });
      host.appendChild(video);
      if (opts.onVideo) opts.onVideo(video, source);
      timer = setTimeout(function () {
        if (!alive() || moved) return;
        if (video.videoWidth > 0) return;
        step();
      }, stallMs);
      function start() {
        if (!alive() || moved) return;
        var pending = video.play && video.play();
        if (!pending || !pending.then) return;
        pending.then(function () {}).catch(function (err) {
          if (!alive() || moved) return;
          var name = err && err.name;
          if (name === "NotAllowedError" && !video.muted) {
            video.muted = true;
            video.defaultMuted = true;
            video.setAttribute("muted", "");
            var again = video.play();
            if (again && again.catch) again.catch(function () { step(); });
            return;
          }
          step();
        });
      }
      if (source.kind === "hls" && !(video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl"))) {
        if (opts.loadHls) opts.loadHls(video, source.url, step, start);
        else step();
        return;
      }
      video.src = source.url;
      start();
    }
    if (plan.external === "space" || plan.external === "broadcast") { showLink(); return; }
    if (!plan.primary || !plan.primary.url) {
      if (plan.embedUrl) showEmbed();
      else showLink();
      return;
    }
    /* Direct file, then the relay, then each backup fetcher, then one fresh
       short-lived URL from the resolver, and only then the official embed. */
    var chain = [];
    if (plan.relay && plan.relay.url && plan.relay.url !== plan.primary.url) chain.push(plan.relay);
    (plan.backups || []).forEach(function (row) { if (row && row.url) chain.push(row); });
    var refreshed = false;
    function refresh() {
      if (refreshed || typeof opts.refresh !== "function") { showEmbed(); return; }
      refreshed = true;
      var job = null;
      try { job = opts.refresh(); } catch (err) { job = null; }
      if (!job || !job.then) { showEmbed(); return; }
      job.then(function (fresh) {
        if (!alive()) return;
        if (!fresh || !fresh.url || fresh.url === plan.primary.url) { showEmbed(); return; }
        playFile({ kind: fresh.kind || (/\.m3u8(\?|$)/i.test(fresh.url) ? "hls" : "mp4"), url: fresh.url, origin: fresh.url }, showEmbed);
      }, function () { if (alive()) showEmbed(); });
    }
    function nextRoute() {
      var row = chain.shift();
      if (!row) { refresh(); return; }
      playFile(row, nextRoute);
    }
    playFile(plan.primary, nextRoute);
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
    var tiktok = /tiktok\.com\//i.test(raw) ? tiktokVideoId(raw) : "";
    if (tiktok && !/\.mp4(\?|$)/i.test(raw)) return { kind: "iframe", site: "tiktok", url: tiktokEmbedUrl(tiktok) };
    var hasFile = /\.mp4(\?|$)/i.test(raw) || /video\.twimg\.com/i.test(raw);
    if (!hasFile) {
      var space = xSpaceId(raw);
      if (space) return { kind: "link", site: "x", url: xOpenUrl(space, "space") };
      var cast = xBroadcastId(raw);
      if (cast) return { kind: "link", site: "x", url: xOpenUrl(cast, "broadcast") };
      var tweet = xStatusId(raw);
      if (tweet && /platform\.twitter\.com\/embed\/Tweet\.html|\/i\/videos\/tweet\/|\/status\/|\/statuses\//i.test(raw)) {
        return { kind: "iframe", site: "x", url: xEmbedUrl(tweet) };
      }
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
    youtubePlayer: youtubePlayer,
    X_STALL_MS: X_STALL_MS,
    xStatusId: xStatusId,
    xSpaceId: xSpaceId,
    xBroadcastId: xBroadcastId,
    xOpenUrl: xOpenUrl,
    xEmbedUrl: xEmbedUrl,
    xPrimary: xPrimary,
    xRoute: xRoute,
    xPlan: xPlan,
    xExternal: xExternal,
    prepareXVideo: prepareXVideo,
    runXPlayback: runXPlayback,
    tiktokVideoId: tiktokVideoId,
    tiktokEmbedUrl: tiktokEmbedUrl,
    officialEmbed: officialEmbed,
    fitEmbed: fitEmbed,
    mountTapEmbed: mountTapEmbed
  };
});
