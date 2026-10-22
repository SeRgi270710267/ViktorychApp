/* Owner Shorts. Live and For you, drawn with the Home tab chrome. */
(function () {
  var hooks = {
    icon: function () { return ""; },
    esc: function (value) { return String(value == null ? "" : value); },
    avatar: function () { return ""; },
    formatCount: function (n) { return String(n || 0); },
    fullTime: function (iso) { return iso || ""; },
    posts: function () { return []; },
    data: function () { return null; },
    settings: function () { return { follows: [], likes: {}, bookmarks: {} }; },
    save: function () {},
    toggle: function () { return false; },
    token: function () { return ""; },
    productName: function () { return ""; },
    logo: function () { return ""; }
  };
  var cached = null;
  var hls = null;
  var poll = 0;
  var sound = false;
  var lastTap = 0;
  var tapTimer = 0;
  var resolving = false;

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function cfg() {
    return window.VIKTORYCH_ACCOUNTS || { api: "", gate: false, tiktokAudience: "owner" };
  }
  function audience() {
    return cfg().tiktokAudience === "all" ? "all" : "owner";
  }
  function gateOn() {
    var row = cfg();
    return row.gate === true && !!row.api;
  }
  function account() {
    return window.ViktorychAccounts && window.ViktorychAccounts.account ? window.ViktorychAccounts.account() : null;
  }
  function visible() {
    if (audience() === "all") {
      if (!gateOn()) return true;
      return !!account();
    }
    if (!gateOn()) return false;
    var row = account();
    return !!(row && row.owner);
  }
  function apiBase() {
    return String(cfg().api || "").replace(/\/$/, "");
  }
  function authHeaders() {
    var token = hooks.token();
    return token ? { Authorization: "Bearer " + token } : {};
  }

  function hide() {
    var data = hooks.data();
    if (!data) return;
    data.posts = (data.posts || []).filter(function (post) { return !post || post.platform !== "tiktok"; });
    data.feeds = (data.feeds || []).filter(function (feed) { return !feed || feed.platform !== "tiktok"; });
  }

  function absorb(doc) {
    if (!visible() || !doc) return;
    cached = doc;
    var data = hooks.data();
    if (!data) return;
    var feeds = data.feeds || [];
    var posts = data.posts || [];
    (doc.feeds || []).forEach(function (feed) {
      if (!feed || !feed.id) return;
      if (!feeds.some(function (row) { return row && row.id === feed.id; })) feeds.push(feed);
    });
    (doc.posts || []).forEach(function (post) {
      if (!post || !post.id) return;
      if (!posts.some(function (row) { return row && row.id === post.id; })) posts.push(post);
    });
    data.feeds = feeds;
    data.posts = posts;
    var settings = hooks.settings() || {};
    if (!Array.isArray(settings.follows)) settings.follows = [];
    var changed = false;
    (doc.feeds || []).forEach(function (feed) {
      if (!feed || !feed.id) return;
      if (settings.follows.indexOf(feed.id) < 0) {
        settings.follows.push(feed.id);
        changed = true;
      }
    });
    if (changed) hooks.save();
  }

  function pull() {
    if (!visible()) return Promise.resolve(null);
    var base = apiBase();
    if (!base || !hooks.token()) return Promise.resolve(cached);
    return fetch(base + "/v1/owner/tiktok", { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (doc) {
      if (doc) absorb(doc);
      return doc;
    }).catch(function () { return null; });
  }

  function forYou() {
    var list = (hooks.posts() || []).slice();
    ((cached && cached.posts) || []).forEach(function (post) {
      if (post && post.id && !list.some(function (row) { return row && row.id === post.id; })) list.push(post);
    });
    return list.filter(function (post) {
      if (!post) return false;
      var url = String(post.url || "");
      var short = post.platform === "tiktok" || post.short === true || url.indexOf("/shorts/") >= 0;
      if (!short) return false;
      return (post.media || []).some(function (item) { return item && (item.type === "video" || item.poster || item.url); });
    }).slice().sort(function (a, b) {
      var left = String(a.date || "");
      var right = String(b.date || "");
      return left < right ? 1 : left > right ? -1 : 0;
    });
  }

  function liveRows() {
    var live = cached && cached.live;
    if (!live || typeof live !== "object") {
      return [{ handle: "gabii_g5", live: false, viewers: 0, title: "", lastLiveAt: "", detail: "" }];
    }
    return Object.keys(live).map(function (key) { return live[key]; }).filter(Boolean);
  }

  function videoOf(post) {
    return ((post && post.media) || []).filter(function (item) { return item && item.type === "video"; })[0] || ((post && post.media) || [])[0] || {};
  }

  function openText(post) {
    if (post && post.platform === "tiktok") return tr("Open on TikTok");
    if (post && post.platform === "youtube") return tr("View on YouTube");
    return tr("Open original");
  }

  function liked(id) {
    var settings = hooks.settings() || {};
    return !!(settings.likes && settings.likes[id]);
  }
  function saved(id) {
    var settings = hooks.settings() || {};
    return !!(settings.bookmarks && settings.bookmarks[id]);
  }

  function rail(post) {
    var id = post.id || "";
    var media = videoOf(post);
    var replies = (post.stats && post.stats.replies) || 0;
    var profile = "#/" + encodeURIComponent(post.platform || "tiktok") + "/" + encodeURIComponent(post.handle || "");
    return '<div class="shorts-rail">' +
      '<a class="shorts-ava" href="' + hooks.esc(profile) + '" data-shorts="link">' + hooks.avatar(post.avatar, post.author || post.handle) + "</a>" +
      '<button type="button" data-shorts="like" data-id="' + hooks.esc(id) + '" aria-label="' + hooks.esc(tr("Like")) + '">' + hooks.icon(liked(id) ? "heartOn" : "heart") + "<span>" + hooks.esc(hooks.formatCount((post.stats && post.stats.likes) || 0)) + "</span></button>" +
      '<a data-shorts="link" href="' + hooks.esc(post.url || "#") + '" target="_blank" rel="noopener noreferrer" aria-label="' + hooks.esc(tr("Replies")) + '">' + hooks.icon("reply") + "<span>" + hooks.esc(replies ? hooks.formatCount(replies) : "") + "</span></a>" +
      '<button type="button" data-shorts="bookmark" data-id="' + hooks.esc(id) + '" aria-label="' + hooks.esc(tr("Bookmark")) + '">' + hooks.icon(saved(id) ? "bookmarkOn" : "bookmark") + "</button>" +
      '<button type="button" data-shorts="share" data-id="' + hooks.esc(id) + '" aria-label="' + hooks.esc(tr("Share")) + '">' + hooks.icon("share") + "</button>" +
      '<button type="button" data-shorts="mute" aria-label="' + hooks.esc(sound ? tr("Mute") : tr("Unmute")) + '">' + hooks.icon(sound ? "vol" : "volOff") + "</button>" +
      "</div>";
  }

  function playId(post) {
    var id = String((post && post.statusId) || "");
    if (/^\d{8,22}$/.test(id)) return id;
    var match = String((post && post.id) || "").match(/(\d{8,22})/);
    return match ? match[1] : "";
  }

  function playSrc(post) {
    var id = playId(post);
    var handle = String((post && post.handle) || "");
    if (!id || !/^[A-Za-z0-9._]{2,24}$/.test(handle) || !apiBase() || !hooks.token()) return "";
    if (post.platform && post.platform !== "tiktok") return "";
    return apiBase() + "/v1/owner/play?id=" + encodeURIComponent(id) + "&handle=" + encodeURIComponent(handle);
  }

  function postById(id) {
    var list = forYou();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function slide(post) {
    var media = videoOf(post);
    var profile = "#/" + encodeURIComponent(post.platform || "tiktok") + "/" + encodeURIComponent(post.handle || "");
    var caption = String(post.text || "");
    return '<article class="shorts-slide" data-id="' + hooks.esc(post.id || "") + '" data-kind="video">' +
      '<div class="shorts-stage">' +
      '<video playsinline loop preload="none"' + (media.poster ? ' poster="' + hooks.esc(media.poster) + '"' : "") + ' muted></video>' +
      (media.poster ? '<img class="shorts-poster" alt="" src="' + hooks.esc(media.poster) + '" referrerpolicy="no-referrer">' : "") +
      '<button class="shorts-hit" type="button" data-shorts="stage" aria-label="' + hooks.esc(tr("Pause")) + '"></button>' +
      rail(post) +
      '<div class="shorts-meta"><a class="shorts-author" href="' + hooks.esc(profile) + '">@' + hooks.esc(post.handle || "") + "</a>" +
      (caption ? '<p class="shorts-caption">' + hooks.esc(caption) + "</p>" : "") +
      '<a class="shorts-open" target="_blank" rel="noopener noreferrer" href="' + hooks.esc(post.url || "#") + '">' + hooks.esc(openText(post)) + "</a></div>" +
      "</div></article>";
  }

  function liveSlide(row) {
    var handle = String((row && row.handle) || "gabii_g5");
    var profile = "https://www.tiktok.com/@" + handle + "/live";
    var appProfile = "#/tiktok/" + encodeURIComponent(handle);
    var on = !!(row && row.live);
    var face = cached && (cached.feeds || []).filter(function (feed) { return feed && feed.handle === handle; })[0];
    var body = on
      ? '<video playsinline autoplay' + (sound ? "" : " muted") + '></video><button class="shorts-hit" type="button" data-shorts="stage" aria-label="' + hooks.esc(tr("Pause")) + '"></button>'
      : '<div class="shorts-offline"><h2>' + hooks.esc(tr("Not live right now")) + "</h2>" +
        (row && row.lastLiveAt ? "<p>" + hooks.esc(tr("Last live {time}", { time: hooks.fullTime(row.lastLiveAt) })) + "</p>" : "") +
        '<a class="shorts-open" target="_blank" rel="noopener noreferrer" href="' + hooks.esc(profile) + '">' + hooks.esc(tr("Open on TikTok")) + "</a></div>";
    var viewers = on ? '<span class="shorts-viewers">' + hooks.esc(tr("{count} watching", { count: hooks.formatCount(row.viewers || 0) })) + "</span>" : "";
    var badge = on ? '<span class="shorts-live-tag">' + hooks.esc(tr("LIVE")) + "</span>" : "";
    return '<article class="shorts-slide" data-kind="live" data-handle="' + hooks.esc(handle) + '">' +
      '<div class="shorts-stage">' + body +
      '<div class="shorts-meta">' + badge + viewers +
      '<div><a class="shorts-author" href="' + hooks.esc(appProfile) + '">@' + hooks.esc(handle) + "</a></div>" +
      (row && row.title ? '<p class="shorts-caption">' + hooks.esc(row.title) + "</p>" : "") +
      (on ? '<a class="shorts-open" target="_blank" rel="noopener noreferrer" href="' + hooks.esc(profile) + '">' + hooks.esc(tr("Open on TikTok")) + "</a>" : "") +
      "</div>" +
      (face && face.avatar ? '<a class="shorts-ava" style="position:absolute;right:12px;bottom:96px;z-index:2" href="' + hooks.esc(appProfile) + '">' + hooks.avatar(face.avatar, handle) + "</a>" : "") +
      '<div class="shorts-rail"><button type="button" data-shorts="mute" aria-label="' + hooks.esc(sound ? tr("Mute") : tr("Unmute")) + '">' + hooks.icon(sound ? "vol" : "volOff") + "</button></div>" +
      "</div></article>";
  }

  function tabs(live) {
    return '<div class="tabs-bar"><div class="tabs" role="tablist">' +
      '<a class="tab' + (live ? " on" : "") + '" href="#/shorts/live" role="tab" aria-selected="' + (live ? "true" : "false") + '"><span>' + hooks.esc(tr("Live")) + "</span></a>" +
      '<a class="tab' + (live ? "" : " on") + '" href="#/shorts" role="tab" aria-selected="' + (live ? "false" : "true") + '"><span>' + hooks.esc(tr("For you")) + "</span></a>" +
      "</div></div>";
  }

  function mhead() {
    return '<div class="mhead"><button class="m-ava" data-act="drawer" type="button" aria-label="' + hooks.esc(tr("Menu")) + '"><span class="ava initials">Y</span></button>' +
      '<a class="m-logo" href="#/" aria-label="' + hooks.esc(hooks.productName()) + '">' + hooks.logo() + "</a>" +
      '<a class="m-icon" href="#/settings" aria-label="' + hooks.esc(tr("Settings")) + '">' + hooks.icon("spark") + "</a></div>";
  }

  function page(route) {
    if (!visible()) return '<div class="shorts-page"></div>';
    var live = !!(route && route.live);
    var slides = live ? liveRows().map(liveSlide).join("") : forYou().map(slide).join("");
    if (!slides) {
      slides = '<article class="shorts-slide"><div class="shorts-stage"><div class="shorts-offline"><h2>' + hooks.esc(tr("No posts yet")) + "</h2></div></div></article>";
    }
    return '<div class="shorts-page"><div class="shorts-top">' + mhead() + tabs(live) + "</div>" +
      '<div class="shorts-feed" id="shorts-feed">' + slides + "</div></div>";
  }

  function destroyHls() {
    if (hls) {
      try { hls.destroy(); } catch (err) { /* already gone */ }
      hls = null;
    }
  }

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "hls-1.7.3.min.js";
      script.onload = function () { resolve(window.Hls); };
      script.onerror = function () { reject(new Error("hls")); };
      document.head.appendChild(script);
    });
  }

  function playHls(video, url, authed) {
    return loadHls().then(function (Hls) {
      destroyHls();
      if (!authed && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.muted = !sound;
        return video.play();
      }
      if (!Hls || !Hls.isSupported()) {
        if (authed) throw new Error("hls");
        video.src = url;
        video.muted = !sound;
        return video.play();
      }
      var player = new Hls({
        enableWorker: true,
        xhrSetup: authed ? function (xhr) {
          var headers = authHeaders();
          if (headers.Authorization) xhr.setRequestHeader("Authorization", headers.Authorization);
        } : undefined
      });
      hls = player;
      player.loadSource(url);
      player.attachMedia(video);
      video.muted = !sound;
      return new Promise(function (resolve, reject) {
        player.on(Hls.Events.ERROR, function (event, data) {
          if (data && data.fatal) reject(new Error("hls"));
        });
        player.on(Hls.Events.MANIFEST_PARSED, function () {
          video.play().then(resolve).catch(reject);
        });
      });
    });
  }

  function proxyUrl(direct) {
    return apiBase() + "/v1/owner/media?url=" + encodeURIComponent(direct);
  }

  function applyLive(video, info, tried) {
    if (!video || !info || !info.live || !info.hls) return Promise.resolve();
    return playHls(video, info.hls, false).catch(function () {
      if (tried) throw new Error("hls");
      return playHls(video, proxyUrl(info.hls), true);
    });
  }

  function resolveLive(handle, again) {
    var base = apiBase();
    if (!base || !hooks.token() || resolving) return Promise.resolve(null);
    resolving = true;
    return fetch(base + "/v1/owner/live/" + encodeURIComponent(handle), { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (info) {
      resolving = false;
      if (!info) return null;
      if (!cached) cached = { live: {} };
      if (!cached.live) cached.live = {};
      var prev = cached.live[handle] || {};
      cached.live[handle] = {
        handle: handle,
        live: !!info.live,
        viewers: info.viewers || 0,
        title: info.title || "",
        roomId: info.roomId || "",
        lastLiveAt: info.lastLiveAt || prev.lastLiveAt || "",
        checkedAt: info.checkedAt || "",
        detail: info.detail || ""
      };
      var video = document.querySelector('.shorts-slide[data-handle="' + handle + '"] video');
      if (info.live && info.hls && video) {
        applyLive(video, info, false).catch(function () {
          if (!again) resolveLive(handle, true);
        });
      }
      return info;
    }).catch(function () {
      resolving = false;
      return null;
    });
  }

  function activeVideo() {
    var feed = document.getElementById("shorts-feed");
    if (!feed) return null;
    var slides = feed.querySelectorAll(".shorts-slide");
    var best = null;
    var top = feed.getBoundingClientRect().top;
    for (var i = 0; i < slides.length; i++) {
      var box = slides[i].getBoundingClientRect();
      if (box.top <= top + 8 && box.bottom > top + 8) best = slides[i];
    }
    return best;
  }

  function armSlide(slideEl, preload) {
    var video = slideEl.querySelector("video");
    if (!video || slideEl.getAttribute("data-kind") === "live") return;
    var post = postById(slideEl.getAttribute("data-id") || "");
    var src = post && post.platform === "tiktok" ? playSrc(post) : ((videoOf(post).url) || "");
    if (!src) return;
    video.preload = preload;
    if (video.getAttribute("src") !== src) video.src = src;
  }

  function stopSlide(slideEl) {
    var video = slideEl.querySelector("video");
    if (!video || slideEl.getAttribute("data-kind") === "live") return;
    video.pause();
    if (video.getAttribute("src")) {
      video.removeAttribute("src");
      try { video.load(); } catch (err) { /* the element is going away */ }
    }
  }

  function playActive() {
    var feed = document.getElementById("shorts-feed");
    if (!feed) return;
    var slides = feed.querySelectorAll(".shorts-slide");
    var current = activeVideo();
    var next = null;
    for (var n = 0; n < slides.length; n++) {
      if (slides[n] === current && slides[n + 1] && slides[n + 1].getAttribute("data-kind") !== "live") next = slides[n + 1];
    }
    for (var i = 0; i < slides.length; i++) {
      var video = slides[i].querySelector("video");
      if (!video || slides[i].getAttribute("data-kind") === "live") continue;
      video.muted = !sound;
      if (slides[i] === current) {
        armSlide(slides[i], "auto");
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
      } else if (slides[i] === next) {
        armSlide(slides[i], "metadata");
        video.pause();
      } else stopSlide(slides[i]);
    }
  }

  function popHeart(stage) {
    var old = stage.querySelector(".shorts-heart");
    if (old) old.remove();
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "shorts-heart");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    var sample = hooks.icon("heartOn");
    var found = String(sample).match(/d="([^"]+)"/);
    path.setAttribute("d", found ? found[1] : "");
    svg.appendChild(path);
    stage.appendChild(svg);
    setTimeout(function () { if (svg.parentNode) svg.remove(); }, 650);
  }

  function onClick(event) {
    var button = event.target.closest("[data-shorts]");
    if (!button) return;
    var kind = button.getAttribute("data-shorts");
    if (kind === "link") return;
    var slideEl = button.closest(".shorts-slide");
    var video = slideEl ? slideEl.querySelector("video") : null;
    if (kind === "mute") {
      sound = !sound;
      if (video) video.muted = !sound;
      var label = sound ? tr("Mute") : tr("Unmute");
      button.setAttribute("aria-label", label);
      button.innerHTML = hooks.icon(sound ? "vol" : "volOff");
      return;
    }
    if (kind === "like" || kind === "bookmark") {
      var id = button.getAttribute("data-id");
      var on = hooks.toggle(kind === "like" ? "like" : "bookmark", id);
      if (kind === "like") button.classList.toggle("on", !!on);
      return;
    }
    if (kind === "share") {
      var post = (hooks.posts() || []).filter(function (row) { return row && row.id === button.getAttribute("data-id"); })[0];
      var url = (post && post.url) || location.href;
      if (navigator.share) navigator.share({ url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
      return;
    }
    if (kind !== "stage" || !video) return;
    var now = Date.now();
    if (now - lastTap < 280) {
      clearTimeout(tapTimer);
      lastTap = 0;
      var postId = slideEl.getAttribute("data-id");
      if (postId) {
        var settings = hooks.settings() || {};
        if (!(settings.likes && settings.likes[postId])) hooks.toggle("like", postId);
        var heart = slideEl.querySelector('[data-shorts="like"]');
        if (heart) heart.classList.add("on");
      }
      var stage = slideEl.querySelector(".shorts-stage");
      if (stage) popHeart(stage);
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(function () {
      lastTap = 0;
      if (video.paused) {
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
        button.setAttribute("aria-label", tr("Pause"));
      } else {
        video.pause();
        button.setAttribute("aria-label", tr("Play"));
      }
    }, 280);
  }

  function onKey(event) {
    if (!document.documentElement.classList.contains("shorts-on")) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    var feed = document.getElementById("shorts-feed");
    if (!feed) return;
    event.preventDefault();
    feed.scrollBy({ top: (event.key === "ArrowDown" ? 1 : -1) * feed.clientHeight, behavior: "smooth" });
  }

  function onError(event) {
    var video = event.target;
    if (!video || video.tagName !== "VIDEO" || !video.getAttribute("src")) return;
    var slideEl = video.closest(".shorts-slide");
    if (!slideEl) return;
    if (slideEl.getAttribute("data-kind") === "live") {
      var handle = slideEl.getAttribute("data-handle") || "";
      if (handle) resolveLive(handle, false);
      return;
    }
    var poster = slideEl.querySelector(".shorts-poster");
    if (poster) poster.style.display = "block";
    var post = postById(slideEl.getAttribute("data-id") || "");
    var src = post ? playSrc(post) : "";
    if (!src || !hooks.token()) return;
    fetch(src + "&meta=1", { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      return res.json();
    }).then(function (body) {
      if (!body || body.ok || !body.detail) return;
      var note = slideEl.querySelector(".shorts-note");
      if (!note) {
        note = document.createElement("p");
        note.className = "shorts-note";
        var meta = slideEl.querySelector(".shorts-meta");
        if (meta) meta.appendChild(note);
      }
      note.textContent = body.detail;
    }).catch(function () {});
  }

  function mount(route) {
    document.documentElement.classList.add("shorts-on");
    var feed = document.getElementById("shorts-feed");
    if (!feed) return;
    feed.addEventListener("click", onClick);
    feed.addEventListener("error", onError, true);
    feed.addEventListener("playing", function (event) {
      var video = event.target;
      if (!video || video.tagName !== "VIDEO") return;
      var poster = video.parentNode && video.parentNode.querySelector(".shorts-poster");
      if (poster) poster.style.display = "none";
    }, true);
    feed.addEventListener("scroll", function () {
      clearTimeout(feed._play);
      feed._play = setTimeout(playActive, 80);
    }, { passive: true });
    document.removeEventListener("keydown", onKey);
    document.addEventListener("keydown", onKey);
    clearInterval(poll);
    poll = 0;
    var query = (route && route.query) || new URLSearchParams(location.hash.split("?")[1] || "");
    var focus = query.get ? query.get("v") : "";
    if (focus) {
      var target = feed.querySelector('.shorts-slide[data-id="tiktok:' + focus + '"], .shorts-slide[data-id="' + focus + '"]');
      if (target) target.scrollIntoView();
    }
    playActive();
    if (route && route.live) {
      liveRows().forEach(function (row) { if (row && row.handle) resolveLive(row.handle, false); });
      poll = setInterval(function () {
        if (document.visibilityState !== "visible") return;
        liveRows().forEach(function (row) { if (row && row.handle) resolveLive(row.handle, false); });
      }, 3 * 60 * 1000);
    }
  }

  function unmount() {
    document.documentElement.classList.remove("shorts-on");
    document.removeEventListener("keydown", onKey);
    clearInterval(poll);
    poll = 0;
    destroyHls();
    var feed = document.getElementById("shorts-feed");
    if (feed) {
      var videos = feed.querySelectorAll("video");
      for (var i = 0; i < videos.length; i++) videos[i].pause();
    }
  }

  window.ViktorychShorts = {
    bind: function (next) { if (next) Object.keys(hooks).forEach(function (key) { if (next[key]) hooks[key] = next[key]; }); },
    visible: visible,
    page: page,
    mount: mount,
    unmount: unmount,
    pull: pull,
    hide: hide,
    absorb: absorb
  };
})();
