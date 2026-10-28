/* Free points and gifts. Amounts are chosen here, never from the client.
   The ledger is append-only. A repeated ref does not pay twice. */

import { inspectHandle } from "../../shared/handle-skeleton.js";
import { blocksEither } from "./social.js";
import { planNotification } from "./notifications.js";
import { commitBundled } from "./mention-store.js";

export const POINTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS point_ledger (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS point_ledger_account ON point_ledger(public_id, created_at DESC)",
  "CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_once ON point_ledger(public_id, reason, ref)",
  `CREATE TABLE IF NOT EXISTS point_balances (
    public_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS point_daily (
    public_id TEXT NOT NULL,
    day TEXT NOT NULL,
    action TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (public_id, day, action)
  )`,
  `CREATE TABLE IF NOT EXISTS point_streaks (
    public_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    last_day TEXT NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (public_id, kind)
  )`,
  `CREATE TABLE IF NOT EXISTS point_invites (
    code TEXT PRIMARY KEY,
    inviter_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    redeemed_by TEXT NOT NULL DEFAULT '',
    redeemed_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS gift_sends (
    id TEXT PRIMARY KEY,
    gift_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    privacy TEXT NOT NULL DEFAULT 'public',
    hidden INTEGER NOT NULL DEFAULT 0,
    cost INTEGER NOT NULL,
    context TEXT NOT NULL DEFAULT 'direct',
    post_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS gift_sends_recipient ON gift_sends(recipient_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS gift_prefs (
    public_id TEXT PRIMARY KEY,
    hide_tab INTEGER NOT NULL DEFAULT 0,
    who TEXT NOT NULL DEFAULT 'everyone',
    updated_at INTEGER NOT NULL
  )`
];

export const RULES = {
  signup: { points: 25, cap: 1 },
  login: { points: 5, cap: 1, streak: 7 },
  read: { points: 2, cap: 1, streak: 3 },
  post: { points: 8, cap: 5 },
  comment: { points: 3, cap: 10 },
  repost: { points: 3, cap: 10 },
  like_in: { points: 1, cap: 20 },
  reply_in: { points: 2, cap: 10 },
  follow: { points: 2, cap: 10 },
  profile: { points: 15, cap: 1 },
  invite: { points: 20, cap: 5 },
  game: { points: 4, cap: 5 }
};

const GAMES = { regone: 1 };
const PUBLIC_ID = /^\d{12}$/;

const SVG = {
  heart: "M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z",
  star: "m12 3 2.4 5.6L20 9.2l-4 3.8.9 5.8L12 16.2 7.1 18.8 8 13 4 9.2l5.6-.6L12 3z",
  spark: "M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z",
  leaf: "M5 19c8-1 14-8 14-14-6 0-13 6-14 14zm2-2c1-4 5-8 9-9-1 4-5 8-9 9z",
  comet: "M14 4l1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4zM6 14l.6 2 2 .6-2 .6L6 20l-.6-2.8L3.4 16.6 5.4 16 6 14z",
  crown: "M4 16l2-8 4 4 2-6 2 6 4-4 2 8H4zm1 2h14v2H5v-2z"
};

export const GIFT_CATALOG = [
  { id: "heart", category: "kindness", price: 10, seasonal: false, svg: SVG.heart },
  { id: "star", category: "kindness", price: 25, seasonal: false, svg: SVG.star },
  { id: "spark", category: "celebrate", price: 50, seasonal: false, svg: SVG.spark },
  { id: "leaf", category: "seasonal", price: 50, seasonal: true, svg: SVG.leaf },
  { id: "comet", category: "celebrate", price: 100, seasonal: false, svg: SVG.comet },
  { id: "crown", category: "celebrate", price: 250, seasonal: false, svg: SVG.crown }
];

function giftById(id) {
  return GIFT_CATALOG.find((item) => item.id === id) || null;
}

