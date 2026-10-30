import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/* Controller play in the ViktorychTV app. The app's 1.2.0 build
   (versionCode 3) opens ReGone in its own controller screen at
   viktorychtv://game/regone. Inside that app the Games hub shows
   "Play with controller" and the controller note links to it; older apps
   and browsers only get the note that the app supports controllers. */
const STUB = `<!doctype html><html><body style="margin:0;background:#111"></body></html>`;
const CASES = [
  { name: "tv-app-1.2.0", app: 3, button: true },
  { name: "tv-app-1.1.0", app: 2, button: false },
  { name: "browser", app: 0, button: false }
];

async function check(browser, origin, item) {
  const label = item.name;
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.route((url) => !String(url).startsWith(origin), (route) => {
    const url = route.request().url();
    if (url.startsWith("https://nzlay.com/ReGone/game/")) return route.fulfill({ status: 200, contentType: "text/html", body: STUB });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(origin + "/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.addInitScript((app) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true }));
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    if (app) localStorage.setItem("viktorychapp-tv-v1", JSON.stringify({ app: 1, appVersion: app }));
    const pad = { id: "Xbox Wireless Controller (STANDARD GAMEPAD)", index: 0, connected: true, buttons: [], axes: [0, 0, 0, 0], mapping: "standard" };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad, null, null, null] });
  }, item.app);
  await page.goto(origin + "/index.html#/games", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".games-grid", { timeout: 20000 }).catch(() => fail(label + ": no Games hub"));
  const hub = await page.evaluate(() => {
    const a = document.querySelector(".games-pad-play");
    if (!a) return null;
    const box = a.getBoundingClientRect();
    return { href: a.getAttribute("href"), text: a.textContent, h: box.height, icon: !!a.querySelector("svg") };
  });
  if (item.button) {
    if (!hub) fail(label + ": no Play with controller button on the hub");
    if (hub.href !== "intent://game/regone#Intent;scheme=viktorychtv;package=app.viktorych.tv;end") fail(label + ": button opens " + hub.href);
    if (!/Play with controller/.test(hub.text) || !hub.icon) fail(label + ": button text or icon " + hub.text);
    if (hub.h < 44) fail(label + ": button is " + hub.h + "px tall");
  } else if (hub) fail(label + ": the hub offers controller play the app can't open");
  await page.evaluate(() => { location.hash = "#/games/regone"; });
  await page.waitForSelector("#game-host iframe", { timeout: 20000 }).catch(() => fail(label + ": no game frame"));
  await page.waitForFunction(() => document.querySelector("#game-host .game-pad-note").textContent.length > 0, null, { timeout: 5000 }).catch(() => fail(label + ": no controller note"));
  const note = await page.evaluate(() => {
    const el = document.querySelector("#game-host .game-pad-note");
    const a = el.querySelector("a[data-game-tvpad]");
    return { text: el.textContent, href: a ? a.getAttribute("href") : "", clickable: a ? getComputedStyle(a).pointerEvents : "" };
  });
  if (item.button) {
    if (!/Controller connected\./.test(note.text) || !/Play with controller/.test(note.text)) fail(label + ": note reads " + note.text);
    if (note.href.indexOf("intent://game/regone#Intent;scheme=viktorychtv;") !== 0) fail(label + ": note link " + note.href);
    if (note.clickable !== "auto") fail(label + ": the note link can't be pressed");
  } else {
    if (!/Play with a controller in the ViktorychTV app\./.test(note.text)) fail(label + ": note reads " + note.text);
    if (note.href) fail(label + ": the note links to an app that can't open it");
  }
  if (errors.length) fail(label + ": " + errors[0]);
  await context.close();
  console.log("tv controller link ok " + label);
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const item of CASES) await check(browser, origin, item);
    console.log("tv controller link ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
