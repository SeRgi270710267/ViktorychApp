/* Direct messages between accounts on this app.
   A conversation row stores the two participants as sender_id (lower id)
   and recipient_id (higher id) so account deletion clears both sides.
   Message rows use sender_id for the author and recipient_id for the other
   person. Nothing here talks to X. */

const ID_RE = /^[a-f0-9]{24}$/;
const BODY_MAX = 10000;

export const DM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dm_conversations (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(sender_id, recipient_id)
  )`,
  "CREATE INDEX IF NOT EXISTS dm_conversations_sender ON dm_conversations(sender_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS dm_conversations_recipient ON dm_conversations(recipient_id, updated_at DESC)",
  `CREATE TABLE IF NOT EXISTS dm_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS dm_messages_conv ON dm_messages(conversation_id, created_at)"
];

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function cleanPeerId(raw) {
  const text = String(raw || "").trim();
  const id = text.indexOf("app:") === 0 ? text.slice(4) : text;
  return /^\d{12}$/.test(id) ? id : "";
}

function cleanBody(value) {
  const text = String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text) return "";
  if (Array.from(text).length > BODY_MAX) return null;
  return text;
}

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function areFriends(env, a, b) {
  const row = await env.DB.prepare("SELECT user_id FROM account_friends WHERE user_id = ? AND friend_id = ?").bind(a, b).first();
  return !!row;
}

async function peerCard(env, request, publicId, deps) {
  const row = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, location, website, owner, created_at, hide_avatar, avatar_empty, banner_empty, private_follows, profile_less FROM accounts WHERE public_id = ?").bind(publicId).first();
  if (!row) return { publicId, handle: "", name: "", avatar: "" };
  try {
    const account = await deps.presentAccount(env, request, row, false);
    return {
      publicId: account.publicId,
      handle: account.handle || "",
      name: account.displayName || "",
      avatar: account.avatar || ""
    };
  } catch (err) {
    return { publicId, handle: row.handle || "", name: row.display_name || "", avatar: "" };
  }
}

async function loadConversation(env, id) {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare("SELECT id, sender_id, recipient_id, created_at, updated_at FROM dm_conversations WHERE id = ?").bind(id).first();
}

function participant(conv, publicId) {
  return !!(conv && (conv.sender_id === publicId || conv.recipient_id === publicId));
}

function otherId(conv, publicId) {
  return conv.sender_id === publicId ? conv.recipient_id : conv.sender_id;
}

async function lastMessage(env, conversationId) {
  return env.DB.prepare("SELECT id, sender_id, body, created_at FROM dm_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1").bind(conversationId).first();
}

function messageJson(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at
  };
}

async function conversationJson(env, request, conv, viewerId, deps) {
  const last = await lastMessage(env, conv.id);
  return {
    id: conv.id,
    updatedAt: conv.updated_at,
    peer: await peerCard(env, request, otherId(conv, viewerId), deps),
    last: last ? messageJson(last) : null
  };
}

async function listConversations(env, request, viewer, deps) {
  const rows = await env.DB.prepare("SELECT id, sender_id, recipient_id, created_at, updated_at FROM dm_conversations WHERE sender_id = ? OR recipient_id = ? ORDER BY updated_at DESC LIMIT 50").bind(viewer.public_id, viewer.public_id).all();
  const list = (rows && rows.results) || [];
  const conversations = [];
  for (let i = 0; i < list.length; i++) conversations.push(await conversationJson(env, request, list[i], viewer.public_id, deps));
  return deps.json(200, { conversations });
}

async function readConversation(env, request, viewer, id, deps) {
  const conv = await loadConversation(env, id);
  if (!participant(conv, viewer.public_id)) return deps.json(404, { error: "not_found" });
  const rows = await env.DB.prepare("SELECT id, sender_id, body, created_at FROM dm_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200").bind(id).all();
  const messages = ((rows && rows.results) || []).map(messageJson);
  return deps.json(200, {
    id: conv.id,
    updatedAt: conv.updated_at,
    peer: await peerCard(env, request, otherId(conv, viewer.public_id), deps),
    messages
  });
}

