CREATE TABLE IF NOT EXISTS community_meta (
  community_id TEXT PRIMARY KEY,
  visibility TEXT NOT NULL DEFAULT 'public',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS community_feed_prefs (
  public_id TEXT NOT NULL,
  community_id TEXT NOT NULL DEFAULT '',
  show_home INTEGER NOT NULL DEFAULT 1,
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (public_id, community_id)
);

CREATE INDEX IF NOT EXISTS community_posts_home ON community_posts(deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_parent ON community_posts(parent_id);
CREATE INDEX IF NOT EXISTS community_members_account ON community_members(public_id, community_id);
