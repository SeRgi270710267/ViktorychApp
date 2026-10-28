/* Presence dots, last seen, and custom status.
   The heartbeat stays on a one-minute timer while the tab is visible.
   A hibernating WebSocket carries changes. It connects only while the
   page is visible and closes when the page is hidden. If the socket is
   down, the same visible tab reads presence about once a minute. */

import {
  HEARTBEAT_MS,
  IDLE_MS,
  PRESENCE_CLIENT_MS,
  WATCH_LIMIT,
  isAccountId,
  lastSeenPhrase,
  presenceEmoji,
  shouldConnect
} from "./shared/presence.js";

const CHOICE_IDS = ["online", "idle", "dnd", "invisible"];
const PRIVACY_IDS = ["everyone", "follows", "nobody"];
const CLEAR_IDS = ["30m", "1h", "4h", "today", "week", "never"];
const FREE_EMOJI = ["🟢", "🟠", "🔴", "🌙"];
const STATUS_AUDIENCE = ["everyone", "followers", "following", "friends", "nobody", "list"];

const cache = new Map();
let mine = null;
let socket = null;
let wantSocket = false;
let reconnectTimer = 0;
let attempt = 0;
let heartTimer = 0;
let idleTimer = 0;
let pollTimer = 0;
let watchTimer = 0;
let lastInput = Date.now();
let lastActivity = "";
let lastBeatAt = 0;
let hiddenBeat = false;
let watchKey = "";
let polledAt = 0;
let sheet = null;
let sheetAnchor = null;
let audioCtx = null;
let ownedSpecials = [];
const noteListeners = [];

function tr(key, vars) {
  const fn = window.t || (window.SI18n && window.SI18n.t);
  return fn ? fn(key, vars) : key;
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;";
  });
}

function accounts() {
  return window.ViktorychAccounts || null;
}

function selfId() {
  const api = accounts();
  const account = api && api.account && api.account();
  const id = account && account.publicId;
  return isAccountId(id) ? id : "";
}

function token() {
  const api = accounts();
  const value = api && api.token && api.token();
  return value ? String(value) : "";
}

function visibility() {
  return document.visibilityState || "hidden";
}

function visible() {
  return shouldConnect(visibility());
}

function call(path, opts) {
  const api = accounts();
  if (!api || !api.call || !token()) return Promise.resolve(null);
  const next = Object.assign({ token: token() }, opts || {});
  return api.call(path, next).catch(function () { return null; });
}

function applyMine(body) {
  const id = selfId();
  if (!id || !body) return;
  const prev = mine || {};
  mine = {
    id: id,
    state: body.state || prev.state || "offline",
    exact: true,
    lastSeen: body.lastSeen != null ? Number(body.lastSeen) || 0 : (prev.lastSeen || 0),
    emoji: body.emoji != null ? body.emoji : (prev.emoji || ""),
    text: body.text != null ? body.text : (prev.text || ""),
    preference: body.preference || prev.preference || "online",
    seenPrivacy: body.seenPrivacy || prev.seenPrivacy || "everyone",
    audience: body.audience || prev.audience || "everyone",
    listIds: Array.isArray(body.listIds) ? body.listIds : (prev.listIds || []),
    clearAt: body.clearAt != null ? Number(body.clearAt) || 0 : (prev.clearAt || 0)
  };
  cache.set(id, { view: mine, at: Date.now() });
}

function remember(view) {
  if (!view || !isAccountId(view.id)) return;
  const id = view.id;
  if (id === selfId() && mine) {
    view.preference = view.preference || mine.preference;
    view.seenPrivacy = view.seenPrivacy || mine.seenPrivacy;
    if (view.state === "offline" && mine.preference === "invisible") view.state = "invisible";
  }
  cache.set(id, { view: view, at: Date.now() });
  if (id === selfId()) mine = view;
}

function cached(id) {
  if (mine && mine.id === id) return mine;
  const row = cache.get(id);
  return row ? row.view : null;
}

function fresh(id) {
  const row = cache.get(id);
  return !!(row && Date.now() - row.at < PRESENCE_CLIENT_MS);
}

function phrase(view) {
  if (!view) return "";
  const spoken = lastSeenPhrase(view.lastSeen, Date.now(), view.exact !== false, view.state);
  if (!spoken.key) return "";
  return tr(spoken.key, spoken.vars || undefined);
}

function lineText(view) {
  return phrase(view);
}

function badgeChar(view) {
  if (view && view.emoji) return view.emoji;
  return presenceEmoji(view && view.state);
}

