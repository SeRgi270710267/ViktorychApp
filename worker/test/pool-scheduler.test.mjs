import assert from "node:assert/strict";
import test from "node:test";
import * as Q from "../../shared/pool-scheduler.js";
import { keyId } from "../../shared/peer-pool.js";

test("sources are ranked by measured speed and failures", () => {
  const scores = new Map();
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    Q.recordSource(scores, "peer:a", { ms: 40, bytes: 65536, ok: true }, now);
    Q.recordSource(scores, "peer:b", { ms: 900, bytes: 65536, ok: true }, now);
    Q.recordSource(scores, "origin", { ms: 300, bytes: 0, ok: false }, now);
  }
  assert.deepEqual(Q.rankSources(scores, ["origin", "peer:b", "peer:a"], now), ["peer:a", "peer:b", "origin"]);
  // An hour later the measurements have faded back to the priors.
  const later = now + 60 * 60 * 1000;
  assert.equal(Q.sourceScore(scores, "peer:a", later), Q.sourceScore(new Map(), "peer:a", later));
});

test("raceTop runs the best two, takes the first good answer and cancels the other", async () => {
  const aborted = [];
  const task = (name, ms, value) => ({ name, run: (signal) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(value), ms);
    signal.addEventListener && signal.addEventListener("abort", () => { clearTimeout(t); aborted.push(name); resolve(null); });
  }) });
  let started = 0;
  const third = { name: "c", run: () => { started += 1; return "c"; } };
  const won = await Q.raceTop([task("a", 50, "a"), task("b", 5, "b"), third]);
  assert.deepEqual(won, { name: "b", value: "b" });
  assert.ok(aborted.includes("a"));
  assert.equal(started, 0, "the third source is not started when one of the two answers");
  const fallback = await Q.raceTop([task("a", 5, null), task("b", 5, null), third]);
  assert.deepEqual(fallback, { name: "c", value: "c" });
});

test("the queue runs what is on screen first and drops background work when the budget says so", async () => {
  const order = [];
  let prefetch = true;
  const q = Q.createQueue(1, () => ({ prefetch }));
  const job = (name) => () => new Promise((r) => setTimeout(() => { order.push(name); r(name); }, 5));
  const all = [q.run("background", job("bg")), q.run("likely", job("likely")), q.run("visible", job("vis1")), q.run("next", job("next")), q.run("visible", job("vis2"))];
  await Promise.all(all);
  assert.deepEqual(order, ["bg", "vis1", "vis2", "next", "likely"], "first job was already running; the rest go by priority");
  prefetch = false;
  assert.equal(await q.run("background", job("bg2")), null);
  assert.equal(await q.run("visible", job("vis3")), "vis3");
});

test("device conditions set how much this device seeds", () => {
  const wifi = { unmetered: true, desktop: false, charging: true };
  assert.equal(Q.deviceBudget(wifi, {}).seed, 3);
  assert.equal(Q.deviceBudget(wifi, {}).uploadCap, 40 * Q.MB);
  assert.equal(Q.deviceBudget({ unmetered: true, charging: false }, { battery: 0.6 }).seed, 2);
  assert.equal(Q.deviceBudget({ unmetered: true, charging: false }, { battery: 0.2 }).seed, 1);
  assert.equal(Q.deviceBudget({ unmetered: true, charging: false }, { battery: 0.1 }).seed, 0);
  assert.equal(Q.deviceBudget(wifi, { hidden: true }).seed, 1);
  assert.equal(Q.deviceBudget(wifi, { hidden: true }).prefetch, false);
  assert.equal(Q.deviceBudget({ cellular: true, metered: true }, {}).seed, 0);
  assert.equal(Q.deviceBudget({ cellular: true, metered: true }, { rescue: true }).maxPeers, 2, "rescue still downloads");
  assert.equal(Q.deviceBudget({ saveData: true, unmetered: true }, {}).prefetch, false);
  assert.equal(Q.deviceBudget({ unmetered: true, desktop: true }, { effectiveType: "3g" }).seed, 1);
});

test("eviction keeps what peers ask for, and the store is sized from the quota", () => {
  const now = Date.now();
  const entries = [
    { h: "old-popular", size: 4, last: now - 20 * 60000, asks: 30 },
    { h: "new-unasked", size: 4, last: now - 1 * 60000, asks: 0 },
    { h: "old-unasked", size: 4, last: now - 20 * 60000, asks: 0 }
  ];
  assert.deepEqual(Q.evictList(entries, 12, 4, 12, now), ["old-unasked"]);
  assert.deepEqual(Q.evictList(entries, 12, 8, 12, now), ["old-unasked", "new-unasked"]);
  assert.equal(Q.storeCap(null), 16 * Q.MB);
  assert.equal(Q.storeCap({ quota: 100 * Q.MB, usage: 90 * Q.MB }), 4 * Q.MB);
  assert.equal(Q.storeCap({ quota: 100000 * Q.MB, usage: 0 }), 32 * Q.MB);
});

test("seeding goes rarest first, dedupes, and never repeats a chunk to a peer", async () => {
  const haves = new Map([["p1", new Set(["a", "b"])], ["p2", new Set(["a"])]]);
  const items = [{ h: "a" }, { h: "b" }, { h: "c" }, { h: "a" }];
  assert.deepEqual(Q.rarestFirst(items, haves).map((i) => i.h), ["c", "b", "a"]);
  const sent = new Set();
  assert.equal(Q.firstSend(sent, "a", 0), true);
  assert.equal(Q.firstSend(sent, "a", 65536), true);
  assert.equal(Q.firstSend(sent, "a", 0), false);
  // Manifest keys travel as content ids, not names.
  const kid = await keyId("feeds.json");
  assert.match(kid, /^[a-f0-9]{32}$/);
  assert.ok(!kid.includes("feeds"));
});
