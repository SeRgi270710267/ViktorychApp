import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const STATE = { calls: 0, down: false };
const EMPTY_QUERY = createHash("sha256").update("").digest("hex").slice(0, 16);

function workerOptions(extra) {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    r2Buckets: ["DATA"],
    bindings: Object.assign(
      { ALLOWED_ORIGINS: "https://viktorychgroup.github.io" },
      extra || {}
    ),
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.hostname !== "api.fxtwitter.com") return new Response("no", { status: 404 });
      STATE.calls += 1;
      if (STATE.down) return new Response("bad gateway", { status: 502 });
      const handle = url.pathname.split("/")[3] || "";
      return new Response(
        JSON.stringify({
          code: 200,
          results: [{ id: "1900000000000000001", text: handle, author: { screen_name: handle } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  };
}

function get(mf, path, headers) {
  return mf.dispatchFetch("https://accounts.test" + path, { headers: headers || {} });
}

test("the cached mirror serves one upstream fetch to two runs", async () => {
  STATE.calls = 0;
  STATE.down = false;
  const mf = new Miniflare(workerOptions());
  try {
    const first = await get(mf, "/v1/x/2/profile/NASA/statuses");
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-cache"), "miss");
    const body = await first.json();
    assert.equal(body.results[0].author.screen_name, "NASA");
    assert.equal(STATE.calls, 1);

    const second = await get(mf, "/v1/x/2/profile/NASA/statuses");
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("x-cache"), "fresh");
    assert.equal(STATE.calls, 1, "the second run reads the stored copy");

    const replies = await get(mf, "/v1/x/2/profile/NASA/statuses?with_replies=1");
    assert.equal(replies.status, 200);
    assert.equal(replies.headers.get("x-cache"), "miss");
    assert.equal(STATE.calls, 2, "a different query is a different cache entry");

    const articles = await get(mf, "/v1/x/2/profile/NASA/articles?count=10");
    assert.equal(articles.status, 200);
    assert.equal(STATE.calls, 3, "the articles page is mirrored too");
  } finally {
    await mf.dispose();
  }
});

test("a failed upstream returns the last good copy", async () => {
  STATE.calls = 0;
  STATE.down = false;
  const mf = new Miniflare(workerOptions());
  try {
    const bucket = await mf.getR2Bucket("DATA");
    const old = String(Date.now() - 15 * 60 * 1000);
    const key = `x-cache/blocked/statuses-${EMPTY_QUERY}.json`;
    await bucket.put(key, JSON.stringify({ code: 200, results: [{ id: "1", text: "kept" }] }), {
      customMetadata: { fetchedAt: old }
    });

    STATE.down = true;
    const stale = await get(mf, "/v1/x/2/profile/blocked/statuses");
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get("x-cache"), "stale");
    const body = await stale.json();
    assert.equal(body.results[0].text, "kept");

    const nothing = await get(mf, "/v1/x/2/profile/never/statuses");
    assert.equal(nothing.status, 502);
    assert.equal(nothing.headers.get("x-cache"), "none");
  } finally {
    await mf.dispose();
  }
});

test("the mirror only accepts profile paths and a GET", async () => {
  STATE.calls = 0;
  STATE.down = false;
  const mf = new Miniflare(workerOptions());
  try {
    const notAProfile = await get(mf, "/v1/x/2/users/by/username/NASA");
    assert.equal(notAProfile.status, 404);
    const traversal = await get(mf, "/v1/x/2/profile/../../oauth/statuses");
    assert.equal(traversal.status, 404);
    const post = await mf.dispatchFetch("https://accounts.test/v1/x/2/profile/NASA/statuses", { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(STATE.calls, 0, "a rejected request never reaches fxtwitter");
  } finally {
    await mf.dispose();
  }
});

test("a shared secret gates the mirror when one is configured", async () => {
  STATE.calls = 0;
  STATE.down = false;
  const mf = new Miniflare(workerOptions({ X_PROXY_TOKEN: "mirror-test" }));
  try {
    const denied = await get(mf, "/v1/x/2/profile/NASA/statuses");
    assert.equal(denied.status, 401);
    const allowed = await get(mf, "/v1/x/2/profile/NASA/statuses", { "X-Viktorych-Token": "mirror-test" });
    assert.equal(allowed.status, 200);
    assert.equal(STATE.calls, 1);
  } finally {
    await mf.dispose();
  }
});
