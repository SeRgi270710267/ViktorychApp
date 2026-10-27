/* Freshness, local time, and parsers for the weather and sports pills.
   The page loads this as a module. The Worker imports the same functions.
   Temperatures stay in Celsius until the UI applies the unit setting.
   Clocks use the IANA zone (Europe/Stockholm observes CET and CEST). */

const WEATHER_FRESH_MS = 12 * 60 * 1000;
const SPORTS_LIVE_FRESH_MS = 45 * 1000;
const SPORTS_IDLE_FRESH_MS = 10 * 60 * 1000;
const FINISHED_KEEP_MS = 18 * 60 * 60 * 1000;
const SCHEDULED_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const MATCH_LENGTH_MS = 2 * 60 * 60 * 1000;

const ESPN_LEAGUES = {
  "esp.1": 1,
  "esp.2": 1,
  "eng.1": 1,
  "ger.1": 1,
  "ita.1": 1,
  "fra.1": 1,
  "rus.1": 1,
  "ned.1": 1,
  "por.1": 1,
  "uefa.champions": 1,
  "uefa.europa": 1
};

const SPORTSDB_KEY = "123";

function freshnessWindow(kind, live) {
  if (kind === "weather") return WEATHER_FRESH_MS;
  if (live) return SPORTS_LIVE_FRESH_MS;
  return SPORTS_IDLE_FRESH_MS;
}

function flagStale(record, now) {
  const at = Number(record && record.updatedAt) || 0;
  const windowMs = freshnessWindow(record && record.kind, !!(record && record.live));
  if (!at) return { stale: true, ageMs: null, windowMs: windowMs, reason: "missing" };
  const age = Math.max(0, Number(now) - at);
  if (age > windowMs) return { stale: true, ageMs: age, windowMs: windowMs, reason: "expired" };
  return { stale: false, ageMs: age, windowMs: windowMs, reason: "fresh" };
}

function auditFreshness(records, now) {
  return (records || []).map((record) => {
    const flag = flagStale(record, now);
    return {
      id: record && record.id || "",
      kind: record && record.kind || "",
      stale: flag.stale,
      reason: flag.reason,
      ageMs: flag.ageMs,
      windowMs: flag.windowMs
    };
  });
}

function assertFresh(records, now) {
  const stale = auditFreshness(records, now).filter((row) => row.stale);
  return { ok: stale.length === 0, stale: stale };
}

function presentRecord(record, now) {
  if (!record) return null;
  if (flagStale(record, now).stale) return null;
  if (record.kind === "sports" && record.match && !matchRelevant(record.match, now)) return null;
  return record;
}

function updatedPhrase(updatedAt, now) {
  const age = Math.max(0, Number(now) - Number(updatedAt || 0));
  const min = Math.floor(age / 60000);
  if (min < 1) return { key: "Updated just now", count: 0 };
  if (min < 60) return { key: "Updated {count} min ago", count: min };
  const hours = Math.floor(min / 60);
  return { key: "Updated {count} h ago", count: hours };
}

function viewerZone(override) {
  if (override) return String(override);
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch (err) { /* fall through */ }
  return "UTC";
}

function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });
  const out = {};
  fmt.formatToParts(new Date(ms)).forEach((part) => {
    if (part.type !== "literal") out[part.type] = part.value;
  });
  return out;
}

function civilDay(ms, timeZone) {
  const part = zonedParts(ms, timeZone);
  return part.year + "-" + part.month + "-" + part.day;
}

function formatClock(ms, timeZone) {
  const part = zonedParts(ms, timeZone);
  return part.hour + ":" + part.minute;
}

function offsetMinutes(ms, timeZone) {
  let name = "";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit"
    });
    fmt.formatToParts(new Date(ms)).forEach((part) => {
      if (part.type === "timeZoneName") name = part.value;
    });
  } catch (err) {
    return null;
  }
  const match = String(name).match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

