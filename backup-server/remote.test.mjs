import assert from "node:assert/strict";
import {
  createCloudflareClient,
  createD1,
  createR2,
  createMemoryCache,
  resolveD1DatabaseId,
  CloudflareError
} from "./cloudflare.mjs";

const calls = [];

function fakeFetch(url, init) {
  const request = { url: String(url), method: (init && init.method) || "GET", headers: (init && init.headers) || {}, body: init && init.body };
  calls.push(request);
  const parsed = new URL(request.url);
  const path = parsed.pathname;

  if (path.endsWith("/d1/database") || path.endsWith("/d1/database/")) {
    return Promise.resolve(jsonResponse({ success: true, result: [{ name: "other" }, { name: "viktorych-accounts", uuid: "11111111-2222-3333-4444-555555555555" }] }));
  }

  if (path.endsWith("/d1/database/db-test/query")) {
    const payload = JSON.parse(String(request.body));
    if (Array.isArray(payload.batch)) {
      return Promise.resolve(jsonResponse({
        success: true,
        result: payload.batch.map((item, index) => ({
          success: true,
          results: [{ sql: item.sql, params: item.params }],
          meta: { changes: index }
        }))
      }));
    }
    if (!payload.sql) return Promise.resolve(jsonResponse({ success: false, errors: [{ code: 1, message: "no sql" }] }, 400));
    return Promise.resolve(jsonResponse({
      success: true,
      result: [{ success: true, results: [{ public_id: "u1", sql: payload.sql, params: payload.params }], meta: { changes: 1 } }]
    }));
  }

  if (path.includes("/r2/buckets/viktorych-data/objects")) {
    const key = decodeURIComponent(path.split("/objects/")[1] || "");
    if (!path.includes("/objects/")) {
      const prefix = parsed.searchParams.get("prefix") || "";
      if (prefix === "owner/missing.json") return Promise.resolve(jsonResponse({ success: true, result: [], result_info: {} }));
      return Promise.resolve(jsonResponse({
        success: true,
        result: [{ key: prefix || "owner/tiktok.json", size: 12, etag: "abc", http_metadata: { contentType: "application/json" }, last_modified: "2026-01-01T00:00:00Z" }],
        result_info: {}
      }));
    }
    if (request.method === "PUT") {
      return Promise.resolve(new Response("", { status: 200, headers: { etag: '"put-etag"' } }));
    }
    if (request.method === "DELETE") {
      return Promise.resolve(new Response("", { status: 200 }));
    }
    return Promise.resolve(new Response("hello world!", { status: 200, headers: { "content-type": "text/plain", etag: '"get-etag"' } }));
  }

  return Promise.resolve(new Response("not found", { status: 404 }));
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
}

const client = createCloudflareClient({ token: "token", accountId: "acct", fetchImpl: fakeFetch });

console.log("[test] resolve D1 database by name");
const databaseId = await resolveD1DatabaseId(client, "viktorych-accounts");
assert.equal(databaseId, "11111111-2222-3333-4444-555555555555");

console.log("[test] D1 first/all/batch");
const db = createD1(client, "db-test");
const first = await db.prepare("SELECT * FROM accounts WHERE public_id = ?").bind("u1", undefined, true).first();
assert.equal(first.public_id, "u1");
assert.deepEqual(first.params, ["u1", null, 1]);
assert.equal(await db.prepare("SELECT 1").first("nope"), null);

const all = await db.prepare("SELECT * FROM sessions").all();
assert.equal(all.results.length, 1);
assert.equal(all.success, true);

const batch = await db.batch([
  db.prepare("CREATE TABLE a (id TEXT)"),
  db.prepare("INSERT INTO a VALUES (?)").bind("x")
]);
assert.equal(batch.length, 2);
assert.equal(batch[1].results[0].params[0], "x");

console.log("[test] D1 reports API errors");
const badClient = createCloudflareClient({
  token: "token",
  accountId: "acct",
  fetchImpl: () => Promise.resolve(jsonResponse({ success: false, errors: [{ code: 7000, message: "no such table" }] }, 400))
});
await assert.rejects(() => createD1(badClient, "db-test").prepare("SELECT * FROM nope").first(), (err) => {
  assert.ok(err instanceof CloudflareError);
  assert.match(err.message, /no such table/);
  return true;
});

console.log("[test] R2 head/get/put/delete");
const r2 = createR2(client, "viktorych-data");
const head = await r2.head("owner/tiktok.json");
assert.equal(head.size, 12);
assert.equal(head.httpMetadata.contentType, "application/json");
assert.equal(await r2.head("owner/missing.json"), null);

const object = await r2.get("owner/tiktok.json");
assert.equal(await object.text(), "hello world!");
assert.equal(object.size, 12);
assert.equal(object.httpMetadata.contentType, "text/plain");
assert.equal(await r2.get("owner/tiktok.json", { range: { offset: 6, length: 5 } }).then((item) => item.text()), "world");

const put = await r2.put("owner/tiktok.json", "{\"a\":1}", { httpMetadata: { contentType: "application/json" } });
assert.equal(put.size, 7);
assert.equal(put.etag, "put-etag");
const putCall = calls.filter((call) => call.method === "PUT").pop();
assert.equal(putCall.headers["content-type"], "application/json");
await r2.delete("owner/tiktok.json");

console.log("[test] memory cache");
const cache = createMemoryCache();
const request = new Request("https://cache.test/a");
assert.equal(await cache.default.match(request), undefined);
await cache.default.put(request, new Response("cached"));
const hit = await cache.default.match(request);
assert.equal(await hit.text(), "cached");

console.log("[test] ALL CLOUDFLARE BACKUP TESTS PASSED!");
