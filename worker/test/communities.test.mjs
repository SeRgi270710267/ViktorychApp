import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "mirathorn";
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

test("internal community posts stay off anonymous responses and attach to a Reddit comment", async () => {
  const anon = await call("/v1/communities/teslamotors", { ip: "203.0.113.20" });
  assert.equal(anon.status, 404);
  assert.equal(anon.body.error, "not_found");
  assert.equal(anon.body.posts, undefined);
  assert.equal(anon.text.indexOf("va_"), -1);

  const hidden = await call("/v1/owner/communities", { ip: "203.0.113.21" });
  assert.equal(hidden.status, 404);

  const ada = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.22",
    body: { displayName: "Ada Lovelace", handle: "ada_cm" }
  });
  assert.equal(ada.status, 201);

  const reply = await call("/v1/communities/teslamotors/posts", {
    method: "POST",
    ip: "203.0.113.23",
    token: ada.body.token,
    body: { text: "Written here, under the Reddit comment.", parentId: "t1_c0mm3nt01" }
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.post.parentId, "t1_c0mm3nt01");
  assert.match(reply.body.post.id, /^va_[a-f0-9]{16}$/);
  assert.equal(reply.body.post.author.displayName, "Ada Lovelace");

  const feed = await call("/v1/communities/teslamotors", { ip: "203.0.113.24", token: ada.body.token });
  assert.equal(feed.status, 200);
  assert.equal(feed.body.posts.length, 1);
  assert.equal(feed.body.posts[0].parentId, "t1_c0mm3nt01");
  assert.equal(feed.body.notes.length, 0);

  const grace = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.25",
    body: { displayName: "Grace", handle: "grace_cm" }
  });
  assert.equal(grace.status, 201);
  const nested = await call("/v1/communities/teslamotors/posts", {
    method: "POST",
    ip: "203.0.113.26",
    token: grace.body.token,
    body: { text: "A reply on ViktorychApp.", parentId: reply.body.post.id }
  });
  assert.equal(nested.status, 200);
  assert.equal(nested.body.post.parentId, reply.body.post.id);

  const noted = await call("/v1/communities/teslamotors", { ip: "203.0.113.27", token: ada.body.token });
  assert.equal(noted.body.notes.length, 1);
  assert.equal(noted.body.notes[0].id, "cm_" + nested.body.post.id);
  assert.equal(noted.body.notes[0].hash, "#/communities/teslamotors/" + encodeURIComponent(reply.body.post.id));

  const liked = await call("/v1/communities/teslamotors/likes", {
    method: "POST",
    ip: "203.0.113.28",
    token: ada.body.token,
    body: { itemId: "t3_post000001" }
  });
  assert.equal(liked.status, 200);
  assert.equal(liked.body.likes, 1);

  const joined = await call("/v1/communities/teslamotors/join", {
    method: "POST",
    ip: "203.0.113.29",
    token: ada.body.token
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.joined, true);
  // Ada and Grace both posted here, and posting joins a public community.
  assert.equal(joined.body.members, 2);

  const denied = await call("/v1/communities/teslamotors/posts/" + nested.body.post.id, {
    method: "DELETE",
    ip: "203.0.113.30",
    token: ada.body.token
  });
  assert.equal(denied.status, 403);

  const owner = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.31",
    body: { displayName: "Owner", handle: OWNER, claimCode: "claim-test" }
  });
  assert.equal(owner.status, 201);
  const removed = await call("/v1/communities/teslamotors/posts/" + nested.body.post.id, {
    method: "DELETE",
    ip: "203.0.113.32",
    token: owner.body.token
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.deleted, true);

  const own = await call("/v1/communities/teslamotors/posts/" + reply.body.post.id, {
    method: "DELETE",
    ip: "203.0.113.33",
    token: ada.body.token
  });
  assert.equal(own.status, 200);

  dispatches.length = 0;
  const added = await call("/v1/owner/communities", {
    method: "POST",
    ip: "203.0.113.34",
    token: owner.body.token,
    body: { name: "https://www.reddit.com/r/teslamotors/hot" }
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.community.name, "teslamotors");
  assert.equal(added.body.dispatched, true);
  assert.ok(dispatches.some((path) => path.indexOf("/reddit.yml/dispatches") >= 0));
  assert.ok(dispatches.some((path) => path.indexOf("/sync.yml/dispatches") >= 0));
  assert.equal(hosts.indexOf("oauth.reddit.com"), -1);
  assert.equal(hosts.indexOf("www.reddit.com"), -1);
  assert.equal(hosts.indexOf("reddit.com"), -1);

  const stranger = await call("/v1/owner/communities", { ip: "203.0.113.35", token: ada.body.token });
  assert.equal(stranger.status, 403);

  const again = await call("/v1/communities/teslamotors", { ip: "203.0.113.36" });
  assert.equal(again.status, 404);
  assert.equal(again.text.indexOf("Written here"), -1);
});

