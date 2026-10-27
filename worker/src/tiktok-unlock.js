/* The unlock list from PR #207: the TIKTOK_UNLOCKED secret, then
   owner/tiktok-unlocked.json in R2. One reader. Callers decide what to hide.
   Moved here so notifications can use it without importing the worker entry. */

function rememberHandle(found, seen, name) {
  const clean = String(name || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{2,24}$/.test(clean)) return;
  const key = clean.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  found.push(clean);
}

async function readText(env, key) {
  if (!env || !env.DATA || typeof env.DATA.get !== "function" || !key) return "";
  try {
    const object = await env.DATA.get(key);
    return object && typeof object.text === "function" ? await object.text() : "";
  } catch (err) {
    return "";
  }
}

async function readJsonObject(env, key) {
  let text = await readText(env, key);
  if (!String(text || "").trim()) text = await readText(env, "lastgood/" + key);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

export async function unlockedHandles(env) {
  const found = [];
  const seen = new Set();
  String((env && env.TIKTOK_UNLOCKED) || "").split(/[\s,]+/).forEach((part) => rememberHandle(found, seen, part));
  const doc = await readJsonObject(env, "owner/tiktok-unlocked.json");
  const list = doc && (doc.handles || doc.unlocked || []);
  if (Array.isArray(list)) {
    list.forEach((item) => rememberHandle(found, seen, typeof item === "string" ? item : item && item.handle));
  }
  return found;
}

export function tiktokAudienceAll(env) {
  return String((env && env.TIKTOK_AUDIENCE) || "owner") === "all";
}
