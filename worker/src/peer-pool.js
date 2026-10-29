/* Sharing pool signaling and manifests.
   The room is the existing AccountChannel object named "pool:main". Sockets
   carry JSON only (who has which hash, WebRTC handshakes, and counters).
   Document and app-file bytes move between browsers and never enter the
   Worker. The Worker signs one small manifest per public feed document
   (SHA-256 of the exact bytes a signed-in reader gets) and writes it to the
   public pulse bucket, so peers cannot pass off altered copies. */

import { isAccountId } from "../../shared/presence.js";
import { acceptPoolMessage, buildManifest, manifestObjectName, POOL_DATA_KEYS, POOL_ROOM, poolSummary, dayKey } from "../../shared/peer-pool.js";

const ROOM_CAP = 60;
const MSG_MAX = 7000;
const MSG_RATE = 60;
const MSG_WINDOW = 10000;
const STATS_DAYS = 14;

export function isPoolName(name) {
  return String(name || "") === "pool:" + POOL_ROOM;
}

function sockets(room) {
  try { return room.ctx.getWebSockets() || []; } catch (err) { return []; }
}
function att(ws) {
  try { return ws.deserializeAttachment() || {}; } catch (err) { return {}; }
}
function send(ws, body) {
  try { ws.send(JSON.stringify(body)); } catch (err) { /* closing */ }
}
function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
function peers(room, except) {
  const out = [];
  sockets(room).forEach((ws) => {
    if (ws === except) return;
    const id = String(att(ws).id || "");
    if (id) out.push(id);
  });
  return out;
}

export async function poolFetch(room, request) {
  const url = new URL(request.url);
  if (url.hostname === "pool.internal" && url.pathname === "/stats") {
    let days = [];
    try { days = (await room.ctx.storage.get("days")) || []; } catch (err) { days = []; }
    return new Response(JSON.stringify({ days: days, online: sockets(room).length }), { headers: { "content-type": "application/json" } });
  }
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("not found", { status: 404 });
  if (sockets(room).length >= ROOM_CAP) return new Response("full", { status: 503 });
  const pair = new WebSocketPair();
  poolAccept(room, pair[1]);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/* Adds one socket to a room. The Render backup runs the same rules on its
   own in-memory room, so this takes any object with the Durable Object
   socket methods (send, close, serializeAttachment, deserializeAttachment). */
export function poolAccept(room, socket) {
  if (sockets(room).length >= ROOM_CAP) return false;
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  room.ctx.acceptWebSocket(socket);
  socket.serializeAttachment({ id: id, n: 0, at: Date.now() });
  const others = peers(room, socket);
  send(socket, { op: "ready", id: id, peers: others.slice(-40) });
  sockets(room).forEach((ws) => { if (ws !== socket) send(ws, { op: "peer", id: id }); });
  return true;
}

async function addStats(room, s) {
  let days = [];
  try { days = (await room.ctx.storage.get("days")) || []; } catch (err) { days = []; }
  const today = dayKey(Date.now());
  let row = days.find((d) => d.day === today);
  if (!row) { row = { day: today, peer: 0, origin: 0, up: 0, hits: 0, tries: 0, rejected: 0 }; days.push(row); }
  ["peer", "origin", "up", "hits", "tries", "rejected"].forEach((k) => { row[k] = (Number(row[k]) || 0) + (Number(s[k]) || 0); });
  days = days.slice(-STATS_DAYS);
  try { await room.ctx.storage.put("days", days); } catch (err) { /* counters are best effort */ }
}

export async function poolMessage(room, ws, message) {
  if (typeof message !== "string" || message.length > MSG_MAX) {
    try { ws.close(1009, "size"); } catch (err) { /* closed */ }
    return;
  }
  const a = att(ws);
  const now = Date.now();
  if (now - (Number(a.at) || 0) >= MSG_WINDOW) { a.n = 0; a.at = now; }
  a.n = (Number(a.n) || 0) + 1;
  try { ws.serializeAttachment(a); } catch (err) { /* closed */ }
  if (a.n > MSG_RATE) {
    try { ws.close(1008, "rate"); } catch (err) { /* closed */ }
    return;
  }
  const msg = acceptPoolMessage(message);
  if (!msg) return;
  if (msg.op === "bye") {
    try { ws.close(1000, "bye"); } catch (err) { /* closed */ }
    return;
  }
  if (msg.op === "have") {
    sockets(room).forEach((other) => { if (other !== ws) send(other, { op: "have", from: a.id, items: msg.items, reset: msg.reset }); });
    return;
  }
  if (msg.op === "signal") {
    const target = sockets(room).find((other) => String(att(other).id || "") === msg.to);
    if (target) send(target, { op: "signal", from: a.id, signal: msg.signal });
    return;
  }
  if (msg.op === "stats") await addStats(room, msg);
}

export function poolClose(room, ws) {
  const id = String(att(ws).id || "");
  if (!id) return;
  sockets(room).forEach((other) => { if (other !== ws) send(other, { op: "bye", from: id }); });
}

/* A ticket from POST /v1/media/swarm/ticket works once, on either server,
   because both read the same D1 table. */
export async function usePoolTicket(env, raw) {
  const ticket = String(raw || "");
  if (!ticket.startsWith("mt1.") || ticket.length > 80 || !env || !env.DB) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket));
  const hash = hex(new Uint8Array(digest));
  const row = await env.DB.prepare("SELECT public_id, expires_at FROM channel_tickets WHERE token_hash = ?").bind(hash).first();
  await env.DB.prepare("DELETE FROM channel_tickets WHERE token_hash = ?").bind(hash).run();
  return !!(row && Number(row.expires_at) > Date.now() && isAccountId(row.public_id));
}

