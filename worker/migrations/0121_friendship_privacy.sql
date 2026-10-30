-- Privacy for each friendship (worker/src/friend-privacy.js creates the same
-- tables on demand). One row per (account, friend) with a rule other than
-- "Same as my friend list". owner_access_log is shared with the owner
-- inspector and records each time the app owner sees past these rules.
CREATE TABLE IF NOT EXISTS friendship_privacy (
    public_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'inherit',
    audience TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (public_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friendship_privacy_friend ON friendship_privacy(friend_id);
CREATE TABLE IF NOT EXISTS owner_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    owner_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'view'
);
CREATE INDEX IF NOT EXISTS owner_access_log_at ON owner_access_log (at);
CREATE INDEX IF NOT EXISTS owner_access_log_target ON owner_access_log (target_id, at);
