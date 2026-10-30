import test from "node:test";
import assert from "node:assert/strict";
import { warmDue, warmRender, renderHours, renderHoursReport, RENDER_BACKUP } from "../src/render-warm.js";

const at = (iso) => Date.parse(iso);

test("pings every ten minutes outside the quiet hours", () => {
  assert.equal(warmDue({}, at("2026-10-29T10:05:00Z")), true);
  assert.equal(warmDue({}, at("2026-10-29T10:15:00Z")), true);
  assert.equal(warmDue({}, at("2026-10-29T10:06:00Z")), false);
  assert.equal(warmDue({}, at("2026-10-29T21:05:00Z")), false, "quiet hour");
  assert.equal(warmDue({}, at("2026-10-29T00:55:00Z")), false, "quiet hour");
  assert.equal(warmDue({}, at("2026-10-29T01:05:00Z")), true);
});

test("stays inside Render's 750 free hours a month", () => {
  let awake = 0;
  for (let h = 0; h < 24; h++) if (warmDue({}, Date.UTC(2026, 9, 1, h, 5))) awake += 1;
  assert.ok(awake * 31 <= 650, awake * 31 + " hours");
});

test("can be turned off or retimed by env", () => {
  assert.equal(warmDue({ RENDER_WARM: "0" }, at("2026-10-29T10:05:00Z")), false);
  assert.equal(warmDue({ RENDER_WARM_QUIET_UTC: "10" }, at("2026-10-29T10:05:00Z")), false);
  assert.equal(warmDue({ RENDER_WARM_QUIET_UTC: "none" }, at("2026-10-29T22:05:00Z")), true);
});

test("hits the cheap health path and never throws", async () => {
  const seen = [];
  const ok = await warmRender({}, at("2026-10-29T10:05:00Z"), { fetch: async (url) => { seen.push(url); return new Response("{}"); } });
  assert.equal(ok.ok, true);
  assert.equal(seen[0], RENDER_BACKUP + "/backup/health");
  const custom = await warmRender({ BACKUP_HEALTH_URL: "https://b.example/v1/health" }, at("2026-10-29T10:05:00Z"), { fetch: async (url) => { seen.push(url); return new Response("", { status: 502 }); } });
  assert.equal(custom.ok, false);
  assert.equal(seen[1], "https://b.example/backup/health");
  const down = await warmRender({}, at("2026-10-29T10:05:00Z"), { fetch: async () => { throw new Error("offline"); } });
  assert.equal(down.ok, false);
  const quiet = await warmRender({}, at("2026-10-29T22:05:00Z"), { fetch: async () => { throw new Error("must not run"); } });
  assert.equal(quiet.skipped, true);
});

function hoursBucket(ms) {
  return { async get() { return ms == null ? null : { async json() { return { ms, at: 1 }; } }; } };
}

test("render hours report counts against the free 750 and resets on the 1st", () => {
  const at = Date.UTC(2026, 9, 29, 22);
  const h = renderHoursReport(at, 100 * 36e5, {});
  assert.equal(h.used, 100);
  assert.equal(h.left, 650);
  assert.equal(h.pct, 13);
  assert.equal(h.paused, false);
  assert.equal(h.resetAt, "2026-11-01T00:00:00.000Z");
  assert.equal(renderHoursReport(Date.UTC(2026, 11, 31), 0, {}).resetAt, "2027-01-01T00:00:00.000Z");
  assert.equal(renderHoursReport(at, 676 * 36e5, {}).paused, true);
});

test("the warm ping stops once the month's free hours are nearly gone", async () => {
  const at = Date.UTC(2026, 9, 29, 12, 5);
  let calls = 0;
  const deps = { fetch: async () => { calls += 1; return new Response("{}", { status: 200 }); } };
  const rested = await warmRender({ DATA: hoursBucket(700 * 36e5) }, at, deps);
  assert.equal(rested.paused, true);
  assert.equal(calls, 0);
  const warm = await warmRender({ DATA: hoursBucket(100 * 36e5) }, at, deps);
  assert.equal(warm.ok, true);
  assert.equal(calls, 1);
  assert.equal(await renderHours({ DATA: hoursBucket(null) }, at), null);
});
