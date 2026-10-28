/* Explore stays on the phone bar and in the side menu by default.
   A saved menu from before Explore was a drawer row is repaired.
   The customizer can hide it, and reset puts it back. Home stays locked. */
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

function oldMenu() {
  return JSON.stringify({
    version: 1,
    initialized: true,
    bottomNavCustom: true,
    bottomNav: {
      order: ["communities", "lists", "messages", "tv", "notifications", "home", "explore"],
      hidden: ["explore", "feeds", "history", "music", "shorts", "games", "subscriptions", "vault", "storage", "settings"]
    },
    navCustom: {
      folders: [],
      order: ["home", "notifications", "messages"],
      hidden: ["explore"]
    },
    drawerMenu: {
      sections: [],
      order: ["home", "profile", "communities", "lists", "settings", "logout", "customize"],
      hidden: [],
      at: 1
    }
  });
}

async function openApp(browser, port, width, settings) {
  const context = await browser.newContext({
    viewport: { width: width, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  });
  const page = await context.newPage();
  await page.addInitScript((raw) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    if (raw) localStorage.setItem("viktorychapp-settings-v1", raw);
  }, settings || "");
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1")) route.continue();
    else route.abort();
  });
  await page.goto("http://127.0.0.1:" + port + "/index.html#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav.bottom-nav a");
  return { context, page };
}

async function barExplore(page) {
  return page.evaluate(() => {
    const link = document.querySelector('nav.bottom-nav a[href="#/explore"]');
    const home = document.querySelector('nav.bottom-nav a[href="#/"]');
    const box = link ? link.getBoundingClientRect() : null;
    const homeBox = home ? home.getBoundingClientRect() : null;
    return {
      hrefs: [...document.querySelectorAll("nav.bottom-nav a")].map((a) => a.getAttribute("href")),
      explore: !!(link && box && box.width >= 24 && box.height >= 24 && link.querySelector("svg")),
      home: !!(home && homeBox && homeBox.width >= 24 && homeBox.height >= 24 && home.querySelector("svg"))
    };
  });
}

async function drawerExplore(page) {
  await page.locator("button.m-ava").locator("visible=true").click();
  await page.waitForSelector('.drawer-x a[href="#/explore"]', { timeout: 5000 });
  const row = await page.evaluate(() => {
    const link = document.querySelector('.drawer-x a[href="#/explore"]');
    const box = link.getBoundingClientRect();
    const label = link.querySelector(".drawer-label");
    const toggle = document.querySelector('[data-act="drawer-vis"][data-id="explore"]');
    const lock = document.querySelector('[data-drawer-key="explore"] .drawer-lock');
    return {
      w: box.width,
      h: box.height,
      text: label ? label.textContent : "",
      icon: !!link.querySelector("svg"),
      locked: !!lock,
      eye: !!(toggle && !toggle.disabled)
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".drawer-x", { state: "detached", timeout: 5000 });
  return row;
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const width of [360, 390]) {
      const opened = await openApp(browser, port, width, "");
      try {
        const bar = await barExplore(opened.page);
        if (!bar.home || !bar.explore) fail(width + " default bar missing Home or Explore: " + JSON.stringify(bar));
        if (bar.hrefs[0] !== "#/" || bar.hrefs[1] !== "#/explore") fail(width + " default order " + JSON.stringify(bar.hrefs));
        const drawer = await drawerExplore(opened.page);
        if (drawer.w < 8 || drawer.h < 8 || !drawer.icon) fail(width + " drawer Explore is missing");
        if (drawer.text !== "Explore") fail(width + " drawer Explore label " + drawer.text);
        if (drawer.locked) fail(width + " Explore is locked in the side menu");
      } finally {
        await opened.context.close();
      }
    }

    const repaired = await openApp(browser, port, 390, oldMenu());
    try {
      const bar = await barExplore(repaired.page);
      if (!bar.home || !bar.explore) fail("repaired bar missing Home or Explore: " + JSON.stringify(bar));
      const drawer = await drawerExplore(repaired.page);
      if (drawer.text !== "Explore" || drawer.w < 8) fail("repaired drawer Explore missing");
    } finally {
      await repaired.context.close();
    }

    const custom = await openApp(browser, port, 390, "");
    try {
      const page = custom.page;
      await page.goto("http://127.0.0.1:" + port + "/index.html#/settings/display/navigation", { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-act="bottom-nav-toggle"][data-id="explore"]');
      const row = await page.evaluate(() => {
        const explore = document.querySelector('[data-act="bottom-nav-toggle"][data-id="explore"]');
        const home = document.querySelector('[data-act="bottom-nav-toggle"][data-id="home"]');
        const name = document.querySelector('[data-bottom-id="explore"] .bnav-name');
        return {
          listed: !!document.querySelector('[data-bottom-id="explore"]'),
          name: name ? name.textContent : "",
          exploreLocked: !!(explore && explore.disabled),
          homeLocked: !!(home && home.disabled),
          on: explore ? explore.getAttribute("aria-checked") : ""
        };
      });
      if (!row.listed || row.name !== "Explore") fail("customizer does not list Explore: " + JSON.stringify(row));
      if (row.exploreLocked || !row.homeLocked || row.on !== "true") fail("Explore should be hideable and Home locked: " + JSON.stringify(row));
      await page.locator('[data-act="bottom-nav-toggle"][data-id="explore"]').click();
      await page.waitForFunction(() => !document.querySelector('nav.bottom-nav a[href="#/explore"]'));
      await page.locator('[data-act="bottom-nav-reset"]').click();
      await page.waitForSelector('nav.bottom-nav a[href="#/explore"]');
      const restored = await barExplore(page);
      if (!restored.home || !restored.explore) fail("reset did not restore Explore: " + JSON.stringify(restored));
      const back = await page.evaluate(() => {
        const explore = document.querySelector('[data-act="bottom-nav-toggle"][data-id="explore"]');
        return explore ? explore.getAttribute("aria-checked") : "";
      });
      if (back !== "true") fail("reset left Explore hidden in the customizer");
    } finally {
      await custom.context.close();
    }
    console.log("explore nav ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
