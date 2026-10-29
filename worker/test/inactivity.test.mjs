import assert from "node:assert/strict";
import test from "node:test";
import { cleanMonths, inactiveDue, inactivityArmed, sweepInactive, INACTIVITY_MONTHS } from "../src/account-delete.js";

const DAY = 24 * 60 * 60 * 1000;

test("inactivity choices are 1, 3, 6 or 12 months", () => {
  assert.deepEqual(INACTIVITY_MONTHS, [1, 3, 6, 12]);
  assert.equal(cleanMonths("3"), 3);
  assert.equal(cleanMonths(2), 0);
  assert.equal(cleanMonths("x"), 0);
});

test("an account is due only after its chosen months, counted from the later of activity and arming", () => {
  const now = 400 * DAY;
  assert.equal(inactiveDue(now - 20 * DAY, 0, 1, now), false);
  assert.equal(inactiveDue(now - 40 * DAY, 0, 1, now), true);
  assert.equal(inactiveDue(now - 40 * DAY, 0, 3, now), false);
  assert.equal(inactiveDue(now - 200 * DAY, now - 10 * DAY, 1, now), false, "the clock never starts before arming");
  assert.equal(inactiveDue(0, 0, 1, now), false);
});

function fakeDb() {
  const calls = [];
  const stmt = (sql) => ({ sql, bind() { return this; }, first: async () => { calls.push(sql); return null; }, run: async () => { calls.push(sql); return {}; }, all: async () => { calls.push(sql); return { results: [] }; } });
  return { calls, prepare: stmt, batch: async (list) => { list.forEach((s) => calls.push(s.sql)); return []; } };
}

test("the sweep does nothing unless INACTIVITY_DELETE is on", async () => {
  const db = fakeDb();
  assert.equal(inactivityArmed({}), false);
  assert.deepEqual(await sweepInactive({ DB: db }, Date.now()), { armed: false, started: 0 });
  assert.equal(db.calls.length, 0);
});

test("the first armed sweep only records the arming time and deletes nobody", async () => {
  const db = fakeDb();
  const out = await sweepInactive({ DB: db, INACTIVITY_DELETE: "on" }, Date.now());
  assert.deepEqual(out, { armed: true, started: 0 });
  assert.ok(db.calls.some((sql) => /INSERT OR IGNORE INTO inactivity_meta/.test(sql)));
  assert.ok(!db.calls.some((sql) => /FROM accounts/.test(sql)));
});
