/* The owner's own new post shows at once on Home (For you and Following) and on
   their profile, survives stale server lists and a refresh, and the sent toast
   links to it. Placeholders only. */
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

const ME = "100000000001";
const NEW_ID = "f".repeat(32);
const now = Date.now();
const OTHER = { id: "d".repeat(32), body: "Someone else", createdAt: now - 180000, authorId: "100000000004", authorName: "User D", authorHandle: "user_d", media: [] };

async function ids(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("article.post")).map((el) => el.getAttribute("data-post") + "|" + el.textContent));
}

async function exercise(page, vp, origin, persisted) {
  let created = null;
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const where = url.pathname;
    if (where === "/v1/posts" && req.method() === "POST") {
      let body = {};
      try { body = req.postDataJSON(); } catch (err) { body = {}; }
      await new Promise((resolve) => setTimeout(resolve, 900));
      created = { id: NEW_ID, body: body.body || "", createdAt: Date.now(), media: [], authorName: "User A", authorHandle: "user_a", authorId: ME };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post: created }) });
      return;
    }
    if (where === "/v1/posts") {
      // The server list is stale: it never includes the new post unless a refresh says so.
      const mine = persisted && created ? [created] : [];
      const list = url.searchParams.get("by") ? mine : mine.concat([OTHER]);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: list, communitiesHome: true }) });
      return;
    }
    if (where === "/v1/profile/user_a") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: { publicId: ME, handle: "user_a", displayName: "User A", avatar: "" }, reposts: [], identities: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' });
  });
  return () => created;
}

async function compose(page, vp, text) {
  const selector = vp.name === "phone" ? "button.fab" : "button.post-btn";
  const button = page.locator(selector).first();
  await button.waitFor({ state: "visible", timeout: 20000 });
  await button.click();
  await page.locator(".xc-modal #compose-text").waitFor({ timeout: 15000 });
  await page.locator(".xc-modal #compose-text").fill(text);
  await page.locator(".xc-modal #compose-post").click();
}

async function run(browser, vp, origin) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({
      token: "local-test-token",
      account: { publicId: "100000000001", handle: "user_a", displayName: "User A", avatar: "" }
    }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
  });
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await exercise(page, vp, origin, false);
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("article.post").length >= 1, null, { timeout: 20000 });
  await compose(page, vp, "Fresh own post");
  // Optimistic: the card is on top before the server answers.
  await page.waitForFunction(() => {
    const first = document.querySelector("article.post");
    return first && first.textContent.indexOf("Fresh own post") >= 0;
  }, null, { timeout: 800 }).catch(() => fail(vp.name + " the new post was not inserted before the server answered"));
  await page.locator("#toast a.toast-link").waitFor({ timeout: 15000 }).catch(() => fail(vp.name + " the sent toast has no View link"));
  const href = await page.locator("#toast a.toast-link").getAttribute("href");
  if (href.indexOf(NEW_ID) < 0) fail(vp.name + " View link does not point at the new post: " + href);
  let list = await ids(page);
  if (list[0].indexOf(NEW_ID + "|") !== 0) fail(vp.name + " For you does not lead with the new post: " + list.join(" / "));
  if (list.some((row) => row.indexOf("tmp-") === 0)) fail(vp.name + " the optimistic copy was not replaced");

  // A stale list from the server after the 20 s throttle must not drop it.
  await page.waitForTimeout(21000);
  await page.goto(origin + "/#/home/following", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  list = await ids(page);
  if (!list.length || list[0].indexOf(NEW_ID + "|") !== 0) fail(vp.name + " Following lost the new post after a stale list: " + list.join(" / "));
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  list = await ids(page);
  if (!list.length || list[0].indexOf(NEW_ID + "|") !== 0) fail(vp.name + " For you lost the new post after a stale list: " + list.join(" / "));

  await page.goto(origin + "/#/@user_a", { waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => !!document.querySelector('article.post[data-post="' + id + '"]'), NEW_ID, { timeout: 15000 })
    .catch(() => fail(vp.name + " the profile does not show the new post"));

  await page.goto(origin + href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.textContent.indexOf("Fresh own post") >= 0, null, { timeout: 15000 })
    .catch(() => fail(vp.name + " the View link does not open the post"));

  // After a refresh the server is the source of truth.
  await page.unroute("**/v1/**");
  const created = { id: NEW_ID, body: "Fresh own post", createdAt: Date.now() - 5000, media: [], authorName: "User A", authorHandle: "user_a", authorId: ME };
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/posts") {
      const list = url.searchParams.get("by") ? [created] : [created, OTHER];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: list, communitiesHome: true }) });
      return;
    }
    if (url.pathname === "/v1/profile/user_a") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ account: { publicId: ME, handle: "user_a", displayName: "User A", avatar: "" }, reposts: [], identities: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' });
  });
  await page.goto(origin + "/#/@user_a", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => !!document.querySelector('article.post[data-post="' + id + '"]'), NEW_ID, { timeout: 15000 })
    .catch(() => fail(vp.name + " the profile lost the post after a refresh"));
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => { const first = document.querySelector("article.post"); return first && first.getAttribute("data-post") === id; }, NEW_ID, { timeout: 15000 })
    .catch(() => fail(vp.name + " Home lost the post after a refresh"));
  await page.close();
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) await run(browser, vp, origin);
    console.log("own post ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
