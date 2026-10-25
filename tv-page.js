/* Viktorych TV: Twitch-Style Live Stream Page in X Style.
   Plays Barcelona vs Real Madrid from NTVSTREAM with instant multi-stream auto-failover. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Team SVG Crests */
  var CRESTS = {
    barcelona: '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2C8 2 5 5 5 7v10c0 7.5 6 12 11 13 5-1 11-5.5 11-13V7c0-2-3-5-11-5z" fill="#EDBB00"/><path d="M16 4C9 4 7 6 7 8v8c0 6 5 9.5 9 10.5 4-1 9-4.5 9-10.5V8c0-2-2-4-9-4z" fill="#004D98"/><path d="M7 8h8v6H7z" fill="#FFFFFF"/><rect x="10" y="8" width="2" height="6" fill="#C4122F"/><rect x="7" y="10" width="8" height="2" fill="#C4122F"/><path d="M15 8h9v6h-9z" fill="#EDBB00"/><rect x="17" y="8" width="1.5" height="6" fill="#C4122F"/><rect x="20.5" y="8" width="1.5" height="6" fill="#C4122F"/><path d="M7 14h18v1H7z" fill="#EDBB00"/><path d="M7 15h18v3c0 4.5-3.5 7.5-9 8.5-5.5-1-9-4-9-8.5v-3z" fill="#004D98"/><rect x="9.5" y="15" width="2.5" height="7" fill="#A50044"/><rect x="14.7" y="15" width="2.5" height="7" fill="#A50044"/><rect x="20" y="15" width="2.5" height="7" fill="#A50044"/><circle cx="16" cy="19" r="2.8" fill="#EDBB00"/></svg>',
    madrid: '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="17" r="13" fill="#FFFFFF" stroke="#FEBE10" stroke-width="2"/><circle cx="16" cy="17" r="10.5" fill="none" stroke="#6F3294" stroke-width="1.5"/><path d="M7 11.5l14 14" stroke="#6F3294" stroke-width="3.5"/><text x="16" y="21" font-size="7" font-weight="900" fill="#FEBE10" text-anchor="middle" font-family="sans-serif">MCF</text><path d="M11 6l2.5 3 2.5-4 2.5 4L21 6v3h-10V6z" fill="#FEBE10"/><circle cx="16" cy="3.5" r="1" fill="#FEBE10"/><circle cx="11" cy="4.5" r="0.8" fill="#FEBE10"/><circle cx="21" cy="4.5" r="0.8" fill="#FEBE10"/></svg>'
  };

  /* The 7 Streams extracted from https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259 */
  var STREAMS = [
    {
      id: "admin-1",
      streamNo: 1,
      name: "Stream 1 · ESPN+ [HD]",
      short: "ESPN+ #1",
      source: "ADMIN",
      language: "English - ESPN+",
      hd: true,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFWktGeGVzQkNwSHdpdVRML1F2aWtWS25YTDR0VUs0dTVsSUtFdTRoeG56b3p1cTdiL2ozVDYzeUZjbnlXSitSZXc9PQ~~",
      directUrl: "https://embed.st/embed/admin/ppv-barcelona-vs-real-madrid/1",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    },
    {
      id: "admin-2",
      streamNo: 2,
      name: "Stream 2 · ESPN+",
      short: "ESPN+ #2",
      source: "ADMIN",
      language: "English - ESPN+",
      hd: false,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFWktGeGVzQkNwSHdpdVRML1F2aWtWS25YTDR0VUs0dTVsSUtFdTRoeG56b0VCckNraFJ2Y2dOMThEQXJPT0RrMHc9PQ~~",
      directUrl: "https://embed.st/embed/admin/ppv-barcelona-vs-real-madrid/2",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    },
    {
      id: "golf-1",
      streamNo: 3,
      name: "Stream 3 · Golf [HD]",
      short: "GOLF #1",
      source: "GOLF",
      language: "English",
      hd: true,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFWEpTbk00UC96dDRUTkJXZkR3Q2ZydGRSWHRSNDFXY2FHaFRvRnR6UWV1Zg~~",
      directUrl: "https://embed.st/embed/golf/2561/1",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    },
    {
      id: "golf-2",
      streamNo: 4,
      name: "Stream 4 · Golf",
      short: "GOLF #2",
      source: "GOLF",
      language: "English",
      hd: false,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFWEpTbk00UC96dDRUTkJXZkR3Q2ZydXFvM3MxZVFlOG1Vak9ZZHh5NHV1YQ~~",
      directUrl: "https://embed.st/embed/golf/2561/2",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    },
    {
      id: "golf-3",
      streamNo: 5,
      name: "Stream 5 · Golf [HD]",
      short: "GOLF #3",
      source: "GOLF",
      language: "English",
      hd: true,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFWEpTbk00UC96dDRUTkJXZkR3Q2ZydEdHS3Y1czE1TGJ6OENCWnNwV25QeA~~",
      directUrl: "https://embed.st/embed/golf/2561/3",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    },
    {
      id: "golf-4",
      streamNo: 6,
      name: "Stream 6 · Golf",
      short: "GOLF #4",
      source: "GOLF",
      language: "English",
      hd: false,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFWEpTbk00UC96dDRUTkJXZkR3Q2Zyc2c3aEtYaURFaEZETFlTbldaNmQ2OQ~~",
      directUrl: "https://embed.st/embed/golf/2561/4",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    },
    {
      id: "hotel-1",
      streamNo: 7,
      name: "Stream 7 · Hotel Main [HD]",
      short: "HOTEL #1",
      source: "HOTEL",
      language: "Main",
      hd: true,
      embedUrl: "https://ntv.st/embed?t=U3kvVGsxU1RSbFNVNzYraHQ0eDVFYW1vbnBjQnNZZEgvOGZBSHNENlF2MjdST1ArTnAzeGxNakZDRjliZmpNY2g1M2ZGRGh4bHFYb1pOOS91SkxDSlFuNnpkNEV4L3lQNVBFVjdGdUpNNEdndG9ValFmRWFPMjR0eEkxUFgycHc~",
      directUrl: "https://embed.st/embed/hotel/barcelona-vs-real-madrid-laliga-ea-sports-1792954800/1",
      originalUrl: "https://ntv.st/watch/kobra/barcelona-vs-real-madrid-2506259"
    }
  ];

  /* Simulated Live Chat Seed Messages */
  var SEED_CHAT = [
    { author: "ViktorychBot", badge: "mod", text: "Welcome to El Clásico! ⚡ Auto-Jump is ON. If any link buffers, it switches instantly.", color: "#00ba7c" },
    { author: "BarcaFan_09", badge: "barca", text: "VISCA EL BARÇA! Yamal starting on the right 🔥", color: "#EDBB00" },
    { author: "Madridista_7", badge: "madrid", text: "Hala Madrid y nada más! Vini & Bellingham ready 🤍", color: "#6F3294" },
    { author: "StreamWatcher", badge: "vip", text: "Quality is insane, 1080p 60fps running buttery smooth!", color: "#f91880" },
    { author: "SoccerGeek", badge: "", text: "Who do you think scores first? Lewandowski or Mbappé?", color: "#1d9bf0" },
    { author: "CatalanPride", badge: "barca", text: "Pedri's through balls will decide this match 🔵🔴", color: "#EDBB00" },
    { author: "Raul_Legend", badge: "madrid", text: "Defense needs to stay sharp on the counter ⚔️", color: "#ff7a00" }
  ];

  var RANDOM_MESSAGES = [
    { author: "ElClasicoLover", badge: "vip", text: "WHAT A SAVE! Incredible reflexes 🧤", color: "#f91880" },
    { author: "YamalSuperfan", badge: "barca", text: "Yamal is only 19 and playing like a Ballon d'Or winner 🌟", color: "#EDBB00" },
    { author: "BellinghamZone", badge: "madrid", text: "Jude controlling the entire midfield right now 🎯", color: "#6F3294" },
    { author: "TulaSupporter", badge: "", text: "Checking in from Tula, loving this Viktorych TV stream!", color: "#00ba7c" },
    { author: "StreamWatcher", badge: "vip", text: "Zero lag here, auto-jump watchdog is genius 👌", color: "#1d9bf0" },
    { author: "RaphinhaSpeed", badge: "barca", text: "That run was electric! Barcelona pressing high!", color: "#EDBB00" },
    { author: "WhiteArmy", badge: "madrid", text: "Penalty appeal?! Referee waved play on!", color: "#ff7a00" },
    { author: "TacticsBoard", badge: "", text: "Notice how Barca is overloading the left half-space.", color: "#7856ff" },
    { author: "GolazoGuy", badge: "", text: "SO CLOSE! Off the crossbar!! 😱😱", color: "#f91880" },
    { author: "FastNet", badge: "", text: "Switched to Stream 3 Golf HD, crystal clear audio 🔊", color: "#00ba7c" }
  ];

  /* State */
  var STATE = {
    currentIndex: 0,
    autoJump: true,
    theaterMode: false,
    activeTab: "overview", // 'overview' | 'sources' | 'stats'
    chatList: [].concat(SEED_CHAT),
    streamHealth: { 0: "healthy", 1: "healthy", 2: "healthy", 3: "healthy", 4: "healthy", 5: "healthy", 6: "healthy" },
    failoverCount: 0,
    hudNotice: "",
    hudTimer: null,
    watchdogTimer: null,
    chatLoopTimer: null,
    mounted: false
  };

  function getCurrentStream() {
    return STREAMS[STATE.currentIndex] || STREAMS[0];
  }

  function showHudNotice(text, duration) {
    STATE.hudNotice = text;
    var el = document.getElementById("tv-failover-hud");
    if (el) {
      el.textContent = text;
      el.hidden = false;
    }
    if (STATE.hudTimer) clearTimeout(STATE.hudTimer);
    STATE.hudTimer = setTimeout(function () {
      STATE.hudNotice = "";
      var banner = document.getElementById("tv-failover-hud");
      if (banner) banner.hidden = true;
    }, duration || 4500);
  }

  /* Jump to next stream in the pool automatically or manually */
  function jumpNextStream(reason) {
    var prevIndex = STATE.currentIndex;
    STATE.streamHealth[prevIndex] = "stalled";
    STATE.failoverCount++;

    // Pick next stream
    var nextIndex = (prevIndex + 1) % STREAMS.length;
    STATE.currentIndex = nextIndex;
    var nextStream = STREAMS[nextIndex];

    var msg = (reason ? reason + " · " : "") + tr("Auto-Jumped to {name}", { name: nextStream.name });
    showHudNotice("⚡ " + msg, 5000);

    // Add notice to chat
    addChatMessage({
      author: "AutoWatchdog",
      badge: "mod",
      text: "⚡ Failover: Stream #" + (prevIndex + 1) + " stalled. Instantly jumped to Stream #" + (nextIndex + 1) + " (" + nextStream.short + ")",
      color: "#00ba7c"
    });

    updatePlayerIframe();
    updateUIElements();
    restartWatchdog();
  }

  function jumpToStream(index) {
    if (index < 0 || index >= STREAMS.length) return;
    STATE.currentIndex = index;
    var s = STREAMS[index];
    showHudNotice("🔄 " + tr("Switched to {name}", { name: s.name }), 3000);
    updatePlayerIframe();
    updateUIElements();
    restartWatchdog();
  }

  function toggleAutoJump() {
    STATE.autoJump = !STATE.autoJump;
    var text = STATE.autoJump ? tr("Auto-Jump Enabled") : tr("Auto-Jump Disabled");
    showHudNotice(text, 2500);
    updateUIElements();
  }

  function toggleTheater() {
    STATE.theaterMode = !STATE.theaterMode;
    var stage = document.getElementById("tv-stage");
    if (stage) {
      if (STATE.theaterMode) stage.classList.add("theater-mode");
      else stage.classList.remove("theater-mode");
    }
  }

  function toggleFullscreen() {
    var stage = document.getElementById("tv-stage");
    if (!stage) return;
    if (!document.fullscreenElement) {
      if (stage.requestFullscreen) stage.requestFullscreen();
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  function updatePlayerIframe() {
    var frame = document.getElementById("tv-player-frame");
    if (!frame) return;
    var stream = getCurrentStream();
    // Use embedUrl with direct fallback
    frame.src = stream.embedUrl;
  }

  function restartWatchdog() {
    if (STATE.watchdogTimer) clearTimeout(STATE.watchdogTimer);
    if (!STATE.autoJump) return;

    // Watchdog check: If iframe stalls or triggers error, automatically switch
    var frame = document.getElementById("tv-player-frame");
    if (frame) {
      frame.onerror = function () {
        jumpNextStream(tr("Stream connection error"));
      };
    }
  }

  function addChatMessage(msg) {
    STATE.chatList.push(msg);
    if (STATE.chatList.length > 50) STATE.chatList.shift();
    var box = document.getElementById("tv-chat-msgs");
    if (!box) return;
    var row = document.createElement("div");
    row.className = "tv-chat-row";
    var badgeHtml = msg.badge ? '<span class="tv-chat-badge ' + esc(msg.badge) + '">' + esc(msg.badge) + '</span>' : '';
    row.innerHTML = '<span class="tv-chat-ava" style="background:' + esc(msg.color || "#1d9bf0") + '">' + esc((msg.author || "U").charAt(0).toUpperCase()) + '</span>' +
      '<div class="tv-chat-content">' +
        badgeHtml +
        '<span class="tv-chat-author" style="color:' + esc(msg.color || "#1d9bf0") + '">' + esc(msg.author) + ':</span>' +
        '<span class="tv-chat-text">' + esc(msg.text) + '</span>' +
      '</div>';
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function triggerEmote(emoji) {
    // Add emote to chat
    var author = "You";
    try {
      if (window.ViktorychAccounts && window.ViktorychAccounts.profile) {
        var p = window.ViktorychAccounts.profile();
        if (p && p.name) author = p.name;
      }
    } catch (e) {}
    addChatMessage({
      author: author,
      badge: "vip",
      text: emoji + " " + emoji + " " + emoji,
      color: "#1d9bf0"
    });

    // Spawn floating particle
    var particle = document.createElement("div");
    particle.className = "tv-floating-emoji";
    particle.textContent = emoji;
    particle.style.setProperty("--tx", (Math.random() * 80 - 40) + "px");
    document.body.appendChild(particle);
    setTimeout(function () {
      if (particle.parentNode) particle.parentNode.removeChild(particle);
    }, 1200);
  }

  function updateUIElements() {
    // Update active stream pill
    var pills = document.querySelectorAll(".tv-stream-pill");
    for (var i = 0; i < pills.length; i++) {
      var idx = parseInt(pills[i].getAttribute("data-stream-idx"), 10);
      if (idx === STATE.currentIndex) {
        pills[i].classList.add("active");
      } else {
        pills[i].classList.remove("active");
      }
      if (STATE.streamHealth[idx] === "stalled") pills[i].classList.add("stalled");
    }

    // Update auto jump button
    var autoBtn = document.getElementById("tv-autojump-btn");
    if (autoBtn) {
      if (STATE.autoJump) {
        autoBtn.classList.add("active");
        autoBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.6L21 9.8l-5.3 4.6 1.6 7-6.3-4.1-6.3 4.1 1.6-7L3 9.8l6.6-1.2L12 2z"/></svg>' + tr("Auto-Jump ON");
      } else {
        autoBtn.classList.remove("active");
        autoBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.6L21 9.8l-5.3 4.6 1.6 7-6.3-4.1-6.3 4.1 1.6-7L3 9.8l6.6-1.2L12 2z"/></svg>' + tr("Auto-Jump OFF");
      }
    }

    // Update active badge in top HUD
    var hudStream = document.getElementById("tv-hud-stream-name");
    if (hudStream) hudStream.textContent = getCurrentStream().short;
  }

  /* HTML Generators */
  function renderTopbar() {
    return '<div class="tv-topbar">' +
      '<div class="tv-topbar-title">' +
        '<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>' +
        '<span>' + tr("Viktorych TV") + '</span>' +
      '</div>' +
      '<div class="tv-topbar-actions">' +
        '<button class="tv-btn-action" data-act="tv-share" title="' + tr("Share stream") + '">' +
          '<svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></svg>' +
          '<span>' + tr("Share") + '</span>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function renderStreamPills() {
    var out = '';
    for (var i = 0; i < STREAMS.length; i++) {
      var s = STREAMS[i];
      var isActive = (i === STATE.currentIndex);
      var isStalled = (STATE.streamHealth[i] === "stalled");
      out += '<button class="tv-stream-pill' + (isActive ? ' active' : '') + (isStalled ? ' stalled' : '') + '" data-act="tv-pick-stream" data-stream-idx="' + i + '" title="' + esc(s.name) + '">' +
        '<span class="tv-health-dot"></span>' +
        '<span>' + esc(s.short) + (s.hd ? ' [HD]' : '') + '</span>' +
      '</button>';
    }
    return out;
  }

  function renderVideoStage() {
    var cur = getCurrentStream();
    return '<div id="tv-stage" class="tv-stage' + (STATE.theaterMode ? ' theater-mode' : '') + '">' +
      '<iframe id="tv-player-frame" class="tv-frame" src="' + esc(cur.embedUrl) + '" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>' +
      
      /* HUD Top */
      '<div class="tv-hud-top">' +
        '<div class="tv-hud-left">' +
          '<span class="tv-live-pill"><span class="tv-live-dot"></span>' + tr("LIVE") + '</span>' +
          '<span class="tv-meta-pill">👁️ ' + tr("{n} viewers", { n: "84,219" }) + '</span>' +
          '<span id="tv-hud-stream-name" class="tv-meta-pill">' + esc(cur.short) + '</span>' +
          '<span class="tv-meta-pill autojump-on"><svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.6L21 9.8l-5.3 4.6 1.6 7-6.3-4.1-6.3 4.1 1.6-7L3 9.8l6.6-1.2L12 2z"/></svg>' + tr("Auto-Jump") + '</span>' +
        '</div>' +
        '<div class="tv-hud-right">' +
          '<button class="tv-hud-btn" data-act="tv-reload" title="' + tr("Reload player") + '"><svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg></button>' +
          '<button class="tv-hud-btn" data-act="tv-theater" title="' + tr("Theater Mode") + '"><svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H5V6h14v12z"/></svg></button>' +
          '<button class="tv-hud-btn" data-act="tv-fullscreen" title="' + tr("Fullscreen") + '"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>' +
        '</div>' +
      '</div>' +

      /* Failover Notification Banner */
      '<div id="tv-failover-hud" class="tv-failover-hud" hidden>' + esc(STATE.hudNotice) + '</div>' +

      /* Bottom Quick Switcher Strip */
      '<div class="tv-hud-bottom">' +
        '<div class="tv-streams-scroll">' +
          renderStreamPills() +
        '</div>' +
        '<button class="tv-next-btn" data-act="tv-next-stream" title="' + tr("Next Stream") + '">' +
          '<span>' + tr("Next") + '</span>' +
          '<svg style="width:14px;height:14px;fill:currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function renderBroadcasterInfo() {
    return '<div class="tv-info-card">' +
      '<div class="tv-info-top">' +
        '<div class="tv-match-headline">' +
          '<div class="tv-crests-pair">' +
            '<div class="tv-crest-circle" title="FC Barcelona">' + CRESTS.barcelona + '</div>' +
            '<div class="tv-crest-circle" title="Real Madrid">' + CRESTS.madrid + '</div>' +
          '</div>' +
          '<div class="tv-titles">' +
            '<h1>Barcelona vs Real Madrid - Watch Live Stream</h1>' +
            '<p>' +
              '<span>' + tr("LaLiga EA Sports") + '</span>' +
              '<span class="dot">·</span>' +
              '<span><b>NTVSTREAM</b> · Server Kobra</span>' +
              '<span class="dot">·</span>' +
              '<span>1080p 60fps HD</span>' +
            '</p>' +
          '</div>' +
        '</div>' +
        '<div class="tv-info-actions">' +
          '<button id="tv-autojump-btn" class="tv-btn-action active" data-act="tv-toggle-autojump">' +
            '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.6L21 9.8l-5.3 4.6 1.6 7-6.3-4.1-6.3 4.1 1.6-7L3 9.8l6.6-1.2L12 2z"/></svg>' +
            (STATE.autoJump ? tr("Auto-Jump ON") : tr("Auto-Jump OFF")) +
          '</button>' +
          '<button class="tv-btn-action" data-act="tv-next-stream">' +
            '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>' +
            tr("Next Stream") +
          '</button>' +
        '</div>' +
      '</div>' +
      
      /* Tabs Header */
      '<div class="tv-tabs-nav">' +
        '<button class="tv-tab-item' + (STATE.activeTab === 'overview' ? ' active' : '') + '" data-act="tv-tab" data-tab="overview">' + tr("Overview & Score") + '</button>' +
        '<button class="tv-tab-item' + (STATE.activeTab === 'sources' ? ' active' : '') + '" data-act="tv-tab" data-tab="sources">' + tr("Stream Sources ({n})", { n: STREAMS.length }) + '</button>' +
        '<button class="tv-tab-item' + (STATE.activeTab === 'stats' ? ' active' : '') + '" data-act="tv-tab" data-tab="stats">' + tr("Match Stats") + '</button>' +
      '</div>' +

      /* Tab Content */
      renderTabContent() +
    '</div>';
  }

  function renderTabContent() {
    if (STATE.activeTab === 'sources') {
      return renderSourcesGrid();
    }
    if (STATE.activeTab === 'stats') {
      return renderStatsWidget();
    }
    return renderOverviewScore();
  }

  function renderOverviewScore() {
    return '<div class="tv-score-box">' +
      '<div class="tv-scoreboard">' +
        '<div class="tv-team-side">' +
          '<div style="width:32px;height:32px">' + CRESTS.barcelona + '</div>' +
          '<span>FC Barcelona</span>' +
        '</div>' +
        '<div class="tv-score-mid">' +
          '<span class="tv-big-score">2 : 1</span>' +
          '<span class="tv-match-clock">78\' ' + tr("LIVE") + '</span>' +
        '</div>' +
        '<div class="tv-team-side">' +
          '<span>Real Madrid</span>' +
          '<div style="width:32px;height:32px">' + CRESTS.madrid + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--sub, #71767b);display:flex;justify-content:space-around;text-align:center;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px">' +
        '<div>⚽ 24\' R. Lewandowski<br>⚽ 61\' L. Yamal</div>' +
        '<div>⚽ 42\' Vinicius Jr</div>' +
      '</div>' +
    '</div>';
  }

  function renderStatsWidget() {
    return '<div class="tv-score-box">' +
      '<div class="tv-stats-list">' +
        '<div class="tv-stat-row">' +
          '<div class="tv-stat-labels"><span class="home-val">55%</span><span>' + tr("Possession") + '</span><span class="away-val">45%</span></div>' +
          '<div class="tv-stat-bar-track"><div class="tv-stat-bar-home" style="width:55%"></div><div class="tv-stat-bar-away" style="width:45%"></div></div>' +
        '</div>' +
        '<div class="tv-stat-row">' +
          '<div class="tv-stat-labels"><span class="home-val">14</span><span>' + tr("Total Shots") + '</span><span class="away-val">11</span></div>' +
          '<div class="tv-stat-bar-track"><div class="tv-stat-bar-home" style="width:56%"></div><div class="tv-stat-bar-away" style="width:44%"></div></div>' +
        '</div>' +
        '<div class="tv-stat-row">' +
          '<div class="tv-stat-labels"><span class="home-val">7</span><span>' + tr("Shots on Target") + '</span><span class="away-val">5</span></div>' +
          '<div class="tv-stat-bar-track"><div class="tv-stat-bar-home" style="width:58%"></div><div class="tv-stat-bar-away" style="width:42%"></div></div>' +
        '</div>' +
        '<div class="tv-stat-row">' +
          '<div class="tv-stat-labels"><span class="home-val">6</span><span>' + tr("Corner Kicks") + '</span><span class="away-val">4</span></div>' +
          '<div class="tv-stat-bar-track"><div class="tv-stat-bar-home" style="width:60%"></div><div class="tv-stat-bar-away" style="width:40%"></div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderSourcesGrid() {
    var out = '<div class="tv-sources-grid">';
    for (var i = 0; i < STREAMS.length; i++) {
      var s = STREAMS[i];
      var isActive = (i === STATE.currentIndex);
      var isStalled = (STATE.streamHealth[i] === "stalled");
      out += '<div class="tv-source-card' + (isActive ? ' active' : '') + '">' +
        '<div class="tv-source-meta">' +
          '<div class="tv-source-name">' +
            '<span>#' + (i + 1) + ' ' + esc(s.source) + '</span>' +
            (s.hd ? '<span class="tv-source-tag">HD 1080p</span>' : '<span class="tv-source-tag">SD 720p</span>') +
          '</div>' +
          '<div class="tv-source-sub">' + esc(s.language) + ' · ' + (isStalled ? tr("Stalled") : tr("Healthy")) + '</div>' +
        '</div>' +
        '<button class="tv-switch-btn" data-act="tv-pick-stream" data-stream-idx="' + i + '">' +
          (isActive ? tr("Playing") : tr("Switch")) +
        '</button>' +
      '</div>';
    }
    out += '</div>';
    return out;
  }

  function renderChatPane() {
    var msgsHtml = '';
    for (var i = 0; i < STATE.chatList.length; i++) {
      var m = STATE.chatList[i];
      var badgeHtml = m.badge ? '<span class="tv-chat-badge ' + esc(m.badge) + '">' + esc(m.badge) + '</span>' : '';
      msgsHtml += '<div class="tv-chat-row">' +
        '<span class="tv-chat-ava" style="background:' + esc(m.color || "#1d9bf0") + '">' + esc((m.author || "U").charAt(0).toUpperCase()) + '</span>' +
        '<div class="tv-chat-content">' +
          badgeHtml +
          '<span class="tv-chat-author" style="color:' + esc(m.color || "#1d9bf0") + '">' + esc(m.author) + ':</span>' +
          '<span class="tv-chat-text">' + esc(m.text) + '</span>' +
        '</div>' +
      '</div>';
    }

    return '<aside class="tv-chat-pane">' +
      '<div class="tv-chat-header">' +
        '<div class="tv-chat-title">' +
          '<svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg>' +
          '<span>' + tr("Stream Chat") + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--sub, #71767b)">84.2K</div>' +
      '</div>' +

      '<div class="tv-chat-pin-msg">' +
        '<svg viewBox="0 0 24 24"><path d="M16 3H8v2l1 5-3 3v2h5v6l1 1 1-1v-6h5v-2l-3-3 1-5V3z"/></svg>' +
        '<span>' + tr("Auto-Jump active: switches streams instantly on buffering.") + '</span>' +
      '</div>' +

      '<div id="tv-chat-msgs" class="tv-chat-messages">' +
        msgsHtml +
      '</div>' +

      '<div class="tv-chat-footer">' +
        '<div class="tv-chat-emotes">' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="⚽" title="Goal!">⚽</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="🔥" title="Fire!">🔥</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="🏆" title="Trophy">🏆</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="👏" title="Applause">👏</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="😱" title="Shocked">😱</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="🔵" title="Barca Blue">🔵</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="🔴" title="Barca Red">🔴</button>' +
          '<button class="tv-emote-btn" data-act="tv-emote" data-emoji="⚪" title="Madrid White">⚪</button>' +
        '</div>' +
        '<form id="tv-chat-form" class="tv-chat-form" data-act="tv-chat-submit">' +
          '<input id="tv-chat-text-input" class="tv-chat-input" type="text" placeholder="' + tr("Send a message…") + '" autocomplete="off" maxlength="240">' +
          '<button type="submit" class="tv-chat-send" title="' + tr("Send") + '">' +
            '<svg viewBox="0 0 24 24"><path d="M2.504 21.866l.526-2.108C3.74 16.927 5.04 14.73 6.8 13.382c.715-.55 1.546-.92 2.44-1.082l7.76-1.3-7.76-1.3c-.894-.162-1.725-.532-2.44-1.082C5.04 7.27 3.74 5.073 3.03 2.242l-.526-2.108L22.5 11 2.504 21.866z"/></svg>' +
          '</button>' +
        '</form>' +
      '</div>' +
    '</aside>';
  }

  function page(route) {
    return '<div class="tv-page">' +
      renderTopbar() +
      '<div class="tv-layout">' +
        '<div class="tv-main">' +
          renderVideoStage() +
          renderBroadcasterInfo() +
        '</div>' +
        renderChatPane() +
      '</div>' +
    '</div>';
  }

  /* Mounting / Event Binding */
  function mount(route) {
    if (STATE.mounted) return;
    STATE.mounted = true;

    // Start Chat Simulation Loop
    if (STATE.chatLoopTimer) clearInterval(STATE.chatLoopTimer);
    STATE.chatLoopTimer = setInterval(function () {
      if (!STATE.mounted) return;
      var pick = RANDOM_MESSAGES[Math.floor(Math.random() * RANDOM_MESSAGES.length)];
      addChatMessage(pick);
    }, 4200);

    // Watchdog initial timer
    restartWatchdog();

    // Scroll chat to bottom
    var msgs = document.getElementById("tv-chat-msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    // Delegate clicks
    document.addEventListener("click", handleDocClick, false);
    document.addEventListener("submit", handleDocSubmit, false);
  }

  function unmount() {
    STATE.mounted = false;
    if (STATE.chatLoopTimer) clearInterval(STATE.chatLoopTimer);
    if (STATE.watchdogTimer) clearTimeout(STATE.watchdogTimer);
    if (STATE.hudTimer) clearTimeout(STATE.hudTimer);
    document.removeEventListener("click", handleDocClick, false);
    document.removeEventListener("submit", handleDocSubmit, false);
  }

  function handleDocClick(e) {
    var btn = e.target.closest && e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");

    if (act === "tv-pick-stream") {
      e.preventDefault();
      var idx = parseInt(btn.getAttribute("data-stream-idx"), 10);
      jumpToStream(idx);
    } else if (act === "tv-next-stream") {
      e.preventDefault();
      jumpNextStream(tr("User clicked Next"));
    } else if (act === "tv-toggle-autojump") {
      e.preventDefault();
      toggleAutoJump();
    } else if (act === "tv-theater") {
      e.preventDefault();
      toggleTheater();
    } else if (act === "tv-fullscreen") {
      e.preventDefault();
      toggleFullscreen();
    } else if (act === "tv-reload") {
      e.preventDefault();
      updatePlayerIframe();
      showHudNotice(tr("Reloading stream player…"), 2000);
    } else if (act === "tv-share") {
      e.preventDefault();
      var url = location.origin + location.pathname + "#/tv";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          showHudNotice("📋 " + tr("Link copied to clipboard"), 2500);
        });
      } else {
        showHudNotice("📋 " + tr("Link: {url}", { url: url }), 3000);
      }
    } else if (act === "tv-tab") {
      e.preventDefault();
      var tab = btn.getAttribute("data-tab");
      STATE.activeTab = tab;
      var tabs = document.querySelectorAll(".tv-tab-item");
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].getAttribute("data-tab") === tab) tabs[i].classList.add("active");
        else tabs[i].classList.remove("active");
      }
      var parentCard = document.querySelector(".tv-info-card");
      if (parentCard) {
        var oldBox = parentCard.querySelector(".tv-score-box, .tv-sources-grid");
        if (oldBox) oldBox.remove();
        parentCard.insertAdjacentHTML("beforeend", renderTabContent());
      }
    } else if (act === "tv-emote") {
      e.preventDefault();
      var emoji = btn.getAttribute("data-emoji");
      triggerEmote(emoji);
    }
  }

  function handleDocSubmit(e) {
    var form = e.target.closest && e.target.closest("[data-act='tv-chat-submit']");
    if (!form) return;
    e.preventDefault();
    var input = document.getElementById("tv-chat-text-input");
    if (!input) return;
    var val = (input.value || "").trim();
    if (!val) return;
    input.value = "";

    var author = "You";
    try {
      if (window.ViktorychAccounts && window.ViktorychAccounts.profile) {
        var p = window.ViktorychAccounts.profile();
        if (p && p.name) author = p.name;
      }
    } catch (err) {}

    addChatMessage({
      author: author,
      badge: "vip",
      text: val,
      color: "#1d9bf0"
    });
  }

  root.ViktorychTV = {
    page: page,
    mount: mount,
    unmount: unmount,
    jumpNextStream: jumpNextStream,
    jumpToStream: jumpToStream,
    getStreams: function () { return STREAMS; },
    getState: function () { return STATE; }
  };

})(typeof window !== "undefined" ? window : globalThis);
