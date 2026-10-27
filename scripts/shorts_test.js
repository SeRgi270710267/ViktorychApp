const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock environment for Node.js
const storage = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};

global.location = {
  href: "http://localhost:8080/#/shorts",
  hash: "#/shorts",
  search: "",
  pathname: "/"
};

global.navigator = { userAgent: "test", plugins: [] };
global.window = global;
global.t = (k) => k;
global.esc = (s) => String(s == null ? "" : s);
global.VIKTORYCH_ACCOUNTS = { api: "http://localhost:8787", gate: true, tiktokAudience: "owner" };
global.ViktorychAccounts = {
  account: () => ({ handle: "owner_user", owner: true }),
  token: () => "mock-token"
};

const mockElements = {};
global.document = {
  body: {
    appendChild: (el) => {
      if (el && el.id) mockElements[el.id] = el;
      return el;
    }
  },
  documentElement: {
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    }
  },
  createElement: (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      attributes: {},
      setAttribute: (k, v) => { el.attributes[k] = String(v); },
      getAttribute: (k) => el.attributes[k],
      querySelector: () => null,
      querySelectorAll: () => [],
      classList: { add: () => {}, remove: () => {} }
    };
    return el;
  },
  getElementById: (id) => mockElements[id] || null,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Load shorts.js
const shortsCode = fs.readFileSync(path.join(__dirname, "../shorts.js"), "utf8");
eval(shortsCode);

assert(global.ViktorychShorts, "ViktorychShorts must be exported on window");
const shorts = global.ViktorychShorts;

assert.strictEqual(typeof shorts.isLocked, "function", "isLocked must be a function");
assert.strictEqual(typeof shorts.isUnlocked, "function", "isUnlocked must be a function");
assert.strictEqual(typeof shorts.setLocked, "function", "setLocked must be a function");
assert.strictEqual(typeof shorts.toggleLock, "function", "toggleLock must be a function");
assert.strictEqual(typeof shorts.showCaptcha, "function", "showCaptcha must be a function");
assert.strictEqual(typeof shorts.closeCaptcha, "function", "closeCaptcha must be a function");
assert.strictEqual(typeof global.showTikTokCaptcha, "function", "window.showTikTokCaptcha must be a function");

// Bind mock hooks
shorts.bind({
  icon: (name) => `<svg class="${name}"></svg>`,
  esc: (v) => String(v == null ? "" : v),
  avatar: (src, name) => `<img src="${src || ''}" alt="${name || ''}">`,
  formatCount: (n) => String(n || 0),
  fullTime: (iso) => iso || "",
  posts: () => [
    {
      id: "tiktok:gabii_g5:1",
      platform: "tiktok",
      handle: "gabii_g5",
      author: "Gabii",
      text: "Dance video #dance",
      url: "https://www.tiktok.com/@gabii_g5/video/1",
      media: [{ type: "video", url: "https://example.com/v1.mp4" }]
    },
    {
      id: "youtube:short1",
      platform: "youtube",
      short: true,
      handle: "yt_creator",
      author: "Creator",
      text: "Fun clip",
      url: "https://youtube.com/shorts/short1",
      media: [{ type: "video", url: "https://example.com/v2.mp4" }]
    }
  ],
  data: () => ({ feeds: [], posts: [] }),
  settings: () => ({ follows: [], likes: {}, bookmarks: {} }),
  save: () => {},
  toggle: () => false,
  token: () => "mock-token",
  productName: () => "ViktorychApp",
  logo: () => "<svg class=\"logo\"></svg>"
});

console.log("Testing default locked state (initial state)...");
assert.strictEqual(shorts.isLocked(), true, "Shorts should be locked by default");

console.log("Testing unlocked mode...");
shorts.setLocked(false);
assert.strictEqual(shorts.isLocked(), false, "Shorts should be unlocked");

