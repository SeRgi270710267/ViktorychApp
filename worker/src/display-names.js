/* Several display names, built like several usernames (usernames.js).

   The main name stays in accounts.display_name; up to four more live in
   display_names, each with its own audience: include (public, followers,
   friends, lists, people) plus exclude (followers, friends, lists, people).
   Every viewer sees exactly one name: the most specific match wins (a
   person, then a list in username list order, then friends, then followers,
   then public) and an excluded name falls back to a broader one. If nothing
   matches the viewer sees no name (the handle stands in).

   A viewer's own private nickname still wins in their view (name-rules.js).
   The old single "name for friends" (friend_names) is moved into the set as
   a friends-only name when the schema boots.

   Enforcement: viewerDisplay() for the places that build names one by one,
   emitNotification() for stored and pushed notifications, and
   withDisplayNames() over every JSON GET under /v1/ that carries a handle
   next to a name (lists, search, mentions, replies, messages and so on).

   loadDisplayNames(env, id) returns { names, listOrder } with each name's
   audience in the stored form, for owner tooling that sees all of them.

   The site owner (accounts.owner = 1) sees everything: audience rules never
   hide a name from them. Wherever a name is returned they get the main name,
   the profile carries every name (allDisplayNames), and
   GET /v1/display-names/of?handle= lists one account's names with their
   audiences. Each bypass is written to display_name_audit (one row per
   account per request), readable at GET /v1/display-names/audit; both
   routes answer 403 for everyone else. */

import { inspectHandle } from "../../shared/handle-skeleton.js";
import {
  audienceIn, audienceOut, cleanRel, idForHandle, normalizeNameAudience, ownerLists,
  parseAudience, pickName, previewRel, relationTo
} from "./usernames.js";

export const DISPLAY_NAME_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS display_names (id TEXT PRIMARY KEY, public_id TEXT NOT NULL, name TEXT NOT NULL, audience TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS display_names_owner ON display_names(public_id, position)",
  "CREATE TABLE IF NOT EXISTS display_name_prefs (public_id TEXT PRIMARY KEY, primary_audience TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS display_name_prefs_active ON display_name_prefs(active)",
  "CREATE TABLE IF NOT EXISTS display_name_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, viewer_id TEXT NOT NULL, target_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS display_name_audit_at ON display_name_audit(at)",
  // One-time move of the old "Friends see this instead of your display name".
  "INSERT OR IGNORE INTO display_names (id, public_id, name, audience, position, created_at) SELECT 'fn' || public_id, public_id, name, '{\"include\":{\"friends\":true}}', 0, updated_at FROM friend_names WHERE name != ''",
  "INSERT INTO display_name_prefs (public_id, primary_audience, active, updated_at) SELECT public_id, '', 1, updated_at FROM friend_names WHERE name != '' ON CONFLICT(public_id) DO UPDATE SET active = 1",
  "DELETE FROM friend_names"
];

export const DISPLAY_NAME_CAP = 5;
export const DISPLAY_NAME_MAX = 50;
const DAY = 24 * 60 * 60 * 1000;
const PUBLIC_DEFAULT = { include: { public: true } };
const FRIENDS_ONLY = { include: { friends: true } };
const ID = /^[A-Za-z0-9_-]{1,40}$/;

function rowsOf(result) {
  return (result && result.results) || [];
}

export function cleanDisplayName(raw) {
  const text = String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > DISPLAY_NAME_MAX) return "";
  return text;
}

function newId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "dn" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function plainAudience(aud) {
  return aud.include.public && !aud.exclude.followers && !aud.exclude.friends && !aud.exclude.lists.length && !aud.exclude.people.length;
}

