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
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "https://viktorychgroup.github.io,https://viktorychapp.pages.dev,http://127.0.0.1:8080,http://localhost:8080,http://localhost:5173";

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 28000;
// Render's free workspace includes 5 GB of outbound bandwidth a month. Going
// over it with no card on file suspends every free service until the next
// month, so the backup stops serving heavy bodies well before that.
const EGRESS_BUDGET = (Number(process.env.RENDER_EGRESS_BUDGET_MB) || 3500) * 1024 * 1024;
// Heavy jobs pause when the instance gets close to its 512 MB limit.
const JOB_RSS_LIMIT = (Number(process.env.JOB_RSS_LIMIT_MB) || 360) * 1024 * 1024;
const EGRESS_KEY_PREFIX = "ops/render-egress/";

const stats = {
  mode: "local",
  localReason: "",
  d1DatabaseId: "",
  r2Bucket: "",
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  timeouts: 0,
  refused: 0,
  egress: { month: "", bytes: 0, saved: 0, over: false }
};

function monthKey(at) {
  return new Date(at || Date.now()).toISOString().slice(0, 7);
}
function noteEgress(bytes) {
  const month = monthKey();
  if (stats.egress.month !== month) { stats.egress.month = month; stats.egress.bytes = 0; }
  stats.egress.bytes += Math.max(0, Number(bytes) || 0);
  stats.egress.over = stats.egress.bytes >= EGRESS_BUDGET;
}
async function loadEgress(env) {
  stats.egress.month = monthKey();
  if (!env || !env.DATA) return;
  try {
    const object = await env.DATA.get(EGRESS_KEY_PREFIX + stats.egress.month + ".json");
    const row = object ? await object.json() : null;
    if (row && Number(row.bytes) > stats.egress.bytes) stats.egress.bytes = Number(row.bytes);
    stats.egress.saved = stats.egress.bytes;
    noteEgress(0);
  } catch (err) {
    console.error("[backup-server] egress meter load failed:", String(err && err.message || err));
  }
}
async function saveEgress(env) {
  if (!env || !env.DATA || stats.egress.bytes === stats.egress.saved) return;
  const bytes = stats.egress.bytes;
  try {
    await env.DATA.put(EGRESS_KEY_PREFIX + stats.egress.month + ".json", JSON.stringify({ bytes, at: Date.now() }), { httpMetadata: { contentType: "application/json" } });
    stats.egress.saved = bytes;
  } catch (err) {
    console.error("[backup-server] egress meter save failed:", String(err && err.message || err));
  }
}

/* Remote media relays copy whole videos through this instance: one evening
   of video uses up the free bandwidth. The Worker relays them instead. */
function refusedHere(url) {
  if (url.pathname === "/v1/media" && url.searchParams.has("url")) return "backup_media_off";
  if (url.pathname === "/v1/yt/media" || url.pathname === "/v1/yt/manifest") return "backup_media_off";
  return "";
}
function lightType(type) {
  return /json|^text\/|javascript|xml|event-stream/i.test(String(type || ""));
}
function corsHeaders(req) {
  const origin = String(req.headers.origin || "");
  const allowed = ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean);
  return {
    "access-control-allow-origin": origin && allowed.includes(origin) ? origin : "*",
    "vary": "Origin"
  };
}
function sendJson(req, res, status, body, extra) {
  if (res.headersSent) { res.end(); return; }
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(text))
  }, corsHeaders(req), extra || {}));
  res.end(text);
  noteEgress(text.length + 300);
}
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("backup_timeout"), { code: "BACKUP_TIMEOUT" })), ms);
      if (timer.unref) timer.unref();
    })
  ]).finally(() => clearTimeout(timer));
}

function workerEnv(overrides) {
  return {
    ACCOUNT_PEPPER: process.env.ACCOUNT_PEPPER || "",
    SIGNUP_GUARD: process.env.SIGNUP_GUARD || "on",
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
    baseUrl: process.env.CLOUDFLARE_API_BASE || undefined,
    timeoutMs: Number(process.env.CLOUDFLARE_TIMEOUT_MS) || 20000,
    // Uploads to D1 and R2 leave this instance too: they count.
    onSend: (bytes) => noteEgress(bytes)
  });
  let databaseId = String(process.env.D1_DATABASE_ID || "").trim();
  if (!databaseId) {
    databaseId = await resolveD1DatabaseId(client, process.env.D1_DATABASE_NAME || "viktorych-accounts");
  }
  const bucket = String(process.env.R2_BUCKET || "viktorych-data").trim();
  stats.mode = "remote";
  stats.d1DatabaseId = databaseId;
  stats.r2Bucket = bucket;
  return workerEnv({ DB: createD1(client, databaseId), DATA: createR2(client, bucket), JOB_RUNNER: "render" });
}

