import assert from "node:assert/strict";
import test from "node:test";
import { handleYtm, resetYtmState, initialData, pageItems, parseDuration, parseClock, cleanArtist, bestMatch, spotifyId, collectionKind, CHARTS } from "../src/ytmusic.js";

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(request) { const hit = store.get(request.url); return hit ? hit.clone() : undefined; },
    async put(request, response) { store.set(request.url, response.clone()); }
  };
}

function bucket() {
  const store = new Map();
  return { store, async get(key) { return store.has(key) ? { text: async () => store.get(key) } : null; }, async put(key, value) { store.set(key, value); } };
}

const ART = "UC" + "a".repeat(22);
const ART2 = "UC" + "b".repeat(22);
const V1 = "AAAAAAAAAAA";
const V2 = "BBBBBBBBBBB";
const V3 = "CCCCCCCCCCC";

function html(data) { return "<html><script>var ytInitialData = " + JSON.stringify(data) + ";</script></html>"; }

function videoRenderer(id, title, by, clock) {
  return { videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: by, navigationEndpoint: { browseEndpoint: { browseId: ART } } }] }, lengthText: { simpleText: clock } } };
}

const SEARCH_PAGE = html({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
  videoRenderer(V1, "Song One (Official Video)", "Band VEVO", "3:30"),
  videoRenderer(V2, "Song One (Live)", "Band", "5:10"),
  { channelRenderer: { channelId: ART2, title: { simpleText: "Band - Topic" }, thumbnail: { thumbnails: [{ url: "//yt3.example/a.jpg", width: 88 }] } } }
] } }] } } } } });

const PLAYLIST_PAGE = html({
  metadata: { playlistMetadataRenderer: { title: "Top 100 Songs Global" } },
  contents: { list: [{ lockupViewModel: { contentId: V3, contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentImage: { badge: { text: "4:48" } }, metadata: { lockupMetadataViewModel: { title: { content: "Chart Song" }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "Chart Artist", commandRuns: [{ onTap: { browseEndpoint: { browseId: ART } } }] } }] }, { metadataParts: [{ text: { content: "1M" } }] }] } } } } } }] }
});

function web(routes, seen) {
  return async (url) => {
    const u = String(url);
    seen.push(u);
    for (const [part, route] of Object.entries(routes)) {
      if (u.indexOf(part) >= 0) {
        const r = typeof route === "function" ? route(u) : route;
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status || 200 });
      }
    }
    return new Response("no", { status: 404 });
  };
}

const req = (path) => new Request("https://api.test/v1/ytm/" + path);

test("helpers parse durations, artists, ids and kinds", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT4M"), 240);
  assert.equal(parseClock("4:48"), 288);
  assert.equal(parseClock("1:02:03"), 3723);
  assert.equal(cleanArtist("Band - Topic"), "Band");
  assert.equal(cleanArtist("BandVEVO"), "Band");
  assert.equal(spotifyId("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x"), "37i9dQZF1DXcBWIGoYBM5M");
  assert.equal(spotifyId("javascript:alert(1)"), "");
  assert.equal(collectionKind("OLAK5uy_abc"), "album");
  assert.equal(collectionKind("PLabc"), "playlist");
});

test("public page parser reads videos, channels and lockup videos", () => {
  const items = pageItems(initialData(SEARCH_PAGE));
  assert.equal(items.songs.length, 2);
  assert.equal(items.songs[0].id, V1);
  assert.equal(items.songs[0].artist, "Band");
  assert.equal(items.songs[0].duration, 210);
  assert.equal(items.artists[0].id, ART2);
  assert.equal(items.artists[0].name, "Band");
  const list = pageItems(initialData(PLAYLIST_PAGE));
  assert.equal(list.songs[0].id, V3);
  assert.equal(list.songs[0].artist, "Chart Artist");
  assert.equal(list.songs[0].duration, 288);
  assert.equal(initialData("<html>nothing</html>"), null);
});

test("bestMatch prefers the studio cut over live versions", () => {
  const items = pageItems(initialData(SEARCH_PAGE));
  const pick = bestMatch(items.songs.slice().reverse(), { title: "Song One", artist: "Band", duration: 212 });
  assert.equal(pick.id, V1);
});

test("search without a key uses public pages, then answers from the edge cache", async () => {
  resetYtmState();
  const seen = [];
  const cache = memoryCache();
  const deps = { fetch: web({ "youtube.com/results": { body: SEARCH_PAGE } }, seen), cache, r2: bucket(), now: () => 1000 };
  const first = await (await handleYtm(req("search?q=song%20one"), {}, deps)).json();
  assert.equal(first.lane, "page");
  assert.equal(first.songs.length, 2);
  const again = await (await handleYtm(req("search?q=Song%20One"), {}, deps)).json();
  assert.equal(again.songs.length, 2);
  assert.equal(seen.length, 1, "second search is a cache hit");
  assert.ok(!seen.some((u) => u.indexOf("googleapis") >= 0));
});

