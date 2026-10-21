/* Thin 10-foot layer over the desktop layout.
   Remote: arrows, Enter/OK, Back (Escape, Backspace, 10009, 461),
   media play/seek, and the colour keys. */
(function () {
  var KEY = "superintelapp-settings-v1";
  var TV = {
    on: false,
    forced: "",
    settings: null,
    key: "",
    hash: "",
    zoom: 1.5,
    hideSide: false,
    attached: false,
    wantSearch: false,
    mediaTime: 0,
    playing: true,
    restoreTimer: 0
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) {
        raw = localStorage.getItem("rss-" + "feeds-settings-v1");
        if (raw) {
          try { localStorage.setItem(KEY, raw); } catch (err) {}
        }
      }
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function patchSettings(mutator) {
    var current = loadSettings();
    mutator(current);
    TV.settings = current;
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (err) { /* private mode */ }
  }

  function queryFlag() {
    var blob = String(location.search || "") + "&" + String(location.hash || "");
    if (/[?&]tv=0(?:&|#|$)/.test(blob)) return "off";
    if (/[?&]tv=1(?:&|#|$)/.test(blob)) return "on";
    return "";
  }

  function stripQueryKey(qs, key) {
    var parts = String(qs || "").split("&");
    var keep = [];
    var i;
    for (i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i].split("=")[0] === key) continue;
      keep.push(parts[i]);
    }
    return keep.join("&");
  }

  function stripTvParam() {
    var search = String(location.search || "");
    var hash = String(location.hash || "");
    var nextSearch = search;
    var nextHash = hash;
    if (search.indexOf("tv=") >= 0) {
      var bare = stripQueryKey(search.charAt(0) === "?" ? search.slice(1) : search, "tv");
      nextSearch = bare ? "?" + bare : "";
    }
    var qAt = hash.indexOf("?");
    if (qAt >= 0 && hash.indexOf("tv=") >= 0) {
      var rest = stripQueryKey(hash.slice(qAt + 1), "tv");
      nextHash = hash.slice(0, qAt) + (rest ? "?" + rest : "");
    }
    if (nextSearch === search && nextHash === hash) return;
    try { history.replaceState(null, "", location.pathname + nextSearch + nextHash); } catch (err) { /* older webview */ }
  }

  function isTvUa() {
    var ua = String(navigator.userAgent || "");
    return /Tizen|Web0S|webOS|SMART-TV|SmartTV|Smart-TV|BRAVIA|Bravia|CrKey|AFT[A-Z0-9]|Android TV|GoogleTV|HbbTV|Viera|NetCast|TV Bro|Fire TV|FireTV|AppleTV|Apple TV|Roku|VIDAA|Hisense|SmartHub|LivingRoom|Maple/i.test(ua);
  }

  function coarseLarge() {
    var w = window.innerWidth || 0;
    var h = window.innerHeight || 0;
    if (w < 960 || h < 520) return false;
    var touch = (navigator.maxTouchPoints || 0) > 0;
    var fine = false;
    try { fine = window.matchMedia("(pointer: fine)").matches; } catch (err) { fine = false; }
    return !touch && !fine;
  }

  function shouldEnable() {
    var flag = queryFlag();
    if (flag === "on" || flag === "off") TV.forced = flag;
    stripTvParam();
    if (TV.forced === "on") return true;
    if (TV.forced === "off") return false;
    var mode = (TV.settings && TV.settings.tvMode) || "auto";
    if (mode === "on") return true;
    if (mode === "off") return false;
    return isTvUa() || coarseLarge();
  }

  function settingsHtml() {
    var settings = TV.settings || loadSettings();
    var on = !!(TV.on || settings.tvMode === "on");
    return '<h2>Display</h2><div class="theme-row"><button class="outline' + (on ? " on" : "") + '" type="button" data-tv-toggle="1" aria-pressed="' + (on ? "true" : "false") + '">TV mode</button></div>';
  }

  function fit() {
    var w = window.innerWidth || 1280;
    var h = window.innerHeight || 720;
    var nav = w <= 1279 ? 88 : 275;
    var side = w <= 999 ? 0 : (w <= 1279 ? 320 : 350);
    var full = nav + 600 + side;
    var slim = nav + 600;
    var safe = w * 0.9;
    var hide = side > 0 && full * 1.5 > safe;
    var base = hide || !side ? slim : full;
    var zoom = safe / base;
    if (zoom > 2) zoom = 2;
    if (zoom < 1.15) zoom = 1.15;
    zoom = Math.round(zoom * 100) / 100;
    var pad = Math.round((h * 0.045) / zoom);
    return { zoom: zoom, hide: hide || !side, pad: pad };
  }

  function applyScale() {
    var box = fit();
    TV.zoom = box.zoom;
    TV.hideSide = box.hide;
    document.documentElement.style.setProperty("--tv-zoom", String(box.zoom));
    document.documentElement.style.setProperty("--tv-pad", box.pad + "px");
    document.documentElement.classList.toggle("tv-noside", box.hide);
  }

  function clearScale() {
    document.documentElement.style.removeProperty("--tv-zoom");
    document.documentElement.style.removeProperty("--tv-pad");
    document.documentElement.classList.remove("tv-noside");
    var added = document.querySelectorAll("[data-tv-tab]");
    var i;
    for (i = 0; i < added.length; i++) {
      added[i].removeAttribute("tabindex");
      added[i].removeAttribute("data-tv-tab");
    }
    var rings = document.querySelectorAll(".tv-focus");
    for (i = 0; i < rings.length; i++) rings[i].classList.remove("tv-focus");
  }

  function visible(el) {
    if (!el || el.disabled) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return false;
    if (el.closest && el.closest("[hidden], .vh, .skip")) return false;
    if (el.classList && (el.classList.contains("vh") || el.classList.contains("skip"))) return false;
    var st;
    try { st = window.getComputedStyle(el); } catch (err) { return false; }
    if (!st || st.display === "none" || st.visibility === "hidden") return false;
    var r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  }

  function list(nodes) {
    var out = [];
    var i;
    for (i = 0; i < nodes.length; i++) if (visible(nodes[i])) out.push(nodes[i]);
    return out;
  }

  function byX(a, b) {
    return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
  }

  function byY(a, b) {
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  }

  function cardOf(el) {
    return el && el.closest ? el.closest("article.post, article.status, article.ancestor") : null;
  }

  function cardItems(card) {
    var nodes = card.querySelectorAll(".name, .play, .action, .more-btn, .follow, .show-more, .show-thread, .show-replies, .tab");
    var items = [card];
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!visible(nodes[i])) continue;
      if (nodes[i] === card) continue;
      items.push(nodes[i]);
    }
    var head = items.slice(0, 1);
    var rest = items.slice(1);
    rest.sort(byX);
    return head.concat(rest);
  }

  function groupLoose(els) {
    var rows = [];
    var i;
    var sorted = els.slice().sort(byY);
    for (i = 0; i < sorted.length; i++) {
      var el = sorted[i];
      var top = el.getBoundingClientRect().top;
      var row = rows.length ? rows[rows.length - 1] : null;
      if (!row || Math.abs(top - row.top) > 36) rows.push({ top: top, items: [el] });
      else row.items.push(el);
    }
    for (i = 0; i < rows.length; i++) rows[i].items.sort(byX);
    return rows;
  }

  function mainStops() {
    var main = document.querySelector("main");
    if (!main) return [];
    var all = main.querySelectorAll("article.post, article.status, article.ancestor, a, button, input, textarea, select");
    var stops = [];
    var loose = [];
    var i;
    function flush() {
      var rows = groupLoose(loose);
      var r;
      for (r = 0; r < rows.length; r++) stops.push({ kind: "row", items: rows[r].items });
      loose = [];
    }
    for (i = 0; i < all.length; i++) {
      var el = all[i];
      if (!visible(el)) continue;
      var card = cardOf(el);
      if (card && el !== card) continue;
      if (el.matches && el.matches("article.post, article.status, article.ancestor")) {
        flush();
        stops.push({ kind: "card", items: cardItems(el) });
      } else if (!card) loose.push(el);
    }
    flush();
    return stops;
  }

  function columnItems(selector) {
    var root = document.querySelector(selector);
    if (!root || !visible(root) && selector === ".side") return [];
    if (!root) return [];
    var nodes = root.querySelectorAll("a, button, input, textarea, select");
    return list(nodes).sort(byY);
  }

  function navItems() {
    return columnItems(".nav");
  }

  function sideItems() {
    if (TV.hideSide) return [];
    return columnItems(".side");
  }

  function overlayRoot() {
    var viewer = document.getElementById("viewer");
    if (viewer && !viewer.hidden) return viewer;
    var sheet = document.querySelector(".modal-back, .drawer-back, .share-back, .tab-sheet, .bell-sheet");
    if (sheet) return sheet.querySelector(".modal, .drawer, .share-pop, .tab-menu") || sheet;
    var menu = document.querySelector(".post .menu, article .menu");
    if (menu && visible(menu)) return menu;
    return null;
  }

  function current() {
    var el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement) return el;
    return document.querySelector(".tv-focus");
  }

  function remember(el) {
    if (!el) return;
    var label = (el.getAttribute && (el.getAttribute("aria-label") || "")) || "";
    var act = (el.getAttribute && el.getAttribute("data-act")) || "";
    var tab = (el.getAttribute && el.getAttribute("data-tab")) || "";
    var text = "";
    try { text = String(el.innerText || "").replace(/\s+/g, " ").slice(0, 40); } catch (err) { text = ""; }
    if (el.classList && el.classList.contains("nav-item")) {
      TV.key = "nav:" + (el.getAttribute("href") || "");
      return;
    }
    var card = cardOf(el);
    var id = card ? (card.getAttribute("data-post") || (card.classList.contains("status") ? "status" : "")) : "";
    var dataId = (el.getAttribute && el.getAttribute("data-id")) || "";
    if (card && el === card) TV.key = "card:" + id;
    else if (card) TV.key = "in:" + (dataId || id) + ":" + act + ":" + label;
    else if (el.id) TV.key = "id:" + el.id;
    else TV.key = "act:" + act + ":" + label + ":" + tab + ":" + ((el.getAttribute && (el.getAttribute("data-theme") || el.getAttribute("data-mode"))) || text);
  }

  function sameKey(el, key) {
    var prev = TV.key;
    remember(el);
    var now = TV.key;
    TV.key = prev;
    return now === key;
  }

  function findKey(key) {
    if (!key) return null;
    var nodes = document.querySelectorAll("#app a, #app button, #app input, #app textarea, #app select, #app article, #viewer button, #viewer video");
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!visible(nodes[i]) && nodes[i].tagName !== "ARTICLE") continue;
      if (sameKey(nodes[i], key)) return nodes[i];
    }
    return null;
  }

  function paint(el) {
    var prev = document.querySelectorAll(".tv-focus");
    var i;
    for (i = 0; i < prev.length; i++) if (prev[i] !== el) prev[i].classList.remove("tv-focus");
    if (el && el.classList) el.classList.add("tv-focus");
  }

  function ensureFocusable(el) {
    var tag = el.tagName;
    if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (el.getAttribute("tabindex") == null) {
      el.setAttribute("tabindex", "-1");
      el.setAttribute("data-tv-tab", "1");
    }
  }

  function centerEl(el) {
    var card = cardOf(el);
    var target = card || el;
    if (!target || !target.getBoundingClientRect) return;
    var rect = target.getBoundingClientRect();
    if (rect.height > window.innerHeight * 0.82) rect = el.getBoundingClientRect();
    var delta = rect.top + rect.height / 2 - window.innerHeight / 2;
    if (Math.abs(delta) < 12) return;
    var zoom = TV.zoom || 1;
    var top = delta / zoom;
    try { window.scrollBy({ top: top, left: 0, behavior: "smooth" }); }
    catch (err) { window.scrollBy(0, top); }
  }

  function setFocus(el, center) {
    if (!el) return;
    ensureFocusable(el);
    remember(el);
    try { el.focus({ preventScroll: true }); }
    catch (err) {
      try { el.focus(); } catch (err2) { /* not focusable */ }
    }
    paint(el);
    if (center) centerEl(el);
  }

  function entryFocus() {
    var search = document.getElementById("explore-q") || document.getElementById("add-account");
    if (search && visible(search)) return search;
    var tab = document.querySelector(".tabs .tab.on") || document.querySelector(".tabs .tab");
    if (tab && visible(tab)) return tab;
    var card = document.querySelector("main article.status, main article.post");
    if (card && visible(card)) return card;
    var stops = mainStops();
    if (stops.length && stops[0].items.length) return stops[0].items[0];
    var nav = navItems();
    return nav.length ? nav[0] : null;
  }

  function locate(el) {
    var nav = navItems();
    var side = sideItems();
    var stops = mainStops();
    var s;
    var i;
    for (i = 0; i < nav.length; i++) if (nav[i] === el) return { where: "nav", items: nav, index: i };
    for (i = 0; i < side.length; i++) if (side[i] === el) return { where: "side", items: side, index: i };
    for (s = 0; s < stops.length; s++) {
      for (i = 0; i < stops[s].items.length; i++) {
        if (stops[s].items[i] === el) return { where: "main", stops: stops, stop: s, index: i };
      }
    }
    var card = cardOf(el);
    if (card) {
      for (s = 0; s < stops.length; s++) {
        if (stops[s].kind === "card" && stops[s].items[0] === card) {
          for (i = 0; i < stops[s].items.length; i++) if (stops[s].items[i] === el || stops[s].items[i] === card) {
            return { where: "main", stops: stops, stop: s, index: el === card ? 0 : i };
          }
        }
      }
    }
    return { where: "main", stops: stops, stop: 0, index: 0 };
  }

  function moveMain(dir, place) {
    var stops = place.stops || mainStops();
    if (!stops.length) {
      if (dir === "ArrowLeft") focusNav();
      return;
    }
    var stopAt = place.stop || 0;
    var index = place.index || 0;
    if (stopAt < 0) stopAt = 0;
    if (stopAt >= stops.length) stopAt = stops.length - 1;
    var items = stops[stopAt].items;
    if (dir === "ArrowLeft") {
      if (index > 0) setFocus(items[index - 1], false);
      else focusNav();
      return;
    }
    if (dir === "ArrowRight") {
      if (index < items.length - 1) setFocus(items[index + 1], false);
      else {
        var side = sideItems();
        if (side.length) setFocus(side[0], false);
      }
      return;
    }
    var next = stopAt + (dir === "ArrowDown" ? 1 : -1);
    if (next < 0) return;
    if (next >= stops.length) return;
    var target = stops[next].items[Math.min(index, stops[next].items.length - 1)];
    setFocus(target, stops[next].kind === "card" || stops[stopAt].kind === "card");
  }

  function focusNav() {
    var on = document.querySelector(".nav .nav-item.on") || document.querySelector(".nav .nav-item");
    if (on) setFocus(on, false);
  }

  function move(dir) {
    var over = overlayRoot();
    if (over) {
      var inside = list(over.querySelectorAll("a, button, input, textarea, select"));
      if (!inside.length) return;
      var el = current();
      var at = inside.indexOf ? inside.indexOf(el) : -1;
      var n;
      if (at < 0) {
        for (n = 0; n < inside.length; n++) if (inside[n] === el) at = n;
      }
      if (dir === "ArrowDown" || dir === "ArrowRight") setFocus(inside[Math.min(inside.length - 1, (at < 0 ? 0 : at + 1))], false);
      else setFocus(inside[Math.max(0, (at < 0 ? 0 : at - 1))], false);
      return;
    }
    var el = current();
    var place = locate(el);
    if (place.where === "nav") {
      var nav = place.items;
      if (dir === "ArrowUp" && place.index > 0) setFocus(nav[place.index - 1], false);
      else if (dir === "ArrowDown" && place.index < nav.length - 1) setFocus(nav[place.index + 1], false);
      else if (dir === "ArrowRight") {
        var entry = entryFocus();
        if (entry) setFocus(entry, !!(cardOf(entry) && entry.tagName === "ARTICLE"));
      }
      return;
    }
    if (place.where === "side") {
      var side = place.items;
      if (dir === "ArrowUp" && place.index > 0) setFocus(side[place.index - 1], false);
      else if (dir === "ArrowDown" && place.index < side.length - 1) setFocus(side[place.index + 1], false);
      else if (dir === "ArrowLeft") {
        var back = findKey(TV.key) || entryFocus();
        if (back && back.closest && back.closest(".side")) back = entryFocus();
        if (back) setFocus(back, false);
        else focusNav();
      }
      return;
    }
    moveMain(dir, place);
  }

  function clickEl(el) {
    if (!el) return;
    try { el.click(); } catch (err) { /* synthetic click can fail on text nodes */ }
  }

  function focusedCard() {
    var el = current();
    return cardOf(el) || document.querySelector("main article.post, main article.status");
  }

  function clickAction(selector) {
    var card = focusedCard();
    var btn = card ? card.querySelector(selector) : null;
    if (!btn) btn = document.querySelector(selector);
    if (btn) clickEl(btn);
  }

  function mediaNode() {
    var viewer = document.querySelector("#viewer:not([hidden]) video, #viewer:not([hidden]) iframe");
    if (viewer) return viewer;
    var el = current();
    var host = el && el.closest ? el.closest(".vplay, .player, article") : null;
    if (host) {
      var local = host.querySelector("video, iframe");
      if (local) return local;
    }
    return document.querySelector(".player video, .player iframe, .vplay video, .vplay iframe");
  }

  function ytFrame(node) {
    return node && node.tagName === "IFRAME" && String(node.src || "").indexOf("youtube-nocookie.com/embed/") >= 0;
  }

  function ytCmd(frame, func, args) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func: func,
        args: args || [],
        id: 1,
        channel: "widget"
      }), "*");
    } catch (err) { /* the embed can ignore the command */ }
  }

  function toggleMedia() {
    var node = mediaNode();
    if (!node) return;
    if (node.tagName === "VIDEO") {
      if (node.paused) {
        var play = node.play();
        if (play && play.catch) play.catch(function () {});
      } else node.pause();
      return;
    }
    if (ytFrame(node)) {
      TV.playing = !TV.playing;
      ytCmd(node, TV.playing ? "playVideo" : "pauseVideo", []);
    }
  }

  function seekMedia(delta) {
    var node = mediaNode();
    if (!node) return;
    if (node.tagName === "VIDEO") {
      var next = (node.currentTime || 0) + delta;
      if (next < 0) next = 0;
      if (node.duration && isFinite(node.duration) && next > node.duration) next = node.duration;
      try { node.currentTime = next; } catch (err) { /* not seekable yet */ }
      TV.mediaTime = next;
      return;
    }
    if (ytFrame(node)) {
      TV.mediaTime = Math.max(0, (TV.mediaTime || 0) + delta);
      ytCmd(node, "seekTo", [TV.mediaTime, true]);
    }
  }

  function toggleMute() {
    var node = mediaNode();
    if (node && node.tagName === "VIDEO") {
      node.muted = !node.muted;
      return;
    }
    var btn = document.querySelector(".vmute");
    if (btn) clickEl(btn);
    else if (ytFrame(node)) ytCmd(node, "mute", []);
  }

  function atHome() {
    var hash = (location.hash || "#/").split("?")[0];
    return hash === "#/" || hash === "#/home" || hash === "";
  }

  function closeOverlay() {
    var closer = document.querySelector(".tab-sheet [data-act='close-tab-menu'], .modal [data-act='close-modal'], .drawer [data-act='close-drawer'], .share-back [data-act='close-share'], #viewer [data-act='close-viewer']");
    if (closer && overlayRoot()) {
      clickEl(closer);
      return;
    }
    TV.ignore = true;
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    } catch (err) { /* older webview */ }
    TV.ignore = false;
  }

  function goBack() {
    if (overlayRoot()) {
      closeOverlay();
      return;
    }
    if (atHome()) return;
    if (history.length > 1) history.back();
    else location.hash = "#/";
  }

  function typing(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
  }

  function caretAt(el, dir) {
    if (!el || el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return false;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    if (start == null) return false;
    if (dir === "ArrowLeft") return start === 0 && end === 0;
    if (dir === "ArrowRight") return start === el.value.length && end === el.value.length;
    return false;
  }

  function isBack(event) {
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    if (key === "Escape" || key === "BrowserBack" || key === "XF86Back" || key === "GoBack" || key === "Back") return true;
    if (code === 10009 || code === 461) return true;
    if (key === "Backspace" && !typing(current())) return true;
    return false;
  }

  function isPlay(event) {
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    return key === "MediaPlayPause" || key === "MediaPlay" || key === "MediaPause" || code === 179 || code === 415 || code === 19;
  }

  function onKeyDown(event) {
    if (!TV.on || TV.ignore) return;
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    if (isBack(event)) {
      if (atHome() && !overlayRoot()) return;
      event.preventDefault();
      event.stopPropagation();
      goBack();
      return;
    }
    if (isPlay(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleMedia();
      return;
    }
    if (key === "MediaFastForward" || code === 417) {
      event.preventDefault();
      event.stopPropagation();
      seekMedia(10);
      return;
    }
    if (key === "MediaRewind" || code === 412) {
      event.preventDefault();
      event.stopPropagation();
      seekMedia(-10);
      return;
    }
    if (code === 403 || key === "ColorF0Red") {
      event.preventDefault();
      event.stopPropagation();
      clickAction(".action.like");
      return;
    }
    if (code === 404 || key === "ColorF1Green") {
      event.preventDefault();
      event.stopPropagation();
      clickAction(".action.bookmark");
      return;
    }
    if (code === 405 || key === "ColorF2Yellow") {
      event.preventDefault();
      event.stopPropagation();
      TV.wantSearch = true;
      location.hash = "#/explore";
      return;
    }
    if (code === 406 || key === "ColorF3Blue") {
      event.preventDefault();
      event.stopPropagation();
      toggleMute();
      return;
    }
    if (typing(current())) {
      if ((key === "ArrowLeft" || key === "ArrowRight") && !caretAt(current(), key)) return;
      if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        move(key);
      }
      return;
    }
    if (key === " " ) {
      event.preventDefault();
      event.stopPropagation();
      toggleMedia();
      return;
    }
    if (key === "Enter" || key === "NumpadEnter" || key === "Accept" || code === 13) {
      if (event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      clickEl(current());
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      move(key);
    }
  }

  function onClick(event) {
    var toggle = event.target && event.target.closest && event.target.closest("[data-tv-toggle]");
    if (!toggle) return;
    event.preventDefault();
    event.stopPropagation();
    setTvMode(TV.on ? "off" : "on");
  }

  function setTvMode(mode) {
    TV.forced = mode === "on" ? "on" : "off";
    patchSettings(function (s) { s.tvMode = mode; });
    applyMode();
  }

  function scheduleRestore() {
    clearTimeout(TV.restoreTimer);
    TV.restoreTimer = setTimeout(restore, 60);
  }

  function restore() {
    if (!TV.on) return;
    var hash = location.hash || "#/";
    if (hash !== TV.hash) {
      TV.hash = hash;
      if (!TV.wantSearch) TV.key = "";
    }
    var over = overlayRoot();
    if (over) {
      var inside = current();
      if (!inside || !over.contains(inside)) {
        var first = list(over.querySelectorAll("a, button, input, textarea, select"))[0];
        if (first) setFocus(first, false);
      }
      document.documentElement.setAttribute("data-tv-ready", "1");
      return;
    }
    if (TV.wantSearch) {
      TV.wantSearch = false;
      var box = document.getElementById("explore-q");
      if (box) {
        setFocus(box, false);
        document.documentElement.setAttribute("data-tv-ready", "1");
        return;
      }
    }
    var again = findKey(TV.key);
    if (again) {
      setFocus(again, false);
      document.documentElement.setAttribute("data-tv-ready", "1");
      return;
    }
    var entry = entryFocus();
    if (entry) setFocus(entry, false);
    if (document.querySelector("main article.post, main .tab, main .empty, main h1")) {
      document.documentElement.setAttribute("data-tv-ready", "1");
    }
  }

  function enter() {
    if (TV.on) {
      applyScale();
      return;
    }
    TV.on = true;
    document.documentElement.classList.add("tv-on");
    applyScale();
    TV.hash = location.hash || "#/";
    scheduleRestore();
  }

  function exit() {
    if (!TV.on && !document.documentElement.classList.contains("tv-on")) return;
    TV.on = false;
    document.documentElement.classList.remove("tv-on");
    document.documentElement.removeAttribute("data-tv-ready");
    clearScale();
  }

  function applyMode() {
    TV.settings = loadSettings();
    if (shouldEnable()) enter();
    else exit();
  }

  function onFocusIn(event) {
    if (!TV.on || !event.target || !event.target.classList) return;
    if (event.target.closest && !event.target.closest("#app, #viewer")) return;
    remember(event.target);
    paint(event.target);
  }

  function attach() {
    if (TV.attached) {
      applyMode();
      return;
    }
    TV.attached = true;
    TV.settings = loadSettings();
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("resize", function () { if (TV.on) applyScale(); });
    window.addEventListener("hashchange", function () {
      var flag = queryFlag();
      if (flag === "on" || flag === "off") TV.forced = flag;
      stripTvParam();
      if (TV.on) document.documentElement.setAttribute("data-tv-ready", "0");
      if (flag === "on" && !TV.on) enter();
      else if (flag === "off" && TV.on) exit();
      else if (TV.on) scheduleRestore();
    });
    var root = document.getElementById("app");
    if (root && window.MutationObserver) {
      var obs = new MutationObserver(function () { if (TV.on) scheduleRestore(); });
      obs.observe(root, { childList: true, subtree: true });
    }
    applyMode();
  }

  window.FeedsTV = {
    settingsHtml: settingsHtml,
    attach: attach,
    enabled: function () { return TV.on; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
})();
