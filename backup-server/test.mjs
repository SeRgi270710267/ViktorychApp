import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 8991;
const TEST_DATA_DIR = path.resolve(__dirname, "./.test_data");
fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

console.log("[test] Starting backup server on port", TEST_PORT);

const child = spawn(process.execPath, [path.resolve(__dirname, "server.mjs")], {
  env: Object.assign({}, process.env, {
    PORT: String(TEST_PORT),
    HOST: "127.0.0.1",
    DATA_DIR: TEST_DATA_DIR,
    ACCOUNT_PEPPER: "test-pepper-1234",
    PBKDF2_ITERATIONS: "1000",
    ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080"
  }),
  stdio: ["ignore", "pipe", "pipe"]
});

child.stdout.on("data", (d) => process.stdout.write("[server stdout] " + d));
child.stderr.on("data", (d) => process.stderr.write("[server stderr] " + d));

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/health`);
      if (res.status === 200) return true;
    } catch (e) {
      // wait
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

try {
  const ready = await waitForServer();
  assert.ok(ready, "Server failed to start and respond on /v1/health");

  console.log("[test] 1. /v1/health check");
  const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/health`);
  assert.equal(healthRes.status, 200);
  const healthBody = await healthRes.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.ready, true);

  console.log("[test] 2. /v1/signup anonymous account");
  const signupRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Origin": "https://viktorychgroup.github.io"
    },
    body: JSON.stringify({
      handle: "backup_user",
      displayName: "Backup Tester"
    })
  });
  const signupBody = await signupRes.json();
  assert.equal(signupRes.status, 201, JSON.stringify(signupBody));
  assert.ok(signupBody.token, "Signup should return a session token");
  assert.ok(signupBody.accountNumber, "Signup should return an account number");

  console.log("[test] 3. /v1/session check with token");
  const sessionRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/session`, {
    headers: {
      "Authorization": "Bearer " + signupBody.token,
      "Origin": "https://viktorychgroup.github.io"
    }
  });
  const sessionBody = await sessionRes.json();
  assert.equal(sessionRes.status, 200, JSON.stringify(sessionBody));
  assert.equal(sessionBody.account.handle, "backup_user");

  console.log("[test] 4. /v1/login check with account number");
  const loginRes = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Origin": "https://viktorychgroup.github.io"
    },
    body: JSON.stringify({
      accountNumber: signupBody.accountNumber
    })
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.ok(loginBody.token, "Login should return a session token");

  console.log("[test] ALL BACKUP SERVER TESTS PASSED!");
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}
