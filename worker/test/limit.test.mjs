import assert from "node:assert/strict";
import test from "node:test";
import { eachLimit } from "../src/limit.js";

test("eachLimit runs every item with a bounded number in flight", async () => {
  let live = 0;
  let peak = 0;
  const done = [];
  await eachLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
    live += 1;
    peak = Math.max(peak, live);
    try {
      await new Promise((r) => setTimeout(r, 5));
      if (n === 3) throw new Error("one item fails");
      done.push(n);
    } finally { live -= 1; }
  });
  assert.equal(peak, 4, "four at a time, not one after another");
  assert.deepEqual(done.sort(), [1, 2, 4, 5, 6, 7, 8, 9], "a failure does not stop the rest");
  await eachLimit([], 4, async () => { throw new Error("never"); });
});
