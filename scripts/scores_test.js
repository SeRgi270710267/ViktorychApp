/* Soccer Scores test suite */
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
vm.runInContext(fs.readFileSync("scores.js", "utf8"), context);

const L = context.SoccerScoresLogic;
const S = context.SoccerScores;

assert.ok(L, "scores.js exports SoccerScoresLogic");
assert.ok(S, "scores.js exports SoccerScores");

const teams = L.loadTeams();
assert.strictEqual(teams.length, 4, "Should have 4 featured teams");

const teamIds = teams.map((t) => t.id);
assert.ok(teamIds.includes("arsenal-tula"), "Includes Arsenal Tula");
assert.ok(teamIds.includes("cska-moscow"), "Includes CSKA Moscow");
assert.ok(teamIds.includes("fc-barcelona"), "Includes FC Barcelona");
assert.ok(teamIds.includes("sabadell-ce"), "Includes CE Sabadell");

// Test pill rendering with updated October 2026 data
const tula = L.getTeam("arsenal-tula");
assert.ok(tula, "Arsenal Tula found");
assert.strictEqual(tula.isLive, true, "Arsenal Tula is playing live");
const tulaHtml = L.renderPill(tula);
assert.ok(tulaHtml.includes("sc-pill-arsenal-tula"), "Has Arsenal Tula pill color class");
assert.ok(tulaHtml.includes("is-live"), "Arsenal Tula has Live badge");
assert.ok(tulaHtml.includes("4 - 3"), "Displays live score 4 - 3 against KAMAZ");

const cska = L.getTeam("cska-moscow");
assert.ok(cska, "CSKA found");
assert.strictEqual(cska.isLive, true, "CSKA shows live derby against Spartak Moscow");
const cskaHtml = L.renderPill(cska);
assert.ok(cskaHtml.includes("sc-pill-cska-moscow"), "Has CSKA pill color class");
assert.ok(cskaHtml.includes("is-live"), "CSKA has live badge");
assert.ok(cskaHtml.includes("2 - 1"), "Displays live derby score 2 - 1");

const barca = L.getTeam("fc-barcelona");
assert.ok(barca, "FC Barcelona found");
assert.strictEqual(barca.isLive, true, "Barca is playing live El Clasico");
const barcaHtml = L.renderPill(barca);
assert.ok(barcaHtml.includes("sc-pill-fc-barcelona"), "Has FC Barcelona blaugrana pill class");
assert.ok(barcaHtml.includes("3 - 2"), "Displays Barca score against Real Madrid");

const sabadell = L.getTeam("sabadell-ce");
assert.ok(sabadell, "CE Sabadell found");
assert.strictEqual(sabadell.isLive, true, "Sabadell is live against Tenerife");
const sabadellHtml = L.renderPill(sabadell);
assert.ok(sabadellHtml.includes("sc-pill-sabadell-ce"), "Has Sabadell royal blue/white pill class");
assert.ok(sabadellHtml.includes("1 - 0"), "Displays Sabadell score against Tenerife");

// Test pillsHtml for unified row
const pills = S.pillsHtml();
assert.ok(pills.includes("sc-pill-arsenal-tula"), "Pills HTML has Arsenal Tula");
assert.ok(pills.includes("sc-pill-cska-moscow"), "Pills HTML has CSKA Moscow");
assert.ok(pills.includes("sc-pill-fc-barcelona"), "Pills HTML has FC Barcelona");
assert.ok(pills.includes("sc-pill-sabadell-ce"), "Pills HTML has CE Sabadell");

// Test homeRow
const rowHtml = S.homeRow();
assert.ok(rowHtml.includes("sp-row-wrap"), "Row has sp-row-wrap");
assert.ok(rowHtml.includes("sc-pill-arsenal-tula"), "Row contains Arsenal Tula pill");
assert.ok(rowHtml.includes("sc-pill-cska-moscow"), "Row contains CSKA Moscow pill");
assert.ok(rowHtml.includes("sc-pill-fc-barcelona"), "Row contains FC Barcelona pill");
assert.ok(rowHtml.includes("sc-pill-sabadell-ce"), "Row contains CE Sabadell pill");
assert.strictEqual(S.rowExtra(), 65, "rowExtra offset is 65px");

