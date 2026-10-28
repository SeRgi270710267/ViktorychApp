/* Profile badges. Tiers are awarded here from stored activity.
   A client cannot post a tier and have it stick. */

import { inspectHandle } from "../../shared/handle-skeleton.js";
import { blocksEither } from "./social.js";
import { canSeeAudience, grantsFor, setListGrants } from "./audience.js";
import {
  CATALOG,
  EARLY_BEFORE,
  badgeById,
  crossedTiers,
  nextStep,
  progressRatio,
  tierFor,
  tierRank
} from "../../shared/badges.js";

const PUBLIC_ID = /^\d{12}$/;
const AUDIENCES = ["public", "followers", "mutuals", "lists", "only"];
const PIN_MAX = 3;

export const BADGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS account_badges (
    public_id TEXT NOT NULL,
    badge_id TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 0,
    earned_at INTEGER NOT NULL DEFAULT 0,
    audience TEXT NOT NULL DEFAULT 'public',
    pinned INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (public_id, badge_id)
  )`,
  "CREATE INDEX IF NOT EXISTS account_badges_owner ON account_badges(public_id, pinned DESC, earned_at DESC)",
  `CREATE TABLE IF NOT EXISTS account_badge_notices (
    public_id TEXT NOT NULL,
    badge_id TEXT NOT NULL,
    tier TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (public_id, badge_id, tier)
  )`
];

function rows(result) {
  return (result && result.results) || [];
}

function cleanAudience(value) {
  const text = String(value || "");
  if (text === "friends") return "mutuals";
  if (text === "list") return "lists";
  if (text === "me") return "only";
  return AUDIENCES.indexOf(text) >= 0 ? text : "public";
}

function seeAs(audience) {
  if (audience === "mutuals") return "friends";
  if (audience === "lists") return "list";
  if (audience === "only") return "only";
  if (audience === "followers") return "followers";
  return "public";
}

async function countOf(env, sql, binds) {
  try {
    const row = await env.DB.prepare(sql).bind(...binds).first();
    return Number(row && row.n) || 0;
  } catch (err) {
    return 0;
  }
}

async function metricsOf(env, account) {
  const id = account.public_id;
  const created = Number(account.created_at) || 0;
  const ageDays = created > 0 ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : 0;
  let streak = 0;
  try {
    const row = await env.DB.prepare("SELECT streak FROM point_streaks WHERE public_id = ? AND kind = ?").bind(id, "login").first();
    streak = Number(row && row.streak) || 0;
  } catch (err) { streak = 0; }
  return {
    ageDays: ageDays,
    loginStreak: streak,
    posts: await countOf(env, "SELECT COUNT(*) AS n FROM public_posts WHERE author_id = ? AND parent_id = '' AND hidden = 0", [id]),
    comments: await countOf(env, "SELECT COUNT(*) AS n FROM public_posts WHERE author_id = ? AND parent_id != '' AND hidden = 0", [id]),
    reposts: await countOf(env, "SELECT COUNT(*) AS n FROM account_reposts WHERE public_id = ?", [id]),
    followers: await countOf(env, "SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ?", ["app:" + id]),
    giftsSent: await countOf(env, "SELECT COUNT(*) AS n FROM gift_sends WHERE sender_id = ?", [id]),
    giftsReceived: await countOf(env, "SELECT COUNT(*) AS n FROM gift_sends WHERE recipient_id = ?", [id]),
    stories: await countOf(env, "SELECT COUNT(*) AS n FROM app_stories WHERE public_id = ?", [id]),
    highlights: await countOf(env, "SELECT COUNT(*) AS n FROM highlights WHERE public_id = ?", [id]),
    lives: await countOf(env, "SELECT COUNT(*) AS n FROM live_sessions WHERE host_id = ?", [id]),
    early: created > 0 && created < EARLY_BEFORE ? 1 : 0,
    reports: await countOf(env, "SELECT COUNT(*) AS n FROM post_reports WHERE reporter_id = ? AND status = 'hidden'", [id])
  };
}

async function grantPoints(env, publicId, badgeId, tier, points) {
  const delta = Number(points) || 0;
  if (delta <= 0) return 0;
  const ref = badgeId + ":" + tier;
  try {
    const prior = await env.DB.prepare(
      "SELECT id FROM point_ledger WHERE public_id = ? AND reason = ? AND ref = ?"
    ).bind(publicId, "badge", ref).first();
    if (prior) return 0;
    const now = Date.now();
    const id = crypto.randomUUID().replace(/-/g, "");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO point_ledger (id, public_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id, publicId, delta, "badge", ref, now),
      env.DB.prepare(
        "INSERT INTO point_balances (public_id, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at"
      ).bind(publicId, delta, now)
    ]);
    return delta;
  } catch (err) {
    return 0;
  }
}

function pointsFor(def, tier) {
  const at = ["bronze", "silver", "gold"].indexOf(tier);
  if (!def || at < 0) return 0;
  return Number(def.points[at]) || 0;
}

export async function syncBadges(env, publicId) {
  if (!PUBLIC_ID.test(String(publicId || ""))) return [];
  let account = null;
  try {
    account = await env.DB.prepare("SELECT public_id, created_at FROM accounts WHERE public_id = ?").bind(publicId).first();
  } catch (err) {
    return [];
  }
  if (!account) return [];
  const stats = await metricsOf(env, account);
  const fresh = [];
  for (let i = 0; i < CATALOG.length; i++) {
    const def = CATALOG[i];
    const value = Number(stats[def.metric]) || 0;
    const tier = tierFor(def, value);
    let existing = null;
    try {
      existing = await env.DB.prepare(
        "SELECT tier, earned_at FROM account_badges WHERE public_id = ? AND badge_id = ?"
      ).bind(publicId, def.id).first();
    } catch (err) {
      return fresh;
    }
    const prev = existing ? existing.tier : "";
    const now = Date.now();
    if (!existing) {
      if (!tier) continue;
      await env.DB.prepare(
        "INSERT INTO account_badges (public_id, badge_id, tier, progress, earned_at, audience, pinned) VALUES (?, ?, ?, ?, ?, 'public', 0)"
      ).bind(publicId, def.id, tier, value, now).run();
    } else {
      const keep = tierRank(tier) >= tierRank(prev) ? tier : prev;
      await env.DB.prepare(
        "UPDATE account_badges SET tier = ?, progress = ?, earned_at = CASE WHEN earned_at = 0 AND ? != '' THEN ? ELSE earned_at END WHERE public_id = ? AND badge_id = ?"
      ).bind(keep, value, keep, now, publicId, def.id).run();
    }
    const gained = crossedTiers(prev, tier, def.flat);
    for (let t = 0; t < gained.length; t++) {
      const step = gained[t];
      try {
        await env.DB.prepare(
          "INSERT INTO account_badge_notices (public_id, badge_id, tier, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(public_id, badge_id, tier) DO NOTHING"
        ).bind(publicId, def.id, step, now).run();
      } catch (err) { /* the badge row is already saved */ }
      await grantPoints(env, publicId, def.id, step, pointsFor(def, step));
      fresh.push({ id: def.id, tier: step });
    }
  }
  return fresh;
}

async function loadRows(env, publicId) {
  try {
    const listed = await env.DB.prepare(
      "SELECT badge_id, tier, progress, earned_at, audience, pinned FROM account_badges WHERE public_id = ?"
    ).bind(publicId).all();
    return rows(listed);
  } catch (err) {
    return [];
  }
}

function cardOf(def, row, value, own) {
  const tier = row && tierRank(row.tier) > 0 ? row.tier : "";
  const progress = value != null ? Number(value) || 0 : Number(row && row.progress) || 0;
  const next = nextStep(def, progress);
  const card = {
    id: def.id,
    tier: tier,
    progress: progress,
    goal: next ? next.goal : (def.flat ? def.steps[0] : def.steps[2]),
    nextTier: next ? next.tier : "",
    ratio: progressRatio(def, progress),
    earned: !!tier
  };
  if (own) {
    card.audience = cleanAudience(row && row.audience);
    card.pinned = !!(row && Number(row.pinned) === 1);
  } else if (row && Number(row.pinned) === 1) {
    card.pinned = true;
  }
  return card;
}

async function visible(env, viewerId, owner, row) {
  if (!row || tierRank(row.tier) <= 0) return false;
  if (viewerId && viewerId === owner.public_id) return true;
  if (owner.profile_less === 1) return false;
  if (viewerId && await blocksEither(env, viewerId, owner.public_id)) return false;
  return canSeeAudience(env, {
    viewerId: viewerId || "",
    ownerId: owner.public_id,
    audience: seeAs(cleanAudience(row.audience)),
    subject: "badge",
    subjectId: row.badge_id,
    profileLess: owner.profile_less === 1
  });
}

async function noticesOf(env, publicId) {
  try {
    const listed = await env.DB.prepare(
      "SELECT badge_id, tier, created_at FROM account_badge_notices WHERE public_id = ? ORDER BY created_at ASC LIMIT 12"
    ).bind(publicId).all();
    return rows(listed).map((row) => ({ id: row.badge_id, tier: row.tier, at: row.created_at }));
  } catch (err) {
    return [];
  }
}

function sortCards(list) {
  return list.slice().sort((a, b) => {
    if (!!b.pinned - !!a.pinned) return (!!b.pinned) - (!!a.pinned);
    return tierRank(b.tier) - tierRank(a.tier);
  });
}

export async function handleBadges(request, env, path, deps) {
  const viewer = await deps.sessionAccount(env, request);
  if (path === "/v1/badges" && request.method === "GET") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    const paced = await deps.rateHit(env, "badge-read:" + viewer.public_id, 60, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const handle = String(new URL(request.url).searchParams.get("handle") || "").replace(/^@/, "");
    if (handle) {
      const checked = inspectHandle(handle);
      if (!checked.ok) return deps.json(400, { error: "handle" });
      const owner = await env.DB.prepare("SELECT public_id, handle, created_at, profile_less FROM accounts WHERE skeleton = ?").bind(checked.skeleton).first();
      if (!owner) return deps.json(404, { error: "not_found" });
      const mine = owner.public_id === viewer.public_id;
      if (mine) await syncBadges(env, viewer.public_id);
      const stored = await loadRows(env, owner.public_id);
      const byId = new Map(stored.map((row) => [row.badge_id, row]));
      const cards = [];
      for (let i = 0; i < CATALOG.length; i++) {
        const def = CATALOG[i];
        const row = byId.get(def.id) || null;
        if (!mine && !(await visible(env, viewer.public_id, owner, row))) continue;
        if (!mine && (!row || tierRank(row.tier) <= 0)) continue;
        cards.push(cardOf(def, row, mine ? Number(row && row.progress) || 0 : null, mine));
      }
      const body = { badges: mine ? cards : sortCards(cards.filter((card) => card.earned)) };
      if (mine) body.notices = await noticesOf(env, viewer.public_id);
      return deps.json(200, body);
    }
    await syncBadges(env, viewer.public_id);
    const account = await env.DB.prepare("SELECT public_id, created_at FROM accounts WHERE public_id = ?").bind(viewer.public_id).first();
    const stats = account ? await metricsOf(env, account) : {};
    const stored = await loadRows(env, viewer.public_id);
    const byId = new Map(stored.map((row) => [row.badge_id, row]));
    const badges = CATALOG.map((def) => cardOf(def, byId.get(def.id) || null, Number(stats[def.metric]) || 0, true));
    return deps.json(200, { badges: badges, notices: await noticesOf(env, viewer.public_id) });
  }

  if (path === "/v1/badges/seen" && request.method === "POST") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: body.error });
    const id = String(body.id || "");
    const tier = String(body.tier || "");
    if (!badgeById(id) || tierRank(tier) <= 0) return deps.json(400, { error: "badge" });
    await env.DB.prepare(
      "DELETE FROM account_badge_notices WHERE public_id = ? AND badge_id = ? AND tier = ?"
    ).bind(viewer.public_id, id, tier).run();
    return deps.json(200, { ok: true });
  }

  const one = path.match(/^\/v1\/badges\/([a-z]+)$/);
  if (one && request.method === "PATCH") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    const def = badgeById(one[1]);
    if (!def) return deps.json(404, { error: "not_found" });
    const paced = await deps.rateHit(env, "badge-set:" + viewer.public_id, 40, 10 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 4000);
    if (body.error) return deps.json(400, { error: body.error });
    await syncBadges(env, viewer.public_id);
    const row = await env.DB.prepare(
      "SELECT tier, audience, pinned FROM account_badges WHERE public_id = ? AND badge_id = ?"
    ).bind(viewer.public_id, def.id).first();
    if (!row || tierRank(row.tier) <= 0) return deps.json(404, { error: "not_earned" });
    let pinned = Number(row.pinned) === 1 ? 1 : 0;
    if (body.pinned != null) {
      pinned = body.pinned ? 1 : 0;
      if (pinned) {
        const count = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM account_badges WHERE public_id = ? AND pinned = 1 AND badge_id != ?"
        ).bind(viewer.public_id, def.id).first();
        if (Number(count && count.n) >= PIN_MAX) return deps.json(400, { error: "pins" });
      }
    }
    const audience = body.audience != null ? cleanAudience(body.audience) : cleanAudience(row.audience);
    if (body.audience != null && AUDIENCES.indexOf(audience) < 0) return deps.json(400, { error: "audience" });
    await env.DB.prepare(
      "UPDATE account_badges SET audience = ?, pinned = ? WHERE public_id = ? AND badge_id = ?"
    ).bind(audience, pinned, viewer.public_id, def.id).run();
    if (audience === "lists") {
      const ids = Array.isArray(body.listIds) ? body.listIds : [];
      await setListGrants(env, viewer.public_id, "badge", def.id, ids);
    }
    const lists = audience === "lists" ? await grantsFor(env, viewer.public_id, "badge", def.id) : [];
    return deps.json(200, { ok: true, id: def.id, audience: audience, pinned: pinned === 1, listIds: lists });
  }
  return null;
}
