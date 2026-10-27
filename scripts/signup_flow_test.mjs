// Local first-run audit. A static server plus an in-process worker (D1)
// stand in for production. Nothing here signs up on the live site.
//
// Account numbers and handles are created inside the page and stay there.
// This process only prints viewport sizes, timings, and pass/fail.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromWorker = createRequire(path.join(root, "worker/package.json"));
const { Miniflare, Log, LogLevel } = requireFromWorker("miniflare");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8"
};

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 800 }
];

let pageOrigin = "";
let worker = null;
let ipCounter = 1;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, pageOrigin || "http://127.0.0.1");
      if (url.pathname === "/accounts.config.js") {
        const body = "window.VIKTORYCH_ACCOUNTS = " + JSON.stringify({
          api: pageOrigin, gate: true, turnstileSiteKey: "",
          emergencyHash: "f".repeat(64)
        }) + ";\n";
        res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
        res.end(body);
        return;
      }
      if (url.pathname.startsWith("/v1/")) {
        const body = await readBody(req);
        const headers = { origin: pageOrigin, "cf-connecting-ip": "203.0.113." + ((ipCounter++ % 200) + 1) };
        for (const name of ["content-type", "authorization", "accept", "x-viktorych-intent"]) {
          if (req.headers[name]) headers[name] = req.headers[name];
        }
        const upstream = await worker.dispatchFetch("https://accounts.test" + url.pathname + url.search, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : body
        });
        const out = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": "no-store"
        });
        res.end(out);
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.resolve(root, "." + rel);
      if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("missing"); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("server error");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      pageOrigin = "http://127.0.0.1:" + port;
      resolve(server);
    });
  });
}

function launch() {
  const req = createRequire(import.meta.url);
  const core = process.env.PLAYWRIGHT_CORE || "playwright-core";
  return req(core).chromium.launch({
    channel: "chrome", headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
}

function redact(text) {
  return String(text || "")
    .replace(/\b\d{4}(?: \d{4}){3}\b/g, "[redacted]")
    .replace(/\b\d{12,16}\b/g, "[redacted]")
    .replace(/\breader[a-z]{4,}\b/g, "[redacted]");
}

async function openFresh(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    serviceWorkers: "block",
    permissions: ["clipboard-read", "clipboard-write", "notifications"]
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (err) => problems.push(redact(err && err.message || err)));
  return { context, page, problems };
}

async function gotoFresh(page) {
  const started = Date.now();
  await page.goto(pageOrigin + "/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create account" }).first().waitFor({ timeout: 8000 });
  const firstScreen = Date.now() - started;
  await page.waitForFunction(() => window.ViktorychAccounts && window.ViktorychAccounts.blocking, null, { timeout: 20000 });
  return firstScreen;
}

