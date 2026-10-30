/* TV tuning: the TV app's first-time setup step that reads this TV's specs
   and picks the best defaults for it.

   Detection runs on the TV only. Inside the TV app's WebView the app answers
   through window.ViktorychTVApp.specs() (display modes, HDR, decoders, audio
   passthrough, RAM, CPU, GPU, storage, network, controllers); in Chrome (the
   Trusted Web Activity) the same questions go to the browser's own APIs.
   Nothing is sent anywhere: the result stays in this device's local storage
   under its own key, outside the synced settings.

   The chosen defaults land in the app's real settings: TV mode's light
   defaults (motion, blur, image weight, posts in memory, start-up, autoplay),
   Data usage (HD video, preview size, preload), Device performance (cache
   size), and the TV-only settings kept here (max video quality, codec,
   HDR, frame-rate matching, surround passthrough, controller tips).

   A setting someone changed by hand is never overwritten: tuning only
   changes a value that is still at its factory default or still the value
   tuning set last time. Strings for this module live here in en, es, hi
   and ru. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) { root.ViktorychTVTune = api; api.start(); }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";
  var KEY = "viktorychapp-tv-tune-v1";
  var STR = {
    en: {
      checkTitle: "Checking your TV",
      checkSub: "We look at what this TV can do so the app runs at its best. It stays on this TV.",
      checkDisplay: "Screen, refresh rates and HDR",
      checkVideo: "Video decoders",
      checkAudio: "Sound outputs",
      checkPower: "Memory, processor and graphics",
      checkNet: "Network and controllers",
      tunedTitle: "We tuned ViktorychTV for your {model}",
      tunedSub: "Checked on this TV. Nothing leaves it.",
      yourTv: "TV",
      detected: "What we found",
      chosen: "Settings we picked",
      apply: "Apply",
      customize: "Customize",
      skip: "Skip",
      skipAll: "Skip all and finish",
      back: "Back",
      customTitle: "Pick what to change",
      customSub: "Turn off anything you want to keep as it is.",
      applySel: "Apply selected",
      kept: "Kept your choice",
      appliedToast: "Tuned for your {model}.",
      nothing: "Nothing to change. Your TV already has the best settings.",
      sDisplay: "Screen",
      sHdr: "HDR",
      sColor: "Wide colour",
      sVideo: "Video decoders",
      sTunnel: "Tunneled playback",
      sMemory: "Memory",
      sCpu: "Processor",
      sGpu: "Graphics",
      sStorage: "Storage",
      sAudio: "Sound",
      sNet: "Network",
      sInput: "Controllers",
      sSystem: "System",
      none: "None",
      yes: "Yes",
      no: "No",
      unknown: "Not reported",
      lowRam: "low-memory device",
      free: "{n} free",
      cores: "{n} cores",
      pads: "{n} connected",
      bt: "Bluetooth",
      modes: "{n} modes",
      hw: "hardware",
      on: "On",
      off: "Off",
      muted: "Muted",
      auto: "Auto",
      light: "Light",
      balanced: "Balanced",
      kVideoCap: "Max video quality",
      kCodec: "Preferred video codec",
      kHdr: "HDR video",
      kFrame: "Match frame rate",
      kPass: "Surround passthrough",
      kPad: "Controller tips",
      kCalm: "Reduce motion",
      kFlat: "No blur effects",
      kLight: "Lighter images",
      kFewer: "Fewer posts in memory",
      kLazy: "Lighter start-up",
      kAuto: "TV video autoplay",
      kHd: "HD video",
      kSize: "Smaller previews",
      kPreload: "Download ahead",
      kLevel: "Device performance",
      cache: "{n} cache",
      wait: "Wait for Wi-Fi",
      idle: "When idle",
      setTitle: "TV tuning",
      setNote: "Tuned for {model} on {date}. Settings you change yourself are never overwritten.",
      setNone: "Not tuned yet. Check this TV and pick the best defaults for it.",
      redetect: "Re-detect TV",
      whyApp: "Frame-rate matching and HDR need the TV app's built-in screen.",
      tipsPad: "Controller: A selects, B goes back, the D-pad moves.",
      reasonSlow: "slow network",
      reasonLow: "low-power TV"
    },
    es: {
      checkTitle: "Revisando tu TV",
      checkSub: "Vemos lo que puede hacer esta TV para que la app vaya al máximo. Todo se queda en esta TV.",
      checkDisplay: "Pantalla, frecuencias y HDR",
      checkVideo: "Decodificadores de vídeo",
      checkAudio: "Salidas de sonido",
      checkPower: "Memoria, procesador y gráficos",
      checkNet: "Red y mandos",
      tunedTitle: "Ajustamos ViktorychTV para tu {model}",
      tunedSub: "Revisado en esta TV. Nada sale de ella.",
      yourTv: "TV",
      detected: "Lo que encontramos",
      chosen: "Ajustes elegidos",
      apply: "Aplicar",
      customize: "Personalizar",
      skip: "Omitir",
      skipAll: "Omitir todo y terminar",
      back: "Atrás",
      customTitle: "Elige qué cambiar",
      customSub: "Desactiva lo que quieras dejar como está.",
      applySel: "Aplicar selección",
      kept: "Se mantiene tu elección",
      appliedToast: "Ajustado para tu {model}.",
      nothing: "No hay nada que cambiar. Tu TV ya tiene los mejores ajustes.",
      sDisplay: "Pantalla",
      sHdr: "HDR",
      sColor: "Color amplio",
      sVideo: "Decodificadores de vídeo",
      sTunnel: "Reproducción en túnel",
      sMemory: "Memoria",
      sCpu: "Procesador",
      sGpu: "Gráficos",
      sStorage: "Almacenamiento",
      sAudio: "Sonido",
      sNet: "Red",
      sInput: "Mandos",
      sSystem: "Sistema",
      none: "Ninguno",
      yes: "Sí",
      no: "No",
      unknown: "No disponible",
      lowRam: "dispositivo con poca memoria",
      free: "{n} libres",
      cores: "{n} núcleos",
      pads: "{n} conectados",
      bt: "Bluetooth",
      modes: "{n} modos",
      hw: "hardware",
      on: "Sí",
      off: "No",
      muted: "Silenciado",
      auto: "Automático",
      light: "Ligero",
      balanced: "Equilibrado",
      kVideoCap: "Calidad máxima de vídeo",
      kCodec: "Códec de vídeo preferido",
      kHdr: "Vídeo HDR",
      kFrame: "Igualar fotogramas por segundo",
      kPass: "Sonido envolvente directo",
      kPad: "Consejos del mando",
      kCalm: "Reducir movimiento",
      kFlat: "Sin efectos de desenfoque",
      kLight: "Imágenes más ligeras",
      kFewer: "Menos posts en memoria",
      kLazy: "Inicio más ligero",
      kAuto: "Reproducción automática en TV",
      kHd: "Vídeo HD",
      kSize: "Vistas previas más pequeñas",
      kPreload: "Descargar por adelantado",
      kLevel: "Rendimiento del dispositivo",
      cache: "{n} de caché",
      wait: "Esperar al Wi-Fi",
      idle: "En reposo",
      setTitle: "Ajuste de la TV",
      setNote: "Ajustado para {model} el {date}. Lo que cambies tú nunca se sobrescribe.",
      setNone: "Aún sin ajustar. Revisa esta TV y elige los mejores valores.",
      redetect: "Volver a detectar la TV",
      whyApp: "Igualar fotogramas y el HDR necesitan la pantalla integrada de la app de TV.",
      tipsPad: "Mando: A selecciona, B vuelve, la cruceta mueve.",
      reasonSlow: "red lenta",
      reasonLow: "TV de baja potencia"
    },
    hi: {
      checkTitle: "आपका TV जाँचा जा रहा है",
      checkSub: "हम देखते हैं कि यह TV क्या-क्या कर सकता है, ताकि ऐप सबसे अच्छा चले। सब कुछ इसी TV पर रहता है।",
      checkDisplay: "स्क्रीन, रिफ़्रेश रेट और HDR",
      checkVideo: "वीडियो डिकोडर",
      checkAudio: "साउंड आउटपुट",
      checkPower: "मेमोरी, प्रोसेसर और ग्राफ़िक्स",
      checkNet: "नेटवर्क और कंट्रोलर",
      tunedTitle: "हमने ViktorychTV को आपके {model} के लिए सेट किया",
      tunedSub: "इसी TV पर जाँचा गया। कुछ भी बाहर नहीं जाता।",
      yourTv: "TV",
      detected: "हमें क्या मिला",
      chosen: "चुनी गई सेटिंग्स",
      apply: "लागू करें",
      customize: "अपनी पसंद से बदलें",
      skip: "छोड़ें",
      skipAll: "सब छोड़ें और पूरा करें",
      back: "वापस",
      customTitle: "चुनें कि क्या बदलना है",
      customSub: "जो जैसा है वैसा रखना हो, उसे बंद कर दें।",
      applySel: "चुनी हुई लागू करें",
      kept: "आपकी पसंद रखी गई",
      appliedToast: "आपके {model} के लिए सेट हो गया।",
      nothing: "बदलने को कुछ नहीं। आपके TV पर पहले से सबसे अच्छी सेटिंग्स हैं।",
      sDisplay: "स्क्रीन",
      sHdr: "HDR",
      sColor: "वाइड कलर",
      sVideo: "वीडियो डिकोडर",
      sTunnel: "टनल प्लेबैक",
      sMemory: "मेमोरी",
      sCpu: "प्रोसेसर",
      sGpu: "ग्राफ़िक्स",
      sStorage: "स्टोरेज",
      sAudio: "साउंड",
      sNet: "नेटवर्क",
      sInput: "कंट्रोलर",
      sSystem: "सिस्टम",
      none: "कोई नहीं",
      yes: "हाँ",
      no: "नहीं",
      unknown: "पता नहीं चला",
      lowRam: "कम मेमोरी वाला डिवाइस",
      free: "{n} खाली",
      cores: "{n} कोर",
      pads: "{n} जुड़े हैं",
      bt: "Bluetooth",
      modes: "{n} मोड",
      hw: "हार्डवेयर",
      on: "चालू",
      off: "बंद",
      muted: "म्यूट",
      auto: "अपने आप",
      light: "हल्का",
      balanced: "संतुलित",
      kVideoCap: "वीडियो की सबसे ऊँची क्वालिटी",
      kCodec: "पसंदीदा वीडियो कोडेक",
      kHdr: "HDR वीडियो",
      kFrame: "फ़्रेम रेट मिलाएँ",
      kPass: "सराउंड पासथ्रू",
      kPad: "कंट्रोलर टिप्स",
      kCalm: "मोशन कम करें",
      kFlat: "ब्लर इफ़ेक्ट नहीं",
      kLight: "हल्की तस्वीरें",
      kFewer: "मेमोरी में कम पोस्ट",
      kLazy: "हल्की शुरुआत",
      kAuto: "TV पर वीडियो ऑटोप्ले",
      kHd: "HD वीडियो",
      kSize: "छोटे प्रीव्यू",
      kPreload: "पहले से डाउनलोड",
      kLevel: "डिवाइस परफ़ॉर्मेंस",
      cache: "{n} कैश",
      wait: "Wi-Fi का इंतज़ार",
      idle: "खाली समय में",
      setTitle: "TV ट्यूनिंग",
      setNote: "{date} को {model} के लिए सेट किया गया। जो सेटिंग आप खुद बदलते हैं, वह कभी नहीं बदली जाती।",
      setNone: "अभी सेट नहीं किया गया। इस TV को जाँचें और इसके लिए सबसे अच्छी सेटिंग्स चुनें।",
      redetect: "TV फिर से जाँचें",
      whyApp: "फ़्रेम रेट मिलाने और HDR के लिए TV ऐप की अपनी स्क्रीन चाहिए।",
      tipsPad: "कंट्रोलर: A चुनता है, B वापस जाता है, D-pad से आगे-पीछे करें।",
      reasonSlow: "धीमा नेटवर्क",
      reasonLow: "कम पावर वाला TV"
    },
    ru: {
      checkTitle: "Проверяем ваш телевизор",
      checkSub: "Смотрим, что умеет этот телевизор, чтобы приложение работало лучше всего. Всё остаётся на нём.",
      checkDisplay: "Экран, частоты и HDR",
      checkVideo: "Видеодекодеры",
      checkAudio: "Аудиовыходы",
      checkPower: "Память, процессор и графика",
      checkNet: "Сеть и геймпады",
      tunedTitle: "Мы настроили ViktorychTV для вашего {model}",
      tunedSub: "Проверено на этом телевизоре. Ничего не передаётся.",
      yourTv: "ТВ",
      detected: "Что мы нашли",
      chosen: "Выбранные настройки",
      apply: "Применить",
      customize: "Настроить",
      skip: "Пропустить",
      skipAll: "Пропустить всё и завершить",
      back: "Назад",
      customTitle: "Выберите, что изменить",
      customSub: "Выключите то, что хотите оставить как есть.",
      applySel: "Применить выбранное",
      kept: "Оставили ваш выбор",
      appliedToast: "Настроено для вашего {model}.",
      nothing: "Менять нечего. На вашем телевизоре уже лучшие настройки.",
      sDisplay: "Экран",
      sHdr: "HDR",
      sColor: "Широкий цветовой охват",
      sVideo: "Видеодекодеры",
      sTunnel: "Туннельное воспроизведение",
      sMemory: "Память",
      sCpu: "Процессор",
      sGpu: "Графика",
      sStorage: "Хранилище",
      sAudio: "Звук",
      sNet: "Сеть",
      sInput: "Геймпады",
      sSystem: "Система",
      none: "Нет",
      yes: "Да",
      no: "Нет",
      unknown: "Не сообщается",
      lowRam: "устройство с малым объёмом памяти",
      free: "свободно {n}",
      cores: "ядер: {n}",
      pads: "подключено: {n}",
      bt: "Bluetooth",
      modes: "режимов: {n}",
      hw: "аппаратно",
      on: "Вкл.",
      off: "Выкл.",
      muted: "Без звука",
      auto: "Авто",
      light: "Лёгкий",
      balanced: "Сбалансированный",
      kVideoCap: "Максимальное качество видео",
      kCodec: "Предпочтительный видеокодек",
      kHdr: "HDR-видео",
      kFrame: "Подстройка частоты кадров",
      kPass: "Прямой вывод объёмного звука",
      kPad: "Подсказки для геймпада",
      kCalm: "Меньше движения",
      kFlat: "Без размытия",
      kLight: "Облегчённые изображения",
      kFewer: "Меньше постов в памяти",
      kLazy: "Облегчённый запуск",
      kAuto: "Автовоспроизведение на ТВ",
      kHd: "HD-видео",
      kSize: "Уменьшенные превью",
      kPreload: "Загружать заранее",
      kLevel: "Производительность устройства",
      cache: "кэш {n}",
      wait: "Ждать Wi-Fi",
      idle: "В простое",
      setTitle: "Настройка под телевизор",
      setNote: "Настроено для {model} {date}. Настройки, которые вы меняете сами, никогда не перезаписываются.",
      setNone: "Ещё не настроено. Проверьте этот телевизор и выберите лучшие значения.",
      redetect: "Определить ТВ заново",
      whyApp: "Подстройке частоты кадров и HDR нужен встроенный экран ТВ-приложения.",
      tipsPad: "Геймпад: A — выбрать, B — назад, крестовина — перемещение.",
      reasonSlow: "медленная сеть",
      reasonLow: "маломощный ТВ"
    }
  };

  // ---------- small helpers ----------

  function lang() {
    var code = "";
    try { code = root.SI18n && root.SI18n.getLang ? root.SI18n.getLang() : ""; } catch (err) { code = ""; }
    if (!code) { try { code = (root.navigator && root.navigator.language) || "en"; } catch (err) { code = "en"; } }
    code = String(code).toLowerCase().split("-")[0];
    return STR[code] ? code : "en";
  }
  function t(key, vars) {
    var pack = STR[lang()] || STR.en;
    var text = pack[key] != null ? pack[key] : (STR.en[key] != null ? STR.en[key] : key);
    if (vars) text = text.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m; });
    return text;
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function size(mb) {
    mb = num(mb);
    if (!mb) return "";
    if (mb >= 1024) return (Math.round(mb / 102.4) / 10) + " GB";
    return Math.round(mb) + " MB";
  }

  function read() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") return parsed;
    } catch (err) { /* private mode */ }
    return {};
  }
  function write(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { /* private mode */ }
  }
  function boot() { return root.ViktorychTVMode || null; }
  function bridge() {
    var b = root.ViktorychTVApp;
    return b && typeof b.specs === "function" ? b : null;
  }

  // ---------- detection ----------

  /* Browser-side answers, used in Chrome (no app bridge) and to fill gaps. */
  function uaModel(ua) {
    var m = /Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/.exec(ua || "");
    var model = m ? m[1].trim() : "";
    if (/^(K|wv)$/.test(model)) model = "";
    return model;
  }
  function measureRefresh() {
    return new Promise(function (resolve) {
      if (!root.requestAnimationFrame) { resolve(0); return; }
      var times = [];
      var done = false;
      function tick(ts) {
        if (done) return;
        times.push(ts);
        if (times.length >= 31) {
          done = true;
          var d = [];
          for (var i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
          d.sort(function (a, b) { return a - b; });
          var mid = d[Math.floor(d.length / 2)] || 0;
          resolve(mid ? Math.round(1000 / mid) : 0);
          return;
        }
        root.requestAnimationFrame(tick);
      }
      root.requestAnimationFrame(tick);
      setTimeout(function () { if (!done) { done = true; resolve(0); } }, 1500);
    });
  }
  var VIDEO_TYPES = {
    av1: 'video/mp4; codecs="av01.0.08M.08"',
    vp9: 'video/webm; codecs="vp09.00.40.08"',
    hevc: 'video/mp4; codecs="hev1.1.6.L150.B0"',
    h264: 'video/mp4; codecs="avc1.640028"'
  };
  var LADDER = [[3840, 2160, 60], [3840, 2160, 30], [2560, 1440, 60], [1920, 1080, 60], [1920, 1080, 30], [1280, 720, 30]];
  function browserCodec(name) {
    var mc = root.navigator && root.navigator.mediaCapabilities;
    var type = VIDEO_TYPES[name];
    if (!mc || !mc.decodingInfo) {
      var ok = false;
      try { ok = !!(root.MediaSource && root.MediaSource.isTypeSupported(type)); } catch (err) { ok = false; }
      return Promise.resolve(ok ? { hw: false, maxHeight: 1080, maxFps: 30 } : null);
    }
    var i = 0;
    function next() {
      if (i >= LADDER.length) return Promise.resolve(null);
      var step = LADDER[i++];
      var cfg = { type: "media-source", video: { contentType: type, width: step[0], height: step[1], bitrate: step[1] >= 2160 ? 20000000 : 6000000, framerate: step[2] } };
      return mc.decodingInfo(cfg).then(function (r) {
        if (r && r.supported && r.smooth) return { hw: !!r.powerEfficient, maxWidth: step[0], maxHeight: step[1], maxFps: step[2] };
        return next();
      }, next);
    }
    return next().then(function (res) {
      if (!res || name === "h264") return res;
      var hdr = { type: "media-source", video: { contentType: type, width: 1920, height: 1080, bitrate: 8000000, framerate: 30, hdrMetadataType: "smpteSt2086", colorGamut: "rec2020", transferFunction: "pq" } };
      return mc.decodingInfo(hdr).then(function (r) { res.hdr = !!(r && r.supported); return res; }, function () { return res; });
    });
  }
  function media(q) { try { return !!(root.matchMedia && root.matchMedia(q).matches); } catch (err) { return false; } }
  function gpuName() {
    try {
      var c = root.document.createElement("canvas");
      var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return "";
      var ext = gl.getExtension("WEBGL_debug_renderer_info");
      var name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return String(name || "");
    } catch (err) { return ""; }
  }
  function browserSpecs() {
    var nav = root.navigator || {};
    var scr = root.screen || {};
    var dpr = num(root.devicePixelRatio) || 1;
    var ua = String(nav.userAgent || "");
    var conn = nav.connection || {};
    var pads = 0;
    try { pads = arr(Array.prototype.slice.call(nav.getGamepads ? nav.getGamepads() : [])).filter(Boolean).length; } catch (err) { pads = 0; }
    var hdr = media("(dynamic-range: high)") || media("(video-dynamic-range: high)");
    var out = {
      v: 1,
      source: "browser",
      device: {
        model: uaModel(ua),
        android: (/Android ([\d.]+)/.exec(ua) || [])[1] || "",
        platform: /GoogleTV|Google TV/.test(ua) ? "googletv" : (/AFT[A-Z0-9]|Fire TV/i.test(ua) ? "firetv" : "androidtv"),
        tv: true
      },
      display: {
        width: Math.round(num(scr.width) * dpr),
        height: Math.round(num(scr.height) * dpr),
        hdr: hdr ? ["hdr"] : [],
        wideColor: media("(color-gamut: p3)")
      },
      memory: nav.deviceMemory ? { totalMb: num(nav.deviceMemory) * 1024, lowRam: num(nav.deviceMemory) <= 1 } : {},
      cpu: { cores: num(nav.hardwareConcurrency) },
      gpu: { renderer: gpuName() },
      storage: {},
      codecs: {},
      audio: {},
      network: { type: conn.type || "", downMbps: num(conn.downlink), effective: conn.effectiveType || "", saveData: !!conn.saveData },
      input: { gamepads: pads },
      features: { touch: num(nav.maxTouchPoints) > 0 }
    };
    var jobs = [measureRefresh().then(function (hz) { if (hz) { out.display.refresh = hz; out.display.rates = [hz]; } })];
    Object.keys(VIDEO_TYPES).forEach(function (name) {
      jobs.push(browserCodec(name).then(function (r) { if (r) out.codecs[name] = r; }, function () {}));
    });
    try {
      if (nav.storage && nav.storage.estimate) {
        jobs.push(nav.storage.estimate().then(function (e) {
          var free = num(e && e.quota) - num(e && e.usage);
          if (free > 0) out.storage.freeMb = Math.round(free / (1024 * 1024));
        }, function () {}));
      }
    } catch (err) { /* no estimate */ }
    return Promise.all(jobs).then(function () { return out; });
  }
  function appSpecs(fresh) {
    var b = bridge();
    if (!b) return null;
    try {
      var parsed = JSON.parse(b.specs(!!fresh) || "{}");
      return parsed && parsed.v ? parsed : null;
    } catch (err) { return null; }
  }
  /* The app's answers win; the browser fills anything the app left out. */
  function merge(app, web) {
    if (!app) return web;
    var out = JSON.parse(JSON.stringify(app));
    Object.keys(web).forEach(function (k) {
      if (k === "source" || k === "v") return;
      if (!out[k] || typeof out[k] !== "object") { out[k] = web[k]; return; }
      Object.keys(obj(web[k])).forEach(function (kk) {
        var have = out[k][kk];
        if (have == null || have === "" || (Array.isArray(have) && !have.length && k !== "display")) out[k][kk] = web[k][kk];
      });
    });
    out.source = "app";
    return out;
  }
  function detect(fresh) {
    var app = appSpecs(fresh);
    return browserSpecs().then(function (web) {
      var specs = merge(app, web);
      specs.at = Date.now();
      return specs;
    }, function () { return app || { v: 1, source: "none", at: Date.now() }; });
  }

  // ---------- deciding ----------

  var WEAK_GPU = /Mali-4\d\d|Mali-T[67]\d\d|PowerVR SGX|PowerVR Rogue G6|Adreno \(TM\) 3\d\d|VideoCore IV|GC\d{3,4}\b|Vivante/i;
  var CODEC_ORDER = ["av1", "vp9", "hevc", "h264"];

  function tier(specs) {
    var mem = obj(specs.memory);
    var cpu = obj(specs.cpu);
    var gpu = String(obj(specs.gpu).renderer || "");
    var ram = num(mem.totalMb);
    var cores = num(cpu.cores);
    var weakGpu = WEAK_GPU.test(gpu);
    if (mem.lowRam || (ram && ram < 1600) || (cores && cores <= 2) || weakGpu) return "low";
    var fastCpu = !num(cpu.maxMhz) || num(cpu.maxMhz) >= 1800;
    if (ram >= 2800 && cores >= 4 && fastCpu) return "high";
    if (!ram && cores >= 8) return "high";
    return "mid";
  }
  function bestCodec(specs) {
    var c = obj(specs.codecs);
    for (var i = 0; i < CODEC_ORDER.length; i++) {
      var x = c[CODEC_ORDER[i]];
      if (x && x.hw && num(x.maxHeight) >= 1080) return CODEC_ORDER[i];
    }
    return c.h264 ? "h264" : "";
  }
  function decodeTop(specs) {
    var c = obj(specs.codecs);
    var top = 0;
    CODEC_ORDER.forEach(function (k) { var x = c[k]; if (x && (x.hw || k === "h264")) top = Math.max(top, num(x.maxHeight)); });
    return top;
  }
  function screenTop(specs) {
    var d = obj(specs.display);
    var h = num(d.maxHeight) || num(d.height);
    var w = num(d.maxWidth) || num(d.width);
    // A 4K panel that runs its UI at 1080p still reports its 4K modes.
    return Math.min(h || 0, w ? Math.round(w * 9 / 16) : h || 0) || h;
  }
  function stepDown(h) {
    var steps = [2160, 1440, 1080, 720, 480];
    for (var i = 0; i < steps.length; i++) if (h >= steps[i] - 40) return steps[i];
    return 480;
  }
  function videoCap(specs) {
    var top = Math.min(screenTop(specs) || 1080, decodeTop(specs) || 1080);
    var net = obj(specs.network);
    var down = num(net.downMbps);
    if (down && down < 4) top = Math.min(top, 720);
    else if (down && down < 12) top = Math.min(top, 1080);
    return stepDown(top);
  }
  function hdrOk(specs) {
    var d = obj(specs.display);
    if (!arr(d.hdr).length) return false;
    var c = obj(specs.codecs);
    return CODEC_ORDER.some(function (k) { return c[k] && c[k].hdr && (c[k].hw || specs.source !== "app"); }) || !!c.dolbyVision;
  }
  function frameOk(specs) {
    var d = obj(specs.display);
    var modes = arr(d.modes);
    var w = num(d.width), h = num(d.height);
    var rates = modes.filter(function (m) { return !w || (num(m.w) === w && num(m.h) === h); }).map(function (m) { return num(m.hz); });
    if (!rates.length) rates = arr(d.rates).map(num);
    var has = function (lo, hi) { return rates.some(function (r) { return r >= lo && r <= hi; }); };
    var film = has(23.9, 24.1) || has(47.9, 48.1);
    var pal = has(49.9, 50.1);
    var ntsc = has(59.9, 60.1);
    return (film || pal) && (ntsc || pal) && rates.length > 1;
  }
  function passOk(specs) {
    var p = arr(obj(specs.audio).passthrough);
    return p.some(function (e) { return /^(ac3|eac3|atmos|dts|dtshd|truehd)$/.test(e); });
  }
  function slowNet(specs) {
    var n = obj(specs.network);
    return (num(n.downMbps) && num(n.downMbps) < 4) || /^(slow-2g|2g|3g)$/.test(String(n.effective || "")) || n.saveData === true;
  }

  /* Every default tuning can set: where it lives, its factory default, and
     how to read and write it. "own" keys live in this module's state. */
  var ITEMS = [
    { key: "videoCap", label: "kVideoCap", where: "own", def: 0 },
    { key: "codec", label: "kCodec", where: "own", def: "" },
    { key: "hdr", label: "kHdr", where: "own", def: false, app: true },
    { key: "frameMatch", label: "kFrame", where: "own", def: false, app: true },
    { key: "passthrough", label: "kPass", where: "own", def: false, app: true },
    { key: "padHints", label: "kPad", where: "own", def: false },
    { key: "calm", label: "kCalm", where: "tv", def: true },
    { key: "flat", label: "kFlat", where: "tv", def: true },
    { key: "lightImages", label: "kLight", where: "tv", def: true },
    { key: "fewerPosts", label: "kFewer", where: "tv", def: true },
    { key: "lazyStart", label: "kLazy", where: "tv", def: true },
    { key: "autoplay", label: "kAuto", where: "tv", def: "off" },
    { key: "videoHd", label: "kHd", where: "app", def: true },
    { key: "imageSize", label: "kSize", where: "app", def: "auto" },
    { key: "preload", label: "kPreload", where: "app", def: "idle" },
    { key: "level", label: "kLevel", where: "device", def: "light" }
  ];
  var OWN_DEFAULTS = { videoCap: 0, codec: "", hdr: false, frameMatch: false, passthrough: false, padHints: false };

  /* The best value for each setting on this TV. Pure: specs in, values out. */
  function plan(specs) {
    specs = obj(specs);
    var level = tier(specs);
    var slow = slowNet(specs);
    var big = screenTop(specs) >= 2000;
    var free = num(obj(specs.storage).freeMb);
    var ram = num(obj(specs.memory).totalMb);
    var hasApp = specs.source === "app";
    var cap = videoCap(specs);
    var out = {
      videoCap: cap,
      codec: bestCodec(specs),
      hdr: hasApp && hdrOk(specs),
      frameMatch: hasApp && frameOk(specs),
      passthrough: hasApp && passOk(specs),
      padHints: num(obj(specs.input).gamepads) > 0,
      calm: level !== "high",
      flat: level !== "high",
      lightImages: level === "low" || (level === "mid" && !big && ram && ram < 2000) || slow,
      fewerPosts: level !== "high",
      lazyStart: level === "low",
      autoplay: level === "high" && !slow ? "muted" : "off",
      videoHd: cap >= 720 && !slow,
      imageSize: level === "low" || slow ? "small" : "auto",
      preload: level === "low" || slow ? "defer" : "idle",
      level: level === "low" || (free && free < 2048) ? "light" : (level === "high" || (free >= 4096 && ram >= 2000) ? "balanced" : "light")
    };
    out._tier = level;
    out._slow = slow;
    return out;
  }

  // ---------- reading and writing the real settings ----------

  function devRead() {
    var dev = root.ViktorychDevice;
    try { if (dev && dev.read) return obj(dev.read()); } catch (err) { /* fall back */ }
    try { return obj(JSON.parse(root.localStorage.getItem("viktorychapp-device-performance-v1") || "{}")); } catch (err) { return {}; }
  }
  function current(item, st) {
    if (item.where === "own") { var own = obj(st.own); return own[item.key] != null ? own[item.key] : OWN_DEFAULTS[item.key]; }
    if (item.where === "tv") { var b = boot(); return b ? b.prefs()[item.key] : item.def; }
    if (item.where === "app") {
      var s = root.ViktorychSetup;
      var v = s && s.get ? s.get(item.key) : undefined;
      if (v === undefined) return item.def;
      if (item.key === "videoHd") return v !== false;
      return v;
    }
    if (item.where === "device") { var d = devRead(); var l = String(d.level || d.profile || ""); return l === "lite" ? "light" : (l || "balanced"); }
    return undefined;
  }
  /* Untouched: still the factory default (never tuned) or still the value
     tuning wrote last time. Anything else was changed by hand. */
  function untouched(item, st) {
    var now = current(item, st);
    var applied = obj(st.applied);
    if (obj(st.user)[item.key]) return false;
    if (Object.prototype.hasOwnProperty.call(applied, item.key)) return same(now, applied[item.key]);
    if (item.where === "device") { var d = devRead(); return now === "light" && (d.tvDefault === true || !d.level); }
    return same(now, item.def);
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function setOne(item, value, st) {
    if (item.where === "own") { st.own = obj(st.own); st.own[item.key] = value; return; }
    if (item.where === "tv") { var b = boot(); if (b) b.setPref(item.key, value); return; }
    if (item.where === "app") {
      var s = root.ViktorychSetup;
      var patch = {};
      patch[item.key] = value;
      if (s && s.set) s.set(patch);
      else patchStored(patch);
      return;
    }
    if (item.where === "device") {
      var dev = root.ViktorychDevice;
      var prev = devRead();
      var next = dev && dev.applyLevel ? dev.applyLevel(value, prev) : Object.assign({}, prev, { level: value, profile: value === "light" ? "lite" : value });
      var shape = dev && dev.syncShape ? dev.syncShape(next) : next;
      try { root.localStorage.setItem("viktorychapp-device-performance-v1", JSON.stringify(shape)); } catch (err) { /* private mode */ }
      var s2 = root.ViktorychSetup;
      if (s2 && s2.set) s2.set({ devicePerf: next });
    }
  }
  function patchStored(patch) {
    try {
      var k = "viktorychapp-settings-v1";
      var cur = obj(JSON.parse(root.localStorage.getItem(k) || "{}"));
      Object.keys(patch).forEach(function (p) { cur[p] = patch[p]; });
      root.localStorage.setItem(k, JSON.stringify(cur));
    } catch (err) { /* private mode */ }
  }

  /* The rows for the summary: each setting, its new value, and whether it
     changes, stays (already right) or is kept (changed by hand). */
  function rows(specs, st) {
    var p = plan(specs);
    var hasApp = obj(specs).source === "app";
    return ITEMS.filter(function (item) { return !item.app || hasApp; }).map(function (item) {
      var now = current(item, st);
      var want = p[item.key];
      var mine = untouched(item, st);
      return { key: item.key, label: item.label, value: want, now: now, kept: !mine && !same(now, want), change: mine && !same(now, want) };
    });
  }

  function apply(specs, only) {
    var st = read();
    var list = rows(specs, st);
    st.applied = obj(st.applied);
    list.forEach(function (r) {
      if (r.kept) return;
      if (only && only[r.key] === false) return;
      var item = ITEMS.filter(function (i) { return i.key === r.key; })[0];
      if (r.change) setOne(item, r.value, st);
      st.applied[r.key] = r.value;
    });
    st.specs = specs;
    st.status = only ? "custom" : "applied";
    st.at = Date.now();
    write(st);
    syncNative();
    return list;
  }
  function finish(status, specs) {
    var st = read();
    // Skipping a re-detect keeps the earlier tuning; skipping the first run marks it seen.
    if (!(status === "skipped" && st.status)) st.status = status;
    if (specs && !st.specs) st.specs = specs;
    st.seen = Date.now();
    write(st);
  }

  // ---------- what the settings do ----------

  function own(key) {
    var st = read();
    var o = obj(st.own);
    return o[key] != null ? o[key] : OWN_DEFAULTS[key];
  }
  function tvOn() { var b = boot(); return !!(b && b.on); }
  /* Highest HLS level to play: under the max video quality and in a codec
     this TV decodes in hardware. app.js asks this in lockHlsTop. */
  function pickTop(levels) {
    levels = arr(levels);
    if (!tvOn() || !levels.length) return -1;
    var cap = num(own("videoCap"));
    var specs = obj(read().specs);
    var c = obj(specs.codecs);
    var pref = own("codec");
    var best = -1, bestH = -1, bestPref = false;
    levels.forEach(function (lv, i) {
      var h = num(lv && lv.height);
      if (cap && h && h > cap + 40) return;
      var codec = String((lv && (lv.videoCodec || (lv.attrs && lv.attrs.CODECS))) || "").toLowerCase();
      var kind = /av01/.test(codec) ? "av1" : (/vp09|vp9/.test(codec) ? "vp9" : (/hvc1|hev1/.test(codec) ? "hevc" : (codec ? "h264" : "")));
      if (kind && kind !== "h264" && specs.source === "app" && !(c[kind] && c[kind].hw)) return;
      var isPref = !!(pref && kind === pref);
      if (h > bestH || (h === bestH && isPref && !bestPref)) { best = i; bestH = h; bestPref = isPref; }
    });
    return best;
  }
  function maxHeight() { return tvOn() ? num(own("videoCap")) : 0; }

  function syncNative() {
    var b = root.ViktorychTVApp;
    if (!b || typeof b.setTune !== "function") return;
    try { b.setTune(!!own("frameMatch"), !!own("hdr"), !!own("passthrough"), !!own("padHints")); } catch (err) { /* older app */ }
  }

  /* Frame-rate matching: measure a big playing video's frame rate and ask
     the app to switch the TV to a matching mode; give it back when nothing
     plays. Small feed previews never switch the TV. */
  var STD_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
  function snapRate(fps) {
    var best = 0, err = 1e9;
    STD_RATES.forEach(function (r) { var e = Math.abs(r - fps); if (e < err) { err = e; best = r; } });
    return err <= 1.2 ? best : 0;
  }
  var fr = { video: null, timer: 0 };
  function bigVideo(v) {
    try {
      var r = v.getBoundingClientRect();
      return r.width >= (root.innerWidth || 0) * 0.6;
    } catch (err) { return false; }
  }
  function onPlaying(event) {
    var v = event.target;
    if (!v || v.tagName !== "VIDEO" || !own("frameMatch") || !bridge() || !bigVideo(v)) return;
    if (typeof v.requestVideoFrameCallback !== "function") return;
    clearTimeout(fr.timer);
    fr.video = v;
    var first = null;
    function cb(now, meta) {
      if (fr.video !== v || v.paused) return;
      if (!first) { first = meta; v.requestVideoFrameCallback(cb); return; }
      var dt = meta.mediaTime - first.mediaTime;
      var df = meta.presentedFrames - first.presentedFrames;
      if (dt < 1.5) { v.requestVideoFrameCallback(cb); return; }
      var fps = snapRate(df / dt);
      if (fps) { try { root.ViktorychTVApp.matchFrameRate(fps); } catch (err) { /* older app */ } }
    }
    v.requestVideoFrameCallback(cb);
  }
  function onStopped(event) {
    var v = event.target;
    if (!v || v.tagName !== "VIDEO" || fr.video !== v) return;
    clearTimeout(fr.timer);
    fr.timer = setTimeout(function () {
      if (fr.video && !fr.video.paused && !fr.video.ended) return;
      fr.video = null;
      var b = root.ViktorychTVApp;
      if (b && b.resetFrameRate) { try { b.resetFrameRate(); } catch (err) { /* older app */ } }
    }, 3000);
  }
  function onPad() {
    if (!tvOn() || !own("padHints")) return;
    toast(t("tipsPad"));
  }

  // ---------- the screens ----------

  var ui = { open: false, stage: "", specs: null, pick: {}, redetect: false, layer: null, done: null };

  function model(specs) {
    var d = obj(obj(specs).device);
    var m = String(d.model || "").trim();
    var maker = String(d.manufacturer || d.brand || "").trim();
    if (m && maker && m.toLowerCase().indexOf(maker.toLowerCase()) !== 0 && !/^(unknown|google)$/i.test(maker)) m = maker + " " + m;
    return m || t("yourTv");
  }
  function hz(v) { var n = num(v); return n ? (Math.round(n * 100) / 100) + " Hz" : ""; }
  function pxName(w, h) {
    if (!w || !h) return "";
    var tag = h >= 2100 ? " (4K)" : (h >= 1400 ? " (QHD)" : (h >= 1050 ? " (Full HD)" : (h >= 700 ? " (HD)" : "")));
    return w + "×" + h + tag;
  }
  var HDR_NAMES = { hdr10: "HDR10", hdr10plus: "HDR10+", hlg: "HLG", dolbyVision: "Dolby Vision", hdr: "HDR" };
  var CODEC_NAMES = { av1: "AV1", vp9: "VP9", hevc: "HEVC", h264: "H.264", dolbyVision: "Dolby Vision" };
  var AUDIO_NAMES = { ac3: "Dolby Digital", eac3: "Dolby Digital Plus", atmos: "Dolby Atmos", dts: "DTS", dtshd: "DTS-HD", truehd: "Dolby TrueHD", ac4: "AC-4" };
  var OUT_NAMES = { hdmi: "HDMI", arc: "HDMI ARC", earc: "HDMI eARC", speaker: "TV speakers", bluetooth: "Bluetooth", usb: "USB", headphones: "Headphones", line: "Line out" };
  var PLATFORM = { googletv: "Google TV", androidtv: "Android TV", firetv: "Fire TV", android: "Android" };
  function resName(h) { return h >= 2100 ? "4K" : (h ? h + "p" : ""); }

  /* What we found, as label/value lines. */
  function specLines(specs) {
    specs = obj(specs);
    var d = obj(specs.display), m = obj(specs.memory), c = obj(specs.cpu), g = obj(specs.gpu), s = obj(specs.storage);
    var a = obj(specs.audio), n = obj(specs.network), i = obj(specs.input), dev = obj(specs.device), cod = obj(specs.codecs);
    var lines = [];
    var rates = arr(d.rates).map(num).filter(Boolean);
    var disp = [pxName(num(d.width), num(d.height)), hz(d.refresh)].filter(Boolean).join(" · ");
    if (rates.length > 1) disp += " · " + rates.map(function (r) { return Math.round(r * 100) / 100; }).join("/") + " Hz";
    if (num(d.maxHeight) > num(d.height)) disp += " · " + t("modes", { n: arr(d.modes).length }) + ", " + pxName(num(d.maxWidth), num(d.maxHeight));
    lines.push([t("sDisplay"), disp || t("unknown")]);
    var hdr = arr(d.hdr).map(function (x) { return HDR_NAMES[x] || x; });
    lines.push([t("sHdr"), hdr.length ? hdr.join(", ") + (num(d.maxNits) ? " · " + Math.round(num(d.maxNits)) + " nits" : "") : t("none")]);
    if (d.wideColor != null) lines.push([t("sColor"), d.wideColor ? t("yes") : t("no")]);
    var vids = CODEC_ORDER.concat(["dolbyVision"]).filter(function (k) { return cod[k]; }).map(function (k) {
      var x = cod[k];
      var bits = [CODEC_NAMES[k]];
      if (num(x.maxHeight)) bits.push(resName(num(x.maxHeight)) + (num(x.maxFps) ? num(x.maxFps) : ""));
      if (x.hdr && k !== "dolbyVision") bits.push("HDR");
      return bits.join(" ") + (x.hw ? "" : " (sw)");
    });
    lines.push([t("sVideo"), vids.length ? vids.join(" · ") : t("unknown")]);
    var tunnel = CODEC_ORDER.some(function (k) { return cod[k] && cod[k].tunneled; });
    if (specs.source === "app") lines.push([t("sTunnel"), tunnel ? t("yes") : t("no")]);
    lines.push([t("sMemory"), num(m.totalMb) ? size(m.totalMb) + " RAM" + (m.lowRam ? " · " + t("lowRam") : "") : t("unknown")]);
    var cpu = [];
    if (num(c.cores)) cpu.push(t("cores", { n: num(c.cores) }));
    if (arr(c.abis).length) cpu.push(arr(c.abis)[0]);
    if (num(c.maxMhz)) cpu.push((Math.round(num(c.maxMhz) / 100) / 10) + " GHz");
    if (dev.soc) cpu.push(dev.soc);
    lines.push([t("sCpu"), cpu.join(" · ") || t("unknown")]);
    lines.push([t("sGpu"), g.renderer || t("unknown")]);
    lines.push([t("sStorage"), num(s.freeMb) ? t("free", { n: size(s.freeMb) }) + (num(s.totalMb) ? " / " + size(s.totalMb) : "") : t("unknown")]);
    var outs = arr(a.outputs).map(function (x) { return OUT_NAMES[x] || x; });
    var pass = arr(a.passthrough).map(function (x) { return AUDIO_NAMES[x] || x; });
    lines.push([t("sAudio"), (outs.join(", ") || t("unknown")) + (pass.length ? " · " + pass.join(", ") : "")]);
    var net = [];
    if (n.type) net.push(n.type === "wifi" ? "Wi-Fi" : (n.type === "ethernet" ? "Ethernet" : n.type));
    if (num(n.downMbps)) net.push("~" + Math.round(num(n.downMbps)) + " Mbps");
    lines.push([t("sNet"), net.join(" · ") || t("unknown")]);
    var inp = [t("pads", { n: num(i.gamepads) })];
    if (i.bluetooth) inp.push(t("bt"));
    lines.push([t("sInput"), inp.join(" · ")]);
    var sys = [PLATFORM[dev.platform] || "", dev.android ? "Android " + dev.android : "", dev.webview ? "WebView " + String(dev.webview).split(".")[0] : ""].filter(Boolean);
    lines.push([t("sSystem"), sys.join(" · ") || t("unknown")]);
    return lines;
  }
  function valueText(key, v) {
    if (key === "videoCap") return v ? resName(num(v)) : t("auto");
    if (key === "codec") return v ? CODEC_NAMES[v] || v : t("auto");
    if (key === "autoplay") return v === "muted" ? t("muted") : (v === "on" ? t("on") : t("off"));
    if (key === "imageSize") return v === "small" ? t("on") : t("off");
    if (key === "preload") return v === "defer" ? t("wait") : t("idle");
    if (key === "level") {
      var caps = { light: "256 MB", balanced: "1 GB", max: "5 GB" };
      return (v === "balanced" ? t("balanced") : (v === "max" ? "Max" : t("light"))) + " · " + t("cache", { n: caps[v] || caps.light });
    }
    return v ? t("on") : t("off");
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + "</svg>";
  }
  var TV_ICON = '<rect x="2.5" y="4.5" width="19" height="13" rx="2"/><path d="M8 20.5h8"/>';
  var CHECK = '<path d="m5 12.5 4.5 4.5L19 7.5"/>';

  function shell(o) {
    return '<div class="tvt-card" role="dialog" aria-modal="true" aria-labelledby="tvt-title" data-tvt-stage="' + esc(o.stage) + '">' +
      '<div class="tvt-head">' + (o.left || "<span></span>") + (o.right || "") + "</div>" +
      '<div class="tvt-body">' + '<span class="tvt-ico">' + icon(TV_ICON) + "</span>" +
      '<h1 id="tvt-title" tabindex="-1">' + esc(o.title) + "</h1>" + (o.sub ? '<p class="tvt-sub">' + esc(o.sub) + "</p>" : "") + (o.body || "") + "</div>" +
      '<div class="tvt-foot">' + (o.foot || "") + "</div></div>";
  }
  function btn(label, act, cls, extra) {
    return '<button type="button" class="' + (cls || "tvt-btn") + '" data-tvt="' + act + '"' + (extra || "") + ">" + esc(label) + "</button>";
  }
  function checkingHtml() {
    var steps = ["checkDisplay", "checkVideo", "checkAudio", "checkPower", "checkNet"];
    var body = '<ul class="tvt-checks">' + steps.map(function (k, i) {
      return '<li style="--i:' + i + '"><span class="tvt-spin" aria-hidden="true"></span><span>' + esc(t(k)) + "</span></li>";
    }).join("") + "</ul>";
    return shell({
      stage: "check",
      right: btn(t("skip"), "skip", "tvt-skip"),
      title: t("checkTitle"),
      sub: t("checkSub"),
      body: body,
      foot: btn(t("skipAll"), "skip-all", "tvt-link")
    });
  }
  function summaryHtml() {
    var specs = ui.specs;
    var st = read();
    // Changes first, then kept choices, then settings already right.
    var list = rows(specs, st).map(function (r, i) { r.i = i; return r; }).sort(function (a, b) {
      var w = function (r) { return r.change ? 0 : (r.kept ? 1 : 2); };
      return w(a) - w(b) || a.i - b.i;
    });
    var found = specLines(specs).map(function (l) { return "<tr><th>" + esc(l[0]) + "</th><td>" + esc(l[1]) + "</td></tr>"; }).join("");
    var picked = list.map(function (r) {
      var note = r.kept ? '<small class="tvt-kept">' + esc(t("kept")) + "</small>" : "";
      var val = r.kept ? valueText(r.key, r.now) : valueText(r.key, r.value);
      return '<tr class="' + (r.change ? "is-change" : "") + '"><th>' + esc(t(r.label)) + "</th><td>" + esc(val) + note + "</td></tr>";
    }).join("");
    var hint = obj(specs).source !== "app" ? '<p class="tvt-note">' + esc(t("whyApp")) + "</p>" : "";
    return shell({
      stage: "summary",
      left: ui.redetect ? "" : "",
      right: btn(t("skip"), "skip", "tvt-skip"),
      title: t("tunedTitle", { model: model(specs) }),
      sub: t("tunedSub"),
      body: '<div class="tvt-cols"><section><h2>' + esc(t("detected")) + '</h2><table class="tvt-table">' + found + "</table></section>" +
        "<section><h2>" + esc(t("chosen")) + '</h2><table class="tvt-table tvt-picked">' + picked + "</table>" + hint + "</section></div>",
      foot: btn(t("apply"), "apply", "tvt-btn", " data-tvt-first=\"1\"") + btn(t("customize"), "customize", "tvt-btn quiet") + btn(t("skipAll"), "skip-all", "tvt-link")
    });
  }
  function customHtml() {
    var list = rows(ui.specs, read());
    var opts = list.filter(function (r) { return r.change; }).map(function (r) {
      var on = ui.pick[r.key] !== false;
      return '<button type="button" class="tvt-opt' + (on ? " on" : "") + '" role="switch" aria-checked="' + (on ? "true" : "false") + '" data-tvt="pick" data-key="' + esc(r.key) + '"><span><b>' + esc(t(r.label)) + "</b><small>" + esc(valueText(r.key, r.now) + " → " + valueText(r.key, r.value)) + '</small></span><i aria-hidden="true">' + icon(CHECK) + "</i></button>";
    }).join("");
    return shell({
      stage: "custom",
      left: btn(t("back"), "back", "tvt-skip"),
      right: btn(t("skip"), "skip", "tvt-skip"),
      title: t("customTitle"),
      sub: opts ? t("customSub") : t("nothing"),
      body: '<div class="tvt-opts">' + opts + "</div>",
      foot: btn(t("applySel"), "apply-custom", "tvt-btn", " data-tvt-first=\"1\"") + btn(t("skipAll"), "skip-all", "tvt-link")
    });
  }

  function ensureCss() {
    var doc = root.document;
    if (doc.getElementById("tvt-css")) return;
    var link = doc.createElement("link");
    link.id = "tvt-css";
    link.rel = "stylesheet";
    link.href = "tv-tune.css";
    doc.head.appendChild(link);
  }
  function paint() {
    if (!ui.open) return;
    var doc = root.document;
    if (!ui.layer || !ui.layer.isConnected) {
      ui.layer = doc.createElement("div");
      ui.layer.id = "tv-tune-layer";
      ui.layer.addEventListener("click", onClick);
      doc.body.appendChild(ui.layer);
    }
    // Undo TV mode's page zoom so the summary fits the screen.
    var z = parseFloat(root.getComputedStyle(doc.body).zoom || "1") || 1;
    ui.layer.style.zoom = z && z !== 1 ? String(1 / z) : "";
    ui.layer.innerHTML = ui.stage === "check" ? checkingHtml() : (ui.stage === "custom" ? customHtml() : summaryHtml());
    doc.documentElement.setAttribute("data-tvt-open", "1");
    var first = ui.layer.querySelector("[data-tvt-first]") || ui.layer.querySelector("button");
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (err) { first.focus(); }
      var tv = root.FeedsTV;
      if (tv && tv.focus) { try { tv.focus(first); } catch (err) { /* older tv.js */ } }
    }
  }
  function close(message) {
    ui.open = false;
    if (ui.layer) { ui.layer.remove(); ui.layer = null; }
    root.document.documentElement.removeAttribute("data-tvt-open");
    if (message) toast(message);
    var done = ui.done;
    ui.done = null;
    if (done) { try { done(); } catch (err) { /* caller gone */ } }
    rerenderSettings();
  }
  function toast(text) {
    var doc = root.document;
    var el = doc.createElement("div");
    el.className = "tvt-toast";
    el.setAttribute("role", "status");
    el.textContent = text;
    doc.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  /* Opens the flow: the check screen while detecting, then the summary. */
  function open(opts) {
    opts = opts || {};
    if (ui.open || !root.document || !root.document.body) return;
    ensureCss();
    ui.open = true;
    ui.redetect = !!opts.redetect;
    ui.pick = {};
    ui.done = opts.done || null;
    ui.stage = "check";
    paint();
    var started = Date.now();
    detect(!!opts.redetect).then(function (specs) {
      ui.specs = specs;
      // Leave the check screen up long enough to read.
      var wait = Math.max(0, 1600 - (Date.now() - started));
      setTimeout(function () {
        if (!ui.open || ui.stage !== "check") return;
        ui.stage = "summary";
        paint();
      }, wait);
    });
  }
  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-tvt]") : null;
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    var act = el.getAttribute("data-tvt");
    if (act === "skip" || act === "skip-all") {
      finish("skipped", ui.specs);
      close("");
    } else if (act === "apply") {
      apply(ui.specs, null);
      close(t("appliedToast", { model: model(ui.specs) }));
    } else if (act === "customize") {
      ui.stage = "custom";
      paint();
    } else if (act === "back") {
      ui.stage = "summary";
      paint();
    } else if (act === "pick") {
      var k = el.getAttribute("data-key");
      ui.pick[k] = ui.pick[k] === false;
      paint();
      var again = ui.layer && ui.layer.querySelector('[data-tvt="pick"][data-key="' + k + '"]');
      if (again) { try { again.focus({ preventScroll: true }); } catch (err) { again.focus(); } if (root.FeedsTV && root.FeedsTV.focus) root.FeedsTV.focus(again); }
    } else if (act === "apply-custom") {
      apply(ui.specs, ui.pick);
      close(t("appliedToast", { model: model(ui.specs) }));
    }
  }
  /* The buttons sit under the lists; Up and Down scroll the lists while
     there is more to read, then move focus as usual. */
  function scrollBody(dir) {
    var body = ui.layer && ui.layer.querySelector(".tvt-body");
    var at = root.document.activeElement;
    if (!body || !at || !at.closest || !at.closest(".tvt-foot")) return false;
    var max = body.scrollHeight - body.clientHeight;
    if (max <= 2) return false;
    if (dir > 0 && body.scrollTop >= max - 2) return false;
    if (dir < 0 && body.scrollTop <= 2) return false;
    body.scrollTop = Math.max(0, Math.min(max, body.scrollTop + dir * body.clientHeight * 0.6));
    return true;
  }
  function isBack(e) {
    var k = e.key;
    return k === "GoBack" || k === "Escape" || k === "BrowserBack" || e.keyCode === 4 || e.keyCode === 10009 || e.keyCode === 461;
  }
  function onKey(e) {
    if (!ui.open) return;
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && scrollBody(e.key === "ArrowDown" ? 1 : -1)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      return;
    }
    if (!isBack(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (ui.stage === "custom") { ui.stage = "summary"; paint(); return; }
    finish("skipped", ui.specs);
    close("");
  }

  // ---------- Settings > TV ----------

  function settingsHtml() {
    var st = read();
    var specs = st.specs;
    var note = specs && st.status && st.status !== "skipped"
      ? t("setNote", { model: model(specs), date: new Date(st.at || Date.now()).toLocaleDateString(lang()) })
      : t("setNone");
    var rowsHtml = "";
    if (specs) {
      var list = ["videoCap", "codec", "hdr", "frameMatch", "passthrough", "padHints"].filter(function (k) {
        return specs.source === "app" || ["hdr", "frameMatch", "passthrough"].indexOf(k) < 0;
      });
      rowsHtml = '<div class="theme-row tv-prefs">' + list.map(function (k) {
        var v = own(k);
        var item = ITEMS.filter(function (i) { return i.key === k; })[0];
        if (k === "videoCap" || k === "codec") {
          return '<button class="outline" type="button" data-tvt-set="' + k + '">' + esc(t(item.label)) + ": " + esc(valueText(k, v)) + "</button>";
        }
        return '<button class="outline' + (v ? " on" : "") + '" type="button" data-tvt-set="' + k + '" aria-pressed="' + (v ? "true" : "false") + '">' + esc(t(item.label)) + "</button>";
      }).join("") + "</div>";
    }
    return '<div class="tvt-settings"><h2>' + esc(t("setTitle")) + '</h2><p class="tv-set-note">' + esc(note) + "</p>" + rowsHtml +
      '<div class="theme-row"><button class="outline" type="button" data-tvt-redetect="1">' + esc(t("redetect")) + "</button></div></div>";
  }
  function rerenderSettings() {
    var doc = root.document;
    if (!doc) return;
    var hosts = doc.querySelectorAll(".tvt-settings");
    for (var i = 0; i < hosts.length; i++) {
      var wrap = doc.createElement("div");
      wrap.innerHTML = settingsHtml();
      hosts[i].parentNode.replaceChild(wrap.firstChild, hosts[i]);
    }
  }
  var CAP_STEPS = [0, 480, 720, 1080, 1440, 2160];
  function onSettingsClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-tvt-set], [data-tvt-redetect]") : null;
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    if (el.hasAttribute("data-tvt-redetect")) { open({ redetect: true }); return; }
    var k = el.getAttribute("data-tvt-set");
    var st = read();
    st.own = obj(st.own);
    st.user = obj(st.user);
    var v = own(k);
    if (k === "videoCap") { var i = CAP_STEPS.indexOf(num(v)); v = CAP_STEPS[(i + 1) % CAP_STEPS.length]; }
    else if (k === "codec") { var order = [""].concat(CODEC_ORDER); var j = order.indexOf(v || ""); v = order[(j + 1) % order.length]; }
    else v = !v;
    st.own[k] = v;
    st.user[k] = true;
    write(st);
    syncNative();
    var keep = k;
    rerenderSettings();
    var again = root.document.querySelector('[data-tvt-set="' + keep + '"]');
    if (again) { try { again.focus({ preventScroll: true }); } catch (err) { again.focus(); } if (root.FeedsTV && root.FeedsTV.focus) root.FeedsTV.focus(again); }
  }

  // ---------- start ----------

  /* First open of the TV app: run the check once, before anything else. */
  function wantFirstRun() {
    var b = boot();
    if (!b || !b.on || !b.inApp()) return false;
    var st = read();
    return !st.status && !st.seen;
  }
  var started = false;
  function start() {
    if (started || !root.document) return;
    started = true;
    var doc = root.document;
    root.addEventListener("keydown", onKey, true);
    doc.addEventListener("click", onSettingsClick, true);
    doc.addEventListener("playing", onPlaying, true);
    doc.addEventListener("pause", onStopped, true);
    doc.addEventListener("ended", onStopped, true);
    doc.addEventListener("emptied", onStopped, true);
    root.addEventListener("gamepadconnected", onPad);
    syncNative();
    var go = function () { if (wantFirstRun()) setTimeout(function () { if (wantFirstRun()) open({}); }, 400); };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", go);
    else go();
  }

  return {
    KEY: KEY,
    ITEMS: ITEMS,
    STR: STR,
    start: start,
    open: open,
    close: close,
    detect: detect,
    browserSpecs: browserSpecs,
    merge: merge,
    plan: plan,
    tier: tier,
    videoCap: videoCap,
    frameOk: frameOk,
    hdrOk: hdrOk,
    rows: rows,
    apply: apply,
    untouched: untouched,
    specLines: specLines,
    pickTop: pickTop,
    maxHeight: maxHeight,
    settingsHtml: settingsHtml,
    read: read,
    write: write,
    snapRate: snapRate,
    isOpen: function () { return ui.open; },
    _ui: ui
  };
});
