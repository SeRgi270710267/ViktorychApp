/* ReGone social helpers shared by the page and the Worker.
   Pure functions only: room names, invite messages, the achievement
   catalogue and the NZlay Top 100 table parser.

   Rooms: ReGone (NZlay) lists its official rooms at a public server list
   (wsp.nzlay.com/getserverlist/). It sends no CORS header, so the Worker
   reads it and the page falls back to CURATED_ROOMS below. Room names follow
   "NZlay <Mini|Medium|Large|Mega> NN - <EU|USA>". The game has no address
   parameter that joins a room, so Join opens the game and shows the room
   name to pick in the game's own lobby. */

export const ROOM_MAX = 48;
export const MESSAGE_MAX = 140;
export const ROOM_SOURCE = "https://wsp.nzlay.com/getserverlist/";
export const TOP_SOURCE = "https://nzlay.com/pages/top100";
export const DIRECT_JOIN = false;
export const CLAN_ROOM_SOURCE = "https://wsp.nzlay.com/getclanserverlist/";
export const ONLINE_SOURCE = "https://nzlay.com/ReGone/players-online.php";
export const PROFILE_SOURCE = "https://nzlay.com/profile/";

/* Standard official rooms seen on the public list (sizes 8, 12, 16 and 24
   players; maps Warehouse, Courtyard, Timbertown, Pipeline, Tower, Crane). */
export const CURATED_ROOMS = [
  { name: "NZlay Mini 01 - EU", max: 8, region: "EU" },
  { name: "NZlay Medium 01 - EU", max: 12, region: "EU" },
  { name: "NZlay Large 01 - EU", max: 16, region: "EU" },
  { name: "NZlay Mega 05 - EU", max: 24, region: "EU" },
  { name: "NZlay Mini 01 - USA", max: 8, region: "USA" },
  { name: "NZlay Medium 03 - USA", max: 12, region: "USA" },
  { name: "NZlay Large 01 - USA", max: 16, region: "USA" },
  { name: "NZlay Large 02 - USA", max: 16, region: "USA" }
];

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const LINK = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|gg|ru|xyz|app|dev|me|ly|co|tk|link|site|online|info|biz|tv|to|cc|us|uk|de|fr|es|in)\b)/i;
/* A short mask list. Whole words only, so room names and normal chat pass. */
const ROUGH = ["fuck", "fucking", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "retard", "whore", "slut", "dick", "pussy", "asshole", "сука", "блять", "блядь", "хуй", "пизда", "ебать", "चूतिया", "भोसड़ी", "madarchod", "bhenchod", "puta", "mierda", "pendejo", "cabrón"];

