/** Stable /tg object keys for synced social media. Keep in step with scripts/telegram_backup.py. */

const SOCIAL_PLATFORMS = ["x", "instagram", "threads", "youtube", "vk", "telegram", "rss", "facebook"];

function cleanIdent(value) {
  const raw = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{1,80}$/.test(raw)) return raw;
  return "";
}

function stableIdent(post) {
  const platform = String((post && post.platform) || "").toLowerCase();
  const status = String((post && post.statusId) || "");
  const id = String((post && post.id) || "");
  if (platform === "tiktok") {
    const match = (status || id).match(/(\d{8,22})/);
    return match ? match[1] : "";
  }
    const direct = cleanIdent(status);
  if (direct) return direct;
  const blob = [post && post.url, status, id].filter(Boolean).join(" ");
  if (platform === "facebook") {
    const fb = blob.match(/(?:videos|reel)\/(\d{5,20})|[?&]v=(\d{5,20})/);
    const found = fb ? cleanIdent(fb[1] || fb[2]) : "";
    if (found) return found;
  }
  const patterns = [
    /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{1,80})/,
    /threads\.(?:com|net)\/(?:@[^/\s]+\/)?(?:post|t)\/([A-Za-z0-9_-]{1,80})/,
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{6,16})/,
    /video(-?\d+_\d+)/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = blob.match(patterns[i]);
    const ident = match ? cleanIdent(match[1]) : "";
    if (ident) return ident;
  }
  const bare = id.indexOf(":") >= 0 ? id.slice(id.indexOf(":") + 1) : id;
  return cleanIdent(bare);
}

function socialObjectKey(post, role, index) {
  const platform = String((post && post.platform) || "").toLowerCase();
  const n = Math.max(0, Number(index) || 0);
  if (platform === "tiktok") {
    const handle = String((post && post.handle) || "").replace(/^@/, "");
    const ident = stableIdent(post);
    if (!/^[A-Za-z0-9._]{2,24}$/.test(handle) || !/^\d{8,22}$/.test(ident)) return "";
    if (role === "video") return "tiktok/" + handle + "/" + ident + "/video";
    if (role === "poster") return "tiktok/" + handle + "/" + ident + "/poster";
    if (role === "photo") return "tiktok/" + handle + "/" + ident + "/photo/" + n;
    return "";
  }
  if (SOCIAL_PLATFORMS.indexOf(platform) < 0) return "";
  const ident = stableIdent(post);
  if (!ident) return "";
  if (role === "thumb") return "social/" + platform + "/" + ident + "/thumb/" + n;
  if (role === "video") return "social/" + platform + "/" + ident + "/video/" + n;
  if (role === "poster") return "social/" + platform + "/" + ident + "/poster/" + n;
  if (role === "photo") return "social/" + platform + "/" + ident + "/photo/" + n;
  return "";
}

function mediaIndex(post, media) {
  const list = (post && post.media) || [];
  const found = list.indexOf(media);
  return found >= 0 ? found : 0;
}

function socialFileKey(post, media) {
  const platform = String((post && post.platform) || "").toLowerCase();
  const type = String((media && media.type) || "").toLowerCase();
  const index = mediaIndex(post, media);
  if (platform === "youtube") {
    if (type === "photo" || type === "image") return socialObjectKey(post, "photo", index);
    return "";
  }
  if (platform === "tiktok") {
    if (type === "photo" || type === "image") return socialObjectKey(post, "photo", index);
    return socialObjectKey(post, "video", 0);
  }
  if (type === "video" || type === "animated_gif") return socialObjectKey(post, "video", index);
  if (type === "photo" || type === "image") return socialObjectKey(post, "photo", index);
  return "";
}

function socialStillKey(post, media) {
  const platform = String((post && post.platform) || "").toLowerCase();
  const type = String((media && media.type) || "").toLowerCase();
  const index = mediaIndex(post, media);
  if (platform === "youtube") return socialObjectKey(post, type === "photo" || type === "image" ? "photo" : "thumb", index);
  if (platform === "tiktok") {
    if (type === "photo" || type === "image") return socialObjectKey(post, "photo", index);
    return socialObjectKey(post, "poster", 0);
  }
  if (type === "video" || type === "animated_gif") return socialObjectKey(post, "poster", index);
  if (type === "photo" || type === "image") return socialObjectKey(post, "photo", index);
  return "";
}

function socialKeysForPost(post) {
  const platform = String((post && post.platform) || "").toLowerCase();
  if (!post || platform === "tiktok") return [];
  const keys = [];
  const seen = {};
  const media = post.media || [];
  media.forEach((item, index) => {
    ["video", "poster", "photo", "thumb"].forEach((role) => {
      const key = socialObjectKey(post, role, index);
      if (key && !seen[key]) {
        seen[key] = true;
        keys.push(key);
      }
    });
  });
  return keys;
}

export { socialObjectKey, socialFileKey, socialStillKey, socialKeysForPost, stableIdent };
