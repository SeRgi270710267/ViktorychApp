/* Owner live playback helpers. No network, no cookies, no account data. */

const TG_DIRECT_MAX = 19 * 1024 * 1024;

function streamExpiresAt(url) {
  let parsed = null;
  try { parsed = new URL(String(url || "")); }
  catch (err) { return 0; }
  const raw = parsed.searchParams.get("expire") || parsed.searchParams.get("expires") || "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1000000000000 ? n : n * 1000;
}

function streamFresh(url, now) {
  const text = String(url || "");
  if (!text) return false;
  const exp = streamExpiresAt(text);
  if (!exp) return true;
  const at = Number(now) || Date.now();
  return exp > at + 20000;
}

function flvAsHls(url) {
  const text = String(url || "");
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!/\.flv$/i.test(parsed.pathname)) return "";
    parsed.pathname = parsed.pathname.replace(/\.flv$/i, ".m3u8");
    return parsed.toString();
  } catch (err) {
    return "";
  }
}

function videoQuality(name) {
  const key = String(name || "").toLowerCase();
  return key !== "ao" && key !== "audio" && key !== "audio_only";
}

function levelCodec(level) {
  if (!level) return "";
  if (level.videoCodec) return String(level.videoCodec);
  const attrs = level.attrs && level.attrs.CODECS ? String(level.attrs.CODECS) : "";
  if (attrs) return attrs.split(",")[0].trim();
  return "";
}

function videoCodecOk(codecs, isTypeSupported) {
  const video = String(codecs || "").split(",")[0].trim();
  if (!video) return true;
  if (/^(mp4a|aac|opus|mp3)/i.test(video)) return false;
  const ask = typeof isTypeSupported === "function" ? isTypeSupported : null;
  if (ask) {
    try {
      if (!ask('video/mp4; codecs="' + video + '"')) return false;
    } catch (err) { /* an unknown checker still rejects HEVC names */ }
  }
  if (!ask && /hvc1|hev1|hevc|bytevc1|h265/i.test(video)) return false;
  return true;
}

function bestPlayableLevel(levels, isTypeSupported) {
  const rows = Array.isArray(levels) ? levels : [];
  let top = -1;
  let best = -1;
  let fallback = 0;
  let fallbackScore = -1;
  for (let i = 0; i < rows.length; i++) {
    const score = (Number(rows[i] && rows[i].bitrate) || 0) * 100000 + (Number(rows[i] && rows[i].height) || 0);
    if (score >= fallbackScore) {
      fallbackScore = score;
      fallback = i;
    }
    if (!videoCodecOk(levelCodec(rows[i]), isTypeSupported)) continue;
    if (score >= best) {
      best = score;
      top = i;
    }
  }
  if (!rows.length) return -1;
  return top >= 0 ? top : fallback;
}

function variantRows(info) {
  const rows = info && Array.isArray(info.variants) ? info.variants : [];
  if (rows.length) return rows;
  if (info && (info.hls || info.flv)) return [{ quality: info.quality || "", hls: info.hls || "", flv: info.flv || "" }];
  return [];
}

function playbackSteps(info, now) {
  const rows = variantRows(info);
  const steps = [];
  const seen = {};
  function push(kind, url, quality) {
    const value = String(url || "");
    if (!value) return;
    const key = kind + "\n" + value;
    if (seen[key]) return;
    seen[key] = true;
    steps.push({ kind: kind, url: value, quality: String(quality || "") });
  }
  function collect(requireFresh) {
    rows.forEach((row) => {
      if (!row || !videoQuality(row.quality)) return;
      const hls = String(row.hls || "");
      const flv = String(row.flv || "");
      if (hls && (!requireFresh || streamFresh(hls, now))) push("hls", hls, row.quality);
      if (flv && (!requireFresh || streamFresh(flv, now))) push("flv", flv, row.quality);
      if (flv && !hls) {
        const alt = flvAsHls(flv);
        if (alt && (!requireFresh || streamFresh(alt, now))) push("hls", alt, row.quality);
      }
    });
  }
  collect(true);
  if (!steps.length) collect(false);
  return steps;
}