test("profile-less accounts post and comment anonymously without revealing authorId or public profile", async () => {
  const anon = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.210",
    body: { profileLess: true }
  });
  assert.equal(anon.status, 201);
  assert.equal(anon.body.account.profileLess, true);

  const stranger = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.211",
    body: { displayName: "Stranger", handle: "stranger_cm" }
  });
  assert.equal(stranger.status, 201);

  // Post in community as profile-less user
  const postRes = await call("/v1/communities/teslamotors/posts", {
    method: "POST",
    ip: "203.0.113.212",
    token: anon.body.token,
    body: { text: "Anonymous comment in community", parentId: "t1_c0mm3nt99" }
  });
  assert.equal(postRes.status, 200);
  assert.equal(postRes.body.post.authorId, "");
  assert.equal(postRes.body.post.author.displayName, "Anonymous");
  assert.equal(postRes.body.post.author.handle, "anonymous");
  assert.equal(postRes.body.post.author.profileLess, true);
  assert.equal(postRes.body.post.mine, true);

  // Read feed as stranger
  const feed = await call("/v1/communities/teslamotors", {
    ip: "203.0.113.213",
    token: stranger.body.token
  });
  assert.equal(feed.status, 200);
  const anonPost = feed.body.posts.find((p) => p.id === postRes.body.post.id);
  assert.ok(anonPost);
  assert.equal(anonPost.authorId, "");
  assert.equal(anonPost.author.displayName, "Anonymous");
  assert.equal(anonPost.author.handle, "anonymous");
  assert.equal(anonPost.author.profileLess, true);
  assert.equal(anonPost.mine, false);
});

