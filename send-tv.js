/* Send to my TV: the fastest free ways to open the site in a TV browser
   without typing the long address. Everything here runs on the phone.
   A web page cannot find or command a TV on the home network (DIAL, UPnP
   and SSDP need an installed app, and browsers block local discovery), so
   the page puts the short TV link on the clipboard or share sheet and walks
   through the TV maker's own free phone app, which can type into the TV.
   Cast to the ViktorychTV app uses our own pairing instead: the TV app,
   linked to the same account, checks for a cast only while its Cast screen
   is open, and the phone sends the link through the account server. */
(function (root) {
  "use strict";

  var KEY = "viktorychapp-sendtv-v1";
  var DEFAULT_HOST = "viktorychapp.pages.dev";
  function brandList() {
    var list = [
    {
      id: "samsung",
      name: "Samsung",
      app: "SmartThings",
      play: "com.samsung.android.oneconnect",
      ios: "1222822904",
      steps: [
        tr("Tap Copy TV link above.", { app: "SmartThings" }),
        tr("Open {app} on your phone and pick your TV. The phone and the TV need the same Wi-Fi.", { app: "SmartThings" }),
        tr("Open the TV remote in {app}.", { app: "SmartThings" }),
        tr("On the TV, open the Internet app and select the address bar so the TV keyboard opens.", { app: "SmartThings" }),
        tr("Your phone now shows a keyboard. Touch and hold, tap Paste, then Done.", { app: "SmartThings" })
      ],
      note: tr("This works in Samsung's own Internet browser, because it uses the TV keyboard. Other TV apps may ignore the phone keyboard.", { app: "SmartThings" })
    },
    {
      id: "lg",
      name: "LG",
      app: "LG ThinQ",
      play: "com.lgeha.nuts",
      ios: "993504342",
      steps: [
        tr("Tap Copy TV link above.", { app: "LG ThinQ" }),
        tr("Open {app} on your phone and pick your TV. The phone and the TV need the same Wi-Fi.", { app: "LG ThinQ" }),
        tr("Paste the link into the search bar at the top of the TV screen in {app} and search.", { app: "LG ThinQ" }),
        tr("On the TV, choose Web. The link opens in the TV's Web Browser.", { app: "LG ThinQ" })
      ],
      note: tr("The menus differ a little between webOS versions. If you only see the remote, open the Web Browser on the TV, select the address bar and paste with the keyboard button in {app}.", { app: "LG ThinQ" })
    },
    {
      id: "google",
      name: "Google TV",
      app: "Google TV",
      play: "com.google.android.videos",
      ios: "746894884",
      steps: [
        tr("Tap Copy TV link above.", { app: "Google TV" }),
        tr("Open the {app} app and tap Remote. On Android you can also use the TV Remote tile in Quick Settings. The first time, type the code the TV shows.", { app: "Google TV" }),
        tr("On the TV, open a web browser and select the address bar.", { app: "Google TV" }),
        tr("Your phone keyboard opens. Touch and hold, tap Paste, then Enter.", { app: "Google TV" })
      ],
      note: tr("Many Google TV and Android TV devices have no browser. Install a free browser from the Play Store on the TV, or install our TV app instead.", { app: "Google TV" })
    },
    {
      id: "fire",
      name: "Fire TV",
      app: "Amazon Fire TV",
      play: "com.amazon.storm.lightning.client.aosp",
      ios: "947984433",
      steps: [
        tr("Tap Copy TV link above.", { app: "Amazon Fire TV" }),
        tr("On the Fire TV, open Silk (the Internet app) and select the address bar so the TV keyboard opens.", { app: "Amazon Fire TV" }),
        tr("Open the {app} app on your phone, pick your Fire TV and type the code the TV shows the first time.", { app: "Amazon Fire TV" }),
        tr("Tap the keyboard button, touch and hold the text box, tap Paste, then Enter.", { app: "Amazon Fire TV" })
      ],
      note: tr("The keyboard has to be open on the TV first, or the phone has nothing to type into.", { app: "Amazon Fire TV" })
    },
    {
      id: "other",
      name: tr("Other TV"),
      app: "",
      steps: [
        tr("Open the TV's web browser.", { app: "" }),
        tr("Type the short address shown above once, or press the microphone on the remote and say it.", { app: "" }),
        tr("Bookmark it or pin it to the TV home screen, so next time it is one click.", { app: "" })
      ],
      note: ""
    }
    ];
    return list;
  }

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : null;
    return fn ? fn(key, vars) : String(key).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (err) { return {}; }
  }

  function save(patch) {
    var cur = read();
    for (var k in patch) cur[k] = patch[k];
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (err) { /* private mode */ }
  }

  /* The short TV host. The owner can point it at a shorter free address later
     (for example the org Pages site) with VIKTORYCH_ACCOUNTS.tvHost. */
  function host() {
    var cfg = (typeof window !== "undefined" && window.VIKTORYCH_ACCOUNTS) || {};
    var h = String(cfg.tvHost || DEFAULT_HOST).replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return /^[a-z0-9.-]+(?:\/[A-Za-z0-9._~-]+)*$/i.test(h) ? h : DEFAULT_HOST;
  }

  function link() { return "https://" + host() + "/?tv=1"; }

  function platform() {
    var ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "");
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "other";
  }

  function brandById(id) {
    var list = brandList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function storeLinks(b) {
    if (!b.app) return "";
    var os = platform();
    var play = "https://play.google.com/store/apps/details?id=" + b.play;
    var apple = "https://apps.apple.com/app/id" + b.ios;
    var label = tr("Open or get {app}", { app: b.app });
    if (os === "android") return '<a class="stv-btn ghost" href="' + esc(play) + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
    if (os === "ios") return '<a class="stv-btn ghost" href="' + esc(apple) + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
    return '<a class="stv-btn ghost" href="' + esc(play) + '" target="_blank" rel="noopener">' + esc(tr("{app} for Android", { app: b.app })) + "</a>" +
      '<a class="stv-btn ghost" href="' + esc(apple) + '" target="_blank" rel="noopener">' + esc(tr("{app} for iPhone", { app: b.app })) + "</a>";
  }

  function brandHtml(b) {
    var steps = "";
    for (var i = 0; i < b.steps.length; i++) steps += "<li>" + esc(b.steps[i]) + "</li>";
    return '<section class="stv-guide" data-stv-guide="' + esc(b.id) + '">' +
      "<h2>" + esc(b.app ? tr("With the {app} app", { app: b.app }) : tr("Any TV with a browser")) + "</h2>" +
      '<ol class="stv-steps">' + steps + "</ol>" +
      (b.note ? '<p class="stv-note">' + esc(b.note) + "</p>" : "") +
      '<div class="stv-row">' + storeLinks(b) + "</div>" +
      "</section>";
  }

  function page(route) {
    var pick = (route && route.brand && brandById(route.brand)) ? route.brand : (read().brand || "");
    var chosen = brandById(pick);
    var pills = "";
    var all = brandList();
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      var on = chosen && chosen.id === b.id;
      pills += '<a class="stv-pill' + (on ? " on" : "") + '" href="#/send-to-tv/' + b.id + '" data-stv-brand="' + b.id + '"' + (on ? ' aria-current="true"' : "") + ">" + esc(b.name) + "</a>";
    }
    var canShare = typeof navigator !== "undefined" && (typeof navigator.share === "function" || !!(root.ViktorychNative && root.ViktorychNative.shareOut));
    return '<div class="topbar tall"><div class="page-head">' +
        '<button class="icon-btn" data-act="back" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 11 13.2 5.2 11.8 3.8 3.6 12l8.2 8.2 1.4-1.4L7.4 13H20v-2z"/></svg></button>' +
        '<div class="head-text grow"><h1>' + esc(tr("Send to my TV")) + "</h1></div></div></div>" +
      '<div class="stv">' +
        '<p class="stv-lead">' + esc(tr("Open the app on your TV without typing a long address. It's free and takes about a minute.")) + "</p>" +
        '<div class="stv-card">' +
          '<span class="stv-label">' + esc(tr("Your TV link")) + "</span>" +
          '<span class="stv-host" data-stv-host>' + esc(host()) + "</span>" +
          '<div class="stv-row">' +
            (canShare ? '<button class="stv-btn primary" type="button" data-stv="share">' + esc(tr("Share TV link")) + "</button>" : "") +
            '<button class="stv-btn ' + (canShare ? "ghost" : "primary") + '" type="button" data-stv="copy">' + esc(tr("Copy TV link")) + "</button>" +
          "</div>" +
          '<p class="stv-status" data-stv-status role="status" aria-live="polite"></p>' +
        "</div>" +
        castCard(route) +
        "<h2>" + esc(tr("Which TV do you have?")) + "</h2>" +
        '<nav class="stv-pills" aria-label="' + esc(tr("Which TV do you have?")) + '">' + pills + "</nav>" +
        (chosen ? brandHtml(chosen) : '<p class="stv-note">' + esc(tr("Pick your TV to see the fastest way for it.")) + "</p>") +
        '<section class="stv-guide">' +
          "<h2>" + esc(tr("After the first time")) + "</h2>" +
          "<p>" + esc(tr("Bookmark the page in the TV browser, or pin it to the TV home screen. On Google TV and Android TV you can also install our TV app for its own icon.")) + "</p>" +
          '<div class="stv-row"><a class="stv-btn ghost" href="tv/">' + esc(tr("Get the TV app")) + "</a></div>" +
        "</section>" +
        '<section class="stv-guide stv-honest">' +
          "<h2>" + esc(tr("What a website can't do")) + "</h2>" +
          "<ul>" +
            "<li>" + esc(tr("Find your TV on the Wi-Fi and open its browser by itself. Only the TV maker's app can do that, which is why the steps use it.")) + "</li>" +
            "<li>" + esc(tr("Screen mirroring (Smart View, AirPlay) only copies your phone's screen. It doesn't open the TV browser.")) + "</li>" +
            "<li>" + esc(tr("Chromecast needs a paid Google registration, so we don't use it. Cast to the ViktorychTV app above uses our own free pairing instead.")) + "</li>" +
          "</ul>" +
        "</section>" +
      "</div>";
  }

  function accounts() { return (typeof window !== "undefined" && window.ViktorychAccounts) || null; }
  function signedIn() {
    var a = accounts();
    return !!(a && a.token && a.token());
  }

  /* An https link the TV app can open, or "". The TV checks it again. */
  function castLink(value) {
    var text = String(value || "").trim();
    if (!text || text.length > 2000 || /[\s<>"\\^`{|}]/.test(text)) return "";
    var m = /^https:\/\/([^\/?#@:]+)(?::\d+)?(?:[\/?#]|$)/i.exec(text);
    return m && m[1].indexOf(".") > 0 ? text : "";
  }

  function castCard(route) {
    var q = route && route.query && route.query.get ? route.query.get("u") : "";
    var start = castLink(q);
    return '<section class="stv-card stv-cast" data-stv-cast>' +
      "<h2>" + esc(tr("Cast to the ViktorychTV app")) + "</h2>" +
      '<p class="stv-note">' + esc(tr("On the TV, open Cast from the ViktorychTV home screen or its Defaults screen. Then send a post, video or song link from here, and it opens on the TV.")) + "</p>" +
      '<label class="stv-label" for="stv-cast-url">' + esc(tr("Link to play on the TV")) + "</label>" +
      '<input id="stv-cast-url" class="stv-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2000" placeholder="https://" data-stv-cast-url value="' + esc(start) + '">' +
      '<div class="stv-row">' +
        '<button class="stv-btn primary" type="button" data-stv="cast">' + esc(tr("Send to my TV app")) + "</button>" +
      "</div>" +
      '<p class="stv-status" data-stv-cast-status role="status" aria-live="polite">' + (signedIn() ? "" : esc(tr("Sign in on this phone and link your TV app with the same account to cast."))) + "</p>" +
    "</section>";
  }

  function castStatus(text, bad) {
    var el = document.querySelector("[data-stv-cast-status]");
    if (!el) return;
    el.textContent = text;
    if (el.classList) el.classList.toggle("bad", !!bad);
  }

  function doCast() {
    var input = document.querySelector("[data-stv-cast-url]");
    var url = castLink(input ? input.value : "");
    if (!url) { castStatus(tr("Paste a link that starts with https://"), true); return; }
    var a = accounts();
    var token = a && a.token ? a.token() : "";
    if (!token || !a.call) { castStatus(tr("Sign in on this phone and link your TV app with the same account to cast."), true); return; }
    castStatus(tr("Sending…"), false);
    a.call("/v1/tv-cast/send", { method: "POST", body: { url: url }, token: token }).then(function (res) {
      if (res && res.status === 200) {
        castStatus(res.listening ? tr("Sent. It's opening on your TV.") : tr("Sent. Open Cast on the TV app in the next two minutes and it plays there."), false);
      } else if (res && res.status === 401) {
        castStatus(tr("Sign in on this phone and link your TV app with the same account to cast."), true);
      } else if (res && res.status === 429) {
        castStatus(tr("Too many attempts. Try again later."), true);
      } else if (res && res.status === 400) {
        castStatus(tr("Paste a link that starts with https://"), true);
      } else {
        castStatus(tr("Could not reach the server. Try again."), true);
      }
    }, function () {
      castStatus(tr("Could not reach the server. Try again."), true);
    });
  }

  function status(text) {
    var el = document.querySelector("[data-stv-status]");
    if (el) el.textContent = text;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      area.remove();
      return !!ok;
    } catch (err) { return false; }
  }

  function doCopy() {
    var url = link();
    copyText(url).then(function (ok) {
      status(ok ? tr("Copied. Now paste it on the TV with the steps below.") : tr("Copy didn't work. Type {host} on the TV instead.", { host: host() }));
    });
  }

  function doShare() {
    var url = link();
    var data = { title: tr("Open on my TV"), text: tr("Open this on the TV: {host}", { host: host() }), url: url };
    var native = root.ViktorychNative && root.ViktorychNative.shareOut;
    var run = native ? native(data) : (typeof navigator.share === "function" ? navigator.share(data).then(function () { return true; }) : Promise.resolve(false));
    Promise.resolve(run).then(function (ok) { if (ok === false) doCopy(); }, function (err) {
      if (err && err.name === "AbortError") return;
      doCopy();
    });
  }

  function onClick(e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest("[data-stv]") : null;
    if (btn) {
      e.preventDefault();
      if (btn.getAttribute("data-stv") === "copy") doCopy();
      else if (btn.getAttribute("data-stv") === "share") doShare();
      else if (btn.getAttribute("data-stv") === "cast") doCast();
      return;
    }
    var pill = t && t.closest ? t.closest("[data-stv-brand]") : null;
    if (pill) save({ brand: pill.getAttribute("data-stv-brand") });
  }

  if (typeof document !== "undefined" && !root.__stvBound) {
    root.__stvBound = true;
    document.addEventListener("click", onClick, false);
  }

  root.ViktorychSendTV = {
    page: page,
    link: link,
    castLink: castLink,
    host: host,
    brands: function () { return brandList().map(function (b) { return b.id; }); }
  };
})(typeof window !== "undefined" ? window : globalThis);
