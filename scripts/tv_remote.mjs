/* Keyboard-only TV checks at 1920x1080 (Tizen) and 1280x720 (webOS). */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

const playwright = await import(process.env.PLAYWRIGHT_MJS || "playwright");
const chromium = playwright.chromium;

const PORT = 8765;
const ROOT = "http://127.0.0.1:" + PORT;
const OUT = "/opt/cursor/artifacts";
const TIZEN = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/5.0 Chrome/85.0.4183.93 TV Safari/537.36";
const WEBOS = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function focusInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { id: "", zone: "", index: "", text: "" };
    return {
      id: el.getAttribute("data-tv-id") || "",
      zone: el.getAttribute("data-zone") || "",
      index: el.getAttribute("data-index") || "",
      shelf: el.getAttribute("data-shelf") || "",
      text: (el.innerText || "").slice(0, 80)
    };
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => document.documentElement.getAttribute("data-tv-ready") === "1", null, { timeout: 15000 });
  await page.waitForSelector("#tv-root h2.tv-shelf-title, #tv-root h1", { timeout: 15000 });
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
  await sleep(250);
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
    await desktop(browser);
    await tizen(browser);
    await webos(browser);
  } catch (err) {
    failures.push(err);
    console.error(err);
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) {
    process.exit(1);
  }
  console.log("tv remote checks passed");
}

