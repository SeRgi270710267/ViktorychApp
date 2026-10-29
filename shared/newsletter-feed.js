/* Newsletters as feeds. Pure helpers shared by the Worker and the tests.
   - feedCandidates: likely RSS/Atom URLs for a pasted newsletter link
     (Substack, Beehiiv, Buttondown, Ghost, Medium, Mailchimp archives,
     WordPress and any site that links its feed).
   - feedLinks: <link rel="alternate"> feeds and icons in an HTML page.
   - parseFeed: RSS 2.0, RSS 1.0 (RDF) and Atom into a small plain object.
   - sanitizeHtml: an allowlist rewrite of an issue. Scripts, styles, forms,
     frames, event handlers, inline styles and tracking pixels are removed;
     media stays hotlinked (only https). */

import { decodeEntities, safeTarget } from "./unfurl-meta.js";

export { safeTarget };

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const body = String(tag).replace(/^<\s*\/?\s*[a-zA-Z][-a-zA-Z0-9:]*/, "").replace(/\/?>$/, "");
  let m;
  while ((m = re.exec(body))) {
    const key = m[1].toLowerCase();
    if (out[key] == null) out[key] = decodeEntities(m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] || "");
  }
  return out;
}

function absolute(value, base) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim(), base || undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function https(value, base) {
  const url = absolute(value, base);
  if (!url) return "";
  return url.replace(/^http:\/\//i, "https://");
}

export function clip(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

/* Feed URLs worth trying for a pasted link, best first. */
export function feedCandidates(raw) {
  const url = safeTarget(raw);
  if (!url) return [];
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean);
  const out = [];
  const add = (u) => { if (u && out.indexOf(u) < 0) out.push(u); };
  if (/(^|\.)substack\.com$/.test(host)) {
    if (host === "substack.com" && seg[0] && seg[0][0] === "@") add("https://substack.com/" + seg[0] + "/feed");
    else if (host !== "substack.com") add("https://" + host + "/feed");
  }
  if (host === "medium.com") {
    if (seg[0] && seg[0][0] === "@") add("https://medium.com/feed/" + seg[0]);
    else if (seg[0] && seg[0] !== "feed") add("https://medium.com/feed/" + seg[0]);
  } else if (/\.medium\.com$/.test(host)) add("https://" + host + "/feed");
  if (host === "buttondown.com" || host === "buttondown.email") {
    const user = seg[0] === "archive" ? "" : seg[0];
    if (user) add("https://buttondown.com/" + user + "/rss");
  }
  if (/(^|\.)campaign-archive\d*\.com$/.test(host) || /(^|\.)list-manage\.com$/.test(host)) {
    const u = url.searchParams.get("u") || url.searchParams.get(" u") || url.searchParams.get("+u");
    const id = url.searchParams.get("id");
    const dc = (host.match(/(us\d+)\./) || [])[1];
    if (dc && u && id && /^[a-f0-9]{6,40}$/i.test(u) && /^[a-f0-9]{6,20}$/i.test(id)) {
      add("https://" + dc + ".campaign-archive.com/feed?u=" + u + "&id=" + id);
      add("https://" + dc + ".campaign-archive.com/archive/rss/?u=" + u + "&id=" + id);
    }
  }
  if (host === "rss.beehiiv.com") add(url.href);
  return out;
}

/* Common paths when a page links no feed. */
export function guessPaths(pageUrl) {
  let origin = "";
  try { origin = new URL(pageUrl).origin; } catch (_) { return []; }
  return ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml"].map((p) => origin + p);
}

export function looksLikeFeed(text) {
  const head = String(text || "").slice(0, 4000).replace(/<!--[\s\S]*?-->/g, "");
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head) && !/<html[\s>]/i.test(head.slice(0, 600));
}

