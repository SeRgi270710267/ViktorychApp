-- Owner-only kill switches for heavy features (Shorts, Stories, lives, Telegram, Home pills).
CREATE TABLE IF NOT EXISTS feature_flags (
  name TEXT PRIMARY KEY,
  off INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
