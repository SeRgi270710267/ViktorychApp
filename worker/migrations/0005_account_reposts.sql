CREATE TABLE IF NOT EXISTS account_reposts (
  public_id TEXT NOT NULL,
  post_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, post_key)
);

CREATE INDEX IF NOT EXISTS account_reposts_recent ON account_reposts(public_id, created_at DESC);
