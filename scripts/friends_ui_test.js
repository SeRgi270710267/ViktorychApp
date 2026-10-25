import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync("accounts.js", "utf-8");

const localStorageStore = {};
const sessionStorageStore = {};

const mockFriendsData = [
  { publicId: "222233334444", handle: "mark_z", displayName: "Mark", avatar: "", bio: "Building social stuff", mutualFriendsCount: 3, friendStatus: "friends" },
  { publicId: "333344445555", handle: "elon_m", displayName: "Elon", avatar: "", bio: "X and rockets", mutualFriendsCount: 1, friendStatus: "friends" }
];

const mockRequestsData = {
  incoming: [
    { id: "app:444455556666", publicId: "444455556666", handle: "satya_n", name: "Satya", avatar: "", mutualFriendsCount: 2 }
  ],
  outgoing: []
};

const windowMock = {
  fetch: (url) => {
    const s = String(url);
    if (s.includes("/v1/friends?tab=requests")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockRequestsData) });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: "app:111122223333",
        friendsCount: mockFriendsData.length,
        status: "friends",
        mutualCount: 1,
        friends: mockFriendsData
      })
    });
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  t: (key, vars) => {
    let s = String(key);
    if (vars) {
      Object.keys(vars).forEach((k) => {
        s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
      });
    }
    return s;
  },
  SI18n: { productName: () => "ViktorychApp" },
  VIKTORYCH_ACCOUNTS: { api: "https://accounts.test", gate: false },
  localStorage: {
    getItem: (k) => localStorageStore[k] || null,
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; }
  },
  sessionStorage: {
    getItem: (k) => sessionStorageStore[k] || null,
    setItem: (k, v) => { sessionStorageStore[k] = String(v); },
    removeItem: (k) => { delete sessionStorageStore[k]; }
  },
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  },
  HandleSkeleton: { skeleton: (h) => String(h || "").toLowerCase() }
};

windowMock.window = windowMock;
windowMock.document.defaultView = windowMock;

const context = vm.createContext(windowMock);
vm.runInContext(accountsCode, context);

const accounts = windowMock.ViktorychAccounts;
assert.ok(accounts, "ViktorychAccounts should be defined");
assert.ok(typeof accounts.friendButton === "function", "friendButton should be a function");
assert.ok(typeof accounts.friendsSectionHtml === "function", "friendsSectionHtml should be a function");

// 1. Friend Button tests
assert.equal(accounts.friendButton({ publicId: "111122223333", handle: "bob" }), "");

const aliceSession = {
  token: "tok-alice",
  account: {
    publicId: "000011112222",
    handle: "alice",
    displayName: "Alice"
  }
};
localStorageStore["viktorychapp-account-v1"] = JSON.stringify(aliceSession);

// Self has no friend button
const selfBtn = accounts.friendButton(aliceSession.account);
assert.equal(selfBtn, "");

// Another user with status "none" -> "Add Friend"
const bob = { publicId: "111122223333", handle: "bob", displayName: "Bob", viewerFriendStatus: "none" };
const addBtn = accounts.friendButton(bob);
assert.ok(addBtn.includes("Add Friend"), "Should display Add Friend");
assert.ok(addBtn.includes('data-friend-act="request"'), "Should have request action");

// Another user with status "sent" -> "Request Sent"
const charlie = { publicId: "333344445555", handle: "charlie", displayName: "Charlie", viewerFriendStatus: "sent" };
const sentBtn = accounts.friendButton(charlie);
assert.ok(sentBtn.includes("Request Sent"), "Should display Request Sent");
assert.ok(sentBtn.includes('data-friend-act="cancel"'), "Should allow cancelling");

// Another user with status "received" -> "Confirm" & "Delete"
const dave = { publicId: "444455556666", handle: "dave", displayName: "Dave", viewerFriendStatus: "received" };
const recvBtn = accounts.friendButton(dave);
assert.ok(recvBtn.includes("Confirm"), "Should display Confirm");
assert.ok(recvBtn.includes("Delete"), "Should display Delete");

// Another user with status "friends" -> "Friends" / "Unfriend"
const emma = { publicId: "555566667777", handle: "emma", displayName: "Emma", viewerFriendStatus: "friends" };
const mutualBtn = accounts.friendButton(emma);
assert.ok(mutualBtn.includes("Friends"), "Should display Friends");
assert.ok(mutualBtn.includes("Unfriend"), "Should have hover Unfriend");

// 2. Friends Section & List tests
// First call triggers loading
const loadingHtml = accounts.friendsSectionHtml(bob);
assert.ok(loadingHtml.includes("Loading…"), "Should show loading on first call");

// Wait for fetch promise to resolve
await new Promise((resolve) => setTimeout(resolve, 10));

const friendsHtml = accounts.friendsSectionHtml(bob);
assert.ok(friendsHtml.includes("Friends"), "Friends section should have Friends header");
assert.ok(friendsHtml.includes("friends-grid"), "Should render friends grid");
assert.ok(friendsHtml.includes("mark_z"), "Should display friend Mark");
assert.ok(friendsHtml.includes("elon_m"), "Should display friend Elon");
assert.ok(friendsHtml.includes("3 mutual friends"), "Should display mutual friends count");
assert.ok(friendsHtml.includes("Search Friends"), "Should have Search Friends input");

// 3. Own profile Friends Section tests (has Friend Requests pill)
accounts.friendsSectionHtml(aliceSession.account);
await new Promise((resolve) => setTimeout(resolve, 10));
const ownFriendsHtml = accounts.friendsSectionHtml(aliceSession.account);
assert.ok(ownFriendsHtml.includes("All Friends"), "Own friends section should have All Friends pill");
assert.ok(ownFriendsHtml.includes("Friend Requests"), "Own friends section should have Friend Requests pill");

// 4. Profile page rendering with Friends tab
aliceSession.account.repostsLoaded = true;
const profileRouteFriends = { name: "profile", platform: "app", handle: "alice", query: new URLSearchParams("tab=friends") };
const profileRoutePosts = { name: "profile", platform: "app", handle: "alice", query: new URLSearchParams("") };

const pageFriends = accounts.profileHtml(profileRouteFriends);
assert.ok(pageFriends.includes("Friends"), "Profile should render Friends tab");
assert.ok(pageFriends.includes("friends-grid") || pageFriends.includes("Search Friends"), "Should render friends view on tab=friends");

const pagePosts = accounts.profileHtml(profileRoutePosts);
assert.ok(pagePosts.includes("Posts"), "Profile should render Posts tab");

console.log("ok friends UI, pills, cards, search, and profile tabs pass all checks!");
