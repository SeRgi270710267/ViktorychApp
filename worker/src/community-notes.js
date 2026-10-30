/* Community Notes, built like X's, with the owner having the final say.

   Who: signed-in, non-temporary accounts old enough and without recent
   upheld reports can join under a random pseudonym. New contributors rate
   first; writing unlocks once their rating impact reaches WRITE_IMPACT.

   Where data lives: notes, ratings and every owner action stay in D1. The
   scheduled run scores notes with the bridging model (cn-scorer.js), then
   publishes only what is shown into 16 small shards in R2
   (cnotes/pub/<0-f>.json: post ref -> [[sha256, size, src, status]]) and one
   immutable, content-addressed blob per note (cnotes/n/<sha256>.json).
   Devices fetch only the shards for posts they see and only the blobs they
   need, cache them, and pass the blobs over P2P. Clients never download raw
   ratings. X's own Community Notes are mirrored daily by the Actions sync
   into cnotes/x/<s>.json and merged into the same shards here.

   The owner's overrides (show, hide, lock, edit, delete, ban, no notes on a
   post) always win over the algorithm and are written to cn_audit. No public
   marker is shown on overridden notes. */

import { LEVELS, THRESHOLDS, scoreNotes, ratingImpact, brigadeWeights, effectiveStatus } from "./cn-scorer.js";

