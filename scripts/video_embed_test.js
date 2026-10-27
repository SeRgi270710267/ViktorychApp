#!/usr/bin/env node
"use strict";

const assert = require("assert");
const api = require("../video-embed.js");

const SAMPLE = "M7lc1UVf-VE";
const ORIGIN = "https://example.test";

const preview = api.youtubeEmbed(SAMPLE, { preview: true, origin: ORIGIN });
assert.ok(preview.indexOf("https://www.youtube-nocookie.com/embed/" + SAMPLE) === 0);
assert.ok(preview.indexOf("autoplay=1&mute=1&playsinline=1&controls=0") >= 0);
assert.ok(preview.indexOf("enablejsapi=1") >= 0);
assert.ok(preview.indexOf("origin=" + encodeURIComponent(ORIGIN)) >= 0);
assert.ok(preview.indexOf("widget_referrer=") >= 0);

const watch = api.youtubeEmbed(SAMPLE, { origin: ORIGIN });
assert.ok(watch.indexOf("playsinline=1") >= 0);
assert.ok(watch.indexOf("controls=1") >= 0);
assert.ok(watch.indexOf("fs=1") >= 0);
assert.ok(watch.indexOf("controls=0") < 0);
assert.ok(watch.indexOf("disablekb=1") < 0);
assert.ok(watch.indexOf("youtube-nocookie.com") >= 0);

const audio = api.youtubeEmbed(SAMPLE, { controls: 0, origin: ORIGIN });
assert.ok(audio.indexOf("controls=0") >= 0);
assert.ok(audio.indexOf("mute=1") < 0);

assert.strictEqual(api.playbackSource(null), "embed");
assert.strictEqual(api.playbackSource({}), "embed");
assert.strictEqual(api.playbackSource({ playbackSource: "device" }), "device");
assert.strictEqual(api.playbackSource({ playbackSource: "direct" }), "device");
assert.strictEqual(api.playbackSource({ playbackSource: "server" }), "server");
assert.strictEqual(api.playbackSource({ playbackSource: "embed", devicePerformance: { playback: "device" } }), "device");
assert.strictEqual(api.playbackSource({ playbackSource: "server", devicePerformance: { playback: "device" } }), "server");
assert.strictEqual(api.playbackSource({ performance: { playbackSource: "server" } }), "server");
assert.strictEqual(api.playbackSource({ playbackSource: "embed" }, "device"), "device");
assert.strictEqual(api.playbackSource({}, "direct"), "device");

function linkFor(result) {
  return api.nextAfterDirect(result, SAMPLE, { origin: ORIGIN });
}
[100, 101, 150, { code: 101 }, { reason: "blocked" }, { reason: "missing" }].forEach((row) => {
  const next = linkFor(row);
  assert.strictEqual(next.kind, "link");
  assert.strictEqual(next.url, "https://www.youtube.com/watch?v=" + SAMPLE);
});
const again = api.nextAfterDirect({ code: 5 }, SAMPLE, { preview: true, origin: ORIGIN });
assert.strictEqual(again.kind, "iframe");
assert.ok(again.url.indexOf("youtube-nocookie.com/embed/" + SAMPLE) >= 0);
assert.ok(again.url.indexOf("/v1/yt/") < 0);

const rows = [
  { url: "https://files.example/video-only.mp4", videoOnly: true, height: 1080, mime: "video/mp4" },
  { url: "https://files.example/audio-only.webm", audioOnly: true, mime: "audio/webm" },
  { url: "https://worker.example/v1/yt/media?id=" + SAMPLE, height: 720, mime: "video/mp4" },
  { url: "https://files.example/live.m3u8", mime: "application/vnd.apple.mpegurl" },
  { url: "https://files.example/360.mp4", itag: "18", height: 360, mime: "video/mp4" },
  { url: "https://files.example/720.mp4", itag: "22", height: 720, mime: "video/mp4" }
];
const wide = api.pickCombined(rows, {});
assert.strictEqual(wide[0].url, "https://files.example/720.mp4");
assert.ok(wide.every((row) => row.url.indexOf("/v1/yt/") < 0 && !row.videoOnly));
const narrow = api.pickCombined(rows, { narrow: true, saveData: true });
assert.strictEqual(narrow[0].url, "https://files.example/360.mp4");
const skipped = api.pickCombined(rows, { canPlay: (mime) => (mime.indexOf("mp4") >= 0 ? "probably" : "") });
assert.ok(skipped.every((row) => String(row.mime || row.mimeType || "").indexOf("webm") < 0));

