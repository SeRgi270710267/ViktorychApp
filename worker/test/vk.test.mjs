import assert from "node:assert/strict";
import test from "node:test";
import { pickChannel, parseChannels, rowsFromChannel, rowsFromWidget, rowsFromWall, widgetDate, syncVk, vkChannelId } from "../src/vk.js";

test("channel list reads ids, links and labels", () => {
  const list = parseChannels("News=https://vk.com/club42\n-7, public7\nsome_name ; https://m.vk.com/other.name?w=1");
  assert.deepEqual(list.map((c) => [c.gid, c.name, c.label]), [[42, "", "News"], [7, "", ""], [0, "some_name", ""], [0, "other.name", ""]]);
  assert.equal(vkChannelId(42), "99000000000042");
});

test("widget page becomes message rows", () => {
  const html = '<a class="wcommunity_header_avatar" href="https://vk.com/club42"><img src="https://sun9-1.userapi.com/a.jpg?x=1&amp;y=2" /></a>'
    + '<div class="wcommunity_name"><a class="wcommunity_name_link" href="https://vk.com/club42">Test community</a></div>'
    + '<div class="wcommunity_post"><div class="wcommunity_post_header"><a class="wcommunity_post_date" href="/wall-42_9" target="_blank">27 February 2025 at 12:46</a></div>'
    + '<div class="wall_post_text" data-testid="wall_post_text">Hello<br>see <a href="https://dev.vk.com/ru">docs</a> <img class="emoji" alt="&#128421;"><button>Show more</button></div>'
    + '<div style="background-image: url(https://sun1-2.userapi.com/p.jpg?size=604x340&amp;sign=x)"></div></div>'
    + '<div class="wcommunity_post"><div class="wcommunity_post_header"><a class="wcommunity_post_date" href="/wall-42_8">today at 9:05</a></div><div class="wall_post_text">Second</div></div>';
  const got = rowsFromWidget(42, html, Date.UTC(2026, 9, 28, 12, 0));
  assert.equal(got.title, "Test community");
  assert.equal(got.avatar, "https://sun9-1.userapi.com/a.jpg?x=1&y=2");
  assert.equal(got.rows.length, 2);
  assert.equal(got.rows[0].id, "9");
  assert.equal(got.rows[0].text, "Hello\nsee docs (https://dev.vk.com/ru) \u{1F5A5}");
  assert.equal(got.rows[0].date, "2025-02-27T09:46:00.000Z");
  assert.equal(got.rows[0].attachments[0].url, "https://sun1-2.userapi.com/p.jpg?size=604x340&sign=x");
  assert.equal(got.rows[0].link, "https://vk.com/wall-42_9");
  assert.equal(got.rows[1].date, "2026-10-28T06:05:00.000Z");
  assert.equal(widgetDate("nonsense", 0), "");
});

test("wall.get becomes message rows with authors and photos", () => {
  const got = rowsFromWall(42, {
    items: [{ id: 5, from_id: -42, date: 1700000000, text: "Hi [club42|Test]", likes: { count: 3 }, attachments: [{ type: "photo", photo: { sizes: [{ url: "https://sun1.userapi.com/s.jpg", width: 130, height: 100 }, { url: "https://sun1.userapi.com/l.jpg", width: 1280, height: 960 }, { url: "https://sun1.userapi.com/x.jpg", width: 2560, height: 1920 }] } }] }],
    groups: [{ id: 42, name: "Test", screen_name: "club42", photo_100: "https://sun1.userapi.com/g.jpg" }]
  });
  assert.equal(got.rows[0].text, "Hi Test");
  assert.equal(got.rows[0].attachments[0].url, "https://sun1.userapi.com/l.jpg");
  assert.equal(got.rows[0].reactions[0].count, 3);
  assert.equal(got.authors[got.rows[0].author].name, "Test");
});

test("sync stores Discord-shaped docs in R2 and merges history", async () => {
  const store = {};
  const DATA = {
    async get(key) { return key in store ? { text: async () => store[key] } : null; },
    async put(key, value) { store[key] = String(value); }
  };
  const page = (id) => '<div class="wcommunity_post"><a class="wcommunity_post_date" href="/wall-42_' + id + '">1 March 2026 at 10:00</a><div class="wall_post_text">Post ' + id + '</div></div>';
  let html = page(1);
  const fetcher = async (url) => {
    assert.ok(url.indexOf("widget_community.php") > 0 && url.indexOf("gid=42") > 0, "no token: the public widget");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const env = { DATA, VK_CHANNELS: "News=42" };
  assert.deepEqual(await syncVk({ DATA }, 0, fetcher), { skipped: true });
  await syncVk(env, Date.UTC(2026, 2, 2), fetcher);
  html = page(2);
  const res = await syncVk(env, Date.UTC(2026, 2, 2, 0, 2), fetcher);
  assert.deepEqual(res, { channels: 1, ok: 1 });
  const index = JSON.parse(store["discord/vk.json"]);
  assert.equal(index.servers[0].channels[0].id, "99000000000042");
  assert.equal(index.servers[0].channels[0].name, "News");
  const doc = JSON.parse(store["discord/messages/99000000000042.json"]);
  assert.deepEqual(doc.messages.map((m) => m.id), ["2", "1"]);
  assert.equal(doc.via, "widget");
});

test("with a token the official API is used", async () => {
  const store = {};
  const DATA = { async get(key) { return key in store ? { text: async () => store[key] } : null; }, async put(key, value) { store[key] = String(value); } };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url);
    const params = new URLSearchParams(String(init.body));
    assert.equal(params.get("access_token"), "tok");
    if (url.endsWith("groups.getById")) return Response.json({ response: { groups: [{ id: 42, name: "Test", photo_100: "https://sun1.userapi.com/g.jpg" }] } });
    return Response.json({ response: { items: [{ id: 3, from_id: -42, date: 1700000000, text: "API post" }], groups: [{ id: 42, name: "Test" }] } });
  };
  await syncVk({ DATA, VK_CHANNELS: "some_name", VK_TOKEN: "tok" }, 0, fetcher);
  assert.deepEqual(calls.map((u) => u.split("/").pop()), ["groups.getById", "messages.getConversations", "wall.get"]);
  const doc = JSON.parse(store["discord/messages/99000000000042.json"]);
  assert.equal(doc.messages[0].text, "API post");
  assert.equal(doc.via, "api");
});

