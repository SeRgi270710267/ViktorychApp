-- "My devices": one row per signed-in session with a name, type and last seen.
CREATE TABLE IF NOT EXISTS session_devices (
  token_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS session_devices_account ON session_devices(public_id, last_seen DESC);
