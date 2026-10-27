/* Fingerprint or face lock that encrypts the on-device copy.
   PRF output, when the authenticator has it, is the AES-GCM key.
   Otherwise a user-verified assertion is checked locally and a PIN
   derives the key with PBKDF2. Unlock does not use the network. */
import { keyFromPin, keyFromPrf, backoffMs, checkVerifier, decryptJson, encryptJson, makeVerifier, sensitiveDoc, sensitiveStorageKey, PIN_ITERATIONS } from "./shared/app-lock-crypto.js";
import { b64urlToBytes, bytesToB64url, credentialToJSON, hydrateCreation, hydrateRequest, prfBytes, randomBytes, verifyAssertion, verifyRegistration } from "./shared/webauthn.js";

const PREFS_KEY = "viktorychapp-lock-prefs";
const SEALED_KEY = "viktorychapp-lock-sealed";
const DB_NAME = "viktorych-lock";
const DOC_DB = "superintelapp-sw";

function tr(key, vars) {
  return window.t ? window.t(key, vars) : key;
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}
function localTest() {
  return location.hostname === "127.0.0.1" || location.hostname === "localhost";
}
function readPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      on: !!parsed.on,
      lockOnOpen: parsed.lockOnOpen !== false,
      idleMin: [0, 1, 5, 15, 60].indexOf(Number(parsed.idleMin)) >= 0 ? Number(parsed.idleMin) : 5,
      mode: parsed.mode === "pin" ? "pin" : (parsed.mode === "prf" ? "prf" : "")
    };
  } catch (err) {
    return { on: false, lockOnOpen: true, idleMin: 5, mode: "" };
  }
}
function writePrefs(next) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch (err) { /* the screen still locks */ }
}
function sealed() {
  try { return localStorage.getItem(SEALED_KEY) === "1"; }
  catch (err) { return false; }
}
function setSealed(on) {
  try {
    if (on) localStorage.setItem(SEALED_KEY, "1");
    else localStorage.removeItem(SEALED_KEY);
  } catch (err) { /* the cover attribute still hides the app */ }
  document.documentElement.setAttribute("data-lock", on ? "1" : "0");
}

let memoryKey = null;
let idleTimer = 0;
let hiddenAt = 0;
let lockError = "";
let needPin = false;
let pending = null;

function openDb() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function kvGet(db, key) {
  return new Promise(function (resolve) {
    const req = db.transaction("kv", "readonly").objectStore("kv").get(key);
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { resolve(undefined); };
  });
}
function kvSet(db, key, value) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
}
function kvDel(db, key) {
  return new Promise(function (resolve) {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").delete(key);
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { resolve(); };
  });
}

function paceDelay(fails) {
  if (localTest()) return fails >= 3 ? 1500 : 0;
  return backoffMs(fails);
}

async function readRecord() {
  const db = await openDb();
  const record = await kvGet(db, "record");
  db.close();
  return record || null;
}

function collectLocal() {
  const rows = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!sensitiveStorageKey(key)) continue;
      rows.push({ key: key, value: localStorage.getItem(key) });
    }
  } catch (err) { /* private mode has nothing to seal */ }
  return rows;
}

function readDocs() {
  return new Promise(function (resolve) {
    if (!window.indexedDB) { resolve([]); return; }
    const req = indexedDB.open(DOC_DB);
    req.onerror = function () { resolve([]); };
    req.onsuccess = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) { db.close(); resolve([]); return; }
      const tx = db.transaction("docs", "readonly");
      const store = tx.objectStore("docs");
      const values = store.getAll();
      const keys = store.getAllKeys();
      const bag = {};
      function finish() {
        if (!bag.values || !bag.keys) return;
        db.close();
        const out = [];
        for (let i = 0; i < bag.keys.length; i++) {
          if (sensitiveDoc(bag.keys[i], bag.values[i])) out.push({ key: bag.keys[i], row: bag.values[i] });
        }
        resolve(out);
      }
      values.onsuccess = function () { bag.values = values.result || []; finish(); };
      keys.onsuccess = function () { bag.keys = keys.result || []; finish(); };
      values.onerror = keys.onerror = function () { db.close(); resolve([]); };
    };
  });
}

async function readOpfs() {
  if (!navigator.storage || !navigator.storage.getDirectory) return [];
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("vapp-private", { create: true });
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (name === "snapshot.bin" || handle.kind !== "file") continue;
      const file = await handle.getFile();
      if (file.size > 2 * 1024 * 1024) continue;
      out.push({ name: name, data: bytesToB64url(new Uint8Array(await file.arrayBuffer())) });
    }
    return out;
  } catch (err) {
    return [];
  }
}

