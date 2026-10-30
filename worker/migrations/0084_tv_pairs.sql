-- Sign a TV in with a phone: one short-lived, one-use record per code.
-- Only a hash of the TV's check-back secret is kept; no session token.
CREATE TABLE IF NOT EXISTS tv_pairs (
  code TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  public_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tv_pairs_expires ON tv_pairs(expires_at);
