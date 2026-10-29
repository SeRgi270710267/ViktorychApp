/* Custom TV app name builder (client). Used by tv/index.html and tv.js.
   POST {api}/v1/tv/build starts a private build of the TV app with your
   home-screen name; it keeps the same package, key and version as the base
   app, so it installs over it and keeps your data. Then this polls until the
   APK is ready and hands back a one-press download link. */
(function (root) {
  "use strict";
  var PENDING = "viktorychapp-tv-build-v1";
  var POLL_MS = 10000;
  var GIVE_UP_MS = 25 * 60 * 1000;

  function apiRoot() {
    var c = root.VIKTORYCH_ACCOUNTS || {};
    return String(c.api || "").replace(/\/$/, "");
  }

  function session() {
    try {
      var raw = root.localStorage.getItem("viktorychapp-account-v1");
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.token ? parsed : null;
    } catch (err) { return null; }
  }

  function ready() { return !!(apiRoot() && session()); }

  function request(path, init) {
    var s = session();
    var headers = { "Authorization": "Bearer " + (s ? s.token : "") };
    if (init && init.body) headers["Content-Type"] = "application/json";
    return fetch(apiRoot() + path, { method: (init && init.method) || "GET", headers: headers, body: init && init.body, credentials: "omit", cache: "no-store" })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          body = body || {};
          body.status = res.status;
          return body;
        });
      });
  }

  function savePending(job) {
    try {
      if (job) root.localStorage.setItem(PENDING, JSON.stringify(job));
      else root.localStorage.removeItem(PENDING);
    } catch (err) { /* private mode */ }
  }

  function pending() {
    try {
      var job = JSON.parse(root.localStorage.getItem(PENDING) || "null");
      if (job && job.id && Date.now() - Number(job.at || 0) < GIVE_UP_MS) return job;
    } catch (err) { /* bad copy */ }
    return null;
  }

  function errorText(body) {
    var code = body && body.error;
    if (body && body.status === 401) return "signin";
    if (code === "rate_limited" || (body && body.status === 429)) return "limit";
    if (code === "not_ready") return "not_ready";
    if (code === "bad_name") return "bad_name";
    return "failed";
  }

  /* onState(state, extra): "building" | "ready" {download} | an error code. */
  function poll(job, onState) {
    var stopped = false;
    function tick() {
      if (stopped) return;
      if (Date.now() - Number(job.at || 0) > GIVE_UP_MS) { savePending(null); onState("failed"); return; }
      request("/v1/tv/build/" + encodeURIComponent(job.id)).then(function (body) {
        if (stopped) return;
        if (body.state === "ready" && body.download) {
          savePending(null);
          onState("ready", { download: apiRoot() + body.download, label: job.label, icon: job.icon });
          return;
        }
        if (body.state === "failed") { savePending(null); onState("failed"); return; }
        if (body.state !== "building") { onState(errorText(body)); if (body.status !== 429) return; }
        else onState("building", job);
        setTimeout(tick, POLL_MS);
      }, function () { if (!stopped) setTimeout(tick, POLL_MS * 2); });
    }
    tick();
    return function () { stopped = true; };
  }

  function start(label, icon, onState) {
    var tv = root.ViktorychTVMode;
    var name = tv ? tv.cleanLabel(label) : String(label || "").trim();
    if (!name) { onState("bad_name"); return function () {}; }
    if (!ready()) { onState("signin"); return function () {}; }
    if (tv) tv.setCustom(name, icon);
    var stop = null;
    var cancelled = false;
    onState("building", { label: name, icon: icon });
    request("/v1/tv/build", { method: "POST", body: JSON.stringify({ name: name, icon: icon }) }).then(function (body) {
      if (cancelled) return;
      if (body.status !== 202 || !body.id) { onState(errorText(body)); return; }
      var job = { id: body.id, label: body.name || name, icon: body.icon || icon, at: Date.now() };
      savePending(job);
      stop = poll(job, onState);
    }, function () { onState("failed"); });
    return function () { cancelled = true; if (stop) stop(); };
  }

  root.ViktorychTVBuilder = { ready: ready, signedIn: function () { return !!session(); }, configured: function () { return !!apiRoot(); }, start: start, poll: poll, pending: pending };
})(typeof window !== "undefined" ? window : globalThis);
