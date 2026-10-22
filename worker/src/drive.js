/* Owner-only Drive. Ciphertext goes to the backup channel. Names, sizes,
   and thumbnails stay inside encrypted blobs. These rows are not the
   public Telegram backup index. */

import { safeTelegramPath } from "./telegram.js";

const CHUNK_MAX = 19 * 1024 * 1024;
const TRASH_MS = 30 * 24 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const B64_RE = /^[A-Za-z0-9+/]+=*$/;

function cleanId(value) {
  const text = String(value || "");
  return ID_RE.test(text) ? text : "";
}

function cleanB64(value, max) {
  const text = String(value || "");
  if (!text || text.length > max || !B64_RE.test(text)) return "";
  return text;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function requireOwner(env, request, deps) {
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return { response: deps.json(404, { error: "not_found" }) };
  if (viewer.owner !== 1) return { response: deps.json(403, { error: "forbidden" }) };
  return { viewer: viewer };
}

async function sendChunk(env, bytes) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  const channel = String(env.TELEGRAM_CHANNEL_ID || "");
  if (!token || !channel) return { error: "not_configured" };
  const form = new FormData();
  form.set("chat_id", channel);
  form.set("caption", "vdrive");
  form.set("document", new Blob([bytes], { type: "application/octet-stream" }), "part.bin");
  let data = null;
  try {
    const res = await fetch("https://api.telegram.org/bot" + token + "/sendDocument", { method: "POST", body: form });
    data = await res.json();
  } catch (err) {
    data = null;
  }
  const result = data && data.ok ? data.result : null;
  const fileId = result && result.document && result.document.file_id;
  const messageId = result && result.message_id;
  if (!fileId || !messageId) return { error: "upload_failed" };
  return { fileId: String(fileId), messageId: Number(messageId), size: bytes.byteLength };
}

async function deleteMessage(env, messageId) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  const channel = String(env.TELEGRAM_CHANNEL_ID || "");
  if (!token || !channel || !messageId) return false;
  try {
    const res = await fetch("https://api.telegram.org/bot" + token + "/deleteMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: channel, message_id: Number(messageId) })
    });
    const data = await res.json();
    return !!(data && data.ok);
  } catch (err) {
    return false;
  }
}

async function downloadChunk(env, fileId) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "");
  if (!token || !fileId) return null;
  let data = null;
  try {
    const res = await fetch("https://api.telegram.org/bot" + token + "/getFile?file_id=" + encodeURIComponent(fileId));
    data = await res.json();
  } catch (err) {
    data = null;
  }
  const path = safeTelegramPath(data && data.ok && data.result && data.result.file_path);
  if (!path) return null;
  const upstream = await fetch("https://api.telegram.org/file/bot" + token + "/" + path);
  if (!upstream.ok) return null;
  return upstream.arrayBuffer();
}

function itemRow(row) {
  return {
    id: row.id,
    parentId: row.parent_id || "",
    kind: row.kind,
    wrappedKey: row.wrapped_key,
    wrapIv: row.wrap_iv,
    meta: row.meta,
    metaIv: row.meta_iv,
    thumb: row.thumb || "",
    thumbIv: row.thumb_iv || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || 0
  };
}

async function ownedItem(env, viewer, id) {
  if (!cleanId(id)) return null;
  return env.DB.prepare("SELECT * FROM drive_items WHERE id = ? AND public_id = ?").bind(id, viewer.public_id).first();
}

async function descendants(env, viewer, id) {
  const rows = await env.DB.prepare("SELECT id, parent_id FROM drive_items WHERE public_id = ?").bind(viewer.public_id).all();
  const list = (rows && rows.results) || [];
  const children = {};
  list.forEach((row) => {
    const parent = row.parent_id || "";
    if (!children[parent]) children[parent] = [];
    children[parent].push(row.id);
  });
  const out = [];
  const stack = [id];
  const seen = {};
  while (stack.length) {
    const current = stack.pop();
    if (seen[current]) continue;
    seen[current] = true;
    (children[current] || []).forEach((child) => {
      out.push(child);
      stack.push(child);
    });
  }
  return out;
}

async function purgeExpired(env, viewer) {
  const cutoff = Date.now() - TRASH_MS;
  const stale = await env.DB.prepare("SELECT id FROM drive_items WHERE public_id = ? AND deleted_at > 0 AND deleted_at < ?").bind(viewer.public_id, cutoff).all();
  const ids = ((stale && stale.results) || []).map((row) => row.id);
  for (let i = 0; i < ids.length; i++) await destroyItem(env, viewer, ids[i]);
}