export const CN_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS cn_contributors (public_id TEXT PRIMARY KEY, alias TEXT NOT NULL UNIQUE, joined_at INTEGER NOT NULL, can_write INTEGER NOT NULL DEFAULT 0, rating_impact INTEGER NOT NULL DEFAULT 0, writing_impact INTEGER NOT NULL DEFAULT 0, factor REAL NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0, left_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS cn_notes (id TEXT PRIMARY KEY, post_ref TEXT NOT NULL, app_post_id TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL, classification TEXT NOT NULL, reasons TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', media_note INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, algo_status TEXT NOT NULL DEFAULT 'nmr', intercept REAL NOT NULL DEFAULT 0, factor REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'nmr', status_at INTEGER NOT NULL DEFAULT 0, shown_at INTEGER NOT NULL DEFAULT 0, override TEXT NOT NULL DEFAULT '', locked INTEGER NOT NULL DEFAULT 0, locked_status TEXT NOT NULL DEFAULT '', edited_by_owner INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS cn_notes_ref ON cn_notes(post_ref)",
  "CREATE INDEX IF NOT EXISTS cn_notes_author ON cn_notes(author_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS cn_notes_status ON cn_notes(status, updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS cn_ratings (note_id TEXT NOT NULL, rater_id TEXT NOT NULL, level REAL NOT NULL, tags TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (note_id, rater_id))",
  "CREATE INDEX IF NOT EXISTS cn_ratings_rater ON cn_ratings(rater_id)",
  "CREATE TABLE IF NOT EXISTS cn_requests (post_ref TEXT NOT NULL, public_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_ref, public_id))",
  "CREATE TABLE IF NOT EXISTS cn_post_rules (post_ref TEXT PRIMARY KEY, no_notes INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS cn_x_overrides (x_note_id TEXT PRIMARY KEY, override TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS cn_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS cn_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
];

export const TEXT_MAX = 280;
export const SHARDS = 16;
export const MISLEADING_REASONS = ["factual_error", "manipulated_media", "outdated", "missing_context", "unverified_claim", "satire", "other"];
export const NOT_MISLEADING_REASONS = ["factually_correct", "outdated_but_not_when_written", "clearly_satire", "personal_opinion", "other"];
export const HELPFUL_TAGS = ["clear", "good_sources", "addresses_claim", "important_context", "unbiased_language", "other"];
export const NOT_HELPFUL_TAGS = ["incorrect", "sources_missing", "missing_key_points", "hard_to_understand", "argumentative", "spam_harassment", "irrelevant_sources", "opinion_speculation", "note_not_needed", "other"];
const DAY = 86400000;
const WRITE_LIMIT_DAY = 10;
const RATE_LIMIT_HOUR = 120;
const REQUEST_LIMIT_HOUR = 30;
const NOTIFY_CAP = 200;
const X_SHARD = "cnotes/x/";
const PUB_SHARD = "cnotes/pub/";
const BLOB = "cnotes/n/";

let ready = null;
export function ensureCnSchema(env) {
  if (!ready) ready = env.DB.batch(CN_SCHEMA.map((sql) => env.DB.prepare(sql))).catch((err) => { ready = null; throw err; });
  return ready;
}

export function minAgeDays(env) {
  const n = Number(env && env.CN_MIN_AGE_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}
export function writeImpact(env) {
  const n = Number(env && env.CN_WRITE_IMPACT);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

export function cleanRef(value) {
  const text = String(value || "");
  return /^[a-z]{1,12}:[A-Za-z0-9._:-]{1,100}$/.test(text) ? text : "";
}

/* FNV-1a, the same in community-notes.js on the page and in the Python mirror. */
export function shardOf(ref) {
  let h = 2166136261;
  const s = String(ref);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 0xff; h = Math.imul(h, 16777619) >>> 0; }
  return (h % SHARDS).toString(16);
}

const URL_RE = /https?:\/\/[^\s<>"]+/gi;
/* X counts a link as one character toward the note limit. */
export function noteLength(text) {
  return Array.from(String(text || "").replace(URL_RE, "x")).length;
}
export function sourcesOf(text) {
  const out = [];
  (String(text || "").match(URL_RE) || []).forEach((u) => {
    const clean = u.replace(/[).,;!?]+$/, "");
    try { const p = new URL(clean); if ((p.protocol === "https:" || p.protocol === "http:") && out.indexOf(p.href) < 0) out.push(p.href); } catch (err) { /* not a link */ }
  });
  return out.slice(0, 10);
}

export function cleanNoteInput(body) {
  if (!body || typeof body !== "object") return { error: "bad_note" };
  const ref = cleanRef(body.ref);
  if (!ref) return { error: "bad_ref" };
  const cls = body.classification === "misleading" ? "misleading" : body.classification === "not_misleading" ? "not_misleading" : "";
  if (!cls) return { error: "bad_classification" };
  const allowed = cls === "misleading" ? MISLEADING_REASONS : NOT_MISLEADING_REASONS;
  const reasons = Array.from(new Set((Array.isArray(body.reasons) ? body.reasons : []).map(String).filter((r) => allowed.indexOf(r) >= 0)));
  if (!reasons.length) return { error: "reasons_required" };
  const text = String(body.text || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!text) return { error: "text_required" };
  if (noteLength(text) > TEXT_MAX) return { error: "too_long" };
  const sources = sourcesOf(text);
  if (!sources.length) return { error: "source_required" };
  const appPost = /^[a-f0-9]{32}$/.test(String(body.appPost || "")) ? String(body.appPost) : "";
  return { ref, cls, reasons, text, sources, media: body.media === true, appPost };
}

export function cleanRating(body) {
  const level = body && Object.prototype.hasOwnProperty.call(LEVELS, body.level) ? body.level : "";
  if (!level) return { error: "bad_level" };
  const allowed = level === "not" ? NOT_HELPFUL_TAGS : level === "helpful" ? HELPFUL_TAGS : HELPFUL_TAGS.concat(NOT_HELPFUL_TAGS);
  const tags = Array.from(new Set((Array.isArray(body.tags) ? body.tags : []).map(String).filter((t) => allowed.indexOf(t) >= 0))).slice(0, 12);
  return { level, value: LEVELS[level], tags };
}

const ADJ = ["Amber", "Bold", "Brisk", "Calm", "Clever", "Cosmic", "Crisp", "Gentle", "Golden", "Lively", "Lucid", "Mellow", "Nimble", "Quiet", "Radiant", "Rapid", "Serene", "Silver", "Steady", "Sunny", "Swift", "Velvet", "Vivid", "Witty"];
const NOUN = ["Falcon", "Otter", "Maple", "Comet", "Harbor", "Meadow", "Lynx", "Willow", "Badger", "Canyon", "Heron", "Juniper", "Koala", "Lagoon", "Marten", "Nebula", "Orchid", "Pebble", "Quokka", "Raven", "Sparrow", "Tundra", "Walrus", "Zephyr"];
const NOUN2 = ["Gale", "Ridge", "Spark", "Brook", "Grove", "Peak", "Shore", "Trail", "Cove", "Drift", "Glade", "Isle"];
export function makeAlias(rand) {
  const r = rand || (() => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296);
  const pick = (list) => list[Math.floor(r() * list.length) % list.length];
  return pick(ADJ) + " " + pick(NOUN) + " " + pick(NOUN2);
}

function rows(res) { return (res && res.results) || []; }
function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}
async function getState(env, k) {
  const row = await env.DB.prepare("SELECT v FROM cn_state WHERE k = ?").bind(k).first();
  return row ? String(row.v) : "";
}
function setState(env, k, v) {
  return env.DB.prepare("INSERT INTO cn_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v)).run();
}
export function markDirty(env) { return setState(env, "dirty", "1"); }

/* Eligibility like X: account age, no recent violations, not temporary, not banned. */
export async function eligibility(env, account, now) {
  now = now || Date.now();
  const reasons = [];
  if (!account) return { eligible: false, reasons: ["sign_in"] };
  const owner = account.owner === 1;
  try {
    const temp = await env.DB.prepare("SELECT 1 AS t FROM account_temp WHERE public_id = ?").bind(account.public_id).first();
    if (temp) reasons.push("temporary");
  } catch (err) { /* no temp table yet */ }
  const ageDays = (now - (Number(account.created_at) || now)) / DAY;
  if (!owner && ageDays < minAgeDays(env)) reasons.push("too_new");
  try {
    const hit = await env.DB.prepare("SELECT COUNT(*) AS n FROM post_reports r JOIN public_posts p ON p.id = r.post_id WHERE p.author_id = ? AND r.status IN ('upheld', 'removed', 'actioned') AND r.created_at > ?").bind(account.public_id, now - 30 * DAY).first();
    if (hit && Number(hit.n) > 0) reasons.push("recent_violation");
  } catch (err) { /* no reports table yet */ }
  const c = await env.DB.prepare("SELECT banned FROM cn_contributors WHERE public_id = ?").bind(account.public_id).first();
  if (c && Number(c.banned) === 1) reasons.push("banned");
  return { eligible: reasons.length === 0, reasons, minAgeDays: minAgeDays(env), ageDays: Math.floor(ageDays) };
}

async function contributor(env, id) {
  const row = await env.DB.prepare("SELECT * FROM cn_contributors WHERE public_id = ? AND left_at = 0").bind(id).first();
  return row || null;
}
function presentContributor(env, row) {
  if (!row) return null;
  return { alias: row.alias, canWrite: Number(row.can_write) === 1, ratingImpact: Number(row.rating_impact) || 0, writingImpact: Number(row.writing_impact) || 0, needed: writeImpact(env), banned: Number(row.banned) === 1, joinedAt: Number(row.joined_at) || 0 };
}

async function audit(env, action, target, detail) {
  await env.DB.prepare("INSERT INTO cn_audit (at, action, target, detail) VALUES (?, ?, ?, ?)").bind(Date.now(), action, String(target).slice(0, 160), JSON.stringify(detail || {}).slice(0, 2000)).run();
}

function noteFlags(row, rules, banned) {
  return {
    deleted: Number(row.deleted) === 1,
    override: row.override || "",
    locked: Number(row.locked) === 1,
    lockedStatus: row.locked_status || "",
    postBlocked: !!(rules && rules[row.post_ref]),
    authorBanned: !!(banned && banned[row.author_id]),
    algoStatus: row.algo_status || "nmr"
  };
}

async function postRules(env, refs) {
  const out = {};
  const list = refs ? refs : null;
  const res = list && list.length
    ? await env.DB.prepare("SELECT post_ref FROM cn_post_rules WHERE no_notes = 1 AND post_ref IN (" + list.map(() => "?").join(",") + ")").bind(...list).all()
    : await env.DB.prepare("SELECT post_ref FROM cn_post_rules WHERE no_notes = 1").all();
  rows(res).forEach((r) => { out[r.post_ref] = true; });
  return out;
}
async function bannedSet(env) {
  const out = {};
  rows(await env.DB.prepare("SELECT public_id FROM cn_contributors WHERE banned = 1").all()).forEach((r) => { out[r.public_id] = true; });
  return out;
}

/* ---------- publishing: shards and blobs ---------- */

export function blobOf(note) {
  // Fixed key order so the same note always hashes the same.
  return JSON.stringify({ v: 1, id: note.id, src: note.src, ref: note.ref, cls: note.cls, reasons: note.reasons || [], text: note.text, sources: note.sources || [], media: !!note.media, created: Number(note.created) || 0, statusAt: Number(note.statusAt) || 0 });
}

async function readJsonKey(env, key) {
  if (!env.DATA) return null;
  try {
    const obj = await env.DATA.get(key);
    if (!obj) return null;
    return JSON.parse(await obj.text());
  } catch (err) { return null; }
}

/* Builds the shown set (own + X mirror, owner overrides applied) and writes
   only the shards and blobs that changed. */
export async function publishNotes(env, now) {
  await ensureCnSchema(env);
  now = now || Date.now();
  const shards = {};
  for (let i = 0; i < SHARDS; i++) shards[i.toString(16)] = {};
  const blobs = {};
  const add = async (note, status) => {
    const text = blobOf(note);
    const h = await sha256Hex(text);
    blobs[h] = text;
    const s = shardOf(note.ref);
    (shards[s][note.ref] = shards[s][note.ref] || []).push([h, new TextEncoder().encode(text).length, note.src, status]);
  };
  const rules = await postRules(env, null);
  const banned = await bannedSet(env);
  const own = rows(await env.DB.prepare("SELECT * FROM cn_notes WHERE deleted = 0 AND (status = 'crh' OR override = 'show')").all());
  for (const row of own) {
    const st = effectiveStatus(noteFlags(row, rules, banned));
    if (st !== "crh") continue;
    let reasons = [];
    let sources = [];
    try { sources = JSON.parse(row.sources || "[]"); } catch (err) { sources = []; }
    reasons = String(row.reasons || "").split(",").filter(Boolean);
    await add({ id: row.id, src: "own", ref: row.post_ref, cls: row.classification, reasons, text: row.body, sources, media: Number(row.media_note) === 1, created: row.created_at, statusAt: row.status_at || row.updated_at }, "crh");
  }
  const xo = {};
  rows(await env.DB.prepare("SELECT x_note_id, override FROM cn_x_overrides").all()).forEach((r) => { xo[r.x_note_id] = r.override; });
  for (let i = 0; i < SHARDS; i++) {
    const doc = await readJsonKey(env, X_SHARD + i.toString(16) + ".json");
    const list = doc && Array.isArray(doc.notes) ? doc.notes : [];
    for (const n of list) {
      const ref = cleanRef(n && n.ref);
      if (!ref || !n.id || !n.text) continue;
      if (xo[n.id] === "hide") continue;
      if (rules[ref] && xo[n.id] !== "show") continue;
      await add({ id: "x" + String(n.id).replace(/\D/g, ""), src: "x", ref, cls: n.cls === "not_misleading" ? "not_misleading" : "misleading", reasons: Array.isArray(n.reasons) ? n.reasons.slice(0, 8).map(String) : [], text: String(n.text).slice(0, 2000), sources: Array.isArray(n.sources) ? n.sources.slice(0, 10).map(String) : [], media: !!n.media, created: n.created, statusAt: n.statusAt }, "crh");
    }
  }
  let wrote = 0;
  let blobsWrote = 0;
  const prevBlobs = {};
  for (const s of Object.keys(shards)) {
    const r = shards[s];
    Object.keys(r).forEach((ref) => r[ref].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    const body = JSON.stringify({ v: 2, r: sortKeys(r) });
    const h = await sha256Hex(body);
    const prev = await getState(env, "shard:" + s);
    const prevDoc = prev ? await readJsonKey(env, PUB_SHARD + s + ".json") : null;
    if (prevDoc && prevDoc.r) Object.values(prevDoc.r).forEach((list) => (list || []).forEach((e) => { prevBlobs[e[0]] = true; }));
    if (prev === h) continue;
    if (env.DATA) await env.DATA.put(PUB_SHARD + s + ".json", body, { httpMetadata: { contentType: "application/json" } });
    await setState(env, "shard:" + s, h);
    wrote++;
  }
  for (const h of Object.keys(blobs)) {
    if (prevBlobs[h]) continue;
    if (env.DATA) {
      const head = await env.DATA.head(BLOB + h + ".json");
      if (!head) { await env.DATA.put(BLOB + h + ".json", blobs[h], { httpMetadata: { contentType: "application/json" } }); blobsWrote++; }
    }
  }
  const version = await sha256Hex(JSON.stringify(Object.keys(shards).map((s) => s)) + await Promise.all(Object.keys(shards).map((s) => getState(env, "shard:" + s))).then((l) => l.join(",")));
  await setState(env, "version", version.slice(0, 16));
  await setState(env, "published_at", now);
  return { shards: wrote, blobs: blobsWrote, shown: Object.keys(blobs).length, version: version.slice(0, 16) };
}

function sortKeys(obj) {
  const out = {};
  Object.keys(obj).sort().forEach((k) => { out[k] = obj[k]; });
  return out;
}

/* ---------- scoring (scheduled) ---------- */

export async function runCommunityNotes(env, now, emit, opts) {
  await ensureCnSchema(env);
  now = now || Date.now();
  const force = !!(opts && opts.force);
  const dirty = (await getState(env, "dirty")) === "1";
  const xManifest = await readJsonKey(env, X_SHARD + "manifest.json");
  const xHash = xManifest && xManifest.hash ? String(xManifest.hash) : "";
  const xChanged = xHash && xHash !== (await getState(env, "x_hash"));
  if (!dirty && !xChanged && !force) return { skipped: true };
  let scored = null;
  if (dirty || force) scored = await scoreAll(env, now, emit);
  await setState(env, "dirty", "0");
  const published = await publishNotes(env, now);
  if (xHash) await setState(env, "x_hash", xHash);
  return { scored, published };
}

async function scoreAll(env, now, emit) {
  const raw = rows(await env.DB.prepare(
    "SELECT r.note_id, r.rater_id, r.level, r.created_at, a.created_at AS acct_at, n.author_id FROM cn_ratings r JOIN cn_notes n ON n.id = r.note_id LEFT JOIN accounts a ON a.public_id = r.rater_id LEFT JOIN cn_contributors c ON c.public_id = r.rater_id WHERE n.deleted = 0 AND (c.banned IS NULL OR c.banned = 0) LIMIT 200000"
  ).all());
  const list = raw.filter((r) => r.rater_id !== r.author_id).map((r) => ({ rater: r.rater_id, note: r.note_id, v: Number(r.level), at: Number(r.created_at) || 0, age: (Number(r.created_at) || now) - (Number(r.acct_at) || 0) }));
  const weights = brigadeWeights(list);
  const result = scoreNotes(list.map((r, i) => ({ rater: r.rater, note: r.note, v: r.v, w: weights[i] })));
  const notes = rows(await env.DB.prepare("SELECT * FROM cn_notes WHERE deleted = 0").all());
  const rules = await postRules(env, null);
  const banned = await bannedSet(env);
  const statements = [];
  const newlyShown = [];
  const algo = {};
  const authorCrh = {}, authorCrnh = {};
  for (const row of notes) {
    const s = result.notes[row.id] || { status: "nmr", intercept: 0, factor: 0, n: 0 };
    algo[row.id] = s.status;
    if (s.status === "crh") authorCrh[row.author_id] = (authorCrh[row.author_id] || 0) + 1;
    if (s.status === "crnh") authorCrnh[row.author_id] = (authorCrnh[row.author_id] || 0) + 1;
    const flags = noteFlags(Object.assign({}, row, { algo_status: s.status }), rules, banned);
    const eff = effectiveStatus(flags);
    const changed = eff !== row.status;
    if (eff === "crh" && !Number(row.shown_at)) newlyShown.push(row);
    statements.push(env.DB.prepare("UPDATE cn_notes SET algo_status = ?, intercept = ?, factor = ?, rating_count = ?, status = ?, status_at = ?, shown_at = CASE WHEN ? = 'crh' AND shown_at = 0 THEN ? ELSE shown_at END WHERE id = ?")
      .bind(s.status, s.intercept, s.factor, s.n, eff, changed ? now : (Number(row.status_at) || now), eff, now, row.id));
  }
  const impact = ratingImpact(list, algo);
  const contributors = rows(await env.DB.prepare("SELECT public_id FROM cn_contributors").all());
  const need = writeImpact(env);
  for (const c of contributors) {
    const ri = impact[c.public_id] || 0;
    const wi = (authorCrh[c.public_id] || 0) - (authorCrnh[c.public_id] || 0);
    const f = result.raters[c.public_id] ? result.raters[c.public_id].factor : 0;
    statements.push(env.DB.prepare("UPDATE cn_contributors SET rating_impact = ?, writing_impact = ?, factor = ?, can_write = CASE WHEN can_write = 1 AND ? > -3 THEN 1 WHEN ? >= ? AND ? > -3 THEN 1 ELSE 0 END WHERE public_id = ?")
      .bind(ri, wi, f, wi, ri, need, wi, c.public_id));
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  let notified = 0;
  if (emit) for (const row of newlyShown) notified += await notifyShown(env, row, emit);
  return { method: result.method, notes: notes.length, ratings: list.length, shown: newlyShown.length, notified };
}

/* Like X: the post's author, the note's writer, people who asked for a note
   and people who reposted or liked the post hear that context was added. */
async function notifyShown(env, row, emit) {
  const ref = row.post_ref;
  const hash = ref.startsWith("app:") ? "#/app/i/status/" + encodeURIComponent(ref.slice(4)) : "#/" + encodeURIComponent(ref.split(":")[0]) + "/i/status/" + encodeURIComponent(ref.split(":").slice(1).join(":"));
  const who = new Map();
  const put = (id, role) => { if (/^\d{12}$/.test(String(id || "")) && !who.has(id) && who.size < NOTIFY_CAP) who.set(id, role); };
  put(row.author_id, "writer");
  if (row.app_post_id) {
    try {
      const p = await env.DB.prepare("SELECT author_id FROM public_posts WHERE id = ?").bind(row.app_post_id).first();
      if (p) put(p.author_id, "author");
      rows(await env.DB.prepare("SELECT account_id FROM public_post_likes WHERE post_id = ? LIMIT 200").bind(row.app_post_id).all()).forEach((r) => put(r.account_id, "engaged"));
    } catch (err) { /* tables missing in a fresh database */ }
  }
  try { rows(await env.DB.prepare("SELECT public_id FROM cn_requests WHERE post_ref = ? LIMIT 200").bind(ref).all()).forEach((r) => put(r.public_id, "engaged")); } catch (err) { /* none */ }
  try { rows(await env.DB.prepare("SELECT public_id FROM account_reposts WHERE post_key = ? LIMIT 200").bind("r:" + ref).all()).forEach((r) => put(r.public_id, "engaged")); } catch (err) { /* none */ }
  let n = 0;
  for (const [id, role] of who) {
    try {
      const text = role === "writer" ? "Your Community Note is now showing" : role === "author" ? "Readers added context to your post" : "Readers added context to a post you interacted with";
      await emit(env, { publicId: id, kind: "community_note", idempotencyKey: "cn:" + row.id + ":" + id, text, name: text, hash, platform: ref.split(":")[0] });
      n++;
    } catch (err) { /* one failed delivery must not stop the rest */ }
  }
  return n;
}

/* ---------- routes ---------- */

function okJson(deps, body, cache) { return deps.json(200, body, { "cache-control": cache || "private, no-store" }); }

export async function handleCommunityNotes(request, env, path, url, deps, ctx) {
  if (!path.startsWith("/v1/cnotes")) return null;
  const m = request.method;
  // Public, cacheable reads first: no session lookup at all.
  let hit = path.match(/^\/v1\/cnotes\/shard\/([0-9a-f])$/);
  if (hit && m === "GET") return serveR2(request, env, PUB_SHARD + hit[1] + ".json", "public, max-age=300, stale-while-revalidate=3600", deps);
  hit = path.match(/^\/v1\/cnotes\/n\/([0-9a-f]{64})$/);
  if (hit && m === "GET") return serveR2(request, env, BLOB + hit[1] + ".json", "public, max-age=31536000, immutable", deps);
  await ensureCnSchema(env);
  if (path === "/v1/cnotes/version" && m === "GET") {
    return okJson(deps, { v: await getState(env, "version"), at: Number(await getState(env, "published_at")) || 0 }, "public, max-age=120");
  }
  const viewer = await deps.sessionAccount(env, request);
  if (path === "/v1/cnotes/me" && m === "GET") {
    const elig = await eligibility(env, viewer);
    const c = viewer ? await contributor(env, viewer.public_id) : null;
    return okJson(deps, { eligibility: elig, contributor: presentContributor(env, c), owner: !!(viewer && viewer.owner === 1), thresholds: { crh: THRESHOLDS.crhIntercept, crhMaxFactor: THRESHOLDS.crhMaxFactor, crnh: THRESHOLDS.crnhIntercept, minRatings: THRESHOLDS.minRatings } });
  }
  if (!viewer) return deps.json(401, { error: "auth_required" });
  if (path === "/v1/cnotes/join" && m === "POST") return join(env, viewer, deps);
  if (path === "/v1/cnotes/leave" && m === "POST") {
    await env.DB.prepare("UPDATE cn_contributors SET left_at = ? WHERE public_id = ?").bind(Date.now(), viewer.public_id).run();
    return okJson(deps, { ok: true });
  }
  if (path === "/v1/cnotes" && m === "POST") return write(request, env, viewer, deps);
  if (path === "/v1/cnotes/rate" && m === "POST") return rate(request, env, viewer, deps);
  if (path === "/v1/cnotes/request" && m === "POST") return requestNote(request, env, viewer, deps);
  if (path === "/v1/cnotes/pending" && m === "GET") return pending(env, viewer, deps, url);
  if (path === "/v1/cnotes/queue" && m === "GET") return queue(env, viewer, deps);
  if (path.startsWith("/v1/cnotes/admin")) {
    if (viewer.owner !== 1) return deps.json(403, { error: "forbidden" });
    if (path === "/v1/cnotes/admin" && m === "GET") return adminList(env, deps, url);
    if (path === "/v1/cnotes/admin/audit" && m === "GET") {
      const list = rows(await env.DB.prepare("SELECT id, at, action, target, detail FROM cn_audit ORDER BY id DESC LIMIT 100").all());
      return okJson(deps, { items: list });
    }
    if (path === "/v1/cnotes/admin" && m === "POST") return adminAct(request, env, viewer, deps, ctx);
    if (path === "/v1/cnotes/admin/rescore" && m === "POST") {
      const out = await runCommunityNotes(env, Date.now(), deps.emit, { force: true });
      await audit(env, "rescore", "all", {});
      return okJson(deps, out);
    }
  }
  return deps.json(404, { error: "not_found" });
}

async function serveR2(request, env, key, cache, deps) {
  if (!env.DATA) return deps.json(404, { error: "not_found" });
  const obj = await env.DATA.get(key);
  if (!obj) return deps.json(404, { error: "not_found" }, { "cache-control": "public, max-age=60" });
  const etag = obj.httpEtag || ("\"" + (obj.etag || "") + "\"");
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": cache } });
  return new Response(obj.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, etag, "x-content-type-options": "nosniff" } });
}

async function join(env, viewer, deps) {
  const elig = await eligibility(env, viewer);
  if (!elig.eligible) return deps.json(403, { error: "not_eligible", reasons: elig.reasons });
  const existing = await env.DB.prepare("SELECT * FROM cn_contributors WHERE public_id = ?").bind(viewer.public_id).first();
  if (existing) {
    await env.DB.prepare("UPDATE cn_contributors SET left_at = 0 WHERE public_id = ?").bind(viewer.public_id).run();
    return okJson(deps, { contributor: presentContributor(env, Object.assign({}, existing, { left_at: 0 })) });
  }
  for (let i = 0; i < 8; i++) {
    const alias = makeAlias();
    try {
      await env.DB.prepare("INSERT INTO cn_contributors (public_id, alias, joined_at, can_write) VALUES (?, ?, ?, ?)").bind(viewer.public_id, alias, Date.now(), writeImpact(env) === 0 ? 1 : 0).run();
      return okJson(deps, { contributor: presentContributor(env, await contributor(env, viewer.public_id)) });
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message || err))) throw err;
    }
  }
  return deps.json(503, { error: "try_again" });
}

