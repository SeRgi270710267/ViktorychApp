/** Federation module for ViktorychApp.
 * Provides ActivityPub (Fediverse / Mastodon) actor and WebFinger endpoints,
 * plus Nostr NIP-05 identity lookup.
 *
 * Privacy and boundary guarantees:
 * - Default is strictly OPTED OUT (disabled).
 * - Only internal accounts that have explicitly opted in are discoverable.
 * - Non-opted-in accounts and non-internal accounts return 404 on WebFinger / Actor
 *   and empty results on Nostr NIP-05.
 * - Private user data, reader feeds, encrypted storage vault, phone numbers,
 *   and session tokens are never exposed.
 */

import { inspectHandle } from "../../shared/handle-skeleton.js";

export const FEDERATION_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS account_federation (public_id TEXT PRIMARY KEY, enabled_ap INTEGER NOT NULL DEFAULT 0, enabled_nostr INTEGER NOT NULL DEFAULT 0, nostr_pubkey TEXT NOT NULL DEFAULT '', ap_public_key_pem TEXT NOT NULL DEFAULT '', ap_private_key_pem TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (public_id) REFERENCES accounts(public_id) ON DELETE CASCADE)",
  "CREATE TABLE IF NOT EXISTS ap_followers (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_handle TEXT NOT NULL, follower_actor_url TEXT NOT NULL, follower_inbox_url TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(actor_handle, follower_actor_url))",
  "CREATE INDEX IF NOT EXISTS ap_followers_handle ON ap_followers(actor_handle, created_at DESC)"
];

const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function isPublicFederationRoute(path) {
  if (path === "/.well-known/webfinger" || path === "/.well-known/nostr.json") return true;
  if (path.startsWith("/ap/")) return true;
  return false;
}

function bytesToBase64(bytes) {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toPem(buffer, type) {
  const b64 = bytesToBase64(new Uint8Array(buffer));
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
}

export async function generateRsaKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return {
    publicKeyPem: toPem(spki, "PUBLIC KEY"),
    privateKeyPem: toPem(pkcs8, "PRIVATE KEY")
  };
}

export function parseNostrPubkey(input) {
  if (!input || typeof input !== "string") return "";
  const raw = input.trim();
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return raw.toLowerCase();
  if (raw.toLowerCase().startsWith("npub1")) {
    const dataPart = raw.slice(5).toLowerCase();
    const values = [];
    for (let i = 0; i < dataPart.length; i++) {
      const idx = BECH32_ALPHABET.indexOf(dataPart[i]);
      if (idx === -1) return "";
      values.push(idx);
    }
    if (values.length < 6) return "";
    const payload = values.slice(0, -6);
    let acc = 0;
    let bits = 0;
    const bytes = [];
    for (const val of payload) {
      acc = (acc << 5) | val;
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        bytes.push((acc >> bits) & 0xff);
      }
    }
    if (bytes.length !== 32) return "";
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  }
  return "";
}

