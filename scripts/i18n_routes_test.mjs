/* Visits every page in Hindi and in Russian and looks for interface text
   still in English. A phrase from the English pack that shows up as is
   fails the run. Other Latin-only text is listed so a person can check
   it, because names, brands and posts are allowed to stay as written. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core");
const chromium = pw.chromium || pw.default.chromium;
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" };

const ROUTES = [
  "home", "following", "explore", "notifications", "messages", "feeds", "lists", "history", "history/likes",
  "music", "shorts", "shorts/live", "games", "points", "online", "store", "gifts", "communities", "tv",
  "storage", "storage/photos", "storage/trash", "vault", "packages", "status", "subscriptions", "@demo",
  "settings", "settings/accessibility", "settings/content", "settings/data", "settings/delete-account", "settings/device",
  "settings/devices", "settings/display", "settings/display-language", "settings/keys", "settings/languages",
  "settings/live-translate", "settings/network", "settings/nostr", "settings/notifications", "settings/privacy",
  "settings/resources", "settings/security", "settings/storage", "settings/usernames", "settings/x-posting"
];

/* Places that hold posts, names, handles and other things people wrote. */
const CONTENT = [
  "article.post", ".post-text", ".pname", ".phandle", ".handle", ".name", ".tv-chat-text", ".tv-chat-author",
  ".comment", ".yt-comment", ".msg", ".message", ".dm-text", ".feed-name", ".community-name", ".community-desc",
  ".song", ".track", ".album", ".artist", ".card-title", ".link-card", ".shorts-caption", "[data-user-content]",
  "code", "pre", "kbd", "script", "style", "noscript", "template", "svg"
].join(",");

function readPack(code) {
  const text = fs.readFileSync(path.join(root, "i18n", code + ".js"), "utf8");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

const en = readPack("en");
const allow = new Set();
for (const line of fs.readFileSync(path.join(root, "scripts", "i18n_allow.txt"), "utf8").split("\n")) {
  const at = line.indexOf("|");
  if (at > 0 && !line.startsWith("#")) allow.add(line.slice(at + 1).trim());
}

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
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || "chrome" });

async function sweep(code) {
  const pack = readPack(code);
  /* English text that this language translates differently. */
  const english = new Map();
  for (const [key, value] of Object.entries(en)) {
    if (/\{|\.(one|few|many|other)$/.test(key)) continue;
    const shown = String(value).trim();
    if (shown.length < 4 || !/[a-z]/.test(shown) || allow.has(shown)) continue;
    if (pack[key] && pack[key] !== value) english.set(shown, key);
  }
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Kolkata", locale: code === "hi" ? "hi-IN" : "ru-RU" });
  await ctx.addInitScript((lang) => {
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "token-a", account: { handle: "user_a", displayName: "User A" } }));
    localStorage.setItem("superintelapp-lang", lang);
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
  }, code);
  await ctx.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err && err.message || err)));
  await page.goto(origin + "/index.html#/home", { waitUntil: "domcontentloaded" });
  await page.waitForFunction((lang) => window.SI18n && window.SI18n.getLang() === lang && window.SI18n.t("Home") !== "Home", code, { timeout: 30000 });
  const failures = [];
  const review = new Map();
  for (const route of ROUTES) {
    await page.evaluate((r) => { location.hash = "#/" + r; }, route);
    await page.waitForTimeout(450);
    const found = await page.evaluate((skip) => {
      const out = [];
      const seen = new Set();
      const push = (text) => { text = text.replace(/\s+/g, " ").trim(); if (text && !seen.has(text)) { seen.add(text); out.push(text); } };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || el.closest(skip) || el.closest("[hidden],[aria-hidden='true']")) continue;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        push(node.nodeValue || "");
      }
      for (const el of document.querySelectorAll("[aria-label],[placeholder],[title]")) {
        if (el.closest(skip)) continue;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        for (const name of ["aria-label", "placeholder", "title"]) if (el.getAttribute(name)) push(el.getAttribute(name));
      }
      return out;
    }, CONTENT);
    for (const text of found) {
      if (/[\u0400-\u04FF\u0900-\u097F]/.test(text)) continue;
      if (!/[A-Za-z]{3,}/.test(text) || allow.has(text)) continue;
      if (english.has(text)) failures.push(route + ": " + JSON.stringify(text));
      else if (/\b[a-z]{3,}\b.*\b[a-z]{3,}\b/.test(text) && text.length < 160) review.set(text, route);
    }
  }
  await ctx.close();
  if (errors.length) console.log(code + " page errors: " + [...new Set(errors)].slice(0, 5).join(" | "));
  return { failures, review };
}

let failed = false;
try {
  for (const code of ["hi", "ru"]) {
    const { failures, review } = await sweep(code);
    if (review.size) {
      console.log(code + ": " + review.size + " Latin-only phrases to review");
      for (const [text, route] of [...review].slice(0, 40)) console.log("  #/" + route + "  " + JSON.stringify(text));
    }
    if (failures.length) {
      failed = true;
      console.log(code + ": " + failures.length + " English interface phrases on screen");
      for (const line of failures.slice(0, 60)) console.log("  #/" + line);
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) process.exit(1);
console.log("i18n routes ok (" + ROUTES.length + " routes in hi and ru)");
