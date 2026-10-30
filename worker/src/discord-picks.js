/* Extra Discord servers the owner picks in Messages.

   The spare account's sync (scripts/discord_live.py, read-only) writes the
   servers it is already in to the private DATA bucket as discord/x/catalog.json.
   The owner picks servers and channels here. The pick list is saved as
   discord/x/picks.json and the sync reads it on its next ten-minute tick.
   Picked servers are written back under discord/x/. Every signed-in viewer
   reads their messages like the main server. The catalog, the pick list and
   every route here are owner only. The one Discord call is the public invite
   preview (no token). Nothing here joins a server or sends anything. */

export const PICKS_KEY = "discord/x/picks.json";
export const CATALOG_KEY = "discord/x/catalog.json";
export const REQUEST_KEY = "discord/x/request.json";
export const PRIVATE_INDEX_KEY = "discord/x/index.json";
export const JOIN_KEY = "discord/x/join.json";
export const HEALTH_KEY = "discord/x/health.json";
export const MAX_SERVERS = 12;
export const MAX_CHANNELS = 40;

const SNOWFLAKE = /^\d{15,22}$/;
const PRIVATE_DOC = /^discord\/x\/(?:index|catalog|messages\/\d{15,22}(?:\/p\/\d{1,4})?)\.json$/;

function clip(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F<>]/g, "").trim().slice(0, max);
}

function iconUrl(value) {
  const text = String(value || "");
  return /^https:\/\/cdn\.discordapp\.com\/[A-Za-z0-9/_.?=&-]{1,300}$/.test(text) ? text : "";
}

/* R2 keys under discord/x/ served by /v1/data/. The pick list and request
   stay behind their own routes. */
export function privateDiscordKey(key) {
  return PRIVATE_DOC.test(String(key || "")) ? String(key) : "";
}

export function ownerOnlyDiscordKey(key) {
  return String(key || "") === CATALOG_KEY;
}

/* discord.gg/abc, discord.com/invite/abc, or the bare code. */
export function cleanHealth(doc) {
  if (!doc || typeof doc !== "object") return { status: "ok", reason: "", at: "" };
  const status = doc.status === "invalid" ? "invalid" : "ok";
  const reason = doc.reason === "unauthorized" || doc.reason === "forbidden" ? doc.reason : "";
  return { status, reason: status === "invalid" ? reason : "", at: clip(doc.at, 40) };
}

