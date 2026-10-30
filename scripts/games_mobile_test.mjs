import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 390, height: 844, name: "phone" },
  { width: 1280, height: 800, name: "desktop" }
];

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

/* ReGone on phones and desktop. The game site is stubbed: phones get the
   game edge to edge with a rotate prompt in portrait, the app behind it
   pauses, touches reach the game frame, leaving sends the play time, and
   the hub shows the friends board with invites. */
const STUB = `<!doctype html><html><body style="margin:0;background:#111">
<div id="pad" style="position:fixed;inset:0"></div>
<script>window.__touches=0;document.addEventListener("touchstart",function(){window.__touches++;},{passive:true});</script>
</body></html>`;
const BOARD = { gameId: "regone", name: "ReGone", people: [
  { publicId: "100000000001", handle: "user_a", name: "User A", avatar: "", me: true, totalMs: 600000, weekMs: 600000, streak: 2, bestStreak: 3, playing: true },
  { publicId: "100000000002", handle: "user_b", name: "User B", avatar: "", me: false, totalMs: 9000000, weekMs: 1200000, streak: 1, bestStreak: 1, playing: false }
] };
const SIZES = [
  { width: 390, height: 844, name: "phone-portrait", mobile: true },
  { width: 844, height: 390, name: "phone-landscape", mobile: true },
  { width: 1280, height: 800, name: "desktop", mobile: false }
];

