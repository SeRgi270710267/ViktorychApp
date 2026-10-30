import test from "node:test";
import assert from "node:assert/strict";
import { fromSyndication, fromFx, fromVx, resolveXVideo, handleXVideo, syndicationToken } from "../src/xvideo.js";

const V = "https://video.twimg.com/ext_tw_video/1/pu/vid/";
const synd = { mediaDetails: [{ type: "video", media_url_https: "https://pbs.twimg.com/a.jpg", video_info: { duration_millis: 9000, variants: [
  { content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext_tw_video/1/pu/pl/a.m3u8?tag=14" },
  { bitrate: 256000, content_type: "video/mp4", url: V + "480x270/a.mp4" },
  { bitrate: 2176000, content_type: "video/mp4", url: V + "1280x720/b.mp4" },
  { bitrate: 1, content_type: "video/mp4", url: "https://evil.example/x.mp4" }
] } }, { type: "photo", media_url_https: "https://pbs.twimg.com/b.jpg" }] };

test("syndication keeps only video.twimg.com variants and the poster", () => {
  const out = fromSyndication(synd);
  assert.equal(out.length, 1);
  assert.equal(out[0].poster, "https://pbs.twimg.com/a.jpg");
  assert.deepEqual(out[0].variants.map((v) => v.kind), ["hls", "mp4", "mp4"]);
  assert.equal(out[0].variants[2].bitrate, 2176000);
});

test("fx and vx shapes", () => {
  assert.equal(fromFx({ status: { media: { videos: [{ type: "gif", url: V + "a.mp4", thumbnail_url: "https://pbs.twimg.com/t.jpg" }] } } })[0].type, "animated_gif");
  assert.equal(fromVx({ media_extended: [{ type: "video", url: V + "c.mp4" }] })[0].variants[0].url, V + "c.mp4");
  assert.ok(syndicationToken("1585341984679469056").length > 3);
});

test("falls through to the next source and caches nothing on a miss path error", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes("syndication")) return new Response("nope", { status: 404 });
    if (url.includes("fxtwitter")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ media_extended: [{ type: "video", url: V + "d.mp4" }] }), { status: 200 });
  };
  const found = await resolveXVideo("1585341984679469056", fetcher);
  assert.equal(found.source, "vxtwitter");
  assert.equal(calls.length, 3);
  const bad = await handleXVideo(new Request("https://a.test/v1/xv?id=abc"), { fetch: fetcher });
  assert.equal(bad.status, 400);
  const ok = await handleXVideo(new Request("https://a.test/v1/xv?id=1585341984679469056"), { fetch: fetcher });
  assert.equal((await ok.json()).media[0].variants[0].url, V + "d.mp4");
});
