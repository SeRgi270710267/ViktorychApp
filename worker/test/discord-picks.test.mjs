import assert from "node:assert/strict";
import test from "node:test";
import { handleDiscordPickRoutes, cleanPicks, cleanCatalog, inviteCode, privateDiscordKey, ownerOnlyDiscordKey, MAX_CHANNELS } from "../src/discord-picks.js";

// Synthetic ids only.
const G1 = "100000000000000001";
const G2 = "100000000000000002";
const C = (n) => String(200000000000000000n + BigInt(n));

function bucket() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? { text: async () => store.get(key) } : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k)); }
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const readJson = async (request) => { const t = await request.text(); try { return t ? JSON.parse(t) : {}; } catch (e) { return { error: "bad_json" }; } };
function deps(owner, extra) {
  return Object.assign({ json, readJson, sessionAccount: async () => (owner == null ? null : { public_id: "000000000001", owner: owner ? 1 : 0 }) }, extra || {});
}
const req = (path, method, body) => new Request("https://accounts.test" + path, { method: method || "GET", body: body && method && method !== "GET" ? JSON.stringify(body) : undefined });

const catalog = {
  fetchedAt: "2026-01-01T00:00:00Z",
  servers: [
    { id: G1, name: "One", icon: "https://cdn.discordapp.com/icons/x/y.png", channels: [{ id: C(1), name: "general", kind: "text" }, { id: C(2), name: "news", kind: "announcement" }] },
    { id: G2, name: "Two", channels: [{ id: C(3), name: "chat" }] }
  ]
};

test("every route is owner only", async () => {
  const env = { DATA: bucket() };
  for (const [path, method] of [["/v1/discord/picks", "GET"], ["/v1/discord/picks", "PUT"], ["/v1/discord/picks/refresh", "POST"], ["/v1/discord/picks/invite?code=abc", "GET"], ["/v1/discord/picks/join", "POST"]]) {
    const p = path.split("?")[0];
    assert.equal((await handleDiscordPickRoutes(req(path, method, {}), env, p, deps(null))).status, 401, path);
    assert.equal((await handleDiscordPickRoutes(req(path, method, {}), env, p, deps(false))).status, 403, path);
  }
  assert.equal(await handleDiscordPickRoutes(req("/v1/discord/x"), env, "/v1/discord/x", deps(true)), null);
});

test("picks are checked against the catalog, kept in order and capped", async () => {
  const env = { DATA: bucket() };
  assert.equal((await handleDiscordPickRoutes(req("/v1/discord/picks", "PUT", { servers: [] }), env, "/v1/discord/picks", deps(true))).status, 409);
  env.DATA.store.set("discord/x/catalog.json", JSON.stringify(catalog));
  const res = await handleDiscordPickRoutes(req("/v1/discord/picks", "PUT", { servers: [{ id: G2, channels: [C(3)] }, { id: G1, channels: [C(2), "999999999999999999", C(2)] }, { id: "100000000000000009", channels: [C(9)] }] }), env, "/v1/discord/picks", deps(true));
  assert.equal(res.status, 200);
  const saved = JSON.parse(env.DATA.store.get("discord/x/picks.json"));
  assert.deepEqual(saved.servers.map((s) => s.id), [G2, G1]);
  assert.deepEqual(saved.servers[1].channels.map((c) => c.id), [C(2)]);
  env.DATA.store.set("discord/x/messages/" + C(3) + ".json", "{}");
  await handleDiscordPickRoutes(req("/v1/discord/picks", "PUT", { servers: [{ id: G1, channels: [C(1)] }] }), env, "/v1/discord/picks", deps(true));
  assert.equal(env.DATA.store.has("discord/x/messages/" + C(3) + ".json"), false, "a removed channel loses its copy");
  const many = { servers: [{ id: G1, channels: Array.from({ length: 80 }, (_, i) => C(i + 1)) }] };
  const big = cleanCatalog({ servers: [{ id: G1, channels: Array.from({ length: 80 }, (_, i) => ({ id: C(i + 1), name: "c" })) }] });
  assert.equal(cleanPicks(many, big).servers[0].channels.length, MAX_CHANNELS);
  const got = await (await handleDiscordPickRoutes(req("/v1/discord/picks"), env, "/v1/discord/picks", deps(true))).json();
  assert.equal(got.catalog.servers.length, 2);
  assert.equal(got.picks.servers[0].id, G1);
});

