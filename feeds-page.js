/* Feeds organization. Owner adds go through the private catalog API.
   Nothing here opens a public issue or prints an account. */
(function () {
  const page = {
    doc: { accounts: [], groups: [], places: [] },
    offline: false,
    started: false,
    q: "",
    platform: "",
    group: "",
    status: "",
    sort: "order",
    selected: {},
    preview: null,
    busy: false,
    drag: "",
    confirmId: ""
  };
  let hooks = null;
  const STORE = "owner-feeds-v1";

  function tr(key, vars) {
    return hooks && hooks.tr ? hooks.tr(key, vars) : key;
  }
  function esc(value) {
    return hooks && hooks.esc ? hooks.esc(value) : String(value == null ? "" : value);
  }
  function sources() {
    return window.FeedSources || null;
  }
  function ownerOn() {
    return !!(hooks && hooks.signedOwner && hooks.signedOwner() && hooks.accountsApi && hooks.accountsApi() && hooks.accountToken && hooks.accountToken());
  }
  function zeroTrace() {
    return !!(hooks && hooks.STATE && hooks.STATE.settings && hooks.STATE.settings.privacyZeroTrace);
  }

  function readCache() {
    if (!hooks || !hooks.readStored || zeroTrace() || typeof localStorage === "undefined") return null;
    try {
      const raw = hooks.readStored(localStorage, STORE);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && Array.isArray(parsed.accounts) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeCache(doc) {
    if (!hooks || !hooks.writeStored || typeof localStorage === "undefined") return;
    if (zeroTrace()) {
      if (hooks.removeStored) hooks.removeStored(localStorage, STORE);
      return;
    }
    try { hooks.writeStored(localStorage, STORE, JSON.stringify(doc)); }
    catch (err) { /* a full quota keeps the previous copy */ }
  }

  function remember(doc) {
    page.doc = doc || { accounts: [], groups: [], places: [] };
    if (hooks && hooks.STATE) hooks.STATE.ownerCatalog = page.doc;
    writeCache(page.doc);
    syncMutes(page.doc);
  }

  function syncMutes(doc) {
    if (!hooks || !hooks.STATE || !hooks.STATE.settings) return;
    const list = hooks.STATE.settings.mutedAccounts || (hooks.STATE.settings.mutedAccounts = []);
    let changed = false;
    (doc.accounts || []).concat(doc.places || []).forEach((row) => {
      if (!row || row.muted !== true || !row.id) return;
      if (list.some((item) => String(item).toLowerCase() === String(row.id).toLowerCase())) return;
      list.push(row.id);
      changed = true;
    });
    if (changed && hooks.saveSettings) hooks.saveSettings();
  }

  function api(path, method, body) {
    const base = hooks.accountsApi();
    const token = hooks.accountToken();
    return fetch(base + path, {
      method: method,
      headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    }).then((res) => res.json().then((data) => ({ ok: res.ok, status: res.status, body: data })).catch(() => ({ ok: res.ok, status: res.status, body: null })));
  }

  function paint() {
    const active = document.activeElement;
    const id = active && active.id;
    const pos = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    if (hooks && hooks.render) hooks.render();
    if (!id) return;
    const next = document.getElementById(id);
    if (!next || !next.focus) return;
    next.focus();
    if (pos != null && next.setSelectionRange) {
      try { next.setSelectionRange(pos, pos); } catch (err) { /* a button has no caret */ }
    }
  }

  function load() {
    const cached = readCache();
    const lib = sources();
    if (cached && lib) {
      const merged = lib.mergeOffline(cached, null);
      page.doc = merged.doc;
      page.offline = true;
      if (hooks.STATE) hooks.STATE.ownerCatalog = page.doc;
    }
    if (!ownerOn()) return;
    api("/v1/owner/feeds", "GET").then((result) => {
      if (!result.ok || !result.body || !Array.isArray(result.body.accounts)) {
        page.offline = !!cached;
        paint();
        return;
      }
      const live = lib ? lib.mergeOffline(cached, result.body).doc : result.body;
      page.offline = false;
      remember(live);
      paint();
    }).catch(() => {
      page.offline = true;
      paint();
    });
  }

  function platformLabel(name) {
    const labels = {
      x: "X", threads: "Threads", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok",
      vk: "VK", telegram: "Telegram", reddit: "Reddit", bluesky: "Bluesky", mastodon: "Mastodon", rss: "RSS"
    };
    const key = labels[name] || name || "RSS";
    return tr(key);
  }

  function healthCode(row) {
    const lib = sources();
    if (lib) return lib.healthStatus(row);
    return row && row.paused ? "paused" : "ok";
  }

  function healthLabel(status) {
    if (status === "slow") return tr("Feed slow");
    if (status === "failing") return tr("Feed failing");
    if (status === "paused") return tr("Feed paused");
    return tr("Feed OK");
  }

  function lastPostOf(row) {
    const posts = (row && row.posts) || [];
    return posts[0] && posts[0].date ? String(posts[0].date) : "";
  }

  function siteRows() {
    const out = [];
    if (!hooks || !hooks.catalogRows) return out;
    const accounts = page.doc.accounts || [];
    const have = {};
    accounts.forEach((row) => { if (row && row.id) have[row.id] = true; });
    const places = {};
    (page.doc.places || []).forEach((row) => { if (row && row.id) places[row.id] = row; });
    hooks.catalogRows().forEach((feed) => {
      if (!feed || !feed.id || have[feed.id]) return;
      const place = places[feed.id] || {};
      out.push({
        id: feed.id,
        platform: feed.platform || "x",
        handle: feed.handle || "",
        name: place.label || feed.name || feed.handle || "",
        label: place.label || "",
        avatar: feed.avatar || "",
        url: feed.url || "",
        groupId: place.groupId || "",
        order: Number(place.order) || 0,
        pinned: place.pinned === true,
        muted: place.muted === true,
        paused: place.paused === true,
        tabs: Array.isArray(place.tabs) ? place.tabs : [],
        addedAt: "",
        posts: [],
        health: { status: place.paused ? "paused" : "ok", text: "", lastOk: "" },
        site: true
      });
    });
    return out;
  }

  function allRows() {
    const rows = (page.doc.accounts || []).map((row) => Object.assign({ site: false, lastPost: lastPostOf(row) }, row));
    return rows.concat(siteRows().map((row) => Object.assign({ lastPost: "" }, row)));
  }

  function selectedIds() {
    return Object.keys(page.selected).filter((id) => page.selected[id]);
  }

  function tabIdsFor(id) {
    const tabs = hooks && hooks.feedTabs ? hooks.feedTabs() : [];
    const out = [];
    (tabs || []).forEach((tab) => {
      if (!tab || !tab.id) return;
      const members = tab.members || [];
      if (members.indexOf(id) >= 0 || members.some((item) => String(item).toLowerCase() === String(id).toLowerCase())) out.push(tab.id);
    });
    return out;
  }

  function applyLocal(body) {
    if (!body) return;
    remember({
      accounts: body.accounts || page.doc.accounts || [],
      groups: body.groups || page.doc.groups || [],
      places: body.places || page.doc.places || []
    });
  }

  function replaceAccount(account) {
    if (!account || !account.id) return;
    const accounts = (page.doc.accounts || []).slice();
    const at = accounts.findIndex((row) => row && row.id === account.id);
    if (at >= 0) accounts[at] = account;
    else accounts.unshift(account);
    remember({ accounts: accounts, groups: page.doc.groups || [], places: page.doc.places || [] });
  }

  function messageOf(result, fallback) {
    const text = result && result.body && result.body.message;
    return text ? tr(text) : fallback;
  }

  function onAdd(form) {
    if (!ownerOn()) return false;
    const lib = sources();
    const input = form.querySelector("input");
    const raw = input ? input.value : "";
    if (!lib) {
      hooks.toast(tr("Couldn’t reach the source."));
      return true;
    }
    const spec = lib.detectInput(raw);
    if (!spec.ok) {
      hooks.toast(tr(spec.message));
      return true;
    }
    page.busy = true;
    paint();
    api("/v1/owner/feeds/preview", "POST", { input: raw }).then((result) => {
      page.busy = false;
      if (!result.ok || !result.body || !result.body.preview) {
        hooks.toast(messageOf(result, tr("Couldn’t reach the source.")));
        paint();
        return;
      }
      page.preview = { input: raw, card: result.body.preview };
      form.reset();
      paint();
    }).catch(() => {
      page.busy = false;
      hooks.toast(tr("Couldn’t reach the source."));
      paint();
    });
    return true;
  }

  function confirmAdd() {
    if (!page.preview || page.busy || !ownerOn()) return;
    const input = page.preview.input;
    page.busy = true;
    paint();
    api("/v1/owner/feeds", "POST", { input: input, confirm: true }).then((result) => {
      page.busy = false;
      if (!result.ok || !result.body || !result.body.account) {
        hooks.toast(messageOf(result, tr("Couldn’t save this account.")));
        paint();
        return;
      }
      replaceAccount(result.body.account);
      page.preview = null;
      if (hooks.applyFollow) hooks.applyFollow([result.body.account.id], true);
      hooks.toast(tr("Account saved."));
      paint();
    }).catch(() => {
      page.busy = false;
      hooks.toast(tr("Couldn’t save this account."));
      paint();
    });
  }

  function patchIds(ids, body) {
    if (!ownerOn() || !ids.length) return;
    api("/v1/owner/feeds/bulk", "POST", Object.assign({ ids: ids }, body)).then((result) => {
      if (!result.ok) {
        hooks.toast(messageOf(result, tr("Couldn’t save this account.")));
        return;
      }
      applyLocal(result.body);
      if (body.muted === true || body.muted === false) mirrorMute(ids, body.muted === true);
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function patchOne(id, body) {
    if (!ownerOn() || !id) return;
    api("/v1/owner/feeds/" + encodeURIComponent(id), "PATCH", body).then((result) => {
      if (!result.ok) {
        hooks.toast(messageOf(result, tr("Couldn’t save this account.")));
        return;
      }
      if (result.body && result.body.account) replaceAccount(result.body.account);
      else if (result.body && result.body.place) {
        const places = (page.doc.places || []).filter((row) => row.id !== id);
        places.push(result.body.place);
        remember({ accounts: page.doc.accounts || [], groups: page.doc.groups || [], places: places });
      }
      if (body.muted === true || body.muted === false) mirrorMute([id], body.muted === true);
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function mirrorMute(ids, on) {
    if (!hooks.STATE || !hooks.STATE.settings) return;
    const list = hooks.STATE.settings.mutedAccounts || (hooks.STATE.settings.mutedAccounts = []);
    ids.forEach((id) => {
      const at = list.findIndex((item) => String(item).toLowerCase() === String(id).toLowerCase());
      if (on && at < 0) list.push(id);
      if (!on && at >= 0) list.splice(at, 1);
    });
    if (hooks.saveSettings) hooks.saveSettings();
  }

  function removeAccount(id) {
    const row = allRows().find((item) => item.id === id);
    if (!row) return;
    if (row.site && !((page.doc.accounts || []).some((item) => item.id === id))) {
      if (hooks.applyFollow) hooks.applyFollow([id], false);
      page.confirmId = "";
      paint();
      return;
    }
    if (!ownerOn()) return;
    api("/v1/owner/feeds/" + encodeURIComponent(id), "DELETE").then((result) => {
      if (!result.ok) {
        hooks.toast(messageOf(result, tr("Couldn’t save this account.")));
        return;
      }
      applyLocal(result.body);
      page.confirmId = "";
      delete page.selected[id];
      if (hooks.applyFollow) hooks.applyFollow([id], false);
      hooks.toast(tr("Removed from feeds."));
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function retry(id) {
    if (!ownerOn()) return;
    api("/v1/owner/feeds/" + encodeURIComponent(id) + "/retry", "POST", {}).then((result) => {
      if (result.body && result.body.account) replaceAccount(result.body.account);
      if (!result.ok) hooks.toast(messageOf(result, tr("Couldn’t reach the source.")));
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t reach the source.")));
  }

  function createGroup(name) {
    const lib = sources();
    const clean = lib ? lib.cleanGroupName(name) : String(name || "").trim();
    if (!clean || !ownerOn()) return;
    api("/v1/owner/feeds/groups", "POST", { name: clean }).then((result) => {
      if (!result.ok) {
        hooks.toast(tr("Couldn’t save this account."));
        return;
      }
      if (result.body && result.body.groups) {
        remember({ accounts: page.doc.accounts || [], groups: result.body.groups, places: page.doc.places || [] });
      }
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function renameGroup(id, name) {
    const lib = sources();
    const clean = lib ? lib.cleanGroupName(name) : String(name || "").trim();
    if (!clean || !ownerOn()) return;
    api("/v1/owner/feeds/groups/" + encodeURIComponent(id), "PATCH", { name: clean }).then((result) => {
      if (!result.ok || !result.body || !result.body.group) return;
      const groups = (page.doc.groups || []).map((group) => group.id === id ? result.body.group : group);
      remember({ accounts: page.doc.accounts || [], groups: groups, places: page.doc.places || [] });
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function deleteGroup(id) {
    if (!ownerOn()) return;
    api("/v1/owner/feeds/groups/" + encodeURIComponent(id), "DELETE").then((result) => {
      if (!result.ok) return;
      applyLocal(result.body);
      if (page.group === id) page.group = "";
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function sendOrder(ids, groupId, groups) {
    if (!ownerOn()) return;
    const body = {};
    if (ids) body.ids = ids;
    if (groupId != null) body.groupId = groupId;
    if (groups) body.groups = groups;
    api("/v1/owner/feeds/reorder", "POST", body).then((result) => {
      if (result.ok) applyLocal(result.body);
      paint();
    }).catch(() => hooks.toast(tr("Couldn’t save this account.")));
  }

  function moveWithin(id, dir) {
    const rows = allRows();
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    const groupId = row.groupId || "";
    const section = rows.filter((item) => (item.groupId || "") === groupId);
    const index = section.findIndex((item) => item.id === id);
    const next = index + dir;
    if (index < 0 || next < 0 || next >= section.length) return;
    const ids = section.map((item) => item.id);
    const moved = ids.splice(index, 1)[0];
    ids.splice(next, 0, moved);
    sendOrder(ids, groupId, null);
  }

  function dropOn(targetId, groupId) {
    const fromId = page.drag;
    page.drag = "";
    if (!fromId || !ownerOn()) return;
    const rows = allRows();
    const moving = rows.find((item) => item.id === fromId);
    if (!moving) return;
    const dest = groupId != null ? groupId : (moving.groupId || "");
    const section = rows.filter((item) => (item.groupId || "") === dest && item.id !== fromId);
    const ids = section.map((item) => item.id);
    const at = targetId ? ids.indexOf(targetId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, fromId);
    sendOrder(ids, dest, null);
  }

  function toggleTab(id, tabId) {
    if (!hooks.feedTabs || !hooks.saveSettings) return;
    const tabs = hooks.feedTabs();
    const tab = (tabs || []).find((item) => item.id === tabId);
    if (!tab) return;
    const members = tab.members || (tab.members = []);
    const at = members.findIndex((item) => String(item).toLowerCase() === String(id).toLowerCase());
    if (at >= 0) members.splice(at, 1);
    else if (members.length < 500) members.push(id);
    hooks.saveSettings();
    if (ownerOn()) patchOne(id, { tabs: tabIdsFor(id) });
    else paint();
  }

  function toggleSelect(id) {
    if (page.selected[id]) delete page.selected[id];
    else page.selected[id] = true;
    paint();
  }

  function onClick(event) {
    const el = event.target && event.target.closest && event.target.closest("[data-feed-act]");
    if (!el || !hooks) return;
    const act = el.dataset.feedAct;
    const id = el.dataset.id || "";
    if (act === "select") toggleSelect(id);
    else if (act === "select-all") {
      const on = el.dataset.on !== "1";
      allRows().forEach((row) => { if (on) page.selected[row.id] = true; else delete page.selected[row.id]; });
      paint();
    }
    else if (act === "pin") patchOne(id, { pinned: el.dataset.on !== "1" });
    else if (act === "mute") patchOne(id, { muted: el.dataset.on !== "1" });
    else if (act === "pause") patchOne(id, { paused: el.dataset.on !== "1" });
    else if (act === "retry") retry(id);
    else if (act === "up") moveWithin(id, -1);
    else if (act === "down") moveWithin(id, 1);
    else if (act === "ask-remove") { page.confirmId = id; paint(); }
    else if (act === "cancel-remove") { page.confirmId = ""; paint(); }
    else if (act === "confirm-remove") removeAccount(id);
    else if (act === "tab") toggleTab(id, el.dataset.tab || "");
    else if (act === "group-create") {
      const input = document.getElementById("feeds-group-name");
      createGroup(input ? input.value : "");
      if (input) input.value = "";
    }
    else if (act === "group-rename") {
      const input = document.getElementById("feeds-rename-" + id);
      renameGroup(id, input ? input.value : "");
    }
    else if (act === "group-delete") deleteGroup(id);
    else if (act === "label") {
      const input = document.getElementById("feeds-label-" + id);
      const lib = sources();
      const label = lib ? lib.cleanLabel(input ? input.value : "") : (input ? input.value : "");
      patchOne(id, { label: label });
    }
    else if (act === "move") patchOne(id, { groupId: el.dataset.group || "" });
    else if (act === "bulk-pause") patchIds(selectedIds(), { paused: true });
    else if (act === "bulk-mute") patchIds(selectedIds(), { muted: true });
    else if (act === "bulk-pin") patchIds(selectedIds(), { pinned: true });
    else if (act === "bulk-move") patchIds(selectedIds(), { groupId: el.dataset.group || "" });
    else if (act === "clear-selected") { page.selected = {}; paint(); }
    else if (act === "preview-cancel") { page.preview = null; paint(); }
    else if (act === "preview-confirm") confirmAdd();
    else return;
    event.preventDefault();
  }

  function onChange(event) {
    const el = event.target;
    if (!el || !el.closest || !el.closest(".feeds-org")) return;
    if (el.dataset && el.dataset.feedAct === "move-select") {
      patchOne(el.dataset.id, { groupId: el.value || "" });
      return;
    }
    if (el.id === "feeds-platform") page.platform = el.value;
    else if (el.id === "feeds-group") page.group = el.value;
    else if (el.id === "feeds-status") page.status = el.value;
    else if (el.id === "feeds-sort") page.sort = el.value;
    else return;
    paint();
  }

  function onInput(event) {
    const el = event.target;
    if (!el || el.id !== "feeds-q") return;
    page.q = el.value;
    paint();
  }

  function onDragStart(event) {
    const el = event.target && event.target.closest && event.target.closest("[data-feed-drag]");
    if (!el) return;
    page.drag = el.dataset.feedDrag || "";
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", page.drag);
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function onDragOver(event) {
    const el = event.target && event.target.closest && event.target.closest("[data-feed-drop]");
    if (!el || !page.drag) return;
    event.preventDefault();
  }

  function onDrop(event) {
    const el = event.target && event.target.closest && event.target.closest("[data-feed-drop]");
    if (!el || !page.drag) return;
    event.preventDefault();
    const kind = el.dataset.feedDrop;
    if (kind === "group") {
      const groups = (page.doc.groups || []).map((group) => group.id);
      const from = page.drag.indexOf("group:") === 0 ? page.drag.slice(6) : "";
      const to = el.dataset.id || "";
      page.drag = "";
      if (!from || !to || from === to) return;
      const ids = groups.filter((id) => id !== from);
      const at = ids.indexOf(to);
      ids.splice(at < 0 ? ids.length : at, 0, from);
      sendOrder(null, null, ids);
      return;
    }
    const groupId = el.dataset.group != null ? el.dataset.group : "";
    dropOn(kind === "row" ? (el.dataset.id || "") : "", groupId);
  }

  function option(value, label, current) {
    return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
  }

  function previewCard() {
    if (!page.preview || !page.preview.card) return "";
    const card = page.preview.card;
    const posts = (card.posts || []).slice(0, 3).map((post) => `<li>${esc(post.text || tr("Photo"))}</li>`).join("");
    const face = hooks.avatar ? hooks.avatar(card.avatar, card.name || card.handle) : "";
    return `<section class="feeds-preview" role="dialog" aria-label="${esc(tr("Preview"))}">
      <div class="feeds-preview-who">${face}<span><b>${esc(card.name || card.handle || "")}</b><span>@${esc(card.handle || "")} · ${esc(platformLabel(card.platform))}</span></span></div>
      ${posts ? `<ul class="feeds-preview-posts">${posts}</ul>` : `<p class="feeds-quiet">${esc(tr("No posts yet"))}</p>`}
      <div class="feeds-preview-actions"><button type="button" class="follow" data-feed-act="preview-confirm"${page.busy ? " disabled" : ""}>${esc(tr("Add this account"))}</button><button type="button" class="outline" data-feed-act="preview-cancel">${esc(tr("Cancel"))}</button></div>
    </section>`;
  }

  function rowHtml(row) {
    const id = row.id;
    const healthClass = healthCode(row);
    const text = (row.health && row.health.text) || "";
    const last = row.health && (row.health.updatedAt || row.health.lastOk);
    const when = last && hooks.relTime ? hooks.relTime(last) : (last ? String(last).slice(0, 16) : "");
    const face = hooks.avatar ? hooks.avatar(row.avatar, row.label || row.name || row.handle) : "";
    const tabs = hooks.feedTabs ? hooks.feedTabs() : [];
    const tabBits = (tabs || []).filter((tab) => tab && tab.id && tab.kind !== "verified" && tab.kind !== "mentions").map((tab) => {
      const on = tabIdsFor(id).indexOf(tab.id) >= 0;
      return `<button type="button" class="feeds-tab${on ? " on" : ""}" data-feed-act="tab" data-id="${esc(id)}" data-tab="${esc(tab.id)}">${esc(tab.name || "")}</button>`;
    }).join("");
    const groups = page.doc.groups || [];
    const groupOptions = [`<option value="">${esc(tr("Ungrouped"))}</option>`].concat(groups.map((group) => option(group.id, group.name, row.groupId || ""))).join("");
    const confirm = page.confirmId === id
      ? `<div class="feeds-confirm"><span>${esc(tr("Remove this account?"))}</span><button type="button" class="follow remove-pill" data-feed-act="confirm-remove" data-id="${esc(id)}">${esc(tr("Remove"))}</button><button type="button" class="outline" data-feed-act="cancel-remove">${esc(tr("Cancel"))}</button></div>`
      : "";
    const checked = page.selected[id] ? " checked" : "";
    const controls = ownerOn() ? `<label class="feeds-check"><input type="checkbox" data-feed-act="select" data-id="${esc(id)}"${checked} aria-label="${esc(tr("Select"))}"></label>` : "";
    const actions = ownerOn() ? `<span class="feeds-row-actions">
        <button type="button" class="outline" data-feed-act="pin" data-id="${esc(id)}" data-on="${row.pinned ? "1" : "0"}">${esc(row.pinned ? tr("Unpin") : tr("Pin"))}</button>
        <button type="button" class="outline" data-feed-act="mute" data-id="${esc(id)}" data-on="${row.muted ? "1" : "0"}">${esc(row.muted ? tr("Unmute") : tr("Mute"))}</button>
        <button type="button" class="outline" data-feed-act="pause" data-id="${esc(id)}" data-on="${row.paused ? "1" : "0"}">${esc(row.paused ? tr("Resume") : tr("Pause"))}</button>
        <button type="button" class="outline" data-feed-act="retry" data-id="${esc(id)}">${esc(tr("Retry now"))}</button>
        <button type="button" class="outline" data-feed-act="up" data-id="${esc(id)}" aria-label="${esc(tr("Move up"))}">↑</button>
        <button type="button" class="outline" data-feed-act="down" data-id="${esc(id)}" aria-label="${esc(tr("Move down"))}">↓</button>
        <button type="button" class="follow remove-pill" data-feed-act="ask-remove" data-id="${esc(id)}">${esc(tr("Remove"))}</button>
      </span>` : `<button type="button" class="follow remove-pill" data-feed-act="ask-remove" data-id="${esc(id)}">${esc(tr("Remove"))}</button>`;
    return `<article class="feeds-row${row.pinned ? " is-pinned" : ""}" data-feed-drag="${esc(id)}" data-feed-drop="row" data-id="${esc(id)}" data-group="${esc(row.groupId || "")}" draggable="${ownerOn() ? "true" : "false"}">
      ${controls}
      <a class="who-main" href="${esc(hooks.accountHash ? hooks.accountHash(row.platform, row.channelId || row.handle) : "#/feeds")}">${face}<span class="who-copy"><span class="name">${esc(row.label || row.name || row.handle)}</span><span class="handle">@${esc(row.handle || "")} · ${esc(platformLabel(row.platform))}</span></span></a>
      <span class="feeds-health is-${esc(healthClass)}"><b>${esc(healthLabel(healthClass))}</b>${when ? `<span>${esc(tr("Last updated"))} ${esc(when)}</span>` : ""}${text ? `<span>${esc(tr(text))}</span>` : ""}</span>
      ${actions}
      ${ownerOn() ? `<label class="feeds-label">${esc(tr("Account label"))}<input id="feeds-label-${esc(id)}" value="${esc(row.label || "")}" maxlength="80"><button type="button" data-feed-act="label" data-id="${esc(id)}">${esc(tr("Rename"))}</button></label>` : ""}
      ${ownerOn() ? `<label class="feeds-move">${esc(tr("Move to group"))}<select data-feed-act="move-select" data-id="${esc(id)}">${groupOptions}</select></label>` : ""}
      ${tabBits ? `<div class="feeds-tabs"><span>${esc(tr("Show in tabs"))}</span>${tabBits}</div>` : ""}
      ${confirm}
    </article>`;
  }

  function sectionHtml(block, draggable) {
    const title = block.platform ? platformLabel(block.platform) : (block.title || tr("Ungrouped"));
    const rename = draggable && block.id && ownerOn()
      ? `<label class="feeds-rename"><input id="feeds-rename-${esc(block.id)}" value="${esc(block.title || "")}" maxlength="40" aria-label="${esc(tr("Group name"))}"><button type="button" data-feed-act="group-rename" data-id="${esc(block.id)}">${esc(tr("Rename"))}</button><button type="button" data-feed-act="group-delete" data-id="${esc(block.id)}">${esc(tr("Delete group"))}</button></label>`
      : "";
    const rows = (block.rows || []).map(rowHtml).join("");
    const drag = draggable && block.id ? ` data-feed-drag="group:${esc(block.id)}" draggable="true"` : "";
    return `<section class="feeds-section" data-feed-drop="group" data-id="${esc(block.id || "")}" data-group="${esc(block.id || "")}"${drag}><h2>${esc(title)}</h2>${rename}${rows || `<p class="feeds-quiet">${esc(tr("No accounts"))}</p>`}</section>`;
  }

  function view() {
    if (!hooks) return "";
    if (ownerOn() && !page.started) {
      page.started = true;
      load();
    }
    const lib = sources();
    const rows = allRows();
    const groups = (page.doc.groups || []).slice();
    const organized = lib ? lib.organizeFeeds(rows, groups, {
      q: page.q, platform: page.platform, group: page.group, status: page.status, sort: page.sort
    }) : { sections: [{ id: "", title: "", rows: rows }], ungroupedByPlatform: [], count: rows.length };
    const named = (organized.sections || []).filter((block) => block.id);
    const loose = (organized.sections || []).filter((block) => !block.id);
    let blocks = [];
    if (!page.group) {
      blocks = named.map((block) => sectionHtml(block, true));
      (organized.ungroupedByPlatform || []).forEach((block) => {
        const platform = String(block.id || "").replace(/^platform:/, "");
        blocks.push(sectionHtml({ id: "", title: platformLabel(platform), platform: platform, rows: block.rows }, false));
      });
    } else {
      blocks = (page.group === "none" ? loose : named).map((block) => sectionHtml(block, !!block.id));
    }
    const platforms = {};
    rows.forEach((row) => { platforms[row.platform || "rss"] = true; });
    const platformOptions = [option("", tr("All platforms"), page.platform)].concat(Object.keys(platforms).sort().map((name) => option(name, platformLabel(name), page.platform))).join("");
    const groupOptions = [option("", tr("All groups"), page.group), option("none", tr("Ungrouped"), page.group)].concat(groups.map((group) => option(group.id, group.name, page.group))).join("");
    const statusOptions = ["", "ok", "slow", "failing", "paused"].map((value) => option(value, value ? healthLabel(value) : tr("All statuses"), page.status)).join("");
    const sortOptions = [
      option("order", tr("Custom order"), page.sort),
      option("name", tr("Sort by name"), page.sort),
      option("added", tr("Recently added"), page.sort),
      option("last", tr("Last post"), page.sort)
    ].join("");
    const picked = selectedIds();
    const bulkMove = groups.map((group) => `<button type="button" data-feed-act="bulk-move" data-group="${esc(group.id)}">${esc(group.name)}</button>`).join("");
    const bulk = ownerOn() && picked.length
      ? `<div class="feeds-bulk" role="region" aria-label="${esc(tr("Bulk actions"))}"><span>${esc(tr("{count} selected", { count: String(picked.length) }))}</span><button type="button" data-feed-act="bulk-pin">${esc(tr("Pin"))}</button><button type="button" data-feed-act="bulk-mute">${esc(tr("Mute"))}</button><button type="button" data-feed-act="bulk-pause">${esc(tr("Pause"))}</button>${bulkMove}<button type="button" data-feed-act="clear-selected">${esc(tr("Clear selection"))}</button></div>`
      : "";
    const offline = page.offline ? `<p class="feeds-offline">${esc(tr("Offline. Showing the last saved feeds."))}</p>` : "";
    const add = `<form class="add-account"><label class="search"><span>${hooks.icon ? hooks.icon("search") : ""}</span><input id="add-account" placeholder="${esc(tr("Add account URL or @handle"))}" aria-label="${esc(tr("Add account"))}"></label><button class="follow" type="submit">${esc(tr("Add"))}</button></form>`;
    const tools = `<div class="feeds-tools">
      <label class="search feeds-search"><span class="sr">${hooks.icon ? hooks.icon("search") : ""}</span><input id="feeds-q" type="search" value="${esc(page.q)}" placeholder="${esc(tr("Search feeds"))}" aria-label="${esc(tr("Search feeds"))}"></label>
      <label>${esc(tr("Filter by platform"))}<select id="feeds-platform">${platformOptions}</select></label>
      <label>${esc(tr("Filter by group"))}<select id="feeds-group">${groupOptions}</select></label>
      <label>${esc(tr("Filter by status"))}<select id="feeds-status">${statusOptions}</select></label>
      <label>${esc(tr("Sort feeds"))}<select id="feeds-sort">${sortOptions}</select></label>
    </div>`;
    const maker = ownerOn()
      ? `<div class="feeds-group-create"><label>${esc(tr("Group name"))}<input id="feeds-group-name" maxlength="40"></label><button type="button" class="follow" data-feed-act="group-create">${esc(tr("Create group"))}</button><button type="button" class="outline" data-feed-act="select-all" data-on="${picked.length === rows.length && rows.length ? "1" : "0"}">${esc(tr("Select"))}</button></div>`
      : "";
    const head = hooks.pageHead ? hooks.pageHead(tr("Feeds")) : "";
    const body = blocks.length ? blocks.join("") : `<p class="feeds-quiet">${esc(tr("No accounts"))}</p>`;
    return head + `<div class="feeds-org">${add}${offline}${previewCard()}${tools}${bulk}${maker}${body}</div>`;
  }

  function attach(next) {
    hooks = next || hooks;
    if (page.bound) return;
    page.bound = true;
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
  }

  window.FeedsPage = { attach: attach, view: view, onAdd: onAdd };
})();
