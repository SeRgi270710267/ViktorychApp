/* Native Messages servers: Discord-style servers that live in our own app.
   Only an app owner (accounts.owner = 1) can create a server for now.
   Anyone with an invite can join; what they can do follows their roles.

   Members never see each other's account ids. Each membership has a stable
   member id (an HMAC of server and account), used for authors, mentions,
   reactions and moderation. Cards (name, handle, avatar) go through the same
   per-viewer avatar privacy as profiles.

   Realtime: one "srv:<serverId>" object on AccountChannel (servers-room.js).
   Writes go to D1 first, then one event goes to the room. Mentions also go to
   the account channel topic "srv" and to notifications.

   Moderator deletes leave a visible "removed by a moderator" stub and a mod
   log row that every member can read (removed text: moderators only). Authors deleting their own messages
   remove them fully. Attachments are stored as uploaded and never re-encoded. */

import {
  PERM, ALL_PERMS, DEFAULT_EVERYONE, cleanPerms, basePerms, channelPerms, has,
  parseMentions, emojiTokens, cleanReaction, topPosition, messageId
} from "../../shared/server-perms.js";
import { roomPost, roomOnline, roomStub } from "./servers-room.js";

export const SERVERS_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS srv_servers (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon_key TEXT NOT NULL DEFAULT '', banner_key TEXT NOT NULL DEFAULT '', member_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS srv_channels (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', parent_id TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, slowmode INTEGER NOT NULL DEFAULT 0, last_message_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS srv_channels_server ON srv_channels(server_id, position)",
  "CREATE TABLE IF NOT EXISTS srv_roles (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, perms INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, hoist INTEGER NOT NULL DEFAULT 0, mentionable INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS srv_roles_server ON srv_roles(server_id, position)",
  "CREATE TABLE IF NOT EXISTS srv_members (server_id TEXT NOT NULL, account_id TEXT NOT NULL, mid TEXT NOT NULL, nick TEXT NOT NULL DEFAULT '', joined_at INTEGER NOT NULL, timeout_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (server_id, account_id))",
  "CREATE UNIQUE INDEX IF NOT EXISTS srv_members_mid ON srv_members(server_id, mid)",
  "CREATE INDEX IF NOT EXISTS srv_members_account ON srv_members(account_id)",
  "CREATE TABLE IF NOT EXISTS srv_member_roles (server_id TEXT NOT NULL, account_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (server_id, account_id, role_id))",
  "CREATE INDEX IF NOT EXISTS srv_member_roles_role ON srv_member_roles(role_id)",
  "CREATE TABLE IF NOT EXISTS srv_overrides (channel_id TEXT NOT NULL, server_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, allow INTEGER NOT NULL DEFAULT 0, deny INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (channel_id, target_type, target_id))",
  "CREATE INDEX IF NOT EXISTS srv_overrides_server ON srv_overrides(server_id)",
  "CREATE TABLE IF NOT EXISTS srv_bans (server_id TEXT NOT NULL, account_id TEXT NOT NULL, mid TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', by_mid TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (server_id, account_id))",
  "CREATE TABLE IF NOT EXISTS srv_invites (code TEXT PRIMARY KEY, server_id TEXT NOT NULL, by_mid TEXT NOT NULL, max_uses INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS srv_invites_server ON srv_invites(server_id, created_at)",
  "CREATE TABLE IF NOT EXISTS srv_messages (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, author_mid TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', reply_to TEXT NOT NULL DEFAULT '', attachments TEXT NOT NULL DEFAULT '', mentions TEXT NOT NULL DEFAULT '', flags INTEGER NOT NULL DEFAULT 0, edited_at INTEGER NOT NULL DEFAULT 0, removed_by TEXT NOT NULL DEFAULT '', removed_at INTEGER NOT NULL DEFAULT 0, removed_reason TEXT NOT NULL DEFAULT '', pinned_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS srv_messages_channel ON srv_messages(channel_id, id)",
  "CREATE INDEX IF NOT EXISTS srv_messages_author ON srv_messages(channel_id, author_id, id)",
  "CREATE INDEX IF NOT EXISTS srv_messages_server ON srv_messages(server_id, id)",
  "CREATE TABLE IF NOT EXISTS srv_reactions (message_id TEXT NOT NULL, emoji TEXT NOT NULL, mid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (message_id, emoji, mid))",
  "CREATE TABLE IF NOT EXISTS srv_emojis (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, by_mid TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS srv_emojis_server ON srv_emojis(server_id)",
  "CREATE TABLE IF NOT EXISTS srv_reads (account_id TEXT NOT NULL, channel_id TEXT NOT NULL, server_id TEXT NOT NULL, last_read TEXT NOT NULL DEFAULT '', mentions INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account_id, channel_id))",
  "CREATE INDEX IF NOT EXISTS srv_reads_server ON srv_reads(account_id, server_id)",
  "CREATE TABLE IF NOT EXISTS srv_notify (account_id TEXT NOT NULL, scope_id TEXT NOT NULL, level TEXT NOT NULL, PRIMARY KEY (account_id, scope_id))",
  "CREATE TABLE IF NOT EXISTS srv_modlog (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL, actor_mid TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS srv_modlog_server ON srv_modlog(server_id, id)"
];

const HEX16 = /^[a-f0-9]{16}$/;
const MSG_ID = /^[0-9a-z]{16}$/;
const ACCOUNT = /^\d{12}$/;
const INVITE = /^[A-Za-z0-9]{6,16}$/;
const KINDS = ["category", "text", "announcement"];
const LEVELS = ["all", "mentions", "none"];
const BODY_MAX = 4000;
const ATTACH_MAX = 10;
const FILE_MAX = 50 * 1024 * 1024;
const IMAGE_MAX = 8 * 1024 * 1024;
const EMOJI_MAX = 512 * 1024;
const PINS_MAX = 50;
const ROLES_MAX = 100;
const CHANNELS_MAX = 200;
const EMOJIS_MAX = 100;
const SERVERS_MAX = 50;
const PUSH_CAP = 25;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|heic|heif)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp4|ogg|wav|webm|aac|flac|x-m4a))$/;

const floods = new Map();
const cardCache = new Map();

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(n) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

function randomCode(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function randomBase36(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function b64url(bytes) {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value) {
  const sig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return hex(new Uint8Array(sig));
}

function clip(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function cleanName(value, kind) {
  let name = clip(value, 100).replace(/\s+/g, " ");
  if (kind === "text" || kind === "announcement") name = name.toLowerCase().replace(/ /g, "-").replace(/-+/g, "-");
  return name;
}

function cleanColor(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(0xffffff, Math.floor(n)));
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); }
  catch (err) { return fallback; }
}

function rows(res) {
  return (res && res.results) || [];
}

function pepper(env) {
  return String(env.ACCOUNT_PEPPER || env.SESSION_PEPPER || "srv");
}

async function memberIdFor(deps, env, serverId, accountId) {
  return (await deps.hmacHex(pepper(env), "srvm:" + serverId + ":" + accountId)).slice(0, 16);
}

/* Per-isolate flood guard so sending costs no D1 writes for rate limits. */
function floodOk(key, limit, windowMs) {
  const now = Date.now();
  const entry = floods.get(key);
  if (!entry || now - entry.at > windowMs) {
    floods.set(key, { at: now, n: 1 });
    if (floods.size > 5000) floods.clear();
    return true;
  }
  entry.n += 1;
  return entry.n <= limit;
}

/* ---------- context: everything needed for permission checks ---------- */

async function loadContext(env, serverId, accountId) {
  if (!HEX16.test(serverId)) return null;
  const res = await env.DB.batch([
    env.DB.prepare("SELECT * FROM srv_servers WHERE id = ?").bind(serverId),
    env.DB.prepare("SELECT * FROM srv_channels WHERE server_id = ? ORDER BY position, created_at").bind(serverId),
    env.DB.prepare("SELECT * FROM srv_roles WHERE server_id = ? ORDER BY position DESC").bind(serverId),
    env.DB.prepare("SELECT * FROM srv_members WHERE server_id = ? AND account_id = ?").bind(serverId, accountId || ""),
    env.DB.prepare("SELECT role_id FROM srv_member_roles WHERE server_id = ? AND account_id = ?").bind(serverId, accountId || ""),
    env.DB.prepare("SELECT * FROM srv_overrides WHERE server_id = ?").bind(serverId)
  ]);
  const server = rows(res[0])[0];
  if (!server) return null;
  const roles = new Map();
  rows(res[2]).forEach((r) => roles.set(r.id, r));
  const member = rows(res[3])[0] || null;
  const memberRoles = rows(res[4]).map((r) => r.role_id).filter((id) => roles.has(id));
  const overrides = new Map();
  rows(res[5]).forEach((o) => {
    if (!overrides.has(o.channel_id)) overrides.set(o.channel_id, []);
    overrides.get(o.channel_id).push(o);
  });
  const channels = rows(res[1]);
  const byId = new Map(channels.map((c) => [c.id, c]));
  const ctx = {
    server, roles, member, memberRoles, overrides, channels, byId,
    accountId: accountId || "",
    isOwner: !!member && server.owner_id === accountId,
    mid: member ? member.mid : ""
  };
  ctx.base = member ? basePerms({ isOwner: ctx.isOwner, roles, everyoneId: serverId, memberRoles }) : 0;
  ctx.timedOut = !!member && Number(member.timeout_until) > Date.now() && !ctx.isOwner && !has(ctx.base, PERM.ADMIN);
  ctx.top = ctx.isOwner ? Infinity : topPosition(roles, memberRoles);
  ctx.perms = function (channelId) { return permsFor(ctx, channelId, null); };
  return ctx;
}

function layersFor(ctx, channel) {
  const out = [];
  if (!channel) return out;
  if (channel.parent_id && ctx.byId.has(channel.parent_id)) out.push(ctx.overrides.get(channel.parent_id) || []);
  out.push(ctx.overrides.get(channel.id) || []);
  return out;
}

/* perms for the context member, or for another member {mid, roles, owner, timeout}. */
function permsFor(ctx, channelId, other) {
  const who = other || { mid: ctx.mid, roles: ctx.memberRoles, owner: ctx.isOwner, timedOut: ctx.timedOut, base: ctx.base };
  if (!other && !ctx.member) return 0;
  const base = who.base != null ? who.base : basePerms({ isOwner: who.owner, roles: ctx.roles, everyoneId: ctx.server.id, memberRoles: who.roles });
  if (!channelId) return base;
  const channel = ctx.byId.get(channelId);
  if (!channel) return 0;
  if (who.owner || has(base, PERM.ADMIN)) return ALL_PERMS;
  return channelPerms(base, {
    layers: layersFor(ctx, channel),
    everyoneId: ctx.server.id,
    memberRoles: who.roles,
    accountId: who.mid,
    timedOut: who.timedOut
  });
}

function visibleChannels(ctx) {
  return ctx.channels.filter((c) => has(ctx.perms(c.id), PERM.VIEW));
}

/* ---------- presenters ---------- */

function publicFile(request, key) {
  if (!key) return "";
  return new URL("/v1/servers/pub?k=" + encodeURIComponent(key), request.url).toString();
}

async function signedFile(env, deps, request, key) {
  const day = 86400000;
  const exp = Math.floor(Date.now() / day) * day + 2 * day;
  const sig = (await deps.hmacHex(pepper(env), "srvf:" + key + ":" + exp)).slice(0, 32);
  return new URL("/v1/servers/file?k=" + encodeURIComponent(key) + "&e=" + exp + "&s=" + sig, request.url).toString();
}

function presentServer(request, s, extra) {
  return Object.assign({
    id: s.id,
    name: s.name,
    description: s.description || "",
    icon: publicFile(request, s.icon_key),
    banner: publicFile(request, s.banner_key),
    memberCount: Number(s.member_count) || 0,
    createdAt: s.created_at
  }, extra || {});
}

