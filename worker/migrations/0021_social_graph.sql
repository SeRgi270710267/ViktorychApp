-- Runs after 0020_mentions.sql and 0020_passkeys.sql.
-- account_blocks, account_mutes, and account_content are created there.
-- This file only adds the follow-request and message tables, plus a
-- lookup index on the shared block table. protected_account is also
-- added by 0020_mentions.sql, so it is not altered again here.

CREATE INDEX IF NOT EXISTS account_blocks_blocked ON account_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS account_follow_requests (
  requester_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, target_id)
);

CREATE INDEX IF NOT EXISTS account_follow_requests_target ON account_follow_requests(target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS account_messages_pair ON account_messages(sender_id, recipient_id, created_at DESC);
