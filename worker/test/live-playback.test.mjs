import assert from "node:assert/strict";
import test from "node:test";
import { pickStreams } from "../../shared/tiktok-live.js";
import {
  hlsFatalPlan,
  mediaMime,
  playbackSteps,
  shouldSniffMedia,
  stitchPlaylists,
  streamFresh
} from "../../shared/live-playback.js";

test("fresh stream urls skip ones that expire within 20 seconds", () => {
  const now = 1_700_000_000_000;
  assert.equal(streamFresh("https://cdn.example/a.m3u8", now), true);
  assert.equal(streamFresh("https://cdn.example/a.m3u8?expire=" + Math.floor(now / 1000 + 30), now), true);
  assert.equal(streamFresh("https://cdn.example/a.m3u8?expire=" + Math.floor(now / 1000 + 5), now), false);
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