/* { names: [{ id, name, primary, position, audience }], listOrder } or null. */
export async function loadDisplayNames(env, ownerId) {
  const account = await env.DB.prepare("SELECT display_name FROM accounts WHERE public_id = ?").bind(ownerId).first();
  if (!account) return null;
  let prefs = null;
  let extra = [];
  let order = null;
  try {
    prefs = await env.DB.prepare("SELECT primary_audience FROM display_name_prefs WHERE public_id = ?").bind(ownerId).first();
    extra = rowsOf(await env.DB.prepare("SELECT id, name, audience, position FROM display_names WHERE public_id = ? ORDER BY position ASC, created_at ASC").bind(ownerId).all());
    order = await env.DB.prepare("SELECT list_order FROM username_prefs WHERE public_id = ?").bind(ownerId).first();
  } catch (err) { /* tables not created yet: main name only */ }
  let listOrder = [];
  try { listOrder = JSON.parse((order && order.list_order) || "[]"); } catch (err) { listOrder = []; }
  if (!Array.isArray(listOrder)) listOrder = [];
  const names = [{ id: "main", name: String(account.display_name || ""), primary: true, position: -1, audience: parseAudience(prefs && prefs.primary_audience, PUBLIC_DEFAULT) }];
  extra.forEach((row, at) => names.push({ id: row.id, name: row.name, primary: false, position: Number(row.position) || at, audience: parseAudience(row.audience, FRIENDS_ONLY) }));
  return { names, listOrder };
}

export function isPlainSet(set) {
  return !set || (set.names.length <= 1 && plainAudience(set.names[0].audience));
}

/* The one display name for this relation, or null (no name). */
export function pickDisplayName(set, rel) {
  if (!set) return null;
  return pickName(set.names, rel, set.listOrder);
}

const memos = new WeakMap();
function memoFor(request) {
  if (!request || typeof request !== "object") return new Map();
  let memo = memos.get(request);
  if (!memo) { memo = new Map(); memos.set(request, memo); }
  return memo;
}

async function activeSet(env, request, ownerId) {
  const memo = memoFor(request);
  const key = "set:" + ownerId;
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      try {
        const row = await env.DB.prepare("SELECT active FROM display_name_prefs WHERE public_id = ?").bind(ownerId).first();
        if (!row || Number(row.active) !== 1) return null;
      } catch (err) { return null; }
      const set = await loadDisplayNames(env, ownerId);
      return isPlainSet(set) ? null : set;
    })());
  }
  return memo.get(key);
}

/* Is this viewer the site owner (accounts.owner = 1)? Memoized per request. */
export async function isSiteOwner(env, request, viewerId) {
  if (!viewerId) return false;
  const memo = memoFor(request);
  const key = "owner:" + viewerId;
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      try {
        const row = await env.DB.prepare("SELECT owner FROM accounts WHERE public_id = ?").bind(viewerId).first();
        return !!(row && Number(row.owner) === 1);
      } catch (err) { return false; }
    })());
  }
  return memo.get(key);
}

/* One audit row per owner, account and action per request. */
export async function auditOwnerView(env, request, viewerId, targetId, action, detail) {
  const memo = memoFor(request);
  const key = "audit:" + action + ":" + targetId;
  if (memo.has(key)) return;
  memo.set(key, true);
  let where = "";
  try { where = new URL(request.url).pathname; } catch (err) { where = ""; }
  const info = Object.assign({ path: where }, detail || {});
  try {
    await env.DB.prepare("INSERT INTO display_name_audit (at, viewer_id, target_id, action, detail) VALUES (?, ?, ?, ?, ?)").bind(Date.now(), viewerId, targetId, action, JSON.stringify(info).slice(0, 1000)).run();
  } catch (err) { /* table boots with the schema; never block a read on the log */ }
}

/* Every name an account has, for the site owner's eyes only. */
export async function ownerSeesAll(env, request, ownerId, viewerId) {
  if (!ownerId || ownerId === viewerId || !(await isSiteOwner(env, request, viewerId))) return null;
  const set = await activeSet(env, request, ownerId);
  if (!set) return null;
  await auditOwnerView(env, request, viewerId, ownerId, "view", { names: set.names.length });
  return set.names.map((item) => ({ id: item.id, name: item.name, primary: !!item.primary }));
}

