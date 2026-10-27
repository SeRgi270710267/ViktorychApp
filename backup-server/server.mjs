import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { createCloudflareClient, createD1, createR2, createMemoryCache, resolveD1DatabaseId } from "./cloudflare.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  path.resolve(__dirname, "../worker/src/index.js"),
  path.resolve(__dirname, "./worker/src/index.js"),
  path.resolve(__dirname, "src/index.js")
];
const scriptPath = candidates.find((p) => fs.existsSync(p));
if (!scriptPath) {
  throw new Error("Could not find worker/src/index.js. Checked paths: " + candidates.join(", "));
}

const PORT = parseInt(process.env.PORT || "10000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "./data");
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "https://viktorychgroup.github.io,https://viktorych-app.pages.dev,http://127.0.0.1:8080,http://localhost:8080,http://localhost:5173";

const stats = {
  mode: "local",
  localReason: "",
  d1DatabaseId: "",
  r2Bucket: "",
  startedAt: Date.now(),
  requests: 0,
  errors: 0
};

function workerEnv(overrides) {
  return {
    ACCOUNT_PEPPER: process.env.ACCOUNT_PEPPER || "",
    OWNER_CLAIM_CODE: process.env.OWNER_CLAIM_CODE || "",
    ALLOWED_ORIGINS: ALLOWED_ORIGINS,
    PBKDF2_ITERATIONS: process.env.PBKDF2_ITERATIONS || "8000",
    TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || "",
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
    TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || "",
    GITHUB_DISPATCH_TOKEN: process.env.GITHUB_DISPATCH_TOKEN || "",
    FEDERATION_HOST: process.env.FEDERATION_HOST || "",
    TG_USER_LIMIT: process.env.TG_USER_LIMIT || "",
    TIKTOK_AUDIENCE: process.env.TIKTOK_AUDIENCE || "owner",
    ...(overrides || {})
  };
}

async function remoteEnv() {
  const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (String(process.env.BACKUP_REMOTE || "1") === "0") {
    stats.localReason = "BACKUP_REMOTE=0";
    return null;
  }
  if (!token) {
    stats.localReason = "CLOUDFLARE_API_TOKEN is missing or empty";
    return null;
  }
  if (!accountId) {
    stats.localReason = "CLOUDFLARE_ACCOUNT_ID is missing or empty";
    return null;
  }

  const client = createCloudflareClient({
    token,
    accountId,
    baseUrl: process.env.CLOUDFLARE_API_BASE || undefined
  });
  let databaseId = String(process.env.D1_DATABASE_ID || "").trim();
  if (!databaseId) {
    databaseId = await resolveD1DatabaseId(client, process.env.D1_DATABASE_NAME || "viktorych-accounts");
  }
  const bucket = String(process.env.R2_BUCKET || "viktorych-data").trim();
  stats.mode = "remote";
  stats.d1DatabaseId = databaseId;
  stats.r2Bucket = bucket;
  return workerEnv({ DB: createD1(client, databaseId), DATA: createR2(client, bucket) });
}

async function localEnv() {
  let Miniflare;
  try {
    ({ Miniflare } = await import("miniflare"));
  } catch (err) {
    ({ Miniflare } = await import("../worker/node_modules/miniflare/dist/src/index.js"));
  }
  fs.mkdirSync(path.join(DATA_DIR, "d1"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "r2"), { recursive: true });
  const mf = new Miniflare({
    modules: true,
    scriptPath: scriptPath,
    modulesRoot: path.resolve(path.dirname(scriptPath), "../.."),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: { DB: "viktorych-accounts" },
    d1Persist: path.join(DATA_DIR, "d1"),
    r2Buckets: { DATA: "viktorych-data" },
    r2Persist: path.join(DATA_DIR, "r2"),
    bindings: workerEnv()
  });
  stats.mode = "local";
  return { dispatch: (url, init) => mf.dispatchFetch(url, init), dispose: () => mf.dispose() };
}

async function main() {
  const remote = await remoteEnv();
  let dispatch;
  let dispose = async () => {};

  if (remote) {
    // The Worker source runs unmodified; caches is the only edge API it needs.
    if (!globalThis.caches) globalThis.caches = createMemoryCache();
    globalThis.caches = createMemoryCache();
    const worker = await import(pathToFileURL(scriptPath).href);
    dispatch = (request) => worker.default.fetch(request, remote);
    console.log("[ViktorychApp Backup Backend] shared Cloudflare D1 + R2 mode");
    console.log("[ViktorychApp Backup Backend] D1 database: " + stats.d1DatabaseId);
    console.log("[ViktorychApp Backup Backend] R2 bucket: " + stats.r2Bucket);
  } else {
    const local = await localEnv();
    dispatch = async (request) => {
      const url = new URL(request.url);
      return local.dispatch(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined
      });
    };
    dispose = local.dispose;
    console.log("[ViktorychApp Backup Backend] local Miniflare mode (set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for shared mode)");
  }

  const server = http.createServer(async (req, res) => {
    stats.requests += 1;
    try {
      const hostHeader = req.headers.host || `localhost:${PORT}`;
      const url = new URL(req.url, `http://${hostHeader}`);

      if (url.pathname === "/backup/status") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*"
        });
        res.end(JSON.stringify({
          ok: true,
          mode: stats.mode,
          reason: stats.localReason || null,
          env: {
            CLOUDFLARE_ACCOUNT_ID: !!String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
            CLOUDFLARE_API_TOKEN: !!String(process.env.CLOUDFLARE_API_TOKEN || "").trim(),
            ACCOUNT_PEPPER: !!String(process.env.ACCOUNT_PEPPER || "").trim(),
            BACKUP_REMOTE: process.env.BACKUP_REMOTE || null
          },
          d1: stats.d1DatabaseId || null,
          r2: stats.r2Bucket || null,
          requests: stats.requests,
          errors: stats.errors,
          uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000)
        }));
        return;
      }

      const body = req.method !== "GET" && req.method !== "HEAD" ? await readBody(req) : undefined;
      const headers = new Headers();
      const skipHeaders = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer"]);
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        if (skipHeaders.has(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: body && body.byteLength ? body : undefined
      });

      const response = await dispatch(request);
      res.statusCode = response.status;
      for (const [key, value] of response.headers.entries()) {
        if (key === "set-cookie") continue;
        res.setHeader(key, value);
      }
      const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      if (cookies.length) res.setHeader("set-cookie", cookies);

      if (!response.body) {
        res.end();
        return;
      }
      Readable.fromWeb(response.body).pipe(res);
    } catch (err) {
      stats.errors += 1;
      console.error("[backup-server error]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.setHeader("access-control-allow-origin", "*");
      }
      res.end(JSON.stringify({ error: "backup_server_error", message: String(err && err.message || err) }));
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[ViktorychApp Backup Backend] running at http://${HOST}:${PORT} (${stats.mode})`);
  });

  const shutdown = () => {
    console.log("\n[ViktorychApp Backup Backend] shutting down...");
    server.close(async () => {
      await dispose();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on("error", reject);
  });
}

main().catch((err) => {
  console.error("[ViktorychApp Backup Backend] failed to start:", err);
  process.exit(1);
});
