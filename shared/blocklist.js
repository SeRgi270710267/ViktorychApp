/* Muted and blocked items, shared by the app, the Pages boot script and the
   Worker. Rules live on the device (and in the private settings sync). The
   server only ever sees a compact list of 32-bit FNV-1a hashes of typed keys,
   never a raw handle, id or word.

   Typed keys:
     a|<account>   an account: feed id, platform:handle, or a bare handle
     p|<post>      a single post or comment: platform:statusId, or its id
     s|<source>    a whole source: feed:<feed id>, community:<name>,
                   reddit:<subreddit>, discord:<channel id>
     r|<account>   replies from that account
     v|<account>   videos from that account
     o|<account>   reposts made by that account
   Words never leave the device. */

const MAX_HASHES = 600;
const HEADER = "X-Block";

function fnv(text) {
  let h = 0x811c9dc5;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function norm(value) {
  return String(value == null ? "" : value).replace(/^@/, "").trim().toLowerCase();
}

/* Every key one author can be named by. A bare handle matches every platform,
   as the older muted-accounts list always did. */
function accountKeys(who) {
  if (!who) return [];
  const out = [];
  const handle = norm(who.handle || (who.platform === "reddit" && typeof who.author === "string" ? who.author : ""));
  const platform = norm(who.platform || "x");
  const feed = norm(who.feedId);
  if (feed) out.push(feed);
  if (handle) { out.push(platform + ":" + handle); out.push(handle); }
  if (who.authorId) { out.push("app:" + norm(who.authorId)); out.push(norm(who.authorId)); }
  if (who.channelId) out.push(platform + ":" + norm(who.channelId));
  return out;
}

function postKeys(post) {
  if (!post) return [];
  const out = [];
  const platform = norm(post.platform || "x");
  const status = norm(post.statusId);
  const id = norm(post.id);
  if (status) out.push(platform + ":" + status);
  if (id) { out.push(id); if (id.indexOf(":") < 0) out.push(platform + ":" + id); }
  return out;
}

function sourceKeys(post) {
  if (!post) return [];
  const out = [];
  if (post.feedId) out.push("feed:" + norm(post.feedId));
  const community = post.community && (post.community.name || post.community.id);
  if (community) out.push("community:" + norm(community));
  const sub = post.subreddit || post.sub || (post.platform === "reddit" && post.community && post.community.name);
  if (sub) out.push("reddit:" + norm(sub).replace(/^r\//, ""));
  if (post.platform === "discord" && (post.channelId || post.channel)) out.push("discord:" + norm(post.channelId || post.channel));
  if (post.forum) out.push("forum:" + norm(post.forum));
  return out;
}

function hasVideo(post) {
  return (post && Array.isArray(post.media) ? post.media : []).some((m) => m && (m.type === "video" || m.type === "animated_gif" || /\.(?:mp4|m3u8|webm)(?:$|\?)/i.test(String(m.url || m.src || ""))))
    || !!(post && (post.watch || post.platform === "youtube" || post.short));
}

function isReply(post) {
  return !!(post && (post.kind === "reply" || post.parentId || (post.replyingTo && (post.replyingTo.id || post.replyingTo.handle))));
}

/* Turn the settings into the hash list the filter uses. */
function rulesFromSettings(settings) {
  const s = settings || {};
  const blocks = s.blocks || {};
  const keys = [];
  (s.mutedAccounts || []).forEach((item) => { const k = norm(item); if (k) keys.push("a|" + k); });
  (blocks.accounts || []).forEach((item) => { const k = norm(item); if (k) keys.push("a|" + k); });
  (blocks.posts || []).forEach((item) => { const k = norm(item); if (k) keys.push("p|" + k); });
  (blocks.sources || []).forEach((item) => { const k = norm(item); if (k) keys.push("s|" + k); });
  (s.repostOff || []).forEach((item) => { const k = norm(item); if (k) keys.push("o|" + k); });
  const types = blocks.types || {};
  Object.keys(types).forEach((acct) => {
    const k = norm(acct);
    if (!k) return;
    (types[acct] || []).forEach((kind) => {
      if (kind === "replies") keys.push("r|" + k);
      else if (kind === "videos") keys.push("v|" + k);
      else if (kind === "reposts") keys.push("o|" + k);
    });
  });
  const seen = new Set();
  const hashes = [];
  keys.forEach((key) => {
    const h = fnv(key);
    if (seen.has(h)) return;
    seen.add(h);
    hashes.push(h);
  });
  return hashes;
}

function headerValue(hashes) {
  const list = (hashes || []).slice(0, MAX_HASHES);
  return list.length ? "1." + list.join(".") : "";
}

function parseHeader(value) {
  const text = String(value || "").trim();
  if (!/^1\.[0-9a-z.]{1,8000}$/.test(text)) return null;
  const parts = text.slice(2).split(".").filter((p) => /^[0-9a-z]{1,7}$/.test(p)).slice(0, MAX_HASHES);
  return parts.length ? new Set(parts) : null;
}

function any(set, prefix, keys) {
  for (let i = 0; i < keys.length; i++) if (set.has(fnv(prefix + keys[i]))) return true;
  return false;
}

/* Why a post is blocked: "account", "post", "source", "type", or "". */
function reason(set, post) {
  if (!set || !set.size || !post || typeof post !== "object") return "";
  const author = accountKeys(post);
  if (any(set, "a|", author)) return "account";
  if (any(set, "p|", postKeys(post))) return "post";
  if (any(set, "s|", sourceKeys(post))) return "source";
  if (post.repostedBy) {
    const by = Object.assign({ platform: post.platform }, post.repostedBy);
    if (any(set, "o|", accountKeys(by))) return "type";
    if (any(set, "a|", accountKeys({ handle: by.handle, platform: by.platform }))) return "account";
  }
  if (isReply(post) && any(set, "r|", author)) return "type";
  if (hasVideo(post) && any(set, "v|", author)) return "type";
  return "";
}

function quoteBlocked(set, quoted) {
  if (!set || !set.size || !quoted || typeof quoted !== "object") return false;
  const as = Object.assign({ platform: "x" }, quoted, { kind: "post", repostedBy: null });
  return any(set, "a|", accountKeys(as)) || any(set, "p|", postKeys(as));
}

function looksLikePost(item) {
  return !!(item && typeof item === "object" && !Array.isArray(item) && (item.id != null || item.statusId != null)
    && (item.handle || item.authorId || item.author || item.feedId || item.text != null));
}

/* Drop blocked posts and comments anywhere in a JSON document: feed pages,
   reply lists, nested comment trees. Only arrays under post-like keys are
   filtered, so account lists and feed rows stay whole. Quotes of blocked
   items lose their body. Returns the number of items removed. */
const POST_LISTS = { posts: 1, replies: 1, comments: 1, children: 1, items: 1, messages: 1, thread: 1, parents: 1 };

function filterList(set, list, depth) {
  let removed = 0;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (looksLikePost(item) && reason(set, item)) { removed += 1; continue; }
    removed += filterDoc(set, item, depth + 1);
    list[w++] = item;
  }
  list.length = w;
  return removed;
}

function filterDoc(set, doc, depth) {
  let removed = 0;
  depth = depth || 0;
  if (!set || !set.size || !doc || typeof doc !== "object" || depth > 10) return 0;
  if (Array.isArray(doc)) {
    for (let i = 0; i < doc.length; i++) removed += filterDoc(set, doc[i], depth + 1);
    return removed;
  }
  if (doc.quoted && quoteBlocked(set, doc.quoted)) {
    doc.quoted = null;
    doc.quoteBlocked = true;
    removed += 1;
  }
  Object.keys(doc).forEach((key) => {
    if (key === "feeds" || key === "quoted") return;
    const value = doc[key];
    if (Array.isArray(value) && POST_LISTS[key]) removed += filterList(set, value, depth);
    else if (value && typeof value === "object") removed += filterDoc(set, value, depth + 1);
  });
  return removed;
}

const api = { HEADER, MAX_HASHES, fnv, norm, accountKeys, postKeys, sourceKeys, hasVideo, isReply, rulesFromSettings, headerValue, parseHeader, reason, quoteBlocked, filterDoc };
export { HEADER, MAX_HASHES, fnv, norm, accountKeys, postKeys, sourceKeys, hasVideo, isReply, rulesFromSettings, headerValue, parseHeader, reason, quoteBlocked, filterDoc };
export default api;
if (typeof globalThis !== "undefined") {
  globalThis.ViktorychBlocks = api;
  try { globalThis.dispatchEvent && globalThis.dispatchEvent(new Event("viktorych-blocks")); } catch (err) { /* workers */ }
}
