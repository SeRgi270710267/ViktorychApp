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
  var addedAccounts = [];
  var addingAccount = false;
  var accountsLoaded = false;
  var livePaintKey = "";
  var paintTimer = 0;
  var liveInflight = {};
  var liveToken = 0;
  var statsTimer = 0;
  var statsHandle = "";
  var statsRoom = "";
  var liveFatal = null;
  var onLiveLevel = null;
  var climbTimer = 0;
  var recordings = { cap: 12, active: 0, items: {} };
  var mpeg = null;
  var liveZoom = null;

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

  function foldHandle(value) {
    return String(value || "").toLowerCase();
  }

  function liveMap() {
    var live = cached && cached.live;
    return live && typeof live === "object" ? live : {};
  }

  function liveStatus(handle) {
    var want = foldHandle(handle);
    var live = liveMap();
    var names = Object.keys(live);
    for (var i = 0; i < names.length; i++) {
      var row = live[names[i]];
      if (!row) continue;
      if (foldHandle(row.handle || names[i]) === want) return row;
    }
    return null;
  }

  function liveRows() {
    var rows = [];
    var seen = {};
    function push(handle, extra) {
      var key = foldHandle(handle);
      if (!key || seen[key]) return;
      seen[key] = true;
      var status = liveStatus(handle) || {};
      rows.push({
        handle: status.handle || (extra && extra.handle) || handle,
        live: !!status.live,
        viewers: status.viewers || 0,
        title: status.title || "",
        roomId: status.roomId || "",
        lastLiveAt: status.lastLiveAt || "",
        detail: status.detail || "",
        avatar: (extra && extra.avatar) || status.avatar || "",
        name: (extra && extra.name) || "",
        record: recordOf(handle)
      });
    }
    if (addedAccounts.length) {
      addedAccounts.forEach(function (item) { if (item && item.handle) push(item.handle, item); });
    } else if (!ownerHere() || accountsLoaded) {
      Object.keys(liveMap()).forEach(function (name) { push(name, liveMap()[name]); });
      if (!rows.length) push("gabii_g5", {});
    }
    rows.sort(function (a, b) {
      if (!!a.live !== !!b.live) return a.live ? -1 : 1;
      var left = foldHandle(a.handle);
      var right = foldHandle(b.handle);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return rows;
  }

  function videoOf(post) {
    return ((post && post.media) || []).filter(function (item) { return item && item.type === "video"; })[0] || ((post && post.media) || [])[0] || {};
  }

  function qualityLabel(name) {
    var key = String(name || "").toLowerCase();
    if (key === "origin" || key === "origion") return tr("Origin");
    if (key === "uhd") return tr("UHD");
    if (key === "full_hd1") return tr("Full HD");
    if (key === "hd" || key === "hd1") return tr("HD");
    if (key === "sd" || key === "sd1" || key === "sd2") return tr("SD");
    if (key === "ld") return tr("LD");
    return "";
  }

  function qualityText(media) {
    if (!media) return "";
    var height = Number(media.height || 0);
    var codec = String(media.codec || "");
    if (!height && !codec) return "";
    var bits = [];
    if (height) bits.push(height + "p");
    if (codec) bits.push(codec);
    return tr("Original quality") + " · " + bits.join(" ");
  }

  function ownerHere() {
    var row = account();
    return !!(row && row.owner);
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
    var still = socialApi().stillKey ? socialApi().stillKey(post, media) : "";
    var posterAttr = still && hooks.token()
      ? ' data-tg="' + hooks.esc(still) + '" data-tg-first="1" data-fallback-src="' + hooks.esc(media.poster || "") + '"'
      : (media.poster ? ' src="' + hooks.esc(media.poster) + '"' : "");
    return '<article class="shorts-slide" data-id="' + hooks.esc(post.id || "") + '" data-kind="video">' +
      '<div class="shorts-stage">' +
      '<video playsinline loop preload="none"' + (media.poster ? ' poster="' + hooks.esc(media.poster) + '"' : "") + ' muted></video>' +
      (media.poster || still ? '<img class="shorts-poster" alt=""' + posterAttr + ' referrerpolicy="no-referrer">' : "") +
      '<button class="shorts-hit" type="button" data-shorts="stage" aria-label="' + hooks.esc(tr("Pause")) + '"></button>' +
      rail(post) +
      '<div class="shorts-meta"><a class="shorts-author" href="' + hooks.esc(profile) + '">@' + hooks.esc(post.handle || "") + "</a>" +
      (caption ? '<p class="shorts-caption">' + hooks.esc(caption) + "</p>" : "") +
      (qualityText(media) ? '<p class="shorts-quality" hidden>' + hooks.esc(qualityText(media)) + "</p>" : "") +
      '<a class="shorts-open" target="_blank" rel="noopener noreferrer" href="' + hooks.esc(post.url || "#") + '">' + hooks.esc(openText(post)) + "</a></div>" +
      "</div></article>";
  }

  function avatarFor(handle, row) {
    if (row && row.avatar) return row.avatar;
    var want = foldHandle(handle);
    var feeds = (cached && cached.feeds) || [];
    for (var i = 0; i < feeds.length; i++) {
      if (feeds[i] && foldHandle(feeds[i].handle) === want && feeds[i].avatar) return feeds[i].avatar;
    }
    for (var j = 0; j < addedAccounts.length; j++) {
      if (addedAccounts[j] && foldHandle(addedAccounts[j].handle) === want && addedAccounts[j].avatar) return addedAccounts[j].avatar;
    }
    return "";
  }

  function recordOf(handle) {
    var items = recordings && recordings.items;
    if (!items) return null;
    return items[foldHandle(handle)] || null;
  }

  function recordLabel(row) {
    var rec = row && row.record;
    if (!rec || !rec.state || rec.state === "blocked") return "";
    if (rec.state === "recording") return tr("Recording ({n} of {cap})", { n: recordings.active || 1, cap: recordings.cap || 12 });
    if (rec.state === "queued") return tr("Queued");
    if (rec.state === "saved") return tr("Saved");
    return "";
  }

  function refreshRecordings() {
    var base = apiBase();
    if (!base || !hooks.token() || !ownerHere()) return Promise.resolve(null);
    return fetch(base + "/v1/owner/tiktok/recordings", { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (body) {
      if (!body || !body.items) return body;
      recordings = { cap: body.cap || 12, active: body.active || 0, items: body.items };
      schedulePaint();
      return body;
    }).catch(function () { return null; });
  }

  function liveSlide(row) {
    var handle = String((row && row.handle) || "gabii_g5");
    var profile = "https://www.tiktok.com/@" + encodeURIComponent(handle) + "/live";
    var appProfile = "#/tiktok/" + encodeURIComponent(handle);
    var on = !!(row && row.live);
    var rec = row && row.record || {};
    var saved = !on && rec.state === "saved" && rec.key;
    var avatar = avatarFor(handle, row);
    var cover = avatar ? '<img class="shorts-poster" alt="" src="' + hooks.esc(avatar) + '" referrerpolicy="no-referrer">' : "";
    var savedNote = "";
    if (saved) {
      var bits = [];
      var label = qualityLabel(rec.quality);
      if (label) bits.push(label);
      if (rec.qualityNote) bits.push(tr("Best available"));
      if (bits.length) savedNote = '<p class="shorts-caption">' + hooks.esc(bits.join(" · ")) + "</p>";
    }
    var body = on
      ? cover + '<button class="shorts-hit" type="button" data-shorts="watch" aria-label="' + hooks.esc(tr("LIVE")) + '"></button>'
      : (saved
        ? cover + '<button class="shorts-hit" type="button" data-shorts="saved" aria-label="' + hooks.esc(tr("Saved")) + '"></button>'
        : cover + '<div class="shorts-offline"><h2>' + hooks.esc(tr("Not live right now")) + "</h2>" +
          (row && row.lastLiveAt ? "<p>" + hooks.esc(tr("Last live {time}", { time: hooks.fullTime(row.lastLiveAt) })) + "</p>" : "") +
          '<a class="shorts-open" target="_blank" rel="noopener noreferrer" href="' + hooks.esc(profile) + '">' + hooks.esc(tr("Open on TikTok")) + "</a></div>");
    var viewers = on && row.viewers ? '<span class="shorts-viewers">' + hooks.esc(tr("{count} watching", { count: hooks.formatCount(row.viewers || 0, 1000) })) + "</span>" : "";
    var badge = on ? '<span class="shorts-live-tag">' + hooks.esc(tr("LIVE")) + "</span>" : "";
    var recText = recordLabel(row);
    var recBadge = recText ? '<span class="shorts-rec-tag">' + hooks.esc(recText) + "</span>" : "";
    return '<article class="shorts-slide" data-kind="live" data-handle="' + hooks.esc(handle) + '">' +
      '<div class="shorts-stage">' + body +
      '<div class="shorts-meta">' + badge + recBadge + viewers +
      '<div><a class="shorts-author" href="' + hooks.esc(appProfile) + '">@' + hooks.esc(handle) + "</a></div>" +
      (row && row.title ? '<p class="shorts-caption">' + hooks.esc(row.title) + "</p>" : "") +
      savedNote +
      (on ? '<a class="shorts-open" target="_blank" rel="noopener noreferrer" href="' + hooks.esc(profile) + '">' + hooks.esc(tr("Open on TikTok")) + "</a>" : "") +
      "</div>" +
      (avatar ? '<a class="shorts-ava" style="position:absolute;right:12px;bottom:96px;z-index:2" href="' + hooks.esc(appProfile) + '">' + hooks.avatar(avatar, handle) + "</a>" : "") +
      '<div class="shorts-rail"><button type="button" data-shorts="mute" aria-label="' + hooks.esc(sound ? tr("Mute") : tr("Unmute")) + '">' + hooks.icon(sound ? "vol" : "volOff") + "</button></div>" +
      "</div></article>";
  }

  function tabs(live) {
    var add = ownerHere()
      ? '<button type="button" class="shorts-add" data-shorts="accounts">' + hooks.esc(tr("Add account")) + "</button>"
      : "";
    return '<div class="shorts-tabs"><div class="tabs-bar"><div class="tabs" role="tablist">' +
      '<a class="tab' + (live ? " on" : "") + '" href="#/shorts/live" role="tab" aria-selected="' + (live ? "true" : "false") + '"><span>' + hooks.esc(tr("Live")) + "</span></a>" +
      '<a class="tab' + (live ? "" : " on") + '" href="#/shorts" role="tab" aria-selected="' + (live ? "false" : "true") + '"><span>' + hooks.esc(tr("For you")) + "</span></a>" +
      "</div></div>" + add + "</div>";
  }

  function accountSheet() {
    if (!ownerHere()) return "";
    return '<div class="shorts-sheet" id="shorts-accounts" hidden>' +
      '<div class="shorts-sheet-card" role="dialog" aria-labelledby="shorts-accounts-title">' +
      '<div class="shorts-sheet-head"><h2 id="shorts-accounts-title">' + hooks.esc(tr("Add account")) + "</h2>" +
      '<button type="button" class="shorts-sheet-x" data-shorts="close-accounts" aria-label="' + hooks.esc(tr("Close")) + '">×</button></div>' +
      '<form class="shorts-add-form">' +
      '<input name="handle" autocomplete="off" spellcheck="false" placeholder="' + hooks.esc(tr("Add account URL or @handle")) + '" aria-label="' + hooks.esc(tr("Add account URL or @handle")) + '">' +
      '<button type="submit">' + hooks.esc(tr("Add account")) + "</button></form>" +
      '<p class="shorts-accounts-note" id="shorts-accounts-note"></p>' +
      '<h3>' + hooks.esc(tr("added accounts")) + "</h3>" +
      '<ul class="shorts-account-list" id="shorts-added"></ul></div></div>';
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
      slides = live
        ? '<article class="shorts-slide" data-kind="live"><div class="shorts-stage"></div></article>'
        : '<article class="shorts-slide"><div class="shorts-stage"><div class="shorts-offline"><h2>' + hooks.esc(tr("No posts yet")) + "</h2></div></div></article>";
    }
    return '<div class="shorts-page"><div class="shorts-top">' + mhead() + tabs(live) + "</div>" +
      '<div class="shorts-feed" id="shorts-feed">' + slides + "</div>" + accountSheet() + "</div>";
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

  function sameApi(url) {
    var base = apiBase();
    if (!base) return false;
    try { return new URL(url, location.href).origin === new URL(base).origin; }
    catch (err) { return false; }
  }

  function topLevel(player) {
    var levels = player.levels || [];
    var top = 0;
    var best = -1;
    for (var i = 0; i < levels.length; i++) {
      var score = (Number(levels[i].bitrate) || 0) * 100000 + (Number(levels[i].height) || 0);
      if (score >= best) {
        best = score;
        top = i;
      }
    }
    return levels.length ? top : -1;
  }

  function showLiveLevel(player, level, pinned) {
    if (!onLiveLevel) return;
    var row = (player.levels || [])[level] || {};
    onLiveLevel(level === pinned, Number(row.height) || 0);
  }

  function climbLive(player, pinned) {
    clearTimeout(climbTimer);
    climbTimer = setTimeout(function () {
      if (hls !== player) return;
      var current = player.currentLevel;
      if (current >= 0 && current < pinned) {
        player.currentLevel = current + 1;
        showLiveLevel(player, player.currentLevel, pinned);
        if (player.currentLevel < pinned) climbLive(player, pinned);
      }
    }, 20000);
  }

  function watchStalls(player, Hls, pinned) {
    var stalls = 0;
    player.on(Hls.Events.ERROR, function (event, data) {
      if (!data || data.fatal) return;
      var stall = data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR;
      if (!stall) return;
      stalls += 1;
      if (stalls < 3) return;
      stalls = 0;
      var current = player.currentLevel;
      if (current > 0) {
        player.currentLevel = current - 1;
        showLiveLevel(player, player.currentLevel, pinned);
        climbLive(player, pinned);
      }
    });
    player.on(Hls.Events.FRAG_BUFFERED, function () { stalls = 0; });
  }

  function playHls(video, url, authed, autoplay, forceMuted, pin) {
    var start = autoplay !== false;
    var muted = forceMuted ? true : !sound;
    return loadHls().then(function (Hls) {
      destroyHls();
      if (!Hls || !Hls.isSupported()) {
        if (authed) throw new Error("hls");
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.crossOrigin = "anonymous";
          video.src = url;
          video.muted = muted;
          return start ? video.play() : Promise.resolve();
        }
        throw new Error("hls");
      }
      var player = new Hls({
        enableWorker: true,
        capLevelToPlayerSize: false,
        startLevel: 99,
        xhrSetup: function (xhr, target) {
          xhr.withCredentials = false;
          if (authed && sameApi(target)) {
            var headers = authHeaders();
            if (headers.Authorization) xhr.setRequestHeader("Authorization", headers.Authorization);
          }
        }
      });
      hls = player;
      player.loadSource(url);
      player.attachMedia(video);
      video.muted = muted;
      return new Promise(function (resolve, reject) {
        player.on(Hls.Events.ERROR, function (event, data) {
          if (!data || !data.fatal) return;
          console.error("live playback", data.type, data.details, data);
          reject(new Error(String(data.type || "hls") + " " + String(data.details || "")));
        });
        player.on(Hls.Events.MANIFEST_PARSED, function () {
          var top = topLevel(player);
          player.capLevelToPlayerSize = false;
          if (top >= 0) {
            player.startLevel = top;
            player.currentLevel = top;
          }
          if (pin && top >= 0) {
            showLiveLevel(player, top, top);
            watchStalls(player, Hls, top);
          }
          if (!start) { resolve(); return; }
          video.play().then(resolve).catch(reject);
        });
      });
    });
  }

  function tgUrl(key) {
    var api = apiBase();
    if (!api || !key) return "";
    return api + "/tg/" + String(key).split("/").map(function (part) { return encodeURIComponent(part); }).join("/");
  }

  function socialApi() {
    return window.ViktorychSocial || {};
  }

  function dropBody(res) {
    if (!res || !res.body || !res.body.cancel) return;
    var dropped = res.body.cancel();
    if (dropped && dropped.catch) dropped.catch(function () {});
  }

  function playbackError(status) {
    var err = new Error(String(status || "tg"));
    if (status === 404) err.code = "backing";
    else if (status === 429) err.code = "limited";
    else if (status === 401 || status === "signedout") err.code = "signedout";
    else err.code = "play";
    return err;
  }

  function playbackNote(err) {
    if (err && err.code === "backing") return tr("Backing up…");
    if (err && err.code === "limited") return tr("Too many plays. Try again in a minute.");
    if (err && err.code === "signedout") return tr("Signed out");
    return tr("Couldn't play this video");
  }

  function refreshToken() {
    var accounts = window.ViktorychAccounts;
    if (!accounts || !accounts.refreshToken) return Promise.resolve(hooks.token() || "");
    return accounts.refreshToken().then(function (token) {
      return token || hooks.token() || "";
    }).catch(function () { return hooks.token() || ""; });
  }

  function whenPlaybackAuth() {
    var accounts = window.ViktorychAccounts;
    if (!accounts || !accounts.syncPlaybackAuth) return Promise.resolve();
    return accounts.syncPlaybackAuth().catch(function () {});
  }

  function playTelegramVideo(video, key, preload, retried) {
    var fileUrl = tgUrl(key);
    if (!fileUrl) return Promise.reject(playbackError("play"));
    if (!hooks.token()) {
      if (retried) return Promise.reject(playbackError("signedout"));
      return refreshToken().then(function (token) {
        if (!token) return Promise.reject(playbackError("signedout"));
        return playTelegramVideo(video, key, preload, true);
      });
    }
    var autoplay = preload === "auto";
    var playlist = fileUrl + "/index.m3u8";
    return fetch(playlist, { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      var type = String(res.headers.get("content-type") || "").toLowerCase();
      dropBody(res);
      if (res.status === 401 && !retried) {
        return refreshToken().then(function (token) {
          if (!token) return Promise.reject(playbackError("signedout"));
          return playTelegramVideo(video, key, preload, true);
        });
      }
      if (res.status === 429 || res.status === 401) return Promise.reject(playbackError(res.status));
      if (res.ok && (type.indexOf("mpegurl") >= 0 || type.indexOf("m3u8") >= 0)) {
        if (!autoplay) return Promise.resolve();
        return playHls(video, playlist, true, true, false);
      }
      if (!autoplay) return Promise.resolve();
      return fetch(fileUrl, {
        headers: Object.assign({ Range: "bytes=0-1" }, authHeaders()),
        cache: "no-store"
      }).then(function (file) {
        dropBody(file);
        if (file.status === 401 && !retried) {
          return refreshToken().then(function (token) {
            if (!token) return Promise.reject(playbackError("signedout"));
            return playTelegramVideo(video, key, preload, true);
          });
        }
        if (file.status === 404 || file.status === 429 || file.status === 401) return Promise.reject(playbackError(file.status));
        if (file.status !== 200 && file.status !== 206) return Promise.reject(playbackError(file.status));
        return whenPlaybackAuth().then(function () {
          destroyHls();
          video.crossOrigin = "anonymous";
          video.loop = true;
          video.muted = !sound;
          video.preload = "auto";
          if (video.getAttribute("src") !== fileUrl) video.src = fileUrl;
          return video.play();
        });
      });
    });
  }

  function proxyUrl(direct) {
    return apiBase() + "/v1/owner/media?url=" + encodeURIComponent(direct);
  }

  function destroyMpeg() {
    if (!mpeg) return;
    try { mpeg.pause(); } catch (err) { /* already stopped */ }
    try { mpeg.unload(); } catch (err) { /* already unloaded */ }
    try { mpeg.detachMediaElement(); } catch (err) { /* already detached */ }
    try { mpeg.destroy(); } catch (err) { /* already gone */ }
    mpeg = null;
  }

  function loadMpeg() {
    if (window.mpegts) return Promise.resolve(window.mpegts);
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "mpegts-1.8.0.min.js";
      script.onload = function () { resolve(window.mpegts); };
      script.onerror = function () { reject(new Error("mpegts")); };
      document.head.appendChild(script);
    });
  }

  function playFlv(video, url, authed) {
    return loadMpeg().then(function (mpegts) {
      destroyHls();
      destroyMpeg();
      if (!mpegts || !mpegts.isSupported || !mpegts.isSupported()) throw new Error("mpegts");
      var player = mpegts.createPlayer({
        type: "flv",
        isLive: true,
        url: url,
        hasAudio: true,
        hasVideo: true,
        cors: true,
        withCredentials: false
      }, {
        enableWorker: false,
        headers: authed ? authHeaders() : {},
        liveBufferLatencyChasing: true
      });
      mpeg = player;
      player.attachMediaElement(video);
      video.muted = true;
      player.load();
      return new Promise(function (resolve, reject) {
        var done = false;
        function fail(err) {
          console.error("live playback", err || "flv");
          if (done) {
            if (liveFatal) liveFatal(err || new Error("flv"));
            return;
          }
          done = true;
          reject(err || new Error("flv"));
        }
        if (mpegts.Events && mpegts.Events.ERROR) player.on(mpegts.Events.ERROR, fail);
        var started = video.play();
        if (started && started.then) started.then(function () { if (!done) { done = true; resolve(player); } }).catch(fail);
        else if (!done) { done = true; resolve(player); }
      });
    });
  }

  function rememberLive(handle, info, quiet) {
    if (!cached) cached = { live: {} };
    if (!cached.live) cached.live = {};
    var slot = handle;
    var prev = {};
    Object.keys(cached.live).forEach(function (name) {
      var row = cached.live[name];
      if (row && foldHandle(row.handle || name) === foldHandle(handle)) {
        slot = name;
        prev = row;
      }
    });
    var next = {
      handle: (info && info.handle) || handle,
      live: !!(info && info.live),
      viewers: info && info.viewers || 0,
      title: info && info.title || prev.title || "",
      roomId: (info && info.roomId) || prev.roomId || "",
      lastLiveAt: (info && info.lastLiveAt) || prev.lastLiveAt || "",
      checkedAt: (info && info.checkedAt) || prev.checkedAt || "",
      detail: (info && info.detail) || ""
    };
    cached.live[slot] = next;
    if (quiet && next.live) {
      patchViewers(next.handle, next);
      return;
    }
    schedulePaint();
  }

  function patchViewers(handle, row) {
    var feed = document.getElementById("shorts-feed");
    if (!feed || !onLiveRoute()) return;
    var want = foldHandle(handle);
    var slides = feed.querySelectorAll(".shorts-slide");
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].getAttribute("data-kind") !== "live") continue;
      if (foldHandle(slides[i].getAttribute("data-handle")) !== want) continue;
      var slot = slides[i].querySelector(".shorts-viewers");
      var text = row.live && row.viewers ? tr("{count} watching", { count: hooks.formatCount(row.viewers, 1000) }) : "";
      if (!slot && text) {
        schedulePaint();
        return;
      }
      if (slot) slot.textContent = text;
    }
    livePaintKey = liveRows().map(function (item) {
      return [item.handle, item.live ? 1 : 0, item.viewers || 0, item.lastLiveAt || "", item.title || ""].join("\n");
    }).join("\n");
  }

  function refreshLive(handle) {
    var key = foldHandle(handle);
    if (!key) return Promise.resolve(null);
    if (liveInflight[key]) return liveInflight[key];
    var base = apiBase();
    if (!base || !hooks.token()) return Promise.resolve(null);
    var job = fetch(base + "/v1/owner/live/" + encodeURIComponent(handle), { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (info) {
      if (info) rememberLive(handle, info);
      return info;
    }).catch(function () { return null; }).then(function (info) {
      delete liveInflight[key];
      return info;
    });
    liveInflight[key] = job;
    return job;
  }

  function refreshStats(handle, roomId) {
    var key = foldHandle(handle);
    if (!key) return Promise.resolve(null);
    var inflightKey = "stats:" + key;
    if (liveInflight[inflightKey]) return liveInflight[inflightKey];
    var base = apiBase();
    if (!base || !hooks.token()) return Promise.resolve(null);
    var url = base + "/v1/owner/live/" + encodeURIComponent(handle) + "?stats=1";
    if (roomId && /^[1-9][0-9]{5,24}$/.test(String(roomId))) url += "&room=" + encodeURIComponent(roomId);
    var job = fetch(url, { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      if (res.status === 429 || !res.ok) return null;
      return res.json();
    }).then(function (info) {
      if (info && !info.blocked) rememberLive(handle, Object.assign({ roomId: roomId || "" }, info), true);
      return info;
    }).catch(function () { return null; }).then(function (info) {
      delete liveInflight[inflightKey];
      return info;
    });
    liveInflight[inflightKey] = job;
    return job;
  }

  function onLiveRoute() {
    return /#\/shorts\/live(?:$|[/?#])/.test(location.hash);
  }

  function schedulePaint() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paintLive, 40);
  }

  function paintLive() {
    var feed = document.getElementById("shorts-feed");
    if (!feed || !onLiveRoute()) return;
    var rows = liveRows();
    var key = rows.map(function (row) {
      var rec = row.record || {};
      return [row.handle, row.live ? 1 : 0, row.viewers || 0, row.lastLiveAt || "", row.title || "", rec.state || "", rec.key || "", rec.quality || "", rec.parts || 0].join("\n");
    }).join("\n");
    if (key === livePaintKey && feed.querySelector(".shorts-slide")) return;
    livePaintKey = key;
    var slides = rows.map(liveSlide).join("");
    feed.innerHTML = slides || '<article class="shorts-slide" data-kind="live"><div class="shorts-stage"></div></article>';
  }

  function liveRoot() {
    return document.getElementById("shorts-live-player");
  }

  function bindVideoZoom(stage) {
    if (!stage) return null;
    var zoom = { scale: 1, x: 0, y: 0 };
    var zoomTap = 0;
    var gesture = "";
    var pts = {};
    var pinch = null;
    var drag = null;
    function list() {
      return Object.keys(pts).map(function (id) { return pts[id]; });
    }
    function mediaNodes() {
      return stage.querySelectorAll("video, .shorts-poster");
    }
    function lockFeed() {
      var feed = stage.closest && stage.closest(".shorts-feed");
      if (!feed) return;
      feed.classList.toggle("shorts-zoomed", !!feed.querySelector(".shorts-stage.shorts-zoomed"));
    }
    function apply() {
      if (zoom.scale <= 1) {
        zoom.scale = 1;
        zoom.x = 0;
        zoom.y = 0;
      }
      var maxX = Math.max(0, (stage.clientWidth * (zoom.scale - 1)) / 2);
      var maxY = Math.max(0, (stage.clientHeight * (zoom.scale - 1)) / 2);
      if (zoom.x > maxX) zoom.x = maxX;
      if (zoom.x < -maxX) zoom.x = -maxX;
      if (zoom.y > maxY) zoom.y = maxY;
      if (zoom.y < -maxY) zoom.y = -maxY;
      var transform = zoom.scale === 1 ? "" : "translate3d(" + zoom.x + "px," + zoom.y + "px,0) scale(" + zoom.scale + ")";
      var nodes = mediaNodes();
      for (var i = 0; i < nodes.length; i++) nodes[i].style.transform = transform;
      stage.classList.toggle("shorts-zoomed", zoom.scale > 1);
      lockFeed();
    }
    function setScale(scale) {
      zoom.scale = Math.max(1, Math.min(5, scale));
      if (zoom.scale === 1) { zoom.x = 0; zoom.y = 0; }
      apply();
    }
    function toggleAt(clientX, clientY) {
      if (zoom.scale > 1.05) {
        zoom.scale = 1;
        zoom.x = 0;
        zoom.y = 0;
        apply();
        return;
      }
      var rect = stage.getBoundingClientRect();
      var lx = clientX - rect.left - rect.width / 2;
      var ly = clientY - rect.top - rect.height / 2;
      zoom.scale = 2.5;
      zoom.x = lx * (1 - 2.5);
      zoom.y = ly * (1 - 2.5);
      apply();
    }
    function onDown(event) {
      gesture = "";
      var control = event.target.closest && event.target.closest("button, a");
      if (control && control.getAttribute("data-shorts") !== "stage") return;
      pts[event.pointerId] = { x: event.clientX, y: event.clientY };
      var points = list();
      if (points.length >= 2 || zoom.scale > 1) {
        try { stage.setPointerCapture(event.pointerId); } catch (err) { /* the pointer still moves */ }
      }
      if (points.length >= 2) {
        drag = null;
        pinch = {
          dist: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1,
          scale: zoom.scale,
          x: zoom.x,
          y: zoom.y,
          mx: (points[0].x + points[1].x) / 2,
          my: (points[0].y + points[1].y) / 2
        };
      } else if (zoom.scale > 1) {
        drag = { x: event.clientX, y: event.clientY, ox: zoom.x, oy: zoom.y, moved: false };
      }
    }
    function onMove(event) {
      if (!pts[event.pointerId]) return;
      pts[event.pointerId] = { x: event.clientX, y: event.clientY };
      var points = list();
      if (points.length >= 2 && pinch) {
        event.preventDefault();
        event.stopPropagation();
        var dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
        var mx = (points[0].x + points[1].x) / 2;
        var my = (points[0].y + points[1].y) / 2;
        zoom.scale = Math.max(1, Math.min(5, pinch.scale * dist / pinch.dist));
        zoom.x = pinch.x + (mx - pinch.mx);
        zoom.y = pinch.y + (my - pinch.my);
        apply();
        return;
      }
      if (drag && zoom.scale > 1) {
        event.preventDefault();
        event.stopPropagation();
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;
        zoom.x = drag.ox + (event.clientX - drag.x);
        zoom.y = drag.oy + (event.clientY - drag.y);
        apply();
      }
    }
    function onUp(event) {
      var wasPinch = !!pinch && list().length >= 2;
      var moved = !!(drag && drag.moved);
      var control = event.target.closest && event.target.closest("button, a");
      var onControl = control && control.getAttribute("data-shorts") !== "stage";
      delete pts[event.pointerId];
      if (list().length < 2) pinch = null;
      if (!list().length) drag = null;
      if (wasPinch || moved || onControl) {
        zoomTap = 0;
        gesture = wasPinch ? "pinch" : (moved ? "drag" : "");
        return;
      }
      if (list().length) return;
      var now = Date.now();
      if (now - zoomTap < 300) {
        zoomTap = 0;
        gesture = "double";
        toggleAt(event.clientX, event.clientY);
      } else zoomTap = now;
    }
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("touchmove", function (event) {
      event.stopPropagation();
      if (event.touches.length > 1 || zoom.scale > 1) event.preventDefault();
    }, { passive: false });
    stage.addEventListener("wheel", function (event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      setScale(zoom.scale * Math.exp(-event.deltaY * 0.002));
    }, { passive: false });
    var gestureBase = 1;
    stage.addEventListener("gesturestart", function (event) {
      event.preventDefault();
      gestureBase = zoom.scale;
    }, { passive: false });
    stage.addEventListener("gesturechange", function (event) {
      event.preventDefault();
      setScale(gestureBase * (event.scale || 1));
    }, { passive: false });
    return {
      reset: function () {
        zoom.scale = 1;
        zoom.x = 0;
        zoom.y = 0;
        zoomTap = 0;
        gesture = "";
        apply();
      },
      scale: function () { return zoom.scale; },
      takeGesture: function () {
        var kind = gesture;
        gesture = "";
        return kind;
      }
    };
  }

  function syncMute(button) {
    var label = sound ? tr("Mute") : tr("Unmute");
    if (button) {
      button.setAttribute("aria-label", label);
      button.innerHTML = hooks.icon(sound ? "vol" : "volOff");
    }
    var video = liveRoot() && liveRoot().querySelector("video");
    if (video) video.muted = !sound;
  }

  function showLiveMessage(handle, text, retry) {
    var root = liveRoot();
    if (!root || root.getAttribute("data-handle") !== handle) return;
    var cover = root.querySelector(".shorts-live-cover");
    var note = root.querySelector(".shorts-live-note");
    if (note) note.textContent = text || "";
    var link = root.querySelector(".shorts-live-cover a");
    if (link) link.hidden = false;
    if (retry) ensureRetry(root);
    else {
      var old = root.querySelector("[data-shorts='retry-live']");
      if (old) old.remove();
    }
    if (cover) cover.hidden = false;
    var video = root.querySelector("video");
    if (video) {
      try { video.pause(); } catch (err) { /* already paused */ }
    }
  }

  function ensureRetry(root) {
    var cover = root.querySelector(".shorts-live-cover");
    if (!cover || cover.querySelector("[data-shorts='retry-live']")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "shorts-live-retry";
    button.setAttribute("data-shorts", "retry-live");
    button.textContent = tr("Try again");
    var link = cover.querySelector("a");
    if (link) cover.insertBefore(button, link);
    else cover.appendChild(button);
  }

  function stopStats() {
    clearInterval(statsTimer);
    statsTimer = 0;
    statsHandle = "";
    statsRoom = "";
  }

  function pauseStats() {
    clearInterval(statsTimer);
    statsTimer = 0;
  }

  function statsTick() {
    var root = liveRoot();
    if (!root || !statsHandle || document.visibilityState === "hidden") return;
    var handle = statsHandle;
    refreshStats(handle, statsRoom).then(function (info) {
      applyPlayerStats(handle, info);
    });
  }

  function startStats(handle, roomId) {
    pauseStats();
    statsHandle = handle;
    statsRoom = roomId || "";
    statsTimer = setInterval(statsTick, 15000);
  }

  function applyPlayerStats(handle, info) {
    var root = liveRoot();
    if (!root || root.getAttribute("data-handle") !== handle || !info || info.blocked) return;
    if (info.live === false) {
      endLive(handle);
      return;
    }
    var viewers = root.querySelector(".shorts-live-viewers");
    if (viewers) viewers.textContent = info.viewers ? tr("{count} watching", { count: hooks.formatCount(info.viewers, 1000) }) : "";
  }

  function endLive(handle) {
    var root = liveRoot();
    if (!root || root.getAttribute("data-handle") !== handle) return;
    stopStats();
    destroyHls();
    destroyMpeg();
    var badge = root.querySelector(".shorts-live-tag");
    if (badge) badge.hidden = true;
    var video = root.querySelector("video");
    if (video) {
      try { video.pause(); } catch (err) { /* already paused */ }
      video.removeAttribute("src");
      try { video.load(); } catch (err) { /* the cover stays */ }
    }
    showLiveMessage(handle, tr("Live ended"));
  }

  function attemptLive(video, info) {
    var steps = [];
    if (info.hls) {
      steps.push(function () { return playHls(video, info.hls, false, true, true, true); });
      steps.push(function () { return playHls(video, proxyUrl(info.hls), true, true, true, true); });
    }
    if (info.flv) {
      steps.push(function () { return playFlv(video, info.flv, false); });
      steps.push(function () { return playFlv(video, proxyUrl(info.flv), true); });
    }
    var index = 0;
    function next(err) {
      if (err) console.error("live playback", err && err.message ? err.message : err);
      if (index >= steps.length) return Promise.reject(err || new Error("none"));
      var step = steps[index];
      index += 1;
      return step().catch(next);
    }
    if (!steps.length) return Promise.reject(new Error("none"));
    return next();
  }

  function openSaved(handle) {
    handle = String(handle || "");
    var rec = recordOf(handle);
    if (!handle || !rec || rec.state !== "saved" || !rec.key) return;
    closeLive();
    var token = liveToken;
    var parts = Math.max(1, Number(rec.parts) || 1);
    var part = 1;
    var profile = "https://www.tiktok.com/@" + encodeURIComponent(handle) + "/live";
    var avatar = avatarFor(handle, liveStatus(handle) || {});
    var root = document.createElement("div");
    root.id = "shorts-live-player";
    root.className = "shorts-live-player";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("data-handle", handle);
    root.setAttribute("data-mode", "saved");
    root.innerHTML = '<div class="shorts-live-stage">' +
      '<video playsinline webkit-playsinline autoplay muted></video>' +
      '<div class="shorts-live-cover">' +
      (avatar ? '<img alt="" src="' + hooks.esc(avatar) + '" referrerpolicy="no-referrer">' : "") +
      '<p class="shorts-live-note"></p>' +
      '<a hidden target="_blank" rel="noopener noreferrer" href="' + hooks.esc(profile) + '">' + hooks.esc(tr("Open on TikTok")) + "</a>" +
      "</div></div>" +
      '<div class="shorts-live-hud"><button type="button" data-shorts="close-live" aria-label="' + hooks.esc(tr("Close")) + '">×</button>' +
      '<span class="shorts-live-tag">' + hooks.esc(tr("Saved")) + "</span>" +
      '<span class="shorts-live-q"></span>' +
      '<button type="button" data-shorts="mute" aria-label="' + hooks.esc(sound ? tr("Mute") : tr("Unmute")) + '">' + hooks.icon(sound ? "vol" : "volOff") + "</button></div>" +
      '<div class="shorts-live-foot"><b>@' + hooks.esc(handle) + "</b></div>";
    document.body.appendChild(root);
    document.documentElement.classList.add("shorts-live-open");
    liveZoom = bindVideoZoom(root.querySelector(".shorts-live-stage"));
    var video = root.querySelector("video");
    video.addEventListener("playing", function () {
      if (token !== liveToken) return;
      var cover = root.querySelector(".shorts-live-cover");
      if (cover) cover.hidden = true;
    });
    video.addEventListener("ended", function () {
      if (token !== liveToken) return;
      if (part < parts) playPart(part + 1);
    });
    root.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-shorts]") : null;
      if (!button) return;
      var kind = button.getAttribute("data-shorts");
      if (kind === "close-live") {
        event.preventDefault();
        closeLive();
      } else if (kind === "mute") {
        event.preventDefault();
        sound = !sound;
        syncMute(button);
      }
    });
    var quality = root.querySelector(".shorts-live-q");
    if (quality) {
      var bits = [];
      var label = qualityLabel(rec.quality);
      if (label) bits.push(label);
      if (rec.qualityNote) bits.push(tr("Best available"));
      quality.textContent = bits.join(" · ");
    }
    function playPart(next) {
      part = next;
      var key = String(rec.key || "").replace(/\/\d+$/, "") + "/" + part;
      playHls(video, tgUrl(key) + "/index.m3u8", true, true, false, true).catch(function (err) {
        if (token !== liveToken) return;
        console.error("live playback", err && err.message ? err.message : err);
        showLiveMessage(handle, tr("Couldn't play this live"), false);
      });
    }
    playPart(1);
  }

  function closeLive() {
    liveToken += 1;
    liveFatal = null;
    onLiveLevel = null;
    clearTimeout(climbTimer);
    climbTimer = 0;
    stopStats();
    if (liveZoom) liveZoom.reset();
    liveZoom = null;
    destroyHls();
    destroyMpeg();
    var root = liveRoot();
    if (root) {
      var video = root.querySelector("video");
      if (video) {
        try { video.pause(); } catch (err) { /* already paused */ }
        video.removeAttribute("src");
        try { video.load(); } catch (err) { /* the element is going away */ }
      }
      root.remove();
    }
    document.documentElement.classList.remove("shorts-live-open");
  }

  function openLive(handle) {
    handle = String(handle || "");
    if (!handle) return;
    closeLive();
    var token = liveToken;
    var profile = "https://www.tiktok.com/@" + encodeURIComponent(handle) + "/live";
    var avatar = avatarFor(handle, liveStatus(handle) || {});
    var root = document.createElement("div");
    root.id = "shorts-live-player";
    root.className = "shorts-live-player";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("data-handle", handle);
    root.innerHTML = '<div class="shorts-live-stage">' +
      '<video playsinline webkit-playsinline autoplay muted></video>' +
      '<div class="shorts-live-cover">' +
      (avatar ? '<img alt="" src="' + hooks.esc(avatar) + '" referrerpolicy="no-referrer">' : "") +
      '<p class="shorts-live-note"></p>' +
      '<a hidden target="_blank" rel="noopener noreferrer" href="' + hooks.esc(profile) + '">' + hooks.esc(tr("Open on TikTok")) + "</a>" +
      "</div></div>" +
      '<div class="shorts-live-hud"><button type="button" data-shorts="close-live" aria-label="' + hooks.esc(tr("Close")) + '">×</button>' +
      '<span class="shorts-live-tag">' + hooks.esc(tr("LIVE")) + "</span>" +
      '<span class="shorts-live-q"></span>' +
      '<button type="button" data-shorts="mute" aria-label="' + hooks.esc(sound ? tr("Mute") : tr("Unmute")) + '">' + hooks.icon(sound ? "vol" : "volOff") + "</button></div>" +
      '<div class="shorts-live-foot"><b>@' + hooks.esc(handle) + "</b>" +
      '<span class="shorts-live-viewers"></span></div>';
    document.body.appendChild(root);
    document.documentElement.classList.add("shorts-live-open");
    liveZoom = bindVideoZoom(root.querySelector(".shorts-live-stage"));
    var video = root.querySelector("video");
    video.addEventListener("playing", function () {
      if (token !== liveToken) return;
      var cover = root.querySelector(".shorts-live-cover");
      if (cover) cover.hidden = true;
    });
    root.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-shorts]") : null;
      if (!button) return;
      var kind = button.getAttribute("data-shorts");
      if (kind === "close-live") {
        event.preventDefault();
        closeLive();
      } else if (kind === "mute") {
        event.preventDefault();
        sound = !sound;
        syncMute(button);
      } else if (kind === "retry-live") {
        event.preventDefault();
        var againHandle = root.getAttribute("data-handle") || handle;
        closeLive();
        openLive(againHandle);
      }
    });
    function giveUp(err) {
      if (token !== liveToken) return;
      if (err) console.error("live playback", err && err.message ? err.message : err);
      destroyHls();
      destroyMpeg();
      showLiveMessage(handle, tr("Couldn't play this live"), true);
    }
    liveFatal = function (err) { giveUp(err); };
    refreshLive(handle).then(function (info) {
      if (token !== liveToken) return;
      if (!info) {
        showLiveMessage(handle, tr("Couldn't play this live"), true);
        return;
      }
      var viewers = root.querySelector(".shorts-live-viewers");
      if (viewers && info.viewers) viewers.textContent = tr("{count} watching", { count: hooks.formatCount(info.viewers, 1000) });
      var quality = root.querySelector(".shorts-live-q");
      if (quality) quality.textContent = qualityLabel(info.quality);
      var badge = root.querySelector(".shorts-live-tag");
      if (badge) badge.hidden = !info.live;
      if (info.blocked) {
        showLiveMessage(handle, tr("TikTok blocked this live."));
        return;
      }
      if (!info.live) {
        showLiveMessage(handle, tr("Not live right now"));
        return;
      }
      startStats(handle, info.roomId || "");
      onLiveLevel = function (atTop, height) {
        if (token !== liveToken) return;
        var slot = root.querySelector(".shorts-live-q");
        if (!slot) return;
        slot.textContent = atTop || !height ? qualityLabel(info.quality) : (height + "p");
      };
      if (!info.hls && !info.flv) {
        showLiveMessage(handle, tr("Couldn't play this live"), true);
        return;
      }
      return attemptLive(video, info).then(function () {
        if (token !== liveToken) return;
        if (sound) {
          video.muted = false;
          var again = video.play();
          if (again && again.catch) again.catch(function () { video.muted = true; });
        }
        if (hls && window.Hls) {
          hls.on(window.Hls.Events.ERROR, function (event, data) {
            if (!data || !data.fatal) return;
            giveUp(new Error(String(data.type || "hls") + " " + String(data.details || "")));
          });
        }
      }).catch(giveUp);
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

  function backingNote(slideEl, text) {
    if (!slideEl) return;
    var note = slideEl.querySelector(".shorts-note");
    if (!text) {
      if (note) note.textContent = "";
      return;
    }
    if (!note) {
      note = document.createElement("p");
      note.className = "shorts-note";
      var meta = slideEl.querySelector(".shorts-meta");
      if (meta) meta.appendChild(note);
    }
    note.textContent = text;
  }

  function armStored(video, post, preload) {
    var level = preload === "auto" ? "auto" : "meta";
    var armed = video.dataset.tgArm || "";
    if (armed === "auto" || armed === "auto-pending") return;
    if ((armed === "meta" || armed === "meta-pending") && level !== "auto") return;
    var media = videoOf(post);
    var key = socialApi().fileKey ? socialApi().fileKey(post, media) : "";
    var slideEl = video.closest(".shorts-slide");
    if (post.platform === "tiktok") {
      if (!key) {
        backingNote(slideEl, tr("Backing up…"));
        return;
      }
      if (!hooks.token()) {
        backingNote(slideEl, tr("Signed out"));
        if (video.dataset.tgRefresh === "1") return;
        video.dataset.tgRefresh = "1";
        refreshToken().then(function (token) {
          video.dataset.tgRefresh = "";
          if (token) armStored(video, post, preload);
        });
        return;
      }
      video.dataset.tgArm = level + "-pending";
      playTelegramVideo(video, key, preload).then(function () {
        if (level === "auto" || video.dataset.tgArm !== "auto") video.dataset.tgArm = level;
        video.dataset.tgFail = "";
        var badge = slideEl && slideEl.querySelector(".shorts-quality");
        if (badge && level === "auto") badge.hidden = false;
      }).catch(function (err) {
        if (err && (err.name === "AbortError" || /interrupted by a call to pause/i.test(String(err.message || "")))) {
          if (video.dataset.tgArm === level + "-pending") video.dataset.tgArm = "";
          return;
        }
        if (video.dataset.tgArm === level + "-pending") video.dataset.tgArm = "";
        video.dataset.tgFail = err && err.code ? err.code : "play";
        destroyHls();
        if (video.getAttribute("src")) {
          video.removeAttribute("src");
          try { video.load(); } catch (loadErr) { /* the poster stays */ }
        }
        console.error("shorts playback", err && err.message ? err.message : err);
        var poster = slideEl && slideEl.querySelector(".shorts-poster");
        if (poster) poster.style.display = "block";
        backingNote(slideEl, playbackNote(err));
      });
      return;
    }
    var direct = (media && media.url) || "";
    var r2 = direct && /r2\.dev|workers\.dev/.test(direct) ? direct : "";
    if (!key || !hooks.token()) {
      if (!direct) return;
      video.preload = preload;
      if (video.getAttribute("src") !== direct) video.src = direct;
      return;
    }
    video.dataset.tgArm = level + "-pending";
    playTelegramVideo(video, key, preload).then(function () {
      if (level === "auto" || video.dataset.tgArm !== "auto") video.dataset.tgArm = level;
      var badge = slideEl && slideEl.querySelector(".shorts-quality");
      if (badge) badge.hidden = false;
    }).catch(function () {
      if (r2 || direct) {
        destroyHls();
        video.src = r2 || direct;
        return preload === "auto" ? video.play() : Promise.resolve();
      }
      video.dataset.tgArm = "";
    });
  }

  function armSlide(slideEl, preload) {
    var video = slideEl.querySelector("video");
    if (!video || slideEl.getAttribute("data-kind") === "live") return;
    var post = postById(slideEl.getAttribute("data-id") || "");
    if (!post) return;
    if (post.platform === "tiktok" || (socialApi().fileKey && socialApi().fileKey(post, videoOf(post)))) {
      armStored(video, post, preload);
      return;
    }
    var src = (videoOf(post).url) || "";
    if (!src) return;
    video.preload = preload;
    if (video.getAttribute("src") !== src) video.src = src;
  }

  function stopSlide(slideEl) {
    var video = slideEl.querySelector("video");
    if (!video || slideEl.getAttribute("data-kind") === "live") return;
    video.pause();
    video.dataset.tgArm = "";
    video.dataset.tgFail = "";
    video.dataset.tgRefresh = "";
    if (hls && hls.media === video) destroyHls();
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
      if (slides[i] !== current && slides[i]._zoom) slides[i]._zoom.reset();
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
    if (kind === "watch") {
      event.preventDefault();
      openLive((slideEl && slideEl.getAttribute("data-handle")) || "");
      return;
    }
    if (kind === "saved") {
      event.preventDefault();
      openSaved((slideEl && slideEl.getAttribute("data-handle")) || "");
      return;
    }
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
    var zoomCtrl = slideEl._zoom;
    var gesture = zoomCtrl ? zoomCtrl.takeGesture() : "";
    clearTimeout(tapTimer);
    if (gesture === "drag" || gesture === "pinch") return;
    if (gesture === "double") {
      lastTap = 0;
      if (zoomCtrl.scale() <= 1) return;
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
    if (zoomCtrl && zoomCtrl.scale() > 1) return;
    var now = Date.now();
    lastTap = now;
    tapTimer = setTimeout(function () {
      lastTap = 0;
      if (video.muted || !sound) {
        sound = true;
        video.muted = false;
        var mute = slideEl.querySelector('[data-shorts="mute"]');
        if (mute) {
          mute.setAttribute("aria-label", tr("Mute"));
          mute.innerHTML = hooks.icon("vol");
        }
        var unmuted = video.play();
        if (unmuted && unmuted.catch) unmuted.catch(function () {});
        button.setAttribute("aria-label", tr("Pause"));
        return;
      }
      if (video.paused) {
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
        button.setAttribute("aria-label", tr("Pause"));
      } else {
        video.pause();
        button.setAttribute("aria-label", tr("Play"));
      }
    }, 320);
  }

  function onKey(event) {
    if (!document.documentElement.classList.contains("shorts-on")) return;
    if (event.key === "Escape" && liveRoot()) {
      event.preventDefault();
      closeLive();
      return;
    }
    if (liveRoot()) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    var feed = document.getElementById("shorts-feed");
    if (!feed) return;
    event.preventDefault();
    var current = activeVideo();
    if (current && current._zoom && current._zoom.scale() > 1) current._zoom.reset();
    feed.scrollBy({ top: (event.key === "ArrowDown" ? 1 : -1) * feed.clientHeight, behavior: "smooth" });
  }

  function onError(event) {
    var video = event.target;
    if (!video || video.tagName !== "VIDEO") return;
    var slideEl = video.closest(".shorts-slide");
    if (!slideEl || slideEl.getAttribute("data-kind") === "live") return;
    var post = postById(slideEl.getAttribute("data-id") || "");
    var err = video.error;
    console.error("shorts playback", err && err.code, err && err.message);
    var poster = slideEl.querySelector(".shorts-poster");
    if (poster) poster.style.display = "block";
    if (post && post.platform === "tiktok") {
      var note = slideEl.querySelector(".shorts-note");
      if (!note || !note.textContent) backingNote(slideEl, playbackNote({ code: video.dataset.tgFail || "play" }));
    }
  }

  function renderAdded() {
    var list = document.getElementById("shorts-added");
    if (!list) return;
    if (!addedAccounts.length) {
      list.innerHTML = '<li class="shorts-account-empty">' + hooks.esc(tr("No added accounts yet.")) + "</li>";
      return;
    }
    list.innerHTML = addedAccounts.map(function (row) {
      var handle = String((row && row.handle) || "");
      var name = String((row && row.name) || handle);
      var face = row && row.avatar
        ? '<img alt="" src="' + hooks.esc(row.avatar) + '" referrerpolicy="no-referrer">'
        : hooks.avatar("", name);
      return '<li class="shorts-account"><span class="shorts-account-face">' + face + "</span><span><b>" + hooks.esc(name) + "</b><small>@" + hooks.esc(handle) + "</small></span>" +
        '<button type="button" data-shorts="remove-account" data-handle="' + hooks.esc(handle) + '">' + hooks.esc(tr("Remove")) + "</button></li>";
    }).join("");
  }

  function accountsNote(text) {
    var note = document.getElementById("shorts-accounts-note");
    if (note) note.textContent = text || "";
  }

  function loadAccounts() {
    var base = apiBase();
    if (!base || !hooks.token() || !ownerHere()) {
      renderAdded();
      return Promise.resolve();
    }
    return fetch(base + "/v1/owner/tiktok/accounts", { headers: authHeaders(), cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }).then(function (body) {
      addedAccounts = (body && body.added) || [];
      accountsLoaded = true;
      renderAdded();
      if (onLiveRoute()) schedulePaint();
    }).catch(function () {
      accountsLoaded = true;
      accountsNote(tr("Try again"));
      renderAdded();
      if (onLiveRoute()) schedulePaint();
    });
  }

  function openAccounts() {
    var sheet = document.getElementById("shorts-accounts");
    if (!sheet) return;
    sheet.hidden = false;
    accountsNote("");
    renderAdded();
    var input = sheet.querySelector("input");
    if (input) input.focus();
    loadAccounts();
  }

  function closeAccounts() {
    var sheet = document.getElementById("shorts-accounts");
    if (sheet) sheet.hidden = true;
  }

  function saveAccount(raw) {
    if (addingAccount) return;
    var base = apiBase();
    if (!base || !hooks.token()) return;
    addingAccount = true;
    accountsNote("");
    fetch(base + "/v1/owner/tiktok/accounts", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: JSON.stringify({ handle: raw })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
    }).then(function (result) {
      addingAccount = false;
      if (!result.ok) {
        accountsNote(result.status === 400 ? tr("That doesn’t look like a TikTok account.") : tr("Couldn’t save this account."));
        return;
      }
      var accountRow = result.body && result.body.account;
      if (accountRow && accountRow.handle) {
        addedAccounts = addedAccounts.filter(function (row) { return !row || row.handle !== accountRow.handle; });
        addedAccounts.unshift(accountRow);
      }
      renderAdded();
      var form = document.querySelector(".shorts-add-form");
      if (form) form.reset();
      var lines = [];
      if (result.body && result.body.preview === false) lines.push(tr("Couldn’t preview this profile. It will still be saved."));
      lines.push(tr("New videos show up after the next sync."));
      accountsNote(lines.join(" "));
      if (onLiveRoute()) schedulePaint();
      if (accountRow && accountRow.handle) refreshLive(accountRow.handle);
      pull();
    }).catch(function () {
      addingAccount = false;
      accountsNote(tr("Couldn’t save this account."));
    });
  }

  function removeAccount(handle) {
    var base = apiBase();
    if (!base || !hooks.token() || !handle) return;
    fetch(base + "/v1/owner/tiktok/accounts/" + encodeURIComponent(handle), {
      method: "DELETE",
      headers: authHeaders()
    }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }).then(function (body) {
      addedAccounts = (body && body.added) || [];
      accountsLoaded = true;
      renderAdded();
      if (onLiveRoute()) schedulePaint();
    }).catch(function () {
      accountsNote(tr("Try again"));
    });
  }

  function onPageClick(event) {
    if (event.target && event.target.id === "shorts-accounts") {
      closeAccounts();
      return;
    }
    var button = event.target.closest ? event.target.closest("[data-shorts]") : null;
    if (!button) return;
    var kind = button.getAttribute("data-shorts");
    if (kind === "accounts") {
      event.preventDefault();
      openAccounts();
    } else if (kind === "close-accounts") {
      event.preventDefault();
      closeAccounts();
    } else if (kind === "remove-account") {
      event.preventDefault();
      removeAccount(button.getAttribute("data-handle") || "");
    }
  }

  function onAddSubmit(event) {
    event.preventDefault();
    var input = event.target.querySelector("input");
    saveAccount(input ? input.value : "");
  }

  function mount(route) {
    document.documentElement.classList.add("shorts-on");
    var root = document.querySelector(".shorts-page");
    if (root && !root.dataset.accountsBound) {
      root.dataset.accountsBound = "1";
      root.addEventListener("click", onPageClick);
      var form = root.querySelector(".shorts-add-form");
      if (form) form.addEventListener("submit", onAddSubmit);
    }
    var feed = document.getElementById("shorts-feed");
    if (!feed) return;
    var zoomSlides = feed.querySelectorAll('.shorts-slide[data-kind="video"]');
    for (var z = 0; z < zoomSlides.length; z++) {
      if (zoomSlides[z]._zoom) continue;
      var zoomStage = zoomSlides[z].querySelector(".shorts-stage");
      if (zoomStage) zoomSlides[z]._zoom = bindVideoZoom(zoomStage);
    }
    if (!feed.dataset.zoomBound) {
      feed.dataset.zoomBound = "1";
      feed.addEventListener("touchmove", function (event) {
        if (event.touches.length > 1 || feed.classList.contains("shorts-zoomed")) event.preventDefault();
      }, { passive: false });
      feed.addEventListener("wheel", function (event) {
        if (!feed.classList.contains("shorts-zoomed") || event.ctrlKey) return;
        event.preventDefault();
      }, { passive: false });
    }
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
      Promise.all([pull(), loadAccounts()]).then(function () {
        accountsLoaded = true;
        paintLive();
        refreshRecordings();
        liveRows().forEach(function (row) { if (row && row.handle) refreshLive(row.handle); });
      });
      poll = setInterval(function () {
        if (document.visibilityState !== "visible") return;
        refreshRecordings();
        liveRows().forEach(function (row) {
          if (row && row.live && row.handle) refreshStats(row.handle, row.roomId);
        });
      }, 60 * 1000);
    }
  }

  function unmount() {
    document.documentElement.classList.remove("shorts-on");
    document.removeEventListener("keydown", onKey);
    clearInterval(poll);
    poll = 0;
    clearTimeout(paintTimer);
    closeLive();
    destroyHls();
    var feed = document.getElementById("shorts-feed");
    if (feed) {
      var videos = feed.querySelectorAll("video");
      for (var i = 0; i < videos.length; i++) videos[i].pause();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      pauseStats();
      return;
    }
    if (!statsHandle || !liveRoot()) return;
    statsTick();
    if (!statsTimer) statsTimer = setInterval(statsTick, 15000);
  });

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
