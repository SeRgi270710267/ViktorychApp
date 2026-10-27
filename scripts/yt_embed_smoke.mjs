#!/usr/bin/env node
/* Muted YouTube embed smoke. Confirms the official player reaches
   ready and playing on a desktop viewport and a phone viewport, then
   confirms a failed direct file mounts that same player.
   Records player states only. Does not read or print titles. */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VIDEO_ID = "M7lc1UVf-VE";
const PAGE = (name) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>embed</title>
</head>
<body>
<div id="slot" style="width:100%;max-width:640px;height:360px"></div>
<script src="/video-embed.js"></script>
<script>
window.__ready = false;
window.__playing = false;
window.__fileFailed = false;
window.__states = [];
window.__policy = "";
var ID = ${JSON.stringify(VIDEO_ID)};
var E = window.ViktorychEmbed;
function mount(url) {
  var frame = document.createElement("iframe");
  frame.id = "ytf1";
  frame.style.cssText = "width:100%;height:360px;border:0";
  E.prepareFrame(frame, { url: url, title: "Video" });
  var bound = E.bindFrame(frame, { preview: true, muted: true });
  frame.addEventListener("load", function () {
    bound.nudge();
    setTimeout(bound.nudge, 400);
    setTimeout(bound.nudge, 1200);
  });
  var slot = document.getElementById("slot");
  slot.textContent = "";
  slot.appendChild(frame);
  frame.src = url;
  window.__policy = frame.getAttribute("referrerpolicy") || "";
}
window.addEventListener("message", function (event) {
  var host = String(event.origin || "");
  if (host.indexOf("youtube.com") < 0 && host.indexOf("youtube-nocookie.com") < 0) return;
  var data = event.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (err) { return; }
  }
  if (!data || typeof data !== "object") return;
  if (data.event === "onReady") window.__ready = true;
  var state = null;
  if (data.event === "onStateChange") state = data.info;
  else if (data.info && typeof data.info === "object" && data.info.playerState != null) state = data.info.playerState;
  if (state == null || state === "") return;
  var n = Number(state);
  if (!isFinite(n)) return;
  window.__states.push(n);
  if (n === 1) window.__playing = true;
});
if (${name === "fallback" ? "true" : "false"}) {
  var video = document.createElement("video");
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.src = "/missing.mp4";
  video.addEventListener("error", function () {
    window.__fileFailed = true;
    var next = E.nextAfterDirect({ code: 5 }, ID, { preview: true, origin: location.origin });
    if (!next || next.kind !== "iframe") { window.__playing = false; return; }
    mount(next.url);
  });
} else {
  mount(E.youtubeEmbed(ID, { preview: true, origin: location.origin }));
}
</script>
</body>
</html>`;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}

function chromeBin() {
  const listed = [process.env.CHROME_PATH, process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"];
  for (const bin of listed) {
    if (!bin) continue;
    if (bin.includes("/")) {
      try { statSync(bin); return bin; } catch (err) { continue; }
    }
    const found = spawnSync("which", [bin], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error("Chrome is not installed");
}

function serve(root) {
  const base = resolve(root);
  const helper = readFileSync(join(base, "video-embed.js"));
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/video-embed.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(helper);
      return;
    }
    if (url.pathname === "/play.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PAGE("play"));
      return;
    }
    if (url.pathname === "/fallback.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(PAGE("fallback"));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end("missing");
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      done({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function launch(width, height) {
  const dir = mkdtempSync(join(tmpdir(), "viktorych-yt-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const logPath = join(dir, "chrome.log");
  const logFd = openSync(logPath, "a");
  const bin = chromeBin();
  const chrome = spawn(bin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`,
    "about:blank"
  ], { stdio: ["ignore", logFd, logFd] });
  let wsUrl = "";
  for (let i = 0; i < 50; i++) {
    try {
      const ver = JSON.parse(await (await fetch(`http://127.0.0.1:${port}/json/version`)).text());
      wsUrl = ver.webSocketDebuggerUrl;
      break;
    } catch (err) {
      await sleep(200);
    }
  }
  if (!wsUrl) {
    chrome.kill();
    let detail = "";
    try { detail = readFileSync(logPath, "utf8").trim().slice(-500); } catch (err) { detail = ""; }
    throw new Error("Chrome did not open a debugger" + (detail ? "\n" + detail : ""));
  }
  const targets = JSON.parse(await (await fetch(`http://127.0.0.1:${port}/json/list`)).text());
  const page = targets.find((item) => item.type === "page") || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params) {
    const msgId = ++id;
    return new Promise((done, reject) => {
      pending.set(msgId, { done, reject });
      ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
    });
  }
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(JSON.stringify(msg.error)));
      else waiter.done(msg.result);
    }
  });
  await new Promise((done, reject) => {
    ws.addEventListener("open", done);
    ws.addEventListener("error", reject);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  return {
    async open(url) {
      await send("Page.navigate", { url });
    },
    async status() {
      const info = await send("Runtime.evaluate", {
        expression: "({ ready: !!window.__ready, playing: !!window.__playing, fileFailed: !!window.__fileFailed, policy: window.__policy || '', states: (window.__states || []).slice(-8), helper: !!window.ViktorychEmbed })",
        returnByValue: true
      });
      return info.result && info.result.value ? info.result.value : {};
    },
    async close() {
      try { ws.close(); } catch (err) { /* already closed */ }
      chrome.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function waitUntil(session, label, pred, ms) {
  const start = Date.now();
  let last = {};
  while (Date.now() - start < ms) {
    last = await session.status();
    if (pred(last)) return last;
    await sleep(500);
  }
  throw new Error(label + " did not reach playback: " + JSON.stringify({
    ready: !!last.ready,
    playing: !!last.playing,
    fileFailed: !!last.fileFailed,
    policy: last.policy || "",
    states: last.states || [],
    helper: !!last.helper
  }));
}

async function playCase(origin, path, width, height, label) {
  const session = await launch(width, height);
  try {
    await session.open(origin + path);
    const result = await waitUntil(session, label, (row) => row.ready && row.playing, 45000);
    if (result.policy !== "strict-origin-when-cross-origin") {
      throw new Error(label + " referrer policy was " + result.policy);
    }
    console.log(label + " ready+playing states=" + (result.states || []).join(","));
  } finally {
    await session.close();
  }
}

const root = resolve(arg("--root", "."));
const served = await serve(root);
try {
  await playCase(served.origin, "/play.html", 1366, 768, "desktop");
  await playCase(served.origin, "/play.html", 390, 844, "mobile");
  const session = await launch(1366, 768);
  try {
    await session.open(served.origin + "/fallback.html");
    const result = await waitUntil(session, "fallback", (row) => row.fileFailed && row.ready && row.playing, 45000);
    console.log("fallback file-error then ready+playing states=" + (result.states || []).join(","));
  } finally {
    await session.close();
  }
} finally {
  served.server.close();
}
console.log("youtube embed smoke passed");