function activityNow() {
  if (!visible()) return "hidden";
  if (Date.now() - lastInput >= IDLE_MS) return "idle";
  return "active";
}

function beat(force) {
  if (!token() || !isAccountId(selfId())) return;
  const activity = activityNow();
  if (!force && activity === lastActivity && Date.now() - lastBeatAt < HEARTBEAT_MS) return;
  lastActivity = activity;
  lastBeatAt = Date.now();
  call("/v1/presence", { method: "POST", body: { activity: activity } }).then(function (body) {
    if (!body || body.status !== 200) return;
    applyMine(body);
    paint();
  });
}

function armHeart() {
  clearInterval(heartTimer);
  clearTimeout(idleTimer);
  if (!visible()) return;
  heartTimer = setInterval(function () { beat(false); }, HEARTBEAT_MS);
  idleTimer = setTimeout(function () { beat(true); }, Math.max(1000, IDLE_MS - (Date.now() - lastInput)));
}

function noteInput() {
  const was = lastActivity;
  lastInput = Date.now();
  if (visible() && (was === "idle" || was === "hidden")) beat(true);
  clearTimeout(idleTimer);
  if (visible()) idleTimer = setTimeout(function () { beat(true); }, IDLE_MS);
}

function currentIds() {
  const ids = [];
  const root = document.getElementById("app") || document.body;
  root.querySelectorAll("[data-pid], [data-pid-line], [data-pid-status]").forEach(function (el) {
    const id = el.getAttribute("data-pid") || el.getAttribute("data-pid-line") || el.getAttribute("data-pid-status") || "";
    if (isAccountId(id) && id !== selfId() && ids.indexOf(id) < 0 && ids.length < WATCH_LIMIT) ids.push(id);
  });
  ids.sort();
  return ids;
}

function socketOpen() {
  return !!(socket && socket.readyState === 1);
}

function sendWatch(ids) {
  if (!socketOpen()) return;
  try { socket.send(JSON.stringify({ op: "watch", topic: "presence", ids: ids })); }
  catch (err) { /* the close handler reconnects while the page stays visible */ }
}

function syncWatch() {
  const ids = currentIds();
  const key = ids.join(",");
  if (key === watchKey) return;
  watchKey = key;
  if (socketOpen()) sendWatch(ids);
  else if (visible() && ids.length) poll(true);
}

function poll(force) {
  if (!visible() || socketOpen() || !token()) return;
  const ids = watchKey ? watchKey.split(",").filter(isAccountId) : currentIds();
  if (!ids.length) return;
  if (!force && Date.now() - polledAt < HEARTBEAT_MS) return;
  const missing = ids.some(function (id) { return !fresh(id); });
  if (!force && !missing && Date.now() - polledAt < HEARTBEAT_MS) return;
  polledAt = Date.now();
  call("/v1/presence?ids=" + ids.slice(0, 40).join(",")).then(function (body) {
    if (!body || body.status !== 200 || !Array.isArray(body.presence)) return;
    body.presence.forEach(remember);
    paint();
  });
}

function armPoll() {
  clearInterval(pollTimer);
  if (!visible() || socketOpen()) return;
  pollTimer = setInterval(function () { poll(true); }, HEARTBEAT_MS);
}

function notifyChannel(msg) {
  for (let i = 0; i < noteListeners.length; i++) {
    try { noteListeners[i](msg); }
    catch (err) { /* a listener cannot break presence */ }
  }
}

function onChannel(fn) {
  if (typeof fn !== "function" || noteListeners.indexOf(fn) >= 0) return;
  noteListeners.push(fn);
}

function offChannel(fn) {
  const at = noteListeners.indexOf(fn);
  if (at >= 0) noteListeners.splice(at, 1);
}

function onSocketMessage(event) {
  let msg = null;
  try { msg = JSON.parse(String(event.data || "")); }
  catch (err) { return; }
  if (!msg) return;
  if (msg.op === "event" && msg.topic === "notifications") {
    notifyChannel(msg);
    return;
  }
  if (msg.op !== "event" || msg.topic !== "presence") return;
  const view = msg.data || {};
  view.id = msg.id || view.id;
  remember(view);
  paint();
}

