/* Discord alerts run on messages the app already fetched.
   Nothing in this file calls Discord. A 429 is the caller's signal
   to wait; matching never sends a request of its own. */

import { cleanDiscordRule, matchDiscordMessage, quietEndsAt } from "../../shared/discord-alerts.js";
import { commitBundled, ensureMentionSchema } from "./mention-store.js";
import { planNotification } from "./notifications.js";
import { logError } from "./log.js";

export const DISCORD_ALERT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS discord_alert_prefs (
    public_id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS discord_alert_hits (
    public_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (public_id, message_id)
  )`
];

let ready = null;

function ensure(env) {
  if (!ready) {
    ready = ensureMentionSchema(env).then(() => env.DB.batch(DISCORD_ALERT_SCHEMA.map((sql) => env.DB.prepare(sql)))).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function clip(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max);
}

async function loadRule(env, publicId) {
  const row = await env.DB.prepare("SELECT body FROM discord_alert_prefs WHERE public_id = ?").bind(publicId).first();
  let parsed = {};
  try { parsed = JSON.parse((row && row.body) || "{}"); }
  catch (err) { parsed = {}; }
  return cleanDiscordRule(parsed);
}

function cleanMessages(list) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, 40).forEach((row) => {
    if (!row || typeof row !== "object") return;
    const id = String(row.id || "");
    if (!/^\d{2,22}$/.test(id)) return;
    out.push({
      id,
      content: clip(row.content || row.body || "", 500),
      authorId: /^\d{2,22}$/.test(String(row.authorId || "")) ? String(row.authorId) : "",
      channelId: /^\d{2,22}$/.test(String(row.channelId || "")) ? String(row.channelId) : "",
      serverId: /^\d{2,22}$/.test(String(row.serverId || "")) ? String(row.serverId) : "",
      authorName: clip(row.authorName || "", 80)
    });
  });
  return out;
}

function applyMutes(rule, body) {
  const mutedChannels = [];
  const mutedServers = [];
  (Array.isArray(body.mutedChannels) ? body.mutedChannels : []).forEach((id) => {
    const text = String(id || "");
    if (/^\d{2,22}$/.test(text) && mutedChannels.indexOf(text) < 0 && mutedChannels.length < 200) mutedChannels.push(text);
  });
  (Array.isArray(body.mutedServers) ? body.mutedServers : []).forEach((id) => {
    const text = String(id || "");
    if (/^\d{2,22}$/.test(text) && mutedServers.indexOf(text) < 0 && mutedServers.length < 50) mutedServers.push(text);
  });
  return Object.assign({}, rule, { mutedChannels, mutedServers });
}

/* Channels the member marked private: an alert still fires, but it says
   only that a message arrived, never who wrote it or what it says. */
function privateSet(body) {
  const out = new Set();
  (Array.isArray(body.privateChannels) ? body.privateChannels : []).slice(0, 200).forEach((id) => {
    const text = String(id || "");
    if (/^\d{2,22}$/.test(text)) out.add(text);
  });
  return out;
}

function previewMatches(messages, rule) {
  const matches = [];
  messages.forEach((message) => {
    const hit = matchDiscordMessage(message, rule);
    if (hit.hit) matches.push({ id: message.id, reason: hit.reason });
  });
  return matches;
}

export async function handleDiscordAlertRoutes(request, env, path, deps) {
  if (path !== "/v1/discord/alerts" && path !== "/v1/discord/alerts/preview" && path !== "/v1/discord/alerts/ingest") return null;
  const { json, sessionAccount, readJson, rateHit, limited } = deps;
  await ensure(env);
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  if (path === "/v1/discord/alerts" && request.method === "GET") {
    const hit = await rateHit(env, "discord-alert-read:" + row.public_id, 60, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    return json(200, { rule: await loadRule(env, row.public_id) });
  }
  if (path === "/v1/discord/alerts" && request.method === "PUT") {
    const hit = await rateHit(env, "discord-alert-write:" + row.public_id, 30, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const body = await readJson(request, 20000);
    if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
    const rule = cleanDiscordRule(body.rule || body);
    await env.DB.prepare(
      "INSERT INTO discord_alert_prefs (public_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
    ).bind(row.public_id, JSON.stringify(rule), Date.now()).run();
    return json(200, { rule });
  }
  if ((path === "/v1/discord/alerts/preview" || path === "/v1/discord/alerts/ingest") && request.method === "POST") {
    const hit = await rateHit(env, "discord-alert-match:" + row.public_id, 60, 10 * 60 * 1000);
    if (!hit.ok) return limited(hit);
    const body = await readJson(request, 80000);
    if (body.error) return json(body.error === "too_large" ? 413 : 400, { error: body.error });
    const saved = body.rule ? cleanDiscordRule(body.rule) : await loadRule(env, row.public_id);
    const rule = applyMutes(saved, body);
    const messages = cleanMessages(body.messages);
    const hush = privateSet(body);
    const matches = previewMatches(messages, rule);
    if (path === "/v1/discord/alerts/preview") return json(200, { matches });
    const now = Date.now();
    const quietUntil = quietEndsAt(now, rule);
    const statements = [];
    const deliveries = [];
    let created = 0;
    for (let i = 0; i < matches.length; i++) {
      const message = messages.find((item) => item.id === matches[i].id);
      if (!message) continue;
      const seen = await env.DB.prepare(
        "SELECT message_id FROM discord_alert_hits WHERE public_id = ? AND message_id = ?"
      ).bind(row.public_id, message.id).first();
      if (seen) continue;
      statements.push(env.DB.prepare(
        "INSERT INTO discord_alert_hits (public_id, message_id, created_at) VALUES (?, ?, ?) ON CONFLICT(public_id, message_id) DO NOTHING"
      ).bind(row.public_id, message.id, now));
      const planned = await planNotification(env, {
        publicId: row.public_id,
        kind: "discord",
        at: now,
        actorId: "",
        idempotencyKey: "discord:" + message.id,
        handle: "",
        name: hush.has(message.channelId) ? "Discord" : (message.authorName || "Discord"),
        text: hush.has(message.channelId) ? "New message" : clip(message.content, 180),
        hash: message.channelId ? "#/messages/discord/" + encodeURIComponent(message.channelId) : "#/messages",
        platform: "discord",
        feedId: message.channelId ? "discord:" + message.channelId : "discord",
        mention: true,
        quietUntil
      });
      if (planned && planned.statements && planned.statements.length) {
        planned.statements.forEach((statement) => statements.push(statement));
        created += 1;
      }
      if (planned && planned.deliveries) planned.deliveries.forEach((delivery) => deliveries.push(delivery));
    }
    try { await commitBundled(env, statements, deliveries); }
    catch (err) {
      logError("discord-alert", "match_failed");
      return json(500, { error: "unavailable" });
    }
    return json(200, { matches, created });
  }
  return null;
}
