import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Miniflare } from "miniflare";

const OWNER = "mirathorn";
const ORIGIN = "https://viktorychgroup.github.io";

let mf;
let bindings;

function workerOptions(extra) {
  return {
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/index.js", import.meta.url)),
    modulesRoot: fileURLToPath(new URL("../..", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"], fallthrough: true }],
    compatibilityDate: "2026-01-15",
    unsafeTriggerHandlers: true,
    d1Databases: ["DB"],
    r2Buckets: ["DATA"],
    bindings: Object.assign({
      ACCOUNT_PEPPER: "pepper-test",
      OWNER_CLAIM_CODE: "claim-test",
      OWNER_HANDLE: "mirathorn",
      ALLOWED_ORIGINS: "https://viktorychgroup.github.io,http://127.0.0.1:8080",
      PBKDF2_ITERATIONS: "1000",
      DELETION_TEST_HOOK: "1"
    }, extra || {})
  };
}

function userHash(publicId) {
  return createHmac("sha256", "pepper-test").update("account-delete:" + publicId).digest("hex");
}

async function call(path, opts) {
  opts = opts || {};
  const headers = new Headers(opts.headers || {});
  headers.set("CF-Connecting-IP", opts.ip || "203.0.113.10");
  if (opts.origin) headers.set("Origin", opts.origin);
  if (opts.token) headers.set("Authorization", "Bearer " + opts.token);
  if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await mf.dispatchFetch("https://accounts.test" + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch (err) { body = { raw: text }; }
  return { status: res.status, body, text };
}

function del(opts) {
  const headers = Object.assign({ "X-Viktorych-Intent": "account-delete" }, opts.headers || {});
  return call("/v1/account/delete", Object.assign({ method: "POST", origin: ORIGIN }, opts, { headers }));
}

async function signup(handle, name, ip, claimCode) {
  const body = { displayName: name, handle };
  if (claimCode) body.claimCode = claimCode;
  const created = await call("/v1/signup", { method: "POST", ip, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}

async function sql(statement, ...args) {
  return bindings.DB.prepare(statement).bind(...args).run();
}

async function one(statement, ...args) {
  return bindings.DB.prepare(statement).bind(...args).first();
}

async function count(statement, ...args) {
  const row = await one(statement, ...args);
  return Number(row && (row.n != null ? row.n : row["COUNT(*)"]) || 0);
}

function columnsFromSql(sql) {
  const text = String(sql || "");
  const open = text.indexOf("(");
  if (open < 0) return [];
  const cols = [];
  let depth = 0;
  let current = "";
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "," && depth === 0) {
      cols.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) cols.push(current.trim());
  const names = [];
  for (const col of cols) {
    if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(col)) continue;
    const match = /^["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/.exec(col);
    if (match) names.push(match[1]);
  }
  return names;
}

async function leftovers(publicId, handle) {
  const tables = await bindings.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const cols = ["public_id", "follower_id", "target_id", "sender_id", "receiver_id", "user_id", "friend_id", "author_id", "owner_id", "recipient_id", "actor_handle"];
  const hits = [];
  for (const table of tables.results) {
    const name = table.name;
    const names = columnsFromSql(table.sql);
    for (const col of cols) {
      if (names.indexOf(col) < 0) continue;
      let row;
      if (col === "target_id") row = await one("SELECT COUNT(*) AS n FROM " + name + " WHERE " + col + " = ? OR " + col + " = ?", publicId, "app:" + publicId);
      else if (col === "actor_handle") row = await one("SELECT COUNT(*) AS n FROM " + name + " WHERE " + col + " = ?", handle);
      else row = await one("SELECT COUNT(*) AS n FROM " + name + " WHERE " + col + " = ?", publicId);
      if (row && Number(row.n) > 0) hits.push(name + "." + col);
    }
  }
  return hits;
}

async function objectKeys(prefix) {
  const listed = await bindings.DATA.list({ prefix });
  return ((listed && listed.objects) || []).map((item) => item.key);
}

async function readJson(key) {
  const object = await bindings.DATA.get(key);
  if (!object) return null;
  return JSON.parse(await object.text());
}

test.before(async () => {
  mf = new Miniflare(workerOptions());
  bindings = await mf.getBindings();
});

test.after(async () => {
  if (mf) await mf.dispose();
});

test("python deletion scrub selftest", () => {
  const script = fileURLToPath(new URL("../../scripts/account_deletions.py", import.meta.url));
  const result = spawnSync("python3", [script, "--selftest"], { encoding: "utf8" });
  assert.equal(result.status, 0, (result.stderr || "") + (result.stdout || ""));
});

test("deletes one account everywhere and leaves everyone else", async () => {
  const health = await call("/v1/health", { ip: "198.51.100.1" });
  assert.equal(health.status, 200);

  const ada = await signup("ada_wipe", "Ada Wipe", "198.51.100.2");
  const bee = await signup("bee_wipe", "Bee Wipe", "198.51.100.3");
  const owner = await signup(OWNER, "Owner", "198.51.100.4", "claim-test");
  assert.equal(owner.account.owner, true);
  const a = ada.account.publicId;
  const b = bee.account.publicId;
  const o = owner.account.publicId;
  const now = Date.now();
  const adaRow = await one("SELECT skeleton, handle FROM accounts WHERE public_id = ?", a);
  assert.ok(adaRow && adaRow.skeleton);

  const payload = JSON.stringify({
    follows: ["app:" + b],
    likes: { a: 1 },
    bookmarks: { a: 1 },
    groups: [{ id: "g", name: "Ada group" }],
    feedTabs: [{ id: "home" }],
    noteTabs: [{ id: "all" }],
    drafts: [{ text: "draft" }],
    history: [{ id: "watch" }],
    resume: { video: 3 }
  });
  await sql("INSERT INTO sessions (token_hash, public_id, created_at, expires_at) VALUES (?, ?, ?, ?)", "extra-session-a", a, now, now + 100000);
  await sql("INSERT INTO sync_state (public_id, payload, updated_at) VALUES (?, ?, ?)", a, payload, now);
  await sql("INSERT INTO sync_state (public_id, payload, updated_at) VALUES (?, ?, ?)", b, JSON.stringify({ follows: ["x:nasa"], bookmarks: { keep: 1 } }), now);
  await sql("INSERT INTO account_reposts (public_id, post_key, kind, comment, snapshot, created_at) VALUES (?, 'post-1', 'repost', '', '{}', ?)", a, now);
  await sql("INSERT INTO account_reposts (public_id, post_key, kind, comment, snapshot, created_at) VALUES (?, 'post-2', 'repost', '', '{}', ?)", b, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?)", a, "app:" + b, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?)", a, "app:" + o, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?)", b, "app:" + a, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, 'x:nasa', '', ?)", b, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?)", o, "app:" + b, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, ?, '', ?)", o, "app:" + a, now);
  await sql("INSERT INTO drive_vault (public_id, kdf, iterations, salt, verifier, verifier_iv, created_at, updated_at) VALUES (?, 'pbkdf2', 1, 's', 'v', 'i', ?, ?)", a, now, now);
  await sql("INSERT INTO drive_vault (public_id, kdf, iterations, salt, verifier, verifier_iv, created_at, updated_at) VALUES (?, 'pbkdf2', 1, 's', 'v', 'i', ?, ?)", b, now, now);
  await sql("INSERT INTO drive_items (id, public_id, parent_id, kind, wrapped_key, wrap_iv, meta, meta_iv, thumb, thumb_iv, created_at, updated_at, deleted_at) VALUES ('item-ada', ?, '', 'file', '', '', 'm', 'i', '', '', ?, ?, 0)", a, now, now);
  await sql("INSERT INTO drive_items (id, public_id, parent_id, kind, wrapped_key, wrap_iv, meta, meta_iv, thumb, thumb_iv, created_at, updated_at, deleted_at) VALUES ('item-bee', ?, '', 'file', '', '', 'm', 'i', '', '', ?, ?, 0)", b, now, now);
  await sql("INSERT INTO drive_chunks (item_id, part_index, message_id, file_id, size, iv) VALUES ('item-ada', 0, 1, 'f', 4, 'iv')");
  await sql("INSERT INTO drive_chunks (item_id, part_index, message_id, file_id, size, iv) VALUES ('item-bee', 0, 1, 'f', 4, 'iv')");
  await sql("INSERT INTO community_posts (id, community_id, author_id, parent_id, body, created_at, deleted_at) VALUES ('post-ada', 'c1', ?, '', 'ada post', ?, 0)", a, now);
  await sql("INSERT INTO community_posts (id, community_id, author_id, parent_id, body, created_at, deleted_at) VALUES ('post-bee', 'c1', ?, '', 'bee post', ?, 0)", b, now);
  await sql("INSERT INTO community_likes (public_id, item_id, created_at) VALUES (?, 'post-bee', ?)", a, now);
  await sql("INSERT INTO community_likes (public_id, item_id, created_at) VALUES (?, 'post-ada', ?)", b, now);
  await sql("INSERT INTO community_likes (public_id, item_id, created_at) VALUES (?, 'post-bee', ?)", b, now);
  await sql("INSERT INTO community_members (community_id, public_id, created_at) VALUES ('c1', ?, ?)", a, now);
  await sql("INSERT INTO community_members (community_id, public_id, created_at) VALUES ('c1', ?, ?)", b, now);
  await sql("INSERT INTO community_notes (id, public_id, payload, created_at, seen) VALUES ('note-ada', ?, '{}', ?, 0)", a, now);
  await sql("INSERT INTO community_notes (id, public_id, payload, created_at, seen) VALUES ('note-bee', ?, '{}', ?, 0)", b, now);
  await sql("INSERT INTO account_friend_requests (sender_id, receiver_id, created_at) VALUES (?, ?, ?)", a, b, now);
  await sql("INSERT INTO account_friend_requests (sender_id, receiver_id, created_at) VALUES (?, ?, ?)", b, a, now);
  await sql("INSERT INTO account_friend_requests (sender_id, receiver_id, created_at) VALUES (?, ?, ?)", b, o, now);
  await sql("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", a, b, now);
  await sql("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", b, a, now);
  await sql("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", b, o, now);
  await sql("INSERT INTO account_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", o, b, now);
  await sql("INSERT INTO account_federation (public_id, enabled_ap, enabled_nostr, nostr_pubkey, ap_public_key_pem, ap_private_key_pem, created_at, updated_at) VALUES (?, 1, 0, '', 'pub', 'priv', ?, ?)", a, now, now);
  await sql("INSERT INTO account_federation (public_id, enabled_ap, enabled_nostr, nostr_pubkey, ap_public_key_pem, ap_private_key_pem, created_at, updated_at) VALUES (?, 0, 0, '', '', '', ?, ?)", b, now, now);
  await sql("INSERT INTO ap_followers (actor_handle, follower_actor_url, follower_inbox_url, created_at) VALUES (?, 'https://ada.example/u', 'https://ada.example/in', ?)", adaRow.handle, now);
  await sql("INSERT INTO ap_followers (actor_handle, follower_actor_url, follower_inbox_url, created_at) VALUES (?, 'https://bee.example/u', 'https://bee.example/in', ?)", "bee_wipe", now);
  await sql("INSERT INTO account_identities (public_id, platform, handle, display_name, avatar, proof_url, verification_type, verified, created_at) VALUES (?, 'x', 'ada', '', '', '', 'challenge', 1, ?)", a, now);
  await sql("INSERT INTO account_identities (public_id, platform, handle, display_name, avatar, proof_url, verification_type, verified, created_at) VALUES (?, 'x', 'bee', '', '', '', 'challenge', 1, ?)", b, now);
  await sql("INSERT INTO identity_challenges (challenge_id, public_id, platform, handle, code, created_at, expires_at) VALUES ('ch-ada', ?, 'x', 'ada', 'code', ?, ?)", a, now, now + 1000);
  await sql("INSERT INTO identity_challenges (challenge_id, public_id, platform, handle, code, created_at, expires_at) VALUES ('ch-bee', ?, 'x', 'bee', 'code', ?, ?)", b, now, now + 1000);
  await sql("INSERT INTO vault_configs (public_id, kdf, iterations, salt, verifier, verifier_iv, created_at, updated_at) VALUES (?, 'pbkdf2', 1, 's', 'v', 'i', ?, ?)", a, now, now);
  await sql("INSERT INTO vault_configs (public_id, kdf, iterations, salt, verifier, verifier_iv, created_at, updated_at) VALUES (?, 'pbkdf2', 1, 's', 'v', 'i', ?, ?)", b, now, now);
  await sql("INSERT INTO vault_items (id, owner_id, service, title, encrypted_blob, iv, created_at, updated_at, deleted_at) VALUES ('vitem-ada', ?, 'x', 't', 'blob', 'iv', ?, ?, 0)", a, now, now);
  await sql("INSERT INTO vault_items (id, owner_id, service, title, encrypted_blob, iv, created_at, updated_at, deleted_at) VALUES ('vitem-bee', ?, 'x', 't', 'blob', 'iv', ?, ?, 0)", b, now, now);
  await sql("INSERT INTO vault_shares (id, item_id, sender_id, sender_handle, recipient_id, recipient_handle, service, title, encrypted_payload, iv, share_code_hash, created_at) VALUES ('share-ab', 'vitem-ada', ?, 'ada_wipe', ?, 'bee_wipe', 'x', 't', 'p', 'iv', '', ?)", a, b, now);
  await sql("INSERT INTO vault_shares (id, item_id, sender_id, sender_handle, recipient_id, recipient_handle, service, title, encrypted_payload, iv, share_code_hash, created_at) VALUES ('share-ba', 'vitem-bee', ?, 'bee_wipe', ?, 'ada_wipe', 'x', 't', 'p', 'iv', '', ?)", b, a, now);
  await sql("INSERT INTO vault_shares (id, item_id, sender_id, sender_handle, recipient_id, recipient_handle, service, title, encrypted_payload, iv, share_code_hash, created_at) VALUES ('share-bo', 'vitem-bee', ?, 'bee_wipe', ?, 'owner', 'x', 't', 'p', 'iv', '', ?)", b, o, now);
  await sql("INSERT INTO owner_keys (owner_id, slot, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at) VALUES (?, 'tiktok', 'cookie', 'c', 'iv', 'm', 'unknown', 0, '', 0, ?, 0)", a, now);
  await sql("INSERT INTO owner_keys (owner_id, slot, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at) VALUES (?, 'youtube', 'cookie', 'c', 'iv', 'm', 'unknown', 0, '', 0, ?, 0)", o, now);
  await sql("INSERT INTO owner_key_items (owner_id, key_id, slot, label, position, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at) VALUES (?, 'k-ada', 'tiktok', 'backup', 1, 'cookie', 'c', 'iv', 'm', 'unknown', 0, '', 0, ?, 0)", a, now);
  await sql("INSERT INTO owner_key_items (owner_id, key_id, slot, label, position, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at) VALUES (?, 'k-own', 'youtube', 'backup', 1, 'cookie', 'c', 'iv', 'm', 'unknown', 0, '', 0, ?, 0)", o, now);
  await sql("INSERT INTO owner_key_pace (owner_id, slot, reason, until_at, updated_at) VALUES (?, 'tiktok', 'slow', ?, ?)", a, now + 1000, now);
  await sql("INSERT INTO owner_key_pace (owner_id, slot, reason, until_at, updated_at) VALUES (?, 'youtube', 'slow', ?, ?)", o, now + 1000, now);
  await sql("INSERT INTO account_reauths (token_hash, public_id, expires_at) VALUES ('reauth-ada', ?, ?)", a, now + 1000);
  await sql("INSERT INTO account_presence (public_id, preference, activity, seen_privacy, last_seen, last_beat, updated_at) VALUES (?, 'online', 'active', 'everyone', ?, ?, ?)", a, now, now, now);
  await sql("INSERT INTO account_presence (public_id, preference, activity, seen_privacy, last_seen, last_beat, updated_at) VALUES (?, 'online', 'active', 'everyone', ?, ?, ?)", b, now, now, now);
  await sql("INSERT INTO account_status (public_id, emoji, text, clear_at, updated_at) VALUES (?, '✨', 'here', 0, ?)", a, now);
  await sql("INSERT INTO account_status (public_id, emoji, text, clear_at, updated_at) VALUES (?, '✨', 'here', 0, ?)", b, now);
  await sql("INSERT INTO channel_tickets (token_hash, public_id, expires_at) VALUES ('ticket-ada', ?, ?)", a, now + 1000);
  await sql("INSERT INTO channel_tickets (token_hash, public_id, expires_at) VALUES ('ticket-bee', ?, ?)", b, now + 1000);
  await sql("INSERT INTO notifications (public_id, note_id, kind, at, read_at, actor_id, subject, idempotency_key, payload, updated_at, pushed_at) VALUES (?, 'note-ada', 'post', ?, 0, '', 'ada', 'note-ada', '{}', ?, 0)", a, now, now);
  await sql("INSERT INTO notifications (public_id, note_id, kind, at, read_at, actor_id, subject, idempotency_key, payload, updated_at, pushed_at) VALUES (?, 'note-bee', 'post', ?, 0, '', 'bee', 'note-bee', '{}', ?, 0)", b, now, now);
  await sql("INSERT INTO notification_state (public_id, read_until, tabs, bells_at, updated_at) VALUES (?, 0, '', 0, ?)", a, now);
  await sql("INSERT INTO notification_state (public_id, read_until, tabs, bells_at, updated_at) VALUES (?, 0, '', 0, ?)", b, now);
  await sql("INSERT INTO notification_bells (public_id, feed_key, mode, since, handle, name, ids, handles, updated_at, deleted_at) VALUES (?, 'x:ada', 'all', ?, 'ada', 'Ada', '[]', '[]', ?, 0)", a, now, now);
  await sql("INSERT INTO notification_bells (public_id, feed_key, mode, since, handle, name, ids, handles, updated_at, deleted_at) VALUES (?, 'x:bee', 'all', ?, 'bee', 'Bee', '[]', '[]', ?, 0)", b, now, now);
  await sql("INSERT INTO push_subscriptions (public_id, endpoint_hash, endpoint, p256dh, auth, ua, created_at, updated_at, expires_at) VALUES (?, 'push-ada', 'https://push.example/ada', 'p', 'a', '', ?, ?, 0)", a, now, now);
  await sql("INSERT INTO push_subscriptions (public_id, endpoint_hash, endpoint, p256dh, auth, ua, created_at, updated_at, expires_at) VALUES (?, 'push-bee', 'https://push.example/bee', 'p', 'a', '', ?, ?, 0)", b, now, now);
  await sql("INSERT INTO push_log (public_id, note_id, created_at) VALUES (?, 'note-ada', ?)", a, now);
  await sql("INSERT INTO push_log (public_id, note_id, created_at) VALUES (?, 'note-bee', ?)", b, now);
  await sql("INSERT INTO push_vapid (id, public_key, private_jwk, created_at) VALUES (1, 'pub', 'priv', ?)", now);
  await sql("INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)", "follow:" + a, now + 100000);
  await sql("INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)", "follow:" + b, now + 100000);
  await sql("INSERT INTO telegram_files (object_key, kind, part_index, bucket, file_id, message_id, size, sha256, mime, duration, serve, verified, encrypted, updated_at) VALUES ('shared.bin', 'file', 0, '', 'fid', 1, 4, 'abc', 'application/octet-stream', 0, 0, 0, 0, ?)", now);

  await bindings.DATA.put("media/avatars/" + a + "/x.webp", "ava-a");
  await bindings.DATA.put("media/banners/" + a + "/y.webp", "ban-a");
  await bindings.DATA.put("uploads/" + a + "/z.bin", "up-a");
  await bindings.DATA.put("exports/" + a + "/out.json", "{}");
  await bindings.DATA.put("users/" + a + "/note.json", "{}");
  await bindings.DATA.put("accounts/" + a + "/blob.bin", "a");
  await bindings.DATA.put("media/avatars/" + b + "/keep.webp", "ava-b");
  await bindings.DATA.put("owner/tiktok.json", JSON.stringify({ ok: true }));
  await bindings.DATA.put("people.json", JSON.stringify({
    people: [
      { id: "app:" + a, publicId: a, name: "Ada", handle: "ada_wipe" },
      { id: "keeper", name: "Keep" }
    ]
  }));
  await bindings.DATA.put("follows.json", JSON.stringify(["x:nasa", "app:" + a, { id: "app:" + b }]));
  await bindings.DATA.put("follows/home.json", JSON.stringify({ ids: ["app:" + a, "x:nasa"] }));

  const noOrigin = await del({ ip: "198.51.100.10", token: ada.token, body: { handle: "ada_wipe", accountNumber: ada.accountNumber }, origin: "" });
  assert.equal(noOrigin.status, 403);
  const evil = await del({ ip: "198.51.100.11", token: ada.token, origin: "https://evil.example", body: { handle: "ada_wipe", accountNumber: ada.accountNumber } });
  assert.equal(evil.status, 403);
  const noIntent = await call("/v1/account/delete", {
    method: "POST",
    ip: "198.51.100.12",
    origin: ORIGIN,
    token: ada.token,
    body: { handle: "ada_wipe", accountNumber: ada.accountNumber }
  });
  assert.equal(noIntent.status, 403);
  const badType = await del({
    ip: "198.51.100.13",
    token: ada.token,
    headers: { "content-type": "text/plain", "X-Viktorych-Intent": "account-delete" },
    body: { handle: "ada_wipe", accountNumber: ada.accountNumber }
  });
  assert.equal(badType.status, 415);
  const wrongHandle = await del({ ip: "198.51.100.20", token: ada.token, body: { handle: "bee_wipe", accountNumber: ada.accountNumber } });
  assert.equal(wrongHandle.status, 400);
  assert.equal(wrongHandle.body.error, "handle_mismatch");
  const wrongNumber = await del({ ip: "198.51.100.20", token: ada.token, body: { handle: "ada_wipe", accountNumber: "0000000000000000" } });
  assert.equal(wrongNumber.status, 401);
  assert.equal(wrongNumber.body.error, "invalid_credentials");
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", a));

  const ownerTry = await del({ ip: "198.51.100.30", token: owner.token, body: { handle: OWNER, accountNumber: owner.accountNumber } });
  assert.equal(ownerTry.status, 403);
  assert.equal(ownerTry.body.error, "owner_protected");
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", o));
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_keys WHERE owner_id = ?", o), 1);
  const emergency = await del({
    ip: "198.51.100.31",
    token: "emergency-offline-test",
    body: { handle: OWNER, accountNumber: "0000000000000000" }
  });
  assert.equal(emergency.status, 403);
  assert.equal(emergency.body.error, "owner_protected");

  const removed = await del({
    ip: "198.51.100.20",
    token: ada.token,
    body: { handle: "ada_wipe", accountNumber: ada.accountNumber }
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.deletion, "complete");
  assert.equal(removed.body.steps.sessions, true);
  assert.equal(removed.body.steps.database, true);
  assert.equal(removed.body.steps.objects, true);
  assert.equal(removed.body.steps.publish, true);
  const dumped = removed.text;
  assert.equal(dumped.includes(a), false);
  assert.equal(dumped.includes("ada_wipe"), false);
  assert.equal(dumped.includes(ada.accountNumber), false);

  assert.deepEqual(await leftovers(a, "ada_wipe"), []);
  assert.equal(await count("SELECT COUNT(*) AS n FROM account_presence WHERE public_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM account_status WHERE public_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM channel_tickets WHERE public_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM notifications WHERE public_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM push_subscriptions WHERE public_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM notifications WHERE public_id = ?", b), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM push_vapid WHERE id = 1"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM account_presence WHERE public_id = ?", b), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM account_status WHERE public_id = ?", b), 1);
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", b));
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", o));
  const beeSession = await call("/v1/session", { ip: "198.51.100.32", token: bee.token });
  assert.equal(beeSession.status, 200);
  const adaSession = await call("/v1/session", { ip: "198.51.100.33", token: ada.token });
  assert.equal(adaSession.status, 401);
  const beeFollows = await bindings.DB.prepare("SELECT target_id FROM account_follows WHERE follower_id = ? ORDER BY target_id").bind(b).all();
  assert.deepEqual(beeFollows.results.map((row) => row.target_id), ["x:nasa"]);
  assert.equal(await count("SELECT COUNT(*) AS n FROM account_follows WHERE follower_id = ? AND target_id = ?", o, "app:" + b), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM account_follows WHERE target_id = ? OR target_id = ?", a, "app:" + a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM community_posts WHERE id = 'post-bee'"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM community_likes WHERE public_id = ? AND item_id = 'post-bee'", b), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM drive_items WHERE id = 'item-bee'"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM drive_chunks WHERE item_id = 'item-bee'"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM vault_items WHERE id = 'vitem-bee'"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM vault_shares WHERE id = 'share-bo'"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_keys WHERE owner_id = ?", o), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_keys WHERE owner_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_key_items WHERE owner_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_key_pace WHERE owner_id = ?", a), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_key_items WHERE owner_id = ?", o), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM owner_key_pace WHERE owner_id = ?", o), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ?", "follow:" + b), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM telegram_files"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ap_followers WHERE actor_handle = 'bee_wipe'"), 1);
  const beeSync = await one("SELECT payload FROM sync_state WHERE public_id = ?", b);
  assert.equal(JSON.parse(beeSync.payload).bookmarks.keep, 1);

  assert.deepEqual(await objectKeys("media/avatars/" + a + "/"), []);
  assert.deepEqual(await objectKeys("media/banners/" + a + "/"), []);
  assert.deepEqual(await objectKeys("uploads/" + a + "/"), []);
  assert.deepEqual(await objectKeys("exports/" + a + "/"), []);
  assert.deepEqual(await objectKeys("users/" + a + "/"), []);
  assert.deepEqual(await objectKeys("accounts/" + a + "/"), []);
  assert.deepEqual(await objectKeys("media/avatars/" + b + "/"), ["media/avatars/" + b + "/keep.webp"]);
  assert.deepEqual(await readJson("owner/tiktok.json"), { ok: true });
  const people = await readJson("people.json");
  assert.deepEqual(people.people, [{ id: "keeper", name: "Keep" }]);
  assert.equal(JSON.stringify(people).includes(a), false);
  assert.equal(JSON.stringify(people).includes("ada_wipe"), false);
  assert.deepEqual(await readJson("follows.json"), ["x:nasa", { id: "app:" + b }]);
  assert.deepEqual(await readJson("follows/home.json"), { ids: ["x:nasa"] });

  const expected = userHash(a);
  assert.match(expected, /^[0-9a-f]{64}$/);
  const listed = await readJson("deletions.json");
  assert.deepEqual(Object.keys(listed).sort(), ["hashes"]);
  assert.equal(listed.hashes.includes(expected), true);
  assert.equal(JSON.stringify(listed).includes(a), false);
  assert.equal(JSON.stringify(listed).includes("ada_wipe"), false);
  const remote = await call("/v1/account/deletions", { ip: "198.51.100.34" });
  assert.equal(remote.status, 200);
  assert.deepEqual(Object.keys(remote.body).sort(), ["hashes"]);
  assert.equal(remote.body.hashes.includes(expected), true);
  assert.equal(remote.text.includes(a), false);
  assert.equal(remote.text.includes(ada.accountNumber), false);

  const hold = await one("SELECT skeleton, user_hash, held_until FROM handle_holds WHERE skeleton = ?", adaRow.skeleton);
  assert.equal(hold.user_hash, expected);
  assert.ok(Number(hold.held_until) > Date.now());
  const job = await one("SELECT public_id, handle, skeleton, status, user_hash FROM account_deletion_jobs WHERE user_hash = ?", expected);
  assert.equal(job.status, "done");
  assert.equal(job.public_id, "");
  assert.equal(job.handle, "");
  assert.equal(job.skeleton, "");

  const taken = await call("/v1/signup", { method: "POST", ip: "198.51.100.35", body: { displayName: "Copy", handle: "ada_wipe" } });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, "handle_held");
  const probe = await call("/v1/handle?handle=" + encodeURIComponent("ada_wipe"), { ip: "198.51.100.36" });
  assert.equal(probe.body.error, "handle_held");

  const again = await del({ ip: "198.51.100.37", token: ada.token, body: { handle: "ada_wipe", accountNumber: ada.accountNumber } });
  assert.equal(again.status, 401);
});

