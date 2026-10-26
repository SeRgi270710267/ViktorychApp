/* Weather Pills & Row Pinning test suite */
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

// Load SoccerScores first
vm.runInContext(fs.readFileSync("scores.js", "utf8"), context);
assert.ok(context.SoccerScores, "scores.js loaded");

// Load Spaces
vm.runInContext(fs.readFileSync("spaces.js", "utf8"), context);
assert.ok(context.Spaces, "spaces.js loaded");

// Load WeatherPills
vm.runInContext(fs.readFileSync("weather.js", "utf8"), context);
const W = context.WeatherPills;
const WL = context.WeatherPillsLogic;

assert.ok(W, "weather.js exports WeatherPills");
assert.ok(WL, "weather.js exports WeatherPillsLogic");

// 1. Test Default Places
const places = W.loadPlaces();
assert.ok(places.length >= 4, "Should have default places");
const placeIds = places.map((p) => p.id);
assert.ok(placeIds.includes("tula"), "Has Tula");
assert.ok(placeIds.includes("barcelona"), "Has Barcelona");
assert.ok(placeIds.includes("london"), "Has London");
assert.ok(placeIds.includes("new-york"), "Has New York");

// 2. Test Pill Rendering
const tula = W.getPlace("tula");
assert.ok(tula, "Tula found");
const pillHtml = W.renderPill(tula, "C", true);
assert.ok(pillHtml.includes("wx-pill-tula"), "Has Tula pill class");
assert.ok(pillHtml.includes("14°"), "Has 14° temperature");
assert.ok(pillHtml.includes("pill-pin-mark"), "Has pin badge when pinned");

// 3. Test Fahrenheit Formatting
const fahrenheitHtml = W.renderPill(tula, "F", false);
assert.ok(fahrenheitHtml.includes("57°"), "14°C converts to 57°F");
assert.ok(!fahrenheitHtml.includes("pill-pin-mark"), "No pin badge when unpinned");

// 4. Test Pinning Functionality
assert.strictEqual(W.isPinned("weather:tula"), true, "Tula is pinned by default");
assert.strictEqual(W.isPinned("soccer:arsenal-tula"), true, "Arsenal Tula is pinned by default");
assert.strictEqual(W.isPinned("soccer:fc-barcelona"), true, "FC Barcelona is pinned by default");
assert.strictEqual(W.isPinned("space:superintelmusic"), true, "Music Space is pinned by default");

// Toggle pin off
W.togglePin("weather:tula");
assert.strictEqual(W.isPinned("weather:tula"), false, "Tula can be unpinned");

// Toggle pin back on
W.togglePin("weather:tula");
assert.strictEqual(W.isPinned("weather:tula"), true, "Tula can be pinned again");

// 5. Test Adding Custom Place
W.addPlace("Tokyo");
const tokyo = W.getPlace("tokyo");
assert.ok(tokyo, "Tokyo was added as a custom place");
assert.strictEqual(tokyo.name, "Tokyo", "Tokyo has correct name");
assert.ok(tokyo.temp !== undefined, "Tokyo has temperature");
assert.strictEqual(W.isPinned("weather:tokyo"), true, "Newly added place is pinned by default");

// 6. Test Pill Reordering
W.reorderPill("weather:tokyo", 1);
const prefs = W.loadPrefs();
assert.ok(prefs.customOrder.includes("weather:tokyo"), "Custom order contains Tokyo");

// 7. Test Unified Row Construction
const rowHtml = W.unifiedRowHtml();
assert.ok(rowHtml.includes("sp-row-wrap"), "Unified row has sp-row-wrap container");
assert.ok(rowHtml.includes("sp-row"), "Unified row has sp-row list");
assert.ok(rowHtml.includes("wx-pill-tula"), "Row contains Tula weather pill");
assert.ok(rowHtml.includes("wx-pill-tokyo"), "Row contains Tokyo weather pill");
assert.ok(rowHtml.includes("sc-pill-arsenal-tula"), "Row contains Arsenal Tula soccer pill");
assert.ok(rowHtml.includes("sc-pill-fc-barcelona"), "Row contains FC Barcelona soccer pill");
assert.ok(rowHtml.includes("sp-pill-manage-btn"), "Row contains Manage/Customize Pills button");

// 8. Test Removing a Place
W.removePlace("tokyo");
assert.strictEqual(W.getPlace("tokyo"), null, "Tokyo was removed");
assert.strictEqual(W.isPinned("weather:tokyo"), false, "Tokyo is no longer pinned");

// 9. Test Hiding A Single Pill
W.setHidden("weather:tula", true);
assert.strictEqual(W.isHidden("weather:tula"), true, "Tula pill can be hidden");
let hiddenRow = W.unifiedRowHtml();
assert.ok(!hiddenRow.includes("wx-pill-tula"), "Hidden pill is not rendered in the row");
assert.ok(hiddenRow.includes("wx-pill-barcelona"), "Other weather pills still render");
assert.ok(hiddenRow.includes("sp-pill-manage-btn"), "Manage button stays so pills can be restored");
W.setHidden("weather:tula", false);
hiddenRow = W.unifiedRowHtml();
assert.ok(hiddenRow.includes("wx-pill-tula"), "Showing the pill again renders it");

// 10. Test Disabling A Pill Category
W.setTypeDisabled("soccer", true);
assert.strictEqual(W.isTypeDisabled("soccer"), true, "Match pills can be switched off");
let offRow = W.unifiedRowHtml();
assert.ok(!offRow.includes("sc-pill-arsenal-tula"), "Disabled match pills are not rendered");
assert.ok(offRow.includes("wx-pill-tula"), "Weather pills still render when matches are off");
W.setTypeDisabled("soccer", false);
offRow = W.unifiedRowHtml();
assert.ok(offRow.includes("sc-pill-arsenal-tula"), "Re-enabled match pills render again");

// 11. Test Reset Defaults
W.setHidden("soccer:arsenal-tula", true);
W.setTypeDisabled("weather", true);
W.resetPrefs();
assert.strictEqual(W.isPinned("weather:tula"), true, "Tula restored to pinned defaults");
assert.strictEqual(W.isPinned("soccer:fc-barcelona"), true, "Barca restored to pinned defaults");
assert.strictEqual(W.isHidden("soccer:arsenal-tula"), false, "Reset clears hidden pills");
assert.strictEqual(W.isTypeDisabled("weather"), false, "Reset clears disabled categories");

console.log("weather and pill pinning tests ok");
