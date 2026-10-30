/* Newsletters as feeds.
   GET /v1/newsletter?url=<pasted link or feed URL>   find the feed, return the sender and recent issues
   GET /v1/newsletter?key=<feed key>                  the same from the stored copy
   GET /v1/newsletter/issue?key=&id=[&url=]           one issue as sanitized HTML

   Only public newsletter feeds (RSS/Atom) are read. Nothing about who reads
   them is stored: no user id, no subscription list, no email address. One R2
   object per feed (newsletter/<key>.json) keeps the parsed issues and their
   sanitized HTML; it is refreshed at most every 30 minutes when someone reads
   it and deleted by the cron 14 days after its last refresh. Images are
   hotlinked from the sender, never copied. */

import { safeTarget, feedCandidates, guessPaths, looksLikeFeed, feedLinks, parseFeed, sanitizeHtml, feedKey, itemKey, clip, textOf, extractArticle, archiveLinks } from "../../shared/newsletter-feed.js";

const UA = "Mozilla/5.0 (compatible; ViktorychReader/1.0; +https://viktorychgroup.github.io/ViktorychApp)";
const FRESH_MS = 30 * 60 * 1000;
export const NEWSLETTER_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_FEED = 5 * 1024 * 1024;
const MAX_PAGE = 400 * 1024;
const MAX_ITEMS = 20;
const MAX_ISSUE = 350 * 1024;
const PREFIX = "newsletter/";
const ALIAS = "newsletter-key/";
export const ALIAS_TTL_MS = 180 * 24 * 3600 * 1000;

function reply(status, body, maxAge) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? "public, max-age=" + maxAge : "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

async function readCapped(response, max) {
  if (!response.body || !response.body.getReader) return (await response.text()).slice(0, max);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    size += part.value.byteLength;
    if (size >= max) break;
  }
  try { reader.cancel(); } catch (_) {}
  const all = new Uint8Array(size);
  let at = 0;
  chunks.forEach((chunk) => { all.set(chunk, at); at += chunk.byteLength; });
  return new TextDecoder().decode(all);
}

/* GET with manual redirects so every hop is checked as a public URL. */
async function pull(raw, deps, max) {
  let url = safeTarget(raw);
  if (!url) return null;
  for (let hop = 0; hop < 5; hop += 1) {
    let response;
    try {
      response = await deps.fetch(url.href, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5", "accept-language": "en" },
        cf: { cacheTtl: 900, cacheEverything: true }
      });
    } catch (_) {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const next = safeTarget(new URL(response.headers.get("location") || "", url).href);
      if (!next) return null;
      url = next;
      continue;
    }
    if (!response.ok) return null;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (/^(image|video|audio)\//.test(type) || /octet-stream|pdf|zip/.test(type)) return null;
    const text = await readCapped(response, max || MAX_PAGE);
    return { url: url.href, type: type, text: text };
  }
  return null;
}