test("home and a community share one post and one reply", async () => {
  const ada = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.80",
    body: { displayName: "Ada Home", handle: "ada_home" }
  });
  assert.equal(ada.status, 201);
  const post = await call("/v1/communities/homefeed/posts", {
    method: "POST",
    ip: "203.0.113.81",
    token: ada.body.token,
    body: { text: "Hello from the community" }
  });
  assert.equal(post.status, 200);
  const adaHome = await call("/v1/posts", { ip: "203.0.113.82", token: ada.body.token });
  assert.equal(adaHome.status, 200);
  const adaCard = (adaHome.body.posts || []).filter((item) => item.id === post.body.post.id);
  assert.equal(adaCard.length, 1);
  assert.equal(adaCard[0].community.name, "homefeed");

  const grace = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.83",
    body: { displayName: "Grace Home", handle: "grace_home" }
  });
  assert.equal(grace.status, 201);
  const before = await call("/v1/posts", { ip: "203.0.113.84", token: grace.body.token });
  assert.equal((before.body.posts || []).some((item) => item.id === post.body.post.id), false);

  const joined = await call("/v1/communities/homefeed/join", {
    method: "POST",
    ip: "203.0.113.85",
    token: grace.body.token
  });
  assert.equal(joined.status, 200);
  const seen = await call("/v1/posts", { ip: "203.0.113.86", token: grace.body.token });
  assert.equal((seen.body.posts || []).filter((item) => item.id === post.body.post.id).length, 1);

  const reply = await call("/v1/posts", {
    method: "POST",
    ip: "203.0.113.87",
    token: grace.body.token,
    body: { body: "From the home feed", parentId: post.body.post.id }
  });
  assert.equal(reply.status, 201);
  assert.match(reply.body.post.id, /^va_[a-f0-9]{16}$/);
  assert.equal(reply.body.post.parentId, post.body.post.id);
  assert.equal(reply.body.post.community.name, "homefeed");

  const thread = await call("/v1/communities/homefeed", { ip: "203.0.113.88", token: grace.body.token });
  const ids = (thread.body.posts || []).map((item) => item.id);
  assert.equal(ids.filter((id) => id === post.body.post.id).length, 1);
  assert.equal(ids.filter((id) => id === reply.body.post.id).length, 1);
  const noted = await call("/v1/communities/homefeed", { ip: "203.0.113.89", token: ada.body.token });
  assert.ok((noted.body.notes || []).some((note) => note.id === "cm_" + reply.body.post.id));

  const homeAgain = await call("/v1/posts", { ip: "203.0.113.90", token: grace.body.token });
  assert.equal((homeAgain.body.posts || []).filter((item) => item.id === reply.body.post.id).length, 1);
  const parentCard = (homeAgain.body.posts || []).find((item) => item.id === post.body.post.id);
  assert.ok(parentCard);
  assert.equal(parentCard.replyCount >= 1, true);

  const hidden = await call("/v1/communities/homefeed/feed", {
    method: "POST",
    ip: "203.0.113.91",
    token: grace.body.token,
    body: { showHome: false }
  });
  assert.equal(hidden.status, 200);
  const off = await call("/v1/posts", { ip: "203.0.113.92", token: grace.body.token });
  assert.equal((off.body.posts || []).some((item) => item.community && item.community.name === "homefeed"), false);

  const db = await mf.getD1Database("DB");
  await db.prepare("INSERT INTO community_meta (community_id, visibility, updated_at) VALUES (?, 'private', ?) ON CONFLICT(community_id) DO UPDATE SET visibility = 'private'").bind("homefeed", Date.now()).run();
  const stranger = await call("/v1/signup", {
    method: "POST",
    ip: "203.0.113.93",
    body: { displayName: "Stranger Home", handle: "stranger_home" }
  });
  assert.equal(stranger.status, 201);
  const locked = await call("/v1/communities/homefeed", { ip: "203.0.113.94", token: stranger.body.token });
  assert.equal(locked.body.locked, true);
  assert.equal((locked.body.posts || []).some((item) => item.id === post.body.post.id), false);
  const strangerHome = await call("/v1/posts", { ip: "203.0.113.95", token: stranger.body.token });
  assert.equal((strangerHome.body.posts || []).some((item) => item.community && item.community.name === "homefeed"), false);
  // Posting joined Ada to the community while it was public, so she still reads it.
  const memberHome = await call("/v1/posts", { ip: "203.0.113.96", token: ada.body.token });
  assert.equal((memberHome.body.posts || []).filter((item) => item.id === post.body.post.id).length, 1);
  const globalOn = await call("/v1/communities/home", {
    method: "POST",
    ip: "203.0.113.97",
    token: ada.body.token,
    body: { showHome: true }
  });
  assert.equal(globalOn.body.showHome, true);
  const adaBack = await call("/v1/posts", { ip: "203.0.113.98", token: ada.body.token });
  assert.equal((adaBack.body.posts || []).filter((item) => item.id === post.body.post.id).length, 1);
  await call("/v1/communities/homefeed/join", { method: "POST", ip: "203.0.113.99", token: ada.body.token });
  const adaMember = await call("/v1/posts", { ip: "203.0.113.100", token: ada.body.token });
  assert.equal((adaMember.body.posts || []).filter((item) => item.id === post.body.post.id).length, 1);
  await call("/v1/communities/homefeed/feed", {
    method: "POST",
    ip: "203.0.113.101",
    token: grace.body.token,
    body: { showHome: true, muted: false }
  });
  const graceBack = await call("/v1/posts", { ip: "203.0.113.102", token: grace.body.token });
  assert.equal((graceBack.body.posts || []).filter((item) => item.id === reply.body.post.id).length, 1);
});

