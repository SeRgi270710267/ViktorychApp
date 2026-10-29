/* Headless Chrome shots of the real UI for the public landing page.
   Demo labels only. Nothing here is a real account. */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};

const ID = "1".repeat(12);
const OTHER = "2".repeat(12);
const SVG = {
  heart: "M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z",
  star: "m12 3 2.4 5.6L20 9.2l-4 3.8.9 5.8L12 16.2 7.1 18.8 8 13 4 9.2l5.6-.6L12 3z",
  spark: "M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z",
  cake: "M4 14h16v4H4v-4zm2-3h12l-1-4H7l-1 4zm4-6h2v3h-2V5zm-3 3h2v2H7V8zm6 0h2v2h-2V8z",
  crown: "M4 16l2-8 4 4 2-6 2 6 4-4 2 8H4zm1 2h14v2H5v-2z"
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

function stamp(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function post(id, handle, name, text, hours) {
  const when = stamp(hours);
  return {
    id: id,
    statusId: id,
    platform: "app",
    feedId: "app:" + handle,
    kind: "post",
    author: name,
    handle: handle,
    name: name,
    avatar: "",
    text: text,
    date: when,
    sortDate: when,
    links: [],
    media: [],
    images: []
  };
}

function demoFeeds() {
  const feeds = [
    { id: "app:lumen", platform: "app", handle: "lumen", name: "Lumen", title: "Lumen", configured: true },
    { id: "app:pebble", platform: "app", handle: "pebble", name: "Pebble", title: "Pebble", configured: true },
    { id: "app:nimbus", platform: "app", handle: "nimbus", name: "Nimbus", title: "Nimbus", configured: true },
    { id: "app:quill", platform: "app", handle: "quill", name: "Quill", title: "Quill", configured: true }
  ];
  const posts = [
    post("p-lumen-1", "lumen", "Lumen", "Moss light on the quay. The tide chart reads like a short poem.", 1),
    post("p-pebble-1", "pebble", "Pebble", "Left a smooth stone on the step. It is still warm from the path.", 3),
    post("p-nimbus-1", "nimbus", "Nimbus", "The evening cloud sat low, then lifted just enough to show the hill.", 5),
    post("p-quill-1", "quill", "Quill", "Wrote three lines and kept the fourth. Some notes are better small.", 8)
  ];
  return { updated: stamp(0), preview: true, feeds: feeds, posts: posts };
}

function demoStories() {
  const later = new Date(Date.now() + 20 * 3600 * 1000).toISOString();
  function item(id) {
    return { id: id, type: "photo", url: "icons/icon-192.png", date: stamp(2), expires: later };
  }
  return {
    telegramConnected: false,
    accounts: [
      { id: "app:pebble", platform: "app", handle: "pebble", name: "Pebble", items: [item("s1")] },
      { id: "app:nimbus", platform: "app", handle: "nimbus", name: "Nimbus", items: [item("s2")] },
      { id: "app:quill", platform: "app", handle: "quill", name: "Quill", items: [item("s3")] }
    ]
  };
}

function aboutPack(owner, birthday) {
  return {
    owner: !!owner,
    visible: true,
    birthdayToday: !!birthday,
    birthdayNotes: true,
    sections: [
      {
        id: "personal",
        fields: [
          { id: "city", kind: "city", text: "Drift", label: "", audience: "public" },
          { id: "home", kind: "hometown", text: "Moss", label: "", audience: "followers" },
          { id: "day", kind: "birthday", text: "March 3", label: "", audience: "only" }
        ]
      }
    ]
  };
}

function catalog() {
  return {
    gifts: [
      { id: "heart", category: "kindness", price: 10, seasonal: false, svg: SVG.heart },
      { id: "star", category: "kindness", price: 25, seasonal: false, svg: SVG.star },
      { id: "spark", category: "celebrate", price: 50, seasonal: false, svg: SVG.spark },
      { id: "cake", category: "birthday", price: 15, seasonal: false, svg: SVG.cake },
      { id: "crown", category: "celebrate", price: 250, seasonal: false, svg: SVG.crown }
    ]
  };
}

function badges() {
  return {
    notices: [],
    badges: [
      { id: "streak", tier: "gold", earned: true, pinned: true, audience: "public", ratio: 1, nextTier: "", progress: 30, goal: 30 },
      { id: "story", tier: "silver", earned: true, pinned: true, audience: "followers", ratio: 0.66, nextTier: "gold", progress: 12, goal: 20 },
      { id: "live", tier: "bronze", earned: true, pinned: false, audience: "public", ratio: 0.4, nextTier: "silver", progress: 2, goal: 5 },
      { id: "author", tier: "", earned: false, pinned: false, audience: "public", ratio: 0.2, nextTier: "bronze", progress: 1, goal: 5 }
    ]
  };
}

function profile(handle, name, id, birthday) {
  return {
    account: {
      handle: handle,
      displayName: name,
      publicId: id,
      bio: "Short notes and quiet light.",
      avatar: "",
      banner: "",
      privateFollows: true,
      followers: 12,
      following: 4,
      friends: 3,
      birthdayToday: !!birthday
    },
    reposts: []
  };
}

function mockApi(url) {
  const path = url.pathname.replace(/^\/v1\//, "");
  if (path === "data/feeds.json") return { status: 200, body: demoFeeds() };
  if (path === "data/feeds.config.json") return { status: 200, body: {} };
  if (path === "notes") {
    return {
      status: 200,
      body: {
        mine: { text: "Drift light", audience: "followers" },
        notes: [
          { handle: "pebble", name: "Pebble", text: "Warm stone" },
          { handle: "nimbus", name: "Nimbus", text: "Low cloud" }
        ]
      }
    };
  }
  if (path === "highlights") {
    return {
      status: 200,
      body: {
        mine: true,
        highlights: [
          { id: "hl1", title: "Moss walk", cover: "icons/icon-192.png", crop: { x: 0, y: 0, w: 10000, h: 10000 } },
          { id: "hl2", title: "Quay", cover: "icons/icon-192.png", crop: { x: 0, y: 0, w: 10000, h: 10000 } }
        ]
      }
    };
  }
  if (path === "about/upcoming") {
    return {
      status: 200,
      body: {
        notes: true,
        upcoming: [
          { handle: "pebble", name: "Pebble", inDays: 0 },
          { handle: "nimbus", name: "Nimbus", inDays: 4 }
        ]
      }
    };
  }
  if (path.indexOf("about") === 0) {
    const who = url.searchParams.get("handle") || "lumen";
    const mine = who === "lumen";
    return { status: 200, body: aboutPack(mine, who === "pebble") };
  }
  if (path.indexOf("profile/") === 0) {
    const handle = decodeURIComponent(path.slice("profile/".length));
    if (handle === "pebble") return { status: 200, body: profile("pebble", "Pebble", OTHER, true) };
    return { status: 200, body: profile("lumen", "Lumen", ID, false) };
  }
  if (path === "gifts/catalog") return { status: 200, body: catalog() };
  if (path.indexOf("gifts") === 0) {
    return {
      status: 200,
      body: {
        hidden: false,
        gifts: [{ id: "g1", svg: SVG.heart, message: "For the quay.", sender: { name: "Pebble", handle: "pebble" }, hidden: false }]
      }
    };
  }
  if (path === "live") {
    return { status: 200, body: { lives: [{ id: "ab".repeat(16), hostName: "Pebble", title: "Quay light" }] } };
  }
  if (path === "presence") {
    return { status: 200, body: { emoji: "✨", text: "Quiet hour", preference: "online", seenPrivacy: "everyone", state: "online" } };
  }
  if (path === "points") {
    return { status: 200, body: { balance: 80, rules: [{ id: "login", points: 5 }], history: [{ reason: "login", delta: 5 }] } };
  }
  if (path === "audience-lists/people") {
    return { status: 200, body: { people: [{ handle: "pebble", name: "Pebble" }, { handle: "nimbus", name: "Nimbus" }] } };
  }
  if (path === "audience-lists") {
    return {
      status: 200,
      body: {
        lists: [{
          id: "moss",
          name: "Moss",
          icon: "🌿",
          members: [{ handle: "pebble", name: "Pebble" }]
        }]
      }
    };
  }
  if (path === "badges" || path.indexOf("badges?") === 0) return { status: 200, body: badges() };
  if (path === "stories") return { status: 200, body: demoStories() };
  if (path === "story-bar") return { status: 404, body: {} };
  return { status: 200, body: {} };
}

function sessionScript() {
  const settings = {
    version: 1,
    initialized: true,
    appearance: "lightsout",
    follows: ["app:lumen", "app:pebble", "app:nimbus", "app:quill"],
    lists: [
      { id: "moss", name: "Moss", description: "Quiet reads", pinned: true, bannerColor: "#1d9bf0", members: ["app:pebble", "app:nimbus"], sort: "recent" },
      { id: "quay", name: "Quay", description: "Evening notes", pinned: false, bannerColor: "#7856ff", members: ["app:quill"], sort: "recent" }
    ],
    likes: {},
    bookmarks: {},
    reposts: {},
    storyNotes: true,
    privateFollows: true
  };
  const session = {
    token: "demo-session",
    account: {
      handle: "lumen",
      displayName: "Lumen",
      publicId: ID,
      bio: "Short notes and quiet light.",
      privateFollows: true
    }
  };
  return `(() => {
    localStorage.setItem("viktorychapp-lang-user-picked", "1");
    localStorage.setItem("superintelapp-lang", "en");
    localStorage.setItem("viktorychapp-settings-v1", ${JSON.stringify(JSON.stringify(settings))});
    localStorage.setItem("viktorychapp-account-v1", ${JSON.stringify(JSON.stringify(session))});
    localStorage.setItem("viktorychapp-welcome-v1", JSON.stringify({ step: 0, done: true }));
    window.VIKTORYCH_ACCOUNTS = { api: location.origin, gate: true, turnstileSiteKey: "", tiktokAudience: "owner" };
  })()`;
}

function serve(rootDir) {
  const base = resolve(rootDir);
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/accounts.config.js") {
      const body = "window.VIKTORYCH_ACCOUNTS = window.VIKTORYCH_ACCOUNTS && window.VIKTORYCH_ACCOUNTS.gate ? window.VIKTORYCH_ACCOUNTS : { api: location.origin, gate: true, turnstileSiteKey: \"\", tiktokAudience: \"owner\" };\n";
      res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (url.pathname === "/feeds.json" || url.pathname === "/v1/data/feeds.json") {
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(demoFeeds()));
      return;
    }
    if (url.pathname === "/stories.json") {
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(demoStories()));
      return;
    }
    if (url.pathname === "/people.json") {
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end("{\"people\":[]}");
      return;
    }
    if (url.pathname.indexOf("/v1/") === 0) {
      const hit = mockApi(url);
      res.writeHead(hit.status, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(hit.body));
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = resolve(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
    }
  });
  return new Promise((resolveReady) => {
    server.listen(0, "127.0.0.1", () => resolveReady({ server, port: server.address().port }));
  });
}

