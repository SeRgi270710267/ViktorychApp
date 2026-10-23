/* Sign-up, sign-in, and the logged-out landing. The reader stays as it is
   until accounts.config.js has gate:true, which the deploy sets only after
   the account API is healthy. */
(function () {
  var RETURN_KEY = "viktorychapp-return-v1";
  var PENDING_KEY = "viktorychapp-pending-v1";
  var DATA_KEY = /^(?:feeds|stories|people|suggestions|status|feeds\.config)\.json$|^data\/music\.json$|^(?:live|archive|comments|fallback)\/[A-Za-z0-9._-]{1,120}\.json$|^discord\/(?:index|state)\.json$|^discord\/(?:messages|pins)\/\d{1,22}\.json$/;
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
  function tellSW(on) {
    if (!navigator.serviceWorker) return;
    var session = on ? readSession() : null;
    var msg = { type: "auth", on: !!on, token: session && session.token ? session.token : "" };
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
    var api = String(config().api || "").replace(/\/$/, "");
    if (!api) return Promise.resolve(new Response("", { status: 401 }));
    var headers = new Headers(init && init.headers || (typeof input !== "string" && input && input.headers) || {});
    headers.set("Authorization", "Bearer " + session.token);
    return nativeFetch(api + "/v1/data/" + key.split("/").map(encodeURIComponent).join("/"), {
      method: "GET",
      headers: headers,
      credentials: "omit",
      cache: "no-store"
    });
  }
  function api(path, opts) {
    var root = String(config().api || "").replace(/\/$/, "");
    var headers = {};
    opts = opts || {};
    if (opts.body) headers["content-type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    return nativeFetch(root + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "omit"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        body = body || {};
        body.status = res.status;
        return body;
      });
    });
  }
  function errorMessage(code) {
    if (code === "handle_reserved") return tr("That handle is reserved.");
    if (code === "handle_taken") return tr("That handle is taken.");
    if (code === "invalid_handle") return tr("That handle is not allowed.");
    if (code === "claim_required") return tr("Enter the claim code for this handle.");
    if (code === "invalid_claim") return tr("That claim code is not valid.");
    if (code === "rate_limited") return tr("Too many attempts. Try again later.");
    if (code === "invalid_credentials") return tr("Could not sign in.");
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
      return '<p class="acct-sub">' + esc(tr("Latin and Cyrillic letters, digits, and underscore. Up to 15 characters.")) + "</p>" + field("handle", tr("Choose a handle"), "text", 15) + claim + turnstileHtml() + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="next">' + esc(tr("Next")) + "</button>";
    }
    return '<p class="acct-sub">' + esc(tr("Your name is shown on your profile.")) + "</p>" + field("displayName", tr("Name"), "text", 50) + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="next">' + esc(tr("Next")) + "</button>";
  }
  function loginBody() {
    return field("accountNumber", tr("Account number")) + turnstileHtml() + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="do-login">' + esc(tr("Log in")) + '</button><p class="acct-switch">' + esc(tr("Don't have an account?")) + ' <button type="button" data-acct="signup">' + esc(tr("Sign up")) + "</button></p>";
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
    return editMedia() + field("displayName", tr("Name"), "text", 50) + textArea("bio", tr("Bio"), 160) + field("location", tr("Location"), "text", 30) + field("website", tr("Website"), "text", 100) + '<p class="acct-error">' + esc(errorText) + "</p>";
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
  function paint() {
    var root = layer();
    if (!root) return;
    var html = "";
    if (blocking()) html += landing();
    if (view === "signup") html += modal(tr("Create your account"), signupBody());
    else if (view === "login") html += modal(tr("Sign in to {app}", { app: appName() }), loginBody());
    else if (view === "edit") html += editModal(editBody());
    else if (view === "crop") html += cropModal();
    else if (view === "legal") html += modal(legalTitle || tr("About"), legalBody());
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
    form = {};
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
      lang: readLang()
    };
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
    return {
      follows: follows,
      seenFeeds: uniq([].concat(local.seenFeeds || [], remote.seenFeeds || [], follows)),
      seenDefaults: uniq([].concat(local.seenDefaults || [], remote.seenDefaults || [], follows)),
      lists: unionById(local.lists, remote.lists),
      likes: unionObjects(local.likes, remote.likes),
      bookmarks: unionObjects(local.bookmarks, remote.bookmarks),
      reposts: unionObjects(local.reposts, remote.reposts),
      savedPosts: unionObjects(local.savedPosts, remote.savedPosts),
      feedTabs: unionById(local.feedTabs, remote.feedTabs),
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
      lang: local.lang || remote.lang || "en"
    };
  }
  function applySnapshot(payload) {
    var raw = readStored("settings-v1");
    var settings = {};
    try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    Object.keys(payload || {}).forEach(function (key) {
      if (key === "lang" || key === "history") return;
      settings[key] = payload[key];
    });
    writeStored("settings-v1", JSON.stringify(settings));
    if (window.ViktorychAccounts && window.ViktorychAccounts.writeHistory) window.ViktorychAccounts.writeHistory(payload);
    if (payload && (payload.lang === "en" || payload.lang === "ru" || payload.lang === "es")) {
      try { localStorage.setItem("superintelapp-lang", payload.lang); } catch (err) { /* the page language stays */ }
    }
  }
  function rememberSync(updatedAt) {
    var session = readSession();
    if (!session) return;
    session.syncAt = Number(updatedAt) || 0;
    writeSession(session);
  }
  function pushPayload(payload, base) {
    var session = readSession();
    if (!session || !config().api) return Promise.resolve();
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
    if (!session || !config().api) return Promise.resolve();
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
    if (readSession()) mergeSync();
  }
  function onLocalChange() {
    if (!readSession() || !config().api || pushing) return;
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
      if (!name) {
        errorText = tr("What should we call you?");
        paint();
        return;
      }
      step = 1;
      paint();
      return;
    }
    var handle = String(form.handle || "").trim().replace(/^@/, "");
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
      displayName: String(form.displayName || "").trim(),
      handle: handle,
      claimCode: String(form.claimCode || "").trim(),
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
      errorText = tr("Something went wrong. Try again.");
      paint();
    });
  }
  function doLogin() {
    var digits = String(form.accountNumber || "").replace(/\D/g, "");
    errorText = "";
    api("/v1/login", { method: "POST", body: { accountNumber: digits, turnstileToken: turnstileToken() } }).then(function (res) {
      if (res.status !== 200 || !res.token) {
        errorText = errorMessage(res.error);
        paint();
        return;
      }
      commitSession(res.token, res.account);
    }).catch(function () {
      errorText = tr("Something went wrong. Try again.");
      paint();
    });
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
    if (token && config().api) api("/v1/logout", { method: "POST", token: token }).catch(function () {});
    paint();
  }
  function logout(all) {
    var session = readSession();
    var token = session && session.token;
    removeStored("account-v1");
    tellSW(false);
    var done = function () { location.replace(location.pathname + location.search); location.reload(); };
    if (!token || !config().api) { done(); return; }
    api(all ? "/v1/logout-all" : "/v1/logout", { method: "POST", token: token }).then(done, done);
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
      website: String(form.website || "").trim()
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
  }
  function loadProfile(handle) {
    var key = skel(handle);
    var session = readSession();
    if (!session || profileLoads[key] || profileMiss[key] || !config().api) return;
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
  function accountPage(account) {
    var session = readSession();
    var mine = session && session.account && session.account.publicId === account.publicId;
    var photo = publicAvatar(account.avatar, account.avatarFace, "pava");
    var banner = publicBanner(account.banner, account.bannerFace);
    var edit = mine ? '<button class="follow" type="button" data-acct="edit">' + esc(tr("Edit profile")) + "</button>" : "";
    var pack = { html: "", count: 0 };
    if (window.ViktorychAccounts && window.ViktorychAccounts.profilePostsHtml) pack = window.ViktorychAccounts.profilePostsHtml(account) || pack;
    var count = String(pack.count || 0);
    var body = pack.html || ('<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2><p>" + esc(tr("Posts from this account will show up here.")) + "</p></div>");
    return '<div class="topbar profile-bar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.4 13l5.3 5.3-1.4 1.4L3.6 12l7.7-7.7 1.4 1.4L7.4 11H21v2H7.4z"/></svg></button><div class="head-text"><div class="pt-name">' + esc(account.displayName || account.handle) + '</div><div class="pt-count">' + esc(tr("{count} posts", { count: count })) + "</div></div></div></div>" + banner + '<div class="pinfo"><div class="pava-row">' + photo + '<div class="pactions">' + edit + '</div></div><h1 class="pname">' + esc(account.displayName || account.handle) + (account.owner ? badge() : "") + '</h1><div class="phandle">@' + esc(account.handle) + '</div><div class="acct-id">' + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + "</div>" + (account.bio ? '<div class="pbio">' + esc(account.bio) + "</div>" : "") + (account.location ? '<div class="acct-loc">' + esc(account.location) + "</div>" : "") + (siteHref(account.website) ? '<div class="acct-loc"><a href="' + esc(siteHref(account.website)) + '" target="_blank" rel="noopener noreferrer">' + esc(account.website) + "</a></div>" : "") + '<div class="counts"><div><b>0</b> <span>' + esc(tr("Following count")) + "</span></div><div><b>0</b> <span>" + esc(tr("Followers")) + "</span></div></div></div>" + '<div class="tabs ptabs" role="tablist" aria-label="' + esc(tr("Profile")) + '"><a class="tab on" role="tab" aria-selected="true"><span>' + esc(tr("Posts")) + "</span></a></div>" + body;
  }
  function profileHtml(route) {
    if (!route || route.name !== "profile" || !route.handle || route.handle === "_") return "";
    var key = skel(route.handle);
    if (profileMiss[key]) return "";
    var account = profiles[key];
    var session = readSession();
    if (!account && session && session.account && skel(session.account.handle) === key) account = session.account;
    if (!account) {
      loadProfile(route.handle);
      return "";
    }
    if (!account.repostsLoaded) loadProfile(route.handle);
    return accountPage(account);
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
    if (!session || !session.account) return "";
    var account = session.account;
    var photo = publicAvatar(account.avatar, account.avatarFace, "");
    return photo + '<span class="account-meta"><b>' + esc(account.displayName || "") + "</b><span>@" + esc(account.handle || "") + "</span></span>";
  }
  function drawerHead() {
    var session = readSession();
    if (!session || !session.account) return "";
    var account = session.account;
    var photo = publicAvatar(account.avatar, account.avatarFace, "");
    return '<a href="#/@' + encodeURIComponent(account.handle) + '" style="padding:16px 20px;display:flex;gap:12px;align-items:center;color:inherit;text-decoration:none">' + photo + "<div><b>" + esc(account.displayName || "") + '</b><div class="phandle">@' + esc(account.handle || "") + "</div></div></a>";
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
  function healthHtml() {
    var body = tiktokHealth;
    var blocked = body ? (body.blocked403 || 0) + (body.blocked429 || 0) + (body.captcha || 0) : 0;
    var rows = body && body.backoffs || [];
    var lines = '<p class="phandle">' + esc(tr("No recent blocks.")) + "</p>";
    if (body && (blocked || rows.length)) {
      lines = '<p class="phandle">' + esc("403 " + (body.blocked403 || 0) + " · 429 " + (body.blocked429 || 0) + " · captcha " + (body.captcha || 0)) + "</p>";
      lines += rows.map(function (row) {
        var when = "";
        try { when = row.until ? new Date(row.until).toLocaleString() : ""; } catch (err) { when = row.until || ""; }
        return '<p class="phandle">@' + esc(row.handle || "") + " " + esc(tr("Backing off until {time}", { time: when })) + "</p>";
      }).join("");
    }
    return '<div class="set-block"><h2>' + esc(tr("TikTok health")) + "</h2>" + lines + "</div>";
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
  function settingsHtml() {
    var session = readSession();
    if (!session || !session.account) return "";
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
    return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + "</h2><p class=\"phandle\">@" + esc(account.handle) + "</p><p class=\"phandle\">" + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + '</p><button class="outline" type="button" data-acct="edit">' + esc(tr("Edit profile")) + '</button><h2>' + esc(tr("Hide my profile picture")) + '</h2><p class="set-sub">' + esc(tr("Other people see this instead of your photo.")) + '</p><div class="theme-row" role="group" aria-label="' + esc(tr("Hide my profile picture")) + '">' + hideBtn("", tr("Show my picture")) + hideBtn("default", tr("Default")) + hideBtn("none", tr("None")) + '</div><button class="outline" type="button" data-acct="logout">' + esc(tr("Log out")) + '</button><button class="outline" type="button" data-acct="logout-all">' + esc(tr("Log out of all devices")) + "</button></div>" + health;
  }
  function onClick(event) {
    var acct = event.target && event.target.closest ? event.target.closest("[data-acct]") : null;
    if (!acct) return;
    event.preventDefault();
    event.stopPropagation();
    var act = acct.dataset.acct;
    if (act === "signup") openAuth("signup");
    else if (act === "login") openAuth("login");
    else if (act === "close") closeAuth();
    else if (act === "stay") { view = "signup"; step = 2; paint(); }
    else if (act === "next") nextSignup();
    else if (act === "do-login") doLogin();
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
    else if (act === "hide-avatar") hideAvatar(acct.dataset.mode || "");
    else if (act === "crop-apply") applyCrop();
    else if (act === "logout") logout(false);
    else if (act === "add-channel") addBackupChannel();
    else if (act === "remove-channel") removeBackupChannel(acct.dataset.index);
    else if (act === "logout-all") logout(true);
    else if (act === "legal") { legalTitle = acct.dataset.title || tr("About"); view = "legal"; paint(); }
  }
  var cropDrag = null;
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
    if (el.name === "saved") {
      form.saved = !!el.checked;
      var button = document.querySelector('#account-layer [data-acct="saved"]');
      if (button) button.disabled = !form.saved;
    }
  }, true);
  window.addEventListener("hashchange", function () {
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
  }
  if (window.SI18n && window.SI18n.onChange) window.SI18n.onChange(function () { if (blocking() || view) paint(); });
  if (blocking()) enter();

  window.ViktorychAccounts = {
    blocking: blocking,
    enter: enter,
    profileHtml: profileHtml,
    pillInner: pillInner,
    drawerHead: drawerHead,
    settingsHtml: settingsHtml,
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
    account: function () {
      var session = readSession();
      return session && session.account ? session.account : null;
    },
    token: function () {
      var session = readSession();
      return session && session.token ? session.token : "";
    }
  };
})();