function squash(value) {
  return String(value == null ? "" : value).replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

export function cleanRoom(value) {
  const text = squash(value).slice(0, ROOM_MAX);
  if (!text || LINK.test(text)) return "";
  return maskRough(text);
}

export function maskRough(text) {
  let out = String(text || "");
  ROUGH.forEach((word) => {
    const re = new RegExp("(^|[^\\p{L}\\p{N}])(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")(?=$|[^\\p{L}\\p{N}])", "giu");
    out = out.replace(re, (m, lead, hit) => lead + hit.charAt(0) + "*".repeat(Math.max(1, hit.length - 1)));
  });
  return out;
}

/* Invite note: plain text, no links, rough words masked, 140 characters. */
export function checkMessage(value) {
  const text = squash(value);
  if (!text) return { ok: true, text: "" };
  if (LINK.test(text)) return { ok: false, error: "links" };
  if (Array.from(text).length > MESSAGE_MAX) return { ok: false, error: "long" };
  return { ok: true, text: maskRough(text) };
}

/* Region from the end of a room name: "NZlay Mini 01 - EU" -> "EU". */
export function roomRegion(name) {
  const hit = String(name || "").match(/(?:^|[\s\-–(])(EU|USA|US|NA|SA|BR|ASIA|AS|OCE|AU|RU|ME|AF)\)?\s*$/i);
  if (!hit) return "";
  const code = hit[1].toUpperCase();
  return code === "US" || code === "NA" ? "USA" : code;
}

/* Room list rows to the small shape the page shows: name, map, mode,
   size and region. Server addresses and owner ids never leave the Worker.
   The official list keeps NZlay's own rooms; the clan list (opts.clan)
   keeps its names, cleaned like any typed room. */
export function roomsFromList(body, opts) {
  const clan = !!(opts && opts.clan);
  const list = Array.isArray(body) ? body : body && Array.isArray(body.servers) ? body.servers : [];
  const seen = new Set();
  const out = [];
  list.forEach((row) => {
    if (!row || (!clan && Number(row.owner_user_id) !== 1)) return;
    const name = cleanRoom(row.name);
    if (!name || name.indexOf("*") >= 0 || seen.has(name)) return;
    seen.add(name);
    const item = { name, arena: squash(row.arena).slice(0, 24), mode: squash(row.game_mode).slice(0, 24), max: Number(row.max_players) || 0, region: roomRegion(name) };
    if (clan) item.clan = true;
    out.push(item);
  });
  out.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return out.slice(0, 500);
}

/* Achievements. "kind" says which numbers unlock it. Later in-game stats
   (from an NZlay hook) can add kinds without changing the page. */
export const ACHIEVEMENTS = [
  { id: "first_play", kind: "play", icon: "play" },
  { id: "hours_1", kind: "hours", value: 1, icon: "clock" },
  { id: "hours_10", kind: "hours", value: 10, icon: "clock" },
  { id: "hours_50", kind: "hours", value: 50, icon: "clock" },
  { id: "streak_3", kind: "streak", value: 3, icon: "flame" },
  { id: "streak_7", kind: "streak", value: 7, icon: "flame" },
  { id: "streak_30", kind: "streak", value: 30, icon: "flame" },
  { id: "invite_sent", kind: "invite", icon: "send" },
  { id: "invite_joined", kind: "joined", icon: "people" },
  { id: "friends_3", kind: "friends", value: 3, icon: "people" },
  { id: "night_owl", kind: "night", icon: "moon" },
  { id: "weekend_warrior", kind: "weekend", icon: "calendar" },
  { id: "top_100", kind: "rank", value: 100, icon: "trophy" },
  { id: "top_50", kind: "rank", value: 50, icon: "trophy" },
  { id: "top_10", kind: "rank", value: 10, icon: "trophy" },
  { id: "top_1", kind: "rank", value: 1, icon: "crown" },
  { id: "kills_100", kind: "kills", value: 100, icon: "target" },
  { id: "kills_500", kind: "kills", value: 500, icon: "target" },
  { id: "kills_1000", kind: "kills", value: 1000, icon: "target" },
  { id: "kills_2500", kind: "kills", value: 2500, icon: "target" },
  { id: "climber", kind: "climb", value: 10, icon: "up" },
  // From a self-linked NZlay profile, only while the owner turns on
  // regone_profile_stats (off by default).
  { id: "weapon_100", kind: "weapon", value: 100, icon: "target" },
  { id: "headshot_25", kind: "headshot", value: 25, icon: "target" },
  { id: "multi_10", kind: "multi", value: 10, icon: "flame" },
  { id: "wins_10", kind: "wins", value: 10, icon: "trophy" },
  { id: "wins_100", kind: "wins", value: 100, icon: "trophy" }
];
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

/* Which achievements these numbers unlock. Pure, for tests.
   facts: { played, totalMs, streak, invited, joined, friends, night, weekend, rank, kills, climbed } */
export function unlocked(facts) {
  const f = facts || {};
  const hours = (Number(f.totalMs) || 0) / 3600000;
  return ACHIEVEMENTS.filter((a) => {
    if (a.kind === "play") return !!f.played || (Number(f.totalMs) || 0) > 0;
    if (a.kind === "hours") return hours >= a.value;
    if (a.kind === "streak") return (Number(f.streak) || 0) >= a.value;
    if (a.kind === "invite") return !!f.invited;
    if (a.kind === "joined") return !!f.joined;
    if (a.kind === "friends") return (Number(f.friends) || 0) >= a.value;
    if (a.kind === "night") return !!f.night;
    if (a.kind === "weekend") return !!f.weekend;
    if (a.kind === "rank") return Number(f.rank) > 0 && Number(f.rank) <= a.value;
    if (a.kind === "kills") return (Number(f.kills) || 0) >= a.value;
    if (a.kind === "climb") return (Number(f.climbed) || 0) >= a.value;
    if (a.kind === "weapon") return (Number(f.weaponBest) || 0) >= a.value;
    if (a.kind === "headshot") return (Number(f.hits) || 0) >= 100 && (Number(f.headshotRate) || 0) >= a.value;
    if (a.kind === "multi") return (Number(f.multiKills) || 0) >= a.value;
    if (a.kind === "wins") return (Number(f.matchesWon) || 0) >= a.value;
    return false;
  }).map((a) => a.id);
}

/* Local time from a UTC time and the page's offset in minutes east of UTC. */
export function localParts(ms, offsetMin) {
  const off = Math.max(-840, Math.min(840, Number(offsetMin) || 0));
  const d = new Date(Number(ms) + off * 60000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay() };
}

export function isNightOwl(ms, offsetMin) {
  const hour = localParts(ms, offsetMin).hour;
  return hour >= 0 && hour < 4;
}

export function inQuiet(ms, offsetMin, from, to) {
  const hour = localParts(ms, offsetMin).hour;
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  if (a === b) return false;
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

function cellText(html) {
  return squash(String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'"));
}
function num(text) {
  const n = Number(String(text || "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

/* NZlay's public Top 100 table: rank and name in the first cell, then
   KILLS, KDR, DEATHS and TOTAL. Returns [] when the shape changes. */
export function parseTop(html) {
  const text = String(html || "");
  const start = text.search(/<table[^>]*class="[^"]*stats_table/i);
  if (start < 0) return [];
  const end = text.indexOf("</table>", start);
  const table = text.slice(start, end < 0 ? text.length : end);
  const head = (table.match(/<thead[\s\S]*?<\/thead>/i) || [""])[0].toUpperCase();
  if (head.indexOf("KILLS") < 0 || head.indexOf("KDR") < 0 || head.indexOf("DEATHS") < 0) return [];
  const body = (table.match(/<tbody[\s\S]*$/i) || [""])[0];
  const out = [];
  const rows = body.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  rows.forEach((row) => {
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 5) return;
    const rankMatch = cells[0].match(/class="nz-rank"[^>]*>([\s\S]*?)<\/span>/i);
    const nameMatch = cells[0].match(/class="nz-player-name"[^>]*>([\s\S]*?)<\/span>\s*<\/a>/i) || cells[0].match(/class="nz-player-name"[^>]*>([\s\S]*?)<\/span>/i);
    const rank = num(rankMatch ? cellText(rankMatch[1]) : out.length + 1) || out.length + 1;
    const name = cellText(nameMatch ? nameMatch[1].replace(/<span class="nzlay-vip-tag">[\s\S]*?<\/span>/i, "") : cells[0]).slice(0, 40);
    if (!name) return;
    out.push({ rank, name, kills: num(cellText(cells[1])), kdr: num(cellText(cells[2])), deaths: num(cellText(cells[3])), total: num(cellText(cells[4])) });
  });
  return out.slice(0, 100);
}

export function foldName(value) {
  return squash(value).toLowerCase();
}

/* NZlay profile pages embed `var profileStatsA = {daily, monthly, total}`.
   Read the object without running anything, then add up what the
   achievements need. Returns null when the shape changes. Field names are
   matched loosely so a renamed weapon key still counts. */
function objectAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length && i - start < 200000; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch (err) { return null; }
    }
  }
  return null;
}

function numbers(obj, path, out) {
  if (!obj || typeof obj !== "object") return out;
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const name = (path ? path + "." : "") + key;
    if (value && typeof value === "object") numbers(value, name, out);
    else if (isFinite(Number(value)) && value !== "" && value !== null && typeof value !== "boolean") out.push([name.toLowerCase(), Number(value)]);
  });
  return out;
}