async function loadChromium() {
  const spec = process.env.PLAYWRIGHT_CORE || "/tmp/pw-land/node_modules/playwright-core/index.js";
  const href = spec.startsWith("/") ? pathToFileURL(spec).href : spec;
  const mod = await import(href);
  return mod.chromium || (mod.default && mod.default.chromium);
}

function toWebp(png, dest) {
  const bin = "ffmpeg";
  const run = spawnSync(bin, [
    "-y", "-i", png,
    "-vf", "scale=828:-1",
    "-c:v", "libwebp",
    "-quality", "68",
    dest
  ], { encoding: "utf8" });
  if (run.status !== 0) throw new Error("webp failed for " + dest);
  const size = statSync(dest).size;
  if (size < 800) throw new Error("webp too small " + dest);
}

async function waitFor(page, check, label) {
  try {
    await page.waitForFunction(check, null, { timeout: 25000 });
  } catch (err) {
    const info = await page.evaluate(() => ({
      wall: document.documentElement.getAttribute("data-wall") || "",
      posts: document.querySelectorAll("article.post").length,
      stories: document.querySelectorAll(".story-card").length,
      hash: location.hash
    }));
    throw new Error(label + " missing " + JSON.stringify(info));
  }
}

async function clickAct(page, act) {
  const hit = await page.evaluate((name) => {
    const el = document.querySelector('[data-act="' + name + '"]');
    if (!el) return false;
    el.click();
    return true;
  }, act);
  if (!hit) throw new Error("missing control " + act);
}

