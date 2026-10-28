/* "Sync across my devices": newer Home choices win, the account switch
   syncs itself, and a device that keeps its own look neither sends nor
   takes the shared look. Runs accounts.js in a vm. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync("accounts.js", "utf8");
const store = {};
const windowMock = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  CustomEvent: function () {},
  t: (key) => key,
  SI18n: { productName: () => "ViktorychApp" },
  VIKTORYCH_ACCOUNTS: { api: "", gate: false },
  location: { hash: "#/", replace() {} },
  matchMedia: () => ({ matches: false }),
  localStorage: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; }
  },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  },
  HandleSkeleton: { skeleton: (handle) => String(handle || "").toLowerCase() }
};
windowMock.window = windowMock;
windowMock.document.defaultView = windowMock;
vm.runInContext(accountsCode, vm.createContext(windowMock));
const accounts = windowMock.ViktorychAccounts;

// Newer per-key choice wins in both directions.
let merged = accounts.mergePayload(
  { homePills: false, stories: true, prefsAt: { homePills: 200, stories: 100 } },
  { homePills: true, stories: false, prefsAt: { homePills: 150, stories: 300 } }
);
assert.equal(merged.homePills, false, "local pills choice is newer");
assert.equal(merged.stories, false, "remote stories choice is newer");
assert.deepEqual(JSON.parse(JSON.stringify(merged.prefsAt)), { homePills: 200, stories: 300 });

// The account switch itself is last-write-wins.
merged = accounts.mergePayload({ syncUi: true, syncUiAt: 10 }, { syncUi: false, syncUiAt: 20 });
assert.equal(merged.syncUi, false);
assert.equal(merged.syncUiAt, 20);

// Sync on: the snapshot carries the look.
let snap = accounts.snapshotFrom({ appearance: "dim", drawerMenu: { at: 5, order: ["a"] }, homePills: false, prefsAt: { homePills: 5 } });
assert.equal(snap.appearance, "dim");
assert.equal(snap.homePills, false);
assert.ok(!snap.uiLocal);

// This device keeps its own look: nothing of the look is sent.
accounts.setDeviceOwnUi(true);
assert.equal(accounts.uiSyncOn(), false);
snap = accounts.snapshotFrom({ appearance: "dim", drawerMenu: { at: 5, order: ["a"] }, homePills: false, follows: ["x:a"] });
assert.equal(snap.uiLocal, true);
assert.equal(snap.appearance, undefined);
assert.equal(snap.drawerMenu, undefined);
assert.equal(snap.homePills, undefined);
assert.deepEqual(Array.from(snap.follows), ["x:a"], "follows still sync");
// Merging keeps the account's look for other devices, not this device's.
merged = accounts.mergePayload(snap, { appearance: "light", homePills: true, prefsAt: { homePills: 1 } });
assert.equal(merged.appearance, "light");
assert.equal(merged.homePills, true);
accounts.setDeviceOwnUi(false);
assert.equal(accounts.uiSyncOn(), true);

// The account switch off stops the look on every device.
snap = accounts.snapshotFrom({ syncUi: false, syncUiAt: 9, appearance: "dim" });
assert.equal(snap.uiLocal, true);
assert.equal(snap.syncUi, false, "the switch itself still syncs");

// Live updates ride the account channel.
const presence = fs.readFileSync("presence.js", "utf8");
assert.match(presence, /topics: \["presence", "notifications", "sync", "posts"\]/);
console.log("device sync ok");
