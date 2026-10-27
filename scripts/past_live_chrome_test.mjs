// Plays one stream-copied fMP4 recording the way the Worker serves it.
// Asserts a picture, that time moves, and that a seek lands.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlaylist } from "../worker/src/telegram.js";

const root = new URL("..", import.meta.url).pathname;
const hlsJs = readFileSync(join(root, "hls-1.7.3.min.js"));

function which(name) {
  const found = spawnSync("which", [name], { encoding: "utf8" });
  const path = (found.stdout || "").trim();
  return found.status === 0 && path ? path : "";
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(cmd + " failed");
  }
}

async function downloadChrome() {
  const dest = join(process.env.HOME || "/tmp", ".cache/chrome-for-testing");
  const bin = join(dest, "chrome");
  if (existsSync(bin)) return bin;
  mkdirSync(dest, { recursive: true });
  const listed = await fetch("https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json");
  if (!listed.ok) throw new Error("chrome list");
  const doc = await listed.json();
  const downloads = (((doc.channels || {}).Stable || {}).downloads || {}).chrome || [];
  const hit = downloads.find((row) => row.platform === "linux64");
  if (!hit || !hit.url) throw new Error("chrome url");
  const archive = join(dest, "chrome.zip");
  const curl = spawnSync("curl", ["-fsSL", "--retry", "3", "--connect-timeout", "20", "--max-time", "180", "-o", archive, hit.url], { encoding: "utf8" });
  if (curl.status !== 0) throw new Error("chrome download");
  const unzip = spawnSync("unzip", ["-q", "-o", archive, "-d", dest], { encoding: "utf8" });
  if (unzip.status !== 0) throw new Error("chrome unzip");
  const unpacked = spawnSync("find", [dest, "-type", "f", "-name", "chrome"], { encoding: "utf8" });
  const chrome = (unpacked.stdout || "").split("\n").map((line) => line.trim()).find((line) => line.endsWith("/chrome"));
  if (!chrome) throw new Error("chrome binary");
  return chrome;
}

async function chromeBin() {
  const named = process.env.CHROME || which("google-chrome") || which("google-chrome-stable") || which("chromium") || which("chromium-browser");
  if (named) return named;
  return downloadChrome();
}

function record() {
  const dir = mkdtempSync(join(tmpdir(), "past-live-"));
  const src = join(dir, "src.flv");
  const out = join(dir, "out");
  mkdirSync(out);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-f", "hls", "-hls_time", "2", "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4", "-hls_flags", "independent_segments+temp_file", "-hls_list_size", "0", "-start_number", "0", "-hls_segment_filename", join(out, "seg%05d.m4s"), join(out, "index.m3u8")]);
  const init = readFileSync(join(out, "init.mp4"));
  if (init.length < 32 || init.indexOf("ftyp") < 0 || init.indexOf("moov") < 0) throw new Error("init");
  const files = readdirSync(out).filter((name) => name.startsWith("seg") && name.endsWith(".m4s")).sort();
  if (!files.length) throw new Error("segments");
  const rows = [{ kind: "init", part_index: -1, size: init.length, duration: 0 }];
  files.forEach((name, index) => {
    rows.push({ kind: "segment", part_index: index, size: readFileSync(join(out, name)).length, duration: 2 });
  });
  return { dir, out, rows };
}

function startServer(out, playlistOf) {
  const html = `<!doctype html><meta charset="utf-8"><video id="v" playsinline muted autoplay></video>
<script src="/hls-1.7.3.min.js"></script>
<script>
var video = document.getElementById("v");
var player = new Hls({ enableWorker: false, maxBufferLength: 30, maxMaxBufferLength: 120, startFragPrefetch: true });
player.loadSource("/tg/tiktok/example/1000000000000001/live/1/index.m3u8");
player.attachMedia(video);
player.on(Hls.Events.MANIFEST_PARSED, function () { video.play(); });
</script>`;
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "range, authorization",
      "access-control-expose-headers": "content-length, content-range, accept-ranges, content-type"
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    let body = null;
    let type = "application/octet-stream";
    if (url.pathname === "/") {
      body = Buffer.from(html);
      type = "text/html; charset=utf-8";
    } else if (url.pathname === "/hls-1.7.3.min.js") {
      body = hlsJs;
      type = "text/javascript; charset=utf-8";
    } else if (url.pathname.endsWith("/index.m3u8")) {
      body = Buffer.from(playlistOf());
      type = "application/vnd.apple.mpegurl";
    } else if (url.pathname.endsWith("/init")) {
      body = readFileSync(join(out, "init.mp4"));
      type = "video/mp4";
    } else {
      const match = url.pathname.match(/\/(\d+)$/);
      if (match) {
        body = readFileSync(join(out, "seg" + String(match[1]).padStart(5, "0") + ".m4s"));
        type = "video/mp4";
      }
    }
    if (!body) {
      res.writeHead(404, headers);
      res.end();
      return;
    }
    const range = String(req.headers.range || "");
    const found = range.match(/^bytes=(\d+)-(\d*)$/);
    headers["accept-ranges"] = "bytes";
    headers["content-type"] = type;
    if (found) {
      const start = Number(found[1]);
      const end = found[2] ? Number(found[2]) : body.length - 1;
      headers["content-range"] = "bytes " + start + "-" + end + "/" + body.length;
      headers["content-length"] = String(end - start + 1);
      res.writeHead(206, headers);
      res.end(body.subarray(start, end + 1));
      return;
    }
    headers["content-length"] = String(body.length);
    res.writeHead(200, headers);
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function waitJson(port) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/json/version");
      if (res.ok) return res.json();
    } catch (err) { /* chrome is still starting */ }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("chrome");
}

