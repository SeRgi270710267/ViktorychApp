CREATE TABLE IF NOT EXISTS owner_keys (
  owner_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  mask TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_used INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  tested_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, slot)
);
