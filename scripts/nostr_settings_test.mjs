import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 390, height: 844, name: "phone" },
  { width: 1280, height: 800, name: "desktop" }
];

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

/* Nostr, off by default: hidden while the owner switch is off; once on,
   a person opts in, makes a key that never leaves the device, edits relays,
   and reads a Nostr profile, a note and its replies from (fake) relays. */
const SIZES = [
  { width: 390, height: 844, name: "phone", mobile: true },
  { width: 1280, height: 800, name: "desktop", mobile: false }
];

function boot(off) {
  return `(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({ version: 1, initialized: true }));
    localStorage.setItem("viktorychapp-server-off", ${JSON.stringify(JSON.stringify(off))});
    localStorage.setItem("viktorychapp-server-off-at", String(Date.now()));
    const relay = window.__relay = { events: [], sent: [], urls: [] };
    const match = (ev, f) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey)) && (!f.ids || f.ids.includes(ev.id))
      && (!f["#e"] || ev.tags.some((t) => t[0] === "e" && f["#e"].includes(t[1])));
    class FakeSocket {
      constructor(url) { this.url = url; this.readyState = 0; relay.urls.push(url); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5); }
      send(text) {
        const msg = JSON.parse(text);
        const reply = (data) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(data) }), 1);
        if (msg[0] === "REQ") {
          msg.slice(2).forEach((f) => relay.events.filter((ev) => match(ev, f)).forEach((ev) => reply(["EVENT", msg[1], ev])));
          reply(["EOSE", msg[1]]);
        } else if (msg[0] === "EVENT") { relay.sent.push(msg[1]); reply(["OK", msg[1].id, true, ""]); }
      }
      close() { this.readyState = 3; this.onclose && this.onclose(); }
    }
    window.WebSocket = FakeSocket;
  })()`;
}

async function check(browser, origin, size) {
  const label = size.name;
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile, serviceWorkers: "block" });
  const errors = [];
  const sentOut = [];
  await context.route((url) => !String(url).startsWith(origin), (route) => route.fulfill({ status: 204, body: "" }));
  let page = await context.newPage();
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.addInitScript(boot(["nostr"]));
  await page.goto(origin + "/index.html#/settings/privacy", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".set-block", { timeout: 20000 }).catch(() => fail(label + ": no privacy page"));
  if (await page.$('a[href="#/settings/nostr"]')) fail(label + ": Nostr shows while the owner has it off");
  await page.goto(origin + "/index.html#/settings/nostr", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".set-block", { timeout: 20000 });
  if (await page.$('[data-act="nostr-on"]')) fail(label + ": opt-in offered while the owner has it off");
  await page.close();

  page = await context.newPage();
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("request", (req) => sentOut.push(req.url() + " " + (req.postData() || "")));
  await page.addInitScript(boot([]));
  await page.goto(origin + "/index.html#/settings/privacy", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[href="#/settings/nostr"]', { timeout: 20000 }).catch(() => fail(label + ": no Nostr row once the owner turns it on"));
  await page.click('a[href="#/settings/nostr"]');
  await page.waitForSelector('[data-act="nostr-on"][aria-checked="false"]', { timeout: 5000 }).catch(() => fail(label + ": Nostr is not off by default"));
  await page.click('[data-act="nostr-on"]');
  await page.waitForSelector('[data-act="nostr-new"]', { timeout: 5000 }).catch(() => fail(label + ": no key choices"));
  await page.click('[data-act="nostr-new"]');
  await page.waitForSelector('[data-act="nostr-copy"]', { timeout: 5000 }).catch(() => fail(label + ": key not made"));
  const npub = await page.$eval('.set-block input[readonly]', (el) => el.value);
  if (!/^npub1[02-9ac-hj-np-z]{58}$/.test(npub)) fail(label + ": public key " + npub);
  const secret = await page.evaluate(() => window.ViktorychNostr.exportSecret());
  if (!/^nsec1/.test(secret)) fail(label + ": no secret key on the device");
  await page.fill('form[data-mute="nostr-relay"] input', "ws://insecure.example");
  await page.press('form[data-mute="nostr-relay"] input', "Enter");
  await page.fill('form[data-mute="nostr-relay"] input', "wss://relay.example.org");
  await page.press('form[data-mute="nostr-relay"] input', "Enter");
  await page.waitForSelector('[data-relay="wss://relay.example.org"]', { timeout: 5000 }).catch(() => fail(label + ": relay not added"));
  if (await page.$('[data-relay="ws://insecure.example"]')) fail(label + ": insecure relay kept");
  const layout = await page.evaluate(() => {
    const sw = document.querySelector('[data-act="nostr-publish"]').getBoundingClientRect();
    return { wide: document.scrollingElement.scrollWidth > innerWidth + 1, h: sw.height };
  });
  if (layout.wide) fail(label + ": page scrolls sideways");

  // Someone else's profile, a note and a reply, all signed and checked.
  const ids = await page.evaluate(async () => {
    const N = window.ViktorychNostr;
    const sk = "0000000000000000000000000000000000000000000000000000000000000003";
    const other = "0000000000000000000000000000000000000000000000000000000000000007";
    const now = Math.floor(Date.now() / 1000);
    const meta = await N.finishEvent({ kind: 0, created_at: now - 100, tags: [], content: JSON.stringify({ name: "Relay Writer", about: "Writes on Nostr" }) }, sk);
    const note = await N.finishEvent({ kind: 1, created_at: now - 50, tags: [], content: "Hello from the relays" }, sk);
    const reply = await N.finishEvent({ kind: 1, created_at: now - 10, tags: [["e", note.id, "", "root"], ["p", note.pubkey]], content: "A reply over Nostr" }, other);
    window.__relay.events.push(meta, note, reply);
    return { npub: N.npub(note.pubkey), note: note.id };
  });
  await page.goto(origin + "/index.html#/nostr/" + ids.npub, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Hello from the relays") && document.body.innerText.includes("Relay Writer"), null, { timeout: 15000 }).catch(() => fail(label + ": Nostr profile did not load"));
  await page.goto(origin + "/index.html#/nostr/" + ids.npub + "/status/" + ids.note, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Hello from the relays") && document.body.innerText.includes("A reply over Nostr"), null, { timeout: 15000 }).catch(() => fail(label + ": Nostr note or its reply did not load"));
  if (sentOut.some((line) => line.includes(secret) || line.includes(secret.slice(5, 20)))) fail(label + ": the secret key left the page");
  if (errors.length) fail(label + ": " + errors[0]);
  await context.close();
  console.log("nostr ok " + label);
}

async function main() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright chromium is missing");
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const size of SIZES) await check(browser, origin, size);
    console.log("nostr settings ok");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message ? err.message : err);
});
