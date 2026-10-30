/* Inbox: the page once called Messages. Old #/messages links keep working and
   #/inbox… links are rewritten to the same page. Filter chips in X's style sit
   under the title and only show the kinds of conversation the app really has:
   the app's own servers and the read-only Discord mirror. The owner also gets
   "SMS codes" (inbox-sms.js, loaded on demand) for the rented SMSPool numbers.
   Other kinds of conversation register with ViktorychInbox.register().
   Members can also link their own Mail folder and SMSPool account
   (inbox-mail.js / inbox-sms.js). Their secrets live only in the device
   vault below: AES-GCM with a non-extractable key in IndexedDB
   "viktorych-messages-vault". Which sections are linked is a plain flag
   (no secrets) so the chips can show without opening the vault. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = root && root.t ? root.t : null;
    return fn ? fn(key, vars) : key;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  var extra = [];
  var VAULT_DB = "viktorych-messages-vault";
  var LINKED = "vk-inbox-linked";
  var relay = { known: false, on: false, asked: false };

  /* ---------- device vault (secrets and cached mail, encrypted) ---------- */
  function vaultDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("no_idb")); return; }
      var open = root.indexedDB.open(VAULT_DB, 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("kv"); };
      open.onsuccess = function () { resolve(open.result); };
      open.onerror = function () { reject(open.error); };
    });
  }
  function vaultDo(mode, fn) {
    return vaultDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("kv", mode);
        var out = fn(tx.objectStore("kv"));
        tx.oncomplete = function () { db.close(); resolve(out && "result" in out ? out.result : undefined); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }
  function subtle() { return root.crypto && root.crypto.subtle ? root.crypto.subtle : null; }
  function vaultKey() {
    return vaultDo("readonly", function (s) { return s.get("key"); }).then(function (key) {
      if (key) return key;
      if (!subtle()) throw new Error("no_crypto");
      return subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (made) {
        return vaultDo("readwrite", function (s) { s.put(made, "key"); }).then(function () { return made; });
      });
    });
  }
  var vault = {
    put: function (name, value) {
      return vaultKey().then(function (key) {
        var iv = root.crypto.getRandomValues(new Uint8Array(12));
        var plain = new TextEncoder().encode(JSON.stringify(value));
        return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, plain).then(function (ct) {
          return vaultDo("readwrite", function (s) { s.put({ iv: iv, ct: ct }, "v:" + name); });
        });
      });
    },
    get: function (name) {
      if (!subtle()) return Promise.resolve(null);
      return Promise.all([
        vaultDo("readonly", function (s) { return s.get("key"); }),
        vaultDo("readonly", function (s) { return s.get("v:" + name); })
      ]).then(function (got) {
        if (!got[0] || !got[1]) return null;
        return subtle().decrypt({ name: "AES-GCM", iv: got[1].iv }, got[0], got[1].ct).then(function (plain) {
          return JSON.parse(new TextDecoder().decode(plain));
        });
      }).catch(function () { return null; });
    },
    drop: function (names) {
      return vaultDo("readwrite", function (s) { [].concat(names).forEach(function (n) { s.delete("v:" + n); }); }).catch(function () { return null; });
    },
    wipe: function () {
      try { root.localStorage.removeItem(LINKED); } catch (err) { /* nothing kept */ }
      try { if (root.indexedDB) root.indexedDB.deleteDatabase(VAULT_DB); } catch (err) { /* nothing kept */ }
    }
  };
  function linkedMap() {
    try { return JSON.parse(root.localStorage.getItem(LINKED) || "{}") || {}; } catch (err) { return {}; }
  }
  function linked(name) { return !!linkedMap()[name]; }
  function setLinked(name, on) {
    var map = linkedMap();
    if (on) map[name] = 1; else delete map[name];
    try { root.localStorage.setItem(LINKED, JSON.stringify(map)); } catch (err) { /* private mode */ }
  }

  /* The member relays are behind the Worker flag INBOX_RELAY. Ask once. */
  function relayOn() {
    if (!relay.asked) {
      relay.asked = true;
      try {
        var acc = root.ViktorychAccounts;
        var tok = acc && acc.token ? acc.token() : "";
        if (acc && acc.call && tok) {
          acc.call("/v1/inbox/mail", { token: tok }).then(function (body) {
            relay.known = true;
            relay.on = !!(body && body.status === 200 && body.enabled);
            if (relay.on) { try { root.dispatchEvent(new Event("vklazy")); } catch (err) { /* old browser */ } }
          }, function () { relay.known = true; });
        }
      } catch (err) { relay.known = true; }
    }
    return relay.on;
  }

  function isOwner() {
    try {
      var acc = root.ViktorychAccounts && root.ViktorychAccounts.account ? root.ViktorychAccounts.account() : null;
      if (!acc) return false;
      if (acc.owner) return true;
      var c = root.HandleSkeleton && root.HandleSkeleton.inspectHandle ? root.HandleSkeleton.inspectHandle(String(acc.handle || "")) : null;
      return !!(c && c.owner);
    } catch (err) { return false; }
  }

  /* #/inbox, #/inbox/sms, #/inbox?f=servers → the same #/messages page. */
  function aliasHash(hash) {
    var text = String(hash || "");
    var m = text.match(/^#\/inbox(?=$|[/?])(.*)$/);
    return m ? "#/messages" + m[1] : "";
  }

  function hashQuery(hash) {
    var text = String(hash || "");
    var q = text.indexOf("?");
    try { return new URLSearchParams(q >= 0 ? text.slice(q + 1) : ""); } catch (err) { return null; }
  }

  function isSmsHash(hash) {
    return /^#\/(?:messages|inbox)\/sms(?:$|[/?])/.test(String(hash || ""));
  }
  function sectionOf(hash) {
    var m = String(hash || "").match(/^#\/(?:messages|inbox)\/(sms|mail|connect|aliases)(?:$|[/?])/);
    return m ? m[1] : "";
  }

  /* "all", "servers", "discord", "sms" or a registered id. */
  function filterOf(hash) {
    var sec = sectionOf(hash);
    if (sec) return sec;
    var q = hashQuery(hash);
    var f = q ? String(q.get("f") || "") : "";
    if (f === "servers" || f === "discord") return f;
    for (var i = 0; i < extra.length; i++) if (extra[i].id === f) return f;
    return "all";
  }

  /* A change between chips repaints the page instead of the in-page sync. */
  function viewKey(hash) {
    return filterOf(hash);
  }

  /* ---------- un-unified Inbox: sections, split pages, order ----------
     Every section can stay a chip inside Inbox (the default) or be split out
     into its own page with its own nav icon. The choice lives in the app's
     settings as `inboxLayout` and syncs with the rest of "Look and menus"
     unless this device keeps its own (settings-sync.js keeps it on this
     device by default). A split page shows only its own section and loads
     only that section's data. */
  var SECTIONS = [
    { id: "servers", nav: "inbox-servers", label: "Servers", icon: "communities", href: "#/messages?f=servers" },
    { id: "discord", nav: "inbox-discord", label: "Discord", icon: "discord", href: "#/messages?f=discord" },
    { id: "mail", nav: "inbox-mail", label: "Mail", icon: "atSign", href: "#/messages/mail" },
    { id: "sms", nav: "inbox-sms", label: "SMS codes", icon: "sms", href: "#/messages/sms" }
  ];
  var SECTION_IDS = SECTIONS.map(function (s) { return s.id; });
  var layoutHooks = { get: null, save: null };

  function knownIds() {
    return SECTION_IDS.concat(extra.map(function (x) { return x.id; }));
  }
  function uniq(list, allowed) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (id) {
      if (typeof id === "string" && allowed.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }
  /* { order, split, hidden, pinned }. Unknown ids are kept in order so a
     section registered later (or on another device) keeps its place. */
  function cleanLayout(raw, ids) {
    raw = raw && typeof raw === "object" ? raw : {};
    var known = ids || knownIds();
    var order = [];
    (Array.isArray(raw.order) ? raw.order : []).forEach(function (id) {
      if (typeof id === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(id) && order.indexOf(id) < 0) order.push(id);
    });
    known.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    var splittable = SECTION_IDS;
    var hidden = uniq(raw.hidden, order);
    var split = uniq(raw.split, splittable).filter(function (id) { return hidden.indexOf(id) < 0; });
    var pinned = uniq(raw.pinned, order).filter(function (id) { return hidden.indexOf(id) < 0; });
    /* gave: the bottom-bar icon a split page pushed out, so merging can put
       it back. Kept only while the section is split. */
    var gave = {};
    var rawGave = raw.gave && typeof raw.gave === "object" ? raw.gave : {};
    split.forEach(function (id) {
      var nav = rawGave[id];
      if (typeof nav === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(nav)) gave[id] = nav;
    });
    return { order: order, split: split, hidden: hidden, pinned: pinned, gave: gave };
  }
  function layout() {
    var raw = null;
    try { raw = layoutHooks.get ? layoutHooks.get() : null; } catch (err) { raw = null; }
    return cleanLayout(raw);
  }
  function bindLayout(hooks) {
    layoutHooks.get = hooks && hooks.get || null;
    layoutHooks.save = hooks && hooks.save || null;
  }
  function sectionById(id) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i];
    for (var j = 0; j < extra.length; j++) if (extra[j].id === id) return { id: extra[j].id, label: extra[j].label, href: extra[j].href || ("#/messages?f=" + encodeURIComponent(extra[j].id)), extra: true };
    return null;
  }
  function sectionByNav(navId) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].nav === navId) return SECTIONS[i];
    return null;
  }
  function sectionLabel(id) {
    var s = sectionById(id);
    if (!s) return "";
    return s.extra ? s.label : tr(s.label);
  }
  /* Whether this member has the section at all on this device. */
  function available(id) {
    if (id === "servers" || id === "discord") return true;
    if (id === "mail") return linked("mail");
    if (id === "sms") return isOwner() || linked("sms");
    for (var i = 0; i < extra.length; i++) {
      if (extra[i].id !== id) continue;
      try { return !extra[i].visible || !!extra[i].visible(); } catch (err) { return false; }
    }
    return false;
  }
  function isSplit(id, lay) { return (lay || layout()).split.indexOf(id) >= 0; }
  function isHidden(id, lay) { return (lay || layout()).hidden.indexOf(id) >= 0; }
  function isPinned(id, lay) { return (lay || layout()).pinned.indexOf(id) >= 0; }
  /* Sections in the order they show: pinned first, then the member's order. */
  function ordered(lay) {
    lay = lay || layout();
    var pins = lay.order.filter(function (id) { return lay.pinned.indexOf(id) >= 0; });
    return pins.concat(lay.order.filter(function (id) { return lay.pinned.indexOf(id) < 0; }));
  }
  /* The split section this hash shows, or "". */
  function splitHere(hash, lay) {
    var f = filterOf(hash == null ? (root && root.location ? root.location.hash : "") : hash);
    if (f === "aliases") f = "mail";
    return isSplit(f, lay) ? f : "";
  }
  /* Page title: a split page is named after its section. */
  function title(hash) {
    var sec = splitHere(hash);
    return sec ? sectionLabel(sec) : tr("Inbox");
  }
  /* Nav: is a split section's own icon shown, and is it the current page? */
  function navVisible(navId) {
    var s = sectionByNav(navId);
    return !!(s && isSplit(s.id) && available(s.id));
  }
  function navActive(navId, hash) {
    var s = sectionByNav(navId);
    return !!(s && splitHere(hash) === s.id);
  }
  /* The Inbox icon stays lit for everything that is not a split page. */
  function inboxActive(hash) { return !splitHere(hash); }

  function change(fn) {
    var lay = layout();
    var before = JSON.stringify(lay);
    fn(lay);
    var next = cleanLayout(lay);
    if (JSON.stringify(next) === before) return next;
    if (layoutHooks.save) layoutHooks.save(next, cleanLayout(JSON.parse(before)));
    return next;
  }
  function drop(list, id) { var i = list.indexOf(id); if (i >= 0) list.splice(i, 1); }
  function add(list, id) { if (list.indexOf(id) < 0) list.push(id); }
  var actions = {
    split: function (lay, id) { if (SECTION_IDS.indexOf(id) >= 0) { add(lay.split, id); drop(lay.hidden, id); } },
    merge: function (lay, id) { drop(lay.split, id); },
    pin: function (lay, id) { add(lay.pinned, id); drop(lay.hidden, id); },
    unpin: function (lay, id) { drop(lay.pinned, id); },
    hide: function (lay, id) { add(lay.hidden, id); drop(lay.split, id); drop(lay.pinned, id); },
    show: function (lay, id) { drop(lay.hidden, id); },
    up: function (lay, id) { move(lay, id, -1); },
    down: function (lay, id) { move(lay, id, 1); },
    reset: function (lay) { lay.order = []; lay.split = []; lay.hidden = []; lay.pinned = []; }
  };
  /* Moves within the visible order, so hidden or missing sections never eat a step. */
  function move(lay, id, dir) {
    var view = ordered(lay).filter(function (x) { return x === id || available(x); });
    var at = view.indexOf(id);
    var other = view[at + dir];
    if (at < 0 || !other) return;
    var bothPinned = lay.pinned.indexOf(id) >= 0 && lay.pinned.indexOf(other) >= 0;
    var nonePinned = lay.pinned.indexOf(id) < 0 && lay.pinned.indexOf(other) < 0;
    if (!bothPinned && !nonePinned) return;
    var a = lay.order.indexOf(id);
    var b = lay.order.indexOf(other);
    lay.order[a] = other;
    lay.order[b] = id;
  }
  function act(name, id) {
    var fn = actions[name];
    if (!fn) return null;
    return change(function (lay) { fn(lay, id); });
  }

  /* Long-press (or right-click) on a section chip or a split page's nav
     icon opens this menu. #394's tab menu can reuse menuRows(). */
  function menuRows(id) {
    var lay = layout();
    var rows = [];
    if (SECTION_IDS.indexOf(id) >= 0) {
      rows.push(isSplit(id, lay)
        ? { act: "merge", label: tr("Merge back into Inbox") }
        : { act: "split", label: tr("Open as its own page") });
    }
    rows.push(isPinned(id, lay) ? { act: "unpin", label: tr("Unpin") } : { act: "pin", label: tr("Pin") });
    rows.push({ act: "up", label: tr("Move left") });
    rows.push({ act: "down", label: tr("Move right") });
    rows.push({ act: "hide", label: tr("Hide") });
    rows.push({ href: "#/settings/display/inbox", label: tr("Inbox sections") });
    return rows;
  }
  function menuHtml(id) {
    var rows = menuRows(id).map(function (r) {
      if (r.href) return '<a class="inbox-menu-row" role="menuitem" href="' + esc(r.href) + '" data-inbox-close>' + esc(r.label) + "</a>";
      return '<button class="inbox-menu-row" role="menuitem" type="button" data-inbox-act="' + esc(r.act) + '" data-inbox-sec="' + esc(id) + '">' + esc(r.label) + "</button>";
    }).join("");
    return '<div class="inbox-menu-back" data-inbox-close><div class="inbox-menu" role="menu" aria-label="' + esc(sectionLabel(id)) + '"><div class="inbox-menu-head">' + esc(sectionLabel(id)) + "</div>" + rows + "</div></div>";
  }

  /* Settings › Display › Inbox sections. */
  function settingsHtml() {
    var lay = layout();
    var list = ordered(lay).filter(function (id) { return available(id) || isHidden(id, lay); });
    var rows = list.map(function (id, i) {
      var hidden = isHidden(id, lay);
      var split = isSplit(id, lay);
      var pinned = isPinned(id, lay);
      var state = hidden ? tr("Hidden") : split ? tr("Own page") : tr("In Inbox");
      var btn = function (name, label, on, disabled) {
        return '<button class="inbox-set-btn' + (on ? " on" : "") + '" type="button" data-inbox-act="' + name + '" data-inbox-sec="' + esc(id) + '"' + (disabled ? " disabled" : "") + (on != null ? ' aria-pressed="' + (on ? "true" : "false") + '"' : "") + ">" + esc(label) + "</button>";
      };
      var splitBtn = SECTION_IDS.indexOf(id) >= 0
        ? (split ? btn("merge", tr("Merge back into Inbox"), null, false) : btn("split", tr("Own page"), null, hidden))
        : "";
      return '<li class="inbox-set-row" data-inbox-row="' + esc(id) + '"><div class="inbox-set-top"><b>' + esc(sectionLabel(id)) + '</b><span class="inbox-set-state">' + esc(state) + (pinned ? " · " + esc(tr("Pinned")) : "") + "</span></div>" +
        '<div class="inbox-set-acts">' +
        '<button class="inbox-set-btn icon" type="button" data-inbox-act="up" data-inbox-sec="' + esc(id) + '" aria-label="' + esc(tr("Move up")) + '"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button class="inbox-set-btn icon" type="button" data-inbox-act="down" data-inbox-sec="' + esc(id) + '" aria-label="' + esc(tr("Move down")) + '"' + (i === list.length - 1 ? " disabled" : "") + ">↓</button>" +
        splitBtn +
        btn(pinned ? "unpin" : "pin", pinned ? tr("Unpin") : tr("Pin"), pinned, hidden) +
        btn(hidden ? "show" : "hide", hidden ? tr("Show") : tr("Hide"), hidden ? true : null, false) +
        "</div></li>";
    }).join("");
    var sync = root && root.ViktorychSettingsSync;
    var own = sync && sync.keyLocal ? sync.keyLocal("inboxLayout") : true;
    return '<div class="inbox-set" data-inbox-settings>' +
      '<p class="phandle set-block">' + esc(tr("Keep every section inside Inbox, or give one its own page with an icon in the bottom bar and sidebar. Pinned sections come first.")) + "</p>" +
      '<ul class="inbox-set-list">' + rows + "</ul>" +
      '<div class="inbox-set-foot"><label class="inbox-set-own"><input type="checkbox" data-inbox-own' + (own ? " checked" : "") + "> " + esc(tr("Keep these choices on this device only")) + "</label>" +
      '<button class="outline" type="button" data-inbox-act="reset" data-inbox-sec="all">' + esc(tr("Merge everything back into Inbox")) + "</button></div></div>";
  }

  function chips() {
    var lay = layout();
    var on = relayOn();
    var owner = isOwner();
    var list = [{ id: "all", label: tr("All"), href: "#/messages" }];
    ordered(lay).forEach(function (id) {
      if (isHidden(id, lay) || isSplit(id, lay) || !available(id)) return;
      var s = sectionById(id);
      if (!s) return;
      list.push({ id: id, label: sectionLabel(id), href: s.href, owner: id === "sms" && owner && !linked("sms"), pinned: isPinned(id, lay) });
    });
    if (on || linked("mail") || linked("sms")) list.push({ id: "connect", label: "+ " + tr("Add"), href: "#/messages/connect" });
    return list;
  }

  function tabsHtml(hash) {
    var h = hash == null ? (root && root.location ? root.location.hash : "") : hash;
    var split = splitHere(h);
    if (split) {
      return '<div class="inbox-split-bar"><button class="inbox-merge" type="button" data-inbox-act="merge" data-inbox-sec="' + esc(split) + '">' + esc(tr("Merge back into Inbox")) + "</button></div>";
    }
    var here = filterOf(h);
    var html = chips().map(function (c) {
      var on = c.id === here;
      return '<a class="inbox-chip' + (on ? " on" : "") + (c.owner ? " owner" : "") + (c.pinned ? " pinned" : "") + '" role="tab" aria-selected="' + (on ? "true" : "false") + '" href="' + esc(c.href) + '" data-inbox="' + esc(c.id) + '"><span>' + esc(c.label) + "</span></a>";
    }).join("");
    return '<nav class="inbox-chips" role="tablist" aria-label="' + esc(tr("Inbox filters")) + '">' + html + "</nav>";
  }

  function register(item) {
    if (!item || !item.id || !/^[a-z][a-z0-9-]{1,23}$/.test(item.id) || ["all", "servers", "discord", "sms", "mail", "connect", "aliases"].indexOf(item.id) >= 0) return false;
    extra = extra.filter(function (x) { return x.id !== item.id; });
    extra.push(item);
    return true;
  }

  /* ---------- menu and settings wiring (browser only) ---------- */
  function sectionForEl(el) {
    if (!el || !el.closest) return "";
    var chip = el.closest(".inbox-chip[data-inbox]");
    if (chip) {
      var id = chip.getAttribute("data-inbox");
      return id === "all" || id === "connect" ? "" : id;
    }
    var link = el.closest(".bottom-nav a[href], .nav a[href]");
    if (!link) return "";
    var href = link.getAttribute("href");
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].href === href && isSplit(SECTIONS[i].id)) return SECTIONS[i].id;
    return "";
  }
  function closeMenu() {
    var doc = root.document;
    var old = doc && doc.querySelector(".inbox-menu-back");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  function openMenu(id) {
    var doc = root.document;
    if (!doc || !id) return;
    closeMenu();
    var wrap = doc.createElement("div");
    wrap.innerHTML = menuHtml(id);
    var el = wrap.firstChild;
    doc.body.appendChild(el);
    var first = el.querySelector(".inbox-menu-row");
    if (first && first.focus) first.focus();
    try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(8); } catch (err) { /* no haptics */ }
  }
  function changed() {
    try { root.dispatchEvent(new CustomEvent("vk-inbox-layout")); } catch (err) { /* old browser */ }
  }
  if (root && root.document && root.addEventListener) {
    var press = { timer: 0, fired: false, x: 0, y: 0 };
    root.document.addEventListener("touchstart", function (ev) {
      var id = sectionForEl(ev.target);
      press.fired = false;
      if (!id) return;
      var t = ev.touches && ev.touches[0];
      press.x = t ? t.clientX : 0;
      press.y = t ? t.clientY : 0;
      clearTimeout(press.timer);
      press.timer = setTimeout(function () { press.fired = true; openMenu(id); }, 500);
    }, { passive: true });
    root.document.addEventListener("touchmove", function (ev) {
      var t = ev.touches && ev.touches[0];
      if (t && Math.abs(t.clientX - press.x) + Math.abs(t.clientY - press.y) > 10) clearTimeout(press.timer);
    }, { passive: true });
    root.document.addEventListener("touchend", function () { clearTimeout(press.timer); }, { passive: true });
    root.document.addEventListener("contextmenu", function (ev) {
      var id = sectionForEl(ev.target);
      if (!id) return;
      ev.preventDefault();
      ev.stopPropagation();
      openMenu(id);
    }, true);
    root.document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && root.document.querySelector(".inbox-menu-back")) { closeMenu(); return; }
      if (ev.key === "F10" && ev.shiftKey) {
        var id = sectionForEl(root.document.activeElement);
        if (id) { ev.preventDefault(); ev.stopPropagation(); openMenu(id); }
      }
    }, true);
    root.document.addEventListener("click", function (ev) {
      if (press.fired) { press.fired = false; if (sectionForEl(ev.target)) { ev.preventDefault(); ev.stopPropagation(); return; } }
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-inbox-act],[data-inbox-close]") : null;
      if (!t) return;
      if (t.hasAttribute("data-inbox-close") && !t.hasAttribute("data-inbox-act")) {
        if (t.classList.contains("inbox-menu-back") && ev.target !== t) return;
        closeMenu();
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      var name = t.getAttribute("data-inbox-act");
      var id = t.getAttribute("data-inbox-sec") || "";
      closeMenu();
      act(name, id);
      changed();
    }, true);
    root.document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || !t.hasAttribute || !t.hasAttribute("data-inbox-own")) return;
      var sync = root.ViktorychSettingsSync;
      if (sync && sync.setKeyLocal) sync.setKeyLocal("inboxLayout", !!t.checked);
      changed();
    }, true);
  }

  var api = { vault: vault, linked: linked, setLinked: setLinked, relayOn: relayOn, sectionOf: sectionOf, isOwner: isOwner, aliasHash: aliasHash, isSmsHash: isSmsHash, filterOf: filterOf, viewKey: viewKey, tabsHtml: tabsHtml, register: register,
    SECTIONS: SECTIONS, cleanLayout: cleanLayout, layout: layout, bindLayout: bindLayout, available: available, ordered: ordered,
    isSplit: isSplit, isHidden: isHidden, isPinned: isPinned, splitHere: splitHere, title: title, navVisible: navVisible, navActive: navActive,
    inboxActive: inboxActive, sectionByNav: sectionByNav, sectionLabel: sectionLabel, act: act, menuRows: menuRows, menuHtml: menuHtml, settingsHtml: settingsHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychInbox = api;
})(typeof window !== "undefined" ? window : null);
