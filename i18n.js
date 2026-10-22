/* Interface language. English, Russian, and Spanish packs register with addPack. */
(function (root) {
  var KEY = "superintelapp-lang";
  var PACKS = {};
  var lang = "en";
  var listeners = [];
  var manifestBase = null;
  var manifestUrl = "";

  function valid(code) {
    code = String(code || "").toLowerCase().split("-")[0];
    return code === "en" || code === "ru" || code === "es" ? code : "";
  }

  function readSaved() {
    try {
      if (typeof localStorage === "undefined") return "en";
      var saved = localStorage.getItem(KEY);
      if (valid(saved)) return valid(saved);
      if (saved != null) return "en";
      var list = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
      var picked = "en";
      var i;
      for (i = 0; i < list.length; i++) {
        var code = valid(list[i]);
        if (code === "ru" || code === "es") { picked = code; break; }
      }
      try { localStorage.setItem(KEY, picked); } catch (err) { /* private mode */ }
      return picked;
    } catch (err) {
      return "en";
    }
  }

  lang = readSaved();

  function locale() {
    return lang === "ru" || lang === "es" ? lang : "en";
  }

  function addPack(code, pack) {
    var key = valid(code);
    if (!key || !pack) return;
    PACKS[key] = pack;
  }

  function lookup(key) {
    var pack = PACKS[lang] || {};
    var en = PACKS.en || {};
    if (Object.prototype.hasOwnProperty.call(pack, key)) return pack[key];
    if (Object.prototype.hasOwnProperty.call(en, key)) return en[key];
    return key;
  }

  function fill(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, function (_, name) {
      return vars[name] == null ? "" : String(vars[name]);
    });
  }

  function t(key, vars) {
    return fill(lookup(key), vars);
  }

  // Full product: brand.name + brand.app (ViktorychApp) or brand.music
  // (ViktorychMusic). Tight labels use brand.short: pwa (ViktrychApp) and
  // musicShort (ViktrychMusic). A rebrand edits those four pack values.
  // No separator, so a space or a translated suffix belongs in the pack value.
  function productName(kind) {
    var tight = kind === "pwa" || kind === "musicShort";
    var stem = tight ? t("brand.short") : t("brand.name");
    var suffix = (kind === "music" || kind === "musicShort") ? t("brand.music") : t("brand.app");
    return stem + suffix;
  }

  function formatInt(n) {
    var value = Math.trunc(Number(n) || 0);
    try { return new Intl.NumberFormat(locale()).format(value); }
    catch (err) { return String(value); }
  }

  function tn(key, n, vars) {
    var value = Number(n);
    if (!isFinite(value)) value = 0;
    var cat = "other";
    try { cat = new Intl.PluralRules(locale()).select(value); } catch (err) { /* one form */ }
    var chosen = key + "." + cat;
    if (lookup(chosen) === chosen && cat !== "other") chosen = key + ".other";
    var data = { n: formatInt(value) };
    if (vars) {
      for (var name in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, name)) data[name] = vars[name];
      }
    }
    return t(chosen, data);
  }

  function formatCount(n) {
    n = Number(n);
    if (!isFinite(n)) return "";
    var abs = Math.abs(n);
    var loc = locale();
    if (abs < 10000) {
      try { return new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(Math.trunc(n)); }
      catch (err) { return String(Math.trunc(n)); }
    }
    var div = abs < 1e6 ? 1e3 : abs < 1e9 ? 1e6 : 1e9;
    var suffix = abs < 1e6 ? t("num.k") : abs < 1e9 ? t("num.m") : t("num.b");
    var scaled = Math.round((n / div) * 10) / 10;
    var digits = Math.abs(scaled) % 1 ? 1 : 0;
    var formatted;
    try {
      formatted = new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: 1 }).format(scaled);
    } catch (err) {
      formatted = digits ? scaled.toFixed(1) : String(Math.round(scaled));
    }
    return formatted + suffix;
  }

  function relTime(iso) {
    var then = new Date(iso).getTime();
    if (!then) return "";
    var sec = Math.max(0, (Date.now() - then) / 1000);
    var loc = locale();
    var num = function (value) {
      try { return new Intl.NumberFormat(loc).format(value); }
      catch (err) { return String(value); }
    };
    if (sec < 60) return num(Math.max(1, Math.floor(sec))) + t("time.s");
    if (sec < 3600) return num(Math.floor(sec / 60)) + t("time.m");
    if (sec < 86400) return num(Math.floor(sec / 3600)) + t("time.h");
    var d = new Date(iso);
    var opts = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    try { return new Intl.DateTimeFormat(loc, opts).format(d); }
    catch (err) { return ""; }
  }

  function fullTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var loc = locale();
    try {
      var clock = new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" }).format(d);
      var date = new Intl.DateTimeFormat(loc, { month: "short", day: "numeric", year: "numeric" }).format(d);
      return clock + " · " + date;
    } catch (err) {
      return "";
    }
  }

  function joined(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var formatted;
    try { formatted = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(d); }
    catch (err) { return ""; }
    return t("Joined {date}", { date: formatted });
  }

  function storyAge(iso) {
    var then = new Date(iso).getTime();
    if (!then) return "";
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    var loc = locale();
    var num = function (value) {
      try { return new Intl.NumberFormat(loc).format(value); }
      catch (err) { return String(value); }
    };
    if (seconds < 45) return t("now");
    if (seconds < 3600) return num(Math.max(1, Math.round(seconds / 60))) + t("time.m");
    if (seconds < 86400) return num(Math.max(1, Math.round(seconds / 3600))) + t("time.h");
    return t("24h");
  }

  function endonym(code) {
    if (code === "ru") return "Русский";
    if (code === "es") return "Español";
    return "English";
  }

  function applyChrome() {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale();
    var nodes = document.querySelectorAll("[data-i18n]");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      if (key) nodes[i].textContent = t(key);
    }
    var aria = document.querySelectorAll("[data-i18n-aria]");
    for (i = 0; i < aria.length; i++) {
      var label = aria[i].getAttribute("data-i18n-aria");
      if (label) aria[i].setAttribute("aria-label", t(label));
    }
    var title = document.querySelector("title");
    if (title && title.getAttribute("data-i18n")) title.textContent = t(title.getAttribute("data-i18n"));
  }

  function brandManifest(data) {
    var next = JSON.parse(JSON.stringify(data || {}));
    next.lang = locale();
    next.name = productName("app");
    next.short_name = productName("pwa");
    if (next.description) next.description = t("manifest.description");
    var shortcuts = next.shortcuts || [];
    var s;
    for (s = 0; s < shortcuts.length; s++) {
      var url = String(shortcuts[s].url || "");
      if (url.indexOf("#/music") >= 0) {
        shortcuts[s].name = productName("music");
        shortcuts[s].short_name = productName("musicShort");
        continue;
      }
      var translated = t("manifest." + shortcuts[s].name);
      if (translated && translated !== "manifest." + shortcuts[s].name) {
        shortcuts[s].name = translated;
        shortcuts[s].short_name = translated;
      }
    }
    var shots = next.screenshots || [];
    for (s = 0; s < shots.length; s++) {
      if (shots[s].label) shots[s].label = t("Home timeline");
    }
    return next;
  }

  function paintBrand() {
    if (typeof document === "undefined") return;
    var app = productName("app");
    var pwa = productName("pwa");
    document.documentElement.lang = locale();
    var metas = [
      ["meta[name='application-name']", pwa],
      ["meta[name='apple-mobile-web-app-title']", pwa],
      ["meta[property='og:site_name']", app],
      ["meta[property='og:title']", app],
      ["meta[property='og:image:alt']", app],
      ["meta[name='twitter:title']", app]
    ];
    var i;
    for (i = 0; i < metas.length; i++) {
      var node = document.querySelector(metas[i][0]);
      if (node) node.setAttribute("content", metas[i][1]);
    }
  }

  function updateManifest() {
    if (typeof document === "undefined" || typeof fetch === "undefined") return;
    var link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    var apply = function (data) {
      var next = brandManifest(data);
      paintBrand();
      var blob = new Blob([JSON.stringify(next)], { type: "application/manifest+json" });
      var url = URL.createObjectURL(blob);
      var prev = link.getAttribute("href") || "";
      link.setAttribute("href", url);
      if (prev.indexOf("blob:") === 0) URL.revokeObjectURL(prev);
    };
    if (manifestBase) { apply(manifestBase); return; }
    var href = manifestUrl || link.getAttribute("href") || "manifest.webmanifest";
    if (href.indexOf("blob:") === 0) return;
    manifestUrl = href;
    fetch(href).then(function (res) { return res.json(); }).then(function (data) {
      manifestBase = data;
      apply(data);
    }).catch(function () { /* the static manifest stays in English until the next try */ });
  }

  function setLang(code) {
    var next = valid(code) || "en";
    lang = next;
    try { localStorage.setItem(KEY, next); } catch (err) { /* private mode */ }
    applyChrome();
    paintBrand();
    updateManifest();
    var i;
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i](next); } catch (err) { /* a listener must not block the switch */ }
    }
  }

  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function getLang() { return lang; }

  root.SI18n = {
    addPack: addPack,
    t: t,
    tn: tn,
    setLang: setLang,
    getLang: getLang,
    locale: locale,
    endonym: endonym,
    formatCount: formatCount,
    formatInt: formatInt,
    relTime: relTime,
    fullTime: fullTime,
    joined: joined,
    storyAge: storyAge,
    productName: productName,
    brandManifest: brandManifest,
    onChange: onChange,
    applyChrome: applyChrome,
    updateManifest: updateManifest
  };
  root.t = t;
  root.tn = tn;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        applyChrome();
        paintBrand();
        updateManifest();
      });
    } else {
      applyChrome();
      paintBrand();
      updateManifest();
    }
  }
})(typeof self !== "undefined" ? self : this);
