import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const href = spec.startsWith("/") ? pathToFileURL(spec).href : spec;
  const mod = await import(href);
  return mod.chromium || (mod.default && mod.default.chromium);
}

/* Local-first across the app: every route that painted real content once
   repaints that screen at once on the next open, even with the network hanging
   or offline, and never shows a loading placeholder while it has a copy. A
   route that never finished loading in this sandbox is reported, not failed. */
const ROUTES = [
  "#/", "#/?tab=following", "#/explore", "#/explore?q=placeholder", "#/notifications", "#/messages",
  "#/@placeholder_person", "#/bsky/placeholder.example", "#/lists", "#/history/bookmarks", "#/history",
  "#/music", "#/settings", "#/communities", "#/store", "#/points", "#/sources", "#/subscriptions", "#/online"
];

/* A public profile served by a stand-in for the Bluesky public API, so one
   route always has real data to cache in this sandbox. */
const SKY = "placeholder.example";
function bsky(url) {
  const at = new Date(Date.now() - 3600 * 1000).toISOString();
  if (/getProfile/.test(url.pathname)) return { did: "did:plc:placeholder", handle: SKY, displayName: "Placeholder Sky", description: "Placeholder bio", followersCount: 12, followsCount: 3, postsCount: 2 };
  if (/getAuthorFeed/.test(url.pathname)) return { feed: [1, 2].map((n) => ({ post: { uri: "at://did:plc:placeholder/app.bsky.feed.post/p" + n, cid: "c" + n, author: { did: "did:plc:placeholder", handle: SKY, displayName: "Placeholder Sky" }, record: { text: "Placeholder sky post " + n, createdAt: at }, indexedAt: at, likeCount: n, replyCount: 0, repostCount: 0 } })) };
  return {};
}

function watchPlaceholders() {
  window.__loadingSeen = [];
  const isLoading = () => {
    const el = document.querySelector(".tab-loading, [role=progressbar], .reply-empty");
    if (!el) return "";
    if (!el.matches(".reply-empty") || /Loading|\u2026/.test(el.textContent || "")) return el.className || "progress";
    return "";
  };
  const fetching = () => Array.from(document.querySelectorAll(".empty h2")).some((h) => /Fetching/.test(h.textContent || ""));
  const watch = () => {
    const hit = isLoading() || (fetching() ? "fetching" : "");
    if (hit && window.__armed) window.__loadingSeen.push(location.hash + " " + hit);
  };
  new MutationObserver(watch).observe(document, { childList: true, subtree: true, characterData: true });
  window.__state = () => (isLoading() || fetching() ? "loading" : "ready");
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const report = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.addInitScript(() => {
      localStorage.setItem("viktorychapp-lang-user-picked", "1");
      localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    });
    await context.addInitScript(watchPlaceholders);
    let mode = "online";
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const local = url.origin === origin;
      const data = !local || /\.json$/.test(url.pathname) || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/data/");
      if (!data) return route.continue();
      if (mode === "online") {
        if (local) return route.continue();
        if (url.hostname === "public.api.bsky.app") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bsky(url)) });
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      if (mode === "hang") return; /* never answers */
      return route.abort("internetdisconnected");
    });
    const page = await context.newPage();
    const ready = [];
    for (const hash of ROUTES) {
      await page.goto(origin + "/" + hash, { waitUntil: "domcontentloaded" });
      let state = "loading";
      for (let i = 0; i < 20 && state !== "ready"; i++) {
        await page.waitForTimeout(250);
        state = await page.evaluate(() => (window.__state ? window.__state() : "loading"));
      }
      await page.waitForTimeout(700); /* let the screen be saved */
      if (state === "ready") ready.push(hash);
      else report.push(hash + " never finished loading online here");
    }
    if (ready.length < 8) fail("too few routes rendered in the sandbox: " + ready.join(", "));
    if (ready.indexOf("#/bsky/" + SKY) < 0) fail("the stand-in profile never rendered online: " + report.join("; "));
    const index = await page.evaluate(() => JSON.parse(localStorage.getItem("viktorych-swr-v1-index") || "{}"));
    const bytes = Object.keys(index).reduce((n, k) => n + (index[k].b || 0), 0);
    if (bytes > 1500000) fail("route cache is over budget: " + bytes);

    for (mode of ["hang", "offline"]) {
      for (const hash of ready) {
        await page.goto("about:blank");
        await page.goto(origin + "/" + hash, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => { window.__armed = true; window.__loadingSeen = window.__loadingSeen || []; });
        await page.waitForTimeout(1200);
        const seen = await page.evaluate(() => window.__loadingSeen.slice());
        const now = await page.evaluate(() => window.__state());
        if (seen.length || now !== "ready") fail(mode + " " + hash + " showed a loading placeholder although this device has the page: " + (seen[0] || now));
      }
    }
    if (report.length) console.log("not cached in this sandbox: " + report.join("; "));
    console.log("routes local-first ok (" + ready.length + " routes, " + Object.keys(index).length + " cached entries, " + bytes + " bytes)");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
