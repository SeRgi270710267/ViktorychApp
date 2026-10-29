import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { scoreNotes, ratingImpact, brigadeWeights, effectiveStatus, THRESHOLDS } from "../src/cn-scorer.js";
import { cleanNoteInput, noteLength, shardOf, sourcesOf } from "../src/community-notes.js";

/* ---------- scorer on synthetic data (made-up names only) ---------- */

function camps(size) {
  return {
    left: Array.from({ length: size }, (_, i) => "lefty" + i),
    right: Array.from({ length: size }, (_, i) => "righty" + i)
  };
}
function partisan(R, left, right) {
  for (let k = 0; k < 6; k++) {
    left.forEach((u) => R.push({ rater: u, note: "pl" + k, v: 1 }));
    right.forEach((u) => R.push({ rater: u, note: "pl" + k, v: 0 }));
    left.forEach((u) => R.push({ rater: u, note: "pr" + k, v: 0 }));
    right.forEach((u) => R.push({ rater: u, note: "pr" + k, v: 1 }));
  }
}

test("bridging: helpful across both camps is shown, one-sided waits, bad is not helpful", () => {
  const { left, right } = camps(12);
  const R = [];
  partisan(R, left, right);
  left.concat(right).forEach((u) => R.push({ rater: u, note: "bridge", v: 1 }));
  left.forEach((u) => R.push({ rater: u, note: "oneSided", v: 1 }));
  right.slice(0, 6).forEach((u) => R.push({ rater: u, note: "oneSided", v: 0 }));
  left.concat(right).forEach((u) => R.push({ rater: u, note: "bad", v: 0 }));
  const s = scoreNotes(R);
  assert.equal(s.method, "mf");
  assert.equal(s.notes.bridge.status, "crh");
  assert.ok(s.notes.bridge.intercept >= THRESHOLDS.crhIntercept);
  assert.equal(s.notes.oneSided.status, "nmr");
  assert.ok(Math.abs(s.notes.oneSided.factor) > 0.2, "one-sided note sits on the factor axis");
  assert.equal(s.notes.bad.status, "crnh");
  assert.equal(s.notes.pl0.status, "nmr");
  // Raters in opposite camps get opposite factor signs.
  assert.ok(Math.sign(s.raters.lefty0.factor) !== Math.sign(s.raters.righty0.factor));
});

test("same ratings give the same result every run", () => {
  const { left, right } = camps(10);
  const R = [];
  partisan(R, left, right);
  left.concat(right).forEach((u, i) => R.push({ rater: u, note: "mix", v: i % 3 ? 1 : 0.5 }));
  assert.deepEqual(scoreNotes(R), scoreNotes(R.slice()));
});

test("small data: fallback needs a clear majority from at least three raters", () => {
  const few = [{ rater: "ana", note: "n1", v: 1 }, { rater: "ben", note: "n1", v: 1 }];
  assert.equal(scoreNotes(few).method, "fallback");
  assert.equal(scoreNotes(few).notes.n1.status, "nmr");
  const three = few.concat([{ rater: "cai", note: "n1", v: 1 }]);
  assert.equal(scoreNotes(three).notes.n1.status, "crh");
  const bad = [{ rater: "ana", note: "n2", v: 0 }, { rater: "ben", note: "n2", v: 0 }, { rater: "cai", note: "n2", v: 0.5 }];
  assert.equal(scoreNotes(bad).notes.n2.status, "crnh");
  const split = [{ rater: "ana", note: "n3", v: 1 }, { rater: "ben", note: "n3", v: 0 }, { rater: "cai", note: "n3", v: 1 }];
  assert.equal(scoreNotes(split).notes.n3.status, "nmr");
});

test("rating impact rewards agreeing with the final status", () => {
  const imp = ratingImpact([
    { rater: "ana", note: "a", v: 1 }, { rater: "ana", note: "b", v: 0 },
    { rater: "ben", note: "a", v: 0 }, { rater: "ben", note: "c", v: 1 }
  ], { a: "crh", b: "crnh", c: "nmr" });
  assert.equal(imp.ana, 2);
  assert.equal(imp.ben, -1);
});

test("brigading: a burst of young accounts rating alike is down-weighted", () => {
  const t0 = 1700000000000;
  const young = 2 * 86400000, old = 400 * 86400000;
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ rater: "fresh" + i, note: "n", v: 0, at: t0 + i * 60000, age: young });
  rows.push({ rater: "veteran", note: "n", v: 0, at: t0, age: old });
  rows.push({ rater: "fresh9", note: "other", v: 1, at: t0, age: young });
  const w = brigadeWeights(rows);
  for (let i = 0; i < 6; i++) assert.ok(w[i] <= 0.15);
  assert.equal(w[6], 1);
  assert.equal(w[7], 0.5);
});

