// Origin pool balancing and sealed catalogs. Run: node scripts/pool_balance_test.mjs
// Reads are shared across origins by the room each has left today, one
// sticky origin per tab; writes stay on the main Worker; a sleeping backup
// gets four seconds; sealed catalogs on Pages answer before the API.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { sealText, sealDay, toB64, sealKeyBytes } from "../worker/src/data-seal.js";

const MAIN = "https://main.test";
const BACKUP = "https://backup.test";
const SECRET = "pepper-for-tests";
const local = new Map();
const session = new Map();
const calls = [];
const state = { quota: "40", backupToday: 0, hours: null, backupDelay: 0, sealed: {}, seal401: false, data401: false };
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
const document = Object.assign(el(), {
  readyState: "complete", visibilityState: "visible", documentElement: el(), body: el(), head: el(),
  createElement: el, getElementById() { return null; }, dispatchEvent() { return true; }
});
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });
}
async function fetchStub(url, init) {
  url = String(url);
  calls.push({ url, method: (init && init.method) || "GET" });
  const headers = new Headers({ "content-type": "application/json" });
  if (url.startsWith(MAIN)) headers.set("X-Quota-Pct", state.quota);
  if (url === BACKUP + "/backup/status") {
    return new Response(JSON.stringify({ ok: true, today: { date: sealDay(Date.now()), requests: state.backupToday }, dayCapacity: 100000, hours: state.hours }), { status: 200, headers });
  }
  if (url === BACKUP + "/backup/health") return new Response("{}", { status: 200, headers });
  if (url.startsWith("https://site.test/sealed/")) {
    const name = url.slice("https://site.test/sealed/".length);
    return state.sealed[name] ? new Response(JSON.stringify(state.sealed[name]), { status: 200, headers }) : new Response("", { status: 404 });
  }
  if (url.endsWith("/v1/seal")) {
    if (state.seal401) return new Response("{}", { status: 401, headers });
    const day = sealDay(Date.now());
    return new Response(JSON.stringify({ v: 1, use: true, keys: { [day]: toB64(await sealKeyBytes(SECRET, day)) } }), { status: 200, headers });
  }
  if (url.startsWith(BACKUP) && state.backupDelay) await delay(state.backupDelay, init && init.signal);
  if (url.includes("/v1/data/") && state.data401) return new Response("{}", { status: 401, headers });
  return new Response(JSON.stringify({ from: url.startsWith(MAIN) ? "main" : "backup" }), { status: 200, headers });
}
const win = {
  VIKTORYCH_ACCOUNTS: { api: MAIN, backupApi: BACKUP, gate: true },
  localStorage: { getItem: (k) => local.has(k) ? local.get(k) : null, setItem: (k, v) => local.set(k, String(v)), removeItem: (k) => local.delete(k) },
  sessionStorage: { getItem: (k) => session.has(k) ? session.get(k) : null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
  location: { href: "https://site.test/", origin: "https://site.test", pathname: "/", hostname: "site.test", hash: "", search: "" },
  navigator: { userAgent: "node", onLine: true },
  document, fetch: fetchStub, Headers, Response, Request, URL, AbortController, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  crypto: globalThis.crypto, atob, btoa, TextEncoder, TextDecoder, Uint8Array,
  setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {} }; }, requestAnimationFrame(fn) { return setTimeout(fn, 0); },
  console, Date, Math, JSON, Promise
};
win.window = win; win.self = win; win.globalThis = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(new URL("../accounts.js", import.meta.url), "utf8"), win, { filename: "accounts.js" });
const A = win.ViktorychAccounts;
const P = A.originPool;

// Weighted pick: proportional to the weights.
assert.equal(P.pick(["a", "b"], { a: 30, b: 70 }, 0.29), "a");
assert.equal(P.pick(["a", "b"], { a: 30, b: 70 }, 0.31), "b");
assert.equal(P.pick(["a", "b"], { a: 0, b: 0 }, 0.9), "a", "no room anywhere keeps config order");

// Weights follow the room left: Worker 90% used, backup 10% used.
await A.call("/v1/features"); // learns X-Quota-Pct 40 from the main Worker (or the backup answers)
state.quota = "90";
session.clear();
// Force a main read so the header lands.
await P.quotaNote(MAIN, new Response("{}", { headers: { "X-Quota-Pct": "80" } }));
state.backupToday = 10000;
await P.warm(true);
const w = P.weights();
assert.equal(Math.round(w[MAIN]), 20000, "Worker: 100k cap, 80% used");
assert.equal(Math.round(w[BACKUP]), 90000, "backup: 100k cap, 10% used");

// Many tabs: reads split close to 20:90.
let toBackup = 0;
for (let i = 0; i < 400; i++) {
  session.clear();
  if (P.readOrder()[0] === BACKUP) toBackup += 1;
}
assert.ok(toBackup > 290 && toBackup < 365, "about 82% of tabs read from the backup, got " + toBackup);

// One tab is sticky.
session.clear();
const first = P.readOrder()[0];
for (let i = 0; i < 20; i++) assert.equal(P.readOrder()[0], first, "the tab keeps its origin");

// Writes stay on the main Worker whatever the tab drew.
await A.call("/v1/posts", { method: "POST", body: { a: 1 } });
assert.equal(calls.at(-1).url, MAIN + "/v1/posts");

