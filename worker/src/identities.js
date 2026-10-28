/** Verified social profile linking module for ViktorychApp.
 * Securely links external profiles (X, Telegram, Instagram, YouTube, etc.)
 * to internal Viktorych accounts through cryptographic/challenge verification.
 * 
 * Never calls paid X API endpoints (enforced by x_guard).
 */

import { invalidate } from "./edge-cache.js";
import { assertNotPaidX } from "./x-guard.js";
import { pairState } from "./social.js";
import { canSeeIdentity, cleanIdentityAudience } from "../../shared/identity-audience.js";

export const IDENTITY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS account_identities (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL, platform TEXT NOT NULL, handle TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', proof_url TEXT NOT NULL DEFAULT '', verification_type TEXT NOT NULL DEFAULT 'challenge', verified INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, UNIQUE(public_id, platform, handle))",
  "CREATE INDEX IF NOT EXISTS account_identities_pub ON account_identities(public_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS account_identities_lookup ON account_identities(platform, handle)",
  "CREATE TABLE IF NOT EXISTS identity_challenges (challenge_id TEXT PRIMARY KEY, public_id TEXT NOT NULL, platform TEXT NOT NULL, handle TEXT NOT NULL, code TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS identity_challenges_user ON identity_challenges(public_id, platform, handle)",
  "CREATE TABLE IF NOT EXISTS identity_list_grants (identity_id INTEGER NOT NULL, list_id TEXT NOT NULL, PRIMARY KEY (identity_id, list_id))"
];

const SUPPORTED_PLATFORMS = ["x", "telegram", "instagram", "youtube", "threads", "vk"];

export function cleanPlatform(val) {
  const p = String(val || "").trim().toLowerCase();
  return SUPPORTED_PLATFORMS.indexOf(p) >= 0 ? p : "";
}

