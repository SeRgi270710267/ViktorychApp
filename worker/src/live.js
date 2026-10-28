/* Live sessions. The Worker only decides who may signal.
   SDP and ICE pass through a socket and are not stored.
   Media bytes never enter the Worker, D1, or R2. */

import { chooseParent, normalizeFanout, reparent } from "../../shared/live-relay.js";
import { cleanAudience, viewerAllowed } from "../../shared/live-auth.js";
import { emitNotification } from "./notifications.js";

const ID = /^[a-f0-9]{32}$/;
const ACCOUNT = /^\d{12}$/;
const encoder = new TextEncoder();
const TICKET_MS = 2 * 60 * 1000;
const STALE_MS = 6 * 60 * 60 * 1000;
const MSG_MAX = 12000;

export const LIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS live_sessions (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT 'public',
    fanout INTEGER NOT NULL DEFAULT 3,
    sources TEXT NOT NULL DEFAULT 'camera',
    pass_hash TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'live',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS live_sessions_host ON live_sessions(host_id, state, updated_at)",
  `CREATE TABLE IF NOT EXISTS live_members (
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    PRIMARY KEY (session_id, account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS live_blocks (
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS live_invites (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS live_tickets (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    role TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`
];

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function b64url(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return hex(new Uint8Array(digest));
}

function sameHex(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function cleanTitle(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanSources(value) {
  const text = String(value || "");
  return text === "screen" || text === "both" || text === "tab" ? text : "camera";
}

function cleanMembers(value) {
  const out = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    const id = String(item || "");
    if (ACCOUNT.test(id) && out.indexOf(id) < 0 && out.length < 40) out.push(id);
  });
  return out;
}

export function iceServers(env) {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ];
  const extra = String((env && env.LIVE_TURN_URLS) || "").split(",").map((item) => item.trim()).filter((item) => /^turns?:[^\s]+$/i.test(item)).slice(0, 4);
  extra.forEach((url) => {
    const item = { urls: url };
    const user = String((env && env.LIVE_TURN_USERNAME) || "").slice(0, 80);
    const secret = String((env && env.LIVE_TURN_CREDENTIAL) || "").slice(0, 120);
    if (user) item.username = user;
    if (secret) item.credential = secret;
    servers.push(item);
  });
  return servers;
}

