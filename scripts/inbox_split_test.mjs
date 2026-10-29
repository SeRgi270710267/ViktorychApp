/* Inbox sections: split one out into its own page and merge it back. */
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


async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const size of [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 900 }]) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await page.goto(base + "#/messages");
      await page.waitForSelector(".inbox-chips [data-inbox='discord']", { timeout: 20000 });
      const sel = size.name === "phone" ? ".bottom-nav a[href='#/messages?f=discord']" : "header.nav:not(.nav-land) a[href='#/messages?f=discord']";
      if (await page.locator(sel).count()) fail(size.name + ": Discord has its own icon before it is split");
      const barIcons = () => page.evaluate(() => [...document.querySelectorAll(".bottom-nav:not(.bottom-nav-preview) a[href]")].map((a) => a.getAttribute("href")).join(" "));
      const barBefore = await barIcons();

      // Long-press menu (right-click on desktop) splits Discord out.
      await page.click(".inbox-chips [data-inbox='discord']", { button: "right" });
      await page.waitForSelector(".inbox-menu [data-inbox-act='split']");
      await page.click(".inbox-menu [data-inbox-act='split']");
      await page.waitForSelector(sel, { timeout: 5000 });
      if (await page.locator(".inbox-chips [data-inbox='discord']").count()) fail(size.name + ": split Discord is still a chip");
      await page.click(sel);
      await page.waitForFunction(() => location.hash === "#/messages?f=discord", null, { timeout: 5000 }).catch(async () => { fail(size.name + ": hash " + await page.evaluate(() => location.hash + " menu=" + !!document.querySelector(".inbox-menu"))); });
      await page.waitForSelector(".inbox-split-bar [data-inbox-act='merge']");
      const head = await page.locator(".dmsgs-head h1").first().innerText();
      if (head.trim() !== "Discord") fail(size.name + ": split page title is " + head);
      const lit = await page.evaluate((s) => !!document.querySelector(s + ".on, " + s + "[aria-current='page']"), sel);
      if (!lit) fail(size.name + ": the split icon is not marked current");

      // Settings lists it, and the merge button puts it back.
      await page.goto(base + "#/settings/display/inbox");
      await page.waitForSelector("[data-inbox-settings] [data-inbox-row='discord'] [data-inbox-act='merge']");
      await page.click("[data-inbox-settings] [data-inbox-row='discord'] [data-inbox-act='merge']");
      await page.waitForSelector("[data-inbox-settings] [data-inbox-row='discord'] [data-inbox-act='split']");
      await page.goto(base + "#/messages");
      await page.waitForSelector(".inbox-chips [data-inbox='discord']");
      if (await page.locator(sel).count()) fail(size.name + ": merged Discord kept its icon");
      const barAfter = await barIcons();
      if (barAfter !== barBefore) fail(size.name + ": bottom bar not restored: " + barBefore + " -> " + barAfter);
      const saved = await page.evaluate(() => {
        const raw = Object.keys(localStorage).filter((k) => /settings-v1$/.test(k)).map((k) => localStorage.getItem(k))[0];
        return raw ? JSON.parse(raw).inboxLayout : null;
      });
      if (!saved || !Array.isArray(saved.split)) fail(size.name + ": the layout is not saved in settings");
      if (errors.length) fail(size.name + ": page errors " + errors.join(" | "));
      await page.close();
      console.log("inbox split ok:", size.name);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err && err.message || err); process.exitCode = 1; });
