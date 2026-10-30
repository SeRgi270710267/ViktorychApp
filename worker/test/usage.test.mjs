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

test("usage carries the backup's own count of Render's free hours", async () => {
  const DATA = { async get(key) { return key === "ops/render-hours/2026-10.json" ? { async json() { return { ms: 120 * 36e5, at: 1 }; } } : null; } };
  const out = await usageReport({ DATA }, Date.UTC(2026, 9, 29, 23, 59));
  assert.equal(out.renderHours.used, 120);
  assert.equal(out.renderHours.free, 750);
  assert.equal(out.renderHours.paused, false);
});
