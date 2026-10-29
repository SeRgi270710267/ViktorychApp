import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

// The Telegram backup is the last source: a feed snapshot and an upload are
// read from it only after R2 (and lastgood/ for catalogs) fail.
const BOT = "123456:probe-token";
const SNAP = JSON.stringify({ feeds: [{ id: "f1", name: "Feed" }], posts: [{ id: "p1", feed: "f1", text: "from telegram" }] });

function workerOptions() {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      TELEGRAM_BOT_TOKEN: BOT
    },
    outboundService(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/getFile")) {
        return Response.json({ ok: true, result: { file_path: "documents/" + (url.searchParams.get("file_id") || "") } });
      }
      if (url.pathname.endsWith("/documents/SNAP")) return new Response(SNAP, { headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/documents/UPLOAD")) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/jpeg" } });
      return new Response("missing", { status: 404 });
    }
  };
}

async function call(mf, path, token, ip) {
  const headers = new Headers({ "CF-Connecting-IP": ip || "203.0.113.120" });
  if (token) headers.set("Authorization", "Bearer " + token);
  const res = await mf.dispatchFetch("https://accounts.test" + path, { headers });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, bytes, text: new TextDecoder().decode(bytes) };
}

const ROW = "INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) VALUES (?, 'single', 0, ?, ?, 1, ?, ?, ?, 0, 1, 0, 0, 1)";

test("a feed snapshot and an upload come from Telegram only when R2 has nothing", async () => {
  const mf = new Miniflare(workerOptions());
  try {
    const signup = await mf.dispatchFetch("https://accounts.test/v1/signup", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.121", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Fallback Reader", handle: "fallback_tg" })
    });
    assert.equal(signup.status, 201);
    const session = await signup.json();
    const env = await mf.getBindings();
    await env.DB.prepare(ROW).bind("snap/feeds.json", "snap", "SNAP", SNAP.length, "snap-sha", "application/json").run();

    const feed = await call(mf, "/v1/data/feeds.json", session.token, "203.0.113.122");
    assert.equal(feed.status, 200, feed.text);
    assert.equal(JSON.parse(feed.text).posts[0].text, "from telegram");
    const restored = await env.DATA.get("feeds.json");
    assert.ok(restored, "the snapshot is written back to R2");

    // A newer R2 copy wins over the snapshot.
    await env.DATA.put("feeds.json", JSON.stringify({ feeds: [{ id: "f1" }], posts: [{ id: "p2", feed: "f1", text: "from r2" }] }));
    const live = await call(mf, "/v1/data/feeds.json", session.token, "203.0.113.123");
    assert.equal(JSON.parse(live.text).posts[0].text, "from r2");

    // Snapshots and uploads are not readable on /tg; their own routes check access.
    assert.equal((await call(mf, "/tg/snap/feeds.json", session.token, "203.0.113.124")).status, 404);
    assert.equal((await call(mf, "/tg/post-media/abc.jpg", session.token, "203.0.113.125")).status, 404);

    const author = session.account.publicId;
    const postId = "a".repeat(32);
    const mediaId = "b".repeat(32);
    await env.DB.prepare("INSERT INTO public_posts (id, author_id, body, created_at) VALUES (?, ?, 'hi', ?)").bind(postId, author, Date.now()).run();
    await env.DB.prepare("INSERT INTO public_post_media (id, post_id, object_key, mime, size) VALUES (?, ?, ?, 'image/jpeg', 4)").bind(mediaId, postId, "post-media/" + mediaId + ".jpg").run();
    const missing = await call(mf, "/v1/posts/media/" + mediaId, session.token, "203.0.113.126");
    assert.equal(missing.status, 404, "no R2 object and no Telegram copy");
    await env.DB.prepare(ROW).bind("post-media/" + mediaId + ".jpg", "viktorych-data", "UPLOAD", 4, "upload-sha", "image/jpeg").run();
    const media = await call(mf, "/v1/posts/media/" + mediaId, session.token, "203.0.113.127");
    assert.equal(media.status, 200);
    assert.deepEqual(Array.from(media.bytes), [1, 2, 3, 4]);
  } finally {
    await mf.dispose();
  }
});
