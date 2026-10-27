/* Peer-assisted media for lives, recordings, and large videos.
   Loaded only when playback starts. Origin is always tried on a miss,
   a slow peer, a bad hash, or a timeout, so playback does not wait
   on the mesh. Bytes are the original file. Nothing is re-encoded. */

import {
  STUN_URLS,
  PEER_TIMEOUT_MS,
  LIVE_PEER_TIMEOUT_MS,
  SEED_MAX,
  STORE_MAX,
  sha256Hex,
  swarmIdFor,
  segmentIdFor,
  rangeLabel,
  worthPeer,
  playlistAnchors,
  verifySegment,
  peerEnabled,
  factsFromConnection,
  admitUpload,
  cleanSignal
} from "./shared/peer-media.js";
import {
  loadDevicePerformance,
  peerSettings
} from "./shared/device-performance.js";

const rooms = new Map();
const anchors = new Map();
const seeds = new Map();
const counted = new Set();
let seedTotal = 0;
let loaderDepth = 0;
let watching = 0;
let batteryLow = false;
let uploadBucket = { at: 0, used: 0 };
let settings = { profile: "balanced", peerMedia: "auto", peerUploadCap: 65536, peerShareWhileWatching: true };
let started = false;

function facts() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  return factsFromConnection(conn, {
    ua: nav.userAgent || "",
    saveData: !!(conn && conn.saveData),
    batteryLow: batteryLow
  });
}

function gate() {
  return peerEnabled(settings, facts());
}

function visible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function refreshSettings() {
  settings = peerSettings(loadDevicePerformance(typeof localStorage !== "undefined" ? localStorage : null));
  const on = gate().on;
  if (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.controller) {
    try { navigator.serviceWorker.controller.postMessage({ type: "peer-flag", on: on }); }
    catch (err) { /* the worker may still be installing */ }
  }
  if (!on) leaveAll();
  return settings;
}

function note(field, id, bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (!size) return;
  const key = field + ":" + id;
  if (id && counted.has(key)) return;
  if (id) counted.add(key);
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && nav.serviceWorker && nav.serviceWorker.controller) {
    try { nav.serviceWorker.controller.postMessage({ type: "media-stats", field: field, bytes: size }); }
    catch (err) { /* stats are a side display */ }
  }
}

function rememberSeed(id, bytes, sha, share) {
  if (!share || !bytes || bytes.byteLength > SEED_MAX) return;
  if (seeds.has(id)) return;
  while (seedTotal + bytes.byteLength > STORE_MAX && seeds.size) {
    const oldest = seeds.keys().next().value;
    const prev = seeds.get(oldest);
    seeds.delete(oldest);
    seedTotal -= prev && prev.byteLength || 0;
  }
  if (seedTotal + bytes.byteLength > STORE_MAX) return;
  seeds.set(id, bytes);
  seedTotal += bytes.byteLength;
  anchors.set(id, { sha256: sha, size: bytes.byteLength, origin: true });
}

async function learn(url, range, bytes, fromOrigin, tally) {
  const id = await segmentIdFor(url, range || "");
  if (!id) return "";
  const sha = await sha256Hex(bytes);
  const known = anchors.get(id);
  if (known && known.origin && known.sha256 && known.sha256 !== sha) return id;
  anchors.set(id, { sha256: sha, size: bytes.byteLength, origin: !!fromOrigin || !!(known && known.origin) });
  if (fromOrigin) {
    rememberSeed(id, bytes, sha, bytes.byteLength <= SEED_MAX);
    if (tally !== false) note("originBytes", id, bytes.byteLength);
    const swarm = await swarmIdFor(url);
    const room = rooms.get(swarm);
    if (room) announce(room, [{ id: id, size: bytes.byteLength, sha256: sha }]);
  }
  return id;
}

function announce(room, items) {
  if (!room || !room.ws || room.ws.readyState !== 1 || !items || !items.length) return;
  if (!visible() || !watching) return;
  try { room.ws.send(JSON.stringify({ op: "have", items: items })); }
  catch (err) { /* the socket can drop while we share */ }
}

function rtcCtor() {
  const scope = typeof window !== "undefined" ? window : null;
  if (!scope) return null;
  return scope._origRTCPeerConnection || scope.RTCPeerConnection || null;
}

function sendSignal(room, to, signal) {
  const clean = cleanSignal(signal);
  if (!room || !room.ws || room.ws.readyState !== 1 || !clean) return;
  try { room.ws.send(JSON.stringify({ op: "signal", to: to, signal: clean })); }
  catch (err) { /* the peer can leave first */ }
}

