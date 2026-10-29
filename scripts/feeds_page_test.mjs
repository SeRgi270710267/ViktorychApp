/* Feeds page: an X-style list with platform chips, a switch and a "..." menu.
   Adding a source shows a row at once and its posts reach Home without a deploy. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 320, height: 640, name: "phone" }
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




function account(id, name, extra) {
  return Object.assign({
    id, platform: "telegram", handle: name, name: name, label: "", avatar: "", url: "", channelId: "", groupId: "",
    order: 0, pinned: false, muted: false, paused: false, tabs: [], addedAt: new Date().toISOString(), posts: [],
    health: { status: "ok", code: "", text: "", lastOk: new Date().toISOString(), updatedAt: new Date().toISOString(), nextAt: 0 }
  }, extra || {});
}

async function noOverflow(page, tag, what) {
  const bad = await page.evaluate(() => {
    const org = document.querySelector(".feeds-org");
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push("page " + document.documentElement.scrollWidth + ">" + innerWidth);
    if (org && org.scrollWidth > org.clientWidth + 1) out.push("list " + org.scrollWidth + ">" + org.clientWidth);
    if (org) {
      const box = org.getBoundingClientRect();
      org.querySelectorAll(".feeds-row, .feeds-menu, .feeds-add, .feeds-tools, .feeds-empty, .feeds-banner").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > box.right + 1) out.push(el.className + " " + Math.round(r.right) + ">" + Math.round(box.right));
      });
    }
    return out;
  });
  if (bad.length) fail(tag + ": no overflow " + what + " " + JSON.stringify(bad));
}

async function run(browser, origin, vp) {
  const phoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const context = await browser.newContext(Object.assign({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" }, vp.name === "phone" ? { userAgent: phoneUa } : {}));
  const tag = vp.name;
  let accounts = [
    account("telegram:member_test", "member_test"),
    account("telegram:device_user", "device_user", { health: { status: "failing", code: "not_found", text: "Account not found.", lastOk: "", updatedAt: new Date().toISOString(), nextAt: 0 } })
  ];
  let listFails = true;
  const sent = [];
  let release = null;
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    const reply = (body, status) => route.fulfill({ status: status || 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch (err) { body = {}; }
    if (where === "/v1/owner/feeds" && req.method() === "GET") {
      if (listFails) { listFails = false; return reply({ error: "down" }, 503); }
      return reply({ accounts, groups: [], places: [] });
    }
    if (where === "/v1/owner/feeds" && req.method() === "POST") {
      sent.push("add:" + body.input + ":" + body.confirm);
      if (/sync_user/.test(body.input)) {
        await new Promise((resolve) => { release = resolve; });
        const row = account("telegram:sync_user", "sync_user", { name: "Sync User", posts: [{ id: "9001", text: "Fresh post from the new source", date: new Date().toISOString(), url: "https://t.me/sync_user/9001" }] });
        accounts = [row].concat(accounts);
        return reply({ account: row, dispatched: true });
      }
      return reply({ error: "not_found", message: "Account not found." }, 404);
    }
    if (where.indexOf("/v1/owner/feeds/") === 0 && req.method() === "PATCH") {
      sent.push("patch:" + decodeURIComponent(where.slice(16)) + ":" + JSON.stringify(body));
      const id = decodeURIComponent(where.slice(16));
      accounts = accounts.map((row) => row.id === id ? Object.assign({}, row, body) : row);
      return reply({ account: accounts.find((row) => row.id === id) });
    }
    return reply({ posts: [], ok: true });
  });
  const page = await context.newPage();
  await page.addInitScript(([me]) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: me, handle: "owner_test", displayName: "Owner Test", avatar: "", owner: true } }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
  }, [ME]);
  await page.goto(origin + "/#/feeds", { waitUntil: "domcontentloaded" });
  await page.locator(".feeds-banner.is-error").waitFor({ timeout: 20000 }).catch(() => fail(tag + ": a failed load shows the error banner"));
  await noOverflow(page, tag, "error state");
  await page.evaluate(() => document.querySelector('[data-feed-act="reload"]').click());
  await page.locator('.feeds-row[data-id="telegram:member_test"]').waitFor({ timeout: 10000 }).catch(() => fail(tag + ": retry loads the list"));
  const shape = await page.evaluate(() => {
    const row = document.querySelector('.feeds-row[data-id="telegram:member_test"]');
    const bad = document.querySelector('.feeds-row[data-id="telegram:device_user"]');
    return {
      plat: !!row.querySelector(".feeds-face .feeds-plat"),
      ok: (row.querySelector(".feeds-status") || {}).className || "",
      switchOn: (row.querySelector(".feeds-switch") || {}).getAttribute && row.querySelector(".feeds-switch").getAttribute("aria-checked"),
      more: !!row.querySelector(".feeds-more"),
      bad: (bad.querySelector(".feeds-status") || {}).textContent || "",
      chips: Array.from(document.querySelectorAll(".feeds-chip")).map((b) => b.textContent),
      oldButtons: document.querySelectorAll(".feeds-row-actions").length
    };
  });
  if (!shape.plat || !/is-ok/.test(shape.ok) || shape.switchOn !== "true" || !shape.more) fail(tag + ": row has icon, status, switch and menu " + JSON.stringify(shape));
  if (!/Account not found/.test(shape.bad)) fail(tag + ": a failing source says why " + JSON.stringify(shape));
  if (shape.chips[0] !== "All" || shape.chips.indexOf("Telegram") < 0) fail(tag + ": platform chips " + JSON.stringify(shape.chips));
  if (shape.oldButtons) fail(tag + ": the button wall is gone");
  await noOverflow(page, tag, "list");

  await page.evaluate(() => document.querySelector('.feeds-row[data-id="telegram:member_test"] .feeds-more').click());
  await page.locator('.feeds-row[data-id="telegram:member_test"] .feeds-menu').waitFor({ timeout: 5000 }).catch(() => fail(tag + ": the menu opens"));
  const items = await page.evaluate(() => Array.from(document.querySelectorAll(".feeds-menu-items button")).map((b) => b.textContent));
  for (const want of ["Refresh", "Pin", "Mute", "Remove"]) if (items.indexOf(want) < 0) fail(tag + ": the menu has " + want + " " + JSON.stringify(items));
  await noOverflow(page, tag, "menu open");
  await page.evaluate(() => document.querySelector('.feeds-row[data-id="telegram:member_test"] .feeds-switch').click());
  await page.waitForFunction(() => {
    const sw = document.querySelector('.feeds-row[data-id="telegram:member_test"] .feeds-switch');
    return sw && sw.getAttribute("aria-checked") === "false";
  }, null, { timeout: 5000 }).catch(() => fail(tag + ": the switch turns the source off"));
  if (!sent.some((s) => s === 'patch:telegram:member_test:{"paused":true}')) fail(tag + ": the switch saves paused " + JSON.stringify(sent));

  await page.fill("#feeds-q", "zzzz-nothing");
  await page.locator(".feeds-empty").waitFor({ timeout: 5000 }).catch(() => fail(tag + ": a search with no hits shows the empty state"));
  if (!/No matches/.test(await page.textContent(".feeds-empty"))) fail(tag + ": the empty state says no matches");
  await noOverflow(page, tag, "empty state");
  await page.evaluate(() => document.querySelector('[data-feed-act="clear-filters"]').click());
  await page.locator('.feeds-row[data-id="telegram:member_test"]').waitFor({ timeout: 5000 }).catch(() => fail(tag + ": clear filters brings the list back"));

  await page.fill("#add-account", "https://t.me/sync_user");
  await page.waitForFunction(() => /Detected: Telegram/.test((document.getElementById("feeds-add-hint") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => fail(tag + ": the platform is detected while typing"));
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector("form.add-account button[type=submit]").click());
  await page.locator('.feeds-row.is-pending[aria-busy="true"]').waitFor({ timeout: 2000 }).catch(() => fail(tag + ": the new source shows at once with a progress state"));
  if (Date.now() - t0 > 2000) fail(tag + ": the pending row took too long");
  if (sent.filter((s) => s.indexOf("add:") === 0).length !== 1 || sent.indexOf("add:https://t.me/sync_user:true") < 0) fail(tag + ": one add request, no separate preview " + JSON.stringify(sent));
  await noOverflow(page, tag, "pending row");
  release();
  await page.locator('.feeds-row[data-id="telegram:sync_user"]').waitFor({ timeout: 5000 }).catch(() => fail(tag + ": the saved row replaces the pending one"));
  if (await page.locator(".feeds-row.is-pending").count()) fail(tag + ": the pending row is gone");
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("article.post")).some((a) => /Fresh post from the new source/.test(a.textContent)), null, { timeout: 8000 }).catch(() => fail(tag + ": the new source's posts are on Home without a deploy"));

  await page.evaluate(() => { location.hash = "#/feeds"; });
  await page.locator("#add-account").waitFor({ timeout: 5000 });
  await page.fill("#add-account", "https://t.me/member_test_gone");
  await page.evaluate(() => document.querySelector("form.add-account button[type=submit]").click());
  await page.locator(".feeds-row.is-pending.is-error").waitFor({ timeout: 5000 }).catch(() => fail(tag + ": a failed add keeps an error row"));
  if (!/Account not found/.test(await page.textContent(".feeds-row.is-pending.is-error"))) fail(tag + ": the error row says why");
  if (!(await page.locator('.feeds-row.is-error [data-feed-act="pending-retry"]').count())) fail(tag + ": the error row offers retry");
  await noOverflow(page, tag, "error row");
  await page.evaluate(() => document.querySelector('[data-feed-act="pending-dismiss"]').click());
  await page.waitForFunction(() => !document.querySelector(".feeds-row.is-pending"), null, { timeout: 5000 }).catch(() => fail(tag + ": dismiss drops the error row"));

  const reload = await context.newPage();
  await reload.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  // A reload resumes the last screen (localfirst.js). The first page may have
  // saved #/feeds before it closed, so open Home explicitly.
  await reload.waitForFunction(() => document.getElementById("app") && document.getElementById("app").childElementCount > 0, null, { timeout: 15000 }).catch(() => {});
  await reload.evaluate(() => { if (location.hash !== "#/") location.hash = "#/"; });
  await reload.waitForFunction(() => { if (location.hash !== "#/") location.hash = "#/"; return Array.from(document.querySelectorAll("article.post")).some((a) => /Fresh post from the new source/.test(a.textContent)); }, null, { timeout: 15000 }).catch(() => fail(tag + ": after a reload Home still has the new posts from the local catalog"));
  await context.close();
  console.log("feeds page ok " + tag);
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
