/* On-device For You. Same stages as the public home mixer: candidates,
   a weighted score, diversity filters, then a stable slate. No network,
   no model file. Signals stay in the caller's memory object. */

import { WEIGHTS as DEFAULTS } from "./for-you-weights.js";

const STORE_KEY = "viktorychapp-foryou-v1";

function emptyMemory() {
  return { authors: {}, hidden: {}, served: [], nextServed: [] };
}

function num(value) {
  const n = Number(value) || 0;
  return n > 0 ? n : 0;
}

function load(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return emptyMemory();
  try {
    const raw = JSON.parse(store.getItem(STORE_KEY) || "null");
    if (!raw || typeof raw !== "object") return emptyMemory();
    return {
      authors: raw.authors && typeof raw.authors === "object" ? raw.authors : {},
      hidden: raw.hidden && typeof raw.hidden === "object" ? raw.hidden : {},
      served: Array.isArray(raw.served) ? raw.served.map(String).slice(-400) : [],
      nextServed: Array.isArray(raw.nextServed) ? raw.nextServed.map(String).slice(-400) : []
    };
  } catch (err) {
    return emptyMemory();
  }
}

function save(memory, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!memory) return memory;
  const authors = {};
  Object.keys(memory.authors || {}).slice(-200).forEach((key) => {
    const row = memory.authors[key] || {};
    authors[key] = {
      like: num(row.like),
      repost: num(row.repost),
      reply: num(row.reply),
      negative: num(row.negative)
    };
  });
  const hidden = {};
  Object.keys(memory.hidden || {}).slice(-200).forEach((key) => { hidden[key] = 1; });
  memory.authors = authors;
  memory.hidden = hidden;
  memory.served = (memory.served || []).map(String).slice(-400);
  memory.nextServed = (memory.nextServed || []).map(String).slice(-400);
  if (store) {
    try { store.setItem(STORE_KEY, JSON.stringify(memory)); } catch (err) { /* this device only */ }
  }
  return memory;
}

function commitServed(memory, storage) {
  if (!memory) return memory;
  if (memory.nextServed && memory.nextServed.length) memory.served = memory.nextServed.slice(-400);
  return save(memory, storage);
}

function authorKey(post) {
  const by = post && post.repostedBy;
  if (by && by.handle) {
    return String(by.platform || (post && post.platform) || "x").toLowerCase() + ":" + String(by.handle).replace(/^@/, "").toLowerCase();
  }
  if (post && post.feedId) return String(post.feedId).toLowerCase();
  const handle = String((post && post.handle) || "").replace(/^@/, "").toLowerCase();
  return String((post && post.platform) || "x").toLowerCase() + ":" + handle;
}

function postId(post) {
  return String((post && (post.id || post.statusId)) || "");
}

function tokens(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9_]+/).filter((word) => word.length > 2);
}