async function insertMessage(env, conv, senderId, text, now) {
  const recipientId = otherId(conv, senderId);
  const id = newId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO dm_messages (id, conversation_id, sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, conv.id, senderId, recipientId, text, now),
    env.DB.prepare("UPDATE dm_conversations SET updated_at = ? WHERE id = ?").bind(now, conv.id)
  ]);
  conv.updated_at = now;
  return { id, sender_id: senderId, body: text, created_at: now };
}

async function sendToTarget(env, request, viewer, body, deps) {
  const targetId = cleanPeerId(body.targetId || body.id);
  if (!targetId || targetId === viewer.public_id) return deps.json(400, { error: "bad_target" });
  const text = cleanBody(body.text);
  if (text == null) return deps.json(400, { error: "too_long" });
  if (!text) return deps.json(400, { error: "empty" });
  const target = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(targetId).first();
  if (!target) return deps.json(404, { error: "not_found" });
  if (!(await areFriends(env, viewer.public_id, targetId))) return deps.json(403, { error: "not_friends" });
  const paced = await deps.rateHit(env, "dm:" + viewer.public_id, 40, 10 * 60 * 1000);
  if (!paced.ok) return deps.limited(paced);
  const [low, high] = pair(viewer.public_id, targetId);
  let conv = await env.DB.prepare("SELECT id, sender_id, recipient_id, created_at, updated_at FROM dm_conversations WHERE sender_id = ? AND recipient_id = ?").bind(low, high).first();
  const now = Date.now();
  if (!conv) {
    conv = { id: newId(), sender_id: low, recipient_id: high, created_at: now, updated_at: now };
    await env.DB.prepare("INSERT INTO dm_conversations (id, sender_id, recipient_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(conv.id, low, high, now, now).run();
  }
  const message = await insertMessage(env, conv, viewer.public_id, text, now);
  return deps.json(200, {
    ok: true,
    conversation: await conversationJson(env, request, conv, viewer.public_id, deps),
    message: messageJson(message)
  });
}

async function sendToConversation(env, request, viewer, id, body, deps) {
  const text = cleanBody(body.text);
  if (text == null) return deps.json(400, { error: "too_long" });
  if (!text) return deps.json(400, { error: "empty" });
  const conv = await loadConversation(env, id);
  if (!participant(conv, viewer.public_id)) return deps.json(404, { error: "not_found" });
  if (!(await areFriends(env, viewer.public_id, otherId(conv, viewer.public_id)))) return deps.json(403, { error: "not_friends" });
  const paced = await deps.rateHit(env, "dm:" + viewer.public_id, 40, 10 * 60 * 1000);
  if (!paced.ok) return deps.limited(paced);
  const message = await insertMessage(env, conv, viewer.public_id, text, Date.now());
  return deps.json(200, {
    ok: true,
    conversation: await conversationJson(env, request, conv, viewer.public_id, deps),
    message: messageJson(message)
  });
}

export async function handleMessagesRoute(request, env, path, url, deps) {
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return deps.json(401, { error: "unauthorized" });
  const rest = path.slice("/v1/messages".length);
  const id = rest.startsWith("/") ? rest.slice(1) : "";
  if (request.method === "GET" && !id) return listConversations(env, request, viewer, deps);
  if (request.method === "GET" && id) return readConversation(env, request, viewer, id, deps);
  if (request.method === "POST") {
    const body = await deps.readJson(request, 24000);
    if (body.error) return deps.json(400, { error: body.error });
    if (!id) return sendToTarget(env, request, viewer, body, deps);
    return sendToConversation(env, request, viewer, id, body, deps);
  }
  return deps.json(405, { error: "method" });
}
