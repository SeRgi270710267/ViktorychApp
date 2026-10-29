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

/* server: node http server. pool: the worker/src/peer-pool.js module.
   getEnv: returns the Worker env (needs DB) once it is ready. */
export async function attachPoolRoom(server, pool, getEnv, options) {
  let WebSocketServer = options && options.WebSocketServer;
  try {
    if (!WebSocketServer) ({ WebSocketServer } = await import("ws"));
  } catch (err) {
    console.log("[ViktorychApp Backup Backend] sharing pool room: off (no ws package)");
    return null;
  }
  const room = createPoolRoom();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const path = (options && options.path) || "/v1/pool/room";
  server.on("upgrade", async (req, socket, head) => {
    let url;
    try { url = new URL(req.url, "http://backup.local"); } catch (err) { socket.destroy(); return; }
    if (url.pathname.replace(/\/+$/, "") !== path) { socket.destroy(); return; }
    const refuse = (code, text) => {
      try { socket.write("HTTP/1.1 " + code + " " + text + "\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"); } catch (err) { /* gone */ }
      socket.destroy();
    };
    let ok = false;
    try { ok = await pool.usePoolTicket(getEnv(), url.searchParams.get("ticket")); } catch (err) { ok = false; }
    if (!ok) { refuse(401, "Unauthorized"); return; }
    if (room.open.size >= 60) { refuse(503, "Busy"); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer = adapt(ws);
      if (!pool.poolAccept(room, peer)) { peer.close(1013, "full"); return; }
      ws.on("message", (data, binary) => {
        if (binary) { peer.close(1003, "text"); return; }
        Promise.resolve(pool.poolMessage(room, peer, String(data))).catch(() => {});
      });
      ws.on("close", () => {
        if (!room.open.has(peer)) return;
        room.open.delete(peer);
        try { pool.poolClose(room, peer); } catch (err) { /* best effort */ }
      });
      ws.on("error", () => { /* close follows */ });
    });
  });
  console.log("[ViktorychApp Backup Backend] sharing pool room: on");
  return room;
}
