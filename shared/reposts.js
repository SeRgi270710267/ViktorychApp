/* Reposts and quotes saved on an app account.
   The Worker stores one sanitized snapshot per row. The profile builds the
   card from that snapshot plus the account's current name. */

const SNAPSHOT_MAX = 12000;
const COMMENT_MAX = 280;

function clip(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, max);
}

function platformOf(value) {
  const text = String(value || "").toLowerCase();
  return /^[a-z][a-z0-9]{0,15}$/.test(text) ? text : "";
}

function keyPart(value) {
  return clip(value, 140).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 100);
}

function httpUrl(value) {
  const text = clip(value, 500).trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/v1\/media\/(avatars|banners)\/\d{12}\/[a-f0-9]{64}\.(?:webp|jpg|png)$/.test(text)) return text;
  return "";
}

function slimMedia(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = 0; i < list.length && out.length < 4; i++) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const type = item.type === "video" || item.type === "animated_gif" || item.type === "photo" || item.type === "image" ? item.type : "";
    const url = httpUrl(item.url);
    const poster = httpUrl(item.poster);
    if (!type || (!url && !poster)) continue;
    out.push({ type: type, url: url, poster: poster, alt: clip(item.alt, 180) });
  }
  return out;
}

function slimStats(stats) {
  const out = {};
  const src = stats && typeof stats === "object" ? stats : {};
  ["likes", "reposts", "replies", "quotes", "views", "bookmarks"].forEach((key) => {
    const n = Number(src[key]);
    if (!Number.isFinite(n) || n < 0) return;
    out[key] = Math.min(Math.floor(n), 1e12);
  });
  return out;
}

function slimQuoted(post) {
  if (!post || typeof post !== "object") return null;
  const platform = platformOf(post.platform);
  const id = clip(post.statusId || post.id, 140);
  if (!platform || !id) return null;
  const row = {
    id: clip(post.id || id, 180),
    statusId: clip(post.statusId || id, 140),
    platform: platform,
    handle: clip(post.handle, 80).replace(/^@/, ""),
    author: clip(post.author, 80),
    avatar: httpUrl(post.avatar),
    text: clip(post.text, 2000),
    title: clip(post.title, 300),
    date: clip(post.date, 40),
    url: httpUrl(post.url),
    media: slimMedia(post.media)
  };
  if (post.verifiedType) row.verifiedType = clip(post.verifiedType, 24);
  return row;
}

export function sourceKey(post) {
  const platform = platformOf(post && post.platform);
  const id = keyPart(post && (post.statusId || post.id));
  if (!platform || !id) return "";
  return (platform + ":" + id).slice(0, 150);
}

export function snapshotPost(post) {
  if (!post || typeof post !== "object") return null;
  const platform = platformOf(post.platform);
  const id = clip(post.statusId || post.id, 140);
  if (!platform || !id) return null;
  const kind = post.kind === "quote" || post.kind === "repost" || post.kind === "reply" || post.kind === "community" ? post.kind : "post";
  const row = {
    id: clip(post.id || id, 180),
    statusId: clip(post.statusId || id, 140),
    platform: platform,
    handle: clip(post.handle, 80).replace(/^@/, ""),
    author: clip(post.author, 80),
    avatar: httpUrl(post.avatar),
    text: clip(post.text, 4000),
    title: clip(post.title, 300),
    date: clip(post.date, 40),
    url: httpUrl(post.url),
    feedId: clip(post.feedId, 120),
    kind: kind,
    media: slimMedia(post.media),
    stats: slimStats(post.stats)
  };
  if (post.channelId) row.channelId = clip(post.channelId, 80);
  if (post.profileHandle) row.profileHandle = clip(post.profileHandle, 80);
  if (post.verifiedType) row.verifiedType = clip(post.verifiedType, 24);
  if (post.watch) row.watch = true;
  const quoted = slimQuoted(post.quoted);
  if (quoted) row.quoted = quoted;
  if (JSON.stringify(row).length > SNAPSHOT_MAX) return null;
  return row;
}

export function cleanRepostKey(value) {
  const key = String(value || "");
  if (!/^[rq]:[A-Za-z0-9._:-]{3,170}$/.test(key)) return "";
  return key;
}

export function cleanRepostWrite(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "bad_repost" };
  const kind = body.kind === "quote" ? "quote" : body.kind === "repost" ? "repost" : "";
  if (!kind) return { error: "bad_repost" };
  const post = snapshotPost(body.post);
  if (!post) return { error: "bad_post" };
  const source = sourceKey(post);
  if (!source) return { error: "bad_post" };
  let postKey = "";
  let comment = "";
  if (kind === "repost") {
    postKey = "r:" + source;
    comment = "";
  } else {
    postKey = cleanRepostKey(body.postKey);
    if (!postKey || postKey.indexOf("q:" + source + ":") !== 0) return { error: "bad_repost" };
    comment = clip(body.comment, COMMENT_MAX).trim();
    if (!comment) return { error: "bad_repost" };
  }
  if (!cleanRepostKey(postKey)) return { error: "bad_repost" };
  return { postKey: postKey, kind: kind, comment: comment, post: post };
}

function iso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  try { return new Date(n).toISOString(); }
  catch (err) { return new Date().toISOString(); }
}

export function toProfilePost(row, account, opts) {
  if (!row || !account || row.removed) return null;
  const created = iso(row.createdAt);
  const self = !!(opts && opts.self);
  const name = clip(account.displayName || account.handle, 80);
  const handle = clip(account.handle, 80).replace(/^@/, "");
  if (!handle) return null;
  if (row.kind === "quote") {
    const quoted = slimQuoted(row.post);
    if (!quoted) return null;
    return {
      id: row.postKey,
      statusId: row.postKey,
      platform: "app",
      handle: handle,
      author: name || handle,
      avatar: account.avatar || "",
      text: clip(row.comment, COMMENT_MAX),
      date: created,
      sortDate: created,
      kind: "quote",
      quoted: quoted,
      stats: {},
      feedId: "app:" + handle,
      url: ""
    };
  }
  const post = snapshotPost(row.post);
  if (!post) return null;
  post.kind = "repost";
  post.sortDate = created;
  post.repostedBy = {
    handle: handle,
    name: name || handle,
    avatar: account.avatar || "",
    platform: "app",
    feedId: "app:" + handle,
    self: self
  };
  return post;
}

export function sortReposts(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
    const delta = (Number(b && b.createdAt) || 0) - (Number(a && a.createdAt) || 0);
    if (delta) return delta;
    const left = String((a && a.postKey) || "");
    const right = String((b && b.postKey) || "");
    return left < right ? 1 : left > right ? -1 : 0;
  });
}

const api = {
  sourceKey: sourceKey,
  snapshotPost: snapshotPost,
  cleanRepostKey: cleanRepostKey,
  cleanRepostWrite: cleanRepostWrite,
  toProfilePost: toProfilePost,
  sortReposts: sortReposts
};
export { SNAPSHOT_MAX, COMMENT_MAX };
globalThis.AccountReposts = api;