function cdpMessage(raw) {
  const data = raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
  const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
  return JSON.parse(text);
}

async function evaluate(ws, expression) {
  const id = Math.floor(Math.random() * 1e9);
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cdp")), 10000);
    const onMessage = (raw) => {
      let message;
      try { message = cdpMessage(raw); } catch (err) { return; }
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error("cdp"));
      else resolve(message.result && message.result.result);
    };
    ws.addEventListener("message", onMessage);
  });
  ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

async function main() {
  const recorded = record();
  let playlist = "";
  const live = await startServer(recorded.out, () => playlist);
  const livePort = live.address().port;
  const origin = "http://127.0.0.1:" + livePort;
  playlist = buildPlaylist(recorded.rows, "tiktok/example/1000000000000001/live/1", origin);
  if (!playlist.includes("#EXT-X-MAP") || !playlist.includes("#EXT-X-ENDLIST")) throw new Error("playlist");
  const chrome = await chromeBin();
  const profile = mkdtempSync(join(tmpdir(), "chrome-past-"));
  const debugPort = 9300 + Math.floor(Math.random() * 200);
  const child = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + profile,
    "about:blank"
  ], { stdio: "ignore" });
  try {
    const version = await waitJson(debugPort);
    const browser = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      browser.addEventListener("open", resolve);
      browser.addEventListener("error", () => reject(new Error("browser")));
    });
    const created = await new Promise((resolve, reject) => {
      const id = 1;
      const onMessage = (raw) => {
        let message;
        try { message = cdpMessage(raw); } catch (err) { return; }
        if (message.id !== id) return;
        browser.removeEventListener("message", onMessage);
        if (!message.result || !message.result.targetId) reject(new Error("target"));
        else resolve(message.result.targetId);
      };
      browser.addEventListener("message", onMessage);
      browser.send(JSON.stringify({ id, method: "Target.createTarget", params: { url: "http://127.0.0.1:" + livePort + "/" } }));
    });
    const attached = await new Promise((resolve, reject) => {
      const id = 2;
      const onMessage = (raw) => {
        let message;
        try { message = cdpMessage(raw); } catch (err) { return; }
        if (message.id !== id) return;
        browser.removeEventListener("message", onMessage);
        if (!message.result || !message.result.sessionId) reject(new Error("session"));
        else resolve(message.result.sessionId);
      };
      browser.addEventListener("message", onMessage);
      browser.send(JSON.stringify({ id, method: "Target.attachToTarget", params: { targetId: created, flatten: true } }));
    });
    const page = browser;
    const send = (id, method, params) => page.send(JSON.stringify({ id, sessionId: attached, method, params }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const started = Date.now();
    let sample = null;
    while (Date.now() - started < 20000) {
      const value = await new Promise((resolve, reject) => {
        const id = 10 + Math.floor(Math.random() * 1000);
        const timer = setTimeout(() => reject(new Error("eval")), 8000);
        const onMessage = (raw) => {
          let message;
          try { message = cdpMessage(raw); } catch (err) { return; }
          if (message.id !== id) return;
          clearTimeout(timer);
          page.removeEventListener("message", onMessage);
          resolve(message.result && message.result.result && message.result.result.value);
        };
        page.addEventListener("message", onMessage);
        send(id, "Runtime.evaluate", { expression: "({w:document.querySelector('video').videoWidth,t:document.querySelector('video').currentTime,d:document.querySelector('video').duration})", returnByValue: true });
      });
      if (value && value.w > 0 && value.t > 0.2) {
        sample = value;
        break;
      }
      await new Promise((done) => setTimeout(done, 300));
    }
    if (!sample || !(sample.w > 0) || !(sample.t > 0.2)) throw new Error("playback");
    const later = await new Promise((resolve, reject) => {
      const id = 50;
      const timer = setTimeout(() => reject(new Error("seek")), 8000);
      const onMessage = (raw) => {
        let message;
        try { message = cdpMessage(raw); } catch (err) { return; }
        if (message.id !== id) return;
        clearTimeout(timer);
        page.removeEventListener("message", onMessage);
        resolve(message.result && message.result.result && message.result.result.value);
      };
      page.addEventListener("message", onMessage);
      send(id, "Runtime.evaluate", {
        expression: "new Promise(function(resolve){var v=document.querySelector('video');v.currentTime=4;v.addEventListener('seeked',function(){resolve({w:v.videoWidth,t:v.currentTime});},{once:true});})",
        awaitPromise: true,
        returnByValue: true
      });
    });
    if (!later || !(later.w > 0) || !(later.t > 3.2)) throw new Error("seek");
    browser.close();
    console.log("past live chrome playback passed");
  } finally {
    try { child.kill("SIGKILL"); } catch (err) { /* already gone */ }
    live.close();
    rmSync(recorded.dir, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : "playback failed");
  process.exit(1);
});
