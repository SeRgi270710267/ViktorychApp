/* Passkey sign-up, sign-in, and the Security settings list.
   The Worker checks the signature. This file only talks to the authenticator. */
import { credentialToJSON, hydrateCreation, hydrateRequest } from "./shared/webauthn.js";

function tr(key, vars) {
  return window.t ? window.t(key, vars) : key;
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function supported() {
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && window.isSecureContext);
}

function accounts() {
  return window.ViktorychAccounts || null;
}

function call(path, opts) {
  const api = accounts();
  if (!api || !api.call) return Promise.reject(new Error("api"));
  const token = api.token ? api.token() : "";
  const next = Object.assign({}, opts || {});
  if (token && !next.token) next.token = token;
  return api.call(path, next);
}

function render() {
  const api = accounts();
  if (api && api.requestRender) api.requestRender();
}

let listed = null;
let listing = false;
let pendingRemove = "";
let conditional = null;
let conditionalChallenge = "";

function stopConditional() {
  if (!conditional) return;
  try { conditional.abort(); } catch (err) { /* the prompt is already gone */ }
  conditional = null;
}

async function ceremony(kind, publicKey, mediation) {
  const options = kind === "create" ? hydrateCreation(publicKey) : hydrateRequest(publicKey);
  const run = function (withHints) {
    if (!withHints) delete options.hints;
    if (kind === "create") {
      const created = { publicKey: options };
      if (mediation) created.mediation = mediation;
      return navigator.credentials.create(created);
    }
    const request = { publicKey: options };
    if (mediation) request.mediation = mediation;
    if (conditional && mediation !== "conditional") stopConditional();
    return navigator.credentials.get(request);
  };
  try {
    return await run(true);
  } catch (err) {
    if (!publicKey.hints || (err && err.name === "NotAllowedError")) throw err;
    return run(false);
  }
}

async function createPasskey(publicKey, mediation) {
  return credentialToJSON(await ceremony("create", publicKey, mediation));
}

let conditionalCreateToken = "";

function armConditionalCreate(token) {
  if (!token || !supported() || !window.PublicKeyCredential.getClientCapabilities) return;
  if (conditionalCreateToken === token) return;
  conditionalCreateToken = token;
  window.PublicKeyCredential.getClientCapabilities().then(function (caps) {
    if (!caps || !caps.conditionalCreate) return null;
    return call("/v1/webauthn/register/options", { method: "POST", token: token, body: {} });
  }).then(function (res) {
    if (!res || res.status !== 200 || !res.publicKey) return null;
    return createPasskey(res.publicKey, "conditional").then(function (credential) {
      return call("/v1/webauthn/register/verify", {
        method: "POST",
        token: token,
        body: { challengeId: res.challengeId, credential: credential, label: tr("This device") }
      });
    });
  }).catch(function () { conditionalCreateToken = ""; });
}

async function getPasskey(publicKey, mediation) {
  return credentialToJSON(await ceremony("get", publicKey, mediation));
}

function armConditional(onCredential) {
  if (!supported() || !window.PublicKeyCredential.isConditionalMediationAvailable || conditional) return;
  conditional = { abort: function () {} };
  window.PublicKeyCredential.isConditionalMediationAvailable().then(function (ok) {
    if (!ok) {
      conditional = null;
      return;
    }
    const api = accounts();
    if (!api || !api.call) {
      conditional = null;
      return;
    }
    conditional = new AbortController();
    const signal = conditional.signal;
    api.call("/v1/webauthn/login/options", { method: "POST", body: {} }).then(function (res) {
      if (!res || res.status !== 200 || signal.aborted) return null;
      conditionalChallenge = res.challengeId || "";
      const publicKey = hydrateRequest(res.publicKey);
      delete publicKey.hints;
      return navigator.credentials.get({ mediation: "conditional", publicKey: publicKey, signal: signal });
    }).then(function (cred) {
      conditional = null;
      if (!cred) return null;
      return credentialToJSON(cred);
    }).then(function (json) {
      if (json && onCredential) onCredential(json, conditionalChallenge);
    }).catch(function () {
      conditional = null;
    });
  }).catch(function () { conditional = null; });
}

