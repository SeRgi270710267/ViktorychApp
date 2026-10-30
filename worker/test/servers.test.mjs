import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { PERM, ALL_PERMS, basePerms, channelPerms, parseMentions, cleanReaction, messageId, messageTime } from "../../shared/server-perms.js";

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

test("permission math follows category, channel, role and member order", () => {
  const roles = new Map([
    ["s000000000000000", { perms: PERM.VIEW | PERM.SEND, position: 0 }],
    ["r000000000000001", { perms: PERM.MANAGE_MESSAGES, position: 1 }]
  ]);
  const base = basePerms({ roles, everyoneId: "s000000000000000", memberRoles: ["r000000000000001"] });
  assert.equal(base, PERM.VIEW | PERM.SEND | PERM.MANAGE_MESSAGES);
  const cat = [{ target_type: "role", target_id: "s000000000000000", allow: 0, deny: PERM.SEND }];
  const chan = [{ target_type: "role", target_id: "r000000000000001", allow: PERM.SEND, deny: 0 }];
  assert.equal(channelPerms(base, { layers: [cat, []], everyoneId: "s000000000000000", memberRoles: [], accountId: "m" }) & PERM.SEND, 0);
  assert.ok(channelPerms(base, { layers: [cat, chan], everyoneId: "s000000000000000", memberRoles: ["r000000000000001"], accountId: "m" }) & PERM.SEND);
  const hide = [{ target_type: "member", target_id: "aaaaaaaaaaaaaaaa", allow: 0, deny: PERM.VIEW }];
  assert.equal(channelPerms(base, { layers: [hide], everyoneId: "s000000000000000", memberRoles: [], accountId: "aaaaaaaaaaaaaaaa" }), 0);
  assert.equal(channelPerms(base, { layers: [], everyoneId: "s000000000000000", memberRoles: [], accountId: "m", timedOut: true }), PERM.VIEW);
  assert.equal(basePerms({ isOwner: true }), ALL_PERMS);
  const m = parseMentions("hi <@0123456789abcdef> and <@&fedcba9876543210> @everyone");
  assert.deepEqual(m, { users: ["0123456789abcdef"], roles: ["fedcba9876543210"], everyone: true });
  assert.equal(parseMentions("mail me at x@everyone.com").everyone, false);
  assert.equal(cleanReaction("👍🏽"), "👍🏽");
  assert.equal(cleanReaction("<script>"), "");
  assert.equal(cleanReaction("abc"), "");
  const id = messageId(1700000000000, "zz9");
  assert.equal(id.length, 16);
  assert.equal(messageTime(id), 1700000000000);
  assert.ok(messageId(1700000000001, "0") > id);
});

