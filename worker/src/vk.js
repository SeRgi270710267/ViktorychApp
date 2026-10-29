/* VK channels on the Messages page, next to Discord.

   Which channels: the Worker secret VK_CHANNELS, one per line or comma,
   each a numeric community id ("123", "-123", "club123", "public123") or a
   vk.com link or short name, optionally "Label=ref". Nothing about them is
   in the repo; a VK Messenger channel link (vk.com/im/channels/-123) works
   too. Reading, with the Worker secret VK_TOKEN:
   - a community key (Manage -> API usage, "messages" right) reads the
     community's Messenger channel with messages.getConversations and
     messages.getHistory. Channel posts never reach the wall, so this is the
     only way to read them;
   - otherwise wall.get (service or community key).
   Without a token, or when both come back empty, VK's public community
   widget page is parsed instead (numeric ids only, open communities). The result is stored in R2 in the same shape the Discord poller
   writes, so discord-ui.js shows VK in the same list, chat view and cards:
   discord/vk.json lists the servers, discord/messages/<id>.json holds each
   channel. Channel and author ids are prefixed so they never meet a Discord
   snowflake. */

const API = "https://api.vk.com/method/";
const VERSION = "5.199";
const SERVER_ID = "990000000000001";
const KEEP = 60;
const MAX_CHANNELS = 20;

export function vkChannelId(gid) { return "99" + String(gid).padStart(12, "0"); }
function groupAuthor(gid) { return "98" + String(gid).padStart(12, "0"); }
function userAuthor(uid) { return "97" + String(uid).padStart(12, "0"); }