test("owner overrides always win over the algorithm", () => {
  assert.equal(effectiveStatus({ algoStatus: "crnh", override: "show" }), "crh");
  assert.equal(effectiveStatus({ algoStatus: "crh", override: "hide" }), "hidden");
  assert.equal(effectiveStatus({ algoStatus: "crh", postBlocked: true }), "hidden");
  assert.equal(effectiveStatus({ algoStatus: "crh", postBlocked: true, override: "show" }), "crh");
  assert.equal(effectiveStatus({ algoStatus: "crh", authorBanned: true }), "hidden");
  assert.equal(effectiveStatus({ algoStatus: "nmr", locked: true, lockedStatus: "crh" }), "crh");
  assert.equal(effectiveStatus({ algoStatus: "crh", locked: true, lockedStatus: "nmr", override: "hide" }), "hidden");
  assert.equal(effectiveStatus({ algoStatus: "crh", deleted: true, override: "show" }), "deleted");
  assert.equal(effectiveStatus({ algoStatus: "crh" }), "crh");
});

test("note input: classification, reasons, a source link and X's length rule", () => {
  const ok = cleanNoteInput({ ref: "x:1234567890", classification: "misleading", reasons: ["missing_context", "nope"], text: "The photo is from 2019. https://example.org/photo-archive/2019/a-very-long-path-that-counts-as-one" });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.reasons, ["missing_context"]);
  assert.equal(ok.sources.length, 1);
  assert.equal(cleanNoteInput({ ref: "x:1", classification: "misleading", reasons: ["other"], text: "No link here" }).error, "source_required");
  assert.equal(cleanNoteInput({ ref: "x:1", classification: "misleading", reasons: [], text: "https://e.org" }).error, "reasons_required");
  assert.equal(cleanNoteInput({ ref: "X 1", classification: "misleading", reasons: ["other"], text: "https://e.org" }).error, "bad_ref");
  assert.equal(cleanNoteInput({ ref: "x:1", classification: "misleading", reasons: ["other"], text: "a".repeat(281) + " https://e.org" }).error, "too_long");
  assert.equal(noteLength("abc https://example.org/long/long/long"), 5);
  assert.deepEqual(sourcesOf("see https://a.example/x)."), ["https://a.example/x"]);
  assert.match(shardOf("x:42"), /^[0-9a-f]$/);
});

/* ---------- Worker routes ---------- */

let mf;
let bindings;
function options(extra) {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      CN_MIN_AGE_DAYS: "30",
      CN_WRITE_IMPACT: "5"
    }, extra || {})
  };
}
async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.70");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}
async function signup(ip, handle) {
  const r = await call("/v1/signup", { method: "POST", ip, body: { displayName: "Cn " + handle, handle } });
  assert.equal(r.status, 201, r.text);
  return r.body;
}
async function age(user, days) {
  await bindings.DB.prepare("UPDATE accounts SET created_at = ? WHERE public_id = ?").bind(Date.now() - days * 86400000, user.account.publicId).run();
}

test.before(async () => {
  mf = new Miniflare(options());
  bindings = await mf.getBindings();
});
test.after(async () => { if (mf) await mf.dispose(); });