function hlsFatalPlan(type, attempt, live) {
  const kind = String(type || "");
  const n = Number(attempt) || 0;
  if (n >= 2) return "next";
  if (kind === "mediaError") return n === 0 ? "recover-media" : (live ? "live-edge" : "next");
  if (kind === "networkError") return n === 0 ? (live ? "live-edge" : "retry") : "next";
  return "next";
}

function mediaMime(pathname, contentType, head) {
  const path = String(pathname || "").split("?")[0].toLowerCase();
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const prefix = String(head || "");
  if (prefix.indexOf("#EXTM3U") === 0 || path.endsWith(".m3u8") || type.indexOf("mpegurl") >= 0 || type.indexOf("m3u8") >= 0) {
    return "application/vnd.apple.mpegurl";
  }
  if (path.endsWith(".flv") || prefix.indexOf("FLV") === 0 || type.indexOf("flv") >= 0) return "video/x-flv";
  if (path.endsWith(".ts") || type.indexOf("mp2t") >= 0) return "video/mp2t";
  if (/\.(mp4|m4s|m4v|cmfv|cmfa)$/.test(path) || type.indexOf("mp4") >= 0 || type === "video/iso.segment") return "video/mp4";
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream" && type !== "text/plain") return type;
  return "";
}

function shouldSniffMedia(pathname, contentType, length) {
  const size = Number(length) || 0;
  if (size > 2000000) return false;
  const path = String(pathname || "").split("?")[0].toLowerCase();
  const type = String(contentType || "").toLowerCase();
  if (/\.(flv|ts|m4s|mp4|m4v|cmfv|cmfa)$/.test(path)) return false;
  if (path.endsWith(".m3u8") || /mpegurl|m3u8/.test(type)) return true;
  if (!type || type.indexOf("text/plain") >= 0 || type.indexOf("octet-stream") >= 0) return true;
  return false;
}

function stitchPlaylists(parts) {
  const lists = (Array.isArray(parts) ? parts : []).map((item) => String(item || "")).filter((text) => text.indexOf("#EXTM3U") >= 0);
  if (!lists.length) return "";
  if (lists.length === 1) return lists[0].endsWith("\n") ? lists[0] : lists[0] + "\n";
  let target = 1;
  const blocks = [];
  lists.forEach((text) => {
    const lines = text.split(/\r?\n/);
    let map = "";
    const segs = [];
    let pending = "";
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.indexOf("#EXT-X-TARGETDURATION:") === 0) {
        const n = Number(trimmed.split(":")[1]);
        if (Number.isFinite(n) && n > target) target = Math.ceil(n);
        return;
      }
      if (trimmed.indexOf("#EXT-X-MAP:") === 0) { map = trimmed; return; }
      if (trimmed.indexOf("#EXTINF:") === 0) { pending = trimmed; return; }
      if (trimmed.charAt(0) === "#") return;
      segs.push((pending || "#EXTINF:5.000,") + "\n" + trimmed);
      pending = "";
    });
    if (!segs.length) return;
    const chunk = [];
    if (blocks.length) chunk.push("#EXT-X-DISCONTINUITY");
    if (map) chunk.push(map);
    segs.forEach((row) => chunk.push(row));
    blocks.push(chunk.join("\n"));
  });
  if (!blocks.length) return "";
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:" + target,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    "#EXT-X-MEDIA-SEQUENCE:0",
    blocks.join("\n"),
    "#EXT-X-ENDLIST",
    ""
  ].join("\n");
}

export {
  TG_DIRECT_MAX,
  streamExpiresAt,
  streamFresh,
  flvAsHls,
  videoQuality,
  levelCodec,
  videoCodecOk,
  bestPlayableLevel,
  playbackSteps,
  hlsFatalPlan,
  mediaMime,
  shouldSniffMedia,
  stitchPlaylists
};