/* Find the feed behind a pasted newsletter link. */
export async function detectFeed(raw, deps) {
  let text = String(raw || "").trim();
  if (text && !/^https?:\/\//i.test(text)) text = "https://" + text.replace(/^\/+/, "");
  const start = safeTarget(text);
  if (!start) return { error: "bad_url" };
  const tried = new Set();
  const tryFeed = async (u) => {
    if (!u || tried.has(u) || tried.size >= 10) return null;
    tried.add(u);
    const got = await pull(u, deps, MAX_FEED);
    return got && looksLikeFeed(got.text) ? got : null;
  };
  for (const u of feedCandidates(start.href)) {
    const hit = await tryFeed(u);
    if (hit) return { feed: hit, page: null };
  }
  tried.add(start.href);
  const page = await pull(start.href, deps, MAX_FEED);
  if (page && looksLikeFeed(page.text)) return { feed: page, page: null };
  let meta = null;
  if (page) {
    meta = feedLinks(page.text, page.url);
    for (const u of feedCandidates(page.url).concat(meta.feeds.slice(0, 4))) {
      const hit = await tryFeed(u);
      if (hit) return { feed: hit, page: meta };
    }
  }
  for (const u of guessPaths((page && page.url) || start.href)) {
    const hit = await tryFeed(u);
    if (hit) return { feed: hit, page: meta };
  }
  /* No feed: read the web archive (Mailchimp campaign archives and sites with /p/, /posts/, /issues/ … links). */
  if (page) {
    let links = archiveLinks(page.text, page.url);
    let at = page.url;
    if (links.length < 3) {
      const origin = new URL(page.url).origin;
      for (const path of ["/archive", "/posts", "/newsletter"]) {
        if (tried.size >= 13) break;
        tried.add(origin + path);
        const more = await pull(origin + path, deps, MAX_FEED);
        const got = more ? archiveLinks(more.text, more.url) : [];
        if (got.length >= 3) { links = got; at = more.url; break; }
      }
    }
    if (links.length >= 3) return { archive: { url: at, items: links }, page: meta };
  }
  return { error: page ? "no_feed" : "unreachable" };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

async function buildDoc(feedUrl, xml, pageMeta, deps, now, archive) {
  const parsed = archive ? { profile: { title: (pageMeta && pageMeta.title) || "", description: "", site: new URL(feedUrl).origin, image: "" }, items: archive.items } : parseFeed(xml, feedUrl);
  const site = parsed.profile.site || ("https://" + hostOf(feedUrl));
  let meta = pageMeta;
  if (!parsed.profile.image && !(meta && meta.icon)) {
    const page = await pull(site, deps, MAX_PAGE);
    if (page) meta = feedLinks(page.text, page.url);
  }
  const host = hostOf(site) || hostOf(feedUrl);
  const avatar = parsed.profile.image || (meta && (meta.icon || meta.image)) || (host ? "https://" + host + "/favicon.ico" : "");
  const items = [];
  const seen = new Set();
  for (const item of parsed.items.slice(0, MAX_ITEMS)) {
    const id = await itemKey(feedUrl, item.guid);
    if (seen.has(id)) continue;
    seen.add(id);
    const clean = sanitizeHtml(item.html, item.link || site, 900 * 1024);
    items.push({
      id: id,
      title: item.title,
      link: item.link,
      date: item.date,
      author: item.author,
      excerpt: item.excerpt,
      image: item.image,
      html: clean.html.slice(0, MAX_ISSUE)
    });
  }
  return {
    v: 1,
    at: now,
    kind: archive ? "archive" : "feed",
    key: await feedKey(feedUrl),
    feed: feedUrl,
    profile: {
      name: parsed.profile.title || (meta && meta.title) || host,
      bio: parsed.profile.description,
      site: site,
      host: host,
      avatar: avatar
    },
    items: items
  };
}

function publicDoc(doc) {
  return {
    key: doc.key,
    feed: doc.feed,
    at: doc.at,
    profile: doc.profile,
    items: doc.items.map((item) => ({ id: item.id, title: item.title, link: item.link, date: item.date, author: item.author, excerpt: item.excerpt, image: item.image, long: (item.html || "").length > 600 }))
  };
}

async function readStored(store, key) {
  if (!store || !/^[a-z0-9-]{3,60}$/.test(key || "")) return null;
  try {
    const obj = await store.get(PREFIX + key + ".json");
    if (!obj) return null;
    const doc = JSON.parse(await obj.text());
    return doc && doc.v === 1 && Array.isArray(doc.items) ? doc : null;
  } catch (_) {
    return null;
  }
}

async function writeStored(store, doc, deps, fresh) {
  if (!store) return;
  const jobs = [store.put(PREFIX + doc.key + ".json", JSON.stringify(doc), { httpMetadata: { contentType: "application/json" } }).catch(() => null)];
  /* A tiny key -> feed URL alias outlives the copy, so a followed key keeps working on every device. */
  if (fresh) jobs.push(store.put(ALIAS + doc.key + ".txt", doc.feed, { httpMetadata: { contentType: "text/plain" } }).catch(() => null));
  const job = Promise.all(jobs);
  if (deps.waitUntil) deps.waitUntil(job); else await job;
}

async function readAlias(store, key) {
  if (!store || !/^[a-z0-9-]{3,60}$/.test(key || "")) return "";
  try {
    const obj = await store.get(ALIAS + key + ".txt");
    const feed = obj ? String(await obj.text()).trim() : "";
    return safeTarget(feed) ? feed : "";
  } catch (_) {
    return "";
  }
}

/* The stored doc when fresh, else a refetch of the feed (or a detect for a pasted page). */
async function loadDoc(params, deps) {
  const now = deps.now ? deps.now() : Date.now();
  const raw = params.url;
  const wantKey = params.key;
  let stored = null;
  if (raw) {
    const direct = safeTarget(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (!direct) return { error: "bad_url" };
    stored = await readStored(deps.r2, await feedKey(direct.href));
  } else if (wantKey) {
    stored = await readStored(deps.r2, wantKey);
    if (!stored) {
      const feed = await readAlias(deps.r2, wantKey);
      if (!feed) return { error: "not_found" };
      return loadDoc({ url: feed }, deps);
    }
  } else return { error: "bad_url" };
  if (stored && now - stored.at < FRESH_MS) return { doc: stored };
  let found;
  if (stored) {
    const got = await pull(stored.feed, deps, MAX_FEED);
    if (stored.kind === "archive") {
      const items = got ? archiveLinks(got.text, got.url) : [];
      found = items.length ? { archive: { url: stored.feed, items: items }, page: got ? feedLinks(got.text, got.url) : null } : null;
    } else found = got && looksLikeFeed(got.text) ? { feed: got, page: null } : null;
    if (!found) return { doc: stored, stale: true };
  } else {
    found = await detectFeed(raw, deps);
    if (found.error) return found;
  }
  /* A stored feed keeps its URL even when the site now redirects, so one feed maps to one key. */
  const feedUrl = stored ? stored.feed : (found.archive ? found.archive.url : found.feed.url);
  const doc = await buildDoc(feedUrl, found.feed ? found.feed.text : "", found.page, deps, now, found.archive || null);
  if (stored) {
    /* Keep full issues already read from their pages. */
    const old = new Map(stored.items.map((row) => [row.id, row]));
    doc.items.forEach((row) => {
      const was = old.get(row.id);
      if (was && was.full && was.html) { row.html = was.html; row.full = true; }
    });
  }
  if (!doc.items.length && !stored) return { error: "empty" };
  await writeStored(deps.r2, doc, deps, !stored || now - stored.at > 24 * 3600 * 1000);
  return { doc: doc };
}

export async function handleNewsletter(request, deps) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== "GET") return reply(405, { error: "method" });
  const params = { url: clip(url.searchParams.get("url") || "", 2000), key: String(url.searchParams.get("key") || "").toLowerCase() };
  if (path === "/v1/newsletter/issue") {
    const id = String(url.searchParams.get("id") || "");
    if (!/^[a-f0-9]{16}$/.test(id)) return reply(400, { error: "bad_id" });
    const cacheReq = new Request("https://newsletter.cache/issue/" + (params.key || "") + "/" + id);
    if (deps.cache) {
      const hit = await deps.cache.match(cacheReq);
      if (hit) return hit;
    }
    let got = params.key ? { doc: await readStored(deps.r2, params.key) } : { doc: null };
    if (!got.doc && params.url) got = await loadDoc(params, deps);
    if (!got.doc) return reply(404, { error: "not_found" });
    let item = got.doc.items.find((row) => row.id === id);
    if (!item && params.url) {
      const fresh = await loadDoc({ url: got.doc.feed }, deps);
      item = fresh.doc && fresh.doc.items.find((row) => row.id === id);
    }
    if (!item) return reply(404, { error: "gone" });
    /* Feeds with excerpts only (Beehiiv, some Ghost, archives): read the issue page once. */
    if (!item.full && item.link && textOf(item.html || "").length < 400) {
      const page = await pull(item.link, deps, MAX_FEED);
      const body = page && /html/.test(page.type || "text/html") ? extractArticle(page.text) : "";
      const clean = body ? sanitizeHtml(body, page.url, 900 * 1024).html.slice(0, MAX_ISSUE) : "";
      if (clean && textOf(clean).length > textOf(item.html || "").length) {
        item.html = clean;
        item.full = true;
        if (!item.image) item.image = (feedLinks(page.text, page.url).image || "");
        await writeStored(deps.r2, got.doc, deps);
      }
    }
    const res = reply(200, { id: item.id, title: item.title, link: item.link, date: item.date, author: item.author, image: item.image, html: item.html }, 6 * 3600);
    if (deps.cache) await deps.cache.put(cacheReq, res.clone());
    return res;
  }
  if (path !== "/v1/newsletter") return reply(404, { error: "not_found" });
  if (!params.url && !params.key) return reply(400, { error: "bad_url" });
  const cacheReq = new Request("https://newsletter.cache/feed/" + encodeURIComponent(params.key || params.url));
  if (deps.cache) {
    const hit = await deps.cache.match(cacheReq);
    if (hit) return hit;
  }
  let got;
  try { got = await loadDoc(params, deps); } catch (_) { got = { error: "unreachable" }; }
  if (got.error) return reply(got.error === "bad_url" ? 400 : got.error === "not_found" ? 404 : 422, { error: got.error }, got.error === "bad_url" ? 0 : 600);
  const res = reply(200, publicDoc(got.doc), got.stale ? 300 : 900);
  if (deps.cache) await deps.cache.put(cacheReq, res.clone());
  return res;
}

/* Cron: delete feed copies nobody refreshed for 14 days. */
export async function sweepNewsletters(store, now) {
  if (!store || !store.list) return 0;
  let gone = 0;
  for (const [prefix, ttl] of [[PREFIX, NEWSLETTER_TTL_MS], [ALIAS, ALIAS_TTL_MS]]) {
    gone += await sweepPrefix(store, prefix, ttl, now);
  }
  return gone;
}

async function sweepPrefix(store, prefix, ttl, now) {
  let gone = 0;
  let cursor;
  for (let page = 0; page < 3; page += 1) {
    const list = await store.list({ prefix: prefix, limit: 500, cursor: cursor });
    const old = (list.objects || []).filter((obj) => obj.uploaded && now - new Date(obj.uploaded).getTime() > ttl).map((obj) => obj.key);
    if (old.length) {
      await store.delete(old);
      gone += old.length;
    }
    if (!list.truncated) break;
    cursor = list.cursor;
  }
  return gone;
}
