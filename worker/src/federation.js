/** Identity lookup for ViktorychApp: Nostr NIP-05 only.
 * Our profiles are not published to the fediverse. There is no ActivityPub
 * actor, WebFinger, inbox, outbox or follower list; fediverse profiles can
 * only be followed as feeds from the app.
 *
 * Privacy and boundary guarantees:
 * - Default is strictly OPTED OUT (disabled).
 * - Only internal accounts that have explicitly opted in are discoverable.
 * - Non-opted-in accounts and non-internal accounts get empty results on NIP-05.
 * - Private user data, reader feeds, encrypted storage vault, phone numbers,
 *   and session tokens are never exposed.
 */

import { inspectHandle } from "../../shared/handle-skeleton.js";

export const FEDERATION_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS account_federation (public_id TEXT PRIMARY KEY, enabled_ap INTEGER NOT NULL DEFAULT 0, enabled_nostr INTEGER NOT NULL DEFAULT 0, nostr_pubkey TEXT NOT NULL DEFAULT '', ap_public_key_pem TEXT NOT NULL DEFAULT '', ap_private_key_pem TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (public_id) REFERENCES accounts(public_id) ON DELETE CASCADE)"
];

const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function isPublicFederationRoute(path) {
  return path === "/.well-known/nostr.json";
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

  if (path === "/v1/federation/settings" && (request.method === "GET" || request.method === "POST")) {
    const viewer = await sessionAccount(env, request);
    if (!viewer) return json(401, { error: "unauthorized" });
    const existing = await env.DB.prepare(
      "SELECT enabled_nostr, nostr_pubkey FROM account_federation WHERE public_id = ?"
    ).bind(viewer.public_id).first();
    let enabledNostr = (existing && existing.enabled_nostr) ? 1 : 0;
    let nostrPubkey = (existing && existing.nostr_pubkey) || "";
    if (request.method === "POST") {
      let body = null;
      try {
        body = await readJson(request);
      } catch (_) {
        return json(400, { error: "invalid_json" });
      }
      if (!body || typeof body !== "object") return json(400, { error: "invalid_body" });
      if (body.enabled_nostr !== undefined) enabledNostr = body.enabled_nostr ? 1 : 0;
      if (body.nostr_pubkey !== undefined) {
        if (body.nostr_pubkey) {
          const parsed = parseNostrPubkey(body.nostr_pubkey);
          if (!parsed) return json(400, { error: "invalid_nostr_pubkey" });
          nostrPubkey = parsed;
        } else {
          nostrPubkey = "";
        }
      }
      const now = Date.now();
      // The ActivityPub columns stay in the table for old rows but are always cleared.
      await env.DB.prepare(
        "INSERT INTO account_federation (public_id, enabled_ap, enabled_nostr, nostr_pubkey, ap_public_key_pem, ap_private_key_pem, created_at, updated_at) " +
        "VALUES (?, 0, ?, ?, '', '', ?, ?) " +
        "ON CONFLICT(public_id) DO UPDATE SET enabled_ap = 0, enabled_nostr = excluded.enabled_nostr, nostr_pubkey = excluded.nostr_pubkey, " +
        "ap_public_key_pem = '', ap_private_key_pem = '', updated_at = excluded.updated_at"
      ).bind(viewer.public_id, enabledNostr, nostrPubkey, now, now).run();
    }
    const host = (env.FEDERATION_HOST || url.host).toLowerCase();
    return json(200, {
      ok: true,
      enabled_nostr: !!enabledNostr,
      nostr_pubkey: nostrPubkey,
      nostr_nip05: `${viewer.handle}@${host}`
    });
  }

  return json(404, { error: "not_found" });
}
