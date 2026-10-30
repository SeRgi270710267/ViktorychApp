/* Cast to the ViktorychTV app with our own pairing: no Chromecast, no
   extra host. A TV that was linked with a "Link a TV" code has its own
   session for the account. While its Cast screen is open, it asks for the
   next item every few seconds; a signed-in phone of the same account sends
   a link. Each item is handed out once and lasts two minutes, so nothing
   piles up for a TV that is off. Only https links are kept, at most a few
   per account. The TV decides what to do with a link (our site, YouTube,
   X, Twitch or a media file) and refuses anything else. */

export const TV_CAST_TTL_MS = 2 * 60 * 1000;
export const TV_CAST_MAX_PENDING = 5;
export const TV_CAST_POLL_S = 4;
export const TV_CAST_SEEN_MS = 60 * 1000;
export const TV_CAST_SEND_LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS tv_casts (id TEXT PRIMARY KEY, public_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS tv_casts_owner ON tv_casts(public_id, created_at)",
  "CREATE INDEX IF NOT EXISTS tv_casts_expires ON tv_casts(expires_at)",
  "CREATE TABLE IF NOT EXISTS tv_cast_seen (public_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)"
];
let ready = null;
function ensureSchema(env) {
  if (!ready) ready = env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => { ready = null; throw err; });
  return ready;
}

/* An https link of at most 2000 characters with no user name or password
   in it, or "" when it isn't one. */
export function castUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 2000 || /[\s<>"\\^`{|}\u0000-\u001f\u007f]/.test(text)) return "";
  let u;
  try { u = new URL(text); } catch (err) { return ""; }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname || u.hostname.indexOf(".") < 0) return "";
  return u.href.length > 2000 ? "" : u.href;
}

/* A plain one-line title, at most 120 characters. */
export function castTitle(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function readBody(request) {
  try { return await request.json(); } catch (err) { return null; }
}

async function me(request, env, deps) {
  const account = await deps.sessionAccount(env, request);
  if (!account || account.public_id === "emergency_owner") return null;
  return account;
}

async function send(request, env, deps) {
  const account = await me(request, env, deps);
  if (!account) return deps.json(401, { error: "unauthorized" });
  const paced = await deps.rateHit(env, "tvcast-send:" + account.public_id, TV_CAST_SEND_LIMIT, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  const body = await readBody(request);
  const url = castUrl(body && body.url);
  if (!url) return deps.json(400, { error: "invalid_url" });
  const title = castTitle(body && body.title);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM tv_casts WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO tv_casts (id, public_id, url, title, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(newId(), account.public_id, url, title, now, now + TV_CAST_TTL_MS).run();
  // Keep only the newest few for this account.
  await env.DB.prepare("DELETE FROM tv_casts WHERE public_id = ? AND id NOT IN (SELECT id FROM tv_casts WHERE public_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)")
    .bind(account.public_id, account.public_id, TV_CAST_MAX_PENDING).run();
  const seen = await env.DB.prepare("SELECT seen_at FROM tv_cast_seen WHERE public_id = ?").bind(account.public_id).first();
  const listening = !!(seen && now - Number(seen.seen_at) <= TV_CAST_SEEN_MS + TV_CAST_POLL_S * 1000);
  return deps.json(200, { ok: true, listening, expiresIn: Math.round(TV_CAST_TTL_MS / 1000) });
}

async function next(request, env, deps) {
  const account = await me(request, env, deps);
  if (!account) return deps.json(401, { error: "unauthorized" });
  const now = Date.now();
  // "A TV is listening" for the phone: written at most once a minute.
  await env.DB.prepare("INSERT INTO tv_cast_seen (public_id, seen_at) VALUES (?, ?) ON CONFLICT(public_id) DO UPDATE SET seen_at = excluded.seen_at WHERE tv_cast_seen.seen_at <= ?")
    .bind(account.public_id, now, now - TV_CAST_SEEN_MS).run();
  const row = await env.DB.prepare("SELECT id, url, title, created_at FROM tv_casts WHERE public_id = ? AND expires_at > ? ORDER BY created_at ASC, id ASC LIMIT 1")
    .bind(account.public_id, now).first();
  if (!row) return deps.json(200, { item: null, interval: TV_CAST_POLL_S });
  // One use: only the check that deletes the row gets the item.
  const gone = await env.DB.prepare("DELETE FROM tv_casts WHERE id = ? AND public_id = ?").bind(row.id, account.public_id).run();
  if (!gone || !gone.meta || !gone.meta.changes) return deps.json(200, { item: null, interval: TV_CAST_POLL_S });
  return deps.json(200, { item: { url: row.url, title: row.title || "", at: Number(row.created_at) }, interval: TV_CAST_POLL_S });
}

/* The TV's Cast screen closes: the phone stops saying a TV is listening. */
async function stop(request, env, deps) {
  const account = await me(request, env, deps);
  if (!account) return deps.json(401, { error: "unauthorized" });
  await env.DB.prepare("DELETE FROM tv_cast_seen WHERE public_id = ?").bind(account.public_id).run();
  return deps.json(200, { ok: true });
}

export async function handleTvCast(request, env, deps) {
  if (!env.DB) return deps.json(503, { error: "unavailable" });
  if (request.method !== "POST") return deps.json(405, { error: "method" });
  await ensureSchema(env);
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path === "/v1/tv-cast/send") return send(request, env, deps);
  if (path === "/v1/tv-cast/next") return next(request, env, deps);
  if (path === "/v1/tv-cast/stop") return stop(request, env, deps);
  return deps.json(404, { error: "not_found" });
}