async function check(browser, origin, size) {
  const label = size.name;
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const plays = [];
  const invites = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.route((url) => !String(url).startsWith(origin), (route) => {
    const url = route.request().url();
    if (url.startsWith("https://nzlay.com/ReGone/game/")) return route.fulfill({ status: 200, contentType: "text/html", body: STUB });
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(origin + "/v1/**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/v1/games/board") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BOARD) });
    if (url.pathname === "/v1/games/play") { plays.push(JSON.parse(req.postData() || "{}")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ streak: 2, bestStreak: 3 }) }); }
    if (url.pathname === "/v1/games/invite") { invites.push(JSON.parse(req.postData() || "{}")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sent: true }) }); }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true }));
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: "100000000001", handle: "user_a", displayName: "User A", avatar: "" } }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true };
  });
  await page.goto(origin + "/index.html#/games/regone", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#game-host iframe", { timeout: 20000 }).catch(() => fail(label + ": no game frame"));
  await page.waitForFunction(() => document.getElementById("game-host").classList.contains("is-loaded"), null, { timeout: 10000 }).catch(() => fail(label + ": the game never loaded"));
  const view = await page.evaluate(() => {
    const host = document.getElementById("game-host");
    const frame = host.querySelector("iframe");
    const box = frame.getBoundingClientRect();
    const rotate = host.querySelector(".game-rotate");
    return {
      immersive: host.classList.contains("immersive"),
      rotate: rotate ? getComputedStyle(rotate).display : "",
      box: [box.x, box.y, box.width, box.height],
      sandbox: frame.getAttribute("sandbox"),
      busy: window.ViktorychGames.busy(),
      gameOn: document.documentElement.classList.contains("game-on"),
      credit: host.querySelector(".game-credit").textContent,
      original: !!host.querySelector('.game-credit a[href="https://nzlay.com/pages/ReGone"]')
    };
  });
  if (!view.busy || !view.gameOn) fail(label + ": performance mode is off while playing");
  if (view.sandbox.indexOf("allow-orientation-lock") < 0) fail(label + ": the game cannot lock landscape");
  if (!/NZlay/.test(view.credit) || !view.original) fail(label + ": the credit or Open original is missing");
  if (size.mobile) {
    if (!view.immersive) fail(label + ": phones do not play edge to edge");
    if (Math.round(view.box[2]) !== size.width || Math.round(view.box[3]) !== size.height) fail(label + ": game frame is " + view.box.join("x"));
    const portrait = size.height > size.width;
    if (portrait && view.rotate !== "flex") fail(label + ": no rotate prompt in portrait");
    if (!portrait && view.rotate !== "none") fail(label + ": rotate prompt shows in landscape");
    if (!portrait) {
      /* With our bar showing, ReGone's own Menu and Fullscreen (top right)
         and its joystick, buttons and weapon slots still get the touch. */
      const blocked = await page.evaluate((s) => {
        const spots = [[s.w - 30, 30], [s.w - 60, 60], [80, s.h - 60], [s.w - 80, s.h - 60], [s.w / 2, s.h - 20], [s.w / 2, s.h - 50]];
        return spots.filter((pt) => { const el = document.elementFromPoint(pt[0], pt[1]); return !el || el.tagName !== "IFRAME"; }).map((pt) => pt.join(",") + ":" + (document.elementFromPoint(pt[0], pt[1]) || {}).className);
      }, { w: size.width, h: size.height });
      if (blocked.length) fail(label + ": our overlay covers the game's controls at " + blocked.join(" "));
      const tip = await page.evaluate(() => document.querySelector("#game-host .game-pad-note").textContent);
      if (!/joystick/i.test(tip)) fail(label + ": no tip about the in-match touch controls");
      const small = await page.evaluate(() => [...document.querySelectorAll("#game-host .game-bar a, #game-host .game-bar button")].filter((el) => el.getBoundingClientRect().height < 44).length);
      if (small) fail(label + ": " + small + " bar buttons are under 44px");
      await page.waitForFunction(() => document.getElementById("game-host").classList.contains("chrome-hidden"), null, { timeout: 8000 }).catch(() => fail(label + ": the bar never hides"));
      await page.touchscreen.tap(size.width / 2, size.height / 2);
      const frame = await (await page.$("#game-host iframe")).contentFrame();
      const touches = await frame.evaluate(() => window.__touches);
      if (!touches) fail(label + ": touches do not reach the game");
      await page.click("[data-game-chrome]");
      const shown = await page.evaluate(() => !document.getElementById("game-host").classList.contains("chrome-hidden"));
      if (!shown) fail(label + ": the handle does not bring the bar back");
    }
  } else {
    if (view.immersive) fail(label + ": desktop went edge to edge");
    if (view.box[0] < 50) fail(label + ": desktop game covers the left nav");
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { location.hash = "#/games"; });
  await page.waitForSelector(".games-board .games-person", { timeout: 10000 }).catch(() => fail(label + ": no friends board"));
  const after = await page.evaluate(() => ({ busy: window.ViktorychGames.busy(), gameOn: document.documentElement.classList.contains("game-on"), immersive: document.documentElement.classList.contains("game-immersive"), hidden: document.getElementById("game-host").hidden, mini: document.getElementById("game-host").classList.contains("mini") && window.ViktorychGames.isMini(), rows: [...document.querySelectorAll(".games-person .games-pname")].map((e) => e.textContent), tabH: document.querySelector(".games-tabs").getBoundingClientRect().height, wide: document.scrollingElement.scrollWidth > innerWidth + 1 }));
  // Leaving keeps the same game running in the mini player, but the page itself is back to normal.
  if (after.busy || after.gameOn || after.immersive || after.hidden || !after.mini) fail(label + ": leaving the game should leave only the mini player " + JSON.stringify(after));
  if (after.rows[0] !== "User B") fail(label + ": board order " + after.rows.join(","));
  if (after.tabH > 44) fail(label + ": board tabs are " + after.tabH + "px tall");
  if (after.wide) fail(label + ": hub scrolls sideways");
  await page.click("#game-host [data-game-close]");
  await page.waitForFunction(() => document.getElementById("game-host").hidden && !window.ViktorychGames.isMini(), null, { timeout: 5000 }).catch(() => fail(label + ": X did not close the mini player"));
  if (!plays.length || plays[0].gameId !== "regone" || !(plays[0].ms >= 1000)) fail(label + ": play time was not sent " + JSON.stringify(plays));
  await page.click('[data-game-board-tab="streak"]');
  const streakFirst = await page.evaluate(() => document.querySelector(".games-person .games-pname").textContent);
  if (streakFirst !== "You") fail(label + ": streak tab order " + streakFirst);
  // The board's invite button opens the invite sheet for that friend.
  await page.click('[data-gs-invite="100000000002"]');
  await page.waitForSelector(".gs-sheet [data-gs-submit]", { timeout: 5000 }).catch(() => fail(label + ": the invite sheet did not open"));
  await page.click(".gs-sheet [data-gs-submit]");
  await page.waitForFunction(() => !document.querySelector(".gs-sheet"), null, { timeout: 5000 }).catch(() => fail(label + ": invite did not finish"));
  if (invites.length !== 1 || invites[0].to !== "100000000002") fail(label + ": invite " + JSON.stringify(invites));
  if (errors.length) fail(label + ": " + errors[0]);
  await context.close();
  console.log("games ok " + label);
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const size of SIZES) await check(browser, origin, size);
    console.log("games ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
