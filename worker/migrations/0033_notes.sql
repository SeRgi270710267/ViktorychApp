CREATE TABLE IF NOT EXISTS profile_notes (
  public_id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'followers',
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_note_reactions (
  public_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, sender_id)
);
