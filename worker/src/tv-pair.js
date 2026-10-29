/* Sign a TV in with a phone. The TV asks for a short code, shows it with a
   QR, and checks back every few seconds. A signed-in phone approves the
   code. The TV's next check gets a fresh session of its own; the record is
   then deleted, so each code works once. Codes last ten minutes.
   Neither the code nor the TV's check-back secret is written to logs, and
   the table keeps only a hash of the secret. No session token is stored.

   "Sign in with an account on another device": the TV sends a username;
   that account's signed-in devices get an "Approve sign-in on TV?"
   notification with Approve and Deny. The answer never says whether the
   name exists: the lookup and the notification run after the response,
   and the reply is the same either way. Limits: per TV code, per
   username and per address. The ask dies with the code. */

export const TV_PAIR_TTL_MS = 10 * 60 * 1000;
export const TV_PAIR_POLL_S = 4;
// No 0/O, 1/I/L: the code is read off a TV across the room.
export const TV_PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const WINDOW_MS = 10 * 60 * 1000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS tv_pairs (code TEXT PRIMARY KEY, poll_hash TEXT NOT NULL UNIQUE, public_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS tv_pairs_expires ON tv_pairs(expires_at)",
  "CREATE TABLE IF NOT EXISTS tv_pair_asks (code TEXT PRIMARY KEY, public_id TEXT NOT NULL, denied INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS tv_pair_asks_expires ON tv_pair_asks(expires_at)"
];
export const TV_ASK_PER_CODE = 3;
export const TV_ASK_PER_NAME = 3;
export const TV_ASK_PER_IP = 10;
let ready = null;
function ensureSchema(env) {
  if (!ready) ready = env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => { ready = null; throw err; });
  return ready;
}

export function cleanCode(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (text.length !== 6) return "";
  for (let i = 0; i < text.length; i++) if (TV_PAIR_ALPHABET.indexOf(text[i]) < 0) return "";
  return text;
}

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  // 256 % 31 leaves a small bias; rejecting the top values removes it.
  for (let i = 0; i < 6; i++) {
    let b = bytes[i];
    while (b >= 248) b = crypto.getRandomValues(new Uint8Array(1))[0];
    out += TV_PAIR_ALPHABET[b % TV_PAIR_ALPHABET.length];
  }
  return out;
}

function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return "tvp1." + btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readBody(request) {
  try { return await request.json(); } catch (err) { return null; }
}

async function start(request, env, deps) {
  const paced = await deps.rateHit(env, "tvpair-start:" + deps.clientIp(request), 20, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  const now = Date.now();
  await env.DB.prepare("DELETE FROM tv_pairs WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("DELETE FROM tv_pair_asks WHERE expires_at <= ?").bind(now).run();
  const secret = newSecret();
  const pollHash = await deps.sha256Hex(secret);
  for (let tries = 0; tries < 5; tries++) {
    const code = newCode();
    try {
      await env.DB.prepare("INSERT INTO tv_pairs (code, poll_hash, public_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)").bind(code, pollHash, now, now + TV_PAIR_TTL_MS).run();
      return deps.json(200, { code, poll: secret, expiresIn: Math.round(TV_PAIR_TTL_MS / 1000), interval: TV_PAIR_POLL_S });
    } catch (err) { /* the code is taken; draw another */ }
  }
  return deps.json(503, { error: "busy" });
}

async function poll(request, env, deps) {
  const body = await readBody(request);
  const secret = String((body && body.poll) || "");
  if (!/^tvp1\.[A-Za-z0-9_-]{30,60}$/.test(secret)) return deps.json(400, { error: "invalid" });
  const pollHash = await deps.sha256Hex(secret);
  const paced = await deps.rateHit(env, "tvpair-poll:" + pollHash.slice(0, 24), 200, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT code, public_id, expires_at FROM tv_pairs WHERE poll_hash = ?").bind(pollHash).first();
  if (!row || Number(row.expires_at) <= now) {
    if (row) await env.DB.prepare("DELETE FROM tv_pairs WHERE poll_hash = ?").bind(pollHash).run();
    return deps.json(410, { error: "expired" });
  }
  if (!row.public_id) {
    const ask = await env.DB.prepare("SELECT denied FROM tv_pair_asks WHERE code = ?").bind(row.code).first();
    if (ask && Number(ask.denied) === 1) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM tv_pairs WHERE poll_hash = ?").bind(pollHash),
        env.DB.prepare("DELETE FROM tv_pair_asks WHERE code = ?").bind(row.code)
      ]);
      return deps.json(403, { error: "denied" });
    }
    return deps.json(200, { pending: true, interval: TV_PAIR_POLL_S });
  }
  // One use: delete first, then sign in. A second check that loses the race gets nothing.
  const gone = await env.DB.prepare("DELETE FROM tv_pairs WHERE poll_hash = ? AND public_id IS NOT NULL").bind(pollHash).run();
  if (!gone || !gone.meta || !gone.meta.changes) return deps.json(410, { error: "expired" });
  if (deps.blockDeletedLogin && await deps.blockDeletedLogin(env, row.public_id)) return deps.json(410, { error: "account_deleted" });
  const token = await deps.mintSession(env, row.public_id);
  const probe = new Request(request.url, { headers: { Authorization: "Bearer " + token } });
  const account = await deps.sessionAccount(env, probe);
  if (!account) return deps.json(410, { error: "expired" });
  return deps.json(200, { token, account: await deps.presentAccount(env, request, account, true) });
}

