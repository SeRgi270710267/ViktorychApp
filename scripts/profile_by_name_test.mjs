/* Another viewer opening a site account's profile sees that account's own
   posts, replies and media. Placeholders only. */
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

const now = Date.now();
// Another viewer opens a site account's profile. The server never sends that
// account's public id, so the profile must ask for its posts by username.
const THEIRS = { id: "e".repeat(32), body: "Their own post", createdAt: now - 60000, authorId: "100000000007", authorName: "Sample Writer", authorHandle: "Sample_Writer", media: [] };
const REPLY = { id: "c".repeat(32), body: "Their reply", parentId: "b".repeat(32), createdAt: now - 30000, authorId: "100000000007", authorName: "Sample Writer", authorHandle: "Sample_Writer", media: [] };
const PIC = { id: "a".repeat(32), body: "Their photo", createdAt: now - 90000, authorId: "100000000007", authorName: "Sample Writer", authorHandle: "Sample_Writer", media: [{ id: "m1", mime: "image/png", url: "/v1/posts/media/m1" }] };

async function run(browser, vp, origin) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(vp.name + " page error: " + (err && err.message)));
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({
      token: "local-test-token",
      account: { publicId: "100000000001", handle: "sample_viewer", displayName: "Sample Viewer", avatar: "" }
    }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
  });
  const asked = [];
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/posts/media/m1") {
      await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      return;
    }
    if (url.pathname === "/v1/posts") {
      if (url.searchParams.get("handle")) asked.push(url.searchParams.get("handle"));
      const list = url.searchParams.get("handle") && url.searchParams.get("handle").toLowerCase() === "sample_writer" ? [REPLY, THEIRS, PIC] : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: list, author: "", communitiesHome: true }) });
      return;
    }
    if (url.pathname.toLowerCase() === "/v1/profile/sample_writer") {
      // No publicId: the server strips it for every viewer but the account itself.
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: { handle: "Sample_Writer", displayName: "Sample Writer", avatar: "" }, reposts: [], identities: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' });
  });
  const has = (id) => page.waitForFunction((pid) => !!document.querySelector('article.post[data-post="' + pid + '"]'), id, { timeout: 15000 });
  await page.goto(origin + "/#/app/Sample_Writer", { waitUntil: "domcontentloaded" });
  await has(THEIRS.id).catch(() => fail(vp.name + " the profile Posts tab misses the account's own post"));
  if (await page.locator('article.post[data-post="' + REPLY.id + '"]').count()) fail(vp.name + " a reply is on the Posts tab");
  if (!asked.length) fail(vp.name + " the profile never asked for the posts by username");
  await page.goto(origin + "/#/@Sample_Writer?tab=replies", { waitUntil: "domcontentloaded" });
  await has(REPLY.id).catch(() => fail(vp.name + " the profile Replies tab misses the account's reply"));
  await page.goto(origin + "/#/@Sample_Writer?tab=media", { waitUntil: "domcontentloaded" });
  await has(PIC.id).catch(() => fail(vp.name + " the profile Media tab misses the account's photo"));
  await context.close();
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) await run(browser, vp, origin);
    console.log("profile by name ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
