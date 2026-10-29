/* TV sign-in with a phone: codes are short and readable, the record is
   used once, it expires, and only a hash of the TV's secret is stored. */
import { handleTvPair, cleanCode, newCode, askName, TV_PAIR_ALPHABET, TV_PAIR_TTL_MS, TV_ASK_PER_CODE, TV_ASK_PER_NAME } from "../worker/src/tv-pair.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const rows = new Map();
const asks = new Map();
let clock = 1000000;
const realNow = Date.now;
Date.now = () => clock;

function stmt(sql) {
  let args = [];
  const api = {
    bind(...a) { args = a; return api; },
    async run() {
      if (sql.startsWith("CREATE")) return { meta: { changes: 0 } };
      if (sql.startsWith("DELETE FROM tv_pairs WHERE expires_at")) { for (const [k, r] of rows) if (r.expires_at <= args[0]) rows.delete(k); return { meta: { changes: 0 } }; }
      if (sql.startsWith("INSERT INTO tv_pairs")) {
        if (rows.has(args[0])) throw new Error("unique");
        rows.set(args[0], { code: args[0], poll_hash: args[1], public_id: null, created_at: args[2], expires_at: args[3] });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM tv_pairs WHERE poll_hash = ? AND public_id IS NOT NULL")) {
        for (const [k, r] of rows) if (r.poll_hash === args[0] && r.public_id) { rows.delete(k); return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (sql.startsWith("DELETE FROM tv_pairs WHERE poll_hash")) { for (const [k, r] of rows) if (r.poll_hash === args[0]) rows.delete(k); return { meta: { changes: 1 } }; }
      if (sql.startsWith("DELETE FROM tv_pair_asks WHERE expires_at")) { for (const [k, r] of asks) if (r.expires_at <= args[0]) asks.delete(k); return { meta: { changes: 0 } }; }
      if (sql.startsWith("DELETE FROM tv_pair_asks WHERE code")) { asks.delete(args[0]); return { meta: { changes: 1 } }; }
      if (sql.startsWith("INSERT INTO tv_pair_asks")) { asks.set(args[0], { code: args[0], public_id: args[1], denied: 0, created_at: args[2], expires_at: args[3] }); return { meta: { changes: 1 } }; }
      if (sql.startsWith("UPDATE tv_pair_asks SET denied = 1")) {
        const r = asks.get(args[0]);
        if (r && r.public_id === args[1] && r.expires_at > args[2]) { r.denied = 1; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      if (sql.startsWith("UPDATE tv_pairs SET public_id")) {
        const r = rows.get(args[1]);
        if (r && !r.public_id && r.expires_at > args[2]) { r.public_id = args[0]; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      throw new Error("unexpected sql " + sql);
    },
    async first() {
      if (sql.startsWith("SELECT code, public_id, expires_at FROM tv_pairs WHERE poll_hash")) {
        for (const r of rows.values()) if (r.poll_hash === args[0]) return r;
        return null;
      }
      if (sql.startsWith("SELECT denied FROM tv_pair_asks WHERE code")) return asks.get(args[0]) || null;
      throw new Error("unexpected sql " + sql);
    }
  };
  return api;
}
const env = { DB: { prepare: stmt, batch: async (list) => Promise.all(list.map((s) => s.run())) } };

const minted = [];
const sessions = { "va1.phone": { public_id: "acct-1", handle: "x" } };
const deps = {
  json: (status, body) => ({ status, body }),
  sha256Hex: async (v) => createHash("sha256").update(String(v)).digest("hex"),
  rateHit: async () => ({ ok: true }),
  limited: () => ({ status: 429, body: {} }),
  clientIp: () => "1.2.3.4",
  mintSession: async (_env, id) => { const t = "va1.tv" + minted.length; minted.push(t); sessions[t] = { public_id: id, handle: "x" }; return t; },
  sessionAccount: async (_env, req) => { const m = String(req.headers.get("Authorization") || "").match(/^Bearer (.+)$/); return m ? sessions[m[1]] || null : null; },
  presentAccount: async (_env, _req, row) => ({ id: row.public_id }),
  blockDeletedLogin: async () => false
};
function req(path, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return new Request("https://w.example" + path, { method: "POST", headers, body: JSON.stringify(body || {}) });
}

for (let i = 0; i < 200; i++) {
  const c = newCode();
  assert.equal(c.length, 6);
  for (const ch of c) assert.ok(TV_PAIR_ALPHABET.includes(ch), "readable alphabet");
}
assert.equal(cleanCode(" ab-c 234 "), "ABC234");
assert.equal(cleanCode("ABC10O"), "", "0, 1 and O are never in a code");

const started = await handleTvPair(req("/v1/tv-pair/start"), env, deps);
assert.equal(started.status, 200);
const { code, poll } = started.body;
assert.match(code, /^[A-Z2-9]{6}$/);
const stored = rows.get(code);
assert.notEqual(stored.poll_hash, poll, "only the hash of the secret is stored");
assert.ok(!JSON.stringify([...rows.values()]).includes(poll));

let p = await handleTvPair(req("/v1/tv-pair/poll", { poll }), env, deps);
assert.deepEqual(p.body.pending, true);

const anon = await handleTvPair(req("/v1/tv-pair/approve", { code }), env, deps);
assert.equal(anon.status, 401, "approving needs a signed-in phone");
const wrong = await handleTvPair(req("/v1/tv-pair/approve", { code: "ZZZZZZ" }, "va1.phone"), env, deps);
assert.equal(wrong.status, 404);
const ok = await handleTvPair(req("/v1/tv-pair/approve", { code: code.toLowerCase() }, "va1.phone"), env, deps);
assert.equal(ok.status, 200);
const again = await handleTvPair(req("/v1/tv-pair/approve", { code }, "va1.phone"), env, deps);
assert.equal(again.status, 404, "an approved code cannot be approved twice");

p = await handleTvPair(req("/v1/tv-pair/poll", { poll }), env, deps);
assert.equal(p.status, 200);
assert.equal(p.body.account.id, "acct-1");
assert.ok(p.body.token && p.body.token !== "va1.phone", "the TV gets its own session");
assert.equal(rows.size, 0, "the record is gone after one use");
p = await handleTvPair(req("/v1/tv-pair/poll", { poll }), env, deps);
assert.equal(p.status, 410, "the secret works once");

const s2 = await handleTvPair(req("/v1/tv-pair/start"), env, deps);
assert.equal(TV_PAIR_TTL_MS, 10 * 60 * 1000, "codes last ten minutes");
clock += TV_PAIR_TTL_MS + 1;
const late = await handleTvPair(req("/v1/tv-pair/approve", { code: s2.body.code }, "va1.phone"), env, deps);
assert.equal(late.status, 404, "expired codes cannot be approved");
p = await handleTvPair(req("/v1/tv-pair/poll", { poll: s2.body.poll }), env, deps);
assert.equal(p.status, 410);

const bad = await handleTvPair(req("/v1/tv-pair/poll", { poll: "nope" }), env, deps);
assert.equal(bad.status, 400);

/* Ask an account on another device. Fixture names are neutral. */
const ACCOUNT = "100000000001";
const OTHER = "100000000002";
sessions["va1.asked"] = { public_id: ACCOUNT };
sessions["va1.other"] = { public_id: OTHER };
const notes = [];
const hits = new Map();
const pending = [];
const askDeps = Object.assign({}, deps, {
  rateHit: async (_env, key, n) => { const c = (hits.get(key) || 0) + 1; hits.set(key, c); return { ok: c <= n }; },
  findAccount: async (_env, name) => (name === "sample" ? ACCOUNT : ""),
  notify: async (_env, input) => { notes.push(input); return { created: true }; },
  waitUntil: (job) => pending.push(job)
});
async function settle() { await Promise.all(pending.splice(0)); }
assert.equal(askName("@Sample"), "sample");
assert.equal(askName("bad name!"), "");

let tv = (await handleTvPair(req("/v1/tv-pair/start"), env, askDeps)).body;
const known = await handleTvPair(req("/v1/tv-pair/ask", { poll: tv.poll, username: "@Sample" }), env, askDeps);
await settle();
const unknown = await handleTvPair(req("/v1/tv-pair/ask", { poll: tv.poll, username: "nobody" }), env, askDeps);
await settle();
assert.equal(known.status, 200);
assert.equal(JSON.stringify(known), JSON.stringify(unknown), "the reply never says whether the name exists");
assert.equal(notes.length, 1, "only a real account is notified");
assert.equal(notes[0].publicId, ACCOUNT);
assert.equal(notes[0].kind, "tv_signin");
assert.equal(notes[0].text, tv.code, "the notification shows the TV's code");
assert.equal(notes[0].expiresAt, rows.get(tv.code).expires_at, "the ask expires with the code");
assert.ok(!JSON.stringify(notes[0]).includes(tv.poll), "the TV's secret never leaves the TV");

const third = await handleTvPair(req("/v1/tv-pair/ask", { poll: tv.poll, username: "sample" }), env, askDeps);
await settle();
assert.equal(third.status, 200);
const capped = await handleTvPair(req("/v1/tv-pair/ask", { poll: tv.poll, username: "sample" }), env, askDeps);
assert.equal(TV_ASK_PER_CODE, 3);
assert.equal(capped.status, 429, "a TV gets a few asks per code");

// Approve from the notification finishes the pairing.
const fromNote = await handleTvPair(req("/v1/tv-pair/approve", { code: notes[0].text }, "va1.asked"), env, askDeps);
assert.equal(fromNote.status, 200);
p = await handleTvPair(req("/v1/tv-pair/poll", { poll: tv.poll }), env, askDeps);
assert.equal(p.status, 200);
assert.equal(p.body.account.id, ACCOUNT);

// Deny: only the asked account can, and the TV hears "denied".
tv = (await handleTvPair(req("/v1/tv-pair/start"), env, askDeps)).body;
await handleTvPair(req("/v1/tv-pair/ask", { poll: tv.poll, username: "sample" }), env, askDeps);
await settle();
await handleTvPair(req("/v1/tv-pair/deny", { code: tv.code }, "va1.other"), env, askDeps);
p = await handleTvPair(req("/v1/tv-pair/poll", { poll: tv.poll }), env, askDeps);
assert.equal(p.body.pending, true, "a stranger cannot deny someone else's TV");
const anonDeny = await handleTvPair(req("/v1/tv-pair/deny", { code: tv.code }), env, askDeps);
assert.equal(anonDeny.status, 401);
const denied = await handleTvPair(req("/v1/tv-pair/deny", { code: tv.code }, "va1.asked"), env, askDeps);
assert.equal(denied.status, 200);
p = await handleTvPair(req("/v1/tv-pair/poll", { poll: tv.poll }), env, askDeps);
assert.equal(p.status, 403);
assert.equal(p.body.error, "denied");
assert.ok(!rows.has(tv.code) && !asks.has(tv.code), "a denied code is gone");

// Per-username limit, across TVs.
hits.clear();
for (let i = 0; i < TV_ASK_PER_NAME; i++) {
  const t = (await handleTvPair(req("/v1/tv-pair/start"), env, askDeps)).body;
  const r = await handleTvPair(req("/v1/tv-pair/ask", { poll: t.poll, username: "sample" }), env, askDeps);
  assert.equal(r.status, 200);
}
await settle();
const t4 = (await handleTvPair(req("/v1/tv-pair/start"), env, askDeps)).body;
const over = await handleTvPair(req("/v1/tv-pair/ask", { poll: t4.poll, username: "SAMPLE" }), env, askDeps);
assert.equal(over.status, 429, "one username gets a few asks per window");

// Expired code: no ask.
hits.clear();
const t5 = (await handleTvPair(req("/v1/tv-pair/start"), env, askDeps)).body;
clock += TV_PAIR_TTL_MS + 1;
const lateAsk = await handleTvPair(req("/v1/tv-pair/ask", { poll: t5.poll, username: "sample" }), env, askDeps);
assert.equal(lateAsk.status, 410);
const lateDeny = await handleTvPair(req("/v1/tv-pair/deny", { code: t4.code }, "va1.asked"), env, askDeps);
assert.equal(lateDeny.status, 200);

Date.now = realNow;
console.log("tv pair ok");