const liveHtmlUnlocked = shorts.page({ live: true });
assert(liveHtmlUnlocked.includes("@pepsi"), "Unlocked live must include @pepsi");
assert(liveHtmlUnlocked.includes("@gabii_g5"), "Unlocked live must include current account @gabii_g5");
assert(liveHtmlUnlocked.includes("data-shorts=\"toggle-lock\""), "Live HTML must include lock button");
assert(liveHtmlUnlocked.includes("tiktok-captcha-modal"), "Live HTML must include captcha modal");

const forYouHtmlUnlocked = shorts.page({ live: false });
assert(forYouHtmlUnlocked.includes("@pepsi"), "Unlocked For You must include @pepsi");
assert(forYouHtmlUnlocked.includes("@gabii_g5"), "Unlocked For You must include @gabii_g5");
assert(forYouHtmlUnlocked.includes("@yt_creator"), "Unlocked For You must include @yt_creator");
assert(forYouHtmlUnlocked.includes("tiktok-captcha-modal"), "For You HTML must include captcha modal");

console.log("Testing locked mode in Shorts...");
shorts.setLocked(true);
assert.strictEqual(shorts.isLocked(), true, "Shorts should be locked");

const liveHtmlLocked = shorts.page({ live: true });
assert(liveHtmlLocked.includes("@pepsi"), "Locked live must include unlocked account @pepsi");
assert(!liveHtmlLocked.includes("@gabii_g5"), "Locked live must lock behind @gabii_g5");
assert(liveHtmlLocked.includes("is-locked"), "Lock button must have is-locked class");

const forYouHtmlLocked = shorts.page({ live: false });
assert(forYouHtmlLocked.includes("@pepsi"), "Locked For You must include unlocked account @pepsi");
assert(!forYouHtmlLocked.includes("@gabii_g5"), "Locked For You must lock behind @gabii_g5");
assert(!forYouHtmlLocked.includes("@yt_creator"), "Locked For You must lock behind youtube creator");

console.log("Testing lock toggle...");
shorts.toggleLock();
assert.strictEqual(shorts.isLocked(), false, "toggleLock should unlock");
shorts.toggleLock();
assert.strictEqual(shorts.isLocked(), true, "toggleLock should lock again");

console.log("Testing account sheet...");
assert(liveHtmlLocked.includes("shorts-lock-panel"), "Account sheet must contain locked mode panel");
assert(liveHtmlLocked.includes("Unlocked accounts"), "Account sheet must contain Unlocked accounts heading");
assert(liveHtmlLocked.includes("added accounts"), "Account sheet must contain added accounts heading");
assert(liveHtmlUnlocked.includes("@gabii_g5"), "Account sheet must list @gabii_g5 under locked accounts when unlocked");
assert(liveHtmlUnlocked.includes("Locked behind"), "Account sheet must show Locked behind pill");

console.log("Testing site-wide isolation when locked...");
assert.strictEqual(shorts.isUnlocked("pepsi"), true, "pepsi is unlocked");
assert.strictEqual(shorts.isUnlocked("gabii_g5"), false, "gabii_g5 is locked");

// Mock site data with TikTok accounts
const sitePosts = [
  { id: "x:1", platform: "x", handle: "redacted_handle", text: "Mars!" },
  { id: "tiktok:pepsi:pinned", platform: "tiktok", handle: "pepsi", text: "Pepsi post" },
  { id: "tiktok:gabii_g5:1", platform: "tiktok", handle: "gabii_g5", text: "Secret dance" },
  { id: "tiktok:another_locked:1", platform: "tiktok", handle: "another_locked", text: "Hidden" }
];

const siteFeeds = [
  { id: "x:redacted_handle", platform: "x", handle: "redacted_handle", name: "Elon Musk" },
  { id: "tiktok:pepsi", platform: "tiktok", handle: "pepsi", name: "Pepsi" },
  { id: "tiktok:gabii_g5", platform: "tiktok", handle: "gabii_g5", name: "Gabii" },
  { id: "tiktok:another_locked", platform: "tiktok", handle: "another_locked", name: "Another" }
];

function isShortsLocked() {
  return window.ViktorychShorts && window.ViktorychShorts.isLocked();
}

