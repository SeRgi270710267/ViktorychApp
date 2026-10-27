/* Virtual authenticator, offline app lock, and privacy-screen triggers.
   Synthetic display name and handle only. Do not print tokens, PINs, or ids. */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../worker/package.json", import.meta.url));
const { Miniflare } = require("miniflare");

function which(name) {
  const found = spawnSync("which", [name], { encoding: "utf8" });
  const path = (found.stdout || "").trim();
  return found.status === 0 && path ? path : "";
}

function chromeBin() {
  const named = [process.env.CHROME, process.env.CHROME_PATH, process.env.CHROME_BIN].filter(Boolean);
  for (const bin of named) {
    try { statSync(bin); return bin; } catch (err) { /* try the next candidate */ }
  }
  return which("chrome") || which("google-chrome") || which("google-chrome-stable") || which("chromium") || which("chromium-browser");
}

const HARNESS = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="app"><main data-privacy="sensitive"><p id="secret">synthetic draft</p></main></div>
<input id="acct-passkey-user" autocomplete="username webauthn">
<script src="/privacy-screen.js"></script>
<script type="module" src="/passkeys.js"></script>
<script type="module" src="/app-lock.js"></script>
</body>
</html>`;

const FILES = {
  "/privacy-screen.js": "privacy-screen.js",
  "/passkeys.js": "passkeys.js",
  "/app-lock.js": "app-lock.js",
  "/styles.css": "styles.css",
  "/shared/webauthn.js": "shared/webauthn.js",
  "/shared/app-lock-crypto.js": "shared/app-lock-crypto.js"
};

function mime(path) {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  const bin = chromeBin();
  if (!bin) throw new Error("chrome");
  const playwrightPath = process.env.PLAYWRIGHT_MJS || "";
  if (!playwrightPath) throw new Error("playwright");
  const loaded = await import(pathToFileURL(playwrightPath).href);
  const chromium = loaded.chromium || (loaded.default && loaded.default.chromium);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/harness.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(HARNESS);
      return;
    }
    if (url.pathname.startsWith("/v1/")) {
      const headers = new Headers();
      headers.set("CF-Connecting-IP", "203.0.113.40");
      headers.set("Origin", origin);
      const type = req.headers["content-type"];
      if (type) headers.set("content-type", type);
      const auth = req.headers.authorization;
      if (auth) headers.set("authorization", auth);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const upstream = await mf.dispatchFetch("https://accounts.test" + url.pathname, {
        method: req.method,
        headers,
        body: body && body.length ? body : undefined
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      res.end(bytes);
      return;
    }
    const file = FILES[url.pathname];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    const bytes = await readFile(join(root, file));
    res.writeHead(200, { "content-type": mime(url.pathname), "cache-control": "no-store" });
    res.end(bytes);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const origin = "http://localhost:" + port;
  const mf = new Miniflare({
    modules: true,
    scriptPath: join(root, "worker/src/index.js"),
    modulesRoot: root,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "owner-test",
      ALLOWED_ORIGINS: origin + ",https://viktorychgroup.github.io,https://viktorychapp.pages.dev",
      PBKDF2_ITERATIONS: "1000"
    }
  });

  const browser = await chromium.launch({
    executablePath: bin,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  try {
    await privacyAndPasskeys(browser, origin);
    await appLock(browser, origin);
    console.log("webauthn lock check passed");
  } finally {
    await browser.close();
    await mf.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function addAuthenticator(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const options = {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true
  };
  let result;
  try {
    result = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: Object.assign({ hasPrf: true }, options) });
  } catch (err) {
    result = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: options });
  }
  return { cdp: cdp, authenticatorId: result.authenticatorId };
}

async function privacyAndPasskeys(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(origin + "/", { waitUntil: "load" });
  await page.waitForFunction(() => window.ViktorychPrivacy && window.ViktorychPasskeys && window.ViktorychAppLock);

  const blur = await page.evaluate(() => {
    window.ViktorychPrivacy.setMode("app");
    // A real blur drops document focus. Dispatching the event alone does not.
    document.hasFocus = () => false;
    window.dispatchEvent(new Event("blur"));
    const cover = document.getElementById("privacy-cover");
    return {
      attr: document.documentElement.getAttribute("data-privacy-cover"),
      open: !!(cover && !cover.hasAttribute("hidden"))
    };
  });
  assert.equal(blur.attr, "app");
  assert.equal(blur.open, true);

  const dms = await page.evaluate(() => {
    document.hasFocus = () => true;
    window.dispatchEvent(new Event("focus"));
    window.ViktorychPrivacy.setMode("dms");
    document.hasFocus = () => false;
    window.dispatchEvent(new Event("blur"));
    return document.documentElement.getAttribute("data-privacy-cover");
  });
  assert.equal(dms, "dms");

  const quiet = await page.evaluate(() => {
    document.querySelector("main").removeAttribute("data-privacy");
    window.ViktorychPrivacy.paint();
    const covered = document.documentElement.getAttribute("data-privacy-cover");
    document.querySelector("main").setAttribute("data-privacy", "sensitive");
    document.hasFocus = () => true;
    window.dispatchEvent(new Event("focus"));
    return covered;
  });
  assert.equal(quiet, "off");

  const printed = await page.evaluate(() => {
    window.ViktorychPrivacy.setMode("app");
    window.dispatchEvent(new Event("beforeprint"));
    const open = !document.getElementById("privacy-cover").hasAttribute("hidden");
    window.dispatchEvent(new Event("afterprint"));
    return open;
  });
  assert.equal(printed, true);

  const frozen = await page.evaluate(() => {
    document.dispatchEvent(new Event("freeze"));
    const reason = window.ViktorychPrivacy.paint().reason;
    document.dispatchEvent(new Event("resume"));
    return reason;
  });
  assert.equal(frozen, "freeze");

  const pip = await page.evaluate(() => {
    document.dispatchEvent(new Event("enterpictureinpicture"));
    const reason = window.ViktorychPrivacy.paint().reason;
    document.dispatchEvent(new Event("leavepictureinpicture"));
    return reason;
  });
  assert.equal(pip, "pip");

  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.ViktorychPrivacy.setMode("dms"));
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector("[data-privacy='sensitive']")).visibility);
  assert.equal(hidden, "hidden");
  await page.evaluate(() => window.ViktorychPrivacy.setMode("app"));
  const printedApp = await page.evaluate(() => getComputedStyle(document.getElementById("app")).display);
  assert.equal(printedApp, "none");
  await page.emulateMedia({ media: "screen" });

  const cdp = await context.newCDPSession(page);
  await page.setViewportSize({ width: 400, height: 780 });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 400,
    height: 780,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 800,
    screenHeight: 800
  });
  const split = await page.evaluate(() => {
    window.ViktorychPrivacy.setMode("app");
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("resume"));
    document.dispatchEvent(new Event("leavepictureinpicture"));
    const choice = window.ViktorychPrivacy.paint();
    return {
      reason: choice.reason,
      cover: choice.cover,
      sw: screen.width,
      sh: screen.height,
      ww: window.outerWidth || window.innerWidth,
      wh: window.outerHeight || window.innerHeight,
      iw: window.innerWidth,
      ih: window.innerHeight
    };
  });
  assert.equal(split.cover, true, JSON.stringify({ reason: split.reason, sw: split.sw, sh: split.sh, ww: split.ww, wh: split.wh }));
  assert.equal(split.reason, "split");
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    window.ViktorychPrivacy.setMode("dms");
    window.ViktorychPrivacy.paint();
  });

  const conditional = await page.evaluate(async () => {
    function bytes(value) {
      const text = String(value).replace(/-/g, "+").replace(/_/g, "/");
      const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
      const raw = atob(text + pad);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < out.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }
    const input = document.getElementById("acct-passkey-user");
    const available = !!(window.PublicKeyCredential && PublicKeyCredential.isConditionalMediationAvailable && await PublicKeyCredential.isConditionalMediationAvailable());
    const res = await fetch("/v1/webauthn/login/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const body = await res.json();
    const hints = body.publicKey && body.publicKey.hints ? body.publicKey.hints.slice() : [];
    const publicKey = body.publicKey;
    delete publicKey.hints;
    publicKey.challenge = bytes(publicKey.challenge);
    const controller = new AbortController();
    let name = "resolved";
    const pending = navigator.credentials.get({ mediation: "conditional", publicKey: publicKey, signal: controller.signal });
    controller.abort();
    try { await pending; } catch (err) { name = err && err.name ? err.name : "error"; }
    return {
      available: available,
      autocomplete: input.getAttribute("autocomplete"),
      status: res.status,
      hybrid: hints.indexOf("hybrid") >= 0,
      allow: !body.publicKey.allowCredentials,
      name: name
    };
  });
  assert.equal(conditional.available, true);
  assert.equal(conditional.autocomplete, "username webauthn");
  assert.equal(conditional.status, 200);
  assert.equal(conditional.hybrid, true);
  assert.equal(conditional.allow, true);
  assert.equal(conditional.name, "AbortError");

  const auth = await addAuthenticator(context, page);
  const created = await page.evaluate(async () => {
    const res = await fetch("/v1/webauthn/signup/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Guest", handle: "guestbox" })
    });
    const body = await res.json();
    if (res.status !== 200) return { status: res.status, error: body.error || "options" };
    let credential;
    try { credential = await window.ViktorychPasskeys.create(body.publicKey); }
    catch (err) {
      const message = String(err && err.message || "").replace(/guestbox/gi, "name");
      return {
        status: res.status,
        error: err && err.name ? err.name : "create",
        message: message.slice(0, 180),
        secure: window.isSecureContext,
        host: location.hostname,
        rp: body.publicKey && body.publicKey.rp && body.publicKey.rp.id
      };
    }
    const verify = await fetch("/v1/webauthn/signup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: body.challengeId, credential: credential, label: "Guest device" })
    });
    const done = await verify.json();
    if (verify.status !== 201) return { status: verify.status, error: done.error || "verify" };
    window.__session = done.token;
    return {
      status: 201,
      numberLength: String(done.accountNumber || "").length,
      attachment: !body.publicKey.authenticatorSelection.authenticatorAttachment,
      hybrid: body.publicKey.hints.indexOf("hybrid") >= 0
    };
  });
  assert.equal(created.status, 201, JSON.stringify({ error: created.error, message: created.message, secure: created.secure, host: created.host, rp: created.rp }));
  assert.equal(created.numberLength, 16);
  assert.equal(created.attachment, true);
  assert.equal(created.hybrid, true);

  const signedIn = await page.evaluate(async () => {
    const res = await fetch("/v1/webauthn/login/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const body = await res.json();
    let credential;
    try { credential = await window.ViktorychPasskeys.get(body.publicKey); }
    catch (err) { return { error: err && err.name ? err.name : "get", message: String(err && err.message || "").replace(/guestbox/gi, "name").slice(0, 180) }; }
    const verify = await fetch("/v1/webauthn/login/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: body.challengeId, credential: credential })
    });
    const done = await verify.json();
    if (verify.status !== 200) return { status: verify.status, error: done.error || "verify" };
    const session = await fetch("/v1/session", { headers: { authorization: "Bearer " + done.token } });
    return { status: session.status };
  });
  assert.equal(signedIn.status, 200, JSON.stringify({ error: signedIn.error, message: signedIn.message }));

  const second = await page.evaluate(async () => {
    const headers = { "content-type": "application/json", authorization: "Bearer " + window.__session };
    const res = await fetch("/v1/webauthn/register/options", { method: "POST", headers: headers, body: "{}" });
    const body = await res.json();
    if (res.status !== 200) return { status: res.status, error: body.error || "options" };
    const excluded = body.publicKey.excludeCredentials ? body.publicKey.excludeCredentials.length : 0;
    let blocked = "";
    try { await window.ViktorychPasskeys.create(body.publicKey); blocked = "created"; }
    catch (err) { blocked = err && err.name ? err.name : "error"; }
    delete body.publicKey.excludeCredentials;
    let credential;
    try { credential = await window.ViktorychPasskeys.create(body.publicKey); }
    catch (err) { return { error: err && err.name ? err.name : "create", blocked: blocked, excluded: excluded }; }
    const verify = await fetch("/v1/webauthn/register/verify", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ challengeId: body.challengeId, credential: credential, label: "Guest device" })
    });
    if (verify.status !== 200) {
      const done = await verify.json();
      return { status: verify.status, error: done.error || "verify" };
    }
    const listed = await fetch("/v1/webauthn/credentials", { headers: { authorization: headers.authorization } });
    const rows = await listed.json();
    const id = rows.credentials && rows.credentials[0] && rows.credentials[0].id;
    const removed = await fetch("/v1/webauthn/credentials", {
      method: "DELETE",
      headers: headers,
      body: JSON.stringify({ credentialId: id })
    });
    const again = await fetch("/v1/webauthn/credentials", { headers: { authorization: headers.authorization } });
    const left = await again.json();
    return { status: removed.status, before: rows.credentials.length, after: left.credentials.length, leaked: JSON.stringify(rows).indexOf("public_key") >= 0, blocked: blocked, excluded: excluded };
  });
  assert.equal(second.status, 200, second.error || "register");
  assert.equal(second.excluded, 1);
  assert.equal(second.blocked, "InvalidStateError");
  assert.equal(second.before, 2);
  assert.equal(second.after, 1);
  assert.equal(second.leaked, false);
  void auth;
  await context.close();
}

async function sealAndUnlock(page, mode) {
  const sealed = await page.evaluate(async () => {
    localStorage.setItem("viktorychapp-drafts", "synthetic draft");
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("superintelapp-sw", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("docs")) req.result.createObjectStore("docs");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("docs", "readwrite");
        tx.objectStore("docs").put({ category: "drafts", text: "synthetic draft" }, "draft-1");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    const locked = await window.ViktorychAppLock.seal();
    let doc = null;
    await new Promise((resolve) => {
      const req = indexedDB.open("superintelapp-sw");
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction("docs").objectStore("docs").get("draft-1");
        get.onsuccess = () => { doc = get.result || null; db.close(); resolve(); };
        get.onerror = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    });
    let packed = "";
    await new Promise((resolve) => {
      const req = indexedDB.open("viktorych-lock");
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction("kv").objectStore("kv").get("vault");
        get.onsuccess = () => { packed = JSON.stringify(get.result || {}); db.close(); resolve(); };
        get.onerror = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    });
    return {
      locked: locked,
      draft: localStorage.getItem("viktorychapp-drafts"),
      doc: doc,
      leak: packed.indexOf("synthetic draft") >= 0
    };
  });
  assert.equal(sealed.locked, true);
  assert.equal(sealed.draft, null);
  assert.equal(sealed.doc, null);
  assert.equal(sealed.leak, false);

  await page.context().setOffline(true);
  let apiHits = 0;
  const onRequest = (req) => {
    if (req.url().includes("/v1/")) apiHits += 1;
  };
  page.on("request", onRequest);
  const wrong = mode === "pin" ? await page.evaluate(async () => {
    const names = [];
    for (let i = 0; i < 4; i++) {
      try {
        await window.ViktorychAppLock.unlock("0000", { reload: false });
        names.push("ok");
      } catch (err) {
        names.push(err && err.message ? err.message : "err");
      }
    }
    return names;
  }) : null;
  if (wrong) {
    assert.equal(wrong[3], "backoff");
    await page.waitForTimeout(1700);
  }
  const opened = await page.evaluate(async (kind) => {
    try {
      const ok = await window.ViktorychAppLock.unlock(kind === "pin" ? "2468" : "", { reload: false });
      let doc = null;
      await new Promise((resolve) => {
        const req = indexedDB.open("superintelapp-sw");
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction("docs").objectStore("docs").get("draft-1");
          get.onsuccess = () => { doc = get.result || null; db.close(); resolve(); };
          get.onerror = () => { db.close(); resolve(); };
        };
        req.onerror = () => resolve();
      });
      return { ok: ok, draft: localStorage.getItem("viktorychapp-drafts"), doc: doc && doc.text ? doc.text : "" };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : "err" };
    }
  }, mode);
  page.off("request", onRequest);
  await page.context().setOffline(false);
  assert.equal(opened.ok, true, opened.error || "unlock");
  assert.equal(opened.draft, "synthetic draft");
  assert.equal(opened.doc, "synthetic draft");
  assert.equal(apiHits, 0);
}

async function appLock(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(origin + "/", { waitUntil: "load" });
  await page.waitForFunction(() => window.ViktorychAppLock);
  const auth = await addAuthenticator(context, page);
  const setup = await page.evaluate(async () => {
    try {
      const result = await window.ViktorychAppLock.setup();
      if (result.needPin) await window.ViktorychAppLock.setPin("2468", "2468");
      return { mode: result.mode };
    } catch (err) {
      return { error: err && err.name ? err.name : "error" };
    }
  });
  assert.equal(setup.error, undefined, setup.error || "setup");
  const prf = setup.mode === "prf";
  console.log("prf-extension: " + (prf ? "yes" : "no"));
  if (!prf) {
    await sealAndUnlock(page, "pin");
  } else {
    await sealAndUnlock(page, "prf");
    await page.evaluate(() => localStorage.setItem("viktorychapp-account-v1", "synthetic-session"));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.evaluate(() => window.ViktorychAppLock.wipe()).catch(() => {})
    ]);
    const gone = await page.evaluate(() => localStorage.getItem("viktorychapp-account-v1"));
    assert.equal(gone, null);
    await page.waitForFunction(() => window.ViktorychAppLock);
    await page.evaluate(async () => {
      const result = await window.ViktorychAppLock.setup({ forcePin: true, testIterations: 1000 });
      if (!result.needPin) throw new Error("pin");
      await window.ViktorychAppLock.setPin("2468", "2468");
    });
    await sealAndUnlock(page, "pin");
  }
  const forgot = await page.evaluate(() => {
    const button = document.getElementById("app-lock-forgot");
    if (button) button.click();
    return !!document.getElementById("app-lock-wipe");
  });
  if (!forgot) {
    await page.evaluate(() => window.ViktorychAppLock.seal());
    const shown = await page.evaluate(() => {
      document.getElementById("app-lock-forgot").click();
      return !!document.getElementById("app-lock-wipe");
    });
    assert.equal(shown, true);
  }
  await page.evaluate(() => localStorage.setItem("viktorychapp-account-v1", "synthetic-session"));
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load" }),
    page.evaluate(() => window.ViktorychAppLock.wipe()).catch(() => {})
  ]);
  const cleared = await page.evaluate(() => localStorage.getItem("viktorychapp-account-v1") || localStorage.getItem("viktorychapp-drafts"));
  assert.equal(cleared, null);
  void auth;
  await context.close();
}

main().catch((err) => {
  console.error(err && err.message ? err.message : "failed");
  process.exit(1);
});
