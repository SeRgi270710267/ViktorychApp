import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (err) {
  console.log("[test] node:sqlite is unavailable in this Node version; skipping the remote integration test.");
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = 8992;
const APP_PORT = 8993;
const ORIGIN = "https://viktorychgroup.github.io";
const database = new DatabaseSync(":memory:");
const objects = new Map();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
}

const api = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  // /client/v4/accounts/:account/d1/database
  if (req.method === "GET" && parts[4] === "d1" && parts[5] === "database" && parts.length === 6) {
    return json(res, 200, { success: true, result: [{ name: "viktorych-accounts", uuid: "db-test" }] });
  }

  // /client/v4/accounts/:account/d1/database/:id/query
  if (req.method === "POST" && parts[4] === "d1" && parts[5] === "database" && parts[7] === "query") {
    const payload = JSON.parse(await readBody(req));
    const run = (item) => {
      const statement = database.prepare(item.sql);
      const params = item.params || [];
      if (/^\s*(select|pragma|with)/i.test(item.sql)) {
        const results = statement.all(...params);
        return { success: true, results, meta: {} };
      }
      const info = statement.run(...params);
      return { success: true, results: [], meta: { changes: Number(info.changes || 0) } };
    };
    try {
      if (Array.isArray(payload.batch)) {
        return json(res, 200, { success: true, result: payload.batch.map(run) });
      }
      return json(res, 200, { success: true, result: [run(payload)] });
    } catch (err) {
      return json(res, 400, { success: false, errors: [{ code: 7500, message: String(err && err.message || err) }] });
    }
  }

  // R2 objects: /client/v4/accounts/:account/r2/buckets/:bucket/objects[/:key...]
  if (parts[4] === "r2" && parts[5] === "buckets" && parts[6] === "viktorych-data" && parts[7] === "objects") {
    if (req.method === "GET" && parts.length === 8) {
      const prefix = url.searchParams.get("prefix") || "";
      const rows = [];
      for (const [key, item] of objects) {
        if (!key.startsWith(prefix)) continue;
        rows.push({ key, size: item.bytes.length, etag: item.etag, http_metadata: { contentType: item.type }, last_modified: "2026-01-01T00:00:00Z" });
      }
      rows.sort((a, b) => a.key.localeCompare(b.key));
      return json(res, 200, { success: true, result: rows, result_info: { is_truncated: false } });
    }
    const key = parts.slice(8).map(decodeURIComponent).join("/");
    if (req.method === "PUT") {
      const bytes = Buffer.from(await readBody(req), "utf8");
      const etag = "etag-" + objects.size;
      objects.set(key, { bytes, etag, type: req.headers["content-type"] || "application/octet-stream" });
      return json(res, 200, { success: true, result: { key, size: bytes.length, etag } });
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      return json(res, 200, { success: true, result: {} });
    }
    if (req.method === "GET") {
      const item = objects.get(key);
      if (!item) return json(res, 404, { success: false, errors: [{ code: 10007, message: "not found" }] });
      res.writeHead(200, { "content-type": item.type, etag: '"' + item.etag + '"', "content-length": String(item.bytes.length) });
      return res.end(item.bytes);
    }
  }

  return json(res, 404, { success: false, errors: [{ code: 1000, message: "unexpected " + req.method + " " + url.pathname }] });
});

let child;
try {
  await new Promise((resolve) => api.listen(API_PORT, "127.0.0.1", resolve));
  console.log("[test] mock Cloudflare API on", API_PORT);

  child = spawn(process.execPath, [path.resolve(__dirname, "server.mjs")], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      HOST: "127.0.0.1",
      CLOUDFLARE_API_BASE: `http://127.0.0.1:${API_PORT}/client/v4`,
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_API_TOKEN: "test-token",
      D1_DATABASE_NAME: "viktorych-accounts",
      R2_BUCKET: "viktorych-data",
      ACCOUNT_PEPPER: "integration-pepper",
      PBKDF2_ITERATIONS: "1000",
      ALLOWED_ORIGINS: ORIGIN
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (data) => process.stdout.write("[server] " + data));
  child.stderr.on("data", (data) => process.stderr.write("[server] " + data));

  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${APP_PORT}/backup/status`);
      if (res.ok) {
        const status = await res.json();
        assert.equal(status.mode, "remote", "backup must run in shared Cloudflare mode");
        assert.equal(status.d1, "db-test");
        ready = true;
        break;
      }
    } catch (err) { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "backup server did not start in remote mode");

  const health = await fetch(`http://127.0.0.1:${APP_PORT}/v1/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ready, true);

  console.log("[test] 1. signup writes through the shared D1");
  const signupRes = await fetch(`http://127.0.0.1:${APP_PORT}/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ handle: "shared_user", displayName: "Shared User" })
  });
  const signup = await signupRes.json();
  assert.equal(signupRes.status, 201, JSON.stringify(signup));
  assert.ok(signup.token);
  assert.match(String(signup.accountNumber), /^\d{16}$/);

  const row = database.prepare("SELECT handle, number_lookup FROM accounts WHERE public_id = ?").get(signup.account.publicId);
  assert.equal(row.handle, "shared_user");

  console.log("[test] 2. session token validates");
  const sessionRes = await fetch(`http://127.0.0.1:${APP_PORT}/v1/session`, {
    headers: { Authorization: "Bearer " + signup.token, Origin: ORIGIN }
  });
  assert.equal(sessionRes.status, 200);
  assert.equal((await sessionRes.json()).account.handle, "shared_user");

  console.log("[test] 3. login with the account number works");
  const loginRes = await fetch(`http://127.0.0.1:${APP_PORT}/v1/login`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ accountNumber: signup.accountNumber })
  });
  const login = await loginRes.json();
  assert.equal(loginRes.status, 200, JSON.stringify(login));
  assert.ok(login.token);

  console.log("[test] 4. an account created elsewhere in D1 can sign in here");
  database.prepare(
    "INSERT INTO accounts (public_id, handle, skeleton, display_name, number_lookup, number_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run("primary-account", "primary_user", "primary_user", "Primary User", "lookup-primary", "hash-primary", "salt-primary", Date.now());
  const createdElsewhere = database.prepare("SELECT public_id FROM accounts WHERE public_id = ?").get("primary-account");
  assert.equal(createdElsewhere.public_id, "primary-account");

  console.log("[test] 5. R2 objects are shared");
  objects.set("feeds.json", { bytes: Buffer.from(JSON.stringify({ items: [] })), etag: "seed", type: "application/json" });
  const dataRes = await fetch(`http://127.0.0.1:${APP_PORT}/v1/data/feeds.json`, {
    headers: { Authorization: "Bearer " + signup.token, Origin: ORIGIN }
  });
  assert.equal(dataRes.status, 200, "R2 data fetch failed with " + dataRes.status);
  assert.deepEqual(await dataRes.json(), { items: [] });

  console.log("[test] ALL REMOTE BACKUP INTEGRATION TESTS PASSED!");
} finally {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  await new Promise((resolve) => api.close(resolve));
  database.close();
}
