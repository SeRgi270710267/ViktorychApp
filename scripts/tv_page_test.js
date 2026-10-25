const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Load tv-page.js in Node environment
const tvCode = fs.readFileSync(path.join(__dirname, "../tv-page.js"), "utf8");

// Mock global window/document
global.window = global;
global.t = (k) => k;
global.esc = (s) => s;
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

eval(tvCode);

assert(global.ViktorychTV, "ViktorychTV should be exported");

const streams = global.ViktorychTV.getStreams();
assert.strictEqual(streams.length, 7, "Should have all 7 streams extracted from NTVSTREAM");

console.log("Checking stream links...");
streams.forEach((s, idx) => {
  assert(s.name, `Stream ${idx} must have name`);
  assert(s.embedUrl.includes("ntv.st/embed"), `Stream ${idx} embedUrl must be on ntv.st/embed`);
  assert(s.directUrl.includes("embed.st/embed"), `Stream ${idx} directUrl must be on embed.st/embed`);
  assert(s.originalUrl.includes("barcelona-vs-real-madrid"), `Stream ${idx} originalUrl must link to match`);
  console.log(`  Stream #${s.streamNo}: [${s.source}] ${s.language} (HD: ${s.hd})`);
});

console.log("Testing failover watchdog...");
const stateBefore = global.ViktorychTV.getState();
assert.strictEqual(stateBefore.currentIndex, 0, "Initial stream should be index 0");
assert.strictEqual(stateBefore.autoJump, true, "Auto-jump should be enabled by default");

global.ViktorychTV.jumpNextStream("Buffer stall");
const stateAfter = global.ViktorychTV.getState();
assert.strictEqual(stateAfter.currentIndex, 1, "Should have advanced to stream index 1");
assert.strictEqual(stateAfter.streamHealth[0], "stalled", "Stream 0 should be marked stalled");
assert.strictEqual(stateAfter.failoverCount, 1, "Failover count should increment");

console.log("Testing manual stream picker...");
global.ViktorychTV.jumpToStream(6);
assert.strictEqual(global.ViktorychTV.getState().currentIndex, 6, "Should switch to stream index 6 (Hotel)");

console.log("Testing HTML output...");
const html = global.ViktorychTV.page({ name: "tv" });
assert(html.includes("tv-stage"), "HTML should include video stage");
assert(html.includes("tv-chat-pane"), "HTML should include Twitch chat pane");
assert(html.includes("Barcelona vs Real Madrid"), "HTML should include match title");
assert(html.includes("tv-stream-pill"), "HTML should include quick switcher pills");
assert(html.includes("tv-scoreboard"), "HTML should include match score board");

console.log("All TV page tests passed successfully!");