export function inviteCode(value) {
  const text = String(value || "").trim().slice(0, 200);
  const match = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/([A-Za-z0-9-]{2,32})\/?(?:[?#].*)?$/i);
  if (match) return match[1];
  return /^[A-Za-z0-9-]{2,32}$/.test(text) ? text : "";
}

export function cleanInvite(doc, code) {
  const guild = doc && doc.guild && typeof doc.guild === "object" ? doc.guild : null;
  const id = String((guild && guild.id) || "");
  if (!SNOWFLAKE.test(id)) return null;
  const icon = /^[A-Za-z0-9_]{1,64}$/.test(String(guild.icon || "")) ? "https://cdn.discordapp.com/icons/" + id + "/" + guild.icon + ".png?size=96" : "";
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  return {
    code,
    url: "https://discord.gg/" + code,
    guild: { id, name: clip(guild.name, 80) || id, icon, description: clip(guild.description, 200) },
    members: num(doc.approximate_member_count),
    online: num(doc.approximate_presence_count),
    expiresAt: clip(doc.expires_at, 40)
  };
}

async function readDoc(env, key) {
  if (!env || !env.DATA) return null;
  try {
    const object = await env.DATA.get(key);
    if (!object) return null;
    const parsed = JSON.parse(await object.text());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

async function writeDoc(env, key, doc) {
  await env.DATA.put(key, JSON.stringify(doc), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
}

export function cleanCatalog(doc) {
  const out = { fetchedAt: clip(doc && doc.fetchedAt, 40), servers: [] };
  const list = doc && Array.isArray(doc.servers) ? doc.servers : [];
  for (let i = 0; i < list.length && out.servers.length < 200; i++) {
    const server = list[i];
    const id = String((server && server.id) || "");
    if (!SNOWFLAKE.test(id)) continue;
    const channels = [];
    const rows = Array.isArray(server.channels) ? server.channels : [];
    for (let j = 0; j < rows.length && channels.length < 300; j++) {
      const ch = rows[j];
      const cid = String((ch && ch.id) || "");
      if (!SNOWFLAKE.test(cid)) continue;
      channels.push({
        id: cid,
        name: clip(ch.name, 80) || cid,
        category: clip(ch.category, 80),
        kind: ch.kind === "announcement" ? "announcement" : "text"
      });
    }
    out.servers.push({ id, name: clip(server.name, 80) || id, icon: iconUrl(server.icon), channels });
  }
  return out;
}

/* The owner's list, checked against the catalog. Order is the list order.
   Unknown ids are dropped, so a typo cannot point the sync anywhere new. */
export function cleanPicks(body, catalog) {
  const known = {};
  ((catalog && catalog.servers) || []).forEach((server) => { known[server.id] = server; });
  const servers = [];
  const seen = {};
  let total = 0;
  const list = body && Array.isArray(body.servers) ? body.servers : [];
  for (let i = 0; i < list.length && servers.length < MAX_SERVERS; i++) {
    const id = String((list[i] && list[i].id) || "");
    const server = known[id];
    if (!server || seen[id]) continue;
    seen[id] = true;
    const byId = {};
    server.channels.forEach((ch) => { byId[ch.id] = ch; });
    const wanted = Array.isArray(list[i].channels) ? list[i].channels : [];
    const channels = [];
    const took = {};
    for (let j = 0; j < wanted.length && total < MAX_CHANNELS; j++) {
      const cid = String((wanted[j] && typeof wanted[j] === "object" ? wanted[j].id : wanted[j]) || "");
      const ch = byId[cid];
      if (!ch || took[cid]) continue;
      took[cid] = true;
      channels.push({ id: ch.id, name: ch.name, category: ch.category });
      total += 1;
    }
    if (!channels.length) continue;
    servers.push({ id: server.id, name: server.name, icon: server.icon, channels });
  }
  return { servers };
}

function sameIds(a, b) {
  const ids = (doc) => ((doc && doc.servers) || []).map((s) => s.id + ":" + (s.channels || []).map((c) => c.id).join(",")).join("|");
  return ids(a) === ids(b);
}

/* A channel taken off the list loses its copied messages right away. */
async function dropRemoved(env, prev, next) {
  const keep = {};
  ((next && next.servers) || []).forEach((s) => (s.channels || []).forEach((c) => { keep[c.id] = true; }));
  const gone = [];
  ((prev && prev.servers) || []).forEach((s) => (s.channels || []).forEach((c) => {
    if (c && SNOWFLAKE.test(String(c.id || "")) && !keep[c.id]) gone.push(String(c.id));
  }));
  const keys = [];
  gone.slice(0, MAX_CHANNELS * 2).forEach((cid) => {
    keys.push("discord/x/messages/" + cid + ".json");
    for (let n = 1; n <= 6; n++) keys.push("discord/x/messages/" + cid + "/p/" + n + ".json");
  });
  if (!keys.length) return;
  try { await env.DATA.delete(keys); }
  catch (err) { /* the next sync leaves them out of the index anyway */ }
}

/* GET  /v1/discord/picks               catalog + picks (owner)
   PUT  /v1/discord/picks               save picks (owner)
   POST /v1/discord/picks/refresh       ask the sync to re-list servers (owner)
   GET  /v1/discord/picks/invite?code=  public invite preview (owner)
   POST /v1/discord/picks/join          one confirmed join (owner). The sync
                                        sends it once with the spare account
                                        and writes the answer to join.json. */
export function isPickPath(path) {
  return path === "/v1/discord/picks" || path === "/v1/discord/picks/refresh" || path === "/v1/discord/picks/invite" || path === "/v1/discord/picks/join";
}

async function lookupInvite(env, code, deps) {
  const fetcher = deps.fetch || fetch;
  let res = null;
  try {
    // Public lookup, no token. It never joins.
    res = await fetcher("https://discord.com/api/v10/invites/" + encodeURIComponent(code) + "?with_counts=true", { headers: { accept: "application/json" } });
  } catch (err) {
    return { error: "discord_unreachable", status: 502 };
  }
  if (res.status === 404) return { error: "invite_not_found", status: 404 };
  // Discord pacing this server's IP is not the owner's cooldown. Say so, with
  // Discord's own wait, so the app does not blame the owner.
  if (res.status === 429) {
    const wait = Math.ceil(Number((res.headers && res.headers.get && res.headers.get("retry-after")) || 0));
    return { error: "discord_busy", status: 503, retry: wait > 0 && wait < 3600 ? wait : 30 };
  }
  if (!res.ok) return { error: "discord_error", status: 502 };
  let doc = null;
  try { doc = await res.json(); }
  catch (err) { doc = null; }
  const out = cleanInvite(doc, code);
  return out ? { invite: out } : { error: "invite_not_found", status: 404 };
}

function randomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

export async function handleDiscordPickRoutes(request, env, path, deps) {
  if (!isPickPath(path)) return null;
  const { json, sessionAccount, readJson } = deps;
  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });
  if (row.owner !== 1) return json(403, { error: "owner_only" });
  if (!env.DATA) return json(503, { error: "not_configured" });
  const method = request.method.toUpperCase();
  if (path === "/v1/discord/picks/invite") {
    if (method !== "GET") return json(405, { error: "method_not_allowed" });
    const code = inviteCode(new URL(request.url).searchParams.get("code"));
    if (!code) return json(400, { error: "bad_invite" });
    if (deps.rateHit && deps.limited) {
      const gate = await deps.rateHit(env, "discord-invite:" + row.public_id, 30, 10 * 60 * 1000);
      if (gate && gate.ok === false) return deps.limited(gate);
    }
    const found = await lookupInvite(env, code, deps);
    if (!found.invite) return json(found.status, found.retry ? { error: found.error, retry: found.retry } : { error: found.error });
    const out = found.invite;
    const catalog = await readDoc(env, CATALOG_KEY);
    out.joined = !!(catalog && Array.isArray(catalog.servers) && catalog.servers.some((s) => s && String(s.id) === out.guild.id));
    return json(200, out);
  }
  if (path === "/v1/discord/picks/join") {
    if (method !== "POST") return json(405, { error: "method_not_allowed" });
    const body = await readJson(request, 4096);
    if (!body || body.error) return json(400, { error: (body && body.error) || "bad_json" });
    // One server per explicit, confirmed tap. Never a list.
    if (body.confirm !== true) return json(400, { error: "confirm_required" });
    const code = inviteCode(body.code);
    if (!code) return json(400, { error: "bad_invite" });
    // Check the invite first. A failed lookup must not use up the cooldown.
    const found = await lookupInvite(env, code, deps);
    let server = found.invite ? found.invite.guild : null;
    if (!server) {
      // Discord busy or unreachable: the preview the owner just confirmed
      // already named the server. The sync joins by the invite code anyway.
      const hint = String(body.guild || "");
      const soft = found.error === "discord_busy" || found.error === "discord_unreachable" || found.error === "discord_error";
      if (!soft || !SNOWFLAKE.test(hint)) return json(found.status, found.retry ? { error: found.error, retry: found.retry } : { error: found.error });
      server = { id: hint, name: clip(body.name, 80) || hint, icon: "", description: "" };
    }
    if (deps.rateHit) {
      const gates = [["discord-join:", 1, 2 * 60 * 1000], ["discord-join-day:", 10, 24 * 60 * 60 * 1000]];
      for (const [prefix, limit, windowMs] of gates) {
        const gate = await deps.rateHit(env, prefix + row.public_id, limit, windowMs);
        if (gate && gate.ok === false) {
          const retry = Math.max(1, Number(gate.retry) || 60);
          return json(429, { error: "join_cooldown", retry }, { "retry-after": String(retry), "x-limit-scope": "action" });
        }
      }
    }
    const id = randomId();
    const at = new Date().toISOString();
    const guild = server.id;
    await writeDoc(env, REQUEST_KEY, { requestedAt: at, guild, join: { code, id, guild } });
    return json(202, { id, guild: server, requestedAt: at });
  }
  if (path === "/v1/discord/picks/refresh") {
    if (method !== "POST") return json(405, { error: "method_not_allowed" });
    const body = await readJson(request, 4096);
    const guild = body && SNOWFLAKE.test(String(body.guild || "")) ? String(body.guild) : "";
    const at = new Date().toISOString();
    const prev = await readDoc(env, REQUEST_KEY);
    const next = guild ? { requestedAt: at, guild } : { requestedAt: at };
    if (prev && prev.join && typeof prev.join === "object") next.join = prev.join;
    await writeDoc(env, REQUEST_KEY, next);
    return json(200, { requestedAt: at });
  }
  if (method === "GET") {
    const [catalog, picks, req, joined, health] = await Promise.all([readDoc(env, CATALOG_KEY), readDoc(env, PICKS_KEY), readDoc(env, REQUEST_KEY), readDoc(env, JOIN_KEY), readDoc(env, HEALTH_KEY)]);
    const pending = req && req.join && typeof req.join === "object" ? req.join : null;
    return json(200, {
      catalog: catalog ? cleanCatalog(catalog) : null,
      picks: { servers: ((picks && picks.servers) || []), updatedAt: clip(picks && picks.updatedAt, 40) },
      requestedAt: clip(req && req.requestedAt, 40),
      join: pending ? {
        id: clip(pending.id, 32),
        guild: SNOWFLAKE.test(String(pending.guild || "")) ? String(pending.guild) : "",
        status: joined && joined.id === pending.id ? clip(joined.status, 20) : "pending",
        at: joined && joined.id === pending.id ? clip(joined.at, 40) : ""
      } : null,
      health: cleanHealth(health),
      limits: { servers: MAX_SERVERS, channels: MAX_CHANNELS }
    });
  }
  if (method === "PUT" || method === "POST") {
    const body = await readJson(request, 64 * 1024);
    if (!body || body.error) return json(400, { error: (body && body.error) || "bad_json" });
    const catalog = await readDoc(env, CATALOG_KEY);
    if (!catalog) return json(409, { error: "no_catalog" });
    const next = cleanPicks(body, cleanCatalog(catalog));
    const prev = await readDoc(env, PICKS_KEY);
    next.updatedAt = new Date().toISOString();
    await writeDoc(env, PICKS_KEY, next);
    await dropRemoved(env, prev, next);
    return json(200, { picks: next, changed: !sameIds(prev, next) });
  }
  return json(405, { error: "method_not_allowed" });
}
