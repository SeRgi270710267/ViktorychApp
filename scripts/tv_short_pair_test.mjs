/* TV sign-in on the short address: the TV shows a QR code and a code that
   point at viktorychapp.pages.dev, a phone confirms, the TV signs itself in,
   and codes that run out renew by themselves, then ask for a new one.
   Static checks always run; the browser part runs when PLAYWRIGHT_CORE is set.
   SHOTS=dir saves the TV waiting, phone confirm and TV signed-in screens. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = "https://viktorychapp.pages.dev";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function fail(message) {
  console.error("tv short pair: " + message);
  process.exitCode = 1;
  throw new Error(message);
}
function read(name) { return fs.readFileSync(path.join(root, name), "utf8"); }

function staticChecks() {
  const store = {};
  const ctx = { URLSearchParams, sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
  vm.runInNewContext(read("shared/short-link.js"), ctx);
  const short = ctx.ViktorychShort;
  if (short.SHORT_ORIGIN !== SHORT) fail("short origin is not the pages.dev address");
  if (short.pairUrl("abc234") !== SHORT + "/p/ABC234") fail("pair link is not short: " + short.pairUrl("abc234"));
  if (short.cleanCode("O0I1L5") !== "") fail("ambiguous letters must not make a code");
  if (short.display("/tv") !== "viktorychapp.pages.dev/tv") fail("typed address is wrong");
  if (short.shareBase({ hostname: "viktorychgroup.github.io", origin: "https://viktorychgroup.github.io", pathname: "/ViktorychApp/" }) !== SHORT + "/") fail("share links on GitHub Pages should use the short address");
  if (!/^https:\/\/viktorychgroup\.github\.io\/ViktorychApp\/$/.test(short.otherBase({ hostname: "viktorychapp.pages.dev" }))) fail("other address is wrong");
  const redirects = read("_redirects").split("\n").map((l) => l.trim().split(/\s+/).join(" ")).join("\n");
  for (const line of ["/p/:code /?pair=:code 302", "/join /?join=1 302", "/go / 302"]) {
    if (!redirects.includes(line)) fail("_redirects is missing " + line);
  }
  if (!read("scripts/assemble_site.py").includes('"_redirects"')) fail("_redirects is not shipped");
  if (!read("scripts/cf_pages_prepare.py").includes('"_redirects"')) fail("_redirects is not protected in the mirror");
  const notFound = read("404.html");
  if (!notFound.includes("?pair=") || !notFound.includes("?join=1")) fail("404.html does not map the short paths on GitHub Pages");
  if (!read("index.html").includes('src="shared/short-link.js"')) fail("index.html does not load the short link helper");
  if (!read("sw.js").includes('"./shared/short-link.js"')) fail("service worker does not cache the short link helper");
  if (!read("tv/index.html").includes("../?pair=")) fail("/tv has no code entry");
  // Intake: ?pair=CODE becomes the confirm page, ?join=1 opens sign-up.
  const fakeRoot = (search) => {
    const loc = { search, hash: "", pathname: "/", origin: SHORT, hostname: "viktorychapp.pages.dev" };
    const hist = { replaceState(_s, _t, url) { const u = new URL(url, SHORT + "/"); loc.search = u.search; loc.hash = u.hash; } };
    return { loc, hist };
  };
  const a = fakeRoot("?pair=abc234");
  short.intake(a.loc, a.hist);
  if (a.loc.hash !== "#/link-tv?code=ABC234" || a.loc.search) fail("pair intake went to " + a.loc.search + a.loc.hash);
  if (short.pendingPair() !== "ABC234") fail("pair intake did not remember the code");
  if (short.takeAutoPair("ABC234")) fail("a phone that was already signed in must still confirm");
  short.markPairAuth("ABC234");
  if (!short.takeAutoPair("ABC234") || short.takeAutoPair("ABC234")) fail("pairing after sign-in must finish once");
  console.log("ok tv short links");
}

/* A stand-in for the accounts Worker, shared by the TV and the phone. */
function fakeWorker() {
  const pairs = new Map();
  let ttl = 600;
  let seq = 0;
  function newCode() {
    let code = "";
    for (let i = 0; i < 6; i++) code += ALPHABET[(seq * 7 + i * 13 + Math.floor(Math.random() * 31)) % ALPHABET.length];
    seq += 1;
    return code;
  }
  return {
    setTtl(s) { ttl = s; },
    handle(route, body) {
      const now = Date.now();
      if (route === "/v1/tv-pair/start") {
        const code = newCode();
        const poll = "p" + seq + "x" + Math.random().toString(36).slice(2);
        pairs.set(code, { poll, until: now + ttl * 1000, approved: false });
        return { status: 200, code, poll, expiresIn: ttl, interval: 3 };
      }
      if (route === "/v1/tv-pair/approve") {
        const rec = pairs.get(String(body.code || ""));
        if (!rec || rec.until < now || rec.approved) return { status: 400 };
        rec.approved = true;
        return { status: 200 };
      }
      if (route === "/v1/tv-pair/poll") {
        for (const [code, rec] of pairs) {
          if (rec.poll !== body.poll) continue;
          if (rec.until < now) { pairs.delete(code); return { status: 410 }; }
          if (!rec.approved) return { status: 202, pending: true };
          pairs.delete(code);
          return { status: 200, token: "tv-session-test", account: { displayName: "Sam Rivera" } };
        }
        return { status: 410 };
      }
      return { status: 404 };
    }
  };
}

