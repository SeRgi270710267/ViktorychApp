// Pure helpers for the authenticated Telegram media route.
// The bot token never enters this file.

export function safeTelegramPath(value) {
  const path = String(value || "");
  if (!path || path.length > 512) return "";
  if (path.indexOf("..") >= 0 || path.charAt(0) === "/" || path.indexOf("\\") >= 0) return "";
  if (/^https?:/i.test(path)) return "";
  if (/[\u0000-\u001F\u007F]/.test(path)) return "";
  return path;
}

export function encodeTgKey(key) {
  return String(key || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function buildPlaylist(rows, key, origin) {
  const list = Array.isArray(rows) ? rows : [];
  const segments = list.filter((row) => row && row.kind === "segment").slice().sort((a, b) => Number(a.part_index) - Number(b.part_index));
  if (!segments.length) return "";
  const init = list.find((row) => row && row.kind === "init");
  const base = String(origin || "").replace(/\/$/, "") + "/tg/" + encodeTgKey(key);
  let target = 1;
  segments.forEach((row) => {
    const seconds = Math.ceil(Number(row.duration) || 6);
    if (seconds > target) target = seconds;
  });
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:" + (init ? "7" : "3"),
    "#EXT-X-TARGETDURATION:" + target,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-MEDIA-SEQUENCE:0"
  ];
  if (init) lines.push('#EXT-X-MAP:URI="' + base + '/init"');
  segments.forEach((row) => {
    const duration = Number(row.duration) > 0 ? Number(row.duration) : 5;
    lines.push("#EXTINF:" + duration.toFixed(3) + ",");
    lines.push(base + "/" + Number(row.part_index));
  });
  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

// Returns { start, end } for a satisfiable single range, null when the
// request wants the whole object, or false when the range is invalid.
export function parseRange(header, size) {
  const raw = String(header || "").trim();
  const total = Number(size) || 0;
  if (!raw) return null;
  const match = raw.match(/^bytes=(\d+)-(\d*)$/);
  if (!match || total <= 0) return false;
  const start = Number(match[1]);
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start >= total || start < 0 || end < start) return false;
  if (end >= total) end = total - 1;
  return { start, end };
}
