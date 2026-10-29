/* Emoji reactions on any post in the feeds, app posts and mirrored ones alike.
   The page sends a post key, a hash of the source and the post id, so the
   database never holds the original post id. One reaction per account per
   post; sending an empty emoji removes it. */

export const REACTION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS post_reactions (
    post_key TEXT NOT NULL,
    public_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_key, public_id)
  )`,
  "CREATE INDEX IF NOT EXISTS post_reactions_key_emoji ON post_reactions(post_key, emoji)",
  "CREATE INDEX IF NOT EXISTS post_reactions_account ON post_reactions(public_id)"
];

export const BATCH_MAX = 50;
const WHO_PAGE = 50;
const READ_LIMIT = 120;
const WRITE_LIMIT = 60;
const WINDOW_MS = 10 * 60 * 1000;

let EMOJI_RE = null;
try { EMOJI_RE = new RegExp("^\\p{RGI_Emoji}$", "v"); } catch (err) { EMOJI_RE = null; }
const FALLBACK_RE = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;

/* True for exactly one real emoji: one grapheme from the Unicode RGI set. */
export function validEmoji(value) {
  if (typeof value !== "string" || !value || value.length > 32) return false;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const parts = Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value));
    if (parts.length !== 1) return false;
  }
  return EMOJI_RE ? EMOJI_RE.test(value) : FALLBACK_RE.test(value);
}

export function validKey(value) {
  const text = String(value || "");
  return /^[a-f0-9]{32}$/.test(text) ? text : "";
}

/* Totals, the top three emoji and the viewer's own pick for each key. Pure. */
export function summarize(keys, counts, mine) {
  const out = {};
  keys.forEach((key) => { out[key] = { t: 0, top: [], me: "" }; });
  const per = {};
  (counts || []).forEach((row) => {
    const key = String(row.post_key);
    if (!out[key]) return;
    const n = Number(row.n) || 0;
    out[key].t += n;
    (per[key] = per[key] || []).push([String(row.emoji), n]);
  });
  Object.keys(per).forEach((key) => {
    per[key].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    out[key].top = per[key].slice(0, 3);
  });
  (mine || []).forEach((row) => {
    const key = String(row.post_key);
    if (out[key]) out[key].me = String(row.emoji);
  });
  return out;
}

function rows(result) {
  return (result && result.results) || [];
}

async function summaries(env, keys, viewerId) {
  if (!keys.length) return {};
  const marks = keys.map(() => "?").join(",");
  let counts = [];
  let mine = [];
  try {
    counts = rows(await env.DB.prepare("SELECT post_key, emoji, COUNT(*) AS n FROM post_reactions WHERE post_key IN (" + marks + ") GROUP BY post_key, emoji").bind(...keys).all());
    if (viewerId) mine = rows(await env.DB.prepare("SELECT post_key, emoji FROM post_reactions WHERE public_id = ? AND post_key IN (" + marks + ")").bind(viewerId, ...keys).all());
  } catch (err) { /* no table yet: nothing reacted */ }
  return summarize(keys, counts, mine);
}

function clientBucket(request, viewer, deps) {
  if (viewer) return viewer.public_id;
  const ip = deps.clientIp ? deps.clientIp(request) : (request.headers.get("CF-Connecting-IP") || "");
  return "ip:" + ip;
}

async function batch(request, env, viewer, deps) {
  const body = await deps.readJson(request, 4000);
  const list = Array.isArray(body && body.keys) ? body.keys : [];
  const keys = Array.from(new Set(list.map(validKey).filter(Boolean))).slice(0, BATCH_MAX);
  if (!keys.length) return deps.json(200, { r: {} }, { "cache-control": "private, no-store" });
  const paced = await deps.rateHit(env, "rx-read:" + clientBucket(request, viewer, deps), READ_LIMIT, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  return deps.json(200, { r: await summaries(env, keys, viewer && viewer.public_id) }, { "cache-control": "private, no-store" });
}

async function react(request, env, viewer, deps) {
  if (!viewer) return deps.json(401, { error: "auth_required" });
  const body = await deps.readJson(request, 1000);
  const key = validKey(body && body.key);
  if (!key) return deps.json(400, { error: "bad_key" });
  const emoji = String((body && body.emoji) || "");
  const removing = request.method === "DELETE" || emoji === "";
  if (!removing && !validEmoji(emoji)) return deps.json(400, { error: "bad_emoji" });
  const paced = await deps.rateHit(env, "rx-write:" + viewer.public_id, WRITE_LIMIT, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  if (removing) {
    await env.DB.prepare("DELETE FROM post_reactions WHERE post_key = ? AND public_id = ?").bind(key, viewer.public_id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO post_reactions (post_key, public_id, emoji, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(post_key, public_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at"
    ).bind(key, viewer.public_id, emoji, Date.now()).run();
  }
  const got = await summaries(env, [key], viewer.public_id);
  return deps.json(200, { key: key, summary: got[key] }, { "cache-control": "private, no-store" });
}

/* Who reacted with what: per-emoji tab counts and one page of people. */
async function who(request, env, viewer, deps, url) {
  const key = validKey(url.searchParams.get("key"));
  if (!key) return deps.json(400, { error: "bad_key" });
  const emoji = String(url.searchParams.get("emoji") || "");
  if (emoji && !validEmoji(emoji)) return deps.json(400, { error: "bad_emoji" });
  const lite = url.searchParams.get("lite") === "1";
  const before = Math.max(0, Number(url.searchParams.get("before")) || 0);
  const paced = await deps.rateHit(env, "rx-who:" + clientBucket(request, viewer, deps), 60, WINDOW_MS);
  if (!paced.ok) return deps.limited(paced);
  let tabs = [];
  let people = [];
  try {
    tabs = rows(await env.DB.prepare("SELECT emoji, COUNT(*) AS n FROM post_reactions WHERE post_key = ? GROUP BY emoji ORDER BY n DESC").bind(key).all())
      .map((row) => [String(row.emoji), Number(row.n) || 0]);
    const args = [key];
    let sql = "SELECT r.emoji, r.created_at, a.public_id, a.handle, a.display_name, a.avatar, a.hide_avatar, a.profile_less FROM post_reactions r JOIN accounts a ON a.public_id = r.public_id WHERE r.post_key = ?";
    if (emoji) { sql += " AND r.emoji = ?"; args.push(emoji); }
    if (before) { sql += " AND r.created_at < ?"; args.push(before); }
    sql += " ORDER BY r.created_at DESC LIMIT " + (WHO_PAGE + 1);
    people = rows(await env.DB.prepare(sql).bind(...args).all());
  } catch (err) { /* no table yet */ }
  const more = people.length > WHO_PAGE;
  const page = people.slice(0, WHO_PAGE);
  const me = viewer && viewer.public_id;
  const list = page.map((row) => {
    const hidden = Number(row.profile_less) === 1 && row.public_id !== me;
    return {
      emoji: String(row.emoji),
      at: Number(row.created_at) || 0,
      me: row.public_id === me,
      handle: hidden ? "" : String(row.handle || ""),
      name: hidden ? "" : String(row.display_name || row.handle || ""),
      avatar: hidden || lite || Number(row.hide_avatar) === 1 ? "" : String(row.avatar || "")
    };
  });
  return deps.json(200, {
    key: key,
    total: tabs.reduce((sum, tab) => sum + tab[1], 0),
    tabs: tabs,
    people: list,
    next: more && page.length ? page[page.length - 1].created_at : 0
  }, { "cache-control": "private, no-store" });
}

export async function handleReactions(request, env, path, url, deps) {
  if (!path.startsWith("/v1/reactions")) return null;
  const viewer = await deps.sessionAccount(env, request);
  if (path === "/v1/reactions/batch" && request.method === "POST") return batch(request, env, viewer, deps);
  if (path === "/v1/reactions" && (request.method === "PUT" || request.method === "DELETE")) return react(request, env, viewer, deps);
  if (path === "/v1/reactions/who" && request.method === "GET") return who(request, env, viewer, deps, url);
  return deps.json(404, { error: "not_found" });
}
