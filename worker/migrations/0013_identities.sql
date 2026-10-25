CREATE TABLE IF NOT EXISTS account_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  proof_url TEXT NOT NULL DEFAULT '',
  verification_type TEXT NOT NULL DEFAULT 'challenge',
  verified INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(public_id, platform, handle)
);
CREATE INDEX IF NOT EXISTS account_identities_pub ON account_identities(public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_identities_lookup ON account_identities(platform, handle);

CREATE TABLE IF NOT EXISTS identity_challenges (
  challenge_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_challenges_user ON identity_challenges(public_id, platform, handle);
