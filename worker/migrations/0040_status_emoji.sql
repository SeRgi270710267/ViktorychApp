ALTER TABLE account_status ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone';

CREATE TABLE IF NOT EXISTS status_emoji_owned (
  public_id TEXT NOT NULL,
  emoji_id TEXT NOT NULL,
  from_id TEXT NOT NULL DEFAULT '',
  gift_send_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, emoji_id)
);
CREATE INDEX IF NOT EXISTS status_emoji_owned_account ON status_emoji_owned(public_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gift_sends_sender ON gift_sends(sender_id, created_at DESC);