async function activeContributor(env, viewer, deps) {
  const c = await contributor(env, viewer.public_id);
  if (!c) return { error: deps.json(403, { error: "not_contributor" }) };
  if (Number(c.banned) === 1) return { error: deps.json(403, { error: "banned" }) };
  const temp = await env.DB.prepare("SELECT 1 AS t FROM account_temp WHERE public_id = ?").bind(viewer.public_id).first().catch(() => null);
  if (temp) return { error: deps.json(403, { error: "temporary" }) };
  return { c };
}

async function write(request, env, viewer, deps) {
  const gate = await activeContributor(env, viewer, deps);
  if (gate.error) return gate.error;
  if (Number(gate.c.can_write) !== 1 && viewer.owner !== 1) return deps.json(403, { error: "writing_locked", ratingImpact: Number(gate.c.rating_impact) || 0, needed: writeImpact(env) });
  const body = await deps.readJson(request, 6000);
  const note = cleanNoteInput(body);
  if (note.error) return deps.json(400, { error: note.error });
  const rule = await env.DB.prepare("SELECT no_notes FROM cn_post_rules WHERE post_ref = ?").bind(note.ref).first();
  if (rule && Number(rule.no_notes) === 1) return deps.json(403, { error: "no_notes_allowed" });
  const dupe = await env.DB.prepare("SELECT id FROM cn_notes WHERE post_ref = ? AND author_id = ? AND deleted = 0").bind(note.ref, viewer.public_id).first();
  if (dupe) return deps.json(409, { error: "already_wrote", id: dupe.id });
  const paced = await deps.rateHit(env, "cn-write:" + viewer.public_id, WRITE_LIMIT_DAY, DAY);
  if (!paced.ok) return deps.limited(paced);
  const id = randomId();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO cn_notes (id, post_ref, app_post_id, author_id, classification, reasons, body, sources, media_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, note.ref, note.appPost, viewer.public_id, note.cls, note.reasons.join(","), note.text, JSON.stringify(note.sources), note.media ? 1 : 0, now, now).run();
  await markDirty(env);
  return deps.json(201, { id, status: "nmr" });
}

