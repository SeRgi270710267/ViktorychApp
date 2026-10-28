/** Internal posts on a mirrored subreddit. Nothing here calls Reddit. */

import { invalidate, readThrough } from "./edge-cache.js";
import { logError } from "./log.js";
import { notifyCommunity, planNotification } from "./notifications.js";
import { commitBundled, planMentions } from "./mention-store.js";
import { blocksEither, hiddenAuthorSet } from "./social.js";
import { awardActivity, clawback } from "./points.js";
import { redactPublicIds } from "../../shared/profile-privacy.js";
import { visibleAvatarUrl } from "./profile-media.js";

export const COMMUNITY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS community_posts (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, author_id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS community_posts_feed ON community_posts(community_id, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS community_likes (public_id TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (public_id, item_id))",
  "CREATE TABLE IF NOT EXISTS community_members (community_id TEXT NOT NULL, public_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (community_id, public_id))",
  "CREATE TABLE IF NOT EXISTS community_notes (id TEXT PRIMARY KEY, public_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS community_notes_account ON community_notes(public_id, seen, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS community_meta (community_id TEXT PRIMARY KEY, visibility TEXT NOT NULL DEFAULT 'public', updated_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS community_feed_prefs (public_id TEXT NOT NULL, community_id TEXT NOT NULL DEFAULT '', show_home INTEGER NOT NULL DEFAULT 1, muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (public_id, community_id))",
  "CREATE INDEX IF NOT EXISTS community_posts_home ON community_posts(deleted_at, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS community_posts_parent ON community_posts(parent_id)",
  "CREATE INDEX IF NOT EXISTS community_members_account ON community_members(public_id, community_id)"
];

const COMMUNITIES_KEY = "owner/added-communities.json";
const NAME_RE = /^[a-z0-9_]{2,21}$/;
const PARENT_RE = /^(?:t[13]_[A-Za-z0-9]{1,12}|va_[a-f0-9]{16}|[0-9]{1,18}|[a-z0-9_-]{1,32})$/;
const CAP = 40;

export function communityName(value) {
  let text = String(value || "").trim();
  text = text.replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\//i, "");
  text = text.replace(/^\/?r\//i, "");
  text = text.split(/[/?#]/)[0];
  text = text.toLowerCase();
  return NAME_RE.test(text) ? text : "";
}

function cleanBody(value) {
  const text = String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text || Array.from(text).length > 1000) return "";
  return text;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return "va_" + hex;
}

async function readOwner(env) {
  const empty = { added: [], removed: [] };
  if (!env.DATA) return empty;
  const object = await env.DATA.get(COMMUNITIES_KEY);
  if (!object) return empty;
  try {
    const parsed = JSON.parse(await object.text());
    const added = [];
    const removed = [];
    for (const row of (parsed && parsed.added) || []) {
      const name = communityName(row && row.name);
      if (!name || added.some((item) => item.name === name)) continue;
      added.push({ name, title: String((row && row.title) || "").slice(0, 80), addedAt: Number(row && row.addedAt) || 0 });
    }
    for (const item of (parsed && parsed.removed) || []) {
      const name = communityName(item);
      if (name && removed.indexOf(name) < 0) removed.push(name);
    }
    return { added, removed };
  } catch (err) {
    return empty;
  }
}

async function writeOwner(env, doc) {
  await env.DATA.put(COMMUNITIES_KEY, JSON.stringify({
    added: (doc.added || []).slice(0, CAP),
    removed: (doc.removed || []).slice(-200)
  }));
}

async function authorOf(env, request, publicId, presentAccount) {
  const row = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, location, website, owner, created_at, hide_avatar, avatar_empty, banner_empty, profile_less FROM accounts WHERE public_id = ?").bind(publicId).first();
  if (!row) return { publicId: "", handle: "", displayName: "", avatar: "", owner: false, profileLess: false };
  if (row.profile_less === 1) {
    return {
      publicId: "",
      handle: "anonymous",
      displayName: "Anonymous",
      avatar: "",
      owner: false,
      profileLess: true
    };
  }
  const pub = await presentAccount(env, request, row, false, { skipMedia: true });
  return {
    publicId: "",
    handle: pub.handle || "",
    displayName: pub.displayName || "",
    avatar: "",
    owner: pub.owner === true,
    profileLess: false
  };
}

async function fillAuthor(env, request, viewer, author) {
  if (!author || author.profileLess) return author;
  author.publicId = "";
  if (author.handle) author.avatar = await visibleAvatarUrl(env, request, viewer, author.handle);
  return author;
}

async function visibilityOf(env, name) {
  try {
    const row = await env.DB.prepare("SELECT visibility FROM community_meta WHERE community_id = ?").bind(name).first();
    const value = row && row.visibility;
    if (value === "private" || value === "restricted" || value === "public") return value;
  } catch (err) { /* missing table stays public */ }
  return "public";
}

async function memberOf(env, name, publicId) {
  const row = await env.DB.prepare("SELECT public_id FROM community_members WHERE community_id = ? AND public_id = ?").bind(name, publicId).first();
  return !!row;
}

async function canReadCommunity(env, name, viewerId) {
  const visibility = await visibilityOf(env, name);
  if (visibility === "public") return true;
  return memberOf(env, name, viewerId);
}

async function writeFeedPref(env, publicId, communityId, patch) {
  const current = await env.DB.prepare("SELECT show_home, muted FROM community_feed_prefs WHERE public_id = ? AND community_id = ?").bind(publicId, communityId).first();
  const show = patch.showHome == null ? (current ? Number(current.show_home) : 1) : (patch.showHome ? 1 : 0);
  const muted = patch.muted == null ? (current ? Number(current.muted) : 0) : (patch.muted ? 1 : 0);
  await env.DB.prepare("INSERT INTO community_feed_prefs (public_id, community_id, show_home, muted) VALUES (?, ?, ?, ?) ON CONFLICT(public_id, community_id) DO UPDATE SET show_home = excluded.show_home, muted = excluded.muted").bind(publicId, communityId, show, muted).run();
  return { showHome: show === 1, muted: muted === 1 };
}

function rootOf(parentId, id) {
  const parent = String(parentId || "");
  return parent || id;
}

export async function communityHomeRows(env, request, viewerId, presentAccount) {
  let communitiesHome = true;
  try {
    const global = await env.DB.prepare("SELECT show_home FROM community_feed_prefs WHERE public_id = ? AND community_id = ''").bind(viewerId).first();
    if (global && Number(global.show_home) === 0) communitiesHome = false;
  } catch (err) {
    return { posts: [], communitiesHome: true };
  }
  if (!communitiesHome) return { posts: [], communitiesHome: false };
  let listed;
  try {
    listed = await env.DB.prepare(
      "SELECT c.id, c.author_id, c.parent_id, c.body, c.created_at, c.community_id, a.handle, a.display_name, a.avatar, a.profile_less FROM community_posts c JOIN accounts a ON a.public_id = c.author_id LEFT JOIN community_meta meta ON meta.community_id = c.community_id LEFT JOIN community_members mem ON mem.community_id = c.community_id AND mem.public_id = ? LEFT JOIN community_feed_prefs pref ON pref.public_id = ? AND pref.community_id = c.community_id WHERE c.deleted_at = 0 AND COALESCE(pref.show_home, 1) = 1 AND COALESCE(pref.muted, 0) = 0 AND ((COALESCE(meta.visibility, 'public') = 'public' AND (mem.public_id IS NOT NULL OR c.author_id = ?)) OR (COALESCE(meta.visibility, 'public') != 'public' AND mem.public_id IS NOT NULL)) ORDER BY c.created_at DESC LIMIT 40"
    ).bind(viewerId, viewerId, viewerId).all();
  } catch (err) {
    return { posts: [], communitiesHome: true };
  }
  const rows = (listed && listed.results) || [];
  const ids = rows.map((row) => row.id);
  const likes = {};
  const replies = {};
  if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    try {
      const likeRows = await env.DB.prepare("SELECT item_id, COUNT(*) AS n FROM community_likes WHERE item_id IN (" + marks + ") GROUP BY item_id").bind(...ids).all();
      ((likeRows && likeRows.results) || []).forEach((row) => { likes[row.item_id] = Number(row.n) || 0; });
      const replyRows = await env.DB.prepare("SELECT parent_id, COUNT(*) AS n FROM community_posts WHERE deleted_at = 0 AND parent_id IN (" + marks + ") GROUP BY parent_id").bind(...ids).all();
      ((replyRows && replyRows.results) || []).forEach((row) => { replies[row.parent_id] = Number(row.n) || 0; });
    } catch (err) { /* counts stay at zero */ }
  }
  const posts = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const less = row.profile_less === 1;
    let authorName = row.display_name || "";
    let authorHandle = row.handle || "";
    let authorAvatar = "";
    if (less) {
      authorName = "Anonymous";
      authorHandle = "anonymous";
    } else if (presentAccount && row.handle) {
      try { authorAvatar = await visibleAvatarUrl(env, request, { public_id: viewerId }, row.handle); }
      catch (err) { authorAvatar = ""; }
    }
    posts.push({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      parentId: row.parent_id || "",
      quoteId: "",
      authorId: less ? "" : row.author_id,
      authorName: authorName,
      authorHandle: authorHandle,
      authorAvatar: authorAvatar,
      media: [],
      quote: null,
      audience: "everyone",
      replyControl: "everyone",
      location: "",
      poll: null,
      scheduledAt: 0,
      gift: null,
      likes: likes[row.id] || 0,
      replyCount: replies[row.id] || 0,
      community: { name: row.community_id, rootId: rootOf(row.parent_id, row.id) }
    });
  }
  return { posts: posts, communitiesHome: true };
}

export async function addCommunityPost(env, request, opts) {
  const row = opts.viewer;
  const text = cleanBody(opts.text || "");
  const parent = String(opts.parentId || "");
  const presentAccount = opts.presentAccount;
  if (!text) return { status: 400, error: "bad_post" };
  if (parent && !PARENT_RE.test(parent) && parent.indexOf("va_") !== 0) return { status: 400, error: "bad_parent" };
  let name = communityName(opts.name);
  let parentAuthor = "";
  if (parent.indexOf("va_") === 0) {
    const existing = await env.DB.prepare("SELECT id, author_id, community_id FROM community_posts WHERE id = ? AND deleted_at = 0").bind(parent).first();
    if (!existing) return { status: 404, error: "not_found" };
    if (name && existing.community_id !== name) return { status: 404, error: "not_found" };
    name = existing.community_id;
    if (!(await canReadCommunity(env, name, row.public_id))) return { status: 404, error: "not_found" };
    if (await blocksEither(env, row.public_id, existing.author_id)) return { status: 403, error: "blocked" };
    parentAuthor = existing.author_id;
  }
  if (!name) return { status: 400, error: "bad_community" };
  const visibility = await visibilityOf(env, name);
  if (visibility !== "public" && !(await memberOf(env, name, row.public_id)) && row.owner !== 1) {
    return { status: 403, error: "forbidden" };
  }
  const id = newId();
  const now = Date.now();
  const author = await authorOf(env, request, row.public_id, presentAccount);
  const statements = [
    env.DB.prepare("INSERT INTO community_posts (id, community_id, author_id, parent_id, body, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 0)").bind(id, name, row.public_id, parent, text, now)
  ];
  const deliveries = [];
  if (parentAuthor && parentAuthor !== row.public_id) {
    const noteId = "cm_" + id;
    const payload = {
      id: noteId,
      at: now,
      handle: author.handle,
      name: author.displayName,
      text: Array.from(text).slice(0, 180).join(""),
      avatar: "",
      hash: "#/communities/" + name + "/" + encodeURIComponent(parent),
      platform: "app",
      feedId: "community:" + name
    };
    statements.push(env.DB.prepare("INSERT INTO community_notes (id, public_id, payload, created_at, seen) VALUES (?, ?, ?, ?, 0)").bind(noteId, parentAuthor, JSON.stringify(payload), now));
    const reply = await planNotification(env, {
      publicId: parentAuthor,
      kind: "reply",
      at: now,
      actorId: row.public_id,
      idempotencyKey: "reply:" + id,
      handle: author.handle,
      name: author.displayName,
      text: Array.from(text).slice(0, 180).join(""),
      avatar: "",
      hash: "#/communities/" + name + "/" + encodeURIComponent(parent),
      platform: "app",
      feedId: "community:" + name
    });
    if (reply && reply.statements) reply.statements.forEach((statement) => statements.push(statement));
    if (reply && reply.deliveries) reply.deliveries.forEach((delivery) => deliveries.push(delivery));
  }
  const planned = await planMentions(env, {
    actor: { public_id: row.public_id, handle: author.handle, display_name: author.displayName },
    sourceId: id,
    kind: parent ? "reply" : "post",
    text,
    at: now,
    exceptIds: [parentAuthor, row.public_id],
    hash: "#/communities/" + name + "/" + encodeURIComponent(parent || id)
  });
  await commitBundled(env, statements.concat(planned.statements), deliveries.concat(planned.deliveries), request);
  await dropFeed(env, name);
  await fillAuthor(env, request, row, author);
  const post = { id, authorId: "", parentId: parent, body: text, createdAt: now, author: redactPublicIds(author), mine: true };
  const home = {
    id: id,
    body: text,
    createdAt: now,
    parentId: parent,
    quoteId: "",
    authorId: author.profileLess ? "" : row.public_id,
    authorName: author.displayName || "",
    authorHandle: author.handle || "",
    authorAvatar: author.avatar || "",
    media: [],
    quote: null,
    audience: "everyone",
    replyControl: "everyone",
    location: "",
    poll: null,
    scheduledAt: 0,
    gift: null,
    likes: 0,
    replyCount: 0,
    community: { name: name, rootId: rootOf(parent, id) }
  };
  return { status: 200, post: post, home: home };
}

async function requireUser(request, env, sessionAccount, json) {
  const row = await sessionAccount(env, request);
  if (!row) return { error: json(404, { error: "not_found" }) };
  return { row };
}

export async function handleCommunityRoute(request, env, path, url, deps) {
  const { json, sessionAccount, rateHit, limited, readJson, requireOwnerHidden, dispatchWorkflows, presentAccount } = deps;
  if (path === "/v1/owner/communities" || path.startsWith("/v1/owner/communities/")) {
    return handleOwner(request, env, path, { json, rateHit, limited, readJson, requireOwnerHidden, dispatchWorkflows });
  }
  const gate = await requireUser(request, env, sessionAccount, json);
  if (gate.error) return gate.error;
  const row = gate.row;
  if (path === "/v1/communities/notes" && request.method === "GET") return listNotes(request, env, row, json, rateHit, limited);
  if (path === "/v1/communities/notes/seen" && request.method === "POST") return seeNotes(request, env, row, json, readJson, rateHit, limited);
  if (path === "/v1/communities/home" && request.method === "GET") return readGlobalHome(env, row, json);
  if (path === "/v1/communities/home" && request.method === "POST") return writeGlobalHome(request, env, row, json, readJson, rateHit, limited);
  const parts = path.split("/").filter(Boolean);
  // v1 communities :name ...
  if (parts[0] !== "v1" || parts[1] !== "communities" || !parts[2]) return json(404, { error: "not_found" });
  const name = communityName(parts[2]);
  if (!name) return json(400, { error: "bad_community" });
  if (parts.length === 3 && request.method === "GET") return readFeed(request, env, name, row, json, rateHit, limited, presentAccount);
  if (parts.length === 4 && parts[3] === "posts" && request.method === "POST") return createPost(request, env, name, row, json, readJson, rateHit, limited, presentAccount);
  if (parts.length === 5 && parts[3] === "posts" && request.method === "PATCH") return editPost(request, env, name, parts[4], row, json, readJson, rateHit, limited);
  if (parts.length === 5 && parts[3] === "posts" && request.method === "DELETE") return deletePost(env, name, parts[4], row, json, rateHit, limited);
  if (parts.length === 4 && parts[3] === "likes" && (request.method === "POST" || request.method === "DELETE")) return setLike(request, env, row, json, readJson, rateHit, limited);
  if (parts.length === 4 && parts[3] === "join" && (request.method === "POST" || request.method === "DELETE")) return setJoin(env, name, row, request.method === "POST", json, rateHit, limited);
  if (parts.length === 4 && parts[3] === "feed" && request.method === "POST") return writeCommunityFeed(request, env, name, row, json, readJson, rateHit, limited);
  if (parts.length === 4 && parts[3] === "visibility" && request.method === "POST") return writeVisibility(request, env, name, row, json, readJson, rateHit, limited);
  return json(404, { error: "not_found" });
}

async function handleOwner(request, env, path, deps) {
  const { json, rateHit, limited, readJson, requireOwnerHidden, dispatchWorkflows } = deps;
  const gate = await requireOwnerHidden(request, env);
  if (gate.error) return gate.error;
  if (!env.DATA) return json(503, { error: "not_configured" });
  const bucket = "communities:" + gate.row.public_id;
  if (path === "/v1/owner/communities" && request.method === "GET") {
    const hit = await rateHit(env, bucket + ":list", 60, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const doc = await readOwner(env);
    return json(200, { added: doc.added });
  }
  if (path === "/v1/owner/communities" && request.method === "POST") {
    const hit = await rateHit(env, bucket + ":add", 20, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const body = await readJson(request, 2000);
    if (body.error) return json(400, { error: body.error });
    const name = communityName(body.name || body.url || "");
    if (!name) return json(400, { error: "bad_community" });
    const doc = await readOwner(env);
    doc.removed = doc.removed.filter((item) => item !== name);
    if (!doc.added.some((item) => item.name === name)) {
      if (doc.added.length >= CAP) return json(400, { error: "full" });
      doc.added.push({ name, title: "", addedAt: Date.now() });
    }
    await writeOwner(env, doc);
    let dispatched = false;
    try { dispatched = await dispatchWorkflows(env, ["sync.yml", "reddit.yml"]); }
    catch (err) { dispatched = false; }
    return json(200, { community: { name }, dispatched });
  }
  const match = path.match(/^\/v1\/owner\/communities\/([^/]+)$/);
  if (match && request.method === "DELETE") {
    const hit = await rateHit(env, bucket + ":remove", 30, 60 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const name = communityName(decodeURIComponent(match[1]));
    if (!name) return json(400, { error: "bad_community" });
    const doc = await readOwner(env);
    doc.added = doc.added.filter((item) => item.name !== name);
    if (doc.removed.indexOf(name) < 0) doc.removed.push(name);
    await writeOwner(env, doc);
    let dispatched = false;
    try { dispatched = await dispatchWorkflows(env, ["sync.yml", "reddit.yml"]); }
    catch (err) { dispatched = false; }
    return json(200, { removed: true, dispatched });
  }
  return json(404, { error: "not_found" });
}

async function publicFeed(env, request, name, presentAccount) {
  const posts = await env.DB.prepare("SELECT id, author_id, parent_id, body, created_at FROM community_posts WHERE community_id = ? AND deleted_at = 0 ORDER BY created_at DESC LIMIT 200").bind(name).all();
  const authors = {};
  const out = [];
  for (const item of posts.results || []) {
    if (!authors[item.author_id]) authors[item.author_id] = await authorOf(env, request, item.author_id, presentAccount);
    out.push({
      id: item.id,
      authorId: "",
      parentId: item.parent_id || "",
      body: item.body,
      createdAt: item.created_at,
      author: authors[item.author_id],
      _author: item.author_id
    });
  }
  return JSON.stringify({ posts: out });
}

async function dropFeed(env, name) {
  try { await invalidate(env, "f:" + name); }
  catch (err) { logError("feed", err); }
}

async function readFeed(request, env, name, row, json, rateHit, limited, presentAccount) {
  const hit = await rateHit(env, "community-read:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  let parsed = { posts: [] };
  try {
    const text = await readThrough(env, "f:" + name, () => publicFeed(env, request, name, presentAccount));
    parsed = JSON.parse(text);
  } catch (err) {
    logError("feed", err);
    parsed = JSON.parse(await publicFeed(env, request, name, presentAccount));
  }
  const member = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?").bind(name).first();
  const joined = await env.DB.prepare("SELECT public_id FROM community_members WHERE community_id = ? AND public_id = ?").bind(name, row.public_id).first();
  const likes = await env.DB.prepare("SELECT item_id, COUNT(*) AS n FROM community_likes GROUP BY item_id").all();
  const mine = await env.DB.prepare("SELECT item_id FROM community_likes WHERE public_id = ?").bind(row.public_id).all();
  const out = [];
  for (const item of parsed.posts || []) {
    const authorId = String((item && (item._author || item.authorId)) || "");
    const profileLess = !!(item && item.author && item.author.profileLess);
    const author = item.author ? Object.assign({}, item.author) : {};
    if (!profileLess) await fillAuthor(env, request, row, author);
    else author.avatar = "";
    author.publicId = "";
    out.push({
      id: item.id,
      authorId: "",
      parentId: item.parentId || "",
      body: item.body,
      createdAt: item.createdAt,
      author,
      mine: !profileLess && authorId === row.public_id
    });
  }
  const visibility = await visibilityOf(env, name);
  const pref = await env.DB.prepare("SELECT show_home, muted FROM community_feed_prefs WHERE public_id = ? AND community_id = ?").bind(row.public_id, name).first().catch(() => null);
  const allowed = visibility === "public" || !!joined;
  const readable = allowed ? out : out.filter((item) => item.mine);
  const hiddenAuthors = await hiddenAuthorSet(env, row.public_id, readable.map((item) => item.authorId));
  const visible = readable.filter((item) => !item.authorId || !hiddenAuthors.has(item.authorId));
  const counts = {};
  for (const item of likes.results || []) counts[item.item_id] = Number(item.n) || 0;
  const notes = await unread(env, request, row);
  return json(200, {
    community: name,
    joined: !!joined,
    members: Number(member && member.n) || 0,
    visibility: visibility,
    locked: visibility !== "public" && !joined,
    showHome: !pref || Number(pref.show_home) !== 0,
    muted: !!(pref && Number(pref.muted) === 1),
    posts: visible,
    likes: counts,
    mine: (mine.results || []).map((item) => item.item_id),
    notes
  });
}

async function createPost(request, env, name, row, json, readJson, rateHit, limited, presentAccount) {
  const hit = await rateHit(env, "community-post:" + row.public_id, 20, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 8000);
  if (body.error) return json(400, { error: body.error });
  const saved = await addCommunityPost(env, request, {
    viewer: row,
    name: name,
    text: body.text || body.body || "",
    parentId: body.parentId || "",
    presentAccount: presentAccount
  });
  if (saved.error) {
    return json(saved.status || 400, saved.error === "blocked" ? { error: "blocked", message: "You can’t do that with this account." } : { error: saved.error });
  }
  return json(200, { post: saved.post });
}

async function readGlobalHome(env, row, json) {
  let showHome = true;
  try {
    const global = await env.DB.prepare("SELECT show_home FROM community_feed_prefs WHERE public_id = ? AND community_id = ''").bind(row.public_id).first();
    if (global && Number(global.show_home) === 0) showHome = false;
  } catch (err) { showHome = true; }
  return json(200, { showHome: showHome });
}

async function writeGlobalHome(request, env, row, json, readJson, rateHit, limited) {
  const hit = await rateHit(env, "community-home:" + row.public_id, 30, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 1000);
  if (body.error) return json(400, { error: body.error });
  const saved = await writeFeedPref(env, row.public_id, "", { showHome: !(body.showHome === false || body.showHome === 0) });
  return json(200, { showHome: saved.showHome });
}

async function writeCommunityFeed(request, env, name, row, json, readJson, rateHit, limited) {
  const hit = await rateHit(env, "community-feed:" + row.public_id, 40, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 1000);
  if (body.error) return json(400, { error: body.error });
  const patch = {};
  if (body.showHome != null) patch.showHome = !(body.showHome === false || body.showHome === 0);
  if (body.muted != null) patch.muted = body.muted === true || body.muted === 1;
  const saved = await writeFeedPref(env, row.public_id, name, patch);
  return json(200, saved);
}

async function writeVisibility(request, env, name, row, json, readJson, rateHit, limited) {
  if (row.owner !== 1) return json(403, { error: "forbidden" });
  const hit = await rateHit(env, "community-vis:" + row.public_id, 20, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 1000);
  if (body.error) return json(400, { error: body.error });
  const visibility = body.visibility === "private" || body.visibility === "restricted" ? body.visibility : (body.visibility === "public" ? "public" : "");
  if (!visibility) return json(400, { error: "bad_community" });
  await env.DB.prepare("INSERT INTO community_meta (community_id, visibility, updated_at) VALUES (?, ?, ?) ON CONFLICT(community_id) DO UPDATE SET visibility = excluded.visibility, updated_at = excluded.updated_at").bind(name, visibility, Date.now()).run();
  await dropFeed(env, name);
  return json(200, { community: name, visibility: visibility });
}

async function editPost(request, env, name, rawId, row, json, readJson, rateHit, limited) {
  const hit = await rateHit(env, "community-post:" + row.public_id, 20, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const id = String(rawId || "");
  if (!/^va_[a-f0-9]{16}$/.test(id)) return json(400, { error: "bad_post" });
  const body = await readJson(request, 8000);
  if (body.error) return json(400, { error: body.error });
  const text = cleanBody(body.text || body.body || "");
  if (!text) return json(400, { error: "bad_post" });
  const existing = await env.DB.prepare(
    "SELECT author_id, parent_id FROM community_posts WHERE id = ? AND community_id = ? AND deleted_at = 0"
  ).bind(id, name).first();
  if (!existing) return json(404, { error: "not_found" });
  if (existing.author_id !== row.public_id && row.owner !== 1) return json(403, { error: "forbidden" });
  const now = Date.now();
  const planned = await planMentions(env, {
    actor: { public_id: row.public_id, handle: row.handle, display_name: row.display_name },
    sourceId: id,
    kind: existing.parent_id ? "reply" : "post",
    text,
    at: now,
    exceptIds: [existing.author_id === row.public_id ? "" : existing.author_id],
    hash: "#/communities/" + name + "/" + encodeURIComponent(existing.parent_id || id)
  });
  const drop = planned.targets.length
    ? "DELETE FROM mentions WHERE source_id = ? AND target_id NOT IN (" + planned.targets.map(() => "?").join(",") + ")"
    : "DELETE FROM mentions WHERE source_id = ?";
  const statements = [
    env.DB.prepare("UPDATE community_posts SET body = ? WHERE id = ?").bind(text, id),
    env.DB.prepare(drop).bind(...(planned.targets.length ? [id].concat(planned.targets) : [id]))
  ].concat(planned.statements);
  await commitBundled(env, statements, planned.deliveries, request);
  await dropFeed(env, name);
  return json(200, { post: { id, body: text } });
}

async function deletePost(env, name, rawId, row, json, rateHit, limited) {
  const hit = await rateHit(env, "community-delete:" + row.public_id, 30, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const id = String(rawId || "");
  if (!/^va_[a-f0-9]{16}$/.test(id)) return json(400, { error: "bad_post" });
  const existing = await env.DB.prepare("SELECT author_id FROM community_posts WHERE id = ? AND community_id = ? AND deleted_at = 0").bind(id, name).first();
  if (!existing) return json(404, { error: "not_found" });
  if (existing.author_id !== row.public_id && row.owner !== 1) return json(403, { error: "forbidden" });
  await env.DB.prepare("UPDATE community_posts SET deleted_at = ? WHERE id = ?").bind(Date.now(), id).run();
  await dropFeed(env, name);
  return json(200, { deleted: true });
}

async function setLike(request, env, row, json, readJson, rateHit, limited) {
  const hit = await rateHit(env, "community-like:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 2000);
  if (body.error) return json(400, { error: body.error });
  const item = String(body.itemId || "");
  if (!PARENT_RE.test(item) && !/^va_[a-f0-9]{16}$/.test(item)) return json(400, { error: "bad_post" });
  let createdLike = false;
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM community_likes WHERE public_id = ? AND item_id = ?").bind(row.public_id, item).run();
    const liked = await env.DB.prepare("SELECT author_id FROM community_posts WHERE id = ?").bind(item).first();
    if (liked && liked.author_id && liked.author_id !== row.public_id) {
      try { await clawback(env, liked.author_id, "like_in", row.public_id + ":" + item); }
      catch (err) { /* the like is already removed */ }
    }
  } else {
    const before = await env.DB.prepare("SELECT created_at FROM community_likes WHERE public_id = ? AND item_id = ?").bind(row.public_id, item).first();
    await env.DB.prepare("INSERT INTO community_likes (public_id, item_id, created_at) VALUES (?, ?, ?) ON CONFLICT(public_id, item_id) DO NOTHING").bind(row.public_id, item, Date.now()).run();
    createdLike = !before;
  }
  if (createdLike && /^va_[a-f0-9]{16}$/.test(item)) {
    const liked = await env.DB.prepare("SELECT author_id FROM community_posts WHERE id = ? AND deleted_at = 0").bind(item).first();
    if (liked && liked.author_id && liked.author_id !== row.public_id) {
      try { await awardActivity(env, liked.author_id, "like_in", row.public_id + ":" + item); }
      catch (err) { /* the like is saved */ }
      const me = await env.DB.prepare("SELECT handle, display_name FROM accounts WHERE public_id = ?").bind(row.public_id).first();
      await notifyCommunity(env, {
        publicId: liked.author_id,
        kind: "like",
        at: Date.now(),
        actorId: row.public_id,
        groupKey: "like:" + item,
        idempotencyKey: "like:" + row.public_id + ":" + item,
        handle: me && me.handle,
        name: me && me.display_name,
        text: "",
        hash: "#/communities",
        platform: "app",
        feedId: "app:@" + ((me && me.handle) || "")
      });
    }
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_likes WHERE item_id = ?").bind(item).first();
  return json(200, { itemId: item, likes: Number(count && count.n) || 0, mine: request.method !== "DELETE" });
}

async function setJoin(env, name, row, join, json, rateHit, limited) {
  const hit = await rateHit(env, "community-join:" + row.public_id, 30, 60 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  if (join) {
    await env.DB.prepare("INSERT INTO community_members (community_id, public_id, created_at) VALUES (?, ?, ?) ON CONFLICT(community_id, public_id) DO NOTHING").bind(name, row.public_id, Date.now()).run();
  } else {
    await env.DB.prepare("DELETE FROM community_members WHERE community_id = ? AND public_id = ?").bind(name, row.public_id).run();
  }
  const member = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?").bind(name).first();
  return json(200, { joined: join, members: Number(member && member.n) || 0 });
}

async function unread(env, request, viewer) {
  const rows = await env.DB.prepare("SELECT id, payload FROM community_notes WHERE public_id = ? AND seen = 0 ORDER BY created_at DESC LIMIT 40").bind(viewer.public_id).all();
  const notes = [];
  for (const item of rows.results || []) {
    try {
      const note = JSON.parse(item.payload);
      if (note && note.handle) note.avatar = await visibleAvatarUrl(env, request, viewer, note.handle);
      notes.push(redactPublicIds(note));
    }
    catch (err) { /* skip a broken note */ }
  }
  return notes;
}

async function listNotes(request, env, row, json, rateHit, limited) {
  const hit = await rateHit(env, "community-read:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  return json(200, { notes: await unread(env, request, row) });
}

async function seeNotes(request, env, row, json, readJson, rateHit, limited) {
  const hit = await rateHit(env, "community-read:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 8000);
  if (body.error) return json(400, { error: body.error });
  const ids = Array.isArray(body.ids) ? body.ids : [];
  for (const id of ids.slice(0, 40)) {
    if (!/^cm_va_[a-f0-9]{16}$/.test(String(id || ""))) continue;
    await env.DB.prepare("UPDATE community_notes SET seen = 1 WHERE id = ? AND public_id = ?").bind(String(id), row.public_id).run();
  }
  return json(200, { ok: true });
}
