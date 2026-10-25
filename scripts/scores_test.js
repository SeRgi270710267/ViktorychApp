/* Soccer Scores test suite */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = {
  console,
  URL,
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  }
};
context.globalThis = context;
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

// Test pill rendering
const tula = L.getTeam("arsenal-tula");
assert.ok(tula, "Arsenal Tula found");
assert.strictEqual(tula.isLive, true, "Arsenal Tula is playing live");
const tulaHtml = L.renderPill(tula);
assert.ok(tulaHtml.includes("sc-pill-arsenal-tula"), "Has Arsenal Tula pill color class");
assert.ok(tulaHtml.includes("is-live"), "Arsenal Tula has live badge");
assert.ok(tulaHtml.includes("2 - 1"), "Displays current live score 2 - 1");

const cska = L.getTeam("cska-moscow");
assert.ok(cska, "CSKA found");
assert.strictEqual(cska.isLive, false, "CSKA shows latest result");
const cskaHtml = L.renderPill(cska);
assert.ok(cskaHtml.includes("sc-pill-cska-moscow"), "Has CSKA pill color class");
assert.ok(cskaHtml.includes("is-ft"), "CSKA has Full Time badge");
assert.ok(cskaHtml.includes("2 - 0"), "Displays latest result score 2 - 0");

const barca = L.getTeam("fc-barcelona");
assert.ok(barca, "FC Barcelona found");
assert.strictEqual(barca.isLive, true, "Barca is playing live");
const barcaHtml = L.renderPill(barca);
assert.ok(barcaHtml.includes("sc-pill-fc-barcelona"), "Has FC Barcelona blaugrana pill class");
assert.ok(barcaHtml.includes("3 - 1"), "Displays Barca score");

const sabadell = L.getTeam("sabadell-ce");
assert.ok(sabadell, "CE Sabadell found");
assert.strictEqual(sabadell.isLive, false, "Sabadell shows latest result");
const sabadellHtml = L.renderPill(sabadell);
assert.ok(sabadellHtml.includes("sc-pill-sabadell-ce"), "Has Sabadell royal blue/white pill class");
assert.ok(sabadellHtml.includes("2 - 1"), "Displays Sabadell latest result");

// Test homeRow
const rowHtml = S.homeRow();
assert.ok(rowHtml.includes("sc-row-wrap"), "Row has sc-row-wrap");
assert.ok(rowHtml.includes("sc-pill-arsenal-tula"), "Row contains Arsenal Tula pill");
assert.ok(rowHtml.includes("sc-pill-cska-moscow"), "Row contains CSKA Moscow pill");
assert.ok(rowHtml.includes("sc-pill-fc-barcelona"), "Row contains FC Barcelona pill");
assert.ok(rowHtml.includes("sc-pill-sabadell-ce"), "Row contains CE Sabadell pill");
assert.strictEqual(S.rowExtra(), 65, "rowExtra offset is 65px");

// Test Live toggle
S.toggleLive("cska-moscow");
assert.strictEqual(L.getTeam("cska-moscow").isLive, true, "CSKA can toggle to Live");
S.toggleLive("cska-moscow");
assert.strictEqual(L.getTeam("cska-moscow").isLive, false, "CSKA can toggle back to FT");

// Test Score updates
const initialHome = tula.liveMatch.homeScore;
S.updateScore("arsenal-tula", 1, 0);
assert.strictEqual(L.getTeam("arsenal-tula").liveMatch.homeScore, initialHome + 1, "Home score incremented");

// Test Goal Simulation
const initialEventsCount = (tula.liveMatch.events || []).length;
S.simulateGoal("arsenal-tula");
assert.strictEqual((L.getTeam("arsenal-tula").liveMatch.events || []).length, initialEventsCount + 1, "Event added to timeline");

// Test Reset Team
S.resetTeam("arsenal-tula");
assert.strictEqual(L.getTeam("arsenal-tula").liveMatch.homeScore, 2, "Arsenal Tula home score reset to default");
assert.strictEqual(L.getTeam("arsenal-tula").liveMatch.awayScore, 1, "Arsenal Tula away score reset to default");

console.log("soccer scores tests ok");