test("a quota error parks the key until the daily reset and falls back to pages", async () => {
  resetYtmState();
  const seen = [];
  const now = Date.UTC(2026, 9, 29, 10, 0, 0);
  const deps = {
    fetch: web({
      "googleapis.com/youtube/v3/search": { status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }] } } },
      "youtube.com/results": { body: SEARCH_PAGE }
    }, seen),
    cache: null, r2: null, now: () => now
  };
  const env = { YT_API_KEY: "test-key" };
  const first = await (await handleYtm(req("search?q=a"), env, deps)).json();
  assert.equal(first.lane, "page");
  const apiCalls = () => seen.filter((u) => u.indexOf("googleapis") >= 0).length;
  assert.equal(apiCalls(), 1);
  await handleYtm(req("search?q=b"), env, deps);
  assert.equal(apiCalls(), 1, "key stays parked after quota");
  const config = await (await handleYtm(req("config"), env, deps)).json();
  assert.equal(config.catalog, "public");
  assert.ok(!JSON.stringify(seen).includes("test-key") || seen.filter((u) => u.includes("test-key")).every((u) => u.startsWith("https://www.googleapis.com/")));
});

test("search with a key reads the Data API and fills durations from videos", async () => {
  resetYtmState();
  const seen = [];
  const deps = {
    fetch: web({
      "v3/search": { body: { items: [{ id: { videoId: V1 }, snippet: { title: "x" } }, { id: { channelId: ART }, snippet: { title: "Band", thumbnails: { default: { url: "https://yt3.example/c.jpg", width: 88 } } } }] } },
      "v3/videos": { body: { items: [{ id: V1, snippet: { title: "Song One", channelTitle: "Band - Topic", channelId: ART }, contentDetails: { duration: "PT3M30S" } }] } }
    }, seen),
    cache: null, r2: null, now: () => 1000
  };
  const body = await (await handleYtm(req("search?q=song&type=all"), { YT_API_KEY: "k" }, deps)).json();
  assert.equal(body.lane, "key");
  assert.equal(body.songs[0].duration, 210);
  assert.equal(body.songs[0].artist, "Band");
  assert.equal(body.artists[0].id, ART);
});

test("charts read the YouTube Music chart playlist for the region", async () => {
  resetYtmState();
  const seen = [];
  const deps = { fetch: web({ "youtube.com/playlist": { body: PLAYLIST_PAGE } }, seen), cache: null, r2: null, now: () => 1000 };
  const body = await (await handleYtm(req("charts?region=IN"), {}, deps)).json();
  assert.equal(body.chart, CHARTS.IN);
  assert.equal(body.songs[0].id, V3);
  assert.ok(seen[0].indexOf(CHARTS.IN) > 0);
});

test("bad input is rejected and outages answer 502 without leaking", async () => {
  resetYtmState();
  const deps = { fetch: async () => { throw new Error("down"); }, cache: null, r2: null, now: () => 1000 };
  assert.equal((await handleYtm(req("search?q="), {}, deps)).status, 400);
  assert.equal((await handleYtm(req("artist?id=nope"), {}, deps)).status, 400);
  assert.equal((await handleYtm(req("radio?id=../x"), {}, deps)).status, 400);
  assert.equal((await handleYtm(req("mood?key=nope"), {}, deps)).status, 400);
  assert.equal((await handleYtm(req("spotify?id=x"), {}, deps)).status, 503);
  const down = await handleYtm(req("artist?id=" + ART), {}, deps);
  assert.equal(down.status, 502);
  assert.equal((await handleYtm(req("nothing"), {}, deps)).status, 404);
});

test("spotify import reads tracks with client credentials", async () => {
  resetYtmState();
  const seen = [];
  const deps = {
    fetch: web({
      "accounts.spotify.com": { body: { access_token: "tok", expires_in: 3600 } },
      "/tracks?": { body: { items: [{ track: { name: "Song One", duration_ms: 210000, artists: [{ name: "Band" }], album: { name: "LP" } } }], next: null } },
      "api.spotify.com/v1/playlists/": { body: { name: "Mix" } }
    }, seen),
    cache: null, r2: null, now: () => 1000
  };
  const body = await (await handleYtm(req("spotify?id=37i9dQZF1DXcBWIGoYBM5M"), { SPOTIFY_CLIENT_ID: "a", SPOTIFY_CLIENT_SECRET: "b" }, deps)).json();
  assert.equal(body.name, "Mix");
  assert.equal(body.tracks[0].duration, 210);
});
