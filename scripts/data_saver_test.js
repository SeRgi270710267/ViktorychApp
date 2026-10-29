/* Save data covers every setting with a network cost. Each known setting key
   must either have a data-saving value in data-saver.js KEYS or be listed in
   FREE as costing no data, so a new setting cannot be forgotten. Turning Save
   data on and off must put every store back exactly as it was. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    dump: () => Object.fromEntries(map)
  };
}
global.localStorage = memoryStorage();
global.self = global;

const device = require("../device.js");
global.ViktorychDevice = device;
const ds = require("../data-saver.js");

const listed = (store) => new Set(ds.KEYS.filter((row) => row[0] === store).map((row) => row[1]).concat(ds.FREE[store] || []));
function objectKeys(source, startPattern) {
  const at = source.search(startPattern);
  assert.ok(at >= 0, "found " + startPattern);
  const open = source.indexOf("{", source.indexOf("return", at) >= 0 && /normalizePolicy|prefs/.test(String(startPattern)) ? source.indexOf("return", at) : at);
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    else if (source[end] === "}" && --depth === 0) break;
  }
  const body = source.slice(open + 1, end);
  const keys = [];
  let level = 0;
  const re = /([{}()[\]])|(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1]) { level += "{([".includes(m[1]) ? 1 : -1; continue; }
    if (level === 0) keys.push(m[2]);
  }
  return keys;
}
function missing(store, keys) {
  const known = listed(store);
  return keys.filter((key) => !known.has(key));
}

/* 1. Every app setting: the defaults in fresh() and every STATE.settings.<key> read anywhere. */
const app = read("app.js");
const freshKeys = objectKeys(app, /const fresh = \(\) => \(/);
assert.ok(freshKeys.length > 40, "fresh() keys parsed");
const used = new Set(freshKeys);
for (const file of ["app.js", "accounts.js", "settings-sync.js"]) {
  for (const m of read(file).matchAll(/STATE\.settings\.([A-Za-z_$][\w$]*)/g)) used.add(m[1]);
}
assert.deepStrictEqual(missing("settings", [...used]), [], "app settings without a save-data value (add to KEYS, or to FREE if they cost no data)");

/* 2. Device performance: every field normalize() returns, AI features one by one. */
const normal = device.normalize(null);
const deviceKeys = [];
for (const key of Object.keys(normal)) {
  if (key === "aiFeatures") Object.keys(normal.aiFeatures).forEach((id) => deviceKeys.push("aiFeatures." + id));
  else deviceKeys.push(key);
}
assert.deepStrictEqual(missing("device", deviceKeys), [], "device settings without a save-data value");
const saverToggles = ds.KEYS.find((row) => row[0] === "device" && row[1] === "toggles")[2];
assert.deepStrictEqual(Object.keys(saverToggles).sort(), Object.keys(normal.toggles).sort(), "every device feature toggle has a save-data value");

/* 3. Storage policy, live translate and friend P2P. */
assert.deepStrictEqual(missing("storage", objectKeys(read("storage.js"), /function normalizePolicy\(/)), [], "storage policy keys without a save-data value");
assert.deepStrictEqual(missing("liveTranslate", objectKeys(read("live-translate.js"), /function prefs\(\)/)), [], "live translate keys without a save-data value");
assert.ok(/viktorychapp-friend-p2p/.test(read("friend-p2p.js")) && listed("friendP2P").has("on"), "friend P2P switch has a save-data value");

/* 4. No key is both, and every data-saving value is set. */
for (const store of Object.keys(ds.FREE)) {
  const keyed = new Set(ds.KEYS.filter((row) => row[0] === store).map((row) => row[1]));
  for (const key of ds.FREE[store]) assert.ok(!keyed.has(key), store + "." + key + " is in KEYS and FREE");
}
for (const row of ds.KEYS) {
  assert.strictEqual(row.length, 5, row[1] + " row shape");
  assert.notStrictEqual(row[2], undefined, row[0] + "." + row[1] + " has a save-data value");
  assert.ok(typeof row[4] === "string" && row[4], row[1] + " says what it costs");
}

/* 5. Saver values are the lowest-data choices the app understands. */
const plan = ds.valuesFor(true, null);
assert.strictEqual(plan.settings.autoplay, "never");
assert.strictEqual(plan.settings.videoHd, false);
assert.strictEqual(plan.settings.imageLoad, "wifi");
assert.strictEqual(plan.storage.prefetch, false);
assert.strictEqual(plan.friendP2P.on, false);
assert.strictEqual(plan.liveTranslate.on, false);
assert.strictEqual(device.normalize(plan.device).level, "light");
assert.strictEqual(device.normalize(plan.device).peerMedia, "off");
assert.ok(device.normalize(plan.device).wifiOnly);

/* 6. On, then off, puts every store back as the user left it. */
const userDevice = device.normalize({ level: "max", peerMedia: "auto" });
const userSettings = { version: 1, autoplay: "wifi", videoHd: true, showPictures: "show", appearance: "dim", stories: true, devicePerf: userDevice };
localStorage.setItem("viktorychapp-device-performance-v1", JSON.stringify(userDevice));
localStorage.setItem("viktorychapp-settings-v1", JSON.stringify(userSettings));
localStorage.setItem("viktorychapp-storage", JSON.stringify({ keep: "month", maxBytes: 0, unlimited: true, prefetch: true }));
localStorage.setItem("viktorychapp-friend-p2p", JSON.stringify({ on: true }));
const before = localStorage.dump();
ds.apply(true);
const on = JSON.parse(localStorage.getItem("viktorychapp-settings-v1"));
assert.strictEqual(on.saveData, true);
assert.strictEqual(on.autoplay, "never");
assert.strictEqual(on.stories, false);
assert.strictEqual(on.appearance, "dim", "free settings are left alone");
assert.strictEqual(on.devicePerf.level, "light");
assert.strictEqual(on.devicePerf.peerMedia, "off");
assert.strictEqual(JSON.parse(localStorage.getItem("viktorychapp-storage")).prefetch, false);
assert.strictEqual(JSON.parse(localStorage.getItem("viktorychapp-friend-p2p")).on, false);
assert.ok(ds.isOn());
ds.apply(false);
assert.ok(!ds.isOn());
const after = localStorage.dump();
assert.deepStrictEqual(JSON.parse(after["viktorychapp-settings-v1"]), Object.assign({}, userSettings, { saveData: false }), "settings restored");
assert.deepStrictEqual(JSON.parse(after["viktorychapp-device-performance-v1"]), userDevice, "device settings restored");
assert.deepStrictEqual(JSON.parse(after["viktorychapp-storage"]), JSON.parse(before["viktorychapp-storage"]), "storage policy restored");
assert.deepStrictEqual(JSON.parse(after["viktorychapp-friend-p2p"]), { on: true }, "friend P2P restored");

/* 7. Held images keep their URL but do not download. */
const held = ds.holdAttrs('<img src="https://a/b.jpg" srcset="https://a/b.jpg 1x" data-tg-first="1">');
assert.ok(!/\ssrc=/.test(held) && /data-ds-src="https:\/\/a\/b.jpg"/.test(held) && /data-ds-srcset=/.test(held) && /data-ds-tgfirst=/.test(held));

console.log("data saver ok (" + ds.KEYS.length + " data settings)");
