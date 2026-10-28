/* Affiliation badges next to a display name.
   The page only shows a grant the Worker already made. */
(function (root) {
  "use strict";

  var cache = {};
  var pending = {};

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

  function slot(publicId) {
    if (!/^\d{12}$/.test(String(publicId || ""))) return "";
    return '<button type="button" class="aff-slot" data-aff-for="' + publicId + '" hidden></button>';
  }

  function badgeButton(item) {
    return '<button type="button" class="aff-badge" data-aff-open="' + esc(item.id) + '" data-aff-name="' + esc(item.name) + '" data-aff-logo="' + esc(item.logo) + '" data-aff-href="' + esc(item.href || "") + '" aria-label="' + esc(tr("Affiliated with {name}", { name: item.name })) + '"><img src="' + esc(item.logo) + '" alt=""></button>';
  }

  function paint() {
    var ids = [];
    document.querySelectorAll("[data-aff-for], [data-aff-about]").forEach(function (el) {
      var id = el.getAttribute("data-aff-for") || el.getAttribute("data-aff-about") || "";
      if (/^\d{12}$/.test(id) && ids.indexOf(id) < 0) ids.push(id);
    });
    if (!ids.length) return;
    var missing = ids.filter(function (id) { return !cache[id] && !pending[id]; });
    if (missing.length) load(missing);
    ids.forEach(fill);
  }

  function load(ids) {
    var api = accounts();
    if (!api || !api.call || !api.token || !api.token()) return;
    var key = ids.join(",");
    pending[key] = true;
    ids.forEach(function (id) { pending[id] = true; });
    api.call("/v1/affiliations?ids=" + ids.join(","), { token: api.token() }).then(function (body) {
      ids.forEach(function (id) { delete pending[id]; });
      if (!body || body.status !== 200) return;
      var accountsMap = body.accounts || {};
      ids.forEach(function (id) { cache[id] = accountsMap[id] || []; });
      ids.forEach(fill);
    }).catch(function () {
      ids.forEach(function (id) { delete pending[id]; });
    });
  }

  function fill(id) {
    var list = cache[id];
    if (!list) return;
    document.querySelectorAll('[data-aff-for="' + id + '"]').forEach(function (el) {
      if (!list.length) {
        el.hidden = true;
        el.innerHTML = "";
        return;
      }
      el.hidden = false;
      el.innerHTML = list.map(badgeButton).join("");
    });
    document.querySelectorAll('[data-aff-about="' + id + '"]').forEach(function (el) {
      el.hidden = !list.length;
      el.innerHTML = list.length ? aboutBlock(list, id) : "";
    });
  }

  function aboutBlock(list, id) {
    var mine = false;
    var api = accounts();
    var session = api && api.account && api.account();
    if (session && session.publicId === id) mine = true;
    return '<div class="about-head"><h2>' + esc(tr("Affiliation")) + "</h2></div>" + list.map(function (item) {
      var controls = "";
      if (mine) {
        controls = '<button type="button" class="aff-pill" data-aff-hide="' + esc(item.id) + '" data-hidden="' + (item.hidden ? "1" : "0") + '">' + esc(item.hidden ? tr("Show affiliation badge") : tr("Hide affiliation badge")) + "</button>" +
          '<div class="aff-pills">' + ["public", "followers", "mutuals", "only"].map(function (mode) {
            var on = (item.audience || "public") === mode;
            var label = mode === "followers" ? tr("Followers") : mode === "mutuals" ? tr("Mutuals") : mode === "only" ? tr("Only me") : tr("Everyone");
            return '<button type="button" class="aff-pill' + (on ? " on" : "") + '" data-aff-audience="' + esc(item.id) + '" data-value="' + mode + '">' + esc(label) + "</button>";
          }).join("") + "</div>";
      }
      return '<div class="aff-about-row">' + badgeButton(item) + '<span>' + esc(tr("Affiliated with {name}", { name: item.name })) + "</span></div>" + controls;
    }).join("");
  }

  function adminHtml() {
    return '<h2>' + esc(tr("Affiliations")) + '</h2><p class="set-sub">' + esc(tr("Only an admin can grant or revoke an affiliation.")) + '</p><form data-aff-admin="1"><input type="text" data-aff-handle maxlength="15" placeholder="' + esc(tr("Account")) + '" aria-label="' + esc(tr("Account")) + '"><button type="submit" data-aff-do="grant">' + esc(tr("Grant affiliation")) + '</button><button type="button" data-aff-do="revoke">' + esc(tr("Revoke affiliation")) + "</button></form>";
  }

  function openSheet(button) {
    var old = document.querySelector(".aff-sheet");
    if (old) old.remove();
    var sheet = document.createElement("div");
    sheet.className = "aff-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", button.getAttribute("data-aff-name") || "");
    var href = button.getAttribute("data-aff-href") || "";
    var link = href ? '<a href="' + esc(href) + '">' + esc(tr("View profile")) + "</a>" : "";
    sheet.innerHTML = '<div class="aff-sheet-card"><button type="button" data-aff-close="1" aria-label="' + esc(tr("Close")) + '">×</button><img src="' + esc(button.getAttribute("data-aff-logo") || "") + '" alt=""><b>' + esc(button.getAttribute("data-aff-name") || "") + "</b>" + link + "</div>";
    document.body.appendChild(sheet);
  }

  function patch(id, body) {
    var api = accounts();
    if (!api || !api.call || !api.token || !api.token()) return;
    api.call("/v1/affiliations/me/" + encodeURIComponent(id), { method: "PATCH", token: api.token(), body: body }).then(function () {
      delete cache[api.account && api.account() ? api.account().publicId : ""];
      if (api.requestRender) api.requestRender();
    }).catch(function () {});
  }

  function boot() {
    document.addEventListener("click", function (event) {
      var open = event.target && event.target.closest && event.target.closest("[data-aff-open]");
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        openSheet(open);
        return;
      }
      var closer = event.target && event.target.closest && event.target.closest("[data-aff-close]");
      if (closer || (event.target && event.target.classList && event.target.classList.contains("aff-sheet"))) {
        var sheet = document.querySelector(".aff-sheet");
        if (sheet) sheet.remove();
      }
      var hide = event.target && event.target.closest && event.target.closest("[data-aff-hide]");
      if (hide) {
        event.preventDefault();
        patch(hide.getAttribute("data-aff-hide"), { hidden: hide.getAttribute("data-hidden") !== "1" });
        return;
      }
      var audience = event.target && event.target.closest && event.target.closest("[data-aff-audience]");
      if (audience) {
        event.preventDefault();
        patch(audience.getAttribute("data-aff-audience"), { audience: audience.getAttribute("data-value") || "public" });
        return;
      }
      var act = event.target && event.target.closest && event.target.closest("[data-aff-do]");
      if (!act) return;
      event.preventDefault();
      var form = act.closest("form");
      var field = form && form.querySelector("[data-aff-handle]");
      var handle = field ? String(field.value || "").trim() : "";
      var api = accounts();
      if (!handle || !api || !api.call || !api.token || !api.token()) return;
      api.call("/v1/affiliations/grant", {
        method: "POST",
        token: api.token(),
        body: { affiliationId: "viktorych", handle: handle, grant: act.getAttribute("data-aff-do") !== "revoke" }
      }).catch(function () {});
    });
  }

  root.ViktorychAffiliations = {
    slot: slot,
    paint: paint,
    adminHtml: adminHtml,
    aboutHtml: function (account) {
      var id = account && account.publicId;
      if (!/^\d{12}$/.test(String(id || ""))) return "";
      return '<section class="about-section aff-about" data-aff-about="' + id + '" hidden></section>';
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
