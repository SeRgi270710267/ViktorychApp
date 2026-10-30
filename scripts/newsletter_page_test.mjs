/* Newsletters: paste a link, follow the sender, read issues as posts and open a full,
   sanitized issue without the page locking while it loads. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 360, height: 700, name: "phone" }
];
const ME = "100000000001";
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




const KEY = "example-substack-com-0123456789";
const FEED = "https://example.substack.com/feed";
function doc() {
  return {
    key: KEY, feed: FEED, at: Date.now(),
    profile: { name: "Example Letter", bio: "A test newsletter.", site: "https://example.substack.com/", host: "example.substack.com", avatar: "https://example.substack.com/icon.png" },
    items: [
      { id: "aaaa1111bbbb2222", title: "Issue one: hello", link: "https://example.substack.com/p/one", date: new Date(Date.now() - 3600e3).toISOString(), author: "A. Writer", excerpt: "The first issue of the letter.", image: "https://example.substack.com/one.jpg", long: true },
      { id: "cccc3333dddd4444", title: "Issue two", link: "https://example.substack.com/p/two", date: new Date(Date.now() - 7200e3).toISOString(), author: "", excerpt: "Second.", image: "", long: false }
    ]
  };
}

async function run(browser, origin, vp) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" });
  const tag = vp.name;
  const hits = [];
  let follows = [];
  let slowIssue = null;
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => /\.(png|jpg)$/.test(route.request().url()) ? route.fulfill({ status: 200, contentType: "image/png", body: PNG }) : route.fulfill({ status: 200, body: "" }));
  await context.route(/\/accounts\.config\.js/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", headers: { "cache-control": "no-store" }, body: "window.VIKTORYCH_ACCOUNTS = { api: location.origin, backupApi: \"\", gate: true, tiktokAudience: \"owner\" };" }));
  await context.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body, status) => route.fulfill({ status: status || 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
    if (url.pathname === "/v1/newsletter") {
      hits.push("list:" + (url.searchParams.get("url") || "key=" + url.searchParams.get("key")));
      if (/nothing-here/.test(url.searchParams.get("url") || "")) return reply({ error: "no_feed" }, 404);
      return reply(doc());
    }
    if (url.pathname === "/v1/newsletter/issue") {
      hits.push("issue:" + url.searchParams.get("id"));
      await new Promise((resolve) => { slowIssue = resolve; });
      return reply({ id: url.searchParams.get("id"), title: "Issue one: hello", html: '<h2>Big news</h2><p>Body text <a href="https://example.com/x">link</a></p><img src="https://example.com/pic.jpg" onerror="window.__bad=1"><script>window.__bad=2</script><a href="javascript:window.__bad=3">bad</a><table><tr><td>cell</td></tr></table>' });
    }
    hits.push(route.request().method() + ":" + url.pathname);
    if (url.pathname === "/v1/follows") {
      const method = route.request().method();
      let sent = {};
      try { sent = JSON.parse(route.request().postData() || "{}"); } catch (err) { sent = {}; }
      if (method === "PUT" && sent.id && follows.indexOf(sent.id) < 0) follows.push(sent.id);
      if (method === "DELETE") follows = follows.filter((id) => id !== sent.id);
      return reply({ ok: true, ids: follows.slice() });
    }
    return reply({ posts: [], ok: true });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: "100000000002", handle: "member_test", displayName: "Member Test", avatar: "", owner: false } }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true };
  });
  await page.goto(origin + "/#/feeds", { waitUntil: "domcontentloaded" });
  await page.locator("#nl-add-input").waitFor({ timeout: 20000 }).catch(() => fail(tag + ": the feeds page has a newsletter box"));
  await page.fill("#nl-add-input", "https://nothing-here.example.com");
  await page.evaluate(() => document.querySelector("form.nl-add button[type=submit]").click());
  await page.waitForFunction(() => /Couldn’t find a feed/.test(document.body.textContent), null, { timeout: 5000 }).catch(() => fail(tag + ": a link with no feed says so"));
  await page.fill("#nl-add-input", "example.substack.com");
  await page.evaluate(() => document.querySelector("form.nl-add button[type=submit]").click());
  await page.waitForFunction((key) => location.hash === "#/u/news/" + key, KEY, { timeout: 8000 }).catch(() => fail(tag + ": following opens the newsletter's profile " + JSON.stringify(hits)));
  await page.waitForFunction(() => Array.from(document.querySelectorAll("article.post")).some((a) => /Issue one: hello/.test(a.textContent)), null, { timeout: 8000 }).catch(() => fail(tag + ": the profile lists issues as posts"));
  const profile = await page.evaluate(() => ({ text: document.body.textContent, follow: !!document.querySelector("[data-follow], .follow") }));
  if (!/Example Letter/.test(profile.text)) fail(tag + ": the sender's name shows");
  const saved = await page.evaluate(() => { const k = Object.keys(localStorage).find((n) => /settings-v1$/.test(n)); return JSON.parse((k && localStorage.getItem(k)) || "{}"); });
  if ((saved.follows || []).indexOf("news:" + KEY) < 0) fail(tag + ": the follow is saved " + JSON.stringify(saved.follows) + JSON.stringify(hits));
  if (!saved.newsletters || !saved.newsletters[KEY] || saved.newsletters[KEY].feed !== FEED) fail(tag + ": the feed link is kept on this device");
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) fail(tag + ": no sideways scroll on the profile");

  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("article.post")).some((a) => /Issue one: hello/.test(a.textContent)), null, { timeout: 10000 }).catch(() => fail(tag + ": issues reach Home"));

  await page.evaluate((key) => { location.hash = "#/news/" + key + "/status/nlaaaa1111bbbb2222"; }, KEY);
  await page.locator(".nl-loading").waitFor({ timeout: 5000 }).catch(() => fail(tag + ": the issue shows a loading line at once"));
  const busy = await page.evaluate(() => { const b = document.querySelector("[data-act=back]"); return !!b; });
  if (!busy) fail(tag + ": the page is usable while the issue loads");
  for (let i = 0; i < 50 && !slowIssue; i++) await new Promise((r) => setTimeout(r, 100));
  if (!slowIssue) fail(tag + ": the issue is fetched");
  slowIssue();
  await page.locator(".nl-body h2").waitFor({ timeout: 5000 }).catch(() => fail(tag + ": the full issue renders"));
  const body = await page.evaluate(() => {
    const el = document.querySelector(".nl-body");
    return { html: el.innerHTML, bad: window.__bad || 0, img: (el.querySelector("img") || {}).getAttribute ? el.querySelector("img").getAttribute("referrerpolicy") : "", open: !!document.querySelector(".nl-open"), wide: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  if (/onerror|<script|javascript:/i.test(body.html) || body.bad) fail(tag + ": the issue is sanitized " + body.html);
  if (body.img !== "no-referrer") fail(tag + ": images are hotlinked without a referrer " + body.html);
  if (!body.open) fail(tag + ": the original issue link shows");
  if (body.wide) fail(tag + ": no sideways scroll on the issue");

  await page.close();
  const fresh = await context.newPage();
  const errs = [];
  fresh.on("pageerror", (err) => errs.push(err.message));
  await fresh.goto(origin + "/#/news/" + KEY + "/status/nlcccc3333dddd4444", { waitUntil: "domcontentloaded" });
  const direct = await fresh.waitForFunction(() => /Issue two/.test((document.querySelector(".nl-title") || {}).textContent || ""), null, { timeout: 15000 }).then(() => true, () => false);
  if (!direct) fail(tag + ": a direct link to an issue loads its newsletter " + await fresh.evaluate(() => location.hash + " " + document.body.innerText.slice(0, 600)) + JSON.stringify(errs) + JSON.stringify(hits.filter((h) => /^list|^issue/.test(h))));
  await context.close();
  console.log("newsletter page ok " + tag);
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