async function gotoHash(page, hash) {
  await page.evaluate((next) => { location.hash = next; }, hash);
  await page.waitForTimeout(400);
}

async function shoot(page, png) {
  await page.screenshot({ path: png, fullPage: false, animations: "disabled" });
}

async function captureApp(browser, origin, outDir, only) {
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    colorScheme: "dark",
    reducedMotion: "reduce"
  });
  await context.addInitScript(sessionScript());
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("data:")) route.continue();
    else route.abort();
  });
  const want = (name) => !only || only.has(name);
  const tmp = join(tmpdir(), "land-shot");
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  async function save(name) {
    const png = join(tmp, name + ".png");
    await shoot(page, png);
    toWebp(png, join(outDir, name + ".webp"));
    console.log("shot " + name);
  }

  await page.goto(origin + "/#/", { waitUntil: "domcontentloaded" });
  await waitFor(page, () => document.querySelectorAll("article.post").length >= 2, "timeline");
  await waitFor(page, () => document.querySelectorAll(".story-card").length >= 1, "story tray");
  if (want("timeline")) await save("timeline");

  if (want("notes")) {
    await waitFor(page, () => document.querySelector("[data-story-act='note']"), "note bubble");
    await page.evaluate(() => document.querySelector("[data-story-act='note']").click());
    await waitFor(page, () => document.querySelector(".note-sheet"), "note sheet");
    await save("notes");
    await page.evaluate(() => { if (window.Stories && window.Stories.close) window.Stories.close(); });
    await page.waitForTimeout(400);
  }

  if (want("stories")) {
    await waitFor(page, () => document.querySelector(".story-card:not(.note-slot) .story-main[data-act='story']"), "story card");
    const opened = await page.evaluate(() => {
      const el = document.querySelector(".story-card:not(.note-slot) .story-main[data-act='story']");
      const id = el ? el.getAttribute("data-id") || "" : "";
      if (window.Stories && window.Stories.open && id) {
        window.Stories.open(id);
        return id;
      }
      if (el) el.click();
      return id || "click";
    });
    if (!opened) throw new Error("story card missing");
    await waitFor(page, () => document.querySelector("#stories .story-frame"), "story viewer");
    await save("stories");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  if (want("highlights") || want("details")) {
    await gotoHash(page, "#/@lumen");
    await waitFor(page, () => document.querySelector(".hl-row"), "highlights");
    if (want("highlights")) await save("highlights");
    if (want("details")) {
      await page.evaluate(() => {
        const link = document.querySelector("a[href*='tab=about']");
        if (link) link.click();
      });
      await waitFor(page, () => /Personal details/.test(document.body.innerText || ""), "personal details");
      await save("details");
    }
  }

  if (want("birthdays")) {
    await gotoHash(page, "#/@pebble");
    await waitFor(page, () => document.querySelector(".bday-banner"), "birthday");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const banner = document.querySelector(".bday-banner");
      if (banner && banner.scrollIntoView) banner.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(200);
    await save("birthdays");
  }

  if (want("lists")) {
    await gotoHash(page, "#/settings/privacy");
    await waitFor(page, () => document.querySelector(".aud-settings"), "audience lists");
    await page.evaluate(() => {
      const el = document.querySelector(".aud-settings");
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(200);
    await save("lists");
  }

  if (want("store")) {
    await gotoHash(page, "#/store");
    await waitFor(page, () => document.querySelector(".gift-card"), "store");
    await save("store");
  }

  if (want("live")) {
    await gotoHash(page, "#/");
    await page.waitForTimeout(500);
    await clickAct(page, "go-live");
    await waitFor(page, () => document.querySelector(".live-sheet"), "live sheet");
    await save("live");
    await page.evaluate(() => {
      const el = document.querySelector("[data-act='live-close']");
      if (el) el.click();
      const layer = document.getElementById("live-layer");
      if (layer) layer.remove();
    });
    await page.waitForTimeout(200);
  }

  if (want("sidebar")) {
    await clickAct(page, "open-nav-customize");
    await waitFor(page, () => document.querySelector(".nav-customize-modal"), "sidebar");
    await save("sidebar");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  if (want("status")) {
    const opened = await page.evaluate(() => {
      const el = document.querySelector("[data-acct='presence-open']");
      if (el) { el.click(); return true; }
      if (window.ViktorychPresence && window.ViktorychPresence.open) {
        window.ViktorychPresence.open(document.body);
        return true;
      }
      return false;
    });
    if (!opened) throw new Error("presence control missing");
    await waitFor(page, () => {
      const input = document.querySelector("[data-presence-emoji]");
      return input && !input.closest("[hidden]");
    }, "emoji status");
    await save("status");
    await page.keyboard.press("Escape");
  }

  if (want("pwa")) {
    await gotoHash(page, "#/settings/resources");
    await waitFor(page, () => document.querySelector("[data-act='install']"), "install button");
    await clickAct(page, "install");
    await waitFor(page, () => document.querySelector(".install-sheet"), "install sheet");
    await save("pwa");
  }

  await context.close();
}

async function captureSafari(browser, origin, outDir) {
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    colorScheme: "dark",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 13_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true
  });
  await context.addInitScript(sessionScript());
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) route.continue();
    else route.abort();
  });
  await page.goto(origin + "/#/settings/resources", { waitUntil: "domcontentloaded" });
  await waitFor(page, () => document.querySelector("[data-act='install']"), "safari install");
  await clickAct(page, "install");
  await waitFor(page, () => /Safari/.test(document.body.innerText || ""), "safari steps");
  const png = join(tmpdir(), "land-safari.png");
  await shoot(page, png);
  toWebp(png, join(outDir, "safari.webp"));
  console.log("shot safari");
  await context.close();
}

