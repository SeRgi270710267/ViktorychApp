-- The protected_account column is already added by the worker when it is
-- missing. A bare ALTER TABLE aborts this whole file once the column exists,
-- which would leave the migration unrecorded. Every statement below is safe
-- to run again.

CREATE TABLE IF NOT EXISTS account_content (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS account_content_author ON account_content(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mentions (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX IF NOT EXISTS mentions_target ON mentions(target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_prefs (
  public_id TEXT PRIMARY KEY,
  prefs TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_events (
  public_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  note_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, event_key)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  delivery_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_outbox_due ON notification_outbox(next_at);

CREATE TABLE IF NOT EXISTS notification_dead (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_dead_time ON notification_dead(created_at);

CREATE TABLE IF NOT EXISTS notification_tab_reads (
  public_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  read_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, tab_id)
);

CREATE TABLE IF NOT EXISTS account_blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS account_mutes (
  muter_id TEXT NOT NULL,
  muted_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (muter_id, muted_id)
);

CREATE TABLE IF NOT EXISTS discord_alert_prefs (
  public_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discord_alert_hits (
  public_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, message_id)
);
