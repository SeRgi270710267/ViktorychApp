/* Usernames: several usernames, who sees which one, "Preview as" and who
   can mention you live in Edit profile > Usernames (profileHtml). The name
   friends see is now one of the display names (display-names-ui.js). Settings > Usernames keeps a shortcut to that subpage plus
   your private nicknames for others (settingsHtml). Everything is enforced
   by the server; this only edits. */
(function (root) {
  "use strict";

  var deps = {};
  var data = null;
  var lists = [];
  var mentions = null;
  var nicknames = [];
  var openHandle = "";
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

  /* The app may re-render the page at any time (a profile or session load
     finishing); typed text and ticked boxes are kept here and put back. */
  var drafts = {};
  function draftKey(el) {
    var attrs = Array.prototype.filter.call(el.attributes, function (a) { return a.name.indexOf("data-un-") === 0; });
    if (!attrs.length) return "";
    var wrap = el.closest(".un-card");
    var card = wrap ? wrap.querySelector(".un-name") : null;
    return (card ? card.getAttribute("data-handle") : "") + "|" + attrs.map(function (a) { return a.name + "=" + a.value; }).join("|");
  }
  function keep(event) {
    var el = event.target;
    if (!el || !el.closest || !el.closest(".un-settings")) return;
    var key = draftKey(el);
    if (key) drafts[key] = el.type === "checkbox" ? { checked: el.checked } : { value: el.value };
  }
  function restore() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".un-settings").forEach(function (box) {
      box.querySelectorAll("input, select").forEach(function (el) {
        var d = drafts[draftKey(el)];
        if (!d) return;
        if ("checked" in d) el.checked = d.checked;
        else el.value = d.value;
      });
    });
  }
  function settle() { drafts = {}; }

  function errorText(code) {
    if (code === "handle_taken") return tr("That username is taken.");
    if (code === "handle_held") return tr("That username was released recently and is held for now.");
    if (code === "handle_reserved") return tr("That username is reserved.");
    if (code === "invalid_handle") return tr("Usernames use letters, numbers and underscores, up to 15.");
    if (code === "name_cap") return tr("You've reached the most usernames an account can have.");
    if (code === "rate_limited") return tr("Too many changes. Try again later.");
    if (code === "handle_locked") return tr("This username can't be changed.");
    if (code === "primary_name") return tr("Make another username primary first.");
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
    return Promise.all([
      call("/v1/usernames"),
      call("/v1/audience-lists"),
      call("/v1/usernames/mentions"),
      call("/v1/nicknames")
    ]).then(function (got) {
      if (got[0] && got[0].status === 200) data = got[0];
      if (got[1] && got[1].status === 200) lists = got[1].lists || [];
      if (got[2] && got[2].status === 200) mentions = got[2];
      if (got[3] && got[3].status === 200) nicknames = got[3].nicknames || [];
      redraw();
    }).catch(function () {});
  }

  function listName(id) {
    for (var i = 0; i < lists.length; i++) if (lists[i].id === id) return (lists[i].icon ? lists[i].icon + " " : "") + lists[i].name;
    return "";
  }

  function summary(aud) {
    var inc = (aud && aud.include) || {};
    var parts = [];
    if (inc.people && inc.people.length) parts.push(tr("Specific people"));
    (inc.lists || []).forEach(function (id) { var n = listName(id); if (n) parts.push(n); });
    if (inc.friends) parts.push(tr("Friends"));
    if (inc.followers) parts.push(tr("Followers"));
    if (inc.public) parts.push(tr("Public"));
    return parts.length ? parts.join(", ") : tr("No one");
  }

  function box(attr, on, label) {
    return '<label class="un-check"><input type="checkbox" ' + attr + (on ? " checked" : "") + "> " + esc(label) + "</label>";
  }

  function editor(name) {
    var aud = name.audience || { include: {}, exclude: {} };
    var inc = aud.include || {};
    var exc = aud.exclude || {};
    var h = esc(name.handle);
    var listBoxes = function (side, picked) {
      return lists.map(function (list) {
        return box('data-un-' + side + '-list="' + esc(list.id) + '"', (picked || []).indexOf(list.id) >= 0, listName(list.id));
      }).join("");
    };
    return '<div class="un-edit" data-un-handle="' + h + '">' +
      "<h3>" + esc(tr("Who sees this username")) + "</h3>" +
      box('data-un-inc="public"', inc.public, tr("Public")) +
      box('data-un-inc="followers"', inc.followers, tr("Followers")) +
      box('data-un-inc="friends"', inc.friends, tr("Friends")) +
      listBoxes("inc", inc.lists) +
      '<input class="un-people" data-un-side="inc" aria-label="' + esc(tr("Specific people")) + '" placeholder="' + esc(tr("Specific people, like @name, @other")) + '" value="' + esc((inc.people || []).map(function (p) { return "@" + p; }).join(", ")) + '">' +
      "<h3>" + esc(tr("Never show it to")) + "</h3>" +
      box('data-un-exc="followers"', exc.followers, tr("Followers")) +
      box('data-un-exc="friends"', exc.friends, tr("Friends")) +
      listBoxes("exc", exc.lists) +
      '<input class="un-people" data-un-side="exc" aria-label="' + esc(tr("Hide from people")) + '" placeholder="' + esc(tr("Specific people, like @name, @other")) + '" value="' + esc((exc.people || []).map(function (p) { return "@" + p; }).join(", ")) + '">' +
      '<div class="un-actions"><button type="button" class="un-btn" data-un="save" data-handle="' + h + '">' + esc(tr("Save")) + "</button>" +
      (name.primary ? "" : '<button type="button" class="un-btn outline" data-un="primary" data-handle="' + h + '">' + esc(tr("Make primary")) + "</button>" +
        '<button type="button" class="un-btn outline danger" data-un="remove" data-handle="' + h + '">' + esc(tr("Remove")) + "</button>") +
      "</div></div>";
  }

  function policySelect(key, value, withDefault) {
    var opts = (withDefault ? [["", tr("Same as broader audience")]] : []).concat([["anyone", tr("Anyone")], ["replies", tr("Only in replies to me")], ["nobody", tr("No one")]]);
    return '<select class="un-select" data-un-mention="' + esc(key) + '">' + opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === (value || "") ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }

  function mentionsHtml() {
    var m = mentions || { public: "anyone", followers: "", friends: "", lists: {}, allow: [], block: [] };
    var row = function (label, select) { return '<label class="un-row"><span>' + esc(label) + "</span>" + select + "</label>"; };
    return "<h2>" + esc(tr("Who can mention you")) + "</h2>" +
      '<p class="phandle">' + esc(tr("The most specific rule wins: a person, then a list, then friends, then followers, then everyone.")) + "</p>" +
      row(tr("Everyone"), policySelect("public", m.public, false)) +
      row(tr("Followers"), policySelect("followers", m.followers, true)) +
      row(tr("Friends"), policySelect("friends", m.friends, true)) +
      lists.map(function (list) { return row(listName(list.id), policySelect("list:" + list.id, (m.lists || {})[list.id], true)); }).join("") +
      '<input class="un-people" data-un-mention-people="allow" aria-label="' + esc(tr("Always allow")) + '" placeholder="' + esc(tr("Always allow, like @name")) + '" value="' + esc((m.allow || []).map(function (p) { return "@" + p; }).join(", ")) + '">' +
      '<input class="un-people" data-un-mention-people="block" aria-label="' + esc(tr("Never allow")) + '" placeholder="' + esc(tr("Never allow, like @name")) + '" value="' + esc((m.block || []).map(function (p) { return "@" + p; }).join(", ")) + '">' +
      '<div class="un-actions"><button type="button" class="un-btn" data-un="mentions">' + esc(tr("Save")) + "</button></div>";
  }

  function previewHtml() {
    var opts = [["public", tr("Public")], ["followers", tr("Followers")], ["friends", tr("Friends")]].concat(lists.map(function (list) { return ["list:" + list.id, listName(list.id)]; }));
    var result = "";
    if (preview) result = '<p class="un-preview-out" role="status">' + esc(preview.hidden ? tr("They see no username.") : tr("They see @{handle}", { handle: preview.handle })) + "</p>";
    return "<h2>" + esc(tr("Preview as")) + "</h2>" +
      '<div class="un-row"><select class="un-select" data-un-preview-tier>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="un-btn outline" data-un="preview-tier">' + esc(tr("Preview")) + "</button></div>" +
      '<div class="un-row"><input class="un-input" data-un-preview-person aria-label="' + esc(tr("Preview as someone")) + '" placeholder="@name">' +
      '<button type="button" class="un-btn outline" data-un="preview-person">' + esc(tr("Preview")) + "</button></div>" + result;
  }

  function ready() {
    if (!asked) { asked = true; load(); }
    if (typeof Promise !== "undefined") Promise.resolve().then(restore);
  }

  /* Edit profile > Usernames: your names, who sees each, list priority,
     Preview as and who can mention you. */
  function profileHtml() {
    ready();
    if (!data) return '<div class="un-settings un-in-edit"><p class="phandle">' + esc(tr("Loading")) + "</p></div>";
    var cards = (data.names || []).map(function (name) {
      var open = openHandle === name.handle;
      return '<section class="un-card"><button type="button" class="un-name" data-un="toggle" data-handle="' + esc(name.handle) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        '<span class="un-at">@' + esc(name.handle) + "</span>" + (name.primary ? '<span class="un-badge">' + esc(tr("Primary")) + "</span>" : "") +
        '<span class="un-who">' + esc(summary(name.audience)) + "</span></button>" + (open ? editor(name) : "") + "</section>";
    }).join("");
    var order = lists.length > 1 ? "<h2>" + esc(tr("List priority")) + "</h2>" +
      '<p class="phandle">' + esc(tr("When someone is in more than one list, the higher list decides.")) + "</p>" +
      orderedLists().map(function (list, i) {
        return '<div class="un-row"><span>' + esc(listName(list.id)) + '</span><button type="button" class="un-btn outline" data-un="up" data-id="' + esc(list.id) + '"' + (i ? "" : " disabled") + ' aria-label="' + esc(tr("Move up")) + '">↑</button></div>';
      }).join("") : "";
    return '<div class="un-settings un-in-edit">' +
      '<p class="phandle">' + esc(tr("Each person sees exactly one of your usernames. The most specific audience wins: a person, then a list, then friends, then followers, then public.")) + "</p>" +
      (note ? '<p class="un-note" role="alert">' + esc(note) + "</p>" : "") + cards +
      ((data.names || []).length < (data.cap || 5) ? '<div class="un-row"><input class="un-input" data-un-new aria-label="' + esc(tr("New username")) + '" placeholder="' + esc(tr("New username")) + '" maxlength="15"><button type="button" class="un-btn" data-un="add">' + esc(tr("Add")) + "</button></div>" : "") +
      '<p class="phandle">' + esc(tr("Removed usernames stay reserved for you for {days} days.", { days: data.releaseDays || 30 })) + "</p>" +
      order + previewHtml() +
      mentionsHtml() + "</div>";
  }

  /* Settings > Usernames: a shortcut into Edit profile > Usernames, then
     the private nicknames you give other people. */
  function settingsHtml() {
    ready();
    var shortcut = '<a class="set-row un-shortcut" href="#/settings/usernames" data-acct="edit-usernames"><span class="set-copy"><b>' + esc(tr("Your usernames")) + '</b><span class="set-sub">' + esc(tr("Edit them in Edit profile: who sees which one, Preview as and who can mention you.")) + '</span></span><span class="set-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14.586 12 7.543 4.96l1.414-1.42L17.414 12l-8.457 8.46-1.414-1.42z"/></svg></span></a>';
    var nicks = nicknames.map(function (n) {
      return '<div class="un-row"><span>@' + esc(n.handle) + " · " + esc(n.name) + '</span><button type="button" class="un-btn outline" data-un="nick-clear" data-handle="' + esc(n.handle) + '">' + esc(tr("Remove")) + "</button></div>";
    }).join("");
    return '<div class="un-settings"><h2>' + esc(tr("Usernames")) + "</h2>" + shortcut +
      (note && !document.querySelector(".un-in-edit") ? '<p class="un-note" role="alert">' + esc(note) + "</p>" : "") +
      "<h2>" + esc(tr("Your nicknames for others")) + "</h2>" +
      '<p class="phandle">' + esc(tr("Only you see these.")) + "</p>" + nicks +
      '<div class="un-row"><input class="un-input" data-un-nick-handle aria-label="' + esc(tr("Account")) + '" placeholder="@name"><input class="un-input" data-un-nick-name maxlength="50" aria-label="' + esc(tr("Nickname")) + '" placeholder="' + esc(tr("Nickname")) + '"><button type="button" class="un-btn" data-un="nick-set">' + esc(tr("Save")) + "</button></div>" + externalNicksHtml() +
      "</div>";
  }

  /* Private names for accounts on other networks (nicknames.js keeps them
     cached on this device and synced to the account). */
  var EXT_PLATFORMS = ["x", "threads", "instagram", "youtube", "bluesky", "mastodon", "reddit", "tiktok", "telegram", "vk", "discord", "rss", "nzlay"];
  function nickLib() { return root.ViktorychNicknames || null; }
  function platformOf(p) { return p === "bsky" ? "bluesky" : p; }
  function platformName(p) {
    if (p === "person") return tr("Linked accounts");
    if (p === "forum" || p === "nzlay") return "NZlay";
    if (deps.platformName) { var n = deps.platformName(platformOf(p)); if (n) return n; }
    return p;
  }
  function shownId(row) {
    if (row.platform === "person") return tr("All their linked accounts");
    if (row.platform === "reddit" && row.id.indexOf("r/") === 0) return row.id;
    if (row.platform === "rss" || row.platform === "youtube" && /^uc[\w-]{20,}$/.test(row.id)) return row.id;
    return "@" + row.id;
  }
  function externalNicksHtml() {
    var lib = nickLib();
    if (!lib || (deps.nickEnabled && !deps.nickEnabled())) return "";
    var rows = lib.list().map(function (row) {
      var glyph = deps.platformGlyph ? deps.platformGlyph(platformOf(row.platform)) : "";
      return '<div class="un-row un-ext" data-nick-key="' + esc(row.key) + '">' +
        '<span class="un-ext-ico" title="' + esc(platformName(row.platform)) + '">' + (glyph || esc(platformName(row.platform).slice(0, 1))) + "</span>" +
        '<span class="un-ext-copy"><b>' + esc(row.name) + '</b><span class="un-ext-id">' + esc(platformName(row.platform)) + " · " + esc(shownId(row)) + "</span></span>" +
        '<button type="button" class="un-btn outline" data-act="nick-edit" data-platform="' + esc(platformOf(row.platform)) + '" data-handle="' + esc(row.id) + '">' + esc(tr("Edit")) + "</button>" +
        '<button type="button" class="un-btn outline" data-un="ext-clear" data-key="' + esc(row.key) + '">' + esc(tr("Remove")) + "</button></div>";
    }).join("");
    var opts = EXT_PLATFORMS.map(function (p) { return '<option value="' + esc(p) + '">' + esc(platformName(p)) + "</option>"; }).join("");
    return "<h3 class=\"un-sub\">" + esc(tr("Accounts on other networks")) + "</h3>" +
      (rows || '<p class="phandle">' + esc(tr("Set a custom name from any profile's menu.")) + "</p>") +
      '<div class="un-row"><select class="un-select" data-un-ext-platform aria-label="' + esc(tr("Network")) + '">' + opts + '</select><input class="un-input" data-un-ext-handle aria-label="' + esc(tr("Account")) + '" placeholder="@name"><input class="un-input" data-un-ext-name maxlength="50" aria-label="' + esc(tr("Nickname")) + '" placeholder="' + esc(tr("Nickname")) + '"><button type="button" class="un-btn" data-un="ext-set">' + esc(tr("Save")) + "</button></div>";
  }

  function orderedLists() {
    var order = (data && data.listOrder) || [];
    var rank = function (id) { var at = order.indexOf(id); return at < 0 ? order.length : at; };
    return lists.slice().sort(function (a, b) { return rank(a.id) - rank(b.id); });
  }

  function people(text) {
    return String(text || "").split(/[\s,]+/).map(function (p) { return p.replace(/^@/, ""); }).filter(Boolean);
  }

  function readAudience(wrap) {
    var aud = { include: { lists: [] }, exclude: { lists: [] } };
    wrap.querySelectorAll("[data-un-inc]").forEach(function (el) { aud.include[el.getAttribute("data-un-inc")] = el.checked; });
    wrap.querySelectorAll("[data-un-exc]").forEach(function (el) { aud.exclude[el.getAttribute("data-un-exc")] = el.checked; });
    wrap.querySelectorAll("[data-un-inc-list]").forEach(function (el) { if (el.checked) aud.include.lists.push(el.getAttribute("data-un-inc-list")); });
    wrap.querySelectorAll("[data-un-exc-list]").forEach(function (el) { if (el.checked) aud.exclude.lists.push(el.getAttribute("data-un-exc-list")); });
    wrap.querySelectorAll("[data-un-side]").forEach(function (el) { aud[el.getAttribute("data-un-side") === "inc" ? "include" : "exclude"].people = people(el.value); });
    return aud;
  }

  function apply(res) {
    if (said(res)) { settle(); if (res.names) data = res; redraw(); }
    return res;
  }

  function value(sel) {
    var el = document.querySelector(sel);
    return el ? el.value : "";
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-un]") : null;
    if (!el) return;
    event.preventDefault();
    var act = el.getAttribute("data-un");
    var handle = el.getAttribute("data-handle") || "";
    if (act === "ext-clear" || act === "ext-set") {
      var lib = nickLib();
      if (!lib) return;
      if (act === "ext-clear") { lib.setKey(el.getAttribute("data-key") || "", ""); return; }
      var who = value("[data-un-ext-handle]");
      var name = value("[data-un-ext-name]");
      var plat = value("[data-un-ext-platform]") || "x";
      if (!who || !name) return;
      settle();
      if (!lib.set(plat, who, name)) { note = tr("That account name isn't valid."); redraw(); return; }
      return;
    }
    if (act === "toggle") { openHandle = openHandle === handle ? "" : handle; redraw(); return; }
    if (act === "add") {
      var fresh = value("[data-un-new]").replace(/^@/, "").trim();
      if (!fresh) return;
      call("/v1/usernames", { method: "POST", body: { handle: fresh, audience: { include: { followers: true } } } }).then(function (res) { if (res && res.status === 201) openHandle = fresh; apply(res); });
      return;
    }
    if (act === "save") {
      var wrap = el.closest(".un-edit");
      call("/v1/usernames", { method: "PATCH", body: { handle: handle, audience: readAudience(wrap) } }).then(apply);
      return;
    }
    if (act === "primary") { call("/v1/usernames/primary", { method: "POST", body: { handle: handle } }).then(apply); return; }
    if (act === "remove") {
      if (typeof confirm === "function" && !confirm(tr("Remove @{handle}? It stays reserved for you for a while.", { handle: handle }))) return;
      call("/v1/usernames", { method: "DELETE", body: { handle: handle } }).then(function (res) { openHandle = ""; apply(res); });
      return;
    }
    if (act === "up") {
      var ids = orderedLists().map(function (l) { return l.id; });
      var at = ids.indexOf(el.getAttribute("data-id"));
      if (at > 0) { ids.splice(at - 1, 0, ids.splice(at, 1)[0]); call("/v1/usernames/order", { method: "PUT", body: { lists: ids } }).then(apply); }
      return;
    }
    if (act === "preview-tier" || act === "preview-person") {
      var as = act === "preview-tier" ? value("[data-un-preview-tier]") : value("[data-un-preview-person]").replace(/^@/, "");
      if (!as) return;
      call("/v1/usernames/preview?as=" + encodeURIComponent(as)).then(function (res) {
        if (res && res.status === 200) { preview = res; note = ""; }
        else { preview = null; note = tr("No account found."); }
        redraw();
      });
      return;
    }
    if (act === "nick-set" || act === "nick-clear") {
      var who = act === "nick-set" ? value("[data-un-nick-handle]").replace(/^@/, "") : handle;
      var name = act === "nick-set" ? value("[data-un-nick-name]") : "";
      call("/v1/nicknames", { method: "PUT", body: { handle: who, name: name } }).then(function (res) {
        if (res && res.status === 404) { note = tr("No account found."); redraw(); return; }
        if (said(res)) { settle(); load(); }
      });
      return;
    }
    if (act === "mentions") {
      var body = { lists: {}, allow: people(value('[data-un-mention-people="allow"]')), block: people(value('[data-un-mention-people="block"]')) };
      document.querySelectorAll("[data-un-mention]").forEach(function (sel) {
        var key = sel.getAttribute("data-un-mention");
        if (key.indexOf("list:") === 0) { if (sel.value) body.lists[key.slice(5)] = sel.value; }
        else body[key] = sel.value;
      });
      call("/v1/usernames/mentions", { method: "PUT", body: body }).then(function (res) { if (said(res)) { settle(); mentions = res; redraw(); } });
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", keep, true);
    document.addEventListener("change", keep, true);
  }

  root.ViktorychUsernames = {
    bind: function (next) { deps = next || {}; },
    settingsHtml: settingsHtml,
    profileHtml: profileHtml,
    names: function () { return data ? (data.names || []) : null; },
    watch: function (fn) { if (typeof fn === "function" && watchers.indexOf(fn) < 0) watchers.push(fn); },
    load: load
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