async function rate(request, env, viewer, deps) {
  const gate = await activeContributor(env, viewer, deps);
  if (gate.error) return gate.error;
  const body = await deps.readJson(request, 2000);
  const id = String((body && body.note) || "");
  if (!/^[a-f0-9]{16}$/.test(id)) return deps.json(400, { error: "bad_note" });
  const note = await env.DB.prepare("SELECT author_id, deleted, locked FROM cn_notes WHERE id = ?").bind(id).first();
  if (!note || Number(note.deleted) === 1) return deps.json(404, { error: "not_found" });
  if (note.author_id === viewer.public_id) return deps.json(403, { error: "own_note" });
  if (request.method === "POST" && body && body.level === "") {
    await env.DB.prepare("DELETE FROM cn_ratings WHERE note_id = ? AND rater_id = ?").bind(id, viewer.public_id).run();
    await markDirty(env);
    return okJson(deps, { ok: true, level: "" });
  }
  const r = cleanRating(body);
  if (r.error) return deps.json(400, { error: r.error });
  const paced = await deps.rateHit(env, "cn-rate:" + viewer.public_id, RATE_LIMIT_HOUR, 3600000);
  if (!paced.ok) return deps.limited(paced);
  await env.DB.prepare("INSERT INTO cn_ratings (note_id, rater_id, level, tags, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(note_id, rater_id) DO UPDATE SET level = excluded.level, tags = excluded.tags, created_at = excluded.created_at")
    .bind(id, viewer.public_id, r.value, r.tags.join(","), Date.now()).run();
  if (Number(note.locked) !== 1) await markDirty(env);
  return okJson(deps, { ok: true, level: r.level });
}

