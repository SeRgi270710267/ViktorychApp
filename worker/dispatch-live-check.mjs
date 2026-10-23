// Runs the accounts Worker in a local isolate and lets one dispatch through.
// GitHub sees the same POST the owner add sends for tiktok-live.yml.
// Other workflow dispatches stay in the isolate. Nothing here is the owner
// account, and the token is never printed.

import https from "node:https";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const LIVE_PATH = "/repos/ViktorychGroup/ViktorychApp/actions/workflows/tiktok-live.yml/dispatches";

function redact(text) {
  const value = String(process.env.WORKER_DISPATCH_TOKEN || "");
  let out = String(text || "");
  if (value.length >= 4) out = out.split(value).join("[redacted]");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted]");
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[redacted]");
  return out;
}

function postLive(request) {
  const auth = request.headers.get("authorization") || "";
  const expected = "Bearer " + String(process.env.WORKER_DISPATCH_TOKEN || "").trim();
  if (!auth || auth !== expected) {
    return Promise.resolve({ status: 401, body: "worker_authorization=mismatch" });
  }
  return request.text().then((raw) => new Promise((resolve, reject) => {
    if (raw !== '{"ref":"main"}') {
      resolve({ status: 400, body: "worker_body=unexpected" });
      return;
    }
    const body = Buffer.from(raw);
    const req = https.request({
      hostname: "api.github.com",
      path: LIVE_PATH,
      method: "POST",
      headers: {
        Authorization: auth,
        Accept: request.headers.get("accept") || "application/vnd.github+json",
        "X-GitHub-Api-Version": request.headers.get("x-github-api-version") || "2022-11-28",
        "User-Agent": request.headers.get("user-agent") || "viktorych-accounts",
        "Content-Type": "application/json",
        "Content-Length": body.length
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.setTimeout(20000, () => {
      req.destroy(new Error("tiktok-live dispatch timed out"));
    });
    req.on("error", reject);
    req.end(body);
  }));
}

async function call(mf, path, opts) {
  const headers = { "CF-Connecting-IP": opts.ip };
  if (opts.token) headers.Authorization = "Bearer " + opts.token;
  if (opts.body) headers["content-type"] = "application/json";
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { error: "bad_json" }; }
  return { status: res.status, body };
}

async function main() {
  const token = String(process.env.WORKER_DISPATCH_TOKEN || "").trim();
  if (!token) {
    console.log("WORKER_DISPATCH_TOKEN is not set yet");
    return 0;
  }
  let liveStatus = 0;
  let liveBody = "";
  let livePosts = 0;
  const mf = new Miniflare({
    modules: true,
    scriptPath: new URL("./src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io",
      PBKDF2_ITERATIONS: "1000",
      GITHUB_DISPATCH_TOKEN: token
    },
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname === "api.github.com") {
        if (request.method === "POST" && url.pathname === LIVE_PATH) {
          livePosts += 1;
          const posted = await postLive(request);
          liveStatus = posted.status;
          liveBody = posted.body || "";
          if (posted.status === 204 || (posted.status >= 200 && posted.status <= 299)) {
            return new Response(null, { status: posted.status });
          }
          return new Response(redact(liveBody), { status: posted.status || 502 });
        }
        return new Response(null, { status: 500 });
      }
      if (url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com") {
        const html = '<html><meta property="og:title" content="Sample (@sample_name)"><meta property="og:image" content="https://cdn.example/a.jpg"></html>';
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("no", { status: 404 });
    }
  });
  try {
    const owner = await call(mf, "/v1/signup", {
      method: "POST",
      ip: "203.0.113.74",
      body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
    });
    if (owner.status !== 201 || !owner.body || !owner.body.token) {
      console.log("signup_status=" + owner.status);
      console.log("signup_error=" + redact((owner.body && owner.body.error) || ""));
      return 1;
    }
    const added = await call(mf, "/v1/owner/tiktok/accounts", {
      method: "POST",
      ip: "203.0.113.76",
      token: owner.body.token,
      body: { handle: "sample_name" }
    });
    const dispatched = !!(added.body && added.body.dispatched === true);
    console.log("add_status=" + added.status);
    console.log("dispatched=" + dispatched);
    console.log("live_posts=" + livePosts);
    console.log("tiktok-live_dispatch_status=" + liveStatus);
    if (!dispatched && liveBody) console.log(redact(liveBody).slice(0, 500));
    if (added.status === 200 && dispatched && livePosts === 1 && liveStatus >= 200 && liveStatus <= 299) return 0;
    return 1;
  } finally {
    await mf.dispose();
  }
}

main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error(redact(err && err.stack ? err.stack : err));
  process.exit(1);
});
