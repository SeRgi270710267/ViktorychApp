/* Drawer customize mode at phone and tablet widths. Placeholders only. */
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

async function openDrawer(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".m-ava, .account-pill")].some((el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll(".m-ava, .account-pill")].find((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    if (el) el.click();
  });
  await page.waitForSelector(".drawer-x", { timeout: 8000 });
}

async function check(page, label) {
  await openDrawer(page);
  const before = await page.evaluate(() => ({
    customize: !!document.querySelector("[data-act='drawer-edit']"),
    bookmarks: [...document.querySelectorAll(".drawer-label")].some((node) => node.textContent === "Bookmarks"),
    settings: [...document.querySelectorAll(".drawer-label")].some((node) => /Settings/.test(node.textContent || "")),
    fold: !!document.querySelector("[data-act='drawer-fold']"),
    tv: !!document.querySelector('.drawer a[href="#/tv"]'),
    logoutInBody: !!document.querySelector(".drawer-scroll [data-acct='logout']")
  }));
  if (!before.customize || !before.bookmarks || !before.settings || !before.fold || !before.tv || before.logoutInBody) fail(label + " menu is missing a core row");
  await page.click("[data-act='drawer-edit']");
  await page.waitForSelector(".drawer-edit-list");
  const locked = await page.evaluate(() => {
    const row = (id) => document.querySelector(`[data-drawer-key="${id}"]`);
    return {
      settingsEye: !!(row("settings") && row("settings").querySelector("[data-act='drawer-vis']")),
      logoutEye: !!(row("logout") && row("logout").querySelector("[data-act='drawer-vis']")),
      customizeEye: !!(row("customize") && row("customize").querySelector("[data-act='drawer-vis']")),
      grips: document.querySelectorAll(".drawer-grip").length
    };
  });
  if (locked.settingsEye || locked.logoutEye || locked.customizeEye) fail(label + " a locked item can be hidden");
  if (locked.grips < 3) fail(label + " drag handles missing");
  await page.click("[data-drawer-key='bookmarks'] [data-act='drawer-vis']");
  await page.click("[data-act='drawer-edit-done']");
  const hidden = await page.evaluate(() => [...document.querySelectorAll(".drawer-label")].some((node) => node.textContent === "Bookmarks"));
  if (hidden) fail(label + " hidden item is still shown");
    const back = await page.evaluate(() => ({
    customize: !!document.querySelector("[data-act='drawer-edit']"),
    settings: [...document.querySelectorAll(".drawer-label")].some((node) => /Settings/.test(node.textContent || "")),
    fold: !!document.querySelector("[data-act='drawer-fold']")
  }));
  if (!back.customize || !back.settings || !back.fold) fail(label + " core items disappeared");
  await page.click("[data-act='drawer-edit']");
  await page.click("[data-act='drawer-add-section']");
  await page.waitForSelector(".drawer-section-name");
  await page.click("[data-act='drawer-reset']");
  await page.click("[data-act='drawer-edit-done']");
  const restored = await page.evaluate(() => [...document.querySelectorAll(".drawer-label")].some((node) => node.textContent === "Bookmarks"));
  if (!restored) fail(label + " reset did not restore the menu");
  await page.click("[data-act='close-drawer']");
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const size of SIZES) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("viktorychapp-lang-user-picked", "1");
        localStorage.setItem("superintelapp-lang", "en");
      });
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith("http://127.0.0.1")) route.continue();
        else route.abort();
      });
      await page.goto("http://127.0.0.1:" + port + "/index.html#/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector(".m-ava, .account-pill"));
      try {
        await check(page, size.name);
      } finally {
        await context.close();
      }
    }
    console.log("drawer menu ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
