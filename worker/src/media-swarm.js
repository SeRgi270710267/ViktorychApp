/* Media swarm signaling on the existing AccountChannel object.
   The object name is "swarm:" plus the swarm id. Sockets carry JSON
   only. Media bytes never enter the Worker. */

import { isAccountId } from "../../shared/presence.js";
import { swarmVerdict } from "../../shared/peer-media.js";

const SWARM_ID = /^[a-f0-9]{16,64}$/;
const PEER_CAP = 8;
const MSG_MAX = 6000;
const MSG_RATE = 40;
const MSG_WINDOW = 10000;
const MANIFEST_CAP = 160;
const TICKET_MS = 2 * 60 * 1000;
const encoder = new TextEncoder();

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
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(digest));
}

export function isSwarmName(name) {
  return /^swarm:[a-f0-9]{16,64}$/.test(String(name || ""));
}

function objectName(ctx) {
  try { return (ctx.id && ctx.id.name) || ""; }
  catch (err) { return ""; }
}

function socketsOf(room) {
  try { return room.ctx.getWebSockets() || []; }
  catch (err) { return []; }
}

function attachment(ws) {
  try { return ws.deserializeAttachment() || {}; }
  catch (err) { return {}; }
}

function peerList(room) {
  const ids = [];
  const sockets = socketsOf(room);
  for (let i = 0; i < sockets.length; i++) {
    const id = String(attachment(sockets[i]).id || "");
    if (/^[a-f0-9]{8,32}$/.test(id)) ids.push(id);
  }
  return ids;
}

function send(ws, body) {
  try { ws.send(JSON.stringify(body)); }
  catch (err) { /* the socket can close while we answer */ }
}

function broadcast(room, body, except) {
  const sockets = socketsOf(room);
  for (let i = 0; i < sockets.length; i++) {
    if (sockets[i] === except) continue;
    send(sockets[i], body);
  }
}

async function readManifest(room) {
  try {
    const saved = await room.ctx.storage.get("manifest");
    return Array.isArray(saved) ? saved : [];
  } catch (err) {
    return [];
  }
}

async function storeHave(room, items) {
  const prev = await readManifest(room);
  const map = new Map();
  for (let i = 0; i < prev.length; i++) {
    const item = prev[i];
    if (item && item.id) map.set(item.id, item);
  }
  for (let i = 0; i < items.length; i++) map.set(items[i].id, items[i]);
  let next = Array.from(map.values());
  if (next.length > MANIFEST_CAP) next = next.slice(next.length - MANIFEST_CAP);
  try { await room.ctx.storage.put("manifest", next); }
  catch (err) { /* a missed manifest still relays this have */ }
  return next;
}

export function swarmFetch(room, request) {
  const upgrade = String(request.headers.get("Upgrade") || "");
  if (upgrade.toLowerCase() !== "websocket") return new Response("not found", { status: 404 });
  if (!isSwarmName(objectName(room.ctx))) return new Response("swarm", { status: 403 });
  if (socketsOf(room).length >= PEER_CAP) return new Response("full", { status: 503 });
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  room.ctx.acceptWebSocket(server);
  server.serializeAttachment({ id: id, n: 0, at: Date.now() });
  const peers = peerList(room);
  send(server, { op: "ready", id: id, peers: peers });
  broadcast(room, { op: "peer", id: id, peers: peers }, server);
  return new Response(null, { status: 101, webSocket: client });
}

export async function swarmMessage(room, ws, message) {
  if (typeof message !== "string") {
    try { ws.close(1003, "text"); } catch (err) { /* already closed */ }
    return;
  }
  if (message.length > MSG_MAX) {
    try { ws.close(1009, "size"); } catch (err) { /* already closed */ }
    return;
  }
  const att = attachment(ws);
  const now = Date.now();
  let n = Number(att.n) || 0;
  let at = Number(att.at) || now;
  if (now - at >= MSG_WINDOW) { n = 0; at = now; }
  n += 1;
  att.n = n;
  att.at = at;
  try { ws.serializeAttachment(att); } catch (err) { /* the socket can close while we count */ }
  if (n > MSG_RATE) {
    try { ws.close(1008, "rate"); } catch (err) { /* already closed */ }
    return;
  }
  const verdict = swarmVerdict(message);
  if (verdict.action === "close") {
    try { ws.close(verdict.code || 1003, "media"); } catch (err) { /* already closed */ }
    return;
  }
  if (verdict.action !== "ok") return;
  const msg = verdict.msg;
  if (msg.op === "hello") {
    const items = await readManifest(room);
    if (items.length) send(ws, { op: "manifest", items: items.slice(-20) });
    return;
  }
  if (msg.op === "bye") {
    try { ws.close(1000, "bye"); } catch (err) { /* already closed */ }
    return;
  }
  if (msg.op === "have") {
    await storeHave(room, msg.items);
    broadcast(room, { op: "have", from: att.id || "", items: msg.items }, ws);
    return;
  }
  if (msg.op === "signal") {
    const sockets = socketsOf(room);
    for (let i = 0; i < sockets.length; i++) {
      if (String(attachment(sockets[i]).id || "") !== msg.to) continue;
      send(sockets[i], { op: "signal", from: att.id || "", signal: msg.signal });
      return;
    }
  }
}

export function swarmClose(room, ws) {
  const id = String(attachment(ws).id || "");
  if (!id) return;
  broadcast(room, { op: "bye", from: id }, ws);
}

export async function handleMediaSwarm(request, env, url, deps) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/v1/media/swarm/ticket") {
    if (request.method !== "POST") return deps.json(405, { error: "method" });
    const account = await deps.sessionAccount(env, request);
    if (!account) return deps.json(401, { error: "unauthorized" });
    if (!isAccountId(account.public_id)) return deps.json(403, { error: "account" });
    const paced = await deps.rateHit(env, "msw:" + account.public_id, 30, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const ticket = "mt1." + b64url(crypto.getRandomValues(new Uint8Array(24)));
    const now = Date.now();
    await env.DB.prepare("DELETE FROM channel_tickets WHERE expires_at <= ?").bind(now).run();
    await env.DB.prepare("INSERT INTO channel_tickets (token_hash, public_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(ticket), account.public_id, now + TICKET_MS).run();
    return deps.json(200, { ticket: ticket, expiresAt: now + TICKET_MS });
  }
  if (path !== "/v1/media/swarm") return null;
  if (request.method !== "GET") return deps.json(405, { error: "method" });
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return deps.json(426, { error: "upgrade" });
  const ticket = String(url.searchParams.get("ticket") || "");
  const swarmId = String(url.searchParams.get("id") || "").toLowerCase();
  if (!ticket.startsWith("mt1.") || ticket.length > 80) return deps.json(401, { error: "ticket" });
  if (!SWARM_ID.test(swarmId)) return deps.json(400, { error: "swarm" });
  const hash = await sha256Hex(ticket);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT public_id, expires_at FROM channel_tickets WHERE token_hash = ?").bind(hash).first();
  await env.DB.prepare("DELETE FROM channel_tickets WHERE token_hash = ?").bind(hash).run();
  if (!row || Number(row.expires_at) <= now || !isAccountId(row.public_id)) return deps.json(401, { error: "ticket" });
  if (!env.ACCOUNT_CHANNEL) return deps.json(503, { error: "channel" });
  const name = "swarm:" + swarmId;
  return env.ACCOUNT_CHANNEL.get(env.ACCOUNT_CHANNEL.idFromName(name)).fetch(request);
}
