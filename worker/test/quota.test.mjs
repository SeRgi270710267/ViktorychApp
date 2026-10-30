import assert from "node:assert/strict";
import test from "node:test";
import { quotaFrom, quotaPct, refreshQuota, resetQuota } from "../src/quota.js";

test("the quota percent is Worker requests against the free 100k a day", () => {
  assert.equal(quotaFrom({ w: [{ sum: { requests: 60000 } }, { sum: { requests: 34000 } }] }), 94);
  assert.equal(quotaFrom({ w: [] }), 0);
});

test("the quota is read in the background at most every three minutes", async () => {
  resetQuota();
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ data: { viewer: { accounts: [{ w: [{ sum: { requests: 81000 } }], d1: [] }] } } }) }; };
  const env = { CF_ANALYTICS_TOKEN: "x", CF_ACCOUNT_ID: "a" };
  const waits = [];
  const t0 = Date.UTC(2026, 9, 29, 21, 0);
  assert.equal(quotaPct(t0), -1, "unknown until the first read");
  await refreshQuota(env, { waitUntil: (p) => waits.push(p) }, t0, fetcher);
  assert.equal(waits.length, 1);
  assert.equal(quotaPct(t0), 81);
  assert.equal(refreshQuota(env, null, t0 + 60000, fetcher), null, "no second read within three minutes");
  assert.equal(calls, 1);
  assert.equal(quotaPct(t0 + 4 * 3600000), 0, "a new UTC day starts at zero");
  assert.equal(refreshQuota({}, null, t0 + 10 * 60000, fetcher), null, "no token, no read");
});