export function feedLinks(html, pageUrl) {
  const head = String(html || "").slice(0, 400000);
  const feeds = [];
  let icon = "";
  let touch = "";
  let image = "";
  let title = "";
  (head.match(/<link\b[^>]*>/gi) || []).forEach((tag) => {
    const a = attrs(tag);
    const rel = String(a.rel || "").toLowerCase();
    const type = String(a.type || "").toLowerCase();
    if (/\balternate\b/.test(rel) && /(rss|atom)\+xml|application\/feed\+json|text\/xml|application\/xml/.test(type)) {
      if (/comments/i.test(a.title || "") || /\/comments\/feed/i.test(a.href || "")) return;
      const u = absolute(a.href, pageUrl);
      if (u && /json/.test(type) === false && feeds.indexOf(u) < 0) feeds.push(u);
    }
    if (/apple-touch-icon/.test(rel) && !touch) touch = https(a.href, pageUrl);
    if (/(^|\s)icon(\s|$)/.test(rel) && !icon && !/\.svg(\?|$)/i.test(a.href || "")) icon = https(a.href, pageUrl);
  });
  (head.match(/<meta\b[^>]*>/gi) || []).forEach((tag) => {
    const a = attrs(tag);
    const key = String(a.property || a.name || "").toLowerCase();
    if (key === "og:image" && !image) image = https(a.content, pageUrl);
    if ((key === "og:site_name") && !title) title = clip(a.content, 120);
  });
  return { feeds: feeds, icon: touch || icon, image: image, title: title };
}

/* ---------- XML ---------- */

function cdata(text) {
  return String(text || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (all, inner) => inner);
}

