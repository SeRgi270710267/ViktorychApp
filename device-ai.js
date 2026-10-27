/* Assistant providers. Order is the browser Prompt API, then an opt-in
   on-device model at Max, then a cloud function the app can plug in.
   No paid API is called from here. A missing or failed provider is skipped. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychDeviceAi = api;
})(typeof self !== "undefined" ? self : this, function () {
  var cloudFn = null;
  var webllmFn = null;
  var WEBLLM_SPEC = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm";

  function deviceApi() {
    if (typeof self !== "undefined" && self.ViktorychDevice) return self.ViktorychDevice;
    if (typeof window !== "undefined" && window.ViktorychDevice) return window.ViktorychDevice;
    if (typeof require === "function") {
      try { return require("./device.js"); } catch (err) { return null; }
    }
    return null;
  }

  function registerCloud(fn) {
    cloudFn = typeof fn === "function" ? fn : null;
  }

  function order(settings, signals, env, device) {
    env = env || {};
    device = device || deviceApi();
    var list = [];
    if (device && device.featureOn(settings, "ai", signals) && typeof env.prompt === "function") list.push("prompt");
    if (device && device.webllmAllowed(settings, signals) && typeof env.webllm === "function") list.push("webllm");
    list.push("cloud");
    return list;
  }

  function promptApi(text) {
    var LM = typeof LanguageModel !== "undefined" ? LanguageModel : null;
    if (!LM && typeof window !== "undefined" && window.ai && window.ai.languageModel && window.ai.languageModel.create) {
      return window.ai.languageModel.create().then(function (session) { return session.prompt(text); });
    }
    if (!LM || !LM.create) return Promise.reject(new Error("unsupported"));
    return LM.create().then(function (session) {
      if (session.prompt) return session.prompt(text);
      return Promise.reject(new Error("unsupported"));
    });
  }

  function loadWebllm() {
    var device = deviceApi();
    if (!device || !device.webllmAllowed(device.read(), device.signals())) return Promise.resolve(null);
    if (webllmFn) return Promise.resolve(webllmFn);
    var importer = root.ViktorychDeviceAiImport || null;
    if (!importer) {
      try { importer = new Function("u", "return import(u);"); }
      catch (err) { return Promise.resolve(null); }
    }
    return Promise.resolve().then(function () { return importer(WEBLLM_SPEC); }).then(function (mod) {
      if (!mod || typeof mod.CreateMLCEngine !== "function") return null;
      var engine = null;
      webllmFn = function (text) {
        var ready = engine || mod.CreateMLCEngine("Llama-3.2-1B-Instruct-q4f32_1-MLC", { initProgressCallback: function () {} });
        engine = ready;
        return Promise.resolve(ready).then(function (session) {
          return session.chat.completions.create({ messages: [{ role: "user", content: String(text || "") }] });
        }).then(function (res) {
          var choice = res && res.choices && res.choices[0];
          var message = choice && choice.message;
          return message && message.content ? message.content : "";
        });
      };
      return webllmFn;
    }).catch(function () { return null; });
  }

  function liveEnv() {
    return {
      prompt: promptApi,
      webllm: webllmFn,
      cloud: function (text) {
        if (!cloudFn) return Promise.reject(new Error("unsupported"));
        return cloudFn(text);
      }
    };
  }

  function ask(text, opts) {
    opts = opts || {};
    var device = opts.device || deviceApi();
    var settings = opts.settings || (device && device.read ? device.read() : {});
    var signals = opts.signals || (device && device.signals ? device.signals() : {});
    var env = opts.env || liveEnv();
    var list = order(settings, signals, env, device);
    var cursor = 0;
    var timeout = opts.timeout == null ? (device && device.TIMEOUT_MS) || 1800 : opts.timeout;
    function next() {
      if (cursor >= list.length) {
        var err = new Error("both");
        err.both = true;
        throw err;
      }
      var id = list[cursor++];
      var fn = env[id];
      if (typeof fn !== "function") return next();
      if (device && device.sourceState && device.sourceState(id, opts.now) === "fail") return next();
      var started = Date.now();
      var pending = Promise.resolve().then(function () { return fn(text); });
      var raced = device && device.withTimeout ? device.withTimeout(pending, timeout) : pending;
      return raced.then(function (value) {
        if (value == null || !String(value).trim()) throw new Error("invalid");
        if (device && device.noteStat) device.noteStat(id === "cloud" ? "worker" : "local", "ai", device.measureBytes(String(value)), Math.max(0, Date.now() - started));
        if (device && device.rememberOk) device.rememberOk(id, opts.now);
        return { via: id, text: String(value), error: false };
      }).catch(function () {
        if (device && device.rememberFail) device.rememberFail("ai", id, opts.now, "source");
        return next();
      });
    }
    return Promise.resolve().then(next);
  }

  return {
    order: order,
    ask: ask,
    registerCloud: registerCloud,
    loadWebllm: loadWebllm,
    WEBLLM_SPEC: WEBLLM_SPEC
  };
});
