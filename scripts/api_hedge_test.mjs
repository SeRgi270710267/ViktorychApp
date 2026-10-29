/* API reads under a stalled connection: when the first root says nothing
   for a moment the next root starts too, the first good answer wins, and
   the stalled try is cancelled. A root that hangs for good times out and
   the read moves on. Writes still go to one root at a time, and a stalled write times out
   without being sent again. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync("accounts.js", "utf8");
let behave = {};
const sent = [];
const aborted = [];
function res(status, body) {
  return { status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body || {})) };
}
function fakeFetch(url, init) {
  const root = String(url).split("/v1/")[0];
  if (String(url).indexOf("/v1/") < 0) return Promise.resolve(res(404));
  sent.push({ root, method: (init && init.method) || "GET" });
  const how = behave[root] || "ok";
  if (how === "ok") return Promise.resolve(res(200, { from: root }));
  if (how === "503") return Promise.resolve(res(503, { from: root }));
  return new Promise((resolve, reject) => {
    const signal = init && init.signal;
    if (signal) signal.addEventListener("abort", () => { aborted.push(root); reject(new Error("aborted")); });
  });
}
function load(extra) {
  const store = {};
  const w = {
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    CustomEvent: function () {}, t: (k) => k,
    SI18n: { productName: () => "ViktorychApp" },
    VIKTORYCH_ACCOUNTS: Object.assign({ api: "https://a.test", backupApi: "https://b.test", gate: false, hedgeMs: 60, readTimeoutMs: 400 }, extra || {}),
    fetch: (u, i) => fakeFetch(u, i),
    location: { hash: "#/", replace() {} },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    HandleSkeleton: { skeleton: (h) => String(h || "").toLowerCase() },
    setTimeout, clearTimeout, AbortController
  };
  w.window = w;
  w.document.defaultView = w;
  vm.runInContext(accountsCode, vm.createContext(w));
  return w.ViktorychAccounts;
}

// Primary stalls: the backup starts after the hedge delay and wins.
let accounts = load();
behave = { "https://a.test": "hang", "https://b.test": "ok" };
let t0 = Date.now();
let body = await accounts.call("/v1/live", {});
assert.equal(body.status, 200);
assert.equal(body.from, "https://b.test");
assert.ok(Date.now() - t0 < 350, "the hedge answers well before the timeout");
assert.deepEqual(aborted, ["https://a.test"], "the stalled try is cancelled");

// Both stall: each try times out and the read ends with an error, not a hang.
accounts = load();
behave = { "https://a.test": "hang", "https://b.test": "hang" };
sent.length = 0;
t0 = Date.now();
await assert.rejects(accounts.call("/v1/live", {}));
assert.ok(Date.now() - t0 < 1500, "a full stall still ends");

// A 503 on the primary moves to the backup right away.
accounts = load();
behave = { "https://a.test": "503", "https://b.test": "ok" };
body = await accounts.call("/v1/live", {});
assert.equal(body.from, "https://b.test");

// Healthy primary: one request, no hedge.
accounts = load();
behave = {};
sent.length = 0;
body = await accounts.call("/v1/live", {});
assert.equal(body.from, "https://a.test");
await new Promise((r) => setTimeout(r, 120));
assert.equal(sent.length, 1, "no extra request when the first root is quick");

// Writes are never hedged.
accounts = load();
behave = { "https://a.test": "ok" };
sent.length = 0;
await accounts.call("/v1/x", { method: "POST", body: {} });
await new Promise((r) => setTimeout(r, 120));
assert.equal(sent.length, 1);

// A stalled write times out with a 504 and is not resent to the backup.
accounts = load({ writeTimeoutMs: 200 });
behave = { "https://a.test": "hang", "https://b.test": "ok" };
sent.length = 0;
t0 = Date.now();
body = await accounts.call("/v1/x", { method: "POST", body: {} });
assert.equal(body.status, 504);
assert.equal(body.error, "timeout");
assert.equal(sent.length, 1, "a timed-out write is not sent twice");
assert.ok(Date.now() - t0 < 1500, "a stalled write ends");
console.log("api hedge ok");
