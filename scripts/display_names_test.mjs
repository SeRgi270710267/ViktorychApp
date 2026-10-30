/* Edit profile > Display names (Nombres), on phone and desktop: the row
   sits next to Usernames, the subpage lists every name with who sees it,
   edits an audience with show-to and hide-from rules, adds a name, makes
   one the main name, previews as an audience and as one person, and goes
   back to the same form. Placeholder accounts only. SHOTS=<dir> also saves
   screenshots. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fail(message) { console.error(message); process.exitCode = 1; throw new Error(message); }
function mime(file) {
  if (/\.m?js$/.test(file)) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
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

const SIZES = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false }
];
const ACCOUNT = { handle: "cedarhill", publicId: "100000000001", displayName: "Cedar Hill", bio: "Placeholder bio.", location: "Example Town", website: "example.com" };

function session(lang) {
  return `(() => {
    localStorage.setItem("superintelapp-lang", ${JSON.stringify(lang)});
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "token-a", account: ${JSON.stringify(ACCOUNT)} }));
    window.VIKTORYCH_ACCOUNTS = { api: "https://accounts.test", gate: true };
  })()`;
}


const SHOTS = process.env.SHOTS || "";
const OFF = () => ({ include: { public: false, followers: false, friends: false, lists: [], people: [] }, exclude: { followers: false, friends: false, lists: [], people: [] } });

function mock(page, log) {
  const main = OFF(); main.include.public = true;
  const close = OFF(); close.include.friends = true; close.exclude.people = ["oakridge"];
  const crew = OFF(); crew.include.lists = ["l1"];
  let state = { names: [
    { id: "main", name: "Cedar Hill", primary: true, audience: main },
    { id: "dn01", name: "Cedar Close", primary: false, audience: close },
    { id: "dn02", name: "Cedar Crew", primary: false, audience: crew }
  ], listOrder: ["l1"], cap: 5 };
  let account = Object.assign({}, ACCOUNT);
  const reply = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  return page.route("**/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let body = {};
    try { body = req.postDataJSON() || {}; } catch (err) { body = {}; }
    if (method !== "GET") log.push(method + " " + url.pathname + " " + JSON.stringify(body));
    if (url.pathname === "/v1/display-names" && method === "GET") return reply(route, 200, state);
    if (url.pathname === "/v1/display-names" && method === "POST") {
      const aud = OFF(); aud.include.friends = true;
      state = Object.assign({}, state, { names: state.names.concat([{ id: "dn03", name: body.name, primary: false, audience: aud }]) });
      return reply(route, 201, state);
    }
    if (url.pathname === "/v1/display-names" && method === "PATCH") {
      state = Object.assign({}, state, { names: state.names.map((n) => n.id === body.id ? Object.assign({}, n, { audience: Object.assign(OFF(), body.audience), name: body.name || n.name }) : n) });
      return reply(route, 200, state);
    }
    if (url.pathname === "/v1/display-names/primary") {
      const picked = state.names.find((n) => n.id === body.id);
      const old = state.names[0];
      state = Object.assign({}, state, { names: state.names.map((n) => n.id === "main" ? Object.assign({}, n, { name: picked.name, audience: picked.audience }) : n.id === body.id ? Object.assign({}, n, { name: old.name, audience: old.audience }) : n) });
      account = Object.assign({}, account, { displayName: picked.name });
      return reply(route, 200, state);
    }
    if (url.pathname === "/v1/display-names/preview") {
      const as = url.searchParams.get("as");
      if (as === "oakridge") return reply(route, 200, { as, name: "Cedar Hill", id: "main", hidden: false });
      if (as === "friends") return reply(route, 200, { as, name: "Cedar Close", id: "dn01", hidden: false });
      if (as === "nobody") return reply(route, 404, { error: "not_found" });
      return reply(route, 200, { as, name: "Cedar Hill", id: "main", hidden: false });
    }
    if (url.pathname === "/v1/usernames") return reply(route, 200, { names: [{ handle: "cedarhill", primary: true, audience: main }], listOrder: [], cap: 5, releaseDays: 30 });
    if (url.pathname === "/v1/audience-lists") return reply(route, 200, { lists: [{ id: "l1", name: "Crew", icon: "" }] });
    if (url.pathname === "/v1/usernames/mentions") return reply(route, 200, { public: "anyone", followers: "", friends: "", lists: {}, allow: [], block: [] });
    if (url.pathname === "/v1/nicknames") return reply(route, 200, { nicknames: [] });
    if (url.pathname === "/v1/about" && method === "GET") return reply(route, 200, { owner: true, visible: true, sections: [{ id: "personal", fields: [] }] });
    if (url.pathname === "/v1/profile" && method === "PATCH") { account = Object.assign({}, account, body); return reply(route, 200, { account }); }
    if (url.pathname.startsWith("/v1/profile/")) return reply(route, 200, { account, reposts: [] });
    return reply(route, 200, {});
  });
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}