test("invite links parse and the preview uses the public lookup", async () => {
  assert.equal(inviteCode("https://discord.gg/AbC-12"), "AbC-12");
  assert.equal(inviteCode("discord.com/invite/xyz99?event=1"), "xyz99");
  assert.equal(inviteCode("https://evil.test/invite/xyz"), "");
  const env = { DATA: bucket() };
  env.DATA.store.set("discord/x/catalog.json", JSON.stringify(catalog));
  let seen = null;
  const fake = async (url, init) => { seen = { url, init }; return json(200, { guild: { id: G1, name: "One", icon: "abc" }, approximate_member_count: 12, approximate_presence_count: 3 }); };
  const res = await handleDiscordPickRoutes(req("/v1/discord/picks/invite?code=AbC-12"), env, "/v1/discord/picks/invite", deps(true, { fetch: fake }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(seen.url, /^https:\/\/discord\.com\/api\/v10\/invites\/AbC-12\?with_counts=true$/);
  assert.equal(seen.init.method, undefined, "a GET");
  assert.equal(seen.init.headers.authorization, undefined, "no token");
  assert.equal(body.guild.name, "One");
  assert.equal(body.joined, true);
  assert.equal(body.url, "https://discord.gg/AbC-12");
});

test("a join needs a confirm, is one invite, and is queued for the sync", async () => {
  const env = { DATA: bucket() };
  const fake = async () => json(200, { guild: { id: G2, name: "Two" } });
  const d = deps(true, { fetch: fake });
  assert.equal((await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc" }), env, "/v1/discord/picks/join", d)).status, 400);
  const res = await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", confirm: true }), env, "/v1/discord/picks/join", d);
  assert.equal(res.status, 202);
  const ask = JSON.parse(env.DATA.store.get("discord/x/request.json"));
  assert.equal(ask.join.code, "abc");
  assert.equal(ask.guild, G2);
  const got = await (await handleDiscordPickRoutes(req("/v1/discord/picks"), env, "/v1/discord/picks", d)).json();
  assert.equal(got.join.status, "pending");
  env.DATA.store.set("discord/x/join.json", JSON.stringify({ id: ask.join.id, status: "captcha" }));
  const after = await (await handleDiscordPickRoutes(req("/v1/discord/picks"), env, "/v1/discord/picks", d)).json();
  assert.equal(after.join.status, "captcha");
  let hits = 0;
  const gated = deps(true, { fetch: fake, rateHit: async () => (++hits > 1 ? { ok: false, retry: 60 } : { ok: true }), limited: () => json(429, { error: "rate_limited" }) });
  assert.equal((await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", confirm: true }), env, "/v1/discord/picks/join", gated)).status, 429);
});

test("data keys: messages for signed-in readers, the catalog for the owner", () => {
  assert.equal(privateDiscordKey("discord/x/index.json"), "discord/x/index.json");
  assert.equal(privateDiscordKey("discord/x/messages/" + C(1) + "/p/2.json"), "discord/x/messages/" + C(1) + "/p/2.json");
  assert.equal(privateDiscordKey("discord/x/picks.json"), "");
  assert.equal(privateDiscordKey("discord/x/request.json"), "");
  assert.equal(ownerOnlyDiscordKey("discord/x/catalog.json"), true);
  assert.equal(ownerOnlyDiscordKey("discord/x/index.json"), false);
});
