/* Feed performance numbers (not a pass/fail check): cold and warm Home paint,
   desktop long tasks, back-to-Home time, and DOM size after a long scroll.
   PLAYWRIGHT_CORE=... node scripts/feed_perf_bench.mjs */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = process.env.BENCH_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core");
const chromium = pw.chromium || pw.default.chromium;
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  setTimeout(() => fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  }), 40);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const watch = () => {
  window.__lt = [];
  // Time from navigation start until Home shows three cards, wherever they come from.
  const look = () => {
    if (document.querySelectorAll("#app article.post").length >= 3) { window.__first = performance.now(); return; }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask", buffered: true }); } catch (err) {}
};
const tasks = (page) => page.evaluate(() => { const l = window.__lt || []; return { n: l.length, tbt: Math.round(l.reduce((a, d) => a + Math.max(0, d - 50), 0)), max: Math.round(Math.max(0, ...l)) }; });
const out = {};
try {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "token-a", account: { handle: "user_a", displayName: "User A" } }));
  });
  await ctx.addInitScript(watch);
  await ctx.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const page = await ctx.newPage();
  const paint = async (label) => {
    const t0 = Date.now();
    if (label === "cold") await page.goto(origin + "/index.html#/home", { waitUntil: "domcontentloaded" });
    else {
      if (process.env.BENCH_DEBUG) out.saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => /screen|timeline/.test(k)).map((k) => k + ":" + localStorage.getItem(k).length));
      await page.reload({ waitUntil: "domcontentloaded" });
      if (process.env.BENCH_DEBUG) out.restored = await page.evaluate(() => [document.documentElement.className, document.querySelectorAll("#app article").length, document.querySelectorAll("#app article.post").length]);
    }
    await page.waitForFunction(() => document.querySelectorAll("#app article.post").length >= 3, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__first > 0, null, { timeout: 30000 });
    const ms = Math.round(await page.evaluate(() => window.__first));
    await page.waitForTimeout(2500);
    out[label] = Object.assign({ firstPostsMs: ms }, await tasks(page));
  };
  await paint("cold");
  await paint("warm");
  // Long scroll: long tasks while scrolling and how many cards stay in the DOM.
  await page.evaluate(() => { window.__lt = []; });
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 1600); await page.waitForTimeout(120); }
  await page.waitForTimeout(800);
  out.scroll = Object.assign({ cards: await page.evaluate(() => document.querySelectorAll("#app article.post").length), nodes: await page.evaluate(() => document.getElementsByTagName("*").length) }, await tasks(page));
  // Open a post, then back: time until Home shows posts at the old scroll.
  const y = await page.evaluate(() => window.scrollY);
  out.scroll.y = Math.round(y);
  if (process.env.BENCH_DEBUG) out.scroll.h = await page.evaluate(() => [document.documentElement.scrollHeight, document.querySelectorAll("#app article.post").length]);
  // Click the time link of a card on screen, like a reader would.
  const link = await page.evaluateHandle(() => [...document.querySelectorAll("#app article.post a[href*='/status/']")].find((a) => { const r = a.getBoundingClientRect(); return r.top > 80 && r.bottom < innerHeight - 40; }));
  await link.asElement().click();
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__lt = []; });
  const t1 = Date.now();
  await page.goBack();
  await page.waitForFunction(() => /#\/home/.test(location.hash) && document.querySelectorAll("#app article.post").length >= 3, null, { timeout: 15000 });
  const backMs = Date.now() - t1;
  await page.waitForTimeout(600);
  const y2 = await page.evaluate(() => window.scrollY);
  if (process.env.BENCH_DEBUG) out.backH = await page.evaluate(() => [document.documentElement.scrollHeight, document.querySelectorAll("#app article.post").length, location.hash]);
  out.back = Object.assign({ ms: backMs, y: Math.round(y2), scrollKept: Math.abs(y2 - y) < 400 }, await tasks(page));
  console.log(JSON.stringify(out));
} finally {
  await browser.close();
  server.close();
}
