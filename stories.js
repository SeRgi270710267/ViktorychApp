/* Stories tray and viewer. The row is whatever stories.json contains.
   Seen state stays in localStorage. No platform is filled in here. */
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
    if (api && api.productName) return api.productName(kind);
    if (kind === "musicShort") return "ViktrychMusic";
    if (kind === "music") return "ViktorychMusic";
    if (kind === "pwa") return "ViktrychApp";
    return "ViktorychApp";
  }


  var DAY = 24 * 60 * 60 * 1000;
  var PHOTO_MS = 5000;
  var SEEN_KEY = "rss-stories-seen-v1";
  var deps = {};
  var raw = { accounts: [], updated: "" };
  var loadedAt = 0;
  var view = null;
  var timer = 0;
  var pointer = null;
  var soundOn = false;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function https(url) {
    var text = String(url || "");
    return /^https:\/\/[^\s"]+$/i.test(text) ? text : "";
  }

  function mediaUrl(url) {
    var text = String(url || "").trim();
    if (https(text)) return text;
    if (/^[a-zA-Z0-9./_-]+$/.test(text) && text.indexOf("..") < 0 && text.indexOf("//") < 0) return text;
    return "";
  }

  function stamp(value) {
    var parsed = Date.parse(value || "");
    return isNaN(parsed) ? 0 : parsed;
  }

  function expired(item, now) {
    var end = stamp(item && item.expires);
    if (!end && item && item.date) end = stamp(item.date) + DAY;
    return !end || end <= now;
  }

  function activeAccounts(doc, now, follows) {
    var allow = null;
    if (Array.isArray(follows)) {
      allow = Object.create(null);
      follows.forEach(function (id) { allow[String(id)] = true; });
    }
    var out = [];
    var accounts = (doc && doc.accounts) || [];
    accounts.forEach(function (account) {
      if (!account) return;
      var id = String(account.id || "");
      var handle = String(account.handle || "").replace(/^@/, "");
      var platform = String(account.platform || "");
      var pair = platform + ":" + handle;
      if (allow && !allow[id] && !allow[pair]) return;
      var items = (account.items || []).filter(function (item) {
        return item && mediaUrl(item.url) && !expired(item, now);
      }).slice().sort(function (a, b) { return stamp(a.date) - stamp(b.date); });
      if (!items.length) return;
      out.push({
        id: id || pair,
        platform: platform,
        handle: handle,
        name: account.name || handle,
        avatar: mediaUrl(account.avatar),
        items: items
      });
    });
    return out;
  }

  function itemKey(account, item) {
    return String(account.platform || "") + ":" + String(account.handle || "") + ":" + String(item && item.id || "");
  }

  function readSeen() {
    var map = {};
    try { map = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch (err) { map = {}; }
    if (!map || typeof map !== "object") map = {};
    var now = Date.now();
    var changed = false;
    Object.keys(map).forEach(function (key) {
      if (!(Number(map[key]) > now)) {
        delete map[key];
        changed = true;
      }
    });
    if (changed) {
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (err) { /* private mode */ }
    }
    return map;
  }

  function writeSeen(map) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (err) { /* private mode */ }
  }

  function unseen(account, seen) {
    return (account.items || []).some(function (item) { return !seen[itemKey(account, item)]; });
  }

  function newest(account) {
    var max = 0;
    (account.items || []).forEach(function (item) { max = Math.max(max, stamp(item.date)); });
    return max;
  }

  function orderedAccounts(accounts, seen) {
    return (accounts || []).slice().sort(function (a, b) {
      var left = unseen(a, seen || {}) ? 0 : 1;
      var right = unseen(b, seen || {}) ? 0 : 1;
      if (left !== right) return left - right;
      return newest(b) - newest(a);
    });
  }

  function rows() {
    var follows = deps.follows ? deps.follows() : null;
    return orderedAccounts(activeAccounts(raw, Date.now(), follows), readSeen());
  }

  function trayExtra() {
    return rows().length ? 110 : 0;
  }

  function badge(platform) {
    var name = platform === "instagram" ? "ig" : platform === "vk" ? "vk" : platform === "telegram" ? "tg" : "";
    if (!name || !deps.icon) return "";
    return '<span class="story-badge" aria-hidden="true">' + deps.icon(name) + "</span>";
  }

  function face(account) {
    var letter = esc((account.name || account.handle || "?").trim().slice(0, 1).toUpperCase() || "?");
    if (!account.avatar) return '<span class="story-fallback">' + letter + "</span>";
    return '<img src="' + esc(account.avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
  }

  function homeTray() {
    var list = rows();
    if (!list.length) return "";
    return ("<div class=\"story-tray\" role=\"list\" " + "aria-label=\"" + tr("Stories") + "\"" + ">") + list.map(function (account) {
      var seen = readSeen();
      var fresh = unseen(account, seen);
      var label = (account.name || account.handle || tr("Story")) + (fresh ? tr(", unseen story") : tr(", story"));
      return '<button type="button" class="story-card' + (fresh ? " unseen" : " seen") + '" role="listitem" data-act="story" data-id="' + esc(account.id) + '" aria-label="' + esc(label) + '">' +
        '<span class="story-ring"><span class="story-face">' + face(account) + "</span>" + badge(account.platform) + "</span>" +
        '<span class="story-name">' + esc(account.name || account.handle || "") + "</span></button>";
    }).join("") + "</div>";
  }

  function ago(iso) {
    if (typeof window !== "undefined" && window.SI18n && window.SI18n.storyAge) return window.SI18n.storyAge(iso);
    var then = stamp(iso);
    if (!then) return "";
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 45) return tr("now");
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + "m";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h";
    return tr("24h");
  }

  function platformName(platform) {
    if (platform === "instagram") return "Instagram";
    if (platform === "vk") return "VK";
    if (platform === "telegram") return "Telegram";
    if (platform === "youtube") return "YouTube";
    return tr("the original");
  }

  function box() {
    return document.getElementById("stories");
  }

  function current() {
    if (!view) return null;
    var account = view.list[view.account];
    if (!account) return null;
    return { account: account, item: account.items[view.index], index: view.index };
  }

  function mark(account, item) {
    if (!account || !item) return;
    var seen = readSeen();
    var end = stamp(item.expires) || (stamp(item.date) + DAY) || (Date.now() + DAY);
    seen[itemKey(account, item)] = end;
    writeSeen(seen);
  }

  function stopTimer() {
    if (timer) cancelAnimationFrame(timer);
    timer = 0;
  }

  function paintBars(progress) {
    var node = box();
    if (!node || !view) return;
    var bars = node.querySelectorAll(".story-bar i");
    bars.forEach(function (bar, index) {
      var width = index < view.index ? 100 : index === view.index ? Math.max(0, Math.min(100, progress * 100)) : 0;
      bar.style.width = width + "%";
    });
  }

  function duration(item) {
    var video = box() && box().querySelector("video");
    if (item && item.type === "video" && video && isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
    return PHOTO_MS;
  }

  function tick() {
    if (!view || view.paused) return;
    var row = current();
    if (!row) return;
    var video = box() && box().querySelector("video");
    var total = duration(row.item);
    if (row.item.type === "video" && video && isFinite(video.duration) && video.duration > 0 && !video.paused) {
      view.elapsed = video.currentTime * 1000;
    } else if (!view.holding) {
      view.elapsed = Date.now() - view.started;
    }
    var progress = total ? view.elapsed / total : 1;
    paintBars(progress);
    if (progress >= 1) {
      advance(1);
      return;
    }
    timer = requestAnimationFrame(tick);
  }

  function playTimer() {
    stopTimer();
    if (!view) return;
    view.started = Date.now() - (view.elapsed || 0);
    timer = requestAnimationFrame(tick);
  }

  function pause(hold) {
    if (!view) return;
    view.paused = true;
    view.holding = !!hold;
    stopTimer();
    var video = box() && box().querySelector("video");
    if (video && !video.paused) video.pause();
  }

  function resume() {
    if (!view) return;
    view.paused = false;
    view.holding = false;
    var video = box() && box().querySelector("video");
    if (video) {
      video.play().catch(function () { /* autoplay can wait for a tap */ });
    }
    playTimer();
  }

  function warm(item) {
    if (!item || item.type === "video" || !mediaUrl(item.url)) return;
    var img = new Image();
    img.decoding = "async";
    img.src = item.url;
  }

  function renderViewer() {
    var node = box();
    var row = current();
    if (!node || !row) {
      close();
      return;
    }
    var account = row.account;
    var item = row.item;
    mark(account, item);
    var nextItem = account.items[row.index + 1];
    if (!nextItem && view.list[view.account + 1]) nextItem = view.list[view.account + 1].items[0];
    warm(nextItem);
    var bars = account.items.map(function (_item, index) {
      return '<span class="story-bar"><i style="width:' + (index < row.index ? 100 : 0) + '%"></i></span>';
    }).join("");
    var media = "";
    if (item.type === "video") {
      media = '<video class="story-media" autoplay muted playsinline preload="metadata"' +
        (mediaUrl(item.poster) ? ' poster="' + esc(item.poster) + '"' : "") +
        ' src="' + esc(mediaUrl(item.url)) + '"></video>';
    } else {
      media = '<img class="story-media" alt="" src="' + esc(mediaUrl(item.url)) + '"' +
        (row.index === 0 ? ' fetchpriority="high"' : "") + ' referrerpolicy="no-referrer">';
    }
    var sound = item.type === "video"
      ? '<button type="button" class="story-icon" data-story-act="sound" aria-label="' + (soundOn ? tr("Mute") : tr("Unmute")) + '" aria-pressed="' + (soundOn ? "true" : "false") + '">' +
        (deps.icon ? deps.icon(soundOn ? "vol" : "volOff") : (soundOn ? tr("Mute") : tr("Unmute"))) + "</button>"
      : "";
    var open = https(item.open);
    var menu = '<div class="story-menu" hidden>' +
      (open ? '<a href="' + esc(open) + '" target="_blank" rel="noopener noreferrer">Open on ' + esc(platformName(account.platform)) + "</a>" : "") +
      ("<button type=\"button\" data-story-act=\"close\"" + ">" + tr("Close") + "<" + "/button></div>");
    node.innerHTML = '<div class="story-top"><div class="story-bars">' + bars + '</div><div class="story-head">' +
      '<span class="story-mini"><span class="story-face">' + face(account) + "</span></span>" +
      '<span class="story-who"><b>' + esc(account.name || account.handle) + "</b><span>" + esc(ago(item.date)) + "</span></span>" +
      sound +
      ("<button type=\"button\" class=\"story-icon\" data-story-act=\"menu\" " + "aria-label=\"" + tr("More") + "\"" + " aria-expanded=\"false\">") +
      (deps.icon ? deps.icon("more") : "···") + "</button></div></div>" +
      '<div class="story-stage">' + media + ("<p class=\"story-miss\" hidden" + ">" + tr("Couldn’t load this story.") + "<" + "/p></div>") +
      (item.caption ? '<p class="story-caption">' + esc(item.caption) + "</p>" : "") + menu;
    node.hidden = false;
    node.setAttribute("aria-label", (account.name || tr("Story")) + " stories");
    document.documentElement.classList.add("stories-open");
    var video = node.querySelector("video");
    if (video) {
      video.muted = !soundOn;
      video.play().catch(function () { /* the unmute button stays available */ });
      video.addEventListener("loadedmetadata", playTimer);
      video.addEventListener("error", function () {
        var miss = node.querySelector(".story-miss");
        if (miss) miss.hidden = false;
      });
    }
    var image = node.querySelector("img.story-media");
    if (image) {
      image.addEventListener("error", function () {
        var miss = node.querySelector(".story-miss");
        if (miss) miss.hidden = false;
      });
    }
    view.elapsed = 0;
    view.paused = false;
    playTimer();
    var dialog = node;
    if (dialog && dialog.focus) dialog.focus();
  }

  function show(accountAt, itemAt) {
    var list = rows();
    if (!list.length) {
      close();
      return;
    }
    if (!view) view = { list: list };
    view.list = list;
    view.account = Math.max(0, Math.min(accountAt, list.length - 1));
    var items = view.list[view.account].items;
    view.index = Math.max(0, Math.min(itemAt, items.length - 1));
    renderViewer();
  }

  function open(id) {
    var list = rows();
    var at = 0;
    list.forEach(function (account, index) {
      if (account.id === id) at = index;
    });
    if (!list.length) return;
    view = { list: list, account: at, index: 0, elapsed: 0, paused: false };
    show(at, 0);
  }

  function close() {
    stopTimer();
    view = null;
    pointer = null;
    var node = box();
    if (node) {
      node.hidden = true;
      node.innerHTML = "";
    }
    document.documentElement.classList.remove("stories-open");
    if (deps.render) deps.render();
  }

  function advance(step) {
    if (!view) return;
    var account = view.list[view.account];
    if (!account) {
      close();
      return;
    }
    var next = view.index + step;
    if (next >= 0 && next < account.items.length) {
      view.index = next;
      renderViewer();
      return;
    }
    var neighbor = view.account + (step < 0 ? -1 : 1);
    if (neighbor < 0 || neighbor >= view.list.length) {
      close();
      return;
    }
    view.account = neighbor;
    view.index = step < 0 ? view.list[neighbor].items.length - 1 : 0;
    renderViewer();
  }

  function shiftAccount(step) {
    if (!view) return;
    var neighbor = view.account + step;
    if (neighbor < 0 || neighbor >= view.list.length) {
      if (step > 0) close();
      return;
    }
    view.account = neighbor;
    view.index = 0;
    renderViewer();
  }

  function onKey(event) {
    if (!view) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      advance(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      advance(-1);
    } else if (event.key === " ") {
      event.preventDefault();
    }
  }

  function onPointerDown(event) {
    if (!view || !box() || !box().contains(event.target)) return;
    var menu = box().querySelector(".story-menu");
    if (menu && !menu.hidden && !event.target.closest(".story-menu")) {
      menu.hidden = true;
      var more = box().querySelector("[data-story-act='menu']");
      if (more) more.setAttribute("aria-expanded", "false");
      resume();
      return;
    }
    if (event.target.closest("button, a, .story-menu")) return;
    if (event.button != null && event.button !== 0) return;
    pointer = { x: event.clientX, y: event.clientY, t: Date.now(), id: event.pointerId };
    pause(true);
    if (event.currentTarget.setPointerCapture) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (err) { /* already released */ }
    }
  }

  function onPointerUp(event) {
    if (!view || !pointer || pointer.id !== event.pointerId) return;
    var dx = event.clientX - pointer.x;
    var dy = event.clientY - pointer.y;
    var held = Date.now() - pointer.t;
    pointer = null;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
      close();
      return;
    }
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      shiftAccount(dx < 0 ? 1 : -1);
      return;
    }
    if (held < 280 && Math.abs(dx) < 18 && Math.abs(dy) < 18) {
      var stage = box() && box().querySelector(".story-stage");
      var rect = stage ? stage.getBoundingClientRect() : { left: 0, width: window.innerWidth || 1 };
      advance(event.clientX - rect.left < rect.width * 0.33 ? -1 : 1);
      return;
    }
    resume();
  }

  function onPointerCancel() {
    pointer = null;
    resume();
  }

  function onClick(event) {
    if (!view || !box()) return;
    var act = event.target.closest("[data-story-act]");
    if (!act || !box().contains(act)) return;
    if (act.tagName !== "A") event.preventDefault();
    event.stopPropagation();
    var name = act.getAttribute("data-story-act");
    if (name === "close") close();
    else if (name === "menu") {
      var menu = box().querySelector(".story-menu");
      if (!menu) return;
      menu.hidden = !menu.hidden;
      act.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      pause(!menu.hidden);
      if (menu.hidden) resume();
    } else if (name === "sound") {
      soundOn = !soundOn;
      var video = box().querySelector("video");
      if (video) {
        video.muted = !soundOn;
        video.play().catch(function () { /* the control still reflects the choice */ });
      }
      act.setAttribute("aria-label", soundOn ? tr("Mute") : tr("Unmute"));
      act.setAttribute("aria-pressed", soundOn ? "true" : "false");
      act.innerHTML = deps.icon ? deps.icon(soundOn ? "vol" : "volOff") : (soundOn ? tr("Mute") : tr("Unmute"));
    }
  }

  function apply(doc) {
    raw = doc && typeof doc === "object" ? doc : { accounts: [] };
    loadedAt = Date.now();
    if (view) {
      var id = view.list[view.account] && view.list[view.account].id;
      var index = view.index;
      var list = rows();
      var at = 0;
      list.forEach(function (account, i) { if (account.id === id) at = i; });
      if (!list.length) close();
      else show(at, index);
      return;
    }
    if (deps.render) deps.render();
  }

  function load() {
    var headers = { "X-Feed-Refresh": "1", "Accept": "application/json" };
    var local = fetch("stories.json", { cache: "no-cache", headers: headers }).then(function (res) {
      if (!res.ok) throw new Error("missing");
      return res.json();
    });
    var remote = deps.dataUrl
      ? local.catch(function () {
        return fetch(deps.dataUrl, { cache: "no-cache" }).then(function (res) {
          if (!res.ok) throw new Error("missing");
          return res.json();
        });
      })
      : local;
    return remote.then(apply).catch(function () { apply({ accounts: [] }); });
  }

  function bind(next) {
    deps = next || {};
  }

  function start() {
    if (typeof document === "undefined") return;
    var node = box();
    if (node && !node.dataset.bound) {
      node.dataset.bound = "1";
      node.tabIndex = -1;
      node.addEventListener("pointerdown", onPointerDown);
      node.addEventListener("pointerup", onPointerUp);
      node.addEventListener("pointercancel", onPointerCancel);
    }
    load();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", function () {
      if (!view) {
        if (document.visibilityState === "visible" && loadedAt && Date.now() - loadedAt > 10 * 60 * 1000) load();
        return;
      }
      if (document.visibilityState === "hidden") pause(false);
      else resume();
    });
  }

  root.Stories = {
    bind: bind,
    start: start,
    open: open,
    close: close,
    homeTray: homeTray,
    trayExtra: trayExtra,
    apply: apply,
    activeAccounts: activeAccounts,
    orderedAccounts: orderedAccounts,
    itemKey: itemKey
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
