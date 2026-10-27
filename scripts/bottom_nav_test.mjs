import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (file.endsWith(".woff2")) return "font/woff2";
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

function chromeBin() {
  const list = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const found = list.find((bin) => fs.existsSync(bin));
  if (found) return found;
  try {
    return execFileSync("bash", ["-lc", "command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser"], { encoding: "utf8" }).trim().split("\n")[0];
  } catch (err) {
    return "";
  }
}

function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const waits = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const job = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) job.reject(new Error(JSON.stringify(msg.error)));
      else job.resolve(msg.result || {});
      return;
    }
    waits.slice().forEach((job) => {
      if (job.method === msg.method) {
        waits.splice(waits.indexOf(job), 1);
        job.resolve(msg.params || {});
      }
    });
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("cdp socket failed")));
  });
  return {
    ready,
    send(method, params, sessionId) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const packet = { id, method, params: params || {} };
        if (sessionId) packet.sessionId = sessionId;
        ws.send(JSON.stringify(packet));
      });
    },
    until(method) {
      return new Promise((resolve) => waits.push({ method, resolve }));
    },
    close() { try { ws.close(); } catch (err) { /* already closed */ } }
  };
}

const INJECT = `
try { localStorage.setItem("superintelapp-lang", "en"); } catch (e) {}
try { localStorage.setItem("viktorychapp-lang-user-picked", "1"); } catch (e) {}
try {
  if (!localStorage.getItem("viktorychapp-settings-v1")) {
    localStorage.setItem("viktorychapp-settings-v1", JSON.stringify({
      version: 1,
      bellRead: 0,
      bellNotes: [{ id: "note-1", at: 1893456000000, hash: "#/", text: "Hello", handle: "ada", name: "Ada" }]
    }));
  }
} catch (e) {}
(function () {
  var api = {
    visible: function () { return true; },
    hide: function () {},
    unmount: function () {},
    mount: function () {},
    pull: function () { return Promise.resolve(); },
    bind: function () {},
    page: function () { return ""; },
    isLocked: function () { return false; },
    isUnlocked: function () { return true; }
  };
  Object.defineProperty(window, "ViktorychShorts", {
    configurable: true,
    enumerable: true,
    get: function () { return api; },
    set: function (next) {
      if (next && typeof next === "object") {
        api = next;
        api.visible = function () { return true; }
      }
    }
  });
})();
if (navigator.serviceWorker) {
  navigator.serviceWorker.register = function () {
    return Promise.resolve({ active: null, update: function () { return Promise.resolve(); } });
  };
}
`;

