/* Ordering for the shared story tray. No document and no network. */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const store = {};
const context = {
  console,
  Date,
  localStorage: {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); }
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("stories.js", "utf8"), context);
const Stories = context.Stories;
assert.ok(Stories, "stories.js exports Stories without a document");
assert.strictEqual(fs.readFileSync("stories.js", "utf8").includes("?."), false);
assert.strictEqual(fs.readFileSync("stories.js", "utf8").includes("??"), false);

const now = Date.parse("2026-10-21T19:00:00Z");
Date.now = function () { return now; };
const doc = {
  accounts: [
    {
      id: "instagram:redacted_handle",
      platform: "instagram",
      handle: "redacted_handle",
      name: "Mark",
      avatar: "icons/icon-192.png",
      items: [
        { id: "old", type: "photo", url: "https://cdn.example/old.jpg", date: "2026-10-20T10:00:00Z", expires: "2026-10-21T10:00:00Z" },
        { id: "ig", type: "photo", url: "https://cdn.example/ig.jpg", date: "2026-10-21T12:00:00Z", expires: "2026-10-22T12:00:00Z" }
      ]
    },
    {
      id: "telegram:telegram",
      platform: "telegram",
      handle: "telegram",
      name: "Telegram",
      avatar: "https://cdn.example/tg.jpg",
      items: [
        { id: "tg", type: "photo", url: "https://cdn.example/tg.jpg", date: "2026-10-21T18:00:00Z", expires: "2026-10-22T18:00:00Z" }
      ]
    },
    {
      id: "vk:vk",
      platform: "vk",
      handle: "vk",
      name: "VK",
      avatar: "icons/icon-192.png",
      items: [
        { id: "vk", type: "video", url: "https://cdn.example/vk.mp4", poster: "icons/icon-192.png", date: "2026-10-21T15:00:00Z", expires: "2026-10-22T15:00:00Z" }
      ]
    },
    {
      id: "youtube:news",
      platform: "youtube",
      handle: "news",
      name: "News",
      items: [
        { id: "bad", type: "photo", url: "javascript:alert(1)", date: "2026-10-21T18:30:00Z", expires: "2026-10-22T18:30:00Z" }
      ]
    }
  ]
};

const follows = ["instagram:redacted_handle", "telegram:telegram", "vk:vk", "youtube:news"];
const active = Stories.activeAccounts(doc, now, follows);
const ids = Array.prototype.map.call(active, (row) => row.id).join(",");
assert.strictEqual(ids, "instagram:redacted_handle,telegram:telegram,vk:vk");
assert.strictEqual(active[0].items.length, 1);
assert.strictEqual(active[0].items[0].id, "ig");
assert.strictEqual(active[2].items[0].type, "video");

const seen = {};
seen[Stories.itemKey(active[0], active[0].items[0])] = Date.parse("2026-10-22T12:00:00Z");
const ordered = Stories.orderedAccounts(active, seen);
assert.strictEqual(Array.prototype.map.call(ordered, (row) => row.platform).join(","), "telegram,vk,instagram");

const flipped = Stories.orderedAccounts(active, {});
assert.strictEqual(Array.prototype.map.call(flipped, (row) => row.platform).join(","), "telegram,vk,instagram");
assert.strictEqual(Stories.activeAccounts({ accounts: [] }, now, null).length, 0);
assert.strictEqual(Stories.activeAccounts(doc, now, ["telegram:telegram"]).length, 1);

let rendered = 0;
Stories.bind({
  icon(name) { return '<svg data-icon="' + name + '"></svg>'; },
  follows() { return follows; },
  render() { rendered += 1; }
});
store["rss-stories-seen-v1"] = JSON.stringify(seen);
Stories.apply(doc);
const tray = Stories.homeTray();
assert.ok(tray.indexOf('data-id="telegram:telegram"') < tray.indexOf('data-id="vk:vk"'));
assert.ok(tray.indexOf('data-id="vk:vk"') < tray.indexOf('data-id="instagram:redacted_handle"'));
assert.ok(tray.indexOf("unseen") < tray.indexOf("seen"));
assert.ok(tray.includes('data-icon="tg"') && tray.includes('data-icon="vk"') && tray.includes('data-icon="ig"'));
assert.ok(!tray.includes("javascript:"));
assert.ok(!tray.includes("youtube"));
assert.ok(Stories.trayExtra() > 0);
Stories.apply({ accounts: [] });
assert.strictEqual(Stories.homeTray(), "");
assert.strictEqual(Stories.trayExtra(), 0);
assert.ok(rendered >= 2);
console.log("ok stories tray orders unseen accounts across platforms, then newest");
