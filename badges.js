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

  function pill(card) {
    var tier = card.tier || "";
    var name = title(card.id);
    var mark = tier ? tierLabel(tier) : "";
    return '<span class="badge-pill' + (tier ? " tier-" + tier : "") + '">' + (mark ? esc(mark) + " · " : "") + esc(name) + "</span>";
  }

  function pinsHtml(account) {
    var data = pack(account);
    if (!data || !data.badges) return "";
    var pinned = data.badges.filter(function (card) { return card.earned && card.pinned; }).slice(0, 3);
    if (!pinned.length) return "";
    return '<span class="badge-pins">' + pinned.map(pill).join("") + "</span>";
  }

  function rowHtml(account) {
    var data = pack(account);
    var earned = data && data.badges ? data.badges.filter(function (card) { return card.earned; }) : [];
    var href = "#/@" + encodeURIComponent(account && account.handle || "") + "?tab=badges";
    if (!earned.length) {
      if (!account || !profileMine(account)) return "";
      return '<a class="badge-row badge-row-empty" href="' + esc(href) + '">' + esc(tr("Badges")) + "</a>";
    }
    return '<a class="badge-row" href="' + esc(href) + '">' + earned.slice(0, 6).map(pill).join("") + "</a>";
  }

  function profileMine(account) {
    var api = accounts();
    var session = api && api.account && api.account();
    if (!session || !account) return false;
    if (account.publicId && session.publicId) return account.publicId === session.publicId;
    return String(account.handle || "").toLowerCase() === String(session.handle || "").toLowerCase();
  }

  function bar(card) {
    var width = Math.round((Number(card.ratio) || 0) * 100);
    var next = card.nextTier ? tr("Next: {tier}", { tier: tierLabel(card.nextTier) }) : tierLabel(card.tier);
    var count = tr("{count} of {goal}", { count: card.progress || 0, goal: card.goal || 0 });
    return '<div class="badge-meter"><div class="badge-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + width + '"><span style="width:' + width + '%"></span></div><small>' + esc(next) + " · " + esc(count) + "</small></div>";
  }

  function audiencePills(card) {
    var modes = ["public", "followers", "mutuals", "lists", "only"];
    return '<div class="badge-aud">' + modes.map(function (mode) {
      var on = (card.audience || "public") === mode;
      return '<button type="button" class="badge-aud-pill' + (on ? " on" : "") + '" data-badge="audience" data-id="' + esc(card.id) + '" data-value="' + mode + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(audienceLabel(mode)) + "</button>";
    }).join("") + "</div>";
  }

  function html(account, mine) {
    ensure(account);
    var data = pack(account);
    if (!data) return '<div class="reply-empty">' + esc(tr("Loading…")) + "</div>";
    var list = (data.badges || []).slice();
    if (!mine) list = list.filter(function (card) { return card.earned; });
    if (!list.length) return '<div class="empty"><h2>' + esc(tr("Badges")) + "</h2><p>" + esc(tr("No badges yet")) + "</p></div>";
    return '<div class="badge-sheet">' + list.map(function (card) {
      var pin = "";
      var aud = "";
      if (mine && card.earned) {
        pin = '<button type="button" class="badge-pin' + (card.pinned ? " on" : "") + '" data-badge="pin" data-id="' + esc(card.id) + '" data-pinned="' + (card.pinned ? "1" : "0") + '">' + esc(card.pinned ? tr("Unpin") : tr("Pin")) + "</button>";
        aud = audiencePills(card);
      }
      return '<section class="badge-card' + (card.earned ? " earned" : "") + '">' +
        '<div class="badge-card-top">' + pill(card) + pin + "</div>" +
        '<p>' + esc(hint(card.id)) + "</p>" +
        (mine ? bar(card) : "") +
        aud +
        (data.note && data.noteId === card.id ? '<p class="badge-note">' + esc(data.note) + "</p>" : "") +
      "</section>";
    }).join("") + "</div>";
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

  function boot() {
    document.addEventListener("click", function (event) {
      var el = event.target && event.target.closest && event.target.closest("[data-badge]");
      if (!el) return;
      var api = accounts();
      if (!api || !api.call || !api.token || !api.token()) return;
      var act = el.getAttribute("data-badge");
      var id = el.getAttribute("data-id") || "";
      event.preventDefault();
      if (act === "pin") {
        var on = el.getAttribute("data-pinned") !== "1";
        api.call("/v1/badges/" + encodeURIComponent(id), {
          method: "PATCH",
          token: api.token(),
          body: { pinned: on }
        }).then(function (body) {
          if (body && body.status === 400 && body.error === "pins") {
            var session = api.account && api.account();
            var packId = session && String(session.handle || "").toLowerCase();
            if (packId && cache[packId]) {
              cache[packId].note = tr("You can pin 3 badges.");
              cache[packId].noteId = id;
              if (api.requestRender) api.requestRender();
            }
            return;
          }
          var session = api.account && api.account();
          if (session) delete cache[String(session.handle || "").toLowerCase()];
          if (api.requestRender) api.requestRender();
        }).catch(function () {});
        return;
      }
      if (act === "audience") {
        api.call("/v1/badges/" + encodeURIComponent(id), {
          method: "PATCH",
          token: api.token(),
          body: { audience: el.getAttribute("data-value") || "public" }
        }).then(function () {
          var session = api.account && api.account();
          if (session) delete cache[String(session.handle || "").toLowerCase()];
          if (api.requestRender) api.requestRender();
        }).catch(function () {});
      }
    });
    var api = accounts();
    if (api && api.token && api.token() && api.account && api.account()) ensure(api.account());
  }

  root.ProfileBadges = {
    ensure: ensure,
    html: html,
    pinsHtml: pinsHtml,
    rowHtml: rowHtml
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
