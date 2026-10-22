/* Slim watch/read history stored inside the account sync payload.
   Entries are id, kind, platform, time, and progress. The newest 300 win. */

export const HISTORY_CAP = 300;

export function cleanHistoryCut(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const n = (value) => {
    const num = Number(value) || 0;
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.floor(Math.min(num, 9e15));
  };
  return { video: n(src.video), article: n(src.article) };
}

export function cleanHistoryList(rows, cut) {
  const gate = cleanHistoryCut(cut);
  const seen = new Map();
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || typeof row !== "object") continue;
    const kind = row.kind === "article" ? "article" : row.kind === "video" ? "video" : "";
    const id = String(row.id || "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80);
    const at = Number(row.at);
    if (!kind || !id || !Number.isFinite(at) || at <= 0) continue;
    if (at <= gate[kind]) continue;
    const platform = String(row.platform || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    const item = { id, kind, platform, at: Math.floor(at) };
    const progress = Number(row.progress);
    if (Number.isFinite(progress) && progress > 0 && progress <= 1) item.progress = Math.round(progress * 1000) / 1000;
    const key = kind + ":" + id;
    const prev = seen.get(key);
    if (!prev || item.at >= prev.at) seen.set(key, item);
  }
  return Array.from(seen.values()).sort((a, b) => b.at - a.at).slice(0, HISTORY_CAP);
}

export function mergeHistory(local, remote, cut) {
  const gate = cleanHistoryCut(cut);
  const remoteRows = Array.isArray(remote) ? remote : [];
  const localRows = Array.isArray(local) ? local : [];
  return cleanHistoryList(remoteRows.concat(localRows), gate);
}
