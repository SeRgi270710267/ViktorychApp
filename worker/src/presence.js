/* Presence and custom status.
   The heartbeat is the source of truth. A coalesced beat does not write
   D1 and does not wake watcher objects. Live updates go through the
   generic account channel only when the visible state, privacy, or
   custom status changes. */

import {
  PRESENCE_CACHE_MS,
  WRITE_WINDOW_MS,
  activeStatus,
  applyBeat,
  canSeeExact,
  cleanEmoji,
  cleanStatusText,
  clearAtFrom,
  effectiveState,
  isAccountId,
  normalizeActivity,
  normalizeClear,
  normalizePreference,
  normalizePrivacy,
  publicPresence,
  shouldWriteBeat
} from "../../shared/presence.js";
import { deliverToAccount, listWatchers, publishToAccount } from "./channel.js";

const READ_LIMIT = 40;
const CACHE_PREFIX = "https://presence.internal/v1/";
const PREFERENCES = ["online", "idle", "dnd", "invisible"];
const ACTIVITIES = ["active", "idle", "hidden"];
const PRIVACY = ["everyone", "follows", "nobody"];
const CLEARS = ["30m", "1h", "4h", "today", "week", "never"];

export const PRESENCE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS account_presence (
    public_id TEXT PRIMARY KEY,
    preference TEXT NOT NULL DEFAULT 'online',
    activity TEXT NOT NULL DEFAULT 'hidden',
    seen_privacy TEXT NOT NULL DEFAULT 'everyone',
    last_seen INTEGER NOT NULL DEFAULT 0,
    last_beat INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS account_status (
    public_id TEXT PRIMARY KEY,
    emoji TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    clear_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS account_status_clear ON account_status(clear_at)"
];

function rows(result) {
  return (result && result.results) || [];
}

function idList(raw, limit) {
  const out = [];
  const parts = String(raw || "").split(",");
  const cap = limit || READ_LIMIT;
  for (let i = 0; i < parts.length && out.length < cap; i++) {
    const id = parts[i].trim();
    if (isAccountId(id) && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

function known(list, value) {
  return list.indexOf(String(value || "")) >= 0;
}

function privateJson(deps, body) {
  return deps.json(200, body, {
    "cache-control": "private, max-age=15",
    "cdn-cache-control": "no-store"
  });
}

async function accountOf(env, request, deps) {
  const account = await deps.sessionAccount(env, request);
  if (!account) return { error: deps.json(401, { error: "unauthorized" }) };
  if (!isAccountId(account.public_id)) return { error: deps.json(403, { error: "account" }) };
  return { account: account };
}

async function readRaw(env, id) {
  const url = CACHE_PREFIX + id;
  try {
    const hit = await caches.default.match(new Request(url));
    if (hit) {
      const at = Number(hit.headers.get("x-fetched-at") || 0);
      if (at && Date.now() - at < PRESENCE_CACHE_MS) return await hit.json();
    }
  } catch (err) { /* a cache miss reads D1 */ }
  const presence = await env.DB.prepare("SELECT public_id, preference, activity, seen_privacy, last_seen, last_beat, updated_at FROM account_presence WHERE public_id = ?").bind(id).first();
  const status = await env.DB.prepare("SELECT public_id, emoji, text, clear_at, updated_at FROM account_status WHERE public_id = ?").bind(id).first();
  const bundle = { presence: presence || null, status: status || null };
  try {
    await caches.default.put(new Request(url), new Response(JSON.stringify(bundle), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=20",
        "x-fetched-at": String(Date.now())
      }
    }));
  } catch (err) { /* the response is still fresh from D1 */ }
  return bundle;
}

async function dropRaw(id) {
  try { await caches.default.delete(new Request(CACHE_PREFIX + id)); }
  catch (err) { /* the next read expires on its own */ }
}

async function followTargets(env, followerId, ids) {
  const set = new Set();
  if (!ids.length) return set;
  const marks = ids.map(() => "?").join(",");
  const result = await env.DB.prepare("SELECT target_id FROM account_follows WHERE follower_id = ? AND target_id IN (" + marks + ")").bind(followerId, ...ids.map((id) => "app:" + id)).all();
  rows(result).forEach((row) => {
    const id = String(row.target_id || "");
    if (id.startsWith("app:")) set.add(id.slice(4));
  });
  return set;
}

async function followersAmong(env, targetId, ids) {
  const set = new Set();
  if (!ids.length) return set;
  const marks = ids.map(() => "?").join(",");
  const result = await env.DB.prepare("SELECT follower_id FROM account_follows WHERE target_id = ? AND follower_id IN (" + marks + ")").bind("app:" + targetId, ...ids).all();
  rows(result).forEach((row) => set.add(String(row.follower_id || "")));
  return set;
}

function viewOf(presence, status, exact, now, self, id) {
  const view = publicPresence(presence, status, exact, now, self);
  view.id = id;
  return view;
}

async function decorate(env, viewerId, ids, now) {
  const viewerBundle = await readRaw(env, viewerId);
  const viewerPrivacy = viewerBundle.presence ? viewerBundle.presence.seen_privacy : "everyone";
  const others = ids.filter((id) => id !== viewerId);
  const iFollow = await followTargets(env, viewerId, others);
  const followsMe = await followersAmong(env, viewerId, others);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const bundle = id === viewerId ? viewerBundle : await readRaw(env, id);
    const same = id === viewerId;
    const exact = canSeeExact(
      viewerPrivacy,
      bundle.presence ? bundle.presence.seen_privacy : "everyone",
      iFollow.has(id),
      followsMe.has(id),
      same
    );
    out.push(viewOf(bundle.presence, bundle.status, exact, now, same, id));
  }
  return out;
}

async function loadFresh(env, id) {
  const presence = await env.DB.prepare("SELECT public_id, preference, activity, seen_privacy, last_seen, last_beat, updated_at FROM account_presence WHERE public_id = ?").bind(id).first();
  const status = await env.DB.prepare("SELECT public_id, emoji, text, clear_at, updated_at FROM account_status WHERE public_id = ?").bind(id).first();
  return { presence: presence || null, status: status || null };
}

function classify(prev, next, prevStatus, nextStatus, now) {
  const before = effectiveState(prev || { preference: "online", activity: "hidden", last_beat: 0, last_seen: 0 }, now);
  const after = effectiveState(next, now);
  const preference = normalizePreference(prev && prev.preference) !== normalizePreference(next && (next.preference));
  const privacy = normalizePrivacy(prev && (prev.seen_privacy || prev.seenPrivacy)) !== normalizePrivacy(next && (next.seen_privacy || next.seenPrivacy));
  const prevCustom = activeStatus(prevStatus, now);
  const nextCustom = activeStatus(nextStatus, now);
  const status = prevCustom.emoji !== nextCustom.emoji || prevCustom.text !== nextCustom.text || prevCustom.clearAt !== nextCustom.clearAt;
  const state = before.state !== after.state;
  if (!preference && !privacy && !status && !state) return null;
  return { preference: preference, privacy: privacy, status: status, activity: state && !preference && !privacy && !status };
}

async function fanout(env, publicId, prev, next, prevStatus, nextStatus, now) {
  if (!env.ACCOUNT_CHANNEL) return;
  const change = classify(prev, next, prevStatus, nextStatus, now);
  if (!change) return;
  const selfView = viewOf(next, nextStatus, true, now, true, publicId);
  await publishToAccount(env, publicId, "presence", selfView, publicId);
  const watchers = (await listWatchers(env, publicId, "presence")).filter((id) => id !== publicId);
  if (!watchers.length) return;
  const followsSubject = await followersAmong(env, publicId, watchers);
  const subjectFollows = await followTargets(env, publicId, watchers);
  const marks = watchers.map(() => "?").join(",");
  const privRows = await env.DB.prepare("SELECT public_id, seen_privacy FROM account_presence WHERE public_id IN (" + marks + ")").bind(...watchers).all();
  const priv = new Map();
  rows(privRows).forEach((row) => priv.set(String(row.public_id), row.seen_privacy));
  const subjectPrivacy = next && (next.seen_privacy || next.seenPrivacy);
  for (let i = 0; i < watchers.length; i++) {
    const viewerId = watchers[i];
    const exact = canSeeExact(
      priv.get(viewerId) || "everyone",
      subjectPrivacy,
      followsSubject.has(viewerId),
      subjectFollows.has(viewerId),
      false
    );
    if (!exact && change.activity) continue;
    if (!exact && !change.preference && !change.privacy && !change.status) continue;
    const view = viewOf(next, nextStatus, exact, now, false, publicId);
    await deliverToAccount(env, viewerId, "presence", view, publicId);
  }
}

async function savePresence(env, row) {
  await env.DB.prepare(
    `INSERT INTO account_presence (public_id, preference, activity, seen_privacy, last_seen, last_beat, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(public_id) DO UPDATE SET
       preference = excluded.preference,
       activity = excluded.activity,
       seen_privacy = excluded.seen_privacy,
       last_seen = excluded.last_seen,
       last_beat = excluded.last_beat,
       updated_at = excluded.updated_at`
  ).bind(row.public_id, row.preference, row.activity, row.seen_privacy, row.last_seen, row.last_beat, row.updated_at).run();
}

async function saveStatus(env, row) {
  await env.DB.prepare(
    `INSERT INTO account_status (public_id, emoji, text, clear_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(public_id) DO UPDATE SET
       emoji = excluded.emoji,
       text = excluded.text,
       clear_at = excluded.clear_at,
       updated_at = excluded.updated_at`
  ).bind(row.public_id, row.emoji, row.text, row.clear_at, row.updated_at).run();
}

export async function handlePresence(request, env, url, deps) {
  const found = await accountOf(env, request, deps);
  if (found.error) return found.error;
  const account = found.account;
  const now = Date.now();
  if (request.method === "GET") {
    const paced = await deps.rateHit(env, "pres-read:" + account.public_id, 120, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const ids = idList(url.searchParams.get("ids"), READ_LIMIT);
    if (!ids.length) {
      const view = (await decorate(env, account.public_id, [account.public_id], now))[0];
      return privateJson(deps, view);
    }
    return privateJson(deps, { presence: await decorate(env, account.public_id, ids, now) });
  }
  if (request.method === "POST") {
    const paced = await deps.rateHit(env, "pres:" + account.public_id, 40, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: body.error });
    if (!known(ACTIVITIES, body.activity)) return deps.json(400, { error: "activity" });
    const fresh = await loadFresh(env, account.public_id);
    const prev = fresh.presence;
    const beat = applyBeat(prev, body.activity, now);
    const next = {
      public_id: account.public_id,
      preference: beat.preference,
      activity: beat.activity,
      seen_privacy: beat.seenPrivacy,
      last_seen: beat.lastSeen,
      last_beat: beat.lastBeat,
      updated_at: now
    };
    if (!shouldWriteBeat(prev, beat, now, WRITE_WINDOW_MS)) {
      const view = viewOf(prev, fresh.status, true, now, true, account.public_id);
      return deps.json(200, { ok: true, coalesced: true, state: view.state, activity: beat.activity });
    }
    const status = fresh.status;
    await savePresence(env, next);
    await dropRaw(account.public_id);
    try { await fanout(env, account.public_id, prev, next, status, status, now); }
    catch (err) { /* the row is saved; the next change pushes again */ }
    const view = viewOf(next, status, true, now, true, account.public_id);
    return deps.json(200, { ok: true, coalesced: false, state: view.state, activity: next.activity });
  }
  if (request.method === "PATCH") {
    const paced = await deps.rateHit(env, "pres-set:" + account.public_id, 30, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 4000);
    if (body.error) return deps.json(400, { error: body.error });
    if (body.preference != null && !known(PREFERENCES, body.preference)) return deps.json(400, { error: "preference" });
    if (body.seenPrivacy != null && !known(PRIVACY, body.seenPrivacy)) return deps.json(400, { error: "privacy" });
    const current = await env.DB.prepare("SELECT public_id, preference, activity, seen_privacy, last_seen, last_beat, updated_at FROM account_presence WHERE public_id = ?").bind(account.public_id).first();
    const prevStatus = await env.DB.prepare("SELECT emoji, text, clear_at FROM account_status WHERE public_id = ?").bind(account.public_id).first();
    const next = {
      public_id: account.public_id,
      preference: body.preference != null ? normalizePreference(body.preference) : normalizePreference(current && current.preference),
      activity: normalizeActivity(current && current.activity),
      seen_privacy: body.seenPrivacy != null ? normalizePrivacy(body.seenPrivacy) : normalizePrivacy(current && current.seen_privacy),
      last_seen: Number(current && current.last_seen) || 0,
      last_beat: Number(current && current.last_beat) || 0,
      updated_at: now
    };
    if (next.preference === "invisible" && current && normalizePreference(current.preference) !== "invisible") {
      /* last_seen stays where the last visible beat left it */
    }
    let nextStatus = prevStatus || { emoji: "", text: "", clear_at: 0 };
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      if (body.status == null) nextStatus = { emoji: "", text: "", clear_at: 0 };
      else if (typeof body.status !== "object") return deps.json(400, { error: "status" });
      else {
        const clear = body.status.clear != null ? body.status.clear : "never";
        if (clear && !known(CLEARS, clear) && clear !== "") return deps.json(400, { error: "clear" });
        const mode = normalizeClear(clear) || "never";
        nextStatus = {
          emoji: cleanEmoji(body.status.emoji),
          text: cleanStatusText(body.status.text),
          clear_at: clearAtFrom(mode, now, body.status.clearAt)
        };
      }
      await saveStatus(env, {
        public_id: account.public_id,
        emoji: nextStatus.emoji,
        text: nextStatus.text,
        clear_at: Number(nextStatus.clear_at) || 0,
        updated_at: now
      });
    }
    await savePresence(env, next);
    await dropRaw(account.public_id);
    try { await fanout(env, account.public_id, current, next, prevStatus, nextStatus, now); }
    catch (err) { /* the row is saved; the next change pushes again */ }
    return deps.json(200, Object.assign({ ok: true }, viewOf(next, nextStatus, true, now, true, account.public_id)));
  }
  return deps.json(405, { error: "method" });
}

export async function sweepExpiredStatuses(env, now) {
  const at = Number(now) || Date.now();
  let listed = null;
  try {
    listed = await env.DB.prepare("SELECT public_id, emoji, text, clear_at FROM account_status WHERE clear_at > 0 AND clear_at <= ? LIMIT 20").bind(at).all();
  } catch (err) {
    return 0;
  }
  const found = rows(listed);
  if (!found.length) return 0;
  await env.DB.prepare("UPDATE account_status SET emoji = '', text = '', clear_at = 0, updated_at = ? WHERE clear_at > 0 AND clear_at <= ?").bind(at, at).run();
  for (let i = 0; i < found.length; i++) {
    const row = found[i];
    await dropRaw(row.public_id);
    const presence = await env.DB.prepare("SELECT public_id, preference, activity, seen_privacy, last_seen, last_beat FROM account_presence WHERE public_id = ?").bind(row.public_id).first();
    const nextPresence = presence || { preference: "online", activity: "hidden", seen_privacy: "everyone", last_seen: 0, last_beat: 0 };
    try { await fanout(env, row.public_id, nextPresence, nextPresence, row, { emoji: "", text: "", clear_at: 0 }, at); }
    catch (err) { /* the row is already cleared */ }
  }
  return found.length;
}
