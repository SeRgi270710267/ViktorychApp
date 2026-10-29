/* Manual load check for native server rooms (not part of npm test):
     cd worker && node test/servers_load.mjs [clients] [messages]
   Runs the Worker and its Durable Object locally in Miniflare, joins
   members, opens WebSocket clients to one server room and measures
   connect time and message fan-out. Local numbers only show the room
   logic holds up; real edge latency adds network time. */
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const CLIENTS = Math.max(1, Number(process.argv[2]) || 100);
const MESSAGES = Math.max(1, Number(process.argv[3]) || 20);
const PER_ACCOUNT = 5;
const OWNER = "loadowner";

const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
  modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
  modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
  compatibilityDate: "2026-01-15",
  d1Databases: ["DB"],
  r2Buckets: ["DATA"],
  durableObjects: { ACCOUNT_CHANNEL: { className: "AccountChannel", useSQLite: true } },
  bindings: { ACCOUNT_PEPPER: "pepper-load", OWNER_CLAIM_CODE: "claim-load", OWNER_HANDLE: OWNER, ALLOWED_ORIGINS: "http://127.0.0.1:8080", PBKDF2_ITERATIONS: "1000" }
});

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = { raw: text }; }
  if (res.status >= 300) throw new Error(path + " " + res.status + " " + text.slice(0, 200));
  return body;
}

function pct(list, p) {
  const s = list.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
}

const ip = (i) => "198.51." + (100 + Math.floor(i / 250)) + "." + (1 + (i % 250));

try {
  const owner = await call("/v1/signup", { method: "POST", ip: ip(0), body: { displayName: "Owner", handle: OWNER, claimCode: "claim-load" } });
  const made = await call("/v1/servers", { method: "POST", token: owner.token, ip: ip(0), body: { name: "Load Hall" } });
  const sid = made.server.id;
  const cid = made.channelId;
  const inv = await call("/v1/servers/" + sid + "/invites", { method: "POST", token: owner.token, ip: ip(0), body: { maxUses: 0, expiresIn: 0 } });
  const accounts = Math.ceil(CLIENTS / PER_ACCOUNT);
  const tokens = [];
  for (let i = 0; i < accounts; i++) {
    const a = await call("/v1/signup", { method: "POST", ip: ip(i + 1), body: { displayName: "Load " + i, handle: "load_" + i } });
    await call("/v1/servers/invite/" + inv.invite.code + "/join", { method: "POST", token: a.token, ip: ip(i + 1) });
    tokens.push(a.token);
  }

  const sockets = [];
  const connectMs = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CLIENTS }, async (_, n) => {
    const k = Math.floor(n / PER_ACCOUNT);
    const start = Date.now();
    const t = await call("/v1/servers/" + sid + "/ticket", { method: "POST", token: tokens[k], ip: ip(k + 1) });
    const res = await mf.dispatchFetch("https://accounts.test/v1/servers/ws?s=" + sid + "&ticket=" + encodeURIComponent(t.ticket), { headers: { Upgrade: "websocket", Connection: "Upgrade", "CF-Connecting-IP": ip(k + 1) } });
    if (res.status !== 101) throw new Error("ws " + res.status);
    const ws = res.webSocket;
    const box = { ws, got: new Map(), ready: false };
    ws.addEventListener("message", (e) => {
      let m;
      try { m = JSON.parse(String(e.data)); } catch (err) { return; }
      if (m.op === "ready") box.ready = true;
      if (m.op === "event" && m.e && m.e.t === "msg" && m.e.m && m.e.m.b) box.got.set(m.e.m.b, Date.now());
    });
    ws.accept();
    while (!box.ready) await new Promise((r) => setTimeout(r, 5));
    connectMs.push(Date.now() - start);
    sockets.push(box);
  }));
  const allConnected = Date.now() - t0;

  const fanout = [];
  const lastArrival = [];
  let missing = 0;
  for (let i = 0; i < MESSAGES; i++) {
    const text = "load message " + i;
    const sent = Date.now();
    await call("/v1/servers/" + sid + "/channels/" + cid + "/messages", { method: "POST", token: owner.token, ip: ip(0), body: { body: text } });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && sockets.some((s) => !s.got.has(text))) await new Promise((r) => setTimeout(r, 2));
    let last = 0;
    sockets.forEach((s) => {
      const at = s.got.get(text);
      if (at == null) { missing++; return; }
      fanout.push(at - sent);
      last = Math.max(last, at - sent);
    });
    lastArrival.push(last);
    await new Promise((r) => setTimeout(r, 1100)); /* stay under the per-member send rate limit */
  }

  const mem = process.memoryUsage();
  console.log(JSON.stringify({
    clients: sockets.length,
    accounts,
    messages: MESSAGES,
    connect_all_ms: allConnected,
    connect_p50_ms: pct(connectMs, 0.5),
    connect_p95_ms: pct(connectMs, 0.95),
    fanout_p50_ms: pct(fanout, 0.5),
    fanout_p95_ms: pct(fanout, 0.95),
    fanout_max_ms: Math.max(...fanout),
    last_client_p50_ms: pct(lastArrival, 0.5),
    deliveries: fanout.length,
    missing,
    node_rss_mb: Math.round(mem.rss / 1048576)
  }, null, 1));
  sockets.forEach((s) => { try { s.ws.close(1000, "done"); } catch (err) { /* closed */ } });
} finally {
  await mf.dispose();
}
