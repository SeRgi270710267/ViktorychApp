CREATE TABLE IF NOT EXISTS telegram_files (
  object_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  bucket TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL,
  message_id INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  duration REAL NOT NULL DEFAULT 0,
  serve INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  encrypted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (object_key, kind, part_index)
);