function isTiktokUnlocked(handle) {
  if (window.ViktorychShorts && window.ViktorychShorts.isUnlocked) {
    return window.ViktorychShorts.isUnlocked(handle);
  }
  return String(handle || "").toLowerCase().replace(/^@/, "") === "pepsi";
}

function isLockedTiktok(entity) {
  if (!entity) return false;
  const platform = entity.platform || (entity.id && String(entity.id).startsWith("tiktok:") ? "tiktok" : "");
  if (platform !== "tiktok") return false;
  return isShortsLocked() && !isTiktokUnlocked(entity.handle || entity.account);
}

// When locked:
shorts.setLocked(true);
const lockedVisiblePosts = sitePosts.filter((p) => !isLockedTiktok(p));
assert(lockedVisiblePosts.some((p) => p.handle === "pepsi"), "Pepsi post should be visible while locked");
assert(lockedVisiblePosts.some((p) => p.handle === "redacted_handle"), "Non-tiktok posts should be visible");
assert(!lockedVisiblePosts.some((p) => p.handle === "gabii_g5"), "Locked TikTok account gabii_g5 must NOT be visible");
assert(!lockedVisiblePosts.some((p) => p.handle === "another_locked"), "Locked TikTok account another_locked must NOT be visible");

const lockedVisibleFeeds = siteFeeds.filter((f) => !isLockedTiktok(f));
assert(lockedVisibleFeeds.some((f) => f.handle === "pepsi"), "Pepsi feed should be visible while locked");
assert(!lockedVisibleFeeds.some((f) => f.handle === "gabii_g5"), "Locked TikTok account gabii_g5 feed must NOT be visible");
assert(!lockedVisibleFeeds.some((f) => f.handle === "another_locked"), "Locked TikTok account another_locked feed must NOT be visible");

// When unlocked:
shorts.setLocked(false);
const unlockedVisiblePosts = sitePosts.filter((p) => !isLockedTiktok(p));
assert.strictEqual(unlockedVisiblePosts.length, sitePosts.length, "All posts visible when unlocked");
const unlockedVisibleFeeds = siteFeeds.filter((p) => !isLockedTiktok(p));
assert.strictEqual(unlockedVisibleFeeds.length, siteFeeds.length, "All feeds visible when unlocked");

console.log("Testing captcha modal APIs...");
let retryCalled = false;
const mockModal = { hidden: true, setAttribute: () => {} };
mockElements["tiktok-captcha-modal"] = mockModal;
shorts.showCaptcha({
  handle: "pepsi",
  url: "https://www.tiktok.com/@pepsi/live",
  onRetry: () => { retryCalled = true; }
});
assert.strictEqual(mockModal.hidden, false, "Modal must be shown after showCaptcha");
shorts.closeCaptcha();
assert.strictEqual(mockModal.hidden, true, "Modal must be hidden after closeCaptcha");