async function approve(request, env, deps) {
  const me = await deps.sessionAccount(env, request);
  if (!me || me.public_id === "emergency_owner") return deps.json(401, { error: "unauthorized" });
  const paced = await deps.rateHit(env, "tvpair-approve:" + me.public_id, 10, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  const body = await readBody(request);
  const code = cleanCode(body && body.code);
  if (!code) return deps.json(400, { error: "invalid_code" });
  const now = Date.now();
  const res = await env.DB.prepare("UPDATE tv_pairs SET public_id = ? WHERE code = ? AND public_id IS NULL AND expires_at > ?").bind(me.public_id, code, now).run();
  if (!res || !res.meta || !res.meta.changes) return deps.json(404, { error: "invalid_code" });
  return deps.json(200, { ok: true });
}

/* A username key for the limit. Case and a leading @ do not matter. */
export function askName(value) {
  const text = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9_.]{1,30}$/.test(text)) return "";
  return text;
}

async function sendAsk(env, deps, code, expiresAt, name) {
  const publicId = await deps.findAccount(env, name);
  if (!/^\d{12}$/.test(String(publicId || ""))) return;
  if (deps.blockDeletedLogin && await deps.blockDeletedLogin(env, publicId)) return;
  const now = Date.now();
  // One ask per code: a second name on the same TV replaces the first.
  await env.DB.prepare(
    "INSERT INTO tv_pair_asks (code, public_id, denied, created_at, expires_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT(code) DO UPDATE SET public_id = excluded.public_id, denied = 0, created_at = excluded.created_at"
  ).bind(code, publicId, now, expiresAt).run();
  await deps.notify(env, {
    publicId,
    kind: "tv_signin",
    at: now,
    idempotencyKey: "tvpair:" + code + ":" + publicId,
    text: code,
    hash: "#/link-tv?code=" + code,
    platform: "tv",
    expiresAt
  });
}

async function ask(request, env, deps) {
  const body = await readBody(request);
  const secret = String((body && body.poll) || "");
  if (!/^tvp1\.[A-Za-z0-9_-]{30,60}$/.test(secret)) return deps.json(400, { error: "invalid" });
  const name = askName(body && body.username);
  if (!name) return deps.json(400, { error: "invalid_username" });
  const pollHash = await deps.sha256Hex(secret);
  const byIp = await deps.rateHit(env, "tvpair-ask-ip:" + deps.clientIp(request), TV_ASK_PER_IP, WINDOW_MS);
  if (!byIp.ok) return deps.limited(byIp);
  const byTv = await deps.rateHit(env, "tvpair-ask-tv:" + pollHash.slice(0, 24), TV_ASK_PER_CODE, TV_PAIR_TTL_MS);
  if (!byTv.ok) return deps.limited(byTv);
  const nameKey = (await deps.sha256Hex("tvpair-ask:" + name)).slice(0, 24);
  const byName = await deps.rateHit(env, "tvpair-ask-name:" + nameKey, TV_ASK_PER_NAME, WINDOW_MS);
  if (!byName.ok) return deps.limited(byName);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT code, public_id, expires_at FROM tv_pairs WHERE poll_hash = ?").bind(pollHash).first();
  if (!row || Number(row.expires_at) <= now) return deps.json(410, { error: "expired" });
  // The same answer whether or not the name exists. The lookup and the
  // notification run after the reply, so the timing says nothing either.
  if (!row.public_id) {
    const job = sendAsk(env, deps, row.code, Number(row.expires_at), name).catch(() => {});
    if (deps.waitUntil) deps.waitUntil(job);
    else await job;
  }
  return deps.json(200, { ok: true, sent: true, expiresIn: Math.max(0, Math.round((Number(row.expires_at) - now) / 1000)) });
}

async function deny(request, env, deps) {
  const me = await deps.sessionAccount(env, request);
  if (!me || me.public_id === "emergency_owner") return deps.json(401, { error: "unauthorized" });
  const paced = await deps.rateHit(env, "tvpair-deny:" + me.public_id, 20, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  const body = await readBody(request);
  const code = cleanCode(body && body.code);
  if (!code) return deps.json(400, { error: "invalid_code" });
  // Only the account that was asked can turn the TV down.
  await env.DB.prepare("UPDATE tv_pair_asks SET denied = 1 WHERE code = ? AND public_id = ? AND expires_at > ?").bind(code, me.public_id, Date.now()).run();
  return deps.json(200, { ok: true });
}

export async function handleTvPair(request, env, deps) {
  if (!env.DB) return deps.json(503, { error: "unavailable" });
  if (request.method !== "POST") return deps.json(405, { error: "method" });
  await ensureSchema(env);
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path === "/v1/tv-pair/start") return start(request, env, deps);
  if (path === "/v1/tv-pair/poll") return poll(request, env, deps);
  if (path === "/v1/tv-pair/approve") return approve(request, env, deps);
  if (path === "/v1/tv-pair/ask") return ask(request, env, deps);
  if (path === "/v1/tv-pair/deny") return deny(request, env, deps);
  return deps.json(404, { error: "not_found" });
}
