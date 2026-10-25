/* Zero-knowledge Viktorych Vault backend routes.
   The Worker stores encrypted ciphertext blobs and envelopes.
   Credentials, master passphrases, and decrypted tokens never touch the Worker. */

export const VAULT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vault_configs (
    public_id TEXT PRIMARY KEY,
    kdf TEXT NOT NULL,
    iterations INTEGER NOT NULL,
    salt TEXT NOT NULL,
    verifier TEXT NOT NULL,
    verifier_iv TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    service TEXT NOT NULL,
    title TEXT NOT NULL,
    encrypted_blob TEXT NOT NULL,
    iv TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS vault_items_owner ON vault_items(owner_id, deleted_at)`,
  `CREATE TABLE IF NOT EXISTS vault_shares (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_handle TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    recipient_handle TEXT NOT NULL,
    service TEXT NOT NULL,
    title TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    iv TEXT NOT NULL,
    share_code_hash TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vault_shares_recipient ON vault_shares(recipient_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS vault_shares_sender ON vault_shares(sender_id, created_at DESC)`
];

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/=_-]{1,65536}$/;

function cleanId(value) {
  const text = String(value || "");
  return ID_RE.test(text) ? text : "";
}

function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return (prefix || "vi_") + raw;
}

export async function handleVaultRoute(request, env, path, url, deps) {
  const viewer = await deps.sessionAccount(env, request);
  if (!viewer) return deps.json(401, { error: "unauthorized" });

  const method = request.method;

  // Vault Config (Salt, KDF, Verifier)
  if (path === "/v1/vault/config") {
    if (method === "GET") {
      const row = await env.DB.prepare(
        "SELECT kdf, iterations, salt, verifier, verifier_iv, created_at FROM vault_configs WHERE public_id = ?"
      ).bind(viewer.public_id).first();
      if (!row) return deps.json(200, { configured: false });
      return deps.json(200, {
        configured: true,
        kdf: row.kdf,
        iterations: Number(row.iterations),
        salt: row.salt,
        verifier: row.verifier,
        verifierIv: row.verifier_iv,
        createdAt: Number(row.created_at)
      });
    }

    if (method === "POST") {
      const body = await deps.readJson(request);
      if (!body) return deps.json(400, { error: "invalid_json" });
      const kdf = String(body.kdf || "pbkdf2-sha256").slice(0, 50);
      const iterations = Math.max(10000, Math.min(2000000, Number(body.iterations) || 600000));
      const salt = String(body.salt || "").trim();
      const verifier = String(body.verifier || "").trim();
      const verifierIv = String(body.verifierIv || "").trim();
      if (!salt || !verifier || !verifierIv || salt.length > 200 || verifier.length > 500) {
        return deps.json(400, { error: "invalid_config_fields" });
      }
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO vault_configs (public_id, kdf, iterations, salt, verifier, verifier_iv, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(public_id) DO UPDATE SET
           kdf = excluded.kdf,
           iterations = excluded.iterations,
           salt = excluded.salt,
           verifier = excluded.verifier,
           verifier_iv = excluded.verifier_iv,
           updated_at = excluded.updated_at`
      ).bind(viewer.public_id, kdf, iterations, salt, verifier, verifierIv, now, now).run();
      return deps.json(200, { ok: true });
    }
    return deps.json(405, { error: "method_not_allowed" });
  }

  // Personal Vault Items
  if (path === "/v1/vault/items") {
    if (method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT id, service, title, encrypted_blob, iv, created_at, updated_at
         FROM vault_items
         WHERE owner_id = ? AND deleted_at = 0
         ORDER BY updated_at DESC`
      ).bind(viewer.public_id).all();
      const items = (rows && rows.results ? rows.results : []).map((r) => ({
        id: r.id,
        service: r.service,
        title: r.title,
        encryptedBlob: r.encrypted_blob,
        iv: r.iv,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at)
      }));
      return deps.json(200, { items });
    }

    if (method === "POST") {
      const body = await deps.readJson(request);
      if (!body) return deps.json(400, { error: "invalid_json" });
      const service = String(body.service || "generic").trim().slice(0, 40).toLowerCase();
      const title = String(body.title || "").trim().slice(0, 100);
      const encryptedBlob = String(body.encryptedBlob || "").trim();
      const iv = String(body.iv || "").trim();
      if (!title || !encryptedBlob || !iv || encryptedBlob.length > 65536) {
        return deps.json(400, { error: "invalid_item_payload" });
      }
      const now = Date.now();
      let itemId = cleanId(body.id);
      if (itemId) {
        // Update existing item
        const existing = await env.DB.prepare(
          "SELECT id FROM vault_items WHERE id = ? AND owner_id = ?"
        ).bind(itemId, viewer.public_id).first();
        if (existing) {
          await env.DB.prepare(
            `UPDATE vault_items SET service = ?, title = ?, encrypted_blob = ?, iv = ?, updated_at = ? WHERE id = ?`
          ).bind(service, title, encryptedBlob, iv, now, itemId).run();
          return deps.json(200, { ok: true, id: itemId });
        }
      }
      // Insert new
      itemId = newId("vi_");
      await env.DB.prepare(
        `INSERT INTO vault_items (id, owner_id, service, title, encrypted_blob, iv, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).bind(itemId, viewer.public_id, service, title, encryptedBlob, iv, now, now).run();
      return deps.json(200, { ok: true, id: itemId });
    }
    return deps.json(405, { error: "method_not_allowed" });
  }

  // Single Item Delete
  const itemMatch = path.match(/^\/v1\/vault\/items\/([A-Za-z0-9_-]{8,64})$/);
  if (itemMatch) {
    const itemId = itemMatch[1];
    if (method === "DELETE") {
      await env.DB.prepare(
        "UPDATE vault_items SET deleted_at = ? WHERE id = ? AND owner_id = ?"
      ).bind(Date.now(), itemId, viewer.public_id).run();
      await env.DB.prepare(
        "DELETE FROM vault_shares WHERE item_id = ? AND sender_id = ?"
      ).bind(itemId, viewer.public_id).run();
      return deps.json(200, { ok: true });
    }
    return deps.json(405, { error: "method_not_allowed" });
  }

  // Vault Share Actions
  if (path === "/v1/vault/share") {
    if (method === "POST") {
      const body = await deps.readJson(request);
      if (!body) return deps.json(400, { error: "invalid_json" });
      const itemId = cleanId(body.itemId);
      const recipientHandle = String(body.recipientHandle || "").replace(/^@/, "").trim().toLowerCase();
      const service = String(body.service || "generic").trim().slice(0, 40).toLowerCase();
      const title = String(body.title || "").trim().slice(0, 100);
      const encryptedPayload = String(body.encryptedPayload || "").trim();
      const iv = String(body.iv || "").trim();
      const shareCodeHash = String(body.shareCodeHash || "").trim().slice(0, 128);

      if (!recipientHandle || !encryptedPayload || !iv || encryptedPayload.length > 65536) {
        return deps.json(400, { error: "invalid_share_fields" });
      }

      const target = await env.DB.prepare(
        "SELECT public_id, handle FROM accounts WHERE lower(handle) = ?"
      ).bind(recipientHandle).first();
      if (!target) return deps.json(404, { error: "recipient_not_found" });

      if (target.public_id === viewer.public_id) {
        return deps.json(400, { error: "cannot_share_with_self" });
      }

      const shareId = newId("vsh_");
      const now = Date.now();

      await env.DB.prepare(
        `INSERT INTO vault_shares (id, item_id, sender_id, sender_handle, recipient_id, recipient_handle, service, title, encrypted_payload, iv, share_code_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        shareId,
        itemId || "",
        viewer.public_id,
        viewer.handle,
        target.public_id,
        target.handle,
        service,
        title,
        encryptedPayload,
        iv,
        shareCodeHash,
        now
      ).run();

      return deps.json(200, { ok: true, shareId });
    }
    return deps.json(405, { error: "method_not_allowed" });
  }

  // Shares List (Received and Sent)
  if (path === "/v1/vault/shares") {
    if (method === "GET") {
      const receivedRows = await env.DB.prepare(
        `SELECT id, item_id, sender_id, sender_handle, service, title, encrypted_payload, iv, share_code_hash, created_at
         FROM vault_shares
         WHERE recipient_id = ?
         ORDER BY created_at DESC`
      ).bind(viewer.public_id).all();

      const sentRows = await env.DB.prepare(
        `SELECT id, item_id, recipient_id, recipient_handle, service, title, created_at
         FROM vault_shares
         WHERE sender_id = ?
         ORDER BY created_at DESC`
      ).bind(viewer.public_id).all();

      const received = (receivedRows && receivedRows.results ? receivedRows.results : []).map((r) => ({
        id: r.id,
        itemId: r.item_id,
        senderId: r.sender_id,
        senderHandle: r.sender_handle,
        service: r.service,
        title: r.title,
        encryptedPayload: r.encrypted_payload,
        iv: r.iv,
        hasPin: !!(r.share_code_hash && r.share_code_hash.length > 0),
        shareCodeHash: r.share_code_hash,
        createdAt: Number(r.created_at)
      }));

      const sent = (sentRows && sentRows.results ? sentRows.results : []).map((r) => ({
        id: r.id,
        itemId: r.item_id,
        recipientId: r.recipient_id,
        recipientHandle: r.recipient_handle,
        service: r.service,
        title: r.title,
        createdAt: Number(r.created_at)
      }));

      return deps.json(200, { received, sent });
    }
    return deps.json(405, { error: "method_not_allowed" });
  }

  // Revoke/Delete a Share
  const shareMatch = path.match(/^\/v1\/vault\/shares\/([A-Za-z0-9_-]{8,64})$/);
  if (shareMatch) {
    const shareId = shareMatch[1];
    if (method === "DELETE") {
      await env.DB.prepare(
        "DELETE FROM vault_shares WHERE id = ? AND (sender_id = ? OR recipient_id = ?)"
      ).bind(shareId, viewer.public_id, viewer.public_id).run();
      return deps.json(200, { ok: true });
    }
    return deps.json(405, { error: "method_not_allowed" });
  }

  return deps.json(404, { error: "not_found" });
}