function startServer() {
  const page = (kind) => `<!doctype html><html lang="en"${kind === "tv" ? ' class="tv-on"' : ""}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/accounts.css"><link rel="stylesheet" href="/tv-pair.css">
<style>html,body{background:#000;color:#e7e9ea;margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.tvp-frame{max-width:${kind === "tv" ? "860px" : "600px"};margin:${kind === "tv" ? "64px auto" : "0 auto"};padding:${kind === "tv" ? "32px 40px" : "0"};border:${kind === "tv" ? "1px solid #2f3336" : "0"};border-radius:16px}
.tvp-frame h2.acct-title{font-size:31px;font-weight:800;margin:0 0 4px}</style></head><body>
<div class="tvp-frame" id="m"></div>
<script src="/shared/short-link.js"></script><script src="/vendor/qrcode-1.4.4.js"></script>
<script>
  window.__qrTexts = [];
  var realQr = window.qrcode;
  window.qrcode = function (t, l) { var q = realQr(t, l); var add = q.addData; q.addData = function (d) { window.__qrTexts.push(String(d)); return add.apply(q, arguments); }; return q; };
  window.__committed = [];
  window.ViktorychAccounts = {
    call: function (route, opts) { return window.fakeWorker(route, (opts && opts.body) || {}, (opts && opts.token) || ""); },
    token: function () { return window.__signedIn ? "phone-session" : ""; },
    account: function () { return window.__signedIn ? { displayName: "Sam Rivera" } : null; },
    commitTvSession: function (token, account) { window.__committed.push({ token: token, name: account && account.displayName }); }
  };
</script>
<script src="/tv-pair.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/__tv" || url.pathname === "/__phone") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(url.pathname === "/__tv" ? "tv" : "phone"));
      return;
    }
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("missing"); return; }
      const type = file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "text/javascript";
      res.writeHead(200, { "content-type": type + "; charset=utf-8", "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function tvPage(browser, base, worker) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.exposeFunction("fakeWorker", (route, body) => worker.handle(route, body));
  await page.goto(base + "/__tv", { waitUntil: "load" });
  await page.evaluate(() => {
    document.getElementById("m").innerHTML = '<h2 class="acct-title">Sign in with your phone</h2>' + window.ViktorychTVPair.tvBody();
    window.ViktorychTVPair.tvStart();
  });
  await page.waitForSelector('[data-tvp-phase="code"]', { timeout: 5000 });
  return page;
}

async function browserChecks() {
  if (!process.env.PLAYWRIGHT_CORE) { console.log("tv short pair browser check skipped"); return; }
  const mod = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
  const chromium = mod.chromium || (mod.default && mod.default.chromium);
  const shots = process.env.SHOTS || "";
  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || "chrome" });
  try {
    const worker = fakeWorker();
    // 1. The TV shows a QR code and a code, both on the short address.
    const tv = await tvPage(browser, base, worker);
    const shown = await tv.evaluate(() => ({
      code: window.ViktorychTVPair.state().code,
      text: document.querySelector("[data-tvp-code]").textContent,
      url: document.querySelector("[data-tvp-url]").textContent,
      qr: window.__qrTexts.slice(-1)[0] || "",
      svg: !!document.querySelector(".tvp-qr svg")
    }));
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(shown.code)) fail("code has ambiguous characters: " + shown.code);
    if (shown.text.replace(/\s/g, "") !== shown.code) fail("code on screen does not match");
    if (shown.url !== "viktorychapp.pages.dev/tv") fail("typed address is " + shown.url);
    if (shown.qr !== SHORT + "/p/" + shown.code || !shown.svg) fail("QR code opens " + shown.qr);
    if (shots) { await tv.waitForTimeout(500); await tv.screenshot({ path: path.join(shots, "tv-waiting.png") }); }

    // 2. A signed-in phone opens /p/CODE and confirms with one tap.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await phone.exposeFunction("fakeWorker", (route, body) => worker.handle(route, body));
    await phone.goto(base + "/__phone", { waitUntil: "load" });
    await phone.evaluate((code) => {
      window.__signedIn = true;
      var route = { query: new URLSearchParams("code=" + code) };
      function draw() { document.getElementById("m").innerHTML = window.ViktorychTVPair.linkPage(route); }
      window.addEventListener("vklazy", draw);
      draw();
    }, shown.code);
    await phone.waitForSelector('[data-tvp-phone="confirm"] [data-tvpair="confirm"]');
    const lead = await phone.textContent(".tvp-lead");
    if (!lead.includes("Sam Rivera")) fail("confirm screen does not say who the TV signs in as");
    if (shots) { await phone.waitForTimeout(500); await phone.screenshot({ path: path.join(shots, "phone-confirm.png") }); }
    await phone.click('[data-tvpair="confirm"]');
    await phone.waitForSelector('[data-tvp-phone="done"]', { timeout: 5000 });

    // 3. The TV notices by itself and signs in.
    await tv.waitForSelector('[data-tvp-phase="done"]', { timeout: 8000 });
    const done = await tv.textContent('[data-tvp-phase="done"] .tvp-big');
    if (!done.includes("Sam Rivera")) fail("TV success screen says " + done);
    if (shots) { await tv.waitForTimeout(500); await tv.screenshot({ path: path.join(shots, "tv-signed-in.png") }); }
    await tv.waitForFunction(() => window.__committed.length === 1, null, { timeout: 4000 });
    const committed = await tv.evaluate(() => window.__committed[0]);
    if (committed.token !== "tv-session-test") fail("TV did not keep its own session");
    // The code works once.
    const again = worker.handle("/v1/tv-pair/approve", { code: shown.code });
    if (again.status === 200) fail("a used code worked twice");
    console.log("ok tv signs in from the phone");

    // 4. Codes that run out renew by themselves, then ask for a new one.
    worker.setTtl(1);
    const tv2 = await tvPage(browser, base, worker);
    const first = await tv2.evaluate(() => window.ViktorychTVPair.state().code);
    await tv2.waitForFunction((c) => window.ViktorychTVPair.state().code && window.ViktorychTVPair.state().code !== c, first, { timeout: 6000 });
    const renewed = await tv2.textContent(".tvp-wait");
    if (!renewed.includes("New code")) fail("renewed code does not say so");
    await tv2.waitForSelector('[data-tvp-phase="expired"] [data-tvpair="again"]', { timeout: 15000 });
    const focused = await tv2.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-tvpair"));
    if (focused !== "again") fail("Get a new code is not focused for the remote");
    worker.setTtl(600);
    await tv2.click('[data-tvpair="again"]');
    await tv2.waitForSelector('[data-tvp-phase="code"]', { timeout: 5000 });
    console.log("ok expired codes renew");
  } finally {
    await browser.close();
    server.close();
  }
}

staticChecks();
await browserChecks();
if (!process.exitCode) console.log("tv short pair ok");
