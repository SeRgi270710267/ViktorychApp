/* Custom Home tabs never fall back to "No posts in this tab" while saved or
   fetchable posts exist: a slow catalog plus failing sources on reload must
   still show the tab's last good posts, and a first load shows "loading",
   not empty. Synthetic sources only; no accounts or names. */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let liveMode = "ok";
let catalogDelay = 0;

function fail(message) {
  console.error("custom tab reload: " + message);
  process.exitCode = 1;
  throw new Error(message);
}

const post = (id, date, feed) => ({ id, statusId: id, platform: "rss", feedId: feed, kind: "post", date, text: id, title: id, author: feed, handle: feed });
const feeds = [{ id: "src-a", platform: "rss", handle: "src-a", name: "src-a" }];
const catalogPosts = [];
for (let i = 0; i < 50; i++) catalogPosts.push(post("a-" + i, new Date(Date.parse("2026-10-29T07:00:00Z") - i * 60000).toISOString(), "src-a"));
const catalog = { updated: "2026-10-29T07:00:00Z", feeds, posts: catalogPosts };
const config = { feeds: [{ id: "src-a", platform: "rss", adapter: "rss", handle: "src-a", source_urls: ["https://fixture.test/src-a"] }] };
const settings = { version: 1, initialized: true, follows: ["src-a"], lists: [], feedTabs: [{ id: "mix", name: "Mix", showHome: true, showNotes: false, members: ["rss:https://fixture.test/src-c"] }] };

function rss(row, n) {
  let items = "";
  for (let i = 0; i < n; i++) {
    items += `<item><title>${row}-${i}</title><guid>${row}-${i}</guid><link>https://fixture.test/${row}/${i}</link><pubDate>${new Date(Date.parse("2026-10-28T10:00:00Z") - i * 3600000).toUTCString()}</pubDate><description>${row} ${i}</description></item>`;
  }
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${row}</title>${items}</channel></rss>`;
}

function contentType(file) {
  return { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" }[extname(file)] || "application/octet-stream";
}

function startServer() {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (p === "/feeds.json") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(catalog));
      }, catalogDelay);
      return;
    }
    if (p === "/feeds.config.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(config));
      return;
    }
    const file = join(root, p === "/" ? "index.html" : p.replace(/^\/+/, ""));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  return mod.chromium || (mod.default && mod.default.chromium);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const launch = { args: ["--no-sandbox"], viewport: { width: 390, height: 844 }, serviceWorkers: "block" };
  if (process.env.CHROME) launch.executablePath = process.env.CHROME;
  else launch.channel = "chrome";
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "custom-tab-")), launch);
  try {
    await ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http://127.0.0.1")) return route.continue();
      const hit = /fixture\.test\/(src-[a-z])/.exec(url);
      if (hit && liveMode === "ok") return route.fulfill({ status: 200, contentType: "application/rss+xml", body: rss(hit[1], 6) });
      if (hit) return route.fulfill({ status: 503, body: "" });
      return route.fulfill({ status: 404, body: "{}" });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.addInitScript((s) => {
      localStorage.setItem("viktorychapp-lang-user-picked", "1");
      localStorage.setItem("superintelapp-lang", "en");
      if (!localStorage.getItem("viktorychapp-settings-v1")) localStorage.setItem("viktorychapp-settings-v1", JSON.stringify(s));
    }, settings);
    const read = () => page.evaluate(() => ({
      cards: [...document.querySelectorAll("#app article.post")].filter((el) => /src-c/.test(el.textContent || "")).length,
      empty: !!document.querySelector("#app .empty"),
      hash: location.hash
    }));
    async function watch(label, ms) {
      let sawEmpty = false;
      const start = Date.now();
      let last = null;
      while (Date.now() - start < ms) {
        last = await read();
        if (last.hash === "#/cat/mix" && last.empty && !last.cards) sawEmpty = true;
        await page.waitForTimeout(250);
      }
      last = await read();
      if (sawEmpty) fail(label + ": the tab showed empty while its posts were loading");
      if (!last.cards) fail(label + ": the tab has no posts");
      console.log("custom tab " + label + " ok (" + last.cards + " posts)");
    }
    const base = "http://127.0.0.1:" + port + "/index.html";
    await page.goto(base + "#/cat/mix");
    await watch("first load", 8000);
    // Slow catalog (Worker busy or breaker open) and every source failing.
    catalogDelay = 6000;
    liveMode = "fail";
    for (const round of ["reload 1", "reload 2"]) {
      await page.goto(base + "#/");
      await page.reload();
      await page.waitForTimeout(1500);
      await page.evaluate(() => { location.hash = "#/cat/mix"; });
      await watch(round + " with failing sources", 7000);
    }
  } finally {
    await ctx.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
