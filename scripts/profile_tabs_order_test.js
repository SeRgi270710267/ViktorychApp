import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync("accounts.js", "utf8");
const store = {};
const windowMock = {
  addEventListener: () => {},
  removeEventListener: () => {},
  t: (key) => key,
  SI18n: { productName: () => "ViktorychApp" },
  VIKTORYCH_ACCOUNTS: { api: "", gate: false },
  location: { hash: "#/@user_a", replace() {} },
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
const session = { token: "tok", account: { publicId: "111122223333", handle: "user_a", displayName: "User A", repostsLoaded: true } };
store["viktorychapp-account-v1"] = JSON.stringify(session);
store["viktorychapp-settings-v1"] = JSON.stringify({
  version: 1,
  profileTabs: {
    order: ["media", "posts", "replies", "highlights", "friends", "about", "gifts"],
    hidden: ["friends"],
    share: false,
    at: 5
  }
});

const page = accounts.profileHtml({ name: "profile", platform: "app", handle: "user_a", query: new URLSearchParams("") });
assert.ok(page.includes("Edit tabs"), "owner can edit tabs");
assert.ok(page.includes('data-ptab-id="media"'), "media tab is present");
const mediaAt = page.indexOf('data-ptab-id="media"');
const postsAt = page.indexOf('data-ptab-id="posts"');
assert.ok(mediaAt >= 0 && postsAt > mediaAt, "saved order puts media before posts");
assert.equal(page.includes('data-ptab-id="friends"'), false, "hidden friends tab stays off the bar");
assert.equal(page.includes("Show this order to visitors"), false, "share control stays in edit mode");

const ignored = accounts.profileTabPlan({ profileTabs: { order: ["gifts", "posts"], hidden: [], share: false, at: 9 } }, false);
assert.equal(ignored.order[0], "posts", "visitors keep the default order until it is shared");
const shared = accounts.profileTabPlan({ profileTabs: { order: ["media", "posts", "replies", "highlights", "friends", "about", "gifts"], hidden: ["friends"], share: true, at: 9 } }, false);
assert.equal(shared.order[0], "media", "a shared order is what visitors see");
assert.ok(shared.hidden.includes("friends"), "a shared hide list is kept");

console.log("profile tab order ok");

// Device sync rides along so it runs in the nav workflow.
{
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, ["scripts/device_sync_test.js"], { stdio: "inherit" });
  if (run.status !== 0) throw new Error("device sync check failed");
}
