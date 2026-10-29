import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const dispatches = [];
const hosts = [];

let mf;

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
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    async outboundService(request) {
      const url = new URL(request.url);
      hosts.push(url.hostname);
      if (url.hostname === "api.github.com") {
        dispatches.push(url.pathname);
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
  return { status: res.status, body, text };
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
});

test.after(async () => {
  if (mf) await mf.dispose();
});

async function signup(n, displayName, handle) {
  const res = await call("/v1/signup", { method: "POST", ip: "203.0.113." + n, body: { displayName, handle } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}


const IP = { n: 10 };
function ip() { IP.n += 1; return "198.51.100." + (IP.n % 250); }
function get(path, token) { return call(path, { ip: ip(), token }); }
function send(path, method, token, body) { return call(path, { method, ip: ip(), token, body }); }


test("pickPolicy: every audience and allow/block combination", async () => {
  const { pickPolicy, allows } = await import("../src/name-rules.js");
  const V = "333333333333";
  const P = ["anyone", "replies", "nobody"];
  let checked = 0;
  for (const pub of P) for (const fol of ["", ...P]) for (const fri of ["", ...P]) for (const lst of ["", ...P]) for (const person of ["", "allow", "block", "both"])
  for (const follows of [false, true]) for (const friends of [false, true]) for (const inList of [false, true]) {
    const policy = { public: pub, followers: fol, friends: fri, lists: lst ? { L: lst } : {}, allow: person === "allow" || person === "both" ? [V] : [], block: person === "block" || person === "both" ? [V] : [] };
    const rel = { id: V, follows, friends, lists: inList ? ["L"] : [] };
    let want = pub;
    if (follows && fol) want = fol;
    if (friends && fri) want = fri;
    if (inList && lst) want = lst;
    if (person === "allow") want = "anyone";
    if (person === "block" || person === "both") want = "nobody";
    const got = pickPolicy(policy, rel, ["L"]);
    assert.equal(got, want, JSON.stringify({ policy, rel }));
    assert.equal(allows(got, { reply: false }), want === "anyone");
    assert.equal(allows(got, { reply: true }), want !== "nobody");
    checked++;
  }
  assert.equal(checked, 3 * 4 * 4 * 4 * 4 * 8);
  assert.equal(pickPolicy({ public: "nobody" }, { self: true }, []), "anyone");
  // List priority: the first list in the owner's order decides.
  const two = { public: "anyone", lists: { A: "nobody", B: "anyone" } };
  assert.equal(pickPolicy(two, { id: V, lists: ["A", "B"] }, ["B", "A"]), "anyone");
  assert.equal(pickPolicy(two, { id: V, lists: ["A", "B"] }, ["A", "B"]), "nobody");
});

test("mention controls refuse quietly; nicknames stay private", async () => {
  const tgt = await signup(61, "Tara Target", "mc_tara");
  const fan = await signup(62, "Fan Person", "mc_fan");
  const str = await signup(63, "Stranger", "mc_str");
  const pal = await signup(64, "Pal Friend", "mc_pal");
  const tid = "app:" + tgt.account.publicId;
  assert.equal((await send("/v1/follows", "PUT", fan.token, { id: tid })).status, 200);
  assert.equal((await send("/v1/follows", "PUT", pal.token, { id: tid })).status, 200);
  assert.equal((await send("/v1/follows", "PUT", tgt.token, { id: "app:" + pal.account.publicId })).status, 200);

  const set = await send("/v1/usernames/mentions", "PUT", tgt.token, { public: "nobody", followers: "replies", friends: "anyone", block: ["mc_pal"] });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual(set.body.block, ["mc_pal"]);
  assert.equal(set.text.indexOf(pal.account.publicId), -1);

  const sug = async (v, q, extra) => (await get("/v1/mentions/suggest?q=" + q + (extra || ""), v.token)).body;
  assert.deepEqual((await sug(str, "mc_tara")).accounts, []);
  assert.equal((await sug(str, "mc_tara")).hint, "cant_mention");
  assert.equal((await sug(str, "mc_ta")).hint, undefined, "the hint needs the full name");
  assert.deepEqual((await sug(fan, "mc_ta")).accounts, []);
  assert.deepEqual((await sug(fan, "mc_ta", "&reply=mc_tara")).accounts.map((a) => a.handle), ["mc_tara"]);
  assert.equal((await sug(pal, "mc_tara")).hint, "cant_mention", "block beats friends");

  const post = (v, text, parentId, id) => send("/v1/content", "POST", v.token, { kind: parentId ? "reply" : "post", text, parentId, id });
  const root = await post(tgt, "my root", "", "ct_1111111111111111");
  assert.equal(root.status, 200, root.text);
  await post(str, "hey @mc_tara", "");
  await post(pal, "hey @mc_tara", "");
  await post(fan, "top level @mc_tara", "");
  await post(fan, "reply @mc_tara", "ct_1111111111111111");
  const notes = await get("/v1/notifications", tgt.token);
  const mentions = (notes.body.items || []).filter((n) => n.kind === "mention");
  assert.deepEqual(mentions.map((n) => n.handle + ":" + n.text), ["mc_fan:reply @mc_tara"], notes.text);

  // Nicknames: the friend name for friends, a private nickname above it, nobody else sees either.
  assert.equal((await send("/v1/usernames/friend-name", "PUT", tgt.token, { name: "  Tee \u0000 " })).body.name, "Tee");
  const look = async (v) => (await get("/v1/profile/mc_tara", v.token)).body.account;
  assert.equal((await look(pal)).displayName, "Tee");
  assert.equal((await look(pal)).friendName, "Tee");
  assert.equal((await look(fan)).displayName, "Tara Target");
  assert.equal((await send("/v1/nicknames", "PUT", fan.token, { handle: "mc_tara", name: "Boss" })).status, 200);
  assert.equal((await look(fan)).displayName, "Boss");
  assert.equal((await look(fan)).nickname, "Boss");
  assert.equal((await look(str)).displayName, "Tara Target");
  assert.equal((await look(tgt)).displayName, "Tara Target");
  const feed = (await get("/v1/posts?by=" + tgt.account.publicId, fan.token));
  assert.equal(feed.status, 200);
  assert.deepEqual((await get("/v1/nicknames", fan.token)).body.nicknames, [{ handle: "mc_tara", name: "Boss" }]);
  assert.equal((await send("/v1/nicknames", "PUT", fan.token, { handle: "mc_tara", name: "" })).status, 200);
  assert.equal((await look(fan)).displayName, "Tara Target");
  assert.equal((await send("/v1/nicknames", "PUT", fan.token, { handle: "nobody_zz", name: "x" })).status, 404);
});
