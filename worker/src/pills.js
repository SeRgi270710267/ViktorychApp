/* Fallback for pill sources the browser cannot call.
   Open-Meteo geocoding sends no CORS header. MET Norway rejects a browser
   User-Agent. ESPN and TheSportsDB are fetched here only after the page
   itself fails. Nothing here is an open proxy: each path is a fixed host
   and a checked parameter. Cache entries older than the freshness window
   are not returned. */

import {
  WEATHER_FRESH_MS,
  SPORTS_LIVE_FRESH_MS,
  SPORTS_IDLE_FRESH_MS,
  allowedLeague,
  allowedDates,
  geocodeUrl,
  openMeteoUrl,
  metNoUrl,
  espnUrl,
  sportsDbUrl,
  parseEspnScoreboard,
  parseSportsDb
} from "../../shared/pill-data.js";

function roundCoord(value) {
  return Math.round(Number(value) * 100) / 100;
}

const APP_UA = "ViktorychApp/1.0 (+https://viktorychgroup.github.io/ViktorychApp)";
const GEO_FRESH_MS = 24 * 60 * 60 * 1000;

function jsonResponse(status, body, extra) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (extra) Object.keys(extra).forEach((key) => { headers[key] = extra[key]; });
  return new Response(JSON.stringify(body), { status: status, headers: headers });
}

function cacheKey(url) {
  return new Request("https://pills-cache.internal" + url);
}

async function etagOf(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let hex = "";
  const bytes = new Uint8Array(digest);
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return '"' + hex + '"';
}

async function readFresh(cache, key, now) {
  if (!cache || typeof cache.match !== "function") return null;
  try {
    const hit = await cache.match(cacheKey(key));
    if (!hit) return null;
    const at = Number(hit.headers.get("x-fetched-at") || 0);
    const maxAge = Number(hit.headers.get("x-fresh-ms") || 0);
    if (!at || !maxAge || now - at > maxAge) return null;
    return hit;
  } catch (err) {
    return null;
  }
}

async function writeFresh(cache, key, response, fetchedAt, maxAge) {
  if (!cache || typeof cache.put !== "function") return;
  try {
    const copy = response.clone();
    const headers = new Headers(copy.headers);
    headers.set("x-fetched-at", String(fetchedAt));
    headers.set("x-fresh-ms", String(maxAge));
    headers.set("cache-control", "public, max-age=" + String(Math.max(1, Math.round(maxAge / 1000))));
    await cache.put(cacheKey(key), new Response(copy.body, { status: copy.status, headers: headers }));
  } catch (err) { /* the caller still returns this response */ }
}

async function upstream(fetchImpl, url, headers) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: headers || { accept: "application/json", "user-agent": APP_UA },
    redirect: "follow"
  });
  if (!response || !response.ok) {
    const error = new Error("upstream");
    error.status = response ? response.status : 0;
    throw error;
  }
  return response.text();
}

function withFetched(text, fetchedAt, maxAge, etag) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=" + String(Math.max(1, Math.round(maxAge / 1000))),
    "etag": etag,
    "x-fetched-at": String(fetchedAt),
    "x-fresh-ms": String(maxAge),
    "x-content-type-options": "nosniff"
  };
  return new Response(text, { status: 200, headers: headers });
}

async function serveCached(request, hit) {
  const etag = hit.headers.get("etag") || "";
  const inm = request.headers.get("if-none-match") || "";
  if (etag && inm && inm === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: etag,
        "x-fetched-at": hit.headers.get("x-fetched-at") || "",
        "cache-control": hit.headers.get("cache-control") || "no-store"
      }
    });
  }
  return new Response(hit.body, { status: 200, headers: new Headers(hit.headers) });
}

function coord(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

async function handleWeather(url, fetchImpl, cache, now, request) {
  const lat = coord(url.searchParams.get("lat"));
  const lon = coord(url.searchParams.get("lon"));
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return jsonResponse(400, { ok: false, error: "coords" });
  }
  const key = "/weather?lat=" + roundCoord(lat) + "&lon=" + roundCoord(lon);
  const hit = await readFresh(cache, key, now);
  if (hit) return serveCached(request, hit);
  let text = "";
  let source = "";
  try {
    text = await upstream(fetchImpl, openMeteoUrl(lat, lon));
    const parsed = JSON.parse(text);
    if (!parsed || parsed.error || !parsed.current) throw new Error("open-meteo");
    source = "open-meteo";
  } catch (err) {
    try {
      text = await upstream(fetchImpl, metNoUrl(lat, lon));
      const parsed = JSON.parse(text);
      if (!parsed || !parsed.properties || !parsed.properties.timeseries) throw new Error("metno");
      source = "metno";
    } catch (second) {
      return jsonResponse(502, { ok: false, error: "unavailable" });
    }
  }
  const body = JSON.stringify({ ok: true, source: source, fetchedAt: now, payload: JSON.parse(text) });
  const etag = await etagOf(source + ":" + text);
  const response = withFetched(body, now, WEATHER_FRESH_MS, etag);
  await writeFresh(cache, key, response, now, WEATHER_FRESH_MS);
  return serveCached(request, response);
}