test("eligibility, rating-only start, own-note rule and owner final say", async () => {
  const boss = await signup("203.0.113.71", "cn_boss");
  const ana = await signup("203.0.113.72", "cn_ana");
  const ben = await signup("203.0.113.73", "cn_ben");
  await bindings.DB.prepare("UPDATE accounts SET owner = 1 WHERE public_id = ?").bind(boss.account.publicId).run();

  const fresh = await call("/v1/cnotes/me", { token: ana.token });
  assert.equal(fresh.body.eligibility.eligible, false);
  assert.deepEqual(fresh.body.eligibility.reasons, ["too_new"]);
  assert.equal((await call("/v1/cnotes/join", { method: "POST", token: ana.token })).status, 403);

  await age(ana, 60);
  await age(ben, 60);
  const joined = await call("/v1/cnotes/join", { method: "POST", token: ana.token });
  assert.equal(joined.status, 200, joined.text);
  assert.match(joined.body.contributor.alias, /^\w+ \w+ \w+$/);
  assert.ok(joined.body.contributor.alias.indexOf("cn_ana") < 0, "alias is not the handle");
  assert.equal(joined.body.contributor.canWrite, false);
  assert.equal((await call("/v1/cnotes/join", { method: "POST", token: ben.token })).status, 200);

  const note = { ref: "x:1111222233334444", classification: "misleading", reasons: ["missing_context"], text: "Context goes here. https://example.org/source" };
  const locked = await call("/v1/cnotes", { method: "POST", token: ana.token, body: note });
  assert.equal(locked.status, 403);
  assert.equal(locked.body.error, "writing_locked");

  await bindings.DB.prepare("UPDATE cn_contributors SET can_write = 1 WHERE public_id = ?").bind(ana.account.publicId).run();
  const wrote = await call("/v1/cnotes", { method: "POST", token: ana.token, body: note });
  assert.equal(wrote.status, 201, wrote.text);
  const id = wrote.body.id;
  assert.equal((await call("/v1/cnotes", { method: "POST", token: ana.token, body: note })).status, 409);

  const own = await call("/v1/cnotes/rate", { method: "POST", token: ana.token, body: { note: id, level: "helpful" } });
  assert.equal(own.status, 403);
  assert.equal(own.body.error, "own_note");
  const rated = await call("/v1/cnotes/rate", { method: "POST", token: ben.token, body: { note: id, level: "not", tags: ["incorrect", "clear"] } });
  assert.equal(rated.status, 200, rated.text);

  const pend = await call("/v1/cnotes/pending?refs=x:1111222233334444", { token: ben.token });
  assert.equal(pend.body.r["x:1111222233334444"].notes[0].rating.level, "not");
  assert.deepEqual(pend.body.r["x:1111222233334444"].notes[0].rating.tags, ["incorrect"]);
  assert.equal(JSON.stringify(pend.body).indexOf(ana.account.publicId), -1, "no account ids leak");

  assert.equal((await call("/v1/cnotes/admin", { token: ana.token })).status, 403);
  const shown = await call("/v1/cnotes/admin", { method: "POST", token: boss.token, body: { action: "show", note: id } });
  assert.equal(shown.status, 200, shown.text);
  assert.equal(shown.body.status, "crh");
  const shard = await call("/v1/cnotes/shard/" + shardOf("x:1111222233334444"));
  assert.equal(shard.status, 200, shard.text);
  const entry = shard.body.r["x:1111222233334444"];
  assert.equal(entry.length, 1);
  const blob = await call("/v1/cnotes/n/" + entry[0][0]);
  assert.equal(blob.body.text, note.text);
  assert.equal(JSON.stringify(blob.body).indexOf(ana.account.publicId), -1);

  // A rescore cannot undo the owner's choice.
  await call("/v1/cnotes/admin/rescore", { method: "POST", token: boss.token });
  const after = await call("/v1/cnotes/admin?status=crh", { token: boss.token });
  assert.equal(after.body.items[0].id, id);

  await call("/v1/cnotes/admin", { method: "POST", token: boss.token, body: { action: "nonotes", ref: "x:1111222233334444" } });
  const stillShown = await call("/v1/cnotes/shard/" + shardOf("x:1111222233334444"));
  assert.equal(stillShown.body.r["x:1111222233334444"].length, 1, "a forced show beats no-notes");
  await call("/v1/cnotes/admin", { method: "POST", token: boss.token, body: { action: "clear", note: id } });
  const gone = await call("/v1/cnotes/shard/" + shardOf("x:1111222233334444"));
  assert.equal(gone.body.r["x:1111222233334444"], undefined);
  assert.equal((await call("/v1/cnotes", { method: "POST", token: ben.token, body: note })).status, 403);

  const log = await call("/v1/cnotes/admin/audit", { token: boss.token });
  assert.deepEqual(log.body.items.map((r) => r.action).slice(0, 3), ["clear", "nonotes", "rescore"]);
});

test("mirrored X notes merge into the shards and obey the owner", async () => {
  const boss = await signup("203.0.113.81", "cn_chief");
  await bindings.DB.prepare("UPDATE accounts SET owner = 0").run();
  await bindings.DB.prepare("UPDATE accounts SET owner = 1 WHERE public_id = ?").bind(boss.account.publicId).run();
  const ref = "x:9999888877776666";
  const s = shardOf(ref);
  await bindings.DATA.put("cnotes/x/" + s + ".json", JSON.stringify({ v: 1, notes: [{ id: "5550001", ref, cls: "misleading", reasons: ["missing_context"], text: "Mirrored context https://example.net/a", sources: ["https://example.net/a"], created: 1, statusAt: 2 }] }));
  await bindings.DATA.put("cnotes/x/manifest.json", JSON.stringify({ hash: "h1", count: 1 }));
  await call("/v1/cnotes/admin/rescore", { method: "POST", token: boss.token });
  let shard = await call("/v1/cnotes/shard/" + s);
  assert.equal(shard.body.r[ref][0][2], "x");
  await call("/v1/cnotes/admin", { method: "POST", token: boss.token, body: { action: "xhide", xnote: "5550001" } });
  shard = await call("/v1/cnotes/shard/" + s);
  assert.equal(shard.body.r[ref], undefined);
});
