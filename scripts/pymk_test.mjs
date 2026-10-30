// Headless checks for People you may know: insertion frequency, rotation,
// dismiss, turn-off, per-type off, and followed-row filtering. Test data
// uses made-up handles only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const calls = [];
let followedIds = new Set();
globalThis.ViktorychAccounts = {
  account: () => ({ publicId: "viewer-x", handle: "pym_viewer" }),
  token: () => "tok",
  call: (p, o) => { calls.push([p, o]); return Promise.resolve({ status: 200 }); },
  toast: () => {}
};
const P = require(path.join(here, "..", "pymk.js"));

// ---- plan: first card after post 8–12, then gaps of 40, wider with "fewer".
for (let seed = 0; seed < 20; seed++) {
  const spots = P.plan(200, { seed });
  assert.ok(spots[0] >= 8 && spots[0] <= 12, "first card after post 8–12");
  for (let i = 1; i < spots.length; i++) assert.ok(spots[i] - spots[i - 1] >= 40, "at most one per 40 posts");
}
assert.deepEqual(P.plan(7, { seed: 0 }), [], "no card in a short feed");
assert.equal(P.plan(200, { seed: 0, max: 2 }).length, 2, "max caps cards");
const wide = P.plan(400, { seed: 0, fewer: 2 });
for (let i = 1; i < wide.length; i++) assert.ok(wide[i] - wide[i - 1] >= 120, "show fewer widens the gap");
assert.ok(P.plan(400, { seed: 0, fewer: 1 }).length < P.plan(400, { seed: 0 }).length);

// ---- rotation
assert.deepEqual(P.rotation(["a", "b", "c"], 1), ["b", "c", "a"]);
assert.deepEqual(P.rotation(["a", "b", "c"], 3), ["a", "b", "c"]);
assert.deepEqual(P.rotation([], 5), []);

// ---- interleave with a cached answer.
function seedCache(groups) {
  store.set("viktorychapp-pymk-cache", JSON.stringify({ who: "viewer-x", got: Date.now(), at: Date.now(), groups }));
}
function fresh(host) {
  P._reset();
  P.setHost(Object.assign({ isFollowed: (id) => followedIds.has(id), render: () => {} }, host || {}));
}
const person = (h, r) => ({ id: "app:@" + h, h, n: h.replace("pym_", "Pym "), a: "", k: "person", r: r || { k: "fy" } });
seedCache({
  people: [person("pym_ana"), person("pym_bo", { k: "fof", name: "Pym Cy", n: 0 }), person("pym_cy"), person("pym_di")],
  companies: [{ id: "app:@pym_shop", h: "pym_shop", n: "Pym Shop", a: "", k: "business", r: { k: "fofn", n: 2 } }],
  communities: [{ id: "pymgarden", n: 3 }]
});
const posts = Array.from({ length: 120 }, (_, i) => `<article>${i}</article>`);
const cardsIn = (html) => (html.match(/<section class="pymk/g) || []).length;

fresh();
let html = P.interleave(posts);
assert.equal(cardsIn(html), 3, "120 posts → 3 cards (one per type, rotated)");
for (const g of ["people", "companies", "communities"]) assert.ok(html.includes(`data-pymk="${g}"`), "card for " + g);
const firstCard = html.indexOf("<section");
const before = (html.slice(0, firstCard).match(/<article>/g) || []).length;
assert.ok(before >= 8 && before <= 12, "first card after post 8–12, got " + before);
assert.ok(!/\b\d{12}\b/.test(html), "no 12-digit account ids in the card");
assert.ok(html.includes("pymk-sq"), "business gets a square avatar");
// Each card has at most three rows.
const peopleCard = html.slice(html.indexOf('data-pymk="people"'));
const peopleRows = (peopleCard.slice(0, peopleCard.indexOf("</section>")).match(/data-act="pymk-dismiss"/g) || []).length;
assert.ok(peopleRows <= 3 && peopleRows >= 1, "1–3 rows per card");

// Rotation differs between visits.
fresh();
const nextVisit = P.interleave(posts);
const firstType = (s) => s.match(/data-pymk="(\w+)"/)[1];
assert.notEqual(firstType(html), firstType(nextVisit), "next visit starts with another type");

// ---- followed-row filtering: rows followed before this visit are hidden.
followedIds = new Set(["app:@pym_ana"]);
fresh();
html = P.interleave(posts);
assert.ok(!html.includes("@pym_ana"), "already followed row is hidden");
followedIds = new Set();

// ---- dismiss: optimistic hide and queued for the server.
fresh();
calls.length = 0;
P.act("pymk-dismiss", { dataset: { key: "app:@pym_bo", group: "people" } });
assert.ok(P.prefs().hidden.includes("app:@pym_bo"));
html = P.interleave(posts);
assert.ok(!html.includes("@pym_bo"), "dismissed row is gone at once");
assert.ok(calls.some(([p, o]) => p === "/v1/suggestions/dismiss" && o.body.id === "app:@pym_bo"), "dismiss sent to server");
P.act("pymk-dismiss", { dataset: { key: "c:pymgarden", group: "communities" } });
assert.ok(calls.some(([p, o]) => p === "/v1/suggestions/dismiss" && o.body.community === "pymgarden"));
html = P.interleave(posts);
assert.ok(!html.includes('data-pymk="communities"'), "community card gone when its only row is dismissed");

// Offline: dismissal stays queued.
fresh();
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
calls.length = 0;
P.act("pymk-dismiss", { dataset: { key: "app:@pym_cy", group: "people" } });
assert.equal(calls.length, 0, "nothing sent offline");
assert.ok(JSON.parse(store.get("viktorychapp-pymk")).pending.some((x) => x.id === "app:@pym_cy"), "queued while offline");
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });

