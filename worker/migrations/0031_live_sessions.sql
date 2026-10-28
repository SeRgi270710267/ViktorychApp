CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'public',
  fanout INTEGER NOT NULL DEFAULT 3,
  sources TEXT NOT NULL DEFAULT 'camera',
  pass_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'live',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS live_sessions_host ON live_sessions(host_id, state, updated_at);

CREATE TABLE IF NOT EXISTS live_members (
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  PRIMARY KEY (session_id, account_id)
);

CREATE TABLE IF NOT EXISTS live_blocks (
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, account_id)
);

CREATE TABLE IF NOT EXISTS live_invites (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_tickets (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
