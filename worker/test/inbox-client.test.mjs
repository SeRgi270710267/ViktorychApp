// Client-side Inbox helpers (inbox.js, inbox-mail.js), loaded in a sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load(file, win) {
  const src = readFileSync(new URL("../../" + file, import.meta.url), "utf8");
  vm.runInNewContext(src, { window: win, module: undefined, JSON, String, RegExp, Math, Date, Promise, URLSearchParams, setTimeout, clearTimeout });
  return win;
}
function fakeWindow(hash) {
  const store = new Map();
  return {
    location: { hash: hash || "" },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    addEventListener() {}
  };
}

test("codeIn finds one-time codes and skips order numbers", () => {
  const w = load("inbox-mail.js", fakeWindow());
  const codeIn = w.ViktorychInboxMail.codeIn;
  assert.equal(codeIn("Your code 482913"), "482913");
  assert.equal(codeIn("Ваш код: 1234"), "1234");
  assert.equal(codeIn("Your verification code is ABC123"), "ABC123");
  assert.equal(codeIn("Code 553-221"), "553221");
  assert.equal(codeIn("Order #12345678 shipped"), "");
  assert.equal(codeIn("Weekly digest 2026"), "");
});

test("every mail provider has a native guide and a filter rule", () => {
  const w = load("inbox-mail.js", fakeWindow());
  const P = w.ViktorychInboxMail.PROVIDERS;
  for (const id of ["yandex", "gmail", "outlook", "mailru"]) {
    assert.ok(P[id].name, id);
    assert.ok(P[id].steps().length >= 2, id);
    assert.ok(P[id].rule().includes("ViktorychApp") || P[id].rule().includes("simplelogin"), id);
    for (const k of ["imap", "appPassword", "filters"]) if (P[id][k]) assert.match(P[id][k], /^https:\/\//, id + " " + k);
  }
});

test("inbox sections, linked sources and chips", () => {
  const w = load("inbox.js", fakeWindow("#/inbox"));
  const I = w.ViktorychInbox;
  assert.equal(I.sectionOf("#/messages/mail"), "mail");
  assert.equal(I.sectionOf("#/inbox/sms"), "sms");
  assert.equal(I.sectionOf("#/messages/mail/m/42"), "mail");
  assert.equal(I.sectionOf("#/messages/connect"), "connect");
  assert.equal(I.sectionOf("#/messages/mailbox"), "");
  assert.equal(I.filterOf("#/messages?f=discord"), "discord");
  assert.ok(!I.tabsHtml("#/messages").includes('data-inbox="mail"'));
  I.setLinked("mail", true);
  assert.equal(I.linked("mail"), true);
  const html = I.tabsHtml("#/messages/mail");
  assert.match(html, /data-inbox="mail"/);
  assert.match(html, /aria-selected="true" href="#\/messages\/mail"/);
  assert.match(html, /data-inbox="connect"/);
  I.setLinked("mail", false);
  assert.equal(I.linked("mail"), false);
  assert.equal(I.register({ id: "mail", label: "x" }), false);
});
