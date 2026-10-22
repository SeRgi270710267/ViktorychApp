/* Owner Drive. Encryption stays in this browser. The Worker only sees
   wrapped keys and ciphertext. A localhost preview hash paints sample
   cards for screenshots and does not talk to the Worker. */
import {
  DRIVE_CHUNK,
  DRIVE_ITERATIONS,
  DRIVE_MAX_FILE,
  DRIVE_PACE_MS,
  bytesToB64,
  b64ToBytes,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  newItemKey,
  openItemKey,
  setupVault,
  unlockVault,
  verifyMaster
} from "./shared/drive-crypto.js";

var master = null;
var lastTg = 0;
var preview = false;
var state = {
  mode: "loading",
  items: [],
  stored: 0,
  vault: null,
  query: "",
  view: "grid",
  dialog: null,
  menu: "",
  error: "",
  transfer: null,
  preview: null,
  busy: false,
  route: { trash: false, folder: "" }
};

try {
  var savedView = localStorage.getItem("viktorych-drive-layout");
  if (savedView === "list" || savedView === "grid") state.view = savedView;
} catch (err) { /* the default grid stays */ }

function tr(key, vars) {
  return window.t ? window.t(key, vars) : key;
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
function account() {
  return window.ViktorychAccounts && window.ViktorychAccounts.account ? window.ViktorychAccounts.account() : null;
}
function previewOn() {
  if (preview) return true;
  var host = location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  if (/(?:^|[?&#])preview=1(?:&|$)/.test(location.hash || "")) preview = true;
  return preview;
}
function visible() {
  if (previewOn()) return true;
  var row = account();
  return !!(row && (row.owner === true || row.owner === 1));
}
function apiRoot() {
  var cfg = window.VIKTORYCH_ACCOUNTS || {};
  return String(cfg.api || "").replace(/\/$/, "");
}
function token() {
  return window.ViktorychAccounts && window.ViktorychAccounts.token ? window.ViktorychAccounts.token() : "";
}
var paintQueued = false;
function paint() {
  if (paintQueued) return;
  paintQueued = true;
  setTimeout(function () {
    paintQueued = false;
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }, 0);
}
function svg(path) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
}
var ICO = {
  folder: "M4 6.5C4 5.12 5.12 4 6.5 4h3.2l1.6 2H17.5C18.88 6 20 7.12 20 8.5v9c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11z",
  file: "M7 3.5C7 2.67 7.67 2 8.5 2h5.3L18 6.2V20.5c0 .83-.67 1.5-1.5 1.5h-8c-.83 0-1.5-.67-1.5-1.5v-17zM13 3.5V7h3.5L13 3.5z",
  grid: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  rows: "M4 5h16v3H4V5zm0 5.5h16v3H4v-3zM4 16h16v3H4v-3z",
  more: "M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z",
  search: "M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5 6.5-2.91 6.5-6.5-2.91-6.5-6.5-6.5zm0 11c-2.48 0-4.5-2.02-4.5-4.5s2.02-4.5 4.5-4.5 4.5 2.02 4.5 4.5-2.02 4.5-4.5 4.5zM16.2 15.3l4.2 4.2-1.4 1.4-4.2-4.2 1.4-1.4z",
  lock: "M8 10V7.5a4 4 0 0 1 8 0V10h1.5A1.5 1.5 0 0 1 19 11.5v8A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H8zm2 0h4V7.5a2 2 0 0 0-4 0V10z"
};

function formatSize(n) {
  var units = ["B", "KB", "MB", "GB"];
  var i = 0;
  var v = Number(n) || 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  var text = (v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10) + " " + units[i];
  return text;
}
function kindOf(meta) {
  var mime = String((meta && meta.mime) || "");
  if (mime.indexOf("image/") === 0) return "image";
  if (mime.indexOf("video/") === 0) return "video";
  if (mime.indexOf("audio/") === 0) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "";
}
function partCount(size) {
  var n = Math.ceil((Number(size) || 0) / DRIVE_CHUNK);
  return n > 0 ? n : 1;
}
function byId(id) {
  for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
  return null;
}
function trashRoot(item) {
  if (!item.parentId) return true;
  var parent = byId(item.parentId);
  return !parent || !parent.deletedAt;
}
function crumbs() {
  var folder = (state.route && state.route.folder) || "";
  var chain = [];
  var guard = 0;
  while (folder && guard < 40) {
    var row = byId(folder);
    if (!row) break;
    chain.unshift(row);
    folder = row.parentId || "";
    guard += 1;
  }
  return chain;
}
function visibleItems() {
  var q = state.query.trim().toLowerCase();
  var trash = !!(state.route && state.route.trash);
  var folder = (state.route && state.route.folder) || "";
  var rows = state.items.filter(function (item) {
    var deleted = Number(item.deletedAt) > 0;
    if (trash !== deleted) return false;
    if (q) return String(item.meta && item.meta.name || "").toLowerCase().indexOf(q) >= 0;
    if (trash) return trashRoot(item);
    return (item.parentId || "") === folder;
  });
  rows.sort(function (a, b) {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return String(a.meta.name || "").localeCompare(String(b.meta.name || ""));
  });
  return rows;
}
function title() {
  if (state.route && state.route.trash) return tr("Trash");
  var chain = crumbs();
  if (chain.length) return chain[chain.length - 1].meta.name || tr("Folder");
  return tr("Drive");
}
function backHref() {
  if (state.route && state.route.trash) return "#/drive";
  var chain = crumbs();
  if (!chain.length) return "";
  if (chain.length === 1) return "#/drive";
  return "#/drive/folder/" + encodeURIComponent(chain[chain.length - 2].id);
}

function idb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open("viktorych-drive", 1);
    req.onupgradeneeded = function () { req.result.createObjectStore("keys"); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
async function rememberKey(key) {
  var db = await idb();
  await new Promise(function (resolve, reject) {
    var tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(key, "master");
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
  db.close();
}
async function loadKey() {
  try {
    var db = await idb();
    var key = await new Promise(function (resolve, reject) {
      var tx = db.transaction("keys", "readonly");
      var req = tx.objectStore("keys").get("master");
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
    db.close();
    return key;
  } catch (err) {
    return null;
  }
}
async function forgetKey() {
  try {
    var db = await idb();
    await new Promise(function (resolve, reject) {
      var tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").delete("master");
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
    db.close();
  } catch (err) { /* already locked */ }
}

async function apiJson(path, opts) {
  opts = opts || {};
  var headers = { Authorization: "Bearer " + token() };
  if (opts.body) headers["content-type"] = "application/json";
  var res = await fetch(apiRoot() + path, {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "omit",
    cache: "no-store"
  });
  var body = await res.json().catch(function () { return {}; });
  body = body || {};
  body.status = res.status;
  return body;
}
async function pace() {
  var wait = lastTg ? DRIVE_PACE_MS - (Date.now() - lastTg) : 0;
  if (wait > 0) await sleep(wait);
  lastTg = Date.now();
}
async function putChunk(id, index, iv, bytes, attempt) {
  await pace();
  var res;
  try {
    res = await fetch(apiRoot() + "/v1/drive/items/" + encodeURIComponent(id) + "/chunks", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token(),
        "x-drive-part": String(index),
        "x-drive-iv": iv
      },
      body: bytes,
      credentials: "omit",
      cache: "no-store"
    });
  } catch (err) {
    if ((attempt || 0) < 4) return putChunk(id, index, iv, bytes, (attempt || 0) + 1);
    throw err;
  }
  if ((res.status === 429 || res.status >= 500) && (attempt || 0) < 4) {
    var retry = Number(res.headers.get("retry-after") || 0);
    await sleep(retry > 0 ? retry * 1000 : DRIVE_PACE_MS * ((attempt || 0) + 1));
    return putChunk(id, index, iv, bytes, (attempt || 0) + 1);
  }
  var body = await res.json().catch(function () { return {}; });
  if (res.status !== 200 && res.status !== 201) throw new Error("upload");
  return body;
}
async function getChunk(id, index, attempt) {
  await pace();
  var res;
  try {
    res = await fetch(apiRoot() + "/v1/drive/items/" + encodeURIComponent(id) + "/chunks/" + index, {
      headers: { Authorization: "Bearer " + token() },
      credentials: "omit",
      cache: "no-store"
    });
  } catch (err) {
    if ((attempt || 0) < 4) return getChunk(id, index, (attempt || 0) + 1);
    throw err;
  }
  if ((res.status === 429 || res.status >= 500) && (attempt || 0) < 4) {
    await sleep(DRIVE_PACE_MS * ((attempt || 0) + 1));
    return getChunk(id, index, (attempt || 0) + 1);
  }
  if (!res.ok) throw new Error("download");
  return new Uint8Array(await res.arrayBuffer());
}

function revokeThumbs() {
  state.items.forEach(function (item) {
    if (item.thumbUrl && item.thumbUrl.indexOf("blob:") === 0) URL.revokeObjectURL(item.thumbUrl);
  });
}
async function openRow(row) {
  var key = await openItemKey(master, row.wrappedKey, row.wrapIv);
  var meta = await decryptJson(key, row.metaIv, row.meta);
  var thumbUrl = "";
  if (row.thumb && row.thumbIv) {
    try {
      var bytes = await decryptBytes(key, b64ToBytes(row.thumbIv), b64ToBytes(row.thumb));
      thumbUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    } catch (err) { thumbUrl = ""; }
  }
  return {
    id: row.id,
    parentId: row.parentId || "",
    kind: row.kind,
    meta: meta,
    chunks: row.chunks || [],
    deletedAt: row.deletedAt || 0,
    key: key,
    thumbUrl: thumbUrl
  };
}
async function loadItems() {
  var live = await apiJson("/v1/drive/items");
  var trash = await apiJson("/v1/drive/items?trash=1");
  var info = await apiJson("/v1/drive");
  if (live.status === 401 || live.status === 403 || live.status === 404) {
    location.hash = "#/";
    return false;
  }
  revokeThumbs();
  var rows = (live.items || []).concat(trash.items || []);
  var opened = [];
  for (var i = 0; i < rows.length; i++) {
    try { opened.push(await openRow(rows[i])); }
    catch (err) { /* a row that does not open stays hidden */ }
  }
  state.items = opened;
  state.stored = Number(info.stored) || 0;
  return true;
}
function sampleThumb() {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#1d3a5f"/><circle cx="250" cy="54" r="22" fill="#f5d76e"/><path d="M0 150 L90 88 L150 128 L210 72 L320 156 V200 H0Z" fill="#3d7a5a"/></svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
function previewItems() {
  var thumb = sampleThumb();
  return [
    { id: "previewfolder0001", parentId: "", kind: "folder", meta: { name: "Maps", mime: "folder", size: 0, created: 1 }, chunks: [], deletedAt: 0, thumbUrl: "" },
    { id: "previewfile000001", parentId: "", kind: "file", meta: { name: "Shore.jpg", mime: "image/jpeg", size: 2400000, created: 2 }, chunks: [{ index: 0, size: 1, iv: "" }], deletedAt: 0, thumbUrl: thumb },
    { id: "previewfile000002", parentId: "", kind: "file", meta: { name: "Brief.pdf", mime: "application/pdf", size: 840000, created: 3 }, chunks: [{ index: 0, size: 1, iv: "" }], deletedAt: 0, thumbUrl: "" },
    { id: "previewfile000003", parentId: "", kind: "file", meta: { name: "Clip.mp4", mime: "video/mp4", size: 18000000, created: 4 }, chunks: [{ index: 0, size: 1, iv: "" }], deletedAt: 0, thumbUrl: "" },
    { id: "previewfile000004", parentId: "", kind: "file", meta: { name: "Voice.m4a", mime: "audio/mp4", size: 1600000, created: 5 }, chunks: [{ index: 0, size: 1, iv: "" }], deletedAt: 0, thumbUrl: "" },
    { id: "previewfile000005", parentId: "", kind: "file", meta: { name: "Notes.txt", mime: "text/plain", size: 4096, created: 6 }, chunks: [{ index: 0, size: 1, iv: "" }], deletedAt: 0, thumbUrl: "" }
  ];
}
async function boot() {
  if (state.booted) return;
  state.booted = true;
  if (previewOn()) {
    state.mode = "ready";
    state.vault = { kdf: "pbkdf2-sha256" };
    state.items = previewItems();
    state.stored = 134217728;
    paint();
    return;
  }
  if (!apiRoot() || !token()) {
    state.mode = "offline";
    paint();
    return;
  }
  var info = await apiJson("/v1/drive");
  if (info.status === 401 || info.status === 403 || info.status === 404) {
    location.hash = "#/";
    return;
  }
  state.vault = info.vault;
  state.stored = Number(info.stored) || 0;
  if (!info.vault) {
    state.mode = "setup";
    paint();
    return;
  }
  var saved = await loadKey();
  if (saved && await verifyMaster(saved, info.vault.verifier, info.vault.verifierIv)) {
    master = saved;
    state.mode = "ready";
    if (await loadItems()) paint();
    return;
  }
  await forgetKey();
  state.mode = "locked";
  paint();
}

async function thumbOf(file) {
  if (!file.type || file.type.indexOf("image/") !== 0 || !window.createImageBitmap) return null;
  try {
    var bmp = await createImageBitmap(file);
    var scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (bmp.close) bmp.close();
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", 0.72); });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch (err) {
    return null;
  }
}
async function encryptSlice(key, file, index) {
  var start = index * DRIVE_CHUNK;
  var blob = file.slice(start, Math.min(file.size, start + DRIVE_CHUNK));
  var plain = new Uint8Array(await blob.arrayBuffer());
  var packed = await encryptBytes(key, plain);
  return { iv: bytesToB64(packed.iv), ciphertext: packed.ciphertext };
}
function findResume(file, parentId) {
  var need = partCount(file.size);
  for (var i = 0; i < state.items.length; i++) {
    var item = state.items[i];
    if (item.kind !== "file" || item.deletedAt) continue;
    if ((item.parentId || "") !== (parentId || "")) continue;
    if (!item.meta || item.meta.name !== file.name || Number(item.meta.size) !== file.size) continue;
    if ((item.chunks || []).length < need && item.key) return item;
  }
  return null;
}
async function uploadOne(file) {
  if (file.size > DRIVE_MAX_FILE) {
    state.error = tr("That file is too large.");
    return;
  }
  var parentId = (state.route && state.route.folder) || "";
  var need = partCount(file.size);
  var existing = findResume(file, parentId);
  var id = existing && existing.id;
  var key = existing && existing.key;
  var have = {};
  if (!existing) {
    var made = await newItemKey(master);
    key = made.key;
    var meta = await encryptJson(key, {
      name: file.name || tr("File"),
      mime: file.type || "application/octet-stream",
      size: file.size,
      created: Date.now()
    });
    var thumb = await thumbOf(file);
    var body = {
      kind: "file",
      parentId: parentId,
      wrappedKey: made.wrappedKey,
      wrapIv: made.wrapIv,
      meta: meta.ciphertext,
      metaIv: meta.iv
    };
    if (thumb) {
      var sealed = await encryptBytes(key, thumb);
      var b64 = bytesToB64(sealed.ciphertext);
      if (b64.length <= 60000) {
        body.thumb = b64;
        body.thumbIv = bytesToB64(sealed.iv);
      }
    }
    var created = await apiJson("/v1/drive/items", { method: "POST", body: body });
    if (created.status !== 201 || !created.id) throw new Error("upload");
    id = created.id;
  } else {
    (existing.chunks || []).forEach(function (part) { have[part.index] = true; });
  }
  var done = Object.keys(have).length;
  for (var n = 0; n < need; n++) {
    if (have[n]) continue;
    state.transfer = { name: file.name, done: done, total: need, kind: "upload" };
    paint();
    var packed = await encryptSlice(key, file, n);
    await putChunk(id, n, packed.iv, packed.ciphertext, 0);
    done += 1;
    state.transfer = { name: file.name, done: done, total: need, kind: "upload" };
    paint();
  }
}
async function uploadFiles(list) {
  if (state.busy || state.mode !== "ready" || previewOn()) return;
  var files = Array.prototype.slice.call(list || []);
  if (!files.length) return;
  state.busy = true;
  state.error = "";
  try {
    for (var i = 0; i < files.length; i++) await uploadOne(files[i]);
    state.transfer = null;
    await loadItems();
  } catch (err) {
    state.transfer = null;
    state.error = tr("Could not upload.");
    try { await loadItems(); } catch (again) { /* keep the error */ }
  }
  state.busy = false;
  paint();
}
async function readPlain(item) {
  var parts = (item.chunks || []).slice().sort(function (a, b) { return a.index - b.index; });
  var out = [];
  var total = 0;
  for (var i = 0; i < parts.length; i++) {
    state.transfer = { name: item.meta.name, done: i, total: parts.length, kind: "download" };
    paint();
    var cipher = await getChunk(item.id, parts[i].index, 0);
    var plain = await decryptBytes(item.key, b64ToBytes(parts[i].iv), cipher);
    out.push(plain);
    total += plain.length;
  }
  var bytes = new Uint8Array(total);
  var at = 0;
  out.forEach(function (part) {
    bytes.set(part, at);
    at += part.length;
  });
  state.transfer = null;
  return bytes;
}
function safeName(name) {
  var text = String(name || "file").replace(/[\\/]/g, " ").replace(/^\.+/, "").trim().slice(0, 180);
  return text || "file";
}
function saveBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = safeName(name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
async function downloadItem(item, previewOnly) {
  if (!item || item.kind !== "file" || state.busy) return;
  if (previewOn()) return;
  state.busy = true;
  state.error = "";
  try {
    var bytes = await readPlain(item);
    var type = item.meta.mime || "application/octet-stream";
    var blob = new Blob([bytes], { type: type });
    var view = kindOf(item.meta);
    if (previewOnly && view) {
      if (state.preview && state.preview.url) URL.revokeObjectURL(state.preview.url);
      state.preview = { url: URL.createObjectURL(blob), mime: type, name: item.meta.name, kind: view, id: item.id };
    } else saveBlob(blob, item.meta.name);
  } catch (err) {
    state.error = previewOnly ? tr("Could not open that file.") : tr("Could not download.");
  }
  state.transfer = null;
  state.busy = false;
  paint();
}
async function createFolder(name) {
  var made = await newItemKey(master);
  var meta = await encryptJson(made.key, { name: name, mime: "folder", size: 0, created: Date.now() });
  var created = await apiJson("/v1/drive/items", {
    method: "POST",
    body: {
      kind: "folder",
      parentId: (state.route && state.route.folder) || "",
      wrappedKey: made.wrappedKey,
      wrapIv: made.wrapIv,
      meta: meta.ciphertext,
      metaIv: meta.iv
    }
  });
  if (created.status !== 201) throw new Error("upload");
}
async function renameItem(item, name) {
  var meta = Object.assign({}, item.meta, { name: name });
  var packed = await encryptJson(item.key, meta);
  var res = await apiJson("/v1/drive/items/" + encodeURIComponent(item.id), {
    method: "PATCH",
    body: { meta: packed.ciphertext, metaIv: packed.iv }
  });
  if (res.status !== 200) throw new Error("upload");
}
async function moveItem(item, parentId) {
  var res = await apiJson("/v1/drive/items/" + encodeURIComponent(item.id), {
    method: "PATCH",
    body: { parentId: parentId || "" }
  });
  if (res.status !== 200) throw new Error("upload");
}
async function removeItem(item, forever) {
  var path = "/v1/drive/items/" + encodeURIComponent(item.id) + (forever ? "?forever=1" : "");
  var res = await apiJson(path, { method: "DELETE" });
  if (res.status !== 200) throw new Error("upload");
}
async function restoreItem(item) {
  var res = await apiJson("/v1/drive/items/" + encodeURIComponent(item.id), {
    method: "PATCH",
    body: { restore: true }
  });
  if (res.status !== 200) throw new Error("upload");
}
async function afterChange() {
  state.dialog = null;
  state.menu = "";
  await loadItems();
  state.busy = false;
  paint();
}
async function runChange(work) {
  if (state.busy || previewOn()) return;
  state.busy = true;
  state.error = "";
  paint();
  try {
    await work();
    await afterChange();
  } catch (err) {
    state.busy = false;
    state.error = tr("Something went wrong. Try again.");
    paint();
  }
}

function warnBlock() {
  return '<p class="drive-warn">' + esc(tr("A forgotten passphrase means these files cannot be recovered.")) + '</p><p class="drive-note">' + esc(tr("The passphrase never leaves this device.")) + "</p>";
}
function lockHtml() {
  var setup = state.mode === "setup";
  return '<div class="drive-lock"><h2>' + esc(setup ? tr("Set a Drive passphrase") : tr("Drive is locked.")) + "</h2>" + warnBlock() +
    (state.error ? '<p class="drive-error">' + esc(state.error) + "</p>" : "") +
    '<form data-drive-form="unlock"><label class="field"><span>' + esc(tr("Passphrase")) + '</span><input id="drive-pass" type="password" autocomplete="' + (setup ? "new-password" : "current-password") + '"></label>' +
    (setup ? '<label class="field"><span>' + esc(tr("Confirm passphrase")) + '</span><input id="drive-pass2" type="password" autocomplete="new-password"></label>' : "") +
    '<label class="drive-check"><input id="drive-remember" type="checkbox"> <span>' + esc(tr("Remember the unlocked key on this device")) + "</span></label>" +
    '<button class="save" type="submit"' + (state.busy ? " disabled" : "") + ">" + esc(setup ? tr("Create Drive") : tr("Unlock Drive")) + "</button></form></div>";
}
function itemFace(item) {
  if (item.thumbUrl) return '<span class="drive-thumb"><img alt="" src="' + esc(item.thumbUrl) + '"></span>';
  return '<span class="drive-thumb">' + svg(item.kind === "folder" ? ICO.folder : ICO.file) + "</span>";
}
function itemMeta(item) {
  var need = partCount(item.meta && item.meta.size);
  if (item.kind === "file" && (item.chunks || []).length < need) return esc(tr("Upload did not finish."));
  if (item.kind === "folder") return esc(tr("Folder"));
  return esc(formatSize(item.meta && item.meta.size));
}
function itemOpen(item) {
  var name = esc(item.meta && item.meta.name || tr("File"));
  var inner = itemFace(item) + '<span class="drive-copy"><span class="drive-name">' + name + '</span><span class="drive-meta">' + itemMeta(item) + "</span></span>";
  if (item.kind === "folder" && !(state.route && state.route.trash)) {
    return '<a class="drive-open" href="#/drive/folder/' + encodeURIComponent(item.id) + '" data-act="stop">' + inner + "</a>";
  }
  return '<button class="drive-open" type="button" data-act="stop" data-drive="open" data-id="' + esc(item.id) + '">' + inner + "</button>";
}
function itemCard(item) {
  var more = '<button class="icon-btn drive-more" type="button" data-act="stop" data-drive="menu" data-id="' + esc(item.id) + '" aria-label="' + esc(tr("More")) + '">' + svg(ICO.more) + "</button>";
  if (state.view === "list") return '<div class="drive-row" data-drive-name="' + esc(item.meta.name || "") + '">' + itemOpen(item) + more + "</div>";
  return '<div class="drive-card" data-drive-name="' + esc(item.meta.name || "") + '">' + itemOpen(item) + more + "</div>";
}
function folderChoices(item) {
  var blocked = {};
  var stack = [item.id];
  while (stack.length) {
    var current = stack.pop();
    if (blocked[current]) continue;
    blocked[current] = true;
    state.items.forEach(function (row) {
      if (row.parentId === current) stack.push(row.id);
    });
  }
  var rows = state.items.filter(function (row) {
    return row.kind === "folder" && !row.deletedAt && !blocked[row.id];
  });
  var html = '<button class="drive-choice" type="button" data-act="stop" data-drive="move-to" data-id="' + esc(item.id) + '" data-parent="">' + esc(tr("My Drive")) + "</button>";
  rows.forEach(function (row) {
    html += '<button class="drive-choice" type="button" data-act="stop" data-drive="move-to" data-id="' + esc(item.id) + '" data-parent="' + esc(row.id) + '">' + esc(row.meta.name || tr("Folder")) + "</button>";
  });
  return html;
}
function menuHtml() {
  var item = state.menu ? byId(state.menu) : null;
  if (!item) return "";
  var trash = !!(state.route && state.route.trash);
  var rows = "";
  if (trash) {
    rows = '<button class="drive-choice" type="button" data-act="stop" data-drive="restore" data-id="' + esc(item.id) + '">' + esc(tr("Restore")) + "</button>" +
      '<button class="drive-danger" type="button" data-act="stop" data-drive="ask-forever" data-id="' + esc(item.id) + '">' + esc(tr("Delete forever")) + "</button>";
  } else {
    if (item.kind === "file") {
      rows += '<button class="drive-choice" type="button" data-act="stop" data-drive="open" data-id="' + esc(item.id) + '">' + esc(tr("Open")) + "</button>";
      rows += '<button class="drive-choice" type="button" data-act="stop" data-drive="download" data-id="' + esc(item.id) + '">' + esc(tr("Download")) + "</button>";
    }
    rows += '<button class="drive-choice" type="button" data-act="stop" data-drive="ask-rename" data-id="' + esc(item.id) + '">' + esc(tr("Rename")) + "</button>";
    rows += '<button class="drive-choice" type="button" data-act="stop" data-drive="ask-move" data-id="' + esc(item.id) + '">' + esc(tr("Move")) + "</button>";
    rows += '<button class="drive-danger" type="button" data-act="stop" data-drive="ask-delete" data-id="' + esc(item.id) + '">' + esc(tr("Delete")) + "</button>";
  }
  return '<div class="drive-modal" data-drive="dismiss"><div class="drive-panel" data-act="stop"><div class="modal-head"><h2>' + esc(item.meta.name || tr("File")) + '</h2><button class="icon-btn" type="button" data-act="stop" data-drive="dismiss" aria-label="' + esc(tr("Close")) + '">' + svg(ICO.more) + '</button></div><div class="modal-body">' + rows + "</div></div></div>";
}
function dialogHtml() {
  if (state.preview) {
    var media = "";
    if (state.preview.kind === "image") media = '<img class="drive-preview" alt="" src="' + esc(state.preview.url) + '">';
    else if (state.preview.kind === "video") media = '<video class="drive-preview" controls src="' + esc(state.preview.url) + '"></video>';
    else if (state.preview.kind === "audio") media = '<audio class="drive-preview-audio" controls src="' + esc(state.preview.url) + '"></audio>';
    else media = '<iframe class="drive-preview" title="' + esc(tr("Preview")) + '" src="' + esc(state.preview.url) + '"></iframe>';
    return '<div class="drive-modal" data-drive="close-preview"><div class="drive-panel" data-act="stop" role="dialog" aria-label="' + esc(tr("Preview")) + '"><div class="modal-head"><h2>' + esc(state.preview.name || tr("Preview")) + '</h2><button class="icon-btn" type="button" data-act="stop" data-drive="close-preview" aria-label="' + esc(tr("Close")) + '">' + svg("M10.59 12 4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z") + '</button></div><div class="modal-body">' + media + '<button class="save" type="button" data-act="stop" data-drive="download" data-id="' + esc(state.preview.id) + '">' + esc(tr("Download")) + "</button></div></div></div>";
  }
  var d = state.dialog;
  if (!d) return menuHtml();
  var item = d.id ? byId(d.id) : null;
  if (d.type === "folder" || d.type === "rename") {
    var value = d.type === "rename" && item ? item.meta.name : "";
    return '<div class="drive-modal"><div class="drive-panel" data-act="stop" role="dialog"><div class="modal-head"><h2>' + esc(d.type === "folder" ? tr("New folder") : tr("Rename")) + '</h2></div><form class="modal-body" data-drive-form="' + d.type + '"><label class="field"><span>' + esc(tr("Name")) + '</span><input id="drive-name" value="' + esc(value) + '" maxlength="180"></label><button class="save" type="submit">' + esc(tr("Save")) + '</button><button class="outline" type="button" data-act="stop" data-drive="dismiss">' + esc(tr("Cancel")) + "</button></form></div></div>";
  }
  if (d.type === "move" && item) {
    return '<div class="drive-modal"><div class="drive-panel" data-act="stop" role="dialog"><div class="modal-head"><h2>' + esc(tr("Move to folder")) + '</h2></div><div class="modal-body">' + folderChoices(item) + '<button class="outline" type="button" data-act="stop" data-drive="dismiss">' + esc(tr("Cancel")) + "</button></div></div></div>";
  }
  if ((d.type === "delete" || d.type === "forever") && item) {
    return '<div class="drive-modal"><div class="drive-panel" data-act="stop" role="dialog"><div class="modal-head"><h2>' + esc(item.meta.name || tr("File")) + '</h2></div><div class="modal-body"><p class="drive-note">' + esc(d.type === "forever" ? tr("Delete forever?") : tr("Files stay in the trash for 30 days.")) + '</p><button class="drive-danger" type="button" data-act="stop" data-drive="' + (d.type === "forever" ? "forever" : "delete") + '" data-id="' + esc(item.id) + '">' + esc(d.type === "forever" ? tr("Delete forever") : tr("Delete")) + '</button><button class="outline" type="button" data-act="stop" data-drive="dismiss">' + esc(tr("Cancel")) + "</button></div></div></div>";
  }
  return "";
}
function readyHtml() {
  var rows = visibleItems();
  var empty = state.route && state.route.trash ? tr("The trash is empty.") : (state.query.trim() ? tr("No matching files.") : tr("This folder is empty."));
  var body = rows.length ? '<div class="' + (state.view === "list" ? "drive-list" : "drive-grid") + '">' + rows.map(itemCard).join("") + "</div>" : '<div class="drive-empty"><h2>' + esc(empty) + "</h2></div>";
  var transfer = "";
  if (state.transfer) {
    var pct = state.transfer.total ? Math.max(4, Math.round(100 * state.transfer.done / state.transfer.total)) : 4;
    var label = state.transfer.kind === "download" ? tr("Downloading {name}", { name: state.transfer.name }) : tr("Uploading {name}", { name: state.transfer.name });
    transfer = '<div class="drive-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><p>' + esc(label) + '</p><div class="drive-progress-bar"><i style="width:' + pct + '%"></i></div></div>';
  }
  return warnBlock() +
    '<div class="drive-bar"><button class="save" type="button" data-act="stop" data-drive="pick"' + (state.busy ? " disabled" : "") + ">" + esc(tr("Upload files")) + '</button><button class="outline" type="button" data-act="stop" data-drive="ask-folder"' + (state.busy ? " disabled" : "") + ">" + esc(tr("New folder")) + '</button><label class="drive-search">' + svg(ICO.search) + '<input id="drive-q" type="search" value="' + esc(state.query) + '" placeholder="' + esc(tr("Search by name")) + '" aria-label="' + esc(tr("Search by name")) + '"></label><div class="drive-views"><button class="icon-btn' + (state.view === "grid" ? " on" : "") + '" type="button" data-act="stop" data-drive="grid" aria-label="' + esc(tr("Grid view")) + '">' + svg(ICO.grid) + '</button><button class="icon-btn' + (state.view === "list" ? " on" : "") + '" type="button" data-act="stop" data-drive="list" aria-label="' + esc(tr("List view")) + '">' + svg(ICO.rows) + '</button></div><a class="outline" href="' + ((state.route && state.route.trash) ? "#/drive" : "#/drive/trash") + '" data-act="stop">' + esc((state.route && state.route.trash) ? tr("Back to Drive") : tr("Trash")) + '</a><span class="drive-used">' + esc(tr("Storage used {size}", { size: formatSize(state.stored) })) + "</span></div>" +
    (state.error ? '<p class="drive-error" style="padding:0 16px">' + esc(state.error) + "</p>" : "") +
    '<input id="drive-file" type="file" multiple hidden>' +
    '<div class="drive-drop">' + body + "</div>" + transfer + dialogHtml();
}
function page(route) {
  state.route = route || { trash: false, folder: "" };
  var back = backHref();
  var head = '<div class="topbar tall"><div class="mhead"><button class="m-ava" type="button" data-act="drawer" aria-label="' + esc(tr("Menu")) + '"><span class="ava initials">Y</span></button></div><div class="page-head">' +
    (back ? '<a class="icon-btn" href="' + back + '" data-act="stop" aria-label="' + esc(tr("Back")) + '">' + svg("M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z") + "</a>" : "") +
    '<div class="head-text grow"><h1>' + esc(state.mode === "ready" ? title() : tr("Drive")) + "</h1></div>" +
    (state.mode === "ready" ? '<button class="icon-btn" type="button" data-act="stop" data-drive="lock" aria-label="' + esc(tr("Lock Drive")) + '">' + svg(ICO.lock) + "</button>" : "") +
    "</div></div>";
  var main = "";
  if (state.mode === "loading") main = '<div class="drive-empty"></div>';
  else if (state.mode === "offline") main = '<div class="drive-empty"><h2>' + esc(tr("Drive is not available on this copy.")) + "</h2></div>";
  else if (state.mode === "setup" || state.mode === "locked") main = lockHtml();
  else main = readyHtml();
  return '<div class="drive' + (state.drag ? " is-drag" : "") + '" data-drop="' + esc(tr("Drop files to upload")) + '">' + head + main + "</div>";
}

async function onUnlock(form) {
  var pass = (form.querySelector("#drive-pass") || {}).value || "";
  var again = (form.querySelector("#drive-pass2") || {}).value || "";
  var remember = !!(form.querySelector("#drive-remember") || {}).checked;
  if (Array.from(pass).length < 8) {
    state.error = tr("Use at least 8 characters.");
    paint();
    return;
  }
  if (state.mode === "setup" && pass !== again) {
    state.error = tr("Passphrases do not match.");
    paint();
    return;
  }
  state.busy = true;
  state.error = "";
  paint();
  try {
    if (state.mode === "setup") {
      var vault = await setupVault(pass, DRIVE_ITERATIONS);
      var put = await apiJson("/v1/drive/vault", {
        method: "PUT",
        body: { kdf: vault.kdf, iterations: vault.iterations, salt: vault.salt, verifier: vault.verifier, verifierIv: vault.verifierIv }
      });
      if (put.status !== 201 && put.status !== 409) throw new Error("vault");
      master = vault.key;
      if (put.status === 409) {
        var info = await apiJson("/v1/drive");
        state.vault = info.vault;
        master = await unlockVault(pass, info.vault.salt, info.vault.iterations, info.vault.verifier, info.vault.verifierIv);
        if (!master) throw new Error("vault");
      }
    } else {
      var row = state.vault;
      master = await unlockVault(pass, row.salt, row.iterations, row.verifier, row.verifierIv);
      if (!master) {
        state.busy = false;
        state.error = tr("That passphrase did not unlock Drive.");
        paint();
        return;
      }
    }
    if (remember) await rememberKey(master);
    else await forgetKey();
    state.mode = "ready";
    if (await loadItems()) {
      state.busy = false;
      paint();
    }
  } catch (err) {
    state.busy = false;
    state.error = tr("Something went wrong. Try again.");
    paint();
  }
}

function bind(root) {
  root.addEventListener("click", function (event) {
    var el = event.target.closest("[data-drive]");
    if (!el || !root.contains(el)) return;
    var act = el.getAttribute("data-drive");
    var id = el.getAttribute("data-id") || "";
    var item = id ? byId(id) : null;
    if (act === "pick") {
      var input = document.getElementById("drive-file");
      if (input) input.click();
      return;
    }
    if (act === "grid" || act === "list") {
      state.view = act;
      try { localStorage.setItem("viktorych-drive-layout", act); } catch (err) { /* keep it for this visit */ }
      paint();
      return;
    }
    if (act === "lock") {
      master = null;
      state.mode = state.vault ? "locked" : "setup";
      state.dialog = null;
      state.menu = "";
      state.items = [];
      forgetKey().then(function () { paint(); });
      return;
    }
    if (act === "ask-folder") { state.menu = ""; state.dialog = { type: "folder" }; paint(); return; }
    if (act === "menu" && item) { state.dialog = null; state.menu = item.id; paint(); return; }
    if (act === "dismiss") { state.dialog = null; state.menu = ""; paint(); return; }
    if (act === "ask-rename" && item) { state.menu = ""; state.dialog = { type: "rename", id: item.id }; paint(); return; }
    if (act === "ask-move" && item) { state.menu = ""; state.dialog = { type: "move", id: item.id }; paint(); return; }
    if (act === "ask-delete" && item) { state.menu = ""; state.dialog = { type: "delete", id: item.id }; paint(); return; }
    if (act === "ask-forever" && item) { state.menu = ""; state.dialog = { type: "forever", id: item.id }; paint(); return; }
    if (act === "open" && item) {
      state.menu = "";
      if (item.kind === "folder") {
        if (!(state.route && state.route.trash)) location.hash = "#/drive/folder/" + encodeURIComponent(item.id);
        return;
      }
      var view = kindOf(item.meta);
      downloadItem(item, !!view);
      return;
    }
    if (act === "download" && item) { state.menu = ""; downloadItem(item, false); return; }
    if (act === "restore" && item) { runChange(function () { return restoreItem(item); }); return; }
    if (act === "delete" && item) { runChange(function () { return removeItem(item, false); }); return; }
    if (act === "forever" && item) { runChange(function () { return removeItem(item, true); }); return; }
    if (act === "move-to" && item) {
      var parent = el.getAttribute("data-parent") || "";
      runChange(function () { return moveItem(item, parent); });
      return;
    }
    if (act === "close-preview") {
      if (state.preview && state.preview.url) URL.revokeObjectURL(state.preview.url);
      state.preview = null;
      paint();
    }
  });
  root.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-drive-form]");
    if (!form) return;
    event.preventDefault();
    var kind = form.getAttribute("data-drive-form");
    if (kind === "unlock") { onUnlock(form); return; }
    var name = String((form.querySelector("#drive-name") || {}).value || "").replace(/\s+/g, " ").trim();
    if (!name) return;
    if (kind === "folder") runChange(function () { return createFolder(name); });
    if (kind === "rename" && state.dialog) {
      var item = byId(state.dialog.id);
      if (item) runChange(function () { return renameItem(item, name); });
    }
  });
  root.addEventListener("input", function (event) {
    if (event.target.id !== "drive-q") return;
    state.query = event.target.value;
    paint();
  });
  root.addEventListener("change", function (event) {
    if (event.target.id !== "drive-file") return;
    var files = event.target.files;
    event.target.value = "";
    uploadFiles(files);
  });
  root.addEventListener("dragover", function (event) {
    if (state.mode !== "ready") return;
    event.preventDefault();
    if (!state.drag) {
      state.drag = true;
      root.classList.add("is-drag");
    }
  });
  root.addEventListener("dragleave", function (event) {
    if (event.target !== root) return;
    state.drag = false;
    root.classList.remove("is-drag");
  });
  root.addEventListener("drop", function (event) {
    event.preventDefault();
    state.drag = false;
    root.classList.remove("is-drag");
    if (event.dataTransfer && event.dataTransfer.files) uploadFiles(event.dataTransfer.files);
  });
}

var booted = false;
function mount(route) {
  state.route = route || state.route;
  var root = document.querySelector(".drive");
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  bind(root);
  var box = document.getElementById("drive-q");
  if (box && document.activeElement && document.activeElement.id === "drive-q") {
    var n = box.value.length;
    if (box.setSelectionRange) box.setSelectionRange(n, n);
  }
  if (!booted) {
    booted = true;
    boot();
  }
}
function unmount() {}

window.ViktorychDrive = {
  visible: visible,
  page: page,
  mount: mount,
  unmount: unmount
};
