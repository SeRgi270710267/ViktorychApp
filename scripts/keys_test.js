// Headless tests for the keyboard shortcut registry (keys.js, keys-ui.js):
// defaults, conflicts, rebinding, chord timing, input guarding, Mac keys,
// the single-key switch and translations. Runs from dock_test.js in CI.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function fakeEl(tag) {
  return {
    nodeType: 1, tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: { setProperty() {} }, hidden: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    isContentEditable: false,
    addEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    matches() { return false; }, getClientRects() { return []; }, focus() {}
  };
}

function makeSandbox(opts) {
  const store = {};
  const timers = [];
  let now = 0;
  const listeners = {};
  const doc = {
    readyState: "complete",
    body: fakeEl("body"),
    documentElement: Object.assign(fakeEl("html"), { classList: { contains: () => false, add() {}, remove() {} } }),
    activeElement: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement: fakeEl,
    elementFromPoint() { return null; }
  };
  const sb = {
    console, URL, JSON, Math, Date: { now: () => now },
    setTimeout(fn, ms) { timers.push({ fn, at: now + (ms || 0) }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }
    },
    navigator: { platform: opts && opts.mac ? "MacIntel" : "Win32", userAgent: opts && opts.mac ? "Macintosh" : "Windows", userAgentData: undefined },
    location: { hash: "#/" },
    history: { back() { sb.went = "back"; }, forward() { sb.went = "forward"; } },
    document: doc,
    addEventListener() {},
    matchMedia() { return { matches: false }; },
    innerHeight: 800
  };
  sb.window = sb;
  sb.globalThis = sb;
  sb.tick = (ms) => {
    now += ms;
    timers.forEach((t) => { if (t.fn && t.at <= now) { const fn = t.fn; t.fn = null; fn(); } });
  };
  sb.listeners = listeners;
  vm.createContext(sb);
  vm.runInContext(read("keys.js"), sb, { filename: "keys.js" });
  vm.runInContext(read("keys-hi.js"), sb, { filename: "keys-hi.js" });
  vm.runInContext(read("keys-ui.js"), sb, { filename: "keys-ui.js" });
  return sb;
}

function keyEvent(key, extra) {
  const ev = Object.assign({
    key, code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false,
    isComposing: false, keyCode: 0, target: null, defaultPrevented: false
  }, extra || {});
  ev.preventDefault = function () { ev.defaultPrevented = true; };
  ev.stopPropagation = function () {};
  return ev;
}

/* ---------- Registry and defaults ---------- */
const sb = makeSandbox();
const K = sb.ViktorychKeys;
const ids = K.commands().map((c) => c.id);
["app.palette", "app.help", "app.search", "nav.home", "nav.notifications", "timeline.next", "timeline.prev", "post.like",
  "post.react", "post.mute", "post.hide", "composer.post", "composer.emoji", "composer.poll", "media.play", "media.mute",
  "media.fullscreen", "dm.new", "dm.prev", "modal.close", "modal.tab", "feed.tab1", "nav.item9", "app.theme",
  "app.account", "app.update", "app.refresh", "app.back", "app.forward", "app.chat", "app.ai"].forEach((id) => {
  assert(ids.includes(id), "missing command " + id);
});
assert.equal(new Set(ids).size, ids.length, "command ids are unique");
K.commands().forEach((c) => {
  assert(K.SCOPES.includes(c.scope), c.id + " has a known scope");
  c.keys.forEach((b) => assert(K.parseBinding(b), c.id + " binding parses: " + b));
});
assert.deepEqual(K.allConflicts(false), [], "defaults have no conflicts (PC)");
const mac = makeSandbox({ mac: true });
assert.deepEqual(mac.ViktorychKeys.allConflicts(true), [], "defaults have no conflicts (Mac)");

