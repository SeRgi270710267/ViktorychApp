import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleSeal, sealText, openSealed, sealKeyBytes, sealDay, fromB64, sealFile, SEAL_KEYS } from "../src/data-seal.js";
import { sealSite } from "../../scripts/seal_data.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("seal keys are per day and need a session", async () => {
  const env = { ACCOUNT_PEPPER: "p1" };
  const anon = await handleSeal(new Request("https://w.test/v1/seal"), env, { json, sessionAccount: async () => null });
  assert.equal(anon.status, 401);
  const none = await handleSeal(new Request("https://w.test/v1/seal"), {}, { json, sessionAccount: async () => ({ id: 1 }) });
  assert.equal(none.status, 404);
  const res = await handleSeal(new Request("https://w.test/v1/seal"), env, { json, sessionAccount: async () => ({ id: 1, owner: 0 }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-store/);
  const body = await res.json();
  const today = sealDay(Date.now());
  assert.equal(Object.keys(body.keys).length, 2);
  assert.ok(body.keys[today]);
  assert.equal(body.use, true);
  const owner = await (await handleSeal(new Request("https://w.test/v1/seal"), env, { json, sessionAccount: async () => ({ id: 1, owner: 1 }) })).json();
  assert.equal(owner.use, false, "the owner keeps reading unstripped catalogs from the API");
  const other = await sealKeyBytes("p2", today);
  assert.notDeepEqual(Array.from(other), Array.from(fromB64(body.keys[today])), "the key depends on the pepper");
});

test("sealed text opens only with the right day key and catalog name", async () => {
  const day = "2026-10-29";
  const doc = await sealText("p1", day, "feeds.json", "{\"a\":1}");
  assert.equal(await openSealed(await sealKeyBytes("p1", day), "feeds.json", doc), "{\"a\":1}");
  await assert.rejects(openSealed(await sealKeyBytes("p1", "2026-10-30"), "feeds.json", doc));
  await assert.rejects(openSealed(await sealKeyBytes("p1", day), "people.json", doc));
});

test("the build seals the reader copy, stripped like the Worker strips it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-"));
  const input = path.join(dir, "in");
  const site = path.join(dir, "site");
  fs.mkdirSync(path.join(input, "data"), { recursive: true });
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(input, "feeds.json"), JSON.stringify({ posts: [{ id: 1 }, { id: 2, ownerOnly: true }, { id: 3, platform: "tiktok" }, { id: 4, url: "https://youtube.com/shorts/x" }] }));
  fs.writeFileSync(path.join(input, "data", "music.json"), "{\"tracks\":[]}");
  fs.writeFileSync(path.join(input, "broken.json"), "{");
  const now = Date.UTC(2026, 9, 29, 22, 0);
  const files = await sealSite(site, input, "p1", "owner", now);
  assert.deepEqual(files, ["feeds.json", "data/music.json"]);
  assert.equal(sealFile("data/music.json"), "sealed/data__music.json");
  const doc = JSON.parse(fs.readFileSync(path.join(site, "sealed", "feeds.json"), "utf8"));
  assert.equal(doc.day, "2026-10-29");
  assert.ok(!fs.readFileSync(path.join(site, "sealed", "feeds.json"), "utf8").includes("posts"), "no plain text on Pages");
  const plain = JSON.parse(await openSealed(await sealKeyBytes("p1", doc.day), "feeds.json", doc));
  assert.deepEqual(plain.posts.map((p) => p.id), [1], "owner-only, TikTok and Shorts items are stripped");
  const all = await sealSite(site, input, "p1", "all", now);
  const doc2 = JSON.parse(fs.readFileSync(path.join(site, "sealed", "feeds.json"), "utf8"));
  const plain2 = JSON.parse(await openSealed(await sealKeyBytes("p1", doc2.day), "feeds.json", doc2));
  assert.deepEqual(plain2.posts.map((p) => p.id), [1, 3], "TikTok shows when the audience is everyone");
  assert.ok(all.length && SEAL_KEYS.includes("feeds.json"));
  const index = JSON.parse(fs.readFileSync(path.join(site, "sealed", "index.json"), "utf8"));
  assert.deepEqual(index.files, ["feeds.json", "data/music.json"]);
});
