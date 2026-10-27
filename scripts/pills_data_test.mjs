import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  WEATHER_FRESH_MS,
  SPORTS_LIVE_FRESH_MS,
  FINISHED_KEEP_MS,
  flagStale,
  assertFresh,
  presentRecord,
  offsetMinutes,
  civilDay,
  formatClock,
  formatTempC,
  normalizeUnit,
  resolveLocation,
  firstGood,
  nameHit,
  matchRelevant,
  parseOpenMeteo,
  parseMetNo,
  parseEspnScoreboard,
  parseSportsDb,
  pickPillMatch,
  openMeteoUrl,
  sportsDbUrl
} from "../shared/pill-data.js";

function fixture(name) {
  return JSON.parse(fs.readFileSync(new URL("./fixtures/pills/" + name, import.meta.url), "utf8"));
}

const zone = "Europe/Stockholm";
const winter = Date.parse("2026-01-15T12:00:00Z");
const summer = Date.parse("2026-07-15T12:00:00Z");
const beforeFallBack = Date.parse("2026-10-25T00:30:00Z");
const afterFallBack = Date.parse("2026-10-25T01:30:00Z");
const dateLine = Date.parse("2026-10-27T23:30:00Z");

test("Stockholm clocks follow CET and CEST, including the fall-back hour", () => {
  assert.equal(offsetMinutes(winter, zone), 60);
  assert.equal(formatClock(winter, zone), "13:00");
  assert.equal(offsetMinutes(summer, zone), 120);
  assert.equal(formatClock(summer, zone), "14:00");
  assert.equal(offsetMinutes(beforeFallBack, zone), 120);
  assert.equal(formatClock(beforeFallBack, zone), "02:30");
  assert.equal(offsetMinutes(afterFallBack, zone), 60);
  assert.equal(formatClock(afterFallBack, zone), "02:30");
  assert.equal(civilDay(dateLine, zone), "2026-10-28");
  assert.equal(formatClock(dateLine, zone), "00:30");
});

test("a late kickoff is the next civil day in Stockholm", () => {
  const parsed = parseEspnScoreboard(fixture("espn-dateline.json"), dateLine);
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].status, "scheduled");
  assert.equal(parsed.matches[0].homeScore, null);
  assert.equal(civilDay(parsed.matches[0].kickoff, zone), "2026-10-28");
});

test("weather and live scores are flagged once they leave their window", () => {
  const now = Date.parse("2026-10-27T16:00:00Z");
  const weatherFresh = { kind: "weather", id: "stockholm", updatedAt: now - 5 * 60 * 1000 };
  const weatherStale = { kind: "weather", id: "stockholm", updatedAt: now - 20 * 60 * 1000 };
  const liveFresh = { kind: "sports", id: "barca", live: true, updatedAt: now - 20 * 1000 };
  const liveStale = { kind: "sports", id: "barca", live: true, updatedAt: now - 90 * 1000 };
  assert.equal(flagStale(weatherFresh, now).stale, false);
  assert.equal(flagStale(weatherStale, now).stale, true);
  assert.equal(flagStale(weatherStale, now).reason, "expired");
  assert.equal(flagStale({ kind: "weather", updatedAt: 0 }, now).reason, "missing");
  assert.equal(flagStale(liveFresh, now).stale, false);
  assert.equal(flagStale(liveStale, now).stale, true);
  assert.equal(flagStale(liveStale, now).windowMs, SPORTS_LIVE_FRESH_MS);
  assert.equal(flagStale(weatherStale, now).windowMs, WEATHER_FRESH_MS);
  const audit = assertFresh([weatherFresh, weatherStale, liveStale], now);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.stale.map((row) => row.id), ["stockholm", "barca"]);
  assert.equal(presentRecord(weatherStale, now), null);
  assert.equal(presentRecord(weatherFresh, now).id, "stockholm");
});

test("location falls through a chosen city, then permission, then a setting", () => {
  assert.equal(resolveLocation({}), null);
  assert.equal(resolveLocation({ geoGranted: false, geo: { name: "Here", lat: 59.3, lon: 18.06 } }), null);
  assert.equal(resolveLocation({ chosen: { name: "Tula" } }), null);
  const chosen = resolveLocation({ chosen: { name: "Stockholm", lat: 59.33, lon: 18.07 }, geoGranted: true, geo: { name: "Here", lat: 1, lon: 1 } });
  assert.equal(chosen.source, "chosen");
  assert.equal(chosen.name, "Stockholm");
  const geo = resolveLocation({ geoGranted: true, geo: { name: "Current location", lat: 59.33, lon: 18.07 } });
  assert.equal(geo.source, "geo");
  const setting = resolveLocation({ setting: { name: "Gothenburg", lat: 57.7, lon: 11.97 } });
  assert.equal(setting.name, "Gothenburg");
  assert.equal(setting.source, "setting");
});

