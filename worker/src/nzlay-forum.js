/* NZlay forum, shown as an X-style Community.

   NZlay runs SocialEngine. Its pages answer `?format=html` with just the
   content block, but send no CORS headers and `cache-control: no-store`, so
   browsers cannot read them. This module reads those public pages for the
   app, parses them, and keeps the result only in the edge cache for a few
   minutes. Nothing is written to D1 or R2.

   The relay half lets someone who signed in to their own NZlay account post
   or reply from the app. It is stateless: the NZlay session cookie lives
   sealed on that person's device and comes along in the request body for
   one call; it is never stored, logged, or put in a URL here. A password
   only passes through on the sign-in call. NZlay's captcha, if it ever asks
   for one, is never answered here; the app sends the person to NZlay. */

export const NZLAY_ORIGIN = "https://nzlay.com";
export const FORUM_URL = NZLAY_ORIGIN + "/forums";
const UA = "ViktorychApp/1.0 (+https://viktorychgroup.github.io/ViktorychApp/; NZlay forum community, cached reads)";
const FEED_CACHE_S = 300;
const THREAD_CACHE_S = 120;
const MEMBERS_CACHE_S = 3600;
// Free Workers allow 50 subrequests a call: index + members + categories + this many topics.
const FEED_TOPICS_MAX = 24;
const CATEGORY_TOPICS_MAX = 25;
const TEXT_MAX = 4000;
const POST_MAX = 5000;
const TITLE_MAX = 120;
const COOKIE_MAX = 2000;
export const BANNER = NZLAY_ORIGIN + "/images/screenshots/BeGone_FreeOnlineGame_0.jpg";
export const ICON = NZLAY_ORIGIN + "/public/core_file/83/67ea8bdd7834066294e1421197f1f0d2.png";

/* ---------- text helpers ---------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", raquo: "»", laquo: "«", copy: "©" };
export function decode(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, code) => {
    const low = code.toLowerCase();
    if (low[0] === "#") {
      const n = low[1] === "x" ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
      if (!isFinite(n) || n <= 0 || n > 0x10ffff) return "";
      try { return String.fromCodePoint(n); } catch (err) { return ""; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, low) ? ENTITIES[low] : all;
  });
}
function strip(html) {
  return decode(String(html || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}
export function absUrl(src) {
  const raw = decode(String(src || "").trim());
  if (!raw || /^(data|javascript|blob):/i.test(raw)) return "";
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^http:\/\//i.test(raw)) return "https://" + raw.slice(7);
  if (/^\/\//.test(raw)) return "https:" + raw;
  if (raw[0] === "/") return NZLAY_ORIGIN + raw;
  return "";
}
/* "October 18, 2026 5:03 AM PDT" or "Sun, 18 Oct 2026 5:03:11 -0700". */
const ZONES = { PDT: "-0700", PST: "-0800", MDT: "-0600", MST: "-0700", CDT: "-0500", CST: "-0600", EDT: "-0400", EST: "-0500", UTC: "+0000", GMT: "+0000" };
export function parseWhen(text) {
  const clean = strip(text).replace(/\b(PDT|PST|MDT|MST|CDT|CST|EDT|EST|UTC|GMT)\b/, (z) => ZONES[z]);
  const t = Date.parse(clean);
  return isFinite(t) ? new Date(t).toISOString() : "";
}
function slugOf(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "topic";
}
function num(text) {
  const n = parseInt(String(text || "").replace(/[^\d]/g, ""), 10);
  return isFinite(n) ? n : 0;
}
function profileName(href) {
  const m = /\/profile\/([^"'?#/]+)/.exec(String(href || ""));
  if (!m) return "";
  try { return decodeURIComponent(m[1]).slice(0, 40); } catch (err) { return m[1].slice(0, 40); }
}

/* Balanced <tag>…</tag> blocks at the top level of html. */
function topBlocks(html, tag) {
  const out = [];
  const re = new RegExp("<(/?)" + tag + "\\b[^>]*>", "gi");
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1]) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push({ start, end: re.lastIndex, inner: html.slice(html.indexOf(">", start) + 1, m.index) });
        start = -1;
      }
    }
  }
  return out;
}
function cutBlocks(html, blocks) {
  let text = "";
  let at = 0;
  blocks.forEach((b) => { text += html.slice(at, b.start); at = b.end; });
  return text + html.slice(at);
}
function htmlText(html) {
  return decode(String(html || "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|pre)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, ""))
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* A post body: plain text, original-size images and links, the first quote
   (NZlay's "Name said:" blockquote, which is how a reply points at a post),
   and whether it was edited. */
export function bodyParts(html) {
  let src = String(html || "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  let edited = false;
  src = src.replace(/<i>\s*This post was edited by[\s\S]*?<\/i>/gi, () => { edited = true; return ""; });
  const quotes = topBlocks(src, "blockquote");
  let quote = null;
  if (quotes.length) {
    const inner = quotes[0].inner;
    const head = /^\s*<strong>\s*(?:<a[^>]*href="([^"]*)"[^>]*>)?([\s\S]*?)(?:<\/a>)?\s*said:\s*<\/strong>\s*(?:<br\s*\/?>)?/i.exec(inner);
    const name = head ? (profileName(head[1]) || strip(head[2])).slice(0, 40) : "";
    const rest = head ? inner.slice(head[0].length) : inner;
    const text = htmlText(cutBlocks(rest, topBlocks(rest, "blockquote"))).slice(0, 280);
    quote = { name, text };
  }
  const body = cutBlocks(src, quotes);
  const media = [];
  const seen = new Set();
  body.replace(/<img\b[^>]*>/gi, (tag) => {
    const s = /\ssrc\s*=\s*"([^"]+)"|\ssrc\s*=\s*'([^']+)'/i.exec(tag);
    const url = absUrl(s && (s[1] || s[2]));
    if (!url || /\/application\//.test(url) || seen.has(url) || media.length >= 4) return "";
    seen.add(url);
    const alt = /\salt\s*=\s*"([^"]*)"/i.exec(tag);
    media.push({ type: "image", url, alt: strip(alt && alt[1]).slice(0, 200) });
    return "";
  });
  const links = [];
  body.replace(/<(?:a|iframe)\b[^>]*\s(?:href|src)\s*=\s*"([^"]+)"/gi, (all, href) => {
    const url = absUrl(href);
    if (url && links.indexOf(url) < 0 && links.length < 10) links.push(url);
    return "";
  });
  return { text: htmlText(body).slice(0, TEXT_MAX), media, links, quote, edited };
}