async function main() {
  const bin = chromeBin();
  if (!bin) fail("Google Chrome was not found");
  const server = await startServer();
  const port = server.address().port;
  const origin = "http://127.0.0.1:" + port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bnav-"));
  let chromeLog = "";
  const chrome = spawn(bin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stdout.on("data", (buf) => { chromeLog += buf.toString(); });
  chrome.stderr.on("data", (buf) => { chromeLog += buf.toString(); });
  const stop = () => {
    try { chrome.kill("SIGKILL"); } catch (err) { /* gone */ }
    try { server.close(); } catch (err) { /* gone */ }
  };
  process.on("exit", stop);

  const started = Date.now();
  let debugWs = "";
  while (Date.now() - started < 15000) {
    const match = chromeLog.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) { debugWs = match[1]; break; }
    if (chrome.exitCode != null) fail("Chrome exited early\n" + chromeLog);
    await sleep(50);
  }
  if (!debugWs) fail("Chrome did not open a DevTools port\n" + chromeLog);
  const debugPort = new URL(debugWs).port;
  let version = null;
  for (let i = 0; i < 40 && !version; i++) {
    try {
      version = await fetch("http://127.0.0.1:" + debugPort + "/json/version").then((res) => res.json());
    } catch (err) { await sleep(50); }
  }
  if (!version || !version.webSocketDebuggerUrl) fail("No browser debugger url");
  const browser = openCdp(version.webSocketDebuggerUrl);
  await browser.ready;
  const created = await browser.send("Target.createTarget", { url: "about:blank" });
  const list = await fetch("http://127.0.0.1:" + debugPort + "/json/list").then((res) => res.json());
  const pageInfo = list.find((item) => item.id === created.targetId);
  if (!pageInfo) fail("Page target missing");
  const page = openCdp(pageInfo.webSocketDebuggerUrl);
  await page.ready;

  async function evaluate(expression) {
    const result = await page.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      fail(desc || result.exceptionDetails.text || expression.slice(0, 180));
    }
    return result.result ? result.result.value : undefined;
  }

  async function waitFor(expression, label) {
    const start = Date.now();
    let last = "";
    while (Date.now() - start < 40000) {
      try {
        const value = await evaluate(expression);
        if (value) return value;
        last = JSON.stringify(value);
      } catch (err) {
        last = err.message;
      }
      await sleep(150);
    }
    fail("Timed out waiting for " + label + " (" + last + ")");
  }

  async function viewport(width, height, landscape) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: landscape
        ? { type: "landscapePrimary", angle: 90 }
        : { type: "portraitPrimary", angle: 0 }
    });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "hover", value: "none" },
        { name: "pointer", value: "coarse" }
      ]
    });
  }

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
  await viewport(390, 844, false);
  await page.send("Page.navigate", { url: origin + "/#/explore" });

  const barExpr = `JSON.stringify([...document.querySelectorAll("nav.bottom-nav a")].map((a) => a.getAttribute("href")))`;
  await waitFor(`document.querySelector("nav.bottom-nav a") && ${barExpr}.length > 2`, "bottom bar");
  let prev = "";
  let steady = 0;
  const settleStart = Date.now();
  while (Date.now() - settleStart < 20000) {
    const now = await evaluate(barExpr);
    if (now && now === prev && now !== "[]") {
      steady += 1;
      if (steady >= 3) break;
    } else steady = 0;
    prev = now;
    await sleep(200);
  }

  const portrait = await evaluate(`(() => {
    const bar = document.querySelector("nav.bottom-nav");
    const explore = document.querySelector('nav.bottom-nav a[href="#/explore"]');
    const home = document.querySelector('nav.bottom-nav a[href="#/"]');
    const land = document.querySelector("header.nav.nav-land");
    return {
      bar: getComputedStyle(bar).display,
      exploreOn: explore.classList.contains("on") && explore.getAttribute("aria-current") === "page",
      homeOn: home.classList.contains("on") || home.getAttribute("aria-current") === "page",
      badge: !!document.querySelector('nav.bottom-nav a[href="#/notifications"] .nav-badge'),
      land: getComputedStyle(land).display,
      hrefs: ${barExpr}
    };
  })()`);
  if (portrait.bar !== "flex") fail("Portrait bottom bar display is " + portrait.bar);
  if (!portrait.exploreOn || portrait.homeOn) fail("Explore is not the active bottom item: " + JSON.stringify(portrait));
  if (!portrait.badge) fail("Notification badge missing");
  if (portrait.land !== "none") fail("Landscape sidebar is visible in portrait");
  const initial = JSON.parse(portrait.hrefs);
  const expectedDefault = ["#/", "#/explore", "#/tv", "#/communities", "#/notifications", "#/messages"];
  if (JSON.stringify(initial) !== JSON.stringify(expectedDefault)) fail("Default bar " + portrait.hrefs);

  await evaluate(`location.hash = "#/settings/display/navigation"; true`);
  await waitFor(`document.querySelector("[data-bottom-id=shorts]") && document.querySelector(".bottom-nav-preview")`, "customize screen");
  const screen = await evaluate(`(() => {
    const home = document.querySelector('[data-act="bottom-nav-toggle"][data-id="home"]');
    const help = document.querySelector(".bnav-screen .phandle");
    return {
      shorts: !!document.querySelector('[data-bottom-id="shorts"]'),
      vault: !!document.querySelector('[data-bottom-id="vault"]'),
      homeOff: !!(home && home.disabled && home.getAttribute("aria-checked") === "true"),
      help: help ? help.textContent : "",
      preview: [...document.querySelectorAll("[data-preview-id]")].map((el) => el.getAttribute("data-preview-id")).join(",")
    };
  })()`);
  if (!screen.shorts) fail("Shorts row missing for the owner");
  if (screen.vault) fail("Vault row is visible while signed out");
  if (!screen.homeOff) fail("Home switch can be turned off");
  if (!screen.help.includes("Home always stays")) fail("Help text missing: " + screen.help);
  if (screen.preview !== "home,explore,tv,communities,notifications,messages") fail("Preview " + screen.preview);

  const dragged = await evaluate(`(() => {
    const before = [...document.querySelectorAll("[data-bottom-id]")].map((row) => row.getAttribute("data-bottom-id"));
    const grip = document.querySelector('[data-drag-bottom="games"]');
    const target = document.querySelector('[data-bottom-id="feeds"]');
    const g = grip.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const fire = (type, x, y, buttons) => {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y, button: 0, buttons: buttons });
      (type === "pointerdown" ? grip : document).dispatchEvent(event);
    };
    fire("pointerdown", g.left + 8, g.top + 8, 1);
    fire("pointermove", g.left + 8, g.top + 40, 1);
    fire("pointermove", t.left + 20, t.top + 8, 1);
    fire("pointerup", t.left + 20, t.top + 8, 0);
    const after = [...document.querySelectorAll("[data-bottom-id]")].map((row) => row.getAttribute("data-bottom-id"));
    return { before: before.join(","), after: after.join(",") };
  })()`);
  const gamesAt = dragged.after.split(",").indexOf("games");
  const feedsAt = dragged.after.split(",").indexOf("feeds");
  if (gamesAt < 0 || feedsAt < 0 || gamesAt > feedsAt) fail("Touch drag did not move Games above Feeds: " + JSON.stringify(dragged));

  await evaluate(`document.querySelector('[data-act="bottom-nav-move"][data-id="messages"][data-dir="-1"]').click(); true`);
  await waitFor(`${barExpr}.includes("#/messages")`, "reordered bar");
  const moved = await evaluate(`(() => ({
    bar: ${barExpr},
    preview: [...document.querySelectorAll("[data-preview-id]")].map((el) => el.getAttribute("data-preview-id")).join(",")
  }))()`);
  const movedHrefs = JSON.parse(moved.bar);
  const movedWant = ["#/", "#/explore", "#/tv", "#/communities", "#/messages", "#/notifications"];
  if (JSON.stringify(movedHrefs) !== JSON.stringify(movedWant)) fail("Move up left the bar as " + moved.bar);
  if (moved.preview !== "home,explore,tv,communities,messages,notifications") fail("Preview did not follow the move: " + moved.preview);

  await evaluate(`document.querySelector('[data-act="bottom-nav-toggle"][data-id="tv"]').click(); true`);
  await waitFor(`!document.querySelector('nav.bottom-nav a[href="#/tv"]')`, "hidden tv");
  const hiddenBar = JSON.parse(await evaluate(barExpr));
  const hiddenWant = ["#/", "#/explore", "#/communities", "#/messages", "#/notifications"];
  if (JSON.stringify(hiddenBar) !== JSON.stringify(hiddenWant)) fail("Bar after hiding TV " + JSON.stringify(hiddenBar));
  if (await evaluate(`!!document.querySelector('.bottom-nav-preview [data-preview-id="tv"]')`)) fail("Preview still shows TV");
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("[data-act=drawer]")].find((el) => getComputedStyle(el).display !== "none");
    btn.click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.drawer a[href="#/tv"]')`, "drawer tv");
  if (!(await evaluate(`!!document.querySelector('.drawer a[href="#/feeds"]')`))) fail("Hidden Feeds is missing from the drawer");

  const stored = await evaluate(`(() => {
    const data = JSON.parse(localStorage.getItem("viktorychapp-settings-v1"));
    return { custom: data.bottomNavCustom === true, hidden: (data.bottomNav.hidden || []).includes("tv") };
  })()`);
  if (!stored.custom || !stored.hidden) fail("Settings were not saved: " + JSON.stringify(stored));

  await page.send("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector("nav.bottom-nav a")`, "bar after reload");
  const reloaded = JSON.parse(await evaluate(barExpr));
  if (JSON.stringify(reloaded) !== JSON.stringify(hiddenWant)) fail("Reload lost the bar: " + JSON.stringify(reloaded));
  const still = await evaluate(`JSON.parse(localStorage.getItem("viktorychapp-settings-v1")).bottomNavCustom === true`);
  if (!still) fail("bottomNavCustom did not survive reload");

  const accounts = await evaluate(`(() => {
    const api = window.ViktorychAccounts;
    const saved = JSON.parse(localStorage.getItem("viktorychapp-settings-v1"));
    const snap = api.snapshotFrom(saved);
    const remoteWins = api.mergePayload(
      { bottomNavCustom: false, bottomNav: { order: ["home", "explore"], hidden: [] }, follows: [] },
      { bottomNavCustom: true, bottomNav: { order: ["messages", "home"], hidden: ["tv"] }, follows: [] }
    );
    const localWins = api.mergePayload(
      { bottomNavCustom: true, bottomNav: { order: ["explore", "home"], hidden: ["tv"] }, follows: [] },
      { bottomNavCustom: true, bottomNav: { order: ["messages", "home"], hidden: [] }, follows: [] }
    );
    return {
      snap: !!(snap.bottomNav && snap.bottomNavCustom === true && snap.bottomNav.hidden.includes("tv")),
      remote: remoteWins.bottomNav && remoteWins.bottomNav.order[0] === "messages",
      local: localWins.bottomNav && localWins.bottomNav.order[0] === "explore"
    };
  })()`);
  if (!accounts.snap || !accounts.remote || !accounts.local) fail("Account sync merge failed: " + JSON.stringify(accounts));

  async function assertLandscape(width, height) {
    await viewport(width, height, true);
    await sleep(80);
    const info = await evaluate(`(() => {
      const query = "(orientation: landscape) and (max-height: 520px) and (hover: none) and (pointer: coarse)";
      const land = document.querySelector("header.nav.nav-land");
      const label = land.querySelector("a.nav-item .nav-label");
      const center = document.querySelector(".center");
      let safe = false;
      [...document.styleSheets].forEach((sheet) => {
        try {
          [...sheet.cssRules].forEach((rule) => {
            const text = rule.cssText || "";
            if (text.includes("orientation: landscape") && text.includes("max-height: 520px") && text.includes("safe-area-inset-left")) safe = true;
          });
        } catch (err) {}
      });
      return {
        match: matchMedia(query).matches,
        hover: matchMedia("(hover: none)").matches,
        pointer: matchMedia("(pointer: coarse)").matches,
        land: getComputedStyle(land).display,
        labelDisplay: label ? getComputedStyle(label).display : "",
        labelText: label ? label.textContent.trim() : "",
        bar: getComputedStyle(document.querySelector("nav.bottom-nav")).display,
        side: getComputedStyle(document.querySelector("aside.side")).display,
        maxWidth: getComputedStyle(center).maxWidth,
        safe,
        direct: [...land.querySelectorAll(".nav-scroll > a.nav-item")].map((a) => a.getAttribute("href")),
        barHrefs: [...document.querySelectorAll("nav.bottom-nav a")].map((a) => a.getAttribute("href")),
        feedsDirect: !!land.querySelector('.nav-scroll > a.nav-item[href="#/feeds"]'),
        feedsMore: !!land.querySelector('.nav-land-more a[href="#/feeds"]'),
        tvMore: !!land.querySelector('.nav-land-more a[href="#/tv"]')
      };
    })()`);
    if (!info.match) fail(width + "x" + height + " did not match the phone landscape query " + JSON.stringify(info));
    if (info.land !== "flex") fail("Landscape sidebar display " + info.land);
    if (!info.labelText || info.labelDisplay === "none") fail("Landscape labels are hidden: " + JSON.stringify(info));
    if (info.bar !== "none") fail("Bottom bar still visible in landscape");
    if (info.side !== "none") fail("Right column is visible at " + width);
    if (info.maxWidth !== "600px") fail("Center max width is " + info.maxWidth);
    if (!info.safe) fail("Landscape rule is missing a left safe-area inset");
    if (JSON.stringify(info.direct) !== JSON.stringify(info.barHrefs)) fail("Sidebar links " + JSON.stringify(info.direct) + " vs bar " + JSON.stringify(info.barHrefs));
    if (info.feedsDirect || !info.feedsMore || !info.tvMore) fail("More menu is wrong: " + JSON.stringify(info));
    console.log("landscape", width + "x" + height, "ok");
  }

  await assertLandscape(915, 412);
  await assertLandscape(740, 360);

  const beforeScroll = await evaluate(`(() => {
    const main = document.querySelector("main.center") || document.querySelector(".center");
    main.insertAdjacentHTML("beforeend", '<video id="land-keep" data-token="stay"></video>');
    const video = document.getElementById("land-keep");
    video._keep = "yes";
    document.body.style.minHeight = "2400px";
    document.documentElement.style.minHeight = "2400px";
    window.scrollTo(0, 240);
    return { y: window.scrollY, top: video.getBoundingClientRect().top };
  })()`);
  await viewport(390, 844, false);
  await sleep(120);
  const kept = await evaluate(`(() => {
    const video = document.getElementById("land-keep");
    return {
      token: video ? video.dataset.token : "",
      keep: video ? video._keep : "",
      connected: !!(video && video.isConnected),
      y: window.scrollY,
      top: video ? video.getBoundingClientRect().top : 0,
      bar: getComputedStyle(document.querySelector("nav.bottom-nav")).display,
      land: getComputedStyle(document.querySelector("header.nav.nav-land")).display
    };
  })()`);
  if (kept.token !== "stay" || kept.keep !== "yes" || !kept.connected) fail("Rotation replaced the playing media: " + JSON.stringify(kept));
  if (kept.y < 80) fail("Rotation jumped away from the scrolled page: " + JSON.stringify(kept));
  if (Math.abs(kept.top - beforeScroll.top) > 12) fail("Rotation moved the media in view from " + beforeScroll.top + " to " + kept.top + " (scroll " + beforeScroll.y + " -> " + kept.y + ")");
  if (kept.bar !== "flex" || kept.land !== "none") fail("Rotation did not restore the bottom bar: " + JSON.stringify(kept));

  await evaluate(`(() => {
    window.ViktorychAccounts.applySnapshot({
      bottomNavCustom: true,
      bottomNav: {
        order: ["messages", "home", "explore", "tv", "communities", "notifications", "feeds", "lists", "history", "music", "shorts", "games", "subscriptions", "vault", "storage", "settings"],
        hidden: ["explore", "tv", "communities", "notifications", "feeds", "lists", "history", "music", "shorts", "games", "subscriptions", "vault", "storage", "settings"]
      }
    });
    return true;
  })()`);
  await waitFor(`${barExpr} === ${JSON.stringify(JSON.stringify(["#/messages", "#/"]))}`, "synced bar");

  await evaluate(`location.hash = "#/settings/display/navigation"; true`);
  await waitFor(`document.querySelector("[data-act=bottom-nav-reset]")`, "reset button");
  await evaluate(`document.querySelector("[data-act=bottom-nav-reset]").click(); true`);
  await waitFor(`${barExpr} === ${JSON.stringify(JSON.stringify(expectedDefault))}`, "default bar");
  const resetFlag = await evaluate(`JSON.parse(localStorage.getItem("viktorychapp-settings-v1")).bottomNavCustom === true`);
  if (!resetFlag) fail("Reset cleared the custom flag");

  console.log("bottom nav selftest ok");
  stop();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
