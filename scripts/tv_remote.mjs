/* Keyboard-only checks that TV mode drives the desktop layout. */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const playwright = await import(process.env.PLAYWRIGHT_MJS || "playwright");
const chromium = playwright.chromium;

const PORT = 8765;
const ROOT = "http://127.0.0.1:" + PORT;
const OUT = "/opt/cursor/artifacts";
const TIZEN = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/5.0 Chrome/85.0.4183.93 TV Safari/537.36";
const WEBOS = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function focusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "", cls: "", label: "", act: "", text: "" };
    const card = el.closest ? el.closest("article") : null;
    return {
      tag: el.tagName,
      cls: String(el.className || ""),
      label: el.getAttribute("aria-label") || "",
      act: el.getAttribute("data-act") || "",
      text: String(el.innerText || "").replace(/\s+/g, " ").slice(0, 60),
      post: card ? (card.getAttribute("data-post") || card.className) : ""
    };
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => document.documentElement.classList.contains("tv-on"), null, { timeout: 15000 });
  await page.waitForSelector("main article.post", { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-tv-ready") === "1", null, { timeout: 15000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function press(page, key, times) {
  const n = times || 1;
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
}

async function dispatchKey(page, keyCode, key) {
  await page.evaluate(({ keyCode: code, key: name }) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { get: () => code });
    Object.defineProperty(event, "which", { get: () => code });
    document.dispatchEvent(event);
  }, { keyCode: keyCode, key: key });
}

async function shot(page, name) {
  await sleep(300);
  await page.screenshot({ path: OUT + "/" + name, fullPage: false });
}

async function openContext(browser, ua, width, height, video) {
  return browser.newContext({
    viewport: { width: width, height: height },
    deviceScaleFactor: 1,
    userAgent: ua,
    hasTouch: false,
    serviceWorkers: "block",
    recordVideo: video ? { dir: OUT, size: { width: width, height: height } } : undefined
  });
}

async function layoutInfo(page) {
  return page.evaluate(() => {
    const side = document.querySelector(".side");
    const label = document.querySelector(".nav-label");
    const root = document.getElementById("app");
    const zoom = parseFloat(getComputedStyle(document.body).zoom || "1");
    const nav = document.querySelector(".nav");
    const nr = nav ? nav.getBoundingClientRect() : { left: 0 };
    const post = document.querySelector("article.post");
    const font = post ? parseFloat(getComputedStyle(post).fontSize) : 0;
    return {
      zoom: zoom,
      side: side ? getComputedStyle(side).display : "missing",
      label: label ? getComputedStyle(label).display : "missing",
      app: root ? getComputedStyle(root).display : "missing",
      navLeft: nr.left,
      font: font,
      pad: parseFloat(getComputedStyle(document.body).paddingTop) || 0,
      custom: !!document.getElementById("tv-root")
    };
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: "/workspace",
    stdio: "ignore"
  });
  await sleep(400);
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined
  });
  const failures = [];
  try {
    await desktopOff(browser);
    await hashAndMouse(browser);
    await tizen(browser);
    await webos(browser);
  } catch (err) {
    failures.push(err);
    console.error(err);
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) process.exit(1);
  console.log("tv remote checks passed");
}