function loadList() {
  const api = accounts();
  if (!api || !api.token || !api.token() || listing) return;
  listing = true;
  call("/v1/webauthn/credentials").then(function (res) {
    listing = false;
    listed = res && res.status === 200 && Array.isArray(res.credentials) ? res.credentials : [];
    render();
  }).catch(function () {
    listing = false;
    listed = [];
    render();
  });
}

function whenText(ms) {
  const n = Number(ms) || 0;
  if (!n) return "";
  try { return new Date(n).toLocaleDateString(); }
  catch (err) { return ""; }
}

function settingsHtml() {
  const api = accounts();
  const session = api && api.account && api.account();
  if (!session) {
    return "<h2>" + esc(tr("Passkeys")) + "</h2><p class=\"phandle\">" + esc(tr("Sign in to add a passkey to this account.")) + "</p>";
  }
  if (!supported()) {
    return "<h2>" + esc(tr("Passkeys")) + "</h2><p class=\"phandle\">" + esc(tr("Passkeys are not available in this browser.")) + "</p>";
  }
  if (!listed && !listing) loadList();
  const rows = (listed || []).map(function (row) {
    const added = whenText(row.createdAt);
    const used = whenText(row.lastUsedAt);
    const confirm = pendingRemove === row.id;
    return '<div class="mute-row"><span><b>' + esc(row.label || tr("This device")) + "</b><span class=\"set-sub\">" +
      esc(added ? tr("Added {date}", { date: added }) : tr("This device")) +
      (used ? " · " + esc(tr("Last used {date}", { date: used })) : "") +
      "</span></span>" +
      (confirm
        ? '<button class="outline" type="button" data-sec="remove-passkey" data-id="' + esc(row.id) + '">' + esc(tr("Remove")) + '</button>'
        : '<button class="outline" type="button" data-sec="ask-remove" data-id="' + esc(row.id) + '">' + esc(tr("Remove this passkey?")) + "</button>") +
      "</div>";
  }).join("");
  return "<h2>" + esc(tr("Passkeys")) + "</h2><p class=\"phandle\">" + esc(tr("A passkey uses this device's fingerprint, face, or screen lock. No password is required. The account number still works as an optional backup.")) + "</p><p class=\"phandle\">" + esc(tr("Passkeys stay on the site where you created them. A passkey made on one site does not sign in on the other.")) + "</p><p class=\"phandle\">" + esc(tr("Choose a phone or tablet when you want a QR code for cross-device sign-in.")) + "</p>" +
    (rows || "<p class=\"phandle\">" + esc(tr("No passkeys on this site yet.")) + "</p>") +
    '<button class="outline" type="button" data-sec="add-passkey">' + esc(tr("Add a passkey")) + "</button>";
}

function addPasskey() {
  return call("/v1/webauthn/register/options", { method: "POST", body: {} }).then(function (res) {
    if (!res || res.status !== 200 || !res.publicKey) throw new Error((res && res.error) || "passkey_failed");
    return createPasskey(res.publicKey).then(function (credential) {
      return call("/v1/webauthn/register/verify", { method: "POST", body: { challengeId: res.challengeId, credential: credential, label: tr("This device") } });
    });
  }).then(function (res) {
    if (!res || res.status !== 200) throw new Error((res && res.error) || "passkey_failed");
    listed = null;
    render();
  });
}

function removePasskey(id) {
  return call("/v1/webauthn/credentials", { method: "DELETE", body: { credentialId: id } }).then(function () {
    pendingRemove = "";
    listed = null;
    render();
  });
}

document.addEventListener("click", function (event) {
  const node = event.target && event.target.closest ? event.target.closest("[data-sec]") : null;
  if (!node) return;
  const act = node.getAttribute("data-sec");
  if (act !== "add-passkey" && act !== "ask-remove" && act !== "remove-passkey") return;
  event.preventDefault();
  event.stopPropagation();
  if (act === "ask-remove") {
    pendingRemove = node.getAttribute("data-id") || "";
    render();
    return;
  }
  if (act === "remove-passkey") {
    removePasskey(node.getAttribute("data-id") || "");
    return;
  }
  addPasskey().catch(function () { render(); });
}, true);

window.ViktorychPasskeys = {
  supported: supported,
  create: createPasskey,
  get: getPasskey,
  armConditional: armConditional,
  armConditionalCreate: armConditionalCreate,
  stopConditional: stopConditional,
  settingsHtml: settingsHtml,
  reload: function () { listed = null; render(); }
};
