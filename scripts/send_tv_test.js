/* Send to my TV (send-tv.js): the short link, per-brand guides, store links
   for the phone's own OS, share with a copy fallback, and no fake "push to TV". */
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");

function load(ua, cfg) {
  const store = {};
  const listeners = {};
  const doc = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: () => null,
    body: { appendChild() {} },
    createElement: () => ({ setAttribute() {}, style: {}, select() {}, remove() {} }),
    execCommand: () => true
  };
  const ctx = {
    navigator: { userAgent: ua, maxTouchPoints: 0 },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: doc,
    VIKTORYCH_ACCOUNTS: cfg || {}
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  const src = fs.readFileSync(path.join(__dirname, "..", "send-tv.js"), "utf8");
  new Function("window", "globalThis", "navigator", "localStorage", "document", src)(ctx, ctx, ctx.navigator, ctx.localStorage, doc);
  return { api: ctx.ViktorychSendTV, ctx, store, listeners };
}

const android = load("Mozilla/5.0 (Linux; Android 14) Mobile");
assert.strictEqual(android.api.link(), "https://viktorychapp.pages.dev/?tv=1");
assert.deepStrictEqual(android.api.brands(), ["samsung", "lg", "google", "fire", "other"]);
const lg = android.api.page({ brand: "lg" });
assert(lg.includes('data-stv-guide="lg"') && lg.includes("LG ThinQ"), "LG guide renders");
assert(lg.includes("play.google.com/store/apps/details?id=com.lgeha.nuts") && !lg.includes("apps.apple.com"), "Android gets the Play link only");
assert(lg.includes('data-stv="copy"'), "copy button");
assert(lg.includes("What a website can"), "honest limits section");
const none = android.api.page({});
assert(!none.includes("data-stv-guide=\"samsung\""), "no brand picked yet");

const ios = load("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
const fire = ios.api.page({ brand: "fire" });
assert(fire.includes("apps.apple.com/app/id947984433") && !fire.includes("play.google.com"), "iPhone gets the App Store link only");

const other = load("Mozilla/5.0 (X11; Linux x86_64)").api.page({ brand: "other" });
assert(!other.includes("play.google.com") && other.includes("Any TV with a browser"), "generic guide needs no app");

const custom = load("Android", { tvHost: "viktorychgroup.github.io" });
assert.strictEqual(custom.api.link(), "https://viktorychgroup.github.io/?tv=1", "owner can switch to the short org address");
const bad = load("Android", { tvHost: "javascript:alert(1)" });
assert.strictEqual(bad.api.host(), "viktorychapp.pages.dev", "bad hosts fall back");

/* Picking a brand is remembered on this device. */
android.listeners.click({ target: { closest: (sel) => (sel === "[data-stv-brand]" ? { getAttribute: () => "samsung" } : null) }, preventDefault() {} });
assert(android.api.page({}).includes('data-stv-guide="samsung"'), "remembered brand");

const lazy = fs.readFileSync(path.join(__dirname, "..", "shared", "lazy-modules.js"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
assert(lazy.includes('sendtv: { classic: true, scripts: ["send-tv.js", "send-tv.css"] }'));
assert(sw.includes('"./send-tv.js"') && sw.includes("send-tv\\.js"));
assert(app.includes('parts[0] === "send-to-tv"') && app.includes('ensureLazy("sendtv")'));
console.log("send to TV ok");
