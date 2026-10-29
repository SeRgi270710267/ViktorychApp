import test from "node:test";
import assert from "node:assert/strict";
import { warmDue, warmRender, RENDER_BACKUP } from "../src/render-warm.js";

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