export function parseChannels(raw) {
  const out = [];
  const seen = {};
  String(raw || "").split(/[\n,;]+/).forEach((part) => {
    let text = part.trim();
    if (!text || out.length >= MAX_CHANNELS) return;
    let label = "";
    const eq = text.indexOf("=");
    if (eq > 0 && !/^https?:/i.test(text.slice(0, eq))) { label = text.slice(0, eq).trim().slice(0, 80); text = text.slice(eq + 1).trim(); }
    text = text.replace(/^https?:\/\/(?:m\.|web\.)?vk\.(?:com|ru)\//i, "");
    const sel = /^im\/?\?(?:.*&)?sel=-?(\d{1,12})/i.exec(text);
    if (sel) text = sel[1];
    text = text.replace(/^im\/(?:channels|convo)\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    let gid = 0;
    let name = "";
    const num = /^(?:-|club|public|event)?(\d{1,12})$/i.exec(text);
    if (num) gid = Number(num[1]);
    else if (/^[A-Za-z0-9_.]{2,64}$/.test(text)) name = text;
    else return;
    const key = gid ? "g" + gid : "n" + name.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push({ gid: gid, name: name, label: label });
  });
  return out;
}

async function vkApi(env, method, params, fetcher) {
  const body = new URLSearchParams(Object.assign({}, params, { access_token: String(env.VK_TOKEN || ""), v: VERSION }));
  const res = await fetcher(API + method, { method: "POST", body: body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  if (!res || !res.ok) throw new Error("vk_http_" + (res ? res.status : 0));
  const data = await res.json();
  if (data && data.error) throw new Error("vk_error_" + (data.error.error_code || 0));
  return data ? data.response : null;
}

function bestPhoto(photo) {
  const sizes = (photo && Array.isArray(photo.sizes)) ? photo.sizes.slice() : [];
  sizes.sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  const pick = sizes.find((item) => (Number(item.width) || 0) <= 1280) || sizes[0];
  return pick && pick.url ? { type: "photo", url: String(pick.url), width: Number(pick.width) || 0, height: Number(pick.height) || 0 } : null;
}

function bestImage(list) {
  const items = Array.isArray(list) ? list.slice() : [];
  items.sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  const pick = items.find((item) => (Number(item.width) || 0) <= 1280) || items[0];
  return pick && pick.url ? { type: "photo", url: String(pick.url), width: Number(pick.width) || 0, height: Number(pick.height) || 0 } : null;
}

/* VK wiki links [club1|Name] and [id1|Name] read as their names. */
function plainText(text) {
  return String(text || "").replace(/\[(?:club|public|id)\d+\|([^\]]{1,80})\]/g, "$1").slice(0, 4000);
}

export function rowsFromWall(gid, response) {
  const items = (response && Array.isArray(response.items)) ? response.items : [];
  const authors = {};
  ((response && response.groups) || []).forEach((g) => {
    if (g && g.id) authors[groupAuthor(g.id)] = { name: String(g.name || "").slice(0, 80), handle: String(g.screen_name || ("club" + g.id)), avatar: String(g.photo_100 || g.photo_50 || "") };
  });
  ((response && response.profiles) || []).forEach((p) => {
    if (p && p.id) authors[userAuthor(p.id)] = { name: (String(p.first_name || "") + " " + String(p.last_name || "")).trim().slice(0, 80), handle: String(p.screen_name || ("id" + p.id)), avatar: String(p.photo_100 || p.photo_50 || "") };
  });
  const rows = [];
  items.forEach((item) => {
    if (!item || !item.id) return;
    const from = Number(item.from_id || item.owner_id || -gid);
    const attachments = [];
    (item.attachments || []).forEach((att) => {
      if (!att) return;
      if (att.type === "photo") { const p = bestPhoto(att.photo); if (p) attachments.push(p); }
      else if (att.type === "video" && att.video) { const p = bestImage(att.video.image); if (p) attachments.push(p); }
      else if (att.type === "link" && att.link && att.link.photo) { const p = bestPhoto(att.link.photo); if (p) attachments.push(p); }
    });
    const text = plainText(item.text);
    if (!text && !attachments.length) return;
    const row = {
      id: String(item.id),
      author: from < 0 ? groupAuthor(-from) : userAuthor(from),
      text: text,
      date: new Date((Number(item.date) || 0) * 1000).toISOString(),
      link: "https://vk.com/wall-" + gid + "_" + item.id
    };
    if (attachments.length) row.attachments = attachments.slice(0, 10);
    const likes = item.likes && Number(item.likes.count);
    if (likes > 0) row.reactions = [{ emoji: "❤️", count: likes }];
    rows.push(row);
  });
  return { rows: rows, authors: authors };
}

function messageAttachments(list) {
  const out = [];
  (list || []).forEach((att) => {
    if (!att || out.length >= 10) return;
    if (att.type === "photo") { const p = bestPhoto(att.photo); if (p) out.push(p); }
    else if (att.type === "video" && att.video) { const p = bestImage(att.video.image); if (p) out.push(p); }
    else if (att.type === "link" && att.link && att.link.photo) { const p = bestPhoto(att.link.photo); if (p) out.push(p); }
    else if (att.type === "wall" && att.wall) { messageAttachments(att.wall.attachments).forEach((p) => { if (out.length < 10) out.push(p); }); }
  });
  return out;
}

/* messages.getHistory (extended) of a community Messenger channel. */
export function rowsFromChannel(gid, response) {
  const items = (response && Array.isArray(response.items)) ? response.items : [];
  const authors = {};
  ((response && response.groups) || []).forEach((g) => {
    if (g && g.id) authors[groupAuthor(g.id)] = { name: String(g.name || "").slice(0, 80), handle: String(g.screen_name || ("club" + g.id)), avatar: String(g.photo_100 || g.photo_50 || "") };
  });
  ((response && response.profiles) || []).forEach((p) => {
    if (p && p.id) authors[userAuthor(p.id)] = { name: (String(p.first_name || "") + " " + String(p.last_name || "")).trim().slice(0, 80), handle: String(p.screen_name || ("id" + p.id)), avatar: String(p.photo_100 || p.photo_50 || "") };
  });
  const rows = [];
  items.forEach((item) => {
    const mid = item && (item.conversation_message_id || item.id);
    if (!mid || item.action) return;
    const from = Number(item.from_id || -gid);
    let text = plainText(item.text);
    const attachments = messageAttachments(item.attachments);
    if (!text && item.attachments && item.attachments[0] && item.attachments[0].type === "wall") text = plainText(item.attachments[0].wall.text);
    if (!text && !attachments.length) return;
    const row = {
      id: String(mid),
      author: from < 0 ? groupAuthor(-from) : userAuthor(from),
      text: text,
      date: new Date((Number(item.date) || 0) * 1000).toISOString(),
      link: "https://vk.com/im/channels/-" + gid
    };
    if (attachments.length) row.attachments = attachments;
    const count = Array.isArray(item.reactions) ? item.reactions.reduce((n, r) => n + (Number(r && r.count) || 0), 0) : 0;
    if (count > 0) row.reactions = [{ emoji: "❤️", count: count }];
    rows.push(row);
  });
  return { rows: rows, authors: authors };
}

function isChannel(conv) {
  const settings = conv && conv.chat_settings;
  return !!(conv && conv.peer && conv.peer.type === "chat" && settings && (settings.is_group_channel || settings.is_channel));
}

async function channelRead(env, gid, label, fetcher) {
  const convs = await vkApi(env, "messages.getConversations", { filter: "all", count: "200", extended: "1" }, fetcher);
  const list = ((convs && convs.items) || []).map((item) => item && item.conversation).filter(isChannel);
  if (!list.length) return null;
  const want = String(label || "").toLowerCase();
  const conv = list.find((c) => want && String(c.chat_settings.title || "").toLowerCase() === want) || list[0];
  const history = await vkApi(env, "messages.getHistory", { peer_id: String(conv.peer.id), count: String(KEEP), extended: "1", fields: "photo_100,screen_name" }, fetcher);
  const got = rowsFromChannel(gid, history);
  const photo = conv.chat_settings.photo || {};
  return { rows: got.rows, authors: got.authors, title: String(conv.chat_settings.title || ""), avatar: String(photo.photo_100 || photo.photo_50 || "") };
}

const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch (err) { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (err) { return ""; } })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function htmlText(html) {
  let text = String(html || "");
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "$1");
  text = text.replace(/<button[\s\S]*?<\/button>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<a [^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const label = inner.replace(/<[^>]+>/g, "");
    return label && label !== href ? label + " (" + href + ")" : href;
  });
  text = text.replace(/<[^>]+>/g, "");
  return decodeEntities(text).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
}

/* "27 February 2025 at 12:46", "today at 9:40", "yesterday at 9:40": VK
   writes Moscow time (UTC+3). */
export function widgetDate(text, now) {
  const raw = decodeEntities(text).replace(/\u00a0/g, " ").trim().toLowerCase();
  const clock = /at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/.exec(raw);
  let h = clock ? Number(clock[1]) : 0;
  const m = clock ? Number(clock[2]) : 0;
  if (clock && clock[3] === "pm" && h < 12) h += 12;
  if (clock && clock[3] === "am" && h === 12) h = 0;
  const msk = new Date((Number(now) || Date.now()) + 3 * 3600 * 1000);
  let y = msk.getUTCFullYear(), mo = msk.getUTCMonth(), d = msk.getUTCDate();
  const full = /(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/.exec(raw);
  if (/^today/.test(raw)) { /* today */ }
  else if (/^yesterday/.test(raw)) { const t = new Date(Date.UTC(y, mo, d) - 86400000); y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate(); }
  else if (full && MONTHS[full[2]] != null) { d = Number(full[1]); mo = MONTHS[full[2]]; if (full[3]) y = Number(full[3]); }
  else return "";
  return new Date(Date.UTC(y, mo, d, h, m) - 3 * 3600 * 1000).toISOString();
}

export function rowsFromWidget(gid, html, now) {
  const page = String(html || "");
  const authorId = groupAuthor(gid);
  const nameMatch = /class="wcommunity_name_link"[^>]*>([\s\S]*?)<\/a>/.exec(page);
  const avatarMatch = /class="wcommunity_header_avatar"[^>]*>\s*<img src="([^"]+)"/.exec(page);
  const authors = {};
  authors[authorId] = { name: htmlText(nameMatch ? nameMatch[1] : "") || "VK", handle: "club" + gid, avatar: avatarMatch ? decodeEntities(avatarMatch[1]) : "" };
  const rows = [];
  page.split('<div class="wcommunity_post">').slice(1).forEach((block) => {
    const link = /class="wcommunity_post_date" href="\/wall(-?\d+)_(\d+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) return;
    const textMatch = /<div class="wall_post_text"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const attachments = [];
    const re = /background-image:\s*url\((https:\/\/[^)\s"']+)\)/g;
    let hit;
    while ((hit = re.exec(block)) && attachments.length < 10) attachments.push({ type: "photo", url: decodeEntities(hit[1]), width: 0, height: 0 });
    const text = htmlText(textMatch ? textMatch[1] : "");
    if (!text && !attachments.length) return;
    rows.push({
      id: link[2],
      author: authorId,
      text: text,
      date: widgetDate(htmlText(link[3]), now),
      link: "https://vk.com/wall" + link[1] + "_" + link[2]
    });
    if (attachments.length) rows[rows.length - 1].attachments = attachments;
  });
  return { rows: rows, authors: authors, title: authors[authorId].name, avatar: authors[authorId].avatar, closed: /class="wcommunity_closed"/.test(page) };
}

async function widgetRead(gid, fetcher, now) {
  const url = "https://vk.com/widget_community.php?app=0&width=400px&_ver=1&gid=" + gid + "&mode=4&height=1200";
  const res = await fetcher(url, { headers: { "accept-language": "en", "user-agent": "Mozilla/5.0 (compatible; ViktorychApp)" } });
  if (!res || !res.ok) throw new Error("vk_widget_" + (res ? res.status : 0));
  const bytes = await res.arrayBuffer();
  const type = String(res.headers.get("content-type") || "");
  let html;
  try { html = new TextDecoder(/1251/.test(type) || !/utf-8/i.test(type) ? "windows-1251" : "utf-8").decode(bytes); }
  catch (err) { html = new TextDecoder().decode(bytes); }
  return rowsFromWidget(gid, html, now);
}

async function readOne(env, channel, fetcher, now) {
  const token = String(env.VK_TOKEN || "");
  let gid = channel.gid;
  let title = channel.label;
  let avatar = "";
  let empty = null;
  if (token) {
    try {
      const groups = await vkApi(env, "groups.getById", gid ? { group_id: String(gid), fields: "photo_100" } : { group_id: channel.name, fields: "photo_100" }, fetcher);
      const list = Array.isArray(groups) ? groups : (groups && groups.groups) || [];
      const g = list[0];
      if (g && g.id) { gid = Number(g.id); title = title || String(g.name || ""); avatar = String(g.photo_100 || ""); }
    } catch (err) { /* a community key may still read its channel */ }
    if (gid) {
      try {
        const ch = await channelRead(env, gid, channel.label, fetcher);
        if (ch && ch.rows.length) return { gid: gid, title: title || ch.title || "VK " + gid, avatar: avatar || ch.avatar, rows: ch.rows, authors: ch.authors, via: "channel" };
        if (ch) empty = { gid: gid, title: title || ch.title || "VK " + gid, avatar: avatar || ch.avatar, rows: [], authors: {}, via: "channel" };
      } catch (err) { /* not a community key, or no messages right */ }
    }
    try {
      if (!gid) throw new Error("vk_needs_id");
      const wall = await vkApi(env, "wall.get", { owner_id: String(-gid), count: String(KEEP), extended: "1", fields: "photo_100,screen_name" }, fetcher);
      const got = rowsFromWall(gid, wall);
      if (got.rows.length || !empty) {
        const out = { gid: gid, title: title || "VK " + gid, avatar: avatar, rows: got.rows, authors: got.authors, via: "api" };
        if (got.rows.length) return out;
        empty = out;
      }
    } catch (err) {
      if (!gid) throw err;
    }
  }
  if (!gid) throw new Error("vk_needs_id");
  let got;
  try { got = await widgetRead(gid, fetcher, now); }
  catch (err) { if (empty) return empty; throw err; }
  if (!got.rows.length && empty) return empty;
  const name = got.title && got.title !== "VK" ? got.title : "";
  return { gid: gid, title: title || name || "VK " + gid, avatar: avatar || got.avatar, rows: got.rows, authors: got.authors, via: got.closed ? "closed" : "widget" };
}

/* Every other cron minute. Keeps up to KEEP posts per channel, merged with
   what was stored before so a short widget page does not drop history. */
export async function syncVk(env, at, fetcher) {
  if (!env || !env.DATA || !env.VK_CHANNELS) return { skipped: true };
  const now = Number(at) || Date.now();
  const fetchFn = fetcher || ((url, init) => fetch(url, init));
  const channels = parseChannels(env.VK_CHANNELS);
  if (!channels.length) return { skipped: true };
  const listed = [];
  let ok = 0;
  for (const channel of channels) {
    let got;
    try { got = await readOne(env, channel, fetchFn, now); }
    catch (err) { continue; }
    const cid = vkChannelId(got.gid);
    const key = "discord/messages/" + cid + ".json";
    let prior = null;
    try { const obj = await env.DATA.get(key); prior = obj ? JSON.parse(await obj.text()) : null; } catch (err) { prior = null; }
    const byId = {};
    const samePlace = !prior || !prior.via || prior.via === got.via || (prior.via !== "channel" && got.via !== "channel");
    ((samePlace && prior && prior.messages) || []).forEach((row) => { if (row && row.id) byId[row.id] = row; });
    got.rows.forEach((row) => { byId[row.id] = row; });
    const rows = Object.values(byId).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, KEEP);
    const authors = Object.assign({}, (prior && prior.authors) || {}, got.authors);
    const used = {};
    rows.forEach((row) => { if (authors[row.author]) used[row.author] = authors[row.author]; });
    const doc = { platform: "vk", guildId: SERVER_ID, channelId: cid, name: got.title.slice(0, 80), fetchedAt: new Date(now).toISOString(), older: false, via: got.via, authors: used, messages: rows };
    const text = JSON.stringify(doc);
    if (!prior || JSON.stringify(Object.assign({}, prior, { fetchedAt: doc.fetchedAt })) !== text) {
      await env.DATA.put(key, text, { httpMetadata: { contentType: "application/json" } });
    }
    listed.push({ id: cid, name: got.title.slice(0, 80), mode: "messages", icon: got.avatar, url: "https://vk.com/club" + got.gid });
    ok += 1;
  }
  if (listed.length) {
    const index = { fetchedAt: new Date(now).toISOString(), servers: [{ id: SERVER_ID, name: "VK", platform: "vk", url: "https://vk.com", channels: listed }] };
    await env.DATA.put("discord/vk.json", JSON.stringify(index), { httpMetadata: { contentType: "application/json" } });
  }
  return { channels: channels.length, ok: ok };
}

export function vkDue(at) {
  return Math.floor((Number(at) || Date.now()) / 60000) % 2 === 0;
}
