// Origin pool: reads leave the main Worker when it reports it is near its
// free daily quota (X-Quota-Pct); writes stay on it. Run: node scripts/origin_pool_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const MAIN = "https://main.test";
const BACKUP = "https://backup.test";
const store = new Map();
const calls = [];
const quota = { pct: "40" };
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
const document = Object.assign(el(), {
  readyState: "complete", visibilityState: "visible", documentElement: el(), body: el(), head: el(),
  createElement: el, getElementById() { return null; }, dispatchEvent() { return true; }
});
function fetchStub(url, init) {
  calls.push({ url: String(url), method: (init && init.method) || "GET" });
  const headers = new Headers({ "content-type": "application/json" });
  if (String(url).startsWith(MAIN)) headers.set("X-Quota-Pct", quota.pct);
  return Promise.resolve(new Response("{}", { status: 200, headers }));
}
const win = {
  VIKTORYCH_ACCOUNTS: { api: MAIN, backupApi: BACKUP, gate: true },
  localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { href: "https://site.test/", origin: "https://site.test", pathname: "/", hash: "", search: "" },
  navigator: { userAgent: "node", onLine: true },
  document, fetch: fetchStub, Headers, Response, Request, URL, AbortController, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {} }; }, requestAnimationFrame(fn) { return setTimeout(fn, 0); },
  console, Date, Math, JSON, Promise
};
win.window = win; win.self = win; win.globalThis = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(new URL("../accounts.js", import.meta.url), "utf8"), win, { filename: "accounts.js" });
const A = win.ViktorychAccounts;
assert.ok(A && A.call && A.originPool, "accounts.js exposes the pool");

await A.call("/v1/features");
assert.equal(calls.at(-1).url, MAIN + "/v1/features", "reads start on the main Worker");
assert.equal(A.originPool.shifted(), false);

quota.pct = "92";
await A.call("/v1/features");
assert.equal(A.originPool.shifted(), true, "a high quota header shifts reads");
await A.call("/v1/friends");
assert.equal(calls.at(-1).url, BACKUP + "/v1/friends", "reads go to the backup while shifted");
await A.call("/v1/posts", { method: "POST", body: { a: 1 } });
assert.equal(calls.at(-1).url, MAIN + "/v1/posts", "writes stay on the main Worker");

const until = JSON.parse(store.get("viktorychapp-quota-v1")).until;
await A.call("/v1/posts", { method: "POST", body: { a: 2 } });
assert.equal(JSON.parse(store.get("viktorychapp-quota-v1")).until, until, "the shift is sticky, not re-rolled");

quota.pct = "30";
await A.call("/v1/posts", { method: "POST", body: { a: 3 } });
assert.equal(A.originPool.shifted(), false, "a low header from the main Worker ends the shift");
await A.call("/v1/friends");
assert.equal(calls.at(-1).url, MAIN + "/v1/friends");
console.log("ok origin pool");
