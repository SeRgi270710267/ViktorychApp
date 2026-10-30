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

const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

function withLayout(hash) {
  const w = load("inbox.js", fakeWindow(hash));
  const I = w.ViktorychInbox;
  const box = { layout: null, saves: [] };
  I.bindLayout({ get: () => box.layout, save: (next, prev) => { box.saves.push({ next, prev }); box.layout = next; } });
  return { I, box, w };
}

test("Inbox is unified by default", () => {
  const { I } = withLayout("#/messages");
  const lay = I.layout();
  same(lay.split, []);
  same(lay.hidden, []);
  same(lay.order.slice(0, 4), ["servers", "discord", "mail", "sms"]);
  assert.equal(I.title("#/messages?f=discord"), "Inbox");
  assert.equal(I.navVisible("inbox-discord"), false);
  assert.equal(I.inboxActive("#/messages?f=discord"), true);
});

test("a split section gets its own page and nav icon and leaves the chips", () => {
  const { I, box } = withLayout("#/messages");
  I.act("split", "discord");
  same(box.layout.split, ["discord"]);
  same(box.saves[0].prev.split, [], "the hook sees the old layout too");
  assert.equal(I.navVisible("inbox-discord"), true);
  assert.equal(I.navActive("inbox-discord", "#/messages?f=discord"), true);
  assert.equal(I.inboxActive("#/messages?f=discord"), false);
  assert.equal(I.inboxActive("#/messages"), true);
  assert.equal(I.title("#/messages?f=discord"), "Discord");
  assert.ok(!I.tabsHtml("#/messages").includes('data-inbox="discord"'));
  const page = I.tabsHtml("#/messages?f=discord");
  assert.match(page, /data-inbox-act="merge" data-inbox-sec="discord"/);
  assert.ok(!page.includes("inbox-chips"), "a split page shows no Inbox chips");
  I.act("merge", "discord");
  same(box.layout.split, []);
  assert.match(I.tabsHtml("#/messages"), /data-inbox="discord"/);
});

test("split needs the section to exist on this device", () => {
  const { I } = withLayout("#/messages");
  I.act("split", "mail");
  assert.equal(I.isSplit("mail"), true);
  assert.equal(I.navVisible("inbox-mail"), false, "no Mail linked, no icon");
  I.setLinked("mail", true);
  assert.equal(I.navVisible("inbox-mail"), true);
  assert.equal(I.title("#/messages/mail/settings"), "Mail");
  assert.equal(I.title("#/messages/aliases"), "Mail", "aliases belong to Mail");
});

test("pin, reorder, hide and reset", () => {
  const { I, box } = withLayout("#/messages");
  I.act("down", "servers");
  same(I.ordered().slice(0, 2), ["discord", "servers"]);
  I.act("pin", "servers");
  assert.equal(I.ordered()[0], "servers", "pinned first");
  assert.match(I.tabsHtml("#/messages"), /inbox-chip pinned" role="tab" aria-selected="false" href="#\/messages\?f=servers"/);
  I.act("down", "servers");
  assert.equal(I.ordered()[0], "servers", "a pinned section does not move past unpinned ones");
  I.act("split", "servers");
  I.act("hide", "servers");
  assert.equal(I.isHidden("servers"), true);
  assert.equal(I.isSplit("servers"), false, "hiding also merges");
  assert.equal(I.isPinned("servers"), false);
  assert.ok(!I.tabsHtml("#/messages").includes('data-inbox="servers"'));
  I.act("show", "servers");
  assert.match(I.tabsHtml("#/messages"), /data-inbox="servers"/);
  I.act("split", "discord");
  I.act("reset", "all");
  same([box.layout.split, box.layout.hidden, box.layout.pinned], [[], [], []]);
});

test("layouts from older or other devices are cleaned", () => {
  const { I } = withLayout("#/messages");
  const lay = I.cleanLayout({ order: ["sms", "sms", "nope!", 7, "later-kind"], split: ["sms", "later-kind", "x"], hidden: ["mail"], pinned: ["mail", "sms"] });
  same(lay.order.slice(0, 2), ["sms", "later-kind"], "unknown kinds keep their place");
  assert.ok(["servers", "discord", "mail"].every((id) => lay.order.includes(id)));
  same(lay.split, ["sms"], "only built-in sections can be split");
  same(lay.pinned, ["sms"], "hidden sections are not pinned");
  same(I.cleanLayout(null).split, []);
});

test("menu rows offer split or merge", () => {
  const { I } = withLayout("#/messages");
  same(I.menuRows("discord").map((r) => r.act || r.href), ["split", "pin", "up", "down", "hide", "#/settings/display/inbox"]);
  I.act("split", "discord");
  assert.equal(I.menuRows("discord")[0].act, "merge");
  assert.match(I.settingsHtml(), /Merge back into Inbox/);
});

test("the bottom-bar icon a split page pushed out is remembered only while split", () => {
  const { I } = withLayout("#/messages");
  const kept = I.cleanLayout({ split: ["discord"], gave: { discord: "notifications", mail: "explore", sms: "Bad Id!" } });
  same(kept.gave, { discord: "notifications" });
  same(I.cleanLayout({ split: [], gave: { discord: "notifications" } }).gave, {});
});
