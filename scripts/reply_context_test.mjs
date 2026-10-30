/* Replies read like X.com: one "Replying to @handle" line under the name row,
   the auto-prefixed @mentions taken out of the body, mentions later in the text
   kept, X's "@a and @b" / "@a @b and N others" format, and no line when the
   parent sits right above on the thread line. Fake handles only.
   SHOTS=/dir saves phone and desktop screenshots. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";
const TAG = process.env.SHOT_TAG || "after";
const LOOSE = process.env.LOOSE === "1";
let failures = 0;

function fail(message) {
  console.error("FAIL " + message);
  failures += 1;
  process.exitCode = 1;
}

function mime(file) {
  if (/\.m?js$/.test(file)) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  return "application/octet-stream";
}

const now = Date.now();
const iso = (mins) => new Date(now - mins * 60000).toISOString();
const feed = (handle, name) => ({ id: "x:" + handle, platform: "x", handle: handle, name: name, title: name, avatar: "", url: "https://x.com/" + handle, configured: true });
const post = (id, handle, name, mins, text, replyingTo) => ({
  id: id, statusId: id, platform: "x", feedId: "x:" + handle, kind: replyingTo ? "reply" : "post",
  author: name, handle: handle, avatar: "", text: text, links: [], date: iso(mins),
  url: "https://x.com/" + handle + "/status/" + id, media: [], images: [], repostedBy: null,
  replyingTo: replyingTo || null, quoted: null, stats: { replies: 1, reposts: 0, likes: 2, views: 30 }
});

const PARENT = "900000000000000001";
const LEAD = "900000000000000002";
const MID = "900000000000000003";
const TWO = "900000000000000004";
const MANY = "900000000000000005";
const THREAD = "900000000000000006";
const FIXTURE = {
  updated: new Date(now).toISOString(),
  feeds: [feed("fake_alpha", "Fake Alpha"), feed("fake_beta", "Fake Beta"), feed("fake_gamma", "Fake Gamma")],
  posts: [
    post(LEAD, "fake_beta", "Fake Beta", 2, "@fake_alpha Leading mention body stays one line", { handle: "fake_alpha", name: "Fake Alpha", id: "900000000000000091" }),
    post(MID, "fake_gamma", "Fake Gamma", 3, "Thanks @fake_alpha for the mid text mention", { handle: "fake_alpha", name: "Fake Alpha", id: "900000000000000092" }),
    post(TWO, "fake_beta", "Fake Beta", 4, "@fake_alpha @fake_gamma Two targets body", { handle: "fake_alpha", name: "Fake Alpha", id: "900000000000000093" }),
    post(MANY, "fake_gamma", "Fake Gamma", 5, "@fake_delta @fake_eps @fake_zeta @fake_eta Many targets body with @fake_mid inside", { handle: "fake_delta", name: "Fake Delta", id: "900000000000000094" }),
    post(THREAD, "fake_beta", "Fake Beta", 6, "@fake_alpha Threaded reply under its parent", { handle: "fake_alpha", name: "Fake Alpha", id: PARENT }),
    post(PARENT, "fake_alpha", "Fake Alpha", 9, "Parent post for the fixture")
  ]
};

async function loadChromium() {
  const core = process.env.PLAYWRIGHT_CORE || "/workspace/pwcore/node_modules/playwright-core";
  const entry = /\.m?js$/.test(core) ? core : path.join(core, "index.mjs");
  try {
    const mod = await import(core.startsWith("/") ? pathToFileURL(entry).href : core);
    return mod.chromium || (mod.default && mod.default.chromium);
  } catch (err) {
    return null;
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    if (/\/feeds\.json$/.test(rel)) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify(FIXTURE));
    }
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function readCard(page, id) {
  return page.evaluate((pid) => {
    const art = document.querySelector(`#app article[data-post="${pid}"]`);
    if (!art) return null;
    const rep = art.querySelector(".replying");
    const text = art.querySelector(".post-text");
    const byline = art.querySelector(".byline");
    const rs = rep ? getComputedStyle(rep) : null;
    const ts = text ? getComputedStyle(text) : null;
    const link = rep ? rep.querySelector("a") : null;
    return {
      replyCount: art.querySelectorAll(".replying").length,
      replying: rep ? rep.textContent.replace(/\s+/g, " ").trim() : "",
      links: rep ? Array.from(rep.querySelectorAll("a")).map((a) => a.getAttribute("href")) : [],
      others: rep ? !!rep.querySelector("[data-act='reply-others']") : false,
      body: text ? text.textContent.replace(/\s+/g, " ").trim() : "",
      size: rs ? rs.fontSize : "",
      bodySize: ts ? ts.fontSize : "",
      color: rs ? rs.color : "",
      linkColor: link ? getComputedStyle(link).color : "",
      gapTop: rep && byline ? Math.round(rep.getBoundingClientRect().top - byline.getBoundingClientRect().bottom) : null,
      gapBottom: rep && text ? Math.round(text.getBoundingClientRect().top - rep.getBoundingClientRect().bottom) : null,
      inThread: !!art.closest(".thread")
    };
  }, id);
}

async function run(chromium, port, vp) {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || "chrome" });
  try {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1, serviceWorkers: "block", locale: "en-US" });
    await ctx.route(/^https?:\/\//, (route) => {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      if (/\/feeds\.json/.test(url)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) });
      return route.abort();
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch (err) {} });
    await page.goto(`http://127.0.0.1:${port}/#/home`);
    await page.waitForSelector(`#app article[data-post="${LEAD}"]`, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(800);

    const lead = await readCard(page, LEAD);
    if (!lead) { fail(`${vp.name}: the fixture reply did not render on Home`); return; }
    if (lead.replyCount !== 1 || lead.replying !== "Replying to @fake_alpha") fail(`${vp.name}: lead reply line is "${lead.replying}"`);
    if (lead.body !== "Leading mention body stays one line") fail(`${vp.name}: lead reply body still shows the prefixed mention: "${lead.body}"`);
    if (lead.size !== "15px" || lead.bodySize !== "15px") fail(`${vp.name}: reply line ${lead.size}, body ${lead.bodySize}, want 15px`);
    if (lead.color !== "rgb(113, 118, 123)") fail(`${vp.name}: reply line colour ${lead.color}, want X grey`);
    if (lead.linkColor !== "rgb(29, 155, 240)") fail(`${vp.name}: reply handle colour ${lead.linkColor}, want X blue`);
    if (lead.gapTop == null || lead.gapTop > 2 || lead.gapBottom == null || lead.gapBottom > 2) fail(`${vp.name}: reply line gaps ${lead.gapTop}/${lead.gapBottom}px, want tight`);
    if (!lead.links.length || !/fake_alpha/.test(lead.links[0])) fail(`${vp.name}: the handle must link to its profile`);

    const mid = await readCard(page, MID);
    if (!mid || mid.replying !== "Replying to @fake_alpha") fail(`${vp.name}: mid reply line "${mid && mid.replying}"`);
    if (!mid || mid.body !== "Thanks @fake_alpha for the mid text mention") fail(`${vp.name}: a mid-text mention must stay: "${mid && mid.body}"`);

    const two = await readCard(page, TWO);
    if (!two || two.replying !== "Replying to @fake_alpha and @fake_gamma") fail(`${vp.name}: two targets "${two && two.replying}"`);
    if (!two || two.body !== "Two targets body") fail(`${vp.name}: two targets body "${two && two.body}"`);

    const many = await readCard(page, MANY);
    if (!many || many.replying !== "Replying to @fake_delta @fake_eps and 2 others" || !many.others) fail(`${vp.name}: many targets "${many && many.replying}"`);
    if (!many || many.body !== "Many targets body with @fake_mid inside") fail(`${vp.name}: many targets body "${many && many.body}"`);

    const thread = await readCard(page, THREAD);
    if (!thread || !thread.inThread) fail(`${vp.name}: the threaded reply should sit under its parent`);
    else {
      if (thread.replyCount !== 0) fail(`${vp.name}: a reply right under its parent must not show "${thread.replying}"`);
      if (thread.body !== "Threaded reply under its parent") fail(`${vp.name}: threaded body "${thread.body}"`);
    }

    if (SHOTS) {
      const box = await page.evaluate((pid) => { const a = document.querySelector(`#app article[data-post="${pid}"]`); if (a) a.scrollIntoView({ block: "start" }); window.scrollBy(0, -170); return true; }, LEAD);
      await page.waitForTimeout(300);
      if (box) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-timeline.png`) });
    }

    if (many && many.others) {
      await page.click(`#app article[data-post="${MANY}"] [data-act='reply-others']`);
      await page.waitForTimeout(300);
      const list = await page.evaluate(() => Array.from(document.querySelectorAll(".reply-list-modal .handle")).map((n) => n.textContent.trim()));
      if (list.join(",") !== "@fake_delta,@fake_eps,@fake_zeta,@fake_eta") fail(`${vp.name}: "others" list shows ${list.join(",")}`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-others-list.png`) });
      await page.keyboard.press("Escape");
      await page.evaluate(() => { const b = document.querySelector(".reply-list-modal [data-act='close-modal']"); if (b) b.click(); });
    }

    await page.goto(`http://127.0.0.1:${port}/#/@fake_beta/status/${LEAD}`);
    await page.waitForSelector("article.status", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    const status = await page.evaluate(() => {
      const art = document.querySelector("article.status");
      if (!art) return null;
      const rep = art.querySelector(".replying");
      const text = art.querySelector(".status-text");
      const author = art.querySelector(".status-author");
      return {
        replying: rep ? rep.textContent.replace(/\s+/g, " ").trim() : "",
        body: text ? text.textContent.replace(/\s+/g, " ").trim() : "",
        above: rep && text ? rep.getBoundingClientRect().bottom <= text.getBoundingClientRect().top + 1 : false,
        afterAuthor: rep && author ? rep.getBoundingClientRect().top >= author.getBoundingClientRect().bottom - 1 : false
      };
    });
    if (!status) fail(`${vp.name}: status view did not render`);
    else {
      if (status.replying !== "Replying to @fake_alpha" || !status.above || !status.afterAuthor) fail(`${vp.name}: status view reply line "${status.replying}" must sit between author and text`);
      if (status.body !== "Leading mention body stays one line") fail(`${vp.name}: status body "${status.body}"`);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-status.png`) });

    await page.goto(`http://127.0.0.1:${port}/#/@fake_beta/status/${THREAD}`);
    await page.waitForSelector("article.status", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    const threaded = await page.evaluate(() => {
      const art = document.querySelector("article.status");
      return art ? { ancestors: document.querySelectorAll("article.ancestor").length, replying: art.querySelectorAll(".replying").length, body: (art.querySelector(".status-text") || {}).textContent || "" } : null;
    });
    if (!threaded || !threaded.ancestors) fail(`${vp.name}: thread status should show its parent above`);
    else if (threaded.replying) fail(`${vp.name}: thread status with the parent above must not show "Replying to"`);
    else if (threaded.body.replace(/\s+/g, " ").trim() !== "Threaded reply under its parent") fail(`${vp.name}: thread status body "${threaded.body}"`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-thread.png`) });
    console.log(`${vp.name}: checked`);
  } finally {
    await browser.close();
  }
}

function staticChecks() {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const app = read("app.js");
  if (!/function replyContextHtml\(/.test(app)) fail("app.js needs one replyContextHtml for every reply line");
  for (const lang of ["en", "es", "ru", "hi"]) {
    const pack = read(`i18n/${lang}.js`);
    for (const key of ["{a} and {b}", "{a} {b} and {c}", "{a} {b} and {others}", "reply.others.other"]) {
      if (pack.indexOf(JSON.stringify(key) + ":") < 0) fail(`i18n/${lang}.js is missing "${key}"`);
    }
  }
}

staticChecks();
const chromium = await loadChromium();
if (!chromium) {
  console.log("skip browser reply context (no playwright-core)");
} else {
  const server = await startServer();
  const port = server.address().port;
  try {
    for (const vp of [{ name: "phone", width: 412, height: 860, mobile: true }, { name: "desktop", width: 1280, height: 860, mobile: false }]) {
      await run(chromium, port, vp);
    }
  } finally {
    server.close();
  }
}
if (failures && LOOSE) process.exitCode = 0;
console.log(failures ? `reply context: ${failures} failure(s)` : "ok reply context matches X");