async function captureBadges(browser, origin, outDir) {
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    serviceWorkers: "block",
    colorScheme: "dark"
  });
  await context.addInitScript(sessionScript());
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) route.continue();
    else route.abort();
  });
  await page.goto(origin + "/#/@lumen?tab=about", { waitUntil: "domcontentloaded" });
  await waitFor(page, () => /Badges/.test(document.body.innerText || "") && document.querySelector(".bdg-row"), "badges");
  const png = join(tmpdir(), "land-badges.png");
  await shoot(page, png);
  toWebp(png, join(outDir, "badges.webp"));
  console.log("shot badges");
  await context.close();
}

async function captureLanding(browser, origin) {
  const dir = "/opt/cursor/artifacts";
  mkdirSync(dir, { recursive: true });
  const sizes = [
    ["landing-phone.png", 414, 896],
    ["landing-desktop.png", 1280, 800]
  ];
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size[1], height: size[2] },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      colorScheme: "dark"
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) route.continue();
      else route.abort();
    });
    await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const h1 = document.querySelector(".land-hero h1");
      return h1 && /Viktorych/.test(h1.textContent || "");
    }, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(dir, size[0]), fullPage: false });
    await page.evaluate(() => {
      const frame = document.querySelector(".land-device");
      if (frame && frame.scrollIntoView) frame.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(300);
    const feature = size[0].replace(".png", "-feature.png");
    await page.screenshot({ path: join(dir, feature), fullPage: false });
    console.log("landing " + size[0]);
    await context.close();
  }
}