/* ---------- Binding parsing and Mac mapping ---------- */
assert.deepEqual(K.parseBinding("mod+k", false), ["ctrl+k"]);
assert.deepEqual(K.parseBinding("mod+k", true), ["meta+k"]);
assert.deepEqual(K.parseBinding("g h"), ["g", "h"]);
assert.deepEqual(K.parseBinding("Shift+Alt+P"), ["alt+shift+p"]);
assert.deepEqual(K.parseBinding("shift+?"), ["?"], "shift is part of punctuation");
assert.equal(K.formatBinding(["meta+k"], true), "⌘K");
assert.equal(K.formatBinding(["ctrl+k"], false), "Ctrl+K");
assert.equal(K.eventCombo(keyEvent("k", { ctrlKey: true })), "ctrl+k");
assert.equal(K.eventCombo(keyEvent("?", { shiftKey: true })), "?");
assert.equal(K.eventCombo(keyEvent("Shift", { shiftKey: true })), "", "modifier alone is not a combo");
assert.equal(K.eventCombo(keyEvent("р", { code: "KeyH", altKey: false })), "h", "Cyrillic layout maps to the physical key");
assert.equal(K.eventCombo(keyEvent("˙", { code: "KeyH", altKey: true })), "alt+h", "Option on Mac maps to the physical key");
assert.equal(K.eventCombo(keyEvent("1", { code: "Digit1", altKey: true })), "alt+1");
assert(mac.ViktorychKeys.isMac());
const macIds = mac.ViktorychKeys.commands().map((c) => c.id);
assert(macIds.includes("app.backMac") && !ids.includes("app.backMac"), "Cmd+[ only on Mac");
assert.equal(mac.ViktorychKeys.ariaValue(mac.ViktorychKeys.bindingsOf("app.palette")), "Meta+K Alt+Space");
assert.equal(K.ariaValue(K.bindingsOf("app.palette")), "Control+K Alt+Space");
assert.equal(K.ariaValue(K.bindingsOf("nav.home")), "", "chords have no aria-keyshortcuts value");

/* ---------- Input guarding and IME ---------- */
const input = Object.assign(fakeEl("input"), { closest(sel) { return /input/.test(sel) ? this : null; }, matches(sel) { return /input/.test(sel); }, type: "text" });
const editable = Object.assign(fakeEl("div"), { isContentEditable: true, closest(sel) { return /contenteditable/.test(sel) ? this : null; } });
assert(K.typingIn(input), "text inputs count as typing");
assert(K.typingIn(editable), "contenteditable counts as typing");
assert(!K.typingIn(fakeEl("div")), "plain elements are not typing");
assert(!K.inputSafe("j"), "letters never fire while typing");
assert(!K.inputSafe("shift+space"));
assert(K.inputSafe("escape") && K.inputSafe("ctrl+enter") && K.inputSafe("alt+up"));
assert.equal(K.eventCombo(keyEvent("j", { isComposing: true })), "", "IME composition is ignored");
assert.equal(K.eventCombo(keyEvent("Process", { keyCode: 229 })), "", "IME keyCode 229 is ignored");

let ran = [];
K.register({ id: "test.j", keys: ["j"], label: "Next post", scope: "global", run: () => { ran.push("j"); } });
K.register({ id: "test.ctrl", keys: ["mod+shift+y"], label: "Next post", scope: "global", input: true, run: () => { ran.push("ctrl"); } });
K.unregister("timeline.next");
let ev = keyEvent("j", { target: input });
K.onKeyDown(ev);
assert.deepEqual(ran, [], "single key does not fire in an input");
assert(!ev.defaultPrevented);
K.onKeyDown(keyEvent("j", { target: fakeEl("div") }));
assert.deepEqual(ran, ["j"], "single key fires outside inputs");
K.onKeyDown(keyEvent("Y", { ctrlKey: true, shiftKey: true, target: input }));
assert.deepEqual(ran, ["j", "ctrl"], "input-safe combo fires while typing");
ran = [];
K.onKeyDown(keyEvent("j", { target: fakeEl("div"), isComposing: true }));
assert.deepEqual(ran, [], "nothing fires during IME composition");

/* ---------- Chord timing ---------- */
const s2 = makeSandbox();
const K2 = s2.ViktorychKeys;
const hits = [];
K2.register({ id: "t.gh", keys: ["g h"], label: "Home", scope: "global", run: () => { hits.push("gh"); } });
K2.register({ id: "t.g", keys: ["shift+g"], label: "Home", scope: "global", run: () => { hits.push("G"); } });
["nav.home"].forEach((id) => K2.unregister(id));
const list = K2.candidates(K2.context(), false);
assert.equal(K2.step(["g"], list, {}).action, "wait", "g waits for the next key");
assert.equal(K2.step(["g", "h"], list, {}).action, "run");
assert.equal(K2.step(["g", "h"], list, {}).entry.cmd.id, "t.gh");
assert.equal(K2.step(["z"], list, {}).action, "none");
const div = fakeEl("div");
K2.onKeyDown(keyEvent("g", { target: div }));
assert.deepEqual(K2.pending(), ["g"], "chord is pending");
s2.tick(K2.CHORD_MS - 100);
K2.onKeyDown(keyEvent("h", { target: div }));
assert.deepEqual(hits, ["gh"], "second key inside the window runs the chord");
assert.deepEqual(K2.pending(), []);
K2.onKeyDown(keyEvent("g", { target: div }));
s2.tick(K2.CHORD_MS + 10);
assert.deepEqual(K2.pending(), [], "chord times out");
K2.onKeyDown(keyEvent("h", { target: div }));
assert.deepEqual(hits, ["gh"], "late second key does not run the chord");
K2.onKeyDown(keyEvent("g", { target: div }));
K2.onKeyDown(keyEvent("Escape", { target: div }));
assert.deepEqual(K2.pending(), [], "Esc cancels a pending chord");