/* ---------- page parsers ---------- */

export function parseIndex(html) {
  const out = [];
  const seen = new Set();
  String(html || "").split(/<li\b[^>]*>/i).forEach((chunk) => {
    const title = /class="forum_title"[\s\S]*?<a[^>]*href="\/forums\/(\d+)\/([^"\/?]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    if (!title || seen.has(title[1])) return;
    seen.add(title[1]);
    const posts = /class="forum_posts"[\s\S]*?<span>\s*([\d,]+)/i.exec(chunk);
    const topics = /class="forum_topics"[\s\S]*?<span>\s*([\d,]+)/i.exec(chunk);
    const last = /class="forum_lastpost_date[^"]*"[^>]*title="([^"]+)"/i.exec(chunk);
    const about = /class="forum_title"[\s\S]*?<\/h3>\s*<span>([\s\S]*?)<\/span>/i.exec(chunk);
    out.push({
      id: Number(title[1]),
      slug: slugOf(title[2]),
      title: strip(title[3]).slice(0, 80),
      about: strip(about && about[1]).slice(0, 200),
      posts: num(posts && posts[1]),
      topics: num(topics && topics[1]),
      lastAt: last ? parseWhen(last[1]) : ""
    });
  });
  return out;
}

export function parseCategory(html, categoryId) {
  const out = [];
  String(html || "").split(/<li\s+class="forum_nth_/i).slice(1).forEach((chunk) => {
    const head = /^\d+([^"]*)"/.exec(chunk);
    const title = /class="forum_topics_title"[\s\S]*?<a[^>]*href="\/forums\/topic\/(\d+)\/([^"\/?]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    if (!title) return;
    const views = /class="forum_topics_views"[\s\S]*?<span>\s*([\d,]+)/i.exec(chunk);
    const replies = /class="forum_topics_replies"[\s\S]*?<span>\s*([\d,]+)/i.exec(chunk);
    const lastBox = /class="forum_topics_lastpost"([\s\S]*?)class="forum_topics_views"/i.exec(chunk);
    const lb = lastBox ? lastBox[1] : "";
    const avatar = /<img[^>]*src="([^"]+)"[^>]*item_photo_user/i.exec(lb);
    const by = /href="(\/profile\/[^"]+)"/i.exec(lb);
    const when = /timestamp"[^>]*title="([^"]+)"/i.exec(lb);
    const lastPost = /post_id\/(\d+)/.exec(lb);
    out.push({
      id: Number(title[1]),
      slug: slugOf(title[2]),
      title: strip(title[3]).slice(0, TITLE_MAX),
      categoryId: Number(categoryId) || 0,
      sticky: /forum_sticky/.test(head ? head[1] : ""),
      views: num(views && views[1]),
      replies: num(replies && replies[1]),
      lastAt: when ? parseWhen(when[1]) : "",
      lastPostId: lastPost ? Number(lastPost[1]) : 0,
      lastBy: { name: profileName(by && by[1]), avatar: absUrl(avatar && avatar[1]) }
    });
  });
  return out;
}

