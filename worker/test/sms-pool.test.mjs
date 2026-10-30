import assert from "node:assert/strict";
import test from "node:test";
import { handleOwnerSms, readSms, codeFromText, statusOf, resetSmsMemo } from "../src/sms-pool.js";

// Synthetic numbers and codes only.
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const limited = () => json(429, { error: "rate_limited" });
function deps(owner, extra) {
  return Object.assign({
    json, limited,
    rateHit: async () => ({ ok: true }),
    requireOwnerHidden: async () => owner == null ? { error: json(404, { error: "not_found" }) } : (owner ? { row: { public_id: "000000000001" } } : { error: json(403, { error: "forbidden" }) })
  }, extra || {});
}
const req = (q) => new Request("https://accounts.test/v1/owner/sms" + (q || ""));
const NOW = Date.parse("2026-01-06T18:05:00Z");

function fakeApi(calls, opts) {
  return async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, auth: init.headers.Authorization, body: init.body });
    if (opts && opts.status) return new Response("{}", { status: opts.status });
    if (path === "/request/active") return json(200, [
      { timestamp: "2026-01-06 18:03:15", order_code: "AAAA1111", phonenumber: "15550000001", code: "0", full_code: "", short_name: "US", service: "Example", status: "pending", expiry: Math.floor(NOW / 1000) + 600, time_left: 600 },
      { timestamp: "2026-01-06 18:01:00", order_code: "BBBB2222", phonenumber: "15550000002", code: "123456", full_code: "Your code is 123456", short_name: "US", service: "Other", status: "completed", expiry: Math.floor(NOW / 1000) + 300 }
    ]);
    if (path === "/rental/retrieve") return json(200, [{ rental_code: "RENT0001", phonenumber: "15550000003", expiration_date: Math.floor(NOW / 1000) + 86400, country_name: "US" }]);
    if (path === "/rental/retrieve_messages") return json(200, { success: 1, messages: [{ ID: 1, message: "Your verification code is: 4321", sender: "1234", timestamp: "2026-01-06 18:00:00" }] });
    if (path === "/request/history") return json(200, [{ order_code: "CCCC3333", phonenumber: "15550000004", code: "0", service: "Old", status: "refunded", timestamp: "2026-01-05 10:00:00" }]);
    return json(404, {});
  };
}

test("owner only, and a friendly not-connected answer without the secret", async () => {
  resetSmsMemo();
  assert.equal((await handleOwnerSms(req(), {}, deps(null))).status, 404);
  assert.equal((await handleOwnerSms(req(), {}, deps(false))).status, 403);
  const res = await handleOwnerSms(req(), {}, deps(true));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { connected: false, orders: [], rentals: [] });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await handleOwnerSms(new Request("https://accounts.test/v1/owner/sms", { method: "POST" }), {}, deps(true))).status, 405);
});

test("orders and rentals are normalized; the key is only a bearer header", async () => {
  resetSmsMemo();
  const calls = [];
  const env = { SMSPOOL_API_KEY: "test-key-not-real" };
  const body = await readSms(env, { fetch: fakeApi(calls), now: NOW, history: true });
  assert.equal(body.connected, true);
  assert.deepEqual(body.orders.map((o) => [o.id, o.status, o.code]), [["AAAA1111", "waiting", ""], ["BBBB2222", "received", "123456"], ["CCCC3333", "refunded", ""]]);
  assert.equal(body.rentals.length, 1);
  assert.equal(body.rentals[0].messages[0].code, "4321");
  assert.ok(calls.every((c) => c.auth === "Bearer test-key-not-real" && !String(c.body).includes("test-key-not-real")));
  assert.ok(!JSON.stringify(body).includes("test-key-not-real"));
});

test("a rejected key and an expired wait are reported plainly", async () => {
  resetSmsMemo();
  const bad = await readSms({ SMSPOOL_API_KEY: "x" }, { fetch: fakeApi([], { status: 403 }), now: NOW });
  assert.equal(bad.error, "bad_key");
  const late = await readSms({ SMSPOOL_API_KEY: "x" }, { fetch: fakeApi([]), now: NOW + 3600 * 1000 });
  assert.equal(late.orders.find((o) => o.id === "AAAA1111").status, "expired");
});

test("status words and code extraction", () => {
  assert.equal(statusOf("6"), "refunded");
  assert.equal(statusOf("pending", "0"), "waiting");
  assert.equal(statusOf("", "998877"), "received");
  assert.equal(codeFromText("G-482913 is your Google verification code."), "G-482913");
  assert.equal(codeFromText("Code 123-456. Valid 10 min"), "123-456");
  assert.equal(codeFromText("No digits here"), "");
});

test("members read their own SMSPool account with the key from their device", async () => {
  const { handleMemberSms } = await import("../src/sms-pool.js");
  const calls = [];
  const d = (signed) => deps(true, { fetch: fakeApi(calls), sessionAccount: async () => (signed ? { public_id: "000000000003" } : null), readJson: async (r) => JSON.parse(await r.text()) });
  const post = (body) => new Request("https://accounts.test/v1/inbox/sms", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await handleMemberSms(post({ key: "member-key" }), {}, d(true))).status, 404);
  const on = { INBOX_RELAY: "on" };
  assert.equal((await handleMemberSms(post({ key: "member-key" }), on, d(false))).status, 401);
  assert.equal((await handleMemberSms(post({}), on, d(true))).status, 400);
  const res = await handleMemberSms(post({ key: "member-key" }), on, d(true));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.connected, true);
  assert.ok(body.orders.length >= 2);
  assert.ok(calls.length && calls.every((c) => c.auth === "Bearer member-key"));
});
