/* Home lists app posts, community posts and community replies as normal post
   cards with a community line, on For you and Following. Placeholders only. */
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
const now = Date.now();
const FEED = [
  { id: "a".repeat(32), body: "My own post", createdAt: now - 60000, authorId: ME, authorName: "User A", authorHandle: "user_a", media: [] },
  { id: "va_00000000000000b1", body: "Member post in a community", createdAt: now - 120000, authorId: "100000000002", authorName: "User B", authorHandle: "user_b", media: [], replyCount: 1, community: { name: "placeholder_group", rootId: "va_00000000000000b1" } },
  { id: "va_00000000000000c1", body: "Member reply in a community", createdAt: now - 90000, parentId: "va_00000000000000b1", authorId: "100000000003", authorName: "User C", authorHandle: "user_c", media: [], community: { name: "placeholder_group", rootId: "va_00000000000000b1" } },
  { id: "d".repeat(32), body: "Someone I do not follow", createdAt: now - 180000, authorId: "100000000004", authorName: "User D", authorHandle: "user_d", media: [] }
];

async function cards(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("article.post")).map((el) => ({
    id: el.getAttribute("data-post"),
    text: el.textContent,
    community: !!el.querySelector(".community-line"),
    byline: !!el.querySelector(".byline"),
    actions: !!el.querySelector(".actions")
  })));
}

async function exercise(page, vp, origin) {
  const sent = [];
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    if (where === "/v1/posts" && req.method() === "POST") {
      let body = {};
      try { body = req.postDataJSON(); } catch (err) { body = {}; }
      sent.push(body);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post: { id: "e".repeat(32), body: body.body || "", createdAt: Date.now(), media: [], authorName: "User A", authorHandle: "user_a", authorId: ME } }) });
      return;
    }
    if (where === "/v1/posts") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: FEED, communitiesHome: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' });
  });
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("article.post .community-line").length >= 1, null, { timeout: 20000 });
  if (await page.locator(".public-post").count()) fail(vp.name + " still renders the old public-post layout");
  let list = await cards(page);
  const pick = (id) => list.find((item) => item.id === id);
  ["a".repeat(32), "va_00000000000000b1", "va_00000000000000c1", "d".repeat(32)].forEach((id) => {
    const item = pick(id);
    if (!item) fail(vp.name + " For you is missing " + id);
    if (!item.byline || !item.actions) fail(vp.name + " " + id + " is not a normal post card");
  });
  if (!pick("va_00000000000000b1").community || pick("va_00000000000000b1").text.indexOf("placeholder_group") < 0) fail(vp.name + " community line is missing");
  if (pick("a".repeat(32)).community) fail(vp.name + " a plain post got a community line");
  const order = list.map((item) => item.id);
  if (order.filter((id) => id === "va_00000000000000b1").length !== 1) fail(vp.name + " the community parent is listed twice: " + order.join(","));
  if (order[0] !== "a".repeat(32) || order.indexOf("va_00000000000000b1") + 1 !== order.indexOf("va_00000000000000c1")) fail(vp.name + " app posts are not in time order: " + order.join(","));
  const threadLines = await page.evaluate(() => Array.from(document.querySelectorAll(".thread")).map((el) => el.querySelectorAll(".community-line").length));
  if (threadLines.indexOf(1) < 0) fail(vp.name + " the community thread should carry one community line: " + threadLines.join(","));

  await page.goto(origin + "/#/home/following", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => document.querySelectorAll("article.post .community-line").length >= 1, null, { timeout: 20000 });
  list = await cards(page);
  if (!pick("a".repeat(32))) fail(vp.name + " Following is missing my own post");
  if (!pick("va_00000000000000b1") || !pick("va_00000000000000c1")) fail(vp.name + " Following is missing community posts");
  if (pick("d".repeat(32))) fail(vp.name + " Following shows an account I do not follow");
  await page.unroute("**/v1/**");
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) {
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
      await exercise(page, vp, origin);
      await page.close();
    }
    console.log("community home ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
