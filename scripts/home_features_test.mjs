/* Home pills and Stories can be turned fully off: no DOM, no scripts, no
   requests. Placeholders only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 390, height: 844, name: "phone" }
];
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



const RELATED = /(weather|scores|pill-data|stories|\/v1\/stor|open-meteo|espn|feeds\.config\.json\?_=)/i;

async function run(browser, origin, vp) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" });
  const seen = [];
  context.on("request", (req) => seen.push(req.url()));
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"stories":[],"ok":true}' }));
  let page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
  });
  const tag = vp.name;
  const settle = async () => {
    await page.waitForSelector("#app .topbar", { timeout: 20000 });
    await page.waitForTimeout(1500);
    // A reload may land back on the last page; the checks are about Home.
    await page.evaluate(() => { if (location.hash !== "#/") location.hash = "#/"; });
    await page.waitForTimeout(2500);
  };
  // The app may still be booting after a reload, so click until the switch answers.
  const flip = async (key, want) => {
    for (let i = 0; i < 10; i++) {
      await page.evaluate((k) => { const el = document.querySelector(`[data-act="home-feature"][data-key="${k}"]`); if (el) el.click(); }, key).catch(() => {});
      await page.waitForTimeout(1200);
      const now = await page.evaluate((k) => { const el = document.querySelector(`[data-act="home-feature"][data-key="${k}"]`); return el && el.getAttribute("aria-checked"); }, key).catch(() => null);
      const flag = await page.evaluate((k) => localStorage.getItem(k === "stories" ? "viktorychapp-off-stories" : "viktorychapp-off-home-pills"), key).catch(() => null);
      if (now === want && (flag === "1") === (want === "false")) { await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(1500); return; }
    }
    fail(tag + ": the " + key + " switch turns " + (want === "true" ? "on" : "off"));
  };
  const dom = () => page.evaluate(() => ({
    pills: !!document.querySelector(".sp-row-wrap, .sp-row"),
    tray: !!document.querySelector(".story-tray"),
    mods: [!!window.Stories, !!window.WeatherPills, !!window.SoccerScores]
  }));

  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await settle();
  let d = await dom();
  if (!d.pills) fail(tag + ": the pills row shows by default");
  if (!d.mods[0] || !d.mods[1]) fail(tag + ": the pills and stories scripts load by default");
  if (!seen.some((u) => RELATED.test(u))) fail(tag + ": the default page requests pills and stories files");

  for (const key of ["homePills", "stories"]) {
    await page.goto(origin + "/#/settings/display", { waitUntil: "domcontentloaded" });
    const sw = page.locator(`[data-act="home-feature"][data-key="${key}"]`);
    await sw.waitFor({ timeout: 20000 });
    if ((await sw.getAttribute("aria-checked")) !== "true") fail(tag + ": " + key + " starts on");
    await flip(key, "false");
  }

  seen.length = 0;
  // The app reopens the last saved screen on the next load; start the next tab on Home.
  await page.evaluate(() => { location.hash = "#/"; localStorage.removeItem("viktorych-screen-v1"); });
  await page.close();
  page = await context.newPage();
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await settle();
  d = await dom();
  const related = seen.filter((u) => RELATED.test(u));
  if (related.length) fail(tag + ": no pills or stories requests when both are off: " + related.join(" "));
  if (d.pills || d.tray) fail(tag + ": no pills or stories DOM when off " + JSON.stringify(d));
  if (d.mods.some(Boolean)) fail(tag + ": no pills or stories scripts run when off " + JSON.stringify(d.mods));



  // Turning one back on brings it back.
  await page.goto(origin + "/#/settings/display", { waitUntil: "domcontentloaded" });
  const pillsSw = page.locator('[data-act="home-feature"][data-key="homePills"]');
  await pillsSw.waitFor({ timeout: 20000 });
  await flip("homePills", "true");
  await page.evaluate(() => { location.hash = "#/"; localStorage.removeItem("viktorych-screen-v1"); });
  await page.close();
  page = await context.newPage();
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await settle();
  d = await dom();
  if (!d.pills || !d.mods[1]) fail(tag + ": the pills row returns when turned back on " + JSON.stringify(d));
  if (d.mods[0] || d.tray) fail(tag + ": stories stay off " + JSON.stringify(d));
  await context.close();
  console.log("home features ok " + tag);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) await run(browser, origin, vp);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message);
});
