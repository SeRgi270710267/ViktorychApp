/* X-style reply threads on the timeline. A reply shows its parent post
   right above it, joined by X's thread line, loaded live (fxtwitter, cached)
   when the catalog does not have it. A reply whose target is unknown is
   looked up first. A parent that cannot load falls back to "Replying to
   @handle". A parent that is also in the timeline is drawn once.
   Fake handles and ids only. SHOTS=/dir saves phone and desktop shots,
   SHOT_TAG=before|after names them, LOOSE=1 never fails (for "before"). */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";
const TAG = process.env.SHOT_TAG || "after";
const LOOSE = process.env.LOOSE === "1";
let failures = 0;
const lookups = [];

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


const P_LIVE = "910000000000000101";   // parent only reachable live
const R_LIVE = "910000000000000102";   // reply that names its parent id
const P_FIND = "910000000000000103";   // parent of a reply with no target
const R_FIND = "910000000000000104";   // known reply, target missing
const P_DEAD = "910000000000000105";   // parent lookup fails
const R_DEAD = "910000000000000106";
const P_HOME = "910000000000000107";   // parent also in the timeline
const R_HOME = "910000000000000108";
const P_CONV = "910000000000000109";
const R_CONV = "910000000000000110";   // only a conversation id says it is a reply
const PLAIN = "910000000000000111";

const FIXTURE = {
  updated: new Date(now).toISOString(),
  feeds: [feed("fake_ruby", "Fake Ruby"), feed("fake_home", "Fake Home")],
  posts: [
    post(R_LIVE, "fake_ruby", "Fake Ruby", 1, "Sí, seguro que vinculado con estas cuentas (fake reply one)", { handle: "fake_minister", name: "Fake Minister", id: P_LIVE }),
    post(R_FIND, "fake_ruby", "Fake Ruby", 2, "Este es el tipo de personas (fake reply two)", { handle: "", name: "", id: "" }),
    post(R_DEAD, "fake_ruby", "Fake Ruby", 3, "Reply whose parent cannot load", { handle: "fake_gone", name: "Fake Gone", id: P_DEAD }),
    post(R_HOME, "fake_ruby", "Fake Ruby", 4, "Reply to a post that is also on Home", { handle: "fake_home", name: "Fake Home", id: P_HOME }),
    Object.assign(post(R_CONV, "fake_ruby", "Fake Ruby", 5, "Reply known only by its conversation"), { conversationId: P_CONV }),
    post(PLAIN, "fake_ruby", "Fake Ruby", 6, "A plain post with no parent"),
    post(P_HOME, "fake_home", "Fake Home", 7, "Parent that is also in the timeline")
  ]
};

function fxStatus(id, handle, name, text, replying) {
  return {
    code: 200,
    message: "OK",
    status: {
      id: id, url: "https://x.com/" + handle + "/status/" + id, text: text,
      created_at: new Date(now - 30 * 60000).toUTCString(), created_timestamp: Math.floor((now - 30 * 60000) / 1000),
      author: { screen_name: handle, name: name, avatar_url: "" },
      replies: 4, reposts: 2, likes: 9, views: 120,
      replying_to: replying || null
    }
  };
}

