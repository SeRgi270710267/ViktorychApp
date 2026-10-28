/* Private story-bar layout for one account: pins, hidden sources, and folders.
   Names and icons are stored whole. Only that account can read or write the row. */

export const STORY_BAR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS story_bar (
    public_id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`
];

const PUBLIC_ID = /^\d{12}$/;
const MAX_PINS = 200;
const MAX_HIDDEN = 400;
const MAX_FOLDERS = 200;
const MAX_MEMBERS = 500;

function text(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function strings(list, cap) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const id = text(item);
    if (!id || seen[id] || out.length >= cap) return;
    seen[id] = 1;
    out.push(id);
  });
  return out;
}

export function cleanStoryBar(body) {
  const raw = body && typeof body === "object" ? body : {};
  const pins = strings(raw.pins, MAX_PINS);
  const hidden = [];
  const hiddenSeen = {};
  (Array.isArray(raw.hidden) ? raw.hidden : []).forEach((item) => {
    if (!item || hidden.length >= MAX_HIDDEN) return;
    const id = text(item.id || item);
    if (!id || hiddenSeen[id]) return;
    hiddenSeen[id] = 1;
    const row = { id: id, name: text(item.name), platform: text(item.platform), handle: text(item.handle) };
    if (Array.isArray(item.also)) row.also = strings(item.also, 12);
    hidden.push(row);
  });
  const folders = [];
  const folderSeen = {};
  (Array.isArray(raw.folders) ? raw.folders : []).forEach((item) => {
    if (!item || folders.length >= MAX_FOLDERS) return;
    const id = text(item.id);
    if (!id || folderSeen[id]) return;
    folderSeen[id] = 1;
    folders.push({
      id: id,
      name: text(item.name),
      icon: text(item.icon),
      members: strings(item.members, MAX_MEMBERS)
    });
  });
  const active = text(raw.active);
  return {
    pins: pins,
    hidden: hidden,
    folders: folders,
    active: folders.some((folder) => folder.id === active) ? active : "",
    updatedAt: Math.max(0, Math.floor(Number(raw.updatedAt) || 0))
  };
}

export async function handleStoryBar(request, env, path, deps) {
  if (path !== "/v1/story-bar") return null;
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer || !PUBLIC_ID.test(String(viewer.public_id || ""))) return deps.json(401, { error: "unauthorized" });
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT doc, updated_at FROM story_bar WHERE public_id = ?").bind(viewer.public_id).first();
    if (!row) return deps.json(200, { doc: cleanStoryBar({}), updatedAt: 0 });
    let parsed = {};
    try { parsed = JSON.parse(row.doc || "{}"); } catch (err) { parsed = {}; }
    const doc = cleanStoryBar(parsed);
    return deps.json(200, { doc: doc, updatedAt: Number(row.updated_at) || doc.updatedAt || 0 });
  }
  if (request.method !== "PUT") return null;
  const paced = await deps.rateHit(env, "story-bar:" + viewer.public_id, 60, 60 * 60 * 1000);
  if (!paced.ok) return deps.limited(paced);
  const body = await deps.readJson(request, 2000000);
  if (body.error) return deps.json(body.error === "too_large" ? 413 : 400, { error: body.error });
  const doc = cleanStoryBar(body);
  const now = doc.updatedAt || Date.now();
  const current = await env.DB.prepare("SELECT updated_at FROM story_bar WHERE public_id = ?").bind(viewer.public_id).first();
  if (current && Number(current.updated_at) > now) {
    const row = await env.DB.prepare("SELECT doc, updated_at FROM story_bar WHERE public_id = ?").bind(viewer.public_id).first();
    let parsed = {};
    try { parsed = JSON.parse((row && row.doc) || "{}"); } catch (err) { parsed = {}; }
    return deps.json(200, { doc: cleanStoryBar(parsed), updatedAt: Number(row && row.updated_at) || 0, kept: true });
  }
  doc.updatedAt = now;
  await env.DB.prepare(
    "INSERT INTO story_bar (public_id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at"
  ).bind(viewer.public_id, JSON.stringify(doc), now).run();
  return deps.json(200, { doc: doc, updatedAt: now });
}
