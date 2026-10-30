/* Cast to the TV app (worker/src/tv-cast.js): only signed-in accounts,
   https links only, each item goes out once, items expire, a few at most
   per account, and accounts never see each other's items. */
import { handleTvCast, castUrl, castTitle, TV_CAST_TTL_MS, TV_CAST_MAX_PENDING, TV_CAST_SEEN_MS } from "../worker/src/tv-cast.js";
import assert from "node:assert/strict";

let casts = [];
const seen = new Map();
let clock = 5000000;
Date.now = () => clock;
let seenWrites = 0;

function stmt(sql) {
  let args = [];
  const api = {
    bind(...a) { args = a; return api; },
    async run() {
      if (sql.startsWith("CREATE")) return { meta: { changes: 0 } };
      if (sql.startsWith("DELETE FROM tv_casts WHERE expires_at <= ?")) { casts = casts.filter((c) => c.expires_at > args[0]); return { meta: { changes: 0 } }; }
      if (sql.startsWith("INSERT INTO tv_casts")) {
        casts.push({ id: args[0], public_id: args[1], url: args[2], title: args[3], created_at: args[4], expires_at: args[5] });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM tv_casts WHERE public_id = ? AND id NOT IN")) {
        const mine = casts.filter((c) => c.public_id === args[0]).sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1)).slice(0, args[2]).map((c) => c.id);
        casts = casts.filter((c) => c.public_id !== args[0] || mine.includes(c.id));
        return { meta: { changes: 0 } };
      }
      if (sql.startsWith("DELETE FROM tv_casts WHERE id = ? AND public_id = ?")) {
        const before = casts.length;
        casts = casts.filter((c) => !(c.id === args[0] && c.public_id === args[1]));
        return { meta: { changes: before - casts.length } };
      }
      if (sql.startsWith("INSERT INTO tv_cast_seen")) {
        const old = seen.get(args[0]);
        if (old === undefined || old <= args[2]) { seen.set(args[0], args[1]); seenWrites++; }
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM tv_cast_seen")) { seen.delete(args[0]); return { meta: { changes: 1 } }; }
      throw new Error("unexpected sql " + sql);
    },
    async first() {
      if (sql.startsWith("SELECT seen_at FROM tv_cast_seen")) return seen.has(args[0]) ? { seen_at: seen.get(args[0]) } : null;
      if (sql.startsWith("SELECT id, url, title, created_at FROM tv_casts")) {
        const mine = casts.filter((c) => c.public_id === args[0] && c.expires_at > args[1]).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
        return mine[0] || null;
      }
      throw new Error("unexpected sql " + sql);
    }
  };
  return api;
}
const env = { DB: { prepare: stmt, batch: async (list) => Promise.all(list.map((s) => s.run())) } };
const sessions = { "va1.phone": { public_id: "100000000001" }, "va1.tv": { public_id: "100000000001" }, "va1.other": { public_id: "100000000002" }, "va1.em": { public_id: "emergency_owner" } };
let limitedNext = false;
const deps = {
  json: (status, body) => ({ status, body }),
  sessionAccount: async (e, req) => sessions[(req.headers.get("Authorization") || "").replace("Bearer ", "")] || null,
  rateHit: async () => (limitedNext ? { ok: false } : { ok: true }),
  limited: () => ({ status: 429, body: { error: "rate_limited" } })
};
function req(path, body, token, method) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return new Request("https://w.example" + path, { method: method || "POST", headers, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
}
const call = (path, body, token, method) => handleTvCast(req(path, body, token, method), env, deps);

// Links and titles.
assert.equal(castUrl("https://viktorychapp.pages.dev/#/post/1"), "https://viktorychapp.pages.dev/#/post/1");
assert.equal(castUrl(" https://youtu.be/dQw4w9WgXcQ "), "https://youtu.be/dQw4w9WgXcQ");
for (const bad of ["http://x.com/a/status/1", "javascript:alert(1)", "https://user:pw@example.com/", "https://localhost/a", "https://a.com/<x>", "intent://x#Intent;end", "https://a.com/" + "x".repeat(2001), "", null]) assert.equal(castUrl(bad), "", String(bad).slice(0, 40));
assert.equal(castTitle("  A <b>post</b>\n\tby  someone "), "A b post /b by someone");
assert.equal(castTitle("x".repeat(300)).length, 120);

// Signed out, the emergency owner, wrong methods and paths.
assert.equal((await call("/v1/tv-cast/send", { url: "https://youtu.be/dQw4w9WgXcQ" })).status, 401);
assert.equal((await call("/v1/tv-cast/next", {}, "va1.em")).status, 401);
assert.equal((await call("/v1/tv-cast/next", {}, "va1.tv", "GET")).status, 405);
assert.equal((await call("/v1/tv-cast/nope", {}, "va1.tv")).status, 404);
assert.equal((await handleTvCast(req("/v1/tv-cast/next", {}, "va1.tv"), {}, deps)).status, 503);
assert.equal((await call("/v1/tv-cast/send", { url: "http://insecure.example/a.mp4" }, "va1.phone")).body.error, "invalid_url");

// Nothing waiting; the TV's check marks it as listening.
let r = await call("/v1/tv-cast/next", {}, "va1.tv");
assert.deepEqual(r.body, { item: null, interval: 4 });
r = await call("/v1/tv-cast/send", { url: "https://youtu.be/dQw4w9WgXcQ", title: "A video" }, "va1.phone");
assert.equal(r.status, 200);
assert.equal(r.body.listening, true);
assert.equal(r.body.expiresIn, TV_CAST_TTL_MS / 1000);

// Another account never gets it; the TV gets it exactly once.
assert.equal((await call("/v1/tv-cast/next", {}, "va1.other")).body.item, null);
clock += 10;
r = await call("/v1/tv-cast/next", {}, "va1.tv");
assert.deepEqual(r.body.item, { url: "https://youtu.be/dQw4w9WgXcQ", title: "A video", at: 5000000 });
assert.equal((await call("/v1/tv-cast/next", {}, "va1.tv")).body.item, null);

// The "listening" mark is written at most once a minute.
const before = seenWrites;
for (let i = 0; i < 5; i++) { clock += 4000; await call("/v1/tv-cast/next", {}, "va1.tv"); }
assert.equal(seenWrites, before);
clock += TV_CAST_SEEN_MS;
await call("/v1/tv-cast/next", {}, "va1.tv");
assert.equal(seenWrites, before + 1);

// Closing the Cast screen: the phone hears no TV is listening.
await call("/v1/tv-cast/stop", {}, "va1.tv");
assert.equal((await call("/v1/tv-cast/send", { url: "https://x.com/a/status/12345678" }, "va1.phone")).body.listening, false);
await call("/v1/tv-cast/next", {}, "va1.tv");

// Items expire after two minutes.
clock += TV_CAST_TTL_MS + 1;
assert.equal((await call("/v1/tv-cast/next", {}, "va1.tv")).body.item, null);

// Oldest first, and at most a few kept per account.
for (let i = 0; i < TV_CAST_MAX_PENDING + 3; i++) { clock += 1; await call("/v1/tv-cast/send", { url: "https://example.com/v" + i + ".mp4" }, "va1.phone"); }
assert.equal(casts.filter((c) => c.public_id === "100000000001").length, TV_CAST_MAX_PENDING);
assert.equal((await call("/v1/tv-cast/next", {}, "va1.tv")).body.item.url, "https://example.com/v3.mp4");

// Sending is rate limited per account.
limitedNext = true;
assert.equal((await call("/v1/tv-cast/send", { url: "https://example.com/a.mp4" }, "va1.phone")).status, 429);
limitedNext = false;

console.log("tv cast ok");
