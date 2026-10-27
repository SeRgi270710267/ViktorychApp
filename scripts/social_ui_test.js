import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync("accounts.js", "utf8");
const localStorageStore = {};
let pending = null;
let followCalls = 0;
let mode = "follow";

function reply(status, body) {
  return Promise.resolve({
    status: status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body || {})
  });
}

const windowMock = {
  fetch: (url, opts) => {
    const path = String(url);
    const method = (opts && opts.method) || "GET";
    if (mode === "pending" && path.indexOf("/v1/follows") >= 0 && method === "PUT") {
      return reply(200, { ok: true, pending: true, viewerFollows: false, followersCount: 3, followingCount: 4 });
    }
    if (path.indexOf("/v1/follows") >= 0 && method === "PUT") {
      followCalls += 1;
      if (pending) return pending;
      return reply(200, { ok: true, viewerFollows: true, followersCount: 1, followingCount: 1 });
    }
    if (path.indexOf("/v1/follows") >= 0 && method === "DELETE") {
      return reply(200, { ok: true, viewerFollows: false, followersCount: 0, followingCount: 0 });
    }
    if (path.indexOf("/v1/follows") >= 0 && path.indexOf("tab=followers") >= 0) {
      return reply(200, {
        accounts: [{ id: "app:200000000002", handle: "south_sg", name: "South Dock", followsYou: true, removable: true }],
        followersCount: 1,
        cursor: ""
      });
    }
    if (path.indexOf("/v1/blocks") >= 0) return reply(200, { accounts: [{ id: "app:200000000003", handle: "quiet_sg", name: "Quiet South" }] });
    if (path.indexOf("/v1/mutes") >= 0) return reply(200, { accounts: [] });
    if (path.indexOf("/v1/profile/") >= 0) {
      return reply(200, {
        account: {
          publicId: "200000000004",
          handle: "wall_sg",
          displayName: "Wall",
          blockedBy: true,
          bio: "hidden"
        },
        reposts: [{ postKey: "secret" }]
      });
    }
    return reply(200, { accounts: [], ids: [], friends: [] });
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout: () => {},
  t: (key) => String(key),
  SI18n: { productName: () => "ViktorychApp" },
  VIKTORYCH_ACCOUNTS: { api: "https://accounts.test", gate: false },
  localStorage: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(localStorageStore, key) ? localStorageStore[key] : null),
    setItem: (key, value) => { localStorageStore[key] = String(value); },
    removeItem: (key) => { delete localStorageStore[key]; }
  },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  },
  HandleSkeleton: { skeleton: (handle) => String(handle || "").toLowerCase() },
  navigator: { serviceWorker: null },
  location: { hash: "", pathname: "/", search: "" },
  history: { replaceState: () => {} }
};

windowMock.window = windowMock;
windowMock.document.defaultView = windowMock;
localStorageStore["viktorychapp-account-v1"] = JSON.stringify({
  token: "session-token",
  account: { publicId: "200000000001", handle: "north_sg", displayName: "North Wind", protected: false }
});

vm.runInContext(accountsCode, vm.createContext(windowMock));
const accounts = windowMock.ViktorychAccounts;
assert.ok(accounts.pressFollow, "press lock is available");
assert.equal(accounts.pressFollow("app:200000000002"), true);
assert.equal(accounts.pressFollow("app:200000000002"), false);
accounts.releaseFollow("app:200000000002");

async function main() {
let release;
pending = new Promise((resolve) => { release = resolve; });
const first = accounts.changeFollow("app:200000000002", true);
const second = await accounts.changeFollow("app:200000000002", true);
assert.equal(second.ignored, true);
assert.equal(followCalls, 1);
assert.equal(accounts.followersOf("app:200000000002"), 1);
release({ status: 500, ok: false, json: () => Promise.resolve({ error: "nope" }) });
const failed = await first;
assert.equal(failed, false);
assert.equal(accounts.followersOf("app:200000000002"), 0);

pending = null;
mode = "pending";
const asked = await accounts.changeFollow("app:200000000005", true);
assert.equal(asked.pending, true);
assert.equal(accounts.followersOf("app:200000000005"), 3);
const button = accounts.followControlHtml("app:200000000005", true);
assert.ok(button.indexOf("pending") >= 0, "pending button");
assert.ok(button.indexOf("Cancel request") >= 0, "cancel label");
assert.ok(button.indexOf('type="button"') >= 0, "button type");
assert.ok(button.indexOf('aria-pressed="false"') >= 0, "not pressed while pending");

const list = accounts.graphListHtml("app:200000000001", "followers", "north_sg");
await new Promise((resolve) => setTimeout(resolve, 0));
const drawn = accounts.graphListHtml("app:200000000001", "followers", "north_sg");
assert.ok(drawn.indexOf("Follows you") >= 0);
assert.ok(drawn.indexOf("Remove follower") >= 0);
assert.ok(drawn.indexOf("Search followers") >= 0);
assert.ok(list.length > 0);

accounts.ensureProfile("wall_sg");
await new Promise((resolve) => setTimeout(resolve, 20));
const wall = accounts.profileHtml({ name: "profile", handle: "wall_sg", query: { get: () => "" } });
assert.ok(wall.indexOf("You&#39;re blocked") >= 0);
assert.equal(wall.indexOf("hidden") >= 0, false);

const settings = accounts.settingsHtml();
await new Promise((resolve) => setTimeout(resolve, 0));
const settingsAfter = accounts.settingsHtml();
assert.ok(settingsAfter.indexOf("Protect your posts") >= 0);
assert.ok(settingsAfter.indexOf("Blocked accounts") >= 0);
assert.ok(settingsAfter.indexOf("quiet_sg") >= 0);
assert.ok(settings.indexOf("Your account") >= 0);

console.log("ok social ui");
}

main().catch((err) => {
  console.error(err && err.message ? err.message : "social ui failed");
  process.exit(1);
});