function takeCandidate(event, room, remoteId) {
  if (!event || !event.candidate) return;
  const candidate = event.candidate.candidate || "";
  if (!candidate || /typ relay/i.test(candidate)) return;
  sendSignal(room, remoteId, {
    type: "ice",
    candidate: candidate,
    sdpMid: event.candidate.sdpMid || "",
    sdpMLineIndex: event.candidate.sdpMLineIndex
  });
}

function bindChannel(room, remoteId, channel) {
  const link = room.peers.get(remoteId);
  if (!link) return;
  link.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.onmessage = (event) => onChannelMessage(room, remoteId, event.data);
  channel.onclose = () => {
    const current = room.peers.get(remoteId);
    if (current && current.channel === channel) current.channel = null;
  };
}

function onChannelMessage(room, remoteId, data) {
  const link = room.peers.get(remoteId);
  if (!link) return;
  if (typeof data === "string") {
    let msg = null;
    try { msg = JSON.parse(data); }
    catch (err) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.op === "get") {
      serveGet(room, remoteId, String(msg.id || ""));
      return;
    }
    if (msg.op === "miss" || msg.op === "data") {
      const wait = link.wait && link.wait.get(String(msg.id || ""));
      if (!wait) return;
      if (msg.op === "miss") {
        link.wait.delete(String(msg.id || ""));
        wait.fail(new Error("miss"));
        return;
      }
      wait.meta = msg;
      return;
    }
    return;
  }
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : null;
  if (!bytes || !link.wait) return;
  let hit = null;
  link.wait.forEach((wait, id) => {
    if (hit || !wait.meta) return;
    if (Number(wait.meta.size) && Number(wait.meta.size) !== bytes.byteLength) return;
    hit = { id: id, wait: wait };
  });
  if (!hit) return;
  link.wait.delete(hit.id);
  hit.wait.done(bytes);
}

function serveGet(room, remoteId, id) {
  const link = room.peers.get(remoteId);
  const channel = link && link.channel;
  if (!channel || channel.readyState !== "open") return;
  const bytes = seeds.get(id);
  const known = anchors.get(id);
  const allowed = admitUpload(uploadBucket, bytes ? bytes.byteLength : 0, Date.now(), {
    cap: settings.peerUploadCap,
    watching: watching > 0,
    shareWhileWatching: settings.peerShareWhileWatching,
    visible: visible()
  });
  if (!bytes || !known || !known.sha256 || !known.origin || !allowed.ok) {
    try { channel.send(JSON.stringify({ op: "miss", id: id })); }
    catch (err) { /* the requester falls back to origin */ }
    return;
  }
  uploadBucket = allowed.bucket;
  try {
    channel.send(JSON.stringify({ op: "data", id: id, size: bytes.byteLength, sha256: known.sha256 }));
    channel.send(bytes);
  } catch (err) {
    try { channel.send(JSON.stringify({ op: "miss", id: id })); }
    catch (sendErr) { /* origin covers the segment */ }
  }
}

function openPeer(room, remoteId, offer) {
  if (!remoteId || remoteId === room.selfId || room.peers.has(remoteId)) return;
  const Ctor = rtcCtor();
  if (!Ctor) return;
  let pc;
  try {
    pc = new Ctor({ iceServers: [{ urls: STUN_URLS }], iceTransportPolicy: "all" });
  } catch (err) {
    return;
  }
  const link = { pc: pc, channel: null, wait: new Map() };
  room.peers.set(remoteId, link);
  pc.onicecandidate = (event) => takeCandidate(event, room, remoteId);
  pc.ondatachannel = (event) => bindChannel(room, remoteId, event.channel);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") dropPeer(room, remoteId);
  };
  if (offer) {
    const channel = pc.createDataChannel("media", { ordered: true });
    bindChannel(room, remoteId, channel);
    pc.createOffer().then((desc) => pc.setLocalDescription(desc)).then(() => {
      sendSignal(room, remoteId, { type: "offer", sdp: pc.localDescription && pc.localDescription.sdp });
    }).catch(() => dropPeer(room, remoteId));
  }
}

function dropPeer(room, remoteId) {
  const link = room.peers.get(remoteId);
  if (!link) return;
  room.peers.delete(remoteId);
  if (link.wait) link.wait.forEach((wait) => wait.fail(new Error("miss")));
  try { if (link.channel) link.channel.close(); } catch (err) { /* already closed */ }
  try { link.pc.close(); } catch (err) { /* already closed */ }
}