async function destroyItem(env, viewer, id) {
  const item = await ownedItem(env, viewer, id);
  if (!item) return false;
  const kids = item.kind === "folder" ? await descendants(env, viewer, id) : [];
  const ids = [id].concat(kids);
  for (let i = 0; i < ids.length; i++) {
    const chunks = await env.DB.prepare("SELECT message_id FROM drive_chunks WHERE item_id = ?").bind(ids[i]).all();
    const parts = (chunks && chunks.results) || [];
    for (let n = 0; n < parts.length; n++) await deleteMessage(env, parts[n].message_id);
    await env.DB.prepare("DELETE FROM drive_chunks WHERE item_id = ?").bind(ids[i]).run();
    await env.DB.prepare("DELETE FROM drive_items WHERE id = ? AND public_id = ?").bind(ids[i], viewer.public_id).run();
  }
  return true;
}

async function handleVaultGet(env, request, deps) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  await purgeExpired(env, gate.viewer);
  const vault = await env.DB.prepare("SELECT kdf, iterations, salt, verifier, verifier_iv, created_at FROM drive_vault WHERE public_id = ?").bind(gate.viewer.public_id).first();
  const sum = await env.DB.prepare("SELECT COALESCE(SUM(c.size), 0) AS total FROM drive_chunks c JOIN drive_items i ON i.id = c.item_id WHERE i.public_id = ? AND i.deleted_at = 0").bind(gate.viewer.public_id).first();
  return deps.json(200, {
    vault: vault ? {
      kdf: vault.kdf,
      iterations: vault.iterations,
      salt: vault.salt,
      verifier: vault.verifier,
      verifierIv: vault.verifier_iv,
      createdAt: vault.created_at
    } : null,
    stored: Number(sum && sum.total) || 0
  });
}

async function handleVaultPut(env, request, deps) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  const body = await deps.readJson(request, 8000);
  if (body.error) return deps.json(400, { error: body.error });
  const rounds = Math.floor(Number(body.iterations) || 0);
  const salt = cleanB64(body.salt, 80);
  const verifier = cleanB64(body.verifier, 200);
  const verifierIv = cleanB64(body.verifierIv, 80);
  if (body.kdf !== "pbkdf2-sha256" || rounds < 1000 || rounds > 2000000 || !salt || !verifier || !verifierIv) {
    return deps.json(400, { error: "bad_vault" });
  }
  const existing = await env.DB.prepare("SELECT public_id FROM drive_vault WHERE public_id = ?").bind(gate.viewer.public_id).first();
  if (existing) return deps.json(409, { error: "vault_exists" });
  const now = Date.now();
  await env.DB.prepare("INSERT INTO drive_vault (public_id, kdf, iterations, salt, verifier, verifier_iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
    gate.viewer.public_id, "pbkdf2-sha256", rounds, salt, verifier, verifierIv, now, now
  ).run();
  return deps.json(201, { ok: true });
}

async function handleItemsGet(env, request, deps, url) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  await purgeExpired(env, gate.viewer);
  const trash = url.searchParams.get("trash") === "1";
  const rows = await env.DB.prepare("SELECT * FROM drive_items WHERE public_id = ? AND deleted_at " + (trash ? "> 0" : "= 0") + " ORDER BY updated_at DESC LIMIT 2000").bind(gate.viewer.public_id).all();
  const items = ((rows && rows.results) || []).map(itemRow);
  const chunks = await env.DB.prepare("SELECT c.item_id, c.part_index, c.size, c.iv FROM drive_chunks c JOIN drive_items i ON i.id = c.item_id WHERE i.public_id = ?").bind(gate.viewer.public_id).all();
  const parts = {};
  ((chunks && chunks.results) || []).forEach((row) => {
    if (!parts[row.item_id]) parts[row.item_id] = [];
    parts[row.item_id].push({ index: row.part_index, size: row.size, iv: row.iv });
  });
  items.forEach((item) => { item.chunks = parts[item.id] || []; });
  return deps.json(200, { items: items });
}

