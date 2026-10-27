CREATE TABLE IF NOT EXISTS profile_media (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'everyone',
  is_main INTEGER NOT NULL DEFAULT 0,
  is_fallback INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profile_media_owner ON profile_media(public_id, kind, sort_order, created_at);

CREATE TABLE IF NOT EXISTS profile_media_exceptions (
  media_id TEXT NOT NULL,
  public_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  PRIMARY KEY (media_id, user_id)
);
CREATE INDEX IF NOT EXISTS profile_media_exceptions_owner ON profile_media_exceptions(public_id);
CREATE INDEX IF NOT EXISTS profile_media_exceptions_user ON profile_media_exceptions(user_id);
