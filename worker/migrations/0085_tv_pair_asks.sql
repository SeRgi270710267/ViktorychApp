-- "Sign in with an account on another device": the account a TV asked,
-- and whether it said no. One row per TV code; it expires with the code.
CREATE TABLE IF NOT EXISTS tv_pair_asks (
  code TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  denied INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tv_pair_asks_expires ON tv_pair_asks(expires_at);
