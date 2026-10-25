CREATE TABLE IF NOT EXISTS vault_configs (
  public_id TEXT PRIMARY KEY,
  kdf TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  verifier_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  service TEXT NOT NULL,
  title TEXT NOT NULL,
  encrypted_blob TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS vault_items_owner ON vault_items(owner_id, deleted_at);

CREATE TABLE IF NOT EXISTS vault_shares (
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
);
CREATE INDEX IF NOT EXISTS vault_shares_recipient ON vault_shares(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vault_shares_sender ON vault_shares(sender_id, created_at DESC);