function presentChannel(c, perms, read) {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    topic: c.topic || "",
    parentId: c.parent_id || "",
    position: Number(c.position) || 0,
    slowmode: Number(c.slowmode) || 0,
    lastId: c.last_message_id || "",
    perms: perms,
    lastRead: read ? read.last_read || "" : "",
    mentions: read ? Number(read.mentions) || 0 : 0
  };
}

function presentRole(r) {
  return {
    id: r.id,
    name: r.name,
    color: Number(r.color) || 0,
    perms: Number(r.perms) || 0,
    position: Number(r.position) || 0,
    hoist: r.hoist === 1,
    mentionable: r.mentionable === 1
  };
}

function presentOverride(o) {
  return { type: o.target_type, id: o.target_id, allow: Number(o.allow) || 0, deny: Number(o.deny) || 0 };
}

async function presentMessages(env, deps, request, list, viewerMid, ctx) {
  if (!list.length) return [];
  const ids = list.map((m) => m.id);
  const marks = ids.map(() => "?").join(",");
  const rx = rows(await env.DB.prepare(
    "SELECT message_id, emoji, COUNT(*) AS n, MAX(CASE WHEN mid = ? THEN 1 ELSE 0 END) AS me, MIN(at) AS first FROM srv_reactions WHERE message_id IN (" + marks + ") GROUP BY message_id, emoji ORDER BY first"
  ).bind(viewerMid || "", ...ids).all());
  const byMsg = new Map();
  rx.forEach((r) => {
    if (!byMsg.has(r.message_id)) byMsg.set(r.message_id, []);
    byMsg.get(r.message_id).push({ e: r.emoji, n: Number(r.n) || 0, me: Number(r.me) === 1 });
  });
  const replyIds = list.map((m) => m.reply_to).filter((id) => id && ids.indexOf(id) < 0);
  const replies = new Map();
  list.forEach((m) => replies.set(m.id, m));
  if (replyIds.length) {
    const uniq = Array.from(new Set(replyIds)).slice(0, 100);
    rows(await env.DB.prepare(
      "SELECT id, author_mid, body, attachments, removed_at, flags FROM srv_messages WHERE id IN (" + uniq.map(() => "?").join(",") + ")"
    ).bind(...uniq).all()).forEach((m) => replies.set(m.id, m));
  }
  const out = [];
  for (const m of list) {
    /* Removed text is only shown to people who could have removed it. */
    const seeRemoved = !!ctx && Number(m.removed_at) > 0 && has(ctx.perms(m.channel_id), PERM.MANAGE_MESSAGES);
    out.push(await presentMessage(env, deps, request, m, byMsg.get(m.id) || [], replies, seeRemoved));
  }
  return out;
}

async function presentAttachments(env, deps, request, raw) {
  const list = parseJson(raw, []);
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || !a.k) continue;
    out.push({ url: await signedFile(env, deps, request, a.k), name: a.n || "", type: a.t || "", size: Number(a.s) || 0, w: Number(a.w) || 0, h: Number(a.h) || 0 });
  }
  return out;
}

async function presentMessage(env, deps, request, m, reactions, replies, seeRemoved) {
  const removed = Number(m.removed_at) > 0;
  const msg = {
    id: m.id,
    c: m.channel_id,
    a: m.author_mid,
    b: removed ? "" : m.body,
    f: Number(m.flags) || 0,
    e: Number(m.edited_at) || 0,
    p: Number(m.pinned_at) || 0,
    t: Number(m.created_at) || 0,
    rx: removed ? [] : reactions || [],
    mn: parseJson(m.mentions, { u: [], r: [], e: false }),
    at: removed ? [] : await presentAttachments(env, deps, request, m.attachments)
  };
  if (removed) msg.x = { by: m.removed_by, at: Number(m.removed_at), reason: m.removed_reason || "" };
  if (removed && seeRemoved && m.body) msg.x.text = m.body;
  if (m.reply_to) {
    const src = replies && replies.get(m.reply_to);
    msg.r = src
      ? { id: src.id, a: src.author_mid, b: Number(src.removed_at) > 0 ? "" : clip(src.body, 160), x: Number(src.removed_at) > 0, f: !!parseJson(src.attachments, []).length }
      : { id: m.reply_to, gone: true };
  }
  return msg;
}

async function cardFor(env, deps, request, viewer, accountId) {
  const key = viewer.public_id + ":" + accountId;
  const hit = cardCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.card;
  let card = null;
  try { card = await deps.card(env, request, accountId, viewer); }
  catch (err) { card = null; }
  if (cardCache.size > 3000) cardCache.clear();
  cardCache.set(key, { at: Date.now(), card });
  return card;
}

/* ---------- helpers for writes ---------- */

