import assert from "node:assert/strict";
import test from "node:test";
import { pickStreams } from "../../shared/tiktok-live.js";
import {
  bestPlayableLevel,
  hlsFatalPlan,
  mediaMime,
  playbackSteps,
  shouldSniffMedia,
  stitchPlaylists,
  streamFresh,
  videoCodecOk
} from "../../shared/live-playback.js";
import { b2Configured, formatBytes, lowestPreview, previewsAllowed, thumbObjectKey } from "../../shared/live-preview.js";

test("previews use the lowest variant and stay off on Save-Data unless asked", () => {
  const step = lowestPreview({
    variants: [
      { quality: "origin", hls: "https://cdn.example/o.m3u8" },
      { quality: "ld", hls: "https://cdn.example/l.m3u8", flv: "https://cdn.example/l.flv" }
    ]
  });
  assert.equal(step.url, "https://cdn.example/l.m3u8");
  assert.equal(previewsAllowed("auto", true, "all", "wifi"), false);
  assert.equal(previewsAllowed("on", true, "never", "cellular"), true);
  assert.equal(previewsAllowed("auto", false, "wifi", "cellular"), false);
  assert.equal(formatBytes(2 * 1024 * 1024), "2 MB");
  assert.equal(thumbObjectKey("Pepsi", "7699647509498710805"), "owner/live-thumbs/pepsi/7699647509498710805.mp4");
  assert.equal(thumbObjectKey("../x", "1"), "");
  assert.equal(b2Configured({}), false);
  assert.equal(b2Configured({ B2_KEY_ID: "id", B2_APP_KEY: "key", B2_BUCKET: "bucket" }), true);
});

test("fresh stream urls skip ones that expire within 20 seconds", () => {
  const now = 1_700_000_000_000;
  assert.equal(streamFresh("https://cdn.example/a.m3u8", now), true);
  assert.equal(streamFresh("https://cdn.example/a.m3u8?expire=" + Math.floor(now / 1000 + 30), now), true);
  assert.equal(streamFresh("https://cdn.example/a.m3u8?expire=" + Math.floor(now / 1000 + 5), now), false);
});

test("audio-only and unsupported video codecs are not the first picture", () => {
  const steps = playbackSteps({
    variants: [
      { quality: "ao", hls: "https://cdn.example/a.m3u8", flv: "https://cdn.example/a.flv" },
      { quality: "hd", hls: "https://cdn.example/h.m3u8", flv: "https://cdn.example/h.flv" }
    ]
  }, Date.now());
  assert.deepEqual(steps.map((row) => row.quality), ["hd", "hd"]);
  assert.equal(lowestPreview({
    variants: [
      { quality: "hd", hls: "https://cdn.example/h.m3u8" },
      { quality: "ao", flv: "https://cdn.example/a.flv" }
    ]
  }).url, "https://cdn.example/h.m3u8");
  const support = (mime) => mime.indexOf("avc1") >= 0;
  assert.equal(videoCodecOk("hvc1.1.6.L120.90", support), false);
  assert.equal(videoCodecOk("avc1.42E01E", support), true);
  assert.equal(videoCodecOk("mp4a.40.2", support), false);
  assert.equal(bestPlayableLevel([
    { bitrate: 5000000, height: 720, videoCodec: "hvc1.1.6.L120.90" },
    { bitrate: 800000, height: 360, videoCodec: "avc1.42E01E" }
  ], support), 1);
  assert.equal(bestPlayableLevel([
    { bitrate: 800000, height: 360, attrs: { CODECS: "avc1.4d401f,mp4a.40.2" } },
    { bitrate: 200000, height: 144, videoCodec: "avc1.42E01E" }
  ], support), 0);
});

test("playback tries the best fresh source before a lower one", () => {
  const now = Date.now();
  const steps = playbackSteps({
    variants: [
      { quality: "origin", hls: "https://cdn.example/o.m3u8?expire=1", flv: "https://cdn.example/o.flv?expire=1" },
      { quality: "hd", hls: "https://cdn.example/h.m3u8", flv: "https://cdn.example/h.flv" }
    ]
  }, now);
  assert.equal(steps[0].url, "https://cdn.example/h.m3u8");
  assert.equal(steps[1].kind, "flv");
  const stale = playbackSteps({
    hls: "https://cdn.example/only.m3u8?expire=1",
    flv: "https://cdn.example/only.flv?expire=1",
    quality: "origin"
  }, now);
  assert.equal(stale[0].url, "https://cdn.example/only.m3u8?expire=1");
  const flv = playbackSteps({ flv: "https://cdn.example/live.flv", quality: "hd" }, now);
  assert.deepEqual(flv.map((row) => row.kind), ["flv", "hls"]);
  assert.match(flv[1].url, /\.m3u8$/);
});

test("fatal hls errors recover once before the next source", () => {
  assert.equal(hlsFatalPlan("mediaError", 0, true), "recover-media");
  assert.equal(hlsFatalPlan("mediaError", 1, true), "live-edge");
  assert.equal(hlsFatalPlan("networkError", 0, true), "live-edge");
  assert.equal(hlsFatalPlan("networkError", 0, false), "retry");
  assert.equal(hlsFatalPlan("networkError", 1, true), "next");
  assert.equal(hlsFatalPlan("otherError", 0, true), "next");
});

test("playlists are stitched without re-encoding and odd types are sniffed", () => {
  const stitched = stitchPlaylists([
    '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="init-a"\n#EXTINF:2.000,\nseg-a\n#EXT-X-ENDLIST\n',
    '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI="init-b"\n#EXTINF:4.000,\nseg-b\n#EXT-X-ENDLIST\n'
  ]);
  assert.match(stitched, /#EXT-X-DISCONTINUITY/);
  assert.match(stitched, /init-a/);
  assert.match(stitched, /seg-b/);
  assert.match(stitched, /#EXT-X-INDEPENDENT-SEGMENTS/);
  assert.equal(mediaMime("/plain.m3u8", "text/plain", "#EXTM3U"), "application/vnd.apple.mpegurl");
  assert.equal(mediaMime("/seg.m4s", "application/octet-stream", ""), "video/mp4");
  assert.equal(shouldSniffMedia("/seg.ts", "application/octet-stream", 100), false);
  assert.equal(shouldSniffMedia("/plain.m3u8", "text/plain", 100), true);
  assert.equal(shouldSniffMedia("/big.m3u8", "text/plain", 3000000), false);
});

test("picked ladders keep every public variant, best first", () => {
  const picked = pickStreams({
    data: {
      status: 2,
      user_count: 4,
      stream_url: {
        live_core_sdk_data: {
          pull_data: {
            stream_data: JSON.stringify({
              data: {
                hd: { main: { hls: "https://cdn.example/hd.m3u8", flv: "https://cdn.example/hd.flv" } },
                origin: { main: { hls: "https://cdn.example/origin.m3u8", flv: "https://cdn.example/origin.flv" } }
              }
            })
          }
        }
      }
    }
  });
  assert.deepEqual(picked.variants.map((row) => row.quality), ["origin", "hd"]);
});
