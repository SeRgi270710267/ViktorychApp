/* In-place translation for posts, replies, and bios.
   Order: Chrome Translator, Lingva instances, MyMemory, then other public
   translation endpoints that send their own CORS header. A Google Translate
   link is only shown when every in-place engine fails. No API keys. */
(function (root) {
  const CACHE_KEY = "rss-feeds-translate-v1";
  const HEALTH_KEY = "rss-feeds-translate-health-v1";
  const SICK_MS = 10 * 60 * 1000;
  const LANGS = [
    ["en", "English"],
    ["es", "Spanish"],
    ["pt", "Portuguese"],
    ["fr", "French"],
    ["de", "German"],
    ["it", "Italian"],
    ["nl", "Dutch"],
    ["pl", "Polish"],
    ["sv", "Swedish"],
    ["tr", "Turkish"],
    ["ru", "Russian"],
    ["uk", "Ukrainian"],
    ["ar", "Arabic"],
    ["hi", "Hindi"],
    ["id", "Indonesian"],
    ["vi", "Vietnamese"],
    ["th", "Thai"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["zh", "Chinese"]
  ];
  const LANG_SET = {};
  LANGS.forEach((row) => { LANG_SET[row[0]] = row[1]; });
  const STOP = {
    en: [" the ", " and ", " you ", " that ", " for ", " with ", " this ", " have ", " from "],
    es: [" que ", " los ", " las ", " del ", " por ", " con ", " una ", " para ", " como "],
    fr: [" les ", " des ", " une ", " que ", " pour ", " dans ", " avec ", " pas ", " plus "],
    de: [" und ", " die ", " der ", " das ", " nicht ", " ein ", " mit ", " den ", " ist "],
    pt: [" que ", " não ", " uma ", " para ", " com ", " como ", " mais ", " dos ", " por "],
    it: [" che ", " non ", " per ", " una ", " con ", " come ", " del ", " della ", " sono "],
    nl: [" het ", " een ", " van ", " niet ", " dat ", " met ", " voor ", " zijn ", " ook "]
  };
  const NONLATIN = { ru: "cyr", uk: "cyr", ar: "arab", hi: "deva", ja: "ja", ko: "ko", zh: "cjk", th: "th", he: "he", el: "el" };
  /* Public Lingva instances from the project's instance list. Dead ones are skipped after a failed translation. */
  const LINGVA = [
    "https://lingva.ml",
    "https://translate.plausibility.cloud",
    "https://lingva.lunar.icu",
    "https://lingva.garudalinux.org",
    "https://translate.projectsegfau.lt",
    "https://translate.jae.fi"
  ];
  const KEEP = /(https?:\/\/[^\s<]+|www\.[^\s<]+|@[A-Za-z0-9_]{1,30}|#[\p{L}\p{N}_]{1,60}|\$[A-Za-z]{1,10})/gu;

  const pending = new Set();
  let bound = null;
  let lingvaCursor = 0;
  let names = null;

  function normalize(code) {
    const key = String(code || "").toLowerCase().split("-")[0];
    return LANG_SET[key] ? key : "en";
  }

  function targetLang() {
    const settings = bound && bound.state && bound.state.settings;
    return normalize(settings && settings.translateTo);
  }

  function languageName(code) {
    const key = String(code || "").toLowerCase().split("-")[0];
    if (!key) return "";
    try {
      if (!names) names = new Intl.DisplayNames(["en"], { type: "language" });
      const label = names.of(key);
      if (label && label.toLowerCase() !== key) return label.charAt(0).toUpperCase() + label.slice(1);
    } catch (err) { /* Intl can be missing the language */ }
    return LANG_SET[key] || key.toUpperCase();
  }

  function esc(value) {
    if (bound && bound.esc) return bound.esc(value);
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function state() {
    return (bound && bound.state) || {};
  }

  function hash(text) {
    let h = 5381;
    const sample = String(text || "");
    for (let i = 0; i < sample.length; i++) h = ((h << 5) + h) ^ sample.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function cacheId(key, text) {
    return targetLang() + ":" + key + ":" + hash(text);
  }

  function readStore(name) {
    try { return JSON.parse(sessionStorage.getItem(name) || "{}") || {}; }
    catch (err) { return {}; }
  }

  function writeStore(name, value) {
    try { sessionStorage.setItem(name, JSON.stringify(value)); }
    catch (err) { /* a full session store must not block the translation */ }
  }

  function cacheGet(key, text) {
    const box = readStore(CACHE_KEY);
    const row = (box.entries || {})[cacheId(key, text)];
    if (!row || row.text == null) return null;
    return row;
  }

  function cachePut(key, text, row) {
    const box = readStore(CACHE_KEY);
    const entries = box.entries || {};
    entries[cacheId(key, text)] = row;
    const ids = Object.keys(entries);
    if (ids.length > 60) {
      ids.sort((a, b) => (entries[a].at || 0) - (entries[b].at || 0));
      ids.slice(0, ids.length - 60).forEach((id) => { delete entries[id]; });
    }
    writeStore(CACHE_KEY, { entries: entries });
  }

  function sick(id) {
    const at = Number((readStore(HEALTH_KEY) || {})[id] || 0);
    return at > 0 && Date.now() - at < SICK_MS;
  }

  function markSick(id) {
    const map = readStore(HEALTH_KEY);
    map[id] = Date.now();
    writeStore(HEALTH_KEY, map);
  }

  function markWell(id) {
    const map = readStore(HEALTH_KEY);
    if (!map[id]) return;
    delete map[id];
    writeStore(HEALTH_KEY, map);
  }

  function countScript(text, re) {
    return (String(text || "").match(re) || []).length;
  }

  function latinGuess(text) {
    const blob = " " + String(text || "").toLowerCase().replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/g, " ") + " ";
    let best = "";
    let bestScore = 1;
    Object.keys(STOP).forEach((code) => {
      let score = 0;
      STOP[code].forEach((word) => { if (blob.indexOf(word) >= 0) score += 1; });
      if (score > bestScore) { best = code; bestScore = score; }
    });
    return best;
  }

  function guess(text) {
    const scores = {
      cyr: countScript(text, /[\u0400-\u04FF]/g),
      arab: countScript(text, /[\u0600-\u06FF]/g),
      he: countScript(text, /[\u0590-\u05FF]/g),
      deva: countScript(text, /[\u0900-\u097F]/g),
      kana: countScript(text, /[\u3040-\u30FF]/g),
      hang: countScript(text, /[\uAC00-\uD7AF]/g),
      cjk: countScript(text, /[\u3400-\u9FFF]/g),
      th: countScript(text, /[\u0E00-\u0E7F]/g),
      el: countScript(text, /[\u0370-\u03FF]/g),
      lat: countScript(text, /[A-Za-z]/g)
    };
    let script = "";
    let best = 7;
    Object.keys(scores).forEach((name) => {
      if (name !== "lat" && scores[name] > best) { best = scores[name]; script = name; }
    });
    if (script === "cyr") return /[іїєґІЇЄҐ]/.test(text) ? "uk" : "ru";
    if (script === "arab") return "ar";
    if (script === "he") return "he";
    if (script === "deva") return "hi";
    if (script === "kana") return "ja";
    if (script === "hang") return "ko";
    if (script === "cjk") return scores.kana > 0 ? "ja" : "zh";
    if (script === "th") return "th";
    if (script === "el") return "el";
    if (scores.lat >= 8) return latinGuess(text);
    return "";
  }

  function heuristicOffer(text, target) {
    const found = guess(text);
    if (found) return found !== target;
    const letters = countScript(text, /[A-Za-z]/g);
    if (letters >= 8 && (target === "en" || !NONLATIN[target])) return false;
    if (letters >= 8 && NONLATIN[target]) return true;
    return false;
  }

  function sampleOf(key) {
    const box = state();
    return String((box.translateText && box.translateText[key]) || "");
  }

  function offer(key, text) {
    const sample = String(text || "").trim();
    if (sample.length < 8) return false;
    const box = state();
    if (box.translated && box.translated[key] && !(box.originalShown && box.originalShown[key])) return false;
    if (box.translateFallback && box.translateFallback[key]) return false;
    const target = targetLang();
    /* A script guess is authoritative. A missing detector, or one that
       reports the phone's UI language, must not hide Cyrillic (or any
       other non-target script). */
    const guessed = guess(sample);
    if (guessed) return guessed !== target;
    const known = box.lang && box.lang[key];
    if (known && known !== "yes" && known !== "no") return known !== target;
    if (known === "no") return false;
    if (known === "yes") return true;
    return heuristicOffer(sample, target);
  }

  function textFor(key) {
    const box = state();
    if (!box.translated || !box.translated[key]) return null;
    if (box.originalShown && box.originalShown[key]) return null;
    return box.translated[key];
  }

  function prepare(key) {
    const box = state();
    const sample = sampleOf(key);
    if (!sample) return;
    const row = cacheGet(key, sample);
    if (!row) return;
    box.translated = box.translated || {};
    box.originalShown = box.originalShown || {};
    if (row.originalShown) {
      box.originalShown[key] = true;
      delete box.translated[key];
      return;
    }
    box.translated[key] = row.text;
    box.originalShown[key] = false;
    box.translateMeta = box.translateMeta || {};
    box.translateMeta[key] = { source: row.source || "", engine: row.engine || "" };
  }

  function kindLabel(kind) {
    if (kind === "reply") return "Translate reply";
    if (kind === "bio") return "Translate bio";
    return "Translate post";
  }

  function creditInner(key) {
    const box = state();
    const fallback = box.translateFallback && box.translateFallback[key];
    if (fallback) {
      return `<a class="show-more tr-fallback" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(fallback)}">Open in Google Translate</a>`;
    }
    if (!textFor(key)) return "";
    const meta = (box.translateMeta && box.translateMeta[key]) || {};
    const engine = meta.engine || "translation";
    const from = meta.source ? "Translated from " + languageName(meta.source) + " by " + engine : "Translated by " + engine;
    return `<span>${esc(from)}</span> <button class="show-more" type="button" data-act="show-original" data-key="${esc(key)}">Show original</button>`;
  }

  function block(post, key, cls, inner) {
    const kind = post && post.kind === "reply" ? "reply" : post && post.kind === "bio" ? "bio" : "post";
    const sample = String((post && post.text) || sampleOf(key) || "");
    const show = offer(key, sample);
    const credit = creditInner(key);
    const button = `<button class="show-more translate-link" type="button" data-act="translate" data-key="${esc(key)}" data-kind="${kind}"${show ? "" : " hidden"}>${kindLabel(kind)}</button>`;
    const note = `<div class="tr-credit" data-tr-credit="${esc(key)}"${credit ? "" : " hidden"}>${credit}</div>`;
    return `<div class="${cls || "post-text"}" data-tr="${esc(key)}">${inner}</div>${note}${button}`;
  }

  function nodes(attr, key) {
    const out = [];
    if (typeof document === "undefined") return out;
    document.querySelectorAll("[" + attr + "]").forEach((el) => {
      if (el.getAttribute(attr) === key) out.push(el);
    });
    return out;
  }

  function markBusy(key, on) {
    nodes("data-tr", key).forEach((el) => {
      el.classList.toggle("tr-busy", !!on);
      if (on) el.setAttribute("aria-busy", "true");
      else el.removeAttribute("aria-busy");
    });
    if (!on) nodes("data-tr-progress", key).forEach((el) => el.remove());
  }

  function showProgress(key, ratio) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(ratio || 0) * 100)));
    nodes("data-tr", key).forEach((el) => {
      let bar = null;
      nodes("data-tr-progress", key).forEach((node) => {
        if (el.nextElementSibling === node || (el.parentElement && el.parentElement.contains(node))) bar = node;
      });
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "tr-progress";
        bar.setAttribute("data-tr-progress", key);
        bar.innerHTML = "<span></span><em></em>";
        el.insertAdjacentElement("afterend", bar);
      }
      const fill = bar.querySelector("span");
      const label = bar.querySelector("em");
      if (fill) fill.style.width = pct + "%";
      if (label) label.textContent = pct ? "Downloading translation model · " + pct + "%" : "Downloading translation model";
    });
  }

  function patch(key) {
    const box = state();
    const post = {
      text: sampleOf(key),
      links: (box.translateLinks && box.translateLinks[key]) || [],
      platform: (box.translatePlatform && box.translatePlatform[key]) || ""
    };
    const full = !!(box.translateFull && box.translateFull[key]);
    nodes("data-tr", key).forEach((el) => {
      el.classList.remove("tr-busy");
      el.removeAttribute("aria-busy");
      if (bound && bound.textHtml) el.innerHTML = bound.textHtml(post, key, full);
    });
    const credit = creditInner(key);
    nodes("data-tr-credit", key).forEach((el) => {
      el.innerHTML = credit;
      el.hidden = !credit;
    });
    if (typeof document !== "undefined") {
      document.querySelectorAll('[data-act="translate"]').forEach((btn) => {
        if (btn.getAttribute("data-key") !== key) return;
        btn.hidden = !offer(key, sampleOf(key));
      });
    }
    nodes("data-tr-progress", key).forEach((el) => el.remove());
  }

  function paint() {
    pending.forEach((key) => markBusy(key, true));
  }

  function applyResult(key, text, source, engine) {
    const box = state();
    box.translated = box.translated || {};
    box.originalShown = box.originalShown || {};
    box.translateMeta = box.translateMeta || {};
    box.translateFallback = box.translateFallback || {};
    box.translated[key] = text;
    box.originalShown[key] = false;
    box.translateMeta[key] = { source: source || "", engine: engine || "" };
    delete box.translateFallback[key];
    cachePut(key, sampleOf(key), {
      text: text,
      source: source || "",
      engine: engine || "",
      originalShown: false,
      at: Date.now()
    });
  }

  function shield(text) {
    const kept = [];
    const out = String(text || "").replace(KEEP, (token) => {
      const n = kept.length;
      kept.push(token);
      return "[[" + n + "]]";
    });
    return { text: out, kept: kept };
  }

  function placeholdersKept(text, kept) {
    for (let i = 0; i < kept.length; i++) {
      if (!new RegExp("\\[\\[\\s*" + i + "\\s*\\]\\]").test(text)) return false;
    }
    return true;
  }

  function restore(text, kept) {
    return String(text || "").replace(/\[\[\s*(\d+)\s*\]\]/g, (token, n) => {
      const i = Number(n);
      return i >= 0 && i < kept.length ? kept[i] : token;
    });
  }

  function chunks(line) {
    const out = [];
    let rest = String(line || "");
    while (rest.length > 420) {
      let cut = rest.lastIndexOf(" ", 420);
      if (cut < 180) cut = 420;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ /, "");
    }
    out.push(rest);
    return out;
  }

  function decodeEntities(text) {
    return String(text || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");
  }

  async function getJson(url) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const res = await fetch(url, {
        signal: ctrl ? ctrl.signal : undefined,
        credentials: "omit",
        mode: "cors",
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function translateLines(sample, runLine) {
    const lines = String(sample || "").split("\n");
    const out = [];
    let source = "";
    let keptAll = true;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) { out.push(line); continue; }
      const parts = [];
      const blocks = chunks(line);
      for (let j = 0; j < blocks.length; j++) {
        const shielded = shield(blocks[j]);
        if (!shielded.text.replace(/\[\[\d+\]\]/g, "").trim()) { parts.push(blocks[j]); continue; }
        const result = await runLine(shielded.text);
        if (!result || !result.text) throw new Error("empty");
        if (!placeholdersKept(result.text, shielded.kept)) keptAll = false;
        if (result.source && !source) source = result.source;
        parts.push(restore(decodeEntities(result.text), shielded.kept));
      }
      out.push(parts.join(" "));
    }
    return { text: out.join("\n"), source: source, kept: keptAll };
  }

  async function lingvaLine(base, source, target, text) {
    const url = base.replace(/\/$/, "") + "/api/v1/" + encodeURIComponent(source || "auto") + "/" + encodeURIComponent(target) + "/" + encodeURIComponent(text);
    const data = await getJson(url);
    const translated = data && (data.translation || (data.target && data.target.text));
    if (!translated || data.error) throw new Error(data && data.error || "lingva");
    const detected = data.info && (data.info.detectedSource || data.info.source || (data.source && data.source.lang && data.source.lang.code));
    return { text: decodeEntities(translated), source: detected ? String(detected).toLowerCase().slice(0, 2) : "" };
  }

  async function memoryLine(source, target, text) {
    const pair = encodeURIComponent((source || "autodetect") + "|" + target);
    const data = await getJson("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=" + pair);
    const translated = data && data.responseData && data.responseData.translatedText;
    if (!translated || Number(data.responseStatus) >= 400) throw new Error("mymemory");
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(translated)) throw new Error("mymemory");
    return { text: decodeEntities(translated), source: source && source !== "autodetect" ? source : "" };
  }

  async function googleLine(target, text) {
    const data = await getJson("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(text));
    const segs = data && data[0];
    if (!Array.isArray(segs) || !segs.length) throw new Error("google");
    const translated = segs.map((seg) => (seg && seg[0]) || "").join("");
    if (!translated.trim()) throw new Error("google");
    const detected = data[2] ? String(data[2]).toLowerCase().split("-")[0] : "";
    return { text: decodeEntities(translated), source: detected };
  }

  function usable(result, original) {
    if (!result || !result.text) return false;
    const left = result.text.replace(/\s+/g, " ").trim();
    const right = String(original || "").replace(/\s+/g, " ").trim();
    return !!left && left !== right;
  }

  async function runEngine(id, sample, source, target, lineFn) {
    if (sick(id)) throw new Error("sick");
    const result = await translateLines(sample, (line) => lineFn(line));
    if (!usable(result, sample)) throw new Error("same");
    if (!result.kept) throw new Error("tokens");
    if (!result.source) result.source = source || guess(sample) || "";
    if (result.source === target) throw new Error("target");
    markWell(id);
    return result;
  }

  function googleHref(sample, target) {
    return "https://translate.google.com/?sl=auto&tl=" + encodeURIComponent(target) + "&text=" + encodeURIComponent(String(sample || "").slice(0, 1800)) + "&op=translate";
  }

  async function chromeTranslate(sample, target) {
    if (typeof Translator === "undefined") return null;
    let source = "";
    if (typeof LanguageDetector !== "undefined") {
      const detector = await detectorCreate(true);
      if (detector) {
        const found = await detector.detect(sample);
        const top = found && found[0];
        if (top && top.confidence >= 0.5 && top.detectedLanguage) source = String(top.detectedLanguage).toLowerCase().split("-")[0];
      }
    }
    const guessed = guess(sample);
    if (guessed && guessed !== target && (!source || source === target)) source = guessed;
    else if (!source) source = guessed;
    if (!source || source === target) return source === target ? { same: true, source: source } : null;
    if (source.length !== 2) return null;
    let availability = "unavailable";
    try {
      availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
    } catch (err) { return null; }
    const ready = availability === "available" || availability === "readily";
    const needsDownload = availability === "downloadable" || availability === "downloading" || availability === "after-download";
    if (!ready && !needsDownload) return null;
    const createOpts = { sourceLanguage: source, targetLanguage: target };
    if (needsDownload) {
      pending.forEach((key) => showProgress(key, 0));
      createOpts.monitor = downloadMonitor();
    }
    const translator = await Translator.create(createOpts);
    const lined = await translateLines(sample, async (line) => {
      const out = await translator.translate(line);
      return { text: out, source: source };
    });
    if (!usable(lined, sample) || !lined.kept) return null;
    return { text: lined.text, source: source, engine: "Chrome" };
  }

  function downloadMonitor() {
    return (monitor) => {
      if (!monitor || !monitor.addEventListener) return;
      monitor.addEventListener("downloadprogress", (event) => {
        pending.forEach((key) => showProgress(key, event && event.loaded));
      });
    };
  }

  async function detectorCreate(allowDownload) {
    if (typeof LanguageDetector === "undefined") return null;
    let availability = "available";
    try {
      if (LanguageDetector.availability) availability = await LanguageDetector.availability();
    } catch (err) { return null; }
    const ready = availability === "available" || availability === "readily";
    const needsDownload = availability === "downloadable" || availability === "downloading" || availability === "after-download";
    if (!ready && !(allowDownload && needsDownload)) return null;
    const opts = {};
    if (needsDownload) {
      pending.forEach((key) => showProgress(key, 0));
      opts.monitor = downloadMonitor();
    }
    try { return await LanguageDetector.create(opts); }
    catch (err) { return null; }
  }

  function scheduleDetect() {
    if (typeof document === "undefined" || typeof LanguageDetector === "undefined") return;
    const box = state();
    const rows = [];
    document.querySelectorAll("[data-tr]").forEach((node) => {
      if (rows.length >= 40) return;
      const key = node.getAttribute("data-tr");
      if (!key || (box.lang && box.lang[key]) || (box.langWait && box.langWait[key])) return;
      const text = sampleOf(key) || (node.innerText || "").trim();
      if (text.length < 8) return;
      rows.push({ key: key, text: text.slice(0, 2000) });
    });
    if (!rows.length) return;
    box.langWait = box.langWait || {};
    rows.forEach((row) => { box.langWait[row.key] = true; });
    const generation = (box.langGen = (box.langGen || 0) + 1);
    detectRows(rows, generation);
  }

  async function detectRows(rows, generation) {
    const box = state();
    try {
      const detector = await detectorCreate(false);
      if (!detector) {
        rows.forEach((row) => { if (box.langWait) box.langWait[row.key] = false; });
        return;
      }
      let changed = false;
      for (let i = 0; i < rows.length; i++) {
        if (box.langGen !== generation) return;
        const row = rows[i];
        const found = await detector.detect(row.text);
        const top = found && found[0];
        const code = top && top.confidence >= 0.6 && top.detectedLanguage ? String(top.detectedLanguage).toLowerCase().split("-")[0] : "";
        const before = offer(row.key, row.text);
        box.lang = box.lang || {};
        const guessed = guess(row.text);
        if (guessed) box.lang[row.key] = guessed;
        else if (code) box.lang[row.key] = code;
        if (box.langWait) box.langWait[row.key] = false;
        if (offer(row.key, row.text) !== before) changed = true;
      }
      if (changed && box.langGen === generation && bound && bound.render) bound.render();
    } catch (err) {
      rows.forEach((row) => { if (box.langWait) box.langWait[row.key] = false; });
    }
  }

  async function translate(key) {
    const sample = sampleOf(key).trim();
    if (!sample || pending.has(key)) return;
    const target = targetLang();
    const cached = cacheGet(key, sample);
    if (cached && cached.text && !cached.originalShown) {
      applyResult(key, cached.text, cached.source, cached.engine);
      patch(key);
      return;
    }
    pending.add(key);
    const box = state();
    box.translateFallback = box.translateFallback || {};
    delete box.translateFallback[key];
    markBusy(key, true);
    try {
      let chrome = null;
      try { chrome = await chromeTranslate(sample, target); }
      catch (err) { chrome = null; }
      if (chrome && chrome.same) {
        box.lang = box.lang || {};
        box.lang[key] = target;
        delete box.translated[key];
        patch(key);
        return;
      }
      if (chrome && chrome.text) {
        applyResult(key, chrome.text, chrome.source, "Chrome");
        patch(key);
        return;
      }
      const source = (box.lang && box.lang[key] && box.lang[key] !== "yes" && box.lang[key] !== "no") ? box.lang[key] : (guess(sample) || "");
      const hosts = LINGVA.slice(lingvaCursor).concat(LINGVA.slice(0, lingvaCursor));
      for (let i = 0; i < hosts.length; i++) {
        const base = hosts[i];
        try {
          const result = await runEngine("lingva:" + base, sample, source, target, (line) => lingvaLine(base, source || "auto", target, line));
          lingvaCursor = (LINGVA.indexOf(base) + 1) % LINGVA.length;
          applyResult(key, result.text, result.source, "Lingva");
          patch(key);
          return;
        } catch (err) {
          if (String(err && err.message) !== "sick") markSick("lingva:" + base);
        }
      }
      try {
        const result = await runEngine("mymemory", sample, source, target, (line) => memoryLine(source || "autodetect", target, line));
        applyResult(key, result.text, result.source || source, "MyMemory");
        patch(key);
        return;
      } catch (err) {
        if (String(err && err.message) !== "sick") markSick("mymemory");
      }
      try {
        const result = await runEngine("google-public", sample, source, target, (line) => googleLine(target, line));
        applyResult(key, result.text, result.source || source, "Google");
        patch(key);
        return;
      } catch (err) {
        if (String(err && err.message) !== "sick") markSick("google-public");
      }
      box.translateFallback[key] = googleHref(sample, target);
      delete box.translated[key];
      patch(key);
    } finally {
      pending.delete(key);
      markBusy(key, false);
    }
  }

  function showOriginal(key) {
    const box = state();
    box.originalShown = box.originalShown || {};
    box.originalShown[key] = true;
    box.translateFallback = box.translateFallback || {};
    delete box.translateFallback[key];
    const sample = sampleOf(key);
    const row = cacheGet(key, sample);
    if (row) cachePut(key, sample, Object.assign({}, row, { originalShown: true, at: Date.now() }));
    patch(key);
  }

  function setTarget(code) {
    const box = state();
    if (!box.settings) return;
    const next = normalize(code);
    box.settings.translateTo = next;
    box.translated = {};
    box.originalShown = {};
    box.translateMeta = {};
    box.translateFallback = {};
    box.lang = {};
    if (bound && bound.save) bound.save();
    if (bound && bound.render) bound.render();
  }

  function settingsHtml() {
    const current = targetLang();
    const options = LANGS.map((row) => `<option value="${esc(row[0])}"${row[0] === current ? " selected" : ""}>${esc(row[1])}</option>`).join("");
    return `<h2>Translation</h2><div class="tr-settings"><p class="phandle">Translate to</p><label class="vh" for="translate-to">Translate to</label><select id="translate-to" class="tr-select">${options}</select></div>`;
  }

  function bind(hooks) {
    bound = hooks || null;
    if (bound && bound.state && bound.state.settings && !bound.state.settings.translateTo) bound.state.settings.translateTo = "en";
  }

  root.FeedsTranslate = {
    bind: bind,
    normalize: normalize,
    offer: offer,
    textFor: textFor,
    prepare: prepare,
    block: block,
    translate: translate,
    showOriginal: showOriginal,
    setTarget: setTarget,
    settingsHtml: settingsHtml,
    scheduleDetect: scheduleDetect,
    paint: paint,
    _shield: shield,
    _restore: restore,
    _guess: guess,
    _offerText: heuristicOffer
  };
})(typeof window !== "undefined" ? window : globalThis);
