/* One-time recovery codes. Only a salted hash is stored. The plain codes
   are returned once, to the person who just created or rotated them. */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_COUNT = 10;

export const RECOVERY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS recovery_codes (code_lookup TEXT PRIMARY KEY, public_id TEXT NOT NULL, code_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS recovery_codes_account ON recovery_codes(public_id, created_at)"
];

export function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 12);
}

export function formatCode(raw) {
  const text = normalizeCode(raw);
  return text.replace(/(.{4})(?=.)/g, "$1-");
}

function randomCode() {
  const out = [];
  const buf = new Uint16Array(16);
  while (out.length < 12) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < 12; i++) {
      if (buf[i] >= 65504) continue;
      out.push(ALPHABET[buf[i] % ALPHABET.length]);
    }
  }
  return out.join("");
}

function codeRounds(env, deps) {
  return deps.codeIterationsOf ? deps.codeIterationsOf(env) : deps.iterationsOf(env);
}

export async function issueRecoveryCodes(env, publicId, deps) {
  await env.DB.prepare("DELETE FROM recovery_codes WHERE public_id = ?").bind(publicId).run();
  const rounds = codeRounds(env, deps);
  const now = Date.now();
  const codes = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    const raw = randomCode();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const lookup = await deps.hmacHex(env.ACCOUNT_PEPPER, normalizeCode(raw));
    const hash = await deps.slowHash(normalizeCode(raw), salt, rounds);
    await env.DB.prepare("INSERT INTO recovery_codes (code_lookup, public_id, code_hash, salt, created_at, used_at) VALUES (?, ?, ?, ?, ?, 0)").bind(
      lookup, publicId, hash, deps.bytesToB64(salt), now
    ).run();
    codes.push(formatCode(raw));
  }
  return codes;
}

export async function rotateAccountNumber(env, publicId, deps) {
  const number = deps.randomDigits(16);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rounds = deps.iterationsOf(env);
  const lookup = await deps.hmacHex(env.ACCOUNT_PEPPER, number);
  const raw = await deps.slowHash(number, salt, rounds);
  const hash = deps.encodeNumberHash ? deps.encodeNumberHash(rounds, raw) : raw;
  await env.DB.prepare("UPDATE accounts SET number_lookup = ?, number_hash = ?, salt = ? WHERE public_id = ?").bind(
    lookup, hash, deps.bytesToB64(salt), publicId
  ).run();
  return number;
}

export async function handleRecoveryRestore(request, env, deps) {
  if (!env.ACCOUNT_PEPPER) return deps.json(503, { error: "not_configured" });
  const ip = deps.clientIp(request);
  const gate = await deps.rateHit(env, "rc:" + ip, 10, 15 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const body = await deps.readJson(request, 2000);
  if (body.error) return deps.json(400, { error: body.error });
  const code = normalizeCode(body.code);
  const rounds = codeRounds(env, deps);
  const dummySalt = new Uint8Array(16);
  if (code.length !== 12) {
    await deps.slowHash("AAAAAAAAAAAA", dummySalt, rounds);
    return deps.json(401, { error: "recovery_invalid" });
  }
  const lookup = await deps.hmacHex(env.ACCOUNT_PEPPER, code);
  const row = await env.DB.prepare("SELECT public_id, code_hash, salt, used_at FROM recovery_codes WHERE code_lookup = ?").bind(lookup).first();
  const salt = row ? deps.b64ToBytes(row.salt) : dummySalt;
  const hash = await deps.slowHash(code, salt, rounds);
  if (!row || Number(row.used_at) > 0 || !deps.timingEqual(hash, row.code_hash)) {
    return deps.json(401, { error: "recovery_invalid" });
  }
  if (await deps.blockDeletedLogin(env, row.public_id)) return deps.json(410, { error: "account_deleted" });
  await env.DB.prepare("UPDATE recovery_codes SET used_at = ? WHERE code_lookup = ?").bind(Date.now(), lookup).run();
  const accountNumber = await rotateAccountNumber(env, row.public_id, deps);
  const recoveryCodes = await issueRecoveryCodes(env, row.public_id, deps);
  const accountRow = await env.DB.prepare("SELECT " + deps.accountCols + " FROM accounts WHERE public_id = ?").bind(row.public_id).first();
  const token = await deps.mintSession(env, row.public_id);
  return deps.json(200, {
    token: token,
    accountNumber: accountNumber,
    recoveryCodes: recoveryCodes,
    account: await deps.presentAccount(env, request, accountRow, true)
  });
}

export async function handleRecoveryRegenerate(request, env, deps) {
  const session = await deps.sessionAccount(env, request);
  if (!session) return deps.json(401, { error: "unauthorized" });
  const gate = await deps.rateHit(env, "rc-new:" + session.public_id, 5, 60 * 60 * 1000);
  if (!gate.ok) return deps.limited(gate);
  const recoveryCodes = await issueRecoveryCodes(env, session.public_id, deps);
  return deps.json(200, { recoveryCodes: recoveryCodes });
}
