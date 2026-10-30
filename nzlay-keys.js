/* Settings > Connected keys > NZlay. Any user.
   NZlay has no official sign-in for other sites (no OAuth, no API), so this
   works like the local Discord key: the person signs in to their own NZlay
   account here, and the NZlay session cookie that comes back is kept only on
   this device, in IndexedDB, sealed with AES-GCM under a non-extractable
   device key. The password is sent once, to NZlay through our no-storage
   relay (NZlay sends no CORS headers, so a browser cannot reach it
   directly), and is never kept anywhere. The relay keeps and logs nothing.
   Posting: one tap is one post. Posts are at least 30 seconds apart and at
   most 10 an hour from this device; nothing posts on a timer or in bulk.
   If NZlay ever asks for a captcha, the person finishes on NZlay itself. */
(function (root) {
  "use strict";
  var DB_NAME = "viktorych-nzlay-local";
  var STORE = "kv";
  var OFF_KEY = "viktorychapp-server-off";
  var GUARD_KEY = "viktorych-nzlay-guard";
  var GAP_MS = 30 * 1000;
  var PER_HOUR = 10;
  var LOGIN_URL = "https://nzlay.com/login";
  var SIGNUP_URL = "https://nzlay.com/signup";

  var state = { loaded: false, has: false, me: null, savedAt: 0, busy: false, note: "", errors: [], captchaUrl: "", paste: false };

  function tr(key, vars) { return root.t ? root.t(key, vars) : String(key).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function serverOff(name) {
    try {
      var list = JSON.parse(root.localStorage.getItem(OFF_KEY) || "[]");
      return Array.isArray(list) && list.indexOf(name) >= 0;
    } catch (err) { return false; }
  }
  function enabled() { return !serverOff("nzlay_forum") && !serverOff("nzlay_forum_post"); }
  function rerender() {
    var c = root.ViktorychCommunities;
    if (c && typeof c.requestRender === "function") c.requestRender();
  }
  function toast(text) {
    var c = root.ViktorychCommunities;
    if (c && typeof c.toast === "function") c.toast(text);
  }

  /* ---------- storage: IndexedDB + WebCrypto ---------- */
  var dbOpen = null;
  function db() {
    if (dbOpen) return dbOpen;
    dbOpen = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("idb")); return; }
      var req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () {
        var d = req.result;
        d.onversionchange = function () { try { d.close(); } catch (e) { /* closing */ } dbOpen = null; };
        resolve(d);
      };
      req.onerror = function () { dbOpen = null; reject(req.error || new Error("idb")); };
    });
    return dbOpen;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, mode);
        var out = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error("idb")); };
      });
    });
  }
  function get(key) { return idb("readonly", function (s) { return s.get(key); }); }
  function put(key, value) { return idb("readwrite", function (s) { s.put(value, key); }); }
  function del(key) { return idb("readwrite", function (s) { s.delete(key); }); }
  function subtle() { return root.crypto && root.crypto.subtle ? root.crypto.subtle : null; }
  function deviceKey() {
    return get("device-key").then(function (key) {
      if (key) return key;
      if (!subtle()) throw new Error("crypto");
      return subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (made) {
        return put("device-key", made).then(function () { return made; });
      });
    });
  }
  function seal(text) {
    return deviceKey().then(function (key) {
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(text)).then(function (ct) {
        return { v: 1, iv: iv, ct: ct };
      });
    });
  }
  function unseal() {
    return Promise.all([get("session"), get("device-key")]).then(function (both) {
      var box = both[0];
      var key = both[1];
      if (!box || !key) return "";
      return subtle().decrypt({ name: "AES-GCM", iv: box.iv }, key, box.ct).then(function (plain) {
        return new TextDecoder().decode(plain);
      });
    }).catch(function () { return ""; });
  }
  function keep(session, me) {
    if (!session) return Promise.resolve();
    return seal(session).then(function (box) {
      return Promise.all([put("session", box), put("me", me || state.me || null), put("saved-at", Date.now())]);
    }).then(function () {
      state.has = true;
      if (me) state.me = me;
      state.savedAt = Date.now();
    });
  }
  function forget() {
    state.has = false;
    state.me = null;
    state.savedAt = 0;
    return Promise.all([del("session"), del("me"), del("saved-at")]).catch(function () { /* already gone */ });
  }

  var booting = null;
  function boot() {
    if (state.loaded) return Promise.resolve(state);
    if (booting) return booting;
    booting = Promise.all([get("session"), get("me"), get("saved-at")]).then(function (got) {
      state.has = !!got[0];
      state.me = got[1] || null;
      state.savedAt = Number(got[2]) || 0;
    }).catch(function () { /* no IndexedDB: signed out */ }).then(function () {
      state.loaded = true;
      booting = null;
      return state;
    });
    return booting;
  }

  /* ---------- relay ---------- */
  function relay(path, body) {
    var a = root.ViktorychAccounts;
    if (!a || typeof a.call !== "function") return Promise.resolve({ status: 0 });
    return Promise.resolve(a.call("/v1/nzlay/relay/" + path, { method: "POST", body: body })).catch(function () { return { status: 0 }; });
  }

  function guard() {
    var now = Date.now();
    var list = [];
    try { list = JSON.parse(root.localStorage.getItem(GUARD_KEY) || "[]"); } catch (err) { list = []; }
    list = (Array.isArray(list) ? list : []).filter(function (t) { return typeof t === "number" && now - t < 60 * 60 * 1000; });
    var last = list.length ? list[list.length - 1] : 0;
    if (last && now - last < GAP_MS) return { ok: false, wait: Math.ceil((GAP_MS - (now - last)) / 1000) };
    if (list.length >= PER_HOUR) return { ok: false, wait: Math.ceil((60 * 60 * 1000 - (now - list[0])) / 1000) };
    return { ok: true, list: list };
  }
  function noteSend(list) {
    list.push(Date.now());
    try { root.localStorage.setItem(GUARD_KEY, JSON.stringify(list.slice(-PER_HOUR))); } catch (err) { /* private mode */ }
  }

  function signIn(email, password) {
    if (!enabled()) return Promise.resolve({ result: "off" });
    state.busy = true;
    state.errors = [];
    state.captchaUrl = "";
    state.note = "";
    return relay("login", { email: email, password: password }).then(function (res) {
      state.busy = false;
      if (res && res.ok && res.session) {
        return keep(res.session, res.viewer || null).then(function () {
          state.note = tr("Signed in to NZlay.");
          return { result: "signed_in" };
        });
      }
      var result = (res && res.result) || (res && res.status === 429 ? "limited" : "error");
      if (result === "captcha") state.captchaUrl = res.url || LOGIN_URL;
      else if (result === "rejected") state.errors = (res.errors && res.errors.length ? res.errors : [tr("NZlay didn’t accept that email and password.")]);
      else if (result === "limited") state.errors = [tr("Too many tries. Wait a little and try again.")];
      else state.errors = [tr("Couldn’t reach NZlay. Try again.")];
      return { result: result };
    });
  }
  function usePasted(raw) {
    var value = String(raw || "").trim().replace(/^cookie:\s*/i, "");
    if (/^[A-Za-z0-9,\-]{8,128}$/.test(value)) value = "PHPSESSID=" + value;
    if (!/^[A-Za-z0-9_\-.]{1,64}=[^;\s,]{1,512}(;\s*[A-Za-z0-9_\-.]{1,64}=[^;\s,]{0,512})*$/.test(value)) {
      state.errors = [tr("That doesn’t look like an NZlay session.")];
      return Promise.resolve({ result: "bad" });
    }
    state.busy = true;
    state.errors = [];
    return relay("me", { session: value }).then(function (res) {
      state.busy = false;
      if (res && res.ok) return keep(res.session || value, res.viewer || null).then(function () { state.paste = false; state.note = tr("Signed in to NZlay."); return { result: "signed_in" }; });
      state.errors = [tr("NZlay says that session is signed out.")];
      return { result: "needs_login" };
    });
  }
  function signOut() {
    return unseal().then(function (session) {
      if (session) relay("logout", { session: session });
      return forget();
    }).then(function () { state.note = tr("Signed out of NZlay on this device."); });
  }
  function check() {
    return unseal().then(function (session) {
      if (!session) return { result: "needs_login" };
      return relay("me", { session: session }).then(function (res) {
        if (res && res.ok) return keep(res.session || session, res.viewer || state.me).then(function () { return { result: "signed_in" }; });
        if (res && res.result === "needs_login") return forget().then(function () { return { result: "needs_login" }; });
        return { result: "error" };
      });
    });
  }

  /* One post from one tap. kind is "reply" or "topic". */
  function post(kind, payload) {
    if (!enabled()) return Promise.resolve({ result: "off" });
    var g = guard();
    if (!g.ok) return Promise.resolve({ result: "wait", wait: g.wait });
    return unseal().then(function (session) {
      if (!session) return { result: "needs_login" };
      var body = {};
      Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
      body.session = session;
      noteSend(g.list);
      return relay(kind === "topic" ? "topic" : "reply", body).then(function (res) {
        if (res && res.ok) {
          if (res.session && res.session !== session) keep(res.session, state.me);
          return { result: "posted", postId: res.postId || 0, url: res.url || "" };
        }
        var result = (res && res.result) || (res && res.status === 429 ? "limited" : "error");
        if (result === "needs_login") forget();
        return { result: result, url: (res && res.url) || "", errors: (res && res.errors) || [] };
      });
    });
  }

  /* ---------- Connected keys UI ---------- */
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2h11A2.5 2.5 0 0 1 20 4.5v9a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4h.5A2.5 2.5 0 0 1 4 13.5zM6.5 4a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H8v1.84L10.3 14h7.2a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5z"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.586 12L7.543 4.96l1.414-1.42L17.414 12l-8.457 8.46-1.414-1.42z"/></svg>';
  function statusHtml() {
    if (!state.loaded) return "";
    return state.has
      ? '<span class="xk-status ok"><i></i>' + esc(state.me && state.me.name ? tr("Signed in as {name}", { name: state.me.name }) : tr("Signed in")) + "</span>"
      : '<span class="xk-status off"><i></i>' + esc(tr("Not signed in")) + "</span>";
  }
  function rowsHtml() {
    if (!enabled()) return "";
    return '<a class="xk-row" href="#/settings/keys/nzlay" data-nzk-row><span class="xk-ico">' + ICON + '</span><span class="xk-copy"><b>' + esc(tr("NZlay forum")) + '</b><span class="xk-sub">' + esc(tr("Post and reply in the NZlay community. Stays on this device.")) + '</span><span class="xk-line" data-nzk-status>' + statusHtml() + '</span></span><span class="xk-chev">' + CHEV + "</span></a>";
  }
  function sectionHtml() {
    if (!enabled()) return "";
    boot().then(paint);
    return '<section class="xk-group nzk-group" data-xk-group="nzlay"><h2 class="xk-h2">' + esc(tr("NZlay")) + '</h2><p class="xk-desc">' + esc(tr("Stays in this browser only. Our servers never keep it.")) + "</p>" + rowsHtml() + "</section>";
  }
  function paint() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("[data-nzk-status]").forEach(function (el) { el.innerHTML = statusHtml(); });
    var box = document.getElementById("nzk-detail");
    if (box) box.innerHTML = detailInner();
  }
  function detailHtml() {
    boot().then(paint);
    return '<div class="xk nzk" id="nzk-detail">' + detailInner() + "</div>";
  }
  function errorsHtml() {
    return state.errors.length ? '<div class="nzk-errors" role="alert">' + state.errors.map(function (e) { return "<p>" + esc(e) + "</p>"; }).join("") + "</div>" : "";
  }
  function detailInner() {
    if (!enabled()) return '<p class="xk-desc">' + esc(tr("NZlay sign-in is turned off.")) + "</p>";
    var how = '<p class="xk-desc">' + esc(tr("NZlay has no sign-in for other apps, so you sign in with your NZlay email and password here. Your password goes once to NZlay and is never kept. The NZlay session that comes back is encrypted and kept only in this browser. Posts go out only when you tap Post or Reply.")) + "</p>";
    if (!state.loaded) return how + '<p class="xk-desc">' + esc(tr("Loading")) + "</p>";
    var note = state.note ? '<p class="xk-note" role="status">' + esc(state.note) + "</p>" : "";
    if (state.has) {
      return how + note +
        '<section class="xk-group"><div class="xk-row"><span class="xk-ico">' + ICON + '</span><span class="xk-copy"><b>' + esc(state.me && state.me.name ? state.me.name : tr("NZlay account")) + '</b><span class="xk-line">' + statusHtml() + "</span>" +
        (state.savedAt ? '<span class="xk-sub">' + esc(tr("Saved {date}", { date: new Date(state.savedAt).toLocaleDateString() })) + "</span>" : "") + "</span></div>" +
        '<div class="xk-actions nzk-actions"><a class="xk-pill outline" href="#/communities/nzlay">' + esc(tr("Open the forum")) + '</a><button type="button" class="xk-pill outline" data-nzk="check"' + (state.busy ? " disabled" : "") + ">" + esc(tr("Check")) + '</button><button type="button" class="xk-text danger" data-nzk="signout">' + esc(tr("Sign out")) + "</button></div></section>";
    }
    var captcha = state.captchaUrl
      ? '<div class="nzk-captcha" role="alert"><p>' + esc(tr("NZlay wants to check that you’re a person. Sign in on NZlay, solve its check there, then come back and paste your session below.")) + '</p><a class="xk-pill primary" href="' + esc(state.captchaUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open NZlay")) + "</a></div>"
      : "";
    return how + note + captcha +
      '<form class="nzk-form" data-nzk-form="login" autocomplete="on">' +
        '<label class="nzk-field"><span>' + esc(tr("Email")) + '</span><input type="email" name="email" autocomplete="username" required maxlength="200" inputmode="email"></label>' +
        '<label class="nzk-field"><span>' + esc(tr("Password")) + '</span><input type="password" name="password" autocomplete="current-password" required maxlength="200"></label>' +
        errorsHtml() +
        '<button type="submit" class="xk-pill primary wide"' + (state.busy ? " disabled" : "") + ">" + esc(state.busy ? tr("Signing in…") : tr("Sign in to NZlay")) + "</button>" +
        '<p class="xk-desc nzk-small">' + esc(tr("No NZlay account?")) + ' <a href="' + SIGNUP_URL + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Sign up on NZlay")) + "</a></p>" +
      "</form>" +
      '<details class="nzk-paste"' + (state.paste || state.captchaUrl ? " open" : "") + '><summary>' + esc(tr("Use a session from your browser")) + "</summary>" +
        '<p class="xk-desc">' + esc(tr("Signed in on nzlay.com already? Paste its PHPSESSID cookie value here. It is checked with NZlay and then kept only on this device.")) + "</p>" +
        '<form class="nzk-form" data-nzk-form="paste" autocomplete="off"><label class="nzk-field"><span>' + esc(tr("Session")) + '</span><input type="password" name="session" autocomplete="off" spellcheck="false" maxlength="2000"></label>' +
        '<button type="submit" class="xk-pill outline"' + (state.busy ? " disabled" : "") + ">" + esc(tr("Use this session")) + "</button></form>" +
      "</details>";
  }

  if (typeof document !== "undefined") {
    document.addEventListener("submit", function (event) {
      var form = event.target && event.target.closest ? event.target.closest("[data-nzk-form]") : null;
      if (!form) return;
      event.preventDefault();
      if (state.busy) return;
      var kind = form.getAttribute("data-nzk-form");
      var done = function () { paint(); rerender(); };
      if (kind === "login") {
        var email = form.elements.email.value;
        var password = form.elements.password.value;
        form.elements.password.value = "";
        paint();
        signIn(email, password).then(done);
        password = "";
      } else if (kind === "paste") {
        var raw = form.elements.session.value;
        form.elements.session.value = "";
        usePasted(raw).then(done);
      }
    });
    document.addEventListener("click", function (event) {
      var btn = event.target && event.target.closest ? event.target.closest("[data-nzk]") : null;
      if (!btn) return;
      var what = btn.getAttribute("data-nzk");
      if (what === "signout") { event.preventDefault(); signOut().then(function () { paint(); rerender(); }); }
      if (what === "check") {
        event.preventDefault();
        state.busy = true;
        paint();
        check().then(function (r) {
          state.busy = false;
          state.note = r.result === "signed_in" ? tr("Still signed in to NZlay.") : r.result === "needs_login" ? tr("NZlay signed you out. Sign in again.") : tr("Couldn’t reach NZlay. Try again.");
          paint();
        });
      }
    });
  }

  root.NzlayKeys = {
    boot: boot,
    enabled: enabled,
    signedIn: function () { return state.loaded && state.has; },
    me: function () { return state.me; },
    signIn: signIn,
    signOut: signOut,
    post: post,
    guard: function () { var g = guard(); return { ok: g.ok, wait: g.wait || 0 }; },
    rowsHtml: rowsHtml,
    sectionHtml: sectionHtml,
    detailHtml: detailHtml,
    titleFor: function () { return tr("NZlay forum"); },
    toast: toast,
    _state: state
  };
})(typeof window !== "undefined" ? window : this);