function stripCdataAware(value) {
  const s = String(value || "");
  if (/<!\[CDATA\[/.test(s)) return cdata(s);
  return decodeEntities(s);
}

function tagRe(name) {
  const n = name.replace(/[:.]/g, (c) => "\\" + c);
  return new RegExp("<" + n + "(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</" + n + "\\s*>)", "i");
}

function first(block, names) {
  for (let i = 0; i < names.length; i++) {
    const m = block.match(tagRe(names[i]));
    if (m && m[2] != null && m[2].trim()) return stripCdataAware(m[2]).trim();
  }
  return "";
}

function firstTag(block, name) {
  const m = block.match(tagRe(name));
  return m ? { attrs: attrs("<x" + (m[1] || "") + ">"), body: m[2] || "" } : null;
}

function allTags(block, name) {
  const n = name.replace(/[:.]/g, (c) => "\\" + c);
  const re = new RegExp("<" + n + "(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</" + n + "\\s*>)", "gi");
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push({ attrs: attrs("<x" + (m[1] || "") + ">"), body: m[2] || "" });
  return out;
}

export function textOf(html) {
  return decodeEntities(String(html || "")
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dateOf(value) {
  const t = Date.parse(String(value || "").trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

function firstImage(html, base) {
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const a = attrs(m[0]);
    const src = https(a.src || a["data-src"], base);
    if (!src || isTracker(src, a)) continue;
    const w = parseInt(a.width, 10);
    if (w && w < 120) continue;
    return src;
  }
  return "";
}

export function parseFeed(xml, feedUrl) {
  const text = String(xml || "").slice(0, 6 * 1024 * 1024);
  const isAtom = /<feed[\s>]/i.test(text.slice(0, 3000)) && !/<rss[\s>]/i.test(text.slice(0, 3000));
  const blocks = isAtom ? (text.match(/<entry[\s>][\s\S]*?<\/entry\s*>/gi) || []) : (text.match(/<item[\s>][\s\S]*?<\/item\s*>/gi) || []);
  const headEnd = text.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i);
  const head = headEnd > 0 ? text.slice(0, headEnd) : text.slice(0, 20000);
  let site = "";
  if (isAtom) {
    const links = allTags(head, "link");
    const alt = links.find((l) => !l.attrs.rel || l.attrs.rel === "alternate");
    site = alt ? absolute(alt.attrs.href, feedUrl) : "";
  } else {
    const m = head.match(/<link>([\s\S]*?)<\/link>/i);
    site = m ? absolute(stripCdataAware(m[1]).trim(), feedUrl) : "";
  }
  const imageBlock = firstTag(head, "image");
  const itunes = firstTag(head, "itunes:image");
  const channelImage = https((imageBlock && first(imageBlock.body, ["url"])) || (itunes && itunes.attrs.href) || first(head, ["logo", "icon"]), feedUrl);
  const profile = {
    title: clip(first(head, ["title"]), 160),
    description: clip(textOf(first(head, ["description", "subtitle", "tagline"])), 400),
    site: site,
    image: channelImage
  };
  const items = blocks.slice(0, 40).map((block) => {
    let link = "";
    if (isAtom) {
      const links = allTags(block, "link");
      const alt = links.find((l) => !l.attrs.rel || l.attrs.rel === "alternate") || links[0];
      link = alt ? absolute(alt.attrs.href, feedUrl) : "";
    } else {
      const m = block.match(/<link>([\s\S]*?)<\/link>/i);
      link = m ? absolute(stripCdataAware(m[1]).trim(), feedUrl) : "";
    }
    const guid = first(block, ["guid", "id"]) || link || first(block, ["title"]);
    const html = first(block, ["content:encoded", "content", "description", "summary", "media:description"]);
    const summary = first(block, ["description", "summary"]);
    const author = textOf(first(block, ["dc:creator", "author"])).replace(/\s+/g, " ").trim();
    const enclosure = allTags(block, "enclosure").find((e) => /^image\//i.test(e.attrs.type || ""));
    const media = allTags(block, "media:content").find((e) => /^image/i.test(e.attrs.medium || e.attrs.type || "image")) || firstTag(block, "media:thumbnail");
    const image = https((enclosure && enclosure.attrs.url) || (media && media.attrs.url), link || feedUrl) || firstImage(html, link || feedUrl);
    return {
      guid: String(guid || "").slice(0, 500),
      title: clip(textOf(first(block, ["title"])), 300),
      link: link,
      date: dateOf(first(block, ["pubDate", "published", "dc:date", "updated"])),
      author: clip(author, 120),
      excerpt: clip(textOf(summary && summary !== html ? summary : html), 280),
      image: image,
      html: html
    };
  }).filter((item) => item.guid && (item.title || item.html));
  return { profile: profile, items: items };
}

/* ---------- sanitizer ---------- */

const DROP_WITH_BODY = /^(script|style|noscript|template|iframe|object|embed|applet|form|textarea|select|button|svg|math|head|title|canvas|audio|frameset|frame|link|meta|base)$/;
const ALLOWED = {
  a: ["href", "title"], p: [], br: [], hr: [], b: [], strong: [], i: [], em: [], u: [], s: [], del: [], ins: [], mark: [], small: [], sub: [], sup: [], code: [], pre: [], kbd: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], blockquote: ["cite"], q: [], cite: [], ul: [], ol: ["start"], li: [], dl: [], dt: [], dd: [],
  img: ["src", "alt", "title", "width", "height"], figure: [], figcaption: [], picture: [], source: ["srcset", "type", "media"], video: ["src", "poster", "controls"],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], caption: [],
  div: [], span: [], section: [], article: [], header: [], footer: [], center: [], font: [], abbr: ["title"], time: ["datetime"]
};
const VOID = { br: 1, hr: 1, img: 1, source: 1 };
const TRACKER = /^https?:\/\/(pixel|beacon|open|track(ing)?|t|trk|clicks?|links?)\.|\/(open|track|trk|pixel|beacon|wf\/open|e\/o|ci\/open|e2t\/to)(\/|\.gif|\.png|\?|$)|\/o\.gif|list-manage\.com\/track|mailchimp\.com\/track|email\.mg\.|sendgrid\.net\/wf|\/api\/v1\/open|substack\.com\/o\/|cdn\.substack\.com\/open|beehiiv\.com\/(open|track)|convertkit-mail\d*\.com\/o|ct\.sendgrid|mandrillapp\.com\/track|hubspotlinks|\.gif\?.*(uid|u|e|id)=|google-analytics\.com|doubleclick\.net|facebook\.com\/tr/i;

export function isTracker(src, a) {
  const w = parseInt((a && a.width) || "", 10);
  const h = parseInt((a && a.height) || "", 10);
  if ((w && w <= 3) || (h && h <= 3)) return true;
  const style = String((a && a.style) || "").replace(/\s+/g, "").toLowerCase();
  if (/display:none|visibility:hidden|(^|;)(width|height):[0-3]px|max-height:0|opacity:0/.test(style)) return true;
  return TRACKER.test(String(src || ""));
}

function escAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanText(text) {
  return String(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeHref(value, base) {
  const v = String(value || "").trim();
  if (/^mailto:/i.test(v)) return /^mailto:[^\s"'<>]{3,200}$/i.test(v) ? v : "";
  if (/^#/.test(v)) return "";
  return absolute(v, base);
}

function safeSrcset(value, base) {
  return String(value || "").split(",").map((part) => {
    const bits = part.trim().split(/\s+/);
    const u = https(bits[0], base);
    return u ? [u].concat(bits.slice(1, 2).filter((d) => /^\d+(\.\d+)?[wx]$/.test(d))).join(" ") : "";
  }).filter(Boolean).join(", ");
}

/* Returns { html, images } where html is safe to insert as markup. */
export function sanitizeHtml(input, base, maxBytes) {
  const src = cdata(String(input || "")).slice(0, maxBytes || 600000)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  const out = [];
  const stack = [];
  let images = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
  let at = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > at) out.push(cleanText(src.slice(at, m.index)));
    at = re.lastIndex;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (DROP_WITH_BODY.test(name)) {
      if (!closing && !m[4] && !/^(link|meta|base|source)$/.test(name)) {
        const end = new RegExp("</" + name + "\\s*>", "i");
        const rest = src.slice(at);
        const e = rest.search(end);
        if (e >= 0) {
          const tail = rest.slice(e).match(end)[0];
          at += e + tail.length;
        } else at = src.length;
        re.lastIndex = at;
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, name)) continue;
    if (closing) {
      if (VOID[name]) continue;
      const idx = stack.lastIndexOf(name);
      if (idx < 0) continue;
      while (stack.length > idx) out.push("</" + stack.pop() + ">");
      continue;
    }
    const a = attrs("<x" + m[3] + ">");
    const keep = [];
    if (name === "img") {
      const s = https(a.src || a["data-src"], base);
      if (!s || isTracker(s, a)) continue;
      keep.push('src="' + escAttr(s) + '"');
      if (a.alt) keep.push('alt="' + escAttr(clip(a.alt, 300)) + '"');
      const w = parseInt(a.width, 10);
      const h = parseInt(a.height, 10);
      if (w > 0 && w < 5000) keep.push('width="' + w + '"');
      if (h > 0 && h < 5000) keep.push('height="' + h + '"');
      keep.push('loading="lazy" decoding="async" referrerpolicy="no-referrer"');
      images += 1;
    } else if (name === "a") {
      const href = safeHref(a.href, base);
      if (href) keep.push('href="' + escAttr(href) + '" target="_blank" rel="noopener noreferrer nofollow"');
      if (a.title) keep.push('title="' + escAttr(clip(a.title, 200)) + '"');
    } else if (name === "source") {
      const set = safeSrcset(a.srcset, base);
      if (!set) continue;
      keep.push('srcset="' + escAttr(set) + '"');
      if (a.type && /^image\/[a-z0-9.+-]+$/i.test(a.type)) keep.push('type="' + escAttr(a.type) + '"');
    } else if (name === "video") {
      const s = https(a.src, base);
      const p = https(a.poster, base);
      if (s) keep.push('src="' + escAttr(s) + '"');
      if (p) keep.push('poster="' + escAttr(p) + '"');
      keep.push('controls preload="none" playsinline');
    } else {
      ALLOWED[name].forEach((key) => {
        if (a[key] == null) return;
        if (key === "colspan" || key === "rowspan" || key === "start") {
          const n = parseInt(a[key], 10);
          if (n > 0 && n < 100) keep.push(key + '="' + n + '"');
        } else if (key === "cite") {
          const u = absolute(a[key], base);
          if (u) keep.push('cite="' + escAttr(u) + '"');
        } else keep.push(key + '="' + escAttr(clip(a[key], 200)) + '"');
      });
    }
    out.push("<" + name + (keep.length ? " " + keep.join(" ") : "") + ">");
    if (!VOID[name] && !m[4]) stack.push(name);
    else if (!VOID[name] && m[4]) out.push("</" + name + ">");
    if (stack.length > 200) break;
  }
  if (at < src.length) out.push(cleanText(src.slice(at)));
  while (stack.length) out.push("</" + stack.pop() + ">");
  let html = out.join("")
    .replace(/<(p|div|span|td|section)>\s*(?:&nbsp;|\u00a0|\s)*<\/\1>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
  return { html: html, images: images };
}

/* A short stable key for a feed: readable host slug plus a hash. */
export async function feedKey(feedUrl) {
  const data = new TextEncoder().encode(String(feedUrl));
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash)).slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
  let host = "";
  try { host = new URL(feedUrl).hostname.replace(/^www\./, ""); } catch (_) {}
  const slug = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "news";
  return slug + "-" + hex;
}

export async function itemKey(feedUrl, guid) {
  const data = new TextEncoder().encode(String(feedUrl) + "\n" + String(guid));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- web pages ---------- */

/* The outer HTML of the element whose opening tag starts at `start`. */
function elementAt(html, start) {
  const open = html.slice(start).match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  if (!open) return "";
  const name = open[1].toLowerCase();
  const re = new RegExp("<(/?)" + name + "\\b[^>]*?(/?)>", "gi");
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) depth -= 1;
    else if (!m[2]) depth += 1;
    if (depth <= 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}

const BODY_MARKERS = [
  /<div\b[^>]*\bid=["']content-blocks["']/i,
  /<div\b[^>]*\bclass=["'][^"']*\bbody markup\b/i,
  /<(div|section)\b[^>]*\bclass=["'][^"']*\b(gh-content|post-content|entry-content|article-content|post-body|newsletter-body|email-body)\b/i,
  /<td\b[^>]*\bid=["']templateBody["']/i,
  /<article\b/i,
  /<main\b/i
];

/* The main text of an issue page (Beehiiv, Substack, Ghost, WordPress, Medium, Mailchimp, generic). */
export function extractArticle(html) {
  const text = String(html || "").replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<style[\s\S]*?<\/style\s*>/gi, "");
  for (const marker of BODY_MARKERS) {
    const at = text.search(marker);
    if (at >= 0) {
      const part = elementAt(text, at);
      if (textOf(part).length > 200) return part;
    }
  }
  const body = text.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return body ? body[1] : "";
}

/* Issue links on an archive page when a newsletter has no feed:
   Mailchimp campaign archives and paths like /p/, /posts/, /issues/, /archive/<x>, /YYYY/MM/. */
export function archiveLinks(html, pageUrl) {
  const out = [];
  const seen = new Set();
  let base;
  try { base = new URL(pageUrl); } catch (_) { return out; }
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const page = String(html || "").slice(0, 600000);
  let m;
  while ((m = re.exec(page)) && out.length < 20) {
    const a = attrs("<a" + m[1] + ">");
    const href = absolute(a.href, pageUrl);
    if (!href) continue;
    let u;
    try { u = new URL(href); } catch (_) { continue; }
    const mail = /(^|\.)campaign-archive\d*\.com$|(^|\.)mailchi\.mp$/i.test(u.hostname);
    const same = u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (!mail && !same) continue;
    if (!mail && !/\/(p|posts?|issues?|archive|newsletters?|letters?|editions?)\/[^/?#]{3,}|\/\d{4}\/\d{2}\/[^/?#]{3,}/i.test(u.pathname)) continue;
    if (mail && (/\/home\/?$|\/feed|\/archive\/rss/i.test(u.pathname) || (!u.search && u.hostname.indexOf("mailchi.mp") < 0))) continue;
    u.hash = "";
    if (seen.has(u.href)) continue;
    const title = clip(textOf(m[2]), 300) || clip(a.title, 300);
    if (title.length < 6) continue;
    seen.add(u.href);
    const before = page.slice(Math.max(0, m.index - 40), m.index);
    const d = before.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*$/);
    const date = d ? new Date(Date.UTC(+d[3], +d[1] - 1, +d[2], 12)).toISOString() : "";
    out.push({ guid: u.href, title: title, link: u.href, date: date, author: "", excerpt: "", image: "", html: "" });
  }
  return out;
}
