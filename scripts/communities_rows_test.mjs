/* Communities rows: Home lists only joined communities (Reddit, forums and
   NZlay alike) in the account's own order with its folders; Explore opens
   with every community, the owner's featured pins first with a badge; only
   the owner sees the pin controls. Placeholder data only. Spanish, phone. */
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

const SHOTS = process.env.FYCOMM_SHOTS || "";
const INDEX = { communities: [
  { name: "placeholder_sub", title: "Placeholder Sub", type: "reddit", icon: "https://example.com/a.png", subscribers: 900 },
  { name: "placeholder_forum", title: "Placeholder Forum", type: "discourse", icon: "", subscribers: 500 },
  { name: "placeholder_more", title: "Placeholder More", type: "reddit", icon: "", subscribers: 300 },
  { name: "placeholder_open", title: "Placeholder Open", type: "reddit", icon: "", subscribers: 9000 },
  { name: "placeholder_extra", title: "Placeholder Extra", type: "reddit", icon: "", subscribers: 50 }
] };
const JOINED = ["placeholder_sub", "placeholder_forum", "placeholder_more", "nzlay"];
const NZ = { topics: [] };

async function mock(page, opts) {
  const sent = [];
  let pins = opts.pins.slice();
  await page.route("https://example.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    const reply = (body, status) => route.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
    if (where === "/v1/posts") return reply({ posts: [], communitiesHome: true, communityPrefs: { joined: JOINED, hidden: [], all: false } });
    if (where === "/v1/communities/featured") return reply({ featured: pins, canEdit: opts.owner });
    if (where === "/v1/owner/communities/featured" && req.method() === "POST") {
      if (!opts.owner) return reply({ error: "forbidden" }, 403);
      const body = JSON.parse(req.postData() || "{}");
      sent.push(body.names);
      pins = body.names;
      return reply({ featured: pins });
    }
    const doc = where.match(/\/v1\/data\/(?:data\/)?communities\/([a-z_]+)\.json$/);
    if (doc) return reply(doc[1] === "index" ? INDEX : { name: doc[1], posts: [] });
    if (where === "/v1/nzlay/forum") return reply(NZ);
    return reply({ posts: [], ok: true });
  });
  return sent;
}

async function names(page, sel) {
  return page.$$eval(sel, (els) => els.map((el) => el.textContent.trim()));
}

async function shot(page, sel, file) {
  if (!SHOTS) return;
  await page.evaluate((s) => { const el = document.querySelector(s); window.scrollTo(0, 0); if (el && el.getBoundingClientRect().bottom > innerHeight) el.scrollIntoView({ block: "center" }); document.querySelectorAll(".cm-covers").forEach((row) => { row.scrollLeft = 0; }); }, sel);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, file) });
}

