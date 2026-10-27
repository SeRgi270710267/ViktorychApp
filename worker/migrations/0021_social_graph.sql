-- Social graph for internal accounts.
-- account_blocks, account_mutes, and account_content use the same columns as
-- the mentions work, so either migration can create them.
-- protected_account is added at runtime, not here, so a second ALTER cannot fail.

CREATE TABLE IF NOT EXISTS account_blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS account_blocks_blocked ON account_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS account_mutes (
  muter_id TEXT NOT NULL,
  muted_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (muter_id, muted_id)
);

CREATE TABLE IF NOT EXISTS account_follow_requests (
  requester_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, target_id)
);

CREATE INDEX IF NOT EXISTS account_follow_requests_target ON account_follow_requests(target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_content (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS account_content_author ON account_content(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS account_messages_pair ON account_messages(sender_id, recipient_id, created_at DESC);