function sportsTtl(provider, text) {
  try {
    const json = JSON.parse(text);
    const parsed = provider === "sportsdb" ? parseSportsDb(json, 0) : parseEspnScoreboard(json, 0);
    const live = (parsed.matches || []).some((match) => match.status === "live" || match.status === "halftime");
    return live ? SPORTS_LIVE_FRESH_MS : SPORTS_IDLE_FRESH_MS;
  } catch (err) {
    return SPORTS_IDLE_FRESH_MS;
  }
}

async function handleSports(url, fetchImpl, cache, now, request) {
  const provider = String(url.searchParams.get("provider") || "");
  let upstreamUrl = "";
  let key = "";
  if (provider === "espn") {
    const league = String(url.searchParams.get("league") || "");
    const dates = String(url.searchParams.get("dates") || "");
    if (!allowedLeague(league) || (dates && !allowedDates(dates))) return jsonResponse(400, { ok: false, error: "league" });
    upstreamUrl = espnUrl(league, dates);
    key = "/sports?provider=espn&league=" + league + "&dates=" + dates;
  } else if (provider === "sportsdb") {
    const team = String(url.searchParams.get("team") || "");
    const kind = url.searchParams.get("kind") === "last" ? "last" : "next";
    if (!/^\d{1,12}$/.test(team)) return jsonResponse(400, { ok: false, error: "team" });
    upstreamUrl = sportsDbUrl(team, kind);
    key = "/sports?provider=sportsdb&team=" + team + "&kind=" + kind;
  } else {
    return jsonResponse(400, { ok: false, error: "provider" });
  }
  const hit = await readFresh(cache, key, now);
  if (hit) return serveCached(request, hit);
  let text = "";
  try {
    text = await upstream(fetchImpl, upstreamUrl);
    JSON.parse(text);
  } catch (err) {
    return jsonResponse(502, { ok: false, error: "unavailable" });
  }
  const ttl = sportsTtl(provider, text);
  const body = JSON.stringify({ ok: true, source: provider, fetchedAt: now, payload: JSON.parse(text) });
  const etag = await etagOf(provider + ":" + text);
  const response = withFetched(body, now, ttl, etag);
  await writeFresh(cache, key, response, now, ttl);
  return serveCached(request, response);
}

async function handleGeocode(url, fetchImpl, cache, now, request) {
  const name = String(url.searchParams.get("name") || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return jsonResponse(400, { ok: false, error: "name" });
  const key = "/geocode?name=" + encodeURIComponent(name.toLowerCase());
  const hit = await readFresh(cache, key, now);
  if (hit) return serveCached(request, hit);
  let parsed = null;
  try {
    parsed = JSON.parse(await upstream(fetchImpl, geocodeUrl(name)));
  } catch (err) {
    return jsonResponse(502, { ok: false, error: "unavailable" });
  }
  const results = ((parsed && parsed.results) || []).slice(0, 5).map((row) => ({
    name: row.name || "",
    country: row.country || "",
    lat: row.latitude,
    lon: row.longitude
  })).filter((row) => row.name && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)));
  const body = JSON.stringify({ ok: true, source: "open-meteo", fetchedAt: now, results: results });
  const etag = await etagOf(body);
  const response = withFetched(body, now, GEO_FRESH_MS, etag);
  await writeFresh(cache, key, response, now, GEO_FRESH_MS);
  return serveCached(request, response);
}

export async function handlePills(request, deps) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse(405, { ok: false, error: "method" });
  const fetchImpl = deps && deps.fetch;
  const cache = deps && deps.cache;
  const now = deps && typeof deps.now === "function" ? deps.now() : Date.now();
  if (typeof fetchImpl !== "function") return jsonResponse(500, { ok: false, error: "unavailable" });
  if (path === "/v1/pills/weather") return handleWeather(url, fetchImpl, cache, now, request);
  if (path === "/v1/pills/sports") return handleSports(url, fetchImpl, cache, now, request);
  if (path === "/v1/pills/geocode") return handleGeocode(url, fetchImpl, cache, now, request);
  return jsonResponse(404, { ok: false, error: "not_found" });
}

export { sportsTtl, APP_UA };
