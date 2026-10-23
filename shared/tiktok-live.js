/* Public TikTok live room parsing. No cookies and no bypass.
   The sync job and the account Worker both use this picker. */

const ROOM_ID = /^[1-9][0-9]{5,24}$/;
const QUALITY = ["origin", "origion", "uhd", "full_hd1", "hd", "hd1", "sd", "sd2", "ld", "sd1"];

function scriptJson(html, id) {
  const text = String(html || "");
  const match = text.match(new RegExp("<script id=\"" + id + "\"[^>]*>([\\s\\S]*?)<\\/script>"));
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch (err) { return null; }
}

function roomFromUser(user) {
  if (!user || typeof user !== "object") return "";
  const room = user.roomId != null ? String(user.roomId) : "";
  return ROOM_ID.test(room) ? room : "";
}

function parseRoomId(html) {
  const universal = scriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const scope = universal && universal.__DEFAULT_SCOPE__;
  const detail = scope && scope["webapp.user-detail"];
  const fromUniversal = roomFromUser(detail && detail.userInfo && detail.userInfo.user);
  if (fromUniversal) return fromUniversal;
  const sigi = scriptJson(html, "SIGI_STATE");
  const live = sigi && sigi.LiveRoom && sigi.LiveRoom.liveRoomUserInfo;
  return roomFromUser(live && live.user);
}

function qualityRank(name) {
  const index = QUALITY.indexOf(String(name || "").toLowerCase());
  return index < 0 ? QUALITY.length : index;
}

function pickStreams(info) {
  const room = info && info.data && typeof info.data === "object" ? info.data : (info || {});
  const live = Number(room.status) === 2;
  const viewers = Number(room.user_count || (room.liveRoomStats && room.liveRoomStats.userCount) || 0) || 0;
  const title = String(room.title || "");
  const pull = room.stream_url && room.stream_url.live_core_sdk_data && room.stream_url.live_core_sdk_data.pull_data;
  let parsed = {};
  const raw = pull && pull.stream_data;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); }
    catch (err) { parsed = {}; }
  } else if (raw && typeof raw === "object") parsed = raw;
  const rows = parsed.data && typeof parsed.data === "object" ? parsed.data : {};
  const keys = Object.keys(rows).sort((a, b) => qualityRank(a) - qualityRank(b));
  let hls = "";
  let flv = "";
  let quality = "";
  for (let i = 0; i < keys.length; i++) {
    const main = rows[keys[i]] && rows[keys[i]].main;
    if (!main) continue;
    const nextHls = main.hls ? String(main.hls) : "";
    const nextFlv = main.flv ? String(main.flv) : "";
    if (!nextHls && !nextFlv) continue;
    hls = nextHls;
    flv = nextFlv;
    quality = keys[i];
    break;
  }
  if (!hls && !flv && room.stream_url && room.stream_url.hls_pull_url) {
    hls = String(room.stream_url.hls_pull_url);
    quality = quality || "origin";
  }
  if (!hls && !flv && room.stream_url && room.stream_url.flv_pull_url && typeof room.stream_url.flv_pull_url === "object") {
    const names = Object.keys(room.stream_url.flv_pull_url).sort((a, b) => qualityRank(a) - qualityRank(b));
    if (names.length) {
      flv = String(room.stream_url.flv_pull_url[names[0]] || "");
      quality = quality || names[0] || "origin";
    }
  }
  return {
    live: live,
    viewers: live ? viewers : 0,
    title: title,
    hls: live ? hls : "",
    flv: live ? flv : "",
    quality: live ? quality : ""
  };
}

export { parseRoomId, pickStreams, QUALITY };