async function member(browser, origin) {
  const page = await open(browser, origin, false);
  const sent = await mock(page, { owner: false, pins: ["placeholder_more"] });
  await page.goto(origin + "/#/communities", { waitUntil: "domcontentloaded" });
  const row = await page.waitForFunction(() => {
    const list = Array.from(document.querySelectorAll(".cm-joined-row .cm-cover")).map((el) => el.textContent.trim());
    return list.length >= 4 ? list : null;
  }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
  if (!row) fail("Home row is missing joined communities: " + (await names(page, ".cm-joined-row .cm-cover")).join(","));
  for (const want of ["r/placeholder_sub", "Placeholder Forum", "r/placeholder_more"]) if (row.indexOf(want) < 0) fail("Home row lacks " + want + ": " + row.join(","));
  if (!row.some((t) => /NZlay/i.test(t))) fail("Home row lacks NZlay: " + row.join(","));
  if (row.some((t) => /placeholder_open|placeholder_extra/.test(t))) fail("Home row shows a community that was not joined: " + row.join(","));
  /* communities.css can land after the first render on a busy runner, so wait for the row style. */
  const scroll = await page.waitForFunction(() => {
    const el = document.querySelector(".cm-joined-row");
    const x = el && getComputedStyle(el).overflowX;
    return x === "auto" || x === "scroll" ? x : null;
  }, null, { timeout: 20000 }).then((h) => h.jsonValue(), async () => page.$eval(".cm-joined-row", (el) => getComputedStyle(el).overflowX).catch(() => "missing"));
  if (scroll !== "auto" && scroll !== "scroll") fail("Home row does not scroll sideways: " + scroll);
  await shot(page, ".cm-joined-row", "inicio-joined-row-es-phone.png");

  // The arrow opens the full joined list; a new folder takes two communities.
  await page.click(".cm-joined-row .cm-see-all");
  await page.waitForSelector(".cm-panel-head");
  const head = (await page.textContent(".cm-panel-head h2")).trim();
  if (head !== "Tus comunidades" && !/comunidades/i.test(head)) fail("joined list is not in Spanish: " + head);
  await page.click('[data-cm="folder-new"]');
  await page.fill(".cm-folder-form input", "Noticias");
  await page.click('.cm-folder-form button[type="submit"]');
  await page.waitForSelector(".cm-folder-section");
  await page.selectOption('select[data-cm="move-folder"][data-sub="placeholder_sub"]', { label: "Noticias" });
  await page.waitForTimeout(150);
  await page.selectOption('select[data-cm="move-folder"][data-sub="placeholder_forum"]', { label: "Noticias" });
  await page.waitForTimeout(150);
  const inside = await names(page, '.cm-folder-section .cm-folder-items .cm-pick');
  if (inside.length !== 2) fail("folder should hold two communities: " + inside.join(","));
  await shot(page, ".cm-panel-head", "inicio-joined-list-folders-es-phone.png");
  // Collapsible section.
  await page.click('[data-cm="folder-toggle"]');
  if (await page.$(".cm-folder-section .cm-folder-items")) fail("folder section did not collapse");
  await page.click('[data-cm="folder-toggle"]');
  await page.click('[data-cm="panel-back"]');

  // The folder tile sits in the row at the same size as a community tile.
  await page.waitForSelector(".cm-joined-row .cm-folder");
  const sizes = await page.evaluate(() => {
    const f = document.querySelector(".cm-joined-row .cm-folder").getBoundingClientRect();
    const c = document.querySelector(".cm-joined-row a.cm-cover").getBoundingClientRect();
    const minis = document.querySelectorAll(".cm-joined-row .cm-folder .cm-folder-mini").length;
    return { fw: f.width, fh: f.height, cw: c.width, ch: c.height, minis, rowH: document.querySelector(".cm-joined-row").getBoundingClientRect().height };
  });
  if (Math.abs(sizes.fw - sizes.cw) > 1 || Math.abs(sizes.fh - sizes.ch) > 1) fail("folder tile size differs from a community tile: " + JSON.stringify(sizes));
  if (sizes.minis !== 4) fail("folder tile needs a 2x2 grid: " + JSON.stringify(sizes));
  const loose = await names(page, ".cm-joined-row a.cm-cover");
  if (loose.some((t) => t === "r/placeholder_sub" || t === "Placeholder Forum")) fail("communities in a folder still show loose: " + loose.join(","));
  await shot(page, ".cm-joined-row", "inicio-folder-tile-es-phone.png");
  await page.click(".cm-joined-row .cm-folder");
  await page.waitForSelector(".cm-panel-head");
  const opened = await names(page, ".cm-folder-items .cm-pick");
  if (opened.length !== 2 || (await page.textContent(".cm-panel-head h2")).trim() !== "Noticias") fail("opened folder is wrong: " + opened.join(","));
  await shot(page, ".cm-panel-head", "inicio-folder-open-es-phone.png");
  // Rename keeps the folder; it is saved privately for this account.
  await page.click('.cm-panel-head [data-cm="folder-rename"]');
  await page.fill(".cm-folder-form input", "Lecturas");
  await page.click('.cm-folder-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector(".cm-panel-head h2") && document.querySelector(".cm-panel-head h2").textContent.trim() === "Lecturas");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("va_cm_folders") || "null"));
  if (!saved || saved.folders.length !== 1 || saved.folders[0].name !== "Lecturas" || saved.folders[0].items.length !== 2) fail("folders are not kept: " + JSON.stringify(saved));
  await page.click('[data-cm="panel-back"]');

  // Explore opens with every community, the featured pin first with its badge, and no pin controls.
  await page.click('[data-cm="hub-tab"][data-hub="explore"]');
  await page.waitForSelector(".cm-all-row .cm-cover");
  const all = await names(page, ".cm-all-row .cm-cover .cm-cover-name");
  if (all[0] !== "r/placeholder_more") fail("featured community is not first on Explore: " + all.join(","));
  for (const want of ["r/placeholder_open", "r/placeholder_extra", "r/placeholder_sub"]) if (all.indexOf(want) < 0) fail("Explore row lacks " + want);
  const badge = (await page.textContent(".cm-all-row .cm-cover .cm-featured-badge")).trim();
  if (badge !== "Destacada") fail("featured badge is not 'Destacada': " + badge);
  await shot(page, ".cm-all-row", "explorar-all-row-es-phone.png");
  await page.click(".cm-all-row .cm-see-all");
  await page.waitForSelector(".cm-panel-head");
  if (await page.$('[data-cm="pin-toggle"]')) fail("a member sees the pin controls");
  if (sent.length) fail("a member wrote pins");

  // Delete the folder: its communities go back to the row.
  await page.click('[data-cm="panel-back"]');
  await page.click('[data-cm="hub-tab"][data-hub="home"]');
  await page.click(".cm-joined-row .cm-see-all");
  page.once("dialog", (d) => d.accept());
  await page.click('.cm-folder-bar [data-cm="folder-delete"]');
  await page.waitForFunction(() => !document.querySelector(".cm-folder-section"));
  await page.click('[data-cm="panel-back"]');
  const back = await names(page, ".cm-joined-row a.cm-cover");
  if (back.indexOf("r/placeholder_sub") < 0) fail("deleting a folder lost its communities: " + back.join(","));
  await page.close();
}

async function ownerRun(browser, origin) {
  const page = await open(browser, origin, true);
  const sent = await mock(page, { owner: true, pins: ["placeholder_more"] });
  await page.goto(origin + "/#/communities", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-cm="hub-tab"][data-hub="explore"]');
  await page.click('[data-cm="hub-tab"][data-hub="explore"]');
  await page.waitForSelector(".cm-all-row .cm-featured-badge");
  await page.click(".cm-all-row .cm-see-all");
  await page.waitForSelector('[data-cm="pin-toggle"]');
  await page.click('[data-cm="pin-toggle"][data-sub="placeholder_open"]');
  await page.waitForFunction(() => document.querySelector('[data-cm="pin-toggle"][data-sub="placeholder_open"].on'));
  await page.click('[data-cm="pin-up"][data-sub="placeholder_open"]');
  await page.waitForTimeout(300);
  const last = sent[sent.length - 1] || [];
  if (JSON.stringify(sent[0]) !== JSON.stringify(["placeholder_more", "placeholder_open"]) || JSON.stringify(last) !== JSON.stringify(["placeholder_open", "placeholder_more"])) fail("owner pin order not saved: " + JSON.stringify(sent));
  const first = (await names(page, ".cm-panel-body .cm-line .cm-pick > span:not(.cm-folder-mini)"))[0];
  if (first !== "r/placeholder_open") fail("reordered pin is not first: " + first);
  await shot(page, ".cm-panel-head", "explorar-owner-pins-es-phone.png");
  await page.click('[data-cm="pin-toggle"][data-sub="placeholder_more"]');
  await page.waitForTimeout(300);
  if (JSON.stringify(sent[sent.length - 1]) !== JSON.stringify(["placeholder_open"])) fail("unpin not saved: " + JSON.stringify(sent));
  await page.click('[data-cm="panel-back"]');
  await page.waitForSelector(".cm-all-row");
  await shot(page, ".cm-all-row", "explorar-all-row-owner-es-phone.png");
  await page.close();
}

async function open(browser, origin, isOwner) {
  const page = await browser.newPage({ serviceWorkers: "block" });
  await page.addInitScript((own) => {
    localStorage.setItem("superintelapp-lang", "es");
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({
      token: "local-test-token",
      account: { publicId: "100000000001", handle: "user_a", displayName: "User A", avatar: "", owner: own }
    }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true };
  }, isOwner);
  await page.setViewportSize({ width: 390, height: 844 });
  return page;
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    await member(browser, origin);
    await ownerRun(browser, origin);
    console.log("communities rows ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.stack || err);
});
