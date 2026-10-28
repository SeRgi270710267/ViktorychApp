/* Go live uses a fake camera. The page may post JSON metadata only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const posts = [];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/v1/live") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        posts.push(raw);
        const body = JSON.stringify({
          status: 201,
          live: { id: "ab".repeat(16), title: "Desk", audience: "public", sources: "camera" },
          ticket: "lt1.fake",
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });
        res.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(body);
      });
      return;
    }
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const href = spec.startsWith("/") ? pathToFileURL(spec).href : spec;
  const mod = await import(href);
  return mod.chromium || (mod.default && mod.default.chromium);
}

async function openSheet(page) {
  await page.waitForSelector("button.m-ava", { timeout: 20000 });
  await page.click("button.m-ava");
  await page.waitForSelector(".drawer [data-act='go-live']", { timeout: 20000 });
  await page.evaluate(() => {
    const api = window.ViktorychAccounts || {};
    api.token = () => "tok";
    api.currentApi = () => location.origin;
    api.call = (path, opts) => fetch(location.origin + path, {
      method: (opts && opts.method) || "GET",
      headers: { "content-type": "application/json" },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined
    }).then((res) => res.json().then((body) => Object.assign(body || {}, { status: res.status })).catch(() => ({ status: res.status })));
    window.ViktorychAccounts = api;
  });
  await page.click(".drawer [data-act='go-live']");
  await page.waitForSelector(".live-sheet");
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.grantPermissions(["camera", "microphone"]);
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("viktorychapp-lang-user-picked", "1");
      localStorage.setItem("superintelapp-lang", "en");
      localStorage.setItem("viktorychapp-install-dismissed", "1");
    });
    await page.goto("http://127.0.0.1:" + port + "/index.html#/", { waitUntil: "domcontentloaded" });
    await openSheet(page);
    const desktop = await page.evaluate(() => ({
      screen: !!document.querySelector("[data-source='screen']"),
      both: !!document.querySelector("[data-source='both']"),
      tab: !!document.querySelector("[data-source='tab']"),
      camera: !!document.querySelector("[data-source='camera']")
    }));
    if (!desktop.camera || !desktop.screen || !desktop.both || !desktop.tab) fail("desktop hid a supported source");
    await page.click("[data-source='camera']");
    await page.click("[data-act='live-start']");
    await page.waitForSelector(".live-videos video", { timeout: 15000 });
    const sized = await page.waitForFunction(() => {
      const video = document.querySelector(".live-videos video");
      return video && video.videoWidth > 0;
    }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!sized) fail("fake camera did not reach the preview");
    if (!posts.length) fail("start did not post session metadata");
    const raw = posts[0];
    if (raw.length > 2000) fail("session post is too large to be metadata");
    const body = JSON.parse(raw.toString("utf8"));
    if (body.sources !== "camera") fail("camera source was not recorded");
    if (JSON.stringify(body).includes("webm") || raw.includes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) fail("media bytes were posted");
    await context.close();

    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
    });
    const ios = await phone.newPage();
    await ios.addInitScript(() => {
      localStorage.setItem("viktorychapp-lang-user-picked", "1");
      localStorage.setItem("superintelapp-lang", "en");
      localStorage.setItem("viktorychapp-install-dismissed", "1");
    });
    await ios.goto("http://127.0.0.1:" + port + "/index.html#/", { waitUntil: "domcontentloaded" });
    await openSheet(ios);
    const hidden = await ios.evaluate(() => ({
      screen: !!document.querySelector("[data-source='screen']"),
      both: !!document.querySelector("[data-source='both']"),
      tab: !!document.querySelector("[data-source='tab']"),
      camera: !!document.querySelector("[data-source='camera']")
    }));
    if (hidden.screen || hidden.both || hidden.tab) fail("iPhone showed screen capture");
    if (!hidden.camera) fail("iPhone hid the camera");
    await phone.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (!process.exitCode) console.log("live page ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
