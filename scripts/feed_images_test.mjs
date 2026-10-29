/* Feed pictures never end as a broken-image glyph or an empty black frame.
   Static part: every feed item with media carries non-empty https URLs, and
   the service worker never stores an unreadable (opaque) answer from X's
   picture host, drops a picture the page reports as failed, and purges old
   opaque copies on activate. Browser part (phone size): the picture host and
   our relay both refuse, and the archive list never arrives. Every avatar
   must end as the default silhouette and every photo tile as the picture
   placeholder, with no picture left waiting or broken on screen. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => { console.error("FAIL " + message); process.exitCode = 1; throw new Error(message); };
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

/* Video, GIF, embed and placeholder rows may lack a URL (the player or the
   original post fills them in, see URLLESS_OK in scripts/normalize.py). A photo
   always needs one, and any URL that is present must be a real one. */
const URLLESS_OK = new Set(["video", "animated_gif", "gif", "embed", "placeholder"]);
function mediaUrls(item) {
  const out = [];
  const list = Array.isArray(item.media) ? item.media : [];
  for (const m of list) {
    if (typeof m === "string") { out.push(m); continue; }
    if (!m || typeof m !== "object") continue;
    const type = String(m.type || "photo");
    if (type === "file" || type === "audio") continue;
    if (type === "photo" || !URLLESS_OK.has(type)) out.push(m.url || m.src || "");
    for (const k of ["url", "poster", "thumb", "preview"]) if (m[k] && (k !== "url" || URLLESS_OK.has(type))) out.push(m[k]);
  }
  return out;
}

function staticChecks() {
  const doc = JSON.parse(read("feeds.json"));
  const items = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.media)) items.push(node);
    for (const value of Object.values(node)) if (value && typeof value === "object") walk(value);
  };
  walk(doc);
  let checked = 0;
  for (const item of items) {
    for (const url of mediaUrls(item)) {
      checked += 1;
      if (typeof url !== "string" || !url.trim()) fail("a feed item has an empty media URL");
      if (!/^(?:https:\/\/|\.?\/|data:image\/)/i.test(url)) fail("a feed media URL is not https: " + String(url).slice(0, 60));
      try { if (/^https:/i.test(url)) new URL(url); } catch (err) { fail("a feed media URL does not parse"); }
    }
  }
  const sw = read("sw.js");
  if (!/function corsPictureHost\(/.test(sw)) fail("the service worker must read X picture answers in CORS mode");
  if (!/referrerPolicy: "no-referrer"/.test(sw.slice(sw.indexOf("async function fetchPicture")))) fail("picture fetches from the worker must not send a referrer");
  if (!/res\.type === "opaque" && !corsPictureHost\(request\)/.test(sw)) fail("an opaque answer from X's picture host must never be stored");
  if (!/data\.type === "media-drop"/.test(sw)) fail("the worker must forget a picture the page reports as failed");
  if (!/purgeOpaquePictures\(\)\.catch/.test(sw.slice(sw.indexOf('addEventListener("activate"')))) fail("activate must purge old opaque picture copies");
  const app = read("app.js");
  if (!/const IA_WAIT_MS = \d+;/.test(app) || !/img\.dataset\.iaSkip = "1";/.test(app)) fail("a failed picture must not wait for the archive list forever");
  const boot = app.slice(app.indexOf("const catalogPromise"));
  if (!/catch \(err\) \{\s*STATE\.loading = false;[\s\S]{0,400}loadNewestShard\(\)/.test(boot)) fail("the archive list must still load when the catalog fails");
  if (!/function sweepBrokenImages\(/.test(app) || !/scheduleImageSweep\(\);/.test(app)) fail("pictures whose error event was missed must still fall back");
  if (!/type: "media-drop"/.test(app)) fail("the page must tell the worker about a failed picture");
  const css = read("styles.css");
  if (!/img\[data-ia-wait\] \{ visibility: hidden; \}/.test(css) || !/\.media-gone \{/.test(css)) fail("broken pictures must not show the browser glyph");
  console.log(`ok feed media URLs (${checked} checked) and picture fallback wiring`);
  return checked;
}

function mime(file) {
  if (/\.m?js$/.test(file)) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

async function browserCheck() {
  const core = process.env.PLAYWRIGHT_CORE || "/workspace/pwcore/node_modules/playwright-core";
  let chromium;
  const entry = /\.m?js$/.test(core) ? core : path.join(core, "index.mjs");
  try { ({ chromium } = await import(entry)); } catch (err) { console.log("skip browser picture fallback (no playwright-core)"); return; }
  const doc = JSON.parse(read("feeds.json"));
  const posts = (doc.posts || doc.items || []).filter((p) => p && Array.isArray(p.media) && p.media.some((m) => /pbs\.twimg\.com\/media\//.test(typeof m === "string" ? m : (m && (m.url || m.src)) || "")));
  const pick = posts[0];
  const feedId = pick && (pick.feedId || pick.feed);
  const handle = feedId && String(feedId).includes(":") ? String(feedId).split(":").slice(1).join(":") : "";
  const hash = handle ? "#/@" + encodeURIComponent(handle) : "#/home";
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || "chrome" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
    await ctx.route(/^https:\/\/pbs\.twimg\.com\//, (route) => route.fulfill({ status: 403, contentType: "text/plain", body: "Unauthorized." }));
    await ctx.route(/\/v1\/media\?/, (route) => route.fulfill({ status: 403, contentType: "text/plain", body: "no" }));
    await ctx.route(/ia-manifest\.json|archive\.org\//, () => new Promise(() => {}));
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/${hash}`);
    await page.waitForSelector("article, .post, .tweet", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    /* Fallbacks settle within the archive wait plus a relay try; allow slow CI. */
    await page.waitForFunction(() => !document.querySelector("img[data-ia-wait]") && ![...document.querySelectorAll("#app img")].some((i) => i.getAttribute("src") && i.complete && i.naturalWidth === 0 && !/\.svg/.test(i.src)), null, { timeout: 25000, polling: 250 }).catch(() => {});
    const res = await page.evaluate(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
      const imgs = [...document.querySelectorAll("#app img")];
      return {
        waiting: document.querySelectorAll("img[data-ia-wait]").length,
        broken: imgs.filter((i) => i.getAttribute("src") && i.complete && i.naturalWidth === 0 && visible(i) && !/\.svg/.test(i.src)).map((i) => i.className + " " + i.getAttribute("src").slice(0, 60)),
        silhouettes: document.querySelectorAll("#app .ava.silhouette").length,
        placeholders: document.querySelectorAll("#app .tile.broken .media-gone svg").length,
        emptyFrames: [...document.querySelectorAll("#app .media .tile")].filter((t) => visible(t) && !t.querySelector("img,video,iframe,.media-gone,[data-ds-src]")).length
      };
    });
    if (res.waiting) fail(`${res.waiting} picture(s) still wait for the archive list`);
    if (res.broken.length) fail("broken pictures stay on screen: " + res.broken.slice(0, 3).join(" | "));
    if (res.emptyFrames) fail(`${res.emptyFrames} empty media frame(s)`);
    if (!res.silhouettes) fail("a refused avatar must fall back to the default silhouette");
    if (pick && !res.placeholders) fail("a refused photo must show the picture placeholder");
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    console.log(`ok refused pictures fall back (${res.silhouettes} silhouettes, ${res.placeholders} placeholders)`);
  } finally {
    await browser.close();
    server.close();
  }
}

staticChecks();
await browserCheck();