// A Worker at 85% or more leaves the draw entirely.
await P.quotaNote(MAIN, new Response("{}", { headers: { "X-Quota-Pct": "91" } }));
assert.equal(P.shifted(), true);
for (let i = 0; i < 50; i++) { session.clear(); assert.equal(P.readOrder()[0], BACKUP); }
await P.quotaNote(MAIN, new Response("{}", { headers: { "X-Quota-Pct": "30" } }));
assert.equal(P.shifted(), false);

// A cold backup: a read that takes more than four seconds also goes to the Worker.
local.set("viktorychapp-quota-v1", JSON.stringify(Object.assign(JSON.parse(local.get("viktorychapp-quota-v1")), { warm: {} })));
assert.equal(P.originWarm(BACKUP), false);
session.set("viktorychapp-pool-pick-v1", JSON.stringify({ root: BACKUP, until: Date.now() + 600000, day: sealDay(Date.now()) }));
state.backupDelay = 6000;
const t0 = Date.now();
const body = await A.call("/v1/friends");
const took = Date.now() - t0;
assert.equal(body.from, "main", "the Worker answered the cold read");
assert.ok(took >= 3900 && took < 5500, "fell back after about four seconds, took " + took);
state.backupDelay = 0;
// A warm backup answers directly.
P.warmNote(BACKUP, 300);
assert.equal(P.originWarm(BACKUP), true);
assert.equal((await A.call("/v1/friends")).from, "backup");

// Sealed catalogs: read from Pages with today's key; the API is not asked.
local.set("viktorychapp-account-v1", JSON.stringify({ token: "tok-123456789abc", account: { handle: "a" } }));
const day = sealDay(Date.now());
const plain = JSON.stringify({ posts: [{ id: 1 }], feeds: [] });
state.sealed["feeds.json"] = await sealText(SECRET, day, "feeds.json", plain);
calls.length = 0;
const res = await win.fetch("feeds.json");
assert.equal(await res.text(), plain);
assert.equal(res.headers.get("x-sealed"), "pages");
assert.ok(!calls.some((c) => c.url.includes("/v1/data/")), "no API read for a sealed catalog");
assert.equal(calls.filter((c) => c.url.endsWith("/v1/seal")).length, 1, "one key fetch");
calls.length = 0;
await win.fetch("feeds.json");
assert.equal(calls.filter((c) => c.url.endsWith("/v1/seal")).length, 0, "the key is kept for the day");

// A copy sealed for another catalog does not open (the name is bound).
state.sealed["people.json"] = await sealText(SECRET, day, "feeds.json", plain);
calls.length = 0;
const people = await win.fetch("people.json");
assert.ok(calls.some((c) => c.url.includes("/v1/data/people.json")), "a swapped file falls back to the API");
assert.equal(people.status, 200);

// An old copy falls back to the API.
state.sealed["stories.json"] = await sealText(SECRET, day, "stories.json", "{}", new Date(Date.now() - 3 * 3600 * 1000).toISOString());
calls.length = 0;
await win.fetch("stories.json");
assert.ok(calls.some((c) => c.url.includes("/v1/data/stories.json")), "an old sealed copy is not used");

// A 401 on data stops sending that token for data for a while.
state.data401 = true;
calls.length = 0;
const r1 = await win.fetch("status.json");
assert.equal(r1.status, 401);
const before = calls.length;
const r2 = await win.fetch("suggestions.json");
assert.equal(r2.status, 401);
assert.equal(calls.length, before, "no request while the token is known to be refused");
assert.equal(P.dataDenied("tok-123456789abc"), true);
assert.equal(P.dataDenied("another-token"), false, "a new sign-in is not held back");

// Render's free hours: the share shrinks from 60% and stops at the cutoff.
state.data401 = false;
const reset = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString();
state.backupToday = 10000;
state.hours = { used: 525, left: 225, pct: 70, paused: false, resetAt: reset };
await P.warm(true);
assert.ok(Math.abs(P.hoursFactor() - 2 / 3) < 1e-9, "70% of hours: two thirds of its share");
assert.equal(Math.round(P.weights()[BACKUP]), 60000);
state.hours = { used: 690, left: 60, pct: 92, paused: true, resetAt: reset };
await P.warm(true);
assert.equal(P.paused(), true);
assert.equal(P.weights()[BACKUP], 0, "a resting backup gets no reads");
for (let i = 0; i < 30; i++) { session.clear(); assert.equal(P.readOrder()[0], MAIN); }
calls.length = 0;
await P.warm(false);
P.wake(MAIN);
assert.ok(!calls.some((c) => c.url.startsWith(BACKUP)), "no warm ping or wake while resting");
// The Usage row says it is resting, calmly, and it raises no bypass alert.
const pool = A.serverPoolFrom({ configured: true, workerRequestsToday: 50000, limits: { workerRequestsDay: 100000 } }, { ok: true, hours: state.hours, today: { date: sealDay(Date.now()), requests: 0 }, dayCapacity: 100000 });
const html = A.poolCapacityHtml(pool);
assert.ok(html.includes("Resting until"), "resting note shown");
assert.ok(!html.includes("Not answering"), "not shown as a fault");
assert.ok(html.includes("pool-origin resting"));
assert.deepEqual(Array.from(pool.bypassed), []);
assert.equal(pool.cap, 100000, "only the Worker counts while the backup rests");
// A new month: hours reset, the backup is back in the draw.
local.set("viktorychapp-quota-v1", JSON.stringify(Object.assign(JSON.parse(local.get("viktorychapp-quota-v1")), { hours: { pct: 95, paused: true, resetAt: new Date(Date.now() - 1000).toISOString() } })));
assert.equal(P.paused(), false);
assert.equal(P.hoursFactor(), 1);
console.log("ok pool balance");