function clearLocal(rows) {
  rows.forEach(function (row) {
    try { localStorage.removeItem(row.key); } catch (err) { /* already gone */ }
  });
}

function clearDocs(rows) {
  if (!rows.length || !window.indexedDB) return Promise.resolve();
  return new Promise(function (resolve) {
    const req = indexedDB.open(DOC_DB);
    req.onerror = function () { resolve(); };
    req.onsuccess = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) { db.close(); resolve(); return; }
      const tx = db.transaction("docs", "readwrite");
      rows.forEach(function (row) { tx.objectStore("docs").delete(row.key); });
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () { db.close(); resolve(); };
    };
  });
}

async function writeOpfsSnapshot(packed) {
  if (!navigator.storage || !navigator.storage.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("vapp-private", { create: true });
  const handle = await dir.getFileHandle("snapshot.bin", { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([JSON.stringify(packed)], { type: "application/octet-stream" }));
  await writable.close();
}

async function readOpfsSnapshot() {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("vapp-private");
    const handle = await dir.getFileHandle("snapshot.bin");
    const text = await (await handle.getFile()).text();
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

async function snapshot() {
  return { local: collectLocal(), docs: await readDocs(), opfs: await readOpfs() };
}

async function seal() {
  if (!memoryKey) return false;
  const prefs = readPrefs();
  if (!prefs.on) return false;
  const body = await snapshot();
  const packed = await encryptJson(memoryKey, body);
  const db = await openDb();
  await kvSet(db, "vault", packed);
  db.close();
  try { await writeOpfsSnapshot(packed); } catch (err) { /* the IndexedDB copy is the one unlock reads */ }
  clearLocal(body.local);
  await clearDocs(body.docs);
  memoryKey = null;
  setSealed(true);
  showLock();
  return true;
}

function restoreLocal(rows) {
  (rows || []).forEach(function (row) {
    try { localStorage.setItem(row.key, row.value == null ? "" : String(row.value)); } catch (err) { /* quota */ }
  });
}

function restoreDocs(rows) {
  if (!rows || !rows.length || !window.indexedDB) return Promise.resolve();
  return new Promise(function (resolve) {
    const req = indexedDB.open(DOC_DB, 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains("docs")) req.result.createObjectStore("docs");
    };
    req.onerror = function () { resolve(); };
    req.onsuccess = function () {
      const db = req.result;
      const tx = db.transaction("docs", "readwrite");
      rows.forEach(function (row) { tx.objectStore("docs").put(row.row, row.key); });
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () { db.close(); resolve(); };
    };
  });
}

async function restore(body) {
  restoreLocal(body && body.local);
  await restoreDocs(body && body.docs);
}

function showLock() {
  let panel = document.getElementById("app-lock");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "app-lock";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    document.documentElement.appendChild(panel);
  }
  const prefs = readPrefs();
  const pin = prefs.mode === "pin";
  panel.hidden = false;
  panel.innerHTML = '<div class="app-lock-card"><h1>' + esc(tr("Unlock to open the app")) + "</h1><p>" +
    esc(prefs.mode === "prf" ? tr("The sensor encrypts drafts, messages, and the on-device copy. Unlock works with no internet.") : tr("This browser cannot tie encryption to the sensor. The sensor approves unlock, and the PIN encrypts data on this device. A person with the PIN and a copy of this storage can decrypt it without the sensor.")) +
    "</p>" + (pin ? '<label class="acct-field"><input id="app-lock-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="32"><span>' + esc(tr("Device PIN")) + "</span></label>" : "") +
    '<p class="acct-error" id="app-lock-error">' + esc(lockError) + "</p>" +
    '<button class="acct-next" type="button" id="app-lock-go">' + esc(tr("Unlock")) + "</button>" +
    '<button class="acct-quiet" type="button" id="app-lock-forgot">' + esc(tr("Forgot")) + "</button>" +
    (needPin ? '<p id="app-lock-confirm">' + esc(tr("This signs you out and erases drafts, messages, and other data saved on this device.")) + '</p><button class="acct-next" type="button" id="app-lock-wipe">' + esc(tr("Erase and sign out")) + "</button>" : "") +
    "</div>";
  document.documentElement.setAttribute("data-lock", "1");
}

function hideLock() {
  const panel = document.getElementById("app-lock");
  if (panel) panel.hidden = true;
  if (!sealed()) document.documentElement.setAttribute("data-lock", "0");
}

async function assertion(record) {
  const challenge = randomBytes(32);
  const salt = b64urlToBytes(record.salt);
  const publicKey = {
    challenge: challenge,
    timeout: 60000,
    rpId: location.hostname,
    userVerification: "required",
    allowCredentials: [{ type: "public-key", id: b64urlToBytes(record.credentialId) }]
  };
  if (record.mode === "prf") {
    publicKey.extensions = { prf: { eval: { first: salt } } };
  }
  const cred = await navigator.credentials.get({ publicKey: publicKey });
  const json = await credentialToJSON(cred);
  await verifyAssertion({
    clientDataJSON: json.response.clientDataJSON,
    authenticatorData: json.response.authenticatorData,
    signature: json.response.signature,
    publicKey: b64urlToBytes(record.publicKey),
    challenge: challenge,
    origin: location.origin,
    rpId: location.hostname,
    signCount: 0,
    requireUV: true
  });
  return { json: json, cred: cred };
}

async function unlock(pin, options) {
  const record = await readRecord();
  if (!record) throw new Error("lock");
  const now = Date.now();
  if (Number(record.nextAt || 0) > now) {
    lockError = tr("Too many attempts. Wait and try again.");
    showLock();
    throw new Error("backoff");
  }
  let key = null;
  try {
    const proved = await assertion(record);
    if (record.mode === "prf") {
      const ext = proved.cred.getClientExtensionResults ? proved.cred.getClientExtensionResults() : {};
      const first = prfBytes(ext);
      if (!first) throw new Error("prf");
      key = await keyFromPrf(first);
    } else {
      if (!pin || String(pin).length < 4) throw new Error("pin");
      key = await keyFromPin(pin, b64urlToBytes(record.salt), record.iterations || PIN_ITERATIONS);
    }
    const ok = await checkVerifier(key, record.verifier);
    if (!ok) throw new Error("pin");
  } catch (err) {
    record.fails = Number(record.fails || 0) + 1;
    record.nextAt = Date.now() + paceDelay(record.fails);
    const db = await openDb();
    await kvSet(db, "record", record);
    db.close();
    lockError = record.nextAt > Date.now() && record.fails >= 3 ? tr("Too many attempts. Wait and try again.") : tr("Wrong PIN or the sensor was not recognized.");
    showLock();
    throw err;
  }
  record.fails = 0;
  record.nextAt = 0;
  const db = await openDb();
  await kvSet(db, "record", record);
  let packed = await kvGet(db, "vault");
  db.close();
  if (!packed) packed = await readOpfsSnapshot();
  memoryKey = key;
  if (packed) {
    const body = await decryptJson(key, packed);
    await restore(body);
  }
  setSealed(false);
  lockError = "";
  needPin = false;
  hideLock();
  if (!(options && options.reload === false && localTest())) location.reload();
  return true;
}

async function setup(options) {
  const opts = options || {};
  const salt = randomBytes(32);
  const userId = randomBytes(16);
  const challenge = randomBytes(32);
  const publicKey = hydrateCreation({
    challenge: bytesToB64url(challenge),
    rp: { name: "ViktorychApp", id: location.hostname },
    user: { id: bytesToB64url(userId), name: "app-lock", displayName: "app-lock" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: "required"
    }
  });
  publicKey.extensions = { prf: { eval: { first: salt } } };
  const cred = await navigator.credentials.create({ publicKey: publicKey });
  const json = await credentialToJSON(cred);
  const verified = await verifyRegistration({
    clientDataJSON: json.response.clientDataJSON,
    attestationObject: json.response.attestationObject,
    challenge: challenge,
    origin: location.origin,
    rpId: location.hostname,
    requireUV: true
  });
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  let first = prfBytes(ext);
  const forcePin = !!opts.forcePin && localTest();
  if (!first && !forcePin) {
    try {
      const again = await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          rpId: location.hostname,
          userVerification: "required",
          allowCredentials: [{ type: "public-key", id: verified.credentialId }],
          extensions: { prf: { eval: { first: salt } } }
        }
      });
      const ext2 = again.getClientExtensionResults ? again.getClientExtensionResults() : {};
      first = prfBytes(ext2);
    } catch (err) { first = null; }
  }
  if (first && !forcePin) {
    const key = await keyFromPrf(first);
    const record = {
      credentialId: bytesToB64url(verified.credentialId),
      publicKey: bytesToB64url(verified.publicKey),
      salt: bytesToB64url(salt),
      mode: "prf",
      iterations: 0,
      verifier: await makeVerifier(key),
      fails: 0,
      nextAt: 0
    };
    const db = await openDb();
    await kvSet(db, "record", record);
    db.close();
    memoryKey = key;
    const prefs = readPrefs();
    prefs.on = true;
    prefs.mode = "prf";
    writePrefs(prefs);
    pending = null;
    return { mode: "prf" };
  }
  pending = {
    credentialId: bytesToB64url(verified.credentialId),
    publicKey: bytesToB64url(verified.publicKey),
    salt: bytesToB64url(randomBytes(16)),
    iterations: localTest() && opts.testIterations ? opts.testIterations : PIN_ITERATIONS
  };
  return { mode: "pin", needPin: true };
}

