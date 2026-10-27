import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { handlePills, APP_UA } from "../src/pills.js";
import { WEATHER_FRESH_MS, SPORTS_LIVE_FRESH_MS, SPORTS_IDLE_FRESH_MS } from "../../shared/pill-data.js";

function fixture(name) {
  return fs.readFileSync(new URL("../../scripts/fixtures/pills/" + name, import.meta.url), "utf8");
}

function memoryCache() {
  const store = new Map();
  return {
    async match(request) {
      const hit = store.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      store.set(request.url, response.clone());
    }
  };
}

function calls() {
  const seen = [];
  return {
    seen: seen,
    fetch(routes) {
      return async function (url, init) {
        seen.push({ url: String(url), ua: (init && init.headers && init.headers["user-agent"]) || "" });
        const target = String(url);
        const route = routes.find((row) => target.includes(row.match));
        if (!route) return new Response("no", { status: 404 });
        if (route.network) throw new Error("network");
        return new Response(route.body, { status: route.status, headers: { "content-type": "application/json" } });
      };
    }
  };
}

function ask(path, bag, headers) {
  return handlePills(new Request("https://accounts.test" + path, { headers: headers || {} }), bag);
}

test("weather uses MET Norway when Open-Meteo is rate limited", async () => {
  const log = calls();
  const res = await ask("/v1/pills/weather?lat=59.33&lon=18.07", {
    fetch: log.fetch([
      { match: "open-meteo.com", status: 429, body: fixture("open-meteo-429.json") },
      { match: "met.no", status: 200, body: fixture("met-no-compact.json") }
    ]),
    cache: memoryCache(),
    now: () => 1_700_000_000_000
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "metno");
  assert.equal(body.payload.properties.timeseries[0].data.instant.details.air_temperature, 7.1);
  assert.equal(log.seen.length, 2);
  assert.equal(log.seen[1].ua, APP_UA);
  assert.equal(res.headers.get("cache-control"), "public, max-age=" + String(WEATHER_FRESH_MS / 1000));
  assert.equal(JSON.stringify(body).includes("14°"), false);
});

test("both weather sources failing returns no invented observation", async () => {
  const log = calls();
  const res = await ask("/v1/pills/weather?lat=59.33&lon=18.07", {
    fetch: log.fetch([
      { match: "open-meteo.com", status: 429, body: fixture("open-meteo-429.json") },
      { match: "met.no", status: 403, body: "<html>forbidden</html>" }
    ]),
    cache: memoryCache(),
    now: () => 1_700_000_000_000
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.temp, undefined);
  assert.equal(body.payload, undefined);
});

test("a fresh cache entry is served and an expired one is fetched again", async () => {
  const log = calls();
  const cache = memoryCache();
  let now = 1_700_000_000_000;
  const bag = {
    fetch: log.fetch([{ match: "open-meteo.com", status: 200, body: fixture("open-meteo-stockholm.json") }]),
    cache: cache,
    now: () => now
  };
  const first = await ask("/v1/pills/weather?lat=59.33&lon=18.07", bag);
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  const again = await ask("/v1/pills/weather?lat=59.33&lon=18.07", bag, { "if-none-match": etag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get("x-fetched-at"), String(now));
  assert.equal(log.seen.length, 1);
  now += WEATHER_FRESH_MS + 1;
  const third = await ask("/v1/pills/weather?lat=59.33&lon=18.07", bag);
  assert.equal(third.status, 200);
  assert.equal(log.seen.length, 2);
  assert.equal(third.headers.get("x-fetched-at"), String(now));
});

test("sports rejects an open league and caches a live board for 45 seconds", async () => {
  const log = calls();
  const denied = await ask("/v1/pills/sports?provider=espn&league=http://evil&dates=20261027-20261103", {
    fetch: log.fetch([]),
    cache: memoryCache(),
    now: () => 1
  });
  assert.equal(denied.status, 400);
  assert.equal(log.seen.length, 0);
  const live = await ask("/v1/pills/sports?provider=espn&league=esp.1&dates=20261026-20261103", {
    fetch: log.fetch([{ match: "espn.com", status: 200, body: fixture("espn-live.json") }]),
    cache: memoryCache(),
    now: () => 1_700_000_000_000
  });
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("cache-control"), "public, max-age=" + String(SPORTS_LIVE_FRESH_MS / 1000));
  const idle = await ask("/v1/pills/sports?provider=espn&league=esp.1&dates=20261026-20261103", {
    fetch: log.fetch([{ match: "espn.com", status: 200, body: fixture("espn-scheduled.json") }]),
    cache: memoryCache(),
    now: () => 1_700_000_000_000
  });
  assert.equal(idle.headers.get("cache-control"), "public, max-age=" + String(SPORTS_IDLE_FRESH_MS / 1000));
  const down = await ask("/v1/pills/sports?provider=sportsdb&team=133739&kind=next", {
    fetch: log.fetch([{ match: "thesportsdb.com", status: 500, body: "{}" }]),
    cache: memoryCache(),
    now: () => 1
  });
  assert.equal(down.status, 502);
});

test("geocoding is proxied without inventing a coordinate", async () => {
  const log = calls();
  const res = await ask("/v1/pills/geocode?name=Stockholm", {
    fetch: log.fetch([{ match: "geocoding-api.open-meteo.com", status: 200, body: fixture("geocode-stockholm.json") }]),
    cache: memoryCache(),
    now: () => 1_700_000_000_000
  });
  const body = await res.json();
  assert.equal(body.results[0].name, "Stockholm");
  assert.equal(body.results[0].lat, 59.32932);
  const bad = await ask("/v1/pills/geocode?name=x", {
    fetch: log.fetch([]),
    cache: memoryCache(),
    now: () => 1
  });
  assert.equal(bad.status, 400);
});
