/* Games. The iframe is created only on a play page and stays outside the
   shell so a repaint does not reload it. Play time stays in this browser. */
(function () {
  var STORE = "viktorychapp-games-v1";
  var PLAY = "https://nzlay.com/ReGone/game/index.html";
  var ORIGINAL = "https://nzlay.com/pages/ReGone";
  var CREDIT = "ReGone · via NZlay";
  var BACK = "M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z";
  var HEART = "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z";
  var HEART_ON = "M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z";
  var FULL = "M4 9V4h5v2H6v3H4zm10-5h5v5h-2V6h-3V4zM6 15H4v5h5v-2H6v-3zm12 0h2v5h-5v-2h3v-3z";
  var PAD = "M8 8.5h8c1.9 0 3.5 1.3 3.9 3.1l.7 3.6c.2 1.1-.6 2.1-1.7 2.1-.5 0-1-.2-1.3-.6L16.4 15H7.6l-1.2 1.7c-.3.4-.8.6-1.3.6-1.1 0-1.9-1-1.7-2.1l.7-3.6C4.5 9.8 6.1 8.5 8 8.5zm.2 1.7c-1.1 0-2 .8-2.2 1.8l-.7 3.6c-.1.4.2.7.6.7.2 0 .3-.1.4-.2l1.3-1.6h7.8l1.3 1.6c.1.1.2.2.4.2.4 0 .7-.3.6-.7l-.7-3.6c-.2-1-1.1-1.8-2.2-1.8H8.2zM9 11.6h1.1v1.1h1.1v1.1H10.1v1.1H9v-1.1H7.9v-1.1H9v-1.1zm5.6.9a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7zm1.7-.9a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7z";
  var GAMES = [{
    id: "regone",
    name: "ReGone",
    play: PLAY,
    original: ORIGINAL
  }];
  var clock = 0;
  var clockAt = 0;
  var clockId = "";
  var failTimer = 0;

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }
  function gameById(id) {
    for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
    return null;
  }
  function readAll() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORE) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }
  function writeAll(data) {
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (err) { /* this device is full */ }
  }
  function stat(id) {
    var row = readAll()[id] || {};
    return { ms: Number(row.ms) || 0, last: Number(row.last) || 0, fav: !!row.fav };
  }
  function patch(id, next) {
    var all = readAll();
    var row = all[id] || {};
    if (next.ms != null) row.ms = next.ms;
    if (next.last != null) row.last = next.last;
    if (next.fav != null) row.fav = !!next.fav;
    all[id] = row;
    writeAll(all);
    return row;
  }
  function flush() {
    if (!clockId || !clockAt || document.hidden) {
      clockAt = Date.now();
      return;
    }
    var now = Date.now();
    var row = stat(clockId);
    patch(clockId, { ms: row.ms + Math.max(0, now - clockAt), last: row.last || now });
    clockAt = now;
  }
  function startClock(id) {
    clockId = id;
    clockAt = Date.now();
    if (clock) return;
    clock = setInterval(flush, 5000);
  }
  function stopClock() {
    flush();
    if (clock) clearInterval(clock);
    clock = 0;
    clockId = "";
    clockAt = 0;
  }
  function duration(ms) {
    var min = Math.floor((Number(ms) || 0) / 60000);
    if (min < 1) return "";
    var hours = Math.floor(min / 60);
    var rest = min % 60;
    if (!hours) return rest + tr("time.m");
    return hours + tr("time.h") + " " + rest + tr("time.m");
  }
  function when(ms) {
    if (!ms || !window.SI18n || !window.SI18n.relTime) return "";
    return window.SI18n.relTime(new Date(ms).toISOString());
  }
  function appName() {
    return window.SI18n && window.SI18n.productName ? window.SI18n.productName("app") : "ViktorychApp";
  }
  function shareText() {
    var path = location.pathname || "/";
    if (/\/index\.html$/i.test(path)) path = path.slice(0, -"index.html".length);
    if (!path.endsWith("/")) path += "/";
    return tr("Playing ReGone on {app}", { app: appName() }) + "\n" + location.origin + path + "#/games/regone";
  }
  function head(title, backHref) {
    var back = backHref ? '<a class="icon-btn" href="' + esc(backHref) + '" aria-label="' + esc(tr("Back")) + '">' + svg(BACK) + "</a>" : "";
    return '<div class="topbar tall"><div class="mhead"><button class="m-ava" type="button" data-act="drawer" aria-label="' + esc(tr("Menu")) + '"><span class="ava initials">Y</span></button></div><div class="page-head">' + back + '<div class="head-text grow"><h1>' + esc(title) + "</h1></div></div></div>";
  }
  function heartBtn(id, on) {
    return '<button class="game-heart' + (on ? " on" : "") + '" type="button" data-game-fav="' + esc(id) + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(on ? tr("Remove from favorites") : tr("Favorite")) + '">' + svg(on ? HEART_ON : HEART) + "</button>";
  }
  function card(item) {
    var row = stat(item.id);
    var played = duration(row.ms);
    var seen = when(row.last);
    var meta = [tr("Web shooter"), seen, played].filter(Boolean).join(" · ");
    return '<article class="game-card"><a class="game-open" href="#/games/' + esc(item.id) + '"><span class="game-art">' + svg(PAD) + '</span><span class="game-copy"><span class="game-name">' + esc(item.name) + '</span><span class="game-meta">' + esc(meta) + '</span></span></a>' + heartBtn(item.id, row.fav) + '</article>';
  }
  function rail(title, items, empty) {
    var body = items.length ? '<div class="games-row">' + items.map(card).join("") + "</div>" : '<p class="games-empty">' + esc(empty) + "</p>";
    return '<section class="games-rail"><h2>' + esc(title) + "</h2>" + body + "</section>";
  }
  function hub() {
    var recent = GAMES.filter(function (item) { return stat(item.id).last > 0; }).sort(function (a, b) { return stat(b.id).last - stat(a.id).last; });
    var favs = GAMES.filter(function (item) { return stat(item.id).fav; });
    return rail(tr("Recently played"), recent, tr("Nothing played yet.")) +
      rail(tr("Favourites"), favs, tr("No favourites yet.")) +
      '<section class="games-rail"><h2>' + esc(tr("Games")) + '</h2><div class="games-grid">' + GAMES.map(card).join("") + "</div></section>";
  }
  function page(route) {
    if (route && route.game) {
      var item = gameById(route.game);
      if (!item) return head(tr("Games"), "#/games") + '<div class="empty"><h2>' + esc(tr("That game isn’t here.")) + "</h2></div>";
      return head(item.name, "#/games") + '<div class="game-stage"></div>';
    }
    return head(tr("Games")) + '<div class="games">' + hub() + "</div>";
  }
  function hostEl() {
    return document.getElementById("game-host");
  }
  function paintChrome() {
    var host = hostEl();
    if (!host) return;
    var on = stat("regone").fav;
    var fav = host.querySelector("[data-game-fav]");
    if (fav) {
      fav.classList.toggle("on", on);
      fav.setAttribute("aria-pressed", on ? "true" : "false");
      fav.setAttribute("aria-label", on ? tr("Remove from favorites") : tr("Favorite"));
      fav.innerHTML = svg(on ? HEART_ON : HEART);
    }
    var full = host.querySelector("[data-game-full]");
    if (full) {
      var open = document.fullscreenElement === host;
      full.setAttribute("aria-label", open ? tr("Exit full screen") : tr("Full screen"));
    }
  }
  function place() {
    var host = hostEl();
    var stage = document.querySelector(".game-stage");
    if (!host || host.hidden) return;
    if (document.fullscreenElement === host) return;
    if (!stage) return;
    var rect = stage.getBoundingClientRect();
    host.style.top = Math.round(rect.top) + "px";
    host.style.left = Math.round(rect.left) + "px";
    host.style.width = Math.max(0, Math.round(rect.width)) + "px";
    host.style.height = Math.max(0, Math.round(rect.height)) + "px";
  }
  function fail() {
    var host = hostEl();
    if (!host || host.classList.contains("is-loaded")) return;
    host.classList.add("is-failed");
  }
  function ensureFrame(host) {
    var slot = host.querySelector(".game-frame");
    if (!slot || slot.querySelector("iframe")) return;
    host.classList.remove("is-loaded", "is-failed");
    var frame = document.createElement("iframe");
    frame.title = "ReGone";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
    frame.setAttribute("allow", "fullscreen; autoplay; gamepad");
    frame.addEventListener("load", function () {
      if (failTimer) clearTimeout(failTimer);
      failTimer = 0;
      host.classList.add("is-loaded");
      host.classList.remove("is-failed");
    });
    frame.addEventListener("error", fail);
    slot.appendChild(frame);
    frame.src = PLAY;
    if (failTimer) clearTimeout(failTimer);
    failTimer = setTimeout(fail, 20000);
  }
  function ensureHost() {
    var host = hostEl();
    if (!host || host.dataset.ready === "1") return host;
    host.dataset.ready = "1";
    host.innerHTML = '<div class="game-bar"><a class="game-back" href="#/games" aria-label="' + esc(tr("Back")) + '">' + svg(BACK) + '</a><span class="game-grow"></span><button class="game-tool" type="button" data-game-fav="regone" aria-pressed="false" aria-label="' + esc(tr("Favorite")) + '">' + svg(HEART) + '</button><button class="outline game-share" type="button" data-act="game-share">' + esc(tr("Share to feed")) + '</button><button class="game-tool" type="button" data-game-full aria-label="' + esc(tr("Full screen")) + '">' + svg(FULL) + '</button></div><div class="game-frame"></div><div class="game-loading"><span class="spin"></span><p>' + esc(tr("Loading")) + '</p></div><div class="game-fail"><h2>' + esc(tr("The game didn’t load.")) + '</h2><a class="outline" href="' + esc(ORIGINAL) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open original")) + '</a></div><p class="game-credit">' + esc(CREDIT) + ' · <a href="' + esc(ORIGINAL) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open original")) + "</a></p>";
    return host;
  }
  function mount(route) {
    if (!route || route.game !== "regone") {
      unmount();
      return;
    }
    var host = ensureHost();
    if (!host) return;
    host.hidden = false;
    ensureFrame(host);
    var row = stat("regone");
    patch("regone", { last: Date.now(), ms: row.ms, fav: row.fav });
    startClock("regone");
    paintChrome();
    requestAnimationFrame(place);
  }
  function unmount() {
    stopClock();
    if (failTimer) clearTimeout(failTimer);
    failTimer = 0;
    var host = hostEl();
    if (!host) return;
    host.hidden = true;
    host.classList.remove("is-loaded", "is-failed");
    var frame = host.querySelector("iframe");
    if (frame) {
      frame.src = "about:blank";
      frame.remove();
    }
  }
  function toggleFav(id) {
    if (!gameById(id)) return;
    var row = stat(id);
    patch(id, { fav: !row.fav, ms: row.ms, last: row.last });
    paintChrome();
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function phone() {
    return matchMedia("(max-width: 499px)").matches || matchMedia("(max-width: 900px) and (pointer: coarse)").matches;
  }
  function toggleFull() {
    var host = hostEl();
    if (!host) return;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      return;
    }
    var ask = host.requestFullscreen || host.webkitRequestFullscreen;
    if (!ask) return;
    Promise.resolve(ask.call(host)).then(function () {
      if (phone() && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(function () { /* the browser can refuse a lock */ });
      }
    }).catch(function () { /* fullscreen needs a gesture the browser accepts */ });
  }
  document.addEventListener("click", function (event) {
    var fav = event.target.closest && event.target.closest("[data-game-fav]");
    if (fav) {
      event.preventDefault();
      toggleFav(fav.getAttribute("data-game-fav") || "");
      return;
    }
    var full = event.target.closest && event.target.closest("[data-game-full]");
    if (full) {
      event.preventDefault();
      toggleFull();
    }
  });
  document.addEventListener("visibilitychange", flush);
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  document.addEventListener("fullscreenchange", function () {
    paintChrome();
    place();
  });

  window.ViktorychGames = { page: page, mount: mount, unmount: unmount, shareText: shareText };
})();
