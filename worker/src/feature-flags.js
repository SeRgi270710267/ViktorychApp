/* Owner-only kill switches. A feature that is off answers its endpoints with
   a fast empty response, skips its cron work, and is not loaded by clients.
   The flags live in D1; each isolate keeps them for 30 seconds so the check
   costs nothing on most requests. */

export const FEATURES = {
  shorts: { paths: ["/v1/owner/tiktok", "/v1/owner/live", "/v1/owner/live-resume"] },
  stories: { paths: ["/v1/stories", "/v1/story-bar"] },
  lives: { paths: ["/v1/live"] },
  telegram: { paths: ["/tg"] },
  pills: { paths: ["/v1/pills"] },
  // Off until the owner turns it on: NIP-05 names and post links to Nostr events.
  nostr: { paths: ["/v1/nostr", "/.well-known/nostr.json"], defaultOff: true },
  // Off until the owner turns it on and sets NFT_CONTRACT: optional gift NFTs.
  nft: { paths: ["/v1/nft"], defaultOff: true }
};
export const FEATURE_NAMES = Object.keys(FEATURES);

function defaults() {
  const off = {};
  FEATURE_NAMES.forEach((name) => { if (FEATURES[name].defaultOff) off[name] = true; });
  return off;
}

const MEMO_MS = 30 * 1000;
let memo = null;
let memoAt = 0;
let schema = null;

function ensureFlagSchema(env) {
  if (!schema) {
    schema = env.DB.prepare("CREATE TABLE IF NOT EXISTS feature_flags (name TEXT PRIMARY KEY, off INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)").run()
      .catch((err) => { schema = null; throw err; });
  }
  return schema;
}

export function forgetFlags() {
  memo = null;
  memoAt = 0;
}

export async function readFlags(env, now) {
  const at = Number(now) || Date.now();
  if (memo && at - memoAt < MEMO_MS) return memo;
  const off = defaults();
  if (env && env.DB) {
    try {
      await ensureFlagSchema(env);
      const rows = await env.DB.prepare("SELECT name, off FROM feature_flags").all();
      for (const row of (rows && rows.results) || []) {
        if (!FEATURES[row.name]) continue;
        if (Number(row.off) === 1) off[row.name] = true;
        else delete off[row.name];
      }
    } catch (err) {
      // An unreadable flag table never turns a feature off (or a default-off one on).
      return memo || defaults();
    }
  }
  memo = off;
  memoAt = at;
  return off;
}

export function featureFor(path) {
  const text = String(path || "");
  for (const name of FEATURE_NAMES) {
    for (const prefix of FEATURES[name].paths) {
      if (text === prefix || text.startsWith(prefix + "/")) return name;
    }
  }
  return "";
}

export function offResponse(request) {
  const headers = { "cache-control": "public, max-age=60", "x-feature-off": "1" };
  // Reads get an empty 204 so polling clients stop cheaply; writes get 404.
  const read = request.method === "GET" || request.method === "HEAD";
  return new Response(null, { status: read ? 204 : 404, headers });
}

/* Returns a response when the path belongs to a feature that is off. */
export async function killedRoute(env, request, path) {
  const name = featureFor(path);
  if (!name) return null;
  const off = await readFlags(env);
  return off[name] ? offResponse(request) : null;
}

export function offList(off) {
  return FEATURE_NAMES.filter((name) => off && off[name]);
}

export async function handleFeatures(request, env, deps) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/v1/features" && request.method === "GET") {
    const off = await readFlags(env);
    return deps.json(200, { off: offList(off), features: FEATURE_NAMES }, { "cache-control": "public, max-age=60" });
  }
  if (path === "/v1/owner/features") {
    const gate = await deps.requireOwner(request, env);
    if (gate.error) return gate.error;
    if (request.method === "GET") {
      forgetFlags();
      const off = await readFlags(env);
      return deps.json(200, { off: offList(off), features: FEATURE_NAMES });
    }
    if (request.method === "POST") {
      let body = null;
      try { body = await request.json(); } catch (err) { body = null; }
      const name = body && String(body.name || "");
      if (!FEATURES[name] || typeof body.off !== "boolean") return deps.json(400, { error: "feature" });
      await ensureFlagSchema(env);
      await env.DB.prepare("INSERT INTO feature_flags (name, off, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET off = excluded.off, updated_at = excluded.updated_at")
        .bind(name, body.off ? 1 : 0, Date.now()).run();
      forgetFlags();
      const off = await readFlags(env);
      return deps.json(200, { off: offList(off), features: FEATURE_NAMES });
    }
    return deps.json(405, { error: "method" });
  }
  return null;
}
