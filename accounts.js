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
  var step = 0;
  var form = {};
  var errorText = "";
  var legalTitle = "";
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
    } catch (err) { return null; }
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
  function patchedFetch(input, init) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    var url;
    try { url = new URL(raw, location.href); }
    catch (err) { return nativeFetch(input, init); }
    if (url.origin === location.origin && /(^|\/)v1\//.test(url.pathname)) return nativeFetch(input, init);
    var key = dataKey(url);
    if (!key) return nativeFetch(input, init);
    if (!config().gate) return nativeFetch(input, init);
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
    if (opts.body) headers["content-type"] = "application/json";
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
        body: opts.body ? JSON.stringify(opts.body) : undefined,
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
    if (code === "invalid_location") return tr("That location is too long.");
    if (code === "invalid_website") return tr("That website is too long.");
    if (code === "too_large") return tr("Could not save that photo.");
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
    var id = "acct-" + name;
    var limit = name === "accountNumber" ? 16 : max;
    var maxAttr = "";
    if (name === "accountNumber") maxAttr = ' data-max="16" inputmode="numeric"';
    else if (limit) maxAttr = ' maxlength="' + limit + '" data-max="' + limit + '"';
    var count = limit ? '<span class="acct-count">' + fieldCount(name, value, limit) + "</span>" : "";
    var autocomplete = name === "accountNumber" || name === "claimCode" ? "off" : name === "website" ? "url" : name === "location" ? "address-level2" : "nickname";
    return '<div class="acct-field"><input id="' + id + '" name="' + esc(name) + '" type="' + (type || "text") + '"' + maxAttr + ' placeholder=" " autocomplete="' + autocomplete + '" value="' + esc(value) + '"><label for="' + id + '">' + esc(label) + "</label>" + count + "</div>";
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
    var foot = [tr("About"), tr("Help Center"), tr("Terms of Service"), tr("Privacy Policy"), tr("Cookie Policy"), tr("Accessibility"), tr("Blog"), tr("Developers")].map(function (label) {
      return '<button type="button" data-acct="legal" data-title="' + esc(label) + '">' + esc(label) + "</button>";
    }).join("");
    return '<div class="x-shell"><div class="x-land"><div class="x-land-logo">' + mark("x-mark") + '</div><div class="x-land-copy"><h1>' + esc(tr("Happening now")) + "</h1><h2>" + esc(tr("Join today.")) + '</h2><button class="acct-fill" type="button" data-acct="signup">' + esc(tr("Create account")) + '</button><p class="acct-legal">' + esc(tr("By signing up, you agree to the Terms of Service and Privacy Policy.")) + "</p><h3>" + esc(tr("Already have an account?")) + '</h3><button class="acct-line" type="button" data-acct="login">' + esc(tr("Sign in")) + '</button></div></div><footer class="x-foot">' + foot + '<button type="button" data-acct="login">' + esc(tr("Settings")) + "</button><span>" + esc(tr("© {year} {app}", { year: year, app: appName() })) + "</span></footer></div>";
  }
  function signupBody() {
    if (step === 2) {
      var pending = readPending();
      var number = pending ? grouped(pending.accountNumber) : "";
      return '<p class="acct-sub">' + esc(tr("This number is shown once. Save it now. It is the only way back into this account.")) + '</p><div class="acct-number">' + esc(number) + '</div><div class="acct-row"><button type="button" data-acct="copy">' + esc(tr("Copy")) + '</button><button type="button" data-acct="download">' + esc(tr("Download")) + '</button></div><label class="acct-check"><input name="saved" type="checkbox"' + (form.saved ? " checked" : "") + "><span>" + esc(tr("I saved my account number")) + '</span></label><p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="saved"' + (form.saved ? "" : " disabled") + ">" + esc(tr("Next")) + "</button>";
    }
    if (step === 1) {
      var claim = form.claimOpen ? field("claimCode", tr("Claim code"), "password") : '<button class="acct-quiet" type="button" data-acct="claim">' + esc(tr("Have a claim code?")) + "</button>";
      var handleSub = form.profileLess
        ? esc(tr("Choose a handle or leave blank to assign an anonymous identifier."))
        : esc(tr("Latin and Cyrillic letters, digits, and underscore. Up to 15 characters."));
      return '<p class="acct-sub">' + handleSub + "</p>" +
        field("handle", form.profileLess ? tr("Handle (optional)") : tr("Choose a handle"), "text", 15) +
        claim + turnstileHtml() + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="next">' + esc(tr("Next")) + "</button>";
    }
    var subText = form.profileLess
      ? esc(tr("Your account will have no public profile. Interactions will be anonymous."))
      : esc(tr("Your name is shown on your profile."));
    var profRow = '<div class="acct-pref-row" style="margin:16px 0 8px"><div class="acct-pref-text"><b>' + esc(tr("Profile-less account")) + '</b><p>' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p></div><button class="tab-switch' + (form.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (form.profileLess ? "true" : "false") + '" data-acct="toggle-form-profileless"><i></i></button></div>';
    return '<p class="acct-sub">' + subText + "</p>" +
      field("displayName", form.profileLess ? tr("Name (optional)") : tr("Name"), "text", 50) +
      profRow +
      '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="next">' + esc(tr("Next")) + "</button>";
  }
  function loginBody() {
    return field("accountNumber", tr("Account number")) + turnstileHtml() + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="do-login">' + esc(tr("Log in")) + '</button><p class="acct-switch">' + esc(tr("Don't have an account?")) + ' <button type="button" data-acct="signup">' + esc(tr("Sign up")) + '</button></p><p class="acct-switch"><button type="button" data-acct="open-emergency" style="font-weight:600">' + esc(tr("Have a claim code?")) + ' (' + esc(tr("Emergency Offline Access")) + ')</button></p>' +
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
  function photoHtml(url, cls) {
    if (!url) return "";
    var remote = url.indexOf("/v1/media/") >= 0;
    var classAttr = cls ? ' class="' + cls + '"' : "";
    return "<img" + classAttr + ' alt="" src="' + esc(url) + '"' + (remote ? ' data-photo="' + esc(url) + '"' : "") + ">";
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
    if (!window.ViktorychPresence || !/^\d{12}$/.test(String(id || ""))) return html;
    return window.ViktorychPresence.wrap(id, html, opener ? ' data-acct="presence-open"' : "");
  }
  function publicAvatar(src, accountFace, cls) {
    var mode = faceOf("picture", src, accountFace);
    if (mode === "none") return '<span class="ava-none"></span>';
    var classes = "ava" + (cls ? " " + cls : "") + (mode === "default" ? " silhouette" : "");
    if (mode === "photo") return photoHtml(src, classes);
    return '<span class="' + classes + '" aria-hidden="true">' + PERSON + "</span>";
  }
  function publicBanner(src, accountFace) {
    var mode = faceOf("banner", src, accountFace);
    if (mode === "none") return "";
    if (mode === "photo") return photoHtml(src, "pbanner");
    return '<div class="pbanner"></div>';
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
    return '<p class="acct-sub">' + esc(tr("Not affiliated with X.")) + "</p>";
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
    else if (view === "emergency") html += modal(tr("Emergency Offline Access"), emergencyBody());
    else if (view === "restore") html += modal(tr("Restore session"), restoreBody());
    else if (view === "edit") html += editModal(editBody());
    else if (view === "crop") html += cropModal();
    else if (view === "legal") html += modal(legalTitle || tr("About"), legalBody());
    else if (view === "unfriend") html += modal(tr("Unfriend @{handle}?", { handle: unfriendTarget ? unfriendTarget.handle : "" }), '<p class="acct-sub">' + esc(tr("This removes @{handle} from your friends.", { handle: unfriendTarget ? unfriendTarget.handle : "" })) + '</p><button class="acct-next acct-danger" type="button" data-friend-act="unfriend-confirm" style="background:#f4212e;border-color:#f4212e;color:#fff">' + esc(tr("Remove Friend")) + '</button><button class="acct-line" type="button" data-acct="close" style="width:100%;margin-top:12px">' + esc(tr("Cancel")) + '</button>');
    else if (view === "link-identity") html += modal(tr("Link social profile"), linkIdentityBody());
    else if (view === "leave") html += modal(tr("Save your account number"), '<p class="acct-sub">' + esc(tr("Leave without saving the account number?")) + '</p><button class="acct-next" type="button" data-acct="abandon">' + esc(tr("Close")) + '</button><button class="acct-line" type="button" data-acct="stay" style="width:100%;margin-top:12px">' + esc(tr("Back")) + "</button>");
    root.innerHTML = html;
    var mark = (view || "") + ":" + step + ":" + (form.claimOpen ? "1" : "0");
    if (mark !== painted) {
      painted = mark;
      if (view !== "edit" && view !== "crop") {
        var input = form.claimOpen ? root.querySelector('input[name="claimCode"]') : root.querySelector(".acct-field input, .acct-field textarea");
        if (input) input.focus();
      }
    }
    if (view === "crop" && !layoutCrop()) requestAnimationFrame(layoutCrop);
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
    if (readPending()) {
      view = "signup";
      step = 2;
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
      bottomNavCustom: settings.bottomNavCustom === true
    };
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
      bottomNavCustom: pickedNav.bottomNavCustom
    };
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
  function nextSignup() {
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
    var handle = String(form.handle || "").trim().replace(/^@/, "");
    if (!handle && form.profileLess) {
      handle = "anon_" + Math.random().toString(36).slice(2, 10);
    }
    form.handle = handle;
    var checked = window.HandleSkeleton ? window.HandleSkeleton.inspectHandle(handle) : { ok: true, owner: false };
    if (!checked.ok) {
      errorText = errorMessage(checked.error === "reserved" ? "handle_reserved" : "invalid_handle");
      paint();
      return;
    }
    if (checked.owner && !String(form.claimCode || "").trim()) {
      form.claimOpen = true;
      errorText = tr("Enter the claim code for this handle.");
      paint();
      return;
    }
    var body = {
      displayName: String(form.displayName || "").trim() || tr("Anonymous"),
      handle: handle,
      claimCode: String(form.claimCode || "").trim(),
      profileLess: !!form.profileLess,
      turnstileToken: turnstileToken()
    };
    api("/v1/signup", { method: "POST", body: body }).then(function (res) {
      if (res.status !== 201 || !res.token || !res.accountNumber) {
        errorText = errorMessage(res.error);
        paint();
        return;
      }
      writePending({ token: res.token, accountNumber: res.accountNumber, account: res.account });
      step = 2;
      form.saved = false;
      errorText = "";
      paint();
    }).catch(function () {
      errorText = tr("Servers unreachable. Try Emergency Offline Access.");
      paint();
    });
  }
  function doLogin() {
    var digits = String(form.accountNumber || "").replace(/\D/g, "");
    errorText = "";
    api("/v1/login", { method: "POST", body: { accountNumber: digits, turnstileToken: turnstileToken() } }).then(function (res) {
      if (res.status !== 200 || !res.token) {
        if (res.status === 429) {
          errorText = tr("Too many attempts. Try again later.");
        } else {
          errorText = errorMessage(res.error) || tr("Could not sign in.");
        }
        paint();
        return;
      }
      commitSession(res.token, res.account);
    }).catch(function () {
      errorText = tr("Something went wrong. Try again.");
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
          handle: "S\u0435\u0420g\u0418",
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
    return (readSettings().accountFollows || []).filter(function (id) { return /^app:\d{12}$/.test(String(id || "")); });
  }
  function accountStat(account, field) {
    var id = "app:" + (account && account.publicId || "");
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
    if (!account || !account.publicId) return;
    var id = "app:" + account.publicId;
    graphCounts[id] = graphCounts[id] || {};
    if (account.followingCount != null && !graphCounts[id].fresh) graphCounts[id].following = account.followingCount;
    if (account.followersCount != null && !graphCounts[id].fresh) graphCounts[id].followers = account.followersCount;
    if (account.friendsCount != null && !graphCounts[id].fresh) graphCounts[id].friends = account.friendsCount;
    if (account.viewerFriendStatus != null) graphCounts[id].friendStatus = account.viewerFriendStatus;
    if (account.mutualFriendsCount != null) graphCounts[id].mutualFriendsCount = account.mutualFriendsCount;
  }
  function countLink(account, tab, n, label) {
    var href = tab === "friends" ? ("#/@" + encodeURIComponent(account.handle || "") + "?tab=friends") : ("#/@" + encodeURIComponent(account.handle || "") + "/" + tab);
    return '<a href="' + esc(href) + '"><b>' + esc(formatNum(n)) + "</b> <span>" + esc(label) + "</span></a>";
  }
  function accountCountsHtml(account) {
    var priv = account && account.privateFollows ? '<span class="private-badge" title="' + esc(tr("Followers and following are private")) + '" aria-label="' + esc(tr("Followers and following are private")) + '">' + lockIcon(12) + ' <span>' + esc(tr("Private")) + '</span></span>' : "";
    return '<div class="counts">' + countLink(account, "following", accountStat(account, "following"), tr("Following count")) + countLink(account, "followers", accountStat(account, "followers"), tr("Followers")) + countLink(account, "friends", accountStat(account, "friends"), tr("Friends")) + priv + "</div>";
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
    return listCache[id + "|" + tab] || { loading: false, accounts: null, error: false, isPrivate: false };
  }
  function ensureList(id, tab) {
    var session = readSession();
    var key = id + "|" + tab;
    if (!id || !session || !hasApi()) return;
    var pack = listCache[key];
    if (pack && (pack.loading || (pack.accounts && !pack.dirty))) return;
    var epoch = followEpoch;
    listCache[key] = { loading: true, accounts: pack && pack.accounts, error: false, dirty: false };
    api("/v1/follows?id=" + encodeURIComponent(id) + "&tab=" + encodeURIComponent(tab), { token: session.token }).then(function (res) {
      if (epoch !== followEpoch) {
        if (listCache[key]) {
          listCache[key].loading = false;
          listCache[key].dirty = true;
        }
        return;
      }
      if (!res || res.status !== 200) listCache[key] = { loading: false, accounts: [], error: true, isPrivate: false };
      else {
        var isPriv = !!res.isPrivate;
        listCache[key] = { loading: false, accounts: Array.isArray(res.accounts) ? res.accounts : [], error: false, isPrivate: isPriv };
        graphCounts[id] = graphCounts[id] || {};
        if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
        if (res.followingCount != null) graphCounts[id].following = res.followingCount;
        graphCounts[id].fresh = true;
      }
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () {
      listCache[key] = { loading: false, accounts: [], error: true };
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    });
  }
  function dirtyLists() {
    Object.keys(listCache).forEach(function (key) {
      if (listCache[key]) listCache[key].dirty = true;
    });
  }
  function changeFollow(id, follow, profile) {
    var session = readSession();
    if (!session || !hasApi() || !id) return Promise.resolve(true);
    if (id === myAccountId()) return Promise.resolve(false);
    followEpoch += 1;
    var epoch = followEpoch;
    var me = myAccountId();
    var hadTarget = !!(graphCounts[id] && graphCounts[id].followers != null);
    var prevTarget = hadTarget ? graphCounts[id].followers : 0;
    var hadMine = !!(me && graphCounts[me] && graphCounts[me].following != null);
    var prevMine = hadMine ? graphCounts[me].following : 0;
    graphCounts[id] = graphCounts[id] || {};
    graphCounts[id].followers = Math.max(0, prevTarget + (follow ? 1 : -1));
    if (hadMine) graphCounts[me].following = Math.max(0, prevMine + (follow ? 1 : -1));
    dirtyLists();
    var body = { id: id };
    if (profile && typeof profile === "object") body.profile = profile;
    return api("/v1/follows", { method: follow ? "PUT" : "DELETE", token: session.token, body: body }).then(function (res) {
      if (epoch !== followEpoch) return res && res.status === 200;
      if (!res || res.status !== 200) {
        if (hadTarget) graphCounts[id].followers = prevTarget;
        else {
          delete graphCounts[id].followers;
          graphCounts[id].fresh = false;
        }
        if (hadMine) graphCounts[me].following = prevMine;
        return false;
      }
      graphCounts[id] = graphCounts[id] || {};
      if (res.followersCount != null) graphCounts[id].followers = res.followersCount;
      graphCounts[id].fresh = true;
      if (me && res.followingCount != null) {
        graphCounts[me] = graphCounts[me] || {};
        graphCounts[me].following = res.followingCount;
        graphCounts[me].fresh = true;
      }
      dirtyLists();
      if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      return true;
    }).catch(function () {
      if (epoch !== followEpoch) return false;
      if (hadTarget) graphCounts[id].followers = prevTarget;
      else delete graphCounts[id].followers;
      if (hadMine) graphCounts[me].following = prevMine;
      return false;
    });
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
        graphCounts[me].fresh = true;
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
  function subjectForHandle(handle, platform) {
    var key = skel(handle);
    var session = readSession();
    var account = profiles[key];
    if (!account && session && session.account && skel(session.account.handle) === key) account = session.account;
    if (account && account.publicId) {
      return { id: "app:" + account.publicId, kind: "account", name: account.displayName || account.handle, handle: account.handle, platform: "x" };
    }
    if ((platform || "x") === "x" && readSession() && hasApi() && !profileMiss[key]) {
      loadProfile(handle);
      return { pending: true };
    }
    return null;
  }
  function friendButtonHtml(account) {
    var session = readSession();
    if (!session || !account || !account.publicId) return "";
    if (session.account && session.account.publicId === account.publicId) return "";
    var status = (graphCounts["app:" + account.publicId] && graphCounts["app:" + account.publicId].friendStatus) || account.viewerFriendStatus || "none";
    var pid = account.publicId;
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
    if (!targetId || !session || !hasApi()) return;
    if (friendsLoads[targetId] || friendsCache[targetId]) return;
    friendsLoads[targetId] = true;
    api("/v1/friends?id=" + encodeURIComponent("app:" + targetId) + "&tab=friends", { token: session.token }).then(function (res) {
      friendsLoads[targetId] = false;
      if (!res || res.status !== 200) return;
      friendsCache[targetId] = Array.isArray(res.friends) ? res.friends : [];
      var id = "app:" + targetId;
      graphCounts[id] = graphCounts[id] || {};
      if (res.friendsCount != null) graphCounts[id].friends = res.friendsCount;
      if (res.status != null) graphCounts[id].friendStatus = res.status;
      if (res.mutualCount != null) graphCounts[id].mutualFriendsCount = res.mutualCount;
      if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
    }).catch(function () { friendsLoads[targetId] = false; });
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
    if (session.account && session.account.publicId) {
      ensureFriends(session.account.publicId);
    }
    return Promise.resolve();
  }

  function doFriendAction(action, targetId, handle) {
    var session = readSession();
    if (!session || !hasApi() || !targetId) return;
    var me = session.account && session.account.publicId;
    var tId = targetId.replace(/^app:/, "");
    var idKey = "app:" + tId;
    var meKey = "app:" + me;

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
    var mine = session && session.account && session.account.publicId === account.publicId;
    if (!session) {
      return '<div class="empty"><h2>' + esc(tr("Friends")) + '</h2><p>' + esc(tr("Sign in to see this list.")) + '</p></div>';
    }

    var pid = account.publicId;
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

  function accountPage(account, route) {
    var session = readSession();
    var mine = session && session.account && session.account.publicId === account.publicId;
    var photo = presenceWrap(account.publicId, publicAvatar(account.avatar, account.avatarFace, "pava"), mine);
    var banner = publicBanner(account.banner, account.bannerFace);
    var edit = mine ? '<button class="follow" type="button" data-acct="edit">' + esc(tr("Edit profile")) + "</button>" : "";
    var followBtn = !mine && account.publicId && window.ViktorychAccounts.followButton ? (window.ViktorychAccounts.followButton("app:" + account.publicId, true) || "") : "";
    var friendBtn = !mine && account.publicId ? friendButtonHtml(account) : "";
    var activeTab = (route && route.query && route.query.get("tab")) || (route && route.tab) || "posts";
    if (activeTab !== "friends") activeTab = "posts";

    var pack = { html: "", count: 0 };
    if (window.ViktorychAccounts && window.ViktorychAccounts.profilePostsHtml) pack = window.ViktorychAccounts.profilePostsHtml(account) || pack;
    var count = String(pack.count || 0);

    var postsBody = pack.html || ('<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2><p>" + esc(tr("Posts from this account will show up here.")) + "</p></div>");
    var friendsBody = friendsSectionHtml(account);
    var body = activeTab === "friends" ? friendsBody : postsBody;

    var profileHref = "#/@" + encodeURIComponent(account.handle || "");
    var friendsHref = "#/@" + encodeURIComponent(account.handle || "") + "?tab=friends";

    var mutualCount = (graphCounts["app:" + account.publicId] && graphCounts["app:" + account.publicId].mutualFriendsCount) || account.mutualFriendsCount;
    var mutualLine = (!mine && mutualCount) ? '<div class="pmutual">' + esc(tr("{count} mutual friends", { count: mutualCount })) + '</div>' : '';

    var tabs = '<div class="tabs ptabs" role="tablist" aria-label="' + esc(tr("Profile")) + '">' +
      '<a class="tab' + (activeTab === "posts" ? " on" : "") + '" role="tab" aria-selected="' + (activeTab === "posts" ? "true" : "false") + '" href="' + esc(profileHref) + '"><span>' + esc(tr("Posts")) + '</span></a>' +
      '<a class="tab' + (activeTab === "friends" ? " on" : "") + '" role="tab" aria-selected="' + (activeTab === "friends" ? "true" : "false") + '" href="' + esc(friendsHref) + '"><span>' + esc(tr("Friends")) + (accountStat(account, "friends") > 0 ? ' <small class="tab-n">(' + formatNum(accountStat(account, "friends")) + ')</small>' : '') + '</span></a>' +
    '</div>';

    var seenLine = window.ViktorychPresence ? window.ViktorychPresence.linesHtml(account.publicId) : "";
    return '<div class="topbar profile-bar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.4 13l5.3 5.3-1.4 1.4L3.6 12l7.7-7.7 1.4 1.4L7.4 11H21v2H7.4z"/></svg></button><div class="head-text"><div class="pt-name">' + esc(account.displayName || account.handle) + '</div><div class="pt-count">' + esc(tr("{count} posts", { count: count })) + "</div></div></div></div>" + banner + '<div class="pinfo"><div class="pava-row">' + photo + '<div class="pactions">' + edit + followBtn + friendBtn + '</div></div><h1 class="pname">' + esc(account.displayName || account.handle) + (account.owner ? badge() : "") + '</h1><div class="phandle">@' + esc(account.handle) + '</div>' + seenLine + mutualLine + '<div class="acct-id">' + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + "</div>" + (account.bio ? '<div class="pbio">' + esc(account.bio) + "</div>" : "") + (account.location ? '<div class="acct-loc">' + esc(account.location) + "</div>" : "") + (siteHref(account.website) ? '<div class="acct-loc"><a href="' + esc(siteHref(account.website)) + '" target="_blank" rel="noopener noreferrer">' + esc(account.website) + "</a></div>" : "") + linkedIdentitiesHtml(account) + (account.profileLess ? '<div class="private-badge" style="margin:4px 0 8px">' + esc(tr("Profile-less (not visible to others)")) + '</div>' : "") + accountCountsHtml(account) + "</div>" + tabs + body;
  }
  function profileHtml(route) {
    if (!route || route.name !== "profile" || !route.handle || route.handle === "_") return "";
    var key = skel(route.handle);
    if (profileMiss[key]) return "";
    var account = profiles[key];
    var session = readSession();
    if (!account && session && session.account && (skel(session.account.handle) === key || skel(session.account.handle + session.account.publicId) === key || session.account.publicId === route.handle)) account = session.account;
    if (!account && /\d{12}$/.test(route.handle)) {
      account = profiles[skel(route.handle.slice(-12))];
    }
    if (!account) {
      loadProfile(route.handle);
      return "";
    }
    if (!account.repostsLoaded) loadProfile(route.handle);
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
  function drawerHead() {
    var session = readSession();
    if (!session || !session.account) {
      return '<div class="drawer-signin" data-acct="login" style="padding:16px 20px;display:flex;gap:12px;align-items:center;cursor:pointer">' +
        '<span class="ava initials">?</span>' +
        '<div style="flex:1"><b>' + esc(tr("Sign in")) + '</b><div class="phandle">' + esc(tr("Not signed in")) + '</div></div>' +
        '<button class="outline" type="button" data-acct="login" style="padding:4px 12px;font-size:13px">' + esc(tr("Sign in")) + '</button>' +
        '</div>';
    }
    var account = session.account;
    var photo = presenceWrap(account.publicId, publicAvatar(account.avatar, account.avatarFace, ""), true);
    var isAnon = !!account.profileLess;
    var name = isAnon ? (account.displayName || tr("Anonymous")) : (account.displayName || "");
    var sub = isAnon ? tr("Profile-less account") : "@" + (account.handle || "");
    return '<a href="#/@' + encodeURIComponent(account.handle) + '" style="padding:16px 20px;display:flex;gap:12px;align-items:center;color:inherit;text-decoration:none">' + photo + "<div><b>" + esc(name) + '</b><div class="phandle">' + esc(sub) + "</div></div></a>" +
      '<div style="padding:0 20px 8px"><button class="outline presence-set" type="button" data-acct="presence-open">' + esc(tr("Set a status")) + '</button></div>' +
      '<div style="padding:0 20px 12px"><button class="outline" type="button" data-acct="logout" style="width:100%;font-size:13px;padding:6px 12px;border-color:rgba(244,33,46,0.4);color:#f4212e">' + esc(tr("Log out")) + '</button></div>';
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
      rows = rows.filter(function (r) {
        return String(r && r.handle || "").toLowerCase().replace(/^@/, "") === "pepsi";
      });
      accounts = accounts.filter(function (r) {
        return String(r && r.handle || "").toLowerCase().replace(/^@/, "") === "pepsi";
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
    var handle = String(account.handle || "");
    var id = String(account.publicId || "");
    if (id === "emergency_owner" || handle === "SeRgi270710267" || id === "SeRgi270710267") return true;
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
    var prefixes = ["viktorychapp-", "superintelapp-", "rss-feeds-", "va_cm_"];
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
    return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + "</h2><p class=\"phandle\">@" + esc(account.handle) + "</p><p class=\"phandle\">" + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + '</p><button class="outline" type="button" data-acct="edit">' + esc(tr("Edit profile")) + '</button><h2>' + esc(tr("Hide my profile picture")) + '</h2><p class="set-sub">' + esc(tr("Other people see this instead of your photo.")) + '</p><div class="theme-row" role="group" aria-label="' + esc(tr("Hide my profile picture")) + '">' + hideBtn("", tr("Show my picture")) + hideBtn("default", tr("Default")) + hideBtn("none", tr("None")) + '</div><h2>' + esc(tr("Private followers and following")) + '</h2><p class="set-sub">' + esc(tr("Keep your followers and following list private. Only you will be able to see who you follow and who follows you.")) + '</p><button class="tab-switch' + (account.privateFollows ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.privateFollows ? "true" : "false") + '" data-acct="toggle-private-follows"><span>' + esc(tr("Keep lists private")) + '</span><i></i></button>' +
      '<h2>' + esc(tr("Profile-less account")) + '</h2><p class="set-sub">' + esc(tr("No public profile. Browse and comment anonymously.")) + '</p><button class="tab-switch' + (account.profileLess ? " on" : "") + '" type="button" role="switch" aria-checked="' + (account.profileLess ? "true" : "false") + '" data-acct="toggle-profileless"><span>' + esc(tr("Profile-less")) + '</span><i></i></button>' + (function () { if (!federationState.loaded && !federationState.loading) loadFederationSettings(); return '<h2>' + esc(tr("Federation (Fediverse & Nostr)")) + '</h2><p class="set-sub">' + esc(tr("Allow Mastodon, Fediverse, and Nostr to discover and follow your internal account. Default is off.")) + '</p><button class="tab-switch' + (federationState.enabled_ap ? " on" : "") + '" type="button" role="switch" aria-checked="' + (federationState.enabled_ap ? "true" : "false") + '" data-acct="toggle-fed-ap"><span>' + esc(tr("Fediverse (ActivityPub)")) + (federationState.enabled_ap && federationState.ap_handle ? " (" + esc(federationState.ap_handle) + ")" : "") + '</span><i></i></button><button class="tab-switch' + (federationState.enabled_nostr ? " on" : "") + '" type="button" role="switch" aria-checked="' + (federationState.enabled_nostr ? "true" : "false") + '" data-acct="toggle-fed-nostr"><span>' + esc(tr("Nostr (NIP-05)")) + (federationState.enabled_nostr && federationState.nostr_nip05 ? " (" + esc(federationState.nostr_nip05) + ")" : "") + '</span><i></i></button>'; })() + '<h2>' + esc(tr("Linked social accounts")) + '</h2><p class="set-sub">' + esc(tr("Link your X, Telegram, Instagram, and YouTube accounts so their posts appear on your profile. Requires identity verification.")) + '</p>' + identitiesSettingsHtml(account) + '<h2>' + esc(tr("Device sync")) + '</h2><p class="set-sub">' + esc(tr("Transfer your session to another browser or device.")) + '</p><button class="outline" type="button" data-acct="copy-session">' + esc(tr("Copy session code")) + "</button>" + deleteEntryHtml(account) + '<button class="outline" type="button" data-acct="logout">' + esc(tr("Log out")) + '</button><button class="outline" type="button" data-acct="logout-all">' + esc(tr("Log out of all devices")) + "</button></div>" + health;
  }
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
    event.preventDefault();
    event.stopPropagation();
    var act = acct.dataset.acct;
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
    else if (act === "do-login") doLogin();
    else if (act === "do-emergency") doEmergency();
    else if (act === "do-restore") doRestoreSession();
    else if (act === "copy-session") copySession();
    else if (act === "claim") { form.claimOpen = true; paint(); }
    else if (act === "copy") copyNumber();
    else if (act === "download") downloadNumber();
    else if (act === "saved") { if (form.saved) { var pending = readPending(); if (pending) commitSession(pending.token, pending.account); } }
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
    else if (act === "legal") { legalTitle = acct.dataset.title || tr("About"); view = "legal"; paint(); }
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
    if (!stage || view !== "crop") return;
    cropDrag = { x: event.clientX, y: event.clientY, ox: form.cropX || 0, oy: form.cropY || 0, id: event.pointerId };
    if (stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
  }, true);
  document.addEventListener("pointermove", function (event) {
    if (!cropDrag || event.pointerId !== cropDrag.id) return;
    form.cropX = cropDrag.ox + (event.clientX - cropDrag.x);
    form.cropY = cropDrag.oy + (event.clientY - cropDrag.y);
    layoutCrop();
  }, true);
  document.addEventListener("pointerup", function (event) {
    if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
  }, true);
  document.addEventListener("pointercancel", function (event) {
    if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
  }, true);
  var photoBlobs = {};
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
    if (el.name === "accountNumber") {
      var digits = String(el.value || "").replace(/\D/g, "").slice(0, 16);
      el.value = grouped(digits);
      form.accountNumber = digits;
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
    event.preventDefault();
    if (view === "login") {
      doLogin();
    } else if (view === "emergency") {
      doEmergency();
    } else if (view === "restore") {
      doRestoreSession();
    } else if (view === "signup") {
      if (step === 2) {
        if (form.saved) {
          var pending = readPending();
          if (pending) commitSession(pending.token, pending.account);
        }
      } else {
        nextSignup();
      }
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
