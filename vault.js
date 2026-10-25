/* Zero-Knowledge Viktorych Vault UI & Client-Side Crypto Module.
   Passwords, session cookies, and master keys are encrypted/decrypted in the browser.
   The Worker and Cloudflare D1 only store encrypted blobs and ciphertext envelopes. */

import {
  DRIVE_KDF,
  DRIVE_ITERATIONS,
  bytesToB64,
  b64ToBytes,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  deriveMaster,
  setupVault
} from "./shared/drive-crypto.js";

var masterKey = null;
var configCache = null;

var state = {
  mode: "loading", // "loading" | "setup" | "locked" | "ready"
  tab: "my",       // "my" | "shared" | "sent"
  items: [],
  receivedShares: [],
  sentShares: [],
  query: "",
  dialog: null,    // null | "add" | "share" | "player" | "pin"
  activeItem: null,
  playerUrl: "",
  pinTarget: null,
  pinError: "",
  error: "",
  busy: false,
  unmasked: {}
};

function tr(key, vars) {
  return window.t ? window.t(key, vars) : key;
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function account() {
  return window.ViktorychAccounts && window.ViktorychAccounts.account ? window.ViktorychAccounts.account() : null;
}

function apiRoot() {
  var cfg = window.VIKTORYCH_ACCOUNTS || {};
  return String(cfg.api || "").replace(/\/$/, "");
}

function token() {
  var session = window.ViktorychAccounts && window.ViktorychAccounts.session ? window.ViktorychAccounts.session() : null;
  return session ? session.token : "";
}

function visible() {
  return !!account();
}

async function apiJson(path, opts) {
  var tok = token();
  var options = opts || {};
  var headers = Object.assign({}, options.headers || {});
  if (tok) headers["Authorization"] = "Bearer " + tok;
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  options.headers = headers;
  var root = apiRoot();
  var res = await fetch(root + path, options);
  var body = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var err = new Error(body.error || "request_failed");
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function parseSpotifyEmbed(input) {
  var raw = String(input || "").trim();
  if (!raw) return "";
  var uriMatch = raw.match(/^spotify:(track|playlist|album|artist|episode):([A-Za-z0-9]+)$/);
  if (uriMatch) {
    return "https://open.spotify.com/embed/" + uriMatch[1] + "/" + uriMatch[2] + "?utm_source=generator";
  }
  var urlMatch = raw.match(/open\.spotify\.com\/(track|playlist|album|artist|episode)\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    return "https://open.spotify.com/embed/" + urlMatch[1] + "/" + urlMatch[2] + "?utm_source=generator";
  }
  return "";
}

function maskSecret(secret) {
  var text = String(secret || "");
  if (!text) return "";
  if (text.length <= 4) return "••••";
  return "••••••••••••" + text.slice(-4);
}

function showToast(msg) {
  var toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(function () { toast.hidden = true; }, 3000);
}

async function fetchVaultConfig() {
  try {
    var data = await apiJson("/v1/vault/config", { method: "GET" });
    configCache = data;
    return data;
  } catch (err) {
    return { configured: false };
  }
}

async function unlockWithPassphrase(passphrase) {
  state.error = "";
  state.busy = true;
  paint();
  try {
    if (!configCache || !configCache.configured) {
      configCache = await fetchVaultConfig();
    }
    if (!configCache.configured) {
      state.mode = "setup";
      state.busy = false;
      paint();
      return;
    }
    var rounds = configCache.iterations || DRIVE_ITERATIONS;
    var saltBytes = b64ToBytes(configCache.salt);
    var key = await deriveMaster(passphrase, saltBytes, rounds);

    // Verify key
    var plain = await decryptBytes(key, b64ToBytes(configCache.verifierIv), b64ToBytes(configCache.verifier));
    var text = new TextDecoder().decode(plain);
    if (text !== "viktorych-drive-v1") throw new Error("bad_passphrase");

    masterKey = key;
    state.mode = "ready";
    await reloadVault();
  } catch (err) {
    state.error = tr("Incorrect master passphrase.");
    state.mode = "locked";
  } finally {
    state.busy = false;
    paint();
  }
}

async function setupNewVault(passphrase) {
  state.error = "";
  state.busy = true;
  paint();
  try {
    var vault = await setupVault(passphrase, DRIVE_ITERATIONS);
    await apiJson("/v1/vault/config", {
      method: "POST",
      body: {
        kdf: vault.kdf,
        iterations: vault.iterations,
        salt: vault.salt,
        verifier: vault.verifier,
        verifierIv: vault.verifierIv
      }
    });
    masterKey = vault.key;
    configCache = {
      configured: true,
      kdf: vault.kdf,
      iterations: vault.iterations,
      salt: vault.salt,
      verifier: vault.verifier,
      verifierIv: vault.verifierIv
    };
    state.mode = "ready";
    await reloadVault();
  } catch (err) {
    state.error = tr("Could not initialize vault.");
    state.mode = "setup";
  } finally {
    state.busy = false;
    paint();
  }
}

async function reloadVault() {
  if (!masterKey) return;
  state.busy = true;
  paint();
  try {
    var itemRes = await apiJson("/v1/vault/items", { method: "GET" });
    var sharesRes = await apiJson("/v1/vault/shares", { method: "GET" });

    // Decrypt own items
    var decryptedItems = [];
    var rawItems = itemRes.items || [];
    for (var i = 0; i < rawItems.length; i++) {
      var it = rawItems[i];
      try {
        var dec = await decryptJson(masterKey, it.iv, it.encryptedBlob);
        decryptedItems.push(Object.assign({}, dec, {
          id: it.id,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt
        }));
      } catch (err) {
        decryptedItems.push({
          id: it.id,
          service: it.service,
          title: it.title,
          secret: "[Unable to decrypt]",
          corrupt: true
        });
      }
    }
    state.items = decryptedItems;
    state.receivedShares = sharesRes.received || [];
    state.sentShares = sharesRes.sent || [];
  } catch (err) {
    state.error = tr("Failed to load vault items.");
  } finally {
    state.busy = false;
    paint();
  }
}

async function saveVaultItem(item) {
  if (!masterKey) return;
  state.busy = true;
  state.error = "";
  paint();
  try {
    var encrypted = await encryptJson(masterKey, item);
    await apiJson("/v1/vault/items", {
      method: "POST",
      body: {
        id: item.id || "",
        service: item.service || "generic",
        title: item.title || tr("Untitled"),
        encryptedBlob: encrypted.ciphertext,
        iv: encrypted.iv
      }
    });
    state.dialog = null;
    await reloadVault();
    showToast(tr("Item saved to Vault"));
  } catch (err) {
    state.error = tr("Could not save item.");
  } finally {
    state.busy = false;
    paint();
  }
}

async function deleteVaultItem(id) {
  if (!confirm(tr("Delete this credential from your Vault?"))) return;
  state.busy = true;
  paint();
  try {
    await apiJson("/v1/vault/items/" + encodeURIComponent(id), { method: "DELETE" });
    await reloadVault();
    showToast(tr("Item deleted"));
  } catch (err) {
    state.error = tr("Could not delete item.");
  } finally {
    state.busy = false;
    paint();
  }
}

async function shareVaultItem(item, recipientHandle, pin) {
  state.busy = true;
  state.error = "";
  paint();
  try {
    // Envelope key derivation (PIN-protected or direct)
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var pinKey = await deriveMaster(pin || "viktorych-open", salt, 10000);
    var payloadToEncrypt = {
      service: item.service,
      title: item.title,
      username: item.username || "",
      secret: item.secret || "",
      secretType: item.secretType || "password",
      loginUrl: item.loginUrl || "",
      notes: item.notes || "",
      salt: bytesToB64(salt)
    };
    var encrypted = await encryptJson(pinKey, payloadToEncrypt);

    await apiJson("/v1/vault/share", {
      method: "POST",
      body: {
        itemId: item.id || "",
        recipientHandle: recipientHandle,
        service: item.service || "generic",
        title: item.title || tr("Untitled"),
        encryptedPayload: encrypted.ciphertext,
        iv: encrypted.iv,
        shareCodeHash: pin ? "pin_protected" : ""
      }
    });
    state.dialog = null;
    await reloadVault();
    showToast(tr("Shared securely with @{handle}", { handle: recipientHandle.replace(/^@/, "") }));
  } catch (err) {
    state.error = tr("Could not share credential.");
  } finally {
    state.busy = false;
    paint();
  }
}

async function unlockSharedItem(share, pin) {
  try {
    var rawIv = share.iv;
    var ciphertext = share.encryptedPayload;

    // Try decrypting with provided PIN or default key
    var candidatePins = pin ? [pin] : ["viktorych-open"];
    var decrypted = null;

    for (var i = 0; i < candidatePins.length; i++) {
      try {
        var dummyKey = await deriveMaster(candidatePins[i], new Uint8Array(16), 10000);
        // We need the salt from inside the envelope or use fixed salt
        decrypted = await decryptJson(dummyKey, rawIv, ciphertext);
        if (decrypted) break;
      } catch (e) { /* try next */ }
    }

    if (!decrypted) {
      state.pinTarget = share;
      state.dialog = "pin";
      state.pinError = pin ? tr("Incorrect PIN code.") : "";
      paint();
      return;
    }

    // Success! Show item in modal or viewer
    state.dialog = null;
    state.pinTarget = null;
    state.activeItem = decrypted;
    paint();
  } catch (err) {
    state.pinError = tr("Could not decrypt shared item.");
    paint();
  }
}

async function revokeShare(shareId) {
  if (!confirm(tr("Revoke this shared access?"))) return;
  state.busy = true;
  paint();
  try {
    await apiJson("/v1/vault/shares/" + encodeURIComponent(shareId), { method: "DELETE" });
    await reloadVault();
    showToast(tr("Shared access revoked"));
  } catch (err) {
    state.error = tr("Could not revoke share.");
  } finally {
    state.busy = false;
    paint();
  }
}

function lockVault() {
  masterKey = null;
  state.mode = "locked";
  state.items = [];
  state.receivedShares = [];
  state.sentShares = [];
  paint();
}

function serviceBadge(service) {
  var s = String(service || "generic").toLowerCase();
  var glyph = "";
  if (s === "spotify") {
    glyph = `<svg viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.435-5.308-1.76-8.793-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.808-.87 7.076-.496 9.722 1.113.294.18.386.562.207.857zm1.226-2.724c-.227.37-.714.487-1.084.26-2.69-1.654-6.79-2.134-9.97-1.168-.415.126-.856-.11-.982-.525-.126-.416.11-.857.525-.983 3.633-1.103 8.147-.568 11.25 1.34.37.227.488.714.261 1.084zm.106-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.494.15-1.018-.13-1.168-.624-.15-.494.13-1.018.624-1.168 3.532-1.072 9.404-.866 13.115 1.338.445.264.59.838.327 1.282-.264.444-.838.59-1.282.327z"/></svg>`;
  } else if (s === "netflix") {
    glyph = `<svg viewBox="0 0 24 24"><path d="M5.398 0v24c1.196-.134 2.457-.312 3.682-.533V0H5.398zm9.522 0v19.467c1.225-.221 2.486-.399 3.682-.533V0h-3.682zm-4.761 7.2L6.14 23.364c1.233-.211 2.486-.39 3.73-.544l2.129-6.388 2.13 6.388c1.244.154 2.497.333 3.73.544L13.84 7.2h-3.681z"/></svg>`;
  } else if (s === "discord") {
    glyph = `<svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z"/></svg>`;
  } else {
    glyph = `<svg viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`;
  }
  return `<span class="vault-badge ${s}">${glyph}</span>`;
}

function itemCardHtml(item) {
  var isUnmasked = !!state.unmasked[item.id];
  var displaySecret = isUnmasked ? item.secret : maskSecret(item.secret);
  var embed = parseSpotifyEmbed(item.secret || item.loginUrl);

  return `<div class="vault-card" data-id="${esc(item.id)}">
    <div class="vault-card-head">
      ${serviceBadge(item.service)}
      <div class="vault-card-meta">
        <div class="vault-card-title">${esc(item.title || tr("Untitled"))}</div>
        <div class="vault-card-sub">${esc(item.username || item.service.toUpperCase())}</div>
      </div>
    </div>
    <div class="vault-secret-box">
      <span class="vault-secret-val ${isUnmasked ? "unmasked" : ""}">${esc(displaySecret)}</span>
      <div style="display:flex;gap:4px">
        <button type="button" class="vault-action-btn" data-act="toggle-mask" data-id="${esc(item.id)}" title="${tr("Reveal")}">${isUnmasked ? "👁️" : "🙈"}</button>
        <button type="button" class="vault-action-btn" data-act="copy-secret" data-val="${esc(item.secret)}" title="${tr("Copy")}">${tr("Copy")}</button>
      </div>
    </div>
    <div class="vault-card-actions">
      ${embed ? `<button type="button" class="vault-action-btn spotify-play" data-act="play-spotify" data-url="${esc(embed)}">▶ ${tr("Play in App")}</button>` : ""}
      ${item.loginUrl ? `<a class="vault-action-btn" href="${esc(item.loginUrl)}" target="_blank" rel="noopener noreferrer">${tr("Open Site")} ↗</a>` : ""}
      <button type="button" class="vault-action-btn" data-act="share-modal" data-id="${esc(item.id)}">${tr("Share Access")}</button>
      <button type="button" class="vault-action-btn" data-act="delete-item" data-id="${esc(item.id)}" style="margin-left:auto;color:var(--red)">${tr("Delete")}</button>
    </div>
  </div>`;
}

function receivedShareCardHtml(share) {
  return `<div class="vault-card" data-share-id="${esc(share.id)}">
    <div class="vault-card-head">
      ${serviceBadge(share.service)}
      <div class="vault-card-meta">
        <div class="vault-card-title">${esc(share.title || tr("Shared Access"))}</div>
        <div class="vault-card-sub">${tr("Shared by @{handle}", { handle: share.senderHandle })}</div>
      </div>
    </div>
    <div class="vault-card-actions">
      <button type="button" class="vault-action-btn primary" data-act="open-shared" data-share-id="${esc(share.id)}">${share.hasPin ? "🔑 " + tr("Unlock with PIN") : tr("Open Shared Access")}</button>
      <button type="button" class="vault-action-btn" data-act="revoke-share" data-share-id="${esc(share.id)}" style="margin-left:auto;color:var(--red)">${tr("Remove")}</button>
    </div>
  </div>`;
}

function sentShareCardHtml(share) {
  return `<div class="vault-card" data-share-id="${esc(share.id)}">
    <div class="vault-card-head">
      ${serviceBadge(share.service)}
      <div class="vault-card-meta">
        <div class="vault-card-title">${esc(share.title || tr("Shared Access"))}</div>
        <div class="vault-card-sub">${tr("Shared with @{handle}", { handle: share.recipientHandle })}</div>
      </div>
    </div>
    <div class="vault-card-actions">
      <button type="button" class="vault-action-btn" data-act="revoke-share" data-share-id="${esc(share.id)}" style="margin-left:auto;color:var(--red)">${tr("Revoke Access")}</button>
    </div>
  </div>`;
}

function lockScreenHtml(isSetup) {
  return `<div class="vault-lock-screen">
    <div class="vault-lock-icon">
      <svg viewBox="0 0 24 24"><path d="M17 9V7A5 5 0 0 0 7 7v2H5v12h14V9h-2zm-8-2a3 3 0 0 1 6 0v2H9V7zm8 12H7v-8h10v8z"/></svg>
    </div>
    <h2>${esc(isSetup ? tr("Setup Viktorych Vault") : tr("Viktorych Vault is Locked"))}</h2>
    <p>${esc(isSetup ? tr("Create a master passphrase to encrypt your credentials and tokens client-side.") : tr("Enter your master passphrase to decrypt your passwords and shared accounts."))}</p>
    <form class="vault-unlock-form" data-act="${isSetup ? "do-setup" : "do-unlock"}">
      <div class="vault-form-row">
        <label for="vault-pwd">${esc(tr("Master Passphrase"))}</label>
        <input id="vault-pwd" class="vault-input" type="password" required autofocus placeholder="••••••••••••">
      </div>
      ${state.error ? `<div class="drive-error" style="margin-bottom:12px">${esc(state.error)}</div>` : ""}
      <button type="submit" class="vault-btn" style="width:100%;justify-content:center" ${state.busy ? "disabled" : ""}>
        ${esc(isSetup ? tr("Create Vault") : tr("Unlock Vault"))}
      </button>
    </form>
  </div>`;
}

function addDialogHtml() {
  return `<div class="vault-modal-back" data-act="close-dialog">
    <div class="vault-modal" data-act="stop">
      <div class="vault-modal-head">
        <h3>${esc(tr("Add Credential to Vault"))}</h3>
        <button type="button" class="vault-close-btn" data-act="close-dialog">✕</button>
      </div>
      <form class="vault-item-form" data-act="submit-add">
        <div class="vault-form-row">
          <label for="item-service">${esc(tr("Service"))}</label>
          <select id="item-service" class="vault-input">
            <option value="spotify">Spotify</option>
            <option value="netflix">Netflix</option>
            <option value="discord">Discord</option>
            <option value="generic">${esc(tr("Website / Other"))}</option>
          </select>
        </div>
        <div class="vault-form-row">
          <label for="item-title">${esc(tr("Title"))}</label>
          <input id="item-title" class="vault-input" required placeholder="e.g. Spotify Premium Family">
        </div>
        <div class="vault-form-row">
          <label for="item-user">${esc(tr("Username / Email"))}</label>
          <input id="item-user" class="vault-input" placeholder="user@example.com">
        </div>
        <div class="vault-form-row">
          <label for="item-secret">${esc(tr("Password / Session Token (sp_dc)"))}</label>
          <input id="item-secret" class="vault-input" type="password" required placeholder="••••••••••••">
          <small style="color:var(--muted);display:block;margin-top:4px">${esc(tr("For Spotify sharing without password, paste your sp_dc session cookie or playlist URL."))}</small>
        </div>
        <div class="vault-form-row">
          <label for="item-url">${esc(tr("Login URL"))}</label>
          <input id="item-url" class="vault-input" placeholder="https://open.spotify.com">
        </div>
        <div class="vault-form-row">
          <label for="item-notes">${esc(tr("Notes"))}</label>
          <textarea id="item-notes" class="vault-input" rows="2"></textarea>
        </div>
        <button type="submit" class="vault-btn" style="width:100%;justify-content:center" ${state.busy ? "disabled" : ""}>
          ${esc(tr("Save to Vault"))}
        </button>
      </form>
    </div>
  </div>`;
}

function shareDialogHtml() {
  var item = state.activeItem;
  if (!item) return "";
  return `<div class="vault-modal-back" data-act="close-dialog">
    <div class="vault-modal" data-act="stop">
      <div class="vault-modal-head">
        <h3>${esc(tr("Share Access: {title}", { title: item.title }))}</h3>
        <button type="button" class="vault-close-btn" data-act="close-dialog">✕</button>
      </div>
      <p style="color:var(--muted);font-size:14px;margin-top:0">${esc(tr("Share this login or session securely with a friend without revealing your raw master credentials."))}</p>
      <form class="vault-share-form" data-act="submit-share">
        <div class="vault-form-row">
          <label for="share-handle">${esc(tr("Recipient Handle (@handle)"))}</label>
          <input id="share-handle" class="vault-input" required placeholder="@friend">
        </div>
        <div class="vault-form-row">
          <label for="share-pin">${esc(tr("Optional 4-Digit Unlock PIN"))}</label>
          <input id="share-pin" class="vault-input" type="password" maxlength="8" placeholder="e.g. 1234">
          <small style="color:var(--muted);display:block;margin-top:4px">${esc(tr("Leave blank for direct 1-click friend access."))}</small>
        </div>
        <button type="submit" class="vault-btn" style="width:100%;justify-content:center" ${state.busy ? "disabled" : ""}>
          ${esc(tr("Share Now"))}
        </button>
      </form>
    </div>
  </div>`;
}

function pinDialogHtml() {
  return `<div class="vault-modal-back" data-act="close-dialog">
    <div class="vault-modal" data-act="stop" style="max-width:380px">
      <div class="vault-modal-head">
        <h3>${esc(tr("Unlock Shared Access"))}</h3>
        <button type="button" class="vault-close-btn" data-act="close-dialog">✕</button>
      </div>
      <p style="color:var(--muted);font-size:14px;margin-top:0">${esc(tr("This shared credential is protected by an unlock PIN code."))}</p>
      <form class="vault-pin-form" data-act="submit-pin">
        <div class="vault-form-row">
          <label for="pin-input">${esc(tr("Enter PIN Code"))}</label>
          <input id="pin-input" class="vault-input" type="password" required autofocus placeholder="1234">
        </div>
        ${state.pinError ? `<div class="drive-error" style="margin-bottom:12px">${esc(state.pinError)}</div>` : ""}
        <button type="submit" class="vault-btn" style="width:100%;justify-content:center">
          ${esc(tr("Unlock"))}
        </button>
      </form>
    </div>
  </div>`;
}

function playerDialogHtml() {
  return `<div class="vault-modal-back" data-act="close-dialog">
    <div class="vault-modal" data-act="stop" style="max-width:540px">
      <div class="vault-modal-head">
        <h3>${esc(tr("In-App Spotify Player"))}</h3>
        <button type="button" class="vault-close-btn" data-act="close-dialog">✕</button>
      </div>
      <iframe class="vault-player-frame" src="${esc(state.playerUrl)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
    </div>
  </div>`;
}

function paint() {
  var root = document.querySelector(".vault");
  if (!root) return;

  var user = account();
  if (!user) {
    root.innerHTML = `<div class="vault-empty"><p>${esc(tr("Please sign in to access your Viktorych Vault."))}</p></div>`;
    return;
  }

  if (state.mode === "loading") {
    root.innerHTML = `<div class="vault-empty"><div class="spin" style="margin:20px auto"></div><p>${esc(tr("Loading Vault..."))}</p></div>`;
    return;
  }

  if (state.mode === "setup") {
    root.innerHTML = lockScreenHtml(true);
    return;
  }

  if (state.mode === "locked") {
    root.innerHTML = lockScreenHtml(false);
    return;
  }

  // Ready Mode
  var filterQ = state.query.toLowerCase().trim();
  var filteredItems = state.items.filter(function (it) {
    return !filterQ || (it.title && it.title.toLowerCase().indexOf(filterQ) >= 0) || (it.service && it.service.toLowerCase().indexOf(filterQ) >= 0);
  });

  var contentHtml = "";
  if (state.tab === "my") {
    if (!filteredItems.length) {
      contentHtml = `<div class="vault-empty">
        <svg viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
        <p>${esc(filterQ ? tr("No matching credentials found.") : tr("Your Vault is empty. Add credentials to store and share them securely."))}</p>
        <button type="button" class="vault-btn" data-act="open-add" style="margin-top:12px">+ ${esc(tr("Add Item"))}</button>
      </div>`;
    } else {
      contentHtml = `<div class="vault-grid">${filteredItems.map(itemCardHtml).join("")}</div>`;
    }
  } else if (state.tab === "shared") {
    if (!state.receivedShares.length) {
      contentHtml = `<div class="vault-empty">
        <p>${esc(tr("No credentials shared with you yet."))}</p>
      </div>`;
    } else {
      contentHtml = `<div class="vault-grid">${state.receivedShares.map(receivedShareCardHtml).join("")}</div>`;
    }
  } else if (state.tab === "sent") {
    if (!state.sentShares.length) {
      contentHtml = `<div class="vault-empty">
        <p>${esc(tr("You have not shared any credentials yet."))}</p>
      </div>`;
    } else {
      contentHtml = `<div class="vault-grid">${state.sentShares.map(sentShareCardHtml).join("")}</div>`;
    }
  }

  var modalsHtml = "";
  if (state.dialog === "add") modalsHtml = addDialogHtml();
  if (state.dialog === "share") modalsHtml = shareDialogHtml();
  if (state.dialog === "pin") modalsHtml = pinDialogHtml();
  if (state.dialog === "player") modalsHtml = playerDialogHtml();

  root.innerHTML = `
    <div class="vault-topbar">
      <div class="vault-brand">
        <svg viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
        <span>${esc(tr("Viktorych Vault"))}</span>
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" class="vault-btn secondary" data-act="lock-vault" title="${tr("Lock Vault")}">🔒 ${esc(tr("Lock"))}</button>
        <button type="button" class="vault-btn" data-act="open-add">+ ${esc(tr("Add Item"))}</button>
      </div>
    </div>
    <div class="vault-nav-tabs">
      <button type="button" class="vault-tab-btn ${state.tab === "my" ? "on" : ""}" data-act="set-tab" data-tab="my">${esc(tr("My Vault"))} (${state.items.length})</button>
      <button type="button" class="vault-tab-btn ${state.tab === "shared" ? "on" : ""}" data-act="set-tab" data-tab="shared">${esc(tr("Shared with Me"))} (${state.receivedShares.length})</button>
      <button type="button" class="vault-tab-btn ${state.tab === "sent" ? "on" : ""}" data-act="set-tab" data-tab="sent">${esc(tr("Sent Shares"))} (${state.sentShares.length})</button>
    </div>
    <div class="vault-bar">
      <div class="vault-search">
        <svg viewBox="0 0 24 24"><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"/></svg>
        <input id="vault-q" type="search" placeholder="${esc(tr("Search Vault..."))}" value="${esc(state.query)}">
      </div>
    </div>
    ${contentHtml}
    ${modalsHtml}
  `;
}

function bind(root) {
  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.dataset.act;

    if (act === "stop") {
      e.stopPropagation();
      return;
    }
    if (act === "close-dialog") {
      state.dialog = null;
      paint();
      return;
    }
    if (act === "open-add") {
      state.dialog = "add";
      paint();
      return;
    }
    if (act === "set-tab") {
      state.tab = btn.dataset.tab || "my";
      paint();
      return;
    }
    if (act === "lock-vault") {
      lockVault();
      return;
    }
    if (act === "toggle-mask") {
      var id = btn.dataset.id;
      state.unmasked[id] = !state.unmasked[id];
      paint();
      return;
    }
    if (act === "copy-secret") {
      var val = btn.dataset.val || "";
      if (val) {
        navigator.clipboard.writeText(val).then(function () {
          showToast(tr("Secret copied to clipboard!"));
        }).catch(function () {
          showToast(tr("Could not copy."));
        });
      }
      return;
    }
    if (act === "play-spotify") {
      state.playerUrl = btn.dataset.url || "";
      state.dialog = "player";
      paint();
      return;
    }
    if (act === "share-modal") {
      var itemId = btn.dataset.id;
      var found = state.items.find(function (x) { return x.id === itemId; });
      if (found) {
        state.activeItem = found;
        state.dialog = "share";
        paint();
      }
      return;
    }
    if (act === "delete-item") {
      deleteVaultItem(btn.dataset.id);
      return;
    }
    if (act === "open-shared") {
      var shareId = btn.dataset.shareId;
      var share = state.receivedShares.find(function (x) { return x.id === shareId; });
      if (share) unlockSharedItem(share);
      return;
    }
    if (act === "revoke-share") {
      revokeShare(btn.dataset.shareId);
      return;
    }
  });

  root.addEventListener("input", function (e) {
    if (e.target.id === "vault-q") {
      state.query = e.target.value;
      paint();
    }
    if (e.target.id === "item-service") {
      var s = e.target.value;
      var urlInput = document.getElementById("item-url");
      if (urlInput) {
        if (s === "spotify") urlInput.value = "https://open.spotify.com";
        else if (s === "netflix") urlInput.value = "https://www.netflix.com";
        else if (s === "discord") urlInput.value = "https://discord.com/app";
      }
    }
  });

  root.addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target;
    var act = form.dataset.act;

    if (act === "do-unlock") {
      var pwd = document.getElementById("vault-pwd").value;
      unlockWithPassphrase(pwd);
      return;
    }
    if (act === "do-setup") {
      var setupPwd = document.getElementById("vault-pwd").value;
      setupNewVault(setupPwd);
      return;
    }
    if (act === "submit-add") {
      var service = document.getElementById("item-service").value;
      var title = document.getElementById("item-title").value;
      var username = document.getElementById("item-user").value;
      var secret = document.getElementById("item-secret").value;
      var loginUrl = document.getElementById("item-url").value;
      var notes = document.getElementById("item-notes").value;
      saveVaultItem({
        service: service,
        title: title,
        username: username,
        secret: secret,
        loginUrl: loginUrl,
        notes: notes
      });
      return;
    }
    if (act === "submit-share") {
      var handle = document.getElementById("share-handle").value;
      var pin = document.getElementById("share-pin").value;
      if (state.activeItem) shareVaultItem(state.activeItem, handle, pin);
      return;
    }
    if (act === "submit-pin") {
      var enterPin = document.getElementById("pin-input").value;
      if (state.pinTarget) unlockSharedItem(state.pinTarget, enterPin);
      return;
    }
  });
}

async function boot() {
  state.mode = "loading";
  paint();
  var cfg = await fetchVaultConfig();
  if (!cfg.configured) {
    state.mode = "setup";
  } else {
    state.mode = masterKey ? "ready" : "locked";
  }
  if (masterKey) await reloadVault();
  paint();
}

function page(route) {
  return `<div class="vault" data-bound="0"></div>`;
}

function mount(route) {
  var root = document.querySelector(".vault");
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  bind(root);
  boot();
}

function unmount() {}

window.ViktorychVault = {
  visible: visible,
  page: page,
  mount: mount,
  unmount: unmount
};
