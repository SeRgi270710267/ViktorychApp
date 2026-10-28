/* Public posts inside the signed-in app. Text, replies, and quotes live in
   D1. Media is stored in R2 as the original bytes, with no re-encode.
   Block, mute, and a hidden flag keep people and reported posts out of the
   timeline. The moderation list is owner-only. */

import { awardActivity, clawback, giftForPost } from "./points.js";
import { canSeeAudience, setListGrants } from "./audience.js";

const POST_MAX = 500;
const MEDIA_MAX = 12 * 1024 * 1024;

export const POST_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS public_posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, body TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', quote_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, audience TEXT NOT NULL DEFAULT 'everyone', reply_control TEXT NOT NULL DEFAULT 'everyone', location TEXT NOT NULL DEFAULT '', poll_json TEXT NOT NULL DEFAULT '', scheduled_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS public_posts_recent ON public_posts(created_at DESC)",
  "CREATE TABLE IF NOT EXISTS public_post_media (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, object_key TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, alt_text TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS post_reports (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open')",
  "CREATE UNIQUE INDEX IF NOT EXISTS post_reports_once ON post_reports(post_id, reporter_id)",
  "CREATE TABLE IF NOT EXISTS account_blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (blocker_id, blocked_id))",
  "CREATE TABLE IF NOT EXISTS account_mutes (muter_id TEXT NOT NULL, muted_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (muter_id, muted_id))"
];

function cleanBody(value) {
  const text = String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text || Array.from(text).length > POST_MAX) return "";
  return text;
}

function cleanReason(value) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > 180) return "";
  return text;
}

function accountId(value) {
  const text = String(value || "");
  return /^\d{12}$/.test(text) ? text : "";
}

function postId(value) {
  const text = String(value || "");
  return /^[a-f0-9]{32}$/.test(text) ? text : "";
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function sniff(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { mime: "image/gif", ext: "gif" };
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return { mime: "video/mp4", ext: "mp4" };
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { mime: "video/webm", ext: "webm" };
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return { mime: "audio/mpeg", ext: "mp3" };
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return { mime: "audio/ogg", ext: "ogg" };
  return null;
}

const POST_COLUMNS = [
  "ALTER TABLE public_posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone'",
  "ALTER TABLE public_posts ADD COLUMN reply_control TEXT NOT NULL DEFAULT 'everyone'",
  "ALTER TABLE public_posts ADD COLUMN location TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE public_posts ADD COLUMN poll_json TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE public_posts ADD COLUMN scheduled_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE public_post_media ADD COLUMN alt_text TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE public_post_media ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
];

export async function ensurePostColumns(env) {
  if (!env || !env.DB) return;
  for (let i = 0; i < POST_COLUMNS.length; i++) {
    try {
      await env.DB.prepare(POST_COLUMNS[i]).run();
    } catch (err) {
      const message = String(err && err.message || err);
      if (!/duplicate column/i.test(message)) throw err;
    }
  }
}

export async function publishDuePosts(env, at) {
  if (!env || !env.DB) return;
  const now = Number(at) || Date.now();
  try {
    await env.DB.prepare("UPDATE public_posts SET scheduled_at = 0 WHERE scheduled_at > 0 AND scheduled_at <= ?").bind(now).run();
  } catch (err) {
    const message = String(err && err.message || err);
    if (!/no such column/i.test(message)) throw err;
  }
}

const POLL_MINUTES = [5, 60, 1440, 4320, 10080];

function cleanAudience(value) {
  const text = String(value || "");
  if (text === "friends" || text === "following") return text;
  if (text === "list" || text === "lists") return "list";
  return "everyone";
}

function cleanReply(value) {
  const text = String(value || "");
  return text === "following" || text === "verified" || text === "mentioned" ? text : "everyone";
}

function cleanLocation(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanPoll(value) {
  let data = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try { data = JSON.parse(value); } catch (err) { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const options = [];
  (Array.isArray(data.options) ? data.options : []).forEach((item) => {
    const text = String(item || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!text || Array.from(text).length > 25 || options.length >= 4) return;
    options.push(text);
  });
  if (options.length < 2) return null;
  const minutes = POLL_MINUTES.indexOf(Number(data.minutes)) >= 0 ? Number(data.minutes) : 1440;
  return { options: options, minutes: minutes };
}

function cleanSchedule(value, now) {
  const at = Number(value) || 0;
  if (!at || at <= now + 30 * 1000) return 0;
  if (at > now + 366 * 24 * 60 * 60 * 1000) return 0;
  return Math.floor(at);
}

function cleanAlt(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 1000);
}

function mediaKindOf(mime) {
  if (mime === "image/gif") return "gif";
  if (mime.indexOf("image/") === 0) return "image";
  if (mime.indexOf("video/") === 0) return "video";
  if (mime.indexOf("audio/") === 0) return "audio";
  return "other";
}

function parseMultipart(bytes, boundary) {
  const marker = encoderBytes("--" + boundary);
  const parts = [];
  let start = indexOf(bytes, marker, 0);
  if (start < 0) return parts;
  start += marker.length;
  while (start < bytes.length) {
    if (bytes[start] === 45 && bytes[start + 1] === 45) break;
    if (bytes[start] === 13) start += 2;
    else if (bytes[start] === 10) start += 1;
    const next = indexOf(bytes, marker, start);
    if (next < 0) break;
    let chunk = bytes.slice(start, next - 2);
    const split = indexOf(chunk, encoderBytes("\r\n\r\n"), 0);
    if (split >= 0) {
      const header = new TextDecoder().decode(chunk.slice(0, split));
      const body = chunk.slice(split + 4);
      const name = /name="([^"]+)"/.exec(header);
      const file = /filename="([^"]*)"/.exec(header);
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(header);
      parts.push({
        name: name ? name[1] : "",
        filename: file ? file[1] : "",
        type: type ? type[1].trim() : "",
        body: body
      });
    }
    start = next + marker.length;
  }
  return parts;
}

