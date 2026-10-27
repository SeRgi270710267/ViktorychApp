/* Match Discord text the app already has. This does not call Discord.
   A muted channel or server never matches. Pins are not a separate
   signal: a message alerts once, by its id, even if it is also pinned. */

const USER_RE = /<@!?(\d{2,22})>/g;
const ROLE_RE = /<@&(\d{2,22})>/g;
const EVERYONE_RE = /(^|[^A-Za-z0-9_])@everyone(?![A-Za-z0-9_])/i;
const HERE_RE = /(^|[^A-Za-z0-9_])@here(?![A-Za-z0-9_])/i;

function list(value, max) {
  const out = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    const text = String(item == null ? "" : item).trim();
    if (!text || text.length > 80 || out.indexOf(text) >= 0 || out.length >= max) return;
    out.push(text);
  });
  return out;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function quietNow(now, rule) {
  const start = Number(rule && rule.quietStart);
  const end = Number(rule && rule.quietEnd);
  if (!isFinite(start) || !isFinite(end) || start === end) return false;
  if (start < 0 || end < 0 || start >= 1440 || end >= 1440) return false;
  const offset = Number(rule.quietOffset) || 0;
  const local = new Date((Number(now) || 0) + offset * 60000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function quietEndsAt(now, rule) {
  if (!quietNow(now, rule)) return 0;
  const end = Number(rule.quietEnd) || 0;
  const offset = Number(rule.quietOffset) || 0;
  const local = new Date((Number(now) || 0) + offset * 60000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  let delta = end - mins;
  if (delta <= 0) delta += 1440;
  return (Number(now) || 0) + delta * 60000;
}

function keywordHit(text, rule) {
  const excludes = list(rule.exclude, 20);
  for (let i = 0; i < excludes.length; i++) {
    const word = excludes[i];
    const re = new RegExp("(^|[^A-Za-z0-9_])" + escapeRegExp(word) + "(?![A-Za-z0-9_])", "i");
    if (re.test(text)) return false;
  }
  const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
  for (let i = 0; i < keywords.length && i < 12; i++) {
    const row = keywords[i] || {};
    const phrase = String(row.phrase || "").trim();
    if (!phrase || phrase.length > 80) continue;
    let re = null;
    if (row.regex === true) {
      try { re = new RegExp(phrase, "i"); }
      catch (err) { re = null; }
    } else if (row.whole === true) {
      re = new RegExp("(^|[^A-Za-z0-9_])" + escapeRegExp(phrase) + "(?![A-Za-z0-9_])", "i");
    } else {
      re = new RegExp(escapeRegExp(phrase), "i");
    }
    if (re && re.test(text)) return true;
  }
  return false;
}

function inScope(message, rule) {
  const channel = String(message.channelId || "");
  const server = String(message.serverId || "");
  const mutedChannels = list(rule.mutedChannels, 200);
  const mutedServers = list(rule.mutedServers, 50);
  if (channel && mutedChannels.indexOf(channel) >= 0) return false;
  if (server && mutedServers.indexOf(server) >= 0) return false;
  if (rule.scope === "selected") {
    const channels = list(rule.channels, 100);
    if (!channel || channels.indexOf(channel) < 0) return false;
  }
  const fromUsers = list(rule.fromUsers, 40);
  if (fromUsers.length) {
    const author = String(message.authorId || "");
    if (!author || fromUsers.indexOf(author) < 0) return false;
  }
  return true;
}

export function matchDiscordMessage(message, rule) {
  if (!message || !rule) return { hit: false, reason: "" };
  const id = String(message.id || "");
  if (!/^\d{2,22}$/.test(id)) return { hit: false, reason: "" };
  if (!inScope(message, rule)) return { hit: false, reason: "" };
  const text = String(message.content || "").slice(0, 500);
  const users = [];
  USER_RE.lastIndex = 0;
  let found = USER_RE.exec(text);
  while (found) {
    if (users.indexOf(found[1]) < 0) users.push(found[1]);
    found = USER_RE.exec(text);
  }
  const roles = [];
  ROLE_RE.lastIndex = 0;
  found = ROLE_RE.exec(text);
  while (found) {
    if (roles.indexOf(found[1]) < 0) roles.push(found[1]);
    found = ROLE_RE.exec(text);
  }
  const mine = String(rule.discordUserId || "");
  if (rule.mentionUser === true && mine && users.indexOf(mine) >= 0) return { hit: true, reason: "user" };
  const wantedRoles = list(rule.roleIds, 20);
  if (rule.mentionRoles === true && wantedRoles.some((role) => roles.indexOf(role) >= 0)) return { hit: true, reason: "role" };
  if (rule.mentionEveryone === true && EVERYONE_RE.test(text)) return { hit: true, reason: "everyone" };
  if (rule.mentionHere === true && HERE_RE.test(text)) return { hit: true, reason: "here" };
  if (keywordHit(text, rule)) return { hit: true, reason: "keyword" };
  return { hit: false, reason: "" };
}

export function cleanDiscordRule(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const keywords = [];
  (Array.isArray(src.keywords) ? src.keywords : []).slice(0, 12).forEach((row) => {
    const phrase = String(row && row.phrase || "").trim().slice(0, 80);
    if (!phrase) return;
    keywords.push({ phrase, whole: row.whole === true, regex: row.regex === true });
  });
  const quietStart = Math.max(0, Math.min(1439, Number(src.quietStart) || 0));
  const quietEnd = Math.max(0, Math.min(1439, Number(src.quietEnd) || 0));
  const offset = Number(src.quietOffset);
  return {
    mentionUser: src.mentionUser === true,
    mentionRoles: src.mentionRoles === true,
    mentionEveryone: src.mentionEveryone === true,
    mentionHere: src.mentionHere === true,
    discordUserId: /^\d{2,22}$/.test(String(src.discordUserId || "")) ? String(src.discordUserId) : "",
    roleIds: list(src.roleIds, 20).filter((id) => /^\d{2,22}$/.test(id)),
    keywords,
    exclude: list(src.exclude, 20),
    scope: src.scope === "selected" ? "selected" : "all",
    channels: list(src.channels, 100).filter((id) => /^\d{2,22}$/.test(id)),
    fromUsers: list(src.fromUsers, 40).filter((id) => /^\d{2,22}$/.test(id)),
    quietStart,
    quietEnd,
    quietOffset: isFinite(offset) ? Math.max(-14 * 60, Math.min(14 * 60, Math.round(offset))) : 0
  };
}
