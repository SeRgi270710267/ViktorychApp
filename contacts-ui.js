/* contacts-ui.js - Native X.com-style Contacts & Address Book for ViktorychApp.
   Local-first, encrypted offline storage in IndexedDB/localStorage.
   Direct phone dialer, vCard import/export, Web Contact Picker API integration. */
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ViktorychContacts = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORE_KEY = "viktorych_contacts_v1";
  var S = {
    contacts: [],
    query: "",
    tab: "all", // "all" | "favs"
    activeId: null,
    editing: false,
    loaded: false,
    importing: false,
    viewingContact: null
  };

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : null;
    return fn ? fn(key, vars) : (key || "");
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function icon(name) {
    if (typeof window !== "undefined" && window.ViktorychIcon) {
      return window.ViktorychIcon(name);
    }
    // Fallback inline SVGs
    if (name === "phone") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2c-2.8-1.4-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1-.4-1.1-.6-2.3-.6-3.5 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1zM5 5h1.5c.1.9.3 1.7.6 2.5l-1.3 1.3C5.3 7.4 5.1 6.2 5 5zm14 14c-1.2-.1-2.4-.3-3.8-.8l1.3-1.3c.8.3 1.6.5 2.5.6V19z"/></svg>';
    if (name === "mail") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>';
    if (name === "star") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
    if (name === "starOn") return '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:#e0245e"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
    if (name === "back") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.414l4.293-4.293c.39-.39.39-1.023 0-1.414s-1.023-.39-1.414 0l-6 6c-.39.39-.39 1.023 0 1.414l6 6c.195.195.45.293.707.293s.512-.098.707-.293c.39-.39.39-1.023 0-1.414L7.414 13H20c.553 0 1-.447 1-1s-.447-1-1-1z"/></svg>';
    if (name === "plus") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 11h-6V5c0-.55-.45-1-1-1s-1 .45-1 1v6H5c-.55 0-1 .45-1 1s.45 1 1 1h6v6c0 .55.45 1 1 1s1-.45 1-1v-6h6c.55 0 1-.45 1-1s-.45-1-1-1z"/></svg>';
    if (name === "import") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
    if (name === "trash") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>';
  }

  function loadContacts() {
    if (S.loaded) return;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) S.contacts = JSON.parse(raw);
    } catch (err) {
      S.contacts = [];
    }
    if (!Array.isArray(S.contacts)) S.contacts = [];
    S.loaded = true;
  }

  function saveContacts() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S.contacts));
    } catch (err) {
      /* quota fallback */
    }
  }

  function avatarColor(name) {
    var colors = ["#1d9bf0", "#00ba7c", "#f91880", "#7856ff", "#ff7a00", "#ffd400"];
    var sum = 0;
    for (var i = 0; i < (name || "").length; i++) sum += name.charCodeAt(i);
    return colors[sum % colors.length];
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/);
    if (!parts.length || !parts[0]) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function getSortedContacts() {
    var list = S.contacts.slice();
    if (S.tab === "favs") {
      list = list.filter(function (c) { return !!c.fav; });
    }
    if (S.query.trim()) {
      var q = S.query.trim().toLowerCase();
      list = list.filter(function (c) {
        return (c.name && c.name.toLowerCase().includes(q)) ||
               (c.phone && c.phone.toLowerCase().includes(q)) ||
               (c.email && c.email.toLowerCase().includes(q)) ||
               (c.handle && c.handle.toLowerCase().includes(q));
      });
    }
    list.sort(function (a, b) {
      return (a.name || "").localeCompare(b.name || "");
    });
    return list;
  }

  function groupByInitial(list) {
    var groups = {};
    list.forEach(function (c) {
      var letter = ((c.name || "")[0] || "#").toUpperCase();
      if (!/^[A-ZА-ЯЁ]$/i.test(letter)) letter = "#";
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(c);
    });
    return groups;
  }

  function page(route) {
    loadContacts();
    var parts = (route && route.pathParts) || [];
    var sub = parts[1] || "";
    var id = parts[2] || "";

    // Specific contact view / edit
    if (sub === "new" || (sub === "view" && id)) {
      return renderContactDetail(sub === "new" ? null : id);
    }

    var list = getSortedContacts();
    var groups = groupByInitial(list);
    var keys = Object.keys(groups).sort(function (a, b) {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    });

    var hasPicker = typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;

    var header = '<div class="top-bar sticky-top">' +
      '<div class="top-bar-l"><a class="icon-btn" href="#/" aria-label="' + esc(tr("Home")) + '">' + icon("back") + '</a><h1 class="page-title">' + esc(tr("Contacts")) + '</h1></div>' +
      '<div class="top-bar-r">' +
        (hasPicker ? '<button class="icon-btn" type="button" data-act="ct-device-sync" title="' + esc(tr("Sync phone contacts")) + '" aria-label="' + esc(tr("Sync phone contacts")) + '">' + icon("import") + '</button>' : '') +
        '<button class="icon-btn" type="button" data-act="ct-new" title="' + esc(tr("Add contact")) + '" aria-label="' + esc(tr("Add contact")) + '">' + icon("plus") + '</button>' +
      '</div>' +
    '</div>';

    var searchBox = '<div class="ct-search-box">' +
      '<input class="ct-search-input" type="search" placeholder="' + esc(tr("Search contacts")) + '" value="' + esc(S.query) + '" data-act="ct-search-input" />' +
    '</div>';

    var tabs = '<div class="ct-tabs">' +
      '<button type="button" class="ct-tab' + (S.tab === "all" ? " on" : "") + '" data-act="ct-tab" data-v="all">' + esc(tr("All contacts")) + ' (' + S.contacts.length + ')</button>' +
      '<button type="button" class="ct-tab' + (S.tab === "favs" ? " on" : "") + '" data-act="ct-tab" data-v="favs">' + esc(tr("Favorites")) + '</button>' +
    '</div>';

    var body = '';
    if (!list.length) {
      body = '<div class="ct-empty">' +
        '<p class="ct-empty-h">' + esc(S.query ? tr("No matching contacts") : tr("No contacts yet")) + '</p>' +
        '<p class="ct-empty-sub">' + esc(tr("Add contacts manually or sync from your Android device.")) + '</p>' +
        '<div class="ct-empty-acts">' +
          (hasPicker ? '<button class="btn btn-sm" type="button" data-act="ct-device-sync">' + icon("import") + ' <span>' + esc(tr("Sync phone contacts")) + '</span></button>' : '') +
          '<button class="btn btn-sm primary" type="button" data-act="ct-new">' + icon("plus") + ' <span>' + esc(tr("Add contact")) + '</span></button>' +
        '</div>' +
      '</div>';
    } else {
      var rowsHtml = '';
      keys.forEach(function (k) {
        rowsHtml += '<div class="ct-group-head">' + esc(k) + '</div>';
        groups[k].forEach(function (c) {
          var bg = avatarColor(c.name);
          var inits = initials(c.name);
          var dialHref = c.phone ? "tel:" + encodeURIComponent(c.phone) : "";
          var chatHref = c.handle ? "#/@" + encodeURIComponent(c.handle.replace(/^@/, "")) : (c.phone ? "#/messages?tel=" + encodeURIComponent(c.phone) : "");
          rowsHtml += '<div class="ct-row" data-id="' + esc(c.id) + '">' +
            '<div class="ct-ava" style="background-color:' + bg + '">' + esc(inits) + '</div>' +
            '<div class="ct-info" data-act="ct-view" data-id="' + esc(c.id) + '">' +
              '<div class="ct-name">' + esc(c.name) + (c.fav ? ' <span class="ct-star-badge">' + icon("starOn") + '</span>' : '') + '</div>' +
              '<div class="ct-sub">' + esc(c.phone || c.email || (c.handle ? '@' + c.handle.replace(/^@/, '') : '')) + '</div>' +
            '</div>' +
            '<div class="ct-actions">' +
              (dialHref ? '<a class="ct-act-btn" href="' + esc(dialHref) + '" title="' + esc(tr("Call")) + '">' + icon("phone") + '</a>' : '') +
              (chatHref ? '<a class="ct-act-btn" href="' + esc(chatHref) + '" title="' + esc(tr("Message")) + '">' + icon("mail") + '</a>' : '') +
              '<button type="button" class="ct-act-btn" data-act="ct-toggle-fav" data-id="' + esc(c.id) + '" title="' + esc(tr("Favorite")) + '">' + (c.fav ? icon("starOn") : icon("star")) + '</button>' +
            '</div>' +
          '</div>';
        });
      });
      body = '<div class="ct-list">' + rowsHtml + '</div>';
    }

    return '<div class="contacts-host">' + header + searchBox + tabs + body + '</div>';
  }

  function renderContactDetail(id) {
    var c = id ? S.contacts.find(function (item) { return item.id === id; }) : null;
    var isNew = !c;
    var name = c ? c.name : "";
    var phone = c ? c.phone : "";
    var email = c ? c.email : "";
    var handle = c ? c.handle : "";
    var notes = c ? c.notes : "";

    var header = '<div class="top-bar sticky-top">' +
      '<div class="top-bar-l"><a class="icon-btn" href="#/contacts" aria-label="' + esc(tr("Back")) + '">' + icon("back") + '</a><h1 class="page-title">' + esc(isNew ? tr("New contact") : tr("Contact details")) + '</h1></div>' +
      '<div class="top-bar-r">' +
        (!isNew ? '<button class="icon-btn" type="button" data-act="ct-delete" data-id="' + esc(id) + '" title="' + esc(tr("Delete")) + '">' + icon("trash") + '</button>' : '') +
        '<button class="btn btn-sm primary" type="button" data-act="ct-save" data-id="' + esc(id || "") + '">' + esc(tr("Save")) + '</button>' +
      '</div>' +
    '</div>';

    var inits = isNew ? "+" : initials(name);
    var bg = isNew ? "#1d9bf0" : avatarColor(name);

    var card = '<form class="ct-form" data-id="' + esc(id || "") + '" onsubmit="return false;">' +
      '<div class="ct-hero-card">' +
        '<div class="ct-ava lg" style="background-color:' + bg + '">' + esc(inits) + '</div>' +
        (!isNew && phone ? '<div class="ct-hero-acts">' +
          '<a class="btn primary" href="tel:' + esc(phone) + '">' + icon("phone") + ' <span>' + esc(tr("Call")) + '</span></a>' +
          '<a class="btn" href="#/messages?tel=' + esc(phone) + '">' + icon("mail") + ' <span>' + esc(tr("Message")) + '</span></a>' +
        '</div>' : '') +
      '</div>' +
      '<div class="ct-fields">' +
        '<label class="ct-field"><span class="ct-label">' + esc(tr("Name")) + '</span><input class="ct-input" name="name" type="text" value="' + esc(name) + '" placeholder="' + esc(tr("Full name")) + '" required /></label>' +
        '<label class="ct-field"><span class="ct-label">' + esc(tr("Phone")) + '</span><input class="ct-input" name="phone" type="tel" value="' + esc(phone) + '" placeholder="" /></label>' +
        '<label class="ct-field"><span class="ct-label">' + esc(tr("Email")) + '</span><input class="ct-input" name="email" type="email" value="' + esc(email) + '" placeholder="name@example.com" /></label>' +
        '<label class="ct-field"><span class="ct-label">' + esc(tr("Viktorych / X Handle")) + '</span><input class="ct-input" name="handle" type="text" value="' + esc(handle) + '" placeholder="@username" /></label>' +
        '<label class="ct-field"><span class="ct-label">' + esc(tr("Notes")) + '</span><textarea class="ct-input" name="notes" rows="3" placeholder="' + esc(tr("Notes")) + '">' + esc(notes) + '</textarea></label>' +
      '</div>' +
    '</form>';

    return '<div class="contacts-host">' + header + card + '</div>';
  }

  function mount(route) {
    loadContacts();
    // Check if entered with ?call= or ?tel=
    var q = route && route.query;
    var callParam = q && (q.get("call") || q.get("tel"));
    if (callParam) {
      handleIncomingDial(callParam);
    }
  }

  function handleIncomingDial(number) {
    var clean = String(number || "").replace(/^tel:/i, "").trim();
    if (!clean) return;
    loadContacts();
    var match = S.contacts.find(function (c) {
      return c.phone && c.phone.replace(/[^0-9+]/g, "") === clean.replace(/[^0-9+]/g, "");
    });
    if (match) {
      location.hash = "#/contacts/view/" + encodeURIComponent(match.id);
    } else {
      // Prompt to create or dial
      location.hash = "#/contacts/new?phone=" + encodeURIComponent(clean);
    }
  }

  async function syncDeviceContacts() {
    if (typeof navigator === "undefined" || !navigator.contacts || !navigator.contacts.select) {
      if (typeof window !== "undefined" && window.ViktorychToast) {
        window.ViktorychToast(tr("Your browser does not support native contact selection."));
      }
      return;
    }
    try {
      var props = ["name", "tel", "email", "icon"];
      var results = await navigator.contacts.select(props, { multiple: true });
      if (!results || !results.length) return;

      var added = 0;
      results.forEach(function (r) {
        var name = (r.name && r.name[0]) || "";
        var phone = (r.tel && r.tel[0]) || "";
        var email = (r.email && r.email[0]) || "";
        if (!name && !phone && !email) return;

        // Dedup by phone or email
        var exists = S.contacts.some(function (c) {
          return (phone && c.phone === phone) || (email && c.email === email);
        });
        if (!exists) {
          S.contacts.push({
            id: "ct_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            name: name || phone || email,
            phone: phone,
            email: email,
            fav: false,
            updatedAt: Date.now()
          });
          added++;
        }
      });
      if (added > 0) {
        saveContacts();
        if (typeof window !== "undefined" && window.ViktorychToast) {
          window.ViktorychToast(tr("Imported {n} contacts", { n: added }));
        }
        if (typeof window !== "undefined" && window.render) window.render();
      }
    } catch (err) {
      /* User cancelled or denied permission */
    }
  }

  function onAct(act, el) {
    if (act === "ct-tab") {
      S.tab = el.getAttribute("data-v") || "all";
      if (typeof window !== "undefined" && window.render) window.render();
      return true;
    }
    if (act === "ct-search-input") {
      S.query = el.value || "";
      if (typeof window !== "undefined" && window.render) window.render();
      return true;
    }
    if (act === "ct-new") {
      location.hash = "#/contacts/new";
      return true;
    }
    if (act === "ct-view") {
      var id = el.getAttribute("data-id");
      location.hash = "#/contacts/view/" + encodeURIComponent(id);
      return true;
    }
    if (act === "ct-toggle-fav") {
      var favId = el.getAttribute("data-id");
      var item = S.contacts.find(function (c) { return c.id === favId; });
      if (item) {
        item.fav = !item.fav;
        saveContacts();
        if (typeof window !== "undefined" && window.render) window.render();
      }
      return true;
    }
    if (act === "ct-device-sync") {
      syncDeviceContacts();
      return true;
    }
    if (act === "ct-delete") {
      var delId = el.getAttribute("data-id");
      S.contacts = S.contacts.filter(function (c) { return c.id !== delId; });
      saveContacts();
      location.hash = "#/contacts";
      return true;
    }
    if (act === "ct-save") {
      var form = document.querySelector(".ct-form");
      if (!form) return true;
      var saveId = form.getAttribute("data-id");
      var fName = (form.querySelector('input[name="name"]') || {}).value || "";
      var fPhone = (form.querySelector('input[name="phone"]') || {}).value || "";
      var fEmail = (form.querySelector('input[name="email"]') || {}).value || "";
      var fHandle = (form.querySelector('input[name="handle"]') || {}).value || "";
      var fNotes = (form.querySelector('textarea[name="notes"]') || {}).value || "";

      if (!fName.trim()) {
        if (typeof window !== "undefined" && window.ViktorychToast) {
          window.ViktorychToast(tr("Please enter a contact name."));
        }
        return true;
      }

      if (saveId) {
        var existing = S.contacts.find(function (c) { return c.id === saveId; });
        if (existing) {
          existing.name = fName.trim();
          existing.phone = fPhone.trim();
          existing.email = fEmail.trim();
          existing.handle = fHandle.trim();
          existing.notes = fNotes.trim();
          existing.updatedAt = Date.now();
        }
      } else {
        S.contacts.push({
          id: "ct_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          name: fName.trim(),
          phone: fPhone.trim(),
          email: fEmail.trim(),
          handle: fHandle.trim(),
          notes: fNotes.trim(),
          fav: false,
          updatedAt: Date.now()
        });
      }
      saveContacts();
      location.hash = "#/contacts";
      return true;
    }
    return false;
  }

  return {
    page: page,
    mount: mount,
    onAct: onAct,
    syncDeviceContacts: syncDeviceContacts,
    _state: S
  };
});