export function parseTopic(html) {
  const src = String(html || "");
  const title = /class="forum_topic_title"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(src);
  const crumb = /<h2>[\s\S]*?href="\/forums\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i.exec(src);
  let pages = 1;
  src.replace(/class="forum_topic_pages"([\s\S]*?)<\/div>/gi, (all, box) => {
    box.replace(/[?&](?:amp;)?page=(\d+)/g, (a, n) => { pages = Math.max(pages, Number(n) || 1); return ""; });
    return "";
  });
  const posts = [];
  src.split(/<li\s+id="forum_post_/i).slice(1).forEach((chunk) => {
    const id = /^(\d+)"([^>]*)>/.exec(chunk);
    if (!id) return;
    const name = /class="forum_topic_posts_author_name"[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
    const photo = /class="forum_topic_posts_author_photo"[\s\S]*?<img[^>]*src="([^"]+)"/i.exec(chunk);
    const role = /class="forum_topic_posts_author_info_title"[^>]*>([\s\S]*?)<\/li>/i.exec(chunk);
    const count = /class="forum_topic_posts_author_info"[\s\S]*?(\d[\d,]*)\s*posts?\b/i.exec(chunk);
    const date = /class="forum_topic_posts_info_top_date"[^>]*>([\s\S]*?)<\/div>/i.exec(chunk);
    const bodyAt = chunk.search(/class="forum_topic_posts_info_body"[^>]*>/i);
    let body = "";
    if (bodyAt >= 0) {
      body = chunk.slice(chunk.indexOf(">", bodyAt) + 1);
      const end = /<\/div>\s*<\/div>\s*<\/li>[\s\S]*$/i.exec(body);
      if (end) body = body.slice(0, end.index);
      else body = body.replace(/<\/ul>[\s\S]*$/i, "");
    }
    const parts = bodyParts(body);
    posts.push({
      id: Number(id[1]),
      moderator: /forum_moderator_post/.test(id[2]),
      author: {
        name: (profileName(name && name[1]) || strip(name && name[2])).slice(0, 40),
        avatar: absUrl(photo && photo[1]),
        role: strip(role && role[1]).slice(0, 40),
        posts: num(count && count[1])
      },
      at: date ? parseWhen(date[1]) : "",
      text: parts.text,
      media: parts.media,
      links: parts.links,
      quote: parts.quote,
      edited: parts.edited
    });
  });
  return {
    title: strip(title && title[1]).slice(0, TITLE_MAX),
    category: crumb ? { id: Number(crumb[1]), title: strip(crumb[2]).slice(0, 80) } : null,
    pages,
    posts
  };
}

export function parseMembers(html) {
  const m = /(\d[\d,]*)\s+members?\b/i.exec(strip(html));
  return m ? num(m[1]) : 0;
}

/* ---------- forms and cookies (relay) ---------- */

export function hasCaptcha(html) {
  return /g-recaptcha|h-captcha|hcaptcha|recaptcha\/api|turnstile|name="captcha|id="captcha/i.test(String(html || ""));
}
function attr(tag, name) {
  const m = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
  return m ? decode(m[1] != null ? m[1] : m[2]) : null;
}
/* The first form on the page that matches `want`, with its hidden fields,
   text inputs and textareas. */