function connect() {
  if (!visible() || !token() || !isAccountId(selfId())) return;
  const api = accounts();
  const root = api && api.currentApi && api.currentApi();
  if (!root) return;
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
  wantSocket = true;
  call("/v1/channel/ticket", { method: "POST", body: {} }).then(function (body) {
    if (!wantSocket || !visible()) return;
    if (!body || body.status !== 200 || !body.ticket) {
      scheduleReconnect();
      return;
    }
    const wsRoot = String(root).replace(/^http/i, "ws");
    let ws = null;
    try { ws = new WebSocket(wsRoot + "/v1/channel?ticket=" + encodeURIComponent(body.ticket)); }
    catch (err) {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.addEventListener("open", function () {
      attempt = 0;
      try {
        ws.send(JSON.stringify({ op: "subscribe", topics: ["presence", "notifications"] }));
        ws.send(JSON.stringify({ op: "watch", topic: "presence", ids: currentIds() }));
      } catch (err) { /* close reconnects */ }
      clearInterval(pollTimer);
      notifyChannel({ op: "state", open: true });
    });
    ws.addEventListener("message", onSocketMessage);
    ws.addEventListener("close", function () {
      if (socket === ws) socket = null;
      notifyChannel({ op: "state", open: false });
      if (wantSocket && visible()) {
        armPoll();
        scheduleReconnect();
      }
    });
    ws.addEventListener("error", function () {
      try { ws.close(); } catch (err) { /* close follows */ }
    });
  });
}

function scheduleReconnect() {
  if (!wantSocket || !visible()) return;
  const delays = [5000, 15000, 60000];
  const wait = delays[Math.min(attempt, delays.length - 1)];
  attempt += 1;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, wait);
}

function closeSocket() {
  wantSocket = false;
  clearTimeout(reconnectTimer);
  clearInterval(pollTimer);
  const current = socket;
  socket = null;
  if (!current) return;
  try { current.close(); } catch (err) { /* already closed */ }
}

function onVisibility() {
  if (!visible()) {
    closeSocket();
    clearInterval(heartTimer);
    clearTimeout(idleTimer);
    if (!hiddenBeat) {
      hiddenBeat = true;
      beat(true);
    }
    return;
  }
  hiddenBeat = false;
  armHeart();
  beat(true);
  connect();
  armPoll();
}

function paint(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-pid]").forEach(function (el) {
    const id = el.getAttribute("data-pid") || "";
    const view = cached(id);
    const state = view && view.state ? view.state : "";
    if (el.getAttribute("data-presence") !== state) el.setAttribute("data-presence", state);
    const badge = el.querySelector(".status-badge");
    if (badge) badge.textContent = badgeChar(view);
    const label = [view && view.emoji, lineText(view)].filter(Boolean).join(" ");
    if (label) el.setAttribute("title", label);
  });
  scope.querySelectorAll("[data-pid-line]").forEach(function (el) {
    const view = cached(el.getAttribute("data-pid-line") || "");
    el.textContent = lineText(view);
  });
  scope.querySelectorAll("[data-pid-status]").forEach(function (el) {
    const view = cached(el.getAttribute("data-pid-status") || "");
    const fallback = el.getAttribute("data-fallback") || "";
    el.textContent = (view && phrase(view)) || fallback;
  });
}

function refresh(root) {
  paint(root || document);
  clearTimeout(watchTimer);
  watchTimer = setTimeout(syncWatch, 250);
}

function choiceCopy(id) {
  if (id === "online") return [tr("Online"), tr("Idle after about 5 minutes away")];
  if (id === "idle") return [tr("Idle"), tr("Always shown as idle")];
  if (id === "dnd") return [tr("Do not disturb"), tr("Mutes notification sounds and toasts")];
  return [tr("Invisible"), tr("Appears offline")];
}

function privacyCopy(id) {
  if (id === "follows") return tr("People I follow and my followers");
  if (id === "nobody") return tr("Nobody");
  return tr("Everyone");
}

function clearCopy(id) {
  if (id === "30m") return tr("30 minutes");
  if (id === "1h") return tr("1 hour");
  if (id === "4h") return tr("4 hours");
  if (id === "today") return tr("Today");
  if (id === "week") return tr("This week");
  return tr("Never");
}

function choiceRows(selected, name) {
  return CHOICE_IDS.map(function (id) {
    const on = selected === id;
    const copy = choiceCopy(id);
    return '<button type="button" class="presence-choice' + (on ? " on" : "") + '" data-presence="' + name + '" data-value="' + id + '" aria-pressed="' + (on ? "true" : "false") + '"><b>' + esc(copy[0]) + '</b><span>' + esc(copy[1]) + '</span></button>';
  }).join("");
}

