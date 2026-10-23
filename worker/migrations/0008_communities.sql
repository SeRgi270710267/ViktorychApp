CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS community_posts_feed ON community_posts(community_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_likes (
  public_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (public_id, item_id)
);

CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, public_id)
);

CREATE TABLE IF NOT EXISTS community_notes (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS community_notes_account ON community_notes(public_id, seen, created_at DESC);
