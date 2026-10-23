import assert from "node:assert/strict";
import { parseRoomId, pickStreams, roomStats, isTopQuality } from "../shared/tiktok-live.js";

const empty = parseRoomId("<html><script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\">{\"__DEFAULT_SCOPE__\":{}}</script></html>");
assert.equal(empty, "");
const zero = parseRoomId("<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\">{\"__DEFAULT_SCOPE__\":{\"webapp.user-detail\":{\"userInfo\":{\"user\":{\"roomId\":\"0\"}}}}}</script>");
assert.equal(zero, "");
const room = parseRoomId("<script id=\"__UNIVERSAL_DATA_FOR_REHYDRATION__\">{\"__DEFAULT_SCOPE__\":{\"webapp.user-detail\":{\"userInfo\":{\"user\":{\"roomId\":\"123456789\"}}}}}</script>");
assert.equal(room, "123456789");
const sigi = parseRoomId("<script id=\"SIGI_STATE\">{\"LiveRoom\":{\"liveRoomUserInfo\":{\"user\":{\"uniqueId\":\"noranaslundddd\",\"roomId\":\"7699629500912487190\"}}},\"CurrentRoom\":{\"roomId\":\"\"}}</script>");
assert.equal(sigi, "7699629500912487190");

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

const flvOnly = pickStreams({
  data: {
    status: 2,
    user_count: 3,
    title: "flv",
    stream_url: {
      hls_pull_url: "https://cdn.example/fallback.m3u8",
      live_core_sdk_data: {
        pull_data: {
          stream_data: JSON.stringify({
            data: {
              hd: { main: { hls: "https://cdn.example/hd.m3u8" } },
              origin: { main: { flv: "https://cdn.example/origin.flv" } }
            }
          })
        }
      }
    }
  }
});
assert.equal(flvOnly.quality, "origin");
assert.equal(flvOnly.flv, "https://cdn.example/origin.flv");
assert.equal(flvOnly.hls, "");

const offline = pickStreams({ data: { status: 4, user_count: 3, stream_url: { hls_pull_url: "https://cdn.example/gone.m3u8" } } });
assert.equal(offline.live, false);
assert.equal(offline.hls, "");
assert.equal(offline.flv, "");
assert.equal(offline.viewers, 0);

const counted = roomStats({
  data: {
    status: 2,
    user_count: 4,
    total_user: 900,
    like_count: 80,
    liveRoomStats: { userCount: 777 },
    title: "now"
  }
});
assert.equal(counted.viewers, 4);
assert.equal(counted.live, true);
assert.equal(counted.title, "now");
const ended = roomStats({ data: { status: 4, user_count: 4, like_count: 80, title: "old" } });
assert.equal(ended.live, false);
assert.equal(ended.viewers, 0);
assert.equal(ended.title, "");
const mixed = pickStreams({
  data: {
    status: 2,
    user_count: 4,
    like_count: 80,
    total_user: 900,
    title: "now",
    stream_url: {
      live_core_sdk_data: {
        pull_data: {
          stream_data: JSON.stringify({
            data: {
              sd: { main: { hls: "https://cdn.example/sd.m3u8" } },
              hd: { main: { hls: "https://cdn.example/hd.m3u8" } },
              origin: { main: { hls: "https://cdn.example/origin.m3u8" } }
            }
          })
        }
      }
    }
  }
});
assert.equal(mixed.viewers, 4);
assert.equal(mixed.quality, "origin");
assert.equal(mixed.hls, "https://cdn.example/origin.m3u8");
assert.equal(mixed.qualityNote, "");
assert.equal(isTopQuality("origin"), true);
assert.equal(isTopQuality("hd"), false);
const hdOnly = pickStreams({
  data: {
    status: 2,
    user_count: 2,
    stream_url: {
      live_core_sdk_data: {
        pull_data: {
          stream_data: JSON.stringify({
            data: { hd: { main: { hls: "https://cdn.example/hd-only.m3u8" } } }
          })
        }
      }
    }
  }
});
assert.equal(hdOnly.quality, "hd");
assert.equal(hdOnly.qualityNote, "best available");

console.log("tiktok live parser ok");
