/* What a non-owner reader may see in a catalog. Shared by the Worker data
   route and the build step that seals catalogs for GitHub Pages, so both
   strip exactly the same items. */
export function tiktokPublic(env) {
  return String((env && env.TIKTOK_AUDIENCE) || "owner") === "all";
}

export function ownerOnlyItem(item, env) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (item.ownerOnly === true) return true;
  const platform = String(item.platform || "").toLowerCase();
  if (platform === "tiktok" && !tiktokPublic(env)) return true;
  const kind = String(item.kind || item.type || "").toLowerCase();
  if (kind === "short" || kind === "shorts") return true;
  if (item.short === true || item.isShort === true) return true;
  const blob = [item.url, item.link, item.watch, item.external, item.canonical].filter(Boolean).join(" ");
  return /\/shorts\//i.test(blob);
}

export function stripOwnerOnly(value, env) {
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item && typeof item === "object" && !Array.isArray(item) && ownerOnlyItem(item, env)) continue;
      out.push(stripOwnerOnly(item, env));
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => { out[key] = stripOwnerOnly(value[key], env); });
    return out;
  }
  return value;
}
