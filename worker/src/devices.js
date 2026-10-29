/* "My devices". Every session of an account is one device. Devices say
   hello at most once an hour with a name and type; the list shows each
   one with its last-seen time. Rename changes the label; remove deletes
   that session so the device is signed out on its next request.
   Each device also gets a data key that only the server keeps. The app
   seals its private on-device copy with it, so removing the device (or
   signing out) leaves that copy unreadable, and the removed device wipes
   itself the next time it can reach the server. */

const TYPES = ["phone", "tablet", "desktop", "tv", "other"];
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS session_devices (token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS session_devices_account ON session_devices(public_id, last_seen DESC)"
  ,
  "CREATE TABLE IF NOT EXISTS device_keys (token_hash TEXT PRIMARY KEY, public_id TEXT NOT NULL, data_key TEXT NOT NULL, created_at INTEGER NOT NULL)"
];
let ready = null;

function ensureDeviceSchema(env) {
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => { ready = null; throw err; });
  }
  return ready;
}

function cleanName(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function cleanType(value) {
  const text = String(value || "").toLowerCase();
  return TYPES.indexOf(text) >= 0 ? text : "other";
}

function idOf(hash) {
  return String(hash || "").slice(0, 16);
}

async function sessionOf(env, request, deps) {
  const token = deps.bearer(request);
  if (!token || token.length > 200) return null;
  const hash = await deps.sha256Hex(token);
  const row = await env.DB.prepare("SELECT public_id FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(hash, Date.now()).first();
  return row ? { hash, publicId: row.public_id } : null;
}

function newDataKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readBody(request) {
  try { return await request.json(); } catch (err) { return null; }
}

async function findDevice(env, publicId, id) {
  const clean = String(id || "").replace(/[^a-f0-9]/g, "");
  if (clean.length !== 16) return null;
  return env.DB.prepare("SELECT token_hash FROM sessions WHERE public_id = ? AND substr(token_hash, 1, 16) = ?").bind(publicId, clean).first();
}

async function list(env, me) {
  const rows = await env.DB.prepare(
    "SELECT s.token_hash, s.created_at, d.name, d.type, d.last_seen FROM sessions s LEFT JOIN session_devices d ON d.token_hash = s.token_hash WHERE s.public_id = ? AND s.expires_at > ? ORDER BY COALESCE(d.last_seen, s.created_at) DESC LIMIT 50"
  ).bind(me.publicId, Date.now()).all();
  return ((rows && rows.results) || []).map((row) => ({
    id: idOf(row.token_hash),
    name: row.name || "",
    type: row.type || "other",
    lastSeen: Number(row.last_seen) || Number(row.created_at) || 0,
    signedInAt: Number(row.created_at) || 0,
    current: row.token_hash === me.hash
  }));
}

export async function handleDevices(request, env, deps) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const me = await sessionOf(env, request, deps);
  if (!me) return deps.json(401, { error: "unauthorized" });
  await ensureDeviceSchema(env);
  const now = Date.now();
  if (path === "/v1/devices" && request.method === "GET") {
    return deps.json(200, { devices: await list(env, me) });
  }
  if (path === "/v1/devices/hello" && request.method === "POST") {
    const body = (await readBody(request)) || {};
    const name = cleanName(body.name);
    const type = cleanType(body.type);
    // A rename from the list sticks; hello only fills an empty name.
    await env.DB.prepare(
      "INSERT INTO session_devices (token_hash, public_id, name, type, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET type = excluded.type, last_seen = excluded.last_seen, name = CASE WHEN session_devices.name = '' THEN excluded.name ELSE session_devices.name END"
    ).bind(me.hash, me.publicId, name, type, now, now).run();
    return deps.json(200, { ok: true, id: idOf(me.hash) });
  }
  if (path === "/v1/devices/key" && request.method === "GET") {
    await env.DB.prepare(
      "INSERT INTO device_keys (token_hash, public_id, data_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(token_hash) DO NOTHING"
    ).bind(me.hash, me.publicId, newDataKey(), now).run();
    const row = await env.DB.prepare("SELECT data_key FROM device_keys WHERE token_hash = ? AND public_id = ?").bind(me.hash, me.publicId).first();
    if (!row || !row.data_key) return deps.json(503, { error: "key" });
    return deps.json(200, { key: row.data_key, id: idOf(me.hash) });
  }
  if (path === "/v1/devices/rename" && request.method === "POST") {
    const body = (await readBody(request)) || {};
    const name = cleanName(body.name);
    const found = await findDevice(env, me.publicId, body.id);
    if (!found || !name) return deps.json(found ? 400 : 404, { error: found ? "name" : "not_found" });
    await env.DB.prepare(
      "INSERT INTO session_devices (token_hash, public_id, name, type, created_at, last_seen) VALUES (?, ?, ?, 'other', ?, 0) ON CONFLICT(token_hash) DO UPDATE SET name = excluded.name"
    ).bind(found.token_hash, me.publicId, name, now).run();
    return deps.json(200, { devices: await list(env, me) });
  }
  if (path === "/v1/devices/remove" && request.method === "POST") {
    const body = (await readBody(request)) || {};
    const found = await findDevice(env, me.publicId, body.id);
    if (!found) return deps.json(404, { error: "not_found" });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE token_hash = ? AND public_id = ?").bind(found.token_hash, me.publicId),
      env.DB.prepare("DELETE FROM session_devices WHERE token_hash = ?").bind(found.token_hash),
      env.DB.prepare("DELETE FROM device_keys WHERE token_hash = ?").bind(found.token_hash)
    ]);
    return deps.json(200, { devices: found.token_hash === me.hash ? [] : await list(env, me), signedOut: found.token_hash === me.hash });
  }
  return deps.json(404, { error: "not_found" });
}
