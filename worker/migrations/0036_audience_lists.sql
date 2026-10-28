CREATE TABLE IF NOT EXISTS audience_lists (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audience_lists_owner ON audience_lists(public_id, created_at);

CREATE TABLE IF NOT EXISTS audience_members (
  list_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, member_id)
);
CREATE INDEX IF NOT EXISTS audience_members_owner ON audience_members(public_id, list_id);

CREATE TABLE IF NOT EXISTS audience_grants (
  subject TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (subject, subject_id, list_id)
);

ALTER TABLE app_stories ADD COLUMN audience TEXT NOT NULL DEFAULT 'public';
