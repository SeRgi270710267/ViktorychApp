/* Notifications must show items, an empty state, a skeleton, or an error
   with Retry. A hung or old API, a phone-sized window, and a stray blur
   must not leave the list black. Placeholders only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const href = spec.startsWith("/") ? pathToFileURL(spec).href : spec;
  const mod = await import(href);
  return mod.chromium || (mod.default && mod.default.chromium);
}

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "desktop", width: 1280, height: 800, mobile: false }
];

function sessionScript(signed) {
  const settings = {
    version: 1,
    initialized: true,
    feedTabs: [{ id: "tab_a", name: "Tab A", showNotes: true, showHome: false, members: ["user_a"] }]
  };
  return `(() => {
    localStorage.setItem("superintelapp-lang", "es");
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-settings-v1", ${JSON.stringify(JSON.stringify(settings))});
    ${signed ? `localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "token-a", account: { handle: "user_a", displayName: "User A" } }));` : `localStorage.removeItem("viktorychapp-account-v1");`}
  })()`;
}

function installRoutes(page, mode) {
  return page.route("**/v1/**", async (route) => {
    const url = route.request().url();
    if (!url.includes("/v1/notifications")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    const current = mode.current;
    if (current === "hang") return;
    if (current === "old") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (current === "fail") {
      await route.fulfill({ status: 500, contentType: "text/plain", body: "nope" });
      return;
    }
    if (current === "items") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{ id: "n1", at: 1, kind: "like", handle: "user_a", name: "User A", text: "hello", hash: "#/" }],
          unread: 1,
          readUntil: 0,
          cursor: 1,
          tabs: []
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], unread: 0, readUntil: 0, cursor: 0, tabs: [] })
    });
  });
}

const INSPECT = `(() => {
  const el = document.querySelector("[data-notes-state]");
  const tabs = document.querySelector(".notes-tabs");
  if (!el) return { missing: true };
  const box = el.getBoundingClientRect();
  const tabsBottom = tabs ? tabs.getBoundingClientRect().bottom : 0;
  const y = Math.min(window.innerHeight - 4, Math.max(box.top + 12, tabsBottom + 16));
  const x = Math.min(window.innerWidth - 4, Math.max(8, box.left + 24));
  const hit = document.elementFromPoint(x, y);
  return {
    kind: el.getAttribute("data-notes-state") || "",
    h: box.height,
    w: box.width,
    top: box.top,
    bottom: box.bottom,
    tabsBottom: tabsBottom,
    underHeader: box.bottom < tabsBottom + 8,
    hitInside: !!(hit && (hit === el || el.contains(hit))),
    hitTag: hit ? hit.tagName + "." + String(hit.className || "").slice(0, 48) : "",
    cover: document.documentElement.getAttribute("data-privacy-cover") || "",
    focus: !!(document.hasFocus && document.hasFocus()),
    catchUp: !!document.querySelector("[data-act='odai-catch']"),
    gear: !!document.querySelector(".notes-top [data-act='manage-tabs']"),
    mark: !!document.querySelector(".notes-top [data-act='note-mark-all']"),
    retry: !!el.querySelector("[data-act='notes-retry']"),
    skel: el.querySelectorAll(".skel").length,
    text: String(el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 180),
    coarse: !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches)
  };
})()`;

async function readState(page) {
  await page.waitForSelector("[data-notes-state]", { timeout: 15000 });
  return page.evaluate(INSPECT);
}

function assertVisible(info, allowed, label) {
  if (!info || info.missing) fail(label + " missing list state");
  if (!allowed.includes(info.kind)) fail(label + " state " + info.kind + " " + info.text);
  if (info.h < 40 || info.w < 40) fail(label + " list has no size");
  if (info.underHeader) fail(label + " list is under the header " + info.top + " " + info.bottom + " " + info.tabsBottom);
  if (!info.hitInside) fail(label + " list is covered " + info.kind + " top=" + Math.round(info.top) + " bottom=" + Math.round(info.bottom) + " tabs=" + Math.round(info.tabsBottom) + " hit=" + info.hitTag + " cover=" + info.cover + " focus=" + info.focus);
  if (info.cover === "dms" || info.cover === "app") fail(label + " privacy cover is on");
  if (info.catchUp) fail(label + " catch-up link is still in the header");
  if (!info.gear || !info.mark) fail(label + " header controls missing");
  if (info.kind === "loading") {
    if (info.skel < 1) fail(label + " skeleton missing");
  } else if (!info.text) fail(label + " list has no text");
}

async function openNotes(browser, port, opts) {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    userAgent: opts.mobile
      ? "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      : undefined
  });
  const page = await context.newPage();
  const mode = { current: opts.api || "empty" };
  await installRoutes(page, mode);
  await page.addInitScript(sessionScript(!!opts.signed));
  const hash = opts.hash || "#/notifications";
  await page.goto("http://127.0.0.1:" + port + "/index.html" + hash, { waitUntil: "domcontentloaded" });
  return { context, page, mode };
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    for (const viewport of VIEWPORTS) {
      const opened = await openNotes(browser, port, { width: viewport.width, height: viewport.height, mobile: viewport.mobile, signed: false, api: "empty" });
      try {
        const info = await readState(opened.page);
        assertVisible(info, ["empty"], viewport.name + " signed out");
        if (!info.text.includes("Nada que ver")) fail(viewport.name + " empty copy");
      } finally {
        await opened.context.close();
      }
    }

    const phone = await openNotes(browser, port, { width: 390, height: 844, mobile: true, signed: false, api: "empty", hash: "#/notifications/tab_a" });
    try {
      const info = await readState(phone.page);
      assertVisible(info, ["empty"], "custom tab");
      const blurred = await phone.page.evaluate(() => {
        try {
          Object.defineProperty(window, "outerWidth", { configurable: true, get: () => 390 });
          Object.defineProperty(window, "outerHeight", { configurable: true, get: () => 80 });
        } catch (err) { /* inner size is what the cover uses */ }
        if (window.ViktorychPrivacy) {
          window.ViktorychPrivacy.mark("blur", true);
          window.ViktorychPrivacy.paint();
        }
        return true;
      });
      if (!blurred) fail("phone blur");
      const after = await readState(phone.page);
      assertVisible(after, ["empty"], "phone blur");
      if (!after.coarse) fail("phone pointer");
    } finally {
      await phone.context.close();
    }

    const hung = await openNotes(browser, port, { width: 390, height: 844, mobile: true, signed: true, api: "hang" });
    try {
      const info = await readState(hung.page);
      assertVisible(info, ["loading"], "hung api");
    } finally {
      await hung.context.close();
    }

    const oldApi = await openNotes(browser, port, { width: 768, height: 1024, mobile: false, signed: true, api: "old" });
    try {
      await oldApi.page.waitForSelector("[data-notes-state='error'] [data-act='notes-retry']", { timeout: 15000 });
      const info = await readState(oldApi.page);
      assertVisible(info, ["error"], "old api");
      if (!info.retry) fail("old api retry");
    } finally {
      await oldApi.context.close();
    }

    const failed = await openNotes(browser, port, { width: 1280, height: 800, mobile: false, signed: true, api: "fail" });
    try {
      await failed.page.waitForSelector("[data-notes-state='error'] [data-act='notes-retry']", { timeout: 15000 });
      assertVisible(await readState(failed.page), ["error"], "failed api");
      failed.mode.current = "items";
      await failed.page.click("[data-act='notes-retry']");
      await failed.page.waitForSelector("[data-notes-state='items']", { timeout: 15000 });
      const info = await readState(failed.page);
      assertVisible(info, ["items"], "retry");
      if (!info.text.includes("hello")) fail("retry items");
    } finally {
      await failed.context.close();
    }
    console.log("notifications page check passed");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
