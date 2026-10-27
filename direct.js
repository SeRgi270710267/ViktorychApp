/* Public reads from the device. Keyless endpoints that send
   Access-Control-Allow-Origin for our origins are fetched here, paced per
   host, and kept in the local store. The Worker is the fallback only when a
   caller supplies one and the direct attempt fails on CORS, the network, or
   HTTP 5xx. Owner keys, cookies, and session secrets are never attached. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychDirect = api;
})(typeof self !== "undefined" ? self : this, function () {
  var ALLOW = {
    "public.api.bsky.app": { gap: 350, name: "Bluesky" },
    "api.fxtwitter.com": { gap: 450, name: "fxtwitter" },
    "api.invidious.io": { gap: 800, name: "Invidious" },
    "archive.org": { gap: 500, name: "Internet Archive" },
    "raw.githubusercontent.com": { gap: 200, name: "GitHub" },
    "cdn.jsdelivr.net": { gap: 80, name: "jsDelivr" },
    "mastodon.social": { gap: 1100, name: "Mastodon" }
  };
  var CACHE_MS = 5 * 60 * 1000;
  var counts = { direct: 0, server: 0 };
  var lastAt = {};
  var memory = {};
  var fetcher = null;
  var deviceHeld = false;

  function parse(url) {
    var base = (typeof location !== "undefined" && location.href) ? location.href : "https://app.local";
    try { return new URL(String(url || ""), base); }
    catch (err) { return null; }
  }

  function sameOriginJson(url) {
    if (typeof location === "undefined" || !location.origin) return false;
    return url.origin === location.origin && /\.json$/i.test(url.pathname || "");
  }

  function blocked(url) {
    var path = url.pathname || "";
    if (/\/v1\/(?:session|login|logout|logout-all|auth|account|me|owner)(?:\/|$)/i.test(path)) return true;
    if (/owner-keys/i.test(path)) return true;
    if (/\/v1\/yt(?:\/|$)/i.test(path)) return true;
    if (/\/tg\//i.test(path)) return true;
    if (/(^|\.)workers\.dev$/i.test(url.hostname)) return true;
    if (/(^|\.)onrender\.com$/i.test(url.hostname)) return true;
    return false;
  }

  function mastodonApi(url) {
    if (!url || url.protocol !== "https:" || url.username || url.password) return false;
    if (!/^\/api\/v1\/(?:accounts|instance|timelines|trends|statuses)(?:\/|$)/.test(url.pathname || "")) return false;
    if (blocked(url)) return false;
    return true;
  }

  function allows(value) {
    var url = parse(value);
    if (!url || blocked(url) || url.username || url.password) return false;
    if (sameOriginJson(url)) return true;
    if (url.protocol !== "https:") return false;
    if (ALLOW[url.hostname]) return true;
    if (readOnlyHost(url)) return true;
    return mastodonApi(url);
  }

  function deviceApi() {
    if (typeof self !== "undefined" && self.ViktorychDevice) return self.ViktorychDevice;
    if (typeof window !== "undefined" && window.ViktorychDevice) return window.ViktorychDevice;
    if (typeof require === "function") {
      try { return require("./device.js"); } catch (err) { return null; }
    }
    return null;
  }

  var PACE = {
    "www.reddit.com": 2000,
    "old.reddit.com": 2000,
    "discord.com": 2000,
    "api.vk.com": 2000
  };

  function readOnlyHost(url) {
    var host = url.hostname;
    var path = url.pathname || "";
    if (host === "www.reddit.com" || host === "old.reddit.com") return /\.json$/i.test(path);
    if (host === "discord.com") return /^\/api\/guilds\/\d{1,22}\/widget\.json$/i.test(path);
    if (host === "api.vk.com") return path === "/method/wall.get" || path === "/method/groups.getById" || path === "/method/users.get";
    return false;
  }

  function gapFor(hostname) {
    var row = ALLOW[hostname];
    if (row) return row.gap;
    if (PACE[hostname]) return PACE[hostname];
    return 1100;
  }

  function paceWait(hostname, now) {
    var gap = gapFor(hostname);
    var last = lastAt[hostname] || 0;
    if (!last) return 0;
    var due = last + gap;
    return due > now ? due - now : 0;
  }

  function markPace(hostname, now) {
    lastAt[hostname] = now;
  }

  function safeHeaders(init) {
    var headers = {};
    var source = init && init.headers;
    if (source && typeof source.forEach === "function") {
      source.forEach(function (value, key) { headers[String(key).toLowerCase()] = value; });
    } else if (source) {
      Object.keys(source).forEach(function (key) { headers[String(key).toLowerCase()] = source[key]; });
    }
    delete headers.authorization;
    delete headers.cookie;
    delete headers["x-viktorych-token"];
    delete headers["x-owner-key"];
    headers.accept = headers.accept || "application/json";
    return headers;
  }

  function note(field) {
    counts[field] = (counts[field] || 0) + 1;
    var api = (typeof self !== "undefined" && self.ViktorychStorage) ? self.ViktorychStorage : null;
    if (!api && typeof require === "function") {
      try { api = require("./storage.js"); } catch (err) { api = null; }
    }
    if (api && typeof indexedDB !== "undefined" && api.openDb && api.bump) {
      api.openDb().then(function (db) { return api.bump(db, field); }).catch(function () {});
    }
  }

  function cacheGet(url, now) {
    var row = memory[url];
    if (!row) return null;
    if (now - row.at > CACHE_MS) return null;
    return row.body;
  }

  function cacheSet(url, body, now) {
    memory[url] = { body: body, at: now };
    var api = (typeof self !== "undefined" && self.ViktorychStorage) ? self.ViktorychStorage : null;
    if (api && typeof indexedDB !== "undefined" && api.openDb && api.putDoc) {
      var host = "";
      try { host = new URL(url).hostname; } catch (err) { host = "direct"; }
      api.openDb().then(function (db) {
        return api.putDoc(db, { category: "feeds", id: "direct:" + host + ":" + url.length, body: body, bytes: JSON.stringify(body).length });
      }).catch(function () {});
    }
  }

  function callFetch(url, init) {
    var fn = fetcher || (typeof fetch === "function" ? fetch : null);
    if (!fn) return Promise.reject(new Error("fetch"));
    return fn(url, init);
  }

  function shouldFallback(status, err) {
    if (err) return true;
    if (!status) return true;
    return status >= 500;
  }

  function githubMirror(url) {
    var parsed = parse(url);
    if (!parsed || parsed.hostname !== "raw.githubusercontent.com") return "";
    var parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return "";
    var org = parts[0];
    var repo = parts[1];
    var branch = parts[2];
    var rest = parts.slice(3).join("/");
    return "https://cdn.jsdelivr.net/gh/" + org + "/" + repo + "@" + branch + "/" + rest;
  }

  function isServer(url) {
    var parsed = parse(url);
    if (!parsed) return false;
    if (blocked(parsed)) return true;
    return /\/v1\//.test(parsed.pathname);
  }

  function fallbackFetch(next) {
    if (isServer(next)) {
      note("server");
      return callFetch(next, { method: "GET", credentials: "omit", mode: "cors", cache: "no-store", redirect: "follow" });
    }
    return once(next).then(function (alt) {
      if (alt && (alt.ok || alt.status === 304)) note("direct");
      return alt;
    });
  }

  function once(url, init) {
    var parsed = parse(url);
    if (!parsed || !allows(parsed.href)) return Promise.reject(new Error("blocked"));
    var wait = paceWait(parsed.hostname, Date.now());
    var headers = safeHeaders(init);
    return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(function () {
      markPace(parsed.hostname, Date.now());
      return callFetch(parsed.href, { method: "GET", headers: headers, credentials: "omit", mode: "cors", cache: "no-store", redirect: "follow", signal: init && init.signal });
    });
  }

  function fetchPublic(url, fallback, init) {
    var primary = String(url || "");
    return once(primary, init).then(function (res) {
      var next = fallback || githubMirror(primary);
      if (res && shouldFallback(res.status) && next && next !== primary) return fallbackFetch(next);
      note("direct");
      return res;
    }).catch(function () {
      var next = fallback || githubMirror(primary);
      if (next && next !== primary) return fallbackFetch(next);
      return Promise.reject(new Error("network"));
    });
  }

  function jsonSize(body) {
    try { return JSON.stringify(body).length; }
    catch (err) { return 0; }
  }

  function fetchSource(url, server, init) {
    var primary = String(url || "");
    var dev = deviceApi();
    var settings = dev && dev.read ? dev.read() : null;
    var signals = dev && dev.signals ? dev.signals() : {};
    var enabled = !dev || !dev.featureOn || dev.featureOn(settings || dev.normalize(null), "direct", signals);
    var fresh = !!(init && init.fresh);
    var hit = !fresh && cacheGet(primary, Date.now());
    if (hit && enabled) {
      note("direct");
      if (dev && dev.noteStat) dev.noteStat("local", "direct", jsonSize(hit), 1);
      return Promise.resolve(hit);
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    function local() {
      var nextInit = init || {};
      if (ctrl && !nextInit.signal) nextInit = Object.assign({}, nextInit, { signal: ctrl.signal });
      return once(primary, nextInit).then(function (res) {
        if (!res || !res.ok) {
          var err = new Error("status");
          err.status = res && res.status;
          throw err;
        }
        return res.json().then(function (body) {
          if (body == null || body === "") throw new Error("empty");
          if (typeof body !== "object") throw new Error("invalid");
          cacheSet(primary, body, Date.now());
          note("direct");
          return body;
        });
      });
    }
    function remote() {
      if (typeof server === "function") {
        note("server");
        return Promise.resolve().then(server).then(function (body) {
          if (body == null || body === "") throw new Error("empty");
          return body;
        });
      }
      var next = typeof server === "string" && server ? server : githubMirror(primary);
      if (!next || next === primary) {
        var err = new Error("both");
        err.both = true;
        throw err;
      }
      note("server");
      return callFetch(next, { method: "GET", credentials: "omit", mode: "cors", cache: "no-store" }).then(function (res) {
        if (!res || !res.ok) throw new Error("status");
        return res.json();
      });
    }
    if (!allows(primary)) return remote().catch(function (err) { err.both = true; throw err; });
    if (!enabled) return remote().catch(function () { return json(primary); });
    if (deviceHeld || !dev || !dev.runLocal) return json(primary, typeof server === "string" ? server : githubMirror(primary), init);
    var host = "";
    try { host = new URL(primary).hostname; } catch (err) { host = primary; }
    var distinct = typeof server === "function" || (typeof server === "string" && server && server !== primary) || !!githubMirror(primary);
    return dev.runLocal("direct", host, local, remote, {
      settings: settings || dev.normalize(null),
      signals: signals,
      timeout: distinct ? dev.TIMEOUT_MS : 8000,
      abort: function () { if (ctrl) ctrl.abort(); },
      valid: function (value) { return value != null && typeof value === "object"; }
    }).then(function (out) { return out.value; });
  }

  function json(url, fallback, opts) {
    var key = String(url || "");
    if (!(opts && opts.fresh)) {
      var hit = cacheGet(key, Date.now());
      if (hit) {
        note("direct");
        return Promise.resolve(hit);
      }
    }
    return fetchPublic(key, fallback).then(function (res) {
      if (!res || !res.ok) {
        var err = new Error(String(res && res.status || "network"));
        err.status = res && res.status;
        throw err;
      }
      return res.json().then(function (body) {
        cacheSet(key, body, Date.now());
        return body;
      });
    });
  }

  function bskyProfileUrl(actor) {
    return "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=" + encodeURIComponent(String(actor || "").replace(/^@/, ""));
  }

  function bskyFeedUrl(actor) {
    return "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" + encodeURIComponent(String(actor || "").replace(/^@/, "")) + "&limit=30";
  }

  function mastodonLookup(instance, acct) {
    var host = String(instance || "mastodon.social").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return "https://" + host + "/api/v1/accounts/lookup?acct=" + encodeURIComponent(String(acct || "").replace(/^@/, ""));
  }

  function mastodonStatuses(instance, id) {
    var host = String(instance || "mastodon.social").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return "https://" + host + "/api/v1/accounts/" + encodeURIComponent(id) + "/statuses?limit=20";
  }

  function splitMastodon(text) {
    var raw = String(text || "").trim();
    var url = raw.match(/^https?:\/\/([^/]+)\/@([^/?#]+)\/?$/i);
    if (url) return { instance: url[1], acct: decodeURIComponent(url[2]) };
    var both = raw.match(/^@?([^@\s]+)@([^@\s]+)$/);
    if (both) return { instance: both[2], acct: both[1] };
    return { instance: "mastodon.social", acct: raw.replace(/^@/, "") };
  }

  function splitBsky(text) {
    var raw = String(text || "").trim();
    var url = raw.match(/bsky\.app\/profile\/([^/?#]+)/i);
    if (url) return decodeURIComponent(url[1]);
    return raw.replace(/^@/, "");
  }

  function noteServer() {
    note("server");
  }

  function countsNow() {
    return { direct: counts.direct, server: counts.server };
  }

  function setFetch(fn) {
    fetcher = fn;
  }

  function holdDevice(on) {
    deviceHeld = on !== false;
  }

  function reset() {
    counts.direct = 0;
    counts.server = 0;
    lastAt = {};
    memory = {};
    deviceHeld = false;
  }

  function audit() {
    return [
      { id: "bluesky", where: "device", why: "public.api.bsky.app allows every origin and needs no key. The browser paces reads and keeps the JSON locally." },
      { id: "mastodon", where: "device", why: "Public Mastodon /api/v1 reads allow every origin and need no key. mastodon.social allows 300 requests per window, so this device waits 1.1s between calls." },
      { id: "fxtwitter", where: "device", why: "api.fxtwitter.com allows every origin. The browser already reads it. Worker /v1/x stays for GitHub Actions because it needs a secret that never reaches the client." },
      { id: "invidious-directory", where: "device", why: "api.invidious.io allows every origin and needs no key." },
      { id: "internet-archive", where: "device", why: "archive.org metadata allows every origin and needs no key." },
      { id: "github-raw", where: "device", why: "raw.githubusercontent.com allows every origin. If it fails, the device tries the jsDelivr copy of the same public file. Gated /v1/data stays on the Worker so owner-only fields are stripped." },
      { id: "open-meteo", where: "device", why: "Open-Meteo already runs in the browser from the weather pill. That file is left to the weather work." },
      { id: "sports", where: "unchanged", why: "The sports pills are being reworked separately, so their requests stay where they are." },
      { id: "geo", where: "server", why: "Country and Tor flags come from Cloudflare on the Worker. No keyless browser API replaces the Tor flag." },
      { id: "media-proxy", where: "server", why: "Image CDNs do not allow browser reads. The Worker proxy remains the fallback when a network blocks them." },
      { id: "youtube-media", where: "server", why: "YouTube plays in the official player. Direct files are not read through the Worker, and this entry stays on the server list so the client does not treat YouTube media as a public device read." },
      { id: "telegram", where: "server", why: "Telegram file reads use the bot token, which stays on the Worker." },
      { id: "owner-and-session", where: "server", why: "Sign-in, owner keys, and account routes are never fetched as public reads." }
    ];
  }

  return {
    allows: allows,
    candidate: allows,
    readOnlyHost: readOnlyHost,
    paceWait: paceWait,
    markPace: markPace,
    safeHeaders: safeHeaders,
    shouldFallback: shouldFallback,
    githubMirror: githubMirror,
    fetch: fetchPublic,
    fetchSource: fetchSource,
    json: json,
    bskyProfileUrl: bskyProfileUrl,
    bskyFeedUrl: bskyFeedUrl,
    mastodonLookup: mastodonLookup,
    mastodonStatuses: mastodonStatuses,
    splitMastodon: splitMastodon,
    splitBsky: splitBsky,
    noteServer: noteServer,
    counts: countsNow,
    setFetch: setFetch,
    holdDevice: holdDevice,
    reset: reset,
    audit: audit,
    cacheGet: cacheGet,
    cacheSet: cacheSet
  };
});
