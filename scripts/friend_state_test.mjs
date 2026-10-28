/* A sent friend request shows Requested (with cancel) after a revisit and a reload,
   from the server's answer. Placeholders only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const widths = [
  { width: 1280, height: 800, name: "desktop" },
  { width: 390, height: 844, name: "phone" }
];
const ME = "100000000001";
const THEM = "200000000002";
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



async function run(browser, origin, vp) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === "phone", isMobile: vp.name === "phone" });
  let state = "none";
  const sent = [];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/v1/**", async (route) => {
    const req = route.request();
    const where = new URL(req.url()).pathname;
    const reply = (body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
    if (where === "/v1/friends/request" && req.method() === "POST") { state = "sent"; sent.push("request"); return reply({ ok: true, status: "sent", friendsCount: 0 }); }
    if (where === "/v1/friends/cancel" && req.method() === "POST") { state = "none"; sent.push("cancel"); return reply({ ok: true, status: "none", friendsCount: 0 }); }
    if (where === "/v1/friends" && req.method() === "GET") {
      return reply({ status: state, friends: [], friendsCount: 0, mutualCount: 0, incoming: [], outgoing: state === "sent" ? [{ id: "app:" + THEM, publicId: THEM, handle: "user_b", name: "User B", avatar: "" }] : [], outgoingRequests: state === "sent" ? ["app:" + THEM] : [] });
    }
    if (where === "/v1/profile/user_b") return reply({ account: { publicId: THEM, handle: "user_b", displayName: "User B", avatar: "", viewerFriendStatus: state }, reposts: [], identities: [] });
    if (where === "/v1/profile/user_a") return reply({ account: { publicId: ME, handle: "user_a", displayName: "User A", avatar: "" }, reposts: [], identities: [] });
    return reply({ posts: [], ok: true });
  });
  const page = await context.newPage();
  await page.addInitScript(([me]) => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 2, done: true }));
    localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "local-test-token", account: { publicId: me, handle: "user_a", displayName: "User A", avatar: "" } }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, tiktokAudience: "owner" };
  }, [ME]);
  const tag = vp.name;
  const button = async (step) => {
    const sel = ".pactions .friend-btn, .friend-btn";
    await page.locator(sel).first().waitFor({ timeout: 20000 }).catch(() => fail(tag + " " + step + ": no friend button on the profile"));
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const b = document.querySelector(".friend-btn");
      return b ? { cls: b.className, act: b.getAttribute("data-friend-act") || "" } : null;
    });
  };
  await page.goto(origin + "/#/@user_b", { waitUntil: "domcontentloaded" });
  let b = await button("first visit");
  if (!b || b.act !== "request") fail(tag + ": a stranger shows Add friend first " + JSON.stringify(b));
  await page.locator('.friend-btn[data-friend-act="request"]').first().click();
  await page.waitForFunction(() => !!document.querySelector('.friend-btn[data-friend-act="cancel"]'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  b = await button("after sending");
  if (!b || b.act !== "cancel" || b.cls.indexOf("friend-pending") < 0) fail(tag + ": after sending, the button shows Requested with cancel " + JSON.stringify(b));
  if (sent.indexOf("request") < 0) fail(tag + ": the request reached the server");
  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.goto(origin + "/#/@user_b", { waitUntil: "domcontentloaded" });
  b = await button("revisit");
  if (!b || b.act !== "cancel") fail(tag + ": a revisit keeps Requested " + JSON.stringify(b));
  await page.reload({ waitUntil: "domcontentloaded" });
  b = await button("reload");
  if (!b || b.act !== "cancel") fail(tag + ": a reload keeps Requested from the server " + JSON.stringify(b));
  await context.close();
  console.log("friend request state ok " + tag);
}

async function main() {
  const chromium = await loadPlaywright();
  const server = await startServer();
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const vp of widths) await run(browser, origin, vp);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  console.error(err && err.message);
});