async function desktop(browser) {
  const context = await openContext(browser, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", 1440, 900, false);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("desktop pageerror", err.message));
  await page.goto(ROOT + "/#/settings", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const tvOn = await page.evaluate(() => document.documentElement.classList.contains("tv-on"));
  assert(!tvOn, "a desktop pointer must not auto-enter TV mode");
  const toggle = page.locator("[data-tv-toggle]").first();
  await toggle.waitFor({ timeout: 15000 });
  assert((await toggle.innerText()).indexOf("TV mode") >= 0, "Settings > Display has a TV mode control");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.classList.contains("tv-on"), null, { timeout: 8000 });
  await context.close();

  const forced = await openContext(browser, TIZEN, 1280, 720, false);
  const off = await forced.newPage();
  await off.goto(ROOT + "/?tv=0", { waitUntil: "domcontentloaded" });
  await off.waitForTimeout(600);
  const stayed = await off.evaluate(() => document.documentElement.classList.contains("tv-on"));
  assert(!stayed, "?tv=0 keeps a TV user agent out of TV mode");
  await forced.close();
}

async function tizen(browser) {
  const context = await openContext(browser, TIZEN, 1920, 1080, true);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(ROOT + "/?tv=1#/", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const titles = await page.locator("h2.tv-shelf-title").allInnerTexts();
  for (const name of ["For You", "Following", "Subscriptions", "Live now", "YouTube"]) {
    assert(titles.indexOf(name) >= 0, "missing shelf " + name + " in " + titles.join(", "));
  }
  const metrics = await page.evaluate(() => {
    const text = document.querySelector(".tv-text");
    const root = document.getElementById("tv-root");
    const style = text ? getComputedStyle(text) : null;
    const pad = root ? parseFloat(getComputedStyle(root).paddingTop) : 0;
    return { font: style ? parseFloat(style.fontSize) : 0, pad: pad };
  });
  assert(metrics.font >= 24, "body text is " + metrics.font + "px");
  assert(metrics.pad >= 50, "1080p overscan padding is " + metrics.pad);

  let info = await focusInfo(page);
  assert(info.zone === "card" && info.shelf === "foryou" && info.index === "0", "home should focus the first For You card, got " + JSON.stringify(info));
  await shot(page, "tv_home_shelves_1080.png");
  await press(page, "ArrowRight");
  info = await focusInfo(page);
  assert(info.index === "1" && info.shelf === "foryou", "ArrowRight should move along the shelf, got " + JSON.stringify(info));
  await shot(page, "tv_focused_card_1080.png");
  await press(page, "ArrowLeft", 2);
  info = await focusInfo(page);
  assert(info.zone === "nav", "ArrowLeft from the first card should enter the rail, got " + JSON.stringify(info));
  const open = await page.evaluate(() => document.getElementById("tv-rail").classList.contains("is-open"));
  assert(open, "the nav rail should expand on focus");
  await shot(page, "tv_nav_expanded_1080.png");

  await press(page, "ArrowDown", 2);
  await page.keyboard.press("Enter");
  await waitReady(page);
  await page.waitForSelector("#tv-keys .tv-key", { timeout: 8000 });
  await page.keyboard.type("elon");
  await page.waitForTimeout(200);
  const results = await page.locator("#tv-results").innerText();
  assert(/Elon|elon/i.test(results), "search should list Elon, got " + results.slice(0, 180));
  await shot(page, "tv_search_1080.png");
  await page.keyboard.press("Escape");
  await waitReady(page);

  info = await focusInfo(page);
  if (info.zone !== "card") {
    await press(page, "ArrowRight");
    info = await focusInfo(page);
  }
  assert(info.zone === "card", "back from search should restore a card, got " + JSON.stringify(info));
  await page.keyboard.down("Enter");
  await sleep(700);
  const menuOpen = await page.evaluate(() => {
    const menu = document.getElementById("tv-menu");
    return !!(menu && !menu.hidden && menu.innerText.indexOf("Like") >= 0);
  });
  assert(menuOpen, "holding OK should open the post menu");
  await page.keyboard.up("Enter");
  await page.keyboard.press("Escape");
  await sleep(100);
  const menuClosed = await page.evaluate(() => document.getElementById("tv-menu").hidden);
  assert(menuClosed, "Back should close the post menu");

  await page.keyboard.press("Enter");
  await waitReady(page);
  await page.waitForSelector("#tv-replies", { timeout: 8000 });
  info = await focusInfo(page);
  assert(info.id === "detail-author", "post detail should focus the author, got " + JSON.stringify(info));
  await page.keyboard.press("Enter");
  await waitReady(page);
  const profileName = await page.locator("#tv-root h1").first().innerText();
  assert(profileName.length > 0, "profile should show a name");
  await shot(page, "tv_profile_1080.png");
  for (let i = 0; i < 4; i++) {
    const hash = await page.evaluate(() => (location.hash || "#/").split("?")[0]);
    if (hash === "#/" || hash === "#/home" || hash === "") break;
    await page.keyboard.press("Escape");
    await waitReady(page);
  }

  info = await focusInfo(page);
  if (info.zone === "nav") await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 6 && (await focusInfo(page)).shelf !== "subs"; i++) await page.keyboard.press("ArrowDown");
  info = await focusInfo(page);
  assert(info.shelf === "subs" && info.zone === "card", "should reach Subscriptions, got " + JSON.stringify(info));
  await page.keyboard.press("Enter");
  await page.waitForSelector("#tv-player:not([hidden]) iframe, #tv-player:not([hidden]) video", { timeout: 8000 });
  await page.waitForFunction(() => {
    const el = document.activeElement;
    return el && el.getAttribute("data-tv-id") === "player-stage";
  }, null, { timeout: 8000 });
  const src = await page.locator("#tv-player iframe, #tv-player video").first().getAttribute("src");
  assert(src && (src.indexOf("youtube-nocookie.com/embed/") >= 0 || src.indexOf("http") === 0), "player should load a video, got " + src);
  await page.keyboard.press("ArrowRight");
  const time = await page.locator("#tv-time").getAttribute("data-time");
  assert(time === "10", "ArrowRight should seek +10s, got " + time);
  await shot(page, "tv_player_1080.png");
  await page.keyboard.press("ArrowLeft");
  const back = await page.locator("#tv-time").getAttribute("data-time");
  assert(back === "0", "ArrowLeft should seek -10s, got " + back);

  await dispatchKey(page, 403, "ColorF0Red");
  await sleep(200);
  const liked = await page.locator("#tv-toast").innerText();
  assert(/Like/.test(liked), "red key should like the video, got " + liked);

  const playerPath = [];
  for (let i = 0; i < 8; i++) {
    const id = (await focusInfo(page)).id;
    playerPath.push(id);
    if (id === "player-channel") break;
    await page.keyboard.press(id === "player-progress" || id === "player-stage" ? "ArrowDown" : "ArrowLeft");
  }
  assert((await focusInfo(page)).id === "player-channel", "should focus the channel control, path " + playerPath.join(" > "));
  await page.keyboard.press("Enter");
  await waitReady(page);
  const channel = await page.locator("#tv-root h1").first().innerText();
  assert(/Prepper|Canadian/i.test(channel), "channel profile opened, got " + channel);
  for (let i = 0; i < 4; i++) {
    const id = (await focusInfo(page)).id;
    if (id === "act-person") break;
    await page.keyboard.press(id && id.indexOf("c-") === 0 ? "ArrowUp" : "ArrowRight");
  }
  assert((await focusInfo(page)).id === "act-person", "channel profile should focus All platforms, got " + JSON.stringify(await focusInfo(page)));
  await page.keyboard.press("Enter");
  await waitReady(page);
  const person = await page.locator("#tv-root h1").first().innerText();
  assert(/Prepper|Canadian/i.test(person), "unified profile opened, got " + person);
  const personHash = await page.evaluate(() => location.hash);
  assert(personHash.indexOf("#/p/") === 0, "unified profile route, got " + personHash);
  const personShelves = await page.locator("h2.tv-shelf-title").allInnerTexts();
  assert(personShelves.indexOf("All") >= 0, "person profile should shelf every tab, got " + personShelves.join(", "));
  await press(page, "ArrowRight");
  await shot(page, "tv_person_1080.png");
  await dispatchKey(page, 10009, "XF86Back");
  await waitReady(page);

  assert(errors.length === 0, "page errors: " + errors.join(" | "));
  const video = page.video();
  await context.close();
  if (video) {
    const saved = await video.path();
    const dest = OUT + "/tv_remote_tizen_1080_v3.webm";
    const { rename } = await import("node:fs/promises");
    await rename(saved, dest);
  }
}

async function webos(browser) {
  const context = await openContext(browser, WEBOS, 1280, 720, false);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(ROOT + "/#/", { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const on = await page.evaluate(() => document.documentElement.classList.contains("tv-on"));
  assert(on, "webOS user agent should auto-enter TV mode");
  const font = await page.evaluate(() => {
    const text = document.querySelector(".tv-text");
    return text ? parseFloat(getComputedStyle(text).fontSize) : 0;
  });
  assert(font >= 24, "720p text is " + font + "px");
  await press(page, "ArrowRight");
  const info = await focusInfo(page);
  assert(info.index === "1", "webOS ArrowRight should move, got " + JSON.stringify(info));
  await shot(page, "tv_home_shelves_720.png");
  await page.keyboard.press("Enter");
  await waitReady(page);
  await page.waitForSelector("#tv-replies", { timeout: 8000 });
  await dispatchKey(page, 461, "GoBack");
  await waitReady(page);
  const home = await page.evaluate(() => (location.hash || "#/").split("?")[0]);
  assert(home === "#/" || home === "#/home" || home === "", "webOS Back should return home, got " + home);
  assert(errors.length === 0, "webOS page errors: " + errors.join(" | "));
  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