export function parseForm(html, want) {
  const src = String(html || "");
  const re = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
  let m;
  while ((m = re.exec(src))) {
    const form = m[0];
    if (want && !want.test(form)) continue;
    const open = /<form\b[^>]*>/i.exec(form)[0];
    const hidden = {};
    const inputs = [];
    form.replace(/<input\b[^>]*>/gi, (tag) => {
      const name = attr(tag, "name");
      if (!name) return "";
      const type = String(attr(tag, "type") || "text").toLowerCase();
      if (type === "hidden") hidden[name] = attr(tag, "value") || "";
      else inputs.push({ name, type, value: attr(tag, "value") || "", checked: /\schecked\b/i.test(tag) });
      return "";
    });
    const areas = [];
    form.replace(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi, (all, tag, value) => {
      const name = attr(tag, "name");
      if (name) areas.push({ name, value: decode(value) });
      return "";
    });
    const errors = [];
    form.replace(/<ul\s+class="form-errors"[^>]*>([\s\S]*?)<\/ul>/gi, (all, list) => {
      list.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (a, item) => { const t = strip(item.replace(/<ul[\s\S]*$/i, "")); if (t) errors.push(t.slice(0, 200)); return ""; });
      return "";
    });
    return {
      action: attr(open, "action") || "",
      id: attr(open, "id") || "",
      hidden,
      inputs,
      areas,
      errors,
      captcha: hasCaptcha(form),
      rich: /tinymce|tiny_mce|wysiwyg|richtext/i.test(src)
    };
  }
  return null;
}
export function formErrors(html) {
  const out = [];
  String(html || "").replace(/<ul\s+class="form-errors"[^>]*>([\s\S]*?)<\/ul>/gi, (all, list) => {
    list.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (a, item) => { const t = strip(item.replace(/<ul[\s\S]*$/i, "")); if (t) out.push(t.slice(0, 200)); return ""; });
    return "";
  });
  return out;
}
/* The sign-in form hides the email field under a random name and keeps a
   honeypot called "email" that must stay empty. */
export function loginFields(form, email, password) {
  if (!form) return null;
  const emailInput = form.inputs.find((i) => i.type === "email") || form.inputs.find((i) => /mail/i.test(i.name) && i.name !== "email");
  const passInput = form.inputs.find((i) => i.type === "password");
  if (!emailInput || !passInput) return null;
  const out = new URLSearchParams();
  Object.keys(form.hidden).forEach((k) => out.set(k, form.hidden[k]));
  form.inputs.forEach((i) => {
    if (i === emailInput) out.set(i.name, email);
    else if (i === passInput) out.set(i.name, password);
    else if (i.type === "checkbox") { if (/remember/i.test(i.name)) out.set(i.name, i.value || "1"); }
    else if (i.type === "submit") { /* added below */ }
    else if (i.name === "email") out.set("email", "");
  });
  if (!out.has("submit")) out.set("submit", "");
  return out;
}
const COOKIE_PAIR = /^[A-Za-z0-9_\-.]{1,64}=[^;\s,]{0,512}$/;
export function cleanCookie(value) {
  const text = String(value || "").trim();
  if (!text || text.length > COOKIE_MAX) return "";
  const pairs = text.split(/;\s*/).filter(Boolean);
  if (!pairs.length || pairs.some((p) => !COOKIE_PAIR.test(p))) return "";
  return pairs.join("; ");
}
function setCookies(res) {
  if (res.headers && typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const raw = res.headers && res.headers.get("set-cookie");
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_\-.]+=)/) : [];
}
export function mergeCookies(jar, res) {
  const map = new Map();
  String(jar || "").split(/;\s*/).filter(Boolean).forEach((p) => {
    const at = p.indexOf("=");
    if (at > 0) map.set(p.slice(0, at), p.slice(at + 1));
  });
  setCookies(res).forEach((line) => {
    const first = String(line).split(";")[0].trim();
    const at = first.indexOf("=");
    if (at <= 0) return;
    const name = first.slice(0, at);
    const value = first.slice(at + 1);
    if (!/^[A-Za-z0-9_\-.]{1,64}$/.test(name)) return;
    if (!value || value === "deleted" || /max-age=0|expires=thu, 01[- ]jan[- ]1970/i.test(line)) map.delete(name);
    else if (value.length <= 512 && !/[\s;,]/.test(value)) map.set(name, value);
  });
  return Array.from(map, ([k, v]) => k + "=" + v).join("; ");
}
/* Signed in when the page offers Sign Out; the name comes from the mini menu. */
export function viewerOf(html) {
  const src = String(html || "");
  const out = /href="[^"]*\/logout"/i.test(src) || /core_mini_profile/.test(src);
  if (!out) return null;
  const mine = /<a[^>]*href="([^"]*\/profile\/[^"]+)"[^>]*class="[^"]*core_mini_profile/i.exec(src) ||
    /<a[^>]*class="[^"]*core_mini_profile[^"]*"[^>]*href="([^"]*\/profile\/[^"]+)"/i.exec(src);
  const avatar = /class="[^"]*core_mini_profile[\s\S]{0,400}?<img[^>]*src="([^"]+)"/i.exec(src);
  return { name: profileName(mine && mine[1]), avatar: absUrl(avatar && avatar[1]) };
}
/* Plain text for the reply box, as NZlay's editor would save it. */
export function bodyHtml(text, rich) {
  const clean = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!rich) return clean;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return clean.split(/\n{2,}/).map((para) => "<p>" + esc(para).replace(/\n/g, "<br>") + "</p>").join("");
}

