/* On-device AI. Chrome and Edge built-in APIs go first. Small bundled
   models cover language detection, spam, extractive summaries, grammar,
   and saved-post search with no download. Optional downloads stay off
   until a switch is on, and they wait for Wi-Fi, battery, and data saver.
   Direct messages never go to a server unless that switch is on.
   No paid API is called from here. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychOnDeviceAi = api;
})(typeof self !== "undefined" ? self : this, function () {
  var MB = 1024 * 1024;
  var TRANSFORMERS_SPEC = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
  var CACHE_NAME = "viktorych-ai-models";
  var OPFS_DIR = "vapp-ai";
  var LOADED = [];
  var stash = {};
  var stashOrder = [];
  var revealed = {};
  var translated = {};
  var pendingAuto = {};
  var workerPromise = null;
  var workerSeq = 0;
  var memoryCache = {};
  var pipes = {};
  var rankCache = {};

  /* Sizes are the published quantized files, not estimates we hope for.
     Translation: Xenova/opus-mt q8 encoder 52.9 MB + merged decoder 60.2 MB.
     Search: Xenova/all-MiniLM-L6-v2 onnx/model_quantized.onnx is 23 MB.
     Large chat model: WebLLM lists Llama-3.2-1B-Instruct-q4f32_1-MLC at 1128.82 MB. */
  var CATALOG = {
    detect: { id: "bundled-ngram", bytes: 0, license: "Apache-2.0", download: false, task: "language-detection" },
    spam: { id: "bundled-linear", bytes: 0, license: "Apache-2.0", download: false, task: "spam" },
    summarize: { id: "bundled-extractive", bytes: 0, license: "Apache-2.0", download: false, task: "summarize" },
    compose: { id: "bundled-rewrite", bytes: 0, license: "Apache-2.0", download: false, task: "rewrite" },
    translateLocal: {
      id: "Xenova/opus-mt",
      bytes: Math.round(52.9 * MB) + Math.round(60.2 * MB),
      license: "CC-BY-4.0",
      download: true,
      task: "translation",
      credit: "OPUS-MT models by the Helsinki-NLP group, CC-BY-4.0."
    },
    semantic: { id: "bundled-hash", bytes: 0, license: "Apache-2.0", download: false, task: "embeddings" },
    semanticLocal: {
      id: "Xenova/all-MiniLM-L6-v2",
      bytes: 23 * MB,
      license: "Apache-2.0",
      download: true,
      task: "feature-extraction",
      dtype: "q8"
    },
    webllm: {
      id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
      bytes: Math.round(1128.82 * MB),
      license: "Llama-3.2",
      download: true,
      task: "text-generation",
      credit: "Built with Llama. Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved."
    }
  };

  var PAIRS = {
    "en-es": 1, "es-en": 1, "en-fr": 1, "fr-en": 1, "en-de": 1, "de-en": 1,
    "en-ru": 1, "ru-en": 1, "en-pt": 1, "pt-en": 1, "en-it": 1, "it-en": 1,
    "en-nl": 1, "nl-en": 1, "en-zh": 1, "zh-en": 1
  };

  var STOP = {
    en: ["the", "and", "you", "that", "for", "with", "this", "have", "from", "was", "are"],
    es: ["que", "los", "las", "del", "por", "con", "una", "para", "como", "esta", "hola"],
    fr: ["les", "des", "une", "que", "pour", "dans", "avec", "pas", "plus", "est", "bonjour"],
    de: ["und", "die", "der", "das", "nicht", "ein", "mit", "den", "ist", "auch"],
    pt: ["que", "nao", "uma", "para", "com", "como", "mais", "dos", "por", "esta"],
    it: ["che", "non", "per", "una", "con", "come", "del", "della", "sono"],
    nl: ["het", "een", "van", "niet", "dat", "met", "voor", "zijn", "ook"],
    ru: ["и", "в", "не", "на", "что", "это", "как", "по", "для"],
    uk: ["і", "в", "не", "на", "що", "це", "як", "для", "та"]
  };

  var SPAM = ["click here", "free prize", "you won", "congratulations", "airdrop", "seed phrase", "verify your account", "limited time", "act now", "buy now", "whatsapp", "dm me", "onlyfans", "make money", "work from home", "giveaway", "claim your", "crypto"];

  var TYPOS = { teh: "the", recieve: "receive", seperate: "separate", definately: "definitely", occured: "occurred", alot: "a lot", wierd: "weird", untill: "until" };

  var SYN = { parcel: "package", package: "package", arrived: "arrive", arrival: "arrive", arrives: "arrive", gate: "gate", door: "door", yesterday: "yesterday", concert: "concert", ticket: "ticket", music: "music" };

  function deviceApi() {
    if (typeof self !== "undefined" && self.ViktorychDevice) return self.ViktorychDevice;
    if (typeof window !== "undefined" && window.ViktorychDevice) return window.ViktorychDevice;
    if (typeof require === "function") {
      try { return require("./device.js"); } catch (err) { return null; }
    }
    return null;
  }

  function tr(key) {
    var fn = null;
    if (typeof self !== "undefined" && self.t) fn = self.t;
    if (!fn && typeof window !== "undefined" && window.t) fn = window.t;
    return fn ? fn(key) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }

  function hash(text) {
    var h = 5381;
    var sample = String(text || "");
    for (var i = 0; i < sample.length; i++) h = ((h << 5) + h) ^ sample.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function remember(text) {
    var id = hash(text);
    stash[id] = String(text || "").slice(0, 8000);
    stashOrder.push(id);
    if (stashOrder.length > 200) delete stash[stashOrder.shift()];
    return id;
  }

  function settingsOf(opts) {
    var device = (opts && opts.device) || deviceApi();
    var settings = (opts && opts.settings) || (device && device.read ? device.read() : null);
    if (device && device.normalize) return device.normalize(settings);
    return settings || {};
  }

  function signalsOf(opts) {
    var device = (opts && opts.device) || deviceApi();
    if (opts && opts.signals) return opts.signals;
    if (device && device.signals) return device.signals();
    return {};
  }

  function aiOn(opts, id) {
    var device = (opts && opts.device) || deviceApi();
    if (device && device.aiFeatureOn) return device.aiFeatureOn(opts && opts.settings, id, signalsOf(opts));
    var settings = settingsOf(opts);
    var row = settings.aiFeatures || {};
    return !!row[id];
  }

  function masterOn(opts, feature) {
    var device = (opts && opts.device) || deviceApi();
    if (!device || !device.featureOn) return true;
    return device.featureOn(opts && opts.settings, feature, signalsOf(opts));
  }

  function downloadAllowed(opts) {
    var row = signalsOf(opts);
    if (row.saveData) return false;
    if (row.onWifi === false || row.metered === true) return false;
    if (row.battery != null && row.battery < 0.2 && row.charging !== true) return false;
    return true;
  }

  function dmLeaves(opts) {
    var settings = settingsOf(opts);
    return !!(settings.aiFeatures && settings.aiFeatures.dmServer);
  }

  function serverAllowed(opts) {
    var scope = (opts && opts.scope) || "post";
    if (scope === "dm" || scope === "chat") return dmLeaves(opts);
    return opts && opts.server !== false;
  }

  function scope() {
    if (typeof globalThis !== "undefined") return globalThis;
    return typeof self !== "undefined" ? self : {};
  }

  function chromeApis() {
    var g = scope();
    return {
      translator: typeof g.Translator === "function",
      detector: typeof g.LanguageDetector === "function",
      summarizer: typeof g.Summarizer === "function",
      writer: typeof g.Writer === "function",
      rewriter: typeof g.Rewriter === "function",
      prompt: typeof g.LanguageModel === "function"
    };
  }

  function loadedModels() {
    return LOADED.slice();
  }

  function heap() {
    try {
      if (typeof performance !== "undefined" && performance.memory && performance.memory.usedJSHeapSize) return performance.memory.usedJSHeapSize;
    } catch (err) { /* some browsers hide the heap */ }
    try {
      if (typeof process !== "undefined" && process.memoryUsage) return process.memoryUsage().heapUsed;
    } catch (err) { /* not node */ }
    return 0;
  }

  function now() {
    if (typeof performance !== "undefined" && performance.now) return performance.now();
    return Date.now();
  }

  function measure(label, fn) {
    var before = heap();
    var started = now();
    return Promise.resolve().then(fn).then(function (value) {
      var used = heap();
      return {
        label: label,
        value: value,
        loadMs: Math.max(0, now() - started),
        memoryBytes: used ? Math.max(0, used - before) : 0
      };
    });
  }

  function words(text) {
    return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
  }

  function scriptOf(text) {
    var sample = String(text || "");
    if ((sample.match(/[\u0400-\u04FF]/g) || []).length > 6) return /[іїєґІЇЄҐ]/.test(sample) ? "uk" : "ru";
    if ((sample.match(/[\u0600-\u06FF]/g) || []).length > 6) return "ar";
    if ((sample.match(/[\u0590-\u05FF]/g) || []).length > 6) return "he";
    if ((sample.match(/[\u0900-\u097F]/g) || []).length > 6) return "hi";
    if ((sample.match(/[\u3040-\u30FF]/g) || []).length > 2) return "ja";
    if ((sample.match(/[\uAC00-\uD7AF]/g) || []).length > 2) return "ko";
    if ((sample.match(/[\u3400-\u9FFF]/g) || []).length > 2) return "zh";
    if ((sample.match(/[\u0E00-\u0E7F]/g) || []).length > 4) return "th";
    return "";
  }

  function detectSync(text) {
    var script = scriptOf(text);
    if (script) return { code: script, confidence: 0.92, via: "script" };
    var list = words(text);
    if (list.length < 3) return { code: "", confidence: 0, via: "short" };
    var best = "";
    var score = 0;
    Object.keys(STOP).forEach(function (code) {
      var n = 0;
      list.forEach(function (word) { if (STOP[code].indexOf(word) >= 0) n += 1; });
      if (n > score) { score = n; best = code; }
    });
    if (!best || score < 1) return { code: "", confidence: 0, via: "none" };
    return { code: best, confidence: Math.min(0.95, 0.45 + score * 0.12), via: "ngram" };
  }

  function detect(text, opts) {
    opts = opts || {};
    if (!aiOn(opts, "detect") && opts.force !== true) return Promise.resolve(detectSync(text));
    var g = scope();
    var env = opts.env || {};
    if (!masterOn(opts, "translate") && opts.force !== true) return Promise.resolve(detectSync(text));
    var chrome = env.detector || (typeof g.LanguageDetector === "function" ? g.LanguageDetector : null);
    if (!chrome || !chrome.create) return Promise.resolve(detectSync(text));
    return Promise.resolve().then(function () { return chrome.create(); }).then(function (detector) {
      return detector.detect(String(text || ""));
    }).then(function (found) {
      var top = found && found[0];
      if (top && top.detectedLanguage && top.confidence >= 0.5) {
        return { code: String(top.detectedLanguage).toLowerCase().split("-")[0], confidence: top.confidence, via: "chrome" };
      }
      return detectSync(text);
    }).catch(function () { return detectSync(text); });
  }

  function spamScore(text) {
    var raw = String(text || "");
    var folded = raw.toLowerCase();
    var score = 0;
    SPAM.forEach(function (phrase) { if (folded.indexOf(phrase) >= 0) score += 0.36; });
    var links = (folded.match(/https?:\/\//g) || []).length;
    var bare = folded.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, "");
    if (links >= 2) score += 0.4;
    if (links === 1 && bare.length < 12) score += 0.5;
    if (/(.)\1{7,}/.test(folded)) score += 0.3;
    var caps = (raw.match(/[A-Z]/g) || []).length;
    var lows = (raw.match(/[a-z]/g) || []).length;
    if (caps > 18 && caps > lows * 3) score += 0.25;
    return Math.min(1, score);
  }

  function likelySpam(text, scopeName, opts) {
    opts = opts || {};
    if (opts.force !== true && !aiOn(opts, "spam")) return false;
    return spamScore(text) >= 0.45;
  }

  function hiddenSpam(text, scopeName) {
    var id = hash(text);
    if (revealed[id]) return false;
    return likelySpam(text, scopeName, { force: false });
  }

  function sentences(text) {
    var parts = String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
    return parts.map(function (part) { return part.trim(); }).filter(function (part) { return part.length > 1; });
  }

  function summarizeExtract(text, limit) {
    var rows = sentences(text);
    if (!rows.length) return "";
    if (rows.length === 1) return rows[0];
    var freq = {};
    words(text).forEach(function (word) {
      if (word.length < 3) return;
      freq[word] = (freq[word] || 0) + 1;
    });
    var ranked = rows.map(function (row, index) {
      var score = 0;
      words(row).forEach(function (word) { score += freq[word] || 0; });
      return { row: row, score: score, index: index };
    }).sort(function (a, b) { return b.score - a.score || a.index - b.index; });
    var keep = Math.max(1, Math.min(limit || 3, ranked.length));
    return ranked.slice(0, keep).sort(function (a, b) { return a.index - b.index; }).map(function (item) { return item.row; }).join(" ");
  }

  function joinPieces(pieces) {
    return (pieces || []).map(function (piece) { return String(piece || "").trim(); }).filter(Boolean).join("\n");
  }

  function rememberSource(device, source, ok, now) {
    if (!device) return;
    if (ok && device.rememberOk) device.rememberOk(source, now);
    if (!ok && device.rememberFail) device.rememberFail("ai", source, now, "source");
  }

  function cooling(device, source, now) {
    if (!device || !device.sourceState) return false;
    return device.sourceState(source, now) === "fail";
  }

  function chromeSummarize(text, env) {
    var g = scope();
    var api = env && env.summarizer ? env.summarizer : (typeof g.Summarizer === "function" ? g.Summarizer : null);
    if (!api || !api.create) return Promise.reject(new Error("unsupported"));
    return Promise.resolve().then(function () { return api.create({ type: "tldr", format: "plain-text", length: "short" }); }).then(function (session) {
      return session.summarize(String(text || ""));
    });
  }

  function summarize(text, opts) {
    opts = opts || {};
    var sample = Array.isArray(text) ? joinPieces(text) : String(text || "");
    var scopeName = opts.scope || "post";
    if (!aiOn(opts, "summarize") || !masterOn(opts, "ai")) {
      return Promise.resolve({ via: "off", text: "", error: false });
    }
    var device = opts.device || deviceApi();
    var local = summarizeExtract(sample, opts.limit || 3);
    function finish(via, value) {
      if (!value) return null;
      if (device && device.noteStat) device.noteStat(via === "worker" ? "worker" : "local", "ai", value.length, 0);
      return { via: via, text: String(value), error: false, scope: scopeName };
    }
    var wantChrome = (opts.env && opts.env.summarizer) || (!opts.env && chromeApis().summarizer);
    if (!cooling(device, "chrome-summarizer", opts.now) && wantChrome) {
      return chromeSummarize(sample, opts.env).then(function (value) {
        rememberSource(device, "chrome-summarizer", true, opts.now);
        return finish("chrome", value) || finish("extractive", local);
      }).catch(function () {
        rememberSource(device, "chrome-summarizer", false, opts.now);
        return afterChrome();
      });
    }
    return afterChrome();
    function afterChrome() {
      if (local) return Promise.resolve(finish("extractive", local));
      if (!serverAllowed(opts)) return Promise.resolve({ via: "device", text: "", hidden: true, error: false, scope: scopeName });
      var server = opts.env && opts.env.server;
      if (typeof server !== "function") return Promise.resolve({ via: "device", text: "", hidden: true, error: false, scope: scopeName });
      return Promise.resolve().then(function () { return server(sample, "summarize"); }).then(function (value) {
        return finish("worker", value) || { via: "worker", text: "", error: false, scope: scopeName };
      }).catch(function () {
        return { via: "device", text: "", hidden: true, error: false, scope: scopeName };
      });
    }
  }

  function fixGrammar(text) {
    var raw = String(text || "").replace(/[ ]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
    if (!raw) return "";
    var fixed = raw.split(/\s+/).map(function (word) {
      var bare = word.replace(/[^A-Za-z']/g, "").toLowerCase();
      if (!TYPOS[bare]) return word;
      return word.replace(new RegExp(bare, "i"), TYPOS[bare]);
    }).join(" ");
    fixed = fixed.replace(/\bi\b/g, "I");
    if (fixed.charAt(0) && /[a-z]/.test(fixed.charAt(0))) fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    if (!/[.!?]$/.test(fixed)) fixed += ".";
    return fixed;
  }

  function applyTone(text, tone) {
    var raw = fixGrammar(text).replace(/\.$/, "");
    if (tone === "shorter") {
      var cut = raw.slice(0, 140);
      var sp = cut.lastIndexOf(" ");
      if (sp > 80) cut = cut.slice(0, sp);
      return cut.replace(/[.!?]$/, "") + ".";
    }
    if (tone === "clear") return raw.replace(/\b(very|really|just)\b/gi, "").replace(/\s{2,}/g, " ").trim() + ".";
    if (tone === "warm") return "Thanks for this. " + raw + ".";
    if (tone === "direct") return raw.replace(/\b(i think|maybe|perhaps|just)\b/gi, "").replace(/\s{2,}/g, " ").trim() + ".";
    return raw + ".";
  }

  function suggestionsFor(text) {
    var bits = words(text).filter(function (word) { return word.length > 3; }).slice(0, 4);
    var topic = bits.slice(0, 3).join(" ");
    if (!topic) topic = "this";
    return [
      "Thanks for sharing this about " + topic + ".",
      "Could you say a bit more about " + topic + "?",
      "This is useful. I read the part about " + topic + "."
    ];
  }

  function chromeRewrite(text, kind, tone, env) {
    var g = scope();
    var api = null;
    if (env && env.rewriter) api = env.rewriter;
    else if (kind === "suggest" && env && env.writer) api = env.writer;
    else if (typeof g.Rewriter === "function" && kind !== "suggest") api = g.Rewriter;
    else if (typeof g.Writer === "function" && kind === "suggest") api = g.Writer;
    if (!api || !api.create) return Promise.reject(new Error("unsupported"));
    return Promise.resolve().then(function () {
      return api.create(tone ? { tone: tone } : {});
    }).then(function (session) {
      if (kind === "suggest" && session.write) return session.write(String(text || ""));
      if (session.rewrite) return session.rewrite(String(text || ""));
      if (session.write) return session.write(String(text || ""));
      return "";
    });
  }

  function compose(text, opts) {
    opts = opts || {};
    var kind = opts.kind || "grammar";
    var scopeName = opts.scope || "post";
    if (!aiOn(opts, "compose") || !masterOn(opts, "ai")) return Promise.resolve({ via: "off", text: "", suggestions: [], error: false });
    var device = opts.device || deviceApi();
    function local() {
      if (kind === "suggest") return { via: "rules", text: "", suggestions: suggestionsFor(text), error: false, scope: scopeName };
      return { via: "rules", text: applyTone(text, kind === "tone" ? (opts.tone || "clear") : "clear"), suggestions: [], error: false, scope: scopeName };
    }
    function afterRules() {
      if (!serverAllowed(opts)) return Promise.resolve(local());
      var server = opts.env && opts.env.server;
      if (typeof server !== "function") return Promise.resolve(local());
      return Promise.resolve().then(function () { return server(text, kind); }).then(function (value) {
        return { via: "worker", text: String(value || ""), suggestions: [], error: false, scope: scopeName };
      }).catch(function () { return local(); });
    }
    var env = opts.env || null;
    var chromeReady = env ? !!(env.rewriter || env.writer) : (kind === "suggest" ? chromeApis().writer : (chromeApis().rewriter || chromeApis().writer));
    if (chromeReady && !cooling(device, "chrome-writer", opts.now)) {
      return chromeRewrite(text, kind, opts.tone, opts.env).then(function (value) {
        var out = String(value || "").trim();
        if (!out) throw new Error("invalid");
        rememberSource(device, "chrome-writer", true, opts.now);
        if (device && device.noteStat) device.noteStat("local", "ai", out.length, 0);
        if (kind === "suggest") return { via: "chrome", text: out, suggestions: out.split(/\n+/).filter(Boolean).slice(0, 3), error: false, scope: scopeName };
        return { via: "chrome", text: out, suggestions: [], error: false, scope: scopeName };
      }).catch(function () {
        rememberSource(device, "chrome-writer", false, opts.now);
        return afterRules();
      });
    }
    return afterRules();
  }

  function stem(word) {
    var token = SYN[word] || word;
    if (token.length > 4 && /ing$/.test(token)) token = token.slice(0, -3);
    else if (token.length > 3 && /ed$/.test(token)) token = token.slice(0, -2);
    else if (token.length > 3 && /s$/.test(token) && !/ss$/.test(token)) token = token.slice(0, -1);
    return SYN[token] || token;
  }

  function embedHash(text) {
    var vec = [];
    for (var i = 0; i < 64; i++) vec.push(0);
    words(text).forEach(function (word) {
      var token = stem(word);
      if (token.length < 3) return;
      var h = hash(token);
      var bin = parseInt(h.slice(0, 4), 36) % 64;
      vec[bin] += 1;
    });
    return vec;
  }

  function cosine(a, b) {
    var dot = 0;
    var aa = 0;
    var bb = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    if (!aa || !bb) return 0;
    return dot / (Math.sqrt(aa) * Math.sqrt(bb));
  }

  function hashRank(query, posts, opts) {
    var qv = embedHash(query);
    var min = opts && opts.min != null ? opts.min : 0.2;
    var hits = (posts || []).map(function (post) {
      var text = String((post && (post.text || post.title)) || "");
      return { post: post, score: cosine(qv, embedHash(text)) };
    }).filter(function (row) { return row.score >= min; });
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits;
  }

  function modelWanted(opts) {
    var settings = settingsOf(opts);
    return !!(settings.aiFeatures && settings.aiFeatures.semanticLocal) && downloadAllowed(opts);
  }

  function searchSaved(query, posts, opts) {
    opts = opts || {};
    if (!aiOn(opts, "semantic")) return { via: "off", hits: [] };
    var list = posts || [];
    var key = hash(String(query || "") + ":" + list.length);
    var cached = rankCache[key];
    if (cached && cached.via === "minilm" && cached.hits) return { via: "minilm", hits: cached.hits };
    if (modelWanted(opts) && !cached) {
      rankCache[key] = { pending: true };
      var rows = list.slice(0, 24).map(function (post, index) {
        return {
          id: post && post.id != null ? String(post.id) : String(index),
          text: String((post && (post.text || post.title)) || "").slice(0, 2000)
        };
      });
      runInWorker("rank", { query: String(query || "").slice(0, 400), rows: rows, model: CATALOG.semanticLocal.id }, opts).then(function (result) {
        if (!result || result.via !== "minilm" || !result.hits) {
          rankCache[key] = { failed: true };
          return;
        }
        var byId = {};
        list.forEach(function (post) { if (post && post.id != null) byId[String(post.id)] = post; });
        rankCache[key] = {
          via: "minilm",
          hits: result.hits.map(function (hit) {
            return { post: byId[hit.id] || null, score: hit.score };
          }).filter(function (hit) { return hit.post; })
        };
        if (typeof opts.onRank === "function") {
          var fire = function () { opts.onRank(); };
          if (typeof setTimeout === "function") setTimeout(fire, 0);
          else fire();
        }
      }).catch(function () { rankCache[key] = { failed: true }; });
    }
    return { via: "hash", hits: hashRank(query, list, opts) };
  }

  function foreign(text, target) {
    var found = detectSync(text);
    if (!found.code) return false;
    return found.code !== String(target || "en").toLowerCase().split("-")[0];
  }

  function pairFor(source, target) {
    var key = String(source || "") + "-" + String(target || "");
    return PAIRS[key] ? "Xenova/opus-mt-" + key : "";
  }

  function translate(text, opts) {
    opts = opts || {};
    var sample = String(text || "");
    var target = String(opts.target || "en").toLowerCase().split("-")[0];
    var scopeName = opts.scope || "post";
    var device = opts.device || deviceApi();
    if (!masterOn(opts, "translate")) return Promise.resolve({ via: "off", text: "", error: false, scope: scopeName });
    function blocked() {
      return { via: "device", text: "", hidden: true, error: false, scope: scopeName };
    }
    return detect(sample, Object.assign({}, opts, { force: true })).then(function (found) {
      var source = found && found.code;
      if (source && source === target) return { via: "detect", text: "", same: true, source: source, error: false, scope: scopeName };
      var env = opts.env || {};
      var g = scope();
      var chrome = env.translator || (typeof g.Translator === "function" ? g.Translator : null);
      function localModel() {
        var settings = settingsOf(opts);
        if (!settings.aiFeatures || !settings.aiFeatures.translateLocal) return Promise.resolve(null);
        if (!downloadAllowed(opts)) return Promise.resolve({ paused: true });
        if (cooling(device, "translate-local", opts.now)) return Promise.resolve(null);
        var model = pairFor(source || "en", target);
        if (!model) return Promise.resolve(null);
        var loader = env.local || null;
        if (typeof loader !== "function") return runInWorker("translate", { text: sample, model: model }, opts);
        return Promise.resolve().then(function () { return loader(sample, model); });
      }
      function server() {
        if (!serverAllowed(opts)) return Promise.resolve(blocked());
      var fn = env.server;
      if (typeof fn !== "function") {
        var live = scope();
        if (live.FeedsTranslate && typeof live.FeedsTranslate.translatePlain === "function") {
          fn = function (body, sourceCode, tgt) {
            return live.FeedsTranslate.translatePlain(body, tgt || target);
          };
        }
      }
      if (typeof fn !== "function") return Promise.resolve(null);
      return Promise.resolve().then(function () { return fn(sample, source || "auto", target); }).then(function (value) {
        var text = value && value.text ? value.text : value;
        if (!text) return null;
        if (device && device.noteStat) device.noteStat("worker", "translate", String(text).length, 0);
        return { via: "worker", text: String(text), source: source || "", error: false, scope: scopeName };
      });
      }
      function afterLocal(row) {
        if (row && row.text) {
          rememberSource(device, "translate-local", true, opts.now);
          if (LOADED.indexOf("translateLocal") < 0) LOADED.push("translateLocal");
          return { via: "local", text: String(row.text), source: source || "", error: false, scope: scopeName };
        }
        if (row && row.paused) return blocked();
        return server().then(function (done) { return done || blocked(); });
      }
      if (chrome && chrome.create && source && !cooling(device, "chrome-translator", opts.now)) {
        return Promise.resolve().then(function () {
          return chrome.create({ sourceLanguage: source, targetLanguage: target });
        }).then(function (session) {
          return session.translate(sample);
        }).then(function (value) {
          if (!value || value === sample) throw new Error("invalid");
          rememberSource(device, "chrome-translator", true, opts.now);
          if (device && device.noteStat) device.noteStat("local", "translate", String(value).length, 0);
          return { via: "chrome", text: String(value), source: source, error: false, scope: scopeName };
        }).catch(function () {
          rememberSource(device, "chrome-translator", false, opts.now);
          return localModel().then(afterLocal);
        });
      }
      return localModel().then(afterLocal);
    });
  }

  function localTranslate(text, opts) {
    opts = Object.assign({}, opts || {}, { server: false });
    if (opts.env) opts.env = Object.assign({}, opts.env, { server: null, translator: null });
    else opts.env = { translator: null, server: null };
    return translate(text, opts).then(function (row) {
      if (!row || row.via === "chrome" || row.via === "worker") return null;
      return row;
    });
  }

  function runInWorker(task, payload, opts) {
    if (opts && (opts.inline || typeof opts.loader === "function")) return workerTask(task, payload, opts);
    if (typeof Worker !== "function" || typeof document === "undefined") return workerTask(task, payload, opts);
    return viaWorker(task, payload);
  }

  function viaWorker(task, payload) {
    return ensureWorker().then(function (port) {
      return new Promise(function (resolve, reject) {
        var id = ++workerSeq;
        function onMessage(event) {
          var msg = event.data || {};
          if (msg.id !== id) return;
          port.removeEventListener("message", onMessage);
          if (!msg.ok) reject(new Error("failed"));
          else resolve(msg.result);
        }
        port.addEventListener("message", onMessage);
        port.postMessage({ id: id, task: task, payload: payload });
      });
    });
  }

  function ensureWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = new Promise(function (resolve, reject) {
      try {
        var worker = new Worker("./ondevice-ai-worker.js");
        worker.addEventListener("error", function () { workerPromise = null; });
        resolve(worker);
      } catch (err) {
        workerPromise = null;
        reject(err);
      }
    });
    return workerPromise;
  }

  function markLoaded(id, bytes) {
    if (LOADED.indexOf(id) < 0) LOADED.push(id);
    return { id: id, bytes: bytes || 0 };
  }

  function workerTask(task, payload, opts) {
    payload = payload || {};
    if (task === "detect") return Promise.resolve(detectSync(payload.text));
    if (task === "spam") return Promise.resolve({ score: spamScore(payload.text), spam: spamScore(payload.text) >= 0.45 });
    if (task === "summarize") return Promise.resolve({ text: summarizeExtract(payload.text, payload.limit) });
    if (task === "compose") return Promise.resolve({ text: applyTone(payload.text, payload.tone || "clear"), suggestions: suggestionsFor(payload.text) });
    if (task === "embed") return loadOptional(payload.model || CATALOG.semanticLocal.id, Object.assign({}, opts, { text: payload.text, kind: "feature-extraction" }));
    if (task === "rank") return rankWithModel(payload, opts);
    if (task === "translate") return loadOptional(payload.model, Object.assign({}, opts, { text: payload.text, kind: "translation" }));
    if (task === "cache") return cachePut(payload.name, payload.bytes);
    return Promise.resolve(null);
  }

  function asVector(out) {
    if (!out) return [];
    if (out.data) return Array.prototype.slice.call(out.data);
    if (Array.isArray(out)) return out;
    return [];
  }

  function rankWithModel(payload, opts) {
    payload = payload || {};
    var rows = payload.rows || [];
    return loadOptional(payload.model || CATALOG.semanticLocal.id, Object.assign({}, opts, {
      kind: "feature-extraction",
      text: [payload.query].concat(rows.map(function (row) { return row.text || ""; }))
    })).then(function (value) {
      var vectors = value && (value.vectors || (value.vector ? [value.vector] : null));
      if (!vectors || vectors.length !== rows.length + 1) {
        return {
          via: "hash",
          hits: rows.map(function (row) {
            return { id: row.id, score: cosine(embedHash(payload.query), embedHash(row.text)) };
          }).filter(function (hit) { return hit.score >= 0.2; })
        };
      }
      var hits = rows.map(function (row, index) {
        return { id: row.id, score: cosine(vectors[0], vectors[index + 1]) };
      }).filter(function (hit) { return hit.score >= 0.2; });
      hits.sort(function (a, b) { return b.score - a.score; });
      return { via: "minilm", hits: hits, loadMs: value.loadMs, memoryBytes: value.memoryBytes };
    });
  }

  function loadOptional(model, opts) {
    opts = opts || {};
    if (!downloadAllowed(opts)) return Promise.resolve({ paused: true });
    var started = now();
    var before = heap();
    var loader = opts.loader;
    var pending = typeof loader === "function"
      ? Promise.resolve().then(function () { return loader(model, opts.text, opts.kind); })
      : importTransformers(model, opts.text, opts.kind);
    return pending.then(function (value) {
      var id = String(model || "model");
      if (value && (value.text || value.vector || value.vectors)) markLoaded(id, value.bytes);
      return {
        text: value && value.text ? value.text : "",
        vector: value && value.vector ? value.vector : null,
        vectors: value && value.vectors ? value.vectors : null,
        model: id,
        loadMs: Math.max(0, now() - started),
        memoryBytes: value && value.memoryBytes != null ? value.memoryBytes : Math.max(0, heap() - before)
      };
    });
  }

  function vectorList(pipe, lines) {
    var chain = Promise.resolve([]);
    (lines || []).forEach(function (line) {
      chain = chain.then(function (acc) {
        return Promise.resolve(pipe(String(line || ""), { pooling: "mean", normalize: true })).then(function (out) {
          acc.push(asVector(out));
          return acc;
        });
      });
    });
    return chain;
  }

  function importTransformers(model, text, kind) {
    var name = String(model || "");
    var task = kind || (name.indexOf("all-MiniLM") >= 0 ? "feature-extraction" : "translation");
    function run(pipe) {
      if (!pipe) return null;
      if (task === "feature-extraction") {
        var lines = Array.isArray(text) ? text : [text];
        return vectorList(pipe, lines).then(function (vectors) {
          return { vectors: vectors, vector: vectors[0] || null, bytes: CATALOG.semanticLocal.bytes };
        });
      }
      return Promise.resolve(pipe(String(text || ""))).then(function (out) {
        var row = Array.isArray(out) ? out[0] : out;
        var translated = row && (row.translation_text || row.generated_text || "");
        return { text: translated || "", bytes: CATALOG.translateLocal.bytes };
      });
    }
    if (pipes[name]) return run(pipes[name]);
    var importer = root.ViktorychOnDeviceAiImport || null;
    if (!importer && typeof importScripts !== "function") {
      try { importer = new Function("u", "return import(u);"); } catch (err) { importer = null; }
    }
    if (!importer) return Promise.resolve(null);
    return Promise.resolve().then(function () { return importer(TRANSFORMERS_SPEC); }).then(function (mod) {
      if (!mod || typeof mod.pipeline !== "function") return null;
      if (mod.env) {
        mod.env.useBrowserCache = true;
        if (mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm) mod.env.backends.onnx.wasm.proxy = false;
      }
      return mod.pipeline(task, name, { dtype: "q8" });
    }).then(function (pipe) {
      if (!pipe) return null;
      pipes[name] = pipe;
      return run(pipe);
    }).catch(function () { return null; });
  }

  function cachePut(name, bytes) {
    var key = String(name || "model");
    memoryCache[key] = bytes || null;
    var jobs = [];
    if (typeof caches !== "undefined" && caches.open) {
      jobs.push(caches.open(CACHE_NAME).then(function (box) {
        var body = bytes ? new Blob([bytes]) : new Blob([]);
        return box.put(key, new Response(body));
      }).then(function () { return "cache"; }).catch(function () { return ""; }));
    }
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.getDirectory) {
      jobs.push(navigator.storage.getDirectory().then(function (dir) {
        return dir.getDirectoryHandle(OPFS_DIR, { create: true });
      }).then(function (folder) {
        return folder.getFileHandle(key.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "model", { create: true });
      }).then(function (handle) {
        return handle.createWritable();
      }).then(function (writable) {
        return writable.write(bytes || new Uint8Array()).then(function () { return writable.close(); });
      }).then(function () { return "opfs"; }).catch(function () { return ""; }));
    }
    return Promise.all(jobs).then(function (places) {
      return { name: key, bytes: bytes && bytes.byteLength ? bytes.byteLength : 0, where: places.filter(Boolean), memory: true };
    });
  }

  function cacheNames() {
    return { cache: CACHE_NAME, opfs: OPFS_DIR };
  }

  function support() {
    var apis = chromeApis();
    return {
      chrome: apis,
      wasm: typeof WebAssembly === "object",
      webgpu: typeof navigator !== "undefined" && !!(navigator.gpu),
      worker: typeof Worker === "function",
      cache: typeof caches !== "undefined",
      opfs: typeof navigator !== "undefined" && !!(navigator.storage && navigator.storage.getDirectory),
      browsers: "Chrome and Edge 138 or newer expose Translator, LanguageDetector, Summarizer, Writer, and Rewriter when the device supports them. The Prompt API is used only when LanguageModel exists. Other browsers use the bundled models, then an optional download, then the free server path."
    };
  }

  function button(act, key, label, extra) {
    return '<button type="button" class="show-more odai-btn" data-act="' + act + '" data-key="' + esc(key) + '"' + (extra || "") + ">" + esc(label) + "</button>";
  }

  function uiTarget() {
    var g = scope();
    if (g.SI18n && g.SI18n.getLang) return String(g.SI18n.getLang() || "en").split("-")[0];
    return "en";
  }

  function maybeAuto(raw, id, scopeName) {
    if (scopeName !== "dm" || translated[id] || pendingAuto[id]) return;
    var settings = settingsOf({});
    if (!settings.aiFeatures || !settings.aiFeatures.dmAuto) return;
    if (!foreign(raw, uiTarget())) return;
    pendingAuto[id] = true;
    translate(raw, { scope: "dm", target: uiTarget(), server: false }).then(function (row) {
      if (row && row.text) translated[id] = row.text;
      pendingAuto[id] = "done";
    }).catch(function () { pendingAuto[id] = "done"; });
  }

  function decorate(text, scopeName, target) {
    var raw = String(text || "");
    var id = remember(raw);
    if (hiddenSpam(raw, scopeName)) {
      return { hidden: true, html: '<span class="odai-hidden">' + esc(tr("Likely spam")) + " " + button("odai-show", id, tr("Show")) + "</span>", tools: "" };
    }
    var tools = "";
    if (foreign(raw, target || uiTarget())) {
      maybeAuto(raw, id, scopeName);
      tools += button("odai-translate", id, tr("Translate"), ' data-scope="' + esc(scopeName || "post") + '"');
    }
    if (raw.length > 480) tools += button("odai-summarize", id, tr("Summarize"), ' data-scope="' + esc(scopeName || "post") + '"');
    var note = translated[id] ? '<span class="odai-note">' + esc(translated[id]) + "</span>" : "";
    return { hidden: false, html: "", tools: tools + note };
  }

  function showPanel(title, body) {
    if (typeof document === "undefined") return;
    var old = document.getElementById("odai-panel");
    if (old) old.remove();
    var back = document.createElement("div");
    back.id = "odai-panel";
    back.className = "modal-back";
    back.setAttribute("data-act", "odai-close");
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" data-act="stop"><div class="modal-head"><button class="icon-btn" type="button" data-act="odai-close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(title) + '</h2></div><div class="modal-body"><p class="odai-out"></p></div></div>';
    var slot = back.querySelector(".odai-out");
    if (slot) slot.textContent = body || "";
    document.body.appendChild(back);
  }

  function closePanel() {
    if (typeof document === "undefined") return;
    var old = document.getElementById("odai-panel");
    if (old) old.remove();
  }

  function onAct(act, el, ctx) {
    ctx = ctx || {};
    var key = el && el.getAttribute ? (el.getAttribute("data-key") || "") : "";
    var scopeName = el && el.getAttribute ? (el.getAttribute("data-scope") || "post") : "post";
    if (act === "odai-close") { closePanel(); return; }
    if (act === "odai-show") {
      revealed[key] = true;
      if (ctx.render) ctx.render();
      return;
    }
    if (act === "odai-translate") {
      var sample = stash[key] || "";
      translate(sample, { scope: scopeName, target: ctx.target ? ctx.target() : "en", server: serverAllowed({ scope: scopeName }) }).then(function (row) {
        if (row && row.hidden) showPanel(tr("Translate"), tr("This stays on this device. Translation is not available offline yet."));
        else if (row && row.text) {
          translated[key] = row.text;
          if (ctx.render) ctx.render();
          else showPanel(tr("Translate"), row.text);
        }
      }).catch(function () { showPanel(tr("Translate"), tr("Translation is not available on this device yet.")); });
      return;
    }
    if (act === "odai-summarize" || act === "odai-thread" || act === "odai-catch" || act === "odai-unread") {
      var pieces = [];
      if (act === "odai-summarize") pieces = [stash[key] || (ctx.textFor ? ctx.textFor(key) : "")];
      else if (ctx.texts) pieces = ctx.texts(act, el) || [];
      summarize(pieces, { scope: scopeName }).then(function (row) {
        var title = act === "odai-catch" ? tr("Catch me up") : tr("Summary");
        if (row && row.hidden) showPanel(title, tr("This stays on this device. A summary is not available offline yet."));
        else showPanel(title, (row && row.text) || tr("Nothing to summarize yet."));
      }).catch(function () { showPanel(tr("Summary"), tr("A summary is not available on this device yet.")); });
      return;
    }
    if (act === "odai-grammar" || act === "odai-tone" || act === "odai-suggest") {
      var box = ctx.field ? ctx.field(el && el.getAttribute ? el.getAttribute("data-field") : "") : null;
      var seed = box ? box.value : (stash[key] || (ctx.seed ? ctx.seed(el) : ""));
      var kind = act === "odai-suggest" ? "suggest" : (act === "odai-tone" ? "tone" : "grammar");
      compose(seed, { kind: kind, tone: el && el.getAttribute ? el.getAttribute("data-tone") : "clear", scope: scopeName }).then(function (row) {
        if (kind !== "suggest" && box && row && row.text) {
          box.value = row.text;
          box.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
        var lines = (row && row.suggestions && row.suggestions.length) ? row.suggestions.join("\n\n") : ((row && row.text) || "");
        showPanel(tr("Suggestions"), lines || tr("Suggestions are not available on this device yet."));
      }).catch(function () { showPanel(tr("Suggestions"), tr("Suggestions are not available on this device yet.")); });
    }
  }

  function reset() {
    stash = {};
    stashOrder = [];
    revealed = {};
    translated = {};
    pendingAuto = {};
    memoryCache = {};
    pipes = {};
    rankCache = {};
    workerPromise = null;
    while (LOADED.length) LOADED.pop();
  }

  return {
    CATALOG: CATALOG,
    CACHE_NAME: CACHE_NAME,
    OPFS_DIR: OPFS_DIR,
    TRANSFORMERS_SPEC: TRANSFORMERS_SPEC,
    PAIRS: PAIRS,
    detectSync: detectSync,
    detect: detect,
    spamScore: spamScore,
    likelySpam: likelySpam,
    hiddenSpam: hiddenSpam,
    summarize: summarize,
    summarizeExtract: summarizeExtract,
    fixGrammar: fixGrammar,
    applyTone: applyTone,
    suggestionsFor: suggestionsFor,
    compose: compose,
    embedHash: embedHash,
    cosine: cosine,
    searchSaved: searchSaved,
    foreign: foreign,
    translate: translate,
    localTranslate: localTranslate,
    downloadAllowed: downloadAllowed,
    serverAllowed: serverAllowed,
    dmLeaves: dmLeaves,
    chromeApis: chromeApis,
    support: support,
    loadedModels: loadedModels,
    measure: measure,
    heap: heap,
    remember: remember,
    decorate: decorate,
    onAct: onAct,
    showPanel: showPanel,
    closePanel: closePanel,
    workerTask: workerTask,
    cachePut: cachePut,
    cacheNames: cacheNames,
    pairFor: pairFor,
    reset: reset
  };
});
