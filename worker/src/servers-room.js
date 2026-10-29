/* Realtime for native Messages servers on the existing AccountChannel class.
   The object name is "srv:" plus the server id, so no new class or binding.
   Sockets hibernate. The Worker writes messages to D1 and then posts one
   event here; this object only fans it out to sockets that can see the
   channel. Typing indicators travel socket to socket and are never stored.

   Server to client: {op:"ready", online:[ids]} {op:"event", c, e}
   {op:"typing", c, a:memberId} {op:"online", a:memberId, on} {op:"resync"}
   {op:"activity", a:memberId, act} with act {k, n, d, s} or null.
   Client to server: {op:"typing", c, p?} {op:"view", c} {op:"activity", act}
   Typing in a thread names the thread as c and its parent channel as p;
   the parent decides who may see it. Activities (rich presence) live only
   on the socket attachments, so they vanish with the last socket. */
const ACT_KINDS = ["playing", "listening", "watching", "custom"];

/* Rich presence from the client: kind, name, detail, start time. */
export function cleanActivity(raw) {
  if (!raw || typeof raw !== "object") return null;
  const k = String(raw.k || "");
  if (ACT_KINDS.indexOf(k) < 0) return null;
  const strip = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
  const n = strip(raw.n, 64);
  const d = strip(raw.d, 96);
  const e = k === "custom" ? strip(raw.e, 16) : "";
  if (!n && !e) return null;
  const s = Math.floor(Number(raw.s) || 0);
  return { k, n, d, e, s: s > 0 && s <= Date.now() + 60000 ? s : 0 };
}

function activities(room) {
  const out = {};
  const at = {};
  socketsOf(room).forEach((ws) => {
    const a = att(ws);
    if (!a.x || !MEMBER.test(String(a.m || ""))) return;
    if (!at[a.m] || (Number(a.xt) || 0) > at[a.m]) { out[a.m] = a.x; at[a.m] = Number(a.xt) || 0; }
  });
  return out;
}
/* Internal stub routes (not public):
     POST https://srv.internal/event   {c, e, to?:[accountIds]}
     POST https://srv.internal/resync  {a?}
     POST https://srv.internal/drop    {a}
     GET  https://srv.internal/online */

const NAME = /^srv:[a-f0-9]{16}$/;
const ACCOUNT = /^\d{12}$/;
const CHANNEL = /^[a-f0-9]{16}$/;
const MEMBER = /^[a-f0-9]{16}$/;
const MSG_MAX = 2000;
const MSG_RATE = 30;
const MSG_WINDOW = 10000;
const TYPING_GAP = 2500;
const SOCKET_CAP = 2000;

export function isSrvName(name) {
  return NAME.test(String(name || ""));
}

function objectName(ctx) {
  try { return (ctx.id && ctx.id.name) || ""; }
  catch (err) { return ""; }
}

function socketsOf(room) {
  try { return room.ctx.getWebSockets() || []; }
  catch (err) { return []; }
}

function att(ws) {
  try { return ws.deserializeAttachment() || {}; }
  catch (err) { return {}; }
}

function send(ws, text) {
  try { ws.send(text); }
  catch (err) { /* a closing socket drops on its own close */ }
}

function onlineIds(room, except) {
  const out = new Set();
  socketsOf(room).forEach((ws) => {
    if (ws === except) return;
    const m = att(ws).m;
    if (MEMBER.test(String(m || ""))) out.add(m);
  });
  return Array.from(out);
}

function broadcastText(room, text, filter) {
  let n = 0;
  socketsOf(room).forEach((ws) => {
    if (filter && !filter(att(ws), ws)) return;
    send(ws, text);
    n += 1;
  });
  return n;
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (!text || text.length > 64000) return {};
    const body = JSON.parse(text);
    return body && typeof body === "object" ? body : {};
  } catch (err) { return {}; }
}

export async function srvFetch(room, request) {
  if (!isSrvName(objectName(room.ctx))) return new Response("server", { status: 403 });
  const url = new URL(request.url);
  if (url.hostname === "srv.internal") return srvInternal(room, request, url);
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("not found", { status: 404 });
  const account = String(request.headers.get("x-account-id") || "");
  const member = String(request.headers.get("x-member-id") || "");
  if (!ACCOUNT.test(account) || !MEMBER.test(member)) return new Response("account", { status: 403 });
  const visible = String(request.headers.get("x-srv-visible") || "").split(",").filter((id) => CHANNEL.test(id)).slice(0, 500);
  const sockets = socketsOf(room);
  if (sockets.length >= SOCKET_CAP) return new Response("full", { status: 503 });
  const wasOnline = sockets.some((ws) => att(ws).a === account);
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  room.ctx.acceptWebSocket(server);
  server.serializeAttachment({ a: account, m: member, v: visible, c: "", n: 0, w: Date.now(), t: 0 });
  send(server, JSON.stringify({ op: "ready", me: member, online: onlineIds(room, server).concat([member]).filter((v, i, all) => all.indexOf(v) === i), acts: activities(room) }));
  if (!wasOnline) broadcastText(room, JSON.stringify({ op: "online", a: member, on: true }), (a) => a.a !== account);
  return new Response(null, { status: 101, webSocket: client });
}

