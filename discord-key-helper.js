/* Settings > Connected keys > Connect your Discord (local) > "Get your key".
   A guided, half-automated way to fetch the spare account's own key for local
   mode. We never read the key from discord.com ourselves: the user runs a
   short console snippet in their OWN browser tab, which copies their own token
   to their clipboard, and pastes it back here. We validate it with a single
   GET /users/@me straight from this device, then hand it to DiscordLocal to
   seal and store on this device only (never to our servers). No key value,
   id or handle is ever logged. */
(function (root) {
  "use strict";
  var API = "https://discord.com/api/v10";
  var APP_URL = "https://discord.com/app";
  var netFetch = root.fetch ? root.fetch.bind(root) : null;

  /* The console snippet the user runs in their own Discord tab. It reads the
     account's own login token and copies it to the clipboard; nothing leaves
     their browser. Shown verbatim so the user can read what it does before
     running it. */
  var SNIPPET =
    "(async () => {\n" +
    "  let token;\n" +
    "  try {\n" +
    "    (window.webpackChunkdiscord_app = window.webpackChunkdiscord_app || []).push([[Symbol()], {}, (req) => {\n" +
    "      for (const m of Object.values(req.c)) {\n" +
    "        const get = m?.exports?.default?.getToken || m?.exports?.getToken;\n" +
    "        if (typeof get === 'function') { token = get(); break; }\n" +
    "      }\n" +
    "    });\n" +
    "  } catch (e) {}\n" +
    "  if (!token) {\n" +
    "    const f = document.createElement('iframe');\n" +
    "    document.body.append(f);\n" +
    "    try { token = JSON.parse(f.contentWindow.localStorage.token); } catch (e) {}\n" +
    "    f.remove();\n" +
    "  }\n" +
    "  if (token) { await navigator.clipboard.writeText(token); console.log('%cCopied your key to the clipboard. Paste it back in the app.', 'color:#1d9bf0'); }\n" +
    "  else { console.log('Could not find a key. Make sure you are signed in.'); }\n" +
    "})();";

  var state = { open: false, step: 1, saved: "", me: null, busy: false, err: "", ok: false, copied: false, onDone: null };

  function tr(key, vars) {
    if (root.t) return root.t(key, vars);
    return String(key).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function isMobile() {
    try { return root.matchMedia && root.matchMedia("(pointer: coarse)").matches && root.innerWidth < 900; }
    catch (e) { return false; }
  }
  function cleanKey(raw) {
    var dl = root.DiscordLocal;
    if (dl && dl._test && typeof dl._test.cleanKey === "function") return dl._test.cleanKey(raw);
    var v = String(raw || "").trim().replace(/^["']|["']$/g, "").trim().replace(/^authorization:\s*/i, "");
    if (/^(bearer|bot)\s+/i.test(v)) return "";
    return /^[A-Za-z0-9_\-.]{50,120}$/.test(v) && v.split(".").length >= 3 ? v : "";
  }
  function avatarUrl(me) {
    if (!me) return "";
    if (me.avatar && me.id) return "https://cdn.discordapp.com/avatars/" + encodeURIComponent(me.id) + "/" + encodeURIComponent(me.avatar) + ".png?size=64";
    return "";
  }

  /* ---------- rendering ---------- */
  function dotBar() {
    var out = "";
    for (var i = 1; i <= 3; i++) {
      out += '<i class="dkey-dot' + (i === state.step ? " on" : (i < state.step ? " done" : "")) + '"></i>';
    }
    return '<div class="dkey-dots" aria-hidden="true">' + out + "</div>";
  }
  function stepOne() {
    return '<div class="dkey-step">' +
      '<h3 class="dkey-h">' + esc(tr("Step 1 · Open Discord")) + "</h3>" +
      '<p class="dkey-p">' + esc(tr("Sign in with a SPARE account, not your main one. Discord may lock accounts used this way.")) + "</p>" +
      '<a class="dkey-pill primary" href="' + esc(APP_URL) + '" target="_blank" rel="noopener noreferrer" data-dkey="next">' + esc(tr("Open Discord")) + "</a>" +
      '<button type="button" class="dkey-pill outline" data-dkey="step" data-n="2">' + esc(tr("I'm signed in")) + "</button>" +
      "</div>";
  }
  function stepTwo() {
    if (isMobile()) {
      return '<div class="dkey-step">' +
        '<h3 class="dkey-h">' + esc(tr("Step 2 · Copy your key")) + "</h3>" +
        '<p class="dkey-p">' + esc(tr("This step needs a desktop browser. Open this page on a computer to copy the key, or paste a key you already have.")) + "</p>" +
        '<button type="button" class="dkey-pill primary" data-dkey="step" data-n="3">' + esc(tr("I already have a key")) + "</button>" +
        '<button type="button" class="dkey-pill outline" data-dkey="step" data-n="1">' + esc(tr("Back")) + "</button>" +
        "</div>";
    }
    return '<div class="dkey-step">' +
      '<h3 class="dkey-h">' + esc(tr("Step 2 · Copy your key")) + "</h3>" +
      '<ol class="dkey-ol">' +
      "<li>" + esc(tr("In the Discord tab, open the developer console: F12, or Ctrl+Shift+I (Cmd+Option+I on a Mac).")) + "</li>" +
      "<li>" + esc(tr("Copy the snippet below, paste it into the console and press Enter.")) + "</li>" +
      "<li>" + esc(tr("It copies your key to the clipboard. Come back here and paste it in the next step.")) + "</li>" +
      "</ol>" +
      '<p class="dkey-snip-note">' + esc(tr("What it does: it reads your own account's key and copies it to your clipboard. It is not sent anywhere.")) + "</p>" +
      '<pre class="dkey-snip" aria-label="' + esc(tr("Console snippet")) + '"><code>' + esc(SNIPPET) + "</code></pre>" +
      '<button type="button" class="dkey-pill primary" data-dkey="copy">' + esc(state.copied ? tr("Copied") : tr("Copy snippet")) + "</button>" +
      '<div class="dkey-warn" role="note"><b>' + esc(tr("Discord will show a red \u201cSelf-XSS\u201d warning.")) + "</b> " +
      esc(tr("That warning is there because pasting code someone else gives you can hand them your account. This snippet is safe only because you can read exactly what it does above. Never paste code you do not understand.")) + "</div>" +
      '<button type="button" class="dkey-pill outline" data-dkey="step" data-n="3">' + esc(tr("Next")) + "</button>" +
      '<button type="button" class="dkey-link" data-dkey="step" data-n="1">' + esc(tr("Back")) + "</button>" +
      "</div>";
  }
  function stepThree() {
    var row = "";
    if (state.ok && state.me) {
      row = '<div class="dkey-ok" role="status">' +
        (avatarUrl(state.me) ? '<img class="dkey-ava" src="' + esc(avatarUrl(state.me)) + '" alt="" referrerpolicy="no-referrer">' : '<span class="dkey-ava blank" aria-hidden="true"></span>') +
        '<div class="dkey-ok-copy"><b>' + esc(state.me.name || tr("Your spare account")) + '</b>' +
        '<span class="dkey-status ok"><i aria-hidden="true"></i>' + esc(tr("Connected")) + "</span></div></div>";
    }
    var action = state.ok
      ? '<button type="button" class="dkey-pill primary" data-dkey="save">' + esc(tr("Save on this device")) + "</button>"
      : '<button type="button" class="dkey-pill primary" data-dkey="check"' + (state.busy ? " disabled" : "") + ">" + esc(state.busy ? tr("Checking\u2026") : tr("Check key")) + "</button>";
    return '<div class="dkey-step">' +
      '<h3 class="dkey-h">' + esc(tr("Step 3 · Paste your key")) + "</h3>" +
      '<p class="dkey-p">' + esc(tr("Paste the key you copied. It is checked straight from this device and kept here only.")) + "</p>" +
      '<input id="dkey-input" class="dkey-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(tr("Paste the key")) + '" aria-label="' + esc(tr("Spare account key")) + '">' +
      (state.err ? '<p class="dkey-err" aria-live="polite">' + esc(state.err) + "</p>" : "") +
      row + action +
      '<button type="button" class="dkey-link" data-dkey="step" data-n="2">' + esc(tr("Back")) + "</button>" +
      "</div>";
  }
  function body() {
    if (state.step === 2) return stepTwo();
    if (state.step === 3) return stepThree();
    return stepOne();
  }
  function sheet() {
    return '<div class="dkey-back" data-dkey="close"></div>' +
      '<div class="dkey-sheet" role="dialog" aria-modal="true" aria-labelledby="dkey-title">' +
      '<header class="dkey-head"><b id="dkey-title">' + esc(tr("Get your key")) + "</b>" +
      '<button type="button" class="dkey-x" data-dkey="close" aria-label="' + esc(tr("Close")) + '">\u00d7</button></header>' +
      dotBar() + body() + "</div>";
  }
  function paint() {
    if (typeof document === "undefined") return;
    var host = document.getElementById("dkey-host");
    if (!state.open) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement("div"); host.id = "dkey-host"; document.body.appendChild(host); }
    host.innerHTML = sheet();
    if (state.step === 3) { var i = document.getElementById("dkey-input"); if (i && !state.ok) i.focus(); }
  }

  /* ---------- actions ---------- */
  function open(onDone) {
    state.open = true; state.step = 1; state.saved = ""; state.me = null; state.err = ""; state.ok = false; state.busy = false; state.copied = false;
    state.onDone = typeof onDone === "function" ? onDone : null;
    paint();
  }
  function close() { state.open = false; state.me = null; state.saved = ""; paint(); }
  function goto(n) { state.step = Math.max(1, Math.min(3, n)); state.err = ""; paint(); }
  function copySnippet() {
    var done = function () { state.copied = true; paint(); setTimeout(function () { state.copied = false; var b = document.querySelector('[data-dkey="copy"]'); if (b) b.textContent = tr("Copy snippet"); }, 2000); };
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(SNIPPET).then(done, function () {
        var pre = document.querySelector(".dkey-snip"); if (pre) { var r = document.createRange(); r.selectNodeContents(pre); var s = root.getSelection(); s.removeAllRanges(); s.addRange(r); }
      });
    } else {
      var pre2 = document.querySelector(".dkey-snip"); if (pre2) { var r2 = document.createRange(); r2.selectNodeContents(pre2); var s2 = root.getSelection(); s2.removeAllRanges(); s2.addRange(r2); }
    }
  }
  function check() {
    var input = document.getElementById("dkey-input");
    var raw = input ? input.value : "";
    var key = cleanKey(raw);
    if (!key) { state.err = tr("That doesn\u2019t look like a Discord key."); state.ok = false; paint(); return; }
    if (!netFetch) { state.err = tr("Couldn\u2019t reach Discord from this device."); paint(); return; }
    state.busy = true; state.err = ""; paint();
    netFetch(API + "/users/@me", { method: "GET", headers: { accept: "application/json", authorization: key }, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", mode: "cors" })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (me) {
          state.busy = false;
          if (res.status === 401 || res.status === 403) { state.err = tr("Discord didn\u2019t accept that key."); state.ok = false; paint(); return; }
          if (!res.ok || !me) { state.err = tr("Couldn\u2019t check the key. Try again."); state.ok = false; paint(); return; }
          state.saved = key; key = "";
          var input = document.getElementById("dkey-input"); if (input) input.value = "";
          state.me = { id: me.id ? String(me.id) : "", name: String(me.global_name || me.username || ""), avatar: me.avatar ? String(me.avatar) : "" };
          state.ok = true; state.err = ""; paint();
        });
      })
      .catch(function () { state.busy = false; state.err = tr("Couldn\u2019t reach Discord from this device."); state.ok = false; paint(); });
  }
  function save() {
    var key = state.saved;
    if (!key) { goto(3); return; }
    var dl = root.DiscordLocal;
    if (dl && typeof dl.connect === "function") {
      dl.connect(key);
      if (dl.open) dl.open();
    }
    state.saved = "";
    close();
  }
  function onClick(event) {
    var t = event.target;
    var btn = t && t.closest ? t.closest("[data-dkey]") : null;
    if (!btn) return;
    var act = btn.getAttribute("data-dkey");
    if (act === "next") { /* link opens the tab; advance after a tick */ setTimeout(function () { goto(2); }, 50); return; }
    event.preventDefault();
    if (act === "close") close();
    else if (act === "step") goto(Number(btn.getAttribute("data-n")) || 1);
    else if (act === "copy") copySnippet();
    else if (act === "check") check();
    else if (act === "save") save();
    else if (act === "open") open();
  }
  function onKey(event) { if (event.key === "Escape" && state.open) close(); }

  root.DiscordKeyHelper = { open: open, close: close, _snippet: SNIPPET };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
  }
})(typeof window !== "undefined" ? window : this);
