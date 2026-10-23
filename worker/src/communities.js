/** Internal posts on a mirrored subreddit. Nothing here calls Reddit. */

export const COMMUNITY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS community_posts (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, author_id TEXT NOT NULL, parent_id TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS community_posts_feed ON community_posts(community_id, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS community_likes (public_id TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (public_id, item_id))",
  "CREATE TABLE IF NOT EXISTS community_members (community_id TEXT NOT NULL, public_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (community_id, public_id))",
  "CREATE TABLE IF NOT EXISTS community_notes (id TEXT PRIMARY KEY, public_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS community_notes_account ON community_notes(public_id, seen, created_at DESC)"
];

const COMMUNITIES_KEY = "owner/added-communities.json";
const NAME_RE = /^[a-z0-9_]{2,21}$/;
const PARENT_RE = /^(?:t[13]_[A-Za-z0-9]{1,12}|va_[a-f0-9]{16})$/;
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
  const row = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, location, website, owner, created_at, hide_avatar, avatar_empty, banner_empty FROM accounts WHERE public_id = ?").bind(publicId).first();
  if (!row) return { handle: "", displayName: "", avatar: "", owner: false };
  const pub = await presentAccount(env, request, row, false);
  return {
    handle: pub.handle || "",
    displayName: pub.displayName || "",
    avatar: pub.avatar || "",
    owner: pub.owner === true
  };
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
  if (path === "/v1/communities/notes" && request.method === "GET") return listNotes(env, row, json, rateHit, limited);
  if (path === "/v1/communities/notes/seen" && request.method === "POST") return seeNotes(request, env, row, json, readJson, rateHit, limited);
  const parts = path.split("/").filter(Boolean);
  // v1 communities :name ...
  if (parts[0] !== "v1" || parts[1] !== "communities" || !parts[2]) return json(404, { error: "not_found" });
  const name = communityName(parts[2]);
  if (!name) return json(400, { error: "bad_community" });
  if (parts.length === 3 && request.method === "GET") return readFeed(request, env, name, row, json, rateHit, limited, presentAccount);
  if (parts.length === 4 && parts[3] === "posts" && request.method === "POST") return createPost(request, env, name, row, json, readJson, rateHit, limited, presentAccount);
  if (parts.length === 5 && parts[3] === "posts" && request.method === "DELETE") return deletePost(env, name, parts[4], row, json, rateHit, limited);
  if (parts.length === 4 && parts[3] === "likes" && (request.method === "POST" || request.method === "DELETE")) return setLike(request, env, row, json, readJson, rateHit, limited);
  if (parts.length === 4 && parts[3] === "join" && (request.method === "POST" || request.method === "DELETE")) return setJoin(env, name, row, request.method === "POST", json, rateHit, limited);
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

async function readFeed(request, env, name, row, json, rateHit, limited, presentAccount) {
  const hit = await rateHit(env, "community-read:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const posts = await env.DB.prepare("SELECT id, author_id, parent_id, body, created_at FROM community_posts WHERE community_id = ? AND deleted_at = 0 ORDER BY created_at DESC LIMIT 200").bind(name).all();
  const member = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?").bind(name).first();
  const joined = await env.DB.prepare("SELECT public_id FROM community_members WHERE community_id = ? AND public_id = ?").bind(name, row.public_id).first();
  const likes = await env.DB.prepare("SELECT item_id, COUNT(*) AS n FROM community_likes GROUP BY item_id").all();
  const mine = await env.DB.prepare("SELECT item_id FROM community_likes WHERE public_id = ?").bind(row.public_id).all();
  const authors = {};
  const out = [];
  for (const item of posts.results || []) {
    if (!authors[item.author_id]) authors[item.author_id] = await authorOf(env, request, item.author_id, presentAccount);
    out.push({
      id: item.id,
      parentId: item.parent_id || "",
      body: item.body,
      createdAt: item.created_at,
      author: authors[item.author_id],
      mine: item.author_id === row.public_id
    });
  }
  const counts = {};
  for (const item of likes.results || []) counts[item.item_id] = Number(item.n) || 0;
  const notes = await unread(env, row.public_id);
  return json(200, {
    community: name,
    joined: !!joined,
    members: Number(member && member.n) || 0,
    posts: out,
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
  const text = cleanBody(body.text || body.body || "");
  if (!text) return json(400, { error: "bad_post" });
  const parent = String(body.parentId || "");
  if (parent && !PARENT_RE.test(parent)) return json(400, { error: "bad_parent" });
  let parentAuthor = "";
  if (parent.indexOf("va_") === 0) {
    const existing = await env.DB.prepare("SELECT id, author_id, community_id FROM community_posts WHERE id = ? AND deleted_at = 0").bind(parent).first();
    if (!existing || existing.community_id !== name) return json(404, { error: "not_found" });
    parentAuthor = existing.author_id;
  }
  const id = newId();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO community_posts (id, community_id, author_id, parent_id, body, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 0)").bind(id, name, row.public_id, parent, text, now).run();
  if (parentAuthor && parentAuthor !== row.public_id) {
    const author = await authorOf(env, request, row.public_id, presentAccount);
    const noteId = "cm_" + id;
    const payload = {
      id: noteId,
      at: now,
      handle: author.handle,
      name: author.displayName,
      text: Array.from(text).slice(0, 180).join(""),
      avatar: author.avatar || "",
      hash: "#/communities/" + name + "/" + encodeURIComponent(parent),
      platform: "app",
      feedId: "community:" + name
    };
    await env.DB.prepare("INSERT INTO community_notes (id, public_id, payload, created_at, seen) VALUES (?, ?, ?, ?, 0)").bind(noteId, parentAuthor, JSON.stringify(payload), now).run();
  }
  const author = await authorOf(env, request, row.public_id, presentAccount);
  return json(200, { post: { id, parentId: parent, body: text, createdAt: now, author, mine: true } });
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
  return json(200, { deleted: true });
}

async function setLike(request, env, row, json, readJson, rateHit, limited) {
  const hit = await rateHit(env, "community-like:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  const body = await readJson(request, 2000);
  if (body.error) return json(400, { error: body.error });
  const item = String(body.itemId || "");
  if (!PARENT_RE.test(item) && !/^va_[a-f0-9]{16}$/.test(item)) return json(400, { error: "bad_post" });
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM community_likes WHERE public_id = ? AND item_id = ?").bind(row.public_id, item).run();
  } else {
    await env.DB.prepare("INSERT INTO community_likes (public_id, item_id, created_at) VALUES (?, ?, ?) ON CONFLICT(public_id, item_id) DO NOTHING").bind(row.public_id, item, Date.now()).run();
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

async function unread(env, publicId) {
  const rows = await env.DB.prepare("SELECT id, payload FROM community_notes WHERE public_id = ? AND seen = 0 ORDER BY created_at DESC LIMIT 40").bind(publicId).all();
  const notes = [];
  for (const item of rows.results || []) {
    try { notes.push(JSON.parse(item.payload)); }
    catch (err) { /* skip a broken note */ }
  }
  return notes;
}

async function listNotes(env, row, json, rateHit, limited) {
  const hit = await rateHit(env, "community-read:" + row.public_id, 60, 10 * 60 * 1000);
  if (!hit.ok) return limited(hit);
  return json(200, { notes: await unread(env, row.public_id) });
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