async function layoutPass(page, viewport) {
  const notes = [];
  const metrics = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const create = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Create account");
    const signIn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sign in");
    const app = document.getElementById("app");
    const appBox = app ? app.getBoundingClientRect() : null;
    return {
      wall: document.documentElement.getAttribute("data-wall"),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      create: box(create),
      signIn: box(signIn),
      appHidden: !appBox || appBox.width === 0 || getComputedStyle(app).display === "none",
      heading: (document.querySelector(".x-copy h1, .x-land-copy h1") || {}).textContent || ""
    };
  });
  if (metrics.wall !== "1") notes.push(viewport.name + ": wall not up");
  if (!metrics.appHidden) notes.push(viewport.name + ": logged-out app content is visible");
  if (metrics.overflowX > 1) notes.push(viewport.name + ": horizontal overflow " + metrics.overflowX);
  if (metrics.heading.trim() !== "Happening now") notes.push(viewport.name + ": landing heading missing");
  for (const key of ["create", "signIn"]) {
    const b = metrics[key];
    if (!b || b.width < 8 || b.height < 8) { notes.push(viewport.name + ": " + key + " missing"); continue; }
    if (b.top < -1 || b.left < -1 || b.bottom > viewport.height + 1 || b.right > viewport.width + 1) {
      notes.push(viewport.name + ": " + key + " outside the viewport");
    }
  }
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByRole("heading", { name: "Create your account" }).waitFor();
  await page.locator("#acct-displayName").fill("");
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.locator("#acct-error").waitFor();
  if ((await page.locator("#acct-error").innerText()) !== "What should we call you?") notes.push(viewport.name + ": empty name error missing");
  await page.locator("#acct-displayName").fill("Example Reader");
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.locator("#acct-handle").waitFor();
  await page.locator("#acct-handle").fill("");
  await page.locator(".acct-modal [data-acct='next']").click();
  if ((await page.locator("#acct-error").innerText()) !== "Choose a handle.") notes.push(viewport.name + ": empty handle error missing");
  await page.locator("#acct-handle").fill("!!");
  await page.locator(".acct-modal [data-acct='next']").click();
  if ((await page.locator("#acct-error").innerText()) !== "That handle is not allowed.") notes.push(viewport.name + ": bad handle error missing");
  await page.locator("#acct-handle").fill("admin");
  await page.locator(".acct-modal [data-acct='next']").click();
  if ((await page.locator("#acct-error").innerText()) !== "That handle is reserved.") notes.push(viewport.name + ": reserved handle error missing");
  const described = await page.locator("#acct-handle").getAttribute("aria-describedby");
  const invalid = await page.locator("#acct-handle").getAttribute("aria-invalid");
  if (described !== "acct-error" || invalid !== "true") notes.push(viewport.name + ": error not tied to the field");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".acct-modal"));
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByRole("heading", { name: "Sign in to ViktorychApp" }).waitFor();
  const loginFields = await page.evaluate(() => {
    const form = document.getElementById("acct-login-form");
    const user = document.getElementById("acct-login-user");
    const pass = document.getElementById("acct-accountNumber");
    return {
      form: !!(form && form.tagName === "FORM"),
      user: !!(user && user.getAttribute("autocomplete") === "username" && getComputedStyle(user).display !== "none"),
      pass: !!(pass && pass.getAttribute("autocomplete") === "current-password" && pass.type === "password" && getComputedStyle(pass).display !== "none")
    };
  });
  if (!loginFields.form || !loginFields.user || !loginFields.pass) notes.push(viewport.name + ": sign-in is not a password-manager form");
  const resetCopy = await page.locator(".acct-modal").innerText();
  if (!/no password to reset/.test(resetCopy)) notes.push(viewport.name + ": password-reset explanation missing");
  await page.locator("#acct-accountNumber").fill("1234");
  await page.locator(".acct-modal [data-acct='do-login']").click();
  if ((await page.locator("#acct-error").innerText()) !== "Account numbers are 16 digits.") notes.push(viewport.name + ": short number error missing");
  await page.keyboard.press("Shift+Tab");
  const trap = await page.evaluate(() => document.activeElement && document.activeElement.closest(".acct-modal") !== null);
  if (!trap) notes.push(viewport.name + ": keyboard focus left the dialog");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".acct-modal"));
  await page.locator("#dock-root").waitFor({ state: "attached", timeout: 4000 }).catch(() => {});
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  const prefs = await page.locator(".acct-modal").innerText();
  if (prefs.includes("Sign in to ViktorychApp")) notes.push(viewport.name + ": settings opened sign-in");
  if (!/Language and appearance stay on this device/.test(prefs)) notes.push(viewport.name + ": logged-out settings missing");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Terms of Service" }).first().click();
  const terms = await page.locator(".acct-modal").innerText();
  if (!/account number is your login/.test(terms)) notes.push(viewport.name + ": terms page is still a stub");
  await page.keyboard.press("Escape");
  return notes;
}

async function typeHandle(page) {
  return page.evaluate(() => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let handle = "reader";
    for (const n of bytes) handle += alphabet[n % 26];
    const input = document.querySelector("#acct-handle");
    input.focus();
    input.value = handle;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return /^[a-z]{10,12}$/.test(handle);
  });
}

