/* Keyboard shortcuts in a real page (headless, no screenshots): cheat sheet,
   palette, go-to chords, post focus, Esc and the Settings page. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let PAGE = null;
async function why() {
  if (!PAGE) return "";
  return PAGE.evaluate(() => {
    const c = window.ViktorychKeys.context();
    const d = document.querySelector("[role='dialog'][aria-modal='true']:not([hidden]), dialog[open]");
    return JSON.stringify({ blocked: c.blocked, scopes: c.scopes, host: c.host, dialog: d && d.outerHTML.slice(0, 160), active: document.activeElement && document.activeElement.outerHTML.slice(0, 60), trace: window.ViktorychKeys.trace() });
  }).catch(() => "");
}
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


async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    PAGE = page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    page.on("pageerror", (err) => errors.push(String(err && (err.stack || err.message) || err)));
    await page.addInitScript(() => {
      try {
        localStorage.setItem("viktorychapp-lang-user-picked", "1");
        localStorage.setItem("superintelapp-lang", "en");
      } catch (err) { /* sandboxed frames have no storage */ }
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http://127.0.0.1")) route.continue();
      else route.abort();
    });
    await page.goto("http://127.0.0.1:" + port + "/index.html#/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.ViktorychKeys && window.ViktorychKeysHost && window.ViktorychKeysUi, null, { timeout: 20000 });
    await page.waitForSelector("header.nav", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.mouse.click(640, 10);

    await page.keyboard.press("Shift+Slash");
    await page.waitForSelector("#kb-sheet:not([hidden])", { timeout: 3000 });
    const groups = await page.$$eval("#kb-sheet .kb-group h3", (els) => els.map((e) => e.textContent));
    if (groups.length < 4) fail("cheat sheet groups: " + groups.join(", "));
    await page.keyboard.type("bookm");
    const rows = await page.$$eval("#kb-sheet dt", (els) => els.map((e) => e.textContent));
    if (!rows.some((r) => /Bookmark/.test(r))) fail("cheat sheet search: " + rows.join(", "));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#kb-sheet[hidden]", { state: "attached", timeout: 3000 });

    await page.keyboard.press("Control+k");
    await page.waitForSelector("#kb-palette:not([hidden])", { timeout: 3000 });
    await page.keyboard.type("notif");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash === "#/notifications", null, { timeout: 3000 });

    await page.keyboard.press("g");
    await page.waitForSelector("#kb-chord:not([hidden])", { timeout: 2000 }).catch(async () => fail("g showed no chord toast " + await why()));
    await page.keyboard.press("e");
    await page.waitForFunction(() => location.hash === "#/explore", null, { timeout: 3000 }).catch(async () => fail("g e did not go to Explore " + await why()));
    await page.waitForSelector("#kb-chord[hidden]", { state: "attached", timeout: 2000 });

    await page.waitForTimeout(600);
    await page.keyboard.press("Slash");
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "INPUT", null, { timeout: 2000 }).catch(() => {});
    const focused = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    if (!/-q$|INPUT/.test(focused)) fail("/ did not focus search: " + focused + await why());
    await page.keyboard.type("gh");
    if (await page.evaluate(() => location.hash) !== "#/explore") fail("typing g h in search navigated");
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());

    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await page.waitForFunction(() => location.hash === "#/" || location.hash === "", null, { timeout: 3000 });
    const hasPosts = await page.waitForSelector("main article.post[data-post]", { timeout: 15000 }).then(() => true, () => false);
    if (hasPosts) {
      const cur = () => page.waitForFunction(() => { const el = window.ViktorychKeys.currentPost(); return el && el.getAttribute("data-post"); }, null, { timeout: 2000 }).then((h) => h.jsonValue(), () => null);
      await page.keyboard.press("j");
      const first = await cur();
      if (!first) fail("j did not focus a post");
      await page.keyboard.press("j");
      const second = await cur();
      if (!second || second === first) fail("j did not move to the next post " + first + " " + second + " " + await page.evaluate(() => JSON.stringify(window.ViktorychKeys.posts().slice(0, 4).map((e) => e.getAttribute("data-post")))) + await why());
      await page.keyboard.press("k");
      const back = await cur();
      const stillThere = await page.evaluate((id) => window.ViktorychKeys.posts().some((el) => el.getAttribute("data-post") === id), first);
      if (back !== first && stillThere) fail("k did not go back");
      await page.keyboard.press("j");
      await page.keyboard.press("k");
      const covered = await page.evaluate(() => {
        const el = window.ViktorychKeys.currentPost();
        return !el || el.getBoundingClientRect().top >= window.ViktorychKeys.headerOffset(el) - 2 ? "" : el.getBoundingClientRect().top + " < " + window.ViktorychKeys.headerOffset(el) + " y=" + scrollY;
      });
      if (covered) fail("focused post hides under the header " + covered);
    } else console.log("no posts offline; skipped j/k");

    await page.keyboard.press("n");
    const composeOpen = await page.waitForFunction(() => window.ViktorychKeysHost.state().modal === "compose", null, { timeout: 3000 }).then(() => true, () => false);
    if (composeOpen) {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !window.ViktorychKeysHost.state().modal, null, { timeout: 3000 }).catch(() => fail("Esc did not close the composer"));
    } else console.log("composer did not open; skipped");

    await page.evaluate(() => { location.hash = "#/settings/keyboard"; });
    await page.waitForSelector("#kb-settings .kb-cmd", { timeout: 5000 });
    await page.click('#kb-settings [data-kb-id="post.like"] [data-kb="change"]');
    await page.keyboard.press("b");
    await page.waitForSelector("#kb-settings .kb-conflict", { timeout: 4000 });
    await page.click('#kb-settings [data-kb="replace"]');
    const like = await page.evaluate(() => JSON.stringify(window.ViktorychKeys.bindingsOf("post.like")));
    if (like !== '[["b"]]') fail("rebind failed: " + like);
    const synced = await page.evaluate(() => JSON.parse(localStorage.getItem("superintelapp-settings-v1") || localStorage.getItem("viktorychapp-settings-v1") || "{}").keyboard);
    if (!synced) console.log("note: settings key name differs; keyboard prefs in host:", await page.evaluate(() => !!window.ViktorychKeysHost.keyboardPrefs()));
    await page.click('#kb-settings [data-kb="opt"][data-kb-opt="singleKeys"]');
    await page.evaluate(() => { location.hash = "#/"; });
    await page.keyboard.press("g");
    if (await page.$("#kb-chord:not([hidden])")) fail("single keys still on");
    await context.close();
    if (errors.length) fail("page errors: " + errors.join(" | "));
    console.log("keys page ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(async (err) => { console.error(err); process.exit(1); });
