CREATE TABLE IF NOT EXISTS account_badges (
  public_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,
  earned_at INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT 'public',
  pinned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, badge_id)
);

CREATE INDEX IF NOT EXISTS account_badges_owner ON account_badges(public_id, pinned DESC, earned_at DESC);

CREATE TABLE IF NOT EXISTS account_badge_notices (
  public_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, badge_id, tier)
);
