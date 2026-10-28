/* The music player survives navigation: one audio element, a mini dock on every
   route, saved queue and position, other media takes over. Placeholders only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 390, height: 844, name: "phone" }
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



function toneWav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write("data", 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(20 * Math.sin(i / 8));
  return buf;
}
const WAV = toneWav(60);

async function run(browser, origin, vp) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' }));
  await context.route("**/data/music.json*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"songs":[],"playlists":[]}' }));
  await context.route("**/media/__tone*.wav", (route) => {
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
    if (!m) return route.fulfill({ status: 200, contentType: "audio/wav", headers: { "accept-ranges": "bytes" }, body: WAV });
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), WAV.length - 1) : WAV.length - 1;
    return route.fulfill({ status: 206, contentType: "audio/wav", headers: { "accept-ranges": "bytes", "content-range": "bytes " + start + "-" + end + "/" + WAV.length }, body: WAV.subarray(start, end + 1) });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    if (!localStorage.getItem("viktorych-music-v1")) {
      localStorage.setItem("viktorych-music-v1", JSON.stringify({ songs: [
        { id: "tone-a", title: "Tone A", artist: "Test Artist", source: "media/__tone-a.wav", duration: 60 },
        { id: "tone-b", title: "Tone B", artist: "Test Artist", source: "media/__tone-b.wav", duration: 60 }
      ], volume: 0.4 }));
    }
  });
  const tag = vp.name;
  const state = () => page.evaluate(() => {
    const a = document.getElementById("mu-audio");
    const dock = document.getElementById("mu-dock");
    const r = dock && !dock.hidden ? dock.getBoundingClientRect() : null;
    const nav = document.querySelector(".bottom-nav, nav.bottom, .bnav");
    const nr = nav && nav.offsetParent !== null ? nav.getBoundingClientRect() : null;
    return {
      playing: !!(a && !a.paused), time: a ? a.currentTime : 0,
      dock: !!r && r.height > 0, dockBottom: r ? r.bottom : 0, navTop: nr ? nr.top : null, vh: innerHeight,
      title: (document.getElementById("mu-dock-title") || {}).textContent || "",
      mini: document.documentElement.classList.contains("music-mini"),
      now: !!(document.getElementById("mu-now") && !document.getElementById("mu-now").hidden),
      saved: JSON.parse(localStorage.getItem("viktorychmusic-play-v1") || "null")
    };
  });
  await page.goto(origin + "/#/music", { waitUntil: "domcontentloaded" });
  const tile = page.locator('[data-act="music-play"][data-id="tone-a"]').first();
  await tile.waitFor({ timeout: 20000 });
  await tile.evaluate((el) => el.click());
  await page.waitForFunction(() => { const a = document.getElementById("mu-audio"); return a && !a.paused && a.currentTime > 0.3; }, null, { timeout: 15000 }).catch(() => {});
  let s = await state();
  if (!s.playing) fail(tag + ": the song starts on the music page");
  for (const hash of ["#/", "#/explore", "#/notifications"]) {
    const before = s.time;
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(900);
    s = await state();
    if (!s.playing || s.time <= before) fail(tag + ": music keeps playing on " + hash + " " + JSON.stringify(s));
    if (!s.dock || !s.mini || s.title !== "Tone A") fail(tag + ": the mini player shows on " + hash + " " + JSON.stringify(s));
    if (s.dockBottom > s.vh + 1) fail(tag + ": the mini player is on screen");
    if (s.navTop != null && s.dockBottom > s.navTop + 1) fail(tag + ": the mini player sits above the bottom bar " + JSON.stringify(s));
  }
  await page.locator("#mu-dock .mu-id").first().evaluate((el) => el.click());
  await page.waitForTimeout(200);
  s = await state();
  if (!s.now) fail(tag + ": the mini player expands to the full view off the music page");
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForTimeout(300);
  s = await state();
  if (s.now) fail(tag + ": moving to another page folds the full view back");
  // Sound from other media takes over.
  await page.evaluate(() => { const other = new Audio("media/__tone-b.wav"); other.id = "other-media"; document.body.appendChild(other); other.play(); });
  await page.waitForTimeout(800);
  s = await state();
  if (s.playing) fail(tag + ": an unmuted video or audio pauses the music");
  await page.evaluate(() => { const o = document.getElementById("other-media"); if (o) { o.pause(); o.remove(); } });
  if (!s.saved || s.saved.id !== "tone-a" || !(s.saved.at > 0)) fail(tag + ": queue and position are saved " + JSON.stringify(s.saved));
  const at = s.saved.at;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const t = document.getElementById("mu-dock-title"); const d = document.getElementById("mu-dock"); return d && !d.hidden && t && t.textContent === "Tone A"; }, null, { timeout: 15000 }).catch(() => {});
  s = await state();
  if (!s.dock || s.title !== "Tone A") fail(tag + ": after a reload the mini player keeps the song " + JSON.stringify(s));
  await page.locator('#mu-dock [data-act="music-toggle"]').first().evaluate((el) => el.click());
  await page.waitForFunction(() => { const a = document.getElementById("mu-audio"); return a && !a.paused && a.currentTime > 0; }, null, { timeout: 15000 }).catch(() => {});
  s = await state();
  if (!s.playing || s.time + 0.5 < at) fail(tag + ": play resumes from the saved position (" + at + "s) " + JSON.stringify({ playing: s.playing, time: s.time }));
  await context.close();
  console.log("music player ok " + tag);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });
  try {
    for (const vp of widths) await run(browser, origin, vp);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message);
});
