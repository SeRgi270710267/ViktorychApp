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
      id: "instagram:birchlane",
      platform: "instagram",
      handle: "birchlane",
      name: "Mark",
      avatar: "icons/icon-192.png",
      items: [
        { id: "old", type: "photo", url: "https://cdn.example/old.jpg", date: "2026-10-20T10:00:00Z", expires: "2026-10-21T10:00:00Z" },
        { id: "ig", type: "photo", url: "https://cdn.example/ig.jpg", date: "2026-10-21T12:00:00Z", expires: "2026-10-22T12:00:00Z" }
      ]
    },
    {
      id: "telegram:laneharbor",
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

const follows = ["instagram:birchlane", "telegram:laneharbor", "vk:vk", "youtube:news"];
const active = Stories.activeAccounts(doc, now, follows);
const ids = Array.prototype.map.call(active, (row) => row.id).join(",");
assert.strictEqual(ids, "instagram:birchlane,telegram:laneharbor,vk:vk");
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
assert.strictEqual(Stories.activeAccounts(doc, now, ["telegram:laneharbor"]).length, 1);

let rendered = 0;
Stories.bind({
  icon(name) { return '<svg data-icon="' + name + '"></svg>'; },
  follows() { return follows; },
  render() { rendered += 1; }
});
store["rss-stories-seen-v1"] = JSON.stringify(seen);
Stories.apply(doc);
const tray = Stories.homeTray();
assert.ok(tray.indexOf('data-id="telegram:laneharbor"') < tray.indexOf('data-id="vk:vk"'));
assert.ok(tray.indexOf('data-id="vk:vk"') < tray.indexOf('data-id="instagram:birchlane"'));
assert.ok(tray.indexOf("unseen") < tray.indexOf("seen"));
assert.ok(tray.includes('data-icon="tg"') && tray.includes('data-icon="vk"') && tray.includes('data-icon="ig"'));
assert.ok(!tray.includes("javascript:"));
assert.ok(!tray.includes("youtube"));
assert.ok(Stories.trayExtra() > 0);
Stories.apply({ accounts: [] });
assert.strictEqual(Stories.homeTray(), "");
assert.strictEqual(Stories.trayExtra(), 0);
assert.ok(rendered >= 2);
store["viktorych-stories-bar-v1"] = "hidden";
Stories.apply(doc);
assert.strictEqual(Stories.barState(), "hidden");
assert.strictEqual(Stories.trayExtra(), 28);
assert.ok(Stories.homeTray().includes('data-state="hidden"'));
assert.ok(Stories.homeTray().includes('data-id="telegram:laneharbor"'));
Stories.applyBar("slim");
assert.strictEqual(Stories.barState(), "slim");
assert.strictEqual(Stories.trayExtra(), 52);
Stories.applyBar("expanded");
assert.strictEqual(Stories.trayExtra(), 112);
Stories.nudge(30, 40);
assert.ok(Stories.trayExtra() < 112 && Stories.trayExtra() > 52);
Stories.nudge(-30, 10);
assert.strictEqual(Stories.trayExtra(), 112);
Stories.nudge(600, 600);
assert.strictEqual(Stories.trayExtra(), 52);
Stories.nudge(-10, 0);
assert.strictEqual(Stories.trayExtra(), 112);
Stories.bind({
  icon(name) { return '<svg data-icon="' + name + '"></svg>'; },
  follows() { return follows; },
  account() { return { handle: "user_a", displayName: "User A", avatar: "" }; },
  render() { rendered += 1; }
});
Stories.setNotes({ mine: { text: "" }, notes: [{ handle: "user_b", name: "User B", text: "hello there" }] });
Stories.apply({ accounts: [] });
const noted = Stories.homeTray();
assert.ok(noted.indexOf("Your note") >= 0);
assert.ok(noted.indexOf("Share a thought...") >= 0);
assert.ok(noted.indexOf("hello there") >= 0);
assert.ok(noted.indexOf("Your note") < noted.indexOf("Your story"));
assert.ok(noted.indexOf("note-bubble") >= 0);
Stories.applyBar("slim");
assert.ok(Stories.homeTray().includes('data-state="slim"'));
assert.ok(Stories.homeTray().includes("note-bubble"));
Stories.applyBar("expanded");
Stories.bind({
  icon(name) { return '<svg data-icon="' + name + '"></svg>'; },
  follows() { return follows; },
  account() { return { handle: "user_a", displayName: "User A", avatar: "" }; },
  notesOn() { return false; },
  render() { rendered += 1; }
});
assert.ok(!Stories.homeTray().includes("note-bubble"));
var pinned = Stories.organize([
  { id: "telegram:laneharbor", platform: "telegram", handle: "laneharbor", name: "Telegram" },
  { id: "vk:vk", platform: "vk", handle: "vk", name: "VK" }
], { pins: ["vk:vk"], hidden: [], folders: [], active: "" });
assert.strictEqual(pinned.map(function (row) { return row.id; }).join(","), "vk:vk,telegram:laneharbor");
var hidden = Stories.organize(pinned, { pins: [], hidden: [{ id: "telegram:laneharbor", also: [] }], folders: [], active: "" });
assert.strictEqual(hidden.map(function (row) { return row.id; }).join(","), "vk:vk");
var folder = Stories.organize([
  { id: "telegram:laneharbor", platform: "telegram", handle: "laneharbor" },
  { id: "vk:vk", platform: "vk", handle: "vk" }
], { pins: [], hidden: [], folders: [{ id: "fld_a", name: "A", icon: "⭐", members: ["telegram:laneharbor"] }], active: "fld_a" });
assert.strictEqual(folder.map(function (row) { return row.id; }).join(","), "telegram:laneharbor");
Stories.setOrg({
  pins: ["vk:vk"],
  hidden: [{ id: "instagram:birchlane", name: "Mark", platform: "instagram", handle: "birchlane", also: [] }],
  folders: [],
  active: "",
  updatedAt: 5
});
Stories.apply(doc);
var arranged = Stories.homeTray();
assert.ok(arranged.indexOf('data-id="vk:vk"') < arranged.indexOf('data-id="telegram:laneharbor"'));
assert.ok(arranged.indexOf("instagram:birchlane") < 0);
assert.ok(arranged.includes("story-folders"));
Stories.bind({
  icon(name) { return '<svg data-icon="' + name + '"></svg>'; },
  follows() { return follows; },
  owner() { return true; },
  account() { return null; },
  render() { rendered += 1; }
});
Stories.apply({ accounts: [], telegramConnected: false });
const setup = Stories.homeTray();
assert.ok(setup.includes("Connect Telegram"));
assert.ok(setup.includes("story-connect"));
assert.ok(!setup.includes("unseen"));
Stories.apply({ accounts: [], telegramConnected: true });
assert.strictEqual(Stories.homeTray(), "");
console.log("ok stories tray orders unseen accounts across platforms, then newest");