function hex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function newId() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function yesterday(day) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function rowsOf(result) {
  return (result && result.results) || [];
}

export function ruleList() {
  return Object.keys(RULES).map((id) => ({
    id: id,
    points: RULES[id].points,
    cap: RULES[id].cap,
    streak: RULES[id].streak || 0
  }));
}

async function balanceOf(env, publicId) {
  const row = await env.DB.prepare("SELECT balance FROM point_balances WHERE public_id = ?").bind(publicId).first();
  return Number(row && row.balance) || 0;
}

export async function awardActivity(env, publicId, action, ref) {
  const rule = RULES[action];
  if (!rule || !PUBLIC_ID.test(String(publicId || ""))) return { awarded: 0, balance: 0 };
  const mark = String(ref || "").slice(0, 120);
  if (!mark) return { awarded: 0, balance: await balanceOf(env, publicId) };
  const now = Date.now();
  const day = utcDay(now);
  const prior = await env.DB.prepare(
    "SELECT id FROM point_ledger WHERE public_id = ? AND reason = ? AND ref = ?"
  ).bind(publicId, action, mark).first();
  if (prior) return { awarded: 0, balance: await balanceOf(env, publicId), duplicate: true };
  const daily = await env.DB.prepare(
    "SELECT hits FROM point_daily WHERE public_id = ? AND day = ? AND action = ?"
  ).bind(publicId, day, action).first();
  if (Number(daily && daily.hits) >= rule.cap) return { awarded: 0, balance: await balanceOf(env, publicId), capped: true };
  let bonus = 0;
  if (rule.streak) {
    const streakRow = await env.DB.prepare(
      "SELECT last_day, streak FROM point_streaks WHERE public_id = ? AND kind = ?"
    ).bind(publicId, action).first();
    let streak = 1;
    if (streakRow && streakRow.last_day === yesterday(day)) streak = Math.min(rule.streak, (Number(streakRow.streak) || 0) + 1);
    else if (streakRow && streakRow.last_day === day) streak = Number(streakRow.streak) || 1;
    bonus = Math.max(0, streak - 1);
    await env.DB.prepare(
      "INSERT INTO point_streaks (public_id, kind, last_day, streak) VALUES (?, ?, ?, ?) ON CONFLICT(public_id, kind) DO UPDATE SET last_day = excluded.last_day, streak = excluded.streak"
    ).bind(publicId, action, day, streak).run();
  }
  const delta = rule.points + bonus;
  const id = newId();
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO point_ledger (id, public_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id, publicId, delta, action, mark, now),
      env.DB.prepare(
        "INSERT INTO point_balances (public_id, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at"
      ).bind(publicId, delta, now),
      env.DB.prepare(
        "INSERT INTO point_daily (public_id, day, action, hits) VALUES (?, ?, ?, 1) ON CONFLICT(public_id, day, action) DO UPDATE SET hits = hits + 1"
      ).bind(publicId, day, action)
    ]);
  } catch (err) {
    if (!/UNIQUE/i.test(String(err && err.message || err))) throw err;
    return { awarded: 0, balance: await balanceOf(env, publicId), duplicate: true };
  }
  return { awarded: delta, balance: await balanceOf(env, publicId) };
}

export async function clawback(env, publicId, action, ref) {
  if (!PUBLIC_ID.test(String(publicId || "")) || !RULES[action]) return { awarded: 0 };
  const mark = String(ref || "").slice(0, 120);
  if (!mark) return { awarded: 0 };
  const original = await env.DB.prepare(
    "SELECT delta FROM point_ledger WHERE public_id = ? AND reason = ? AND ref = ? AND delta > 0"
  ).bind(publicId, action, mark).first();
  if (!original) return { awarded: 0 };
  const clawRef = "claw:" + mark;
  const already = await env.DB.prepare(
    "SELECT id FROM point_ledger WHERE public_id = ? AND reason = ? AND ref = ?"
  ).bind(publicId, action, clawRef).first();
  if (already) return { awarded: 0, duplicate: true };
  const balance = await balanceOf(env, publicId);
  const delta = -Math.min(Number(original.delta) || 0, balance);
  if (!delta) return { awarded: 0, balance: balance };
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO point_ledger (id, public_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(newId(), publicId, delta, action, clawRef, now),
    env.DB.prepare(
      "UPDATE point_balances SET balance = balance + ?, updated_at = ? WHERE public_id = ?"
    ).bind(delta, now, publicId)
  ]);
  return { awarded: delta, balance: await balanceOf(env, publicId) };
}

