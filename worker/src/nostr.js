/* Nostr links for posts. When someone has opted in on their device, their
   public posts are signed there and sent to their relays; the device then
   tells the server which Nostr event mirrors which post, so every viewer can
   find Nostr replies under the post. The server only stores the event id and
   public key. Keys, signing and relay traffic never touch the server. The
   whole route sits behind the owner's "nostr" switch, which is off until the
   owner turns it on. */

export const NOSTR_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS post_nostr (post_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, event_id TEXT NOT NULL, pubkey TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS post_nostr_author ON post_nostr(author_id)"
];

const HEX64 = /^[0-9a-f]{64}$/;
let ready = null;

function ensureSchema(env) {
  if (!ready) {
    ready = (async () => { for (const sql of NOSTR_SCHEMA) await env.DB.prepare(sql).run(); })()
      .catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function publicPost(env, id) {
  const row = await env.DB.prepare("SELECT id, author_id, audience, hidden, scheduled_at FROM public_posts WHERE id = ?").bind(id).first();
  if (!row || Number(row.hidden) !== 0 || (row.audience || "everyone") !== "everyone") return null;
  if (Number(row.scheduled_at) > Date.now()) return null;
  return row;
}

export async function handleNostr(request, env, path, deps) {
  const match = path.match(/^\/v1\/nostr\/posts\/([a-f0-9]{32})$/);
  if (!match) return null;
  const id = match[1];
  await ensureSchema(env);
  if (request.method === "GET") {
    const post = await publicPost(env, id);
    const row = post ? await env.DB.prepare("SELECT event_id, pubkey FROM post_nostr WHERE post_id = ?").bind(id).first() : null;
    if (!row) return deps.json(404, { error: "not_found" }, { "cache-control": "public, max-age=60" });
    return deps.json(200, { event_id: row.event_id, pubkey: row.pubkey }, { "cache-control": "public, max-age=60" });
  }
  if (request.method !== "POST" && request.method !== "DELETE") return deps.json(405, { error: "method" });
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const paced = await deps.rateHit(env, "nostr:" + session.public_id, 60, 10 * 60 * 1000);
  if (!paced.ok) return deps.limited(paced);
  const post = await env.DB.prepare("SELECT id, author_id FROM public_posts WHERE id = ?").bind(id).first();
  if (!post || post.author_id !== session.public_id) return deps.json(404, { error: "not_found" });
  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM post_nostr WHERE post_id = ?").bind(id).run();
    return deps.json(200, { ok: true });
  }
  const body = await deps.readJson(request, 2000);
  if (body.error) return deps.json(400, { error: body.error });
  const eventId = String(body.event_id || "");
  const pubkey = String(body.pubkey || "");
  if (!HEX64.test(eventId) || !HEX64.test(pubkey)) return deps.json(400, { error: "bad_event" });
  if (!(await publicPost(env, id))) return deps.json(409, { error: "not_public" });
  await env.DB.prepare("INSERT INTO post_nostr (post_id, author_id, event_id, pubkey, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET event_id = excluded.event_id, pubkey = excluded.pubkey, created_at = excluded.created_at")
    .bind(id, session.public_id, eventId, pubkey, Date.now()).run();
  return deps.json(200, { ok: true, event_id: eventId, pubkey: pubkey });
}
