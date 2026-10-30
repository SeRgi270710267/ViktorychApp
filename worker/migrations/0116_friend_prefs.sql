-- Friends master switch and its choices (worker/src/friends-pref.js creates the same table on demand).
CREATE TABLE IF NOT EXISTS account_friend_prefs (
    public_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    who_can_request TEXT NOT NULL DEFAULT 'everyone',
    list_audience TEXT NOT NULL DEFAULT 'everyone',
    share_online INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT 0
);
