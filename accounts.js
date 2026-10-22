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
  var entered = false;
  var view = "";
  var step = 0;
  var form = {};
  var errorText = "";
  var legalTitle = "";
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
    var msg = { type: "auth", on: !!on };
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
    return tr("Something went wrong. Try again.");
  }
  function layer() {
    return document.getElementById("account-layer");
  }
  function field(name, label, type) {
    var value = form[name] == null ? "" : String(form[name]);
    return '<label class="acct-field"><input name="' + esc(name) + '" type="' + (type || "text") + '" placeholder=" " autocomplete="' + (name === "accountNumber" ? "off" : "nickname") + '" value="' + esc(value) + '"><label>' + esc(label) + "</label></label>";
  }
  function closeIcon() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10.6 12 4.8 6.2l1.4-1.4L12 10.6l5.8-5.8 1.4 1.4L13.4 12l5.8 5.8-1.4 1.4L12 13.4l-5.8 5.8-1.4-1.4L10.6 12z"/></svg>';
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
      return '<p class="acct-sub">' + esc(tr("Latin and Cyrillic letters, digits, and underscore. Up to 15 characters.")) + "</p>" + field("handle", tr("Choose a handle")) + claim + turnstileHtml() + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="next">' + esc(tr("Next")) + "</button>";
    }
    return '<p class="acct-sub">' + esc(tr("Your name is shown on your profile.")) + "</p>" + field("displayName", tr("Name")) + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="next">' + esc(tr("Next")) + "</button>";
  }
  function loginBody() {
    return field("accountNumber", tr("Account number")) + turnstileHtml() + '<p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="do-login">' + esc(tr("Log in")) + '</button><p class="acct-switch">' + esc(tr("Don't have an account?")) + ' <button type="button" data-acct="signup">' + esc(tr("Sign up")) + "</button></p>";
  }
  function editBody() {
    var session = readSession();
    var account = session && session.account || {};
    var locked = account.owner ? '<p class="acct-sub">@' + esc(account.handle) + "</p>" : field("handle", tr("Choose a handle"));
    return field("displayName", tr("Name")) + locked + '<label class="acct-field tall"><textarea name="bio" maxlength="160" placeholder=" ">' + esc(form.bio || "") + "</textarea><label>" + esc(tr("Bio")) + '</label></label><label class="acct-file">' + esc(tr("Profile photo")) + '<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label><label class="acct-file">' + esc(tr("Banner")) + '<input name="banner" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="acct-error">' + esc(errorText) + '</p><button class="acct-next" type="button" data-acct="save-profile">' + esc(tr("Save")) + "</button>";
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
    else if (view === "edit") html += modal(tr("Edit profile"), editBody());
    else if (view === "legal") html += modal(legalTitle || tr("About"), legalBody());
    else if (view === "leave") html += modal(tr("Save your account number"), '<p class="acct-sub">' + esc(tr("Leave without saving the account number?")) + '</p><button class="acct-next" type="button" data-acct="abandon">' + esc(tr("Close")) + '</button><button class="acct-line" type="button" data-acct="stay" style="width:100%;margin-top:12px">' + esc(tr("Back")) + "</button>");
    root.innerHTML = html;
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
      form.handle = account.handle || "";
      form.bio = account.bio || "";
    }
    paint();
  }
  function closeAuth() {
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
    return {
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
      forYouReposts: settings.forYouReposts !== false,
      forYouReplies: settings.forYouReplies !== false,
      historyPause: settings.historyPause || { videos: false, articles: false },
      lang: readLang()
    };
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
  function mergePayload(local, remote) {
    remote = remote || {};
    var follows = uniq([].concat(local.follows || [], remote.follows || []));
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
      forYouReposts: local.forYouReposts !== false,
      forYouReplies: local.forYouReplies !== false,
      historyPause: local.historyPause || remote.historyPause || { videos: false, articles: false },
      lang: local.lang || remote.lang || "en"
    };
  }
  function applySnapshot(payload) {
    var raw = readStored("settings-v1");
    var settings = {};
    try { settings = raw ? JSON.parse(raw) : {}; } catch (err) { settings = {}; }
    Object.keys(payload || {}).forEach(function (key) {
      if (key === "lang") return;
      settings[key] = payload[key];
    });
    writeStored("settings-v1", JSON.stringify(settings));
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
  function saveProfile() {
    var session = readSession();
    if (!session) return;
    var avatarInput = document.querySelector("#account-layer input[name=avatar]");
    var bannerInput = document.querySelector("#account-layer input[name=banner]");
    var avatarFile = avatarInput && avatarInput.files && avatarInput.files[0];
    var bannerFile = bannerInput && bannerInput.files && bannerInput.files[0];
    Promise.all([fitImage(avatarFile, 400, 150000), fitImage(bannerFile, 1500, 280000)]).then(function (images) {
      if ((avatarFile && !images[0]) || (bannerFile && !images[1])) {
        errorText = tr("Could not save that photo.");
        paint();
        return;
      }
      var body = {
        displayName: String(form.displayName || "").trim(),
        bio: String(form.bio || "")
      };
      if (!session.account.owner) body.handle = String(form.handle || "").trim().replace(/^@/, "");
      if (images[0]) body.avatar = images[0];
      if (images[1]) body.banner = images[1];
      return api("/v1/profile", { method: "PATCH", token: session.token, body: body }).then(function (res) {
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
      });
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
    if (!session || profiles[key] || profileLoads[key] || !config().api) return;
    profileLoads[key] = true;
    api("/v1/profile/" + encodeURIComponent(handle), { token: session.token }).then(function (body) {
      if (body && body.account) {
        remember(body.account);
        if (window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
      }
    }).catch(function () {});
  }
  function accountPage(account) {
    var session = readSession();
    var mine = session && session.account && session.account.publicId === account.publicId;
    var photo = account.avatar
      ? '<img class="pava" src="' + esc(account.avatar) + '" alt="">'
      : '<span class="ava pava initials">' + esc(initials(account.displayName)) + "</span>";
    var banner = account.banner ? '<img class="pbanner" src="' + esc(account.banner) + '" alt="">' : '<div class="pbanner"></div>';
    var edit = mine ? '<button class="follow" type="button" data-acct="edit">' + esc(tr("Edit profile")) + "</button>" : "";
    return '<div class="topbar profile-bar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.4 13l5.3 5.3-1.4 1.4L3.6 12l7.7-7.7 1.4 1.4L7.4 11H21v2H7.4z"/></svg></button><div class="head-text"><div class="pt-name">' + esc(account.displayName || account.handle) + '</div><div class="pt-count">' + esc(tr("{count} posts", { count: "0" })) + "</div></div></div></div>" + banner + '<div class="pinfo"><div class="pava-row">' + photo + '<div class="pactions">' + edit + '</div></div><h1 class="pname">' + esc(account.displayName || account.handle) + (account.owner ? badge() : "") + '</h1><div class="phandle">@' + esc(account.handle) + '</div><div class="acct-id">' + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + "</div>" + (account.bio ? '<div class="pbio">' + esc(account.bio) + "</div>" : "") + '<div class="counts"><div><b>0</b> <span>' + esc(tr("Following count")) + "</span></div><div><b>0</b> <span>" + esc(tr("Followers")) + "</span></div></div></div>" + '<div class="tabs ptabs" role="tablist"><a class="tab on" role="tab" aria-selected="true"><span>' + esc(tr("Profile")) + "</span></a></div>" + '<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2><p>" + esc(tr("Posts from this account will show up here.")) + "</p></div>";
  }
  function profileHtml(route) {
    if (!route || route.name !== "profile" || !route.handle || route.handle === "_") return "";
    var account = profiles[skel(route.handle)];
    var session = readSession();
    if (!account && session && session.account && skel(session.account.handle) === skel(route.handle)) account = session.account;
    if (!account) {
      loadProfile(route.handle);
      return "";
    }
    return accountPage(account);
  }
  function pillInner() {
    var session = readSession();
    if (!session || !session.account) return "";
    var account = session.account;
    var photo = account.avatar
      ? '<img class="ava" src="' + esc(account.avatar) + '" alt="">'
      : '<span class="ava initials">' + esc(initials(account.displayName)) + "</span>";
    return photo + '<span class="account-meta"><b>' + esc(account.displayName || "") + "</b><span>@" + esc(account.handle || "") + "</span></span>";
  }
  function drawerHead() {
    var session = readSession();
    if (!session || !session.account) return "";
    var account = session.account;
    var photo = account.avatar
      ? '<img class="ava" src="' + esc(account.avatar) + '" alt="">'
      : '<span class="ava initials">' + esc(initials(account.displayName)) + "</span>";
    return '<a href="#/@' + encodeURIComponent(account.handle) + '" style="padding:16px 20px;display:flex;gap:12px;align-items:center;color:inherit;text-decoration:none">' + photo + "<div><b>" + esc(account.displayName || "") + '</b><div class="phandle">@' + esc(account.handle || "") + "</div></div></a>";
  }
  function settingsHtml() {
    var session = readSession();
    if (!session || !session.account) return "";
    var account = session.account;
    return '<div class="set-block acct-settings"><h2>' + esc(tr("Your account")) + "</h2><p class=\"phandle\">@" + esc(account.handle) + "</p><p class=\"phandle\">" + esc(tr("Account ID")) + " " + esc(grouped(account.publicId)) + '</p><button class="outline" type="button" data-acct="edit">' + esc(tr("Edit profile")) + '</button><button class="outline" type="button" data-acct="logout">' + esc(tr("Log out")) + '</button><button class="outline" type="button" data-acct="logout-all">' + esc(tr("Log out of all devices")) + "</button></div>";
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
    else if (act === "logout") logout(false);
    else if (act === "logout-all") logout(true);
    else if (act === "legal") { legalTitle = acct.dataset.title || tr("About"); view = "legal"; paint(); }
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", function (event) {
    var el = event.target;
    if (!el || !el.closest || !el.closest("#account-layer") || !el.name) return;
    if (el.name === "accountNumber") {
      var digits = String(el.value || "").replace(/\D/g, "").slice(0, 16);
      el.value = grouped(digits);
      form.accountNumber = digits;
      return;
    }
    form[el.name] = el.value;
  }, true);
  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.closest || !el.closest("#account-layer")) return;
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
    requestRender: null
  };
})();
