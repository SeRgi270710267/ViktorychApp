-- Source requests, bans and allows (worker/src/feed-requests.js creates the same tables on demand).
-- Handles and URLs live only in these private tables, never in the repo.
CREATE TABLE IF NOT EXISTS feed_requests (
    id TEXT PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'feed',
    platform TEXT NOT NULL DEFAULT '',
    handle TEXT NOT NULL DEFAULT '',
    input TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    preview TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'pending',
    dest TEXT NOT NULL DEFAULT '',
    dest_detail TEXT NOT NULL DEFAULT '',
    decided_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    seen_at INTEGER NOT NULL DEFAULT 0
  );
CREATE INDEX IF NOT EXISTS feed_requests_state ON feed_requests (state, updated_at);
CREATE TABLE IF NOT EXISTS feed_request_voters (
    request_id TEXT NOT NULL,
    public_id TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT 0,
    decided_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (request_id, public_id)
  );
CREATE INDEX IF NOT EXISTS feed_request_voters_by ON feed_request_voters (public_id, created_at);
CREATE TABLE IF NOT EXISTS feed_bans (
    source_key TEXT PRIMARY KEY,
    alias TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    input TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0
  );
CREATE INDEX IF NOT EXISTS feed_bans_alias ON feed_bans (alias);
CREATE TABLE IF NOT EXISTS feed_allows (
    source_key TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_key, scope)
  );
