const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function createMockVideo() {
  const listeners = {};
  return {
    tagName: "VIDEO",
    classList: {
      add() {},
      remove() {},
      contains() { return false; }
    },
    style: {},
    controls: false,
    duration: 120,
    currentTime: 15,
    volume: 0.8,
    muted: false,
    playbackRate: 1,
    loop: false,
    paused: true,
    ended: false,
    buffered: {
      length: 1,
      start() { return 0; },
      end() { return 60; }
    },
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    trigger(event) {
      (listeners[event] || []).forEach((fn) => fn());
    },
    play() {
      this.paused = false;
      this.trigger("play");
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      this.trigger("pause");
    },
    setAttribute() {},
    removeAttribute() {}
  };
}

function createMockElement(tag) {
  const listeners = {};
  const children = [];
  const classes = new Set();
  const el = {
    tagName: (tag || "div").toUpperCase(),
    style: {},
    children: children,
    parentNode: null,
    appendChild(child) {
      children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    trigger(event, data) {
      (listeners[event] || []).forEach((fn) => fn(data || { stopPropagation() {}, preventDefault() {} }));
    },
    querySelector() {
      return createMockElement("div");
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 640, height: 360 };
    },
    setAttribute() {},
    removeAttribute() {}
  };

  el.classList = {
    add(cls) { classes.add(cls); },
    remove(cls) { classes.delete(cls); },
    contains(cls) { return classes.has(cls); }
  };

  Object.defineProperty(el, "className", {
    get() {
      return Array.from(classes).join(" ");
    },
    set(val) {
      classes.clear();
      if (val) {
        val.split(/\s+/).forEach((c) => { if (c) classes.add(c); });
      }
    }
  });

  return el;
}

const mockDoc = {
  createElement(tag) {
    if (tag.toLowerCase() === "video") return createMockVideo();
    return createMockElement(tag);
  },
  addEventListener() {},
  removeEventListener() {},
  pictureInPictureEnabled: true
};

const sandbox = {
  window: {},
  document: mockDoc,
  self: {},
  console: console,
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  clearTimeout: clearTimeout,
  Date: Date,
  Math: Math,
  isFinite: isFinite,
  isNaN: isNaN,
  parseInt: parseInt,
  String: String
};
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.self = sandbox;

const code = fs.readFileSync("yt-player.js", "utf8");
vm.runInNewContext(code, sandbox);

const YtPlayer = sandbox.YtPlayer;
assert(typeof YtPlayer === "function", "YtPlayer must be exported as a constructor function");

// Test 1: Instantiate player
const container = createMockElement("div");
const video = createMockVideo();
const player = new YtPlayer(container, { video: video });

assert(player.video === video, "Player must wrap the provided video element");
assert(player.el.classList.contains("html5-video-player"), "Root element must have class html5-video-player");

// Test 2: Playback control
player.play();
assert.strictEqual(video.paused, false, "Video should be playing");
assert(player.el.classList.contains("playing-mode"), "Player should have playing-mode class");

player.pause();
assert.strictEqual(video.paused, true, "Video should be paused");
assert(player.el.classList.contains("paused-mode"), "Player should have paused-mode class");

// Test 3: Seeking
player.seekTo(45);
assert.strictEqual(video.currentTime, 45, "Video currentTime should be 45");

player.seekRelative(10);
assert.strictEqual(video.currentTime, 55, "Video currentTime should be 55");

player.seekRelative(-15);
assert.strictEqual(video.currentTime, 40, "Video currentTime should be 40");

// Test 4: Volume & Mute
player.setVolume(0.5);
assert.strictEqual(video.volume, 0.5, "Video volume should be 0.5");
assert.strictEqual(video.muted, false, "Video should not be muted");

player.toggleMute();
assert.strictEqual(video.muted, true, "Video should be muted");

player.toggleMute();
assert.strictEqual(video.muted, false, "Video should be unmuted");
assert.strictEqual(video.volume, 0.5, "Video volume should restore to 0.5");

// Test 5: Playback rate
player.setPlaybackRate(1.5);
assert.strictEqual(video.playbackRate, 1.5, "Video playback rate should be 1.5");

// Test 6: IFrame player mode
const iframeContainer = createMockElement("div");
const iframe = createMockElement("iframe");
iframe.contentWindow = { postMessage() {} };
const iframePlayer = new YtPlayer(iframeContainer, { iframe: iframe });

assert.strictEqual(iframePlayer.isIframe_, true, "Player should be in iframe mode");
assert(iframePlayer.clickShield_, "Player should create a click shield overlay for iframes");
assert(iframePlayer.nextBtn_, "Player should have next button");
assert(iframePlayer.loopBtn_, "Player should have loop button");

iframePlayer.play();
assert.strictEqual(iframePlayer.iframePaused_, false, "Iframe player should be playing");
iframePlayer.pause();
assert.strictEqual(iframePlayer.iframePaused_, true, "Iframe player should be paused");

iframePlayer.destroy();
assert.strictEqual(iframePlayer.disposed_, true, "Iframe player should be disposed");

// Test 7: Destruction
player.destroy();
assert.strictEqual(player.disposed_, true, "Player should be disposed");

console.log("yt-player tests passed successfully!");
