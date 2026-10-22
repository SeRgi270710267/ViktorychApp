/* Pull a public play URL out of a TikTok video page.
   The page is the same HTML a browser gets. No signed API, no login cookie. */

export function describeTikTok(status, contentType, html) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const sample = String(html || "").slice(0, 8000).toLowerCase();
  const captcha = status === 403 || status === 429 || status === 503
    || sample.indexOf("captcha-verify") >= 0
    || sample.indexOf("verify you are human") >= 0
    || sample.indexOf("bdturing-verify") >= 0
    || sample.indexOf("\"type\":\"verify\"") >= 0;
  let detail = "TikTok returned " + String(status || 0);
  if (type) detail += " " + type;
  if (captcha) detail += " captcha";
  return { tiktokStatus: Number(status) || 0, tiktokType: type, detail, captcha: !!captcha };
}

function httpsUrl(value) {
  const text = String(value || "");
  return text.startsWith("https://") ? text : "";
}

function urlList(node) {
  if (!node || typeof node !== "object") return [];
  const list = node.UrlList || node.urlList || node.url_list || [];
  return Array.isArray(list) ? list.map(httpsUrl).filter(Boolean) : [];
}

export function pickPlayUrl(html) {
  const text = String(html || "");
  const match = text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return "";
  let data = null;
  try { data = JSON.parse(match[1]); }
  catch (err) { return ""; }
  const scope = data && data.__DEFAULT_SCOPE__;
  const detail = scope && scope["webapp.video-detail"];
  const video = detail && detail.itemInfo && detail.itemInfo.itemStruct && detail.itemInfo.itemStruct.video;
  if (!video || typeof video !== "object") return "";
  const rows = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [];
  let best = "";
  let bestHeight = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const codec = String(row.CodecType || row.codecType || "").toLowerCase();
    if (codec && codec.indexOf("h264") < 0 && codec.indexOf("avc") < 0) continue;
    const urls = urlList(row.PlayAddr || row.playAddr);
    const height = Number((row.PlayAddr && (row.PlayAddr.Height || row.PlayAddr.height)) || row.Height || 0);
    if (urls[0] && height >= bestHeight) {
      best = urls[0];
      bestHeight = height;
    }
  }
  if (best) return best;
  const direct = httpsUrl(video.playAddr || video.downloadAddr);
  return direct;
}