async function desktopOff(browser) {
  const context = await openContext(browser, DESKTOP, 1920, 1080, false);
  const page = await context.newPage();
  await page.goto(ROOT + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main article.post", { timeout: 15000 });
  await sleep(200);
  const on = await page.evaluate(() => document.documentElement.classList.contains("tv-on"));
  assert(!on, "a desktop pointer must not auto-enter TV mode");
  const side = await page.evaluate(() => getComputedStyle(document.querySelector(".side")).display);
  assert(side !== "none", "desktop shows the right column");
  await shot(page, "tv_compare_desktop_1080.png");
  await page.goto(ROOT + "/#/settings", { waitUntil: "domcontentloaded" });
  const toggle = page.locator("[data-tv-toggle]").first();
  await toggle.waitFor({ timeout: 15000 });
  assert((await toggle.innerText()).indexOf("TV mode") >= 0, "Settings has a TV mode control");
  await context.close();
}

async function hashAndMouse(browser) {
  const context = await openContext(browser, DESKTOP, 1440, 900, false);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("hash pageerror", err.message));
  await page.goto(ROOT + "/#/home?tv=1", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const hash = await page.evaluate(() => location.hash);
  assert(hash === "#/home" || hash === "#/", "hash tv flag is stripped, got " + hash);
  const tabs = await page.locator(".tab").allInnerTexts();
  assert(tabs.join(" ").indexOf("For you") >= 0, "home tabs stayed, got " + tabs.join(", "));
  await page.goto(ROOT + "/#/not-a-real-route?tv=1", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const homeText = await page.locator("main").innerText();
  assert(/For you|Following/.test(homeText), "unknown route falls back to Home");
  const cleaned = await page.evaluate(() => location.hash);
  assert(cleaned.indexOf("tv=") < 0, "unknown route still strips tv, got " + cleaned);
  await context.close();

  const mouse = await openContext(browser, DESKTOP, 1440, 900, false);
  const pointer = await mouse.newPage();
  await pointer.goto(ROOT + "/?tv=1#/", { waitUntil: "domcontentloaded" });
  await waitReady(pointer);
  const box = await layoutInfo(pointer);
  assert(box.app !== "none", "TV mode keeps the desktop app");
  assert(!box.custom, "TV mode does not mount a second shell");
  const before = await pointer.evaluate(() => window.scrollY);
  await pointer.mouse.wheel(0, 800);
  await sleep(250);
  await pointer.mouse.wheel(0, 800);
  await sleep(250);
  const after = await pointer.evaluate(() => window.scrollY);
  assert(after > before, "mouse wheel still scrolls the desktop page");
  const like = pointer.locator("article.post .action.like").first();
  await like.click();
  await sleep(300);
  const liked = await pointer.locator("article.post .action.like.on").count();
  assert(liked > 0, "mouse click still likes a post");
  await mouse.close();

  const forced = await openContext(browser, TIZEN, 1280, 720, false);
  const off = await forced.newPage();
  await off.goto(ROOT + "/?tv=0", { waitUntil: "domcontentloaded" });
  await off.waitForTimeout(700);
  const stayed = await off.evaluate(() => document.documentElement.classList.contains("tv-on"));
  assert(!stayed, "?tv=0 keeps a TV user agent out of TV mode");
  await forced.close();
}

async function untilNav(page) {
  for (let i = 0; i < 8; i++) {
    const info = await focusInfo(page);
    if (info.cls.indexOf("nav-item") >= 0 || info.cls.indexOf("post-btn") >= 0 || info.cls.indexOf("account-pill") >= 0) return info;
    await press(page, "ArrowLeft");
  }
  return focusInfo(page);
}

async function tizen(browser) {
  const context = await openContext(browser, TIZEN, 1920, 1080, true);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.stack || err.message));
  await page.goto(ROOT + "/?tv=1#/", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const box = await layoutInfo(page);
  assert(box.zoom >= 1.5, "1080p zoom is " + box.zoom);
  assert(box.side === "none", "the right column hides when it does not fit");
  assert(box.label !== "none", "the desktop nav labels stay");
  assert(box.app !== "none", "the desktop app stays on screen");
  assert(!box.custom, "no custom TV root");
  assert(box.font >= 15 && box.font <= 20, "computed post text stays the desktop size, got " + box.font);
  assert(box.navLeft >= 40, "content is inset from the left edge, got " + box.navLeft);
  let info = await focusInfo(page);
  assert(info.cls.indexOf("tab") >= 0, "home focuses a tab, got " + JSON.stringify(info));
  await shot(page, "tv_desktop_home_1080.png");

  await press(page, "ArrowRight");
  info = await focusInfo(page);
  assert(info.cls.indexOf("tab") >= 0 || info.label.indexOf("options") >= 0, "ArrowRight stays on the tab row, got " + JSON.stringify(info));
  await press(page, "ArrowDown");
  info = await focusInfo(page);
  assert(info.tag === "ARTICLE" || info.cls.indexOf("post") >= 0 || info.cls.indexOf("name") >= 0 || info.cls.indexOf("action") >= 0, "ArrowDown reaches a post, got " + JSON.stringify(info));
  await sleep(500);
  const centered = await page.evaluate(() => {
    const el = document.activeElement;
    const card = el && el.closest ? (el.closest("article") || el) : null;
    if (!card) return 0;
    const r = card.getBoundingClientRect();
    const mid = r.top + Math.min(r.height, window.innerHeight) / 2;
    return Math.abs(mid - window.innerHeight / 2);
  });
  assert(centered < windowCenteredLimit(), "focused post should sit near the middle, off by " + centered);
  await shot(page, "tv_desktop_post_1080.png");

  await press(page, "ArrowRight");
  info = await focusInfo(page);
  assert(/name|action|play|more-btn|follow/.test(info.cls) || info.label === "Play" || info.act, "ArrowRight enters the post, got " + JSON.stringify(info));
  await shot(page, "tv_desktop_action_1080.png");
  info = await untilNav(page);
  assert(info.cls.indexOf("nav-item") >= 0, "ArrowLeft from the timeline opens the sidebar, got " + JSON.stringify(info));
  const openLabels = await page.locator(".nav-label").allInnerTexts();
  assert(openLabels.indexOf("Home") >= 0 && openLabels.indexOf("Messages") >= 0, "sidebar keeps desktop labels");
  await shot(page, "tv_desktop_nav_1080.png");

  for (let i = 0; i < 6; i++) {
    info = await focusInfo(page);
    if (info.label === "Explore" || info.text === "Explore") break;
    await press(page, "ArrowDown");
  }
  await page.keyboard.press("Enter");
  await page.waitForSelector("#explore-q", { timeout: 8000 });
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "explore-q", null, { timeout: 8000 });
  await page.keyboard.type("elon");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /elon/i.test(document.querySelector("main") ? document.querySelector("main").innerText : ""), null, { timeout: 8000 });
  await shot(page, "tv_desktop_search_1080.png");
  await page.keyboard.press("Escape");
  await sleep(400);

  await page.keyboard.press("Escape");
  await sleep(200);
  info = await focusInfo(page);
  if (info.cls.indexOf("nav-item") < 0) info = await untilNav(page);
  for (let i = 0; i < 8; i++) {
    info = await focusInfo(page);
    if (info.label === "Messages" || info.text === "Messages") break;
    await press(page, info.cls.indexOf("nav-item") >= 0 ? "ArrowDown" : "ArrowLeft");
  }
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /inbox|Messages/i.test(document.querySelector("main") ? document.querySelector("main").innerText : ""), null, { timeout: 8000 });
  await shot(page, "tv_desktop_messages_1080.png");
  await page.evaluate(() => { location.hash = "#/spaces/superintelmusic"; });
  await page.waitForSelector(".sp-sheet", { timeout: 8000 });
  await page.waitForFunction(() => /SuperintelMusic/i.test(document.querySelector("main") ? document.querySelector("main").innerText : ""), null, { timeout: 8000 });
  await sleep(400);
  info = await focusInfo(page);
  for (let i = 0; i < 6 && info.cls.indexOf("sp-") < 0; i++) {
    await page.keyboard.press("ArrowDown");
    info = await focusInfo(page);
  }
  assert(info.cls.indexOf("sp-") >= 0, "Space page is reachable by remote, got " + JSON.stringify(info));
  await shot(page, "tv_desktop_space_1080.png");
  await page.keyboard.press("Escape");
  await sleep(400);

  info = await focusInfo(page);
  if (info.cls.indexOf("tab") < 0 && info.tag !== "ARTICLE") {
    await page.keyboard.press("ArrowRight");
  }
  for (let i = 0; i < 4 && (await focusInfo(page)).tag !== "ARTICLE"; i++) await page.keyboard.press("ArrowDown");
  const postId = await page.evaluate(() => {
    const el = document.activeElement;
    const card = el && el.closest ? el.closest("article.post") : null;
    return card ? card.getAttribute("data-post") : "";
  });
  if (postId) {
    await dispatchKey(page, 403, "ColorF0Red");
    await page.waitForFunction((id) => {
      const btn = document.querySelector('article[data-post="' + id + '"] .action.like');
      return btn && btn.className.indexOf("on") >= 0;
    }, postId, { timeout: 8000 });
  }

  for (let i = 0; i < 4 && (await focusInfo(page)).tag !== "ARTICLE"; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForSelector("article.status, .status-text, .watch, #viewer:not([hidden])", { timeout: 8000 });
  await shot(page, "tv_desktop_detail_1080.png");
  await page.keyboard.press("Escape");
  await sleep(400);

  let played = false;
  await page.evaluate(() => { location.hash = "#/"; });
  await waitReady(page);
  const playSteps = await page.evaluate(() => {
    const posts = Array.from(document.querySelectorAll("main article.post"));
    for (let i = 0; i < posts.length && i < 20; i++) {
      if (posts[i].querySelector(".play")) return i;
    }
    return -1;
  });
  if (playSteps >= 0) {
    await press(page, "ArrowDown", playSteps + 1);
    for (let r = 0; r < 8; r++) {
      const label = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el.getAttribute("aria-label") || "") : "";
      });
      if (label === "Play") {
        await page.keyboard.press("Enter");
        played = true;
        break;
      }
      await page.keyboard.press("ArrowRight");
    }
  }
  if (!played) {
    await page.evaluate(() => { location.hash = "#/subscriptions"; });
    await page.waitForSelector("a.yt-card, a.short-card", { timeout: 8000 });
    await sleep(300);
    for (let i = 0; i < 16 && !played; i++) {
      const cls = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? String(el.className || "") : "";
      });
      if (cls.indexOf("yt-card") >= 0 || cls.indexOf("short-card") >= 0) {
        await page.keyboard.press("Enter");
        played = true;
        break;
      }
      await page.keyboard.press("ArrowDown");
    }
  }
  if (played) {
    await page.waitForSelector(".watch, .player, #viewer:not([hidden])", { timeout: 8000 });
    await shot(page, "tv_desktop_player_1080.png");
    await page.keyboard.press("Escape");
    await sleep(300);
  }

  await page.evaluate(() => { location.hash = "#/"; });
  await waitReady(page);
  info = await focusInfo(page);
  assert(info.act === "htab", "home should focus a tab before the menu, got " + JSON.stringify(info));
  await page.keyboard.press("ArrowRight");
  info = await focusInfo(page);
  assert(info.label.indexOf("options") >= 0, "ArrowRight from For you should reach the tab menu, got " + JSON.stringify(info));
  await page.keyboard.press("Enter");
  await sleep(500);
  if (!(await page.$(".tab-menu"))) await page.keyboard.press("Enter");
  await page.waitForSelector(".tab-menu", { timeout: 8000 });
  await page.keyboard.press("ArrowDown");
  await shot(page, "tv_desktop_tabmenu_1080.png");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".tab-menu"), null, { timeout: 8000 });

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  const video = page.video();
  await context.close();
  if (video) {
    const saved = await video.path();
    const dest = OUT + "/tv_remote_desktop_1080.webm";
    const { rename } = await import("node:fs/promises");
    await rename(saved, dest);
  }
}

