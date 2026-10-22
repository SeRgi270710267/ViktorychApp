CREATE TABLE IF NOT EXISTS drive_vault (
  public_id TEXT PRIMARY KEY,
  kdf TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  verifier_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drive_items (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  wrapped_key TEXT NOT NULL DEFAULT '',
  wrap_iv TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL,
  meta_iv TEXT NOT NULL,
  thumb TEXT NOT NULL DEFAULT '',
  thumb_iv TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS drive_items_owner ON drive_items(public_id, deleted_at);

CREATE TABLE IF NOT EXISTS drive_chunks (
  item_id TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  iv TEXT NOT NULL,
  PRIMARY KEY (item_id, part_index)
);