function mediaKind(post) {
  if (!post) return "text";
  if (post.video || post.kind === "video" || (post.media && post.media.video)) return "video";
  const media = post.media;
  if (Array.isArray(media) && media.some((item) => item && (item.type === "video" || item.video))) return "video";
  if (Array.isArray(media) && media.length) return "image";
  if (post.image || (media && media.image)) return "image";
  return "text";
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function ageHours(post, now) {
  const ms = Date.parse((post && (post.date || post.sortDate)) || "");
  if (!ms) return 72;
  return Math.max(0, (now - ms) / 3600000);
}

function decayOf(post, now, weights) {
  const half = weights.decayHalfLifeHours || 18;
  return Math.exp(-ageHours(post, now) / half);
}

function authorNorms(posts) {
  const acc = {};
  posts.forEach((post) => {
    const key = authorKey(post);
    const stats = (post && post.stats) || {};
    const row = acc[key] || (acc[key] = { likes: 0, reposts: 0, replies: 0, n: 0 });
    row.likes += Number(stats.likes) || 0;
    row.reposts += Number(stats.reposts) || 0;
    row.replies += Number(stats.replies) || 0;
    row.n += 1;
  });
  const out = {};
  Object.keys(acc).forEach((key) => {
    const row = acc[key];
    const n = row.n || 1;
    out[key] = { likes: row.likes / n, reposts: row.reposts / n, replies: row.replies / n, n: n };
  });
  return out;
}

function interestBag(posts, ctx) {
  const bag = {};
  posts.forEach((post) => {
    const author = authorKey(post);
    const row = (ctx.memory.authors || {})[author] || {};
    const liked = (ctx.liked && ctx.liked(post)) || row.like > 0 || row.reply > 0;
    if (!liked) return;
    tokens(post.text).forEach((word) => { bag[word] = (bag[word] || 0) + 1; });
  });
  return bag;
}

function similar(post, bag) {
  let hits = 0;
  tokens(post.text).forEach((word) => { if (bag[word]) hits += 1; });
  return hits >= 2;
}

function textKey(post) {
  return authorKey(post) + "\n" + String((post && post.text) || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
}

function dedupe(posts) {
  const seenId = {};
  const seenText = {};
  const out = [];
  posts.forEach((post) => {
    if (!post) return;
    const id = postId(post);
    const text = textKey(post);
    if (id && seenId[id]) return;
    if (text.trim() && seenText[text]) return;
    if (id) seenId[id] = true;
    if (text.trim()) seenText[text] = true;
    out.push(post);
  });
  return out;
}

function scorePost(post, ctx, norms) {
  const weights = ctx.weights || DEFAULTS;
  const now = ctx.now || Date.now();
  const key = authorKey(post);
  const row = (ctx.memory.authors || {})[key] || {};
  const norm = norms[key] || { likes: 0, reposts: 0, replies: 0 };
  const stats = post.stats || {};
  const likes = Number(stats.likes) || 0;
  const reposts = Number(stats.reposts) || 0;
  const replies = Number(stats.replies) || 0;
  const rel = (likes + reposts + replies + 1) / ((norm.likes || 0) + (norm.reposts || 0) + (norm.replies || 0) + 1);
  const heat = rel <= 1 ? 0 : clamp01(Math.log(rel) / Math.log(8));
  const decay = decayOf(post, now, weights);
  const likedAuthor = num(row.like) > 0;
  const repliedAuthor = num(row.reply) > 0;
  const aff = clamp01(0.35 + Math.min(2, num(row.like) * 0.15 + num(row.repost) * 0.2 + num(row.reply) * 0.25) * 0.4);
  const media = mediaKind(post);
  const pLike = clamp01(decay * (0.2 + 0.6 * heat) * (likedAuthor ? 1.25 : 1) * (0.55 + aff));
  const pRepost = clamp01(pLike * (0.35 + (num(row.repost) > 0 ? 0.2 : 0)));
  const pReply = clamp01(decay * (0.04 + 0.3 * heat) * (repliedAuthor ? 1.4 : 1));
  const pAuthorReply = post.kind === "reply" && repliedAuthor ? clamp01(0.45 * decay) : clamp01(0.04 * decay * heat);
  const pProfile = clamp01(decay * (0.06 + (likedAuthor ? 0.2 : 0) + aff * 0.15));
  const replyNorm = (norm.replies || 0) * 3 + 1;
  const pConversation = clamp01(decay * Math.min(1, replies / replyNorm) * 0.45 + (post.kind === "reply" ? 0.12 * decay : 0));
  const long = String(post.text || "").length > 180 || media === "image";
  const read = ctx.read && ctx.read(post);
  const pDwell = clamp01((long ? 0.32 : 0.06) * decay + (read ? 0.2 : 0));
  const pVideo = media === "video" ? clamp01(0.4 * decay) : 0;
  const fatigue = weights.fatigueDrops || 3;
  const hidden = ctx.memory.hidden && ctx.memory.hidden[postId(post)];
  const pNeg = hidden ? 1 : clamp01((row.negative || 0) / fatigue);
  const pReport = ctx.reported && ctx.reported(post) ? 1 : 0;
  const score = weights.like * pLike
    + weights.repost * pRepost
    + weights.reply * pReply
    + weights.authorReply * pAuthorReply
    + weights.profileClick * pProfile
    + weights.conversationClick * pConversation
    + weights.longDwell * pDwell
    + weights.videoWatch * pVideo
    + weights.negative * pNeg
    + weights.report * pReport;
  return score;
}

function candidates(posts, ctx, bag) {
  const inn = [];
  const oon = [];
  const served = {};
  (ctx.memory.served || []).forEach((id) => { served[id] = true; });
  const pool = [];
  const already = [];
  posts.forEach((post) => {
    if (!post || (ctx.skip && ctx.skip(post))) return;
    const id = postId(post);
    if (id && ctx.memory.hidden && ctx.memory.hidden[id]) return;
    if (id && served[id] && !ctx.keepSeen) already.push(post);
    else pool.push(post);
  });
  const usable = pool.length >= 8 ? pool : pool.concat(already);
  usable.forEach((post) => {
    const author = authorKey(post);
    const row = (ctx.memory.authors || {})[author] || {};
    if ((row.negative || 0) >= (ctx.weights.fatigueDrops || 3)) return;
    if (ctx.followed && ctx.followed(post)) inn.push(post);
    else if (similar(post, bag)) oon.push(post);
  });
  const max = ctx.weights.maxPerAuthorCandidates || 4;
  return { inn: capAuthor(inn, max), oon: capAuthor(oon, max) };
}

function capAuthor(posts, max) {
  const groups = {};
  const order = [];
  posts.forEach((post) => {
    const key = authorKey(post);
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(post);
  });
  const out = [];
  order.forEach((key) => {
    groups[key].sort((a, b) => (Date.parse((b && (b.date || b.sortDate)) || "") || 0) - (Date.parse((a && (a.date || a.sortDate)) || "") || 0));
    groups[key].slice(0, max).forEach((post) => out.push(post));
  });
  return out;
}

function windowOk(out, item, weights) {
  const size = weights.windowSize || 20;
  const maxAuthor = weights.maxAuthorInWindow || 2;
  const maxRun = weights.maxAuthorRun || 2;
  const maxOon = Math.max(1, Math.round(size * (weights.oonShare || 0.15)));
  const start = Math.max(0, out.length - size);
  let authorN = 0;
  let run = 0;
  let oonN = 0;
  for (let i = out.length - 1; i >= 0 && run < maxRun; i--) {
    if (out[i].author !== item.author) break;
    run += 1;
  }
  for (let i = start; i < out.length; i++) {
    if (out[i].author === item.author) authorN += 1;
    if (out[i].oon) oonN += 1;
  }
  return run < maxRun && authorN < maxAuthor && (!item.oon || oonN < maxOon);
}

function select(scored, weights) {
  const left = scored.slice().sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = [];
  function take(pred) {
    let i = 0;
    while (i < left.length) {
      if (pred(left[i], out)) {
        out.push(left.splice(i, 1)[0]);
      } else i += 1;
    }
  }
  take((item) => windowOk(out, item, weights));
  take((item) => {
    const size = weights.windowSize || 20;
    const maxAuthor = weights.maxAuthorInWindow || 2;
    const maxOon = Math.max(1, Math.round(size * (weights.oonShare || 0.15)));
    const start = Math.max(0, out.length - size);
    let authorN = 0;
    let oonN = 0;
    for (let i = start; i < out.length; i++) {
      if (out[i].author === item.author) authorN += 1;
      if (out[i].oon) oonN += 1;
    }
    return authorN < maxAuthor && (!item.oon || oonN < maxOon);
  });
  return out;
}

function rank(posts, ctx) {
  const context = ctx || {};
  context.weights = context.weights || DEFAULTS;
  context.memory = context.memory || emptyMemory();
  context.now = context.now || Date.now();
  let source = posts || [];
  if (context.lite && source.length > 180) {
    source = source.slice().sort((a, b) => (Date.parse((b && (b.date || b.sortDate)) || "") || 0) - (Date.parse((a && (a.date || a.sortDate)) || "") || 0)).slice(0, 180);
  }
  const unique = dedupe(source);
  const bag = interestBag(unique, context);
  const pools = candidates(unique, context, bag);
  const norms = authorNorms(pools.inn.concat(pools.oon));
  const scored = [];
  pools.inn.forEach((post) => scored.push({ post: post, id: postId(post), author: authorKey(post), oon: false, score: scorePost(post, context, norms) }));
  pools.oon.forEach((post) => scored.push({ post: post, id: postId(post), author: authorKey(post), oon: true, score: scorePost(post, context, norms) }));
  const chosen = select(scored, context.weights);
  context.memory.nextServed = chosen.map((item) => item.id).filter(Boolean).slice(-400);
  return chosen.map((item) => item.post);
}

function chronological(posts, now) {
  const clock = now || Date.now();
  return (posts || []).slice().sort((a, b) => {
    const am = Date.parse((a && (a.date || a.sortDate)) || "") || 0;
    const bm = Date.parse((b && (b.date || b.sortDate)) || "") || 0;
    if (bm !== am) return bm - am;
    const aid = postId(a);
    const bid = postId(b);
    return aid < bid ? 1 : aid > bid ? -1 : 0;
  }).filter((post) => {
    const ms = Date.parse((post && (post.date || post.sortDate)) || "") || 0;
    return !ms || ms <= clock + 600000;
  });
}

function note(memory, post, kind) {
  const doc = memory || emptyMemory();
  if (!doc.authors) doc.authors = {};
  if (!doc.hidden) doc.hidden = {};
  const key = authorKey(post);
  const row = doc.authors[key] || (doc.authors[key] = { like: 0, repost: 0, reply: 0, negative: 0 });
  if (kind === "like") row.like += 1;
  else if (kind === "repost") row.repost += 1;
  else if (kind === "reply") row.reply += 1;
  else if (kind === "less") row.negative += 1;
  else if (kind === "hide") row.negative += 2;
  if ((kind === "less" || kind === "hide") && postId(post)) doc.hidden[postId(post)] = 1;
  return doc;
}

const api = {
  rank: rank,
  chronological: chronological,
  note: note,
  load: load,
  save: save,
  commitServed: commitServed,
  emptyMemory: emptyMemory,
  authorKey: authorKey,
  weights: DEFAULTS
};

export { rank, chronological, note, load, save, commitServed, emptyMemory, authorKey, DEFAULTS as weights };
globalThis.ForYou = api;
