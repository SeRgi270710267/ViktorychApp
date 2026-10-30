/* TV tuning: specs pick the right defaults, hand-changed settings are kept,
   HLS levels respect the cap, and every string exists in each language. No browser. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "tv-tune.js"), "utf8");

function store() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

function load(opts) {
  opts = opts || {};
  const local = store();
  const tvPrefs = { calm: true, flat: true, lightImages: true, autoplay: "off", fewerPosts: true, lazyStart: true };
  const setup = { videoHd: undefined, imageSize: undefined, preload: undefined };
  let dev = { level: "light", profile: "lite", tvDefault: true };
  const calls = [];
  const win = {
    localStorage: local,
    navigator: { language: opts.lang || "en" },
    ViktorychTVMode: { on: true, inApp: () => true, prefs: () => Object.assign({}, tvPrefs), setPref: (k, v) => { tvPrefs[k] = v; } },
    ViktorychSetup: { get: (k) => setup[k], set: (p) => { if (p.devicePerf) dev = p.devicePerf; Object.assign(setup, p); } },
    ViktorychDevice: { read: () => dev, applyLevel: (l, prev) => Object.assign({}, prev, { level: l, tvDefault: false }), syncShape: (x) => x },
    ViktorychTVApp: { specs: () => "{}", setTune: (...a) => calls.push(a) }
  };
  win.globalThis = win;
  const ctx = { module: { exports: {} }, globalThis: win, window: undefined, setTimeout, clearTimeout, Promise, JSON, Math, Date, Object, Array, String, Number };
  vm.createContext(ctx);
  vm.runInContext(SRC.replace('typeof window !== "undefined" ? window : globalThis', "globalThis"), ctx);
  const api = ctx.module.exports;
  return { api, win, tvPrefs, setup, getDev: () => dev, setDev: (d) => { dev = d; }, calls, local };
}

const BIG = {
  v: 1, source: "app",
  device: { manufacturer: "Sony", model: "BRAVIA 4K VH2", android: "12", platform: "googletv" },
  display: { width: 3840, height: 2160, refresh: 60, rates: [23.976, 24, 50, 59.94, 60], maxWidth: 3840, maxHeight: 2160,
    modes: [{ id: 1, w: 3840, h: 2160, hz: 60 }, { id: 2, w: 3840, h: 2160, hz: 24 }, { id: 3, w: 3840, h: 2160, hz: 50 }],
    hdr: ["dolbyVision", "hdr10", "hlg"], wideColor: true },
  memory: { totalMb: 3072, lowRam: false },
  cpu: { cores: 4, abis: ["arm64-v8a"], maxMhz: 1900 },
  gpu: { renderer: "Mali-G52" },
  storage: { freeMb: 8000, totalMb: 16000 },
  codecs: { av1: { hw: true, maxHeight: 2160, maxFps: 60, hdr: true }, vp9: { hw: true, maxHeight: 2160, maxFps: 60, hdr: true }, hevc: { hw: true, maxHeight: 2160, maxFps: 60, hdr: true }, h264: { hw: true, maxHeight: 1080, maxFps: 60 } },
  audio: { outputs: ["hdmi", "earc"], passthrough: ["ac3", "eac3", "atmos"] },
  network: { type: "ethernet", downMbps: 80 },
  input: { gamepads: 1, bluetooth: true }
};
const SMALL = {
  v: 1, source: "app",
  device: { manufacturer: "Generic", model: "TV Stick", android: "9" },
  display: { width: 1920, height: 1080, refresh: 60, rates: [60], modes: [{ id: 1, w: 1920, h: 1080, hz: 60 }], hdr: [] },
  memory: { totalMb: 1024, lowRam: true },
  cpu: { cores: 4, maxMhz: 1500 },
  gpu: { renderer: "Mali-450 MP" },
  storage: { freeMb: 900 },
  codecs: { h264: { hw: true, maxHeight: 1080, maxFps: 30 }, vp9: { hw: false, maxHeight: 1080 } },
  audio: { outputs: ["hdmi"], passthrough: [] },
  network: { type: "wifi", downMbps: 3 },
  input: { gamepads: 0 }
};

// 1. A strong 4K TV gets the full look and 4K in AV1 with HDR and frame matching.
{
  const { api } = load();
  const p = api.plan(BIG);
  assert.strictEqual(p._tier, "high");
  assert.strictEqual(p.videoCap, 2160);
  assert.strictEqual(p.codec, "av1");
  assert.strictEqual(p.hdr, true);
  assert.strictEqual(p.frameMatch, true);
  assert.strictEqual(p.passthrough, true);
  assert.strictEqual(p.padHints, true);
  assert.strictEqual(p.calm, false);
  assert.strictEqual(p.flat, false);
  assert.strictEqual(p.autoplay, "muted");
  assert.strictEqual(p.level, "balanced");
  assert.strictEqual(p.videoHd, true);
}
// 2. A weak low-memory stick on slow Wi-Fi stays light and caps at 720p H.264.
{
  const { api } = load();
  const p = api.plan(SMALL);
  assert.strictEqual(p._tier, "low");
  assert.strictEqual(p.videoCap, 720);
  assert.strictEqual(p.codec, "h264");
  assert.strictEqual(p.hdr, false);
  assert.strictEqual(p.frameMatch, false);
  assert.strictEqual(p.calm, true);
  assert.strictEqual(p.lazyStart, true);
  assert.strictEqual(p.imageSize, "small");
  assert.strictEqual(p.preload, "defer");
  assert.strictEqual(p.videoHd, false);
  assert.strictEqual(p.level, "light");
}
// 3. HDR, frame matching and passthrough need the app; Chrome only gets what it can use.
{
  const { api } = load();
  const p = api.plan(Object.assign({}, BIG, { source: "browser" }));
  assert.strictEqual(p.hdr, false);
  assert.strictEqual(p.frameMatch, false);
  assert.strictEqual(p.passthrough, false);
}
// 4. Applying changes untouched settings and tells the app; a hand-changed one is kept.
{
  const t = load();
  t.tvPrefs.flat = false; // changed by hand before tuning: matches the plan, fine either way
  t.tvPrefs.autoplay = "on"; // changed by hand
  const list = t.api.apply(BIG, null);
  assert.strictEqual(t.tvPrefs.calm, false);
  assert.strictEqual(t.tvPrefs.autoplay, "on", "a hand-picked autoplay stays");
  assert.ok(list.find((r) => r.key === "autoplay").kept);
  assert.strictEqual(t.getDev().level, "balanced");
  assert.strictEqual(t.api.read().status, "applied");
  assert.deepStrictEqual(t.calls[t.calls.length - 1], [true, true, true, true]);
  // The person turns blur back on; re-detecting must not undo it.
  t.tvPrefs.flat = true;
  t.api.apply(BIG, null);
  assert.strictEqual(t.tvPrefs.flat, true, "re-detect keeps a hand change made after tuning");
  // A setting still at tuning's value follows a new plan.
  t.api.apply(SMALL, null);
  assert.strictEqual(t.tvPrefs.calm, true);
  assert.strictEqual(t.api.read().own.videoCap, 720);
}
// 5. Customize applies only the picked rows.
{
  const t = load();
  t.api.apply(BIG, { calm: false });
  assert.strictEqual(t.tvPrefs.calm, true, "unpicked row is left alone");
  assert.strictEqual(t.tvPrefs.flat, false);
  assert.strictEqual(t.api.read().status, "custom");
}
// 6. HLS: the top level stays under the cap and avoids codecs without hardware decode.
{
  const t = load();
  t.api.apply(SMALL, null);
  const levels = [{ height: 480, videoCodec: "avc1.4d401e" }, { height: 720, videoCodec: "avc1.4d401f" }, { height: 1080, videoCodec: "avc1.640028" }, { height: 720, videoCodec: "vp09.00.31.08" }];
  assert.strictEqual(t.api.pickTop(levels), 1);
  t.win.ViktorychTVMode.on = false;
  assert.strictEqual(t.api.pickTop(levels), -1, "outside TV mode nothing changes");
}
// 7. Frame rates snap to standard rates.
{
  const { api } = load();
  assert.strictEqual(api.snapRate(23.9), 23.976);
  assert.strictEqual(api.snapRate(49.6), 50);
  assert.strictEqual(api.snapRate(37), 0);
}
// 8. Every language has every string, and the title names the model.
{
  const { api } = load();
  const keys = Object.keys(api.STR.en);
  ["es", "hi", "ru"].forEach((l) => keys.forEach((k) => assert.ok(api.STR[l][k], l + " is missing " + k)));
  ["en", "es", "hi", "ru"].forEach((l) => assert.ok(api.STR[l].tunedTitle.includes("{model}")));
  assert.strictEqual(api.STR.en.tunedTitle, "We tuned ViktorychTV for your {model}");
  assert.strictEqual(api.STR.es.skipAll, "Omitir todo y terminar");
}
// 9. The found list covers each area.
{
  const { api } = load();
  const lines = api.specLines(BIG).map((l) => l.join(": ")).join("\n");
  ["3840×2160", "Dolby Vision", "AV1 4K60", "3 GB RAM", "Mali-G52", "Dolby Atmos", "Ethernet", "Google TV"].forEach((s) => assert.ok(lines.includes(s), "missing " + s + "\n" + lines));
}
// 10. Wiring: tv.js loads the module and shows Re-detect TV; app.js asks for the HLS top; sw.js caches both files.
{
  const tv = fs.readFileSync(path.join(ROOT, "tv.js"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(tv.includes('s.src = "tv-tune.js"') && tv.includes("ViktorychTVTune.settingsHtml()") && tv.includes("#tv-tune-layer .tvt-card"));
  assert.ok(app.includes("tune.pickTop(hls.levels)"));
  assert.ok(sw.includes('"./tv-tune.js"') && sw.includes('"./tv-tune.css"'));
  const { api } = load();
  assert.ok(api.settingsHtml().includes("data-tvt-redetect"));
}
console.log("tv tune ok");