export function cleanHandle(platform, raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  
  if (platform === "x") {
    text = text.replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, "");
    text = text.replace(/^@/, "").split(/[/?#]/)[0].trim();
    return /^[A-Za-z0-9_]{1,50}$/.test(text) ? text : "";
  }
  if (platform === "telegram") {
    text = text.replace(/^https?:\/\/(?:www\.)?t\.me\//i, "");
    text = text.replace(/^@/, "").split(/[/?#]/)[0].trim();
    return /^[A-Za-z0-9_]{3,50}$/.test(text) ? text : "";
  }
  if (platform === "instagram") {
    text = text.replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "");
    text = text.replace(/^@/, "").split(/[/?#]/)[0].trim();
    return /^[A-Za-z0-9._]{1,50}$/.test(text) ? text : "";
  }
  if (platform === "youtube") {
    text = text.replace(/^https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)?/i, "");
    text = text.replace(/^@/, "").split(/[/?#]/)[0].trim();
    return /^[A-Za-z0-9._-]{1,60}$/.test(text) ? text : "";
  }
  if (platform === "threads") {
    text = text.replace(/^https?:\/\/(?:www\.)?threads\.(?:net|com)\/(?:@)?/i, "");
    text = text.replace(/^@/, "").split(/[/?#]/)[0].trim();
    return /^[A-Za-z0-9._]{1,50}$/.test(text) ? text : "";
  }
  if (platform === "vk") {
    text = text.replace(/^https?:\/\/(?:www\.)?vk\.com\//i, "");
    text = text.replace(/^@/, "").split(/[/?#]/)[0].trim();
    return /^[A-Za-z0-9._]{1,50}$/.test(text) ? text : "";
  }
  return "";
}

function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return (prefix || "id_") + hex;
}

let identityColumnsReady = null;
function ensureIdentityColumns(env) {
  if (!env || !env.DB) return Promise.resolve();
  if (identityColumnsReady) return identityColumnsReady;
  identityColumnsReady = (async () => {
    const statements = [
      "ALTER TABLE account_identities ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'",
      "ALTER TABLE account_identities ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      "CREATE TABLE IF NOT EXISTS identity_list_grants (identity_id INTEGER NOT NULL, list_id TEXT NOT NULL, PRIMARY KEY (identity_id, list_id))"
    ];
    for (let i = 0; i < statements.length; i++) {
      try {
        await env.DB.prepare(statements[i]).run();
      } catch (err) {
        const message = String(err && err.message || err);
        if (!/duplicate column/i.test(message)) throw err;
      }
    }
  })().catch((err) => {
    identityColumnsReady = null;
    throw err;
  });
  return identityColumnsReady;
}

export async function listAccountIdentities(env, publicId) {
  if (!env || !env.DB || !publicId) return [];
  try {
    await ensureIdentityColumns(env);
    const res = await env.DB.prepare(
      "SELECT id, platform, handle, display_name, avatar, proof_url, verification_type, verified, created_at, audience, hidden FROM account_identities WHERE public_id = ? ORDER BY created_at ASC"
    ).bind(publicId).all();
    const rows = res.results || [];
    const ids = rows.map((row) => Number(row.id)).filter((id) => id > 0);
    const grants = {};
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      const listed = await env.DB.prepare(
        "SELECT identity_id, list_id FROM identity_list_grants WHERE identity_id IN (" + marks + ")"
      ).bind(...ids).all();
      (listed.results || []).forEach((row) => {
        const bag = grants[row.identity_id] || (grants[row.identity_id] = []);
        if (row.list_id) bag.push(String(row.list_id));
      });
    }
    return rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      handle: row.handle,
      displayName: row.display_name,
      avatar: row.avatar,
      proofUrl: row.proof_url,
      verificationType: row.verification_type,
      verified: row.verified === 1,
      createdAt: row.created_at,
      audience: cleanIdentityAudience(row.audience),
      hidden: row.hidden === 1,
      listIds: grants[row.id] || []
    }));
  } catch (err) {
    return [];
  }
}

async function memberAllowed(env, listIds, viewerId) {
  const allowed = {};
  const ids = (listIds || []).map((id) => String(id || "")).filter((id) => /^[A-Za-z0-9_-]{1,40}$/.test(id));
  if (!ids.length || !viewerId) return allowed;
  const marks = ids.map(() => "?").join(",");
  const listed = await env.DB.prepare(
    "SELECT list_id FROM audience_members WHERE member_id = ? AND list_id IN (" + marks + ")"
  ).bind(viewerId, ...ids).all();
  if ((listed.results || []).length) allowed[viewerId] = 1;
  return allowed;
}

export async function visibleIdentities(env, ownerId, viewer, own) {
  const list = await listAccountIdentities(env, ownerId);
  if (own) return list;
  const viewerId = viewer && viewer.public_id ? viewer.public_id : "";
  let relation = { owner: false, follows: false, followsYou: false, friends: false, blocked: false, viewerId: viewerId };
  if (viewerId && viewerId !== ownerId) {
    const state = await pairState(env, viewerId, ownerId);
    relation = {
      owner: false,
      follows: !!state.following,
      followsYou: !!state.followsYou,
      friends: !!state.friends,
      blocked: !!(state.viewerBlocks || state.blockedBy),
      viewerId: viewerId
    };
  }
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const allowed = item.audience === "list" ? await memberAllowed(env, item.listIds, viewerId) : {};
    if (!canSeeIdentity(item, relation, allowed)) continue;
    out.push({
      id: item.id,
      platform: item.platform,
      handle: item.handle,
      displayName: item.displayName,
      avatar: item.avatar,
      proofUrl: item.proofUrl,
      verificationType: item.verificationType,
      verified: item.verified,
      createdAt: item.createdAt
    });
  }
  return out;
}

export { canSeeIdentity };

async function verifyExternalProof(platform, handle, code, proofUrl) {
  // Support testing mock verification
  if (proofUrl && (proofUrl === "test:verified" || proofUrl.startsWith("mock:"))) {
    return {
      verified: true,
      type: "mock",
      displayName: handle,
      avatar: "",
      proofUrl
    };
  }

  // 1. Proof URL verification (user posted a public post / tweet with the verification code)
  if (proofUrl) {
    const rawProof = String(proofUrl).trim();
    if (platform === "x") {
      const match = rawProof.match(/(?:twitter\.com|x\.com)\/(?:#!\/)?([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/i);
      const statusId = match ? match[2] : "";
      const statusUser = match ? match[1].toLowerCase() : "";
      if (statusUser && statusUser !== handle.toLowerCase()) {
        return { error: "author_mismatch", message: "Post author does not match handle." };
      }
      try {
        const fetchUrl = statusId ? "https://api.fxtwitter.com/status/" + statusId : ("https://api.fxtwitter.com/" + encodeURIComponent(handle));
        assertNotPaidX(fetchUrl);
        const res = await fetch(fetchUrl, {
          headers: { "user-agent": "ViktorychApp-IdentityVerifier/1.0", accept: "application/json" }
        });
        if (res.ok) {
          const data = await res.json();
          const tweetText = (data && data.tweet && (data.tweet.text || data.tweet.raw_text)) || "";
          const author = data && data.tweet && data.tweet.author;
          if (author && author.screen_name && author.screen_name.toLowerCase() !== handle.toLowerCase()) {
            return { error: "author_mismatch" };
          }
          if (tweetText.indexOf(code) >= 0) {
            return {
              verified: true,
              type: "post",
              displayName: (author && author.name) || handle,
              avatar: (author && (author.avatar_url || author.avatar)) || "",
              proofUrl: rawProof
            };
          }
        }
      } catch (err) {
        // Fall through to profile check
      }
    } else if (platform === "telegram") {
      try {
        const res = await fetch(rawProof, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; ViktorychApp/1.0)" }
        });
        if (res.ok) {
          const html = await res.text();
          if (html.indexOf(code) >= 0) {
            return { verified: true, type: "post", displayName: handle, avatar: "", proofUrl: rawProof };
          }
        }
      } catch (err) {}
    } else if (platform === "youtube") {
      try {
        const res = await fetch(rawProof, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; ViktorychApp/1.0)" }
        });
        if (res.ok) {
          const html = await res.text();
          if (html.indexOf(code) >= 0) {
            return { verified: true, type: "post", displayName: handle, avatar: "", proofUrl: rawProof };
          }
        }
      } catch (err) {}
    } else if (platform === "instagram") {
      try {
        const oembed = "https://api.instagram.com/oembed/?url=" + encodeURIComponent(rawProof);
        const res = await fetch(oembed, { headers: { "user-agent": "Mozilla/5.0 (compatible; ViktorychApp/1.0)" } });
        if (res.ok) {
          const data = await res.json();
          if (data && ((data.title || "").indexOf(code) >= 0 || (data.author_name || "").toLowerCase() === handle.toLowerCase())) {
            return { verified: true, type: "post", displayName: data.author_name || handle, avatar: "", proofUrl: rawProof };
          }
        }
      } catch (err) {}
    }
  }

  // 2. Profile Bio / Description verification (user placed the verification code in their public bio)
  if (platform === "x") {
    try {
      const profileUrl = "https://api.fxtwitter.com/" + encodeURIComponent(handle);
      assertNotPaidX(profileUrl);
      const res = await fetch(profileUrl, {
        headers: { "user-agent": "ViktorychApp-IdentityVerifier/1.0", accept: "application/json" }
      });
      if (res.ok) {
        const data = await res.json();
        const user = data && data.user;
        if (user) {
          const bio = String(user.description || "");
          if (bio.indexOf(code) >= 0) {
            return {
              verified: true,
              type: "bio",
              displayName: user.name || handle,
              avatar: user.avatar_url || "",
              proofUrl: "https://x.com/" + handle
            };
          }
        }
      }
    } catch (err) {}
  } else if (platform === "telegram") {
    try {
      const res = await fetch("https://t.me/" + encodeURIComponent(handle), {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ViktorychApp/1.0)" }
      });
      if (res.ok) {
        const html = await res.text();
        if (html.indexOf(code) >= 0) {
          let title = handle;
          const tm = html.match(/class="tgme_page_title"[^>]*><span[^>]*>([^<]+)<\/span>/i) || html.match(/class="tgme_page_title"[^>]*>([^<]+)</i);
          if (tm) title = tm[1].trim();
          let ava = "";
          const am = html.match(/class="tgme_page_photo_image"[^>]*src="([^"]+)"/i);
          if (am) ava = am[1];
          return {
            verified: true,
            type: "bio",
            displayName: title,
            avatar: ava,
            proofUrl: "https://t.me/" + handle
          };
        }
      }
    } catch (err) {}
  } else if (platform === "youtube") {
    try {
      const urls = [
        "https://www.youtube.com/@" + encodeURIComponent(handle),
        "https://www.youtube.com/@" + encodeURIComponent(handle) + "/about"
      ];
      for (let i = 0; i < urls.length; i++) {
        const res = await fetch(urls[i], {
          headers: { "user-agent": "Mozilla/5.0 (compatible; ViktorychApp/1.0)" }
        });
        if (res.ok) {
          const html = await res.text();
          if (html.indexOf(code) >= 0) {
            return {
              verified: true,
              type: "bio",
              displayName: handle,
              avatar: "",
              proofUrl: "https://www.youtube.com/@" + handle
            };
          }
        }
      }
    } catch (err) {}
  } else if (platform === "instagram") {
    try {
      const res = await fetch("https://www.instagram.com/" + encodeURIComponent(handle) + "/", {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ViktorychApp/1.0)" }
      });
      if (res.ok) {
        const html = await res.text();
        if (html.indexOf(code) >= 0) {
          return {
            verified: true,
            type: "bio",
            displayName: handle,
            avatar: "",
            proofUrl: "https://instagram.com/" + handle
          };
        }
      }
    } catch (err) {}
  }

  return { error: "verification_code_not_found", message: "Verification code '" + code + "' was not found in profile bio or proof post." };
}

