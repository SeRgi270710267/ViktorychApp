// Headless timeline: a stale local snapshot paints first, then synthetic
// sources insert the newest row. No accounts or names are printed.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function which(name) {
  const found = spawnSync("which", [name], { encoding: "utf8" });
  const path = (found.stdout || "").trim();
  return found.status === 0 && path ? path : "";
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

function post(id, date, feed) {
  return {
    id: id,
    statusId: id,
    platform: "rss",
    feedId: feed,
    kind: "post",
    date: date,
    text: id,
    title: id,
    author: feed,
    handle: feed
  };
}

const feeds = [
  { id: "src-a", platform: "rss", handle: "src-a", name: "src-a" },
  { id: "src-b", platform: "rss", handle: "src-b", name: "src-b" }
];
const oldPosts = [];
for (let i = 0; i < 12; i++) {
  const n = String(i).padStart(2, "0");
  oldPosts.push(post("old-" + n, "2026-10-27T10:" + n + ":00Z", i % 2 ? "src-b" : "src-a"));
}
const catalog = { updated: "2026-10-27T10:12:00Z", feeds: feeds, posts: oldPosts };
const config = {
  feeds: [
    { id: "src-a", platform: "rss", adapter: "rss", handle: "src-a", source_urls: ["https://fixture.test/src-a"] },
    { id: "src-b", platform: "rss", adapter: "rss", handle: "src-b", source_urls: ["https://fixture.test/src-b"] }
  ]
};
const snapshot = { savedAt: Date.now() - 10 * 60 * 1000, updated: catalog.updated, feeds: feeds, posts: oldPosts };
const settings = { version: 1, initialized: true, follows: ["src-a", "src-b"], lists: [], feedTabs: [] };

const mock = `<script>
(function () {
  var orig = window.fetch.bind(window);
  var delay = { "src-a": 200, "src-b": 8000 };
  window.__feedHits = [];
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var hit = /fixture\\.test\\/(src-[ab])/.exec(url);
    if (hit) {
      var id = hit[1];
      var selected = "";
      var on = document.querySelector(".tab.on span");
      if (on) selected = on.textContent || "";
      window.__feedHits.push({ id: id, t: performance.now(), tab: selected });
      var row = id === "src-a" ? "new-a" : "new-b";
      var when = id === "src-a" ? "Mon, 27 Oct 2026 11:50:00 GMT" : "Mon, 27 Oct 2026 11:55:00 GMT";
      var body = '<?xml version="1.0"?><rss version="2.0"><channel><title>' + row + '</title><item><title>' + row + '</title><guid>' + row + '</guid><pubDate>' + when + '</pubDate><description>' + row + '</description></item></channel></rss>';
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/rss+xml" } }));
        }, delay[id] || 200);
      });
    }
    var parsed = null;
    try { parsed = new URL(url, location.href); } catch (err) { parsed = null; }
    if (parsed && parsed.origin === location.origin) return orig(input, init);
    return Promise.resolve(new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } }));
  };
})();
</script>`;

function contentType(file) {
  const ext = extname(file);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".webmanifest") return "application/manifest+json";
  return "application/octet-stream";
}