/* What this viewer sees for ownerId: null when the account has only one
   plain public name (callers keep what they have), else
   { name, hidden, alt } where alt means a name other than the main one.
   The site owner always gets the main name, never hidden, plus all names. */
export async function displayFor(env, request, ownerId, viewerId) {
  if (!ownerId || ownerId === viewerId) return null;
  const set = await activeSet(env, request, ownerId);
  if (!set) return null;
  const memo = memoFor(request);
  const key = "pick:" + ownerId + ">" + (viewerId || "");
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      const all = await ownerSeesAll(env, request, ownerId, viewerId);
      if (all) return { name: set.names[0].name, hidden: false, alt: false, owner: true, all };
      const rel = await relationTo(env, ownerId, viewerId || "");
      const picked = pickDisplayName(set, rel);
      return picked ? { name: picked.name, hidden: false, alt: !picked.primary } : { name: "", hidden: true, alt: false };
    })());
  }
  return memo.get(key);
}

/* Per-isolate gate for the response pass: does any account use the set? */
const gate = { at: 0, any: false };
const GATE_MS = 20000;
export function markDisplayNamesUsed() { gate.any = true; gate.at = Date.now(); }
async function anyActive(env) {
  const now = Date.now();
  if (now - gate.at < GATE_MS) return gate.any;
  try {
    const row = await env.DB.prepare("SELECT 1 AS one FROM display_name_prefs WHERE active = 1 LIMIT 1").first();
    gate.any = !!row;
  } catch (err) { gate.any = false; }
  gate.at = now;
  return gate.any;
}
export function resetDisplayNameGate() { gate.at = 0; gate.any = false; }

async function refreshActive(env, ownerId) {
  const set = await loadDisplayNames(env, ownerId);
  const active = isPlainSet(set) ? 0 : 1;
  await env.DB.prepare("INSERT INTO display_name_prefs (public_id, primary_audience, active, updated_at) VALUES (?, '', ?, ?) ON CONFLICT(public_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at").bind(ownerId, active, Date.now()).run();
  if (active) markDisplayNamesUsed();
  return set;
}

/* ---------- the response pass ---------- */

const NAME_KEYS = {
  handle: ["displayName", "name", "display_name"],
  h: ["n"],
  authorHandle: ["authorName", "authorDisplayName"],
  actorHandle: ["actorName"],
  fromHandle: ["fromName"],
  toHandle: ["toName"],
  senderHandle: ["senderName"],
  ownerHandle: ["ownerName"],
  targetHandle: ["targetName"],
  userHandle: ["userName"],
  peerHandle: ["peerName"],
  replyToHandle: ["replyToName"],
  quoteAuthorHandle: ["quoteAuthorName"],
  quoteHandle: ["quoteName"]
};
const SKIP_PATHS = /^\/v1\/(display-names|usernames|me$|session|owner\/)/;
const PASS_MAX = 2 * 1024 * 1024;

function collect(doc, out, depth) {
  if (!doc || typeof doc !== "object" || depth > 12) return;
  if (Array.isArray(doc)) { for (let i = 0; i < doc.length; i++) collect(doc[i], out, depth + 1); return; }
  Object.keys(NAME_KEYS).forEach((key) => {
    const value = doc[key];
    if (typeof value !== "string" || !value) return;
    const names = NAME_KEYS[key].filter((name) => typeof doc[name] === "string");
    if (names.length) out.push({ obj: doc, handle: value.replace(/^@/, ""), names });
  });
  const keys = Object.keys(doc);
  for (let i = 0; i < keys.length; i++) {
    const v = doc[keys[i]];
    if (v && typeof v === "object") collect(v, out, depth + 1);
  }
}

