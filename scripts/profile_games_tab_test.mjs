/* Profile > Games tab in a real browser with a stubbed Worker. Every name
   and id here is made up. Checks: the header carries no ReGone bits, the
   Games tab sits in the X tab bar, the ReGone card, own Link/Unlink rows,
   the calm empty state for others, the #/@name/games deep link, and the tab
   hiding when every game flag is off. SHOTS=<dir> saves screenshots. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";
function fail(message) { console.error("FAIL: " + message); process.exitCode = 1; throw new Error(message); }
function mime(f) {
  if (f.endsWith(".js") || f.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (f.endsWith(".css")) return "text/css; charset=utf-8";
  if (f.endsWith(".html")) return "text/html; charset=utf-8";
  if (f.endsWith(".json")) return "application/json; charset=utf-8";
  if (f.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
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
async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  return mod.chromium || (mod.default && mod.default.chromium);
}

const ME = "100000000001";
const OTHER = "100000000002";
const acct = (id, handle, name) => ({ publicId: id, handle, displayName: name, bio: "Sample bio.", avatar: "", repostsLoaded: true });
const ACH = { gameId: "regone", achievements: [{ id: "first_play", earnedAt: Date.now() - 86400000, seen: true }], totalMs: 7200000, bestStreak: 6, linkedName: "Synthetic Player 7", claimed: true, rank: { rank: 7, kills: 3200, kdr: "2.40", deaths: 1620, total: 6500 } };
const NONE = { gameId: "regone", achievements: [], totalMs: 0, bestStreak: 0, linkedName: "", claimed: false, rank: null };
const PSTATS = { ok: true, linked: true, claimed: true, name: "Synthetic Player 7", stats: { favouriteWeapon: "rifle", headshotRate: 26.9, multiKills: 12, matchesWon: 14 }, fetchedAt: Date.now(), achievements: [] };

async function open(browser, origin, size, opts) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.mobile, hasTouch: !!size.mobile, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const posts = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.route((url) => !String(url).startsWith(origin), (route) => route.fulfill({ status: 204, body: "" }));
  const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(origin + "/v1/**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const other = url.searchParams.get("id") === OTHER;
    if (req.method() !== "GET") { let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch (err) { b = {}; } posts.push({ path: p, body: b }); }
    if (p === "/v1/profile/user_1") return json(route, { account: acct(ME, "user_1", "Test Owner"), reposts: [] });
    if (p === "/v1/profile/user_2") return json(route, { account: acct(OTHER, "user_2", "Sample Friend"), reposts: [] });
    if (p === "/v1/games/achievements") return json(route, other && opts.otherUnlinked ? NONE : ACH);
    if (p === "/v1/games/regone/profile-stats") return json(route, other && opts.otherUnlinked ? { ok: false, linked: false } : PSTATS);
    if (p === "/v1/games/presence") return json(route, opts.otherUnlinked ? { playing: false } : { playing: true, gameId: "regone", room: "Sample Room" });
    if (p === "/v1/games/together") return json(route, { people: [] });
    if (p === "/v1/games/link-name") return json(route, { ok: true });
    return json(route, {}, 404);
  });
  await page.addInitScript((args) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true }));
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: args.me, handle: "user_1", displayName: "Test Owner", avatar: "", repostsLoaded: true } }));
    if (args.off) { localStorage.setItem("viktorychapp-server-off", JSON.stringify(args.off)); localStorage.setItem("viktorychapp-server-off-at", String(Date.now())); }
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true };
  }, { me: ME, off: opts.off || null });
  return { context, page, errors, posts };
}
const tabIds = (page) => page.evaluate(() => [...document.querySelectorAll(".ptabs [data-ptab-id]")].map((el) => el.getAttribute("data-ptab-id")));
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") }); }

async function run(browser, origin, size) {
  const label = size.name;
  /* Another person's profile: no ReGone in the header, Games tab next to Media. */
  let s = await open(browser, origin, size, {});
  await s.page.goto(origin + "/index.html#/@user_2", { waitUntil: "domcontentloaded" });
  await s.page.waitForSelector(".ptabs [data-ptab-id='games']", { timeout: 20000 }).catch(() => fail(label + ": no Games tab"));
  const ids = await tabIds(s.page);
  if (ids.indexOf("games") !== ids.indexOf("media") + 1) fail(label + ": Games is not next to Media " + ids.join());
  const head = await s.page.evaluate(() => {
    const info = document.querySelector(".pinfo");
    return { gs: info ? info.querySelectorAll("[class*='gs-'], [data-gs-invite], [data-gs-link-name]").length : -1, text: info ? info.textContent : "" };
  });
  if (head.gs !== 0 || /ReGone|Invite to play/.test(head.text)) fail(label + ": ReGone bits are still in the header " + head.gs);
  await s.page.click(".ptabs [data-ptab-id='games']");
  await s.page.waitForSelector(".gs-ptab .gs-card .gs-grid", { timeout: 10000 }).catch(() => fail(label + ": no ReGone card"));
  const card = await s.page.textContent(".gs-ptab .gs-card");
  if (!/#7/.test(card) || !/Top 100/.test(card) || !/rifle/.test(card)) fail(label + ": card " + card);
  await s.page.waitForSelector(".gs-ptab .gs-live", { timeout: 8000 }).catch(() => fail(label + ": no Playing now"));
  if (!await s.page.$(".gs-ptab [data-gs-invite]")) fail(label + ": no Invite to play in the tab");
  if (await s.page.$(".gs-ptab [data-gs-link-name]")) fail(label + ": a visitor sees Link ReGone");
  const tabBar = await s.page.evaluate(() => { const bar = document.querySelector(".ptabs"); const on = bar.querySelector(".tab.on"); return { id: on && on.getAttribute("data-ptab-id"), wide: document.scrollingElement.scrollWidth > innerWidth + 1 }; });
  if (tabBar.id !== "games") fail(label + ": Games tab is not active");
  if (tabBar.wide) fail(label + ": the page scrolls sideways");
  await shot(s.page, label + "-other-games");
  if (s.errors.length) fail(label + ": " + s.errors[0]);
  await s.context.close();

  /* Another person with no link: the calm empty state, via the path deep link. */
  s = await open(browser, origin, size, { otherUnlinked: true });
  await s.page.goto(origin + "/index.html#/@user_2/games", { waitUntil: "domcontentloaded" });
  await s.page.waitForSelector(".gs-ptab-empty", { timeout: 20000 }).catch(() => fail(label + ": no empty state from #/@name/games"));
  await shot(s.page, label + "-other-empty");
  await s.context.close();

  /* Own profile: card plus Change / Unlink rows; Unlink sends an empty name. */
  s = await open(browser, origin, size, {});
  await s.page.goto(origin + "/index.html#/@user_1?tab=games", { waitUntil: "domcontentloaded" });
  await s.page.waitForSelector(".gs-ptab [data-gs-unlink]", { timeout: 20000 }).catch(() => fail(label + ": no Unlink row"));
  if (!await s.page.$(".gs-ptab [data-gs-link-name]")) fail(label + ": no Change ReGone name row");
  if (await s.page.$(".pinfo [data-gs-link-name], .pinfo .gs-card")) fail(label + ": own header still has ReGone");
  await shot(s.page, label + "-own-games");
  s.page.on("dialog", (d) => d.accept());
  await s.page.click(".gs-ptab [data-gs-unlink]");
  await s.page.waitForTimeout(400);
  const unlink = s.posts.filter((x) => x.path === "/v1/games/link-name").pop();
  if (!unlink || unlink.body.name !== "") fail(label + ": unlink " + JSON.stringify(unlink));
  if (s.errors.length) fail(label + ": " + s.errors[0]);
  await s.context.close();

  /* Every game flag off: the tab hides. */
  s = await open(browser, origin, size, { off: ["regone_leaderboard", "regone_profile_stats", "regone_online", "regone_rooms"] });
  await s.page.goto(origin + "/index.html#/@user_2", { waitUntil: "domcontentloaded" });
  await s.page.waitForSelector(".ptabs [data-ptab-id='posts']", { timeout: 20000 });
  await s.page.waitForTimeout(500);
  if ((await tabIds(s.page)).includes("games")) fail(label + ": Games tab shows with every game flag off");
  await s.context.close();
  console.log("profile games tab ok " + label);
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    await run(browser, origin, { name: "desktop", width: 1280, height: 860 });
    await run(browser, origin, { name: "phone", width: 390, height: 844, mobile: true });
    console.log("profile games tab ok");
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((err) => { console.error(err && err.message ? err.message : err); process.exitCode = 1; });
