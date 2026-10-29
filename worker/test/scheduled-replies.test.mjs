import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

let mf;

function workerOptions() {
  return {
    modules: true,
    unsafeTriggerHandlers: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "user_owner",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.110");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.json) headers.set("content-type", "application/json");
  if (opts.multipart) headers.set("content-type", opts.multipart.type);
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.multipart ? opts.multipart.body : (opts.json ? JSON.stringify(opts.json) : undefined)
  });
  if (opts.raw) return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body };
}

async function signup(handle, ip) {
  const created = await call("/v1/signup", {
    method: "POST",
    ip,
    json: { displayName: "User " + handle.slice(-1).toUpperCase(), handle }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});
const IP = { a: "203.0.113.171", b: "203.0.113.172", c: "203.0.113.173" };

async function notes(token, ip) {
  const got = await call("/v1/notifications", { ip, token });
  assert.equal(got.status, 200, JSON.stringify(got.body));
  return got.body.items || [];
}

test("a scheduled reply notifies the parent author when it goes out", async () => {
  const a = await signup("user_a", IP.a);
  const b = await signup("member_test", IP.b);
  const parent = await call("/v1/posts", { method: "POST", ip: IP.b, token: b.token, json: { body: "hello from b" } });
  assert.equal(parent.status, 201, JSON.stringify(parent.body));
  const later = Date.now() + 60 * 1000;
  const reply = await call("/v1/posts", { method: "POST", ip: IP.a, token: a.token, json: { body: "a replies later @member_test", parentId: parent.body.post.id, scheduledAt: later } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.scheduled, true);
  assert.equal((await notes(b.token, IP.b)).some((item) => item.kind === "reply"), false, "quiet until it goes out");

  for (let i = 0; i < 2; i++) {
    const cron = await mf.dispatchFetch("https://accounts.test/cdn-cgi/handler/scheduled?cron=" + encodeURIComponent("* * * * *") + "&time=" + (later + 60 * 1000 + i));
    assert.equal(cron.status, 200, await cron.text());
  }
  const replies = (await notes(b.token, IP.b)).filter((item) => item.kind === "reply");
  assert.equal(replies.length, 1, "one reply note, even after two cron runs");
  const thread = await call("/v1/posts/thread?id=" + encodeURIComponent(parent.body.post.id), { ip: IP.b, token: b.token });
  assert.ok(thread.body.replies.some((item) => item.id === reply.body.post.id), "the reply is in the thread");
});
