/* Points and the free gift store. Amounts come from the worker. */
(function (root) {
  "use strict";

  var balance = null;
  var rules = [];
  var history = [];
  var catalog = [];
  var gifts = null;
  var sheet = null;
  var errorText = "";
  var started = false;
  var viewedHandle = "";

  function tr(key, vars) {
    var fn = root.t || (typeof window !== "undefined" && window.t);
    var text = fn ? fn(key, vars) : key;
    if (!fn && vars) {
      Object.keys(vars).forEach(function (name) {
        text = String(text).split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function token() {
    try { return root.ViktorychAccounts && root.ViktorychAccounts.token ? root.ViktorychAccounts.token() : ""; }
    catch (err) { return ""; }
  }

  function call(path, opts) {
    if (!root.ViktorychAccounts || !root.ViktorychAccounts.call) return Promise.resolve({ status: 503 });
    return root.ViktorychAccounts.call(path, opts || {});
  }

  function redraw() {
    paintBalance();
    if (root.ViktorychAccounts && root.ViktorychAccounts.requestRender) root.ViktorychAccounts.requestRender();
  }

  function paintBalance() {
    if (typeof document === "undefined") return;
    var nodes = document.querySelectorAll("[data-points-balance]");
    nodes.forEach(function (node) {
      node.textContent = balance == null ? "" : String(balance);
    });
  }

  function loadPoints() {
    var auth = token();
    if (!auth) return Promise.resolve();
    return call("/v1/points", { token: auth }).then(function (body) {
      if (!body || body.status !== 200) return;
      balance = Number(body.balance) || 0;
      rules = body.rules || [];
      history = body.history || [];
      paintBalance();
    }).catch(function () {});
  }

  function loadCatalog() {
    return call("/v1/gifts/catalog", { token: token() }).then(function (body) {
      if (body && body.gifts) catalog = body.gifts;
    }).catch(function () {});
  }

  function touch(action, gameId) {
    var auth = token();
    if (!auth) return Promise.resolve();
    return call("/v1/points/touch", { method: "POST", token: auth, body: { action: action, gameId: gameId || "" } }).then(function (body) {
      if (body && body.balance != null) balance = Number(body.balance) || 0;
      paintBalance();
    }).catch(function () {});
  }

  function start() {
    if (started) return;
    started = true;
    loadCatalog();
    loadPoints().then(function () {
      touch("login").then(function () { return touch("read"); }).then(loadPoints);
    });
  }

  function reasonLabel(reason) {
    if (reason === "signup") return tr("Sign-up bonus");
    if (reason === "login") return tr("Daily visit");
    if (reason === "read") return tr("Reading streak");
    if (reason === "post") return tr("Posting");
    if (reason === "comment") return tr("Commenting");
    if (reason === "repost") return tr("Reposting");
    if (reason === "like_in") return tr("A like on your post");
    if (reason === "reply_in") return tr("A reply to you");
    if (reason === "follow") return tr("Following an account");
    if (reason === "profile") return tr("Finishing your profile");
    if (reason === "invite") return tr("Inviting someone");
    if (reason === "game") return tr("Playing a game");
    if (reason === "gift") return tr("Sent a gift");
    return tr("Viktorychs");
  }

  function giftName(id) {
    if (id === "heart") return tr("Heart gift");
    if (id === "star") return tr("Star gift");
    if (id === "spark") return tr("Spark gift");
    if (id === "leaf") return tr("Leaf gift");
    if (id === "comet") return tr("Comet gift");
    if (id === "crown") return tr("Crown gift");
    return tr("Gift");
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
  }

  function pointsPage() {
    var earn = rules.map(function (rule) {
      var extra = rule.streak ? " · " + tr("streak bonus up to {n}", { n: String(rule.streak) }) : "";
      return "<li><b>" + esc(reasonLabel(rule.id)) + "</b><span>" + esc(tr("{n} Viktorychs", { n: String(rule.points) })) + esc(extra) + "</span></li>";
    }).join("");
    var rows = history.map(function (item) {
      var sign = item.delta > 0 ? "+" : "";
      return '<div class="points-row"><span>' + esc(reasonLabel(item.reason)) + '</span><b>' + esc(sign + item.delta) + "</b></div>";
    }).join("");
    return '<div class="points-page"><div class="topbar"><div class="page-head"><h1>' + esc(tr("Viktorychs")) + '</h1></div></div><div class="points-balance"><b data-points-balance>' + esc(balance == null ? "0" : String(balance)) + '</b><span>' + esc(tr("Viktorychs")) + '</span></div><p class="points-note">' + esc(tr("Points are free. They are added by the app when you take part, and they cannot be bought.")) + '</p><a class="points-store" href="#/store">' + esc(tr("ViktorychStore")) + '</a><h2>' + esc(tr("How to earn")) + "</h2><ul class=\"points-earn\">" + earn + "</ul><h2>" + esc(tr("History")) + "</h2>" + (rows || '<p class="points-note">' + esc(tr("No points yet")) + "</p>") + "</div>";
  }

  function storePage() {
    var cards = catalog.map(function (gift) {
      return '<button type="button" class="gift-card" data-gift="pick" data-gift-id="' + esc(gift.id) + '"><span class="gift-art">' + svg(gift.svg) + '</span><b>' + esc(giftName(gift.id)) + "</b><span>" + esc(tr("{n} Viktorychs", { n: String(gift.price) })) + "</span>" + (gift.seasonal ? '<i>' + esc(tr("Seasonal")) + "</i>" : "") + "</button>";
    }).join("");
    return '<div class="store-page"><div class="topbar"><div class="page-head"><h1>' + esc(tr("ViktorychStore")) + '</h1></div></div><div class="gift-grid">' + cards + "</div></div>";
  }

  function sheetHtml() {
    if (!sheet) return "";
    var gift = null;
    catalog.forEach(function (item) { if (item.id === sheet.giftId) gift = item; });
    return '<div class="gift-sheet" role="dialog" aria-modal="true" aria-label="' + esc(tr("Send a gift")) + '"><div class="gift-sheet-bar"><button type="button" data-gift="close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(tr("Send a gift")) + '</h2><button type="button" data-gift="confirm">' + esc(tr("Send")) + '</button></div><div class="gift-sheet-body">' +
      (gift ? '<p class="gift-preview">' + svg(gift.svg) + "<b>" + esc(giftName(gift.id)) + "</b><span>" + esc(tr("{n} Viktorychs", { n: String(gift.price) })) + "</span></p>" : "") +
      '<input data-gift-field="handle" value="' + esc(sheet.handle || "") + '" placeholder="' + esc(tr("Recipient")) + '" aria-label="' + esc(tr("Recipient")) + '">' +
      '<textarea data-gift-field="message" placeholder="' + esc(tr("Add a message")) + '" aria-label="' + esc(tr("Add a message")) + '">' + esc(sheet.message || "") + "</textarea>" +
      '<label><input type="radio" name="gift-privacy" data-gift-privacy="public"' + (sheet.privacy === "public" ? " checked" : "") + "> " + esc(tr("Public gift")) + "</label>" +
      '<label><input type="radio" name="gift-privacy" data-gift-privacy="private"' + (sheet.privacy === "private" ? " checked" : "") + "> " + esc(tr("Only the recipient sees who sent it")) + "</label>" +
      '<label><input type="radio" name="gift-privacy" data-gift-privacy="anonymous"' + (sheet.privacy === "anonymous" ? " checked" : "") + "> " + esc(tr("Anonymous gift")) + "</label>" +
      (errorText ? '<p class="gift-error">' + esc(errorText) + "</p>" : "") +
      "</div></div>";
  }

  function giftsHtml(pack, mine) {
    if (!pack) return "";
    if (pack.hidden && !mine) return "";
    var grid = (pack.gifts || []).map(function (gift) {
      var who = gift.sender && gift.sender.name ? gift.sender.name : (gift.sender && gift.sender.handle ? gift.sender.handle : tr("Anonymous gift"));
      var hide = mine ? '<button type="button" data-gift="hide" data-id="' + esc(gift.id) + '">' + esc(gift.hidden ? tr("Show gift") : tr("Hide gift")) + "</button>" : "";
      return '<article class="gift-tile' + (gift.hidden ? " is-hidden" : "") + '"><span class="gift-art">' + svg(gift.svg) + '</span><b>' + esc(who) + "</b><p>" + esc(gift.message || "") + "</p>" + hide + "</article>";
    }).join("");
    var send = mine ? "" : '<button type="button" class="gift-send" data-gift="open" data-handle="' + esc(viewedHandle) + '">' + esc(tr("Send a gift")) + "</button>";
    var prefs = mine ? '<div class="gift-prefs"><label>' + esc(tr("Who can send you gifts")) + '</label><select data-gift-who><option value="everyone">' + esc(tr("Everyone")) + '</option><option value="followers">' + esc(tr("Followers")) + '</option><option value="nobody">' + esc(tr("Nobody")) + '</option></select><label class="gift-check"><input type="checkbox" data-gift-hide-tab' + (pack.hideTab ? " checked" : "") + "> " + esc(tr("Hide the Gifts tab")) + "</label></div>" : "";
    var empty = grid ? "" : '<p class="points-note">' + esc(tr("No gifts yet")) + "</p>";
    return '<div class="gifts-tab">' + send + prefs + empty + '<div class="gift-grid">' + grid + "</div></div>";
  }

  function showTab(account) {
    if (!account) return false;
    if (account.gifts && account.gifts.hidden) {
      var session = root.ViktorychAccounts && root.ViktorychAccounts.account && root.ViktorychAccounts.account();
      return !!(session && account.publicId && session.publicId === account.publicId);
    }
    return true;
  }

  function ensure(account) {
    if (!account || !account.handle || account.giftsLoading) return;
    viewedHandle = account.handle;
    if (account.giftsLoaded) return;
    account.giftsLoading = true;
    call("/v1/gifts?handle=" + encodeURIComponent(account.handle), { token: token() }).then(function (body) {
      account.giftsLoading = false;
      account.giftsLoaded = true;
      account.gifts = body && body.gifts ? body : { gifts: [], hidden: false };
      redraw();
    }).catch(function () {
      account.giftsLoading = false;
      account.giftsLoaded = true;
      account.gifts = { gifts: [], hidden: false };
    });
  }

  function openSheet(handle, extra) {
    extra = extra || {};
    sheet = {
      giftId: (catalog[0] && catalog[0].id) || "heart",
      handle: handle || "",
      message: "",
      privacy: "public",
      mode: extra.mode === "reply" || extra.mode === "dm" ? extra.mode : "direct",
      parentId: String(extra.parentId || "")
    };
    errorText = "";
    loadCatalog().then(redraw);
    redraw();
  }

  function confirmSend() {
    if (!sheet) return;
    var auth = token();
    if (!auth) { errorText = tr("Sign in"); redraw(); return; }
    call("/v1/gifts/send", {
      method: "POST",
      token: auth,
      body: { giftId: sheet.giftId, handle: sheet.handle, message: sheet.message, privacy: sheet.privacy, mode: sheet.mode || "direct", parentId: sheet.parentId || "" }
    }).then(function (body) {
      if (!body || (body.status && body.status >= 400)) {
        errorText = tr("Couldn’t send that gift.");
        redraw();
        return;
      }
      if (body.balance != null) balance = Number(body.balance) || 0;
      var mode = sheet.mode;
      var parentId = sheet.parentId;
      sheet = null;
      if (mode === "reply" && body.post && root.ProfileGifts && root.ProfileGifts.onReply) root.ProfileGifts.onReply(parentId, body.post);
      redraw();
    }).catch(function () {
      errorText = tr("Couldn’t send that gift.");
      redraw();
    });
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-gift]") : null;
    if (!el) return false;
    if (event.preventDefault) event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    var act = el.getAttribute("data-gift");
    if (act === "close") { sheet = null; errorText = ""; redraw(); return true; }
    if (act === "reply" || act === "dm" || act === "pick" || act === "open") {
      var mode = act === "reply" ? "reply" : (act === "dm" ? "dm" : "direct");
      openSheet(el.getAttribute("data-handle") || (sheet && sheet.handle) || "", { mode: mode, parentId: el.getAttribute("data-parent") || "" });
      if (act === "pick") sheet.giftId = el.getAttribute("data-gift-id") || sheet.giftId;
      redraw();
      return true;
    }
    if (act === "confirm") { confirmSend(); return true; }
    if (act === "hide") {
      call("/v1/gifts/" + el.getAttribute("data-id") + "/hide", { method: "POST", token: token() }).then(function () {
        var account = currentAccount();
        if (account) { account.giftsLoaded = false; ensure(account); }
      });
      return true;
    }
    return false;
  }

  function currentAccount() {
    try {
      var session = root.ViktorychAccounts && root.ViktorychAccounts.account && root.ViktorychAccounts.account();
      if (!session || !root.ViktorychAccounts.storedAccount) return session;
      return root.ViktorychAccounts.storedAccount(session.handle) || session;
    } catch (err) { return null; }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", function (event) {
      var el = event.target;
      if (!sheet || !el || !el.getAttribute) return;
      if (el.getAttribute("data-gift-field")) sheet[el.getAttribute("data-gift-field")] = el.value;
    }, true);
    document.addEventListener("change", function (event) {
      var el = event.target;
      if (!el || !el.getAttribute) return;
      if (el.getAttribute("data-gift-privacy")) {
        if (sheet) sheet.privacy = el.getAttribute("data-gift-privacy");
        return;
      }
      if (el.hasAttribute("data-gift-who") || el.hasAttribute("data-gift-hide-tab")) {
        var who = document.querySelector("[data-gift-who]");
        var hide = document.querySelector("[data-gift-hide-tab]");
        call("/v1/gifts/prefs", {
          method: "PUT",
          token: token(),
          body: { who: who ? who.value : "everyone", hideTab: !!(hide && hide.checked) }
        });
      }
    }, true);
  }

  root.ProfileGifts = {
    start: start,
    played: function (gameId) { touch("game", gameId); },
    pointsPage: pointsPage,
    storePage: storePage,
    dmBar: function () {
      return '<section class="gift-dm"><button class="primary" type="button" data-gift="dm">' + esc(tr("Send gift in a message")) + '</button><p class="phandle">' + esc(tr("A direct message gift uses the same privacy, limits, and points as any other gift.")) + "</p></section>";
    },
    giftsHtml: giftsHtml,
    showTab: showTab,
    ensure: ensure,
    open: openSheet,
    previewStore: function (items) { catalog = items || catalog; return storePage(); },
    overlay: function () { return sheetHtml(); },
    previewPoints: function (pack) {
      balance = pack.balance;
      rules = pack.rules || [];
      history = pack.history || [];
      return pointsPage();
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
