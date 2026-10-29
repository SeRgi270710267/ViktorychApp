import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { cleanTvLabel } from "../src/tv-build.js";

let mf;
const seen = [];
let releases = [];

function workerOptions(withToken) {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "user_owner",
      ALLOWED_ORIGINS: "https://viktorychapp.pages.dev",
      PBKDF2_ITERATIONS: "1000"
    }, withToken ? { TV_BUILD_TOKEN: "tv-token-test" } : {}),
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname === "api.github.com") {
        let body = null;
        try { body = request.method === "POST" ? await request.json() : null; } catch (err) { body = null; }
        seen.push({ method: request.method, path: url.pathname, auth: request.headers.get("authorization"), body });
        if (url.pathname.endsWith("/actions/workflows/tv-custom.yml/dispatches")) return new Response(null, { status: 204 });
        if (url.pathname.endsWith("/releases")) return Response.json(releases);
        if (/\/releases\/assets\/\d+$/.test(url.pathname)) return new Response(null, { status: 302, headers: { location: "https://objects.example.test/apk" } });
      }
      if (url.hostname === "objects.example.test") {
        assert.equal(request.headers.get("authorization"), null, "the signed asset URL gets no token");
        return new Response("APKDATA", { status: 200 });
      }
      return new Response("no", { status: 404 });
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.90");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  let body = null;
  try { body = type.indexOf("json") >= 0 && text ? JSON.parse(text) : { raw: text }; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, type };
}

async function signup(handle, ip) {
  const created = await call("/v1/signup", { method: "POST", ip, body: { displayName: "User " + handle.slice(-1).toUpperCase(), handle } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

test("TV labels keep letters, digits, spaces and . - _ up to 24 characters", () => {
  assert.equal(cleanTvLabel("  Living   room  "), "Living room");
  assert.equal(cleanTvLabel("<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(cleanTvLabel("Кино & \"сериалы\""), "Кино сериалы");
  assert.equal(cleanTvLabel("मीडिया"), "मीडिया");
  assert.equal(Array.from(cleanTvLabel("x".repeat(40))).length, 24);
  assert.equal(cleanTvLabel("\u202Eevil\u0000"), "evil");
  assert.equal(cleanTvLabel("'\"&<>"), "");
});

test.before(async () => { mf = new Miniflare(workerOptions(true)); });
test.after(async () => { if (mf) await mf.dispose(); });

test("a signed-in user starts a build, polls it, and downloads a signed APK link", async () => {
  const none = await call("/v1/tv/build", { method: "POST", body: { name: "Den", icon: "media" } });
  assert.equal(none.status, 401);
  const ada = await signup("user_a", "203.0.113.91");
  const bad = await call("/v1/tv/build", { method: "POST", token: ada.token, body: { name: "<>", icon: "media" } });
  assert.equal(bad.status, 400);
  const started = await call("/v1/tv/build", { method: "POST", token: ada.token, body: { name: "Living room!", icon: "nope" } });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal(started.body.name, "Living room");
  assert.equal(started.body.icon, "default");
  const id = started.body.id;
  assert.match(id, /^[0-9a-z]{36}$/);
  const dispatch = seen.find((r) => r.path.endsWith("/dispatches"));
  assert.equal(dispatch.auth, "Bearer tv-token-test");
  assert.deepEqual(dispatch.body, { ref: "main", inputs: { build_id: id, label: "Living room", icon: "default" } });

  const waiting = await call("/v1/tv/build/" + id, { token: ada.token });
  assert.equal(waiting.body.state, "building");

  const bea = await signup("user_b", "203.0.113.92");
  const other = await call("/v1/tv/build/" + id, { token: bea.token });
  assert.equal(other.status, 404, "another account cannot see the build");

  releases = [
    { id: 1, draft: false, tag_name: "tv-v1.0.0", assets: [] },
    { id: 2, draft: true, tag_name: "tv-custom-" + id, assets: [{ id: 77, name: "ViktorychTV.apk", state: "uploaded", size: 7 }] }
  ];
  const ready = await call("/v1/tv/build/" + id, { token: ada.token });
  assert.equal(ready.body.state, "ready");
  assert.match(ready.body.download, /^\/v1\/tv\/build\/[0-9a-z]{36}\/apk\?exp=\d+&sig=[0-9a-f]{32}$/);
  const apk = await call(ready.body.download);
  assert.equal(apk.status, 200);
  assert.equal(apk.type, "application/vnd.android.package-archive");
  assert.equal(apk.body.raw, "APKDATA");
  const forged = await call(ready.body.download.replace(/sig=[0-9a-f]/, "sig=z"));
  assert.equal(forged.status, 403);
});

test("builds are limited to three per user per day", async () => {
  const cam = await signup("user_c", "203.0.113.93");
  for (let i = 0; i < 3; i++) {
    const ok = await call("/v1/tv/build", { method: "POST", token: cam.token, body: { name: "Den " + i, icon: "notes" } });
    assert.equal(ok.status, 202);
  }
  const fourth = await call("/v1/tv/build", { method: "POST", token: cam.token, body: { name: "Den 4", icon: "notes" } });
  assert.equal(fourth.status, 429);
});

test("without the token the builder says it is not set up yet", async () => {
  const bare = new Miniflare(workerOptions(false));
  const prev = mf;
  mf = bare;
  try {
    const dee = await signup("user_d", "203.0.113.94");
    const res = await call("/v1/tv/build", { method: "POST", token: dee.token, body: { name: "Den", icon: "media" } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "not_ready");
  } finally {
    mf = prev;
    await bare.dispose();
  }
});