function windowCenteredLimit() {
  return 280;
}

async function webos(browser) {
  const context = await openContext(browser, WEBOS, 1280, 720, false);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.stack || err.message));
  await page.goto(ROOT + "/#/", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const on = await page.evaluate(() => document.documentElement.classList.contains("tv-on"));
  assert(on, "webOS user agent should auto-enter TV mode");
  const box = await layoutInfo(page);
  assert(box.zoom >= 1.15, "720p zoom is " + box.zoom);
  assert(box.side === "none", "720p hides the right column");
  await press(page, "ArrowDown");
  const info = await focusInfo(page);
  assert(info.tag === "ARTICLE" || /post|name|action/.test(info.cls), "720p ArrowDown moves into the timeline, got " + JSON.stringify(info));
  await shot(page, "tv_desktop_home_720.png");
  await page.keyboard.press("Enter");
  await page.waitForSelector("article.status, .status-text, .watch, article.post", { timeout: 8000 });
  await dispatchKey(page, 461, "GoBack");
  await sleep(400);
  const home = await page.evaluate(() => (location.hash || "#/").split("?")[0]);
  assert(home === "#/" || home === "#/home" || home === "", "webOS Back should return home, got " + home);
  assert(errors.length === 0, "webOS page errors: " + errors.join(" | "));
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
