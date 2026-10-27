/* Mobile tab-row scroll. A refresh, a badge update, and a height-only resize
   must leave the home tab row where the user scrolled it. */
import { spawn } from "node:child_process";

const playwright = await import(process.env.PLAYWRIGHT_MJS || "playwright");
const chromium = playwright.chromium;

const PORT = Number(process.env.TAB_SCROLL_PORT || 8766);
const ROOT = "http://127.0.0.1:" + PORT;
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const tabs = [];
for (let i = 0; i < 14; i++) {
  tabs.push({
    id: "tab" + i,
    name: "Channel " + i + " extra",
    showHome: true,
    showNotes: true,
    members: [],
    sort: "recent"
  });
}

async function main() {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: "/workspace",
    stdio: "ignore"
  });
  await sleep(400);
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    await run(browser);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log("tab scroll checks passed");
}

async function run(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent: PHONE,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.addInitScript((seed) => {
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({
      version: 1,
      initialized: true,
      follows: [],
      lists: [],
      likes: {},
      bookmarks: {},
      reposts: {},
      appearance: "lightsout",
      feedTabs: seed,
      bellNotes: [],
      bellSeen: [],
      bellRead: 0
    }));
  }, tabs);
  await page.goto(ROOT + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-hscroll='home-tabs']", { timeout: 15000 });
  await page.waitForFunction(() => {
    const row = document.querySelector("[data-hscroll='home-tabs']");
    return !!(row && row.scrollWidth > row.clientWidth + 40);
  }, null, { timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});

  const target = await page.evaluate(() => {
    const row = document.querySelector("[data-hscroll='home-tabs']");
    row.dataset.mark = "live";
    const max = row.scrollWidth - row.clientWidth;
    const next = Math.max(80, Math.round(max * 0.45));
    row.scrollLeft = next;
    row.dispatchEvent(new Event("scroll"));
    if (window.ViktorychHScroll) window.ViktorychHScroll.remember();
    return row.scrollLeft;
  });
  assert(target > 40, "the home tab row can scroll (" + target + ")");

  async function read() {
    return page.evaluate(() => {
      const row = document.querySelector("[data-hscroll='home-tabs']");
      return {
        left: row ? row.scrollLeft : -1,
        mark: row ? row.dataset.mark || "" : "",
        live: row ? row.dataset.hscrollLive || "" : "",
        hash: location.hash || "",
        pull: (document.getElementById("pull") && document.getElementById("pull").className) || ""
      };
    });
  }

  function closeEnough(info, step) {
    assert(info.mark === "live", step + " rebuilt the tab row");
    assert(Math.abs(info.left - target) <= 2, step + " moved scrollLeft to " + info.left + " from " + target);
  }

  const refreshed = await page.evaluate(async () => {
    const before = window.ViktorychHScroll.generation ? window.ViktorychHScroll.generation() : 0;
    const after = await window.ViktorychHScroll.refresh();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before: before, after: after };
  });
  assert(refreshed.after > refreshed.before, "feed refresh did not re-render");
  const afterRefresh = await read();
  closeEnough(afterRefresh, "feed refresh");
  assert(afterRefresh.live === "1", "feed refresh did not patch the tab row in place");

  await page.evaluate(async () => {
    window.ViktorychHScroll.badge();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const afterBadge = await read();
  closeEnough(afterBadge, "badge update");
  const badgeCount = await page.evaluate(() => document.querySelectorAll(".nav-badge").length);
  assert(badgeCount > 0, "badge update paints a notification count");

  await page.setViewportSize({ width: 390, height: 620 });
  await page.evaluate(() => window.ViktorychHScroll.resizeHeight());
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  closeEnough(await read(), "height-only resize");

  const swipe = await page.evaluate(() => {
    const row = document.querySelector("[data-hscroll='home-tabs']");
    const box = row.getBoundingClientRect();
    const fire = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target: row, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
      const init = {
        bubbles: true,
        cancelable: true,
        touches: type === "touchend" ? [] : [touch],
        targetTouches: type === "touchend" ? [] : [touch],
        changedTouches: [touch]
      };
      row.dispatchEvent(new TouchEvent(type, init));
    };
    fire("touchstart", box.left + 30, box.top + 20);
    fire("touchmove", box.left + 180, box.top + 96);
    fire("touchend", box.left + 180, box.top + 96);
    const pull = document.getElementById("pull");
    return {
      pull: pull ? pull.className : "",
      hash: location.hash || ""
    };
  });
  assert(swipe.pull.indexOf("ready") < 0 && swipe.pull.indexOf("on") < 0, "a horizontal tab swipe armed pull-to-refresh (" + swipe.pull + ")");
  assert(!/following/.test(swipe.hash), "a horizontal tab swipe switched feeds (" + swipe.hash + ")");
  closeEnough(await read(), "horizontal swipe");

  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForSelector(".settings-flow, .set-list, .set-block", { timeout: 10000 });
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForSelector("[data-hscroll='home-tabs']", { timeout: 10000 });
  await page.waitForFunction((expected) => {
    const row = document.querySelector("[data-hscroll='home-tabs']");
    return !!(row && Math.abs(row.scrollLeft - expected) <= 2);
  }, target, { timeout: 8000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-hscroll='home-tabs']", { timeout: 15000 });
  await page.waitForFunction((expected) => {
    const row = document.querySelector("[data-hscroll='home-tabs']");
    return !!(row && row.scrollWidth > row.clientWidth + 40 && Math.abs(row.scrollLeft - expected) <= 2);
  }, target, { timeout: 8000 });

  assert(!errors.length, "page errors: " + errors.join(" | "));
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
