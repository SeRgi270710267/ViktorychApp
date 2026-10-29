-- Emoji reactions on any feed post, keyed by a hash of the source and post id.
CREATE TABLE IF NOT EXISTS post_reactions (post_key TEXT NOT NULL, public_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_key, public_id));
CREATE INDEX IF NOT EXISTS post_reactions_key_emoji ON post_reactions(post_key, emoji);
CREATE INDEX IF NOT EXISTS post_reactions_account ON post_reactions(public_id);