function skeletonOf(handle) {
  const checked = inspectHandle(String(handle || ""));
  return checked && checked.skeleton ? checked.skeleton : "";
}

async function ownersFor(env, handles) {
  const skeletons = Array.from(new Set(handles.map(skeletonOf).filter(Boolean)));
  const found = new Map();
  for (let i = 0; i < skeletons.length; i += 40) {
    const part = skeletons.slice(i, i + 40);
    const marks = part.map(() => "?").join(",");
    const rows = rowsOf(await env.DB.prepare(
      "SELECT a.skeleton AS s, a.public_id AS id FROM accounts a JOIN display_name_prefs p ON p.public_id = a.public_id AND p.active = 1 WHERE a.skeleton IN (" + marks + ")" +
      " UNION ALL SELECT h.skeleton AS s, h.public_id AS id FROM account_handles h JOIN display_name_prefs p ON p.public_id = h.public_id AND p.active = 1 WHERE h.skeleton IN (" + marks + ")"
    ).bind(...part, ...part).all());
    rows.forEach((row) => found.set(row.s, row.id));
  }
  return found;
}

/* Rewrites names in a parsed JSON document for this viewer. Returns the
   number of names changed. */
export async function applyDisplayNames(env, request, doc, viewerOf, nameFor) {
  const spots = [];
  collect(doc, spots, 0);
  if (!spots.length) return 0;
  const handles = Array.from(new Set(spots.map((spot) => spot.handle)));
  let owners;
  try { owners = await ownersFor(env, handles); } catch (err) { return 0; }
  if (!owners.size) return 0;
  let viewerId = "";
  try { viewerId = (typeof viewerOf === "function" ? await viewerOf() : viewerOf) || ""; } catch (err) { viewerId = ""; }
  let changed = 0;
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    const ownerId = owners.get(skeletonOf(spot.handle));
    if (!ownerId || ownerId === viewerId) continue;
    const shown = await nameFor(ownerId, viewerId, spot.obj[spot.names[0]]);
    const name = shown.name || spot.handle;
    spot.names.forEach((key) => {
      if (spot.obj[key] !== name) { spot.obj[key] = name; changed += 1; }
    });
  }
  return changed;
}

/* deps: { viewerId(request) -> id or "", nameFor(request, ownerId, viewerId, fallback) } */
export async function withDisplayNames(request, env, response, deps) {
  if (!request || request.method !== "GET" || !response || response.status !== 200 || response.webSocket) return response;
  if ((response.headers.get("content-type") || "").indexOf("application/json") < 0) return response;
  let path = "";
  try { path = new URL(request.url).pathname; } catch (err) { return response; }
  if (!path.startsWith("/v1/") || SKIP_PATHS.test(path)) return response;
  if (Number(response.headers.get("content-length") || 0) > PASS_MAX) return response;
  if (!(await anyActive(env))) return response;
  const text = await response.text();
  const headers = new Headers(response.headers);
  const same = () => new Response(text, { status: 200, statusText: response.statusText, headers });
  if (text.length > PASS_MAX) return same();
  let doc = null;
  try { doc = JSON.parse(text); } catch (err) { return same(); }
  const changed = await applyDisplayNames(env, request, doc, () => deps.viewerId(request), (ownerId, viewerId, fallback) => deps.nameFor(request, ownerId, viewerId, fallback));
  if (!changed) return same();
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "private, no-store");
  return new Response(JSON.stringify(doc), { status: 200, statusText: response.statusText, headers });
}

/* ---------- the old single friend name, now one entry in the set ---------- */

export async function friendNameGet(env, ownerId) {
  const row = await env.DB.prepare("SELECT name FROM display_names WHERE id = ? AND public_id = ?").bind("fn" + ownerId, ownerId).first();
  return row ? row.name : "";
}

