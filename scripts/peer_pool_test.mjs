import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { acceptPoolMessage, buildManifest, manifestObjectName, sha256Hex } from "../shared/peer-pool.js";

/* Sharing pool across three real browser pages. The Worker room is stood
   in by a relay in this script that follows worker/src/peer-pool.js (ready,
   peer, have, signal, bye). Checks that documents come from peers once one
   page has read them, that the server sees one read, and that a tampered
   chunk is thrown away with the normal read answering instead. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error("FAIL: " + message);
  process.exitCode = 1;
  throw new Error(message);
}
function check(ok, message) { if (!ok) fail(message); console.log("ok - " + message); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function doc(n, seed) {
  const items = [];
  for (let i = 0; i < n; i++) items.push({ id: seed + "-" + i, text: "Post " + i + " " + "lorem ipsum dolor sit amet ".repeat(4), at: 1700000000000 + i });
  return JSON.stringify({ items: items });
}
const DOCS = { "feeds.json": doc(900, "f"), "stories.json": doc(500, "s") };
const MARKS = { "feeds.json": "etagfeeds1", "stories.json": "etagstories1" };

const PAGE = (base) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  localStorage.setItem("viktorychapp-account-v1", JSON.stringify({ token: "t-" + Math.random(), account: { publicId: "100000000001" } }));
  localStorage.setItem("viktorychapp-peer-pool-v1", JSON.stringify({ mode: "on" }));
  window.VIKTORYCH_ACCOUNTS = { api: ${JSON.stringify(base + "/api")} };
  window.__marks = ${JSON.stringify(MARKS)};
  window.ViktorychPulse = { ok: () => true, version: (k) => window.__marks[k] || "", url: () => ${JSON.stringify(base + "/r2/pulse/v1.json")}, on: () => () => {} };
  class FakeWS {
    constructor(url) { this.readyState = 0; window.__pws = this; window.__wsOpen(url).then(() => { this.readyState = 1; this.onopen && this.onopen(); }); }
    send(s) { if (this.readyState === 1) window.__wsSend(s); }
    close() { if (this.readyState === 3) return; this.readyState = 3; window.__wsClose(); this.onclose && this.onclose(); }
  }
  window.WebSocket = FakeWS;
  window.__wsDeliver = (s) => { const ws = window.__pws; if (ws && ws.onmessage) ws.onmessage({ data: s }); };
  window.__get = async (key) => {
    const res = await window.ViktorychPool.fetchData(key, () => fetch(${JSON.stringify(base)} + "/api/v1/data/" + key, { cache: "no-store" }));
    const buf = new Uint8Array(await res.arrayBuffer());
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
    return { how: res.headers.get("x-pool") || "origin", size: buf.byteLength, sha: Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("") };
  };
</script>
<script type="module" src="/peer-pool.js"></script></body></html>`;

const FAKE_RTC = `(() => {
  const pcs = new Map();
  let n = 0;
  const uid = () => Math.random().toString(36).slice(2) + (++n);
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const unb64 = (s) => { const t = atob(s); const a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a.buffer; };
  class DC {
    constructor(pc) { this.pc = pc; this.readyState = "connecting"; this.bufferedAmount = 0; this.binaryType = "arraybuffer"; }
    send(data) {
      if (this.readyState !== "open") throw new Error("not open");
      const u8 = typeof data === "string" ? null : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      window.__pipe(this.pc.remote, JSON.stringify(u8 ? { b: b64(u8) } : { s: data }));
    }
    close() { if (this.readyState === "closed") return; this.readyState = "closed"; window.__pipe(this.pc.remote, JSON.stringify({ close: 1 })); this.onclose && this.onclose(); }
  }
  class PC {
    constructor() { this.uid = uid(); this.remote = ""; this.connectionState = "new"; this.localDescription = null; this.remoteDescription = null; this.dc = null; pcs.set(this.uid, this); }
    createDataChannel() { this.dc = new DC(this); return this.dc; }
    async createOffer() { return { type: "offer", sdp: "v=0\\r\\no=fake " + this.uid }; }
    async createAnswer() { return { type: "answer", sdp: "v=0\\r\\no=fake " + this.uid }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) {
      this.remoteDescription = d; this.remote = /o=fake (\\S+)/.exec(d.sdp)[1];
      if (d.type === "answer") window.__pipe(this.remote, JSON.stringify({ open: this.uid }));
    }
    async addIceCandidate() {}
    close() { this.connectionState = "closed"; if (this.dc) this.dc.close(); pcs.delete(this.uid); }
    _wire(msg) {
      if (msg.open) {
        this.dc = new DC(this); this.dc.readyState = "open";
        this.ondatachannel && this.ondatachannel({ channel: this.dc });
        this.dc.onopen && this.dc.onopen();
        window.__pipe(this.remote, JSON.stringify({ opened: 1 }));
      } else if (msg.opened) { this.dc.readyState = "open"; this.dc.onopen && this.dc.onopen(); }
      else if (msg.close) { if (this.dc && this.dc.readyState !== "closed") { this.dc.readyState = "closed"; this.dc.onclose && this.dc.onclose(); } }
      else if (this.dc && this.dc.readyState === "open" && this.dc.onmessage) this.dc.onmessage({ data: msg.s != null ? msg.s : unb64(msg.b) });
    }
  }
  window.__hasPc = (id) => pcs.has(id);
  window.__wire = (to, raw) => { const pc = pcs.get(to); if (pc) pc._wire(JSON.parse(raw)); };
  window.RTCPeerConnection = PC;
})();`;

async function realIce(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => new Promise((resolve) => {
      const pc = new RTCPeerConnection();
      pc.createDataChannel("probe");
      pc.onicecandidate = (event) => resolve(!!event.candidate);
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      setTimeout(() => resolve(false), 3000);
    }));
  } finally { await page.close(); }
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
  return mod.chromium || (mod.default && mod.default.chromium);
}

async function main() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const pub = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const manifests = {};
  for (const key of Object.keys(DOCS)) manifests[manifestObjectName(key)] = JSON.stringify(await buildManifest(key, MARKS[key], DOCS[key], Date.now(), priv));
  const hits = {};
  let base = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/p.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE(base)); return; }
    if (p === "/peer-pool.js" || p === "/shared/peer-pool.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(root, p.slice(1)))); return; }
    if (p === "/api/v1/media/swarm/ticket") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ticket: "mt1.test" })); return; }
    if (p.startsWith("/api/v1/data/")) {
      const key = p.slice("/api/v1/data/".length);
      hits[key] = (hits[key] || 0) + 1;
      if (!DOCS[key]) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(DOCS[key]); return;
    }
    if (p.startsWith("/r2/") && manifests[p.slice(4)]) { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(manifests[p.slice(4)]); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;

  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome", headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-features=WebRtcHideLocalIpsWithMdns", "--force-webrtc-ip-handling-policy=default"] });
  const errors = [];
  try {
    const fake = process.env.POOL_FAKE_RTC === "1" || !(await realIce(browser));
    console.log(fake ? "WebRTC networking is blocked here; using the stand-in transport" : "Using real WebRTC data channels");
    // The room, as in worker/src/peer-pool.js.
    const room = new Map();
    const deliver = (id, body) => { const m = room.get(id); if (m) m.page.evaluate((s) => window.__wsDeliver(s), JSON.stringify(body)).catch(() => {}); };
    const pages = [];
    let chain = Promise.resolve();
    const pipe = (to, raw) => {
      chain = chain.then(async () => {
        for (const p of pages) {
          if (await p.evaluate((t) => window.__hasPc && window.__hasPc(t), to).catch(() => false)) {
            await p.evaluate(([t, r]) => window.__wire(t, r), [to, raw]).catch(() => {});
            return;
          }
        }
      });
    };
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(String(e)));
      let id = "";
      await page.exposeFunction("__wsOpen", () => {
        id = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
        const others = Array.from(room.keys());
        room.set(id, { page });
        setTimeout(() => { deliver(id, { op: "ready", id, peers: others }); others.forEach((o) => deliver(o, { op: "peer", id })); }, 20);
        return true;
      });
      await page.exposeFunction("__wsSend", (raw) => {
        const msg = acceptPoolMessage(raw);
        if (!msg) return;
        if (msg.op === "have") room.forEach((_, o) => { if (o !== id) deliver(o, { op: "have", from: id, items: msg.items, reset: msg.reset }); });
        if (msg.op === "signal") deliver(msg.to, { op: "signal", from: id, signal: msg.signal });
      });
      await page.exposeFunction("__wsClose", () => { room.delete(id); room.forEach((_, o) => deliver(o, { op: "bye", from: id })); });
      if (fake) { await page.exposeFunction("__pipe", pipe); await page.addInitScript(FAKE_RTC); }
      await page.addInitScript((jwk) => { window.__viktorychPoolTestJwk = jwk; }, pub);
      await page.goto(base + "/p.html");
      await page.waitForFunction(() => window.ViktorychPool && window.ViktorychPool.stats().on, null, { timeout: 10000 });
      pages.push(page);
    }
    const [A, B, C] = pages;
    await Promise.all(pages.map((p) => p.waitForFunction(() => window.ViktorychPool.stats().peers >= 2, null, { timeout: 20000 })));
    check(true, "three pages joined the pool and connected to each other");

    const fromServer = await A.evaluate(() => window.__get("feeds.json"));
    const want = await sha256Hex(DOCS["feeds.json"]);
    check(fromServer.how === "origin" && fromServer.sha === want, "first page reads feeds.json from the server");
    await A.waitForFunction(() => window.ViktorychPool._state.store.size >= 1, null, { timeout: 10000 });
    await B.waitForFunction((h) => Array.from(window.ViktorychPool._state.haves.values()).some((m) => m.has(h)), want, { timeout: 5000 });
    const b1 = await B.evaluate(() => window.__get("feeds.json"));
    check(b1.how.startsWith("peer") && b1.sha === want && b1.size === DOCS["feeds.json"].length, "second page gets feeds.json from a peer (" + b1.size + " bytes, " + Math.ceil(b1.size / 65536) + " chunks), hash matches");
    const c1 = await C.evaluate(() => window.__get("feeds.json"));
    check(c1.how.startsWith("peer") && c1.sha === want, "third page gets feeds.json from a peer");
    check(hits["feeds.json"] === 1, "the server answered feeds.json once for three pages");

    const s0 = await A.evaluate(() => window.__get("stories.json"));
    const wantS = await sha256Hex(DOCS["stories.json"]);
    check(s0.how === "origin", "first page reads stories.json from the server");
    await A.waitForFunction((h) => window.ViktorychPool._state.store.has(h), wantS, { timeout: 10000 });
    // Page A now serves altered bytes in its second chunk.
    await A.evaluate((h) => { const e = window.ViktorychPool._state.store.get(h); e.bytes[70000] ^= 0x20; }, wantS);
    await B.waitForFunction((h) => Array.from(window.ViktorychPool._state.haves.values()).some((m) => m.has(h)), wantS, { timeout: 5000 });
    const before = hits["stories.json"];
    const b2 = await B.evaluate(() => window.__get("stories.json"));
    const rejected = await B.evaluate(() => window.ViktorychPool.stats().rejected);
    check(b2.how === "origin" && b2.sha === wantS, "a tampered chunk is rejected and the server read answers with the right bytes");
    check(rejected >= 1 && hits["stories.json"] === before + 1, "the rejection is counted (" + rejected + ") and the fallback was one server read");
    const sa = await A.evaluate(() => window.ViktorychPool.stats());
    const sb = await B.evaluate(() => window.ViktorychPool.stats());
    const sc = await C.evaluate(() => window.ViktorychPool.stats());
    console.log("stats A shared " + sa.shared + " B saved " + sb.saved + " shared " + sb.shared + " C saved " + sc.saved + " tries/hits B " + sb.tries + "/" + sb.hits);
    check(sb.saved >= DOCS["feeds.json"].length && sa.shared > 0, "stats count bytes saved and shared");
    check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
  } finally {
    await browser.close();
    server.close();
  }
}

main().then(() => { if (!process.exitCode) console.log("peer pool test passed"); }).catch((err) => { if (!process.exitCode) { console.error(err); process.exitCode = 1; } });
