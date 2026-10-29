/* Link preview metadata. Pure helpers shared by the Worker and the tests.
   parseMeta reads Open Graph and Twitter card tags from an HTML head.
   safeTarget refuses anything that is not a public http(s) URL. */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/", "#47": "/" };

export function decodeEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+[0-9]*);/gi, (all, name) => {
    if (ENTITIES[name] != null) return ENTITIES[name];
    if (ENTITIES[name.toLowerCase()] != null) return ENTITIES[name.toLowerCase()];
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (code > 0 && code < 0x110000) { try { return String.fromCodePoint(code); } catch (_) { return ""; } }
    }
    return all;
  });
}

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  const body = tag.replace(/^<\s*[a-zA-Z]+/, "").replace(/\/?>$/, "");
  while ((m = re.exec(body))) out[m[1].toLowerCase()] = decodeEntities(m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] || "");
  return out;
}

function clip(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

function absolute(value, base) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim(), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}

export function parseMeta(html, pageUrl) {
  const head = String(html || "").slice(0, 600000);
  const meta = {};
  const tags = head.match(/<meta\b[^>]*>/gi) || [];
  tags.forEach((tag) => {
    const a = attrs(tag);
    const key = String(a.property || a.name || a.itemprop || "").toLowerCase();
    if (!key || a.content == null) return;
    if (meta[key] == null) meta[key] = a.content;
  });
  const links = head.match(/<link\b[^>]*>/gi) || [];
  let icon = "";
  links.forEach((tag) => {
    const a = attrs(tag);
    const rel = String(a.rel || "").toLowerCase();
    if (!icon && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel) && a.href) icon = a.href;
  });
  const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const base = absolute(meta["og:url"], pageUrl) || pageUrl;
  const title = clip(decodeEntities(meta["og:title"] || meta["twitter:title"] || titleTag), 300);
  const description = clip(decodeEntities(meta["og:description"] || meta["twitter:description"] || meta.description || ""), 400);
  const image = absolute(meta["og:image:secure_url"] || meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"], base);
  const width = Number(meta["og:image:width"] || meta["twitter:image:width"] || 0) || 0;
  const height = Number(meta["og:image:height"] || meta["twitter:image:height"] || 0) || 0;
  const cardType = String(meta["twitter:card"] || "").toLowerCase();
  const site = clip(decodeEntities(meta["og:site_name"] || ""), 80);
  const video = absolute(meta["og:video:secure_url"] || meta["og:video:url"] || meta["og:video"] || meta["twitter:player"], base);
  const out = {
    url: pageUrl,
    title: title,
    description: description,
    image: image,
    site: site,
    domain: domainOf(pageUrl),
    icon: absolute(icon, base) || "",
    type: clip(meta["og:type"] || "", 40)
  };
  if (width && height) { out.width = width; out.height = height; }
  // X decides the big card from twitter:card. Without it, a wide image is big.
  out.large = !!image && (cardType === "summary_large_image" || cardType === "player" || (!cardType && (!width || !height || width / height >= 1.3)) || (cardType !== "summary" && width >= 600 && width / Math.max(1, height) >= 1.3));
  if (cardType === "summary") out.large = false;
  if (video) out.video = video;
  if (!out.title && !out.description && !out.image) return null;
  return out;
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.arpa|metadata\.google\.internal)$/i;

export function safeTarget(raw) {
  const text = String(raw || "").trim();
  if (!text || text.length > 2000) return null;
  let url;
  try { url = new URL(text); } catch (_) { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!host || host.indexOf(".") < 0 || PRIVATE_HOST.test(host)) return null;
  if (/^[\d.]+$/.test(host) || host.indexOf(":") >= 0 || host.startsWith("[")) return null;
  url.hash = "";
  return url;
}