/* ---------- fetching ---------- */

async function nz(path, opts) {
  const o = opts || {};
  const headers = { "user-agent": UA, accept: "text/html,application/xhtml+xml" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers.origin = NZLAY_ORIGIN;
    headers.referer = o.referer || NZLAY_ORIGIN + path;
  }
  return fetch(NZLAY_ORIGIN + path, { method: o.form ? "POST" : "GET", headers, body: o.form ? o.form.toString() : undefined, redirect: o.follow ? "follow" : "manual" });
}
async function page(path) {
  try {
    const res = await nz(path, { follow: true });
    if (!res.ok) return "";
    return await res.text();
  } catch (err) { return ""; }
}
async function cached(key, ttl, make) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const req = new Request("https://nzlay-cache.internal/" + key);
  if (cache) {
    try {
      const hit = await cache.match(req);
      if (hit) return await hit.json();
    } catch (err) { /* no cache */ }
  }
  const value = await make();
  if (cache && value && value.ok) {
    try {
      await cache.put(req, new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + ttl } }));
    } catch (err) { /* no cache */ }
  }
  return value;
}
async function pool(list, size, work) {
  const out = new Array(list.length);
  let at = 0;
  async function lane() {
    while (at < list.length) {
      const i = at++;
      try { out[i] = await work(list[i]); } catch (err) { out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, lane));
  return out;
}
function starterOf(topic) {
  const first = topic && topic.posts && topic.posts[0];
  if (!first) return null;
  return { id: first.id, author: first.author, moderator: first.moderator, at: first.at, text: first.text.slice(0, 1200), media: first.media, links: first.links.slice(0, 4), edited: first.edited };
}
async function withStarters(topics) {
  const pages = await pool(topics, 6, (t) => page("/forums/topic/" + t.id + "/" + t.slug + "?format=html"));
  return topics.map((t, i) => {
    const parsed = parseTopic(pages[i]);
    return Object.assign({}, t, { starter: starterOf(parsed), url: FORUM_URL + "/topic/" + t.id + "/" + t.slug });
  });
}

let feedMemo = null;
let membersMemo = null;
const catMemo = new Map();
let threadMemo = new Map();
export function forgetForum() { feedMemo = null; membersMemo = null; catMemo.clear(); threadMemo = new Map(); }

async function members() {
  if (membersMemo && Date.now() - membersMemo.at < MEMBERS_CACHE_S * 1000) return membersMemo.value;
  const value = parseMembers(await page("/members?format=html"));
  if (value) membersMemo = { at: Date.now(), value };
  return value || (membersMemo ? membersMemo.value : 0);
}

async function feed() {
  if (feedMemo && Date.now() - feedMemo.at < 120 * 1000) return feedMemo.value;
  const value = await cached("nzlay-feed-v1", FEED_CACHE_S, async () => {
    const indexHtml = await page("/forums?format=html");
    const categories = parseIndex(indexHtml);
    if (!categories.length) return { ok: false };
    const [count, lists] = await Promise.all([
      members(),
      pool(categories, 6, (c) => page("/forums/" + c.id + "/" + c.slug + "?format=html").then((html) => parseCategory(html, c.id)))
    ]);
    const all = [];
    lists.forEach((list) => (list || []).forEach((t) => all.push(t)));
    all.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
    const topics = await withStarters(all.slice(0, FEED_TOPICS_MAX));
    return {
      ok: true,
      fetchedAt: Date.now(),
      forum: { title: "NZlay Forums", url: FORUM_URL, members: count, banner: BANNER, icon: ICON },
      categories,
      topics,
      more: Math.max(0, all.length - topics.length)
    };
  });
  if (value && value.ok) feedMemo = { at: Date.now(), value };
  return value && value.ok ? value : (feedMemo ? feedMemo.value : { ok: false });
}

async function category(id) {
  const memo = catMemo.get(id);
  if (memo && Date.now() - memo.at < 120 * 1000) return memo.value;
  const value = await cached("nzlay-cat-v1-" + id, FEED_CACHE_S, async () => {
    const base = await feed();
    const cat = base.ok ? base.categories.find((c) => c.id === id) : null;
    if (!cat) return { ok: false, missing: true };
    const list = parseCategory(await page("/forums/" + cat.id + "/" + cat.slug + "?format=html"), cat.id);
    const known = new Map((base.topics || []).map((t) => [t.id, t]));
    const need = list.slice(0, CATEGORY_TOPICS_MAX).filter((t) => !(known.get(t.id) && known.get(t.id).lastAt === t.lastAt && known.get(t.id).starter));
    const fresh = new Map((await withStarters(need)).map((t) => [t.id, t]));
    const topics = list.slice(0, CATEGORY_TOPICS_MAX).map((t) => fresh.get(t.id) || Object.assign({}, known.get(t.id), t, { starter: known.get(t.id).starter, url: known.get(t.id).url }));
    return { ok: true, fetchedAt: Date.now(), category: cat, topics };
  });
  if (value && value.ok) {
    if (catMemo.size > 20) catMemo.clear();
    catMemo.set(id, { at: Date.now(), value });
  }
  return value;
}

async function thread(id, pageNo) {
  const key = id + ":" + pageNo;
  const memo = threadMemo.get(key);
  if (memo && Date.now() - memo.at < 60 * 1000) return memo.value;
  const value = await cached("nzlay-thread-v1-" + id + "-" + pageNo, THREAD_CACHE_S, async () => {
    // Any slug works on NZlay's topic route; it redirects to the real one.
    const html = await page("/forums/topic/" + id + "/topic?format=html" + (pageNo > 1 ? "&page=" + pageNo : ""));
    const t = parseTopic(html);
    if (!t.posts.length) return { ok: false, missing: !!html };
    return { ok: true, fetchedAt: Date.now(), id, page: pageNo, pages: t.pages, title: t.title, category: t.category, url: FORUM_URL + "/topic/" + id + "/" + slugOf(t.title), posts: t.posts };
  });
  if (value && value.ok) {
    if (threadMemo.size > 200) threadMemo = new Map();
    threadMemo.set(key, { at: Date.now(), value });
  }
  return value;
}

/* ---------- relay ---------- */

/* After a reply, the next read of that thread page goes to NZlay again. */
async function forgetThread(id, pageNo) {
  if (!id) return;
  Array.from(threadMemo.keys()).forEach((k) => { if (k.indexOf(id + ":") === 0) threadMemo.delete(k); });
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (!cache) return;
  const pages = Array.from(new Set([1, Number(pageNo) > 0 ? Math.min(999, Math.floor(Number(pageNo))) : 1]));
  for (const n of pages) {
    try { await cache.delete(new Request("https://nzlay-cache.internal/nzlay-thread-v1-" + id + "-" + n)); } catch (err) { /* no cache */ }
  }
}

const NO_STORE = { "cache-control": "private, no-store" };

async function relayLogin(body, deps) {
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || email.length > 200 || !password || password.length > 200) return deps.json(400, { error: "bad_input" }, NO_STORE);
  let jar = "";
  const first = await nz("/login");
  jar = mergeCookies(jar, first);
  const html = await first.text();
  const form = parseForm(html, /user_form_login|name="password"/i);
  if (!form) return deps.json(200, { ok: false, result: "form_changed" }, NO_STORE);
  if (form.captcha) return deps.json(200, { ok: false, result: "captcha", url: NZLAY_ORIGIN + "/login" }, NO_STORE);
  const fields = loginFields(form, email, password);
  if (!fields) return deps.json(200, { ok: false, result: "form_changed" }, NO_STORE);
  const sent = await nz(form.action && form.action[0] === "/" ? form.action : "/login", { cookie: jar, form: fields, referer: NZLAY_ORIGIN + "/login" });
  jar = mergeCookies(jar, sent);
  if (sent.status >= 300 && sent.status < 400) {
    const who = await whoAmI(jar);
    if (who.viewer) return deps.json(200, { ok: true, result: "signed_in", session: who.jar, viewer: who.viewer }, NO_STORE);
    return deps.json(200, { ok: false, result: "rejected", errors: [] }, NO_STORE);
  }
  const back = await sent.text();
  if (hasCaptcha(back)) return deps.json(200, { ok: false, result: "captcha", url: NZLAY_ORIGIN + "/login" }, NO_STORE);
  const viewer = viewerOf(back);
  if (viewer && !/user_form_login/.test(back)) return deps.json(200, { ok: true, result: "signed_in", session: jar, viewer }, NO_STORE);
  return deps.json(200, { ok: false, result: "rejected", errors: formErrors(back).slice(0, 3) }, NO_STORE);
}