function modlog(env, ctx, action, target, detail) {
  return env.DB.prepare("INSERT INTO srv_modlog (server_id, actor_mid, action, target, detail, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(ctx.server.id, ctx.mid || "", action, String(target || ""), clip(typeof detail === "string" ? detail : JSON.stringify(detail || {}), 600), Date.now());
}

function later(deps, job) {
  const p = Promise.resolve(job).catch(() => {});
  if (deps.waitUntil) deps.waitUntil(p);
  return p;
}

function emit(env, deps, serverId, channelId, event) {
  return later(deps, roomPost(env, serverId, "/event", { c: channelId || "", e: event }));
}

function resync(env, deps, serverId, accountId) {
  return later(deps, roomPost(env, serverId, "/resync", accountId ? { a: accountId } : {}));
}

function canActOn(ctx, target) {
  if (ctx.isOwner) return target.account_id !== ctx.accountId;
  if (target.account_id === ctx.server.owner_id) return false;
  if (target.account_id === ctx.accountId) return false;
  return ctx.top > target.top;
}

async function memberByMid(env, ctx, mid) {
  if (!HEX16.test(String(mid || ""))) return null;
  const m = await env.DB.prepare("SELECT * FROM srv_members WHERE server_id = ? AND mid = ?").bind(ctx.server.id, mid).first();
  if (!m) return null;
  const roleIds = rows(await env.DB.prepare("SELECT role_id FROM srv_member_roles WHERE server_id = ? AND account_id = ?").bind(ctx.server.id, m.account_id).all()).map((r) => r.role_id).filter((id) => ctx.roles.has(id));
  m.roles = roleIds;
  m.top = m.account_id === ctx.server.owner_id ? Infinity : topPosition(ctx.roles, roleIds);
  return m;
}

function err(deps, status, code, extra) {
  return deps.json(status, Object.assign({ error: code }, extra || {}));
}

async function body(deps, request, max) {
  const b = await deps.readJson(request, max || 16000);
  return b && typeof b === "object" ? b : {};
}

/* ---------- route entry ---------- */

export async function handleServers(request, env, path, url, deps) {
  if (!path.startsWith("/v1/servers")) return null;
  const parts = path.split("/").slice(3).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  const method = request.method;

  if (parts[0] === "pub" && method === "GET") return servePublic(request, env, url);
  if (parts[0] === "file" && method === "GET") return serveFile(request, env, url, deps);
  if (parts[0] === "invite" && parts[1]) {
    if (parts.length === 2 && method === "GET") return invitePreview(request, env, deps, parts[1]);
    if (parts[2] === "join" && method === "POST") return inviteJoin(request, env, deps, parts[1]);
    return err(deps, 404, "not_found");
  }
  if (parts[0] === "ws" && method === "GET") return socket(request, env, url, deps);

  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return err(deps, 401, "unauthorized");
  if (!ACCOUNT.test(String(viewer.public_id || ""))) return err(deps, 403, "account");

  if (!parts.length || parts[0] === "") {
    if (method === "GET") return listServers(request, env, deps, viewer);
    if (method === "POST") return createServer(request, env, deps, viewer);
    return err(deps, 405, "method");
  }
  const sid = parts[0];
  if (!HEX16.test(sid)) return err(deps, 404, "not_found");
  const ctx = await loadContext(env, sid, viewer.public_id);
  if (!ctx) return err(deps, 404, "not_found");
  if (!ctx.member) return err(deps, 403, "not_member");
  ctx.viewer = viewer;
  const rest = parts.slice(1);
  const a = rest[0] || "";

  if (!a) {
    if (method === "GET") return serverState(request, env, deps, ctx);
    if (method === "PATCH") return patchServer(request, env, deps, ctx);
    if (method === "DELETE") return deleteServer(request, env, deps, ctx);
    return err(deps, 405, "method");
  }
  if (a === "upload" && method === "POST") return upload(request, env, url, deps, ctx);
  if (a === "ticket" && method === "POST") return ticket(env, deps, ctx);
  if (a === "cards" && method === "GET") return cards(request, env, url, deps, ctx);
  if (a === "notify" && method === "PUT") return setNotify(request, env, deps, ctx);
  if (a === "search" && method === "GET") return search(request, env, url, deps, ctx);
  if (a === "modlog" && method === "GET") return modlogList(env, url, deps, ctx);
  if (a === "leave" && method === "POST") return leave(env, deps, ctx);
  if (a === "emojis" && rest[1] && method === "DELETE") return deleteEmoji(env, deps, ctx, rest[1]);
  if (a === "invites") {
    if (!rest[1] && method === "GET") return listInvites(env, deps, ctx);
    if (!rest[1] && method === "POST") return createInvite(request, env, deps, ctx);
    if (rest[1] && method === "DELETE") return revokeInvite(env, deps, ctx, rest[1]);
  }
  if (a === "bans") {
    if (!rest[1] && method === "GET") return listBans(request, env, deps, ctx);
    if (!rest[1] && method === "POST") return ban(request, env, deps, ctx);
    if (rest[1] && method === "DELETE") return unban(env, deps, ctx, rest[1]);
  }
  if (a === "members") {
    if (!rest[1] && method === "GET") return listMembers(request, env, url, deps, ctx);
    if (rest[1] && !rest[2] && method === "PATCH") return patchMember(request, env, deps, ctx, rest[1]);
    if (rest[1] && !rest[2] && method === "DELETE") return kick(request, env, url, deps, ctx, rest[1]);
    if (rest[1] && rest[2] === "timeout" && method === "POST") return timeout(request, env, deps, ctx, rest[1]);
  }
  if (a === "roles") {
    if (rest[1] === "order" && method === "PUT") return orderRoles(request, env, deps, ctx);
    if (!rest[1] && method === "POST") return createRole(request, env, deps, ctx);
    if (rest[1] && method === "PATCH") return patchRole(request, env, deps, ctx, rest[1]);
    if (rest[1] && method === "DELETE") return deleteRole(env, deps, ctx, rest[1]);
  }
  if (a === "channels") {
    if (rest[1] === "order" && method === "PUT") return orderChannels(request, env, deps, ctx);
    if (!rest[1] && method === "POST") return createChannel(request, env, deps, ctx);
    const cid = rest[1] || "";
    if (!HEX16.test(cid) || !ctx.byId.has(cid)) return err(deps, 404, "channel");
    const channel = ctx.byId.get(cid);
    const perms = ctx.perms(cid);
    if (!has(perms, PERM.VIEW)) return err(deps, 404, "channel");
    const b = rest[2] || "";
    if (!b && method === "PATCH") return patchChannel(request, env, deps, ctx, channel);
    if (!b && method === "DELETE") return deleteChannel(env, deps, ctx, channel);
    if (b === "overrides" && rest[3] && rest[4]) {
      if (method === "PUT") return putOverride(request, env, deps, ctx, channel, rest[3], rest[4]);
      if (method === "DELETE") return deleteOverride(env, deps, ctx, channel, rest[3], rest[4]);
    }
    if (b === "read" && method === "POST") return markRead(request, env, deps, ctx, channel);
    if (b === "pins") {
      if (!rest[3] && method === "GET") return listPins(request, env, deps, ctx, channel);
      if (rest[3] && method === "PUT") return pin(env, deps, ctx, channel, rest[3], true);
      if (rest[3] && method === "DELETE") return pin(env, deps, ctx, channel, rest[3], false);
    }
    if (b === "messages") {
      if (!rest[3] && method === "GET") return listMessages(request, env, url, deps, ctx, channel);
      if (!rest[3] && method === "POST") return sendMessage(request, env, deps, ctx, channel);
      const mid = rest[3] || "";
      if (!MSG_ID.test(mid)) return err(deps, 404, "message");
      if (!rest[4] && method === "PATCH") return editMessage(request, env, deps, ctx, channel, mid);
      if (!rest[4] && method === "DELETE") return deleteMessage(request, env, url, deps, ctx, channel, mid);
      if (rest[4] === "reactions" && rest[5]) {
        if (method === "PUT") return react(env, deps, ctx, channel, mid, rest[5], true);
        if (method === "DELETE") return react(env, deps, ctx, channel, mid, rest[5], false);
      }
    }
  }
  return err(deps, 404, "not_found");
}

/* ---------- servers ---------- */

async function listServers(request, env, deps, viewer) {
  const list = rows(await env.DB.prepare(
    "SELECT s.* FROM srv_members m JOIN srv_servers s ON s.id = m.server_id WHERE m.account_id = ? ORDER BY m.joined_at"
  ).bind(viewer.public_id).all());
  const out = [];
  for (const s of list) {
    const ctx = await loadContext(env, s.id, viewer.public_id);
    if (!ctx || !ctx.member) continue;
    const reads = new Map(rows(await env.DB.prepare("SELECT channel_id, last_read, mentions FROM srv_reads WHERE account_id = ? AND server_id = ?").bind(viewer.public_id, s.id).all()).map((r) => [r.channel_id, r]));
    const notify = await notifyMap(env, viewer.public_id, [s.id].concat(ctx.channels.map((c) => c.id)));
    const channels = visibleChannels(ctx).map((c) => presentChannel(c, ctx.perms(c.id), reads.get(c.id)));
    out.push(presentServer(request, s, {
      owner: ctx.isOwner,
      channels: channels,
      notify: notify,
      lastId: channels.reduce((best, c) => (c.lastId > best ? c.lastId : best), "")
    }));
  }
  return deps.json(200, { servers: out, canCreate: viewer.owner === 1 });
}

async function notifyMap(env, accountId, scopes) {
  if (!scopes.length) return {};
  const out = {};
  const chunk = scopes.slice(0, 90);
  rows(await env.DB.prepare("SELECT scope_id, level FROM srv_notify WHERE account_id = ? AND scope_id IN (" + chunk.map(() => "?").join(",") + ")").bind(accountId, ...chunk).all())
    .forEach((r) => { out[r.scope_id] = r.level; });
  return out;
}

async function createServer(request, env, deps, viewer) {
  if (viewer.owner !== 1) return err(deps, 403, "owner_only");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const name = clip(b.name, 100);
  if (!name) return err(deps, 400, "name");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM srv_servers WHERE owner_id = ?").bind(viewer.public_id).first();
  if (Number(count && count.n) >= SERVERS_MAX) return err(deps, 400, "too_many");
  const now = Date.now();
  const sid = randomHex(8);
  const cat = randomHex(8);
  const general = randomHex(8);
  const news = randomHex(8);
  const mid = await memberIdFor(deps, env, sid, viewer.public_id);
  const st = [
    env.DB.prepare("INSERT INTO srv_servers (id, owner_id, name, description, member_count, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").bind(sid, viewer.public_id, name, clip(b.description, 500), now, now),
    env.DB.prepare("INSERT INTO srv_roles (id, server_id, name, color, perms, position, created_at) VALUES (?, ?, '@everyone', 0, ?, 0, ?)").bind(sid, sid, DEFAULT_EVERYONE, now),
    env.DB.prepare("INSERT INTO srv_members (server_id, account_id, mid, joined_at) VALUES (?, ?, ?, ?)").bind(sid, viewer.public_id, mid, now),
    env.DB.prepare("INSERT INTO srv_channels (id, server_id, kind, name, position, created_at) VALUES (?, ?, 'category', ?, 0, ?)").bind(cat, sid, clip(b.categoryName, 100) || "Text channels", now),
    env.DB.prepare("INSERT INTO srv_channels (id, server_id, kind, name, parent_id, position, created_at) VALUES (?, ?, 'announcement', ?, ?, 1, ?)").bind(news, sid, cleanName(b.announcementName || "announcements", "text"), cat, now),
    env.DB.prepare("INSERT INTO srv_channels (id, server_id, kind, name, parent_id, position, created_at) VALUES (?, ?, 'text', ?, ?, 0, ?)").bind(general, sid, cleanName(b.generalName || "general", "text"), cat, now),
    env.DB.prepare("INSERT INTO srv_overrides (channel_id, server_id, target_type, target_id, allow, deny) VALUES (?, ?, 'role', ?, 0, ?)").bind(news, sid, sid, PERM.SEND)
  ];
  await env.DB.batch(st);
  const ctx = await loadContext(env, sid, viewer.public_id);
  await modlog(env, ctx, "server_create", sid, { name }).run();
  return deps.json(200, { ok: true, server: presentServer(request, ctx.server, { owner: true }), channelId: general });
}

async function serverState(request, env, deps, ctx) {
  const sid = ctx.server.id;
  const [reads, emojis, notify] = await Promise.all([
    env.DB.prepare("SELECT channel_id, last_read, mentions FROM srv_reads WHERE account_id = ? AND server_id = ?").bind(ctx.accountId, sid).all(),
    env.DB.prepare("SELECT id, name, key FROM srv_emojis WHERE server_id = ? ORDER BY created_at").bind(sid).all(),
    notifyMap(env, ctx.accountId, [sid].concat(ctx.channels.map((c) => c.id)))
  ]);
  const readMap = new Map(rows(reads).map((r) => [r.channel_id, r]));
  const manage = has(ctx.base, PERM.MANAGE_CHANNELS) || has(ctx.base, PERM.MANAGE_ROLES);
  const channels = visibleChannels(ctx).map((c) => {
    const out = presentChannel(c, ctx.perms(c.id), readMap.get(c.id));
    if (manage) out.overrides = (ctx.overrides.get(c.id) || []).map(presentOverride);
    return out;
  });
  return deps.json(200, {
    server: presentServer(request, ctx.server, { owner: ctx.isOwner }),
    channels: channels,
    roles: Array.from(ctx.roles.values()).map(presentRole).sort((x, y) => y.position - x.position),
    emojis: rows(emojis).map((e) => ({ id: e.id, name: e.name, url: publicFile(request, e.key) })),
    notify: notify,
    me: {
      mid: ctx.mid,
      nick: ctx.member.nick || "",
      roles: ctx.memberRoles,
      perms: ctx.base,
      owner: ctx.isOwner,
      timeoutUntil: Number(ctx.member.timeout_until) || 0,
      ownerMid: ctx.isOwner ? ctx.mid : ""
    }
  });
}

async function patchServer(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.MANAGE_SERVER)) return err(deps, 403, "perm");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const sets = [];
  const vals = [];
  const changed = {};
  if (b.name != null) {
    const name = clip(b.name, 100);
    if (!name) return err(deps, 400, "name");
    sets.push("name = ?"); vals.push(name); changed.name = name;
  }
  if (b.description != null) { sets.push("description = ?"); vals.push(clip(b.description, 500)); changed.description = true; }
  if (b.icon === "") { sets.push("icon_key = ''"); changed.icon = "removed"; }
  if (b.banner === "") { sets.push("banner_key = ''"); changed.banner = "removed"; }
  if (!sets.length) return err(deps, 400, "empty");
  sets.push("updated_at = ?"); vals.push(Date.now());
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_servers SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, ctx.server.id),
    modlog(env, ctx, "server_update", ctx.server.id, changed)
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

async function deleteServer(request, env, deps, ctx) {
  if (!ctx.isOwner) return err(deps, 403, "owner_only");
  const sid = ctx.server.id;
  const keys = rows(await env.DB.prepare("SELECT attachments FROM srv_messages WHERE server_id = ? AND attachments != ''").bind(sid).all())
    .reduce((all, m) => all.concat(parseJson(m.attachments, []).map((a) => a && a.k).filter(Boolean)), []);
  const msgIds = "SELECT id FROM srv_messages WHERE server_id = ?";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM srv_reactions WHERE message_id IN (" + msgIds + ")").bind(sid),
    env.DB.prepare("DELETE FROM srv_messages WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_reads WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_notify WHERE scope_id = ? OR scope_id IN (SELECT id FROM srv_channels WHERE server_id = ?)").bind(sid, sid),
    env.DB.prepare("DELETE FROM srv_overrides WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_channels WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_member_roles WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_roles WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_members WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_bans WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_invites WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_emojis WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_modlog WHERE server_id = ?").bind(sid),
    env.DB.prepare("DELETE FROM srv_servers WHERE id = ?").bind(sid)
  ]);
  const extra = [ctx.server.icon_key, ctx.server.banner_key].filter(Boolean);
  later(deps, deleteKeys(env, keys.concat(extra)));
  later(deps, roomPost(env, sid, "/drop", {}));
  return deps.json(200, { ok: true });
}

async function deleteKeys(env, keys) {
  if (!env.DATA || !keys.length) return;
  for (let i = 0; i < keys.length; i += 500) {
    try { await env.DATA.delete(keys.slice(i, i + 500)); }
    catch (e) { /* a missing object is fine */ }
  }
}

/* ---------- files ---------- */

function safeName(value) {
  const name = clip(value, 120).replace(/[\/\\?%*:|"<>]/g, "_").replace(/^\.+/, "");
  return name || "file";
}

function cleanType(value) {
  const t = String(value || "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t.slice(0, 100) : "application/octet-stream";
}

async function upload(request, env, url, deps, ctx) {
  if (!env.DATA) return err(deps, 503, "storage");
  const kind = String(url.searchParams.get("kind") || "a");
  const type = cleanType(request.headers.get("content-type"));
  const len = Number(request.headers.get("content-length") || 0);
  const name = safeName(url.searchParams.get("name"));
  const max = kind === "a" ? FILE_MAX : kind === "emoji" ? EMOJI_MAX : IMAGE_MAX;
  if (len > max) return err(deps, 413, "too_large", { max });
  if (!floodOk("srvup:" + ctx.accountId, 20, 60000)) return err(deps, 429, "rate_limited");
  if (kind === "a") {
    const any = visibleChannels(ctx).some((c) => has(ctx.perms(c.id), PERM.ATTACH));
    if (!any) return err(deps, 403, "perm");
  } else if (kind === "icon" || kind === "banner" || kind === "emoji") {
    if (!has(ctx.base, PERM.MANAGE_SERVER)) return err(deps, 403, "perm");
    if (IMAGE_TYPES.indexOf(type) < 0) return err(deps, 415, "image_only");
  } else return err(deps, 400, "kind");
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return err(deps, 400, "empty");
  if (bytes.byteLength > max) return err(deps, 413, "too_large", { max });
  const sid = ctx.server.id;
  const id = randomHex(8);
  let key;
  if (kind === "a") key = "srv/" + sid + "/a/" + ctx.mid + "/" + id + "/" + name;
  else key = "srv/" + sid + "/" + kind[0] + "/" + id;
  await env.DATA.put(key, bytes, {
    httpMetadata: { contentType: type, cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { name: name, by: ctx.mid }
  });
  if (kind === "icon" || kind === "banner") {
    const col = kind === "icon" ? "icon_key" : "banner_key";
    const old = ctx.server[col];
    await env.DB.batch([
      env.DB.prepare("UPDATE srv_servers SET " + col + " = ?, updated_at = ? WHERE id = ?").bind(key, Date.now(), sid),
      modlog(env, ctx, "server_" + kind, sid, {})
    ]);
    if (old) later(deps, deleteKeys(env, [old]));
    resync(env, deps, sid);
    return deps.json(200, { ok: true, url: publicFile(request, key) });
  }
  if (kind === "emoji") {
    const ename = clip(url.searchParams.get("emoji") || name.replace(/\.[^.]+$/, ""), 32).replace(/[^A-Za-z0-9_]/g, "_");
    if (ename.length < 2) {
      await env.DATA.delete(key);
      return err(deps, 400, "emoji_name");
    }
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM srv_emojis WHERE server_id = ?").bind(sid).first();
    if (Number(count && count.n) >= EMOJIS_MAX) {
      await env.DATA.delete(key);
      return err(deps, 400, "too_many");
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO srv_emojis (id, server_id, name, key, by_mid, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, sid, ename, key, ctx.mid, Date.now()),
      modlog(env, ctx, "emoji_add", id, { name: ename })
    ]);
    resync(env, deps, sid);
    return deps.json(200, { ok: true, emoji: { id, name: ename, url: publicFile(request, key) } });
  }
  return deps.json(200, { ok: true, file: { k: key, n: name, t: type, s: bytes.byteLength } });
}

async function deleteEmoji(env, deps, ctx, eid) {
  if (!has(ctx.base, PERM.MANAGE_SERVER)) return err(deps, 403, "perm");
  const row = await env.DB.prepare("SELECT * FROM srv_emojis WHERE id = ? AND server_id = ?").bind(eid, ctx.server.id).first();
  if (!row) return err(deps, 404, "emoji");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM srv_emojis WHERE id = ?").bind(eid),
    env.DB.prepare("DELETE FROM srv_reactions WHERE emoji = ?").bind("c:" + eid),
    modlog(env, ctx, "emoji_remove", eid, { name: row.name })
  ]);
  later(deps, deleteKeys(env, [row.key]));
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m) return null;
  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);
  if (start == null && end == null) return null;
  if (start == null) { start = Math.max(0, size - end); end = size - 1; }
  if (end == null || end >= size) end = size - 1;
  if (start > end || start >= size) return { bad: true };
  return { offset: start, length: end - start + 1 };
}

