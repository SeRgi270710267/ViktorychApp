import assert from "node:assert/strict";
import test from "node:test";
import { usageReport, renderHoursCeiling, FREE_LIMITS } from "../src/usage.js";

test("usage without an analytics token still answers with the limits", async () => {
  const out = await usageReport({}, Date.UTC(2026, 9, 3, 12));
  assert.equal(out.configured, false);
  assert.equal(out.limits.workerRequestsDay, FREE_LIMITS.workerRequestsDay);
  assert.equal(out.renderHoursCeiling, 60);
  assert.equal(renderHoursCeiling(Date.UTC(2026, 9, 1, 0)), 0);
});
