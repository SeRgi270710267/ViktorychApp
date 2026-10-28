-- Likes, poll votes and edits on app posts; lookups for replies and quotes.
CREATE TABLE IF NOT EXISTS public_post_likes (post_id TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, account_id));
CREATE INDEX IF NOT EXISTS public_post_likes_post ON public_post_likes(post_id);
CREATE TABLE IF NOT EXISTS public_poll_votes (post_id TEXT NOT NULL, account_id TEXT NOT NULL, choice INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, account_id));
CREATE INDEX IF NOT EXISTS public_posts_parent ON public_posts(parent_id);
CREATE INDEX IF NOT EXISTS public_posts_quote ON public_posts(quote_id);
-- Added at runtime (duplicate columns would stop every later migration): ALTER TABLE public_posts ADD COLUMN edited_at INTEGER NOT NULL DEFAULT 0;
