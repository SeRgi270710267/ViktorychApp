/* First-time setup, in the style of a new phone: one step per screen.
   Loaded only when someone signs up (accounts.js injects it), so the first
   load of the app does not pay for it. Before the account exists it shows a
   welcome and the language; accounts.js then runs its own sign-up steps
   inside the same frame; after the account exists it continues with the
   profile picture, a few accounts to follow, data saver and theme, and a
   short celebration. Progress lives in localStorage, so a reload resumes
   the same step. Strings for this module live here in en, es, hi and ru. */
(function () {
  "use strict";
  var KEY = "viktorychapp-onboard-v1";
  var LANGS = ["en", "es", "hi", "ru"];
  var NATIVE = { en: "English", es: "Español", hi: "हिन्दी", ru: "Русский" };
  var HELLO = ["Hello", "Hola", "नमस्ते", "Привет"];
  /* Screen index across the whole flow: welcome, language, three account
     steps (owned by accounts.js), profile, follow, preferences, done. */
  var TOTAL = 9;
  var PRE = ["welcome", "language"];
  var POST = ["profile", "follow", "prefs", "done"];
  var STR = {
    en: {
      welcome: "Welcome to {app}",
      welcomeSub: "Let's get you set up. It takes about a minute.",
      start: "Get started",
      haveAccount: "I already have an account",
      tryTemp: "Try a temporary account",
      langTitle: "Choose your language",
      langSub: "You can change it any time in Settings.",
      suggested: "Suggested for this device",
      next: "Continue",
      back: "Back",
      skip: "Skip",
      close: "Close",
      step: "Step {n} of {total}",
      photoTitle: "Pick a profile picture",
      photoSub: "Have a favorite selfie? Add it now, or do it later.",
      photoAdd: "Upload a photo",
      photoChange: "Change photo",
      photoFail: "Could not use that photo. Try another one.",
      name: "Name",
      shape: "Picture shape",
      round: "Round",
      square: "Square",
      saving: "Saving…",
      saveLater: "Saved on this device. It will upload when you are back online.",
      followTitle: "Follow a few accounts",
      followSub: "They fill your timeline. You can follow more any time.",
      follow: "Follow",
      following: "Following",
      finding: "Finding accounts…",
      none: "Nothing to suggest yet. Explore has more later.",
      prefsTitle: "Make it yours",
      prefsSub: "Both can be changed later in Settings.",
      saver: "Save data",
      saverSub: "Uses as little mobile data as possible: smaller pictures, no autoplay.",
      theme: "Theme",
      themeDefault: "Default",
      themeDim: "Dim",
      themeDark: "Lights out",
      doneTitle: "You're all set!",
      doneSub: "Your timeline is ready.",
      doneBtn: "Go to your timeline",
      setup: "Set up your account"
    },
    es: {
      welcome: "Te damos la bienvenida a {app}",
      welcomeSub: "Vamos a prepararlo todo. Tarda alrededor de un minuto.",
      start: "Empezar",
      haveAccount: "Ya tengo una cuenta",
      tryTemp: "Probar una cuenta temporal",
      langTitle: "Elige tu idioma",
      langSub: "Puedes cambiarlo cuando quieras en Configuración.",
      suggested: "Sugerido para este dispositivo",
      next: "Continuar",
      back: "Atrás",
      skip: "Omitir",
      close: "Cerrar",
      step: "Paso {n} de {total}",
      photoTitle: "Elige una foto de perfil",
      photoSub: "¿Tienes un selfi favorito? Súbelo ahora o más tarde.",
      photoAdd: "Subir una foto",
      photoChange: "Cambiar foto",
      photoFail: "No se pudo usar esa foto. Prueba con otra.",
      name: "Nombre",
      shape: "Forma de la foto",
      round: "Redonda",
      square: "Cuadrada",
      saving: "Guardando…",
      saveLater: "Guardado en este dispositivo. Se subirá cuando vuelvas a tener conexión.",
      followTitle: "Sigue algunas cuentas",
      followSub: "Llenan tu cronología. Puedes seguir más cuando quieras.",
      follow: "Seguir",
      following: "Siguiendo",
      finding: "Buscando cuentas…",
      none: "Aún no hay sugerencias. Explorar tendrá más después.",
      prefsTitle: "Hazlo tuyo",
      prefsSub: "Puedes cambiar ambos después en Configuración.",
      saver: "Ahorrar datos",
      saverSub: "Usa los menos datos móviles posibles: imágenes más pequeñas y sin reproducción automática.",
      theme: "Tema",
      themeDefault: "Predeterminado",
      themeDim: "Atenuado",
      themeDark: "Sin luz",
      doneTitle: "¡Todo listo!",
      doneSub: "Tu cronología está lista.",
      doneBtn: "Ir a tu cronología",
      setup: "Configura tu cuenta"
    },
    hi: {
      welcome: "{app} में आपका स्वागत है",
      welcomeSub: "चलिए सब कुछ तैयार करते हैं। इसमें लगभग एक मिनट लगेगा।",
      start: "शुरू करें",
      haveAccount: "मेरा पहले से खाता है",
      tryTemp: "अस्थायी खाता आज़माएँ",
      langTitle: "अपनी भाषा चुनें",
      langSub: "आप इसे कभी भी सेटिंग्स में बदल सकते हैं।",
      suggested: "इस डिवाइस के लिए सुझाई गई",
      next: "जारी रखें",
      back: "वापस",
      skip: "छोड़ें",
      close: "बंद करें",
      step: "चरण {n} / {total}",
      photoTitle: "प्रोफ़ाइल फ़ोटो चुनें",
      photoSub: "कोई पसंदीदा सेल्फ़ी है? अभी जोड़ें, या बाद में।",
      photoAdd: "फ़ोटो अपलोड करें",
      photoChange: "फ़ोटो बदलें",
      photoFail: "यह फ़ोटो इस्तेमाल नहीं हो सकी। कोई दूसरी आज़माएँ।",
      name: "नाम",
      shape: "फ़ोटो का आकार",
      round: "गोल",
      square: "चौकोर",
      saving: "सहेजा जा रहा है…",
      saveLater: "इस डिवाइस पर सहेजा गया। इंटरनेट वापस आने पर अपलोड होगा।",
      followTitle: "कुछ खातों को फ़ॉलो करें",
      followSub: "इनसे आपकी टाइमलाइन भरती है। आप कभी भी और फ़ॉलो कर सकते हैं।",
      follow: "फ़ॉलो करें",
      following: "फ़ॉलो कर रहे हैं",
      finding: "खाते ढूँढे जा रहे हैं…",
      none: "अभी कोई सुझाव नहीं। एक्सप्लोर में बाद में और मिलेंगे।",
      prefsTitle: "इसे अपना बनाएँ",
      prefsSub: "दोनों को बाद में सेटिंग्स में बदला जा सकता है।",
      saver: "डेटा बचाएँ",
      saverSub: "जितना हो सके कम मोबाइल डेटा: छोटी तस्वीरें, कोई ऑटोप्ले नहीं।",
      theme: "थीम",
      themeDefault: "डिफ़ॉल्ट",
      themeDim: "मंद",
      themeDark: "पूरा अँधेरा",
      doneTitle: "सब तैयार है!",
      doneSub: "आपकी टाइमलाइन तैयार है।",
      doneBtn: "अपनी टाइमलाइन पर जाएँ",
      setup: "अपना खाता सेट करें"
    },
    ru: {
      welcome: "Добро пожаловать в {app}",
      welcomeSub: "Давайте всё настроим. Это займёт около минуты.",
      start: "Начать",
      haveAccount: "У меня уже есть аккаунт",
      tryTemp: "Попробовать временный аккаунт",
      langTitle: "Выберите язык",
      langSub: "Его можно сменить в любой момент в настройках.",
      suggested: "Подходит для этого устройства",
      next: "Продолжить",
      back: "Назад",
      skip: "Пропустить",
      close: "Закрыть",
      step: "Шаг {n} из {total}",
      photoTitle: "Выберите фото профиля",
      photoSub: "Есть любимое селфи? Добавьте сейчас или позже.",
      photoAdd: "Загрузить фото",
      photoChange: "Сменить фото",
      photoFail: "Не удалось использовать это фото. Попробуйте другое.",
      name: "Имя",
      shape: "Форма фото",
      round: "Круглая",
      square: "Квадратная",
      saving: "Сохранение…",
      saveLater: "Сохранено на этом устройстве. Загрузится, когда появится связь.",
      followTitle: "Подпишитесь на несколько аккаунтов",
      followSub: "Они наполнят вашу ленту. Подписаться на других можно в любой момент.",
      follow: "Читать",
      following: "Читаю",
      finding: "Ищем аккаунты…",
      none: "Пока нечего предложить. Больше будет в разделе «Обзор».",
      prefsTitle: "Настройте под себя",
      prefsSub: "Оба параметра можно изменить позже в настройках.",
      saver: "Экономия трафика",
      saverSub: "Как можно меньше мобильного трафика: картинки меньше, без автовоспроизведения.",
      theme: "Тема",
      themeDefault: "Светлая",
      themeDim: "Сумерки",
      themeDark: "Ночь",
      doneTitle: "Всё готово!",
      doneSub: "Ваша лента готова.",
      doneBtn: "Перейти в ленту",
      setup: "Настройте аккаунт"
    }
  };

  var state = { quiet: false, saver: null, focusStep: "", stage: "", step: 0, lang: "", open: false, dir: 1, photo: "", photoError: "", name: "", nameTouched: false, busy: false, note: "", follows: {}, waitTimer: 0, pendingProfile: null };
  var root = null;

  function readDoc() {
    try {
      var doc = JSON.parse(localStorage.getItem(KEY) || "null");
      return doc && typeof doc === "object" ? doc : null;
    } catch (err) { return null; }
  }
  function writeDoc(doc) {
    try {
      if (doc) localStorage.setItem(KEY, JSON.stringify(doc));
      else localStorage.removeItem(KEY);
    } catch (err) { /* private mode: the flow still runs for this page */ }
  }
  function save() {
    var doc = readDoc() || {};
    doc.stage = state.stage;
    doc.step = state.step;
    doc.lang = state.lang;
    doc.at = Date.now();
    writeDoc(doc);
  }
  function validLang(code) {
    code = String(code || "").toLowerCase().split("-")[0];
    return LANGS.indexOf(code) >= 0 ? code : "";
  }
  function detectLang() {
    var list = [];
    try { list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]; } catch (err) { list = []; }
    for (var i = 0; i < list.length; i++) {
      var code = validLang(list[i]);
      if (code) return code;
    }
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (/^Asia\/(Kolkata|Calcutta)$/.test(tz)) return "hi";
    } catch (err) { /* no time zone */ }
    var current = window.SI18n && window.SI18n.getLang ? validLang(window.SI18n.getLang()) : "";
    return current || "en";
  }
  function lang() {
    return validLang(state.lang) || validLang(window.SI18n && window.SI18n.getLang && window.SI18n.getLang()) || "en";
  }
  function t(key, vars) {
    var pack = STR[lang()] || STR.en;
    var text = pack[key] != null ? pack[key] : (STR.en[key] != null ? STR.en[key] : key);
    if (vars) text = text.replace(/\{(\w+)\}/g, function (m, name) { return vars[name] != null ? String(vars[name]) : m; });
    return text;
  }
  function appName() {
    return (window.SI18n && window.SI18n.productName && window.SI18n.productName("app")) || "ViktorychApp";
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (err) { return false; }
  }
  function accounts() { return window.ViktorychAccounts || null; }
  function setup() { return window.ViktorychSetup || null; }
  function mark() {
    var marks = window.ViktorychMarks || {};
    var icon = marks.mark || { box: "0 0 24 24", body: "" };
    return '<svg class="onb-mark" viewBox="' + icon.box + '" fill="currentColor" aria-hidden="true">' + icon.body + "</svg>";
  }
  var BACK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10.6 12 4.8 6.2l1.4-1.4L12 10.6l5.8-5.8 1.4 1.4L13.4 12l5.8 5.8-1.4 1.4L12 13.4l-5.8 5.8-1.4-1.4L10.6 12z"/></svg>';
  var CAMERA = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9.4 6.4 8.1 8H5.5A1.5 1.5 0 0 0 4 9.5v8A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8h-2.6l-1.3-1.6H9.4zm2.6 10.1a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5z"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9 20.42 2.79 14.21l2.83-2.83L9 14.77l9.88-9.89 2.83 2.83L9 20.42z"/></svg>';
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/></svg>';

  /* The thin segmented bar at the top. accounts.js uses it for its steps too. */
  function progressHtml(index) {
    var n = Math.max(1, Math.min(TOTAL - 1, Number(index) || 1));
    var segs = "";
    for (var i = 1; i < TOTAL - 1; i++) segs += '<i class="' + (i < n ? "done" : i === n ? "now" : "") + '"></i>';
    return '<div class="onb-progress" role="progressbar" aria-valuemin="1" aria-valuemax="' + (TOTAL - 2) + '" aria-valuenow="' + n + '" aria-label="' + esc(t("step", { n: n, total: TOTAL - 2 })) + '">' + segs + "</div>";
  }
  function screenIndex() {
    if (state.stage === "pre") return state.step;
    return 5 + state.step;
  }
  function stepName() {
    return state.stage === "pre" ? PRE[state.step] : POST[state.step];
  }

  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    root.id = "onb-layer";
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("keydown", onKey);
    return root;
  }
  function frame(inner, opts) {
    opts = opts || {};
    var head = '<div class="onb-head">' +
      (opts.back ? '<button class="onb-icon" type="button" data-onb="back" aria-label="' + esc(t("back")) + '">' + BACK + "</button>" : opts.close ? '<button class="onb-icon" type="button" data-onb="close" aria-label="' + esc(t("close")) + '">' + CLOSE + "</button>" : "<span></span>") +
      '<div class="onb-logo">' + mark() + "</div>" +
      (opts.skip ? '<button class="onb-skip" type="button" data-onb="skip">' + esc(t("skip")) + "</button>" : "<span></span>") +
      "</div>" + (opts.progress ? progressHtml(screenIndex()) : "");
    var anim = state.quiet || reducedMotion() ? "" : (state.dir < 0 ? " onb-in-back" : " onb-in");
    return '<div class="onb-back"><div class="onb-card" role="dialog" aria-modal="true" aria-label="' + esc(opts.label || t("setup")) + '" data-step="' + esc(stepName()) + '">' + head +
      '<div class="onb-screen' + anim + '">' + inner + "</div></div></div>";
  }
  function primary(label, act, disabled) {
    return '<button class="onb-primary" type="button" data-onb="' + act + '"' + (disabled ? " disabled" : "") + (state.busy ? ' aria-busy="true"' : "") + ">" + esc(label) + "</button>";
  }

  function welcomeHtml() {
    var words = HELLO.map(function (w, i) { return '<span style="--i:' + i + '"' + (i ? ' aria-hidden="true"' : "") + ">" + esc(w) + "</span>"; }).join("");
    return frame('<div class="onb-main onb-center"><div class="onb-hello" aria-live="off">' + words + '</div><h1 class="onb-title">' + esc(t("welcome", { app: appName() })) + '</h1><p class="onb-sub">' + esc(t("welcomeSub")) + '</p></div><div class="onb-foot">' + primary(t("start"), "next") + '<button class="onb-quiet" type="button" data-onb="login">' + esc(t("haveAccount")) + '</button>' + (accounts() && accounts().openTemp ? '<button class="onb-quiet onb-temp" type="button" data-onb="temp">' + esc(t("tryTemp")) + "</button>" : "") + "</div>", { close: true, label: t("welcome", { app: appName() }) });
  }
  function languageHtml() {
    var picked = lang();
    var guess = detectLang();
    var rows = LANGS.map(function (code) {
      var on = code === picked;
      return '<button class="onb-option' + (on ? " on" : "") + '" type="button" role="radio" aria-checked="' + (on ? "true" : "false") + '" data-onb="lang" data-lang="' + code + '" lang="' + code + '"><span class="onb-option-text"><b>' + esc(NATIVE[code]) + "</b>" + (code === guess ? "<small>" + esc(t("suggested")) + "</small>" : "") + '</span><span class="onb-radio" aria-hidden="true"></span></button>';
    }).join("");
    return frame('<div class="onb-main"><h1 class="onb-title">' + esc(t("langTitle")) + '</h1><p class="onb-sub">' + esc(t("langSub")) + '</p><div class="onb-options" role="radiogroup" aria-label="' + esc(t("langTitle")) + '">' + rows + '</div></div><div class="onb-foot">' + primary(t("next"), "next") + "</div>", { back: true, progress: true, label: t("langTitle") });
  }
  function shapeNow() {
    var api = setup();
    var v = api && api.get ? api.get("avatarShape") : "";
    return v === "square" ? "square" : "round";
  }
  function profileHtml() {
    var account = accounts() && accounts().account ? accounts().account() : null;
    if (!state.nameTouched) state.name = account && account.displayName ? account.displayName : state.name;
    var shape = shapeNow();
    var face = state.photo ? '<img alt="" src="' + esc(state.photo) + '">' : (account && account.avatar && /^https:|^data:image\//.test(account.avatar) ? '<img alt="" src="' + esc(account.avatar) + '">' : '<span class="onb-silhouette">' + PERSON + "</span>");
    function shapeBtn(mode, label) {
      return '<button class="onb-seg' + (shape === mode ? " on" : "") + '" type="button" role="radio" aria-checked="' + (shape === mode ? "true" : "false") + '" data-onb="shape" data-mode="' + mode + '"><span class="onb-seg-ico ' + mode + '" aria-hidden="true"></span>' + esc(label) + "</button>";
    }
    var note = state.photoError ? '<p class="onb-error" role="alert">' + esc(state.photoError) + "</p>" : (state.note ? '<p class="onb-note" role="status">' + esc(state.note) + "</p>" : "");
    return frame('<div class="onb-main"><h1 class="onb-title">' + esc(t("photoTitle")) + '</h1><p class="onb-sub">' + esc(t("photoSub")) + '</p>' +
      '<div class="onb-ava-wrap"><label class="onb-ava ' + shape + '"><input class="onb-file" type="file" accept="image/*" data-onb-file aria-label="' + esc(state.photo ? t("photoChange") : t("photoAdd")) + '">' + face + '<span class="onb-cam">' + CAMERA + "</span></label></div>" +
      '<div class="onb-segs" role="radiogroup" aria-label="' + esc(t("shape")) + '">' + shapeBtn("round", t("round")) + shapeBtn("square", t("square")) + "</div>" +
      '<label class="onb-field"><span>' + esc(t("name")) + '</span><input type="text" name="onbName" maxlength="50" autocomplete="name" autocapitalize="words" enterkeyhint="next" value="' + esc(state.name || "") + '"></label>' + note +
      '</div><div class="onb-foot">' + primary(state.busy ? t("saving") : t("next"), "next", state.busy) + "</div>", { skip: true, progress: true, label: t("photoTitle") });
  }
  function followRows() {
    var api = setup();
    var list = api && api.suggestions ? api.suggestions(8) : [];
    /* Keep accounts followed on this screen in the list after the tap. */
    Object.keys(state.follows).forEach(function (id) {
      if (!list.some(function (f) { return f.id === id; }) && state.follows[id]) list.push(state.follows[id]);
    });
    return list;
  }
  function followHtml() {
    var api = setup();
    var list = followRows();
    var ready = !!(api && api.ready && api.ready());
    var body;
    if (!list.length) {
      body = '<p class="onb-note" role="status">' + esc(ready ? t("none") : t("finding")) + "</p>" + (ready ? "" : '<div class="onb-skel"><i></i><i></i><i></i></div>');
      if (!ready) waitForData();
    } else {
      body = '<ul class="onb-people">' + list.map(function (f) {
        var on = !!(state.follows[f.id] || (api.isFollowed && api.isFollowed(f.id)));
        var letter = String(f.name || f.handle || "?").trim().charAt(0).toUpperCase() || "?";
        var pic = f.avatar ? '<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(f.avatar) + '">' : "<span>" + esc(letter) + "</span>";
        return '<li class="onb-person"><span class="onb-pic">' + pic + '</span><span class="onb-who"><b>' + esc(f.name || f.handle) + "</b><small>" + (f.handle ? "@" + esc(f.handle) : "") + (f.platform ? " · " + esc(f.platform) : "") + '</small></span><button class="onb-follow' + (on ? " on" : "") + '" type="button" data-onb="follow" data-id="' + esc(f.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(on ? t("following") : t("follow")) + "</button></li>";
      }).join("") + "</ul>";
    }
    return frame('<div class="onb-main"><h1 class="onb-title">' + esc(t("followTitle")) + '</h1><p class="onb-sub">' + esc(t("followSub")) + "</p>" + body + '</div><div class="onb-foot">' + primary(t("next"), "next") + "</div>", { back: true, skip: true, progress: true, label: t("followTitle") });
  }
  function saverOn() {
    var saver = window.ViktorychDataSaver;
    if (state.saver != null) return state.saver;
    if (saver && saver.isOn && saver.isOn()) return true;
    if (saver && saver.detect) {
      try { return !!saver.detect().on; } catch (err) { /* fall through */ }
    }
    var api = setup();
    if (api && api.get && (api.get("saveData") === true || api.get("dataSaver") === true)) return true;
    try {
      var c = navigator.connection;
      if (c && (c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g")) return true;
    } catch (err) { /* no connection info */ }
    return false;
  }
  /* Themes come from window.ViktorychThemes: the three base looks plus any
     flag themes (for example Russia). Without it, only the base three. */
  function themes() {
    var T = window.ViktorychThemes;
    return T && T.base ? T : { base: { default: 1, dim: 1, lightsout: 1 }, flags: {} };
  }
  function knownTheme(mode) {
    var T = themes();
    return !!(mode && ((T.base && T.base[mode]) || (T.flags && T.flags[mode])));
  }
  function themeLabel(id) {
    if (id === "default") return t("themeDefault");
    if (id === "dim") return t("themeDim");
    if (id === "lightsout") return t("themeDark");
    var f = themes().flags[id] || {};
    var name = f.name || id;
    return typeof window.t === "function" ? window.t(name) : name;
  }
  function themeNow() {
    var mode = document.documentElement.getAttribute("data-theme") || "lightsout";
    return knownTheme(mode) ? mode : "lightsout";
  }
  function prefsHtml() {
    var on = saverOn();
    var theme = themeNow();
    function themeBtn(mode, label) {
      var flag = themes().flags[mode];
      var swatch = flag && flag.flag ? '<span class="onb-theme-swatch onb-theme-flag" aria-hidden="true" style="background:linear-gradient(' + flag.flag.map(function (c, i, all) { var a = Math.round(i * 100 / all.length), b = Math.round((i + 1) * 100 / all.length); return esc(c) + " " + a + "% " + b + "%"; }).join(", ") + ')"></span>' : '<span class="onb-theme-swatch" aria-hidden="true"><i></i><i></i></span>';
      return '<button class="onb-theme t-' + esc(mode) + (theme === mode ? " on" : "") + '" type="button" role="radio" aria-checked="' + (theme === mode ? "true" : "false") + '" data-onb="theme" data-mode="' + esc(mode) + '">' + swatch + esc(label) + "</button>";
    }
    return frame('<div class="onb-main"><h1 class="onb-title">' + esc(t("prefsTitle")) + '</h1><p class="onb-sub">' + esc(t("prefsSub")) + "</p>" +
      '<div class="onb-row"><span class="onb-row-text"><b>' + esc(t("saver")) + "</b><small>" + esc(t("saverSub")) + '</small></span><button class="onb-switch' + (on ? " on" : "") + '" type="button" role="switch" aria-checked="' + (on ? "true" : "false") + '" aria-label="' + esc(t("saver")) + '" data-onb="saver"><i></i></button></div>' +
      '<h2 class="onb-h2">' + esc(t("theme")) + '</h2><div class="onb-themes" role="radiogroup" aria-label="' + esc(t("theme")) + '">' + ["default", "dim", "lightsout"].concat(Object.keys(themes().flags || {})).map(function (id) { return themeBtn(id, themeLabel(id)); }).join("") + "</div>" +
      '</div><div class="onb-foot">' + primary(t("next"), "next") + "</div>", { back: true, skip: true, progress: true, label: t("prefsTitle") });
  }
  function confetti() {
    if (reducedMotion()) return "";
    var colors = ["#1d9bf0", "#f91880", "#00ba7c", "#ffd400", "#7856ff", "#ff7a00"];
    var out = "";
    for (var i = 0; i < 36; i++) {
      var x = Math.round(Math.random() * 100);
      var d = (Math.random() * 0.6).toFixed(2);
      var r = Math.round(Math.random() * 360);
      var s = (0.7 + Math.random() * 0.8).toFixed(2);
      out += '<i style="--x:' + x + "%;--d:" + d + "s;--r:" + r + "deg;--s:" + s + ";--c:" + colors[i % colors.length] + '"></i>';
    }
    return '<div class="onb-confetti" aria-hidden="true">' + out + "</div>";
  }
  function doneHtml() {
    return frame(confetti() + '<div class="onb-main onb-center"><div class="onb-done-badge" aria-hidden="true">' + CHECK + '</div><h1 class="onb-title">' + esc(t("doneTitle")) + '</h1><p class="onb-sub">' + esc(t("doneSub")) + '</p></div><div class="onb-foot">' + primary(t("doneBtn"), "finish") + "</div>", { label: t("doneTitle") });
  }

  function paint() {
    if (!state.open) return;
    var el = ensureRoot();
    var name = stepName();
    var html = name === "welcome" ? welcomeHtml() : name === "language" ? languageHtml() : name === "profile" ? profileHtml() : name === "follow" ? followHtml() : name === "prefs" ? prefsHtml() : doneHtml();
    var active = document.activeElement;
    var keep = "";
    if (active && el.contains(active)) {
      if (active.name) keep = '[name="' + String(active.name).replace(/[^A-Za-z]/g, "") + '"]';
      else if (active.getAttribute("data-onb")) {
        keep = '[data-onb="' + active.getAttribute("data-onb").replace(/[^a-z-]/g, "") + '"]';
        ["data-lang", "data-mode", "data-id"].forEach(function (attr) {
          var v = active.getAttribute(attr);
          if (v) keep += "[" + attr + '="' + String(v).replace(/["\\]/g, "") + '"]';
        });
      }
    }
    var caret = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    el.innerHTML = html;
    document.documentElement.setAttribute("data-onb-open", "1");
    var target = null;
    if (keep && state.focusStep === name) { try { target = el.querySelector(keep); } catch (err) { target = null; } }
    if (!target && state.focusStep !== name) target = el.querySelector(".onb-main input[type=text]") || el.querySelector(".onb-primary");
    state.focusStep = name;
    if (target && target.focus) {
      try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
      if (caret != null && target.setSelectionRange) { try { target.setSelectionRange(caret, caret); } catch (err) { /* not a text field */ } }
    }
  }
  /* Rerender only the moving parts so the slide-in does not replay. */
  function repaintQuiet() {
    var screen = root && root.querySelector(".onb-screen");
    if (!screen) { paint(); return; }
    state.quiet = true;
    try { paint(); } finally { state.quiet = false; }
  }

  function go(stage, step, dir) {
    state.stage = stage;
    state.step = step;
    state.dir = dir || 1;
    state.note = "";
    state.photoError = "";
    save();
    paint();
  }
  function close(clear) {
    state.open = false;
    clearTimeout(state.waitTimer);
    if (clear) writeDoc(null);
    document.documentElement.removeAttribute("data-onb-open");
    if (root) root.innerHTML = "";
  }
  function toAccount() {
    state.stage = "account";
    state.step = 0;
    save();
    close(false);
    var api = accounts();
    if (api && api.openSignupSetup) api.openSignupSetup();
  }
  function applyLang(code) {
    state.lang = code;
    try {
      localStorage.setItem("viktorychapp-lang-user-picked", "1");
      if (window.SI18n && window.SI18n.setLang) window.SI18n.setLang(code);
      /* A language the page does not ship yet still sticks for later. */
      localStorage.setItem("superintelapp-lang", code);
    } catch (err) { /* this page still switches */ }
    save();
  }
  function waitForData() {
    clearTimeout(state.waitTimer);
    var tries = 0;
    function tick() {
      tries += 1;
      if (!state.open || stepName() !== "follow") return;
      var api = setup();
      if ((api && api.ready && api.ready()) || tries > 20) { repaintQuiet(); return; }
      state.waitTimer = setTimeout(tick, 600);
    }
    state.waitTimer = setTimeout(tick, 600);
  }

  /* Profile: square-crop the picked photo to 400px WebP under 60 KB, as the
     editor in accounts.js does, then PATCH name and picture. */
  function encode(canvas) {
    var quality = 0.82;
    return new Promise(function (resolve) {
      function step() {
        if (!canvas.toBlob) { resolve(null); return; }
        canvas.toBlob(function (blob) {
          if (!blob || blob.type !== "image/webp") { resolve(null); return; }
          if (blob.size <= 60 * 1024) resolve(blob);
          else if (quality <= 0.42) resolve(null);
          else { quality = Math.round((quality - 0.08) * 100) / 100; step(); }
        }, "image/webp", quality);
      }
      step();
    });
  }
  function readPhoto(file) {
    state.photoError = "";
    if (!file || !/^image\//.test(file.type || "") || file.size > 25 * 1024 * 1024) {
      state.photoError = t("photoFail");
      repaintQuiet();
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 400, 400);
      URL.revokeObjectURL(url);
      encode(canvas).then(function (blob) {
        if (!blob) { state.photoError = t("photoFail"); repaintQuiet(); return; }
        var reader = new FileReader();
        reader.onload = function () { state.photo = String(reader.result || ""); repaintQuiet(); };
        reader.onerror = function () { state.photoError = t("photoFail"); repaintQuiet(); };
        reader.readAsDataURL(blob);
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); state.photoError = t("photoFail"); repaintQuiet(); };
    img.src = url;
  }
  function sendProfile(body) {
    var api = accounts();
    var token = api && api.token ? api.token() : "";
    if (!api || !api.call || !token) return Promise.resolve(false);
    return api.call("/v1/profile", { method: "PATCH", token: token, body: body }).then(function (res) {
      if (!res || res.status !== 200 || !res.account) return false;
      if (api.saveOwnAccount) api.saveOwnAccount(res);
      return true;
    }).catch(function () { return false; });
  }
  function retryProfileLater(body) {
    state.pendingProfile = body;
    function again() {
      if (!state.pendingProfile) return;
      sendProfile(state.pendingProfile).then(function (ok) { if (ok) { state.pendingProfile = null; window.removeEventListener("online", again); } });
    }
    window.addEventListener("online", again);
  }
  function submitProfile() {
    var account = accounts() && accounts().account ? accounts().account() : null;
    var body = {};
    var name = String(state.name || "").trim();
    if (name && (!account || name !== account.displayName)) body.displayName = name;
    if (state.photo) { body.avatar = state.photo; body.avatarEmpty = "default"; }
    if (!Object.keys(body).length) { go("post", 1, 1); return; }
    state.busy = true;
    repaintQuiet();
    sendProfile(body).then(function (ok) {
      state.busy = false;
      if (!ok) {
        retryProfileLater(body);
        state.note = t("saveLater");
        repaintQuiet();
        setTimeout(function () { if (state.open && stepName() === "profile") go("post", 1, 1); }, 1400);
        return;
      }
      go("post", 1, 1);
    });
  }
  function setShape(mode) {
    var api = setup();
    if (api && api.set) api.set({ avatarShape: mode });
    if (mode === "square") document.documentElement.setAttribute("data-ava-shape", "square");
    else document.documentElement.removeAttribute("data-ava-shape");
  }
  function setTheme(mode) {
    var api = setup();
    if (api && api.set) api.set({ appearance: mode });
    else {
      var T = window.ViktorychThemes;
      if (T && T.apply) T.apply(mode);
      else document.documentElement.setAttribute("data-theme", mode);
      try {
        var raw = JSON.parse(localStorage.getItem("viktorychapp-settings-v1") || "{}") || {};
        raw.appearance = mode;
        localStorage.setItem("viktorychapp-settings-v1", JSON.stringify(raw));
      } catch (err) { /* the theme still shows on this page */ }
    }
  }
  function applySaver() {
    var on = saverOn();
    var saver = window.ViktorychDataSaver;
    if (saver && saver.apply) {
      var already = saver.isOn ? !!saver.isOn() : null;
      if (already !== on) { try { saver.apply(on); } catch (err) { /* settings still open */ } }
      return;
    }
    var api = setup();
    if (api && api.set) api.set({ saveData: on });
  }
  function finish() {
    close(true);
    var api = setup();
    if (api && api.done) api.done();
    try { if (location.hash && location.hash !== "#/") location.hash = "#/"; } catch (err) { /* already home */ }
  }

  function next() {
    var name = stepName();
    if (name === "welcome") { go("pre", 1, 1); return; }
    if (name === "language") { if (!state.lang) applyLang(lang()); toAccount(); return; }
    if (name === "profile") { submitProfile(); return; }
    if (name === "follow") { go("post", 2, 1); return; }
    if (name === "prefs") { applySaver(); go("post", 3, 1); return; }
    finish();
  }
  function skip() {
    var name = stepName();
    if (name === "language") { toAccount(); return; }
    if (name === "profile") { go("post", 1, 1); return; }
    if (name === "follow") { go("post", 2, 1); return; }
    if (name === "prefs") { go("post", 3, 1); return; }
    next();
  }
  function back() {
    if (state.stage === "pre" && state.step > 0) { go("pre", state.step - 1, -1); return; }
    if (state.stage === "post" && state.step > 1 && state.step < 3) { go("post", state.step - 1, -1); }
  }
  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-onb]") : null;
    if (!el || el.disabled) return;
    var act = el.getAttribute("data-onb");
    if (act === "next") next();
    else if (act === "skip") skip();
    else if (act === "back") back();
    else if (act === "finish") finish();
    else if (act === "close") close(true);
    else if (act === "temp") {
      close(true);
      var tapi = accounts();
      if (tapi && tapi.openTemp) tapi.openTemp();
    }
    else if (act === "login") {
      close(true);
      var api = accounts();
      if (api && api.openLogin) api.openLogin();
    } else if (act === "lang") {
      applyLang(el.getAttribute("data-lang") || "en");
      repaintQuiet();
    } else if (act === "shape") {
      setShape(el.getAttribute("data-mode") === "square" ? "square" : "round");
      repaintQuiet();
    } else if (act === "theme") {
      var mode = el.getAttribute("data-mode");
      setTheme(knownTheme(mode) ? mode : "lightsout");
      repaintQuiet();
    } else if (act === "saver") {
      state.saver = !saverOn();
      repaintQuiet();
    } else if (act === "follow") {
      var id = el.getAttribute("data-id") || "";
      var sapi = setup();
      if (!id || !sapi || !sapi.follow) return;
      var on = !(state.follows[id] || (sapi.isFollowed && sapi.isFollowed(id)));
      var row = followRows().filter(function (f) { return f.id === id; })[0] || { id: id };
      if (on) state.follows[id] = row; else delete state.follows[id];
      sapi.follow(id, on);
      repaintQuiet();
    }
  }
  function onInput(event) {
    var el = event.target;
    if (el && el.name === "onbName") { state.name = el.value; state.nameTouched = true; }
  }
  function onChange(event) {
    var el = event.target;
    if (el && el.hasAttribute && el.hasAttribute("data-onb-file")) readPhoto(el.files && el.files[0]);
  }
  function onKey(event) {
    if (event.key === "Enter" && event.target && event.target.name === "onbName") {
      event.preventDefault();
      next();
      return;
    }
    if (event.key === "Escape" && state.stage === "pre") { event.preventDefault(); close(true); return; }
    if (event.key !== "Tab") return;
    var card = root && root.querySelector(".onb-card");
    if (!card) return;
    var items = Array.prototype.filter.call(card.querySelectorAll("button, input, a[href]"), function (n) { return !n.disabled && n.tabIndex !== -1; });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function start(stage, step, dir) {
    var doc = readDoc() || {};
    state.lang = validLang(doc.lang) || state.lang || "";
    if (stage === "account") { toAccount(); return; }
    if (stage === "pre" && !state.lang) state.lang = detectLang();
    var max = stage === "pre" ? PRE.length - 1 : POST.length - 1;
    var n = Math.max(0, Math.min(max, Number(step) || 0));
    if (state.open && state.stage === stage && state.step === n) return;
    if (stage === "post") {
      var api = setup();
      if (api && api.skipWelcome) api.skipWelcome();
      if (state.lang && window.SI18n && window.SI18n.getLang && window.SI18n.getLang() !== state.lang && window.SI18n.setLang) {
        try { window.SI18n.setLang(state.lang); } catch (err) { /* keep the page language */ }
      }
    }
    state.open = true;
    state.focusStep = "";
    go(stage, n, dir || 1);
  }

  window.ViktorychOnboarding = {
    start: start,
    close: function () { close(true); },
    isOpen: function () { return state.open; },
    progressHtml: progressHtml,
    t: t,
    total: TOTAL
  };
})();
