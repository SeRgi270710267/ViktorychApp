/* Nostr on this device. Off by default: the owner switches the feature on for
   the server, then each person opts in under Settings > Nostr. Keys are made
   and kept only on this device (or held by a NIP-07 browser extension); the
   server never sees a secret key. Relays are reached straight from the
   browser, so the server carries no Nostr traffic. Covers NIP-01 events and
   BIP-340 signatures, NIP-05 names, NIP-10 reply tags, NIP-19 bech32 ids and
   NIP-48 proxy tags. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychNostr = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /* ---------- secp256k1 and BIP-340 Schnorr ---------- */
  var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  var GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  var GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  var G = [GX, GY, 1n];
  var INF = [0n, 1n, 0n];

  function mod(a, m) { var r = a % (m || P); return r < 0n ? r + (m || P) : r; }
  function pow(b, e, m) {
    var r = 1n; b = mod(b, m);
    while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; }
    return r;
  }
  function inv(a) { return pow(a, P - 2n, P); }
  function dbl(p) {
    if (p[2] === 0n || p[1] === 0n) return INF;
    var A = p[0] * p[0] % P, B = p[1] * p[1] % P, C = B * B % P;
    var D = mod(2n * (mod((p[0] + B) * (p[0] + B)) - A - C));
    var E = 3n * A % P, F = E * E % P;
    var X3 = mod(F - 2n * D);
    var Y3 = mod(E * (D - X3) - 8n * C);
    var Z3 = 2n * p[1] * p[2] % P;
    return [X3, Y3, Z3];
  }
  function add(p, q) {
    if (p[2] === 0n) return q;
    if (q[2] === 0n) return p;
    var Z1Z1 = p[2] * p[2] % P, Z2Z2 = q[2] * q[2] % P;
    var U1 = p[0] * Z2Z2 % P, U2 = q[0] * Z1Z1 % P;
    var S1 = p[1] * q[2] % P * Z2Z2 % P, S2 = q[1] * p[2] % P * Z1Z1 % P;
    var H = mod(U2 - U1), r = mod(S2 - S1);
    if (H === 0n) return r === 0n ? dbl(p) : INF;
    var I = 4n * H * H % P, J = H * I % P;
    var rr = 2n * r % P, V = U1 * I % P;
    var X3 = mod(rr * rr - J - 2n * V);
    var Y3 = mod(rr * (V - X3) - 2n * S1 * J);
    var Z3 = mod((mod((p[2] + q[2]) * (p[2] + q[2])) - Z1Z1 - Z2Z2) * H);
    return [X3, Y3, Z3];
  }
  function mul(p, k) {
    var r = INF, q = p;
    while (k > 0n) { if (k & 1n) r = add(r, q); q = dbl(q); k >>= 1n; }
    return r;
  }
  function affine(p) {
    if (p[2] === 0n) return null;
    var zi = inv(p[2]), zi2 = zi * zi % P;
    return [p[0] * zi2 % P, p[1] * zi2 % P * zi % P];
  }
  function liftX(x) {
    if (x >= P) return null;
    var c = mod(x * x % P * x + 7n);
    var y = pow(c, (P + 1n) / 4n, P);
    if (y * y % P !== c) return null;
    return [x, (y & 1n) ? P - y : y, 1n];
  }

  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }
  function unhex(text) {
    var s = String(text || "");
    if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error("hex");
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  function big(bytes) { return bytes.length ? BigInt("0x" + hex(bytes)) : 0n; }
  function bytes32(n) { var s = n.toString(16); while (s.length < 64) s = "0" + s; return unhex(s); }
  function join() {
    var len = 0, i;
    for (i = 0; i < arguments.length; i++) len += arguments[i].length;
    var out = new Uint8Array(len), at = 0;
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], at); at += arguments[i].length; }
    return out;
  }
  function utf8(text) { return new TextEncoder().encode(String(text)); }
  function subtle() {
    var c = (root && root.crypto) || (typeof globalThis !== "undefined" && globalThis.crypto);
    if (!c || !c.subtle) throw new Error("no_crypto");
    return c;
  }
  function sha256(data) {
    return subtle().subtle.digest("SHA-256", data).then(function (buf) { return new Uint8Array(buf); });
  }
  var tagCache = {};
  function taggedHash(tag, data) {
    var t = tagCache[tag] ? Promise.resolve(tagCache[tag]) : sha256(utf8(tag)).then(function (h) { tagCache[tag] = h; return h; });
    return t.then(function (h) { return sha256(join(h, h, data)); });
  }
  function randomBytes(n) {
    var out = new Uint8Array(n);
    subtle().getRandomValues(out);
    return out;
  }

  function validSecret(sk) { var d = big(sk); return d > 0n && d < N; }
  function getPublicKey(skHex) {
    var sk = unhex(skHex);
    if (sk.length !== 32 || !validSecret(sk)) throw new Error("secret");
    return hex(bytes32(affine(mul(G, big(sk)))[0]));
  }
  function schnorrSign(msg, skHex, aux) {
    var sk = unhex(skHex);
    var d0 = big(sk);
    if (sk.length !== 32 || d0 <= 0n || d0 >= N) return Promise.reject(new Error("secret"));
    var Pa = affine(mul(G, d0));
    var d = (Pa[1] & 1n) ? N - d0 : d0;
    var px = bytes32(Pa[0]);
    var a = aux || randomBytes(32);
    return taggedHash("BIP0340/aux", a).then(function (ha) {
      var db = bytes32(d), t = new Uint8Array(32);
      for (var i = 0; i < 32; i++) t[i] = db[i] ^ ha[i];
      return taggedHash("BIP0340/nonce", join(t, px, msg));
    }).then(function (rand) {
      var k0 = mod(big(rand), N);
      if (k0 === 0n) throw new Error("nonce");
      var R = affine(mul(G, k0));
      var k = (R[1] & 1n) ? N - k0 : k0;
      var rx = bytes32(R[0]);
      return taggedHash("BIP0340/challenge", join(rx, px, msg)).then(function (eh) {
        var e = mod(big(eh), N);
        return hex(join(rx, bytes32(mod(k + e * d, N))));
      });
    });
  }
  function schnorrVerify(sigHex, msg, pkHex) {
    try {
      var sig = unhex(sigHex), pk = unhex(pkHex);
      if (sig.length !== 64 || pk.length !== 32) return Promise.resolve(false);
      var Pp = liftX(big(pk));
      var r = big(sig.subarray(0, 32)), s = big(sig.subarray(32));
      if (!Pp || r >= P || s >= N) return Promise.resolve(false);
      return taggedHash("BIP0340/challenge", join(sig.subarray(0, 32), pk, msg)).then(function (eh) {
        var e = mod(big(eh), N);
        var R = affine(add(mul(G, s), mul(Pp, N - e)));
        return !!R && !(R[1] & 1n) && R[0] === r;
      });
    } catch (err) {
      return Promise.resolve(false);
    }
  }

  /* ---------- NIP-19 bech32 ---------- */
  var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(values) {
    var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3], chk = 1;
    for (var i = 0; i < values.length; i++) {
      var top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) if ((top >>> j) & 1) chk ^= GEN[j];
    }
    return chk >>> 0;
  }
  function hrpExpand(hrp) {
    var out = [], i;
    for (i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
    return out;
  }
  function convert(data, from, to, pad) {
    var acc = 0, bits = 0, out = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << from) | data[i];
      bits += from;
      while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
    }
    if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
    else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
    return out;
  }
  function bech32Encode(hrp, bytes) {
    var data = convert(Array.from(bytes), 8, 5, true);
    var values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
    var mod1 = polymod(values) ^ 1, out = hrp + "1", i;
    for (i = 0; i < data.length; i++) out += CHARSET[data[i]];
    for (i = 0; i < 6; i++) out += CHARSET[(mod1 >> (5 * (5 - i))) & 31];
    return out;
  }
  function bech32Decode(text) {
    var s = String(text || "").trim();
    if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null;
    s = s.toLowerCase();
    var at = s.lastIndexOf("1");
    if (at < 1 || at + 7 > s.length || s.length > 5000) return null;
    var hrp = s.slice(0, at), data = [];
    for (var i = at + 1; i < s.length; i++) {
      var v = CHARSET.indexOf(s[i]);
      if (v < 0) return null;
      data.push(v);
    }
    if (polymod(hrpExpand(hrp).concat(data)) !== 1) return null;
    var bytes = convert(data.slice(0, -6), 5, 8, false);
    return bytes ? { prefix: hrp, bytes: new Uint8Array(bytes) } : null;
  }
  function tlv(bytes) {
    var out = {}, i = 0;
    while (i + 2 <= bytes.length) {
      var t = bytes[i], l = bytes[i + 1], v = bytes.subarray(i + 2, i + 2 + l);
      if (v.length < l) break;
      (out[t] = out[t] || []).push(v);
      i += 2 + l;
    }
    return out;
  }
  /* npub, nsec, note, nprofile, nevent (with or without a nostr: prefix) or hex. */
  function decode(text) {
    var s = String(text || "").trim().replace(/^nostr:/i, "");
    if (/^[0-9a-f]{64}$/i.test(s)) return { type: "hex", data: s.toLowerCase() };
    var got = bech32Decode(s);
    if (!got) return null;
    var b = got.bytes, td = new TextDecoder();
    if ((got.prefix === "npub" || got.prefix === "nsec" || got.prefix === "note") && b.length === 32) return { type: got.prefix, data: hex(b) };
    if (got.prefix === "nprofile" || got.prefix === "nevent") {
      var t = tlv(b);
      if (!t[0] || t[0][0].length !== 32) return null;
      var relays = (t[1] || []).map(function (v) { return td.decode(v); }).filter(goodRelay);
      if (got.prefix === "nprofile") return { type: "nprofile", data: { pubkey: hex(t[0][0]), relays: relays } };
      return { type: "nevent", data: { id: hex(t[0][0]), relays: relays, author: t[2] && t[2][0].length === 32 ? hex(t[2][0]) : "" } };
    }
    return null;
  }
  function npub(pk) { return bech32Encode("npub", unhex(pk)); }
  function nsec(sk) { return bech32Encode("nsec", unhex(sk)); }
  function noteId(id) { return bech32Encode("note", unhex(id)); }
  function nevent(id, author) {
    var parts = [0, 32].concat(Array.from(unhex(id)));
    if (author) parts = parts.concat([2, 32], Array.from(unhex(author)));
    return bech32Encode("nevent", new Uint8Array(parts));
  }
  function shortNpub(pk) {
    var s = npub(pk);
    return s.slice(0, 10) + "…" + s.slice(-6);
  }

  /* ---------- NIP-01 events ---------- */
  function serialize(ev) {
    return JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
  }
  function eventHash(ev) { return sha256(utf8(serialize(ev))).then(hex); }
  function wellFormed(ev) {
    return !!ev && typeof ev === "object" && /^[0-9a-f]{64}$/.test(ev.id || "") && /^[0-9a-f]{64}$/.test(ev.pubkey || "")
      && /^[0-9a-f]{128}$/.test(ev.sig || "") && Number.isInteger(ev.kind) && Number.isInteger(ev.created_at)
      && typeof ev.content === "string" && Array.isArray(ev.tags) && ev.tags.every(function (t) { return Array.isArray(t) && t.every(function (x) { return typeof x === "string"; }); });
  }
  function verifyEvent(ev) {
    if (!wellFormed(ev)) return Promise.resolve(false);
    return eventHash(ev).then(function (id) {
      if (id !== ev.id) return false;
      return schnorrVerify(ev.sig, unhex(id), ev.pubkey);
    }).catch(function () { return false; });
  }
  function finishEvent(template, skHex) {
    var ev = {
      kind: template.kind,
      created_at: template.created_at || Math.floor(Date.now() / 1000),
      tags: template.tags || [],
      content: String(template.content || ""),
      pubkey: getPublicKey(skHex)
    };
    return eventHash(ev).then(function (id) {
      ev.id = id;
      return schnorrSign(unhex(id), skHex);
    }).then(function (sig) { ev.sig = sig; return ev; });
  }

  /* ---------- device prefs and keys ---------- */
  var PREFS_KEY = "viktorychapp-nostr";
  var KEY_KEY = "viktorychapp-nostr-key";
  var SERVER_OFF_KEY = "viktorychapp-server-off";
  var DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.nostr.band"];
  function store() { try { return root && root.localStorage; } catch (err) { return null; } }
  function readJson(key) {
    var s = store();
    try { return s ? JSON.parse(s.getItem(key) || "null") : null; } catch (err) { return null; }
  }
  function writeJson(key, value) {
    var s = store();
    try { if (s) { if (value == null) s.removeItem(key); else s.setItem(key, JSON.stringify(value)); } } catch (err) { /* private mode */ }
  }
  function goodRelay(url) {
    var s = String(url || "").trim();
    if (!/^wss:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?(?:\/[A-Za-z0-9._~\/-]*)?$/.test(s) || s.length > 200) return false;
    var host = s.slice(6).split(/[\/:]/)[0].toLowerCase();
    return host.indexOf(".") > 0 && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) && !/\.(local|internal|localhost)$/.test(host);
  }
  function prefs() {
    var raw = readJson(PREFS_KEY) || {};
    var relays = Array.isArray(raw.relays) ? raw.relays.filter(goodRelay).slice(0, 12) : DEFAULT_RELAYS.slice();
    return { on: raw.on === true, publish: raw.publish !== false, replies: raw.replies !== false, relays: relays.length ? relays : DEFAULT_RELAYS.slice() };
  }
  function setPrefs(change) {
    var next = Object.assign(prefs(), change || {});
    next.relays = (next.relays || []).map(function (r) { return String(r).trim().replace(/\/+$/, ""); }).filter(goodRelay)
      .filter(function (r, i, all) { return all.indexOf(r) === i; }).slice(0, 12);
    writeJson(PREFS_KEY, next);
    return prefs();
  }
  /* The owner's switch: the server lists Nostr as off until the owner turns it on. */
  function allowed() {
    var s = store();
    if (!s) return false;
    try {
      if (!s.getItem(SERVER_OFF_KEY + "-at")) return false;
      var list = JSON.parse(s.getItem(SERVER_OFF_KEY) || "null");
      return Array.isArray(list) && list.indexOf("nostr") < 0;
    } catch (err) { return false; }
  }
  function enabled() { return allowed() && prefs().on; }
  function extension() { return root && root.nostr && typeof root.nostr.signEvent === "function" ? root.nostr : null; }
  function keyInfo() {
    var raw = readJson(KEY_KEY);
    if (raw && raw.mode === "local" && /^[0-9a-f]{64}$/.test(raw.sk || "")) {
      try { return { mode: "local", pubkey: getPublicKey(raw.sk) }; } catch (err) { return null; }
    }
    if (raw && raw.mode === "nip07" && /^[0-9a-f]{64}$/.test(raw.pubkey || "")) return { mode: "nip07", pubkey: raw.pubkey };
    return null;
  }
  function generateKey() {
    var sk;
    do { sk = randomBytes(32); } while (!validSecret(sk));
    writeJson(KEY_KEY, { mode: "local", sk: hex(sk) });
    return keyInfo();
  }
  function importKey(text) {
    var got = decode(text);
    var sk = got && (got.type === "nsec" || got.type === "hex") ? got.data : "";
    if (!sk || !validSecret(unhex(sk))) return null;
    writeJson(KEY_KEY, { mode: "local", sk: sk });
    return keyInfo();
  }
  function useExtension() {
    var ext = extension();
    if (!ext || typeof ext.getPublicKey !== "function") return Promise.resolve(null);
    return Promise.resolve(ext.getPublicKey()).then(function (pk) {
      if (!/^[0-9a-f]{64}$/.test(String(pk || ""))) return null;
      writeJson(KEY_KEY, { mode: "nip07", pubkey: String(pk) });
      return keyInfo();
    }).catch(function () { return null; });
  }
  function exportSecret() {
    var raw = readJson(KEY_KEY);
    return raw && raw.mode === "local" && /^[0-9a-f]{64}$/.test(raw.sk || "") ? nsec(raw.sk) : "";
  }
  function forgetKey() { writeJson(KEY_KEY, null); }
  function sign(template) {
    var raw = readJson(KEY_KEY);
    if (raw && raw.mode === "local") return finishEvent(template, raw.sk);
    var ext = extension();
    if (raw && raw.mode === "nip07" && ext) {
      return Promise.resolve(ext.signEvent({ kind: template.kind, created_at: template.created_at || Math.floor(Date.now() / 1000), tags: template.tags || [], content: String(template.content || "") }))
        .then(function (ev) { return verifyEvent(ev).then(function (ok) { if (!ok) throw new Error("bad_signature"); return ev; }); });
    }
    return Promise.reject(new Error("no_key"));
  }

  /* ---------- relays ---------- */
  var sockets = {};
  var subSeq = 0;
  function socket(url) {
    var row = sockets[url];
    if (row && row.ws && row.ws.readyState <= 1) { clearTimeout(row.idle); return row; }
    var WS = root && root.WebSocket;
    if (!WS) return null;
    var ws;
    try { ws = new WS(url); } catch (err) { return null; }
    row = sockets[url] = { ws: ws, handlers: {}, ready: null, idle: 0 };
    row.ready = new Promise(function (resolve) {
      ws.onopen = function () { resolve(true); };
      ws.onerror = function () { resolve(false); };
      ws.onclose = function () {
        resolve(false);
        Object.keys(row.handlers).forEach(function (k) { try { row.handlers[k](["CLOSED", k, "gone"]); } catch (err) { /* ignore */ } });
        if (sockets[url] === row) delete sockets[url];
      };
    });
    ws.onmessage = function (msg) {
      var data;
      try { data = JSON.parse(msg.data); } catch (err) { return; }
      if (!Array.isArray(data)) return;
      var key = data[0] === "OK" ? "ok:" + data[1] : String(data[1]);
      var fn = row.handlers[key];
      if (fn) fn(data);
    };
    return row;
  }
  function release(url, row) {
    clearTimeout(row.idle);
    row.idle = setTimeout(function () {
      if (!Object.keys(row.handlers).length && row.ws.readyState === 1) row.ws.close();
    }, 30000);
  }
  /* Ask relays for events. Every event is checked (id and signature) before
     it is kept, so a relay cannot invent posts. */
  function query(filters, opts) {
    opts = opts || {};
    var relays = (opts.relays && opts.relays.length ? opts.relays : prefs().relays).filter(goodRelay).slice(0, 8);
    var wait = Math.max(500, Math.min(15000, opts.timeout || 5000));
    var max = opts.max || 500;
    var seen = {}, checks = [];
    return new Promise(function (resolve) {
      var left = relays.length, timer = 0, done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        Promise.all(checks).then(function () {
          var out = Object.keys(seen).map(function (k) { return seen[k]; }).filter(Boolean);
          out.sort(function (a, b) { return b.created_at - a.created_at; });
          resolve(out.slice(0, max));
        });
      }
      if (!left) { finish(); return; }
      timer = setTimeout(finish, wait);
      relays.forEach(function (url) {
        var row = socket(url);
        if (!row) { if (--left <= 0) finish(); return; }
        var id = "vk" + (++subSeq).toString(36);
        var ended = false;
        function end() {
          if (ended) return;
          ended = true;
          delete row.handlers[id];
          try { if (row.ws.readyState === 1) row.ws.send(JSON.stringify(["CLOSE", id])); } catch (err) { /* closed */ }
          release(url, row);
          if (--left <= 0) finish();
        }
        row.handlers[id] = function (data) {
          if (data[0] === "EVENT" && data[2] && !Object.prototype.hasOwnProperty.call(seen, data[2].id)) {
            var ev = data[2];
            seen[ev.id] = null;
            if (Object.keys(seen).length > max * 2) return;
            checks.push(verifyEvent(ev).then(function (ok) { if (ok) seen[ev.id] = ev; }));
          } else if (data[0] === "EOSE" || data[0] === "CLOSED") end();
        };
        row.ready.then(function (ok) {
          if (!ok) { end(); return; }
          try { row.ws.send(JSON.stringify(["REQ", id].concat(filters))); } catch (err) { end(); }
        });
        setTimeout(end, wait);
      });
    });
  }
  function publish(ev, opts) {
    opts = opts || {};
    var relays = (opts.relays && opts.relays.length ? opts.relays : prefs().relays).filter(goodRelay).slice(0, 12);
    var wait = Math.max(1000, Math.min(15000, opts.timeout || 6000));
    return Promise.all(relays.map(function (url) {
      return new Promise(function (resolve) {
        var row = socket(url);
        if (!row) { resolve(false); return; }
        var key = "ok:" + ev.id, settled = false;
        function end(ok) {
          if (settled) return;
          settled = true;
          delete row.handlers[key];
          release(url, row);
          resolve(!!ok);
        }
        row.handlers[key] = function (data) { end(data[2] === true); };
        row.ready.then(function (ok) {
          if (!ok) { end(false); return; }
          try { row.ws.send(JSON.stringify(["EVENT", ev])); } catch (err) { end(false); }
        });
        setTimeout(function () { end(false); }, wait);
      });
    })).then(function (list) {
      var ok = list.filter(Boolean).length;
      return { ok: ok, failed: list.length - ok, id: ev.id };
    });
  }

  /* ---------- NIP-05 ---------- */
  function nip05Parts(text) {
    var s = String(text || "").trim().replace(/^nostr:/i, "").replace(/^@/, "").toLowerCase();
    var m = s.match(/^(?:([a-z0-9._-]{1,64})@)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})$/);
    if (!m) return null;
    return { name: m[1] || "_", domain: m[2] };
  }
  function resolveNip05(text, fetcher) {
    var parts = nip05Parts(text);
    var f = fetcher || (root && root.fetch && root.fetch.bind(root));
    if (!parts || !f) return Promise.resolve(null);
    var url = "https://" + parts.domain + "/.well-known/nostr.json?name=" + encodeURIComponent(parts.name);
    return Promise.resolve(f(url, { credentials: "omit", redirect: "error" })).then(function (res) {
      return res && res.ok ? res.json() : null;
    }).then(function (body) {
      var pk = body && body.names && body.names[parts.name];
      if (!/^[0-9a-f]{64}$/.test(String(pk || ""))) return null;
      var relays = (body.relays && Array.isArray(body.relays[pk]) ? body.relays[pk] : []).filter(goodRelay).slice(0, 4);
      return { pubkey: pk, relays: relays, nip05: (parts.name === "_" ? "" : parts.name + "@") + parts.domain };
    }).catch(function () { return null; });
  }
  /* Who an input names: npub, nprofile, hex, or a NIP-05 name. */
  function resolveProfile(text, fetcher) {
    var got = decode(text);
    if (got && (got.type === "npub" || got.type === "hex")) return Promise.resolve({ pubkey: got.data, relays: [] });
    if (got && got.type === "nprofile") return Promise.resolve({ pubkey: got.data.pubkey, relays: got.data.relays });
    return resolveNip05(text, fetcher);
  }

  /* ---------- posts ---------- */
  function profileOf(ev) {
    var meta = {};
    try { meta = JSON.parse(ev && ev.content || "{}") || {}; } catch (err) { meta = {}; }
    var https = function (v) { return /^https:\/\//i.test(String(v || "")) ? String(v) : ""; };
    return {
      name: String(meta.display_name || meta.name || "").slice(0, 80),
      about: String(meta.about || "").slice(0, 1000),
      picture: https(meta.picture),
      banner: https(meta.banner),
      nip05: String(meta.nip05 || "").slice(0, 120),
      website: https(meta.website)
    };
  }
  var MEDIA = /https:\/\/[^\s<>"']+\.(?:jpe?g|png|gif|webp|avif|mp4|webm|mov|m3u8)(?:\?[^\s<>"']*)?/gi;
  function mediaOf(ev) {
    var out = [], seen = {};
    (ev.tags || []).forEach(function (t) {
      if (t[0] !== "imeta") return;
      var url = "", type = "", alt = "";
      t.slice(1).forEach(function (part) {
        var cut = part.indexOf(" ");
        var k = part.slice(0, cut), v = part.slice(cut + 1);
        if (k === "url") url = v;
        if (k === "m") type = v;
        if (k === "alt") alt = v;
      });
      if (/^https:\/\//.test(url) && !seen[url]) {
        seen[url] = true;
        out.push({ type: /^video\//.test(type) || /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url) ? "video" : "photo", url: url, alt: alt });
      }
    });
    (String(ev.content || "").match(MEDIA) || []).forEach(function (url) {
      if (seen[url]) return;
      seen[url] = true;
      out.push({ type: /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url) ? "video" : "photo", url: url, alt: "" });
    });
    return out.slice(0, 4);
  }
  function threadTags(ev) {
    var es = (ev.tags || []).filter(function (t) { return t[0] === "e" && /^[0-9a-f]{64}$/.test(t[1] || ""); });
    var root = es.filter(function (t) { return t[3] === "root"; })[0];
    var reply = es.filter(function (t) { return t[3] === "reply"; })[0];
    if (!root && !reply && es.length) { root = es[0]; reply = es[es.length - 1]; }
    return { root: root ? root[1] : "", parent: reply ? reply[1] : (root ? root[1] : "") };
  }
  /* A kind 1 note (or a kind 6 repost) as an X-style post. */
  function toPost(ev, profiles) {
    var meta = (profiles && profiles[ev.pubkey]) || {};
    var boosted = null;
    if (ev.kind === 6) {
      try { boosted = JSON.parse(ev.content || "null"); } catch (err) { boosted = null; }
      if (!wellFormed(boosted) || boosted.kind !== 1) return null;
    }
    var src = boosted || ev;
    var who = (profiles && profiles[src.pubkey]) || {};
    var thread = threadTags(src);
    var media = mediaOf(src);
    var text = String(src.content || "");
    media.forEach(function (m) { text = text.split(m.url).join(""); });
    var handle = npub(src.pubkey);
    return {
      id: ev.id,
      statusId: src.id,
      platform: "nostr",
      kind: boosted ? "repost" : (thread.parent ? "reply" : "post"),
      author: who.name || shortNpub(src.pubkey),
      handle: handle,
      displayHandle: who.nip05 || shortNpub(src.pubkey),
      avatar: who.picture || "",
      repostedBy: boosted ? { handle: npub(ev.pubkey), name: meta.name || shortNpub(ev.pubkey), platform: "nostr" } : null,
      text: text.replace(/[ \t]+\n/g, "\n").trim(),
      media: media,
      likes: 0,
      reposts: 0,
      replyCount: 0,
      date: new Date(src.created_at * 1000).toISOString(),
      nostrParent: thread.parent,
      nostrRoot: thread.root,
      url: "https://njump.me/" + nevent(src.id, src.pubkey)
    };
  }
  function profiles(pubkeys, opts) {
    var list = (pubkeys || []).filter(function (k, i, all) { return /^[0-9a-f]{64}$/.test(k) && all.indexOf(k) === i; }).slice(0, 100);
    if (!list.length) return Promise.resolve({});
    return query([{ kinds: [0], authors: list }], opts).then(function (events) {
      var out = {};
      events.forEach(function (ev) {
        if (!out[ev.pubkey] || out[ev.pubkey]._at < ev.created_at) {
          out[ev.pubkey] = profileOf(ev);
          out[ev.pubkey]._at = ev.created_at;
        }
      });
      return out;
    });
  }
  /* A profile and its latest notes for the profile page and Home. */
  function loadProfile(text, opts) {
    opts = opts || {};
    return resolveProfile(text, opts.fetch).then(function (who) {
      if (!who) return null;
      var relays = (who.relays || []).concat(prefs().relays).filter(function (r, i, all) { return all.indexOf(r) === i; });
      return Promise.all([
        query([{ kinds: [0], authors: [who.pubkey], limit: 1 }], { relays: relays, timeout: opts.timeout }),
        query([{ kinds: [1, 6], authors: [who.pubkey], limit: opts.limit || 40 }], { relays: relays, timeout: opts.timeout, max: opts.limit || 40 })
      ]).then(function (got) {
        var meta = got[0][0] ? profileOf(got[0][0]) : {};
        var map = {};
        map[who.pubkey] = meta;
        var boostedKeys = [];
        got[1].forEach(function (ev) {
          if (ev.kind !== 6) return;
          try { var inner = JSON.parse(ev.content || "null"); if (inner && inner.pubkey) boostedKeys.push(inner.pubkey); } catch (err) { /* skip */ }
        });
        return profiles(boostedKeys.filter(function (k) { return k !== who.pubkey; }), { relays: relays, timeout: 3000 }).then(function (more) {
          Object.assign(map, more);
          return {
            pubkey: who.pubkey,
            npub: npub(who.pubkey),
            relays: relays,
            meta: meta,
            nip05: who.nip05 || meta.nip05 || "",
            posts: got[1].map(function (ev) { return toPost(ev, map); }).filter(Boolean)
          };
        });
      });
    });
  }
  /* Replies to a note, newest last, each as an X-style post. */
  function loadReplies(eventId, opts) {
    opts = opts || {};
    if (!/^[0-9a-f]{64}$/.test(String(eventId || ""))) return Promise.resolve([]);
    return query([{ kinds: [1], "#e": [eventId], limit: opts.limit || 200 }], { relays: opts.relays, timeout: opts.timeout, max: opts.limit || 200 }).then(function (events) {
      var skip = opts.skipProxy || "";
      var kept = events.filter(function (ev) {
        if (skip && (ev.tags || []).some(function (t) { return t[0] === "proxy" && String(t[1] || "").indexOf(skip) === 0; })) return false;
        return threadTags(ev).parent === eventId;
      });
      return profiles(kept.map(function (ev) { return ev.pubkey; }), { relays: opts.relays, timeout: 3000 }).then(function (map) {
        return kept.map(function (ev) { return toPost(ev, map); }).filter(Boolean).reverse();
      });
    });
  }
  /* The event for one of our posts. Replies carry NIP-10 root and reply tags;
     the proxy tag points back at the post here (NIP-48). */
  function postTemplate(post, opts) {
    opts = opts || {};
    var parts = [String(post.text || "").trim()];
    var tags = [];
    (post.media || []).forEach(function (m) {
      var url = String((m && m.url) || "");
      if (!/^https:\/\//.test(url)) return;
      parts.push(url);
      var meta = ["imeta", "url " + url];
      if (m.mime) meta.push("m " + m.mime);
      if (m.alt) meta.push("alt " + String(m.alt).slice(0, 500));
      tags.push(meta);
    });
    var reply = opts.reply;
    if (reply && /^[0-9a-f]{64}$/.test(reply.id || "")) {
      var rootId = /^[0-9a-f]{64}$/.test(reply.root || "") ? reply.root : reply.id;
      if (rootId !== reply.id) tags.push(["e", rootId, "", "root"], ["e", reply.id, "", "reply"]);
      else tags.push(["e", rootId, "", "root"]);
      if (/^[0-9a-f]{64}$/.test(reply.pubkey || "")) tags.push(["p", reply.pubkey]);
    }
    if (/^https:\/\//.test(opts.link || "")) tags.push(["proxy", opts.link, "web"]);
    return { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: tags, content: parts.filter(Boolean).join("\n\n").slice(0, 20000) };
  }

  return {
    DEFAULT_RELAYS: DEFAULT_RELAYS,
    allowed: allowed,
    enabled: enabled,
    prefs: prefs,
    setPrefs: setPrefs,
    goodRelay: goodRelay,
    keyInfo: keyInfo,
    generateKey: generateKey,
    importKey: importKey,
    useExtension: useExtension,
    hasExtension: function () { return !!extension(); },
    exportSecret: exportSecret,
    forgetKey: forgetKey,
    sign: sign,
    decode: decode,
    npub: npub,
    nsec: nsec,
    noteId: noteId,
    nevent: nevent,
    shortNpub: shortNpub,
    getPublicKey: getPublicKey,
    schnorrSign: schnorrSign,
    schnorrVerify: schnorrVerify,
    finishEvent: finishEvent,
    verifyEvent: verifyEvent,
    query: query,
    publish: publish,
    nip05Parts: nip05Parts,
    resolveNip05: resolveNip05,
    resolveProfile: resolveProfile,
    toPost: toPost,
    profileOf: profileOf,
    threadTags: threadTags,
    loadProfile: loadProfile,
    loadReplies: loadReplies,
    postTemplate: postTemplate,
    _hex: hex,
    _unhex: unhex
  };
});
