-- People you may know: account types, the discoverability opt-out, dismissals and a per-viewer cache.
CREATE TABLE IF NOT EXISTS account_kind (public_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'person', owner_kind TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS suggest_prefs (public_id TEXT PRIMARY KEY, discoverable INTEGER NOT NULL DEFAULT 1, temp_opt_in INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS suggest_dismiss (public_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (public_id, target_id));
CREATE TABLE IF NOT EXISTS suggest_cache (public_id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
