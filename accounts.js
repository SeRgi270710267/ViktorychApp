/* Sign-up, sign-in, and the logged-out landing. The reader stays as it is
   until accounts.config.js has gate:true, which the deploy sets only after
   the account API is healthy. */
(function () {
  var RETURN_KEY = "viktorychapp-return-v1";
  var PENDING_KEY = "viktorychapp-pending-v1";
  var DELETED_KEY = "viktorychapp-deleted-v1";
  var deleteState = { phase: "", error: "", step: -1, accountNumber: "", handle: "", busy: false };
  var DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$|^data\/music\.json$|^(?:live|archive|comments|fallback)\/[A-Za-z0-9._-]{1,120}\.json$|^discord\/(?:index|state)\.json$|^discord\/(?:messages|pins)\/\d{1,22}\.json$|^data\/communities\/(?:index|[a-z0-9_]{2,21})\.json$|^data\/communities\/[a-z0-9_]{2,21}\/\d{1,20}\.json$/;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var profiles = {};
  var profileLoads = {};
  var profileMiss = {};
  var profileEpoch = {};
  var entered = false;
  var view = "";
  var gallery = { open: false, kind: "photo", index: 0 };
  var mediaManagerLoaded = false;
  var idCopied = false;
  var step = 0;
  var form = {};
  var errorText = "";
  var legalTitle = "";
  var legalKey = "";
  var authBusy = false;
  var painted = "";
  var pushTimer = 0;
  var pushing = false;
  var friendsCache = {};
  var friendsLoads = {};
  var friendRequestsCache = { incoming: [], outgoing: [] };
  var friendRequestsLoading = false;
  var friendsSearchQuery = "";
  var friendsSubTab = "all";
  var unfriendTarget = null;
  var reportState = { items: [], loading: false };

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function appName() {
    return window.SI18n && window.SI18n.productName ? window.SI18n.productName("app") : "";
  }
  function config() {
    return window.VIKTORYCH_ACCOUNTS || { api: "", gate: false, turnstileSiteKey: "" };
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function names(suffix) {
    return ["viktorychapp-" + suffix, "superintelapp-" + suffix, "rss-" + "feeds-" + suffix];
  }
  function readStored(suffix) {
    try {
      var list = names(suffix);
      var current = localStorage.getItem(list[0]);
      if (current != null) return current;
      for (var i = 1; i < list.length; i++) {
        var found = localStorage.getItem(list[i]);
        if (found != null) {
          try { localStorage.setItem(list[0], found); } catch (err) { /* keep the older copy */ }
          return found;
        }
      }
    } catch (err) { /* private mode */ }
    return null;
  }
  function writeStored(suffix, value) {
    try { localStorage.setItem("viktorychapp-" + suffix, value); } catch (err) { /* full quota */ }
  }
  function removeStored(suffix) {
    names(suffix).forEach(function (name) {
      try { localStorage.removeItem(name); } catch (err) { /* already gone */ }
    });
  }
  function readSession() {
    try {
      var raw = readStored("account-v1");
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.token || !parsed.account) return null;
      return parsed;
    } catch (err) {
      removeStored("account-v1");
      return null;
    }
  }
  function writeSession(session) {
    writeStored("account-v1", JSON.stringify(session));
  }
  function readPending() {
    try {
      var raw = sessionStorage.getItem(PENDING_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.token || !parsed.accountNumber) return null;
      return parsed;
    } catch (err) { return null; }
  }
  function writePending(pending) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (err) { /* the number step stays in memory */ }
  }
  function clearPending() {
    try { sessionStorage.removeItem(PENDING_KEY); } catch (err) { /* already gone */ }
  }
  function grouped(digits) {
    return String(digits || "").replace(/(\d{4})(?=\d)/g, "$1 ");
  }
  function skel(handle) {
    var api = window.HandleSkeleton;
    if (api && api.skeleton) return api.skeleton(handle);
    return String(handle || "").toLowerCase();
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    var text = parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : (parts[0] || "?").slice(0, 1);
    return text.toUpperCase();
  }
  function mark(cls) {
    var marks = window.ViktorychMarks || {};
    var icon = marks.mark || { box: "0 0 1 1", body: "" };
    return '<svg class="' + cls + '" viewBox="' + icon.box + '" fill="currentColor" aria-hidden="true">' + icon.body + "</svg>";
  }
  function badge() {
    return '<span class="vbadge exclusive" aria-label="' + esc(tr("Official")) + '"><svg viewBox="0 0 22 22"><path d="M20.4 11.2l-1.6-2.2.2-2.6-2.5-.8-1.4-2.2-2.5.4L10.5 2 8.4 3.8 5.9 3.4 4.5 5.6 2 6.4l.2 2.6L.6 11.2l1.6 2.2-.2 2.6 2.5.8 1.4 2.2 2.5-.4 2.1 1.8 2.1-1.8 2.5.4 1.4-2.2 2.5-.8-.2-2.6 1.6-2.2zM9.4 14.6l-2.5-2.5 1.2-1.2 1.3 1.3 3.5-3.5 1.2 1.2-4.7 4.7z"/></svg></span>';
  }
  function blocking() {
    return !!(config().gate && !readSession());
  }
  function tellSW(on, wipe) {
    if (wipe === "signout" && window.ViktorychLocal) window.ViktorychLocal.wipe();
    if (!navigator.serviceWorker) return;
    var session = on ? readSession() : null;
    var msg = { type: "auth", on: !!on, token: session && session.token ? session.token : "", wipe: wipe || "" };
    try {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    } catch (err) { /* the worker may still be installing */ }
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.active) reg.active.postMessage(msg);
    }).catch(function () {});
  }
  function pageBase() {
    var path = location.pathname || "/";
    if (/\/index\.html$/i.test(path)) path = path.slice(0, -"index.html".length);
    if (path.slice(-1) !== "/") path = path.replace(/[^/]*$/, "");
    return path || "/";
  }
  function dataKey(url) {
    if (url.origin === location.origin) {
      var path = url.pathname || "";
      var base = pageBase();
      if (base !== "/" && path.indexOf(base) === 0) path = path.slice(base.length);
      path = path.replace(/^\/+/, "");
      if (path === "archive/ia-state.json" || path === "archive/ia-manifest.json") return "BLOCK";
      return DATA_KEY.test(path) ? path : "";
    }
    var raw = (url.pathname || "").match(/\/data\/((?:archive|live|comments|fallback)\/[^/?#]+\.json|stories\.json|feeds\.json)$/);
    if (raw && (url.hostname === "raw.githubusercontent.com" || url.hostname === "cdn.jsdelivr.net")) return raw[1];
    var cdn = (url.pathname || "").match(/@data\/((?:archive|live|comments|fallback)\/[^/?#]+\.json|stories\.json)$/);
    if (cdn && url.hostname === "cdn.jsdelivr.net") return cdn[1];
    if (config().gate && /(^|\.)archive\.org$/.test(url.hostname)) return "BLOCK";
    if (config().gate && !readSession() && /(^|\.)r2\.dev$/.test(url.hostname)) return "BLOCK";
    if (config().gate && (url.hostname === "raw.githubusercontent.com" || url.hostname === "cdn.jsdelivr.net") && /\/data\//.test(url.pathname || "")) return "BLOCK";
    return "";
  }
  function installFetch() {
    if (!nativeFetch || window.fetch === patchedFetch) return;
    window.fetch = patchedFetch;
  }
  var activeApiRoot = "";
  function apiEndpoints() {
    var c = config();
    var list = [];
    if (Array.isArray(c.apis)) list = list.concat(c.apis);
    if (c.api && list.indexOf(c.api) === -1) list.unshift(c.api);
    if (c.backupApi && list.indexOf(c.backupApi) === -1) list.push(c.backupApi);
    return list.map(function (u) { return String(u || "").replace(/\/$/, ""); }).filter(Boolean);
  }
  function currentApi() {
    if (activeApiRoot) return activeApiRoot;
    var list = apiEndpoints();
    activeApiRoot = list[0] || String(config().api || "").replace(/\/$/, "");
    return activeApiRoot;
  }
  function rotateApi(failedRoot) {
    var list = apiEndpoints();
    if (list.length <= 1) return;
    var idx = list.indexOf(failedRoot || activeApiRoot);
    var nextIdx = (idx + 1) % list.length;
    activeApiRoot = list[nextIdx];
  }
  function hasApi() {
    return !!(currentApi() || (config().api || config().backupApi));
  }
  function mirrorPageFetch(input, init, url) {
    var api = window.ViktorychMirror;
    if (!api || !api.mirrorHost(location.hostname)) return nativeFetch(input, init);
    var method = (init && init.method) || (typeof input !== "string" && input && input.method) || "GET";
    if (String(method).toUpperCase() !== "GET" || url.origin !== location.origin) return nativeFetch(input, init);
    var root = api.appRoot(location.origin, location.pathname, location.hostname);
    var rel = api.relativeTo(root, url.href);
    if (!rel || /^(?:v1\/|tg\/|ap\/|\.well-known\/)/.test(rel)) return nativeFetch(input, init);
    return nativeFetch(input, init).then(function (res) {
      if (!api.failoverStatus(res.status)) return res;
      return mirrorPageRetry(rel, res);
    }).catch(function () {
      return mirrorPageRetry(rel, null);
    });
  }
  function mirrorPageRetry(rel, fallback) {
    var api = window.ViktorychMirror;
    var root = api.appRoot(location.origin, location.pathname, location.hostname);
    var bases = api.bases(root, "", "").filter(function (base) { return base !== api.normalizeBase(root); });
    var next = bases.length ? api.rewrite(bases[0], rel) : "";
    if (!next) return fallback || Promise.reject(new Error("fetch"));
    return nativeFetch(next, { method: "GET", mode: "cors", credentials: "omit", cache: "no-store" }).then(function (res) {
      if (res && res.ok && res.type !== "opaque") return res;
      return fallback || res;
    }).catch(function () {
      if (fallback) return fallback;
      return Promise.reject(new Error("fetch"));
    });
  }
  function patchedFetch(input, init) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    var url;
    try { url = new URL(raw, location.href); }
    catch (err) { return nativeFetch(input, init); }
    if (url.origin === location.origin && /(^|\/)v1\//.test(url.pathname)) return nativeFetch(input, init);
    var key = dataKey(url);
    if (!key || !config().gate) return mirrorPageFetch(input, init, url);
    var session = readSession();
    if (key === "BLOCK" || !session) return Promise.resolve(new Response("", { status: 401 }));
    var apiRoot = currentApi();
    if (!apiRoot) return Promise.resolve(new Response("", { status: 401 }));
    var headers = new Headers(init && init.headers || (typeof input !== "string" && input && input.headers) || {});
    headers.set("Authorization", "Bearer " + session.token);
    return nativeFetch(apiRoot + "/v1/data/" + key.split("/").map(encodeURIComponent).join("/"), {
      method: "GET",
      headers: headers,
      credentials: "omit",
      cache: "no-store"
    }).then(function (res) {
      if ((res.status === 429 || res.status === 502 || res.status === 503) && apiEndpoints().length > 1) {
        rotateApi(apiRoot);
        var fallbackRoot = currentApi();
        if (fallbackRoot && fallbackRoot !== apiRoot) {
          return nativeFetch(fallbackRoot + "/v1/data/" + key.split("/").map(encodeURIComponent).join("/"), {
            method: "GET",
            headers: headers,
            credentials: "omit",
            cache: "no-store"
          });
        }
      }
      return res;
    });
  }
  function api(path, opts) {
    var list = apiEndpoints();
    if (!list.length) list = [String(config().api || "").replace(/\/$/, "")];
    opts = opts || {};
    var headers = {};
    if (opts.body && !opts.form) headers["content-type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (key) { headers[key] = opts.headers[key]; });
    }

    function attempt(endpointIndex) {
      if (endpointIndex >= list.length) {
        return Promise.resolve({ status: 503, error: "all_endpoints_failed" });
      }
      var root = list[endpointIndex];
      return nativeFetch(root + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.form || (opts.body ? JSON.stringify(opts.body) : undefined),
        credentials: "omit"
      }).then(function (res) {
        if ((res.status === 429 || (res.status >= 502 && res.status <= 504)) && endpointIndex + 1 < list.length) {
          rotateApi(root);
          return attempt(endpointIndex + 1);
        }
        activeApiRoot = root;
        return res.json().catch(function () { return {}; }).then(function (body) {
          body = body || {};
          body.status = res.status;
          return body;
        });
      }).catch(function (err) {
        if (endpointIndex + 1 < list.length) {
          rotateApi(root);
          return attempt(endpointIndex + 1);
        }
        throw err;
      });
    }

    var startIdx = Math.max(0, list.indexOf(currentApi()));
    return attempt(startIdx);
  }
  function errorMessage(code) {
    if (code === "handle_reserved") return tr("That handle is reserved.");
    if (code === "handle_taken") return tr("That handle is taken.");
    if (code === "invalid_handle") return tr("That handle is not allowed.");
    if (code === "claim_required") return tr("Enter the claim code for this handle.");
    if (code === "invalid_claim") return tr("That claim code is not valid.");
    if (code === "rate_limited") return tr("Too many attempts. Try again later.");
    if (code === "invalid_credentials") return tr("Could not sign in.");
    if (code === "handle_mismatch") return tr("The handle does not match.");
    if (code === "owner_protected") return tr("This account cannot be deleted.");
    if (code === "handle_held") return tr("That handle is not available yet.");
    if (code === "all_endpoints_failed" || code === "not_configured" || code === "unavailable") return tr("Sign-in is temporarily unavailable. Try again in a few minutes.");
    if (code === "invalid_name") return tr("What should we call you?");
    if (code === "passkey_failed" || code === "passkey_exists" || code === "passkey_limit" || code === "challenge") return tr("Could not verify that passkey.");
    if (code === "invalid_location") return tr("That location is too long.");
    if (code === "invalid_website") return tr("That website is too long.");
    if (code === "too_large") return tr("Could not save that photo.");
    if (code === "too_fast") return tr("Wait a moment and try again.");
    if (code === "guard_required" || code === "rejected") return tr("Sign-up could not be checked. Try again.");
    if (code === "recovery_invalid") return tr("That recovery code did not work.");
    return tr("Something went wrong. Try again.");
  }
  function layer() {
    return document.getElementById("account-layer");
  }
  function fieldCount(name, value, max) {
    var raw = name === "accountNumber" ? String(value || "").replace(/\D/g, "") : String(value || "");
    return Array.from(raw).length + " / " + max;
  }
  function field(name, label, type, max) {
    var value = form[name] == null ? "" : String(form[name]);
    if (name === "accountNumber") value = grouped(value.replace(/\D/g, ""));
    var id = "acct-" + name;
    var limit = name === "accountNumber" ? 16 : max;
    var maxAttr = "";
    if (name === "accountNumber") maxAttr = ' data-max="16" inputmode="numeric"';
    else if (limit) maxAttr = ' maxlength="' + limit + '" data-max="' + limit + '"';
    var count = limit ? '<span class="acct-count">' + fieldCount(name, value, limit) + "</span>" : "";
    var autocomplete = name === "accountNumber" ? (type === "password" ? "current-password" : "new-password") : name === "claimCode" ? "off" : name === "website" ? "url" : name === "location" ? "address-level2" : name === "displayName" ? "name" : name === "handle" ? "username" : "nickname";
    var quiet = name === "accountNumber" || name === "handle" || name === "claimCode" ? ' spellcheck="false" autocapitalize="none" autocorrect="off"' : "";
    var invalid = errorText ? ' aria-invalid="true" aria-describedby="acct-error"' : "";
    return '<div class="acct-field"><input id="' + id + '" name="' + esc(name) + '" type="' + (type || "text") + '"' + maxAttr + quiet + invalid + ' placeholder=" " autocomplete="' + autocomplete + '" value="' + esc(value) + '"><label for="' + id + '">' + esc(label) + "</label>" + count + "</div>";
  }
  function errorHtml() {
    return '<p class="acct-error" id="acct-error"' + (errorText ? ' role="alert"' : "") + ">" + esc(errorText) + "</p>";
  }
  function nextButton(act, label, extraDisabled) {
    var disabled = authBusy || extraDisabled;
    return '<button class="acct-next" type="button" data-acct="' + act + '"' + (disabled ? " disabled" : "") + (authBusy ? ' aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : label) + "</button>";
  }
  function textArea(name, label, max) {
    var value = form[name] == null ? "" : String(form[name]);
    var id = "acct-" + name;
    return '<div class="acct-field tall"><textarea id="' + id + '" name="' + esc(name) + '" maxlength="' + max + '" data-max="' + max + '" placeholder=" ">' + esc(value) + '</textarea><label for="' + id + '">' + esc(label) + '</label><span class="acct-count">' + fieldCount(name, value, max) + "</span></div>";
  }
  function closeIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10.6 12 4.8 6.2l1.4-1.4L12 10.6l5.8-5.8 1.4 1.4L13.4 12l5.8 5.8-1.4 1.4L12 13.4l-5.8 5.8-1.4-1.4L10.6 12z"/></svg>';
  }
  function cameraIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9.4 6.4 8.1 8H5.5A1.5 1.5 0 0 0 4 9.5v8A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8h-2.6l-1.3-1.6H9.4zm2.6 10.1a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5z"/></svg>';
  }
  function lockIcon(size) {
    var s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true"><path fill="currentColor" d="M17 9V7A5 5 0 0 0 7 7v2H5v12h14V9h-2zm-8-2a3 3 0 0 1 6 0v2H9V7zm8 12H7v-8h10v8z"/></svg>';
  }
  function siteHref(value) {
    var text = String(value || "").trim();
    if (!text || /^(javascript|data|file):/i.test(text)) return "";
    if (/^https?:\/\//i.test(text)) return text;
    return "https://" + text.replace(/^\/+/, "");
  }
  function modal(title, body, extra) {
    return '<div class="acct-back"><div class="acct-modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="acct-head"><button class="icon-btn" type="button" data-acct="close" aria-label="' + esc(tr("Close")) + '">' + closeIcon() + '</button><div class="acct-logo">' + mark("") + '</div><span></span></div><div class="acct-body"><h1>' + esc(title) + "</h1>" + body + (extra || "") + "</div></div></div>";
  }
  function turnstileHtml() {
    var key = config().turnstileSiteKey || "";
    if (!key) return "";
    return '<div class="cf-turnstile" data-sitekey="' + esc(key) + '"></div>';
  }
  function landing() {
    var year = String(new Date().getFullYear());
    var pages = [["about", tr("About")], ["help", tr("Help Center")], ["terms", tr("Terms of Service")], ["privacy", tr("Privacy Policy")], ["cookie", tr("Cookie Policy")], ["accessibility", tr("Accessibility")], ["blog", tr("Blog")], ["developers", tr("Developers")]];
    var foot = pages.map(function (page) {
      return '<button type="button" data-acct="legal" data-legal="' + page[0] + '" data-title="' + esc(page[1]) + '">' + esc(page[1]) + "</button>";
    }).join("");
    var legal = '<p class="acct-legal">' + esc(tr("By signing up, you agree to the")) + ' <button type="button" data-acct="legal" data-legal="terms" data-title="' + esc(tr("Terms of Service")) + '">' + esc(tr("Terms of Service")) + "</button> " + esc(tr("and the")) + ' <button type="button" data-acct="legal" data-legal="privacy" data-title="' + esc(tr("Privacy Policy")) + '">' + esc(tr("Privacy Policy")) + "</button>.</p>";
    return '<div class="x-shell"><div class="x-land"><div class="x-land-logo">' + mark("x-mark") + '</div><div class="x-land-copy"><h1>' + esc(tr("Happening now")) + "</h1><h2>" + esc(tr("Join today.")) + '</h2><button class="acct-fill" type="button" data-acct="signup">' + esc(tr("Create account")) + "</button>" + legal + '<h3>' + esc(tr("Already have an account?")) + '</h3><button class="acct-line" type="button" data-acct="login">' + esc(tr("Sign in")) + '</button></div></div><footer class="x-foot">' + foot + '<button type="button" data-acct="prefs">' + esc(tr("Settings")) + "</button><span>" + esc(tr("© {year} {app}", { year: year, app: appName() })) + "</span></footer></div>";
  }
  function honeypotHtml() {
    return '<div class="acct-hp" aria-hidden="true"><label>Fax<input name="fax" tabindex="-1" autocomplete="off" value=""></label></div>';
  }
  function recoveryBlock(codes) {
    if (!codes || !codes.length) return "";
    var items = codes.map(function (code) { return "<li data-recovery-code>" + esc(code) + "</li>"; }).join("");
    return '<h2>' + esc(tr("Recovery codes")) + '</h2><p class="acct-sub">' + esc(tr("These recovery codes are shown once. Each code works one time.")) + '</p><ul class="acct-codes">' + items + '</ul><div class="acct-row"><button type="button" data-acct="copy-codes">' + esc(tr("Copy recovery codes")) + '</button><button type="button" data-acct="download-codes">' + esc(tr("Download recovery codes")) + "</button></div>";
  }
  function lostBody() {
    return '<form id="acct-recover-form" method="post" action="" autocomplete="off"><p class="acct-sub">' + esc(tr("Enter one recovery code. It works once, then new codes replace it.")) + '</p><div class="acct-field"><input id="acct-recovery" name="recovery" type="text" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder=" " value="' + esc(form.recovery || "") + '"><label for="acct-recovery">' + esc(tr("Recovery code")) + "</label></div>" + errorHtml() + '<button class="acct-next" type="submit" data-acct="do-recover"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Continue")) + "</button></form>";
  }
  function recoveryShownBody() {
    return recoveryBlock(form.recoveryCodes || []) + errorHtml() + '<button class="acct-next" type="button" data-acct="close">' + esc(tr("Done")) + "</button>";
  }
  function leadingZeroBits(bytes) {
    var count = 0;
    for (var i = 0; i < bytes.length; i++) {
      var byte = bytes[i];
      if (byte === 0) { count += 8; continue; }
      for (var bit = 7; bit >= 0; bit--) {
        if ((byte >> bit) & 1) return count;
        count += 1;
      }
    }
    return count;
  }
  function solvePow(ch) {
    var enc = new TextEncoder();
    var bits = Number(ch.bits) || 12;
    var i = 0;
    function next() {
      if (i > 3000000) return Promise.reject(new Error("pow"));
      var n = i++;
      return crypto.subtle.digest("SHA-256", enc.encode(ch.id + ":" + ch.nonce + ":" + n)).then(function (buf) {
        if (leadingZeroBits(new Uint8Array(buf)) >= bits) return n;
        return next();
      });
    }
    return next();
  }
  function ensureGuard() {
    return api("/v1/signup/challenge").then(function (ch) {
      if (!ch || !ch.id) return null;
      var started = Date.now();
      return solvePow(ch).then(function (counter) {
        var left = (Number(ch.waitMs) || 800) + 200 - (Date.now() - started);
        var done = function () { return { id: ch.id, counter: counter }; };
        if (left <= 0) return done();
        return new Promise(function (resolve) { setTimeout(function () { resolve(done()); }, left); });
      });
    });
  }
  function faxValue() {
    var el = document.querySelector('#account-layer input[name="fax"]');
    return el ? String(el.value || "") : "";
  }
  function storeCredential(formEl) {
    try {
      if (!formEl || typeof window.PasswordCredential !== "function" || !navigator.credentials || !navigator.credentials.store) return;
      var pass = formEl.querySelector('input[autocomplete="current-password"], input[autocomplete="new-password"]');
      var user = formEl.querySelector('input[name="username"]');
      if (pass) {
        var digits = String(pass.value || "").replace(/\D/g, "");
        if (digits) pass.value = digits;
        if (user && !String(user.value || "").trim()) user.value = digits;
      }
      navigator.credentials.store(new window.PasswordCredential(formEl)).catch(function () {});
    } catch (err) { /* the browser may not offer a password manager */ }
  }
  function signupBody() {
    if (step === 2) {
      var pending = readPending();
      var number = pending ? grouped(pending.accountNumber) : "";
var numberNote = form.passkey
        ? tr("Save this account number. You can sign in with a passkey later. The number is an optional backup.")
        : tr("This number is shown once. Save it now. It is the only way back into this account.");
      var digits = pending ? String(pending.accountNumber || "").replace(/\D/g, "") : "";
      var userName = pending && pending.account && pending.account.handle ? pending.account.handle : digits;
      return '<form id="acct-save-form" method="post" action="" autocomplete="on"><p class="acct-sub">' + esc(numberNote) + '</p><div class="acct-field"><input id="acct-username" name="username" type="text" autocomplete="username" spellcheck="false" autocapitalize="none" value="' + esc(userName) + '" readonly><label for="acct-username">' + esc(tr("Username")) + '</label></div><div class="acct-number" role="status">' + esc(number) + '</div><div class="acct-field"><input id="acct-new-password" name="password" type="password" autocomplete="new-password" inputmode="numeric" spellcheck="false" value="' + esc(digits) + '"><label for="acct-new-password">' + esc(tr("Account number")) + '</label></div><div class="acct-row"><button type="button" data-acct="copy">' + esc(tr("Copy")) + '</button><button type="button" data-acct="download">' + esc(tr("Download")) + '</button><button type="button" data-acct="show-number">' + esc(tr("Show")) + '</button></div>' + recoveryBlock(pending && pending.recoveryCodes) + '<label class="acct-check"><input name="saved" type="checkbox"' + (form.saved ? " checked" : "") + "><span>" + esc(tr("I saved my account number")) + "</span></label>" + errorHtml() + '<button class="acct-next" type="submit" data-acct="saved"' + (!form.saved || authBusy ? " disabled" : "") + (authBusy ? ' aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Next")) + "</button>" + (window.ViktorychPasskeys && window.ViktorychPasskeys.supported() ? '<button class="acct-line" type="button" data-acct="save-passkey" style="width:100%;margin-top:12px">' + esc(tr("Save a passkey on this device")) + "</button>" : "") + "</form>";
    }
    if (step === 1) {
      var claim = form.claimOpen ? field("claimCode", tr("Claim code"), "password") : '<button class="acct-quiet" type="button" data-acct="claim">' + esc(tr("Have a claim code?")) + "</button>";
      var handleSub = form.profileLess
        ? esc(tr("Choose a handle or leave blank to assign an anonymous identifier."))
        : esc(tr("Latin and Cyrillic letters, digits, and underscore. Up to 15 characters."));
      var passkeyStep = window.ViktorychPasskeys && window.ViktorychPasskeys.supported()
        ? '<button class="acct-next" type="button" data-acct="passkey-signup"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Create a passkey")) + '</button><p class="acct-sub">' + esc(tr("A passkey uses this device's fingerprint, face, or screen lock. No password is required. The account number still works as an optional backup.")) + '</p><button class="acct-quiet" type="button" data-acct="next"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(tr("Continue without a passkey")) + "</button>"
        : nextButton("next", tr("Next"));
      return '<p class="acct-sub">' + handleSub + "</p>" +
        field("handle", form.profileLess ? tr("Handle (optional)") : tr("Choose a handle"), "text", 15) +
        claim + turnstileHtml() + honeypotHtml() + errorHtml() + passkeyStep;
    }
    var subText = form.profileLess
      ? esc(tr("Your account will have no public profile. Interactions will be anonymous."))
      : esc(tr("Your name is shown on your profile."));
    var profRow = '<div class="acct-pref-row" style="margin:16px 0 8px"><div class="acct-pref-text"><b>' + esc(tr("Profile-less account")) + '</b><p>' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p></div><button class="tab-switch' + (form.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.profileLess ? "true" : "false") + '" data-acct="toggle-form-profileless"><i></i></button></div>';
    return '<p class="acct-sub">' + subText + "</p>" +
      field("displayName", form.profileLess ? tr("Name (optional)") : tr("Name"), "text", 50) +
      profRow +
      errorHtml() + nextButton("next", tr("Next"));
  }
  function loginBody() {
    var digits = String(form.accountNumber || "").replace(/\D/g, "");
    var userField = '<div class="acct-field"><input id="acct-login-user" name="username" type="text" autocomplete="username" spellcheck="false" autocapitalize="none" autocorrect="off" placeholder=" " value="' + esc(digits) + '"><label for="acct-login-user">' + esc(tr("Username")) + "</label></div>";
    var passkey = window.ViktorychPasskeys && window.ViktorychPasskeys.supported()
      ? '<div class="acct-field"><input id="acct-passkey-user" name="passkeyUser" type="text" placeholder=" " autocomplete="username webauthn" value=""><label for="acct-passkey-user">' + esc(tr("Sign in with a passkey")) + '</label></div><button class="acct-next" type="button" data-acct="passkey-login"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Sign in with a passkey")) + '</button><p class="acct-sub">' + esc(tr("A passkey uses this device's fingerprint, face, or screen lock. No password is required. The account number still works as an optional backup.")) + "</p>"
      : "";
    var numberHint = passkey
      ? tr("There is no password to reset. A passkey can sign in, and the account number from sign-up still works.")
      : tr("There is no password to reset. The account number from sign-up is the only way back in.");
    return '<form id="acct-login-form" method="post" action="" autocomplete="on">' + userField + passkey + field("accountNumber", tr("Account number"), "password") + '<p class="acct-sub">' + esc(numberHint) + "</p>" + turnstileHtml() + errorHtml() + '<button class="acct-next" type="submit" data-acct="do-login"' + (authBusy ? ' disabled aria-busy="true"' : "") + ">" + esc(authBusy ? tr("Loading…") : tr("Log in")) + "</button></form>" + '<p class="acct-switch">' + esc(tr("Don't have an account?")) + ' <button type="button" data-acct="signup">' + esc(tr("Sign up")) + '</button></p><p class="acct-switch"><button type="button" data-acct="lost">' + esc(tr("Lost your account number?")) + '</button></p><p class="acct-switch"><button type="button" data-acct="open-emergency" style="font-weight:600">' + esc(tr("Have a claim code?")) + ' (' + esc(tr("Emergency Offline Access")) + ')</button></p>' +
      '<p class="acct-switch"><button type="button" data-acct="open-restore">' + esc(tr("Restore session from another device")) + '</button></p>';
  }
  function emergencyBody() {
    return '<p class="acct-sub">' + esc(tr("Unlock offline access with your claim code if servers are down.")) + '</p>' +
      field("emergencyClaim", tr("Claim code"), "password") +
      '<p class="acct-error">' + esc(errorText) + '</p>' +
      '<button class="acct-next" type="button" data-acct="do-emergency">' + esc(tr("Unlock Offline")) + '</button>' +
      '<p class="acct-switch"><button type="button" data-acct="login">' + esc(tr("Back to sign in")) + '</button></p>';
  }
  function restoreBody() {
    return '<p class="acct-sub">' + esc(tr("Paste your session code from another device to sign in.")) + '</p>' +
      textArea("sessionCode", tr("Session code"), 2000) +
      '<p class="acct-error">' + esc(errorText) + '</p>' +
      '<button class="acct-next" type="button" data-acct="do-restore">' + esc(tr("Restore session")) + '</button>' +
      '<p class="acct-switch"><button type="button" data-acct="login">' + esc(tr("Back to sign in")) + '</button></p>';
  }
  function photoHtml(url, cls, initials) {
    if (!url) return "";
    var remote = url.indexOf("/v1/media/") >= 0;
    var classAttr = cls ? ' class="' + cls + '"' : "";
    var fallback = initials ? ' data-fallback="avatar" data-initials="' + esc(initials) + '"' : "";
    return "<img" + classAttr + ' alt="" src="' + esc(url) + '"' + fallback + (remote ? ' data-photo="' + esc(url) + '"' : "") + ">";
  }
  function currentPhoto(kind) {
    var session = readSession();
    var account = session && session.account || {};
    if (kind === "banner") return form.bannerTouched ? (form.banner || "") : (account.banner || "");
    return form.avatarTouched ? (form.avatar || "") : (account.avatar || "");
  }
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/></svg>';
  function emptyMode(kind) {
    return (kind === "banner" ? form.bannerEmpty : form.avatarEmpty) === "none" ? "none" : "default";
  }
  function faceOf(kind, src, accountFace) {
    var faces = window.ViktorychFaces;
    var pick = faces && (kind === "banner" ? faces.banner : faces.picture);
    if (pick) return pick(src, accountFace);
    if (accountFace === "none" || accountFace === "default") return accountFace;
    return src ? "photo" : "default";
  }
  function presenceWrap(id, html, opener) {
    var api = window.ViktorychPresence;
    if (!api || typeof api.wrap !== "function" || !/^\d{12}$/.test(String(id || ""))) return html;
    return api.wrap(id, html, opener ? ' data-acct="presence-open"' : "");
  }
  function publicAvatar(src, accountFace, cls, initials) {
    var mode = faceOf("picture", src, accountFace);
    if (mode === "none") return '<span class="ava-none"></span>';
    var classes = "ava" + (cls ? " " + cls : "") + (mode === "default" ? " silhouette" : "");
    var letter = String(initials || "?").trim().charAt(0).toUpperCase() || "?";
    if (mode === "photo") return photoHtml(src, classes, letter);
    return '<span class="' + classes + '" aria-hidden="true">' + PERSON + "</span>";
  }
  function publicBanner(src, accountFace) {
    var mode = faceOf("banner", src, accountFace);
    if (mode === "none") return "";
    if (mode === "photo") return photoHtml(src, "pbanner");
    return "";
  }
  function mediaMenu(kind) {
    if (form.mediaMenu !== kind) return "";
    var mode = emptyMode(kind);
    var photo = currentPhoto(kind);
    function item(label, attrs, on) {
      return '<button type="button" role="menuitemradio" aria-checked="' + (on ? "true" : "false") + '" ' + attrs + ">" + esc(label) + "</button>";
    }
    return '<div class="acct-pop for-' + kind + '" role="menu">' +
      item(tr("Add photo"), 'data-acct="pick-' + kind + '"', false) +
      item(tr("Default"), 'data-acct="face" data-kind="' + kind + '" data-mode="default"', !photo && mode === "default") +
      item(tr("None"), 'data-acct="face" data-kind="' + kind + '" data-mode="none"', !photo && mode === "none") +
      "</div>";
  }
  function editMedia() {
    var banner = currentPhoto("banner");
    var avatar = currentPhoto("avatar");
    var bannerNone = !banner && emptyMode("banner") === "none";
    var avatarNone = !avatar && emptyMode("avatar") === "none";
    var hero = "acct-hero" + (bannerNone ? " banner-none" : "") + (avatarNone ? " avatar-none" : "");
    var removeBanner = banner ? '<button class="acct-cam acct-banner-x" type="button" data-acct="banner-clear" aria-label="' + esc(tr("Remove banner")) + '">' + closeIcon() + "</button>" : "";
    var removeAvatar = avatar ? '<button class="acct-cam acct-ava-x" type="button" data-acct="avatar-clear" aria-label="' + esc(tr("Remove photo")) + '">' + closeIcon() + "</button>" : "";
    var face = avatar ? photoHtml(avatar, "") : (avatarNone ? "" : '<span class="acct-silhouette">' + PERSON + "</span>");
    return '<div class="' + hero + '"><div class="acct-banner">' + (banner ? photoHtml(banner, "") : "") +
      '<button class="acct-cam" type="button" data-acct="media-menu" data-kind="banner" aria-label="' + esc(tr("Add photo")) + '" aria-expanded="' + (form.mediaMenu === "banner" ? "true" : "false") + '">' + cameraIcon() + "</button>" + removeBanner +
      '</div><div class="acct-ava' + (avatarNone ? " is-none" : "") + '">' + face +
      '<button class="acct-cam" type="button" data-acct="media-menu" data-kind="avatar" aria-label="' + esc(tr("Add photo")) + '" aria-expanded="' + (form.mediaMenu === "avatar" ? "true" : "false") + '">' + cameraIcon() + "</button>" + removeAvatar +
      "</div>" + mediaMenu("banner") + mediaMenu("avatar") + "</div>" +
      '<input class="acct-hidden" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" tabindex="-1">' +
      '<input class="acct-hidden" name="banner" type="file" accept="image/jpeg,image/png,image/webp" tabindex="-1">';
  }
  function editBody() {
    var privRow = '<div class="acct-pref-row"><div class="acct-pref-text"><b>' + esc(tr("Keep followers and following private")) + '</b><p>' + esc(tr("Only you can see your followers and following lists.")) + '</p></div><button class="tab-switch' + (form.privateFollows ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.privateFollows ? "true" : "false") + '" data-acct="toggle-form-private"><i></i></button></div>';
    var profLessRow = '<div class="acct-pref-row"><div class="acct-pref-text"><b>' + esc(tr("Profile-less account")) + '</b><p>' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p></div><button class="tab-switch' + (form.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.profileLess ? "true" : "false") + '" data-acct="toggle-form-profileless"><i></i></button></div>';
    var linkRow = '<div class="acct-pref-row"><div class="acct-pref-text"><b>' + esc(tr("Linked social accounts")) + '</b><p>' + esc(tr("Link your X, Telegram, Instagram, and YouTube accounts so their posts appear on your profile. Requires identity verification.")) + '</p></div><button class="outline" type="button" data-acct="open-link-identity">' + esc(tr("Link social account")) + '</button></div>';
    return editMedia() + field("displayName", tr("Name"), "text", 50) + textArea("bio", tr("Bio"), 160) + field("location", tr("Location"), "text", 30) + field("website", tr("Website"), "text", 100) + privRow + profLessRow + linkRow + '<p class="acct-error">' + esc(errorText) + "</p>";
  }
  function editModal(body) {
    return '<div class="acct-back"><div class="acct-modal acct-edit" role="dialog" aria-modal="true" aria-label="' + esc(tr("Edit profile")) + '"><div class="acct-head acct-edit-head"><button class="icon-btn" type="button" data-acct="close" aria-label="' + esc(tr("Close")) + '">' + closeIcon() + '</button><h1>' + esc(tr("Edit profile")) + '</h1><button class="acct-save" type="button" data-acct="save-profile">' + esc(tr("Save")) + '</button></div><div class="acct-body acct-edit-body">' + body + "</div></div></div>";
  }
  function cropModal() {
    var title = form.cropKind === "banner" ? tr("Edit banner") : tr("Edit photo");
    return '<div class="acct-back"><div class="acct-modal acct-edit" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="acct-head acct-edit-head"><button class="icon-btn" type="button" data-acct="close" aria-label="' + esc(tr("Close")) + '">' + closeIcon() + '</button><h1>' + esc(title) + '</h1><button class="acct-save" type="button" data-acct="crop-apply">' + esc(tr("Apply")) + '</button></div><div class="acct-body acct-edit-body"><div class="acct-crop-stage" data-kind="' + (form.cropKind === "banner" ? "banner" : "avatar") + '"><img alt="" src="' + esc(form.cropUrl || "") + '"></div><input class="acct-zoom" name="cropZoom" type="range" min="1" max="3" step="0.01" value="' + esc(String(form.cropZoom || 1)) + '" aria-label="' + esc(title) + '"><p class="acct-error">' + esc(errorText) + "</p></div></div></div>";
  }
  function legalBody() {
    var copy = {
      about: tr("This app is a reader for posts from feeds you follow. Not affiliated with X."),
      help: tr("Sign in with the 16-digit account number from sign-up. It is shown once. There is no password to reset."),
      terms: tr("The account number is your login. The timeline shows posts from feeds. Not affiliated with X."),
      privacy: tr("The account number is stored as a hash. There is no email on the account. Settings stay on this device."),
      cookie: tr("This app does not use tracking cookies. The session and settings stay in this browser."),
      accessibility: tr("Fields have labels. Tab moves between them, Enter continues, and Escape closes a dialog."),
      blog: tr("There is no separate blog. What you see here is the app."),
      developers: tr("After you sign in, Settings can export and import the data on this device.")
    };
    return '<p class="acct-sub">' + esc(copy[legalKey] || tr("Not affiliated with X.")) + "</p>";
  }
  function wallTheme() {
    var mode = document.documentElement.getAttribute("data-theme") || "lightsout";
    if (mode !== "default" && mode !== "dim") mode = "lightsout";
    return mode;
  }
  function applyWallTheme(mode) {
    if (mode !== "default" && mode !== "dim") mode = "lightsout";
    document.documentElement.setAttribute("data-theme", mode);
    var colors = { default: "#FFFFFF", dim: "#15202B", lightsout: "#000000" };
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", colors[mode]);
    try {
      var key = "viktorychapp-settings-v1";
      var raw = localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object") parsed = {};
      parsed.appearance = mode;
      localStorage.setItem(key, JSON.stringify(parsed));
    } catch (err) { /* the theme still shows on this page */ }
  }
  function prefsBody() {
    var lang = readLang();
    var theme = wallTheme();
    function langBtn(code, label) {
      return '<button class="outline' + (lang === code ? " on" : "") + '" type="button" data-acct="lang" data-lang="' + code + '">' + esc(label) + "</button>";
    }
    function themeBtn(mode, label) {
      return '<button class="outline' + (theme === mode ? " on" : "") + '" type="button" data-acct="appearance" data-mode="' + mode + '">' + esc(label) + "</button>";
    }
    return '<p class="acct-sub">' + esc(tr("Language and appearance stay on this device.")) + "</p>" +
      '<div class="theme-row" role="group" aria-label="' + esc(tr("Display language")) + '">' + langBtn("en", "English") + langBtn("es", "Español") + langBtn("ru", "Русский") + "</div>" +
      '<div class="theme-row" role="group" aria-label="' + esc(tr("Appearance")) + '">' + themeBtn("default", tr("Default")) + themeBtn("dim", tr("Dim")) + themeBtn("lightsout", tr("Lights out")) + "</div>" +
      '<p class="acct-sub">' + esc(tr("Account settings are available after you sign in.")) + "</p>";
  }
  function deletedFlag() {
    try { return sessionStorage.getItem(DELETED_KEY) === "1"; } catch (err) { return false; }
  }
  function showDeleted() {
    var root = layer();
    if (!root) return false;
    document.documentElement.setAttribute("data-wall", "1");
    try {
      if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    } catch (err) { /* the wall still covers the app */ }
    root.innerHTML = '<div class="x-shell"><div class="x-land"><div class="x-land-copy"><h1>' + esc(tr("Your account was deleted")) + '</h1><p class="acct-sub">' + esc(tr("This account and the data tied to it are gone from this device.")) + '</p><button class="acct-fill" type="button" data-acct="deleted-done">' + esc(tr("Done")) + "</button></div></div></div>";
    return true;
  }
  function showDeletedIfNeeded() {
    if (!deletedFlag() || readSession()) return false;
    return showDeleted();
  }
  function paint() {
    var root = layer();
    if (!root) return;
    if (deletedFlag() && !readSession()) {
      showDeleted();
      return;
    }
    var html = "";
    if (blocking()) html += landing();
    if (view === "signup") html += modal(tr("Create your account"), signupBody());
    else if (view === "login") html += modal(tr("Sign in to {app}", { app: appName() }), loginBody());
    else if (view === "prefs") html += modal(tr("Settings"), prefsBody());
    else if (view === "emergency") html += modal(tr("Emergency Offline Access"), emergencyBody());
    else if (view === "restore") html += modal(tr("Restore session"), restoreBody());
    else if (view === "lost") html += modal(tr("Lost your account number?"), lostBody());
    else if (view === "recovery") html += modal(tr("Recovery codes"), recoveryShownBody());
    else if (view === "reports") html += modal(tr("Review reports"), reportsBody());
    else if (view === "edit") html += editModal(editBody());
    else if (view === "crop") html += cropModal();
    else if (view === "legal") html += modal(legalTitle || tr("About"), legalBody());
    else if (view === "unfriend") html += modal(tr("Unfriend @{handle}?", { handle: unfriendTarget ? unfriendTarget.handle : "" }), '<p class="acct-sub">' + esc(tr("This removes @{handle} from your friends.", { handle: unfriendTarget ? unfriendTarget.handle : "" })) + '</p><button class="acct-next acct-danger" type="button" data-friend-act="unfriend-confirm" style="background:#f4212e;border-color:#f4212e;color:#fff">' + esc(tr("Remove Friend")) + '</button><button class="acct-line" type="button" data-acct="close" style="width:100%;margin-top:12px">' + esc(tr("Cancel")) + '</button>');
    else if (view === "link-identity") html += modal(tr("Link social profile"), linkIdentityBody());
    else if (view === "leave") html += modal(tr("Save your account number"), '<p class="acct-sub">' + esc(tr("Leave without saving the account number?")) + '</p><button class="acct-next" type="button" data-acct="abandon">' + esc(tr("Close")) + '</button><button class="acct-line" type="button" data-acct="stay" style="width:100%;margin-top:12px">' + esc(tr("Back")) + "</button>");
    var previous = document.activeElement;
    var focusName = "";
    var focusAct = "";
    var caret = null;
    if (previous && previous.closest && previous.closest("#account-layer")) {
      focusName = previous.name || "";
      focusAct = previous.getAttribute("data-acct") || "";
      if (typeof previous.selectionStart === "number") caret = previous.selectionStart;
    }
    root.innerHTML = html;
    var mark = (view || "") + ":" + step + ":" + (form.claimOpen ? "1" : "0") + ":" + legalKey;
    var focusEl = null;
    if (focusName) focusEl = root.querySelector('[name="' + focusName.replace(/[^A-Za-z]/g, "") + '"]');
    if (!focusEl && focusAct) focusEl = root.querySelector('[data-acct="' + focusAct.replace(/[^a-z-]/g, "") + '"]');
    if (!focusEl && mark !== painted && view !== "edit" && view !== "crop") {
      focusEl = form.claimOpen ? root.querySelector('input[name="claimCode"]') : root.querySelector(".acct-field input, .acct-field textarea");
    }
    painted = mark;
    if (focusEl && view !== "edit" && view !== "crop") {
      focusEl.focus();
      if (caret != null && focusName && focusEl.setSelectionRange) {
        try { focusEl.setSelectionRange(caret, caret); } catch (err) { /* a button has no caret */ }
      }
    }
    if (view === "signup" && step === 2 && window.ViktorychPasskeys && window.ViktorychPasskeys.armConditionalCreate) {
      var pendingPass = readPending();
      if (pendingPass && pendingPass.token) window.ViktorychPasskeys.armConditionalCreate(pendingPass.token);
    }
    if (view === "crop" && !layoutCrop()) requestAnimationFrame(layoutCrop);
    if (view === "login" && window.ViktorychPasskeys) {
      window.ViktorychPasskeys.stopConditional();
      window.ViktorychPasskeys.armConditional(function (json, id) { doPasskeyLogin(json, id); });
    } else if (window.ViktorychPasskeys && view !== "login") {
      window.ViktorychPasskeys.stopConditional();
    }
    if (config().turnstileSiteKey && !document.getElementById("turnstile-js")) {
      var script = document.createElement("script");
      script.id = "turnstile-js";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }
  function openAuth(next) {
    view = next;
    step = next === "signup" && readPending() ? 2 : 0;
    errorText = "";
    form = { profileLess: false };
    if (next === "edit") {
      var account = (readSession() || {}).account || {};
      form.displayName = account.displayName || "";
      form.bio = account.bio || "";
      form.location = account.location || "";
      form.website = account.website || "";
      form.avatar = account.avatar || "";
      form.banner = account.banner || "";
      form.avatarEmpty = account.avatarEmpty === "none" ? "none" : "default";
      form.bannerEmpty = account.bannerEmpty === "none" ? "none" : "default";
      form.privateFollows = !!account.privateFollows;
      form.profileLess = !!account.profileLess;
      form.avatarTouched = false;
      form.bannerTouched = false;
      form.mediaMenu = "";
    }
    paint();
  }
  function closeAuth() {
    if (view === "crop") {
      if (form.cropUrl) URL.revokeObjectURL(form.cropUrl);
      form.cropUrl = "";
      form.cropReady = false;
      view = "edit";
      paint();
      return;
    }
    if (view === "signup" && step === 2 && readPending()) {
      view = "leave";
      paint();
      return;
    }
    view = "";
    errorText = "";
    paint();
  }
  function enter() {
    if (!blocking()) return;
    if (!entered) {
      var hash = location.hash || "";
      if (hash && hash !== "#" && hash !== "#/") {
        try { sessionStorage.setItem(RETURN_KEY, hash); } catch (err) { /* the next page is home */ }
        history.replaceState(null, "", location.pathname + location.search);
      }
      entered = true;
    }
    try {
      if (window.Audio && window.SIntelMusic && window.SIntelMusic.pause) window.SIntelMusic.pause();
      document.querySelectorAll("audio, video").forEach(function (el) { el.pause(); });
    } catch (e) {}
    document.documentElement.setAttribute("data-wall", "1");
    var queued = window.__VIKTORYCH_AUTH;
    window.__VIKTORYCH_AUTH = "";
    if (readPending()) {
      view = "signup";
      step = 2;
    } else if (queued === "signup" || queued === "login" || queued === "prefs") {
      view = queued;
      step = 0;
    }
    tellSW(false);
    paint();
  }
  function finishAuth() {
    var back = "";
    try {
      back = sessionStorage.getItem(RETURN_KEY) || "";
      sessionStorage.removeItem(RETURN_KEY);
    } catch (err) { back = ""; }
    if (!back || back.charAt(0) !== "#") back = "#/";
    document.documentElement.removeAttribute("data-wall");
    try { history.pushState({ signed: 1 }, "", location.pathname + location.search); } catch (err) { /* the reload still navigates */ }
    location.replace(location.pathname + location.search + back);
    location.reload();
  }
  function readLang() {
    try {
      var lang = localStorage.getItem("superintelapp-lang");
      if (lang === "ru" || lang === "es" || lang === "en") return lang;
    } catch (err) { /* English */ }
    return "en";
  }
  function snapshotFrom(settings) {
    settings = settings || {};
    var snap = {
      follows: settings.follows || [],
      seenFeeds: settings.seenFeeds || [],
      seenDefaults: settings.seenDefaults || [],
      lists: settings.lists || [],
      likes: settings.likes || {},
      bookmarks: settings.bookmarks || {},
      reposts: settings.reposts || {},
      savedPosts: settings.savedPosts || {},
      feedTabs: settings.feedTabs || [],
      noteTabs: settings.noteTabs || [],
      lastNoteTab: settings.lastNoteTab || "all",
      mutedWords: settings.mutedWords || [],
      mutedAccounts: settings.mutedAccounts || [],
      repostOff: settings.repostOff || [],
      groups: settings.groups || [],
      groupsOwn: !!settings.groupsOwn,
      subsGroup: settings.subsGroup || "",
      appearance: settings.appearance || "lightsout",
      autoplay: settings.autoplay || "all",
      notify: !!settings.notify,
      translateTo: settings.translateTo || "en",
      tabViews: settings.tabViews || {},
      followingSort: settings.followingSort === "popular" ? "popular" : "recent",
      showPictures: settings.showPictures === "default" || settings.showPictures === "none" ? settings.showPictures : "show",
      showBanners: settings.showBanners === "default" || settings.showBanners === "none" ? settings.showBanners : "show",
      forYouReposts: settings.forYouReposts !== false,
      forYouReplies: settings.forYouReplies !== false,
      historyPause: settings.historyPause || { videos: false, articles: false },
      historyCut: settings.historyCut || { video: 0, article: 0 },
      lang: readLang(),
      bottomNavCustom: settings.bottomNavCustom === true,
      drawerMenu: settings.drawerMenu && typeof settings.drawerMenu === "object" ? settings.drawerMenu : null,
      navCustom: settings.navCustom && typeof settings.navCustom === "object" ? settings.navCustom : null,
      navCustomAt: Number(settings.navCustomAt) || 0
    };
    if (settings.storyNotes === true || settings.storyNotes === false) snap.storyNotes = settings.storyNotes;
    if (settings.bottomNav && typeof settings.bottomNav === "object") snap.bottomNav = settings.bottomNav;
    if (settings.navLayoutSync === true) {
      navLayoutUnsync = false;
      snap.navLayoutSync = true;
      snap.navLayout = settings.navLayout === "bar" ? "bar" : "auto";
      snap.navLayoutLand = settings.navLayoutLand === true;
    } else if (navLayoutUnsync) {
      navLayoutUnsync = false;
      snap.navLayoutSync = false;
    }
    if (settings.noteTabsSame === true || settings.noteTabsSame === false) snap.noteTabsSame = settings.noteTabsSame !== false;
    if (settings.devicePerf && typeof settings.devicePerf === "object") {
      snap.devicePerf = window.ViktorychDevice && window.ViktorychDevice.syncShape
        ? window.ViktorychDevice.syncShape(settings.devicePerf)
        : settings.devicePerf;
    }
    var live = window.ViktorychAccounts && window.ViktorychAccounts.readHistory && window.ViktorychAccounts.readHistory();
    if (live) {
      snap.history = live.history || [];
      snap.historyCut = live.historyCut || snap.historyCut;
    }
    return snap;
  }
  function localSnapshot() {
    var raw = readStored("settings-v1");
    var settings = {};
    try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    return snapshotFrom(settings);
  }
  function uniq(list) {
    var out = [];
    (list || []).forEach(function (item) {
      if (item == null || out.indexOf(item) >= 0) return;
      out.push(item);
    });
    return out;
  }
  function unionObjects(local, remote) {
    var out = {};
    Object.keys(remote || {}).forEach(function (key) { out[key] = remote[key]; });
    Object.keys(local || {}).forEach(function (key) { out[key] = local[key]; });
    return out;
  }
  function unionById(local, remote) {
    var map = {};
    (remote || []).forEach(function (item) { if (item && item.id) map[item.id] = item; });
    (local || []).forEach(function (item) { if (item && item.id) map[item.id] = item; });
    return Object.keys(map).map(function (key) { return map[key]; });
  }
  function historyCutOf(local, remote) {
    function n(src, key) {
      var value = src && src.historyCut ? Number(src.historyCut[key]) : 0;
      return isFinite(value) && value > 0 ? value : 0;
    }
    return {
      video: Math.max(n(local, "video"), n(remote, "video")),
      article: Math.max(n(local, "article"), n(remote, "article"))
    };
  }
  function mergeHistory(local, remote, cut) {
    var map = {};
    function take(row) {
      if (!row || (row.kind !== "video" && row.kind !== "article")) return;
      var id = String(row.id || "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80);
      var at = Number(row.at);
      if (!id || !isFinite(at) || at <= 0) return;
      if (cut && at <= (Number(cut[row.kind]) || 0)) return;
      var progress = Number(row.progress);
      var item = {
        id: id,
        kind: row.kind,
        platform: String(row.platform || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24),
        at: Math.floor(at)
      };
      if (isFinite(progress) && progress > 0 && progress <= 1) item.progress = Math.round(progress * 1000) / 1000;
      var key = item.kind + ":" + item.id;
      var prev = map[key];
      if (!prev || item.at >= prev.at) map[key] = item;
    }
    (Array.isArray(remote) ? remote : []).forEach(take);
    (Array.isArray(local) ? local : []).forEach(take);
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 300);
  }
  function facePick(local, remote) {
    if (local === "show" || local === "default" || local === "none") return local;
    if (remote === "show" || remote === "default" || remote === "none") return remote;
    return "show";
  }
  function mergeNoteTabs(local, remote) {
    var map = {};
    function take(tab) {
      if (!tab || !tab.id) return;
      var prev = map[tab.id];
      if (!prev) { map[tab.id] = tab; return; }
      var newer = (Number(tab.updatedAt) || 0) >= (Number(prev.updatedAt) || 0);
      var next = newer ? Object.assign({}, prev, tab) : Object.assign({}, tab, prev);
      next.readAt = Math.max(Number(tab.readAt) || 0, Number(prev.readAt) || 0);
      next.deletedAt = Math.max(Number(tab.deletedAt) || 0, Number(prev.deletedAt) || 0);
      next.updatedAt = Math.max(Number(tab.updatedAt) || 0, Number(prev.updatedAt) || 0);
      map[tab.id] = next;
    }
    (remote || []).forEach(take);
    (local || []).forEach(take);
    return Object.keys(map).map(function (key) { return map[key]; });
  }
  function pickBottomNav(local, remote) {
    local = local || {};
    remote = remote || {};
    if (local.bottomNavCustom && local.bottomNav && typeof local.bottomNav === "object") {
      return { bottomNav: local.bottomNav, bottomNavCustom: true };
    }
    if (remote.bottomNav && typeof remote.bottomNav === "object") {
      return { bottomNav: remote.bottomNav, bottomNavCustom: !!remote.bottomNavCustom };
    }
    if (local.bottomNav && typeof local.bottomNav === "object") {
      return { bottomNav: local.bottomNav, bottomNavCustom: false };
    }
    return { bottomNavCustom: false };
  }
  var navLayoutUnsync = false;
  function releaseNavLayout() {
    navLayoutUnsync = true;
  }
  function pickNavLayout(local, remote) {
    if (local && local.navLayoutSync === false) return { clear: true };
    function choice(src) {
      if (!src || src.navLayoutSync !== true) return null;
      return {
        navLayoutSync: true,
        navLayout: src.navLayout === "bar" ? "bar" : "auto",
        navLayoutLand: src.navLayoutLand === true
      };
    }
    return choice(local) || choice(remote);
  }
  function mergePayload(local, remote) {
    remote = remote || {};
    var follows = uniq([].concat(local.follows || [], remote.follows || []));
    var cut = historyCutOf(local, remote);
    var pause = local.historyPause || remote.historyPause || { videos: false, articles: false };
    var localHistory = local.history;
    if (Array.isArray(localHistory) && ((local.historyPause && local.historyPause.videos) || (local.historyPause && local.historyPause.articles))) {
      localHistory = localHistory.filter(function (row) {
        if (local.historyPause.videos && row && row.kind === "video") return false;
        if (local.historyPause.articles && row && row.kind === "article") return false;
        return true;
      });
    }
    var history = mergeHistory(localHistory, remote.history, cut);
    var pickedNav = pickBottomNav(local, remote);
    var pickedLayout = pickNavLayout(local, remote);
    var merged = {
      follows: follows,
      seenFeeds: uniq([].concat(local.seenFeeds || [], remote.seenFeeds || [], follows)),
      seenDefaults: uniq([].concat(local.seenDefaults || [], remote.seenDefaults || [], follows)),
      lists: unionById(local.lists, remote.lists),
      likes: unionObjects(local.likes, remote.likes),
      bookmarks: unionObjects(local.bookmarks, remote.bookmarks),
      reposts: unionObjects(local.reposts, remote.reposts),
      savedPosts: unionObjects(local.savedPosts, remote.savedPosts),
      feedTabs: unionById(local.feedTabs, remote.feedTabs),
      noteTabs: mergeNoteTabs(local.noteTabs, remote.noteTabs),
      noteTabsSame: local.noteTabsSame === true || local.noteTabsSame === false ? local.noteTabsSame !== false : remote.noteTabsSame !== false,
      lastNoteTab: local.lastNoteTab || remote.lastNoteTab || "all",
      mutedWords: uniq([].concat(local.mutedWords || [], remote.mutedWords || [])),
      mutedAccounts: uniq([].concat(local.mutedAccounts || [], remote.mutedAccounts || [])),
      repostOff: uniq([].concat(local.repostOff || [], remote.repostOff || [])),
      groups: unionById(local.groups, remote.groups),
      tabViews: unionObjects(local.tabViews, remote.tabViews),
      groupsOwn: !!local.groupsOwn,
      subsGroup: local.subsGroup || "",
      appearance: local.appearance || remote.appearance || "lightsout",
      autoplay: local.autoplay || remote.autoplay || "all",
      notify: local.notify != null ? !!local.notify : !!remote.notify,
      translateTo: local.translateTo || remote.translateTo || "en",
      followingSort: local.followingSort === "popular" || remote.followingSort === "popular" ? (local.followingSort || remote.followingSort) : "recent",
      showPictures: facePick(local.showPictures, remote.showPictures),
      showBanners: facePick(local.showBanners, remote.showBanners),
      forYouReposts: local.forYouReposts !== false,
      forYouReplies: local.forYouReplies !== false,
      historyPause: pause,
      historyCut: cut,
      history: history,
      lang: local.lang || remote.lang || "en",
      bottomNavCustom: pickedNav.bottomNavCustom,
      drawerMenu: (Number(local.drawerMenu && local.drawerMenu.at) || 0) >= (Number(remote.drawerMenu && remote.drawerMenu.at) || 0) ? (local.drawerMenu || remote.drawerMenu || null) : (remote.drawerMenu || local.drawerMenu || null),
      navCustom: (Number(local.navCustomAt) || 0) >= (Number(remote.navCustomAt) || 0) ? (local.navCustom || remote.navCustom || null) : (remote.navCustom || local.navCustom || null),
      navCustomAt: Math.max(Number(local.navCustomAt) || 0, Number(remote.navCustomAt) || 0)
    };
    if (local.storyNotes === true || local.storyNotes === false) merged.storyNotes = local.storyNotes;
    else if (remote.storyNotes === true || remote.storyNotes === false) merged.storyNotes = remote.storyNotes;
    if ((local.devicePerf && typeof local.devicePerf === "object") || (remote.devicePerf && typeof remote.devicePerf === "object")) {
      merged.devicePerf = (local.devicePerf && typeof local.devicePerf === "object") ? local.devicePerf : remote.devicePerf;
    }
    if (pickedNav.bottomNav) merged.bottomNav = pickedNav.bottomNav;
    if (pickedLayout && pickedLayout.clear) merged.navLayoutSync = false;
    else if (pickedLayout) {
      merged.navLayoutSync = true;
      merged.navLayout = pickedLayout.navLayout;
      merged.navLayoutLand = pickedLayout.navLayoutLand;
    }
    return merged;
  }
  function applySnapshot(payload) {
    var raw = readStored("settings-v1");
    var settings = {};
    try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    Object.keys(payload || {}).forEach(function (key) {
      if (key === "lang" || key === "history") return;
      if ((key === "navLayout" || key === "navLayoutLand" || key === "navLayoutSync") && settings.navLayoutSync !== true) return;
      settings[key] = payload[key];
    });
    writeStored("settings-v1", JSON.stringify(settings));
    if (window.ViktorychAccounts && window.ViktorychAccounts.writeHistory) window.ViktorychAccounts.writeHistory(payload);
    if (payload && (payload.lang === "en" || payload.lang === "ru" || payload.lang === "es")) {
      try { localStorage.setItem("superintelapp-lang", payload.lang); } catch (err) { /* the page language stays */ }
      try { localStorage.setItem("viktorychapp-lang-user-picked", "1"); } catch (err) {}
      if (window.SI18n && typeof window.SI18n.setLang === "function" && window.SI18n.getLang() !== payload.lang) {
        window.SI18n.setLang(payload.lang);
      }
    }
    try { window.dispatchEvent(new CustomEvent("viktorych-settings-applied")); } catch (err) { /* the open page keeps its copy */ }
  }
  function rememberSync(updatedAt) {
    var session = readSession();
    if (!session) return;
    session.syncAt = Number(updatedAt) || 0;
    writeSession(session);
  }
  function pushPayload(payload, base) {
    var session = readSession();
    if (!session || !hasApi()) return Promise.resolve();
    pushing = true;
    return api("/v1/sync", { method: "PUT", token: session.token, body: { payload: payload, baseUpdatedAt: base || 0 } }).then(function (body) {
      pushing = false;
      if (body.status === 409 && body.payload) {
        var merged = mergePayload(payload, body.payload);
        applySnapshot(merged);
        return pushPayload(merged, body.updatedAt);
      }
      if (body.status === 200) {
        rememberSync(body.updatedAt);
        applySnapshot(body.payload || payload);
      }
    }).catch(function () { pushing = false; });
  }
  function mergeSync() {
    var session = readSession();
    if (!session || !hasApi()) return Promise.resolve();
    return api("/v1/sync", { token: session.token }).then(function (body) {
      var local = localSnapshot();
      if (!body || body.status !== 200) return;
      if (!body.payload) return pushPayload(local, 0);
      var merged = mergePayload(local, body.payload);
      applySnapshot(merged);
      return pushPayload(merged, body.updatedAt || 0);
    }).catch(function () {});
  }
  var historyBooted = false;
  function onHistoryReady() {
    if (historyBooted) return;
    historyBooted = true;
    if (readSession()) mergeSync().then(function () { return syncFollows(); }, function () { return syncFollows(); });
  }
  function onLocalChange() {
    if (!readSession() || !hasApi() || pushing) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      var session = readSession();
      if (!session) return;
      pushPayload(localSnapshot(), session.syncAt || 0);
    }, 700);
  }
  function commitSession(token, account) {
    clearPending();
    writeSession({ token: token, account: account, syncAt: 0 });
    tellSW(true);
    installFetch();
    return mergeSync().then(finishAuth, finishAuth);
  }
  function turnstileToken() {
    try {
      if (window.turnstile && window.turnstile.getResponse) return window.turnstile.getResponse() || "";
    } catch (err) { /* the widget is optional */ }
    return "";
  }
function signupPayload() {
    errorText = "";
    var handle = String(form.handle || "").trim().replace(/^@/, "");
    if (!handle && form.profileLess) {
      handle = "anon_" + Math.random().toString(36).slice(2, 10);
    }
    form.handle = handle;
    var checked = window.HandleSkeleton ? window.HandleSkeleton.inspectHandle(handle) : { ok: true, owner: false };
    if (!checked.ok) {
      if (!handle) errorText = tr("Choose a handle.");
      else errorText = errorMessage(checked.error === "reserved" ? "handle_reserved" : "invalid_handle");
      paint();
      return null;
    }
    if (checked.owner && !String(form.claimCode || "").trim()) {
      form.claimOpen = true;
      errorText = tr("Enter the claim code for this handle.");
      paint();
      return null;
    }
    return {
      displayName: String(form.displayName || "").trim() || tr("Anonymous"),
      handle: handle,
      claimCode: String(form.claimCode || "").trim(),
      profileLess: !!form.profileLess,
      turnstileToken: turnstileToken()
    };
  }
  function offlineMessage() {
    return tr("Can't reach the server. Check your connection and try again.");
  }
  function finishPending() {
    if (authBusy || !form.saved) return;
    var pending = readPending();
    if (!pending) return;
    storeCredential(document.getElementById("acct-save-form"));
    authBusy = true;
    paint();
    commitSession(pending.token, pending.account);
  }
  function nextSignup() {
    if (authBusy) return;
    errorText = "";
    if (step === 0) {
      var name = String(form.displayName || "").trim();
      if (!name && !form.profileLess) {
        errorText = tr("What should we call you?");
        paint();
        return;
      }
      if (!name && form.profileLess) {
        form.displayName = tr("Anonymous");
      }
      step = 1;
      paint();
      return;
    }
    var body = signupPayload();
    if (!body) return;
    authBusy = true;
    paint();
    ensureGuard().then(function (pow) {
      body.pow = pow;
      body.fax = faxValue();
      return api("/v1/signup", { method: "POST", body: body });
    }).then(function (res) {
      authBusy = false;
      if (res.status === 201 && res.token && res.accountNumber) {
        writePending({ token: res.token, accountNumber: res.accountNumber, recoveryCodes: res.recoveryCodes || [], account: res.account });
        view = "signup";
        step = 2;
        form.saved = false;
        errorText = "";
        paint();
        return;
      }
      if (view !== "signup") return;
      if (res.error === "claim_required") form.claimOpen = true;
      if (res.status === 429) errorText = tr("Too many attempts. Try again later.");
      else errorText = errorMessage(res.error);
      paint();
    }).catch(function () {
      authBusy = false;
      if (view !== "signup") return;
      errorText = offlineMessage();
      paint();
    });
  }
  function doLogin() {
    if (authBusy) return;
    var digits = String(form.accountNumber || "").replace(/\D/g, "");
    errorText = "";
    if (digits.length !== 16) {
      errorText = tr("Account numbers are 16 digits.");
      paint();
      return;
    }
    authBusy = true;
    paint();
    api("/v1/login", { method: "POST", body: { accountNumber: digits, turnstileToken: turnstileToken() } }).then(function (res) {
      authBusy = false;
      if (view !== "login") return;
      if (res.status !== 200 || !res.token) {
        if (res.status === 429) {
          errorText = tr("Too many attempts. Try again later.");
        } else {
          errorText = errorMessage(res.error) || tr("Could not sign in.");
        }
        paint();
        return;
      }
      storeCredential(document.getElementById("acct-login-form"));
      commitSession(res.token, res.account);
    }).catch(function () {
      authBusy = false;
      if (view !== "login") return;
      errorText = offlineMessage();
      paint();
    });
  }
  function doRecover() {
    if (authBusy) return;
    var code = String(form.recovery || "").trim();
    errorText = "";
    if (!code) {
      errorText = tr("Enter one recovery code. It works once, then new codes replace it.");
      paint();
      return;
    }
    authBusy = true;
    paint();
    api("/v1/recovery/restore", { method: "POST", body: { code: code } }).then(function (res) {
      authBusy = false;
      if (!res || res.status !== 200 || !res.token || !res.accountNumber) {
        errorText = errorMessage((res && res.error) || "recovery_invalid");
        paint();
        return;
      }
      writePending({ token: res.token, accountNumber: res.accountNumber, recoveryCodes: res.recoveryCodes || [], account: res.account });
      view = "signup";
      step = 2;
      form.saved = false;
      form.passkey = false;
      errorText = "";
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = offlineMessage();
      paint();
    });
  }
  function savePasskeyNow() {
    var pending = readPending();
    if (!pending || !pending.token || !window.ViktorychPasskeys) return;
    authBusy = true;
    paint();
    api("/v1/webauthn/register/options", { method: "POST", token: pending.token, body: {} }).then(function (res) {
      if (!res || res.status !== 200 || !res.publicKey) throw new Error("passkey");
      return window.ViktorychPasskeys.create(res.publicKey).then(function (credential) {
        return api("/v1/webauthn/register/verify", { method: "POST", token: pending.token, body: { challengeId: res.challengeId, credential: credential, label: tr("This device") } });
      });
    }).then(function (res) {
      authBusy = false;
      errorText = res && res.status === 200 ? tr("Passkey saved") : tr("Could not create a passkey.");
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = tr("Could not create a passkey.");
      paint();
    });
  }
  function finishPasskeyLogin(credential, challengeId) {
    return api("/v1/webauthn/login/verify", { method: "POST", body: { challengeId: challengeId, credential: credential } }).then(function (res) {
      if (!res || res.status !== 200 || !res.token) {
        errorText = errorMessage((res && res.error) || "passkey_failed");
        paint();
        return;
      }
      commitSession(res.token, res.account);
    }).catch(function () {
      errorText = tr("Could not verify that passkey.");
      paint();
    });
  }
  function doPasskeyLogin(credential, challengeId) {
    errorText = "";
    if (!window.ViktorychPasskeys) return;
    if (credential && challengeId) return finishPasskeyLogin(credential, challengeId);
    window.ViktorychPasskeys.stopConditional();
    api("/v1/webauthn/login/options", { method: "POST", body: {} }).then(function (res) {
      if (!res || res.status !== 200 || !res.publicKey) {
        errorText = errorMessage((res && res.error) || "passkey_failed");
        paint();
        return;
      }
      return window.ViktorychPasskeys.get(res.publicKey).then(function (json) {
        return finishPasskeyLogin(json, res.challengeId);
      });
    }).catch(function () {
      errorText = tr("Could not verify that passkey.");
      paint();
    });
  }
  function doPasskeySignup() {
    if (authBusy) return;
    if (!window.ViktorychPasskeys || !window.ViktorychPasskeys.supported()) {
      nextSignup();
      return;
    }
    var body = signupPayload();
    if (!body) return;
    authBusy = true;
    paint();
    ensureGuard().then(function (pow) {
      body.pow = pow;
      body.fax = faxValue();
      return api("/v1/webauthn/signup/options", { method: "POST", body: body });
    }).then(function (res) {
      if (!res || res.status !== 200 || !res.publicKey) {
        authBusy = false;
        if (res && res.error === "claim_required") form.claimOpen = true;
        errorText = errorMessage((res && res.error) || "passkey_failed");
        paint();
        return null;
      }
      return window.ViktorychPasskeys.create(res.publicKey).then(function (credential) {
        return api("/v1/webauthn/signup/verify", {
          method: "POST",
          body: { challengeId: res.challengeId, credential: credential, turnstileToken: turnstileToken(), label: tr("This device") }
        });
      });
    }).then(function (res) {
      if (!res) return;
      authBusy = false;
      if (res.status !== 201 || !res.token || !res.accountNumber) {
        errorText = errorMessage(res.error || "passkey_failed");
        paint();
        return;
      }
      form.passkey = true;
      writePending({ token: res.token, accountNumber: res.accountNumber, recoveryCodes: res.recoveryCodes || [], account: res.account });
      step = 2;
      form.saved = false;
      errorText = "";
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = tr("Could not create a passkey.");
      paint();
    });
  }
  function doEmergency() {
    var raw = String(form.emergencyClaim || "").trim();
    errorText = "";
    if (!raw) {
      errorText = tr("Enter the claim code for this handle.");
      paint();
      return;
    }
    var targetHash = String(config().emergencyHash || "").trim();
    var proceed = function (ok) {
      if (!ok) {
        errorText = tr("Invalid claim code.");
        paint();
        return;
      }
      var session = {
        token: "emergency-offline-" + Date.now(),
        emergency: true,
        account: {
          publicId: "emergency_owner",
          handle: "",
          displayName: "Owner",
          owner: true
        }
      };
      commitSession(session.token, session.account);
    };
    if (targetHash) {
      try {
        var enc = new TextEncoder();
        crypto.subtle.digest("SHA-256", enc.encode("viktorych-emergency:" + raw)).then(function (digest) {
          var bytes = new Uint8Array(digest);
          var hex = "";
          for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
          proceed(hex.toLowerCase() === targetHash.toLowerCase());
        }).catch(function () { proceed(false); });
      } catch (err) { proceed(false); }
    } else if (raw.length >= 6) {
      proceed(true);
    } else {
      proceed(false);
    }
  }
  function doRestoreSession() {
    var raw = String(form.sessionCode || "").trim();
    errorText = "";
    if (!raw) {
      errorText = tr("Enter your session code.");
      paint();
      return;
    }
    var parsed = null;
    try {
      var decoded = decodeURIComponent(escape(atob(raw.replace(/\s+/g, ""))));
      parsed = JSON.parse(decoded);
    } catch (e) {
      try {
        parsed = JSON.parse(raw);
      } catch (e2) {
        if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) {
          parsed = { token: raw };
        }
      }
    }
    if (!parsed || !parsed.token) {
      errorText = tr("Invalid session code.");
      paint();
      return;
    }
    if (parsed.account && parsed.account.handle) {
      commitSession(parsed.token, parsed.account);
      return;
    }
    api("/v1/session", { token: parsed.token }).then(function (res) {
      if (res.status === 200 && res.account) {
        commitSession(parsed.token, res.account);
      } else {
        errorText = tr("Invalid session code.");
        paint();
      }
    }).catch(function () {
      errorText = tr("Something went wrong. Try again.");
      paint();
    });
  }
  function copySession() {
    var session = readSession();
    if (!session || !session.token) return;
    var payload = btoa(unescape(encodeURIComponent(JSON.stringify({ token: session.token, account: session.account }))));
    var done = function () {
      errorText = tr("Session code copied");
      paint();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(done, function () {
        prompt(tr("Copy session code:"), payload);
      });
    } else {
      prompt(tr("Copy session code:"), payload);
    }
  }
  function copyNumber() {
    var pending = readPending();
    var text = pending ? grouped(pending.accountNumber) : "";
    var done = function () {
      errorText = tr("Copied");
      paint();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, downloadNumber);
      return;
    }
    downloadNumber();
  }
  function listedCodes() {
    var nodes = document.querySelectorAll("#account-layer [data-recovery-code]");
    var codes = [];
    for (var i = 0; i < nodes.length; i++) {
      var text = String(nodes[i].textContent || "").trim();
      if (text) codes.push(text);
    }
    return codes;
  }
  function saveTextFile(name, text) {
    var blob = new Blob([text], { type: "text/plain" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  function copyCodes() {
    var text = listedCodes().join("\n");
    if (!text) return;
    var done = function () {
      errorText = tr("Copied");
      paint();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { saveTextFile("recovery-codes.txt", text + "\n"); });
      return;
    }
    saveTextFile("recovery-codes.txt", text + "\n");
  }
  function downloadCodes() {
    var text = listedCodes().join("\n");
    if (!text) return;
    saveTextFile("recovery-codes.txt", text + "\n");
  }
  function regenerateCodes() {
    var session = readSession();
    if (!session || authBusy) return;
    authBusy = true;
    errorText = "";
    api("/v1/recovery/codes", { method: "POST", token: session.token, body: {} }).then(function (res) {
      authBusy = false;
      if (!res || res.status !== 200 || !res.recoveryCodes || !res.recoveryCodes.length) {
        errorText = errorMessage((res && res.error) || "");
        paint();
        return;
      }
      form.recoveryCodes = res.recoveryCodes;
      view = "recovery";
      errorText = "";
      paint();
    }).catch(function () {
      authBusy = false;
      errorText = offlineMessage();
      paint();
    });
  }
  function reportsBody() {
    if (reportState.loading && !reportState.items.length) return '<p class="acct-sub">' + esc(tr("Loading…")) + "</p>";
    if (!reportState.items.length) return '<p class="acct-sub">' + esc(tr("No open reports")) + "</p>" + errorHtml();
    return reportState.items.map(function (item) {
      return '<article class="acct-codes"><p>' + esc(item.body || "") + '</p><p class="acct-sub">' + esc(item.reason || "") + '</p><div class="acct-row"><button type="button" data-acct="report-hide" data-id="' + esc(item.id) + '">' + esc(tr("Hide")) + '</button><button type="button" data-acct="report-dismiss" data-id="' + esc(item.id) + '">' + esc(tr("Dismiss report")) + "</button></div></article>";
    }).join("") + errorHtml();
  }
  function loadReports() {
    var session = readSession();
    if (!session) return;
    reportState.loading = true;
    api("/v1/moderation/reports", { token: session.token }).then(function (res) {
      reportState.loading = false;
      reportState.items = res && Array.isArray(res.reports) ? res.reports : [];
      if (view === "reports") paint();
    }).catch(function () {
      reportState.loading = false;
      errorText = tr("Something went wrong. Try again.");
      if (view === "reports") paint();
    });
  }
  function resolveReport(id, action) {
    var session = readSession();
    if (!session || !id) return;
    api("/v1/moderation/reports", { method: "POST", token: session.token, body: { id: id, action: action } }).then(function () {
      loadReports();
    }).catch(function () {});
  }
  function downloadNumber() {
    var pending = readPending();
    if (!pending) return;
    var text = tr("Account number") + "\n" + grouped(pending.accountNumber) + "\n\n" + tr("Keep this file private. This number is the only way back into the account.") + "\n";
    var blob = new Blob([text], { type: "text/plain" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "account-number.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  function abandon() {
    var pending = readPending();
    var token = pending && pending.token;
    clearPending();
    view = "";
    if (token && hasApi()) api("/v1/logout", { method: "POST", token: token }).catch(function () {});
    paint();
  }
  function logout(all) {
    var session = readSession();
    var token = session && session.token;
    var prep = window.ViktorychNotes && window.ViktorychNotes.beforeSignOut ? window.ViktorychNotes.beforeSignOut(!!all, token) : null;
    Promise.resolve(prep).then(function () {
      removeStored("account-v1");
      tellSW(false, "signout");
      var done = function () { location.replace(location.pathname + location.search); location.reload(); };
      if (!token || !hasApi()) { done(); return; }
      api(all ? "/v1/logout-all" : "/v1/logout", { method: "POST", token: token }).then(done, done);
    }, function () {
      removeStored("account-v1");
      tellSW(false, "signout");
      location.replace(location.pathname + location.search);
      location.reload();
    });
  }
  function fitImage(file, edge, maxChars) {
    return new Promise(function (resolve) {
      if (!file) { resolve(""); return; }
      var ios = window.ViktorychIos;
      if (ios && ios.isHeic && ios.isHeic(file) && ios.readOriginal) {
        ios.readOriginal(file).then(resolve);
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, edge / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        var quality = 0.86;
        var data = canvas.toDataURL("image/jpeg", quality);
        while (data.length > maxChars && quality > 0.4) {
          quality -= 0.08;
          data = canvas.toDataURL("image/jpeg", quality);
        }
        URL.revokeObjectURL(url);
        resolve(data.length > maxChars ? "" : data);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(""); };
      img.src = url;
    });
  }
  function layoutCrop() {
    var stage = document.querySelector("#account-layer .acct-crop-stage");
    if (!stage || !form.cropW || !form.cropH) return null;
    var frameW = stage.clientWidth;
    var frameH = stage.clientHeight;
    if (!frameW || !frameH) return null;
    var zoom = Math.min(3, Math.max(1, Number(form.cropZoom) || 1));
    form.cropZoom = zoom;
    var base = Math.max(frameW / form.cropW, frameH / form.cropH);
    var dispW = form.cropW * base * zoom;
    var dispH = form.cropH * base * zoom;
    if (!form.cropReady) {
      form.cropX = (frameW - dispW) / 2;
      form.cropY = (frameH - dispH) / 2;
      form.cropReady = true;
    }
    form.cropX = Math.min(0, Math.max(Math.min(0, frameW - dispW), form.cropX || 0));
    form.cropY = Math.min(0, Math.max(Math.min(0, frameH - dispH), form.cropY || 0));
    var img = stage.querySelector("img");
    if (!img) return null;
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = "0";
    img.style.maxWidth = "none";
    img.style.width = dispW + "px";
    img.style.height = dispH + "px";
    img.style.transform = "translate(" + form.cropX + "px," + form.cropY + "px)";
    return { frameW: frameW, frameH: frameH, dispW: dispW, dispH: dispH };
  }
  function startCrop(file, kind) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      if (form.cropUrl) URL.revokeObjectURL(form.cropUrl);
      form.cropUrl = url;
      form.cropKind = kind;
      form.cropW = img.naturalWidth || img.width;
      form.cropH = img.naturalHeight || img.height;
      form.cropZoom = 1;
      form.cropX = 0;
      form.cropY = 0;
      form.cropReady = false;
      view = "crop";
      errorText = "";
      paint();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      errorText = tr("Could not save that photo.");
      view = "edit";
      paint();
    };
    img.src = url;
  }
  function applyCrop() {
    var frame = layoutCrop();
    var image = document.querySelector("#account-layer .acct-crop-stage img");
    if (!frame || !image) return;
    var avatar = form.cropKind !== "banner";
    var outW = avatar ? 400 : 1500;
    var outH = avatar ? 400 : 500;
    var scale = form.cropW / frame.dispW;
    var sx = Math.max(0, -form.cropX * scale);
    var sy = Math.max(0, -form.cropY * scale);
    var sw = Math.min(form.cropW - sx, frame.frameW * scale);
    var sh = Math.min(form.cropH - sy, frame.frameH * scale);
    var canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
    var maxBytes = avatar ? 60 * 1024 : 150 * 1024;
    encodeWebp(canvas, maxBytes).then(function (blob) {
      if (form.cropUrl) URL.revokeObjectURL(form.cropUrl);
      form.cropUrl = "";
      form.cropReady = false;
      view = "edit";
      if (!blob) {
        errorText = tr("Could not save that photo.");
        paint();
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var data = String(reader.result || "");
        if (avatar) {
          form.avatar = data;
          form.avatarTouched = true;
        } else {
          form.banner = data;
          form.bannerTouched = true;
        }
        errorText = "";
        paint();
      };
      reader.onerror = function () {
        errorText = tr("Could not save that photo.");
        paint();
      };
      reader.readAsDataURL(blob);
    }).catch(function () {
      errorText = tr("Could not save that photo.");
      view = "edit";
      paint();
    });
  }
  function encodeWebp(canvas, maxBytes) {
    var quality = 0.82;
    return new Promise(function (resolve) {
      function step() {
        if (!canvas.toBlob) { resolve(null); return; }
        canvas.toBlob(function (blob) {
          if (!blob || blob.type !== "image/webp") { resolve(null); return; }
          if (blob.size <= maxBytes || quality <= 0.42) resolve(blob.size <= maxBytes ? blob : null);
          else { quality = Math.round((quality - 0.08) * 100) / 100; step(); }
        }, "image/webp", quality);
      }
      step();
    });
  }
  function saveProfile() {
    var session = readSession();
    if (!session) return;
    var body = {
      displayName: String(form.displayName || "").trim(),
      bio: String(form.bio || ""),
      location: String(form.location || "").trim(),
      website: String(form.website || "").trim(),
      privateFollows: !!form.privateFollows,
      profileLess: !!form.profileLess
    };
    body.avatarEmpty = form.avatarEmpty === "none" ? "none" : "default";
    body.bannerEmpty = form.bannerEmpty === "none" ? "none" : "default";
    if (form.avatarTouched) body.avatar = form.avatar || "";
    if (form.bannerTouched) body.banner = form.banner || "";
    api("/v1/profile", { method: "PATCH", token: session.token, body: body }).then(function (res) {
        if (res.status !== 200 || !res.account) {
          errorText = errorMessage(res.error);
          paint();
          return;
        }
        session.account = res.account;
        writeSession(session);
        remember(res.account);
        dirtyLists();
        view = "";
        paint();
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      errorText = tr("Something went wrong. Try again.");
      paint();
    });
  }
  function remember(account) {
    if (!account || !account.handle) return;
    profiles[skel(account.handle)] = account;
    if (account.publicId) {
      profiles[skel(account.handle + account.publicId)] = account;
      profiles[skel(account.publicId)] = account;
    }
  }
  function loadProfile(handle) {
    var key = skel(handle);
    var session = readSession();
    if (!session || profileLoads[key] || profileMiss[key] || !hasApi()) return;
    if (profiles[key] && profiles[key].repostsLoaded) return;
    profileLoads[key] = true;
    var epoch = profileEpoch[key] || 0;
    api("/v1/profile/" + encodeURIComponent(handle), { token: session.token }).then(function (body) {
      profileLoads[key] = false;
      if (!body || body.status === 404 || !body.account) {
        if ((profileEpoch[key] || 0) === epoch) profileMiss[key] = true;
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return;
      }
      if ((profileEpoch[key] || 0) !== epoch && profiles[key]) {
        body.account.reposts = profiles[key].reposts || [];
        body.account.repostsLoaded = true;
      } else {
        body.account.reposts = Array.isArray(body.reposts) ? body.reposts : [];
        body.account.repostsLoaded = true;
      }
      remember(body.account);
      noteProfile(body.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { profileLoads[key] = false; });
  }
  function setReposts(handle, rows) {
    var key = skel(handle);
    profileEpoch[key] = (profileEpoch[key] || 0) + 1;
    profileMiss[key] = false;
    if (!profiles[key]) {
      var session = readSession();
      if (session && session.account && skel(session.account.handle) === key) profiles[key] = Object.assign({}, session.account);
    }
    if (!profiles[key]) return;
    profiles[key].reposts = Array.isArray(rows) ? rows : [];
    profiles[key].repostsLoaded = true;
  }
  var graphCounts = {};
  var followEpoch = 0;
  var listCache = {};
  var countLoads = {};
  var syncingFollows = false;
  var syncAgain = false;
  function myAccountId() {
    var session = readSession();
    return session && session.account && session.account.publicId ? "app:" + session.account.publicId : "";
  }
  function formatNum(n) {
    var value = Math.max(0, Math.trunc(Number(n) || 0));
    if (window.SI18n && window.SI18n.formatCount) return window.SI18n.formatCount(value);
    return String(value);
  }
  function readSettings() {
    try { return JSON.parse(readStored("settings-v1") || "{}") || {}; }
    catch (err) { return {}; }
  }
  function localFeedFollows() {
    return (readSettings().follows || []).filter(function (id) { return id && String(id).indexOf("app:") !== 0; });
  }
  function localAppFollows() {
    return (readSettings().accountFollows || []).filter(function (id) {
      var text = String(id || "");
      return /^app:\d{12}$/.test(text) || /^app:@[A-Za-z0-9_\u0400-\u04FF]{1,32}$/.test(text);
    });
  }
  function accountRef(account) {
    if (!account) return "";
    if (account.publicId && /^\d{12}$/.test(String(account.publicId))) return "app:" + account.publicId;
    if (account.handle) return "app:@" + account.handle;
    return "";
  }
  function profileMine(account) {
    var session = readSession();
    if (!session || !session.account || !account) return false;
    if (account.publicId && session.account.publicId === account.publicId) return true;
    return !!(account.handle && skel(session.account.handle) === skel(account.handle));
  }
  function accountStat(account, field) {
    var id = accountRef(account);
    var known = graphCounts[id];
    if (field === "following" && myAccountId() === id && (!known || known.following == null)) {
      return localFeedFollows().length + localAppFollows().length;
    }
    if (known && known[field] != null) return known[field];
    if (field === "following" && account && account.followingCount != null) return account.followingCount;
    if (field === "followers" && account && account.followersCount != null) return account.followersCount;
    if (field === "friends" && account && account.friendsCount != null) return account.friendsCount;
    return 0;
  }
  function noteProfile(account) {
    var id = accountRef(account);
    if (!account || !id) return;
    graphCounts[id] = graphCounts[id] || {};
    if (account.followingCount != null && !graphCounts[id].fresh) graphCounts[id].following = account.followingCount;
    if (account.followersCount != null && !graphCounts[id].fresh) graphCounts[id].followers = account.followersCount;
    if (account.friendsCount != null && !graphCounts[id].fresh) graphCounts[id].friends = account.friendsCount;
    if (account.viewerFriendStatus != null) graphCounts[id].friendStatus = account.viewerFriendStatus;
    if (account.mutualFriendsCount != null) graphCounts[id].mutualFriendsCount = account.mutualFriendsCount;
    graphCounts[id].pending = !!account.viewerPending;
    graphCounts[id].viewerBlocks = !!account.viewerBlocks;
    graphCounts[id].blockedBy = !!account.blockedBy;
    graphCounts[id].muted = !!account.viewerMutes;
    graphCounts[id].locked = !!account.locked;
  }
  function countLink(account, tab, n, label) {
    var href = tab === "friends" ? ("#/@" + encodeURIComponent(account.handle || "") + "?tab=friends") : ("#/@" + encodeURIComponent(account.handle || "") + "/" + tab);
    return '<a href="' + esc(href) + '"><b>' + esc(formatNum(n)) + "</b> <span>" + esc(label) + "</span></a>";
  }
  function accountCountsHtml(account) {
    return '<div class="counts">' + countLink(account, "following", accountStat(account, "following"), tr("Following count")) + countLink(account, "followers", accountStat(account, "followers"), tr("Followers")) + countLink(account, "friends", accountStat(account, "friends"), tr("Friends")) + "</div>";
  }
  function followersOf(id) {
    var known = graphCounts[id];
    return known && known.followers != null ? known.followers : 0;
  }
  function ensureCounts(id) {
    var session = readSession();
    if (!id || !session || !hasApi()) return;
    if (countLoads[id] || (graphCounts[id] && graphCounts[id].fresh)) return;
    var epoch = followEpoch;
    countLoads[id] = true;
    api("/v1/follows?id=" + encodeURIComponent(id), { token: session.token }).then(function (res) {
      countLoads[id] = false;
      if (!res || res.status !== 200 || epoch !== followEpoch) return;
      graphCounts[id] = graphCounts[id] || {};
      if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
      if (res.followingCount != null) graphCounts[id].following = res.followingCount;
      graphCounts[id].fresh = true;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { countLoads[id] = false; });
  }
  function listPack(id, tab) {
    return listCache[id + "|" + tab] || { loading: false, accounts: null, error: false, isPrivate: false, cursor: "", query: graphQuery[id + "|" + tab] || "" };
  }
  var graphQuery = {};
  var graphTimer = {};
  function ensureList(id, tab, more) {
    var session = readSession();
    var key = id + "|" + tab;
    if (!id || !session || !hasApi()) return;
    var pack = listCache[key];
    if (pack && pack.loading) return;
    if (pack && pack.accounts && !pack.dirty && !more) return;
    var epoch = followEpoch;
    var q = graphQuery[key] || "";
    var cursor = more && pack && pack.cursor ? pack.cursor : "";
    listCache[key] = { loading: true, accounts: pack && pack.accounts, error: false, dirty: false, cursor: pack && pack.cursor, query: q, isPrivate: pack && pack.isPrivate, locked: pack && pack.locked, blocked: pack && pack.blocked };
    var path = "/v1/follows?id=" + encodeURIComponent(id) + "&tab=" + encodeURIComponent(tab) + "&limit=20";
    if (q) path += "&q=" + encodeURIComponent(q);
    if (cursor) path += "&cursor=" + encodeURIComponent(cursor);
    api(path, { token: session.token }).then(function (res) {
      if (epoch !== followEpoch) {
        if (listCache[key]) {
          listCache[key].loading = false;
          listCache[key].dirty = true;
        }
        return;
      }
      if (!res || res.status !== 200) listCache[key] = { loading: false, accounts: [], error: true, isPrivate: false, cursor: "", query: q };
      else {
        var next = Array.isArray(res.accounts) ? res.accounts : [];
        var prev = more && pack && Array.isArray(pack.accounts) ? pack.accounts : [];
        listCache[key] = {
          loading: false,
          accounts: prev.concat(next),
          error: false,
          isPrivate: !!res.isPrivate,
          locked: !!res.locked,
          blocked: !!res.blocked,
          cursor: res.cursor || "",
          query: q
        };
        graphCounts[id] = graphCounts[id] || {};
        if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
        if (res.followingCount != null) graphCounts[id].following = res.followingCount;
        if (res.requestsCount != null) graphCounts[id].requests = res.requestsCount;
        graphCounts[id].fresh = true;
      }
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      listCache[key] = { loading: false, accounts: (pack && pack.accounts) || [], error: true, cursor: "", query: q };
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function setGraphQuery(id, tab, value) {
    var key = id + "|" + tab;
    graphQuery[key] = String(value || "");
    if (listCache[key]) listCache[key].dirty = true;
    clearTimeout(graphTimer[key]);
    graphTimer[key] = setTimeout(function () { ensureList(id, tab, false); }, 200);
  }
  function dirtyLists() {
    Object.keys(listCache).forEach(function (key) {
      if (listCache[key]) listCache[key].dirty = true;
    });
  }
  var followInflight = {};
  function pressFollow(id) {
    if (!id || followInflight[id]) return false;
    followInflight[id] = true;
    return true;
  }
  function releaseFollow(id) {
    if (id) followInflight[id] = false;
  }
  function previewFollow(id, follow) {
    if (!id) return;
    graphCounts[id] = graphCounts[id] || {};
    var me = myAccountId();
    if (graphCounts[id].followers != null) graphCounts[id].followers = Math.max(0, graphCounts[id].followers + (follow ? 1 : -1));
    if (me && graphCounts[me] && graphCounts[me].following != null) graphCounts[me].following = Math.max(0, graphCounts[me].following + (follow ? 1 : -1));
  }
  function followErrorText(res) {
    if (!res) return tr("Couldn’t update that follow. Try again.");
    if (res.status === 429 || res.error === "rate_limited") return tr("Too many follows. Wait a few minutes and try again.");
    if (res.status === 403 || res.error === "blocked") return tr("You can’t follow this account.");
    if (res.status === 404) return tr("That account isn’t here.");
    return tr("Couldn’t update that follow. Try again.");
  }
  function rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine) {
    if (hadTarget) graphCounts[id].followers = prevTarget;
    else if (graphCounts[id]) {
      delete graphCounts[id].followers;
      graphCounts[id].fresh = false;
    }
    if (hadMine && graphCounts[me]) graphCounts[me].following = prevMine;
  }
  function changeFollow(id, follow, profile, opts) {
    var session = readSession();
    opts = opts || {};
    var held = !!opts.held;
    if (!id) return Promise.resolve(false);
    if (!held && followInflight[id]) return Promise.resolve({ ok: true, ignored: true });
    if (!held) followInflight[id] = true;
    if (!session || !hasApi()) {
      releaseFollow(id);
      return Promise.resolve(true);
    }
    if (id === myAccountId()) {
      releaseFollow(id);
      return Promise.resolve(false);
    }
    followEpoch += 1;
    var epoch = followEpoch;
    var me = myAccountId();
    graphCounts[id] = graphCounts[id] || {};
    var wasPending = !!graphCounts[id].pending;
    var skipCounts = !!opts.replay || (follow && wasPending) || (!follow && wasPending);
    var hadTarget = !!(graphCounts[id] && graphCounts[id].followers != null);
    var prevTarget = hadTarget ? graphCounts[id].followers : 0;
    var hadMine = !!(me && graphCounts[me] && graphCounts[me].following != null);
    var prevMine = hadMine ? graphCounts[me].following : 0;
    if (!skipCounts) {
      graphCounts[id].followers = Math.max(0, prevTarget + (follow ? 1 : -1));
      if (hadMine) graphCounts[me].following = Math.max(0, prevMine + (follow ? 1 : -1));
    }
    if (follow) graphCounts[id].pending = false;
    dirtyLists();
    var body = { id: id };
    if (profile && typeof profile === "object") body.profile = profile;
    return api("/v1/follows", { method: follow ? "PUT" : "DELETE", token: session.token, body: body }).then(function (res) {
      releaseFollow(id);
      if (epoch !== followEpoch) return res && res.status === 200 ? true : false;
      if (!res || res.status !== 200) {
        if (!skipCounts) rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine);
        else if (opts.replay) previewFollow(id, !follow);
        if (window.ViktorychAccounts && window.ViktorychAccounts.toast) window.ViktorychAccounts.toast(followErrorText(res));
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return false;
      }
      graphCounts[id] = graphCounts[id] || {};
      if (res.pending) {
        if (!skipCounts) rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine);
        graphCounts[id].pending = true;
        graphCounts[id].fresh = true;
        if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
        if (me && res.followingCount != null) {
          graphCounts[me] = graphCounts[me] || {};
          graphCounts[me].following = res.followingCount;
        }
        dirtyLists();
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return { pending: true };
      }
      graphCounts[id].pending = false;
      if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
      graphCounts[id].fresh = true;
      if (me && res.followingCount != null) {
        graphCounts[me] = graphCounts[me] || {};
        graphCounts[me].following = res.followingCount;
        graphCounts[me].fresh = true;
      }
      dirtyLists();
      refreshProfileMedia();
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return true;
    }).catch(function () {
      releaseFollow(id);
      if (epoch !== followEpoch) return false;
      if (!skipCounts) rollbackCounts(id, me, hadTarget, prevTarget, hadMine, prevMine);
      else if (opts.replay) previewFollow(id, !follow);
      if (window.ViktorychAccounts && window.ViktorychAccounts.toast) window.ViktorychAccounts.toast(tr("Couldn’t update that follow. Try again."));
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return false;
    });
  }
  function followControlHtml(id, large) {
    var row = graphCounts[id] || {};
    var busy = !!followInflight[id];
    var size = large ? " lg" : "";
    var attr = ' type="button" data-act="follow" data-id="' + esc(id) + '" aria-busy="' + (busy ? "true" : "false") + '"';
    if (row.blockedBy) return "";
    if (row.viewerBlocks) {
      return '<button class="follow following' + size + '"' + attr.replace('data-act="follow"', 'data-act="graph-unblock"') + ' aria-pressed="false">' + esc(tr("Unblock")) + '</button>';
    }
    if (row.pending) {
      return '<button class="follow pending' + size + '"' + attr + ' aria-pressed="false" aria-label="' + esc(tr("Pending")) + '"><span class="f">' + esc(tr("Pending")) + '</span><span class="u">' + esc(tr("Cancel request")) + '</span></button>';
    }
    return "";
  }
  function syncFollows() {
    var session = readSession();
    if (!session || !hasApi() || !session.account) return Promise.resolve();
    if (syncingFollows) {
      syncAgain = true;
      return Promise.resolve();
    }
    syncingFollows = true;
    var epoch = followEpoch;
    var key = "follows-imported-v2-" + session.account.publicId;
    var imported = readStored(key) === "1";
    var local = localFeedFollows().concat(localAppFollows()).filter(function (id, index, all) {
      return id && all.indexOf(id) === index;
    });
    var start = imported || !local.length
      ? Promise.resolve({ status: 200 })
      : api("/v1/follows/import", { method: "POST", token: session.token, body: { ids: local.slice(0, 5000) } });
    return start.then(function (res) {
      if (!imported && local.length && res && res.status === 200) writeStored(key, "1");
      return api("/v1/follows", { token: session.token });
    }).then(function (res) {
      syncingFollows = false;
      if (epoch !== followEpoch) syncAgain = true;
      else if (res && res.status === 200) {
        var me = "app:" + session.account.publicId;
        graphCounts[me] = graphCounts[me] || {};
        if (res.followingCount != null) graphCounts[me].following = res.followingCount;
        if (res.followersCount != null) graphCounts[me].followers = res.followersCount;
        if (res.requestsCount != null) graphCounts[me].requests = res.requestsCount;
        graphCounts[me].fresh = true;
        var outgoing = Array.isArray(res.outgoingRequests) ? res.outgoingRequests : [];
        Object.keys(graphCounts).forEach(function (key) {
          if (graphCounts[key] && key !== me) graphCounts[key].pending = outgoing.indexOf(key) >= 0;
        });
        outgoing.forEach(function (oid) {
          graphCounts[oid] = graphCounts[oid] || {};
          graphCounts[oid].pending = true;
        });
        if (window.ViktorychAccounts.onServerFollows) window.ViktorychAccounts.onServerFollows(Array.isArray(res.ids) ? res.ids : []);
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
      if (syncAgain) {
        syncAgain = false;
        return syncFollows();
      }
    }).catch(function () {
      syncingFollows = false;
      if (syncAgain) {
        syncAgain = false;
        return syncFollows();
      }
    });
  }
  function viewerOwnsSubject(subjectId, handle) {
    var session = readSession();
    var me = session && session.account;
    if (!me) return false;
    var id = String(subjectId || "");
    var mine = String(me.publicId || "");
    if (mine && (id === mine || id === "app:" + mine)) return true;
    if (id.indexOf("app:") !== 0) return false;
    if (/^app:\d{12}$/.test(id)) return false;
    var fromId = id.slice(4).replace(/^@/, "");
    var candidate = fromId || String(handle || "");
    if (!candidate || !me.handle) return false;
    return skel(candidate) === skel(me.handle);
  }
  function subjectForHandle(handle, platform) {
    var key = skel(handle);
    var session = readSession();
    var me = session && session.account;
    var account = profiles[key];
    if (!account && me && skel(me.handle) === key) account = me;
    if (account && account.handle) {
      var publicId = /^\d{12}$/.test(String(account.publicId || "")) ? String(account.publicId) : "";
      if (!publicId && me && skel(me.handle) === skel(account.handle) && /^\d{12}$/.test(String(me.publicId || ""))) publicId = String(me.publicId);
      var id = publicId ? "app:" + publicId : "app:@" + account.handle;
      return { id: id, kind: "account", name: account.displayName || account.handle, handle: account.handle, platform: "x" };
    }
    if ((platform || "x") === "x" && readSession() && hasApi() && !profileMiss[key]) {
      loadProfile(handle);
      return { pending: true };
    }
    return null;
  }
  function friendButtonHtml(account) {
    var session = readSession();
    var ref = accountRef(account);
    if (!session || !account || !ref || profileMine(account)) return "";
    var status = (graphCounts[ref] && graphCounts[ref].friendStatus) || account.viewerFriendStatus || "none";
    var pid = ref;
    var handle = account.handle || "";

    if (status === "friends") {
      return '<button class="friend-btn friend-mutual" type="button" data-friend-act="unfriend" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '" aria-label="' + esc(tr("Friends")) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span class="f">' + esc(tr("Friends")) + '</span><span class="u">' + esc(tr("Unfriend")) + '</span></button>';
    }
    if (status === "sent") {
      return '<button class="friend-btn friend-pending" type="button" data-friend-act="cancel" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '" aria-label="' + esc(tr("Request Sent")) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg><span class="f">' + esc(tr("Request Sent")) + '</span><span class="u">' + esc(tr("Cancel Request")) + '</span></button>';
    }
    if (status === "received") {
      return '<div class="friend-btn-group"><button class="friend-btn friend-accept" type="button" data-friend-act="accept" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '">' + esc(tr("Confirm")) + '</button><button class="friend-btn friend-decline" type="button" data-friend-act="decline" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '">' + esc(tr("Delete")) + '</button></div>';
    }
    return '<button class="friend-btn friend-add" type="button" data-friend-act="request" data-friend-id="' + esc(pid) + '" data-handle="' + esc(handle) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg><span>' + esc(tr("Add Friend")) + '</span></button>';
  }

  function ensureFriends(targetId) {
    var session = readSession();
    var key = String(targetId || "");
    if (!key) return;
    if (key.indexOf("app:") !== 0 && key.indexOf("@") !== 0) key = "app:" + key;
    if (key.charAt(0) === "@") key = "app:" + key;
    if (!session || !hasApi()) return;
    if (friendsLoads[key] || friendsCache[key]) return;
    friendsLoads[key] = true;
    api("/v1/friends?id=" + encodeURIComponent(key) + "&tab=friends", { token: session.token }).then(function (res) {
      friendsLoads[key] = false;
      if (!res || res.status !== 200) return;
      friendsCache[key] = Array.isArray(res.friends) ? res.friends : [];
      var id = key;
      graphCounts[id] = graphCounts[id] || {};
      if (res.friendsCount != null) graphCounts[id].friends = res.friendsCount;
      if (res.status != null) graphCounts[id].friendStatus = res.status;
      if (res.mutualCount != null) graphCounts[id].mutualFriendsCount = res.mutualCount;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { friendsLoads[key] = false; });
  }

  function ensureFriendRequests() {
    var session = readSession();
    if (!session || !hasApi() || friendRequestsLoading) return;
    friendRequestsLoading = true;
    api("/v1/friends?tab=requests", { token: session.token }).then(function (res) {
      friendRequestsLoading = false;
      if (!res || res.status !== 200) return;
      friendRequestsCache = {
        incoming: Array.isArray(res.incoming) ? res.incoming : [],
        outgoing: Array.isArray(res.outgoing) ? res.outgoing : []
      };
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { friendRequestsLoading = false; });
  }

  function syncFriends() {
    var session = readSession();
    if (!session || !hasApi()) return Promise.resolve();
    ensureFriendRequests();
    if (session.account) ensureFriends(accountRef(session.account));
    return Promise.resolve();
  }

  function doFriendAction(action, targetId, handle) {
    var session = readSession();
    if (!session || !hasApi() || !targetId) return;
    var me = session.account && session.account.publicId;
    var rawTarget = String(targetId || "");
    var tId = rawTarget.indexOf("app:") === 0 ? rawTarget : ("app:" + rawTarget.replace(/^@/, "@"));
    var idKey = tId;
    var meKey = me ? "app:" + me : "";

    graphCounts[idKey] = graphCounts[idKey] || {};
    var prevStatus = graphCounts[idKey].friendStatus || "none";
    var prevCount = graphCounts[idKey].friends || 0;
    var prevMyCount = (graphCounts[meKey] && graphCounts[meKey].friends) || 0;

    if (action === "request") {
      graphCounts[idKey].friendStatus = "sent";
    } else if (action === "accept") {
      graphCounts[idKey].friendStatus = "friends";
      graphCounts[idKey].friends = prevCount + 1;
      graphCounts[meKey] = graphCounts[meKey] || {};
      graphCounts[meKey].friends = prevMyCount + 1;
      friendRequestsCache.incoming = friendRequestsCache.incoming.filter(function (r) {
        return r.id !== "app:" + tId && r.publicId !== tId;
      });
      delete friendsCache[me];
      delete friendsCache[tId];
    } else if (action === "decline") {
      graphCounts[idKey].friendStatus = "none";
      friendRequestsCache.incoming = friendRequestsCache.incoming.filter(function (r) {
        return r.id !== "app:" + tId && r.publicId !== tId;
      });
    } else if (action === "cancel") {
      graphCounts[idKey].friendStatus = "none";
      friendRequestsCache.outgoing = friendRequestsCache.outgoing.filter(function (r) {
        return r.id !== "app:" + tId && r.publicId !== tId;
      });
    } else if (action === "remove") {
      graphCounts[idKey].friendStatus = "none";
      graphCounts[idKey].friends = Math.max(0, prevCount - 1);
      graphCounts[meKey] = graphCounts[meKey] || {};
      graphCounts[meKey].friends = Math.max(0, prevMyCount - 1);
      delete friendsCache[me];
      delete friendsCache[tId];
    }

    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();

    var ep = "/v1/friends/" + action;
    api(ep, { method: "POST", token: session.token, body: { targetId: tId } }).then(function (res) {
      if (!res || res.status !== 200) {
        graphCounts[idKey].friendStatus = prevStatus;
        graphCounts[idKey].friends = prevCount;
        if (graphCounts[meKey]) graphCounts[meKey].friends = prevMyCount;
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return;
      }
      if (res.status != null) graphCounts[idKey].friendStatus = res.status;
      if (res.friendsCount != null && graphCounts[meKey]) graphCounts[meKey].friends = res.friendsCount;
      refreshProfileMedia();
      if (window.ViktorychAccounts && window.ViktorychAccounts.toast) {
        if (action === "request") window.ViktorychAccounts.toast(tr("Friend request sent"));
        else if (action === "accept") window.ViktorychAccounts.toast(tr("Friend request accepted"));
        else if (action === "decline") window.ViktorychAccounts.toast(tr("Friend request declined"));
        else if (action === "cancel") window.ViktorychAccounts.toast(tr("Friend request cancelled"));
        else if (action === "remove") window.ViktorychAccounts.toast(tr("Friend removed"));
      }
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      graphCounts[idKey].friendStatus = prevStatus;
      graphCounts[idKey].friends = prevCount;
      if (graphCounts[meKey]) graphCounts[meKey].friends = prevMyCount;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }

  function friendsSectionHtml(account) {
    var session = readSession();
    var mine = profileMine(account);
    if (!session) {
      return '<div class="empty"><h2>' + esc(tr("Friends")) + '</h2><p>' + esc(tr("Sign in to see this list.")) + '</p></div>';
    }

    var pid = accountRef(account);
    ensureFriends(pid);
    if (mine) ensureFriendRequests();

    if (friendsLoads[pid] && !friendsCache[pid]) {
      return '<div class="reply-empty">' + esc(tr("Loading…")) + '</div>';
    }

    var friendsList = friendsCache[pid] || [];
    var incoming = (mine && friendRequestsCache.incoming) || [];
    var requestsCount = incoming.length;

    var headerRight = '<div class="friends-search-box">' +
      '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.25 3.75a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm-8.5 6.5a8.5 8.5 0 1114.86 5.66l4.47 4.46-1.42 1.42-4.46-4.47A8.5 8.5 0 011.75 10.25z"/></svg>' +
      '<input type="text" class="friends-search-input" placeholder="' + esc(tr("Search Friends")) + '" value="' + esc(friendsSearchQuery) + '" data-friends-search="1">' +
    '</div>';

    var pills = "";
    if (mine) {
      pills = '<div class="friends-pills">' +
        '<button class="friends-pill' + (friendsSubTab === "all" ? " active" : "") + '" type="button" data-friend-sub="all">' + esc(tr("All Friends")) + ' <span class="pill-count">(' + friendsList.length + ')</span></button>' +
        '<a class="friends-pill" href="#/online">' + esc(tr("Online")) + '</a>' +
        '<button class="friends-pill' + (friendsSubTab === "requests" ? " active" : "") + '" type="button" data-friend-sub="requests">' + esc(tr("Friend Requests")) + (requestsCount > 0 ? ' <span class="pill-badge">' + requestsCount + '</span>' : '') + '</button>' +
      '</div>';
    }

    var cardsHtml = "";
    if (mine && friendsSubTab === "requests") {
      if (!incoming.length) {
        cardsHtml = '<div class="empty"><h2>' + esc(tr("No friend requests")) + '</h2><p>' + esc(tr("You don’t have any pending friend requests.")) + '</p></div>';
      } else {
        cardsHtml = '<div class="friends-grid">' + incoming.map(function (req) {
          var rpid = req.id ? req.id.replace(/^app:/, "") : "";
          var photo = presenceWrap(rpid, publicAvatar(req.avatar, req.avatarFace, "friend-avatar"), false);
          var mutual = req.mutualFriendsCount ? '<div class="friend-card-mutual">' + esc(tr("{count} mutual friends", { count: req.mutualFriendsCount })) + '</div>' : '';
          return '<div class="friend-card" data-friend-card="app:' + esc(rpid) + '">' +
            '<a class="friend-card-media" href="#/@' + encodeURIComponent(req.handle) + '">' + photo + '</a>' +
            '<div class="friend-card-info">' +
              '<a class="friend-card-name" href="#/@' + encodeURIComponent(req.handle) + '">' + esc(req.name || req.handle) + (req.owner ? badge() : "") + '</a>' +
              '<div class="friend-card-handle">@' + esc(req.handle) + '</div>' +
              mutual +
            '</div>' +
            '<div class="friend-card-actions">' +
              '<button class="friend-btn friend-accept" type="button" data-friend-act="accept" data-friend-id="' + esc(rpid) + '" data-handle="' + esc(req.handle) + '">' + esc(tr("Confirm")) + '</button>' +
              '<button class="friend-btn friend-decline" type="button" data-friend-act="decline" data-friend-id="' + esc(rpid) + '" data-handle="' + esc(req.handle) + '">' + esc(tr("Delete")) + '</button>' +
            '</div>' +
          '</div>';
        }).join("") + '</div>';
      }
    } else {
      var query = friendsSearchQuery.trim().toLowerCase();
      var filtered = friendsList;
      if (query) {
        filtered = friendsList.filter(function (f) {
          var name = String(f.name || f.displayName || "").toLowerCase();
          var handle = String(f.handle || "").toLowerCase();
          return name.indexOf(query) >= 0 || handle.indexOf(query) >= 0;
        });
      }

      if (!friendsList.length) {
        cardsHtml = '<div class="empty"><h2>' + esc(tr("No friends yet")) + '</h2><p>' + esc(tr("When you become friends with people, they’ll show up here.")) + '</p></div>';
      } else if (!filtered.length) {
        cardsHtml = '<div class="empty"><h2>' + esc(tr("No friends found")) + '</h2><p>' + esc(tr("Couldn’t find any friends matching your search.")) + '</p></div>';
      } else {
        cardsHtml = '<div class="friends-grid">' + filtered.map(function (fr) {
          var fpid = fr.id ? fr.id.replace(/^app:/, "") : fr.publicId;
          var photo = presenceWrap(fpid, publicAvatar(fr.avatar, fr.avatarFace, "friend-avatar"), false);
          var mutual = fr.mutualFriendsCount ? '<div class="friend-card-mutual">' + esc(tr("{count} mutual friends", { count: fr.mutualFriendsCount })) + '</div>' : '';
          var btn = "";
          if (mine) {
            btn = '<button class="friend-btn friend-mutual" type="button" data-friend-act="unfriend" data-friend-id="' + esc(fpid) + '" data-handle="' + esc(fr.handle) + '"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span class="f">' + esc(tr("Friends")) + '</span><span class="u">' + esc(tr("Unfriend")) + '</span></button>';
          } else {
            btn = friendButtonHtml({ publicId: fpid, handle: fr.handle, viewerFriendStatus: fr.friendStatus });
          }
          return '<div class="friend-card" data-friend-card="app:' + esc(fpid) + '">' +
            '<a class="friend-card-media" href="#/@' + encodeURIComponent(fr.handle) + '">' + photo + '</a>' +
            '<div class="friend-card-info">' +
              '<a class="friend-card-name" href="#/@' + encodeURIComponent(fr.handle) + '">' + esc(fr.name || fr.displayName || fr.handle) + (fr.owner ? badge() : "") + '</a>' +
              '<div class="friend-card-handle">@' + esc(fr.handle) + '</div>' +
              mutual +
            '</div>' +
            '<div class="friend-card-actions">' + btn + '</div>' +
          '</div>';
        }).join("") + '</div>';
      }
    }

    var totalFriends = friendsList.length;
    var headingHtml = '<div class="friends-header">' +
      '<div class="friends-header-left">' +
        '<h2 class="friends-heading">' + esc(tr("Friends")) + '</h2>' +
        '<span class="friends-sub">' + esc(tr("{count} friends", { count: totalFriends })) + '</span>' +
      '</div>' +
      '<div class="friends-header-right">' + headerRight + '</div>' +
    '</div>';

    return '<div class="friends-section">' + headingHtml + pills + cardsHtml + '</div>';
  }

    var linkIdentityForm = {
    platform: "x",
    handle: "",
    proofUrl: "",
    step: 0,
    challenge: null,
    loading: false
  };
  var copiedIdentityCode = false;

  function platformIcon(platform) {
    var p = String(platform || "x").toLowerCase();
    if (p === "x") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
    }
    if (p === "telegram") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>';
    }
    if (p === "youtube") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M21.58 7.19a2.76 2.76 0 0 0-1.94-1.95C17.92 4.7 12 4.7 12 4.7s-5.92 0-7.64.54A2.76 2.76 0 0 0 2.42 7.19 28.9 28.9 0 0 0 1.88 12a28.9 28.9 0 0 0 .54 4.81 2.76 2.76 0 0 0 1.94 1.95c1.72.54 7.64.54 7.64.54s5.92 0 7.64-.54a2.76 2.76 0 0 0 1.94-1.95 28.9 28.9 0 0 0 .54-4.81 28.9 28.9 0 0 0-.54-4.81zM10 15V9l5.2 3L10 15z"/></svg>';
    }
    if (p === "instagram") {
      return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>';
  }

  function verifiedSvg() {
    return '<svg class="ident-verified" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.8 14.5l-4.2-4.2 1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2z"/></svg>';
  }

  function linkedIdentitiesHtml(account) {
    var list = (account && account.identities) || [];
    var session = readSession();
    var mine = !!(session && session.account && (session.account.publicId === account.publicId || skel(session.account.handle) === skel(account.handle)));
    if (!list.length && !mine) return "";
    var addBtn = mine ? '<button class="acct-ident-chip acct-ident-add" type="button" data-acct="open-link-identity"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> <span>' + esc(tr("Link social profile")) + '</span></button>' : '';
    var chips = list.map(function (item) {
      var platform = item.platform || "x";
      var handle = item.handle || "";
      var href = "#/u/" + encodeURIComponent(platform) + "/" + encodeURIComponent(handle);
      var iconHtml = platformIcon(platform);
      return '<a class="acct-ident-chip" href="' + esc(href) + '" title="' + esc(tr("Verified Identity")) + '">' +
        iconHtml +
        '<span class="acct-ident-handle">@' + esc(handle) + '</span>' +
        verifiedSvg() +
      '</a>';
    }).join("") + addBtn;
    return '<div class="acct-ident-row"><span class="acct-ident-label">' + esc(tr("Linked profiles")) + ':</span><div class="acct-ident-chips">' + chips + '</div></div>';
  }

  function identitiesSettingsHtml(account) {
    var session = readSession();
    var list = (session && session.account && session.account.identities) || (account && account.identities) || [];
    var itemsHtml = "";
    if (!list.length) {
      itemsHtml = '<p class="set-sub" style="margin-bottom:12px;">' + esc(tr("No linked accounts yet.")) + '</p>';
    } else {
      itemsHtml = '<div class="acct-ident-settings-list">' + list.map(function (item) {
        var plat = (item.platform || "x").toUpperCase();
        return '<div class="acct-ident-item">' +
          '<div class="acct-ident-item-left">' +
            platformIcon(item.platform) +
            '<span class="acct-ident-item-name"><b>' + esc(plat) + '</b> @' + esc(item.handle) + '</span>' +
            verifiedSvg() +
          '</div>' +
          '<button class="outline acct-ident-unlink" type="button" data-acct="unlink-identity" data-platform="' + esc(item.platform) + '" data-handle="' + esc(item.handle) + '" data-id="' + esc(String(item.id || "")) + '">' + esc(tr("Unlink")) + '</button>' +
        '</div>';
      }).join("") + '</div>';
    }
    return itemsHtml + '<button class="outline" type="button" data-acct="open-link-identity" style="margin-bottom:20px;">' + esc(tr("Link social account")) + '</button>';
  }

  function linkIdentityBody() {
    if (linkIdentityForm.step === 1 && linkIdentityForm.challenge) {
      var platName = (linkIdentityForm.platform || "x").toUpperCase();
      var code = linkIdentityForm.challenge.code || "";
      return '<p class="acct-sub">' + esc(tr("Add this code to your bio or description on {platform}, or publish a public post containing this code.", { platform: platName })) + '</p>' +
        '<div class="acct-code-box"><code>' + esc(code) + '</code><button class="outline" type="button" data-acct="copy-code">' + esc(copiedIdentityCode ? tr("Copied") : tr("Copy code")) + '</button></div>' +
        '<div class="acct-field"><label>' + esc(tr("Post URL (optional)")) + '</label><input name="identityProofUrl" type="text" placeholder="https://..." value="' + esc(linkIdentityForm.proofUrl || "") + '"></div>' +
        '<p class="acct-error">' + esc(errorText) + '</p>' +
        '<button class="acct-next" type="button" data-acct="verify-identity">' + esc(linkIdentityForm.loading ? tr("Loading…") : tr("Confirm Identity")) + '</button>' +
        '<button class="acct-line" type="button" data-acct="back-identity" style="width:100%;margin-top:12px">' + esc(tr("Back")) + '</button>';
    }
    if (linkIdentityForm.step === 2) {
      return '<div class="acct-success"><p style="font-size:16px;font-weight:600;color:var(--accent,#1d9bf0);text-align:center;margin:24px 0;">' + esc(tr("Identity confirmed and linked!")) + '</p></div>' +
        '<button class="acct-next" type="button" data-acct="close">' + esc(tr("Close")) + '</button>';
    }
    var selectHtml = '<div class="acct-field"><label>' + esc(tr("Platform")) + '</label>' +
      '<select class="acct-select" name="identityPlatform">' +
        '<option value="x"' + (linkIdentityForm.platform === "x" ? " selected" : "") + '>X</option>' +
        '<option value="telegram"' + (linkIdentityForm.platform === "telegram" ? " selected" : "") + '>Telegram</option>' +
        '<option value="instagram"' + (linkIdentityForm.platform === "instagram" ? " selected" : "") + '>Instagram</option>' +
        '<option value="youtube"' + (linkIdentityForm.platform === "youtube" ? " selected" : "") + '>YouTube</option>' +
        '<option value="threads"' + (linkIdentityForm.platform === "threads" ? " selected" : "") + '>Threads</option>' +
        '<option value="vk"' + (linkIdentityForm.platform === "vk" ? " selected" : "") + '>VK</option>' +
      '</select></div>';
    var handleHtml = '<div class="acct-field"><label>' + esc(tr("Username or channel")) + '</label><input name="identityHandle" type="text" placeholder="@handle" value="' + esc(linkIdentityForm.handle || "") + '"></div>';
    return selectHtml + handleHtml + '<p class="acct-error">' + esc(errorText) + '</p>' +
      '<button class="acct-next" type="button" data-acct="gen-challenge">' + esc(linkIdentityForm.loading ? tr("Loading…") : tr("Generate verification code")) + '</button>';
  }

  function followLookup(id) {
    var api = window.ViktorychFollows;
    if (!api || typeof api.lookup !== "function" || !id) return null;
    try { return api.lookup(id) || null; } catch (err) { return null; }
  }
  function handleFromFollowId(id) {
    var text = String(id || "");
    if (text.indexOf("app:@") === 0) return text.slice(5);
    var cut = text.indexOf(":");
    if (cut <= 0) return "";
    var rest = text.slice(cut + 1).replace(/^@/, "");
    if (!rest || rest.length > 40 || /[\s<>]/.test(rest) || /^\d{8,}$/.test(rest)) return "";
    return rest;
  }
  function graphPerson(item) {
    var row = item || {};
    var known = followLookup(row.id);
    var handle = row.handle || (known && known.handle) || handleFromFollowId(row.id) || "";
    var avatar = row.avatar || (known && known.avatar) || "";
    var face = row.avatarFace || (known && known.avatarFace) || "";
    if (!face) face = avatar ? "photo" : "default";
    var name = row.name || row.displayName || (known && (known.name || known.displayName)) || handle || "";
    return { id: row.id || "", name: name, handle: handle, avatar: avatar, avatarFace: face };
  }
  function graphListHtml(subjectId, tab, handle) {
    ensureList(subjectId, tab, false);
    var pack = listPack(subjectId, tab);
    var q = graphQuery[subjectId + "|" + tab] || "";
    var searchLabel = tab === "followers" ? tr("Search followers") : tab === "following" ? tr("Search following") : tab === "mutuals" ? tr("Search mutuals") : tr("Search followers");
    var search = '<div class="friends-search-box"><input type="search" class="friends-search-input" data-graph-search="1" data-graph-id="' + esc(subjectId) + '" data-graph-tab="' + esc(tab) + '" placeholder="' + esc(searchLabel) + '" aria-label="' + esc(searchLabel) + '" value="' + esc(q) + '"></div>';
    if (pack.loading && !pack.accounts) return search + '<div class="reply-empty">' + esc(tr("Loading…")) + '</div>';
    if (pack.error) return search + '<div class="empty"><h2>' + esc(tr("Followers")) + '</h2><p>' + esc(tr("Couldn’t load this list.")) + '</p></div>';
    if (pack.blocked) return '<div class="empty"><h2>' + esc(tr("You're blocked")) + '</h2><p>' + esc(tr("This account has blocked you. You can’t see their posts or profile.")) + '</p></div>';
    if (pack.locked) return '<div class="empty"><h2>' + esc(tr("These posts are protected")) + '</h2><p>' + esc(tr("Follow this account and wait for approval to see their posts.")) + '</p></div>';
    if (pack.isPrivate && !viewerOwnsSubject(subjectId, handle)) return '<div class="empty"><h2>' + esc(tr("These lists are private")) + '</h2><p>' + esc(tr("Only @{handle} can see who they follow and who follows them.", { handle: handle || "" })) + '</p></div>';
    var rows = pack.accounts || [];
    if (!rows.length) {
      var title = tab === "followers" ? tr("No followers yet") : tab === "mutuals" ? tr("No mutuals yet") : tab === "requests" ? tr("No follow requests") : tr("Not following anyone yet");
      var copy = tab === "requests" ? tr("When someone asks to follow you, they’ll show up here.") : tab === "mutuals" ? tr("People you follow who follow you back show up here.") : tab === "followers" ? tr("When someone follows this account, they’ll show up here.") : tr("When this account follows someone, they’ll show up here.");
      return search + '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(copy) + '</p></div>';
    }
    var mine = viewerOwnsSubject(subjectId, handle);
    var html = rows.map(function (item) {
      var person = graphPerson(item);
      var button = window.ViktorychAccounts.followButton ? (window.ViktorychAccounts.followButton(person.id, false) || "") : "";
      var badge = item.followsYou ? '<span class="pill-badge">' + esc(tr("Follows you")) + '</span>' : "";
      var remove = mine && tab === "followers" && item.removable ? '<button class="outline" type="button" data-act="remove-follower" data-id="' + esc(person.id) + '">' + esc(tr("Remove follower")) + '</button>' : "";
      var accept = mine && tab === "requests" ? '<button class="friend-btn friend-accept" type="button" data-act="accept-follow" data-id="' + esc(person.id) + '">' + esc(tr("Accept")) + '</button><button class="friend-btn friend-decline" type="button" data-act="decline-follow" data-id="' + esc(person.id) + '">' + esc(tr("Decline")) + '</button>' : "";
      var href = person.handle ? "#/@" + encodeURIComponent(person.handle) : (person.id ? "#/p/" + encodeURIComponent(String(person.id).replace(/^app:/, "")) : "#/");
      var letter = String(person.name || person.handle || "?").trim().charAt(0).toUpperCase() || "?";
      var face = publicAvatar(person.avatar, person.avatarFace, "", letter);
      return '<div class="connect-row"><a class="who-main" href="' + esc(href) + '">' + face + '<span class="who-copy"><span class="name">' + esc(person.name) + badge + '</span><span class="handle">' + (person.handle ? "@" + esc(person.handle) : "") + '</span></span></a><span class="row-actions">' + accept + remove + button + '</span></div>';
    }).join("");
    var more = pack.cursor ? '<button class="outline" type="button" data-act="graph-more" data-id="' + esc(subjectId) + '" data-tab="' + esc(tab) + '">' + esc(tr("Load more")) + '</button>' : "";
    return search + html + more;
  }
  function galleryList(account, kind) {
    var list = kind === "banner" ? ((account && account.banners) || []) : ((account && account.photos) || []);
    var items = list.filter(function (item) { return item && item.url; });
    if (!items.length) {
      var url = kind === "banner" ? (account && account.banner) : (account && account.avatar);
      if (url) items = [{ url: url, main: true }];
    }
    return items;
  }
  function galleryHtml(account) {
    if (!gallery.open || !account) return "";
    var items = galleryList(account, gallery.kind);
    if (!items.length) return "";
    if (gallery.index < 0) gallery.index = items.length - 1;
    if (gallery.index >= items.length) gallery.index = 0;
    var item = items[gallery.index];
    return '<div class="photo-gallery" data-acct="gallery-root">' +
      '<button class="photo-gallery-x" type="button" data-acct="gallery-close" aria-label="' + esc(tr("Close")) + '">×</button>' +
      (items.length > 1 ? '<button class="photo-gallery-nav prev" type="button" data-acct="gallery-prev" aria-label="' + esc(tr("Back")) + '">‹</button>' : "") +
      photoHtml(item.url, "photo-gallery-img") +
      (items.length > 1 ? '<button class="photo-gallery-nav next" type="button" data-acct="gallery-next" aria-label="' + esc(tr("Next")) + '">›</button>' : "") +
      "</div>";
  }
  function accountPage(account, route) {
    var mine = profileMine(account);
    var ref = accountRef(account);
    if (account.blockedBy && !mine) {
      var blockedTop = window.ViktorychProfile && window.ViktorychProfile.top ? window.ViktorychProfile.top({
        name: account.displayName || account.handle || "",
        platform: "app",
        handle: account.handle || "",
        feedId: account.publicId ? "app:" + account.publicId : "",
        url: "",
        own: false
      }, "") : "";
      return blockedTop + '<div class="empty"><h2>' + esc(tr("You're blocked")) + '</h2><p>' + esc(tr("This account has blocked you. You can’t see their posts or profile.")) + '</p></div>';
    }
    var photo = presenceWrap(mine ? account.publicId : "", publicAvatar(account.avatar, account.avatarFace, "pava"), mine);
    if ((account.photos && account.photos.length) || (account.banners && account.banners.length) || account.avatar || account.banner) {
      photo = photo.replace("<img", '<img data-acct="open-gallery" data-kind="photo"');
    }
    var banner = publicBanner(account.banner, account.bannerFace);
    if (banner.indexOf("<img") >= 0) banner = banner.replace("<img", '<img data-acct="open-gallery" data-kind="banner"');
    var edit = mine ? '<button class="follow" type="button" data-acct="edit">' + esc(tr("Edit profile")) + "</button>" : "";
    var giftBtn = !mine ? '<button class="outline" type="button" data-gift="open" data-handle="' + esc(account.handle || "") + '">' + esc(tr("Send a gift")) + "</button>" : "";
    var birthdayBanner = window.ProfileGifts && window.ProfileGifts.banner ? window.ProfileGifts.banner(account) : "";
    var followBtn = !mine && ref && window.ViktorychAccounts.followButton ? (window.ViktorychAccounts.followButton(ref, true) || "") : "";
    var friendBtn = !mine && ref ? friendButtonHtml(account) : "";
    var activeTab = (route && route.query && route.query.get("tab")) || (route && route.tab) || "posts";
    if (activeTab !== "friends" && activeTab !== "about" && activeTab !== "gifts") activeTab = "posts";
    if (window.ProfileAbout) window.ProfileAbout.ensure(account, account.aboutPreview || "");
    if (window.ProfileGifts) window.ProfileGifts.ensure(account);
    var showAbout = window.ProfileAbout && window.ProfileAbout.showTab(account);
    var showGifts = window.ProfileGifts && window.ProfileGifts.showTab(account);
    if (activeTab === "about" && !showAbout) activeTab = "posts";
    if (activeTab === "gifts" && !showGifts) activeTab = "posts";

    var pack = { html: "", count: 0 };
    if (window.ViktorychAccounts && window.ViktorychAccounts.profilePostsHtml) pack = window.ViktorychAccounts.profilePostsHtml(account) || pack;
    var count = String(pack.count || 0);

    var postsBody = pack.html || ('<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2><p>" + esc(mine ? tr("Add a photo and bio from Edit profile. Posts here come from feeds you follow.") : tr("Posts from this account will show up here.")) + "</p></div>");
    if (!mine && account.viewerBlocks) postsBody = '<div class="empty"><h2>' + esc(tr("You blocked this account")) + '</h2><p>' + esc(tr("Posts from this account stay hidden.")) + '</p></div>';
    else if (!mine && account.locked) postsBody = '<div class="empty"><h2>' + esc(tr("These posts are protected")) + '</h2><p>' + esc(tr("Follow this account and wait for approval to see their posts.")) + '</p></div>';
    var friendsBody = friendsSectionHtml(account);
    var aboutBody = activeTab === "about" && window.ProfileAbout ? window.ProfileAbout.html(account) : "";
    var giftsBody = activeTab === "gifts" && window.ProfileGifts ? window.ProfileGifts.giftsHtml(account.gifts, mine) : "";
    var body = activeTab === "about" ? aboutBody : (activeTab === "gifts" ? giftsBody : (activeTab === "friends" ? friendsBody : postsBody));

    var profileHref = "#/@" + encodeURIComponent(account.handle || "");
    var friendsHref = "#/@" + encodeURIComponent(account.handle || "") + "?tab=friends";

    var mutualCount = (graphCounts[ref] && graphCounts[ref].mutualFriendsCount) || account.mutualFriendsCount;
    var mutualLine = (!mine && mutualCount) ? '<div class="pmutual">' + esc(tr("{count} mutual friends", { count: mutualCount })) + '</div>' : '';

    var highlightRow = window.Highlights && window.Highlights.row ? window.Highlights.row(account, mine) : "";
    var tabs = '<div class="tabs ptabs" role="tablist" aria-label="' + esc(tr("Profile")) + '">' +
      '<a class="tab' + (activeTab === "posts" ? " on" : "") + '" role="tab" aria-selected="' + (activeTab === "posts" ? "true" : "false") + '" href="' + esc(profileHref) + '"><span>' + esc(tr("Posts")) + '</span></a>' +
      '<a class="tab' + (activeTab === "friends" ? " on" : "") + '" role="tab" aria-selected="' + (activeTab === "friends" ? "true" : "false") + '" href="' + esc(friendsHref) + '"><span>' + esc(tr("Friends")) + (accountStat(account, "friends") > 0 ? ' <small class="tab-n">(' + formatNum(accountStat(account, "friends")) + ')</small>' : '') + '</span></a>' +
      (showAbout ? '<a class="tab' + (activeTab === "about" ? " on" : "") + '" role="tab" aria-selected="' + (activeTab === "about" ? "true" : "false") + '" href="' + esc(profileHref + "?tab=about") + '"><span>' + esc(tr("About")) + "</span></a>" : "") +
      (showGifts ? '<a class="tab' + (activeTab === "gifts" ? " on" : "") + '" role="tab" aria-selected="' + (activeTab === "gifts" ? "true" : "false") + '" href="' + esc(profileHref + "?tab=gifts") + '"><span>' + esc(tr("Gifts")) + "</span></a>" : "") +
    '</div>';

    var seenLine = mine && account.publicId && window.ViktorychPresence ? window.ViktorychPresence.linesHtml(account.publicId) : "";
    var lock = account.privateFollows ? '<span class="protected-badge" title="' + esc(tr("Private account")) + '" aria-label="' + esc(tr("Private account")) + '">' + lockIcon(18) + "</span>" : "";
    var top = window.ViktorychProfile && window.ViktorychProfile.top ? window.ViktorychProfile.top({
      name: account.displayName || account.handle || "",
      platform: "app",
      handle: account.handle || "",
      feedId: account.publicId ? "app:" + account.publicId : "",
      url: "",
      own: !!mine,
      count: tr("{count} posts", { count: count })
    }, banner) : banner;
    top = birthdayBanner + top;
    return top + '<div class="pinfo"><div class="pava-row">' + photo + '<div class="pactions">' + edit + giftBtn + followBtn + friendBtn + seenLine + '</div></div><h1 class="pname">' + esc(account.displayName || account.handle) + lock + (account.owner ? badge() : "") + '</h1><div class="phandle">@' + esc(account.handle) + '</div>' + mutualLine + (account.bio ? '<div class="pbio">' + esc(account.bio) + "</div>" : "") + (account.location ? '<div class="acct-loc">' + esc(account.location) + "</div>" : "") + (siteHref(account.website) ? '<div class="acct-loc"><a href="' + esc(siteHref(account.website)) + '" target="_blank" rel="noopener noreferrer">' + esc(account.website) + "</a></div>" : "") + linkedIdentitiesHtml(account) + (account.profileLess ? '<div class="private-badge" style="margin:4px 0 8px">' + esc(tr("Profile-less (not visible to others)")) + '</div>' : "") + accountCountsHtml(account) + "</div>" + highlightRow + tabs + body + galleryHtml(account);
  }
  function profileHtml(route) {
    if (!route || route.name !== "profile" || !route.handle || route.handle === "_") return "";
    var key = skel(route.handle);
    if (profileMiss[key]) return "";
    var account = profiles[key];
    var session = readSession();
    if (!account && session && session.account && (skel(session.account.handle) === key || skel(session.account.handle + (session.account.publicId || "")) === key || session.account.publicId === route.handle)) account = session.account;
    if (!account && /\d{12}$/.test(route.handle)) {
      account = profiles[skel(route.handle.slice(-12))];
    }
    if (!account) {
      loadProfile(route.handle);
      return "";
    }
    if (!account.repostsLoaded) loadProfile(route.handle);
    if (account.handle && skel(account.handle) !== key) {
      var nextHash = "#/@" + encodeURIComponent(account.handle);
      var tab = route.query && route.query.get && route.query.get("tab");
      if (tab) nextHash += "?tab=" + encodeURIComponent(tab);
      if ((location.hash || "") !== nextHash) location.replace(nextHash);
    }
    return accountPage(account, route);
  }
  function profilePending(handle) {
    var key = skel(handle);
    return !!(profileLoads[key] && !profiles[key] && !profileMiss[key]);
  }
  function profileReady(handle) {
    var key = skel(handle);
    if (profileMiss[key]) return true;
    return !!(profiles[key] && profiles[key].repostsLoaded);
  }
  function storedAccount(handle) {
    return profiles[skel(handle)] || null;
  }
  function pillInner() {
    var session = readSession();
    if (!session || !session.account) {
      return '<span class="ava initials" data-acct="login">?</span><span class="account-meta" data-acct="login"><b>' + esc(tr("Sign in")) + '</b><span>' + esc(tr("Not signed in")) + '</span></span>';
    }
    var account = session.account;
    var photo = presenceWrap(account.publicId, publicAvatar(account.avatar, account.avatarFace, ""), true);
    var isAnon = !!account.profileLess;
    var name = isAnon ? (account.displayName || tr("Anonymous")) : (account.displayName || "");
    var sub = isAnon ? tr("Profile-less") : "@" + (account.handle || "");
    return photo + '<span class="account-meta"><b>' + esc(name) + "</b><span>" + esc(sub) + "</span></span>";
  }
  function drawerTools() {
    return '<div class="drawer-id-tools">' +
      '<button class="icon-btn" type="button" data-act="drawer-accounts" aria-label="' + esc(tr("Accounts")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h9v-2.5c0-.9.3-1.7.8-2.4A12 12 0 0 0 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg></button>' +
      '<button class="icon-btn" type="button" data-act="drawer-more" aria-label="' + esc(tr("Account menu")) + '" aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg></button>' +
      '</div>';
  }
  function drawerHead() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="drawer-id">' +
        '<div class="drawer-id-top"><button class="drawer-ava" type="button" data-acct="login" aria-label="' + esc(tr("Sign in")) + '"><span class="ava initials">?</span></button>' + drawerTools() + '</div>' +
        '<button class="drawer-name" type="button" data-acct="login"><b>' + esc(tr("Sign in")) + '</b></button>' +
        '<div class="drawer-handle">' + esc(tr("Not signed in")) + '</div>' +
        '</div>';
    }
    var account = session.account;
    var photo = presenceWrap(account.publicId, publicAvatar(account.avatar, account.avatarFace, ""), false);
    var isAnon = !!account.profileLess;
    var name = isAnon ? (account.displayName || tr("Anonymous")) : (account.displayName || "");
    var sub = isAnon ? tr("Profile-less account") : "@" + (account.handle || "");
    var href = account.handle ? "#/@" + encodeURIComponent(account.handle) : "#/settings";
    var lock = (account.privateFollows || account.locked) ? '<span class="drawer-lock" title="' + esc(tr("Private account")) + '">' + lockIcon(16) + '</span>' : "";
    var following = accountStat(account, "following");
    var followers = accountStat(account, "followers");
    var followerLabel = followers === 1 ? tr("Follower") : tr("Followers");
    if (accountRef(account)) ensureCounts(accountRef(account));
    return '<div class="drawer-id">' +
      '<div class="drawer-id-top"><a class="drawer-ava" href="' + esc(href) + '">' + photo + '</a>' + drawerTools() + '</div>' +
      '<a class="drawer-name" href="' + esc(href) + '"><b>' + esc(name) + '</b>' + lock + '</a>' +
      '<a class="drawer-handle" href="' + esc(href) + '">' + esc(sub) + '</a>' +
      '<div class="drawer-counts"><a href="' + esc(href + "/following") + '"><b>' + esc(formatNum(following)) + '</b> ' + esc(tr("Following count")) + '</a><a href="' + esc(href + "/followers") + '"><b>' + esc(formatNum(followers)) + '</b> ' + esc(followerLabel) + '</a></div>' +
      '</div>';
  }
  var tiktokHealth = null;
  var tiktokHealthAt = 0;
  var backupChannels = null;
  var backupChannelNote = "";
  var backupChannelsAt = 0;
  function loadTikTokHealth() {
    var session = readSession();
    if (!session || !session.token || !session.account || !session.account.owner) return;
    if (Date.now() - tiktokHealthAt < 20000) return;
    tiktokHealthAt = Date.now();
    api("/v1/owner/tiktok/health", { token: session.token }).then(function (body) {
      if (!body || body.status !== 200) return;
      tiktokHealth = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function healthWhen(value) {
    if (!value) return "";
    try { return new Date(value).toLocaleString(); } catch (err) { return String(value); }
  }
  function healthHtml() {
    var body = tiktokHealth;
    var locked = false;
    try { locked = typeof localStorage !== "undefined" && localStorage.getItem("viktorych_shorts_locked") === "1"; } catch (e) {}
    var rows = body && body.backoffs || [];
    var accounts = body && body.accounts || [];
    if (locked) {
      var allow = window.ViktorychShorts && window.ViktorychShorts.isUnlocked;
      rows = rows.filter(function (r) {
        return allow ? allow(r && r.handle) : false;
      });
      accounts = accounts.filter(function (r) {
        return allow ? allow(r && r.handle) : false;
      });
    }
    var checked = body && body.checkedAt ? healthWhen(body.checkedAt) : "";
    var checkLine = '<p class="phandle">' + esc(checked ? tr("Last check {time}", { time: checked }) : tr("No check yet.")) + "</p>";
    var accountLines = accounts.map(function (row) {
      var status = row.status === "live" ? tr("LIVE") : row.status === "blocked" ? tr("Blocked") : row.status === "offline" ? tr("Offline") : "";
      var rec = row.recording ? tr("Recording") : (row.lastRecordingAt ? tr("Last recording {time}", { time: healthWhen(row.lastRecordingAt) }) : "");
      var bits = ["@" + String(row.handle || ""), status, rec].filter(Boolean);
      return '<p class="phandle">' + esc(bits.join(" · ")) + "</p>";
    }).join("");
    var blocked = body ? (body.blocked403 || 0) + (body.blocked429 || 0) + (body.captcha || 0) : 0;
    var lines = '<p class="phandle">' + esc(tr("No recent blocks.")) + "</p>";
    if (body && (blocked || rows.length)) {
      lines = '<p class="phandle">' + esc("403 " + (body.blocked403 || 0) + " · 429 " + (body.blocked429 || 0) + " · captcha " + (body.captcha || 0)) + "</p>";
      lines += rows.map(function (row) {
        var when = "";
        try { when = row.until ? new Date(row.until).toLocaleString() : ""; } catch (err) { when = row.until || ""; }
        return '<p class="phandle">@' + esc(row.handle || "") + " " + esc(tr("Backing off until {time}", { time: when })) + "</p>";
      }).join("");
    }
    return '<div class="set-block"><h2>' + esc(tr("TikTok health")) + "</h2>" + checkLine + accountLines + lines + "</div>";
  }
  function addBackupChannel() {
    var session = readSession();
    var input = document.querySelector('input[name="backup-channel"]');
    var channel = input ? String(input.value || "").trim() : "";
    if (!session || !session.token || !channel) return;
    api("/v1/owner/tiktok/channels", { method: "POST", token: session.token, body: { channel: channel } }).then(function (body) {
      if (!body || body.status !== 200) {
        backupChannelNote = tr("That channel id was not saved.");
      } else {
        backupChannels = body;
        backupChannelNote = "";
        if (input) input.value = "";
      }
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      backupChannelNote = tr("That channel id was not saved.");
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function removeBackupChannel(index) {
    var session = readSession();
    if (!session || !session.token || index == null || index === "") return;
    api("/v1/owner/tiktok/channels", { method: "POST", token: session.token, body: { remove: Number(index) } }).then(function (body) {
      if (body && body.status === 200) backupChannels = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function loadBackupChannels() {
    var session = readSession();
    if (!session || !session.token || !session.account || !session.account.owner) return;
    if (Date.now() - backupChannelsAt < 20000) return;
    backupChannelsAt = Date.now();
    api("/v1/owner/tiktok/channels", { token: session.token }).then(function (body) {
      if (!body || body.status !== 200) return;
      backupChannels = body;
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function channelsHtml() {
    var body = backupChannels;
    var extra = body && body.extra ? body.extra : 0;
    var masks = body && body.masks || [];
    var list = masks.map(function (mask, index) {
      return '<button class="outline" type="button" data-acct="remove-channel" data-index="' + index + '">' + esc(tr("Remove {channel}", { channel: mask })) + "</button>";
    }).join("");
    return '<div class="set-block"><h2>' + esc(tr("Backup channels")) + "</h2>" +
      '<p class="set-sub">' + esc(tr("The same bot posts there. Lives are spread across these channels.")) + "</p>" +
      '<p class="phandle">' + esc(tr("{count} extra channels", { count: String(extra) })) + "</p>" +
      list +
      '<input name="backup-channel" autocomplete="off" spellcheck="false" placeholder="-100…" aria-label="' + esc(tr("Add a backup channel")) + '">' +
      '<button class="outline" type="button" data-acct="add-channel">' + esc(tr("Add a backup channel")) + "</button>" +
      (backupChannelNote ? '<p class="phandle">' + esc(backupChannelNote) + "</p>" : "") +
      "</div>";
  }
  function isOwnerAccount(account) {
    if (!account) return false;
    if (account.owner) return true;
    var id = String(account.publicId || "");
    if (id === "emergency_owner") return true;
    var handle = String(account.handle || "");
    var checked = window.HandleSkeleton && window.HandleSkeleton.inspectHandle ? window.HandleSkeleton.inspectHandle(handle) : null;
    return !!(checked && checked.owner);
  }
  function deleteEntryHtml(account) {
    if (isOwnerAccount(account)) return "";
    return '<h2>' + esc(tr("Delete account")) + '</h2><p class="set-sub">' + esc(tr("Permanently delete this account and the data tied to it.")) + '</p><button class="outline acct-danger" type="button" data-acct="open-delete">' + esc(tr("Delete account")) + "</button>";
  }
  function deleteReady() {
    var session = readSession();
    var account = session && session.account;
    if (!account || isOwnerAccount(account)) return false;
    var typed = String(deleteState.handle || "").trim().replace(/^@/, "");
    var digits = String(deleteState.accountNumber || "").replace(/\D/g, "");
    return typed === String(account.handle || "") && /^\d{16}$/.test(digits);
  }
  function deleteAccountHtml() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="set-block acct-settings"><p class="phandle">' + esc(tr("Not signed in")) + "</p></div>";
    }
    if (isOwnerAccount(session.account)) {
      return '<div class="set-block acct-settings"><p class="phandle">' + esc(tr("This account cannot be deleted.")) + "</p></div>";
    }
    if (deleteState.phase === "progress") {
      var labels = [tr("Checking your account"), tr("Removing the account"), tr("Removing saved files"), tr("Updating the public copy"), tr("Clearing this device")];
      var items = labels.map(function (label, index) {
        return '<li class="' + (index <= deleteState.step ? "on" : "") + '">' + esc(label) + "</li>";
      }).join("");
      return '<div class="set-block acct-settings"><h2>' + esc(tr("Deleting your account")) + '</h2><ul class="acct-progress" aria-live="polite">' + items + "</ul></div>";
    }
    var ready = deleteReady();
    return '<div class="set-block acct-settings" data-delete-form><p class="set-sub">' + esc(tr("This permanently deletes this account. Your profile, photos, sessions, follows, followers, friends, notification tabs, feed settings, groups, drafts, likes, bookmarks, watch history, community posts, vault, drive files, linked accounts, and uploads are removed. The handle can stay reserved so nobody else can take it. This cannot be undone.")) + '</p><div class="acct-field"><input id="acct-delete-number" name="accountNumber" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder=" " data-max="16" value="' + esc(grouped(deleteState.accountNumber || "")) + '"><label for="acct-delete-number">' + esc(tr("Enter your account number again.")) + '</label></div><div class="acct-field"><input id="acct-delete-handle" name="confirmHandle" type="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder=" " value="' + esc(deleteState.handle || "") + '"><label for="acct-delete-handle">' + esc(tr("Confirm your handle")) + '</label></div><p class="acct-error">' + esc(deleteState.error || "") + '</p><button class="acct-next acct-danger" type="button" data-acct="delete-go"' + (ready && !deleteState.busy ? "" : " disabled") + ">" + esc(tr("Delete account")) + "</button></div>";
  }
  function wipeDevice() {
    var prefixes = ["viktorychapp-", "superintelapp-", "rss-" + "feeds-", "va_cm_"];
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (key) {
        if (!key) return;
        for (var p = 0; p < prefixes.length; p++) {
          if (key.indexOf(prefixes[p]) === 0) {
            localStorage.removeItem(key);
            return;
          }
        }
      });
      localStorage.removeItem("yt-ambient-mode");
      localStorage.removeItem("viktorych_shorts_locked");
    } catch (err) { /* private mode */ }
    try {
      sessionStorage.clear();
      sessionStorage.setItem(DELETED_KEY, "1");
    } catch (err) { /* the screen still replaces the page */ }
    var databases = ["superintel-history", "viktorych-drive", "viktorychapp-live", "superintelapp-live", "sintel-music", "superintelapp-sw", "viktorych-discord"];
    if (window.indexedDB && indexedDB.deleteDatabase) {
      databases.forEach(function (name) {
        try { indexedDB.deleteDatabase(name); } catch (err) { /* already gone */ }
      });
    }
    try { window.dispatchEvent(new Event("viktorych-account-deleted")); } catch (err) { /* storage.js clears the same caches */ }
    var msg = { type: "account-deleted" };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
    } catch (err) { /* the worker may still be installing */ }
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.active) reg.active.postMessage(msg);
      }).catch(function () {});
    }
    tellSW(false, "signout");
  }
  function deletePause(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function deleteError(code) {
    if (code === "invalid_credentials") return tr("The account number does not match.");
    if (code === "handle_mismatch") return tr("The handle does not match.");
    if (code === "owner_protected") return tr("This account cannot be deleted.");
    if (code === "rate_limited") return tr("Too many attempts. Try again later.");
    return tr("Deletion did not finish. Try again.");
  }
  function deletionAccepted(res) {
    if (!res || res.status !== 200 || !res.ok) return false;
    if (res.deletion === "complete") return true;
    var steps = res.steps || {};
    return res.deletion === "pending" && !!steps.database && !!steps.sessions;
  }
  function showDeleteStep(step) {
    deleteState.phase = "progress";
    deleteState.step = step;
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function finishDelete(res) {
    var failed = !res || res.status === 400 || res.status === 401 || res.status === 403 || res.status === 415 || res.status === 429 || res.status === 503 || !res.ok;
    if (failed) {
      deleteState.busy = false;
      deleteState.phase = "";
      deleteState.error = deleteError(res && res.error);
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return Promise.resolve();
    }
    var next = Promise.resolve(res);
    if (res.deletion === "pending" && res.resumeToken && !(res.steps && res.steps.database)) {
      next = api("/v1/account/delete", {
        method: "POST",
        headers: { "X-Viktorych-Intent": "account-delete" },
        body: { resumeToken: res.resumeToken }
      });
    }
    return next.then(function (done) {
      if (!deletionAccepted(done)) {
        deleteState.busy = false;
        deleteState.phase = "";
        deleteState.error = tr("Deletion did not finish. Try again.");
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        return;
      }
      return deletePause(40).then(function () { showDeleteStep(1); return deletePause(40); })
        .then(function () { showDeleteStep(2); return deletePause(40); })
        .then(function () { showDeleteStep(3); return deletePause(40); })
        .then(function () { showDeleteStep(4); return deletePause(40); })
        .then(function () {
          wipeDevice();
          showDeleted();
        });
    });
  }
  function doDelete() {
    if (deleteState.busy) return;
    var session = readSession();
    if (!session || !session.account || !session.token || isOwnerAccount(session.account)) return;
    if (!deleteReady()) {
      deleteState.error = tr("The handle does not match.");
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return;
    }
    deleteState.busy = true;
    deleteState.error = "";
    showDeleteStep(0);
    api("/v1/account/delete", {
      method: "POST",
      token: session.token,
      headers: { "X-Viktorych-Intent": "account-delete" },
      body: {
        handle: session.account.handle,
        accountNumber: String(deleteState.accountNumber || "").replace(/\D/g, "")
      }
    }).then(finishDelete, function () {
      deleteState.busy = false;
      deleteState.phase = "";
      deleteState.error = tr("Deletion did not finish. Try again.");
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function ensureMediaManager() {
    var session = readSession();
    if (!session || mediaManagerLoaded || !hasApi()) return;
    if (session.account && Array.isArray(session.account.photos)) {
      mediaManagerLoaded = true;
      return;
    }
    mediaManagerLoaded = true;
    api("/v1/session", { token: session.token }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function applyOwnAccount(res) {
    var session = readSession();
    if (!session || !res || res.status !== 200 || !res.account) return false;
    session.account = res.account;
    writeSession(session);
    remember(res.account);
    if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    return true;
  }
  function saveMedia(body, method) {
    var session = readSession();
    if (!session) return;
    api("/v1/profile/media", { method: method || "PATCH", token: session.token, body: body }).then(applyOwnAccount).catch(function () {});
  }
  function readOriginalFile(file, maxBytes) {
    return new Promise(function (resolve) {
      if (!file || file.size > maxBytes) { resolve(""); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { resolve(""); };
      reader.readAsDataURL(file);
    });
  }
  function mediaCard(item, kind) {
    var vis = item.visibility || "everyone";
    function opt(value, label) {
      return '<option value="' + value + '"' + (vis === value ? " selected" : "") + ">" + esc(label) + "</option>";
    }
    return '<div class="media-privacy-card">' +
      photoHtml(item.url, kind === "banner" ? "media-privacy-banner" : "media-privacy-photo") +
      '<label>' + esc(kind === "banner" ? tr("Who can see this banner") : tr("Who can see this photo")) +
      '<select data-acct="media-vis" data-id="' + esc(item.id) + '">' +
      opt("everyone", tr("Everyone")) + opt("followers", tr("Followers")) + opt("friends", tr("Mutual follows")) + opt("nobody", tr("Only you")) +
      "</select></label>" +
      '<p class="set-sub">' + esc(tr("People you allow can always see it. People you block never can.")) + "</p>" +
      '<label>' + esc(tr("Always allow")) + '<input data-media-allow="' + esc(item.id) + '" value="' + esc((item.allow || []).join(", ")) + '" placeholder="@handle"></label>' +
      '<label>' + esc(tr("Never allow")) + '<input data-media-deny="' + esc(item.id) + '" value="' + esc((item.deny || []).join(", ")) + '" placeholder="@handle"></label>' +
      '<div class="media-privacy-actions">' +
      '<button class="outline" type="button" data-acct="media-save-except" data-id="' + esc(item.id) + '">' + esc(tr("Save")) + "</button>" +
      (item.main ? '<span class="media-main">' + esc(kind === "banner" ? tr("Main banner") : tr("Main photo")) + "</span>" : '<button class="outline" type="button" data-acct="media-main" data-id="' + esc(item.id) + '">' + esc(tr("Set as main")) + "</button>") +
      '<button class="outline" type="button" data-acct="media-fallback" data-id="' + esc(item.id) + '" data-on="' + (item.fallback ? "0" : "1") + '">' + esc(item.fallback ? (kind === "banner" ? tr("Public banner") : tr("Public photo")) : (kind === "banner" ? tr("Set public banner") : tr("Set public photo"))) + "</button>" +
      '<button class="outline" type="button" data-acct="media-up" data-id="' + esc(item.id) + '" data-kind="' + esc(kind) + '">' + esc(tr("Move up")) + "</button>" +
      '<button class="outline" type="button" data-acct="media-down" data-id="' + esc(item.id) + '" data-kind="' + esc(kind) + '">' + esc(tr("Move down")) + "</button>" +
      '<button class="outline" type="button" data-acct="media-delete" data-id="' + esc(item.id) + '">' + esc(kind === "banner" ? tr("Delete banner") : tr("Delete photo")) + "</button>" +
      "</div></div>";
  }
  function redraw() {
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function copyAccountId() {
    var session = readSession();
    var id = session && session.account && session.account.publicId;
    if (!id || !navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(String(id)).then(function () {
      idCopied = true;
      redraw();
      setTimeout(function () { idCopied = false; redraw(); }, 1600);
    }).catch(function () {});
  }
  function openGallery(kind) {
    gallery.open = true;
    gallery.kind = kind === "banner" ? "banner" : "photo";
    gallery.index = 0;
    redraw();
  }
  function stepGallery(delta) {
    gallery.index += delta;
    redraw();
  }
  function moveMedia(kind, id, delta) {
    var session = readSession();
    var account = session && session.account;
    if (!account || !id) return;
    var list = (kind === "banner" ? account.banners : account.photos) || [];
    var ids = list.map(function (item) { return item.id; });
    var at = ids.indexOf(id);
    var nextAt = at + delta;
    if (at < 0 || nextAt < 0 || nextAt >= ids.length) return;
    var swap = ids[at];
    ids[at] = ids[nextAt];
    ids[nextAt] = swap;
    saveMedia({ kind: kind === "banner" ? "banner" : "photo", order: ids });
  }
  function saveExceptions(id) {
    function handles(el) {
      return String(el && el.value || "").split(/[,\s]+/).map(function (item) { return item.replace(/^@/, ""); }).filter(Boolean);
    }
    var allowEl = document.querySelector('[data-media-allow="' + id + '"]');
    var denyEl = document.querySelector('[data-media-deny="' + id + '"]');
    saveMedia({ id: id, allow: handles(allowEl), deny: handles(denyEl) });
  }
  function pickExtra(kind) {
    var input = document.getElementById(kind === "banner" ? "extra-banner" : "extra-photo");
    if (!input) return;
    input.onchange = function () {
      var file = input.files && input.files[0];
      input.value = "";
      readOriginalFile(file, kind === "banner" ? 150 * 1024 : 60 * 1024).then(function (data) {
        if (!data) return;
        saveMedia({ kind: kind === "banner" ? "banner" : "photo", image: data }, "POST");
      });
    };
    input.click();
  }
  function privacyHtml() {
    ensureMediaManager();
    var session = readSession();
    var account = session && session.account;
    if (!account) return "";
    var photos = Array.isArray(account.photos) ? account.photos : [];
    var banners = Array.isArray(account.banners) ? account.banners : [];
    var note = account.privateFollows
      ? tr("A private account starts photos and banners at followers.")
      : tr("Photos and banners are visible to everyone until you change one.");
    return '<div class="media-privacy">' +
      '<h2>' + esc(tr("Profile photo privacy")) + "</h2>" +
      '<p class="set-sub">' + esc(note) + " " + esc(tr("Shown when someone cannot see your main photo")) + ".</p>" +
      photos.map(function (item) { return mediaCard(item, "photo"); }).join("") +
      '<button class="outline" type="button" data-acct="pick-extra" data-kind="photo">' + esc(tr("Add a profile photo")) + "</button>" +
      '<h2>' + esc(tr("Banner privacy")) + "</h2>" +
      banners.map(function (item) { return mediaCard(item, "banner"); }).join("") +
      '<button class="outline" type="button" data-acct="pick-extra" data-kind="banner">' + esc(tr("Add a banner")) + "</button>" +
      '<input class="acct-hidden" id="extra-photo" type="file" accept="image/jpeg,image/png,image/webp">' +
      '<input class="acct-hidden" id="extra-banner" type="file" accept="image/jpeg,image/png,image/webp">' +
      "</div>";
  }
  function settingsHtml() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + '</h2>' +
        '<p class="phandle">' + esc(tr("Not signed in")) + '</p>' +
        '<button class="outline" type="button" data-acct="login" style="margin-top:8px">' + esc(tr("Sign in to {app}", { app: appName() })) + '</button>' +
        '<button class="outline" type="button" data-acct="signup">' + esc(tr("Create account")) + '</button>' +
        '<button class="outline" type="button" data-acct="open-emergency">' + esc(tr("Emergency Offline Access")) + '</button>' +
        '<button class="outline" type="button" data-acct="open-restore">' + esc(tr("Restore session")) + '</button>' +
        '</div>';
    }
    var account = session.account;
    var hidden = account.hideAvatar === "none" || account.hideAvatar === "default" ? account.hideAvatar : "";
    function hideBtn(mode, label) {
      return '<button class="outline' + (hidden === mode ? " on" : "") + '" type="button" data-acct="hide-avatar" data-mode="' + mode + '">' + esc(label) + "</button>";
    }
    var health = "";
    if (account.owner) {
      loadTikTokHealth();
      loadBackupChannels();
      health = healthHtml() + channelsHtml();
    }
    if (window.ProfileAbout) window.ProfileAbout.ensure(account, "");
    var aboutPrivacy = window.ProfileAbout && window.ProfileAbout.privacyOpen() ? window.ProfileAbout.privacyHtml(account.about || { sections: [] }) : "";
    return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + "</h2><p class=\"phandle\">@" + esc(account.handle) + "</p><p class=\"phandle acct-id-row\"><span>" + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + '</span> <button class="outline" type="button" data-acct="copy-id">' + esc(idCopied ? tr("Account ID copied") : tr("Copy account ID")) + "</button></p><button class=\"outline\" type=\"button\" data-acct=\"edit\">" + esc(tr("Edit profile")) + '</button><button class="outline" type="button" data-about="privacy">' + esc(tr("About privacy")) + "</button>" + aboutPrivacy + '<h2>' + esc(tr("Hide my profile picture")) + '</h2><p class="set-sub">' + esc(tr("Other people see this instead of your photo.")) + '</p><div class="theme-row" role="group" aria-label="' + esc(tr("Hide my profile picture")) + '">' + hideBtn("", tr("Show my picture")) + hideBtn("default", tr("Default")) + hideBtn("none", tr("None")) + '</div><h2>' + esc(tr("Private followers and following")) + '</h2><p class="set-sub">' + esc(tr("Keep your followers and following list private. Only you will be able to see who you follow and who follows you.")) + '</p><button class="tab-switch' + (account.privateFollows ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.privateFollows ? "true" : "false") + '" data-acct="toggle-private-follows"><span>' + esc(tr("Keep lists private")) + '</span><i></i></button>' +
      '<h2>' + esc(tr("Protect your posts")) + '</h2><p class="set-sub">' + esc(tr("Only approved followers and friends can see your posts and lists.")) + '</p><button class="tab-switch' + (account.protected ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.protected ? "true" : "false") + '" data-acct="toggle-protected"><span>' + esc(tr("Protect your posts")) + '</span><i></i></button>' + relationSettingsHtml() +
      '<h2>' + esc(tr("Profile-less account")) + '</h2><p class="set-sub">' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p><button class="tab-switch' + (account.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.profileLess ? "true" : "false") + '" data-acct="toggle-profileless"><span>' + esc(tr("Profile-less")) + '</span><i></i></button>' + (function () { if (!federationState.loaded && !federationState.loading) loadFederationSettings(); return '<h2>' + esc(tr("Federation (Fediverse & Nostr)")) + '</h2><p class="set-sub">' + esc(tr("Allow Mastodon, Fediverse, and Nostr to discover and follow your internal account. Default is off.")) + '</p><button class="tab-switch' + (federationState.enabled_ap ? " on" : "") + '" type="button" role="switch" aria-checked="' + (federationState.enabled_ap ? "true" : "false") + '" data-acct="toggle-fed-ap"><span>' + esc(tr("Fediverse (ActivityPub)")) + (federationState.enabled_ap && federationState.ap_handle ? " (" + esc(federationState.ap_handle) + ")" : "") + '</span><i></i></button><button class="tab-switch' + (federationState.enabled_nostr ? " on" : "") + '" type="button" role="switch" aria-checked="' + (federationState.enabled_nostr ? "true" : "false") + '" data-acct="toggle-fed-nostr"><span>' + esc(tr("Nostr (NIP-05)")) + (federationState.enabled_nostr && federationState.nostr_nip05 ? " (" + esc(federationState.nostr_nip05) + ")" : "") + '</span><i></i></button>'; })() + '<h2>' + esc(tr("Linked social accounts")) + '</h2><p class="set-sub">' + esc(tr("Link your X, Telegram, Instagram, and YouTube accounts so their posts appear on your profile. Requires identity verification.")) + '</p>' + identitiesSettingsHtml(account) + '<h2>' + esc(tr("Recovery codes")) + '</h2><p class="set-sub">' + esc(tr("These codes are shown once. Old codes stop working when you create new ones.")) + '</p><button class="outline" type="button" data-acct="recovery-new">' + esc(tr("Create new recovery codes")) + "</button>" + (account.owner ? '<h2>' + esc(tr("Review reports")) + '</h2><button class="outline" type="button" data-acct="open-reports">' + esc(tr("Review reports")) + "</button>" : "") + '<h2>' + esc(tr("Device sync")) + '</h2><p class="set-sub">' + esc(tr("Transfer your session to another browser or device.")) + '</p><button class="outline" type="button" data-acct="copy-session">' + esc(tr("Copy session code")) + "</button>" + deleteEntryHtml(account) + '<button class="outline" type="button" data-acct="logout">' + esc(tr("Log out")) + '</button><button class="outline" type="button" data-acct="logout-all">' + esc(tr("Log out of all devices")) + "</button></div>" + health;  }
  function onClick(event) {
    var friendSub = event.target && event.target.closest ? event.target.closest("[data-friend-sub]") : null;
    if (friendSub) {
      event.preventDefault();
      event.stopPropagation();
      friendsSubTab = friendSub.dataset.friendSub || "all";
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return;
    }
    var friendAct = event.target && event.target.closest ? event.target.closest("[data-friend-act]") : null;
    if (friendAct) {
      event.preventDefault();
      event.stopPropagation();
      var fact = friendAct.dataset.friendAct;
      var fid = friendAct.dataset.friendId;
      var fhandle = friendAct.dataset.handle;
      if (fact === "unfriend") {
        unfriendTarget = { id: fid, handle: fhandle };
        view = "unfriend";
        paint();
        return;
      }
      if (fact === "unfriend-confirm") {
        if (unfriendTarget) {
          doFriendAction("remove", unfriendTarget.id, unfriendTarget.handle);
          unfriendTarget = null;
        }
        closeAuth();
        return;
      }
      if (fact === "request" || fact === "accept" || fact === "decline" || fact === "cancel") {
        doFriendAction(fact, fid, fhandle);
        return;
      }
    }
    var acct = event.target && event.target.closest ? event.target.closest("[data-acct]") : null;
    if (!acct) return;
    var act = acct.dataset.acct;
    if (act === "saved" || act === "do-login" || act === "do-recover") return;
    event.preventDefault();
    event.stopPropagation();
    if (act === "presence-open") {
      if (window.ViktorychPresence) window.ViktorychPresence.open(acct);
      return;
    }
    if (act === "signup") openAuth("signup");
    else if (act === "login") openAuth("login");
    else if (act === "open-restore") openAuth("restore");
    else if (act === "open-emergency") openAuth("emergency");
    else if (act === "close") closeAuth();
    else if (act === "open-link-identity") {
      linkIdentityForm = { platform: "x", handle: "", proofUrl: "", step: 0, challenge: null, loading: false };
      errorText = "";
      view = "link-identity";
      paint();
    }
    else if (act === "gen-challenge") {
      if (!linkIdentityForm.handle) {
        errorText = tr("Username or channel");
        paint();
        return;
      }
      var session = readSession();
      if (!session) return;
      linkIdentityForm.loading = true;
      errorText = "";
      paint();
      api("/v1/account/identities/challenge", {
        method: "POST",
        token: session.token,
        body: { platform: linkIdentityForm.platform, handle: linkIdentityForm.handle }
      }).then(function (res) {
        linkIdentityForm.loading = false;
        if (!res || !res.ok) {
          errorText = (res && res.error === "identity_already_linked") ? tr("Identity confirmed and linked!") : tr("Verification failed. Make sure the code is in your bio or post.");
          paint();
          return;
        }
        linkIdentityForm.challenge = res;
        linkIdentityForm.step = 1;
        paint();
      }).catch(function () {
        linkIdentityForm.loading = false;
        errorText = tr("Verification failed. Make sure the code is in your bio or post.");
        paint();
      });
    }
    else if (act === "copy-code") {
      if (linkIdentityForm.challenge && linkIdentityForm.challenge.code) {
        try { navigator.clipboard.writeText(linkIdentityForm.challenge.code); } catch (e) {}
        copiedIdentityCode = true;
        paint();
        setTimeout(function () { copiedIdentityCode = false; paint(); }, 2000);
      }
    }
    else if (act === "verify-identity") {
      var session = readSession();
      if (!session || !linkIdentityForm.challenge) return;
      linkIdentityForm.loading = true;
      errorText = "";
      paint();
      api("/v1/account/identities/verify", {
        method: "POST",
        token: session.token,
        body: { challengeId: linkIdentityForm.challenge.challengeId, proofUrl: linkIdentityForm.proofUrl }
      }).then(function (res) {
        linkIdentityForm.loading = false;
        if (!res || !res.ok) {
          errorText = tr("Verification failed. Make sure the code is in your bio or post.");
          paint();
          return;
        }
        linkIdentityForm.step = 2;
        var ident = res.identity;
        if (session.account) {
          var idList = session.account.identities || [];
          idList = idList.filter(function (it) { return !(it.platform === ident.platform && String(it.handle).toLowerCase() === String(ident.handle).toLowerCase()); });
          idList.push(ident);
          session.account.identities = idList;
          writeSession(session);
          if (profiles[skel(session.account.handle)]) {
            profiles[skel(session.account.handle)].identities = idList;
          }
        }
        paint();
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }).catch(function () {
        linkIdentityForm.loading = false;
        errorText = tr("Verification failed. Make sure the code is in your bio or post.");
        paint();
      });
    }
    else if (act === "back-identity") {
      linkIdentityForm.step = 0;
      errorText = "";
      paint();
    }
    else if (act === "unlink-identity") {
      var session = readSession();
      if (!session) return;
      var unlinkPlat = acct.dataset.platform;
      var unlinkHandle = acct.dataset.handle;
      api("/v1/account/identities", {
        method: "DELETE",
        token: session.token,
        body: { platform: unlinkPlat, handle: unlinkHandle }
      }).then(function (res) {
        if (res && res.ok && session.account) {
          session.account.identities = (session.account.identities || []).filter(function (it) {
            return !(it.platform === unlinkPlat && String(it.handle).toLowerCase() === String(unlinkHandle).toLowerCase());
          });
          writeSession(session);
          if (profiles[skel(session.account.handle)]) {
            profiles[skel(session.account.handle)].identities = session.account.identities;
          }
          paint();
          if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
        }
      }).catch(function () {});
    }
    else if (act === "stay") { view = "signup"; step = 2; paint(); }
    else if (act === "next") nextSignup();
    else if (act === "passkey-signup") doPasskeySignup();
    else if (act === "passkey-login") doPasskeyLogin();
    else if (act === "do-login") doLogin();
    else if (act === "lost") { view = "lost"; errorText = ""; form.recovery = ""; paint(); }
    else if (act === "do-recover") doRecover();
    else if (act === "save-passkey") savePasskeyNow();
    else if (act === "show-number") {
      var secret = document.getElementById("acct-new-password");
      if (secret) secret.type = secret.type === "password" ? "text" : "password";
    }
    else if (act === "copy-codes") copyCodes();
    else if (act === "download-codes") downloadCodes();
    else if (act === "recovery-new") regenerateCodes();
    else if (act === "open-reports") { view = "reports"; errorText = ""; reportState.items = []; paint(); loadReports(); }
    else if (act === "report-hide") resolveReport(acct.dataset.id, "hide");
    else if (act === "report-dismiss") resolveReport(acct.dataset.id, "dismiss");
    else if (act === "do-emergency") doEmergency();
    else if (act === "do-restore") doRestoreSession();
    else if (act === "copy-session") copySession();
    else if (act === "claim") { form.claimOpen = true; paint(); }
    else if (act === "copy") copyNumber();
    else if (act === "download") downloadNumber();
    else if (act === "saved") finishPending();
    else if (act === "prefs") { view = "prefs"; errorText = ""; paint(); }
    else if (act === "lang") {
      try { localStorage.setItem("viktorychapp-lang-user-picked", "1"); } catch (err) { /* the choice still applies for this page */ }
      if (window.SI18n && window.SI18n.setLang) window.SI18n.setLang(acct.dataset.lang || "en");
      else paint();
    }
    else if (act === "appearance") { applyWallTheme(acct.dataset.mode || "lightsout"); paint(); }
    else if (act === "abandon") abandon();
    else if (act === "edit") openAuth("edit");
    else if (act === "save-profile") saveProfile();
    else if (act === "media-menu") {
      var kind = acct.dataset.kind === "banner" ? "banner" : "avatar";
      form.mediaMenu = form.mediaMenu === kind ? "" : kind;
      paint();
    }
    else if (act === "pick-avatar" || act === "pick-banner") {
      form.mediaMenu = "";
      var input = document.querySelector('#account-layer input[name="' + (act === "pick-avatar" ? "avatar" : "banner") + '"]');
      if (input) input.click();
      else paint();
    }
    else if (act === "face") {
      var faceKind = acct.dataset.kind === "banner" ? "banner" : "avatar";
      var faceMode = acct.dataset.mode === "none" ? "none" : "default";
      if (faceKind === "banner") {
        form.banner = "";
        form.bannerTouched = true;
        form.bannerEmpty = faceMode;
      } else {
        form.avatar = "";
        form.avatarTouched = true;
        form.avatarEmpty = faceMode;
      }
      form.mediaMenu = "";
      paint();
    }
    else if (act === "banner-clear") { form.banner = ""; form.bannerTouched = true; form.bannerEmpty = "default"; form.mediaMenu = ""; paint(); }
    else if (act === "avatar-clear") { form.avatar = ""; form.avatarTouched = true; form.avatarEmpty = "default"; form.mediaMenu = ""; paint(); }
    else if (act === "toggle-form-private") { form.privateFollows = !form.privateFollows; paint(); }
    else if (act === "toggle-form-profileless") { form.profileLess = !form.profileLess; paint(); }
    else if (act === "toggle-private-follows") { var s = readSession(); if (s && s.account) setPrivateFollows(!s.account.privateFollows); }
    else if (act === "toggle-protected") { var sp = readSession(); if (sp && sp.account) setProtected(!sp.account.protected); }
    else if (act === "unblock-account" || act === "unmute-account-server") {
      var rid = acct.dataset.id;
      relationWrite(act === "unblock-account" ? "blocks" : "mutes", rid, true);
    }
    else if (act === "toggle-profileless") { var s = readSession(); if (s && s.account) setProfileLess(!s.account.profileLess); }
    else if (act === "toggle-fed-ap") toggleFederationAp();
    else if (act === "toggle-fed-nostr") toggleFederationNostr();
    else if (act === "hide-avatar") hideAvatar(acct.dataset.mode || "");
    else if (act === "crop-apply") applyCrop();
    else if (act === "logout") logout(false);
    else if (act === "open-delete") {
      deleteState = { phase: "", error: "", step: -1, accountNumber: "", handle: "", busy: false };
      location.hash = "#/settings/delete-account";
    }
    else if (act === "delete-go") doDelete();
    else if (act === "deleted-done") {
      try { sessionStorage.removeItem(DELETED_KEY); } catch (err) { /* the next load shows sign-in */ }
      document.documentElement.removeAttribute("data-wall");
      location.replace(location.pathname + location.search);
      location.reload();
    }
    else if (act === "add-channel") addBackupChannel();
    else if (act === "remove-channel") removeBackupChannel(acct.dataset.index);
    else if (act === "logout-all") logout(true);
else if (act === "copy-id") copyAccountId();
    else if (act === "open-gallery") openGallery(acct.dataset.kind || "photo");
    else if (act === "gallery-close") { gallery.open = false; redraw(); }
    else if (act === "gallery-prev" || act === "gallery-next") stepGallery(act === "gallery-next" ? 1 : -1);
    else if (act === "media-main") saveMedia({ id: acct.dataset.id, main: true });
    else if (act === "media-fallback") saveMedia({ id: acct.dataset.id, fallback: acct.dataset.on === "1" });
    else if (act === "media-delete") saveMedia({ id: acct.dataset.id }, "DELETE");
    else if (act === "media-up" || act === "media-down") moveMedia(acct.dataset.kind, acct.dataset.id, act === "media-down" ? 1 : -1);
    else if (act === "media-save-except") saveExceptions(acct.dataset.id);
    else if (act === "pick-extra") pickExtra(acct.dataset.kind || "photo");
    else if (act === "legal") { legalKey = acct.dataset.legal || "about"; legalTitle = acct.dataset.title || tr("About"); view = "legal"; paint(); }
  }
  var federationState = { loaded: false, loading: false, enabled_ap: false, enabled_nostr: false, nostr_pubkey: "", ap_handle: "", nostr_nip05: "" };
  function loadFederationSettings() {
    var session = readSession();
    if (!session || !session.token || federationState.loading) return;
    federationState.loading = true;
    api("/v1/federation/settings", { token: session.token }).then(function (res) {
      federationState.loading = false;
      if (res && res.status === 200) {
        federationState.loaded = true;
        federationState.enabled_ap = !!res.enabled_ap;
        federationState.enabled_nostr = !!res.enabled_nostr;
        federationState.nostr_pubkey = res.nostr_pubkey || "";
        federationState.ap_handle = res.ap_handle || "";
        federationState.nostr_nip05 = res.nostr_nip05 || "";
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () {
      federationState.loading = false;
    });
  }
  function toggleFederationAp() {
    var session = readSession();
    if (!session || !session.token) return;
    var next = !federationState.enabled_ap;
    api("/v1/federation/settings", { method: "POST", token: session.token, body: { enabled_ap: next } }).then(function (res) {
      if (res && res.status === 200) {
        federationState.loaded = true;
        federationState.enabled_ap = !!res.enabled_ap;
        federationState.ap_handle = res.ap_handle || "";
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () {});
  }
  function toggleFederationNostr() {
    var session = readSession();
    if (!session || !session.token) return;
    var next = !federationState.enabled_nostr;
    var pubkey = federationState.nostr_pubkey;
    if (next && !pubkey) {
      var entered = window.prompt("Enter your Nostr public key (npub or hex):", "");
      if (!entered) return;
      pubkey = entered.trim();
    }
    api("/v1/federation/settings", { method: "POST", token: session.token, body: { enabled_nostr: next, nostr_pubkey: pubkey } }).then(function (res) {
      if (res && res.status === 200) {
        federationState.loaded = true;
        federationState.enabled_nostr = !!res.enabled_nostr;
        federationState.nostr_pubkey = res.nostr_pubkey || "";
        federationState.nostr_nip05 = res.nostr_nip05 || "";
        if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () {});
  }
  var cropDrag = null;
  var galleryDrag = null;
  function setProfileLess(val) {
    var session = readSession();
    if (!session) return;
    var next = !!val;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { profileLess: next } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      dirtyLists();
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  var relationCache = { blocks: null, mutes: null, loading: false };
  function ensureRelations() {
    var session = readSession();
    if (!session || !hasApi() || relationCache.loading || relationCache.blocks) return;
    relationCache.loading = true;
    Promise.all([
      api("/v1/blocks", { token: session.token }),
      api("/v1/mutes", { token: session.token })
    ]).then(function (pair) {
      relationCache.loading = false;
      relationCache.blocks = pair[0] && pair[0].status === 200 && Array.isArray(pair[0].accounts) ? pair[0].accounts : [];
      relationCache.mutes = pair[1] && pair[1].status === 200 && Array.isArray(pair[1].accounts) ? pair[1].accounts : [];
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { relationCache.loading = false; });
  }
  function relationRows(list, act, label) {
    if (!list || !list.length) return '<p class="set-sub">' + esc(label) + '</p>';
    return list.map(function (item) {
      var id = String(item.id || "").replace(/^app:/, "");
      return '<div class="mute-row"><span>@' + esc(item.handle || item.name || "") + '</span><button type="button" data-acct="' + act + '" data-id="' + esc(id) + '">' + esc(act === "unblock-account" ? tr("Unblock") : tr("Unmute")) + '</button></div>';
    }).join("");
  }
  function relationSettingsHtml() {
    ensureRelations();
    return '<h2>' + esc(tr("Blocked accounts")) + '</h2>' + relationRows(relationCache.blocks, "unblock-account", tr("No blocked accounts")) +
      '<h2>' + esc(tr("Muted accounts")) + '</h2>' + relationRows(relationCache.mutes, "unmute-account-server", tr("No muted accounts"));
  }
  function relationWrite(kind, id, remove) {
    var session = readSession();
    if (!session || !id) return;
    api("/v1/" + kind, { method: remove ? "DELETE" : "PUT", token: session.token, body: { id: id } }).then(function (res) {
      relationCache.blocks = null;
      relationCache.mutes = null;
      if (res && res.status === 200 && window.ViktorychAccounts && window.ViktorychAccounts.toast) {
        var note = tr("Account muted");
        if (kind === "blocks" && remove) note = tr("Account unblocked");
        else if (kind === "blocks") note = tr("Account blocked");
        else if (remove) note = tr("Account unmuted");
        window.ViktorychAccounts.toast(note);
      }
      if (!res || res.status !== 200) {
        if (window.ViktorychAccounts && window.ViktorychAccounts.toast) window.ViktorychAccounts.toast(tr("You can’t do that with this account."));
      }
      ensureRelations();
    }).catch(function () {});
  }
  function setProtected(val) {
    var session = readSession();
    if (!session) return;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { protected: !!val } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function setPrivateFollows(val) {
    var session = readSession();
    if (!session) return;
    var next = !!val;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { privateFollows: next } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      dirtyLists();
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  function hideAvatar(mode) {
    var session = readSession();
    if (!session) return;
    var next = mode === "none" || mode === "default" ? mode : "";
    var current = session.account && (session.account.hideAvatar === "none" || session.account.hideAvatar === "default") ? session.account.hideAvatar : "";
    if (next === current) return;
    api("/v1/profile", { method: "PATCH", token: session.token, body: { hideAvatar: next } }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return;
      session.account = res.account;
      writeSession(session);
      remember(res.account);
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {});
  }
  document.addEventListener("pointerdown", function (event) {
    if (view === "edit" && form.mediaMenu) {
      var inside = event.target && event.target.closest && event.target.closest(".acct-pop, [data-acct='media-menu']");
      if (!inside) {
        form.mediaMenu = "";
        paint();
      }
    }
    var stage = event.target && event.target.closest ? event.target.closest(".acct-crop-stage") : null;
    if (stage && view === "crop") {
      cropDrag = { x: event.clientX, y: event.clientY, ox: form.cropX || 0, oy: form.cropY || 0, id: event.pointerId };
      if (stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
      return;
    }
    var frame = event.target && event.target.closest ? event.target.closest(".photo-gallery") : null;
    if (!frame || !gallery.open) return;
    if (event.target.closest && event.target.closest("button")) return;
    galleryDrag = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }, true);
  document.addEventListener("pointermove", function (event) {
    if (!cropDrag || event.pointerId !== cropDrag.id) return;
    form.cropX = cropDrag.ox + (event.clientX - cropDrag.x);
    form.cropY = cropDrag.oy + (event.clientY - cropDrag.y);
    layoutCrop();
  }, true);
  document.addEventListener("pointerup", function (event) {
    if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
    if (galleryDrag && event.pointerId === galleryDrag.id) {
      var dx = event.clientX - galleryDrag.x;
      galleryDrag = null;
      if (Math.abs(dx) >= 40) stepGallery(dx < 0 ? 1 : -1);
    }
  }, true);
  document.addEventListener("pointercancel", function (event) {
    if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
    if (galleryDrag && event.pointerId === galleryDrag.id) galleryDrag = null;
  }, true);
  var photoBlobs = {};
  function refreshProfileMedia() {
    Object.keys(photoBlobs).forEach(function (key) {
      if (key.indexOf("/v1/media/") >= 0) {
        try { URL.revokeObjectURL(photoBlobs[key]); } catch (err) { /* the blob is already gone */ }
        delete photoBlobs[key];
      }
    });
    var imgs = document.querySelectorAll("img[data-photo]");
    for (var i = 0; i < imgs.length; i++) imgs[i].removeAttribute("data-photo-tried");
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "drop-profile-media" });
    }
    var seen = {};
    Object.keys(profiles).forEach(function (key) {
      var account = profiles[key];
      if (!account || !account.handle || seen[account.handle]) return;
      seen[account.handle] = true;
      account.repostsLoaded = false;
      profileLoads[skel(account.handle)] = false;
      profileMiss[skel(account.handle)] = false;
      loadProfile(account.handle);
    });
  }
  function loadPhoto(url) {
    if (photoBlobs[url]) return Promise.resolve(photoBlobs[url]);
    var session = readSession();
    if (!session || !session.token) return Promise.resolve("");
    return fetch(url, { headers: { Authorization: "Bearer " + session.token }, cache: "no-store", credentials: "omit" }).then(function (res) {
      if (!res.ok) return null;
      return res.blob();
    }).then(function (blob) {
      if (!blob) return "";
      var objectUrl = URL.createObjectURL(blob);
      photoBlobs[url] = objectUrl;
      return objectUrl;
    }).catch(function () { return ""; });
  }
  document.addEventListener("error", function (event) {
    var img = event.target;
    if (!img || img.tagName !== "IMG") return;
    var url = img.getAttribute("data-photo");
    if (!url || img.getAttribute("data-photo-tried")) return;
    img.setAttribute("data-photo-tried", "1");
    loadPhoto(url).then(function (objectUrl) { if (objectUrl) img.src = objectUrl; });
  }, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || el.getAttribute("data-acct") !== "media-vis") return;
    saveMedia({ id: el.getAttribute("data-id"), visibility: el.value });
  }, true);
  document.addEventListener("submit", function (event) {
    var formEl = event.target;
    if (!formEl || !formEl.closest || !formEl.closest("#account-layer")) return;
    event.preventDefault();
    if (formEl.id === "acct-login-form") doLogin();
    else if (formEl.id === "acct-save-form") finishPending();
    else if (formEl.id === "acct-recover-form") doRecover();
  }, true);
  document.addEventListener("input", function (event) {
    var el = event.target;
    if (el && el.closest && el.closest("[data-delete-form]")) {
      if (el.name === "accountNumber") {
        var digits = String(el.value || "").replace(/\D/g, "").slice(0, 16);
        el.value = grouped(digits);
        deleteState.accountNumber = digits;
      } else if (el.name === "confirmHandle") {
        deleteState.handle = el.value;
      }
      deleteState.error = "";
      var go = document.querySelector('[data-delete-form] [data-acct="delete-go"]');
      if (go) go.disabled = !deleteReady() || deleteState.busy;
      var err = el.closest("[data-delete-form]").querySelector(".acct-error");
      if (err) err.textContent = "";
      return;
    }
    if (el && (el.dataset.friendsSearch || el.classList.contains("friends-search-input"))) {
      friendsSearchQuery = el.value;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return;
    }
    if (!el || !el.closest || !el.closest("#account-layer") || !el.name) return;
    if (el.id === "acct-login-user") {
      var typed = String(el.value || "").replace(/\D/g, "").slice(0, 16);
      form.accountNumber = typed;
      var passEl = document.getElementById("acct-accountNumber");
      if (passEl) passEl.value = grouped(typed);
      return;
    }
    if (el.name === "accountNumber") {
      var digits = String(el.value || "").replace(/\D/g, "").slice(0, 16);
      el.value = grouped(digits);
      form.accountNumber = digits;
      var loginUser = document.getElementById("acct-login-user");
      if (loginUser) loginUser.value = digits;
      var numberCount = el.parentNode && el.parentNode.querySelector(".acct-count");
      if (numberCount) numberCount.textContent = fieldCount("accountNumber", digits, 16);
      return;
    }
    if (el.name === "cropZoom") {
      form.cropZoom = el.value;
      layoutCrop();
      return;
    }
    form[el.name] = el.value;
    if (el.name === "identityHandle") linkIdentityForm.handle = el.value;
    if (el.name === "identityProofUrl") linkIdentityForm.proofUrl = el.value;
    var count = el.parentNode && el.parentNode.querySelector(".acct-count");
    var max = Number(el.getAttribute("data-max") || 0);
    if (count && max) count.textContent = fieldCount(el.name, el.value, max);
  }, true);
  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.closest || !el.closest("#account-layer")) return;
    if (el.type === "file" && (el.name === "avatar" || el.name === "banner")) {
      var file = el.files && el.files[0];
      el.value = "";
      if (file) startCrop(file, el.name);
      return;
    }
    if (el.name === "identityPlatform") linkIdentityForm.platform = el.value;
    if (el.name === "saved") {
      form.saved = !!el.checked;
      var button = document.querySelector('#account-layer [data-acct="saved"]');
      if (button) button.disabled = !form.saved;
    }
  }, true);
  function checkUrlSession() {
    var hash = location.hash || "";
    var m = hash.match(/^#\/(?:session|restore)=([A-Za-z0-9+/=_-]+)/);
    if (!m) return false;
    try {
      var raw = decodeURIComponent(escape(atob(m[1])));
      var parsed = JSON.parse(raw);
      if (parsed && parsed.token && parsed.account) {
        history.replaceState(null, "", location.pathname + location.search + "#/");
        commitSession(parsed.token, parsed.account);
        return true;
      }
    } catch (e) {}
    return false;
  }
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    var el = event.target;
    if (!el || !el.closest || !el.closest("#account-layer")) return;
    if (el.tagName === "TEXTAREA") return;
    if (el.form && (el.form.id === "acct-login-form" || el.form.id === "acct-save-form" || el.form.id === "acct-recover-form")) return;
    event.preventDefault();
    if (view === "login") {
      doLogin();
    } else if (view === "emergency") {
      doEmergency();
    } else if (view === "restore") {
      doRestoreSession();
    } else if (view === "signup") {
      if (step === 2) finishPending();
      else nextSignup();
    }
  }, true);
  document.addEventListener("keydown", function (event) {
    var modal = document.querySelector("#account-layer .acct-modal");
    if (!modal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeAuth();
      return;
    }
    if (event.key !== "Tab") return;
    var items = Array.prototype.filter.call(modal.querySelectorAll("button, a[href], input, select, textarea"), function (el) {
      return !el.disabled && el.tabIndex !== -1 && el.getAttribute("aria-hidden") !== "true";
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !modal.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !modal.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }, true);
  window.addEventListener("hashchange", function () {
    if (deletedFlag() && !readSession()) {
      showDeleted();
      return;
    }
    if (checkUrlSession()) return;
    if (!blocking()) return;
    var hash = location.hash || "";
    if (hash && hash !== "#" && hash !== "#/") {
      try { sessionStorage.setItem(RETURN_KEY, hash); } catch (err) { /* home after sign-in */ }
      history.replaceState(null, "", location.pathname + location.search);
    }
    paint();
  });

  var mine = readSession();
  if (mine && mine.account) remember(mine.account);
  if (config().gate) {
    installFetch();
    tellSW(!!mine);
  } else {
    try {
      if (typeof fetch === "function") {
        nativeFetch("./accounts.config.js?_cb=" + Date.now(), { cache: "no-store" })
          .then(function (res) { return res.ok ? res.text() : ""; })
          .then(function (code) {
            if (/gate:\s*true/.test(code)) {
              try { (new Function(code))(); } catch (e) {}
              if (config().gate && !readSession()) {
                installFetch();
                enter();
                paint();
              }
            }
          }).catch(function () {});
      }
    } catch (e) {}
  }
  if (window.SI18n && window.SI18n.onChange) window.SI18n.onChange(function () { if (blocking() || view) paint(); });
  checkUrlSession();
  if (blocking()) enter();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      syncFollows();
      syncFriends();
    }
  });
  document.addEventListener("input", function (event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-graph-search]") : null;
    if (!el) return;
    setGraphQuery(el.dataset.graphId, el.dataset.graphTab, el.value);
  });

  window.ViktorychAccounts = {
    blocking: blocking,
    enter: enter,
    currentApi: currentApi,
    apiEndpoints: apiEndpoints,
    rotateApi: rotateApi,
    hasApi: hasApi,
    profileHtml: profileHtml,
    pillInner: pillInner,
    drawerHead: drawerHead,
    settingsHtml: settingsHtml,
    privacyHtml: privacyHtml,
    deleteAccountHtml: deleteAccountHtml,
    showDeletedIfNeeded: showDeletedIfNeeded,
    onLocalChange: onLocalChange,
    onHistoryReady: onHistoryReady,
    requestRender: null,
    profilePostsHtml: null,
    call: api,
    setReposts: setReposts,
    ensureProfile: loadProfile,
    profilePending: profilePending,
    profileReady: profileReady,
    storedAccount: storedAccount,
    followButton: null,
    onServerFollows: null,
    changeFollow: changeFollow,
    pressFollow: pressFollow,
    releaseFollow: releaseFollow,
    previewFollow: previewFollow,
    followControlHtml: followControlHtml,
    graphListHtml: graphListHtml,
    setGraphQuery: setGraphQuery,
    relationWrite: relationWrite,
    blockSet: function () {
      var ids = {};
      (relationCache.blocks || []).forEach(function (item) {
        var id = String(item.id || "");
        if (id) ids[id] = true;
      });
      return ids;
    },
    syncFollows: syncFollows,
    syncFriends: syncFriends,
    friendButton: friendButtonHtml,
    friendsSectionHtml: friendsSectionHtml,
    doFriendAction: doFriendAction,
    ensureFriends: ensureFriends,
    ensureCounts: ensureCounts,
    ensureList: ensureList,
    listPack: listPack,
    followersOf: followersOf,
    subjectForHandle: subjectForHandle,
    ownsSubject: viewerOwnsSubject,
    setPrivateFollows: setPrivateFollows,
    account: function () {
      var session = readSession();
      return session && session.account ? session.account : null;
    },
    token: function () {
      var session = readSession();
      return session && session.token ? session.token : "";
    },
    syncPlaybackAuth: function () {
      tellSW(!!readSession());
      return new Promise(function (resolve) {
        if (!navigator.serviceWorker) { resolve(false); return; }
        var timer = setTimeout(function () { resolve(false); }, 400);
        navigator.serviceWorker.ready.then(function (reg) {
          if (!reg.active) { clearTimeout(timer); resolve(false); return; }
          var channel = new MessageChannel();
          var session = readSession();
          channel.port1.onmessage = function () { clearTimeout(timer); resolve(true); };
          try {
            reg.active.postMessage({
              type: "auth",
              on: !!session,
              token: session && session.token ? session.token : ""
            }, [channel.port2]);
          } catch (err) {
            clearTimeout(timer);
            resolve(false);
          }
        }).catch(function () { clearTimeout(timer); resolve(false); });
      });
    },
    snapshotFrom: snapshotFrom,
    mergePayload: mergePayload,
    releaseNavLayout: releaseNavLayout,
    applySnapshot: applySnapshot,
    refreshToken: function () {
      var session = readSession();
      if (!session || !session.token || !hasApi()) return Promise.resolve("");
      return api("/v1/session/refresh", { method: "POST", token: session.token }).then(function (body) {
        if (!body || body.status !== 200 || !body.token) return "";
        session.token = body.token;
        if (body.account) session.account = body.account;
        writeSession(session);
        tellSW(true);
        return body.token;
      }).catch(function () { return ""; });
    }
  };
})();
