/* For you mixes recent posts from joined mirrored communities (a Reddit-style
   mirror, a forum mirror and the NZlay forum feed) at most one in four, each
   under the community line, with the title as its own bold line above the
   body and a Show more on long bodies. Placeholder data only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 390, height: 844, name: "phone" },
  { width: 1280, height: 800, name: "desktop" }
];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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



const ME = "100000000001";
const now = Date.now();
const SHOTS = process.env.FYCOMM_SHOTS || "";
const LONG = "Placeholder body sentence for a long forum post. ".repeat(12).trim();
const FEED = Array.from({ length: 12 }, (_, i) => ({
  id: String.fromCharCode(97 + i).repeat(32), body: "Home post number " + (i + 1), createdAt: now - (i + 1) * 60000,
  authorId: "10000000000" + (i % 9 + 2), authorName: "User " + (i + 1), authorHandle: "user_" + (i + 1), media: []
}));
const INDEX = { communities: [
  { name: "placeholder_sub", title: "Placeholder Sub", type: "reddit", icon: "" },
  { name: "placeholder_forum", title: "Placeholder Forum", type: "discourse", icon: "" },
  { name: "placeholder_muted", title: "Muted Place", type: "reddit", icon: "" }
] };
const sec = (ms) => Math.floor(ms / 1000);
const DOCS = {
  placeholder_sub: { name: "placeholder_sub", title: "Placeholder Sub", posts: [
    { id: "t3_aaa001", title: "Sub title one", text: "Sub body one", author: "poster_one", score: 420, comments: 37, created: sec(now - 3600000), url: "https://example.com/sub/1", media: [{ type: "photo", url: "https://example.com/full.png" }] },
    { id: "t3_aaa002", title: "Sub title two", text: "", author: "poster_two", score: 12, comments: 1, created: sec(now - 7200000), media: [] },
    { id: "t3_old", title: "Too old", text: "old", author: "poster_old", score: 9000, comments: 900, created: sec(now - 40 * 86400000), media: [] }
  ] },
  placeholder_forum: { name: "placeholder_forum", title: "Placeholder Forum", type: "discourse", posts: [
    { id: "f-101", title: "Forum topic title", text: LONG, author: "forum_member", score: 5, comments: 9, created: sec(now - 5400000), url: "https://example.com/t/101", media: [] }
  ] },
  placeholder_muted: { name: "placeholder_muted", title: "Muted Place", posts: [
    { id: "t3_mute1", title: "Should not show", text: "muted", author: "poster_m", score: 1, comments: 0, created: sec(now - 600000), media: [] }
  ] }
};
const NZ = { ok: true, fetchedAt: new Date(now).toISOString(), forum: "https://example.com/forum", categories: [], more: false, topics: [
  { id: "9001", slug: "x", title: "Placeholder forum thread", categoryId: "1", sticky: false, views: 120, replies: 4, lastAt: new Date(now - 1800000).toISOString(), lastPostId: "1", lastBy: { name: "Member A" },
    starter: { id: "1", author: { name: "Member A", avatar: "", role: "", posts: 3 }, moderator: false, at: new Date(now - 1800000).toISOString(), text: "Thread body text", media: [], links: [], edited: false }, url: "https://example.com/forum/topic/9001" }
] };

async function exercise(page, vp, origin) {
  const asked = [];
  await page.route("https://example.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    if (process.env.FYCOMM_DEBUG) console.log("req", req.method(), req.url());
    if (where === "/v1/posts") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ posts: FEED, communitiesHome: true, communityPrefs: { joined: ["placeholder_sub", "placeholder_forum", "placeholder_muted", "nzlay"], hidden: ["placeholder_muted"], all: false } }) });
      return;
    }
    const doc = where.match(/\/v1\/data\/(?:data\/)?communities\/([a-z_]+)\.json$/);
    if (doc) {
      asked.push(doc[1]);
      const body = doc[1] === "index" ? INDEX : DOCS[doc[1]];
      await route.fulfill({ status: body ? 200 : 404, contentType: "application/json", body: JSON.stringify(body || {}) });
      return;
    }
    if (where === "/v1/nzlay/forum") {
      asked.push("nzlay");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NZ) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"posts":[],"ok":true}' });
  });
  // The NZlay community page draws the same title line over the body.
  await page.goto(origin + "/#/communities/nzlay", { waitUntil: "domcontentloaded" });
  const topic = await page.waitForFunction(() => {
    const t = document.querySelector(".nzf-post .nzf-title");
    const b = document.querySelector(".nzf-post .nzf-text");
    if (!t || !b) return null;
    return { block: getComputedStyle(t).display, size: getComputedStyle(t).fontSize, weight: getComputedStyle(t).fontWeight, apart: !t.contains(b) && !b.contains(t), gap: b.getBoundingClientRect().top - t.getBoundingClientRect().bottom };
  }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
  if (!topic) await page.screenshot({ path: "/tmp/fyc-nz-" + vp.name + ".png" });
  if (!topic || topic.block !== "block" || topic.size !== "15px" || Number(topic.weight) < 700 || !topic.apart || topic.gap < 1) fail(vp.name + " the NZlay topic title is not its own line: " + JSON.stringify(topic));
  if (SHOTS) {
    const box = await page.evaluate(() => { const el = document.querySelector(".nzf-post"); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    await page.screenshot({ path: path.join(SHOTS, "nzlay-community-card-" + vp.name + ".png"), clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, vp.width), height: Math.min(box.height, vp.height) } });
  }
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForFunction(() => document.querySelectorAll('article.post[data-post^="cm:"]').length >= 3, null, { timeout: 25000 }).catch(() => {});
  const list = await page.evaluate(() => Array.from(document.querySelectorAll("#app article.post, main article.post, article.post")).filter((el) => !el.closest(".quote")).map((el) => ({
    id: el.getAttribute("data-post"),
    line: (el.querySelector(".community-line") || {}).textContent || "",
    lineHref: (el.querySelector(".community-line a") || {}).getAttribute ? el.querySelector(".community-line a") && el.querySelector(".community-line a").getAttribute("href") : "",
    open: el.getAttribute("data-open") || "",
    title: (el.querySelector(".post-title") || {}).textContent || "",
    titleBeforeText: !!el.querySelector(".post-title + .post-text, .post-title + div .post-text"),
    text: (el.querySelector(".post-text") || {}).textContent || "",
    more: !!el.querySelector(".post-text .show-more[data-act='more'], .show-more[data-act='more']"),
    img: (el.querySelector(".media img") || {}).src || ""
  })));
  const cm = list.filter((item) => String(item.id).indexOf("cm:") === 0);
  if (cm.length < 3) fail(vp.name + " For you shows " + cm.length + " community posts (want 3+): " + list.map((i) => i.id).join(",") + " asked " + asked.join(","));
  if (cm.some((item) => item.id.indexOf("placeholder_muted") >= 0)) fail(vp.name + " a muted community reached For you");
  if (cm.some((item) => item.id.indexOf("t3_old") >= 0)) fail(vp.name + " an old community post reached For you");
  cm.forEach((item) => {
    if (!item.line.trim()) fail(vp.name + " " + item.id + " has no community line");
    if (!/^#\/communities\//.test(item.open)) fail(vp.name + " " + item.id + " does not open in the app: " + item.open);
    if (!item.title.trim()) fail(vp.name + " " + item.id + " has no title line");
    if (item.text.indexOf(item.title) === 0 && item.title) fail(vp.name + " " + item.id + " runs the title into the body");
  });
  const sub = cm.find((item) => item.id === "cm:placeholder_sub:t3_aaa001");
  if (!sub || sub.line.indexOf("r/placeholder_sub") < 0) fail(vp.name + " the Reddit-style post lacks its r/ line");
  if (sub.img !== "https://example.com/full.png") fail(vp.name + " community media is not hotlinked at the original URL: " + sub.img);
  const forum = cm.find((item) => item.id === "cm:placeholder_forum:f-101");
  if (!forum || forum.line.indexOf("Placeholder Forum") < 0) fail(vp.name + " the forum post lacks its forum line");
  if (!forum.more) fail(vp.name + " the long forum body has no Show more");
  if (!forum.titleBeforeText) fail(vp.name + " the forum title is not its own line above the body");
  const nz = cm.find((item) => item.id === "cm:nzlay:9001");
  if (!nz || nz.open !== "#/communities/nzlay/9001") fail(vp.name + " the NZlay thread is missing or opens elsewhere");
  // The cap: never two community posts within any four consecutive cards.
  const ids = list.map((item) => String(item.id).indexOf("cm:") === 0);
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] && ids.slice(Math.max(0, i - 3), i).some(Boolean)) fail(vp.name + " community posts are closer than one in four: " + list.map((x) => x.id).join(","));
  }
  if (!ids.slice(0, 3).every((on) => !on)) fail(vp.name + " a community post leads For you");
  const style = await page.evaluate(() => {
    const t = document.querySelector('article.post[data-post="cm:placeholder_forum:f-101"] .post-title');
    const b = document.querySelector('article.post[data-post="cm:placeholder_forum:f-101"] .post-text');
    if (!t || !b) return null;
    const ts = getComputedStyle(t), bs = getComputedStyle(b);
    const gap = b.getBoundingClientRect().top - t.getBoundingClientRect().bottom;
    return { size: ts.fontSize, weight: ts.fontWeight, sameFont: ts.fontFamily === bs.fontFamily, block: ts.display, gap: gap };
  });
  if (!style || style.size !== "15px" || Number(style.weight) < 700 || !style.sameFont || style.block !== "block" || style.gap < 1 || style.gap > 10) fail(vp.name + " the title line is not X-style: " + JSON.stringify(style));
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const shot = async (sel, file) => {
      await page.evaluate((q) => { const el = document.querySelector(q); if (el) el.scrollIntoView({ block: "center" }); }, sel);
      await page.waitForTimeout(500);
      const box = await page.evaluate((q) => { const el = document.querySelector(q); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, sel);
      if (!box || box.height < 20) fail(vp.name + " could not capture " + file);
      await page.screenshot({ path: path.join(SHOTS, file), clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, vp.width), height: Math.min(box.height, vp.height) } });
    };
    await page.waitForTimeout(1200);
    await shot('article.post[data-post="cm:placeholder_forum:f-101"]', "forum-card-" + vp.name + ".png");
    await shot('article.post[data-post="cm:placeholder_sub:t3_aaa001"]', "reddit-card-" + vp.name + ".png");
    await shot('article.post[data-post="cm:nzlay:9001"]', "nzlay-card-" + vp.name + ".png");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, "foryou-" + vp.name + ".png") });
  }
  // Leaving Home and coming back reads the device copy: no new community requests.
  const before = asked.length;
  await page.evaluate(() => { location.hash = "#/explore"; });
  await page.waitForTimeout(600);
  await page.evaluate(() => { location.hash = "#/"; });
  const back = await page.waitForFunction(() => document.querySelectorAll('article.post[data-post^="cm:"]').length >= 3, null, { timeout: 20000 }).then(() => true, () => false);
  if (!back) fail(vp.name + " community posts did not come back on Home");
  await page.waitForTimeout(800);
  if (asked.length !== before) fail(vp.name + " community docs were fetched again inside their cache time: " + asked.slice(before).join(","));
  const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("viktorychapp-foryou-communities-v1") || "null"); } catch (err) { return null; } });
  if (!saved || !saved.docs || !saved.docs.placeholder_forum || !saved.docs.nzlay) fail(vp.name + " community docs are not kept on the device");
  // The Communities Home row lists every joined community (the joined list
  // from /v1/posts), not only the ones whose page was opened; never unjoined ones.
  await page.evaluate(() => { location.hash = "#/communities"; });
  const covers = await page.waitForFunction(() => {
    const names = Array.from(document.querySelectorAll(".cm-covers .cm-cover")).map((el) => el.textContent.trim());
    return names.length >= 3 ? names : null;
  }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
  if (!covers) fail(vp.name + " the joined communities row is short: " + await page.evaluate(() => JSON.stringify(window.ViktorychCommunityPrefs && window.ViktorychCommunityPrefs()) + " mine=" + JSON.stringify(window.ViktorychCommunities.mine()) + " " + Array.from(document.querySelectorAll(".cm-covers .cm-cover")).map((el) => el.textContent.trim()).join(",")));
  ["r/placeholder_sub", "Placeholder Forum", "NZlay Forums"].forEach((want) => { if (covers.indexOf(want) < 0) fail(vp.name + " the joined row misses " + want + ": " + covers.join(",")); });
  if (covers.some((name) => /Muted Place|teslamotors|grapheneos/i.test(name))) fail(vp.name + " the joined row lists a community that is not joined or is hidden: " + covers.join(","));
  if (SHOTS) {
    const box = await page.evaluate(() => { const el = document.querySelector(".cm-covers"); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    await page.screenshot({ path: path.join(SHOTS, "communities-joined-row-" + vp.name + ".png"), clip: { x: 0, y: 0, width: vp.width, height: Math.min(vp.height, box.y + box.height + 8) } });
  }
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForFunction(() => document.querySelectorAll('article.post[data-post^="cm:"]').length >= 3, null, { timeout: 20000 });
  // Mute community from the post menu drops it from For you.
  await page.click('article.post[data-post="cm:placeholder_sub:t3_aaa001"] .more-btn');
  await page.click('article.post[data-post="cm:placeholder_sub:t3_aaa001"] .menu [data-act="mute-community"]');
  await page.waitForFunction(() => !document.querySelector('article.post[data-post^="cm:placeholder_sub:"]'), null, { timeout: 5000 }).catch(() => fail(vp.name + " Mute community left the community on For you"));
  await page.unroute("**/v1/**");
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) {
      const page = await browser.newPage({ serviceWorkers: "block" });
      await page.addInitScript((lang) => {
        if (lang) localStorage.setItem("superintelapp-lang", lang);
        localStorage.setItem("viktorychapp-lang-user-picked", "1");
        localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
        localStorage.setItem("viktorychapp-account-v1", JSON.stringify({
          token: "local-test-token",
          account: { publicId: "100000000001", handle: "user_a", displayName: "User A", avatar: "" }
        }));
        window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true };
      }, process.env.FYCOMM_LANG || "");
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await exercise(page, vp, origin);
      await page.close();
    }
    console.log("for you communities ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.stack || err);
});
