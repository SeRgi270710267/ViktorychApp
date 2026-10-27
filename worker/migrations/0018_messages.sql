CREATE TABLE IF NOT EXISTS dm_conversations (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(sender_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS dm_conversations_sender ON dm_conversations(sender_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS dm_conversations_recipient ON dm_conversations(recipient_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dm_messages_conv ON dm_messages(conversation_id, created_at);