async function whoAmI(jar) {
  const res = await nz("/forums", { cookie: jar });
  const next = mergeCookies(jar, res);
  if (res.status !== 200) return { viewer: null, jar: next };
  return { viewer: viewerOf(await res.text()), jar: next };
}

async function relayMe(cookie, deps) {
  const who = await whoAmI(cookie);
  if (!who.viewer) return deps.json(200, { ok: false, result: "needs_login" }, NO_STORE);
  return deps.json(200, { ok: true, result: "signed_in", viewer: who.viewer, session: who.jar }, NO_STORE);
}

async function relayLogout(cookie, deps) {
  try { await nz("/logout", { cookie }); } catch (err) { /* the device forgets it anyway */ }
  return deps.json(200, { ok: true }, NO_STORE);
}

/* One reply or one new topic, sent through NZlay's own form. */
async function relayPost(kind, body, cookie, deps) {
  const text = String(body.text || "").trim();
  if (!text || text.length > POST_MAX) return deps.json(400, { error: "bad_text" }, NO_STORE);
  let path;
  let back;
  if (kind === "reply") {
    const topicId = Number(body.topicId);
    if (!Number.isInteger(topicId) || topicId <= 0) return deps.json(400, { error: "bad_topic" }, NO_STORE);
    const slug = slugOf(body.slug);
    const quote = Number(body.quoteId);
    path = "/forums/topic/" + topicId + "/" + slug + "/post-reply" + (Number.isInteger(quote) && quote > 0 ? "?quote_id=" + quote : "");
    back = FORUM_URL + "/topic/" + topicId + "/" + slug;
  } else {
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) return deps.json(400, { error: "bad_category" }, NO_STORE);
    const title = String(body.title || "").replace(/\s+/g, " ").trim();
    if (!title || title.length > TITLE_MAX) return deps.json(400, { error: "bad_title" }, NO_STORE);
    path = "/forums/" + categoryId + "/" + slugOf(body.slug) + "/topic-create";
    back = FORUM_URL + "/" + categoryId + "/" + slugOf(body.slug);
  }
  const got = await nz(path, { cookie });
  let jar = mergeCookies(cookie, got);
  if (got.status >= 300 && got.status < 400) {
    const where = got.headers.get("location") || "";
    return deps.json(200, { ok: false, result: /login/.test(where) || !(await whoAmI(jar)).viewer ? "needs_login" : "not_allowed", url: back }, NO_STORE);
  }
  if (got.status === 403 || got.status === 401) return deps.json(200, { ok: false, result: "not_allowed", url: back }, NO_STORE);
  if (got.status !== 200) return deps.json(200, { ok: false, result: "upstream", url: back }, NO_STORE);
  const html = await got.text();
  const form = parseForm(html, /<textarea\b/i);
  if (!form) return deps.json(200, { ok: false, result: viewerOf(html) ? "not_allowed" : "needs_login", url: back }, NO_STORE);
  if (form.captcha) return deps.json(200, { ok: false, result: "captcha", url: NZLAY_ORIGIN + path }, NO_STORE);
  const area = form.areas.find((a) => a.name === "body") || form.areas[0];
  const fields = new URLSearchParams();
  Object.keys(form.hidden).forEach((k) => fields.set(k, form.hidden[k]));
  form.inputs.forEach((i) => {
    if (i.type === "checkbox") { if (i.checked) fields.set(i.name, i.value || "1"); }
    else if (i.type === "text" && /title/i.test(i.name) && kind === "topic") fields.set(i.name, String(body.title).replace(/\s+/g, " ").trim());
    else if (i.type !== "submit" && i.type !== "button" && i.type !== "file" && i.type !== "text") fields.set(i.name, i.value);
  });
  // A reply to one post keeps NZlay's own "Name said:" quote at the top.
  const rich = form.rich || /<blockquote/i.test(area.value);
  const quoted = kind === "reply" && /<blockquote/i.test(area.value) ? area.value.trim() : "";
  fields.set(area.name, (quoted ? quoted + "\n" : "") + bodyHtml(text, rich));
  if (!fields.has("submit")) fields.set("submit", "");
  const action = form.action && form.action[0] === "/" ? form.action : path.split("?")[0];
  const sent = await nz(action, { cookie: jar, form: fields, referer: NZLAY_ORIGIN + path });
  jar = mergeCookies(jar, sent);
  if (sent.status >= 300 && sent.status < 400) {
    const where = sent.headers.get("location") || "";
    if (/\/login/.test(where)) return deps.json(200, { ok: false, result: "needs_login", url: back }, NO_STORE);
    const post = /post_id\/(\d+)/.exec(where);
    const topic = /\/forums\/topic\/(\d+)/.exec(where);
    await forgetThread(topic ? Number(topic[1]) : Number(body.topicId) || 0, body.page);
    return deps.json(200, { ok: true, result: "posted", postId: post ? Number(post[1]) : 0, topicId: topic ? Number(topic[1]) : Number(body.topicId) || 0, url: absUrl(where) || back, session: jar }, NO_STORE);
  }
  const after = await sent.text();
  if (hasCaptcha(after)) return deps.json(200, { ok: false, result: "captcha", url: NZLAY_ORIGIN + path }, NO_STORE);
  const errors = formErrors(after);
  if (errors.length) return deps.json(200, { ok: false, result: "rejected", errors: errors.slice(0, 3) }, NO_STORE);
  // Some forms answer 200 with the topic page itself after saving.
  if (sent.status === 200 && /forum_topic_posts/.test(after)) return deps.json(200, { ok: true, result: "posted", postId: 0, url: back, session: jar }, NO_STORE);
  return deps.json(200, { ok: false, result: "unknown", url: back }, NO_STORE);
}

