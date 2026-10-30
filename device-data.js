/* Settings → Data and storage → This device: how much is stored here, when
   private data expires, and "Delete all data on this device". The help entry
   lists manual steps for each browser. The work is in device-seal.js. */
(function () {
  var TIP_KEY = "viktorychapp-wipe-tip-v1";
  function tr(key, vars) { return window.t ? window.t(key, vars) : key; }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function seal() { return window.ViktorychSeal || null; }
  function bytes(n) {
    var st = window.ViktorychStorage;
    if (st && st.formatBytes) return st.formatBytes(n);
    return String(Math.round((Number(n) || 0) / 1048576)) + " MB";
  }
  function tipText() {
    return tr("Removing the icon doesn't delete your data on Android or computers. Use Settings → Delete all data on this device.");
  }
  function dayLabel(d) {
    if (!d) return tr("Never");
    return tr("{n} days", { n: String(d) });
  }

  function sectionHtml() {
    var api = seal();
    var policy = api ? api.readPolicy() : { days: 30, dropPublic: false };
    var choices = api ? api.dayChoices : [7, 14, 30, 60, 90, 0];
    var opts = choices.map(function (d) {
      return '<option value="' + d + '"' + (policy.days === d ? " selected" : "") + ">" + esc(dayLabel(d)) + "</option>";
    }).join("");
    setTimeout(fillEstimate, 0);
    return '<div class="set-block vseal-block">' +
      "<h2>" + esc(tr("This device")) + "</h2>" +
      '<p class="set-sub" id="vseal-usage">' + esc(tr("Checking how much is stored on this device…")) + "</p>" +
      '<p class="set-sub">' + esc(tipText()) + "</p>" +
      "<h2>" + esc(tr("Delete private data if the app isn't opened for")) + "</h2>" +
      '<p class="set-sub">' + esc(tr("Sign-in, drafts, messages and private lists on this device are deleted the next time the app opens after this long.")) + "</p>" +
      '<label class="acct-field acct-select"><select data-vseal="days" aria-label="' + esc(tr("Delete private data if the app isn't opened for")) + '">' + opts + "</select></label>" +
      '<button class="tab-switch' + (policy.dropPublic ? " on" : "") + '" type="button" role="switch" aria-checked="' + (policy.dropPublic ? "true" : "false") + '" data-vseal="drop-public"><span>' + esc(tr("Also delete saved posts and media")) + "</span><i></i></button>" +
      '<button class="outline acct-danger vseal-go" type="button" data-vseal="wipe">' + esc(tr("Delete all data on this device")) + "</button>" +
      '<p class="set-sub">' + esc(tr("Signs you out here and removes everything this app saved in this browser. Your account and posts stay on the server.")) + "</p>" +
      "</div>";
  }

  function helpHtml() {
    var step = function (title, text) { return "<li><b>" + esc(title) + "</b> " + esc(text) + "</li>"; };
    return '<div class="set-block vseal-help" id="help-device-data">' +
      "<h2>" + esc(tr("Delete this app's data from your browser")) + "</h2>" +
      '<p class="set-sub">' + esc(tipText()) + "</p>" +
      '<ul class="vseal-steps">' +
      step(tr("Chrome on Android:"), tr("Settings → Site settings → All sites → this site → Clear & reset.")) +
      step(tr("iPhone and iPad:"), tr("Deleting the Home Screen app removes its data. In Safari, also use Settings → Apps → Safari → Advanced → Website Data.")) +
      step(tr("Chrome or Edge on a computer:"), tr("Click the icon left of the address, then Site settings → Delete data.")) +
      step(tr("Firefox:"), tr("Click the lock icon in the address bar, then Clear cookies and site data.")) +
      step(tr("Safari on Mac:"), tr("Safari → Settings → Privacy → Manage Website Data → this site → Remove.")) +
      "</ul></div>";
  }

  function fillEstimate() {
    var el = document.getElementById("vseal-usage");
    var api = seal();
    if (!el || !api) return;
    api.estimate().then(function (e) {
      if (!el.isConnected) return;
      if (!e) { el.textContent = tr("This browser doesn't report how much is stored."); return; }
      el.textContent = e.quota
        ? tr("Stored on this device: {used} of {quota} available", { used: bytes(e.usage), quota: bytes(e.quota) })
        : tr("Stored on this device: {used}", { used: bytes(e.usage) });
    });
  }

  function toast(text) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* X-style confirm: dark card, red Delete pill, Cancel outline. */
  function ask(opts) {
    return new Promise(function (resolve) {
      var old = document.getElementById("vseal-confirm");
      if (old) old.remove();
      var wrap = document.createElement("div");
      wrap.id = "vseal-confirm";
      wrap.className = "vseal-confirm";
      wrap.innerHTML = '<div class="vseal-card" role="alertdialog" aria-modal="true" aria-labelledby="vseal-title" aria-describedby="vseal-body">' +
        '<h2 id="vseal-title">' + esc(opts.title) + "</h2>" +
        '<p id="vseal-body">' + esc(opts.body) + "</p>" +
        '<button type="button" class="vseal-yes">' + esc(opts.yes) + "</button>" +
        '<button type="button" class="vseal-no">' + esc(tr("Cancel")) + "</button></div>";
      var done = function (v) {
        wrap.remove();
        document.removeEventListener("keydown", onKey, true);
        resolve(v);
      };
      var onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); done(false); } };
      wrap.addEventListener("click", function (e) {
        if (e.target === wrap || (e.target.closest && e.target.closest(".vseal-no"))) done(false);
        else if (e.target.closest && e.target.closest(".vseal-yes")) done(true);
      });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(wrap);
      try { wrap.querySelector(".vseal-no").focus(); } catch (err) { /* buttons still work */ }
    });
  }

  function confirmWipe(signOut) {
    return ask({
      title: signOut ? tr("Sign out and delete data on this device?") : tr("Delete all data on this device?"),
      body: tr("This signs you out here and deletes saved posts, media, drafts, messages, settings and offline copies from this browser. It can't be undone. Your account stays."),
      yes: tr("Delete")
    });
  }

  function runWipe(signOut) {
    return confirmWipe(signOut).then(function (yes) {
      if (!yes) return false;
      var api = seal();
      var acc = window.ViktorychAccounts;
      if (acc && acc.signOutAndWipe) { acc.signOutAndWipe(); return true; }
      if (api) api.wipeAll();
      return true;
    });
  }

  document.addEventListener("click", function (event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-vseal]") : null;
    if (!el) return;
    var act = el.getAttribute("data-vseal");
    var api = seal();
    if (act === "wipe") { event.preventDefault(); runWipe(false); }
    else if (act === "drop-public" && api) {
      var on = el.getAttribute("aria-checked") !== "true";
      api.setPolicy({ dropPublic: on });
      el.setAttribute("aria-checked", on ? "true" : "false");
      el.classList.toggle("on", on);
    }
  });
  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute || el.getAttribute("data-vseal") !== "days") return;
    var api = seal();
    if (api) api.setPolicy({ days: Number(el.value) });
  }, true);

  function tipOnce() {
    try {
      if (localStorage.getItem(TIP_KEY)) return "";
      localStorage.setItem(TIP_KEY, "1");
    } catch (err) { return ""; }
    return tipText();
  }

  function start() {
    var api = seal();
    if (!api) return;
    var notice = api.takeNotice();
    if (notice) {
      setTimeout(function () {
        toast(notice === "expired"
          ? tr("The app wasn't opened for a while, so private data on this device was deleted.")
          : tr("All data on this device was deleted."));
      }, 1200);
    }
    api.registerPeriodic();
  }

  window.ViktorychDeviceData = {
    sectionHtml: sectionHtml,
    helpHtml: helpHtml,
    tipText: tipText,
    tipOnce: tipOnce,
    confirmWipe: confirmWipe,
    runWipe: runWipe
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