function sessionView(row) {
  return {
    id: row.id,
    hostId: row.host_id,
    title: row.title || "",
    audience: row.audience,
    fanout: normalizeFanout(row.fanout),
    sources: row.sources || "camera",
    state: row.state || "live",
    hasPassword: !!row.pass_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadSession(env, id) {
  if (!ID.test(id)) return null;
  return env.DB.prepare("SELECT id, host_id, title, audience, fanout, sources, pass_hash, state, created_at, updated_at, ended_at FROM live_sessions WHERE id = ?").bind(id).first();
}

async function relation(env, hostId, viewerId) {
  const followsHost = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE follower_id = ? AND target_id = ?").bind(viewerId, "app:" + hostId).first();
  const hostFollows = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE follower_id = ? AND target_id = ?").bind(hostId, "app:" + viewerId).first();
  return { followsHost: !!followsHost, mutual: !!(followsHost && hostFollows) };
}

async function allowed(env, row, viewerId, extra) {
  const more = extra || {};
  const blocked = await env.DB.prepare("SELECT account_id FROM live_blocks WHERE session_id = ? AND account_id = ?").bind(row.id, viewerId).first();
  let listMember = false;
  if (row.audience === "list") {
    const member = await env.DB.prepare("SELECT account_id FROM live_members WHERE session_id = ? AND account_id = ?").bind(row.id, viewerId).first();
    listMember = !!member;
  }
  let followsHost = false;
  let mutual = false;
  if (row.audience === "followers" || row.audience === "mutuals") {
    const rel = await relation(env, row.host_id, viewerId);
    followsHost = rel.followsHost;
    mutual = rel.mutual;
  }
  let inviteOk = more.inviteOk === true;
  if (!inviteOk && more.invite) {
    const hash = await sha256Hex(more.invite);
    const rowInvite = await env.DB.prepare("SELECT session_id FROM live_invites WHERE token_hash = ?").bind(hash).first();
    inviteOk = !!(rowInvite && rowInvite.session_id === row.id);
  }
  let passwordOk = more.passwordOk === true;
  if (!passwordOk && row.pass_hash && more.password) {
    passwordOk = sameHex(await sha256Hex(row.id + ":" + String(more.password)), row.pass_hash);
  }
  return viewerAllowed({
    session: { hostId: row.host_id, audience: row.audience, state: row.state, hasPassword: !!row.pass_hash },
    viewerId: viewerId,
    blocked: !!blocked,
    followsHost: followsHost,
    mutual: mutual,
    listMember: listMember,
    inviteOk: inviteOk,
    passwordOk: passwordOk
  });
}

async function hostName(env, hostId) {
  const row = await env.DB.prepare("SELECT handle, display_name FROM accounts WHERE public_id = ?").bind(hostId).first();
  return { handle: row && row.handle ? String(row.handle) : "", name: row && row.display_name ? String(row.display_name) : "" };
}

async function notifySome(env, row) {
  if (row.audience === "self" || row.audience === "invite") return;
  const host = await hostName(env, row.host_id);
  let ids = [];
  if (row.audience === "list") {
    const members = await env.DB.prepare("SELECT account_id FROM live_members WHERE session_id = ? LIMIT 40").bind(row.id).all();
    ids = ((members && members.results) || []).map((item) => item.account_id);
  } else {
    const follows = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE target_id = ? LIMIT 40").bind("app:" + row.host_id).all();
    ids = ((follows && follows.results) || []).map((item) => item.follower_id);
  }
  for (let i = 0; i < ids.length; i++) {
    const publicId = String(ids[i] || "");
    if (!ACCOUNT.test(publicId) || publicId === row.host_id) continue;
    if (!(await allowed(env, row, publicId, {}))) continue;
    try {
      await emitNotification(env, {
        publicId: publicId,
        kind: "live",
        subject: row.host_id,
        idempotencyKey: "live:app:" + row.id + ":" + publicId,
        actorId: row.host_id,
        name: host.name,
        handle: host.handle,
        text: row.title || "",
        hash: "#/live/" + row.id,
        platform: "app"
      });
    } catch (err) { /* a missed note still leaves the live row */ }
  }
}

export function isLiveName(name) {
  return /^live:[a-f0-9]{32}$/.test(String(name || ""));
}

function socketsOf(room) {
  try { return room.ctx.getWebSockets() || []; }
  catch (err) { return []; }
}

function attachment(ws) {
  try { return ws.deserializeAttachment() || {}; }
  catch (err) { return {}; }
}

function send(ws, body) {
  try { ws.send(JSON.stringify(body)); }
  catch (err) { /* the socket can close while we answer */ }
}

function peersFrom(room) {
  return socketsOf(room).map((ws) => {
    const att = attachment(ws);
    return { id: String(att.account || ""), role: att.role === "host" ? "host" : "viewer", parentId: String(att.parentId || ""), alive: true, ws: ws };
  }).filter((peer) => ACCOUNT.test(peer.id));
}

function fanoutOf(room) {
  const sockets = socketsOf(room);
  for (let i = 0; i < sockets.length; i++) {
    const n = Number(attachment(sockets[i]).fanout);
    if (n) return normalizeFanout(n);
  }
  return 3;
}

function publishTree(room) {
  const peers = peersFrom(room);
  const count = peers.length;
  peers.forEach((peer) => {
    const children = peers.filter((item) => item.parentId === peer.id).map((item) => item.id);
    const roster = peer.role === "host" ? peers.filter((item) => item.id !== peer.id).map((item) => item.id) : [];
    send(peer.ws, { op: "tree", self: peer.id, parentId: peer.parentId || "", children: children, viewers: Math.max(0, count - 1), roster: roster });
  });
}

export function liveFetch(room, request) {
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("not found", { status: 404 });
  const account = String(request.headers.get("x-live-account") || "");
  const role = request.headers.get("x-live-role") === "host" ? "host" : "viewer";
  const fanout = normalizeFanout(request.headers.get("x-live-fanout"));
  if (!ACCOUNT.test(account)) return new Response("account", { status: 403 });
  const peers = peersFrom(room);
  if (peers.some((peer) => peer.id === account)) return new Response("joined", { status: 409 });
  if (role === "host" && peers.some((peer) => peer.role === "host")) return new Response("host", { status: 409 });
  const parentId = role === "host" ? "" : chooseParent(peers.map((peer) => ({ id: peer.id, role: peer.role, parentId: peer.parentId })), fanout, account);
  if (role !== "host" && !parentId) return new Response("full", { status: 503 });
  const pair = new WebSocketPair();
  room.ctx.acceptWebSocket(pair[1]);
  pair[1].serializeAttachment({ account: account, role: role, parentId: parentId, fanout: fanout });
  send(pair[1], { op: "welcome", self: account, role: role, parentId: parentId });
  publishTree(room);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export function liveMessage(room, ws, message) {
  if (typeof message !== "string" || message.length > MSG_MAX) {
    try { ws.close(1009, "size"); } catch (err) { /* already closed */ }
    return;
  }
  let msg = null;
  try { msg = JSON.parse(message); }
  catch (err) { return; }
  if (!msg || typeof msg !== "object") return;
  const att = attachment(ws);
  if (msg.op === "signal") {
    const to = String(msg.to || "");
    const data = msg.data && typeof msg.data === "object" ? msg.data : null;
    if (!ACCOUNT.test(to) || !data) return;
    const kind = String(data.kind || "");
    if (kind !== "offer" && kind !== "answer" && kind !== "ice") return;
    const body = JSON.stringify(data);
    if (body.length > 9000) return;
    const target = peersFrom(room).find((peer) => peer.id === to);
    if (!target) return;
    const toParent = String(attachment(target.ws).parentId || "") === String(att.account || "");
    const fromParent = String(att.parentId || "") === to;
    if (!toParent && !fromParent) return;
    send(target.ws, { op: "signal", from: att.account, data: data });
    return;
  }
  if (msg.op === "kick" && att.role === "host") {
    const id = String(msg.accountId || "");
    const target = peersFrom(room).find((peer) => peer.id === id);
    if (target) {
      send(target.ws, { op: "kick" });
      try { target.ws.close(4000, "kick"); } catch (err) { /* already closed */ }
    }
  }
}

export function liveClose(room, ws) {
  const att = attachment(ws);
  const gone = String(att.account || "");
  if (!ACCOUNT.test(gone)) return;
  const peers = peersFrom(room).filter((peer) => peer.ws !== ws);
  const moved = reparent(peers.map((peer) => ({ id: peer.id, role: peer.role, parentId: peer.parentId, alive: true })), gone, fanoutOf(room));
  moved.moves.forEach((move) => {
    const peer = peers.find((item) => item.id === move.id);
    if (!peer) return;
    const next = attachment(peer.ws);
    next.parentId = move.parentId;
    try { peer.ws.serializeAttachment(next); } catch (err) { /* the socket is already gone */ }
  });
  publishTree(room);
}

async function mintTicket(env, sessionId, accountId, role) {
  const ticket = "lt1." + b64url(crypto.getRandomValues(new Uint8Array(24)));
  const now = Date.now();
  await env.DB.prepare("DELETE FROM live_tickets WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO live_tickets (token_hash, session_id, account_id, role, expires_at) VALUES (?, ?, ?, ?, ?)").bind(
    await sha256Hex(ticket), sessionId, accountId, role, now + TICKET_MS
  ).run();
  return { ticket: ticket, expiresAt: now + TICKET_MS };
}

export async function sweepLive(env, at) {
  if (!env || !env.DB) return;
  const now = Number(at) || Date.now();
  try {
    await env.DB.prepare("UPDATE live_sessions SET state = 'ended', ended_at = ? WHERE state != 'ended' AND updated_at > 0 AND updated_at < ?").bind(now, now - STALE_MS).run();
    await env.DB.prepare("DELETE FROM live_tickets WHERE expires_at <= ?").bind(now).run();
  } catch (err) { /* the next minute tries again */ }
}

export async function handleLive(request, env, path, url, deps) {
  if (!env.DB) return deps.json(503, { error: "not_configured" });
  const account = await deps.sessionAccount(env, request);
  if (path === "/v1/live" && request.method === "GET") {
    if (!account) return deps.json(401, { error: "unauthorized" });
    const listed = await env.DB.prepare("SELECT id, host_id, title, audience, fanout, sources, pass_hash, state, created_at, updated_at FROM live_sessions WHERE state != 'ended' ORDER BY updated_at DESC LIMIT 40").all();
    const lives = [];
    const rows = (listed && listed.results) || [];
    for (let i = 0; i < rows.length && lives.length < 12; i++) {
      if (await allowed(env, rows[i], account.public_id, {})) {
        const host = await hostName(env, rows[i].host_id);
        const view = sessionView(rows[i]);
        view.hostName = host.name;
        view.hostHandle = host.handle;
        lives.push(view);
      }
    }
    return deps.json(200, { lives: lives });
  }
  if (path === "/v1/live" && request.method === "POST") {
    if (!account) return deps.json(401, { error: "unauthorized" });
    const paced = await deps.rateHit(env, "live:" + account.public_id, 6, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 8000);
    if (body.error) return deps.json(400, { error: "bad_live" });
    const audience = cleanAudience(body.audience) || "public";
    const members = audience === "list" ? cleanMembers(body.members) : [];
    if (audience === "list" && !members.length) return deps.json(400, { error: "bad_live" });
    const id = hex(crypto.getRandomValues(new Uint8Array(16)));
    const now = Date.now();
    await env.DB.prepare("UPDATE live_sessions SET state = 'ended', ended_at = ?, updated_at = ? WHERE host_id = ? AND state != 'ended'").bind(now, now, account.public_id).run();
    const pass = String(body.password || "");
    const passHash = audience === "invite" && pass ? await sha256Hex(id + ":" + pass.slice(0, 80)) : "";
    await env.DB.prepare("INSERT INTO live_sessions (id, host_id, title, audience, fanout, sources, pass_hash, state, created_at, updated_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, 0)").bind(
      id, account.public_id, cleanTitle(body.title), audience, normalizeFanout(body.fanout), cleanSources(body.sources), passHash, now, now
    ).run();
    for (let i = 0; i < members.length; i++) {
      await env.DB.prepare("INSERT INTO live_members (session_id, account_id) VALUES (?, ?)").bind(id, members[i]).run();
    }
    let invite = "";
    if (audience === "invite") {
      invite = b64url(crypto.getRandomValues(new Uint8Array(18)));
      await env.DB.prepare("INSERT INTO live_invites (token_hash, session_id, created_at) VALUES (?, ?, ?)").bind(await sha256Hex(invite), id, now).run();
    }
    const row = await loadSession(env, id);
    try { await notifySome(env, row); } catch (err) { /* the live still starts */ }
    const ticket = await mintTicket(env, id, account.public_id, "host");
    return deps.json(201, { live: sessionView(row), invite: invite, ticket: ticket.ticket, iceServers: iceServers(env) });
  }
  const one = path.match(/^\/v1\/live\/([a-f0-9]{32})(\/ticket|\/end|\/heartbeat|\/block|\/signal)?$/);
  if (!one) return null;
  const id = one[1];
  const action = one[2] || "";
  const row = await loadSession(env, id);
  if (!row || row.state === "ended") return deps.json(404, { error: "not_found" });
  if (action === "/signal") {
    if (request.method !== "GET") return deps.json(405, { error: "method" });
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return deps.json(426, { error: "upgrade" });
    const ticket = String(url.searchParams.get("ticket") || "");
    if (!ticket.startsWith("lt1.") || ticket.length > 80) return deps.json(401, { error: "ticket" });
    const hash = await sha256Hex(ticket);
    const now = Date.now();
    const saved = await env.DB.prepare("SELECT session_id, account_id, role, expires_at FROM live_tickets WHERE token_hash = ?").bind(hash).first();
    await env.DB.prepare("DELETE FROM live_tickets WHERE token_hash = ?").bind(hash).run();
    if (!saved || saved.session_id !== id || Number(saved.expires_at) <= now) return deps.json(401, { error: "ticket" });
    if (!(await allowed(env, row, saved.account_id, { inviteOk: saved.role === "viewer" && row.audience === "invite", passwordOk: true }))) return deps.json(404, { error: "not_found" });
    if (!env.ACCOUNT_CHANNEL) return deps.json(503, { error: "channel" });
    const headers = new Headers(request.headers);
    headers.set("x-live-account", saved.account_id);
    headers.set("x-live-role", saved.role === "host" ? "host" : "viewer");
    headers.set("x-live-fanout", String(normalizeFanout(row.fanout)));
    const forwarded = new Request(request.url, { method: request.method, headers: headers });
    return env.ACCOUNT_CHANNEL.get(env.ACCOUNT_CHANNEL.idFromName("live:" + id)).fetch(forwarded);
  }
  if (!account) return deps.json(401, { error: "unauthorized" });
  if (action === "/end" && request.method === "POST") {
    if (account.public_id !== row.host_id) return deps.json(404, { error: "not_found" });
    const now = Date.now();
    await env.DB.prepare("UPDATE live_sessions SET state = 'ended', ended_at = ?, updated_at = ? WHERE id = ?").bind(now, now, id).run();
    return deps.json(200, { ok: true });
  }
  if (action === "/heartbeat" && request.method === "POST") {
    if (account.public_id !== row.host_id) return deps.json(404, { error: "not_found" });
    await env.DB.prepare("UPDATE live_sessions SET updated_at = ? WHERE id = ? AND state != 'ended'").bind(Date.now(), id).run();
    return deps.json(200, { ok: true });
  }
  if (action === "/block" && request.method === "POST") {
    if (account.public_id !== row.host_id) return deps.json(404, { error: "not_found" });
    const body = await deps.readJson(request, 400);
    const other = String(body.accountId || "");
    if (!ACCOUNT.test(other) || other === row.host_id) return deps.json(400, { error: "bad_live" });
    await env.DB.prepare("INSERT INTO live_blocks (session_id, account_id, created_at) VALUES (?, ?, ?) ON CONFLICT(session_id, account_id) DO NOTHING").bind(id, other, Date.now()).run();
    return deps.json(200, { ok: true });
  }
  if (action === "/ticket" && request.method === "POST") {
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: "bad_live" });
    const ok = await allowed(env, row, account.public_id, { invite: body.invite, password: body.password });
    if (!ok) return deps.json(404, { error: "not_found" });
    const role = account.public_id === row.host_id ? "host" : "viewer";
    const ticket = await mintTicket(env, id, account.public_id, role);
    const host = await hostName(env, row.host_id);
    const view = sessionView(row);
    view.hostName = host.name;
    view.hostHandle = host.handle;
    return deps.json(200, { live: view, ticket: ticket.ticket, iceServers: iceServers(env), role: role });
  }
  return deps.json(404, { error: "not_found" });
}
