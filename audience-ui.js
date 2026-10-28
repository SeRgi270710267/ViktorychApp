/* Private audience lists. Members are never shown which list they belong to. */
(function (root) {
  "use strict";

  var deps = {};
  var lists = [];
  var people = [];
  var openId = "";
  var asked = false;

  function tr(key, vars) {
    var fn = root.t || (typeof window !== "undefined" && window.t);
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function call(path, opts) {
    if (!deps.api) return Promise.resolve({ status: 503 });
    var auth = "";
    try { auth = deps.token ? deps.token() : ""; } catch (err) { auth = ""; }
    var next = opts || {};
    if (!next.token && auth) next.token = auth;
    return deps.api(path, next);
  }

  function redraw() {
    if (deps.render) deps.render();
  }

  function load() {
    return call("/v1/audience-lists").then(function (body) {
      if (body && body.status === 200) lists = body.lists || [];
      return call("/v1/audience-lists/people");
    }).then(function (body) {
      if (body && body.status === 200) people = body.people || [];
      redraw();
    }).catch(function () {});
  }

  function settingsHtml() {
    if (!asked) {
      asked = true;
      load();
    }
    var cards = lists.map(function (list) {
      var members = (list.members || []).map(function (member) {
        return '<span>' + esc(member.name || member.handle) + ' <button type="button" data-aud="remove" data-id="' + esc(list.id) + '" data-handle="' + esc(member.handle) + '">' + esc(tr("Remove")) + "</button></span>";
      }).join("");
      var options = people.map(function (person) {
        return '<option value="' + esc(person.handle) + '">' + esc(person.name || person.handle) + "</option>";
      }).join("");
      var open = openId === list.id;
      return '<section class="aud-card"><button type="button" class="aud-name" data-aud="toggle" data-id="' + esc(list.id) + '">' +
        (list.icon ? '<span>' + esc(list.icon) + "</span> " : "") + esc(list.name) + "</button>" +
        (open ? '<div class="aud-edit"><input class="aud-rename" data-id="' + esc(list.id) + '" value="' + esc(list.name) + '" aria-label="' + esc(tr("List name")) + '">' +
          '<input class="aud-reicon" data-id="' + esc(list.id) + '" value="' + esc(list.icon || "") + '" aria-label="' + esc(tr("List icon")) + '">' +
          '<button type="button" data-aud="rename" data-id="' + esc(list.id) + '">' + esc(tr("Rename")) + "</button>" +
          '<div class="aud-members">' + (members || '<p>' + esc(tr("No one in this list yet")) + "</p>") + "</div>" +
          '<select class="aud-person" data-id="' + esc(list.id) + '">' + options + "</select>" +
          '<button type="button" data-aud="add" data-id="' + esc(list.id) + '">' + esc(tr("Add")) + "</button>" +
          '<button type="button" data-aud="delete" data-id="' + esc(list.id) + '">' + esc(tr("Delete list")) + "</button></div>" : "") +
        "</section>";
    }).join("");
    return '<div class="aud-settings"><h2>' + esc(tr("Audience lists")) + "</h2><p class=\"phandle\">" +
      esc(tr("Private lists of followers and friends. People are not told which lists they are in.")) + "</p>" +
      cards +
      '<input class="aud-new-name" aria-label="' + esc(tr("List name")) + '" placeholder="' + esc(tr("List name")) + '">' +
      '<input class="aud-new-icon" aria-label="' + esc(tr("List icon")) + '" placeholder="' + esc(tr("List icon")) + '">' +
      '<button type="button" data-aud="create">' + esc(tr("New list")) + "</button></div>";
  }

  function checksHtml(selected) {
    var picked = {};
    (selected || []).forEach(function (id) { picked[id] = true; });
    if (!lists.length) return '<p class="phandle">' + esc(tr("Create an audience list in Privacy and safety.")) + "</p>";
    return '<div class="aud-checks">' + lists.map(function (list) {
      return '<label><input type="checkbox" data-aud-list="' + esc(list.id) + '"' + (picked[list.id] ? " checked" : "") + "> " +
        esc((list.icon ? list.icon + " " : "") + list.name) + "</label>";
    }).join("") + "</div>";
  }

  function composerHtml(slotName) {
    var choices = [
      ["everyone", tr("Everyone")],
      ["following", tr("Accounts you follow")],
      ["friends", tr("Friends")],
      ["lists", tr("Custom lists")]
    ];
    var menu = choices.map(function (row) {
      return '<option value="' + row[0] + '">' + esc(row[1]) + "</option>";
    }).join("");
    return '<label class="aud-compose" data-compose-slot="' + esc(slotName || "post") + '">' + esc(tr("Audience")) +
      ' <select data-compose-audience data-slot="' + esc(slotName || "post") + '">' + menu + "</select></label>" + checksHtml([]);
  }

  function selectedLists(rootNode) {
    var ids = [];
    if (!rootNode || !rootNode.querySelectorAll) return ids;
    rootNode.querySelectorAll("[data-aud-list]").forEach(function (box) {
      if (box.checked) ids.push(box.getAttribute("data-aud-list"));
    });
    return ids;
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-aud]") : null;
    if (!el) return;
    var act = el.getAttribute("data-aud");
    if (act === "toggle") {
      event.preventDefault();
      openId = openId === el.getAttribute("data-id") ? "" : el.getAttribute("data-id");
      redraw();
      return;
    }
    if (act === "create") {
      event.preventDefault();
      var name = document.querySelector(".aud-new-name");
      var icon = document.querySelector(".aud-new-icon");
      call("/v1/audience-lists", { method: "POST", body: { name: name ? name.value : "", icon: icon ? icon.value : "" } }).then(load);
      return;
    }
    if (act === "rename") {
      event.preventDefault();
      var id = el.getAttribute("data-id");
      var rename = document.querySelector('.aud-rename[data-id="' + id + '"]');
      var reicon = document.querySelector('.aud-reicon[data-id="' + id + '"]');
      call("/v1/audience-lists/" + id, { method: "PATCH", body: { name: rename ? rename.value : "", icon: reicon ? reicon.value : "" } }).then(load);
      return;
    }
    if (act === "delete") {
      event.preventDefault();
      call("/v1/audience-lists/" + el.getAttribute("data-id"), { method: "DELETE" }).then(function () { openId = ""; load(); });
      return;
    }
    if (act === "add") {
      event.preventDefault();
      var listId = el.getAttribute("data-id");
      var person = document.querySelector('.aud-person[data-id="' + listId + '"]');
      call("/v1/audience-lists/" + listId + "/members", { method: "POST", body: { handle: person ? person.value : "" } }).then(load);
      return;
    }
    if (act === "remove") {
      event.preventDefault();
      call("/v1/audience-lists/" + el.getAttribute("data-id") + "/members", { method: "DELETE", body: { handle: el.getAttribute("data-handle") || "" } }).then(load);
    }
  }

  if (typeof document !== "undefined") document.addEventListener("click", onClick, true);

  root.AudienceLists = {
    bind: function (next) { deps = next || {}; },
    settingsHtml: settingsHtml,
    checksHtml: checksHtml,
    composerHtml: composerHtml,
    selectedLists: selectedLists,
    load: load
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
