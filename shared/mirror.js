/* Origins for the GitHub Pages site and the Cloudflare Pages mirror.
   The service worker and the page both load this file. A classic script
   assigns ViktorychMirror; Node can require() the same file. */
(function (root) {
  var PAGES_HOST = "viktorychapp.pages.dev";
  var PAGES = "https://" + PAGES_HOST + "/";
  var GITHUB = "https://viktorychgroup.github.io/ViktorychApp/";

  function normalizeBase(value) {
    var text = String(value || "").trim();
    if (!text || text.indexOf("__") >= 0) return "";
    if (!/^https:\/\//i.test(text)) return "";
    try {
      var parsed = new URL(text);
      if (parsed.protocol !== "https:") return "";
    } catch (err) {
      return "";
    }
    if (text.slice(-1) !== "/") text += "/";
    return text;
  }

  function mirrorHost(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
    var suffix = ".github.io";
    if (host.length > suffix.length && host.slice(-suffix.length) === suffix) {
      var owner = host.slice(0, -suffix.length);
      if (owner && owner.indexOf(".") === -1) return true;
    }
    if (host === PAGES_HOST) return true;
    var mark = "." + PAGES_HOST;
    return host.length > mark.length && host.slice(-mark.length) === mark;
  }

  function appBaseFrom(href) {
    var cut = String(href || "").split("#")[0].split("?")[0];
    var i = cut.lastIndexOf("/");
    if (i < 0) return "";
    return cut.slice(0, i + 1);
  }

  function appRoot(origin, pathname, hostname) {
    var path = String(pathname || "/");
    if (/\/index\.html$/i.test(path)) path = path.slice(0, -"index.html".length);
    path = path.replace(/\/(?:s|u)\/[^/]+$/, "/");
    var host = String(hostname || "").toLowerCase();
    var suffix = ".github.io";
    if (host.length > suffix.length && host.slice(-suffix.length) === suffix) {
      var parts = path.split("/").filter(Boolean);
      if (parts[0] && parts[0] !== "s" && parts[0] !== "u") return String(origin || "") + "/" + parts[0] + "/";
    }
    return String(origin || "") + "/";
  }

  function bases(here, github, pages) {
    var out = [];
    [here, github, pages, GITHUB, PAGES].forEach(function (item) {
      var base = normalizeBase(item);
      if (base && out.indexOf(base) < 0) out.push(base);
    });
    return out;
  }

  function relativeTo(base, absolute) {
    var href = String(absolute || "").split("#")[0];
    var rootBase = normalizeBase(base);
    if (!rootBase || href.indexOf(rootBase) !== 0) return "";
    var rel = href.slice(rootBase.length);
    if (!rel || rel.indexOf("..") >= 0 || rel.indexOf("\\") >= 0 || rel.indexOf("://") >= 0) return "";
    if (rel.charAt(0) === "/") return "";
    return rel;
  }

  function rewrite(base, relative) {
    var rootBase = normalizeBase(base);
    var rel = String(relative || "");
    if (!rootBase || !rel || rel.indexOf("..") >= 0 || rel.charAt(0) === "/") return "";
    return rootBase + rel;
  }

  function failoverStatus(status) {
    var code = Number(status);
    if (!code) return true;
    if (code === 404 || code === 429) return true;
    return code >= 500;
  }

  var api = {
    PAGES_HOST: PAGES_HOST,
    PAGES: PAGES,
    GITHUB: GITHUB,
    normalizeBase: normalizeBase,
    mirrorHost: mirrorHost,
    appBaseFrom: appBaseFrom,
    appRoot: appRoot,
    bases: bases,
    relativeTo: relativeTo,
    rewrite: rewrite,
    failoverStatus: failoverStatus
  };
  var host = root;
  if (!host && typeof globalThis !== "undefined") host = globalThis;
  if (host) host.ViktorychMirror = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
