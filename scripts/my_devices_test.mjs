/* My devices: the list shows every session, rename and remove reach the
   server, and the first hello names this device. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 390, height: 844, name: "phone" }
];
const ME = "100000000001";
const THEM = "200000000002";
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



async function run(browser, origin, vp) {
  const phoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const context = await browser.newContext(Object.assign({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" }, vp.name === "phone" ? { userAgent: phoneUa } : {}));
  let devices = [
    { id: "aaaaaaaaaaaaaaaa", name: "Mac · Chrome", type: "desktop", lastSeen: Date.now(), current: true },
    { id: "bbbbbbbbbbbbbbbb", name: "iPhone · Safari", type: "phone", lastSeen: Date.now() - 3 * 3600 * 1000, current: false }
  ];
  const sent = [];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    const reply = (body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch (err) { body = {}; }
    if (where === "/v1/devices/hello") { sent.push("hello:" + body.type); return reply({ ok: true }); }
    if (where === "/v1/devices" && req.method() === "GET") return reply({ devices });
    if (where === "/v1/devices/rename") { sent.push("rename:" + body.id + ":" + body.name); devices = devices.map((d) => d.id === body.id ? Object.assign({}, d, { name: body.name }) : d); return reply({ devices }); }
    if (where === "/v1/devices/remove") { sent.push("remove:" + body.id); devices = devices.filter((d) => d.id !== body.id); return reply({ devices, signedOut: false }); }
    return reply({ posts: [], ok: true });
  });
  const page = await context.newPage();
  await page.addInitScript(([me]) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: me, handle: "user_a", displayName: "User A", avatar: "" } }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
  }, [ME]);
  page.on("dialog", (dialog) => dialog.type() === "prompt" ? dialog.accept("Work phone") : dialog.accept());
  const tag = vp.name;
  await page.goto(origin + "/#/settings", { waitUntil: "domcontentloaded" });
  await page.locator('a[href="#/settings/devices"]').first().waitFor({ timeout: 20000 }).catch(() => fail(tag + ": settings lists My devices"));
  await page.evaluate(() => { location.hash = "#/settings/devices"; });
  await page.locator(".device-row").nth(1).waitFor({ timeout: 15000 }).catch(() => fail(tag + ": both devices show up"));
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll(".device-row")).map((r) => r.textContent));
  if (!/This device/.test(rows[0]) || !/Mac · Chrome/.test(rows[0])) fail(tag + ": this device is marked " + JSON.stringify(rows));
  if (!/iPhone · Safari/.test(rows[1]) || !/Last seen/.test(rows[1])) fail(tag + ": the other device shows last seen " + JSON.stringify(rows));
  await page.evaluate(() => document.querySelector('[data-act="device-rename"][data-id="bbbbbbbbbbbbbbbb"]').click());
  await page.waitForFunction(() => /Work phone/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => fail(tag + ": rename shows the new name"));
  await page.evaluate(() => document.querySelector('[data-act="device-remove"][data-id="bbbbbbbbbbbbbbbb"]').click());
  await page.waitForFunction(() => document.querySelectorAll(".device-row").length === 1, null, { timeout: 10000 }).catch(() => fail(tag + ": remove drops the device"));
  if (sent.indexOf("rename:bbbbbbbbbbbbbbbb:Work phone") < 0 || sent.indexOf("remove:bbbbbbbbbbbbbbbb") < 0) fail(tag + ": rename and remove reach the server " + JSON.stringify(sent));
  await page.waitForTimeout(6500);
  const hello = sent.filter((s) => s.indexOf("hello:") === 0);
  if (hello.length !== 1) fail(tag + ": this device says hello once " + JSON.stringify(sent));
  if (hello[0] !== (vp.name === "phone" ? "hello:phone" : "hello:desktop")) fail(tag + ": the hello names the device type " + hello[0]);
  await context.close();
  console.log("my devices ok " + tag);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
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
