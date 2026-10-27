/* Chronological order for every feed tab.
   Times are normalized to UTC. A missing or future time sorts last.
   Equal times break ties by id, newest id first. */

const SKEW_MS = 10 * 60 * 1000;
const MIN_MS = Date.parse("2005-01-01T00:00:00Z");
const DISCORD_EPOCH = 1420070400000;

function parseInstant(value, opts) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return unixMs(value);
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{17,20}$/.test(text)) {
    if (opts && opts.snowflake) return discordSnowflake(text);
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return unixMs(Number(text));
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return finite(Date.parse(text + "T00:00:00Z"));
  const naive = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  if (naive) return finite(Date.parse(naive[1] + "T" + naive[2] + "Z"));
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return finite(Date.parse(text));
  return finite(Date.parse(text));
}

function finite(ms) {
  return Number.isFinite(ms) ? ms : null;
}

function unixMs(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e11) return Math.round(n * 1000);
  return Math.round(n);
}

function discordSnowflake(text) {
  try {
    const ms = Number((BigInt(text) >> 22n) + BigInt(DISCORD_EPOCH));
    return Number.isFinite(ms) ? ms : null;
  } catch (err) {
    return null;
  }
}

function trustedMs(value, now) {
  const ms = parseInstant(value);
  if (!ms || ms < MIN_MS) return 0;
  if (ms > (now == null ? Date.now() : now) + SKEW_MS) return 0;
  return ms;
}

function isRepost(post) {
  if (!post) return false;
  if (post.kind === "repost") return true;
  const by = post.repostedBy;
  if (by && (by.handle || by.name)) return true;
  const from = post.forwardedFrom;
  return !!(from && typeof from === "object" && (from.handle || from.name));
}

function orderMs(post, now) {
  const clock = now == null ? Date.now() : now;
  const fields = isRepost(post) ? ["sortDate", "repostDate", "repostedAt", "date"] : ["date", "sortDate"];
  for (let i = 0; i < fields.length; i++) {
    const ms = trustedMs(post && post[fields[i]], clock);
    if (ms) return ms;
  }
  return 0;
}

function postId(post) {
  return String((post && (post.id || post.statusId)) || "");
}

function compare(a, b, now) {
  const am = orderMs(a, now);
  const bm = orderMs(b, now);
  if (!am !== !bm) return am ? -1 : 1;
  if (am !== bm) return bm - am;
  const aid = postId(a);
  const bid = postId(b);
  return aid < bid ? 1 : aid > bid ? -1 : 0;
}

function key(post) {
  if (!post) return "";
  const platform = String(post.platform || "");
  const rawId = String(post.id || "");
  if (rawId.indexOf("repost:") === 0) return platform + ":" + rawId;
  const by = post.repostedBy;
  const reposter = String((by && by.handle) || "").replace(/^@/, "").toLowerCase();
  if (reposter && post.kind === "repost" && post.statusId && platform !== "youtube") {
    return platform + ":repost:" + reposter + ":" + String(post.statusId);
  }
  let raw = String(post.statusId || post.id || "");
  const url = String(post.url || "");
  if (platform === "instagram") {
    const match = (url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || raw.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (match) return platform + ":" + match;
  }
  if (platform === "threads") {
    const match = (url.match(/threads\.(?:com|net)\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/) || raw.match(/threads\.(?:com|net)\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (match) return platform + ":" + match;
  }
  if (platform === "youtube" || raw.indexOf("yt:video:") === 0) {
    if (raw.indexOf("yt:video:") === 0) raw = raw.split(":").pop();
    const found = (raw + " " + url).match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
    if (found) return "youtube:" + found[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return "youtube:" + raw;
  }
  return platform + ":" + raw;
}

function preferDate(left, right, now) {
  const clock = now == null ? Date.now() : now;
  const a = trustedMs(left, clock);
  const b = trustedMs(right, clock);
  if (a && b) return a <= b ? String(left) : String(right);
  if (a) return left == null ? "" : String(left);
  if (b) return right == null ? "" : String(right);
  return "";
}

function freshPosts(known, incoming, limit) {
  const cap = limit == null ? 40 : limit;
  const have = {};
  let oldest = 0;
  (known || []).forEach((post) => {
    const id = key(post);
    if (id) have[id] = true;
    const ms = orderMs(post);
    if (ms && (!oldest || ms < oldest)) oldest = ms;
  });
  const out = [];
  (incoming || []).forEach((post) => {
    const id = key(post);
    if (!id || have[id]) return;
    const ms = orderMs(post);
    if (!ms) return;
    if (oldest && ms < oldest) return;
    have[id] = true;
    out.push(post);
  });
  out.sort(compare);
  return cap < 0 ? out : out.slice(0, cap);
}

function pageSlice(sorted, cursor, size) {
  const list = Array.isArray(sorted) ? sorted : [];
  const n = Math.max(0, Number(size) || 25);
  const mark = cursor == null ? "" : String(cursor);
  let start = 0;
  if (mark) {
    let found = -1;
    for (let i = 0; i < list.length; i++) {
      if (postId(list[i]) === mark) {
        found = i;
        break;
      }
    }
    if (found < 0) return { items: [], cursor: "" };
    start = found + 1;
  }
  const items = list.slice(start, start + n);
  const last = items.length ? items[items.length - 1] : null;
  return { items: items, cursor: last ? postId(last) : "" };
}

function followHit(set, id) {
  const text = String(id || "").trim();
  return !!text && set.has(text.toLowerCase());
}

function followsPost(post, follows) {
  const set = new Set();
  (Array.isArray(follows) ? follows : []).forEach((id) => {
    const text = String(id || "").trim();
    if (text) set.add(text.toLowerCase());
  });
  if (!post || !set.size) return false;
  if (isRepost(post)) {
    const by = post.repostedBy || {};
    const platform = String(by.platform || post.platform || "x");
    const handle = String(by.handle || "").replace(/^@/, "");
    const channel = by.channelId ? platform + ":" + by.channelId : "";
    return followHit(set, by.feedId) || followHit(set, handle ? platform + ":" + handle : "") || followHit(set, channel) || followHit(set, post.feedId);
  }
  const platform = String(post.platform || "x");
  const handle = String(post.handle || "").replace(/^@/, "");
  const channel = post.channelId ? platform + ":" + post.channelId : "";
  return followHit(set, post.feedId) || followHit(set, handle ? platform + ":" + handle : "") || followHit(set, channel);
}

const api = {
  parseInstant: parseInstant,
  orderMs: orderMs,
  compare: compare,
  key: key,
  preferDate: preferDate,
  freshPosts: freshPosts,
  pageSlice: pageSlice,
  followsPost: followsPost
};

export {
  parseInstant,
  orderMs,
  compare,
  key,
  preferDate,
  freshPosts,
  pageSlice,
  followsPost
};
globalThis.FeedOrder = api;