function ymdCompact(ms, timeZone) {
  const part = zonedParts(ms, timeZone);
  return part.year + part.month + part.day;
}

function espnDates(now, timeZone) {
  const zone = timeZone || "UTC";
  return ymdCompact(now - 24 * 60 * 60 * 1000, zone) + "-" + ymdCompact(now + 7 * 24 * 60 * 60 * 1000, zone);
}

function normalizeUnit(unit) {
  return unit === "F" ? "F" : "C";
}

function formatTempC(celsius, unit) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) return "";
  if (normalizeUnit(unit) === "F") return String(Math.round(value * 9 / 5 + 32)) + "°";
  return String(Math.round(value)) + "°";
}

function validCoords(place) {
  if (!place) return false;
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function resolveLocation(input) {
  const bag = input || {};
  if (validCoords(bag.chosen) && String(bag.chosen.name || "").trim()) {
    return Object.assign({}, bag.chosen, { source: "chosen" });
  }
  if (bag.geoGranted && validCoords(bag.geo)) {
    const name = String(bag.geo.name || "").trim();
    if (name) return Object.assign({}, bag.geo, { source: "geo" });
  }
  if (validCoords(bag.setting) && String(bag.setting.name || "").trim()) {
    return Object.assign({}, bag.setting, { source: "setting" });
  }
  return null;
}

function firstGood(results) {
  const list = results || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].ok && list[i].value) return list[i];
  }
  return null;
}

function roundCoord(value) {
  return Math.round(Number(value) * 100) / 100;
}

function openMeteoUrl(lat, lon) {
  const query = [
    "latitude=" + encodeURIComponent(roundCoord(lat)),
    "longitude=" + encodeURIComponent(roundCoord(lon)),
    "current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation",
    "hourly=temperature_2m,weather_code,precipitation_probability",
    "daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max",
    "timezone=auto",
    "forecast_days=5"
  ].join("&");
  return "https://api.open-meteo.com/v1/forecast?" + query;
}

function metNoUrl(lat, lon) {
  return "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=" + encodeURIComponent(roundCoord(lat)) + "&lon=" + encodeURIComponent(roundCoord(lon));
}

function geocodeUrl(name) {
  return "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) + "&count=5&language=en&format=json";
}

function espnUrl(league, dates) {
  let url = "https://site.api.espn.com/apis/site/v2/sports/soccer/" + league + "/scoreboard";
  if (dates) url += "?dates=" + encodeURIComponent(dates);
  return url;
}

function sportsDbUrl(teamId, kind) {
  const path = kind === "last" ? "eventslast.php" : "eventsnext.php";
  return "https://www.thesportsdb.com/api/v1/json/" + SPORTSDB_KEY + "/" + path + "?id=" + encodeURIComponent(teamId);
}

function allowedLeague(league) {
  return !!ESPN_LEAGUES[String(league || "")];
}

