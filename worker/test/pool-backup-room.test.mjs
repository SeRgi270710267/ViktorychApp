/* The Render backup runs the pool room in memory with the same rules as the
   Durable Object room. Two browsers that only reach the backup still meet. */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { WebSocketServer, WebSocket } from "ws";
import * as pool from "../src/peer-pool.js";
import { attachPoolRoom } from "../../backup-server/pool-room.mjs";

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fakeDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(hash) {
          return {
            first: async () => (/^SELECT/.test(sql) ? rows.get(hash) || null : null),
            run: async () => { if (/^DELETE/.test(sql)) rows.delete(hash); return {}; }
          };
        }
      };
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(list, pred) {
  const start = Date.now();
  while (Date.now() - start < 3000) { const f = list.find(pred); if (f) return f; await sleep(20); }
  throw new Error("timeout " + JSON.stringify(list));
}

test("the backup pool room relays signals and uses each ticket once", async () => {
  const rows = new Map();
  const id = "100000000001";
  const tickets = ["mt1.backupticketone0000000000", "mt1.backupticket2222222222222"];
  for (const t of tickets) rows.set(await sha(t), { public_id: id, expires_at: Date.now() + 60000 });
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  const room = await attachPoolRoom(server, pool, () => ({ DB: fakeDb(rows) }), { WebSocketServer });
  assert.ok(room);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const open = (ticket) => new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port + "/v1/pool/room?ticket=" + encodeURIComponent(ticket));
    const messages = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("unexpected-response", (req, res) => reject(new Error("status " + res.statusCode)));
    ws.on("error", reject);
  });
  try {
    const a = await open(tickets[0]);
    const readyA = await waitFor(a.messages, (m) => m.op === "ready");
    const b = await open(tickets[1]);
    const readyB = await waitFor(b.messages, (m) => m.op === "ready");
    assert.deepEqual(readyB.peers, [readyA.id]);
    await waitFor(a.messages, (m) => m.op === "peer" && m.id === readyB.id);
    b.ws.send(JSON.stringify({ op: "signal", to: readyA.id, signal: { type: "offer", sdp: "v=0" } }));
    const sig = await waitFor(a.messages, (m) => m.op === "signal");
    assert.equal(sig.from, readyB.id);
    await assert.rejects(open(tickets[0]), /401/);
    b.ws.close();
    await waitFor(a.messages, (m) => m.op === "bye" && m.from === readyB.id);
    a.ws.close();
  } finally {
    await new Promise((r) => server.close(r));
  }
});
