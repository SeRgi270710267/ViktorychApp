CREATE TABLE IF NOT EXISTS account_presence (
  public_id TEXT PRIMARY KEY,
  preference TEXT NOT NULL DEFAULT 'online',
  activity TEXT NOT NULL DEFAULT 'hidden',
  seen_privacy TEXT NOT NULL DEFAULT 'everyone',
  last_seen INTEGER NOT NULL DEFAULT 0,
  last_beat INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS account_status (
  public_id TEXT PRIMARY KEY,
  emoji TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  clear_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS account_status_clear ON account_status(clear_at);

CREATE TABLE IF NOT EXISTS channel_tickets (
  token_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS channel_tickets_account ON channel_tickets(public_id);
CREATE INDEX IF NOT EXISTS channel_tickets_expires ON channel_tickets(expires_at);