// ---- show fewer, per-type off, master off.
fresh();
P.act("pymk-fewer", { dataset: {} });
assert.equal(P.prefs().fewer, 1);
fresh();
P.act("pymk-off-type", { dataset: { group: "companies" } });
html = P.interleave(posts);
assert.ok(!html.includes('data-pymk="companies"'), "type turned off");
fresh();
P.act("pymk-off", { dataset: {} });
html = P.interleave(posts);
assert.equal(cardsIn(html), 0, "Turn off removes every card");
assert.equal(html, posts.join(""), "feed is untouched when off");
fresh();
P.act("pymk-toggle", { dataset: {} });
assert.equal(P.prefs().on, true, "settings toggle turns it back on");

// Signed out: nothing.
const acc = globalThis.ViktorychAccounts.account;
globalThis.ViktorychAccounts.account = () => null;
fresh();
assert.equal(cardsIn(P.interleave(posts)), 0, "no cards when signed out");
globalThis.ViktorychAccounts.account = acc;

// Reset hidden.
fresh();
P.act("pymk-reset", { dataset: {} });
assert.deepEqual(P.prefs().hidden, []);
assert.equal(P.prefs().fewer, 0);

// ---- Desktop right column: one "Who to follow" panel from both sources.
seedCache({
  people: [person("pym_ana"), Object.assign(person("pym_bo", { k: "fof", name: "Pym Cy", n: 2 }), { b: "Makes  maps\nand tea" })],
  creators: [{ id: "app:@pym_maker", h: "pym_maker", n: "Pym Maker", a: "", k: "creator", r: { k: "cm", c: "pymgarden" } }]
});
const outside = [
  { id: "x:pym_ana", platform: "x", handle: "pym_ana", name: "Someone Else", avatar: "", verifiedType: "blue", bio: "Same handle as an account" },
  { id: "yt:pymchan", platform: "youtube", handle: "pymchan", name: "Pym Maker", avatar: "" },
  { id: "x:pym_news", platform: "x", handle: "pym_news", name: "Pym News", avatar: "", bio: "Daily news" }
];
fresh({ feedPeople: () => outside, sourceBadge: (p) => `<span class="src">${p}</span>` });
P.act("pymk-reset", { dataset: {} });
const side = P.sideHtml();
assert.ok(side.includes('class="card pymk-side"'), "side panel renders as a card");
const sideRows = (side.match(/data-pymk-row="/g) || []).length;
assert.equal(sideRows, 4, "duplicate handle and duplicate name are merged (5 → 4 rows)");
assert.ok(side.indexOf("pym_ana") < side.indexOf("pym_news"), "accounts first, then outside sources");
assert.ok(side.includes("Pym News") && side.includes("Daily news"), "outside source with its bio");
assert.ok(side.includes("Followed by {name} and {n} others"), "mutual reason shown");
assert.ok(side.includes('href="#/connect"'), "Show more opens the full list");
assert.ok(!side.includes("Someone Else"), "outside duplicate of an account is dropped");
// Dismissing an outside row stays on this device (no Worker call).
const before2 = calls.length;
P.act("pymk-dismiss", { dataset: { key: "x:pym_news", src: "feed", group: "people" } });
assert.ok(!P.sideHtml().includes("Pym News"), "dismissed outside row is gone");
assert.ok(!P.prefs().pending.some((x) => x.id === "x:pym_news"), "outside dismiss is not sent to the Worker");
assert.ok(calls.length >= before2);
// Signed out: outside sources still fill the panel; no account rows.
globalThis.ViktorychAccounts.account = () => null;
fresh({ feedPeople: () => outside });
assert.ok(!P.sideHtml().includes("pym_bo"), "no account rows signed out");
globalThis.ViktorychAccounts.account = acc;
// Nothing at all: the panel stays, with an empty line.
seedCache({});
fresh({ feedPeople: () => [] });
assert.ok(P.sideHtml().includes("pymk-side-empty"), "empty panel keeps its place");

console.log("pymk ok");
