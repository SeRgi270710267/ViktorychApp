import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 390, height: 844, name: "phone" },
  { width: 1280, height: 800, name: "desktop" }
];

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

/* Search Settings with the on-device assistant: typed words find pages in
   every language, a plain-words question goes to the browser's own model
   (stubbed here), and nothing leaves the page. */
const SIZES = [
  { width: 390, height: 844, name: "phone", mobile: true },
  { width: 1280, height: 800, name: "desktop", mobile: false }
];
const LANGS = { en: ["dark mode", "Display"], es: ["contraseña", "Seguridad"], ru: ["прокси", "Цифровое сопротивление"] };

function boot(lang) {
  return `(() => {
    localStorage.setItem("superintelapp-lang", ${JSON.stringify(lang)});
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true }));
    window.__asked = [];
    window.LanguageModel = { create: async () => ({ prompt: async (text) => { window.__asked.push(text); return "13"; }, destroy() {} }) };
  })()`;
}

async function check(browser, origin, size, lang) {
  const label = lang + "@" + size.name;
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const outside = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("request", (req) => { const sent = req.url() + " " + (req.postData() || ""); let text = sent; try { text = decodeURIComponent(sent); } catch (err) {} if (/other people|opening this app|dark mode|contrase|прокси/i.test(text)) outside.push(req.url()); });
  await page.route((url) => !String(url).startsWith(origin), (route) => route.fulfill({ status: 204, body: "" }));
  await page.addInitScript(boot(lang));
  await page.goto(origin + "/index.html#/settings", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#settings-q", { timeout: 20000 }).catch(() => fail(label + ": no Search Settings box"));
  const [query, want] = LANGS[lang];
  await page.fill("#settings-q", query);
  await page.waitForFunction(() => document.querySelector(".set-main-list") && document.querySelector(".set-main-list").hidden, null, { timeout: 5000 }).catch(() => fail(label + ": the full list stayed under the results"));
  const first = await page.evaluate(() => { const b = document.querySelector("#settings-q-out .set-row b"); return b ? b.textContent : ""; });
  if (first.indexOf(want) !== 0) fail(label + ": '" + query + "' found " + JSON.stringify(first));
  const asked0 = await page.evaluate(() => window.__asked.length);
  if (asked0) fail(label + ": a short search went to the model");
  await page.fill("#settings-q", "stop other people from opening this app on my phone");
  await page.waitForSelector("#settings-q-out .set-ai-pick", { timeout: 8000 }).catch(() => fail(label + ": no assistant pick"));
  const pick = await page.evaluate(() => {
    const row = document.querySelector("#settings-q-out .set-ai-pick + .set-row");
    const box = document.querySelector(".set-search .search").getBoundingClientRect();
    return { href: row && row.getAttribute("href"), asked: window.__asked[0] || "", wide: document.scrollingElement.scrollWidth > innerWidth + 1, boxH: box.height };
  });
  if (pick.href !== "#/settings/security") fail(label + ": assistant pick " + pick.href);
  if (pick.asked.indexOf("stop other people") < 0) fail(label + ": the model was not asked");
  if (pick.wide) fail(label + ": page scrolls sideways");
  if (pick.boxH > 48) fail(label + ": search box grew " + pick.boxH);
  await page.click("#settings-q-out .set-ai-pick + .set-row");
  await page.waitForFunction(() => location.hash === "#/settings/security", null, { timeout: 5000 }).catch(() => fail(label + ": pick did not open Security"));
  await page.goto(origin + "/index.html#/settings", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#settings-q");
  /* The new route renders after the next paint; type into its box, not the old page's. */
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))));
  await page.waitForFunction(() => !document.querySelector(".route-wait"), null, { timeout: 3000 }).catch(() => {});
  await page.fill("#settings-q", "");
  /* The route renders right after the next paint, so wait for it rather than read the DOM in the same tick. */
  const back = await page.waitForFunction(() => { const list = document.querySelector(".set-main-list"), out = document.querySelector("#settings-q-out"); return list && out && !list.hidden && out.hidden; }, null, { timeout: 3000 }).then(() => true, () => false);
  if (!back) fail(label + ": clearing the search did not bring the list back");
  if (outside.length) fail(label + ": the search text left the page " + outside.slice(0, 3));
  if (errors.length) fail(label + ": " + errors[0]);
  await context.close();
  console.log("settings assistant ok " + label);
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const lang of Object.keys(LANGS)) for (const size of SIZES) await check(browser, origin, size, lang);
    console.log("settings assistant ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