export async function srvMessage(room, ws, message) {
  const text = typeof message === "string" ? message : "";
  if (!text || text.length > MSG_MAX) return;
  const a = att(ws);
  const now = Date.now();
  if (now - (Number(a.w) || 0) >= MSG_WINDOW) { a.w = now; a.n = 0; }
  a.n = (Number(a.n) || 0) + 1;
  if (a.n > MSG_RATE) {
    try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
    return;
  }
  let msg = null;
  try { msg = JSON.parse(text); }
  catch (err) { msg = null; }
  if (!msg || typeof msg !== "object") {
    try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
    return;
  }
  const visible = Array.isArray(a.v) ? a.v : [];
  if (msg.op === "view") {
    a.c = CHANNEL.test(String(msg.c || "")) && visible.indexOf(msg.c) >= 0 ? msg.c : "";
    try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
    return;
  }
  if (msg.op === "activity") {
    const act = cleanActivity(msg.act);
    if (JSON.stringify(act || null) === JSON.stringify(a.x || null)) {
      try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
      return;
    }
    a.x = act;
    a.xt = now;
    try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
    /* Other tabs of the same person keep theirs; the newest one shows. */
    socketsOf(room).forEach((other) => {
      if (other === ws) return;
      const o = att(other);
      if (o.a !== a.a || JSON.stringify(o.x || null) === JSON.stringify(act || null)) return;
      o.x = act; o.xt = now;
      try { other.serializeAttachment(o); } catch (err) { /* closing */ }
    });
    broadcastText(room, JSON.stringify({ op: "activity", a: a.m, act: act }), () => true);
    return;
  }
  if (msg.op === "typing") {
    const c = String(msg.c || "");
    const p = String(msg.p || "");
    const gate = p && CHANNEL.test(p) ? p : c;
    if (!CHANNEL.test(c) || visible.indexOf(gate) < 0) return;
    if (now - (Number(a.t) || 0) < TYPING_GAP) {
      try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
      return;
    }
    a.t = now;
    try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
    const payload = JSON.stringify({ op: "typing", c: c, a: a.m });
    broadcastText(room, payload, (other) => other.a !== a.a && Array.isArray(other.v) && other.v.indexOf(gate) >= 0);
    return;
  }
  try { ws.serializeAttachment(a); } catch (err) { /* closing */ }
}

export function srvClose(room, ws) {
  const me = att(ws);
  const account = me.a;
  if (!ACCOUNT.test(String(account || ""))) return;
  const still = socketsOf(room).some((other) => other !== ws && att(other).a === account);
  if (!still) broadcastText(room, JSON.stringify({ op: "online", a: me.m, on: false }), (other, sock) => sock !== ws);
}

async function srvInternal(room, request, url) {
  if (request.method === "GET" && url.pathname === "/online") return Response.json({ ids: onlineIds(room, null) });
  if (request.method !== "POST") return new Response("method", { status: 405 });
  const body = await readBody(request);
  if (url.pathname === "/event") {
    const c = String(body.c || "");
    const to = Array.isArray(body.to) ? new Set(body.to.filter((id) => ACCOUNT.test(String(id)))) : null;
    const payload = JSON.stringify({ op: "event", c: c, e: body.e || {} });
    const n = broadcastText(room, payload, (a) => {
      if (to && !to.has(a.a)) return false;
      if (!c) return true;
      return Array.isArray(a.v) && a.v.indexOf(c) >= 0;
    });
    return Response.json({ ok: true, sent: n });
  }
  if (url.pathname === "/resync") {
    const who = ACCOUNT.test(String(body.a || "")) ? body.a : "";
    broadcastText(room, JSON.stringify({ op: "resync" }), (a) => !who || a.a === who);
    return Response.json({ ok: true });
  }
  if (url.pathname === "/drop") {
    const who = String(body.a || "");
    socketsOf(room).forEach((ws) => {
      if (!who || att(ws).a === who) {
        try { ws.close(4003, "removed"); } catch (err) { /* already closed */ }
      }
    });
    return Response.json({ ok: true });
  }
  return new Response("not found", { status: 404 });
}

function stub(env, serverId) {
  if (!env || !env.ACCOUNT_CHANNEL || !CHANNEL.test(String(serverId || ""))) return null;
  return env.ACCOUNT_CHANNEL.get(env.ACCOUNT_CHANNEL.idFromName("srv:" + serverId));
}

export async function roomPost(env, serverId, path, body) {
  const s = stub(env, serverId);
  if (!s) return null;
  try {
    const res = await s.fetch("https://srv.internal" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
    return res.ok ? res.json() : null;
  } catch (err) { return null; }
}

export async function roomOnline(env, serverId) {
  const s = stub(env, serverId);
  if (!s) return [];
  try {
    const res = await s.fetch("https://srv.internal/online");
    const body = res.ok ? await res.json() : {};
    return Array.isArray(body.ids) ? body.ids : [];
  } catch (err) { return []; }
}

export function roomStub(env, serverId) {
  return stub(env, serverId);
}