async function setPin(pin, confirm) {
  if (!pending) throw new Error("pin");
  const left = String(pin || "");
  const right = String(confirm || "");
  if (left.length < 4) throw new Error("short");
  if (left !== right) throw new Error("match");
  const key = await keyFromPin(left, b64urlToBytes(pending.salt), pending.iterations);
  const record = {
    credentialId: pending.credentialId,
    publicKey: pending.publicKey,
    salt: pending.salt,
    mode: "pin",
    iterations: pending.iterations,
    verifier: await makeVerifier(key),
    fails: 0,
    nextAt: 0
  };
  const db = await openDb();
  await kvSet(db, "record", record);
  db.close();
  memoryKey = key;
  pending = null;
  const prefs = readPrefs();
  prefs.on = true;
  prefs.mode = "pin";
  writePrefs(prefs);
  return { mode: "pin" };
}

async function wipeAll() {
  const prefixes = ["viktorychapp-", "superintelapp-", "rss-feeds-"];
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(function (key) {
      if (!key) return;
      for (let i = 0; i < prefixes.length; i++) {
        if (key.indexOf(prefixes[i]) === 0) localStorage.removeItem(key);
      }
    });
  } catch (err) { /* private mode */ }
  try { sessionStorage.clear(); } catch (err) { /* already clear */ }
  const names = [DB_NAME, DOC_DB, "superintel-history", "viktorych-drive", "viktorychapp-live", "superintelapp-live", "sintel-music", "viktorych-discord"];
  names.forEach(function (name) {
    try { indexedDB.deleteDatabase(name); } catch (err) { /* already gone */ }
  });
  if (navigator.storage && navigator.storage.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("vapp-private", { recursive: true });
    } catch (err) { /* the directory was already gone */ }
  }
  if (window.ViktorychLocal && window.ViktorychLocal.wipe) window.ViktorychLocal.wipe();
  memoryKey = null;
  setSealed(false);
  location.reload();
}

