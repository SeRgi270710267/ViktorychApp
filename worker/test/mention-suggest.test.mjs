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
      OWNER_HANDLE: "mirathorn",
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

test("mention suggestions match handle and name prefixes, any case, followed people first", async () => {
  const one = await signup(31, "Placemy One", "placemy_one");
  const two = await signup(32, "Placemy Two", "placemy_two");
  await signup(33, "Tidepool Placemy", "tidepool_x");
  const viewer = await signup(34, "Viewer", "viewer_a");

  const anon = await call("/v1/mentions/suggest?q=placemy", { ip: "203.0.113.35" });
  assert.equal(anon.status, 401);

  const first = await call("/v1/mentions/suggest?q=PLACEMY", { ip: "203.0.113.36", token: viewer.token });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.accounts.map((a) => a.handle), ["placemy_one", "placemy_two"]);
  assert.equal(first.body.accounts[0].name, "Placemy One");
  assert.equal(first.text.indexOf(one.account.publicId), -1, "no account ids in suggestions");

  const followed = await call("/v1/follows", { method: "PUT", ip: "203.0.113.37", token: viewer.token, body: { id: "app:" + two.account.publicId } });
  assert.equal(followed.status, 200, JSON.stringify(followed.body));
  const ranked = await call("/v1/mentions/suggest?q=@placem", { ip: "203.0.113.38", token: viewer.token });
  assert.deepEqual(ranked.body.accounts.map((a) => a.handle), ["placemy_two", "placemy_one"]);
  assert.equal(ranked.body.accounts[0].follows, true);

  const byName = await call("/v1/mentions/suggest?q=tidep", { ip: "203.0.113.39", token: viewer.token });
  assert.deepEqual(byName.body.accounts.map((a) => a.handle), ["tidepool_x"]);

  const self = await call("/v1/mentions/suggest?q=viewer", { ip: "203.0.113.40", token: viewer.token });
  assert.deepEqual(self.body.accounts, []);

  const empty = await call("/v1/mentions/suggest?q=%25", { ip: "203.0.113.41", token: viewer.token });
  assert.deepEqual(empty.body.accounts, []);
});
