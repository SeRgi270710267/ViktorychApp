/* Desktop sidebar stays usable while the feed loads.
   Production-like gate mode, 4x CPU throttle, a slow feeds.json. Each nav
   item is pressed and held like a real click (about 110 ms) while the feed
   loads, then released. Every press must switch the page and light up the
   item quickly; none may be dropped. Route changes must not run a document
   view transition, because the page cannot be clicked while one runs. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEED_DELAY = 3000;
const RESPONSE_MAX = Number(process.env.FEED_INPUT_MAX_MS || 250);
const GATE = 'window.VIKTORYCH_ACCOUNTS={api:"https://perf-api.invalid",backupApi:"",gate:true,turnstileSiteKey:"",tiktokAudience:"owner",emergencyHash:""};';

function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    if (/accounts\.config\.js$/.test(rel)) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(GATE); return; }
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    setTimeout(() => fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("missing"); return; }
      res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
      res.end(data);
    }), 15);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  return mod.chromium || (mod.default && mod.default.chromium);
}

async function main() {
  const feeds = fs.readFileSync(path.join(root, "feeds.json"));
  const conf = fs.readFileSync(path.join(root, "feeds.config.json"));
  const chromium = await loadPlaywright();
  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const problems = [];
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1366, height: 860 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "test-token", account: { handle: "test_user", displayName: "Test User" } }));
        localStorage.setItem("viktorychapp-lang-user-picked", "1");
        localStorage.setItem("superintelapp-lang", "en");
      } catch (err) { /* storage off */ }
      window.__vt = 0;
      const start = document.startViewTransition;
      if (start) document.startViewTransition = function () { window.__vt += 1; return start.apply(this, arguments); };
    });
    await ctx.route(/^https:\/\/perf-api\.invalid\//, async (route) => {
      const url = route.request().url();
      const feed = /\/v1\/data\/feeds\.json/.test(url);
      await new Promise((r) => setTimeout(r, feed ? FEED_DELAY : 400));
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
      if (feed) return route.fulfill({ status: 200, contentType: "application/json", headers, body: feeds });
      if (/\/v1\/data\/feeds\.config\.json/.test(url)) return route.fulfill({ status: 200, contentType: "application/json", headers, body: conf });
      return route.fulfill({ status: 200, contentType: "application/json", headers, body: "{}" });
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|perf-api)/, (route) => route.abort());
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(base + "/index.html#/", { waitUntil: "commit" });
    await page.waitForFunction(() => [...document.querySelectorAll("a.nav-item[href]")].some((a) => a.offsetParent), null, { timeout: 30000, polling: 20 });
    const seq = ["#/explore", "#/notifications", "#/", "#/messages", "#/explore", "#/", "#/notifications", "#/"];
    const times = [];
    for (const href of seq) {
      let box = null;
      for (let k = 0; k < 40 && !(box && box.ok); k++) {
        box = await page.evaluate((href) => {
          const a = [...document.querySelectorAll("a.nav-item[href]")].find((x) => x.getAttribute("href") === href && x.offsetParent);
          if (!a) return null;
          const r = a.getBoundingClientRect();
          const x = r.left + Math.min(30, r.width / 2);
          const y = r.top + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, ok: !!(hit && hit.closest("a.nav-item") === a) };
        }, href);
        if (!(box && box.ok)) await page.waitForTimeout(25);
      }
      if (!box || !box.ok) { problems.push(href + " could not be reached under the pointer"); continue; }
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.waitForTimeout(110);
      const t0 = await page.evaluate(() => performance.now());
      await page.mouse.up();
      const ms = await page.waitForFunction(([href, t0]) => {
        const on = (location.hash || "#/") === href && document.querySelector('a.nav-item[aria-current="page"][href="' + href + '"]');
        return on ? performance.now() - t0 : false;
      }, [href, t0], { timeout: 5000, polling: "raf" }).then((h) => h.jsonValue()).catch(() => -1);
      times.push(href + "=" + Math.round(ms));
      if (ms < 0) problems.push(href + " click was dropped while the feed loaded");
      else if (ms > RESPONSE_MAX) problems.push(href + " took " + Math.round(ms) + " ms to respond");
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(() => document.querySelectorAll("#app article.post").length >= 3, null, { timeout: 30000 }).catch(() => problems.push("the feed never rendered"));
    const vt = await page.evaluate(() => window.__vt);
    if (vt) problems.push(vt + " route change(s) ran a document view transition, which blocks clicks");
    console.log("sidebar clicks during feed load (ms after release): " + times.join(" "));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) throw new Error("feed load input check failed:\n  " + problems.join("\n  "));
  console.log("feed load input ok");
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
