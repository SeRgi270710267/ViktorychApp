/* Packages: a private package tracker. Numbers live in the account's own
   D1 rows (synced to every signed-in device); the Worker reads the carriers
   with server-side keys, polls with backoff and sends a note on each change. */

import { CARRIERS, STATUSES, carrierById, cleanNumber, detectCarriers, extractNumbers, trackingUrl } from "./shared/packages-carriers.js";

var CACHE_KEY = "viktorych.packages.v1";
var POLL_MS = 60000;

var state = { items: null, carriers: {}, error: "", busy: false, adding: false, draft: { number: "", name: "", carrier: "" }, found: [], timer: 0, root: null, route: null };

function tr(key, vars) { return window.t ? window.t(key, vars) : key; }
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}
function account() { return window.ViktorychAccounts && window.ViktorychAccounts.account ? window.ViktorychAccounts.account() : null; }
function apiRoot() {
  if (window.ViktorychAccounts && window.ViktorychAccounts.currentApi) { var cur = window.ViktorychAccounts.currentApi(); if (cur) return cur; }
  var cfg = window.VIKTORYCH_ACCOUNTS || {};
  return String(cfg.api || cfg.backupApi || "").replace(/\/$/, "");
}
function token() { var s = window.ViktorychAccounts && window.ViktorychAccounts.session ? window.ViktorychAccounts.session() : null; return s ? s.token : ""; }

async function api(path, opts) {
  var o = opts || {};
  var headers = { Authorization: "Bearer " + token() };
  if (o.body) headers["Content-Type"] = "application/json";
  var res = await fetch(apiRoot() + path, { method: o.method || "GET", headers: headers, body: o.body ? JSON.stringify(o.body) : undefined });
  var body = await res.json().catch(function () { return {}; });
  if (!res.ok) { var err = new Error(body.error || "request_failed"); err.status = res.status; throw err; }
  return body;
}

function statusLabel(status) {
  return {
    pending: tr("Label created"), in_transit: tr("In transit"), out_for_delivery: tr("Out for delivery"),
    ready_for_pickup: tr("Ready for pickup"), delivered: tr("Delivered"), problem: tr("Problem")
  }[status] || tr("Label created");
}
function errorLabel(code, p) {
  var c = p && carrierById(p.carrier);
  if (code === "no_api" && c && c.api) code = "no_key";
  if (code === "no_api") return tr("This carrier has no public tracking API. Open its page for updates.");
  if (code === "no_key") return tr("Live tracking for this carrier needs an API key on the server.");
  if (code === "not_found") return tr("The carrier does not know this number yet.");
  return code ? tr("The carrier could not be reached. We will try again.") : "";
}
function when(value) {
  var d = new Date(value);
  if (!value || isNaN(d)) return "";
  try { return d.toLocaleString((window.SI18n ? window.SI18n.locale() : undefined), { dateStyle: "medium", timeStyle: "short" }); }
  catch (err) { return d.toISOString().slice(0, 16).replace("T", " "); }
}
function day(value) {
  var d = new Date(value);
  if (!value || isNaN(d)) return "";
  try { return d.toLocaleDateString((window.SI18n ? window.SI18n.locale() : undefined), { weekday: "short", day: "numeric", month: "short" }); }
  catch (err) { return String(value).slice(0, 10); }
}

function readCache() {
  try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return c && Array.isArray(c.items) ? c.items : null; }
  catch (err) { return null; }
}
function writeCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items: state.items || [] })); } catch (err) { /* full */ }
}

function visible() { return !!account(); }

function routeTab(route) {
  var tab = route && route.tab || "active";
  return tab;
}

function page(route) { return '<div class="pk" data-bound="0"></div>'; }

function head(title, back) {
  return '<div class="topbar pk-top"><div class="page-head">' + (back ? '<a class="icon-btn pk-back" href="#/packages" aria-label="' + esc(tr("Back")) + '">&larr;</a>' : "") +
    '<div class="head-text grow"><h1>' + esc(title) + '</h1></div>' +
    (back ? "" : '<button class="pk-add-btn" data-pk="open-add">' + esc(tr("Add package")) + '</button>') + '</div></div>';
}

function pill(status) { return '<span class="pk-pill pk-' + esc(status || "pending") + '">' + esc(statusLabel(status)) + '</span>'; }

