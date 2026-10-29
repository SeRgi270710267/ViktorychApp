// Unit tests for comments-client.js: shared in-flight loads, TTL cache,
// stale-while-revalidate, scoped abort, and the prefetch policy.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../comments-client.js");

function memStore() {
  const rows = new Map();
  return {
    rows,
    get: async (k) => rows.get(k) || null,
    put: async (k, v) => { rows.set(k, v); },
    del: async (k) => { rows.delete(k); },
    prune: async () => {}
  };
}

let clock = 1000;
const now = () => clock;

{
  // Two callers share one request.
  const c = C.create({ store: null, now });
  let calls = 0;
  const loader = () => { calls += 1; return new Promise((r) => setTimeout(() => r({ replies: [1, 2] }), 10)); };
  const [a, b] = await Promise.all([c.get("k", loader, { source: "x" }), c.get("k", loader, { source: "x" })]);
  assert.equal(calls, 1);
  assert.deepEqual(a.value, b.value);
  assert.equal(c.stats().x.shared, 1);
  // A reopen inside the stale window does not fetch.
  await c.get("k", loader, { source: "x" });
  assert.equal(calls, 1);
  assert.equal(c.stats().x.hits, 1);
}

{
  // Stale pages show at once and refresh in the background.
  clock = 1000;
  const c = C.create({ store: null, now });
  let n = 0;
  const loader = () => Promise.resolve({ v: ++n });
  await c.get("s", loader, {});
  clock += C.STALE_MS + 1;
  let updated = null;
  const row = await c.get("s", loader, { onUpdate: (r) => { updated = r; } });
  assert.equal(row.stale, true);
  assert.equal(row.value.v, 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(updated.value.v, 2);
  // Past the TTL the page is gone and the next read waits for the network.
  clock += C.TTL_MS + 1;
  assert.equal(c.peek("s"), null);
  const fresh = await c.get("s", loader, {});
  assert.equal(fresh.value.v, 3);
}

{
  // The IndexedDB copy serves a cold start inside the TTL.
  clock = 5000;
  const store = memStore();
  const first = C.create({ store, now });
  await first.get("p", () => Promise.resolve({ ok: 1 }), {});
  assert.ok(store.rows.get("p").bytes > 0);
  const second = C.create({ store, now });
  let hit = 0;
  const row = await second.get("p", () => { hit += 1; return Promise.resolve({ ok: 2 }); }, {});
  assert.equal(hit, 0);
  assert.equal(row.value.ok, 1);
}

{
  // Leaving a post aborts its load, but not one a prefetch still wants.
  clock = 9000;
  const c = C.create({ store: null, now });
  let seen = null;
  const slow = ({ signal }) => new Promise((resolve, reject) => {
    seen = signal;
    const t = setTimeout(() => resolve({ late: true }), 50);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("x"), { name: "AbortError" })); });
  });
  const p = c.get("a", slow, { scope: "view" });
  await new Promise((r) => setTimeout(r, 1));
  c.abortScope("view");
  await assert.rejects(p, (err) => err.name === "AbortError");
  assert.equal(seen.aborted, true);
  assert.equal(c.inFlight("a"), false);

  const q = c.get("b", slow, { scope: "prefetch" });
  await new Promise((r) => setTimeout(r, 1));
  c.get("b", slow, { scope: "view" });
  c.abortScope("view");
  assert.equal((await q).value.late, true);
}

{
  // Failures are not cached.
  const c = C.create({ store: null, now });
  await assert.rejects(c.get("f", () => Promise.reject(new Error("down")), { source: "y" }));
  assert.equal(c.stats().y.errors, 1);
  const ok = await c.get("f", () => Promise.resolve({ fine: 1 }), {});
  assert.equal(ok.value.fine, 1);
}

// Prefetch never runs on Save data or slow links.
assert.equal(C.canPrefetch({ saveData: true, hidden: false, connection: {} }), false);
assert.equal(C.canPrefetch({ connection: { effectiveType: "3g" } }), false);
assert.equal(C.canPrefetch({ connection: { effectiveType: "2g" } }), false);
assert.equal(C.canPrefetch({ connection: { effectiveType: "4g" } }), true);

// Small avatars in data-saving mode.
assert.equal(C.smallAvatar("https://pbs.twimg.com/profile_images/1/a_normal.jpg", true), "https://pbs.twimg.com/profile_images/1/a_mini.jpg");
assert.equal(C.smallAvatar("https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj", true), "https://yt3.ggpht.com/abc=s32-c-k-c0x00ffffff-no-rj");
assert.equal(C.smallAvatar("https://cdn.bsky.app/img/avatar/plain/did/x@jpeg", true), "https://cdn.bsky.app/img/avatar_thumbnail/plain/did/x@jpeg");
assert.equal(C.smallAvatar("https://example.com/a.png", true), "https://example.com/a.png");
assert.equal(C.smallAvatar("https://pbs.twimg.com/profile_images/1/a_normal.jpg", false), "https://pbs.twimg.com/profile_images/1/a_normal.jpg");

console.log("comments client ok");