async function requestNote(request, env, viewer, deps) {
  const body = await deps.readJson(request, 600);
  const ref = cleanRef(body && body.ref);
  if (!ref) return deps.json(400, { error: "bad_ref" });
  const temp = await env.DB.prepare("SELECT 1 AS t FROM account_temp WHERE public_id = ?").bind(viewer.public_id).first().catch(() => null);
  if (temp) return deps.json(403, { error: "temporary" });
  const paced = await deps.rateHit(env, "cn-req:" + viewer.public_id, REQUEST_LIMIT_HOUR, 3600000);
  if (!paced.ok) return deps.limited(paced);
  if (body && body.undo === true) await env.DB.prepare("DELETE FROM cn_requests WHERE post_ref = ? AND public_id = ?").bind(ref, viewer.public_id).run();
  else await env.DB.prepare("INSERT INTO cn_requests (post_ref, public_id, created_at) VALUES (?, ?, ?) ON CONFLICT(post_ref, public_id) DO NOTHING").bind(ref, viewer.public_id, Date.now()).run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM cn_requests WHERE post_ref = ?").bind(ref).first();
  return okJson(deps, { ok: true, requested: !(body && body.undo === true), count: Number(n && n.n) || 0 });
}

/* Contributors only: notes that still need ratings on the posts they are
   looking at, with their own rating. Never the raw ratings of others. */