function federationResponse(status, body, contentType) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": contentType || "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, Accept, Signature",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function handleFederationRoute(request, env, path, url, helpers) {
  const { json, sessionAccount, readJson } = helpers;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization, Accept, Signature",
        "access-control-max-age": "86400"
      }
    });
  }

  // 1. Nostr NIP-05: /.well-known/nostr.json?name=<name>
  if (path === "/.well-known/nostr.json" && (request.method === "GET" || request.method === "HEAD")) {
    const name = String(url.searchParams.get("name") || "").trim();
    if (!name) {
      // Empty names object prevents snooping
      return federationResponse(200, { names: {} });
    }
    const skel = inspectHandle(name).skeleton || "";
    if (!skel) return federationResponse(200, { names: {} });

    const row = await env.DB.prepare(
      "SELECT a.handle, f.enabled_nostr, f.nostr_pubkey FROM accounts a JOIN account_federation f ON a.public_id = f.public_id WHERE a.skeleton = ? AND f.enabled_nostr = 1"
    ).bind(skel).first();

    if (!row || !row.nostr_pubkey) {
      return federationResponse(200, { names: {} });
    }

    const names = {};
    names[row.handle] = row.nostr_pubkey;
    if (name.toLowerCase() !== row.handle.toLowerCase()) {
      names[name] = row.nostr_pubkey;
    }
    return federationResponse(200, { names });
  }

  // 2. WebFinger: /.well-known/webfinger?resource=acct:handle@domain
  if (path === "/.well-known/webfinger" && (request.method === "GET" || request.method === "HEAD")) {
    const resource = String(url.searchParams.get("resource") || "").trim();
    if (!resource) return federationResponse(400, { error: "missing_resource" });

    const match = resource.match(/^acct:([a-zA-Z0-9_\-\.]+)(?:@([a-zA-Z0-9_\-\.:]+))?$/i);
    if (!match) return federationResponse(400, { error: "invalid_resource" });

    const reqHandle = match[1];
    const reqDomain = match[2];
    const host = (env.FEDERATION_HOST || url.host).toLowerCase();

    if (reqDomain && reqDomain.toLowerCase() !== host) {
      return federationResponse(404, { error: "user_not_found" });
    }

    const skel = inspectHandle(reqHandle).skeleton || "";
    if (!skel) return federationResponse(404, { error: "user_not_found" });

    const row = await env.DB.prepare(
      "SELECT a.handle, a.display_name, f.enabled_ap FROM accounts a JOIN account_federation f ON a.public_id = f.public_id WHERE a.skeleton = ? AND f.enabled_ap = 1"
    ).bind(skel).first();

    if (!row || !row.enabled_ap) {
      return federationResponse(404, { error: "user_not_found" });
    }

    const origin = url.origin;
    const actorUrl = `${origin}/ap/users/${encodeURIComponent(row.handle)}`;
    const profileUrl = `${origin}/#/profile/${encodeURIComponent(row.handle)}`;

    const jrd = {
      subject: `acct:${row.handle}@${host}`,
      aliases: [actorUrl],
      links: [
        {
          rel: "http://webfinger.net/rel/profile-page",
          type: "text/html",
          href: profileUrl
        },
        {
          rel: "self",
          type: "application/activity+json",
          href: actorUrl
        }
      ]
    };
    return federationResponse(200, jrd, "application/jrd+json; charset=utf-8");
  }

  // 3. ActivityPub Actor: /ap/users/:handle
  const actorMatch = path.match(/^\/ap\/users\/([^/]+)$/);
  if (actorMatch && (request.method === "GET" || request.method === "HEAD")) {
    let handle = actorMatch[1];
    try { handle = decodeURIComponent(handle); } catch (_) {}

    const skel = inspectHandle(handle).skeleton || "";
    if (!skel) return federationResponse(404, { error: "not_found" });

    const row = await env.DB.prepare(
      "SELECT a.public_id, a.handle, a.display_name, a.avatar, a.bio, f.enabled_ap, f.ap_public_key_pem FROM accounts a JOIN account_federation f ON a.public_id = f.public_id WHERE a.skeleton = ? AND f.enabled_ap = 1"
    ).bind(skel).first();

    if (!row || !row.enabled_ap) return federationResponse(404, { error: "not_found" });

    const origin = url.origin;
    const actorId = `${origin}/ap/users/${encodeURIComponent(row.handle)}`;

    const actor = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1"
      ],
      id: actorId,
      type: "Person",
      preferredUsername: row.handle,
      name: row.display_name,
      summary: row.bio || "",
      url: `${origin}/#/profile/${encodeURIComponent(row.handle)}`,
      inbox: `${actorId}/inbox`,
      outbox: `${actorId}/outbox`,
      followers: `${actorId}/followers`,
      publicKey: {
        id: `${actorId}#main-key`,
        owner: actorId,
        publicKeyPem: row.ap_public_key_pem || ""
      }
    };
    if (row.avatar) {
      actor.icon = {
        type: "Image",
        mediaType: "image/jpeg",
        url: row.avatar
      };
    }

    return federationResponse(200, actor, "application/activity+json; charset=utf-8");
  }

  // 4. ActivityPub Inbox: /ap/users/:handle/inbox
  const inboxMatch = path.match(/^\/ap\/users\/([^/]+)\/inbox$/);
  if (inboxMatch && request.method === "POST") {
    let handle = inboxMatch[1];
    try { handle = decodeURIComponent(handle); } catch (_) {}

    const skel = inspectHandle(handle).skeleton || "";
    if (!skel) return federationResponse(404, { error: "not_found" });

    const row = await env.DB.prepare(
      "SELECT a.public_id, a.handle, f.enabled_ap FROM accounts a JOIN account_federation f ON a.public_id = f.public_id WHERE a.skeleton = ? AND f.enabled_ap = 1"
    ).bind(skel).first();

    if (!row || !row.enabled_ap) return federationResponse(404, { error: "not_found" });

    let activity = null;
    try {
      activity = await readJson(request);
    } catch (_) {
      return federationResponse(400, { error: "invalid_json" });
    }

    if (!activity || typeof activity !== "object") {
      return federationResponse(400, { error: "invalid_activity" });
    }

    const type = String(activity.type || "");

    if (type === "Follow") {
      const followerActor = String(activity.actor || "").trim();
      if (followerActor) {
        await env.DB.prepare(
          "INSERT INTO ap_followers (actor_handle, follower_actor_url, follower_inbox_url, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(actor_handle, follower_actor_url) DO UPDATE SET follower_inbox_url = excluded.follower_inbox_url"
        ).bind(row.handle, followerActor, followerActor, Date.now()).run();
      }
      return federationResponse(202, { status: "accepted" });
    }

    if (type === "Undo") {
      const obj = activity.object || {};
      const followerActor = String(activity.actor || obj.actor || "").trim();
      if (followerActor) {
        await env.DB.prepare(
          "DELETE FROM ap_followers WHERE actor_handle = ? AND follower_actor_url = ?"
        ).bind(row.handle, followerActor).run();
      }
      return federationResponse(202, { status: "accepted" });
    }

    return federationResponse(202, { status: "received" });
  }

  // 5. ActivityPub Outbox: /ap/users/:handle/outbox
  const outboxMatch = path.match(/^\/ap\/users\/([^/]+)\/outbox$/);
  if (outboxMatch && (request.method === "GET" || request.method === "HEAD")) {
    let handle = outboxMatch[1];
    try { handle = decodeURIComponent(handle); } catch (_) {}

    const skel = inspectHandle(handle).skeleton || "";
    if (!skel) return federationResponse(404, { error: "not_found" });

    const row = await env.DB.prepare(
      "SELECT a.public_id, a.handle, f.enabled_ap FROM accounts a JOIN account_federation f ON a.public_id = f.public_id WHERE a.skeleton = ? AND f.enabled_ap = 1"
    ).bind(skel).first();

    if (!row || !row.enabled_ap) return federationResponse(404, { error: "not_found" });

    const repostRows = await env.DB.prepare(
      "SELECT post_key, kind, comment, snapshot, created_at FROM account_reposts WHERE public_id = ? ORDER BY created_at DESC LIMIT 20"
    ).bind(row.public_id).all();

    const origin = url.origin;
    const actorId = `${origin}/ap/users/${encodeURIComponent(row.handle)}`;
    const items = [];

    for (const r of (repostRows && repostRows.results) || []) {
      const noteId = `${actorId}/notes/${encodeURIComponent(r.post_key)}`;
      let content = r.comment || "";
      if (!content && r.snapshot) {
        try {
          const snap = JSON.parse(r.snapshot);
          content = snap.text || snap.title || "";
        } catch (_) {}
      }
      items.push({
        id: `${noteId}/activity`,
        type: "Create",
        actor: actorId,
        published: new Date(r.created_at).toISOString(),
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        object: {
          id: noteId,
          type: "Note",
          attributedTo: actorId,
          content: content,
          published: new Date(r.created_at).toISOString(),
          to: ["https://www.w3.org/ns/activitystreams#Public"]
        }
      });
    }

    const outbox = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actorId}/outbox`,
      type: "OrderedCollection",
      totalItems: items.length,
      orderedItems: items
    };

    return federationResponse(200, outbox, "application/activity+json; charset=utf-8");
  }

  // 6. ActivityPub Followers Collection: /ap/users/:handle/followers
  const followersMatch = path.match(/^\/ap\/users\/([^/]+)\/followers$/);
  if (followersMatch && (request.method === "GET" || request.method === "HEAD")) {
    let handle = followersMatch[1];
    try { handle = decodeURIComponent(handle); } catch (_) {}

    const skel = inspectHandle(handle).skeleton || "";
    if (!skel) return federationResponse(404, { error: "not_found" });

    const row = await env.DB.prepare(
      "SELECT a.public_id, a.handle, f.enabled_ap FROM accounts a JOIN account_federation f ON a.public_id = f.public_id WHERE a.skeleton = ? AND f.enabled_ap = 1"
    ).bind(skel).first();

    if (!row || !row.enabled_ap) return federationResponse(404, { error: "not_found" });

    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM ap_followers WHERE actor_handle = ?"
    ).bind(row.handle).first();

    const count = Number(countRow && countRow.total) || 0;
    const actorId = `${url.origin}/ap/users/${encodeURIComponent(row.handle)}`;

    return federationResponse(200, {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actorId}/followers`,
      type: "OrderedCollection",
      totalItems: count
    }, "application/activity+json; charset=utf-8");
  }

  // 7. Authenticated Settings: GET /v1/federation/settings
  if (path === "/v1/federation/settings" && request.method === "GET") {
    const viewer = await sessionAccount(env, request);
    if (!viewer) return json(401, { error: "unauthorized" });

    const host = (env.FEDERATION_HOST || url.host).toLowerCase();
    const origin = url.origin;

    const row = await env.DB.prepare(
      "SELECT enabled_ap, enabled_nostr, nostr_pubkey, ap_public_key_pem FROM account_federation WHERE public_id = ?"
    ).bind(viewer.public_id).first();

    const enabledAp = !!(row && row.enabled_ap);
    const enabledNostr = !!(row && row.enabled_nostr);
    const nostrPubkey = (row && row.nostr_pubkey) || "";

    return json(200, {
      enabled_ap: enabledAp,
      enabled_nostr: enabledNostr,
      nostr_pubkey: nostrPubkey,
      ap_handle: `@${viewer.handle}@${host}`,
      ap_actor_url: `${origin}/ap/users/${encodeURIComponent(viewer.handle)}`,
      nostr_nip05: `${viewer.handle}@${host}`,
      has_ap_keys: !!(row && row.ap_public_key_pem)
    });
  }

  // 8. Authenticated Settings: POST /v1/federation/settings (Opt in or Opt out)
  if (path === "/v1/federation/settings" && request.method === "POST") {
    const viewer = await sessionAccount(env, request);
    if (!viewer) return json(401, { error: "unauthorized" });

    let body = null;
    try {
      body = await readJson(request);
    } catch (_) {
      return json(400, { error: "invalid_json" });
    }
    if (!body || typeof body !== "object") return json(400, { error: "invalid_body" });

    const existing = await env.DB.prepare(
      "SELECT enabled_ap, enabled_nostr, nostr_pubkey, ap_public_key_pem, ap_private_key_pem FROM account_federation WHERE public_id = ?"
    ).bind(viewer.public_id).first();

    let enabledAp = body.enabled_ap !== undefined ? (body.enabled_ap ? 1 : 0) : ((existing && existing.enabled_ap) || 0);
    let enabledNostr = body.enabled_nostr !== undefined ? (body.enabled_nostr ? 1 : 0) : ((existing && existing.enabled_nostr) || 0);

    let nostrPubkey = existing ? existing.nostr_pubkey : "";
    if (body.nostr_pubkey !== undefined) {
      if (body.nostr_pubkey) {
        const parsed = parseNostrPubkey(body.nostr_pubkey);
        if (!parsed) return json(400, { error: "invalid_nostr_pubkey" });
        nostrPubkey = parsed;
      } else {
        nostrPubkey = "";
      }
    }

    let apPublicPem = existing ? (existing.ap_public_key_pem || "") : "";
    let apPrivatePem = existing ? (existing.ap_private_key_pem || "") : "";

    // If opting in to AP and keys do not exist yet, generate RSA keypair
    if (enabledAp && (!apPublicPem || !apPrivatePem)) {
      const generated = await generateRsaKeyPair();
      apPublicPem = generated.publicKeyPem;
      apPrivatePem = generated.privateKeyPem;
    }

    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO account_federation (public_id, enabled_ap, enabled_nostr, nostr_pubkey, ap_public_key_pem, ap_private_key_pem, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(public_id) DO UPDATE SET " +
      "enabled_ap = excluded.enabled_ap, " +
      "enabled_nostr = excluded.enabled_nostr, " +
      "nostr_pubkey = excluded.nostr_pubkey, " +
      "ap_public_key_pem = CASE WHEN excluded.ap_public_key_pem != '' THEN excluded.ap_public_key_pem ELSE account_federation.ap_public_key_pem END, " +
      "ap_private_key_pem = CASE WHEN excluded.ap_private_key_pem != '' THEN excluded.ap_private_key_pem ELSE account_federation.ap_private_key_pem END, " +
      "updated_at = excluded.updated_at"
    ).bind(viewer.public_id, enabledAp, enabledNostr, nostrPubkey, apPublicPem, apPrivatePem, now, now).run();

    const host = (env.FEDERATION_HOST || url.host).toLowerCase();
    const origin = url.origin;

    return json(200, {
      ok: true,
      enabled_ap: !!enabledAp,
      enabled_nostr: !!enabledNostr,
      nostr_pubkey: nostrPubkey,
      ap_handle: `@${viewer.handle}@${host}`,
      ap_actor_url: `${origin}/ap/users/${encodeURIComponent(viewer.handle)}`,
      nostr_nip05: `${viewer.handle}@${host}`,
      has_ap_keys: !!apPublicPem
    });
  }

  return json(404, { error: "not_found" });
}
