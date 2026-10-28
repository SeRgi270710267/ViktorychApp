/* Profile banner buttons at phone and tablet widths. Placeholders only. */
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
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const href = spec.startsWith("/") ? pathToFileURL(spec).href : spec;
  const mod = await import(href);
  return mod.chromium || (mod.default && mod.default.chromium);
}

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 }
];

async function openProfile(browser, port, size) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
  });
  await page.goto("http://127.0.0.1:" + port + "/index.html#/x/user_a", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".profile-chrome", { timeout: 15000 });
  return { context, page };
}

async function check(page, label) {
  const box = await page.evaluate(() => {
    const bar = document.querySelector(".profile-chrome");
    const banner = document.querySelector("main .pbanner");
    const buttons = [...document.querySelectorAll(".profile-chrome .pfloat-btn")];
    const bannerBox = banner ? banner.getBoundingClientRect() : null;
    const sizes = buttons.map((btn) => {
      const rect = btn.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), top: rect.top, bottom: rect.bottom };
    });
    return {
      buttons: buttons.length,
      bannerTop: bannerBox ? bannerBox.top : -1,
      bannerBottom: bannerBox ? bannerBox.bottom : -1,
      sizes: sizes,
      over: bannerBox ? sizes.every((item) => item.top >= bannerBox.top - 2 && item.bottom <= bannerBox.bottom + 2) : false
    };
  });
  if (box.buttons !== 4) fail(label + " button count " + box.buttons);
  if (!box.over) fail(label + " buttons are not over the banner");
  if (box.sizes.some((item) => item.w < 30 || item.w > 40 || item.h < 30 || item.h > 40)) fail(label + " button size");
  await page.click("[data-act='profile-tools']");
  await page.waitForSelector(".profile-menu", { timeout: 5000 });
  const tools = await page.evaluate(() => {
    const menu = document.querySelector(".profile-menu");
    const text = menu ? menu.innerText : "";
    const broken = [...menu.querySelectorAll("a")].some((link) => !link.getAttribute("href") || link.getAttribute("href") === "#");
    return { feeds: text.indexOf("View in Feeds") >= 0, original: text.indexOf("Open original") >= 0, broken: broken };
  });
  if (!tools.feeds || !tools.original || tools.broken) fail(label + " feed tools");
  await page.click("[data-act='close-profile-menu']");
  await page.click("[data-act='profile-search']");
  await page.waitForSelector("#profile-q", { timeout: 5000 });
  await page.click("[data-act='profile-more']");
  await page.waitForSelector(".profile-menu [data-act='share']", { timeout: 5000 });
  const more = await page.evaluate(() => {
    const menu = document.querySelector(".profile-menu");
    const report = menu && [...menu.querySelectorAll("button")].some((btn) => /report/i.test(btn.textContent || ""));
    const block = menu && [...menu.querySelectorAll("[data-act='profile-block']")].length;
    return { report: report, block: block };
  });
  if (more.report || more.block) fail(label + " unpaid actions are visible");
  await page.evaluate(() => {
    document.querySelector("main").style.minHeight = "2400px";
    window.scrollTo(0, 500);
  });
  await page.waitForFunction(() => {
    const bar = document.querySelector(".profile-chrome");
    return !!(bar && bar.classList.contains("is-solid"));
  }, null, { timeout: 5000 });
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const size of SIZES) {
      const opened = await openProfile(browser, port, size);
      try {
        await check(opened.page, size.name);
      } finally {
        await opened.context.close();
      }
    }
    console.log("profile chrome ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