test("fresh re-auth can delete, and a bad password is rate limited", async () => {
  const user = await signup("rea_wipe", "Rea Wipe", "198.51.100.60");
  const fresh = await call("/v1/account/reauth", {
    method: "POST",
    ip: "198.51.100.61",
    origin: ORIGIN,
    token: user.token,
    headers: { "X-Viktorych-Intent": "account-reauth" },
    body: { accountNumber: user.accountNumber }
  });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.match(fresh.body.reauthToken, /^ra1\./);
  const removed = await del({
    ip: "198.51.100.62",
    token: user.token,
    body: { handle: "rea_wipe", reauthToken: fresh.body.reauthToken }
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.deletion, "complete");
  assert.equal(await one("SELECT public_id FROM accounts WHERE public_id = ?", user.account.publicId), null);
  const reused = await del({
    ip: "198.51.100.63",
    token: user.token,
    body: { handle: "rea_wipe", reauthToken: fresh.body.reauthToken }
  });
  assert.equal(reused.status, 401);

  const paced = await signup("rate_wipe", "Rate Wipe", "198.51.100.70");
  for (let i = 0; i < 8; i++) {
    const bad = await del({
      ip: "198.51.100.71",
      token: paced.token,
      body: { handle: "rate_wipe", accountNumber: "1111111111111111" }
    });
    assert.equal(bad.status, 401, String(i));
  }
  const limited = await del({
    ip: "198.51.100.71",
    token: paced.token,
    body: { handle: "rate_wipe", accountNumber: paced.accountNumber }
  });
  assert.equal(limited.status, 429);
  assert.ok(await one("SELECT public_id FROM accounts WHERE public_id = ?", paced.account.publicId));
});

test("a stopped deletion resumes from the cron and drops rows written after the first sweep", async () => {
  const user = await signup("job_wipe", "Job Wipe", "198.51.100.80");
  const id = user.account.publicId;
  await bindings.DATA.put("media/avatars/" + id + "/x.webp", "still-here");
  const pending = await del({
    ip: "198.51.100.81",
    token: user.token,
    headers: { "X-Viktorych-Intent": "account-delete", "x-deletion-fail": "objects" },
    body: { handle: "job_wipe", accountNumber: user.accountNumber }
  });
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  assert.equal(pending.body.deletion, "pending");
  assert.equal(pending.body.steps.database, true);
  assert.equal(pending.body.steps.objects, false);
  assert.match(pending.body.resumeToken, /^dr1\./);
  assert.equal(pending.text.includes(id), false);
  assert.equal(await one("SELECT public_id FROM accounts WHERE public_id = ?", id), null);
  assert.deepEqual(await objectKeys("media/avatars/" + id + "/"), ["media/avatars/" + id + "/x.webp"]);

  const now = Date.now();
  await sql("INSERT INTO sync_state (public_id, payload, updated_at) VALUES (?, '{}', ?)", id, now);
  await sql("INSERT INTO account_follows (follower_id, target_id, snapshot, created_at) VALUES (?, 'x:nasa', '', ?)", id, now);
  await sql("INSERT INTO sessions (token_hash, public_id, created_at, expires_at) VALUES ('stray-job', ?, ?, ?)", id, now, now + 1000);

  const cronTime = Date.UTC(2026, 0, 1, 0, 7, 0);
  const cron = await mf.dispatchFetch("https://accounts.test/cdn-cgi/handler/scheduled?cron=" + encodeURIComponent("* * * * *") + "&time=" + cronTime);
  assert.equal(cron.status, 200, await cron.text());
  assert.deepEqual(await leftovers(id, "job_wipe"), []);
  assert.deepEqual(await objectKeys("media/avatars/" + id + "/"), []);
  const job = await one("SELECT public_id, handle, skeleton, status FROM account_deletion_jobs WHERE user_hash = ?", userHash(id));
  assert.equal(job.status, "done");
  assert.equal(job.public_id, "");
  assert.equal(job.handle, "");
  assert.equal(job.skeleton, "");

  const replay = await del({
    ip: "198.51.100.82",
    body: { resumeToken: pending.body.resumeToken }
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.deletion, "complete");
  assert.equal(replay.body.already, true);
});

test("a zero-day hold frees the handle immediately", async () => {
  const local = new Miniflare(workerOptions({ HANDLE_HOLD_DAYS: "0" }));
  const previous = mf;
  const previousBindings = bindings;
  mf = local;
  bindings = await local.getBindings();
  try {
    const created = await signup("hold_wipe", "Hold Wipe", "198.51.100.90");
    const removed = await del({
      ip: "198.51.100.91",
      token: created.token,
      body: { handle: "hold_wipe", accountNumber: created.accountNumber }
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(await count("SELECT COUNT(*) AS n FROM handle_holds"), 0);
    const again = await signup("hold_wipe", "Hold Wipe", "198.51.100.92");
    assert.equal(again.account.handle, "hold_wipe");
  } finally {
    await local.dispose();
    mf = previous;
    bindings = previousBindings;
  }
});
