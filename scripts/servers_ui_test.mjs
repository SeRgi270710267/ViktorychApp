// Unit checks for servers-ui.js pure helpers: formatting, escaping,
// mentions, emoji, routes and the message merge used by the outbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load(hash) {
  const store = new Map();
  const win = {
    location: { hash: hash || "", origin: "https://example.test", pathname: "/" },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp, URL, encodeURIComponent, decodeURIComponent
  };
  win.window = win;
  win.document = { documentElement: { lang: "en", classList: { add() {}, remove() {}, toggle() {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, visibilityState: "visible" };
  win.navigator = { onLine: true, userAgent: "node" };
  win.CustomEvent = function (name, init) { this.type = name; this.detail = init && init.detail; };
  const ctx = vm.createContext(win);
  vm.runInContext(readFileSync(new URL("../servers-ui.js", import.meta.url), "utf8"), ctx);
  return win.ViktorychServers;
}

test("format escapes HTML and keeps markdown", () => {
  const T = load()._test;
  const out = T.format('<img src=x onerror=alert(1)> **b** `<i>` [x](javascript:alert(1))');
  assert.ok(!/<img src=x/.test(out));
  assert.ok(out.includes("&lt;img"));
  assert.ok(out.includes("<strong>b</strong>"));
  assert.ok(out.includes("<code>&lt;i&gt;</code>"));
  assert.ok(!/href="javascript:/i.test(out));
});

test("links, mentions and code blocks", () => {
  const T = load()._test;
  const out = T.format("hi <@0123456789abcdef> @everyone https://a.example/p?q=1&r=2.\n```\na<b\n```");
  assert.ok(out.includes('data-m="0123456789abcdef"'));
  assert.ok(out.includes('class="vsrv-mention all">@everyone'));
  assert.ok(out.includes('href="https://a.example/p?q=1&amp;r=2"'));
  assert.ok(out.includes('<pre class="vsrv-code">a&lt;b</pre>'));
});

test("emoji-only messages are detected", () => {
  const T = load()._test;
  assert.equal(T.emojiOnly("\u{1F600}\u{1F525}"), true);
  assert.equal(T.emojiOnly("hi \u{1F600}"), false);
  assert.equal(T.emojiOnly("<:wave:0123456789abcdef>"), true);
});

test("plain text and first link", () => {
  const T = load()._test;
  assert.equal(T.plain("**bold** <:wave:0123456789abcdef>"), "bold :wave:");
  assert.equal(T.firstLink("see `https://no.example` and https://yes.example/a)."), "https://yes.example/a");
  assert.equal(T.firstLink("nothing"), "");
});

test("routes", () => {
  assert.deepEqual({ ...load("#/messages/s/0123456789abcdef/fedcba9876543210")._test.routeOf() }, { mode: "server", sid: "0123456789abcdef", cid: "fedcba9876543210", jump: "" });
  assert.deepEqual({ ...load("#/messages/join/AbCd1234")._test.routeOf() }, { mode: "join", code: "AbCd1234" });
  assert.equal(load("#/messages/discord/123")._test.routeOf(), null);
  assert.equal(load("#/messages/s/nothex")._test.routeOf(), null);
  assert.equal(load("#/messages/s/0123456789abcdef").owns({ name: "messages" }), true);
});

test("merge replaces an optimistic message by nonce and keeps order", () => {
  const T = load()._test;
  const S = T.state;
  S.msgs = {};
  T.mergeMessages("c", [{ id: "0000000002aaaaaa", b: "two" }, { id: "zzzzzzzzzzpend01", b: "mine", n: "n1", pending: true }]);
  T.mergeMessages("c", [{ id: "0000000001aaaaaa", b: "one" }, { id: "0000000003aaaaaa", b: "mine", n: "n1" }]);
  const ids = JSON.parse(JSON.stringify(S.msgs.c.map((m) => m.id)));
  assert.deepEqual(ids, ["0000000001aaaaaa", "0000000002aaaaaa", "0000000003aaaaaa"]);
  T.mergeMessages("c", [{ id: "0000000003aaaaaa", b: "edited", e: 1 }]);
  assert.equal(S.msgs.c.length, 3);
  assert.equal(S.msgs.c[2].b, "edited");
});