/* Every relay answer is a 200 (or a 4xx for bad input), never a 5xx: the app
   moves a failed write to the backup Worker, and a reply NZlay already saved
   must not be sent twice. */
async function relay(request, env, path, deps) {
  if (request.method !== "POST") return deps.json(405, { error: "method" }, NO_STORE);
  const ip = deps.clientIp(request);
  const body = await deps.readJson(request, 12000) || {};
  if (body.error) return deps.json(400, { error: body.error }, NO_STORE);
  if (path === "/v1/nzlay/relay/login") {
    const paced = await deps.rateHit(env, "nz-login:" + ip, 8, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    try { return await relayLogin(body, deps); }
    catch (err) { return deps.json(200, { ok: false, result: "upstream" }, NO_STORE); }
  }
  const cookie = cleanCookie(body.session);
  if (!cookie) return deps.json(200, { ok: false, result: "needs_login" }, NO_STORE);
  try {
    if (path === "/v1/nzlay/relay/me") {
      const paced = await deps.rateHit(env, "nz-me:" + ip, 30, 60 * 60 * 1000);
      if (!paced.ok) return deps.limited(paced);
      return await relayMe(cookie, deps);
    }
    if (path === "/v1/nzlay/relay/logout") return await relayLogout(cookie, deps);
    if (path === "/v1/nzlay/relay/reply" || path === "/v1/nzlay/relay/topic") {
      // One post per tap on the device, and a ceiling here as well.
      const paced = await deps.rateHit(env, "nz-post:" + ip, 12, 60 * 60 * 1000);
      if (!paced.ok) return deps.limited(paced);
      return await relayPost(path.endsWith("/reply") ? "reply" : "topic", body, cookie, deps);
    }
  } catch (err) {
    return deps.json(200, { ok: false, result: "upstream" }, NO_STORE);
  }
  return deps.json(404, { error: "not_found" }, NO_STORE);
}

/* ---------- router ---------- */

const PUBLIC = { "cache-control": "public, max-age=60" };

export async function handleNzlay(request, env, path, url, deps) {
  if (path.startsWith("/v1/nzlay/relay/")) return relay(request, env, path, deps);
  if (request.method !== "GET") return null;
  if (path === "/v1/nzlay/forum") {
    const cat = Number(url.searchParams.get("category") || 0);
    if (cat) {
      if (!Number.isInteger(cat) || cat <= 0 || cat > 100000) return deps.json(400, { error: "bad_category" });
      const got = await category(cat);
      return deps.json(got.ok ? 200 : (got.missing ? 404 : 502), got.ok ? got : { ok: false }, got.ok ? PUBLIC : NO_STORE);
    }
    const got = await feed();
    return deps.json(got.ok ? 200 : 502, got.ok ? got : { ok: false }, got.ok ? PUBLIC : NO_STORE);
  }
  const m = /^\/v1\/nzlay\/forum\/topic\/(\d{1,9})$/.exec(path);
  if (m) {
    const n = Number(url.searchParams.get("page") || 1);
    const pageNo = Number.isInteger(n) && n > 0 && n < 1000 ? n : 1;
    const got = await thread(Number(m[1]), pageNo);
    return deps.json(got.ok ? 200 : (got.missing ? 404 : 502), got.ok ? got : { ok: false }, got.ok ? PUBLIC : NO_STORE);
  }
  return null;
}