/* ---------- Conflicts, rebinding, reset ---------- */
const s3 = makeSandbox();
const K3 = s3.ViktorychKeys;
let res = K3.rebind("post.like", ["b"]);
assert(!res.ok, "b is taken by Bookmark in the post scope");
assert.equal(res.conflicts[0].id, "post.bookmark");
assert.equal(K3.conflicts("post.like", ["g"]).some((c) => c.id === "nav.home"), true, "a chord prefix conflicts with global g …");
assert.equal(K3.conflicts("media.play", ["p"]).length, 0, "p is free in media scope");
assert.equal(K3.conflicts("media.play", ["m"])[0].id, "media.mute", "m is Mute in media scope");
assert.equal(K3.conflicts("timeline.next", ["l"]).length, 0, "different non-global scopes do not clash");
res = K3.rebind("post.like", ["b"], { replace: true });
assert(res.ok);
assert.deepEqual(K3.bindingsOf("post.like"), [["b"]]);
assert.deepEqual(K3.bindingsOf("post.bookmark"), [], "replace takes the key from the other command");
assert.deepEqual(K3.allConflicts(false), []);
K3.rebind("post.like", []);
assert.deepEqual(K3.bindingsOf("post.like"), [], "a command can be turned off");
const exported = K3.exportJson();
K3.resetAll();
assert.deepEqual(K3.bindingsOf("post.like"), [["l"]]);
assert.deepEqual(K3.bindingsOf("post.bookmark"), [["b"]]);
assert(K3.importJson(exported).ok, "export round-trips");
assert.deepEqual(K3.bindingsOf("post.bookmark"), []);
K3.resetCommand("post.bookmark");
assert.deepEqual(K3.bindingsOf("post.bookmark"), [["b"]]);
assert(!K3.importJson("{nope").ok, "bad JSON is refused");
assert(!K3.importJson(JSON.stringify({ app: "other" })).ok, "foreign files are refused");
const saved = JSON.parse(s3.localStorage.getItem(K3.STORE_KEY));
assert(saved.at > 0 || saved.at === 0, "prefs are saved locally");

/* Host sync: account prefs win when newer. */
const s4 = makeSandbox();
let hostPrefs = { v: 1, enabled: true, singleKeys: true, overrides: { "post.like": ["alt+l"] }, at: 5 };
s4.ViktorychKeysHost = { keyboardPrefs: () => hostPrefs, saveKeyboardPrefs: (p) => { hostPrefs = p; }, state: () => ({}) };
s4.ViktorychKeys.reloadPrefs();
assert.deepEqual(s4.ViktorychKeys.bindingsOf("post.like"), [["alt+l"]], "synced prefs apply");
s4.ViktorychKeys.rebind("post.like", ["shift+l"]);
assert.deepEqual(hostPrefs.overrides["post.like"], ["shift+l"], "changes go to account settings");

/* ---------- Single-key switch (WCAG 2.1.4) and master switch ---------- */
const s5 = makeSandbox();
const K5 = s5.ViktorychKeys;
const got = [];
K5.register({ id: "t.one", keys: ["j"], label: "Next post", scope: "global", run: () => { got.push("j"); } });
K5.register({ id: "t.mod", keys: ["alt+j"], label: "Next post", scope: "global", run: () => { got.push("alt+j"); } });
K5.unregister("timeline.next");
K5.setOption("singleKeys", false);
K5.onKeyDown(keyEvent("j", { target: fakeEl("div") }));
K5.onKeyDown(keyEvent("j", { code: "KeyJ", altKey: true, target: fakeEl("div") }));
assert.deepEqual(got, ["alt+j"], "single-key shortcuts can be turned off");
assert(K5.isCharacterKey(["j"]) && K5.isCharacterKey(["g", "h"]) && K5.isCharacterKey(["?"]) && !K5.isCharacterKey(["alt+j"]));
K5.setOption("singleKeys", true);
K5.setOption("enabled", false);
K5.onKeyDown(keyEvent("j", { target: fakeEl("div") }));
assert.deepEqual(got, ["alt+j"], "all shortcuts can be turned off");
K5.setOption("enabled", true);
K5.onKeyDown(keyEvent("j", { target: fakeEl("div") }));
assert.deepEqual(got, ["alt+j", "j"]);

