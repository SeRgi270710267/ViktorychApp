import assert from "node:assert/strict";
import test from "node:test";
import { guardClass, guardKey, takeToken, resetGuard, GUARD_LIMITS, buildPulse, publishPulse, PULSE_OBJECT } from "../src/guard.js";

test("the request guard lets a burst through, then answers with a wait", () => {
  resetGuard();
  const limit = GUARD_LIMITS.api;
  const t0 = 1000000;
  for (let i = 0; i < limit.burst; i++) assert.equal(takeToken("t:a", "api", t0).ok, true);
  const over = takeToken("t:a", "api", t0);
  assert.equal(over.ok, false);
  assert.ok(over.retry >= 1);
  assert.equal(takeToken("t:b", "api", t0).ok, true, "another client has its own bucket");
  assert.equal(takeToken("t:a", "api", t0 + 1000).ok, true, "the bucket refills over time");
});

test("the guard skips preflights, the live socket, and federation", () => {
  assert.equal(guardClass("OPTIONS", "/v1/friends"), "");
  assert.equal(guardClass("GET", "/v1/channel"), "");
  assert.equal(guardClass("GET", "/ap/users/x"), "");
  assert.equal(guardClass("GET", "/tg/social/x/1/photo/0"), "media");
  assert.equal(guardClass("GET", "/v1/friends"), "api");
  const req = new Request("https://w.test/v1/x", { headers: { Authorization: "Bearer abc", "CF-Connecting-IP": "203.0.113.1" } });
  assert.equal(guardKey(req), "t:abc");
  assert.equal(guardKey(new Request("https://w.test/", { headers: { "CF-Connecting-IP": "203.0.113.1" } })), "ip:203.0.113.1");
});

function fakeBucket(objects) {
  const puts = [];
  return {
    puts,
    async head(key) { return objects[key] ? { etag: objects[key] } : null; },
    async get(key) { return objects[key] ? { text: async () => objects[key] } : null; },
    async put(key, text) { puts.push(key); objects[key] = text; }
  };
}

test("the pulse writes only when a mark moves", async () => {
  const data = fakeBucket({ "feeds.json": "e1", "stories.json": "s1" });
  const pulse = fakeBucket({});
  const env = { DATA: data, PULSE: pulse };
  const doc = await buildPulse(env);
  assert.equal(doc.docs["feeds.json"], "e1");
  assert.equal(await publishPulse(env, 1), true);
  assert.equal(await publishPulse(env, 2), false, "nothing changed, nothing written");
  data.head = async (key) => ({ etag: key === "feeds.json" ? "e2" : "s1" });
  assert.equal(await publishPulse(env, 3), true);
  assert.equal(pulse.puts.filter((k) => k === PULSE_OBJECT).length, 2);
  const body = JSON.parse(await (await pulse.get(PULSE_OBJECT)).text());
  assert.equal(body.docs["feeds.json"], "e2");
});
