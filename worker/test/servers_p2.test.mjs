import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { PERM } from "../../shared/server-perms.js";

const OWNER = "srv_owner";
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
    durableObjects: { ACCOUNT_CHANNEL: { className: "AccountChannel", useSQLite: true } },
    bindings: {
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: OWNER,
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000"
    }
  };
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  let payload;
  if (opts.raw) {
    payload = opts.raw;
    headers.set("content-type", opts.type || "application/octet-stream");
  } else if (opts.body) {
    payload = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text, buf, headers: res.headers };
}

async function signup(ip, handle, name, claimCode) {
  const b = { displayName: name, handle };
  if (claimCode) b.claimCode = claimCode;
  const created = await call("/v1/signup", { method: "POST", ip, body: b });
  assert.equal(created.status, 201, created.text);
  return created.body;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(list, pred, ms) {
  const start = Date.now();
  while (Date.now() - start < (ms || 3000)) {
    const hit = list.find(pred);
    if (hit) return hit;
    await sleep(15);
  }
  throw new Error("timeout " + JSON.stringify(list.slice(-5)));
}

async function openSocket(token, sid, ip) {
  const t = await call("/v1/servers/" + sid + "/ticket", { method: "POST", token, ip });
  assert.equal(t.status, 200, t.text);
  const res = await mf.dispatchFetch("https://accounts.test/v1/servers/ws?s=" + sid + "&ticket=" + encodeURIComponent(t.body.ticket), {
    headers: { Upgrade: "websocket", Connection: "Upgrade", "CF-Connecting-IP": ip || "203.0.113.10" }
  });
  assert.equal(res.status, 101);
  const ws = res.webSocket;
  ws.accept();
  const messages = [];
  ws.addEventListener("message", (e) => {
    try { messages.push(JSON.parse(String(e.data))); } catch (err) { messages.push({ raw: String(e.data) }); }
  });
  return { ws, messages };
}

test.before(async () => { mf = new Miniflare(workerOptions()); });
test.after(async () => { if (mf) await mf.dispose(); });

async function setup() {
  const owner = await signup("198.51.100.40", OWNER, "Owner", "claim-test");
  const ana = await signup("198.51.100.41", "srv_ana", "Ana Srv");
  const bo = await signup("198.51.100.42", "srv_bo", "Bo Srv");
  const made = await call("/v1/servers", { method: "POST", token: owner.token, body: { name: "Phase Two" } });
  assert.equal(made.status, 200, made.text);
  const sid = made.body.server.id;
  const inv = await call("/v1/servers/" + sid + "/invites", { method: "POST", token: owner.token, body: {} });
  for (const who of [ana, bo]) {
    const j = await call("/v1/servers/invite/" + inv.body.invite.code + "/join", { method: "POST", token: who.token });
    assert.equal(j.status, 200, j.text);
  }
  return { O: owner.token, A: ana.token, B: bo.token, sid, general: made.body.channelId };
}

test("native servers phase 2: threads, forums, polls, stickers, events, presence", async () => {
  const { O, A, B, sid, general } = await setup();
  const base = "/v1/servers/" + sid;
  const stA = await call(base, { token: A });
  const anaMid = stA.body.me.mid;
  const boMid = (await call(base, { token: B })).body.me.mid;
  /* Everyone can start threads by default. */
  assert.ok(stA.body.me.perms & PERM.CREATE_THREADS);
  const sockB = await openSocket(B, sid, "198.51.100.42");
  await waitFor(sockB.messages, (m) => m.op === "ready");

  /* Thread from a message. */
  const root = await call(base + "/channels/" + general + "/messages", { method: "POST", token: A, body: { body: "Let's plan the trip" } });
  assert.equal(root.status, 200, root.text);
  const th = await call(base + "/channels/" + general + "/threads", { method: "POST", token: A, body: { messageId: root.body.message.id } });
  assert.equal(th.status, 200, th.text);
  const tid = th.body.thread.id;
  assert.equal(th.body.thread.name, "Let's plan the trip");
  assert.equal((await call(base + "/channels/" + general + "/threads", { method: "POST", token: A, body: { messageId: root.body.message.id } })).status, 409);
  const inThread = await call(base + "/channels/" + tid + "/messages", { method: "POST", token: B, body: { body: "Count me in", nonce: "n1" } });
  assert.equal(inThread.status, 200, inThread.text);
  assert.equal(inThread.body.message.c, tid);
  /* Thread events ride the parent channel and name the thread. */
  const ev = await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "msg" && m.e.ch === tid);
  assert.equal(ev.c, general);
  await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "thread" && m.e.th.id === tid && m.e.th.count === 1);
  const list = await call(base + "/channels/" + general + "/messages", { token: B });
  const rootMsg = list.body.messages.find((m) => m.id === root.body.message.id);
  assert.equal(rootMsg.th.id, tid);
  assert.equal(rootMsg.th.count, 1);
  const tmsgs = await call(base + "/channels/" + tid + "/messages", { token: A });
  assert.equal(tmsgs.body.messages.length, 1);
  const meta = await call(base + "/channels/" + tid, { token: A });
  assert.equal(meta.status, 200, meta.text);
  assert.equal(meta.body.thread.parentId, general);
  /* Lock: members cannot post; the owner (manager) can. */
  assert.equal((await call(base + "/channels/" + tid, { method: "PATCH", token: A, body: { locked: true } })).status, 403);
  assert.equal((await call(base + "/channels/" + tid, { method: "PATCH", token: O, body: { locked: true } })).status, 200);
  assert.equal((await call(base + "/channels/" + tid + "/messages", { method: "POST", token: B, body: { body: "late" } })).status, 403);
  assert.equal((await call(base + "/channels/" + tid + "/messages", { method: "POST", token: O, body: { body: "Locked, see #general" } })).status, 200);
  /* Thread without a root leaves a notice in the parent. */
  const free = await call(base + "/channels/" + general + "/threads", { method: "POST", token: B, body: { name: "Side chat", body: "hi" } });
  assert.equal(free.status, 200, free.text);
  const notice = await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "msg" && m.e.ch === general && m.e.m.f === 2);
  assert.equal(JSON.parse(notice.e.m.b).t, free.body.thread.id);
  const active = await call(base + "/threads", { token: A });
  assert.equal(active.body.threads.length, 2);
  /* Search finds thread messages and names the thread. */
  const found = await call(base + "/search?q=Count", { token: A });
  assert.equal(found.body.messages.length, 1);
  assert.equal(found.body.threads[tid].name, "Let's plan the trip");

  /* Forum channel with tags; posts are threads with a starter. */
  const forum = await call(base + "/channels", { method: "POST", token: O, body: { name: "help", kind: "forum" } });
  assert.equal(forum.status, 200, forum.text);
  const fid = forum.body.channel.id;
  const tags = await call(base + "/channels/" + fid + "/tags", { method: "PUT", token: O, body: { tags: [{ name: "Bug", emoji: "🐞" }, { name: "Idea" }] } });
  assert.equal(tags.status, 200, tags.text);
  assert.equal((await call(base + "/channels/" + fid + "/messages", { method: "POST", token: A, body: { body: "x" } })).status, 400);
  assert.equal((await call(base + "/channels/" + fid + "/threads", { method: "POST", token: A, body: { name: "No body" } })).status, 400);
  const post = await call(base + "/channels/" + fid + "/threads", { method: "POST", token: A, body: { name: "App crashes", body: "Steps to reproduce", tags: [tags.body.tags[0].id, "ffffffffffffffff"] } });
  assert.equal(post.status, 200, post.text);
  assert.deepEqual(post.body.thread.tags, [tags.body.tags[0].id]);
  assert.equal(post.body.thread.starter.b, "Steps to reproduce");
  const posts = await call(base + "/channels/" + fid + "/threads", { token: B });
  assert.equal(posts.body.threads.length, 1);
  assert.equal(posts.body.threads[0].starter.b, "Steps to reproduce");
  const byTag = await call(base + "/channels/" + fid + "/threads?tag=" + tags.body.tags[1].id, { token: B });
  assert.equal(byTag.body.threads.length, 0);
  const fstate = await call(base, { token: B });
  assert.equal(fstate.body.channels.find((c) => c.id === fid).tags.length, 2);

  /* Polls: single choice, change vote, end early, voters. */
  const poll = await call(base + "/channels/" + general + "/messages", { method: "POST", token: A, body: { poll: { q: "Lunch?", o: ["Pizza", "Sushi", "Tacos"], hours: 24 } } });
  assert.equal(poll.status, 200, poll.text);
  const pmid = poll.body.message.id;
  assert.equal(poll.body.message.pl.o.length, 3);
  assert.equal((await call(base + "/channels/" + general + "/messages", { method: "POST", token: A, body: { poll: { q: "Bad", o: ["one"] } } })).status, 400);
  const v1 = await call(base + "/channels/" + general + "/messages/" + pmid + "/poll", { method: "PUT", token: B, body: { o: [1, 2] } });
  assert.equal(v1.status, 200, v1.text);
  assert.deepEqual(v1.body.poll.mine, [1]);
  await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "poll" && m.e.id === pmid);
  await call(base + "/channels/" + general + "/messages/" + pmid + "/poll", { method: "PUT", token: O, body: { o: [1] } });
  const v2 = await call(base + "/channels/" + general + "/messages/" + pmid + "/poll", { method: "PUT", token: B, body: { o: [0] } });
  assert.equal(v2.body.poll.o[0].n, 1);
  assert.equal(v2.body.poll.o[1].n, 1);
  assert.equal(v2.body.poll.voters, 2);
  const voters = await call(base + "/channels/" + general + "/messages/" + pmid + "/poll/voters?o=0", { token: A });
  assert.deepEqual(voters.body.voters, [boMid]);
  assert.equal((await call(base + "/channels/" + general + "/messages/" + pmid + "/poll/end", { method: "POST", token: B })).status, 403);
  assert.equal((await call(base + "/channels/" + general + "/messages/" + pmid + "/poll/end", { method: "POST", token: A })).status, 200);
  assert.equal((await call(base + "/channels/" + general + "/messages/" + pmid + "/poll", { method: "PUT", token: B, body: { o: [2] } })).status, 409);
  const plist = await call(base + "/channels/" + general + "/messages", { token: B });
  const pm = plist.body.messages.find((m) => m.id === pmid);
  assert.equal(pm.pl.ended, true);
  assert.deepEqual(pm.pl.mine, [0]);

  /* Stickers: managers upload, anyone sends. */
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  assert.equal((await call(base + "/upload?kind=sticker&sticker=wave", { method: "POST", token: A, raw: png, type: "image/png" })).status, 403);
  const stk = await call(base + "/upload?kind=sticker&sticker=wave", { method: "POST", token: O, raw: png, type: "image/png" });
  assert.equal(stk.status, 200, stk.text);
  const sent = await call(base + "/channels/" + general + "/messages", { method: "POST", token: B, body: { sticker: stk.body.sticker.id } });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.body.message.st.name, "wave");
  const img = await call(new URL(sent.body.message.st.url).pathname + new URL(sent.body.message.st.url).search);
  assert.equal(img.status, 200);
  assert.equal((await call(base, { token: B })).body.stickers.length, 1);
  assert.equal((await call(base + "/stickers/" + stk.body.sticker.id, { method: "DELETE", token: O })).status, 200);
  const gone = (await call(base + "/channels/" + general + "/messages", { token: B })).body.messages.find((m) => m.id === sent.body.message.id);
  assert.equal(gone.st.gone, true);

  /* Events with RSVP. */
  const start = Date.now() + 86400000;
  assert.equal((await call(base + "/events", { method: "POST", token: A, body: { name: "Game night", startAt: start } })).status, 403);
  const evt = await call(base + "/events", { method: "POST", token: O, body: { name: "Game night", description: "Bring snacks", location: "Online", startAt: start, endAt: start + 7200000 } });
  assert.equal(evt.status, 200, evt.text);
  const eid = evt.body.event.id;
  assert.equal(evt.body.event.going, 1);
  await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "event" && m.e.ev.id === eid);
  const r1 = await call(base + "/events/" + eid + "/rsvp", { method: "PUT", token: B, body: { status: "interested" } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.body.interested, 1);
  const r2 = await call(base + "/events/" + eid + "/rsvp", { method: "PUT", token: B, body: { status: "going" } });
  assert.equal(r2.body.going, 2);
  assert.equal(r2.body.interested, 0);
  const evs = await call(base + "/events", { token: B });
  assert.equal(evs.body.events[0].mine, "going");
  assert.equal(evs.body.canManage, false);
  assert.equal((await call(base, { token: B })).body.events, 1);
  const rs = await call(base + "/events/" + eid + "/rsvps", { token: A });
  assert.equal(rs.body.rsvps.length, 2);
  assert.equal((await call(base + "/events/" + eid, { method: "PATCH", token: B, body: { name: "Mine" } })).status, 403);
  assert.equal((await call(base + "/events/" + eid, { method: "PATCH", token: O, body: { status: "cancelled" } })).status, 200);
  assert.equal((await call(base + "/events", { token: B })).body.events.length, 0);
  assert.equal((await call(base + "/events", { method: "POST", token: O, body: { name: "Past", startAt: Date.now() - 86400000 } })).status, 400);

  /* Rich presence over the room socket. */
  const sockA = await openSocket(A, sid, "198.51.100.41");
  await waitFor(sockA.messages, (m) => m.op === "ready");
  sockA.ws.send(JSON.stringify({ op: "activity", act: { k: "listening", n: "Song title", d: "Artist", s: Date.now() } }));
  const act = await waitFor(sockB.messages, (m) => m.op === "activity" && m.a === anaMid);
  assert.equal(act.act.k, "listening");
  assert.equal(act.act.n, "Song title");
  sockA.ws.send(JSON.stringify({ op: "activity", act: { k: "hacking", n: "x" } }));
  await waitFor(sockB.messages, (m) => m.op === "activity" && m.a === anaMid && m.act === null);
  sockA.ws.send(JSON.stringify({ op: "activity", act: { k: "custom", n: "Out for lunch", e: "🍕" } }));
  await waitFor(sockB.messages, (m) => m.op === "activity" && m.a === anaMid && m.act && m.act.k === "custom");
  const sockB2 = await openSocket(B, sid, "198.51.100.42");
  const ready2 = await waitFor(sockB2.messages, (m) => m.op === "ready");
  assert.equal(ready2.acts[anaMid].n, "Out for lunch");
  /* Thread typing gates on the parent channel. */
  sockA.ws.send(JSON.stringify({ op: "typing", c: tid, p: general }));
  await waitFor(sockB.messages, (m) => m.op === "typing" && m.c === tid && m.a === anaMid);

  /* Deleting the thread and the forum cleans up. */
  assert.equal((await call(base + "/channels/" + tid, { method: "DELETE", token: A })).status, 403);
  assert.equal((await call(base + "/channels/" + tid, { method: "DELETE", token: O })).status, 200);
  assert.equal((await call(base + "/channels/" + tid + "/messages", { token: A })).status, 404);
  assert.equal((await call(base + "/channels/" + fid, { method: "DELETE", token: O })).status, 200);
  assert.equal((await call(base + "/channels/" + post.body.thread.id + "/messages", { token: A })).status, 404);
  [sockA, sockB, sockB2].forEach((s) => { try { s.ws.close(); } catch (e) { /* closed */ } });
  assert.equal((await call(base, { method: "DELETE", token: O })).status, 200);
});
