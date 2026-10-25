import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

let Miniflare;
try {
  ({ Miniflare } = await import("miniflare"));
} catch (err) {
  try {
    ({ Miniflare } = await import("../worker/node_modules/miniflare/dist/src/index.js"));
  } catch (err2) {
    throw new Error("Could not load Miniflare. Run 'npm install' in backup-server or worker directory.");
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate worker/src/index.js and root
const candidates = [
  path.resolve(__dirname, "../worker/src/index.js"),
  path.resolve(__dirname, "./worker/src/index.js"),
  path.resolve(__dirname, "src/index.js")
];
let scriptPath = candidates.find((p) => fs.existsSync(p));
if (!scriptPath) {
  throw new Error("Could not find worker/src/index.js. Checked paths: " + candidates.join(", "));
}
const modulesRoot = path.resolve(path.dirname(scriptPath), "../..");

const PORT = parseInt(process.env.PORT || "7860", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "./data");

fs.mkdirSync(path.join(DATA_DIR, "d1"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "r2"), { recursive: true });

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "https://viktorychgroup.github.io,http://127.0.0.1:8080,http://localhost:8080,http://localhost:5173";

const mf = new Miniflare({
  modules: true,
  scriptPath: scriptPath,
  modulesRoot: modulesRoot,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
  compatibilityDate: "2026-01-15",
  d1Databases: { DB: "viktorych-accounts" },
  d1Persist: path.join(DATA_DIR, "d1"),
  r2Buckets: { DATA: "viktorych-data" },
  r2Persist: path.join(DATA_DIR, "r2"),
  bindings: {
    ACCOUNT_PEPPER: process.env.ACCOUNT_PEPPER || "viktorych-pepper-change-in-prod",
    OWNER_CLAIM_CODE: process.env.OWNER_CLAIM_CODE || "",
    ALLOWED_ORIGINS: ALLOWED_ORIGINS,
    PBKDF2_ITERATIONS: process.env.PBKDF2_ITERATIONS || "8000",
    TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || "",
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || ""
  }
});

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val != null) headers.set(key, Array.isArray(val) ? val.join(", ") : String(val));
    }

    const hostHeader = req.headers.host || `localhost:${PORT}`;
    const fullUrl = new URL(req.url, `http://${hostHeader}`);

    const workerRes = await mf.dispatchFetch(fullUrl.toString(), {
      method: req.method,
      headers,
      body: (req.method !== "GET" && req.method !== "HEAD") ? bodyBuffer : undefined
    });

    res.statusCode = workerRes.status;
    for (const [key, val] of workerRes.headers.entries()) {
      res.setHeader(key, val);
    }

    const responseBuffer = Buffer.from(await workerRes.arrayBuffer());
    res.end(responseBuffer);
  } catch (err) {
    console.error("[backup-server error]", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "backup_server_error", message: String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[ViktorychApp Backup Backend] running at http://${HOST}:${PORT}`);
  console.log(`[ViktorychApp Backup Backend] persistent data dir: ${DATA_DIR}`);
});

function shutdown() {
  console.log("\n[ViktorychApp Backup Backend] shutting down...");
  server.close(async () => {
    await mf.dispose();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
