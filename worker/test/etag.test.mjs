import assert from "node:assert/strict";
import test from "node:test";
import { withEtag } from "../src/index.js";

const jsonRes = (body, headers) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...(headers || {}) } });
const get = (path, headers) => new Request("https://accounts.test" + path, { headers: headers || {} });

test("JSON reads get an ETag and answer 304 when it comes back", async () => {
  const first = await withEtag(get("/v1/live"), jsonRes({ lives: [1] }, { "cache-control": "no-store" }));
  const tag = first.headers.get("etag");
  assert.match(tag, /^W\/"[0-9a-f]{20}"$/);
  assert.deepEqual(await first.json(), { lives: [1] });
  assert.equal(first.headers.get("cache-control"), "no-store", "other headers stay");

  const again = await withEtag(get("/v1/live", { "If-None-Match": tag }), jsonRes({ lives: [1] }));
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  assert.equal(again.headers.get("etag"), tag);

  const changed = await withEtag(get("/v1/live", { "If-None-Match": tag }), jsonRes({ lives: [2] }));
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), tag);
});

test("writes, errors, non-JSON and non-API paths are left alone", async () => {
  const post = new Request("https://accounts.test/v1/live", { method: "POST", body: "{}" });
  assert.equal((await withEtag(post, jsonRes({ ok: 1 }))).headers.get("etag"), null);
  const err = new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  assert.equal((await withEtag(get("/v1/x"), err)).headers.get("etag"), null);
  const media = new Response("bytes", { status: 200, headers: { "content-type": "image/webp" } });
  assert.equal((await withEtag(get("/v1/media/view/x"), media)).headers.get("etag"), null);
  assert.equal((await withEtag(get("/tg/a.json"), jsonRes({ a: 1 }))).headers.get("etag"), null);
  const own = jsonRes({ a: 1 }, { etag: '"keep"' });
  assert.equal((await withEtag(get("/v1/pills"), own)).headers.get("etag"), '"keep"');
});
