import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "ownerlane";
const dispatches = [];
let mf;

function rss(title) {
  return `<rss><channel><title>${title}</title><item><title>Hello</title><description>Hello from the sample</description><guid>p1</guid><link>https://feeds.example/p1</link></item></channel></rss>`;
}

async function outbound(request) {
  const url = new URL(request.url);
  if (url.hostname === "api.github.com") {
    dispatches.push(await request.text());
    return new Response(null, { status: 204 });
  }
  if (url.hostname === "feeds.example") return new Response(rss("Sample Wind"), { status: 200, headers: { "content-type": "application/rss+xml" } });
  return new Response("missing", { status: 404 });
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}

async function signup(handle, ip, extra) {
  const res = await call("/v1/signup", { method: "POST", ip, body: Object.assign({ displayName: handle, handle }, extra || {}) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function r2json(key) {
  const b = await mf.getBindings();
  const obj = await b.DATA.get(key);
  return obj ? JSON.parse(await obj.text()) : null;
}

test.before(async () => {
  mf = new Miniflare({
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
      OWNER_HANDLE: OWNER,
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io",
      PBKDF2_ITERATIONS: "1000",
      GITHUB_DISPATCH_TOKEN: "dispatch-test"
    },
    outboundService: outbound
  });
});

test.after(async () => { if (mf) await mf.dispose(); });

let ipN = 10;
function ip() { ipN += 1; return "198.51.100." + (ipN % 250 + 1); }

function hashKey(key) {
  return createHash("sha256").update("feed-ban:" + key).digest("hex").slice(0, 20);
}

test("only the owner adds sources; members request, owner allows, blocks and bans", async () => {
  const owner = await signup(OWNER, "203.0.113.20", { claimCode: "claim-test" });
  const member = await signup("membermaple", "203.0.113.21");
  const other = await signup("otherbirch", "203.0.113.22");

  // Anonymous add routes stay hidden.
  assert.equal((await call("/v1/owner/feeds", { method: "POST", ip: ip(), body: { input: "https://feeds.example/a.xml", confirm: true } })).status, 404);

  // A member's add on every owner add route is refused with 403 and becomes a request.
  const feedAdd = await call("/v1/owner/feeds", { method: "POST", ip: ip(), token: member.token, body: { input: "https://feeds.example/a.xml", confirm: true } });
  assert.equal(feedAdd.status, 403, JSON.stringify(feedAdd.body));
  assert.equal(feedAdd.body.error, "owner_only");
  assert.equal(feedAdd.body.requested, true);
  assert.equal(feedAdd.body.request.state, "pending");
  assert.equal(await r2json("owner/feeds-catalog.json"), null, "nothing was added to the catalog");

  const xAdd = await call("/v1/owner/accounts", { method: "POST", ip: ip(), token: member.token, body: { handle: "samplelane" } });
  assert.equal(xAdd.status, 403);
  assert.equal(xAdd.body.requested, true);
  assert.equal(xAdd.body.request.key, "x:samplelane");

  const ttAdd = await call("/v1/owner/tiktok/accounts", { method: "POST", ip: ip(), token: member.token, body: { handle: "sampletok" } });
  assert.equal(ttAdd.status, 403);
  assert.equal(ttAdd.body.request.key, "tiktok:sampletok");

  const comAdd = await call("/v1/owner/communities", { method: "POST", ip: ip(), token: member.token, body: { name: "samplecove" } });
  assert.equal(comAdd.status, 403);
  assert.equal(comAdd.body.request.key, "reddit:r:samplecove");

  // The same source asked twice is one request with two requesters.
  const again = await call("/v1/feed-requests", { method: "POST", ip: ip(), token: other.token, body: { input: "https://feeds.example/a.xml", note: "Good sample" } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.request.id, feedAdd.body.request.id);

  // A member's follow of a new device source (newsletter) is a request too.
  const follow = await call("/v1/follows", { method: "PUT", ip: ip(), token: member.token, body: { id: "news:samplewind" } });
  assert.equal(follow.status, 403, JSON.stringify(follow.body));
  assert.equal(follow.body.error, "owner_only");

  let mine = await call("/v1/feed-requests", { ip: ip(), token: member.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.requests.length, 5);
  assert.ok(mine.body.requests.every((row) => row.state === "pending"));

  // The owner sees the queue with requesters and notes, and got a notification.
  let queue = await call("/v1/owner/feed-requests", { ip: ip(), token: owner.token });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.pending, 5);
  const feedReq = queue.body.requests.find((row) => row.id === feedAdd.body.request.id);
  assert.equal(feedReq.count, 2);
  assert.deepEqual(feedReq.requesters.map((row) => row.handle).sort(), ["membermaple", "otherbirch"]);
  assert.ok(feedReq.requesters.some((row) => row.note === "Good sample"));
  assert.equal((await call("/v1/owner/feed-requests", { ip: ip(), token: member.token })).status, 403);
  assert.equal((await call("/v1/owner/feed-requests", { ip: ip() })).status, 404);
  const ownerNotes = await call("/v1/notifications", { ip: ip(), token: owner.token });
  assert.ok(ownerNotes.text.includes("feed_request"), "the owner is told about new requests");

  // Allow only for the requester: the newsletter follow now works for them, not others.
  const newsReq = queue.body.requests.find((row) => row.key === "news:samplewind");
  const allowNews = await call(`/v1/owner/feed-requests/${newsReq.id}/allow`, { method: "POST", ip: ip(), token: owner.token, body: { dest: "requester" } });
  assert.equal(allowNews.status, 200, JSON.stringify(allowNews.body));
  assert.equal((await call("/v1/follows", { method: "PUT", ip: ip(), token: member.token, body: { id: "news:samplewind" } })).status, 200);
  const notMine = await call("/v1/follows", { method: "PUT", ip: ip(), token: other.token, body: { id: "news:samplewind" } });
  assert.equal(notMine.status, 403, "allowed only for the requester");
  const memberNotes = await call("/v1/notifications", { ip: ip(), token: member.token });
  assert.ok(memberNotes.text.includes("feed_approved"), "the requester is told");

  // Allow for everyone: the feed joins the owner catalog.
  const allowAll = await call(`/v1/owner/feed-requests/${feedReq.id}/allow`, { method: "POST", ip: ip(), token: owner.token, body: { dest: "everyone" } });
  assert.equal(allowAll.status, 200, JSON.stringify(allowAll.body));
  const catalog = await r2json("owner/feeds-catalog.json");
  assert.equal(catalog.accounts.length, 1);
  mine = await call("/v1/feed-requests", { ip: ip(), token: other.token });
  assert.equal(mine.body.requests.find((row) => row.id === feedReq.id).state, "approved");

  // Block: rejected, and it can be asked again later.
  const blocked = await call(`/v1/owner/feed-requests/${comAdd.body.request.id}/block`, { method: "POST", ip: ip(), token: owner.token });
  assert.equal(blocked.status, 200);
  mine = await call("/v1/feed-requests", { ip: ip(), token: member.token });
  assert.equal(mine.body.requests.find((row) => row.id === comAdd.body.request.id).state, "rejected");
  const reask = await call("/v1/feed-requests", { method: "POST", ip: ip(), token: member.token, body: { input: "samplecove", kind: "community" } });
  assert.equal(reask.status, 200, JSON.stringify(reask.body));
  assert.equal(reask.body.request.state, "pending");

  // Ban: nobody can request or add it again, and the catalog copy stops.
  const banned = await call(`/v1/owner/feed-requests/${feedReq.id}/ban`, { method: "POST", ip: ip(), token: owner.token });
  assert.equal(banned.status, 200, JSON.stringify(banned.body));
  const paused = await r2json("owner/feeds-catalog.json");
  assert.equal(paused.accounts[0].paused, true, "a banned source is no longer fetched");
  const bansDoc = await r2json("owner/feed-bans.json");
  assert.ok(bansDoc.hashes.includes(hashKey(feedReq.key)));
  assert.ok(!JSON.stringify(bansDoc).includes("feeds.example"), "the hash list carries no URL");
  const askBanned = await call("/v1/feed-requests", { method: "POST", ip: ip(), token: other.token, body: { input: "https://feeds.example/a.xml" } });
  assert.equal(askBanned.status, 403);
  assert.equal(askBanned.body.error, "banned");
  const addBanned = await call("/v1/owner/feeds", { method: "POST", ip: ip(), token: owner.token, body: { input: "https://feeds.example/a.xml", confirm: true } });
  assert.equal(addBanned.status, 403);
  assert.equal(addBanned.body.error, "banned");
  const memberAddBanned = await call("/v1/owner/feeds", { method: "POST", ip: ip(), token: member.token, body: { input: "https://feeds.example/a.xml", confirm: true } });
  assert.equal(memberAddBanned.status, 403);
  assert.equal(memberAddBanned.body.error, "banned");

  // Ban by hand and the banned list; a banned X handle cannot be added by the owner.
  const handBan = await call("/v1/owner/feed-bans", { method: "POST", ip: ip(), token: owner.token, body: { input: "x:bannedlane" } });
  assert.equal(handBan.status, 200);
  assert.equal(handBan.body.bans.length, 2);
  const xBanned = await call("/v1/owner/accounts", { method: "POST", ip: ip(), token: owner.token, body: { handle: "bannedlane" } });
  assert.equal(xBanned.status, 403);
  const followBanned = await call("/v1/follows", { method: "PUT", ip: ip(), token: member.token, body: { id: "x:bannedlane" } });
  assert.equal(followBanned.status, 403);
  assert.equal(followBanned.body.error, "banned");
  const pub = await call("/v1/feed-requests/banned", { ip: ip() });
  assert.equal(pub.status, 200);
  assert.ok(pub.body.hashes.includes(hashKey("x:bannedlane")));

  // Unban: it can be requested again.
  const unban = await call("/v1/owner/feed-bans/" + encodeURIComponent("x:bannedlane"), { method: "DELETE", ip: ip(), token: owner.token });
  assert.equal(unban.status, 200);
  assert.equal(unban.body.bans.length, 1);
  assert.equal((await call("/v1/feed-requests", { method: "POST", ip: ip(), token: member.token, body: { input: "x:bannedlane" } })).status, 200);

  // Bulk block, and the requester cancels their own request.
  queue = await call("/v1/owner/feed-requests", { ip: ip(), token: owner.token });
  const tt = queue.body.requests.find((row) => row.key === "tiktok:sampletok");
  const bulk = await call("/v1/owner/feed-requests/bulk", { method: "POST", ip: ip(), token: owner.token, body: { ids: [tt.id], action: "block" } });
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.body.results, [{ id: tt.id, ok: true }]);
  const cancel = await call("/v1/feed-requests/" + xAdd.body.request.id, { method: "DELETE", ip: ip(), token: member.token });
  assert.equal(cancel.status, 200);
  assert.ok(!cancel.body.requests.some((row) => row.id === xAdd.body.request.id));
  queue = await call("/v1/owner/feed-requests", { ip: ip(), token: owner.token });
  assert.ok(!queue.body.requests.some((row) => row.id === xAdd.body.request.id), "a cancelled request leaves the queue");
});
