/* Cover sensitive screens when this window is not the one in front.
   A browser cannot block an operating-system screenshot. The cover runs
   before the app-switcher snapshot when the page is hidden or blurred. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychPrivacy = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  var MODE_KEY = "viktorychapp-privacy-mode";
  var SELECT_KEY = "viktorychapp-privacy-select";
  var reasons = {};

  function tr(key, vars) {
    return root && root.t ? root.t(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function mode() {
    try {
      var saved = localStorage.getItem(MODE_KEY);
      if (saved === "off" || saved === "dms" || saved === "app") return saved;
    } catch (err) { /* private mode keeps the default */ }
    return "dms";
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
    /* Browser chrome, a taskbar, and a normal resized window leave a strip.
       Split-screen leaves another pane: at least 30% of that axis and 240px.
       A phone that is simply shorter than the screen is not split. */
    var vertical = widthRatio < 0.7 && heightRatio > 0.85 && missingW >= 240;
    var horizontal = heightRatio < 0.7 && widthRatio > 0.85 && missingH >= 240;
    return !!(vertical || horizontal);
  }

  function decide(input) {
    var picked = input && input.mode || "off";
    if (picked !== "dms" && picked !== "app") return { cover: false, scope: "off", reason: "" };
    var reason = "";
    if (input.printing) reason = "print";
    else if (input.pip) reason = "pip";
    else if (input.frozen) reason = "freeze";
    else if (input.hidden) reason = "hidden";
    else if (input.blurred) reason = "blur";
    else if (input.split) reason = "split";
    if (!reason) return { cover: false, scope: picked, reason: "" };
    if (picked === "dms" && !input.sensitive) return { cover: false, scope: picked, reason: reason };
    return { cover: true, scope: picked, reason: reason };
  }

  function metrics() {
    var screenObj = root.screen || { width: 0, height: 0 };
    var pip = false;
    try { pip = !!(root.document && root.document.pictureInPictureElement); } catch (err) { pip = false; }
    try {
      if (root.documentPictureInPicture && root.documentPictureInPicture.window) pip = true;
    } catch (err) { /* document picture-in-picture is optional */ }
    var displayPip = false;
    try { displayPip = !!(root.matchMedia && root.matchMedia("(display-mode: picture-in-picture)").matches); } catch (err) { displayPip = false; }
    return {
      screenWidth: screenObj.width || 0,
      screenHeight: screenObj.height || 0,
      windowWidth: root.outerWidth || root.innerWidth || 0,
      windowHeight: root.outerHeight || root.innerHeight || 0,
      pip: pip || displayPip || !!reasons.pip
    };
  }

  function sensitiveOnScreen() {
    if (!root.document) return false;
    return !!root.document.querySelector("[data-privacy='sensitive']");
  }

  function collect() {
    var doc = root.document;
    var current = metrics();
    return {
      mode: mode(),
      printing: !!reasons.print,
      pip: !!current.pip,
      frozen: !!reasons.freeze,
      hidden: !!(doc && (doc.visibilityState === "hidden" || doc.hidden)),
      blurred: !!reasons.blur,
      split: splitView(current),
      sensitive: sensitiveOnScreen()
    };
  }

  function ensureCover() {
    var doc = root.document;
    if (!doc || !doc.documentElement) return null;
    var cover = doc.getElementById("privacy-cover");
    if (cover) return cover;
    cover = doc.createElement("div");
    cover.id = "privacy-cover";
    cover.setAttribute("hidden", "");
    cover.setAttribute("aria-hidden", "true");
    var card = doc.createElement("div");
    card.className = "privacy-cover-card";
    card.textContent = tr("Covered");
    cover.appendChild(card);
    doc.documentElement.appendChild(cover);
    if (cover.offsetHeight < 0) { /* the node is in the tree before the snapshot */ }
    return cover;
  }

  function paint() {
    if (!root.document || !root.document.documentElement) return { cover: false, scope: "off", reason: "" };
    var choice = decide(collect());
    var html = root.document.documentElement;
    html.setAttribute("data-privacy-mode", mode());
    html.setAttribute("data-privacy-select", selectionOff() ? "off" : "on");
    if (choice.cover && choice.scope === "app") {
      html.setAttribute("data-privacy-cover", "app");
      var cover = ensureCover();
      if (cover) cover.removeAttribute("hidden");
    } else if (choice.cover && choice.scope === "dms") {
      html.setAttribute("data-privacy-cover", "dms");
      var sheet = root.document.getElementById("privacy-cover");
      if (sheet) sheet.setAttribute("hidden", "");
    } else {
      html.setAttribute("data-privacy-cover", "off");
      var idle = root.document.getElementById("privacy-cover");
      if (idle) idle.setAttribute("hidden", "");
    }
    return choice;
  }

  function mark(name, on) {
    if (on) reasons[name] = true;
    else delete reasons[name];
    return paint();
  }

  function settingsHtml() {
    var current = mode();
    function btn(id, label) {
      return '<button class="outline' + (current === id ? " on" : "") + '" type="button" data-sec="privacy-mode" data-mode="' + id + '">' + esc(label) + "</button>";
    }
    var selectOn = selectionOff();
    return "<h2>" + esc(tr("Privacy screen")) + "</h2><p class=\"phandle\">" + esc(tr("Cover messages when this window is in the background, split screen, picture-in-picture, or print.")) + "</p><div class=\"theme-row\" role=\"group\">" +
      btn("off", tr("Off")) + btn("dms", tr("Messages only")) + btn("app", tr("Whole app")) +
      "</div><p class=\"phandle\">" + esc(tr("Browsers cannot block operating-system screenshots. The cover hides messages from the app switcher, split screen, picture-in-picture, and print preview. A screenshot taken while this window is open and focused can still capture it.")) + "</p><p class=\"phandle\">" + esc(tr("Android can block screenshots only in a wrapper that sets FLAG_SECURE. This site does not include that wrapper.")) + "</p>" +
      '<button class="tab-switch' + (selectOn ? " on" : "") + '" type="button" role="switch" aria-checked="' + (selectOn ? "true" : "false") + '" data-sec="privacy-select"><span>' + esc(tr("Stop text selection in messages")) + "</span><i></i></button>";
  }

  function start() {
    if (!root.document || !root.document.documentElement) return;
    ensureCover();
    root.document.documentElement.setAttribute("data-privacy-mode", mode());
    root.document.documentElement.setAttribute("data-privacy-select", selectionOff() ? "off" : "on");
    root.addEventListener("blur", function () { mark("blur", true); }, true);
    root.addEventListener("focus", function () { mark("blur", false); }, true);
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.visibilityState === "hidden") mark("hidden", true);
      else mark("hidden", false);
    }, true);
    root.addEventListener("pagehide", function () { mark("hidden", true); }, true);
    root.addEventListener("pageshow", function () { mark("hidden", false); mark("freeze", false); }, true);
    root.document.addEventListener("freeze", function () { mark("freeze", true); }, true);
    root.document.addEventListener("resume", function () { mark("freeze", false); }, true);
    root.addEventListener("resize", function () { paint(); });
    root.document.addEventListener("enterpictureinpicture", function () { mark("pip", true); }, true);
    root.document.addEventListener("leavepictureinpicture", function () { mark("pip", false); }, true);
    root.addEventListener("beforeprint", function () { mark("print", true); });
    root.addEventListener("afterprint", function () { mark("print", false); });
    try {
      var media = root.matchMedia && root.matchMedia("(display-mode: picture-in-picture)");
      if (media && media.addEventListener) media.addEventListener("change", function () { paint(); });
    } catch (err) { /* display-mode is optional */ }
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
    mode: mode,
    settingsHtml: settingsHtml,
    setMode: function (next) { writeMode(next); return paint(); }
  };
});
