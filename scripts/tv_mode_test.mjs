/* Keyboard-only TV smoke test: an Android TV browser gets TV mode, the light
   defaults, the Install TV app card, and remote navigation that never gets
   stuck. The installed app sees an update banner when tv/version.json is newer.
   PLAYWRIGHT_CORE=/path/to/playwright-core/index.js [PLAYWRIGHT_CHROME=/path/to/chrome] node scripts/tv_mode_test.mjs */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GTV = "Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTE.230319.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
let failed = 0;

function check(ok, message) {
  console.log((ok ? "ok " : "FAIL ") + message);
  if (!ok) failed += 1;
}

function mime(file) {
  if (/\.m?js$/.test(file)) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (file.endsWith(".apk")) return "application/vnd.android.package-archive";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("missing"); return; }
      res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function loadChromium() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  return mod.chromium || (mod.default && mod.default.chromium);
}

async function open(browser, port, ua, url, init) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: ua, hasTouch: false, serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("pageerror", err.message));
  await page.addInitScript((extra) => {
    try { localStorage.length; } catch (err) { return; }
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    if (extra) Object.keys(extra).forEach((k) => localStorage.setItem(k, extra[k]));
  }, init || null);
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("http://127.0.0.1")) route.continue();
    else route.abort();
  });
  await page.goto("http://127.0.0.1:" + port + url, { waitUntil: "domcontentloaded" });
  return { context, page };
}

const focus = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    cls: String(el.className || ""),
    ring: el.classList.contains("tv-focus"),
    inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    key: el.getAttribute("data-post") || el.getAttribute("href") || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30)
  };
});

async function main() {
  const chromium = await loadChromium();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME || undefined });
  try {
    // 1. Google TV browser.
    const { context, page } = await open(browser, port, GTV, "/index.html#/home");
    await page.waitForFunction(() => document.documentElement.getAttribute("data-tv-ready") === "1", null, { timeout: 20000 });
    const state = await page.evaluate(() => ({
      on: document.documentElement.classList.contains("tv-on"),
      calm: document.documentElement.classList.contains("tv-calm"),
      flat: document.documentElement.classList.contains("tv-flat"),
      autoplay: window.ViktorychTVMode.pref("autoplay"),
      zoom: parseFloat(getComputedStyle(document.body).zoom || "1"),
      pad: parseFloat(getComputedStyle(document.body).paddingTop) || 0
    }));
    check(state.on && state.calm && state.flat, "a Google TV browser starts in TV mode with reduced motion and no blur");
    check(state.autoplay === "off", "TV autoplay starts off");
    check(state.zoom >= 1.15, "the desktop layout is scaled up for the couch (zoom " + state.zoom + ")");
    check(state.pad > 0, "overscan padding is set");
    await page.waitForSelector('[data-tv-app-card="home"] a[data-tv-get]', { timeout: 10000 });
    const href = await page.getAttribute('[data-tv-app-card="home"] a[data-tv-get]', "href");
    check(/ViktorychTV\.apk$/.test(href || ""), "Home shows Install TV app pointing at the APK");
    const apk = await page.evaluate(async (h) => { const r = await fetch(h, { method: "HEAD" }); return r.ok; }, href);
    check(apk, "the APK is served");

    // Remote: down through the page, never stuck, always in view, with a ring.
    const seen = new Set();
    let stuck = 0;
    let last = "";
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
      const f = await focus(page);
      if (!f) { stuck += 1; continue; }
      if (!f.ring || !f.inView) check(false, "focus ring and view after ArrowDown " + i + " (" + f.key + ")");
      if (f.key === last) stuck += 1;
      last = f.key;
      seen.add(f.key);
    }
    check(seen.size >= 5, "ArrowDown walks through " + seen.size + " different items");
    check(stuck <= 2, "ArrowDown is never stuck (" + stuck + " repeats)");
    let nav = null;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(80);
      const f = await focus(page);
      if (f && /nav-item/.test(f.cls)) { nav = f; break; }
    }
    check(!!nav, "ArrowLeft reaches the sidebar");
    // Down the sidebar to Explore or another page, Enter opens it, Back returns.
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
    const before = await page.evaluate(() => location.hash);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => location.hash);
    check(after !== before, "Enter on a sidebar item opens it (" + before + " -> " + after + ")");
    await page.evaluate(() => {
      const e = new KeyboardEvent("keydown", { key: "GoBack", bubbles: true, cancelable: true });
      Object.defineProperty(e, "keyCode", { get: () => 4 });
      document.dispatchEvent(e);
    });
    await page.waitForTimeout(500);
    check((await page.evaluate(() => location.hash)) === before, "Android Back (key code 4) goes back");

    // Settings: TV performance switches change the defaults.
    await page.evaluate(() => { location.hash = "#/settings/display"; });
    const pref = page.locator('[data-tv-pref="calm"]').first();
    let hasPref = true;
    try { await pref.waitFor({ timeout: 8000 }); } catch (err) { hasPref = false; }
    check(hasPref, "Settings > Display has the TV performance switches");
    if (hasPref) {
      await pref.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      check(!(await page.evaluate(() => document.documentElement.classList.contains("tv-calm"))), "turning Reduce motion off takes effect at once");
    }
    await context.close();

    // 2. Desktop: no TV mode and no card.
    const desk = await open(browser, port, DESKTOP, "/index.html#/home");
    await desk.page.waitForSelector("main", { timeout: 15000 });
    await desk.page.waitForTimeout(1500);
    const d = await desk.page.evaluate(() => ({ on: document.documentElement.classList.contains("tv-on"), card: !!document.querySelector("[data-tv-app-card]") }));
    check(!d.on && !d.card, "a desktop browser keeps the normal layout and shows no TV card");
    await desk.context.close();

    // 3. Inside the installed app with an older version: update banner, no install card.
    const app = await open(browser, port, "Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "/index.html?tv=1&src=tvapp&tvapp=1#/home");
    await app.page.route("**/tv/version.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ versionCode: 99, versionName: "9.9.9", release: "https://github.com/ViktorychGroup/ViktorychApp/releases/latest/download/ViktorychTV.apk" }) }));
    let banner = true;
    try { await app.page.waitForSelector('[data-tv-update-card="home"] a', { timeout: 15000 }); } catch (err) { banner = false; }
    check(banner, "the app shows Update available when tv/version.json is newer");
    const installCard = await app.page.evaluate(() => [...document.querySelectorAll("[data-tv-app-card]")].some((el) => getComputedStyle(el).display !== "none"));
    check(!installCard, "the app never offers to install itself");
    await app.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) { console.error(failed + " TV checks failed"); process.exit(1); }
  console.log("tv mode checks passed");
}

main().catch((err) => { console.error(err); process.exit(1); });