function privacyRows(selected) {
  return PRIVACY_IDS.map(function (id) {
    const on = selected === id;
    return '<button type="button" class="presence-choice' + (on ? " on" : "") + '" data-presence="privacy" data-value="' + id + '" aria-pressed="' + (on ? "true" : "false") + '"><b>' + esc(privacyCopy(id)) + '</b></button>';
  }).join("");
}

function audienceCopy(id) {
  if (id === "followers") return tr("Followers");
  if (id === "following") return tr("Accounts you follow");
  if (id === "friends") return tr("Friends");
  if (id === "nobody") return tr("Nobody");
  if (id === "list") return tr("Custom lists");
  return tr("Everyone");
}

function freeEmojiLabel(emoji) {
  if (emoji === "🟢") return tr("Green status");
  if (emoji === "🟠") return tr("Orange status");
  if (emoji === "🔴") return tr("Red status");
  if (emoji === "🌙") return tr("Moon status");
  return tr("Status emoji");
}

function emojiButtons(current) {
  const free = FREE_EMOJI.map(function (emoji) {
    const on = current === emoji;
    return '<button type="button" class="presence-emoji' + (on ? " on" : "") + '" data-presence="emoji" data-emoji="' + emoji + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(freeEmojiLabel(emoji)) + '">' + emoji + '</button>';
  }).join("");
  const owned = ownedSpecials.map(function (item) {
    const on = current === item.emoji;
    return '<button type="button" class="presence-emoji' + (on ? " on" : "") + '" data-presence="emoji" data-emoji="' + esc(item.emoji) + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(emojiLabel(item.id)) + '">' + esc(item.emoji) + '</button>';
  }).join("");
  return '<div class="presence-emojis">' + free + owned + '</div>';
}

function emojiLabel(id) {
  if (id === "flame") return tr("Flame status");
  if (id === "party") return tr("Party status");
  if (id === "rocket") return tr("Rocket status");
  if (id === "rainbow") return tr("Rainbow status");
  if (id === "dragon") return tr("Dragon status");
  if (id === "gem") return tr("Gem status");
  if (id === "unicorn") return tr("Unicorn status");
  if (id === "regal") return tr("Crown status");
  return tr("Status emoji");
}

function formHtml() {
  const pref = (mine && mine.preference) || "online";
  const privacy = (mine && mine.seenPrivacy) || "everyone";
  const audience = (mine && mine.audience) || "everyone";
  const clear = "never";
  const options = CLEAR_IDS.map(function (id) {
    return '<option value="' + id + '"' + (clear === id ? " selected" : "") + '>' + esc(clearCopy(id)) + '</option>';
  }).join("");
  const audienceOptions = STATUS_AUDIENCE.map(function (id) {
    return '<option value="' + id + '"' + (audience === id ? " selected" : "") + '>' + esc(audienceCopy(id)) + '</option>';
  }).join("");
  const lists = audience === "list" && window.AudienceLists && window.AudienceLists.checksHtml
    ? window.AudienceLists.checksHtml(mine && mine.listIds)
    : "";
  return '<div class="presence-form">' +
    '<p class="presence-kicker">' + esc(tr("Your status")) + '</p>' +
    choiceRows(pref, "preference") +
    '<p class="presence-kicker">' + esc(tr("Pick an emoji")) + '</p>' +
    emojiButtons(mine && mine.emoji || "") +
    '<input data-presence-emoji maxlength="16" placeholder="' + esc(tr("Any emoji")) + '" aria-label="' + esc(tr("Any emoji")) + '" value="' + esc(mine && mine.emoji || "") + '">' +
    '<label class="presence-clear">' + esc(tr("Clear after")) +
      '<select data-presence-clear aria-label="' + esc(tr("Clear after")) + '">' + options + '</select></label>' +
    '<label class="presence-clear">' + esc(tr("Who can see this status")) +
      '<select data-presence-audience aria-label="' + esc(tr("Who can see this status")) + '">' + audienceOptions + '</select></label>' +
    lists +
    '<div class="presence-actions"><button type="button" class="presence-save" data-presence="save">' + esc(tr("Save")) + '</button>' +
      '<button type="button" class="presence-textbtn" data-presence="clear-status">' + esc(tr("Clear status")) + '</button></div>' +
    '<p class="presence-kicker">' + esc(tr("Who can see my last seen")) + '</p>' +
    '<p class="presence-note">' + esc(tr("Last seen and online")) + '</p>' +
    privacyRows(privacy) +
    '<p class="presence-note" data-presence-note></p>' +
  '</div>';
}

