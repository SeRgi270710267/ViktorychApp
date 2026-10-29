/* Profile badges. The Worker awards tiers. This page only shows them. */
(function (root) {
  "use strict";

  var cache = {};
  var loading = {};
  var toastTimer = 0;

  function tr(key, vars) {
    var fn = root.t || (root.SI18n && root.SI18n.t);
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;";
    });
  }

  function accounts() {
    return root.ViktorychAccounts || null;
  }

  function title(id) {
    if (id === "member") return tr("Member");
    if (id === "streak") return tr("Login streak");
    if (id === "author") return tr("Posts");
    if (id === "voice") return tr("Comments");
    if (id === "signal") return tr("Reposts");
    if (id === "circle") return tr("Followers");
    if (id === "giver") return tr("Gifts sent");
    if (id === "kept") return tr("Gifts received");
    if (id === "story") return tr("Stories");
    if (id === "highlight") return tr("Highlights");
    if (id === "live") return tr("Went live");
    if (id === "early") return tr("Early adopter");
    if (id === "helpful") return tr("Helpful reports");
    return id;
  }

  function hint(id) {
    if (id === "member") return tr("Time since you joined");
    if (id === "streak") return tr("Days in a row you opened the app");
    if (id === "author") return tr("Posts you published");
    if (id === "voice") return tr("Comments you wrote");
    if (id === "signal") return tr("Posts you reposted");
    if (id === "circle") return tr("People who follow you");
    if (id === "giver") return tr("Gifts you sent");
    if (id === "kept") return tr("Gifts you received");
    if (id === "story") return tr("Stories you posted");
    if (id === "highlight") return tr("Highlights on your profile");
    if (id === "live") return tr("Times you went live");
    if (id === "early") return tr("Here before badges");
    if (id === "helpful") return tr("Reports that were acted on");
    return "";
  }

  function tierLabel(tier) {
    if (tier === "bronze") return tr("Bronze");
    if (tier === "silver") return tr("Silver");
    if (tier === "gold") return tr("Gold");
    return "";
  }

  function audienceLabel(id) {
    if (id === "followers") return tr("My followers");
    if (id === "mutuals") return tr("Mutuals");
    if (id === "lists") return tr("Custom lists");
    if (id === "only") return tr("Only me");
    return tr("Everyone");
  }

  function keyOf(account) {
    return String(account && account.handle || "").toLowerCase();
  }

  function pack(account) {
    return cache[keyOf(account)] || null;
  }

  var ICONS = {
    member: "\uD83D\uDCC5", streak: "\uD83D\uDD25", author: "\u270D\uFE0F", voice: "\uD83D\uDCAC",
    signal: "\uD83D\uDD01", circle: "\uD83D\uDC65", giver: "\uD83C\uDF81", kept: "\uD83D\uDC9D",
    story: "\u2B55", highlight: "\u2728", live: "\uD83D\uDD34", early: "\uD83C\uDF31", helpful: "\uD83D\uDEE1\uFE0F"
  };

  /* One plain line per badge: how it is earned. */
  function meaning(id) {
    if (id === "member") return tr("For how long you've been a member");
    if (id === "streak") return tr("For opening the app many days in a row");
    if (id === "author") return tr("For publishing posts");
    if (id === "voice") return tr("For writing comments");
    if (id === "signal") return tr("For reposting posts");
    if (id === "circle") return tr("For gaining followers");
    if (id === "giver") return tr("For sending gifts");
    if (id === "kept") return tr("For receiving gifts");
    if (id === "story") return tr("For posting stories");
    if (id === "highlight") return tr("For keeping highlights on your profile");
    if (id === "live") return tr("For going live");
    if (id === "early") return tr("For joining before badges existed");
    if (id === "helpful") return tr("For reports that were acted on");
    return hint(id);
  }

  function iconHtml(id, tier) {
    return '<span class="bdg-ico' + (tier ? " tier-" + tier : "") + '" aria-hidden="true">' + (ICONS[id] || "\u2B50") + "</span>";
  }

  function sub(card) {
    if (card.earned && card.tier) return tierLabel(card.tier) + " \u00B7 " + meaning(card.id);
    return meaning(card.id);
  }

  function rowHtml(card, mine) {
    var progress = "";
    if (mine && card.nextTier && card.goal) {
      var width = Math.max(0, Math.min(100, Math.round((Number(card.ratio) || 0) * 100)));
      progress = '<span class="bdg-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + width + '"><span style="width:' + width + '%"></span></span>';
    }
    var pin = mine && card.pinned ? '<span class="bdg-flag">' + esc(tr("Pinned")) + "</span>" : "";
    return '<button type="button" class="bdg-row' + (card.earned ? "" : " locked") + '" data-badge="open" data-id="' + esc(card.id) + '">' +
      iconHtml(card.id, card.earned ? card.tier : "") +
      '<span class="bdg-copy"><span class="bdg-name">' + esc(title(card.id)) + pin + '</span><span class="bdg-line">' + esc(sub(card)) + "</span>" + progress + "</span>" +
      '<span class="bdg-chev" aria-hidden="true">\u203A</span></button>';
  }

  function profileMine(account) {
    var api = accounts();
    var session = api && api.account && api.account();
    if (!session || !account) return false;
    if (account.publicId && session.publicId) return account.publicId === session.publicId;
    return String(account.handle || "").toLowerCase() === String(session.handle || "").toLowerCase();
  }

  var lastPack = null;
  var lastMine = false;

  function blockHtml(account) {
    ensure(account);
    var mine = profileMine(account);
    var data = pack(account);
    var head = '<div class="about-head"><h2>' + esc(tr("Badges")) + "</h2></div>";
    if (!data) {
      if (!mine) return "";
      return '<section class="about-section badge-block">' + head + '<p class="about-wait">' + esc(tr("Loading…")) + "</p></section>";
    }
    lastPack = data;
    lastMine = mine;
    var all = data.badges || [];
    var earned = all.filter(function (card) { return card.earned; });
    earned.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });
    var next = mine ? all.filter(function (card) { return !card.earned; }) : [];
    if (!earned.length && !next.length) {
      if (!mine) return "";
      return '<section class="about-section badge-block">' + head + '<p class="bdg-empty">' + esc(tr("No badges yet")) + "</p></section>";
    }
    var out = '<section class="about-section badge-block">' + head;
    if (earned.length) out += '<div class="bdg-list">' + earned.map(function (card) { return rowHtml(card, mine); }).join("") + "</div>";
    if (next.length) out += '<h3 class="bdg-sub">' + esc(tr("Still to earn")) + '</h3><div class="bdg-list">' + next.map(function (card) { return rowHtml(card, mine); }).join("") + "</div>";
    if (data && data.note) out += '<p class="badge-note">' + esc(data.note) + "</p>";
    return out + "</section>";
  }

  /* One small sheet explains any badge: name-row ticks, the org square,
     and every row in About me. */
  function sheet(opts) {
    var old = document.querySelector(".bdg-sheet");
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "bdg-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", opts.title || "");
    el.innerHTML = '<div class="bdg-card"><button type="button" class="bdg-x" data-bdg-close="1" aria-label="' + esc(tr("Close")) + '">\u00D7</button>' +
      '<div class="bdg-hero">' + (opts.iconHtml || "") + "</div>" +
      "<h2>" + esc(opts.title || "") + "</h2>" +
      (opts.line ? "<p>" + esc(opts.line) + "</p>" : "") +
      (opts.detail ? '<p class="bdg-detail">' + esc(opts.detail) + "</p>" : "") +
      (opts.extraHtml || "") +
      (opts.href ? '<a class="bdg-btn" href="' + esc(opts.href) + '" data-bdg-close="1">' + esc(opts.linkText || tr("View profile")) + "</a>" : "") +
      "</div>";
    document.body.appendChild(el);
    var x = el.querySelector(".bdg-x");
    if (x && x.focus) x.focus();
    return el;
  }

  function audienceSelect(card) {
    var modes = ["public", "followers", "mutuals", "lists", "only"];
    return '<label class="bdg-field"><span>' + esc(tr("Who can see it")) + '</span><select data-badge="audience" data-id="' + esc(card.id) + '">' + modes.map(function (mode) {
      return '<option value="' + mode + '"' + ((card.audience || "public") === mode ? " selected" : "") + ">" + esc(audienceLabel(mode)) + "</option>";
    }).join("") + "</select></label>";
  }

  function openCard(id) {
    var data = lastPack;
    var card = data && (data.badges || []).filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    var detail = "";
    if (lastMine) {
      var count = tr("{count} of {goal}", { count: card.progress || 0, goal: card.goal || 0 });
      if (card.nextTier && card.goal) detail = tr("Next: {tier}", { tier: tierLabel(card.nextTier) }) + " \u00B7 " + count;
      else if (card.earned) detail = tr("Highest level reached");
    }
    var extra = "";
    if (lastMine && card.earned) {
      extra = '<button type="button" class="bdg-btn ghost" data-badge="pin" data-id="' + esc(card.id) + '" data-pinned="' + (card.pinned ? "1" : "0") + '">' + esc(card.pinned ? tr("Unpin from top") : tr("Pin to top")) + "</button>" + audienceSelect(card);
    }
    sheet({
      iconHtml: iconHtml(card.id, card.earned ? card.tier : ""),
      title: title(card.id) + (card.earned && card.tier ? " \u00B7 " + tierLabel(card.tier) : ""),
      line: meaning(card.id),
      detail: detail,
      extraHtml: extra
    });
  }

  /* Name-row marks explain themselves on tap, the way X does. */
  function openMark(el) {
    var cls = el.classList;
    var ico = '<span class="bdg-ico mark">' + el.innerHTML + "</span>";
    if (cls.contains("exclusive")) return sheet({ iconHtml: ico, title: tr("Official account"), line: tr("This is the official account of this site.") });
    if (cls.contains("business")) return sheet({ iconHtml: ico, title: tr("Verified business"), line: tr("This account belongs to a verified organization.") });
    if (cls.contains("government")) return sheet({ iconHtml: ico, title: tr("Verified government"), line: tr("This account belongs to a government or multilateral organization.") });
    return sheet({ iconHtml: ico, title: tr("Verified account"), line: tr("This account is verified on the network it comes from.") });
  }

  function hasEarned(account) {
    var data = pack(account);
    return !!(data && data.badges && data.badges.some(function (card) { return card.earned; }));
  }

  function showToast(notice) {
    var old = document.querySelector(".badge-toast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "badge-toast";
    el.setAttribute("role", "status");
    el.textContent = tr("New badge") + " · " + title(notice.id) + " · " + tierLabel(notice.tier);
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (el.parentNode) el.remove(); }, 4200);
  }

  function ack(notice) {
    var api = accounts();
    if (!api || !api.call || !api.token || !api.token()) return;
    api.call("/v1/badges/seen", { method: "POST", token: api.token(), body: { id: notice.id, tier: notice.tier } }).catch(function () {});
  }

  function apply(handle, body) {
    cache[String(handle || "").toLowerCase()] = body || { badges: [] };
    var api = accounts();
    if (api && api.requestRender) api.requestRender();
  }

  function ensure(account) {
    var handle = account && account.handle;
    if (!handle) return;
    var id = keyOf(account);
    if (cache[id] || loading[id]) return;
    var api = accounts();
    if (!api || !api.call || !api.token || !api.token()) return;
    var mine = profileMine(account);
    var path = mine ? "/v1/badges" : ("/v1/badges?handle=" + encodeURIComponent(handle));
    loading[id] = true;
    api.call(path, { token: api.token() }).then(function (body) {
      delete loading[id];
      if (!body || body.status !== 200) {
        cache[id] = { badges: [] };
        return;
      }
      apply(handle, body);
      if (mine && body.notices && body.notices.length) {
        showToast(body.notices[0]);
        ack(body.notices[0]);
      }
    }).catch(function () { delete loading[id]; });
  }

  function patchBadge(id, body) {
    var api = accounts();
    if (!api || !api.call || !api.token || !api.token()) return Promise.resolve(null);
    return api.call("/v1/badges/" + encodeURIComponent(id), { method: "PATCH", token: api.token(), body: body }).then(function (res) {
      var session = api.account && api.account();
      var packId = session && String(session.handle || "").toLowerCase();
      if (res && res.status === 400 && res.error === "pins") {
        if (packId && cache[packId]) cache[packId].note = tr("You can pin 3 badges.");
      } else if (packId) {
        delete cache[packId];
      }
      var open = document.querySelector(".bdg-sheet");
      if (open) open.remove();
      if (api.requestRender) api.requestRender();
      return res;
    }).catch(function () { return null; });
  }

  function boot() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest("[data-bdg-close]") || target.classList.contains("bdg-sheet")) {
        var open = document.querySelector(".bdg-sheet");
        if (open) open.remove();
        if (!target.closest("a[href]")) event.preventDefault();
        return;
      }
      var mark = target.closest(".vbadge");
      if (mark && mark.closest(".byline, .pname, .hcard, .drawer-name, .name") && !mark.closest(".bdg-sheet")) {
        event.preventDefault();
        event.stopPropagation();
        openMark(mark);
        return;
      }
      var el = target.closest("[data-badge]");
      if (!el || el.tagName === "SELECT") return;
      var act = el.getAttribute("data-badge");
      var id = el.getAttribute("data-id") || "";
      event.preventDefault();
      if (act === "open") { openCard(id); return; }
      if (act === "pin") patchBadge(id, { pinned: el.getAttribute("data-pinned") !== "1" });
    }, true);
    document.addEventListener("change", function (event) {
      var el = event.target;
      if (!el || el.getAttribute("data-badge") !== "audience") return;
      patchBadge(el.getAttribute("data-id") || "", { audience: el.value || "public" });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var open = document.querySelector(".bdg-sheet");
      if (open) open.remove();
    });
    var api = accounts();
    if (api && api.token && api.token() && api.account && api.account()) ensure(api.account());
  }

  root.BadgeSheet = { open: sheet };
  root.ProfileBadges = {
    ensure: ensure,
    blockHtml: blockHtml,
    hasEarned: hasEarned
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