async function serveObject(request, env, key, publicMode) {
  if (!env.DATA) return new Response("storage", { status: 503 });
  const head = await env.DATA.head(key);
  if (!head) return new Response("not found", { status: 404 });
  const size = head.size;
  const range = parseRange(request.headers.get("range"), size);
  if (range && range.bad) return new Response("range", { status: 416, headers: { "content-range": "bytes */" + size } });
  const obj = await env.DATA.get(key, range ? { range: range } : {});
  if (!obj) return new Response("not found", { status: 404 });
  const type = (head.httpMetadata && head.httpMetadata.contentType) || "application/octet-stream";
  const inline = INLINE_TYPES.test(type);
  const name = (head.customMetadata && head.customMetadata.name) || "file";
  const headers = new Headers();
  headers.set("content-type", inline ? type : "application/octet-stream");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", publicMode ? "public, max-age=86400" : "private, max-age=86400");
  headers.set("etag", head.httpEtag);
  headers.set("content-disposition", (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(name));
  if (range) {
    headers.set("content-range", "bytes " + range.offset + "-" + (range.offset + range.length - 1) + "/" + size);
    headers.set("content-length", String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(size));
  return new Response(obj.body, { status: 200, headers });
}

async function servePublic(request, env, url) {
  const key = String(url.searchParams.get("k") || "");
  if (!/^srv\/[a-f0-9]{16}\/[ibe]\/[a-f0-9]{16}$/.test(key)) return new Response("not found", { status: 404 });
  return serveObject(request, env, key, true);
}

async function serveFile(request, env, url, deps) {
  const key = String(url.searchParams.get("k") || "");
  const exp = Number(url.searchParams.get("e") || 0);
  const sig = String(url.searchParams.get("s") || "");
  if (!/^srv\/[a-f0-9]{16}\/a\//.test(key) || key.length > 300) return new Response("not found", { status: 404 });
  if (!exp || exp < Date.now()) return new Response("expired", { status: 403 });
  const want = (await deps.hmacHex(pepper(env), "srvf:" + key + ":" + exp)).slice(0, 32);
  if (want !== sig) return new Response("forbidden", { status: 403 });
  return serveObject(request, env, key, false);
}

/* ---------- invites and membership ---------- */

async function listInvites(env, deps, ctx) {
  if (!has(ctx.base, PERM.MANAGE_SERVER) && !has(ctx.base, PERM.CREATE_INVITE)) return err(deps, 403, "perm");
  const all = has(ctx.base, PERM.MANAGE_SERVER);
  const list = rows(await env.DB.prepare(
    "SELECT * FROM srv_invites WHERE server_id = ?" + (all ? "" : " AND by_mid = ?") + " ORDER BY created_at DESC LIMIT 100"
  ).bind(...(all ? [ctx.server.id] : [ctx.server.id, ctx.mid])).all());
  return deps.json(200, { invites: list.map(presentInvite) });
}

function presentInvite(i) {
  return { code: i.code, by: i.by_mid, maxUses: Number(i.max_uses) || 0, uses: Number(i.uses) || 0, expiresAt: Number(i.expires_at) || 0, createdAt: i.created_at };
}

async function createInvite(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.CREATE_INVITE) || ctx.timedOut) return err(deps, 403, "perm");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const maxUses = Math.max(0, Math.min(1000, Math.floor(Number(b.maxUses) || 0)));
  const secs = Math.max(0, Math.min(30 * 86400, Math.floor(Number(b.expiresIn == null ? 7 * 86400 : b.expiresIn) || 0)));
  if (!floodOk("srvinv:" + ctx.accountId, 10, 60000)) return err(deps, 429, "rate_limited");
  const code = randomCode(8);
  const now = Date.now();
  const row = { code, server_id: ctx.server.id, by_mid: ctx.mid, max_uses: maxUses, uses: 0, expires_at: secs ? now + secs * 1000 : 0, created_at: now };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO srv_invites (code, server_id, by_mid, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(code, ctx.server.id, ctx.mid, maxUses, row.expires_at, now),
    modlog(env, ctx, "invite_create", code, { maxUses, expiresIn: secs })
  ]);
  return deps.json(200, { ok: true, invite: presentInvite(row) });
}

async function revokeInvite(env, deps, ctx, code) {
  const row = await env.DB.prepare("SELECT * FROM srv_invites WHERE code = ? AND server_id = ?").bind(code, ctx.server.id).first();
  if (!row) return err(deps, 404, "invite");
  if (row.by_mid !== ctx.mid && !has(ctx.base, PERM.MANAGE_SERVER)) return err(deps, 403, "perm");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM srv_invites WHERE code = ?").bind(code),
    modlog(env, ctx, "invite_revoke", code, {})
  ]);
  return deps.json(200, { ok: true });
}

function inviteUsable(row) {
  if (!row) return "invalid";
  if (Number(row.expires_at) && Number(row.expires_at) < Date.now()) return "expired";
  if (Number(row.max_uses) && Number(row.uses) >= Number(row.max_uses)) return "used_up";
  return "";
}

async function invitePreview(request, env, deps, code) {
  if (!INVITE.test(code)) return err(deps, 404, "invalid");
  const row = await env.DB.prepare("SELECT * FROM srv_invites WHERE code = ?").bind(code).first();
  const bad = inviteUsable(row);
  if (bad) return err(deps, 404, bad);
  const s = await env.DB.prepare("SELECT * FROM srv_servers WHERE id = ?").bind(row.server_id).first();
  if (!s) return err(deps, 404, "invalid");
  let member = false;
  const viewer = await deps.sessionAccount(env, request);
  if (viewer && ACCOUNT.test(String(viewer.public_id || ""))) {
    member = !!(await env.DB.prepare("SELECT 1 AS x FROM srv_members WHERE server_id = ? AND account_id = ?").bind(s.id, viewer.public_id).first());
  }
  return deps.json(200, { server: presentServer(request, s, {}), member, expiresAt: Number(row.expires_at) || 0 });
}

async function firstTextChannel(env, serverId) {
  return env.DB.prepare("SELECT id FROM srv_channels WHERE server_id = ? AND kind = 'text' ORDER BY position, created_at LIMIT 1").bind(serverId).first();
}

async function inviteJoin(request, env, deps, code) {
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return err(deps, 401, "unauthorized");
  if (!ACCOUNT.test(String(viewer.public_id || ""))) return err(deps, 403, "account");
  if (!INVITE.test(code)) return err(deps, 404, "invalid");
  const row = await env.DB.prepare("SELECT * FROM srv_invites WHERE code = ?").bind(code).first();
  const bad = inviteUsable(row);
  if (bad) return err(deps, 404, bad);
  const sid = row.server_id;
  const already = await env.DB.prepare("SELECT mid FROM srv_members WHERE server_id = ? AND account_id = ?").bind(sid, viewer.public_id).first();
  if (already) return deps.json(200, { ok: true, serverId: sid, already: true });
  const banned = await env.DB.prepare("SELECT 1 AS x FROM srv_bans WHERE server_id = ? AND account_id = ?").bind(sid, viewer.public_id).first();
  if (banned) return err(deps, 403, "banned");
  if (!floodOk("srvjoin:" + viewer.public_id, 10, 60000)) return err(deps, 429, "rate_limited");
  const mid = await memberIdFor(deps, env, sid, viewer.public_id);
  const now = Date.now();
  const general = await firstTextChannel(env, sid);
  const st = [
    env.DB.prepare("INSERT OR IGNORE INTO srv_members (server_id, account_id, mid, joined_at) VALUES (?, ?, ?, ?)").bind(sid, viewer.public_id, mid, now),
    env.DB.prepare("UPDATE srv_invites SET uses = uses + 1 WHERE code = ?").bind(code),
    env.DB.prepare("UPDATE srv_servers SET member_count = (SELECT COUNT(*) FROM srv_members WHERE server_id = ?) WHERE id = ?").bind(sid, sid)
  ];
  let sys = null;
  if (general) {
    const id = messageId(now, randomBase36(6));
    sys = { id, server_id: sid, channel_id: general.id, author_id: viewer.public_id, author_mid: mid, body: "", reply_to: "", attachments: "", mentions: "", flags: 1, edited_at: 0, removed_by: "", removed_at: 0, removed_reason: "", pinned_at: 0, created_at: now };
    st.push(env.DB.prepare("INSERT INTO srv_messages (id, server_id, channel_id, author_id, author_mid, flags, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(id, sid, general.id, viewer.public_id, mid, now));
    st.push(env.DB.prepare("UPDATE srv_channels SET last_message_id = ? WHERE id = ?").bind(id, general.id));
  }
  st.push(env.DB.prepare("INSERT INTO srv_modlog (server_id, actor_mid, action, target, detail, at) VALUES (?, ?, 'member_join', ?, ?, ?)").bind(sid, mid, mid, JSON.stringify({ invite: code }), now));
  await env.DB.batch(st);
  emit(env, deps, sid, "", { t: "member", m: mid, on: true });
  if (sys) emit(env, deps, sid, general.id, { t: "msg", m: await presentMessage(env, deps, request, sys, [], null) });
  return deps.json(200, { ok: true, serverId: sid, channelId: general ? general.id : "" });
}

async function leave(env, deps, ctx) {
  if (ctx.isOwner) return err(deps, 400, "owner_cannot_leave");
  await removeMember(env, deps, ctx, ctx.member, "member_leave", "");
  return deps.json(200, { ok: true });
}

async function removeMember(env, deps, ctx, target, action, reason, extra) {
  const sid = ctx.server.id;
  const st = [
    env.DB.prepare("DELETE FROM srv_members WHERE server_id = ? AND account_id = ?").bind(sid, target.account_id),
    env.DB.prepare("DELETE FROM srv_member_roles WHERE server_id = ? AND account_id = ?").bind(sid, target.account_id),
    env.DB.prepare("DELETE FROM srv_reads WHERE server_id = ? AND account_id = ?").bind(sid, target.account_id),
    env.DB.prepare("UPDATE srv_servers SET member_count = (SELECT COUNT(*) FROM srv_members WHERE server_id = ?) WHERE id = ?").bind(sid, sid),
    modlog(env, ctx, action, target.mid, { reason: clip(reason, 300) })
  ].concat(extra && extra.statements ? extra.statements : []);
  await env.DB.batch(st);
  later(deps, roomPost(env, sid, "/drop", { a: target.account_id }));
  emit(env, deps, sid, "", { t: "member", m: target.mid, on: false });
}

async function kick(request, env, url, deps, ctx, mid) {
  if (mid === ctx.mid) return leave(env, deps, ctx);
  if (!has(ctx.base, PERM.KICK)) return err(deps, 403, "perm");
  const target = await memberByMid(env, ctx, mid);
  if (!target) return err(deps, 404, "member");
  if (!canActOn(ctx, target)) return err(deps, 403, "hierarchy");
  await removeMember(env, deps, ctx, target, "member_kick", url.searchParams.get("reason") || "");
  return deps.json(200, { ok: true });
}

async function ban(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.BAN)) return err(deps, 403, "perm");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const target = await memberByMid(env, ctx, b.m);
  if (!target) return err(deps, 404, "member");
  if (!canActOn(ctx, target)) return err(deps, 403, "hierarchy");
  const reason = clip(b.reason, 300);
  const st = [env.DB.prepare("INSERT OR REPLACE INTO srv_bans (server_id, account_id, mid, reason, by_mid, at) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.server.id, target.account_id, target.mid, reason, ctx.mid, Date.now())];
  await removeMember(env, deps, ctx, target, "member_ban", reason, { statements: st });
  return deps.json(200, { ok: true });
}

async function unban(env, deps, ctx, mid) {
  if (!has(ctx.base, PERM.BAN)) return err(deps, 403, "perm");
  const row = await env.DB.prepare("SELECT * FROM srv_bans WHERE server_id = ? AND mid = ?").bind(ctx.server.id, mid).first();
  if (!row) return err(deps, 404, "ban");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM srv_bans WHERE server_id = ? AND mid = ?").bind(ctx.server.id, mid),
    modlog(env, ctx, "member_unban", mid, {})
  ]);
  return deps.json(200, { ok: true });
}

