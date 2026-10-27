/* Weather pills: no baked cities, fresh observations only. */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const doc = {
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById() { return null; },
  createElement() {
    return {
      style: {},
      classList: { add() {}, remove() {} },
      addEventListener() {},
      appendChild() {},
      setAttribute() {},
      getAttribute() { return null; }
    };
  }
};

const context = {
  console,
  URL,
  Date,
  Math,
  JSON,
  Promise,
  document: doc,
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  }
};
context.globalThis = context;
context.window = context;
context.self = context;
vm.createContext(context);

function loadScript(file) {
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/export\s*\{[\s\S]*?\};/, "");
  vm.runInContext(src, context);
}

loadScript("shared/pill-data.js");
assert.ok(context.PillData, "pill data is available to the page");
loadScript("scores.js");
loadScript("spaces.js");
loadScript("weather.js");

const W = context.WeatherPills;
const WL = context.WeatherPillsLogic;
assert.ok(W && WL, "weather.js exports the pill API");

assert.strictEqual(WL.getDefaultPlaces().length, 0, "no baked default cities");
assert.strictEqual(W.loadPlaces().length, 0, "an empty device shows no weather pill");
assert.strictEqual(W.getPlace("tula"), null, "Tula is not seeded");
assert.strictEqual(W.isPinned("weather:tula"), false, "Tula is not pinned by default");
assert.strictEqual(W.isPinned("soccer:arsenal-tula"), true, "followed clubs stay pinned");
assert.strictEqual(W.isPinned("soccer:fc-barcelona"), true, "Barcelona stays pinned");
assert.strictEqual(W.isPinned("space:superintelmusic"), true, "the radio pill stays pinned");

const now = Date.now();
const fresh = {
  kind: "weather",
  source: "open-meteo",
  updatedAt: now - 2 * 60 * 1000,
  temp: 14,
  code: 0,
  humidity: 70,
  wind: 12,
  feels: 12,
  precipChance: 20,
  precipMm: 0,
  uv: 1,
  tempMin: 8,
  tempMax: 15,
  hourly: [{ hour: "16:00", temp: 14, code: 0 }],
  daily: [{ date: "2026-10-27", dayLabel: "Today", min: 8, max: 15, code: 0 }]
};
const place = WL.rememberPlace({ id: "stockholm", name: "Stockholm", country: "Sweden", lat: 59.33, lon: 18.07, explicit: true }, fresh);
assert.ok(place, "a fresh observation is kept");
const html = W.renderPill(place, "C", true);
assert.ok(html.includes("wx-pill-stockholm"), "the chosen city is the pill");
assert.ok(html.includes("14°"), "Celsius is shown by default");
assert.ok(html.includes("pill-age"), "the pill carries an updated line");
assert.ok(html.includes("Updated"), "the age is readable");
assert.ok(html.includes("pill-pin-mark"), "a pinned pill is marked");
const fahrenheit = W.renderPill(place, "F", false);
assert.ok(fahrenheit.includes("57°"), "14 C is 57 F");
assert.ok(!fahrenheit.includes("pill-pin-mark"), "an unpinned pill has no pin mark");

const stale = Object.assign({}, place, { updatedAt: now - 20 * 60 * 1000, temp: 99 });
assert.strictEqual(W.renderPill(stale, "C", false), "", "a stale temperature is not painted");
WL.rememberPlace({ id: "old", name: "Old", country: "", lat: 1, lon: 1, explicit: true }, stale);
assert.strictEqual(W.getPlace("old"), null, "a stale saved place is hidden");

W.addPlace("Tokyo").then(function (added) {
  assert.strictEqual(added, null, "a failed lookup does not invent Tokyo weather");
  assert.strictEqual(W.getPlace("tokyo"), null, "Tokyo was not stored");
}).then(function () {
  W.setHidden("weather:stockholm", true);
  assert.ok(!W.unifiedRowHtml().includes("wx-pill-stockholm"), "a hidden weather pill leaves the row");
  W.setHidden("weather:stockholm", false);
  assert.ok(W.unifiedRowHtml().includes("wx-pill-stockholm"), "showing it paints it again");

  const live = context.PillData.bundleSports([{
    id: "1",
    league: "Spanish LALIGA",
    status: "live",
    kickoff: now - 30 * 60 * 1000,
    minute: "31'",
    home: "FC Barcelona",
    away: "Villarreal",
    homeScore: 1,
    awayScore: 0,
    venue: "",
    source: "espn"
  }], now);
  context.SoccerScoresLogic.applyBundle(live);
  assert.ok(W.unifiedRowHtml().includes("sc-pill-fc-barcelona"), "a fresh match still shares the row");
  W.setTypeDisabled("soccer", true);
  assert.ok(!W.unifiedRowHtml().includes("sc-pill-fc-barcelona"), "turning matches off removes them");
  W.setTypeDisabled("soccer", false);
  assert.ok(W.unifiedRowHtml().includes("sc-pill-fc-barcelona"), "turning matches on brings a fresh score back");

  W.togglePin("weather:stockholm");
  W.reorderPill("weather:stockholm", 1);
  assert.ok(W.loadPrefs().customOrder.includes("weather:stockholm"), "a real place can be reordered");

  W.setHidden("soccer:fc-barcelona", true);
  W.setTypeDisabled("weather", true);
  W.resetPrefs();
  assert.strictEqual(W.isPinned("weather:tula"), false, "reset does not restore a fake city");
  assert.strictEqual(W.isPinned("soccer:fc-barcelona"), true, "reset restores the followed clubs");
  assert.strictEqual(W.isHidden("soccer:fc-barcelona"), false, "reset clears hidden pills");
  assert.strictEqual(W.isTypeDisabled("weather"), false, "reset clears disabled categories");
  assert.ok(W.unifiedRowHtml().includes("sp-pill-manage-btn"), "the customize button stays");
  console.log("weather and pill pinning tests ok");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
