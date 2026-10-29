import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const dispatches = [];
const hosts = [];

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
      OWNER_HANDLE: "owner_test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    async outboundService(request) {
      const url = new URL(request.url);
      hosts.push(url.hostname);
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        return new Response(null, { status: 204 });
      }
      return new Response("no", { status: 404 });
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

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

async function signup(n, displayName, handle) {
  const res = await call("/v1/signup", { method: "POST", ip: "203.0.113." + n, body: { displayName, handle } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}


test("my devices: hello, list, rename, and remove signs that device out", async () => {
  const me = await signup(81, "Device User", "device_user");
  const login = await call("/v1/login", { method: "POST", ip: "203.0.113.82", body: { accountNumber: me.accountNumber } });
  assert.equal(login.status, 200);
  const phone = me.token;
  const laptop = login.body.token;
  const other = await signup(83, "Other User", "other_user");

  assert.equal((await call("/v1/devices")).status, 401);
  let hello = await call("/v1/devices/hello", { method: "POST", token: phone, body: { name: "iPhone · Safari", type: "phone" } });
  assert.equal(hello.status, 200);
  hello = await call("/v1/devices/hello", { method: "POST", token: laptop, body: { name: "Mac <b>Chrome</b>", type: "spaceship" } });
  assert.equal(hello.status, 200);

  let listed = await call("/v1/devices", { token: phone });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.devices.length, 2, "both sessions of the account show up on their own");
  const mine = listed.body.devices.find((d) => d.current);
  const lap = listed.body.devices.find((d) => !d.current);
  assert.equal(mine.name, "iPhone · Safari");
  assert.equal(mine.type, "phone");
  assert.equal(lap.name, "Mac bChrome/b", "markup is stripped");
  assert.equal(lap.type, "other");
  assert.ok(lap.lastSeen > 0);
  assert.match(lap.id, /^[a-f0-9]{16}$/);

  const otherList = await call("/v1/devices", { token: other.token });
  assert.equal(otherList.body.devices.length, 1, "another account sees only its own device");
  const foreign = await call("/v1/devices/remove", { method: "POST", token: other.token, body: { id: lap.id } });
  assert.equal(foreign.status, 404, "cannot remove someone else's device");

  const renamed = await call("/v1/devices/rename", { method: "POST", token: phone, body: { id: lap.id, name: "Work laptop" } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.devices.find((d) => d.id === lap.id).name, "Work laptop");
  await call("/v1/devices/hello", { method: "POST", token: laptop, body: { name: "Mac Chrome", type: "desktop" } });
  listed = await call("/v1/devices", { token: phone });
  assert.equal(listed.body.devices.find((d) => d.id === lap.id).name, "Work laptop", "a rename sticks after hello");
  assert.equal(listed.body.devices.find((d) => d.id === lap.id).type, "desktop");

  const removed = await call("/v1/devices/remove", { method: "POST", token: phone, body: { id: lap.id } });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.devices.length, 1);
  assert.equal((await call("/v1/session", { token: laptop })).status, 401, "the removed device is signed out");
  assert.equal((await call("/v1/session", { token: phone })).status, 200, "this device stays signed in");
});

test("device data key: one per device, server-held, and gone after remove or sign-out", async () => {
  const me = await signup(91, "Key User", "key_user");
  const login = await call("/v1/login", { method: "POST", ip: "203.0.113.92", body: { accountNumber: me.accountNumber } });
  const phone = me.token;
  const laptop = login.body.token;
  assert.equal((await call("/v1/devices/key")).status, 401, "no session, no key");
  const first = await call("/v1/devices/key", { token: phone });
  assert.equal(first.status, 200);
  assert.match(first.body.key, /^[A-Za-z0-9_-]{43}$/, "a 256-bit key");
  const again = await call("/v1/devices/key", { token: phone });
  assert.equal(again.body.key, first.body.key, "the key stays the same for this device");
  const other = await call("/v1/devices/key", { token: laptop });
  assert.notEqual(other.body.key, first.body.key, "each device has its own key");
  const removed = await call("/v1/devices/remove", { method: "POST", token: phone, body: { id: other.body.id } });
  assert.equal(removed.status, 200);
  assert.equal((await call("/v1/devices/key", { token: laptop })).status, 401, "a removed device cannot get its key back");
  const out = await call("/v1/logout", { method: "POST", token: phone });
  assert.equal(out.status, 200);
  assert.equal((await call("/v1/devices/key", { token: phone })).status, 401, "signing out closes the key too");
});