function startServer() {
  const index = readFileSync(join(root, "index.html"), "utf8").replace("<head>", "<head>" + mock);
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname);
    if (path === "/seed.html") {
      const html = `<!doctype html><meta charset="utf-8"><script>
        localStorage.setItem("viktorychapp-timeline-v1", ${JSON.stringify(JSON.stringify(snapshot))});
        localStorage.setItem("viktorychapp-settings-v1", ${JSON.stringify(JSON.stringify(settings))});
        location.replace("/#/");
      </script>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (path === "/feeds.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(catalog));
      return;
    }
    if (path === "/feeds.config.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(config));
      return;
    }
    let body = null;
    let type = "text/html; charset=utf-8";
    if (path === "/" || path === "/index.html") body = Buffer.from(index);
    else {
      const file = join(root, path.replace(/^\/+/, ""));
      if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { "cache-control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
      createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function cdpMessage(raw) {
  const data = raw && typeof raw === "object" && "data" in raw ? raw.data : raw;
  const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
  return JSON.parse(text);
}

async function main() {
  const bin = await chromeBin();
  const live = await startServer();
  const port = live.address().port;
  const profile = mkdtempSync(join(tmpdir(), "home-fresh-"));
  const debugPort = 9600 + Math.floor(Math.random() * 200);
  const child = spawn(bin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=800,600",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + profile,
    "about:blank"
  ], { stdio: "ignore" });
  let browser = null;
  try {
    let version = null;
    const started = Date.now();
    while (Date.now() - started < 20000) {
      try {
        const res = await fetch("http://127.0.0.1:" + debugPort + "/json/version");
        if (res.ok) { version = await res.json(); break; }
      } catch (err) { /* chrome is still starting */ }
      await new Promise((done) => setTimeout(done, 200));
    }
    if (!version) throw new Error("chrome");
    browser = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      browser.addEventListener("open", resolve);
      browser.addEventListener("error", () => reject(new Error("browser")));
    });
    const created = await new Promise((resolve, reject) => {
      const onMessage = (raw) => {
        let message;
        try { message = cdpMessage(raw); } catch (err) { return; }
        if (message.id !== 1) return;
        browser.removeEventListener("message", onMessage);
        if (!message.result || !message.result.targetId) reject(new Error("target"));
        else resolve(message.result.targetId);
      };
      browser.addEventListener("message", onMessage);
      browser.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: "http://127.0.0.1:" + port + "/seed.html" } }));
    });
    const sessionId = await new Promise((resolve, reject) => {
      const onMessage = (raw) => {
        let message;
        try { message = cdpMessage(raw); } catch (err) { return; }
        if (message.id !== 2) return;
        browser.removeEventListener("message", onMessage);
        if (!message.result || !message.result.sessionId) reject(new Error("session"));
        else resolve(message.result.sessionId);
      };
      browser.addEventListener("message", onMessage);
      browser.send(JSON.stringify({ id: 2, method: "Target.attachToTarget", params: { targetId: created, flatten: true } }));
    });
    let nextId = 10;
    async function evaluate(expression) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("eval")), 12000);
        const onMessage = (raw) => {
          let message;
          try { message = cdpMessage(raw); } catch (err) { return; }
          if (message.id !== id) return;
          clearTimeout(timer);
          browser.removeEventListener("message", onMessage);
          if (message.result && message.result.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails).slice(0, 500)));
          else resolve(message.result && message.result.result && message.result.result.value);
        };
        browser.addEventListener("message", onMessage);
        browser.send(JSON.stringify({ id, sessionId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      });
    }
    const probe = `({
      top: (document.querySelector("article[data-post]") || {}).dataset && document.querySelector("article[data-post]").dataset.post || "",
      pill: !!(document.getElementById("new-posts") && !document.getElementById("new-posts").hidden),
      bar: !!document.querySelector(".home-fresh"),
      boot: window.__homeFreshBoot ? window.__homeFreshBoot.started : 0,
      marks: (performance.getEntriesByType("mark") || []).filter(function (row) {
        return row.name === "home-refresh-start" || row.name === "home-snapshot-paint" || row.name === "home-newest-paint";
      }).map(function (row) { return { name: row.name, t: Math.round(row.startTime) }; }),
      hits: (window.__feedHits || []).map(function (row) { return { id: row.id, t: Math.round(row.t), tab: row.tab }; })
    })`;
    let sample = null;
    const waitFrom = Date.now();
    while (Date.now() - waitFrom < 15000) {
      try { sample = await evaluate(probe); } catch (err) { sample = null; }
      if (sample && sample.top === "new-a" && !sample.pill) break;
      await new Promise((done) => setTimeout(done, 150));
    }
    if (!sample || sample.top !== "new-a" || sample.pill) throw new Error("first paint " + JSON.stringify(sample));
    const mark = (name) => (sample.marks || []).find((row) => row.name === name);
    const refresh = mark("home-refresh-start");
    const painted = mark("home-snapshot-paint");
    const newest = mark("home-newest-paint");
    assert.ok(refresh && painted && newest, "marks " + JSON.stringify(sample.marks));
    assert.ok(refresh.t <= painted.t, "fetch starts with the snapshot");
    assert.ok(painted.t <= newest.t, "snapshot paints before the newest row");
    assert.ok(newest.t < 2500, "newest row at " + newest.t);
    const scrolled = await evaluate(`(function () {
      window.scrollTo(0, 800);
      return new Promise(function (resolve) {
        var timer = setInterval(function () {
          var top = (document.querySelector("article[data-post]") || {}).getAttribute("data-post") || "";
          var pill = document.getElementById("new-posts");
          var shown = !!(pill && !pill.hidden);
          if (shown || performance.now() > 20000) {
            clearInterval(timer);
            resolve({ top: top, pill: shown, y: window.scrollY });
          }
        }, 200);
      });
    })()`);
    assert.equal(scrolled.top, "new-a");
    assert.equal(scrolled.pill, true);
    assert.ok(scrolled.y >= 40);
    const before = (sample.hits || []).length;
    const switched = await evaluate(`(function () {
      var btn = document.querySelector("[data-act='htab'][data-tab='following']");
      if (!btn) return { ok: false };
      btn.click();
      var hits = (window.__feedHits || []).slice(${before}).map(function (row) { return { id: row.id, tab: row.tab }; });
      var on = document.querySelector(".tab.on");
      return { ok: true, hits: hits, on: on ? (on.getAttribute("data-tab") || "") : "" };
    })()`);
    assert.equal(switched.ok, true);
    assert.equal(switched.on, "following");
    assert.ok((switched.hits || []).some((row) => row.id === "src-a" || row.id === "src-b"), "tab fetch " + JSON.stringify(switched.hits));
    assert.ok((switched.hits || []).every((row) => row.tab !== "Following"), "fetch starts before the tab paints");
    console.log(JSON.stringify({
      refreshMs: refresh.t,
      snapshotMs: painted.t,
      newestMs: newest.t,
      gapMs: newest.t - painted.t,
      hits: (sample.hits || []).map((row) => row.id + "@" + row.t)
    }));
  } finally {
    if (browser) browser.close();
    child.kill("SIGKILL");
    live.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err && err.message || err));
  process.exit(1);
});
