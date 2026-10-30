/* Inbox › SMS codes (owner only). Shows the codes that reach the owner's
   rented SMSPool numbers. The Worker holds the API key (SMSPOOL_API_KEY) and
   answers GET /v1/owner/sms for the owner session only.
   Local-first and light: the last answer is kept on this device encrypted
   (AES-GCM, a non-extractable key in IndexedDB "viktorych-messages-sms"),
   painted at once, and refreshed only while this section is open and the tab
   is visible: every 15 s while a code is awaited, otherwise every 2 min.
   Numbers and codes are never written to the console or sent anywhere else. */
(function (root) {
  "use strict";

  var DB = "viktorych-messages-sms";
  var STORE = "kv";
  var KEEP_MS = 24 * 60 * 60 * 1000;
  var FAST_MS = 15000;
  var SLOW_MS = 120000;

  function tr(key, vars) {
    var fn = root.t ? root.t : null;
    return fn ? fn(key, vars) : key;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function inbox() { return root.ViktorychInbox || null; }
  function isOwner() { return !!(inbox() && inbox().isOwner()); }
  function accounts() { return root.ViktorychAccounts || null; }
  function token() {
    try { return accounts() && accounts().token ? String(accounts().token() || "") : ""; } catch (err) { return ""; }
  }
  function onSection() {
    return !!(inbox() && inbox().isSmsHash(root.location ? root.location.hash : ""));
  }

  var state = { data: null, loading: false, error: "", fetchedAt: 0, timer: 0, ticker: 0, started: false, history: false, copied: "" };

  /* ---------- encrypted device cache ---------- */
  function idb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("no_idb")); return; }
      var open = root.indexedDB.open(DB, 1);
      open.onupgradeneeded = function () { open.result.createObjectStore(STORE); };
      open.onsuccess = function () { resolve(open.result); };
      open.onerror = function () { reject(open.error); };
    });
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var out = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(out && "result" in out ? out.result : undefined); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }
  function subtle() { return root.crypto && root.crypto.subtle ? root.crypto.subtle : null; }
  function deviceKey() {
    return idbDo("readonly", function (s) { return s.get("key"); }).then(function (key) {
      if (key) return key;
      if (!subtle()) throw new Error("no_crypto");
      return subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (made) {
        return idbDo("readwrite", function (s) { s.put(made, "key"); }).then(function () { return made; });
      });
    });
  }
  function saveCache(body) {
    if (!subtle()) return Promise.resolve();
    return deviceKey().then(function (key) {
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      var plain = new TextEncoder().encode(JSON.stringify({ at: Date.now(), body: body }));
      return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, plain).then(function (ct) {
        return idbDo("readwrite", function (s) { s.put({ iv: iv, ct: ct }, "data"); });
      });
    }).catch(function () { /* the next open fetches again */ });
  }
  function readCache() {
    if (!subtle()) return Promise.resolve(null);
    return Promise.all([
      idbDo("readonly", function (s) { return s.get("key"); }),
      idbDo("readonly", function (s) { return s.get("data"); })
    ]).then(function (got) {
      var key = got[0], row = got[1];
      if (!key || !row) return null;
      return subtle().decrypt({ name: "AES-GCM", iv: row.iv }, key, row.ct).then(function (plain) {
        var doc = JSON.parse(new TextDecoder().decode(plain));
        if (!doc || Date.now() - Number(doc.at || 0) > KEEP_MS) return null;
        return doc;
      });
    }).catch(function () { return null; });
  }
  function dropCache() {
    try { if (root.indexedDB) root.indexedDB.deleteDatabase(DB); } catch (err) { /* nothing kept */ }
  }

  /* ---------- fetching ---------- */
  function hasWaiting(data) {
    return !!(data && Array.isArray(data.orders) && data.orders.some(function (o) { return o.status === "waiting"; }));
  }
  function fetchNow() {
    if (state.loading || !token() || !accounts() || !accounts().call) return Promise.resolve();
    state.loading = true;
    repaint();
    return accounts().call("/v1/owner/sms" + (state.history ? "?history=1" : ""), { token: token() }).then(function (body) {
      state.loading = false;
      if (!body || body.status !== 200) {
        state.error = body && (body.status === 403 || body.status === 404) ? "owner" : (body && body.status === 429 ? "busy" : "offline");
      } else {
        delete body.status;
        delete body.bodyStatus;
        state.error = body.error || "";
        if (!body.error) {
          state.data = body;
          state.fetchedAt = Date.now();
          if (body.connected) saveCache(body);
        } else if (!state.data || body.connected === false) {
          state.data = body;
        }
      }
      repaint();
    }, function () {
      state.loading = false;
      state.error = "offline";
      repaint();
    });
  }
  function schedule() {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!onSection() || (root.document && root.document.hidden)) return;
    if (state.data && state.data.connected === false) return;
    var gap = hasWaiting(state.data) ? FAST_MS : SLOW_MS;
    state.timer = setTimeout(function () {
      if (!onSection()) { stop(); return; }
      fetchNow().then(schedule);
    }, gap);
  }
  function stop() {
    clearTimeout(state.timer);
    clearInterval(state.ticker);
    state.timer = 0;
    state.ticker = 0;
    state.started = false;
  }
  function start() {
    if (state.started) return;
    state.started = true;
    var first = state.data ? Promise.resolve(null) : readCache();
    first.then(function (doc) {
      if (doc && doc.body && !state.data) {
        state.data = doc.body;
        state.fetchedAt = doc.at;
        repaint();
      }
      var fresh = Date.now() - state.fetchedAt < 10000;
      return fresh ? null : fetchNow();
    }).then(schedule);
    clearInterval(state.ticker);
    state.ticker = setInterval(tick, 1000);
  }

  /* ---------- formatting ---------- */
  function ago(sec) {
    if (!sec) return "";
    var d = Math.max(0, Math.floor(Date.now() / 1000 - sec));
    if (d < 10) return tr("now");
    if (d < 60) return tr("{n}s", { n: d });
    if (d < 3600) return tr("{n}m", { n: Math.floor(d / 60) });
    if (d < 86400) return tr("{n}h", { n: Math.floor(d / 3600) });
    return tr("{n}d", { n: Math.floor(d / 86400) });
  }
  function clock(left) {
    left = Math.max(0, Math.floor(left));
    var h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    var mm = (h ? String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
    return h ? h + ":" + mm : mm;
  }
  function phone(num) {
    var d = String(num || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 11 && d[0] === "1") return "+1 " + d.slice(1, 4) + " " + d.slice(4, 7) + " " + d.slice(7);
    return "+" + d.replace(/(\d{3})(?=\d{4})/g, "$1 ");
  }
  function spaced(code) {
    var c = String(code || "");
    if (/^\d{6}$/.test(c)) return c.slice(0, 3) + " " + c.slice(3);
    if (/^\d{8}$/.test(c)) return c.slice(0, 4) + " " + c.slice(4);
    return c;
  }
  function plainCode(code) {
    var c = String(code || "");
    return /^\d{3}[- ]\d{3}$/.test(c) ? c.replace(/\D/g, "") : c;
  }
  var STATUS = {
    waiting: function () { return tr("Waiting"); },
    received: function () { return tr("Received"); },
    expired: function () { return tr("Expired"); },
    refunded: function () { return tr("Refunded"); },
    cancelled: function () { return tr("Cancelled"); }
  };
  function statusLabel(s) { return (STATUS[s] || STATUS.waiting)(); }

  var COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8V3zm-3 4h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h11V9H5z"/></svg>';
  var CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6 11-11-1.4-1.4z"/></svg>';
  var REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.3A10 10 0 1 0 22 12h-2a8 8 0 1 1-8-8z"/></svg>';

  function codeButton(code, big) {
    var raw = plainCode(code);
    var copied = state.copied === raw;
    return '<button type="button" class="sms-code' + (big ? " big" : "") + (copied ? " copied" : "") + '" data-sms-copy="' + esc(raw) + '" aria-label="' + esc(tr("Copy code")) + '">' +
      '<span class="sms-digits">' + esc(spaced(code)) + "</span>" +
      '<span class="sms-copy-ic">' + (copied ? CHECK_ICON : COPY_ICON) + "<em>" + esc(copied ? tr("Copied") : tr("Copy")) + "</em></span></button>";
  }

  function avatar(name) {
    var letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
    return '<span class="sms-av" aria-hidden="true">' + esc(letter) + "</span>";
  }

  function orderCard(o) {
    var now = Date.now() / 1000;
    var left = o.expiry ? o.expiry - now : 0;
    var meta = [phone(o.number), o.country, ago(o.at)].filter(Boolean).map(esc).join(" · ");
    var body;
    if (o.code) {
      body = codeButton(o.code, true) + (o.full && o.full !== o.code ? '<p class="sms-full">' + esc(o.full) + "</p>" : "");
    } else if (o.status === "waiting") {
      body = '<div class="sms-wait"><span class="sms-dots" aria-hidden="true"><i></i><i></i><i></i></span>' + esc(tr("Waiting for the SMS…")) + "</div>";
    } else {
      body = '<div class="sms-none">' + esc(o.status === "refunded" ? tr("No SMS arrived. The order was refunded.") : (o.status === "cancelled" ? tr("The order was cancelled.") : tr("No SMS arrived before the number expired."))) + "</div>";
    }
    var foot = o.status === "waiting" && o.expiry
      ? '<div class="sms-foot"><span class="sms-left" data-sms-left="' + esc(o.expiry) + '">' + esc(tr("Expires in {time}", { time: clock(left) })) + '</span><span class="sms-bar"><i style="width:' + Math.max(0, Math.min(100, left / 12)) + '%" data-sms-bar="' + esc(o.expiry) + '"></i></span></div>'
      : "";
    return '<article class="sms-card st-' + esc(o.status) + '">' +
      '<div class="sms-top">' + avatar(o.service) + '<div class="sms-meta"><b>' + esc(o.service || tr("SMS")) + "</b><span>" + meta + "</span></div>" +
      '<span class="sms-badge">' + esc(statusLabel(o.status)) + "</span></div>" + body + foot + "</article>";
  }

  function rentalCard(r) {
    var now = Date.now() / 1000;
    var until = r.expiry ? new Date(r.expiry * 1000) : null;
    var msgs = (r.messages || []).map(function (m) {
      return '<li class="sms-msg">' + (m.code ? codeButton(m.code, false) : "") +
        '<p>' + esc(m.text) + '</p><span class="sms-msg-meta">' + esc([m.sender, ago(m.at)].filter(Boolean).join(" · ")) + "</span></li>";
    }).join("");
    var active = !r.expiry || r.expiry > now;
    return '<article class="sms-card sms-rental st-' + (active ? "received" : "expired") + '">' +
      '<div class="sms-top">' + avatar(r.country || "#") + '<div class="sms-meta"><b>' + esc(phone(r.number)) + "</b><span>" +
      esc([tr("Rented number"), r.country, until ? tr("until {date}", { date: until.toLocaleDateString() }) : ""].filter(Boolean).join(" · ")) + "</span></div>" +
      '<span class="sms-badge">' + esc(active ? tr("Active") : tr("Expired")) + "</span></div>" +
      (msgs ? '<ul class="sms-msgs">' + msgs + "</ul>" : '<div class="sms-wait">' + esc(tr("No messages yet.")) + "</div>") +
      "</article>";
  }

  function notice(title, text) {
    return '<div class="sms-empty"><h2>' + esc(title) + "</h2><p>" + esc(text) + "</p></div>";
  }

  function bodyHtml() {
    if (!isOwner()) return notice(tr("Owner only"), tr("SMS codes are only shown to the app owner."));
    var d = state.data;
    if (!d && state.error === "owner") return notice(tr("Owner only"), tr("SMS codes are only shown to the app owner."));
    if (!d && state.error === "offline") return notice(tr("Can't load SMS codes"), tr("Check your connection and try again."));
    if (!d) return '<div class="skel"><div class="av"></div><div style="flex:1"><i></i><i style="width:80%"></i><i style="width:60%"></i></div></div>';
    if (d.connected === false) return notice(tr("SMSPool isn't connected"), tr("Add your SMSPool API key as the Worker secret SMSPOOL_API_KEY. Codes show up here after that."));
    if (state.error === "bad_key" || d.error === "bad_key") return notice(tr("SMSPool rejected the API key"), tr("Replace the Worker secret SMSPOOL_API_KEY with the key from your SMSPool settings."));
    var orders = (d.orders || []).map(orderCard).join("");
    var rentals = (d.rentals || []).map(rentalCard).join("");
    var warn = state.error === "busy" ? '<p class="sms-note">' + esc(tr("SMSPool is busy. Trying again shortly.")) + "</p>"
      : (state.error ? '<p class="sms-note">' + esc(tr("Showing the last codes saved on this device.")) + "</p>" : "");
    if (!orders && !rentals) return warn + notice(tr("No codes yet"), tr("Codes for numbers you order or rent on SMSPool show up here."));
    return warn +
      (orders ? '<h3 class="sms-h">' + esc(tr("Verifications")) + "</h3>" + orders : "") +
      (rentals ? '<h3 class="sms-h">' + esc(tr("Rented numbers")) + "</h3>" + rentals : "") +
      (state.history ? "" : '<button type="button" class="sms-more" data-sms-history>' + esc(tr("Show earlier codes")) + "</button>");
  }

  function sectionHtml() {
    var updated = state.fetchedAt ? tr("Updated {time}", { time: ago(state.fetchedAt / 1000) }) : "";
    return '<div class="sms-sub"><div><b>' + esc(tr("SMS codes")) + '</b><span data-sms-updated>' + esc(updated) + "</span></div>" +
      (isOwner() ? '<button type="button" class="sms-refresh' + (state.loading ? " spin" : "") + '" data-sms-refresh aria-label="' + esc(tr("Refresh")) + '">' + REFRESH_ICON + "</button>" : "") +
      '</div><div class="sms-list" data-sms-list>' + bodyHtml() + "</div>";
  }

  function page() {
    var chips = inbox() && inbox().tabsHtml ? inbox().tabsHtml() : "";
    if (isOwner()) setTimeout(start, 0);
    else { stop(); state.data = null; dropCache(); }
    return '<div class="inbox-sms" data-inbox-sms><header class="dmsgs-head"><h1>' + esc(tr("Inbox")) + "</h1></header>" + chips +
      '<section class="sms-section" aria-live="polite">' + sectionHtml() + "</section></div>";
  }

  function repaint() {
    if (!root.document) return;
    var el = root.document.querySelector("[data-inbox-sms] .sms-section");
    if (!el) return;
    el.innerHTML = sectionHtml();
  }

  function tick() {
    if (!root.document) return;
    if (!onSection() || !root.document.querySelector("[data-inbox-sms]")) { stop(); return; }
    var now = Date.now() / 1000;
    var expired = false;
    root.document.querySelectorAll("[data-sms-left]").forEach(function (el) {
      var left = Number(el.getAttribute("data-sms-left")) - now;
      if (left <= 0) expired = true;
      el.textContent = tr("Expires in {time}", { time: clock(left) });
    });
    root.document.querySelectorAll("[data-sms-bar]").forEach(function (el) {
      var left = Number(el.getAttribute("data-sms-bar")) - now;
      el.style.width = Math.max(0, Math.min(100, left / 12)) + "%";
    });
    var up = root.document.querySelector("[data-sms-updated]");
    if (up && state.fetchedAt) up.textContent = tr("Updated {time}", { time: ago(state.fetchedAt / 1000) });
    if (expired && state.data && Array.isArray(state.data.orders)) {
      state.data.orders.forEach(function (o) { if (o.status === "waiting" && o.expiry && o.expiry <= now) o.status = "expired"; });
      repaint();
    }
  }

  function copy(text) {
    var done = function () {
      state.copied = text;
      try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(10); } catch (err) { /* no haptics */ }
      repaint();
      setTimeout(function () { if (state.copied === text) { state.copied = ""; repaint(); } }, 1600);
    };
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
        return;
      }
    } catch (err) { /* fall back */ }
    legacyCopy(text);
    done();
  }
  function legacyCopy(text) {
    try {
      var ta = root.document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      root.document.body.appendChild(ta);
      ta.select();
      root.document.execCommand("copy");
      ta.remove();
    } catch (err) { /* nothing to copy with */ }
  }

  if (root.document) {
    root.document.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-sms-copy],[data-sms-refresh],[data-sms-history]") : null;
      if (!t || !t.closest("[data-inbox-sms]")) return;
      ev.preventDefault();
      if (t.hasAttribute("data-sms-copy")) copy(t.getAttribute("data-sms-copy"));
      else if (t.hasAttribute("data-sms-history")) { state.history = true; fetchNow().then(schedule); }
      else fetchNow().then(schedule);
    });
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.hidden) { clearTimeout(state.timer); state.timer = 0; return; }
      if (onSection() && state.started && isOwner()) fetchNow().then(schedule);
    });
    root.addEventListener("hashchange", function () { if (!onSection()) stop(); });
  }

  var api = { page: page, _test: { ago: ago, clock: clock, phone: phone, spaced: spaced, plainCode: plainCode, orderCard: orderCard, rentalCard: rentalCard, state: state } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ViktorychInboxSms = api;
})(typeof window !== "undefined" ? window : globalThis);