export async function spendPoints(env, publicId, amount, reason, ref) {
  const cost = Math.floor(Number(amount) || 0);
  if (cost <= 0 || !PUBLIC_ID.test(String(publicId || ""))) return { ok: false, error: "cost" };
  const balance = await balanceOf(env, publicId);
  if (balance < cost) return { ok: false, error: "balance", balance: balance };
  const now = Date.now();
  const mark = String(ref || newId()).slice(0, 120);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO point_ledger (id, public_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(newId(), publicId, -cost, reason, mark, now),
    env.DB.prepare(
      "UPDATE point_balances SET balance = balance - ?, updated_at = ? WHERE public_id = ?"
    ).bind(cost, now, publicId)
  ]);
  return { ok: true, balance: await balanceOf(env, publicId) };
}

async function history(env, publicId) {
  const listed = await env.DB.prepare(
    "SELECT delta, reason, created_at FROM point_ledger WHERE public_id = ? ORDER BY created_at DESC LIMIT 40"
  ).bind(publicId).all();
  return rowsOf(listed).map((row) => ({
    delta: Number(row.delta) || 0,
    reason: row.reason,
    at: Number(row.created_at) || 0
  }));
}

function cleanMessage(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 500);
}

async function accountByHandle(env, handle) {
  const checked = inspectHandle(String(handle || "").replace(/^@/, ""));
  if (!checked.ok) return null;
  return env.DB.prepare(
    "SELECT public_id, handle, display_name, bio, avatar, location FROM accounts WHERE skeleton = ?"
  ).bind(checked.skeleton).first();
}

async function prefsOf(env, publicId) {
  const row = await env.DB.prepare("SELECT hide_tab, who FROM gift_prefs WHERE public_id = ?").bind(publicId).first();
  const who = row && (row.who === "followers" || row.who === "nobody") ? row.who : "everyone";
  return { hideTab: !!(row && row.hide_tab === 1), who: who };
}

function presentGift(row, viewerId, owner) {
  const privacy = row.privacy === "private" || row.privacy === "anonymous" ? row.privacy : "public";
  const gift = giftById(row.gift_id);
  const item = {
    id: row.id,
    giftId: row.gift_id,
    svg: gift ? gift.svg : "",
    message: row.message || "",
    at: Number(row.created_at) || 0,
    hidden: row.hidden === 1,
    context: row.context || "direct",
    postId: row.post_id || ""
  };
  const showSender = privacy === "public" || (privacy === "private" && (owner || viewerId === row.recipient_id));
  if (showSender && privacy !== "anonymous") {
    item.sender = { handle: row.sender_handle || "", name: row.sender_name || "" };
  } else item.sender = null;
  return item;
}

async function listGifts(env, ownerId, viewerId, owner) {
  const prefs = await prefsOf(env, ownerId);
  if (prefs.hideTab && !owner) return { hidden: true, who: prefs.who, gifts: [] };
  const listed = await env.DB.prepare(
    "SELECT g.id, g.gift_id, g.sender_id, g.recipient_id, g.message, g.privacy, g.hidden, g.context, g.post_id, g.created_at, a.handle AS sender_handle, a.display_name AS sender_name FROM gift_sends g LEFT JOIN accounts a ON a.public_id = g.sender_id WHERE g.recipient_id = ? ORDER BY g.created_at DESC LIMIT 80"
  ).bind(ownerId).all();
  const gifts = [];
  rowsOf(listed).forEach((row) => {
    if (row.hidden === 1 && !owner) return;
    gifts.push(presentGift(row, viewerId, owner));
  });
  return { hidden: false, who: owner ? prefs.who : "", hideTab: owner ? prefs.hideTab : false, gifts: gifts };
}