export function parseProfileStats(html) {
  const data = objectAfter(String(html || ""), "profileStatsA");
  if (!data || typeof data !== "object" || !data.total || typeof data.total !== "object") return null;
  const flat = numbers(data.total, "", []);
  const sum = (test) => flat.filter(([k]) => test(k)).reduce((n, [, v]) => n + Math.max(0, v), 0);
  const leaf = (k) => k.split(".").pop();
  const weapons = {};
  flat.forEach(([k, v]) => {
    const parts = k.split(".");
    const last = parts[parts.length - 1];
    // kills.<weapon> or <weapon>.kills or kills_<weapon> / <weapon>_kills
    let weapon = "";
    if (parts.length > 1 && /^kills?$/.test(parts[parts.length - 2]) && !/total|all|head/.test(last)) weapon = last;
    else if (parts.length > 1 && /^kills?$/.test(last) && /weapon|gun/.test(k)) weapon = parts[parts.length - 2];
    else { const m = last.match(/^kills?_(.+)$|^(.+?)_kills?$/); if (m && !/total|all|head|multi|double|triple|quad|streak/.test(last)) weapon = m[1] || m[2]; }
    if (weapon && /^[a-z0-9_ -]{1,24}$/.test(weapon)) weapons[weapon] = (weapons[weapon] || 0) + Math.max(0, v);
  });
  const weaponTotal = Object.values(weapons).reduce((n, v) => n + v, 0);
  const killsDirect = sum((k) => /^(total_)?kills?$/.test(leaf(k)) && k.split(".").length === 1);
  const kills = killsDirect || weaponTotal;
  const head = sum((k) => /head/.test(leaf(k)) && /hit|shot|kill/.test(k));
  const hits = sum((k) => /(^|\.)(hits?|body_?hits?)\./.test(k) || /^hits?(_total)?$/.test(leaf(k))) || sum((k) => /hit/.test(k) && /head|body|chest|leg|arm|torso/.test(k));
  const multi = sum((k) => /double|triple|quad|penta|multi/.test(leaf(k)) && /kill/.test(k));
  const matchesWon = sum((k) => /(matches?|games?)_?won|^wins?$/.test(leaf(k)));
  const roundsWon = sum((k) => /rounds?_?won/.test(leaf(k)));
  const best = Object.keys(weapons).sort((a, b) => weapons[b] - weapons[a])[0] || "";
  return {
    kills,
    weapons,
    weaponBest: best ? weapons[best] : 0,
    favouriteWeapon: best,
    hits,
    headshots: head,
    headshotRate: hits ? Math.round((head / hits) * 1000) / 10 : 0,
    multiKills: multi,
    matchesWon,
    roundsWon
  };
}

const api = { ROOM_MAX, MESSAGE_MAX, ROOM_SOURCE, CLAN_ROOM_SOURCE, ONLINE_SOURCE, PROFILE_SOURCE, TOP_SOURCE, DIRECT_JOIN, CURATED_ROOMS, cleanRoom, maskRough, checkMessage, roomsFromList, roomRegion, parseProfileStats, ACHIEVEMENTS, ACHIEVEMENT_IDS, unlocked, localParts, isNightOwl, inQuiet, parseTop, foldName };
globalThis.ReGoneShared = api;