function settingsHtml() {
  return '<div class="presence-settings"><h2>' + esc(tr("Last seen and online")) + '</h2>' + formHtml() + '</div>';
}

function ensureSheet() {
  if (sheet) return sheet;
  sheet = document.createElement("div");
  sheet.className = "presence-sheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", tr("Your status"));
  sheet.innerHTML = '<div class="presence-card"></div>';
  document.body.appendChild(sheet);
  return sheet;
}

function fillSheet() {
  if (!sheet) return;
  const card = sheet.querySelector(".presence-card");
  card.innerHTML = '<div class="presence-grab"></div>' + formHtml();
}

function placeSheet() {
  if (!sheet || sheet.hidden) return;
  const wide = window.innerWidth >= 700;
  sheet.classList.toggle("presence-pop", wide && !!sheetAnchor);
  const card = sheet.querySelector(".presence-card");
  if (!wide || !sheetAnchor) {
    card.style.left = "";
    card.style.bottom = "";
    return;
  }
  const rect = sheetAnchor.getBoundingClientRect();
  card.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 336)) + "px";
  card.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + "px";
}

function loadOwned() {
  return call("/v1/status-emoji").then(function (body) {
    if (!body || body.status !== 200 || !Array.isArray(body.emojis)) return;
    ownedSpecials = body.emojis.filter(function (item) { return item && item.owned && item.emoji; });
  });
}

function open(anchor) {
  if (!token()) return;
  sheetAnchor = anchor || null;
  ensureSheet();
  sheet.hidden = false;
  fillSheet();
  placeSheet();
  Promise.all([call("/v1/presence"), loadOwned()]).then(function (parts) {
    const body = parts[0];
    if (body && body.status === 200) applyMine(body);
    fillSheet();
    paint();
  });
}

function close() {
  if (sheet) sheet.hidden = true;
  sheetAnchor = null;
}

function readBox(root) {
  const emoji = root.querySelector("[data-presence-emoji]");
  const picked = root.querySelector(".presence-emoji.on");
  const clear = root.querySelector("[data-presence-clear]");
  const audience = root.querySelector("[data-presence-audience]");
  const typed = emoji ? String(emoji.value || "").trim() : "";
  const choice = picked ? picked.getAttribute("data-emoji") || "" : "";
  return {
    emoji: typed || choice,
    clear: clear ? clear.value : "never",
    audience: audience ? audience.value : ((mine && mine.audience) || "everyone"),
    listIds: window.AudienceLists && window.AudienceLists.selectedLists ? window.AudienceLists.selectedLists(root) : []
  };
}

function note(root, text) {
  const el = root && root.querySelector("[data-presence-note]");
  if (el) el.textContent = text || "";
}

function save(root, status) {
  const body = {};
  if (mine && mine.preference) body.preference = mine.preference;
  if (mine && mine.seenPrivacy) body.seenPrivacy = mine.seenPrivacy;
  if (status === null) body.status = null;
  else if (status) {
    const end = new Date();
    if (status.clear === "today") end.setHours(24, 0, 0, 0);
    if (status.clear === "week") {
      const day = end.getDay();
      const add = (8 - (day || 7)) % 7 || 7;
      end.setDate(end.getDate() + add);
      end.setHours(0, 0, 0, 0);
    }
    body.status = {
      emoji: status.emoji,
      text: "",
      clear: status.clear,
      clearAt: status.clear === "today" || status.clear === "week" ? end.getTime() : 0,
      audience: status.audience || "everyone",
      listIds: status.listIds || []
    };
  }
  return call("/v1/presence", { method: "PATCH", body: body }).then(function (res) {
    if (!res || res.status !== 200) {
      note(root, res && res.error === "owned" ? tr("This emoji is not in your collection.") : tr("Couldn’t save your status."));
      return;
    }
    applyMine(res);
    note(root, tr("Status saved"));
    paint();
    const api = accounts();
    if (api && api.requestRender) api.requestRender();
  });
}

