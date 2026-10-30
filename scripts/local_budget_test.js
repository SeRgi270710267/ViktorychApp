/* localStorage stays small. The browser gives an origin about 5 Mi
   characters (2.5 Mi in Safari), shared by every page on the address, and the
   "Saved settings are full" alert reads it. Large and growing data (route
   snapshots, caches) live in IndexedDB or under size caps; this checks that
   a long session stays near half a megabyte, that the start-up migration
   moves the bloated keys older versions left, that the reading counts the
   way the browser does, and that "Free up space" never touches settings,
   drafts or sign-in. */
const assert = require("assert");

function storage(quota) {
  const data = new Map();
  const api = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      v = String(v);
      let used = 0;
      for (const [key, val] of data) if (key !== k) used += key.length + val.length;
      if (quota && used + k.length + v.length > quota) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      data.set(k, v);
    },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
    units() { let n = 0; for (const [k, v] of data) n += k.length + v.length; return n; },
    keys: () => [...data.keys()]
  };
  return api;
}

function memoryDb() {
  const v = new Map();
  const m = new Map();
  return {
    v, m,
    get: async (k) => (v.has(k) ? v.get(k) : null),
    put: async (k, row, meta) => { v.set(k, row); m.set(k, meta); return true; },
    touch: async (metas) => { Object.keys(metas).forEach((k) => { if (m.has(k)) m.set(k, metas[k]); }); },
    del: async (k) => { v.delete(k); m.delete(k); },
    list: async () => [...m.entries()].map(([k, meta]) => ({ k, b: meta.b, u: meta.u })),
    clear: async () => { v.clear(); m.clear(); }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (n, size) => {
  const post = `<article class="post" data-id="${n}"><p>${"lorem ipsum ".repeat(40)}</p></article>`;
  let html = "<main>";
  while (html.length < size) html += post;
  return html + "</main>";
};

const ls = storage(5 * 1024 * 1024);
global.localStorage = ls;
global.window = global;
/* shared/ is an ES module folder; the budget is a classic page script. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
vm.runInThisContext("(function (self) {" + fs.readFileSync(path.join(__dirname, "../shared/local-budget.js"), "utf8") + "\n})")(global);
const budget = global.ViktorychLocalBudget;
assert.ok(budget && budget.migrate, "the budget script loads");
const localfirst = require("../localfirst.js");
const swr = localfirst.swr;
const db = memoryDb();

(async () => {
  /* Settings, drafts and sign-in a real profile holds. */
  ls.setItem("viktorychapp-settings-v1", JSON.stringify({ theme: "dim", lang: "es", font: 15 }));
  ls.setItem("viktorychapp-drafts-v1", JSON.stringify([{ id: 1, text: "half a thought" }]));
  ls.setItem("viktorych-account-v1", JSON.stringify({ token: "t".repeat(400) }));
  ls.setItem("superintelapp-lang", "es");
  ls.setItem("other-page-on-the-origin", "x".repeat(2000));

  /* 1. Migration: what an older build left behind. */
  const old = storage(0);
  old.setItem("viktorychapp-settings-v1", ls.getItem("viktorychapp-settings-v1"));
  old.setItem("viktorychapp-drafts-v1", ls.getItem("viktorychapp-drafts-v1"));
  old.setItem("superintelapp-lang", "es");
  old.setItem("superintelapp-settings-v1", old.getItem("viktorychapp-settings-v1"));
  const index = {};
  for (let i = 0; i < 12; i++) {
    const key = (i % 4 === 0 ? "private-list:route:#/messages/" : "route:#/post/") + i;
    const value = JSON.stringify({ v: page(i, 140000), t: Date.now() - i * 1000 });
    old.setItem("viktorych-swr-v1:" + key, value);
    index[key] = { b: value.length, u: Date.now() - i * 1000, t: Date.now() - i * 1000 };
  }
  old.setItem("viktorych-swr-v1:route:#/orphan", JSON.stringify({ v: page(99, 60000), t: Date.now() }));
  old.setItem("viktorych-swr-v1-index", JSON.stringify(index));
  old.setItem("viktorych-screen-v1", JSON.stringify({ schema: 1, hash: "#/", html: page(0, 187000), at: Date.now() }));
  old.setItem("viktorychapp-translate-v1", JSON.stringify({ entries: { a: { text: "y".repeat(200000), at: 1 } } }));
  const before = old.units();
  assert.ok(before > 1800000, "the old profile is bloated: " + before);

  swr.useDb(db);
  swr.reset();
  const report = localfirst.migrateLocal(old);
  await sleep(50);
  const after = old.units();
  assert.ok(after < 500000, "migration leaves settings storage small: " + after);
  assert.ok(report.swr.moved > 0, "public snapshots move to IndexedDB");
  assert.ok(report.screen > 0, "the saved screen is trimmed");
  assert.ok([...db.v.keys()].some((k) => k.indexOf("route:#/post/") >= 0), "a moved snapshot is in IndexedDB");
  assert.ok(![...db.v.keys()].some((k) => k.indexOf("private-list") >= 0), "private snapshots never leave localStorage");
  assert.strictEqual(old.getItem("superintelapp-settings-v1"), null, "a duplicate old copy is removed");
  assert.strictEqual(old.getItem("superintelapp-lang"), "es", "the language key older builds read stays");
  assert.strictEqual(old.getItem("viktorychapp-translate-v1"), null, "a runaway cache is dropped");
  assert.ok(old.getItem("viktorychapp-settings-v1") && old.getItem("viktorychapp-drafts-v1"), "settings and drafts stay");
  const screen = JSON.parse(old.getItem("viktorych-screen-v1"));
  assert.ok(screen.html.length <= localfirst.screenLimit && /<\/article>$/.test(screen.html), "the screen is cut at a post");
  /* Running it again is a no-op. */
  const again = localfirst.migrateLocal(old);
  assert.strictEqual(again.swr.freed + again.screen, 0);

  /* 2. A long session: hundreds of pages, screens and timeline saves. */
  swr.useDb(memoryDb());
  swr.reset();
  for (let i = 0; i < 400; i++) {
    const hash = i % 7 === 0 ? "#/messages/" + i : i % 3 === 0 ? "#/u/user" + i : "#/post/" + i;
    localfirst.saveRoute(hash, page(i, 20000 + (i * 7919) % 125000));
    if (i % 5 === 0) localfirst.capture({ hash, html: page(i, 190000), y: i });
    if (i % 40 === 0) await sleep(450);
  }
  await sleep(500);
  const used = ls.units();
  assert.ok(used < 500000, "a long session stays under 500 KB of localStorage: " + used);
  const read = budget.reading(ls, { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0" });
  assert.strictEqual(read.used, used, "the reading counts characters, the unit the browser limits");
  assert.strictEqual(read.limit, 5 * 1024 * 1024);
  assert.ok(read.by.other.units >= 2000 && read.by.snapshots.units > 0);
  const safari = budget.reading(ls, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  assert.strictEqual(safari.limit, 2.5 * 1024 * 1024, "Safari and iOS give half as much");

  /* 3. Free up space clears what the app rebuilds, nothing else. */
  ls.setItem("viktorychapp-translate-v1", JSON.stringify({ entries: { b: { text: "ok", at: 2 } } }));
  const freed = budget.clearSafe(ls);
  assert.ok(freed > 0);
  for (const key of ["viktorychapp-settings-v1", "viktorychapp-drafts-v1", "viktorych-account-v1", "superintelapp-lang", "other-page-on-the-origin"]) {
    assert.ok(ls.getItem(key) !== null, key + " survives Free up space");
  }
  assert.strictEqual(budget.measure(ls).by.snapshots.units, 0);
  assert.strictEqual(budget.measure(ls).by.caches.units, 0);
  console.log("local budget ok (session " + used + " chars, migration " + before + " -> " + after + ")");
})().catch((err) => { console.error(err); process.exit(1); });