function encoderBytes(text) {
  return new TextEncoder().encode(text);
}

function indexOf(hay, needle, from) {
  for (let i = from; i + needle.length <= hay.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

async function readPostInput(request, deps) {
  const type = request.headers.get("content-type") || "";
  if (type.indexOf("multipart/form-data") === -1) {
    const body = await deps.readJson(request, 20000);
    if (body.error) return { error: body.error === "too_large" ? "too_large" : "bad_post", status: body.error === "too_large" ? 413 : 400 };
    return { fields: body, file: null };
  }
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!boundary) return { error: "bad_post", status: 400 };
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > MEDIA_MAX + 20000) return { error: "too_large", status: 413 };
  const parts = parseMultipart(raw, (boundary[1] || boundary[2] || "").trim());
  const fields = {};
  const files = [];
  const alts = [];
  parts.forEach((part) => {
    if (part.filename) files.push(part);
    else {
      const text = new TextDecoder().decode(part.body);
      if (part.name === "alt" || /^alt\d+$/.test(part.name)) alts.push(text);
      else fields[part.name] = text;
    }
  });
  fields.alts = alts;
  return { fields: fields, file: files[0] || null, files: files };
}

async function presentPost(env, request, row, viewerId) {
  const mediaRows = await env.DB.prepare("SELECT id, mime, size, alt_text, sort_order FROM public_post_media WHERE post_id = ? ORDER BY sort_order ASC, id ASC").bind(row.id).all();
  const media = ((mediaRows && mediaRows.results) || []).map((item) => ({
    id: item.id,
    mime: item.mime,
    size: item.size,
    alt: item.alt_text || "",
    url: new URL("/v1/posts/media/" + item.id, request.url).pathname
  }));
  let poll = null;
  if (row.poll_json) {
    try { poll = JSON.parse(row.poll_json); } catch (err) { poll = null; }
    if (!poll || !Array.isArray(poll.options)) poll = null;
  }
  let quote = null;
  if (row.quote_id) {
    const quoted = await env.DB.prepare("SELECT p.id, p.body, p.created_at, a.handle, a.display_name FROM public_posts p JOIN accounts a ON a.public_id = p.author_id WHERE p.id = ? AND p.hidden = 0").bind(row.quote_id).first();
    if (quoted) quote = { id: quoted.id, body: quoted.body, createdAt: quoted.created_at, authorName: quoted.display_name, authorHandle: quoted.handle };
  }
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    parentId: row.parent_id || "",
    quoteId: row.quote_id || "",
    authorId: row.author_id,
    authorName: row.display_name,
    authorHandle: row.handle,
    authorAvatar: row.avatar || "",
    media: media,
    quote: quote,
    audience: row.audience || "everyone",
    replyControl: row.reply_control || "everyone",
    location: row.location || "",
    poll: poll,
    scheduledAt: Number(row.scheduled_at) || 0,
    gift: await giftForPost(env, row.id, viewerId || "")
  };
}

