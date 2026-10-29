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

test("pickName: most specific tier wins, list order breaks ties, exclusions always hold", async () => {
  const { pickName, canSeeName, normalizeNameAudience } = await import("../src/usernames.js");
  const N = (handle, primary, include, exclude) => ({ handle, primary, position: primary ? -1 : 0, audience: normalizeNameAudience({ include, exclude }) });
  const V = "111111111111";
  const names = [
    N("pub", true, { public: true }),
    N("fol", false, { followers: true }),
    N("fri", false, { friends: true }),
    N("la", false, { lists: ["la"] }),
    N("lb", false, { lists: ["lb"] }),
    N("per", false, { people: [V] })
  ];
  names.forEach((n, i) => { if (!n.primary) n.position = i; });
  for (const person of [false, true]) for (const inA of [false, true]) for (const inB of [false, true]) for (const friends of [false, true]) for (const follows of [false, true]) for (const order of [["la", "lb"], ["lb", "la"]]) {
    const rel = { id: person ? V : "222222222222", follows, friends, lists: [inA && "la", inB && "lb"].filter(Boolean) };
    let want = "pub";
    if (follows) want = "fol";
    if (friends) want = "fri";
    const lists = order.filter((id) => rel.lists.indexOf(id) >= 0);
    if (lists.length) want = lists[0];
    if (person) want = "per";
    assert.equal(pickName(names, rel, order).handle, want, JSON.stringify({ rel, order }));
  }
  // Exclusions: every combination of excluded tiers, never a name that excludes the viewer.
  const rel = { id: V, follows: true, friends: true, lists: ["la", "lb"] };
  const keys = ["people", "la", "lb", "friends", "followers"];
  for (let mask = 0; mask < 32; mask++) {
    const exclude = { people: mask & 1 ? [V] : [], lists: [mask & 2 && "la", mask & 4 && "lb"].filter(Boolean), friends: !!(mask & 8), followers: !!(mask & 16) };
    const set = names.map((n) => N(n.handle, n.primary, n.audience.include, exclude));
    const picked = pickName(set, rel, ["la", "lb"]);
    if (mask) assert.equal(picked, null, "an exclusion on every name leaves the placeholder: " + keys.filter((k, i) => mask & (1 << i)));
    else assert.equal(picked.handle, "per");
    set.forEach((n) => assert.equal(canSeeName(n, rel), !mask && true));
  }
  // Exclude only on the specific name falls back to the next broader one.
  const fall = [N("pub", true, { public: true }), N("fol", false, { followers: true }), N("per", false, { people: [V] }, { followers: true })];
  assert.equal(pickName(fall, { id: V, follows: true }, []).handle, "fol");
  assert.equal(pickName(fall, { id: V }, []).handle, "per");
  assert.equal(pickName([N("pub", true, { public: true }), N("per", false, { people: [V] }, { lists: ["la"] })], { id: V, lists: ["la"] }, []).handle, "pub");
  assert.equal(pickName([N("pub", true, { public: true }, { people: [V] })], { id: V }, []), null);
  assert.equal(pickName([N("pub", true, { public: true }, { people: [V] })], { id: V, self: true }, []).handle, "pub");
});

