import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { buildPlaylist, parseRange, safeTelegramPath } from "../src/telegram.js";

const BOT = "123456:probe-token";

function workerOptions(extra) {
  return {
    modules: true,
    scriptPath: new URL("../src/index.js", import.meta.url).pathname,
    modulesRoot: new URL("../..", import.meta.url).pathname,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }, extra || {}),
    outboundService(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/getFile")) {
        const id = url.searchParams.get("file_id") || "";
        if (id === "BAD") {
          return Response.json({ ok: true, result: { file_path: "https://evil.example/secret" } });
        }
        return Response.json({ ok: true, result: { file_path: "documents/" + id } });
      }
      if (url.pathname.includes("/file/bot")) {
        return new Response(new Uint8Array([9, 8, 7, 6]), { headers: { "content-type": "image/jpeg" } });
      }
      return new Response("missing", { status: 404 });
    }
  };
}

async function call(mf, path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.80");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.range) headers.set("Range", opts.range);
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers });
  const bytes = new Uint8Array(await res.arrayBuffer());
  let body = null;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (err) { body = null; }
  return { status: res.status, body, bytes, headers: res.headers };
}

test("playlist, range, and telegram paths", () => {
  const text = buildPlaylist([
    { kind: "segment", part_index: 1, duration: 4.5 },
    { kind: "init", part_index: -1 },
    { kind: "segment", part_index: 0, duration: 5 }
  ], "clips/a b.mp4", "https://accounts.test");
  assert.match(text, /#EXT-X-VERSION:7/);
  assert.match(text, /#EXT-X-MAP:URI="https:\/\/accounts\.test\/tg\/clips\/a%20b\.mp4\/init"/);
  assert.match(text, /https:\/\/accounts\.test\/tg\/clips\/a%20b\.mp4\/0/);
  assert.match(text, /https:\/\/accounts\.test\/tg\/clips\/a%20b\.mp4\/1/);
  assert.equal(buildPlaylist([], "a", "https://accounts.test"), "");
  assert.deepEqual(parseRange("", 4), null);
  assert.deepEqual(parseRange("bytes=1-2", 4), { start: 1, end: 2 });
  assert.equal(parseRange("bytes=9-10", 4), false);
  assert.equal(safeTelegramPath("documents/file_0.jpg"), "documents/file_0.jpg");
  assert.equal(safeTelegramPath("../secret"), "");
  assert.equal(safeTelegramPath("https://evil.example/x"), "");
  assert.equal(safeTelegramPath("/etc/passwd"), "");
});

test("telegram media requires a session and a worker secret", async () => {
  const plain = new Miniflare(workerOptions());
  try {
    const anon = await call(plain, "/tg/photos/a.jpg", { ip: "203.0.113.81" });
    assert.equal(anon.status, 401);
    assert.equal(anon.body.error, "unauthorized");

    const signup = await plain.dispatchFetch("https://accounts.test/v1/signup", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "203.0.113.82",
        "content-type": "application/json"
      },
      body: JSON.stringify({ displayName: "Ada Lovelace", handle: "ada_tg" })
    });
    const session = await signup.json();
    assert.equal(signup.status, 201);
    const missing = await call(plain, "/tg/photos/a.jpg", { ip: "203.0.113.83", token: session.token });
    assert.equal(missing.status, 503);
    assert.equal(missing.body.error, "not_configured");
    const loopMissing = await call(plain, "/tg/loop/v1/index.m3u8", { ip: "203.0.113.84" });
    assert.equal(loopMissing.status, 503);
    assert.equal(loopMissing.body.error, "not_configured");
  } finally {
    await plain.dispose();
  }
});