async function checkLanding(browser, origin) {
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    serviceWorkers: "block",
    colorScheme: "dark",
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("pageerror " + String(err && err.message || err).slice(0, 300)));
  await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
  console.log("opened");
  await page.waitForSelector(".land-hero h1");
  console.log("hero");
  await page.waitForFunction(() => document.querySelectorAll(".land-device img").length >= 14);
  const layout = await page.evaluate(() => {
    const bar = document.querySelector(".land-bar");
    const signup = document.querySelector(".land-bar [data-acct='signup']");
    const login = document.querySelector(".land-bar [data-acct='login']");
    const box = (el) => el ? el.getBoundingClientRect() : null;
    const motion = getComputedStyle(document.querySelector(".land-block") || document.body).animationName;
    return {
      wall: document.documentElement.getAttribute("data-wall"),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      signup: box(signup),
      login: box(login),
      bar: bar ? getComputedStyle(bar).position : "",
      motion,
      shots: document.querySelectorAll(".land-device img").length
    };
  });
  if (layout.wall !== "1") throw new Error("wall missing");
  if (layout.overflow > 1) throw new Error("overflow " + layout.overflow);
  if (!layout.signup || layout.signup.top < 0 || layout.signup.bottom > 896) throw new Error("signup not sticky");
  if (!layout.login || layout.login.bottom > 896) throw new Error("login not sticky");
  if (layout.bar !== "sticky") throw new Error("bar " + layout.bar);
  if (layout.motion !== "none") throw new Error("reduced motion " + layout.motion);
  if (layout.shots < 14) throw new Error("shots " + layout.shots);
  console.log("layout", JSON.stringify(layout));
  await page.evaluate(() => document.querySelector(".land-bar [data-acct='signup']").click());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    modal: !!document.querySelector(".acct-modal"),
    modalText: ((document.querySelector(".acct-modal") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 300),
    accounts: !!(window.ViktorychAccounts && window.ViktorychAccounts.blocking)
  }));
  console.log("after", JSON.stringify(after));
  if (!/Create your account/.test(after.modalText || "")) throw new Error("signup modal missing");
  const closed = await page.evaluate(() => {
    const el = document.querySelector(".acct-modal [data-acct='close']");
    if (el) el.click();
    return !!el;
  });
  console.log("close clicked", closed);
  await page.waitForTimeout(300);
  const still = await page.evaluate(() => !!document.querySelector(".acct-modal"));
  console.log("modal still", still);
  if (still) throw new Error("modal stayed open");
  await page.evaluate(() => document.querySelector(".land-bar [data-acct='login']").click());
  await page.waitForTimeout(400);
  const loginText = await page.evaluate(() => ((document.querySelector(".acct-modal") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 180));
  console.log("login", loginText);
  if (!/Sign in to /.test(loginText)) throw new Error("login modal missing");
  await page.evaluate(() => { const el = document.querySelector(".acct-modal [data-acct='close']"); if (el) el.click(); });
  await page.evaluate(() => document.querySelector("[data-acct='lang'][data-lang='ru']").click());
  await page.waitForTimeout(400);
  const ru = await page.evaluate(() => (document.querySelector(".land-hero h1") || {}).textContent || "");
  console.log("ru heading", ru);
  if (!/Викторыч/.test(ru)) throw new Error("language did not switch");
  await page.evaluate(() => document.querySelector("[data-acct='legal'][data-legal='privacy']").click());
  await page.waitForTimeout(300);
  const legal = await page.evaluate(() => ((document.querySelector(".acct-modal") || {}).innerText || "").slice(0, 180));
  console.log("legal", legal);
  if (!/конфиденциальн|Privacy|приват/i.test(legal)) throw new Error("privacy page missing");
  for (const size of [[390, 844], [844, 390], [1280, 800], [414, 896]]) {
    const wide = await browser.newContext({ viewport: { width: size[0], height: size[1] }, serviceWorkers: "block", colorScheme: "dark" });
    const p = await wide.newPage();
    await p.goto(origin + "/", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => document.querySelectorAll(".land-device img").length >= 14);
    const row = await p.evaluate((h) => {
      const signup = document.querySelector(".land-bar [data-acct='signup']");
      const login = document.querySelector(".land-bar [data-acct='login']");
      const box = (el) => el ? el.getBoundingClientRect() : null;
      const s = box(signup);
      const l = box(login);
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        signup: s && s.top >= -1 && s.bottom <= h + 1 && s.left >= -1,
        login: l && l.top >= -1 && l.bottom <= h + 1
      };
    }, size[1]);
    if (row.overflow > 1 || !row.signup || !row.login) throw new Error("viewport " + size.join("x") + " " + JSON.stringify(row));
    await wide.close();
  }
  console.log("landing checks ok");
  await context.close();

  const signed = await browser.newContext({ viewport: { width: 414, height: 896 }, serviceWorkers: "block" });
  await signed.addInitScript(sessionScript());
  const signedPage = await signed.newPage();
  await signedPage.goto(origin + "/", { waitUntil: "domcontentloaded" });
  await signedPage.waitForTimeout(800);
  const skipped = await signedPage.evaluate(() => ({
    wall: document.documentElement.getAttribute("data-wall") || "",
    land: !!document.querySelector(".land-page")
  }));
  if (skipped.wall === "1" || skipped.land) throw new Error("signed-in saw landing " + JSON.stringify(skipped));
  console.log("signed-in skips landing");
  await signed.close();

  const pwa = await browser.newContext({ viewport: { width: 414, height: 896 }, serviceWorkers: "block" });
  await pwa.addInitScript(() => {
    const orig = window.matchMedia ? window.matchMedia.bind(window) : null;
    window.matchMedia = function (query) {
      if (String(query).indexOf("display-mode: standalone") >= 0) {
        return { matches: true, media: query, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
      }
      return orig ? orig(query) : { matches: false, media: query, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
    };
    try { Object.defineProperty(navigator, "standalone", { configurable: true, get: function () { return true; } }); } catch (err) { /* the media query still counts */ }
  });
  const pwaPage = await pwa.newPage();
  await pwaPage.goto(origin + "/", { waitUntil: "domcontentloaded" });
  await pwaPage.waitForTimeout(1200);
  const installed = await pwaPage.evaluate(() => ({
    wall: document.documentElement.getAttribute("data-wall") || "",
    land: !!document.querySelector(".land-page"),
    login: !!document.querySelector(".acct-modal")
  }));
  if (installed.land || installed.wall === "1") throw new Error("installed app saw landing " + JSON.stringify(installed));
  if (!installed.login) throw new Error("installed app did not open sign-in " + JSON.stringify(installed));
  console.log("installed app skips landing");
  await pwa.close();
}

async function main() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const rootDir = resolve(arg("--root", join(here, "..")));
  const outDir = resolve(arg("--out", join(rootDir, "landing")));
  const onlyRaw = arg("--only", "");
  const only = onlyRaw ? new Set(onlyRaw.split(",")) : null;
  const landingOnly = process.argv.indexOf("--landing") >= 0;
  const checkOnly = process.argv.indexOf("--check") >= 0;
  const { server, port } = await serve(rootDir);
  const origin = "http://127.0.0.1:" + port;
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  try {
    if (checkOnly) await checkLanding(browser, origin);
    else if (landingOnly) await captureLanding(browser, origin);
    else if (only && only.has("badges") && only.size === 1) await captureBadges(browser, origin, outDir);
    else {
      await captureApp(browser, origin, outDir, only);
      if (!only || only.has("safari")) await captureSafari(browser, origin, outDir);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
