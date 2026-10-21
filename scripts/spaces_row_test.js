/* Follow gate, audio allowlist, and marquee plan for Spaces. */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { console, URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("spaces.js", "utf8"), context);
const L = context.SpacesLogic;
assert.ok(L, "spaces.js exports SpacesLogic without a document");

const host = {
  platform: "telegram",
  handle: "redacted_handle",
  followId: "telegram:redacted_handle"
};
const live = { id: "superintelmusic", live: true, followId: host.followId, host, kind: "space" };
const video = { id: "clip", live: true, followId: "youtube:news", kind: "video", host: {} };

assert.strictEqual(L.homePills([live], [host.followId]).length, 1);
assert.strictEqual(L.homePills([live], []).length, 0);
assert.strictEqual(L.homePills([live], [host.followId]).length, 1);
assert.strictEqual(L.homePills([{ ...live, live: false }], [host.followId]).length, 0);
assert.strictEqual(L.profileLive(live, "telegram", "@redacted_handle"), true);
assert.strictEqual(L.homePills([live], []).length, 0);
assert.strictEqual(L.profileLive({ ...live, live: false }, "telegram", host.handle), false);
assert.strictEqual(L.profileLive(live, "x", host.handle), false);
assert.strictEqual(L.homePills([video], ["youtube:news"]).length, 1);
assert.strictEqual(L.homePills([video], []).length, 0);

const allow = ["trycloudflare.com"];
const ok = L.allowedAudio("https://abc.trycloudflare.com/live/a.m3u8", "", allow);
assert.ok(ok.startsWith("https://abc.trycloudflare.com/"));
assert.strictEqual(L.allowedAudio("https://radio.trycloudflare.com/a.m3u8", "", ["*.trycloudflare.com"]).includes("radio.trycloudflare.com"), true);
assert.strictEqual(L.allowedAudio("http://abc.trycloudflare.com/a.m3u8", "", allow), "");
assert.strictEqual(L.allowedAudio("https://evil.com/a.m3u8", "", allow), "");
assert.strictEqual(L.allowedAudio("https://nottrycloudflare.com/a.m3u8", "", allow), "");
assert.strictEqual(L.allowedAudio("https://abc.trycloudflare.com.evil.com/a.m3u8", "", allow), "");
assert.strictEqual(L.allowedAudio("https://abc.trycloudflare.com/a.m3u8", "", []), "");
assert.strictEqual(L.allowedAudio("//abc.trycloudflare.com/a.m3u8", "", allow), "");
const relative = L.allowedAudio("audio.m3u8", "https://abc.trycloudflare.com/radio/", allow);
assert.strictEqual(relative, "https://abc.trycloudflare.com/radio/audio.m3u8");
assert.strictEqual(L.allowedAudio("audio.m3u8", "http://abc.trycloudflare.com/radio/", allow), "");

const parsed = L.audioFromStatus({
  live: true,
  title: "Some Song",
  artist: "Someone",
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  listeners: 4
}, allow);
assert.strictEqual(parsed.live, true);
assert.strictEqual(parsed.url, "https://abc.trycloudflare.com/radio/a.m3u8");
assert.strictEqual(parsed.listeners, 4);
assert.strictEqual(parsed.title, undefined);
assert.strictEqual(L.audioFromStatus({ live: true, base: "", hls: { audio: "" } }, allow).live, false);
assert.strictEqual(L.listenersOf({}), null);

const still = L.marqueePlan(0, false);
assert.strictEqual(still.animate, false);
assert.strictEqual(L.marqueePlan(40, true).animate, false);
const move = L.marqueePlan(40, false);
assert.strictEqual(move.animate, true);
assert.strictEqual(move.duration, 20);
assert.strictEqual(move.easing, "linear");
assert.strictEqual(move.from, "0%");
assert.strictEqual(move.to, "-100%");

const src = fs.readFileSync("spaces.js", "utf8");
assert.ok(src.includes('createElement("audio")'));
assert.ok(!src.includes('createElement("video")') && !src.includes("<video"));
assert.ok(!src.includes("livestream"));
assert.ok(!src.includes("t.me/"));
assert.ok(src.includes("spaces-demo"));
assert.ok(src.includes('host !== "localhost"') && src.includes('"127.0.0.1"'));
assert.ok(src.includes("https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"));
assert.ok(src.includes("https://www.youtube-nocookie.com/embed/live_stream?channel="));

const status = JSON.parse(fs.readFileSync("live/superintelmusic.json", "utf8"));
assert.strictEqual(status.live, false);
assert.strictEqual(status.base, "");
assert.strictEqual(status.hls.audio, "");
assert.ok(!/trycloudflare|http:\/\//i.test(JSON.stringify(status)));

const config = JSON.parse(fs.readFileSync("feeds.config.json", "utf8"));
const feed = config.feeds.find((item) => item.id === "telegram:redacted_handle");
assert.ok(feed, "telegram host feed");
assert.deepStrictEqual([...feed.profile.name].map((ch) => ch.codePointAt(0)), [0x53, 0x435, 0x420, 0x67, 0x418, 0x33, 0x37, 0x37, 0x35, 0x39, 0x39, 0x36, 0x38, 0x33, 0x34]);
const space = config.spaces.find((item) => item.id === "superintelmusic");
assert.strictEqual(space.title, "SuperintelMusic");
assert.strictEqual(space.host.followId, "telegram:redacted_handle");
assert.strictEqual(space.source.type, "hls");
assert.strictEqual(space.source.statusUrl, "live/superintelmusic.json");
assert.deepStrictEqual(space.source.allow, ["trycloudflare.com"]);
assert.ok(!space.source.url);

const worker = fs.readFileSync("sw.js", "utf8");
assert.ok(worker.includes('VERSION = "superintel4-__SW_VERSION__"'));
assert.ok(worker.includes("./spaces.js") && worker.includes("./spaces.css"));
assert.ok(!worker.includes("superintelmusic.json"));
assert.ok(worker.includes("isSpaceStatus"));

console.log("spaces row tests ok");
