-- Which Nostr event mirrors a public post (event id and public key only).
CREATE TABLE IF NOT EXISTS post_nostr (post_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, event_id TEXT NOT NULL, pubkey TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS post_nostr_author ON post_nostr(author_id);
