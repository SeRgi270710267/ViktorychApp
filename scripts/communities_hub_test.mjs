/* The Communities hub looks like X's: avatar, title and search, Home and
   Explore tabs, a row of covers with a see-all arrow, and a feed of post
   cards with a community line. Placeholders only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 390, height: 844, name: "phone" },
  { width: 1280, height: 800, name: "desktop" }
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



const now = Math.floor(Date.now() / 1000);
const INDEX = { communities: [
  { name: "placeholder_one", title: "Placeholder One", subscribers: 5000, icon: "", banner: "", about: "A software and linux placeholder." },
  { name: "placeholder_two", title: "Placeholder Two", subscribers: 900, icon: "", banner: "", about: "A football placeholder." }
] };
function doc(name, n) {
  const posts = [];
  for (let i = 0; i < n; i++) posts.push({ id: name + "_p" + i, title: "Title " + name + " " + i, text: "Body " + i, author: "author_" + i, score: 10 + i, comments: i, created: now - 60 * (i + 1), media: [] });
  return { name, posts, recordings: name === "placeholder_one" ? [{ title: "A recorded placeholder", recorded: "2026-10-14T10:00:00Z", url: "#/communities/placeholder_one" }] : [] };
}

async function exercise(page, vp, origin) {
  await page.route("**/data/communities/**", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    if (file === "index.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) });
    const name = file.replace(/\.json$/, "");
    if (/^placeholder_(one|two)$/.test(name)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(doc(name, 3)) });
    return route.fulfill({ status: 404, body: "missing" });
  });
  await page.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' }));
  await page.goto(origin + "/#/communities", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".cm-x-post").length >= 6, null, { timeout: 20000 });
  const got = await page.evaluate(() => {
    const bar = document.querySelector(".cm-hub-bar");
    const ava = bar && bar.querySelector(".m-ava");
    const tabs = Array.from(document.querySelectorAll(".cm-hub-tabs .tab")).map((t) => ({ text: t.textContent.trim(), on: t.classList.contains("on") }));
    const covers = Array.from(document.querySelectorAll(".cm-covers .cm-cover"));
    const row = document.querySelector(".cm-covers");
    const posts = Array.from(document.querySelectorAll(".cm-x-post"));
    const lazy = Array.from(document.querySelectorAll(".cm-hub img")).every((img) => img.getAttribute("loading") === "lazy");
    const r = covers[0] && covers[0].getBoundingClientRect();
    return {
      title: bar && bar.querySelector("h1").textContent,
      ava: !!ava && getComputedStyle(ava).display !== "none",
      search: !!(bar && bar.querySelector("[data-cm='toggle-search']")),
      tabs,
      caret: !!document.querySelector(".cm-hub-tabs .tab.on .cm-caret"),
      covers: covers.length,
      coverH: r ? Math.round(r.height) : 0,
      coverRound: covers[0] ? parseFloat(getComputedStyle(covers[0]).borderTopLeftRadius) : 0,
      row: row ? getComputedStyle(row).overflowX : "",
      seeAll: !!document.querySelector(".cm-covers .cm-see-all"),
      recs: document.querySelectorAll(".cm-rec").length,
      badge: (document.querySelector(".cm-rec-badge") || {}).textContent || "",
      ctx: posts.every((p) => /r\/placeholder_/.test((p.querySelector(".cm-x-ctx") || {}).textContent || "")),
      votes: posts.every((p) => p.querySelector(".cm-vote-arrow.up") && p.querySelector(".cm-vote-arrow.down")),
      lazy,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  if (got.title !== "Communities") fail(vp.name + " header title: " + got.title);
  if (vp.name === "phone" && !got.ava) fail("phone header has no avatar");
  if (!got.search) fail(vp.name + " header has no search button");
  if (got.tabs.length !== 2 || !/Home/.test(got.tabs[0].text) || !got.tabs[0].on || !/Explore/.test(got.tabs[1].text)) fail(vp.name + " tabs: " + JSON.stringify(got.tabs));
  if (!got.caret) fail(vp.name + " Home tab has no community picker");
  if (got.covers < 2 || got.coverH < 80 || got.coverRound < 8 || got.row !== "auto" || !got.seeAll) fail(vp.name + " cover row: " + JSON.stringify(got));
  if (got.recs !== 1 || !/10\/14/.test(got.badge)) fail(vp.name + " recorded row: " + got.recs + " " + got.badge);
  if (!got.ctx || !got.votes) fail(vp.name + " feed cards need a community line and votes");
  if (!got.lazy) fail(vp.name + " hub images are not lazy");
  if (got.overflow) fail(vp.name + " the hub scrolls sideways");

  await page.click(".cm-hub-tabs .tab.on .cm-caret");
  if (await page.locator(".cm-picker .cm-pick").count() < 2) fail(vp.name + " picker does not list communities");
  await page.click(".cm-see-all");
  await page.waitForSelector(".cm-hub[data-hub='explore'] .cm-card-grid .cm-card");
  if (await page.locator(".cm-cats .cm-chip").count() < 5) fail(vp.name + " Explore has no categories");
  await page.click(".cm-cats .cm-chip[data-cat='sports']");
  const names = await page.evaluate(() => Array.from(document.querySelectorAll(".cm-card-title")).map((el) => el.textContent));
  if (names.length !== 1 || !/placeholder_two/.test(names[0])) fail(vp.name + " category filter: " + names.join(","));
  await page.click("[data-cm='toggle-search']");
  if (!(await page.locator(".cm-search-input").count())) fail(vp.name + " search does not open");
  await page.unroute("**/data/communities/**");
  await page.unroute("**/v1/**");
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("viktorychapp-lang-user-picked", "1");
        localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
      });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await exercise(page, vp, origin);
      await page.close();
    }
    console.log("communities hub ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
