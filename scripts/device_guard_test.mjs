/* Local data protection: drafts and messages are sealed with the device's
   server-held key in the background and come back, a cold start reopens
   them with a fresh key, Security shows the switch, removing this device
   erases its data, and a device the server no longer knows wipes itself. */
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




const KEY = "q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq80";

async function newSession(browser, vp, state) {
  const phoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const context = await browser.newContext(Object.assign({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" }, vp.name === "phone" ? { userAgent: phoneUa } : {}));
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
    state.sent.push(req.method() + " " + where);
    if (where === "/v1/devices/key") return state.revoked ? reply(401, { error: "unauthorized" }) : reply(200, { key: KEY, id: "aaaaaaaaaaaaaaaa" });
    if (where === "/v1/devices" && req.method() === "GET") return reply(200, { devices: [{ id: "aaaaaaaaaaaaaaaa", name: "This one", type: vp.name === "phone" ? "phone" : "desktop", lastSeen: Date.now(), current: true }] });
    if (where === "/v1/devices/remove") { state.removed = true; return reply(200, { devices: [], signedOut: true }); }
    return reply(200, { posts: [], ok: true });
  });
  await context.addInitScript(([me]) => {
    window.__guardTest = true;
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    if (document.cookie.indexOf("seeded=1") < 0) {
      document.cookie = "seeded=1; path=/";
      localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: me, handle: "user_a", displayName: "User A", avatar: "" } }));
      localStorage.setItem("viktorychapp-guard-draft", "secret draft words");
      localStorage.setItem("viktorychapp-guard-message", "secret message words");
    }
  }, [ME]);
  return context;
}

async function ready(page, tag) {
  await page.waitForFunction(() => window.ViktorychAppLock && window.ViktorychAppLock.guard && window.ViktorychAppLock.guard.ready(), null, { timeout: 15000 }).catch(() => fail(tag + ": the device key arrives"));
}

async function run(browser, origin, vp) {
  const tag = vp.name;
  const state = { sent: [], revoked: false, removed: false };
  let context = await newSession(browser, vp, state);
  let page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await ready(page, tag);
  await page.evaluate(() => window.ViktorychAppLock.guard.hide());
  await page.waitForFunction(() => localStorage.getItem("viktorychapp-lock-dsealed") === "1" && !localStorage.getItem("viktorychapp-guard-draft"), null, { timeout: 8000 }).catch(() => fail(tag + ": the background seals the draft"));
  const atRest = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("viktorych-lock");
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction("kv", "readonly").objectStore("kv").get("guard-vault");
      get.onsuccess = () => { resolve(JSON.stringify(get.result || null)); db.close(); };
      get.onerror = () => resolve("");
    };
    req.onerror = () => resolve("");
  }));
  if (!atRest || atRest === "null" || /secret/.test(atRest)) fail(tag + ": the sealed copy is ciphertext " + atRest.slice(0, 80));
  if (!(await page.evaluate(() => !!localStorage.getItem("viktorychapp-account-v1")))) fail(tag + ": the session stays so the device can ask for its key");
  await page.evaluate(() => window.ViktorychAppLock.guard.show());
  await page.waitForFunction(() => localStorage.getItem("viktorychapp-guard-draft") === "secret draft words" && localStorage.getItem("viktorychapp-lock-dsealed") !== "1", null, { timeout: 8000 }).catch(() => fail(tag + ": coming back restores the draft"));

  await page.evaluate(() => window.ViktorychAppLock.guard.hide());
  await page.waitForFunction(() => localStorage.getItem("viktorychapp-lock-dsealed") === "1", null, { timeout: 8000 });
  await page.close();
  page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => localStorage.getItem("viktorychapp-guard-message") === "secret message words" && localStorage.getItem("viktorychapp-lock-dsealed") !== "1", null, { timeout: 15000 }).catch(() => fail(tag + ": a cold start opens the sealed copy with the server key"));
  await ready(page, tag);

  await page.evaluate(() => { location.hash = "#/settings/security"; });
  await page.locator('[data-sec="guard-toggle"]').waitFor({ timeout: 15000 }).catch(() => fail(tag + ": Security shows the encryption switch"));
  if ((await page.getAttribute('[data-sec="guard-toggle"]', "aria-checked")) !== "true") fail(tag + ": encryption is on by default");

  await page.evaluate(() => { location.hash = "#/settings/devices"; });
  await page.locator('[data-act="device-wipe-self"]').waitFor({ timeout: 15000 }).catch(() => fail(tag + ": My devices offers remove and erase"));
  await page.locator(".device-row").first().waitFor({ timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-act="device-wipe-self"]').click());
  await page.waitForFunction(() => !localStorage.getItem("viktorychapp-account-v1") && !localStorage.getItem("viktorychapp-guard-draft") && !localStorage.getItem("viktorychapp-guard-message"), null, { timeout: 15000 }).catch(() => fail(tag + ": remove and erase signs out and erases the data"));
  if (!state.removed) fail(tag + ": the device is removed on the server " + JSON.stringify(state.sent));
  let lang = "";
  for (let i = 0; i < 20 && !lang; i++) {
    lang = await page.evaluate(() => localStorage.getItem("superintelapp-lang") || "-").catch(() => "");
    if (!lang) await page.waitForTimeout(250);
  }
  if (lang !== "en") fail(tag + ": the language survives sign-out");
  await context.close();

  const gone = { sent: [], revoked: true, removed: false };
  context = await newSession(browser, vp, gone);
  page = await context.newPage();
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !localStorage.getItem("viktorychapp-account-v1") && !localStorage.getItem("viktorychapp-guard-draft"), null, { timeout: 15000 }).catch(() => fail(tag + ": a removed device wipes itself"));
  await context.close();
  console.log("device guard ok " + tag);
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
