CREATE TABLE IF NOT EXISTS notifications (
  public_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  read_at INTEGER NOT NULL DEFAULT 0,
  actor_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  pushed_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, note_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_idem ON notifications(public_id, idempotency_key);
CREATE INDEX IF NOT EXISTS notifications_time ON notifications(public_id, at DESC);

CREATE TABLE IF NOT EXISTS notification_state (
  public_id TEXT PRIMARY KEY,
  read_until INTEGER NOT NULL DEFAULT 0,
  tabs TEXT NOT NULL DEFAULT '',
  bells_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_bells (
  public_id TEXT NOT NULL,
  feed_key TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT '',
  since INTEGER NOT NULL DEFAULT 0,
  handle TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  ids TEXT NOT NULL DEFAULT '',
  handles TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, feed_key)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  public_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  ua TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, endpoint_hash)
);

CREATE TABLE IF NOT EXISTS push_vapid (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