async function listBans(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.BAN)) return err(deps, 403, "perm");
  const list = rows(await env.DB.prepare("SELECT * FROM srv_bans WHERE server_id = ? ORDER BY at DESC LIMIT 200").bind(ctx.server.id).all());
  const out = [];
  for (const b of list) out.push({ m: b.mid, reason: b.reason, by: b.by_mid, at: b.at, card: await cardFor(env, deps, request, ctx.viewer, b.account_id) });
  return deps.json(200, { bans: out });
}

async function timeout(request, env, deps, ctx, mid) {
  if (!has(ctx.base, PERM.MODERATE)) return err(deps, 403, "perm");
  const target = await memberByMid(env, ctx, mid);
  if (!target) return err(deps, 404, "member");
  if (!canActOn(ctx, target)) return err(deps, 403, "hierarchy");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const secs = Math.max(0, Math.min(28 * 86400, Math.floor(Number(b.seconds) || 0)));
  const until = secs ? Date.now() + secs * 1000 : 0;
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_members SET timeout_until = ? WHERE server_id = ? AND account_id = ?").bind(until, ctx.server.id, target.account_id),
    modlog(env, ctx, secs ? "member_timeout" : "member_timeout_clear", target.mid, { seconds: secs, reason: clip(b.reason, 300) })
  ]);
  emit(env, deps, ctx.server.id, "", { t: "member", m: target.mid, timeoutUntil: until });
  resync(env, deps, ctx.server.id, target.account_id);
  return deps.json(200, { ok: true, timeoutUntil: until });
}

async function listMembers(request, env, url, deps, ctx) {
  const after = String(url.searchParams.get("after") || "");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 100)));
  const list = rows(await env.DB.prepare(
    "SELECT * FROM srv_members WHERE server_id = ? AND mid > ? ORDER BY mid LIMIT ?"
  ).bind(ctx.server.id, after, limit).all());
  const roleRows = list.length ? rows(await env.DB.prepare(
    "SELECT account_id, role_id FROM srv_member_roles WHERE server_id = ? AND account_id IN (" + list.map(() => "?").join(",") + ")"
  ).bind(ctx.server.id, ...list.map((m) => m.account_id)).all()) : [];
  const roleMap = new Map();
  roleRows.forEach((r) => {
    if (!roleMap.has(r.account_id)) roleMap.set(r.account_id, []);
    roleMap.get(r.account_id).push(r.role_id);
  });
  const online = new Set(await roomOnline(env, ctx.server.id));
  const out = [];
  for (const m of list) {
    out.push({
      m: m.mid,
      nick: m.nick || "",
      roles: (roleMap.get(m.account_id) || []).filter((id) => ctx.roles.has(id)),
      joinedAt: m.joined_at,
      timeoutUntil: Number(m.timeout_until) || 0,
      owner: m.account_id === ctx.server.owner_id,
      online: online.has(m.mid),
      card: await cardFor(env, deps, request, ctx.viewer, m.account_id)
    });
  }
  return deps.json(200, { members: out, next: list.length === limit ? list[list.length - 1].mid : "" });
}

async function cards(request, env, url, deps, ctx) {
  const mids = String(url.searchParams.get("m") || "").split(",").filter((m) => HEX16.test(m)).slice(0, 50);
  if (!mids.length) return deps.json(200, { cards: {} });
  const list = rows(await env.DB.prepare(
    "SELECT mid, account_id, nick FROM srv_members WHERE server_id = ? AND mid IN (" + mids.map(() => "?").join(",") + ")"
  ).bind(ctx.server.id, ...mids).all());
  const roleRows = list.length ? rows(await env.DB.prepare(
    "SELECT account_id, role_id FROM srv_member_roles WHERE server_id = ? AND account_id IN (" + list.map(() => "?").join(",") + ")"
  ).bind(ctx.server.id, ...list.map((m) => m.account_id)).all()) : [];
  const out = {};
  for (const m of list) {
    const card = await cardFor(env, deps, request, ctx.viewer, m.account_id);
    out[m.mid] = Object.assign({}, card || {}, {
      nick: m.nick || "",
      roles: roleRows.filter((r) => r.account_id === m.account_id && ctx.roles.has(r.role_id)).map((r) => r.role_id),
      owner: m.account_id === ctx.server.owner_id,
      member: true
    });
  }
  /* Authors who left keep a neutral card so old messages still render. */
  const missing = mids.filter((m) => !out[m]);
  if (missing.length) {
    const gone = rows(await env.DB.prepare(
      "SELECT author_mid, MIN(author_id) AS account_id FROM srv_messages WHERE server_id = ? AND author_mid IN (" + missing.map(() => "?").join(",") + ") GROUP BY author_mid"
    ).bind(ctx.server.id, ...missing).all());
    for (const g of gone) {
      const card = await cardFor(env, deps, request, ctx.viewer, g.account_id);
      out[g.author_mid] = Object.assign({}, card || {}, { nick: "", roles: [], member: false });
    }
  }
  return deps.json(200, { cards: out });
}

async function patchMember(request, env, deps, ctx, mid) {
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const self = mid === ctx.mid;
  const target = self ? Object.assign({}, ctx.member, { roles: ctx.memberRoles, top: ctx.top }) : await memberByMid(env, ctx, mid);
  if (!target) return err(deps, 404, "member");
  const st = [];
  const detail = {};
  if (b.nick != null) {
    if (!self && (!has(ctx.base, PERM.MANAGE_ROLES) || !canActOn(ctx, target))) return err(deps, 403, "perm");
    const nick = clip(b.nick, 32);
    st.push(env.DB.prepare("UPDATE srv_members SET nick = ? WHERE server_id = ? AND account_id = ?").bind(nick, ctx.server.id, target.account_id));
    detail.nick = nick;
  }
  if (Array.isArray(b.roles)) {
    if (!has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
    if (!self && !canActOn(ctx, target)) return err(deps, 403, "hierarchy");
    const want = Array.from(new Set(b.roles.filter((id) => ctx.roles.has(id) && id !== ctx.server.id))).slice(0, 50);
    const current = new Set(target.roles);
    const add = want.filter((id) => !current.has(id));
    const drop = target.roles.filter((id) => want.indexOf(id) < 0);
    const touched = add.concat(drop);
    if (!ctx.isOwner && touched.some((id) => Number(ctx.roles.get(id).position) >= ctx.top)) return err(deps, 403, "hierarchy");
    add.forEach((id) => st.push(env.DB.prepare("INSERT OR IGNORE INTO srv_member_roles (server_id, account_id, role_id) VALUES (?, ?, ?)").bind(ctx.server.id, target.account_id, id)));
    drop.forEach((id) => st.push(env.DB.prepare("DELETE FROM srv_member_roles WHERE server_id = ? AND account_id = ? AND role_id = ?").bind(ctx.server.id, target.account_id, id)));
    detail.add = add;
    detail.remove = drop;
  }
  if (!st.length) return err(deps, 400, "empty");
  st.push(modlog(env, ctx, "member_update", target.mid, detail));
  await env.DB.batch(st);
  emit(env, deps, ctx.server.id, "", { t: "member", m: target.mid, update: true });
  if (detail.add || detail.remove) resync(env, deps, ctx.server.id, target.account_id);
  return deps.json(200, { ok: true });
}

/* ---------- roles ---------- */

function grantable(ctx, perms) {
  const p = cleanPerms(perms);
  if (ctx.isOwner || has(ctx.base, PERM.ADMIN)) return p;
  return p & ctx.base & ~PERM.ADMIN;
}

async function createRole(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
  if (ctx.roles.size >= ROLES_MAX) return err(deps, 400, "too_many");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const name = clip(b.name, 100) || "new role";
  const id = randomHex(8);
  const perms = grantable(ctx, b.perms == null ? 0 : b.perms);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_roles SET position = position + 1 WHERE server_id = ? AND position >= 1").bind(ctx.server.id),
    env.DB.prepare("INSERT INTO srv_roles (id, server_id, name, color, perms, position, hoist, mentionable, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .bind(id, ctx.server.id, name, cleanColor(b.color), perms, b.hoist ? 1 : 0, b.mentionable ? 1 : 0, now),
    modlog(env, ctx, "role_create", id, { name, perms })
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true, role: { id, name, color: cleanColor(b.color), perms, position: 1, hoist: !!b.hoist, mentionable: !!b.mentionable } });
}