async function check(browser, port, size, lang) {
  const label = lang + "@" + size.name;
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, serviceWorkers: "block" });
  const page = await context.newPage();
  const log = [];
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("dialog", (d) => d.accept());
  await mock(page, log);
  await page.addInitScript(session(lang));
  await page.goto("http://127.0.0.1:" + port + "/index.html#/@cedarhill", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[data-acct="edit"]', { timeout: 20000 }).catch(() => fail(label + ": no Edit profile button"));
  await page.click('button[data-acct="edit"]');
  await page.waitForSelector(".ep #acct-displayName", { timeout: 5000 }).catch(() => fail(label + ": Edit profile did not open"));

  /* The row sits right before Usernames. */
  const rows = await page.$$eval(".ep .ep-rows .ep-row", (els) => els.map((el) => (el.getAttribute("data-sub") || "") + ":" + el.querySelector("b").textContent));
  const want = { en: ["Display names", "Usernames"], es: ["Nombres", "Nombres de usuario"] }[lang];
  if (rows[0] !== "displaynames:" + want[0]) fail(label + ": rows " + rows);
  if ((rows[1] || "").indexOf("usernames:") !== 0) fail(label + ": usernames row moved " + rows);
  await page.fill("#acct-displayName", "Cedar Hill");
  await shot(page, lang + "-" + size.name + "-1-edit-profile");

  await page.click('.ep [data-acct="edit-sub"][data-sub="displaynames"]');
  await page.waitForSelector(".ep .dn-settings .dn-card", { timeout: 8000 }).catch(() => fail(label + ": display names subpage did not load"));
  const title = await page.textContent(".ep .acct-edit-head h1");
  if (title !== want[0]) fail(label + ": title " + title);
  const shown = await page.$$eval(".ep .dn-shown", (els) => els.map((el) => el.textContent));
  if (shown.join() !== "Cedar Hill,Cedar Close,Cedar Crew") fail(label + ": names " + shown);
  const who = await page.$$eval(".ep .dn-card .un-who", (els) => els.map((el) => el.textContent));
  if (who[2].indexOf("Crew") < 0) fail(label + ": list audience " + who);
  if (who[1].indexOf(lang === "es" ? "excepciones" : "exceptions") < 0) fail(label + ": hide-from summary " + who);
  const over = await page.evaluate(() => Array.from(document.querySelectorAll(".ep *")).filter((el) => { const b = el.getBoundingClientRect(); return b.width && b.right > window.innerWidth + 1; }).length);
  if (over) fail(label + ": " + over + " elements overflow");
  await shot(page, lang + "-" + size.name + "-2-display-names");

  /* Open "Cedar Close": show to followers too, hide from one more person. */
  await page.click('.ep [data-dn="toggle"][data-id="dn01"]');
  await page.waitForSelector('.ep .dn-edit[data-dn-id="dn01"]');
  const hide = await page.inputValue('.ep .dn-edit [data-dn-side="exc"]');
  if (hide !== "@oakridge") fail(label + ": hide-from " + hide);
  await page.check('.ep .dn-edit [data-dn-inc="followers"]');
  await page.fill('.ep .dn-edit [data-dn-side="exc"]', "@oakridge, @elmstreet");
  await shot(page, lang + "-" + size.name + "-3-audience");
  await page.click('.ep [data-dn="save"][data-id="dn01"]');
  await page.waitForFunction(() => document.querySelectorAll(".ep .dn-card .un-who")[1].textContent.length > 0);
  const patch = log.find((line) => line.indexOf("PATCH /v1/display-names ") === 0);
  if (!patch) fail(label + ": no PATCH");
  const sent = JSON.parse(patch.slice(patch.indexOf("{")));
  if (sent.id !== "dn01" || !sent.audience.include.friends || !sent.audience.include.followers || sent.audience.include.public || sent.audience.exclude.people.join() !== "oakridge,elmstreet" || sent.name !== "Cedar Close") fail(label + ": sent " + patch);

  /* Add a name. */
  await page.fill(".ep [data-dn-new]", "Cedar Grove");
  await page.click('.ep [data-dn="add"]');
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".ep .dn-shown")).some((el) => el.textContent === "Cedar Grove"), null, { timeout: 4000 }).catch(() => fail(label + ": add did not show"));
  const post = log.find((line) => line.indexOf("POST /v1/display-names ") === 0);
  if (!post || post.indexOf('"friends":true') < 0) fail(label + ": add sent " + post);

  /* Preview as an audience and as one person. */
  await page.selectOption(".ep [data-dn-preview-tier]", "friends");
  await page.click('.ep [data-dn="preview-tier"]');
  await page.waitForSelector(".ep .un-preview-out");
  if ((await page.textContent(".ep .un-preview-out")).indexOf("Cedar Close") < 0) fail(label + ": tier preview");
  await page.fill(".ep [data-dn-preview-person]", "@oakridge");
  await page.click('.ep [data-dn="preview-person"]');
  await page.waitForFunction(() => (document.querySelector(".ep .un-preview-out") || {}).textContent.indexOf("Cedar Hill") >= 0, null, { timeout: 4000 }).catch(() => fail(label + ": person preview"));
  if (log.length && !(await page.$(".ep .un-preview-out"))) fail(label + ": no preview");
  await page.evaluate(() => { const el = document.querySelector(".ep .un-preview-out"); if (el) el.scrollIntoView({ block: "center" }); });
  await shot(page, lang + "-" + size.name + "-4-preview-person");

  /* Make "Cedar Crew" the main name: the form's Name follows. */
  await page.click('.ep [data-dn="toggle"][data-id="dn02"]');
  await page.click('.ep [data-dn="primary"][data-id="dn02"]');
  await page.waitForFunction(() => (document.querySelector(".ep .dn-shown") || {}).textContent === "Cedar Crew", null, { timeout: 4000 }).catch(() => fail(label + ": main did not change"));
  await page.click('.ep [data-acct="edit-back"]');
  await page.waitForSelector(".ep #acct-displayName", { timeout: 3000 }).catch(() => fail(label + ": back did not return to the form"));
  const nameNow = await page.inputValue("#acct-displayName");
  if (nameNow !== "Cedar Crew") fail(label + ": Name field " + nameNow);
  const sub = await page.textContent('.ep [data-sub="displaynames"] .ep-row-copy span');
  if (sub.indexOf("Cedar Crew") < 0) fail(label + ": row summary " + sub);
  if (errors.length) fail(label + ": page errors " + errors.slice(0, 2));
  await context.close();
  console.log("display names ok " + label);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const port = server.address().port;
    const jobs = [];
    for (const lang of ["en", "es"]) for (const size of SIZES) jobs.push(() => check(browser, port, size, lang));
    const lanes = Array.from({ length: 2 }, async () => { while (jobs.length) await jobs.shift()(); });
    await Promise.all(lanes);
    console.log("display names ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
