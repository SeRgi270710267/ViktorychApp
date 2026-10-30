-- Community Notes: contributors, notes, ratings, requests, owner overrides
-- and an audit log of every owner action. The scorer writes statuses here
-- on a schedule; clients read shown notes from small R2 shards instead.
CREATE TABLE IF NOT EXISTS cn_contributors (
  public_id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL,
  can_write INTEGER NOT NULL DEFAULT 0,
  rating_impact INTEGER NOT NULL DEFAULT 0,
  writing_impact INTEGER NOT NULL DEFAULT 0,
  factor REAL NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  left_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cn_notes (
  id TEXT PRIMARY KEY,
  post_ref TEXT NOT NULL,
  app_post_id TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  reasons TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  media_note INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  algo_status TEXT NOT NULL DEFAULT 'nmr',
  intercept REAL NOT NULL DEFAULT 0,
  factor REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nmr',
  status_at INTEGER NOT NULL DEFAULT 0,
  shown_at INTEGER NOT NULL DEFAULT 0,
  override TEXT NOT NULL DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 0,
  locked_status TEXT NOT NULL DEFAULT '',
  edited_by_owner INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cn_notes_ref ON cn_notes(post_ref);
CREATE INDEX IF NOT EXISTS cn_notes_author ON cn_notes(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cn_notes_status ON cn_notes(status, updated_at DESC);
CREATE TABLE IF NOT EXISTS cn_ratings (
  note_id TEXT NOT NULL,
  rater_id TEXT NOT NULL,
  level REAL NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, rater_id)
);
CREATE INDEX IF NOT EXISTS cn_ratings_rater ON cn_ratings(rater_id);
CREATE TABLE IF NOT EXISTS cn_requests (
  post_ref TEXT NOT NULL,
  public_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_ref, public_id)
);
CREATE TABLE IF NOT EXISTS cn_post_rules (
  post_ref TEXT PRIMARY KEY,
  no_notes INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cn_x_overrides (
  x_note_id TEXT PRIMARY KEY,
  override TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cn_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cn_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