async function patchRole(request, env, deps, ctx, rid) {
  if (!has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
  const role = ctx.roles.get(rid);
  if (!role) return err(deps, 404, "role");
  if (!ctx.isOwner && rid !== ctx.server.id && Number(role.position) >= ctx.top) return err(deps, 403, "hierarchy");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const sets = [];
  const vals = [];
  const detail = {};
  if (b.name != null && rid !== ctx.server.id) { sets.push("name = ?"); vals.push(clip(b.name, 100) || role.name); detail.name = true; }
  if (b.color != null) { sets.push("color = ?"); vals.push(cleanColor(b.color)); detail.color = cleanColor(b.color); }
  if (b.perms != null) {
    const keep = Number(role.perms) & ~grantable(ctx, ALL_PERMS);
    const next = grantable(ctx, b.perms) | keep;
    sets.push("perms = ?"); vals.push(next); detail.perms = next;
  }
  if (b.hoist != null) { sets.push("hoist = ?"); vals.push(b.hoist ? 1 : 0); }
  if (b.mentionable != null) { sets.push("mentionable = ?"); vals.push(b.mentionable ? 1 : 0); }
  if (!sets.length) return err(deps, 400, "empty");
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_roles SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, rid),
    modlog(env, ctx, "role_update", rid, detail)
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

async function deleteRole(env, deps, ctx, rid) {
  if (!has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
  const role = ctx.roles.get(rid);
  if (!role || rid === ctx.server.id) return err(deps, 404, "role");
  if (!ctx.isOwner && Number(role.position) >= ctx.top) return err(deps, 403, "hierarchy");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM srv_roles WHERE id = ?").bind(rid),
    env.DB.prepare("DELETE FROM srv_member_roles WHERE role_id = ?").bind(rid),
    env.DB.prepare("DELETE FROM srv_overrides WHERE server_id = ? AND target_type = 'role' AND target_id = ?").bind(ctx.server.id, rid),
    modlog(env, ctx, "role_delete", rid, { name: role.name })
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

async function orderRoles(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const ids = (Array.isArray(b.ids) ? b.ids : []).filter((id) => ctx.roles.has(id) && id !== ctx.server.id);
  const all = Array.from(ctx.roles.values()).filter((r) => r.id !== ctx.server.id);
  if (ids.length !== all.length || new Set(ids).size !== ids.length) return err(deps, 400, "ids");
  const st = [];
  ids.forEach((id, i) => {
    const pos = ids.length - i;
    const role = ctx.roles.get(id);
    if (Number(role.position) === pos) return;
    if (!ctx.isOwner && (Number(role.position) >= ctx.top || pos >= ctx.top)) return;
    st.push(env.DB.prepare("UPDATE srv_roles SET position = ? WHERE id = ?").bind(pos, id));
  });
  if (!st.length) return deps.json(200, { ok: true });
  st.push(modlog(env, ctx, "role_order", "", { ids }));
  await env.DB.batch(st);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

/* ---------- channels ---------- */

async function createChannel(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.MANAGE_CHANNELS)) return err(deps, 403, "perm");
  if (ctx.channels.length >= CHANNELS_MAX) return err(deps, 400, "too_many");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const kind = KINDS.indexOf(b.kind) >= 0 ? b.kind : "text";
  const name = cleanName(b.name, kind);
  if (!name) return err(deps, 400, "name");
  let parent = "";
  if (kind !== "category" && b.parentId) {
    const p = ctx.byId.get(b.parentId);
    if (!p || p.kind !== "category") return err(deps, 400, "parent");
    parent = p.id;
  }
  const id = randomHex(8);
  const siblings = ctx.channels.filter((c) => (kind === "category" ? c.kind === "category" : c.parent_id === parent && c.kind !== "category"));
  const pos = siblings.reduce((m, c) => Math.max(m, Number(c.position) + 1), 0);
  const st = [
    env.DB.prepare("INSERT INTO srv_channels (id, server_id, kind, name, topic, parent_id, position, slowmode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, ctx.server.id, kind, name, clip(b.topic, 1024), parent, pos, cleanSlow(b.slowmode), Date.now()),
    modlog(env, ctx, "channel_create", id, { name, kind })
  ];
  if (kind === "announcement") st.push(env.DB.prepare("INSERT INTO srv_overrides (channel_id, server_id, target_type, target_id, allow, deny) VALUES (?, ?, 'role', ?, 0, ?)").bind(id, ctx.server.id, ctx.server.id, PERM.SEND));
  if (b.private) st.push(env.DB.prepare("INSERT OR REPLACE INTO srv_overrides (channel_id, server_id, target_type, target_id, allow, deny) VALUES (?, ?, 'role', ?, 0, ?)").bind(id, ctx.server.id, ctx.server.id, PERM.VIEW | (kind === "announcement" ? PERM.SEND : 0)));
  await env.DB.batch(st);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true, channel: { id, kind, name, parentId: parent, position: pos } });
}

function cleanSlow(value) {
  const allowed = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
  const n = Math.floor(Number(value) || 0);
  return allowed.indexOf(n) >= 0 ? n : 0;
}

async function patchChannel(request, env, deps, ctx, channel) {
  if (!has(ctx.perms(channel.id), PERM.MANAGE_CHANNELS)) return err(deps, 403, "perm");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const sets = [];
  const vals = [];
  const detail = {};
  if (b.name != null) {
    const name = cleanName(b.name, channel.kind);
    if (!name) return err(deps, 400, "name");
    sets.push("name = ?"); vals.push(name); detail.name = name;
  }
  if (b.topic != null) { sets.push("topic = ?"); vals.push(clip(b.topic, 1024)); detail.topic = true; }
  if (b.slowmode != null) { sets.push("slowmode = ?"); vals.push(cleanSlow(b.slowmode)); detail.slowmode = cleanSlow(b.slowmode); }
  if (b.parentId != null && channel.kind !== "category") {
    const p = b.parentId ? ctx.byId.get(b.parentId) : null;
    if (b.parentId && (!p || p.kind !== "category")) return err(deps, 400, "parent");
    sets.push("parent_id = ?"); vals.push(p ? p.id : ""); detail.parentId = p ? p.id : "";
  }
  if (b.kind != null && channel.kind !== "category" && (b.kind === "text" || b.kind === "announcement")) {
    sets.push("kind = ?"); vals.push(b.kind); detail.kind = b.kind;
  }
  if (!sets.length) return err(deps, 400, "empty");
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_channels SET " + sets.join(", ") + " WHERE id = ?").bind(...vals, channel.id),
    modlog(env, ctx, "channel_update", channel.id, detail)
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

async function deleteChannel(env, deps, ctx, channel) {
  if (!has(ctx.perms(channel.id), PERM.MANAGE_CHANNELS)) return err(deps, 403, "perm");
  const cid = channel.id;
  const st = [];
  if (channel.kind === "category") {
    st.push(env.DB.prepare("UPDATE srv_channels SET parent_id = '' WHERE parent_id = ?").bind(cid));
  } else {
    const keys = rows(await env.DB.prepare("SELECT attachments FROM srv_messages WHERE channel_id = ? AND attachments != ''").bind(cid).all())
      .reduce((all, m) => all.concat(parseJson(m.attachments, []).map((a) => a && a.k).filter(Boolean)), []);
    later(deps, deleteKeys(env, keys));
    st.push(env.DB.prepare("DELETE FROM srv_reactions WHERE message_id IN (SELECT id FROM srv_messages WHERE channel_id = ?)").bind(cid));
    st.push(env.DB.prepare("DELETE FROM srv_messages WHERE channel_id = ?").bind(cid));
    st.push(env.DB.prepare("DELETE FROM srv_reads WHERE channel_id = ?").bind(cid));
  }
  st.push(env.DB.prepare("DELETE FROM srv_overrides WHERE channel_id = ?").bind(cid));
  st.push(env.DB.prepare("DELETE FROM srv_notify WHERE scope_id = ?").bind(cid));
  st.push(env.DB.prepare("DELETE FROM srv_channels WHERE id = ?").bind(cid));
  st.push(modlog(env, ctx, "channel_delete", cid, { name: channel.name }));
  await env.DB.batch(st);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

async function orderChannels(request, env, deps, ctx) {
  if (!has(ctx.base, PERM.MANAGE_CHANNELS)) return err(deps, 403, "perm");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, CHANNELS_MAX);
  const st = [];
  items.forEach((it) => {
    const c = it && ctx.byId.get(it.id);
    if (!c) return;
    let parent = c.parent_id || "";
    if (c.kind !== "category" && it.parentId != null) {
      const p = it.parentId ? ctx.byId.get(it.parentId) : null;
      parent = p && p.kind === "category" ? p.id : "";
    }
    const pos = Math.max(0, Math.min(10000, Math.floor(Number(it.position) || 0)));
    if (pos === Number(c.position) && parent === (c.parent_id || "")) return;
    st.push(env.DB.prepare("UPDATE srv_channels SET position = ?, parent_id = ? WHERE id = ?").bind(pos, c.kind === "category" ? "" : parent, c.id));
  });
  if (!st.length) return deps.json(200, { ok: true });
  st.push(modlog(env, ctx, "channel_order", "", { n: st.length }));
  await env.DB.batch(st);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

async function putOverride(request, env, deps, ctx, channel, type, tid) {
  if (!has(ctx.perms(channel.id), PERM.MANAGE_CHANNELS) || !has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
  if (type !== "role" && type !== "member") return err(deps, 400, "type");
  if (type === "role" && !ctx.roles.has(tid)) return err(deps, 404, "role");
  if (type === "member" && !(await memberByMid(env, ctx, tid))) return err(deps, 404, "member");
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const allow = grantable(ctx, b.allow) & ~PERM.ADMIN;
  const deny = grantable(ctx, b.deny) & ~PERM.ADMIN & ~allow;
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO srv_overrides (channel_id, server_id, target_type, target_id, allow, deny) VALUES (?, ?, ?, ?, ?, ?)").bind(channel.id, ctx.server.id, type, tid, allow, deny),
    modlog(env, ctx, "override_set", channel.id, { type, id: tid, allow, deny })
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true, allow, deny });
}

async function deleteOverride(env, deps, ctx, channel, type, tid) {
  if (!has(ctx.perms(channel.id), PERM.MANAGE_CHANNELS) || !has(ctx.base, PERM.MANAGE_ROLES)) return err(deps, 403, "perm");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM srv_overrides WHERE channel_id = ? AND target_type = ? AND target_id = ?").bind(channel.id, type, tid),
    modlog(env, ctx, "override_remove", channel.id, { type, id: tid })
  ]);
  resync(env, deps, ctx.server.id);
  return deps.json(200, { ok: true });
}

/* ---------- messages ---------- */

async function listMessages(request, env, url, deps, ctx, channel) {
  if (channel.kind === "category") return err(deps, 400, "category");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
  const before = String(url.searchParams.get("before") || "");
  const after = String(url.searchParams.get("after") || "");
  const around = String(url.searchParams.get("around") || "");
  let list;
  if (around && MSG_ID.test(around)) {
    const half = Math.floor(limit / 2);
    const older = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE channel_id = ? AND id <= ? ORDER BY id DESC LIMIT ?").bind(channel.id, around, half + 1).all());
    const newer = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?").bind(channel.id, around, half).all());
    list = older.reverse().concat(newer);
  } else if (after && MSG_ID.test(after)) {
    list = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?").bind(channel.id, after, limit).all());
  } else if (before && MSG_ID.test(before)) {
    list = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?").bind(channel.id, before, limit).all()).reverse();
  } else {
    list = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?").bind(channel.id, limit).all()).reverse();
  }
  const messages = await presentMessages(env, deps, request, list, ctx.mid, ctx);
  return deps.json(200, { messages, more: list.length >= limit });
}

function cleanAttachments(ctx, list, meta) {
  const out = [];
  const prefix = "srv/" + ctx.server.id + "/a/" + ctx.mid + "/";
  (Array.isArray(list) ? list : []).slice(0, ATTACH_MAX).forEach((a) => {
    if (!a || typeof a.k !== "string" || a.k.indexOf(prefix) !== 0 || a.k.length > 300) return;
    const m = meta && meta.get(a.k);
    if (!m) return;
    out.push({ k: a.k, n: m.name, t: m.type, s: m.size, w: Math.max(0, Math.min(20000, Math.floor(Number(a.w) || 0))), h: Math.max(0, Math.min(20000, Math.floor(Number(a.h) || 0))) });
  });
  return out;
}

async function attachmentMeta(env, ctx, list) {
  const meta = new Map();
  if (!env.DATA) return meta;
  const prefix = "srv/" + ctx.server.id + "/a/" + ctx.mid + "/";
  for (const a of (Array.isArray(list) ? list : []).slice(0, ATTACH_MAX)) {
    if (!a || typeof a.k !== "string" || a.k.indexOf(prefix) !== 0) continue;
    const head = await env.DATA.head(a.k);
    if (!head) continue;
    meta.set(a.k, {
      name: (head.customMetadata && head.customMetadata.name) || "file",
      type: (head.httpMetadata && head.httpMetadata.contentType) || "application/octet-stream",
      size: head.size
    });
  }
  return meta;
}

