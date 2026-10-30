import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/* Settings > Data and storage > Maximum cache size, in the real app while
   the "Cache limit reached" alert has opened the page and outlined the
   slider row. The slider must move by phone touch drag, mouse drag and
   arrow keys, the size must be saved and survive a reload even though the
   device preset caps the automatic default at 1 GB, a drag from the
   lowest step must not count as an edge swipe Back, and the owner's
   site-health pill must not cover the alert banner.
   SHOTS=/dir also saves phone screenshots. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";
const GB = 1024 * 1024 * 1024;

function fail(message) { console.error("FAIL: " + message); process.exitCode = 1; throw new Error(message); }

function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  return mod.chromium || (mod.default && mod.default.chromium);
}

async function open(browser, phone, owner) {
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block", locale: "es-ES" }
    : { viewport: { width: 1280, height: 860 }, serviceWorkers: "block", locale: "es-ES" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.route((url) => !String(url).startsWith(origin), (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(origin + "/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/owner/health") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ at: Date.now(), problems: [{ code: "relay", level: "down", text: "Relay down" }] }) });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.addInitScript((isOwner) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-lang", "es");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true, lang: "es" }));
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    if (isOwner) {
      localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: "100000000001", handle: "user_a", displayName: "User A", avatar: "", owner: true } }));
      window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true };
    }
    /* 1.3 GB used on a phone with plenty of room: the device preset caps
       the automatic cache limit at 1 GB, so the limit alert is critical. */
    if (!localStorage.getItem("viktorychapp-storage")) localStorage.setItem("viktorychapp-storage", JSON.stringify({ keep: "week", maxBytes: 1024 * 1024 * 1024, unlimited: false, prefetch: true }));
    const used = 1.3 * 1024 * 1024 * 1024;
    navigator.storage.estimate = async () => ({ usage: used, quota: 60 * 1024 * 1024 * 1024 });
  }, !!owner);
  return { context, page, errors };
}

/* Open Storage the way the alert does: banner on top, slider row outlined. */
async function alertOpen(page, label) {
  await page.goto(origin + "/index.html#/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.ViktorychSettingAlerts && window.ViktorychStorage && window.ViktorychDevice, null, { timeout: 20000 }).catch(() => fail(label + ": app scripts never loaded"));
  await page.waitForTimeout(600);
  /* The alert pops up and its Raise limit button opens Storage. */
  await page.evaluate(() => window.ViktorychSettingAlerts.preview("limit"));
  const act = '[data-pop-id="sa-cache-limit"] [data-pop-act="action"]';
  await page.waitForSelector(act, { timeout: 8000 }).catch(() => fail(label + ": the cache limit alert never popped up"));
  await page.evaluate((sel) => document.querySelector(sel).click(), act);
  await page.waitForSelector("#stor-max", { timeout: 20000 }).catch(() => fail(label + ": no cache size slider"));
  await page.waitForSelector("[data-sa-banner]", { timeout: 8000 }).catch(() => fail(label + ": the alert banner never showed"));
  await page.waitForSelector(".sa-pulse", { timeout: 8000 }).catch(() => fail(label + ": the slider row is not outlined"));
  /* Let other pop-outs (sign-in tips and the like) finish so they are not
     what the hit test finds. */
  await page.waitForFunction(() => !document.querySelector(".ach-card"), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const el = document.getElementById("stor-max");
    const row = document.getElementById("stor-max-row");
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const hitName = hit ? (hit.id || hit.className || hit.tagName) : "none";
    return { hitName, value: Number(el.value), max: Number(el.max), disabled: el.disabled, label: document.getElementById("stor-max-label").textContent, rowPulse: !!(row && row.classList.contains("sa-pulse")), hitIsSlider: hit === el, h: box.height };
  });
  if (state.disabled) fail(label + ": slider is disabled");
  if (!state.rowPulse) fail(label + ": the outline is not on the slider row");
  if (!state.hitIsSlider) fail(label + ": something sits on top of the slider: " + state.hitName);
  if (state.label !== "1 GB" || state.max < 6) fail(label + ": unexpected start " + JSON.stringify(state));
  return state;
}

