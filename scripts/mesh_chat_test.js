/* Nearby chat (mesh-chat.js): when it is offered, geohash, and that area
   messages are valid Bitchat location events (kind 20000, g tag, 8-bit PoW). */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load({ search = "", ua = "Mozilla/5.0", store = {}, session = {}, cls = [] } = {}) {
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const ss = { getItem: (k) => (k in session ? session[k] : null), setItem() {}, removeItem() {} };
  const win = {
    localStorage: ls, sessionStorage: ss, location: { search }, navigator: { userAgent: ua, language: "en", onLine: true },
    document: { documentElement: { lang: "en", classList: { contains: (c) => cls.includes(c) } }, addEventListener() {}, removeEventListener() {} },
    crypto: globalThis.crypto, TextEncoder, BigInt, WebSocket: function () {}, setTimeout, clearTimeout, console
  };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "nostr.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "mesh-chat.js"), "utf8"), ctx);
  return win;
}

(async () => {
  let w = load();
  const M = w.ViktorychMesh;
  assert.ok(w.ViktorychNostr, "nostr.js loads");
  assert.strictEqual(M.geohash(52.2297, 21.0122, 5), "u3qcn", "geohash of a city centre");
  assert.ok(M.isGeohash("u3qcn") && !M.isGeohash("u3qca") && !M.isGeohash("x"));

  // Browser: offered only when our servers fail while online, never by default.
  assert.strictEqual(M.mode(), "auto");
  assert.strictEqual(M.offer("limited"), true);
  assert.strictEqual(M.offer("offline"), false, "no web chat without a network");
  assert.ok(/data-act="mesh-open"/.test(M.buttonHtml("limited")));
  assert.strictEqual(M.buttonHtml("offline"), "");

  // TV app: Bluetooth works offline too.
  w = load({ search: "?tv=1&src=tvapp&tvapp=2" });
  assert.strictEqual(w.ViktorychMesh.offer("offline"), true);
  w = load({ cls: ["tv-app"] });
  assert.strictEqual(w.ViktorychMesh.offer("offline"), true);

  // Off switches: the person's and the owner's.
  w = load({ store: { "viktorychapp-mesh": "off" } });
  assert.strictEqual(w.ViktorychMesh.offer("limited"), false);
  assert.ok(/aria-checked="false"/.test(w.ViktorychMesh.settingsHtml()));
  w = load({ store: { "viktorychapp-server-off": JSON.stringify(["bitchat"]) }, search: "?src=tvapp" });
  assert.strictEqual(w.ViktorychMesh.offer("offline"), false);
  assert.strictEqual(w.ViktorychMesh.settingsHtml(), "");

  // Every language has every string.
  const T = M._text, keys = Object.keys(T.en).sort();
  for (const l of ["es", "hi", "ru"]) assert.deepStrictEqual(Object.keys(T[l]).sort(), keys, l + " strings");

  // An area message is a valid, signed Bitchat location event.
  w = load();
  const ev = await w.ViktorychMesh._makeEvent("hello \"area\" ✓", "u3qcn", "tv1");
  assert.strictEqual(ev.kind, 20000);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ev.tags.slice(0, 2))), [["g", "u3qcn"], ["n", "tv1"]]);
  assert.strictEqual(ev.tags[2][0], "nonce");
  assert.ok(ev.id.startsWith("00"), "8-bit proof of work");
  assert.strictEqual(await w.ViktorychNostr.verifyEvent(ev), true, "event verifies");
  console.log("mesh chat checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