async function sendMessage(request, env, deps, ctx, channel) {
  if (channel.kind === "category") return err(deps, 400, "category");
  const perms = ctx.perms(channel.id);
  if (ctx.timedOut) return err(deps, 403, "timed_out", { until: Number(ctx.member.timeout_until) });
  if (!has(perms, PERM.SEND)) return err(deps, 403, "perm");
  const b = await body(deps, request, 24000);
  if (b.error) return err(deps, 400, b.error);
  const text = String(b.body == null ? "" : b.body).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/^\n+|\s+$/g, "");
  if (text.length > BODY_MAX) return err(deps, 400, "too_long", { max: BODY_MAX });
  const wantFiles = Array.isArray(b.attachments) && b.attachments.length > 0;
  if (wantFiles && !has(perms, PERM.ATTACH)) return err(deps, 403, "perm_attach");
  if (!floodOk("srvmsg:" + ctx.accountId, 8, 5000)) return err(deps, 429, "rate_limited", { retry: 5 });
  const bypass = has(perms, PERM.MANAGE_MESSAGES) || has(perms, PERM.MANAGE_CHANNELS);
  const slow = Number(channel.slowmode) || 0;
  if (slow && !bypass) {
    const last = await env.DB.prepare("SELECT created_at FROM srv_messages WHERE channel_id = ? AND author_id = ? AND flags = 0 ORDER BY id DESC LIMIT 1").bind(channel.id, ctx.accountId).first();
    const wait = last ? Number(last.created_at) + slow * 1000 - Date.now() : 0;
    if (wait > 0) return err(deps, 429, "slowmode", { retry: Math.ceil(wait / 1000) });
  }
  const meta = wantFiles ? await attachmentMeta(env, ctx, b.attachments) : null;
  const files = wantFiles ? cleanAttachments(ctx, b.attachments, meta) : [];
  if (!text && !files.length) return err(deps, 400, "empty");
  let replyTo = "";
  let replyAuthor = null;
  if (b.replyTo && MSG_ID.test(String(b.replyTo))) {
    const src = await env.DB.prepare("SELECT id, author_id, author_mid FROM srv_messages WHERE id = ? AND channel_id = ?").bind(b.replyTo, channel.id).first();
    if (src) { replyTo = src.id; replyAuthor = src; }
  }
  const parsed = parseMentions(text);
  const canEveryone = has(perms, PERM.MENTION_EVERYONE);
  const roleIds = parsed.roles.filter((id) => ctx.roles.has(id) && id !== ctx.server.id && (canEveryone || ctx.roles.get(id).mentionable === 1));
  const mentionUsers = parsed.users.slice();
  if (replyAuthor && b.pingReply !== false && replyAuthor.author_id !== ctx.accountId && mentionUsers.indexOf(replyAuthor.author_mid) < 0) mentionUsers.push(replyAuthor.author_mid);
  const everyone = parsed.everyone && canEveryone;
  const emojis = emojiTokens(text);
  const now = Date.now();
  const id = messageId(now, randomBase36(6));
  const mentions = { u: mentionUsers.slice(0, 50), r: roleIds, e: everyone };
  const row = {
    id, server_id: ctx.server.id, channel_id: channel.id, author_id: ctx.accountId, author_mid: ctx.mid,
    body: text, reply_to: replyTo, attachments: files.length ? JSON.stringify(files) : "",
    mentions: (mentions.u.length || mentions.r.length || mentions.e) ? JSON.stringify(mentions) : "",
    flags: 0, edited_at: 0, removed_by: "", removed_at: 0, removed_reason: "", pinned_at: 0, created_at: now
  };
  const st = [
    env.DB.prepare("INSERT INTO srv_messages (id, server_id, channel_id, author_id, author_mid, body, reply_to, attachments, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, row.server_id, row.channel_id, row.author_id, row.author_mid, row.body, row.reply_to, row.attachments, row.mentions, now),
    env.DB.prepare("UPDATE srv_channels SET last_message_id = ? WHERE id = ?").bind(id, channel.id),
    env.DB.prepare("INSERT INTO srv_reads (account_id, channel_id, server_id, last_read, mentions) VALUES (?, ?, ?, ?, 0) ON CONFLICT(account_id, channel_id) DO UPDATE SET last_read = excluded.last_read, mentions = 0").bind(ctx.accountId, channel.id, ctx.server.id, id)
  ];
  /* Who is mentioned: users by member id, role holders, or everyone. */
  let targets = [];
  if (everyone) {
    st.push(env.DB.prepare("INSERT INTO srv_reads (account_id, channel_id, server_id, last_read, mentions) SELECT account_id, ?, ?, '', 1 FROM srv_members WHERE server_id = ? AND account_id != ? AND true ON CONFLICT(account_id, channel_id) DO UPDATE SET mentions = mentions + 1")
      .bind(channel.id, ctx.server.id, ctx.server.id, ctx.accountId));
  } else if (mentions.u.length || roleIds.length) {
    const parts = [];
    const vals = [ctx.server.id];
    if (mentions.u.length) { parts.push("mid IN (" + mentions.u.map(() => "?").join(",") + ")"); vals.push(...mentions.u); }
    if (roleIds.length) { parts.push("account_id IN (SELECT account_id FROM srv_member_roles WHERE server_id = ? AND role_id IN (" + roleIds.map(() => "?").join(",") + "))"); vals.push(ctx.server.id, ...roleIds); }
    targets = rows(await env.DB.prepare("SELECT account_id, mid FROM srv_members WHERE server_id = ? AND (" + parts.join(" OR ") + ") LIMIT 500").bind(...vals).all())
      .filter((m) => m.account_id !== ctx.accountId);
    targets.forEach((m) => st.push(env.DB.prepare("INSERT INTO srv_reads (account_id, channel_id, server_id, last_read, mentions) VALUES (?, ?, ?, '', 1) ON CONFLICT(account_id, channel_id) DO UPDATE SET mentions = mentions + 1").bind(m.account_id, channel.id, ctx.server.id)));
  }
  await env.DB.batch(st);
  const msg = await presentMessage(env, deps, request, row, [], replyAuthor ? new Map([[replyTo, await env.DB.prepare("SELECT id, author_mid, body, attachments, removed_at, flags FROM srv_messages WHERE id = ?").bind(replyTo).first()]]) : null);
  if (b.nonce) msg.n = clip(b.nonce, 40);
  emit(env, deps, ctx.server.id, channel.id, { t: "msg", m: msg });
  later(deps, fanOut(env, deps, ctx, channel, row, targets, everyone, emojis));
  return deps.json(200, { ok: true, message: msg });
}

/* Mentions and "all messages" subscribers get an account-channel event and
   a notification. Muted scopes get nothing. Capped per message. */
async function fanOut(env, deps, ctx, channel, row, targets, everyone, _emojis) {
  const sid = ctx.server.id;
  let recipients = targets.map((t) => ({ id: t.account_id, mention: true }));
  if (everyone) {
    recipients = rows(await env.DB.prepare("SELECT account_id FROM srv_members WHERE server_id = ? AND account_id != ? LIMIT 2000").bind(sid, ctx.accountId).all()).map((m) => ({ id: m.account_id, mention: true }));
  }
  const alls = rows(await env.DB.prepare(
    "SELECT account_id, scope_id FROM srv_notify WHERE level = 'all' AND (scope_id = ? OR scope_id = ?) AND account_id IN (SELECT account_id FROM srv_members WHERE server_id = ?)"
  ).bind(sid, channel.id, sid).all());
  alls.forEach((r) => {
    if (r.account_id !== ctx.accountId && !recipients.some((x) => x.id === r.account_id)) recipients.push({ id: r.account_id, mention: false });
  });
  if (!recipients.length) return;
  const ids = recipients.map((r) => r.id).slice(0, 2000);
  /* Channel setting beats server setting; default is mentions only. */
  const levels = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    rows(await env.DB.prepare("SELECT account_id, scope_id, level FROM srv_notify WHERE (scope_id = ? OR scope_id = ?) AND account_id IN (" + chunk.map(() => "?").join(",") + ")").bind(sid, channel.id, ...chunk).all())
      .forEach((r) => {
        const cur = levels.get(r.account_id) || {};
        if (r.scope_id === channel.id) cur.c = r.level; else cur.s = r.level;
        levels.set(r.account_id, cur);
      });
  }
  /* Recipients must be able to see the channel. */
  const roleRows = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    roleRows.push(...rows(await env.DB.prepare("SELECT account_id, role_id FROM srv_member_roles WHERE server_id = ? AND account_id IN (" + chunk.map(() => "?").join(",") + ")").bind(sid, ...chunk).all()));
  }
  const midRows = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    rows(await env.DB.prepare("SELECT account_id, mid, timeout_until FROM srv_members WHERE server_id = ? AND account_id IN (" + chunk.map(() => "?").join(",") + ")").bind(sid, ...chunk).all()).forEach((m) => midRows.set(m.account_id, m));
  }
  let pushed = 0;
  const preview = clip(row.body, 140) || (row.attachments ? "📎" : "");
  const hash = "#/messages/s/" + sid + "/" + channel.id;
  for (const r of recipients) {
    const lv = levels.get(r.id) || {};
    const level = lv.c || lv.s || "mentions";
    if (level === "none") continue;
    if (level === "mentions" && !r.mention) continue;
    const m = midRows.get(r.id);
    if (!m) continue;
    const perms = permsFor(ctx, channel.id, { mid: m.mid, roles: roleRows.filter((x) => x.account_id === r.id).map((x) => x.role_id), owner: r.id === ctx.server.owner_id });
    if (!has(perms, PERM.VIEW)) continue;
    if (deps.publish) {
      try { await deps.publish(env, r.id, "srv", { s: sid, c: channel.id, id: row.id, mention: r.mention }); }
      catch (e) { /* the account socket can be gone */ }
    }
    if (pushed < PUSH_CAP && deps.notify) {
      pushed += 1;
      try {
        await deps.notify(env, {
          publicId: r.id,
          kind: r.mention ? "mention" : "dm",
          at: row.created_at,
          actorId: ctx.accountId,
          idempotencyKey: "srvmsg:" + row.id + ":" + r.id,
          handle: ctx.viewer.handle,
          name: ctx.viewer.display_name,
          text: "#" + channel.name + " · " + ctx.server.name + (preview ? ": " + preview : ""),
          hash: hash,
          platform: "app",
          feedId: "app:" + ctx.accountId
        });
      } catch (e) { /* notifications are best effort */ }
    }
  }
}

async function editMessage(request, env, deps, ctx, channel, mid) {
  const row = await env.DB.prepare("SELECT * FROM srv_messages WHERE id = ? AND channel_id = ?").bind(mid, channel.id).first();
  if (!row) return err(deps, 404, "message");
  if (row.author_id !== ctx.accountId || Number(row.flags) !== 0 || Number(row.removed_at) > 0) return err(deps, 403, "perm");
  if (ctx.timedOut) return err(deps, 403, "timed_out");
  const b = await body(deps, request, 24000);
  if (b.error) return err(deps, 400, b.error);
  const text = String(b.body == null ? "" : b.body).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/^\n+|\s+$/g, "");
  if (text.length > BODY_MAX) return err(deps, 400, "too_long", { max: BODY_MAX });
  if (!text && !row.attachments) return err(deps, 400, "empty");
  if (!floodOk("srvedit:" + ctx.accountId, 10, 10000)) return err(deps, 429, "rate_limited");
  const perms = ctx.perms(channel.id);
  const parsed = parseMentions(text);
  const canEveryone = has(perms, PERM.MENTION_EVERYONE);
  const old = parseJson(row.mentions, { u: [], r: [], e: false });
  const mentions = {
    u: parsed.users.concat((old.u || []).filter((u) => parsed.users.indexOf(u) < 0 && row.reply_to)).slice(0, 50),
    r: parsed.roles.filter((id) => ctx.roles.has(id) && id !== ctx.server.id && (canEveryone || ctx.roles.get(id).mentionable === 1)),
    e: parsed.everyone && canEveryone
  };
  const now = Date.now();
  await env.DB.prepare("UPDATE srv_messages SET body = ?, mentions = ?, edited_at = ? WHERE id = ?")
    .bind(text, (mentions.u.length || mentions.r.length || mentions.e) ? JSON.stringify(mentions) : "", now, mid).run();
  row.body = text;
  row.edited_at = now;
  row.mentions = JSON.stringify(mentions);
  const [msg] = await presentMessages(env, deps, request, [row], ctx.mid, ctx);
  emit(env, deps, ctx.server.id, channel.id, { t: "msg", m: msg });
  return deps.json(200, { ok: true, message: msg });
}