async function firstRun(page) {
  const notes = [];
  let loginStatus = 0;
  page.on("response", (res) => {
    if (res.url().endsWith("/v1/login")) loginStatus = res.status();
  });
  let signupStatus = 0;
  await page.route("**/v1/signup", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    const response = await route.fetch();
    signupStatus = response.status();
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.locator("#acct-displayName").fill("Example Reader");
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.locator("#acct-handle").waitFor();
  const honeypot = await page.evaluate(() => {
    const el = document.querySelector('#account-layer input[name="fax"]');
    if (!el) return "missing";
    return getComputedStyle(el).display;
  });
  if (honeypot === "none" || honeypot === "missing") notes.push("honeypot is missing or hidden with display none");
  if (!(await typeHandle(page))) notes.push("signup handle was not filled");
  const next = page.locator(".acct-modal [data-acct='next']");
  await next.click();
  if ((await next.getAttribute("aria-busy")) !== "true") notes.push("signup has no loading state");
  const reached = await page.getByText("This number is shown once.").waitFor({ timeout: 20000 }).then(() => true, () => false);
  if (!reached) {
    notes.push("signup did not reach the number step (" + signupStatus + ")");
    return notes;
  }
  await page.unroute("**/v1/signup");
  const manager = await page.evaluate(() => {
    const form = document.getElementById("acct-save-form");
    const user = document.getElementById("acct-username");
    const pass = document.getElementById("acct-new-password");
    const codes = document.querySelectorAll("[data-recovery-code]");
    return {
      form: !!(form && form.tagName === "FORM"),
      user: !!(user && user.getAttribute("autocomplete") === "username" && user.name === "username" && user.value),
      pass: !!(pass && pass.getAttribute("autocomplete") === "new-password" && pass.name === "password" && pass.type === "password"),
      shown: !!user && !!pass && getComputedStyle(user).display !== "none" && getComputedStyle(pass).display !== "none",
      codes: codes.length
    };
  });
  if (!manager.form || !manager.user || !manager.pass || !manager.shown || manager.codes !== 10) notes.push("password manager fields or recovery codes are missing");
  if (!(await page.locator(".acct-modal [data-acct='saved']").isDisabled())) notes.push("next is enabled before the number is saved");
  const copied = await page.evaluate(async () => {
    document.querySelector("[data-acct='copy']").click();
    const text = await navigator.clipboard.readText();
    return /^\d{4} \d{4} \d{4} \d{4}$/.test(text);
  });
  if (!copied) notes.push("copy did not produce a grouped account number");
  const stored = await page.evaluate(() => {
    const pending = JSON.parse(sessionStorage.getItem("viktorychapp-pending-v1") || "{}");
    const number = String(pending.accountNumber || "");
    const handle = String((pending.account && pending.account.handle) || "");
    sessionStorage.setItem("viktorychapp-signup-number", JSON.stringify(number));
    sessionStorage.setItem("viktorychapp-signup-handle", JSON.stringify(handle));
    return {
      digits: /^\d{16}$/.test(number),
      handleOk: /^[a-z0-9_]{4,15}$/.test(handle),
      token: typeof pending.token === "string" && pending.token.length > 20
    };
  });
  if (!stored.digits || !stored.handleOk || !stored.token) notes.push("account number step did not keep a session");
  await page.locator(".acct-modal input[name='saved']").check();
  await page.locator(".acct-modal [data-acct='saved']").click();
  await page.waitForFunction(() => document.documentElement.getAttribute("data-wall") !== "1", null, { timeout: 20000 });
  const welcome = page.locator("[data-act='welcome-skip']");
  if (await welcome.count()) await welcome.click();
  const timeline = await page.getByText("No posts yet").first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  if (!timeline) {
    const state = await page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      return {
        wall: document.documentElement.getAttribute("data-wall") || "",
        home: /No posts yet/.test(text),
        missing: /load posts/.test(text),
        follow: /Find accounts to follow/.test(text),
        happening: /Happening now/.test(text)
      };
    });
    notes.push("timeline did not open " + JSON.stringify(state));
    return notes;
  }
  await page.getByRole("tab", { name: "Following" }).click();
  await page.waitForFunction(() => (location.hash || "").indexOf("following") >= 0);
  await page.getByRole("link", { name: "Find accounts to follow" }).waitFor();
  const profile = await page.waitForFunction(() => {
    const session = JSON.parse(localStorage.getItem("viktorychapp-account-v1") || "{}");
    const handle = session.account && session.account.handle;
    const html = window.ViktorychAccounts.profileHtml({ name: "profile", handle: handle }) || "";
    return /Add a photo and bio/.test(html);
  }, null, { timeout: 15000 }).then(() => true, () => false);
  if (!profile) notes.push("own profile empty state is misleading");
  await page.goto(pageOrigin + "/#/settings/device", { waitUntil: "domcontentloaded" });
  const balanced = page.getByRole("radio", { name: "Balanced" });
  await balanced.waitFor({ timeout: 15000 });
  if ((await balanced.getAttribute("aria-checked")) !== "true") notes.push("device performance is not Balanced");
  await page.goto(pageOrigin + "/#/settings/privacy", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Privacy and safety" }).waitFor();
  const privacy = await page.evaluate(() => {
    const on = (key) => {
      const btn = document.querySelector("[data-key='" + key + "']");
      return btn ? btn.getAttribute("aria-checked") : "missing";
    };
    return {
      embed: on("privacyEmbedShield"), webrtc: on("privacyWebRTC"), referrer: on("privacyNoReferrer"),
      trackers: on("privacyStripTrackers"), zero: on("privacyZeroTrace"), fingerprint: on("privacyAntiFingerprint")
    };
  });
  const expected = { embed: "false", webrtc: "true", referrer: "true", trackers: "true", zero: "false", fingerprint: "true" };
  if (JSON.stringify(privacy) !== JSON.stringify(expected)) notes.push("privacy defaults differ");
  await page.goto(pageOrigin + "/#/settings/notifications", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Notify me about new posts" }).click();
  await page.getByRole("button", { name: "Notifications on" }).waitFor({ timeout: 10000 });
  await page.locator("[data-act='compose']:visible").first().click();
  await page.locator("#compose-text").waitFor();
  if ((await page.locator("#compose-text").getAttribute("aria-describedby")) !== "compose-note") notes.push("composer does not explain that it stays on device");
  await page.locator("#compose-text").fill("A local note from the first run.");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("compose-text"));
  await page.locator("[data-act='compose']:visible").first().click();
  await page.waitForFunction(() => (document.querySelector("#compose-text") && document.querySelector("#compose-text").value || "").indexOf("local note") >= 0);
  await page.locator("#compose-post").click();
  await page.getByText("Your post was sent.").first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const local = window.ViktorychLocal;
    if (!local || !local.readDoc) return false;
    return local.readDoc("drafts", "compose").then((saved) => !saved || String(saved.text || "").indexOf("local note") < 0);
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("compose-text"));
  await page.goto(pageOrigin + "/#/settings/resources", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Install app" }).click();
  await page.getByRole("heading", { name: "Install app" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".modal"));
  await page.goto(pageOrigin + "/#/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByRole("heading", { name: "Happening now" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.evaluate(() => {
    const input = document.querySelector("#acct-accountNumber");
    input.focus();
    input.value = "9".repeat(16);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("[data-acct='do-login']").click();
  });
  await page.getByText("Could not sign in.").waitFor({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  const loggedIn = await page.evaluate(() => {
    const number = JSON.parse(sessionStorage.getItem("viktorychapp-signup-number") || "null");
    const input = document.querySelector("#acct-accountNumber");
    input.focus();
    input.value = String(number || "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("[data-acct='do-login']").click();
    return /^\d{16}$/.test(String(number || ""));
  });
  if (!loggedIn) notes.push("saved number was not available for sign-in");
  const back = await page.waitForFunction(() => {
    const text = document.body ? document.body.innerText : "";
    return /Your account/.test(text) || /No posts yet/.test(text);
  }, null, { timeout: 20000 }).then(() => true, () => false);
  if (!back) {
    notes.push("sign-in did not open the app (" + loginStatus + ")");
    return notes;
  }
  await page.goto(pageOrigin + "/#/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByRole("heading", { name: "Happening now" }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.locator("#acct-displayName").fill("Second Reader");
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.locator("#acct-handle").waitFor();
  const reused = await page.evaluate(() => {
    const handle = JSON.parse(sessionStorage.getItem("viktorychapp-signup-handle") || "\"\"");
    const input = document.querySelector("#acct-handle");
    input.focus();
    input.value = String(handle || "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return /^[a-z0-9_]{4,15}$/.test(String(handle || ""));
  });
  if (!reused) notes.push("saved handle was not available");
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.getByText("That handle is taken.").waitFor({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.locator("#acct-displayName").fill("Offline Reader");
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.locator("#acct-handle").waitFor();
  await typeHandle(page);
  await page.locator(".acct-modal [data-acct='next']").click();
  await page.getByText("Can't reach the server.").waitFor({ timeout: 15000 });
  await page.context().setOffline(false);
  return notes;
}

const server = await startServer();
worker = new Miniflare({
  scriptPath: path.join(root, "worker/src/index.js"),
  modules: true,
  modulesRoot: root,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
  bindings: {
    ACCOUNT_PEPPER: "local-test-pepper",
    SIGNUP_GUARD: "on",
    OWNER_CLAIM_CODE: "local-test-claim",
    OWNER_HANDLE: "fixtureowner",
    ALLOWED_ORIGINS: pageOrigin,
    PBKDF2_ITERATIONS: "1000"
  },
  d1Databases: ["DB"],
  r2Buckets: ["DATA"],
  compatibilityDate: "2026-01-15",
  log: new Log(LogLevel.NONE)
});
const bindings = await worker.getBindings();
await bindings.DATA.put("feeds.json", JSON.stringify({
  updated: "2026-01-01T00:00:00Z", preview: true,
  feeds: [{ id: "x:example", platform: "x", handle: "example", name: "Example", configured: true }],
  posts: []
}));
const browser = await launch();
const failures = [];
try {
  for (const viewport of VIEWPORTS) {
    const { context, page, problems } = await openFresh(browser, viewport);
    try {
      const ms = await gotoFresh(page);
      console.log(viewport.name + " " + viewport.width + "x" + viewport.height + " first-screen " + ms + "ms");
      if (ms > 8000) failures.push(viewport.name + ": first screen took " + ms + "ms");
      failures.push(...await layoutPass(page, viewport));
      if (viewport.name === "phone") failures.push(...await firstRun(page));
      failures.push(...problems.map((p) => viewport.name + " pageerror: " + p.slice(0, 180)));
    } catch (err) {
      failures.push(viewport.name + " failed: " + redact(err && err.stack || err).slice(0, 1200));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
  await worker.dispose();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("signup flow ok");
