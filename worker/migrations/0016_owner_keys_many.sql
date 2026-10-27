CREATE TABLE IF NOT EXISTS owner_key_items (
  owner_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
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
  PRIMARY KEY (owner_id, key_id)
);

CREATE INDEX IF NOT EXISTS owner_key_items_slot ON owner_key_items (owner_id, slot, position);

CREATE TABLE IF NOT EXISTS owner_key_pace (
  owner_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  until_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, slot)
);

INSERT INTO owner_key_items (
  owner_id, key_id, slot, label, position, kind, ciphertext, iv, mask, status, last_used, last_error, expires_at, updated_at, tested_at
)
SELECT
  owner_id,
  'legacy-' || slot,
  slot,
  '',
  0,
  kind,
  ciphertext,
  iv,
  mask,
  status,
  last_used,
  last_error,
  expires_at,
  updated_at,
  tested_at
FROM owner_keys
WHERE NOT EXISTS (
  SELECT 1 FROM owner_key_items AS items
  WHERE items.owner_id = owner_keys.owner_id AND items.slot = owner_keys.slot
);