test("native servers: owner-only create, invites, roles, messages, moderation, files, realtime", async () => {
  const owner = await signup("198.51.100.20", OWNER, "Owner", "claim-test");
  const ana = await signup("198.51.100.21", "srv_ana", "Ana Srv");
  const bo = await signup("198.51.100.22", "srv_bo", "Bo Srv");
  const O = owner.token;
  const A = ana.token;
  const B = bo.token;

  /* Only the app owner creates servers. */
  const denied = await call("/v1/servers", { method: "POST", token: A, body: { name: "Nope" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "owner_only");
  const listA = await call("/v1/servers", { token: A });
  assert.equal(listA.body.canCreate, false);
  const listO = await call("/v1/servers", { token: O });
  assert.equal(listO.body.canCreate, true);
  const made = await call("/v1/servers", { method: "POST", token: O, body: { name: "Test Hall" } });
  assert.equal(made.status, 200, made.text);
  const sid = made.body.server.id;
  const general = made.body.channelId;
  const state = await call("/v1/servers/" + sid, { token: O });
  assert.equal(state.status, 200, state.text);
  const news = state.body.channels.find((c) => c.kind === "announcement");
  assert.ok(news);
  assert.equal(state.body.channels.filter((c) => c.kind === "category").length, 2);
  assert.equal(state.body.channels.filter((c) => c.kind === "voice").length, 1);
  const ownerMid = state.body.me.mid;
  assert.match(ownerMid, /^[a-f0-9]{16}$/);

  /* Non-members cannot read. */
  assert.equal((await call("/v1/servers/" + sid, { token: A })).status, 403);

  /* Invite with one use, expiry. */
  const inv = await call("/v1/servers/" + sid + "/invites", { method: "POST", token: O, body: { maxUses: 1, expiresIn: 3600 } });
  assert.equal(inv.status, 200, inv.text);
  const code = inv.body.invite.code;
  const preview = await call("/v1/servers/invite/" + code);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.server.name, "Test Hall");
  const joinA = await call("/v1/servers/invite/" + code + "/join", { method: "POST", token: A });
  assert.equal(joinA.status, 200, joinA.text);
  assert.equal(joinA.body.serverId, sid);
  const usedUp = await call("/v1/servers/invite/" + code + "/join", { method: "POST", token: B });
  assert.equal(usedUp.status, 404);
  assert.equal(usedUp.body.error, "used_up");
  const inv2 = await call("/v1/servers/" + sid + "/invites", { method: "POST", token: O, body: { maxUses: 0, expiresIn: 0 } });
  assert.equal((await call("/v1/servers/invite/" + inv2.body.invite.code + "/join", { method: "POST", token: B })).status, 200);

  const stateA = await call("/v1/servers/" + sid, { token: A });
  const anaMid = stateA.body.me.mid;
  const stateB = await call("/v1/servers/" + sid, { token: B });
  const boMid = stateB.body.me.mid;
  assert.notEqual(anaMid, boMid);

  /* Members list hides account ids and shows cards. */
  const members = await call("/v1/servers/" + sid + "/members", { token: A });
  assert.equal(members.status, 200);
  assert.equal(members.body.members.length, 3);
  assert.ok(!members.text.includes(owner.account.publicId));
  assert.ok(!members.text.includes(ana.account.publicId));
  assert.ok(members.body.members.some((m) => m.card && m.card.handle === "srv_bo"));

  /* Announcement channel: members cannot post, owner can. */
  const noNews = await call("/v1/servers/" + sid + "/channels/" + news.id + "/messages", { method: "POST", token: A, body: { body: "hi" } });
  assert.equal(noNews.status, 403);
  const yesNews = await call("/v1/servers/" + sid + "/channels/" + news.id + "/messages", { method: "POST", token: O, body: { body: "Welcome @everyone" } });
  assert.equal(yesNews.status, 200, yesNews.text);
  assert.equal(yesNews.body.message.mn.e, true);

  /* Realtime: Bo watches general, Ana sends a mention. */
  const sockB = await openSocket(B, sid, "198.51.100.22");
  await waitFor(sockB.messages, (m) => m.op === "ready");
  const sockA = await openSocket(A, sid, "198.51.100.21");
  await waitFor(sockB.messages, (m) => m.op === "online" && m.a === anaMid && m.on === true);
  sockA.ws.send(JSON.stringify({ op: "typing", c: general }));
  await waitFor(sockB.messages, (m) => m.op === "typing" && m.c === general && m.a === anaMid);

  const sent = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: A, body: { body: "hey <@" + boMid + "> look", nonce: "n1" } });
  assert.equal(sent.status, 200, sent.text);
  const msgId = sent.body.message.id;
  assert.deepEqual(sent.body.message.mn.u, [boMid]);
  const live = await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "msg" && m.e.m.id === msgId);
  assert.equal(live.e.m.a, anaMid);

  /* Bo sees one mention badge and unread state. */
  const boList = await call("/v1/servers", { token: B });
  const gB = boList.body.servers[0].channels.find((c) => c.id === general);
  assert.equal(gB.mentions, 1);
  assert.ok(gB.lastId > gB.lastRead);
  await call("/v1/servers/" + sid + "/channels/" + general + "/read", { method: "POST", token: B, body: { id: msgId } });
  const boList2 = await call("/v1/servers", { token: B });
  const gB2 = boList2.body.servers[0].channels.find((c) => c.id === general);
  assert.equal(gB2.mentions, 0);
  assert.equal(gB2.lastRead, msgId);

  /* Reply, reaction, edit. */
  const reply = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: B, body: { body: "yes?", replyTo: msgId } });
  assert.equal(reply.body.message.r.id, msgId);
  assert.deepEqual(reply.body.message.mn.u, [anaMid]);
  const rx = await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + msgId + "/reactions/" + encodeURIComponent("🔥"), { method: "PUT", token: B });
  assert.equal(rx.status, 200, rx.text);
  assert.equal(rx.body.n, 1);
  await waitFor(sockB.messages, (m) => m.op === "event" && m.e.t === "rx" && m.e.id === msgId);
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + msgId + "/reactions/abc", { method: "PUT", token: B })).status, 400);
  const notMine = await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + msgId, { method: "PATCH", token: B, body: { body: "hack" } });
  assert.equal(notMine.status, 403);
  const edited = await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + msgId, { method: "PATCH", token: A, body: { body: "hey edited" } });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.message.e > 0);
  const page = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { token: B });
  const got = page.body.messages.find((m) => m.id === msgId);
  assert.equal(got.b, "hey edited");
  assert.deepEqual(got.rx, [{ e: "🔥", n: 1, me: true }]);
  assert.ok(page.body.messages.some((m) => m.f === 1), "join system message");

  /* Cards by member id, no account ids. */
  const cards = await call("/v1/servers/" + sid + "/cards?m=" + anaMid + "," + boMid, { token: B });
  assert.equal(cards.body.cards[anaMid].handle, "srv_ana");
  assert.ok(!cards.text.includes(ana.account.publicId));

  /* Roles: a mod role with manage messages. Ana gets it. */
  const role = await call("/v1/servers/" + sid + "/roles", { method: "POST", token: O, body: { name: "Mods", color: 0x1d9bf0, perms: PERM.MANAGE_MESSAGES | PERM.KICK | PERM.MODERATE, hoist: true } });
  assert.equal(role.status, 200, role.text);
  const rid = role.body.role.id;
  assert.equal((await call("/v1/servers/" + sid + "/members/" + anaMid, { method: "PATCH", token: B, body: { roles: [rid] } })).status, 403);
  assert.equal((await call("/v1/servers/" + sid + "/members/" + anaMid, { method: "PATCH", token: O, body: { roles: [rid] } })).status, 200);
  await waitFor(sockA.messages, (m) => m.op === "resync");

  /* Moderator removal leaves a stub and a public mod log entry. */
  const bad = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: B, body: { body: "spam spam" } });
  const removed = await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + bad.body.message.id + "?reason=spam", { method: "DELETE", token: A });
  assert.equal(removed.status, 200, removed.text);
  assert.equal(removed.body.removed, "stub");
  assert.equal(removed.body.message.x.by, anaMid);
  assert.equal(removed.body.message.x.reason, "spam");
  assert.equal(removed.body.message.b, "");
  const log = await call("/v1/servers/" + sid + "/modlog", { token: B });
  assert.ok(log.body.entries.some((e) => e.action === "message_remove" && e.by === anaMid && e.detail.reason === "spam"));
  /* Removed text is for message moderators only. */
  assert.equal(removed.body.message.x.text, "spam spam");
  assert.ok(!log.text.includes("spam spam"));
  assert.ok((await call("/v1/servers/" + sid + "/modlog", { token: A })).text.includes("spam spam"));
  const seenB = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { token: B });
  const stubB = seenB.body.messages.find((m) => m.id === bad.body.message.id);
  assert.ok(stubB && stubB.x && !stubB.x.text && !seenB.text.includes("spam spam"));
  const seenA = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { token: A });
  assert.equal(seenA.body.messages.find((m) => m.id === bad.body.message.id).x.text, "spam spam");
  /* Mods cannot touch the server owner's messages. */
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + news.id + "/messages/" + yesNews.body.message.id, { method: "DELETE", token: A })).status, 403);
  /* Authors delete their own messages fully. */
  const gone = await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + reply.body.message.id, { method: "DELETE", token: B });
  assert.equal(gone.body.removed, "deleted");
  await waitFor(sockA.messages, (m) => m.op === "event" && m.e.t === "del" && m.e.id === reply.body.message.id);

  /* Pins need manage messages. */
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + general + "/pins/" + msgId, { method: "PUT", token: B })).status, 403);
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + general + "/pins/" + msgId, { method: "PUT", token: A })).status, 200);
  const pins = await call("/v1/servers/" + sid + "/channels/" + general + "/pins", { token: B });
  assert.equal(pins.body.messages.length, 1);

  /* Private channel through overrides; Bo cannot see it. */
  const priv = await call("/v1/servers/" + sid + "/channels", { method: "POST", token: O, body: { kind: "text", name: "Mod Room", private: true } });
  assert.equal(priv.body.channel.name, "mod-room");
  const pcid = priv.body.channel.id;
  await call("/v1/servers/" + sid + "/channels/" + pcid + "/overrides/role/" + rid, { method: "PUT", token: O, body: { allow: PERM.VIEW | PERM.SEND } });
  const seeA = await call("/v1/servers/" + sid, { token: A });
  assert.ok(seeA.body.channels.some((c) => c.id === pcid));
  const seeB = await call("/v1/servers/" + sid, { token: B });
  assert.ok(!seeB.body.channels.some((c) => c.id === pcid));
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + pcid + "/messages", { token: B })).status, 404);

  /* Slow mode. */
  await call("/v1/servers/" + sid + "/channels/" + general, { method: "PATCH", token: O, body: { slowmode: 30 } });
  /* Bo posted seconds ago, so the next post waits; mods bypass. */
  const slow = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: B, body: { body: "two" } });
  assert.ok(slow.body.retry > 0 && slow.body.retry <= 30);
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: A, body: { body: "mod talk" } })).status, 200);
  assert.equal(slow.status, 429);
  assert.equal(slow.body.error, "slowmode");
  await call("/v1/servers/" + sid + "/channels/" + general, { method: "PATCH", token: O, body: { slowmode: 0 } });

  /* Search. */
  const found = await call("/v1/servers/" + sid + "/search?q=edited", { token: B });
  assert.equal(found.body.messages.length, 1);
  assert.equal((await call("/v1/servers/" + sid + "/search?q=spam", { token: B })).body.messages.length, 0);

  /* Attachments: stored byte for byte, signed URL, ranges. */
  const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const up = await call("/v1/servers/" + sid + "/upload?kind=a&name=" + encodeURIComponent("shot.png"), { method: "POST", token: B, raw: bytes, type: "image/png" });
  assert.equal(up.status, 200, up.text);
  const withFile = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: B, body: { body: "", attachments: [{ k: up.body.file.k, w: 10, h: 20 }] } });
  assert.equal(withFile.status, 200, withFile.text);
  const file = withFile.body.message.at[0];
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 5000);
  const path = new URL(file.url).pathname + new URL(file.url).search;
  const whole = await call(path);
  assert.equal(whole.status, 200);
  assert.ok(whole.buf.equals(bytes));
  assert.equal(whole.headers.get("x-content-type-options"), "nosniff");
  const part = await call(path, { headers: { Range: "bytes=100-199" } });
  assert.equal(part.status, 206);
  assert.ok(part.buf.equals(bytes.subarray(100, 200)));
  assert.equal((await call(path.replace(/s=[a-f0-9]+/, "s=" + "0".repeat(32)))).status, 403);
  /* Someone else's upload key cannot be attached. */
  const stolen = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: A, body: { body: "", attachments: [{ k: up.body.file.k }] } });
  assert.equal(stolen.status, 400);
  /* Non-media downloads instead of rendering. */
  const html = await call("/v1/servers/" + sid + "/upload?kind=a&name=x.html", { method: "POST", token: B, raw: Buffer.from("<script>1</script>"), type: "text/html" });
  const htmlMsg = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: B, body: { attachments: [{ k: html.body.file.k }] } });
  const hp = new URL(htmlMsg.body.message.at[0].url);
  const served = await call(hp.pathname + hp.search);
  assert.equal(served.headers.get("content-type"), "application/octet-stream");
  assert.match(served.headers.get("content-disposition"), /^attachment/);

  /* Custom emoji: manage server only, then usable as a reaction. */
  assert.equal((await call("/v1/servers/" + sid + "/upload?kind=emoji&name=party.png&emoji=party", { method: "POST", token: B, raw: Buffer.from([137, 80, 78, 71]), type: "image/png" })).status, 403);
  const emo = await call("/v1/servers/" + sid + "/upload?kind=emoji&name=party.png&emoji=party", { method: "POST", token: O, raw: Buffer.from([137, 80, 78, 71]), type: "image/png" });
  assert.equal(emo.status, 200, emo.text);
  const crx = await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + msgId + "/reactions/c:" + emo.body.emoji.id, { method: "PUT", token: B });
  assert.equal(crx.status, 200, crx.text);
  const icon = await call("/v1/servers/" + sid + "/upload?kind=icon&name=i.png", { method: "POST", token: O, raw: Buffer.from([137, 80, 78, 71, 1, 2]), type: "image/png" });
  assert.equal(icon.status, 200);
  const iu = new URL(icon.body.url);
  assert.equal((await call(iu.pathname + iu.search)).buf.length, 6);

  /* Timeout blocks sending and reacting. */
  const to = await call("/v1/servers/" + sid + "/members/" + boMid + "/timeout", { method: "POST", token: A, body: { seconds: 60, reason: "cool off" } });
  assert.equal(to.status, 200, to.text);
  const muted = await call("/v1/servers/" + sid + "/channels/" + general + "/messages", { method: "POST", token: B, body: { body: "let me talk" } });
  assert.equal(muted.status, 403);
  assert.equal(muted.body.error, "timed_out");
  await call("/v1/servers/" + sid + "/members/" + boMid + "/timeout", { method: "POST", token: A, body: { seconds: 0 } });
  assert.equal((await call("/v1/servers/" + sid + "/channels/" + general + "/messages/" + msgId + "/reactions/" + encodeURIComponent("👍"), { method: "PUT", token: B })).status, 200);

  /* Notification level. */
  assert.equal((await call("/v1/servers/" + sid + "/notify", { method: "PUT", token: B, body: { scope: general, level: "none" } })).status, 200);
  const nState = await call("/v1/servers/" + sid, { token: B });
  assert.equal(nState.body.notify[general], "none");

  /* Kick drops the socket; ban blocks rejoin. Mods cannot kick the owner. */
  assert.equal((await call("/v1/servers/" + sid + "/members/" + ownerMid, { method: "DELETE", token: A })).status, 403);
  const kicked = await call("/v1/servers/" + sid + "/members/" + boMid + "?reason=bye", { method: "DELETE", token: A });
  assert.equal(kicked.status, 200, kicked.text);
  assert.equal((await call("/v1/servers/" + sid, { token: B })).status, 403);
  await waitFor(sockA.messages, (m) => m.op === "online" && m.a === boMid && m.on === false);
  const inv3 = await call("/v1/servers/" + sid + "/invites", { method: "POST", token: O, body: {} });
  assert.equal((await call("/v1/servers/invite/" + inv3.body.invite.code + "/join", { method: "POST", token: B })).status, 200);
  const banned = await call("/v1/servers/" + sid + "/bans", { method: "POST", token: O, body: { m: boMid, reason: "rules" } });
  assert.equal(banned.status, 200, banned.text);
  const rejoin = await call("/v1/servers/invite/" + inv3.body.invite.code + "/join", { method: "POST", token: B });
  assert.equal(rejoin.status, 403);
  assert.equal(rejoin.body.error, "banned");
  const bans = await call("/v1/servers/" + sid + "/bans", { token: O });
  assert.equal(bans.body.bans[0].m, boMid);
  assert.equal((await call("/v1/servers/" + sid + "/bans/" + boMid, { method: "DELETE", token: O })).status, 200);
  const log2 = await call("/v1/servers/" + sid + "/modlog", { token: A });
  ["member_kick", "member_ban", "member_unban", "member_timeout", "role_create", "channel_create"].forEach((a) => {
    assert.ok(log2.body.entries.some((e) => e.action === a), a);
  });
  assert.ok(!log2.text.includes(bo.account.publicId));

  /* Owner cannot leave; Ana can. */
  assert.equal((await call("/v1/servers/" + sid + "/leave", { method: "POST", token: O })).status, 400);
  assert.equal((await call("/v1/servers/" + sid + "/leave", { method: "POST", token: A })).status, 200);

  /* Owner deletes the server. */
  try { sockA.ws.close(); } catch (e) { /* closed */ }
  try { sockB.ws.close(); } catch (e) { /* closed */ }
  assert.equal((await call("/v1/servers/" + sid, { method: "DELETE", token: O })).status, 200);
  assert.equal((await call("/v1/servers/" + sid, { token: O })).status, 404);
});