export async function friendNamePut(env, ownerId, raw) {
  const name = cleanDisplayName(raw);
  if (name) {
    await env.DB.prepare("INSERT INTO display_names (id, public_id, name, audience, position, created_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind("fn" + ownerId, ownerId, name, JSON.stringify(normalizeNameAudience(FRIENDS_ONLY)), Date.now()).run();
  } else {
    await env.DB.prepare("DELETE FROM display_names WHERE id = ? AND public_id = ?").bind("fn" + ownerId, ownerId).run();
  }
  await refreshActive(env, ownerId);
  return name;
}

/* ---------- routes ---------- */

async function present(env, request, ownerId) {
  const set = await loadDisplayNames(env, ownerId);
  const names = [];
  for (let i = 0; i < set.names.length; i++) {
    const item = set.names[i];
    names.push({ id: item.id, name: item.name, primary: item.primary, audience: await audienceOut(env, request, ownerId, item.audience) });
  }
  return { names, listOrder: set.listOrder, cap: DISPLAY_NAME_CAP };
}

async function savePrimaryAudience(env, ownerId, audience) {
  await env.DB.prepare("INSERT INTO display_name_prefs (public_id, primary_audience, active, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(public_id) DO UPDATE SET primary_audience = excluded.primary_audience, updated_at = excluded.updated_at").bind(ownerId, audience, Date.now()).run();
}

export async function handleDisplayNames(request, env, path, deps) {
  const json = deps.json;
  const session = await deps.sessionAccount(env, request);
  if (!session) return json(401, { error: "unauthorized" });
  const ownerId = session.public_id;
  const method = request.method;
  const nocache = { "cache-control": "no-store" };
  const done = async (status) => {
    await refreshActive(env, ownerId);
    if (deps.invalidate) { try { await deps.invalidate(env, ownerId); } catch (err) { /* cache drops on its own */ } }
    return json(status || 200, await present(env, request, ownerId), nocache);
  };

  if (path === "/v1/display-names" && method === "GET") return json(200, await present(env, request, ownerId), nocache);

  /* Site owner only: one account's names with their audiences, and the log. */
  if ((path === "/v1/display-names/of" || path === "/v1/display-names/audit") && method === "GET") {
    if (!(await isSiteOwner(env, request, ownerId))) return json(403, { error: "forbidden" });
    const url = new URL(request.url);
    if (path === "/v1/display-names/audit") {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
      const list = rowsOf(await env.DB.prepare("SELECT a.id, a.at, a.action, a.detail, t.handle AS target FROM display_name_audit a LEFT JOIN accounts t ON t.public_id = a.target_id WHERE a.viewer_id = ? ORDER BY a.id DESC LIMIT ?").bind(ownerId, limit).all());
      return json(200, { entries: list.map((row) => ({ id: row.id, at: row.at, action: row.action, target: row.target || "", detail: (() => { try { return JSON.parse(row.detail || "{}"); } catch (err) { return {}; } })() })) }, nocache);
    }
    const who = String(url.searchParams.get("handle") || "").replace(/^@/, "");
    const targetId = who ? await idForHandle(env, who, ownerId) : "";
    if (!targetId) return json(404, { error: "not_found" });
    const set = await loadDisplayNames(env, targetId);
    if (!set) return json(404, { error: "not_found" });
    await auditOwnerView(env, request, ownerId, targetId, "list", { names: set.names.length });
    const names = [];
    for (const item of set.names) names.push({ id: item.id, name: item.name, primary: item.primary, audience: await audienceOut(env, request, targetId, item.audience) });
    return json(200, { handle: who, names, listOrder: set.listOrder }, nocache);
  }

  if (path === "/v1/display-names/preview" && method === "GET") {
    const url = new URL(request.url);
    const as = url.searchParams.get("as") || "public";
    const set = await loadDisplayNames(env, ownerId);
    let rel = previewRel(as, await ownerLists(env, ownerId));
    if (!rel) {
      const id = await idForHandle(env, String(as).replace(/^@/, ""), ownerId);
      if (!id) return json(404, { error: "not_found" });
      rel = await relationTo(env, ownerId, id);
    }
    const picked = pickDisplayName(set, cleanRel(rel));
    return json(200, { as, name: picked ? picked.name : "", id: picked ? picked.id : "", hidden: !picked }, nocache);
  }

  const body = method === "GET" ? {} : await deps.readJson(request, 40000);
  if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
  const set = await loadDisplayNames(env, ownerId);
  if (!set) return json(404, { error: "not_found" });
  const target = () => {
    const id = String(body.id || "");
    return ID.test(id) ? set.names.find((item) => item.id === id) : null;
  };

  if (path === "/v1/display-names" && method === "POST") {
    const paced = await deps.rateHit(env, "dname-add:" + ownerId, 20, DAY);
    if (!paced.ok) return deps.limited(paced);
    const name = cleanDisplayName(body.name);
    if (!name) return json(400, { error: "invalid_name" });
    if (set.names.length >= DISPLAY_NAME_CAP) return json(409, { error: "name_cap" });
    const audience = await audienceIn(env, ownerId, body.audience, FRIENDS_ONLY);
    const position = set.names.length;
    await env.DB.prepare("INSERT INTO display_names (id, public_id, name, audience, position, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(newId(), ownerId, name, JSON.stringify(audience), position, Date.now()).run();
    return done(201);
  }

  if (path === "/v1/display-names" && method === "PATCH") {
    const item = target();
    if (!item) return json(404, { error: "not_found" });
    const paced = await deps.rateHit(env, "dname-edit:" + ownerId, 60, DAY);
    if (!paced.ok) return deps.limited(paced);
    const audience = body.audience ? JSON.stringify(await audienceIn(env, ownerId, body.audience, item.primary ? PUBLIC_DEFAULT : FRIENDS_ONLY)) : null;
    const name = body.name == null ? null : cleanDisplayName(body.name);
    if (body.name != null && !name) return json(400, { error: "invalid_name" });
    if (item.primary) {
      if (audience) await savePrimaryAudience(env, ownerId, audience);
      if (name) await env.DB.prepare("UPDATE accounts SET display_name = ? WHERE public_id = ?").bind(name, ownerId).run();
    } else {
      await env.DB.prepare("UPDATE display_names SET name = COALESCE(?, name), audience = COALESCE(?, audience) WHERE id = ? AND public_id = ?").bind(name, audience, item.id, ownerId).run();
    }
    return done();
  }

  if (path === "/v1/display-names" && method === "DELETE") {
    const item = target();
    if (!item) return json(404, { error: "not_found" });
    if (item.primary) return json(409, { error: "primary_name" });
    await env.DB.prepare("DELETE FROM display_names WHERE id = ? AND public_id = ?").bind(item.id, ownerId).run();
    return done();
  }

  if (path === "/v1/display-names/primary" && method === "POST") {
    const item = target();
    if (!item) return json(404, { error: "not_found" });
    if (item.primary) return json(200, await present(env, request, ownerId), nocache);
    const paced = await deps.rateHit(env, "dname-main:" + ownerId, 10, DAY);
    if (!paced.ok) return deps.limited(paced);
    const main = set.names[0];
    // The two swap places; each name keeps its own audience.
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET display_name = ? WHERE public_id = ?").bind(item.name, ownerId),
      env.DB.prepare("UPDATE display_names SET name = ?, audience = ? WHERE id = ? AND public_id = ?").bind(main.name, JSON.stringify(main.audience), item.id, ownerId),
      env.DB.prepare("INSERT INTO display_name_prefs (public_id, primary_audience, active, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(public_id) DO UPDATE SET primary_audience = excluded.primary_audience, updated_at = excluded.updated_at").bind(ownerId, JSON.stringify(item.audience), Date.now())
    ]);
    return done();
  }

  return json(404, { error: "not_found" });
}
