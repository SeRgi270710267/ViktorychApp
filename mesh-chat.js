/* Nearby chat: a fallback for when our servers can't be reached.
   - In the TV app it opens the native Bitchat-compatible Bluetooth mesh
     screen (viktorychtv://mesh).
   - In a browser it opens a Bitchat location channel: public kind 20000
     Nostr events tagged with a geohash, over public relays.
   Offered only when every normal path has failed; nothing connects until the
   user opens it, and every socket closes when the chat closes.
   Protocol: Bitchat (permissionlesstech/bitchat, public domain, The Unlicense). */
(function () {
  "use strict";
  var MODE_KEY = "viktorychapp-mesh";
  var AREA_KEY = "viktorychapp-mesh-area";
  var NICK_KEY = "viktorychapp-mesh-nick";
  var RELAYS_KEY = "viktorychapp-mesh-relays";
  var SK_KEY = "viktorychapp-mesh-key";
  // Bitchat's own default relays, so web and phone users meet.
  var DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://offchain.pub"];
  var GEO = "0123456789bcdefghjkmnpqrstuvwxyz";

  // English phrases are pack keys (i18n/*.js); SI18n translates them.
  var TEXT = {
    open: "Nearby chat",
    title: "Nearby chat (Bitchat)",
    about: "A backup way to talk when the app can't reach its servers. On the TV app it uses Bluetooth to chat with people nearby. In a browser it uses an area chat over public Nostr relays. Both work with the Bitchat app. Messages here are public; anyone in the area can read them.",
    mode: "Offer nearby chat when nothing else loads",
    modeHelp: "It never runs by itself. It is offered only when the app can't load at all, and it connects only while the chat is open.",
    openNow: "Open nearby chat",
    area: "Area (geohash)",
    here: "Use my location",
    join: "Join",
    relays: "Relays",
    relaysAsk: "Nostr relays, separated by spaces (wss://…). Leave empty for the defaults.",
    name: "Name",
    nameAsk: "Your name in the chat",
    say: "Type a message",
    send: "Send",
    close: "Close",
    pick: "Pick an area to start, such as u3qc for a city or u3qcn for a district.",
    bad: "That is not a geohash. Use letters and digits like u3qcn.",
    conn: "{up} of {all} relays connected",
    none: "No messages in the last hour yet.",
    noLoc: "Location is not available. Type an area instead.",
    offline: "You are offline. The browser area chat needs some internet; the TV app can use Bluetooth."
  };

  function t(key, vars) {
    var s = TEXT[key] || key;
    try { if (window.SI18n && window.SI18n.t) s = window.SI18n.t(s) || s; } catch (err) { /* packs not loaded */ }
    Object.keys(vars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function get(k) { try { return localStorage.getItem(k); } catch (err) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (err) { /* private mode */ } }

  /* ---------- when to offer it ---------- */
  function mode() { return get(MODE_KEY) === "off" ? "off" : "auto"; }
  function setMode(m) { set(MODE_KEY, m === "off" ? "off" : null); }
  function killed() {
    try { var l = JSON.parse(get("viktorychapp-server-off") || "[]"); return Array.isArray(l) && l.indexOf("bitchat") >= 0; } catch (err) { return false; }
  }
  function inTvApp() {
    try {
      if (window.ViktorychTVMode && window.ViktorychTVMode.inApp && window.ViktorychTVMode.inApp()) return true;
      if (document.documentElement.classList.contains("tv-app")) return true;
      if (sessionStorage.getItem("viktorychapp-tv-v1-app") === "1") return true;
    } catch (err) { /* private mode */ }
    return /[?&]src=tvapp\b/.test(location.search) || /ViktorychTV/.test(navigator.userAgent || "");
  }
  function webOk() { return !!(window.WebSocket && window.crypto && window.crypto.subtle && window.ViktorychNostr && typeof BigInt === "function"); }
  /* kind: "limited" (online, our servers down) or "offline" (no network). */
  function offer(kind) {
    if (mode() === "off" || killed()) return false;
    if (inTvApp()) return true;
    return kind === "limited" && webOk();
  }
  function buttonHtml(kind) {
    return offer(kind) ? ' <button type="button" class="net-note-btn" data-act="mesh-open">' + esc(t("open")) + "</button>" : "";
  }
  function settingsHtml() {
    if (killed()) return "";
    var on = mode() !== "off";
    return '<div class="mesh-set"><h2>' + esc(t("title")) + '</h2><p class="phandle">' + esc(t("about")) + "</p>"
      + '<button class="tab-switch' + (on ? " on" : "") + '" type="button" role="switch" aria-checked="' + on + '" data-act="mesh-mode"><span>' + esc(t("mode")) + "</span><i></i></button>"
      + '<p class="phandle">' + esc(t("modeHelp")) + "</p>"
      + (on ? '<button class="outline" type="button" data-act="mesh-open">' + esc(t("openNow")) + "</button>" : "") + "</div>";
  }

  function open() {
    if (inTvApp()) {
      // The TV app's native screen; if this build doesn't have it, fall back to the web chat.
      var left = false;
      var gone = function () { if (document.hidden) left = true; };
      document.addEventListener("visibilitychange", gone);
      try { location.href = "intent://mesh#Intent;scheme=viktorychtv;package=app.viktorych.tv;end"; } catch (err) { /* no handler */ }
      setTimeout(function () { document.removeEventListener("visibilitychange", gone); if (!left && !document.hidden && webOk()) openWeb(); }, 1500);
      return;
    }
    openWeb();
  }

  /* ---------- geohash and keys ---------- */
  function geohash(lat, lon, len) {
    var la = [-90, 90], lo = [-180, 180], out = "", bit = 0, ch = 0, even = true;
    while (out.length < len) {
      var r = even ? lo : la, v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
      if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
      even = !even;
      if (++bit === 5) { out += GEO[ch]; bit = 0; ch = 0; }
    }
    return out;
  }
  function isGeohash(s) { return /^[0-9bcdefghjkmnpqrstuvwxyz]{2,12}$/.test(String(s || "")); }
  function hex(b) { return Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function secret() {
    var sk = get(SK_KEY);
    if (/^[0-9a-f]{64}$/.test(sk || "")) return sk;
    for (;;) {
      sk = hex(crypto.getRandomValues(new Uint8Array(32)));
      try { window.ViktorychNostr.getPublicKey(sk); break; } catch (err) { /* out of range, try again */ }
    }
    set(SK_KEY, sk);
    return sk;
  }
  function relays() {
    var raw = String(get(RELAYS_KEY) || "").split(/\s+/).filter(function (r) { return window.ViktorychNostr.goodRelay(r); });
    return (raw.length ? raw : DEFAULT_RELAYS).slice(0, 8);
  }
  function sha256hex(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (b) { return hex(new Uint8Array(b)); });
  }
  /* Bitchat asks for 8 bits of NIP-13 proof of work on area messages. */
  function makeEvent(text, gh, nick) {
    var N = window.ViktorychNostr, sk = secret(), pk = N.getPublicKey(sk);
    var created = Math.floor(Date.now() / 1000), nonce = 0;
    var base = [["g", gh]];
    if (nick) base.push(["n", nick]);
    function attempt() {
      var tags = base.concat([["nonce", String(nonce), "8"]]);
      return sha256hex(JSON.stringify([0, pk, created, 20000, tags, text])).then(function (id) {
        if (id.slice(0, 2) !== "00") { nonce++; return attempt(); }
        return N.schnorrSign(N._unhex(id), sk).then(function (sig) {
          return { id: id, pubkey: pk, created_at: created, kind: 20000, tags: tags, content: text, sig: sig };
        });
      });
    }
    return attempt();
  }

  /* ---------- browser area chat ---------- */
  var chat = null;
  function css() {
    if (document.getElementById("mesh-css")) return;
    var s = document.createElement("style"); s.id = "mesh-css";
    s.textContent = ".mesh-chat{position:fixed;inset:0;z-index:2147483000;background:var(--bg,#0f1115);color:var(--text,#e7e9ea);display:flex;flex-direction:column;padding:16px;gap:8px;font-size:15px}"
      + ".mesh-chat header{display:flex;align-items:center;gap:8px}.mesh-chat h2{flex:1;margin:0;font-size:18px}"
      + ".mesh-chat .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.mesh-chat input{flex:1;min-width:8em;padding:8px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:inherit;font:inherit}"
      + ".mesh-chat button{padding:8px 12px;border-radius:8px;border:1px solid var(--border,#333);background:transparent;color:inherit;font:inherit;cursor:pointer}"
      + ".mesh-chat button:focus,.mesh-chat input:focus{outline:2px solid var(--accent,#1d9bf0)}"
      + ".mesh-chat .log{flex:1;overflow:auto;border-top:1px solid var(--border,#333);padding-top:8px}.mesh-chat .log p{margin:4px 0;word-wrap:break-word}"
      + ".mesh-chat .who{font-weight:700}.mesh-chat .muted{opacity:.7;font-size:13px}";
    document.head.appendChild(s);
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function openWeb() {
    if (chat) return;
    css();
    var box = el("div", { class: "mesh-chat", role: "dialog", "aria-label": t("title") });
    var head = el("header"); head.appendChild(el("h2", null, t("title")));
    var close = el("button", { type: "button" }, t("close")); head.appendChild(close); box.appendChild(head);
    box.appendChild(el("p", { class: "muted" }, t("about")));
    var areaRow = el("div", { class: "row" });
    var area = el("input", { type: "text", placeholder: t("area"), "aria-label": t("area"), autocapitalize: "off", spellcheck: "false" });
    area.value = get(AREA_KEY) || "";
    var join = el("button", { type: "button" }, t("join")), here = el("button", { type: "button" }, t("here"));
    var nameBtn = el("button", { type: "button" }, t("name")), relayBtn = el("button", { type: "button" }, t("relays"));
    [area, join, here, nameBtn, relayBtn].forEach(function (n) { areaRow.appendChild(n); });
    box.appendChild(areaRow);
    var status = el("p", { class: "muted" }, navigator.onLine === false ? t("offline") : t("pick")); box.appendChild(status);
    var log = el("div", { class: "log", "aria-live": "polite" }); box.appendChild(log);
    var sendRow = el("div", { class: "row" });
    var input = el("input", { type: "text", placeholder: t("say"), "aria-label": t("say"), maxlength: "1000" });
    var send = el("button", { type: "button" }, t("send"));
    sendRow.appendChild(input); sendRow.appendChild(send); box.appendChild(sendRow);
    document.body.appendChild(box);

    chat = { box: box, socks: [], seen: {}, gh: "", timer: 0 };
    function paint() {
      if (!chat.gh) return;
      var up = chat.socks.filter(function (s) { return s.readyState === 1; }).length;
      status.textContent = "#" + chat.gh + " · " + t("conn", { up: up, all: chat.socks.length });
    }
    function line(ev) {
      var nick = "", tags = ev.tags || [];
      for (var i = 0; i < tags.length; i++) if (tags[i][0] === "n" && tags[i][1]) nick = String(tags[i][1]).slice(0, 32);
      var p = el("p"); var when = new Date(ev.created_at * 1000);
      p.appendChild(el("span", { class: "muted" }, when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " "));
      p.appendChild(el("span", { class: "who" }, (nick || "anon") + "#" + ev.pubkey.slice(-4) + ": "));
      p.appendChild(document.createTextNode(String(ev.content).slice(0, 2000)));
      var empty = log.querySelector(".empty"); if (empty) empty.remove();
      // Keep time order: relays send history newest first.
      var kids = log.children, at = null;
      for (var k = kids.length - 1; k >= 0; k--) { if (Number(kids[k].dataset.ts) <= ev.created_at) break; at = kids[k]; }
      p.dataset.ts = String(ev.created_at);
      log.insertBefore(p, at);
      while (log.children.length > 300) log.removeChild(log.firstChild);
      if (!at) log.scrollTop = log.scrollHeight;
    }
    function onEvent(ev) {
      if (!ev || ev.kind !== 20000 || chat.seen[ev.id]) return;
      var tags = Array.isArray(ev.tags) ? ev.tags : [], ok = false;
      for (var i = 0; i < tags.length; i++) if (tags[i][0] === "g" && tags[i][1] === chat.gh) ok = true;
      if (!ok) return;
      chat.seen[ev.id] = 1;
      window.ViktorychNostr.verifyEvent(ev).then(function (good) { if (good && chat) line(ev); else if (chat) delete chat.seen[ev.id]; });
    }
    function disconnect() {
      clearTimeout(chat.timer);
      chat.socks.forEach(function (s) { s.onclose = null; try { s.close(); } catch (err) { /* closed */ } });
      chat.socks = [];
    }
    function connect(gh) {
      disconnect();
      chat.gh = gh; chat.seen = {}; log.textContent = "";
      log.appendChild(el("p", { class: "muted empty" }, t("none")));
      var since = Math.floor(Date.now() / 1000) - 3600;
      relays().forEach(function (url) {
        var tries = 0;
        (function dial() {
          if (!chat || chat.gh !== gh) return;
          var ws; try { ws = new WebSocket(url); } catch (err) { return; }
          chat.socks.push(ws);
          ws.onopen = function () { tries = 0; ws.send(JSON.stringify(["REQ", "vk-geo", { kinds: [20000], "#g": [gh], since: since, limit: 100 }])); paint(); };
          ws.onmessage = function (m) { var d; try { d = JSON.parse(m.data); } catch (err) { return; } if (Array.isArray(d) && d[0] === "EVENT") onEvent(d[2]); };
          ws.onclose = function () {
            chat && (chat.socks = chat.socks.filter(function (s) { return s !== ws; }));
            paint();
            if (chat && chat.gh === gh && ++tries < 4) chat.timer = setTimeout(dial, 4000 * tries);
          };
        })();
      });
      paint();
    }
    function go() {
      var gh = String(area.value || "").trim().toLowerCase().replace(/^#/, "");
      if (!isGeohash(gh)) { status.textContent = t("bad"); return; }
      set(AREA_KEY, gh); connect(gh); input.focus();
    }
    function shut() {
      disconnect();
      box.remove(); chat = null;
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(e) { if (e.key === "Escape" || e.key === "GoBack" || e.keyCode === 10009) { e.preventDefault(); shut(); } }
    document.addEventListener("keydown", onKey, true);
    close.addEventListener("click", shut);
    join.addEventListener("click", go);
    area.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    here.addEventListener("click", function () {
      if (!navigator.geolocation) { status.textContent = t("noLoc"); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        area.value = geohash(pos.coords.latitude, pos.coords.longitude, 5); go();
      }, function () { status.textContent = t("noLoc"); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    });
    nameBtn.addEventListener("click", function () {
      var v = prompt(t("nameAsk"), get(NICK_KEY) || "");
      if (v != null) set(NICK_KEY, String(v).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 32) || null);
    });
    relayBtn.addEventListener("click", function () {
      var v = prompt(t("relaysAsk"), relays().join(" "));
      if (v == null) return;
      var list = String(v).split(/\s+/).filter(function (r) { return window.ViktorychNostr.goodRelay(r); });
      set(RELAYS_KEY, list.length ? list.join(" ") : null);
      if (chat.gh) connect(chat.gh);
    });
    function doSend() {
      var text = String(input.value || "").trim();
      if (!text || !chat.gh) { if (!chat.gh) status.textContent = t("pick"); return; }
      input.value = "";
      var gh = chat.gh;
      makeEvent(text.slice(0, 1000), gh, get(NICK_KEY) || "").then(function (ev) {
        if (!chat || chat.gh !== gh) return;
        var msg = JSON.stringify(["EVENT", ev]);
        chat.socks.forEach(function (s) { if (s.readyState === 1) s.send(msg); });
        onEvent(ev);
      });
    }
    send.addEventListener("click", doSend);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") doSend(); });
    if (isGeohash(area.value)) go(); else area.focus();
  }

  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act="mesh-open"], [data-act="mesh-mode"]') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.act === "mesh-open") { open(); return; }
    setMode(mode() === "off" ? "auto" : "off");
    var holder = b.closest(".mesh-set");
    if (holder) { var tmp = document.createElement("div"); tmp.innerHTML = settingsHtml(); if (tmp.firstChild) holder.replaceWith(tmp.firstChild); }
  }, true);

  window.ViktorychMesh = { mode: mode, setMode: setMode, offer: offer, buttonHtml: buttonHtml, settingsHtml: settingsHtml, open: open, geohash: geohash, isGeohash: isGeohash, _makeEvent: makeEvent, _text: TEXT };
})();
