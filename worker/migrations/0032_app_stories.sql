CREATE TABLE IF NOT EXISTS app_stories (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  vine INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_stories_account ON app_stories(public_id, expires_at);
CREATE INDEX IF NOT EXISTS app_stories_expiry ON app_stories(expires_at);

CREATE TABLE IF NOT EXISTS app_story_views (
  story_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS app_story_reactions (
  story_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, public_id)
);

CREATE TABLE IF NOT EXISTS app_story_replies (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_story_replies_story ON app_story_replies(story_id, created_at);
