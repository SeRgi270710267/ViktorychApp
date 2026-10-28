/* Highlight row visibility. No network. */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const context = { console: console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("highlights.js", "utf8"), context);
const Highlights = context.Highlights;
assert.ok(Highlights);
const empty = Highlights.preview({ mine: false, highlights: [] });
assert.strictEqual(empty, "");
const owner = Highlights.preview({ mine: true, highlights: [] });
assert.ok(owner.includes("New"));
assert.ok(owner.includes("hl-new"));
const shown = Highlights.preview({
  mine: false,
  highlights: [{ id: "abc", title: "✨ trip", cover: "", crop: { x: 0, y: 0, w: 10000, h: 10000 } }]
});
assert.ok(shown.includes("✨ trip"));
assert.ok(!shown.includes("hl-new"));
console.log("ok highlight row hides when empty for visitors and shows a title");