function settingsHtml() {
  const prefs = readPrefs();
  function idle(min, label) {
    return '<button class="outline' + (prefs.idleMin === min ? " on" : "") + '" type="button" data-sec="lock-idle" data-min="' + min + '">' + esc(label) + "</button>";
  }
  const modeText = prefs.mode === "prf"
    ? tr("The sensor encrypts drafts, messages, and the on-device copy. Unlock works with no internet.")
    : (prefs.mode === "pin"
      ? tr("This browser cannot tie encryption to the sensor. The sensor approves unlock, and the PIN encrypts data on this device. A person with the PIN and a copy of this storage can decrypt it without the sensor.")
      : tr("The sensor encrypts drafts, messages, and the on-device copy. Unlock works with no internet."));
  const pinFields = pending
    ? '<label class="acct-field"><input id="lock-pin" name="pin" type="password" autocomplete="new-password" inputmode="numeric" maxlength="32"><span>' + esc(tr("Set a device PIN")) + '</span></label><label class="acct-field"><input id="lock-pin-2" name="confirm" type="password" autocomplete="new-password" inputmode="numeric" maxlength="32"><span>' + esc(tr("Confirm the PIN")) + '</span></label><button class="outline" type="button" data-sec="lock-pin">' + esc(tr("Set a device PIN")) + "</button><p class=\"acct-error\">" + esc(lockError) + "</p>"
    : "";
  return "<h2>" + esc(tr("App lock")) + "</h2><p class=\"phandle\">" + esc(modeText) + "</p>" +
    '<button class="tab-switch' + (prefs.lockOnOpen ? " on" : "") + '" type="button" role="switch" aria-checked="' + (prefs.lockOnOpen ? "true" : "false") + '" data-sec="lock-open"><span>' + esc(tr("Lock when the app opens")) + "</span><i></i></button>" +
    "<h2>" + esc(tr("Lock after time in the background")) + "</h2><div class=\"theme-row\">" +
    idle(0, tr("Never")) + idle(1, tr("After 1 minute")) + idle(5, tr("After 5 minutes")) + idle(15, tr("After 15 minutes")) + idle(60, tr("1 hour")) +
    "</div>" + pinFields +
    (prefs.on
      ? '<button class="outline" type="button" data-sec="lock-now">' + esc(tr("Lock now")) + '</button><button class="outline" type="button" data-sec="lock-off">' + esc(tr("Turn off app lock")) + "</button>"
      : '<button class="outline" type="button" data-sec="lock-setup">' + esc(tr("Set up app lock")) + "</button>");
}

