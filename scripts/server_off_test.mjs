/* The live row never polls a hidden tab or a lives-off server, and lazy
   modules never load a feature the owner switched off. Runs in a vm. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sandbox(off, hidden) {
  const store = new Map([["viktorychapp-server-off", JSON.stringify(off)]]);
  const timers = [];
  const listeners = {};
  const calls = [];
  const added = [];
  const doc = {
    visibilityState: hidden ? "hidden" : "visible",
    body: { appendChild: (n) => added.push(n.src || n.href) },
    head: { appendChild: (n) => added.push(n.src || n.href) },
    baseURI: "http://127.0.0.1/",
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({})
  };
  const win = {
    document: doc,
    navigator: {},
    localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: () => {}, clearTimeout: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true,
    CustomEvent: function () {},
    ViktorychAccounts: {
      token: () => "tok",
      currentApi: () => "https://api.test",
      call: (p) => { calls.push(p); return Promise.resolve({ status: 200, lives: [] }); }
    }
  };
  win.window = win;
  win.self = win;
  const ctx = vm.createContext(Object.assign(win, { console, Promise, JSON, Date, Math, Object, Array, String, Number, Map, Set, URL }));
  return { ctx, timers, listeners, calls, added, doc };
}

function runFile(box, rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), box.ctx, { filename: rel });
}

// Visible tab, lives on: one request at start, then the interval polls.
let box = sandbox([], false);
runFile(box, "live.js");
assert.equal(box.calls.filter((p) => p === "/v1/live").length, 1, "polls once on start");

// Hidden tab: no request at all, even when the interval fires.
box = sandbox([], true);
runFile(box, "live.js");
box.timers.forEach((fn) => fn());
assert.equal(box.calls.length, 0, "a hidden tab does not poll");
box.doc.visibilityState = "visible";
(box.listeners.visibilitychange || []).forEach((fn) => fn());
assert.equal(box.calls.length, 1, "becoming visible polls once");

// Lives off on the server: never polls.
box = sandbox(["lives"], false);
runFile(box, "live.js");
box.timers.forEach((fn) => fn());
assert.equal(box.calls.length, 0, "lives off never polls");

// Lazy modules skip a feature that is off.
box = sandbox(["shorts"], false);
runFile(box, "shared/lazy-modules.js");
box.ctx.ViktorychLazy.ensure("shorts");
assert.equal(box.added.length, 0, "shorts off loads nothing");
box.ctx.ViktorychLazy.ensure("games");
assert.ok(box.added.some((src) => /games\.js/.test(src)), "other modules still load");

// The index mount skips Stories and pills files when the server turned them off.
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(index, /viktorychapp-server-off[\s\S]{0,400}"stories\.js"/, "index mount reads the server-off list");

console.log("server off ok");
