// Pure helpers for owner live previews and past-live cards.
// Nothing here fetches TikTok or stores a secret.

export function thumbObjectKey(handle, room) {
  const name = String(handle || "");
  const id = String(room || "");
  if (!/^[A-Za-z0-9._]{2,24}$/.test(name)) return "";
  if (!/^[1-9][0-9]{5,24}$/.test(id)) return "";
  return "owner/live-thumbs/" + name.toLowerCase() + "/" + id + ".mp4";
}

export function videoQuality(name) {
  const key = String(name || "").toLowerCase();
  return key !== "ao" && key !== "audio" && key !== "audio_only";
}

export function lowestPreview(info) {
  const rows = info && Array.isArray(info.variants) ? info.variants : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row || !videoQuality(row.quality)) continue;
    if (row.hls) return { kind: "hls", url: String(row.hls), quality: String(row.quality || "") };
    if (row.flv) return { kind: "flv", url: String(row.flv), quality: String(row.quality || "") };
  }
  if (info && videoQuality(info.quality) && info.hls) return { kind: "hls", url: String(info.hls), quality: String(info.quality || "") };
  if (info && videoQuality(info.quality) && info.flv) return { kind: "flv", url: String(info.flv), quality: String(info.quality || "") };
  return null;
}

// "on" is an explicit choice. "off" stops previews. "auto" follows Save-Data
// and the existing autoplay setting.
export function previewsAllowed(mode, saveData, autoplay, network) {
  const choice = mode === "on" || mode === "off" ? mode : "auto";
  if (choice === "off") return false;
  if (choice === "on") return true;
  if (saveData) return false;
  if (autoplay === "never") return false;
  if (autoplay === "wifi" && network && network !== "wifi") return false;
  return true;
}

export function formatBytes(value) {
  const n = Number(value) || 0;
  if (n < 1) return "";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB"];
  let size = n / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const text = size >= 10 ? String(Math.round(size)) : String(Math.round(size * 10) / 10);
  return text + " " + units[unit];
}

export function b2Configured(env) {
  if (!env) return false;
  return !!(String(env.B2_KEY_ID || "").trim() && String(env.B2_APP_KEY || "").trim() && String(env.B2_BUCKET || "").trim());
}