test("a signed-in viewer receives a ranged telegram file and a playlist", async () => {
  const mf = new Miniflare(workerOptions({ TELEGRAM_BOT_TOKEN: BOT }));
  try {
    const signup = await mf.dispatchFetch("https://accounts.test/v1/signup", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.90", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Grace Hopper", handle: "grace_tg" })
    });
    const session = await signup.json();
    assert.equal(signup.status, 201);
    const db = await mf.getBindings();
    await db.DB.prepare(
      "INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) VALUES (?, 'single', 0, 'viktorych-data', 'PHOTO', 1, 4, 'abc', 'image/jpeg', 0, 1, 1, 0, 1)"
    ).bind("photos/a.jpg").run();
    await db.DB.prepare(
      "INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) VALUES (?, 'single', 0, 'viktorych-data', 'HIDDEN', 1, 4, 'abc', 'image/jpeg', 0, 0, 1, 1, 1)"
    ).bind("secret/hidden.jpg").run();
    for (const row of [
      ["clips/a.mp4", "init", -1, "INIT", 0],
      ["clips/a.mp4", "segment", 0, "SEG0", 5],
      ["clips/a.mp4", "segment", 1, "SEG1", 4.5]
    ]) {
      await db.DB.prepare(
        "INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) VALUES (?, ?, ?, 'viktorych-data', ?, 2, 4, 'abc', 'video/iso.segment', ?, 1, 1, 0, 1)"
      ).bind(row[0], row[1], row[2], row[3], row[4]).run();
    }

    const anon = await call(mf, "/tg/photos/a.jpg", { ip: "203.0.113.91" });
    assert.equal(anon.status, 401);

    const full = await call(mf, "/tg/photos/a.jpg", { ip: "203.0.113.92", token: session.token });
    assert.equal(full.status, 200);
    assert.deepEqual(Array.from(full.bytes), [9, 8, 7, 6]);
    assert.match(full.headers.get("content-type") || "", /image\/jpeg/);
    assert.match(full.headers.get("cache-control") || "", /max-age=31536000/);

    const ranged = await call(mf, "/tg/photos/a.jpg", { ip: "203.0.113.93", token: session.token, range: "bytes=1-2" });
    assert.equal(ranged.status, 206);
    assert.deepEqual(Array.from(ranged.bytes), [8, 7]);
    assert.match(ranged.headers.get("content-range") || "", /bytes 1-2\/4/);

    const badRange = await call(mf, "/tg/photos/a.jpg", { ip: "203.0.113.94", token: session.token, range: "bytes=9-10" });
    assert.equal(badRange.status, 416);

    const hidden = await call(mf, "/tg/secret/hidden.jpg", { ip: "203.0.113.95", token: session.token });
    assert.equal(hidden.status, 404);

    const bad = await call(mf, "/tg/photos/bad.jpg", { ip: "203.0.113.96", token: session.token });
    assert.equal(bad.status, 404);

    const playlist = await call(mf, "/tg/clips/a.mp4/index.m3u8", { ip: "203.0.113.97", token: session.token });
    assert.equal(playlist.status, 200);
    const text = new TextDecoder().decode(playlist.bytes);
    assert.match(text, /#EXTM3U/);
    assert.match(text, /\/tg\/clips\/a\.mp4\/init/);
    assert.match(text, /\/tg\/clips\/a\.mp4\/0/);
    assert.match(text, /\/tg\/clips\/a\.mp4\/1/);
    assert.match(playlist.headers.get("content-type") || "", /mpegurl/);

    const segment = await call(mf, "/tg/clips/a.mp4/0", { ip: "203.0.113.98", token: session.token });
    assert.equal(segment.status, 200);
    assert.equal(segment.bytes.byteLength, 4);

    const unsafe = await call(mf, "/tg/%2e%2e", { ip: "203.0.113.99", token: session.token });
    assert.equal(unsafe.status, 404);
  } finally {
    await mf.dispose();
  }
});

test("the radio loop playlist is public and immutable", async () => {
  const mf = new Miniflare(workerOptions({ TELEGRAM_BOT_TOKEN: BOT }));
  try {
    await mf.dispatchFetch("https://accounts.test/v1/health", { headers: { "CF-Connecting-IP": "203.0.113.71" } });
    const db = await mf.getBindings();
    const insert = "INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) VALUES (?, ?, ?, 'viktorych-data', ?, 3, 4, 'abc', 'video/iso.segment', ?, 1, 1, 0, 1)";
    for (const row of [
      ["loop/v1", "init", -1, "LOOPINIT", 0],
      ["loop/v1", "segment", 0, "LOOP0", 10.031],
      ["loop/v1", "segment", 1, "LOOP1", 10],
      ["loop/v1/aac", "segment", 0, "AACAAC0", 10]
    ]) {
      await db.DB.prepare(insert).bind(row[0], row[1], row[2], row[3], row[4]).run();
    }

    const playlist = await call(mf, "/tg/loop/v1/index.m3u8", { ip: "203.0.113.72" });
    assert.equal(playlist.status, 200);
    const text = new TextDecoder().decode(playlist.bytes);
    assert.match(text, /#EXT-X-VERSION:7/);
    assert.match(text, /\/tg\/loop\/v1\/init/);
    assert.match(text, /\/tg\/loop\/v1\/0/);
    assert.match(text, /\/tg\/loop\/v1\/1/);
    assert.match(text, /#EXTINF:10\.031,/);
    assert.match(playlist.headers.get("cache-control") || "", /immutable/);
    assert.match(playlist.headers.get("cdn-cache-control") || "", /immutable/);

    const segment = await call(mf, "/tg/loop/v1/0", { ip: "203.0.113.73" });
    assert.equal(segment.status, 200);
    assert.match(segment.headers.get("cache-control") || "", /immutable/);
    assert.match(segment.headers.get("cdn-cache-control") || "", /immutable/);

    const aac = await call(mf, "/tg/loop/v1/aac/index.m3u8", { ip: "203.0.113.74" });
    assert.equal(aac.status, 200);
    const aacText = new TextDecoder().decode(aac.bytes);
    assert.match(aacText, /#EXT-X-VERSION:3/);
    assert.match(aacText, /\/tg\/loop\/v1\/aac\/0/);
    assert.doesNotMatch(aacText, /EXT-X-MAP/);

    const photos = await call(mf, "/tg/photos/a.jpg", { ip: "203.0.113.75" });
    assert.equal(photos.status, 401);
  } finally {
    await mf.dispose();
  }
});