const FX = {
  [P_LIVE]: fxStatus(P_LIVE, "fake_minister", "Fake Minister", "Parent post loaded live for reply one"),
  [R_FIND]: fxStatus(R_FIND, "fake_ruby", "Fake Ruby", "Este es el tipo de personas (fake reply two)", { screen_name: "fake_mayor", status: P_FIND }),
  [P_FIND]: fxStatus(P_FIND, "fake_mayor", "Fake Mayor", "Parent found after looking the reply up"),
  [R_CONV]: fxStatus(R_CONV, "fake_ruby", "Fake Ruby", "Reply known only by its conversation", { screen_name: "fake_judge", status: P_CONV }),
  [P_CONV]: fxStatus(P_CONV, "fake_judge", "Fake Judge", "Conversation root loaded live")
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

function readThread(page, replyId) {
  return page.evaluate((rid) => {
    const art = document.querySelector(`#app article[data-post="${rid}"]`);
    if (!art) return null;
    const thread = art.closest(".thread");
    const parent = thread ? thread.querySelector("article.post.continues") : null;
    const line = parent ? parent.querySelector(".thread-line") : null;
    const pAva = parent ? parent.querySelector(".ava-col img, .ava-col .avatar, .ava-col a") : null;
    const cAva = art.querySelector(".avatar, img.avatar, .post-row > a, .ava-col a");
    const lr = line ? line.getBoundingClientRect() : null;
    const ar = cAva ? cAva.getBoundingClientRect() : null;
    const rep = art.querySelector(".replying");
    const pText = parent ? parent.querySelector(".post-text") : null;
    return {
      inThread: !!thread,
      parentId: parent ? parent.getAttribute("data-post") : "",
      parentText: pText ? pText.textContent.replace(/\s+/g, " ").trim() : "",
      parentAbove: parent ? parent.getBoundingClientRect().bottom <= art.getBoundingClientRect().top + 1 : false,
      line: !!line && !!lr && lr.height > 4 && lr.width > 0 && lr.width <= 3,
      lineReaches: !!lr && !!ar && Math.abs(lr.bottom - ar.top) <= 16,
      replying: rep ? rep.textContent.replace(/\s+/g, " ").trim() : ""
    };
  }, replyId);
}

async function run(chromium, port, vp) {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || "chrome" });
  try {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1, serviceWorkers: "block", locale: "en-US" });
    await ctx.route(/^https?:\/\//, (route) => {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      if (/\/feeds\.json/.test(url)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) });
      const m = url.match(/^https:\/\/api\.fxtwitter\.com\/2\/status\/(\d+)/);
      if (m) {
        lookups.push(m[1]);
        if (FX[m[1]]) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(FX[m[1]]) });
        return route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
      }
      return route.abort();
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch (err) {} });
    await page.goto(`http://127.0.0.1:${port}/#/home`);
    await page.waitForSelector(`#app article[data-post="${R_LIVE}"]`, { timeout: 25000 }).catch(() => {});
    await page.waitForFunction((ids) => ids.every((id) => { const a = document.querySelector(`#app article[data-post="${id}"]`); return a && a.closest(".thread"); }), [R_LIVE, R_FIND, R_CONV], { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);

    const live = await readThread(page, R_LIVE);
    if (!live || !live.inThread || live.parentId !== P_LIVE) fail(`${vp.name}: a reply should show its live-loaded parent above it (got ${live && live.parentId})`);
    else {
      if (live.parentText !== "Parent post loaded live for reply one") fail(`${vp.name}: live parent text "${live.parentText}"`);
      if (!live.parentAbove) fail(`${vp.name}: the parent must sit above the reply`);
      if (!live.line) fail(`${vp.name}: X's thin thread line must join the parent to the reply`);
      if (!live.lineReaches) fail(`${vp.name}: the thread line should run down to the reply avatar`);
      if (live.replying) fail(`${vp.name}: no "Replying to" when the parent is shown above ("${live.replying}")`);
    }

    const found = await readThread(page, R_FIND);
    if (!found || !found.inThread || found.parentId !== P_FIND) fail(`${vp.name}: a reply with no target should be looked up and get its parent above (got ${found && found.parentId})`);

    const conv = await readThread(page, R_CONV);
    if (!conv || !conv.inThread || conv.parentId !== P_CONV) fail(`${vp.name}: a post in another conversation should get its parent above (got ${conv && conv.parentId})`);

    const dead = await readThread(page, R_DEAD);
    if (!dead || dead.inThread) fail(`${vp.name}: a reply whose parent fails should stay a single card`);
    else if (dead.replying !== "Replying to @fake_gone") fail(`${vp.name}: failed parent falls back to "Replying to @fake_gone", got "${dead.replying}"`);

    const home = await readThread(page, R_HOME);
    const homeCount = await page.evaluate((id) => document.querySelectorAll(`#app article[data-post="${id}"]`).length, P_HOME);
    if (!home || !home.inThread || home.parentId !== P_HOME) fail(`${vp.name}: the parent already on Home should sit above its reply`);
    if (homeCount !== 1) fail(`${vp.name}: a parent that is also on Home must show once, shows ${homeCount}`);

    const plain = await readThread(page, PLAIN);
    if (!plain || plain.inThread || plain.replying) fail(`${vp.name}: a plain post must stay a single card`);
    if (lookups.indexOf(PLAIN) >= 0) fail(`${vp.name}: a plain post must not be looked up`);

    if (SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-timeline.png`) });
      await page.evaluate((pid) => { const a = document.querySelector(`#app article[data-post="${pid}"]`); if (a) a.scrollIntoView({ block: "center" }); }, R_DEAD);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-timeline-2.png`) });
    }

    // Tapping the reply opens the thread with the parent above.
    await page.evaluate((rid) => { const a = document.querySelector(`#app article[data-post="${rid}"] .post-text`); if (a) a.click(); }, R_FIND);
    await page.waitForSelector("article.status", { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll("article.ancestor").length > 0, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const status = await page.evaluate(() => {
      const art = document.querySelector("article.status");
      const anc = document.querySelector("article.ancestor");
      return art ? { ancestors: document.querySelectorAll("article.ancestor").length, ancestorText: anc ? anc.textContent.replace(/\s+/g, " ") : "", body: (art.querySelector(".status-text") || {}).textContent || "" } : null;
    });
    if (!status) fail(`${vp.name}: tapping the reply should open it`);
    else if (!status.ancestors || status.ancestorText.indexOf("Parent found after looking the reply up") < 0) fail(`${vp.name}: the opened reply should show its parent above`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${vp.name}-status.png`) });
    console.log(`${vp.name}: checked`);
  } finally {
    await browser.close();
  }
}

const chromium = await loadChromium();
if (!chromium) {
  console.log("skip browser reply parent (no playwright-core)");
} else {
  const server = await startServer();
  const port = server.address().port;
  try {
    for (const vp of [{ name: "phone", width: 412, height: 900, mobile: true }, { name: "desktop", width: 1280, height: 900, mobile: false }]) {
      await run(chromium, port, vp);
    }
  } finally {
    server.close();
  }
}
if (failures && LOOSE) process.exitCode = 0;
console.log(failures ? `reply parent: ${failures} failure(s)` : "ok reply parents show above replies like X");
