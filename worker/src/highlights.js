/* Profile highlights. Items are copies of the original bytes in R2.
   Nothing here re-encodes. Video responses are not cached on the CDN.
   A highlight does not expire. The audience is checked on every read. */

import { inspectHandle } from "../../shared/handle-skeleton.js";
import { canSeeAudience, normalizeAudience, setListGrants, grantsFor } from "./audience.js";

export const HIGHLIGHT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS story_library (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    vine INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'story',
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS story_library_owner ON story_library(public_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    audience TEXT NOT NULL DEFAULT 'public',
    cover_item TEXT NOT NULL DEFAULT '',
    crop_x INTEGER NOT NULL DEFAULT 0,
    crop_y INTEGER NOT NULL DEFAULT 0,
    crop_w INTEGER NOT NULL DEFAULT 10000,
    crop_h INTEGER NOT NULL DEFAULT 10000,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS highlights_owner ON highlights(public_id, sort_order, created_at)",
  `CREATE TABLE IF NOT EXISTS highlight_items (
    id TEXT PRIMARY KEY,
    highlight_id TEXT NOT NULL,
    public_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    vine INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS highlight_items_parent ON highlight_items(highlight_id, sort_order, created_at)"
];

const AUDIENCES = { public: 1, followers: 1, friends: 1, only: 1, list: 1 };
const ID = /^[a-f0-9]{32}$/;
const PUBLIC_ID = /^\d{12}$/;
const TELEGRAM_KEY = /^stories\/telegram\/[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|gif|mp4|webm|mov)$/;
const PHOTO_CAP = 15 * 1024 * 1024;
const VIDEO_CAP = 40 * 1024 * 1024;
const HIGHLIGHT_CAP = 100;
const ITEM_CAP = 100;

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function newId() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

function rowsOf(result) {
  return (result && result.results) || [];
}

function text(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function sniff(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  return "";
}

function kindOf(mime) {
  if (String(mime).indexOf("image/") === 0) return "photo";
  if (String(mime).indexOf("video/") === 0) return "video";
  return "";
}

function cropOf(body) {
  const raw = body && body.crop ? body.crop : {};
  let x = Math.max(0, Math.min(10000, Math.floor(Number(raw.x) || 0)));
  let y = Math.max(0, Math.min(10000, Math.floor(Number(raw.y) || 0)));
  let w = Math.max(1, Math.min(10000, Math.floor(Number(raw.w) || 10000)));
  let h = Math.max(1, Math.min(10000, Math.floor(Number(raw.h) || 10000)));
  if (x + w > 10000) w = 10000 - x;
  if (y + h > 10000) h = 10000 - y;
  return { x: x, y: y, w: w, h: h };
}

function absUrl(request, path) {
  try { return new URL(path, request.url).toString(); }
  catch (err) { return path; }
}

async function accountByHandle(env, handle) {
  const checked = inspectHandle(String(handle || "").replace(/^@/, ""));
  if (!checked.ok) return null;
  return env.DB.prepare(
    "SELECT public_id, handle, display_name, profile_less FROM accounts WHERE skeleton = ?"
  ).bind(checked.skeleton).first();
}

async function canSee(env, viewer, owner, audience, highlightId) {
  if (!owner) return false;
  return canSeeAudience(env, {
    viewerId: viewer ? viewer.public_id : "",
    ownerId: owner.public_id,
    audience: audience,
    subject: "highlight",
    subjectId: highlightId,
    profileLess: owner.profile_less === 1
  });
}

async function copyBytes(env, fromKey, toKey, mime) {
  if (!env.DATA || !fromKey) return null;
  const object = await env.DATA.get(fromKey);
  if (!object) return null;
  const bytes = await object.arrayBuffer();
  await env.DATA.put(toKey, bytes, {
    httpMetadata: { contentType: mime || "application/octet-stream", cacheControl: "private, no-store" }
  });
  return bytes.byteLength;
}

async function resolveSource(env, viewer, source, id) {
  const kind = String(source || "");
  if (kind === "story" && ID.test(id)) {
    const row = await env.DB.prepare(
      "SELECT id, public_id, kind, vine, r2_key, mime, bytes FROM app_stories WHERE id = ?"
    ).bind(id).first();
    if (!row || row.public_id !== viewer.public_id) return null;
    return row;
  }
  if ((kind === "library" || kind === "upload") && ID.test(id)) {
    const row = await env.DB.prepare(
      "SELECT id, public_id, kind, vine, r2_key, mime, bytes FROM story_library WHERE id = ?"
    ).bind(id).first();
    if (!row || row.public_id !== viewer.public_id) return null;
    return row;
  }
  if (kind === "profile" && ID.test(id)) {
    const row = await env.DB.prepare(
      "SELECT id, public_id, kind, object_key FROM profile_media WHERE id = ?"
    ).bind(id).first();
    if (!row || row.public_id !== viewer.public_id || row.kind === "banner") return null;
    const head = env.DATA ? await env.DATA.head(row.object_key) : null;
    return {
      kind: "photo",
      vine: 0,
      r2_key: row.object_key,
      mime: (head && head.httpMetadata && head.httpMetadata.contentType) || "image/jpeg",
      bytes: Number(head && head.size) || 0
    };
  }
  if (kind === "telegram" && TELEGRAM_KEY.test(id)) {
    const object = env.DATA ? await env.DATA.get("stories/telegram/manifest.json") : null;
    if (!object) return null;
    let doc = {};
    try { doc = JSON.parse(await object.text()); } catch (err) { doc = {}; }
    const items = Array.isArray(doc.items) ? doc.items : [];
    const found = items.some((item) => item && item.key === id);
    if (!found) return null;
    const head = await env.DATA.head(id);
    const mime = (head && head.httpMetadata && head.httpMetadata.contentType) || (id.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
    return { kind: kindOf(mime) || "photo", vine: 0, r2_key: id, mime: mime, bytes: Number(head && head.size) || 0 };
  }
  return null;
}

async function addItem(env, viewer, highlightId, source, sourceId, order, now) {
  const origin = await resolveSource(env, viewer, source, sourceId);
  if (!origin) return null;
  const id = newId();
  const key = "highlights/" + viewer.public_id + "/" + id;
  const size = await copyBytes(env, origin.r2_key, key, origin.mime);
  if (size == null) return null;
  await env.DB.prepare(
    "INSERT INTO highlight_items (id, highlight_id, public_id, kind, vine, r2_key, mime, bytes, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, highlightId, viewer.public_id, origin.kind || "photo", origin.vine ? 1 : 0, key, origin.mime, size, order, now).run();
  return id;
}

function presentCover(request, row) {
  return {
    id: row.id,
    title: row.title || "",
    cover: row.cover_item ? absUrl(request, "/v1/highlights/media/" + row.cover_item) : "",
    crop: { x: row.crop_x, y: row.crop_y, w: row.crop_w, h: row.crop_h }
  };
}

async function listFor(env, request, viewer, owner) {
  const listed = await env.DB.prepare(
    "SELECT id, public_id, title, audience, cover_item, crop_x, crop_y, crop_w, crop_h, sort_order FROM highlights WHERE public_id = ? ORDER BY sort_order ASC, created_at ASC"
  ).bind(owner.public_id).all();
  const mine = !!(viewer && viewer.public_id === owner.public_id);
  const highlights = [];
  for (const row of rowsOf(listed)) {
    if (!(await canSee(env, viewer, owner, row.audience, row.id))) continue;
    const item = presentCover(request, row);
    if (mine) item.audience = row.audience;
    highlights.push(item);
  }
  return { mine: mine, highlights: highlights };
}

async function readItems(env, highlightId) {
  const listed = await env.DB.prepare(
    "SELECT id, kind, vine, mime, sort_order FROM highlight_items WHERE highlight_id = ? ORDER BY sort_order ASC, created_at ASC"
  ).bind(highlightId).all();
  return rowsOf(listed);
}

function mediaHeaders(mime, size) {
  const headers = new Headers();
  headers.set("content-type", mime || "application/octet-stream");
  headers.set("cache-control", "private, no-store");
  headers.set("cdn-cache-control", "no-store");
  headers.set("cloudflare-cdn-cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", "inline");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  if (size >= 0) headers.set("content-length", String(size));
  if (String(mime || "").indexOf("video/") === 0) headers.set("accept-ranges", "bytes");
  return headers;
}

async function sendItem(request, env, row) {
  if (!env.DATA) return new Response(null, { status: 404 });
  const head = await env.DATA.head(row.r2_key);
  if (!head) return new Response(null, { status: 404 });
  const size = Number(head.size) || 0;
  const headers = mediaHeaders(row.mime, size);
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const object = await env.DATA.get(row.r2_key);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, { status: 200, headers });
}

async function sourcesFor(env, viewer) {
  const now = Date.now();
  const items = [];
  const stories = await env.DB.prepare(
    "SELECT id, kind, created_at, expires_at FROM app_stories WHERE public_id = ? ORDER BY created_at DESC LIMIT 80"
  ).bind(viewer.public_id).all();
  rowsOf(stories).forEach((row) => {
    items.push({ source: "story", id: row.id, type: row.kind === "video" ? "video" : "photo", expired: Number(row.expires_at) <= now });
  });
  const library = await env.DB.prepare(
    "SELECT id, kind, source FROM story_library WHERE public_id = ? ORDER BY created_at DESC LIMIT 80"
  ).bind(viewer.public_id).all();
  rowsOf(library).forEach((row) => {
    items.push({ source: row.source === "upload" ? "upload" : "library", id: row.id, type: row.kind === "video" ? "video" : "photo", expired: row.source === "story" });
  });
  const photos = await env.DB.prepare(
    "SELECT id FROM profile_media WHERE public_id = ? AND kind = 'photo' ORDER BY created_at DESC LIMIT 40"
  ).bind(viewer.public_id).all();
  rowsOf(photos).forEach((row) => items.push({ source: "profile", id: row.id, type: "photo" }));
  if (env.DATA && (viewer.owner === 1 || viewer.handle === env.OWNER_HANDLE)) {
    try {
      const object = await env.DATA.get("stories/telegram/manifest.json");
      if (object) {
        const doc = JSON.parse(await object.text());
        (Array.isArray(doc.items) ? doc.items : []).forEach((item) => {
          if (item && TELEGRAM_KEY.test(item.key || "") && Number(item.expires) > now) {
            items.push({ source: "telegram", id: item.key, type: /\.(mp4|webm|mov)$/.test(item.key) ? "video" : "photo" });
          }
        });
      }
    } catch (err) { /* no telegram copies */ }
  }
  return { items: items };
}

export async function handleHighlights(request, env, path, deps) {
  const url = new URL(request.url);
  const media = path.match(/^\/v1\/highlights\/media\/([a-f0-9]{32})$/);
  if (media && (request.method === "GET" || request.method === "HEAD")) {
    const item = await env.DB.prepare(
      "SELECT i.id, i.highlight_id, i.r2_key, i.mime, h.public_id, h.audience FROM highlight_items i JOIN highlights h ON h.id = i.highlight_id WHERE i.id = ?"
    ).bind(media[1]).first();
    if (!item) return deps.json(404, { error: "not_found" });
    const owner = await env.DB.prepare(
      "SELECT public_id, handle, display_name, profile_less FROM accounts WHERE public_id = ?"
    ).bind(item.public_id).first();
    const viewer = await deps.sessionAccount(env, request);
    if (!(await canSee(env, viewer, owner, item.audience, item.highlight_id))) return deps.json(404, { error: "not_found" });
    return sendItem(request, env, item);
  }
  const viewer = await deps.sessionAccount(env, request);
  const oneEarly = path.match(/^\/v1\/highlights\/([a-f0-9]{32})$/);
  if (oneEarly && request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT id, public_id, title, audience, cover_item, crop_x, crop_y, crop_w, crop_h FROM highlights WHERE id = ?"
    ).bind(oneEarly[1]).first();
    if (!row) return deps.json(404, { error: "not_found" });
    const owner = await env.DB.prepare(
      "SELECT public_id, handle, display_name, profile_less FROM accounts WHERE public_id = ?"
    ).bind(row.public_id).first();
    if (!(await canSee(env, viewer, owner, row.audience, row.id))) return deps.json(404, { error: "not_found" });
    const items = await readItems(env, row.id);
    return deps.json(200, {
      id: row.id,
      title: row.title || "",
      handle: owner ? owner.handle : "",
      name: owner ? (owner.display_name || owner.handle) : "",
      crop: { x: row.crop_x, y: row.crop_y, w: row.crop_w, h: row.crop_h },
      audience: viewer && viewer.public_id === row.public_id ? row.audience : undefined,
      items: items.map((item) => ({
        id: item.id,
        type: item.kind === "video" ? "video" : "photo",
        url: absUrl(request, "/v1/highlights/media/" + item.id),
        vine: item.vine === 1
      }))
    });
  }
  if (path === "/v1/highlights" && request.method === "GET") {
    const handle = String(url.searchParams.get("handle") || "");
    const owner = handle ? await accountByHandle(env, handle) : viewer;
    if (!owner) return deps.json(handle ? 404 : 401, { error: handle ? "not_found" : "unauthorized" });
    return deps.json(200, await listFor(env, request, viewer, owner));
  }
  if (!viewer) return deps.json(401, { error: "unauthorized" });
  if (path === "/v1/highlights/sources" && request.method === "GET") {
    return deps.json(200, await sourcesFor(env, viewer));
  }
  if (path === "/v1/highlights/upload" && request.method === "POST") {
    const paced = await deps.rateHit(env, "hl-up:" + viewer.public_id, 30, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    let form = null;
    try { form = await request.formData(); } catch (err) { form = null; }
    const file = form && form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return deps.json(400, { error: "file" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniff(bytes);
    const kind = kindOf(mime);
    if (!kind) return deps.json(415, { error: "type" });
    if ((kind === "photo" && bytes.length > PHOTO_CAP) || (kind === "video" && bytes.length > VIDEO_CAP)) return deps.json(413, { error: "too_large" });
    if (!env.DATA) return deps.json(503, { error: "not_configured" });
    const id = newId();
    const key = "stories/library/" + viewer.public_id + "/" + id;
    await env.DATA.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: "private, no-store" } });
    await env.DB.prepare(
      "INSERT INTO story_library (id, public_id, kind, vine, r2_key, mime, bytes, source, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, 'upload', ?)"
    ).bind(id, viewer.public_id, kind, key, mime, bytes.length, Date.now()).run();
    return deps.json(201, { id: id, source: "upload", type: kind === "video" ? "video" : "photo" });
  }
  if (path === "/v1/highlights/order" && request.method === "PUT") {
    const body = await deps.readJson(request, 2000000);
    if (body.error) return deps.json(400, { error: body.error });
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id || "")).filter((id) => ID.test(id)) : [];
    const now = Date.now();
    await env.DB.batch(ids.map((id, index) => env.DB.prepare(
      "UPDATE highlights SET sort_order = ?, updated_at = ? WHERE id = ? AND public_id = ?"
    ).bind(index, now, id, viewer.public_id)));
    return deps.json(200, { ok: true });
  }
  if (path === "/v1/highlights" && request.method === "POST") {
    const paced = await deps.rateHit(env, "hl:" + viewer.public_id, 30, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 2000000);
    if (body.error) return deps.json(body.error === "too_large" ? 413 : 400, { error: body.error });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM highlights WHERE public_id = ?").bind(viewer.public_id).first();
    if (Number(count && count.n) >= HIGHLIGHT_CAP) return deps.json(429, { error: "too_many" });
    const picked = Array.isArray(body.items) ? body.items.slice(0, ITEM_CAP) : [];
    if (!picked.length) return deps.json(400, { error: "items" });
    const audience = AUDIENCES[normalizeAudience(body.audience) || "public"] ? (normalizeAudience(body.audience) || "public") : "public";
    const crop = cropOf(body);
    const id = newId();
    const now = Date.now();
    const made = [];
    for (let i = 0; i < picked.length; i++) {
      const itemId = await addItem(env, viewer, id, picked[i] && picked[i].source, String(picked[i] && picked[i].id || ""), i, now);
      if (itemId) made.push(itemId);
    }
    if (!made.length) return deps.json(400, { error: "items" });
    const coverAt = Math.max(0, Math.min(made.length - 1, Math.floor(Number(body.cover) || 0)));
    await env.DB.prepare(
      "INSERT INTO highlights (id, public_id, title, audience, cover_item, crop_x, crop_y, crop_w, crop_h, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, viewer.public_id, text(body.title), audience, made[coverAt], crop.x, crop.y, crop.w, crop.h, Number(count && count.n) || 0, now, now).run();
    if (audience === "list") await setListGrants(env, viewer.public_id, "highlight", id, body.listIds);
    return deps.json(201, { id: id, title: text(body.title) });
  }
  const one = path.match(/^\/v1\/highlights\/([a-f0-9]{32})$/);
  if (!one) return null;
  const row = await env.DB.prepare(
    "SELECT id, public_id, title, audience, cover_item, crop_x, crop_y, crop_w, crop_h FROM highlights WHERE id = ?"
  ).bind(one[1]).first();
  if (!row) return deps.json(404, { error: "not_found" });
  if (row.public_id !== viewer.public_id) return deps.json(404, { error: "not_found" });
  if (request.method === "DELETE") {
    const items = await env.DB.prepare("SELECT id, r2_key FROM highlight_items WHERE highlight_id = ?").bind(row.id).all();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM highlight_items WHERE highlight_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM highlights WHERE id = ? AND public_id = ?").bind(row.id, viewer.public_id)
    ]);
    for (const item of rowsOf(items)) {
      if (env.DATA && item.r2_key) {
        try { await env.DATA.delete(item.r2_key); } catch (err) { /* the row is gone */ }
      }
    }
    return deps.json(200, { ok: true });
  }
  if (request.method !== "PUT") return null;
  const body = await deps.readJson(request, 2000000);
  if (body.error) return deps.json(body.error === "too_large" ? 413 : 400, { error: body.error });
  const nextAudience = normalizeAudience(body.audience);
  const audience = nextAudience && AUDIENCES[nextAudience] ? nextAudience : row.audience;
  const crop = body.crop ? cropOf(body) : { x: row.crop_x, y: row.crop_y, w: row.crop_w, h: row.crop_h };
  const title = body.title != null ? text(body.title) : row.title;
  const now = Date.now();
  if (Array.isArray(body.remove)) {
    for (const itemId of body.remove) {
      if (!ID.test(String(itemId || ""))) continue;
      const item = await env.DB.prepare(
        "SELECT id, r2_key FROM highlight_items WHERE id = ? AND highlight_id = ? AND public_id = ?"
      ).bind(itemId, row.id, viewer.public_id).first();
      if (!item) continue;
      await env.DB.prepare("DELETE FROM highlight_items WHERE id = ?").bind(item.id).run();
      if (env.DATA && item.r2_key) {
        try { await env.DATA.delete(item.r2_key); } catch (err) { /* removed from the highlight */ }
      }
    }
  }
  if (Array.isArray(body.add)) {
    const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM highlight_items WHERE highlight_id = ?").bind(row.id).first();
    let order = Number(have && have.n) || 0;
    for (const picked of body.add.slice(0, ITEM_CAP)) {
      if (order >= ITEM_CAP) break;
      const itemId = await addItem(env, viewer, row.id, picked && picked.source, String(picked && picked.id || ""), order, now);
      if (itemId) order += 1;
    }
  }
  if (Array.isArray(body.items)) {
    const ids = body.items.map((id) => String(id || "")).filter((id) => ID.test(id));
    await env.DB.batch(ids.map((id, index) => env.DB.prepare(
      "UPDATE highlight_items SET sort_order = ? WHERE id = ? AND highlight_id = ? AND public_id = ?"
    ).bind(index, id, row.id, viewer.public_id)));
  }
  const left = await readItems(env, row.id);
  if (!left.length) return deps.json(400, { error: "items" });
  let cover = row.cover_item;
  if (body.coverItem && left.some((item) => item.id === body.coverItem)) cover = body.coverItem;
  if (!left.some((item) => item.id === cover)) cover = left[0].id;
  await env.DB.prepare(
    "UPDATE highlights SET title = ?, audience = ?, cover_item = ?, crop_x = ?, crop_y = ?, crop_w = ?, crop_h = ?, updated_at = ? WHERE id = ? AND public_id = ?"
  ).bind(title, audience, cover, crop.x, crop.y, crop.w, crop.h, now, row.id, viewer.public_id).run();
  if (body.listIds || audience === "list") await setListGrants(env, viewer.public_id, "highlight", row.id, audience === "list" ? body.listIds : []);
  return deps.json(200, { id: row.id, title: title });
}
