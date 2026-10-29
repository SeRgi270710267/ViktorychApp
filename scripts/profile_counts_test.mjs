/* A profile header never shows 0 followers, following or posts as a stand-in
   while data loads: unknown counts are a blank placeholder, known counts
   (including a real 0) show as numbers, and a profile seen before paints its
   last known header and counts from this device even when the network hangs. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync(new URL("../accounts.js", import.meta.url), "utf8");
const store = {};

function reply(body) {
  return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
}

function boot(net) {
  const win = {
    fetch: (url) => net(String(url)),
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
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: (key) => { delete store[key]; }
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    HandleSkeleton: { skeleton: (handle) => String(handle || "").toLowerCase() },
    navigator: { serviceWorker: null },
    location: { hash: "", pathname: "/", search: "" },
    history: { replaceState: () => {} }
  };
  win.window = win;
  win.document.defaultView = win;
  vm.runInContext(accountsCode, vm.createContext(win));
  return win.ViktorychAccounts;
}

store["viktorychapp-account-v1"] = JSON.stringify({
  token: "session-token",
  account: { publicId: "200000000001", handle: "north_sg", displayName: "North Wind" }
});

const route = (handle) => ({ name: "profile", handle, query: new URLSearchParams() });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const zeros = (html) => /<b>0<\/b>/.test(html) || /\b0 posts\b/.test(html);
const hang = () => new Promise(() => {});

async function main() {
  /* 1. Profile loaded, counts not yet: header shows placeholders, never 0. */
  let countsReady = null;
  let accounts = boot((url) => {
    if (url.indexOf("/v1/profile/") >= 0) return reply({ account: { publicId: "200000000009", handle: "east_sg", displayName: "East Wind", bio: "Cached bio line" }, reposts: [] });
    if (url.indexOf("/v1/follows") >= 0) return new Promise((resolve) => { countsReady = () => resolve({ status: 200, ok: true, json: () => Promise.resolve({ followersCount: 1234, followingCount: 56 }) }); });
    return reply({ accounts: [], ids: [], friends: [] });
  });
  accounts.requestRender = () => {};
  assert.equal(accounts.profileHtml(route("east_sg")), "", "a truly unknown profile has no header yet");
  await tick(); await tick();
  let html = accounts.profileHtml(route("east_sg"));
  assert.ok(/East Wind/.test(html) && /Cached bio line/.test(html), "profile header renders");
  assert.ok(!zeros(html), "unknown counts rendered as 0: " + (html.match(/<div class="counts">.*?<\/div>/) || [""])[0]);
  assert.ok((html.match(/count-skel/g) || []).length >= 2, "unknown counts show a placeholder");

  /* 2. Counts arrive: numbers update in place. */
  assert.ok(countsReady, "counts were requested");
  countsReady();
  await tick(); await tick();
  html = accounts.profileHtml(route("east_sg"));
  assert.ok(/<b>1,?234<\/b>/.test(html) || /<b>1\.2K<\/b>/i.test(html), "followers count shows: " + (html.match(/<div class="counts">.*?<\/div>/) || [""])[0]);
  assert.ok(/<b>56<\/b>/.test(html), "following count shows");

  /* 3. A real zero is a number, not a placeholder. */
  accounts = boot((url) => {
    if (url.indexOf("/v1/profile/") >= 0) return reply({ account: { publicId: "200000000008", handle: "west_sg", displayName: "West Wind", followersCount: 0, followingCount: 0, friendsCount: 0 }, reposts: [] });
    return hang();
  });
  accounts.requestRender = () => {};
  accounts.profileHtml(route("west_sg"));
  await tick(); await tick();
  html = accounts.profileHtml(route("west_sg"));
  assert.ok(/<b>0<\/b>/.test(html) && !/count-skel/.test(html), "known zero counts render as 0");

  /* 4. Reload with the network hanging: the header and last counts paint from this device. */
  accounts = boot(hang);
  accounts.requestRender = () => {};
  html = accounts.profileHtml(route("east_sg"));
  assert.ok(/East Wind/.test(html) && /Cached bio line/.test(html), "cached header paints at once");
  assert.ok(/<b>56<\/b>/.test(html), "cached following count paints at once");
  assert.ok(!zeros(html), "cached header shows no 0 placeholders");

  /* 5. Storage stays small. */
  const heads = JSON.parse(store["viktorychapp-profile-heads-v1"] || "{}");
  assert.ok(Object.keys(heads).length <= 60);
  console.log("profile counts ok");
}

main().catch((err) => { console.error(err && err.stack ? err.stack : err); process.exitCode = 1; });
