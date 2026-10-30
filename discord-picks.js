/* Owner-only Add Discord sheet. Everyone else sees the resulting messages.
   Joins go through the Worker → discord_live.py with the spare account, one
   server per confirmed tap. The public invite preview never uses the token. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : null;
    return fn ? fn(key, vars) : key;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function accounts() { return root.ViktorychAccounts || null; }
  function token() {
    try { return accounts() && accounts().token ? String(accounts().token() || "") : ""; }
    catch (e) { return ""; }
  }
  function isOwner() {
    try {
      var a = accounts() && accounts().account ? accounts().account() : null;
      if (!a) return false;
      if (a.owner) return true;
      if (String(a.publicId || "") === "emergency_owner") return true;
      var h = String(a.handle || "");
      var c = root.HandleSkeleton && root.HandleSkeleton.inspectHandle ? root.HandleSkeleton.inspectHandle(h) : null;
      return !!(c && c.owner);
    } catch (e) { return false; }
  }
  function api(path, opts) {
    var a = accounts();
    if (!a || !a.call || !token()) return Promise.resolve({ status: 401, error: "unauthorized" });
    opts = opts || {};
    opts.token = token();
    return a.call(path, opts);
  }
  function snowflake(v) {
    var t = String(v || "");
    return /^\d{15,22}$/.test(t) ? t : "";
  }

  var state = {
    open: false,
    step: "list",
    catalog: null,
    picks: null,
    join: null,
    invite: null,
    inviteInput: "",
    inviteBusy: false,
    joinBusy: false,
    saveBusy: false,
    waitGuild: "",
    waitId: "",
    waitSince: 0,
    picker: null,
    note: "",
    err: "",
    loading: false,
    focusOn: false,
    health: null
  };

  function defaults(server) {
    var out = [];
    var channels = (server && server.channels) || [];
    channels.forEach(function (ch) {
      if (ch.kind === "announcement") out.push(ch.id);
    });
    channels.forEach(function (ch) {
      if (ch.kind !== "announcement" && /^(general|main|chat|lounge|announcements?|news|updates?)$/i.test(String(ch.name || ""))) {
        if (out.indexOf(ch.id) < 0) out.push(ch.id);
      }
    });
    if (!out.length && channels[0]) out.push(channels[0].id);
    return out.slice(0, 8);
  }

  function pickedIds(serverId) {
    var list = (state.picks && state.picks.servers) || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(serverId)) {
        return (list[i].channels || []).map(function (c) { return String(c.id || c); });
      }
    }
    return null;
  }

  function load() {
    if (!isOwner() || state.loading) return Promise.resolve();
    state.loading = true;
    return api("/v1/discord/picks").then(function (body) {
      state.loading = false;
      if (!body || body.status >= 400) {
        state.err = body && body.error === "owner_only" ? tr("Only the owner can manage Discord servers.") : tr("Couldn’t load Discord servers.");
        return;
      }
      state.catalog = body.catalog;
      state.picks = body.picks;
      state.join = body.join || null;
      state.health = body.health || null;
      if (state.waitId && state.join && state.join.id === state.waitId) {
        if (state.join.status === "joined") {
          state.waitGuild = snowflake(state.join.guild) || state.waitGuild;
          state.waitId = "";
          state.note = tr("Joined. Pick the channels to show.");
          openPickerFor(state.waitGuild, true);
        } else if (state.join.status === "captcha" || state.join.status === "verification") {
          state.err = tr("This server can’t be joined that way. Discord asked for a captcha or verification.");
          state.waitId = "";
          state.step = "invite";
        } else if (state.join.status !== "pending") {
          state.err = tr("Couldn’t join that server.");
          state.waitId = "";
          state.step = "invite";
        }
      }
      if (state.waitGuild && state.catalog) {
        var found = (state.catalog.servers || []).some(function (s) { return String(s.id) === state.waitGuild; });
        if (found) {
          openPickerFor(state.waitGuild, true);
          state.waitGuild = "";
        }
      }
      paint();
    }).catch(function () {
      state.loading = false;
      state.err = tr("Couldn’t load Discord servers.");
      paint();
    });
  }

  function openPickerFor(guildId, preferDefaults) {
    var server = null;
    ((state.catalog && state.catalog.servers) || []).forEach(function (s) {
      if (String(s.id) === String(guildId)) server = s;
    });
    if (!server) return;
    var selected = preferDefaults ? defaults(server) : (pickedIds(guildId) || defaults(server));
    state.picker = { id: server.id, name: server.name, icon: server.icon || "", channels: server.channels || [], selected: selected.slice() };
    state.step = "picker";
    state.invite = null;
    state.err = "";
  }

  function askRefresh(guild) {
    return api("/v1/discord/picks/refresh", { method: "POST", body: guild ? { guild: guild } : {} });
  }

  function previewInvite() {
    var code = String(state.inviteInput || "").trim();
    if (!code || state.inviteBusy) return;
    state.inviteBusy = true;
    state.err = "";
    state.note = "";
    paint();
    api("/v1/discord/picks/invite?code=" + encodeURIComponent(code)).then(function (body) {
      state.inviteBusy = false;
      if (!body || body.status >= 400) {
        state.err = body && body.error === "invite_not_found" ? tr("That invite wasn’t found.") : tr("Couldn’t look up that invite.");
        state.invite = null;
        paint();
        return;
      }
      state.invite = body;
      state.step = "invite";
      paint();
    }).catch(function () {
      state.inviteBusy = false;
      state.err = tr("Couldn’t look up that invite.");
      paint();
    });
  }

  function confirmJoin() {
    if (!state.invite || state.joinBusy) return;
    if (!window.confirm(tr("Join “{name}” with the spare Discord account? One server only.", { name: state.invite.guild.name }))) return;
    state.joinBusy = true;
    state.err = "";
    paint();
    api("/v1/discord/picks/join", { method: "POST", body: { code: state.invite.code, confirm: true } }).then(function (body) {
      state.joinBusy = false;
      if (!body || body.status >= 400) {
        if (body && body.error === "confirm_required") state.err = tr("Confirm the join first.");
        else if (body && body.status === 429) state.err = tr("Wait a minute before joining another server.");
        else state.err = tr("Couldn’t start the join.");
        paint();
        return;
      }
      state.waitId = String(body.id || "");
      state.waitGuild = snowflake(body.guild && body.guild.id);
      state.waitSince = Date.now();
      state.note = tr("Joining… this usually takes under a minute.");
      state.step = "waiting";
      paint();
      pollJoin();
    }).catch(function () {
      state.joinBusy = false;
      state.err = tr("Couldn’t start the join.");
      paint();
    });
  }

  function pollJoin() {
    if (!state.waitId && !state.waitGuild) return;
    load().then(function () {
      if (!state.waitId && !state.waitGuild) return;
      if (Date.now() - state.waitSince > 5 * 60 * 1000) {
        state.err = tr("Still waiting. Join with the spare account in Discord, then come back.");
        state.waitId = "";
        return;
      }
      // No timer loop: the next focus / pulse / manual refresh continues.
    });
  }

  function savePicker() {
    if (!state.picker || state.saveBusy) return;
    var selected = state.picker.selected.slice();
    if (!selected.length) {
      state.err = tr("Pick at least one channel.");
      paint();
      return;
    }
    var servers = ((state.picks && state.picks.servers) || []).slice();
    var row = { id: state.picker.id, channels: selected };
    var at = -1;
    servers.forEach(function (s, i) { if (String(s.id) === String(row.id)) at = i; });
    if (at >= 0) servers[at] = row;
    else servers.push(row);
    state.saveBusy = true;
    paint();
    api("/v1/discord/picks", { method: "PUT", body: { servers: servers } }).then(function (body) {
      state.saveBusy = false;
      if (!body || body.status >= 400) {
        state.err = tr("Couldn’t save those channels.");
        paint();
        return;
      }
      state.picks = body.picks;
      state.note = tr("Saved. Messages show up after the next sync.");
      state.step = "list";
      state.picker = null;
      paint();
      if (root.FeedsDiscord && root.FeedsDiscord._reloadPicked) root.FeedsDiscord._reloadPicked();
    }).catch(function () {
      state.saveBusy = false;
      state.err = tr("Couldn’t save those channels.");
      paint();
    });
  }

  function removeServer(id) {
    if (!window.confirm(tr("Remove this server from Messages?"))) return;
    var servers = ((state.picks && state.picks.servers) || []).filter(function (s) { return String(s.id) !== String(id); });
    api("/v1/discord/picks", { method: "PUT", body: { servers: servers } }).then(function (body) {
      if (body && body.status < 400) {
        state.picks = body.picks;
        paint();
        if (root.FeedsDiscord && root.FeedsDiscord._reloadPicked) root.FeedsDiscord._reloadPicked();
      }
    });
  }

  function moveServer(id, dir) {
    var servers = ((state.picks && state.picks.servers) || []).slice();
    var at = -1;
    servers.forEach(function (s, i) { if (String(s.id) === String(id)) at = i; });
    if (at < 0) return;
    var to = at + dir;
    if (to < 0 || to >= servers.length) return;
    var tmp = servers[at];
    servers[at] = servers[to];
    servers[to] = tmp;
    api("/v1/discord/picks", { method: "PUT", body: { servers: servers } }).then(function (body) {
      if (body && body.status < 400) {
        state.picks = body.picks;
        paint();
        if (root.FeedsDiscord && root.FeedsDiscord._reloadPicked) root.FeedsDiscord._reloadPicked();
      }
    });
  }

  function sheetHtml() {
    if (!state.open) return "";
    var body = "";
    if (state.step === "invite" && state.invite) {
      var inv = state.invite;
      body = '<div class="dpick-invite">' +
        (inv.guild.icon ? '<img class="dpick-ico" src="' + esc(inv.guild.icon) + '" alt="">' : '<span class="dpick-ico">' + esc((inv.guild.name || "?").slice(0, 2)) + "</span>") +
        "<div><b>" + esc(inv.guild.name) + "</b>" +
        (inv.members != null ? "<span>" + esc(tr("{count} members", { count: inv.members })) + "</span>" : "") +
        "</div></div>" +
        (inv.joined
          ? '<p class="dpick-hint">' + esc(tr("The spare account is already in this server.")) + "</p>" +
            '<button type="button" class="dpick-btn" data-dpick="pick" data-id="' + esc(inv.guild.id) + '">' + esc(tr("Pick channels")) + "</button>"
          : '<p class="dpick-hint">' + esc(tr("One tap joins with the spare Discord account. Discord may ask for a captcha; if so, this server can’t be joined that way.")) + "</p>" +
            '<button type="button" class="dpick-btn" data-dpick="join"' + (state.joinBusy ? " disabled" : "") + ">" + esc(state.joinBusy ? tr("Joining…") : tr("Join with spare account")) + "</button>") +
        '<button type="button" class="dpick-link" data-dpick="back">' + esc(tr("Back")) + "</button>";
    } else if (state.step === "waiting") {
      body = '<p class="dpick-hint">' + esc(state.note || tr("Joining…")) + "</p>" +
        '<button type="button" class="dpick-btn" data-dpick="refresh">' + esc(tr("Check again")) + "</button>" +
        '<button type="button" class="dpick-link" data-dpick="back">' + esc(tr("Back")) + "</button>";
    } else if (state.step === "picker" && state.picker) {
      var rows = (state.picker.channels || []).map(function (ch) {
        var on = state.picker.selected.indexOf(ch.id) >= 0;
        return '<label class="dpick-ch"><input type="checkbox" data-dpick="ch" data-id="' + esc(ch.id) + '"' + (on ? " checked" : "") + ">" +
          '<span class="dmsgs-hash">#</span><span>' + esc(ch.name) + "</span>" +
          (ch.category ? '<em>' + esc(ch.category) + "</em>" : "") + "</label>";
      }).join("");
      body = "<h3>" + esc(state.picker.name) + "</h3>" +
        '<p class="dpick-hint">' + esc(tr("Choose text and announcement channels to show in Messages.")) + "</p>" +
        '<div class="dpick-chs">' + rows + "</div>" +
        '<button type="button" class="dpick-btn" data-dpick="save"' + (state.saveBusy ? " disabled" : "") + ">" + esc(state.saveBusy ? tr("Saving…") : tr("Save channels")) + "</button>" +
        '<button type="button" class="dpick-link" data-dpick="back">' + esc(tr("Back")) + "</button>";
    } else {
      var joined = ((state.catalog && state.catalog.servers) || []).map(function (s) {
        var on = pickedIds(s.id);
        return '<button type="button" class="dpick-row" data-dpick="pick" data-id="' + esc(s.id) + '">' +
          (s.icon ? '<img src="' + esc(s.icon) + '" alt="">' : "<span>" + esc((s.name || "?").slice(0, 2)) + "</span>") +
          "<b>" + esc(s.name) + "</b>" +
          (on ? "<em>" + esc(tr("{count} channels", { count: on.length })) + "</em>" : "<em>" + esc(tr("Not added")) + "</em>") +
          "</button>";
      }).join("");
      var managed = ((state.picks && state.picks.servers) || []).map(function (s, i, all) {
        return '<div class="dpick-mgr" data-id="' + esc(s.id) + '"><b>' + esc(s.name || s.id) + "</b>" +
          '<span class="dpick-mgr-acts">' +
          '<button type="button" data-dpick="up" data-id="' + esc(s.id) + '"' + (i === 0 ? " disabled" : "") + ">" + esc(tr("Up")) + "</button>" +
          '<button type="button" data-dpick="down" data-id="' + esc(s.id) + '"' + (i === all.length - 1 ? " disabled" : "") + ">" + esc(tr("Down")) + "</button>" +
          '<button type="button" data-dpick="edit" data-id="' + esc(s.id) + '">' + esc(tr("Channels")) + "</button>" +
          '<button type="button" data-dpick="remove" data-id="' + esc(s.id) + '">' + esc(tr("Remove")) + "</button>" +
          "</span></div>";
      }).join("");
      body = '<p class="dpick-hint">' + esc(tr("Paste a discord.gg invite. Join with the spare account, then pick channels. Join new servers with that account first if you prefer.")) + "</p>" +
        '<label class="dpick-paste"><input type="text" id="dpick-code" placeholder="discord.gg/…" value="' + esc(state.inviteInput) + '" autocomplete="off" spellcheck="false">' +
        '<button type="button" class="dpick-btn" data-dpick="preview"' + (state.inviteBusy ? " disabled" : "") + ">" + esc(state.inviteBusy ? tr("Looking up…") : tr("Look up")) + "</button></label>" +
        (managed ? "<h3>" + esc(tr("In Messages")) + "</h3><div class=\"dpick-list\">" + managed + "</div>" : "") +
        "<h3>" + esc(tr("Spare account’s servers")) + "</h3>" +
        (joined || '<p class="dpick-hint">' + esc(tr("None listed yet. Press Check again after joining.")) + "</p>") +
        (joined ? '<div class="dpick-list">' + joined + "</div>" : "") +
        '<button type="button" class="dpick-link" data-dpick="refresh">' + esc(tr("Check again")) + "</button>";
    }
    return '<div class="dpick-sheet" role="dialog" aria-label="' + esc(tr("Add Discord")) + '">' +
      '<header><b>' + esc(tr("Add Discord")) + '</b><button type="button" class="dpick-x" data-dpick="close" aria-label="' + esc(tr("Close")) + '">×</button></header>' +
      (state.err ? '<p class="dpick-err">' + esc(state.err) + "</p>" : "") +
      (state.note && state.step !== "waiting" ? '<p class="dpick-note">' + esc(state.note) + "</p>" : "") +
      body + "</div>";
  }

  function paint() {
    if (typeof document === "undefined") return;
    var host = document.getElementById("dpick-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "dpick-host";
      document.body.appendChild(host);
    }
    host.innerHTML = sheetHtml();
    var input = document.getElementById("dpick-code");
    if (input) {
      input.oninput = function () { state.inviteInput = input.value; };
      input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); previewInvite(); } };
    }
  }

  function open() {
    if (!isOwner()) return;
    state.open = true;
    state.step = "list";
    state.err = "";
    state.note = "";
    state.invite = null;
    paint();
    load();
  }

  /* Feeds › Add account hands a pasted Discord invite here: the sheet opens
     with it filled in and looks it up. Nothing joins until the owner taps. */
  function openInvite(raw) {
    if (!isOwner()) return false;
    open();
    state.inviteInput = String(raw || "").trim().slice(0, 200);
    paint();
    previewInvite();
    return true;
  }

  function close() {
    state.open = false;
    state.step = "list";
    paint();
  }

  function onClick(event) {
    var btn = event.target && event.target.closest && event.target.closest("[data-dpick]");
    if (!btn) {
      if (state.open && event.target && event.target.id === "dpick-host") close();
      return;
    }
    if (!isOwner()) return;
    var act = btn.getAttribute("data-dpick");
    var id = btn.getAttribute("data-id") || "";
    event.preventDefault();
    if (act === "open") { open(); return; }
    if (act === "close") { close(); return; }
    if (act === "back") {
      state.step = "list";
      state.invite = null;
      state.picker = null;
      state.err = "";
      paint();
      return;
    }
    if (act === "preview") { previewInvite(); return; }
    if (act === "join") { confirmJoin(); return; }
    if (act === "refresh") {
      askRefresh(state.waitGuild || "").then(function () {
        state.note = tr("Asked the sync to re-list servers.");
        paint();
        pollJoin();
      });
      return;
    }
    if (act === "pick" || act === "edit") {
      openPickerFor(id, act === "pick" && !pickedIds(id));
      paint();
      return;
    }
    if (act === "ch") {
      if (!state.picker) return;
      var cid = snowflake(id);
      var at = state.picker.selected.indexOf(cid);
      if (btn.checked) { if (at < 0) state.picker.selected.push(cid); }
      else if (at >= 0) state.picker.selected.splice(at, 1);
      return;
    }
    if (act === "save") { savePicker(); return; }
    if (act === "remove") { removeServer(id); return; }
    if (act === "up") { moveServer(id, -1); return; }
    if (act === "down") { moveServer(id, 1); return; }
  }

  function onFocus() {
    if (!isOwner() || !state.open) return;
    if (state.waitId || state.waitGuild || state.step === "list") {
      askRefresh(state.waitGuild || "").then(function () { load(); });
    }
  }

  function addButtonHtml() {
    if (!isOwner()) return "";
    return '<button type="button" class="dmsgs-add" data-dpick="open">' + esc(tr("Add Discord")) + "</button>";
  }

  function keyBannerHtml() {
    if (!isOwner() || !state.health || state.health.status !== "invalid") return "";
    return '<div class="dpick-keywarn" role="status">' +
      "<p>" + esc(tr("Discord key stopped working, paste a new one")) + "</p>" +
      '<a class="dpick-btn" href="#/settings/keys">' + esc(tr("Connected keys")) + "</a>" +
      "</div>";
  }

  var healthAsked = 0;
  function ensureHealth() {
    if (!isOwner() || !token()) return;
    if (Date.now() - healthAsked < 15000 && state.health) return;
    healthAsked = Date.now();
    api("/v1/discord/picks").then(function (body) {
      if (!body || body.status >= 400) return;
      state.health = body.health || null;
      if (root.FeedsDiscord && root.FeedsDiscord._repaintKey) root.FeedsDiscord._repaintKey();
    }).catch(function () {});
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", function () {
      if (typeof document !== "undefined" && document.visibilityState === "visible") onFocus();
    });
    if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  }

  root.DiscordPicks = {
    open: open,
    openInvite: openInvite,
    close: close,
    addButtonHtml: addButtonHtml,
    isOwner: isOwner,
    onSignal: function () {
      if (state.open) load();
      else ensureHealth();
    },
    keyBannerHtml: keyBannerHtml,
    ensureHealth: ensureHealth,
    _state: function () { return state; }
  };
})(typeof window !== "undefined" ? window : globalThis);