function allowedDates(dates) {
  return /^\d{8}(-\d{8})?$/.test(String(dates || ""));
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hourLabel(stamp) {
  const text = String(stamp || "");
  const match = text.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function parseOpenMeteo(json, now) {
  if (!json || json.error || !json.current) return null;
  const current = json.current;
  if (current.temperature_2m == null || current.temperature_2m === "") return null;
  const zone = json.timezone || "UTC";
  const hourly = json.hourly || {};
  const times = hourly.time || [];
  const currentStamp = String(current.time || "");
  const hours = [];
  for (let i = 0; i < times.length && hours.length < 12; i++) {
    if (currentStamp && String(times[i]) < currentStamp) continue;
    const temp = num((hourly.temperature_2m || [])[i]);
    if (temp == null) continue;
    hours.push({
      hour: hourLabel(times[i]),
      temp: temp,
      code: num((hourly.weather_code || [])[i]),
      rain: num((hourly.precipitation_probability || [])[i])
    });
  }
  const daily = json.daily || {};
  const days = [];
  const dayTimes = daily.time || [];
  for (let d = 0; d < dayTimes.length && days.length < 5; d++) {
    const max = num((daily.temperature_2m_max || [])[d]);
    const minTemp = num((daily.temperature_2m_min || [])[d]);
    if (max == null || minTemp == null) continue;
    days.push({
      date: String(dayTimes[d]),
      min: minTemp,
      max: max,
      code: num((daily.weather_code || [])[d]),
      rain: num((daily.precipitation_probability_max || [])[d])
    });
  }
  const rainNow = hours.length ? hours[0].rain : (days[0] && days[0].rain);
  return {
    kind: "weather",
    source: "open-meteo",
    updatedAt: now,
    timezone: zone,
    temp: Number(current.temperature_2m),
    code: current.weather_code == null ? null : Number(current.weather_code),
    humidity: num(current.relative_humidity_2m),
    wind: num(current.wind_speed_10m),
    feels: num(current.apparent_temperature),
    precipMm: num(current.precipitation),
    precipChance: rainNow,
    uv: days[0] ? days[0].rain == null ? num((daily.uv_index_max || [])[0]) : num((daily.uv_index_max || [])[0]) : null,
    hourly: hours,
    daily: days
  };
}

function metSymbolToCode(symbol) {
  const text = String(symbol || "").toLowerCase();
  if (!text) return null;
  if (text.indexOf("thunder") >= 0) return 95;
  if (text.indexOf("snow") >= 0 || text.indexOf("sleet") >= 0) return 73;
  if (text.indexOf("rain") >= 0 || text.indexOf("drizzle") >= 0) return 61;
  if (text.indexOf("fog") >= 0) return 45;
  if (text.indexOf("cloudy") >= 0 && text.indexOf("partly") < 0 && text.indexOf("fair") < 0) return 3;
  if (text.indexOf("partly") >= 0 || text.indexOf("fair") >= 0) return 2;
  if (text.indexOf("clear") >= 0) return 0;
  return 2;
}

function parseMetNo(json, now, timeZone) {
  const series = json && json.properties && json.properties.timeseries;
  if (!Array.isArray(series) || !series.length) return null;
  const zone = timeZone || "UTC";
  const upcoming = series.filter((row) => Date.parse(row.time) >= now - 30 * 60 * 1000);
  const rows = (upcoming.length ? upcoming : series).slice(0, 36);
  const first = rows[0];
  const instant = first && first.data && first.data.instant && first.data.instant.details || {};
  if (instant.air_temperature == null) return null;
  const symbol = (first.data.next_1_hours || first.data.next_6_hours || {}).summary;
  const hours = rows.slice(0, 12).map((row) => {
    const details = row.data && row.data.instant && row.data.instant.details || {};
    const next = row.data && (row.data.next_1_hours || row.data.next_6_hours) || {};
    const amount = next.details && next.details.precipitation_amount;
    return {
      hour: formatClock(Date.parse(row.time), zone),
      temp: Number(details.air_temperature),
      code: metSymbolToCode(next.summary && next.summary.symbol_code),
      rain: null,
      precipMm: num(amount)
    };
  }).filter((row) => Number.isFinite(row.temp));
  const byDay = {};
  rows.forEach((row) => {
    const details = row.data && row.data.instant && row.data.instant.details || {};
    const temp = num(details.air_temperature);
    if (temp == null) return;
    const day = civilDay(Date.parse(row.time), zone);
    if (!byDay[day]) byDay[day] = { date: day, min: temp, max: temp, code: null };
    byDay[day].min = Math.min(byDay[day].min, temp);
    byDay[day].max = Math.max(byDay[day].max, temp);
    const next = row.data && (row.data.next_1_hours || row.data.next_6_hours);
    if (byDay[day].code == null && next && next.summary) byDay[day].code = metSymbolToCode(next.summary.symbol_code);
  });
  const days = Object.keys(byDay).sort().slice(0, 5).map((key) => byDay[key]);
  const wind = num(instant.wind_speed);
  return {
    kind: "weather",
    source: "metno",
    updatedAt: now,
    timezone: zone,
    temp: Number(instant.air_temperature),
    code: metSymbolToCode(symbol && symbol.symbol_code),
    humidity: num(instant.relative_humidity),
    wind: wind == null ? null : wind * 3.6,
    feels: null,
    precipMm: hours[0] ? hours[0].precipMm : null,
    precipChance: null,
    uv: null,
    hourly: hours,
    daily: days
  };
}

function mapStatus(raw) {
  const text = String(raw || "").toUpperCase().replace(/[\s-]+/g, "_");
  if (!text) return "";
  if (text === "HT" || text === "STATUS_HALFTIME" || text === "HALFTIME" || text === "HALF_TIME") return "halftime";
  if (text === "NS" || text === "STATUS_SCHEDULED" || text === "PRE" || text === "SCHEDULED" || text === "NOT_STARTED" || text === "TIMED") return "scheduled";
  if (text === "FT" || text === "AET" || text === "PEN" || text === "POST" || text === "FULL_TIME" || text === "FINAL" || text === "STATUS_FULL_TIME" || text === "STATUS_FINAL" || text === "STATUS_FINAL_AET" || text === "STATUS_FINAL_PEN") return "final";
  if (text === "POSTPONED" || text === "STATUS_POSTPONED" || text === "PST" || text === "CANC" || text === "CANCELLED" || text === "CANCELED" || text === "STATUS_CANCELED" || text === "STATUS_POSTPONED" || text === "ABD" || text === "SUSP" || text === "INT" || text === "ABANDONED") return "void";
  if (text === "1H" || text === "2H" || text === "ET" || text === "LIVE" || text === "BT" || text === "P" || text === "IN" || text === "IN_PROGRESS" || text === "STATUS_IN_PROGRESS" || text === "STATUS_FIRST_HALF" || text === "STATUS_SECOND_HALF" || text === "STATUS_EXTRA_TIME" || text === "STATUS_EXTRA_TIME_HALF" ) return "live";
  return "";
}

function kickoffMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return 0;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text);
  const parsed = Date.parse(hasZone ? text : text.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nameHit(teamName, aliases) {
  const name = normalizeName(teamName);
  if (!name) return false;
  const padded = " " + name + " ";
  if (/\b(women|femeni|fem|u19|u21|u23)\b/.test(name)) return false;
  if (/\sb$/.test(name) || /\sii$/.test(name) || /\sreserves$/.test(name)) return false;
  return (aliases || []).some((alias) => {
    const needle = normalizeName(alias);
    if (!needle) return false;
    return name === needle || padded.indexOf(" " + needle + " ") >= 0;
  });
}

function finishMs(match) {
  if (!match || !match.kickoff) return 0;
  return match.kickoff + MATCH_LENGTH_MS;
}

function matchRelevant(match, now) {
  if (!match || !match.status || match.status === "void") return false;
  if (match.status === "live" || match.status === "halftime") return true;
  if (match.status === "final") {
    const end = finishMs(match);
    if (!end) return false;
    return now >= match.kickoff && now - end <= FINISHED_KEEP_MS;
  }
  if (match.status === "scheduled") {
    if (!match.kickoff) return false;
    if (match.kickoff < now - 3 * 60 * 60 * 1000) return false;
    return match.kickoff - now <= SCHEDULED_AHEAD_MS;
  }
  return false;
}

function matchRank(match, now) {
  if (match.status === "live") return 0;
  if (match.status === "halftime") return 1;
  if (match.status === "scheduled") return 2;
  if (match.status === "final") return 3;
  return 9;
}

function pickPillMatch(matches, aliases, now) {
  const mine = (matches || []).filter((match) => {
    return nameHit(match.home, aliases) || nameHit(match.away, aliases);
  }).filter((match) => matchRelevant(match, now));
  mine.sort((a, b) => {
    const rank = matchRank(a, now) - matchRank(b, now);
    if (rank) return rank;
    if (a.status === "final") return b.kickoff - a.kickoff;
    return a.kickoff - b.kickoff;
  });
  return mine[0] || null;
}

function leagueMatches(matches, league, now) {
  const name = normalizeName(league);
  return (matches || []).filter((match) => {
    if (!matchRelevant(match, now)) return false;
    if (!name) return true;
    return normalizeName(match.league).indexOf(name) >= 0 || name.indexOf(normalizeName(match.league)) >= 0;
  }).sort((a, b) => a.kickoff - b.kickoff);
}

function cleanMatch(match) {
  if (!match || !match.status || !match.home || !match.away) return null;
  const scheduled = match.status === "scheduled";
  return {
    id: String(match.id || ""),
    league: match.league || "",
    status: match.status,
    kickoff: match.kickoff || 0,
    minute: match.status === "halftime" ? "HT" : (match.minute || ""),
    home: match.home,
    away: match.away,
    homeScore: scheduled ? null : match.homeScore,
    awayScore: scheduled ? null : match.awayScore,
    venue: match.venue || "",
    source: match.source || ""
  };
}

function parseEspnScoreboard(json, now) {
  const events = json && json.events || [];
  const league = ((json && json.leagues || [])[0] || {}).name || "";
  const matches = [];
  events.forEach((event) => {
    const comp = (event.competitions || [])[0] || {};
    const status = comp.status || {};
    const type = status.type || {};
    const mapped = mapStatus(type.name) || mapStatus(type.state);
    const competitors = comp.competitors || [];
    const home = competitors.filter((row) => row.homeAway === "home")[0] || competitors[0] || {};
    const away = competitors.filter((row) => row.homeAway === "away")[0] || competitors[1] || {};
    const homeTeam = (home.team || {}).displayName || (home.team || {}).shortDisplayName || "";
    const awayTeam = (away.team || {}).displayName || (away.team || {}).shortDisplayName || "";
    let minute = "";
    if (mapped === "live") minute = String(status.displayClock || type.shortDetail || "").trim();
    if (mapped === "halftime") minute = "HT";
    const row = cleanMatch({
      id: event.id,
      league: league || ((comp.league || {}).name) || "",
      status: mapped,
      kickoff: kickoffMs(event.date),
      minute: minute,
      home: homeTeam,
      away: awayTeam,
      homeScore: num(home.score),
      awayScore: num(away.score),
      venue: (comp.venue || {}).fullName || "",
      source: "espn"
    });
    if (row) matches.push(row);
  });
  return { updatedAt: now, matches: matches };
}

function sportsDbRows(json) {
  if (!json) return [];
  if (Array.isArray(json.events)) return json.events;
  if (Array.isArray(json.results)) return json.results;
  return [];
}

function parseSportsDb(json, now) {
  const matches = [];
  sportsDbRows(json).forEach((event) => {
    const mapped = mapStatus(event.strStatus) || mapStatus(event.strProgress);
    let minute = "";
    if (mapped === "live") minute = String(event.strProgress || event.strStatus || "").trim();
    if (mapped === "halftime") minute = "HT";
    if (minute && /^\d+$/.test(minute)) minute += "'";
    const row = cleanMatch({
      id: event.idEvent,
      league: event.strLeague || "",
      status: mapped,
      kickoff: kickoffMs(event.strTimestamp || ((event.dateEvent || "") + "T" + (event.strTime || "00:00:00"))),
      minute: minute,
      home: event.strHomeTeam || "",
      away: event.strAwayTeam || "",
      homeScore: num(event.intHomeScore),
      awayScore: num(event.intAwayScore),
      venue: event.strVenue || "",
      source: "sportsdb"
    });
    if (row) matches.push(row);
  });
  return { updatedAt: now, matches: matches };
}

function dedupeMatches(lists) {
  const out = [];
  const seen = {};
  (lists || []).forEach((list) => {
    (list || []).forEach((match) => {
      const key = normalizeName(match.home) + "|" + normalizeName(match.away) + "|" + String(match.kickoff || 0);
      if (seen[key]) return;
      seen[key] = 1;
      out.push(match);
    });
  });
  return out;
}

function bundleSports(matches, now) {
  const live = (matches || []).some((match) => match.status === "live" || match.status === "halftime");
  return {
    kind: "sports",
    updatedAt: now,
    live: live,
    matches: matches || []
  };
}

function apiBase(root) {
  const host = root || globalThis;
  try {
    if (host.ViktorychAccounts && typeof host.ViktorychAccounts.currentApi === "function") {
      const current = host.ViktorychAccounts.currentApi();
      if (current) return String(current).replace(/\/$/, "");
    }
  } catch (err) { /* the page can still call the public sources */ }
  const bag = host.VIKTORYCH_ACCOUNTS || {};
  return String(bag.api || bag.backupApi || "").replace(/\/$/, "");
}

const api = {
  WEATHER_FRESH_MS: WEATHER_FRESH_MS,
  SPORTS_LIVE_FRESH_MS: SPORTS_LIVE_FRESH_MS,
  SPORTS_IDLE_FRESH_MS: SPORTS_IDLE_FRESH_MS,
  FINISHED_KEEP_MS: FINISHED_KEEP_MS,
  SCHEDULED_AHEAD_MS: SCHEDULED_AHEAD_MS,
  SPORTSDB_KEY: SPORTSDB_KEY,
  freshnessWindow: freshnessWindow,
  flagStale: flagStale,
  auditFreshness: auditFreshness,
  assertFresh: assertFresh,
  presentRecord: presentRecord,
  updatedPhrase: updatedPhrase,
  viewerZone: viewerZone,
  zonedParts: zonedParts,
  civilDay: civilDay,
  formatClock: formatClock,
  offsetMinutes: offsetMinutes,
  espnDates: espnDates,
  normalizeUnit: normalizeUnit,
  formatTempC: formatTempC,
  validCoords: validCoords,
  resolveLocation: resolveLocation,
  firstGood: firstGood,
  openMeteoUrl: openMeteoUrl,
  metNoUrl: metNoUrl,
  geocodeUrl: geocodeUrl,
  espnUrl: espnUrl,
  sportsDbUrl: sportsDbUrl,
  allowedLeague: allowedLeague,
  allowedDates: allowedDates,
  parseOpenMeteo: parseOpenMeteo,
  parseMetNo: parseMetNo,
  mapStatus: mapStatus,
  kickoffMs: kickoffMs,
  nameHit: nameHit,
  matchRelevant: matchRelevant,
  pickPillMatch: pickPillMatch,
  leagueMatches: leagueMatches,
  parseEspnScoreboard: parseEspnScoreboard,
  parseSportsDb: parseSportsDb,
  dedupeMatches: dedupeMatches,
  bundleSports: bundleSports,
  apiBase: apiBase
};

export {
  WEATHER_FRESH_MS,
  SPORTS_LIVE_FRESH_MS,
  SPORTS_IDLE_FRESH_MS,
  FINISHED_KEEP_MS,
  SPORTSDB_KEY,
  freshnessWindow,
  flagStale,
  auditFreshness,
  assertFresh,
  presentRecord,
  updatedPhrase,
  viewerZone,
  zonedParts,
  civilDay,
  formatClock,
  offsetMinutes,
  espnDates,
  normalizeUnit,
  formatTempC,
  resolveLocation,
  firstGood,
  openMeteoUrl,
  metNoUrl,
  geocodeUrl,
  espnUrl,
  sportsDbUrl,
  allowedLeague,
  allowedDates,
  parseOpenMeteo,
  parseMetNo,
  mapStatus,
  nameHit,
  matchRelevant,
  pickPillMatch,
  leagueMatches,
  parseEspnScoreboard,
  parseSportsDb,
  dedupeMatches,
  bundleSports,
  apiBase
};
globalThis.PillData = api;