function card(p) {
  var c = carrierById(p.carrier);
  var last = (p.events || [])[0];
  return '<a class="pk-card" href="#/packages/' + esc(p.id) + '">' +
    '<div class="pk-card-top"><strong class="pk-name">' + esc(p.name || p.number) + '</strong>' + pill(p.status) + '</div>' +
    '<div class="pk-meta">' + esc(c ? c.name : p.carrier) + ' · <span class="pk-num">' + esc(p.number) + '</span></div>' +
    (p.eta && p.status !== "delivered" ? '<div class="pk-eta">' + esc(tr("Expected {date}", { date: day(p.eta) })) + '</div>' : "") +
    (last ? '<div class="pk-last">' + esc(last.text) + (last.place ? " · " + esc(last.place) : "") + '</div>' : (p.error ? '<div class="pk-last pk-muted">' + esc(errorLabel(p.error, p)) + '</div>' : "")) +
    '</a>';
}

function carrierOptions(selected, number) {
  var guesses = detectCarriers(number || "");
  var opts = '<option value="">' + esc(guesses.length ? tr("Detect automatically ({name})", { name: (carrierById(guesses[0]) || {}).name || guesses[0] }) : tr("Detect automatically")) + '</option>';
  var groups = { SE: tr("Sweden"), ES: tr("Spain"), RU: tr("Russia"), INT: tr("International") };
  Object.keys(groups).forEach(function (g) {
    var list = CARRIERS.filter(function (c) { return (c.country || "INT") === g; });
    if (!list.length) return;
    opts += '<optgroup label="' + esc(groups[g]) + '">' + list.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === selected ? " selected" : "") + '>' + esc(c.name) + '</option>';
    }).join("") + '</optgroup>';
  });
  return opts;
}

function addForm() {
  var d = state.draft;
  var found = state.found.length ? '<div class="pk-found"><span>' + esc(tr("Found in the text:")) + '</span>' + state.found.map(function (f) {
    return '<button class="pk-chip" data-pk="pick" data-n="' + esc(f.number) + '">' + esc(f.number) + '</button>';
  }).join("") + '</div>' : "";
  return '<form class="pk-form" data-pk="add-form">' +
    '<label>' + esc(tr("Tracking number")) + '<input name="number" autocomplete="off" autocapitalize="characters" maxlength="40" required value="' + esc(d.number) + '"></label>' +
    '<label>' + esc(tr("Name (optional)")) + '<input name="name" maxlength="80" value="' + esc(d.name) + '" placeholder="' + esc(tr("e.g. New shoes")) + '"></label>' +
    '<label>' + esc(tr("Carrier")) + '<select name="carrier">' + carrierOptions(d.carrier, d.number) + '</select></label>' +
    '<details class="pk-paste"><summary>' + esc(tr("Paste a shipping email or SMS")) + '</summary><textarea name="paste" rows="4" placeholder="' + esc(tr("Paste the message here and we will find the tracking number.")) + '"></textarea></details>' +
    found +
    '<div class="pk-form-row"><button type="button" class="pk-ghost" data-pk="close-add">' + esc(tr("Cancel")) + '</button><button type="submit" class="pk-primary"' + (state.busy ? " disabled" : "") + '>' + esc(tr("Track")) + '</button></div>' +
    '</form>';
}

function listView(tab) {
  var items = state.items || [];
  var archived = tab === "archived";
  var shown = items.filter(function (p) { return !!p.archived === archived; });
  var tabs = '<div class="tabs ptabs pk-tabs" role="tablist"><a class="tab' + (!archived ? " on" : "") + '" role="tab" href="#/packages"><span>' + esc(tr("Active")) + '</span></a><a class="tab' + (archived ? " on" : "") + '" role="tab" href="#/packages/archived"><span>' + esc(tr("Archived")) + '</span></a></div>';
  var body;
  if (state.items === null) body = '<div class="pk-empty">' + esc(tr("Loading…")) + '</div>';
  else if (!shown.length) body = '<div class="pk-empty"><h2>' + esc(archived ? tr("No archived packages") : tr("Track your packages")) + '</h2><p>' + esc(archived ? tr("Delivered packages move here after a week, or when you archive them.") : tr("Add a tracking number from PostNord, DHL, Correos, Почта России and more. You will get a note each time the status changes.")) + '</p></div>';
  else body = shown.map(card).join("");
  return head(tr("Packages")) + (state.adding ? addForm() : "") + (state.error ? '<div class="pk-error">' + esc(state.error) + '</div>' : "") + tabs + '<div class="pk-list">' + body + '</div>';
}

