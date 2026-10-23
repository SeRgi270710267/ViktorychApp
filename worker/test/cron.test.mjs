import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "S\u0435\u0420g\u0418";
const ROOM = "7699647509498710804";
const dispatches = [];
const liveHits = { page: 0, room: 0 };

let mf;

function workerOptions() {
  return {
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("../..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname === "webcast.tiktok.com") {
        liveHits.room += 1;
        const hls = "https://pull-hls-f16-tt04.tiktokcdn.com/origin/index.m3u8";
        const body = {
          data: {
            status: 2,
            user_count: 4,
            title: "now",
            stream_url: {
              live_core_sdk_data: {
                pull_data: {
                  stream_data: JSON.stringify({
                    data: { origin: { main: { hls, flv: hls.replace(".m3u8", ".flv") } } }
                  })
                }
              }
            }
          }
        };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
      if ((url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com") && url.pathname.indexOf("/live") >= 0) {
        liveHits.page += 1;
        const html = '<script id="SIGI_STATE">{"LiveRoom":{"liveRoomUserInfo":{"user":{"roomId":"' + ROOM + '"}}}}</script>';
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com") {
        const html = '<html><meta property="og:title" content="Sample (@sample_name)"><meta property="og:image" content="https://cdn.example/a.jpg"></html>';
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
        const auth = request.headers.get("authorization") || "";
        if (!auth.startsWith("Bearer ")) return new Response("no", { status: 401 });
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
  return { status: res.status, body };
}

async function fire(cron) {
  const worker = await mf.getWorker();
  await worker.scheduled({ cron, scheduledTime: Date.now() });
}

function liveDispatches() {
  return dispatches.filter((path) => path.indexOf("/tiktok-live.yml/dispatches") >= 0);
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("a live cron fires three times and dispatches one new recording", async () => {
  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.80",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  const added = await call("/v1/owner/tiktok/accounts", {
    method: "POST",
    ip: "203.0.113.81",
    token: owner.body.token,
    body: { handle: "sample_name" }
  });
  assert.equal(added.status, 200);
  dispatches.length = 0;
  liveHits.page = 0;
  liveHits.room = 0;

  await fire("*/3 * * * *");
  await fire("*/3 * * * *");
  await fire("*/3 * * * *");
  const health = await call("/v1/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.cron.live, 3);
  assert.equal(liveDispatches().length, 1);
  assert.equal(liveHits.page, 1);
  assert.equal(liveHits.room, 1);

  const bucket = await mf.getR2Bucket("DATA");
  const stored = JSON.parse(await (await bucket.get("owner/tiktok.json")).text());
  assert.equal(stored.live.sample_name.live, true);
  assert.equal(stored.live.sample_name.dispatchedRoom, ROOM);
  assert.equal(stored.live.sample_name.quality, "origin");

  stored.live.sample_name.checkedAt = "2020-01-01T00:00:00Z";
  await bucket.put("owner/tiktok.json", JSON.stringify(stored));
  await fire("*/3 * * * *");
  assert.equal(liveDispatches().length, 1);
  assert.ok(health.body.cron.live >= 3);

  const again = JSON.parse(await (await bucket.get("owner/tiktok.json")).text());
  again.live.sample_name.checkedAt = "2020-01-01T00:00:00Z";
  again.live.sample_name.dispatchedRoom = "";
  await bucket.put("owner/tiktok.json", JSON.stringify(again));
  await bucket.put("owner/live-jobs/sample_name.json", JSON.stringify({
    active: { state: "recording", roomId: ROOM }
  }));
  await fire("*/3 * * * *");
  assert.equal(liveDispatches().length, 1);

  const paused = JSON.parse(await (await bucket.get("owner/tiktok.json")).text());
  paused.live.sample_name.checkedAt = "2020-01-01T00:00:00Z";
  paused.live.sample_name.backoffUntil = "2099-01-01T00:00:00Z";
  paused.live.sample_name.dispatchedRoom = "";
  await bucket.put("owner/tiktok.json", JSON.stringify(paused));
  const pages = liveHits.page;
  await fire("*/3 * * * *");
  assert.equal(liveHits.page, pages);
  assert.equal(liveDispatches().length, 1);

  await fire("*/30 * * * *");
  assert.equal(dispatches.filter((path) => path.indexOf("/tiktok-added.yml/dispatches") >= 0).length, 1);
  assert.equal(dispatches.filter((path) => path.indexOf("/media-extract.yml/dispatches") >= 0).length, 1);
  assert.equal(liveDispatches().length, 1);
  const after = await call("/v1/health");
  assert.ok(after.body.cron.live >= 3);
  assert.equal(after.body.cron.media, 1);
  assert.ok(after.body.cron.lastLive);
  assert.ok(after.body.cron.lastMedia);
});
