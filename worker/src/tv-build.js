/* Custom TV app name builds.
   POST /v1/tv/build {name, icon}      signed in, 3 per user per day: starts tv-custom.yml
   GET  /v1/tv/build/<id>              signed in, owner of the build: building | ready | failed
   GET  /v1/tv/build/<id>/apk?exp&sig  signed link from the status call: streams the APK
   The name only travels as a workflow input. The workflow masks it, never
   commits it, and leaves the APK in a draft release, which only repo writers
   can see. Draft releases older than a day are deleted by the next build.
   Needs the Worker secret TV_BUILD_TOKEN: a fine-grained token on the repo with
   Actions read and write and Contents read and write. */

const REPO = "ViktorychGroup/ViktorychApp";
const WORKFLOW = "tv-custom.yml";
export const TV_ICONS = ["default", "media", "browser", "player", "notes"];
const BUILD_ID = /^([0-9a-z]{8})([0-9a-f]{12})([0-9a-f]{16})$/;
const PER_USER_DAY = 3;
const ALL_DAY = 40;
const DAY = 24 * 60 * 60 * 1000;
const GIVE_UP = 25 * 60 * 1000;
const LINK_TTL = 15 * 60 * 1000;

/* Letters, marks, digits, spaces and . - _ only, up to 24 characters. Same rule as android-tv/app/build.gradle. */
export function cleanTvLabel(value) {
  let text = String(value == null ? "" : value).normalize("NFC");
  text = text.replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length > 24) text = chars.slice(0, 24).join("").trim();
  return text;
}

function token(env) { return String(env.TV_BUILD_TOKEN || "").trim(); }

function gh(env, path, init) {
  init = init || {};
  const headers = Object.assign({
    Authorization: "Bearer " + token(env),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "viktorych-accounts"
  }, init.headers || {});
  return fetch("https://api.github.com/repos/" + REPO + path, Object.assign({}, init, { headers }));
}

function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(env, text) {
  const secret = String(env.ACCOUNT_PEPPER || "") + ":tv-build";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

/* id = base36 time (8) + random (12 hex) + mac over both and the account (16 hex). */
async function newId(env, publicId, now) {
  const stamp = now.toString(36).padStart(8, "0").slice(-8);
  const rand = hex(crypto.getRandomValues(new Uint8Array(6)));
  const mac = (await hmac(env, "id:" + publicId + ":" + stamp + rand)).slice(0, 16);
  return stamp + rand + mac;
}

async function ownsId(env, publicId, id) {
  const m = BUILD_ID.exec(String(id || ""));
  if (!m) return null;
  const mac = (await hmac(env, "id:" + publicId + ":" + m[1] + m[2])).slice(0, 16);
  if (mac !== m[3]) return null;
  return { started: parseInt(m[1], 36) };
}

async function signLink(env, id, exp) { return (await hmac(env, "apk:" + id + ":" + exp)).slice(0, 32); }

async function findDraft(env, id) {
  const res = await gh(env, "/releases?per_page=50");
  if (!res.ok) return { error: res.status };
  const list = await res.json();
  const rel = (Array.isArray(list) ? list : []).find((r) => r && r.draft && r.tag_name === "tv-custom-" + id);
  if (!rel) return { release: null };
  const asset = (rel.assets || []).find((a) => a && a.name === "ViktorychTV.apk" && a.state === "uploaded");
  return { release: rel, asset: asset || null };
}

export async function handleTvBuild(request, env, path, deps) {
  if (path !== "/v1/tv/build" && !path.startsWith("/v1/tv/build/")) return null;
  const url = new URL(request.url);
  const apk = path.match(/^\/v1\/tv\/build\/([0-9a-z]{36})\/apk$/);
  if (apk && request.method === "GET") {
    const id = apk[1];
    const exp = Number(url.searchParams.get("exp") || 0);
    const sig = String(url.searchParams.get("sig") || "");
    if (!exp || exp < Date.now() || sig !== await signLink(env, id, exp)) return deps.json(403, { error: "expired" });
    if (!token(env)) return deps.json(503, { error: "not_ready" });
    const found = await findDraft(env, id);
    if (!found.asset) return deps.json(404, { error: "missing" });
    const first = await gh(env, "/releases/assets/" + found.asset.id, { headers: { Accept: "application/octet-stream" }, redirect: "manual" });
    let body = first;
    const loc = first.headers.get("location");
    if (first.status >= 300 && first.status < 400 && loc) body = await fetch(loc);
    if (!body.ok || !body.body) return deps.json(502, { error: "download_failed" });
    return new Response(body.body, {
      status: 200,
      headers: {
        "content-type": "application/vnd.android.package-archive",
        "content-disposition": 'attachment; filename="ViktorychTV.apk"',
        "cache-control": "private, no-store"
      }
    });
  }

  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return deps.json(401, { error: "unauthorized" });

  if (path === "/v1/tv/build" && request.method === "POST") {
    const body = await deps.readJson(request);
    const label = cleanTvLabel(body && body.name);
    const icon = TV_ICONS.indexOf(body && body.icon) >= 0 ? body.icon : "default";
    if (!label) return deps.json(400, { error: "bad_name" });
    if (!token(env)) return deps.json(503, { error: "not_ready" });
    const mine = await deps.rateHit(env, "tv-build:" + viewer.public_id, PER_USER_DAY, DAY);
    if (!mine.ok) return deps.limited(mine);
    const all = await deps.rateHit(env, "tv-build:all", ALL_DAY, DAY);
    if (!all.ok) return deps.limited(all);
    const now = Date.now();
    const id = await newId(env, viewer.public_id, now);
    let res;
    try {
      res = await gh(env, "/actions/workflows/" + WORKFLOW + "/dispatches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { build_id: id, label: label, icon: icon } })
      });
    } catch (err) {
      return deps.json(502, { error: "dispatch_failed" });
    }
    if (res.status === 404) return deps.json(503, { error: "not_ready" });
    if (res.status !== 204 && !res.ok) return deps.json(502, { error: "dispatch_failed" });
    return deps.json(202, { id: id, state: "building", name: label, icon: icon });
  }

  const status = path.match(/^\/v1\/tv\/build\/([0-9a-z]{36})$/);
  if (status && request.method === "GET") {
    const id = status[1];
    const own = await ownsId(env, viewer.public_id, id);
    if (!own) return deps.json(404, { error: "not_found" });
    const paced = await deps.rateHit(env, "tv-build-poll:" + viewer.public_id, 240, 60 * 60 * 1000);
    if (!paced.ok) return deps.limited(paced);
    if (!token(env)) return deps.json(503, { error: "not_ready" });
    const found = await findDraft(env, id);
    if (found.error) return deps.json(502, { error: "github" });
    if (found.asset) {
      const exp = Date.now() + LINK_TTL;
      const sig = await signLink(env, id, exp);
      return deps.json(200, { id: id, state: "ready", download: "/v1/tv/build/" + id + "/apk?exp=" + exp + "&sig=" + sig, size: found.asset.size || 0 });
    }
    if (Date.now() - own.started > GIVE_UP) return deps.json(200, { id: id, state: "failed" });
    return deps.json(200, { id: id, state: "building" });
  }
  return deps.json(404, { error: "not_found" });
}