async function handleItemPost(env, request, deps) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  const budget = await deps.rateHit(env, "drive-write:" + gate.viewer.public_id, 60, 60 * 1000);
  if (!budget.ok) return deps.limited(budget);
  const body = await deps.readJson(request, 80000);
  if (body.error) return deps.json(400, { error: body.error });
  const kind = body.kind === "folder" || body.kind === "file" ? body.kind : "";
  const parentId = body.parentId ? cleanId(body.parentId) : "";
  if (body.parentId && !parentId) return deps.json(400, { error: "bad_parent" });
  const wrappedKey = cleanB64(body.wrappedKey, 200);
  const wrapIv = cleanB64(body.wrapIv, 80);
  const meta = cleanB64(body.meta, 8000);
  const metaIv = cleanB64(body.metaIv, 80);
  const thumb = body.thumb ? cleanB64(body.thumb, 60000) : "";
  const thumbIv = body.thumb ? cleanB64(body.thumbIv, 80) : "";
  if (!kind || !wrappedKey || !wrapIv || !meta || !metaIv) return deps.json(400, { error: "bad_item" });
  if (body.thumb && (!thumb || !thumbIv)) return deps.json(400, { error: "bad_item" });
  if (parentId) {
    const parent = await ownedItem(env, gate.viewer, parentId);
    if (!parent || parent.kind !== "folder" || parent.deleted_at) return deps.json(400, { error: "bad_parent" });
  }
  const id = newId();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO drive_items (id, public_id, parent_id, kind, wrapped_key, wrap_iv, meta, meta_iv, thumb, thumb_iv, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").bind(
    id, gate.viewer.public_id, parentId, kind, wrappedKey, wrapIv, meta, metaIv, thumb, thumbIv, now, now
  ).run();
  return deps.json(201, { id: id });
}

async function handleItemPatch(env, request, deps, id) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  const item = await ownedItem(env, gate.viewer, id);
  if (!item) return deps.json(404, { error: "not_found" });
  const body = await deps.readJson(request, 80000);
  if (body.error) return deps.json(400, { error: body.error });
  if (body.restore) {
    const kids = item.kind === "folder" ? await descendants(env, gate.viewer, id) : [];
    const ids = [id].concat(kids);
    const now = Date.now();
    for (let i = 0; i < ids.length; i++) {
      await env.DB.prepare("UPDATE drive_items SET deleted_at = 0, updated_at = ? WHERE id = ? AND public_id = ?").bind(now, ids[i], gate.viewer.public_id).run();
    }
    return deps.json(200, { ok: true });
  }
  let parentId = item.parent_id || "";
  if (Object.prototype.hasOwnProperty.call(body, "parentId")) {
    parentId = body.parentId ? cleanId(body.parentId) : "";
    if (body.parentId && !parentId) return deps.json(400, { error: "bad_parent" });
    if (parentId === id) return deps.json(400, { error: "bad_parent" });
    if (parentId) {
      const parent = await ownedItem(env, gate.viewer, parentId);
      if (!parent || parent.kind !== "folder" || parent.deleted_at) return deps.json(400, { error: "bad_parent" });
      const below = await descendants(env, gate.viewer, id);
      if (below.indexOf(parentId) >= 0) return deps.json(400, { error: "bad_parent" });
    }
  }
  const meta = body.meta ? cleanB64(body.meta, 8000) : item.meta;
  const metaIv = body.meta ? cleanB64(body.metaIv, 80) : item.meta_iv;
  if (body.meta && (!meta || !metaIv)) return deps.json(400, { error: "bad_item" });
  const now = Date.now();
  await env.DB.prepare("UPDATE drive_items SET parent_id = ?, meta = ?, meta_iv = ?, updated_at = ? WHERE id = ? AND public_id = ?").bind(
    parentId, meta, metaIv, now, id, gate.viewer.public_id
  ).run();
  return deps.json(200, { ok: true });
}

async function handleItemDelete(env, request, deps, id, url) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  const item = await ownedItem(env, gate.viewer, id);
  if (!item) return deps.json(404, { error: "not_found" });
  const forever = url.searchParams.get("forever") === "1" || Number(item.deleted_at) > 0;
  if (forever) {
    const gone = await destroyItem(env, gate.viewer, id);
    return gone ? deps.json(200, { ok: true, deleted: true }) : deps.json(404, { error: "not_found" });
  }
  const kids = item.kind === "folder" ? await descendants(env, gate.viewer, id) : [];
  const ids = [id].concat(kids);
  const now = Date.now();
  for (let i = 0; i < ids.length; i++) {
    await env.DB.prepare("UPDATE drive_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND public_id = ? AND deleted_at = 0").bind(now, now, ids[i], gate.viewer.public_id).run();
  }
  return deps.json(200, { ok: true, trashed: true });
}

