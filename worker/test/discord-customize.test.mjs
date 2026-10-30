/* Discord customize: hide, reorder and private channels, all local. Placeholder ids only. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function load() {
  const store = {};
  const context = {
    console, URLSearchParams, Date, Map, Set, BigInt, Intl, JSON, Math, Number, Object, Array, String, isFinite,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "discord-ui.js"), "utf8"), context);
  const D = context.FeedsDiscord;
  D._applyIndex({ status: "ok", servers: [] });
  D._setServers([
    { id: "111111111111111111", name: "Alpha Guild", channels: [{ id: "111111111111111112", name: "alpha-room", mode: "messages" }] },
    { id: "222222222222222222", name: "Beta Guild", channels: [{ id: "222222222222222223", name: "beta-room", mode: "messages" }] }
  ]);
  D._setPrefs({ expanded: { "111111111111111111": true, "222222222222222222": true }, pinnedServers: [], pinnedChannels: [], mutedServers: [], mutedChannels: [] });
  return D;
}
const page = (D) => D.page({ name: "messages", query: new URLSearchParams() });

test("servers can be reordered on this device", () => {
  const D = load();
  assert.equal(D._serverOrder().join(), "111111111111111111,222222222222222222");
  assert.equal(D._moveServer("222222222222222222", -1), true);
  assert.equal(D._serverOrder().join(), "222222222222222222,111111111111111111");
  assert.equal(D._moveServer("222222222222222222", -1), false);
  const html = page(D);
  assert.ok(html.indexOf("Beta Guild") < html.indexOf("Alpha Guild"));
});

test("hidden servers and channels leave the list but stay in Customize", () => {
  const D = load();
  D._prefs().hiddenServers = ["111111111111111111"];
  let html = page(D);
  assert.equal(html.includes("Alpha Guild"), false);
  assert.ok(html.includes("Beta Guild"));
  assert.ok(html.includes('data-discord="customize"'));
  D._customize(true);
  html = page(D);
  assert.ok(html.includes("Customize Discord"));
  assert.ok(html.includes("Alpha Guild"));
  assert.ok(html.includes('data-discord="srv-hide"'));
  assert.ok(html.includes('data-discord="ch-private"'));
  D._customize(false);
  D._prefs().hiddenServers = [];
  D._prefs().hiddenChannels = ["222222222222222223"];
  assert.equal(page(D).includes("beta-room"), false);
});

test("private channels hide their text in previews and tell alerts", () => {
  const D = load();
  D._prefs().privateChannels = ["222222222222222223"];
  assert.equal(D.alertSnapshot().privateChannels.join(), "222222222222222223");
  D._customize(true);
  assert.ok(page(D).includes('data-discord="ch-private" data-id="222222222222222223" aria-pressed="true"'));
});
