/* Soccer pills render only a fresh, relevant match. */
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
  setTimeout,
  clearTimeout,
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
loadScript("scores.js");

const L = context.SoccerScoresLogic;
const S = context.SoccerScores;
const P = context.PillData;
assert.ok(L && S && P, "scores and pill data loaded");

const ids = L.catalog().map(function (team) { return team.id; });
assert.strictEqual(ids.join(","), "arsenal-tula,cska-moscow,fc-barcelona,sabadell-ce", "the followed clubs stay in the catalog");
assert.strictEqual(L.loadTeams().length, 0, "no match is shown before a fetch");
assert.strictEqual(S.pillsHtml(), "", "an empty board paints nothing");
assert.strictEqual(S.rowExtra(), 0, "an empty board does not reserve a row");
assert.strictEqual(typeof S.toggleLive, "undefined", "scores are not simulated");
assert.strictEqual(typeof S.simulateGoal, "undefined", "goals are not simulated");
assert.ok(!fs.readFileSync("scores.js", "utf8").includes("getDefaultData"), "the October fiction helper is gone");

const now = Date.now();
function match(extra) {
  return Object.assign({
    id: extra.id,
    league: extra.league,
    status: extra.status,
    kickoff: extra.kickoff,
    minute: extra.minute || "",
    home: extra.home,
    away: extra.away,
    homeScore: extra.homeScore,
    awayScore: extra.awayScore,
    venue: extra.venue || "",
    source: "espn"
  }, {});
}

L.applyBundle(P.bundleSports([
  match({ id: "live", league: "Spanish LALIGA", status: "live", kickoff: now - 40 * 60 * 1000, minute: "41'", home: "FC Barcelona", away: "Villarreal", homeScore: 2, awayScore: 1 }),
  match({ id: "old", league: "Russian Premier League", status: "final", kickoff: now - 48 * 60 * 60 * 1000, home: "CSKA Moscow", away: "Spartak Moscow", homeScore: 2, awayScore: 0 }),
  match({ id: "soon", league: "Spanish LALIGA", status: "scheduled", kickoff: now + 2 * 24 * 60 * 60 * 1000, home: "Villarreal", away: "Espanyol", homeScore: 0, awayScore: 0 })
], now));

const teams = L.loadTeams();
assert.strictEqual(teams.length, 1, "only the live relevant match is a pill");
assert.strictEqual(teams[0].id, "fc-barcelona");
const barca = L.renderPill(teams[0]);
assert.ok(barca.includes("is-live"), "a live match is marked live");
assert.ok(barca.includes("2 - 1"), "the live score is the fetched score");
assert.ok(!barca.includes("0 - 4"), "the old Clasico fiction is gone");
assert.ok(barca.includes("pill-age"), "the pill says when it was updated");
assert.strictEqual(L.getTeam("cska-moscow"), null, "a final from two days ago is dropped");
assert.strictEqual(S.rowExtra(), 65, "one visible match reserves the row");

const halfNow = now;
L.applyBundle(P.bundleSports([
  match({ id: "ht", league: "Russian First League", status: "halftime", kickoff: halfNow - 50 * 60 * 1000, minute: "HT", home: "Arsenal Tula", away: "Shinnik", homeScore: 1, awayScore: 1 })
], halfNow));
const tula = L.renderPill(L.getTeam("arsenal-tula"));
assert.ok(tula.includes("Halftime"), "halftime is its own status");
assert.ok(tula.includes("1 - 1"), "the halftime score is the fetched score");

L.applyBundle(P.bundleSports([
  match({ id: "sched", league: "Spanish LALIGA", status: "scheduled", kickoff: now + 3 * 60 * 60 * 1000, home: "FC Barcelona", away: "Getafe", homeScore: 0, awayScore: 0 })
], now));
const scheduled = L.renderPill(L.getTeam("fc-barcelona"));
assert.ok(scheduled.includes("is-sched"), "a future kickoff is scheduled");
assert.ok(!scheduled.includes("0 - 0"), "a scheduled match does not show 0-0");

L.applyBundle(P.bundleSports([
  match({ id: "final", league: "Spanish LALIGA", status: "final", kickoff: now - 3 * 60 * 60 * 1000, home: "FC Barcelona", away: "Sevilla", homeScore: 3, awayScore: 1 })
], now - 2 * 60 * 60 * 1000));
assert.strictEqual(L.loadTeams().length, 0, "a fresh result still hides once the fetch itself is old");

L.applyBundle(P.bundleSports([
  match({ id: "final", league: "Spanish LALIGA", status: "final", kickoff: now - 3 * 60 * 60 * 1000, home: "FC Barcelona", away: "Sevilla", homeScore: 3, awayScore: 1 })
], now));
const finalHtml = L.renderPill(L.getTeam("fc-barcelona"));
assert.ok(finalHtml.includes("is-ft"), "a recent final stays up");
assert.ok(finalHtml.includes("3 - 1"), "the recent final shows its score");

loadScript("spaces.js");
context.Spaces.homePillsHtml = function () {
  return '<div class="sp-row-item" role="listitem"><a class="sp-pill" href="#/spaces/live"><span class="sp-pill-title">Live Radio</span></a></div>';
};
const row = context.Spaces.homeRow();
assert.strictEqual((row.match(/<div class="sp-row-wrap/g) || []).length, 1, "radio and scores share one row");
assert.ok(row.indexOf("Live Radio") < row.indexOf("sc-pill-fc-barcelona"), "the radio pill sits with the match");
assert.strictEqual(context.Spaces.rowExtra(), 65, "the shared row keeps its offset");

console.log("soccer scores tests ok");