async function deleteMessage(request, env, url, deps, ctx, channel, mid) {
  const row = await env.DB.prepare("SELECT * FROM srv_messages WHERE id = ? AND channel_id = ?").bind(mid, channel.id).first();
  if (!row) return err(deps, 404, "message");
  const own = row.author_id === ctx.accountId;
  const files = parseJson(row.attachments, []).map((a) => a && a.k).filter(Boolean);
  if (own) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM srv_reactions WHERE message_id = ?").bind(mid),
      env.DB.prepare("DELETE FROM srv_messages WHERE id = ?").bind(mid)
    ]);
    later(deps, deleteKeys(env, files));
    emit(env, deps, ctx.server.id, channel.id, { t: "del", id: mid });
    return deps.json(200, { ok: true, removed: "deleted" });
  }
  if (!has(ctx.perms(channel.id), PERM.MANAGE_MESSAGES)) return err(deps, 403, "perm");
  if (Number(row.removed_at) > 0) return deps.json(200, { ok: true, removed: "stub" });
  const target = await memberByMid(env, ctx, row.author_mid);
  if (target && !canActOn(ctx, target)) return err(deps, 403, "hierarchy");
  const reason = clip(url.searchParams.get("reason") || "", 300);
  const now = Date.now();
  /* The stub is public; the removed text stays visible to message
     moderators only (stub and mod log). Files are deleted from storage. */
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_messages SET removed_by = ?, removed_at = ?, removed_reason = ?, attachments = '', pinned_at = 0 WHERE id = ?").bind(ctx.mid, now, reason, mid),
    env.DB.prepare("DELETE FROM srv_reactions WHERE message_id = ?").bind(mid),
    modlog(env, ctx, "message_remove", mid, { channel: channel.id, author: row.author_mid, reason, excerpt: clip(row.body, 200) })
  ]);
  later(deps, deleteKeys(env, files));
  row.removed_by = ctx.mid;
  row.removed_at = now;
  row.removed_reason = reason;
  row.attachments = "";
  row.pinned_at = 0;
  const msg = await presentMessage(env, deps, request, row, [], null, false);
  emit(env, deps, ctx.server.id, channel.id, { t: "msg", m: msg });
  return deps.json(200, { ok: true, removed: "stub", message: await presentMessage(env, deps, request, row, [], null, true) });
}

async function react(env, deps, ctx, channel, mid, raw, on) {
  const emoji = cleanReaction(raw);
  if (!emoji) return err(deps, 400, "emoji");
  const perms = ctx.perms(channel.id);
  if (on && (!has(perms, PERM.REACT) || ctx.timedOut)) return err(deps, 403, "perm");
  const row = await env.DB.prepare("SELECT id, removed_at FROM srv_messages WHERE id = ? AND channel_id = ?").bind(mid, channel.id).first();
  if (!row || Number(row.removed_at) > 0) return err(deps, 404, "message");
  if (emoji.indexOf("c:") === 0) {
    const e = await env.DB.prepare("SELECT id FROM srv_emojis WHERE id = ? AND server_id = ?").bind(emoji.slice(2), ctx.server.id).first();
    if (!e) return err(deps, 404, "emoji");
  }
  if (!floodOk("srvrx:" + ctx.accountId, 20, 10000)) return err(deps, 429, "rate_limited");
  if (on) {
    const kinds = await env.DB.prepare("SELECT COUNT(DISTINCT emoji) AS n FROM srv_reactions WHERE message_id = ?").bind(mid).first();
    if (Number(kinds && kinds.n) >= 20) {
      const mine = await env.DB.prepare("SELECT 1 AS x FROM srv_reactions WHERE message_id = ? AND emoji = ? LIMIT 1").bind(mid, emoji).first();
      if (!mine) return err(deps, 400, "too_many");
    }
    await env.DB.prepare("INSERT OR IGNORE INTO srv_reactions (message_id, emoji, mid, at) VALUES (?, ?, ?, ?)").bind(mid, emoji, ctx.mid, Date.now()).run();
  } else {
    await env.DB.prepare("DELETE FROM srv_reactions WHERE message_id = ? AND emoji = ? AND mid = ?").bind(mid, emoji, ctx.mid).run();
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM srv_reactions WHERE message_id = ? AND emoji = ?").bind(mid, emoji).first();
  const n = Number(count && count.n) || 0;
  emit(env, deps, ctx.server.id, channel.id, { t: "rx", id: mid, e: emoji, n: n, m: ctx.mid, on: !!on });
  return deps.json(200, { ok: true, n: n });
}

async function pin(env, deps, ctx, channel, mid, on) {
  if (!has(ctx.perms(channel.id), PERM.MANAGE_MESSAGES)) return err(deps, 403, "perm");
  const row = await env.DB.prepare("SELECT id, removed_at, pinned_at FROM srv_messages WHERE id = ? AND channel_id = ?").bind(mid, channel.id).first();
  if (!row || Number(row.removed_at) > 0) return err(deps, 404, "message");
  if (on) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM srv_messages WHERE channel_id = ? AND pinned_at > 0").bind(channel.id).first();
    if (Number(n && n.n) >= PINS_MAX && !Number(row.pinned_at)) return err(deps, 400, "too_many_pins", { max: PINS_MAX });
  }
  const at = on ? Date.now() : 0;
  await env.DB.batch([
    env.DB.prepare("UPDATE srv_messages SET pinned_at = ? WHERE id = ?").bind(at, mid),
    modlog(env, ctx, on ? "message_pin" : "message_unpin", mid, { channel: channel.id })
  ]);
  emit(env, deps, ctx.server.id, channel.id, { t: "pin", id: mid, p: at });
  return deps.json(200, { ok: true, pinnedAt: at });
}

async function listPins(request, env, deps, ctx, channel) {
  const list = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE channel_id = ? AND pinned_at > 0 ORDER BY pinned_at DESC LIMIT ?").bind(channel.id, PINS_MAX).all());
  return deps.json(200, { messages: await presentMessages(env, deps, request, list, ctx.mid, ctx) });
}

async function markRead(request, env, deps, ctx, channel) {
  const b = await body(deps, request);
  const id = MSG_ID.test(String(b.id || "")) ? b.id : (channel.last_message_id || "");
  await env.DB.prepare(
    "INSERT INTO srv_reads (account_id, channel_id, server_id, last_read, mentions) VALUES (?, ?, ?, ?, 0) ON CONFLICT(account_id, channel_id) DO UPDATE SET last_read = CASE WHEN excluded.last_read > last_read THEN excluded.last_read ELSE last_read END, mentions = 0"
  ).bind(ctx.accountId, channel.id, ctx.server.id, id).run();
  return deps.json(200, { ok: true, lastRead: id });
}

async function setNotify(request, env, deps, ctx) {
  const b = await body(deps, request);
  if (b.error) return err(deps, 400, b.error);
  const scope = String(b.scope || ctx.server.id);
  if (scope !== ctx.server.id && !ctx.byId.has(scope)) return err(deps, 404, "scope");
  if (b.level === "" || b.level == null) {
    await env.DB.prepare("DELETE FROM srv_notify WHERE account_id = ? AND scope_id = ?").bind(ctx.accountId, scope).run();
    return deps.json(200, { ok: true, level: "" });
  }
  if (LEVELS.indexOf(b.level) < 0) return err(deps, 400, "level");
  await env.DB.prepare("INSERT OR REPLACE INTO srv_notify (account_id, scope_id, level) VALUES (?, ?, ?)").bind(ctx.accountId, scope, b.level).run();
  return deps.json(200, { ok: true, level: b.level });
}

async function search(request, env, url, deps, ctx) {
  const q = clip(url.searchParams.get("q"), 100);
  const cid = String(url.searchParams.get("c") || "");
  const author = String(url.searchParams.get("a") || "");
  const before = String(url.searchParams.get("before") || "");
  if (q.length < 2 && !HEX16.test(author)) return err(deps, 400, "query");
  if (!floodOk("srvsearch:" + ctx.accountId, 10, 10000)) return err(deps, 429, "rate_limited");
  let visible = visibleChannels(ctx).filter((c) => c.kind !== "category").map((c) => c.id);
  if (cid) visible = visible.filter((id) => id === cid);
  if (!visible.length) return deps.json(200, { messages: [] });
  const where = ["server_id = ?", "removed_at = 0", "flags = 0", "channel_id IN (" + visible.map(() => "?").join(",") + ")"];
  const vals = [ctx.server.id, ...visible];
  if (q.length >= 2) {
    where.push("body LIKE ? ESCAPE '\\'");
    vals.push("%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%");
  }
  if (HEX16.test(author)) { where.push("author_mid = ?"); vals.push(author); }
  if (MSG_ID.test(before)) { where.push("id < ?"); vals.push(before); }
  const list = rows(await env.DB.prepare("SELECT * FROM srv_messages WHERE " + where.join(" AND ") + " ORDER BY id DESC LIMIT 25").bind(...vals).all());
  return deps.json(200, { messages: await presentMessages(env, deps, request, list, ctx.mid, ctx), more: list.length === 25 });
}

async function modlogList(env, url, deps, ctx) {
  const before = Math.floor(Number(url.searchParams.get("before") || 0));
  const list = rows(await env.DB.prepare(
    "SELECT id, actor_mid, action, target, detail, at FROM srv_modlog WHERE server_id = ?" + (before > 0 ? " AND id < ?" : "") + " ORDER BY id DESC LIMIT 50"
  ).bind(...(before > 0 ? [ctx.server.id, before] : [ctx.server.id])).all());
  return deps.json(200, {
    entries: list.map((e) => {
      const detail = parseJson(e.detail, {});
      /* Everyone sees what happened; only message moderators see removed text. */
      if (detail && detail.excerpt && !has(ctx.base, PERM.MANAGE_MESSAGES)) delete detail.excerpt;
      return { id: e.id, by: e.actor_mid, action: e.action, target: e.target, detail, at: e.at };
    }),
    more: list.length === 50
  });
}

/* ---------- realtime ---------- */

async function ticket(env, deps, ctx) {
  if (!floodOk("srvtk:" + ctx.accountId, 30, 60000)) return err(deps, 429, "rate_limited");
  const t = "st1." + b64url(crypto.getRandomValues(new Uint8Array(24)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM channel_tickets WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO channel_tickets (token_hash, public_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(t + ":" + ctx.server.id), ctx.accountId, now + 120000)
  ]);
  return deps.json(200, { ticket: t, expiresAt: now + 120000 });
}

async function socket(request, env, url, deps) {
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return err(deps, 426, "upgrade");
  const t = String(url.searchParams.get("ticket") || "");
  const sid = String(url.searchParams.get("s") || "");
  if (!t.startsWith("st1.") || t.length > 80 || !HEX16.test(sid)) return err(deps, 401, "ticket");
  const hash = await sha256Hex(t + ":" + sid);
  const row = await env.DB.prepare("SELECT public_id, expires_at FROM channel_tickets WHERE token_hash = ?").bind(hash).first();
  await env.DB.prepare("DELETE FROM channel_tickets WHERE token_hash = ?").bind(hash).run();
  if (!row || Number(row.expires_at) <= Date.now() || !ACCOUNT.test(String(row.public_id))) return err(deps, 401, "ticket");
  const ctx = await loadContext(env, sid, row.public_id);
  if (!ctx || !ctx.member) return err(deps, 403, "not_member");
  const s = roomStub(env, sid);
  if (!s) return err(deps, 503, "channel");
  const headers = new Headers(request.headers);
  headers.set("x-account-id", row.public_id);
  headers.set("x-member-id", ctx.mid);
  headers.set("x-srv-visible", visibleChannels(ctx).map((c) => c.id).join(","));
  return s.fetch(new Request(request.url, { method: "GET", headers }));
}
