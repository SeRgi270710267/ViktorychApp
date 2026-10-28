import assert from "node:assert/strict";
import test from "node:test";
import { claimJobs, claimedJobs, FRESH_MS, OFFLOAD_JOBS, poolWidth } from "../src/job-runner.js";
import { CATALOG_KEY } from "../src/owner-feeds.js";

// A D1 stand-in: keeps the job_runner row and answers every other query empty.
function fakeEnv(extra) {
  const rows = new Map();
  const reads = [];
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/FROM job_runner/.test(sql)) return rows.get(args[0]) || null;
      return null;
    },
    async all() { return { results: [] }; },
    async run() {
      if (/INSERT INTO job_runner/.test(sql)) rows.set(args[0], { jobs: args[1], seen_at: args[2] });
      return { meta: { changes: 0 } };
    }
  });
  const DB = { prepare: (sql) => stmt(sql, []), batch: async () => [], exec: async () => ({}) };
  const DATA = {
    async get(key) { reads.push(key); return null; },
    async head(key) { reads.push(key); return null; },
    async put() { return {}; },
    async delete() {},
    async list() { return { objects: [], truncated: false }; }
  };
  return { env: { DB, DATA, ACCOUNT_PEPPER: "pepper-test", ...(extra || {}) }, rows, reads };
}

test("a fresh Render claim names its jobs; a stale one names none", async () => {
  const { env } = fakeEnv();
  const at = 1_800_000_000_000;
  assert.equal((await claimedJobs(env, at)).size, 0);
  await claimJobs(env, at);
  assert.deepEqual([...(await claimedJobs(env, at + 60000))].sort(), [...OFFLOAD_JOBS].sort());
  assert.equal((await claimedJobs(env, at + FRESH_MS + 1)).size, 0, "Render asleep: the Worker runs everything");
  await claimJobs(env, at, ["ownerFeeds", "drainOutbox"]);
  assert.deepEqual([...(await claimedJobs(env, at))], ["ownerFeeds"], "only known offload jobs can be claimed");
});

test("a broken table never makes the Worker skip work", async () => {
  const env = { DB: { prepare() { throw new Error("no such table"); } } };
  assert.equal((await claimedJobs(env, Date.now())).size, 0);
});

test("Render itself never skips, and runs wider pools", async () => {
  const { env } = fakeEnv({ JOB_RUNNER: "render" });
  await claimJobs(env, Date.now());
  assert.equal((await claimedJobs(env, Date.now())).size, 0);
  assert.equal(poolWidth(env, 4), 8);
  assert.equal(poolWidth({}, 4), 4);
});

test("the Worker cron leaves claimed jobs to Render and takes them back when it sleeps", async () => {
  const worker = await import("../src/index.js");
  const at = Date.UTC(2026, 9, 28, 12, 7);
  const wait = [];
  const ctx = { waitUntil: (p) => wait.push(p) };

  const claimed = fakeEnv();
  await claimJobs(claimed.env, at - 30000);
  await worker.default.scheduled({ scheduledTime: at }, claimed.env, ctx);
  await Promise.allSettled(wait.splice(0));
  assert.ok(!claimed.reads.includes(CATALOG_KEY), "feed ingest skipped on the Worker");

  const stale = fakeEnv();
  await claimJobs(stale.env, at - FRESH_MS - 1000);
  await worker.default.scheduled({ scheduledTime: at }, stale.env, ctx);
  await Promise.allSettled(wait.splice(0));
  assert.ok(stale.reads.includes(CATALOG_KEY), "feed ingest back on the Worker");

  const render = fakeEnv({ JOB_RUNNER: "render" });
  const result = await worker.runBackgroundJobs(render.env, at);
  assert.ok(result.ran.includes("ownerFeeds") && result.ran.includes("storiesSweep"));
  assert.ok(render.reads.includes(CATALOG_KEY), "Render ingests feeds");
});
