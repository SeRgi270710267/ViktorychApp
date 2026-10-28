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
    if (path.indexOf("/v1/follows") >= 0 && path.indexOf("tab=") >= 0 && (path.indexOf("300000000001") >= 0 || path.indexOf("User_A") >= 0 || path.indexOf("user_a") >= 0)) {
      if (path.indexOf("tab=followers") >= 0) {
        return reply(200, { isPrivate: true, accounts: [], followersCount: 0, cursor: "" });
      }
      return reply(200, {
        isPrivate: true,
        accounts: [{ id: "app:@user_b", handle: "user_b", name: "User B" }],
        followingCount: 1,
        cursor: ""
      });
    }
    if (path.indexOf("/v1/follows") >= 0 && path.indexOf("tab=") >= 0 && (path.indexOf("300000000002") >= 0 || path.indexOf("user_b") >= 0)) {
      return reply(200, { isPrivate: true, accounts: [], cursor: "" });
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
    if (path.indexOf("/v1/profile/") >= 0 && (path.indexOf("user_a") >= 0 || path.indexOf("User_A") >= 0)) {
      return reply(200, {
        account: { handle: "user_a", displayName: "User A", privateFollows: true },
        reposts: []
      });
    }
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
  t: (key, vars) => {
    let text = String(key);
    if (vars) Object.keys(vars).forEach((name) => { text = text.split("{" + name + "}").join(String(vars[name])); });
    return text;
  },
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

localStorageStore["viktorychapp-account-v1"] = JSON.stringify({
  token: "session-token",
  account: { publicId: "300000000001", handle: "user_a", displayName: "User A", privateFollows: true }
});
accounts.ensureProfile("User_A");
await new Promise((resolve) => setTimeout(resolve, 0));
const subject = accounts.subjectForHandle("User_A", "x");
assert.equal(subject && subject.id, "app:300000000001");
assert.equal(accounts.ownsSubject("app:@User_A", "User_A"), true);
assert.equal(accounts.ownsSubject("app:300000000002", "user_b"), false);
assert.equal(accounts.ownsSubject("app:@user_b", "user_b"), false);
accounts.graphListHtml("app:300000000001", "following", "user_a");
accounts.graphListHtml("app:300000000001", "followers", "User_A");
accounts.graphListHtml("app:@User_A", "following", "User_A");
accounts.graphListHtml("app:300000000002", "following", "user_b");
accounts.graphListHtml("app:@user_b", "followers", "user_b");
await new Promise((resolve) => setTimeout(resolve, 0));
const ownFollowing = accounts.graphListHtml("app:300000000001", "following", "user_a");
const ownFollowers = accounts.graphListHtml("app:300000000001", "followers", "User_A");
const ownByHandle = accounts.graphListHtml("app:@User_A", "following", "User_A");
const other = accounts.graphListHtml("app:300000000002", "following", "user_b");
const otherByHandle = accounts.graphListHtml("app:@user_b", "followers", "user_b");
assert.equal(ownFollowing.indexOf("These lists are private"), -1);
assert.ok(ownFollowing.indexOf("User B") >= 0, "owner sees the following list");
assert.equal(ownFollowers.indexOf("These lists are private"), -1);
assert.ok(ownFollowers.indexOf("No followers yet") >= 0, "owner sees an empty followers list");
assert.equal(ownByHandle.indexOf("These lists are private"), -1);
assert.ok(ownByHandle.indexOf("User B") >= 0, "owner handle still opens the list");
assert.ok(other.indexOf("These lists are private") >= 0, "another account sees the private message");
assert.ok(other.indexOf("Only @user_b") >= 0);
assert.equal(other.indexOf("User B"), -1);
assert.ok(otherByHandle.indexOf("These lists are private") >= 0);

console.log("ok social ui");
}

main().catch((err) => {
  console.error(err && err.message ? err.message : "social ui failed");
  process.exit(1);
});