async function handleChunkPost(env, request, deps, id) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  const budget = await deps.rateHit(env, "drive-chunk:" + gate.viewer.public_id, 40, 60 * 1000);
  if (!budget.ok) return deps.limited(budget);
  const item = await ownedItem(env, gate.viewer, id);
  if (!item || item.kind !== "file" || item.deleted_at) return deps.json(404, { error: "not_found" });
  const part = Math.floor(Number(request.headers.get("x-drive-part")));
  const iv = cleanB64(request.headers.get("x-drive-iv") || "", 80);
  if (!Number.isFinite(part) || part < 0 || part > 200 || !iv) return deps.json(400, { error: "bad_chunk" });
  const existing = await env.DB.prepare("SELECT message_id, file_id, size FROM drive_chunks WHERE item_id = ? AND part_index = ?").bind(id, part).first();
  if (existing) return deps.json(200, { ok: true, part: part, messageId: existing.message_id, size: existing.size, stored: true });
  const len = Number(request.headers.get("content-length") || 0);
  if (len > CHUNK_MAX) return deps.json(413, { error: "too_large" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > CHUNK_MAX) return deps.json(413, { error: "too_large" });
  const sent = await sendChunk(env, bytes);
  if (sent.error) return deps.json(sent.error === "not_configured" ? 503 : 502, { error: sent.error });
  await env.DB.prepare("INSERT INTO drive_chunks (item_id, part_index, message_id, file_id, size, iv) VALUES (?, ?, ?, ?, ?, ?)").bind(
    id, part, sent.messageId, sent.fileId, sent.size, iv
  ).run();
  await env.DB.prepare("UPDATE drive_items SET updated_at = ? WHERE id = ?").bind(Date.now(), id).run();
  return deps.json(201, { ok: true, part: part, messageId: sent.messageId, size: sent.size });
}

async function handleChunkGet(env, request, deps, id, part) {
  const gate = await requireOwner(env, request, deps);
  if (gate.response) return gate.response;
  const budget = await deps.rateHit(env, "drive-read:" + gate.viewer.public_id, 80, 60 * 1000);
  if (!budget.ok) return deps.limited(budget);
  const item = await ownedItem(env, gate.viewer, id);
  if (!item) return deps.json(404, { error: "not_found" });
  const index = Math.floor(Number(part));
  const row = await env.DB.prepare("SELECT file_id, size FROM drive_chunks WHERE item_id = ? AND part_index = ?").bind(id, index).first();
  if (!row) return deps.json(404, { error: "not_found" });
  const bytes = await downloadChunk(env, row.file_id);
  if (!bytes) return deps.json(502, { error: "unavailable" });
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function handleDrive(request, env, path, url, deps) {
  if (path === "/v1/drive" && request.method === "GET") return handleVaultGet(env, request, deps);
  if (path === "/v1/drive/vault" && request.method === "PUT") return handleVaultPut(env, request, deps);
  if (path === "/v1/drive/items" && request.method === "GET") return handleItemsGet(env, request, deps, url);
  if (path === "/v1/drive/items" && request.method === "POST") return handleItemPost(env, request, deps);
  const item = path.match(/^\/v1\/drive\/items\/([A-Za-z0-9_-]{16,40})$/);
  if (item && request.method === "PATCH") return handleItemPatch(env, request, deps, item[1]);
  if (item && request.method === "DELETE") return handleItemDelete(env, request, deps, item[1], url);
  const upload = path.match(/^\/v1\/drive\/items\/([A-Za-z0-9_-]{16,40})\/chunks$/);
  if (upload && request.method === "POST") return handleChunkPost(env, request, deps, upload[1]);
  const download = path.match(/^\/v1\/drive\/items\/([A-Za-z0-9_-]{16,40})\/chunks\/(\d+)$/);
  if (download && request.method === "GET") return handleChunkGet(env, request, deps, download[1], download[2]);
  if (path === "/v1/drive" || path.startsWith("/v1/drive/")) {
    const gate = await requireOwner(env, request, deps);
    if (gate.response) return gate.response;
    return deps.json(404, { error: "not_found" });
  }
  return null;
}

export const DRIVE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS drive_vault (public_id TEXT PRIMARY KEY, kdf TEXT NOT NULL, iterations INTEGER NOT NULL, salt TEXT NOT NULL, verifier TEXT NOT NULL, verifier_iv TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS drive_items (id TEXT PRIMARY KEY, public_id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, wrapped_key TEXT NOT NULL DEFAULT '', wrap_iv TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL, meta_iv TEXT NOT NULL, thumb TEXT NOT NULL DEFAULT '', thumb_iv TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS drive_items_owner ON drive_items(public_id, deleted_at)",
  "CREATE TABLE IF NOT EXISTS drive_chunks (item_id TEXT NOT NULL, part_index INTEGER NOT NULL, message_id INTEGER NOT NULL, file_id TEXT NOT NULL, size INTEGER NOT NULL, iv TEXT NOT NULL, PRIMARY KEY (item_id, part_index))"
];
