import fs from "fs";
import vm from "vm";

const context = {
  console,
  Intl,
  document: {
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  sessionStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  },
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  },
  SI18n: {
    getLang: () => "en",
    locale: () => "en"
  },
  t: (k) => k,
  tn: (k, n) => String(n)
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("translate.js", "utf8"), context);
const FT = context.FeedsTranslate;

// 1. Normalization
if (FT.normalize("EN-us") !== "en") throw new Error("normalize EN-us");
if (FT.normalize("fr-FR") !== "fr") throw new Error("normalize fr-FR");
if (FT.normalize("ru-RU") !== "ru") throw new Error("normalize ru-RU");
if (FT.normalize("unknown") !== "en") throw new Error("normalize fallback");
if (FT.normalizeTarget("ui") !== "ui") throw new Error("normalizeTarget ui");
if (FT.normalizeTarget("es") !== "es") throw new Error("normalizeTarget es");

// 2. Language Detection
const ruText = "Новая запись в блоге про ленту и рекомендации для всех пользователей.";
const ukText = "Новий запис у блозі про стрічку та рекомендації для користувачів України.";
const frText = "Bonjour tout le monde! C'est une excellente nouvelle pour les utilisateurs.";
const enText = "This is a normal English sentence for the feed and you.";
const esText = "Hola a todos, esta es una publicación en español con información.";

if (FT._guess(ruText) !== "ru") throw new Error("guess ru failed: " + FT._guess(ruText));
if (FT._guess(ukText) !== "uk") throw new Error("guess uk failed: " + FT._guess(ukText));
if (FT._guess(frText) !== "fr") throw new Error("guess fr failed: " + FT._guess(frText));
if (FT._guess(esText) !== "es") throw new Error("guess es failed: " + FT._guess(esText));
if (FT._guess(enText) !== "en") throw new Error("guess en failed: " + FT._guess(enText));

// 3. Offer Logic with Target Language
let saved = false;
let rendered = false;
const mockState = {
  settings: { translateTo: "en", translateAuto: true, translateNever: [] },
  lang: {},
  translated: {},
  originalShown: {},
  translateFallback: {},
  translateText: {}
};
FT.bind({
  state: mockState,
  save: () => { saved = true; },
  render: () => { rendered = true; },
  esc: (s) => String(s)
});

if (FT.offer("ru1", ruText) !== true) throw new Error("ru post should offer translation to en");
if (FT.offer("fr1", frText) !== true) throw new Error("fr post should offer translation to en");
if (FT.offer("en1", enText) !== false) throw new Error("en post should not offer translation to en");

// Switch target to Russian
FT.setTarget("ru");
if (FT.offer("ru2", ruText) !== false) throw new Error("ru post should not offer translation to ru target");
if (FT.offer("en2", enText) !== true) throw new Error("en post should offer translation to ru target");
if (FT.offer("fr2", frText) !== true) throw new Error("fr post should offer translation to ru target");

// 4. Auto-Translate & Never-Translate Settings
FT.setTarget("en");
FT.toggleNever("ru");
if (!mockState.settings.translateNever.includes("ru")) throw new Error("toggleNever did not add ru");
FT.toggleNever("ru");
if (mockState.settings.translateNever.includes("ru")) throw new Error("toggleNever did not remove ru");

FT.addNever("ru");
if (!mockState.settings.translateNever.includes("ru")) throw new Error("addNever did not add ru");
FT.removeNever("ru");
if (mockState.settings.translateNever.includes("ru")) throw new Error("removeNever did not remove ru");

FT.toggleAuto();
if (mockState.settings.translateAuto !== false) throw new Error("toggleAuto did not turn off");
FT.toggleAuto();
if (mockState.settings.translateAuto !== true) throw new Error("toggleAuto did not turn on");

// 5. Settings HTML output
const html = FT.settingsHtml();
if (!html.includes("data-act=\"auto-translate-toggle\"")) throw new Error("settingsHtml missing auto-translate toggle");
if (!html.includes("id=\"translate-to\"")) throw new Error("settingsHtml missing translate-to select");
if (!html.includes("data-act=\"never-translate-toggle\"")) throw new Error("settingsHtml missing never-translate toggles");
if (!html.includes("Match app language")) throw new Error("settingsHtml missing Match app language");

// 6. Token shielding and restoration
const sample = "Visit https://google.com and follow @test #tag $AAPL today";
const shielded = FT._shield(sample);
if (shielded.text.includes("https://google.com") || !shielded.text.includes("[[0]]")) {
  throw new Error("shielding failed: " + shielded.text);
}
if (FT._restore(shielded.text, shielded.kept) !== sample) {
  throw new Error("restoration failed");
}

console.log("translate tests ok");
