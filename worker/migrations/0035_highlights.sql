CREATE TABLE IF NOT EXISTS story_library (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  vine INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'story',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS story_library_owner ON story_library(public_id, created_at DESC);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'public',
  cover_item TEXT NOT NULL DEFAULT '',
  crop_x INTEGER NOT NULL DEFAULT 0,
  crop_y INTEGER NOT NULL DEFAULT 0,
  crop_w INTEGER NOT NULL DEFAULT 10000,
  crop_h INTEGER NOT NULL DEFAULT 10000,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS highlights_owner ON highlights(public_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS highlight_items (
  id TEXT PRIMARY KEY,
  highlight_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  vine INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS highlight_items_parent ON highlight_items(highlight_id, sort_order, created_at);