console.log("Testing live order, past lives, and playback steps...");
shorts.setLocked(false);
const ordered = shorts.orderLiveNow([
  { handle: "gabii_g5", live: true, viewers: 40 },
  { handle: "pepsi", live: true, viewers: 2 },
  { handle: "other", live: false, viewers: 0 }
], []);
assert.deepStrictEqual(ordered.map((row) => row.handle), ["pepsi", "gabii_g5", "other"]);
assert.strictEqual(shorts.neighborHandle(ordered, "pepsi", 1), "gabii_g5");
assert.strictEqual(shorts.neighborHandle(ordered, "gabii_g5", -1), "pepsi");
assert.strictEqual(shorts.neighborHandle(ordered, "pepsi", -1), "");
const tied = shorts.orderLiveNow([
  { handle: "b_name", live: true, viewers: 5 },
  { handle: "a_name", live: true, viewers: 5 }
], ["b_name", "a_name"]);
assert.strictEqual(tied[0].handle, "b_name");
shorts.setLiveState([
  { handle: "gabii_g5", live: true, viewers: 40 },
  { handle: "pepsi", live: true, viewers: 2 }
]);
const nowHtml = shorts.page({ live: true, livePane: "now" });
assert(nowHtml.includes("shorts-preview"), "A live card has a muted preview video");
assert(nowHtml.includes("Live now"), "Live now sub-tab is present");
assert(nowHtml.includes("Past lives"), "Past lives sub-tab is present");
assert(nowHtml.indexOf("@pepsi") < nowHtml.indexOf("@gabii_g5"), "Fewer viewers stay above more viewers");
assert(!nowHtml.includes('data-shorts="saved"'), "Live now does not embed past playback");
const emptyPast = shorts.page({ live: true, livePane: "past" });
assert(emptyPast.includes("No recordings yet."), "An empty past list says there are no recordings yet");
shorts.setRecordings({
  cap: 12,
  active: 1,
  items: {
    gabii_g5: { state: "recording", endedAt: "2026-10-02T00:00:00Z", title: "current-only" },
    pepsi: { state: "saved", key: "tiktok/pepsi/1/live", endedAt: "2026-10-01T00:00:00Z" }
  },
  past: [
    { handle: "gabii_g5", state: "recording", startedAt: "2026-10-02T00:00:00Z", key: "tiktok/gabii_g5/1/live" },
    { handle: "pepsi", state: "saved", startedAt: "2026-10-01T00:00:00Z", key: "tiktok/pepsi/1/live", title: "earlier", bytes: 2 * 1024 * 1024, duration: 125, roomId: "7699647509498710805", thumb: "owner/live-thumbs/pepsi/7699647509498710805.mp4" }
  ]
});
const pastHtml = shorts.page({ live: true, livePane: "past" });
assert(pastHtml.indexOf("@gabii_g5") < pastHtml.indexOf("@pepsi"), "Past lives are newest first");
assert(pastHtml.includes("Recording ({n} of {cap})"), "In-progress captures are marked Recording");
assert(pastHtml.includes("earlier"), "Past lives read the per-handle history");
assert(!pastHtml.includes("current-only"), "Past lives do not fall back to the current row when history exists");
assert(pastHtml.includes(">2<"), "Past lives count badge is shown");
assert(pastHtml.includes("Size {size}"), "Past lives show the recording size");
assert(pastHtml.includes("2:05"), "Past lives show the duration");
assert(pastHtml.includes("data-thumb="), "A stored keyframe is the card thumbnail");
assert(pastHtml.includes("Download original") === false, "Download stays inside the player");
assert.strictEqual(shorts.formatBytes(1536), "1.5 KB");
assert.equal(shorts.previewsAllowed("auto", true, "all", "wifi"), false);
assert.equal(shorts.previewsAllowed("on", true, "never", "cellular"), true);
assert.equal(shorts.previewsAllowed("off", false, "all", "wifi"), false);
assert.equal(shorts.previewsAllowed("auto", false, "never", "wifi"), false);
assert.equal(shorts.lowestPreview({ variants: [{ quality: "origin", hls: "https://cdn.example/o.m3u8" }, { quality: "ld", hls: "https://cdn.example/l.m3u8" }, { quality: "ao", flv: "https://cdn.example/a.flv" }] }).url, "https://cdn.example/l.m3u8");
localStorage.setItem("viktorych_shorts_live_pane", "past");
const remembered = shorts.page({ live: true });
assert(remembered.includes('class="tab on" href="#/shorts/live/past"'), "The past sub-tab stays selected");
assert.strictEqual(shorts.hlsFatalPlan("mediaError", 0, true), "recover-media");
assert.strictEqual(shorts.hlsFatalPlan("networkError", 0, true), "live-edge");
const steps = shorts.playbackSteps({
  variants: [
    { quality: "origin", hls: "https://cdn.example/o.m3u8?expire=1", flv: "" },
    { quality: "hd", hls: "https://cdn.example/h.m3u8", flv: "" }
  ]
}, Date.now());
assert.strictEqual(steps[0].url, "https://cdn.example/h.m3u8");
const appSrc = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
assert(appSrc.includes("livePane"), "Shorts routes keep a live pane");

console.log("All Shorts locked mode and site-wide isolation tests passed successfully!");
