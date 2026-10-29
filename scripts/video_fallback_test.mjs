/* Video fallback chain: the direct file, the relay, each backup fetcher and a
   fresh resolver URL are tried in order; only then the official embed shows,
   as a tap-to-load placeholder that loads nothing until tapped, scaled to
   cover the post's video frame. Placeholders only. */
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



const STATUS = "1000000000000001";
async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage();
    const hits = [];
    await page.route("**/clip/**", (route) => { hits.push(new URL(route.request().url()).pathname); return route.fulfill({ status: 404, body: "gone" }); });
    let embedLoads = 0;
    await page.route("https://platform.twitter.com/**", (route) => { embedLoads += 1; return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body style='margin:0;background:#000'></body></html>" }); });
    await page.route("https://www.tiktok.com/**", (route) => { embedLoads += 1; return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" }); });
    await page.setContent("<!doctype html><html><body style='margin:0'><div id='slot' class='vplay' style='position:relative;width:400px;height:225px;overflow:hidden;background:#000'></div></body></html>");
    await page.addScriptTag({ url: origin + "/video-embed.js" });
    await page.evaluate((o) => {
      const E = window.ViktorychEmbed;
      const slot = document.getElementById("slot");
      E.runXPlayback(slot, {
        plan: {
          primary: { kind: "mp4", url: o + "/clip/direct.mp4", origin: o + "/clip/direct.mp4" },
          relay: { kind: "mp4", url: o + "/clip/relay.mp4", origin: o + "/clip/direct.mp4" },
          backups: [{ kind: "mp4", url: o + "/clip/backup.mp4", origin: o + "/clip/direct.mp4" }],
          embedUrl: E.xEmbedUrl("1000000000000001"),
          openUrl: E.xOpenUrl("1000000000000001", "status")
        },
        stallMs: 1500,
        tapToLoad: true,
        tapLabel: "Play with the X player",
        refresh: () => Promise.resolve({ url: o + "/clip/fresh.mp4" })
      });
    }, origin);
    await page.waitForSelector("#slot .vembed-tap", { timeout: 20000 });
    const order = hits.join(",");
    if (order !== "/clip/direct.mp4,/clip/relay.mp4,/clip/backup.mp4,/clip/fresh.mp4") fail("routes ran out of order: " + order);
    if (await page.locator("#slot iframe").count()) fail("the embed loaded before a tap");
    if (embedLoads) fail("the embed cost data before a tap");
    await page.click("#slot .vembed-tap");
    await page.waitForSelector("#slot .vembed-fit iframe");
    const fit = await page.evaluate(() => {
      const slot = document.getElementById("slot").getBoundingClientRect();
      const box = document.querySelector("#slot .vembed-fit");
      const frame = box.querySelector("iframe").getBoundingClientRect();
      return {
        src: box.querySelector("iframe").getAttribute("src"),
        overflow: getComputedStyle(box).overflow,
        covers: frame.left <= slot.left + 1 && frame.top <= slot.top + 1 && frame.right >= slot.right - 1 && frame.bottom >= slot.bottom - 1,
        centred: Math.abs((frame.left + frame.right) / 2 - (slot.left + slot.right) / 2) < 2
      };
    });
    if (fit.src.indexOf("https://platform.twitter.com/embed/Tweet.html?id=" + STATUS) !== 0) fail("embed src: " + fit.src);
    if (fit.overflow !== "hidden" || !fit.covers || !fit.centred) fail("embed does not cover the frame: " + JSON.stringify(fit));

    // TikTok: the official player waits behind its own placeholder.
    await page.evaluate(() => {
      const E = window.ViktorychEmbed;
      const slot = document.getElementById("slot");
      slot.textContent = "";
      E.mountTapEmbed(slot, E.officialEmbed({ platform: "tiktok", statusId: "7300000000000000001" }, {}), { label: "Play with the TikTok player" });
    });
    await page.click("#slot .vembed-tap");
    await page.waitForSelector("#slot .vembed-fit iframe");
    const tt = await page.evaluate(() => document.querySelector("#slot .vembed-fit iframe").getAttribute("src"));
    if (tt !== "https://www.tiktok.com/embed/v2/7300000000000000001") fail("tiktok embed src: " + tt);
    await page.close();
    console.log("video fallback ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
