/* Boot speed: a signed-in visit mounts the app scripts right away, downloads
   them in parallel (not one round trip per file), and reads feeds.json once. */
import http from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core");
const chromium = pw.chromium || pw.default.chromium;
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" };

function fail(msg) { throw new Error("boot speed: " + msg); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  /* Every file costs a round trip, like a phone on a real network. */
  setTimeout(() => fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  }), 60);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "token-a", account: { handle: "user_a", displayName: "User A" } }));
  });
  await ctx.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port + "/index.html#/home", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#app article.post").length >= 3, null, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const all = performance.getEntriesByType("resource");
    const late = Array.from(document.getElementById("late-scripts-rest").content.querySelectorAll("script[src]")).map((s) => s.getAttribute("src"));
    const starts = all.filter((r) => late.some((src) => r.name.endsWith("/" + src))).map((r) => r.startTime);
    const app = all.find((r) => /\/app\.js$/.test(r.name));
    return {
      lateCount: late.length,
      seen: starts.length,
      spread: Math.max(...starts) - Math.min(...starts),
      appStart: app ? app.startTime : -1,
      feeds: all.filter((r) => /\/feeds\.json$/.test(r.name) && r.startTime < (app ? app.responseEnd : 0)).length
    };
  });
  if (info.seen < info.lateCount - 2) fail("late scripts missing " + JSON.stringify(info));
  if (info.spread > 1000) fail("late scripts load one after another " + JSON.stringify(info));
  if (info.appStart < 0 || info.appStart > 2000) fail("signed-in boot waited before loading the app " + JSON.stringify(info));
  if (info.feeds > 1) fail("feeds.json read more than once before the app ran " + JSON.stringify(info));
  console.log("boot speed check passed", JSON.stringify({ spread: Math.round(info.spread), appStart: Math.round(info.appStart), feeds: info.feeds }));
} finally {
  await browser.close();
  server.close();
}

/* The interface pack check shares this browser setup. */
const packs = spawnSync(process.execPath, [path.join(root, "scripts", "i18n_pack_test.mjs")], { stdio: "inherit", env: process.env });
if (packs.status !== 0) process.exit(packs.status || 1);
