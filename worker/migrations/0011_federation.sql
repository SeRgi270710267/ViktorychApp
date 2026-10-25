CREATE TABLE IF NOT EXISTS account_federation (
  public_id TEXT PRIMARY KEY,
  enabled_ap INTEGER NOT NULL DEFAULT 0,
  enabled_nostr INTEGER NOT NULL DEFAULT 0,
  nostr_pubkey TEXT NOT NULL DEFAULT '',
  ap_public_key_pem TEXT NOT NULL DEFAULT '',
  ap_private_key_pem TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (public_id) REFERENCES accounts(public_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ap_followers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_handle TEXT NOT NULL,
  follower_actor_url TEXT NOT NULL,
  follower_inbox_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(actor_handle, follower_actor_url)
);

CREATE INDEX IF NOT EXISTS ap_followers_handle ON ap_followers(actor_handle, created_at DESC);
