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

test("a failed invite lookup does not use up the join cooldown", async () => {
  const env = { DATA: bucket() };
  let hits = 0;
  const rateHit = async () => (++hits > 2 ? { ok: false, retry: 75 } : { ok: true });
  const gone = deps(true, { fetch: async () => json(404, {}), rateHit });
  assert.equal((await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", confirm: true }), env, "/v1/discord/picks/join", gone)).status, 404);
  assert.equal(hits, 0);
  assert.equal(env.DATA.store.has("discord/x/request.json"), false);
});

test("Discord pacing the server is not the owner's cooldown", async () => {
  const env = { DATA: bucket() };
  const busy = async () => new Response("{}", { status: 429, headers: { "retry-after": "12" } });
  const look = await handleDiscordPickRoutes(req("/v1/discord/picks/invite?code=abc"), env, "/v1/discord/picks/invite", deps(true, { fetch: busy }));
  assert.equal(look.status, 503);
  assert.deepEqual(await look.json(), { error: "discord_busy", retry: 12 });
  const noHint = await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", confirm: true }), env, "/v1/discord/picks/join", deps(true, { fetch: busy }));
  assert.equal(noHint.status, 503);
  const ok = await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", guild: G2, name: "Two", confirm: true }), env, "/v1/discord/picks/join", deps(true, { fetch: busy }));
  assert.equal(ok.status, 202);
  assert.equal(JSON.parse(env.DATA.store.get("discord/x/request.json")).join.guild, G2);
});

test("the join cooldown answers with the seconds left", async () => {
  const env = { DATA: bucket() };
  const fake = async () => json(200, { guild: { id: G2, name: "Two" } });
  const res = await handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", confirm: true }), env, "/v1/discord/picks/join", deps(true, { fetch: fake, rateHit: async () => ({ ok: false, retry: 75 }) }));
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "join_cooldown", retry: 75 });
});

test("data keys: messages for signed-in readers, the catalog for the owner", () => {
  assert.equal(privateDiscordKey("discord/x/index.json"), "discord/x/index.json");
  assert.equal(privateDiscordKey("discord/x/messages/" + C(1) + "/p/2.json"), "discord/x/messages/" + C(1) + "/p/2.json");
  assert.equal(privateDiscordKey("discord/x/picks.json"), "");
  assert.equal(privateDiscordKey("discord/x/request.json"), "");
  assert.equal(ownerOnlyDiscordKey("discord/x/catalog.json"), true);
  assert.equal(ownerOnlyDiscordKey("discord/x/index.json"), false);
});

test("health status is owner-readable and never includes a key", async () => {
  const env = { DATA: bucket() };
  env.DATA.store.set("discord/x/health.json", JSON.stringify({ status: "invalid", reason: "unauthorized", keyHash: "abc", at: "2026-01-01T00:00:00Z", token: "nope" }));
  const got = await (await handleDiscordPickRoutes(req("/v1/discord/picks"), env, "/v1/discord/picks", deps(true))).json();
  assert.equal(got.health.status, "invalid");
  assert.equal(got.health.reason, "unauthorized");
  assert.equal(got.health.keyHash, undefined);
  assert.equal(got.health.token, undefined);
});

// A mocked Discord: GET is the public invite lookup, POST is the join.
function mockDiscord(joins) {
  const posts = [];
  const fetch = async (url, init) => {
    if (init && init.method === "POST") {
      posts.push({ url, headers: init.headers });
      const [status, body] = joins.shift();
      return json(status, body);
    }
    return json(200, { guild: { id: G2, name: "Two" } });
  };
  return { fetch, posts };
}
const CAPTCHA = { captcha_key: ["captcha-required"], captcha_sitekey: "site-key-1", captcha_service: "hcaptcha", captcha_rqdata: "rq-data-1", captcha_rqtoken: "rq-token-1", captcha_session_id: "sess-1" };
const keyed = (mock, extra) => deps(true, Object.assign({ fetch: mock.fetch, readKey: async () => ({ value: "owner-key" }) }, extra || {}));
const join = (env, d) => handleDiscordPickRoutes(req("/v1/discord/picks/join", "POST", { code: "abc", confirm: true }), env, "/v1/discord/picks/join", d);
const solve = (env, d, id, solution) => handleDiscordPickRoutes(req("/v1/discord/picks/captcha", "POST", { id, solution: solution || "human-answer", confirm: true }), env, "/v1/discord/picks/captcha", d);

test("the captcha route is owner only", async () => {
  const env = { DATA: bucket() };
  assert.equal((await solve(env, deps(null), "x")).status, 401);
  assert.equal((await solve(env, deps(false), "x")).status, 403);
});

