/* Communities custom tabs: make a tab from the "+" in the tab row, add
   sources with the picker, add a community from its "..." menu, pin the tab
   to Home, rename, reorder and delete. The tab list stays in this user's
   settings. Placeholders only. */
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


async function settingsTabs(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("viktorychapp-settings-v1") || localStorage.getItem("settings-v1") || "";
    let found = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!/settings-v1$/.test(key)) continue;
      try { const doc = JSON.parse(localStorage.getItem(key)); if (doc && doc.communityTabs) found = doc.communityTabs; } catch (e) {}
    }
    return found || (raw ? null : null);
  });
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
  if (await page.locator(".cm-hub-tabs .tab").count() !== 2) fail(vp.name + " a fresh hub should only have Home and Explore");

  /* New tab from the "+" with one community picked in the search. */
  await page.click(".cm-hub-tabs .cm-tab-add");
  await page.waitForSelector("#cm-tab-editor .cm-tab-editor");
  if (!(await page.locator("#cm-tab-editor .cm-ed-save").isDisabled())) fail(vp.name + " Save works without a name");
  await page.fill("#cm-ed-name", "Mixed");
  await page.fill("#cm-ed-q", "football");
  await page.waitForSelector("#cm-ed-results .cm-src-btn[data-src='c:placeholder_two']");
  await page.click("#cm-ed-results .cm-src-btn[data-src='c:placeholder_two']");
  if (!(await page.locator("#cm-tab-editor .cm-src-btn.on[data-src='c:placeholder_two']").count())) fail(vp.name + " picked community is not in the tab");
  const homeSwitch = await page.getAttribute("#cm-tab-editor [data-cm='ed-home']", "aria-checked");
  if (homeSwitch !== "false") fail(vp.name + " Pin to Home must start off");
  await page.click("#cm-tab-editor .cm-ed-save");
  await page.waitForFunction(() => !document.querySelector("#cm-tab-editor"));
  await page.waitForFunction(() => document.querySelectorAll(".cm-hub[data-hub='tab'] .cm-x-post").length >= 3, null, { timeout: 15000 });
  const got = await page.evaluate(() => {
    const on = document.querySelector(".cm-hub-tabs .tab.on");
    const span = on && on.querySelector("span");
    const line = span ? getComputedStyle(span, "::after") : null;
    const posts = Array.from(document.querySelectorAll(".cm-hub .cm-x-post"));
    return {
      on: on ? on.textContent.trim() : "",
      lineH: line ? parseFloat(line.height) : 0,
      lineR: line ? parseFloat(line.borderTopLeftRadius) : 0,
      lineW: line && span ? parseFloat(line.width) <= span.getBoundingClientRect().width + 1 : false,
      only: posts.every((p) => /placeholder_two/.test((p.querySelector(".cm-x-ctx") || {}).textContent || "")),
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  if (got.on !== "Mixed") fail(vp.name + " new tab is not selected: " + got.on);
  if (got.lineH < 3 || got.lineR < 2 || !got.lineW) fail(vp.name + " tab underline is not short, thick and round: " + JSON.stringify(got));
  if (!got.only) fail(vp.name + " tab feed shows a community that is not in it");
  if (got.overflow) fail(vp.name + " the hub scrolls sideways with a custom tab");
  let saved = await settingsTabs(page);
  if (!saved || saved.tabs.length !== 1 || saved.tabs[0].home !== false || saved.tabs[0].sources.join() !== "c:placeholder_two") fail(vp.name + " settings: " + JSON.stringify(saved));
  if (await page.evaluate(() => Object.keys(localStorage).some((key) => key === "va_cm_tabs"))) fail(vp.name + " tabs went to a side store instead of settings");

  /* Add a second community from its "..." menu. */
  await page.goto(origin + "/#/communities/placeholder_one", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cm-hero [data-cm='more']", { timeout: 15000 });
  await page.click(".cm-hero [data-cm='more']");
  await page.waitForSelector("#cm-tab-assign .cm-assign-row[data-cm='as-toggle']");
  await page.click("#cm-tab-assign .cm-assign-row[data-cm='as-toggle']");
  await page.waitForSelector("#cm-tab-assign .cm-assign-row[aria-checked='true']");
  await page.click("#cm-tab-assign .cm-sheet-back", { position: { x: 5, y: 5 } });
  await page.waitForFunction(() => !document.querySelector("#cm-tab-assign"));
  saved = await settingsTabs(page);
  if (saved.tabs[0].sources.indexOf("c:placeholder_one") < 0) fail(vp.name + " Add to tab did not save: " + JSON.stringify(saved));

  /* Not pinned: Home has no extra tab. Pin it, then it shows on Home. */
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tabs-bar .tabs");
  if (await page.locator(".tabs-bar [data-tab^='ctab:']").count()) fail(vp.name + " an unpinned tab shows on Home");
  await page.goto(origin + "/#/communities", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cm-hub-tabs .tab[data-hub^='tab:']", { timeout: 15000 });
  await page.click(".cm-hub-tabs .tab[data-hub^='tab:']");
  await page.waitForSelector(".cm-tab-tools [data-cm='tab-pin'][aria-pressed='false']");
  await page.click(".cm-tab-tools [data-cm='tab-pin']");
  await page.waitForSelector(".cm-tab-tools [data-cm='tab-pin'][aria-pressed='true']");
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tabs-bar [data-tab^='ctab:']", { timeout: 15000 });
  await page.click(".tabs-bar [data-tab^='ctab:']");
  await page.waitForFunction(() => /#\/ctab\//.test(location.hash) && document.querySelectorAll(".cm-tab-home .cm-x-post").length >= 6, null, { timeout: 20000 });
  const homeTab = await page.evaluate(() => {
    const on = document.querySelector(".tabs-bar .tab.on");
    return { on: on ? on.textContent.trim() : "", both: ["placeholder_one", "placeholder_two"].every((n) => Array.from(document.querySelectorAll(".cm-tab-home .cm-x-ctx")).some((a) => a.textContent.indexOf(n) >= 0)) };
  });
  if (homeTab.on !== "Mixed" || !homeTab.both) fail(vp.name + " Home tab: " + JSON.stringify(homeTab));

  /* Rename, then a second tab and reorder, then delete. */
  await page.goto(origin + "/#/communities", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cm-hub-tabs .tab[data-hub^='tab:']", { timeout: 15000 });
  await page.click(".cm-hub-tabs .tab[data-hub^='tab:']");
  await page.click(".cm-tab-tools [data-cm='tab-edit']");
  await page.fill("#cm-ed-name", "Renamed");
  await page.click("#cm-tab-editor .cm-ed-save");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".cm-hub-tabs .tab")).some((t) => t.textContent.trim() === "Renamed"));
  await page.click(".cm-hub-tabs .cm-tab-add");
  await page.fill("#cm-ed-name", "Second");
  await page.click("#cm-tab-editor .cm-ed-save");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".cm-hub-tabs .tab")).map((t) => t.textContent.trim()).join("|") .endsWith("Renamed|Second"));
  await page.click(".cm-hub-tabs .tab.on");
  await page.click(".cm-tab-empty [data-cm='tab-edit']");
  await page.click("#cm-tab-editor [data-cm='ed-move'][data-dir='-1']:not([disabled])");
  await page.click("#cm-tab-editor .cm-ed-save");
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".cm-hub-tabs .tab")).map((t) => t.textContent.trim()).join("|").endsWith("Second|Renamed"), null, { timeout: 5000 });
  page.once("dialog", (d) => d.accept());
  await page.click(".cm-tab-tools [data-cm='tab-edit']");
  await page.click("#cm-tab-editor [data-cm='ed-delete']");
  await page.waitForFunction(() => !Array.from(document.querySelectorAll(".cm-hub-tabs .tab")).some((t) => t.textContent.trim() === "Second"));
  saved = await settingsTabs(page);
  if (saved.tabs.length !== 1 || saved.tabs[0].name !== "Renamed" || saved.tabs[0].home !== true) fail(vp.name + " after delete: " + JSON.stringify(saved));

  /* Unpin from Home. */
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".tabs-bar [data-tab^='ctab:']", { timeout: 15000 });
  await page.click(".tabs-bar [data-tab^='ctab:']");
  await page.waitForSelector("[data-act='cm-tab-unpin']", { timeout: 20000 });
  await page.click("[data-act='cm-tab-unpin']");
  await page.waitForFunction(() => !document.querySelector(".tabs-bar [data-tab^='ctab:']"), null, { timeout: 10000 });
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
    console.log("community tabs ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
