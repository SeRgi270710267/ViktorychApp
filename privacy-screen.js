/* One overlay when this window is not in front.
   The cover is off until someone turns it on. It never blurs, hides,
   resizes, or restyles the page, and it does not touch lists, menus,
   or profiles. A browser still cannot block an operating-system screenshot. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychPrivacy = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  var MODE_KEY = "viktorychapp-privacy-mode";
  var SELECT_KEY = "viktorychapp-privacy-select";
  var MIGRATED_KEY = "viktorychapp-privacy-migrated";
  var reasons = {};

  function tr(key, vars) {
    return root && root.t ? root.t(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function storedMode() {
    try { return localStorage.getItem(MODE_KEY); }
    catch (err) { return null; }
  }
  function migrateDefault() {
    try {
      if (localStorage.getItem(MIGRATED_KEY) === "1") return;
      var saved = storedMode();
      if (saved !== "off" && saved !== "dms" && saved !== "app") localStorage.setItem(MODE_KEY, "off");
      localStorage.setItem(MIGRATED_KEY, "1");
    } catch (err) { /* private mode keeps the default */ }
  }
  function mode() {
    var saved = storedMode();
    if (saved === "off" || saved === "dms" || saved === "app") return saved;
    return "off";
  }
  function selectionOff() {
    try { return localStorage.getItem(SELECT_KEY) === "1"; }
    catch (err) { return false; }
  }
  function writeMode(next) {
    try { localStorage.setItem(MODE_KEY, next); } catch (err) { /* the toggle still paints */ }
  }
  function writeSelect(on) {
    try { localStorage.setItem(SELECT_KEY, on ? "1" : "0"); } catch (err) { /* the toggle still paints */ }
  }

  function splitView(metrics) {
    var sw = Number(metrics.screenWidth) || 0;
    var sh = Number(metrics.screenHeight) || 0;
    var ww = Number(metrics.windowWidth) || 0;
    var wh = Number(metrics.windowHeight) || 0;
    if (sw < 200 || sh < 200 || ww < 80 || wh < 80) return false;
    var widthRatio = ww / sw;
    var heightRatio = wh / sh;
    var missingW = sw - ww;
    var missingH = sh - wh;
    /* Kept so callers can recognise a second pane. The cover does not use it. */
    var vertical = widthRatio < 0.7 && heightRatio > 0.85 && missingW >= 240 && ww >= 240;
    var horizontal = heightRatio < 0.7 && widthRatio > 0.85 && missingH >= 240 && wh >= 240;
    return !!(vertical || horizontal);
  }

  function decide(input) {
    var picked = input && input.mode || "off";
    if (picked !== "dms" && picked !== "app") return { cover: false, scope: "off", reason: "" };
    var reason = "";
    if (input.locked) reason = "lock";
    else if (input.hidden) reason = "hidden";
    else if (input.frozen) reason = "freeze";
    else if (input.blurred && !input.coarse && !input.focused) reason = "blur";
    if (!reason) return { cover: false, scope: picked, reason: "" };
    if (picked === "dms" && !input.messages && reason !== "lock") return { cover: false, scope: picked, reason: "" };
    return { cover: true, scope: "overlay", reason: reason };
  }

  function coarsePointer() {
    try {
      return !!(root.matchMedia && root.matchMedia("(hover: none) and (pointer: coarse)").matches);
    } catch (err) { return false; }
  }

  function messagesOpen() {
    var hash = "";
    try { hash = String(root.location && root.location.hash || ""); } catch (err) { hash = ""; }
    return hash === "#/messages" || hash.indexOf("#/messages/") === 0 || hash.indexOf("#/messages?") === 0;
  }

  function lockedNow() {
    try {
      return !!(root.document && root.document.documentElement && root.document.documentElement.getAttribute("data-lock") === "1");
    } catch (err) { return false; }
  }

  function focusedNow() {
    try { return !!(root.document && root.document.hasFocus && root.document.hasFocus()); }
    catch (err) { return false; }
  }

  function collect() {
    var doc = root.document;
    var focused = focusedNow();
    if (focused) delete reasons.blur;
    if (doc && doc.visibilityState !== "hidden" && !doc.hidden) delete reasons.hidden;
    var hidden = !!(doc && (doc.visibilityState === "hidden" || doc.hidden)) || !!reasons.hidden;
    return {
      mode: mode(),
      locked: lockedNow() || !!reasons.lock,
      frozen: !!reasons.freeze,
      hidden: hidden,
      blurred: !!reasons.blur && !focused,
      focused: focused,
      coarse: coarsePointer(),
      messages: messagesOpen()
    };
  }

  function scrubCoverMarks() {
    var html = root.document && root.document.documentElement;
    if (!html) return;
    html.removeAttribute("data-privacy-cover");
    html.removeAttribute("data-privacy-mode");
  }

  function ensureCover() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return null;
    var cover = doc.getElementById("privacy-cover");
    if (!cover) {
      cover = doc.createElement("div");
      cover.id = "privacy-cover";
      cover.setAttribute("hidden", "");
      cover.setAttribute("aria-hidden", "true");
      doc.documentElement.appendChild(cover);
    }
    if (!cover.querySelector(".privacy-cover-card")) {
      var card = doc.createElement("div");
      card.className = "privacy-cover-card";
      card.textContent = tr("Covered");
      cover.appendChild(card);
    }
    if (cover.style) cover.style.cssText = "";
    return cover;
  }

  function showCover(on) {
    var cover = ensureCover();
    if (!cover) return;
    if (on) cover.removeAttribute("hidden");
    else cover.setAttribute("hidden", "");
    cover.setAttribute("aria-hidden", "true");
  }

  function paint() {
    if (!root.document || !root.document.documentElement) return { cover: false, scope: "off", reason: "" };
    migrateDefault();
    scrubCoverMarks();
    var html = root.document.documentElement;
    html.setAttribute("data-privacy-select", selectionOff() ? "off" : "on");
    var choice = decide(collect());
    showCover(!!choice.cover);
    return choice;
  }

  function mark(name, on) {
    if (on) reasons[name] = true;
    else delete reasons[name];
    return paint();
  }

  function clearCover() {
    delete reasons.blur;
    delete reasons.hidden;
    delete reasons.freeze;
    delete reasons.lock;
    delete reasons.print;
    delete reasons.pip;
    return paint();
  }

  function settingsHtml() {
    var current = mode();
    function btn(id, label) {
      return '<button class="outline' + (current === id ? " on" : "") + '" type="button" data-sec="privacy-mode" data-mode="' + id + '">' + esc(label) + "</button>";
    }
    var selectOn = selectionOff();
    return "<h2>" + esc(tr("Privacy screen")) + "</h2><p class=\"phandle\">" + esc(tr("Cover the app when this window is hidden, in the background, or locked.")) + "</p><div class=\"theme-row\" role=\"group\">" +
      btn("off", tr("Off")) + btn("dms", tr("Messages only")) + btn("app", tr("Whole app")) +
      "</div><p class=\"phandle\">" + esc(tr("The cover is one layer. It does not blur, hide, or restyle the page, and it goes away when this window is in front.")) + "</p><p class=\"phandle\">" + esc(tr("Android can block screenshots only in a wrapper that sets FLAG_SECURE. This site does not include that wrapper.")) + "</p>" +
      '<button class="tab-switch' + (selectOn ? " on" : "") + '" type="button" role="switch" aria-checked="' + (selectOn ? "true" : "false") + '" data-sec="privacy-select"><span>' + esc(tr("Stop text selection in messages")) + "</span><i></i></button>";
  }

  function start() {
    if (!root.document || !root.document.documentElement) return;
    migrateDefault();
    scrubCoverMarks();
    ensureCover();
    root.document.documentElement.setAttribute("data-privacy-select", selectionOff() ? "off" : "on");
    root.addEventListener("blur", function () { mark("blur", true); }, true);
    root.addEventListener("focus", function () { clearCover(); }, true);
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.visibilityState === "hidden") mark("hidden", true);
      else clearCover();
    }, true);
    root.addEventListener("hashchange", function () { clearCover(); }, true);
    root.addEventListener("pagehide", function () { mark("hidden", true); }, true);
    root.addEventListener("pageshow", function () { clearCover(); }, true);
    root.document.addEventListener("freeze", function () { mark("freeze", true); }, true);
    root.document.addEventListener("resume", function () { mark("freeze", false); }, true);
    try {
      if (root.MutationObserver) {
        var watch = new root.MutationObserver(function () { paint(); });
        watch.observe(root.document.documentElement, { attributes: true, attributeFilter: ["data-lock"] });
      }
    } catch (err) { /* the lock screen still paints on the next render */ }
    root.document.addEventListener("click", function (event) {
      var node = event.target && event.target.closest ? event.target.closest("[data-sec]") : null;
      if (!node) return;
      var act = node.getAttribute("data-sec");
      if (act === "privacy-mode") {
        event.preventDefault();
        var next = node.getAttribute("data-mode");
        if (next === "off" || next === "dms" || next === "app") writeMode(next);
        paint();
        if (root.ViktorychAccounts && root.ViktorychAccounts.requestRender) root.ViktorychAccounts.requestRender();
      } else if (act === "privacy-select") {
        event.preventDefault();
        writeSelect(!selectionOff());
        paint();
        if (root.ViktorychAccounts && root.ViktorychAccounts.requestRender) root.ViktorychAccounts.requestRender();
      }
    }, true);
    paint();
  }

  start();

  return {
    decide: decide,
    splitView: splitView,
    paint: paint,
    mark: mark,
    clear: clearCover,
    mode: mode,
    settingsHtml: settingsHtml,
    setMode: function (next) { writeMode(next); return paint(); }
  };
});
