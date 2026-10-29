-- Packages: a private package tracker, one row per account and tracking
-- number. Only the owner reads its rows; account deletion drops them.
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  status_text TEXT NOT NULL DEFAULT '',
  eta TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  fails INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL DEFAULT 0,
  next_check_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS packages_owner_number ON packages(public_id, number);
CREATE INDEX IF NOT EXISTS packages_owner ON packages(public_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS packages_due ON packages(archived, next_check_at);