const twitch = api.match("https://www.twitch.tv/videos/123456789", { origin: "http://127.0.0.1:9", preview: true });
assert.strictEqual(twitch.site, "twitch");
assert.ok(twitch.url.indexOf("https://player.twitch.tv/?video=123456789") === 0);
assert.ok(twitch.url.indexOf("parent=localhost") >= 0);
assert.ok(twitch.url.indexOf("muted=true") >= 0);
const channel = api.match("https://www.twitch.tv/samplechannel", { origin: "https://viktorychapp.example" });
assert.ok(channel.url.indexOf("channel=samplechannel") >= 0);
assert.ok(channel.url.indexOf("parent=viktorychapp.example") >= 0);

const vimeo = api.match("https://vimeo.com/123456789", { preview: true });
assert.strictEqual(vimeo.site, "vimeo");
assert.ok(vimeo.url.indexOf("https://player.vimeo.com/video/123456789?playsinline=1") === 0);

const odysee = api.match("https://odysee.com/@sample/sample-clip");
assert.strictEqual(odysee.site, "odysee");
assert.strictEqual(odysee.url, "https://odysee.com/$/embed/@sample/sample-clip");
const odyseeEmbed = api.match("https://odysee.com/$/embed/@sample/sample-clip");
assert.strictEqual(odyseeEmbed.url, "https://odysee.com/$/embed/@sample/sample-clip");

const peer = api.match("https://peer.example/videos/watch/11111111-1111-1111-1111-111111111111");
assert.strictEqual(peer.site, "peertube");
assert.strictEqual(peer.url, "https://peer.example/videos/embed/11111111-1111-1111-1111-111111111111?autoplay=1&playsinline=1");
const peerShort = api.match("https://peer.example/w/11111111-1111-1111-1111-111111111111");
assert.ok(peerShort.url.indexOf("/videos/embed/11111111-1111-1111-1111-111111111111") >= 0);

const tweet = api.match("https://platform.twitter.com/embed/Tweet.html?id=1000000000000001");
assert.strictEqual(tweet.site, "x");
assert.strictEqual(tweet.url, "https://platform.twitter.com/embed/Tweet.html?id=1000000000000001");
assert.strictEqual(api.match("https://video.twimg.com/clip.mp4 https://platform.twitter.com/embed/Tweet.html?id=1000000000000001"), null);

assert.strictEqual(api.referrerFor("https://video.twimg.com/clip.mp4"), "no-referrer");
assert.strictEqual(api.referrerFor("https://cdninstagram.com/clip.mp4"), "no-referrer");
assert.strictEqual(api.referrerFor("https://files.example/googlevideo/clip.mp4"), "strict-origin-when-cross-origin");
assert.strictEqual(api.needsReferrer(preview), true);
assert.strictEqual(api.needsReferrer("https://www.instagram.com/p/sample/embed/"), false);

const frame = {
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; }
};
api.prepareFrame(frame, { url: preview, title: "Video" });
assert.strictEqual(frame.referrerPolicy, "strict-origin-when-cross-origin");
assert.strictEqual(frame.attrs.referrerpolicy, "strict-origin-when-cross-origin");
assert.ok(frame.allow.indexOf("picture-in-picture") >= 0);
assert.strictEqual(frame.src, undefined);
assert.ok(!/sandbox/.test(JSON.stringify(frame.attrs)));

assert.ok(!/sponsorblock/i.test(require("fs").readFileSync(require("path").join(__dirname, "../video-embed.js"), "utf8").split("\n").filter((line) => line.indexOf("does not call SponsorBlock") < 0).join("\n")));

console.log("video embed checks passed");