test("Celsius is the default and 14 C is 57 F", () => {
  assert.equal(normalizeUnit(undefined), "C");
  assert.equal(normalizeUnit("nope"), "C");
  assert.equal(formatTempC(14, "C"), "14°");
  assert.equal(formatTempC(14, "F"), "57°");
  assert.equal(formatTempC(0, "C"), "0°");
});

test("Open-Meteo keeps a clear code and MET Norway converts wind without a fake rain percent", () => {
  const now = Date.parse("2026-10-27T15:10:00Z");
  const open = parseOpenMeteo(fixture("open-meteo-stockholm.json"), now);
  assert.equal(open.code, 0);
  assert.equal(open.temp, 8.2);
  assert.equal(open.feels, 5.4);
  assert.equal(open.precipChance, 40);
  assert.equal(open.precipMm, 0.2);
  assert.equal(open.hourly[0].hour, "16:00");
  assert.equal(open.timezone, "Europe/Stockholm");
  assert.equal(parseOpenMeteo(fixture("open-meteo-429.json"), now), null);
  const met = parseMetNo(fixture("met-no-compact.json"), now, zone);
  assert.equal(met.source, "metno");
  assert.equal(met.temp, 7.1);
  assert.equal(met.wind, 14.4);
  assert.equal(met.precipChance, null);
  assert.equal(met.precipMm, 0.4);
  assert.equal(met.code, 61);
});

test("a failed source is skipped and two failures leave nothing to show", () => {
  const open = parseOpenMeteo(fixture("open-meteo-stockholm.json"), 1);
  const met = parseMetNo(fixture("met-no-compact.json"), 1, zone);
  assert.equal(firstGood([{ ok: false, value: null }, { ok: true, value: met }]).value.source, "metno");
  assert.equal(firstGood([{ ok: false, value: null }, { ok: false, value: null }]), null);
  assert.equal(firstGood([{ ok: true, value: open }]).value.source, "open-meteo");
});

test("live, halftime, final, and scheduled matches keep the right score and day", () => {
  const now = Date.parse("2026-10-27T18:40:00Z");
  const live = parseEspnScoreboard(fixture("espn-live.json"), now).matches[0];
  assert.equal(live.status, "live");
  assert.equal(live.minute, "67'");
  assert.equal(live.homeScore, 2);
  assert.equal(live.awayScore, 1);
  assert.equal(matchRelevant(live, now), true);

  const half = parseEspnScoreboard(fixture("espn-halftime.json"), now).matches[0];
  assert.equal(half.status, "halftime");
  assert.equal(half.minute, "HT");
  assert.equal(half.homeScore, 1);

  const recent = parseEspnScoreboard(fixture("espn-final.json"), now).matches[0];
  assert.equal(recent.status, "final");
  assert.equal(recent.homeScore, 2);
  assert.equal(matchRelevant(recent, now), true);
  const oldFinal = Object.assign({}, recent, { kickoff: now - 48 * 60 * 60 * 1000 });
  assert.equal(matchRelevant(oldFinal, now), false);
  assert.ok(now - (oldFinal.kickoff + 2 * 60 * 60 * 1000) > FINISHED_KEEP_MS);

  const scheduled = parseEspnScoreboard(fixture("espn-scheduled.json"), now).matches[0];
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.homeScore, null);
  assert.equal(scheduled.awayScore, null);
  assert.equal(matchRelevant(scheduled, now), true);
  const tooSoon = Object.assign({}, scheduled, { kickoff: now + 8 * 24 * 60 * 60 * 1000 });
  assert.equal(matchRelevant(tooSoon, now), false);
  assert.equal(parseEspnScoreboard(fixture("espn-empty.json"), now).matches.length, 0);

  const picked = pickPillMatch([live, { home: "Barcelona B", away: "Villarreal", status: "live", kickoff: now, homeScore: 9, awayScore: 0 }], ["barcelona", "fc barcelona"], now);
  assert.equal(picked.home, "FC Barcelona");
  assert.equal(nameHit("Barcelona B", ["barcelona"]), false);
  assert.equal(nameHit("FC Barcelona", ["barcelona"]), true);
  assert.equal(nameHit("Barcelona Women", ["barcelona"]), false);
});

test("TheSportsDB next and last rows are paced-source fixtures, not invented scores", () => {
  const now = Date.parse("2026-10-27T18:40:00Z");
  const next = parseSportsDb(fixture("sportsdb-next.json"), now).matches[0];
  const last = parseSportsDb(fixture("sportsdb-last.json"), now).matches[0];
  assert.equal(next.status, "scheduled");
  assert.equal(next.homeScore, null);
  assert.equal(last.status, "final");
  assert.equal(last.homeScore, 3);
  assert.equal(last.awayScore, 2);
  assert.equal(matchRelevant(last, now), true);
  assert.equal(sportsDbUrl("133739", "next").includes("/123/eventsnext.php"), true);
  assert.equal(openMeteoUrl(59.329, 18.068).startsWith("https://api.open-meteo.com/"), true);
  assert.equal(openMeteoUrl(59.329, 18.068).includes("cors"), false);
});