async function miniflareAvailable() {
  try { await import("miniflare"); return true; } catch (err) { /* try the Worker copy */ }
  try { await import("../worker/node_modules/miniflare/dist/src/index.js"); return true; } catch (err) { return false; }
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
  let persistEgress = async () => {};

  if (remote) {
    // The Worker source runs unmodified; caches is the only edge API it needs.
    globalThis.caches = createMemoryCache({
      maxBytes: (Number(process.env.CACHE_MB) || 32) * 1024 * 1024,
      maxEntryBytes: (Number(process.env.CACHE_ENTRY_MB) || 2) * 1024 * 1024
    });
    stats.cache = globalThis.caches.stats;
    const worker = await import(pathToFileURL(scriptPath).href);
    // The Worker expects a ctx; background promises must never crash Node.
    const ctx = {
      waitUntil(promise) {
        Promise.resolve(promise).catch((err) => console.error("[backup-server] background task failed:", String(err && err.message || err)));
      },
      passThroughOnException() {}
    };
    dispatch = (request) => worker.default.fetch(request, remote, ctx);
    await loadEgress(remote);
    setInterval(() => { saveEgress(remote); }, 10 * 60 * 1000).unref();
    persistEgress = () => saveEgress(remote);
    if (String(process.env.RENDER_JOBS || "1") !== "0" && typeof worker.runBackgroundJobs === "function") {
      startJobLoop(worker, remote);
    }
    console.log("[ViktorychApp Backup Backend] shared Cloudflare D1 + R2 mode");
    console.log("[ViktorychApp Backup Backend] D1 database: " + stats.d1DatabaseId);
    console.log("[ViktorychApp Backup Backend] R2 bucket: " + stats.r2Bucket);
  } else if (!(await miniflareAvailable())) {
    // The production image ships without Miniflare. Without Cloudflare
    // credentials there is nothing safe to serve: answer 503 so clients stay
    // on the Worker, and keep /backup/status explaining why.
    stats.mode = "unconfigured";
    dispatch = async () => new Response(JSON.stringify({ error: "backup_unconfigured" }), {
      status: 503,
      headers: { "content-type": "application/json", "retry-after": "3600", "access-control-allow-origin": "*" }
    });
    console.error("[ViktorychApp Backup Backend] not configured: " + stats.localReason + ". Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the Render dashboard.");
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

      // Render's health check and the keep-warm ping: no D1 or R2 call.
      if (url.pathname === "/backup/health") {
        sendJson(req, res, 200, { ok: true, mode: stats.mode, uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000) });
        return;
      }

      if (url.pathname === "/backup/status") {
        const mem = process.memoryUsage();
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
          jobs: stats.jobs || null,
          errors: stats.errors,
          timeouts: stats.timeouts,
          refused: stats.refused,
          memoryMB: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
          cache: stats.cache ? { entries: stats.cache.entries, mb: Math.round(stats.cache.bytes / 104857.6) / 10, hits: stats.cache.hits, evicted: stats.cache.evicted } : null,
          egress: { month: stats.egress.month, mb: Math.round(stats.egress.bytes / 1048576), budgetMB: Math.round(EGRESS_BUDGET / 1048576), saver: stats.egress.over },
          uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000)
        }));
        return;
      }

      const refused = refusedHere(url);
      if (refused) {
        stats.refused += 1;
        sendJson(req, res, 503, { error: refused }, { "retry-after": "3600" });
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

      let response;
      try {
        response = await withTimeout(dispatch(request), REQUEST_TIMEOUT_MS);
      } catch (err) {
        if (err && err.code === "BACKUP_TIMEOUT") {
          // The client fails over or retries; a hung request helps no one.
          stats.timeouts += 1;
          sendJson(req, res, 504, { error: "backup_timeout" }, { "retry-after": "5" });
          return;
        }
        throw err;
      }
      // Bandwidth saver: past the monthly budget only light bodies go out.
      if (stats.egress.over && response.body && !lightType(response.headers.get("content-type"))) {
        response.body.cancel().catch(() => {});
        stats.refused += 1;
        sendJson(req, res, 503, { error: "backup_bandwidth_saver" }, { "retry-after": "3600" });
        return;
      }
      res.statusCode = response.status;
      for (const [key, value] of response.headers.entries()) {
        if (key === "set-cookie") continue;
        res.setHeader(key, value);
      }
      const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      if (cookies.length) res.setHeader("set-cookie", cookies);

      if (!response.body) {
        res.end();
        noteEgress(400);
        return;
      }
      const stream = Readable.fromWeb(response.body);
      stream.on("data", (chunk) => noteEgress(chunk.length));
      stream.on("error", (err) => {
        console.error("[backup-server] response stream failed:", String(err && err.message || err));
        res.destroy(err);
      });
      res.on("close", () => { if (!stream.destroyed) stream.destroy(); });
      noteEgress(400);
      stream.pipe(res);
    } catch (err) {
      stats.errors += 1;
      console.error("[backup-server error]", err);
      // A Cloudflare API hiccup is a gateway problem: 502 lets the client
      // fail over instead of showing an error. Details stay in the log.
      const upstream = err && (err.name === "CloudflareError" || err.name === "TimeoutError" || err.name === "AbortError");
      if (res.headersSent) { res.end(); return; }
      sendJson(req, res, upstream ? 502 : 500, { error: upstream ? "backup_upstream" : "backup_server_error" }, upstream ? { "retry-after": "5" } : undefined);
    }
  });

  // Render's proxy keeps idle connections open longer than Node's 5 s
  // default. A socket Node already closed then gets reused and the request
  // fails with a 502. Outlive the proxy instead.
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  server.requestTimeout = 0;

  server.listen(PORT, HOST, () => {
    console.log(`[ViktorychApp Backup Backend] running at http://${HOST}:${PORT} (${stats.mode})`);
  });

  const shutdown = () => {
    console.log("\n[ViktorychApp Backup Backend] shutting down...");
    server.close(async () => {
      await persistEgress();
      await dispose();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // One stray rejection used to take the whole instance down.
  process.on("unhandledRejection", (err) => {
    stats.errors += 1;
    console.error("[backup-server] unhandled rejection:", err);
  });
}

/* While awake, Render claims the heavy cron jobs every minute and runs them
   here; the Worker cron skips claimed jobs. When the free instance sleeps
   the claim goes stale and the Worker takes them back by itself. */
function startJobLoop(worker, env) {
  const jobs = stats.jobs = { on: true, runs: 0, skipped: 0, lastAt: 0, lastMs: 0, failed: [], error: null };
  let busySince = 0;
  let runner = null;
  const tick = async () => {
    const at = Date.now();
    // A pass stuck for ten minutes stops claiming so the Worker takes over.
    if (busySince && at - busySince > 600000) { jobs.error = "stuck"; return; }
    // Near the memory limit or past the bandwidth budget: stop claiming and
    // the Worker cron takes the jobs back within a few minutes.
    if (process.memoryUsage().rss > JOB_RSS_LIMIT || stats.egress.over) {
      jobs.paused = stats.egress.over ? "bandwidth" : "memory";
      jobs.skipped += 1;
      if (global.gc) global.gc();
      return;
    }
    jobs.paused = null;
    try {
      if (!runner) runner = await import(pathToFileURL(path.resolve(path.dirname(scriptPath), "job-runner.js")).href);
      // Live watching starts recordings through GitHub; without that token it stays on the Worker.
      const names = runner.OFFLOAD_JOBS.filter((name) => name !== "tiktokLive" || env.GITHUB_DISPATCH_TOKEN);
      jobs.claimed = await runner.claimJobs(env, at, names);
    } catch (err) {
      jobs.error = "claim: " + String(err && err.message || err).slice(0, 160);
      return;
    }
    if (busySince) { jobs.skipped += 1; return; }
    busySince = at;
    try {
      const result = await worker.runBackgroundJobs(env, at, jobs.claimed);
      jobs.runs += 1;
      jobs.failed = result.failed;
      jobs.error = null;
    } catch (err) {
      jobs.error = String(err && err.message || err).slice(0, 160);
    } finally {
      jobs.lastAt = at;
      jobs.lastMs = Date.now() - at;
      busySince = 0;
    }
  };
  setTimeout(tick, Number(process.env.RENDER_JOBS_FIRST_MS) || 5000);
  setInterval(tick, 60000).unref();
  console.log("[ViktorychApp Backup Backend] background jobs: on");
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
