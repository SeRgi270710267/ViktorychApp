/* Display names: several names, who sees which one, show-to and hide-from
   rules and "Preview as" live in Edit profile > Display names
   (profileHtml), next to Usernames. Each person sees exactly one name; the
   most specific audience wins and an excluded name falls back to a broader
   one. Everything is enforced by the server; this only edits. */
(function (root) {
  "use strict";

  var deps = {};
  var data = null;
  var lists = [];
  var openId = "";
  var preview = null;
  var note = "";
  var asked = false;

  function tr(key, vars) {
    var fn = root.t || (typeof window !== "undefined" && window.t);
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function call(path, opts) {
    if (!deps.api) return Promise.resolve({ status: 503 });
    var next = opts || {};
    try { if (!next.token && deps.token) next.token = deps.token(); } catch (err) { /* signed out */ }
    return deps.api(path, next);
  }

  var watchers = [];
  function redraw() {
    if (deps.render) deps.render();
    watchers.forEach(function (fn) { try { fn(); } catch (err) { /* one painter failing never blocks the rest */ } });
  }

  /* Typed text and ticked boxes survive a re-render. */
  var drafts = {};
  function draftKey(el) {
    var attrs = Array.prototype.filter.call(el.attributes, function (a) { return a.name.indexOf("data-dn-") === 0; });
    if (!attrs.length) return "";
    var wrap = el.closest(".dn-edit");
    return (wrap ? wrap.getAttribute("data-dn-id") : "") + "|" + attrs.map(function (a) { return a.name + "=" + a.value; }).join("|");
  }
  function keep(event) {
    var el = event.target;
    if (!el || !el.closest || !el.closest(".dn-settings")) return;
    var key = draftKey(el);
    if (key) drafts[key] = el.type === "checkbox" ? { checked: el.checked } : { value: el.value };
  }
  function restore() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".dn-settings").forEach(function (wrap) {
      wrap.querySelectorAll("input, select").forEach(function (el) {
        var d = drafts[draftKey(el)];
        if (!d) return;
        if ("checked" in d) el.checked = d.checked;
        else el.value = d.value;
      });
    });
  }
  function settle() { drafts = {}; }

  function errorText(code) {
    if (code === "invalid_name") return tr("Names can be up to 50 characters.");
    if (code === "name_cap") return tr("You've reached the most display names an account can have.");
    if (code === "primary_name") return tr("Make another name your main name first.");
    if (code === "rate_limited") return tr("Too many changes. Try again later.");
    return tr("Something went wrong. Try again.");
  }

  function said(res) {
    if (res && res.status >= 200 && res.status < 300) { note = ""; return true; }
    var code = res && (res.error || (res.status === 429 ? "rate_limited" : ""));
    note = errorText(code);
    redraw();
    return false;
  }

  function load() {
    return Promise.all([call("/v1/display-names"), call("/v1/audience-lists")]).then(function (got) {
      if (got[0] && got[0].status === 200) data = got[0];
      if (got[1] && got[1].status === 200) lists = got[1].lists || [];
      redraw();
    }).catch(function () {});
  }

  function ready() {
    if (!asked) { asked = true; load(); }
    if (typeof Promise !== "undefined") Promise.resolve().then(restore);
  }

  function listName(id) {
    for (var i = 0; i < lists.length; i++) if (lists[i].id === id) return (lists[i].icon ? lists[i].icon + " " : "") + lists[i].name;
    return "";
  }

  function summary(aud) {
    var inc = (aud && aud.include) || {};
    var exc = (aud && aud.exclude) || {};
    var parts = [];
    if (inc.people && inc.people.length) parts.push(tr("Specific people"));
    (inc.lists || []).forEach(function (id) { var n = listName(id); if (n) parts.push(n); });
    if (inc.friends) parts.push(tr("Friends"));
    if (inc.followers) parts.push(tr("Followers"));
    if (inc.public) parts.push(tr("Public"));
    var text = parts.length ? parts.join(", ") : tr("No one");
    var hidden = (exc.followers || exc.friends || (exc.lists || []).length || (exc.people || []).length);
    return hidden ? text + " · " + tr("with exceptions") : text;
  }

  function box(attr, on, label) {
    return '<label class="un-check"><input type="checkbox" ' + attr + (on ? " checked" : "") + "> " + esc(label) + "</label>";
  }

  function editor(item) {
    var aud = item.audience || { include: {}, exclude: {} };
    var inc = aud.include || {};
    var exc = aud.exclude || {};
    var id = esc(item.id);
    var listBoxes = function (side, picked) {
      return lists.map(function (list) {
        return box('data-dn-' + side + '-list="' + esc(list.id) + '"', (picked || []).indexOf(list.id) >= 0, listName(list.id));
      }).join("");
    };
    var nameField = item.primary
      ? '<p class="phandle">' + esc(tr("This is your main name. Change it in Name on Edit profile.")) + "</p>"
      : '<input class="un-input dn-name-input" data-dn-name aria-label="' + esc(tr("Display name")) + '" maxlength="50" value="' + esc(item.name) + '">';
    return '<div class="un-edit dn-edit" data-dn-id="' + id + '">' + nameField +
      "<h3>" + esc(tr("Who sees this name")) + "</h3>" +
      box('data-dn-inc="public"', inc.public, tr("Public")) +
      box('data-dn-inc="followers"', inc.followers, tr("Followers")) +
      box('data-dn-inc="friends"', inc.friends, tr("Friends")) +
      listBoxes("inc", inc.lists) +
      '<input class="un-people" data-dn-side="inc" aria-label="' + esc(tr("Specific people")) + '" placeholder="' + esc(tr("Specific people, like @name, @other")) + '" value="' + esc((inc.people || []).map(function (p) { return "@" + p; }).join(", ")) + '">' +
      "<h3>" + esc(tr("Never show it to")) + "</h3>" +
      box('data-dn-exc="followers"', exc.followers, tr("Followers")) +
      box('data-dn-exc="friends"', exc.friends, tr("Friends")) +
      listBoxes("exc", exc.lists) +
      '<input class="un-people" data-dn-side="exc" aria-label="' + esc(tr("Hide from people")) + '" placeholder="' + esc(tr("Specific people, like @name, @other")) + '" value="' + esc((exc.people || []).map(function (p) { return "@" + p; }).join(", ")) + '">' +
      '<div class="un-actions"><button type="button" class="un-btn" data-dn="save" data-id="' + id + '">' + esc(tr("Save")) + "</button>" +
      (item.primary ? "" : '<button type="button" class="un-btn outline" data-dn="primary" data-id="' + id + '">' + esc(tr("Make main name")) + "</button>" +
        '<button type="button" class="un-btn outline danger" data-dn="remove" data-id="' + id + '">' + esc(tr("Remove")) + "</button>") +
      "</div></div>";
  }

  function previewHtml() {
    var opts = [["public", tr("Public")], ["followers", tr("Followers")], ["friends", tr("Friends")]].concat(lists.map(function (list) { return ["list:" + list.id, listName(list.id)]; }));
    var result = "";
    if (preview) result = '<p class="un-preview-out" role="status">' + esc(preview.hidden ? tr("They see no display name, only your username.") : tr("They see “{name}”", { name: preview.name })) + "</p>";
    return "<h2>" + esc(tr("Preview as")) + "</h2>" +
      '<div class="un-row"><select class="un-select" data-dn-preview-tier aria-label="' + esc(tr("Preview as")) + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="un-btn outline" data-dn="preview-tier">' + esc(tr("Preview")) + "</button></div>" +
      '<div class="un-row"><input class="un-input" data-dn-preview-person aria-label="' + esc(tr("Preview as person")) + '" placeholder="' + esc(tr("Preview as person, like @name")) + '">' +
      '<button type="button" class="un-btn outline" data-dn="preview-person">' + esc(tr("Preview")) + "</button></div>" + result;
  }

  function profileHtml() {
    ready();
    if (!data) return '<div class="un-settings dn-settings un-in-edit"><p class="phandle">' + esc(tr("Loading")) + "</p></div>";
    var cards = (data.names || []).map(function (item) {
      var open = openId === item.id;
      return '<section class="un-card dn-card"><button type="button" class="un-name" data-dn="toggle" data-id="' + esc(item.id) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        '<span class="un-at dn-shown">' + esc(item.name) + "</span>" + (item.primary ? '<span class="un-badge">' + esc(tr("Main")) + "</span>" : "") +
        '<span class="un-who">' + esc(summary(item.audience)) + "</span></button>" + (open ? editor(item) : "") + "</section>";
    }).join("");
    return '<div class="un-settings dn-settings un-in-edit">' +
      '<p class="phandle">' + esc(tr("Each person sees exactly one of your display names. The most specific audience wins: a person, then a list, then friends, then followers, then public. If a name is hidden from someone, they see a broader one.")) + "</p>" +
      '<p class="phandle">' + esc(tr("Nicknames people give you privately still win in their own view.")) + "</p>" +
      (note ? '<p class="un-note" role="alert">' + esc(note) + "</p>" : "") + cards +
      ((data.names || []).length < (data.cap || 5) ? '<div class="un-row"><input class="un-input" data-dn-new aria-label="' + esc(tr("New display name")) + '" placeholder="' + esc(tr("New display name")) + '" maxlength="50"><button type="button" class="un-btn" data-dn="add">' + esc(tr("Add")) + "</button></div>" +
        '<p class="phandle">' + esc(tr("New names start visible to friends only.")) + "</p>" : "") +
      previewHtml() + "</div>";
  }

  function people(text) {
    return String(text || "").split(/[\s,]+/).map(function (p) { return p.replace(/^@/, ""); }).filter(Boolean);
  }

  function readAudience(wrap) {
    var aud = { include: { lists: [] }, exclude: { lists: [] } };
    wrap.querySelectorAll("[data-dn-inc]").forEach(function (el) { aud.include[el.getAttribute("data-dn-inc")] = el.checked; });
    wrap.querySelectorAll("[data-dn-exc]").forEach(function (el) { aud.exclude[el.getAttribute("data-dn-exc")] = el.checked; });
    wrap.querySelectorAll("[data-dn-inc-list]").forEach(function (el) { if (el.checked) aud.include.lists.push(el.getAttribute("data-dn-inc-list")); });
    wrap.querySelectorAll("[data-dn-exc-list]").forEach(function (el) { if (el.checked) aud.exclude.lists.push(el.getAttribute("data-dn-exc-list")); });
    wrap.querySelectorAll("[data-dn-side]").forEach(function (el) { aud[el.getAttribute("data-dn-side") === "inc" ? "include" : "exclude"].people = people(el.value); });
    return aud;
  }

  function apply(res) {
    if (said(res)) { settle(); if (res.names) data = res; preview = null; redraw(); }
    return res;
  }

  function value(sel) {
    var el = document.querySelector(sel);
    return el ? el.value : "";
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-dn]") : null;
    if (!el) return;
    event.preventDefault();
    var act = el.getAttribute("data-dn");
    var id = el.getAttribute("data-id") || "";
    if (act === "toggle") { openId = openId === id ? "" : id; redraw(); return; }
    if (act === "add") {
      var fresh = value("[data-dn-new]").trim();
      if (!fresh) return;
      call("/v1/display-names", { method: "POST", body: { name: fresh, audience: { include: { friends: true } } } }).then(function (res) {
        if (res && res.status === 201 && res.names) openId = res.names[res.names.length - 1].id;
        apply(res);
      });
      return;
    }
    if (act === "save") {
      var wrap = el.closest(".dn-edit");
      var body = { id: id, audience: readAudience(wrap) };
      var input = wrap.querySelector("[data-dn-name]");
      if (input) body.name = input.value;
      call("/v1/display-names", { method: "PATCH", body: body }).then(apply);
      return;
    }
    if (act === "primary") { call("/v1/display-names/primary", { method: "POST", body: { id: id } }).then(apply); return; }
    if (act === "remove") {
      if (typeof confirm === "function" && !confirm(tr("Remove this display name?"))) return;
      call("/v1/display-names", { method: "DELETE", body: { id: id } }).then(function (res) { openId = ""; apply(res); });
      return;
    }
    if (act === "preview-tier" || act === "preview-person") {
      var as = act === "preview-tier" ? value("[data-dn-preview-tier]") : value("[data-dn-preview-person]").replace(/^@/, "").trim();
      if (!as) return;
      call("/v1/display-names/preview?as=" + encodeURIComponent(as)).then(function (res) {
        if (res && res.status === 200) { preview = res; note = ""; }
        else { preview = null; note = tr("No account found."); }
        redraw();
      });
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", keep, true);
    document.addEventListener("change", keep, true);
  }

  root.ViktorychDisplayNames = {
    bind: function (next) { deps = next || {}; },
    profileHtml: profileHtml,
    names: function () { return data ? (data.names || []) : null; },
    watch: function (fn) { if (typeof fn === "function" && watchers.indexOf(fn) < 0) watchers.push(fn); },
    load: load,
    reset: function () { data = null; asked = false; openId = ""; preview = null; note = ""; settle(); }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
