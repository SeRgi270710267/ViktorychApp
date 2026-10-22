import assert from "node:assert/strict";
import { parseRoomId, pickStreams } from "../shared/tiktok-live.js";

const empty = parseRoomId("<html><script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\">{\"__DEFAULT_SCOPE__\":{}}</script></html>");
assert.equal(empty, "");
const zero = parseRoomId("<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\">{\"__DEFAULT_SCOPE__\":{\"webapp.user-detail\":{\"userInfo\":{\"user\":{\"roomId\":\"0\"}}}}}</script>");
assert.equal(zero, "");
const room = parseRoomId("<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\">{\"__DEFAULT_SCOPE__\":{\"webapp.user-detail\":{\"userInfo\":{\"user\":{\"roomId\":\"123456789\"}}}}}</script>");
assert.equal(room, "123456789");

const live = pickStreams({
  data: {
    status: 2,
    user_count: 40,
    title: "hello",
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
assert.equal(live.live, true);
assert.equal(live.viewers, 40);
assert.equal(live.hls, "https://cdn.example/origin.m3u8");
assert.equal(live.flv, "https://cdn.example/origin.flv");
assert.equal(live.quality, "origin");

const offline = pickStreams({ data: { status: 4, user_count: 3, stream_url: { hls_pull_url: "https://cdn.example/gone.m3u8" } } });
assert.equal(offline.live, false);
assert.equal(offline.hls, "");
assert.equal(offline.flv, "");
assert.equal(offline.viewers, 0);

console.log("tiktok live parser ok");
