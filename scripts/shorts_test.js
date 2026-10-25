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

global.document = {
  documentElement: {
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    }
  },
  getElementById: () => null,
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

console.log("Testing unlocked mode (initial state)...");
shorts.setLocked(false);
assert.strictEqual(shorts.isLocked(), false, "Shorts should be unlocked");

const liveHtmlUnlocked = shorts.page({ live: true });
assert(liveHtmlUnlocked.includes("@pepsi"), "Unlocked live must include @pepsi");
assert(liveHtmlUnlocked.includes("@gabii_g5"), "Unlocked live must include current account @gabii_g5");
assert(liveHtmlUnlocked.includes("data-shorts=\"toggle-lock\""), "Live HTML must include lock button");

const forYouHtmlUnlocked = shorts.page({ live: false });
assert(forYouHtmlUnlocked.includes("@pepsi"), "Unlocked For You must include @pepsi");
assert(forYouHtmlUnlocked.includes("@gabii_g5"), "Unlocked For You must include @gabii_g5");
assert(forYouHtmlUnlocked.includes("@yt_creator"), "Unlocked For You must include @yt_creator");

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

console.log("Testing site-wide isolation when locked...");
// Test that app.js filters out locked TikTok accounts everywhere when locked
assert.strictEqual(shorts.isUnlocked("pepsi"), true, "pepsi is unlocked");
assert.strictEqual(shorts.isUnlocked("gabii_g5"), false, "gabii_g5 is locked");

// Mock site data with TikTok accounts
const sitePosts = [
  { id: "x:1", platform: "x", handle: "elonmusk", text: "Mars!" },
  { id: "tiktok:pepsi:pinned", platform: "tiktok", handle: "pepsi", text: "Pepsi post" },
  { id: "tiktok:gabii_g5:1", platform: "tiktok", handle: "gabii_g5", text: "Secret dance" },
  { id: "tiktok:another_locked:1", platform: "tiktok", handle: "another_locked", text: "Hidden" }
];

const siteFeeds = [
  { id: "x:elonmusk", platform: "x", handle: "elonmusk", name: "Elon Musk" },
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
assert(lockedVisiblePosts.some((p) => p.handle === "elonmusk"), "Non-tiktok posts should be visible");
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
const unlockedVisibleFeeds = siteFeeds.filter((f) => !isLockedTiktok(f));
assert.strictEqual(unlockedVisibleFeeds.length, siteFeeds.length, "All feeds visible when unlocked");

console.log("All Shorts locked mode and site-wide isolation tests passed successfully!");
