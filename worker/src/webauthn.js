/* Passkey registration and login. D1 stores the COSE public key, the
   credential id, and a short-lived challenge. Private keys are never sent. */

import { inspectHandle, ownerHandle } from "../../shared/handle-skeleton.js";
import { blockDeletedLogin, handleHeld } from "./account-delete.js";
import { verifySignupGuard } from "./signup-guard.js";
import {
  CHALLENGE_MS,
  b64urlToBytes,
  bytesEqual,
  bytesToB64url,
  creationOptions,
  randomBytes,
  requestOptions,
  rpIdForOrigin,
  verifyAssertion,
  verifyRegistration
} from "../../shared/webauthn.js";

const TRANSPORTS = new Set(["usb", "nfc", "ble", "internal", "hybrid", "smart-card"]);
const MAX_KEYS = 10;

export const WEBAUTHN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    challenge TEXT NOT NULL,
    origin TEXT NOT NULL,
    rp_id TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS webauthn_challenges_exp ON webauthn_challenges(expires_at)",
  `CREATE TABLE IF NOT EXISTS webauthn_credentials (
    credential_id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL,
    rp_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    algorithm INTEGER NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    aaguid TEXT NOT NULL DEFAULT '',
    backup_eligible INTEGER NOT NULL DEFAULT 0,
    backup_state INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS webauthn_credentials_account ON webauthn_credentials(public_id, rp_id)"
];

function cleanName(value) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > 50) return "";
  return text;
}

function cleanLabel(value) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 40).join("") || "Passkey";
}

function cleanTransports(list) {
  const out = [];
  const items = Array.isArray(list) ? list : String(list || "").split(",");
  for (let i = 0; i < items.length; i++) {
    const text = String(items[i] || "").trim().toLowerCase();
    if (TRANSPORTS.has(text) && out.indexOf(text) < 0) out.push(text);
  }
  return out.join(",");
}

function randomDigits(count) {
  const out = [];
  const buf = new Uint16Array(count);
  while (out.length < count) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < count; i++) {
      if (buf[i] >= 65530) continue;
      out.push(String(buf[i] % 10));
    }
  }
  return out.join("");
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
}

function party(request, env, deps) {
  const origin = request.headers.get("Origin") || "";
  if (!origin || !deps.originAllowed(env, origin)) return null;
  const rpId = rpIdForOrigin(origin);
  if (!rpId) return null;
  return { origin: origin, rpId: rpId };
}

async function sweep(env) {
  await env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ?").bind(Date.now()).run();
}

async function freshPublicId(env) {
  for (let i = 0; i < 6; i++) {
    const id = randomDigits(12);
    const taken = await env.DB.prepare("SELECT public_id FROM accounts WHERE public_id = ?").bind(id).first();
    const pending = await env.DB.prepare("SELECT id FROM webauthn_challenges WHERE public_id = ? AND expires_at > ?").bind(id, Date.now()).first();
    if (!taken && !pending) return id;
  }
  return "";
}

async function putChallenge(env, fields) {
  const id = bytesToB64url(randomBytes(32));
  const challenge = randomBytes(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO webauthn_challenges (id, public_id, kind, challenge, origin, rp_id, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
    id,
    fields.publicId || "",
    fields.kind,
    bytesToB64url(challenge),
    fields.origin,
    fields.rpId,
    fields.payload || "",
    now + CHALLENGE_MS,
    now
  ).run();
  return { id: id, challenge: challenge };
}

async function takeChallenge(env, id, kind, partyInfo) {
  const text = String(id || "");
  if (!text || text.length > 80) return null;
  const row = await env.DB.prepare("SELECT id, public_id, kind, challenge, origin, rp_id, payload, expires_at FROM webauthn_challenges WHERE id = ?").bind(text).first();
  if (!row) return null;
  await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(text).run();
  if (row.kind !== kind) return null;
  if (Number(row.expires_at) <= Date.now()) return null;
  if (row.origin !== partyInfo.origin || row.rp_id !== partyInfo.rpId) return null;
  let challenge;
  try { challenge = b64urlToBytes(row.challenge); }
  catch (err) { return null; }
  return { publicId: row.public_id || "", payload: row.payload || "", challenge: challenge };
}

function credentialIdOf(body) {
  const credential = body && body.credential;
  if (!credential || credential.type !== "public-key") return "";
  const raw = credential.rawId || credential.id || "";
  if (typeof raw !== "string" || raw.length < 8 || raw.length > 512) return "";
  return raw;
}

async function signupFields(env, body) {
  const isProfileLess = !!body.profileLess;
  let displayName = cleanName(body.displayName);
  if (!displayName) {
    if (!isProfileLess) return { error: "invalid_name", status: 400 };
    displayName = "Anonymous";
  }
  let handleInput = body.handle;
  if (!handleInput && isProfileLess) handleInput = "anon_" + randomDigits(8);
  const checked = inspectHandle(handleInput);
  if (!checked.ok) {
    if (checked.error === "reserved") return { error: "handle_reserved", status: 409 };
    return { error: "invalid_handle", status: 400 };
  }
  if (isProfileLess && checked.owner) return { error: "invalid_handle", status: 400 };
  if (checked.owner) {
    const code = String(body.claimCode || "");
    const secret = String(env.OWNER_CLAIM_CODE || "");
    if (!code) return { error: "claim_required", status: 403 };
    if (!secret || !depsTiming(code, secret)) return { error: "invalid_claim", status: 403 };
    const existing = await env.DB.prepare("SELECT public_id FROM accounts WHERE owner = 1").first();
    if (existing) return { error: "handle_taken", status: 409 };
  }
  const clash = await env.DB.prepare("SELECT public_id FROM accounts WHERE skeleton = ?").bind(checked.skeleton).first();
  if (clash) return { error: "handle_taken", status: 409 };
  if (await handleHeld(env, checked.skeleton)) return { error: "handle_held", status: 409 };
  return {
    handle: checked.owner ? ownerHandle() : checked.handle,
    skeleton: checked.skeleton,
    displayName: displayName,
    owner: !!checked.owner,
    profileLess: isProfileLess
  };
}

function depsTiming(a, b) {
  const left = String(a);
  const right = String(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

function userName(fields) {
  return fields.profileLess ? "account" : fields.handle;
}

async function countKeys(env, publicId, rpId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM webauthn_credentials WHERE public_id = ? AND rp_id = ?").bind(publicId, rpId).first();
  return Number(row && row.n || 0);
}

function listedCredential(row) {
  return {
    id: row.credential_id,
    label: row.label || "Passkey",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || 0,
    transports: String(row.transports || "").split(",").filter(Boolean),
    rpId: row.rp_id,
    backupEligible: !!row.backup_eligible
  };
}

async function insertCredential(env, publicId, partyInfo, verified, body) {
  const id = bytesToB64url(verified.credentialId);
  const transports = cleanTransports(body && body.credential && body.credential.response && body.credential.response.transports);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO webauthn_credentials (credential_id, public_id, rp_id, public_key, algorithm, sign_count, transports, label, aaguid, backup_eligible, backup_state, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").bind(
    id,
    publicId,
    partyInfo.rpId,
    bytesToB64url(verified.publicKey),
    verified.algorithm,
    verified.signCount || 0,
    transports,
    cleanLabel(body && body.label),
    verified.aaguid || "",
    verified.backupEligible ? 1 : 0,
    verified.backupState ? 1 : 0,
    now
  ).run();
  return id;
}

async function registrationBody(body) {
  const response = body && body.credential && body.credential.response;
  if (!response || !response.clientDataJSON || !response.attestationObject) return null;
  return response;
}

async function assertionBody(body) {
  const response = body && body.credential && body.credential.response;
  if (!response || !response.clientDataJSON || !response.authenticatorData || !response.signature) return null;
  return response;
}

export async function handleWebAuthn(request, env, path, deps) {
  if (!env.ACCOUNT_PEPPER || !env.DB) return deps.json(503, { error: "not_configured" });
  await sweep(env);
  const site = party(request, env, deps);
  if (!site) return deps.json(403, { error: "origin" });
  const ip = clientIp(request);

  if (path === "/v1/webauthn/signup/options" && request.method === "POST") {
    const gate = await deps.rateHit(env, "su-try:" + ip, 12, 60 * 60 * 1000);
    if (!gate.ok) return deps.limited(gate);
    const body = await deps.readJson(request, 8000);
    if (body.error) return deps.json(400, { error: body.error });
    if (!(await deps.verifyTurnstile(request, env, body.turnstileToken))) return deps.json(403, { error: "turnstile" });
    const guard = await verifySignupGuard(env, body);
    if (!guard.ok) return deps.json(guard.status || 400, { error: guard.error || "guard_required" });
    const fields = await signupFields(env, body);
    if (fields.error) return deps.json(fields.status, { error: fields.error });
    const publicId = await freshPublicId(env);
    if (!publicId) return deps.json(503, { error: "unavailable" });
    const prior = await env.DB.prepare("SELECT hits, reset_at FROM rate_limits WHERE bucket = ?").bind("su-ok:" + ip).first();
    if (prior && Number(prior.reset_at) > Date.now() && Number(prior.hits) >= 4) {
      return deps.limited({ retry: Math.max(1, Math.ceil((Number(prior.reset_at) - Date.now()) / 1000)) });
    }
    const stored = await putChallenge(env, {
      publicId: publicId,
      kind: "signup",
      origin: site.origin,
      rpId: site.rpId,
      payload: JSON.stringify({
        publicId: publicId,
        handle: fields.handle,
        skeleton: fields.skeleton,
        displayName: fields.displayName,
        owner: fields.owner,
        profileLess: fields.profileLess
      })
    });
    return deps.json(200, {
      challengeId: stored.id,
      publicKey: creationOptions({
        rpId: site.rpId,
        userId: new TextEncoder().encode(publicId),
        userName: userName(fields),
        userDisplayName: fields.displayName,
        challenge: stored.challenge
      })
    });
  }

  if (path === "/v1/webauthn/signup/verify" && request.method === "POST") {
    const gate = await deps.rateHit(env, "wa-su:" + ip, 20, 15 * 60 * 1000);
    if (!gate.ok) return deps.limited(gate);
    const body = await deps.readJson(request, 48000);
    if (body.error) return deps.json(400, { error: body.error });
    if (!(await deps.verifyTurnstile(request, env, body.turnstileToken))) return deps.json(403, { error: "turnstile" });
    const pending = await takeChallenge(env, body.challengeId, "signup", site);
    if (!pending) return deps.json(400, { error: "challenge" });
    const response = await registrationBody(body);
    if (!response) return deps.json(400, { error: "passkey_failed" });
    let verified;
    try {
      verified = await verifyRegistration({
        clientDataJSON: response.clientDataJSON,
        attestationObject: response.attestationObject,
        challenge: pending.challenge,
        origin: site.origin,
        rpId: site.rpId
      });
    } catch (err) {
      return deps.json(401, { error: "passkey_failed" });
    }
    const rawId = credentialIdOf(body);
    if (!rawId || !bytesEqual(b64urlToBytes(rawId), verified.credentialId)) return deps.json(401, { error: "passkey_failed" });
    let payload;
    try { payload = JSON.parse(pending.payload || "{}"); }
    catch (err) { return deps.json(400, { error: "challenge" }); }
    const clash = await env.DB.prepare("SELECT credential_id FROM webauthn_credentials WHERE credential_id = ?").bind(rawId).first();
    if (clash) return deps.json(409, { error: "passkey_exists" });
    const created = await deps.createAccount(env, request, {
      handle: payload.handle,
      skeleton: payload.skeleton,
      displayName: payload.displayName,
      owner: !!payload.owner,
      profileLess: !!payload.profileLess,
      publicId: payload.publicId
    });
    if (created.error) return deps.json(created.error === "handle_taken" ? 409 : 503, { error: created.error });
    try {
      await insertCredential(env, created.account.publicId, site, verified, body);
    } catch (err) {
      return deps.json(409, { error: "passkey_exists" });
    }
    await deps.rateHit(env, "su-ok:" + ip, 100, 60 * 60 * 1000);
    const recoveryCodes = deps.issueRecoveryCodes ? await deps.issueRecoveryCodes(created.account.publicId) : [];
    return deps.json(201, { token: created.token, accountNumber: created.accountNumber, recoveryCodes: recoveryCodes, account: created.account });
  }

  if (path === "/v1/webauthn/login/options" && request.method === "POST") {
    const gate = await deps.rateHit(env, "li:" + ip, 15, 15 * 60 * 1000);
    if (!gate.ok) return deps.limited(gate);
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: body.error });
    const stored = await putChallenge(env, { kind: "login", origin: site.origin, rpId: site.rpId, payload: "" });
    return deps.json(200, {
      challengeId: stored.id,
      publicKey: requestOptions({ rpId: site.rpId, challenge: stored.challenge, userVerification: "preferred" })
    });
  }

  if (path === "/v1/webauthn/login/verify" && request.method === "POST") {
    const gate = await deps.rateHit(env, "wa-li:" + ip, 20, 15 * 60 * 1000);
    if (!gate.ok) return deps.limited(gate);
    const body = await deps.readJson(request, 16000);
    if (body.error) return deps.json(400, { error: body.error });
    const pending = await takeChallenge(env, body.challengeId, "login", site);
    if (!pending) return deps.json(400, { error: "challenge" });
    const response = await assertionBody(body);
    const rawId = credentialIdOf(body);
    if (!response || !rawId) return deps.json(401, { error: "passkey_failed" });
    const row = await env.DB.prepare("SELECT credential_id, public_id, rp_id, public_key, sign_count FROM webauthn_credentials WHERE credential_id = ?").bind(rawId).first();
    if (!row || row.rp_id !== site.rpId) return deps.json(401, { error: "passkey_failed" });
    let verified;
    try {
      verified = await verifyAssertion({
        clientDataJSON: response.clientDataJSON,
        authenticatorData: response.authenticatorData,
        signature: response.signature,
        publicKey: b64urlToBytes(row.public_key),
        challenge: pending.challenge,
        origin: site.origin,
        rpId: site.rpId,
        signCount: row.sign_count
      });
    } catch (err) {
      return deps.json(401, { error: "passkey_failed" });
    }
    if (await blockDeletedLogin(env, row.public_id)) return deps.json(410, { error: "account_deleted" });
    const accountRow = await env.DB.prepare("SELECT public_id, handle, display_name, avatar, banner, bio, location, website, owner, created_at, hide_avatar, avatar_empty, banner_empty, private_follows, profile_less FROM accounts WHERE public_id = ?").bind(row.public_id).first();
    if (!accountRow) return deps.json(401, { error: "passkey_failed" });
    const now = Date.now();
    await env.DB.prepare("UPDATE webauthn_credentials SET sign_count = ?, last_used_at = ?, backup_state = ? WHERE credential_id = ?").bind(
      verified.signCount || row.sign_count || 0,
      now,
      verified.backupState ? 1 : 0,
      rawId
    ).run();
    const token = await deps.mintSession(env, row.public_id);
    return deps.json(200, { token: token, account: await deps.presentAccount(env, request, accountRow, true) });
  }

  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });

  if (path === "/v1/webauthn/credentials" && request.method === "GET") {
    const listed = await env.DB.prepare("SELECT credential_id, label, created_at, last_used_at, transports, rp_id, backup_eligible FROM webauthn_credentials WHERE public_id = ? AND rp_id = ? ORDER BY created_at DESC").bind(session.public_id, site.rpId).all();
    const rows = (listed && listed.results) || [];
    return deps.json(200, { credentials: rows.map(listedCredential) });
  }

  if (path === "/v1/webauthn/register/options" && request.method === "POST") {
    const gate = await deps.rateHit(env, "wa-add:" + session.public_id, 20, 60 * 60 * 1000);
    if (!gate.ok) return deps.limited(gate);
    if (await countKeys(env, session.public_id, site.rpId) >= MAX_KEYS) return deps.json(409, { error: "passkey_limit" });
    const existing = await env.DB.prepare("SELECT credential_id, transports FROM webauthn_credentials WHERE public_id = ? AND rp_id = ?").bind(session.public_id, site.rpId).all();
    const rows = (existing && existing.results) || [];
    const exclude = rows.map((row) => ({
      type: "public-key",
      id: row.credential_id,
      transports: String(row.transports || "").split(",").filter(Boolean)
    }));
    const stored = await putChallenge(env, {
      publicId: session.public_id,
      kind: "register",
      origin: site.origin,
      rpId: site.rpId,
      payload: ""
    });
    return deps.json(200, {
      challengeId: stored.id,
      publicKey: creationOptions({
        rpId: site.rpId,
        userId: new TextEncoder().encode(session.public_id),
        userName: session.handle || "account",
        userDisplayName: session.display_name || "Account",
        challenge: stored.challenge,
        excludeCredentials: exclude
      })
    });
  }

  if (path === "/v1/webauthn/register/verify" && request.method === "POST") {
    const gate = await deps.rateHit(env, "wa-add:" + session.public_id, 20, 60 * 60 * 1000);
    if (!gate.ok) return deps.limited(gate);
    const body = await deps.readJson(request, 48000);
    if (body.error) return deps.json(400, { error: body.error });
    const pending = await takeChallenge(env, body.challengeId, "register", site);
    if (!pending || pending.publicId !== session.public_id) return deps.json(400, { error: "challenge" });
    const response = await registrationBody(body);
    if (!response) return deps.json(400, { error: "passkey_failed" });
    let verified;
    try {
      verified = await verifyRegistration({
        clientDataJSON: response.clientDataJSON,
        attestationObject: response.attestationObject,
        challenge: pending.challenge,
        origin: site.origin,
        rpId: site.rpId
      });
    } catch (err) {
      return deps.json(401, { error: "passkey_failed" });
    }
    const rawId = credentialIdOf(body);
    if (!rawId || !bytesEqual(b64urlToBytes(rawId), verified.credentialId)) return deps.json(401, { error: "passkey_failed" });
    if (await countKeys(env, session.public_id, site.rpId) >= MAX_KEYS) return deps.json(409, { error: "passkey_limit" });
    try {
      await insertCredential(env, session.public_id, site, verified, body);
    } catch (err) {
      return deps.json(409, { error: "passkey_exists" });
    }
    return deps.json(200, { ok: true });
  }

  if (path === "/v1/webauthn/credentials" && request.method === "DELETE") {
    const body = await deps.readJson(request, 2000);
    if (body.error) return deps.json(400, { error: body.error });
    const id = String(body.credentialId || "");
    if (!id || id.length > 512) return deps.json(400, { error: "passkey_failed" });
    await env.DB.prepare("DELETE FROM webauthn_credentials WHERE credential_id = ? AND public_id = ?").bind(id, session.public_id).run();
    return deps.json(200, { ok: true });
  }

  return deps.json(404, { error: "not_found" });
}
