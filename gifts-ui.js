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

  function tn(key, n, vars) { var f = (typeof window !== "undefined" && window.tn) || (typeof self !== "undefined" && self.tn); return f ? f(key, n, vars) : String(n); }
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
      if (body && body.trending && body.trending.length) {
        store.trending = body.trending;
        try { root.localStorage.setItem("vk-gift-trending", JSON.stringify(body.trending)); } catch (err) { /* private mode */ }
      }
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

  function svg(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
  }

  function pointsPage() {
    var earn = rules.map(function (rule) {
      var extra = rule.streak ? " · " + tr("streak bonus up to {n}", { n: String(rule.streak) }) : "";
      return "<li><b>" + esc(reasonLabel(rule.id)) + "</b><span>" + esc(tn("viktorychs", rule.points, { count: String(rule.points) })) + esc(extra) + "</span></li>";
    }).join("");
    var rows = history.map(function (item) {
      var sign = item.delta > 0 ? "+" : "";
      return '<div class="points-row"><span>' + esc(reasonLabel(item.reason)) + '</span><b>' + esc(sign + item.delta) + "</b></div>";
    }).join("");
    return '<div class="points-page"><div class="topbar"><div class="page-head"><h1>' + esc(tr("Viktorychs")) + '</h1></div></div><div class="points-balance"><b data-points-balance>' + esc(balance == null ? "0" : String(balance)) + '</b><span>' + esc(tr("Viktorychs")) + '</span></div><p class="points-note">' + esc(tr("Points are free. They are added by the app when you take part, and they cannot be bought.")) + '</p><a class="points-store" href="#/store">' + esc(tr("Gifts")) + '</a><h2>' + esc(tr("How to earn")) + "</h2><ul class=\"points-earn\">" + earn + "</ul><h2>" + esc(tr("History")) + "</h2>" + (rows || '<p class="points-note">' + esc(tr("No points yet")) + "</p>") + "</div>";
  }

  /* ---- Gifts page (VK-style shelves). Art comes from shared/gift-catalog.js. ---- */
  var store = { sub: "", query: "", searching: false, histTab: "received", received: null, sent: null, trending: null };
  try { store.trending = JSON.parse(root.localStorage.getItem("vk-gift-trending") || "null"); } catch (err) { store.trending = null; }

  function lib() { return root.GiftCatalog || null; }

  function sectionTitle(id) {
    if (id === "popular") return tr("Popular");
    if (id === "trending") return tr("Trending");
    if (id === "free") return tr("Free");
    if (id === "premium") return tr("Premium");
    if (id === "warm") return tr("Warm wishes");
    if (id === "party") return tr("Party");
    if (id === "love") return tr("In love");
    if (id === "flowers") return tr("Flowers");
    if (id === "cute") return tr("Cute");
    if (id === "birthday") return tr("Birthday");
    if (id === "treats") return tr("Treats");
    if (id === "halloween") return tr("Halloween");
    if (id === "christmas") return tr("Christmas");
    if (id === "newyear") return tr("New Year");
    if (id === "valentine") return tr("Valentine’s Day");
    if (id === "womensday") return tr("Women’s Day");
    if (id === "easter") return tr("Easter");
    if (id === "midsummer") return tr("Midsummer");
    if (id === "autumn") return tr("Autumn");
    if (id === "spring") return tr("Spring");
    if (id === "summer") return tr("Summer");
    if (id === "history") return tr("Gift history");
    return tr("Gifts");
  }

  var ICON = {
    back: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z",
    clock: "M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z",
    search: "M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
    chevron: "M9.3 5.3 10.7 3.9 18.8 12l-8.1 8.1-1.4-1.4 6.7-6.7z",
    close: "M18.3 5.7 16.9 4.3 12 9.2 7.1 4.3 5.7 5.7l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z",
    popular: "M12 2c1 3.5 5 5.6 5 10.5a5 5 0 0 1-10 0c0-1.6.6-3 1.6-4 .1 1.6 1 2.6 2 3C10 8.5 11.2 5.2 12 2zm0 3.9c-.6 1.8-1.3 3.7-.7 6.3l.3 1.3-1.3-.3a3.6 3.6 0 0 1-1.6-.8A3 3 0 0 0 9 12.5a3 3 0 0 0 6 0c0-3-1.9-4.8-3-6.6z",
    free: "M20 7h-2.2A3 3 0 0 0 12 4.4 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zm-5-1a1 1 0 1 1 0 2h-2a2 2 0 0 1 2-2zM9 6a2 2 0 0 1 2 2H9a1 1 0 1 1 0-2zM5 9h6v1H5V9zm1 3h5v7H6v-7zm7 7v-7h5v7h-5zm6-9h-6V9h6v1z",
    premium: "M7 3h10l4 6-9 12L3 9l4-6zm1.1 2L5.8 8.5h3.1L10.4 5H8.1zm5.5 0 1.5 3.5h3.1L15.9 5h-2.3zm-1.6.3L10.8 8.5h2.4L12 5.3zM6 10.5l4.6 6.1-1.8-6.1H6zm4.9 0L12 15.9l1.1-5.4h-2.2zm4.3 0-1.8 6.1 4.6-6.1h-2.8z",
    warm: "M11 1h2v3h-2V1zm0 19h2v3h-2v-3zM1 11h3v2H1v-2zm19 0h3v2h-3v-2zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zM18.4 4.2l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1zM6.3 16.3l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1zM12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    party: "M3 21l5.2-14.4 9.2 9.2L3 21zm4.3-4.3-1 2.9 2.9-1-1.9-1.9zm1.6-4.7-.9 2.6 3.5 3.5 2.6-.9-5.2-5.2zM14 2h2v3h-2V2zm5.6 2 1.4 1.4-2.1 2.1-1.4-1.4L19.6 4zM19 9h3v2h-3V9zm-6.2-2.8 1.4 1.4-1.4 1.4-1.4-1.4 1.4-1.4z",
    love: "M12 21s-8.5-5.1-8.5-11.2A4.8 4.8 0 0 1 12 6.5a4.8 4.8 0 0 1 8.5 3.3C20.5 15.9 12 21 12 21zm0-2.4c2.4-1.6 6.5-5 6.5-8.8a2.8 2.8 0 0 0-5.2-1.5L12 10l-1.3-1.7a2.8 2.8 0 0 0-5.2 1.5c0 3.8 4.1 7.2 6.5 8.8z",
    flowers: "M12 2a3.5 3.5 0 0 1 3.4 4.4 3.5 3.5 0 0 1 3 5.6 3.5 3.5 0 0 1-3 5.6A3.5 3.5 0 0 1 12 22a3.5 3.5 0 0 1-3.4-4.4 3.5 3.5 0 0 1-3-5.6 3.5 3.5 0 0 1 3-5.6A3.5 3.5 0 0 1 12 2zm0 2a1.5 1.5 0 0 0-1.4 2l.6 1.9-1.9-.3a1.5 1.5 0 0 0-1.2 2.6l1.5 1.3-1.5 1.3a1.5 1.5 0 0 0 1.2 2.6l1.9-.3-.6 1.9a1.5 1.5 0 1 0 2.8 0l-.6-1.9 1.9.3a1.5 1.5 0 0 0 1.2-2.6l-1.5-1.3 1.5-1.3a1.5 1.5 0 0 0-1.2-2.6l-1.9.3.6-1.9A1.5 1.5 0 0 0 12 4zm0 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
    cute: "M12 2a8 8 0 0 1 8 8v11l-2.7-1.6L14.7 21 12 19.4 9.3 21l-2.6-1.6L4 21V10a8 8 0 0 1 8-8zm0 2a6 6 0 0 0-6 6v7.4l.7-.4 2.6 1.6L12 17l2.7 1.6 2.6-1.6.7.4V10a6 6 0 0 0-6-6zM9 9a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 9 9zm6 0a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 15 9zm-5 4h4a2 2 0 0 1-4 0z",
    birthday: "M11 1.5c1 1.2 2 2.2 2 3.3a1.5 1.5 0 0 1-1 1.4V8h5a3 3 0 0 1 3 3v9h1v2H3v-2h1v-9a3 3 0 0 1 3-3h4V6.2a1.5 1.5 0 0 1-1-1.4c0-1.1 1-2.1 1-3.3zM7 10a1 1 0 0 0-1 1v2.4c.6.4 1.3.4 2 0a3.3 3.3 0 0 1 4 0c.6.4 1.4.4 2 0a3.3 3.3 0 0 1 4 0V11a1 1 0 0 0-1-1H7zm-1 5.6V20h12v-4.4a3.3 3.3 0 0 1-3 0c-.6-.4-1.4-.4-2 0a3.3 3.3 0 0 1-4 0c-.6-.4-1.4-.4-2 0a3.3 3.3 0 0 1-1 .4z",
    treats: "M4 8h13v2h1a3 3 0 0 1 0 6h-1.3A7 7 0 0 1 4 13V8zm2 2v3a5 5 0 0 0 10 0v-3H6zm11 2v2h1a1 1 0 0 0 0-2h-1zM7 2h2v4H7V2zm4 1h2v3h-2V3zM3 20h15v2H3v-2z"
  };

  function icon(name) {
    return '<svg class="vkg-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + (ICON[name] || "") + '"/></svg>';
  }

  /* Art for one gift: static Noto PNG, or the animated one when big is set.
     A failed image falls back (see the error listener below). */
  function artHtml(item, big) {
    var c = lib();
    if (!item) return "";
    if (!item.cp || !c) return item.svg ? svg(item.svg) : "";
    var src = big && item.anim ? c.animatedArt(item.cp) : c.staticArt(item.cp);
    return '<img class="vkg-img" src="' + esc(src) + '" data-gift-art="' + esc(item.cp) + '" alt="" loading="lazy" decoding="async" draggable="false" referrerpolicy="no-referrer">';
  }

  function giftLabel(item) {
    if (!item) return tr("Gift");
    return item.name ? tr(item.name) : giftName(item.id);
  }

  function allGifts() {
    var c = lib();
    if (c && c.GIFTS) return c.GIFTS;
    return catalog;
  }

  function findGift(id) {
    var found = null;
    allGifts().forEach(function (item) { if (item.id === id) found = item; });
    if (!found) catalog.forEach(function (item) { if (item.id === id) found = item; });
    return found;
  }

  function onShelf(item) {
    var c = lib();
    return c && item.cats ? c.onShelf(item) : true;
  }

  function giftsFor(id) {
    var c = lib();
    var list = allGifts();
    if (!c || !list.length || !list[0].cats) return id === "all" ? list : [];
    if (id === "popular" || id === "trending") {
      var ids = (store.trending && store.trending.length ? store.trending : c.POPULAR) || [];
      return ids.map(function (gid) { return c.giftById(gid); }).filter(function (item) { return item && onShelf(item); });
    }
    if (c.SEASONS[id]) return list.filter(function (item) { return item.cats.indexOf(id) >= 0; });
    return list.filter(function (item) { return c.inCategory(item, id) && onShelf(item); });
  }

  function priceLabel(item) {
    if (!item) return "";
    if (Number(item.price) === 0) return '<span class="vkg-price is-free">' + esc(tr("Free")) + "</span>";
    return '<span class="vkg-price">' + esc(tn("viktorychs", item.price, { count: String(item.price) })) + "</span>";
  }

  function tile(item) {
    return '<button type="button" class="gift-card vkg-item" data-gift="pick" data-gift-id="' + esc(item.id) + '" aria-label="' + esc(giftLabel(item)) + '"><span class="vkg-art">' + artHtml(item, false) + "</span>" + priceLabel(item) + "</button>";
  }

  function headerHtml(title, backHref) {
    var back = backHref
      ? '<a class="vkg-btn" href="' + esc(backHref) + '" aria-label="' + esc(tr("Back")) + '">' + icon("back") + "</a>"
      : '<button type="button" class="vkg-btn" data-act="back" aria-label="' + esc(tr("Back")) + '">' + icon("back") + "</button>";
    if (store.searching) {
      return '<div class="topbar vkg-top"><div class="vkg-head">' + back + '<input class="vkg-search" type="search" data-gift-search value="' + esc(store.query) + '" placeholder="' + esc(tr("Search gifts")) + '" aria-label="' + esc(tr("Search gifts")) + '" autocomplete="off" enterkeyhint="search"><button type="button" class="vkg-btn" data-gift="search-close" aria-label="' + esc(tr("Close")) + '">' + icon("close") + "</button></div></div>";
    }
    return '<div class="topbar vkg-top"><div class="vkg-head">' + back + '<h1 class="vkg-title">' + esc(title) + '</h1><a class="vkg-btn" href="#/store/history" aria-label="' + esc(tr("Gift history")) + '">' + icon("clock") + '</a><button type="button" class="vkg-btn" data-gift="search" aria-label="' + esc(tr("Search gifts")) + '">' + icon("search") + "</button></div></div>";
  }

  function chipsHtml() {
    var c = lib();
    if (!c) return "";
    return '<nav class="vkg-chips" aria-label="' + esc(tr("Gift categories")) + '">' + c.CHIPS.map(function (row) {
      return '<div class="vkg-chiprow">' + row.map(function (id) {
        return '<a class="vkg-chip" href="#/store/' + esc(id) + '">' + icon(id) + "<span>" + esc(sectionTitle(id)) + "</span></a>";
      }).join("") + "</div>";
    }).join("") + "</nav>";
  }

  function shelfHtml(id) {
    var items = giftsFor(id);
    if (!items.length) return "";
    return '<section class="vkg-shelf" data-shelf="' + esc(id) + '"><a class="vkg-shelf-head" href="#/store/' + esc(id) + '"><h2>' + esc(sectionTitle(id)) + "</h2>" + icon("chevron") + '</a><div class="vkg-row">' + items.map(tile).join("") + "</div></section>";
  }

  function balanceLine() {
    if (balance == null) return "";
    return '<a class="vkg-balance" href="#/points">' + esc(tn("viktorychBalance", balance, { count: String(balance) })) + "</a>";
  }

  function searchResults() {
    var q = store.query.trim().toLowerCase();
    if (!q) return '<p class="points-note vkg-empty">' + esc(tr("Type a gift name, like rose or cat.")) + "</p>";
    var hits = allGifts().filter(function (item) {
      if (!onShelf(item)) return false;
      var hay = (giftLabel(item) + " " + (item.name || "") + " " + item.id.replace(/_/g, " ") + " " + (item.cats || []).map(sectionTitle).join(" ")).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (!hits.length) return '<p class="points-note vkg-empty">' + esc(tr("No results")) + "</p>";
    return '<div class="vkg-grid">' + hits.map(tile).join("") + "</div>";
  }

  function historyRow(item, sent) {
    var gift = findGift(item.giftId) || { id: item.giftId, svg: item.svg, cp: item.cp };
    if (!gift.cp && item.cp) gift = { id: gift.id, name: gift.name, svg: item.svg, cp: item.cp, anim: gift.anim };
    var person = sent ? item.recipient : item.sender;
    var who = person ? (person.name || (person.handle ? "@" + person.handle : "")) : tr("Anonymous gift");
    var line = sent ? tr("To {name}", { name: who }) : tr("From {name}", { name: who });
    var when = item.at ? new Date(item.at).toLocaleDateString((window.SI18n ? window.SI18n.locale() : undefined)) : "";
    return '<div class="vkg-hrow"><span class="vkg-hart">' + artHtml(gift, false) + '</span><div class="vkg-htext"><b>' + esc(giftLabel(gift)) + "</b><span>" + esc(line) + (when ? " · " + esc(when) : "") + "</span>" + (item.message ? "<p>" + esc(item.message) + "</p>" : "") + "</div></div>";
  }

  function loadHistory() {
    var auth = token();
    if (!auth) return;
    if (store.received == null) {
      store.received = "loading";
      call("/v1/gifts", { token: auth }).then(function (body) {
        store.received = body && body.gifts ? body.gifts : [];
        redraw();
      }).catch(function () { store.received = []; redraw(); });
    }
    if (store.sent == null) {
      store.sent = "loading";
      call("/v1/gifts/sent", { token: auth }).then(function (body) {
        store.sent = body && body.gifts ? body.gifts : [];
        redraw();
      }).catch(function () { store.sent = []; redraw(); });
    }
  }

  function historyHtml() {
    if (!token()) return '<p class="points-note vkg-empty">' + esc(tr("Sign in to see the gifts you sent and received.")) + "</p>";
    loadHistory();
    var sent = store.histTab === "sent";
    var list = sent ? store.sent : store.received;
    var tabs = '<div class="vkg-tabs" role="tablist"><button type="button" role="tab" data-gift="hist" data-tab="received" aria-selected="' + (!sent) + '"' + (!sent ? ' class="is-on"' : "") + ">" + esc(tr("Received")) + '</button><button type="button" role="tab" data-gift="hist" data-tab="sent" aria-selected="' + sent + '"' + (sent ? ' class="is-on"' : "") + ">" + esc(tr("Sent")) + "</button></div>";
    var body;
    if (list === "loading" || list == null) body = '<p class="points-note vkg-empty">' + esc(tr("Loading…")) + "</p>";
    else if (!list.length) body = '<p class="points-note vkg-empty">' + esc(sent ? tr("You haven’t sent any gifts yet.") : tr("No gifts yet")) + "</p>";
    else body = list.map(function (item) { return historyRow(item, sent); }).join("");
    return tabs + '<div class="vkg-hist">' + body + "</div>";
  }

  function storePage(route) {
    var sub = route && route.sub ? String(route.sub) : "";
    if (sub !== store.sub) {
      store.sub = sub;
      store.searching = false;
      store.query = "";
      if (sub === "history") { store.received = null; store.sent = null; }
    }
    var c = lib();
    var body;
    var title = sub ? sectionTitle(sub) : tr("Gifts");
    var backHref = sub ? "#/store" : "";
    if (store.searching) body = '<div data-gift-results>' + searchResults() + "</div>";
    else if (sub === "history") body = historyHtml();
    else if (sub) {
      var items = giftsFor(sub);
      body = items.length ? '<div class="vkg-grid">' + items.map(tile).join("") + "</div>" : '<p class="points-note vkg-empty">' + esc(tr("No gifts here right now.")) + "</p>";
    } else if (!c || !allGifts().length || !allGifts()[0].cats) {
      body = '<section class="vkg-shelf"><div class="vkg-row">' + allGifts().map(tile).join("") + "</div></section>";
    } else {
      var shelves = c.activeSeasons().concat(["trending"]).concat(c.CATEGORIES.filter(function (id) { return id !== "trending"; }));
      body = chipsHtml() + balanceLine() + shelves.map(shelfHtml).join("");
    }
    var credit = '<p class="vkg-credit">' + esc(tr("Gift art: Noto Emoji by Google (Apache 2.0, animated CC BY 4.0).")) + "</p>";
    return '<div class="store-page vkg-page">' + headerHtml(title, backHref) + body + credit + "</div>";
  }

  function sheetHtml() {
    if (!sheet) return "";
    var gift = findGift(sheet.giftId);
    return '<div class="gift-sheet" role="dialog" aria-modal="true" aria-label="' + esc(tr("Send a gift")) + '"><div class="gift-sheet-bar"><button type="button" data-gift="close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(tr("Send a gift")) + '</h2><button type="button" data-gift="confirm">' + esc(tr("Send")) + '</button></div><div class="gift-sheet-body">' +
      (gift ? '<p class="gift-preview"><span class="vkg-art is-big">' + artHtml(gift, true) + "</span><b>" + esc(giftLabel(gift)) + "</b>" + priceLabel(gift) + "</p>" : "") +
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
      return '<article class="gift-tile' + (gift.hidden ? " is-hidden" : "") + '"><span class="gift-art">' + artHtml(gift, false) + '</span><b>' + esc(who) + "</b><p>" + esc(gift.message || "") + "</p>" + hide + "</article>";
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
        var code = body && body.error;
        errorText = code === "birthday" ? tr("That gift is only for their birthday.")
          : code === "free_limit" ? tr("You’ve used today’s free gifts. Try again tomorrow.")
          : code === "balance" ? tr("Not enough Viktorychs for this gift.")
          : tr("Couldn’t send that gift.");
        redraw();
        return;
      }
      if (body.balance != null) balance = Number(body.balance) || 0;
      store.sent = null;
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
    if (act === "birthday") {
      openSheet(el.getAttribute("data-handle") || "", { mode: "direct" });
      if (sheet) sheet.giftId = "cake";
      confirmSend();
      return true;
    }
    if (act === "confirm") { confirmSend(); return true; }
    if (act === "search") { store.searching = true; store.query = ""; redraw(); focusSearch(); return true; }
    if (act === "search-close") { store.searching = false; store.query = ""; redraw(); return true; }
    if (act === "hist") { store.histTab = el.getAttribute("data-tab") === "sent" ? "sent" : "received"; redraw(); return true; }
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

  function focusSearch() {
    setTimeout(function () {
      var input = document.querySelector("[data-gift-search]");
      if (input) { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* search inputs */ } }
    }, 0);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    /* Art fallback: animated -> static PNG -> the emoji character. */
    document.addEventListener("error", function (event) {
      var img = event.target;
      if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-gift-art")) return;
      var c = lib();
      var cp = img.getAttribute("data-gift-art");
      if (c && img.src.indexOf("gstatic") >= 0) { img.src = c.staticArt(cp); return; }
      var span = document.createElement("span");
      span.className = "vkg-emoji";
      span.textContent = c ? c.emojiChar(cp) : "";
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    }, true);
    if (typeof window !== "undefined") window.addEventListener("giftcatalog", function () { redraw(); });
    document.addEventListener("input", function (event) {
      var el = event.target;
      if (el && el.hasAttribute && el.hasAttribute("data-gift-search")) {
        store.query = el.value;
        var box = document.querySelector("[data-gift-results]");
        if (box) box.innerHTML = searchResults();
        return;
      }
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
    previewStore: function (items, route) { catalog = items || catalog; return storePage(route); },
    artHtml: artHtml,
    findGift: findGift,
    overlay: function () { return sheetHtml(); },
    previewPoints: function (pack) {
      balance = pack.balance;
      rules = pack.rules || [];
      history = pack.history || [];
      return pointsPage();
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
