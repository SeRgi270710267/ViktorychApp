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

const at = Date.parse("2026-10-21T20:00:00.000Z");
const parsed = L.audioFromStatus({
  live: true,
  title: "Some Song",
  artist: "Someone",
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  listeners: 4,
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at);
assert.strictEqual(parsed.live, true);
assert.strictEqual(parsed.url, "https://abc.trycloudflare.com/radio/a.m3u8");
assert.strictEqual(parsed.listeners, 4);
assert.strictEqual(parsed.title, undefined);
assert.strictEqual(L.audioFromStatus({ live: true, base: "", hls: { audio: "" } }, allow).live, false);
assert.strictEqual(L.listenersOf({}), null);
assert.strictEqual(L.audioFromStatus({
  live: true,
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at + 2 * 60 * 1000).live, true);
assert.strictEqual(L.audioFromStatus({
  live: true,
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at + 2 * 60 * 1000).reconnecting, false);
const stale = L.audioFromStatus({
  live: true,
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  listeners: 4,
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at + 2 * 60 * 1000 + 1);
assert.strictEqual(stale.live, true);
assert.strictEqual(stale.reconnecting, true);
assert.strictEqual(stale.url, "https://abc.trycloudflare.com/radio/a.m3u8");
assert.strictEqual(stale.listeners, 4);
const held = L.audioFromStatus({
  live: true,
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at + 8 * 60 * 1000);
assert.strictEqual(held.live, true);
assert.strictEqual(held.reconnecting, true);
const offline = L.audioFromStatus({
  live: true,
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at + 8 * 60 * 1000 + 1);
assert.strictEqual(offline.live, false);
assert.strictEqual(offline.url, "");
assert.strictEqual(offline.reconnecting, false);
assert.strictEqual(L.audioFromStatus({
  live: false,
  base: "https://abc.trycloudflare.com/radio/",
  hls: { audio: "a.m3u8" },
  updated: "2026-10-21T20:00:00.000Z"
}, allow, at).live, false);
assert.strictEqual(L.statusStale({ updated: "nope" }, at), true);
assert.strictEqual(L.statusStale({ live: true }, at), false);
assert.strictEqual(L.statusOffline({ live: false, updated: "2026-10-21T20:00:00.000Z" }, at), true);
assert.strictEqual(L.statusOffline({ live: true, updated: "2026-10-21T20:00:00.000Z" }, at + 3 * 60 * 1000), false);
assert.strictEqual(L.statusOffline({ live: true, updated: "2026-10-21T20:00:00.000Z" }, at + 8 * 60 * 1000 + 1), true);
assert.strictEqual(L.playlistJumped(null, 10, 6), false);
assert.strictEqual(L.playlistJumped(10, 11, 6), false);
assert.strictEqual(L.playlistJumped(10, 17, 6), false);
assert.strictEqual(L.playlistJumped(10, 18, 6), true);
assert.strictEqual(L.playlistJumped(20, 10, 6), true);
assert.strictEqual(L.recoverPlan("media", { hasHls: true, mediaFixes: 0, softLoads: 0 }), "media");
assert.strictEqual(L.recoverPlan("media", { hasHls: true, mediaFixes: 1, softLoads: 0 }), "reload");
assert.strictEqual(L.recoverPlan("network", { hasHls: true, mediaFixes: 0, softLoads: 0 }), "reload");
assert.strictEqual(L.recoverPlan("stall", { hasHls: true, mediaFixes: 0, softLoads: 0 }), "recreate");
assert.strictEqual(L.recoverPlan("watch", { hasHls: true, mediaFixes: 0, softLoads: 0 }), "recreate");
assert.strictEqual(L.recoverPlan("network", { hasHls: true, mediaFixes: 0, softLoads: 1 }), "recreate");
assert.strictEqual(L.recoverPlan("jump", { hasHls: true, mediaFixes: 0, softLoads: 0 }), "recreate");
assert.strictEqual(L.recoverPlan("ended", { hasHls: true, mediaFixes: 0, softLoads: 0 }), "recreate");
assert.strictEqual(L.recoverPlan("network", { hasHls: false, mediaFixes: 0, softLoads: 0 }), "recreate");

const pubHost = "pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev";
const radioAllow = [pubHost, "r2.dev", "trycloudflare.com"];
const statusUrl = "https://" + pubHost + "/status.json";
const playlist = "https://" + pubHost + "/hls/stream.m3u8";
assert.strictEqual(L.remoteStatusUrl(statusUrl, radioAllow, 42), statusUrl + "?_=42");
assert.strictEqual(L.remoteStatusUrl(statusUrl, [pubHost], 42), statusUrl + "?_=42");
assert.ok(L.remoteStatusUrl(statusUrl + "?x=1", radioAllow, 9).includes("_=9"));
assert.strictEqual(L.remoteStatusUrl(statusUrl, ["trycloudflare.com"], 1), "");
assert.strictEqual(L.remoteStatusUrl("http://" + pubHost + "/status.json", radioAllow, 1), "");
assert.strictEqual(L.remoteStatusUrl("//" + pubHost + "/status.json", radioAllow, 1), "");
assert.strictEqual(L.remoteStatusUrl("https://user:pass@" + pubHost + "/status.json", radioAllow, 1), "");
assert.strictEqual(L.remoteStatusUrl("live/superintelmusic.json", radioAllow, 1), "");
assert.strictEqual(L.allowedAudio(playlist, "", [pubHost]), playlist);
assert.strictEqual(L.allowedAudio("https://pub-other.r2.dev/hls/stream.m3u8", "", [pubHost]), "");
assert.strictEqual(L.allowedAudio("https://not" + pubHost + "/hls/a.m3u8", "", [pubHost]), "");
assert.strictEqual(L.allowedAudio(playlist, "", radioAllow), playlist);
assert.strictEqual(L.allowedAudio("https://" + pubHost + "/hls/seg_1.ts", playlist, radioAllow).endsWith("/seg_1.ts"), true);
assert.strictEqual(L.allowedAudio("seg_1.ts", "https://" + pubHost + "/hls/", [pubHost]), "https://" + pubHost + "/hls/seg_1.ts");
assert.strictEqual(L.allowedAudio("https://" + pubHost + "/hls/key.key", playlist, radioAllow).endsWith("/key.key"), true);
assert.strictEqual(L.allowedAudio("https://evil.example/seg.ts", playlist, radioAllow), "");
assert.ok(L.allowedAudio("https://pub-abc.r2.dev/live/seg.m4s", "", radioAllow).includes(".r2.dev/"));

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
assert.ok(src.includes("xhrSetup: (xhr, requestUrl)"));
assert.ok(src.includes("allowedAudio(requestUrl, url, allow)"));
assert.ok(src.includes("source.fallback"));
assert.ok(src.includes("STATUS_MAX_AGE = 2 * 60 * 1000"));
assert.ok(src.includes("STATUS_OFFLINE_AGE = 8 * 60 * 1000"));
assert.ok(src.includes("liveSyncDurationCount: 3"));
assert.ok(src.includes("maxBufferLength: 60"));
assert.ok(src.includes("recoverMediaError"));
assert.ok(src.includes("startLoad"));
assert.ok(src.includes("Reconnecting…"));
assert.ok(src.includes("mediaSession.playbackState"));

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
assert.strictEqual(space.title, "ViktorychMusic");
assert.strictEqual(space.host.followId, "telegram:redacted_handle");
assert.strictEqual(space.source.type, "loop");
assert.strictEqual(space.source.loopUrl, "https://pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/loop/current.json");
assert.ok(!space.source.statusUrl);
assert.ok(!space.source.fallback);
assert.deepStrictEqual(space.source.allow, ["pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev", "r2.dev"]);
assert.ok(!space.source.url);

const bed = {
  live: true,
  mode: "loop",
  url: "https://" + pubHost + "/loop/v202610220722/index.m3u8",
  duration: 2344.663692,
  epoch: 1792627200,
  version: "v202610220722",
  updated: "2020-01-01T00:00:00Z"
};
const bedNow = Date.parse("2026-10-22T12:00:00.000Z");
assert.strictEqual(L.statusStale(bed, bedNow), true);
const loop = L.loopFromDoc(bed, [pubHost]);
assert.strictEqual(loop.live, true);
assert.strictEqual(loop.reconnecting, false);
assert.strictEqual(loop.url, bed.url);
assert.strictEqual(loop.version, bed.version);
assert.strictEqual(loop.duration, bed.duration);
assert.strictEqual(L.loopFromDoc({ ...bed, live: false }, [pubHost]).live, false);
assert.strictEqual(L.loopFromDoc({ ...bed, live: false }, [pubHost]).url, "");
assert.strictEqual(L.loopFromDoc({ ...bed, url: "https://evil.example/loop/index.m3u8" }, [pubHost]).live, false);
assert.strictEqual(L.loopFromDoc({ ...bed, duration: 0 }, [pubHost]).live, false);
assert.strictEqual(L.loopFromDoc({ ...bed, epoch: "nope" }, [pubHost]).live, false);
const clock = { duration: 100, epoch: 1000 };
assert.strictEqual(L.loopPosition(clock, 1000 * 1000), 0);
assert.strictEqual(L.loopPosition(clock, (1000 + 40) * 1000), 40);
assert.strictEqual(L.loopPosition(clock, (1000 + 250) * 1000), 50);
assert.ok(Math.abs(L.loopPosition(clock, (1000 - 10) * 1000) - 90) < 1e-9);
assert.strictEqual(L.loopSeek(clock, (1000 + 99.7) * 1000), 0);
assert.ok(Math.abs(L.loopSeek(clock, (1000 + 99.2) * 1000) - 99.2) < 1e-9);
const circle = L.loopDrift(1, { duration: 2344.663692, epoch: 0 }, (2344.663692 - 1) * 1000);
assert.ok(Math.abs(circle - 2) < 0.001, circle);
assert.ok(src.includes("LOOP_DRIFT_S = 5"));
assert.ok(src.includes("LOOP_RECHECK_MS = 3 * 60 * 1000"));
assert.ok(src.includes("startPosition:"));
assert.ok(src.includes("function loopFromDoc("));
assert.ok(src.includes("doc.mode !== \"loop\""));
assert.ok(!src.includes("pub-bf9b5e3ebb2b421aa49e7af484f3c22d.r2.dev/status.json"));
assert.strictEqual(src.includes('"/hls/stream.m3u8"'), src.includes('server + "/hls/stream.m3u8"'));

const worker = fs.readFileSync("sw.js", "utf8");
assert.ok(worker.includes('VERSION = "viktorych-a2-__SW_VERSION__"'));
assert.ok(worker.includes("./spaces.js") && worker.includes("./spaces.css"));
assert.ok(!worker.includes("superintelmusic.json"));
assert.ok(worker.includes("isSpaceStatus"));
assert.ok(worker.includes("function isSpaceAsset(url)"));
assert.ok(worker.includes("isSpaceStatus(url) || isSpaceAsset(url)"));
space.source.allow.forEach((host) => {
  assert.ok(worker.includes('"' + host + '"'), host);
});
const branchAt = worker.indexOf("if (isSpaceStatus(url) || isSpaceAsset(url))");
const branch = worker.slice(branchAt, branchAt + 180);
assert.ok(branch.includes('cache: "no-store"'));
assert.ok(!branch.includes("cache.put") && !branch.includes("caches.open"));
assert.ok(!new RegExp("supa" + "base|sb_" + "publishable|nadjniz" + "sdaskttxahclp", "i").test(src + worker + JSON.stringify(config)));

console.log("spaces row tests ok");