// Test unified Spaces + Soccer row
vm.runInContext(fs.readFileSync("spaces.js", "utf8"), context);
assert.ok(context.Spaces, "spaces.js exports Spaces");
const spacesRowHtml = context.Spaces.homeRow();
assert.ok(spacesRowHtml.includes("sp-row-wrap"), "Unified row has sp-row-wrap");
assert.ok(spacesRowHtml.includes("sc-pill-arsenal-tula"), "Unified row has Arsenal Tula");
assert.ok(spacesRowHtml.includes("sc-pill-cska-moscow"), "Unified row has CSKA Moscow");
assert.strictEqual(context.Spaces.rowExtra(), 65, "Spaces.rowExtra returns 65px for single unified row");

// Test Live toggle
S.toggleLive("cska-moscow");
assert.strictEqual(L.getTeam("cska-moscow").isLive, false, "CSKA can toggle to FT");
S.toggleLive("cska-moscow");
assert.strictEqual(L.getTeam("cska-moscow").isLive, true, "CSKA can toggle back to Live");

// Test Score updates
const activeData = tula.isLive ? tula.liveMatch : tula.latestResult;
const initialHome = activeData.homeScore;
S.updateScore("arsenal-tula", 1, 0);
assert.strictEqual((L.getTeam("arsenal-tula").isLive ? L.getTeam("arsenal-tula").liveMatch : L.getTeam("arsenal-tula").latestResult).homeScore, initialHome + 1, "Home score incremented");

// Test Goal Simulation
const initialEventsCount = ((L.getTeam("arsenal-tula").isLive ? L.getTeam("arsenal-tula").liveMatch : L.getTeam("arsenal-tula").latestResult).events || []).length;
S.simulateGoal("arsenal-tula");
assert.strictEqual(((L.getTeam("arsenal-tula").isLive ? L.getTeam("arsenal-tula").liveMatch : L.getTeam("arsenal-tula").latestResult).events || []).length, initialEventsCount + 1, "Event added to timeline");

// Test Reset Team
S.resetTeam("arsenal-tula");
const resetData = L.getTeam("arsenal-tula").isLive ? L.getTeam("arsenal-tula").liveMatch : L.getTeam("arsenal-tula").latestResult;
assert.strictEqual(resetData.homeScore, 4, "Arsenal Tula home score reset to updated default");
assert.strictEqual(resetData.awayScore, 3, "Arsenal Tula away score reset to updated default");

// Test single unified row guarantee: Spaces pill + Soccer pills inside ONE .sp-row
context.Spaces.homePillsHtml = function() {
  return '<div class="sp-row-item" role="listitem"><a class="sp-pill" href="#/spaces/live"><span class="sp-pill-title">Live Radio</span></a></div>';
};
const unifiedHtml = context.Spaces.homeRow();
assert.strictEqual((unifiedHtml.match(/<div class="sp-row-wrap/g) || []).length, 1, "Must have exactly ONE sp-row-wrap container");
assert.strictEqual((unifiedHtml.match(/<div class="sp-row"/g) || []).length, 1, "Must have exactly ONE sp-row list");
assert.ok(unifiedHtml.indexOf("Live Radio") < unifiedHtml.indexOf("sc-pill-arsenal-tula"), "Purple Spaces pill is followed by Arsenal Tula in the same row");
assert.ok(unifiedHtml.indexOf("sc-pill-arsenal-tula") < unifiedHtml.indexOf("sc-pill-cska-moscow"), "Arsenal Tula is followed by CSKA");
assert.ok(unifiedHtml.indexOf("sc-pill-cska-moscow") < unifiedHtml.indexOf("sc-pill-fc-barcelona"), "CSKA is followed by Barca");
assert.ok(unifiedHtml.indexOf("sc-pill-fc-barcelona") < unifiedHtml.indexOf("sc-pill-sabadell-ce"), "Barca is followed by Sabadell");

console.log("soccer scores tests ok");
