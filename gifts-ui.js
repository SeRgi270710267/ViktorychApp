/* Points and the free gift store. Amounts come from the worker. */
(function (root) {
  "use strict";

  var balance = null;
  var rules = [];
  var history = [];
  var catalog = [];
  var statusEmojis = [];
  var recent = [];
  var gifts = null;
  var sheet = null;
  var errorText = "";
  var started = false;
  var viewedHandle = "";
  var storeTab = "gifts";
  var storeQuery = "";
  var storePreview = null;
  var storeLoading = true;
  var peopleHits = [];
  var peopleTimer = 0;

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
      if (!body) return;
      if (body.gifts) catalog = body.gifts;
      if (body.statusEmojis) statusEmojis = body.statusEmojis;
      if (body.recent) recent = body.recent;
      if (body.balance != null) balance = Number(body.balance) || 0;
      storeLoading = false;
      paintBalance();
    }).catch(function () { storeLoading = false; });
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
    if (reason === "status_buy") return tr("Bought a status emoji");
    if (reason === "status_gift") return tr("Gifted a status emoji");
    if (reason === "birthday") return tr("Birthday bonus");
    return tr("Viktorychs");
  }

  function giftName(id) {
    if (id === "heart") return tr("Heart gift");
    if (id === "star") return tr("Star gift");
    if (id === "spark") return tr("Spark gift");
    if (id === "leaf") return tr("Leaf gift");
    if (id === "comet") return tr("Comet gift");
    if (id === "crown") return tr("Crown gift");
    if (id === "cake") return tr("Cake gift");
    if (id === "candle") return tr("Candle gift");
    return tr("Gift");
  }

  function emojiName(id) {
    if (id === "flame") return tr("Flame status");
    if (id === "party") return tr("Party status");
    if (id === "rocket") return tr("Rocket status");
    if (id === "rainbow") return tr("Rainbow status");
    if (id === "dragon") return tr("Dragon status");
    if (id === "gem") return tr("Gem status");
    if (id === "unicorn") return tr("Unicorn status");
    if (id === "regal") return tr("Crown status");
    return tr("Status emoji");
  }

  function marquee(label, long) {
    var text = String(label || "");
    if (!long) return esc(text);
    return '<span class="marquee"><span>' + esc(text) + '</span><span aria-hidden="true">' + esc(text) + "</span></span>";
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

  function storeItems() {
    var gifts = catalog.map(function (gift) {
      return {
        kind: "gift",
        id: gift.id,
        name: giftName(gift.id),
        price: gift.price,
        svg: gift.svg,
        emoji: "",
        popular: Number(gift.price) >= 50,
        fresh: !!gift.seasonal,
        owned: false,
        category: gift.category || ""
      };
    });
    var emojis = statusEmojis.map(function (item) {
      return {
        kind: "status",
        id: item.id,
        name: emojiName(item.id),
        price: item.price,
        svg: "",
        emoji: item.emoji,
        popular: !!item.popular,
        fresh: !!item.fresh,
        owned: !!item.owned,
        category: "status"
      };
    });
    var all = gifts.concat(emojis);
    var query = String(storeQuery || "").trim().toLowerCase();
    return all.filter(function (item) {
      if (storeTab === "gifts" && item.kind !== "gift") return false;
      if (storeTab === "status" && item.kind !== "status") return false;
      if (storeTab === "popular" && !item.popular) return false;
      if (storeTab === "new" && !item.fresh) return false;
      if (storeTab === "mine" && !(item.kind === "status" && item.owned)) return false;
      if (!query) return true;
      return (item.name + " " + item.emoji + " " + item.id).toLowerCase().indexOf(query) >= 0;
    });
  }

  function storeCard(item) {
    var art = item.emoji
      ? '<span class="store-art">' + esc(item.emoji) + "</span>"
      : '<span class="store-art gift-art">' + svg(item.svg) + "</span>";
    var owned = item.owned ? '<i class="store-owned">' + esc(tr("Owned")) + "</i>" : "";
    var send = '<button type="button" data-store="send" data-kind="' + esc(item.kind) + '" data-id="' + esc(item.id) + '">' + esc(tr("Quick send")) + "</button>";
    var equip = item.kind === "status" && item.owned
      ? '<button type="button" data-store="equip" data-id="' + esc(item.id) + '">' + esc(tr("Set as status")) + "</button>"
      : "";
    return '<div class="gift-card store-card"><button type="button" class="store-hit" data-store="preview" data-kind="' + esc(item.kind) + '" data-id="' + esc(item.id) + '">' + art + "<b>" + esc(item.name) + "</b><span>" + esc(tr("{n} Viktorychs", { n: String(item.price) })) + "</span>" + owned + '</button><div class="store-actions">' + send + equip + "</div></div>";
  }

  function previewBlock() {
    if (!storePreview) return "";
    var item = null;
    var pool = catalog.map(function (gift) {
      return { kind: "gift", id: gift.id, name: giftName(gift.id), price: gift.price, svg: gift.svg, emoji: "", owned: false };
    }).concat(statusEmojis.map(function (row) {
      return { kind: "status", id: row.id, name: emojiName(row.id), price: row.price, svg: "", emoji: row.emoji, owned: !!row.owned };
    }));
    pool.forEach(function (row) {
      if (row.kind === storePreview.kind && row.id === storePreview.id) item = row;
    });
    if (!item) return "";
    var art = item.emoji ? '<span class="store-art">' + esc(item.emoji) + "</span>" : '<span class="store-art gift-art">' + svg(item.svg) + "</span>";
    var buy = item.kind === "status"
      ? '<button type="button" class="store-buy" data-store="buy" data-id="' + esc(item.id) + '">' + esc(item.owned ? tr("Owned") : tr("Buy for me")) + "</button>"
      : "";
    return '<section class="store-preview" aria-label="' + esc(tr("Preview")) + '">' + art + "<b>" + esc(item.name) + "</b><p>" + esc(tr("{n} Viktorychs", { n: String(item.price) })) + "</p><p>" + esc(tr("Your balance")) + " <span data-points-balance>" + esc(balance == null ? "0" : String(balance)) + "</span></p>" + buy +
      '<button type="button" data-store="send" data-kind="' + esc(item.kind) + '" data-id="' + esc(item.id) + '">' + esc(tr("Send")) + "</button>" +
      (item.kind === "status" && item.owned ? '<button type="button" data-store="equip" data-id="' + esc(item.id) + '">' + esc(tr("Set as status")) + "</button>" : "") +
      '<button type="button" data-store="close-preview">' + esc(tr("Close")) + "</button>" +
      (errorText ? '<p class="gift-error">' + esc(errorText) + "</p>" : "") + "</section>";
  }

  function recentBlock() {
    if (!recent.length) return "";
    var rows = recent.map(function (item) {
      var art = item.emoji ? esc(item.emoji) : (item.svg ? svg(item.svg) : "");
      var who = item.name || item.handle || tr("Recipient");
      return '<li><span>' + art + "</span><b>" + esc(who) + "</b></li>";
    }).join("");
    return '<section class="store-recent"><h2>' + esc(tr("Recently sent")) + "</h2><ul>" + rows + "</ul></section>";
  }

  function storePage() {
    var tabs = [
      ["gifts", tr("Gifts")],
      ["status", tr("Status emojis")],
      ["popular", tr("Popular")],
      ["new", tr("New")],
      ["mine", tr("Collection")]
    ];
    var tabHtml = tabs.map(function (pair) {
      var on = storeTab === pair[0];
      var long = String(pair[1]).length > 14;
      return '<button type="button" class="store-tab' + (on ? " on" : "") + (long ? " is-long" : "") + '" data-store="tab" data-tab="' + pair[0] + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(pair[1]) + '">' + marquee(pair[1], long) + "</button>";
    }).join("");
    var items = storeItems();
    var grid = storeLoading
      ? '<p class="store-empty">' + esc(tr("Loading…")) + "</p>"
      : (items.length ? items.map(storeCard).join("") : '<p class="store-empty">' + esc(tr("Nothing in this tab")) + "</p>");
    var shown = balance == null ? "0" : String(balance);
    return '<div class="store-page"><div class="topbar"><div class="page-head"><h1>' + esc(tr("ViktorychStore")) + '</h1></div><div class="store-balance"><span>' + esc(tr("Your balance")) + '</span><b data-points-balance>' + esc(shown) + '</b><span>' + esc(tr("Viktorychs")) + '</span></div></div>' +
      '<div class="store-tabs" role="tablist">' + tabHtml + "</div>" +
      '<input class="store-search" data-store-q value="' + esc(storeQuery) + '" placeholder="' + esc(tr("Search the store")) + '" aria-label="' + esc(tr("Search the store")) + '">' +
      previewBlock() +
      '<div class="gift-grid store-grid">' + grid + "</div>" +
      recentBlock() + "</div>";
  }

  function sheetHtml() {
    if (!sheet) return "";
    var gift = null;
    var special = null;
    catalog.forEach(function (item) { if (item.id === sheet.giftId) gift = item; });
    statusEmojis.forEach(function (item) { if (item.id === sheet.giftId) special = item; });
    var title = sheet.kind === "status" ? tr("Send status emoji") : tr("Send a gift");
    var preview = "";
    if (sheet.kind === "status" && special) preview = '<p class="gift-preview"><span class="store-art">' + esc(special.emoji) + "</span><b>" + esc(emojiName(special.id)) + "</b><span>" + esc(tr("{n} Viktorychs", { n: String(special.price) })) + "</span></p>";
    else if (gift) preview = '<p class="gift-preview">' + svg(gift.svg) + "<b>" + esc(giftName(gift.id)) + "</b><span>" + esc(tr("{n} Viktorychs", { n: String(gift.price) })) + "</span></p>";
    return '<div class="gift-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="gift-sheet-bar"><button type="button" data-gift="close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(title) + '</h2><button type="button" data-gift="confirm">' + esc(tr("Send")) + '</button></div><div class="gift-sheet-body">' +
      preview +
      '<input data-gift-field="handle" value="' + esc(sheet.handle || "") + '" placeholder="' + esc(tr("Search people")) + '" aria-label="' + esc(tr("Search people")) + '">' +
      '<div class="store-people-slot">' + peopleList() + "</div>" +
      '<textarea data-gift-field="message" placeholder="' + esc(tr("Add a message")) + '" aria-label="' + esc(tr("Add a message")) + '">' + esc(sheet.message || "") + "</textarea>" +
      '<label><input type="radio" name="gift-privacy" data-gift-privacy="public"' + (sheet.privacy === "public" ? " checked" : "") + "> " + esc(tr("Public gift")) + "</label>" +
      '<label><input type="radio" name="gift-privacy" data-gift-privacy="private"' + (sheet.privacy === "private" ? " checked" : "") + "> " + esc(tr("Only the recipient sees who sent it")) + "</label>" +
      '<label><input type="radio" name="gift-privacy" data-gift-privacy="anonymous"' + (sheet.privacy === "anonymous" ? " checked" : "") + "> " + esc(tr("Anonymous gift")) + "</label>" +
      (errorText ? '<p class="gift-error">' + esc(errorText) + "</p>" : "") +
      "</div></div>";
  }

  function peopleList() {
    if (!peopleHits.length) return sheet && sheet.looked ? '<p class="store-empty">' + esc(tr("No matches")) + "</p>" : "";
    return '<div class="store-people">' + peopleHits.map(function (person) {
      return '<button type="button" data-store="pick-person" data-handle="' + esc(person.handle || "") + '">' + esc(person.name || person.handle || "") + "</button>";
    }).join("") + "</div>";
  }

  function giftsHtml(pack, mine) {
    if (!pack) return "";
    if (pack.hidden && !mine) return "";
    var grid = (pack.gifts || []).map(function (gift) {
      var who = gift.sender && gift.sender.name ? gift.sender.name : (gift.sender && gift.sender.handle ? gift.sender.handle : tr("Anonymous gift"));
      var hide = mine ? '<button type="button" data-gift="hide" data-id="' + esc(gift.id) + '">' + esc(gift.hidden ? tr("Show gift") : tr("Hide gift")) + "</button>" : "";
      var art = gift.emoji ? '<span class="gift-art gift-emoji">' + esc(gift.emoji) + "</span>" : '<span class="gift-art">' + svg(gift.svg) + "</span>";
      return '<article class="gift-tile' + (gift.hidden ? " is-hidden" : "") + '">' + art + "<b>" + esc(who) + "</b><p>" + esc(gift.message || "") + "</p>" + hide + "</article>";
    }).join("");
    var send = mine ? "" : '<button type="button" class="gift-send" data-gift="open" data-handle="' + esc(viewedHandle) + '">' + esc(tr("Send a gift")) + "</button>";
    var prefs = mine ? '<div class="gift-prefs"><label>' + esc(tr("Who can send you gifts")) + '</label><select data-gift-who><option value="everyone">' + esc(tr("Everyone")) + '</option><option value="followers">' + esc(tr("Followers")) + '</option><option value="nobody">' + esc(tr("Nobody")) + '</option><option value="list">' + esc(tr("Custom lists")) + '</option></select>' + (window.AudienceLists && window.AudienceLists.checksHtml ? window.AudienceLists.checksHtml([]) : "") + '<label class="gift-check"><input type="checkbox" data-gift-hide-tab' + (pack.hideTab ? " checked" : "") + "> " + esc(tr("Hide the Gifts tab")) + "</label></div>" : "";
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

  function watchBirthday(account) {
    if (!account || !account.handle || account.birthdayChecked) return;
    account.birthdayChecked = true;
    call("/v1/about?handle=" + encodeURIComponent(account.handle), { token: token() }).then(function (body) {
      account.birthdayToday = !!(body && body.status === 200 && body.birthdayToday);
      redraw();
    }).catch(function () { account.birthdayToday = false; });
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
      giftId: extra.giftId || (catalog[0] && catalog[0].id) || "heart",
      kind: extra.kind === "status" ? "status" : "gift",
      handle: handle || "",
      message: "",
      privacy: "public",
      mode: extra.mode === "reply" || extra.mode === "dm" ? extra.mode : "direct",
      parentId: String(extra.parentId || ""),
      looked: false
    };
    peopleHits = [];
    errorText = "";
    loadCatalog().then(redraw);
    redraw();
  }

  function confirmSend() {
    if (!sheet) return;
    var auth = token();
    if (!auth) { errorText = tr("Sign in"); redraw(); return; }
    var statusGift = sheet.kind === "status";
    call(statusGift ? "/v1/status-emoji/gift" : "/v1/gifts/send", {
      method: "POST",
      token: auth,
      body: statusGift
        ? { emojiId: sheet.giftId, handle: sheet.handle, message: sheet.message, privacy: sheet.privacy }
        : { giftId: sheet.giftId, handle: sheet.handle, message: sheet.message, privacy: sheet.privacy, mode: sheet.mode || "direct", parentId: sheet.parentId || "" }
    }).then(function (body) {
      if (!body || (body.status && body.status >= 400)) {
        if (body && body.error === "birthday") errorText = tr("That gift is only for their birthday.");
        else if (body && body.error === "balance") errorText = tr("Not enough Viktorychs.");
        else if (body && body.error === "owned") errorText = tr("They already have this emoji.");
        else errorText = statusGift ? tr("Couldn’t gift that emoji.") : tr("Couldn’t send that gift.");
        redraw();
        return;
      }
      if (body.balance != null) balance = Number(body.balance) || 0;
      loadCatalog();
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

  function findItem(kind, id) {
    var found = null;
    if (kind === "status") {
      statusEmojis.forEach(function (item) { if (item.id === id) found = item; });
    } else {
      catalog.forEach(function (item) { if (item.id === id) found = item; });
    }
    return found;
  }

  function buyEmoji(id) {
    var auth = token();
    if (!auth) { errorText = tr("Sign in"); redraw(); return; }
    call("/v1/status-emoji/buy", { method: "POST", token: auth, body: { emojiId: id } }).then(function (body) {
      if (!body || (body.status && body.status >= 400)) {
        errorText = body && body.error === "balance" ? tr("Not enough Viktorychs.") : tr("Couldn’t buy that emoji.");
        redraw();
        return;
      }
      if (body.balance != null) balance = Number(body.balance) || 0;
      errorText = "";
      loadCatalog().then(redraw);
    }).catch(function () {
      errorText = tr("Couldn’t buy that emoji.");
      redraw();
    });
  }

  function equipEmoji(id) {
    var item = findItem("status", id);
    if (!item) return;
    call("/v1/presence", { method: "PATCH", token: token(), body: { status: { emoji: item.emoji, text: "", clear: "never", audience: "everyone" } } }).then(function (body) {
      errorText = body && body.error === "owned" ? tr("This emoji is not in your collection.") : "";
      redraw();
    });
  }

  function searchPeople(query) {
    var text = String(query || "").replace(/^@/, "").trim();
    if (text.length < 1) { peopleHits = []; if (sheet) sheet.looked = false; redraw(); return; }
    call("/v1/people?q=" + encodeURIComponent(text), { token: token() }).then(function (body) {
      peopleHits = body && body.accounts ? body.accounts.slice(0, 6) : [];
      if (sheet) sheet.looked = true;
      var slot = document.querySelector(".store-people-slot");
      if (slot) slot.innerHTML = peopleList();
    }).catch(function () {
      peopleHits = [];
      if (sheet) sheet.looked = true;
      var slot = document.querySelector(".store-people-slot");
      if (slot) slot.innerHTML = peopleList();
    });
  }

  function onStoreClick(el) {
    var act = el.getAttribute("data-store");
    if (act === "tab") {
      storeTab = el.getAttribute("data-tab") || "gifts";
      redraw();
      return;
    }
    if (act === "preview") {
      storePreview = { kind: el.getAttribute("data-kind") || "gift", id: el.getAttribute("data-id") || "" };
      errorText = "";
      redraw();
      return;
    }
    if (act === "close-preview") {
      storePreview = null;
      errorText = "";
      redraw();
      return;
    }
    if (act === "send") {
      openSheet("", { kind: el.getAttribute("data-kind") || "gift", giftId: el.getAttribute("data-id") || "" });
      return;
    }
    if (act === "buy") { buyEmoji(el.getAttribute("data-id") || ""); return; }
    if (act === "equip") { equipEmoji(el.getAttribute("data-id") || ""); return; }
    if (act === "pick-person") {
      if (sheet) sheet.handle = el.getAttribute("data-handle") || "";
      peopleHits = [];
      redraw();
    }
  }

  function onClick(event) {
    var storeEl = event.target && event.target.closest ? event.target.closest("[data-store]") : null;
    if (storeEl) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      onStoreClick(storeEl);
      return true;
    }
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
    if (act === "birthday") {
      openSheet(el.getAttribute("data-handle") || "", { mode: "direct" });
      if (sheet) sheet.giftId = "cake";
      confirmSend();
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
      if (!el || !el.getAttribute) return;
      if (el.hasAttribute("data-store-q")) {
        storeQuery = el.value;
        var grid = document.querySelector(".store-grid");
        if (grid) {
          var items = storeItems();
          grid.innerHTML = storeLoading
            ? '<p class="store-empty">' + esc(tr("Loading…")) + "</p>"
            : (items.length ? items.map(storeCard).join("") : '<p class="store-empty">' + esc(tr("Nothing in this tab")) + "</p>");
        }
        return;
      }
      if (!sheet) return;
      if (el.getAttribute("data-gift-field")) {
        sheet[el.getAttribute("data-gift-field")] = el.value;
        if (el.getAttribute("data-gift-field") === "handle") {
          clearTimeout(peopleTimer);
          var query = el.value;
          peopleTimer = setTimeout(function () { searchPeople(query); }, 200);
        }
      }
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
          body: { who: who ? who.value : "everyone", hideTab: !!(hide && hide.checked), listIds: window.AudienceLists && window.AudienceLists.selectedLists ? window.AudienceLists.selectedLists(document) : [] }
        });
      }
    }, true);
  }

  root.ProfileGifts = {
    start: start,
    played: function (gameId) { touch("game", gameId); },
    pointsPage: pointsPage,
    storePage: storePage,
    banner: function (account) {
      watchBirthday(account);
      if (!account || !account.birthdayToday) return "";
      var session = root.ViktorychAccounts && root.ViktorychAccounts.account && root.ViktorychAccounts.account();
      var mine = !!(session && account.publicId && session.publicId === account.publicId);
      var send = mine ? "" : '<button type="button" data-gift="birthday" data-handle="' + esc(account.handle || "") + '">' + esc(tr("Send birthday gift")) + "</button>";
      return '<div class="bday-banner"><b>' + esc(tr("Birthday today")) + "</b>" + send + "</div>";
    },
    noteAction: function (note) {
      if (!note || note.kind !== "birthday" || !note.handle) return "";
      return '<button type="button" class="bday-send" data-gift="birthday" data-handle="' + esc(note.handle) + '">' + esc(tr("Send birthday gift")) + "</button>";
    },
    dmBar: function () {
      return '<section class="gift-dm"><button class="primary" type="button" data-gift="dm">' + esc(tr("Send gift in a message")) + '</button><p class="phandle">' + esc(tr("A direct message gift uses the same privacy, limits, and points as any other gift.")) + "</p></section>";
    },
    giftsHtml: giftsHtml,
    showTab: showTab,
    ensure: ensure,
    open: openSheet,
    previewStore: function (items, extra) {
      catalog = items || catalog;
      extra = extra || {};
      if (extra.statusEmojis) statusEmojis = extra.statusEmojis;
      if (extra.recent) recent = extra.recent;
      if (extra.balance != null) balance = extra.balance;
      if (extra.tab) storeTab = extra.tab;
      if (extra.preview) storePreview = extra.preview;
      if (extra.query != null) storeQuery = extra.query;
      storeLoading = false;
      return storePage();
    },
    overlay: function () { return sheetHtml(); },
    previewPoints: function (pack) {
      balance = pack.balance;
      rules = pack.rules || [];
      history = pack.history || [];
      return pointsPage();
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