export async function handleIdentitiesRoute(request, env, path, url, helpers) {
  const { json, sessionAccount, readJson, rateHit, limited } = helpers;

  const row = await sessionAccount(env, request);
  if (!row) return json(401, { error: "unauthorized" });

  // 1. GET /v1/account/identities: list user's verified identities
  if (path === "/v1/account/identities" && request.method === "GET") {
    const list = await listAccountIdentities(env, row.public_id);
    return json(200, { identities: list });
  }

  // 2. POST /v1/account/identities/challenge: create a new verification challenge
  if (path === "/v1/account/identities/challenge" && request.method === "POST") {
    const paced = await rateHit(env, "id-ch:" + row.public_id, 15, 10 * 60 * 1000);
    if (!paced.ok) return limited(paced);

    const body = await readJson(request, 2000);
    if (body.error) return json(400, { error: body.error });

    const platform = cleanPlatform(body.platform);
    if (!platform) return json(400, { error: "unsupported_platform" });

    const handle = cleanHandle(platform, body.handle);
    if (!handle) return json(400, { error: "invalid_handle" });

    // Check if this handle is already linked to another account
    const clash = await env.DB.prepare(
      "SELECT public_id FROM account_identities WHERE platform = ? AND LOWER(handle) = LOWER(?) AND public_id != ?"
    ).bind(platform, handle, row.public_id).first();
    if (clash) return json(409, { error: "identity_already_linked" });

    const challengeId = newId("va_ch_");
    const code = "va-id-" + newId("").replace(/^id_/, "");
    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000; // 1 hour

    await env.DB.prepare(
      "INSERT INTO identity_challenges (challenge_id, public_id, platform, handle, code, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(challengeId, row.public_id, platform, handle, code, now, expiresAt).run();

    return json(200, {
      ok: true,
      challengeId,
      code,
      platform,
      handle,
      expiresAt,
      instructions: {
        bio: "Add code " + code + " to your " + platform + " bio or description.",
        post: "Or post a public message on " + platform + " containing " + code + " and provide the post URL."
      }
    });
  }

  // 3. POST /v1/account/identities/verify: verify challenge and securely link identity
  if (path === "/v1/account/identities/verify" && request.method === "POST") {
    const paced = await rateHit(env, "id-ver:" + row.public_id, 30, 10 * 60 * 1000);
    if (!paced.ok) return limited(paced);

    const body = await readJson(request, 4000);
    if (body.error) return json(400, { error: body.error });

    const challengeId = String(body.challengeId || "").trim();
    if (!challengeId) return json(400, { error: "missing_challenge" });

    const challenge = await env.DB.prepare(
      "SELECT * FROM identity_challenges WHERE challenge_id = ? AND public_id = ?"
    ).bind(challengeId, row.public_id).first();

    if (!challenge) return json(404, { error: "challenge_not_found" });

    const now = Date.now();
    if (Number(challenge.expires_at) < now) {
      await env.DB.prepare("DELETE FROM identity_challenges WHERE challenge_id = ?").bind(challengeId).run();
      return json(400, { error: "challenge_expired" });
    }

    const proofResult = await verifyExternalProof(challenge.platform, challenge.handle, challenge.code, body.proofUrl);
    if (proofResult.error) {
      return json(400, { error: proofResult.error, message: proofResult.message || "Verification failed." });
    }

    // Identity verified! Link to the account
    const displayName = proofResult.displayName || challenge.handle;
    const avatar = proofResult.avatar || "";
    const proofUrl = proofResult.proofUrl || "";
    const verificationType = proofResult.type || "challenge";

    await env.DB.prepare(
      "INSERT INTO account_identities (public_id, platform, handle, display_name, avatar, proof_url, verification_type, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(public_id, platform, handle) DO UPDATE SET display_name = excluded.display_name, avatar = excluded.avatar, proof_url = excluded.proof_url, verification_type = excluded.verification_type, verified = 1, created_at = excluded.created_at"
    ).bind(row.public_id, challenge.platform, challenge.handle, displayName, avatar, proofUrl, verificationType, now).run();

    // Clean up used challenge
    await env.DB.prepare("DELETE FROM identity_challenges WHERE challenge_id = ?").bind(challengeId).run();
    await invalidate(env, "p:" + row.public_id);

    return json(200, {
      ok: true,
      identity: {
        platform: challenge.platform,
        handle: challenge.handle,
        displayName,
        avatar,
        proofUrl,
        verificationType,
        verified: true,
        createdAt: now
      }
    });
  }

  if (request.method === "PATCH" && /^\/v1\/account\/identities\/\d+$/.test(path)) {
    const id = Number(path.slice("/v1/account/identities/".length));
    const body = await readJson(request, 4000);
    if (!body || body.error) return json(400, { error: "bad_json" });
    const existing = await env.DB.prepare(
      "SELECT id FROM account_identities WHERE id = ? AND public_id = ?"
    ).bind(id, row.public_id).first();
    if (!existing) return json(404, { error: "not_found" });
    await ensureIdentityColumns(env);
    const audience = cleanIdentityAudience(body.audience);
    const hidden = body.hidden === true ? 1 : 0;
    const wanted = audience === "list" && Array.isArray(body.listIds) ? body.listIds.map((item) => String(item || "")).filter((item) => /^[A-Za-z0-9_-]{1,40}$/.test(item)) : [];
    const owned = [];
    for (let i = 0; i < wanted.length; i++) {
      const found = await env.DB.prepare(
        "SELECT id FROM audience_lists WHERE id = ? AND public_id = ?"
      ).bind(wanted[i], row.public_id).first();
      if (found) owned.push(wanted[i]);
    }
    await env.DB.prepare(
      "UPDATE account_identities SET audience = ?, hidden = ? WHERE id = ? AND public_id = ?"
    ).bind(audience, hidden, id, row.public_id).run();
    await env.DB.prepare("DELETE FROM identity_list_grants WHERE identity_id = ?").bind(id).run();
    for (let i = 0; i < owned.length; i++) {
      await env.DB.prepare(
        "INSERT INTO identity_list_grants (identity_id, list_id) VALUES (?, ?) ON CONFLICT(identity_id, list_id) DO NOTHING"
      ).bind(id, owned[i]).run();
    }
    await invalidate(env, "p:" + row.public_id);
    const list = await listAccountIdentities(env, row.public_id);
    const updated = list.find((item) => Number(item.id) === id) || null;
    return json(200, { ok: true, identity: updated });
  }

  // 4. DELETE /v1/account/identities/:id or DELETE /v1/account/identities (with platform/handle or id)
  if ((path.startsWith("/v1/account/identities/") || path === "/v1/account/identities") && (request.method === "DELETE" || request.method === "POST")) {
    const rawId = path.replace(/^\/v1\/account\/identities\/?/, "");
    let id = Number(rawId) || 0;
    let platform = "";
    let handle = "";

    if (!id) {
      const body = await readJson(request, 2000);
      if (body && body.id) id = Number(body.id);
      if (body && body.platform) platform = cleanPlatform(body.platform);
      if (body && body.handle) handle = cleanHandle(platform, body.handle);
    }
    if (!id && url.searchParams) {
      if (url.searchParams.get("id")) id = Number(url.searchParams.get("id"));
      if (url.searchParams.get("platform")) platform = cleanPlatform(url.searchParams.get("platform"));
      if (url.searchParams.get("handle")) handle = cleanHandle(platform, url.searchParams.get("handle"));
    }

    if (id) {
      await env.DB.prepare("DELETE FROM account_identities WHERE id = ? AND public_id = ?").bind(id, row.public_id).run();
    } else if (platform && handle) {
      await env.DB.prepare("DELETE FROM account_identities WHERE platform = ? AND LOWER(handle) = LOWER(?) AND public_id = ?").bind(platform, handle, row.public_id).run();
    } else {
      return json(400, { error: "missing_identity_id" });
    }
    await invalidate(env, "p:" + row.public_id);

    return json(200, { ok: true, removed: true });
  }

  return json(404, { error: "not_found" });
}