function osm(place) { return "https://www.openstreetmap.org/search?query=" + encodeURIComponent(place); }

function detailView(id) {
  var p = (state.items || []).find(function (x) { return x.id === id; });
  if (!p) return head(tr("Packages"), true) + '<div class="pk-empty">' + esc(state.items === null ? tr("Loading…") : tr("This package is not in your list.")) + '</div>';
  var c = carrierById(p.carrier);
  var url = p.url || trackingUrl(p.carrier, p.number);
  var events = (p.events || []).map(function (e, i) {
    return '<li class="pk-ev' + (i === 0 ? " on" : "") + '"><span class="pk-dot"></span><div><div class="pk-ev-text">' + esc(e.text) + '</div>' +
      '<div class="pk-ev-meta">' + esc(when(e.at)) + (e.place ? ' · <a href="' + esc(osm(e.place)) + '" target="_blank" rel="noopener">' + esc(e.place) + '</a>' : "") + '</div></div></li>';
  }).join("");
  var lastPlace = (p.events || []).map(function (e) { return e.place; }).filter(Boolean)[0];
  return head(p.name || p.number, true) +
    '<div class="pk-detail">' +
    '<div class="pk-hero">' + pill(p.status) + (p.status_text || p.statusText ? '<div class="pk-hero-text">' + esc(p.status_text || p.statusText) + '</div>' : "") +
    (p.eta && p.status !== "delivered" ? '<div class="pk-eta">' + esc(tr("Expected {date}", { date: day(p.eta) })) + '</div>' : "") +
    '<div class="pk-meta">' + esc(c ? c.name : p.carrier) + ' · <span class="pk-num">' + esc(p.number) + '</span></div>' +
    (p.error ? '<div class="pk-note">' + esc(errorLabel(p.error, p)) + '</div>' : "") +
    (lastPlace ? '<a class="pk-map" href="' + esc(osm(lastPlace)) + '" target="_blank" rel="noopener">' + esc(tr("Show {place} on the map", { place: lastPlace })) + '</a>' : "") +
    '</div>' +
    '<div class="pk-actions">' +
    '<button class="pk-ghost" data-pk="refresh" data-id="' + esc(p.id) + '"' + (state.busy ? " disabled" : "") + '>' + esc(tr("Refresh")) + '</button>' +
    (url ? '<a class="pk-ghost" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(tr("Carrier page")) + '</a>' : "") +
    '<button class="pk-ghost" data-pk="rename" data-id="' + esc(p.id) + '">' + esc(tr("Rename")) + '</button>' +
    '<button class="pk-ghost" data-pk="archive" data-id="' + esc(p.id) + '">' + esc(p.archived ? tr("Unarchive") : tr("Archive")) + '</button>' +
    '<button class="pk-ghost pk-danger" data-pk="delete" data-id="' + esc(p.id) + '">' + esc(tr("Delete")) + '</button>' +
    '</div>' +
    (state.error ? '<div class="pk-error">' + esc(state.error) + '</div>' : "") +
    (events ? '<ol class="pk-timeline">' + events + '</ol>' : '<div class="pk-empty"><p>' + esc(tr("No tracking events yet.")) + '</p></div>') +
    (p.checked_at || p.checkedAt ? '<div class="pk-foot">' + esc(tr("Checked {time}", { time: when(p.checked_at || p.checkedAt) })) + '</div>' : "") +
    '</div>';
}

function render() {
  var root = state.root;
  if (!root || !root.isConnected) return;
  var r = state.route || {};
  var tab = routeTab(r);
  var focus = document.activeElement && root.contains(document.activeElement) ? document.activeElement.name : "";
  root.innerHTML = tab && tab !== "active" && tab !== "archived" ? detailView(tab) : listView(tab);
  if (focus) { var el = root.querySelector('[name="' + focus + '"]'); if (el) el.focus(); }
}

function upsert(p) {
  var items = (state.items || []).filter(function (x) { return x.id !== p.id; });
  items.unshift(p);
  state.items = items;
  writeCache();
}

async function load() {
  if (!visible()) return;
  try {
    var got = await api("/v1/packages");
    state.items = got.packages || [];
    state.error = "";
    writeCache();
  } catch (err) {
    if (state.items === null) state.items = readCache() || [];
    if (err.status !== 401) state.error = tr("Offline. Showing the last saved list.");
  }
  render();
}

async function act(name, el) {
  var id = el && el.dataset.id;
  state.error = "";
  try {
    if (name === "open-add") { state.adding = true; render(); var n = state.root.querySelector('[name="number"]'); if (n) n.focus(); return; }
    if (name === "close-add") { state.adding = false; state.found = []; state.draft = { number: "", name: "", carrier: "" }; render(); return; }
    if (name === "pick") { state.draft.number = el.dataset.n; state.found = []; render(); return; }
    if (name === "refresh") { state.busy = true; render(); upsert((await api("/v1/packages/" + id + "/refresh", { method: "POST" })).package); }
    if (name === "archive") {
      var cur = (state.items || []).find(function (x) { return x.id === id; });
      upsert((await api("/v1/packages/" + id, { method: "PATCH", body: { archived: !(cur && cur.archived) } })).package);
    }
    if (name === "rename") {
      var p = (state.items || []).find(function (x) { return x.id === id; });
      var next = window.prompt(tr("Package name"), p ? p.name || "" : "");
      if (next == null) return;
      upsert((await api("/v1/packages/" + id, { method: "PATCH", body: { name: next } })).package);
    }
    if (name === "delete") {
      if (!window.confirm(tr("Delete this package from your list?"))) return;
      await api("/v1/packages/" + id, { method: "DELETE" });
      state.items = (state.items || []).filter(function (x) { return x.id !== id; });
      writeCache();
      location.hash = "#/packages";
    }
  } catch (err) {
    state.error = err.status === 429 ? tr("Checked a moment ago. Try again in a minute.") : tr("Something went wrong. Try again.");
  }
  state.busy = false;
  render();
}

async function submit(form) {
  var number = cleanNumber(form.number.value);
  if (number.length < 6) { state.error = tr("Enter a tracking number."); render(); return; }
  state.busy = true; state.error = ""; render();
  try {
    var got = await api("/v1/packages", { method: "POST", body: { number: number, name: form.name.value.trim(), carrier: form.carrier.value || undefined } });
    upsert(got.package);
    state.adding = false; state.found = []; state.draft = { number: "", name: "", carrier: "" };
    location.hash = "#/packages/" + got.package.id;
  } catch (err) {
    state.error = err.message === "too_many" ? tr("You can track up to 100 packages.") : err.message === "unknown_carrier" || err.status === 400 ? tr("We could not recognize this tracking number. Pick the carrier.") : tr("Something went wrong. Try again.");
  }
  state.busy = false;
  render();
}

function bind(root) {
  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-pk]");
    if (!el || el.tagName === "FORM") return;
    e.preventDefault();
    act(el.dataset.pk, el);
  });
  root.addEventListener("submit", function (e) {
    var form = e.target.closest('[data-pk="add-form"]');
    if (!form) return;
    e.preventDefault();
    submit(form);
  });
  root.addEventListener("input", function (e) {
    var t = e.target;
    if (t.name === "number" || t.name === "name") state.draft[t.name] = t.value;
    if (t.name === "number") {
      var sel = root.querySelector('[name="carrier"]');
      if (sel) sel.innerHTML = carrierOptions(state.draft.carrier, t.value);
    }
    if (t.name === "carrier") state.draft.carrier = t.value;
    if (t.name === "paste") {
      state.found = extractNumbers(t.value);
      if (state.found.length === 1 && !state.draft.number) { state.draft.number = state.found[0].number; state.found = []; }
      var keep = t.value;
      render();
      var area = root.querySelector('[name="paste"]');
      if (area) { area.value = keep; area.closest("details").open = true; }
    }
  });
  root.addEventListener("change", function (e) { if (e.target.name === "carrier") state.draft.carrier = e.target.value; });
}

function tick() { if (document.visibilityState === "visible" && state.root && state.root.isConnected) load(); }

function mount(route) {
  state.route = route;
  var root = document.querySelector(".pk");
  if (!root) return;
  if (root.dataset.bound !== "1") {
    root.dataset.bound = "1";
    state.root = root;
    bind(root);
    if (state.items === null) state.items = readCache();
  }
  render();
  load();
  if (!state.timer) state.timer = setInterval(tick, POLL_MS);
}

function unmount() {
  if (state.timer) { clearInterval(state.timer); state.timer = 0; }
  state.root = null;
}

window.ViktorychPackages = { visible: visible, page: page, mount: mount, unmount: unmount, statuses: STATUSES };