function leaveRoom(swarm) {
  const room = rooms.get(swarm);
  if (!room) return;
  rooms.delete(swarm);
  try { if (room.ws && room.ws.readyState < 2) room.ws.close(); } catch (err) { /* already closed */ }
  room.peers.forEach((_link, id) => dropPeer(room, id));
}

function leaveAll() {
  Array.from(rooms.keys()).forEach(leaveRoom);
}

async function join(url) {
  const decision = gate();
  if (!decision.on || !worthPeer(url)) return "";
  const swarm = await swarmIdFor(url);
  if (!swarm) return "";
  let room = rooms.get(swarm);
  if (room) {
    room.refs += 1;
    return swarm;
  }
  room = { id: swarm, refs: 1, ws: null, selfId: "", peers: new Map(), haves: new Map(), url: url };
  rooms.set(swarm, room);
  connect(room).catch(() => { /* origin keeps playing */ });
  return swarm;
}

function apiBase() {
  const accounts = typeof window !== "undefined" ? window.ViktorychAccounts : null;
  const live = accounts && accounts.currentApi ? accounts.currentApi() : "";
  const saved = !live && typeof window !== "undefined" && window.VIKTORYCH_ACCOUNTS ? window.VIKTORYCH_ACCOUNTS.api : "";
  return String(live || saved || "").replace(/\/$/, "");
}

function accountToken() {
  const accounts = typeof window !== "undefined" ? window.ViktorychAccounts : null;
  return accounts && accounts.token ? String(accounts.token() || "") : "";
}

async function connect(room) {
  const base = apiBase();
  const token = accountToken();
  if (!base || !token || !gate().on || !visible()) return;
  let ticket = "";
  try {
    const res = await fetch(base + "/v1/media/swarm/ticket", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
      body: "{}"
    });
    if (res.status === 429 || !res.ok) return;
    const body = await res.json();
    ticket = body && body.ticket || "";
  } catch (err) {
    return;
  }
  if (!ticket || !rooms.has(room.id)) return;
  const wsBase = base.replace(/^http/i, "ws");
  let ws;
  try {
    ws = new WebSocket(wsBase + "/v1/media/swarm?ticket=" + encodeURIComponent(ticket) + "&id=" + encodeURIComponent(room.id));
  } catch (err) {
    return;
  }
  room.ws = ws;
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let msg = null;
    try { msg = JSON.parse(event.data); }
    catch (err) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.op === "ready") {
      room.selfId = String(msg.id || "");
      const peers = Array.isArray(msg.peers) ? msg.peers : [];
      peers.forEach((id) => { if (id && id !== room.selfId) openPeer(room, String(id), true); });
      try { ws.send(JSON.stringify({ op: "hello" })); }
      catch (err) { /* the room can still receive later */ }
      return;
    }
    if (msg.op === "peer" && msg.id && msg.id !== room.selfId) return;
    if (msg.op === "have" || msg.op === "manifest") {
      const items = Array.isArray(msg.items) ? msg.items : [];
      items.forEach((item) => {
        if (!item || !item.id || !item.sha256) return;
        const prev = anchors.get(item.id);
        if (prev && prev.origin && prev.sha256 && prev.sha256 !== item.sha256) return;
        room.haves.set(item.id, { sha256: String(item.sha256), size: Number(item.size) || 0 });
        if (!prev || !prev.origin) anchors.set(item.id, { sha256: String(item.sha256), size: Number(item.size) || 0, origin: false });
      });
      return;
    }
    if (msg.op === "signal" && msg.from && msg.signal) {
      takeSignal(room, String(msg.from), msg.signal);
      return;
    }
    if (msg.op === "bye" && msg.from) dropPeer(room, String(msg.from));
  };
  ws.onclose = () => {
    if (room.ws === ws) room.ws = null;
  };
}

