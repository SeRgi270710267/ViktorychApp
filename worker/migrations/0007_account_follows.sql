CREATE TABLE IF NOT EXISTS account_follows (
  follower_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  snapshot TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, target_id)
);

CREATE INDEX IF NOT EXISTS account_follows_target ON account_follows(target_id, created_at DESC);
