/* Mobile drawer: the name row matches the profile header (inline protected
   lock, badges), and Customize rows never overlap or grow at 320 and 375px,
   in Spanish and Russian, which have the longest labels. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core");
const chromium = pw.chromium || pw.default.chromium;
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" };

function fail(msg) { throw new Error("drawer layout: " + msg); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port + "/index.html#/home";
const browser = await chromium.launch({ headless: true, channel: "chrome" });

function overlaps(a, b) {
  return a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

async function check(lang, width) {
  const label = lang + "@" + width;
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 740 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript((code) => {
    localStorage.setItem("superintelapp-lang", code);
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "token-a", account: { publicId: "100000000001", handle: "drawer_test", displayName: "Drawer Test", owner: true, privateFollows: true } }));
  }, lang);
  await ctx.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message || err)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-act='drawer']", { timeout: 30000 });
  await page.locator("[data-act='drawer']").first().click();
  await page.waitForSelector(".drawer-x .drawer-name", { timeout: 10000 });
  const head = await page.evaluate(() => {
    const row = document.querySelector(".drawer-x .drawer-name");
    const lock = row.querySelector(".protected-badge svg");
    const name = row.querySelector(".name-row-text");
    const r = lock ? lock.getBoundingClientRect() : null;
    const n = name.getBoundingClientRect();
    return {
      lock: r ? { w: r.width, h: r.height, after: r.left >= n.right - 1, mid: Math.abs((r.top + r.bottom) / 2 - (n.top + n.bottom) / 2) } : null,
      badge: !!row.querySelector(".vbadge"),
      order: Array.from(row.children).map((el) => el.className.split(" ")[0])
    };
  });
  if (!head.lock) fail(label + " no protected lock in the drawer");
  if (head.lock.w > 18.5 || head.lock.h > 18.5) fail(label + " lock is " + head.lock.w + "x" + head.lock.h);
  if (!head.lock.after || head.lock.mid > 4) fail(label + " lock is not inline after the name " + JSON.stringify(head.lock));
  if (!head.badge) fail(label + " verified badge missing in the drawer");
  if (head.order[0] !== "name-row-text" || head.order[1] !== "protected-badge") fail(label + " name row order " + head.order.join(","));

  await page.evaluate(() => {
    const btn = document.querySelector("[data-act='drawer-edit']");
    if (btn) btn.click();
  });
  await page.waitForSelector(".drawer-edit-row", { timeout: 10000 });
  await page.waitForTimeout(300);
  const bad = await page.evaluate(() => {
    const out = [];
    const box = (el) => el.getBoundingClientRect();
    document.querySelectorAll(".drawer-edit-row").forEach((row) => {
      const key = row.getAttribute("data-drawer-key");
      const rb = box(row);
      const parts = [".drawer-grip", ".drawer-ico", ".drawer-label", ".drawer-eye", ".drawer-place", ".drawer-move"]
        .map((sel) => [sel, row.querySelector(sel)]).filter((p) => p[1]);
      for (let i = 0; i < parts.length; i++) {
        const a = box(parts[i][1]);
        if (a.right > rb.right + 1 || a.left < rb.left - 1) out.push(key + " " + parts[i][0] + " leaves the row");
        for (let j = i + 1; j < parts.length; j++) {
          const b = box(parts[j][1]);
          if (a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(key + " " + parts[i][0] + " overlaps " + parts[j][0]);
        }
      }
      row.querySelectorAll(".drawer-seg, .drawer-move").forEach((el) => {
        const b = box(el);
        if (b.height > 30) out.push(key + " control is " + Math.round(b.height) + "px tall");
      });
      const labelEl = row.querySelector(".drawer-label");
      if (labelEl && box(labelEl).height > 24) out.push(key + " label wraps");
      if (rb.height > 84) out.push(key + " row is " + Math.round(rb.height) + "px tall");
    });
    if (!document.querySelector(".drawer-place .drawer-seg.on")) out.push("no location pill");
    return out;
  });
  if (bad.length) fail(label + " " + bad.slice(0, 6).join("; "));
  if (errors.length) fail(label + " page errors " + errors.slice(0, 2).join(" | "));
  await ctx.close();
  console.log("ok " + label);
}

try {
  for (const lang of ["es", "ru", "en"]) {
    for (const width of [320, 375]) await check(lang, width);
  }
  console.log("drawer layout check passed");
} finally {
  await browser.close();
  server.close();
}
