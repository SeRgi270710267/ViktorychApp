/* SuperintelMusic Space. Audio-only HLS, no video surface.
   Pure helpers stay usable under node (no document). */
(function (root) {
  "use strict";

  function homePills(items, follows) {
    const set = Object.create(null);
    (follows || []).forEach((id) => { set[String(id)] = true; });
    return (items || []).filter((item) => item && item.live && item.followId && set[String(item.followId)]);
  }

  function profileLive(item, platform, handle) {
    if (!item || !item.live) return false;
    const host = item.host || {};
    const left = String(host.handle || "").replace(/^@/, "").toLowerCase();
    const right = String(handle || "").replace(/^@/, "").toLowerCase();
    return String(host.platform || "") === String(platform || "") && !!left && left === right;
  }

  function hostRule(rule) {
    let text = String(rule || "").trim().toLowerCase();
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    text = text.replace(/^\*\./, "");
    text = text.split("/")[0].split("@").pop().split(":")[0];
    return text.replace(/\.+$/, "");
  }

  function hostAllowed(hostname, allow) {
    const host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
    if (!host) return false;
    const rules = Array.isArray(allow) ? allow : [];
    for (let i = 0; i < rules.length; i++) {
      const rule = hostRule(rules[i]);
      if (!rule) continue;
      if (host === rule || host.endsWith("." + rule)) return true;
    }
    return false;
  }

  function allowedAudio(raw, base, allow) {
    const value = String(raw == null ? "" : raw).trim();
    if (!value || /[\s\\]/.test(value) || value.indexOf("//") === 0) return "";
    let url;
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        if (!/^https:/i.test(value)) return "";
        url = new URL(value);
      } else {
        const rootUrl = String(base == null ? "" : base).trim();
        if (!/^https:\/\//i.test(rootUrl)) return "";
        const folder = rootUrl.endsWith("/") ? rootUrl : rootUrl + "/";
        url = new URL(value, folder);
      }
    } catch (err) {
      return "";
    }
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (!hostAllowed(url.hostname, allow)) return "";
    return url.href;
  }

  function listenersOf(status) {
    if (!status || typeof status !== "object") return null;
    const keys = ["listeners", "viewers", "listening"];
    for (let i = 0; i < keys.length; i++) {
      if (status[keys[i]] == null || status[keys[i]] === "") continue;
      const n = Number(status[keys[i]]);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return null;
  }

  function audioFromStatus(status, allow) {
    const empty = { live: false, url: "", listeners: null, scheduled: false };
    if (!status || typeof status !== "object") return empty;
    const scheduled = status.scheduled === true || status.state === "scheduled";
    const base = typeof status.base === "string" ? status.base : "";
    const hls = status.hls && typeof status.hls === "object" ? status.hls : null;
    const raw = hls && typeof hls.audio === "string" ? hls.audio : "";
    const url = allowedAudio(raw, base, allow);
    const live = status.live === true && !!url;
    return { live: live, url: url, listeners: listenersOf(status), scheduled: scheduled && !live };
  }

  function marqueePlan(overflow, reduced) {
    if (reduced || !(overflow > 1)) return { animate: false, duration: 0 };
    return { animate: true, duration: 20, easing: "linear", from: "0%", to: "-100%" };
  }

  const logic = {
    homePills: homePills,
    profileLive: profileLive,
    allowedAudio: allowedAudio,
    marqueePlan: marqueePlan,
    listenersOf: listenersOf,
    audioFromStatus: audioFromStatus
  };

  if (typeof document === "undefined") {
    root.SpacesLogic = logic;
    return;
  }

  const EMOJIS = ["💜", "🔥", "👏", "😂", "❤️", "🎵"];
  const HLS_SRC = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
  const ICON = {
    down: "M12 15.5 5 8.5l1.4-1.4L12 12.7l5.6-5.6L19 8.5z",
    up: "M12 8.5 19 15.5l-1.4 1.4L12 11.3l-5.6 5.6L5 15.5z",
    more: "M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    mic: "M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2zM3.3 2.9 21 20.6 19.6 22 2 4.3z",
    share: "M18 16.1a2.9 2.9 0 0 0-2.3 1.1l-6.3-3.2a2.9 2.9 0 0 0 0-2l6.3-3.2A2.9 2.9 0 1 0 15 6a2.9 2.9 0 0 0 .1.7L9 9.8a3 3 0 1 0 0 4.4l6.1 3.1a3 3 0 1 0 2.9-1.2z",
    comment: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    pause: "M7 5h3v14H7zM14 5h3v14h-3z",
    play: "M8 5v14l11-7z"
  };

  let hooks = {};
  let spaces = [];
  let extras = [];
  let started = false;
  let polling = false;
  let configOk = false;
  let configErrors = 0;
  let timer = 0;
  let lastPoll = 0;
  let lastSig = "";
  const runtime = Object.create(null);
  const seenMarquee = new WeakSet();
  let io = null;
  const player = {
    audio: null,
    hls: null,
    ctx: null,
    analyser: null,
    time: null,
    raf: 0,
    active: false,
    spaceId: "",
    loadedUrl: "",
    broken: false,
    playErrors: 0,
    retryAt: 0,
    pausedByUser: false,
    corsRetried: false,
    noAnalyser: false,
    returnHash: "",
    dockKey: ""
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  function isFollowed(id) {
    return !!(hooks.isFollowed && id && hooks.isFollowed(id));
  }

  function readDemo() {
    try {
      const host = location.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") return null;
      const raw = sessionStorage.getItem("spaces-demo");
      if (!raw) return null;
      const doc = JSON.parse(raw);
      return doc && typeof doc === "object" ? doc : null;
    } catch (err) {
      return null;
    }
  }

  function demoFor(space) {
    const demo = readDemo();
    if (!demo) return null;
    if (demo.id && space && demo.id !== space.id) return null;
    return demo;
  }

  function effectiveAllow(space) {
    const source = (space && space.source) || {};
    const allow = Array.isArray(source.allow) ? source.allow.slice() : [];
    const demo = demoFor(space);
    if (demo && Array.isArray(demo.allow)) return allow.concat(demo.allow);
    return allow;
  }

  function applyDemo(space, doc) {
    const base = doc && typeof doc === "object" ? Object.assign({}, doc) : {};
    const demo = demoFor(space);
    if (!demo) return base;
    if (typeof demo.live === "boolean") base.live = demo.live;
    if (typeof demo.base === "string") base.base = demo.base;
    if (typeof demo.audio === "string") {
      const hls = base.hls && typeof base.hls === "object" ? Object.assign({}, base.hls) : {};
      hls.audio = demo.audio;
      base.hls = hls;
    }
    if (demo.listeners != null && demo.listeners !== "") base.listeners = demo.listeners;
    if (demo.scheduled === true) base.scheduled = true;
    delete base.title;
    delete base.cover;
    delete base.streamTitle;
    delete base.artist;
    delete base.song;
    delete base.name;
    return base;
  }

  function sameOriginStatus(statusUrl) {
    const raw = String(statusUrl || "").trim();
    if (!raw || raw.indexOf("..") >= 0 || raw.indexOf("\\") >= 0) return "";
    try {
      const url = new URL(raw, new URL(".", location.href));
      if (url.origin !== location.origin) return "";
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      url.searchParams.set("_", String(Date.now()));
      return url.href;
    } catch (err) {
      return "";
    }
  }

  function hostFace(space) {
    const host = (space && space.host) || {};
    let name = host.name || "Host";
    let avatar = host.avatar || (space && space.cover) || "";
    if (hooks.findFeed && host.platform && host.handle) {
      const feed = hooks.findFeed(host.platform, host.handle);
      if (feed) {
        if (feed.name) name = feed.name;
        if (feed.avatar) avatar = feed.avatar;
      }
    }
    return {
      name: name,
      handle: host.handle || "",
      platform: host.platform || "",
      avatar: avatar,
      followId: host.followId || ""
    };
  }

  function playbackOf(space) {
    const source = (space && space.source) || {};
    const allow = effectiveAllow(space);
    const row = runtime[space.id] || {};
    const status = applyDemo(space, row.status || null);
    const type = String(source.type || "");
    if (type === "youtube" && /^[A-Za-z0-9_-]{6,80}$/.test(String(source.channelId || ""))) {
      const known = !!status || source.live === true || row.fetched;
      const live = status ? status.live === true : source.live === true;
      const scheduled = !!(status && (status.scheduled === true || status.state === "scheduled") && !live);
      return { kind: "youtube", live: live && !scheduled, url: "", listeners: listenersOf(status), scheduled: scheduled, allow: allow, channelId: String(source.channelId), forced: known };
    }
    if (source.statusUrl) {
      const parsed = audioFromStatus(status || {}, allow);
      return { kind: "hls", live: parsed.live, url: parsed.url, listeners: parsed.listeners, scheduled: parsed.scheduled, allow: allow, channelId: "", forced: !!row.fetched || !!demoFor(space) };
    }
    if (type === "owncast" && source.server) {
      const server = String(source.server || "").replace(/\/$/, "");
      const playlist = allowedAudio(server + "/hls/stream.m3u8", "", allow);
      const online = !!(status && (status.online === true || status.live === true));
      const listeners = status && status.viewerCount != null ? listenersOf({ listeners: status.viewerCount }) : listenersOf(status);
      return { kind: "hls", live: online && !!playlist, url: playlist, listeners: listeners, scheduled: false, allow: allow, channelId: "", forced: !!row.fetched };
    }
    if ((type === "hls" || type === "audio") && source.url) {
      const url = allowedAudio(source.url, "", allow);
      return { kind: type === "audio" && !/\.m3u8(\?|#|$)/i.test(String(source.url)) ? "audio" : "hls", live: !!url, url: url, listeners: listenersOf(status), scheduled: false, allow: allow, channelId: "", forced: true };
    }
    return { kind: "hls", live: false, url: "", listeners: null, scheduled: false, allow: allow, channelId: "", forced: !!row.fetched };
  }

  function toModel(space) {
    const play = playbackOf(space);
    const broken = !!(player.broken && player.spaceId === space.id);
    let state = "loading";
    if (play.forced) {
      if (play.scheduled) state = "scheduled";
      else if (play.live && !broken) state = "live";
      else state = "ended";
    }
    const face = hostFace(space);
    return {
      id: space.id,
      kind: play.kind || "hls",
      title: space.title || "SuperintelMusic",
      cover: space.cover || face.avatar || "",
      followId: face.followId,
      host: { name: face.name, handle: face.handle, platform: face.platform, avatar: face.avatar },
      live: state === "live",
      state: state,
      listeners: play.listeners,
      playUrl: play.url || "",
      allow: play.allow || [],
      channelId: play.channelId || "",
      href: "#/spaces/" + encodeURIComponent(space.id)
    };
  }

  function videoModels() {
    return extras.map((item) => ({
      id: item.id,
      kind: "video",
      title: item.title || "LIVE",
      cover: "",
      followId: item.followId || "",
      host: { name: "", handle: "", platform: "", avatar: "" },
      live: !!item.live,
      state: item.live ? "live" : "ended",
      listeners: null,
      playUrl: "",
      allow: [],
      channelId: "",
      href: item.href || "#/"
    }));
  }

  function spaceModel(id) {
    const space = spaces.filter((item) => item.id === id)[0];
    return space ? toModel(space) : null;
  }

  function models() {
    return spaces.map(toModel).concat(videoModels());
  }

  function homeItems() {
    const all = models();
    const follows = [];
    all.forEach((item) => {
      if (item.followId && isFollowed(item.followId)) follows.push(item.followId);
    });
    return homePills(all, follows);
  }

  function signature() {
    return models().map((item) => [item.id, item.live, item.state, item.playUrl, item.listeners, item.title].join("~")).join("|")
      + "|" + (player.broken ? "1" : "0") + "|" + player.spaceId;
  }

  function maybeRender() {
    const sig = signature();
    if (sig === lastSig) return;
    if (!hooks.render) return;
    lastSig = sig;
    hooks.render();
  }

  function countLabel(n) {
    if (n == null || n === "") return "";
    const value = Math.floor(Number(n));
    if (!Number.isFinite(value) || value < 0) return "";
    let text = String(value);
    if (value >= 1000000) text = (value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
    else if (value >= 10000) text = Math.round(value / 1000) + "K";
    return text + " listening";
  }

  function marquee(text) {
    const safe = esc(text || "");
    return '<span class="sp-marquee" data-sp-marquee><span class="sp-marquee-clip"><span class="sp-marquee-track"><span class="sp-marquee-copy"><span class="sp-marquee-text">' + safe + '</span></span><span class="sp-marquee-copy" aria-hidden="true"><span class="sp-marquee-text">' + safe + '</span></span></span></span></span>';
  }

  function faceHtml(src, name, cls) {
    if (src) return '<img class="' + cls + '" src="' + esc(src) + '" alt="" referrerpolicy="no-referrer">';
    return '<span class="' + cls + ' sp-initial">' + esc(String(name || "?").trim().slice(0, 1).toUpperCase() || "?") + "</span>";
  }

  function stack(item) {
    const host = item.host || {};
    return '<span class="sp-stack">' + faceHtml(host.avatar, host.name, "sp-face") + "</span>";
  }

  function pill(item) {
    if (item.kind === "video") {
      const label = /live/i.test(item.title || "") ? item.title : (item.title || "LIVE") + " LIVE";
      return '<a class="sp-pill sp-pill-video" href="' + esc(item.href || "#/") + '"><span class="sp-pill-text">' + marquee(label) + '</span><span class="sp-dot" aria-hidden="true"></span></a>';
    }
    return '<a class="sp-pill" href="#/spaces/' + esc(item.id) + '" data-space-open="' + esc(item.id) + '">' + stack(item) + '<span class="sp-pill-text">' + marquee(item.title) + "</span></a>";
  }

  function cardHtml(item) {
    const count = countLabel(item.listeners);
    return '<a class="sp-card" href="#/spaces/' + esc(item.id) + '" data-space-open="' + esc(item.id) + '"><span class="sp-card-top"><span class="sp-live-pill">LIVE</span><span class="sp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></span><span class="sp-card-title">' + esc(item.title) + '</span><span class="sp-card-foot">' + stack(item) + (count ? '<span class="sp-count">' + esc(count) + "</span>" : "") + "</span></a>";
  }

  function homeRow() {
    const items = homeItems();
    if (!items.length) return "";
    return '<div class="sp-row-wrap"><div class="sp-row" role="list">' + items.map((item) => '<div class="sp-row-item" role="listitem">' + pill(item) + "</div>").join("") + "</div></div>";
  }

  function rowExtra() {
    return homeItems().length ? 65 : 0;
  }

  function homeCard() {
    const items = homeItems().filter((item) => item.kind !== "video");
    if (!items.length) return "";
    return '<div class="sp-home-slot">' + items.map(cardHtml).join("") + "</div>";
  }

  function sideCard() {
    const items = homeItems().filter((item) => item.kind !== "video");
    if (!items.length) return "";
    return items.map(cardHtml).join("");
  }

  function profileCard(platform, handle) {
    const item = models().filter((entry) => entry.kind !== "video" && profileLive(entry, platform, handle))[0];
    if (!item) return "";
    return '<div class="sp-home-slot">' + cardHtml(item) + "</div>";
  }

  function avatar(inner, platform, handle) {
    if (!inner || String(inner).indexOf("sp-live-wrap") >= 0) return inner;
    const item = models().filter((entry) => entry.kind !== "video" && profileLive(entry, platform, handle))[0];
    if (!item) return inner;
    return '<a class="sp-live-wrap" href="#/spaces/' + esc(item.id) + '" data-space-open="' + esc(item.id) + '">' + inner + '<span class="sp-live-badge">LIVE</span></a>';
  }

  function sheet(item) {
    const state = item.state || "ended";
    const host = item.host || {};
    const hostLink = host.handle ? "#/" + encodeURIComponent(host.platform || "x") + "/" + encodeURIComponent(host.handle) : "";
    const speaking = player.active && player.spaceId === item.id && state === "live";
    const pulse = speaking && player.noAnalyser ? " pulse" : "";
    let body = "";
    if (state === "ended") body = '<div class="sp-notice"><h2>This Space has ended</h2></div>';
    else if (state === "scheduled") body = '<div class="sp-notice"><h2>Scheduled</h2></div>';
    else if (state === "loading") body = '<div class="sp-notice"><h2>Connecting…</h2></div>';
    else {
      const count = countLabel(item.listeners);
      body = '<div class="sp-stage">'
        + (item.cover ? '<img class="sp-cover" src="' + esc(item.cover) + '" alt="" referrerpolicy="no-referrer">' : "")
        + '<section class="sp-people"><h2>Host</h2><div class="sp-person"><div class="sp-ava sp-speak' + pulse + '" style="--level:0"><span class="sp-ring"></span>'
        + faceHtml(host.avatar, host.name, "sp-host")
        + '</div>' + (hostLink ? '<a class="sp-name" href="' + esc(hostLink) + '">' + esc(host.name || "Host") + "</a>" : '<div class="sp-name">' + esc(host.name || "Host") + "</div>")
        + '<div class="sp-role">Host</div></div></section>'
        + '<section class="sp-listeners"><h2>Listeners</h2>' + (count ? "<p>" + esc(count) + "</p>" : "") + "</section></div>";
    }
    const joined = player.active && player.spaceId === item.id;
    const controls = state !== "live" ? "" : joined
      ? '<div class="sp-controls"><button class="sp-round" type="button" data-space-act="mic" aria-label="Request to speak">' + svg(ICON.mic) + '</button><button class="sp-round sp-emoji-btn" type="button" data-space-act="emoji" aria-label="React">' + EMOJIS[0] + '</button><button class="sp-round" type="button" data-space-act="share" aria-label="Share">' + svg(ICON.share) + '</button><button class="sp-round" type="button" data-space-act="comment" aria-label="Comment">' + svg(ICON.comment) + "</button></div>"
      : '<div class="sp-controls"><button class="sp-start" type="button" data-space-act="listen">Start listening</button></div>';
    const reactions = EMOJIS.map((emoji) => '<button type="button" data-space-act="react" data-emoji="' + emoji + '">' + emoji + "</button>").join("");
    return '<div class="sp-sheet" data-space-id="' + esc(item.id || "") + '"><header class="sp-sheet-bar"><button class="sp-icon" type="button" data-space-act="min" aria-label="Minimize">' + svg(ICON.down) + '</button><button class="sp-icon" type="button" data-space-act="more" aria-label="More">' + svg(ICON.more) + '</button><button class="sp-leave" type="button" data-space-act="leave">Leave</button></header><div class="sp-more" hidden><button type="button" data-space-act="copy">Copy link</button></div><div class="sp-react" hidden>' + reactions + '</div><h1 class="sp-sheet-title">' + esc(item.title || "Space") + "</h1>" + body + controls + "</div>";
  }

  function page(route) {
    const item = spaceModel(route && route.id);
    if (!item) return sheet({ id: "", title: "Space", state: "ended", host: {}, cover: "" });
    return sheet(item);
  }

  function ensureDock() {
    let dock = document.getElementById("space-dock");
    if (dock) return dock;
    dock = document.createElement("div");
    dock.id = "space-dock";
    dock.hidden = true;
    document.body.appendChild(dock);
    return dock;
  }

  function ensureAudio() {
    if (player.audio) return player.audio;
    const audio = document.createElement("audio");
    audio.id = "space-audio";
    audio.crossOrigin = "anonymous";
    audio.preload = "none";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    audio.addEventListener("error", onAudioError);
    audio.addEventListener("playing", onPlaying);
    document.body.appendChild(audio);
    player.audio = audio;
    return audio;
  }

  function loadHls() {
    if (root.Hls) return Promise.resolve(root.Hls);
    if (loadHls.promise) return loadHls.promise;
    loadHls.promise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = HLS_SRC;
      script.onload = () => resolve(root.Hls || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
    return loadHls.promise;
  }

  function destroyHls() {
    if (player.hls && player.hls.destroy) {
      try { player.hls.destroy(); } catch (err) { /* already gone */ }
    }
    player.hls = null;
  }

  function attach(item) {
    const audio = ensureAudio();
    const url = item.playUrl;
    const allow = item.allow || [];
    destroyHls();
    const frame = document.getElementById("space-yt");
    if (frame) frame.remove();
    player.loadedUrl = url;
    const playlist = item.kind !== "audio" || /\.m3u8(\?|#|$)/i.test(url);
    const Hls = root.Hls;
    if (playlist && Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        xhrSetup: (xhr, requestUrl) => {
          if (allowedAudio(requestUrl, url, allow)) return;
          xhr.send = function () {};
          try { xhr.abort(); } catch (err) { /* blocked host */ }
        }
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data && data.fatal) markBroken();
      });
      hls.loadSource(url);
      hls.attachMedia(audio);
      player.hls = hls;
      return;
    }
    if (playlist && (audio.canPlayType("application/vnd.apple.mpegurl") || audio.canPlayType("application/x-mpegURL"))) {
      audio.src = url;
      return;
    }
    if (!playlist) {
      audio.src = url;
      return;
    }
    markBroken();
  }

  function mountYoutube(channelId) {
    destroyHls();
    if (player.audio) {
      player.audio.pause();
      player.audio.removeAttribute("src");
    }
    player.loadedUrl = "";
    player.noAnalyser = true;
    let frame = document.getElementById("space-yt");
    const src = "https://www.youtube-nocookie.com/embed/live_stream?channel=" + encodeURIComponent(channelId) + "&autoplay=1";
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "space-yt";
      frame.className = "sp-yt";
      frame.title = "";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.allow = "autoplay; encrypted-media";
      document.body.appendChild(frame);
    }
    if (frame.src !== src) frame.src = src;
  }

  function ensureAnalyser() {
    if (player.analyser || player.noAnalyser || !player.audio) return;
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) { player.noAnalyser = true; return; }
    try {
      const ctx = player.ctx || new Ctx();
      player.ctx = ctx;
      const source = ctx.createMediaElementSource(player.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      player.analyser = analyser;
      player.time = new Uint8Array(analyser.fftSize);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch (err) {
      player.noAnalyser = true;
    }
  }

  function paintLevel() {
    let level = 0;
    if (player.analyser && player.audio && !player.audio.paused) {
      try {
        player.analyser.getByteTimeDomainData(player.time);
        let sum = 0;
        for (let i = 0; i < player.time.length; i++) {
          const v = (player.time[i] - 128) / 128;
          sum += v * v;
        }
        level = Math.min(1, Math.sqrt(sum / player.time.length) * 3.4);
      } catch (err) {
        player.noAnalyser = true;
      }
    }
    const pulse = !!(player.noAnalyser && player.active && player.audio && !player.audio.paused);
    document.querySelectorAll(".sp-speak").forEach((node) => {
      node.style.setProperty("--level", level.toFixed(3));
      node.classList.toggle("pulse", pulse);
    });
  }

  function startLevel() {
    if (player.raf) return;
    const loop = () => {
      player.raf = 0;
      paintLevel();
      if (player.active && player.audio && !player.audio.paused) player.raf = requestAnimationFrame(loop);
    };
    player.raf = requestAnimationFrame(loop);
  }

  function artworkType(src) {
    if (/\.png(\?|$)/i.test(src)) return "image/png";
    if (/\.webp(\?|$)/i.test(src)) return "image/webp";
    return "image/jpeg";
  }

  function syncSession() {
    if (!navigator.mediaSession || !player.active) return;
    const item = spaceModel(player.spaceId);
    if (!item) return;
    const cover = item.cover || (item.host && item.host.avatar) || "";
    let art = "";
    try { if (cover) art = new URL(cover, location.href).href; } catch (err) { art = ""; }
    const artwork = art ? [{ src: art, sizes: "320x320", type: artworkType(art) }] : [];
    try {
      navigator.mediaSession.metadata = new root.MediaMetadata({
        title: item.title || "SuperintelMusic",
        artist: (item.host && item.host.name) || "",
        artwork: artwork
      });
      const setHandler = (name, fn) => {
        try { navigator.mediaSession.setActionHandler(name, fn); } catch (err) { /* unsupported */ }
      };
      setHandler("play", () => resume());
      setHandler("pause", () => pause());
    } catch (err) { /* metadata is optional */ }
  }

  function clearSession() {
    if (!navigator.mediaSession) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    } catch (err) { /* ignore */ }
  }

  function markBroken() {
    if (!player.active || player.broken) return;
    player.broken = true;
    player.playErrors += 1;
    const steps = [8000, 20000, 45000];
    player.retryAt = Date.now() + steps[Math.min(player.playErrors - 1, 2)];
    if (player.audio && !player.audio.paused) player.audio.pause();
    maybeRender();
    armNext();
  }

  function onAudioError() {
    if (!player.active || player.pausedByUser) return;
    const audio = player.audio;
    if (audio && !player.corsRetried && audio.crossOrigin) {
      player.corsRetried = true;
      player.noAnalyser = true;
      audio.crossOrigin = null;
      const item = spaceModel(player.spaceId);
      if (item && item.playUrl) {
        player.loadedUrl = "";
        attach(item);
        const pending = audio.play();
        if (pending && pending.catch) pending.catch(() => markBroken());
        return;
      }
    }
    markBroken();
  }

  function onPlaying() {
    if (!player.active) return;
    player.broken = false;
    player.playErrors = 0;
    player.retryAt = 0;
    ensureAnalyser();
    startLevel();
    syncSession();
    fillDock();
    maybeRender();
  }

  function listen(id) {
    const item = spaceModel(id);
    if (!item || item.state !== "live") return;
    player.active = true;
    player.spaceId = id;
    player.pausedByUser = false;
    player.broken = false;
    if (item.kind === "youtube") {
      if (!item.channelId) return;
      mountYoutube(item.channelId);
      syncSession();
      fillDock();
      return;
    }
    if (!item.playUrl || !allowedAudio(item.playUrl, "", item.allow)) return;
    const audio = ensureAudio();
    const playlist = item.kind !== "audio" || /\.m3u8(\?|#|$)/i.test(item.playUrl);
    const ready = () => {
      if (!player.active || player.spaceId !== id) return;
      if (player.loadedUrl !== item.playUrl) attach(item);
      const pending = audio.play();
      if (pending && pending.catch) pending.catch(() => markBroken());
      if (player.ctx && player.ctx.state === "suspended") player.ctx.resume().catch(() => {});
      startLevel();
      syncSession();
      fillDock();
    };
    const native = audio.canPlayType("application/vnd.apple.mpegurl") || audio.canPlayType("application/x-mpegURL");
    if (playlist && !(root.Hls && root.Hls.isSupported()) && !native) {
      loadHls().then(ready);
      return;
    }
    ready();
  }

  function pause() {
    player.pausedByUser = true;
    if (player.audio) player.audio.pause();
    fillDock();
  }

  function resume() {
    if (!player.active) return;
    player.pausedByUser = false;
    const item = spaceModel(player.spaceId);
    if (!item || item.kind === "youtube") return;
    if (player.audio) {
      const pending = player.audio.play();
      if (pending && pending.catch) pending.catch(() => markBroken());
    }
    if (player.ctx && player.ctx.state === "suspended") player.ctx.resume().catch(() => {});
    startLevel();
    fillDock();
  }

  function stopPlayback() {
    player.active = false;
    player.pausedByUser = false;
    player.broken = false;
    player.loadedUrl = "";
    player.dockKey = "";
    player.retryAt = 0;
    destroyHls();
    const frame = document.getElementById("space-yt");
    if (frame) frame.remove();
    if (player.audio) {
      player.audio.pause();
      player.audio.removeAttribute("src");
      try { player.audio.load(); } catch (err) { /* ignore */ }
    }
    clearSession();
    const dock = document.getElementById("space-dock");
    if (dock) dock.hidden = true;
    document.body.classList.remove("space-docked");
  }

  function fillDock() {
    const dock = ensureDock();
    const item = player.active ? spaceModel(player.spaceId) : null;
    if (!item) { dock.hidden = true; return; }
    const key = item.id + "|" + item.title + "|" + ((item.host && item.host.avatar) || "") + "|" + (player.audio && player.audio.paused ? "1" : "0");
    if (player.dockKey === key && dock.childElementCount) return;
    player.dockKey = key;
    const playing = player.audio && !player.audio.paused;
    dock.innerHTML = '<a class="sp-dock-open" href="#/spaces/' + esc(item.id) + '" data-space-open="' + esc(item.id) + '">' + stack(item) + '<span class="sp-dock-title">' + marquee(item.title) + '</span></a><button class="sp-icon" type="button" data-space-act="' + (playing ? "pause" : "play") + '" aria-label="' + (playing ? "Pause" : "Play") + '">' + svg(playing ? ICON.pause : ICON.play) + '</button><button class="sp-icon" type="button" data-space-open="' + esc(item.id) + '" aria-label="Expand">' + svg(ICON.up) + "</button>";
    bindMarquees(dock);
  }

  function syncDock(route) {
    const open = !!(route && route.name === "spaces");
    document.body.classList.toggle("space-open", open);
    const dock = ensureDock();
    const show = player.active && !open;
    dock.hidden = !show;
    document.body.classList.toggle("space-docked", show);
    if (show) fillDock();
  }

  function shareUrl(id) {
    let base = location.origin + location.pathname;
    if (hooks.shareRoot) {
      try { base = hooks.shareRoot(); } catch (err) { /* fall through */ }
    }
    if (!String(base).endsWith("/")) base += "/";
    return base + "s/space-" + encodeURIComponent(id) + ".html";
  }

  function copyText(url) {
    const done = () => { if (hooks.toast) hooks.toast("Copied link"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => {
        const input = document.createElement("textarea");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        try { document.execCommand("copy"); } catch (err) { /* ignore */ }
        input.remove();
        done();
      });
      return;
    }
    done();
  }

  function share(id) {
    const item = spaceModel(id);
    const url = shareUrl(id);
    const title = (item && item.title) || "SuperintelMusic";
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch((err) => {
        if (err && err.name === "AbortError") return;
        copyText(url);
      });
      return;
    }
    copyText(url);
  }

  function burst(emoji, x, y) {
    const el = document.createElement("span");
    el.className = "sp-burst";
    el.textContent = emoji;
    el.style.left = x + "px";
    el.style.top = y + "px";
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1100);
  }

  function leave() {
    const back = player.returnHash && player.returnHash.indexOf("#/spaces/") !== 0 ? player.returnHash : "#/";
    stopPlayback();
    if ((location.hash || "") !== back) location.hash = back;
    else if (hooks.render) hooks.render();
  }

  function minimize() {
    const back = player.returnHash && player.returnHash.indexOf("#/spaces/") !== 0 ? player.returnHash : "#/";
    if ((location.hash || "") !== back) location.hash = back;
  }

  function onSpaceOpen(el) {
    const id = el.getAttribute("data-space-open") || "";
    if ((location.hash || "").indexOf("#/spaces/") !== 0) player.returnHash = location.hash || "#/";
    const item = spaceModel(id);
    if (item && item.state === "live") listen(id);
    const hash = "#/spaces/" + encodeURIComponent(id);
    if ((location.hash || "") !== hash) location.hash = hash;
    else if (hooks.render) hooks.render();
  }

  function onSpaceAct(el) {
    const act = el.getAttribute("data-space-act");
    const sheetEl = document.querySelector(".sp-sheet");
    const id = (sheetEl && sheetEl.getAttribute("data-space-id")) || player.spaceId;
    if (act === "listen") { listen(id); if (hooks.render) hooks.render(); return; }
    if (act === "leave") { leave(); return; }
    if (act === "min") { minimize(); return; }
    if (act === "pause") { pause(); return; }
    if (act === "play") { resume(); return; }
    if (act === "share" || act === "copy") { share(id); closePopups(); return; }
    if (act === "mic") { if (hooks.toast) hooks.toast("Request to speak isn’t available."); return; }
    if (act === "comment") { if (hooks.toast) hooks.toast("Replies aren’t available in this Space."); return; }
    if (act === "more") {
      const menu = document.querySelector(".sp-more");
      if (menu) menu.hidden = !menu.hidden;
      const react = document.querySelector(".sp-react");
      if (react) react.hidden = true;
      return;
    }
    if (act === "emoji") {
      const react = document.querySelector(".sp-react");
      if (react) react.hidden = !react.hidden;
      const menu = document.querySelector(".sp-more");
      if (menu) menu.hidden = true;
      return;
    }
    if (act === "react") {
      const emoji = el.getAttribute("data-emoji") || "";
      if (EMOJIS.indexOf(emoji) < 0) return;
      const rect = el.getBoundingClientRect();
      burst(emoji, rect.left + rect.width / 2, rect.top);
      const react = document.querySelector(".sp-react");
      if (react) react.hidden = true;
    }
  }

  function closePopups() {
    document.querySelectorAll(".sp-more, .sp-react").forEach((el) => { el.hidden = true; });
  }

  function targetEl(event) {
    const node = event.target;
    if (!node) return null;
    if (node.closest) return node;
    return node.parentElement || null;
  }

  function applyMarquee(el) {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clip = el.querySelector(".sp-marquee-clip");
    const text = el.querySelector(".sp-marquee-text");
    if (!clip || !text) return;
    if (clip.clientWidth < 2) {
      el.classList.remove("is-on");
      return;
    }
    const overflow = text.scrollWidth - clip.clientWidth;
    const plan = marqueePlan(overflow, reduced);
    el.classList.toggle("is-on", !!plan.animate);
    const track = el.querySelector(".sp-marquee-track");
    if (track) {
      track.style.animationDuration = plan.animate ? plan.duration + "s" : "0s";
      track.style.animationTimingFunction = plan.easing || "linear";
    }
    const paused = document.hidden || el.classList.contains("is-offscreen");
    el.classList.toggle("is-paused", paused);
  }

  function bindMarquees(scope) {
    const rootEl = scope || document;
    rootEl.querySelectorAll("[data-sp-marquee]").forEach((el) => {
      if (seenMarquee.has(el)) { applyMarquee(el); return; }
      seenMarquee.add(el);
      const clip = el.querySelector(".sp-marquee-clip");
      if (clip && root.ResizeObserver) new root.ResizeObserver(() => applyMarquee(el)).observe(clip);
      if (!io && root.IntersectionObserver) {
        io = new root.IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            entry.target.classList.toggle("is-offscreen", !entry.isIntersecting);
            entry.target.classList.toggle("is-paused", document.hidden || !entry.isIntersecting);
          });
        });
      }
      if (io) io.observe(el);
      applyMarquee(el);
    });
  }

  function pauseMarquees() {
    document.querySelectorAll("[data-sp-marquee]").forEach((el) => {
      el.classList.toggle("is-paused", document.hidden || el.classList.contains("is-offscreen"));
    });
  }

  function arm(ms) {
    clearTimeout(timer);
    timer = setTimeout(runPoll, ms);
  }

  function armNext() {
    if (!configOk) { arm(configErrors ? [8000, 20000, 45000][Math.min(configErrors - 1, 2)] : 8000); return; }
    const now = Date.now();
    let wait = document.hidden ? 120000 : 35000;
    Object.keys(runtime).forEach((id) => {
      const row = runtime[id];
      if (row && row.nextAt) wait = Math.min(wait, Math.max(0, row.nextAt - now));
    });
    if (player.broken && player.retryAt) wait = Math.min(wait, Math.max(0, player.retryAt - now));
    if (document.hidden) wait = Math.max(wait, 120000);
    arm(wait < 1000 ? 1000 : wait);
  }

  async function loadCatalog() {
    const url = new URL("feeds.config.json", new URL(".", location.href));
    url.searchParams.set("_", String(Date.now()));
    const res = await fetch(url.href, { cache: "no-store" });
    if (!res.ok) throw new Error("config");
    const doc = await res.json();
    const list = Array.isArray(doc.spaces) ? doc.spaces : [];
    spaces = list.filter((item) => item && /^[A-Za-z0-9_-]{1,120}$/.test(String(item.id || ""))).map((item) => ({
      id: String(item.id),
      title: String(item.title || "SuperintelMusic"),
      cover: typeof item.cover === "string" ? item.cover : "",
      host: {
        name: item.host && item.host.name ? String(item.host.name) : "",
        handle: item.host && item.host.handle ? String(item.host.handle).replace(/^@/, "") : "",
        platform: item.host && item.host.platform ? String(item.host.platform) : "",
        followId: item.host && item.host.followId ? String(item.host.followId) : "",
        avatar: item.host && item.host.avatar ? String(item.host.avatar) : ""
      },
      source: {
        type: item.source && item.source.type ? String(item.source.type) : "",
        statusUrl: item.source && item.source.statusUrl ? String(item.source.statusUrl) : "",
        url: item.source && item.source.url ? String(item.source.url) : "",
        server: item.source && item.source.server ? String(item.source.server) : "",
        channelId: item.source && item.source.channelId ? String(item.source.channelId) : "",
        live: !!(item.source && item.source.live),
        allow: item.source && Array.isArray(item.source.allow) ? item.source.allow.map(String) : []
      }
    }));
  }

  async function loadStatus(space) {
    const source = space.source || {};
    let doc = null;
    if (source.statusUrl) {
      const url = sameOriginStatus(source.statusUrl);
      if (!url) throw new Error("status");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("status");
      doc = await res.json();
    } else if (source.type === "owncast" && source.server) {
      const allow = effectiveAllow(space);
      const statusUrl = allowedAudio(String(source.server).replace(/\/$/, "") + "/api/status", "", allow);
      if (!statusUrl) throw new Error("owncast");
      const bust = statusUrl + (statusUrl.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
      const res = await fetch(bust, { cache: "no-store" });
      if (!res.ok) throw new Error("owncast");
      doc = await res.json();
      if (doc && typeof doc === "object") delete doc.streamTitle;
    }
    return applyDemo(space, doc);
  }

  function adoptPlayback() {
    if (!player.active || player.pausedByUser) return;
    const item = spaceModel(player.spaceId);
    if (!item || item.kind === "youtube") return;
    if (!item.live || !item.playUrl) {
      if (player.audio && !player.audio.paused) player.audio.pause();
      return;
    }
    if (player.broken) {
      if (player.retryAt && Date.now() >= player.retryAt) {
        player.broken = false;
        player.corsRetried = false;
        player.loadedUrl = "";
        attach(item);
        const pending = player.audio.play();
        if (pending && pending.catch) pending.catch(() => markBroken());
      }
      return;
    }
    if (item.playUrl !== player.loadedUrl) {
      attach(item);
      const pending = player.audio.play();
      if (pending && pending.catch) pending.catch(() => markBroken());
    }
  }

  async function refreshAll() {
    const now = Date.now();
    await Promise.all(spaces.map(async (space) => {
      const source = space.source || {};
      const needs = !!(source.statusUrl || source.type === "owncast");
      const row = runtime[space.id] || (runtime[space.id] = { errors: 0, nextAt: 0, status: null, fetched: !needs });
      if (!needs) { row.fetched = true; return; }
      if (row.nextAt && now < row.nextAt) return;
      try {
        row.status = await loadStatus(space);
        row.fetched = true;
        row.errors = 0;
        row.nextAt = Date.now() + (document.hidden ? 120000 : 35000);
      } catch (err) {
        row.fetched = true;
        row.errors += 1;
        const steps = [8000, 20000, 45000];
        row.nextAt = Date.now() + steps[Math.min(row.errors - 1, 2)];
        row.status = applyDemo(space, row.status);
      }
    }));
    adoptPlayback();
    maybeRender();
  }

  async function runPoll() {
    if (polling) return;
    polling = true;
    try {
      await loadCatalog();
      configOk = true;
      configErrors = 0;
      await refreshAll();
      lastPoll = Date.now();
    } catch (err) {
      configOk = false;
      configErrors += 1;
    } finally {
      polling = false;
      armNext();
    }
  }

  function afterRender(route) {
    bindMarquees(document.getElementById("app") || document);
    syncDock(route || null);
    if (player.active) {
      const item = spaceModel(player.spaceId);
      if (item && item.kind !== "youtube" && item.playUrl && item.playUrl !== player.loadedUrl && !player.pausedByUser && !player.broken) {
        attach(item);
        if (player.audio && player.audio.paused) {
          const pending = player.audio.play();
          if (pending && pending.catch) pending.catch(() => {});
        }
      }
      syncSession();
      startLevel();
    }
    if (route && route.name === "spaces") {
      const item = spaceModel(route.id);
      if (item) document.title = item.title + " / SuperintelApp";
    }
  }

  function noteLive(item) {
    if (!item || !item.id) return;
    const id = String(item.id);
    const row = {
      id: id,
      title: String(item.title || "LIVE"),
      followId: String(item.followId || ""),
      live: !!item.live,
      href: String(item.href || "#/")
    };
    const index = extras.findIndex((entry) => entry.id === id);
    if (index >= 0) extras[index] = row;
    else extras.push(row);
    maybeRender();
  }

  function playing() {
    if (!player.active) return false;
    if (document.getElementById("space-yt")) return true;
    return !!(player.audio && !player.audio.paused && !player.audio.ended);
  }

  document.addEventListener("click", (event) => {
    if (event.button && event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const node = targetEl(event);
    if (!node) return;
    const actEl = node.closest("[data-space-act]");
    const openEl = node.closest("[data-space-open]");
    if (!actEl && !openEl) return;
    event.preventDefault();
    event.stopPropagation();
    if (actEl) onSpaceAct(actEl);
    else onSpaceOpen(openEl);
  }, true);

  document.addEventListener("click", (event) => {
    const node = targetEl(event);
    if (node && node.closest && node.closest(".sp-more, .sp-react, [data-space-act='more'], [data-space-act='emoji']")) return;
    closePopups();
  });

  document.addEventListener("visibilitychange", () => {
    pauseMarquees();
    if (!document.hidden && Date.now() - lastPoll > 15000) arm(1000);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.querySelector(".sp-sheet")) minimize();
  });

  function bind(next) { hooks = next || {}; }

  function start() {
    if (started) return;
    started = true;
    ensureAudio();
    ensureDock();
    loadHls();
    runPoll();
  }

  root.Spaces = {
    bind: bind,
    start: start,
    homeRow: homeRow,
    rowExtra: rowExtra,
    homeCard: homeCard,
    sideCard: sideCard,
    profileCard: profileCard,
    avatar: avatar,
    page: page,
    afterRender: afterRender,
    noteLive: noteLive,
    playing: playing,
    homePills: homePills,
    profileLive: profileLive,
    allowedAudio: allowedAudio,
    marqueePlan: marqueePlan
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
