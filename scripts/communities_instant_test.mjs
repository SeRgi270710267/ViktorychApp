import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/* Local-first rule for Communities: once this device has seen the list, a
   community, or a thread, opening it again paints that copy at once, even when
   the network is slow (requests hang) or gone (requests fail), and never shows
   a "Loading" placeholder. Scroll position is kept on the way back. */
const now = Math.floor(Date.now() / 1000);
const INDEX = { communities: [
  { name: "placeholder_one", type: "discourse", title: "Placeholder One", subscribers: 5000, icon: "", banner: "", about: "A placeholder." },
  { name: "placeholder_two", title: "Placeholder Two", subscribers: 900, icon: "", banner: "", about: "Another placeholder." }
] };
function doc(name, n) {
  const posts = [];
  for (let i = 0; i < n; i++) posts.push({ id: name + "_p" + i, title: "Title " + name + " " + i, text: "Body " + i, author: "author_" + i, score: 10 + i, comments: 2, created: now - 60 * (i + 1), media: [] });
  return { name, posts, recordings: [] };
}
const COMMENTS = { replies: [
  { id: "c1", parent: "placeholder_one_p0", author: "author_c1", text: "Cached comment one", score: 3, created: now - 30 },
  { id: "c2", parent: "placeholder_one_p0", author: "author_c2", text: "Cached comment two", score: 2, created: now - 20 }
] };
const ROUTES = [
  { hash: "#/communities", ready: () => document.querySelectorAll(".cm-x-post").length >= 6, text: "Title placeholder_one" },
  { hash: "#/communities/placeholder_one", ready: () => /Title placeholder_one 0/.test(document.body.textContent), text: "Title placeholder_one 0" },
  { hash: "#/communities/placeholder_one/placeholder_one_p0", ready: () => /Cached comment one/.test(document.body.textContent), text: "Cached comment one" }
];

async function routeData(page, mode) {
  await page.unroute("**/data/communities/**").catch(() => {});
  await page.unroute("**/v1/**").catch(() => {});
  await page.route("**/data/communities/**", async (route) => {
    if (mode === "hang") return; /* never answers: a very slow network */
    if (mode === "offline") return route.abort("internetdisconnected");
    const parts = new URL(route.request().url()).pathname.split("/");
    const file = parts.pop();
    const dir = parts.pop();
    if (file === "index.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INDEX) });
    if (dir === "placeholder_one" && file === "placeholder_one_p0.json") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COMMENTS) });
    const name = file.replace(/\.json$/, "");
    if (/^placeholder_(one|two)$/.test(name)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(doc(name, 30)) });
    return route.fulfill({ status: 404, body: "missing" });
  });
  await page.route("**/v1/**", (route) => {
    if (mode === "hang") return;
    if (mode === "offline") return route.abort("internetdisconnected");
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' });
  });
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.addInitScript(() => {
      localStorage.setItem("viktorychapp-lang-user-picked", "1");
      localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
      /* Record every loading placeholder that is ever painted. */
      window.__loadingSeen = [];
      const watch = () => {
        const el = document.querySelector(".reply-empty, .tab-loading, [role=progressbar]");
        if (el && /Loading|^$/.test((el.textContent || "").trim())) window.__loadingSeen.push(location.hash + " " + el.className);
      };
      new MutationObserver(watch).observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage();

    /* 1. Online: first visits fill the cache. */
    await routeData(page, "online");
    for (const r of ROUTES) {
      await page.goto(origin + "/" + r.hash, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(r.ready, null, { timeout: 20000 }).catch(async () => fail("online " + r.hash + " never rendered: " + (await page.evaluate(() => (document.getElementById("app") || document.body).innerText.replace(/\s+/g, " ").slice(0, 400)))));
      await page.waitForTimeout(700);
    }
    const stored = await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem("viktorych-swr-v1-index") || "{}");
      const keys = Object.keys(index);
      return { keys, bytes: keys.reduce((n, k) => n + (index[k].b || 0), 0), limit: window.ViktorychLocal && window.ViktorychLocal.swr.limits.bytes };
    });
    for (const k of ["cm:index", "cm:doc:placeholder_one", "cm:c:placeholder_one/placeholder_one_p0"]) {
      if (stored.keys.indexOf(k) < 0) fail("cache is missing " + k + ": " + stored.keys.join(","));
    }
    if (!stored.limit || stored.bytes > stored.limit) fail("cache is over its byte budget: " + stored.bytes);

    /* 2. Slow and offline: every cached route paints at once, no Loading. */
    for (const mode of ["hang", "offline"]) {
      await routeData(page, mode);
      for (const r of ROUTES) {
        await page.goto("about:blank");
        await page.goto(origin + "/" + r.hash, { waitUntil: "domcontentloaded" });
        try {
          await page.waitForFunction((t) => document.body && document.body.textContent.indexOf(t) >= 0, r.text, { timeout: 4000 });
        } catch (err) {
          fail(mode + " " + r.hash + " did not paint from cache");
        }
        await page.waitForTimeout(500);
        const got = await page.evaluate(() => ({ seen: window.__loadingSeen.slice(), missing: /wasn.t found/i.test(document.body.textContent) }));
        if (got.seen.length) fail(mode + " " + r.hash + " showed a loading placeholder with a cache: " + got.seen.join(" | "));
        if (got.missing) fail(mode + " " + r.hash + " said the community wasn't found");
      }
    }

    /* 3. Scroll is kept when going back from a thread. */
    await routeData(page, "hang");
    await page.goto("about:blank");
    await page.goto(origin + "/#/communities/placeholder_one", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(ROUTES[1].ready, null, { timeout: 4000 });
    await page.waitForTimeout(1200);
    await page.mouse.move(195, 500);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60); }
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => window.scrollY);
    /* Open the thread the way a tap does: through a link click. */
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#/communities/placeholder_one/placeholder_one_p0";
      (document.querySelector("main") || document.body).appendChild(a);
      a.click();
    });
    await page.waitForFunction(ROUTES[2].ready, null, { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__scrollTrace = [];
      const t0 = performance.now();
      const id = setInterval(() => {
        window.__scrollTrace.push(Math.round(performance.now() - t0) + ":" + location.hash.slice(-4) + ":" + Math.round(window.scrollY) + "/" + document.documentElement.scrollHeight);
        if (window.__scrollTrace.length > 40) clearInterval(id);
      }, 50);
    });
    await page.goBack();
    await page.waitForFunction(ROUTES[1].ready, null, { timeout: 4000 });
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) <= 80, before, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.scrollY);
    if (before < 300 || Math.abs(after - before) > 80) {
      const info = await page.evaluate(() => location.hash + " height " + document.documentElement.scrollHeight + "/" + window.innerHeight + " trace " + (window.__scrollTrace || []).join(" "));
      fail("scroll position was not kept: " + before + " -> " + after + " (" + info + ")");
    }

    console.log("communities local-first ok (" + stored.keys.length + " cached entries, " + stored.bytes + " bytes)");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