async function pending(env, viewer, deps, url) {
  const c = await contributor(env, viewer.public_id);
  if (!c) return deps.json(403, { error: "not_contributor" });
  const refs = Array.from(new Set(String(url.searchParams.get("refs") || "").split(",").map(cleanRef).filter(Boolean))).slice(0, 40);
  if (!refs.length) return okJson(deps, { r: {} });
  const marks = refs.map(() => "?").join(",");
  const list = rows(await env.DB.prepare("SELECT id, post_ref, author_id, classification, reasons, body, sources, media_note, created_at, status FROM cn_notes WHERE deleted = 0 AND status IN ('nmr', 'crh', 'crnh') AND post_ref IN (" + marks + ") ORDER BY created_at DESC LIMIT 200").bind(...refs).all());
  const ids = list.map((n) => n.id);
  const mine = {};
  if (ids.length) rows(await env.DB.prepare("SELECT note_id, level, tags FROM cn_ratings WHERE rater_id = ? AND note_id IN (" + ids.map(() => "?").join(",") + ")").bind(viewer.public_id, ...ids).all()).forEach((r) => { mine[r.note_id] = { level: Number(r.level) >= 1 ? "helpful" : Number(r.level) > 0 ? "somewhat" : "not", tags: String(r.tags || "").split(",").filter(Boolean) }; });
  const reqs = {};
  rows(await env.DB.prepare("SELECT post_ref, COUNT(*) AS n, SUM(CASE WHEN public_id = ? THEN 1 ELSE 0 END) AS me FROM cn_requests WHERE post_ref IN (" + marks + ") GROUP BY post_ref").bind(viewer.public_id, ...refs).all()).forEach((r) => { reqs[r.post_ref] = { n: Number(r.n) || 0, me: Number(r.me) > 0 }; });
  const out = {};
  refs.forEach((ref) => { out[ref] = { notes: [], requests: reqs[ref] || { n: 0, me: false } }; });
  list.forEach((n) => {
    let sources = [];
    try { sources = JSON.parse(n.sources || "[]"); } catch (err) { sources = []; }
    out[n.post_ref].notes.push({ id: n.id, cls: n.classification, reasons: String(n.reasons || "").split(",").filter(Boolean), text: n.body, sources, media: Number(n.media_note) === 1, created: n.created_at, status: n.status === "crh" ? "crh" : n.status === "crnh" ? "crnh" : "nmr", mine: n.author_id === viewer.public_id, rating: mine[n.id] || null });
  });
  return okJson(deps, { r: out, contributor: presentContributor(env, c) });
}