function poolRoom(env) {
  return env.ACCOUNT_CHANNEL.get(env.ACCOUNT_CHANNEL.idFromName("pool:" + POOL_ROOM));
}

export async function handlePool(request, env, url, deps) {
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/v1/pool/room") return null;
  if (request.method !== "GET") return deps.json(405, { error: "method" });
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return deps.json(426, { error: "upgrade" });
  if (!(await usePoolTicket(env, url.searchParams.get("ticket")))) return deps.json(401, { error: "ticket" });
  if (!env.ACCOUNT_CHANNEL) return deps.json(503, { error: "channel" });
  return poolRoom(env).fetch(request);
}

/* Owner usage panel: the last seven days of pool counters. */
export async function poolUsage(env) {
  if (!env.ACCOUNT_CHANNEL) return null;
  try {
    const res = await poolRoom(env).fetch("https://pool.internal/stats");
    const body = await res.json();
    const days = Array.isArray(body.days) ? body.days.slice(-7) : [];
    return Object.assign(poolSummary(days), { online: Number(body.online) || 0 });
  } catch (err) {
    return null;
  }
}

/* One signed entry per public document version. The non-owner read path
   calls this with the exact text it answers with. The memo keeps each
   isolate from signing the same version twice. */
const signed = new Map();
let keyCache = null;

function privateKey(env) {
  if (keyCache && keyCache.raw === env.POOL_SIGN_JWK) return keyCache.jwk;
  try {
    const jwk = JSON.parse(String(env.POOL_SIGN_JWK || ""));
    keyCache = { raw: env.POOL_SIGN_JWK, jwk: jwk && jwk.d ? jwk : null };
  } catch (err) {
    keyCache = { raw: env.POOL_SIGN_JWK, jwk: null };
  }
  return keyCache.jwk;
}

export function poolSignable(env, key, mark, text) {
  return !!(env && env.PULSE && env.POOL_SIGN_JWK && POOL_DATA_KEYS.test(String(key || "")) && mark && typeof text === "string" && text.length && text.length <= 6 * 1024 * 1024);
}

export async function notePoolDocument(env, key, mark, text) {
  if (!poolSignable(env, key, mark, text)) return false;
  const clean = String(mark).replace(/"/g, "");
  if (signed.get(key) === clean) return false;
  signed.set(key, clean);
  const jwk = privateKey(env);
  if (!jwk) return false;
  try {
    const name = manifestObjectName(key);
    const prev = await env.PULSE.head(name);
    if (prev && prev.customMetadata && prev.customMetadata.mark === clean) return false;
    const entry = await buildManifest(key, clean, text, Date.now(), jwk);
    await env.PULSE.put(name, JSON.stringify(entry), {
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-cache, max-age=0" },
      customMetadata: { mark: clean }
    });
    return true;
  } catch (err) {
    signed.delete(key);
    return false;
  }
}
