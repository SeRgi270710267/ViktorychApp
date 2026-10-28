CREATE TABLE IF NOT EXISTS about_fields (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  section TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  person_id TEXT NOT NULL DEFAULT '',
  show_year INTEGER NOT NULL DEFAULT 0,
  tz TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'public',
  list_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS about_fields_owner ON about_fields(public_id, section, sort_order, created_at);

CREATE TABLE IF NOT EXISTS about_field_allow (
  field_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (field_id, user_id)
);
CREATE INDEX IF NOT EXISTS about_field_allow_user ON about_field_allow(user_id);

CREATE TABLE IF NOT EXISTS birthday_prefs (
  public_id TEXT PRIMARY KEY,
  notes INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
