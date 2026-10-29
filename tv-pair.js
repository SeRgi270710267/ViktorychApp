/* Sign in with your phone. The TV shows a QR code and a 6-character code;
   a phone that is already signed in opens #/link-tv, checks the code and
   approves it. The TV checks back every few seconds while it is on screen
   and gets a session of its own. Codes last five minutes and work once.
   The code and the TV's secret stay in memory only: never logged, never saved. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = root.t || null;
    return fn ? fn(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function cleanCode(value) {
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
  function linkUrl(code) { return appBase() + "#/link-tv?code=" + code; }
  function qrSvg(text) {
    var make = root.qrcode;
    if (typeof make !== "function") return "";
    try {
      var qr = make(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch (err) { return ""; }
  }

  /* ---- TV side ---- */
  var tv = { phase: "idle", code: "", poll: "", until: 0, timer: 0, wait: 5000, gen: 0 };

  function tvHost() { return root.document.getElementById("tvpair-body"); }
  function tvInner() {
    if (tv.phase === "code") {
      var svg = qrSvg(linkUrl(tv.code));
      return '<div class="tvp-wrap">' +
        (svg ? '<div class="tvp-qr" role="img" aria-label="' + esc(tr("QR code to sign in this TV")) + '">' + svg + "</div>" : "") +
        '<div class="tvp-side">' +
          '<ol class="tvp-steps">' +
            "<li>" + esc(tr("On your phone, scan the QR code with the camera.")) + "</li>" +
            "<li>" + esc(tr("Or open {app} on your phone, go to Settings, then Link a TV, and enter this code:", { app: appName() })) + "</li>" +
          "</ol>" +
          '<p class="tvp-code" aria-label="' + esc(tr("Code")) + '">' + esc(spaced(tv.code)) + "</p>" +
          '<p class="tvp-wait" role="status" aria-live="polite">' + esc(tr("Waiting for your phone…")) + "</p>" +
          '<p class="tvp-note">' + esc(tr("The code works once and expires in 5 minutes.")) + "</p>" +
        "</div></div>";
    }
    if (tv.phase === "expired" || tv.phase === "error") {
      return '<p class="tvp-wait" role="status">' + esc(tv.phase === "expired" ? tr("This code expired.") : tr("Could not reach the server. Check the TV's internet connection.")) + "</p>" +
        '<button class="acct-next" type="button" data-tvpair="again">' + esc(tr("Get a new code")) + "</button>";
    }
    if (tv.phase === "done") return '<p class="tvp-wait" role="status">' + esc(tr("Signed in. Opening your timeline…")) + "</p>";
    return '<p class="tvp-wait" role="status">' + esc(tr("Loading…")) + "</p>";
  }
  function appName() {
    var api = root.SI18n;
    return (api && api.productName) ? api.productName("app") || "" : "";
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
    return '<p class="acct-sub">' + esc(tr("Use a phone that is already signed in. Nothing to type on the TV.")) + '</p><div id="tvpair-body" class="tvp">' + tvInner() + "</div>";
  }
  function clearTimer() { if (tv.timer) { clearTimeout(tv.timer); tv.timer = 0; } }
  function tvStop() {
    clearTimer();
    tv.gen += 1;
    tv.phase = "idle";
    tv.code = "";
    tv.poll = "";
  }
  function tvStart() {
    tvStop();
    var gen = tv.gen;
    tv.phase = "loading";
    tvPaint();
    call("/v1/tv-pair/start", { method: "POST", body: {} }).then(function (res) {
      if (gen !== tv.gen) return;
      if (!res || res.status !== 200 || !res.code || !res.poll) {
        tv.phase = "error";
        tvPaint();
        return;
      }
      tv.code = cleanCode(res.code);
      tv.poll = String(res.poll);
      tv.until = Date.now() + (Number(res.expiresIn) || 300) * 1000;
      tv.wait = Math.max(4, Number(res.interval) || 5) * 1000;
      tv.phase = "code";
      tvPaint();
      schedule(gen);
    }, function () {
      if (gen !== tv.gen) return;
      tv.phase = "error";
      tvPaint();
    });
  }
  function schedule(gen, delay) {
    clearTimer();
    tv.timer = setTimeout(function () { check(gen); }, delay || tv.wait);
  }
  function check(gen) {
    if (gen !== tv.gen || tv.phase !== "code") return;
    if (!tvHost()) { tvStop(); return; }
    if (Date.now() > tv.until) {
      tv.phase = "expired";
      tv.poll = "";
      tvPaint();
      return;
    }
    // Sparse: no checks while the page is hidden.
    if (root.document.hidden) { schedule(gen, tv.wait * 2); return; }
    call("/v1/tv-pair/poll", { method: "POST", body: { poll: tv.poll } }).then(function (res) {
      if (gen !== tv.gen) return;
      if (res && res.status === 200 && res.token) {
        tv.phase = "done";
        tv.poll = "";
        tv.code = "";
        tvPaint();
        var a = accounts();
        if (a && a.commitTvSession) a.commitTvSession(res.token, res.account);
        return;
      }
      if (res && (res.status === 410 || res.status === 400)) {
        tv.phase = "expired";
        tv.poll = "";
        tvPaint();
        return;
      }
      schedule(gen, res && res.status === 429 ? tv.wait * 4 : tv.wait);
    }, function () {
      if (gen === tv.gen) schedule(gen, tv.wait * 2);
    });
  }

  /* ---- Phone side: #/link-tv ---- */
  var phone = { busy: false, msg: "", ok: false, bad: false };
  function signedIn() {
    var a = accounts();
    return !!(a && a.token && a.token());
  }
  function linkPage(route) {
    var pre = route && route.query && route.query.get ? cleanCode(route.query.get("code")) : "";
    var head = '<div class="topbar tall"><div class="page-head">' +
      '<button class="icon-btn" data-act="back" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 11 13.2 5.2 11.8 3.8 3.6 12l8.2 8.2 1.4-1.4L7.4 13H20v-2z"/></svg></button>' +
      '<div class="head-text grow"><h1>' + esc(tr("Link a TV")) + "</h1></div></div></div>";
    if (!signedIn()) {
      return head + '<div class="tvp-phone"><p class="tvp-lead">' + esc(tr("Sign in on this phone first, then open this page again to link the TV.")) + "</p></div>";
    }
    if (phone.ok) {
      return head + '<div class="tvp-phone"><p class="tvp-done" role="status">' + esc(tr("Done. The TV signs in within a few seconds.")) + '</p><p class="tvp-lead">' + esc(tr("The TV shows up in My devices, where you can remove it at any time.")) + '</p><div class="tvp-row"><a class="tvp-btn primary" href="#/settings/devices">' + esc(tr("My devices")) + "</a></div></div>";
    }
    return head + '<div class="tvp-phone">' +
      '<p class="tvp-lead">' + esc(tr("On the TV, open {app} and choose Sign in with your phone. Then enter the code from the TV screen, or scan its QR code with this phone's camera.", { app: appName() })) + "</p>" +
      '<form class="tvp-form" data-tvpair-form autocomplete="off">' +
        '<label class="tvp-label" for="tvp-code">' + esc(tr("Code on the TV")) + "</label>" +
        '<input id="tvp-code" class="tvp-input" name="code" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="7" placeholder="ABC 234" value="' + esc(spaced(pre)) + '">' +
        '<p class="tvp-warn">' + esc(tr("Only link a TV you can see in front of you. Anyone using that TV can use your account until you remove it in My devices.")) + "</p>" +
        '<button class="tvp-btn primary" type="submit"' + (phone.busy ? " disabled aria-busy=\"true\"" : "") + ">" + esc(phone.busy ? tr("Loading…") : tr("Sign in the TV")) + "</button>" +
        '<p class="tvp-status' + (phone.bad ? " bad" : "") + '" role="status" aria-live="polite">' + esc(phone.msg) + "</p>" +
      "</form></div>";
  }
  function rerender() {
    if (typeof root.dispatchEvent === "function") {
      try { root.dispatchEvent(new CustomEvent("vklazy", { detail: { name: "tvpair" } })); } catch (err) { /* old browser */ }
    }
  }
  function approve(form) {
    if (phone.busy) return;
    var input = form.querySelector("input[name=code]");
    var code = cleanCode(input ? input.value : "");
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
      if (btn.getAttribute("data-tvpair") === "again") tvStart();
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
    linkUrl: linkUrl
  };
})(typeof window !== "undefined" ? window : this);