test("each viewer sees one username; hidden names 404 and never leak", async () => {
  const own = await signup(51, "Una Names", "una_main");
  const fol = await signup(52, "Fo Viewer", "fo_viewer");
  const fri = await signup(53, "Fri Viewer", "fri_viewer");
  const lis = await signup(54, "Li Viewer", "li_viewer");
  const per = await signup(55, "Pe Viewer", "pe_viewer");
  const str = await signup(56, "St Viewer", "st_viewer");
  const oid = "app:" + own.account.publicId;
  for (const v of [fol, fri, lis, per]) assert.equal((await send("/v1/follows", "PUT", v.token, { id: oid })).status, 200);
  assert.equal((await send("/v1/follows", "PUT", own.token, { id: "app:" + fri.account.publicId })).status, 200);
  const list = await call("/v1/audience-lists", { method: "POST", ip: ip(), token: own.token, body: { name: "Close", icon: "" } });
  assert.equal(list.status, 201, list.text);
  assert.equal((await send("/v1/audience-lists/" + list.body.id + "/members", "POST", own.token, { handle: "li_viewer" })).status, 200);

  const add = (handle, audience) => send("/v1/usernames", "POST", own.token, { handle, audience });
  assert.equal((await add("una_fol", { include: { followers: true } })).status, 201);
  assert.equal((await add("una_fri", { include: { friends: true } })).status, 201);
  assert.equal((await add("una_list", { include: { lists: [list.body.id] } })).status, 201);
  const last = await add("una_per", { include: { people: ["pe_viewer"] } });
  assert.equal(last.status, 201, last.text);
  assert.equal(last.body.names.length, 5);
  assert.equal((await add("una_six", { include: { public: true } })).body.error, "name_cap");

  const expect = [[fol, "una_fol"], [fri, "una_fri"], [lis, "una_list"], [per, "una_per"], [str, "una_main"], [own, "una_main"]];
  const hidden = ["una_fol", "una_fri", "una_list", "una_per"];
  for (const [v, want] of expect) {
    const res = await get("/v1/profile/una_main", v.token);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.account.handle, want);
    if (v !== own) hidden.filter((h) => h !== want).forEach((h) => assert.equal(res.text.indexOf(h), -1, h + " leaked to " + want));
  }
  // A name looked up by someone outside its audience is a 404, inside it works.
  assert.equal((await get("/v1/profile/una_fol", str.token)).status, 404);
  assert.equal((await get("/v1/profile/una_per", fol.token)).status, 404);
  const viaFol = await get("/v1/profile/una_fol", fol.token);
  assert.equal(viaFol.status, 200);
  assert.equal(viaFol.body.account.handle, "una_fol");
  assert.equal((await get("/v1/profile/una_list", lis.token)).body.account.handle, "una_list");

  // Uniqueness app-wide: signup, the availability check and another account all see it taken.
  assert.equal((await get("/v1/handle?handle=una_fol")).body.error, "handle_taken");
  assert.equal((await call("/v1/signup", { method: "POST", ip: ip(), body: { displayName: "X", handle: "UNA_FOL" } })).status, 409);
  assert.equal((await send("/v1/usernames", "POST", str.token, { handle: "una_per" })).body.error, "handle_taken");
  assert.equal((await send("/v1/profile", "PATCH", str.token, { handle: "una_fri" })).status, 409);

  // Mention suggestions: one name per viewer; typing a hidden name finds nobody.
  const sug = async (v, q) => (await get("/v1/mentions/suggest?q=" + q, v.token)).body.accounts.map((a) => a.handle);
  assert.deepEqual(await sug(str, "una_fo"), []);
  assert.deepEqual(await sug(str, "una"), ["una_main"]);
  assert.deepEqual(await sug(fol, "una_fo"), ["una_fol"]);
  assert.deepEqual(await sug(per, "una_ma"), ["una_per"]);

  // Posts carry the viewer's name for the author.
  const post = await send("/v1/posts", "POST", own.token, { body: "names post" });
  assert.equal(post.status, 201, post.text);
  const feed = async (v) => (await get("/v1/posts?by=" + own.account.publicId, v.token)).body.posts.find((p) => p.id === post.body.post.id).authorHandle;
  assert.equal(await feed(fol), "una_fol");
  assert.equal(await feed(str), "una_main");

  // Mentioning a name you can't see neither links nor notifies.
  assert.equal((await send("/v1/content", "POST", str.token, { kind: "post", text: "hi @una_fol" })).status, 200);
  assert.equal((await send("/v1/content", "POST", fol.token, { kind: "post", text: "hi @una_fol" })).status, 200);
  const notes = await get("/v1/notifications", own.token);
  const mentions = (notes.body.items || []).filter((n) => n.kind === "mention").map((n) => n.handle);
  assert.ok(mentions.indexOf("fo_viewer") >= 0, notes.text);
  assert.equal(mentions.indexOf("st_viewer"), -1);

  // Preview as.
  const preview = async (as) => (await get("/v1/usernames/preview?as=" + encodeURIComponent(as), own.token)).body;
  assert.equal((await preview("public")).handle, "una_main");
  assert.equal((await preview("followers")).handle, "una_fol");
  assert.equal((await preview("friends")).handle, "una_fri");
  assert.equal((await preview("list:" + list.body.id)).handle, "una_list");
  assert.equal((await preview("pe_viewer")).handle, "una_per");
  assert.equal((await get("/v1/usernames/preview?as=nobody_here", own.token)).status, 404);

  // Exclusions win; nothing left gives the neutral placeholder.
  const ex = await send("/v1/usernames", "PATCH", own.token, { handle: "una_main", audience: { include: { public: true }, exclude: { people: ["st_viewer"] } } });
  assert.equal(ex.status, 200, ex.text);
  const blank = await get("/v1/profile/" + own.account.publicId, str.token);
  assert.equal(blank.status, 200, blank.text);
  assert.equal(blank.body.account.handle, "");
  assert.equal(blank.body.account.handleHidden, true);
  ["una_main"].concat(hidden).forEach((h) => assert.equal(blank.text.indexOf(h), -1, h + " leaked to an excluded viewer"));
  assert.equal((await get("/v1/profile/una_main", str.token)).status, 404);
  assert.deepEqual(await sug(str, "una"), []);
  assert.equal((await preview("st_viewer")).hidden, true);

  // Removing a name holds it for this account only; switching primary is paced.
  const gone = await send("/v1/usernames", "DELETE", own.token, { handle: "una_fri" });
  assert.equal(gone.body.names.length, 4);
  assert.equal((await send("/v1/usernames", "POST", str.token, { handle: "una_fri" })).body.error, "handle_held");
  assert.equal((await add("una_fri", { include: { friends: true } })).status, 201);
  assert.equal((await send("/v1/usernames", "DELETE", own.token, { handle: "una_main" })).body.error, "primary_name");
  const sw = await send("/v1/usernames/primary", "POST", own.token, { handle: "una_fol" });
  assert.equal(sw.status, 200, sw.text);
  assert.equal(sw.body.names[0].handle, "una_fol");
  assert.equal(sw.body.names[0].primary, true);
  assert.deepEqual(sw.body.names[0].audience.include.followers, true);
  assert.equal((await get("/v1/profile/una_main", fol.token)).body.account.handle, "una_fol");
  assert.equal((await send("/v1/usernames/primary", "POST", own.token, { handle: "una_main" })).status, 200);
  assert.equal((await send("/v1/usernames/primary", "POST", own.token, { handle: "una_fol" })).status, 429);
});
