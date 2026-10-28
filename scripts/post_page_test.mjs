/* The single post page matches X: header menu, one meta line, five even actions,
   thin reply sort tabs, one-row reply box. Placeholders only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 390, height: 844, name: "phone" }
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


async function run(browser, origin, vp, lang) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' }));
  const page = await context.newPage();
  await page.addInitScript((code) => {
    localStorage.setItem("superintelapp-lang", code);
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
  }, lang);
  const tag = lang + "@" + vp.name;
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  const pick = () => {
    const links = Array.from(document.querySelectorAll('article.post[data-open^="#/@"]'));
    const hit = links.find((a) => /\/status\//.test(a.getAttribute("data-open")));
    return hit ? hit.getAttribute("data-open") : "";
  };
  await page.waitForFunction(pick, null, { timeout: 30000 }).catch(() => {});
  const href = await page.evaluate(pick);
  if (!href) fail(tag + ": no X post in the snapshot to open " + JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll("article.post a[href*=status], article.post [data-open]")).slice(0, 4).map((a) => a.getAttribute("href") || a.getAttribute("data-open")))));
  await page.goto(origin + "/" + href, { waitUntil: "domcontentloaded" });
  await page.locator("article.status").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const st = document.querySelector("article.status");
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
    const author = st.querySelector(".status-author");
    const actions = st.querySelector(".status-actions .action-stats");
    const kids = actions ? Array.from(actions.children).filter((el) => el.offsetParent !== null) : [];
    const meta = st.querySelector(".status-meta");
    const tabs = st.nextElementSibling && st.nextElementSibling.classList.contains("reply-tabs-thin") ? st.nextElementSibling : null;
    const reply = tabs ? tabs.nextElementSibling : null;
    const replyBtn = reply ? Array.from(reply.querySelectorAll("button")).filter((b) => b.disabled).pop() : null;
    return {
      followPill: !!(author && author.querySelector("button.follow")),
      more: !!(author && author.querySelector(".status-more")),
      nameTop: author && author.querySelector(".name") ? box(author.querySelector(".name")) : null,
      handleTop: author && author.querySelector(".handle") ? box(author.querySelector(".handle")) : null,
      metaText: meta ? meta.textContent.replace(/\s+/g, " ").trim() : "",
      metaH: meta ? box(meta).h : 0,
      metaBold: !!(meta && meta.querySelector("b")),
      count: kids.length,
      kinds: kids.map((el) => (el.matches(".repost-wrap") ? el.querySelector(".action") : el).className),
      kidBoxes: kids.map(box),
      row: actions ? box(actions) : null,
      views: !!st.querySelector(".status-actions .action.views"),
      tabs: !!tabs,
      tabsH: tabs ? box(tabs).h : 0,
      tabLabels: tabs ? tabs.querySelectorAll(".tab").length : 0,
      relevantMenu: !!document.querySelector("select.reply-sort, .reply-sort-menu"),
      replyH: reply ? box(reply).h : 0,
      replyBtn: replyBtn ? replyBtn.textContent.trim() : "",
      replyGift: !!(reply && reply.querySelector("[data-gift]")),
      toolsBar: !!document.querySelector(".reply-tools"),
      viewport: innerWidth
    };
  });
  if (info.followPill) fail(tag + ": the big follow pill is still in the post header");
  if (!info.more) fail(tag + ": the post header needs a \u2026 menu");
  if (!info.nameTop || !info.handleTop || info.handleTop.y < info.nameTop.b - 2) fail(tag + ": the @handle sits under the name");
  if (!info.metaText || info.metaH > 44) fail(tag + ": time, date and views share one meta line (" + info.metaH + "px)");
  if (info.views) fail(tag + ": no analytics icon in the action row");
  if (info.count !== 5) fail(tag + ": five actions (reply, repost, like, bookmark, share), got " + info.count + " " + JSON.stringify(info.kinds));
  const order = ["reply", "repost", "like", "bookmark", "share"];
  info.kinds.forEach((cls, i) => { if (cls.split(/\s+/).indexOf(order[i]) < 0) fail(tag + ": action " + i + " should be " + order[i] + ", got " + cls); });
  const b = info.kidBoxes;
  for (let i = 1; i < b.length; i++) if (b[i].x < b[i - 1].r) fail(tag + ": actions overlap");
  if (b[0].x - info.row.x > 8 || info.row.r - b[4].r > 8) fail(tag + ": actions spread across the full row");
  const gaps = b.slice(1).map((item, i) => (item.x + item.w / 2) - (b[i].x + b[i].w / 2));
  if (Math.max.apply(null, gaps) - Math.min.apply(null, gaps) > info.row.w * 0.15) fail(tag + ": actions are evenly spaced " + JSON.stringify(gaps.map(Math.round)));
  if (!info.tabs || info.tabLabels !== 3 || info.tabsH > 44) fail(tag + ": the thin reply sort tabs sit right under the post (" + info.tabsH + "px)");
  if (info.relevantMenu) fail(tag + ": no Relevant dropdown");
  if (info.toolsBar) fail(tag + ": the fresh/summarize bar moved into the \u2026 menu");
  if (!info.replyH || info.replyH > 64) fail(tag + ": the reply box is one row (" + info.replyH + "px)");
  if (!info.replyBtn) fail(tag + ": the Reply pill starts disabled");
  if (info.replyGift) fail(tag + ": the gift button moved to the \u2026 menu");
  await page.locator("article.status .status-more").first().click();
  const menu = await page.evaluate(() => {
    const m = document.querySelector(".status-menu");
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { gift: !!m.querySelector("[data-gift]"), sum: !!m.querySelector('[data-act="odai-thread"]'), follow: !!m.querySelector('[data-act="follow"]'), inView: r.left >= 0 && r.right <= innerWidth + 1 };
  });
  if (!menu || !menu.gift || !menu.sum || !menu.follow || !menu.inView) fail(tag + ": the \u2026 menu holds follow, gift and summarize " + JSON.stringify(menu));
  await page.locator("article.status ~ * [data-act=\"xc-expand-reply\"], article.status ~ .composer").first().click();
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => {
    const field = document.getElementById("reply-draft");
    return field ? document.activeElement === field : document.querySelector(".composer") !== null;
  });
  if (!open) fail(tag + ": tapping the reply row opens the reply box");
  await context.close();
  console.log("post page ok " + tag);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) for (const lang of ["en", "es", "ru"]) await run(browser, origin, vp, lang);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message);
});
