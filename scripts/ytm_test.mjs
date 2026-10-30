/* YouTube Music inside ViktorychMusic: charts and search come from the
   Worker, songs play in the official embed (a stand-in here) that stays at
   least 200x200 on screen, the dock grows only for YouTube songs, the player
   is asked for its best quality, a pause while hidden is resumed, and our own
   songs still play in their small square. Placeholder titles only. */
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

/* 40 seconds of a quiet 8 kHz tone, 8-bit mono. */
function tone(seconds) {
  const rate = 8000;
  const count = rate * seconds;
  const buf = Buffer.alloc(44 + count);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + count, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write("data", 36); buf.writeUInt32LE(count, 40);
  for (let i = 0; i < count; i += 1) buf[44 + i] = 128 + Math.round(6 * Math.sin(i / 6));
  return buf;
}
const WAV = tone(40);

function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.indexOf("/media/test-tone") === 0) {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), WAV.length - 1) : WAV.length - 1;
        res.writeHead(206, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-range": "bytes " + start + "-" + end + "/" + WAV.length, "content-length": end - start + 1 });
        res.end(WAV.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-length": WAV.length });
      res.end(WAV);
      return;
    }
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

/* A busy runner can land an evaluate on a page that is still settling after
   a navigation; run it again on the new document instead of failing. */
async function ev(page, fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await page.evaluate(fn, arg); }
    catch (err) {
      if (attempt >= 3 || !/context was destroyed|navigat/i.test(String(err && err.message))) throw err;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const href = spec.startsWith("/") ? pathToFileURL(spec).href : spec;
  const mod = await import(href);
  return mod.chromium || (mod.default && mod.default.chromium);
}


/* A stand-in for the YouTube embed: it speaks the same postMessage widget
   protocol and echoes every command back so the test can read them. */
const FAKE_EMBED = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script>
let t = 0, st = -1;
const post = (o) => parent.postMessage(JSON.stringify(o), "*");
const info = () => post({ event: "infoDelivery", info: { playerState: st, currentTime: t, duration: 200, playbackQuality: "hd720", availableQualityLevels: ["hd1080", "hd720", "large", "medium", "small", "tiny", "auto"] } });
addEventListener("message", (e) => {
  let d; try { d = JSON.parse(e.data); } catch (err) { return; }
  if (d.event === "listening") { post({ event: "onReady" }); if (/autoplay=1/.test(location.search) && st < 0) { st = 1; info(); } }
  if (d.event !== "command") return;
  post({ event: "testcmd", func: d.func, args: d.args, id: location.pathname.split("/").pop() });
  if (d.func === "playVideo" || d.func === "loadVideoById") { st = 1; info(); }
  if (d.func === "pauseVideo") { st = 2; info(); }
  if (d.func === "getCurrentTime" && st === 1) { t += 0.5; info(); }
});
<\/script></body>`;

const track = (n, title) => ({ id: "testvid000" + n, title, artist: "Test band", channelId: "", cover: "", duration: 200 });
const CHARTS = { title: "Top songs test", songs: [track(1, "Alpha"), track(2, "Beta"), track(3, "Gamma")] };
const FRESH = { songs: [track(4, "Delta")] };
const SEARCH = { songs: [track(5, "Epsilon")], artists: [], collections: [] };
const RADIO = { songs: [track(6, "Zeta"), track(7, "Eta")] };
const MOODS = ["chill", "focus", "workout", "party"];

function ytmReply(url) {
  const p = new URL(url);
  const name = p.pathname.split("/v1/ytm/")[1] || "";
  if (name.startsWith("config")) return { catalog: "api", oauthClientId: "", spotify: false, moods: MOODS };
  if (name.startsWith("charts")) return CHARTS;
  if (name.startsWith("new")) return FRESH;
  if (name.startsWith("search")) return SEARCH;
  if (name.startsWith("radio")) return RADIO;
  if (name.startsWith("videos")) return { songs: [] };
  return { empty: true };
}

const look = () => {
  const host = document.getElementById("mu-yt-host");
  const frame = document.getElementById("mu-yt-frame");
  const dock = document.getElementById("mu-dock");
  const r = host ? host.getBoundingClientRect() : null;
  const d = dock && !dock.hidden ? dock.getBoundingClientRect() : null;
  const a = document.getElementById("mu-audio");
  return {
    cls: host ? host.className : "",
    w: r ? r.width : 0, h: r ? r.height : 0, left: r ? r.left : 0, top: r ? r.top : 0, right: r ? r.right : 0, bottom: r ? r.bottom : 0,
    vis: host ? getComputedStyle(host).visibility : "",
    src: frame ? frame.src : "",
    dockYt: !!(dock && dock.classList.contains("is-yt")),
    dockW: d ? d.width : 0, dockH: d ? d.height : 0,
    title: (document.getElementById("mu-dock-title") || {}).textContent || "",
    audioPaused: !a || a.paused,
    vw: innerWidth, vh: innerHeight,
    fab: (() => { const f = document.querySelector(".fab"); if (!f || getComputedStyle(f).display === "none") return null; const b = f.getBoundingClientRect(); return b.width ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null; })(),
    cmds: (window.__ytcmds || []).slice()
  };
};

async function until(page, label, fn, arg, timeout) {
  try { await page.waitForFunction(fn, arg, { timeout: timeout || 10000 }); }
  catch (err) { fail(label + " timed out " + JSON.stringify(await ev(page, look).catch((e) => ({ err: String(e && e.message).slice(0, 200) })))); }
}

function onScreen(where, s) {
  if (s.w < 200 || s.h < 200) fail(where + " YouTube player is smaller than 200x200: " + s.w + "x" + s.h);
  if (s.left < 0 || s.top < 0 || s.right > s.vw + 1 || s.bottom > s.vh + 1) fail(where + " YouTube player is off screen " + JSON.stringify(s));
  if (s.vis === "hidden") fail(where + " YouTube player is hidden");
}

async function exercise(browser, origin, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, serviceWorkers: "block" });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (/\/v1\/ytm\//.test(url)) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(ytmReply(url)) });
    if (/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(url)) return route.fulfill({ status: 200, contentType: "text/html", body: FAKE_EMBED });
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  /* The Worker address without the sign-in wall. */
  await context.route(/\/accounts\.config\.js/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: 'window.VIKTORYCH_ACCOUNTS = { api: "https://api.example.test", backupApi: "", gate: false, tiktokAudience: "owner" };' }));
  await context.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    if (!localStorage.getItem("viktorych-music-v1")) {
      localStorage.setItem("viktorych-music-v1", JSON.stringify({
        songs: [{ id: "tone-a", title: "Tone A", artist: "Test", source: "media/test-tone-a.wav", kind: "audio" }],
        volume: 0.2
      }));
    }
    window.__ytcmds = [];
    window.addEventListener("message", (e) => {
      if (!/youtube/.test(String(e.origin))) return;
      try { const d = JSON.parse(e.data); if (d.event === "testcmd") window.__ytcmds.push(d.func + ":" + JSON.stringify(d.args || []) + ":" + d.id); } catch (err) { /* not ours */ }
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message || err).slice(0, 160)));
  const where = vp.name;

  /* Home: YouTube charts, plus our own songs in their own shelf. */
  await page.goto(origin + "/#/music", { waitUntil: "domcontentloaded" });
  await until(page, where + " charts", () => !!document.querySelector(".ytm-tile[data-id='yt:testvid0001']"), null, 20000);
  await until(page, where + " our songs shelf", () => !!document.querySelector(".ytm-ours .mu-tile[data-id='tone-a']"));
  const thumb = await ev(page, () => { const t = document.querySelector(".ytm-tile[data-id='yt:testvid0001'] .ytm-cover"); const r = t.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  if (thumb.w < 120 || thumb.h < 70) fail(where + " track cover is under 120x70: " + JSON.stringify(thumb));

  /* Play a chart song: the visible player is a 200x200 card. */
  await page.click(".ytm-tile[data-id='yt:testvid0001']");
  await until(page, where + " card player", () => { const h = document.getElementById("mu-yt-host"); const f = document.getElementById("mu-yt-frame"); return h && /is-on/.test(h.className) && f && /youtube-nocookie\.com\/embed\/testvid0001/.test(f.src); });
  await until(page, where + " playing", () => (window.__ytcmds || []).some((c) => /^playVideo|^loadVideoById/.test(c)) || /autoplay=1/.test((document.getElementById("mu-yt-frame") || {}).src || ""));
  await until(page, where + " best quality asked", () => (window.__ytcmds || []).some((c) => c.indexOf('setPlaybackQuality:["hd1080"]') === 0));
  let s = await ev(page, look);
  if (!/is-card/.test(s.cls) && !/is-mini/.test(s.cls)) fail(where + " player mode on the music page is " + s.cls);
  onScreen(where + " music page", s);

  /* Elsewhere in the app the dock grows to 200x200 for YouTube only. */
  await ev(page, () => { location.hash = "#/explore"; });
  await until(page, where + " mini player", () => { const h = document.getElementById("mu-yt-host"); return h && /is-mini/.test(h.className); });
  await page.waitForTimeout(300);
  s = await ev(page, look);
  onScreen(where + " mini", s);
  if (!s.dockYt) fail(where + " dock is not in its YouTube size");
  if (s.title !== "Alpha") fail(where + " dock title " + s.title);
  if (s.fab && s.left < s.fab.right && s.right > s.fab.left && s.top < s.fab.bottom && s.bottom > s.fab.top) fail(where + " YouTube mini player covers the compose button");

  /* The app is hidden and YouTube pauses: it is asked to play again. */
  const playsBefore = s.cmds.filter((c) => c.indexOf("playVideo") === 0).length;
  await ev(page, () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    const f = document.getElementById("mu-yt-frame");
    f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*");
  });
  await until(page, where + " auto resume", (n) => (window.__ytcmds || []).filter((c) => c.indexOf("playVideo") === 0).length > n, playsBefore, 8000);
  await ev(page, () => {
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });

  /* Next song stays in the same player. */
  await page.click("#mu-dock [data-act='music-next']").catch(() => ev(page, () => window.SIntelMusic && window.SIntelMusic.next && window.SIntelMusic.next()));
  await until(page, where + " next song", () => (document.getElementById("mu-dock-title") || {}).textContent === "Beta");

  /* Our own song: the YouTube player goes away and the dock is small again. */
  await ev(page, () => { location.hash = "#/music/ours"; });
  await until(page, where + " ours page", () => !!document.querySelector(".mu-tile[data-id='tone-a']"));
  await page.click(".mu-tile[data-id='tone-a']");
  await until(page, where + " own song plays", () => { const a = document.getElementById("mu-audio"); return a && !a.paused && a.currentTime > 0.1; }, null, 15000);
  await ev(page, () => { location.hash = "#/explore"; });
  await until(page, where + " small dock again", () => { const h = document.getElementById("mu-yt-host"); const d = document.getElementById("mu-dock"); return h && /is-off/.test(h.className) && d && !d.classList.contains("is-yt") && !d.hidden && d.getBoundingClientRect().width <= 60; });
  s = await ev(page, look);
  if (s.dockW > 60 || Math.abs(s.dockW - s.dockH) > 1) fail(where + " own song dock is not the small square " + s.dockW + "x" + s.dockH);
  if (!s.cmds.some((c) => c.indexOf("pauseVideo") === 0)) fail(where + " YouTube was not paused for our own song");

  /* Search finds YouTube songs. */
  await ev(page, () => { location.hash = "#/music/search"; });
  await until(page, where + " search page", () => !!document.getElementById("ytm-q"));
  await page.fill("#ytm-q", "epsilon");
  await until(page, where + " search results", () => !!document.querySelector(".ytm-row[data-id='yt:testvid0005']"), null, 8000);
  const row = await ev(page, () => { const t = document.querySelector(".ytm-row[data-id='yt:testvid0005'] .ytm-thumb"); const r = t.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  if (row.w < 120 || row.h < 70) fail(where + " search thumbnail is under 120x70: " + JSON.stringify(row));

  /* The queue page lists what plays next. */
  await ev(page, () => { location.hash = "#/music/queue"; });
  await until(page, where + " queue page", () => /Up next|Nothing queued/.test(document.body.textContent));

  if (errors.length) fail(where + " page error " + errors[0]);
  await context.close();
  console.log("ok ytm " + where);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  try {
    await Promise.all([
      exercise(browser, origin, { name: "phone", width: 390, height: 844 }),
      exercise(browser, origin, { name: "desktop", width: 1280, height: 800 })
    ]);
    console.log("ytm ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