function onClick(event) {
  const el = event.target && event.target.closest && event.target.closest("[data-presence]");
  if (!el) {
    if (sheet && !sheet.hidden && event.target === sheet) close();
    return;
  }
  const act = el.getAttribute("data-presence");
  const root = el.closest(".presence-form") || document;
  if (act === "preference" || act === "privacy") {
    event.preventDefault();
    const value = el.getAttribute("data-value") || "";
    if (!mine) mine = { id: selfId(), exact: true, preference: "online", seenPrivacy: "everyone", state: "offline", emoji: "", text: "" };
    if (act === "preference") {
      mine.preference = value;
      if (value === "invisible") mine.state = "invisible";
      else if (value === "dnd") mine.state = "dnd";
      else if (value === "idle") mine.state = "idle";
      else mine.state = "online";
    } else mine.seenPrivacy = value;
    cache.set(selfId(), { view: mine, at: Date.now() });
    paint();
    const box = el.closest(".presence-card, .presence-settings") || document.body;
    box.querySelectorAll('[data-presence="' + act + '"]').forEach(function (button) {
      const on = button.getAttribute("data-value") === value;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    save(root);
    return;
  }
  if (act === "emoji") {
    event.preventDefault();
    const value = el.getAttribute("data-emoji") || "";
    const box = el.closest(".presence-form") || document;
    const field = box.querySelector("[data-presence-emoji]");
    if (field) field.value = value;
    box.querySelectorAll(".presence-emoji").forEach(function (button) {
      const on = button === el;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    return;
  }
  if (act === "save" || act === "clear-status") {
    event.preventDefault();
    save(root, act === "clear-status" ? null : readBox(root));
    return;
  }
  if (act === "close") close();
}

function wrap(publicId, html, attrs) {
  if (!isAccountId(publicId) || !html || String(html).indexOf("ava-none") >= 0) return html || "";
  const view = cached(publicId);
  const state = view && view.state ? view.state : "";
  return '<span class="ava-presence" data-pid="' + publicId + '" data-presence="' + esc(state) + '"' + (attrs || "") + '>' + html + '<i class="status-badge" aria-hidden="true">' + esc(badgeChar(view)) + '</i></span>';
}

function linesHtml(publicId) {
  if (!isAccountId(publicId)) return "";
  const view = cached(publicId);
  return '<div class="presence-lines" data-pid-line="' + publicId + '">' + esc(lineText(view)) + '</div>';
}

function dmSubHtml(publicId, fallback) {
  const text = fallback == null ? "" : String(fallback);
  if (!isAccountId(publicId)) return esc(text);
  const view = cached(publicId);
  const shown = (view && phrase(view)) || text;
  return '<span data-pid-status="' + publicId + '" data-fallback="' + esc(text) + '">' + esc(shown) + '</span>';
}

function mutesNotices() {
  return !!(mine && mine.preference === "dnd");
}

function chime() {
  if (mutesNotices()) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!audioCtx) audioCtx = new Ctx();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (err) { /* a blocked audio context stays silent */ }
}

function boot() {
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointerdown", noteInput, { passive: true, capture: true });
  window.addEventListener("keydown", noteInput, true);
  window.addEventListener("scroll", noteInput, { passive: true, capture: true });
  document.addEventListener("click", onClick);
  document.addEventListener("change", function (event) {
    const el = event.target;
    if (!el || !el.getAttribute || !el.hasAttribute("data-presence-audience")) return;
    if (!mine) mine = { id: selfId(), exact: true, preference: "online", seenPrivacy: "everyone", audience: "everyone", state: "offline", emoji: "", text: "" };
    mine.audience = el.value || "everyone";
    const form = el.closest(".presence-form");
    if (!form) return;
    const old = form.querySelector(".presence-lists");
    if (old) old.remove();
    if (el.value === "list" && window.AudienceLists && window.AudienceLists.checksHtml) {
      el.insertAdjacentHTML("afterend", '<div class="presence-lists">' + window.AudienceLists.checksHtml(mine.listIds || []) + "</div>");
    }
  });
  window.addEventListener("resize", placeSheet);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") close();
  });
  if (window.SI18n && window.SI18n.onChange) window.SI18n.onChange(function () { paint(); if (sheet && !sheet.hidden) fillSheet(); });
  if (visible()) {
    armHeart();
    beat(true);
    connect();
    call("/v1/presence").then(function (body) {
      if (!body || body.status !== 200) return;
      applyMine(body);
      paint();
    });
  }
}

const api = {
  wrap: wrap,
  linesHtml: linesHtml,
  dmSubHtml: dmSubHtml,
  settingsHtml: settingsHtml,
  refresh: refresh,
  open: open,
  close: close,
  mutesNotices: mutesNotices,
  chime: chime,
  dnd: mutesNotices,
  onChannel: onChannel,
  offChannel: offChannel,
  channelOpen: socketOpen
};
window.ViktorychPresence = api;

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
