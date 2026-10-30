// Settings > Free tier usage always finishes loading: a report shows its
// rows, and a slow, failing or silent Worker ends in a calm error with Retry
// and per-server "unknown" rows instead of "Loading…" forever. Owner usage is
// read from the Worker only, never hedged to the backup.
// Run: node scripts/usage_panel_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const MAIN = "https://main.test";
const BACKUP = "https://backup.test";
const store = new Map();
const calls = [];
let mode = "ok";
const report = { configured: true, limits: { workerRequestsDay: 100000, d1RowsReadDay: 5000000, d1RowsWrittenDay: 100000, durableRequestsDay: 100000, r2ClassAMonth: 1000000, r2ClassBMonth: 10000000, renderHoursMonth: 750 }, workerRequestsToday: 12000, d1RowsReadToday: 1, d1RowsWrittenToday: 1, durableRequestsToday: 1, r2ClassAMonth: 1, r2ClassBMonth: 1, week: [], renderHours: null, pool: null };
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
const document = Object.assign(el(), {
  readyState: "complete", visibilityState: "visible", documentElement: el(), body: el(), head: el(),
  createElement: el, getElementById() { return null; }, dispatchEvent() { return true; }
});
function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function fetchStub(url, init) {
  const u = String(url);
  calls.push(u);
  if (u.endsWith("/v1/owner/usage")) {
    if (u.startsWith(BACKUP)) return Promise.resolve(json(404, { error: "not_found" }));
    if (mode === "ok") return Promise.resolve(json(200, report));
    if (mode === "error") return Promise.resolve(json(500, { error: "x" }));
    if (mode === "hang") return new Promise((resolve, reject) => { if (init && init.signal) init.signal.addEventListener("abort", () => reject(new Error("aborted"))); });
  }
  return Promise.resolve(json(200, {}));
}
let renders = 0;
const win = {
  VIKTORYCH_ACCOUNTS: { api: MAIN, backupApi: BACKUP, gate: true, usageWaitMs: 150, hedgeMs: 20 },
  localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { href: "https://site.test/", origin: "https://site.test", pathname: "/", hash: "#/settings", search: "" },
  navigator: { userAgent: "node", onLine: true },
  document, fetch: fetchStub, Headers, Response, Request, URL, AbortController, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {} }; }, requestAnimationFrame(fn) { return setTimeout(fn, 0); },
  console, Date, Math, JSON, Promise
};
win.window = win; win.self = win; win.globalThis = win;
store.set("viktorychapp-account-v1", JSON.stringify({ token: "test-token", account: { owner: true, handle: "tester", publicId: "1" } }));
vm.createContext(win);
vm.runInContext(fs.readFileSync(new URL("../accounts.js", import.meta.url), "utf8"), win, { filename: "accounts.js" });
const A = win.ViktorychAccounts;
A.requestRender = () => { renders += 1; };
const P = A.usagePanel;
assert.ok(P && P.load && P.html, "accounts.js exposes the usage panel");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. A silent Worker: never "Loading…" past the wait, and the backup is not asked.
mode = "hang";
P.load(true);
assert.match(P.html(), /data-usage-state="loading"/);
await wait(400);
let html = P.html();
assert.equal(P.state(), "failed", "a silent Worker ends the load");
assert.match(html, /data-usage-state="failed"/);
assert.match(html, /data-acct="usage-retry"/, "Retry button");
assert.ok(!html.includes("Loading…"), "no endless spinner");
assert.match(html, /Cloudflare Worker/);
assert.match(html, /Render backup/);
assert.ok(html.includes("— of"), "the Worker row shows as unknown");
assert.ok(renders > 0, "the panel redraws when the load ends");
assert.ok(!calls.some((u) => u === BACKUP + "/v1/owner/usage"), "owner usage never goes to the backup");

// 2. An error answer also ends in the calm error.
mode = "error";
P.load(true);
await wait(100);
assert.equal(P.state(), "failed");
assert.match(P.html(), /data-acct="usage-retry"/);

// 3. Retry with a healthy Worker shows the report.
mode = "ok";
P.load(true);
await wait(100);
html = P.html();
assert.equal(P.state(), "ok");
assert.match(html, /data-usage-state="ok"/);
assert.match(html, /data-pool-cap/);
assert.match(html, /Worker requests today/);
console.log("ok usage panel");
