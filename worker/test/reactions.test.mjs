import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { validEmoji, summarize } from "../src/reactions.js";

let mf;

function workerOptions() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}

async function signup(ip, handle, name) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    body: { displayName: name, handle }
  });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});
test("only one real emoji passes", () => {
  ["😀", "❤️", "👍🏽", "👨‍👩‍👧", "🇵🇱", "1️⃣", "🏳️‍🌈", "🫠"].forEach((e) => assert.equal(validEmoji(e), true, e));
  ["", "a", "😀😀", ":)", "❤", "😀a", " 😀", "1", "<b>", "\u200D", "👍🏽👍"].forEach((e) => assert.equal(validEmoji(e), false, JSON.stringify(e)));
  assert.equal(validEmoji(null), false);
});

test("summary keeps the top three and the viewer's pick", () => {
  const key = "a".repeat(32);
  const got = summarize([key], [
    { post_key: key, emoji: "😂", n: 2 }, { post_key: key, emoji: "❤️", n: 5 },
    { post_key: key, emoji: "😮", n: 1 }, { post_key: key, emoji: "😢", n: 3 }
  ], [{ post_key: key, emoji: "😮" }]);
  assert.equal(got[key].t, 11);
  assert.deepEqual(got[key].top.map((row) => row[0]), ["❤️", "😢", "😂"]);
  assert.equal(got[key].me, "😮");
});

test("react, change, list who reacted and remove", async () => {
  const ana = await signup("203.0.113.151", "rx_ana", "Ana Rx");
  const bo = await signup("203.0.113.152", "rx_bo", "Bo Rx");
  const key = "0123456789abcdef0123456789abcdef";
  const other = "f".repeat(32);

  const anon = await call("/v1/reactions", { method: "PUT", body: { key, emoji: "😂" } });
  assert.equal(anon.status, 401);
  const bad = await call("/v1/reactions", { method: "PUT", token: ana.token, ip: "203.0.113.151", body: { key, emoji: "😂😂" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "bad_emoji");
  const badKey = await call("/v1/reactions", { method: "PUT", token: ana.token, ip: "203.0.113.151", body: { key: "x:123", emoji: "😂" } });
  assert.equal(badKey.status, 400);

  const one = await call("/v1/reactions", { method: "PUT", token: ana.token, ip: "203.0.113.151", body: { key, emoji: "😂" } });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.body.summary.t, 1);
  assert.equal(one.body.summary.me, "😂");
  await call("/v1/reactions", { method: "PUT", token: bo.token, ip: "203.0.113.152", body: { key, emoji: "👍🏽" } });
  const changed = await call("/v1/reactions", { method: "PUT", token: ana.token, ip: "203.0.113.151", body: { key, emoji: "👍🏽" } });
  assert.equal(changed.body.summary.t, 2, "one reaction per account");
  assert.deepEqual(changed.body.summary.top, [["👍🏽", 2]]);

  const batch = await call("/v1/reactions/batch", { method: "POST", token: bo.token, ip: "203.0.113.152", body: { keys: [key, other, "nope"] } });
  assert.equal(batch.status, 200);
  assert.equal(batch.body.r[key].t, 2);
  assert.equal(batch.body.r[key].me, "👍🏽");
  assert.equal(batch.body.r[other].t, 0);
  assert.equal(batch.body.r.nope, undefined);
  const guest = await call("/v1/reactions/batch", { method: "POST", ip: "203.0.113.153", body: { keys: [key] } });
  assert.equal(guest.status, 200);
  assert.equal(guest.body.r[key].me, "");

  const who = await call("/v1/reactions/who?key=" + key, { token: ana.token, ip: "203.0.113.151" });
  assert.equal(who.status, 200);
  assert.equal(who.body.total, 2);
  assert.deepEqual(who.body.tabs, [["👍🏽", 2]]);
  assert.equal(who.body.people.length, 2);
  assert.ok(who.body.people.some((p) => p.me && p.handle === "rx_ana"));
  const lite = await call("/v1/reactions/who?lite=1&key=" + key, { token: ana.token, ip: "203.0.113.151" });
  assert.ok(lite.body.people.every((p) => p.avatar === ""));

  const gone = await call("/v1/reactions", { method: "DELETE", token: ana.token, ip: "203.0.113.151", body: { key } });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.summary.t, 1);
  assert.equal(gone.body.summary.me, "");
});

test("reactions are rate limited", async () => {
  const cy = await signup("203.0.113.154", "rx_cy", "Cy Rx");
  let last = null;
  for (let i = 0; i < 62; i++) {
    last = await call("/v1/reactions", { method: "PUT", token: cy.token, ip: "203.0.113.154", body: { key: "c".repeat(32), emoji: i % 2 ? "😂" : "😮" } });
    if (last.status === 429) break;
  }
  assert.equal(last.status, 429);
});
