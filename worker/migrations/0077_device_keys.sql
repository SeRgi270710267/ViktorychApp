-- Local data protection: one key per signed-in device that only the server
-- keeps. The app seals its private on-device copy with it; removing the
-- device drops the row, so that sealed copy can no longer be opened.
CREATE TABLE IF NOT EXISTS device_keys (
  token_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  data_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
