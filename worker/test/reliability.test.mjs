import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";
import { logError } from "../src/log.js";
import { backupKey, backupSlot, exportDatabase, maybeBackupD1, pruneBackups } from "../src/d1-backup.js";
import "../../shared/mirror.js";

const mirror = globalThis.ViktorychMirror;

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
    kvNamespaces: ["CACHE"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.origin) headers.set("Origin", opts.origin);
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
  return { status: res.status, body, headers: res.headers };
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

test("mirror paths stay on the app and ignore other hosts", () => {
  assert.equal(mirror.appRoot("https://viktorychgroup.github.io", "/ViktorychApp/index.html", "viktorychgroup.github.io"), "https://viktorychgroup.github.io/ViktorychApp/");
  assert.equal(mirror.appRoot("https://viktorychapp.pages.dev", "/index.html", "viktorychapp.pages.dev"), "https://viktorychapp.pages.dev/");
  assert.equal(mirror.relativeTo("https://viktorychgroup.github.io/ViktorychApp/", "https://viktorychgroup.github.io/ViktorychApp/app.js?v=1"), "app.js?v=1");
  assert.equal(mirror.rewrite("https://viktorychapp.pages.dev/", "shared/mirror.js"), "https://viktorychapp.pages.dev/shared/mirror.js");
  assert.equal(mirror.rewrite("https://viktorychapp.pages.dev/", "../app.js"), "");
  assert.equal(mirror.failoverStatus(0), true);
  assert.equal(mirror.failoverStatus(404), true);
  assert.equal(mirror.failoverStatus(429), true);
  assert.equal(mirror.failoverStatus(503), true);
  assert.equal(mirror.failoverStatus(200), false);
  assert.equal(mirror.failoverStatus(403), false);
  assert.equal(mirror.mirrorHost("localhost"), false);
  assert.equal(mirror.mirrorHost("evil.pages.dev"), false);
  assert.equal(mirror.mirrorHost("viktorychapp.pages.dev.evil.example"), false);
  assert.equal(mirror.mirrorHost("viktorychapp.pages.dev"), true);
  assert.equal(mirror.mirrorHost("abc.viktorychapp.pages.dev"), true);
  assert.equal(mirror.mirrorHost("viktorychgroup.github.io"), true);
  assert.equal(mirror.normalizeBase("__MIRROR_PAGES__"), "");
});

test("error logs drop tokens and long secrets", () => {
  const secret = "s".repeat(40);
  const lines = [];
  const orig = console.error;
  console.error = (msg) => lines.push(String(msg));
  try {
    logError("auth", new Error("bearer " + secret + " failed"));
  } finally {
    console.error = orig;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes(secret), false);
  assert.match(lines[0], /"area":"auth"/);
});

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("pages.dev origins can call the same worker and other pages hosts cannot", async () => {
  const pages = await call("/v1/health", { origin: "https://viktorychapp.pages.dev" });
  assert.equal(pages.status, 200);
  assert.equal(pages.headers.get("access-control-allow-origin"), "https://viktorychapp.pages.dev");
  const preview = await call("/v1/health", { origin: "https://abc.viktorychapp.pages.dev" });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("access-control-allow-origin"), "https://abc.viktorychapp.pages.dev");
  const evil = await call("/v1/health", { origin: "https://evil.pages.dev" });
  assert.equal(evil.status, 403);
  const nested = await call("/v1/health", { origin: "https://viktorychapp.pages.dev.evil.example" });
  assert.equal(nested.status, 403);
});

test("a public profile can be served from KV and a write drops that copy", async () => {
  const ada = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.80",
    body: { displayName: "Ada Lovelace", handle: "ada_kv" }
  });
  assert.equal(ada.status, 201);
  const bea = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.81",
    body: { displayName: "Bea", handle: "bea_kv" }
  });
  assert.equal(bea.status, 201);
  const id = ada.body.account.publicId;
  const env = await mf.getBindings();
  const poisoned = JSON.stringify({
    account: { displayName: "Cached Ada", publicId: id, handle: "ada_kv", identities: [] },
    reposts: []
  });
  await env.CACHE.put("p:" + id, JSON.stringify({ hash: "poison", body: poisoned, at: Date.now() }), { expirationTtl: 86400 });
  const seen = await call("/v1/profile/ada_kv", { ip: "203.0.113.82", token: bea.body.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.account.displayName, "Cached Ada");
  const patched = await call("/v1/profile", {
    method: "PATCH",
    ip: "203.0.113.83",
    token: ada.body.token,
    body: { displayName: "Ada Lovelace" }
  });
  assert.equal(patched.status, 200);
  const fresh = await call("/v1/profile/ada_kv", { ip: "203.0.113.84", token: bea.body.token });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.account.displayName, "Ada Lovelace");
});

test("the daily D1 export is gzip SQL and only the last 14 days stay", async () => {
  const env = await mf.getBindings();
  const made = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.85",
    body: { displayName: "Backup", handle: "backup_kv" }
  });
  assert.equal(made.status, 201);
  const number = made.body.accountNumber;
  const when = Date.parse("2026-10-27T04:17:00Z");
  assert.equal(backupSlot(when), true);
  assert.equal(backupSlot(Date.parse("2026-10-27T03:17:00Z")), false);
  const saved = await exportDatabase(env, when);
  assert.ok(saved && saved.key === backupKey(when));
  const object = await env.DATA.get(saved.key);
  const sql = await gunzip(new Uint8Array(await object.arrayBuffer()));
  assert.match(sql, /CREATE TABLE/);
  assert.match(sql, /INSERT INTO/);
  assert.equal(sql.includes(number), false);
  assert.equal(sql.includes("pepper-test"), false);
  await env.DATA.put("backups/d1/2020-01-01.sql.gz", new Uint8Array([1, 2, 3]));
  const removed = await pruneBackups(env, when, 14);
  assert.ok(removed.includes("backups/d1/2020-01-01.sql.gz"));
  assert.equal(await env.DATA.head("backups/d1/2020-01-01.sql.gz"), null);
  assert.ok(await env.DATA.head(saved.key));
  const ran = await maybeBackupD1(env, when);
  assert.equal(ran, false);
  const again = await maybeBackupD1(env, when);
  assert.equal(again, false);
});
