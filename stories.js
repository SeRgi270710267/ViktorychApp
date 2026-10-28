/* Stories tray and viewer. The row mixes stories.json with signed-in
   stories. Seen state and the collapsed bar stay in localStorage. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }
  var DAY = 24 * 60 * 60 * 1000;
  var PHOTO_MS = 5000;
  var VINE_MS = 6000;
  var SEEN_KEY = "rss-stories-seen-v1";
  var BAR_KEY = "viktorych-stories-bar-v1";
  var BAR_H = { expanded: 118, slim: 52, hidden: 28 };
  var REACTIONS = ["❤", "🔥", "👏", "😂", "😮", "😢"];
  var deps = {};
  var raw = { accounts: [], updated: "", telegramConnected: false };
  var loadedAt = 0;
  var view = null;
  var timer = 0;
  var pointer = null;
  var shellPointer = null;
  var suppressClick = false;
  var soundOn = false;
  var pickedFile = null;

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
    if (text.indexOf("/v1/stories/") === 0 && deps.apiRoot) {
      var root = "";
      try { root = String(deps.apiRoot() || ""); } catch (err) { root = ""; }
      root = root.replace(/\/$/, "");
      if (root) return root + text;
    }
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
      if (allow && platform !== "app" && !allow[id] && !allow[pair]) return;
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
        self: !!account.self,
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

  function viewerAccount() {
    if (!deps.account) return null;
    try { return deps.account() || null; } catch (err) { return null; }
  }

  function token() {
    if (!deps.token) return "";
    try { return String(deps.token() || ""); } catch (err) { return ""; }
  }

  function showConnect() {
    if (!deps.owner) return false;
    var on = false;
    try { on = !!deps.owner(); } catch (err) { on = false; }
    if (!on) return false;
    return !(raw && raw.telegramConnected);
  }

  function rows() {
    var follows = deps.follows ? deps.follows() : null;
    return orderedAccounts(activeAccounts(raw, Date.now(), follows), readSeen());
  }

  function selfRow(list) {
    var account = viewerAccount();
    if (!account) return null;
    var found = null;
    (list || []).forEach(function (row) {
      if (!row) return;
      if (row.self || (account.publicId && row.id === "app:" + account.publicId)) found = row;
    });
    if (found) {
      found.self = true;
      return found;
    }
    return {
      id: account.publicId ? "app:" + account.publicId : "app:self",
      platform: "app",
      handle: account.handle || "",
      name: account.displayName || account.handle || tr("Your story"),
      avatar: mediaUrl(account.avatar || ""),
      self: true,
      items: []
    };
  }

  function barState() {
    var value = "expanded";
    try { value = localStorage.getItem(BAR_KEY) || "expanded"; } catch (err) { value = "expanded"; }
    if (value !== "slim" && value !== "hidden") value = "expanded";
    return value;
  }

  function hasTray() {
    if (rows().length) return true;
    if (viewerAccount()) return true;
    if (showConnect()) return true;
    return false;
  }

  function trayExtra() {
    if (!hasTray()) return 0;
    return BAR_H[barState()] || BAR_H.expanded;
  }

  function applyBar(next) {
    if (next !== "expanded" && next !== "slim" && next !== "hidden") next = "expanded";
    var prev = barState();
    try { localStorage.setItem(BAR_KEY, next); } catch (err) { /* private mode */ }
    if (typeof document === "undefined") return;
    var node = document.querySelector(".story-shell");
    if (node) {
      node.setAttribute("data-state", next);
      var fold = node.querySelector(".story-fold");
      if (fold) fold.setAttribute("aria-expanded", next === "expanded" ? "true" : "false");
    }
    var main = document.querySelector("main.center");
    if (main && prev !== next) {
      var current = parseFloat(main.style.getPropertyValue("--top"));
      if (!isNaN(current)) {
        main.style.transition = "padding-top 0.28s cubic-bezier(.2, .9, .2, 1)";
        main.style.setProperty("--top", (current + (BAR_H[next] || 0) - (BAR_H[prev] || 0)) + "px");
        setTimeout(function () { if (main) main.style.transition = ""; }, 320);
      }
    }
  }

  function cycleBar(dir) {
    var order = ["hidden", "slim", "expanded"];
    var at = order.indexOf(barState());
    if (at < 0) at = 2;
    applyBar(order[Math.max(0, Math.min(order.length - 1, at + dir))]);
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

  function cardHtml(account) {
    var seen = readSeen();
    var fresh = unseen(account, seen);
    var label = (account.name || account.handle || tr("Story")) + (fresh ? tr(", unseen story") : tr(", story"));
    return '<button type="button" class="story-card' + (fresh ? " unseen" : " seen") + '" role="listitem" data-act="story" data-id="' + esc(account.id) + '" aria-label="' + esc(label) + '">' +
      '<span class="story-ring"><span class="story-face">' + face(account) + "</span>" + badge(account.platform) + "</span>" +
      '<span class="story-name">' + esc(account.name || account.handle || "") + "</span></button>";
  }

  function selfHtml(account) {
    var fresh = account.items && account.items.length && unseen(account, readSeen());
    var open = account.items && account.items.length;
    var act = open
      ? 'data-act="story" data-id="' + esc(account.id) + '"'
      : 'data-story-act="add"';
    return '<div class="story-card story-self' + (fresh ? " unseen" : " seen") + '" role="listitem">' +
      '<button type="button" class="story-main" ' + act + ' aria-label="' + esc(tr("Your story")) + '">' +
      '<span class="story-ring"><span class="story-face">' + face(account) + "</span></span></button>" +
      '<button type="button" class="story-plus" data-story-act="add" aria-label="' + esc(tr("Add a story")) + '">' +
      (deps.icon ? deps.icon("plus") : "+") + "</button>" +
      '<span class="story-name">' + esc(tr("Your story")) + "</span></div>";
  }

  function connectHtml() {
    return '<button type="button" class="story-card story-connect" role="listitem" data-story-act="connect" aria-label="' + esc(tr("Connect Telegram")) + '">' +
      '<span class="story-ring"><span class="story-face"><span class="story-fallback">T</span></span></span>' +
      '<span class="story-name">' + esc(tr("Connect Telegram")) + "</span></button>";
  }

  function homeTray() {
    var all = rows();
    var mine = selfRow(all);
    var list = all.filter(function (account) {
      if (!account) return false;
      if (account.self) return false;
      if (mine && account.id === mine.id) return false;
      return true;
    });
    var connect = showConnect();
    if (!list.length && !mine && !connect) return "";
    var state = barState();
    var cards = (mine ? selfHtml(mine) : "") + (connect ? connectHtml() : "") + list.map(cardHtml).join("");
    return '<div class="story-shell" data-state="' + state + '">' +
      '<div class="story-tray" role="list" aria-label="' + esc(tr("Stories")) + '">' + cards + "</div>" +
      '<button type="button" class="story-fold" data-story-act="fold" aria-label="' + esc(tr("Collapse stories")) + '" aria-expanded="' + (state === "expanded" ? "true" : "false") + '">' +
      (deps.icon ? deps.icon("chevL") : "") + "</button>" +
      '<button type="button" class="story-peek" data-story-act="expand" aria-label="' + esc(tr("Show stories")) + '">' + esc(tr("Stories")) + "</button></div>";
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
    if (!view || view.compose || view.connect) return null;
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
    if (account.platform === "app" && item.id && !item.mine && deps.api) {
      var auth = token();
      if (auth) deps.api("/v1/stories/" + encodeURIComponent(item.id) + "/seen", { method: "POST", token: auth, body: {} });
    }
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
    if (item && item.vine) return VINE_MS;
    var video = box() && box().querySelector("video");
    if (item && item.type === "video" && video && isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
    return PHOTO_MS;
  }

  function tick() {
    if (!view || view.paused || view.compose || view.connect) return;
    var row = current();
    if (!row) return;
    var video = box() && box().querySelector("video");
    var total = duration(row.item);
    if (row.item.vine) {
      if (!view.holding) view.elapsed = Date.now() - view.started;
    } else if (row.item.type === "video" && video && isFinite(video.duration) && video.duration > 0 && !video.paused) {
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
    if (!view || view.compose || view.connect) return;
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
    if (!view || view.compose || view.connect) return;
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
    img.src = mediaUrl(item.url);
  }

  function socialBar(account, item) {
    if (!account || account.platform !== "app") return "";
    var reacts = REACTIONS.map(function (emoji) {
      return '<button type="button" class="story-react" data-story-act="react" data-emoji="' + emoji + '" aria-label="' + esc(tr("Send a reaction")) + '">' + emoji + "</button>";
    }).join("");
    var owner = item && item.mine
      ? '<button type="button" class="story-icon" data-story-act="views" aria-label="' + esc(tr("Who viewed this story")) + '">' + esc(tr("Views")) + "</button>" +
        '<button type="button" class="story-icon" data-story-act="delete" aria-label="' + esc(tr("Delete story")) + '">' + esc(tr("Delete story")) + "</button>"
      : "";
    return '<div class="story-social"><div class="story-reacts">' + reacts + "</div>" +
      '<form class="story-reply"><input class="story-reply-text" maxlength="280" placeholder="' + esc(tr("Reply to story")) + '" aria-label="' + esc(tr("Reply to story")) + '">' +
      '<button type="button" data-story-act="reply">' + esc(tr("Send")) + "</button></form>" + owner +
      '<div class="story-views" hidden></div><div class="story-confirm" hidden><p>' + esc(tr("Delete this story?")) + '</p>' +
      '<button type="button" data-story-act="delete-yes">' + esc(tr("Delete story")) + '</button>' +
      '<button type="button" data-story-act="delete-no">' + esc(tr("Close")) + "</button></div></div>";
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
    var src = mediaUrl(item.url);
    var media = "";
    if (item.type === "video") {
      media = '<video class="story-media" autoplay muted playsinline preload="metadata"' + (item.vine ? " loop" : "") +
        (mediaUrl(item.poster) ? ' poster="' + esc(mediaUrl(item.poster)) + '"' : "") +
        ' src="' + esc(src) + '"></video>';
    } else {
      media = '<img class="story-media" alt="" src="' + esc(src) + '"' +
        (row.index === 0 ? ' fetchpriority="high"' : "") + ' referrerpolicy="no-referrer">';
    }
    var sound = item.type === "video"
      ? '<button type="button" class="story-icon" data-story-act="sound" aria-label="' + (soundOn || item.vine ? tr("Mute") : tr("Unmute")) + '" aria-pressed="' + (soundOn || item.vine ? "true" : "false") + '">' +
        (deps.icon ? deps.icon(soundOn || item.vine ? "vol" : "volOff") : (soundOn ? tr("Mute") : tr("Unmute"))) + "</button>"
      : "";
    var open = https(item.open);
    var menu = '<div class="story-menu" hidden>' +
      (open ? '<a href="' + esc(open) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open on {platform}", { platform: platformName(account.platform) })) + "</a>" : "") +
      (item.mine ? '<button type="button" data-story-act="delete">' + esc(tr("Delete story")) + "</button>" : "") +
      ("<button type=\"button\" data-story-act=\"close\"" + ">" + tr("Close") + "<" + "/button></div>");
    node.innerHTML = '<div class="story-frame"><div class="story-top"><div class="story-bars">' + bars + '</div><div class="story-head">' +
      '<span class="story-mini"><span class="story-face">' + face(account) + "</span></span>" +
      '<span class="story-who"><b>' + esc(account.name || account.handle) + "</b><span>" + esc(ago(item.date)) + (item.vine ? " · Vine" : "") + "</span></span>" +
      sound +
      ("<button type=\"button\" class=\"story-icon\" data-story-act=\"menu\" " + "aria-label=\"" + tr("More") + "\"" + " aria-expanded=\"false\">") +
      (deps.icon ? deps.icon("more") : "···") + "</button></div></div>" +
      '<div class="story-stage">' + media + ("<p class=\"story-miss\" hidden" + ">" + tr("Couldn’t load this story.") + "<" + "/p></div>") +
      (item.caption ? '<p class="story-caption">' + esc(item.caption) + "</p>" : "") +
      socialBar(account, item) + menu + "</div>";
    node.hidden = false;
    node.setAttribute("aria-label", (account.name || tr("Story")) + " stories");
    document.documentElement.classList.add("stories-open");
    var video = node.querySelector("video");
    if (video) {
      video.muted = !soundOn;
      video.play().catch(function () { /* the unmute button stays available */ });
      video.addEventListener("loadedmetadata", playTimer);
      if (item.vine) {
        video.addEventListener("timeupdate", function () {
          if (video.currentTime >= 6) video.currentTime = 0;
        });
      }
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
    if (node.focus) node.focus();
  }

  function renderCompose() {
    var node = box();
    if (!node) return;
    stopTimer();
    pickedFile = null;
    node.innerHTML = '<div class="story-frame story-compose"><div class="story-head">' +
      '<button type="button" class="story-icon" data-story-act="cancel-compose" aria-label="' + esc(tr("Close")) + '">' +
      (deps.icon ? deps.icon("close") : esc(tr("Close"))) + "</button>" +
      "<b>" + esc(tr("Add a story")) + "</b></div>" +
      '<label class="story-file">' + esc(tr("Choose a photo or video")) +
      '<input class="story-file-input" type="file" accept="image/*,video/*"></label>' +
      '<p class="story-file-name" aria-live="polite"></p>' +
      '<label class="story-vine"><input class="story-vine-input" type="checkbox"> ' + esc(tr("Vine, 6 seconds")) + "</label>" +
      '<input class="story-caption-input" maxlength="140" placeholder="' + esc(tr("Caption")) + '" aria-label="' + esc(tr("Caption")) + '">' +
      '<button type="button" class="story-post" data-story-act="post">' + esc(tr("Post story")) + "</button>" +
      '<p class="story-miss" hidden>' + esc(tr("Couldn’t post this story.")) + "</p></div>";
    node.hidden = false;
    document.documentElement.classList.add("stories-open");
    var input = node.querySelector(".story-file-input");
    if (input) {
      input.addEventListener("change", function () {
        pickedFile = input.files && input.files[0] ? input.files[0] : null;
        var name = node.querySelector(".story-file-name");
        if (name) name.textContent = pickedFile ? pickedFile.name : "";
      });
    }
    if (node.focus) node.focus();
  }

  function renderConnect() {
    var node = box();
    if (!node) return;
    stopTimer();
    node.innerHTML = '<div class="story-frame story-setup"><div class="story-head">' +
      '<button type="button" class="story-icon" data-story-act="cancel-compose" aria-label="' + esc(tr("Close")) + '">' +
      (deps.icon ? deps.icon("close") : esc(tr("Close"))) + "</button>" +
      "<b>" + esc(tr("Connect Telegram")) + "</b></div>" +
      "<p>" + esc(tr("Telegram stories stay off until the session secret is added.")) + "</p>" +
      '<button type="button" data-story-act="cancel-compose">' + esc(tr("Close setup")) + "</button></div>";
    node.hidden = false;
    document.documentElement.classList.add("stories-open");
    if (node.focus) node.focus();
  }

  function show(accountAt, itemAt) {
    var list = rows();
    if (!list.length) {
      close();
      return;
    }
    if (!view || view.compose || view.connect) view = { list: list };
    view.compose = false;
    view.connect = false;
    view.list = list;
    view.account = Math.max(0, Math.min(accountAt, list.length - 1));
    var items = view.list[view.account].items;
    view.index = Math.max(0, Math.min(itemAt, items.length - 1));
    renderViewer();
  }

  function open(id) {
    var list = rows();
    var at = 0;
    var found = false;
    list.forEach(function (account, index) {
      if (account.id === id) { at = index; found = true; }
    });
    if (!found || !list.length || !list[at].items || !list[at].items.length) return;
    view = { list: list, account: at, index: 0, elapsed: 0, paused: false };
    show(at, 0);
  }

  function close() {
    stopTimer();
    view = null;
    pointer = null;
    pickedFile = null;
    var node = box();
    if (node) {
      node.hidden = true;
      node.innerHTML = "";
    }
    if (typeof document !== "undefined") document.documentElement.classList.remove("stories-open");
    if (deps.render) deps.render();
  }

  function advance(step) {
    if (!view || view.compose || view.connect) return;
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
    if (!view || view.compose || view.connect) return;
    var neighbor = view.account + step;
    if (neighbor < 0 || neighbor >= view.list.length) {
      if (step > 0) close();
      return;
    }
    view.account = neighbor;
    view.index = 0;
    renderViewer();
  }

  function apiRoot() {
    if (!deps.apiRoot) return "";
    try { return String(deps.apiRoot() || "").replace(/\/$/, ""); } catch (err) { return ""; }
  }

  function submitCompose() {
    var node = box();
    var miss = node && node.querySelector(".story-miss");
    if (!pickedFile || !apiRoot() || !token()) {
      if (miss) miss.hidden = false;
      return;
    }
    var vine = node.querySelector(".story-vine-input");
    var caption = node.querySelector(".story-caption-input");
    var body = new FormData();
    body.append("file", pickedFile);
    body.append("vine", vine && vine.checked ? "1" : "0");
    body.append("caption", caption ? caption.value : "");
    fetch(apiRoot() + "/v1/stories", {
      method: "POST",
      headers: { Authorization: "Bearer " + token() },
      body: body
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        data = data || {};
        data.status = res.status;
        return data;
      });
    }).then(function (data) {
      if (!data || data.status !== 201) {
        if (miss) miss.hidden = false;
        return;
      }
      if (deps.toast) deps.toast(tr("Story posted"));
      close();
      load();
    }).catch(function () {
      if (miss) miss.hidden = false;
    });
  }

  function storyApi(path, opts) {
    var auth = token();
    if (!auth || !deps.api) return Promise.resolve(null);
    opts = opts || {};
    opts.token = auth;
    return deps.api(path, opts);
  }

  function fillViews(panel, data) {
    if (!panel) return;
    var views = (data && data.views) || [];
    var replies = (data && data.replies) || [];
    var html = views.length
      ? views.map(function (row) { return "<p>" + esc(row.name || row.handle || "") + "</p>"; }).join("")
      : "<p>" + esc(tr("No views yet")) + "</p>";
    if (replies.length) {
      html += replies.map(function (row) {
        return "<p>" + esc((row.name || "") + " " + (row.text || "")) + "</p>";
      }).join("");
    }
    panel.innerHTML = html;
    panel.hidden = false;
  }

  function onKey(event) {
    if (!view) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (view.compose || view.connect) return;
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
    if (!view || view.compose || view.connect || !box() || !box().contains(event.target)) return;
    var menu = box().querySelector(".story-menu");
    if (menu && !menu.hidden && !event.target.closest(".story-menu")) {
      menu.hidden = true;
      var more = box().querySelector("[data-story-act='menu']");
      if (more) more.setAttribute("aria-expanded", "false");
      resume();
      return;
    }
    if (event.target.closest("button, a, .story-menu, .story-social, input")) return;
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

  function onShellDown(event) {
    if (!event.target.closest || !event.target.closest(".story-shell")) return;
    if (event.target.closest("#stories")) return;
    shellPointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function onShellUp(event) {
    if (!shellPointer || shellPointer.id !== event.pointerId) return;
    var dx = event.clientX - shellPointer.x;
    var dy = event.clientY - shellPointer.y;
    shellPointer = null;
    if (Math.abs(dx) > Math.abs(dy)) return;
    if (dy <= -48) { suppressClick = true; cycleBar(-1); }
    else if (dy >= 48) { suppressClick = true; cycleBar(1); }
  }

  function onClick(event) {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    var act = event.target.closest && event.target.closest("[data-story-act]");
    if (!act) return;
    var name = act.getAttribute("data-story-act");
    if (name === "fold") { event.preventDefault(); event.stopPropagation(); cycleBar(-1); return; }
    if (name === "expand") { event.preventDefault(); event.stopPropagation(); applyBar("expanded"); return; }
    if (name === "add") {
      event.preventDefault();
      event.stopPropagation();
      view = { compose: true };
      renderCompose();
      return;
    }
    if (name === "connect") {
      event.preventDefault();
      event.stopPropagation();
      view = { connect: true };
      renderConnect();
      return;
    }
    if (name === "post") { event.preventDefault(); event.stopPropagation(); submitCompose(); return; }
    if (name === "cancel-compose") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!view || !box() || view.compose || view.connect) return;
    if (!box().contains(act)) return;
    if (act.tagName !== "A") event.preventDefault();
    event.stopPropagation();
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
    } else if (name === "delete") {
      var confirm = box().querySelector(".story-confirm");
      if (confirm) confirm.hidden = false;
      pause(false);
    } else if (name === "delete-no") {
      var confirmNo = box().querySelector(".story-confirm");
      if (confirmNo) confirmNo.hidden = true;
      resume();
    } else if (name === "delete-yes") {
      var row = current();
      if (!row || !row.item) return;
      storyApi("/v1/stories/" + encodeURIComponent(row.item.id), { method: "DELETE" }).then(function (body) {
        if (body && body.status === 200) {
          close();
          load();
        } else if (deps.toast) deps.toast(tr("Couldn’t delete this story."));
      });
    } else if (name === "views") {
      var rowViews = current();
      if (!rowViews || !rowViews.item) return;
      storyApi("/v1/stories/" + encodeURIComponent(rowViews.item.id) + "/views").then(function (body) {
        fillViews(box() && box().querySelector(".story-views"), body);
      });
      pause(false);
    } else if (name === "react") {
      var rowReact = current();
      if (!rowReact || !rowReact.item) return;
      storyApi("/v1/stories/" + encodeURIComponent(rowReact.item.id) + "/react", { method: "POST", body: { emoji: act.getAttribute("data-emoji") || "" } });
    } else if (name === "reply") {
      var form = act.closest("form");
      var rowReply = current();
      var input = form && form.querySelector(".story-reply-text");
      var text = input ? input.value.trim() : "";
      if (!rowReply || !rowReply.item || !text) return;
      storyApi("/v1/stories/" + encodeURIComponent(rowReply.item.id) + "/reply", { method: "POST", body: { text: text } }).then(function (body) {
        if (body && (body.status === 201 || body.status === 200)) {
          if (input) input.value = "";
          if (deps.toast) deps.toast(tr("Reply sent"));
        } else if (deps.toast) deps.toast(tr("Couldn’t send that reply."));
      });
    }
  }

  function mergeDocs(doc, extra) {
    var base = doc && typeof doc === "object" ? doc : { accounts: [] };
    var accounts = (base.accounts || []).filter(function (row) { return row && row.platform !== "app"; });
    if (extra && extra.accounts) {
      extra.accounts.forEach(function (row) {
        if (row && row.platform === "app") accounts.push(row);
      });
    }
    return {
      updated: base.updated || "",
      accounts: accounts,
      telegramConnected: !!(base.telegramConnected || (extra && extra.telegramConnected))
    };
  }

  function loadApp() {
    var auth = token();
    if (!auth || !deps.api) return Promise.resolve(null);
    return deps.api("/v1/stories", { token: auth }).then(function (body) {
      if (!body || body.status !== 200) return null;
      return body;
    }).catch(function () { return null; });
  }

  function apply(doc) {
    raw = doc && typeof doc === "object" ? doc : { accounts: [] };
    if (!raw.accounts) raw.accounts = [];
    raw.telegramConnected = !!raw.telegramConnected;
    loadedAt = Date.now();
    if (view && !view.compose && !view.connect) {
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
    return remote.then(function (doc) {
      return loadApp().then(function (extra) { apply(mergeDocs(doc, extra)); });
    }).catch(function () {
      return loadApp().then(function (extra) { apply(mergeDocs({ accounts: [] }, extra)); });
    });
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
    document.addEventListener("pointerdown", onShellDown, true);
    document.addEventListener("pointerup", onShellUp, true);
    document.addEventListener("visibilitychange", function () {
      if (!view) {
        if (document.visibilityState === "visible" && loadedAt && Date.now() - loadedAt > 10 * 60 * 1000) load();
        return;
      }
      if (view.compose || view.connect) return;
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
    barState: barState,
    applyBar: applyBar,
    activeAccounts: activeAccounts,
    orderedAccounts: orderedAccounts,
    itemKey: itemKey
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