async function hiddenAuthors(env, viewerId) {
  const blocked = await env.DB.prepare("SELECT blocked_id AS id FROM account_blocks WHERE blocker_id = ? UNION SELECT blocker_id AS id FROM account_blocks WHERE blocked_id = ? UNION SELECT muted_id AS id FROM account_mutes WHERE muter_id = ?").bind(viewerId, viewerId, viewerId).all();
  const ids = new Set();
  ((blocked && blocked.results) || []).forEach((row) => ids.add(row.id));
  return ids;
}

function gifHostOk(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "gifcities.org" || host === "web.archive.org" || host === "archive.org" || host.endsWith(".archive.org");
}

async function searchGifs(request, env, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const gate = await deps.rateHit(env, "gif:" + session.public_id, 30, 60 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const q = String(new URL(request.url).searchParams.get("q") || "").replace(/[\u0000-\u001F\u007F<>"']/g, "").trim().slice(0, 40);
  if (!q) return deps.json(400, { error: "bad_query" });
  let res;
  try {
    res = await fetch("https://gifcities.org/api/v1/gifsearch?limit=12&q=" + encodeURIComponent(q), {
      headers: { accept: "application/json", "user-agent": "ViktorychApp/1.0" }
    });
  } catch (err) {
    return deps.json(503, { error: "unavailable" });
  }
  if (!res || !res.ok) return deps.json(503, { error: "unavailable" });
  let data = [];
  try { data = await res.json(); } catch (err) { return deps.json(503, { error: "unavailable" }); }
  const gifs = [];
  (Array.isArray(data) ? data : []).forEach((item) => {
    if (!item || gifs.length >= 12) return;
    let parsed;
    try { parsed = new URL(String(item.gif || item.url || item.src || "")); } catch (err) { return; }
    if (parsed.protocol !== "https:" || !gifHostOk(parsed.hostname)) return;
    gifs.push({ url: parsed.toString().slice(0, 500) });
  });
  return deps.json(200, { gifs: gifs });
}

async function gifFile(request, env, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const gate = await deps.rateHit(env, "giffile:" + session.public_id, 40, 60 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  let target;
  try { target = new URL(new URL(request.url).searchParams.get("u") || ""); } catch (err) { return deps.json(400, { error: "bad_query" }); }
  if (target.protocol !== "https:" || !gifHostOk(target.hostname)) return deps.json(400, { error: "bad_query" });
  let res;
  try {
    res = await fetch(target.toString(), { headers: { "user-agent": "ViktorychApp/1.0", accept: "image/gif,image/*" } });
  } catch (err) { return deps.json(503, { error: "unavailable" }); }
  if (!res || !res.ok) return deps.json(503, { error: "unavailable" });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 6 || bytes.length > 8 * 1024 * 1024) return deps.json(413, { error: "too_large" });
  const kind = sniff(bytes);
  if (!kind || kind.mime !== "image/gif") return deps.json(400, { error: "bad_media" });
  const headers = new Headers();
  headers.set("content-type", "image/gif");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(bytes, { status: 200, headers: headers });
}

export async function handlePosts(request, env, path, deps) {
  if (path === "/v1/gif" && request.method === "GET") return searchGifs(request, env, deps);
  if (path === "/v1/gif/file" && request.method === "GET") return gifFile(request, env, deps);
  const media = path.match(/^\/v1\/posts\/media\/([a-f0-9]{32})$/);
  if (media && request.method === "GET") return readMedia(request, env, media[1], deps);
  if (path === "/v1/posts" && request.method === "GET") return listPosts(request, env, deps);
  if (path === "/v1/posts" && request.method === "POST") return createPost(request, env, deps);
  if (path === "/v1/posts/report" && request.method === "POST") return reportPost(request, env, deps);
  if (path === "/v1/blocks" && request.method === "POST") return setRelation(request, env, deps, "account_blocks", "blocker_id", "blocked_id", true);
  if (path === "/v1/blocks" && request.method === "DELETE") return setRelation(request, env, deps, "account_blocks", "blocker_id", "blocked_id", false);
  if (path === "/v1/mutes" && request.method === "POST") return setRelation(request, env, deps, "account_mutes", "muter_id", "muted_id", true);
  if (path === "/v1/mutes" && request.method === "DELETE") return setRelation(request, env, deps, "account_mutes", "muter_id", "muted_id", false);
  if (path === "/v1/moderation/reports" && request.method === "GET") return listReports(request, env, deps);
  if (path === "/v1/moderation/reports" && request.method === "POST") return resolveReport(request, env, deps);
  return null;
}

async function audienceSets(env, viewerId, authors) {
  const friends = new Set();
  const following = new Set();
  const ids = authors.filter((id) => id && id !== viewerId);
  if (!ids.length) return { friends: friends, following: following };
  const marks = ids.map(() => "?").join(",");
  try {
    const friendRows = await env.DB.prepare("SELECT friend_id FROM account_friends WHERE user_id = ? AND friend_id IN (" + marks + ")").bind(viewerId, ...ids).all();
    ((friendRows && friendRows.results) || []).forEach((row) => friends.add(row.friend_id));
  } catch (err) { /* a missing friends table hides circle posts */ }
  try {
    const followRows = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE target_id = ? AND follower_id IN (" + marks + ")").bind("app:" + viewerId, ...ids).all();
    ((followRows && followRows.results) || []).forEach((row) => following.add(row.follower_id));
  } catch (err) { /* a missing follow table hides that audience */ }
  return { friends: friends, following: following };
}

function canSee(row, viewerId, sets) {
  if (row.author_id === viewerId) return true;
  const audience = row.audience || "everyone";
  if (audience === "list") return false;
  if (audience === "friends") return sets.friends.has(row.author_id);
  if (audience === "following") return sets.following.has(row.author_id);
  return true;
}

function listIdsOf(fields) {
  let raw = fields && fields.listIds;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (err) { raw = []; }
  }
  return Array.isArray(raw) ? raw : [];
}

async function listPosts(request, env, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const now = Date.now();
  const listed = await env.DB.prepare("SELECT p.id, p.author_id, p.body, p.parent_id, p.quote_id, p.created_at, p.hidden, p.audience, p.reply_control, p.location, p.poll_json, p.scheduled_at, a.handle, a.display_name, a.avatar FROM public_posts p JOIN accounts a ON a.public_id = p.author_id WHERE p.hidden = 0 AND (p.scheduled_at = 0 OR p.scheduled_at <= ?) ORDER BY p.created_at DESC LIMIT 60").bind(now).all();
  const skip = await hiddenAuthors(env, session.public_id);
  const rows = ((listed && listed.results) || []).filter((row) => !skip.has(row.author_id));
  const sets = await audienceSets(env, session.public_id, rows.map((row) => row.author_id));
  const visible = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((row.audience || "") === "list") {
      if (await canSeeAudience(env, { viewerId: session.public_id, ownerId: row.author_id, audience: "list", subject: "post", subjectId: row.id })) visible.push(row);
      continue;
    }
    if (canSee(row, session.public_id, sets)) visible.push(row);
  }
  const posts = [];
  for (let i = 0; i < visible.length && posts.length < 40; i++) posts.push(await presentPost(env, request, visible[i], session.public_id));
  return deps.json(200, { posts: posts });
}

async function replyAllowed(env, session, parent) {
  const control = parent.reply_control || "everyone";
  if (!control || control === "everyone" || parent.author_id === session.public_id) return true;
  if (control === "following") {
    const row = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE follower_id = ? AND target_id = ?").bind(parent.author_id, "app:" + session.public_id).first();
    return !!row;
  }
  if (control === "verified") {
    try {
      const row = await env.DB.prepare("SELECT id FROM account_identities WHERE public_id = ? AND verified = 1 LIMIT 1").bind(session.public_id).first();
      return !!row;
    } catch (err) { return false; }
  }
  if (control === "mentioned") {
    const handle = String(session.handle || "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,32}$/.test(handle)) return false;
    return new RegExp("(^|[^A-Za-z0-9_])@" + handle + "(?![A-Za-z0-9_])", "i").test(String(parent.body || ""));
  }
  return true;
}

async function createPost(request, env, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const gate = await deps.rateHit(env, "post:" + session.public_id, 20, 60 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const input = await readPostInput(request, deps);
  if (input.error) return deps.json(input.status || 400, { error: input.error });
  const poll = cleanPoll(input.fields.poll);
  const body = cleanBody(input.fields.body);
  const files = Array.isArray(input.files) ? input.files : (input.file ? [input.file] : []);
  if (!body && !files.length && !poll) return deps.json(400, { error: "bad_post" });
  if (poll && files.length) return deps.json(400, { error: "bad_post" });
  const parent = input.fields.parentId ? postId(input.fields.parentId) : "";
  const quote = input.fields.quoteId ? postId(input.fields.quoteId) : "";
  if (input.fields.parentId && !parent) return deps.json(400, { error: "bad_post" });
  if (input.fields.quoteId && !quote) return deps.json(400, { error: "bad_post" });
  if (parent) {
    const parentRow = await env.DB.prepare("SELECT id, author_id, body, reply_control, hidden, scheduled_at FROM public_posts WHERE id = ? AND hidden = 0").bind(parent).first();
    if (!parentRow) return deps.json(404, { error: "not_found" });
    if (Number(parentRow.scheduled_at) > Date.now()) return deps.json(404, { error: "not_found" });
    if (!(await replyAllowed(env, session, parentRow))) return deps.json(403, { error: "reply_limited" });
  }
  if (quote) {
    const quoteRow = await env.DB.prepare("SELECT id, scheduled_at FROM public_posts WHERE id = ? AND hidden = 0").bind(quote).first();
    if (!quoteRow || Number(quoteRow.scheduled_at) > Date.now()) return deps.json(404, { error: "not_found" });
  }
  const stored = [];
  if (files.length) {
    if (!env.DATA) return deps.json(503, { error: "not_configured" });
    const kinds = [];
    for (let i = 0; i < files.length; i++) {
      const bytes = files[i].body;
      if (!bytes || bytes.length < 8 || bytes.length > MEDIA_MAX) return deps.json(413, { error: "too_large" });
      let kind = sniff(bytes);
      if (!kind) return deps.json(400, { error: "bad_media" });
      if (String(input.fields.mediaKind || "") === "audio" && kind.mime === "video/webm") kind = { mime: "audio/webm", ext: "webm" };
      kinds.push(kind);
    }
    const labels = kinds.map((kind) => mediaKindOf(kind.mime));
    const gif = labels.filter((kind) => kind === "gif").length;
    const video = labels.filter((kind) => kind === "video").length;
    const image = labels.filter((kind) => kind === "image").length;
    const audio = labels.filter((kind) => kind === "audio").length;
    if (labels.some((kind) => kind === "other") || (gif && (video || image || audio)) || (video && (image || audio)) || (image && audio) || gif > 1 || video > 1 || audio > 1 || image > 4) {
      return deps.json(400, { error: "bad_media" });
    }
    const alts = Array.isArray(input.fields.alts) ? input.fields.alts : [];
    for (let i = 0; i < files.length; i++) {
      const id = randomId();
      const key = "post-media/" + id + "." + kinds[i].ext;
      await env.DATA.put(key, files[i].body, { httpMetadata: { contentType: kinds[i].mime } });
      stored.push({ id: id, key: key, mime: kinds[i].mime, size: files[i].body.length, alt: cleanAlt(alts[i] || ""), order: i });
    }
  }
  const id = randomId();
  const now = Date.now();
  const when = cleanSchedule(input.fields.scheduledAt, now);
  const created = when || now;
  const audience = cleanAudience(input.fields.audience);
  await env.DB.prepare("INSERT INTO public_posts (id, author_id, body, parent_id, quote_id, created_at, hidden, audience, reply_control, location, poll_json, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)").bind(
    id, session.public_id, body, parent, quote, created, audience, cleanReply(input.fields.replyControl), cleanLocation(input.fields.location), poll ? JSON.stringify(poll) : "", when
  ).run();
  if (audience === "list") await setListGrants(env, session.public_id, "post", id, listIdsOf(input.fields));
  for (let i = 0; i < stored.length; i++) {
    const item = stored[i];
    await env.DB.prepare("INSERT INTO public_post_media (id, post_id, object_key, mime, size, alt_text, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      item.id, id, item.key, item.mime, item.size, item.alt, item.order
    ).run();
  }
  const row = await env.DB.prepare("SELECT p.id, p.author_id, p.body, p.parent_id, p.quote_id, p.created_at, p.audience, p.reply_control, p.location, p.poll_json, p.scheduled_at, a.handle, a.display_name, a.avatar FROM public_posts p JOIN accounts a ON a.public_id = p.author_id WHERE p.id = ?").bind(id).first();
  try {
    await awardActivity(env, session.public_id, parent ? "comment" : "post", id);
    if (parent) {
      const parentRow = await env.DB.prepare("SELECT author_id FROM public_posts WHERE id = ?").bind(parent).first();
      if (parentRow && parentRow.author_id && parentRow.author_id !== session.public_id) {
        await awardActivity(env, parentRow.author_id, "reply_in", id);
      }
    }
  } catch (err) { /* the post is saved */ }
  return deps.json(201, { post: await presentPost(env, request, row, session.public_id), scheduled: when > 0 });
}

async function readMedia(request, env, id, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const row = await env.DB.prepare("SELECT object_key, mime, size, post_id FROM public_post_media WHERE id = ?").bind(id).first();
  if (!row || !env.DATA) return deps.json(404, { error: "not_found" });
  const post = await env.DB.prepare("SELECT hidden, author_id, audience FROM public_posts WHERE id = ?").bind(row.post_id).first();
  if (!post || post.hidden) return deps.json(404, { error: "not_found" });
  const skip = await hiddenAuthors(env, session.public_id);
  if (skip.has(post.author_id)) return deps.json(404, { error: "not_found" });
  if ((post.audience || "") === "list" && !(await canSeeAudience(env, { viewerId: session.public_id, ownerId: post.author_id, audience: "list", subject: "post", subjectId: row.post_id }))) {
    return deps.json(404, { error: "not_found" });
  }
  const object = await env.DATA.get(row.object_key);
  if (!object) return deps.json(404, { error: "not_found" });
  const headers = new Headers();
  headers.set("content-type", row.mime || "application/octet-stream");
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { status: 200, headers: headers });
}

async function reportPost(request, env, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const gate = await deps.rateHit(env, "report:" + session.public_id, 30, 60 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const body = await deps.readJson(request, 2000);
  if (body.error) return deps.json(400, { error: body.error });
  const id = postId(body.postId);
  const reason = cleanReason(body.reason);
  if (!id || !reason) return deps.json(400, { error: "bad_report" });
  const post = await env.DB.prepare("SELECT id FROM public_posts WHERE id = ? AND hidden = 0").bind(id).first();
  if (!post) return deps.json(404, { error: "not_found" });
  try {
    await env.DB.prepare("INSERT INTO post_reports (id, post_id, reporter_id, reason, created_at, status) VALUES (?, ?, ?, ?, ?, 'open')").bind(
      randomId(), id, session.public_id, reason, Date.now()
    ).run();
  } catch (err) {
    const message = String(err && err.message || err);
    if (!/UNIQUE/i.test(message)) throw err;
  }
  return deps.json(200, { ok: true });
}

async function setRelation(request, env, deps, table, selfCol, otherCol, on) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const body = await deps.readJson(request, 1000);
  if (body.error) return deps.json(400, { error: body.error });
  const other = accountId(body.accountId);
  if (!other || other === session.public_id) return deps.json(400, { error: "bad_account" });
  const exists = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(other).first();
  if (!exists) return deps.json(404, { error: "not_found" });
  if (on) {
    await env.DB.prepare("INSERT INTO " + table + " (" + selfCol + ", " + otherCol + ", created_at) VALUES (?, ?, ?) ON CONFLICT(" + selfCol + ", " + otherCol + ") DO NOTHING").bind(session.public_id, other, Date.now()).run();
  } else {
    await env.DB.prepare("DELETE FROM " + table + " WHERE " + selfCol + " = ? AND " + otherCol + " = ?").bind(session.public_id, other).run();
  }
  return deps.json(200, { ok: true });
}

async function listReports(request, env, deps) {
  const gate = await deps.requireOwner(request, env);
  if (gate.error) return gate.error;
  const listed = await env.DB.prepare("SELECT r.id, r.post_id, r.reason, r.created_at, r.status, p.body, p.hidden FROM post_reports r JOIN public_posts p ON p.id = r.post_id WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 50").all();
  const reports = ((listed && listed.results) || []).map((row) => ({
    id: row.id,
    postId: row.post_id,
    reason: row.reason,
    createdAt: row.created_at,
    body: row.body,
    hidden: row.hidden === 1
  }));
  return deps.json(200, { reports: reports });
}

async function resolveReport(request, env, deps) {
  const gate = await deps.requireOwner(request, env);
  if (gate.error) return gate.error;
  const body = await deps.readJson(request, 1000);
  if (body.error) return deps.json(400, { error: body.error });
  const id = String(body.id || "");
  if (!/^[a-f0-9]{32}$/.test(id)) return deps.json(400, { error: "bad_report" });
  const action = body.action === "hide" ? "hide" : body.action === "dismiss" ? "dismiss" : "";
  if (!action) return deps.json(400, { error: "bad_report" });
  const row = await env.DB.prepare("SELECT post_id FROM post_reports WHERE id = ?").bind(id).first();
  if (!row) return deps.json(404, { error: "not_found" });
  if (action === "hide") {
    const hiddenPost = await env.DB.prepare("SELECT author_id, parent_id FROM public_posts WHERE id = ?").bind(row.post_id).first();
    await env.DB.prepare("UPDATE public_posts SET hidden = 1 WHERE id = ?").bind(row.post_id).run();
    if (hiddenPost && hiddenPost.author_id) {
      try { await clawback(env, hiddenPost.author_id, hiddenPost.parent_id ? "comment" : "post", row.post_id); }
      catch (err) { /* the post is still hidden */ }
    }
    await env.DB.prepare("UPDATE post_reports SET status = 'hidden' WHERE post_id = ? AND status = 'open'").bind(row.post_id).run();
    try {
      const reporters = await env.DB.prepare("SELECT reporter_id FROM post_reports WHERE post_id = ? AND status = 'hidden' LIMIT 20").bind(row.post_id).all();
      const badges = await import("./badges.js");
      const found = (reporters && reporters.results) || [];
      for (let i = 0; i < found.length; i++) await badges.syncBadges(env, found[i].reporter_id);
    } catch (err) { /* the report is already resolved */ }
  } else {
    await env.DB.prepare("UPDATE post_reports SET status = 'dismissed' WHERE id = ?").bind(id).run();
  }
  return deps.json(200, { ok: true });
}
