/* Personal sidebar logo: text cleaning and escaping, the settings plumbing,
   and (with PLAYWRIGHT_CORE set) the real page at desktop width: custom text
   in the wordmark lockup, no HTML from the text, and a hidden logo letting
   the sidebar icons move up with focus starting on the first icon. */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = require("../logo-text.js");

/* 1. Cleaning. */
assert.equal(L.clean("  Hello   world  "), "Hello world", "whitespace trimmed and collapsed");
assert.equal(L.clean("a\u0000b\u0007c\u202Ed\u200Be\uFEFF"), "a b c d e", "control, bidi and zero-width characters become spaces");
assert.equal(L.clean("x\n\ty"), "x y");
assert.equal(L.clean("Привет, мир"), "Привет, мир", "Cyrillic kept");
assert.equal(L.clean("Ελληνικά ภาษาไทย 日本"), "Ελληνικά ภาษาไทย 日本", "other scripts kept");
assert.equal(L.length("abcdefghijklmnopqrstuvwxyz"), 20, "20 characters at most");
assert.equal(L.clean("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnopqrst");
assert.equal(L.length("👨‍👩‍👧‍👦".repeat(25)), 20, "an emoji family counts as one character");
assert.equal(L.clean(null), "");
assert.equal(L.clean(42), "42");
assert.equal(L.clean("abcdefghijklmnopqrs tuvw"), "abcdefghijklmnopqrs", "a cut never leaves a trailing space");

/* 2. Settings shape and fallback. */
assert.deepEqual(L.normalize(null), { mode: "default", text: "" });
assert.deepEqual(L.normalize({ mode: "bogus", text: "Hi" }), { mode: "default", text: "Hi" });
assert.deepEqual(L.normalize({ mode: "hidden" }), { mode: "hidden", text: "" });
assert.deepEqual(L.effective({ mode: "text", text: "   " }), { mode: "default", text: "" }, "empty custom text falls back to the default");
assert.deepEqual(L.effective({ mode: "text", text: " Mine " }), { mode: "text", text: "Mine" });

/* 3. Escaping: the text never becomes HTML. */
const evil = L.html('<img src=x onerror="alert(1)">&\'');
assert.ok(!/<img/i.test(evil), "no tag survives");
assert.ok(evil.includes("&lt;") && evil.includes("img src=x"));
const marks = L.html("<b>\"&'</b>");
assert.ok(!marks.includes("<b>") && marks.includes("b&gt;&quot;&amp;&#39;&lt;/b&gt;"), marks);
const lock = L.html("Вася", "logo-full");
assert.ok(lock.includes('class="logo-text logo-full"'));
assert.ok(lock.includes('<span class="logo-text-a">В</span><span class="logo-text-b">ася</span>'), "first letter heavy, the rest regular");
assert.ok(L.html("ab").includes('data-size="l"') && L.html("abcdefghijk").includes('data-size="m"') && L.html("abcdefghijklmnopq").includes('data-size="s"'));
assert.equal(L.html("   "), "");

/* 4. Plumbing: synced with the account like the other look settings, kept
   in the user's own settings, and a neutral (no data) setting. */
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const sync = fs.readFileSync(path.join(root, "settings-sync.js"), "utf8");
const accounts = fs.readFileSync(path.join(root, "accounts.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
assert.ok(/\["brandLogo", "Sidebar logo"\]/.test(sync) && /"musicPrefs", "brandLogo"\]/.test(sync), "listed in settings sync");
assert.ok(/"friendsRail", "brandLogo"\]/.test(accounts), "sent with the account's settings");
assert.ok(app.includes('brandLogo: { mode: "default", text: "" }'), "fresh settings default");
assert.ok(app.includes("parsed.brandLogo = cleanBrandLogo(parsed.brandLogo)"), "stored values are cleaned on load");
assert.ok(html.includes('<script src="logo-text.js" defer></script>') && sw.includes('"./logo-text.js"'));
assert.ok(sw.includes('"./fonts/inter-400.woff2"') && sw.includes('"./fonts/inter-900.woff2"'), "the wordmark font caches on first use");
for (const lang of ["en", "es", "ru"]) {
  const pack = fs.readFileSync(path.join(root, "i18n", lang + ".js"), "utf8");
  for (const key of ["Sidebar logo", "Custom text", "Logo text", "Hidden", "Reset to default", "No logo. Sidebar icons move up."]) {
    assert.ok(pack.includes(JSON.stringify(key) + ":"), lang + " has " + key);
  }
}
assert.ok(/font-family: "Viktorych Wordmark", Inter/.test(css) && /U\+0400-052F/.test(css), "Inter subset with Cyrillic, then system fonts");
assert.ok(fs.existsSync(path.join(root, "fonts", "inter-400.woff2")) && fs.existsSync(path.join(root, "fonts", "inter-900.woff2")));
console.log("logo text unit checks ok");

/* 5. The real page. */
function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("missing"); return; }
      res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function browserChecks() {
  const spec = process.env.PLAYWRIGHT_CORE;
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  const chromium = mod.chromium || (mod.default && mod.default.chromium);
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    async function open(brandLogo, width) {
      const context = await browser.newContext({ viewport: { width: width || 1400, height: 900 }, serviceWorkers: "block" });
      await context.addInitScript((value) => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true, brandLogo: value }));
      }, brandLogo);
      const page = await context.newPage();
      page.on("pageerror", (err) => console.error("page error", err && err.message ? err.message : err));
      await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("header.nav:not(.nav-land) .nav-scroll .nav-item", { timeout: 20000 });
      await page.waitForTimeout(200);
      return { page, context };
    }
    const firstIconTop = (page) => page.evaluate(() => Math.round(document.querySelector("header.nav:not(.nav-land) .nav-scroll .nav-item").getBoundingClientRect().top));

    const base = await open({ mode: "default", text: "" });
    const baseTop = await firstIconTop(base.page);
    assert.ok(await base.page.$("header.nav:not(.nav-land) .logo svg.logo-full"), "default shows the wordmark");
    await base.context.close();

    const custom = await open({ mode: "text", text: 'Вася<img src=x onerror="window.__pwned=1">' });
    const info = await custom.page.evaluate(() => {
      const el = document.querySelector("header.nav:not(.nav-land) .logo .logo-text");
      if (!el) return null;
      const a = el.querySelector(".logo-text-a");
      const b = el.querySelector(".logo-text-b");
      const style = getComputedStyle(el);
      return {
        text: el.textContent, imgs: document.querySelectorAll("header.nav img[src='x']").length, pwned: !!window.__pwned,
        shown: style.display !== "none" && el.getBoundingClientRect().width > 10,
        family: style.fontFamily, heavy: getComputedStyle(a).fontWeight, light: b ? getComputedStyle(b).fontWeight : "",
        fits: el.getBoundingClientRect().right <= document.querySelector("header.nav:not(.nav-land)").getBoundingClientRect().right + 1
      };
    });
    assert.ok(info, "custom text renders in the sidebar");
    assert.equal(info.text, "Вася<img src=x onerr", "the text is cleaned, cut to 20 and shown as text");
    assert.equal(info.imgs, 0); assert.equal(info.pwned, false);
    assert.ok(info.shown && info.fits, "visible inside the sidebar " + JSON.stringify(info));
    assert.ok(/Viktorych Wordmark/.test(info.family) && info.heavy === "900" && info.light === "400", "wordmark lockup " + JSON.stringify(info));
    await custom.context.close();

    const tablet = await open({ mode: "text", text: "Mine" }, 1000);
    const tabletShown = await tablet.page.evaluate(() => {
      const el = document.querySelector("header.nav:not(.nav-land) .logo .logo-text");
      const mark = document.querySelector("header.nav:not(.nav-land) .logo .logo-si");
      return { text: !!el && getComputedStyle(el).display !== "none", mark: !!mark && getComputedStyle(mark).display !== "none" };
    });
    assert.deepEqual(tabletShown, { text: false, mark: true }, "the icon rail keeps the V mark like the default wordmark");
    await tablet.context.close();

    const set = await open({ mode: "default", text: "" });
    await set.page.goto(origin + "/#/settings/display", { waitUntil: "domcontentloaded" });
    await set.page.waitForSelector('[data-act="logo-mode"][data-mode="text"]', { timeout: 20000 });
    await set.page.click('[data-act="logo-mode"][data-mode="text"]');
    await set.page.waitForSelector("#logo-text", { timeout: 5000 });
    assert.equal(await set.page.evaluate(() => document.activeElement && document.activeElement.id), "logo-text", "the field gets focus");
    await set.page.keyboard.type("  Привет мир  ");
    await set.page.waitForTimeout(800);
    const typed = await set.page.evaluate(() => ({
      preview: (document.querySelector("#logo-preview .logo-text") || {}).textContent,
      side: (document.querySelector("header.nav:not(.nav-land) .logo .logo-text") || {}).textContent,
      count: document.getElementById("logo-count").textContent,
      stored: JSON.parse(localStorage.getItem("viktorychapp-settings-v1")).brandLogo,
      focus: document.activeElement && document.activeElement.id
    }));
    assert.deepEqual(typed, { preview: "Привет мир", side: "Привет мир", count: "10/20", stored: { mode: "text", text: "Привет мир" }, focus: "logo-text" }, "live preview, sidebar and saved value");
    await set.page.click('[data-act="logo-reset"]');
    await set.page.waitForTimeout(150);
    const reset = await set.page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem("viktorychapp-settings-v1")).brandLogo,
      field: !!document.getElementById("logo-text"),
      wordmark: !!document.querySelector("header.nav:not(.nav-land) .logo svg.logo-full")
    }));
    assert.deepEqual(reset, { stored: { mode: "default", text: "" }, field: false, wordmark: true }, "reset to default");
    await set.context.close();

    const hidden = await open({ mode: "hidden", text: "" });
    assert.equal(await hidden.page.$("header.nav .logo"), null, "no logo link at all when hidden");
    const hiddenTop = await firstIconTop(hidden.page);
    assert.ok(hiddenTop <= baseTop - 40, "icons move up into the freed space " + baseTop + " -> " + hiddenTop);
    const focus = await hidden.page.evaluate(() => {
      const nav = document.querySelector("header.nav:not(.nav-land)");
      const items = Array.from(nav.querySelectorAll("a[href], button, [tabindex]")).filter((el) => el.tabIndex >= 0 && el.getClientRects().length && !el.classList.contains("nav-split"));
      return items.length ? items[0].className : "";
    });
    assert.ok(/nav-item/.test(focus), "keyboard focus starts on the first sidebar icon: " + focus);
    await hidden.context.close();
    console.log("logo text page checks ok", baseTop, "->", hiddenTop);
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.env.PLAYWRIGHT_CORE) await browserChecks();
else console.log("PLAYWRIGHT_CORE unset: page checks skipped");
