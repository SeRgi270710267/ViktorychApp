/* Emoji reactions: pure helpers, the data-saving default, wiring and strings. */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function load(settings, conn) {
  const store = { "viktorychapp-settings-v1": JSON.stringify(settings || {}) };
  const win = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    Intl,
    TextEncoder,
    crypto: globalThis.crypto
  };
  win.window = win;
  const ctx = vm.createContext({ window: win, navigator: { connection: conn || {} }, localStorage: win.localStorage, Intl, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout, Promise, Array, JSON });
  vm.runInContext(read("reactions.js"), ctx);
  return win.ViktorychReactions;
}

test("swapping a reaction keeps one per person", () => {
  const rx = load();
  const s = { t: 3, top: [["😂", 2], ["❤️", 1]], me: "😂" };
  assert.deepEqual(JSON.parse(JSON.stringify(rx.applyLocal(s, "😂", "❤️"))), { t: 3, top: [["😂", 1], ["❤️", 2]].sort((a, b) => b[1] - a[1]), me: "❤️" });
  assert.deepEqual(JSON.parse(JSON.stringify(rx.applyLocal(s, "😂", ""))), { t: 2, top: [["😂", 1], ["❤️", 1]], me: "" });
  const fresh = rx.applyLocal({ t: 0, top: [], me: "" }, "", "🫠");
  assert.equal(fresh.t, 1);
  assert.equal(fresh.top[0][0], "🫠");
});

test("typed text becomes one emoji or nothing", () => {
  const rx = load();
  assert.equal(rx.oneEmoji("😀"), "😀");
  assert.equal(rx.oneEmoji(" 👍🏽 "), "👍🏽");
  assert.equal(rx.oneEmoji("❤"), "❤️");
  assert.equal(rx.oneEmoji("🇵🇱"), "🇵🇱");
  assert.equal(rx.oneEmoji("1️⃣"), "1️⃣");
  assert.equal(rx.oneEmoji("ab"), "");
  assert.equal(rx.oneEmoji("😀😀"), "");
  assert.equal(rx.oneEmoji("a"), "");
});

test("the post key is a 32-hex hash, never the post id", async () => {
  const rx = load();
  const key = await rx.keyFor("x:1234567890");
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.ok(!key.includes("1234567890"));
  assert.equal(await rx.keyFor("x:1234567890"), key);
});

test("data saving loads counts only", () => {
  assert.equal(load({}).DATA_SAVING, "lite");
  assert.equal(load({}).lite(), false);
  assert.equal(load({ reactionsData: "lite" }).lite(), true);
  assert.equal(load({ saveData: true }).lite(), true);
  assert.equal(load({ saveData: true, reactionsData: "full" }).lite(), false);
  assert.equal(load({}, { saveData: true }).lite(), true);
  assert.equal(load({}, { effectiveType: "2g" }).lite(), true);
  const saver = fs.existsSync(path.join(root, "data-saver.js")) ? read("data-saver.js") : "";
  if (saver) assert.match(saver, /\["settings", "reactionsData", "lite", "auto"/, "reactionsData needs its data-saving value in data-saver.js KEYS");
});

test("wired into the page, the cache and every language", () => {
  const index = read("index.html");
  assert.ok(index.includes('<script src="reactions.js" defer></script>'));
  assert.ok(index.includes('href="reactions.css"'));
  const sw = read("sw.js");
  assert.ok(sw.includes('"./reactions.js"') && sw.includes('"./reactions.css"'));
  const app = read("app.js");
  assert.ok(app.includes('act === "reactions-data"'));
  assert.ok(app.includes("ViktorychReactions.settingsHtml"));
  const css = read("reactions.css");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.rx-calm/);
  const keys = new Set(Array.from(read("reactions.js").matchAll(/tr\("((?:[^"\\]|\\.)*)"/g), (m) => m[1]));
  for (const lang of ["en", "ru", "es"]) {
    const pack = read("i18n/" + lang + ".js");
    for (const key of keys) assert.ok(pack.includes(JSON.stringify(key) + ":"), lang + " is missing " + key);
  }
  const data = JSON.parse(read("data/emoji.json"));
  assert.equal(data.length, 9);
  assert.ok(data.reduce((n, g) => n + g[1].length, 0) > 1500);
});
