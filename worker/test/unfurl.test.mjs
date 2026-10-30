import assert from "node:assert/strict";
import test from "node:test";
import { handleUnfurl, youtubeVideoId } from "../src/unfurl.js";

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

const PAGE = `<html><head><meta property="og:title" content="Fixture title"><meta property="og:image" content="/a.jpg"><meta name="twitter:card" content="summary_large_image"></head><body>`;

function site(routes, seen) {
  return async (url, init) => {
    seen.push({ url: String(url), ua: init && init.headers && init.headers["user-agent"] });
    const route = routes[String(url)];
    if (!route) return new Response("no", { status: 404 });
    if (route.redirect) return new Response(null, { status: 301, headers: { location: route.redirect } });
    return new Response(route.body, { status: 200, headers: { "content-type": route.type || "text/html" } });
  };
}

const req = (target) => new Request("https://api.test/v1/unfurl?url=" + encodeURIComponent(target));

test("unfurl reads tags once, then answers from the edge cache and R2", async () => {
  const seen = [];
  const cache = memoryCache();
  const r2 = bucket();
  const deps = { fetch: site({ "https://news.example.com/a": { body: PAGE } }, seen), cache, r2, now: () => 1000 };
  const first = await (await handleUnfurl(req("https://news.example.com/a"), deps)).json();
  assert.equal(first.title, "Fixture title");
  assert.equal(first.image, "https://news.example.com/a.jpg");
  assert.equal(first.large, true);
  assert.match(seen[0].ua, /Twitterbot/);
  await handleUnfurl(req("https://news.example.com/a"), deps);
  assert.equal(seen.length, 1);
  cache.store.clear();
  const fromR2 = await (await handleUnfurl(req("https://news.example.com/a"), deps)).json();
  assert.equal(fromR2.title, "Fixture title");
  assert.equal(seen.length, 1);
  assert.equal(r2.store.size, 1);
});

test("unfurl caches a failure and never writes it to R2", async () => {
  const seen = [];
  const deps = { fetch: site({}, seen), cache: memoryCache(), r2: bucket(), now: () => 1 };
  const body = await (await handleUnfurl(req("https://gone.example.com/x"), deps)).json();
  assert.equal(body.none, true);
  await handleUnfurl(req("https://gone.example.com/x"), deps);
  assert.equal(seen.length, 1);
  assert.equal(deps.r2.store.size, 0);
});

test("unfurl refuses private targets, including redirects to them", async () => {
  const seen = [];
  const deps = { fetch: site({ "https://short.example.com/r": { redirect: "http://127.0.0.1/admin" } }, seen), cache: memoryCache(), r2: null };
  for (const bad of ["http://localhost/", "http://10.0.0.1/", "file:///etc/hosts", "https://a.internal/", "https://user:pw@example.com/", "http://[::1]/"]) {
    assert.equal((await handleUnfurl(req(bad), deps)).status, 400, bad);
  }
  const body = await (await handleUnfurl(req("https://short.example.com/r"), deps)).json();
  assert.equal(body.none, true);
  assert.equal(seen.length, 1);
});

test("YouTube links use oEmbed and a video card", async () => {
  assert.equal(youtubeVideoId(new URL("https://youtu.be/abcdefghijk")), "abcdefghijk");
  assert.equal(youtubeVideoId(new URL("https://www.youtube.com/shorts/abcdefghijk")), "abcdefghijk");
  const seen = [];
  const deps = { fetch: async (url) => { seen.push(url); return new Response(JSON.stringify({ title: "Clip", author_name: "Chan" }), { headers: { "content-type": "application/json" } }); }, cache: memoryCache(), r2: null };
  const body = await (await handleUnfurl(req("https://www.youtube.com/watch?v=abcdefghijk"), deps)).json();
  assert.equal(body.title, "Clip");
  assert.equal(body.youtube, "abcdefghijk");
  assert.equal(body.large, true);
  assert.match(seen[0], /youtube\.com\/oembed/);
});

test("unfurl keeps the og:video player type and reads an oEmbed video player", async () => {
  const seen = [];
  const og = `<html><head><meta property="og:title" content="Clip"><meta property="og:video:url" content="https://tube.example/videos/embed/fake-0001"><meta property="og:video:type" content="text/html"><meta property="og:video:width" content="1280"><meta property="og:video:height" content="720"><link rel="alternate" type="application/json+oembed" href="/services/oembed?url=x"></head>`;
  const rumbleLike = `<html><head><meta property="og:title" content="Clip two"><link rel="alternate" type="application/json+oembed" href="https://video.example/api/oembed.json?url=fake"></head>`;
  const oembed = JSON.stringify({ type: "video", width: 640, height: 360, html: '<iframe src="https://video.example/embed/vfake0/?pub=fake" width="640" height="360"></iframe>' });
  const deps = { fetch: site({
    "https://tube.example/w/fake-0001": { body: og },
    "https://video.example/vfake-title.html": { body: rumbleLike },
    "https://video.example/api/oembed.json?url=fake": { body: oembed, type: "application/json" }
  }, seen) };
  const first = await (await handleUnfurl(req("https://tube.example/w/fake-0001"), deps)).json();
  assert.equal(first.video, "https://tube.example/videos/embed/fake-0001");
  assert.equal(first.videoType, "text/html");
  assert.equal(first.videoWidth, 1280);
  assert.equal(first.oembed, undefined);
  assert.equal(first.embed, undefined);
  assert.ok(!seen.some((row) => /services\/oembed/.test(row.url)), "a page with an html player needs no oEmbed fetch");
  const second = await (await handleUnfurl(req("https://video.example/vfake-title.html"), deps)).json();
  assert.deepEqual(second.embed, { src: "https://video.example/embed/vfake0/?pub=fake", width: 640, height: 360 });
});

test("an oEmbed answer that is not a video, or not https, adds no player", async () => {
  const page = (href) => `<html><head><meta property="og:title" content="T"><link rel="alternate" type="application/json+oembed" href="${href}"></head>`;
  const deps = { fetch: site({
    "https://a.example/p": { body: page("https://a.example/o") },
    "https://a.example/o": { body: JSON.stringify({ type: "rich", html: '<iframe src="https://a.example/e"></iframe>' }), type: "application/json" },
    "https://b.example/p": { body: page("https://b.example/o") },
    "https://b.example/o": { body: JSON.stringify({ type: "video", html: '<iframe src="http://b.example/e"></iframe>' }), type: "application/json" }
  }, []) };
  assert.equal((await (await handleUnfurl(req("https://a.example/p"), deps)).json()).embed, undefined);
  assert.equal((await (await handleUnfurl(req("https://b.example/p"), deps)).json()).embed, undefined);
});
