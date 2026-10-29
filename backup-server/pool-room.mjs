import { createHash } from "node:crypto";

/* The sharing pool room on the Render backup.
   Cloudflare runs the pool room in a Durable Object. Render has none, so this
   keeps one room in memory and runs the very same rules from
   worker/src/peer-pool.js on plain WebSockets. Tickets come from the shared
   D1 table, so a ticket from either server opens either room.
   Only JSON signaling passes through here (who has which hash, WebRTC
   handshakes, counters). Feed bytes move between browsers. A restart just
   empties the room; browsers join again on their own. */

function adapt(socket) {
  let attachment = null;
  return {
    raw: socket,
    send(text) { if (socket.readyState === 1) socket.send(text); },
    close(code, reason) { try { socket.close(code, reason); } catch (err) { /* closed */ } },
    serializeAttachment(value) { attachment = JSON.parse(JSON.stringify(value)); },
    deserializeAttachment() { return attachment; }
  };
}

export function createPoolRoom() {
  const open = new Set();
  const store = new Map();
  return {
    open,
    ctx: {
      getWebSockets: () => Array.from(open),
      acceptWebSocket: (ws) => { open.add(ws); },
      storage: {
        get: async (key) => store.get(key),
        put: async (key, value) => { store.set(key, value); }
      }
    }
  };
}

/* A small WebSocket server (RFC 6455), text frames only, so the backup
   keeps needing no npm packages. Pool messages are short JSON (under 8 KB),
   so fragmented and binary frames are refused. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 8192;

function frame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ""), "utf8");
  let head;
  if (body.length < 126) { head = Buffer.alloc(2); head[1] = body.length; }
  else if (body.length < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(body.length, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(body.length), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, body]);
}

function miniSocket(socket, onMessage, onClose) {
  const ws = { readyState: 1 };
  let buf = Buffer.alloc(0);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    ws.readyState = 3;
    try { socket.destroy(); } catch (err) { /* gone */ }
    onClose();
  };
  ws.send = (text) => { if (ws.readyState === 1) { try { socket.write(frame(0x1, text)); } catch (err) { finish(); } } };
  ws.close = (code, reason) => {
    if (ws.readyState !== 1) return;
    ws.readyState = 2;
    const body = Buffer.alloc(2 + Buffer.byteLength(String(reason || "")));
    body.writeUInt16BE(Number(code) || 1000, 0);
    body.write(String(reason || ""), 2);
    try { socket.end(frame(0x8, body)); } catch (err) { /* gone */ }
    setTimeout(finish, 1000).unref();
  };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); len = big > BigInt(MAX_FRAME) ? MAX_FRAME + 1 : Number(big); at = 10; }
      if (len > MAX_FRAME || !masked) { ws.close(1009, "size"); finish(); return; }
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4);
      const data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (!fin || opcode === 0x0 || opcode === 0x2) { ws.close(1003, "text"); return; }
      if (opcode === 0x8) { ws.close(1000, ""); finish(); return; }
      if (opcode === 0x9) { try { socket.write(frame(0xA, data)); } catch (err) { /* gone */ } continue; }
      if (opcode === 0x1) onMessage(data.toString("utf8"));
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
  return ws;
}

/* server: node http server. pool: the worker/src/peer-pool.js module.
   getEnv: returns the Worker env (needs DB) once it is ready. */
export function attachPoolRoom(server, pool, getEnv, options) {
  const room = createPoolRoom();
  const path = (options && options.path) || "/v1/pool/room";
  server.on("upgrade", async (req, socket, head) => {
    let url;
    try { url = new URL(req.url, "http://backup.local"); } catch (err) { socket.destroy(); return; }
    if (url.pathname.replace(/\/+$/, "") !== path) { socket.destroy(); return; }
    const refuse = (code, text) => {
      try { socket.write("HTTP/1.1 " + code + " " + text + "\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"); } catch (err) { /* gone */ }
      socket.destroy();
    };
    const key = String(req.headers["sec-websocket-key"] || "");
    if (String(req.headers.upgrade || "").toLowerCase() !== "websocket" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) { refuse(400, "Bad Request"); return; }
    let ok = false;
    try { ok = await pool.usePoolTicket(getEnv(), url.searchParams.get("ticket")); } catch (err) { ok = false; }
    if (!ok) { refuse(401, "Unauthorized"); return; }
    if (room.open.size >= 60) { refuse(503, "Busy"); return; }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
    socket.setNoDelay(true);
    // Render's proxy drops quiet connections; a ping every 30 s keeps the
    // room open while the browser waits for peers.
    const keep = setInterval(() => { try { socket.write(frame(0x9, "")); } catch (err) { /* gone */ } }, 30000);
    keep.unref();
    let peer = null;
    const raw = miniSocket(socket, (text) => {
      if (peer) Promise.resolve(pool.poolMessage(room, peer, text)).catch(() => {});
    }, () => {
      clearInterval(keep);
      if (!peer || !room.open.has(peer)) return;
      room.open.delete(peer);
      try { pool.poolClose(room, peer); } catch (err) { /* best effort */ }
    });
    peer = adapt(raw);
    if (head && head.length) socket.unshift(head);
    if (!pool.poolAccept(room, peer)) peer.close(1013, "full");
  });
  console.log("[ViktorychApp Backup Backend] sharing pool room: on");
  return room;
}