async function takeSignal(room, remoteId, signal) {
  const clean = cleanSignal(signal);
  if (!clean) return;
  if (!room.peers.has(remoteId)) openPeer(room, remoteId, false);
  const link = room.peers.get(remoteId);
  if (!link) return;
  try {
    if (clean.type === "offer") {
      await link.pc.setRemoteDescription({ type: "offer", sdp: clean.sdp });
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      sendSignal(room, remoteId, { type: "answer", sdp: link.pc.localDescription && link.pc.localDescription.sdp });
      return;
    }
    if (clean.type === "answer") {
      await link.pc.setRemoteDescription({ type: "answer", sdp: clean.sdp });
      return;
    }
    if (clean.type === "ice" && link.pc.remoteDescription) {
      await link.pc.addIceCandidate({ candidate: clean.candidate, sdpMid: clean.sdpMid || null, sdpMLineIndex: Number.isInteger(clean.sdpMLineIndex) ? clean.sdpMLineIndex : 0 });
    }
  } catch (err) {
    dropPeer(room, remoteId);
  }
}

function requestPeer(room, id, timeout) {
  let link = null;
  room.peers.forEach((item) => {
    if (link) return;
    if (item.channel && item.channel.readyState === "open") link = item;
  });
  if (!link) return Promise.resolve(null);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (bytes) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(bytes ? { bytes: bytes, meta: wait.meta || null } : { timeout: !wait.meta, miss: true });
    };
    const wait = {
      meta: null,
      done: (bytes) => finish(bytes),
      fail: () => finish(null)
    };
    const timer = setTimeout(() => finish(null), timeout);
    link.wait.set(id, wait);
    try { link.channel.send(JSON.stringify({ op: "get", id: id })); }
    catch (err) { finish(null); }
  });
}