function presentNote(n, rating) {
  let sources = [];
  try { sources = JSON.parse(n.sources || "[]"); } catch (err) { sources = []; }
  return { id: n.id, ref: n.post_ref, cls: n.classification, reasons: String(n.reasons || "").split(",").filter(Boolean), text: n.body, sources, media: Number(n.media_note) === 1, created: n.created_at, status: n.status, rating: rating || null };
}

/* Contributors only: the "Needs your help" list (notes still needing
   ratings that this contributor has not rated and did not write) and
   their own notes with status. */
async function queue(env, viewer, deps) {
  const c = await contributor(env, viewer.public_id);
  if (!c) return deps.json(403, { error: "not_contributor" });
  const help = rows(await env.DB.prepare("SELECT n.* FROM cn_notes n WHERE n.deleted = 0 AND n.status = 'nmr' AND n.author_id != ? AND NOT EXISTS (SELECT 1 FROM cn_ratings r WHERE r.note_id = n.id AND r.rater_id = ?) ORDER BY n.created_at DESC LIMIT 30").bind(viewer.public_id, viewer.public_id).all());
  const mine = rows(await env.DB.prepare("SELECT * FROM cn_notes WHERE author_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 50").bind(viewer.public_id).all());
  const rated = rows(await env.DB.prepare("SELECT COUNT(*) AS n FROM cn_ratings WHERE rater_id = ?").bind(viewer.public_id).all());
  return okJson(deps, {
    help: help.map((n) => presentNote(n)),
    mine: mine.map((n) => Object.assign(presentNote(n), { status: n.status === "hidden" ? "nmr" : n.status })),
    rated: Number(rated[0] && rated[0].n) || 0,
    contributor: presentContributor(env, c)
  });
}

/* ---------- owner ---------- */

async function adminList(env, deps, url) {
  const status = String(url.searchParams.get("status") || "all");
  const src = String(url.searchParams.get("src") || "own");
  if (src === "x") {
    const items = [];
    const xo = {};
    rows(await env.DB.prepare("SELECT x_note_id, override FROM cn_x_overrides").all()).forEach((r) => { xo[r.x_note_id] = r.override; });
    for (let i = 0; i < SHARDS && items.length < 300; i++) {
      const doc = await readJsonKey(env, X_SHARD + i.toString(16) + ".json");
      ((doc && doc.notes) || []).forEach((n) => { if (items.length < 300) items.push({ id: String(n.id), ref: n.ref, text: n.text, cls: n.cls, created: n.created, statusAt: n.statusAt, override: xo[n.id] || "" }); });
    }
    return okJson(deps, { items, src: "x" });
  }
  let where = "1 = 1";
  if (status === "deleted") where = "deleted = 1";
  else if (["crh", "crnh", "nmr", "hidden"].indexOf(status) >= 0) where = "deleted = 0 AND status = '" + status + "'";
  else if (status === "overridden") where = "deleted = 0 AND (override != '' OR locked = 1)";
  else where = "deleted = 0";
  const list = rows(await env.DB.prepare("SELECT n.*, c.alias, c.banned FROM cn_notes n LEFT JOIN cn_contributors c ON c.public_id = n.author_id WHERE " + where.replace(/\b(deleted|status|override|locked)\b/g, "n.$1") + " ORDER BY n.updated_at DESC LIMIT 200").all());
  const requested = rows(await env.DB.prepare("SELECT post_ref, COUNT(*) AS n FROM cn_requests GROUP BY post_ref ORDER BY n DESC LIMIT 30").all());
  const blocked = rows(await env.DB.prepare("SELECT post_ref FROM cn_post_rules WHERE no_notes = 1 ORDER BY at DESC LIMIT 100").all()).map((r) => r.post_ref);
  const counts = {};
  rows(await env.DB.prepare("SELECT status, COUNT(*) AS n FROM cn_notes WHERE deleted = 0 GROUP BY status").all()).forEach((r) => { counts[r.status] = Number(r.n) || 0; });
  return okJson(deps, {
    items: list.map((n) => ({ id: n.id, ref: n.post_ref, alias: n.alias || "", authorBanned: Number(n.banned) === 1, cls: n.classification, reasons: String(n.reasons || "").split(",").filter(Boolean), text: n.body, status: n.status, algoStatus: n.algo_status, intercept: n.intercept, factor: n.factor, ratings: n.rating_count, override: n.override, locked: Number(n.locked) === 1, edited: Number(n.edited_by_owner) === 1, deleted: Number(n.deleted) === 1, created: n.created_at })),
    requested, blocked, counts
  });
}

