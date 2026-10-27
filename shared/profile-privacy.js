/* Who may see a profile photo or banner.
   Friends means mutual follows. Deny wins over allow, and allow wins over
   the base rule, including Nobody. The owner always sees their own media. */

const LEVELS = { everyone: 1, followers: 1, friends: 1, nobody: 1 };

export function defaultVisibility(privateAccount) {
  return privateAccount ? "followers" : "everyone";
}

export function cleanVisibility(value, fallback) {
  const text = String(value || "");
  if (LEVELS[text]) return text;
  return LEVELS[fallback] ? fallback : "everyone";
}

export function viewerCanSee(rule, rel) {
  const visibility = cleanVisibility(rule && rule.visibility, "everyone");
  const viewerId = rel && rel.viewerId ? String(rel.viewerId) : "";
  if (rel && rel.owner) return true;
  const deny = (rule && rule.deny) || [];
  const allow = (rule && rule.allow) || [];
  if (viewerId && deny.indexOf(viewerId) >= 0) return false;
  if (viewerId && allow.indexOf(viewerId) >= 0) return true;
  if (!viewerId) return visibility === "everyone";
  if (visibility === "everyone") return true;
  if (visibility === "followers") return !!(rel && rel.follows);
  if (visibility === "friends") return !!(rel && rel.follows && rel.followedBy);
  return false;
}

export function pickVisible(items, rel) {
  const list = (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const order = (Number(a && a.order) || 0) - (Number(b && b.order) || 0);
    if (order) return order;
    return String((a && a.id) || "").localeCompare(String((b && b.id) || ""));
  });
  if (rel && rel.owner) {
    const regular = list.filter((item) => item && !item.fallback);
    return { primary: regular[0] || list[0] || null, gallery: list };
  }
  const allowed = list.filter((item) => item && !item.fallback && viewerCanSee(item, rel));
  if (allowed.length) return { primary: allowed[0], gallery: allowed };
  const fallback = list.find((item) => item && item.fallback && viewerCanSee(item, rel));
  if (fallback) return { primary: fallback, gallery: [fallback] };
  return { primary: null, gallery: [] };
}

const ID_KEYS = { publicId: 1, public_id: 1, authorId: 1, author_id: 1, actorId: 1, actor_id: 1, accountId: 1, account_id: 1 };
const LEGACY_MEDIA = /\/v1\/media\/(?:avatars|banners)\/\d{12}\//;
const LEGACY_KEY = /^media\/(?:avatars|banners)\/\d{12}\//;

export function scrubAccountId(node, id) {
  const needle = String(id || "");
  if (!/^\d{12}$/.test(needle)) return node;
  const app = "app:" + needle;
  const walk = (value) => {
    if (typeof value === "string") {
      if (value === needle || value === app) return "";
      if (value.indexOf("/v1/media/avatars/" + needle + "/") >= 0) return "";
      if (value.indexOf("/v1/media/banners/" + needle + "/") >= 0) return "";
      if (value.indexOf("media/avatars/" + needle + "/") === 0) return "";
      if (value.indexOf("media/banners/" + needle + "/") === 0) return "";
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out = {};
    Object.keys(value).forEach((key) => {
      const child = value[key];
      if (ID_KEYS[key] && (child === needle || child === app)) {
        out[key] = "";
        return;
      }
      out[key] = walk(child);
    });
    return out;
  };
  return walk(node);
}

export function redactPublicIds(node) {
  const walk = (value) => {
    if (typeof value === "string") {
      if (/^app:\d{12}$/.test(value)) return "";
      if (LEGACY_MEDIA.test(value) || LEGACY_KEY.test(value)) return "";
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out = {};
    Object.keys(value).forEach((key) => {
      const child = value[key];
      if (ID_KEYS[key] && (typeof child === "string" || typeof child === "number")) {
        const text = String(child);
        if (/^\d{12}$/.test(text) || /^app:\d{12}$/.test(text)) {
          out[key] = "";
          return;
        }
      }
      out[key] = walk(child);
    });
    return out;
  };
  return walk(node);
}