test("Messenger channel links parse to the community id", () => {
  const list = parseChannels("https://vk.ru/im/channels/-42\nhttps://vk.com/im?sel=-43\nhttps://web.vk.me/x");
  assert.deepEqual(list.map((c) => c.gid), [42, 43]);
});

test("a community key reads the Messenger channel, not the empty wall", async () => {
  const store = {};
  const DATA = { async get(key) { return key in store ? { text: async () => store[key] } : null; }, async put(key, value) { store[key] = String(value); } };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url.split("/").pop());
    const params = new URLSearchParams(String(init.body));
    if (url.endsWith("groups.getById")) return Response.json({ response: { groups: [{ id: 42, name: "Test" }] } });
    if (url.endsWith("messages.getConversations")) return Response.json({ response: { items: [
      { conversation: { peer: { id: 2000000001, type: "chat" }, chat_settings: { title: "Chat" } } },
      { conversation: { peer: { id: 2000000002, type: "chat" }, chat_settings: { title: "Channel", is_group_channel: true, photo: { photo_100: "https://sun1.userapi.com/c.jpg" } } } }
    ] } });
    if (url.endsWith("messages.getHistory")) {
      assert.equal(params.get("peer_id"), "2000000002");
      return Response.json({ response: { items: [
        { id: 0, conversation_message_id: 7, from_id: -42, date: 1700000100, text: "Channel post", attachments: [{ type: "photo", photo: { sizes: [{ url: "https://sun1.userapi.com/p.jpg", width: 800, height: 600 }] } }], reactions: [{ count: 2 }, { count: 1 }] },
        { id: 0, conversation_message_id: 6, from_id: -42, date: 1700000000, action: { type: "chat_create" } }
      ], groups: [{ id: 42, name: "Test" }] } });
    }
    throw new Error("unexpected " + url);
  };
  await syncVk({ DATA, VK_CHANNELS: "https://vk.com/im/channels/-42", VK_TOKEN: "tok" }, 0, fetcher);
  assert.deepEqual(calls, ["groups.getById", "messages.getConversations", "messages.getHistory"]);
  const doc = JSON.parse(store["discord/messages/99000000000042.json"]);
  assert.equal(doc.via, "channel");
  assert.equal(doc.name, "Test");
  assert.deepEqual(doc.messages.map((m) => [m.id, m.text]), [["7", "Channel post"]]);
  assert.equal(doc.messages[0].attachments[0].url, "https://sun1.userapi.com/p.jpg");
  assert.equal(doc.messages[0].reactions[0].count, 3);
  assert.equal(rowsFromChannel(42, null).rows.length, 0);
});

test("a closed community with no token still lists the channel", async () => {
  const store = {};
  const DATA = { async get(key) { return key in store ? { text: async () => store[key] } : null; }, async put(key, value) { store[key] = String(value); } };
  const fetcher = async () => new Response('<div class="wcommunity_closed">This is a closed community</div>', { headers: { "content-type": "text/html; charset=utf-8" } });
  await syncVk({ DATA, VK_CHANNELS: "42" }, 0, fetcher);
  assert.equal(JSON.parse(store["discord/vk.json"]).servers[0].channels[0].id, "99000000000042");
  assert.equal(JSON.parse(store["discord/messages/99000000000042.json"]).via, "closed");
});

test("a user key that follows many channels reads only the one asked for", () => {
  const ch = (title) => ({ peer: { id: 1, type: "chat" }, chat_settings: { title: title, is_channel: true } });
  const list = [ch("Other"), ch("Wanted Community"), ch("Third")];
  assert.equal(pickChannel(list, ["", "wanted community"]).chat_settings.title, "Wanted Community");
  assert.equal(pickChannel(list, ["Third", "x"]).chat_settings.title, "Third");
  assert.equal(pickChannel(list, ["", "Nope"]), null);
  assert.equal(pickChannel([ch("Only")], ["", "Nope"]).chat_settings.title, "Only");
});