function armTimer() {
  clearTimeout(idleTimer);
  const prefs = readPrefs();
  if (!prefs.on || prefs.lockOnOpen || !prefs.idleMin || !memoryKey || !hiddenAt) return;
  const wait = hiddenAt + prefs.idleMin * 60 * 1000 - Date.now();
  if (wait <= 0) {
    seal();
    return;
  }
  idleTimer = setTimeout(seal, wait);
}

document.addEventListener("click", function (event) {
  const node = event.target && event.target.closest ? event.target.closest("[data-sec], #app-lock-go, #app-lock-forgot, #app-lock-wipe") : null;
  if (!node) return;
  const id = node.id;
  if (id === "app-lock-go") {
    event.preventDefault();
    const input = document.getElementById("app-lock-pin");
    unlock(input ? input.value : "").catch(function () {});
    return;
  }
  if (id === "app-lock-forgot") {
    event.preventDefault();
    needPin = true;
    showLock();
    return;
  }
  if (id === "app-lock-wipe") {
    event.preventDefault();
    wipeAll();
    return;
  }
  const act = node.getAttribute("data-sec");
  if (!act || act.indexOf("lock-") !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const prefs = readPrefs();
  if (act === "lock-open") {
    prefs.lockOnOpen = !prefs.lockOnOpen;
    writePrefs(prefs);
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    return;
  }
  if (act === "lock-idle") {
    prefs.idleMin = Number(node.getAttribute("data-min")) || 0;
    writePrefs(prefs);
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    return;
  }
  if (act === "lock-setup") {
    lockError = "";
    setup().then(function (result) {
      if (result.needPin) lockError = "";
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      lockError = tr("Could not create a passkey.");
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
    return;
  }
  if (act === "lock-pin") {
    const first = document.getElementById("lock-pin");
    const second = document.getElementById("lock-pin-2");
    setPin(first ? first.value : "", second ? second.value : "").then(function () {
      lockError = "";
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function (err) {
      lockError = err && err.message === "match" ? tr("Those PINs do not match.") : tr("Use at least 4 characters.");
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
    return;
  }
  if (act === "lock-now") {
    seal();
    return;
  }
  if (act === "lock-off") {
    memoryKey = null;
    pending = null;
    prefs.on = false;
    prefs.mode = "";
    writePrefs(prefs);
    setSealed(false);
    openDb().then(function (db) {
      return kvDel(db, "record").then(function () { return kvDel(db, "vault"); }).then(function () { db.close(); });
    }).catch(function () {});
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
}, true);

document.addEventListener("visibilitychange", function () {
  const prefs = readPrefs();
  if (!prefs.on) return;
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    if (prefs.lockOnOpen && memoryKey) seal();
    else armTimer();
  } else {
    clearTimeout(idleTimer);
    hiddenAt = 0;
  }
});
window.addEventListener("pagehide", function () {
  const prefs = readPrefs();
  if (prefs.on && prefs.lockOnOpen && memoryKey) seal();
});
window.addEventListener("freeze", function () {
  const prefs = readPrefs();
  if (prefs.on && prefs.lockOnOpen && memoryKey) seal();
});
window.addEventListener("viktorych-account-deleted", function () {
  memoryKey = null;
  setSealed(false);
  openDb().then(function (db) {
    return kvDel(db, "vault").then(function () { db.close(); });
  }).catch(function () {});
});

if (sealed()) showLock();

window.ViktorychAppLock = {
  setup: setup,
  setPin: setPin,
  unlock: unlock,
  seal: seal,
  wipe: wipeAll,
  settingsHtml: settingsHtml,
  prefs: readPrefs,
  sealed: sealed,
  mode: function () { return readPrefs().mode; },
  localTest: localTest
};