async function tryPeer(url, range) {
  if (!gate().on || !worthPeer(url) || !visible()) return null;
  const swarm = await swarmIdFor(url);
  const id = await segmentIdFor(url, range || "");
  const room = rooms.get(swarm);
  if (!room || !room.haves.has(id)) return null;
  const live = /\.(m3u8|m4s|ts|cmfv|cmfa)(?:$|[?#])/i.test(String(url || ""));
  const peer = await requestPeer(room, id, live ? LIVE_PEER_TIMEOUT_MS : PEER_TIMEOUT_MS);
  if (!peer || !peer.bytes) return peer || { miss: true };
  const actual = await sha256Hex(peer.bytes);
  const have = room.haves.get(id) || {};
  const local = anchors.get(id) || {};
  const expect = {
    sha256: local.origin && local.sha256 ? local.sha256 : (have.sha256 || local.sha256 || ""),
    size: local.size || have.size || peer.bytes.byteLength,
    actualSha: actual
  };
  const verdict = verifySegment(peer.bytes, expect);
  if (!verdict.ok) return { rejected: true, timeout: false, miss: false };
  if (verdict.share && verdict.reason === "hash") rememberSeed(id, peer.bytes, actual, true);
  note("peerBytes", id, peer.bytes.byteLength);
  return { bytes: peer.bytes, sha256: actual };
}

function answerFetch(data) {
  if (loaderDepth > 0) return { skip: true };
  if (!gate().on) return { skip: true };
  const range = data && data.range || "";
  const url = data && data.url || "";
  if (!url || !worthPeer(url)) return { miss: true };
  const task = segmentIdFor(url, range).then((id) => {
    const bytes = id && seeds.get(id);
    const known = id && anchors.get(id);
    if (!bytes || !known || !known.sha256) return { miss: true };
    return { bytes: bytes, size: bytes.byteLength, sha256: known.sha256, status: range ? 206 : 200, counted: false };
  });
  return task;
}

function onWorkerMessage(event) {
  const data = event.data || {};
  if (data.type === "peer-fetch" && event.ports && event.ports[0]) {
    const port = event.ports[0];
    Promise.resolve(answerFetch(data)).then((body) => {
      try { port.postMessage(body); }
      catch (err) { try { port.postMessage({ miss: true }); } catch (postErr) { /* origin proceeds */ } }
    });
    return;
  }
  if (data.type === "peer-learned" && data.url && data.bytes) {
    const bytes = data.bytes instanceof ArrayBuffer ? new Uint8Array(data.bytes) : null;
    if (!bytes || !watching) return;
    learn(data.url, data.range || "", bytes, true, false).catch(() => {});
  }
}

function readBattery() {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (!nav || !nav.getBattery || nav._origGetBattery) return Promise.resolve();
  return nav.getBattery().then((bat) => {
    batteryLow = !!(bat && bat.charging === false && Number(bat.level) <= 0.2);
  }).catch(() => { batteryLow = false; });
}

export function configure() {
  refreshSettings();
  return readBattery().then(() => refreshSettings());
}

export function watch(url) {
  if (!url) return function () {};
  watching += 1;
  refreshSettings();
  let swarm = "";
  let dropped = false;
  join(url).then((id) => {
    swarm = id || "";
    if (dropped && swarm) {
      const room = rooms.get(swarm);
      if (room) {
        room.refs -= 1;
        if (room.refs <= 0) leaveRoom(swarm);
      }
    }
  });
  return function release() {
    if (dropped) return;
    dropped = true;
    watching = Math.max(0, watching - 1);
    if (!swarm) return;
    const room = rooms.get(swarm);
    if (!room) return;
    room.refs -= 1;
    if (room.refs <= 0) leaveRoom(swarm);
  };
}

function wrapLoader(Base, kind) {
  function PeerLoader(config) {
    this.inner = new Base(config);
    this.stats = this.inner.stats;
  }
  PeerLoader._peer = true;
  PeerLoader.prototype.abort = function () { if (this.inner.abort) this.inner.abort(); };
  PeerLoader.prototype.destroy = function () { if (this.inner.destroy) this.inner.destroy(); };
  PeerLoader.prototype.load = function (context, config, callbacks) {
    const inner = this.inner;
    const stats = this.stats;
    const url = context && context.url || "";
    const range = rangeLabel(context && context.rangeStart, context && context.rangeEnd);
    const finishInner = (response, stat, ctx, network) => {
      loaderDepth = Math.max(0, loaderDepth - 1);
      if (kind === "playlist" && response && typeof response.data === "string") {
        playlistAnchors(response.data, url).forEach((row) => {
          const span = row.start == null || !row.size ? "" : rangeLabel(row.start, row.start + row.size - 1);
          segmentIdFor(row.url, span).then((id) => {
            if (!id) return;
            const prev = anchors.get(id);
            if (prev && prev.origin) return;
            anchors.set(id, { sha256: row.sha256 || (prev && prev.sha256) || "", size: row.size || (prev && prev.size) || 0, origin: !!row.sha256 });
          }).catch(() => {});
        });
      }
      if (kind === "frag" && response && response.data) {
        const raw = response.data instanceof ArrayBuffer ? new Uint8Array(response.data) : null;
        if (raw) learn(url, range, raw, true).catch(() => {});
      }
      callbacks.onSuccess(response, stat, ctx, network);
    };
    const runInner = () => {
      loaderDepth += 1;
      inner.load(context, config, {
        onSuccess: finishInner,
        onError: function () {
          loaderDepth = Math.max(0, loaderDepth - 1);
          callbacks.onError.apply(null, arguments);
        },
        onTimeout: function () {
          loaderDepth = Math.max(0, loaderDepth - 1);
          callbacks.onTimeout.apply(null, arguments);
        },
        onProgress: callbacks.onProgress
      });
    };
    if (kind !== "frag" || !gate().on || !worthPeer(url)) { runInner(); return; }
    tryPeer(url, range).then((hit) => {
      if (!hit || !hit.bytes) { runInner(); return; }
      if (stats) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (stats.loading) {
          stats.loading.start = stats.loading.start || now;
          stats.loading.first = now;
          stats.loading.end = now;
        }
        stats.loaded = hit.bytes.byteLength;
        stats.total = hit.bytes.byteLength;
      }
      callbacks.onSuccess({ url: url, data: hit.bytes.buffer, code: 200 }, stats, context, null);
    }).catch(() => runInner());
  };
  return PeerLoader;
}

export function applyHls(hls, HlsCtor) {
  if (!hls || !hls.config || hls.config.fLoader && hls.config.fLoader._peer) return;
  const Base = hls.config.loader || (HlsCtor && HlsCtor.DefaultConfig && HlsCtor.DefaultConfig.loader);
  if (!Base) return;
  hls.config.fLoader = wrapLoader(Base, "frag");
  hls.config.pLoader = wrapLoader(Base, "playlist");
}

export function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  refreshSettings();
  readBattery().then(() => refreshSettings());
  document.addEventListener("visibilitychange", () => {
    if (!visible()) leaveAll();
    else if (watching > 0 && gate().on) {
      /* The next watch() call reconnects. Existing releases still own the ref count. */
      rooms.forEach((room) => { if (!room.ws) connect(room); });
    }
  });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", onWorkerMessage);
}

const api = { applyHls: applyHls, watch: watch, configure: configure, start: start, gate: gate };
if (typeof window !== "undefined") {
  if (!window.ViktorychPeerMedia) window.ViktorychPeerMedia = api;
  start();
}
