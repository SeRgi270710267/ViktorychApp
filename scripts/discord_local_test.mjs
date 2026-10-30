import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/* Settings > Connected keys > Connect your Discord (local), as a signed-out
   user (not the owner). The key is checked against Discord, then sealed in
   IndexedDB under a non-extractable device key; it never appears in plain
   text in storage and never goes to any host except discord.com. Reads are
   serial with a pause, a 429 waits for retry_after, a 401 shows the calm
   "needs replacing" note and stops reads, a join only starts from a tap and
   a captcha opens a popup whose answer goes back to Discord once. Nothing
   ever posts a message. Remove key deletes the database. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "MTAxMDEwMTAxMDEwMTAxMDEw.GabcDE.local-test-key-0123456789abcdefghijklmnopqr";
const NEW_KEY = "MTAxMDEwMTAxMDEwMTAxMDEw.GxyzAB.local-test-key-replacement-0123456789abcd";
function fail(message) { console.error("FAIL: " + message); process.exitCode = 1; throw new Error(message); }
function ok(message) { console.log("ok " + message); }
function mime(file) {
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });

const cors = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "content-type": "application/json" };
const discordLog = [];
const leaks = [];
let mode = { meStatus: 200, guilds429: 0, joinCaptcha: true };

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", locale: "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("dialog", (d) => d.accept());
  page.on("request", (req) => {
    const url = req.url();
    const h = req.headers();
    const blob = url + " " + JSON.stringify(h) + " " + (req.postData() || "");
    if (!url.startsWith("https://discord.com/") && (blob.includes(KEY) || blob.includes(NEW_KEY))) leaks.push(url);
  });
  await page.route((url) => !String(url).startsWith(origin) && !String(url).startsWith("https://discord.com/") && !String(url).startsWith("https://js.hcaptcha.com/"), (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(origin + "/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  /* A stand-in hCaptcha: renders a button the "user" taps, then calls back. */
  await page.route("https://js.hcaptcha.com/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body:
    "window.hcaptcha={render:function(el,o){var b=document.createElement('button');b.id='fake-hc';b.textContent='I am human';b.onclick=function(){o.callback('solved-by-user')};el.appendChild(b);window.__hcData=null;return 7},setData:function(id,d){window.__hcData=d}};" }));
  await page.route("https://discord.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\/v10/, "");
    const auth = req.headers()["authorization"] || "";
    discordLog.push({ t: Date.now(), m: req.method(), p, auth, cap: req.headers()["x-captcha-key"] || "", rq: req.headers()["x-captcha-rqtoken"] || "" });
    const json = (status, body) => route.fulfill({ status, headers: cors, body: JSON.stringify(body) });
    if (req.method() === "GET" && p.startsWith("/invites/")) return json(200, { code: "abc", guild: { id: "300000000000000001", name: "Test Guild", icon: null }, approximate_member_count: 666 });
    if (auth !== KEY && auth !== NEW_KEY) return json(401, { message: "401: Unauthorized", code: 0 });
    if (p === "/users/@me") return mode.meStatus === 200 ? json(200, { id: "200000000000000001", username: "spare", global_name: "Spare One", avatar: null }) : json(401, { message: "401: Unauthorized", code: 0 });
    if (p === "/users/@me/guilds") {
      if (mode.guilds429 > 0) { mode.guilds429--; return json(429, { message: "You are being rate limited.", retry_after: 1.5, global: false }); }
      return json(200, [{ id: "300000000000000002", name: "Existing Server", icon: null }]);
    }
    if (p === "/users/@me/channels") return json(200, [{ id: "400000000000000001", type: 1, last_message_id: "500", recipients: [{ id: "200000000000000009", username: "friend", global_name: "A Friend", avatar: null }] }]);
    if (p === "/guilds/300000000000000002/channels") return json(200, [{ id: "600000000000000001", type: 4, name: "Info", position: 0 }, { id: "600000000000000002", type: 0, name: "general", parent_id: "600000000000000001", position: 1 }, { id: "600000000000000003", type: 2, name: "voice", position: 2 }]);
    if (p === "/channels/600000000000000002/messages") return json(200, [{ id: "700000000000000002", content: "second", timestamp: "2026-10-29T10:01:00Z", author: { id: "1", username: "b" }, attachments: [], embeds: [] }, { id: "700000000000000001", content: "first <b>x</b>", timestamp: "2026-10-29T10:00:00Z", author: { id: "2", username: "a" }, attachments: [], embeds: [] }]);
    if (req.method() === "POST" && p === "/invites/abc") {
      if (!req.headers()["x-captcha-key"] && mode.joinCaptcha) return json(400, { captcha_key: ["captcha-required"], captcha_sitekey: "10000000-ffff-ffff-ffff-000000000001", captcha_service: "hcaptcha", captcha_rqdata: "rq-data", captcha_rqtoken: "rq-token", captcha_session_id: "sess-1" });
      return json(200, { code: "abc", guild: { id: "300000000000000001", name: "Test Guild", icon: null } });
    }
    return json(404, { message: "Unknown" });
  });
  await page.addInitScript(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-lang", "en");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true, lang: "en" }));
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
  });

  /* 1. Every user sees the row and the local Discord section. */
  await page.goto(origin + "/index.html#/settings", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.DiscordLocal && document.querySelector('a[href="#/settings/keys"]'), null, { timeout: 25000 }).catch(() => fail("no Connected keys row for a normal user"));
  ok("a normal user sees Settings > Connected keys");
  await page.evaluate(() => { location.hash = "#/settings/keys"; });
  await page.waitForSelector("#dloc-section [data-dloc=open]", { timeout: 15000 }).catch(() => fail("no local Discord section"));
  const copy = await page.textContent("#dloc-section");
  if (!copy.includes("Stays on this device only. Use a spare account. Discord may lock accounts used this way.")) fail("missing the plain warning copy");
  if (copy.includes("Keys are available only to the owner.")) fail("owner-only note still shows");
  ok("section shows the plain warning copy and no owner-only note");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "discord-local-section.png") });

  /* 2. A bad paste never hits the network; a good key is checked then sealed. */
  await page.click("#dloc-section [data-dloc=open]");
  await page.waitForSelector("#dloc-key");
  await page.fill("#dloc-key", "not a key");
  await page.click(".dloc-key button[type=submit]");
  await page.waitForFunction(() => /look like a Discord key/.test(document.querySelector(".dloc-err").textContent));
  if (discordLog.length) fail("a bad paste reached Discord");
  ok("a bad paste is refused on the device");
  await page.fill("#dloc-key", KEY);
  await page.click(".dloc-key button[type=submit]");
  await page.waitForSelector(".dloc-me", { timeout: 20000 }).catch(() => fail("never connected"));
  await page.waitForFunction(() => document.querySelectorAll(".dloc-row").length >= 1 && !document.querySelector("[data-dloc=refresh][disabled]"), null, { timeout: 30000 }).catch(() => fail("servers never loaded"));
  const stored = await page.evaluate(async (key) => {
    const db = await new Promise((r, j) => { const q = indexedDB.open("viktorych-discord-local"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const all = await new Promise((r) => { const out = {}; const tx = db.transaction("kv"); const s = tx.objectStore("kv"); s.getAllKeys().onsuccess = (e) => { const keys = e.target.result; let n = keys.length; keys.forEach((k) => { s.get(k).onsuccess = (ev) => { out[k] = ev.target.result; if (!--n) r(out); }; }); }; });
    db.close();
    const dk = all["device-key"];
    let exportable = true;
    try { await crypto.subtle.exportKey("raw", dk); } catch (e) { exportable = false; }
    const tokenBytes = new Uint8Array(all.token.ct);
    const plainInDb = new TextDecoder().decode(tokenBytes).includes(key) || JSON.stringify(all.cache || {}).includes(key);
    let ls = ""; for (let i = 0; i < localStorage.length; i++) ls += localStorage.getItem(localStorage.key(i));
    let ss = ""; for (let i = 0; i < sessionStorage.length; i++) ss += sessionStorage.getItem(sessionStorage.key(i));
    return { extractable: dk.extractable, exportable, plainInDb, inWebStorage: ls.includes(key) || ss.includes(key), input: (document.getElementById("dloc-key") || {}).value || "" };
  }, KEY);
  if (stored.extractable || stored.exportable) fail("device key is extractable");
  if (stored.plainInDb || stored.inWebStorage) fail("key stored in plain text");
  ok("key sealed with AES-GCM under a non-extractable device key; no plain copy in IndexedDB, localStorage or sessionStorage");

  /* 3. Serial reads with a gap. */
  const reads = discordLog.filter((r) => r.auth === KEY);
  for (let i = 1; i < reads.length; i++) if (reads[i].t - reads[i - 1].t < 1100) fail("reads not spaced: " + (reads[i].t - reads[i - 1].t) + "ms");
  ok("reads are one at a time with at least 1.1 s between them (" + reads.map((r) => r.p).join(", ") + ")");

  /* 4. Servers -> channel -> read-only messages; DMs list. */
  await page.click('.dloc-row[data-id="300000000000000002"]');
  await page.waitForSelector('.dloc-ch[data-id="600000000000000002"]', { timeout: 15000 });
  if (await page.$('.dloc-ch[data-id="600000000000000003"]')) fail("voice channel listed");
  await page.click('.dloc-ch[data-id="600000000000000002"]');
  await page.waitForSelector(".dloc-msgs li", { timeout: 15000 });
  const msgs = await page.$$eval(".dloc-msgs .dloc-txt", (els) => els.map((e) => e.innerHTML));
  if (msgs[0] !== "first &lt;b&gt;x&lt;/b&gt;" || msgs[1] !== "second") fail("messages not oldest-first or not escaped: " + JSON.stringify(msgs));
  if (await page.$(".dloc-sheet textarea, .dloc-sheet [contenteditable]")) fail("a message box exists");
  await page.click("[data-dloc=back]");
  await page.click("[data-dloc=back]");
  await page.click('[data-dloc=tab][data-v="dms"]');
  await page.waitForFunction(() => /A Friend/.test(document.querySelector(".dloc-list").textContent));
  ok("servers, text channels, read-only messages (escaped) and the DM list load");

  /* 5. 429 waits for retry_after. */
  mode.guilds429 = 1;
  const before = discordLog.length;
  await page.click("[data-dloc=refresh]");
  await page.waitForFunction(() => !document.querySelector("[data-dloc=refresh][disabled]"), null, { timeout: 30000 });
  const g = discordLog.slice(before).filter((r) => r.p === "/users/@me/guilds");
  if (g.length !== 2 || g[1].t - g[0].t < 1900) fail("429 retry_after not respected: " + JSON.stringify(g.map((r) => r.t)));
  ok("a 429 waits for retry_after (+jitter) and retries once (" + (g[1].t - g[0].t) + "ms)");

  /* 6. Join only from a tap; captcha popup; answer sent once with the rqtoken. */
  await page.click('[data-dloc=tab][data-v="servers"]');
  await page.fill("#dloc-inv", "https://discord.gg/abc");
  const postsBefore = discordLog.filter((r) => r.m === "POST").length;
  await page.click('[data-dloc-form="invite"] button[type=submit]');
  await page.waitForSelector("[data-dloc=join]", { timeout: 15000 });
  if (discordLog.filter((r) => r.m === "POST").length !== postsBefore) fail("looking up an invite joined");
  const lookup = discordLog.filter((r) => r.p.startsWith("/invites/") && r.m === "GET").pop();
  if (lookup.auth) fail("invite preview sent the key");
  await page.click("[data-dloc=join]");
  await page.waitForSelector("#fake-hc", { timeout: 15000 }).catch(() => fail("no captcha popup"));
  if ((await page.evaluate(() => window.__hcData && window.__hcData.rqdata)) !== "rq-data") fail("rqdata not passed to the captcha");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "discord-local-captcha.png") });
  await page.click("#fake-hc");
  await page.waitForFunction(() => /Joined Test Guild/.test(document.querySelector(".dloc-sheet").textContent), null, { timeout: 15000 }).catch(() => fail("join did not finish"));
  const posts = discordLog.filter((r) => r.m === "POST");
  if (posts.length !== 2 || posts[0].cap || posts[1].cap !== "solved-by-user" || posts[1].rq !== "rq-token") fail("join posts wrong: " + JSON.stringify(posts));
  if (await page.$(".dloc-pop")) fail("captcha popup still open");
  if (discordLog.some((r) => r.m === "POST" && /\/messages/.test(r.p))) fail("a message was sent");
  ok("join only on tap, captcha popup solved by the user, answer sent once with rqtoken; no message sends");

  /* 7. Reload keeps the key; a 401 shows the calm note and stops reads. */
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.waitForSelector("#dloc-section [data-dloc=open]", { timeout: 25000 });
  await page.waitForFunction(() => /Connected as Spare One/.test(document.getElementById("dloc-section").textContent), null, { timeout: 10000 }).catch(() => fail("key not kept after reload"));
  mode.meStatus = 401;
  await page.click("#dloc-section [data-dloc=open]");
  await page.waitForSelector("[data-dloc=refresh]", { timeout: 5000 }).catch(async () => fail("sheet after reload: " + JSON.stringify(await page.evaluate(() => ({ st: Object.assign({}, window.DiscordLocal._test.state, { guilds: 0, dms: 0 }), hash: location.hash, sec: (document.getElementById("dloc-section") || {}).outerHTML }))).slice(0, 1500)));
  await page.click("[data-dloc=refresh]");
  await page.waitForSelector(".dloc-calm", { timeout: 20000 }).catch(() => fail("no calm needs-replacing note on 401"));
  const n401 = discordLog.length;
  await page.waitForTimeout(3000);
  if (discordLog.length !== n401) fail("reads kept going after a 401");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "discord-local-replace.png") });
  const calmColor = await page.$eval(".dloc-calm p", (el) => getComputedStyle(el).color);
  if (calmColor === "rgb(244, 33, 46)") fail("the 401 note is an alarm red");
  ok("a 401 shows the calm needs-replacing note and stops all reads");
  mode.meStatus = 200;
  await page.fill("#dloc-key", NEW_KEY);
  await page.click(".dloc-key button[type=submit]");
  await page.waitForSelector(".dloc-me", { timeout: 20000 }).catch(() => fail("replacing the key failed"));
  ok("pasting a new key clears the note");
  if (process.env.SHOTS) {
    await page.waitForFunction(() => !document.querySelector("[data-dloc=refresh][disabled]"), null, { timeout: 30000 });
    await page.screenshot({ path: path.join(process.env.SHOTS, "discord-local-sheet.png") });
  }

  /* 8. Remove key deletes the database. */
  await page.click(".dloc-link.danger");
  await page.waitForFunction(() => /Not connected/.test(document.getElementById("dloc-section").textContent), null, { timeout: 10000 });
  const gone = await page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === "viktorych-discord-local"));
  if (gone) fail("database still there after Remove key");
  ok("Remove key deletes the local database");

  if (leaks.length) fail("key sent to a non-Discord host: " + leaks.join(", "));
  ok("the key never went to any host but discord.com (" + discordLog.length + " Discord calls checked)");
  const bad = errors.filter((e) => !/ResizeObserver/.test(e));
  if (bad.length) fail("page errors: " + bad.join(" | "));
  ok("no page errors");
} finally {
  await browser.close();
  server.close();
}