test("a join Discord gates with a captcha is saved privately for the owner", async () => {
  const env = { DATA: bucket() };
  const mock = mockDiscord([[400, CAPTCHA]]);
  const res = await join(env, keyed(mock));
  const body = await res.json();
  assert.equal(res.status, 202);
  assert.equal(body.status, "needs_captcha");
  assert.equal(mock.posts.length, 1);
  assert.equal(mock.posts[0].headers["x-captcha-key"], undefined, "the first try carries no answer");
  assert.equal(body.captcha.sitekey, "site-key-1");
  assert.equal(body.captcha.rqdata, "rq-data-1");
  assert.equal(body.captcha.rqtoken, undefined, "the rqtoken stays server side");
  const saved = JSON.parse(env.DATA.store.get("discord/x/captcha.json"));
  assert.equal(saved.rqtoken, "rq-token-1");
  assert.equal(saved.used, false);
  assert.equal(JSON.parse(env.DATA.store.get("discord/x/join.json")).status, "needs_captcha");
  const got = await (await handleDiscordPickRoutes(req("/v1/discord/picks"), env, "/v1/discord/picks", keyed(mock))).json();
  assert.equal(got.join.captcha.sitekey, "site-key-1");
});

test("the owner's answer is sent once with Discord's captcha headers", async () => {
  const env = { DATA: bucket() };
  const mock = mockDiscord([[400, CAPTCHA], [200, { guild: { id: G2, name: "Two" } }]]);
  const first = await (await join(env, keyed(mock))).json();
  assert.equal((await solve(env, keyed(mock), first.id, "bad answer!")).status, 400, "a malformed answer is refused");
  const res = await solve(env, keyed(mock), first.id);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "joined");
  assert.equal(mock.posts.length, 2);
  const h = mock.posts[1].headers;
  assert.equal(h["x-captcha-key"], "human-answer");
  assert.equal(h["x-captcha-rqtoken"], "rq-token-1");
  assert.equal(h["x-captcha-session-id"], "sess-1");
  assert.equal(JSON.parse(env.DATA.store.get("discord/x/captcha.json")).used, true);
  assert.equal(JSON.parse(env.DATA.store.get("discord/x/request.json")).join.by, "worker", "the sync lists the server and does not join again");
  const again = await solve(env, keyed(mock), first.id);
  assert.equal(again.status, 409, "one join per solution");
  assert.equal(mock.posts.length, 2);
});

test("an expired check is not sent to Discord", async () => {
  const env = { DATA: bucket() };
  const mock = mockDiscord([[400, CAPTCHA]]);
  const first = await (await join(env, keyed(mock))).json();
  const doc = JSON.parse(env.DATA.store.get("discord/x/captcha.json"));
  env.DATA.store.set("discord/x/captcha.json", JSON.stringify(Object.assign(doc, { at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })));
  assert.equal((await solve(env, keyed(mock), first.id)).status, 410);
  assert.equal((await solve(env, keyed(mock), "other")).status, 404);
  assert.equal(mock.posts.length, 1);
});

test("a rejected answer gives a fresh check and is not retried", async () => {
  const env = { DATA: bucket() };
  const fresh = Object.assign({}, CAPTCHA, { captcha_rqdata: "rq-data-2", captcha_rqtoken: "rq-token-2" });
  const mock = mockDiscord([[400, CAPTCHA], [400, fresh]]);
  const first = await (await join(env, keyed(mock))).json();
  const body = await (await solve(env, keyed(mock), first.id)).json();
  assert.equal(body.status, "captcha_failed");
  assert.equal(body.captcha.rqdata, "rq-data-2");
  assert.equal(mock.posts.length, 2);
  const saved = JSON.parse(env.DATA.store.get("discord/x/captcha.json"));
  assert.equal(saved.used, false);
  assert.equal(saved.rqtoken, "rq-token-2");
});

test("without a key here the answer goes to the sync, once", async () => {
  const env = { DATA: bucket() };
  const mock = mockDiscord([[400, CAPTCHA]]);
  const first = await (await join(env, keyed(mock))).json();
  const noKey = deps(true, { fetch: mock.fetch });
  const res = await solve(env, noKey, first.id);
  assert.equal(res.status, 202);
  const ask = JSON.parse(env.DATA.store.get("discord/x/request.json"));
  assert.equal(ask.join.captcha.key, "human-answer");
  assert.equal(ask.join.captcha.rqtoken, "rq-token-1");
  assert.equal(mock.posts.length, 1, "the Worker sent nothing itself");
  assert.equal((await solve(env, noKey, first.id)).status, 409);
});

test("a rejected key is marked for replacing", async () => {
  const env = { DATA: bucket() };
  const marks = [];
  const mock = mockDiscord([[401, { message: "401: Unauthorized", code: 0 }]]);
  const body = await (await join(env, keyed(mock, { markKey: async (e, reason) => marks.push(reason) }))).json();
  assert.equal(body.status, "unauthorized");
  assert.deepEqual(marks, ["unauthorized"]);
});
