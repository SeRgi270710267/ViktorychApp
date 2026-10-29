// Only passive media types are passed through. Anything else (HTML, SVG,
// XML, JavaScript) is sent as an opaque download type.
export function passiveMediaType(type) {
  const text = String(type || "").trim();
  const base = text.split(";")[0].trim().toLowerCase();
  if (base === "image/svg+xml") return "application/octet-stream";
  if (/^(?:image|video|audio)\/[a-z0-9.+-]+$/.test(base)) return text;
  if (base === "application/vnd.apple.mpegurl" || base === "application/x-mpegurl" || base === "application/dash+xml" || base === "application/octet-stream" || base === "binary/octet-stream" || base === "application/mp4") return text;
  return "application/octet-stream";
}