const ACTIONS = ["show", "hide", "clear", "lock", "unlock", "edit", "delete", "restore", "ban", "unban", "nonotes", "allownotes", "xshow", "xhide", "xclear"];

async function adminAct(request, env, viewer, deps, ctx) {
  const body = await deps.readJson(request, 6000);
  const action = String((body && body.action) || "");
  if (ACTIONS.indexOf(action) < 0) return deps.json(400, { error: "bad_action" });
  const now = Date.now();
  const id = String((body && body.note) || "");
  const needNote = ["show", "hide", "clear", "lock", "unlock", "edit", "delete", "restore", "ban", "unban"].indexOf(action) >= 0;
  let note = null;
  if (needNote) {
    if (!/^[a-f0-9]{16}$/.test(id)) return deps.json(400, { error: "bad_note" });
    note = await env.DB.prepare("SELECT * FROM cn_notes WHERE id = ?").bind(id).first();
    if (!note) return deps.json(404, { error: "not_found" });
  }
  const rules = async () => postRules(env, null);
  const banned = async () => bannedSet(env);
  const restatus = async (noteId) => {
    const row = await env.DB.prepare("SELECT * FROM cn_notes WHERE id = ?").bind(noteId).first();
    if (!row) return "";
    const eff = effectiveStatus(noteFlags(row, await rules(), await banned()));
    await env.DB.prepare("UPDATE cn_notes SET status = ?, status_at = ?, updated_at = ? WHERE id = ?").bind(eff, now, now, noteId).run();
    return eff;
  };
  let detail = {};
  if (action === "show" || action === "hide") await env.DB.prepare("UPDATE cn_notes SET override = ? WHERE id = ?").bind(action, id).run();
  else if (action === "clear") await env.DB.prepare("UPDATE cn_notes SET override = '' WHERE id = ?").bind(id).run();
  else if (action === "lock") await env.DB.prepare("UPDATE cn_notes SET locked = 1, locked_status = ? WHERE id = ?").bind(["crh", "crnh", "nmr"].indexOf(body.status) >= 0 ? body.status : (note.algo_status || "nmr"), id).run();
  else if (action === "unlock") await env.DB.prepare("UPDATE cn_notes SET locked = 0, locked_status = '' WHERE id = ?").bind(id).run();
  else if (action === "edit") {
    const text = String(body.text || "").trim();
    if (!text || noteLength(text) > TEXT_MAX) return deps.json(400, { error: "bad_text" });
    detail = { before: note.body.slice(0, 600) };
    await env.DB.prepare("UPDATE cn_notes SET body = ?, sources = ?, edited_by_owner = 1, locked = 1, locked_status = CASE WHEN locked_status = '' THEN algo_status ELSE locked_status END WHERE id = ?").bind(text, JSON.stringify(sourcesOf(text)), id).run();
  } else if (action === "delete") {
    detail = { before: note.body.slice(0, 600) };
    await env.DB.prepare("UPDATE cn_notes SET deleted = 1 WHERE id = ?").bind(id).run();
  } else if (action === "restore") await env.DB.prepare("UPDATE cn_notes SET deleted = 0 WHERE id = ?").bind(id).run();
  else if (action === "ban" || action === "unban") {
    const flag = action === "ban" ? 1 : 0;
    await env.DB.prepare("UPDATE cn_contributors SET banned = ?, can_write = CASE WHEN ? = 1 THEN 0 ELSE can_write END WHERE public_id = ?").bind(flag, flag, note.author_id).run();
    const theirs = rows(await env.DB.prepare("SELECT id FROM cn_notes WHERE author_id = ?").bind(note.author_id).all());
    for (const r of theirs) await restatus(r.id);
    await markDirty(env);
  } else if (action === "nonotes" || action === "allownotes") {
    const ref = cleanRef(body.ref);
    if (!ref) return deps.json(400, { error: "bad_ref" });
    await env.DB.prepare("INSERT INTO cn_post_rules (post_ref, no_notes, at) VALUES (?, ?, ?) ON CONFLICT(post_ref) DO UPDATE SET no_notes = excluded.no_notes, at = excluded.at").bind(ref, action === "nonotes" ? 1 : 0, now).run();
    for (const r of rows(await env.DB.prepare("SELECT id FROM cn_notes WHERE post_ref = ?").bind(ref).all())) await restatus(r.id);
    detail = { ref };
  } else if (action === "xshow" || action === "xhide" || action === "xclear") {
    const xid = String(body.xnote || "").replace(/\D/g, "");
    if (!xid) return deps.json(400, { error: "bad_note" });
    if (action === "xclear") await env.DB.prepare("DELETE FROM cn_x_overrides WHERE x_note_id = ?").bind(xid).run();
    else await env.DB.prepare("INSERT INTO cn_x_overrides (x_note_id, override, at) VALUES (?, ?, ?) ON CONFLICT(x_note_id) DO UPDATE SET override = excluded.override, at = excluded.at").bind(xid, action.slice(1), now).run();
    detail = { xnote: xid };
  }
  let status = "";
  if (needNote && action !== "ban" && action !== "unban") status = await restatus(id);
  await audit(env, action, needNote ? id : (detail.ref || detail.xnote || ""), detail);
  // Overrides take effect right away: republish the shards (no rescoring).
  const job = publishNotes(env, now).catch(() => null);
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  return okJson(deps, { ok: true, status });
}
