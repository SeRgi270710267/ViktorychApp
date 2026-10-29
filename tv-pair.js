/* Sign in with your phone. The TV shows a big QR code and a 6-character
   code. The QR opens viktorychapp.pages.dev/p/CODE on the phone: a phone
   that is signed in confirms with one tap; a phone that is not signs in or
   signs up first and the TV is signed in right after, with no extra step.
   The TV checks back every few seconds while it is on screen and gets a
   session of its own. Codes last ten minutes, work once and renew by
   themselves on the TV. The code and the TV's secret stay in memory only:
   never logged, never saved, never put in a link. */
(function (root) {
  "use strict";

  var AUTO_RENEWS = 3;
  var DONE_PAUSE_MS = 1400;

  function tr(key, vars) {
    var fn = root.t || null;
    if (fn) return fn(key, vars);
    return String(key).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function short() { return root.ViktorychShort || null; }
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function cleanCode(value) {
    var s = short();
    if (s) return s.cleanCode(value);
    var text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (text.length !== 6) return "";
    for (var i = 0; i < text.length; i++) if (ALPHABET.indexOf(text.charAt(i)) < 0) return "";
    return text;
  }
  function spaced(code) { return code ? code.slice(0, 3) + " " + code.slice(3) : ""; }
  function accounts() { return root.ViktorychAccounts || null; }
  function call(path, opts) {
    var a = accounts();
    if (!a || !a.call) return Promise.reject(new Error("offline"));
    return a.call(path, opts);
  }
  function appBase() {
    var loc = root.location;
    return loc.origin + loc.pathname;
  }
  // What the QR opens: the short address, so the code is big and easy to scan.
  function linkUrl(code) {
    var s = short();
    return s ? s.pairUrl(code) : appBase() + "#/link-tv?code=" + code;
  }
  function typeAddress() {
    var s = short();
    return s ? s.display("/tv") : "";
  }
  function qrSvg(text) {
    var make = root.qrcode;
    if (typeof make !== "function") return "";
    try {
      var qr = make(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
    } catch (err) { return ""; }
  }
  function appName() {
    var api = root.SI18n;
    return (api && api.productName) ? api.productName("app") || "" : "";
  }

  /* X-style outline icons: one colour (currentColor), 24px grid. */
  var ICONS = {
    camera: '<path d="M8.6 4h6.8l1.5 2H20c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2h3.1l1.5-2zm.9 1.8L8 7.8H4c-.1 0-.2.1-.2.2v10c0 .1.1.2.2.2h16c.1 0 .2-.1.2-.2V8c0-.1-.1-.2-.2-.2h-4l-1.5-2h-5zM12 9.3c2 0 3.7 1.7 3.7 3.7S14 16.7 12 16.7 8.3 15 8.3 13 10 9.3 12 9.3zm0 1.8c-1.1 0-1.9.8-1.9 1.9s.8 1.9 1.9 1.9 1.9-.8 1.9-1.9-.8-1.9-1.9-1.9z"/>',
    phone: '<path d="M8 2h8c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2zm0 1.8c-.1 0-.2.1-.2.2v16c0 .1.1.2.2.2h8c.1 0 .2-.1.2-.2V4c0-.1-.1-.2-.2-.2H8zm2.5 13.4h3V19h-3v-1.8z"/>',
    tv: '<path d="M4 4h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-7.1v1.2H17V21H7v-1.8h4.1V18H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm0 1.8c-.1 0-.2.1-.2.2v10c0 .1.1.2.2.2h16c.1 0 .2-.1.2-.2V6c0-.1-.1-.2-.2-.2H4z"/>',
    check: '<path d="M12 1.8C17.6 1.8 22.2 6.4 22.2 12S17.6 22.2 12 22.2 1.8 17.6 1.8 12 6.4 1.8 12 1.8zm0 1.8c-4.6 0-8.4 3.8-8.4 8.4s3.8 8.4 8.4 8.4 8.4-3.8 8.4-8.4-3.8-8.4-8.4-8.4zm4.2 4.6 1.3 1.3-7 7-4-4 1.3-1.3 2.7 2.7 5.7-5.7z"/>',
    clock: '<path d="M12 1.8C17.6 1.8 22.2 6.4 22.2 12S17.6 22.2 12 22.2 1.8 17.6 1.8 12 6.4 1.8 12 1.8zm0 1.8c-4.6 0-8.4 3.8-8.4 8.4s3.8 8.4 8.4 8.4 8.4-3.8 8.4-8.4-3.8-8.4-8.4-8.4zm.9 3.4v4.6l3.4 2-.9 1.6-4.3-2.5V7h1.8z"/>',
    alert: '<path d="M12 1.8C17.6 1.8 22.2 6.4 22.2 12S17.6 22.2 12 22.2 1.8 17.6 1.8 12 6.4 1.8 12 1.8zm0 1.8c-4.6 0-8.4 3.8-8.4 8.4s3.8 8.4 8.4 8.4 8.4-3.8 8.4-8.4-3.8-8.4-8.4-8.4zM11.1 7h1.8v6.5h-1.8V7zm0 8.2h1.8V17h-1.8v-1.8z"/>'
  };
  function icon(name, cls) {
    return '<svg class="tvp-ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + (ICONS[name] || "") + "</svg>";
  }

  /* ---- TV side ---- */
  var tv = { phase: "idle", code: "", poll: "", until: 0, timer: 0, tick: 0, wait: 4000, gen: 0, renews: 0, renewed: false, name: "" };

  function tvHost() { return root.document.getElementById("tvpair-body"); }
  function leftText() {
    var ms = Math.max(0, tv.until - Date.now());
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    return tr("Code expires in {time}", { time: m + ":" + (s < 10 ? "0" : "") + s });
  }
  function tvInner() {
    if (tv.phase === "code") {
      var svg = qrSvg(linkUrl(tv.code));
      var where = typeAddress();
      return '<div class="tvp-wrap tvp-in" data-tvp-phase="code">' +
        (svg ? '<div class="tvp-qr" role="img" aria-label="' + esc(tr("QR code to sign in this TV")) + '">' + svg + "</div>" : "") +
        '<div class="tvp-side">' +
          '<ol class="tvp-steps">' +
            "<li>" + icon("camera") + "<span>" + esc(tr("Scan the QR code with your phone's camera.")) + "</span></li>" +
            "<li>" + icon("phone") + "<span>" + (where
              ? esc(tr("Or go to {address} on your phone and enter this code:", { address: "\u0001" })).replace("\u0001", '<b class="tvp-url" data-tvp-url>' + esc(where) + "</b>")
              : esc(tr("Or open {app} on your phone, go to Settings, then Link a TV, and enter this code:", { app: appName() }))) + "</span></li>" +
          "</ol>" +
          '<p class="tvp-code" data-tvp-code aria-label="' + esc(tr("Code")) + '">' + esc(spaced(tv.code)) + "</p>" +
          '<p class="tvp-wait" role="status" aria-live="polite"><span class="tvp-pulse" aria-hidden="true"></span>' + esc(tv.renewed ? tr("New code. Waiting for your phone…") : tr("Waiting for your phone…")) + "</p>" +
          '<p class="tvp-note">' + icon("clock", "sm") + '<span data-tvp-left>' + esc(leftText()) + "</span></p>" +
        "</div></div>";
    }
    if (tv.phase === "expired" || tv.phase === "error") {
      return '<div class="tvp-state tvp-in" data-tvp-phase="' + tv.phase + '">' + icon(tv.phase === "expired" ? "clock" : "alert", "lg") +
        '<p class="tvp-wait" role="status">' + esc(tv.phase === "expired" ? tr("This code expired.") : tr("Could not reach the server. Check the TV's internet connection.")) + "</p>" +
        '<button class="acct-next tvp-again" type="button" data-tvpair="again">' + esc(tr("Get a new code")) + "</button></div>";
    }
    if (tv.phase === "done") {
      return '<div class="tvp-state tvp-ok tvp-in" data-tvp-phase="done">' + icon("check", "lg") +
        '<p class="tvp-big" role="status">' + esc(tv.name ? tr("Signed in as {name}", { name: tv.name }) : tr("Signed in")) + "</p>" +
        '<p class="tvp-note">' + esc(tr("Opening your timeline…")) + "</p></div>";
    }
    return '<div class="tvp-state" data-tvp-phase="loading"><span class="tvp-spin" aria-hidden="true"></span><p class="tvp-wait" role="status">' + esc(tr("Loading…")) + "</p></div>";
  }
  function tvPaint() {
    var host = tvHost();
    if (!host) return;
    var had = host.contains(root.document.activeElement);
    host.innerHTML = tvInner();
    if (had || tv.phase === "expired" || tv.phase === "error") {
      var btn = host.querySelector("button");
      if (btn) try { btn.focus(); } catch (err) { /* older TV browser */ }
    }
  }
  function tvBody() {
    return '<p class="acct-sub">' + esc(tr("Use your phone. Nothing to type on the TV.")) + '</p><div id="tvpair-body" class="tvp">' + tvInner() + "</div>";
  }
  function clearTimer() {
    if (tv.timer) { clearTimeout(tv.timer); tv.timer = 0; }
    if (tv.tick) { clearInterval(tv.tick); tv.tick = 0; }
  }
  function tvStop() {
    clearTimer();
    tv.gen += 1;
    tv.phase = "idle";
    tv.code = "";
    tv.poll = "";
    tv.renews = 0;
    tv.renewed = false;
  }
  function tvStart(opts) {
    var renew = !!(opts && opts.renew);
    var count = renew ? tv.renews + 1 : 0;
    tvStop();
    tv.renews = count;
    tv.renewed = renew;
    var gen = tv.gen;
    // A renewal keeps the old code on screen until the new one is ready.
    if (!renew) { tv.phase = "loading"; tvPaint(); }
    call("/v1/tv-pair/start", { method: "POST", body: {} }).then(function (res) {
      if (gen !== tv.gen) return;
      if (!res || res.status !== 200 || !res.code || !res.poll) {
        tv.phase = res && res.status === 429 ? "expired" : "error";
        tvPaint();
        return;
      }
      tv.code = cleanCode(res.code);
      tv.poll = String(res.poll);
      tv.until = Date.now() + (Number(res.expiresIn) || 600) * 1000;
      tv.wait = Math.max(3, Number(res.interval) || 4) * 1000;
      tv.phase = "code";
      tvPaint();
      tv.tick = setInterval(function () {
        var el = root.document.querySelector("[data-tvp-left]");
        if (!el || gen !== tv.gen) return;
        el.textContent = leftText();
        if (Date.now() > tv.until) check(gen);
      }, 1000);
      schedule(gen);
    }, function () {
      if (gen !== tv.gen) return;
      tv.phase = "error";
      tvPaint();
    });
  }
  function schedule(gen, delay) {
    if (tv.timer) { clearTimeout(tv.timer); tv.timer = 0; }
    tv.timer = setTimeout(function () { check(gen); }, delay || tv.wait);
  }
  function expire(gen) {
    if (gen !== tv.gen) return;
    tv.poll = "";
    // Renew by itself a few times (30 minutes on screen), then wait for OK.
    if (tv.renews < AUTO_RENEWS && !root.document.hidden) { tvStart({ renew: true }); return; }
    clearTimer();
    tv.phase = "expired";
    tvPaint();
  }
  function check(gen) {
    if (gen !== tv.gen || tv.phase !== "code") return;
    if (!tvHost()) { tvStop(); return; }
    if (Date.now() > tv.until) { expire(gen); return; }
    // Sparse: no checks while the page is hidden.
    if (root.document.hidden) { schedule(gen, tv.wait * 2); return; }
    if (tv.busy) return;
    tv.busy = true;
    call("/v1/tv-pair/poll", { method: "POST", body: { poll: tv.poll } }).then(function (res) {
      tv.busy = false;
      if (gen !== tv.gen) return;
      if (res && res.status === 200 && res.token) {
        clearTimer();
        var account = res.account || {};
        tv.phase = "done";
        tv.poll = "";
        tv.code = "";
        tv.name = String(account.displayName || account.name || "");
        tvPaint();
        var token = res.token;
        // A short pause so the success screen is seen, then the timeline.
        setTimeout(function () {
          var a = accounts();
          if (a && a.commitTvSession) a.commitTvSession(token, account);
          token = "";
        }, DONE_PAUSE_MS);
        return;
      }
      if (res && (res.status === 410 || res.status === 400)) { expire(gen); return; }
      schedule(gen, res && res.status === 429 ? tv.wait * 4 : tv.wait);
    }, function () {
      tv.busy = false;
      if (gen === tv.gen) schedule(gen, tv.wait * 2);
    });
  }

  /* ---- Phone side: #/link-tv (also /p/CODE and /tv on the short address) ---- */
  var phone = { busy: false, msg: "", ok: false, bad: false, auto: "" };
  function signedIn() {
    var a = accounts();
    return !!(a && a.token && a.token());
  }
  function me() {
    var a = accounts();
    return a && a.account ? a.account() : null;
  }
  function otherLink(code) {
    var s = short();
    if (!s) return "";
    return s.otherBase() + "#/link-tv" + (code ? "?code=" + code : "");
  }
  function head() {
    return '<div class="topbar tall"><div class="page-head">' +
      '<button class="icon-btn" data-act="back" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 11 13.2 5.2 11.8 3.8 3.6 12l8.2 8.2 1.4-1.4L7.4 13H20v-2z"/></svg></button>' +
      '<div class="head-text grow"><h1>' + esc(tr("Link a TV")) + "</h1></div></div></div>";
  }
  function linkPage(route) {
    var pre = route && route.query && route.query.get ? cleanCode(route.query.get("code")) : "";
    var s = short();
    if (!signedIn()) {
      if (s && pre) s.markPairAuth(pre);
      var other = otherLink(pre);
      return head() + '<div class="tvp-phone tvp-in">' + icon("tv", "hero") +
        '<h2 class="tvp-title">' + esc(tr("Sign in on your TV")) + "</h2>" +
        (pre ? '<p class="tvp-code sm">' + esc(spaced(pre)) + "</p>" : "") +
        '<p class="tvp-lead">' + esc(tr("Log in or create an account on this phone. Your TV signs in right after.")) + "</p>" +
        '<div class="tvp-col"><button class="tvp-btn primary" type="button" data-tvpair="login">' + esc(tr("Log in")) + "</button>" +
        '<button class="tvp-btn" type="button" data-tvpair="signup">' + esc(tr("Create account")) + "</button></div>" +
        (other ? '<p class="tvp-note"><a class="tvp-alt" href="' + esc(other) + '">' + esc(tr("Already signed in at the other address? Continue there")) + "</a></p>" : "") +
        "</div>";
    }
    if (phone.ok) {
      return head() + '<div class="tvp-phone tvp-in" data-tvp-phone="done">' + icon("check", "hero ok") +
        '<h2 class="tvp-title">' + esc(tr("Your TV is signing in")) + "</h2>" +
        '<p class="tvp-lead">' + esc(tr("It takes a few seconds. The TV shows up in My devices, where you can remove it at any time.")) + "</p>" +
        '<div class="tvp-col"><a class="tvp-btn" href="#/settings/devices">' + esc(tr("My devices")) + '</a><a class="tvp-btn" href="#/home">' + esc(tr("Done")) + "</a></div></div>";
    }
    // Back from sign-in or sign-up with a code: finish without another tap.
    if (pre && s && s.takeAutoPair(pre) && !phone.busy && phone.auto !== pre) {
      phone.auto = pre;
      setTimeout(function () { approveCode(pre); }, 0);
    }
    if (pre) {
      var who = me();
      var name = who ? (who.displayName || (who.handle ? "@" + who.handle : "")) : "";
      return head() + '<div class="tvp-phone tvp-in" data-tvp-phone="confirm">' + icon("tv", "hero") +
        '<h2 class="tvp-title">' + esc(tr("Sign in on your TV?")) + "</h2>" +
        '<p class="tvp-code sm" data-tvp-code>' + esc(spaced(pre)) + "</p>" +
        '<p class="tvp-lead">' + esc(name ? tr("Check that this code is on your TV. It signs in as {name}.", { name: name }) : tr("Check that this code is on your TV.")) + "</p>" +
        '<div class="tvp-col"><button class="tvp-btn primary" type="button" data-tvpair="confirm" data-code="' + esc(pre) + '"' + (phone.busy ? ' disabled aria-busy="true"' : "") + ">" + esc(phone.busy ? tr("Loading…") : tr("Sign in on TV")) + "</button>" +
        '<a class="tvp-btn" href="#/home">' + esc(tr("Not now")) + "</a></div>" +
        '<p class="tvp-status' + (phone.bad ? " bad" : "") + '" role="status" aria-live="polite">' + esc(phone.msg) + "</p>" +
        '<p class="tvp-warn">' + esc(tr("Only link a TV you can see in front of you. Anyone using that TV can use your account until you remove it in My devices.")) + "</p>" +
        "</div>";
    }
    return head() + '<div class="tvp-phone tvp-in">' + icon("tv", "hero") +
      '<h2 class="tvp-title">' + esc(tr("Enter the code from your TV")) + "</h2>" +
      '<p class="tvp-lead">' + esc(tr("On the TV, choose Sign in with your phone. Scan the QR code with this phone's camera, or type the code here.")) + "</p>" +
      '<form class="tvp-form" data-tvpair-form autocomplete="off">' +
        '<label class="tvp-label" for="tvp-code">' + esc(tr("Code on the TV")) + "</label>" +
        '<input id="tvp-code" class="tvp-input" name="code" inputmode="text" autocapitalize="characters" autocomplete="one-time-code" spellcheck="false" maxlength="7" placeholder="ABC 234" value="">' +
        '<button class="tvp-btn primary" type="submit"' + (phone.busy ? " disabled aria-busy=\"true\"" : "") + ">" + esc(phone.busy ? tr("Loading…") : tr("Sign in on TV")) + "</button>" +
        '<p class="tvp-status' + (phone.bad ? " bad" : "") + '" role="status" aria-live="polite">' + esc(phone.msg) + "</p>" +
        '<p class="tvp-warn">' + esc(tr("Only link a TV you can see in front of you. Anyone using that TV can use your account until you remove it in My devices.")) + "</p>" +
      "</form></div>";
  }
  function rerender() {
    if (typeof root.dispatchEvent === "function") {
      try { root.dispatchEvent(new CustomEvent("vklazy", { detail: { name: "tvpair" } })); } catch (err) { /* old browser */ }
    }
  }
  function approveCode(code) {
    if (phone.busy) return;
    if (!code) {
      phone.msg = tr("Codes are 6 letters and numbers.");
      phone.bad = true;
      rerender();
      return;
    }
    var a = accounts();
    var token = a && a.token ? a.token() : "";
    phone.busy = true;
    phone.msg = "";
    phone.bad = false;
    rerender();
    call("/v1/tv-pair/approve", { method: "POST", body: { code: code }, token: token }).then(function (res) {
      phone.busy = false;
      if (res && res.status === 200) {
        phone.ok = true;
        var s = short();
        if (s) s.clearPair();
        try { if (root.history && root.history.replaceState) root.history.replaceState(null, "", "#/link-tv"); } catch (err) { /* keep the hash */ }
      } else {
        phone.bad = true;
        phone.msg = res && res.status === 429 ? tr("Too many attempts. Try again later.") : (res && res.status === 401 ? tr("Sign in on this phone first, then open this page again to link the TV.") : tr("That code didn't work. Check the TV, or get a new code there."));
      }
      rerender();
    }, function () {
      phone.busy = false;
      phone.bad = true;
      phone.msg = tr("Could not reach the server. Try again.");
      rerender();
    });
  }
  function approve(form) {
    var input = form.querySelector("input[name=code]");
    approveCode(cleanCode(input ? input.value : ""));
  }
  function reset() { phone.busy = false; phone.msg = ""; phone.ok = false; phone.bad = false; }

  if (root.document) {
    root.document.addEventListener("submit", function (event) {
      var form = event.target && event.target.closest ? event.target.closest("[data-tvpair-form]") : null;
      if (!form) return;
      event.preventDefault();
      approve(form);
    }, true);
    root.document.addEventListener("click", function (event) {
      var btn = event.target && event.target.closest ? event.target.closest("[data-tvpair]") : null;
      if (!btn) return;
      event.preventDefault();
      var act = btn.getAttribute("data-tvpair");
      var a = accounts();
      if (act === "again") tvStart();
      else if (act === "confirm") approveCode(cleanCode(btn.getAttribute("data-code")));
      if (act === "login" || act === "signup") {
        // Come back to this code after signing in.
        try { root.sessionStorage.setItem("viktorychapp-return-v1", String(root.location.hash || "#/link-tv")); } catch (err) { /* home after sign-in */ }
      }
      if (act === "login" && a && a.openLogin) a.openLogin();
      else if (act === "signup" && a && a.openSignupSetup) a.openSignupSetup();
    });
    root.addEventListener("hashchange", function () {
      if (String(root.location.hash || "").indexOf("#/link-tv") !== 0) reset();
    });
  }

  root.ViktorychTVPair = {
    tvBody: tvBody,
    tvStart: tvStart,
    tvStop: tvStop,
    linkPage: linkPage,
    page: linkPage,
    cleanCode: cleanCode,
    linkUrl: linkUrl,
    state: function () { return { phase: tv.phase, code: tv.code, renews: tv.renews, until: tv.until }; }
  };
})(typeof window !== "undefined" ? window : this);
