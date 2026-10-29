/* Settings search with an on-device assistant. Typed words are matched
   against every Settings page in the current language and in English,
   Spanish and Russian keywords. When the browser has a built-in model
   (Chrome or Edge Prompt API) and on-device AI is on, a question in plain
   words is also handed to that model to pick the best page. Nothing is
   sent to a server and no paid API is called. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychSettingsAssistant = api;
})(typeof self !== "undefined" ? self : this, function () {
  /* href, title key, subtitle key, keywords (en / es / ru). */
  var INDEX = [
    ["#/settings/accessibility", "Accessibility, display and languages", "Manage how {app} looks and which language it uses.", "accessibility look appearance accesibilidad apariencia доступность внешний вид"],
    ["#/settings/display", "Display", "", "theme dark light dim night mode font text size bigger smaller color accent autoplay video motion contrast tema oscuro claro modo noche fuente texto tamaño grande color video reproducción тема темная светлая ночной шрифт текст размер крупнее цвет видео автовоспроизведение"],
    ["#/settings/display/navigation", "Customize navigation", "Reorder and choose the icons in the bottom bar.", "bottom bar navigation icons tabs menu reorder barra inferior navegación iconos menú нижняя панель навигация иконки меню"],
    ["#/settings/device", "Device performance", "Choose how much this device does itself.", "performance battery speed ai on-device model offline rendimiento batería velocidad modelo производительность батарея скорость модель ии"],
    ["#/settings/languages", "Languages", "", "language translate translation idioma traducir traducción язык перевод переводить"],
    ["#/settings/display-language", "Display language", "", "interface language english spanish russian idioma interfaz inglés español ruso язык интерфейса английский испанский русский"],
    ["#/settings/data", "Data usage", "", "data saver mobile cellular wifi images video quality ahorro datos móviles calidad трафик экономия мобильные данные качество"],
    ["#/settings/notifications", "Notifications", "", "notifications alerts push sound badge notificaciones alertas avisos sonido уведомления оповещения звук пуш"],
    ["#/settings/notifications/discord", "Discord alerts", "Mentions and keywords from channels this app already shows.", "discord keywords channels canales palabras clave каналы ключевые слова"],
    ["#/settings/x-posting", "Post to X", "Direct posting stays off", "twitter x crosspost publish share publicar compartir публиковать твиттер"],
    ["#/settings/privacy", "Privacy and safety", "", "privacy safety block mute hide private audience visibility privacidad seguridad bloquear silenciar ocultar приватность безопасность блокировать скрыть"],
    ["#/settings/usernames", "Usernames", "Choose who sees which username, nicknames, and who can mention you.", "username handle nickname mention name apodo nombre de usuario mencionar никнейм имя пользователя упоминание прозвище"],
    ["#/settings/security", "Security", "Passkeys, app lock, and the privacy screen.", "password passkey lock pin face fingerprint encrypt protect contraseña bloqueo huella cifrar proteger пароль ключ доступа блокировка отпечаток шифрование защита"],
    ["#/settings/devices", "My devices", "Every device signed in to this account.", "devices sessions sign out logout phone computer dispositivos sesiones cerrar sesión устройства сеансы выйти телефон"],
    ["#/settings/storage", "Data and storage", "Storage usage", "storage space cache clear delete download offline almacenamiento espacio caché borrar хранилище место кэш очистить удалить"],
    ["#/settings/content", "Custom tabs", "Group accounts into tabs on Home and in Notifications.", "tabs groups lists home feed pestañas grupos listas inicio вкладки группы списки лента"],
    ["#/settings/network", "Digital Resistance & Proxy", "Manage bypass proxy, Telegram relay, and unblocked media mode.", "proxy vpn blocked censorship telegram relay bypass bloqueo censura прокси впн блокировка цензура обход"],
    ["#/settings/keys", "Connected keys", "Keys from your own accounts stay encrypted.", "api keys tokens connect claves conectar ключи токены подключить"],
    ["#/settings/resources", "Additional resources", "", "help about terms privacy policy version ayuda acerca términos помощь о приложении условия версия"]
  ];

  function fold(text) {
    var s = String(text == null ? "" : text).toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.replace(/ё/g, "е");
  }

  function words(text) {
    return fold(text).split(/[^a-z0-9\u0400-\u04ff]+/).filter(function (w) { return w.length > 1; });
  }

  var FILLER = "the a an to my me i how do can where is it make turn on off set change want please el la los las de mi mis como donde quiero poner cambiar por favor que un una как где мне мой моя хочу сделать включить выключить поменять пожалуйста".split(" ");

  function entries(tr) {
    var t = typeof tr === "function" ? tr : function (k) { return k; };
    return INDEX.map(function (row, i) {
      var title = t(row[1]);
      var sub = row[2] ? t(row[2], { app: "" }) : "";
      return { i: i, href: row[0], title: title, sub: sub, hay: words(title + " " + sub + " " + row[1] + " " + row[2] + " " + row[3]) };
    });
  }

  /* Best pages for the words typed, highest first. */
  function rank(query, tr, limit) {
    var q = words(query).filter(function (w) { return FILLER.indexOf(w) < 0; });
    if (!q.length) q = words(query);
    if (!q.length) return [];
    var list = entries(tr).map(function (row) {
      var score = 0;
      q.forEach(function (w) {
        var best = 0;
        row.hay.forEach(function (h) {
          if (h === w) best = Math.max(best, 3);
          else if (h.indexOf(w) === 0 || (w.length > 3 && w.indexOf(h) === 0 && h.length > 3)) best = Math.max(best, 2);
          else if (w.length > 3 && h.indexOf(w) > 0) best = Math.max(best, 1);
        });
        score += best;
      });
      var titleWords = words(row.title);
      if (q.every(function (w) { return titleWords.some(function (h) { return h.indexOf(w) === 0; }); })) score += 2;
      row.score = score;
      return row;
    }).filter(function (row) { return row.score > 0; });
    list.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    return list.slice(0, limit || 6);
  }

  function looksLikeQuestion(query) {
    return words(query).length >= 3;
  }

  function promptFn() {
    var g = typeof self !== "undefined" ? self : {};
    var LM = g.LanguageModel || (g.ai && g.ai.languageModel) || null;
    if (!LM || typeof LM.create !== "function") return null;
    return function (text) {
      return Promise.resolve(LM.create()).then(function (session) {
        return session.prompt(text).then(function (out) {
          try { if (session.destroy) session.destroy(); } catch (err) {}
          return out;
        });
      });
    };
  }

  function aiAllowed(device) {
    if (!device || typeof device.featureOn !== "function") return true;
    try {
      var settings = device.read ? device.read() : {};
      var signals = device.signals ? device.signals() : {};
      return !!device.featureOn(settings, "ai", signals);
    } catch (err) { return false; }
  }

  /* Ask the browser's own model which page fits. Resolves to an index into
     INDEX or -1 when there is no model, it is off, or the answer is unclear. */
  function ask(query, tr, opts) {
    opts = opts || {};
    var fn = opts.prompt || promptFn();
    var device = opts.device || (typeof self !== "undefined" ? self.ViktorychDevice : null);
    if (!fn || !looksLikeQuestion(query) || !aiAllowed(device)) return Promise.resolve(-1);
    var list = entries(tr);
    var text = "Pick the one settings page that answers the request. Reply with its number only.\n" +
      list.map(function (row, i) { return (i + 1) + ". " + row.title + (row.sub ? " (" + row.sub + ")" : ""); }).join("\n") +
      "\nRequest: " + String(query).slice(0, 300);
    var timer;
    var limit = new Promise(function (resolve) { timer = setTimeout(function () { resolve(""); }, opts.timeout || 6000); });
    return Promise.race([Promise.resolve().then(function () { return fn(text); }), limit]).then(function (out) {
      clearTimeout(timer);
      var m = String(out || "").match(/\d+/);
      var n = m ? parseInt(m[0], 10) - 1 : -1;
      return n >= 0 && n < list.length ? n : -1;
    }).catch(function () { clearTimeout(timer); return -1; });
  }

  return { INDEX: INDEX, rank: rank, ask: ask, looksLikeQuestion: looksLikeQuestion, available: function () { return !!promptFn(); } };
});
