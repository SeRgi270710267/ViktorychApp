/* Achievement unlocked: queue, once per badge tier, settings, rumble and quiet rules. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

function fakeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, parentNode: null, innerHTML: "", className: "",
    classList: {
      add(c) { if (!el.className.split(" ").includes(c)) el.className = (el.className + " " + c).trim(); },
      remove(c) { el.className = el.className.split(" ").filter((x) => x && x !== c).join(" "); },
      contains(c) { return el.className.split(" ").includes(c); }
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] == null ? null : el.attrs[k]; },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { el.children = el.children.filter((c) => c !== child); child.parentNode = null; }
  };
  return el;
}

function setup(opts) {
  const store = {};
  const timers = [];
  const vibes = [];
  let chimes = 0;
  const body = fakeEl("body");
  const listeners = {};
  const document = {
    readyState: "complete", body, visibilityState: opts.hidden ? "hidden" : "visible",
    createElement: fakeEl,
    querySelector(sel) { return sel === ".ach" ? body.children.find((c) => c.classList.contains("ach")) || null : null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  };
  function Ctx() {
    this.currentTime = 0; this.state = "running"; this.destination = {};
    const node = () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { setValueAtTime() {} }, start() { chimes++; }, stop() {} });
    this.createGain = node; this.createOscillator = node;
  }
  const sandbox = {
    console, JSON, Math, Object, String, Number, isNaN,
    document,
    setTimeout(fn, ms) { timers.push({ fn, ms: ms || 0 }); return timers.length; },
    clearTimeout() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    matchMedia: () => ({ matches: !!opts.reduced }),
    navigator: Object.assign({ userActivation: { hasBeenActive: true } }, opts.noVibrate ? {} : { vibrate(p) { vibes.push(p); return true; } }),
    AudioContext: Ctx,
    t: (key, vars) => key.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m)),
    ViktorychAccounts: {
      account: () => ({ publicId: "acct-test", handle: "tester" }),
      token: () => "",
      call: () => Promise.resolve({})
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("badges.js"), sandbox, { filename: "badges.js" });
  function run() {
    // Run timers in time order until the queue is empty.
    let now = 0;
    const pending = timers;
    while (pending.length) {
      pending.sort((a, b) => a.ms - b.ms);
      const next = pending.shift();
      now += next.ms;
      pending.forEach((t) => { t.ms = Math.max(0, t.ms - next.ms); });
      next.fn();
    }
    return now;
  }
  return { api: sandbox.ViktorychAchievements, body, store, vibes, run, chimes: () => chimes };
}

// Queue plays one after another, each shown once per account.
{
  const t = setup({});
  const a = t.api;
  a.celebrate([{ id: "author", tier: "bronze" }, { id: "voice", tier: "silver" }, { id: "author", tier: "bronze" }]);
  assert.equal(a.pending(), 2, "duplicates in one batch are queued once");
  assert.equal(t.body.children.length, 1, "only one toast at a time");
  const html = t.body.children[0].innerHTML;
  assert(html.includes("Achievement unlocked") && html.includes("ach-orb") && html.includes("ach-shine") && html.includes('data-ach-open="author"'), "toast has orb, copy, shine and opens the badge");
  t.run();
  assert.equal(a.pending(), 0, "queue drains");
  assert.equal(t.body.children.length, 0, "toasts remove themselves");
  assert(a.wasShown({ id: "author", tier: "bronze" }) && a.wasShown({ id: "voice", tier: "silver" }), "shown tiers are remembered");
  assert(!a.wasShown({ id: "author", tier: "silver" }), "a higher tier is new");
  a.celebrate([{ id: "author", tier: "bronze" }]);
  assert.equal(a.pending(), 0, "a shown tier never repeats");
  assert(t.chimes() > 0, "default sound is on");
  assert.equal(t.vibes.length, 4, "pop tick and opening pulse for each toast");
  assert.deepEqual(Array.from(t.vibes[0]), [14]);
  assert.deepEqual(Array.from(t.vibes[1]), [20, 60, 36]);
}

// Settings: defaults, intensity scaling, sound and rumble off, preview does not mark shown.
{
  const t = setup({});
  const a = t.api;
  const p = a.prefs();
  assert.equal(p.sound, true); assert.equal(p.chime, "classic"); assert.equal(p.volume, 60); assert.equal(p.rumble, true); assert.equal(p.intensity, "medium");
  assert.deepEqual(Array.from(a.rumblePattern("open", "strong")), [32, 60, 58]);
  assert.deepEqual(Array.from(a.rumblePattern("open", "light")), [12, 60, 22]);
  assert.equal(a.chimes.length, 4);
  const html = a.settingsHtml();
  ["Achievements", "Achievement sound", "Volume", "Classic", "Sparkle", "Deep", "Retro", "Achievement rumble", "Rumble strength", "Preview rumble", "Preview achievement"].forEach((s) => assert(html.includes(s), "settings show " + s));
  a.setPref("sound", false); a.setPref("rumble", false); a.setPref("chime", "nope");
  assert.equal(a.prefs().chime, "classic", "unknown chime falls back");
  assert(!a.mayChime() && !a.mayRumble(), "off means silent and still");
  a.celebrate([{ id: "story", tier: "gold" }]);
  t.run();
  assert.equal(t.chimes(), 0); assert.equal(t.vibes.length, 0);
}

// Reduced motion, hidden tab, and no vibrate support.
{
  const calm = setup({ reduced: true });
  calm.api.celebrate([{ id: "live", tier: "gold" }]);
  assert(calm.body.children[0].className.includes("calm"), "reduced motion uses the calm fade");
  calm.run();
  assert.equal(calm.chimes(), 0); assert.equal(calm.vibes.length, 0);
  const hidden = setup({ hidden: true });
  assert(!hidden.api.mayChime() && !hidden.api.mayRumble(), "a hidden tab stays quiet");
  const still = setup({ noVibrate: true });
  assert(!still.api.mayRumble());
  assert(still.api.settingsHtml().includes("This device can&#39;t vibrate."), "no-vibrate devices see a disabled control");
}

// Wiring: styles, settings page, and translations.
{
  const css = read("badges.css");
  assert(css.includes("prefers-reduced-motion") && css.includes("@keyframes ach-ring") && css.includes("@keyframes ach-shine") && css.includes("html.tv-on .ach"), "styles cover motion, reduced motion and TV");
  assert(read("app.js").includes("ViktorychAchievements.settingsHtml()"), "Settings > Notifications shows the Achievements block");
  for (const code of ["en", "ru", "es"]) {
    const pack = read("i18n/" + code + ".js");
    for (const key of ["Achievement unlocked", "Achievement rumble", "Preview rumble", "Sparkle", "Gentle"]) assert(pack.includes(JSON.stringify(key) + ":"), code + " has " + key);
  }
}

console.log("ok achievement toast");