test("home lists community posts for members, followers and the owner", async () => {
  const sign = async (handle, ip) => {
    const res = await call("/v1/signup", { method: "POST", ip, body: { displayName: handle, handle } });
    assert.equal(res.status, 201);
    return res.body;
  };
  const sees = async (token, id, ip) => {
    const res = await call("/v1/posts", { ip, token });
    assert.equal(res.status, 200);
    return (res.body.posts || []).filter((item) => item.id === id).length === 1;
  };
  const cara = await sign("cara_home", "203.0.114.10");
  const post = await call("/v1/communities/followfeed/posts", { method: "POST", ip: "203.0.114.11", token: cara.token, body: { text: "Cara in the community" } });
  assert.equal(post.status, 200);
  const id = post.body.post.id;
  const dan = await sign("dan_home", "203.0.114.12");
  assert.equal(await sees(dan.token, id, "203.0.114.13"), false);

  const follow = await call("/v1/follows", { method: "PUT", ip: "203.0.114.14", token: dan.token, body: { id: "app:" + cara.account.publicId } });
  assert.equal(follow.status, 200);
  assert.equal(await sees(dan.token, id, "203.0.114.15"), true);

  const fay = await sign("fay_home", "203.0.114.16");
  const reply = await call("/v1/posts", { method: "POST", ip: "203.0.114.17", token: fay.token, body: { body: "Fay replies", parentId: id } });
  assert.equal(reply.status, 201);
  assert.equal(await sees(cara.token, reply.body.post.id, "203.0.114.18"), true);
  const faySelf = await call("/v1/communities/followfeed/posts", { method: "POST", ip: "203.0.114.19", token: fay.token, body: { text: "Fay posts too" } });
  assert.equal(faySelf.status, 200);
  assert.equal(await sees(cara.token, faySelf.body.post.id, "203.0.114.20"), true);

  const eve = await sign("eve_home", "203.0.114.21");
  assert.equal(await sees(eve.token, id, "203.0.114.22"), false);
  const db = await mf.getD1Database("DB");
  const realOwner = await db.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
  if (realOwner) await db.prepare("UPDATE accounts SET owner = 0 WHERE public_id = ?").bind(realOwner.public_id).run();
  await db.prepare("UPDATE accounts SET owner = 1 WHERE public_id = ?").bind(eve.account.publicId).run();
  try {
    assert.equal(await sees(eve.token, id, "203.0.114.23"), true);
    assert.equal(await sees(eve.token, reply.body.post.id, "203.0.114.24"), true);
  } finally {
    await db.prepare("UPDATE accounts SET owner = 0 WHERE public_id = ?").bind(eve.account.publicId).run();
    if (realOwner) await db.prepare("UPDATE accounts SET owner = 1 WHERE public_id = ?").bind(realOwner.public_id).run();
  }

  await db.prepare("INSERT INTO community_meta (community_id, visibility, updated_at) VALUES (?, 'private', ?) ON CONFLICT(community_id) DO UPDATE SET visibility = 'private'").bind("followfeed", Date.now()).run();
  assert.equal(await sees(dan.token, id, "203.0.114.25"), false);
  assert.equal(await sees(fay.token, id, "203.0.114.26"), true);
});

