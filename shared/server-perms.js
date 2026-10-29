/* Native Messages servers: permission bits, the effective permission math,
   and mention parsing. Pure functions shared by the Worker and the tests.
   The math follows Discord's order: base from @everyone and member roles,
   then category overrides, then channel overrides (everyone, roles, member).
   The server owner and any role with ADMIN get every bit. */

export const PERM = {
  VIEW: 1,
  SEND: 2,
  MANAGE_MESSAGES: 4,
  MANAGE_CHANNELS: 8,
  KICK: 16,
  BAN: 32,
  MENTION_EVERYONE: 64,
  MANAGE_ROLES: 128,
  MANAGE_SERVER: 256,
  CREATE_INVITE: 512,
  REACT: 1024,
  ATTACH: 2048,
  MODERATE: 4096,
  MANAGE_EVENTS: 8192,
  CREATE_THREADS: 16384,
  MANAGE_THREADS: 32768,
  ADMIN: 1 << 20
};

export const ALL_PERMS = Object.keys(PERM).reduce((sum, key) => sum | PERM[key], 0);
export const DEFAULT_EVERYONE = PERM.VIEW | PERM.SEND | PERM.REACT | PERM.ATTACH | PERM.CREATE_INVITE | PERM.CREATE_THREADS;

export function cleanPerms(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return (n | 0) & ALL_PERMS;
}

/* Base permissions for a member. roles: Map or object id -> {perms}.
   memberRoles: role ids. everyoneId is the server id. */
export function basePerms(opts) {
  const o = opts || {};
  if (o.isOwner) return ALL_PERMS;
  const roles = o.roles instanceof Map ? o.roles : new Map(Object.entries(o.roles || {}));
  const everyone = roles.get(o.everyoneId);
  let perms = everyone ? cleanPerms(everyone.perms) : 0;
  (o.memberRoles || []).forEach((id) => {
    const role = roles.get(id);
    if (role) perms |= cleanPerms(role.perms);
  });
  if (perms & PERM.ADMIN) return ALL_PERMS;
  return perms;
}

/* One layer of overrides (a category's or a channel's). */
function applyLayer(perms, layer, everyoneId, memberRoles, accountId) {
  const list = Array.isArray(layer) ? layer : [];
  let allow = 0;
  let deny = 0;
  const everyone = list.find((o) => o.target_type === "role" && o.target_id === everyoneId);
  if (everyone) perms = (perms & ~cleanPerms(everyone.deny)) | cleanPerms(everyone.allow);
  const mine = new Set(memberRoles || []);
  list.forEach((o) => {
    if (o.target_type !== "role" || o.target_id === everyoneId || !mine.has(o.target_id)) return;
    allow |= cleanPerms(o.allow);
    deny |= cleanPerms(o.deny);
  });
  perms = (perms & ~deny) | allow;
  const member = list.find((o) => o.target_type === "member" && o.target_id === accountId);
  if (member) perms = (perms & ~cleanPerms(member.deny)) | cleanPerms(member.allow);
  return perms;
}

/* Channel permissions. layers: [categoryOverrides, channelOverrides]. */
export function channelPerms(base, opts) {
  const o = opts || {};
  if (base === ALL_PERMS && (o.isOwner || o.isAdmin)) return ALL_PERMS;
  if (base & PERM.ADMIN) return ALL_PERMS;
  let perms = base;
  (o.layers || []).forEach((layer) => {
    perms = applyLayer(perms, layer, o.everyoneId, o.memberRoles, o.accountId);
  });
  if (!(perms & PERM.VIEW)) return 0;
  if (o.timedOut) perms &= PERM.VIEW;
  return perms;
}

export function has(perms, bit) {
  return (Number(perms) & bit) === bit;
}

const USER_TOKEN = /<@([a-f0-9]{16})>/g;
const ROLE_TOKEN = /<@&([a-f0-9]{16})>/g;

/* Mentions written as <@memberId>, <@&roleId>, @everyone and @here. */
export function parseMentions(text) {
  const body = String(text || "");
  const users = [];
  const roles = [];
  let m;
  USER_TOKEN.lastIndex = 0;
  while ((m = USER_TOKEN.exec(body)) && users.length < 50) if (users.indexOf(m[1]) < 0) users.push(m[1]);
  ROLE_TOKEN.lastIndex = 0;
  while ((m = ROLE_TOKEN.exec(body)) && roles.length < 20) if (roles.indexOf(m[1]) < 0) roles.push(m[1]);
  const everyone = /(^|[^\w`])@(everyone|here)\b/.test(body);
  return { users, roles, everyone };
}

/* Custom emoji tokens <:name:id> used in text. */
export function emojiTokens(text) {
  const out = [];
  const re = /<a?:([A-Za-z0-9_]{2,32}):([a-f0-9]{16})>/g;
  let m;
  while ((m = re.exec(String(text || ""))) && out.length < 40) if (out.indexOf(m[2]) < 0) out.push(m[2]);
  return out;
}

/* A reaction key: one unicode emoji (no letters or digits alone) or c:<emojiId>. */
export function cleanReaction(value) {
  const text = String(value || "").trim();
  if (/^c:[a-f0-9]{16}$/.test(text)) return text;
  if (!text || text.length > 32) return "";
  if (/[A-Za-z0-9<>"'`\\\s]/.test(text.replace(/\uFE0F|\u200D/g, ""))) return "";
  if (!/\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]/u.test(text)) return "";
  return text;
}

/* Highest role position, for "can act on" checks. */
export function topPosition(roles, ids) {
  const map = roles instanceof Map ? roles : new Map(Object.entries(roles || {}));
  let top = 0;
  (ids || []).forEach((id) => {
    const role = map.get(id);
    if (role && Number(role.position) > top) top = Number(role.position);
  });
  return top;
}

/* A sortable message id: base36 time then random. 16 chars. */
export function messageId(now, rand) {
  const time = Math.max(0, Math.floor(Number(now) || Date.now())).toString(36).padStart(10, "0").slice(-10);
  const tail = String(rand || "").replace(/[^0-9a-z]/g, "").padEnd(6, "0").slice(0, 6);
  return time + tail;
}

export function messageTime(id) {
  const text = String(id || "");
  if (!/^[0-9a-z]{16}$/.test(text)) return 0;
  return parseInt(text.slice(0, 10), 36) || 0;
}