export async function dailyFreeGift() {
  return { enabled: false };
}

export async function giftForPost(env, postId, viewerId) {
  if (!postId) return null;
  const row = await env.DB.prepare(
    "SELECT g.id, g.gift_id, g.sender_id, g.recipient_id, g.message, g.privacy, g.hidden, g.context, g.post_id, g.created_at, a.handle AS sender_handle, a.display_name AS sender_name FROM gift_sends g LEFT JOIN accounts a ON a.public_id = g.sender_id WHERE g.post_id = ?"
  ).bind(postId).first();
  if (!row || row.hidden === 1) return null;
  const owner = viewerId && viewerId === row.recipient_id;
  return presentGift(row, viewerId || "", !!owner);
}

export async function handlePoints(request, env, path, deps) {
  const url = new URL(request.url);
  const viewer = await deps.sessionAccount(env, request);
  if (path === "/v1/gifts/catalog" && request.method === "GET") {
    return deps.json(200, { gifts: GIFT_CATALOG.map((item) => ({ id: item.id, category: item.category, price: item.price, seasonal: item.seasonal, svg: item.svg })) });
  }
  if (path === "/v1/gifts/daily" && request.method === "GET") return deps.json(200, await dailyFreeGift());
  if (path === "/v1/points/board" && request.method === "GET") {
    return deps.json(200, { enabled: String(env.POINTS_BOARD || "") === "on" });
  }
  if (path === "/v1/gifts/inbox" && request.method === "GET") {
    if (!viewer) return deps.json(401, { error: "unauthorized" });
    const listed = await env.DB.prepare(
      "SELECT g.id, g.gift_id, g.sender_id, g.recipient_id, g.message, g.privacy, g.hidden, g.context, g.post_id, g.created_at, a.handle AS sender_handle, a.display_name AS sender_name FROM gift_sends g LEFT JOIN accounts a ON a.public_id = g.sender_id WHERE g.recipient_id = ? AND g.context = 'dm' AND g.hidden = 0 ORDER BY g.created_at DESC LIMIT 40"
    ).bind(viewer.public_id).all();
    return deps.json(200, { gifts: rowsOf(listed).map((row) => presentGift(row, viewer.public_id, true)) });
  }
  if (path === "/v1/gifts" && request.method === "GET") {
    const handle = String(url.searchParams.get("handle") || "");
    const ownerRow = handle ? await accountByHandle(env, handle) : viewer;
    if (!ownerRow) return deps.json(handle ? 404 : 401, { error: handle ? "not_found" : "unauthorized" });
    const owner = !!(viewer && viewer.public_id === ownerRow.public_id);
    return deps.json(200, await listGifts(env, ownerRow.public_id, viewer ? viewer.public_id : "", owner));
  }
  if (!viewer) return deps.json(401, { error: "unauthorized" });
  if (path === "/v1/points" && request.method === "GET") {
    return deps.json(200, {
      balance: await balanceOf(env, viewer.public_id),
      history: await history(env, viewer.public_id),
      rules: ruleList()
    });
  }
  if (path === "/v1/points/touch" && request.method === "POST") {
    const paced = await deps.rateHit(env, "points:" + viewer.public_id, 30, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: body.error });
    const action = String(body.action || "");
    const day = utcDay(Date.now());
    let result = { awarded: 0 };
    if (action === "login" || action === "read") result = await awardActivity(env, viewer.public_id, action, day);
    else if (action === "game" && GAMES[String(body.gameId || "")]) result = await awardActivity(env, viewer.public_id, "game", day + ":" + body.gameId);
    else if (action === "profile") {
      const ready = viewer.display_name && String(viewer.bio || "").trim() && (viewer.avatar || viewer.location);
      if (!ready) return deps.json(400, { error: "incomplete" });
      result = await awardActivity(env, viewer.public_id, "profile", "profile");
    } else return deps.json(400, { error: "action" });
    return deps.json(200, { awarded: result.awarded || 0, balance: result.balance != null ? result.balance : await balanceOf(env, viewer.public_id) });
  }
  if (path === "/v1/points/invites" && request.method === "POST") {
    const code = hex(crypto.getRandomValues(new Uint8Array(8)));
    await env.DB.prepare(
      "INSERT INTO point_invites (code, inviter_id, created_at, redeemed_by, redeemed_at) VALUES (?, ?, ?, '', 0)"
    ).bind(code, viewer.public_id, Date.now()).run();
    return deps.json(201, { code: code });
  }
  if (path === "/v1/points/invites/redeem" && request.method === "POST") {
    const body = await deps.readJson(request, 1000);
    if (body.error) return deps.json(400, { error: body.error });
    const code = String(body.code || "").toLowerCase();
    if (!/^[a-f0-9]{16}$/.test(code)) return deps.json(400, { error: "code" });
    const row = await env.DB.prepare("SELECT inviter_id, redeemed_by FROM point_invites WHERE code = ?").bind(code).first();
    if (!row || row.redeemed_by || row.inviter_id === viewer.public_id) return deps.json(400, { error: "code" });
    await env.DB.prepare(
      "UPDATE point_invites SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_by = ''"
    ).bind(viewer.public_id, Date.now(), code).run();
    const paid = await awardActivity(env, row.inviter_id, "invite", code);
    return deps.json(200, { ok: true, awarded: 0, inviterAwarded: paid.awarded || 0 });
  }
  if (path === "/v1/gifts/prefs" && request.method === "PUT") {
    const body = await deps.readJson(request, 1000);
    if (body.error) return deps.json(400, { error: body.error });
    const who = body.who === "followers" || body.who === "nobody" ? body.who : "everyone";
    const hide = body.hideTab ? 1 : 0;
    await env.DB.prepare(
      "INSERT INTO gift_prefs (public_id, hide_tab, who, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET hide_tab = excluded.hide_tab, who = excluded.who, updated_at = excluded.updated_at"
    ).bind(viewer.public_id, hide, who, Date.now()).run();
    return deps.json(200, { hideTab: !!hide, who: who });
  }
  if (path === "/v1/gifts/send" && request.method === "POST") {
    const paced = await deps.rateHit(env, "gift:" + viewer.public_id, 20, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    const body = await deps.readJson(request, 4000);
    if (body.error) return deps.json(400, { error: body.error });
    const gift = giftById(String(body.giftId || ""));
    if (!gift) return deps.json(400, { error: "gift" });
    const recipient = await accountByHandle(env, body.handle || body.recipientHandle || "");
    if (!recipient || recipient.public_id === viewer.public_id) return deps.json(400, { error: "recipient" });
    if (await blocksEither(env, viewer.public_id, recipient.public_id)) return deps.json(403, { error: "blocked" });
    const prefs = await prefsOf(env, recipient.public_id);
    if (prefs.who === "nobody") return deps.json(403, { error: "closed" });
    if (prefs.who === "followers") {
      const follow = await env.DB.prepare(
        "SELECT target_id FROM account_follows WHERE follower_id = ? AND target_id = ?"
      ).bind(viewer.public_id, "app:" + recipient.public_id).first();
      if (!follow) return deps.json(403, { error: "followers" });
    }
    const privacy = body.privacy === "private" || body.privacy === "anonymous" ? body.privacy : "public";
    const mode = body.mode === "reply" || body.mode === "dm" ? body.mode : "direct";
    const parentId = String(body.parentId || "").replace(/[^\w.:-]/g, "").slice(0, 80);
    if (mode === "reply" && !parentId) return deps.json(400, { error: "parent" });
    const sendId = newId();
    const paid = await spendPoints(env, viewer.public_id, gift.price, "gift", sendId);
    if (!paid.ok) return deps.json(402, { error: paid.error, balance: paid.balance || 0 });
    const now = Date.now();
    const message = cleanMessage(body.message);
    let postId = "";
    if (mode === "reply") {
      postId = newId();
      await env.DB.prepare(
        "INSERT INTO public_posts (id, author_id, body, parent_id, quote_id, created_at, hidden) VALUES (?, ?, ?, ?, '', ?, 0)"
      ).bind(postId, viewer.public_id, message || gift.id, parentId, now).run();
      try {
        await awardActivity(env, viewer.public_id, "comment", postId);
        const parentRow = await env.DB.prepare("SELECT author_id FROM public_posts WHERE id = ?").bind(parentId).first();
        if (parentRow && parentRow.author_id && parentRow.author_id !== viewer.public_id) {
          await awardActivity(env, parentRow.author_id, "reply_in", postId);
        }
      } catch (err) { /* the reply is saved */ }
    } else if (mode === "dm") {
      postId = "ct_" + hex(crypto.getRandomValues(new Uint8Array(8)));
      await env.DB.prepare(
        "INSERT INTO account_content (id, author_id, kind, parent_id, body, created_at, updated_at, deleted_at) VALUES (?, ?, 'dm', ?, ?, ?, ?, 0)"
      ).bind(postId, viewer.public_id, recipient.public_id, message || gift.id, now, now).run();
    }
    await env.DB.prepare(
      "INSERT INTO gift_sends (id, gift_id, sender_id, recipient_id, message, privacy, hidden, cost, context, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)"
    ).bind(sendId, gift.id, viewer.public_id, recipient.public_id, message, privacy, gift.price, mode, postId, now).run();
    try {
      const named = privacy !== "anonymous";
      const note = await planNotification(env, {
        publicId: recipient.public_id,
        kind: "gift",
        at: now,
        actorId: named ? viewer.public_id : "",
        idempotencyKey: "gift:" + sendId,
        handle: named ? viewer.handle : "",
        name: named ? viewer.display_name : "",
        text: cleanMessage(body.message).slice(0, 140),
        hash: "#/@" + encodeURIComponent(recipient.handle || "") + "?tab=gifts",
        platform: "app"
      });
      if (note && note.statements) await commitBundled(env, note.statements, note.deliveries || [], request);
    } catch (err) { /* the gift is already stored */ }
    const attached = postId ? await giftForPost(env, postId, recipient.public_id) : null;
    return deps.json(201, {
      id: sendId,
      balance: paid.balance,
      context: mode,
      postId: postId,
      post: mode === "reply" ? {
        id: postId,
        text: message,
        body: message,
        handle: viewer.handle,
        author: viewer.display_name,
        platform: "app",
        date: new Date(now).toISOString(),
        parentId: parentId,
        gift: attached
      } : null
    });
  }
  const hide = path.match(/^\/v1\/gifts\/([a-f0-9]{32})\/hide$/);
  if (hide && request.method === "POST") {
    const row = await env.DB.prepare("SELECT id, recipient_id, hidden FROM gift_sends WHERE id = ?").bind(hide[1]).first();
    if (!row || row.recipient_id !== viewer.public_id) return deps.json(404, { error: "not_found" });
    const next = row.hidden === 1 ? 0 : 1;
    await env.DB.prepare("UPDATE gift_sends SET hidden = ? WHERE id = ?").bind(next, row.id).run();
    return deps.json(200, { hidden: next === 1 });
  }
  return null;
}