test("an account's own posts, replies and quotes list on its profile with ?by=", async () => {
  const lin = await call("/v1/signup", { method: "POST", ip: "203.0.113.140", body: { displayName: "Lin Own", handle: "lin_own" } });
  assert.equal(lin.status, 201);
  const sent = await call("/v1/posts", { method: "POST", ip: "203.0.113.141", token: lin.body.token, body: { body: "My first own post" } });
  assert.equal(sent.status, 201);
  const reply = await call("/v1/posts", { method: "POST", ip: "203.0.113.142", token: lin.body.token, body: { body: "A reply to myself", parentId: sent.body.post.id } });
  assert.equal(reply.status, 201);
  const quote = await call("/v1/posts", { method: "POST", ip: "203.0.113.143", token: lin.body.token, body: { body: "Quoting myself", quoteId: sent.body.post.id } });
  assert.equal(quote.status, 201);
  const id = lin.body.account.publicId;
  const mine = await call("/v1/posts?by=" + id, { ip: "203.0.113.144", token: lin.body.token });
  assert.equal(mine.status, 200);
  const ids = (mine.body.posts || []).map((item) => item.id);
  assert.deepEqual(ids.slice().sort(), [quote.body.post.id, reply.body.post.id, sent.body.post.id].sort());
  assert.ok((mine.body.posts || []).every((item) => item.authorId === id));
  const home = await call("/v1/posts", { ip: "203.0.113.145", token: lin.body.token });
  assert.ok((home.body.posts || []).some((item) => item.id === sent.body.post.id));
  const rae = await call("/v1/signup", { method: "POST", ip: "203.0.113.146", body: { displayName: "Rae Other", handle: "rae_other" } });
  const seen = await call("/v1/posts?by=" + id, { ip: "203.0.113.147", token: rae.body.token });
  assert.equal(seen.body.posts.length, 3);
  const bad = await call("/v1/posts?by=nope", { ip: "203.0.113.148", token: rae.body.token });
  assert.equal(bad.status, 400);
});

test("a profile lists the account's community posts and replies, with community privacy", async () => {
  const sam = await call("/v1/signup", { method: "POST", ip: "203.0.113.150", body: { displayName: "Sam Comm", handle: "sam_comm" } });
  assert.equal(sam.status, 201);
  const root = await call("/v1/communities/proffeed/posts", { method: "POST", ip: "203.0.113.151", token: sam.body.token, body: { text: "Sam in a community" } });
  assert.equal(root.status, 200);
  const reply = await call("/v1/communities/proffeed/posts", { method: "POST", ip: "203.0.113.152", token: sam.body.token, body: { text: "Sam replies in a community", parentId: root.body.post.id } });
  assert.equal(reply.status, 200);
  const id = sam.body.account.publicId;
  const own = await call("/v1/posts?by=" + id, { ip: "203.0.113.153", token: sam.body.token });
  const ownRows = (own.body.posts || []).filter((item) => item.community && item.community.name === "proffeed");
  assert.deepEqual(ownRows.map((item) => item.id).sort(), [root.body.post.id, reply.body.post.id].sort());
  assert.equal(ownRows.find((item) => item.id === reply.body.post.id).parentId, root.body.post.id);

  const viewer = await call("/v1/signup", { method: "POST", ip: "203.0.113.154", body: { displayName: "View Comm", handle: "view_comm" } });
  const open = await call("/v1/posts?by=" + id, { ip: "203.0.113.155", token: viewer.body.token });
  assert.equal((open.body.posts || []).filter((item) => item.community && item.community.name === "proffeed").length, 2);

  const db = await mf.getD1Database("DB");
  await db.prepare("INSERT INTO community_meta (community_id, visibility, updated_at) VALUES (?, 'private', ?) ON CONFLICT(community_id) DO UPDATE SET visibility = 'private'").bind("proffeed", Date.now()).run();
  const closed = await call("/v1/posts?by=" + id, { ip: "203.0.113.156", token: viewer.body.token });
  assert.equal((closed.body.posts || []).filter((item) => item.community).length, 0);
  const still = await call("/v1/posts?by=" + id, { ip: "203.0.113.157", token: sam.body.token });
  assert.equal((still.body.posts || []).filter((item) => item.community).length, 2);
  await db.prepare("INSERT INTO community_members (community_id, public_id, created_at) VALUES (?, ?, ?)").bind("proffeed", viewer.body.account.publicId, Date.now()).run();
  const member = await call("/v1/posts?by=" + id, { ip: "203.0.113.158", token: viewer.body.token });
  assert.equal((member.body.posts || []).filter((item) => item.community).length, 2);
});
