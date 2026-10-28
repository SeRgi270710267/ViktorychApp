/* @mention suggestions in the composer, phone (touch) and desktop (keys).
   Placeholders only. */
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

async function openComposer(page, vp) {
  const selector = vp.name === "phone" ? "button.fab" : "button.post-btn";
  const button = page.locator(selector).first();
  await button.waitFor({ state: "visible", timeout: 20000 });
  await button.click();
  await page.locator(".xc-modal #compose-text").waitFor({ timeout: 15000 });
}

async function run(browser, origin, vp) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" });
  const asked = [];
  await context.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/mentions/suggest") {
      asked.push(url.searchParams.get("q"));
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const all = [
        { kind: "account", handle: "PlacemyWorld", name: "Placemy World", avatar: "", follows: false },
        { kind: "account", handle: "placemy_two", name: "Second Place", avatar: "", follows: true }
      ];
      const accounts = all.filter((a) => a.handle.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accounts }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await context.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({
      token: "local-test-token",
      account: { publicId: "100000000001", handle: "user_a", displayName: "User A", avatar: "" }
    }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
  });
  const page = await context.newPage();
  try {
    await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
    await openComposer(page, vp);
    const box = page.locator(".xc-modal #compose-text");
    await box.click();
    await page.keyboard.type("hi @zzqxv", { delay: 15 });
    /* No row matches "zzqxv"; the list stays closed. */
    await page.waitForTimeout(400);
    if (await page.locator(".mention-pop:not([hidden]) .mention-row").count()) fail(vp.name + ": rows for a prefix nobody has");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("PLACEMY", { delay: 15 });
    const rows = page.locator(".mention-pop:not([hidden]) .mention-row");
    await rows.first().waitFor({ timeout: 5000 });
    const handles = await page.locator(".mention-pop .mention-handle").allTextContents();
    if (handles.join(",") !== "@PlacemyWorld,@placemy_two") fail(vp.name + ": rows " + handles.join(","));
    const names = await page.locator(".mention-pop .mention-name").allTextContents();
    if (names[0].indexOf("Placemy World") < 0) fail(vp.name + ": name missing");
    if (asked.indexOf("placemy") < 0) fail(vp.name + ": debounced lookup not lowercased " + asked.join(","));
    if (asked.length > 3) fail(vp.name + ": not debounced " + asked.length);
    const pop = await page.locator(".mention-pop").boundingBox();
    const area = await box.boundingBox();
    if (!pop || pop.y < area.y) fail(vp.name + ": list is not under the caret");
    if (vp.name === "phone") {
      await rows.nth(1).tap();
    } else {
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
    }
    const value = await box.inputValue();
    const want = "hi @placemy_two ";
    if (value !== want) fail(vp.name + ": inserted " + JSON.stringify(value));
    if (await page.locator(".mention-pop:not([hidden]) .mention-row").count()) fail(vp.name + ": list stayed open");
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    if (focused !== "compose-text") fail(vp.name + ": composer lost focus");
    /* Tab picks the highlighted row too. */
    await page.keyboard.type("@placemyw", { delay: 15 });
    await rows.first().waitFor({ timeout: 5000 });
    await page.keyboard.press("Tab");
    if (await box.inputValue() !== want + "@PlacemyWorld ") fail(vp.name + ": tab insert " + JSON.stringify(await box.inputValue()));
  } finally {
    await context.close();
  }
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) await run(browser, origin, vp);
    console.log("mention suggestions ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