/* ---------- Scopes ---------- */
const s6 = makeSandbox();
const K6 = s6.ViktorychKeys;
s6.ViktorychKeysHost = { state: () => ({ route: "home", modal: "compose" }) };
const ctx = K6.context();
assert(ctx.blocked && ctx.scopes.composer && ctx.scopes.modal, "compose dialog: composer and dialog scopes");
const cand = K6.candidates(ctx, false).map((e) => e.cmd.id);
assert(cand.includes("composer.post") && cand.includes("modal.close") && cand.includes("app.palette"));
assert(!cand.includes("nav.home") && !cand.includes("app.compose"), "page shortcuts wait while a dialog is open");
const tv = makeSandbox();
tv.document.documentElement.classList.contains = (c) => c === "tv-on";
let tvRan = false;
tv.ViktorychKeys.register({ id: "t.x", keys: ["z"], label: "Next post", scope: "global", run: () => { tvRan = true; } });
tv.ViktorychKeys.onKeyDown(keyEvent("z", { target: fakeEl("div") }));
assert(!tvRan, "TV mode keeps its remote keys");

/* ---------- Menus API for the sidebar menus ---------- */
let opened = "";
K.menus.register("home", (anchor) => { opened = "home:" + (anchor ? "a" : ""); return true; });
assert(K.menus.has("home") && K.menus.ids().includes("home"));
assert(K.menus.open("home", fakeEl("a")));
assert.equal(opened, "home:a");
K.menus.unregister("home");
assert(!K.menus.has("home"));

/* ---------- Palette fuzzy search ---------- */
const fz = sb.ViktorychKeysUi.fuzzy;
assert(fz("noti", "Notifications") > fz("noti", "Go to bottom and notice"));
assert(fz("ntf", "Notifications") > 0, "letters in order match");
assert.equal(fz("xyz", "Notifications"), -1);

/* ---------- Strings in every language ---------- */
function pack(file) {
  const t = read(file);
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}
const packs = { en: pack("i18n/en.js"), ru: pack("i18n/ru.js"), es: pack("i18n/es.js") };
const hi = sb.ViktorychKeysHi;
const strings = new Set(K.commands().map((c) => c.label).concat(Object.values(K.SCOPE_LABELS)));
["keys.js", "keys-ui.js"].forEach((f) => {
  for (const m of read(f).matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)) strings.add(JSON.parse('"' + m[1] + '"'));
  for (const m of read(f).matchAll(/^\s*\["([^"]+)", "#\//gm)) strings.add(m[1]);
});
["Sidebar items 1–9", "Home tabs 1–9", "Commands", "Pages", "Settings", "Accounts", "Communities", "Chats", "Themes", "Navigation", "Keyboard shortcuts"].forEach((s) => strings.add(s));
strings.forEach((s) => {
  ["en", "ru", "es"].forEach((code) => assert(Object.prototype.hasOwnProperty.call(packs[code], s), code + " pack has: " + s));
  assert(hi[s] || !Object.prototype.hasOwnProperty.call(hi, s), "hi entry not empty: " + s);
});
Object.keys(hi).forEach((s) => assert(packs.en[s], "Hindi entry has an English key: " + s));
assert(hi["Keyboard shortcuts"] && hi["Command palette"], "Hindi has the new strings");
/* Hindi fallback: the hi pack wins, else keys-hi.js. */
const s7 = makeSandbox();
s7.SI18n = { t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => (v && v[n] != null ? v[n] : "")), getLang: () => "hi" };
assert.equal(s7.ViktorychKeys.tr("Command palette"), s7.ViktorychKeysHi["Command palette"]);
assert.equal(s7.ViktorychKeys.tr("Speed {n}×", { n: 2 }), "गति 2×");

/* ---------- No ad-hoc shortcut handlers left behind ---------- */
assert(!/onShortcut/.test(read("dock.js")), "dock shortcuts live in the registry");
assert(!/ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/.test(read("x-compose.js")), "Ctrl+Enter lives in the registry");
const app = read("app.js");
assert(!/event\.key === "\/" && !event\.ctrlKey/.test(app), "/ lives in the registry");
assert(app.includes("window.ViktorychKeysHost"));
assert(read("index.html").includes('src="keys.js"') && read("sw.js").includes('"./keys-ui.js"'));
assert(read("settings-sync.js").includes('"keyboard"') && read("accounts.js").includes('"keyboard"'), "shortcuts sync with the account");

console.log("keys test ok");