async function after(page, label, start) {
  await page.waitForTimeout(400);
  const now = await page.evaluate(() => {
    const el = document.getElementById("stor-max");
    const saved = JSON.parse(localStorage.getItem("viktorychapp-storage") || "{}");
    return { hash: location.hash, value: el ? Number(el.value) : -1, label: el ? document.getElementById("stor-max-label").textContent : "", fill: el ? el.style.getPropertyValue("--x-fill") : "", saved };
  });
  if (!(now.saved.maxBytes > GB || now.saved.unlimited) || now.saved.picked !== true) fail(label + ": the larger size was not saved " + JSON.stringify(now.saved));
  if (now.hash.indexOf("#/settings/storage") !== 0) fail(label + ": left the page while using the slider (" + now.hash + ")");
  if (now.value <= start.value) fail(label + ": slider did not move " + JSON.stringify(now));
  if (!now.fill || now.fill === "0%") fail(label + ": the blue fill did not follow the thumb");
  /* Re-render, the device cap pass and a reload must keep the choice. */
  await page.evaluate(() => { window.ViktorychStorage.applyDeviceCap(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => { if (location.hash !== "#/settings/storage") location.hash = "#/settings/storage"; });
  await page.waitForSelector("#stor-max", { timeout: 20000 });
  await page.waitForFunction(() => !!window.ViktorychDevice, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const kept = await page.evaluate(() => ({ label: document.getElementById("stor-max-label").textContent, saved: JSON.parse(localStorage.getItem("viktorychapp-storage") || "{}") }));
  if (kept.saved.maxBytes !== now.saved.maxBytes || kept.label !== now.label) fail(label + ": the size did not survive a reload " + JSON.stringify({ now, kept }));
  /* The limit is now above 1.3 GB, so the alert is no longer critical. */
  const level = await page.evaluate(async () => {
    await window.ViktorychSettingAlerts.check();
    const s = window.ViktorychSettingAlerts.state();
    return s && s.fired ? s.fired["cache-limit"] || "" : "";
  });
  if (level === "critical" || level === "limit") fail(label + ": the cache alert is still " + level);
  return now;
}

const chromium = await loadPlaywright();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  /* 1. Phone: touch drag from the lowest step to the right. */
  {
    const { context, page, errors } = await open(browser, true, !!SHOTS);
    const start = await alertOpen(page, "phone");
    if (start.h < 40) fail("phone: touch target is only " + start.h + "px tall");
    if (SHOTS) {
      await page.waitForSelector("#owner-health-banner", { timeout: 20000 }).catch(() => {});
      const overlap = await page.evaluate(() => {
        const pill = document.getElementById("owner-health-banner");
        const banner = document.querySelector("[data-sa-banner]");
        if (!pill || !banner) return false;
        const a = pill.getBoundingClientRect(); const b = banner.getBoundingClientRect();
        return a.top < b.bottom && b.top < a.bottom;
      });
      if (overlap) fail("phone: the site-health pill covers the alert banner");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, "after-phone-alert.png") });
      await page.evaluate(() => document.getElementById("stor-max").scrollIntoView({ block: "center" }));
    }
    const box = await page.locator("#stor-max").boundingBox();
    const y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    const x0 = box.x + 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + i * (box.width * 0.42) / 12, y }] });
      await page.waitForTimeout(16);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "after-phone-dragging.png") });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const now = await after(page, "phone touch", start);
    if (SHOTS) {
      await page.evaluate(() => document.getElementById("stor-max").scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, "after-phone-raised.png") });
    }
    if (errors.length) fail("phone: page errors " + errors.join(" | "));
    console.log("phone touch drag ok", now.label);
    await context.close();
  }
  /* 2. Desktop: mouse drag. */
  {
    const { context, page, errors } = await open(browser, false, false);
    const start = await alertOpen(page, "desktop");
    const box = await page.locator("#stor-max").boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, y, { steps: 10 });
    await page.mouse.up();
    const now = await after(page, "mouse drag", start);
    if (errors.length) fail("desktop: page errors " + errors.join(" | "));
    console.log("mouse drag ok", now.label);
    await context.close();
  }
  /* 3. Keyboard: Tab to the slider and press the right arrow. */
  {
    const { context, page, errors } = await open(browser, false, false);
    const start = await alertOpen(page, "keyboard");
    await page.focus("#stor-max");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const now = await after(page, "keyboard", start);
    if (now.value !== start.value + 3) fail("keyboard: three presses moved " + (now.value - start.value) + " steps");
    if (errors.length) fail("keyboard: page errors " + errors.join(" | "));
    console.log("keyboard ok", now.label);
    await context.close();
  }
  /* Every slider in the app gets the X look: thin track, blue thumb. */
  {
    const context = await browser.newContext({ viewport: { width: 600, height: 400 } });
    const page = await context.newPage();
    await page.goto(origin + "/offline.html").catch(() => {});
    await page.setContent('<link rel="stylesheet" href="' + origin + '/styles.css"><input id="r" type="range" min="0" max="10" value="5">');
    await page.addScriptTag({ url: origin + "/shared/x-range.js" });
    await page.waitForTimeout(300);
    const look = await page.evaluate(() => {
      const el = document.getElementById("r");
      const cs = getComputedStyle(el);
      return { appearance: cs.appearance || cs.webkitAppearance, fill: el.style.getPropertyValue("--x-fill") };
    });
    if (look.appearance !== "none") fail("range sliders still use the browser look");
    if (look.fill !== "50%") fail("--x-fill not painted: " + look.fill);
    console.log("x slider look ok");
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
