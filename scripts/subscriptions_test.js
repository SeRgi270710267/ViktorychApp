const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

console.log("Running Subscriptions page unit & integration tests...");

// Setup DOM stubs
function makeElement(tag) {
  const classes = new Set();
  const attributes = {};
  return {
    tagName: (tag || "div").toUpperCase(),
    style: {},
    dataset: {},
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c); else classes.add(c);
        } else if (force) classes.add(c); else classes.delete(c);
      }
    },
    getAttribute(name) { return attributes[name] || null; },
    setAttribute(name, val) { attributes[name] = String(val); },
    removeAttribute(name) { delete attributes[name]; },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    scrollTo() {},
    focus() {}
  };
}

const mockStorage = {};
const mockWindow = {
  innerWidth: 1024,
  innerHeight: 768,
  location: { hash: "#/subscriptions", search: "", pathname: "/" },
  localStorage: {
    getItem: (key) => mockStorage[key] || null,
    setItem: (key, val) => { mockStorage[key] = String(val); },
    removeItem: (key) => { delete mockStorage[key]; }
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  document: {
    getElementById: () => null,
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeElement("body"),
    documentElement: makeElement("html")
  },
  history: { scrollRestoration: "auto", back() {}, replaceState() {}, pushState() {} },
  navigator: { userAgent: "NodeTest", serviceWorker: {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  URLSearchParams: URLSearchParams,
  t: (k) => k,
  tn: (k, n) => `${n} ${k}`
};

let appCode = fs.readFileSync("app.js", "utf8");

// Expose internal functions for unit verification
const hook = `
  window.__SUBS_TEST__ = {
    STATE,
    videoFeeds,
    isVideoPost,
    countsAsUpload,
    onChannel,
    followedPost,
    subsView,
    profileMatch,
    feedKeys,
    isFeedFollowed
  };
`;
const patchedCode = appCode.replace("boot();\n})();", `${hook}\n  // boot();\n})();`);

const context = vm.createContext(Object.assign({}, mockWindow, {
  window: mockWindow,
  self: mockWindow,
  global: mockWindow,
  globalThis: mockWindow,
  console: console
}));

vm.runInContext(patchedCode, context);

const T = mockWindow.__SUBS_TEST__;
assert.ok(T, "Internal subs test hook should be exposed");

// Test Setup
const ytFeed = {
  id: "youtube:redacted_handle",
  platform: "youtube",
  handle: "redacted_handle",
  channelId: "UCfgtuaUadGgOA-91geQ8Qog",
  name: "Canadian Prepper",
  avatar: "https://example.com/canadian.jpg",
  configured: true
};

const xFeed = {
  id: "x:redacted_handle",
  platform: "x",
  handle: "redacted_handle",
  name: "Elon Musk",
  avatar: "https://example.com/elon.jpg",
  configured: true
};

const tiktokFeed = {
  id: "tiktok:somecreator",
  platform: "tiktok",
  handle: "somecreator",
  name: "Some Creator",
  avatar: "https://example.com/tiktok.jpg",
  configured: true
};

T.STATE.data = {
  feeds: [ytFeed, xFeed, tiktokFeed],
  posts: [
    {
      id: "yt_vid1",
      statusId: "vid12345678",
      platform: "youtube",
      feedId: "youtube:redacted_handle",
      handle: "redacted_handle",
      channelId: "UCfgtuaUadGgOA-91geQ8Qog",
      author: "Canadian Prepper",
      title: "Prepping for the Unknown",
      date: new Date().toISOString(),
      media: [{ type: "video", videoId: "vid12345678" }]
    },
    {
      id: "yt_short1",
      statusId: "short987654",
      platform: "youtube",
      feedId: "youtube:redacted_handle",
      handle: "redacted_handle",
      channelId: "UCfgtuaUadGgOA-91geQ8Qog",
      author: "Canadian Prepper",
      title: "Quick Survival Tip #Shorts",
      short: true,
      date: new Date().toISOString(),
      media: [{ type: "video", videoId: "short987654" }]
    },
    {
      id: "x_post_video",
      statusId: "12345",
      platform: "x",
      feedId: "x:redacted_handle",
      handle: "redacted_handle",
      author: "Elon Musk",
      text: "Starship Flight Test",
      date: new Date().toISOString(),
      media: [{ type: "video", url: "https://example.com/starship.mp4" }]
    },
    {
      id: "tiktok_post",
      statusId: "tk123",
      platform: "tiktok",
      feedId: "tiktok:somecreator",
      handle: "somecreator",
      author: "Some Creator",
      text: "Trending TikTok Clip",
      date: new Date().toISOString(),
      media: [{ type: "video", url: "https://example.com/video.mp4" }]
    },
    {
      id: "x_post_text",
      statusId: "12346",
      platform: "x",
      feedId: "x:redacted_handle",
      handle: "redacted_handle",
      author: "Elon Musk",
      text: "Just text here",
      date: new Date().toISOString(),
      media: []
    }
  ]
};

T.STATE.settings = {
  follows: ["youtube:redacted_handle", "x:redacted_handle", "tiktok:somecreator"],
  groups: [],
  groupsOwn: false,
  subsGroup: "",
  subsLayout: "grid"
};

// 1. isVideoPost test
console.log("  Testing isVideoPost...");
assert.strictEqual(T.isVideoPost(T.STATE.data.posts[0]), true, "YouTube post is video post");
assert.strictEqual(T.isVideoPost(T.STATE.data.posts[1]), true, "YouTube shorts post is video post");
assert.strictEqual(T.isVideoPost(T.STATE.data.posts[2]), true, "X video post is video post");
assert.strictEqual(T.isVideoPost(T.STATE.data.posts[3]), true, "TikTok post is video post");
assert.strictEqual(T.isVideoPost(T.STATE.data.posts[4]), false, "X text post is NOT video post");

// 2. countsAsUpload test
console.log("  Testing countsAsUpload...");
const ytPost = T.STATE.data.posts[0];
assert.strictEqual(T.countsAsUpload(ytPost, ytFeed), true, "Matches exact feedId");

const altYtPost = Object.assign({}, ytPost, { feedId: "youtube:UCfgtuaUadGgOA-91geQ8Qog" });
assert.strictEqual(T.countsAsUpload(altYtPost, ytFeed), true, "Matches via channelId");

assert.strictEqual(T.countsAsUpload(ytPost, xFeed), false, "Does not match unrelated feed");

// 3. followedPost test
console.log("  Testing followedPost...");
assert.strictEqual(T.followedPost(ytPost), true, "Matches direct feedId in follows");

T.STATE.settings.follows = ["youtube:UCfgtuaUadGgOA-91geQ8Qog"];
assert.strictEqual(T.followedPost(ytPost), true, "Matches channelId in follows");

T.STATE.settings.follows = ["youtube:redacted_handle"];
assert.strictEqual(T.followedPost(ytPost), true, "Matches lowercase handle in follows");

// Reset follows
T.STATE.settings.follows = ["youtube:redacted_handle", "x:redacted_handle", "tiktok:somecreator"];

// 4. videoFeeds test
console.log("  Testing videoFeeds...");
const vf = T.videoFeeds();
assert.ok(vf.some((f) => f.id === "youtube:redacted_handle"), "videoFeeds includes YouTube channel");
assert.ok(vf.some((f) => f.id === "x:redacted_handle"), "videoFeeds includes X feed with video upload");
assert.ok(vf.some((f) => f.id === "tiktok:somecreator"), "videoFeeds includes TikTok video channel");

// 5. onChannel test
console.log("  Testing onChannel filter...");
assert.strictEqual(T.onChannel(ytPost, "youtube:redacted_handle"), true, "onChannel matches feedId");
assert.strictEqual(T.onChannel(ytPost, "youtube:UCfgtuaUadGgOA-91geQ8Qog"), true, "onChannel matches channelId");
assert.strictEqual(T.onChannel(ytPost, "x:redacted_handle"), false, "onChannel rejects other channels");

// 6. subsView render test
console.log("  Testing subsView rendering...");
const allHtml = T.subsView({ name: "subscriptions", channel: "", query: new URLSearchParams() });
assert.ok(allHtml.includes('class="yt-strip"'), "Channel strip rendered");
assert.ok(allHtml.includes("Canadian Prepper"), "Canadian Prepper in channel strip");
assert.ok(allHtml.includes("Prepping for the Unknown"), "YouTube video rendered in feed");
assert.ok(allHtml.includes("Quick Survival Tip"), "YouTube shorts rendered in feed");
assert.ok(allHtml.includes("Starship Flight Test"), "X video rendered in feed");
assert.ok(!allHtml.includes("Just text here"), "Non-video text post excluded");

// Filter by channel
const chanHtml = T.subsView({ name: "subscriptions", channel: "youtube:redacted_handle", query: new URLSearchParams() });
assert.ok(chanHtml.includes("Prepping for the Unknown"), "Filtered view has channel video");
assert.ok(!chanHtml.includes("Starship Flight Test"), "Filtered view excludes other channels");

console.log("All Subscriptions page tests passed successfully!");
